// realtime-pos.js - Realtime subscriptions RÚT GỌN cho POS
// Chỉ subscribe các collection POS cần: tables, customers, menu, menu_categories, transactions
// Bao gồm các hàm render tables, updateRecentToast, timer
// ES5, tương thích Android 6, iOS 12

var _realtimeTimers = {};
var _tableTimerId = null;
// P0: Cache DOM references cho timer - tránh querySelectorAll mỗi giây
var _tableCardCache = {};
var _tableCardCacheDirty = false;

function _debounceRealtime(key, fn, delay) {
    delay = delay || 100;
    if (_realtimeTimers[key]) clearTimeout(_realtimeTimers[key]);
    _realtimeTimers[key] = setTimeout(function() {
        _realtimeTimers[key] = null;
        fn();
    }, delay);
}

function _renderNow(key, fn) {
    if (_realtimeTimers[key]) clearTimeout(_realtimeTimers[key]);
    _realtimeTimers[key] = null;
    fn();
}

// ========== TOGGLE RECENT TOAST (thu gọn / mở rộng) ==========
function toggleRecentToast() {
    var container = document.getElementById('recentToast');
    if (!container) return;
    container.classList.toggle('collapsed');
    var toggleIcon = document.getElementById('recentToastToggle');
    if (toggleIcon) {
        toggleIcon.textContent = container.classList.contains('collapsed') ? '▼' : '▲';
    }
    // Lưu trạng thái vào localStorage
    try {
        localStorage.setItem('recentToastCollapsed', container.classList.contains('collapsed') ? '1' : '0');
    } catch(e) {}
}

// Khôi phục trạng thái recentToast từ localStorage
function restoreRecentToastState() {
    var container = document.getElementById('recentToast');
    if (!container) return;
    try {
        var collapsed = localStorage.getItem('recentToastCollapsed');
        if (collapsed === '1') {
            container.classList.add('collapsed');
            var toggleIcon = document.getElementById('recentToastToggle');
            if (toggleIcon) toggleIcon.textContent = '▼';
        }
    } catch(e) {}
}

// ========== UPDATE RECENT TOAST ==========
function updateRecentToast() {
    var now = new Date();
    var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    DB.getTransactionsByDate(todayStr).then(function(transactions) {
        // FIX: Hiển thị cả giao dịch hủy (refund) trong recentToast
        // Chỉ lọc bỏ các transaction bị đánh dấu trùng lặp tự động (có note chứa 'Tự động')
        var validTx = transactions.filter(function(tx) {
            // Giữ lại giao dịch refunded do người dùng chủ động hủy
            // Chỉ lọc bỏ nếu refunded và có note 'Tự động đánh dấu trùng lặp'
            if (tx.refunded && tx.note && tx.note.indexOf('Tự động') !== -1) {
                return false;
            }
            return true;
        });
        validTx.sort(function(a, b) {
            return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
        });
        var recent = validTx.slice(0, 5); // Tăng lên 5 để có chỗ cho cả giao dịch hủy
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
            
            // Xác định icon chính dựa trên loại giao dịch
            var mainIcon = '';
            var labelSuffix = '';
            if (tx.refunded) {
                mainIcon = '↩️';
            } else if (tx.type === 'debt_payment') {
                mainIcon = tx.paymentMethod === 'debt' ? '📝' : '💢';
            } else if (tx.type === 'credit') {
                mainIcon = '💰';
            } else if (tx.tableName) {
                mainIcon = '🍽️';
                labelSuffix = (tx.customer && tx.customer.name) ? tx.customer.name : tx.tableName;
            } else if (tx.type === 'takeaway') {
                mainIcon = '🛵';
            } else if (tx.type === 'grab') {
                mainIcon = '🚕';
            } else {
                mainIcon = '🍽️';
            }
            
            // Icon phương thức thanh toán (nếu không phải refund)
            var methodIcon = '';
            if (!tx.refunded) {
                if (tx.paymentMethod === 'cash') methodIcon = '💰';
                else if (tx.paymentMethod === 'transfer') methodIcon = '💳';
                else if (tx.paymentMethod === 'debt') methodIcon = '📝';
                else if (tx.paymentMethod === 'grab') methodIcon = '🚕';
                else methodIcon = '💵';
            }
            
            // Đếm tổng số món
            var totalItems = 0;
            if (tx.items && tx.items.length) {
                for (var j = 0; j < tx.items.length; j++) totalItems += tx.items[j].qty;
            }
            var itemInfo = totalItems > 0 ? totalItems + ' món' : '';
            
            var staffHtml = tx.createdByName ? ' <span class="toast-staff">👤 ' + escapeHtml(tx.createdByName) + '</span>' : '';
            
            // Gom các phần tử lại: icon + nhãn + số món + staff
            var infoParts = [];
            infoParts.push(mainIcon);
            if (labelSuffix) infoParts.push(labelSuffix);
            if (itemInfo) infoParts.push(itemInfo);
            if (methodIcon && methodIcon !== mainIcon) infoParts.push(methodIcon);
            var infoText = infoParts.join(' ');
            
            html += '<div class="recent-toast-item" onclick="showTransactionDetail(\'' + tx.id + '\')" data-tx-time="' + txTime + '">' +
                '<span class="toast-time">' + timeText + '</span>' +
                '<span class="toast-info">' + infoText + staffHtml + '</span>' +
                '<span class="toast-amount">' + formatMoney(tx.amount) + '</span>' +
            '</div>';
        }
        container.innerHTML = html;
    });
}

