// manager.js - Tích hợp quản lý chi phí và bảng tổng quan
// Không còn tab chi phí riêng, chỉ dùng popup nhập chi phí.

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
    await loadStaffCostData();
    await loadAdminCostData();
    managerInitFilter();
    attachManagerEvents();
    attachCostPopupEvents();
    renderLowStockAlert();   // thêm dòng này
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

    // Lọc giao dịch chưa hủy
    managerData.transactions = managerData.transactions.filter(function(tx) {
        return !tx.refunded && tx.type !== 'refund';
    });
    managerData.costTransactions = managerData.costTransactions.filter(function(c) { return !c.deleted; });
    managerData.adminCostTransactions = managerData.adminCostTransactions.filter(function(c) { return !c.deleted; });
}

function onManagerDBUpdate(event) {
    var col = event.detail && event.detail.collection;
    if (!col) return;
var affected = ['transactions', 'cost_transactions', 'cost_transactions_admin', 'customers', 'staffs', 'ingredients', 'cost_categories', 'admin_cost_categories'];
    if (affected.indexOf(col) !== -1) {
        loadAllData().then(function() {
    if (document.getElementById('managerView').classList.contains('active')) {
        managerApplyFilter();
        if (col === 'ingredients') {
            renderLowStockAlert();  // cập nhật riêng cho nguyên liệu
        }
    }
});
    }
}

function managerInitFilter() {
    managerComputeCurrentPeriod();
    managerData.currentMonth = new Date();
    managerData.currentDay = new Date();
    updateManagerViewMode();      // cập nhật text dropdown lần đầu
    attachFilterControls();
    managerApplyFilter();
}

