// settings.js - Cài đặt ứng dụng + Tiền mặt tại POS
// ES5, tương thích Android 6, iOS 12

// ============================================================
// 0. HÀM KIỂM TRA CHỐT NGÀY (dùng chung cho toàn bộ POS)
// ============================================================
// Kiểm tra xem hôm nay đã chốt ngày chưa
// Dùng để chặn refund/xóa món/xóa bàn sau khi chốt
var _dayClosedCache = false;

function isDayClosed() {
    return _dayClosedCache;
}

// Cập nhật cache từ dữ liệu _posCashData
function _updateDayClosedCache() {
    if (_posCashData) {
        _dayClosedCache = _posCashData.isClosed === true;
    }
}

// ============================================================
// 1. TIỀN MẶT TẠI POS (Cash Counter + Đối soát quỹ)
// ============================================================
var CASH_DENOMS = [
    { value: 1000, label: '1k' },
    { value: 2000, label: '2k' },
    { value: 5000, label: '5k' },
    { value: 10000, label: '10k' },
    { value: 20000, label: '20k' },
    { value: 50000, label: '50k' },
    { value: 100000, label: '100k' },
    { value: 200000, label: '200k' },
    { value: 500000, label: '500k' }
];
var cashCounts = {};
var _posCashData = null; // Cache dữ liệu đối soát

function initQuickCashCounter() {
    cashCounts = {};
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        cashCounts[CASH_DENOMS[i].value] = 0;
    }
    _posCashData = null;
    loadPosCashData();

    // Subscribe realtime vào daily_balances hôm nay để cập nhật _dayClosedCache
    // Khi admin hủy chốt từ thiết bị khác, nhân viên sẽ thấy ngay
    _subscribeDayClosedRealtime();
}

// Lắng nghe realtime thay đổi trạng thái chốt ngày
function _subscribeDayClosedRealtime() {
    try {
        var today = new Date().toISOString().slice(0, 10);
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var dbRef = firebase.database().ref(shopId + '/daily_balances/' + today);

        // Lắng nghe thay đổi trên daily_balances hôm nay
        dbRef.on('value', function(snapshot) {
            var data = snapshot.val();
            if (data) {
                var newIsClosed = data.isClosed === true;
                // Nếu trạng thái thay đổi, cập nhật cache và reload
                if (newIsClosed !== _dayClosedCache) {
                    _dayClosedCache = newIsClosed;
                    console.log('[DayClosed] Realtime update: isClosed =', _dayClosedCache);
                    // Reload dữ liệu để cập nhật UI
                    loadPosCashData();
                }
            }
        });
    } catch (e) {
        console.error('[DayClosed] Subscribe realtime error:', e);
    }
}

function loadPosCashData() {
    var today = new Date().toISOString().slice(0, 10);
    var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();

    // Lấy ngày hôm trước để tính số dư đầu kỳ
    var prevDate = new Date(today);
    prevDate.setDate(prevDate.getDate() - 1);
    var prevDateStr = prevDate.toISOString().slice(0, 10);

    console.log('[POS Cash] Loading data for:', today, 'prev:', prevDateStr);

    // Lấy shopId từ DB
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var dbRef = firebase.database().ref(shopId);

    // Đọc trực tiếp từ Firebase Realtime Database vì cost_transactions, daily_balances, manager_cash_pickups
    // KHÔNG được subscribe (đồng bộ) xuống IndexedDB local (xem db.js initDatabase)
    Promise.all([
        // Số dư đầu kỳ = cashKept của ngày hôm trước
        dbRef.child('daily_balances/' + prevDateStr).once('value'),
        // Doanh thu tiền mặt trong ngày (từ IndexedDB - transactions đã được subscribe)
        DB.getTransactionsByDate(today),
        // Chi phí từ Két POS - đọc trực tiếp từ Firebase
        dbRef.child('cost_transactions').once('value'),
        // Tiền quản lý nhận - đọc trực tiếp từ Firebase
        dbRef.child('manager_cash_pickups').once('value'),
        // daily_balances hôm nay (đã lưu) - đọc trực tiếp từ Firebase
        dbRef.child('daily_balances/' + today).once('value')
    ]).then(function(results) {
        var prevBalance = results[0].val() || {};
        var transactions = results[1] || [];
        var allCostsSnapshot = results[2].val() || {};
        var pickupsSnapshot = results[3].val() || {};
        var savedBalance = results[4].val() || {};

        // Chuyển đổi Firebase snapshot object thành array
        var allCosts = [];
        for (var key in allCostsSnapshot) {
            if (allCostsSnapshot.hasOwnProperty(key)) {
                var item = allCostsSnapshot[key];
                item.id = key;
                allCosts.push(item);
            }
        }

        var pickups = [];
        for (var key2 in pickupsSnapshot) {
            if (pickupsSnapshot.hasOwnProperty(key2)) {
                var item2 = pickupsSnapshot[key2];
                item2.id = key2;
                pickups.push(item2);
            }
        }

        // Lọc transactions không bị refund
        if (Array.isArray(transactions)) {
            transactions = transactions.filter(function(t) { return !t.refunded; });
        } else {
            transactions = [];
        }

        console.log('[POS Cash] prevBalance:', prevBalance);
        console.log('[POS Cash] transactions:', transactions.length, 'items');
        console.log('[POS Cash] allCosts (from Firebase):', allCosts.length, 'items');
        console.log('[POS Cash] pickups (from Firebase):', pickups.length, 'items');
        console.log('[POS Cash] savedBalance:', savedBalance);

        // Số dư đầu kỳ
        var openingBalance = (prevBalance && prevBalance.cashKept) || 0;

        // Doanh thu tiền mặt
        var cashRevenue = 0;
        for (var i = 0; i < transactions.length; i++) {
            if (transactions[i].paymentMethod === 'cash') {
                cashRevenue += transactions[i].amount;
            }
        }

        // Chi phí từ Két POS
        var posCashExpense = 0;
        var posCostCount = 0;
        for (var j = 0; j < allCosts.length; j++) {
            var c = allCosts[j];
            if (c.dateKey === today && !c.deleted && c.fundSource === 'pos_cash') {
                posCashExpense += c.amount;
                posCostCount++;
                console.log('[POS Cash] Found cost:', c.categoryName, c.amount, c.dateKey, c.fundSource);
            }
        }

        // Tiền quản lý nhận + lịch sử
        var managerPickupTotal = 0;
        var pickupHistory = [];
        for (var k = 0; k < pickups.length; k++) {
            if (pickups[k].dateKey === today) {
                managerPickupTotal += pickups[k].amount;
                pickupHistory.push(pickups[k]);
            }
        }
        // Sắp xếp lịch sử theo thời gian tăng dần
        pickupHistory.sort(function(a, b) {
            return (a.createdAt || 0) - (b.createdAt || 0);
        });

        // expectedClosing KHÔNG trừ managerPickup - tiền QL nhận sẽ trừ vào số thực tế
        var expectedClosing = openingBalance + cashRevenue - posCashExpense;

        console.log('[POS Cash] Result:', { openingBalance: openingBalance, cashRevenue: cashRevenue, posCashExpense: posCashExpense, posCostCount: posCostCount, managerPickupTotal: managerPickupTotal, expectedClosing: expectedClosing });

        _posCashData = {
            openingBalance: openingBalance,
            cashRevenue: cashRevenue,
            posCashExpense: posCashExpense,
            posCostCount: posCostCount,
            managerPickupTotal: managerPickupTotal,
            pickupHistory: pickupHistory,
            expectedClosing: expectedClosing,
            actualClosing: (savedBalance.actualClosing !== undefined && savedBalance.actualClosing !== null) ? savedBalance.actualClosing : null,
            isClosed: savedBalance.isClosed || false,
            difference: (savedBalance.difference !== undefined && savedBalance.difference !== null) ? savedBalance.difference : null,
            diffPercent: (savedBalance.diffPercent !== undefined && savedBalance.diffPercent !== null) ? savedBalance.diffPercent : null,
            status: savedBalance.status || null
        };

        // Cập nhật cache isDayClosed để các module khác (refund, xóa món, xóa bàn) kiểm tra
        _updateDayClosedCache();

        renderCashCounter(isAdmin);
    }).catch(function(err) {
        console.error('[POS Cash] loadPosCashData error:', err);
        renderCashCounter(isAdmin);
    });
}

