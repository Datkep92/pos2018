// manager.js - Bảng tổng quan (đã sửa lỗi, tương thích iOS 12)
var managerData = {
    currentViewMode: 'period',
    currentPeriod: { startDate: null, endDate: null },
    currentMonth: null,
    currentDay: null,
    transactions: [],
    costTransactions: [],
    adminCostTransactions: [],
    customers: [],
    staffs: []
};

var managerInitialized = false;

async function initManager() {
    if (managerInitialized) return;
    await loadAllData();
    initManagerFilter();          // sẽ gọi applyManagerFilter -> render
    attachManagerEvents();
    window.addEventListener('db_update', onManagerDBUpdate);
    managerInitialized = true;
}

async function loadAllData() {
    var promises = [
        DB.getAll('transactions'),
        DB.getAll('cost_transactions'),
        DB.getAll('cost_transactions_admin'),
        DB.getAll('customers'),
        DB.getAll('staffs')
    ];
    var results = await Promise.all(promises);
    managerData.transactions = results[0] || [];
    managerData.costTransactions = results[1] || [];
    managerData.adminCostTransactions = results[2] || [];
    managerData.customers = results[3] || [];
    managerData.staffs = results[4] || [];

    // Lọc giao dịch đã hủy
    managerData.transactions = managerData.transactions.filter(function(tx) {
        return !tx.refunded && tx.type !== 'refund';
    });
    // Lọc chi phí chưa xóa
    managerData.costTransactions = managerData.costTransactions.filter(function(c) { return !c.deleted; });
    managerData.adminCostTransactions = managerData.adminCostTransactions.filter(function(c) { return !c.deleted; });
}

function onManagerDBUpdate(event) {
    var col = event.detail && event.detail.collection;
    if (!col) return;
    var affected = ['transactions', 'cost_transactions', 'cost_transactions_admin', 'customers', 'staffs'];
    if (affected.indexOf(col) !== -1) {
        loadAllData().then(function() {
            if (document.getElementById('managerView') && document.getElementById('managerView').classList.contains('active')) {
                applyManagerFilter();
            }
        });
    }
}

// ========== BỘ LỌC THỜI GIAN ==========
function initManagerFilter() {
    computeCurrentPeriod();
    managerData.currentMonth = new Date();
    managerData.currentDay = new Date();
    updateManagerViewMode();
    attachFilterControls();
    applyManagerFilter();
}

function computeCurrentPeriod() {
    var now = new Date();
    var day = now.getDate();
    var month = now.getMonth();
    var year = now.getFullYear();
    var start, end;
    if (day >= 20) {
        start = new Date(year, month, 20);
        end = new Date(year, month + 1, 19);
    } else {
        start = new Date(year, month - 1, 20);
        end = new Date(year, month, 19);
    }
    if (isNaN(start.getTime())) start = new Date();
    if (isNaN(end.getTime())) end = new Date();
    managerData.currentPeriod = { startDate: start, endDate: end };
}

function shiftPeriod(delta) {
    var newStart = new Date(managerData.currentPeriod.startDate);
    newStart.setMonth(newStart.getMonth() + delta);
    newStart.setDate(20);
    var newEnd = new Date(newStart);
    newEnd.setMonth(newStart.getMonth() + 1);
    newEnd.setDate(19);
    if (isNaN(newStart.getTime())) newStart = new Date();
    if (isNaN(newEnd.getTime())) newEnd = new Date();
    managerData.currentPeriod = { startDate: newStart, endDate: newEnd };
    updateManagerViewMode();
    applyManagerFilter();
}

