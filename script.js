// script.js - Hàm chung, biến global, khởi tạo, realtime
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== BIẾN GLOBAL ==========
var currentTab = 'tables';
var tempOrder = [];
var selectedCustomer = null;
var currentHistoryDate = new Date();
var currentReportDate = new Date();
var costCategories = [];
var costTransactions = [];
var menuItems = [];
var menuCategories = [];
var ingredients = [];
var customers = [];
var currentTableDetailId = null;
var currentMenuCategory = 'all';
var pendingPaymentTableId = null;
var pendingCustomerCallback = null;
var pendingDebtCustomerId = null;
var pendingSplitTableId = null;
var pendingTransferSourceTable = null;
var pendingMergeSourceId = null;
var pendingDeleteTableId = null;
var currentAddToTableId = null;
var renderDebounceTimer = null;
// Cache
var cachedTables = [];
var tablesCacheTime = 0;
var CACHE_TTL = 2000;
var renderScheduled = false;

// ========== KHỞI TẠO ==========
document.addEventListener('DOMContentLoaded', function() {
    DB.init().then(function() {
        return loadData();
    }).then(function() {
        initEventListeners();
        renderCurrentTime();
        setInterval(renderCurrentTime, 1000);
        showToast('POS sẵn sàng', 'success');
    });
});

function loadData() {
    return Promise.all([
        DB.getAll('menu'),
        DB.getAll('menu_categories'),
        DB.getAll('ingredients'),
        DB.getAll('customers'),
        DB.getAll('cost_categories'),
        DB.getAll('cost_transactions')
    ]).then(function(results) {
        menuItems = results[0] || [];
        menuCategories = results[1] || [];
        ingredients = results[2] || [];
        customers = results[3] || [];
        costCategories = results[4] || [];
        costTransactions = results[5] || [];
        window.menuItems = menuItems;
        window.ingredients = ingredients;
        window.customers = customers;
        return renderTables();
        updateRecentToast();
    }).then(function() {
        renderCustomerList();
        renderHistoryByDate(currentHistoryDate);
        renderReport(currentReportDate);
        initRealtime();
    });
}

// ========== HÀM TIỆN ÍCH ==========
function formatMoney(amount) { return (amount || 0).toLocaleString('vi-VN') + 'đ'; }
function showToast(message, type) { var toast = document.createElement('div'); toast.className = 'toast ' + type; toast.innerText = message; document.getElementById('toastContainer').appendChild(toast); setTimeout(function() { toast.remove(); }, 2500); }
function closeModal(modalId) { var m = document.getElementById(modalId); if (m) m.style.display = 'none'; }
function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, function(m) { if (m === '&') return '&'; if (m === '<') return '<'; if (m === '>') return '>'; return m; }); }
function formatDateDisplay(dateStr) { var d = new Date(dateStr); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }
function renderCurrentTime() { var now = new Date(); var timeEl = document.getElementById('currentTime'); if (timeEl) timeEl.innerText = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }

// ========== REALTIME THÔNG MINH ==========
function initRealtime() {
    DB.subscribe('tables', function(newTables) {
        if (!newTables) return;
        cachedTables = newTables;
        tablesCacheTime = Date.now();
        if (currentTab !== 'tables') return;
        if (renderScheduled) return;
        renderScheduled = true;
        setTimeout(function() {
            renderScheduled = false;
            updateTablesDiff(newTables);
        }, 100);
    });
    DB.subscribe('daily_balances', function() {
    if (currentTab === 'report' || currentTab === 'manager') {
        renderReport(currentReportDate);
        if (typeof managerApplyFilter === 'function') {
            managerApplyFilter();
        }
    }
});
    DB.subscribe('customers', function(data) {
        customers = data || [];
        if (currentTab === 'customers') renderCustomerList();
        var selectorModal = document.getElementById('customerSelectorModal');
        if (selectorModal && selectorModal.style.display === 'flex') {
            var searchVal = document.getElementById('customerSelectorSearch') ? document.getElementById('customerSelectorSearch').value : '';
            renderCustomerSelectorList(searchVal);
        }
    });
    
    DB.subscribe('menu', function(data) {
        menuItems = data || [];
        if (document.getElementById('orderModal').style.display === 'flex') {
            renderMenuByCategory(currentMenuCategory);
        }
    });
    
    DB.subscribe('menu_categories', function(data) {
        menuCategories = data || [];
        if (document.getElementById('orderModal').style.display === 'flex') {
            renderOrderCategories();
        }
    });
    
    DB.subscribe('ingredients', function(data) { ingredients = data || []; });
    
   // Trong initRealtime, thay đổi:
DB.subscribe('transactions', function() {
        updateRecentToast();   // thêm dòng này

    // Hủy lần render trước nếu chưa kịp chạy
    if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
    // Đợi 150ms để gộp nhiều sự kiện
    renderDebounceTimer = setTimeout(function() {
        if (currentTab === 'history') renderHistoryByDate(currentHistoryDate);
        if (currentTab === 'report') renderReport(currentReportDate);
        renderDebounceTimer = null;
    }, 150);
});
    
    DB.subscribe('cost_categories', function(data) { costCategories = data || []; refreshCostModal(); });
DB.subscribe('cost_transactions', function(data) {
    costTransactions = data || [];
    refreshCostModal();
});
}

function updateRecentToast() {
    var todayStr = new Date().toISOString().slice(0, 10);
    DB.getTransactionsByDate(todayStr).then(function(transactions) {
        var validTx = transactions.filter(function(tx) { return !tx.refunded; });
        validTx.sort(function(a, b) {
            return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
        });
        var recent = validTx.slice(0, 3);
        var container = document.getElementById('recentToastList');
        if (!container) return;
        
        if (recent.length === 0) {
            container.innerHTML = '<div style="font-size: 10px; color: #64748b; text-align:center;">✨ Chưa có giao dịch</div>';
            return;
        }
        
        var html = '';
        for (var i = 0; i < recent.length; i++) {
            var tx = recent[i];
            var timeDiff = Math.floor((Date.now() - new Date(tx.createdAt || tx.date)) / 60000);
            var timeText = '';
            if (timeDiff < 1) timeText = 'vừa xong';
            else if (timeDiff < 60) timeText = timeDiff + 'p';
            else timeText = Math.floor(timeDiff / 60) + 'h';
            
            var totalItems = 0;
            if (tx.items && tx.items.length) {
                for (var j = 0; j < tx.items.length; j++) totalItems += tx.items[j].qty;
            }
            
            var shortInfo = '';
            if (tx.tableName) shortInfo = tx.tableName;
            else if (tx.type === 'takeaway') shortInfo = 'Mang đi';
            else if (tx.type === 'grab') shortInfo = 'Grab';
            else shortInfo = 'Tại chỗ';
            
            // Thêm phương thức thanh toán
            var methodIcon = '';
            if (tx.paymentMethod === 'cash') methodIcon = '💰';
            else if (tx.paymentMethod === 'transfer') methodIcon = '💳';
            else if (tx.paymentMethod === 'debt') methodIcon = '💢';
            else if (tx.paymentMethod === 'grab') methodIcon = '🚕';
            else methodIcon = '💵';
            
            html += `
                <div class="recent-toast-item" onclick="showTransactionDetail('${tx.id}')">
                    <span class="toast-time">${timeText}</span>
                    <span class="toast-info">${shortInfo} (${totalItems} món) ${methodIcon}</span>
                    <span class="toast-amount">${formatMoney(tx.amount)}</span>
                </div>
            `;
        }
        container.innerHTML = html;
    });
}

