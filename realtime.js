// realtime.js - Realtime subscriptions, cập nhật bàn thông minh
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== REALTIME THÔNG MINH ==========
// FIX: Debounce ngắn hơn (100ms) vì local callback đã nhanh, Firebase chỉ là đồng bộ nền
var _realtimeTimers = {};

function _debounceRealtime(key, fn, delay) {
    delay = delay || 100;
    if (_realtimeTimers[key]) clearTimeout(_realtimeTimers[key]);
    _realtimeTimers[key] = setTimeout(function() {
        _realtimeTimers[key] = null;
        fn();
    }, delay);
}

// FIX: Gọi UI render ngay từ memoryCache, không chờ Firebase
function _renderNow(key, fn) {
    if (_realtimeTimers[key]) clearTimeout(_realtimeTimers[key]);
    _realtimeTimers[key] = null;
    fn();
}

function initRealtime() {
    DB.subscribe('tables', function(newTables) {
        if (!newTables) return;
        cachedTables = newTables;
        tablesCacheTime = Date.now();
        if (currentTab !== 'tables') return;
        // FIX: Render ngay nếu đang ở tab tables, không debounce
        _renderNow('tables_render', function() {
            updateTablesDiff(newTables);
        });
        // Đảm bảo timer luôn chạy khi ở tab tables
        if (typeof startTableTimer === 'function') {
            startTableTimer();
        }
    });
    
    DB.subscribe('daily_balances', function() {
        if (currentTab === 'report' || currentTab === 'manager') {
            _debounceRealtime('daily_balances', function() {
                renderReport(currentReportDate);
                if (typeof managerApplyFilter === 'function') {
                    managerApplyFilter();
                }
            }, 100);
        }
    });
    
    DB.subscribe('customers', function(data) {
        customers = data || [];
        _debounceRealtime('customers', function() {
            if (currentTab === 'customers') {
                renderCustomerList();
            }
            var selectorModal = document.getElementById('customerSelectorModal');
            if (selectorModal && selectorModal.style.display === 'flex') {
                var searchVal = document.getElementById('customerSelectorSearch') ? document.getElementById('customerSelectorSearch').value : '';
                renderCustomerSelectorList(searchVal);
            }
            var detailModal = document.getElementById('customerDetailModal');
            if (detailModal && detailModal.style.display === 'flex') {
                var detailContent = document.getElementById('customerDetailContent');
                if (detailContent && detailContent.getAttribute('data-customer-id')) {
                    showCustomerDetail(detailContent.getAttribute('data-customer-id'));
                }
            }
            if (currentTab === 'manager' && typeof renderManagerDebtList === 'function') {
                renderManagerDebtList(customers);
            }
        }, 100);
    });
    
    DB.subscribe('menu', function(data) {
        menuItems = data || [];
        if (typeof _invalidateLookups === 'function') _invalidateLookups();
        var orderModal = document.getElementById('orderModal');
        if (orderModal && orderModal.style.display === 'flex') {
            _debounceRealtime('menu', function() {
                renderMenuByCategory(currentMenuCategory);
            }, 100);
        }
    });
    
    DB.subscribe('menu_categories', function(data) {
        menuCategories = data || [];
        var orderModal = document.getElementById('orderModal');
        if (orderModal && orderModal.style.display === 'flex') {
            _debounceRealtime('menu_categories', function() {
                renderOrderCategories();
            }, 100);
        }
    });
    
    DB.subscribe('ingredients', function(data) {
        ingredients = data || [];
        if (typeof _invalidateLookups === 'function') _invalidateLookups();
        if (currentTab === 'manager' && typeof renderLowStockAlert === 'function') {
            _debounceRealtime('ingredients', function() {
                renderLowStockAlert();
            }, 100);
        }
    });
    
    // Transaction subscription - cập nhật realtime history, report, customers
    DB.subscribe('transactions', function() {
        _debounceRealtime('transactions', function() {
            updateRecentToast();
            if (currentTab === 'history') {
                renderHistoryByDate(currentHistoryDate);
            }
            if (currentTab === 'report') {
                renderReport(currentReportDate);
            }
            if (typeof renderRecentTransactions === 'function') {
                renderRecentTransactions();
            }
        }, 100);
    });
    
    DB.subscribe('cost_categories', function(data) {
        costCategories = data || [];
        _debounceRealtime('cost_categories', function() {
            // Refresh expense modal nếu đang mở
            var expenseModal = document.getElementById('expenseModal');
            if (expenseModal && expenseModal.style.display === 'flex' && typeof loadExpenseData === 'function') {
                loadExpenseData().then(function() {
                    renderTodayExpenses();
                    renderMonthExpenseTotal();
                });
            }
            if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
                managerApplyFilter();
            }
        }, 100);
    });
    
    DB.subscribe('cost_transactions', function(data) {
        costTransactions = data || [];
        _debounceRealtime('cost_transactions', function() {
            // Refresh expense modal nếu đang mở
            var expenseModal = document.getElementById('expenseModal');
            if (expenseModal && expenseModal.style.display === 'flex' && typeof loadExpenseData === 'function') {
                loadExpenseData().then(function() {
                    renderTodayExpenses();
                    renderMonthExpenseTotal();
                });
            }
            if (currentTab === 'report') {
                renderReport(currentReportDate);
            }
            if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
                managerApplyFilter();
            }
        }, 100);
    });
    
    DB.subscribe('cost_transactions_admin', function(data) {
        if (typeof adminCostTransactions !== 'undefined') {
            adminCostTransactions = data || [];
        }
        if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
            _debounceRealtime('cost_transactions_admin', function() {
                managerApplyFilter();
            }, 100);
        }
    });
    
    DB.subscribe('admin_cost_categories', function(data) {
        if (typeof adminCostCategories !== 'undefined') {
            adminCostCategories = data || [];
        }
        if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
            _debounceRealtime('admin_cost_categories', function() {
                managerApplyFilter();
            }, 100);
        }
    });
    
    // Notifications subscription - cập nhật thông báo header realtime
    DB.subscribe('notifications', function(data) {
        if (data && typeof loadHeaderNotification === 'function') {
            _debounceRealtime('notifications', function() {
                loadHeaderNotification();
            }, 100);
        }
    });
    
    // Manager cash pickups subscription - cập nhật realtime stat-row và đối soát
    DB.subscribe('manager_cash_pickups', function(data) {
        window.managerCashPickups = data || [];
        if (typeof managerCashPickups !== 'undefined' && managerCashPickups !== window.managerCashPickups) {
            managerCashPickups = window.managerCashPickups;
        }
        _debounceRealtime('manager_cash_pickups', function() {
            if (currentTab === 'report') {
                renderReport(currentReportDate);
            }
        }, 100);
    });
    
    // Inventory transactions subscription - cập nhật realtime đối soát
    DB.subscribe('inventory_transactions', function(data) {
        window.inventoryTransactions = data || [];
        if (typeof inventoryTransactions !== 'undefined' && inventoryTransactions !== window.inventoryTransactions) {
            inventoryTransactions = window.inventoryTransactions;
        }
        _debounceRealtime('inventory_transactions', function() {
            if (currentTab === 'report') {
                renderReport(currentReportDate);
            }
        }, 100);
    });
}