function renderCashCounter(isAdmin) {
    var container = document.getElementById('quickCashContainer');
    if (!container) return;
    if (isAdmin === undefined) {
        isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
    }

    // Tính tổng tiền đếm được
    var countedTotal = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        countedTotal += CASH_DENOMS[i].value * (cashCounts[CASH_DENOMS[i].value] || 0);
    }

    var data = _posCashData || {
        openingBalance: 0, cashRevenue: 0, posCashExpense: 0, posCostCount: 0,
        managerPickupTotal: 0, pickupHistory: [], expectedClosing: 0, actualClosing: null,
        isClosed: false, difference: null, diffPercent: null, status: null
    };

    // Chênh lệch = tổng đếm được - dự kiến còn
    var liveDiff = countedTotal - data.expectedClosing;
    var liveDiffClass = liveDiff >= 0 ? 'pos-cash-positive' : 'pos-cash-negative';

    // Số tiền tại POS hiện tại (realtime)
    // Khi chưa đếm: expectedClosing - managerPickupTotal
    // Khi đã đếm: countedTotal - managerPickupTotal
    var currentPosCash = data.expectedClosing - data.managerPickupTotal;
    var actualPosCash = countedTotal > 0 ? (countedTotal - data.managerPickupTotal) : currentPosCash;
    if (actualPosCash < 0) actualPosCash = 0;

    var html = '';
    html += '<div class="cash-counter">';

    // ===== HEADER =====
    html += '  <div class="cash-counter-header">';
    html += '    <span class="cash-counter-title">💰 Tiền mặt tại POS</span>';
    if (data.isClosed) {
        html += '    <span class="cash-closed-badge">🔒 Đã chốt</span>';
    }
    html += '  </div>';

    // ===== THÔNG TIN ĐỐI SOÁT (chỉ Quản lý mới thấy) =====
    if (isAdmin) {
        html += '  <div class="pos-cash-info">';
        html += '    <div class="pos-cash-row"><span>📂 Số dư đầu kỳ</span><span>' + formatMoney(data.openingBalance) + '</span></div>';
        html += '    <div class="pos-cash-row"><span>💵 Doanh thu tiền mặt</span><span>' + formatMoney(data.cashRevenue) + '</span></div>';
        html += '    <div class="pos-cash-row"><span>🏦 Chi phí từ Két POS</span><span class="pos-cash-expense">' + data.posCostCount + ' khoản - ' + formatMoney(data.posCashExpense) + '</span></div>';

        html += '    <div class="pos-cash-row pos-cash-formula">';
        html += '      <span>📐 Dự kiến còn:</span>';
        html += '      <span class="pos-cash-expected" id="posCashExpected">' + formatMoney(data.expectedClosing) + '</span>';
        html += '    </div>';

        // Số tiền thực tế = tổng đếm được
        html += '    <div class="pos-cash-row">';
        html += '      <span>📊 Số tiền thực tế:</span>';
        html += '      <span class="cash-counter-total" id="cashGrandTotal">' + formatMoney(countedTotal) + '</span>';
        html += '    </div>';

        // Chênh lệch realtime
        html += '    <div class="pos-cash-row pos-cash-diff" id="posCashDiffRow">';
        html += '      <span>📋 Chênh lệch:</span>';
        html += '      <span class="' + liveDiffClass + '" id="posCashDiffValue">' + (liveDiff >= 0 ? '+' : '') + formatMoney(liveDiff) + '</span>';
        html += '    </div>';
        html += '  </div>';
    }

    // ===== HIỂN THỊ THÔNG TIN CHO NHÂN VIÊN (đưa LÊN TRÊN bộ đếm) =====
    if (!isAdmin) {
        html += '  <div class="pos-cash-staff-result">';
        html += '    <div class="pos-cash-row"><span>📂 Số dư đầu kỳ</span><span>' + formatMoney(data.openingBalance) + '</span></div>';

        // 💵 Doanh thu tiền mặt - chỉ hiện khi đã chốt
        if (data.isClosed) {
            html += '    <div class="pos-cash-row"><span>💵 Doanh thu tiền mặt</span><span>' + formatMoney(data.cashRevenue) + '</span></div>';
        }

        html += '    <div class="pos-cash-row"><span>🏦 Chi phí Két POS</span><span>' + data.posCostCount + ' khoản - ' + formatMoney(data.posCashExpense) + '</span></div>';
        html += '    <div class="pos-cash-row"><span>💰 QL nhận</span><span>' + formatMoney(data.managerPickupTotal) + '</span></div>';

        // 💵 Số tiền tại POS hiện tại = số nhân viên đếm
        html += '    <div class="pos-cash-row">';
        html += '      <span>💵 Số tiền tại POS hiện tại:</span>';
        html += '      <span class="' + (countedTotal >= 0 ? 'pos-cash-positive' : 'pos-cash-negative') + '" id="staffPosCashValue">' + formatMoney(countedTotal) + '</span>';
        html += '    </div>';

        // 📊 Chênh lệch thực tế - chỉ hiển thị khi đã chốt
        if (data.isClosed) {
            var expectedAfterPickup = data.expectedClosing - data.managerPickupTotal;
            var staffDiff = countedTotal - expectedAfterPickup;
            var staffDiffClass = staffDiff >= 0 ? 'pos-cash-positive' : 'pos-cash-negative';
            html += '    <div class="pos-cash-row pos-cash-diff" id="staffDiffRow">';
            html += '      <span>📊 Chênh lệch thực tế:</span>';
            html += '      <span class="' + staffDiffClass + '" id="staffDiffValue">' + (staffDiff >= 0 ? '+' : '') + formatMoney(staffDiff) + ' (đã chốt)</span>';
            html += '    </div>';
        }

        html += '  </div>';
    }

    // ===== BẢNG ĐẾM TIỀN =====
    html += '  <div class="pos-cash-section-title">🔢 Kiểm tiền mặt</div>';
    html += '  <div class="denom-grid">';

    for (var i = 0; i < CASH_DENOMS.length; i++) {
        var denom = CASH_DENOMS[i];
        var count = cashCounts[denom.value] || 0;
        var subtotal = denom.value * count;
        html += '    <div class="denom-card">';
        html += '      <div class="denom-label">' + denom.label + '</div>';
        html += '      <div class="denom-controls">';
        html += '        <button class="ctrl-btn ctrl-minus" onclick="adjustCashCount(' + denom.value + ', -1)">−</button>';
        html += '        <input type="number" class="denom-input" id="cashInput_' + denom.value + '" value="' + count + '" min="0" onchange="setCashCount(' + denom.value + ', this.value)" onfocus="this.select()">';
        html += '        <button class="ctrl-btn ctrl-plus" onclick="adjustCashCount(' + denom.value + ', 1)">+</button>';
        html += '      </div>';
        html += '      <div class="denom-subtotal" id="denomSubtotal_' + denom.value + '">' + formatMoney(subtotal) + '</div>';
        html += '    </div>';
    }

    html += '  </div>';

    // ===== NÚT HÀNH ĐỘNG =====
    if (isAdmin) {
        html += '  <div class="cash-counter-actions">';
        html += '    <button class="cash-action-btn cash-reset-btn" onclick="resetCashCounter()">🔄 Làm lại</button>';
        html += '    <button class="cash-action-btn cash-copy-btn" onclick="copyCashResult()">📋 Sao chép</button>';
        if (!data.isClosed) {
            html += '    <button class="cash-action-btn cash-save-btn" onclick="savePosCashClosing()">💾 Lưu lại</button>';
        } else {
            // Admin có nút "Hủy chốt" để mở khóa cho nhân viên chốt lại
            html += '    <button class="cash-action-btn cash-unlock-btn" onclick="unlockDayClose()">🔓 Hủy chốt</button>';
        }
        html += '  </div>';
    } else {
        html += '  <div class="cash-counter-actions">';
        html += '    <button class="cash-action-btn cash-reset-btn" onclick="resetCashCounter()">🔄 Làm lại</button>';
        html += '    <button class="cash-action-btn cash-copy-btn" onclick="copyCashResult()">📋 Sao chép</button>';
        if (!data.isClosed) {
            html += '    <button class="cash-action-btn cash-close-btn" onclick="staffCloseDay()">🔒 Chốt ngày</button>';
        }
        html += '  </div>';
    }

    html += '</div>';

    // ===== PHẦN RIÊNG: TIỀN QUẢN LÝ NHẬN (input + lưu Firebase) =====
    if (isAdmin) {
        html += '<div class="cash-counter" style="margin-top:12px;">';
        html += '  <div class="cash-counter-header">';
        html += '    <span class="cash-counter-title">💰 Tiền QL nhận</span>';
        html += '  </div>';
        html += '  <div class="pos-cash-info">';
        html += '    <div class="pos-cash-row">';
        html += '      <span>💰 Tiền QL nhận:</span>';
        html += '      <span class="pos-cash-mgr-pickup">';
        html += '        <input type="number" class="mgr-pickup-input" id="mgrPickupInput" value="' + data.managerPickupTotal + '" min="0" placeholder="0">';
        html += '        <button class="mgr-pickup-btn" onclick="saveManagerPickup()">💾 Lưu</button>';
        html += '      </span>';
        html += '    </div>';

        // Lịch sử quản lý nhận tiền hôm nay
        if (data.pickupHistory && data.pickupHistory.length > 0) {
            for (var hi = 0; hi < data.pickupHistory.length; hi++) {
                var ph = data.pickupHistory[hi];
                var timeStr = '';
                if (ph.createdAt) {
                    var d = new Date(ph.createdAt);
                    timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                }
                html += '    <div class="pos-cash-row pos-cash-pickup-log">';
                html += '      <span>🕐 ' + timeStr + '</span>';
                html += '      <span>-' + formatMoney(ph.amount) + '</span>';
                html += '    </div>';
            }
        }
        html += '  </div>';
        html += '</div>';
    }

    container.innerHTML = html;
}

