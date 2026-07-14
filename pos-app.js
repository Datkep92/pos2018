// pos-app.js - App RÚT GỌN cho giao diện POS riêng
// Chỉ load các collection POS cần: menu, menu_categories, customers, tables, transactions
// ES5, tương thích Android 6, iOS 12

var currentTab = 'takeaway';
var tempOrder = [];
var selectedCustomer = null;
var currentHistoryDate = new Date();
var currentReportDate = new Date();
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
// Takeaway tab
var _takeawayCart = [];
var _takeawayCategory = 'custom';
var _takeawaySearch = '';
// Danh sách món chọn nhanh (điền tên món vào đây để hiển thị nút bấm nhanh)
// Danh sách ID món tùy chỉnh (custom items list) - lưu trong localStorage
var _takeawayCustomIds = [];
// Khởi tạo window.shopConfig với giá trị mặc định (sẽ được cập nhật từ Firebase sau)
window.shopConfig = {
    lockStartHour: 22,
    lockEndHour: 5,
    lockEndMinute: 30,
    tableLockHours: 5,
    lockPassword: '28122020',
    telegramBotToken: '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
    telegramChatId: '6372876364',
    telegramShiftCloseToken: '',
    telegramWarningToken: '',
    telegramExpenseToken: ''
};

document.addEventListener('DOMContentLoaded', function() {
    // OPTIMIZE: Khôi phục UI từ sessionStorage ngay lập tức (nếu có)
    // Giúp UI hiển thị ngay trong khi chờ DB.init() và loadData() hoàn tất
    _restoreFromSessionCache();
    
    // FIX: Gọi DB.init() TRƯỚC, sau đó mới initRealtime()
    // Đảm bảo database đã sẵn sàng trước khi đăng ký subscriptions
    DB.init().then(function() {
        if (typeof initAuth === 'function') {
            initAuth();
        }
        return loadData();
    }).then(function() {
        // OPTIMIZE: Lưu vào sessionCache sau khi loadData thành công
        _saveToSessionCache();
        
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
        // Ẩn màn hình loading sau khi khởi tạo xong
        _hideLoadingScreen();

        // FIX: Khởi tạo realtime subscriptions SAU KHI DB đã sẵn sàng và data đã load
        // Tránh race condition: subscribeWithPolling gọi callback khi memoryCache còn rỗng
        initRealtime();
        
        // Mặc định hiển thị tab Mang đi (mangdi.html),
        // index.html có thể set window._defaultTab = 'tables' trước khi load pos-app.js
        switchTab(window._defaultTab || 'takeaway');
        
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
        // Ẩn loading ngay cả khi có lỗi để không bị treo màn hình
        _hideLoadingScreen();
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

// Hàm ẩn màn hình loading với hiệu ứng mượt
function _hideLoadingScreen() {
    var el = document.getElementById('loadingScreen');
    if (el) {
        el.classList.add('hidden');
        // Xóa khỏi DOM sau khi animation kết thúc để giải phóng bộ nhớ
        setTimeout(function() {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        }, 500);
    }
}

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
    // OPTIMIZE: Đọc từ memoryCache trước (nếu có), fallback về IndexedDB
    // memoryCache được populate bởi smartSync() trong DB.init(), nhanh hơn IndexedDB rất nhiều
    var menuFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('menu') : null;
    var menuCatFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('menu_categories') : null;
    var customersFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('customers') : null;
    var ingredientsFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('ingredients') : null;
    var tablesFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('tables') : null;
    
    // Nếu memoryCache có đủ menu + customers -> dùng luôn, không cần đợi IndexedDB
    if (menuFromCache && customersFromCache) {
        menuItems = menuFromCache;
        menuItems.sort(function(a, b) {
            var orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 9999;
            var orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 9999;
            return orderA - orderB;
        });
        menuCategories = menuCatFromCache || [];
        customers = customersFromCache;
        ingredients = ingredientsFromCache || [];
        // FIX: Load tables từ memoryCache (đã được smartSync cập nhật)
        if (tablesFromCache) {
            cachedTables = tablesFromCache;
            tablesCacheTime = Date.now();
        }
        window.menuItems = menuItems;
        window.customers = customers;
        window.ingredients = ingredients;
        
        // Vẫn cần load info và shopConfig từ IndexedDB/Firebase
        return Promise.all([
            DB.getAll('info'),
            DB.getShopConfig()
        ]).then(function(results) {
            var shopInfoList = results[0] || [];
            if (shopInfoList.length > 0) {
                shopInfo = shopInfoList[0];
            } else {
                shopInfo = null;
            }
            window.shopInfo = shopInfo;
            var shopNameEl = document.getElementById('shopNameHeader');
            if (shopNameEl && shopInfo && shopInfo.name) {
                shopNameEl.textContent = shopInfo.name;
            }
            var fbConfig = results[1] || {};
            window.shopConfig = {
                telegramBotToken: fbConfig.telegramBotToken || (shopInfo && shopInfo.telegramBotToken) || '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                telegramChatId: fbConfig.telegramChatId || (shopInfo && shopInfo.telegramChatId) || '6372876364',
                telegramShiftCloseToken: fbConfig.telegramShiftCloseToken || (shopInfo && shopInfo.telegramShiftCloseToken) || '',
                telegramWarningToken: fbConfig.telegramWarningToken || (shopInfo && shopInfo.telegramWarningToken) || '',
                telegramExpenseToken: fbConfig.telegramExpenseToken || (shopInfo && shopInfo.telegramExpenseToken) || '',
                lockPassword: fbConfig.lockPassword || (shopInfo && shopInfo.lockPassword) || '28122020',
                lockStartHour: fbConfig.lockStartHour !== undefined ? fbConfig.lockStartHour : (shopInfo && shopInfo.lockStartHour !== undefined ? shopInfo.lockStartHour : 22),
                lockEndHour: fbConfig.lockEndHour !== undefined ? fbConfig.lockEndHour : (shopInfo && shopInfo.lockEndHour !== undefined ? shopInfo.lockEndHour : 5),
                lockEndMinute: fbConfig.lockEndMinute !== undefined ? fbConfig.lockEndMinute : (shopInfo && shopInfo.lockEndMinute !== undefined ? shopInfo.lockEndMinute : 30),
                tableLockHours: fbConfig.tableLockHours !== undefined ? fbConfig.tableLockHours : (shopInfo && shopInfo.tableLockHours !== undefined ? shopInfo.tableLockHours : 5)
            };
            renderCustomerList();
            renderHistoryByDate(currentHistoryDate);
        });
    }
    
    // Fallback: đọc từ IndexedDB như cũ
    return Promise.all([
        DB.getAll('menu'),
        DB.getAll('menu_categories'),
        DB.getAll('customers'),
        DB.getAll('info'),
        DB.getAll('ingredients'),
        DB.getAll('tables'), // FIX: Load tables từ IndexedDB (đã được smartSync cập nhật)
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
        // Load ingredients
        ingredients = results[4] || [];
        // FIX: Load tables từ IndexedDB (đã được smartSync cập nhật)
        var tablesData = results[5] || [];
        cachedTables = tablesData;
        tablesCacheTime = Date.now();
        // Shop config: ưu tiên dữ liệu từ Firebase (results[6]), fallback về IndexedDB (shopInfo), rồi hardcode
        var fbConfig = results[6] || {};
        window.shopConfig = {
            telegramBotToken: fbConfig.telegramBotToken || (shopInfo && shopInfo.telegramBotToken) || '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
            telegramChatId: fbConfig.telegramChatId || (shopInfo && shopInfo.telegramChatId) || '6372876364',
            telegramShiftCloseToken: fbConfig.telegramShiftCloseToken || (shopInfo && shopInfo.telegramShiftCloseToken) || '',
            telegramWarningToken: fbConfig.telegramWarningToken || (shopInfo && shopInfo.telegramWarningToken) || '',
            telegramExpenseToken: fbConfig.telegramExpenseToken || (shopInfo && shopInfo.telegramExpenseToken) || '',
            lockPassword: fbConfig.lockPassword || (shopInfo && shopInfo.lockPassword) || '28122020',
            lockStartHour: fbConfig.lockStartHour !== undefined ? fbConfig.lockStartHour : (shopInfo && shopInfo.lockStartHour !== undefined ? shopInfo.lockStartHour : 22),
            lockEndHour: fbConfig.lockEndHour !== undefined ? fbConfig.lockEndHour : (shopInfo && shopInfo.lockEndHour !== undefined ? shopInfo.lockEndHour : 5),
            lockEndMinute: fbConfig.lockEndMinute !== undefined ? fbConfig.lockEndMinute : (shopInfo && shopInfo.lockEndMinute !== undefined ? shopInfo.lockEndMinute : 30),
            tableLockHours: fbConfig.tableLockHours !== undefined ? fbConfig.tableLockHours : (shopInfo && shopInfo.tableLockHours !== undefined ? shopInfo.tableLockHours : 5)
        };
        window.menuItems = menuItems;
        window.customers = customers;
        window.ingredients = ingredients;
        // OPTIMIZE: Chuyển renderTables() và updateRecentToast() ra sau initRealtime()
        // để tránh render 2 lần (lần 1 ở đây, lần 2 khi subscription callback chạy)
        // renderTables() và updateRecentToast() sẽ được gọi trong .then() sau initRealtime()
    }).then(function() {
        renderCustomerList();
        renderHistoryByDate(currentHistoryDate);
    });
}

function renderRecentTransactions() {
    var todayStr = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
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

    var reportPrevDayBtn = document.getElementById('reportPrevDayBtn');
    if (reportPrevDayBtn) reportPrevDayBtn.onclick = function() { changeReportDate(-1); };

    var reportNextDayBtn = document.getElementById('reportNextDayBtn');
    if (reportNextDayBtn) reportNextDayBtn.onclick = function() { changeReportDate(1); };

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

    // Khởi tạo offline indicator
    updateOfflineIndicator();
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
        } else if (tabId === 'report') {
            if (typeof renderReport === 'function') {
                renderReport(currentReportDate);
            }
        } else if (tabId === 'inventory') {
            if (typeof renderInventoryMenu === 'function') renderInventoryMenu();
            if (typeof renderInventoryIngredients === 'function') renderInventoryIngredients();
            if (typeof renderInventoryCategoryFilter === 'function') renderInventoryCategoryFilter();
        } else if (tabId === 'cost') {
            if (typeof initExpense === 'function') initExpense();
            // renderTodayExpenses đã gọi renderExpensesByDate bên trong
            if (typeof renderTodayExpenses === 'function') renderTodayExpenses();
            if (typeof renderMonthExpenseTotal === 'function') renderMonthExpenseTotal();
            // Áp dụng phân quyền: ẩn nguồn tiền QL TT cho staff
            if (typeof applyExpenseRoleRestrictions === 'function') applyExpenseRoleRestrictions();
        } else if (tabId === 'manager') {
            if (typeof managerApplyFilter === 'function') managerApplyFilter();
        } else if (tabId === 'settings') {
            if (typeof initSettingsTab === 'function') {
                initSettingsTab();
            }
        } else if (tabId === 'takeaway') {
            if (typeof _renderTakeawayCategories === 'function') _renderTakeawayCategories();
            if (typeof _renderTakeawayMenu === 'function') _renderTakeawayMenu();
            if (typeof _renderTakeawayCart === 'function') _renderTakeawayCart();
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
        var solarStr = dayNames[now.getDay()] + ', ' + now.toLocaleDateString('vi-VN');
        var lunarStr = '';
        if (typeof Lunar !== 'undefined') {
            try {
                var lunar = Lunar.fromDate(now);
                var day = lunar.getDay();
                var month = lunar.getMonth();
                lunarStr = '  🏮 ' + day + '/' + month;
            } catch(e) {}
        }
        dateEl.innerText = solarStr + lunarStr;
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

// ========== SESSION STORAGE CACHE (Tối ưu tốc độ F5) ==========
// OPTIMIZE: Lưu menuItems, customers, cachedTables vào sessionStorage
// để khôi phục UI ngay lập tức khi F5, không cần đợi IndexedDB
// Cache tự động hết hạn sau 24h

var _SESSION_CACHE_TTL = 86400000; // 24h

function _saveToSessionCache() {
    try {
        sessionStorage.setItem('pos_menuItems', JSON.stringify(menuItems));
        sessionStorage.setItem('pos_customers', JSON.stringify(customers));
        sessionStorage.setItem('pos_cachedTables', JSON.stringify(cachedTables));
        sessionStorage.setItem('pos_cacheTime', Date.now().toString());
    } catch(e) {
        // sessionStorage đầy hoặc không khả dụng, bỏ qua
    }
}

function _restoreFromSessionCache() {
    try {
        var cacheTime = sessionStorage.getItem('pos_cacheTime');
        if (!cacheTime) return;
        
        // Cache hết hạn sau 24h
        if (Date.now() - parseInt(cacheTime) > _SESSION_CACHE_TTL) {
            sessionStorage.clear();
            return;
        }
        
        var menuData = sessionStorage.getItem('pos_menuItems');
        var customersData = sessionStorage.getItem('pos_customers');
        var tablesData = sessionStorage.getItem('pos_cachedTables');
        
        if (menuData) {
            menuItems = JSON.parse(menuData);
            window.menuItems = menuItems;
        }
        if (customersData) {
            customers = JSON.parse(customersData);
            window.customers = customers;
        }
        if (tablesData) {
            cachedTables = JSON.parse(tablesData);
            // FIX: Set tablesCacheTime về 0 để renderTables() sau đó (từ switchTab)
            // không dùng cachedTables cũ từ sessionStorage mà đọc từ IndexedDB đã sync
            tablesCacheTime = 0;
        }
        
        // FIX: KHÔNG gọi renderTables() ở đây vì:
        // 1. IndexedDB chưa sẵn sàng (dbReady = null) -> DB.getAll('tables') sẽ crash
        // 2. Nếu IndexedDB đã sẵn sàng, dữ liệu chưa được cleanup (smartSync chưa chạy)
        //    -> renderTables() sẽ hiển thị dữ liệu cũ (bao gồm bàn đã xóa trên Firebase)
        // 3. Promise từ renderTables() có thể resolve SAU KHI switchTab() đã render UI đúng
        //    -> ghi đè UI đúng bằng dữ liệu cũ (race condition)
        // Việc render UI sẽ được thực hiện bởi switchTab() sau khi DB.init() hoàn tất
        // Chỉ khôi phục dữ liệu vào bộ nhớ (cachedTables) để các component khác dùng
        updateRecentToast();
    } catch(e) {
        // Lỗi parse JSON hoặc sessionStorage không khả dụng
        sessionStorage.clear();
    }
}

// Settings code moved to settings.js

// ========== OFFLINE INDICATOR ==========
function updateOfflineIndicator() {
    var indicator = document.getElementById('offlineIndicator');
    if (!indicator) return;
    var isOnline = typeof DB.isOnline === 'function' ? DB.isOnline() : navigator.onLine;
    if (isOnline) {
        indicator.style.display = 'none';
    } else {
        indicator.style.display = 'flex';
    }
}

// Gọi updateOfflineIndicator khi online/offline event
window.addEventListener('online', function() {
    setTimeout(updateOfflineIndicator, 500);
});
window.addEventListener('offline', function() {
    setTimeout(updateOfflineIndicator, 100);
});

// ========== LOADING OVERLAY ==========
var _loadingOverlay = null;

function _ensureLoadingOverlay() {
    if (!_loadingOverlay) {
        _loadingOverlay = document.createElement('div');
        _loadingOverlay.className = 'loading-overlay';
        _loadingOverlay.id = 'globalLoadingOverlay';
        _loadingOverlay.innerHTML = '<div class="loading-spinner"></div>';
        document.body.appendChild(_loadingOverlay);
    }
    return _loadingOverlay;
}

function showLoadingOverlay() {
    var overlay = _ensureLoadingOverlay();
    overlay.classList.add('active');
}

function hideLoadingOverlay() {
    if (_loadingOverlay) {
        _loadingOverlay.classList.remove('active');
    }
}

// ========== BUTTON LOADING STATE ==========
function setButtonLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
        btn.classList.add('btn-loading');
        btn.disabled = true;
    } else {
        btn.classList.remove('btn-loading');
        btn.disabled = false;
    }
}

// ========== TAKEAWAY TAB - RENDER CATEGORIES ==========
function _renderTakeawayCategories() {
    var container = document.getElementById('takeawayCategories');
    if (!container) return;
    var html = '';
    // Nút "⭐ Tùy chỉnh" thay cho "📋 Tất cả"
    html += '<div class="takeaway-cat-btn' + (_takeawayCategory === 'custom' ? ' active' : '') + '" onclick="_takeawaySelectCategory(\'custom\')">⭐ Tùy chỉnh</div>';
    // Nút "+" để thêm/xóa món vào danh sách tùy chỉnh
    html += '<div class="takeaway-cat-btn takeaway-custom-add" onclick="_takeawayShowCustomPicker()">+</div>';
    // Các danh mục còn lại
    for (var i = 0; i < menuCategories.length; i++) {
        var cat = menuCategories[i];
        var active = (_takeawayCategory === cat.id) ? ' active' : '';
        html += '<div class="takeaway-cat-btn' + active + '" onclick="_takeawaySelectCategory(\'' + cat.id + '\')">' + escapeHtml(cat.name || cat.id) + '</div>';
    }
    container.innerHTML = html;
}

function _takeawaySelectCategory(catId) {
    _takeawayCategory = catId;
    _renderTakeawayCategories();
    _renderTakeawayMenu();
}

function _takeawayOnSearch(val) {
    _takeawaySearch = val.trim().toLowerCase();
    _renderTakeawayMenu();
}

// ========== TAKEAWAY TAB - CHỌN MÓN TÙY CHỈNH ==========
function _takeawayShowCustomPicker() {
    // Load danh sách từ localStorage
    _takeawayLoadCustomIds();
    
    var overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.id = 'takeawayCustomPicker';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    
    var content = document.createElement('div');
    content.className = 'modal-content';
    content.style.maxWidth = '500px';
    content.style.width = '90%';
    content.style.borderRadius = '20px';
    content.style.maxHeight = '80vh';
    content.style.display = 'flex';
    content.style.flexDirection = 'column';
    
    var header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = '<span class="modal-title">⭐ Chọn món tùy chỉnh</span><span class="modal-close" onclick="document.getElementById(\'takeawayCustomPicker\').remove()">&times;</span>';
    
    var body = document.createElement('div');
    body.className = 'modal-body';
    body.style.overflowY = 'auto';
    body.style.flex = '1';
    
    // Hiển thị danh sách tất cả món, đánh dấu món đã chọn
    var html = '';
    for (var i = 0; i < menuItems.length; i++) {
        var item = menuItems[i];
        var checked = _takeawayCustomIds.indexOf(item.id) !== -1;
        html += '<div class="takeaway-picker-item" data-id="' + item.id + '">' +
            '<input type="checkbox" id="tk_pick_' + i + '" ' + (checked ? 'checked' : '') + ' onchange="_takeawayToggleCustom(\'' + item.id + '\', this.checked)">' +
            '<label for="tk_pick_' + i + '">' + escapeHtml(item.name || '') + ' - ' + formatMoney(item.price || 0) + '</label>' +
        '</div>';
    }
    body.innerHTML = html;
    
    var footer = document.createElement('div');
    footer.style.padding = '12px 0 0';
    footer.style.borderTop = '1px solid #e2e8f0';
    footer.style.textAlign = 'center';
    footer.innerHTML = '<button onclick="document.getElementById(\'takeawayCustomPicker\').remove();_takeawaySaveCustomIds();_renderTakeawayMenu();" style="padding:10px 32px;border:none;border-radius:40px;background:#f97316;color:#fff;font-weight:700;font-size:14px;cursor:pointer;-webkit-appearance:none;">✅ Xong</button>';
    
    content.appendChild(header);
    content.appendChild(body);
    content.appendChild(footer);
    overlay.appendChild(content);
    document.body.appendChild(overlay);
    
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) overlay.remove();
    });
}

