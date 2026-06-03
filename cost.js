// ========== QUẢN LÝ CHI PHÍ - UI MỚI ==========
var costCategories = [];
var costTransactions = [];
var currentCostFilter = 'today';
var currentCostStartDate = null;
var currentCostEndDate = null;
var currentEditingCostId = null;
var currentViewMode = 'period';   // 'period', 'month', 'day'
var currentPeriod = { startDate: null, endDate: null };
var currentMonth = null;          // Date object, lưu tháng đang xem
var currentDay = null;            // Date object, lưu ngày đang xem
// Khởi tạo (gọi từ script.js)
async function initCost() {
    costCategories = await DB.getAll('cost_categories') || [];
    costTransactions = await DB.getAll('cost_transactions') || [];
    window.costCategories = costCategories;
    window.costTransactions = costTransactions;
    initCostFilter();               // <-- thay thế attachCostFilterEvents
    attachCostModalEvents();
    renderRecentCategories();
    renderTodayCosts();
}
// ========== BỘ LỌC MỚI ==========
function initCostFilter() {
    computeCurrentPeriod();
    currentMonth = new Date();
    currentDay = new Date();
    updateViewMode();
    attachFilterEvents();
    applyCostFilterByMode(); // lọc dữ liệu ban đầu
}

function computeCurrentPeriod() {
    var now = new Date();
    var currentDayNum = now.getDate();
    var targetMonth = now.getMonth();
    var targetYear = now.getFullYear();
    var startDate, endDate;
    if (currentDayNum >= 20) {
        startDate = new Date(targetYear, targetMonth, 20);
        endDate = new Date(targetYear, targetMonth + 1, 19);
    } else {
        startDate = new Date(targetYear, targetMonth - 1, 20);
        endDate = new Date(targetYear, targetMonth, 19);
    }
    currentPeriod.startDate = startDate;
    currentPeriod.endDate = endDate;
}

function shiftPeriod(delta) {
    var newStart = new Date(currentPeriod.startDate);
    newStart.setMonth(newStart.getMonth() + delta);
    newStart.setDate(20);
    var newEnd = new Date(newStart);
    newEnd.setMonth(newStart.getMonth() + 1);
    newEnd.setDate(19);
    currentPeriod.startDate = newStart;
    currentPeriod.endDate = newEnd;
    updateViewMode();
    applyCostFilterByMode();
}

function shiftMonth(delta) {
    var newMonth = new Date(currentMonth);
    newMonth.setMonth(newMonth.getMonth() + delta);
    currentMonth = newMonth;
    updateViewMode();
    applyCostFilterByMode();
}

function shiftDay(delta) {
    var newDay = new Date(currentDay);
    newDay.setDate(newDay.getDate() + delta);
    currentDay = newDay;
    updateViewMode();
    applyCostFilterByMode();
}

function updateViewMode() {
    var select = document.getElementById('viewModeSelect');
    var displayDiv = document.getElementById('periodDisplay');
    if (!select || !displayDiv) return;
    var mode = select.value;
    currentViewMode = mode;
    if (mode === 'period') {
        var startStr = formatDateShort(currentPeriod.startDate);
        var endStr = formatDateShort(currentPeriod.endDate);
        displayDiv.innerText = startStr + ' → ' + endStr;
        select.options[0].text = 'Kỳ ' + startStr + ' → ' + endStr;
    } else if (mode === 'month') {
        var monthStr = formatMonthYear(currentMonth);
        displayDiv.innerText = 'Tháng ' + monthStr;
        select.options[1].text = 'Tháng ' + monthStr;
    } else if (mode === 'day') {
        var dayStr = formatDateShort(currentDay);
        displayDiv.innerText = dayStr;
        select.options[2].text = dayStr;
    }
}

function formatDateShort(date) {
    if (!date || isNaN(date.getTime())) return '--/--/----';
    return date.getDate() + '/' + (date.getMonth()+1) + '/' + date.getFullYear();
}

function formatMonthYear(date) {
    var m = date.getMonth() + 1;
    var y = date.getFullYear();
    return m + '/' + y;
}

