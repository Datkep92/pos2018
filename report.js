// report.js - Báo cáo doanh thu, chi phí theo ngày
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== BÁO CÁO ==========
function renderReport(dateObj) {
    var dateStr = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
    document.getElementById('reportDate').innerText = formatDateDisplay(dateStr);
    
    // Tính ngày hôm trước để lấy số dư đầu kỳ (cashKept)
    var prevDate = new Date(dateObj);
    prevDate.setDate(prevDate.getDate() - 1);
    var prevDateStr = prevDate.getFullYear() + '-' + String(prevDate.getMonth() + 1).padStart(2, '0') + '-' + String(prevDate.getDate()).padStart(2, '0');
    
    Promise.all([
        DB.getTransactionsByDate(dateStr),
        DB.getAll('cost_transactions'),
        DB.get('daily_balances', dateStr),
        DB.get('daily_balances', prevDateStr), // Lấy cashKept của ngày hôm trước làm số dư đầu kỳ
        DB.getAll('tables'),
        DB.getAll('customers'),
        typeof loadFundReconciliationData === 'function' ? loadFundReconciliationData() : Promise.resolve()
    ]).then(function(results) {
        var transactions = results[0].filter(function(t) { return !t.refunded; });
        var allCosts = results[1] || [];
        var dailyBalance = results[2] || { cashKept: 0, cashReceived: 0 };
        var prevDayBalance = results[3] || {}; // Số dư đầu kỳ từ ngày hôm trước
        var allTables = results[4] || [];
        var allCustomers = results[5] || [];
        var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
        
        // ===== 1. DOANH THU - ĐẾM SỐ LƯỢNG =====
        var cashTotal = 0, transferTotal = 0, debtPaymentTotal = 0, grabTotal = 0;
        var cashCount = 0, transferCount = 0, grabCount = 0, debtPaymentCount = 0;
        
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            if (tx.paymentMethod === 'cash') { cashTotal += tx.amount; cashCount++; }
            else if (tx.paymentMethod === 'transfer') { transferTotal += tx.amount; transferCount++; }
            else if (tx.paymentMethod === 'debt') { debtPaymentTotal += tx.amount; debtPaymentCount++; }
            else if (tx.paymentMethod === 'grab') { grabTotal += tx.amount; grabCount++; }
        }
        
        // TotalRevenue chỉ tính doanh thu thực tế (TM + CK + Grab), không bao gồm ghi nợ
        var totalRevenue = cashTotal + transferTotal + grabTotal;
        
        // ===== 2. BÀN ĐANG HOẠT ĐỘNG =====
        var activeTables = allTables.filter(function(t) { return (t.items && t.items.length) || t.total > 0; });
        var activeTableTotal = 0;
        for (var ti = 0; ti < activeTables.length; ti++) {
            activeTableTotal += activeTables[ti].total || 0;
        }
        
        // ===== 3. CHI PHÍ =====
        var dailyCosts = allCosts.filter(function(c) { return c.dateKey === dateStr && !c.deleted; });
        var totalCost = 0;
        var ingredientCost = 0;
        var wasteCost = 0;
        var posCashCost = 0;
        var posCostCount = 0;
        var ingredientCount = 0;
        var wasteCount = 0;
        var qlttCost = 0;
        var qlttCount = 0;
        
        for (var j = 0; j < dailyCosts.length; j++) {
            var c = dailyCosts[j];
            if (c.fundSource === 'pos_cash') {
                totalCost += c.amount;
                posCashCost += c.amount;
                posCostCount++;
                if (c.costType === 'ingredient') {
                    ingredientCost += c.amount;
                    ingredientCount++;
                } else {
                    wasteCost += c.amount;
                    wasteCount++;
                }
            } else if (c.fundSource === 'management') {
                qlttCost += c.amount;
                qlttCount++;
            }
        }
        
        // ===== 4. NỢ PHÁT SINH TRONG NGÀY =====
        var debtTodayCustomers = [];
        var debtTodayTotal = 0;
        for (var ci = 0; ci < allCustomers.length; ci++) {
            var cust = allCustomers[ci];
            if (cust.debtHistory && cust.debtHistory.length > 0) {
                for (var hi = 0; hi < cust.debtHistory.length; hi++) {
                    var dh = cust.debtHistory[hi];
                    if (dh.date && dh.date.indexOf(dateStr) === 0) {
                        debtTodayCustomers.push(cust);
                        debtTodayTotal += dh.amount || 0;
                        break;
                    }
                }
            }
        }
        var debtTodayPeople = debtTodayCustomers.length;
        
        // ===== 5. NỢ CÒN LẠI =====
        var remainingDebtCustomers = allCustomers.filter(function(c) { return (c.totalDebt || 0) > 0; });
        var remainingDebtTotal = 0;
        for (var rci = 0; rci < remainingDebtCustomers.length; rci++) {
            remainingDebtTotal += remainingDebtCustomers[rci].totalDebt || 0;
        }
        var remainingDebtPeople = remainingDebtCustomers.length;
        
        // ===== 5b. TIỀN DƯ (CREDIT) CỦA KHÁCH =====
        var creditCustomers = allCustomers.filter(function(c) { return (c.creditBalance || 0) > 0; });
        var creditTotal = 0;
        for (var cci = 0; cci < creditCustomers.length; cci++) {
            creditTotal += creditCustomers[cci].creditBalance || 0;
        }
        var creditPeople = creditCustomers.length;
        
        // ===== 6. TỔNG TIỀN QUẢN LÝ NHẬN (từ fund-reconciliation) =====
        var managerPickupTotal = 0;
        var pickupHistory = [];
        if (window.managerCashPickups && window.managerCashPickups.length) {
            for (var pi = 0; pi < window.managerCashPickups.length; pi++) {
                var p = window.managerCashPickups[pi];
                if (p.dateKey === dateStr) {
                    managerPickupTotal += p.amount || 0;
                    var timeStr = '';
                    var timeSource = p.date || p.createdAt;
                    if (timeSource) {
                        try {
                            var d = new Date(timeSource);
                            var hh = d.getHours();
                            var mm = d.getMinutes();
                            timeStr = (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
                        } catch(e) {}
                    }
                    pickupHistory.push({ time: timeStr, amount: p.amount || 0 });
                }
            }
            // Sắp xếp theo thời gian tăng dần
            pickupHistory.sort(function(a, b) { return a.time.localeCompare(b.time); });
        }
        
        // Kiểm tra đã chốt ngày chưa (nhân viên chốt qua staffCloseDay ghi isClosed=true)
        // Dùng isClosed thay vì actualClosing vì staffCloseDay chỉ ghi isClosed + cashKept, không ghi actualClosing
        var isDayClosed = dailyBalance && dailyBalance.isClosed === true;
        
        // ===== RENDER HTML =====
        // QUY TẮC:
        // - Trước khi chốt ngày: Ẩn số tiền TM/CK/Grab - chỉ hiển thị số lượng
        // - Sau khi chốt ngày: Hiển thị đầy đủ số lượng + số tiền
        // - Các mục khác (bàn, chi phí, nợ, thanh toán nợ, QL nhận): Luôn hiển thị đầy đủ
        var html = '';
        // Số tiền đầu kỳ (cashKept từ ngày hôm trước) - chỉ hiển thị khi đã chốt hoặc admin
        // FIX: Dùng prevDayBalance.cashKept (số tiền chốt cuối ngày hôm trước) thay vì dailyBalance.cashKept (số tiền chốt cuối ngày hôm nay)
        var openingCash = prevDayBalance && prevDayBalance.cashKept ? prevDayBalance.cashKept : 0;
        if (isAdmin || isDayClosed) {
            html += '<div class="stat-card">' +
                '<div class="stat-row">' +
                    '<span>\uD83D\uDCB5 Tiền đầu kỳ</span>' +
                    '<span>' + formatMoney(openingCash) + '</span>' +
                '</div>' +
            '</div>';
        }
        html += '<div class="stat-card">' +
            '<div class="stat-row" style="cursor:pointer;" onclick="showActiveTablesModal()">' +
                '<span>\uD83E\uDE91 Bàn đang hoạt động</span>' +
                '<span class="stat-value primary">' + formatMoney(activeTableTotal) + '</span>' +
            '</div>' +
        '</div>';
        // Admin: luôn thấy số lượng + số tiền
        // Nhân viên: chỉ thấy số tiền sau khi chốt ngày, trước đó chỉ thấy số lượng
        html += '<div class="stat-card">' +
            '<div class="stat-row"><span>\uD83D\uDCB0 Tiền mặt</span><span>' + (isAdmin ? cashCount + ' giao dịch - ' + formatMoney(cashTotal) : (isDayClosed ? cashCount + ' giao dịch - ' + formatMoney(cashTotal) : cashCount + ' giao dịch')) + '</span></div>' +
            '<div class="stat-row"><span>\uD83D\uDCB3 Chuyển khoản</span><span>' + (isAdmin ? transferCount + ' giao dịch - ' + formatMoney(transferTotal) : (isDayClosed ? transferCount + ' giao dịch - ' + formatMoney(transferTotal) : transferCount + ' giao dịch')) + '</span></div>' +
            '<div class="stat-row"><span>\uD83D\uDE95 Grab</span><span>' + (isAdmin ? grabCount + ' đơn - ' + formatMoney(grabTotal) : (isDayClosed ? grabCount + ' đơn - ' + formatMoney(grabTotal) : grabCount + ' đơn')) + '</span></div>' +
            '<div class="stat-row" style="border-top:1px dashed var(--border);padding-top:4px;margin-top:4px;font-weight:600;"><span>\uD83D\uDCC8 Tổng doanh thu (TM+CK+Grab)</span><span>' + (isAdmin ? formatMoney(totalRevenue) : (isDayClosed ? formatMoney(totalRevenue) : '***')) + '</span></div>' +
            '<div class="stat-row"><span>\uD83D\uDCA2 Nợ trong ngày</span><span>' + formatMoney(debtPaymentTotal) + '</span></div>' +
        '</div>';
        html += '<div class="stat-card">' +
            '<div class="stat-row" style="font-size:12px;padding-left:16px;">' +
                '<span>\uD83E\uDDCA Nguyên liệu</span>' +
                '<span>' + ingredientCount + ' khoản - ' + formatMoney(ingredientCost) + '</span>' +
            '</div>' +
            '<div class="stat-row" style="font-size:12px;padding-left:16px;">' +
                '<span>\uD83D\uDCE6 Hao phí</span>' +
                '<span>' + wasteCount + ' khoản - ' + formatMoney(wasteCost) + '</span>' +
            '</div>' +
            '<div class="stat-row" style="border-top:1px dashed var(--border);padding-top:4px;">' +
                '<span>\uD83C\uDFE6 Chi phí từ Két POS</span>' +
                '<span>' + posCostCount + ' khoản - ' + formatMoney(posCashCost) + '</span>' +
            '</div>' +
            (isAdmin ? '<div class="stat-row" style="font-size:12px;padding-left:16px;color:#7c3aed;">' +
                '<span>\uD83C\uDFE6 Chi phí từ QLTT</span>' +
                '<span>' + qlttCount + ' khoản - ' + formatMoney(qlttCost) + '</span>' +
            '</div>' : '') +
        '</div>';
        html += '<div class="stat-card">' +
            '<div class="stat-row" style="cursor:pointer;" onclick="showDebtTodayModal()">' +
                '<span>\uD83D\uDCCA Nợ phát sinh trong ngày</span>' +
                '<span>' + debtTodayPeople + ' người - ' + formatMoney(debtTodayTotal) + '</span>' +
            '</div>' +
            '<div class="stat-row" style="cursor:pointer;" onclick="showRemainingDebtModal()">' +
                '<span>\uD83C\uDFE6 Nợ còn lại</span>' +
                '<span>' + remainingDebtPeople + ' người - ' + formatMoney(remainingDebtTotal) + '</span>' +
            '</div>' +
            (creditTotal > 0 ? '<div class="stat-row" style="cursor:pointer;color:#d97706;" onclick="showCreditBalanceModal()"><span>\uD83D\uDCB0 Tiền dư khách (trả trước)</span><span>' + creditPeople + ' người - ' + formatMoney(creditTotal) + '</span></div>' : '') +
        '</div>';
        html += '<div class="stat-card">' +
            '<div class="stat-row" style="border-bottom:1px dashed var(--border);padding-bottom:4px;margin-bottom:4px;">' +
                '<span>\uD83D\uDCB0 Tiền QL nhận</span>' +
                '<span>' + formatMoney(managerPickupTotal) + '</span>' +
            '</div>';
        // Pickup history
        for (var phi = 0; phi < pickupHistory.length; phi++) {
            var ph = pickupHistory[phi];
            html += '<div class="stat-row" style="font-size:12px;padding-left:16px;">' +
                '<span>\uD83D\uDD50 ' + (ph.time || '--:--') + '</span>' +
                '<span>' + formatMoney(ph.amount) + '</span>' +
            '</div>';
        }
        html += '</div>';
        document.getElementById('reportStats').innerHTML = html;
        
        // Render đối soát quỹ
        if (typeof renderReconciliation === 'function') {
            renderReconciliation(dateStr);
        }
    });
}

