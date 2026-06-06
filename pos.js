// POS.JS - TỐI ƯU REALTIME, CHỈ CẬP NHẬT BÀN THAY ĐỔI, ĐÃ SỬA LỖI CHI TIẾT BÀN
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
function renderRecentTransactions() {
    var todayStr = new Date().toISOString().slice(0, 10);
    DB.getTransactionsByDate(todayStr).then(function(transactions) {
        var validTx = transactions.filter(function(tx) { return !tx.refunded; });
        validTx.sort(function(a, b) {
            return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
        });
        var recent = validTx.slice(0, 3);
        var container = document.getElementById('recentList');
        if (!container) return;
        
        if (recent.length === 0) {
            container.innerHTML = '<div class="empty-text" style="padding: 8px;">Chưa có giao dịch hôm nay</div>';
            return;
        }
        
        var html = '';
        for (var i = 0; i < recent.length; i++) {
            var tx = recent[i];
            var timeDiff = Math.floor((Date.now() - new Date(tx.createdAt || tx.date)) / 60000);
            var timeText = '';
            if (timeDiff < 1) timeText = 'Vừa xong';
            else if (timeDiff < 60) timeText = timeDiff + ' phút trước';
            else timeText = Math.floor(timeDiff / 60) + ' giờ trước';
            
            var totalItems = 0;
            if (tx.items && tx.items.length) {
                for (var j = 0; j < tx.items.length; j++) totalItems += tx.items[j].qty;
            }
            
            var locationInfo = '';
            if (tx.tableName) locationInfo = '🍽️ ' + tx.tableName;
            else if (tx.type === 'takeaway') locationInfo = '🛵 Mang đi';
            else if (tx.type === 'grab') locationInfo = '🚕 Grab';
            else locationInfo = '🍽️ Tại chỗ';
            
            html += `
                <div class="recent-item" onclick="showTransactionDetail('${tx.id}')">
                    <span class="recent-time">${timeText}</span>
                    <span class="recent-info">${locationInfo} - ${totalItems} món</span>
                    <span class="recent-amount">${formatMoney(tx.amount)}</span>
                </div>
            `;
        }
        container.innerHTML = html;
    });
}
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

function formatMoney(amount) { return (amount || 0).toLocaleString('vi-VN') + 'đ'; }
function showToast(message, type) { var toast = document.createElement('div'); toast.className = 'toast ' + type; toast.innerText = message; document.getElementById('toastContainer').appendChild(toast); setTimeout(function() { toast.remove(); }, 2500); }
function closeModal(modalId) { var m = document.getElementById(modalId); if (m) m.style.display = 'none'; }
function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, function(m) { if (m === '&') return '&amp;'; if (m === '<') return '&lt;'; if (m === '>') return '&gt;'; return m; }); }
function formatDateDisplay(dateStr) { var d = new Date(dateStr); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }
function renderCurrentTime() { var now = new Date(); var timeEl = document.getElementById('currentTime'); if (timeEl) timeEl.innerText = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }

// ========== CHI TIẾT BÀN ==========
function showTableDetail(tableId) {
    currentTableDetailId = tableId;
    DB.get('tables', String(tableId)).then(function(table) {
        if (!table) return;
        var tableName = escapeHtml(table.name);
        var customerName = table.customerName ? ' (' + escapeHtml(table.customerName) + ')' : '';
        document.getElementById('detailTableName').innerHTML = '🪑 ' + tableName + customerName;

        var itemsHtml = '', totalAmount = 0;
        if (table.items && table.items.length) {
            for (var i = 0; i < table.items.length; i++) {
                var item = table.items[i];
                totalAmount += item.price * item.qty;
                var timeStr = '';
                if (item.addedTime) {
                    var d = new Date(item.addedTime);
                    timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                }
                // Hiển thị tên món, số lượng, giờ (nếu có) và giá
                itemsHtml += '<div class="cart-item">' +
                    '<span>' + escapeHtml(item.name) + ' x' + item.qty + (timeStr ? ' 🕒 ' + timeStr : '') + '</span>' +
                    '<span>' + formatMoney(item.price * item.qty) + '</span>' +
                '</div>';
            }
        } else {
            itemsHtml = '<div class="empty-state">✨ Chưa có món</div>';
        }
        document.getElementById('detailItems').innerHTML = itemsHtml;
        document.getElementById('detailSummary').innerHTML = '<div class="cart-total">Tổng: ' + formatMoney(totalAmount) + '</div>';

        // Hàng 1: các nút chỉnh sửa bàn (Thêm món, Chia hóa đơn, Chuyển món, Gộp bàn, Xóa bàn)
        var editButtonsHtml = 
            '<div class="cart-actions edit-actions">' +
                '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="openAddMenuForTable(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">➕ Thêm món</button>' +
                '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="showSplitBillModal(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">🧾 Chia hóa đơn</button>' +
                '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="showTransferItemsModal(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">🔄 Chuyển món</button>' +
                '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="showMergeTableModal(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">🔗 Gộp bàn</button>' +
                '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="showDeleteTableConfirm(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">🗑️ Xóa bàn</button>' +
            '</div>';

        // Hàng 2: 3 nút thanh toán trực tiếp (Tiền mặt, Chuyển khoản, Ghi nợ)
        var paymentButtonsHtml = 
            '<div class="cart-actions payment-actions">' +
                '<button class="cart-action-btn cash" onclick="paymentAtTable(\'' + table.id + '\', \'cash\'); closeModal(\'tableDetailModal\')">💰 Tiền mặt</button>' +
                '<button class="cart-action-btn transfer" onclick="paymentAtTable(\'' + table.id + '\', \'transfer\'); closeModal(\'tableDetailModal\')">💳 Chuyển khoản</button>' +
                '<button class="cart-action-btn debt" onclick="debtAtTable(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">💢 Ghi nợ</button>' +
            '</div>';

        document.getElementById('detailActions').innerHTML = editButtonsHtml + paymentButtonsHtml;
        document.getElementById('tableDetailModal').style.display = 'flex';
    });
}

function showPaymentForTable(tableId) { pendingPaymentTableId = tableId; document.getElementById('paymentMethodModal').style.display = 'flex'; }

function paymentAtTable(tableId, method) {
    DB.get('tables', String(tableId)).then(function(table) {
        if (!table || !table.items || !table.items.length) return;
        checkStock(table.items).then(function(ok) {
            if (!ok) return;
            deductIngredients(table.items).then(function() {
                addHistory({ type: 'dinein', amount: table.total, paymentMethod: method, items: table.items, customer: table.customerName ? { name: table.customerName } : null, tableName: table.name, note: '' }).then(function() {
                    DB.remove('tables', String(tableId)).then(function() {
                        renderTables();
                        if (currentTableDetailId === tableId) closeModal('tableDetailModal');
                        showToast('✅ Thanh toán ' + formatMoney(table.total) + ' thành công', 'success');
                    });
                });
            });
        });
    });
}

