// realtime-pos.js - Realtime subscriptions RÚT GỌN cho POS
// Chỉ subscribe các collection POS cần: tables, customers, menu, menu_categories, transactions
// Bao gồm các hàm render tables, updateRecentToast, timer
// ES5, tương thích Android 6, iOS 12

var _realtimeTimers = {};
var _tableTimerId = null;
// P0: Cache DOM references cho timer - tránh querySelectorAll mỗi giây
var _tableCardCache = {};
var _tableCardCacheDirty = false;
// PHASE 4: Periodic cleanup cho table caches - tránh memory leak
var _tableCacheCleanupId = null;
var _TABLE_CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000; // 10 phút

function _startTableCacheCleanup() {
    if (_tableCacheCleanupId) return;
    _tableCacheCleanupId = setInterval(function() {
        var grid = document.getElementById('tablesGrid');
        if (!grid) return;
        var existingCards = grid.querySelectorAll('.table-card:not(.table-create-btn)');
        var existingIds = {};
        for (var i = 0; i < existingCards.length; i++) {
            existingIds[existingCards[i].getAttribute('data-id')] = true;
        }
        // Dọn _tableVersionCache - xóa entries không còn trong DOM
        var removed = 0;
        for (var id in _tableVersionCache) {
            if (_tableVersionCache.hasOwnProperty(id) && !existingIds[id]) {
                delete _tableVersionCache[id];
                removed++;
            }
        }
        // Dọn _tableCardCache và _tableCardElCache - xóa entries không còn trong DOM
        for (var id in _tableCardCache) {
            if (_tableCardCache.hasOwnProperty(id) && !existingIds[id]) {
                delete _tableCardCache[id];
                delete _tableCardElCache[id];
                removed++;
            }
        }
        if (removed > 0) {
            console.log('[Realtime] 🧹 Table cache cleanup: đã xóa ' + removed + ' entries không còn trong DOM');
        }
    }, _TABLE_CACHE_CLEANUP_INTERVAL);
}

// Helper: rút gọn tên hiển thị - "Master Admin - Milano 259" => "Master"
function _displayName(name) {
    if (!name) return '';
    if (name.indexOf('Master Admin') === 0) {
        return 'Master';
    }
    return name;
}

// ========== DỰNG DÒNG TÓT NHẤT ==========
// Một dòng giao dịch duy nhất, ví dụ:
//   "15p trước: | bàn 7 cf sữa máy, bánh mì… | 50.000đ | Tiền mặt - POS · An"

// Nhãn phương thức thanh toán (chữ, không dùng icon -> dễ đọc khi in/nhìn nhanh)
function _paymentMethodLabel(tx) {
    if (!tx) return '';
    if (tx.refunded) return 'Đã hủy';
    switch (tx.paymentMethod) {
        case 'cash':    return 'Tiền mặt';
        case 'transfer': return 'Chuyển khoản';
        case 'debt':    return 'Ghi nợ';
        case 'grab':    return 'Grab';
        case 'delete':  return 'Xóa bàn';
        default: break;
    }
    switch (tx.type) {
        case 'takeaway':     return 'Mang đi';
        case 'debt_payment': return 'Trả nợ';
        case 'prepaid':      return 'Trả trước';
        case 'delete_table': return 'Xóa bàn';
        default: return '';
    }
}

// Vai trò người thao tác -> nhãn ngắn
function _roleLabel(role) {
    switch (role) {
        case 'master_admin': return 'Master';
        case 'admin':        return 'Admin';
        case 'pos_admin':    return 'POS';
        case 'staff':        return 'POS';
        case 'pos':          return 'POS';
        default:             return '';
    }
}

// "Tiền mặt - POS · An" (bỏ phần nào không có, không lặp vai trò trùng tên)
function _actorLabel(tx) {
    var role = _roleLabel(tx && tx.createdByRole);
    var name = _displayName((tx && tx.createdByName) || '');
    // Tên đã rút gọn trùng vai trò (VD: role=Master, name="Master Admin - X" -> "Master")
    if (role && name) {
        if (role.toLowerCase() === name.toLowerCase()) return role;
        return role + ' · ' + name;
    }
    return role || name || '';
}

// Nhãn đầu dòng: bàn / khách / kênh bán / loại tiền
function _txSubjectLabel(tx) {
    if (!tx) return '';
    if (tx.type === 'delete_table' || tx.paymentMethod === 'delete') {
        return tx.tableName ? ('xoá ' + tx.tableName.toLowerCase()) : 'Xóa bàn';
    }
    // Quản lý rút tiền từ két POS (manager_cash_pickups)
    if (tx.type === 'manager_pickup' || tx.type === 'pickup' || tx.type === 'manager_pickup_undo') {
        var base = (tx.type === 'manager_pickup_undo') ? 'xoá QL rút tiền' : 'QL rút tiền';
        var note = (tx.note || '').trim();
        // Note mặc định không cần hiện vì đã trùng nhãn
        if (note && note.toLowerCase() !== 'quản lý nhận tiền mặt' && note.toLowerCase() !== 'admin rút quỹ') {
            return base + ' (' + note.toLowerCase() + ')';
        }
        return base;
    }
    if (tx.type === 'withdraw' || tx.type === 'withdrawal') return 'rút quỹ';
    if (tx.tableName) return tx.tableName.toLowerCase();
    if (tx.customer && tx.customer.name) return tx.customer.name;
    if (tx.type === 'takeaway') return 'mang đi';
    if (tx.type === 'grab') return 'đơn grab';
    if (tx.type === 'debt_payment') return 'trả nợ';
    if (tx.type === 'prepaid') return 'trả trước';
    return '';
}