function updateRecentToast() {
    var todayStr = new Date().toISOString().slice(0, 10);
    DB.getTransactionsByDate(todayStr).then(function(transactions) {
        // Hiển thị tất cả giao dịch không bị hoàn: bàn, CK, tiền mặt, grab, nợ
        var validTx = transactions.filter(function(tx) { return !tx.refunded; });
        validTx.sort(function(a, b) {
            return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
        });
        var recent = validTx.slice(0, 3);
        var container = document.getElementById('recentToastList');
        if (!container) return;
        
        if (recent.length === 0) {
            container.innerHTML = '<div style="font-size: 10px; color: #64748b; text-align:center;">📋 Chưa có giao dịch hôm nay</div>';
            return;
        }
        
        var html = '';
        for (var i = 0; i < recent.length; i++) {
            var tx = recent[i];
            var txTime = new Date(tx.createdAt || tx.date).getTime();
            var timeDiff = Math.floor((Date.now() - txTime) / 60000);
            var timeText = '';
            if (timeDiff < 1) timeText = 'vừa xong';
            else if (timeDiff < 60) timeText = timeDiff + 'p';
            else timeText = Math.floor(timeDiff / 60) + 'h';
            
            // Thông tin hiển thị: loại giao dịch + địa điểm
            var shortInfo = '';
            if (tx.tableName) {
                // Nếu có customer name thì hiển thị tên khách thay vì số bàn
                var displayLabel = (tx.customer && tx.customer.name) ? tx.customer.name : tx.tableName;
                shortInfo = '🍽️ ' + displayLabel;
            } else if (tx.type === 'takeaway') {
                shortInfo = '🛵 Mang đi';
            } else if (tx.type === 'grab') {
                shortInfo = '🚕 Grab';
            } else {
                shortInfo = '🍽️ Tại chỗ';
            }
            
            // Thêm số món nếu có items
            var totalItems = 0;
            if (tx.items && tx.items.length) {
                for (var j = 0; j < tx.items.length; j++) totalItems += tx.items[j].qty;
            }
            var itemInfo = totalItems > 0 ? ' (' + totalItems + ' món)' : '';
            
            // Thêm phương thức thanh toán
            var methodIcon = '';
            if (tx.paymentMethod === 'cash') methodIcon = '💰';
            else if (tx.paymentMethod === 'transfer') methodIcon = '💳';
            else if (tx.paymentMethod === 'debt') methodIcon = '💢';
            else if (tx.paymentMethod === 'grab') methodIcon = '🚕';
            else methodIcon = '💵';
            
            html += `
                <div class="recent-toast-item" onclick="showTransactionDetail('${tx.id}')" data-tx-time="${txTime}">
                    <span class="toast-time">${timeText}</span>
                    <span class="toast-info">${shortInfo}${itemInfo} ${methodIcon}</span>
                    <span class="toast-amount">${formatMoney(tx.amount)}</span>
                </div>
            `;
        }
        container.innerHTML = html;
    });
}