function _takeawayToggleCustom(itemId, checked) {
    var idx = _takeawayCustomIds.indexOf(itemId);
    if (checked && idx === -1) {
        _takeawayCustomIds.push(itemId);
    } else if (!checked && idx !== -1) {
        _takeawayCustomIds.splice(idx, 1);
    }
}

function _takeawayLoadCustomIds() {
    try {
        var saved = localStorage.getItem('_takeawayCustomIds');
        _takeawayCustomIds = saved ? JSON.parse(saved) : [];
    } catch(e) {
        _takeawayCustomIds = [];
    }
}

function _takeawaySaveCustomIds() {
    try {
        localStorage.setItem('_takeawayCustomIds', JSON.stringify(_takeawayCustomIds));
    } catch(e) {}
}

// ========== TAKEAWAY TAB - RENDER MENU ==========
function _renderTakeawayMenu() {
    var container = document.getElementById('takeawayMenuGrid');
    if (!container) return;
    var filtered = [];
    for (var i = 0; i < menuItems.length; i++) {
        var item = menuItems[i];
        // Nếu chọn "Tùy chỉnh" thì chỉ hiển thị món trong danh sách custom
        if (_takeawayCategory === 'custom') {
            _takeawayLoadCustomIds();
            if (_takeawayCustomIds.indexOf(item.id) === -1) continue;
        } else if (_takeawayCategory !== 'all' && item.categoryId !== _takeawayCategory) {
            continue;
        }
        // Lọc theo tìm kiếm
        if (_takeawaySearch && item.name && item.name.toLowerCase().indexOf(_takeawaySearch) === -1) continue;
        filtered.push(item);
    }
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-text">Không có món nào</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var item = filtered[i];
        var price = item.price || 0;
        html += '<div class="takeaway-menu-item" onclick="_takeawayAddItem(' + i + ')" data-index="' + i + '">' +
            '<div class="item-name">' + escapeHtml(item.name || '') + '</div>' +
            '<div class="item-price">' + formatMoney(price) + '</div>' +
        '</div>';
    }
    container.innerHTML = html;
}

