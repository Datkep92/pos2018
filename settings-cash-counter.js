// settings-cash-counter.js - Cash counter + đối soát
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js
// Biến CASH_DENOMS, cashCounts, _posCashData được định nghĩa trong settings-core.js

// 1. TIỀN MẶT TẠI POS (Cash Counter + Đối soát quỹ)
// ============================================================

// === Lưu/Khôi phục số đếm tiền mặt vào localStorage (tránh mất khi chuyển tab) ===
function _getCashCountStorageKey() {
    var today = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
    return 'pos_cash_counts_' + today;
}

function _saveCashCountsToLocal() {
    try {
        var key = _getCashCountStorageKey();
        var data = {};
        for (var i = 0; i < CASH_DENOMS.length; i++) {
            var v = CASH_DENOMS[i].value;
            if (cashCounts[v] > 0) {
                data[v] = cashCounts[v];
            }
        }
        localStorage.setItem(key, JSON.stringify(data));
    } catch(e) {}
}

function _loadCashCountsFromLocal() {
    try {
        var key = _getCashCountStorageKey();
        var saved = localStorage.getItem(key);
        if (saved) {
            var data = JSON.parse(saved);
            for (var i = 0; i < CASH_DENOMS.length; i++) {
                var v = CASH_DENOMS[i].value;
                if (data[v] !== undefined) {
                    cashCounts[v] = data[v];
                }
            }
        }
    } catch(e) {}
}

// Gọi khôi phục ngay khi load
_loadCashCountsFromLocal();
// _selectedCloseDate, getTodayDateKey được định nghĩa trong settings-core.js

function initQuickCashCounter() {
    cashCounts = {};
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        cashCounts[CASH_DENOMS[i].value] = 0;
    }
    // Khôi phục số đếm đã lưu trong localStorage (nếu có)
    _loadCashCountsFromLocal();
    _posCashData = null;
    _selectedCloseDate = null;
    loadPosCashData();

    // Subscribe realtime vào daily_balances hôm nay để cập nhật _dayClosedCache
    // Khi admin hủy chốt từ thiết bị khác, nhân viên sẽ thấy ngay
    _subscribeDayClosedRealtime();

}

// Lắng nghe realtime thay đổi daily_balances (chốt ngày, chênh lệch, hủy chốt...)
function _subscribeDayClosedRealtime() {
    try {
        var today = getTodayDateKey();
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var dbRef = firebase.database().ref(shopId);

        // 1. Lắng nghe thay đổi trên daily_balances hôm nay
        // Khi nhân viên A chốt ngày (ghi difference + isClosed lên Firebase),
        // nhân viên B và admin sẽ nhận được cập nhật realtime và reload UI
        dbRef.child('daily_balances/' + today).on('value', function(snapshot) {
            var data = snapshot.val();
            if (data) {
                var newIsClosed = data.isClosed === true;
                // Luôn cập nhật cache isClosed
                _dayClosedCache = newIsClosed;
                // Chỉ reload nếu không đang xem ngày khác (không có _selectedCloseDate)
                // Tránh reset về ngày hôm nay khi đang xem ngày trước đó
                if (!_selectedCloseDate) {
                    loadPosCashData();
                }
            }
        });

        // 2. Lắng nghe thay đổi trên manager_cash_pickups (Tiền QL nhận)
        // Khi admin nhập pickup ở máy A, máy B đang mở tab Settings tự động cập nhật
        dbRef.child('manager_cash_pickups').on('value', function(snapshot) {
            var data = snapshot.val();
            if (data) {
                // Chỉ reload nếu không đang xem ngày khác
                if (!_selectedCloseDate) {
                    loadPosCashData();
                }
            }
        });
    } catch (e) {
    }
}

// Cache cho cost_transactions và manager_cash_pickups để tránh tải lại từ Firebase mỗi lần
var _posCashCache = {
    costTransactions: null,   // { data: array, timestamp: number, dateKey: string }
    managerPickups: null,     // { data: array, timestamp: number, dateKey: string }
    lastFullReload: 0         // timestamp của lần reload đầy đủ cuối cùng
};
var _POS_CACHE_TTL = 30000; // 30 giây