// Rút gọn danh sách món thành 1 chuỗi ngắn để đưa vào 1 dòng
function _abbrevItemList(items, maxLen) {
    if (!items || !items.length) return '';
    maxLen = maxLen || 34;
    var parts = [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || !it.name) continue;
        var nm = it.name;
        // Bỏ phần size trong ngoặc: "Cà phê (Nhỏ)" -> "Cà phê"
        nm = nm.replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (nm.length > 12) nm = nm.substring(0, 11) + '…';
        if (it.qty > 1) nm += ' x' + it.qty;
        parts.push(nm);
    }
    if (!parts.length) return '';
    var s = parts.join(', ');
    if (s.length > maxLen) s = s.substring(0, maxLen - 1) + '…';
    else if (parts.length > 3) s += '…';
    return s;
}

// Chuỗi mô tả đầy đủ một giao dịch (dùng cho cả toast nổi lẫn title)
function describeTx(tx) {
    if (!tx) return '';
    var bits = [];
    var subject = _txSubjectLabel(tx);
    if (subject) bits.push(subject);
    var items = _abbrevItemList(tx.items);
    if (items) bits.push(items);
    if (tx.customer && tx.customer.name && !subject) bits.push(tx.customer.name);
    var desc = bits.join(' ');
    var amount = formatMoney(tx.amount || 0);
    var method = _paymentMethodLabel(tx);
    var actor = _actorLabel(tx);
    var tail = amount + (method ? ' ' + method : '') + (actor ? ' - ' + actor : '');
    return (desc ? desc + ' ' : '') + tail;
}

// Toast nổi (1 dòng) cho thanh toán / rút tiền / xóa bàn
function showActivityToast(icon, tx, type, duration) {
    return showToast(icon + ' ' + describeTx(tx), type || 'success', duration || 3500);
}

// Thời gian tương đối: "vừa xong", "15p trước", "2h trước", "3 ngày trước"
function _relTimeText(ts) {
    var diff = Date.now() - ts;
    if (diff < 0) diff = 0;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'vừa xong';
    if (mins < 60) return mins + 'p trước';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h trước';
    var days = Math.floor(hours / 24);
    return days + ' ngày trước';
}

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

// Khôi phục trạng thái recentToast từ localStorage
function restoreRecentToastState() {
    var container = document.getElementById('recentToast');
    if (!container) return;
    try {
        var collapsed = localStorage.getItem('recentToastCollapsed');
        if (collapsed === '1') {
            container.classList.add('collapsed');
            // Thu gọn -> mũi tên chỉ hướng mở ra
            var toggleIcon = document.getElementById('recentToastToggle');
            if (toggleIcon) toggleIcon.textContent = '▲';
        }
    } catch(e) {}
}

// ========== BADGE SỐ LƯỢNG ==========
// Khi panel thu gọn, tiêu đề bị ẩn, chỉ còn huy hiệu "🔄 N ▼".
// N là số giao dịch hôm nay (không giới hạn 6 như danh sách hiển thị),
// để người dùng biết có giao dịch mới mà không mở ra xem.
function _updateRecentToastCount() {
    var el = document.getElementById('recentToastCount');
    if (!el) return;
    var list = document.getElementById('recentToastList');
    var n = 0;
    if (list) {
        var rows = list.querySelectorAll('.recent-toast-item');
        n = rows.length;
    }
    el.textContent = n > 99 ? '99+' : String(n);
}

// ========== TOGGLE RECENT TOAST (thu gọn / mở rộng) ==========
function toggleRecentToast() {
    var container = document.getElementById('recentToast');
    if (!container) return;
    container.classList.toggle('collapsed');
    var isCollapsed = container.classList.contains('collapsed');
    var toggleIcon = document.getElementById('recentToastToggle');
    if (toggleIcon) {
        // Mũi tên chỉ hướng: thu gọn -> mở ra (▲), mở rộng -> thu lại (▼)
        toggleIcon.textContent = isCollapsed ? '▲' : '▼';
    }
    // Lưu trạng thái vào localStorage
    try {
        localStorage.setItem('recentToastCollapsed', isCollapsed ? '1' : '0');
    } catch(e) {}
}

