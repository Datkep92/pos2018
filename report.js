// report.js - Báo cáo doanh thu, chi phí theo ngày
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== BÁO CÁO ==========
function renderReport(dateObj) {
    var dateStr = dateObj.toISOString().slice(0, 10);
    document.getElementById('reportDate').innerText = formatDateDisplay(dateStr);
    
    Promise.all([
        DB.getTransactionsByDate(dateStr),
        DB.getAll('cost_transactions'),
        DB.get('daily_balances', dateStr)
    ]).then(function(results) {
        var transactions = results[0].filter(function(t) { return !t.refunded; });
        var allCosts = results[1] || [];
        var dailyBalance = results[2] || { cashKept: 0, cashReceived: 0 };
        
        // Gán giá trị đã lưu vào ô input tiền mặt thực nhận
        var actualCashInput = document.getElementById('actualCashInput');
        if (actualCashInput) {
            actualCashInput.value = dailyBalance.cashReceived || 0;
        }
        
        // Tính doanh thu
        var cashTotal = 0, transferTotal = 0, debtPaymentTotal = 0, grabTotal = 0;
        var dineinTotal = 0, takeawayTotal = 0;
        var dineinCount = 0, takeawayCount = 0, grabCount = 0;
        
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            if (tx.paymentMethod === 'cash') cashTotal += tx.amount;
            else if (tx.paymentMethod === 'transfer') transferTotal += tx.amount;
            else if (tx.paymentMethod === 'debt') debtPaymentTotal += tx.amount;
            else if (tx.paymentMethod === 'grab') grabTotal += tx.amount;
            
            if (tx.type === 'dinein') { dineinTotal += tx.amount; dineinCount++; }
            else if (tx.type === 'takeaway') { takeawayTotal += tx.amount; takeawayCount++; }
            else if (tx.type === 'grab') { grabTotal += tx.amount; grabCount++; }
        }
        
        var totalRevenue = cashTotal + transferTotal + debtPaymentTotal + grabTotal;
        
        var dailyCosts = allCosts.filter(function(c) { return c.dateKey === dateStr && !c.deleted; });
        var totalCost = dailyCosts.reduce(function(s, c) { return s + c.amount; }, 0);
        var netRevenue = totalRevenue - totalCost;
        
        // Lấy dư hôm trước
        var prevDate = new Date(dateObj);
        prevDate.setDate(prevDate.getDate() - 1);
        var prevDateStr = prevDate.toISOString().slice(0, 10);
        
        DB.get('daily_balances', prevDateStr).then(function(prevBalanceData) {
            var cashKeptPrev = (prevBalanceData && prevBalanceData.cashKept) || 0;
            var cashKeptToday = dailyBalance.cashKept || 0;
            
            var actualCashReceived = cashTotal + cashKeptPrev - cashKeptToday;
            
            var html = `
                <div class="stat-card">
                    <div class="stat-row"><span>💰 Tổng doanh thu</span><span class="stat-value primary">${formatMoney(totalRevenue)}</span></div>
                    <div class="stat-row"><span>🍽️ Tại chỗ (${dineinCount} đơn)</span><span>${formatMoney(dineinTotal)}</span></div>
                    <div class="stat-row"><span>🛵 Mang đi (${takeawayCount} đơn)</span><span>${formatMoney(takeawayTotal)}</span></div>
                    <div class="stat-row"><span>🚕 Grab (${grabCount} đơn)</span><span>${formatMoney(grabTotal)}</span></div>
                </div>
                <div class="stat-card">
                    <div class="stat-row"><span>💰 Tiền mặt</span><span class="stat-value success">${formatMoney(cashTotal)}</span></div>
                    <div class="stat-row"><span>💳 Chuyển khoản</span><span class="stat-value info">${formatMoney(transferTotal)}</span></div>
                    <div class="stat-row"><span>💢 Thanh toán nợ</span><span>${formatMoney(debtPaymentTotal)}</span></div>
                </div>
                <div class="stat-card">
                    <div class="stat-row cost-summary-row" onclick="showCostDetails('${dateStr}')">
                        <span>📊 Tổng chi phí</span>
                        <span class="stat-value warning">${formatMoney(totalCost)}</span>
                    </div>
                    <div class="stat-row"><span>📉 Doanh thu ròng</span><span class="stat-value ${netRevenue >= 0 ? 'success' : 'danger'}">${formatMoney(netRevenue)}</span></div>
                </div>
                <div class="stat-card">
                    <div class="stat-row"><span>🏦 Dư cuối ngày hôm trước</span><span>${formatMoney(cashKeptPrev)}</span></div>
                    <div class="stat-row"><span>🏧 Số dư cuối ngày (để lại quán)</span><span>${formatMoney(cashKeptToday)}</span></div>
                </div>
            `;
            document.getElementById('reportStats').innerHTML = html;
        });
    });
}

function showCostDetails(dateStr) {
    DB.getAll('cost_transactions').then(function(allCosts) {
        // Lọc tất cả chi phí trong ngày (không phân biệt loại)
        var filtered = allCosts.filter(function(c) {
            return c.dateKey === dateStr && !c.deleted;
        });
        var container = document.getElementById('costDetailList');
        if (!container) return;
        
        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state">📭 Không có chi phí nào trong ngày</div>';
        } else {
            var html = '';
            for (var i = 0; i < filtered.length; i++) {
                var c = filtered[i];
                html += '<div class="cost-detail-item">' +
                            '<span>' + escapeHtml(c.categoryName) + '</span>' +
                            '<span>' + formatMoney(c.amount) + '</span>' +
                        '</div>';
            }
            container.innerHTML = html;
        }
        // Hiển thị modal chi tiết chi phí
        document.getElementById('costDetailModal').style.display = 'flex';
    });
}

function changeReportDate(delta) { var nd = new Date(currentReportDate); nd.setDate(nd.getDate() + delta); currentReportDate = nd; renderReport(currentReportDate); }