function shiftMonth(delta) {
    var newMonth = new Date(managerData.currentMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    if (isNaN(newMonth.getTime())) newMonth = new Date();
    managerData.currentMonth = newMonth;
    updateManagerViewMode();
    applyManagerFilter();
}

function shiftDay(delta) {
    var newDay = new Date(managerData.currentDay);
    newDay.setDate(newDay.getDate() + delta);
    if (isNaN(newDay.getTime())) newDay = new Date();
    managerData.currentDay = newDay;
    updateManagerViewMode();
    applyManagerFilter();
}

function formatDateShort(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '--/--/----';
    return date.getDate() + '/' + (date.getMonth()+1) + '/' + date.getFullYear();
}

function formatMonthYear(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '--/----';
    return (date.getMonth()+1) + '/' + date.getFullYear();
}

function updateManagerViewMode() {
    var select = document.getElementById('viewModeSelect');
    var display = document.getElementById('periodDisplay');
    if (!select || !display) return;
    var mode = select.value;
    managerData.currentViewMode = mode;
    if (mode === 'period') {
        var s = formatDateShort(managerData.currentPeriod.startDate);
        var e = formatDateShort(managerData.currentPeriod.endDate);
        display.innerText = s + ' → ' + e;
        select.options[0].text = 'Kỳ ' + s + ' → ' + e;
    } else if (mode === 'month') {
        var m = formatMonthYear(managerData.currentMonth);
        display.innerText = 'Tháng ' + m;
        select.options[1].text = 'Tháng ' + m;
    } else {
        var d = formatDateShort(managerData.currentDay);
        display.innerText = d;
        select.options[2].text = d;
    }
}

function attachFilterControls() {
    var prev = document.getElementById('periodPrevBtn');
    var next = document.getElementById('periodNextBtn');
    var mode = document.getElementById('viewModeSelect');
    if (prev) {
        prev.onclick = function() {
            if (managerData.currentViewMode === 'period') shiftPeriod(-1);
            else if (managerData.currentViewMode === 'month') shiftMonth(-1);
            else shiftDay(-1);
        };
    }
    if (next) {
        next.onclick = function() {
            if (managerData.currentViewMode === 'period') shiftPeriod(1);
            else if (managerData.currentViewMode === 'month') shiftMonth(1);
            else shiftDay(1);
        };
    }
    if (mode) {
        mode.onchange = function() {
            var newMode = this.value;
            managerData.currentViewMode = newMode;
            if (newMode === 'period') computeCurrentPeriod();
            else if (newMode === 'month') managerData.currentMonth = managerData.currentMonth || new Date();
            else if (newMode === 'day') managerData.currentDay = managerData.currentDay || new Date();
            updateManagerViewMode();
            applyManagerFilter();
        };
    }
}

function getDateRangeByMode() {
    var mode = managerData.currentViewMode;
    var start = null, end = null;
    if (mode === 'period') {
        if (managerData.currentPeriod && managerData.currentPeriod.startDate && managerData.currentPeriod.endDate) {
            start = new Date(managerData.currentPeriod.startDate);
            end = new Date(managerData.currentPeriod.endDate);
        } else {
            computeCurrentPeriod();
            start = new Date(managerData.currentPeriod.startDate);
            end = new Date(managerData.currentPeriod.endDate);
        }
    } else if (mode === 'month') {
        if (managerData.currentMonth) {
            start = new Date(managerData.currentMonth.getFullYear(), managerData.currentMonth.getMonth(), 1);
            end = new Date(managerData.currentMonth.getFullYear(), managerData.currentMonth.getMonth() + 1, 0);
        } else {
            managerData.currentMonth = new Date();
            start = new Date(managerData.currentMonth.getFullYear(), managerData.currentMonth.getMonth(), 1);
            end = new Date(managerData.currentMonth.getFullYear(), managerData.currentMonth.getMonth() + 1, 0);
        }
    } else { // day
        if (managerData.currentDay) {
            start = new Date(managerData.currentDay.getFullYear(), managerData.currentDay.getMonth(), managerData.currentDay.getDate());
            end = new Date(start);
            end.setDate(end.getDate() + 1);
        } else {
            managerData.currentDay = new Date();
            start = new Date(managerData.currentDay.getFullYear(), managerData.currentDay.getMonth(), managerData.currentDay.getDate());
            end = new Date(start);
            end.setDate(end.getDate() + 1);
        }
    }
    if (!start || isNaN(start.getTime())) start = new Date();
    if (!end || isNaN(end.getTime())) end = new Date();
    return { startDate: start, endDate: end };
}

function filterByDateRange(items, startDate, endDate) {
    if (!startDate || !endDate) return [];
    var startStr = startDate.toISOString().slice(0,10);
    var endStr = endDate.toISOString().slice(0,10);
    var result = [];
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var d = item.dateKey || item.date.slice(0,10);
        if (d >= startStr && d <= endStr) result.push(item);
    }
    return result;
}