function adjustCashCount(denomValue, delta) {
    var current = cashCounts[denomValue] || 0;
    var newVal = current + delta;
    if (newVal < 0) newVal = 0;
    cashCounts[denomValue] = newVal;
    updateDenomSubtotal(denomValue);
    updateCashGrandTotal();
}

function setCashCount(denomValue, val) {
    var num = parseInt(val, 10);
    if (isNaN(num) || num < 0) num = 0;
    cashCounts[denomValue] = num;
    updateDenomSubtotal(denomValue);
    updateCashGrandTotal();
}

function updateDenomSubtotal(denomValue) {
    var count = cashCounts[denomValue] || 0;
    var subtotal = denomValue * count;
    var el = document.getElementById('denomSubtotal_' + denomValue);
    if (el) el.textContent = formatMoney(subtotal);
    var input = document.getElementById('cashInput_' + denomValue);
    if (input) input.value = count;
}

function updateCashGrandTotal() {
    var total = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        var denom = CASH_DENOMS[i];
        total += denom.value * (cashCounts[denom.value] || 0);
    }

    // Số tiền thực tế = tổng đếm được
    var el = document.getElementById('cashGrandTotal');
    if (el) el.textContent = formatMoney(total);

    // Cập nhật chênh lệch realtime (admin)
    var expectedClosing = _posCashData ? _posCashData.expectedClosing : 0;
    var liveDiff = total - expectedClosing;
    var diffEl = document.getElementById('posCashDiffValue');
    if (diffEl) {
        var diffClass = liveDiff >= 0 ? 'pos-cash-positive' : 'pos-cash-negative';
        diffEl.textContent = (liveDiff >= 0 ? '+' : '') + formatMoney(liveDiff);
        diffEl.className = diffClass;
    }

    // Cập nhật Số tiền tại POS hiện tại (staff) = số nhân viên đếm
    var staffPosCashEl = document.getElementById('staffPosCashValue');
    if (staffPosCashEl) {
        staffPosCashEl.textContent = formatMoney(total);
        staffPosCashEl.className = total >= 0 ? 'pos-cash-positive' : 'pos-cash-negative';
    }
}