// ========== TAKEAWAY TAB - ADD ITEM TO CART ==========
function _takeawayAddItem(menuIndex) {
    // Tìm item trong filtered list
    var filtered = [];
    for (var i = 0; i < menuItems.length; i++) {
        var item = menuItems[i];
        if (_takeawayCategory === 'custom') {
            _takeawayLoadCustomIds();
            if (_takeawayCustomIds.indexOf(item.id) === -1) continue;
        } else if (_takeawayCategory !== 'all' && item.categoryId !== _takeawayCategory) {
            continue;
        }
        if (_takeawaySearch && item.name && item.name.toLowerCase().indexOf(_takeawaySearch) === -1) continue;
        filtered.push(item);
    }
    var menuItem = filtered[menuIndex];
    if (!menuItem) return;
    
    // Kiểm tra xem item đã có trong giỏ chưa
    var found = false;
    for (var i = 0; i < _takeawayCart.length; i++) {
        if (_takeawayCart[i].id === menuItem.id) {
            _takeawayCart[i].qty = (_takeawayCart[i].qty || 1) + 1;
            found = true;
            break;
        }
    }
    if (!found) {
        _takeawayCart.push({
            id: menuItem.id,
            name: menuItem.name,
            price: menuItem.price || 0,
            qty: 1
        });
    }
    _renderTakeawayCart();
}