function applyManagerFilter() {
    if (!managerData.transactions || !managerData.costTransactions || !managerData.adminCostTransactions || !managerData.customers) return;
    var range = getDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredTrans = filterByDateRange(managerData.transactions, range.startDate, range.endDate);
    var filteredCosts = filterByDateRange(managerData.costTransactions, range.startDate, range.endDate);
    var filteredAdminCosts = filterByDateRange(managerData.adminCostTransactions, range.startDate, range.endDate);
    var stats = computeStats(filteredTrans, filteredCosts, filteredAdminCosts, managerData.customers, managerData.staffs, range.startDate, range.endDate);
    updateManagerUI(stats);
    renderExpenseList(filteredCosts);
    renderAdminExpenseList(filteredAdminCosts);
    renderDebtList(managerData.customers);
}

function computeStats(transactions, staffCosts, adminCosts, customers, staffs, startDate, endDate) {
    var revenue = 0, grab = 0, bank = 0, cash = 0;
    for (var i = 0; i < transactions.length; i++) {
        var tx = transactions[i];
        var amt = tx.amount;
        revenue += amt;
        if (tx.paymentMethod === 'cash') cash += amt;
        else if (tx.paymentMethod === 'transfer') bank += amt;
        if (tx.customer && tx.customer.name === 'Grab') grab += amt;
    }
    var staffCostTotal = 0, adminCostTotal = 0;
    for (var j = 0; j < staffCosts.length; j++) staffCostTotal += staffCosts[j].amount;
    for (var k = 0; k < adminCosts.length; k++) adminCostTotal += adminCosts[k].amount;
    // Công nợ phát sinh trong kỳ
    var debtOccur = 0;
    var startStr = startDate.toISOString().slice(0,10);
    var endStr = endDate.toISOString().slice(0,10);
    for (var l = 0; l < customers.length; l++) {
        var cust = customers[l];
        var debts = cust.debtHistory || [];
        for (var m = 0; m < debts.length; m++) {
            var d = debts[m];
            var dStr = d.date ? d.date.slice(0,10) : '';
            if (dStr >= startStr && dStr <= endStr) debtOccur += d.amount;
        }
    }
    // Tổng nợ hiện tại
    var totalDebt = 0;
    for (var n = 0; n < customers.length; n++) {
        var debt = customers[n].totalDebt || 0;
        if (debt > 0) totalDebt += debt;
    }
    // Lương nhân viên (tạm để 0)
    var totalSalary = 0;
    var netIncome = revenue - (staffCostTotal + adminCostTotal + totalSalary);
    return {
        revenue: revenue, grab: grab, bank: bank, cash: cash,
        staffCost: staffCostTotal, adminCost: adminCostTotal,
        debtOccur: debtOccur, totalDebt: totalDebt,
        totalSalary: totalSalary, netIncome: netIncome
    };
}