function resetCashCounter() {
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        cashCounts[CASH_DENOMS[i].value] = 0;
    }
    renderCashCounter();
}

function copyCashResult() {
    var total = 0;
    var lines = [];
    lines.push('=== KIỂM TIỀN MẶT POS ===');
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        var denom = CASH_DENOMS[i];
        var count = cashCounts[denom.value] || 0;
        if (count > 0) {
            var subtotal = denom.value * count;
            total += subtotal;
            lines.push(denom.label + ': ' + count + ' tờ = ' + formatMoney(subtotal));
        }
    }
    lines.push('---------------------');
    lines.push('TỔNG CỘNG: ' + formatMoney(total));

    if (_posCashData) {
        lines.push('');
        lines.push('📊 ĐỐI SOÁT:');
        lines.push('Dự kiến: ' + formatMoney(_posCashData.expectedClosing));
        lines.push('Thực tế: ' + formatMoney(total));
        var diff = total - _posCashData.expectedClosing;
        lines.push('Chênh lệch: ' + (diff >= 0 ? '+' : '') + formatMoney(diff));
    }

    var text = lines.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            showToast('✅ Đã sao chép kết quả', 'success');
        }).catch(function() {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showToast('✅ Đã sao chép kết quả', 'success');
    } catch (e) {
        showToast('❌ Không thể sao chép', 'error');
    }
    document.body.removeChild(textarea);
}

// ========== QUẢN LÝ: NHẬP TIỀN QUẢN LÝ NHẬN ==========
function saveManagerPickup() {
    var input = document.getElementById('mgrPickupInput');
    if (!input) return;
    var amount = parseInt(input.value, 10);
    if (isNaN(amount) || amount <= 0) {
        showToast('⚠️ Nhập số tiền hợp lệ', 'warning');
        return;
    }

    var today = new Date().toISOString().slice(0, 10);
    var now = Date.now();
    var pickupId = 'pickup_' + now.toString(36) + '_' + Math.random().toString(36).substr(2, 4);

    var pickupData = {
        id: pickupId,
        amount: amount,
        dateKey: today,
        createdAt: now,
        createdBy: (DB.getCurrentUser && DB.getCurrentUser() && DB.getCurrentUser().id) || window.currentDeviceId || 'admin',
        note: 'Quản lý nhận tiền mặt'
    };

    // Lưu trực tiếp lên Firebase
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var dbRef = firebase.database().ref(shopId + '/manager_cash_pickups/' + pickupId);

    dbRef.set(pickupData).then(function() {
        showToast('✅ Đã lưu: ' + formatMoney(amount), 'success');
        // Reload lại dữ liệu
        loadPosCashData();
    }).catch(function(err) {
        console.error('saveManagerPickup error:', err);
        showToast('❌ Lỗi khi lưu!', 'error');
    });
}

// ========== QUẢN LÝ: LƯU LẠI (Lưu thông tin lên Firebase để chốt ca cuối ngày) ==========
function savePosCashClosing() {
    var countedTotal = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        countedTotal += CASH_DENOMS[i].value * (cashCounts[CASH_DENOMS[i].value] || 0);
    }

    if (countedTotal === 0 && !confirm('⚠️ Số tiền đếm được là 0đ. Xác nhận lưu?')) return;

    var today = new Date().toISOString().slice(0, 10);
    var expectedClosing = _posCashData ? _posCashData.expectedClosing : 0;
    var difference = countedTotal - expectedClosing;
    var diffPercent = expectedClosing > 0 ? Math.abs(difference) / expectedClosing * 100 : 0;

    var msg = '⚠️ XÁC NHẬN LƯU\n\n' +
              '📊 Số tiền thực tế: ' + formatMoney(countedTotal) + '\n' +
              '📐 Dự kiến: ' + formatMoney(expectedClosing) + '\n' +
              '📋 Chênh lệch: ' + (difference >= 0 ? '+' : '') + formatMoney(difference) + '\n\n' +
              '📌 Lưu thông tin lên Firebase để chốt ca cuối ngày.';

    if (!confirm(msg)) return;

    // Lưu thông tin lên Firebase (chủ yếu để chốt ca cuối ngày)
    DB.get('daily_balances', today).then(function(existing) {
        var data = existing || { id: today };
        data.actualClosing = countedTotal;
        data.expectedClosing = expectedClosing;
        data.difference = difference;
        data.diffPercent = diffPercent;
        data.updatedAt = Date.now();

        if (!data.cashKept && data.cashKept !== 0) {
            data.cashKept = countedTotal;
        }

        return DB.create('daily_balances', data, today);
    }).then(function() {
        showToast('✅ Đã lưu: ' + formatMoney(countedTotal), 'success');
        // Gửi Telegram thông báo
        if (typeof sendTelegramMessage === 'function') {
            var icon = diffPercent <= 1 ? '✅' : '⚠️';
            var msg = icon + ' LƯU ĐỐI SOÁT ' + formatDateDisplay(today) + '\n' +
                      '📊 Thực tế: ' + formatMoney(countedTotal) + '\n' +
                      '📐 Dự kiến: ' + formatMoney(expectedClosing) + '\n' +
                      '📋 Chênh lệch: ' + (difference >= 0 ? '+' : '') + formatMoney(difference) + '\n' +
                      '📈 Tỷ lệ: ' + diffPercent.toFixed(2) + '%';
            sendTelegramMessage(msg);
        }
        loadPosCashData(); // Reload
    }).catch(function(err) {
        console.error('savePosCashClosing error:', err);
        showToast('❌ Lỗi khi lưu!', 'error');
    });
}