function changeReportDate(delta) { var nd = new Date(currentReportDate); nd.setDate(nd.getDate() + delta); currentReportDate = nd; renderReport(currentReportDate); }

// ========== MODAL BÀN ĐANG HOẠT ĐỘNG ==========
function showActiveTablesModal() {
    DB.getAll('tables').then(function(allTables) {
        var activeTables = allTables.filter(function(t) { return (t.items && t.items.length) || t.total > 0; });
        
        // Tạo modal động
        var modalId = 'activeTablesModal_' + Date.now();
        var html = '<div class="modal" id="' + modalId + '">' +
            '<div class="modal-content">' +
                '<div class="modal-header">' +
                    '<span class="modal-title">🪑 Bàn đang hoạt động</span>' +
                    '<span class="modal-close" onclick="closeModal(\'' + modalId + '\')">&times;</span>' +
                '</div>' +
                '<div class="modal-body" style="max-height:60vh;overflow-y:auto;">';
        
        if (activeTables.length === 0) {
            html += '<div class="empty-state">✅ Không có bàn nào đang hoạt động</div>';
        } else {
            var total = 0;
            for (var i = 0; i < activeTables.length; i++) {
                var t = activeTables[i];
                total += t.total || 0;
                var displayName = t.customerName ? t.customerName : ((t.name && t.name.trim()) ? t.name : 'Bàn ' + t.id);
                html += '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">' +
                            '<span>🪑 ' + escapeHtml(displayName) + '</span>' +
                            '<span>' + formatMoney(t.total || 0) + '</span>' +
                        '</div>';
            }
            html += '<div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:4px;font-weight:700;border-top:2px solid var(--border);">' +
                        '<span>Tổng tiền bàn</span>' +
                        '<span>' + formatMoney(total) + '</span>' +
                    '</div>';
        }
        
        html += '    </div>' +
            '</div>' +
        '</div>';
        
        // Thêm modal vào body và mở
        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
        openBottomSheet(modalId);
    });
}