// ========== TABLE RENDERING HELPERS ==========
function _shortenName(name, maxLen) {
    maxLen = maxLen || 15;
    if (name.length <= maxLen) return name;
    return name.substring(0, maxLen - 1) + '…';
}

function _renderRecentAddsHtml(recentAdds) {
    if (!recentAdds || !recentAdds.length) return '';
    var html = '<div class="table-recent-adds">';
    var startIdx = Math.max(0, recentAdds.length - 2);
    for (var i = startIdx; i < recentAdds.length; i++) {
        var entry = recentAdds[i];
        var d = new Date(entry.time);
        var timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        var itemsStr = '';
        if (entry.items && entry.items.length) {
            var itemStart = Math.max(0, entry.items.length - 2);
            for (var j = itemStart; j < entry.items.length; j++) {
                var it = entry.items[j];
                if (j > itemStart) itemsStr += ', ';
                itemsStr += _shortenName(it.name, 12) + (it.qty > 1 ? ' x' + it.qty : '');
            }
        }
        html += '<span class="recent-add-entry" title="' + escapeHtml(itemsStr) + '"><span class="recent-add-time">' + timeStr + '</span> ' + escapeHtml(itemsStr) + '</span>';
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
        if (typeof isTableLocked === 'function') {
            isLocked = isTableLocked(table);
        } else {
            isLocked = diffMins >= ((window.shopConfig && window.shopConfig.tableLockHours) || 5) * 60;
        }
    }
    
    var displayName = table.customerName ? escapeHtml(table.customerName) : escapeHtml(table.name);
    
    var div = document.createElement('div');
    var roleClass = table.createdByRole === 'admin' ? ' table-admin-created' : (table.createdByRole === 'staff' ? ' table-staff-created' : '');
    div.className = 'table-card' + (isLocked ? ' table-locked' : '') + roleClass;
    div.setAttribute('data-id', table.id);
    div.setAttribute('data-start-time', table.startTime || '');
    div.onclick = function(id) { return function() { showTableDetail(id); }; }(table.id);
    
    // FIX: Luôn hiển thị nút Thêm món, kể cả khi bàn chưa có startTime
    // Nút thanh toán chỉ hiện khi bàn có items
    var actionBtnsHtml = '';
    var hasItems = itemCount > 0;
    
    // Nếu bàn bị khóa: chỉ ẩn nút Thêm món, vẫn hiện In + Tiền mặt + Chuyển khoản
    if (isLocked) {
        // Khi khóa: chỉ hiện nút thanh toán nếu có items
        if (hasItems) {
            actionBtnsHtml +=
                '<span class="table-act-btn table-act-print" onclick="event.stopPropagation(); doPrintThermal(\'' + table.id + '\')" title="In hóa đơn nhiệt">🖨️</span>' +
                '<span class="table-act-btn table-act-cash" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'cash\')" title="Tiền mặt">💵 TM</span>' +
                '<span class="table-act-btn table-act-transfer" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'transfer\')" title="Chuyển khoản">💳 CK</span>';
        }
    } else {
        // Không khóa: hiện Thêm món + In + thanh toán (nếu có items)
        actionBtnsHtml +=
            '<span class="table-act-btn table-act-add" onclick="event.stopPropagation(); openAddMenuForTable(\'' + table.id + '\')" title="Thêm món">➕</span>';
        if (hasItems) {
            actionBtnsHtml +=
                '<span class="table-act-btn table-act-print" onclick="event.stopPropagation(); doPrintThermal(\'' + table.id + '\')" title="In hóa đơn nhiệt">🖨️</span>' +
                '<span class="table-act-btn table-act-cash" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'cash\')" title="Tiền mặt">💵 TM</span>' +
                '<span class="table-act-btn table-act-transfer" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'transfer\')" title="Chuyển khoản">💳 CK</span>';
        }
    }
    
    // Bọc trong table-act-row nếu có action buttons
    if (actionBtnsHtml) {
        actionBtnsHtml = '<span class="table-act-row">' + actionBtnsHtml + '</span>';
    }
    
    var creatorHtml = table.createdByName ? '<span class="table-creator">👤 ' + escapeHtml(table.createdByName) + '</span>' : '';
    
    div.innerHTML =
        '<div class="table-header">' +
            '<span class="table-name" onclick="event.stopPropagation(); showCustomerSelectorForTable(\'' + table.id + '\')" style="cursor:pointer;">' + displayName + (isLocked ? ' 🔒' : '') + '</span>' +
            '<span class="table-time">' + (isLocked ? '🔒 ' : '⏱️ ') + timeDisplay + '</span>' +
        '</div>' +
        '<div class="table-stats">' +
            '<span class="table-item-count">📦 ' + itemCount + ' món</span>' +
            '<span class="table-total">' + formatMoney(table.total) + '</span>' +
            creatorHtml +
        '</div>' +
        '<div class="table-actions">' +
            _renderRecentAddsHtml(table.recentAdds) +
            actionBtnsHtml +
        '</div>';
    return div;
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
        if (typeof isTableLocked === 'function') {
            isLocked = isTableLocked(table);
        } else {
            isLocked = diffMins >= ((window.shopConfig && window.shopConfig.tableLockHours) || 5) * 60;
        }
    }
    
    card.setAttribute('data-start-time', table.startTime || '');
    
    // Cập nhật class role (admin/staff) trên card
    card.classList.remove('table-admin-created', 'table-staff-created');
    if (table.createdByRole === 'admin') {
        card.classList.add('table-admin-created');
    } else if (table.createdByRole === 'staff') {
        card.classList.add('table-staff-created');
    }
    
    var displayName = table.customerName ? escapeHtml(table.customerName) : escapeHtml(table.name);
    
    var nameSpan = card.querySelector('.table-name');
    if (nameSpan) nameSpan.innerHTML = displayName + (isLocked ? ' 🔒' : '');
    
    var timeSpan = card.querySelector('.table-time');
    if (timeSpan) timeSpan.innerHTML = (isLocked ? '🔒 ' : '⏱️ ') + timeDisplay;
    
    var itemCountSpan = card.querySelector('.table-item-count');
    if (itemCountSpan) itemCountSpan.innerHTML = '📦 ' + itemCount + ' món';
    
    var totalSpan = card.querySelector('.table-total');
    if (totalSpan) totalSpan.innerHTML = formatMoney(table.total);
    
    // Cập nhật creator
    var creatorSpan = card.querySelector('.table-creator');
    if (creatorSpan) {
        creatorSpan.innerHTML = table.createdByName ? '👤 ' + escapeHtml(table.createdByName) : '';
    }
    
    // FIX: Cập nhật action buttons động
    var actionsEl = card.querySelector('.table-actions');
    if (actionsEl) {
        // Cập nhật recent adds
        var recentAddsEl = actionsEl.querySelector('.table-recent-adds');
        var newRecentHtml = _renderRecentAddsHtml(table.recentAdds);
        if (recentAddsEl) {
            recentAddsEl.outerHTML = newRecentHtml;
        } else if (newRecentHtml) {
            actionsEl.insertAdjacentHTML('afterbegin', newRecentHtml);
        }
        
        // Cập nhật action buttons - xóa cũ và tạo mới
        var oldActRow = actionsEl.querySelector('.table-act-row');
        if (oldActRow) {
            oldActRow.remove();
        }
        
        var hasItems = itemCount > 0;
        var newActionBtns = '';
        
        // Nếu bàn bị khóa: chỉ ẩn nút Thêm món, vẫn hiện In + Tiền mặt + Chuyển khoản
        if (isLocked) {
            // Khi khóa: chỉ hiện nút thanh toán nếu có items
            if (hasItems) {
                newActionBtns +=
                    '<span class="table-act-btn table-act-print" onclick="event.stopPropagation(); doPrintThermal(\'' + table.id + '\')" title="In hóa đơn nhiệt">🖨️</span>' +
                    '<span class="table-act-btn table-act-cash" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'cash\')" title="Tiền mặt">💵 TM</span>' +
                    '<span class="table-act-btn table-act-transfer" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'transfer\')" title="Chuyển khoản">💳 CK</span>';
            }
        } else {
            // Không khóa: hiện Thêm món + In + thanh toán (nếu có items)
            newActionBtns +=
                '<span class="table-act-btn table-act-add" onclick="event.stopPropagation(); openAddMenuForTable(\'' + table.id + '\')" title="Thêm món">➕</span>';
            if (hasItems) {
                newActionBtns +=
                    '<span class="table-act-btn table-act-print" onclick="event.stopPropagation(); doPrintThermal(\'' + table.id + '\')" title="In hóa đơn nhiệt">🖨️</span>' +
                    '<span class="table-act-btn table-act-cash" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'cash\')" title="Tiền mặt">💵 TM</span>' +
                    '<span class="table-act-btn table-act-transfer" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'transfer\')" title="Chuyển khoản">💳 CK</span>';
            }
        }
        
        if (newActionBtns) {
            actionsEl.insertAdjacentHTML('beforeend', '<span class="table-act-row">' + newActionBtns + '</span>');
        }
    }
    
    if (isLocked) {
        card.classList.add('table-locked');
    } else {
        card.classList.remove('table-locked');
    }
}