// ========== NHÂN VIÊN: CHỐT NGÀY ==========
function staffCloseDay() {
    var countedTotal = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        countedTotal += CASH_DENOMS[i].value * (cashCounts[CASH_DENOMS[i].value] || 0);
    }

    // Chốt ngay, không cần confirm
    var managerPickupTotal = _posCashData ? (_posCashData.managerPickupTotal || 0) : 0;
    var expectedClosing = _posCashData ? _posCashData.expectedClosing : 0;

    // Chênh lệch = số đếm - (dự kiến - QL nhận)
    var expectedAfterPickup = expectedClosing - managerPickupTotal;
    var difference = countedTotal - expectedAfterPickup;
    var diffPercent = expectedAfterPickup > 0 ? Math.abs(difference) / expectedAfterPickup * 100 : 0;

    var today = new Date().toISOString().slice(0, 10);

    // Lưu và chốt ngày
    DB.get('daily_balances', today).then(function(existing) {
        var data = existing || { id: today };
        data.actualClosing = countedTotal;
        data.countedTotal = countedTotal;
        data.managerPickupTotal = managerPickupTotal;
        data.expectedClosing = expectedClosing;
        data.expectedAfterPickup = expectedAfterPickup;
        data.difference = difference;
        data.diffPercent = diffPercent;
        data.isClosed = true;
        data.closedAt = Date.now();
        data.closedBy = window.currentDeviceId || 'staff';
        data.updatedAt = Date.now();

        if (!data.cashKept && data.cashKept !== 0) {
            data.cashKept = countedTotal;
        }

        return DB.create('daily_balances', data, today);
    }).then(function() {
        // Hiển thị toast có nút tắt để nhân viên đọc kết quả
        showCloseableToast(
            '🔒 ĐÃ CHỐT NGÀY ' + formatDateDisplay(today) + '\n' +
            '📂 Đầu kỳ: ' + formatMoney(_posCashData ? _posCashData.openingBalance : 0) + '\n' +
            '💵 Đếm được: ' + formatMoney(countedTotal) + '\n' +
            '💰 QL nhận: ' + formatMoney(managerPickupTotal) + '\n' +
            '📐 Dự kiến: ' + formatMoney(expectedClosing) + '\n' +
            '📊 Chênh lệch: ' + (difference >= 0 ? '+' : '') + formatMoney(difference) + ' (' + diffPercent.toFixed(2) + '%)',
            'success'
        );

        // Gửi Telegram cho admin
        if (typeof sendTelegramMessage === 'function') {
            var icon = diffPercent <= 1 ? '✅' : '⚠️';
            var msg = icon + ' NHÂN VIÊN CHỐT NGÀY ' + formatDateDisplay(today) + '\n\n' +
                      '📂 Số dư đầu kỳ: ' + formatMoney(_posCashData ? _posCashData.openingBalance : 0) + '\n' +
                      '💵 Đếm được: ' + formatMoney(countedTotal) + '\n' +
                      '💰 QL nhận: ' + formatMoney(managerPickupTotal) + '\n' +
                      '📐 Dự kiến còn: ' + formatMoney(expectedClosing) + '\n' +
                      '📊 Chênh lệch: ' + (difference >= 0 ? '+' : '') + formatMoney(difference) + '\n' +
                      '📈 Tỷ lệ: ' + diffPercent.toFixed(2) + '%';
            sendTelegramMessage(msg);
        }

        loadPosCashData(); // Reload
    }).catch(function(err) {
        console.error('staffCloseDay error:', err);
        showToast('❌ Lỗi khi chốt ngày!', 'error');
    });
}

// ========== ADMIN: HỦY CHỐT NGÀY ==========
// Admin có thể hủy chốt để cho phép nhân viên chốt lại
function unlockDayClose() {
    if (!confirm('🔓 Xác nhận hủy chốt ngày hôm nay?\n\nSau khi hủy chốt:\n- Nhân viên có thể chốt lại\n- Hoàn tác/xóa món/xóa bàn sẽ yêu cầu mật khẩu (đã chốt)\n\nTiếp tục?')) return;

    var today = new Date().toISOString().slice(0, 10);

    DB.get('daily_balances', today).then(function(existing) {
        if (!existing) {
            showToast('❌ Không tìm thấy dữ liệu chốt ngày hôm nay', 'error');
            return;
        }

        var data = JSON.parse(JSON.stringify(existing));
        data.isClosed = false;
        data.closedAt = null;
        data.closedBy = null;
        data.updatedAt = Date.now();

        return DB.create('daily_balances', data, today);
    }).then(function() {
        showToast('🔓 Đã hủy chốt ngày hôm nay', 'success');

        // Gửi Telegram thông báo admin đã hủy chốt
        if (typeof sendTelegramMessage === 'function') {
            var msg = '🔓 QUẢN LÝ HỦY CHỐT NGÀY ' + formatDateDisplay(today) + '\n\n' +
                      'Nhân viên có thể chốt lại ngày hôm nay.';
            sendTelegramMessage(msg);
        }

        loadPosCashData(); // Reload
    }).catch(function(err) {
        console.error('unlockDayClose error:', err);
        showToast('❌ Lỗi khi hủy chốt!', 'error');
    });
}

