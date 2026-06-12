// report.js - Báo cáo doanh thu, chi phí theo ngày
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== BÁO CÁO ==========
function renderReport(dateObj) {
    var dateStr = dateObj.toISOString().slice(0, 10);
    document.getElementById('reportDate').innerText = formatDateDisplay(dateStr);
    
    Promise.all([
        DB.getTransactionsByDate(dateStr),
        DB.getAll('cost_transactions'),
        DB.get('daily_balances', dateStr),
        DB.getAll('tables'),
        DB.getAll('customers')
    ]).then(function(results) {
        var transactions = results[0].filter(function(t) { return !t.refunded; });
        var allCosts = results[1] || [];
        var dailyBalance = results[2] || { cashKept: 0, cashReceived: 0 };
        var allTables = results[3] || [];
        var allCustomers = results[4] || [];
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
            
            if (tx.type === 'grab') grabCount++;
        }
        
        var totalRevenue = cashTotal + transferTotal + debtPaymentTotal + grabTotal;
        
        // ===== 2. BÀN ĐANG HOẠT ĐỘNG =====
        var activeTables = allTables.filter(function(t) { return (t.items && t.items.length) || t.total > 0; });
        var activeTableTotal = 0;
        for (var ti = 0; ti < activeTables.length; ti++) {
            activeTableTotal += activeTables[ti].total || 0;
        }
        
        // ===== 3. CHI PHÍ (CHỈ TỪ QUỸ POS) =====
        var dailyCosts = allCosts.filter(function(c) { return c.dateKey === dateStr && !c.deleted; });
        var totalCost = 0;
        var ingredientCost = 0;
        var wasteCost = 0;
        var posCashCost = 0;
        var posCostCount = 0;
        
        for (var j = 0; j < dailyCosts.length; j++) {
            var c = dailyCosts[j];
            // Chỉ tính chi phí từ quỹ POS, bỏ qua QLTT
            if (c.fundSource === 'pos_cash') {
                totalCost += c.amount;
                posCashCost += c.amount;
                posCostCount++;
                if (c.costType === 'ingredient') ingredientCost += c.amount;
                else wasteCost += c.amount;
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
        var lastPickupTime = '';
        if (window.managerCashPickups && window.managerCashPickups.length) {
            var latestPickup = null;
            for (var pi = 0; pi < window.managerCashPickups.length; pi++) {
                var p = window.managerCashPickups[pi];
                if (p.dateKey === dateStr) {
                    managerPickupTotal += p.amount || 0;
                    if (!latestPickup || (p.createdAt || 0) > (latestPickup.createdAt || 0)) {
                        latestPickup = p;
                    }
                }
            }
            if (latestPickup && latestPickup.date) {
                try {
                    var d = new Date(latestPickup.date);
                    lastPickupTime = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
                } catch(e) {}
            }
        }
        
        // Kiểm tra đã lưu đối soát chưa
        var isReconSaved = dailyBalance && dailyBalance.actualClosing !== undefined && dailyBalance.actualClosing !== null;
        
        // ===== RENDER HTML =====
        // QUY TẮC:
        // - Trước khi lưu đối soát: Ẩn số tiền TM/CK/Grab - chỉ hiển thị số lượng
        // - Sau khi lưu đối soát: Hiển thị đầy đủ số lượng + số tiền
        // - Các mục khác (bàn, chi phí, nợ, thanh toán nợ, QL nhận): Luôn hiển thị đầy đủ
        var html = `
            <div class="stat-card">
                <div class="stat-row" style="cursor:pointer;" onclick="showActiveTablesModal()">
                    <span>🪑 Bàn đang hoạt động</span>
                    <span class="stat-value primary">${formatMoney(activeTableTotal)}</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-row"><span>💰 Tiền mặt</span><span>${isReconSaved ? formatMoney(cashTotal) : cashCount + ' giao dịch'}</span></div>
                <div class="stat-row"><span>💳 Chuyển khoản</span><span>${isReconSaved ? formatMoney(transferTotal) : transferCount + ' giao dịch'}</span></div>
                <div class="stat-row"><span>🚕 Grab</span><span>${isReconSaved ? formatMoney(grabTotal) : grabCount + ' đơn'}</span></div>
                <div class="stat-row"><span>💢 Thanh toán nợ</span><span>${formatMoney(debtPaymentTotal)}</span></div>
            </div>
            <div class="stat-card">
                <div class="stat-row cost-summary-row" onclick="showCostDetails('${dateStr}')">
                    <span>📊 Tổng chi phí</span>
                    <span class="stat-value warning">${formatMoney(totalCost)}</span>
                </div>
                <div class="stat-row" style="font-size:12px;padding-left:16px;">
                    <span>🧂 Nguyên liệu</span>
                    <span>${formatMoney(ingredientCost)}</span>
                </div>
                <div class="stat-row" style="font-size:12px;padding-left:16px;">
                    <span>📦 Hao phí</span>
                    <span>${formatMoney(wasteCost)}</span>
                </div>
                <div class="stat-row" style="font-size:12px;padding-left:16px;border-top:1px dashed var(--border);padding-top:4px;">
                    <span>🏦 Chi phí từ Két POS</span>
                    <span>${posCostCount} khoản - ${formatMoney(posCashCost)}</span>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-row" style="cursor:pointer;" onclick="showDebtTodayModal()">
                    <span>📊 Nợ phát sinh trong ngày</span>
                    <span>${debtTodayPeople} người - ${formatMoney(debtTodayTotal)}</span>
                </div>
                <div class="stat-row" style="cursor:pointer;" onclick="showRemainingDebtModal()">
                    <span>🏦 Nợ còn lại</span>
                    <span>${remainingDebtPeople} người - ${formatMoney(remainingDebtTotal)}</span>
                </div>
                ${creditTotal > 0 ? '<div class="stat-row" style="cursor:pointer;color:#d97706;" onclick="showCreditBalanceModal()"><span>💰 Tiền dư khách (trả trước)</span><span>' + creditPeople + ' người - ' + formatMoney(creditTotal) + '</span></div>' : ''}
            </div>
            <div class="stat-card">
                <div class="stat-row" style="${isAdmin ? 'cursor:pointer;' : ''}" ${isAdmin ? 'onclick="openManagerPickupModal()"' : ''}>
                    <span>💰 Tiền quản lý nhận${isAdmin ? ' <span style="font-size:11px;color:#94a3b8;">(nhập)</span>' : ''}</span>
                    <span>${formatMoney(managerPickupTotal)}${lastPickupTime ? ' <span style="font-size:11px;color:#94a3b8;">' + lastPickupTime + '</span>' : ''}</span>
                </div>
            </div>
        `;
        document.getElementById('reportStats').innerHTML = html;
        
        // Render đối soát quỹ
        if (typeof renderReconciliation === 'function') {
            renderReconciliation(dateStr);
        }
    });
}

function showCostDetails(dateStr) {
    DB.getAll('cost_transactions').then(function(allCosts) {
        // Chỉ lọc chi phí từ quỹ POS, bỏ QLTT
        var filtered = allCosts.filter(function(c) {
            return c.dateKey === dateStr && !c.deleted && c.fundSource === 'pos_cash';
        });
        var container = document.getElementById('costDetailList');
        if (!container) return;
        
        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state">📭 Không có chi phí POS nào trong ngày</div>';
        } else {
            var html = '';
            var total = 0;
            for (var i = 0; i < filtered.length; i++) {
                var c = filtered[i];
                total += c.amount;
                var typeIcon = c.costType === 'ingredient' ? '🧂' : '📦';
                var detailStr = '';
                if (c.costType === 'ingredient' && c.ingredientQty && c.ingredientUnitPrice) {
                    detailStr = ' <span style="font-size:11px;color:#94a3b8;">x' + c.ingredientQty + ' × ' + formatMoney(c.ingredientUnitPrice) + '</span>';
                }
                html += '<div class="cost-detail-item">' +
                            '<span>' + typeIcon + ' 🏦 ' + escapeHtml(c.categoryName) + detailStr + '</span>' +
                            '<span>' + formatMoney(c.amount) + '</span>' +
                        '</div>';
            }
            html += '<div class="cost-detail-item" style="font-weight:700;border-top:2px solid var(--border);padding-top:8px;margin-top:4px;">' +
                        '<span>Tổng chi phí POS</span>' +
                        '<span>' + formatMoney(total) + '</span>' +
                    '</div>';
            container.innerHTML = html;
        }
        // Hiển thị modal chi tiết chi phí
        document.getElementById('costDetailModal').querySelector('.modal-title').innerText = '📊 Chi phí từ Két POS';
        document.getElementById('costDetailModal').style.display = 'flex';
    });
}