function updateManagerUI(stats) {
    if (!stats) {
        var range = getDateRangeByMode();
        if (!range.startDate || !range.endDate) return;
        var filteredTrans = filterByDateRange(managerData.transactions, range.startDate, range.endDate);
        var filteredCosts = filterByDateRange(managerData.costTransactions, range.startDate, range.endDate);
        var filteredAdminCosts = filterByDateRange(managerData.adminCostTransactions, range.startDate, range.endDate);
        stats = computeStats(filteredTrans, filteredCosts, filteredAdminCosts, managerData.customers, managerData.staffs, range.startDate, range.endDate);
    }
    var el;
    if ((el = document.getElementById('managerRevenue'))) el.innerText = formatMoney(stats.revenue);
    if ((el = document.getElementById('managerGrab'))) el.innerText = formatMoney(stats.grab);
    if ((el = document.getElementById('managerBank'))) el.innerText = formatMoney(stats.bank);
    if ((el = document.getElementById('managerCash'))) el.innerText = formatMoney(stats.cash);
    if ((el = document.getElementById('managerExpense'))) el.innerText = formatMoney(stats.staffCost);
    if ((el = document.getElementById('managerAdminExpense'))) el.innerText = formatMoney(stats.adminCost);
    if ((el = document.getElementById('managerDebt'))) el.innerText = formatMoney(stats.debtOccur);
    if ((el = document.getElementById('managerTotalDebt'))) el.innerText = formatMoney(stats.totalDebt);
    if ((el = document.getElementById('managerTotalSalary'))) el.innerText = formatMoney(stats.totalSalary);
    if ((el = document.getElementById('managerNetIncome'))) el.innerText = formatMoney(stats.netIncome);
}

function renderExpenseList(costs) {
    var container = document.getElementById('managerExpenseList');
    if (!container) return;
    if (!costs) costs = [];
    var map = {};
    for (var i = 0; i < costs.length; i++) {
        var c = costs[i];
        var name = c.categoryName;
        if (!map[name]) map[name] = 0;
        map[name] += c.amount;
    }
    var html = '';
    for (var name in map) {
        html += '<div class="manager-item" onclick="showExpenseDetail(\'' + escapeHtml(name) + '\')">' +
            '<span>📦 ' + escapeHtml(name) + '</span>' +
            '<strong>' + formatMoney(map[name]) + '</strong>' +
        '</div>';
    }
    if (!html) html = '<div class="empty-state">Chưa có chi phí nhân viên</div>';
    container.innerHTML = html;
}

function renderAdminExpenseList(costs) {
    var container = document.getElementById('managerAdminExpenseList');
    if (!container) return;
    if (!costs) costs = [];
    var map = {};
    for (var i = 0; i < costs.length; i++) {
        var c = costs[i];
        var name = c.categoryName;
        if (!map[name]) map[name] = { amount: 0, qty: 0 };
        map[name].amount += c.amount;
        map[name].qty += c.quantity || 1;
    }
    var html = '';
    for (var name in map) {
        html += '<div class="manager-item" onclick="showAdminExpenseDetail(\'' + escapeHtml(name) + '\')">' +
            '<span>🏢 ' + escapeHtml(name) + '</span>' +
            '<strong>SL:' + map[name].qty + ' • ' + formatMoney(map[name].amount) + '</strong>' +
        '</div>';
    }
    if (!html) html = '<div class="empty-state">Chưa có chi phí quản lý</div>';
    container.innerHTML = html;
}

function renderDebtList(customers) {
    var container = document.getElementById('managerDebtList');
    if (!container) return;
    if (!customers) customers = [];
    var debtCust = [];
    for (var i = 0; i < customers.length; i++) {
        var cust = customers[i];
        if (cust.totalDebt && cust.totalDebt > 0) debtCust.push(cust);
    }
    debtCust.sort(function(a,b) { return b.totalDebt - a.totalDebt; });
    var html = '';
    for (var j = 0; j < debtCust.length; j++) {
        var c = debtCust[j];
        html += '<div class="manager-item" onclick="showDebtDetail(\'' + c.id + '\')">' +
            '<span>👤 ' + escapeHtml(c.name) + '</span>' +
            '<strong style="color:var(--danger);">Nợ: ' + formatMoney(c.totalDebt) + '</strong>' +
        '</div>';
    }
    if (!html) html = '<div class="empty-state">Không có khách nợ</div>';
    container.innerHTML = html;
}