function debtAtTable(tableId) {
    DB.get('tables', String(tableId)).then(function(table) {
        if (!table || !table.items || !table.items.length) return;
        showCustomerSelector(function(customer) {
            checkStock(table.items).then(function(ok) {
                if (!ok) return;
                deductIngredients(table.items).then(function() {
                    addCustomerDebt(customer.id, table.total, 'Mua tai ' + table.name).then(function() {
                        addHistory({ type: 'debt_payment', amount: table.total, paymentMethod: 'debt', items: table.items, customer: { id: customer.id, name: customer.name }, tableName: table.name, note: '' }).then(function() {
                            DB.remove('tables', String(tableId)).then(function() {
                                renderTables();
                                if (currentTableDetailId === tableId) closeModal('tableDetailModal');
                                showToast('💰 Đã ghi nợ ' + formatMoney(table.total) + ' cho ' + customer.name, 'success');
                            });
                        });
                    });
                });
            });
        });
    });
}

function showCustomerSelectorForTable(tableId) {
    showCustomerSelector(function(customer) {
        DB.update('tables', String(tableId), { customerId: customer.id, customerName: customer.name }).then(function() {
            renderTables();
            if (currentTableDetailId === tableId) showTableDetail(tableId);
            showToast('✅ Đã gán khách ' + customer.name + ' cho bàn', 'success');
        });
    });
}

// ========== THÊM MÓN & TẠO ĐƠN ==========
function openAddMenuForTable(tableId) {
    currentAddToTableId = tableId;
    tempOrder = [];
    selectedCustomer = null;
    var titleEl = document.getElementById('orderModalTitle');
    if (titleEl) titleEl.innerHTML = '➕ Thêm món vào bàn';
    renderOrderCategories();
    renderMenuByCategory('all');
    renderCart();
    document.getElementById('orderModal').style.display = 'flex';
}

function openCreateOrderModal() {
    currentAddToTableId = null;
    tempOrder = [];
    selectedCustomer = null;
    var titleEl = document.getElementById('orderModalTitle');
    if (titleEl) titleEl.innerHTML = '🛒 Tạo đơn hàng';
    renderOrderCategories();
    renderMenuByCategory('all');
    renderCart();
    document.getElementById('orderModal').style.display = 'flex';
}

function renderOrderCategories() {
    var container = document.getElementById('orderCategories');
    if (!container) return;
    var html = '<div class="category-chip active" data-cat="all" onclick="renderMenuByCategory(\'all\')">📋 Tất cả</div>';
    for (var i = 0; i < menuCategories.length; i++) {
        var cat = menuCategories[i];
        html += '<div class="category-chip" data-cat="' + cat.id + '" onclick="renderMenuByCategory(\'' + cat.id + '\')">' + (cat.icon || '📌') + ' ' + escapeHtml(cat.name) + '</div>';
    }
    container.innerHTML = html;
}

function renderMenuByCategory(categoryId) {
    currentMenuCategory = categoryId;
    var items = categoryId !== 'all' ? menuItems.filter(function(i) { return i.categoryId == categoryId; }) : menuItems.slice();
    var container = document.getElementById('menuGrid');
    if (!container) return;
    if (items.length === 0) { container.innerHTML = '<div class="empty-state">📭 Không có món</div>'; return; }
    var html = '';
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.hasVariants && item.variants && item.variants.length) {
            var variantsHtml = '';
            for (var v = 0; v < item.variants.length; v++) {
                var variant = item.variants[v];
                variantsHtml += '<button class="variant-btn" onclick="addToCartWithVariant(\'' + item.id + '\', \'' + escapeHtml(variant.name) + '\', ' + variant.price + ')">' + escapeHtml(variant.name) + '</button>';
            }
            html += '<div class="menu-item-variant"><div class="menu-item-name">' + escapeHtml(item.name) + '</div><div class="variant-group">' + variantsHtml + '</div></div>';
        } else {
            var price = item.price || 0;
            html += '<div class="menu-item" onclick="addToCart(\'' + item.id + '\', \'' + escapeHtml(item.name) + '\', ' + price + ')"><div class="menu-item-name">' + escapeHtml(item.name) + '</div><div class="menu-item-price">' + formatMoney(price) + '</div></div>';
        }
    }
    container.innerHTML = html;
    var chips = document.querySelectorAll('#orderCategories .category-chip');
    for (var i = 0; i < chips.length; i++) {
        var cat = chips[i].getAttribute('data-cat');
        if ((categoryId === 'all' && cat === 'all') || cat == categoryId) chips[i].classList.add('active');
        else chips[i].classList.remove('active');
    }
}

function addToCart(id, name, price) {
    tempOrder.push({
        id: id,
        name: name,
        price: price,
        qty: 1,
        addedTime: new Date().toISOString()
    });
    renderCart();
}

function addToCartWithVariant(itemId, variantName, price) {
    var item = null;
    for (var i = 0; i < menuItems.length; i++) {
        if (menuItems[i].id === itemId) { item = menuItems[i]; break; }
    }
    if (!item) return;
    var displayName = item.name + ' (' + variantName + ')';
    tempOrder.push({
        id: itemId + '_' + variantName,
        name: displayName,
        price: price,
        qty: 1,
        addedTime: new Date().toISOString()
    });
    renderCart();
}

function removeFromCart(idx) { tempOrder.splice(idx, 1); renderCart(); }
function updateCartQty(idx, delta) {
    if (tempOrder[idx]) {
        var newQty = tempOrder[idx].qty + delta;
        if (newQty <= 0) {
            tempOrder.splice(idx, 1);
        } else {
            tempOrder[idx].qty = newQty;
        }
        renderCart();
    }
}function renderCart() {
    var container = document.getElementById('cartItems');
    var totalSpan = document.getElementById('cartTotal');
    var actionsDiv = document.getElementById('cartActions');
    if (!container) return;
    if (tempOrder.length === 0) {
        container.innerHTML = '<div class="empty-state">🛒 Chưa có món</div>';
        totalSpan.innerText = 'Tổng: 0đ';
        if (actionsDiv) actionsDiv.innerHTML = '';
        return;
    }
    var total = 0;
    var html = '';
    for (var i = 0; i < tempOrder.length; i++) {
        var item = tempOrder[i];
        var itemTotal = item.price * item.qty;
        total += itemTotal;
        var timeStr = '';
        if (item.addedTime) {
            var date = new Date(item.addedTime);
            timeStr = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        }
        html += '<div class="cart-item" data-idx="' + i + '">' +
            '<div class="cart-item-info">' +
                '<span class="cart-item-name">' + escapeHtml(item.name) + '</span>' +
                (timeStr ? '<span class="cart-item-time">🕒 ' + timeStr + '</span>' : '') +
                '<div class="cart-item-qty-control">' +
                    '<button onclick="updateCartQty(' + i + ', -1)">-</button>' +
                    '<span>' + item.qty + '</span>' +
                    '<button onclick="updateCartQty(' + i + ', 1)">+</button>' +
                '</div>' +
            '</div>' +
            '<div class="cart-item-price">' + formatMoney(itemTotal) + '</div>' +
            '<button class="cart-item-remove" onclick="removeFromCart(' + i + ')">✖</button>' +
        '</div>';
    }
    container.innerHTML = html;
    totalSpan.innerText = 'Tổng: ' + formatMoney(total);
    // Giữ nguyên phần actions (tạo bàn mới, thanh toán...)
    var createBtnContainer = document.getElementById('cartCreateBtn');
    if (currentAddToTableId) {
        if (createBtnContainer) createBtnContainer.innerHTML = '';
        actionsDiv.innerHTML = '<button class="cart-action-btn table" onclick="handleAddToExistingTable()">🍽️ Thêm vào bàn</button>';
    } else {
        if (createBtnContainer) {
            createBtnContainer.innerHTML = '<button class="cart-action-btn table" onclick="handleCreateNewTable()">🍽️ Tạo bàn mới</button>';
        }
        actionsDiv.innerHTML = 
            '<button class="cart-action-btn cash" onclick="handleTakeawayPayment(\'cash\')">💰 TM mặt</button>' +
            '<button class="cart-action-btn transfer" onclick="handleTakeawayPayment(\'transfer\')">💳 CK khoản</button>' +
            '<button class="cart-action-btn grab" onclick="handleGrabOrder()">🚕 Grab</button>' +
            '<button class="cart-action-btn debt" onclick="handleDebtOrder()">💢 Ghi nợ</button>';
    }
}