// ========== MODAL NỢ PHÁT SINH TRONG NGÀY ==========
function showDebtTodayModal() {
    var d = currentReportDate;
    var dateStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    DB.getAll('customers').then(function(allCustomers) {
        var container = document.getElementById('infoModalList');
        if (!container) return;
        
        var html = '';
        var total = 0;
        var count = 0;
        for (var ci = 0; ci < allCustomers.length; ci++) {
            var cust = allCustomers[ci];
            if (cust.debtHistory && cust.debtHistory.length > 0) {
                var custDebtToday = 0;
                for (var hi = 0; hi < cust.debtHistory.length; hi++) {
                    var dh = cust.debtHistory[hi];
                    if (dh.date && dh.date.indexOf(dateStr) === 0) {
                        custDebtToday += dh.amount || 0;
                    }
                }
                if (custDebtToday > 0) {
                    count++;
                    total += custDebtToday;
                    html += '<div class="cost-detail-item">' +
                                '<span>👤 ' + escapeHtml(cust.name || 'Khách ' + cust.id) + '</span>' +
                                '<span>' + formatMoney(custDebtToday) + '</span>' +
                            '</div>';
                }
            }
        }
        
        if (count === 0) {
            html = '<div class="empty-state">✅ Không có nợ phát sinh hôm nay</div>';
        } else {
            html += '<div class="cost-detail-item" style="font-weight:700;border-top:2px solid var(--border);padding-top:8px;margin-top:4px;">' +
                        '<span>Tổng (' + count + ' người)</span>' +
                        '<span>' + formatMoney(total) + '</span>' +
                    '</div>';
        }
        container.innerHTML = html;
        document.getElementById('infoModal').querySelector('.modal-title').innerText = '📊 Nợ phát sinh trong ngày';
        document.getElementById('infoModal').style.display = 'flex';
    });
}