function changeReportDate(delta) { var nd = new Date(currentReportDate); nd.setDate(nd.getDate() + delta); currentReportDate = nd; renderReport(currentReportDate); }

// ========== MODAL BÀN ĐANG HOẠT ĐỘNG ==========
function showActiveTablesModal() {
    DB.getAll('tables').then(function(allTables) {
        var activeTables = allTables.filter(function(t) { return (t.items && t.items.length) || t.total > 0; });
        var container = document.getElementById('costDetailList');
        if (!container) return;
        
        if (activeTables.length === 0) {
            container.innerHTML = '<div class="empty-state">✅ Không có bàn nào đang hoạt động</div>';
        } else {
            var html = '';
            var total = 0;
            for (var i = 0; i < activeTables.length; i++) {
                var t = activeTables[i];
                total += t.total || 0;
                html += '<div class="cost-detail-item">' +
                            '<span>🪑 ' + escapeHtml(t.name || 'Bàn ' + t.id) + '</span>' +
                            '<span>' + formatMoney(t.total || 0) + '</span>' +
                        '</div>';
            }
            html += '<div class="cost-detail-item" style="font-weight:700;border-top:2px solid var(--border);padding-top:8px;margin-top:4px;">' +
                        '<span>Tổng tiền bàn</span>' +
                        '<span>' + formatMoney(total) + '</span>' +
                    '</div>';
            container.innerHTML = html;
        }
        document.getElementById('costDetailModal').querySelector('.modal-title').innerText = '🪑 Bàn đang hoạt động';
        document.getElementById('costDetailModal').style.display = 'flex';
    });
}