// ========== CẬP NHẬT BÀN THÔNG MINH ==========
// OPTIMIZE: Sử dụng DocumentFragment để batch DOM operations
function updateTablesDiff(newTables) {
    var activeTables = newTables.filter(function(t) { return (t.items && t.items.length) || t.total > 0; });
    var grid = document.getElementById('tablesGrid');
    if (!grid) return;
    
    var existingCards = grid.querySelectorAll('.table-card');
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
    
    // Thêm hoặc cập nhật bàn - dùng DocumentFragment để batch
    var fragment = null;
    for (var i = 0; i < activeTables.length; i++) {
        var table = activeTables[i];
        var existingCard = existingIds[table.id];
        if (existingCard) {
            updateTableCard(existingCard, table);
        } else {
            if (!fragment) fragment = document.createDocumentFragment();
            fragment.appendChild(createTableCard(table));
        }
    }
    if (fragment) grid.appendChild(fragment);
}

function updateTableCard(card, table) {
    var itemCount = 0;
    if (table.items) {
        for (var j = 0; j < table.items.length; j++) {
            itemCount += table.items[j].qty;
        }
    }
    
    var timeDisplay = '--:--';
    var isLocked = false;
    if (table.startTime) {
        var start = new Date(table.startTime);
        var diffMins = Math.floor((Date.now() - start) / 60000);
        var hours = Math.floor(diffMins / 60);
        var mins = diffMins % 60;
        timeDisplay = start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + (hours ? hours + 'h' + mins + 'p' : mins + 'p');
        // Sử dụng isTableLocked để check cả lock period 17h-5h30
        if (typeof isTableLocked === 'function') {
            isLocked = isTableLocked(table);
        } else {
            isLocked = diffMins >= (TABLE_LOCK_HOURS || 5) * 60;
        }
    }
    
    // Lưu startTime vào data attribute để timer cập nhật sau
    card.setAttribute('data-start-time', table.startTime || '');
    
    var displayName = table.customerName ? escapeHtml(table.customerName) : escapeHtml(table.name);
    
    var nameSpan = card.querySelector('.table-name');
    if (nameSpan) nameSpan.innerHTML = displayName + (isLocked ? ' 🔒' : '');
    
    var timeSpan = card.querySelector('.table-time');
    if (timeSpan) timeSpan.innerHTML = (isLocked ? '🔒 ' : '⏱️ ') + timeDisplay;
    
    var itemCountSpan = card.querySelector('.table-item-count');
    if (itemCountSpan) itemCountSpan.innerHTML = '📦 ' + itemCount + ' món';
    
    var totalSpan = card.querySelector('.table-total');
    if (totalSpan) totalSpan.innerHTML = formatMoney(table.total);
    
    // Cập nhật recentAdds (nằm trong .table-actions)
    var actionsEl = card.querySelector('.table-actions');
    var recentAddsEl = actionsEl ? actionsEl.querySelector('.table-recent-adds') : null;
    var newRecentHtml = _renderRecentAddsHtml(table.recentAdds);
    if (recentAddsEl) {
        recentAddsEl.outerHTML = newRecentHtml;
    } else if (newRecentHtml && actionsEl) {
        actionsEl.insertAdjacentHTML('beforeend', newRecentHtml);
    }
    
    // Thêm class locked nếu bàn bị khóa
    if (isLocked) {
        card.classList.add('table-locked');
    } else {
        card.classList.remove('table-locked');
    }
}