// ========== UPDATE RECENT TOAST ==========
// Mỗi dòng: <thời gian> | <bàn/khách + món rút gọn> | <số tiền> | <phương thức - vai trò · tên>
function updateRecentToast() {
    var now = new Date();
    var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    DB.getTransactionsByDate(todayStr).then(function(transactions) {
        // Bỏ giao dịch bị đánh dấu trùng lặp tự động, giữ lại giao dịch hủy thủ công
        var validTx = (transactions || []).filter(function(tx) {
            if (tx.refunded && tx.note && tx.note.indexOf('Tự động') !== -1) {
                return false;
            }
            return true;
        });
        validTx.sort(function(a, b) {
            return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
        });
        // Chỉ giữ 5 giao dịch gần nhất để panel gọn, có cuộn để xem thêm nếu cần.
        // Con số tổng vẫn hiển thị ở huy hiệu khi thu gọn.
        var recent = validTx.slice(0, 5);
        var container = document.getElementById('recentToastList');
        if (!container) return;

        if (recent.length === 0) {
            container.innerHTML = '<div style="font-size: 10px; color: #64748b; text-align:center;">📋 Chưa có giao dịch hôm nay</div>';
            _updateRecentToastCount();
            return;
        }

        var html = '';
        for (var i = 0; i < recent.length; i++) {
            var tx = recent[i];
            var ts = new Date(tx.createdAt || tx.date).getTime();
            if (isNaN(ts)) ts = Date.now();

            var subject = _txSubjectLabel(tx);
            var items = _abbrevItemList(tx.items);
            var amount = formatMoney(tx.amount || 0);
            var method = _paymentMethodLabel(tx);
            var actor = _actorLabel(tx);

            html += '<div class="recent-toast-item' + (tx.refunded ? ' is-refunded' : '') + '"' +
                ' onclick="showTransactionDetail(\'' + tx.id + '\')"' +
                ' data-tx-time="' + ts + '"' +
                ' title="' + escapeHtml(describeTx(tx)) + '">' +
                '<span class="toast-time">' + escapeHtml(_relTimeText(ts)) + '</span>' +
                '<span class="toast-info">' +
                    (subject ? escapeHtml(subject) : '') +
                    (items ? '<span class="toast-items">' + escapeHtml(items) + '</span>' : '') +
                '</span>' +
                '<span class="toast-amount">' + amount + '</span>' +
                '<span class="toast-meta">' +
                    (method ? escapeHtml(method) : '') +
                    (actor ? '<span class="toast-actor"> - ' + escapeHtml(actor) + '</span>' : '') +
                '</span>' +
            '</div>';
        }
        container.innerHTML = html;
    }).then(function() {
        // Cập nhật huy hiệu số lượng (hiện ở trạng thái thu gọn)
        _updateRecentToastCount();
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
    
    // Luôn hiện nút Thêm món, kể cả khi bàn đã khoá (nghiệp vụ: khoá bàn chỉ chặn
    // xoá món / xoá bàn / chia-chuyển-gộp bàn, KHÔNG chặn thêm món).
    // Nút thanh toán chỉ hiện khi bàn có items.
    var actionBtnsHtml = '';
    var hasItems = itemCount > 0;
    
    actionBtnsHtml +=
        '<span class="table-act-btn table-act-add" onclick="event.stopPropagation(); openAddMenuForTable(\'' + table.id + '\')" title="Thêm món">➕</span>';
    if (hasItems) {
        actionBtnsHtml +=
            '<span class="table-act-btn table-act-print" onclick="event.stopPropagation(); doPrintThermal(\'' + table.id + '\')" title="In hóa đơn nhiệt">🖨️</span>' +
            '<span class="table-act-btn table-act-cash" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'cash\')" title="Tiền mặt">💵 TM</span>' +
            '<span class="table-act-btn table-act-transfer" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'transfer\')" title="Chuyển khoản">💳 CK</span>';
    }
    
    // Bọc trong table-act-row nếu có action buttons
    if (actionBtnsHtml) {
        actionBtnsHtml = '<span class="table-act-row">' + actionBtnsHtml + '</span>';
    }
    
    var creatorHtml = table.createdByName ? '<span class="table-creator">👤 ' + escapeHtml(_displayName(table.createdByName)) + '</span>' : '';
    
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
        creatorSpan.innerHTML = table.createdByName ? '👤 ' + escapeHtml(_displayName(table.createdByName)) : '';
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
        
        // Luôn hiện nút Thêm món, kể cả bàn đã khoá (khớp với createTableCard).
        newActionBtns +=
            '<span class="table-act-btn table-act-add" onclick="event.stopPropagation(); openAddMenuForTable(\'' + table.id + '\')" title="Thêm món">➕</span>';
        if (hasItems) {
            newActionBtns +=
                '<span class="table-act-btn table-act-print" onclick="event.stopPropagation(); doPrintThermal(\'' + table.id + '\')" title="In hóa đơn nhiệt">🖨️</span>' +
                '<span class="table-act-btn table-act-cash" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'cash\')" title="Tiền mặt">💵 TM</span>' +
                '<span class="table-act-btn table-act-transfer" onclick="event.stopPropagation(); paymentAtTable(\'' + table.id + '\',\'transfer\')" title="Chuyển khoản">💳 CK</span>';
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
// P2: Cache _version của mỗi table card để tránh update không cần thiết
// ⚠️ Key của mọi cache ở đây (_tableVersionCache, _tableCardCache,
// _tableCardElCache, _tableVersionCache) đều dùng String(id) để thống nhất với
// data-id trên DOM (luôn là chuỗi). Trước đây một số chỗ gán bằng table.id thô,
// nên bàn có id number tạo ra 2 entry riêng cho cùng 1 bàn -> cache phình và
// card không được update đúng lúc.
var _tableVersionCache = {};
// FIX ĐỒNG BỘ: lưu id các bàn đã bị XÓA THẬT SỰ (sự kiện 'removed' từ Firebase),
// kể cả khi lúc đó không đứng ở tab Bàn -> mở tab là thẻ bàn được gỡ ngay.
var _tablesRemovedIds = {};

// Tránh xác minh trùng cùng một bàn (2 luồng cùng gọi updateTablesDiff)
var _pendingRemovalChecks = {};
function _clearPendingRemovalChecks(list) {
    for (var i = 0; i < list.length; i++) delete _pendingRemovalChecks[list[i]];
}

// Xác minh các bàn đang hiển thị nhưng KHÔNG còn trong danh sách mới.
// Chỉ gỡ thẻ khi có đủ bằng chứng bàn đã bị xóa thật:
//   - lần đọc lại toàn bộ (getAll) vẫn không có bàn, VÀ
//   - tra cứu trực tiếp theo id (get) cũng không có.
// Nhờ vậy: bàn thanh toán xong / bị thiết bị khác xóa sẽ tự biến mất,
// còn trường hợp IndexedDB đọc thiếu (lỗi Android 6) thì thẻ bàn được giữ lại.
function _confirmRemovedTables(ids) {
    if (!ids || !ids.length) return;
    var toCheck = [];
    for (var i = 0; i < ids.length; i++) {
        var idKey = String(ids[i]);
        if (_pendingRemovalChecks[idKey]) continue; // đang xác minh rồi -> bỏ qua
        _pendingRemovalChecks[idKey] = true;
        toCheck.push(idKey);
    }
    if (!toCheck.length) return;
    console.log('[Realtime] Đang xác minh ' + toCheck.length + ' bàn (chờ 0.5s rồi đọc lại): ' + toCheck.join(', '));
    setTimeout(function() {
        DB.getAll('tables').then(function(allTables) {
            var present = {};
            for (var i = 0; i < allTables.length; i++) present[String(allTables[i].id)] = true;
            var gone = [];
            for (var j = 0; j < toCheck.length; j++) {
                if (!present[toCheck[j]]) gone.push(toCheck[j]);
            }
            if (!gone.length) {
                console.warn('[Realtime] Giữ thẻ bàn (lần đọc lại vẫn còn): ' + toCheck.join(', '));
                _clearPendingRemovalChecks(toCheck);
                return;
            }
            return Promise.all(gone.map(function(id) {
                return Promise.resolve(DB.get('tables', id)).then(function(row) {
                    return row ? null : id;
                }).catch(function() { return null; });
            })).then(function(confirmed) {
                var grid = document.getElementById('tablesGrid');
                var removed = [], kept = [];
                for (var k = 0; k < confirmed.length; k++) {
                    if (!confirmed[k]) { kept.push(gone[k]); continue; } // vẫn còn trong DB -> giữ thẻ
                    var goneId = confirmed[k];
                    delete _tableVersionCache[goneId];
                    var card = grid ? grid.querySelector('.table-card[data-id="' + goneId + '"]') : null;
                    if (card && card.parentNode) {
                        card.remove();
                        _tableCardCacheDirty = true;
                        removed.push(goneId);
                    }
                }
                if (removed.length) console.log('[Realtime] ✅ Đã gỡ thẻ bàn đã bị xóa (xác minh 2 lần): ' + removed.join(', '));
                if (kept.length) console.warn('[Realtime] Giữ thẻ bàn vì vẫn còn trong DB (IndexedDB đọc thiếu): ' + kept.join(', '));
                _clearPendingRemovalChecks(toCheck);
            });
        }).catch(function(e) {
            _clearPendingRemovalChecks(toCheck);
            console.warn('[Realtime] Xác minh bàn bị xóa lỗi:', e);
        });
    }, 500);
}

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
    
    // FIX ĐỒNG BỘ: gỡ ngay các bàn đã bị xóa thật sự ở thiết bị khác.
    // Nguồn tin cậy là sự kiện 'removed' từ Firebase (đã ghi nhận ở trên, kể cả khi lúc đó
    // đang ở tab khác), nên xử lý TRƯỚC lớp bảo vệ chống đọc thiếu của IndexedDB bên dưới.
    var _trackedRemoved = Object.keys(_tablesRemovedIds);
    if (_trackedRemoved.length > 0) {
        var _incomingIds = {};
        for (var _ai = 0; _ai < activeTables.length; _ai++) _incomingIds[String(activeTables[_ai].id)] = true;
        for (var _ri = 0; _ri < _trackedRemoved.length; _ri++) {
            var _rid = _trackedRemoved[_ri];
            if (_incomingIds[_rid]) { delete _tablesRemovedIds[_rid]; continue; }
            var _rcard = grid.querySelector('.table-card[data-id="' + _rid + '"]');
            if (_rcard && _rcard.parentNode) _rcard.remove();
            delete _tableVersionCache[_rid];
            delete _tablesRemovedIds[_rid];
        }
        _tableCardCacheDirty = true;
        existingCards = grid.querySelectorAll('.table-card:not(.table-create-btn)');
    }
    
    // FIX KHÓA ID: existingIds lấy key từ getAttribute('data-id') -> LUÔN là chuỗi.
    // còn newIds nếu gán bằng table.id thô thì key có thể là number. Trong JS,
    // obj[123] và obj['123'] thực ra cùng một key nên newIds ổn, NHƯNG khi tra
    // existingIds[table.id] với table.id là number thì tên biến trong object lại
    // tự chuyển thành chuỗi -> vẫn khớp. Vấn đề thật nằm ở chỗ khác: nếu id chứa
    // ký tự đặc biệt hoặc undefined/null thì key sẽ lệch. Chuẩn hoá bằng String()
    // ở cả hai vế để so khớp luôn đúng.
    var existingIds = {};
    for (var i = 0; i < existingCards.length; i++) {
        existingIds[String(existingCards[i].getAttribute('data-id'))] = existingCards[i];
    }
    
    var newIds = {};
    for (var i = 0; i < activeTables.length; i++) {
        newIds[String(activeTables[i].id)] = activeTables[i];
    }
    
    // FIX Android 6 + ĐỒNG BỘ: danh sách mới ít hơn số thẻ đang hiển thị thì KHÔNG bỏ qua
    // toàn bộ nữa (trước đây làm vậy nên bàn đã thanh toán / bị máy khác xóa vẫn nằm lại).
    // Giờ xác minh từng thẻ "mất tích": có bằng chứng bàn đã bị xóa thật thì gỡ thẻ,
    // nếu IndexedDB chỉ đọc thiếu thì giữ nguyên.
    if (activeTables.length < existingCards.length) {
        var _missingIds = [];
        for (var _mid in existingIds) {
            if (_mid && !newIds[_mid]) _missingIds.push(_mid);
        }
        if (_missingIds.length) {
            console.warn('[Realtime] Tables count giảm từ ' + existingCards.length + ' xuống ' + activeTables.length + ' - xác minh ' + _missingIds.length + ' bàn trước khi gỡ');
            _confirmRemovedTables(_missingIds);
        }
        // FIX BUG THIẾU THẺ BÀN: trước đây `return` ở đây, nghĩa là khi số bàn giảm
        // (vừa thanh toán 1 bàn) thì cả vòng add/update bên dưới bị bỏ qua -> bàn mới
        // tạo ở máy khác không hiện cho tới khi có event tiếp theo. Nay vẫn chạy
        // tiếp phần thêm/cập nhật; phần gỡ thẻ đã xác minh sẽ tự xử lý riêng.
    }
    
    // Gỡ thẻ bàn không còn.
    // FIX: trước đây gỡ thẳng 100% mọi thẻ không có trong danh sách mới. Điều này
    // SAI khi IndexedDB đọc thiếu (lỗi Android 6) hoặc khi suppressRealtime đang
    // giữ dữ liệu cũ -> bàn đang mở bị xóa khỏi màn hình rồi tự nhảy lại.
    // Nay: chỉ gỡ thẻ khi KHÔNG có bằng chứng bàn đó vẫn tồn tại, hoặc khi
    // danh sách mới đã xác nhận đầy đủ (không phải trường hợp đang xác minh).
    if (activeTables.length >= existingCards.length) {
        for (var id in existingIds) {
            if (!newIds[id]) {
                existingIds[id].remove();
                // P1: Đánh dấu cache dirty
                _tableCardCacheDirty = true;
                delete _tableVersionCache[id];
            }
        }
    }
    
    // Thêm hoặc cập nhật bàn - dùng DocumentFragment để batch
    var fragment = null;
    for (var i = 0; i < activeTables.length; i++) {
        var table = activeTables[i];
        var tid = String(table.id);
        var existingCard = existingIds[tid];
        if (existingCard) {
            // P2: Chỉ update nếu _version thay đổi (tránh update không cần thiết)
            var oldVersion = _tableVersionCache[tid];
            var newVersion = table._version || table.updatedAt || 0;
            if (oldVersion !== newVersion) {
                updateTableCard(existingCard, table);
                _tableVersionCache[tid] = newVersion;
            }
        } else {
            if (!fragment) fragment = document.createDocumentFragment();
            var newCard = createTableCard(table);
            fragment.appendChild(newCard);
            // P1: Đánh dấu cache dirty
            _tableCardCacheDirty = true;
            // P2: Cache version cho card mới
            _tableVersionCache[tid] = table._version || table.updatedAt || 0;
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
            
            // FIX: so sánh id bằng String().
            // `id` ở đây lấy từ data-id của DOM (luôn là chuỗi), còn
            // cachedTables[j].id từ Firebase thường là chuỗi nhưng bàn tạo trong
            // merge/chuyển món có thể là number. So sánh === giữa "123" và 123 luôn
            // false -> bàn đó KHÔNG BAO GIỜ hiện biểu tượng 🔒 dù đã quá giờ, tức là
            // nhân viên vẫn thêm/xoá món được trên bàn đã quá thời gian.
            var isLocked = false;
            if (cachedTables) {
                for (var j = 0; j < cachedTables.length; j++) {
                    if (String(cachedTables[j].id) === String(id)) {
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
        var timeSpan = item.querySelector('.toast-time');
        if (timeSpan) timeSpan.textContent = _relTimeText(parseInt(txTime));
    }
}

// ========== INIT REALTIME (RÚT GỌN) ==========
function initRealtime() {
    // ============================================================
    // TABLES
    // ============================================================
    // Subscribe cũ: cập nhật cachedTables + doanh thu
    DB.subscribe('tables', function(newTables) {
        if (!newTables) return;
        cachedTables = newTables;
        tablesCacheTime = Date.now();
        // Cập nhật doanh thu pos-cash-info khi bàn thay đổi (clear bàn, gộp bàn...)
        if (typeof loadPosCashData === 'function') {
            loadPosCashData();
        }
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
        // FIX ĐỒNG BỘ: ghi nhận bàn bị xóa ở thiết bị khác TRƯỚC khi lọc theo tab.
        // Trước đây thoát sớm khi không ở tab Bàn -> thẻ bàn cũ nằm lại trên màn hình.
        if (event.type === 'removed') _tablesRemovedIds[String(item.id)] = true;
        else delete _tablesRemovedIds[String(item.id)];
        if (currentTab !== 'tables') return;
        var grid = document.getElementById('tablesGrid');
        if (!grid) return;
        // Chuẩn hoá id một lần: key của cache và selector DOM phải dùng cùng dạng
        // với data-id trên thẻ bàn (luôn là chuỗi).
        var evId = String(item.id);
        if (event.type === 'added') {
            var existingCard = grid.querySelector('.table-card[data-id="' + evId + '"]');
            if (!existingCard) {
                grid.appendChild(createTableCard(item));
                _tableCardCacheDirty = true;
                // P2: Cache version cho card mới
                _tableVersionCache[evId] = item._version || item.updatedAt || 0;
            }
        } else if (event.type === 'changed') {
            // P2: Kiểm tra version trước khi update
            var oldVersion = _tableVersionCache[evId];
            var newVersion = item._version || item.updatedAt || 0;
            if (oldVersion === newVersion) return;
            var existingCard = grid.querySelector('.table-card[data-id="' + evId + '"]');
            if (existingCard) {
                updateTableCard(existingCard, item);
                _tableVersionCache[evId] = newVersion;
            } else {
                grid.appendChild(createTableCard(item));
                _tableCardCacheDirty = true;
                _tableVersionCache[evId] = newVersion;
            }
        } else if (event.type === 'removed') {
            delete _tableVersionCache[evId];
            delete _tablesRemovedIds[evId];
            // FIX: bàn bị xóa ở máy khác mà modal chi tiết đang mở -> modal đứng
            // yên với dữ liệu cũ, mọi nút bấm im lặng không làm gì. Đóng modal luôn.
            if (currentTableDetailId && String(currentTableDetailId) === evId) {
                if (typeof closeModal === 'function') closeModal('tableDetailModal');
                showToast('🗑️ Bàn ' + (item.name || '') + ' đã được xóa ở thiết bị khác', 'warning');
            }
            var existingCard = grid.querySelector('.table-card[data-id="' + evId + '"]');
            if (existingCard && existingCard.parentNode) {
                existingCard.remove();
                _tableCardCacheDirty = true;
            }
        }
    });
    
    // NÂNG CẤP: Khi fullSync hoàn thành, re-render toàn bộ tables
    DB.on('tables:synced', function() {
        if (currentTab !== 'tables') return;
        DB.getAll('tables').then(function(allTables) {
            cachedTables = allTables;
            tablesCacheTime = Date.now();
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
            // FIX: Dùng memory cache trước để ko block UI
            var cached = DB.getMemoryCache('customers');
            // FIX REALTIME: dữ liệu khách vừa thay đổi -> xóa cache tính nợ NGAY,
            // để tab Khách/Bàn hiện số đúng mà không phải tải lại trang.
            if (typeof _invalidateCustomerCalcCache === 'function') _invalidateCustomerCalcCache();
            if (cached && cached.length > 0) {
                customers = cached;
                window.customers = customers;
            } else {
                DB.getAll('customers').then(function(list) {
                    customers = list;
                    window.customers = customers;
                });
            }
        }, 200);
    });
    // NÂNG CẤP: Event Bus handler cho customers
    DB.on('customers:*', function(event) {
        if (!event || !event.data) return;
        // FIX REALTIME: xóa cache tính nợ BẤT KỂ đang ở tab nào.
        // Trước đây thoát sớm khi không ở tab Khách -> số nợ ở tab Khách/Bàn bị cũ
        // cho tới khi tải lại trang.
        if (typeof _invalidateCustomerCalcCache === 'function') _invalidateCustomerCalcCache();
        _debounceRealtime('customers_ui', function() {
            // FIX: Dùng memory cache trước để ko block UI, fallback sang IndexedDB nếu cần
            var cached = DB.getMemoryCache('customers');
            var applyCustomers = function(list) {
                customers = list;
                window.customers = customers;
                // Chỉ vẽ lại danh sách khi tab Khách đang mở; dữ liệu đã cập nhật ở trên
                if (currentTab === 'customers') renderCustomerList();
                // Modal chọn khách (dùng từ tab Bàn / đơn mang đi): vẽ lại số nợ đang hiển thị
                var selModal = document.getElementById('customerSelectorModal');
                if (selModal && selModal.style.display === 'flex' && typeof renderCustomerSelectorList === 'function') {
                    var selSearch = document.getElementById('customerSelectorSearch');
                    renderCustomerSelectorList(selSearch ? selSearch.value : '');
                }
                // FIX REALTIME: modal chi tiết khách hàng (màn hình công nợ) phải vẽ lại.
                // Thiếu đoạn này là số nợ trong modal cũ tới khi tải lại trang.
                // Logic này tồn tại trong realtime.js cũ nhưng file đó đã bị thay bằng
                // realtime-pos.js nên mất khi rút gọn.
                var detailModal = document.getElementById('customerDetailModal');
                if (detailModal && detailModal.style.display === 'flex') {
                    var detailContent = document.getElementById('customerDetailContent');
                    var detailId = detailContent ? detailContent.getAttribute('data-customer-id') : null;
                    // Khách đang xem có thể đã bị xoá ở thiết bị khác -> đóng modal
                    var stillExists = false;
                    for (var ci = 0; ci < list.length; ci++) {
                        if (list[ci].id === detailId) { stillExists = true; break; }
                    }
                    if (!stillExists) {
                        closeModal('customerDetailModal');
                    } else if (detailId && typeof showCustomerDetail === 'function') {
                        showCustomerDetail(detailId);
                    }
                }
                // Tab Quản lý: danh sách công nợ do managerApplyFilter() dựng,
                // không gọi renderManagerDebtList ở đây để tránh tính lại
                // hai lần. onManagerDBUpdate (db_update) sẽ lo phần cập nhật.
                if (currentTab === 'manager' && typeof _invalidateCustomerCalcCache === 'function') {
                    _invalidateCustomerCalcCache();
                }
            };
            if (cached && cached.length > 0) applyCustomers(cached);
            else DB.getAll('customers').then(applyCustomers);
        }, 30);
    });
    // NÂNG CẤP: Khi fullSync hoàn thành, re-render customers
    // FIX: bỏ điều kiện `if (currentTab !== 'customers') return;`.
    // Trước đây nếu đang ở tab Bàn/Quản lý mà có modal chi tiết khách hàng mở,
    // dữ liệu đã sync về nhưng UI không vẽ lại -> số nợ cũ tới khi tải lại trang.
    DB.on('customers:synced', function() {
        if (typeof _invalidateCustomerCalcCache === 'function') _invalidateCustomerCalcCache();
        var applySynced = function(list) {
            customers = list;
            window.customers = customers;
            if (currentTab === 'customers') renderCustomerList();
            // Vẽ lại modal chi tiết nếu đang mở
            var detailModal = document.getElementById('customerDetailModal');
            if (detailModal && detailModal.style.display === 'flex') {
                var detailContent = document.getElementById('customerDetailContent');
                var detailId = detailContent ? detailContent.getAttribute('data-customer-id') : null;
                var stillExists = false;
                for (var ci = 0; ci < list.length; ci++) {
                    if (list[ci].id === detailId) { stillExists = true; break; }
                }
                if (!stillExists) {
                    closeModal('customerDetailModal');
                } else if (detailId && typeof showCustomerDetail === 'function') {
                    showCustomerDetail(detailId);
                }
            }
            // Tab Quản lý: không gọi renderManagerDebtList ở đây.
            // Hàm đó cần danh sách {id, name, totalDebt} do managerComputeStats
            // dựng, truyền danh sách khách thô sẽ vẽ sai (thiếu totalDebt).
            // Việc cập nhật tab Quản lý do onManagerDBUpdate (db_update) đảm nhiệm.
            if (currentTab === 'manager' && typeof _invalidateCustomerCalcCache === 'function') {
                _invalidateCustomerCalcCache();
            }
        };
        // FIX: Dùng memory cache trước để ko block UI
        var cached = DB.getMemoryCache('customers');
        if (cached && cached.length > 0) applySynced(cached);
        else DB.getAll('customers').then(applySynced);
    });

    // ============================================================
    // MENU (Event Bus)
    // ============================================================
    // Event Bus handler cho menu
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
                // FIX: menu vừa đổi (sửa giá/đổi tên/thêm/xoá món) -> xoá cache HTML
                // của modal đơn. Không có bước này, cache cũ vẫn khớp và modal hiện
                // giá cũ -> POS chốt sai giá so với menu vừa sửa.
                if (typeof _invalidateOrderMenuCache === 'function') _invalidateOrderMenuCache();
                // Cập nhật menu trong order modal nếu đang mở
                var orderModal = document.getElementById('orderModal');
                if (orderModal && orderModal.style.display === 'flex') {
                    renderMenuByCategory(currentMenuCategory);
                }
                // Re-render tab Menu - Tồn kho nếu đang mở
                if (currentTab === 'inventory') {
                    if (typeof _invalidateLookups === 'function') _invalidateLookups();
                    if (typeof renderInventoryMenu === 'function') renderInventoryMenu();
                    if (typeof renderInventoryCategoryFilter === 'function') renderInventoryCategoryFilter();
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
            // FIX: xoá cache modal đơn (xem giải thích ở handler menu:* ở trên)
            if (typeof _invalidateOrderMenuCache === 'function') _invalidateOrderMenuCache();
            var orderModal = document.getElementById('orderModal');
            if (orderModal && orderModal.style.display === 'flex') {
                renderMenuByCategory(currentMenuCategory);
            }
            if (currentTab === 'inventory') {
                if (typeof _invalidateLookups === 'function') _invalidateLookups();
                if (typeof renderInventoryMenu === 'function') renderInventoryMenu();
            }
        });
    });

    // ============================================================
    // MENU CATEGORIES (Event Bus)
    // ============================================================
    // Event Bus handler cho menu_categories
    DB.on('menu_categories:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('menu_categories_ui', function() {
            DB.getAll('menu_categories').then(function(list) {
                menuCategories = list;
                window.menuCategories = list;
                // Cập nhật danh mục trong order modal nếu đang mở
                var orderModal = document.getElementById('orderModal');
                if (orderModal && orderModal.style.display === 'flex') {
                    renderOrderCategoriesColumn();
                }
                // Re-render tab Menu - Tồn kho nếu đang mở
                if (currentTab === 'inventory') {
                    if (typeof renderInventoryCategoryFilter === 'function') renderInventoryCategoryFilter();
                    if (typeof renderInventoryCategories === 'function') renderInventoryCategories();
                    if (typeof renderInventoryMenu === 'function') renderInventoryMenu();
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
                    // FIX: Cập nhật Két POS realtime - dispatch event để settings.js load lại pos-cash data
                    try {
                        var evt = document.createEvent('CustomEvent');
                        evt.initCustomEvent('pos_cash_update', true, true, { detail: { source: 'cost_transactions_sub' } });
                        window.dispatchEvent(evt);
                    } catch(e) {}
                });
            } else {
                // Fallback: nếu loadExpenseData chưa có, vẫn dispatch để settings.js xử lý
                try {
                    var evt = document.createEvent('CustomEvent');
                    evt.initCustomEvent('pos_cash_update', true, true, { detail: { source: 'cost_transactions_sub' } });
                    window.dispatchEvent(evt);
                } catch(e) {}
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
                    // FIX: Cập nhật Két POS realtime - dispatch event để settings.js load lại pos-cash data
                    try {
                        var evt = document.createEvent('CustomEvent');
                        evt.initCustomEvent('pos_cash_update', true, true, { detail: { source: 'cost_transactions_eventbus' } });
                        window.dispatchEvent(evt);
                    } catch(e) {}
                });
            } else {
                try {
                    var evt = document.createEvent('CustomEvent');
                    evt.initCustomEvent('pos_cash_update', true, true, { detail: { source: 'cost_transactions_eventbus' } });
                    window.dispatchEvent(evt);
                } catch(e) {}
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
                refreshReportIfAvailable();
            }
        }, 100);
    });
    // NÂNG CẤP: Event Bus handler cho manager_cash_pickups
    DB.on('manager_cash_pickups:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('manager_cash_pickups_ui', function() {
            if (currentTab === 'report') {
                refreshReportIfAvailable();
            }
        }, 100);
    });

    // ============================================================
    // DAILY BALANCES
    // ============================================================
    // Subscribe cũ: cập nhật daily_balances
    DB.subscribe('daily_balances', function() {
        _debounceRealtime('daily_balances', function() {
            if (typeof loadPosCashData === 'function') {
                loadPosCashData();
            }
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
    // INGREDIENTS (Event Bus)
    // ============================================================
    // Event Bus handler cho ingredients
    DB.on('ingredients:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('ingredients_ui', function() {
            DB.getAll('ingredients').then(function(list) {
                window.ingredients = list;
                // Đồng bộ biến global để các đoạn code đọc `ingredients` trực tiếp
                // không bị stale
                if (typeof ingredients !== 'undefined') {
                    try { ingredients = list; } catch (e) { /* global readonly */ }
                }
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
    // Subscribe cũ: cập nhật transactions cache
    DB.subscribe('transactions', function() {
        _debounceRealtime('transactions', function() {
            updateRecentToast();
            if (typeof loadPosCashData === 'function') {
                loadPosCashData();
            }
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
    // BONUS FUND (Quỹ thưởng trách nhiệm)
    // ============================================================
    // Subscribe cũ: cập nhật bonus_fund
    DB.subscribe('bonus_fund', function() {
        _debounceRealtime('bonus_fund', function() {
            if (typeof refreshBonusFund === 'function') {
                refreshBonusFund();
            }
        }, 300);
    });
    // NÂNG CẤP: Event Bus handler cho bonus_fund
    DB.on('bonus_fund:*', function(event) {
        if (!event || !event.data) return;
        _debounceRealtime('bonus_fund_ui', function() {
            if (typeof refreshBonusFund === 'function') {
                refreshBonusFund();
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
    // MESSAGES (Event Bus)
    // ============================================================
    // Event Bus handler cho messages
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
            refreshReportIfAvailable();
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
            if (typeof ingredients !== 'undefined') {
                try { ingredients = list; } catch (e) { /* global readonly */ }
            }
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

    // ============================================================
    // RECONCILED HANDLERS: Khi reconcileCollection hoàn tất
    // reconcileCollection so sánh keys Firebase vs local, thêm thiếu, xóa dư
    // ============================================================

    // NÂNG CẤP: Khi tables được reconcile (có thể có thêm hoặc xóa bàn)
    DB.on('tables:reconciled', function(data) {
        console.log('[Realtime] Tables reconciled:', data);
        if (currentTab !== 'tables') return;
        DB.getAll('tables').then(function(allTables) {
            cachedTables = allTables;
            tablesCacheTime = Date.now();
            updateTablesDiff(allTables);
            if (typeof startTableTimer === 'function') startTableTimer();
        });
    });

    // NÂNG CẤP: Khi customers được reconcile
    DB.on('customers:reconciled', function() {
        if (currentTab !== 'customers') return;
        var cached = DB.getMemoryCache('customers');
        if (cached && cached.length > 0) {
            customers = cached;
            window.customers = customers;
            renderCustomerList();
        } else {
            DB.getAll('customers').then(function(list) {
                customers = list;
                window.customers = customers;
                renderCustomerList();
            });
        }
    });

    // NÂNG CẤP: Khi menu được reconcile
    DB.on('menu:reconciled', function() {
        DB.getAll('menu').then(function(list) {
            menuItems = list;
            menuItems.sort(function(a, b) {
                var orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 9999;
                var orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 9999;
                return orderA - orderB;
            });
            window.menuItems = menuItems;
            // FIX: xoá cache modal đơn (xem giải thích ở handler menu:* ở trên)
            if (typeof _invalidateOrderMenuCache === 'function') _invalidateOrderMenuCache();
            var orderModal = document.getElementById('orderModal');
            if (orderModal && orderModal.style.display === 'flex') {
                renderMenuByCategory(currentMenuCategory);
            }
        });
    });

    // NÂNG CẤP: Khi menu_categories được reconcile
    DB.on('menu_categories:reconciled', function() {
        DB.getAll('menu_categories').then(function(list) {
            menuCategories = list;
            var orderModal = document.getElementById('orderModal');
            if (orderModal && orderModal.style.display === 'flex') {
                renderOrderCategoriesColumn();
            }
        });
    });

    // NÂNG CẤP: Khi staffs được reconcile
    DB.on('staffs:reconciled', function() {
        if (typeof getStaffs === 'function') {
            getStaffs();
        }
    });

    // NÂNG CẤP: Khi info được reconcile
    DB.on('info:reconciled', function() {
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

    // FIX: Gọi updateRecentToast() ngay khi khởi tạo để hiển thị 5 giao dịch gần nhất
    setTimeout(function() {
        updateRecentToast();
    }, 500);

    // PHASE 4: Khởi động periodic cleanup cho table caches
    _startTableCacheCleanup();
}
