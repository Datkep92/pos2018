// ========== BÁO CÁO DOANH THU & THỐNG KÊ NÂNG CAO (CÓ LỊCH NGÀY) ==========

let currentReportDate = new Date();
let cachedTransactions = null, cachedReportTables = null, cachedCustomers = null;
let lastCacheTime = 0;
let cachedDateKey = '';
const CACHE_TTL = 5000;
let reportDateDebounceTimer;

async function getReportData(selectedDateStr) {
    const now = Date.now();
    if (cachedDateKey === selectedDateStr && cachedTransactions && cachedReportTables && cachedCustomers && (now - lastCacheTime) < CACHE_TTL) {
        return { transactions: cachedTransactions, tables: cachedReportTables, customers: cachedCustomers };
    }
    const [transactions, tables, customers] = await Promise.all([
        DB.getTransactionsByDate(selectedDateStr),
        DB.getAll('tables'),
        DB.getAll('customers')
    ]);
    cachedTransactions = transactions;
    cachedReportTables = tables;
    cachedCustomers = customers;
    cachedDateKey = selectedDateStr;
    lastCacheTime = now;
    return { transactions, tables, customers };
}

function resetReportCache() {
    cachedTransactions = null;
    cachedReportTables = null;
    cachedCustomers = null;
    cachedDateKey = '';
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

async function syncHistoricalReports() {
    if (!isOnline) return;
    var now = Date.now();
    var lastSync = SYNC_CONFIG.reports.lastSync;
    if (lastSync && (now - lastSync) < 12 * 3600000) {
        console.log('Historical sync reports skipped, last sync within 12h');
        return;
    }
    var startDate = new Date();
    startDate.setDate(startDate.getDate() - SYNC_CONFIG.reports.daysToSync);
    var startDateStr = startDate.toISOString().slice(0,10);
    var endDateStr = new Date().toISOString().slice(0,10);
    console.log('Starting historical sync for reports from', startDateStr, 'to', endDateStr);
    
    var ref = db.ref(CURRENT_SHOP_ID + '/reports');
    var query = ref.orderByChild('dateKey').startAt(startDateStr).endAt(endDateStr);
    var snapshot = await query.once('value');
    var remoteData = snapshot.val() || {};
    
    var count = 0;
    for (var key in remoteData) {
        if (remoteData.hasOwnProperty(key)) {
            var remoteItem = remoteData[key];
            remoteItem.id = key;
            var localItem = await loadFromLocal('reports', key);
            var remoteVersion = remoteItem._version || 0;
            var localVersion = localItem ? (localItem._version || 0) : 0;
            if (remoteVersion > localVersion) {
                await saveToLocal('reports', remoteItem);
                count++;
            }
        }
    }
    SYNC_CONFIG.reports.lastSync = now;
    saveSyncMetadata();
    console.log('Historical sync reports completed, updated', count, 'records');
}

async function renderReport() {
    const container = document.getElementById('reportContent');
    if (!container) return;

    const selectedDateStr = currentReportDate.toISOString().slice(0, 10);
    const { transactions, tables, customers } = await getReportData(selectedDateStr);
  
    // === LỌC GIAO DỊCH HỢP LỆ (CHƯA BỊ HỦY) ===
    const activeTransactions = transactions.filter(tx => tx.refunded !== true && tx.type !== 'refund');
    const refundTransactions = transactions.filter(tx => tx.type === 'refund' || tx.refunded === true);
    const totalRefundAmount = refundTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    
    const todayStr = new Date().toISOString().slice(0, 10);
    const isToday = (selectedDateStr === todayStr);
    const dateTitle = formatDateDisplay(selectedDateStr);
    const dateDisplay = isToday ? `Hôm nay - ${dateTitle}` : dateTitle;

    // 1. Đã thanh toán (chỉ tính activeTransactions)
    let paidOrders = 0, paidRevenue = 0;
    let cashAmount = 0, cashCount = 0;
    let transferAmount = 0, transferCount = 0;
    let takeawayCount = 0, takeawayTotal = 0;
    let dineinCount = 0, dineinTotal = 0;
    let debtPaymentCount = 0, debtPaymentTotal = 0;

    for (const tx of activeTransactions) {
        const amount = tx.amount;
        paidOrders++;
        paidRevenue += amount;
        if (tx.paymentMethod === 'cash') {
            cashAmount += amount;
            cashCount++;
        } else if (tx.paymentMethod === 'transfer') {
            transferAmount += amount;
            transferCount++;
        }
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

    // 2. Chưa thanh toán (bàn đang phục vụ) - không đổi
    const pendingTables = tables.filter(t => t.status === 'occupied' && t.items && t.items.length > 0 && (t.total || 0) > 0);
    const pendingCount = pendingTables.length;
    const pendingAmount = pendingTables.reduce((sum, t) => sum + (t.total || 0), 0);

    // 3. Khách nợ hôm nay - không đổi
    let debtTodayCount = 0, debtTodayAmount = 0;
    for (const cust of customers) {
        const debtHistory = cust.debtHistory || [];
        const todayDebts = debtHistory.filter(d => d.date && d.date.slice(0, 10) === selectedDateStr);
        if (todayDebts.length > 0) {
            debtTodayCount++;
            debtTodayAmount += todayDebts.reduce((s, d) => s + (d.amount || 0), 0);
        }
    }

    // 4. Tổng nợ toàn bộ - không đổi
    let totalDebtCustomers = 0, totalDebtAmount = 0;
    for (const cust of customers) {
        const debt = cust.totalDebt || 0;
        if (debt > 0) {
            totalDebtCustomers++;
            totalDebtAmount += debt;
        }
    }

    // 5. Top món bán chạy (chỉ tính từ activeTransactions)
    const itemSales = {};
    for (const tx of activeTransactions) {
        if (tx.type === 'debt_payment') continue;
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
    var topItems = Object.entries(itemSales)
        .map(function(pair) { return { name: pair[0], qty: pair[1].qty, revenue: pair[1].revenue }; })
        .sort(function(a, b) { return b.qty - a.qty; })
        .slice(0, 10);

    // 6. Render HTML (thêm dòng hiển thị hoàn tiền nếu có)
    container.innerHTML = `
        <div class="report-date-bar">
            <button id="reportPrevDay" class="nav-btn">‹</button>
            <div class="report-date-display">📅 ${dateDisplay}</div>
            <button id="reportNextDay" class="nav-btn">›</button>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">⏳</div>
                <div class="stat-info">
                    <div class="stat-value">${pendingCount} Bàn chưa TT</div>
                    <div class="stat-amount">${formatMoney(pendingAmount)}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">✅</div>
                <div class="stat-info">
                    <div class="stat-value">${paidOrders} Đã thanh toán</div>
                    <div class="stat-amount">${formatMoney(paidRevenue)}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">💰</div>
                <div class="stat-info">
                    <div class="stat-label">Tiền mặt</div>
                    <div class="stat-value">${cashCount} giao dịch</div>
                    <div class="stat-amount">${formatMoney(cashAmount)}</div>
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">💳</div>
                <div class="stat-info">
                    <div class="stat-label">Chuyển khoản</div>
                    <div class="stat-value">${transferCount} giao dịch</div>
                    <div class="stat-amount">${formatMoney(transferAmount)}</div>
                </div>
            </div>
        </div>

        <div class="summary-card">
            <div class="summary-title">📊 Chi tiết doanh thu</div>
            <div class="summary-row small"><span>🛵 Mang đi: ${takeawayCount} đơn</span><span>${formatMoney(takeawayTotal)}</span></div>
            <div class="summary-row small"><span>🍽️ Tại chỗ: ${dineinCount} đơn</span><span>${formatMoney(dineinTotal)}</span></div>
            <div class="summary-row small"><span>💸 Thu nợ: ${debtPaymentCount} giao dịch</span><span>${formatMoney(debtPaymentTotal)}</span></div>
        </div>

        ${totalRefundAmount > 0 ? `
        <div class="summary-card" style="background:#fee2e2;">
            <div class="summary-title">🔄 Hoàn tiền trong ngày</div>
            <div class="summary-row"><span>Tổng hoàn trả</span><span class="summary-highlight" style="color:#dc2626;">- ${formatMoney(totalRefundAmount)}</span></div>
            <div class="summary-row small">(Các giao dịch đã hủy)</div>
        </div>
        ` : ''}

        <div class="summary-card">
            <div class="summary-title">💢 Khách nợ</div>
            <div class="summary-row"><span>Nợ phát sinh trong ngày</span><span class="summary-highlight">${debtTodayCount} khách - ${formatMoney(debtTodayAmount)}</span></div>
            <div class="summary-row"><span>Tổng nợ toàn bộ (tới nay)</span><span class="summary-highlight">${totalDebtCustomers} khách - ${formatMoney(totalDebtAmount)}</span></div>
        </div>

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
    const txs = await DB.getTransactionsByDate(dateStr);
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