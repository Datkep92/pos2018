// cost.js - Quản lý chi phí
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== CHI PHÍ ==========
function openCostModal() {
    DB.getAll('cost_categories').then(function(cats) { costCategories = cats || []; });
    DB.getAll('cost_transactions').then(function(txs) { costTransactions = txs || []; renderCostCategoriesList(); renderTodayCosts(); renderMonthCostTotal(); });
    
    var costNameInput = document.getElementById('costName');
    var costAmountInput = document.getElementById('costAmount');
    var modal = document.getElementById('costModal');
    
    if (costNameInput) costNameInput.value = '';
    if (costAmountInput) costAmountInput.value = '';
    if (modal) modal.style.display = 'flex';
    else console.error('Không tìm thấy modal costModal');
}

function renderCostCategoriesList() {
    var container = document.getElementById('costCategoriesList');
    if (!container) return;
    if (costCategories.length === 0) { container.innerHTML = '<div class="empty-state">Chưa có danh mục</div>'; return; }
    var html = '<div class="cost-history-title">📦 Danh mục nhanh</div><div class="quick-money" style="flex-wrap:wrap;">';
    for (var i = 0; i < costCategories.length; i++) {
        html += '<button class="quick-money-btn" onclick="setCostName(\'' + escapeHtml(costCategories[i].name) + '\')">' + escapeHtml(costCategories[i].name) + '</button>';
    }
    html += '</div>';
    container.innerHTML = html;
}

function setCostName(name) { document.getElementById('costName').value = name; }

function saveExpense() {
    var name = document.getElementById('costName').value.trim();
    var amount = parseInt(document.getElementById('costAmount').value) || 0;
    if (!name) { showToast('Nhập tên chi phí!', 'warning'); return; }
    if (amount <= 0) { showToast('Số tiền > 0!', 'warning'); return; }

    var cat = null;
    for (var i = 0; i < costCategories.length; i++) { 
        if (costCategories[i].name === name) { 
            cat = costCategories[i]; 
            break; 
        } 
    }

    var saveTrans = function(category) {
        var now = new Date();
        var data = { 
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
            categoryId: category.id, 
            categoryName: category.name, 
            amount: amount, 
            quantity: 1, 
            date: now.toISOString(), 
            dateKey: now.toISOString().slice(0, 10), 
            createdAt: Date.now(), 
            deleted: false 
        };

        return DB.create('cost_transactions', data).then(function(newItem) {
            // Thay vì push, reload lại từ DB để tránh DUP
            return DB.getAll('cost_transactions').then(function(allTx) {
                costTransactions = allTx || [];
                showToast('✅ Đã thêm chi phí ' + formatMoney(amount), 'success');
                document.getElementById('costName').value = '';
                document.getElementById('costAmount').value = '';
                renderTodayCosts();
                renderMonthCostTotal();
            });
        });
    };

    if (cat) {
        saveTrans(cat);
    } else {
        var newId = Date.now().toString();
        var newCat = { id: newId, name: name, createdAt: Date.now() };
        DB.create('cost_categories', newCat).then(function() {
            costCategories.push(newCat);
            renderCostCategoriesList();
            return newCat;
        }).then(saveTrans);
    }
}

function renderTodayCosts() {
    var container = document.getElementById('todayCostList');
    if (!container) return;

    var today = new Date().toISOString().slice(0, 10);
    var todayCosts = costTransactions.filter(function(tx) { 
        return tx.dateKey === today && !tx.deleted; 
    });

    if (todayCosts.length === 0) {
        container.innerHTML = '<div class="empty-text">📭 Chưa có chi phí hôm nay</div>';
        return;
    }

    var total = 0;
    var html = '';

    for (var i = 0; i < todayCosts.length; i++) {
        var tx = todayCosts[i];
        total += tx.amount;

        html += `
            <div class="cost-item">
                <span>${escapeHtml(tx.categoryName)}</span>
                <span style="font-weight:600;">${formatMoney(tx.amount)}</span>
                <div class="cost-actions">
                    <button class="cost-edit-btn" onclick="editExpense('${tx.id}')">✏️</button>
                    <button class="cost-delete-btn" onclick="deleteExpense('${tx.id}')">🗑️</button>
                </div>
            </div>
        `;
    }

    html += `<div class="cost-total">Tổng hôm nay: ${formatMoney(total)}</div>`;
    container.innerHTML = html;
}

function renderMonthCostTotal() {
    var container = document.getElementById('monthCostTotal');
    if (!container) return;
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    var end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    var total = 0;
    for (var i = 0; i < costTransactions.length; i++) {
        if (!costTransactions[i].deleted && costTransactions[i].dateKey >= start && costTransactions[i].dateKey <= end) total += costTransactions[i].amount;
    }
    container.innerText = formatMoney(total);
}

function refreshCostModal() {
    var modal = document.getElementById('costModal');
    if (modal && modal.style.display === 'flex') {
        renderTodayCosts();
        renderMonthCostTotal();
    }
}

// ========== SỬA CHI PHÍ ==========
function editExpense(id) {
    var tx = costTransactions.find(function(item) { return item.id === id; });
    if (!tx) return;

    var newName = prompt('Tên chi phí:', tx.categoryName);
    if (newName === null) return; // bấm hủy

    var newAmount = parseInt(prompt('Số tiền:', tx.amount));
    if (isNaN(newAmount) || newAmount <= 0) {
        showToast('Số tiền không hợp lệ!', 'warning');
        return;
    }

    DB.update('cost_transactions', id, {
        categoryName: newName.trim(),
        amount: newAmount
    }).then(function() {
        showToast('✅ Đã cập nhật chi phí', 'success');
        renderTodayCosts();
        renderMonthCostTotal();
    });
}

// ========== XÓA CHI PHÍ ==========
function deleteExpense(id) {
    if (!confirm('Bạn có chắc muốn xóa chi phí này?')) return;

    DB.update('cost_transactions', id, { deleted: true }).then(function() {
        // Cập nhật mảng local
        costTransactions = costTransactions.filter(function(item) { return item.id !== id; });
        showToast('🗑️ Đã xóa chi phí', 'success');
        renderTodayCosts();
        renderMonthCostTotal();
    });
}

// Export global
window.setCostName = setCostName;
