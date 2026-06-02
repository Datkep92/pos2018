// ========== BÁO CÁO DOANH THU & THỐNG KÊ NÂNG CAO (CÓ LỊCH NGÀY) ==========

let currentReportDate = new Date();
let cachedTransactions = null, cachedTables = null, cachedCustomers = null;
let lastCacheTime = 0;
const CACHE_TTL = 5000;
let reportDateDebounceTimer;

async function getReportData() {
    const now = Date.now();
    if (cachedTransactions && cachedTables && cachedCustomers && (now - lastCacheTime) < CACHE_TTL) {
        return { transactions: cachedTransactions, tables: cachedTables, customers: cachedCustomers };
    }
    const [transactions, tables, customers] = await Promise.all([
        DB.getAll('transactions'),
        DB.getAll('tables'),
        DB.getAll('customers')
    ]);
    cachedTransactions = transactions;
    cachedTables = tables;
    cachedCustomers = customers;
    lastCacheTime = now;
    return { transactions, tables, customers };
}

function resetReportCache() {
    cachedTransactions = null;
    cachedTables = null;
    cachedCustomers = null;
    lastCacheTime = 0;
}
window.resetReportCache = resetReportCache;

async function changeReportDate(delta) {
    if (reportDateDebounceTimer) clearTimeout(reportDateDebounceTimer);
    reportDateDebounceTimer = setTimeout(async () => {
        const newDate = new Date(currentReportDate);
        newDate.setDate(newDate.getDate() + delta);
        currentReportDate = newDate;
        await renderReport();
    }, 80);
}
async function initReport() {
    await renderReport();
    attachReportDateControls();
}

function attachReportDateControls() {
    const prevBtn = document.getElementById('reportPrevDay');
    const nextBtn = document.getElementById('reportNextDay');
    if (prevBtn) prevBtn.onclick = () => changeReportDate(-1);
    if (nextBtn) nextBtn.onclick = () => changeReportDate(1);
}