function handleAddToExistingTable() {
    if (!currentAddToTableId) { showToast('Lỗi: không xác định bàn', 'error'); return; }
    if (tempOrder.length === 0) { showToast('Chưa chọn món!', 'warning'); return; }
    checkStock(tempOrder).then(function(ok) {
        if (!ok) return;
        deductIngredients(tempOrder).then(function() {
            DB.get('tables', String(currentAddToTableId)).then(function(table) {
                if (!table) return;
                var existingItems = table.items || [];
                for (var i = 0; i < tempOrder.length; i++) {
                    var newItem = tempOrder[i];
                    existingItems.push({
                        id: newItem.id,
                        name: newItem.name,
                        price: newItem.price,
                        qty: newItem.qty,
                        addedTime: newItem.addedTime || new Date().toISOString()
                    });
                }
                var newTotal = 0;
                for (var i = 0; i < existingItems.length; i++) {
                    newTotal += existingItems[i].price * existingItems[i].qty;
                }
                DB.update('tables', String(currentAddToTableId), { items: existingItems, total: newTotal }).then(function() {
                    renderTables();
                    if (currentTableDetailId === currentAddToTableId) showTableDetail(currentAddToTableId);
                    showToast('✅ Đã thêm món vào bàn', 'success');
                    closeModal('orderModal');
                    tempOrder = [];
                });
            });
        });
    });
}

function handleCreateNewTable() {
    if (tempOrder.length === 0) { showToast('Chưa chọn món!', 'warning'); return; }
    checkStock(tempOrder).then(function(ok) {
        if (!ok) return;
        DB.getAll('tables').then(function(tables) {
            var maxNum = 0;
            for (var i = 0; i < tables.length; i++) {
                var match = tables[i].name.match(/Ban (\d+)/);
                if (match && parseInt(match[1]) > maxNum) maxNum = parseInt(match[1]);
            }
            var newNumber = maxNum + 1;
            if (newNumber > 99) { showToast('Đã đạt giới hạn 99 bàn!', 'warning'); return; }
            var newId = Date.now().toString();
            var now = new Date();
            var newTable = {
                id: newId, name: 'Ban ' + newNumber, status: 'occupied',
                time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                startTime: now.toISOString(),
                items: tempOrder.map(function(item) {
                    return {
                        id: item.id,
                        name: item.name,
                        price: item.price,
                        qty: item.qty,
                        addedTime: item.addedTime || now.toISOString()
                    };
                }),
                total: tempOrder.reduce(function(s, i) { return s + i.price * i.qty; }, 0),
                customerId: selectedCustomer ? selectedCustomer.id : null,
                customerName: selectedCustomer ? selectedCustomer.name : null
            };
            deductIngredients(tempOrder).then(function() {
                DB.create('tables', newTable, newId).then(function() {
                    showToast('✅ Đã tạo bàn ' + newTable.name, 'success');
                    tempOrder = [];
                    selectedCustomer = null;
                    closeModal('orderModal');
                    renderTables();
                });
            });
        });
    });
}

function handleTakeawayPayment(method) {
    if (tempOrder.length === 0) return;
    var total = tempOrder.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
    checkStock(tempOrder).then(function(ok) {
        if (!ok) return;
        deductIngredients(tempOrder).then(function() {
            addHistory({ type: 'takeaway', amount: total, paymentMethod: method, items: tempOrder.slice(), customer: selectedCustomer, tableName: 'Mang di', note: '' }).then(function() {
                showToast('✅ Thanh toán ' + formatMoney(total) + ' thành công', 'success');
                tempOrder = [];
                selectedCustomer = null;
                closeModal('orderModal');
                if (currentTab === 'history') renderHistoryByDate(currentHistoryDate);
                if (currentTab === 'report') renderReport(currentReportDate);
            });
        });
    });
}

function handleGrabOrder() {
    if (tempOrder.length === 0) return;
    var total = tempOrder.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
    checkStock(tempOrder).then(function(ok) {
        if (!ok) return;
        deductIngredients(tempOrder).then(function() {
            addHistory({ type: 'grab', amount: total, paymentMethod: 'grab', items: tempOrder.slice(), customer: null, tableName: 'Grab', note: '' }).then(function() {
                showToast('✅ Đơn Grab ' + formatMoney(total), 'success');
                tempOrder = [];
                closeModal('orderModal');
                if (currentTab === 'history') renderHistoryByDate(currentHistoryDate);
                if (currentTab === 'report') renderReport(currentReportDate);
            });
        });
    });
}