function applyCostFilterByMode() {
    var startDate, endDate;
    if (currentViewMode === 'period') {
        startDate = currentPeriod.startDate;
        endDate = currentPeriod.endDate;
    } else if (currentViewMode === 'month') {
        startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
        endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    } else { // day
        startDate = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate());
        endDate = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate());
        endDate.setDate(endDate.getDate() + 1);
    }
    var filtered = getCostTransactionsByDateRange(startDate, endDate);
    renderCostList(filtered);
    updateCostSummary(filtered);
}

function attachFilterEvents() {
    var prevBtn = document.getElementById('periodPrevBtn');
    var nextBtn = document.getElementById('periodNextBtn');
    var modeSelect = document.getElementById('viewModeSelect');
    if (prevBtn) {
        prevBtn.onclick = function() {
            if (currentViewMode === 'period') shiftPeriod(-1);
            else if (currentViewMode === 'month') shiftMonth(-1);
            else shiftDay(-1);
        };
    }
    if (nextBtn) {
        nextBtn.onclick = function() {
            if (currentViewMode === 'period') shiftPeriod(1);
            else if (currentViewMode === 'month') shiftMonth(1);
            else shiftDay(1);
        };
    }
    if (modeSelect) {
        modeSelect.onchange = function() {
            currentViewMode = this.value;
            if (currentViewMode === 'period') computeCurrentPeriod();
            else if (currentViewMode === 'month') currentMonth = currentMonth || new Date();
            else if (currentViewMode === 'day') currentDay = currentDay || new Date();
            updateViewMode();
            applyCostFilterByMode();
        };
    }
}
// Render danh sách danh mục gần đây (trong popup)
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

// Đặt tên danh mục vào ô input
function setExpenseName(name) {
    document.getElementById('expenseNameInput').value = name;
}

// Sửa tên danh mục
function editExpenseName(id, oldName) {
    var newName = prompt('Nhập tên mới cho danh mục:', oldName);
    if (!newName || newName === oldName) return;
    // Kiểm tra trùng
    if (costCategories.find(function(c) { return c.name === newName; })) {
        showToast('Danh mục đã tồn tại!', 'warning');
        return;
    }
    (async function() {
        await DB.update('cost_categories', id, { name: newName, updatedAt: Date.now() });
        costCategories = await DB.getAll('cost_categories');
        window.costCategories = costCategories;
        renderRecentCategories();
        renderTodayCosts(); // cập nhật lại tên trong danh sách chi phí hôm nay
        showToast('Đã sửa danh mục', 'success');
    })();
}

// Xóa danh mục (chỉ xóa nếu không có giao dịch nào dùng)
function deleteExpenseCategory(id) {
    var used = costTransactions.some(function(tx) { return tx.categoryId === id && !tx.deleted; });
    if (used) {
        showToast('Danh mục đã có giao dịch, không thể xóa!', 'error');
        return;
    }
    if (!confirm('Xóa danh mục này?')) return;
    (async function() {
        await DB.remove('cost_categories', id);
        costCategories = await DB.getAll('cost_categories');
        window.costCategories = costCategories;
        renderRecentCategories();
        showToast('Đã xóa danh mục', 'success');
    })();
}