async function renderReport() {
    const container = document.getElementById('reportContent');
    if (!container) return;

    const { transactions, tables, customers } = await getReportData();
  
    const selectedDateStr = currentReportDate.toISOString().slice(0, 10);
    const todayStr = new Date().toISOString().slice(0, 10);
    const isToday = (selectedDateStr === todayStr);
    const dateTitle = formatDateDisplay(selectedDateStr);
    const dateDisplay = isToday ? `Hôm nay - ${dateTitle}` : dateTitle;

    // 1. Đã thanh toán (transactions trong ngày) - bao gồm cả thanh toán nợ
    const selectedTxs = transactions.filter(tx => tx.date?.slice(0, 10) === selectedDateStr);
    let paidOrders = 0, paidRevenue = 0;
    let cashAmount = 0, cashCount = 0;
    let transferAmount = 0, transferCount = 0;
    let takeawayCount = 0, takeawayTotal = 0;
    let dineinCount = 0, dineinTotal = 0;
    let debtPaymentCount = 0, debtPaymentTotal = 0;

    for (const tx of selectedTxs) {
        const amount = tx.amount;
        // Tất cả các giao dịch đều đóng góp vào doanh thu và số đơn
        paidOrders++;
        paidRevenue += amount;
        if (tx.paymentMethod === 'cash') {
            cashAmount += amount;
            cashCount++;
        } else if (tx.paymentMethod === 'transfer') {
            transferAmount += amount;
            transferCount++;
        }
        // Phân loại theo loại hình (chỉ dành cho bán hàng)
        if (tx.type === 'takeaway') {
            takeawayCount++;
            takeawayTotal += amount;
        } else if (tx.type === 'dinein') {
            dineinCount++;
            dineinTotal += amount;
        } else if (tx.type === 'debt_payment') {
            debtPaymentCount++;
            debtPaymentTotal += amount;
        }
    }

    // 2. Chưa thanh toán (bàn đang phục vụ)
    const pendingTables = tables.filter(t => t.status === 'occupied' && t.items?.length > 0 && (t.total || 0) > 0);
    const pendingCount = pendingTables.length;
    const pendingAmount = pendingTables.reduce((sum, t) => sum + (t.total || 0), 0);

    // 3. Khách nợ hôm nay (phát sinh nợ mới, không phải thanh toán)
    let debtTodayCount = 0, debtTodayAmount = 0;
    for (const cust of customers) {
        const debtHistory = cust.debtHistory || [];
        const todayDebts = debtHistory.filter(d => d.date?.slice(0, 10) === selectedDateStr);
        if (todayDebts.length > 0) {
            debtTodayCount++;
            const totalToday = todayDebts.reduce((s, d) => s + (d.amount || 0), 0);
            debtTodayAmount += totalToday;
        }
    }

  let totalDebtCustomers = 0, totalDebtAmount = 0;
  
for (const cust of customers) {
    const debt = cust.totalDebt || 0;
    if (debt > 0) {          // chỉ tính khách đang nợ (dương)
        totalDebtCustomers++;
        totalDebtAmount += debt;
    }
}

    // 5. Top món bán chạy (chỉ tính từ giao dịch bán hàng takeaway/dinein, không tính debt_payment vì không có món)
    const itemSales = {};
    for (const tx of selectedTxs) {
        if (tx.type === 'debt_payment') continue; // bỏ qua thanh toán nợ vì không có món
        const items = tx.items || [];
        for (const item of items) {
            const name = item.name;
            const qty = item.qty || 0;
            const price = item.price || 0;
            if (!itemSales[name]) itemSales[name] = { qty: 0, revenue: 0 };
            itemSales[name].qty += qty;
            itemSales[name].revenue += price * qty;
        }
    }
    const topItems = Object.entries(itemSales)
        .map(([name, data]) => ({ name, ...data }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 10);

    // 6. Render HTML (có thêm dòng thu nợ nếu cần)
    container.innerHTML = `
        <div class="report-date-bar">
            <button id="reportPrevDay" class="nav-btn">‹</button>
            <div class="report-date-display">📅 ${dateDisplay}</div>
            <button id="reportNextDay" class="nav-btn">›</button>
        </div>

        <div class="stats-grid">
            <!-- Chưa thanh toán -->
            <div class="stat-card">
                <div class="stat-icon">⏳</div>
                <div class="stat-info">
                    <div class="stat-value">${pendingCount} Bàn chưa TT</div>
                    <div class="stat-amount">${formatMoney(pendingAmount)}</div>
                </div>
            </div>
            <!-- Đã thanh toán -->
            <div class="stat-card">
                <div class="stat-icon">✅</div>
                <div class="stat-info">
                    <div class="stat-value">${paidOrders} Đã thanh toán</div>
                    <div class="stat-amount">${formatMoney(paidRevenue)}</div>
                </div>
            </div>
            <!-- Tiền mặt -->
            <div class="stat-card">
                <div class="stat-icon">💰</div>
                <div class="stat-info">
                    <div class="stat-label">Tiền mặt</div>
                    <div class="stat-value">${cashCount} giao dịch</div>
                    <div class="stat-amount">${formatMoney(cashAmount)}</div>
                </div>
            </div>
            <!-- Chuyển khoản -->
            <div class="stat-card">
                <div class="stat-icon">💳</div>
                <div class="stat-info">
                    <div class="stat-label">Chuyển khoản</div>
                    <div class="stat-value">${transferCount} giao dịch</div>
                    <div class="stat-amount">${formatMoney(transferAmount)}</div>
                </div>
            </div>
        </div>

        <!-- Chi tiết theo loại hình bán hàng -->
        <div class="summary-card">
            <div class="summary-title">📊 Chi tiết doanh thu</div>
            <div class="summary-row small"><span>🛵 Mang đi: ${takeawayCount} đơn</span><span>${formatMoney(takeawayTotal)}</span></div>
            <div class="summary-row small"><span>🍽️ Tại chỗ: ${dineinCount} đơn</span><span>${formatMoney(dineinTotal)}</span></div>
            <div class="summary-row small"><span>💸 Thu nợ: ${debtPaymentCount} giao dịch</span><span>${formatMoney(debtPaymentTotal)}</span></div>
        </div>

        <!-- Khách nợ -->
        <div class="summary-card" style="background: linear-gradient;">
            <div class="summary-title">💢 Khách nợ</div>
            <div class="summary-row"><span>Nợ phát sinh trong ngày</span><span class="summary-highlight">${debtTodayCount} khách - ${formatMoney(debtTodayAmount)}</span></div>
            <div class="summary-row"><span>Tổng nợ toàn bộ (tới nay)</span><span class="summary-highlight">${totalDebtCustomers} khách - ${formatMoney(totalDebtAmount)}</span></div>
        </div>

        <!-- Top món bán chạy -->
        <div class="history-title">🔥 Top món bán chạy (ngày ${dateTitle})</div>
        <div class="history-list">
            ${topItems.length === 0 ? '<div class="empty-state">Chưa có dữ liệu</div>' : topItems.map((item, idx) => `
                <div class="history-item" style="display: flex; justify-content: space-between; align-items: center;">
                    <div><strong>${idx+1}. ${escapeHtml(item.name)}</strong></div>
                    <div>📦 ${item.qty} món &nbsp;💰 ${formatMoney(item.revenue)}</div>
                </div>
            `).join('')}
        </div>

        <button class="export-btn" onclick="exportReportByDate()">📎 Xuất báo cáo (ngày đang xem)</button>
    `;

    attachReportDateControls();
}

function formatDateDisplay(dateStr) {
    const d = new Date(dateStr);
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

async function exportReportByDate() {
    const dateStr = currentReportDate.toISOString().slice(0, 10);
    const transactions = await DB.getAll('transactions');
    const txs = transactions.filter(tx => tx.date?.slice(0, 10) === dateStr);
    let takeawayTotal = 0, dineinTotal = 0, cashTotal = 0, transferTotal = 0;
    let cashCount = 0, transferCount = 0;
    for (const tx of txs) {
        if (tx.type === 'takeaway') takeawayTotal += tx.amount;
        else if (tx.type === 'dinein') dineinTotal += tx.amount;
        if (tx.paymentMethod === 'cash') {
            cashTotal += tx.amount;
            cashCount++;
        } else if (tx.paymentMethod === 'transfer') {
            transferTotal += tx.amount;
            transferCount++;
        }
    }
    const content = `Báo cáo ngày ${dateStr}
Mang đi: ${formatMoney(takeawayTotal)} (${txs.filter(t=>t.type==='takeaway').length} đơn)
Tại chỗ: ${formatMoney(dineinTotal)} (${txs.filter(t=>t.type==='dinein').length} đơn)
Tiền mặt: ${formatMoney(cashTotal)} (${cashCount} giao dịch)
Chuyển khoản: ${formatMoney(transferTotal)} (${transferCount} giao dịch)
Tổng: ${formatMoney(takeawayTotal + dineinTotal)}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `baocao_${dateStr}.txt`;
    link.click();
    showToast('Đã xuất báo cáo', 'success');
}

window.initReport = initReport;
window.renderReport = renderReport;
window.changeReportDate = changeReportDate;
window.exportReportByDate = exportReportByDate;