// ========== CẬP NHẬT BÀN THÔNG MINH ==========
function updateTablesDiff(newTables) {
    var activeTables = newTables.filter(function(t) { return (t.items && t.items.length) || t.total > 0; });
    var grid = document.getElementById('tablesGrid');
    if (!grid) return;
    
    var existingCards = document.querySelectorAll('.table-card');
    var existingIds = {};
    for (var i = 0; i < existingCards.length; i++) {
        existingIds[existingCards[i].getAttribute('data-id')] = existingCards[i];
    }
    
    var newIds = {};
    for (var i = 0; i < activeTables.length; i++) {
        newIds[activeTables[i].id] = activeTables[i];
    }
    
    // Xóa bàn không còn
    for (var id in existingIds) {
        if (!newIds[id]) {
            existingIds[id].remove();
        }
    }
    
    // Thêm hoặc cập nhật bàn
    for (var i = 0; i < activeTables.length; i++) {
        var table = activeTables[i];
        var existingCard = existingIds[table.id];
        if (existingCard) {
            updateTableCard(existingCard, table);
        } else {
            grid.appendChild(createTableCard(table));
        }
    }
}

function updateTableCard(card, table) {
    var itemCount = 0;
    if (table.items) {
        for (var j = 0; j < table.items.length; j++) {
            itemCount += table.items[j].qty;
        }
    }
    
    var timeDisplay = '--:--';
    if (table.startTime) {
        var start = new Date(table.startTime);
        var diffMins = Math.floor((Date.now() - start) / 60000);
        var hours = Math.floor(diffMins / 60);
        var mins = diffMins % 60;
        timeDisplay = start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + (hours ? hours + 'h' + mins + 'p' : mins + 'p');
    }
    
    var displayName = table.customerName ? escapeHtml(table.customerName) : escapeHtml(table.name);
    
    var nameSpan = card.querySelector('.table-name');
    if (nameSpan) nameSpan.innerHTML = displayName;
    
    var timeSpan = card.querySelector('.table-time');
    if (timeSpan) timeSpan.innerHTML = '⏱️ ' + timeDisplay;
    
    var itemCountSpan = card.querySelector('.table-item-count');
    if (itemCountSpan) itemCountSpan.innerHTML = '📦 ' + itemCount + ' món';
    
    var totalSpan = card.querySelector('.table-total');
    if (totalSpan) totalSpan.innerHTML = formatMoney(table.total);
}

function createTableCard(table) {
    var itemCount = 0;
    if (table.items) {
        for (var j = 0; j < table.items.length; j++) {
            itemCount += table.items[j].qty;
        }
    }
    
    var timeDisplay = '--:--';
    if (table.startTime) {
        var start = new Date(table.startTime);
        var diffMins = Math.floor((Date.now() - start) / 60000);
        var hours = Math.floor(diffMins / 60);
        var mins = diffMins % 60;
        timeDisplay = start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + (hours ? hours + 'h' + mins + 'p' : mins + 'p');
    }
    
    var displayName = table.customerName ? escapeHtml(table.customerName) : escapeHtml(table.name);
    
    var div = document.createElement('div');
    div.className = 'table-card';
    div.setAttribute('data-id', table.id);
    div.onclick = function(id) { return function() { showTableDetail(id); }; }(table.id);
    div.innerHTML = 
        '<div class="table-header">' +
            '<span class="table-name" onclick="event.stopPropagation(); showCustomerSelectorForTable(\'' + table.id + '\')" style="cursor:pointer;">' + displayName + '</span>' +
            '<span class="table-time">⏱️ ' + timeDisplay + '</span>' +
        '</div>' +
        '<div class="table-stats">' +
            '<span class="table-item-count">📦 ' + itemCount + ' món</span>' +
            '<span class="table-total">' + formatMoney(table.total) + '</span>' +
        '</div>' +
        // Phần div.actions bên trong createTableCard
'<div class="table-actions">' +
    '<div class="table-action" onclick="event.stopPropagation(); openAddMenuForTable(\'' + table.id + '\')">➕</div>' +
'</div>';
    return div;
}

function renderTables() {
    var now = Date.now();
    if (cachedTables.length > 0 && (now - tablesCacheTime) < CACHE_TTL) {
        updateTablesDiff(cachedTables);
        return Promise.resolve();
    }
    return DB.getAll('tables').then(function(tables) {
        cachedTables = tables;
        tablesCacheTime = now;
        updateTablesDiff(tables);
    });
}