// ========== UPDATE TABLES DIFF (optimized) ==========
function updateTablesDiff(newTables) {
    // FIX: Hiển thị TẤT CẢ bàn, kể cả bàn trống (không có items)
    // Bàn trống vẫn cần hiển thị để người dùng có thể thêm món
    var activeTables = newTables || [];
    var grid = document.getElementById('tablesGrid');
    if (!grid) return;
    
    // Đảm bảo item "Tạo đơn" luôn ở đầu grid
    var createBtn = grid.querySelector('.table-create-btn');
    if (!createBtn) {
        createBtn = document.createElement('div');
        createBtn.className = 'table-card table-create-btn';
        createBtn.innerHTML = '<div class="table-create-inner"><span class="table-create-icon">➕</span><span class="table-create-label">Tạo đơn</span></div>';
        createBtn.onclick = function() { openCreateOrderModal(); };
        grid.insertBefore(createBtn, grid.firstChild);
    }
    
    var existingCards = grid.querySelectorAll('.table-card:not(.table-create-btn)');
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
            // P1: Đánh dấu cache dirty
            _tableCardCacheDirty = true;
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
            // P1: Đánh dấu cache dirty
            _tableCardCacheDirty = true;
        }
    }
    if (fragment) grid.appendChild(fragment);
}

// ========== RENDER TABLES ==========
function renderTables() {
    return DB.getAll('tables').then(function(tables) {
        cachedTables = tables;
        tablesCacheTime = Date.now();
        updateTablesDiff(tables);
        if (currentTab === 'tables' && typeof startTableTimer === 'function') {
            startTableTimer();
        }
    });
}

// ========== TABLE TIMER (OPTIMIZED) ==========
// P0: Chỉ chạy khi ở tab Bàn - kiểm tra currentTab
// P1: Cache DOM references - không querySelectorAll mỗi giây
// P2: Cache DOM elements trong card - tránh querySelector mỗi giây
// P3: Chỉ update giây khi diff < 1 phút, nếu >= 1 phút thì update mỗi phút
var _tableCardElCache = {}; // { id: { timeSpan, nameSpan, card } }

