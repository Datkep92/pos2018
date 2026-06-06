// staff-cost.js - Quản lý chi phí nhân viên (riêng biệt)
// ES5, tương thích Android 6, iOS 12

var staffCostData = {
    transactions: [],
    categories: []
};

var staffCostInitialized = false;

function loadStaffCostData() {
    return Promise.all([
        DB.getAll('cost_categories'),
        DB.getAll('cost_transactions')
    ]).then(function(results) {
        staffCostData.categories = results[0] || [];
        staffCostData.transactions = results[1] || [];
        staffCostData.transactions = staffCostData.transactions.filter(function(c) { return !c.deleted; });
        window.costCategories = staffCostData.categories;
        window.costTransactions = staffCostData.transactions;
    });
}

function initStaffCost() {
    if (staffCostInitialized) return;
    loadStaffCostData().then(function() {
        attachStaffCostEvents();
        staffCostInitialized = true;
        console.log('StaffCost initialized');
    }).catch(function(err) {
        console.error('Init staff cost error:', err);
    });
}

// ========== MODAL CHI PHÍ NHÂN VIÊN ==========
function openStaffCostModal() {
    loadStaffCostData().then(function() {
        var modal = document.getElementById('staffCostModal');
        if (!modal) return;
        var nameInput = document.getElementById('staffExpenseNameInput');
        var amountInput = document.getElementById('staffExpenseAmount');
        var qtyInput = document.getElementById('staffExpenseQty');
        var title = document.getElementById('staffExpensePopupTitle');
        if (nameInput) nameInput.value = '';
        if (amountInput) amountInput.value = '';
        if (qtyInput) qtyInput.value = '1';
        if (title) title.innerText = 'Thêm chi phí Nhân viên';
        renderStaffRecentCategories();
        renderStaffTodayCosts();
        renderStaffMonthCostTotal();
        modal.style.display = 'flex';
    });
}

function renderStaffRecentCategories() {
    var container = document.getElementById('staffRecentCategoriesList');
    if (!container) return;
    if (staffCostData.categories.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có danh mục</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < staffCostData.categories.length; i++) {
        var cat = staffCostData.categories[i];
        html += '<div class="recent-item">' +
            '<button class="recent-btn" onclick="setStaffExpenseName(\'' + escapeHtml(cat.name) + '\')">📦 ' + escapeHtml(cat.name) + '</button>' +
            '<button class="action-btn-edit" onclick="editStaffExpenseCategory(\'' + cat.id + '\', \'' + escapeHtml(cat.name) + '\')">✏️</button>' +
            '<button class="action-btn-delete" onclick="deleteStaffExpenseCategory(\'' + cat.id + '\')">🗑️</button>' +
        '</div>';
    }
    container.innerHTML = html;
}

function setStaffExpenseName(name) {
    var input = document.getElementById('staffExpenseNameInput');
    if (input) input.value = name;
}

function editStaffExpenseCategory(id, oldName) {
    var newName = prompt('Nhập tên mới cho danh mục:', oldName);
    if (!newName || newName === oldName) return;
    var exists = false;
    for (var i = 0; i < staffCostData.categories.length; i++) {
        if (staffCostData.categories[i].name === newName) {
            exists = true;
            break;
        }
    }
    if (exists) {
        showToast('Danh mục đã tồn tại!', 'warning');
        return;
    }
    DB.update('cost_categories', id, { name: newName, updatedAt: Date.now() }).then(function() {
        return loadStaffCostData();
    }).then(function() {
        renderStaffRecentCategories();
        showToast('Đã sửa danh mục', 'success');
    });
}

function deleteStaffExpenseCategory(id) {
    var used = false;
    for (var i = 0; i < staffCostData.transactions.length; i++) {
        if (staffCostData.transactions[i].categoryId === id && !staffCostData.transactions[i].deleted) {
            used = true;
            break;
        }
    }
    if (used) {
        showToast('Danh mục đã có giao dịch, không thể xóa!', 'error');
        return;
    }
    if (!confirm('Xóa danh mục này?')) return;
    DB.remove('cost_categories', id).then(function() {
        return loadStaffCostData();
    }).then(function() {
        renderStaffRecentCategories();
        showToast('Đã xóa danh mục', 'success');
    });
}

