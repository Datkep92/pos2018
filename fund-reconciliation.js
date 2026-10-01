// fund-reconciliation.js - Đối soát quỹ cuối ngày + Quản lý nhận tiền
// ES5, tương thích Android 6, iOS 12
// Công thức: expectedClosing = openingBalance + cashRevenue - posCashExpense - managerCashPickup

// ========== BIẾN GLOBAL ==========
var managerCashPickups = [];
var inventoryTransactions = [];

// ========== KHỞI TẠO ==========
function loadFundReconciliationData() {
    return Promise.all([
        DB.getAll('manager_cash_pickups'),
        DB.getAll('inventory_transactions')
    ]).then(function(results) {
        managerCashPickups = results[0] || [];
        inventoryTransactions = results[1] || [];
        // Đồng bộ window.managerCashPickups để report.js đọc được
        window.managerCashPickups = managerCashPickups;
    });
}

// ========== MỞ MODAL QUẢN LÝ NHẬN TIỀN ==========
function openManagerPickupModal() {
    loadFundReconciliationData().then(function() {
        var modal = document.getElementById('managerCashPickupModal');
        if (!modal) {
            // #managerCashPickupModal không tồn tại trong HTML hiện tại.
            // Báo rõ cho người dùng biết phải nhập ở đâu thay vì "Không tìm thấy modal!".
            showToast('ℹ️ Nhập tiền QL nhận tại mục "💰 Tiền QL nhận" trong tab Đối soát két', 'warning');
            return;
        }

        var amountEl = document.getElementById('managerPickupAmount');
        var noteEl = document.getElementById('managerPickupNote');
        if (amountEl) amountEl.value = '';
        if (noteEl) noteEl.value = '';

        renderManagerPickupHistory();
        modal.style.display = 'flex';
    });
}

// ========== LƯU LẦN NHẬN TIỀN ==========
// XOÁ bản định nghĩa cũ ở đây.
// Lý do: settings.js đã có bản duy nhất (và là bản load sau nên thắng).
// Bản cũ ở file này gọi document.getElementById('managerPickupNote').value.trim()
// không null-check trong khi #managerPickupNote không tồn tại trong HTML -> throw,
// và cờ _savingPickup chỉ được reset ở nhánh then/catch nên `if (_savingPickup) return;`
// kẹt vĩnh viễn => nút 💾 Lưu bấm mãi không có phản hồi.
// Ngoài ra nó không ghi lên Firebase nên máy khác không bao giờ thấy realtime.