// Helper: rút gọn tên món (tối đa 15 ký tự)
function _shortenName(name, maxLen) {
    maxLen = maxLen || 15;
    if (name.length <= maxLen) return name;
    return name.substring(0, maxLen - 1) + '…';
}

// Helper: tạo HTML hiển thị recentAdds (tối đa 2 entry, hiển thị giờ + tên rút gọn)
function _renderRecentAddsHtml(recentAdds) {
    if (!recentAdds || !recentAdds.length) return '';
    var html = '<div class="table-recent-adds">';
    var startIdx = Math.max(0, recentAdds.length - 2);
    for (var i = startIdx; i < recentAdds.length; i++) {
        var entry = recentAdds[i];
        // Hiển thị giờ: HH:MM
        var d = new Date(entry.time);
        var timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        // Rút gọn danh sách món - chỉ lấy 2 món gần nhất
        var itemsStr = '';
        if (entry.items && entry.items.length) {
            var itemStart = Math.max(0, entry.items.length - 2);
            for (var j = itemStart; j < entry.items.length; j++) {
                var it = entry.items[j];
                if (j > itemStart) itemsStr += ', ';
                itemsStr += _shortenName(it.name, 12) + (it.qty > 1 ? ' x' + it.qty : '');
            }
        }
        html += '<span class="recent-add-entry" title="' + escapeHtml(itemsStr) + '">' + escapeHtml(itemsStr) + ' <span class="recent-add-time">' + timeStr + '</span></span>';
    }
    html += '</div>';
    return html;
}

function createTableCard(table) {
    var itemCount = 0;
    if (table.items) {
        for (var j = 0; j < table.items.length; j++) {
            itemCount += table.items[j].qty;
        }
    }
    
    var timeDisplay = '--:--';
    var isLocked = false;
    if (table.startTime) {
        var start = new Date(table.startTime);
        var diffMins = Math.floor((Date.now() - start) / 60000);
        var hours = Math.floor(diffMins / 60);
        var mins = diffMins % 60;
        timeDisplay = start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + (hours ? hours + 'h' + mins + 'p' : mins + 'p');
        // Sử dụng isTableLocked để check cả lock period 17h-5h30
        if (typeof isTableLocked === 'function') {
            isLocked = isTableLocked(table);
        } else {
            isLocked = diffMins >= (TABLE_LOCK_HOURS || 5) * 60;
        }
    }
    
    var displayName = table.customerName ? escapeHtml(table.customerName) : escapeHtml(table.name);
    
    var div = document.createElement('div');
    div.className = 'table-card' + (isLocked ? ' table-locked' : '');
    div.setAttribute('data-id', table.id);
    div.setAttribute('data-start-time', table.startTime || '');
    div.onclick = function(id) { return function() { showTableDetail(id); }; }(table.id);
    div.innerHTML =
        '<div class="table-header">' +
            '<span class="table-name" onclick="event.stopPropagation(); showCustomerSelectorForTable(\'' + table.id + '\')" style="cursor:pointer;">' + displayName + (isLocked ? ' 🔒' : '') + '</span>' +
            '<span class="table-time" onclick="event.stopPropagation(); openAddMenuForTable(\'' + table.id + '\')" style="cursor:pointer;">' + (isLocked ? '🔒 ' : '⏱️ ') + timeDisplay + '</span>' +
        '</div>' +
        '<div class="table-stats">' +
            '<span class="table-item-count">📦 ' + itemCount + ' món</span>' +
            '<span class="table-total">' + formatMoney(table.total) + '</span>' +
        '</div>' +
        '<div class="table-actions">' +
            _renderRecentAddsHtml(table.recentAdds) +
        '</div>';
    return div;
}