// ========== TAKEAWAY TAB - RENDER CART ==========
function _renderTakeawayCart() {
    var listEl = document.getElementById('takeawayCartList');
    var totalEl = document.getElementById('takeawayCartTotal');
    var countEl = document.getElementById('takeawayCartCount');
    if (!listEl || !totalEl) return;
    
    if (_takeawayCart.length === 0) {
        listEl.innerHTML = '<div class="empty-text" style="padding:20px;">🛒 Giỏ hàng trống</div>';
        totalEl.textContent = '0đ';
        if (countEl) countEl.textContent = '0 món';
        return;
    }
    
    var html = '';
    var total = 0;
    var totalQty = 0;
    for (var i = 0; i < _takeawayCart.length; i++) {
        var item = _takeawayCart[i];
        var qty = item.qty || 1;
        var itemTotal = (item.price || 0) * qty;
        total += itemTotal;
        totalQty += qty;
        html += '<div class="cart-item-row">' +
            '<div class="cart-item-content">' +
                '<span class="cart-item-name">' + escapeHtml(item.name || '') + '</span>' +
                '<div class="cart-item-qty">' +
                    '<button class="cart-qty-btn" onclick="_takeawayUpdateQty(' + i + ', -1)">−</button>' +
                    '<span class="cart-qty-num">' + qty + '</span>' +
                    '<button class="cart-qty-btn" onclick="_takeawayUpdateQty(' + i + ', 1)">+</button>' +
                '</div>' +
                '<span class="cart-item-total">' + formatMoney(itemTotal) + '</span>' +
            '</div>' +
        '</div>';
    }
    listEl.innerHTML = html;
    totalEl.textContent = formatMoney(total);
    if (countEl) countEl.textContent = totalQty + ' món';
}