// ========== MODAL NỢ CÒN LẠI ==========
function showRemainingDebtModal() {
    DB.getAll('customers').then(function(allCustomers) {
        var container = document.getElementById('infoModalList');
        if (!container) return;
        
        var debtCustomers = allCustomers.filter(function(c) { return (c.totalDebt || 0) > 0; });
        var html = '';
        var total = 0;
        
        if (debtCustomers.length === 0) {
            html = '<div class="empty-state">✅ Không có nợ tồn đọng</div>';
        } else {
            for (var i = 0; i < debtCustomers.length; i++) {
                var c = debtCustomers[i];
                total += c.totalDebt || 0;
                html += '<div class="cost-detail-item">' +
                            '<span>👤 ' + escapeHtml(c.name || 'Khách ' + c.id) + '</span>' +
                            '<span>' + formatMoney(c.totalDebt || 0) + '</span>' +
                        '</div>';
            }
            html += '<div class="cost-detail-item" style="font-weight:700;border-top:2px solid var(--border);padding-top:8px;margin-top:4px;">' +
                        '<span>Tổng (' + debtCustomers.length + ' người)</span>' +
                        '<span>' + formatMoney(total) + '</span>' +
                    '</div>';
        }
        container.innerHTML = html;
        document.getElementById('infoModal').querySelector('.modal-title').innerText = '🏦 Nợ còn lại';
        document.getElementById('infoModal').style.display = 'flex';
    });
}