function handleDebtOrder() {
    if (tempOrder.length === 0) return;
    showCustomerSelector(function(customer) {
        var total = tempOrder.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        checkStock(tempOrder).then(function(ok) {
            if (!ok) return;
            deductIngredients(tempOrder).then(function() {
                addCustomerDebt(customer.id, total, 'Mua hang').then(function() {
                    addHistory({ type: 'debt_payment', amount: total, paymentMethod: 'debt', items: tempOrder.slice(), customer: { id: customer.id, name: customer.name }, note: '' }).then(function() {
                        showToast('💰 Đã ghi nợ ' + formatMoney(total) + ' cho ' + customer.name, 'success');
                        tempOrder = [];
                        selectedCustomer = null;
                        closeModal('orderModal');
                        if (currentTab === 'history') renderHistoryByDate(currentHistoryDate);
                        if (currentTab === 'report') renderReport(currentReportDate);
                    });
                });
            });
        });
    });
}
function confirmSplitPaymentWithMethod(method, customer) {
    var tableId = pendingSplitTableId;
    if (!tableId) return;
    
    DB.get('tables', String(tableId)).then(function(table) {
        if (!table) return;
        
        // Lấy các món đã chọn để thanh toán (giống logic cũ)
        var splitItems = [];
        var remainingItems = [];
        for (var i = 0; i < table.items.length; i++) {
            remainingItems.push({
                name: table.items[i].name,
                price: table.items[i].price,
                qty: table.items[i].qty
            });
        }
        
        var rows = document.querySelectorAll('.split-item-row');
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var idx = parseInt(row.getAttribute('data-idx'));
            var input = document.getElementById('split-qty-' + idx);
            var qty = input ? parseInt(input.value) : 0;
            if (qty > 0) {
                var item = remainingItems[idx];
                if (qty > item.qty) qty = item.qty;
                splitItems.push({
                    name: item.name,
                    price: item.price,
                    qty: qty
                });
                item.qty -= qty;
            }
        }
        
        if (splitItems.length === 0) {
            showToast('Chưa chọn món để thanh toán!', 'warning');
            return;
        }
        
        var splitTotal = splitItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        var finalItems = remainingItems.filter(function(i) { return i.qty > 0; });
        var newTotal = finalItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        
        // Trừ nguyên liệu (kiểm tra stock trước)
        checkStock(splitItems).then(function(ok) {
            if (!ok) return;
            deductIngredients(splitItems).then(function() {
                // Nếu là ghi nợ, cần có customer
                if (method === 'debt' && !customer) {
                    showToast('Cần chọn khách hàng để ghi nợ!', 'warning');
                    return;
                }
                
                // Cập nhật bàn: giảm số lượng món đã thanh toán
                DB.update('tables', String(tableId), { items: finalItems, total: newTotal }).then(function() {
                    // Lưu lịch sử giao dịch
                    var historyPromise;
                    if (method === 'debt') {
                        // Ghi nợ: cộng nợ cho khách
                        addCustomerDebt(customer.id, splitTotal, 'Chia hóa đơn tại bàn ' + table.name).then(function() {
                            historyPromise = addHistory({
                                type: 'debt_payment',
                                amount: splitTotal,
                                paymentMethod: 'debt',
                                items: splitItems,
                                customer: { id: customer.id, name: customer.name },
                                tableName: table.name,
                                note: 'Chia hóa đơn'
                            });
                        });
                    } else {
                        historyPromise = addHistory({
                            type: 'dinein',
                            amount: splitTotal,
                            paymentMethod: method,
                            items: splitItems,
                            customer: null,
                            tableName: table.name,
                            note: 'Chia hóa đơn'
                        });
                    }
                    
                    Promise.resolve(historyPromise).then(function() {
                        renderTables();
                        if (currentTableDetailId === tableId) showTableDetail(tableId);
                        closeModal('splitBillModal');
                        showToast('✅ Đã thanh toán phần chia ' + formatMoney(splitTotal) + (method === 'debt' ? ' (ghi nợ)' : ''), 'success');
                    });
                });
            });
        });
    });
}
// ========== CHIA HÓA ĐƠN ==========
// ========== CHIA HÓA ĐƠN (HIỂN THỊ 3 NÚT THANH TOÁN) ==========
function showSplitBillModal(tableId) {
    pendingSplitTableId = tableId;
    DB.get('tables', String(tableId)).then(function(table) {
        if (!table || !table.items || !table.items.length) {
            showToast('Không có món để chia!', 'warning');
            return;
        }
        var container = document.getElementById('splitItemsList');
        if (!container) return;
        
        // Tạo danh sách các món với ô nhập số lượng
        var html = '';
        for (var i = 0; i < table.items.length; i++) {
            var item = table.items[i];
            html += '<div class="split-item-row" data-idx="' + i + '" data-price="' + item.price + '" data-max="' + item.qty + '">' +
                '<span>' + escapeHtml(item.name) + '</span>' +
                '<div class="split-qty-control">' +
                    '<button class="split-qty-minus" data-idx="' + i + '">-</button>' +
                    '<input type="number" class="split-qty-input" id="split-qty-' + i + '" value="0" min="0" max="' + item.qty + '" step="1">' +
                    '<button class="split-qty-plus" data-idx="' + i + '">+</button>' +
                    '<span>/ ' + item.qty + '</span>' +
                '</div>' +
                '<span id="split-price-' + i + '" class="split-item-price">0đ</span>' +
            '</div>';
        }
        container.innerHTML = html;
        
        // Gắn sự kiện tăng/giảm số lượng
        attachSplitQtyEvents();
        updateSplitTotal();
        
        // *** THAY ĐỔI KHU VỰC NÚT ***
        var formActions = document.querySelector('#splitBillModal .form-actions');
        if (formActions) {
            formActions.innerHTML = `
                <button class="cart-action-btn cash" id="splitCashBtn">💰 Tiền mặt</button>
                <button class="cart-action-btn transfer" id="splitTransferBtn">💳 Chuyển khoản</button>
                <button class="cart-action-btn debt" id="splitDebtBtn">💢 Ghi nợ</button>
                <button class="btn-cancel" onclick="closeModal('splitBillModal')">Hủy</button>
            `;
            
            // Gắn sự kiện cho các nút mới
            document.getElementById('splitCashBtn').onclick = function() {
                confirmSplitPaymentWithMethod('cash', null);
            };
            document.getElementById('splitTransferBtn').onclick = function() {
                confirmSplitPaymentWithMethod('transfer', null);
            };
            document.getElementById('splitDebtBtn').onclick = function() {
                showCustomerSelector(function(customer) {
                    confirmSplitPaymentWithMethod('debt', customer);
                });
            };
        }
        
        document.getElementById('splitBillModal').style.display = 'flex';
    });
}

function attachSplitQtyEvents() {
    var minusBtns = document.querySelectorAll('.split-qty-minus');
    var plusBtns = document.querySelectorAll('.split-qty-plus');
    for (var i = 0; i < minusBtns.length; i++) {
        minusBtns[i].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('split-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value) || 0;
                    if (val > 0) input.value = val - 1;
                    updateSplitTotal();
                }
            };
        })(minusBtns[i]);
    }
    for (var i = 0; i < plusBtns.length; i++) {
        plusBtns[i].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('split-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value) || 0;
                    var max = parseInt(input.getAttribute('max')) || 0;
                    if (val < max) input.value = val + 1;
                    updateSplitTotal();
                }
            };
        })(plusBtns[i]);
    }
}

function updateSplitTotal() {
    var total = 0;
    var rows = document.querySelectorAll('.split-item-row');
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var idx = row.getAttribute('data-idx');
        var price = parseInt(row.getAttribute('data-price'));
        var input = document.getElementById('split-qty-' + idx);
        var qty = input ? parseInt(input.value) : 0;
        var itemTotal = price * qty;
        total += itemTotal;
        var priceSpan = document.getElementById('split-price-' + idx);
        if (priceSpan) priceSpan.innerText = formatMoney(itemTotal);
    }
    var totalSpan = document.getElementById('splitTotalAmount');
    if (totalSpan) totalSpan.innerText = formatMoney(total);
}