// ========== CHI TIẾT ==========
function showExpenseDetail(categoryName) {
    var all = managerData.costTransactions;
    var filtered = [];
    for (var i = 0; i < all.length; i++) {
        if (all[i].categoryName === categoryName) filtered.push(all[i]);
    }
    filtered.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    var html = '<div class="cost-history-header">📜 Lịch sử chi phí: <strong>' + escapeHtml(categoryName) + '</strong></div>';
    if (filtered.length === 0) html += '<div class="empty-state">Chưa có giao dịch</div>';
    else {
        html += '<div class="cost-history-list">';
        for (var j = 0; j < filtered.length; j++) {
            var tx = filtered[j];
            html += '<div class="cost-history-item">' +
                '<div class="cost-history-date">' + new Date(tx.date).toLocaleDateString('vi-VN') + ' ' + new Date(tx.date).toLocaleTimeString('vi-VN') + '</div>' +
                '<div class="cost-history-amount">' + formatMoney(tx.amount) + (tx.quantity > 1 ? ' x' + tx.quantity : '') + '</div>' +
                (tx.note ? '<div class="cost-history-note">' + escapeHtml(tx.note) + '</div>' : '') +
            '</div>';
        }
        html += '</div>';
    }
    var contentDiv = document.getElementById('costHistoryList');
    var titleSpan = document.getElementById('costHistoryTitle');
    if (contentDiv) contentDiv.innerHTML = html;
    if (titleSpan) titleSpan.innerHTML = '📜 Lịch sử chi phí - ' + escapeHtml(categoryName);
    var modal = document.getElementById('costHistoryModal');
    if (modal) modal.style.display = 'flex';
}

function showAdminExpenseDetail(categoryName) {
    var all = managerData.adminCostTransactions;
    var filtered = [];
    for (var i = 0; i < all.length; i++) {
        if (all[i].categoryName === categoryName) filtered.push(all[i]);
    }
    filtered.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    var html = '<div class="cost-history-header">📜 Lịch sử chi phí quản lý: <strong>' + escapeHtml(categoryName) + '</strong></div>';
    if (filtered.length === 0) html += '<div class="empty-state">Chưa có giao dịch</div>';
    else {
        html += '<div class="cost-history-list">';
        for (var j = 0; j < filtered.length; j++) {
            var tx = filtered[j];
            html += '<div class="cost-history-item">' +
                '<div class="cost-history-date">' + new Date(tx.date).toLocaleDateString('vi-VN') + ' ' + new Date(tx.date).toLocaleTimeString('vi-VN') + '</div>' +
                '<div class="cost-history-amount">' + formatMoney(tx.amount) + (tx.quantity > 1 ? ' x' + tx.quantity : '') + '</div>' +
                (tx.note ? '<div class="cost-history-note">' + escapeHtml(tx.note) + '</div>' : '') +
            '</div>';
        }
        html += '</div>';
    }
    var contentDiv = document.getElementById('costHistoryList');
    var titleSpan = document.getElementById('costHistoryTitle');
    if (contentDiv) contentDiv.innerHTML = html;
    if (titleSpan) titleSpan.innerHTML = '📜 Lịch sử chi phí quản lý - ' + escapeHtml(categoryName);
    var modal = document.getElementById('costHistoryModal');
    if (modal) modal.style.display = 'flex';
}

function showDebtDetail(customerId) {
    if (typeof renderCustomerDetail === 'function') renderCustomerDetail(customerId);
    else showToast('Chức năng đang cập nhật', 'info');
}

function attachManagerEvents() {
    var adminExpenseBtn = document.getElementById('adminExpenseFab');
    if (adminExpenseBtn) {
        adminExpenseBtn.onclick = function(e) {
            e.stopPropagation();
            if (typeof openCostModal === 'function') openCostModal('admin');
            else showToast('Chưa có module chi phí', 'error');
        };
    }
    // Xử lý đóng/mở các card (collapsible) - thay vì dùng closest, dùng parentNode duyệt lên
    var headers = document.querySelectorAll('.toggle-header');
    for (var i = 0; i < headers.length; i++) {
        headers[i].onclick = function(e) {
            var card = this.parentNode;
            while (card && card.nodeType === 1 && !card.classList.contains('card')) {
                card = card.parentNode;
            }
            if (card && card.classList) card.classList.toggle('collapsed');
            e.stopPropagation();
        };
    }
}

// Xuất global
window.initManager = initManager;