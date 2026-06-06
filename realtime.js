// realtime.js - Realtime subscriptions, cập nhật bàn thông minh
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

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
        // Luôn cập nhật danh sách khách nếu đang ở tab customers
        if (currentTab === 'customers') {
            renderCustomerList();
        }
        // Cập nhật modal chọn khách nếu đang mở
        var selectorModal = document.getElementById('customerSelectorModal');
        if (selectorModal && selectorModal.style.display === 'flex') {
            var searchVal = document.getElementById('customerSelectorSearch') ? document.getElementById('customerSelectorSearch').value : '';
            renderCustomerSelectorList(searchVal);
        }
        // Cập nhật modal chi tiết khách nếu đang mở
        var detailModal = document.getElementById('customerDetailModal');
        if (detailModal && detailModal.style.display === 'flex') {
            var detailContent = document.getElementById('customerDetailContent');
            if (detailContent && detailContent.getAttribute('data-customer-id')) {
                var custId = detailContent.getAttribute('data-customer-id');
                showCustomerDetail(custId);
            }
        }
        // Cập nhật danh sách nợ trong tab manager nếu đang active
        if (currentTab === 'manager' && typeof renderManagerDebtList === 'function') {
            renderManagerDebtList(customers);
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
    
    DB.subscribe('ingredients', function(data) {
        ingredients = data || [];
        // Cập nhật cảnh báo tồn kho trong manager nếu đang active
        if (currentTab === 'manager' && typeof renderLowStockAlert === 'function') {
            renderLowStockAlert();
        }
    });
    
    // Transaction subscription - cập nhật realtime history, report, customers
    DB.subscribe('transactions', function() {
        updateRecentToast();

        // Hủy lần render trước nếu chưa kịp chạy
        if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
        // Đợi 100ms để gộp nhiều sự kiện
        renderDebounceTimer = setTimeout(function() {
            // Luôn cập nhật history nếu đang ở tab history
            if (currentTab === 'history') {
                renderHistoryByDate(currentHistoryDate);
            }
            // Luôn cập nhật report nếu đang ở tab report
            if (currentTab === 'report') {
                renderReport(currentReportDate);
            }
            // Cập nhật danh sách giao dịch gần đây ở sidebar
            if (typeof renderRecentTransactions === 'function') {
                renderRecentTransactions();
            }
            renderDebounceTimer = null;
        }, 100);
    });
    
    DB.subscribe('cost_categories', function(data) {
        costCategories = data || [];
        refreshCostModal();
        // Cập nhật manager nếu đang active
        if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
            managerApplyFilter();
        }
    });
    
    DB.subscribe('cost_transactions', function(data) {
        costTransactions = data || [];
        refreshCostModal();
        // Cập nhật report nếu đang ở tab report
        if (currentTab === 'report') {
            renderReport(currentReportDate);
        }
        // Cập nhật manager nếu đang active
        if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
            managerApplyFilter();
        }
    });
    
    // Thêm subscription cho cost_transactions_admin và admin_cost_categories
    DB.subscribe('cost_transactions_admin', function(data) {
        if (typeof adminCostTransactions !== 'undefined') {
            adminCostTransactions = data || [];
        }
        if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
            managerApplyFilter();
        }
    });
    
    DB.subscribe('admin_cost_categories', function(data) {
        if (typeof adminCostCategories !== 'undefined') {
            adminCostCategories = data || [];
        }
        if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
            managerApplyFilter();
        }
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
