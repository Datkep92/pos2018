// pos-app.js - App RÚT GỌN cho giao diện POS riêng
// Chỉ load các collection POS cần: menu, menu_categories, customers, tables, transactions
// ES5, tương thích Android 6, iOS 12

var currentTab = 'tables';
var tempOrder = [];
var selectedCustomer = null;
var currentHistoryDate = new Date();
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
var shopInfo = null; // Thông tin quán

document.addEventListener('DOMContentLoaded', function() {
    // Khởi tạo realtime TRƯỚC DB.init()
    initRealtime();

    DB.init().then(function() {
        if (typeof initAuth === 'function') {
            initAuth();
        }
        return loadData();
    }).then(function() {
        // FIX: Kiểm tra nếu dữ liệu rỗng (IndexedDB bị xóa) -> force sync từ Firebase
        if (_isDataEmpty()) {
            console.log('⚠️ Local data empty, forcing sync from Firebase...');
            return DB.forceSyncFromFirebase().then(function() {
                console.log('✅ Force sync completed, reloading data...');
                return loadData();
            }).catch(function(err) {
                // FIX: Nếu force sync thất bại (offline, timeout...), vẫn tiếp tục
                console.error('⚠️ Force sync failed (may be offline):', err);
                showToast('⚠️ Không thể đồng bộ dữ liệu từ server', 'warning', 3000);
            });
        }
    }).then(function() {
        return loadDraftOrders();
    }).then(function() {
        initEventListeners();
        // Khôi phục trạng thái recentToast (thu gọn/mở rộng)
        if (typeof restoreRecentToastState === 'function') {
            restoreRecentToastState();
        }
        renderCurrentTime();
        if (typeof initNotifications === 'function') {
            initNotifications();
        }
        // Khởi tạo chat nội bộ
        if (typeof initChat === 'function') {
            initChat();
        }
        // OPTIMIZE: Khởi tạo event delegation cho menu grid (thay vì inline onclick)
        if (typeof _initMenuEventDelegation === 'function') {
            _initMenuEventDelegation();
        }
        setInterval(renderCurrentTime, 30000);
        showToast('POS sẵn sàng', 'success');
    }).catch(function(err) {
        // FIX: Catch mọi lỗi để đảm bảo UI không bị treo
        console.error('❌ Initialization error:', err);
        showToast('⚠️ Lỗi khởi tạo: ' + (err.message || 'unknown'), 'error', 4000);
        // Vẫn cố gắng khởi tạo event listeners để nút bấm hoạt động
        try {
            initEventListeners();
            renderCurrentTime();
        } catch(e) {
            console.error('Fallback init error:', e);
        }
    });
});

// FIX: Kiểm tra dữ liệu local có rỗng không (do IndexedDB bị xóa)
function _isDataEmpty() {
    // Nếu menuItems rỗng và customers rỗng -> khả năng cao local bị xóa
    var menuEmpty = !menuItems || menuItems.length === 0;
    var customersEmpty = !customers || customers.length === 0;
    var tablesEmpty = !cachedTables || cachedTables.length === 0;
    
    // Nếu cả 3 collection chính đều rỗng -> cần force sync
    return menuEmpty && customersEmpty && tablesEmpty;
}