// ========== MODAL TIỀN DƯ KHÁCH ==========
function showCreditBalanceModal() {
    DB.getAll('customers').then(function(allCustomers) {
        var container = document.getElementById('infoModalList');
        if (!container) return;
        
        var creditCustomers = allCustomers.filter(function(c) { return (c.creditBalance || 0) > 0; });
        var html = '';
        var total = 0;
        
        if (creditCustomers.length === 0) {
            html = '<div class="empty-state">✅ Không có khách có tiền dư</div>';
        } else {
            for (var i = 0; i < creditCustomers.length; i++) {
                var c = creditCustomers[i];
                total += c.creditBalance || 0;
                html += '<div class="cost-detail-item">' +
                            '<span>👤 ' + escapeHtml(c.name || 'Khách ' + c.id) + '</span>' +
                            '<span style="color:#d97706;">' + formatMoney(c.creditBalance || 0) + '</span>' +
                        '</div>';
            }
            html += '<div class="cost-detail-item" style="font-weight:700;border-top:2px solid var(--border);padding-top:8px;margin-top:4px;">' +
                        '<span>Tổng (' + creditCustomers.length + ' người)</span>' +
                        '<span style="color:#d97706;">' + formatMoney(total) + '</span>' +
                    '</div>';
        }
        container.innerHTML = html;
        document.getElementById('infoModal').querySelector('.modal-title').innerText = '💰 Tiền dư khách (trả trước)';
        document.getElementById('infoModal').style.display = 'flex';
    });
}

// Export global
window.showActiveTablesModal = showActiveTablesModal;
window.showDebtTodayModal = showDebtTodayModal;
window.showRemainingDebtModal = showRemainingDebtModal;
window.showCreditBalanceModal = showCreditBalanceModal;