function _takeawayUpdateQty(index, delta) {
    if (index < 0 || index >= _takeawayCart.length) return;
    var newQty = (_takeawayCart[index].qty || 1) + delta;
    if (newQty <= 0) {
        _takeawayCart.splice(index, 1);
    } else {
        _takeawayCart[index].qty = newQty;
    }
    _renderTakeawayCart();
}

// ========== TAKEAWAY TAB - THANH TOÁN ==========
function _takeawayPay(method) {
    if (!_takeawayCart.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    // Copy _takeawayCart vào tempOrder để handleTakeawayPayment dùng
    tempOrder = _cloneArr(_takeawayCart);
    handleTakeawayPayment(method);
    // Clear _takeawayCart (sau khi thanh toán, tempOrder đã bị clear trong closeModal)
    _takeawayCart = [];
    _renderTakeawayCart();
}

function _takeawayGrab() {
    if (!_takeawayCart.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    tempOrder = _cloneArr(_takeawayCart);
    handleGrabOrder();
    _takeawayCart = [];
    _renderTakeawayCart();
}

// ========== TAKEAWAY TAB - XÓA GIỎ HÀNG ==========
function _takeawayClearCart() {
    if (!_takeawayCart.length) return;
    if (!confirm('Xóa toàn bộ giỏ hàng?')) return;
    _takeawayCart = [];
    _renderTakeawayCart();
}

// ========== TAKEAWAY TAB - TẠO BÀN MỚI ==========
function _takeawayCreateNewTable() {
    if (!_takeawayCart.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    // Prompt nhập tên bàn
    var tableName = prompt('Nhập tên bàn mới:', '');
    if (!tableName || tableName.trim() === '') return;
    tableName = tableName.trim();
    
    // Kiểm tra tên bàn đã tồn tại
    var tables = cachedTables || [];
    for (var i = 0; i < tables.length; i++) {
        if (tables[i].name === tableName) {
            showToast('❌ Bàn "' + tableName + '" đã tồn tại!', 'error');
            return;
        }
    }
    
    // Tạo bàn mới
    var newId = Date.now().toString();
    var now = new Date();
    var items = [];
    for (var i = 0; i < _takeawayCart.length; i++) {
        var item = _takeawayCart[i];
        items.push({
            name: item.name,
            price: item.price,
            qty: item.qty,
            addedTime: now.toISOString()
        });
    }
    var total = 0;
    for (var i = 0; i < items.length; i++) {
        total += items[i].price * items[i].qty;
    }
    
    var currentUser = DB.getCurrentUser();
    var newTable = {
        id: newId,
        name: tableName,
        status: 'occupied',
        time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        startTime: now.toISOString(),
        items: items,
        total: total,
        customerId: null,
        customerName: null,
        createdByName: (currentUser && currentUser.displayName) || '',
        createdByRole: (currentUser && currentUser.role) || ''
    };
    
    showToast('⏳ Đang tạo bàn...', 'info', 0);
    DB.create('tables', newTable, newId).then(function() {
        showToast('✅ Đã tạo bàn "' + tableName + '" và gửi ' + items.length + ' món', 'success');
        _takeawayCart = [];
        _renderTakeawayCart();
        // Chuyển sang tab bàn để xem
        switchTab('tables');
    }).catch(function(err) {
        showToast('❌ Lỗi tạo bàn: ' + (err.message || err), 'error');
    });
}