function loadData() {
    return Promise.all([
        DB.getAll('menu'),
        DB.getAll('menu_categories'),
        DB.getAll('customers'),
        DB.getAll('info'),
        // Đọc trực tiếp từ Firebase để đảm bảo shopConfig luôn đúng
        DB.getShopConfig()
    ]).then(function(results) {
        menuItems = results[0] || [];
        // Sắp xếp menuItems theo sortOrder để kéo thả hoạt động đúng
        menuItems.sort(function(a, b) {
            var orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 9999;
            var orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 9999;
            return orderA - orderB;
        });
        menuCategories = results[1] || [];
        customers = results[2] || [];
        // Load shop info từ IndexedDB (ưu tiên)
        var shopInfoList = results[3] || [];
        if (shopInfoList.length > 0) {
            shopInfo = shopInfoList[0];
        } else {
            shopInfo = null;
        }
        window.shopInfo = shopInfo;
        // Cập nhật tên quán trên header từ DB
        var shopNameEl = document.getElementById('shopNameHeader');
        if (shopNameEl && shopInfo && shopInfo.name) {
            shopNameEl.textContent = shopInfo.name;
        }
        // Shop config: ưu tiên dữ liệu từ Firebase (results[4]), fallback về IndexedDB, rồi hardcode
        var fbConfig = results[4] || {};
        window.shopConfig = {
            telegramBotToken: fbConfig.telegramBotToken || (shopInfo && shopInfo.telegramBotToken) || '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
            telegramChatId: fbConfig.telegramChatId || (shopInfo && shopInfo.telegramChatId) || '6372876364',
            lockPassword: fbConfig.lockPassword || (shopInfo && shopInfo.lockPassword) || '28122020',
            lockStartHour: fbConfig.lockStartHour !== undefined ? fbConfig.lockStartHour : (shopInfo && shopInfo.lockStartHour !== undefined ? shopInfo.lockStartHour : 17),
            lockEndHour: fbConfig.lockEndHour !== undefined ? fbConfig.lockEndHour : (shopInfo && shopInfo.lockEndHour !== undefined ? shopInfo.lockEndHour : 5),
            lockEndMinute: fbConfig.lockEndMinute !== undefined ? fbConfig.lockEndMinute : (shopInfo && shopInfo.lockEndMinute !== undefined ? shopInfo.lockEndMinute : 30),
            tableLockHours: fbConfig.tableLockHours !== undefined ? fbConfig.tableLockHours : (shopInfo && shopInfo.tableLockHours !== undefined ? shopInfo.tableLockHours : 5)
        };
        window.menuItems = menuItems;
        window.customers = customers;
        window.ingredients = ingredients;
        renderTables();
        updateRecentToast();
    }).then(function() {
        renderCustomerList();
        renderHistoryByDate(currentHistoryDate);
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
            if (tx.tableName) {
                var displayLabel = (tx.customer && tx.customer.name) ? tx.customer.name : tx.tableName;
                locationInfo = '\uD83C\uDF7D\uFE0F ' + displayLabel;
            } else if (tx.type === 'takeaway') locationInfo = '\uD83D\uDEF5 Mang \u0111i';
            else if (tx.type === 'grab') locationInfo = '\uD83D\uDE95 Grab';
            else locationInfo = '\uD83C\uDF7D\uFE0F T\u1EA1i ch\u1ED7';

            html += '<div class="recent-item" onclick="showTransactionDetail(\'' + tx.id + '\')">' +
                '<span class="recent-time">' + timeText + '</span>' +
                '<span class="recent-info">' + locationInfo + ' - ' + totalItems + ' món</span>' +
                '<span class="recent-amount">' + formatMoney(tx.amount) + '</span>' +
            '</div>';
        }
        container.innerHTML = html;
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

    // Nút tạo đơn
    var createOrderBtn = document.getElementById('createOrderBtn');
    if (createOrderBtn) createOrderBtn.onclick = openCreateOrderModal;

    // Nút chi phí (giữ nguyên để tương thích, nhưng có thể ẩn nếu ko cần)
    var expenseFloatBtn = document.getElementById('expenseFloatBtn');
    if (expenseFloatBtn) {
        expenseFloatBtn.onclick = function() {
            if (typeof openExpenseModal === 'function') {
                openExpenseModal();
            } else {
                showToast('Chức năng chi phí chưa sẵn sàng', 'warning');
            }
        };
    }

    var prevDayBtn = document.getElementById('prevDayBtn');
    if (prevDayBtn) prevDayBtn.onclick = function() { changeHistoryDate(-1); };

    var nextDayBtn = document.getElementById('nextDayBtn');
    if (nextDayBtn) nextDayBtn.onclick = function() { changeHistoryDate(1); };

    var historyFilter = document.getElementById('historyFilter');
    if (historyFilter) historyFilter.onchange = function() { renderHistoryByDate(currentHistoryDate); };

    var quickAddCustomerBtn = document.getElementById('quickAddCustomerBtn');
    if (quickAddCustomerBtn) quickAddCustomerBtn.onclick = quickAddCustomer;

    var customerSearchInput = document.getElementById('customerSearchInput');
    if (customerSearchInput) {
        customerSearchInput.oninput = function() { renderCustomerList(); };
        customerSearchInput.onkeydown = function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                quickAddCustomer();
            }
        };
    }

    var createCustomerBtn = document.getElementById('createCustomerFromSelectorBtn');
    if (createCustomerBtn) createCustomerBtn.onclick = createCustomerFromInput;

    // Split, transfer, delete
    var confirmSplit = document.getElementById('confirmSplitBtn');
    if (confirmSplit) confirmSplit.onclick = confirmSplitPayment;

    var confirmTransfer = document.getElementById('confirmTransferBtn');
    if (confirmTransfer) confirmTransfer.onclick = confirmTransferItems;

    var confirmDelete = document.getElementById('confirmDeleteTableBtn');
    if (confirmDelete) confirmDelete.onclick = confirmDeleteTable;
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

    var draftContainer = document.getElementById('draftBubbleContainer');
    var recentToast = document.getElementById('recentToast');
    if (tabId === 'tables') {
        if (draftContainer) draftContainer.style.display = '';
        if (recentToast) recentToast.style.display = '';
        renderTables();
        if (typeof startTableTimer === 'function') {
            startTableTimer();
        }
    } else {
        if (typeof stopTableTimer === 'function') {
            stopTableTimer();
        }
        if (draftContainer) draftContainer.style.display = 'none';
        if (recentToast) recentToast.style.display = 'none';

        if (tabId === 'history') {
            renderHistoryByDate(currentHistoryDate);
        } else if (tabId === 'customers') {
            renderCustomerList();
        } else if (tabId === 'settings') {
            if (typeof initSettingsTab === 'function') {
                initSettingsTab();
            }
        }
    }
}