function renderStaffTodayCosts() {
    var container = document.getElementById('staffTodayCostList');
    var totalSpan = document.getElementById('staffTodayCostTotal');
    if (!container || !totalSpan) return;
    var todayStr = new Date().toISOString().slice(0,10);
    var todayCosts = [];
    for (var i = 0; i < staffCostData.transactions.length; i++) {
        var tx = staffCostData.transactions[i];
        if (tx.dateKey === todayStr && !tx.deleted) todayCosts.push(tx);
    }
    todayCosts.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    var total = 0;
    if (todayCosts.length === 0) {
        container.innerHTML = '<div class="empty-text">📭 Chưa có chi phí nhân viên hôm nay</div>';
        totalSpan.innerText = 'Tổng: 0đ';
        return;
    }
    var html = '';
    for (var k = 0; k < todayCosts.length; k++) {
        var tx = todayCosts[k];
        total += tx.amount;
        html += '<div class="today-cost-item">' +
            '<div class="today-cost-name">' + escapeHtml(tx.categoryName) + (tx.quantity > 1 ? ' x' + tx.quantity : '') + '</div>' +
            '<div class="today-cost-amount">' + formatMoney(tx.amount) + '</div>' +
        '</div>';
    }
    container.innerHTML = html;
    totalSpan.innerText = 'Tổng: ' + formatMoney(total);
}

function renderStaffMonthCostTotal() {
    var container = document.getElementById('staffMonthCostTotal');
    if (!container) return;
    var now = new Date();
    var startStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    var endStr = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0,10);
    var total = 0;
    for (var i = 0; i < staffCostData.transactions.length; i++) {
        var tx = staffCostData.transactions[i];
        if (!tx.deleted && tx.dateKey >= startStr && tx.dateKey <= endStr) {
            total += tx.amount;
        }
    }
    container.innerText = formatMoney(total);
}

function saveStaffExpense() {
    var categoryName = document.getElementById('staffExpenseNameInput').value.trim();
    var amount = parseInt(document.getElementById('staffExpenseAmount').value) || 0;
    var quantity = parseInt(document.getElementById('staffExpenseQty').value) || 1;
    if (!categoryName) {
        showToast('Vui lòng nhập danh mục chi phí nhân viên!', 'warning');
        return;
    }
    if (amount <= 0) {
        showToast('Số tiền phải lớn hơn 0!', 'warning');
        return;
    }
    var category = null;
    for (var i = 0; i < staffCostData.categories.length; i++) {
        if (staffCostData.categories[i].name === categoryName) {
            category = staffCostData.categories[i];
            break;
        }
    }
    var saveTrans = function(cat) {
        var nowDate = new Date();
        var nowStr = nowDate.toISOString();
        var data = {
            categoryId: cat.id,
            categoryName: cat.name,
            amount: amount,
            quantity: quantity,
            note: '',
            date: nowStr,
            dateKey: nowStr.slice(0,10),
            createdAt: Date.now(),
            createdBy: window.currentDeviceId,
            deleted: false
        };
        return DB.create('cost_transactions', data).then(function() {
            return loadStaffCostData();
        });
    };
    if (category) {
        saveTrans(category).then(function() {
            renderStaffTodayCosts();
            renderStaffMonthCostTotal();
            showToast('✅ Đã thêm chi phí nhân viên', 'success');
            document.getElementById('staffExpenseAmount').value = '';
        });
    } else {
        var newId = Date.now().toString();
        var newCat = { id: newId, name: categoryName, createdAt: Date.now(), createdBy: window.currentDeviceId };
        DB.create('cost_categories', newCat).then(function() {
            staffCostData.categories.push(newCat);
            renderStaffRecentCategories();
            return newCat;
        }).then(saveTrans).then(function() {
            renderStaffTodayCosts();
            renderStaffMonthCostTotal();
            showToast('✅ Đã thêm chi phí nhân viên', 'success');
            document.getElementById('staffExpenseAmount').value = '';
        });
    }
}

function attachStaffCostEvents() {
    var openBtn = document.getElementById('openStaffCostModalBtn');
    if (openBtn) openBtn.onclick = function() { openStaffCostModal(); };

    var saveBtn = document.getElementById('saveStaffExpenseBtn');
    if (saveBtn) saveBtn.onclick = saveStaffExpense;

    var closeBtns = document.querySelectorAll('[data-close="staffCostModal"]');
    for (var i = 0; i < closeBtns.length; i++) {
        closeBtns[i].onclick = function() { closeModal('staffCostModal'); };
    }

    var quickMoneyBtns = document.querySelectorAll('#staffCostModal .quick-money-btn');
    for (var j = 0; j < quickMoneyBtns.length; j++) {
        quickMoneyBtns[j].onclick = function() {
            var amount = this.getAttribute('data-amount');
            var amountInput = document.getElementById('staffExpenseAmount');
            if (amountInput) amountInput.value = amount;
        };
    }

    // Filter categories
    var filterInput = document.getElementById('staffExpenseNameInput');
    if (filterInput) {
        filterInput.addEventListener('input', function() {
            var keyword = this.value.trim().toLowerCase();
            var items = document.querySelectorAll('#staffRecentCategoriesList .recent-item');
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
        });
    }
}

// Export global
window.initStaffCost = initStaffCost;
window.openStaffCostModal = openStaffCostModal;
window.setStaffExpenseName = setStaffExpenseName;
window.editStaffExpenseCategory = editStaffExpenseCategory;
window.deleteStaffExpenseCategory = deleteStaffExpenseCategory;