function initEventListeners() {
    // Chuyển tab
    var tabs = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].onclick = (function(tab) {
            return function() { switchTab(tab.getAttribute('data-tab')); };
        })(tabs[i]);
    }

    // Các nút chính
    var createOrderBtn = document.getElementById('createOrderBtn');
    if (createOrderBtn) createOrderBtn.onclick = openCreateOrderModal;

    var costBtn = document.getElementById('costBtn');
    if (costBtn) costBtn.onclick = openCostModal;

    var prevDayBtn = document.getElementById('prevDayBtn');
    if (prevDayBtn) prevDayBtn.onclick = function() { changeHistoryDate(-1); };

    var nextDayBtn = document.getElementById('nextDayBtn');
    if (nextDayBtn) nextDayBtn.onclick = function() { changeHistoryDate(1); };

    var historyFilter = document.getElementById('historyFilter');
    if (historyFilter) historyFilter.onchange = function() { renderHistoryByDate(currentHistoryDate); };

    var reportPrevDayBtn = document.getElementById('reportPrevDayBtn');
    if (reportPrevDayBtn) reportPrevDayBtn.onclick = function() { changeReportDate(-1); };

    var reportNextDayBtn = document.getElementById('reportNextDayBtn');
    if (reportNextDayBtn) reportNextDayBtn.onclick = function() { changeReportDate(1); };

    var quickAddCustomerBtn = document.getElementById('quickAddCustomerBtn');
    if (quickAddCustomerBtn) quickAddCustomerBtn.onclick = quickAddCustomer;

    var saveCostBtn = document.getElementById('saveCostBtn');
    if (saveCostBtn) saveCostBtn.onclick = saveExpense;

    var createCustomerBtn = document.getElementById('createCustomerFromSelectorBtn');
    if (createCustomerBtn) createCustomerBtn.onclick = createCustomerFromInput;

    var confirmDebtBtn = document.getElementById('confirmDebtPaymentBtn');
    if (confirmDebtBtn) confirmDebtBtn.onclick = confirmDebtPayment;

    var paymentCash = document.getElementById('paymentCashBtn');
    if (paymentCash) paymentCash.onclick = function() {
        if (pendingPaymentTableId) paymentAtTable(pendingPaymentTableId, 'cash');
        closeModal('paymentMethodModal');
    };

    var paymentTransfer = document.getElementById('paymentTransferBtn');
    if (paymentTransfer) paymentTransfer.onclick = function() {
        if (pendingPaymentTableId) paymentAtTable(pendingPaymentTableId, 'transfer');
        closeModal('paymentMethodModal');
    };

    var paymentDebt = document.getElementById('paymentDebtBtn');
    if (paymentDebt) paymentDebt.onclick = function() {
        if (pendingPaymentTableId) {
            closeModal('paymentMethodModal');
            debtAtTable(pendingPaymentTableId);
        }
    };

    // Modal chia hóa đơn, chuyển món, xóa bàn
    var confirmSplit = document.getElementById('confirmSplitBtn');
    if (confirmSplit) confirmSplit.onclick = confirmSplitPayment;

    var confirmTransfer = document.getElementById('confirmTransferBtn');
    if (confirmTransfer) confirmTransfer.onclick = confirmTransferItems;

    var confirmDelete = document.getElementById('confirmDeleteTableBtn');
    if (confirmDelete) confirmDelete.onclick = confirmDeleteTable;

    // Gắn sự kiện cho các nút số tiền nhanh trong modal chi phí
    var quickMoneyBtns = document.querySelectorAll('.quick-money-btn');
    for (var i = 0; i < quickMoneyBtns.length; i++) {
        quickMoneyBtns[i].onclick = function(e) {
            e.stopPropagation();
            var amount = this.getAttribute('data-amount');
            if (amount) {
                var costAmountInput = document.getElementById('costAmount');
                if (costAmountInput) costAmountInput.value = amount;
            }
        };
    }
}