// Cache formatMoney
var _moneyCache = {};
var _moneyCacheKeys = [];
var _MONEY_CACHE_MAX = 1000;
function formatMoney(amount) {
    var val = amount || 0;
    var key = String(val);
    if (_moneyCache[key] !== undefined) return _moneyCache[key];
    var result = val.toLocaleString('vi-VN') + '\u0111';
    if (_moneyCacheKeys.length >= _MONEY_CACHE_MAX) {
        var oldestKey = _moneyCacheKeys.shift();
        delete _moneyCache[oldestKey];
    }
    _moneyCache[key] = result;
    _moneyCacheKeys.push(key);
    return result;
}

var _toastCounter = 0;
var _toastMap = {};

function showToast(message, type, duration) {
    if (duration === undefined) duration = 2500;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerText = message;
    document.getElementById('toastContainer').appendChild(toast);
    var id = 'toast_' + (++_toastCounter);
    toast.setAttribute('data-toast-id', id);
    if (duration > 0) {
        var timer = setTimeout(function() { toast.remove(); delete _toastMap[id]; }, duration);
        _toastMap[id] = { element: toast, timer: timer };
    } else {
        _toastMap[id] = { element: toast, timer: null };
    }
    return id;
}

function hideToast(id) {
    var entry = _toastMap[id];
    if (entry) {
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.element && entry.element.parentNode) entry.element.remove();
        delete _toastMap[id];
    }
}

function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, function(m) { if (m === '&') return '&'; if (m === '<') return '<'; if (m === '>') return '>'; return m; }); }
function formatDateDisplay(dateStr) {
    // Fix timezone: nếu dateStr là YYYY-MM-DD, parse thủ công để tránh lỗi UTC
    if (typeof dateStr === 'string' && dateStr.length === 10 && dateStr[4] === '-' && dateStr[7] === '-') {
        var parts = dateStr.split('-');
        return parseInt(parts[2], 10) + '/' + parseInt(parts[1], 10) + '/' + parseInt(parts[0], 10);
    }
    var d = new Date(dateStr);
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
}
function renderCurrentTime() {
    var now = new Date();
    var timeEl = document.getElementById('currentTime');
    if (timeEl) timeEl.innerText = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    var dateEl = document.getElementById('headerDate');
    if (dateEl) {
        var dayNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
        dateEl.innerText = dayNames[now.getDay()] + ', ' + now.toLocaleDateString('vi-VN');
    }
}

// FIX: closeModal - dùng window.closeModal để các event listener khác (click outside) cũng gọi đúng hàm này
window.closeModal = function(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('closing');
        setTimeout(function() {
            modal.style.display = 'none';
            modal.classList.remove('closing');
        }, 200);
    }
    document.body.classList.remove('modal-open');
    
    // FIX: Khi đóng orderModal: LUÔN clear tempOrder và cart cache
    // để lần mở sau ko bị giữ lại items cũ (kể cả khi thanh toán thất bại)
    if (modalId === 'orderModal') {
        tempOrder = [];
        if (typeof _resetCartDomCache === 'function') {
            _resetCartDomCache();
        }
        currentAddToTableId = null;
        currentDraftId = null;
    }
};

function openBottomSheet(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

// FIX: Đóng modal khi click ra ngoài - dùng window.closeModal thay vì closeModal local
document.querySelectorAll('.modal').forEach(function(modal) {
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            window.closeModal(modal.id);
        }
    });
});

// ========== TOAST ==========
var _toastCounter = 0;
var _toastMap = {};

function showToast(message, type, duration) {
    if (duration === undefined) duration = 2500;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerText = message;
    document.getElementById('toastContainer').appendChild(toast);
    var id = 'toast_' + (++_toastCounter);
    toast.setAttribute('data-toast-id', id);
    if (duration > 0) {
        var timer = setTimeout(function() { toast.remove(); delete _toastMap[id]; }, duration);
        _toastMap[id] = { element: toast, timer: timer };
    } else {
        _toastMap[id] = { element: toast, timer: null };
    }
    return id;
}

function hideToast(id) {
    var entry = _toastMap[id];
    if (entry) {
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.element && entry.element.parentNode) entry.element.remove();
        delete _toastMap[id];
    }
}

// Settings code moved to settings.js