function startTableTimer() {
    if (_tableTimerId) return;
    _tableTimerId = setInterval(function() {
        // P0: Bỏ qua nếu không ở tab Bàn
        if (currentTab !== 'tables') return;
        
        var now = Date.now();
        var rebuildCache = _tableCardCacheDirty;
        
        // P1: Nếu cache dirty, rebuild cache từ DOM
        if (_tableCardCacheDirty) {
            _tableCardCache = {};
            _tableCardElCache = {};
            var grid = document.getElementById('tablesGrid');
            if (grid) {
                var cards = grid.querySelectorAll('.table-card:not(.table-create-btn)');
                for (var i = 0; i < cards.length; i++) {
                    var id = cards[i].getAttribute('data-id');
                    if (id) {
                        _tableCardCache[id] = cards[i];
                        // P2: Cache DOM elements ngay khi rebuild
                        _tableCardElCache[id] = {
                            card: cards[i],
                            timeSpan: cards[i].querySelector('.table-time'),
                            nameSpan: cards[i].querySelector('.table-name')
                        };
                    }
                }
            }
            _tableCardCacheDirty = false;
        }
        
        for (var id in _tableCardCache) {
            if (!_tableCardCache.hasOwnProperty(id)) continue;
            var card = _tableCardCache[id];
            if (!card || !card.parentNode) {
                delete _tableCardCache[id];
                delete _tableCardElCache[id];
                continue;
            }
            
            var startTime = card.getAttribute('data-start-time');
            if (!startTime) continue;
            
            var start = new Date(startTime);
            var diffSecs = Math.floor((now - start) / 1000);
            var hours = Math.floor(diffSecs / 3600);
            var mins = Math.floor((diffSecs % 3600) / 60);
            var secs = diffSecs % 60;
            
            // P3: Chỉ update giây khi bàn mới hoạt động < 1 phút
            // Nếu >= 1 phút, chỉ update mỗi 60 giây (bỏ qua giây)
            var skipSeconds = (diffSecs >= 60);
            if (skipSeconds && secs !== 0) continue;
            
            var hh = hours < 10 ? '0' + hours : '' + hours;
            var mm = mins < 10 ? '0' + mins : '' + mins;
            var ss = secs < 10 ? '0' + secs : '' + secs;
            var timeDisplay = start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' - ' + hh + ':' + mm + (skipSeconds ? '' : ':' + ss);
            
            var isLocked = false;
            if (cachedTables) {
                for (var j = 0; j < cachedTables.length; j++) {
                    if (cachedTables[j].id === id) {
                        if (typeof isTableLocked === 'function') {
                            isLocked = isTableLocked(cachedTables[j]);
                        } else {
                            isLocked = diffSecs >= ((window.shopConfig && window.shopConfig.tableLockHours) || 5) * 3600;
                        }
                        break;
                    }
                }
            }
            
            // P2: Dùng cached DOM elements, không querySelector
            var el = _tableCardElCache[id];
            if (!el) {
                // Fallback: tạo cache entry mới
                el = {
                    card: card,
                    timeSpan: card.querySelector('.table-time'),
                    nameSpan: card.querySelector('.table-name')
                };
                _tableCardElCache[id] = el;
            }
            
            if (el.timeSpan) {
                // Dùng textContent thay innerHTML để nhanh hơn
                el.timeSpan.textContent = (isLocked ? '🔒 ' : '⏱️ ') + timeDisplay;
            }
            
            if (el.nameSpan) {
                var nameText = el.nameSpan.textContent.replace(/ 🔒$/, '');
                el.nameSpan.textContent = nameText + (isLocked ? ' 🔒' : '');
            }
            
            if (isLocked) {
                card.classList.add('table-locked');
            } else {
                card.classList.remove('table-locked');
            }
        }
        _updateRecentToastTimes();
    }, 1000);
}

function stopTableTimer() {
    if (_tableTimerId) {
        clearInterval(_tableTimerId);
        _tableTimerId = null;
    }
}

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

