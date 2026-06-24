// pos-app.js - App RÚT GỌN cho giao diện POS riêng
// Chỉ load các collection POS cần: menu, menu_categories, customers, tables, transactions
// ES5, tương thích Android 6, iOS 12

var currentTab = 'tables';
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
        // FIX: Khởi tạo realtime subscriptions SAU KHI DB đã sẵn sàng và data đã load
        // Tránh race condition: subscribeWithPolling gọi callback khi memoryCache còn rỗng
        initRealtime();
        
        // OPTIMIZE: Gọi renderTables() và updateRecentToast() SAU initRealtime()
        // để subscription callbacks có thể render UI, tránh render 2 lần
        renderTables();
        updateRecentToast();
        
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
    // OPTIMIZE: Đọc từ memoryCache trước (nếu có), fallback về IndexedDB
    // memoryCache được populate bởi smartSync() trong DB.init(), nhanh hơn IndexedDB rất nhiều
    var menuFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('menu') : null;
    var menuCatFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('menu_categories') : null;
    var customersFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('customers') : null;
    var ingredientsFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('ingredients') : null;
    
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
        // Shop config: ưu tiên dữ liệu từ Firebase (results[5]), fallback về IndexedDB (shopInfo), rồi hardcode
        var fbConfig = results[5] || {};
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
            tablesCacheTime = Date.now();
        }
        
        // Render UI ngay lập tức từ cache
        renderTables();
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