// ========== MODAL NỢ PHÁT SINH TRONG NGÀY ==========
function showDebtTodayModal() {
    var dateStr = currentReportDate.toISOString().slice(0, 10);
    DB.getAll('customers').then(function(allCustomers) {
        var container = document.getElementById('costDetailList');
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
        document.getElementById('costDetailModal').querySelector('.modal-title').innerText = '📊 Nợ phát sinh trong ngày';
        document.getElementById('costDetailModal').style.display = 'flex';
    });
}

// ========== MODAL NỢ CÒN LẠI ==========
function showRemainingDebtModal() {
    DB.getAll('customers').then(function(allCustomers) {
        var container = document.getElementById('costDetailList');
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
        document.getElementById('costDetailModal').querySelector('.modal-title').innerText = '🏦 Nợ còn lại';
        document.getElementById('costDetailModal').style.display = 'flex';
    });
}

// ========== TOGGLE ĐỐI SOÁT QUỸ TRÊN MOBILE ==========
function toggleReconciliation() {
    var area = document.getElementById('reconciliationArea');
    var btn = document.getElementById('reconToggleBtn');
    if (!area || !btn) return;
    area.classList.toggle('recon-visible');
    var icon = btn.querySelector('.toggle-icon');
    if (icon) {
        icon.textContent = area.classList.contains('recon-visible') ? '▲' : '▼';
    }
}

// ========== MODAL TIỀN DƯ KHÁCH ==========
function showCreditBalanceModal() {
    DB.getAll('customers').then(function(allCustomers) {
        var container = document.getElementById('costDetailList');
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
        document.getElementById('costDetailModal').querySelector('.modal-title').innerText = '💰 Tiền dư khách (trả trước)';
        document.getElementById('costDetailModal').style.display = 'flex';
    });
}

// Export global
window.showActiveTablesModal = showActiveTablesModal;
window.showDebtTodayModal = showDebtTodayModal;
window.showRemainingDebtModal = showRemainingDebtModal;
window.showCreditBalanceModal = showCreditBalanceModal;
window.toggleReconciliation = toggleReconciliation;