function switchTab(tabId) {
    currentTab = tabId;
    var tabs = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].getAttribute('data-tab') === tabId) tabs[i].classList.add('active');
        else tabs[i].classList.remove('active');
    }
    var contents = document.querySelectorAll('.tab-content');
    for (var i = 0; i < contents.length; i++) {
        if (contents[i].id === tabId + 'View') contents[i].classList.add('active');
        else contents[i].classList.remove('active');
    }
    
    if (tabId === 'manager' && typeof managerApplyFilter === 'function') {
    // Đảm bảo manager đã init
    if (!managerInitialized && typeof initManager === 'function') {
        initManager();
    } else {
        // Đã init rồi thì reload data + render ngay
        loadAllData().then(function() {
            managerApplyFilter();
        });
    }
}
}

// ========== NGUYÊN LIỆU ==========
function checkStock(items) {
    return new Promise(function(resolve) {
        for (var i = 0; i < items.length; i++) {
            var orderItem = items[i];
            var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
            var menuItem = null;
            for (var j = 0; j < menuItems.length; j++) {
                if (menuItems[j].name === baseName || menuItems[j].id === orderItem.id) { menuItem = menuItems[j]; break; }
            }
            if (menuItem && menuItem.ingredients) {
                for (var k = 0; k < menuItem.ingredients.length; k++) {
                    var req = menuItem.ingredients[k];
                    for (var l = 0; l < ingredients.length; l++) {
                        if (ingredients[l].id === req.ingredientId) {
                            if (ingredients[l].stock < (req.quantity * orderItem.qty)) {
                                showToast('⚠️ Nguyên liệu "' + ingredients[l].name + '" không đủ cho món ' + baseName, 'error');
                                resolve(false);
                                return;
                            }
                            break;
                        }
                    }
                }
            }
        }
        resolve(true);
    });
}

function deductIngredients(items) {
    var updates = [];
    for (var i = 0; i < items.length; i++) {
        var orderItem = items[i];
        var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
        var menuItem = null;
        for (var j = 0; j < menuItems.length; j++) {
            if (menuItems[j].name === baseName || menuItems[j].id === orderItem.id) { menuItem = menuItems[j]; break; }
        }
        if (menuItem && menuItem.ingredients) {
            for (var k = 0; k < menuItem.ingredients.length; k++) {
                var req = menuItem.ingredients[k];
                for (var l = 0; l < ingredients.length; l++) {
                    if (ingredients[l].id === req.ingredientId) {
                        ingredients[l].stock -= req.quantity * orderItem.qty;
                        if (ingredients[l].stock < 0) ingredients[l].stock = 0;
                        updates.push(DB.update('ingredients', ingredients[l].id, { stock: ingredients[l].stock }));
                        break;
                    }
                }
            }
        }
    }
    return Promise.all(updates);
}

function restoreIngredients(items) {
    var updates = [];
    for (var i = 0; i < items.length; i++) {
        var orderItem = items[i];
        var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
        var menuItem = null;
        for (var j = 0; j < menuItems.length; j++) {
            if (menuItems[j].name === baseName || menuItems[j].id === orderItem.id) { menuItem = menuItems[j]; break; }
        }
        if (menuItem && menuItem.ingredients) {
            for (var k = 0; k < menuItem.ingredients.length; k++) {
                var req = menuItem.ingredients[k];
                for (var l = 0; l < ingredients.length; l++) {
                    if (ingredients[l].id === req.ingredientId) {
                        ingredients[l].stock += req.quantity * orderItem.qty;
                        updates.push(DB.update('ingredients', ingredients[l].id, { stock: ingredients[l].stock }));
                        break;
                    }
                }
            }
        }
    }
    return Promise.all(updates);
}

// ========== LỊCH SỬ ==========
function addHistory(transaction) {
    var newTrans = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        dateKey: new Date().toISOString().slice(0, 10),
        type: transaction.type,
        amount: transaction.amount,
        paymentMethod: transaction.paymentMethod,
        items: transaction.items || [],
        customer: transaction.customer || null,
        tableName: transaction.tableName || null,
        note: transaction.note || '',
        refunded: false
    };
    return DB.create('transactions', newTrans).then(function() {
        // KHÔNG gọi render trực tiếp nữa, để realtime subscription tự cập nhật
    });
}