function loadPosCashData(targetDate) {
    try {
    // FIX: Dùng hàm getTodayDateKey() để lấy ngày theo giờ Việt Nam (UTC+7), tránh lỗi timezone
    var today = targetDate || getTodayDateKey();
    var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
    var now = Date.now();

    // Lấy ngày hôm trước để tính số dư đầu kỳ
    // FIX: Dùng Date.UTC để tránh lỗi timezone (toISOString trả về UTC, trong khi setDate tính theo local time)
    var prevDate = new Date(Date.UTC(
        parseInt(today.split('-')[0], 10),
        parseInt(today.split('-')[1], 10) - 1,
        parseInt(today.split('-')[2], 10)
    ));
    prevDate.setDate(prevDate.getDate() - 1);
    var prevDateStr = prevDate.toISOString().slice(0, 10);


    // Lấy shopId từ DB
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var dbRef = firebase.database().ref(shopId);

    // Kiểm tra cache cho cost_transactions và manager_cash_pickups
    // Chỉ dùng cache nếu: có dữ liệu, chưa hết hạn, và cùng dateKey
    var useCostCache = _posCashCache.costTransactions &&
        _posCashCache.costTransactions.dateKey === today &&
        (now - _posCashCache.costTransactions.timestamp) < _POS_CACHE_TTL;
    var usePickupCache = _posCashCache.managerPickups &&
        _posCashCache.managerPickups.dateKey === today &&
        (now - _posCashCache.managerPickups.timestamp) < _POS_CACHE_TTL;

    // Xây dựng mảng promises dựa trên cache
    var promises = [
        // Số dư đầu kỳ = cashKept của ngày hôm trước
        dbRef.child('daily_balances/' + prevDateStr).once('value'),
        // Doanh thu tiền mặt trong ngày (từ IndexedDB - transactions đã được subscribe)
        DB.getTransactionsByDate(today),
        // daily_balances của ngày target (đã lưu) - đọc trực tiếp từ Firebase
        dbRef.child('daily_balances/' + today).once('value'),
        // Bàn đang hoạt động
        DB.getAll('tables')
    ];

    // Chỉ fetch cost_transactions từ Firebase nếu cache không có hoặc hết hạn
    if (!useCostCache) {
        promises.push(dbRef.child('cost_transactions').once('value'));
    } else {
        promises.push(Promise.resolve(null)); // placeholder, sẽ dùng cache
    }

    // Chỉ fetch manager_cash_pickups từ Firebase nếu cache không có hoặc hết hạn
    if (!usePickupCache) {
        promises.push(dbRef.child('manager_cash_pickups').once('value'));
    } else {
        promises.push(Promise.resolve(null)); // placeholder, sẽ dùng cache
    }

    Promise.all(promises).then(function(results) {
        var prevBalance = results[0].val() || {};
        var transactions = results[1] || [];
        var savedBalance = results[2].val() || {};
        var allTables = results[3] || [];

        // Xử lý cost_transactions: từ cache hoặc từ Firebase
        var allCosts;
        if (useCostCache) {
            allCosts = _posCashCache.costTransactions.data;
        } else {
            var allCostsSnapshot = results[4].val() || {};
            allCosts = [];
            for (var key in allCostsSnapshot) {
                if (allCostsSnapshot.hasOwnProperty(key)) {
                    var item = allCostsSnapshot[key];
                    item.id = key;
                    allCosts.push(item);
                }
            }
            // Lưu vào cache
            _posCashCache.costTransactions = {
                data: allCosts,
                timestamp: now,
                dateKey: today
            };
        }

        // Xử lý manager_cash_pickups: từ cache hoặc từ Firebase
        var pickups;
        if (usePickupCache) {
            pickups = _posCashCache.managerPickups.data;
        } else {
            var pickupsSnapshot = results[5].val() || {};
            pickups = [];
            for (var key2 in pickupsSnapshot) {
                if (pickupsSnapshot.hasOwnProperty(key2)) {
                    var item2 = pickupsSnapshot[key2];
                    item2.id = key2;
                    pickups.push(item2);
                }
            }
            // Lưu vào cache
            _posCashCache.managerPickups = {
                data: pickups,
                timestamp: now,
                dateKey: today
            };
        }

        // Lọc transactions không bị refund
        if (Array.isArray(transactions)) {
            transactions = transactions.filter(function(t) { return !t.refunded; });
        } else {
            transactions = [];
        }


        // Số dư đầu kỳ
        var openingBalance = (prevBalance && prevBalance.cashKept) || 0;
        // Thống kê doanh thu theo phương thức thanh toán
        var totalRevenue = 0;
        var totalCount = 0;
        var cashCount = 0, cashRevenue = 0;
        var transferCount = 0, transferAmount = 0;
        var grabCount = 0, grabAmount = 0;
        var debtCount = 0, debtAmount = 0;
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            var amt = tx.amount || 0;
            if (tx.paymentMethod === 'debt') {
                debtCount++;
                debtAmount += amt;
            } else if (tx.paymentMethod === 'cash' || tx.paymentMethod === 'transfer' || tx.paymentMethod === 'grab') {
                totalCount++;
                totalRevenue += amt;
                if (tx.paymentMethod === 'cash') {
                    cashCount++;
                    cashRevenue += amt;
                } else if (tx.paymentMethod === 'transfer') {
                    transferCount++;
                    transferAmount += amt;
                } else if (tx.paymentMethod === 'grab') {
                    grabCount++;
                    grabAmount += amt;
                }
            }
            // Các phương thức thanh toán không xác định khác: bỏ qua, không tính vào tổng doanh thu
        }

        // Chi phí từ Két POS
        var posCashExpense = 0;
        var posCostCount = 0;
        for (var j = 0; j < allCosts.length; j++) {
            var c = allCosts[j];
            if (c.dateKey === today && !c.deleted && c.fundSource === 'pos_cash') {
                posCashExpense += c.amount;
                posCostCount++;
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

        // expectedClosing = số tiền dự kiến phải có trong két SAU KHI trừ QL nhận
        // Nếu đã lưu đối soát trước đó thì ưu tiên dùng expectedClosing đã lưu (tránh sai lệch khi F5)
        var expectedClosing;
        if (savedBalance && savedBalance.expectedClosing !== undefined && savedBalance.expectedClosing !== null) {
            expectedClosing = savedBalance.expectedClosing;
        } else {
            expectedClosing = openingBalance + cashRevenue - posCashExpense - managerPickupTotal;
        }


        // Bàn đang hoạt động
        var activeTables = allTables.filter(function(t) { return (t.items && t.items.length) || t.total > 0; });
        var activeTableTotal = 0;
        for (var ti = 0; ti < activeTables.length; ti++) {
            activeTableTotal += activeTables[ti].total || 0;
        }

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
            cashKept: (savedBalance.cashKept !== undefined && savedBalance.cashKept !== null) ? savedBalance.cashKept : null,
            difference: (savedBalance.difference !== undefined && savedBalance.difference !== null) ? savedBalance.difference : null,
            diffPercent: (savedBalance.diffPercent !== undefined && savedBalance.diffPercent !== null) ? savedBalance.diffPercent : null,
            status: savedBalance.status || null,
            closedAtTime: savedBalance.closedAtTime || null,
            // Thống kê doanh thu theo phương thức
            totalRevenue: totalRevenue,
            totalCount: totalCount,
            cashCount: cashCount,
            transferCount: transferCount,
            transferAmount: transferAmount,
            grabCount: grabCount,
            grabAmount: grabAmount,
            debtCount: debtCount,
            debtAmount: debtAmount,
            // Chi phí
            posCostList: allCosts,
            // Bàn đang hoạt động
            activeTables: activeTables,
            activeTableTotal: activeTableTotal,
            dateKey: today
        };

        // Cập nhật timestamp full reload
        _posCashCache.lastFullReload = now;

        // Tự động lưu cashRevenue, posCashExpense, managerPickupTotal xuống Firebase
        // để các lần sau có dữ liệu tính expectedClosing (phục vụ fixOldCashKeptData)
        // KHÔNG lưu openingBalance vì openingBalance phụ thuộc vào cashKept ngày trước
        // (có thể bị sai nếu dữ liệu cũ chưa được sửa)
        // Chỉ lưu nếu ngày này đã chốt (đã có dữ liệu trong daily_balances)
        if (savedBalance && savedBalance.isClosed) {
            var updateData = {};
            var needUpdate = false;
            // Chỉ lưu cashRevenue, posCashExpense, managerPickupTotal
            // (các field này được tính độc lập, ko phụ thuộc vào dữ liệu ngày trước)
            if (savedBalance.cashRevenue === undefined || savedBalance.cashRevenue === null) {
                updateData.cashRevenue = cashRevenue;
                needUpdate = true;
            }
            if (savedBalance.posCashExpense === undefined || savedBalance.posCashExpense === null) {
                updateData.posCashExpense = posCashExpense;
                needUpdate = true;
            }
            if (savedBalance.managerPickupTotal === undefined || savedBalance.managerPickupTotal === null) {
                updateData.managerPickupTotal = managerPickupTotal;
                needUpdate = true;
            }
            if (needUpdate) {
                updateData.updatedAt = Date.now();
                dbRef.child('daily_balances/' + today).update(updateData).catch(function(err) {});
            }
        }

        // Cập nhật cache isDayClosed để các module khác (refund, xóa món, xóa bàn) kiểm tra
        // CHỈ cập nhật cache nếu đang xem ngày hôm nay (không phải ngày trước đó)
        if (!targetDate) {
            _updateDayClosedCache();
        }

        renderCashCounter(isAdmin);
    }).catch(function(err) {
        renderCashCounter(isAdmin);
    });
    } catch(e) {
        renderCashCounter(isAdmin);
    }
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
        isClosed: false, cashKept: null, difference: null, diffPercent: null, status: null,
        totalRevenue: 0, totalCount: 0, cashCount: 0,
        transferCount: 0, transferAmount: 0,
        grabCount: 0, grabAmount: 0,
        debtCount: 0, debtAmount: 0,
        activeTables: [], activeTableTotal: 0
    };

    // expectedClosing đã trừ QL nhận, nên chênh lệch = đếm được - dự kiến còn
    var liveDiff = countedTotal - data.expectedClosing;
    var liveDiffClass = liveDiff >= 0 ? 'pos-cash-positive' : 'pos-cash-negative';

    // Số tiền tại POS hiện tại = expectedClosing (đã trừ QL nhận)
    // Khi đã đếm: lấy countedTotal
    var currentPosCash = data.expectedClosing;
    var actualPosCash = countedTotal > 0 ? countedTotal : currentPosCash;
    if (actualPosCash < 0) actualPosCash = 0;

    var html = '';
    html += '<div class="cash-counter">';

    // ===== HEADER =====
    var displayDate = data.dateKey || getTodayDateKey();
    var todayStr = getTodayDateKey();
    var isToday = (displayDate === todayStr);
    var minDate = '2020-01-01';
    html += '  <div class="cash-counter-header">';
    html += '    <span class="cash-counter-title">💰 Tiền mặt tại POS</span>';
    if (data.isClosed) {
        html += '    <span class="cash-closed-badge">🔒 Đã chốt</span>';
    }
    if (!isToday && !data.isClosed) {
        html += '    <span style="font-size:11px;color:#e67e22;background:#fef3e2;padding:2px 6px;border-radius:4px;margin-left:6px;">⚠️ Chưa chốt</span>';
    }
    if (!isToday) {
        html += '    <button class="cash-action-btn" style="padding:4px 8px;font-size:11px;margin-left:auto;" onclick="selectCloseDate(\'' + todayStr + '\')">📅 Hôm nay</button>';
    }
    html += '  </div>';
    // Date selector: ◀ Ngày ▶
    html += '  <div class="pos-cash-date-selector" style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:#f8f9fa;border-radius:8px;margin-bottom:8px;">';
    html += '    <button class="cash-action-btn" style="padding:6px 10px;font-size:14px;line-height:1;" onclick="changeCloseDate(-1)" ' + (displayDate <= minDate ? 'disabled' : '') + '>◀</button>';
    html += '    <span style="flex:1;text-align:center;font-size:14px;font-weight:600;color:#2c3e50;">' + formatDateDisplay(displayDate) + '</span>';
    html += '    <button class="cash-action-btn" style="padding:6px 10px;font-size:14px;line-height:1;" onclick="changeCloseDate(1)" ' + (isToday ? 'disabled' : '') + '>▶</button>';
    html += '  </div>';

    // ===== THÔNG TIN ĐỐI SOÁT (chỉ Quản lý mới thấy) =====
    if (isAdmin) {
        html += '  <div class="pos-cash-info">';

        // Layout 2 cột flex - dùng flex:1 1 0 để 2 cột luôn bằng nhau, dàn đều 2 bên
        html += '    <div style="display:flex;gap:12px;flex-wrap:wrap;">';

        // ===== CỘT 1: DOANH THU =====
        html += '      <div style="flex:1 1 0;min-width:180px;">';
        html += '        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px;">📈 Doanh thu</div>';
        html += '        <div class="pos-cash-row" style="border-bottom:1px dashed #e2e8f0;padding-bottom:4px;margin-bottom:4px;"><span style="font-weight:600;">📊 Tổng doanh thu</span><span style="font-weight:600;">' + data.totalCount + ' đơn - ' + formatMoney(data.totalRevenue) + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showCashDetailModal()"><span>💵 Tiền mặt</span><span>' + data.cashCount + ' đơn - ' + formatMoney(data.cashRevenue) + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showTransferDetailModal()"><span>💳 Chuyển khoản</span><span>' + data.transferCount + ' đơn - ' + formatMoney(data.transferAmount) + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showGrabDetailModal()"><span>🛵 Grab</span><span>' + data.grabCount + ' đơn - ' + formatMoney(data.grabAmount) + '</span></div>';
        if (data.debtCount > 0) {
            html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showDebtDetailModal()"><span>📝 Nợ trong ngày</span><span>' + data.debtCount + ' đơn - ' + formatMoney(data.debtAmount) + '</span></div>';
        }
        html += '      </div>';

        // ===== CỘT 2: THÔNG TIN =====
        html += '      <div style="flex:1 1 0;min-width:180px;">';
        html += '        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px;">📋 Thông tin</div>';
html += '        <div class="pos-cash-row" style="cursor:pointer;" onclick="showActiveTablesModal()"><span>🪑 Bàn đang hoạt động</span><span style="color:#ca8a04;font-weight:600;">' + formatMoney(data.activeTableTotal) + '</span></div>';        html += '        <div class="pos-cash-row"><span>📂 Số dư đầu kỳ</span><span>' + formatMoney(data.openingBalance) + '</span></div>';
        html += '        <div class="pos-cash-row" style="cursor:pointer;" onclick="showPosCostDetailModal()"><span>🏦 Chi phí Két POS</span><span>' + data.posCostCount + ' khoản - ' + formatMoney(data.posCashExpense) + '</span></div>';
        html += '        <div class="pos-cash-row"><span>💰 QL nhận</span><span>' + formatMoney(data.managerPickupTotal) + '</span></div>';
        html += '        <div class="pos-cash-row pos-cash-formula" style="border-top:1px dashed #e2e8f0;padding-top:4px;margin-top:4px;">';
        html += '          <span>📐 Dự kiến còn:</span>';
        html += '          <span class="pos-cash-expected" id="posCashExpected">' + formatMoney(data.expectedClosing) + '</span>';
        html += '        </div>';
        var adminPosCashDisplay = countedTotal > 0 ? countedTotal : data.expectedClosing;
        html += '        <div class="pos-cash-row">';
        html += '          <span>💵 Số tiền tại POS hiện tại:</span>';
        html += '          <span class="' + (adminPosCashDisplay >= 0 ? 'pos-cash-positive' : 'pos-cash-negative') + '" id="adminPosCashValue">' + formatMoney(adminPosCashDisplay) + '</span>';
        html += '        </div>';
        var displayDiff = data.difference !== null && data.difference !== undefined ? data.difference : liveDiff;
        var diffSuffix = data.isClosed ? ' (đã chốt)' : '';
        var diffPercent = 0;
        var baseForPercent = data.expectedClosing || data.openingBalance || 1;
        if (baseForPercent > 0) {
            diffPercent = Math.round(displayDiff / baseForPercent * 10000) / 100;
        }
        var isWithinLimit = Math.abs(diffPercent) <= 1;
        var displayDiffClass = displayDiff < 0 ? 'pos-cash-negative' : (displayDiff > 0 ? 'pos-cash-warning' : 'pos-cash-positive');
        html += '        <div class="pos-cash-row pos-cash-diff" id="posCashDiffRow" style="border-top:1px dashed #e2e8f0;padding-top:4px;margin-top:4px;">';
        html += '          <span>📋 Chênh lệch:</span>';
        html += '          <span class="' + displayDiffClass + '" id="posCashDiffValue">' + (displayDiff >= 0 ? '+' : '') + formatMoney(displayDiff) + ' (' + (displayDiff >= 0 ? '+' : '') + diffPercent + '%)' + diffSuffix + '</span>';
        if (!isWithinLimit && displayDiff > 0) {
            html += '          <span class="pos-cash-warning" style="margin-left:8px;font-size:11px;">⚠️ Dư >1% - Kiểm tra lại!</span>';
        } else if (!isWithinLimit && displayDiff < 0) {
            html += '          <span class="pos-cash-negative" style="margin-left:8px;font-size:11px;">🔴 Thiếu >1% - Cần rà soát!</span>';
        }
        html += '        </div>';
        html += '      </div>';

        html += '    </div>'; // end flex row

        // ===== PHẦN CHỐT CA (full width, chỉ hiển thị khi đã chốt) =====
        if (data.isClosed) {
            html += '    <div style="margin-top:8px;border-top:2px solid #2ecc71;padding-top:8px;">';
            var closedCashDisplay = (data.cashKept !== null && data.cashKept !== undefined) ? data.cashKept : data.expectedClosing;
            html += '    <div class="pos-cash-row">';
            html += '      <span style="font-weight:700;color:#27ae60;">💰 Số tiền quỹ POS thực tế sau chốt:</span>';
            html += '      <span style="font-weight:700;color:#27ae60;font-size:16px;">' + formatMoney(closedCashDisplay) + '</span>';
            html += '    </div>';
            if (data.closedAtTime) {
                html += '    <div class="pos-cash-row">';
                html += '      <span>🕐 Chốt lúc:</span>';
                html += '      <span style="font-weight:600;color:#2c3e50;">' + data.closedAtTime + '</span>';
                html += '    </div>';
            }
            html += '    </div>';
        }

        // ===== QUỸ THƯỞNG TRÁCH NHIỆM (admin) =====
        html += '    <div id="fundInfoInCashCounter"></div>';

        html += '  </div>';
    }

    // ===== HIỂN THỊ THÔNG TIN CHO NHÂN VIÊN =====
    if (!isAdmin) {
        html += '  <div class="pos-cash-staff-result">';

        // Layout 2 cột ngang
        html += '    <div style="display:flex;gap:12px;flex-wrap:wrap;">';

        // ===== CỘT 1: DOANH THU =====
        html += '      <div style="flex:1;min-width:180px;">';
        html += '        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px;">📈 Doanh thu</div>';
        html += '        <div class="pos-cash-row" style="border-bottom:1px dashed #e2e8f0;padding-bottom:4px;margin-bottom:4px;"><span style="font-weight:600;">📊 Tổng doanh thu</span><span style="font-weight:600;">' + data.totalCount + ' đơn' + (data.isClosed ? ' - ' + formatMoney(data.totalRevenue) : '') + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showCashDetailModal()"><span>💵 Tiền mặt</span><span>' + data.cashCount + ' đơn' + (data.isClosed ? ' - ' + formatMoney(data.cashRevenue) : '') + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showTransferDetailModal()"><span>💳 Chuyển khoản</span><span>' + data.transferCount + ' đơn' + (data.isClosed ? ' - ' + formatMoney(data.transferAmount) : '') + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showGrabDetailModal()"><span>🛵 Grab</span><span>' + data.grabCount + ' đơn' + (data.isClosed ? ' - ' + formatMoney(data.grabAmount) : '') + '</span></div>';
        if (data.debtCount > 0) {
            html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showDebtDetailModal()"><span>📝 Nợ trong ngày</span><span>' + data.debtCount + ' đơn - ' + formatMoney(data.debtAmount) + '</span></div>';
        }
        html += '      </div>';

        // ===== CỘT 2: THÔNG TIN KHÁC =====
        html += '      <div style="flex:1;min-width:180px;">';
        html += '        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px;">📋 Thông tin</div>';
        html += '        <div class="pos-cash-row" style="cursor:pointer;" onclick="showActiveTablesModal()"><span>🪑 Bàn đang hoạt động</span><span>' + formatMoney(data.activeTableTotal) + '</span></div>';
        html += '        <div class="pos-cash-row"><span>📂 Số dư đầu kỳ</span><span>' + formatMoney(data.openingBalance) + '</span></div>';
        html += '        <div class="pos-cash-row" style="cursor:pointer;" onclick="showPosCostDetailModal()"><span>🏦 Chi phí Két POS</span><span>' + data.posCostCount + ' khoản - ' + formatMoney(data.posCashExpense) + '</span></div>';
        html += '        <div class="pos-cash-row"><span>💰 QL nhận</span><span>' + formatMoney(data.managerPickupTotal) + '</span></div>';

        // 💵 Tổng số tiền đếm được - hiển thị khi nhân viên đã nhập mệnh giá (countedTotal > 0)
        // Khi chưa nhập mệnh giá: ẩn hoàn toàn, không hiển thị số dự kiến
        if (countedTotal > 0) {
            html += '        <div class="pos-cash-row" style="border-top:1px dashed #e2e8f0;padding-top:4px;margin-top:4px;">';
            html += '          <span>🔢 Tổng số tiền đếm được:</span>';
            html += '          <span class="pos-cash-positive" style="font-weight:700;font-size:15px;" id="staffPosCashValue">' + formatMoney(countedTotal) + '</span>';
            html += '        </div>';
        }
        html += '      </div>';

        html += '    </div>'; // end flex row

        // Chỉ hiển thị dự kiến còn, chênh lệch SAU KHI đã chốt ngày
        if (data.isClosed) {
            html += '    <div style="margin-top:8px;border-top:1px solid #e2e8f0;padding-top:8px;">';
            // 💵 Doanh thu tiền mặt
            html += '    <div class="pos-cash-row"><span>💵 Doanh thu tiền mặt</span><span>' + formatMoney(data.cashRevenue) + '</span></div>';

            // 💵 Số tiền tại POS hiện tại
            var staffPosDisplay = countedTotal > 0 ? countedTotal : data.expectedClosing;
            html += '    <div class="pos-cash-row">';
            html += '      <span>💵 Số tiền tại POS hiện tại:</span>';
            html += '      <span class="' + (staffPosDisplay >= 0 ? 'pos-cash-positive' : 'pos-cash-negative') + '" id="adminPosCashValue">' + formatMoney(staffPosDisplay) + '</span>';
            html += '    </div>';

            // 📐 Dự kiến còn
            var expectedClosing = (data.openingBalance || 0) + (data.cashRevenue || 0) - (data.posCashExpense || 0) - (data.managerPickupTotal || 0);
            html += '    <div class="pos-cash-row" style="border-top:1px dashed #ddd;padding-top:6px;">';
            html += '      <span>📐 Dự kiến còn:</span>';
            html += '      <span style="font-weight:600;color:#2c3e50;" id="staffExpectedClosing">' + formatMoney(expectedClosing) + '</span>';
            html += '    </div>';

            // 📊 Chênh lệch - dùng data.difference từ Firebase (do nhân viên A đã chốt ghi lên)
            var savedDiff = (data.difference !== null && data.difference !== undefined) ? data.difference : null;
            if (savedDiff !== null) {
                var baseForPct = expectedClosing || data.openingBalance || 1;
                var diffPct = Math.round(savedDiff / baseForPct * 10000) / 100;
                var isWithinLimit = Math.abs(diffPct) <= 1;

                if (savedDiff > 0) {
                    html += '    <div class="pos-cash-row pos-cash-diff" id="staffDiffRow">';
                    html += '      <span>📊 Chênh lệch thực tế:</span>';
                    html += '      <span class="pos-cash-warning" id="staffDiffValue">+' + formatMoney(savedDiff) + ' (+' + diffPct + '%) (đã chốt)</span>';
                    html += '    </div>';
                    if (!isWithinLimit) {
                        html += '    <div class="pos-cash-row" style="margin-top:4px;">';
                        html += '      <span style="color:#e67e22;font-size:12px;">⚠️ Nhập máy thiếu so với tiền mặt tại POS - Yêu cầu nhập đầy đủ lần sau.</span>';
                        html += '    </div>';
                    }
                } else if (savedDiff < 0) {
                    html += '    <div class="pos-cash-row pos-cash-diff" id="staffDiffRow">';
                    html += '      <span>📊 Chênh lệch thực tế:</span>';
                    html += '      <span class="pos-cash-negative" id="staffDiffValue">' + formatMoney(savedDiff) + ' (' + diffPct + '%) (đã chốt)</span>';
                    html += '    </div>';
                    if (!isWithinLimit) {
                        html += '    <div class="pos-cash-row" style="margin-top:4px;">';
                        html += '      <span style="color:#e74c3c;font-size:12px;">🔴 Số tiền bị thiếu so với nhập máy. Thực tế so với máy chênh lệch ' + formatMoney(Math.abs(savedDiff)) + ' - Yêu cầu rà soát lại giao dịch, gửi thông báo tới quản lý.</span>';
                        html += '    </div>';
                    }
                } else {
                    html += '    <div class="pos-cash-row pos-cash-diff" id="staffDiffRow">';
                    html += '      <span>📊 Chênh lệch thực tế:</span>';
                    html += '      <span class="pos-cash-positive" id="staffDiffValue">' + formatMoney(savedDiff) + ' (0%) (đã chốt)</span>';
                    html += '    </div>';
                }
            }
            html += '    </div>'; // end closed section
        }

        // ===== QUỸ THƯỞNG TRÁCH NHIỆM (staff) =====
        html += '    <div id="fundInfoInCashCounter"></div>';

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
    var displayDate = data.dateKey || (typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10));
    var dateLabel = formatDateDisplay(displayDate);
    var hasPickupHistory = data.pickupHistory && data.pickupHistory.length > 0;
    if (isAdmin) {
        html += '  <div class="cash-counter-actions">';
        html += '    <button class="cash-action-btn cash-reset-btn" onclick="resetCashCounter()">🔄 Làm lại</button>';
        if (!data.isClosed) {
            // NÂNG CẤP: Admin cũng có nút chốt ngày để chốt thay nhân viên
            html += '    <button class="cash-action-btn cash-close-btn" onclick="staffCloseDay()">🔒 Chốt ngày ' + dateLabel + '</button>';
        } else {
            // Admin có nút "Hủy chốt" để mở khóa cho nhân viên chốt lại
            html += '    <button class="cash-action-btn cash-unlock-btn" onclick="unlockDayClose()">🔓 Hủy chốt ' + dateLabel + '</button>';
            // Nút in phiếu chốt ca cho admin
            html += '    <button class="cash-action-btn" style="background:#27ae60;color:#fff;" onclick="printStaffCloseReceipt()">🖨️ In chốt ca</button>';
        }
        // Nút in phiếu QL nhận tiền - nằm trong cash-counter-actions cho admin
        if (hasPickupHistory) {
            html += '    <button class="cash-action-btn" style="background:#2c3e50;color:#fff;" onclick="printManagerPickup()">🖨️ In QL nhận</button>';
        }
        html += '  </div>';
    } else {
        html += '  <div class="cash-counter-actions">';
        html += '    <button class="cash-action-btn cash-reset-btn" onclick="resetCashCounter()">🔄 Làm lại</button>';
        if (!data.isClosed) {
            html += '    <button class="cash-action-btn cash-close-btn" onclick="staffCloseDay()">🔒 Chốt ngày ' + dateLabel + '</button>';
        } else {
            // Nút in phiếu chốt ca cho nhân viên
            html += '    <button class="cash-action-btn" style="background:#27ae60;color:#fff;" onclick="printStaffCloseReceipt()">🖨️ In chốt ca</button>';
        }
        // Nút in phiếu QL nhận tiền cho nhân viên (nếu có lịch sử)
        if (hasPickupHistory) {
            html += '    <button class="cash-action-btn" style="background:#2c3e50;color:#fff;" onclick="printManagerPickup()">🖨️ In QL nhận</button>';
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
        html += '      <span>Tiền QL nhận:</span>';
        html += '      <span class="pos-cash-mgr-pickup">';
        html += '        <input type="number" class="mgr-pickup-input" id="mgrPickupInput" value="" min="0" placeholder="0">';
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
                var pickupId = ph.id || '';
                var remainingStr = ph.remainingPosCash !== undefined ? formatMoney(ph.remainingPosCash) : '...';
                html += '    <div class="pos-cash-row pos-cash-pickup-log">';
                html += '      <span>🕐 ' + timeStr + '</span>';
                html += '      <span>-' + formatMoney(ph.amount) + '</span>';
                html += '      <span style="font-size:11px;color:#64748b;margin-left:8px;">📦 Còn: ' + remainingStr + '</span>';
                html += '      <button class="cash-action-btn" style="padding:2px 6px;font-size:10px;margin-left:auto;color:#e74c3c;background:none;border:1px solid #e74c3c;border-radius:4px;cursor:pointer;" onclick="deleteManagerPickup(\'' + pickupId + '\')" title="Xóa">🗑️</button>';
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
    _saveCashCountsToLocal();
    updateDenomSubtotal(denomValue);
    updateCashGrandTotal();
}

function setCashCount(denomValue, val) {
    var num = parseInt(val, 10);
    if (isNaN(num) || num < 0) num = 0;
    cashCounts[denomValue] = num;
    _saveCashCountsToLocal();
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

    // Số tiền thực tế
    // - Nếu đã chốt ngày: hiển thị cashKept đã lưu (không thay đổi theo số đếm)
    //   Nếu cashKept null (dữ liệu cũ): fallback về expectedClosing
    // - Nếu chưa chốt: hiển thị tổng đếm được (total)
    var el = document.getElementById('cashGrandTotal');
    if (el) {
        var isClosed = _posCashData && _posCashData.isClosed;
        var displayTotal;
        if (isClosed) {
            displayTotal = (_posCashData.cashKept !== null && _posCashData.cashKept !== undefined) ? _posCashData.cashKept : _posCashData.expectedClosing;
        } else {
            displayTotal = total;
        }
        el.textContent = formatMoney(displayTotal);
    }

    // Cập nhật chênh lệch realtime (admin)
    var expectedClosing = _posCashData ? _posCashData.expectedClosing : 0;
    var liveDiff = total - expectedClosing;
    var diffEl = document.getElementById('posCashDiffValue');
    if (diffEl) {
        var diffClass = liveDiff >= 0 ? 'pos-cash-positive' : 'pos-cash-negative';
        diffEl.textContent = (liveDiff >= 0 ? '+' : '') + formatMoney(liveDiff);
        diffEl.className = diffClass;
    }

    // Cập nhật Tổng số tiền đếm được (staff) - realtime khi nhập mệnh giá
    var staffPosCashEl = document.getElementById('staffPosCashValue');
    if (staffPosCashEl) {
        if (total > 0) {
            staffPosCashEl.textContent = formatMoney(total);
            staffPosCashEl.className = 'pos-cash-positive';
            // Hiện dòng nếu đang bị ẩn (lần đầu nhập mệnh giá)
            var parentRow = staffPosCashEl.closest('.pos-cash-row');
            if (parentRow) parentRow.style.display = '';
        } else {
            // Ẩn dòng số tiền khi chưa nhập mệnh giá
            var parentRow = staffPosCashEl.closest('.pos-cash-row');
            if (parentRow) parentRow.style.display = 'none';
        }
    }

    // Cập nhật 💵 Số tiền tại POS hiện tại (admin) - realtime khi nhập mệnh giá
    var adminPosCashEl = document.getElementById('adminPosCashValue');
    if (adminPosCashEl) {
        var adminDisplayValue = total > 0 ? total : (_posCashData ? _posCashData.expectedClosing : 0);
        adminPosCashEl.textContent = formatMoney(adminDisplayValue);
        adminPosCashEl.className = adminDisplayValue >= 0 ? 'pos-cash-positive' : 'pos-cash-negative';
    }
}

function resetCashCounter() {
    // Nếu đã chốt ngày thì không cho reset - tránh nhầm lẫn số liệu
    if (_posCashData && _posCashData.isClosed) {
        showToast('🔒 Đã chốt ngày, không thể làm lại', 'warning');
        return;
    }
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        cashCounts[CASH_DENOMS[i].value] = 0;
    }
    _saveCashCountsToLocal();
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