// Render chi phí hôm nay trong popup
async function renderTodayCosts() {
    var container = document.getElementById('todayCostList');
    var totalSpan = document.getElementById('todayCostTotal');
    if (!container) return;
    var todayStr = new Date().toISOString().slice(0,10);
    var todayTxs = costTransactions.filter(function(tx) {
        return (tx.dateKey === todayStr || tx.date.slice(0,10) === todayStr) && !tx.deleted;
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

// Lưu giao dịch chi phí (từ popup)
async function saveExpenseFromPopup() {
    var categoryName = document.getElementById('expenseNameInput').value.trim();
    var amount = parseInt(document.getElementById('expenseAmount').value) || 0;
    var quantity = parseInt(document.getElementById('expenseQty').value) || 1;
    if (!categoryName) {
        showToast('Vui lòng nhập hoặc chọn danh mục chi phí!', 'warning');
        return;
    }
    if (amount <= 0) {
        showToast('Số tiền phải lớn hơn 0!', 'warning');
        return;
    }
    // Tìm hoặc tạo category
    var category = costCategories.find(function(c) { return c.name === categoryName; });
    if (!category) {
        var newId = Date.now().toString();
        category = { id: newId, name: categoryName, createdAt: Date.now(), createdBy: window.currentDeviceId };
        await DB.create('cost_categories', category);
        costCategories.push(category);
        window.costCategories = costCategories;
        renderRecentCategories();
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
    await DB.create('cost_transactions', data);
    // Refresh dữ liệu
    costTransactions = await DB.getAll('cost_transactions');
    window.costTransactions = costTransactions;
    renderTodayCosts();
    // Reset form
    document.getElementById('expenseAmount').value = '';
    // Cập nhật tab cost nếu đang mở
    applyCostFilter(currentCostFilter);
    showToast('✅ Đã thêm chi phí', 'success');
}

// Các hàm cho tab chi phí (giữ nguyên)
function renderCostCategoriesList() { /* không dùng trong popup mới nhưng giữ để tương thích */ }
function getCostTransactionsByDateRange(startDate, endDate) {
    var result = [];
    var startStr = startDate.toISOString().slice(0,10);
    var endStr = endDate.toISOString().slice(0,10);
    for (var i = 0; i < costTransactions.length; i++) {
        var tx = costTransactions[i];
        if (tx.deleted) continue;
        var txDate = tx.dateKey || tx.date.slice(0,10);
        if (txDate >= startStr && txDate <= endStr) result.push(tx);
    }
    result.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    return result;
}
function applyCostFilter(filterType, customStart, customEnd) {
    var now = new Date();
    var startDate, endDate;
    var todayStr = now.toISOString().slice(0,10);
    switch(filterType) {
        case 'today':
            startDate = new Date(todayStr);
            endDate = new Date(todayStr);
            endDate.setDate(endDate.getDate() + 1);
            break;
        case 'yesterday':
            var yesterday = new Date(now);
            yesterday.setDate(now.getDate() - 1);
            var yStr = yesterday.toISOString().slice(0,10);
            startDate = new Date(yStr);
            endDate = new Date(yStr);
            endDate.setDate(endDate.getDate() + 1);
            break;
        case 'week7':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 6);
            startDate.setHours(0,0,0,0);
            endDate = new Date(now);
            endDate.setHours(23,59,59,999);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            break;
        case 'lastMonth':
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDate = new Date(now.getFullYear(), now.getMonth(), 0);
            break;
        case 'period20':
            var currentDay = now.getDate();
            var targetMonth = now.getMonth();
            var targetYear = now.getFullYear();
            if (currentDay >= 20) {
                startDate = new Date(targetYear, targetMonth, 20);
                endDate = new Date(targetYear, targetMonth + 1, 19);
            } else {
                startDate = new Date(targetYear, targetMonth - 1, 20);
                endDate = new Date(targetYear, targetMonth, 19);
            }
            break;
        case 'custom':
            startDate = new Date(customStart);
            endDate = new Date(customEnd);
            endDate.setDate(endDate.getDate() + 1);
            break;
        default: return;
    }
    currentCostStartDate = startDate;
    currentCostEndDate = endDate;
    var filtered = getCostTransactionsByDateRange(startDate, endDate);
    renderCostList(filtered);
    updateCostSummary(filtered);
}
function updateCostSummary(transactions) {
    var totalAmount = 0;
    for (var i = 0; i < transactions.length; i++) totalAmount += transactions[i].amount;
    var totalCount = transactions.length;
    var amountEl = document.getElementById('costTotalAmount');
    var countEl = document.getElementById('costTotalCount');
    if (amountEl) amountEl.innerText = formatMoney(totalAmount);
    if (countEl) countEl.innerText = totalCount;
}
function renderCostList(transactions) {
    var container = document.getElementById('costListContainer');
    if (!container) return;
    if (transactions.length === 0) {
        container.innerHTML = '<div class="empty-state">📭 Không có chi phí trong khoảng thời gian này</div>';
        return;
    }
    var isAdmin = (window.currentUserRole === 'admin');
    var now = new Date();
    var todayStr = now.toISOString().slice(0,10);
    var html = '';
    for (var i = 0; i < transactions.length; i++) {
        var tx = transactions[i];
        var canEdit = isAdmin || (tx.dateKey === todayStr);
        var editBtn = canEdit ? '<button class="cost-edit-btn" data-id="' + tx.id + '">✏️</button>' : '';
        var deleteBtn = canEdit ? '<button class="cost-delete-btn" data-id="' + tx.id + '">🗑️</button>' : '';
        html += '<div class="cost-item" data-id="' + tx.id + '">' +
            '<div class="cost-info" onclick="showCategoryHistory(\'' + tx.categoryId + '\', \'' + escapeHtml(tx.categoryName) + '\')">' +
                '<div class="cost-name">' + escapeHtml(tx.categoryName) + '</div>' +
                '<div class="cost-detail">' +
                    '<span class="cost-amount">' + formatMoney(tx.amount) + '</span>' +
                    (tx.quantity > 1 ? '<span class="cost-qty"> x' + tx.quantity + '</span>' : '') +
                    '<span class="cost-date">' + new Date(tx.date).toLocaleDateString('vi-VN') + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="cost-actions">' + editBtn + deleteBtn + '</div>' +
        '</div>';
    }
    container.innerHTML = html;
    // Gắn sự kiện (dùng delegate)
    var editBtns = container.querySelectorAll('.cost-edit-btn');
    for (var j = 0; j < editBtns.length; j++) {
        editBtns[j].onclick = function(e) {
            e.stopPropagation();
            editCostTransaction(this.getAttribute('data-id'));
        };
    }
    var delBtns = container.querySelectorAll('.cost-delete-btn');
    for (var k = 0; k < delBtns.length; k++) {
        delBtns[k].onclick = function(e) {
            e.stopPropagation();
            deleteCostTransaction(this.getAttribute('data-id'));
        };
    }
}
async function editCostTransaction(id) {
    var tx = costTransactions.find(function(t) { return t.id === id; });
    if (!tx) return;
    document.getElementById('expenseNameInput').value = tx.categoryName;
    document.getElementById('expenseAmount').value = tx.amount;
    document.getElementById('expenseQty').value = tx.quantity || 1;
    currentEditingCostId = id;
    document.getElementById('costModal').style.display = 'flex';
}
async function deleteCostTransaction(id) {
    if (!confirm('Xóa giao dịch chi phí này?')) return;
    await DB.update('cost_transactions', id, { deleted: true, updatedAt: Date.now() });
    costTransactions = await DB.getAll('cost_transactions');
    window.costTransactions = costTransactions;
    renderTodayCosts();
    applyCostFilter(currentCostFilter);
    showToast('Đã xóa chi phí', 'success');
}
async function showCategoryHistory(categoryId, categoryName) {
    var allTxs = await DB.getAll('cost_transactions');
    var filtered = [];
    for (var i = 0; i < allTxs.length; i++) {
        var tx = allTxs[i];
        if (tx.categoryId === categoryId && !tx.deleted) filtered.push(tx);
    }
    filtered.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    var html = '<div class="cost-history-header">📜 Lịch sử chi phí: <strong>' + escapeHtml(categoryName) + '</strong></div>';
    if (filtered.length === 0) {
        html += '<div class="empty-state">Chưa có giao dịch nào</div>';
    } else {
        html += '<div class="cost-history-list">';
        for (var j = 0; j < filtered.length; j++) {
            var tx = filtered[j];
            var dateStr = new Date(tx.date).toLocaleDateString('vi-VN');
            var timeStr = new Date(tx.date).toLocaleTimeString('vi-VN');
            html += '<div class="cost-history-item">' +
                '<div class="cost-history-date">' + dateStr + ' ' + timeStr + '</div>' +
                '<div class="cost-history-amount">' + formatMoney(tx.amount) + (tx.quantity > 1 ? ' x' + tx.quantity : '') + '</div>' +
                (tx.note ? '<div class="cost-history-note">' + escapeHtml(tx.note) + '</div>' : '') +
            '</div>';
        }
        html += '</div>';
    }
    document.getElementById('costHistoryList').innerHTML = html;
    document.getElementById('costHistoryTitle').innerHTML = '📜 Lịch sử chi phí - ' + escapeHtml(categoryName);
    document.getElementById('costHistoryModal').style.display = 'flex';
}
function attachCostFilterEvents() {
    var btns = document.querySelectorAll('.filter-btn');
    for (var i = 0; i < btns.length; i++) {
        btns[i].onclick = function(e) {
            var filter = this.getAttribute('data-filter');
            currentCostFilter = filter;
            var allBtns = document.querySelectorAll('.filter-btn');
            for (var j = 0; j < allBtns.length; j++) allBtns[j].classList.remove('active');
            this.classList.add('active');
            var customRangeDiv = document.querySelector('.cost-date-range');
            if (filter === 'custom') {
                customRangeDiv.style.display = 'flex';
                document.getElementById('costStartDate').value = '';
                document.getElementById('costEndDate').value = '';
            } else {
                customRangeDiv.style.display = 'none';
                applyCostFilter(filter);
            }
        };
    }
    var applyBtn = document.getElementById('applyCustomRange');
    if (applyBtn) {
        applyBtn.onclick = function() {
            var start = document.getElementById('costStartDate').value;
            var end = document.getElementById('costEndDate').value;
            if (!start || !end) {
                showToast('Chọn đầy đủ ngày bắt đầu và kết thúc', 'warning');
                return;
            }
            applyCostFilter('custom', start, end);
        };
    }
}
function attachCostModalEvents() {
    var openBtn = document.getElementById('openCostModalBtn');
    if (openBtn) openBtn.onclick = function() { document.getElementById('costModal').style.display = 'flex'; };
    var saveBtn = document.getElementById('saveExpenseBtn');
    if (saveBtn) saveBtn.onclick = saveExpenseFromPopup;
    var closeBtns = document.querySelectorAll('[data-close="costModal"]');
    for (var i = 0; i < closeBtns.length; i++) {
        closeBtns[i].onclick = function() { closeModal('costModal'); };
    }
    // Nút nhập tiền nhanh
    var quickBtns = document.querySelectorAll('.quick-money-btn');
    for (var j = 0; j < quickBtns.length; j++) {
        quickBtns[j].onclick = function() {
            var amount = this.getAttribute('data-amount');
            document.getElementById('expenseAmount').value = amount;
        };
    }
    // Nút nhanh từ tab bàn
    var quickCostBtn = document.getElementById('quickCostBtn');
    if (quickCostBtn) quickCostBtn.onclick = function() { document.getElementById('costModal').style.display = 'flex'; };
}
// ========== REALTIME: LẮNG NGHE THAY ĐỔI TỪ MÁY KHÁC ==========
async function refreshCostData() {
    costCategories = await DB.getAll('cost_categories') || [];
    costTransactions = await DB.getAll('cost_transactions') || [];
    window.costCategories = costCategories;
    window.costTransactions = costTransactions;
    renderRecentCategories();
    renderTodayCosts();
    var costView = document.getElementById('costView');
    if (costView && costView.classList.contains('active')) {
        applyCostFilterByMode();   // cập nhật danh sách theo chế độ hiện tại
    }
}

// Lắng nghe sự kiện db_update từ db.js
window.addEventListener('db_update', function(event) {
    var collection = event.detail && event.detail.collection;
    if (collection === 'cost_categories' || collection === 'cost_transactions') {
        refreshCostData();
    }
});

// Ghi đè sự kiện mở modal để refresh dữ liệu trước khi hiển thị
function attachCostModalEvents() {
    var openBtn = document.getElementById('openCostModalBtn');
    if (openBtn) {
        openBtn.onclick = function() {
            refreshCostData().then(function() {
                document.getElementById('costModal').style.display = 'flex';
            });
        };
    }
    var quickCostBtn = document.getElementById('quickCostBtn');
    if (quickCostBtn) {
        quickCostBtn.onclick = function() {
            refreshCostData().then(function() {
                document.getElementById('costModal').style.display = 'flex';
            });
        };
    }
    var saveBtn = document.getElementById('saveExpenseBtn');
    if (saveBtn) saveBtn.onclick = saveExpenseFromPopup;
    var closeBtns = document.querySelectorAll('[data-close="costModal"]');
    for (var i = 0; i < closeBtns.length; i++) {
        closeBtns[i].onclick = function() { closeModal('costModal'); };
    }
    // Nút nhập tiền nhanh
    var quickBtns = document.querySelectorAll('.quick-money-btn');
    for (var j = 0; j < quickBtns.length; j++) {
        quickBtns[j].onclick = function() {
            var amount = this.getAttribute('data-amount');
            document.getElementById('expenseAmount').value = amount;
        };
    }
}
// Xuất global
window.initCost = initCost;
window.setExpenseName = setExpenseName;
window.editExpenseName = editExpenseName;
window.deleteExpenseCategory = deleteExpenseCategory;
window.showCategoryHistory = showCategoryHistory;
window.saveExpenseFromPopup = saveExpenseFromPopup;
window.editCostTransaction = editCostTransaction;
window.deleteCostTransaction = deleteCostTransaction;