// ========== TOAST CÓ NÚT TẮT ==========
function showCloseableToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'success') + ' toast-closeable';
    toast.style.cursor = 'default';

    var msgSpan = document.createElement('span');
    msgSpan.style.whiteSpace = 'pre-line';
    msgSpan.style.flex = '1';
    msgSpan.style.fontSize = '13px';
    msgSpan.style.lineHeight = '1.6';
    msgSpan.textContent = message;

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0 0 0 12px;opacity:0.8;flex-shrink:0;';
    closeBtn.onclick = function() {
        if (toast.parentNode) toast.remove();
    };

    toast.appendChild(msgSpan);
    toast.appendChild(closeBtn);
    document.getElementById('toastContainer').appendChild(toast);

    // Auto-dismiss sau 15 giây nếu không tắt
    setTimeout(function() {
        if (toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.5s';
            setTimeout(function() {
                if (toast.parentNode) toast.remove();
            }, 500);
        }
    }, 15000);
}

// ============================================================
// 2. CÀI ĐẶT ỨNG DỤNG (Settings)
// ============================================================

function initSettingsTab() {
    // Phân quyền hiển thị:
    // - Nhân viên: chỉ thấy "⚙️ Cài đặt ứng dụng" + "💬 Cài đặt Chat"
    // - Admin: thấy tất cả (Telegram, Thông tin quán, Phân quyền)
    var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
    var appSection = document.getElementById('settingsAppSection');
    var shopSection = document.getElementById('settingsShopSection');
    var telegramSection = document.getElementById('settingsTelegramSection');
    var permSection = document.getElementById('settingsPermissionSection');
    var chatSection = document.getElementById('settingsChatSection');

    // App section: staff thấy, admin ẩn (admin đã có các section khác)
    if (appSection) appSection.style.display = isAdmin ? 'none' : '';
    // Shop section: chỉ admin mới thấy
    if (shopSection) shopSection.style.display = isAdmin ? '' : 'none';
    // Telegram section: chỉ admin mới thấy
    if (telegramSection) telegramSection.style.display = isAdmin ? '' : 'none';
    // Permission section: chỉ admin mới thấy
    if (permSection) permSection.style.display = isAdmin ? '' : 'none';
    // Chat section: tất cả đều thấy (để bật/tắt âm thanh)
    if (chatSection) chatSection.style.display = '';

    // Load Telegram config nếu có
    var savedToken = localStorage.getItem('telegram_bot_token');
    var tokenInput = document.getElementById('telegramBotToken');
    if (tokenInput) tokenInput.value = savedToken || '';
    var savedChatId = localStorage.getItem('telegram_chat_id');
    var chatIdInput = document.getElementById('telegramChatId');
    if (chatIdInput) chatIdInput.value = savedChatId || '';
    var savedBotName = localStorage.getItem('telegram_bot_name');
    var botNameInput = document.getElementById('telegramBotName');
    if (botNameInput) botNameInput.value = savedBotName || '';

    // Load staff permission list (nếu là admin)
    if (isAdmin && typeof loadStaffPermissionList === 'function') {
        loadStaffPermissionList();
    }

    // Khởi tạo Đếm tiền nhanh
    if (typeof initQuickCashCounter === 'function') {
        initQuickCashCounter();
    }

    // Load token GitHub
    var savedGithubToken = localStorage.getItem('github_token');
    var githubTokenInput = document.getElementById('settingsGithubToken');
    if (githubTokenInput) {
        githubTokenInput.value = savedGithubToken || '';
    }

    // Load skipped version
    var skipped = localStorage.getItem('skip_version');
    var skippedEl = document.getElementById('settingsSkippedVersion');
    if (skippedEl) {
        skippedEl.textContent = skipped || 'Không có';
    }

    // Load version
    var versionEl = document.getElementById('settingsCurrentVersion');
    if (versionEl) {
        versionEl.textContent = window.APP_VERSION || '1.0.0';
    }

    // Load shop info
    if (typeof loadShopInfo === 'function') {
        loadShopInfo();
    }

    // Kiểm tra cập nhật
    if (typeof checkUpdateNow === 'function') {
        checkUpdateNow();
    }
}

function updateSettingsStatus(message, isError) {
    var statusEl = document.getElementById('settingsUpdateStatus');
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#dc2626' : '#16a34a';
}

function saveGitHubToken() {
    var input = document.getElementById('settingsGithubToken');
    if (!input) return;
    var token = input.value.trim();
    if (!token) {
        showToast('⚠️ Vui lòng nhập token', 'warning');
        return;
    }
    localStorage.setItem('github_token', token);
    showToast('✅ Đã lưu token', 'success');
}

function clearGitHubToken() {
    localStorage.removeItem('github_token');
    var input = document.getElementById('settingsGithubToken');
    if (input) input.value = '';
    showToast('🗑️ Đã xóa token', 'info');
}

function checkUpdateNow() {
    updateSettingsStatus('Đang kiểm tra...', false);
    var token = localStorage.getItem('github_token');
    if (!token) {
        updateSettingsStatus('⚠️ Chưa có token GitHub', true);
        return;
    }

    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://api.github.com/repos/cana2/posapp/releases/latest', true);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('Accept', 'application/vnd.github.v3+json');
    xhr.timeout = 15000;

    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                var data = JSON.parse(xhr.responseText);
                var latestVersion = (data.tag_name || 'v1.0.0').replace(/^v/, '');
                var currentVersion = window.APP_VERSION || '1.0.0';
                var skipped = localStorage.getItem('skip_version');

                if (compareVersions(latestVersion, currentVersion) > 0) {
                    if (skipped === latestVersion) {
                        updateSettingsStatus('📌 Phiên bản ' + latestVersion + ' đang bị bỏ qua', false);
                    } else {
                        updateSettingsStatus('🎉 Có phiên bản mới: v' + latestVersion, false);
                        showToast('🎉 Có phiên bản mới v' + latestVersion, 'info', 5000);
                    }
                } else {
                    updateSettingsStatus('✅ Đã là phiên bản mới nhất', false);
                }
            } catch (e) {
                updateSettingsStatus('❌ Lỗi phân tích phản hồi', true);
            }
        } else if (xhr.status === 401) {
            updateSettingsStatus('❌ Token không hợp lệ', true);
        } else if (xhr.status === 403) {
            updateSettingsStatus('❌ Đã vượt quá giới hạn API', true);
        } else {
            updateSettingsStatus('❌ Lỗi ' + xhr.status, true);
        }
    };

    xhr.onerror = function() {
        updateSettingsStatus('❌ Không thể kết nối', true);
    };

    xhr.ontimeout = function() {
        updateSettingsStatus('❌ Hết thời gian chờ', true);
    };

    xhr.send();
}