// ========== HIỂN THỊ LỊCH SỬ NHẬN TIỀN ==========
function renderManagerPickupHistory() {
    var container = document.getElementById('managerPickupHistory');
    if (!container) return;

    var today = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
    var todayPickups = managerCashPickups.filter(function(p) {
        return p.dateKey === today;
    });

    todayPickups.sort(function(a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (todayPickups.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có lần nhận tiền nào hôm nay</div>';
        return;
    }

    var isAdmin = typeof _resolveIsAdmin === 'function' ? _resolveIsAdmin() : (typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin());
    var total = 0;
    var html = '';
    for (var i = 0; i < todayPickups.length; i++) {
        var p = todayPickups[i];
        total += p.amount;
        var timeStr = '';
        if (p.date) {
            try {
                var d = new Date(p.date);
                var hh = d.getHours();
                var mm = d.getMinutes();
                timeStr = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
            } catch(e) { timeStr = ''; }
        }
        html += '<div class="pickup-item">' +
            '<div class="pickup-item-info">' +
                '<span class="pickup-item-time">' + timeStr + '</span>' +
                '<span class="pickup-item-note">' + escapeHtml(p.note || '') + '</span>' +
            '</div>' +
            '<span class="pickup-item-amount">' + formatMoney(p.amount) + '</span>' +
            (isAdmin ? '<button class="pickup-delete-btn" style="padding:2px 6px;font-size:10px;margin-left:auto;color:#e74c3c;background:none;border:1px solid #e74c3c;border-radius:4px;cursor:pointer;" onclick="deleteManagerPickup(\'' + p.id + '\')" title="Xóa">🗑️</button>' : '') +
        '</div>';
    }

    html += '<div class="pickup-total">Tổng: ' + formatMoney(total) + '</div>';
    container.innerHTML = html;
}

// ========== XÓA LẦN NHẬN TIỀN (ADMIN) ==========
// XOÁ bản định nghĩa cũ ở đây - dùng bản duy nhất trong settings.js
// (bản settings.js cập nhật _pickupsCache, xoá trên Firebase, chờ kết quả
//  rồi mới báo, và render lại cả bảng đối soát).

// ========== LẤY SỐ DƯ ĐẦU KỲ ==========
function getOpeningBalance(dateStr) {
    return DB.get('daily_balances', dateStr).then(function(balance) {
        return (balance && balance.cashKept) || 0;
    });
}

// ========== TÍNH SỐ DƯ CUỐI KỲ DỰ KIẾN ==========
function calculateExpectedClosing(dateStr) {
    // Lấy ngày hôm trước - dùng Date.UTC để đúng VN timezone
    var prevParts = dateStr.split('-');
    var prevDate = new Date(Date.UTC(parseInt(prevParts[0], 10), parseInt(prevParts[1], 10) - 1, parseInt(prevParts[2], 10)));
    prevDate.setDate(prevDate.getDate() - 1);
    var prevDateStr = prevDate.toISOString().slice(0, 10);

    return Promise.all([
        // Số dư đầu kỳ = cashKept hôm trước
        getOpeningBalance(prevDateStr),
        // Doanh thu tiền mặt trong ngày
        DB.getTransactionsByDate(dateStr),
        // Chi phí từ Két POS trong ngày
        DB.getAll('cost_transactions'),
        // Tiền quản lý nhận trong ngày
        Promise.resolve(managerCashPickups)
    ]).then(function(results) {
        var openingBalance = results[0];
        var transactions = results[1].filter(function(t) { return !t.refunded; });
        var allCosts = results[2] || [];
        var pickups = results[3] || [];

        // Tính doanh thu tiền mặt
        var cashRevenue = 0;
        for (var i = 0; i < transactions.length; i++) {
            if (transactions[i].paymentMethod === 'cash') {
                cashRevenue += transactions[i].amount;
            }
        }

        // Tính chi phí từ Két POS
        var posCashExpense = 0;
        for (var j = 0; j < allCosts.length; j++) {
            var c = allCosts[j];
            if (c.dateKey === dateStr && !c.deleted && c.fundSource === 'pos_cash') {
                posCashExpense += c.amount;
            }
        }

        // Tính tổng tiền quản lý nhận
        var managerPickupTotal = 0;
        for (var k = 0; k < pickups.length; k++) {
            if (pickups[k].dateKey === dateStr) {
                managerPickupTotal += pickups[k].amount;
            }
        }

        var expectedClosing = openingBalance + cashRevenue - posCashExpense - managerPickupTotal;

        return {
            openingBalance: openingBalance,
            cashRevenue: cashRevenue,
            posCashExpense: posCashExpense,
            managerPickupTotal: managerPickupTotal,
            expectedClosing: expectedClosing
        };
    });
}

// ========== LẤY TRẠNG THÁI ĐỐI SOÁT ==========
function getReconciliationStatus(diffPercent, difference) {
    // Nếu expectedClosing = 0 mà có difference => lệch tuyệt đối, báo lỗi luôn
    if (diffPercent === 0 && difference !== 0) {
        if (difference < 0) {
            return { status: 'error', label: '🔴 Thiếu ' + formatMoney(Math.abs(difference)) + ' - Rà soát kiểm tra lại chi phí - Giải trình (ghi rõ note)', color: '#ef4444' };
        } else {
            return { status: 'warning', label: '🟡 Lệch dư +' + formatMoney(difference) + ' - Kiểm tra lại coi có đơn nào nhập thiếu hay ghi nhận chuyển khoản thay tiền mặt không?', color: '#f59e0b' };
        }
    }
    if (diffPercent <= 1) {
        return { status: 'ok', label: '✅ Hoàn thành', color: '#10b981' };
    } else if (diffPercent <= 2) {
        if (difference < 0) {
            // Thiếu: difference < 0 => actualClosing < expectedClosing
            return { status: 'error', label: '🔴 Thiếu - Rà soát kiểm tra lại chi phí - Giải trình (ghi rõ note)', color: '#ef4444' };
        } else {
            // Dư: difference >= 0 => actualClosing >= expectedClosing
            return { status: 'warning', label: '🟡 Lệch dư - Kiểm tra lại coi có đơn nào nhập thiếu hay ghi nhận chuyển khoản thay tiền mặt không?', color: '#f59e0b' };
        }
    } else {
        return { status: 'error', label: '🔴 Sai lệch quỹ', color: '#ef4444' };
    }
}

// ========== RENDER KHU VỰC ĐỐI SOÁT QUỸ ==========
function renderReconciliation(dateStr) {
    var container = document.getElementById('reconciliationArea');
    if (!container) return;

    // Load data mới nhất
    loadFundReconciliationData().then(function() {
        return calculateExpectedClosing(dateStr);
    }).then(function(result) {
        return DB.get('daily_balances', dateStr).then(function(dailyBalance) {
            var savedBalance = dailyBalance || {};

            // Kiểm tra đã lưu actualClosing hay chưa (phân biệt undefined/null vs 0)
            var hasActualClosing = savedBalance.actualClosing !== undefined && savedBalance.actualClosing !== null;
            var actualClosing = hasActualClosing ? savedBalance.actualClosing : 0;
            var isClosed = savedBalance.isClosed || false;
            
            // Tính toán sau khi có actualClosing
            var difference = actualClosing - result.expectedClosing;
            var diffPercent = result.expectedClosing > 0
                ? Math.abs(difference) / result.expectedClosing * 100
                : 0;
            var statusInfo = getReconciliationStatus(diffPercent, difference);
            
            // Đã lưu hay chưa? (dùng hasActualClosing thay vì isSaved để tránh nhầm với actualClosing=0)
            var isSaved = hasActualClosing;

            var html = '<div class="reconciliation-card">' +
                '<div class="recon-title">📊 ĐỐI SOÁT QUỸ</div>';

            // === PHẦN CHỈ HIỂN THỊ SAU KHI LƯU ===
            if (isSaved || isClosed) {
                html +=
                    // Số dư đầu kỳ
                    '<div class="recon-row">' +
                        '<span>📂 Số dư đầu kỳ</span>' +
                        '<span>' + formatMoney(result.openingBalance) + '</span>' +
                    '</div>' +
                    // Doanh thu tiền mặt
                    '<div class="recon-row">' +
                        '<span>💵 Doanh thu tiền mặt</span>' +
                        '<span>' + formatMoney(result.cashRevenue) + '</span>' +
                    '</div>' +
                    // Chi phí từ Két POS
                    '<div class="recon-row">' +
                        '<span>🏦 Tổng chi phí (Két POS)</span>' +
                        '<span class="recon-expense">-' + formatMoney(result.posCashExpense) + '</span>' +
                    '</div>' +
                    // Tiền quản lý nhận
                    '<div class="recon-row">' +
                        '<span>💰 Tiền quản lý nhận</span>' +
                        '<span>' +
                            '<span class="recon-pickup-amount">' + formatMoney(result.managerPickupTotal) + '</span>' +
                            (typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin()
                                ? '<button class="recon-pickup-btn" onclick="openManagerPickupModal()">✏️</button>'
                                : '') +
                        '</span>' +
                    '</div>' +
                    // Công thức tính
                    '<div class="recon-formula">' +
                        '<div class="recon-formula-label">📐 Công thức tính:</div>' +
                        '<div class="recon-formula-text">' +
                            '<span>Số dư đầu kỳ: <b>' + formatMoney(result.openingBalance) + '</b></span>' +
                            '<span>+ Doanh thu TM: <b>' + formatMoney(result.cashRevenue) + '</b></span>' +
                            '<span>- Chi phí Két POS: <b>' + formatMoney(result.posCashExpense) + '</b></span>' +
                            '<span>- Tiền QL nhận: <b>' + formatMoney(result.managerPickupTotal) + '</b></span>' +
                            '<span style="border-top:1px solid var(--border);padding-top:4px;margin-top:4px;">= Dự kiến: <b>' + formatMoney(result.expectedClosing) + '</b></span>' +
                        '</div>' +
                    '</div>';
            }

            // === NHẬP TIỀN MẶT + LƯU + CHỐT NGÀY TRÊN CÙNG 1 DÒNG ===
            var inputValue = '';
            var inputPlaceholder = '0đ';
            var inputDisabled = isClosed;
            if (isSaved && !isClosed) {
                // Đã lưu nhưng chưa chốt: ẩn số tiền, vẫn có thể sửa lại
                inputPlaceholder = '🔒 Đã lưu (nhập lại để sửa)';
                inputValue = '';
            } else if (isClosed) {
                // Đã chốt: hiển thị số tiền, disabled
                inputValue = actualClosing !== 0 ? formatMoney(actualClosing) : '0';
                inputPlaceholder = '🔒 Đã chốt';
                inputDisabled = true;
            }
            html +=
                '<div class="recon-input-row">' +
                    '<label>💵 Tiền mặt thực tế hiện tại:</label>' +
                    '<div class="recon-input-group">' +
                        '<input type="text" id="reconActualCashInput" class="recon-input" ' +
                            'value="' + inputValue + '" placeholder="' + inputPlaceholder + '" inputmode="numeric" ' +
                            (inputDisabled ? 'disabled' : '') + '>' +
                        '<button class="recon-save-btn" id="reconSaveActualBtn" ' +
                            (isClosed ? 'disabled' : '') + '>💾 Lưu</button>' +
                        (isClosed
                            ? ''
                            : '<button class="recon-close-btn" id="reconCloseDayBtn" style="flex:0;padding:10px 16px;white-space:nowrap;">🔒 Chốt</button>'
                        ) +
                    '</div>' +
                '</div>';

            // === KẾT QUẢ SO SÁNH (chỉ hiển thị khi đã lưu) ===
            if (isSaved || isClosed) {
                html +=
                    '<div class="recon-result ' + statusInfo.status + '">' +
                        '<div class="recon-result-row">' +
                            '<span>Chênh lệch:</span>' +
                            '<span class="' + (difference >= 0 ? 'recon-positive' : 'recon-negative') + '">' +
                                (difference >= 0 ? '+' : '') + formatMoney(difference) +
                            '</span>' +
                        '</div>' +
                        '<div class="recon-result-row">' +
                            '<span>Tỷ lệ:</span>' +
                            '<span>' + diffPercent.toFixed(2) + '%</span>' +
                        '</div>' +
                        '<div class="recon-status" style="background:' + statusInfo.color + '22;color:' + statusInfo.color + ';">' +
                            statusInfo.label +
                        '</div>' +
                    '</div>';
            }

            // === ĐÃ CHỐT NGÀY ===
            if (isClosed) {
                html +=
                    '<div class="recon-actions">' +
                        '<div class="recon-closed-badge">🔒 Đã chốt ngày</div>' +
                    '</div>';
            }

            html += '</div>';

            container.innerHTML = html;

            // Gắn sự kiện sau khi render
            attachReconciliationEvents(dateStr, result.expectedClosing);
        });
    }).catch(function(err) {
        console.error('Render reconciliation error:', err);
        container.innerHTML = '<div class="empty-state">Lỗi tải dữ liệu đối soát</div>';
    });
}

// ========== GẮN SỰ KIỆN ĐỐI SOÁT ==========
function attachReconciliationEvents(dateStr, expectedClosing) {
    var saveBtn = document.getElementById('reconSaveActualBtn');
    if (saveBtn) {
        saveBtn.onclick = function() {
            saveActualClosing(dateStr, expectedClosing);
        };
    }

    var closeBtn = document.getElementById('reconCloseDayBtn');
    if (closeBtn) {
        closeBtn.onclick = function() {
            closeDay(dateStr);
        };
    }

    // Format số hiển thị dạng 1.450.000 khi nhập
    var actualInput = document.getElementById('reconActualCashInput');
    if (actualInput) {
        actualInput.addEventListener('input', function() {
            var raw = this.value.replace(/\./g, '').replace(/[^0-9]/g, '');
            if (raw === '') {
                this.value = '';
                return;
            }
            var num = parseInt(raw);
            if (!isNaN(num)) {
                this.value = num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
            }
        });
    }
}

// ========== XEM TRƯỚC KẾT QUẢ ĐỐI SOÁT ==========
function previewReconciliation(expectedClosing, actualClosing) {
    var difference = actualClosing - expectedClosing;
    var diffPercent = expectedClosing > 0 ? Math.abs(difference) / expectedClosing * 100 : 0;
    var statusInfo = getReconciliationStatus(diffPercent, difference);

    // Tìm hoặc tạo preview area
    var previewEl = document.getElementById('reconPreviewArea');
    if (!previewEl) {
        // Tạo mới nếu chưa có
        var inputRow = document.querySelector('.recon-input-row');
        if (!inputRow) return;
        previewEl = document.createElement('div');
        previewEl.id = 'reconPreviewArea';
        previewEl.className = 'recon-result';
        inputRow.parentNode.insertBefore(previewEl, inputRow.nextSibling);
    }

    previewEl.className = 'recon-result ' + statusInfo.status;
    previewEl.innerHTML =
        '<div class="recon-result-row">' +
            '<span>Chênh lệch:</span>' +
            '<span class="' + (difference >= 0 ? 'recon-positive' : 'recon-negative') + '">' +
                (difference >= 0 ? '+' : '') + formatMoney(difference) +
            '</span>' +
        '</div>' +
        '<div class="recon-result-row">' +
            '<span>Tỷ lệ:</span>' +
            '<span>' + diffPercent.toFixed(2) + '%</span>' +
        '</div>' +
        '<div class="recon-status" style="background:' + statusInfo.color + '22;color:' + statusInfo.color + ';">' +
            statusInfo.label +
        '</div>';
}

// ========== LƯU SỐ DƯ THỰC TẾ ==========
function saveActualClosing(dateStr, expectedClosing) {
    var inputEl = document.getElementById('reconActualCashInput');
    if (!inputEl) return;
    
    var rawValue = inputEl.value.replace(/\./g, '').replace(/[^0-9]/g, '');
    if (rawValue === '') {
        showToast('Vui lòng nhập số tiền mặt thực tế!', 'warning');
        return;
    }
    var actualClosing = parseInt(rawValue);

    if (actualClosing < 0) {
        showToast('Số dư thực tế không hợp lệ!', 'warning');
        return;
    }

    // Cảnh báo trước khi lưu
    var msg = '⚠️ XÁC NHẬN LƯU\n\n' +
              '💵 Nhập chính xác số tiền mặt hiện có tại quầy.\n' +
              '📌 Kiểm tra kỹ trước khi bấm Lưu!\n\n' +
              'Số tiền: ' + formatMoney(actualClosing);
    if (!confirm(msg)) return;

    var difference = actualClosing - expectedClosing;
    var diffPercent = expectedClosing > 0 ? Math.abs(difference) / expectedClosing * 100 : 0;
    var statusInfo = getReconciliationStatus(diffPercent, difference);

    // Lấy daily_balances hiện tại để giữ cashKept và cashReceived cũ
    DB.get('daily_balances', dateStr).then(function(existing) {
        var data = existing || { id: dateStr };
        var prevActualClosing = data.actualClosing; // Lưu lần 1

        data.actualClosing = actualClosing;
        data.expectedClosing = expectedClosing;
        data.difference = difference;
        data.diffPercent = diffPercent;
        data.status = statusInfo.status;
        data.updatedAt = Date.now();

        // Nếu chưa có cashKept, tạm tính = actualClosing
        if (!data.cashKept && data.cashKept !== 0) {
            data.cashKept = actualClosing;
        }

        // Lưu lịch sử các lần lưu
        if (!data.saveHistory) data.saveHistory = [];
        data.saveHistory.push({
            actualClosing: actualClosing,
            difference: difference,
            diffPercent: diffPercent,
            status: statusInfo.status,
            savedAt: Date.now()
        });

        // Bước 1: Lưu vào IndexedDB qua DB.create trước -> memoryCache được cập nhật ngay
        return DB.create('daily_balances', data, dateStr).then(function() {
            // Bước 2: Sau khi DB.create thành công, đồng bộ lên Firebase
            try {
                var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
                var fbRef = firebase.database().ref(shopId + '/daily_balances/' + dateStr);
                fbRef.update({
                    cashKept: data.cashKept || actualClosing,
                    actualClosing: actualClosing,
                    expectedClosing: expectedClosing,
                    difference: difference,
                    diffPercent: diffPercent,
                    status: statusInfo.status,
                    updatedAt: Date.now()
                }).catch(function(err) {
                    console.error('[SaveActualClosing] Firebase sync error:', err);
                });
            } catch(e) {
                console.error('[SaveActualClosing] Firebase sync exception:', e);
            }
            // Kiểm tra: lần 2 khớp nhưng lần 1 lệch => gửi cảnh báo cho quản lý
            var isRetrySave = (prevActualClosing !== undefined && prevActualClosing !== null);
            var prevDiff = prevActualClosing - expectedClosing;
            var prevDiffPercent = expectedClosing > 0 ? Math.abs(prevDiff) / expectedClosing * 100 : 0;
            var prevStatus = getReconciliationStatus(prevDiffPercent, prevDiff);
            var prevWasError = (prevStatus.status !== 'ok');
            var nowIsOk = (statusInfo.status === 'ok');

            if (isRetrySave && prevWasError && nowIsOk && typeof sendTelegramMessage === 'function') {
                // Lấy lịch sử giao dịch trong ngày để gửi kèm
                DB.getTransactionsByDate(dateStr).then(function(transactions) {
                    var validTx = transactions.filter(function(t) { return !t.refunded; });
                    validTx.sort(function(a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });

                    var txList = '';
                    for (var i = 0; i < validTx.length; i++) {
                        var t = validTx[i];
                        txList += (i + 1) + '. ' + (t.customerName || '') + ' - ' + formatMoney(t.amount) +
                                  ' (' + (t.paymentMethod || '') + ')' +
                                  (t.refunded ? ' [HOÀN]' : '') + '\n';
                        if (txList.length > 1500) { // Giới hạn độ dài
                            txList += '... và ' + (validTx.length - i - 1) + ' giao dịch khác\n';
                            break;
                        }
                    }

                    var alertMsg = '⚠️ CẢNH BÁO: NHÂN VIÊN ĐIỀU CHỈNH SỐ DƯ\n\n' +
                                   '📅 Ngày: ' + formatDateDisplay(dateStr) + '\n' +
                                   '📌 Lần 1 (lệch): ' + formatMoney(prevActualClosing) + '\n' +
                                   '   Chênh lệch: ' + (prevDiff >= 0 ? '+' : '') + formatMoney(prevDiff) + '\n' +
                                   '   Tỷ lệ: ' + prevDiffPercent.toFixed(2) + '%\n' +
                                   '   Trạng thái: ' + prevStatus.label + '\n\n' +
                                   '📌 Lần 2 (khớp): ' + formatMoney(actualClosing) + '\n' +
                                   '   Chênh lệch: ' + (difference >= 0 ? '+' : '') + formatMoney(difference) + '\n' +
                                   '   Tỷ lệ: ' + diffPercent.toFixed(2) + '%\n' +
                                   '   Trạng thái: ' + statusInfo.label + '\n\n' +
                                   '📋 LỊCH SỬ GIAO DỊCH TRONG NGÀY:\n' + txList;
                    sendTelegramMessage(alertMsg);
                });
            } else {
                // Gửi thông báo bình thường
                if (typeof sendTelegramMessage === 'function') {
                    var icon = statusInfo.status === 'ok' ? '✅' : '⚠️';
                    var normalMsg = icon + ' ĐỐI SOÁT QUỸ ' + formatDateDisplay(dateStr) + '\n' +
                              '💰 Dự kiến: ' + formatMoney(expectedClosing) + '\n' +
                              '💵 Thực tế: ' + formatMoney(actualClosing) + '\n' +
                              '📊 Chênh lệch: ' + (difference >= 0 ? '+' : '') + formatMoney(difference) + '\n' +
                              '📈 Tỷ lệ: ' + diffPercent.toFixed(2) + '%\n' +
                              '🔴 Trạng thái: ' + statusInfo.label;
                    sendTelegramMessage(normalMsg);
                }
            }
        });
    }).then(function() {
        showToast('🔒 Chốt ngày sau khi lưu để hoàn tất', 'warning');
        renderReconciliation(dateStr);
    }).catch(function(err) {
        console.error('Save actual closing error:', err);
        showToast('Lỗi khi lưu!', 'error');
    });
}

// ========== CHỐT NGÀY ==========
function closeDay(dateStr) {
    // Lấy số dư thực tế từ input (đã lưu trước đó)
    DB.get('daily_balances', dateStr).then(function(saved) {
        if (!saved || saved.actualClosing === undefined || saved.actualClosing === null) {
            showToast('Vui lòng lưu số dư thực tế trước khi chốt ngày!', 'warning');
            return;
        }

        var actualClosing = saved.actualClosing;
        var expectedClosing = saved.expectedClosing || 0;
        // Dùng difference đã lưu, nếu chưa có thì tính lại (tránh lỗi khi difference = 0 bị || override)
        var difference = (saved.difference !== undefined && saved.difference !== null) ? saved.difference : (actualClosing - expectedClosing);
        var diffPercent = (saved.diffPercent !== undefined && saved.diffPercent !== null) ? saved.diffPercent : (expectedClosing > 0 ? Math.abs(difference) / expectedClosing * 100 : 0);
        var statusInfo = getReconciliationStatus(diffPercent, difference);

        // Xử lý theo loại lệch
        var note = '';
        if (statusInfo.status === 'ok') {
            // HOÀN THÀNH: không cần cảnh báo hay giải trình
        } else if (difference < 0) {
            // THIẾU TIỀN: bắt buộc giải thích (bất kể %)
            note = prompt(
                '⚠️ CHỐT NGÀY - THIẾU TIỀN\n\n' +
                'Chênh lệch: ' + formatMoney(difference) + '\n' +
                'Tỷ lệ: ' + diffPercent.toFixed(2) + '%\n' +
                'Trạng thái: ' + statusInfo.label + '\n\n' +
                '📋 Yêu cầu:\n' +
                '1. Kiểm tra lại lịch sử giao dịch trong ngày\n' +
                '2. Kiểm tra lại số tiền mặt thực tế\n' +
                '3. Nhập giải trình để hoàn tất chốt ngày\n\n' +
                '📝 Nhập lý do / giải trình:',
                saved.closeNote || ''
            );
            if (note === null) return; // Hủy chốt ngày
            note = note.trim();
            if (note === '') {
                showToast('Vui lòng nhập giải trình trước khi chốt ngày!', 'warning');
                return;
            }
        } else if (difference > 0) {
            // DƯ TIỀN (bất kể %): chỉ cảnh báo nhắc nhở, ko cần giải trình
            var dưMsg = '⚠️ CHỐT NGÀY - DƯ TIỀN\n\n' +
                        'Chênh lệch: +' + formatMoney(difference) + '\n' +
                        'Tỷ lệ: ' + diffPercent.toFixed(2) + '%\n' +
                        'Trạng thái: ' + statusInfo.label + '\n\n' +
                        '📌 CẨN THẬN: Nhập liệu chính xác hơn!\n' +
                        '🔍 Xem lại có giao dịch nào thiếu chưa bấm máy không?\n' +
                        '💰 Kiểm tra coi có đơn nào nhập thiếu hay ghi nhận chuyển khoản thay tiền mặt không.';
            if (!confirm(dưMsg + '\n\nXác nhận chốt ngày?')) return;
        }

        // Xác nhận lần cuối
        var confirmMsg = '🔒 XÁC NHẬN CHỐT NGÀY\n\n' +
                         'Ngày: ' + formatDateDisplay(dateStr) + '\n' +
                         '💵 Dự kiến: ' + formatMoney(expectedClosing) + '\n' +
                         '💰 Thực tế: ' + formatMoney(actualClosing) + '\n' +
                         '📊 Chênh lệch: ' + (difference >= 0 ? '+' : '') + formatMoney(difference) + '\n' +
                         '📈 Tỷ lệ: ' + diffPercent.toFixed(2) + '%\n' +
                         '🔴 Trạng thái: ' + statusInfo.label;
        if (note) confirmMsg += '\n📝 Lý do: ' + note;
        confirmMsg += '\n\nSau khi chốt sẽ không thể chỉnh sửa. Xác nhận?';
        if (!confirm(confirmMsg)) return;

        // Cập nhật dữ liệu chốt ngày
        saved.isClosed = true;
        saved.closedAt = Date.now();
        saved.closedBy = window.currentDeviceId || '';
        if (note) saved.closeNote = note;

        // Đồng bộ cashKept = actualClosing để settings.js đọc được làm số dư đầu kỳ ngày hôm sau
        saved.cashKept = actualClosing;

        return DB.create('daily_balances', saved, dateStr).then(function() {
            // Đồng bộ lên Firebase để settings.js (loadPosCashData) đọc được
            // Vì settings.js đọc daily_balances từ Firebase, không phải IndexedDB
            try {
                var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
                var fbRef = firebase.database().ref(shopId + '/daily_balances/' + dateStr);
                fbRef.update({
                    cashKept: actualClosing,
                    actualClosing: actualClosing,
                    expectedClosing: expectedClosing,
                    difference: difference,
                    diffPercent: diffPercent,
                    status: statusInfo.status,
                    isClosed: true,
                    closedAt: Date.now(),
                    closedBy: window.currentDeviceId || '',
                    closeNote: note || '',
                    updatedAt: Date.now()
                }).catch(function(err) {
                    console.error('[CloseDay] Firebase sync error:', err);
                });
            } catch(e) {
                console.error('[CloseDay] Firebase sync exception:', e);
            }

            showToast('🔒 Đã chốt ngày ' + formatDateDisplay(dateStr), 'success');
            
            // Tự động trừ quỹ thưởng nếu thiếu tiền
            if (difference < 0 && typeof handleCashShortage === 'function') {
                handleCashShortage(dateStr, difference);
            }
            
            // Luôn gửi Telegram khi chốt ngày (dù khớp hay lệch)
            if (typeof sendTelegramMessage === 'function') {
                var icon = statusInfo.status === 'ok' ? '✅' : '⚠️';
                var msg = icon + ' CHỐT NGÀY ' + formatDateDisplay(dateStr) + '\n' +
                          '💰 Dự kiến: ' + formatMoney(expectedClosing) + '\n' +
                          '💵 Thực tế: ' + formatMoney(actualClosing) + '\n' +
                          '📊 Chênh lệch: ' + (difference >= 0 ? '+' : '') + formatMoney(difference) + '\n' +
                          '📈 Tỷ lệ: ' + diffPercent.toFixed(2) + '%\n' +
                          '🔴 Trạng thái: ' + statusInfo.label;
                if (note) msg += '\n📝 Lý do: ' + note;
                sendTelegramMessage(msg);
            }
            
            renderReconciliation(dateStr);
        });
    }).catch(function(err) {
        console.error('Close day error:', err);
        showToast('Lỗi khi chốt ngày!', 'error');
    });
}

// ========== GỬI TELEGRAM (shim nối sang API thật) ==========
// SỬA LỖI: cả file này gọi sendTelegramMessage() ở 4 chỗ (L490 nhánh cảnh
// báo, L523 nhánh thường, L650 sau khi chốt ngày, L725 auto-chốt 6h sáng)
// nhưng KHÔNG tồn tại hàm sendTelegramMessage trong bất kỳ file nào của repo.
// Hệ quả: mọi thông báo Telegram về đối soát quỹ / chốt ngày đều KHÔNG BAO GIỜ
// được gửi — kể cả cảnh báo "nhân viên điều chỉnh số dư" và cảnh báo lệch quỹ.
// Các nhánh còn lại có guard typeof nên chỉ im lặng, nhưng nhánh L490->L519
// nằm trong callback DB.getTransactionsByDate() nên lỗi ở đó cũng chỉ hiện
// trong console.
//
// telegram.js export các hàm: notifyTelegramWarning(msg)  -> token cảnh báo
//                             notifyTelegramCustom(msg)   -> token chính
// shim dưới đây tự chọn kênh theo nội dung để giữ nguyên ý định gốc.
function sendTelegramMessage(message) {
    if (!message) return;
    var isWarning = (message.indexOf('CẢNH BÁO') !== -1)
                 || (message.indexOf('⚠️') !== -1)
                 || (message.indexOf('🔴') !== -1)
                 || (message.indexOf('🚨') !== -1);
    try {
        if (isWarning && typeof notifyTelegramWarning === 'function') {
            notifyTelegramWarning(message);
        } else if (typeof notifyTelegramCustom === 'function') {
            notifyTelegramCustom(message);
        } else {
            console.warn('[fund-reconciliation] telegram.js chưa sẵn sàng, bỏ qua thông báo');
        }
    } catch (e) {
        // KHÔNG để lỗi gửi Telegram làm hỏng luồng chốt ngày
        console.error('[fund-reconciliation] Lỗi gửi Telegram:', e);
    }
}

// ========== GHI NHẬN THIẾU TIỀN MẶT VÀO QUỸ THƯỞNG ==========
// SỬA LỖI: fund-reconciliation.js gọi handleCashShortage() khi chốt ngày có
// chênh lệch âm, nhưng hàm đó nằm trong bonus_fund.js — file KHÔNG được load
// trong index.html. Guard typeof khiến nhánh này im lặng bỏ qua: quản lý
// chốt ngày thiếu 30.000 mà không hề có dấu vết, quỹ thưởng không bị trừ.
//
// Ở đây ghi thẳng bản ghi DB (giống bonus_fund.js làm) nên không phụ thuộc các
// biến closure-private của bonus_fund.js. Dữ liệu đúng ngay, và khi bật lại
// bonus_fund.js thì getBonusFundTotal() đọc từ DB sẽ thấy luôn.
//
// IDEMPOTENT: autoCloseDay() chạy setInterval mỗi 60 giây và closeDay() có
// thể bấm lại nhiều lần. Nếu không kiểm tra theo dateKey thì mỗi lần chạy lại
// sẽ tạo thêm 1 bản ghi trừ tiền cho cùng một khoản thiếu → quỹ thưởng bị
// trừ âm (âm vô lý). Vì vậy kiểm tra bản ghi đã có cho ngày đó trước khi ghi.
function handleCashShortage(dateStr, difference) {
    // Chỉ xử lý khi THIẾU tiền. difference luôn <= 0 ở call site nhưng chống
    // nhầm ở các đường gọi mới sau này.
    if (!difference || difference >= 0) return Promise.resolve(null);
    // dateStr bắt buộc: nếu không có ngày thì không tạo bản ghi "mồ côi"
    if (!dateStr) {
        console.warn('[cashShortage] Thiếu dateStr, bỏ qua ghi quỹ thưởng');
        return Promise.resolve(null);
    }
    if (typeof DB === 'undefined' || !DB.getAll) return Promise.resolve(null);

    return DB.getAll('bonus_fund').then(function(records) {
        var list = records || [];
        for (var i = 0; i < list.length; i++) {
            var r = list[i];
            if (r && r.deleted !== true && r.type === 'cash_shortage' && r.dateKey === dateStr) {
                console.log('[cashShortage] Ngày ' + dateStr + ' đã có bản ghi thiếu tiền, bỏ qua (chống trùng)');
                return null;
            }
        }
        var data = {
            id: 'bf_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
            type: 'cash_shortage',
            amount: difference,              // số âm
            note: 'Trừ thiếu tiền mặt tại POS',
            dateKey: dateStr,
            createdAt: Date.now(),
            createdBy: (window.currentDeviceId || ''),
            difference: difference,
            deleted: false,
            editedAt: null,
            editedBy: null
        };
        return DB.create('bonus_fund', data).then(function() {
            showToast('⚠️ Quỹ thưởng bị trừ ' + formatMoney(Math.abs(difference)) + ' do thiếu tiền mặt', 'warning', 3000);
            return data;
        }).catch(function(err) {
            console.error('[cashShortage] Lỗi ghi quỹ thưởng:', err);
            return null;
        });
    }).catch(function(err) {
        console.error('[cashShortage] Lỗi đọc quỹ thưởng:', err);
        return null;
    });
}

// ========== LẤY CHI PHÍ THEO LOẠI (cho report.js) ==========
function getCostsByType(dateStr) {
    return DB.getAll('cost_transactions').then(function(allCosts) {
        var filtered = allCosts.filter(function(c) {
            return c.dateKey === dateStr && !c.deleted;
        });

        var result = {
            ingredientTotal: 0,
            wasteTotal: 0,
            posCashTotal: 0,
            managementTotal: 0,
            all: filtered
        };

        for (var i = 0; i < filtered.length; i++) {
            var c = filtered[i];
            if (c.costType === 'ingredient') result.ingredientTotal += c.amount;
            else result.wasteTotal += c.amount;
            if (c.fundSource === 'pos_cash') result.posCashTotal += c.amount;
            else result.managementTotal += c.amount;
        }

        return result;
    });
}

// ========== AUTO CHỐT NGÀY LÚC 6H SÁNG N+1 ==========
function autoCloseDay() {
    var now = new Date();
    var hour = now.getHours();
    var min = now.getMinutes();
    
    // Chạy lúc 6:00-6:05 sáng
    if (hour === 6 && min <= 5) {
        // Lấy ngày hôm qua (N-1)
        var yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        var dateStr = typeof getTodayDateKey === 'function' ? getTodayDateKey() : yesterday.toISOString().slice(0, 10);
        // Lưu ý: auto-close lúc 6h sáng, yesterday là ngày VN hôm qua
        
        DB.get('daily_balances', dateStr).then(function(balance) {
            if (!balance) return; // Chưa có dữ liệu
            if (balance.isClosed) return; // Đã chốt rồi
            if (balance.actualClosing === undefined || balance.actualClosing === null) return; // Chưa lưu số dư
            
            // Auto chốt ngày
            balance.isClosed = true;
            balance.closedAt = Date.now();
            balance.closedBy = 'system_auto';
            balance.closeNote = (balance.closeNote || '') + ' | Hệ thống tự động chốt lúc 6h sáng';
            
            DB.create('daily_balances', balance, dateStr).then(function() {
                console.log('✅ Auto closed day:', dateStr);
                // Gửi Telegram thông báo
                if (typeof sendTelegramMessage === 'function') {
                    var diff = balance.difference || 0;
                    var pct = balance.diffPercent || 0;
                    var msg = '🤖 HỆ THỐNG TỰ ĐỘNG CHỐT NGÀY\n' +
                              '📅 Ngày: ' + formatDateDisplay(dateStr) + '\n' +
                              '💰 Dự kiến: ' + formatMoney(balance.expectedClosing || 0) + '\n' +
                              '💵 Thực tế: ' + formatMoney(balance.actualClosing) + '\n' +
                              '📊 Chênh lệch: ' + (diff >= 0 ? '+' : '') + formatMoney(diff) + '\n' +
                              '📈 Tỷ lệ: ' + pct.toFixed(2) + '%';
                    sendTelegramMessage(msg);
                }
            });
        });
    }
}

// Kiểm tra mỗi 60 giây
setInterval(autoCloseDay, 60000);
// Chạy lần đầu sau 5 giây
setTimeout(autoCloseDay, 5000);

// Export global
// LƯU Ý: saveManagerPickup / deleteManagerPickup KHÔNG export ở đây.
// Bản định nghĩa duy nhất nằm trong settings.js (load sau) — trước đây file này
// cũng định nghĩa lại rồi gán đè lên window, gây ra 2 bản cùng tên và làm
// nút 💾 Lưu bị "chết" khi bản của file này chạy (nó đọc #managerPickupNote
// không tồn tại -> throw, cờ _savingPickup kẹt vĩnh viễn).
window.openManagerPickupModal = openManagerPickupModal;
window.renderManagerPickupHistory = renderManagerPickupHistory;
window.calculateExpectedClosing = calculateExpectedClosing;
window.renderReconciliation = renderReconciliation;
window.getReconciliationStatus = getReconciliationStatus;
window.closeDay = closeDay;
window.saveActualClosing = saveActualClosing;
window.getCostsByType = getCostsByType;
window.loadFundReconciliationData = loadFundReconciliationData;
window.managerCashPickups = managerCashPickups;
window.inventoryTransactions = inventoryTransactions;