// ========== TIMER CẬP NHẬT THỜI GIAN ==========
// Tự động cập nhật thời gian hiển thị trên thẻ bàn và recent toast mỗi 1 giây (realtime)
var _tableTimerId = null;

function _updateRecentToastTimes() {
    var container = document.getElementById('recentToastList');
    if (!container) return;
    var items = container.querySelectorAll('.recent-toast-item');
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var txTime = item.getAttribute('data-tx-time');
        if (!txTime) continue;
        var timeDiff = Math.floor((Date.now() - parseInt(txTime)) / 60000);
        var timeText = '';
        if (timeDiff < 1) timeText = 'vừa xong';
        else if (timeDiff < 60) timeText = timeDiff + 'p';
        else timeText = Math.floor(timeDiff / 60) + 'h';
        var timeSpan = item.querySelector('.toast-time');
        if (timeSpan) timeSpan.textContent = timeText;
    }
}

function startTableTimer() {
    if (_tableTimerId) return; // Đã chạy rồi
    _tableTimerId = setInterval(function() {
        // Cập nhật thời gian thẻ bàn
        var grid = document.getElementById('tablesGrid');
        if (grid) {
            var cards = grid.querySelectorAll('.table-card');
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                var startTime = card.getAttribute('data-start-time');
                if (!startTime) continue;
                
                var start = new Date(startTime);
                var diffSecs = Math.floor((Date.now() - start) / 1000);
                var hours = Math.floor(diffSecs / 3600);
                var mins = Math.floor((diffSecs % 3600) / 60);
                var secs = diffSecs % 60;
                
                // Format: giờ:phút:giây (đếm ngược realtime)
                var hh = hours < 10 ? '0' + hours : '' + hours;
                var mm = mins < 10 ? '0' + mins : '' + mins;
                var ss = secs < 10 ? '0' + secs : '' + secs;
                var timeDisplay = start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + hh + ':' + mm + ':' + ss;
                
                // Kiểm tra locked - cần table object để gọi isTableLocked
                // Dùng cachedTables để lấy table object
                var isLocked = false;
                var tableId = card.getAttribute('data-id');
                if (tableId && cachedTables) {
                    for (var j = 0; j < cachedTables.length; j++) {
                        if (cachedTables[j].id === tableId) {
                            if (typeof isTableLocked === 'function') {
                                isLocked = isTableLocked(cachedTables[j]);
                            } else {
                                isLocked = diffSecs >= (TABLE_LOCK_HOURS || 5) * 3600;
                            }
                            break;
                        }
                    }
                }
                
                var timeSpan = card.querySelector('.table-time');
                if (timeSpan) timeSpan.innerHTML = (isLocked ? '🔒 ' : '⏱️ ') + timeDisplay;
                
                var nameSpan = card.querySelector('.table-name');
                if (nameSpan) {
                    // Cập nhật icon lock trên tên nếu cần
                    var nameText = nameSpan.textContent.replace(/ 🔒$/, '');
                    nameSpan.innerHTML = nameText + (isLocked ? ' 🔒' : '');
                }
                
                // Cập nhật class locked
                if (isLocked) {
                    card.classList.add('table-locked');
                } else {
                    card.classList.remove('table-locked');
                }
            }
        }
        
        // Cập nhật thời gian recent toast
        _updateRecentToastTimes();
    }, 1000); // 1 giây - realtime
}

function stopTableTimer() {
    if (_tableTimerId) {
        clearInterval(_tableTimerId);
        _tableTimerId = null;
    }
}

// FIX: renderTables luôn lấy data mới nhất từ memoryCache/IndexedDB
// Không dùng cachedTables cũ vì có thể đã thay đổi sau DB.create/update
function renderTables() {
    return DB.getAll('tables').then(function(tables) {
        cachedTables = tables;
        tablesCacheTime = Date.now();
        updateTablesDiff(tables);
        // Bắt đầu timer cập nhật thời gian nếu đang ở tab tables
        if (currentTab === 'tables' && typeof startTableTimer === 'function') {
            startTableTimer();
        }
    });
}