function clearSkipVersion() {
    localStorage.removeItem('skip_version');
    var skippedEl = document.getElementById('settingsSkippedVersion');
    if (skippedEl) skippedEl.textContent = 'Không có';
    showToast('🔄 Đã bỏ bỏ qua, kiểm tra lại...', 'info');
    checkUpdateNow();
}

function savePrinterIp() {
    var input = document.getElementById('settingsPrinterIp');
    if (!input) return;
    var ip = input.value.trim();
    if (!ip) {
        showToast('⚠️ Vui lòng nhập địa chỉ IP', 'warning');
        return;
    }
    localStorage.setItem('printer_ip', ip);
    showToast('✅ Đã lưu địa chỉ máy in', 'success');
}

function testPrint() {
    var ip = localStorage.getItem('printer_ip');
    if (!ip) {
        showToast('⚠️ Chưa có địa chỉ máy in', 'warning');
        return;
    }
    // Gửi lệnh in thử qua Android bridge
    if (window.AppBridge && typeof window.AppBridge.printTest === 'function') {
        window.AppBridge.printTest(ip);
    } else {
        showToast('📡 Đã gửi lệnh in thử đến ' + ip, 'info');
    }
}

function toggleTokenVisibility() {
    var input = document.getElementById('settingsGithubToken');
    var btn = document.getElementById('settingsToggleToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

// ============================================================
// 3. THÔNG TIN QUÁN (Shop Info)
// ============================================================

function loadShopInfo() {
    var nameEl = document.getElementById('shopInfoName');
    var addressEl = document.getElementById('shopInfoAddress');
    var phoneEl = document.getElementById('shopInfoPhone');
    if (!nameEl) return;

    if (window.shopInfo) {
        nameEl.value = window.shopInfo.name || '';
        addressEl.value = window.shopInfo.address || '';
        phoneEl.value = window.shopInfo.phone || '';
    } else {
        nameEl.value = '';
        addressEl.value = '';
        phoneEl.value = '';
    }
}

function saveShopInfo() {
    var name = document.getElementById('shopInfoName').value.trim();
    var address = document.getElementById('shopInfoAddress').value.trim();
    var phone = document.getElementById('shopInfoPhone').value.trim();

    if (!name) {
        showToast('⚠️ Vui lòng nhập tên quán', 'warning');
        return;
    }

    var data = {
        id: 'shop_info',
        name: name,
        address: address,
        phone: phone,
        updatedAt: new Date().toISOString()
    };

    DB.create('shop_info', data, 'shop_info').then(function() {
        window.shopInfo = data;
        showToast('✅ Đã lưu thông tin quán', 'success');
    }).catch(function(err) {
        console.error('Save shop info error:', err);
        showToast('❌ Lỗi lưu thông tin quán', 'error');
    });
}

function clearShopInfo() {
    if (!confirm('Xóa thông tin quán?')) return;
    DB.remove('shop_info', 'shop_info').then(function() {
        window.shopInfo = null;
        loadShopInfo();
        showToast('🗑️ Đã xóa thông tin quán', 'info');
    }).catch(function(err) {
        console.error('Clear shop info error:', err);
        showToast('❌ Lỗi xóa thông tin quán', 'error');
    });
}

// ============================================================
// 5. TELEGRAM CONFIG
// ============================================================

function toggleTelegramTokenVisibility() {
    var input = document.getElementById('telegramBotToken');
    var btn = document.getElementById('settingsToggleTelegramToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

function saveTelegramConfig() {
    var token = document.getElementById('telegramBotToken').value.trim();
    var chatId = document.getElementById('telegramChatId').value.trim();
    var botName = document.getElementById('telegramBotName').value.trim();

    if (!token || !chatId) {
        showToast('⚠️ Vui lòng nhập Bot Token và Chat ID', 'warning');
        return;
    }

    localStorage.setItem('telegram_bot_token', token);
    localStorage.setItem('telegram_chat_id', chatId);
    if (botName) {
        localStorage.setItem('telegram_bot_name', botName);
    }

    // Cập nhật biến global trong telegram.js nếu có
    if (typeof window.TELEGRAM_BOT_TOKEN !== 'undefined') {
        window.TELEGRAM_BOT_TOKEN = token;
    }
    if (typeof window.TELEGRAM_CHAT_ID !== 'undefined') {
        window.TELEGRAM_CHAT_ID = chatId;
    }

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '✅ Đã lưu cấu hình Telegram';
    showToast('✅ Đã lưu cấu hình Telegram', 'success');
}

function testTelegramConfig() {
    var token = localStorage.getItem('telegram_bot_token');
    var chatId = localStorage.getItem('telegram_chat_id');
    if (!token || !chatId) {
        showToast('⚠️ Chưa có cấu hình Telegram', 'warning');
        return;
    }

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '📨 Đang gửi tin nhắn thử...';

    var message = encodeURIComponent('🟢 *Tin nhắn thử từ POS* \n\nNếu bạn thấy tin nhắn này, cấu hình Telegram đã hoạt động!');
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage?chat_id=' + chatId + '&text=' + message + '&parse_mode=Markdown';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 10000;

    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            if (statusEl) statusEl.textContent = '✅ Gửi thử thành công!';
            showToast('✅ Gửi tin nhắn thử thành công', 'success');
        } else {
            if (statusEl) statusEl.textContent = '❌ Lỗi: ' + xhr.status;
            showToast('❌ Gửi thử thất bại (HTTP ' + xhr.status + ')', 'error');
        }
    };

    xhr.onerror = function() {
        if (statusEl) statusEl.textContent = '❌ Không thể kết nối Telegram';
        showToast('❌ Không thể kết nối Telegram API', 'error');
    };

    xhr.ontimeout = function() {
        if (statusEl) statusEl.textContent = '❌ Hết thời gian chờ';
        showToast('❌ Hết thời gian chờ kết nối Telegram', 'error');
    };

    xhr.send();
}

function clearTelegramConfig() {
    if (!confirm('Xóa cấu hình Telegram?')) return;
    localStorage.removeItem('telegram_bot_token');
    localStorage.removeItem('telegram_chat_id');
    localStorage.removeItem('telegram_bot_name');

    document.getElementById('telegramBotToken').value = '';
    document.getElementById('telegramChatId').value = '';
    document.getElementById('telegramBotName').value = '';

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '🗑️ Đã xóa cấu hình Telegram';
    showToast('🗑️ Đã xóa cấu hình Telegram', 'info');
}

// ============================================================
// 6. PHÂN QUYỀN NHÂN VIÊN (Staff Permission)
// ============================================================

function loadStaffPermissionList() {
    var listEl = document.getElementById('staffPermissionList');
    if (!listEl) return;

    listEl.innerHTML = '<div class="permission-loading">Đang tải...</div>';

    if (typeof DB === 'undefined' || typeof DB.getStaffs !== 'function') {
        listEl.innerHTML = '<div class="permission-loading">⚠️ Chưa sẵn sàng</div>';
        return;
    }

    // Ưu tiên đọc từ local cache trước, sau đó mới fetch từ Firebase
    var localPromise = (typeof DB.getAll === 'function') ? DB.getAll('staffs') : Promise.resolve(null);
    var fbPromise = DB.getStaffs();
    Promise.all([localPromise, fbPromise]).then(function(results) {
        var staffs = results[1] || results[0] || [];
        if (!staffs || staffs.length === 0) {
            listEl.innerHTML = '<div class="permission-loading">Chưa có nhân viên nào</div>';
            return;
        }

        var currentUser = DB.getCurrentUser();
        var currentUserId = currentUser ? currentUser.id : null;

        var html = '';
        for (var i = 0; i < staffs.length; i++) {
            var staff = staffs[i];
            if (!staff) continue;

            var name = staff.displayName || staff.username || staff.id || 'Unknown';
            var username = staff.username || '';
            var role = staff.role || 'staff';
            var isSelf = staff.id === currentUserId;

            var roleClass = isSelf ? 'self' : role;
            var roleLabel = isSelf ? '👤 Chính bạn' : (role === 'admin' ? '🔑 Admin' : '👤 Staff');

            html += '<div class="permission-staff-item" onclick="' + (isSelf ? '' : 'toggleStaffRole(\'' + escapeJsString(staff.id) + '\', \'' + escapeJsString(role) + '\')') + '">' +
                '<div class="permission-staff-info">' +
                '<span class="permission-staff-name">' + escapeHtml(name) + '</span>' +
                (username ? '<span class="permission-staff-username">@' + escapeHtml(username) + '</span>' : '') +
                '</div>' +
                '<span class="permission-staff-role ' + roleClass + '">' + roleLabel + '</span>' +
                '</div>';
        }

        listEl.innerHTML = html;
    }).catch(function(err) {
        listEl.innerHTML = '<div class="permission-loading">❌ Lỗi tải danh sách</div>';
        console.error('loadStaffPermissionList error:', err);
    });
}

function toggleStaffRole(staffId, currentRole) {
    if (!staffId) return;

    var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
    if (!isAdmin) {
        showToast('⚠️ Chỉ admin mới có thể thay đổi quyền', 'warning');
        return;
    }

    var newRole = (currentRole === 'admin') ? 'staff' : 'admin';
    var confirmMsg = (newRole === 'admin')
        ? 'Bạn có chắc muốn nâng cấp nhân viên này lên Admin?'
        : 'Bạn có chắc muốn hạ quyền nhân viên này xuống Staff?';

    if (!confirm(confirmMsg)) return;

    DB.update('staffs', staffId, { role: newRole }).then(function() {
        showToast('✅ Đã thay đổi quyền thành ' + (newRole === 'admin' ? 'Admin' : 'Staff'), 'success');
        loadStaffPermissionList();
    }).catch(function(err) {
        console.error('toggleStaffRole error:', err);
        showToast('❌ Lỗi thay đổi quyền', 'error');
    });
}

function createNewStaff() {
    var username = document.getElementById('newStaffUsername').value.trim();
    var password = document.getElementById('newStaffPassword').value.trim();

    if (!username || !password) {
        showToast('⚠️ Vui lòng nhập tên đăng nhập và mật khẩu', 'warning');
        return;
    }

    if (password.length < 4) {
        showToast('⚠️ Mật khẩu phải có ít nhất 4 ký tự', 'warning');
        return;
    }

    if (typeof DB === 'undefined' || typeof DB.createStaff !== 'function') {
        showToast('⚠️ Chưa sẵn sàng', 'warning');
        return;
    }

    var statusEl = document.getElementById('staffPermissionStatus');
    if (statusEl) statusEl.textContent = 'Đang tạo...';

    DB.createStaff({
        username: username,
        password: password,
        role: 'staff',
        displayName: username
    }).then(function() {
        document.getElementById('newStaffUsername').value = '';
        document.getElementById('newStaffPassword').value = '';
        if (statusEl) statusEl.textContent = '✅ Đã tạo nhân viên ' + username;
        showToast('✅ Đã tạo nhân viên ' + username, 'success');
        loadStaffPermissionList();
    }).catch(function(err) {
        console.error('createNewStaff error:', err);
        if (statusEl) statusEl.textContent = '❌ Lỗi: ' + (err.message || 'Không thể tạo');
        showToast('❌ Lỗi tạo nhân viên', 'error');
    });
}

// ============================================================
// 7. ESCAPE HELPER
// ============================================================

function escapeJsString(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'")
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&')
              .replace(/</g, '<')
              .replace(/>/g, '>')
              .replace(/"/g, '"')
              .replace(/'/g, '&#039;');
}

// ============================================================
// 4. SO SÁNH PHIÊN BẢN (Version Compare)
// ============================================================

function compareVersions(v1, v2) {
    var parts1 = v1.split('.').map(Number);
    var parts2 = v2.split('.').map(Number);
    for (var i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        var n1 = parts1[i] || 0;
        var n2 = parts2[i] || 0;
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
    }
    return 0;
}