// ========== MODAL OBSERVER & OVERRIDE ==========
// Ghi đè hàm closeModal để bỏ chặn cuộn
var originalCloseModal = window.closeModal;
window.closeModal = function(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
        // Thêm class closing để chạy animation trượt xuống
        modal.classList.add('closing');
        setTimeout(function() {
            modal.style.display = 'none';
            modal.classList.remove('closing');
        }, 200);
    }
    document.body.classList.remove('modal-open');
    if (originalCloseModal) originalCloseModal(modalId);
};

// Hàm mở modal mới (chặn cuộn body)
function openBottomSheet(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

// Tự động thêm class modal-open khi bất kỳ modal nào hiển thị
var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            var modal = mutation.target;
            if (modal.style.display === 'flex') {
                document.body.classList.add('modal-open');
            }
        }
    });
});
document.querySelectorAll('.modal').forEach(function(modal) {
    observer.observe(modal, { attributes: true });
});
// Đóng modal khi click ra ngoài vùng .modal-content
document.querySelectorAll('.modal').forEach(function(modal) {
    modal.addEventListener('click', function(e) {
        // Nếu click chính vào backdrop (phần tử .modal) thì đóng
        if (e.target === modal) {
            closeModal(modal.id);
        }
    });
});

// ========== PREVIEW & SUBMIT CASH ==========
// Preview realtime khi nhập số tiền mặt thực nhận
var actualCashInput = document.getElementById('actualCashInput');
if (actualCashInput) {
    actualCashInput.addEventListener('input', function(e) {
        var val = parseInt(e.target.value) || 0;
        previewCashKept(val);
    });
} else {
    console.warn('Không tìm thấy input #actualCashInput, preview realtime bị vô hiệu');
}

function previewCashKept(enteredActualCash) {
    var dateStr = currentReportDate.toISOString().slice(0, 10);
    Promise.all([
        DB.getTransactionsByDate(dateStr),
        DB.get('daily_balances', dateStr)
    ]).then(function(results) {
        var transactions = results[0].filter(function(t) { return !t.refunded; });
        var dailyBalance = results[1] || { cashKept: 0 };
        var cashTotal = 0;
        for (var i = 0; i < transactions.length; i++) {
            if (transactions[i].paymentMethod === 'cash') cashTotal += transactions[i].amount;
        }
        var prevDate = new Date(currentReportDate);
        prevDate.setDate(prevDate.getDate() - 1);
        var prevDateStr = prevDate.toISOString().slice(0, 10);
        DB.get('daily_balances', prevDateStr).then(function(prevBalance) {
            var cashKeptPrev = (prevBalance && prevBalance.cashKept) || 0;
            var cashKeptPreview = cashTotal + cashKeptPrev - enteredActualCash;
            if (cashKeptPreview < 0) cashKeptPreview = 0;
            var lastStatCard = document.querySelector('#reportStats .stat-card:last-child');
            if (lastStatCard) {
                var targetRow = lastStatCard.querySelector('.stat-row:last-child');
                if (targetRow) {
                    var valueSpan = targetRow.querySelector('span:last-child');
                    if (valueSpan) {
                        valueSpan.innerHTML = formatMoney(cashKeptPreview);
                        valueSpan.style.color = '#f97316';
                        valueSpan.style.fontWeight = 'bold';
                        var noteSpan = targetRow.querySelector('.preview-note');
                        if (!noteSpan) {
                            noteSpan = document.createElement('small');
                            noteSpan.className = 'preview-note';
                            noteSpan.style.marginLeft = '8px';
                            noteSpan.style.fontSize = '10px';
                            noteSpan.style.color = '#f97316';
                            noteSpan.innerText = '(chưa lưu)';
                            targetRow.appendChild(noteSpan);
                        } else {
                            noteSpan.style.display = 'inline';
                        }
                    }
                }
            }
        });
    });
}