// ========== INIT REALTIME (RÚT GỌN) ==========
function initRealtime() {
    // ============================================================
    // TABLES
    // ============================================================
    // Subscribe cũ: cập nhật cachedTables (KHÔNG gọi loadPosCashData để tránh double execution với event bus)
    DB.subscribe('tables', function(newTables) {
        if (!newTables) return;
        cachedTables = newTables;
        tablesCacheTime = Date.now();
        // Fallback: nếu đang ở tab tables, re-render toàn bộ (dự phòng)
        if (currentTab !== 'tables') return;
        _renderNow('tables_render', function() {
            updateTablesDiff(newTables);
            if (typeof startTableTimer === 'function') {
                startTableTimer();
            }
        });
    });
    
    // NÂNG CẤP: Event Bus handler cho tables - xử lý targeted updates
    DB.on('tables:*', function(event) {
        if (!event || !event.data) return;
        var item = event.data.item;
        if (!item) return;
        if (currentTab !== 'tables') return;
        var grid = document.getElementById('tablesGrid');
        if (!grid) return;
        if (event.type === 'added') {
            var existingCard = grid.querySelector('.table-card[data-id="' + item.id + '"]');
            if (!existingCard) {
                grid.appendChild(createTableCard(item));
                _tableCardCacheDirty = true;
            }
        } else if (event.type === 'changed') {
            var existingCard = grid.querySelector('.table-card[data-id="' + item.id + '"]');
            if (existingCard) {
                updateTableCard(existingCard, item);
            } else {
                grid.appendChild(createTableCard(item));
                _tableCardCacheDirty = true;
            }
        } else if (event.type === 'removed') {
            var existingCard = grid.querySelector('.table-card[data-id="' + item.id + '"]');
            if (existingCard && existingCard.parentNode) {
                existingCard.remove();
                _tableCardCacheDirty = true;
            }
        }
    });
    
    // NÂNG CẤP: Khi fullSync hoàn thành, re-render toàn bộ tables + cập nhật pos-cash-info
    DB.on('tables:synced', function() {
        DB.getAll('tables').then(function(allTables) {
            cachedTables = allTables;
            tablesCacheTime = Date.now();
            // Cập nhật pos-cash-info khi tables thay đổi (clear bàn, gộp bàn...)
            if (typeof loadPosCashData === 'function') {
                loadPosCashData();
            }
            if (currentTab !== 'tables') return;
            updateTablesDiff(allTables);
            if (typeof startTableTimer === 'function') startTableTimer();
        });
    });

    // ============================================================
    // CUSTOMERS
    // ============================================================
    // Subscribe cũ: cập nhật biến customers
    DB.subscribe('customers', function(data) {
        if (!data) return;
        _debounceRealtime('customers', function() {
            DB.getAll('customers').then(function(list) {
                customers = list;
                window.customers = customers;
            });
        }, 200);
    });
    // NÂNG CẤP: Event Bus handler cho customers
    DB.on('customers:*', function(event) {
        if (!event || !event.data) return;
        if (currentTab !== 'customers') return;
        _debounceRealtime('customers_ui', function() {
            DB.getAll('customers').then(function(list) {
                customers = list;
                window.customers = customers;
                renderCustomerList();
            });
        }, 100);
    });
    // NÂNG CẤP: Khi fullSync hoàn thành, re-render customers
    DB.on('customers:synced', function() {
        if (currentTab !== 'customers') return;
        DB.getAll('customers').then(function(list) {
            customers = list;
            window.customers = customers;
            renderCustomerList();
        });
    });

    // ============================================================
    // MENU (polling 60s)
    // ============================================================
    // Subscribe cũ: cập nhật menuItems
    DB.subscribeWithPolling('menu', function(data) {
        if (!data) return;
        _debounceRealtime('menu', function() {
            DB.getAll('menu').then(function(list) {
                menuItems = list;
                menuItems.sort(function(a, b) {
                    var orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 9999;
                    var orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 9999;
                    return orderA - orderB;
                });
                window.menuItems = menuItems;
            });
        }, 200);
    }, 60);
    // NÂNG CẤP: Event Bus handler cho menu
    DB.on('menu:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('menu_ui', function() {
            DB.getAll('menu').then(function(list) {
                menuItems = list;
                menuItems.sort(function(a, b) {
                    var orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 9999;
                    var orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 9999;
                    return orderA - orderB;
                });
                window.menuItems = menuItems;
                // Cập nhật menu trong order modal nếu đang mở
                var orderModal = document.getElementById('orderModal');
                if (orderModal && orderModal.style.display === 'flex') {
                    renderMenuByCategory(currentMenuCategory);
                }
            });
        }, 100);
    });
    // NÂNG CẤP: Khi fullSync hoàn thành, re-render menu
    DB.on('menu:synced', function() {
        DB.getAll('menu').then(function(list) {
            menuItems = list;
            menuItems.sort(function(a, b) {
                var orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 9999;
                var orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 9999;
                return orderA - orderB;
            });
            window.menuItems = menuItems;
            var orderModal = document.getElementById('orderModal');
            if (orderModal && orderModal.style.display === 'flex') {
                renderMenuByCategory(currentMenuCategory);
            }
        });
    });

    // ============================================================
    // MENU CATEGORIES (polling 60s)
    // ============================================================
    // Subscribe cũ: cập nhật menuCategories
    DB.subscribeWithPolling('menu_categories', function(data) {
        if (!data) return;
        _debounceRealtime('menu_categories', function() {
            DB.getAll('menu_categories').then(function(list) {
                menuCategories = list;
            });
        }, 200);
    }, 60);
    // NÂNG CẤP: Event Bus handler cho menu_categories
    DB.on('menu_categories:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('menu_categories_ui', function() {
            DB.getAll('menu_categories').then(function(list) {
                menuCategories = list;
                // Cập nhật danh mục trong order modal nếu đang mở
                var orderModal = document.getElementById('orderModal');
                if (orderModal && orderModal.style.display === 'flex') {
                    renderOrderCategoriesColumn();
                }
            });
        }, 100);
    });

    // ============================================================
    // COST CATEGORIES
    // ============================================================
    // Subscribe cũ: cập nhật costCategories
    DB.subscribe('cost_categories', function(data) {
        if (typeof costCategories !== 'undefined') {
            costCategories = data || [];
        }
        _debounceRealtime('cost_categories', function() {
            if (typeof loadExpenseData === 'function') {
                loadExpenseData().then(function() {
                    if (currentTab === 'cost') {
                        if (typeof renderTodayExpenses === 'function') renderTodayExpenses();
                        if (typeof renderMonthExpenseTotal === 'function') renderMonthExpenseTotal();
                    } else if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
                        managerApplyFilter();
                    }
                });
            }
        }, 100);
    });
    // NÂNG CẤP: Event Bus handler cho cost_categories
    DB.on('cost_categories:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('cost_categories_ui', function() {
            if (typeof loadExpenseData === 'function') {
                loadExpenseData().then(function() {
                    if (currentTab === 'cost') {
                        if (typeof renderTodayExpenses === 'function') renderTodayExpenses();
                        if (typeof renderMonthExpenseTotal === 'function') renderMonthExpenseTotal();
                    } else if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
                        managerApplyFilter();
                    }
                });
            }
        }, 100);
    });

    // ============================================================
    // COST TRANSACTIONS
    // ============================================================
    // Subscribe cũ: cập nhật costTransactions
    DB.subscribe('cost_transactions', function(data) {
        if (typeof costTransactions !== 'undefined') {
            costTransactions = data || [];
        }
        _debounceRealtime('cost_transactions', function() {
            if (typeof loadExpenseData === 'function') {
                loadExpenseData().then(function() {
                    if (currentTab === 'cost') {
                        if (typeof renderTodayExpenses === 'function') renderTodayExpenses();
                        if (typeof renderMonthExpenseTotal === 'function') renderMonthExpenseTotal();
                    } else if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
                        managerApplyFilter();
                    }
                });
            }
        }, 100);
    });
    // NÂNG CẤP: Event Bus handler cho cost_transactions
    DB.on('cost_transactions:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('cost_transactions_ui', function() {
            if (typeof loadExpenseData === 'function') {
                loadExpenseData().then(function() {
                    if (currentTab === 'cost') {
                        if (typeof renderTodayExpenses === 'function') renderTodayExpenses();
                        if (typeof renderMonthExpenseTotal === 'function') renderMonthExpenseTotal();
                    } else if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
                        managerApplyFilter();
                    }
                });
            }
        }, 100);
    });

    // ============================================================
    // MANAGER CASH PICKUPS
    // ============================================================
    // Subscribe cũ: cập nhật managerCashPickups
    DB.subscribe('manager_cash_pickups', function(data) {
        window.managerCashPickups = data || [];
        _debounceRealtime('manager_cash_pickups', function() {
            if (currentTab === 'report') {
                renderReport(currentReportDate);
            }
        }, 100);
    });
    // NÂNG CẤP: Event Bus handler cho manager_cash_pickups
    DB.on('manager_cash_pickups:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('manager_cash_pickups_ui', function() {
            if (currentTab === 'report') {
                renderReport(currentReportDate);
            }
        }, 100);
    });

    // ============================================================
    // DAILY BALANCES
    // ============================================================
    // Subscribe cũ: cập nhật daily_balances (KHÔNG gọi loadPosCashData để tránh double execution với event bus)
    DB.subscribe('daily_balances', function() {
        _debounceRealtime('daily_balances', function() {
            // daily_balances đã được xử lý bởi event bus bên dưới
        }, 200);
    });
    // NÂNG CẤP: Event Bus handler cho daily_balances
    DB.on('daily_balances:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('daily_balances_ui', function() {
            if (typeof loadPosCashData === 'function') {
                loadPosCashData();
            }
        }, 100);
    });

    // ============================================================
    // INGREDIENTS (polling 60s)
    // ============================================================
    // Subscribe cũ: cập nhật window.ingredients
    DB.subscribeWithPolling('ingredients', function(data) {
        if (!data) return;
        _debounceRealtime('ingredients', function() {
            DB.getAll('ingredients').then(function(list) {
                window.ingredients = list;
                if (typeof _invalidateLookups === 'function') _invalidateLookups();
            });
        }, 200);
    }, 60);
    // NÂNG CẤP: Event Bus handler cho ingredients
    DB.on('ingredients:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('ingredients_ui', function() {
            DB.getAll('ingredients').then(function(list) {
                window.ingredients = list;
                if (typeof _invalidateLookups === 'function') _invalidateLookups();
                if (currentTab === 'cost') {
                    if (typeof renderIngredientList === 'function') renderIngredientList();
                }
                if (currentTab === 'inventory') {
                    if (typeof renderInventoryIngredients === 'function') renderInventoryIngredients();
                }
            });
        }, 100);
    });

    // ============================================================
    // TRANSACTIONS
    // ============================================================
    // Subscribe cũ: cập nhật transactions cache (CHỈ updateRecentToast, không gọi loadPosCashData để tránh double execution)
    DB.subscribe('transactions', function() {
        _debounceRealtime('transactions', function() {
            updateRecentToast();
            if (currentTab === 'history') {
                renderHistoryByDate(currentHistoryDate);
            }
        }, 300);
    });
    // NÂNG CẤP: Event Bus handler cho transactions
    DB.on('transactions:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('transactions_ui', function() {
            updateRecentToast();
            if (typeof loadPosCashData === 'function') {
                loadPosCashData();
            }
            if (currentTab === 'history') {
                renderHistoryByDate(currentHistoryDate);
            }
        }, 200);
    });

    // ============================================================
    // INFO (shop config)
    // ============================================================
    // Subscribe cũ: cập nhật shopConfig
    DB.subscribe('info', function(data) {
        if (!data || data.length === 0) return;
        _debounceRealtime('info', function() {
            var infoItem = null;
            for (var i = 0; i < data.length; i++) {
                if (data[i].id === 'shop_config') {
                    infoItem = data[i];
                    break;
                }
            }
            if (!infoItem) return;
            var hasLockData = (infoItem.lockStartHour !== undefined ||
                               infoItem.lockEndHour !== undefined ||
                               infoItem.lockEndMinute !== undefined ||
                               infoItem.tableLockHours !== undefined ||
                               infoItem.lockPassword !== undefined);
            var oldConfig = window.shopConfig || {};
            window.shopConfig = {
                telegramBotToken: infoItem.telegramBotToken || oldConfig.telegramBotToken || '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                telegramChatId: infoItem.telegramChatId || oldConfig.telegramChatId || '6372876364',
                telegramShiftCloseToken: infoItem.telegramShiftCloseToken || oldConfig.telegramShiftCloseToken || '',
                telegramWarningToken: infoItem.telegramWarningToken || oldConfig.telegramWarningToken || '',
                telegramExpenseToken: infoItem.telegramExpenseToken || oldConfig.telegramExpenseToken || '',
                lockPassword: hasLockData && infoItem.lockPassword ? infoItem.lockPassword : (oldConfig.lockPassword || '28122020'),
                lockStartHour: hasLockData && infoItem.lockStartHour !== undefined ? infoItem.lockStartHour : (oldConfig.lockStartHour !== undefined ? oldConfig.lockStartHour : 22),
                lockEndHour: hasLockData && infoItem.lockEndHour !== undefined ? infoItem.lockEndHour : (oldConfig.lockEndHour !== undefined ? oldConfig.lockEndHour : 5),
                lockEndMinute: hasLockData && infoItem.lockEndMinute !== undefined ? infoItem.lockEndMinute : (oldConfig.lockEndMinute !== undefined ? oldConfig.lockEndMinute : 30),
                tableLockHours: hasLockData && infoItem.tableLockHours !== undefined ? infoItem.tableLockHours : (oldConfig.tableLockHours !== undefined ? oldConfig.tableLockHours : 5)
            };
            if (infoItem.name) {
                window.shopInfo = window.shopInfo || {};
                window.shopInfo.name = infoItem.name;
                var shopNameEl = document.getElementById('shopNameHeader');
                if (shopNameEl) shopNameEl.textContent = infoItem.name;
            }
        }, 200);
    });
    // NÂNG CẤP: Event Bus handler cho info
    DB.on('info:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('info_ui', function() {
            DB.getAll('info').then(function(data) {
                if (!data || data.length === 0) return;
                var infoItem = null;
                for (var i = 0; i < data.length; i++) {
                    if (data[i].id === 'shop_config') {
                        infoItem = data[i];
                        break;
                    }
                }
                if (!infoItem) return;
                var hasLockData = (infoItem.lockStartHour !== undefined ||
                                   infoItem.lockEndHour !== undefined ||
                                   infoItem.lockEndMinute !== undefined ||
                                   infoItem.tableLockHours !== undefined ||
                                   infoItem.lockPassword !== undefined);
                var oldConfig = window.shopConfig || {};
                window.shopConfig = {
                    telegramBotToken: infoItem.telegramBotToken || oldConfig.telegramBotToken || '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                    telegramChatId: infoItem.telegramChatId || oldConfig.telegramChatId || '6372876364',
                    telegramShiftCloseToken: infoItem.telegramShiftCloseToken || oldConfig.telegramShiftCloseToken || '',
                    telegramWarningToken: infoItem.telegramWarningToken || oldConfig.telegramWarningToken || '',
                    telegramExpenseToken: infoItem.telegramExpenseToken || oldConfig.telegramExpenseToken || '',
                    lockPassword: hasLockData && infoItem.lockPassword ? infoItem.lockPassword : (oldConfig.lockPassword || '28122020'),
                    lockStartHour: hasLockData && infoItem.lockStartHour !== undefined ? infoItem.lockStartHour : (oldConfig.lockStartHour !== undefined ? oldConfig.lockStartHour : 22),
                    lockEndHour: hasLockData && infoItem.lockEndHour !== undefined ? infoItem.lockEndHour : (oldConfig.lockEndHour !== undefined ? oldConfig.lockEndHour : 5),
                    lockEndMinute: hasLockData && infoItem.lockEndMinute !== undefined ? infoItem.lockEndMinute : (oldConfig.lockEndMinute !== undefined ? oldConfig.lockEndMinute : 30),
                    tableLockHours: hasLockData && infoItem.tableLockHours !== undefined ? infoItem.tableLockHours : (oldConfig.tableLockHours !== undefined ? oldConfig.tableLockHours : 5)
                };
                if (infoItem.name) {
                    window.shopInfo = window.shopInfo || {};
                    window.shopInfo.name = infoItem.name;
                    var shopNameEl = document.getElementById('shopNameHeader');
                    if (shopNameEl) shopNameEl.textContent = infoItem.name;
                }
            });
        }, 100);
    });

    // ============================================================
    // MESSAGES (polling 30s)
    // ============================================================
    // Subscribe cũ: cập nhật messages
    DB.subscribeWithPolling('messages', function(data) {
        if (!data) return;
        _debounceRealtime('messages', function() {
            if (typeof updateChatBadge === 'function') {
                updateChatBadge();
            }
            if (_chatPopupVisible) {
                if (typeof renderChatMessages === 'function') {
                    renderChatMessages();
                }
            }
            if (typeof checkNewMessages === 'function') {
                checkNewMessages();
            }
        }, 200);
    }, 30);
    // NÂNG CẤP: Event Bus handler cho messages
    DB.on('messages:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('messages_ui', function() {
            if (typeof updateChatBadge === 'function') {
                updateChatBadge();
            }
            if (_chatPopupVisible) {
                if (typeof renderChatMessages === 'function') {
                    renderChatMessages();
                }
            }
            if (typeof checkNewMessages === 'function') {
                checkNewMessages();
            }
        }, 100);
    });

    // ============================================================
    // SYNCED HANDLERS: Khi fullSync hoàn tất, re-render toàn bộ UI
    // ============================================================

    // NÂNG CẤP: Khi fullSync menu_categories hoàn thành
    DB.on('menu_categories:synced', function() {
        DB.getAll('menu_categories').then(function(list) {
            menuCategories = list;
            var orderModal = document.getElementById('orderModal');
            if (orderModal && orderModal.style.display === 'flex') {
                renderOrderCategoriesColumn();
            }
        });
    });

    // NÂNG CẤP: Khi fullSync cost_categories hoàn thành
    DB.on('cost_categories:synced', function() {
        if (typeof loadExpenseData === 'function') {
            loadExpenseData().then(function() {
                if (currentTab === 'cost') {
                    if (typeof renderTodayExpenses === 'function') renderTodayExpenses();
                    if (typeof renderMonthExpenseTotal === 'function') renderMonthExpenseTotal();
                } else if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
                    managerApplyFilter();
                }
            });
        }
    });

    // NÂNG CẤP: Khi fullSync cost_transactions hoàn thành
    DB.on('cost_transactions:synced', function() {
        if (typeof loadExpenseData === 'function') {
            loadExpenseData().then(function() {
                if (currentTab === 'cost') {
                    if (typeof renderTodayExpenses === 'function') renderTodayExpenses();
                    if (typeof renderMonthExpenseTotal === 'function') renderMonthExpenseTotal();
                } else if (currentTab === 'manager' && typeof managerApplyFilter === 'function') {
                    managerApplyFilter();
                }
            });
        }
    });

    // NÂNG CẤP: Khi fullSync manager_cash_pickups hoàn thành
    DB.on('manager_cash_pickups:synced', function() {
        if (currentTab === 'report') {
            renderReport(currentReportDate);
        }
    });

    // NÂNG CẤP: Khi fullSync daily_balances hoàn thành
    DB.on('daily_balances:synced', function() {
        if (typeof loadPosCashData === 'function') {
            loadPosCashData();
        }
    });

    // NÂNG CẤP: Khi fullSync ingredients hoàn thành
    DB.on('ingredients:synced', function() {
        DB.getAll('ingredients').then(function(list) {
            window.ingredients = list;
            if (typeof _invalidateLookups === 'function') _invalidateLookups();
            if (currentTab === 'cost') {
                if (typeof renderIngredientList === 'function') renderIngredientList();
            }
            if (currentTab === 'inventory') {
                if (typeof renderInventoryIngredients === 'function') renderInventoryIngredients();
            }
        });
    });

    // NÂNG CẤP: Khi fullSync transactions hoàn thành
    DB.on('transactions:synced', function() {
        updateRecentToast();
        if (typeof loadPosCashData === 'function') {
            loadPosCashData();
        }
        if (currentTab === 'history') {
            renderHistoryByDate(currentHistoryDate);
        }
    });

    // NÂNG CẤP: Khi fullSync info hoàn thành
    DB.on('info:synced', function() {
        DB.getAll('info').then(function(data) {
            if (!data || data.length === 0) return;
            var infoItem = null;
            for (var i = 0; i < data.length; i++) {
                if (data[i].id === 'shop_config') {
                    infoItem = data[i];
                    break;
                }
            }
            if (!infoItem) return;
            var hasLockData = (infoItem.lockStartHour !== undefined ||
                               infoItem.lockEndHour !== undefined ||
                               infoItem.lockEndMinute !== undefined ||
                               infoItem.tableLockHours !== undefined ||
                               infoItem.lockPassword !== undefined);
            var oldConfig = window.shopConfig || {};
            window.shopConfig = {
                telegramBotToken: infoItem.telegramBotToken || oldConfig.telegramBotToken || '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                telegramChatId: infoItem.telegramChatId || oldConfig.telegramChatId || '6372876364',
                telegramShiftCloseToken: infoItem.telegramShiftCloseToken || oldConfig.telegramShiftCloseToken || '',
                telegramWarningToken: infoItem.telegramWarningToken || oldConfig.telegramWarningToken || '',
                telegramExpenseToken: infoItem.telegramExpenseToken || oldConfig.telegramExpenseToken || '',
                lockPassword: hasLockData && infoItem.lockPassword ? infoItem.lockPassword : (oldConfig.lockPassword || '28122020'),
                lockStartHour: hasLockData && infoItem.lockStartHour !== undefined ? infoItem.lockStartHour : (oldConfig.lockStartHour !== undefined ? oldConfig.lockStartHour : 22),
                lockEndHour: hasLockData && infoItem.lockEndHour !== undefined ? infoItem.lockEndHour : (oldConfig.lockEndHour !== undefined ? oldConfig.lockEndHour : 5),
                lockEndMinute: hasLockData && infoItem.lockEndMinute !== undefined ? infoItem.lockEndMinute : (oldConfig.lockEndMinute !== undefined ? oldConfig.lockEndMinute : 30),
                tableLockHours: hasLockData && infoItem.tableLockHours !== undefined ? infoItem.tableLockHours : (oldConfig.tableLockHours !== undefined ? oldConfig.tableLockHours : 5)
            };
            if (infoItem.name) {
                window.shopInfo = window.shopInfo || {};
                window.shopInfo.name = infoItem.name;
                var shopNameEl = document.getElementById('shopNameHeader');
                if (shopNameEl) shopNameEl.textContent = infoItem.name;
            }
        });
    });

    // NÂNG CẤP: Khi fullSync messages hoàn thành
    DB.on('messages:synced', function() {
        if (typeof updateChatBadge === 'function') {
            updateChatBadge();
        }
        if (_chatPopupVisible) {
            if (typeof renderChatMessages === 'function') {
                renderChatMessages();
            }
        }
        if (typeof checkNewMessages === 'function') {
            checkNewMessages();
        }
    });

    // FIX: Gọi updateRecentToast() ngay khi khởi tạo để hiển thị 5 giao dịch gần nhất
    setTimeout(function() {
        updateRecentToast();
    }, 500);
}