function confirmSplitPayment() {
    var tableId = pendingSplitTableId;
    if (!tableId) return;
    DB.get('tables', String(tableId)).then(function(table) {
        if (!table) return;
        var splitItems = [];
        var remainingItems = [];
        for (var i = 0; i < table.items.length; i++) {
            remainingItems.push({ name: table.items[i].name, price: table.items[i].price, qty: table.items[i].qty });
        }
        var rows = document.querySelectorAll('.split-item-row');
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var idx = parseInt(row.getAttribute('data-idx'));
            var input = document.getElementById('split-qty-' + idx);
            var qty = input ? parseInt(input.value) : 0;
            if (qty > 0) {
                var item = remainingItems[idx];
                if (qty > item.qty) qty = item.qty;
                splitItems.push({ name: item.name, price: item.price, qty: qty });
                item.qty -= qty;
            }
        }
        if (splitItems.length === 0) { showToast('Chưa chọn món để thanh toán!', 'warning'); return; }
        var splitTotal = splitItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        var finalItems = remainingItems.filter(function(i) { return i.qty > 0; });
        var newTotal = finalItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        DB.update('tables', String(tableId), { items: finalItems, total: newTotal }).then(function() {
            checkStock(splitItems).then(function(ok) {
                if (!ok) return;
                deductIngredients(splitItems).then(function() {
                    addHistory({ type: 'dinein', amount: splitTotal, paymentMethod: 'cash', items: splitItems, customer: null, tableName: table.name, note: 'Chia hóa đơn' }).then(function() {
                        renderTables();
                        if (currentTableDetailId === tableId) showTableDetail(tableId);
                        closeModal('splitBillModal');
                        showToast('✅ Đã thanh toán phần chia ' + formatMoney(splitTotal), 'success');
                    });
                });
            });
        });
    });
}

// ========== CHUYỂN MÓN ==========
function showTransferItemsModal(sourceId) {
    DB.get('tables', String(sourceId)).then(function(table) {
        if (!table || !table.items || !table.items.length) { showToast('Không có món để chuyển!', 'warning'); return; }
        pendingTransferSourceTable = table;
        var container = document.getElementById('transferItemsList');
        if (!container) return;
        var html = '';
        for (var i = 0; i < table.items.length; i++) {
            var item = table.items[i];
            html += '<div class="transfer-item-row" data-idx="' + i + '" data-price="' + item.price + '" data-max="' + item.qty + '">' +
                '<span>' + escapeHtml(item.name) + '</span>' +
                '<div class="transfer-qty-control">' +
                    '<button class="transfer-qty-minus" data-idx="' + i + '">-</button>' +
                    '<input type="number" class="transfer-qty-input" id="transfer-qty-' + i + '" value="0" min="0" max="' + item.qty + '" step="1" style="width:60px;text-align:center;">' +
                    '<button class="transfer-qty-plus" data-idx="' + i + '">+</button>' +
                    '<span>/ ' + item.qty + '</span>' +
                '</div>' +
            '</div>';
        }
        container.innerHTML = html;
        attachTransferQtyEvents();
        var targetInput = document.getElementById('transferTargetTable');
        if (targetInput) targetInput.value = '';
        document.getElementById('transferItemsModal').style.display = 'flex';
    });
}

function attachTransferQtyEvents() {
    var minusBtns = document.querySelectorAll('.transfer-qty-minus');
    var plusBtns = document.querySelectorAll('.transfer-qty-plus');
    for (var i = 0; i < minusBtns.length; i++) {
        minusBtns[i].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('transfer-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value) || 0;
                    if (val > 0) input.value = val - 1;
                }
            };
        })(minusBtns[i]);
    }
    for (var i = 0; i < plusBtns.length; i++) {
        plusBtns[i].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('transfer-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value) || 0;
                    var max = parseInt(input.getAttribute('max')) || 0;
                    if (val < max) input.value = val + 1;
                }
            };
        })(plusBtns[i]);
    }
}

function confirmTransferItems() {
    if (!pendingTransferSourceTable) return;
    var selectedItems = [];
    var remainingItems = [];
    for (var i = 0; i < pendingTransferSourceTable.items.length; i++) {
        remainingItems.push({ name: pendingTransferSourceTable.items[i].name, price: pendingTransferSourceTable.items[i].price, qty: pendingTransferSourceTable.items[i].qty });
    }
    var rows = document.querySelectorAll('.transfer-item-row');
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var idx = parseInt(row.getAttribute('data-idx'));
        var input = document.getElementById('transfer-qty-' + idx);
        var qty = input ? parseInt(input.value) : 0;
        if (qty > 0) {
            var item = remainingItems[idx];
            if (qty > item.qty) qty = item.qty;
            selectedItems.push({ name: item.name, price: item.price, qty: qty });
            item.qty -= qty;
        }
    }
    if (selectedItems.length === 0) { showToast('Chưa chọn món để chuyển!', 'warning'); return; }
    var targetName = document.getElementById('transferTargetTable').value.trim();
    if (!targetName) { showToast('Nhập tên bàn đích!', 'warning'); return; }
    DB.getAll('tables').then(function(allTables) {
        var targetTable = null;
        for (var i = 0; i < allTables.length; i++) {
            if (allTables[i].name === targetName) { targetTable = allTables[i]; break; }
        }
        var createNew = false;
        if (!targetTable) {
            createNew = true;
            var maxNum = 0;
            for (var i = 0; i < allTables.length; i++) {
                var match = allTables[i].name.match(/Ban (\d+)/);
                if (match && parseInt(match[1]) > maxNum) maxNum = parseInt(match[1]);
            }
            var newNumber = maxNum + 1;
            if (newNumber > 99) { showToast('Đã đạt giới hạn 99 bàn!', 'warning'); return; }
            var newId = Date.now().toString();
            var now = new Date();
            targetTable = {
                id: newId, name: targetName, status: 'occupied',
                time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                startTime: now.toISOString(),
                items: [], total: 0, customerId: null, customerName: null
            };
        }
        var targetItems = targetTable.items || [];
        for (var i = 0; i < selectedItems.length; i++) {
            var sel = selectedItems[i];
            var found = false;
            for (var j = 0; j < targetItems.length; j++) {
                if (targetItems[j].name === sel.name) {
                    targetItems[j].qty += sel.qty;
                    found = true;
                    break;
                }
            }
            if (!found) targetItems.push({ name: sel.name, price: sel.price, qty: sel.qty, addedTime: new Date().toISOString() });
        }
        var newTargetTotal = targetItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        var finalSourceItems = remainingItems.filter(function(i) { return i.qty > 0; });
        var newSourceTotal = finalSourceItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        var promise = createNew ? DB.create('tables', targetTable, targetTable.id) : Promise.resolve();
        promise.then(function() {
            return DB.update('tables', targetTable.id, { items: targetItems, total: newTargetTotal });
        }).then(function() {
            return DB.update('tables', pendingTransferSourceTable.id, { items: finalSourceItems, total: newSourceTotal });
        }).then(function() {
            renderTables();
            if (currentTableDetailId === pendingTransferSourceTable.id) showTableDetail(pendingTransferSourceTable.id);
            closeModal('transferItemsModal');
            var totalQty = 0;
            for (var i = 0; i < selectedItems.length; i++) totalQty += selectedItems[i].qty;
            showToast('Đã chuyển ' + totalQty + ' món sang ' + targetName, 'success');
        });
    });
}