// Nút gửi báo cáo: nhập tiền mặt thực nhận -> lưu và tự tính số dư cuối ngày
var submitActualCashBtn = document.getElementById('submitActualCashBtn');
if (submitActualCashBtn) {
    submitActualCashBtn.onclick = function() {
        var actualCashReceived = parseInt(document.getElementById('actualCashInput').value) || 0;
        if (actualCashReceived <= 0) {
            showToast('Vui lòng nhập số tiền mặt thực nhận lớn hơn 0!', 'warning');
            return;
        }
        
        var dateStr = currentReportDate.toISOString().slice(0, 10);
        
        Promise.all([
            DB.getTransactionsByDate(dateStr),
            DB.get('daily_balances', dateStr)
        ]).then(function(results) {
            var transactions = results[0].filter(function(t) { return !t.refunded; });
            var dailyBalance = results[1] || { cashKept: 0 };
            
            var cashTotal = 0;
            for (var i = 0; i < transactions.length; i++) {
                if (transactions[i].paymentMethod === 'cash') cashTotal += transactions[i].amount;
            }
            
            var prevDate = new Date(currentReportDate);
            prevDate.setDate(prevDate.getDate() - 1);
            var prevDateStr = prevDate.toISOString().slice(0, 10);
            
            DB.get('daily_balances', prevDateStr).then(function(prevBalance) {
                var cashKeptPrev = (prevBalance && prevBalance.cashKept) || 0;
                var cashKeptToday = cashTotal + cashKeptPrev - actualCashReceived;
                if (cashKeptToday < 0) cashKeptToday = 0;
                
                var data = {
                    id: dateStr,
                    cashKept: cashKeptToday,
                    cashReceived: actualCashReceived
                };
                DB.create('daily_balances', data, dateStr).then(function() {
                    showToast('Đã lưu báo cáo: tiền mặt thực nhận = ' + formatMoney(actualCashReceived), 'success');
                    // Xóa dấu hiệu preview
                    var noteSpan = document.querySelector('#reportStats .stat-card:last-child .preview-note');
                    if (noteSpan) noteSpan.style.display = 'none';
                    var valueSpan = document.querySelector('#reportStats .stat-card:last-child .stat-row:last-child span:last-child');
                    if (valueSpan) {
                        valueSpan.style.color = '';
                        valueSpan.style.fontWeight = '';
                        valueSpan.innerHTML = formatMoney(cashKeptToday);
                    }
                    renderReport(currentReportDate);
                });
            });
        });
    };
}

// ========== WINDOW EXPORTS ==========
window.showTableDetail = showTableDetail;
window.showPaymentForTable = showPaymentForTable;
window.showCustomerSelectorForTable = showCustomerSelectorForTable;
window.openAddMenuForTable = openAddMenuForTable;
window.addToCart = addToCart;
window.addToCartWithVariant = addToCartWithVariant;
window.removeFromCart = removeFromCart;
window.updateCartQty = updateCartQty;
window.renderMenuByCategory = renderMenuByCategory;
window.closeModal = closeModal;
window.refundTransaction = refundTransaction;
window.showCustomerDetail = showCustomerDetail;
window.openDebtPayment = openDebtPayment;
window.confirmDebtPayment = confirmDebtPayment;
window.selectCustomer = selectCustomer;
window.setCostName = setCostName;
window.quickAddCustomer = quickAddCustomer;
window.handleAddToExistingTable = handleAddToExistingTable;
window.handleCreateNewTable = handleCreateNewTable;
window.handleTakeawayPayment = handleTakeawayPayment;
window.handleGrabOrder = handleGrabOrder;
window.handleDebtOrder = handleDebtOrder;
window.showSplitBillModal = showSplitBillModal;
window.showTransferItemsModal = showTransferItemsModal;
window.showMergeTableModal = showMergeTableModal;
window.showDeleteTableConfirm = showDeleteTableConfirm;
window.confirmSplitPayment = confirmSplitPayment;
window.confirmTransferItems = confirmTransferItems;
window.confirmDeleteTable = confirmDeleteTable;