function managerComputeCurrentPeriod() {
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

function managerShiftPeriod(delta) {
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
    managerApplyFilter();
}

function managerShiftMonth(delta) {
    var newMonth = new Date(managerData.currentMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    if (isNaN(newMonth.getTime())) newMonth = new Date();
    managerData.currentMonth = newMonth;
    updateManagerViewMode();
    managerApplyFilter();
}

function managerShiftDay(delta) {
    var newDay = new Date(managerData.currentDay);
    newDay.setDate(newDay.getDate() + delta);
    if (isNaN(newDay.getTime())) newDay = new Date();
    managerData.currentDay = newDay;
    updateManagerViewMode();
    managerApplyFilter();
}

function managerFormatDateShort(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '--/--/----';
    var d = date.getDate();
    var m = date.getMonth() + 1;
    var y = date.getFullYear();
    return d + '/' + m + '/' + y;
}

function managerFormatMonthYear(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '--/----';
    var m = date.getMonth() + 1;
    var y = date.getFullYear();
    return m + '/' + y;
}

function updateManagerViewMode() {
    var select = document.getElementById('managerViewModeSelect');
    if (!select) return;

    var mode = select.value;
    managerData.currentViewMode = mode;

    if (mode === 'period') {
        var s = managerFormatDateShort(managerData.currentPeriod.startDate);
        var e = managerFormatDateShort(managerData.currentPeriod.endDate);
        var rangeText = s + ' → ' + e;

        //if (display) display.innerText = rangeText;
        if (select.options[0]) select.options[0].text = 'Kỳ ' + rangeText;

    } else if (mode === 'month') {
        var monthText = managerFormatMonthYear(managerData.currentMonth);

        //if (display) display.innerText = 'Tháng ' + monthText;
        if (select.options[1]) select.options[1].text = 'Tháng ' + monthText;

    } else {
        var dayText = managerFormatDateShort(managerData.currentDay);

        //if (display) display.innerText = dayText;
        if (select.options[2]) select.options[2].text = dayText;
    }
}


async function renderMonthCostCategories() {
    var container = document.getElementById('monthCostCategoryList');
    if (!container) return;

    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();

    var map = {};

    managerData.costTransactions.forEach(function(tx){
        if (tx.deleted) return;

        var d = new Date(tx.date);

        if (
            d.getFullYear() === year &&
            d.getMonth() === month
        ) {
            if (!map[tx.categoryName]) {
                map[tx.categoryName] = 0;
            }

            map[tx.categoryName] += tx.amount;
        }
    });

    var html = '';

    Object.keys(map)
        .sort(function(a,b){
            return map[b] - map[a];
        })
        .forEach(function(name){

            html +=
            '<div class="today-cost-item" ' +
            'onclick="showExpenseDetail(\'' +
            name.replace(/'/g,"\\'") +
            '\')">' +

                '<div class="today-cost-name">' +
                    escapeHtml(name) +
                '</div>' +

                '<div class="today-cost-amount">' +
                    formatMoney(map[name]) +
                '</div>' +

            '</div>';
        });

    if (!html) {
        html =
        '<div class="empty-text">📭 Chưa có dữ liệu tháng này</div>';
    }

    container.innerHTML = html;
}

function attachFilterControls() {
    var prev = document.getElementById('managerPeriodPrevBtn');
    var next = document.getElementById('managerPeriodNextBtn');
    var mode = document.getElementById('managerViewModeSelect');
    if (prev) {
        prev.onclick = function() {
            if (managerData.currentViewMode === 'period') managerShiftPeriod(-1);
            else if (managerData.currentViewMode === 'month') managerShiftMonth(-1);
            else managerShiftDay(-1);
        };
    }
    if (next) {
        next.onclick = function() {
            if (managerData.currentViewMode === 'period') managerShiftPeriod(1);
            else if (managerData.currentViewMode === 'month') managerShiftMonth(1);
            else managerShiftDay(1);
        };
    }
    if (mode) {
        mode.onchange = function() {
            var newMode = this.value;
            managerData.currentViewMode = newMode;
            if (newMode === 'period') managerComputeCurrentPeriod();
            else if (newMode === 'month') managerData.currentMonth = managerData.currentMonth || new Date();
            else if (newMode === 'day') managerData.currentDay = managerData.currentDay || new Date();
            updateManagerViewMode();
            managerApplyFilter();
        };
    }
}

function managerGetDateRangeByMode() {
    var mode = managerData.currentViewMode;
    var start = null, end = null;
    if (mode === 'period') {
        if (managerData.currentPeriod && managerData.currentPeriod.startDate && managerData.currentPeriod.endDate) {
            start = new Date(managerData.currentPeriod.startDate);
            end = new Date(managerData.currentPeriod.endDate);
        } else {
            managerComputeCurrentPeriod();
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
    } else {
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

function managerFilterByDateRange(items, startDate, endDate) {
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

function managerApplyFilter() {
    if (!managerData.transactions || !managerData.costTransactions || !managerData.adminCostTransactions || !managerData.customers) return;
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    var filteredCosts = managerFilterByDateRange(managerData.costTransactions, range.startDate, range.endDate);
    var filteredAdminCosts = managerFilterByDateRange(managerData.adminCostTransactions, range.startDate, range.endDate);
    var stats = managerComputeStats(filteredTrans, filteredCosts, filteredAdminCosts, managerData.customers, managerData.staffs, range.startDate, range.endDate);
    updateManagerUI(stats);
    renderExpenseList(filteredCosts);
    renderAdminExpenseList(filteredAdminCosts);
    renderManagerDebtList(managerData.customers);
    
    // 👇 THÊM HAI DÒNG NÀY
    renderDrinkStats();
    renderLowStockAlert();
}

function managerComputeStats(transactions, staffCosts, adminCosts, customers, staffs, startDate, endDate) {
    var revenue = 0, grab = 0, bank = 0, cash = 0;
    for (var i = 0; i < transactions.length; i++) {
        var tx = transactions[i];
        var amt = tx.amount;
        revenue += amt;
        if (tx.type === 'grab') {
            grab += amt;
        } else if (tx.paymentMethod === 'cash') {
            cash += amt;
        } else if (tx.paymentMethod === 'transfer') {
            bank += amt;
        }
    }
    var staffCostTotal = 0, adminCostTotal = 0;
    for (var j = 0; j < staffCosts.length; j++) staffCostTotal += staffCosts[j].amount;
    for (var k = 0; k < adminCosts.length; k++) adminCostTotal += adminCosts[k].amount;
    
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
    var totalDebt = 0;
    for (var n = 0; n < customers.length; n++) {
        var debt = customers[n].totalDebt || 0;
        if (debt > 0) totalDebt += debt;
    }
    var totalSalary = 0;
    var netIncome = revenue - (staffCostTotal + adminCostTotal + totalSalary);
    return {
        revenue: revenue,
        grab: grab,
        bank: bank,
        cash: cash,
        staffCost: staffCostTotal,
        adminCost: adminCostTotal,
        debtOccur: debtOccur,
        totalDebt: totalDebt,
        totalSalary: totalSalary,
        netIncome: netIncome
    };
}

function updateManagerUI(stats) {
    if (!stats) {
        var range = managerGetDateRangeByMode();
        if (!range.startDate || !range.endDate) return;
        var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
        var filteredCosts = managerFilterByDateRange(managerData.costTransactions, range.startDate, range.endDate);
        var filteredAdminCosts = managerFilterByDateRange(managerData.adminCostTransactions, range.startDate, range.endDate);
        stats = managerComputeStats(filteredTrans, filteredCosts, filteredAdminCosts, managerData.customers, managerData.staffs, range.startDate, range.endDate);
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

// ========== HIỂN THỊ DANH SÁCH CHI PHÍ ==========
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

function renderManagerDebtList(customers) {
    var container = document.getElementById('managerDebtList');
    if (!container) return;
    if (!customers) customers = [];
    
    var debtCust = [];
    for (var i = 0; i < customers.length; i++) {
        var cust = customers[i];
        // Tính số dư nợ hiện tại: tổng nợ - tổng thanh toán
        var totalDebtAmount = 0;
        if (cust.debtHistory && cust.debtHistory.length) {
            for (var j = 0; j < cust.debtHistory.length; j++) {
                totalDebtAmount += cust.debtHistory[j].amount || 0;
            }
        }
        var totalPaymentAmount = 0;
        if (cust.paymentHistory && cust.paymentHistory.length) {
            for (var j = 0; j < cust.paymentHistory.length; j++) {
                totalPaymentAmount += cust.paymentHistory[j].amount || 0;
            }
        }
        var balance = totalDebtAmount - totalPaymentAmount;
        // Nếu có totalDebt cũ nhưng balance tính ra khác, ưu tiên balance (hoặc totalDebt nếu đáng tin)
        if (cust.totalDebt && typeof cust.totalDebt === 'number' && Math.abs(cust.totalDebt - balance) < 1000) {
            balance = cust.totalDebt;
        }
        if (balance > 0) {
            debtCust.push({ 
                id: cust.id, 
                name: cust.name, 
                totalDebt: balance 
            });
        }
    }
    debtCust.sort(function(a, b) { return b.totalDebt - a.totalDebt; });
    var html = '';
    for (var k = 0; k < debtCust.length; k++) {
        var c = debtCust[k];
        html += '<div class="manager-item" onclick="showDebtDetail(\'' + c.id + '\')">' +
            '<span>👤 ' + escapeHtml(c.name) + '</span>' +
            '<strong style="color:var(--danger);">Nợ: ' + formatMoney(c.totalDebt) + '</strong>' +
        '</div>';
    }
    if (!html) html = '<div class="empty-state">Không có khách nợ</div>';
    container.innerHTML = html;
}

// ========== QUẢN LÝ CHI PHÍ (POPUP) ==========
var costCategories = [];
var costCategoriesLoaded = false;

async function loadCostCategories() {
    costCategories = await DB.getAll('cost_categories') || [];
    costCategoriesLoaded = true;
}

function getCostCategories() {
    return costCategories;
}

function openCostModal(type) {
    if (!costCategoriesLoaded) {
        loadCostCategories().then(function() {
            openCostModal(type);
        });
        return;
    }
    var modal = document.getElementById('costModal');
    if (!modal) return;
    modal.setAttribute('data-cost-type', type || 'staff');
    
    var nameInput = document.getElementById('expenseNameInput');
    var amountInput = document.getElementById('expenseAmount');
    var qtyInput = document.getElementById('expenseQty');
    var title = document.getElementById('expensePopupTitle');
    
    if (nameInput) nameInput.value = '';
    if (amountInput) amountInput.value = '';
    if (qtyInput) qtyInput.value = '1';
    if (title) title.innerText = (type === 'admin' ? 'Thêm chi phí Quản lý' : 'Thêm chi phí Nhân viên');

renderRecentCategories();
renderTodayCosts();
renderMonthCostCategories();

modal.style.display = 'flex';
}

function renderRecentCategories() {
    var container = document.getElementById('recentCategoriesList');
    if (!container) return;
    if (costCategories.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có danh mục</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < costCategories.length; i++) {
        var cat = costCategories[i];
        html += '<div class="recent-item">' +
            '<button class="recent-btn" onclick="setExpenseName(\'' + escapeHtml(cat.name) + '\')">📦 ' + escapeHtml(cat.name) + '</button>' +
            '<button class="action-btn-edit" onclick="editExpenseName(\'' + cat.id + '\', \'' + escapeHtml(cat.name) + '\')">✏️</button>' +
            '<button class="action-btn-delete" onclick="deleteExpenseCategory(\'' + cat.id + '\')">🗑️</button>' +
        '</div>';
    }
    container.innerHTML = html;
}

function setExpenseName(name) {
    var input = document.getElementById('expenseNameInput');
    if (input) input.value = name;
}

async function editExpenseName(id, oldName) {
    var newName = prompt('Nhập tên mới cho danh mục:', oldName);
    if (!newName || newName === oldName) return;
    if (costCategories.some(function(c) { return c.name === newName; })) {
        showToast('Danh mục đã tồn tại!', 'warning');
        return;
    }
    await DB.update('cost_categories', id, { name: newName, updatedAt: Date.now() });
    costCategories = await DB.getAll('cost_categories');
    renderRecentCategories();
    renderTodayCosts();
    showToast('Đã sửa danh mục', 'success');
}

async function deleteExpenseCategory(id) {
    var used = managerData.costTransactions.some(function(tx) { return tx.categoryId === id && !tx.deleted; }) ||
               managerData.adminCostTransactions.some(function(tx) { return tx.categoryId === id && !tx.deleted; });
    if (used) {
        showToast('Danh mục đã có giao dịch, không thể xóa!', 'error');
        return;
    }
    if (!confirm('Xóa danh mục này?')) return;
    await DB.remove('cost_categories', id);
    costCategories = await DB.getAll('cost_categories');
    renderRecentCategories();
    showToast('Đã xóa danh mục', 'success');
}

async function renderTodayCosts() {
    var container = document.getElementById('todayCostList');
    var totalSpan = document.getElementById('todayCostTotal');
    if (!container || !totalSpan) return;
    var todayStr = new Date().toISOString().slice(0,10);
    var allToday = [];
    for (var i = 0; i < managerData.costTransactions.length; i++) {
        var tx = managerData.costTransactions[i];
        if ((tx.dateKey === todayStr) && !tx.deleted) allToday.push(tx);
    }
    for (var j = 0; j < managerData.adminCostTransactions.length; j++) {
        var tx2 = managerData.adminCostTransactions[j];
        if ((tx2.dateKey === todayStr) && !tx2.deleted) allToday.push(tx2);
    }
    allToday.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    var total = 0;
    if (allToday.length === 0) {
        container.innerHTML = '<div class="empty-text">📭 Chưa có dữ liệu chi phí</div>';
        if (totalSpan) totalSpan.innerText = 'Tổng: 0đ';
        return;
    }
    var html = '';
    for (var k = 0; k < allToday.length; k++) {
        var tx = allToday[k];
        total += tx.amount;
        html += '<div class="today-cost-item">' +
            '<div class="today-cost-name">' + escapeHtml(tx.categoryName) + (tx.quantity > 1 ? ' x' + tx.quantity : '') + '</div>' +
            '<div class="today-cost-amount">' + formatMoney(tx.amount) + '</div>' +
        '</div>';
    }
    container.innerHTML = html;
    if (totalSpan) totalSpan.innerText = 'Tổng: ' + formatMoney(total);
}

async function saveExpenseFromPopup() {
    var modal = document.getElementById('costModal');
    var costType = modal ? modal.getAttribute('data-cost-type') || 'staff' : 'staff';
    var categoryName = document.getElementById('expenseNameInput') ? document.getElementById('expenseNameInput').value.trim() : '';
    var amount = parseInt(document.getElementById('expenseAmount') ? document.getElementById('expenseAmount').value : 0) || 0;
    var quantity = parseInt(document.getElementById('expenseQty') ? document.getElementById('expenseQty').value : 1) || 1;
    if (!categoryName) {
        showToast('Vui lòng nhập hoặc chọn danh mục chi phí!', 'warning');
        return;
    }
    if (amount <= 0) {
        showToast('Số tiền phải lớn hơn 0!', 'warning');
        return;
    }
    var category = costCategories.find(function(c) { return c.name === categoryName; });
    if (!category) {
        var newId = Date.now().toString();
        category = { id: newId, name: categoryName, createdAt: Date.now(), createdBy: window.currentDeviceId };
        await DB.create('cost_categories', category);
        costCategories.push(category);
        renderRecentCategories();
    }
    var nowDate = new Date();
    var nowStr = nowDate.toISOString();
    var collection = (costType === 'admin') ? 'cost_transactions_admin' : 'cost_transactions';
    var data = {
        categoryId: category.id,
        categoryName: category.name,
        amount: amount,
        quantity: quantity,
        note: '',
        date: nowStr,
        dateKey: nowStr.slice(0,10),
        createdAt: Date.now(),
        createdBy: window.currentDeviceId,
        deleted: false
    };
    await DB.create(collection, data);
    await loadAllData();

renderTodayCosts();
renderMonthCostCategories();

if (document.getElementById('managerView').classList.contains('active')) {
    managerApplyFilter();
}
    showToast('✅ Đã thêm chi phí ' + (costType === 'admin' ? 'quản lý' : 'nhân viên'), 'success');
}

function attachCostPopupEvents() {
    var openBtn = document.getElementById('openCostModalBtn');
    if (openBtn) openBtn.onclick = function() { openCostModal('staff'); };
    var quickCostBtn = document.getElementById('quickCostBtn');
    if (quickCostBtn) quickCostBtn.onclick = function() { openCostModal('staff'); };
    var adminExpenseBtn = document.getElementById('adminExpenseFab');
    if (adminExpenseBtn) {
        adminExpenseBtn.onclick = function(e) {
            e.stopPropagation();
            openCostModal('admin');
        };
    }
    var saveBtn = document.getElementById('saveExpenseBtn');
    if (saveBtn) saveBtn.onclick = saveExpenseFromPopup;
    var closeBtns = document.querySelectorAll('[data-close="costModal"]');
    for (var i = 0; i < closeBtns.length; i++) {
        closeBtns[i].onclick = function() { closeModal('costModal'); };
    }
    var quickMoneyBtns = document.querySelectorAll('.quick-money-btn');
    for (var j = 0; j < quickMoneyBtns.length; j++) {
        quickMoneyBtns[j].onclick = function() {
            var amount = this.getAttribute('data-amount');
            var amountInput = document.getElementById('expenseAmount');
            if (amountInput) amountInput.value = amount;
        };
    }
}
// ========== LỌC DANH MỤC CHI PHÍ ==========
function initCategoryFilter() {
    var searchInput = document.getElementById('expenseNameInput');
    if (!searchInput) return;
    // Xóa listener cũ nếu có (tránh trùng lặp khi mở modal nhiều lần)
    if (searchInput._filterListener) {
        searchInput.removeEventListener('input', searchInput._filterListener);
    }
    var filterHandler = function() {
        var keyword = this.value.trim().toLowerCase();
        var items = document.querySelectorAll('#recentCategoriesList .recent-item');
        for (var i = 0; i < items.length; i++) {
            var btn = items[i].querySelector('.recent-btn');
            if (!btn) continue;
            var name = btn.innerText.replace('📦', '').trim().toLowerCase();
            if (keyword === '' || name.indexOf(keyword) !== -1) {
                items[i].style.display = 'flex';
            } else {
                items[i].style.display = 'none';
            }
        }
    };
    searchInput.addEventListener('input', filterHandler);
    searchInput._filterListener = filterHandler;
}

// ========== GẮN SỰ KIỆN CHO POPUP CHI PHÍ ==========
function attachCostModalEvents() {
    var openBtn = document.getElementById('openCostModalBtn');
    if (openBtn) openBtn.onclick = function() { document.getElementById('costModal').style.display = 'flex'; };
    var saveBtn = document.getElementById('saveExpenseBtn');
    if (saveBtn) saveBtn.onclick = saveExpenseFromPopup;
    var closeBtns = document.querySelectorAll('[data-close="costModal"]');
    for (var i = 0; i < closeBtns.length; i++) {
        closeBtns[i].onclick = function() { closeModal('costModal'); };
    }
    var quickBtns = document.querySelectorAll('.quick-money-btn');
    for (var j = 0; j < quickBtns.length; j++) {
        quickBtns[j].onclick = function() {
            var amount = this.getAttribute('data-amount');
            document.getElementById('expenseAmount').value = amount;
        };
    }
    var quickCostBtn = document.getElementById('quickCostBtn');
    if (quickCostBtn) quickCostBtn.onclick = function() { document.getElementById('costModal').style.display = 'flex'; };
    
    // 👇 THÊM DÒNG NÀY ĐỂ KÍCH HOẠT LỌC DANH MỤC
    initCategoryFilter();
}


// Chi tiết lịch sử
async function showExpenseDetail(categoryName) {
    var all = managerData.costTransactions;
    var filtered = [];
    for (var i = 0; i < all.length; i++) {
        if (all[i].categoryName === categoryName && !all[i].deleted) filtered.push(all[i]);
    }
    filtered.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    var html = '<div class="cost-history-header">📜 Lịch sử chi phí nhân viên: <strong>' + escapeHtml(categoryName) + '</strong></div>';
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

async function showAdminExpenseDetail(categoryName) {
    var all = managerData.adminCostTransactions;
    var filtered = [];
    for (var i = 0; i < all.length; i++) {
        if (all[i].categoryName === categoryName && !all[i].deleted) filtered.push(all[i]);
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

// ========== SỰ KIỆN CHUNG ==========
function attachManagerEvents() {
    // 1. Collapsible cards (thu gọn/mở rộng)
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

    // 2. Box Doanh thu -> lịch sử doanh thu
    var revenueBox = document.getElementById('revenueBox');
    if (revenueBox) revenueBox.onclick = showRevenueHistory;

    // 3. Box Chuyển khoản -> lịch sử chuyển khoản
    var bankBox = document.getElementById('bankBox');
    if (bankBox) bankBox.onclick = showTransferHistory;

    // 4. Box Thực nhận -> lịch sử thực nhận
    var cashBox = document.getElementById('cashBox');
    if (cashBox) cashBox.onclick = showCashReceivedHistory;

    // 5. Box Grab -> lịch sử Grab
    var grabBox = document.getElementById('grabBox');
    if (grabBox) grabBox.onclick = showGrabHistory;

    // 6. Box Chi phí nhân viên -> modal lịch sử chi phí nhân viên
    var expenseBox = document.getElementById('expenseBox');
    if (expenseBox) expenseBox.onclick = showStaffExpenseHistory;

    // 7. Box Tổng CP Quản lý -> modal lịch sử chi phí quản lý
    var adminExpenseBox = document.getElementById('adminExpenseBox');
    if (adminExpenseBox) adminExpenseBox.onclick = showAdminExpenseHistory;

    // 8. Box Công nợ phát sinh -> modal danh sách nợ phát sinh trong kỳ
    var debtOccurBox = document.getElementById('debtOccurBox');
    if (debtOccurBox) debtOccurBox.onclick = showDebtOccurredHistory;

    // 9. Box Tổng công nợ -> modal danh sách khách hàng đang nợ hiện tại
    var totalDebtBox = document.getElementById('totalDebtBox');
    if (totalDebtBox) totalDebtBox.onclick = showCurrentTotalDebt;

    // 10. Box Thu nhập ròng -> lịch sử thực nhận (tương tự cashBox)
    var netIncomeBox = document.getElementById('netIncomeBox');
    if (netIncomeBox) netIncomeBox.onclick = showCashReceivedHistory;
}

// ========== HIỂN THỊ LỊCH SỬ CHI PHÍ NHÂN VIÊN (MODAL) ==========
function showStaffExpenseHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredCosts = managerFilterByDateRange(managerData.costTransactions, range.startDate, range.endDate);
    
    var categoriesMap = {};
    for (var i = 0; i < filteredCosts.length; i++) {
        var c = filteredCosts[i];
        if (!categoriesMap[c.categoryName]) categoriesMap[c.categoryName] = 0;
        categoriesMap[c.categoryName] += c.amount;
    }
    var sorted = Object.entries(categoriesMap).sort(function(a, b) { return b[1] - a[1]; });
    
    var dateRangeText = formatDateRange(range.startDate, range.endDate);
    var html = '<div class="cost-history-header">📋 Chi phí nhân viên (' + dateRangeText + ')</div>';
    if (sorted.length === 0) {
        html += '<div class="empty-state">Không có chi phí nhân viên trong kỳ</div>';
    } else {
        html += '<div class="cost-list">';
        for (var j = 0; j < sorted.length; j++) {
            var name = sorted[j][0];
            var amount = sorted[j][1];
            html += '<div class="manager-item" onclick="showExpenseDetail(\'' + escapeHtml(name) + '\')">' +
                        '<span>📦 ' + escapeHtml(name) + '</span>' +
                        '<strong>' + formatMoney(amount) + '</strong>' +
                    '</div>';
        }
        html += '</div>';
    }
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '📉 Lịch sử chi phí nhân viên';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== HIỂN THỊ LỊCH SỬ CHI PHÍ QUẢN LÝ ==========
function showAdminExpenseHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredCosts = managerFilterByDateRange(managerData.adminCostTransactions, range.startDate, range.endDate);
    
    var categoriesMap = {};
    for (var i = 0; i < filteredCosts.length; i++) {
        var c = filteredCosts[i];
        if (!categoriesMap[c.categoryName]) categoriesMap[c.categoryName] = { amount: 0, qty: 0 };
        categoriesMap[c.categoryName].amount += c.amount;
        categoriesMap[c.categoryName].qty += c.quantity || 1;
    }
    var sorted = Object.entries(categoriesMap).sort(function(a, b) { return b[1].amount - a[1].amount; });
    
    var dateRangeText = formatDateRange(range.startDate, range.endDate);
    var html = '<div class="cost-history-header">🏢 Chi phí quản lý (' + dateRangeText + ')</div>';
    if (sorted.length === 0) {
        html += '<div class="empty-state">Không có chi phí quản lý trong kỳ</div>';
    } else {
        html += '<div class="cost-list">';
        for (var j = 0; j < sorted.length; j++) {
            var name = sorted[j][0];
            var data = sorted[j][1];
            html += '<div class="manager-item" onclick="showAdminExpenseDetail(\'' + escapeHtml(name) + '\')">' +
                        '<span>🏢 ' + escapeHtml(name) + ' (SL: ' + data.qty + ')</span>' +
                        '<strong>' + formatMoney(data.amount) + '</strong>' +
                    '</div>';
        }
        html += '</div>';
    }
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '📋 Lịch sử chi phí quản lý';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== LỊCH SỬ CÔNG NỢ PHÁT SINH TRONG KỲ ==========
function showDebtOccurredHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var startStr = range.startDate.toISOString().slice(0,10);
    var endStr = range.endDate.toISOString().slice(0,10);
    
    var debtEntries = [];
    for (var i = 0; i < managerData.customers.length; i++) {
        var cust = managerData.customers[i];
        var debts = cust.debtHistory || [];
        for (var j = 0; j < debts.length; j++) {
            var d = debts[j];
            var dStr = d.date ? d.date.slice(0,10) : '';
            if (dStr >= startStr && dStr <= endStr) {
                debtEntries.push({
                    customerName: cust.name,
                    customerId: cust.id,
                    amount: d.amount,
                    date: d.date,
                    note: d.note
                });
            }
        }
    }
    debtEntries.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    
    var dateRangeText = formatDateRange(range.startDate, range.endDate);
    var html = '<div class="cost-history-header">💢 Công nợ phát sinh (' + dateRangeText + ')</div>';
    if (debtEntries.length === 0) {
        html += '<div class="empty-state">Không có khoản nợ nào phát sinh</div>';
    } else {
        html += '<div class="history-date-list">';
        var lastDate = '';
        for (var k = 0; k < debtEntries.length; k++) {
            var entry = debtEntries[k];
            var dateStr = new Date(entry.date).toLocaleDateString('vi-VN');
            if (dateStr !== lastDate) {
                if (lastDate) html += '</div>';
                html += '<div class="history-date-group" data-date="' + entry.date.slice(0,10) + '">' +
                            '<div class="history-date-header" onclick="toggleHistoryDateGroup(this)">' +
                                '<span class="history-date-title">📅 ' + dateStr + '</span>' +
                                '<span class="toggle-icon">▼</span>' +
                            '</div>' +
                            '<div class="history-date-items">';
                lastDate = dateStr;
            }
            html += '<div class="history-date-item" onclick="showDebtDetail(\'' + entry.customerId + '\')" style="cursor:pointer;">' +
                        '<div>👤 ' + escapeHtml(entry.customerName) + '</div>' +
                        '<div>📝 ' + escapeHtml(entry.note || '') + '</div>' +
                        '<div class="history-date-item-amount" style="color:var(--danger);">+' + formatMoney(entry.amount) + '</div>' +
                    '</div>';
        }
        html += '</div></div></div>';
    }
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '📊 Công nợ phát sinh';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== DANH SÁCH TỔNG CÔNG NỢ HIỆN TẠI ==========
function showCurrentTotalDebt() {
    var debtCust = [];
    for (var i = 0; i < managerData.customers.length; i++) {
        var cust = managerData.customers[i];
        // Tính số dư nợ hiện tại (ưu tiên totalDebt nếu có, hoặc tính từ lịch sử)
        var totalDebtAmount = 0;
        if (cust.debtHistory) {
            for (var j = 0; j < cust.debtHistory.length; j++) {
                totalDebtAmount += cust.debtHistory[j].amount || 0;
            }
        }
        var totalPaymentAmount = 0;
        if (cust.paymentHistory) {
            for (var j = 0; j < cust.paymentHistory.length; j++) {
                totalPaymentAmount += cust.paymentHistory[j].amount || 0;
            }
        }
        var balance = totalDebtAmount - totalPaymentAmount;
        if (cust.totalDebt && typeof cust.totalDebt === 'number' && Math.abs(cust.totalDebt - balance) < 1000) {
            balance = cust.totalDebt;
        }
        if (balance > 0) {
            debtCust.push({ id: cust.id, name: cust.name, totalDebt: balance });
        }
    }
    debtCust.sort(function(a, b) { return b.totalDebt - a.totalDebt; });
    
    var html = '<div class="cost-history-header">🏦 Danh sách khách nợ hiện tại</div>';
    if (debtCust.length === 0) {
        html += '<div class="empty-state">Không có khách nợ</div>';
    } else {
        html += '<div class="cost-list">';
        for (var k = 0; k < debtCust.length; k++) {
            var c = debtCust[k];
            html += '<div class="manager-item" onclick="showDebtDetail(\'' + c.id + '\')">' +
                        '<span>👤 ' + escapeHtml(c.name) + '</span>' +
                        '<strong style="color:var(--danger);">' + formatMoney(c.totalDebt) + '</strong>' +
                    '</div>';
        }
        html += '</div>';
    }
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '🧾 Tổng công nợ khách hàng';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// Helper: format date range
function formatDateRange(start, end) {
    var s = start.toLocaleDateString('vi-VN');
    var e = end.toLocaleDateString('vi-VN');
    return s + ' → ' + e;
}
// ========== THỐNG KÊ ĐỒ UỐNG THEO BỘ LỌC ==========
function renderDrinkStats() {
    var container = document.getElementById('managerDrinkStats');
    if (!container) return;
    
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) {
        container.innerHTML = '<div class="empty-state">Chưa có dữ liệu</div>';
        return;
    }
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    
    var itemSales = {};
    for (var i = 0; i < filteredTrans.length; i++) {
        var tx = filteredTrans[i];
        if (tx.type === 'debt_payment') continue;
        var items = tx.items || [];
        for (var j = 0; j < items.length; j++) {
            var item = items[j];
            var name = item.name;
            // Loại bỏ phần size trong ngoặc để gộp chung (tùy chọn)
            var originalName = name.replace(/\s*\([^)]*\)/g, '').trim();
            var qty = item.qty || 0;
            if (!itemSales[originalName]) itemSales[originalName] = 0;
            itemSales[originalName] += qty;
        }
    }
    var itemsArray = [];
    for (var name in itemSales) {
        itemsArray.push({ name: name, qty: itemSales[name] });
    }
    itemsArray.sort(function(a, b) { return b.qty - a.qty; });
    var topItems = itemsArray.slice(0, 10);
    
    if (topItems.length === 0) {
        container.innerHTML = '<div class="empty-state">📭 Không có dữ liệu bán hàng trong khoảng thời gian này</div>';
        return;
    }
    var html = '<div class="stats-list">';
    for (var k = 0; k < topItems.length; k++) {
        html += '<div class="stats-item">' +
            '<span>' + (k+1) + '. ' + escapeHtml(topItems[k].name) + '</span>' +
            '<span class="stats-qty">📦 ' + topItems[k].qty + '</span>' +
        '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

// ========== CẢNH BÁO TỒN KHO THẤP ==========
function renderLowStockAlert() {
    var container = document.getElementById('managerLowStockAlert');
    if (!container) return;
    var ingredients = window.ingredients || [];
    if (ingredients.length === 0) {
        container.innerHTML = '<div class="empty-state">📦 Chưa có nguyên liệu</div>';
        return;
    }
    var minStockSetting = parseInt(localStorage.getItem('settingMinStock') || '10');
    var lowItems = [];
    for (var i = 0; i < ingredients.length; i++) {
        var ing = ingredients[i];
        var threshold = ing.minStock || minStockSetting;
        if (ing.stock <= threshold) {
            lowItems.push(ing);
        }
    }
    if (lowItems.length === 0) {
        container.innerHTML = '<div class="empty-state">✅ Tất cả nguyên liệu đủ tồn kho</div>';
        return;
    }
    var html = '<div class="alert-list">';
    for (var j = 0; j < lowItems.length; j++) {
        var ing = lowItems[j];
        html += '<div class="alert-item">' +
            '<span class="alert-name">⚠️ ' + escapeHtml(ing.name) + '</span>' +
            '<span class="alert-stock">Tồn: ' + ing.stock + ' ' + ing.unit + '</span>' +
        '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}
// ========== LỊCH SỬ DOANH THU ==========
// ========== LỊCH SỬ DOANH THU THEO NGÀY (CÓ THỂ MỞ RỘNG) ==========
function showRevenueHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    
    // Lọc chỉ lấy dinein và takeaway (không tính debt_payment) và chưa refund
    var revenueTrans = [];
    for (var i = 0; i < filteredTrans.length; i++) {
        var tx = filteredTrans[i];
        if ((tx.type === 'dinein' || tx.type === 'takeaway') && tx.refunded !== true) {
            revenueTrans.push(tx);
        }
    }
    
    // Nhóm theo ngày (YYYY-MM-DD)
    var groups = {};
    for (var i = 0; i < revenueTrans.length; i++) {
        var tx = revenueTrans[i];
        var dateKey = tx.dateKey || tx.date.slice(0,10);
        if (!groups[dateKey]) {
            groups[dateKey] = {
                transactions: [],
                totalAmount: 0,
                totalCount: 0
            };
        }
        groups[dateKey].transactions.push(tx);
        groups[dateKey].totalAmount += tx.amount;
        groups[dateKey].totalCount++;
    }
    
    // Chuyển thành mảng và sắp xếp ngày giảm dần (mới nhất trước)
    var groupList = [];
    for (var date in groups) {
        groupList.push({
            date: date,
            totalAmount: groups[date].totalAmount,
            totalCount: groups[date].totalCount,
            transactions: groups[date].transactions
        });
    }
    groupList.sort(function(a, b) { return b.date.localeCompare(a.date); });
    
    if (groupList.length === 0) {
        document.getElementById('historyDetailContent').innerHTML = '<div class="empty-state">📭 Không có giao dịch doanh thu trong khoảng thời gian này</div>';
        document.getElementById('historyDetailTitle').innerHTML = '📋 Lịch sử Doanh thu';
        document.getElementById('historyDetailModal').style.display = 'flex';
        return;
    }
    
    var html = '<div class="history-date-list">';
    for (var i = 0; i < groupList.length; i++) {
        var group = groupList[i];
        var dateObj = new Date(group.date);
        var dateStr = dateObj.toLocaleDateString('vi-VN');
        html += '<div class="history-date-group" data-date="' + group.date + '">' +
            '<div class="history-date-header" onclick="toggleHistoryDateGroup(this)">' +
                '<span class="history-date-title">📅 ' + dateStr + '</span>' +
                '<span class="history-date-summary">' +
                    '<span>📦 ' + group.totalCount + ' giao dịch</span>' +
                    '<span class="history-date-amount">' + formatMoney(group.totalAmount) + '</span>' +
                    '<span class="toggle-icon">▼</span>' +
                '</span>' +
            '</div>' +
            '<div class="history-date-items">';
        
        // Chi tiết từng giao dịch trong ngày
        var txList = group.transactions;
        txList.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
        for (var j = 0; j < txList.length; j++) {
            var tx = txList[j];
            var timeStr = new Date(tx.date).toLocaleTimeString('vi-VN');
            var totalItems = 0;
            if (tx.items) {
                for (var k = 0; k < tx.items.length; k++) {
                    totalItems += tx.items[k].qty;
                }
            }
            html += '<div class="history-date-item">' +
                '<div class="history-date-item-time">' + timeStr + ' - ' + (tx.type === 'dinein' ? '🍽️ Tại chỗ' : '🛵 Mang đi') + ' - ' + (tx.paymentMethod === 'cash' ? '💰 TM' : '💳 CK') + ' - 📦 ' + totalItems + ' món' +
                (tx.tableName ? ' - 🪑 ' + tx.tableName : '') +
                '</div>' +
                '<div class="history-date-item-amount">' + formatMoney(tx.amount) + '</div>' +
            '</div>';
        }
        html += '</div></div>';
    }
    html += '</div>';
    
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '📋 Lịch sử Doanh thu';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== LỊCH SỬ CHUYỂN KHOẢN THEO NGÀY ==========
function showTransferHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    
    // Lọc giao dịch chuyển khoản, chưa refund
    var transferTrans = [];
    for (var i = 0; i < filteredTrans.length; i++) {
        var tx = filteredTrans[i];
        if (tx.paymentMethod === 'transfer' && tx.refunded !== true) {
            transferTrans.push(tx);
        }
    }
    
    // Nhóm theo ngày
    var groups = {};
    for (var i = 0; i < transferTrans.length; i++) {
        var tx = transferTrans[i];
        var dateKey = tx.dateKey || tx.date.slice(0,10);
        if (!groups[dateKey]) {
            groups[dateKey] = {
                transactions: [],
                totalAmount: 0,
                totalCount: 0
            };
        }
        groups[dateKey].transactions.push(tx);
        groups[dateKey].totalAmount += tx.amount;
        groups[dateKey].totalCount++;
    }
    
    var groupList = [];
    for (var date in groups) {
        groupList.push({
            date: date,
            totalAmount: groups[date].totalAmount,
            totalCount: groups[date].totalCount,
            transactions: groups[date].transactions
        });
    }
    groupList.sort(function(a, b) { return b.date.localeCompare(a.date); });
    
    if (groupList.length === 0) {
        document.getElementById('historyDetailContent').innerHTML = '<div class="empty-state">📭 Không có giao dịch chuyển khoản trong khoảng thời gian này</div>';
        document.getElementById('historyDetailTitle').innerHTML = '💳 Lịch sử Chuyển khoản';
        document.getElementById('historyDetailModal').style.display = 'flex';
        return;
    }
    
    var html = '<div class="history-date-list">';
    for (var i = 0; i < groupList.length; i++) {
        var group = groupList[i];
        var dateObj = new Date(group.date);
        var dateStr = dateObj.toLocaleDateString('vi-VN');
        html += '<div class="history-date-group" data-date="' + group.date + '">' +
            '<div class="history-date-header" onclick="toggleHistoryDateGroup(this)">' +
                '<span class="history-date-title">📅 ' + dateStr + '</span>' +
                '<span class="history-date-summary">' +
                    '<span>📦 ' + group.totalCount + ' giao dịch</span>' +
                    '<span class="history-date-amount">' + formatMoney(group.totalAmount) + '</span>' +
                    '<span class="toggle-icon">▼</span>' +
                '</span>' +
            '</div>' +
            '<div class="history-date-items">';
        
        var txList = group.transactions;
        txList.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
        for (var j = 0; j < txList.length; j++) {
            var tx = txList[j];
            var timeStr = new Date(tx.date).toLocaleTimeString('vi-VN');
            var typeText = (tx.type === 'dinein') ? '🍽️ Tại chỗ' : ((tx.type === 'takeaway') ? '🛵 Mang đi' : '💰 Thanh toán nợ');
            html += '<div class="history-date-item">' +
                '<div class="history-date-item-time">' + timeStr + ' - ' + typeText + (tx.tableName ? ' - 🪑 ' + tx.tableName : '') + '</div>' +
                '<div class="history-date-item-amount">' + formatMoney(tx.amount) + '</div>' +
            '</div>';
        }
        html += '</div></div>';
    }
    html += '</div>';
    
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '💳 Lịch sử Chuyển khoản';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== LỊCH SỬ THỰC NHẬN THEO NGÀY (CÓ CHI TIẾT) ==========
function showCashReceivedHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    var filteredCosts = managerFilterByDateRange(managerData.costTransactions, range.startDate, range.endDate);
    var filteredAdminCosts = managerFilterByDateRange(managerData.adminCostTransactions, range.startDate, range.endDate);
    
    // Nhóm giao dịch theo ngày để tính thực nhận
    var groups = {};
    
    // Xử lý giao dịch thu tiền
    for (var i = 0; i < filteredTrans.length; i++) {
        var tx = filteredTrans[i];
        if (tx.refunded === true) continue;
        var dateKey = tx.dateKey || tx.date.slice(0,10);
        if (!groups[dateKey]) {
            groups[dateKey] = {
                cashIn: 0,      // tiền mặt thu vào
                transferIn: 0,  // chuyển khoản thu vào
                staffCost: 0,   // chi phí nhân viên
                adminCost: 0,   // chi phí quản lý
                txList: [],
                costList: [],
                adminCostList: []
            };
        }
        if (tx.paymentMethod === 'cash') {
            groups[dateKey].cashIn += tx.amount;
        } else if (tx.paymentMethod === 'transfer') {
            groups[dateKey].transferIn += tx.amount;
        }
        groups[dateKey].txList.push(tx);
    }
    
    // Xử lý chi phí nhân viên theo ngày
    for (var j = 0; j < filteredCosts.length; j++) {
        var cost = filteredCosts[j];
        if (cost.deleted) continue;
        var dateKey = cost.dateKey || cost.date.slice(0,10);
        if (groups[dateKey]) {
            groups[dateKey].staffCost += cost.amount;
            groups[dateKey].costList.push(cost);
        } else {
            groups[dateKey] = {
                cashIn: 0, transferIn: 0, staffCost: cost.amount, adminCost: 0,
                txList: [], costList: [cost], adminCostList: []
            };
        }
    }
    
    // Xử lý chi phí quản lý theo ngày
    for (var k = 0; k < filteredAdminCosts.length; k++) {
        var adminCost = filteredAdminCosts[k];
        if (adminCost.deleted) continue;
        var dateKey = adminCost.dateKey || adminCost.date.slice(0,10);
        if (groups[dateKey]) {
            groups[dateKey].adminCost += adminCost.amount;
            groups[dateKey].adminCostList.push(adminCost);
        } else {
            groups[dateKey] = {
                cashIn: 0, transferIn: 0, staffCost: 0, adminCost: adminCost.amount,
                txList: [], costList: [], adminCostList: [adminCost]
            };
        }
    }
    
    // Chuyển thành mảng và tính thực nhận
    var groupList = [];
    for (var date in groups) {
        var g = groups[date];
        var totalReceived = g.cashIn + g.transferIn - g.staffCost - g.adminCost;
        groupList.push({
            date: date,
            cashIn: g.cashIn,
            transferIn: g.transferIn,
            staffCost: g.staffCost,
            adminCost: g.adminCost,
            totalReceived: totalReceived,
            txList: g.txList,
            costList: g.costList,
            adminCostList: g.adminCostList
        });
    }
    groupList.sort(function(a, b) { return b.date.localeCompare(a.date); });
    
    if (groupList.length === 0) {
        document.getElementById('historyDetailContent').innerHTML = '<div class="empty-state">📭 Không có dữ liệu thực nhận trong khoảng thời gian này</div>';
        document.getElementById('historyDetailTitle').innerHTML = '💵 Lịch sử Thực nhận';
        document.getElementById('historyDetailModal').style.display = 'flex';
        return;
    }
    
    var html = '<div class="history-date-list">';
    for (var i = 0; i < groupList.length; i++) {
        var group = groupList[i];
        var dateObj = new Date(group.date);
        var dateStr = dateObj.toLocaleDateString('vi-VN');
        html += '<div class="history-date-group" data-date="' + group.date + '">' +
            '<div class="history-date-header" onclick="toggleHistoryDateGroup(this)">' +
                '<span class="history-date-title">📅 ' + dateStr + '</span>' +
                '<span class="history-date-summary">' +
                    '<span>💰 Thu: ' + formatMoney(group.cashIn + group.transferIn) + '</span>' +
                    '<span class="history-date-amount">📉 Nhận: ' + formatMoney(group.totalReceived) + '</span>' +
                    '<span class="toggle-icon">▼</span>' +
                '</span>' +
            '</div>' +
            '<div class="history-date-items">' +
                '<div class="history-date-subsection">' +
                    '<div class="history-date-subtitle">💰 Thu tiền</div>';
        
        // Chi tiết thu tiền
        if (group.txList.length > 0) {
            var txSorted = group.txList.slice().sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
            for (var j = 0; j < txSorted.length; j++) {
                var tx = txSorted[j];
                var timeStr = new Date(tx.date).toLocaleTimeString('vi-VN');
                var paymentIcon = (tx.paymentMethod === 'cash') ? '💰 TM' : '💳 CK';
                html += '<div class="history-date-item">' +
                    '<div class="history-date-item-time">' + timeStr + ' - ' + paymentIcon + ' - ' + (tx.type === 'dinein' ? '🍽️ Tại chỗ' : (tx.type === 'takeaway' ? '🛵 Mang đi' : '💰 Nợ')) + (tx.tableName ? ' - 🪑 ' + tx.tableName : '') + '</div>' +
                    '<div class="history-date-item-amount">+' + formatMoney(tx.amount) + '</div>' +
                '</div>';
            }
        } else {
            html += '<div class="history-date-item">Không có giao dịch thu tiền</div>';
        }
        
        html += '</div>' +
            '<div class="history-date-subsection">' +
                '<div class="history-date-subtitle">📉 Chi phí nhân viên</div>';
        
        // Chi tiết chi phí nhân viên
        if (group.costList.length > 0) {
            var costSorted = group.costList.slice().sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
            for (var k = 0; k < costSorted.length; k++) {
                var cost = costSorted[k];
                var timeStr = new Date(cost.date).toLocaleTimeString('vi-VN');
                html += '<div class="history-date-item">' +
                    '<div class="history-date-item-time">' + timeStr + ' - ' + escapeHtml(cost.categoryName) + (cost.quantity > 1 ? ' x' + cost.quantity : '') + '</div>' +
                    '<div class="history-date-item-amount" style="color:var(--danger);">-' + formatMoney(cost.amount) + '</div>' +
                '</div>';
            }
        } else {
            html += '<div class="history-date-item">Không có chi phí nhân viên</div>';
        }
        
        html += '</div>' +
            '<div class="history-date-subsection">' +
                '<div class="history-date-subtitle">📋 Chi phí quản lý</div>';
        
        // Chi tiết chi phí quản lý
        if (group.adminCostList.length > 0) {
            var adminSorted = group.adminCostList.slice().sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
            for (var l = 0; l < adminSorted.length; l++) {
                var adminCost = adminSorted[l];
                var timeStr = new Date(adminCost.date).toLocaleTimeString('vi-VN');
                html += '<div class="history-date-item">' +
                    '<div class="history-date-item-time">' + timeStr + ' - ' + escapeHtml(adminCost.categoryName) + (adminCost.quantity > 1 ? ' x' + adminCost.quantity : '') + '</div>' +
                    '<div class="history-date-item-amount" style="color:var(--danger);">-' + formatMoney(adminCost.amount) + '</div>' +
                '</div>';
            }
        } else {
            html += '<div class="history-date-item">Không có chi phí quản lý</div>';
        }
        
        html += '</div>' +
            '<div class="history-date-total">' +
                '<strong>💰 Thực nhận: ' + formatMoney(group.totalReceived) + '</strong>' +
            '</div>' +
        '</div></div>';
    }
    html += '</div>';
    
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '💵 Lịch sử Thực nhận';
    document.getElementById('historyDetailModal').style.display = 'flex';
}
// Hàm toggle mở rộng nhóm ngày (gọi từ onclick)
window.toggleHistoryDateGroup = function(headerElement) {
    var groupDiv = headerElement.closest('.history-date-group');
    if (!groupDiv) return;
    var itemsDiv = groupDiv.querySelector('.history-date-items');
    if (itemsDiv) {
        itemsDiv.classList.toggle('expanded');
        var toggleIcon = headerElement.querySelector('.toggle-icon');
        if (toggleIcon) {
            if (itemsDiv.classList.contains('expanded')) {
                toggleIcon.style.transform = 'rotate(180deg)';
            } else {
                toggleIcon.style.transform = 'rotate(0deg)';
            }
        }
    }
};
// ========== LỊCH SỬ GRAB THEO NGÀY ==========
function showGrabHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    
    // Lọc giao dịch type === 'grab', chưa refund
    var grabTrans = [];
    for (var i = 0; i < filteredTrans.length; i++) {
        var tx = filteredTrans[i];
        if (tx.type === 'grab' && tx.refunded !== true) {
            grabTrans.push(tx);
        }
    }
    
    // Nhóm theo ngày
    var groups = {};
    for (var i = 0; i < grabTrans.length; i++) {
        var tx = grabTrans[i];
        var dateKey = tx.dateKey || tx.date.slice(0,10);
        if (!groups[dateKey]) {
            groups[dateKey] = {
                transactions: [],
                totalAmount: 0,
                totalCount: 0
            };
        }
        groups[dateKey].transactions.push(tx);
        groups[dateKey].totalAmount += tx.amount;
        groups[dateKey].totalCount++;
    }
    
    var groupList = [];
    for (var date in groups) {
        groupList.push({
            date: date,
            totalAmount: groups[date].totalAmount,
            totalCount: groups[date].totalCount,
            transactions: groups[date].transactions
        });
    }
    groupList.sort(function(a, b) { return b.date.localeCompare(a.date); });
    
    if (groupList.length === 0) {
        document.getElementById('historyDetailContent').innerHTML = '<div class="empty-state">📭 Không có đơn Grab trong khoảng thời gian này</div>';
        document.getElementById('historyDetailTitle').innerHTML = '🚕 Lịch sử Grab';
        document.getElementById('historyDetailModal').style.display = 'flex';
        return;
    }
    
    var html = '<div class="history-date-list">';
    for (var i = 0; i < groupList.length; i++) {
        var group = groupList[i];
        var dateObj = new Date(group.date);
        var dateStr = dateObj.toLocaleDateString('vi-VN');
        html += '<div class="history-date-group" data-date="' + group.date + '">' +
            '<div class="history-date-header" onclick="toggleHistoryDateGroup(this)">' +
                '<span class="history-date-title">📅 ' + dateStr + '</span>' +
                '<span class="history-date-summary">' +
                    '<span>📦 ' + group.totalCount + ' đơn</span>' +
                    '<span class="history-date-amount">' + formatMoney(group.totalAmount) + '</span>' +
                    '<span class="toggle-icon">▼</span>' +
                '</span>' +
            '</div>' +
            '<div class="history-date-items">';
        
        var txList = group.transactions;
        txList.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
        for (var j = 0; j < txList.length; j++) {
            var tx = txList[j];
            var timeStr = new Date(tx.date).toLocaleTimeString('vi-VN');
            var totalItems = 0;
            if (tx.items) {
                for (var k = 0; k < tx.items.length; k++) {
                    totalItems += tx.items[k].qty;
                }
            }
            var itemsStr = '';
            if (tx.items) {
                for (var k = 0; k < tx.items.length; k++) {
                    if (k > 0) itemsStr += ', ';
                    itemsStr += tx.items[k].name + ' x' + tx.items[k].qty;
                }
            }
            html += '<div class="history-date-item">' +
                '<div class="history-date-item-time">' + timeStr + ' - 📦 ' + totalItems + ' món</div>' +
                '<div class="history-date-item-amount">' + formatMoney(tx.amount) + '</div>' +
            '</div>';
            if (itemsStr) {
                html += '<div class="history-date-item-detail">' + escapeHtml(itemsStr) + '</div>';
            }
        }
        html += '</div></div>';
    }
    html += '</div>';
    
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '🚕 Lịch sử Grab';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== QUẢN LÝ CHI PHÍ NHÂN VIÊN ==========
var costCategories = [];
var costTransactions = [];

// ========== QUẢN LÝ CHI PHÍ QUẢN LÝ ==========
var adminCostCategories = [];
var adminCostTransactions = [];

// Load dữ liệu
async function loadStaffCostData() {
    costCategories = await DB.getAll('cost_categories') || [];
    costTransactions = await DB.getAll('cost_transactions') || [];
    window.costCategories = costCategories;
    window.costTransactions = costTransactions;
}

async function loadAdminCostData() {
    adminCostCategories = await DB.getAll('admin_cost_categories') || [];
    adminCostTransactions = await DB.getAll('cost_transactions_admin') || [];
    window.adminCostCategories = adminCostCategories;
    window.adminCostTransactions = adminCostTransactions;
}

// Render danh sách danh mục (dạng grid)
function renderRecentCategories(container, categories, type) {
    if (!container) return;
    if (categories.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có danh mục</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < categories.length; i++) {
        var cat = categories[i];
        html += '<div class="recent-item">' +
            '<button class="recent-btn" onclick="setExpenseName(\'' + escapeHtml(cat.name) + '\', \'' + type + '\')">📦 ' + escapeHtml(cat.name) + '</button>' +
            '<button class="action-btn-edit" onclick="editExpenseName(\'' + cat.id + '\', \'' + escapeHtml(cat.name) + '\', \'' + type + '\')">✏️</button>' +
            '<button class="action-btn-delete" onclick="deleteExpenseCategory(\'' + cat.id + '\', \'' + type + '\')">🗑️</button>' +
        '</div>';
    }
    container.innerHTML = html;
}

// Tạo danh mục mới
async function createNewCategory(name, type) {
    var newId = Date.now().toString();
    var category = { id: newId, name: name, createdAt: Date.now(), createdBy: window.currentDeviceId };
    if (type === 'staff') {
        await DB.create('cost_categories', category);
        costCategories.push(category);
        renderRecentCategories(document.getElementById('recentCategoriesList'), costCategories, 'staff');
    } else {
        await DB.create('admin_cost_categories', category);
        adminCostCategories.push(category);
        renderRecentCategories(document.getElementById('adminRecentCategoriesList'), adminCostCategories, 'admin');
    }
    return category;
}

// Render chi phí hôm nay
function renderTodayCosts(container, totalSpan, transactions) {
    if (!container || !totalSpan) return;
    var todayStr = new Date().toISOString().slice(0,10);
    var todayTxs = transactions.filter(function(tx) {
        return (tx.dateKey === todayStr) && !tx.deleted;
    });
    todayTxs.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    var total = 0;
    if (todayTxs.length === 0) {
        container.innerHTML = '<div class="empty-text">📭 Chưa có dữ liệu chi phí</div>';
        totalSpan.innerText = 'Tổng: 0đ';
        return;
    }
    var html = '';
    for (var i = 0; i < todayTxs.length; i++) {
        var tx = todayTxs[i];
        total += tx.amount;
        html += '<div class="today-cost-item">' +
            '<div class="today-cost-name">' + escapeHtml(tx.categoryName) + (tx.quantity > 1 ? ' x' + tx.quantity : '') + '</div>' +
            '<div class="today-cost-amount">' + formatMoney(tx.amount) + '</div>' +
        '</div>';
    }
    container.innerHTML = html;
    totalSpan.innerText = 'Tổng: ' + formatMoney(total);
}

// Render lịch sử tháng
function renderMonthCostSummary(container, transactions) {
    if (!container) return;
    var now = new Date();
    var startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    var endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    var startStr = startDate.toISOString().slice(0,10);
    var endStr = endDate.toISOString().slice(0,10);
    var monthTxs = transactions.filter(function(tx) {
        var d = tx.dateKey || tx.date.slice(0,10);
        return d >= startStr && d <= endStr && !tx.deleted;
    });
    var categoryMap = {};
    for (var i = 0; i < monthTxs.length; i++) {
        var tx = monthTxs[i];
        if (!categoryMap[tx.categoryName]) {
            categoryMap[tx.categoryName] = 0;
        }
        categoryMap[tx.categoryName] += tx.amount;
    }
    var items = [];
    for (var name in categoryMap) {
        items.push({ name: name, amount: categoryMap[name] });
    }
    items.sort(function(a,b) { return b.amount - a.amount; });
    if (items.length === 0) {
        container.innerHTML = '<div class="empty-text">📭 Chưa có dữ liệu tháng này</div>';
        return;
    }
    var html = '<div class="month-cost-grid">';
    for (var j = 0; j < items.length; j++) {
        html += '<div class="month-cost-item">' +
            '<span>' + escapeHtml(items[j].name) + '</span>' +
            '<span>' + formatMoney(items[j].amount) + '</span>' +
        '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

// Mở popup chi phí nhân viên
async function openStaffCostModal() {
    await loadStaffCostData();
    var modal = document.getElementById('costModal');
    var nameInput = document.getElementById('expenseNameInput');
    var amountInput = document.getElementById('expenseAmount');
    var qtyInput = document.getElementById('expenseQty');
    var title = document.getElementById('expensePopupTitle');
    if (title) title.innerText = 'Thêm chi phí Nhân viên';
    if (nameInput) nameInput.value = '';
    if (amountInput) amountInput.value = '';
    if (qtyInput) qtyInput.value = '1';
    renderRecentCategories(document.getElementById('recentCategoriesList'), costCategories, 'staff');
    renderTodayCosts(document.getElementById('todayCostList'), document.getElementById('todayCostTotal'), costTransactions);
    renderMonthCostSummary(document.getElementById('monthCostCategoryList'), costTransactions);
    modal.style.display = 'flex';
}

// Mở popup chi phí quản lý
async function openAdminCostModal() {
    await loadAdminCostData();
    var modal = document.getElementById('adminCostModal');
    var nameInput = document.getElementById('adminExpenseNameInput');
    var amountInput = document.getElementById('adminExpenseAmount');
    var qtyInput = document.getElementById('adminExpenseQty');
    var title = document.getElementById('adminExpensePopupTitle');
    if (title) title.innerText = 'Thêm chi phí Quản lý';
    if (nameInput) nameInput.value = '';
    if (amountInput) amountInput.value = '';
    if (qtyInput) qtyInput.value = '1';
    renderRecentCategories(document.getElementById('adminRecentCategoriesList'), adminCostCategories, 'admin');
    renderTodayCosts(document.getElementById('adminTodayCostList'), document.getElementById('adminTodayCostTotal'), adminCostTransactions);
    renderMonthCostSummary(document.getElementById('adminMonthCostCategoryList'), adminCostTransactions);
    modal.style.display = 'flex';
}

// Lưu chi phí (dùng chung)
async function saveExpenseInternal(type) {
    var categoryName, amount, quantity, collection, categories, containerId;
    if (type === 'staff') {
        categoryName = document.getElementById('expenseNameInput').value.trim();
        amount = parseInt(document.getElementById('expenseAmount').value) || 0;
        quantity = parseInt(document.getElementById('expenseQty').value) || 1;
        collection = 'cost_transactions';
        categories = costCategories;
        containerId = 'recentCategoriesList';
    } else {
        categoryName = document.getElementById('adminExpenseNameInput').value.trim();
        amount = parseInt(document.getElementById('adminExpenseAmount').value) || 0;
        quantity = parseInt(document.getElementById('adminExpenseQty').value) || 1;
        collection = 'cost_transactions_admin';
        categories = adminCostCategories;
        containerId = 'adminRecentCategoriesList';
    }
    
    if (!categoryName) {
        showToast('Vui lòng nhập hoặc chọn danh mục chi phí!', 'warning');
        return;
    }
    if (amount <= 0) {
        showToast('Số tiền phải lớn hơn 0!', 'warning');
        return;
    }
    
    var category = categories.find(function(c) { return c.name === categoryName; });
    if (!category) {
        category = await createNewCategory(categoryName, type);
    }
    
    var nowDate = new Date();
    var nowStr = nowDate.toISOString();
    var data = {
        categoryId: category.id,
        categoryName: category.name,
        amount: amount,
        quantity: quantity,
        note: '',
        date: nowStr,
        dateKey: nowStr.slice(0,10),
        createdAt: Date.now(),
        createdBy: window.currentDeviceId,
        deleted: false
    };
    await DB.create(collection, data);
    
    // Refresh
    if (type === 'staff') {
        costTransactions = await DB.getAll('cost_transactions');
        window.costTransactions = costTransactions;
        renderTodayCosts(document.getElementById('todayCostList'), document.getElementById('todayCostTotal'), costTransactions);
        renderMonthCostSummary(document.getElementById('monthCostCategoryList'), costTransactions);
        document.getElementById('expenseAmount').value = '';
    } else {
        adminCostTransactions = await DB.getAll('cost_transactions_admin');
        window.adminCostTransactions = adminCostTransactions;
        renderTodayCosts(document.getElementById('adminTodayCostList'), document.getElementById('adminTodayCostTotal'), adminCostTransactions);
        renderMonthCostSummary(document.getElementById('adminMonthCostCategoryList'), adminCostTransactions);
        document.getElementById('adminExpenseAmount').value = '';
    }
    
    showToast('✅ Đã thêm chi phí ' + (type === 'staff' ? 'nhân viên' : 'quản lý'), 'success');
    
    // Cập nhật manager nếu đang mở
    var managerView = document.getElementById('managerView');
    if (managerView && managerView.classList.contains('active') && typeof managerApplyFilter === 'function') {
        managerApplyFilter();
    }
}

// Các hàm xử lý danh mục (sửa, xóa)
window.setExpenseName = function(name, type) {
    if (type === 'staff') {
        document.getElementById('expenseNameInput').value = name;
    } else {
        document.getElementById('adminExpenseNameInput').value = name;
    }
};

window.editExpenseName = async function(id, oldName, type) {
    var newName = prompt('Nhập tên mới cho danh mục:', oldName);
    if (!newName || newName === oldName) return;
    var categories = (type === 'staff') ? costCategories : adminCostCategories;
    if (categories.some(function(c) { return c.name === newName; })) {
        showToast('Danh mục đã tồn tại!', 'warning');
        return;
    }
    var collectionName = (type === 'staff') ? 'cost_categories' : 'admin_cost_categories';
    await DB.update(collectionName, id, { name: newName, updatedAt: Date.now() });
    if (type === 'staff') {
        costCategories = await DB.getAll('cost_categories');
        window.costCategories = costCategories;
        renderRecentCategories(document.getElementById('recentCategoriesList'), costCategories, 'staff');
    } else {
        adminCostCategories = await DB.getAll('admin_cost_categories');
        window.adminCostCategories = adminCostCategories;
        renderRecentCategories(document.getElementById('adminRecentCategoriesList'), adminCostCategories, 'admin');
    }
    showToast('Đã sửa danh mục', 'success');
};

window.deleteExpenseCategory = async function(id, type) {
    var used = false;
    if (type === 'staff') {
        used = costTransactions.some(function(tx) { return tx.categoryId === id && !tx.deleted; });
    } else {
        used = adminCostTransactions.some(function(tx) { return tx.categoryId === id && !tx.deleted; });
    }
    if (used) {
        showToast('Danh mục đã có giao dịch, không thể xóa!', 'error');
        return;
    }
    if (!confirm('Xóa danh mục này?')) return;
    var collectionName = (type === 'staff') ? 'cost_categories' : 'admin_cost_categories';
    await DB.remove(collectionName, id);
    if (type === 'staff') {
        costCategories = await DB.getAll('cost_categories');
        window.costCategories = costCategories;
        renderRecentCategories(document.getElementById('recentCategoriesList'), costCategories, 'staff');
    } else {
        adminCostCategories = await DB.getAll('admin_cost_categories');
        window.adminCostCategories = adminCostCategories;
        renderRecentCategories(document.getElementById('adminRecentCategoriesList'), adminCostCategories, 'admin');
    }
    showToast('Đã xóa danh mục', 'success');
};

// Gắn sự kiện
function attachCostPopupEvents() {
    var quickCostBtn = document.getElementById('quickCostBtn');
    if (quickCostBtn) quickCostBtn.onclick = openStaffCostModal;
    
    var adminExpenseBtn = document.getElementById('adminExpenseFab');
    if (adminExpenseBtn) {
        adminExpenseBtn.onclick = function(e) {
            e.stopPropagation();
            openAdminCostModal();
        };
    }
    
    var saveStaffBtn = document.getElementById('saveExpenseBtn');
    if (saveStaffBtn) saveStaffBtn.onclick = function() { saveExpenseInternal('staff'); };
    
    var saveAdminBtn = document.getElementById('saveAdminExpenseBtn');
    if (saveAdminBtn) saveAdminBtn.onclick = function() { saveExpenseInternal('admin'); };
    
    // Close buttons
    var closeStaff = document.querySelectorAll('[data-close="costModal"]');
    for (var i = 0; i < closeStaff.length; i++) {
        closeStaff[i].onclick = function() { closeModal('costModal'); };
    }
    var closeAdmin = document.querySelectorAll('[data-close="adminCostModal"]');
    for (var j = 0; j < closeAdmin.length; j++) {
        closeAdmin[j].onclick = function() { closeModal('adminCostModal'); };
    }
    
    // Quick money buttons
    var quickStaff = document.querySelectorAll('#costModal .quick-money-btn');
    for (var k = 0; k < quickStaff.length; k++) {
        quickStaff[k].onclick = function() {
            var amount = this.getAttribute('data-amount');
            document.getElementById('expenseAmount').value = amount;
        };
    }
    var quickAdmin = document.querySelectorAll('#adminCostModal .quick-money-btn');
    for (var l = 0; l < quickAdmin.length; l++) {
        quickAdmin[l].onclick = function() {
            var amount = this.getAttribute('data-amount');
            document.getElementById('adminExpenseAmount').value = amount;
        };
    }
    
    // Filter
    function initFilter(inputId, listId) {
        var input = document.getElementById(inputId);
        if (!input) return;
        input.addEventListener('input', function() {
            var keyword = this.value.trim().toLowerCase();
            var items = document.querySelectorAll('#' + listId + ' .recent-item');
            for (var i = 0; i < items.length; i++) {
                var btn = items[i].querySelector('.recent-btn');
                if (!btn) continue;
                var name = btn.innerText.replace('📦', '').trim().toLowerCase();
                items[i].style.display = (keyword === '' || name.indexOf(keyword) !== -1) ? 'flex' : 'none';
            }
        });
    }
    initFilter('expenseNameInput', 'recentCategoriesList');
    initFilter('adminExpenseNameInput', 'adminRecentCategoriesList');
}

// Helper: format date range
function formatDateRange(start, end) {
    const s = start.toLocaleDateString('vi-VN');
    const e = end.toLocaleDateString('vi-VN');
    return `${s} → ${e}`;
}
// Xuất global
window.initManager = initManager;
window.openCostModal = openCostModal;
window.setExpenseName = setExpenseName;
window.editExpenseName = editExpenseName;
window.deleteExpenseCategory = deleteExpenseCategory;
window.showExpenseDetail = showExpenseDetail;
window.showAdminExpenseDetail = showAdminExpenseDetail;
window.showDebtDetail = showDebtDetail;