// ========== GỘP BÀN ==========
function showMergeTableModal(sourceId) {
    pendingMergeSourceId = sourceId;
    DB.get('tables', String(sourceId)).then(function(source) {
        if (!source || !source.items || !source.items.length) { showToast('Bàn nguồn không có món!', 'warning'); return; }
        DB.getAll('tables').then(function(allTables) {
            var targets = allTables.filter(function(t) { return t.id !== sourceId && (t.items && t.items.length) && t.total > 0; });
            if (targets.length === 0) { showToast('Không có bàn nào để gộp!', 'warning'); return; }
            var container = document.getElementById('mergeTablesList');
            if (!container) return;
            var html = '';
            for (var i = 0; i < targets.length; i++) {
                var t = targets[i];
                html += '<div class="merge-table-item" data-id="' + t.id + '"><strong>' + escapeHtml(t.name) + '</strong> - ' + (t.customerName || 'chưa có khách') + ' - ' + formatMoney(t.total) + '</div>';
            }
            container.innerHTML = html;
            var items = document.querySelectorAll('.merge-table-item');
            for (var i = 0; i < items.length; i++) {
                items[i].onclick = (function(item) {
                    return function() {
                        var targetId = item.getAttribute('data-id');
                        mergeTables(sourceId, targetId);
                        closeModal('mergeTableModal');
                    };
                })(items[i]);
            }
            document.getElementById('mergeTableModal').style.display = 'flex';
        });
    });
}

function mergeTables(sourceId, targetId) {
    Promise.all([DB.get('tables', String(sourceId)), DB.get('tables', String(targetId))]).then(function(results) {
        var source = results[0];
        var target = results[1];
        if (!source || !target) return;
        var targetItems = target.items || [];
        for (var i = 0; i < source.items.length; i++) {
            var srcItem = source.items[i];
            var found = false;
            for (var j = 0; j < targetItems.length; j++) {
                if (targetItems[j].name === srcItem.name) {
                    targetItems[j].qty += srcItem.qty;
                    found = true;
                    break;
                }
            }
            if (!found) targetItems.push({ name: srcItem.name, price: srcItem.price, qty: srcItem.qty, addedTime: srcItem.addedTime });
        }
        var newTotal = targetItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        DB.update('tables', targetId, { items: targetItems, total: newTotal }).then(function() {
            return DB.remove('tables', String(sourceId));
        }).then(function() {
            renderTables();
            if (currentTableDetailId === sourceId || currentTableDetailId === targetId) showTableDetail(targetId);
            showToast('✅ Đã gộp bàn ' + source.name + ' vào ' + target.name, 'success');
        });
    });
}

// ========== XÓA BÀN ==========
function showDeleteTableConfirm(tableId) {
    pendingDeleteTableId = tableId;
    document.getElementById('deleteTableModal').style.display = 'flex';
}

function confirmDeleteTable() {
    if (!pendingDeleteTableId) return;
    DB.get('tables', String(pendingDeleteTableId)).then(function(table) {
        if (!table) return;
        if (table.items && table.items.length) {
            restoreIngredients(table.items);
        }
        DB.remove('tables', String(pendingDeleteTableId)).then(function() {
            renderTables();
            if (currentTableDetailId === pendingDeleteTableId) closeModal('tableDetailModal');
            showToast('🗑️ Đã xóa bàn ' + table.name, 'success');
            closeModal('deleteTableModal');
            pendingDeleteTableId = null;
        });
    });
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
        // if (currentTab === 'history') { renderHistoryByDate(currentHistoryDate); }
        // if (currentTab === 'report') { renderReport(currentReportDate); }
    });
}

// ========== LỊCH SỬ - ĐÃ CỐ ĐỊNH VỊ TRÍ STATUS ==========
// ========== LỊCH SỬ - 2 DÒNG GỌN GÀNG ==========
function renderHistoryByDate(dateObj) {
    var dateStr = dateObj.toISOString().slice(0, 10);
    document.getElementById('historyDate').innerText = formatDateDisplay(dateStr);
    
    var filter = document.getElementById('historyFilter').value;
    
    DB.getTransactionsByDate(dateStr).then(function(transactions) {
        if (filter !== 'all') {
            transactions = transactions.filter(function(t) {
                if (filter === 'dinein') return t.type === 'dinein';
                if (filter === 'takeaway') return t.type === 'takeaway';
                if (filter === 'grab') return t.type === 'grab';
                if (filter === 'cash') return t.paymentMethod === 'cash';
                if (filter === 'transfer') return t.paymentMethod === 'transfer';
                if (filter === 'debt_payment') return t.type === 'debt_payment';
                if (filter === 'cancelled') return t.refunded === true;
                return true;
            });
        }

        transactions.sort(function(a, b) {
            return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
        });

        var container = document.getElementById('historyList');
        if (!container) return;

        if (transactions.length === 0) {
            container.innerHTML = '<div class="empty-state">📭 Không có giao dịch nào trong ngày</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            var isRefunded = tx.refunded === true;
            
            // Dòng 1: Thời gian + Thông tin bàn/khách + Phương thức
            var time = new Date(tx.createdAt || tx.date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            
            var location = '';
            if (tx.tableName) location = '🪑 ' + escapeHtml(tx.tableName);
            else if (tx.type === 'takeaway') location = '🛵 Mang đi';
            else if (tx.type === 'grab') location = '🚕 Grab';
            else location = '🍽️ Tại chỗ';

            var method = '';
            if (isRefunded) method = '❌ Đã hủy';
            else if (tx.type === 'debt_payment') method = '💢 Ghi nợ';
            else if (tx.paymentMethod === 'cash') method = '💰 Tiền mặt';
            else if (tx.paymentMethod === 'transfer') method = '💳 CK';
            else method = '✅ Thành công';

            // Dòng 2: Nút + Số tiền
            var refundBtn = isRefunded ? '' : 
                `<button class="btn-refund" onclick="event.stopPropagation(); refundTransaction('${tx.id}')">Hoàn tác</button>`;

            html += `
                <div class="history-item ${isRefunded ? 'refunded' : ''}" onclick="showTransactionDetail('${tx.id}')">
                    <!-- DÒNG 1 -->
                    <div class="history-line1">
                        <span class="history-time">${time}</span>
                        <span class="history-location">${location}</span>
                        <span class="history-method">${method}</span>
                    </div>
                    
                    <!-- DÒNG 2 -->
                    <div class="history-line2">
                        <div class="history-actions">
                            ${refundBtn}
                            <span class="history-expand">Xem chi tiết →</span>
                        </div>
                        <div class="history-amount ${isRefunded ? 'refunded-amount' : ''}">
                            ${isRefunded ? '-' : '+'} ${formatMoney(tx.amount)}
                        </div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    });
}
function showTransactionDetail(transactionId) {
    DB.get('transactions', transactionId).then(function(tx) {
        if (!tx) return;
        
        var dateStr = new Date(tx.date).toLocaleString('vi-VN');
        var typeName = { dinein: 'Tại chỗ', takeaway: 'Mang đi', grab: 'Grab', debt_payment: 'Thanh toán nợ' }[tx.type] || '';
        var paymentMethodText = '';
        if (tx.paymentMethod === 'cash') paymentMethodText = '💰 Tiền mặt';
        else if (tx.paymentMethod === 'transfer') paymentMethodText = '💳 Chuyển khoản';
        else if (tx.paymentMethod === 'debt') paymentMethodText = '💢 Ghi nợ';
        else if (tx.paymentMethod === 'grab') paymentMethodText = '🚕 Grab';
        
        var itemsHtml = '';
        if (tx.items && tx.items.length) {
            itemsHtml = '<div class="detail-items-title">📦 Danh sách món:</div>';
            for (var i = 0; i < tx.items.length; i++) {
                var item = tx.items[i];
                itemsHtml += '<div class="detail-item-row"><span>' + escapeHtml(item.name) + ' x' + item.qty + '</span><span>' + formatMoney(item.price * item.qty) + '</span></div>';
            }
        } else {
            itemsHtml = '<div class="empty-text">Không có món</div>';
        }
        
        var refundInfo = '';
        if (tx.refunded) {
            refundInfo = '<div class="refund-info">❌ Đã hủy lúc: ' + new Date(tx.refundedAt).toLocaleString('vi-VN') + '<br>📝 Lý do: ' + escapeHtml(tx.refundReason || '') + '</div>';
        }
        
        var html = 
            '<div class="detail-section">' +
                '<div class="detail-row"><span>🕒 Thời gian:</span><span>' + dateStr + '</span></div>' +
                '<div class="detail-row"><span>🍽️ Loại:</span><span>' + typeName + '</span></div>' +
                '<div class="detail-row"><span>💳 Thanh toán:</span><span>' + paymentMethodText + '</span></div>' +
                (tx.tableName ? '<div class="detail-row"><span>🪑 Bàn:</span><span>' + escapeHtml(tx.tableName) + '</span></div>' : '') +
                (tx.customer ? '<div class="detail-row"><span>👤 Khách:</span><span>' + escapeHtml(tx.customer.name) + '</span></div>' : '') +
                '<div class="detail-row"><span>💰 Tổng tiền:</span><span class="detail-amount">' + formatMoney(tx.amount) + '</span></div>' +
                (tx.note ? '<div class="detail-row"><span>📝 Ghi chú:</span><span>' + escapeHtml(tx.note) + '</span></div>' : '') +
                refundInfo +
            '</div>' +
            '<div class="detail-section">' + itemsHtml + '</div>';
        
        document.getElementById('transactionDetailBody').innerHTML = html;
        document.getElementById('transactionDetailModal').style.display = 'flex';
    });
}
function refundTransaction(transactionId) {
    var reason = prompt('📝 Lý do hủy?');
    if (!reason) return;
    DB.get('transactions', transactionId).then(function(trans) {
        if (!trans || trans.refunded) return;
        restoreIngredients(trans.items).then(function() {
            if (trans.type === 'debt_payment' && trans.customer) {
                addCustomerDebt(trans.customer.id, trans.amount, 'Hoàn tiền - ' + reason);
            }
            trans.refunded = true;
            trans.refundReason = reason;
            trans.refundedAt = Date.now();
            DB.update('transactions', transactionId, trans).then(function() {
                showToast('✅ Đã hủy giao dịch', 'success');
                // Cập nhật lại lịch sử và báo cáo
                if (currentTab === 'history') {
                    renderHistoryByDate(currentHistoryDate);
                }
                if (currentTab === 'report') {
                    renderReport(currentReportDate);
                }
            });
        });
    });
}

function changeHistoryDate(delta) { var nd = new Date(currentHistoryDate); nd.setDate(nd.getDate() + delta); currentHistoryDate = nd; renderHistoryByDate(currentHistoryDate); }

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

// ========== KHÁCH HÀNG ==========
function renderCustomerList() {
    DB.getAll('customers').then(function(custs) {
        customers = custs;
        var keyword = document.getElementById('customerSearchInput') ? document.getElementById('customerSearchInput').value.toLowerCase() : '';
        var filtered = keyword ? customers.filter(function(c) { return c.name.toLowerCase().indexOf(keyword) !== -1 || (c.phone && c.phone.indexOf(keyword) !== -1); }) : customers;
        var totalDebt = 0;
        for (var i = 0; i < filtered.length; i++) totalDebt += (filtered[i].totalDebt || 0);
        document.getElementById('totalDebtAmount').innerText = formatMoney(totalDebt);
        var container = document.getElementById('customerList');
        if (!container) return;
        if (!filtered.length) { container.innerHTML = '<div class="empty-state">📭 Không có khách hàng</div>'; return; }
        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            var c = filtered[i];
            html += '<div class="customer-card" onclick="showCustomerDetail(\'' + c.id + '\')"><div class="customer-avatar">' + c.name.charAt(0).toUpperCase() + '</div><div class="customer-info"><div class="customer-name">' + escapeHtml(c.name) + '</div><div class="customer-phone">📞 ' + (c.phone || '') + '</div></div><div class="customer-debt">' + ((c.totalDebt || 0) > 0 ? formatMoney(c.totalDebt) : '✅') + '</div></div>';
        }
        container.innerHTML = html;
    });
}

function quickAddCustomer() {
    var name = prompt('👤 Nhập tên khách hàng:');
    if (!name) return;
    for (var i = 0; i < customers.length; i++) {
        if (customers[i].name.toLowerCase() === name.toLowerCase()) { showToast('Khách đã tồn tại!', 'warning'); return; }
    }
    addCustomer(name, '').then(function() {
        if (document.getElementById('customerSearchInput')) document.getElementById('customerSearchInput').value = '';
        renderCustomerList();
        showToast('✅ Đã thêm khách ' + name, 'success');
    });
}

function addCustomer(name, phone) {
    var newId = Date.now().toString() + Math.random().toString(36).substr(2, 6);
    var newCustomer = { id: newId, name: name.trim(), phone: phone || '', address: '', totalDebt: 0, totalSpent: 0, createdAt: new Date().toISOString(), debtHistory: [], paymentHistory: [] };
    return DB.create('customers', newCustomer).then(function() {
        customers.push(newCustomer);
        return newCustomer;
    });
}

function showCustomerDetail(customerId) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return;
    var historyHtml = '';
    var all = [];
    if (c.debtHistory) {
        for (var i = 0; i < c.debtHistory.length; i++) all.push({ type: 'debt', date: c.debtHistory[i].date, amount: c.debtHistory[i].amount, note: c.debtHistory[i].note });
    }
    if (c.paymentHistory) {
        for (var i = 0; i < c.paymentHistory.length; i++) all.push({ type: 'payment', date: c.paymentHistory[i].date, amount: c.paymentHistory[i].amount, note: c.paymentHistory[i].note });
    }
    all.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    for (var i = 0; i < all.length; i++) {
        var h = all[i];
        var amountClass = h.type === 'debt' ? 'var(--danger)' : 'var(--success)';
        var sign = h.type === 'debt' ? '-' : '+';
        historyHtml += '<div class="cart-item"><span>' + new Date(h.date).toLocaleString('vi-VN') + '</span><span style="color:' + amountClass + '">' + sign + formatMoney(h.amount) + '</span></div><div style="font-size:11px; margin-bottom:8px;">📝 ' + escapeHtml(h.note || '') + '</div>';
    }
    var content = document.getElementById('customerDetailContent');
    if (!content) return;
    content.innerHTML = '<div class="debt-summary" style="margin-bottom:16px;"><span>💰 Công nợ</span><span style="color:#ef4444; font-size:20px;">' + formatMoney(c.totalDebt || 0) + '</span></div>' + ((c.totalDebt || 0) > 0 ? '<button class="btn-save" onclick="openDebtPayment(\'' + c.id + '\', ' + (c.totalDebt || 0) + ')" style="margin-bottom:16px;">💸 Thanh toán nợ</button>' : '') + '<div class="cost-history-title">📜 Lịch sử</div>' + (historyHtml || '<div class="empty-state">Chưa có giao dịch</div>');
    document.getElementById('customerDetailModal').style.display = 'flex';
}

function openDebtPayment(customerId, currentDebt) {
    for (var i = 0; i < customers.length; i++) {
        if (customers[i].id === customerId) {
            document.getElementById('debtPaymentInfo').innerHTML = '💰 Khách: ' + customers[i].name + '<br>💢 Nợ: ' + formatMoney(currentDebt);
            break;
        }
    }
    document.getElementById('debtPaymentAmount').value = currentDebt;
    document.getElementById('debtPaymentModal').style.display = 'flex';
    pendingDebtCustomerId = customerId;
}

function confirmDebtPayment() {
    var amount = parseInt(document.getElementById('debtPaymentAmount').value) || 0;
    if (amount <= 0) { showToast('Số tiền không hợp lệ!', 'warning'); return; }
    var customer = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === pendingDebtCustomerId) { customer = customers[i]; break; } }
    if (!customer) return;
    var payment = Math.min(amount, customer.totalDebt || 0);
    customer.totalDebt = (customer.totalDebt || 0) - payment;
    customer.paymentHistory = customer.paymentHistory || [];
    customer.paymentHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: payment, method: 'cash', note: 'Thanh toán nợ ' + formatMoney(payment) });
    DB.update('customers', customer.id, { totalDebt: customer.totalDebt, paymentHistory: customer.paymentHistory }).then(function() {
        return addHistory({ type: 'debt_payment', amount: payment, paymentMethod: 'cash', customer: { id: customer.id, name: customer.name }, note: 'Thanh toán nợ' });
    }).then(function() {
        return DB.getAll('customers');
    }).then(function(newCusts) {
        customers = newCusts;
        showToast('✅ Đã thanh toán ' + formatMoney(payment), 'success');
        closeModal('debtPaymentModal');
        renderCustomerList();
        showCustomerDetail(customer.id);
    });
}

function addCustomerDebt(customerId, amount, note) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return Promise.resolve();
    c.totalDebt = (c.totalDebt || 0) + amount;
    c.debtHistory = c.debtHistory || [];
    c.debtHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: amount, note: note, status: 'unpaid' });
    return DB.update('customers', customerId, { totalDebt: c.totalDebt, debtHistory: c.debtHistory }).then(function() {
        return DB.getAll('customers').then(function(newCusts) { customers = newCusts; });
    });
}

// ========== CHỌN KHÁCH ==========
function showCustomerSelector(callback) {
    pendingCustomerCallback = callback;
    renderCustomerSelectorList('');
    var searchInput = document.getElementById('customerSelectorSearch');
    if (searchInput) searchInput.value = '';
    document.getElementById('customerSelectorModal').style.display = 'flex';
    if (searchInput) {
        searchInput.oninput = function() { renderCustomerSelectorList(this.value); };
    }
}

function renderCustomerSelectorList(searchTerm) {
    var filtered = customers;
    if (searchTerm) {
        var lower = searchTerm.toLowerCase();
        filtered = customers.filter(function(c) { return c.name.toLowerCase().indexOf(lower) !== -1 || (c.phone && c.phone.indexOf(searchTerm) !== -1); });
    }
    var container = document.getElementById('customerSelectorList');
    if (!container) return;
    if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">📭 Không tìm thấy khách</div>'; return; }
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var c = filtered[i];
        var debtText = (c.totalDebt || 0) > 0 ? ' - Nợ: ' + formatMoney(c.totalDebt) : '';
        html += '<div class="customer-select-item" onclick="selectCustomer(\'' + c.id + '\')"><div class="customer-avatar" style="width:36px;height:36px;">' + c.name.charAt(0).toUpperCase() + '</div><div><div style="font-weight:600;">' + escapeHtml(c.name) + '</div><div style="font-size:11px;">' + (c.phone || '') + debtText + '</div></div></div>';
    }
    container.innerHTML = html;
}

function selectCustomer(customerId) {
    var customer = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { customer = customers[i]; break; } }
    if (customer && pendingCustomerCallback) {
        pendingCustomerCallback(customer);
        pendingCustomerCallback = null;
    }
    closeModal('customerSelectorModal');
}

function createCustomerFromInput() {
    var name = document.getElementById('customerSelectorSearch').value.trim();
    if (!name) { showToast('Nhập tên khách hàng!', 'warning'); return; }
    for (var i = 0; i < customers.length; i++) {
        if (customers[i].name.toLowerCase() === name.toLowerCase()) {
            if (confirm('Khách "' + name + '" đã tồn tại. Chọn khách này?')) {
                selectCustomer(customers[i].id);
            }
            return;
        }
    }
    addCustomer(name, '').then(function(newC) {
        if (newC && pendingCustomerCallback) {
            pendingCustomerCallback(newC);
            pendingCustomerCallback = null;
        }
        closeModal('customerSelectorModal');
        showToast('✅ Đã tạo khách ' + name, 'success');
        renderCustomerList();
    });
}

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
