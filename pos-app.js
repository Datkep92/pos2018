// pos-app.js - App RÚT GỌN cho giao diện POS riêng
// Chỉ load các collection POS cần: menu, menu_categories, customers, tables, transactions
// ES5, tương thích Android 6, iOS 12

// ========== NHẬN DIỆN THIẾT BỊ YẾU (chạy sớm nhất) ==========
// Gắn class 'low-end' lên <html> để CSS bỏ box-shadow và will-change -
// hai thứ tốn nhiều nhất khi vẽ lại trên máy cấu hình thấp.
// Tiêu chí: RAM <= 2GB hoặc <= 2 lõi CPU.
// Thiếu thông tin (trình duyệt cũ) thì coi như máy mạnh, không can thiệp.
(function () {
    try {
        var mem = navigator.deviceMemory;      // undefined ở Safari/Firefox cũ
        var cores = navigator.hardwareConcurrency;
        var weak = false;
        if (typeof mem === 'number' && mem <= 2) weak = true;
        if (typeof cores === 'number' && cores <= 2) weak = true;
        // WebView Android 6 thường báo 2 lõi -> coi là yếu
        if (weak) {
            document.documentElement.className += ' low-end';
            console.log('📉 Phát hiện thiết bị cấu hình thấp - bật chế độ nhẹ giao diện');
        }
    } catch (e) {}
})();

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

// PHASE 4: Deferred loading queue - các tác vụ không critical sẽ chạy sau
var _deferredTasks = [];
function _addDeferredTask(name, fn) {
    _deferredTasks.push({ name: name, fn: fn });
}
function _runDeferredTasks() {
    if (_deferredTasks.length === 0) return;
    // OPTIMIZE: Dùng requestIdleCallback để chạy khi CPU rảnh, không block UI
    // Fallback về setTimeout nếu browser không hỗ trợ requestIdleCallback
    var useIdleCallback = typeof window.requestIdleCallback === 'function';
    
    function _executeNextTask() {
        if (_deferredTasks.length === 0) return;
        var task = _deferredTasks.shift(); // Lấy task đầu tiên, chạy từng cái một
        console.log('[Deferred] ⏳ Đang chạy: ' + task.name);
        try {
            var result = task.fn();
            if (result && typeof result.then === 'function') {
                result.then(function() {
                    console.log('[Deferred] ✅ Hoàn thành: ' + task.name);
                    // Lên lịch chạy task tiếp theo khi CPU rảnh
                    if (_deferredTasks.length > 0) {
                        if (useIdleCallback) {
                            requestIdleCallback(_executeNextTask, { timeout: 1000 });
                        } else {
                            setTimeout(_executeNextTask, 50); // Delay nhẹ để UI có thời gian response
                        }
                    }
                }).catch(function(err) {
                    console.warn('[Deferred] ⚠️ Lỗi ' + task.name + ':', err);
                    if (_deferredTasks.length > 0) {
                        if (useIdleCallback) {
                            requestIdleCallback(_executeNextTask, { timeout: 1000 });
                        } else {
                            setTimeout(_executeNextTask, 50);
                        }
                    }
                });
            } else {
                console.log('[Deferred] ✅ Hoàn thành: ' + task.name);
                if (_deferredTasks.length > 0) {
                    if (useIdleCallback) {
                        requestIdleCallback(_executeNextTask, { timeout: 1000 });
                    } else {
                        setTimeout(_executeNextTask, 50);
                    }
                }
            }
        } catch(e) {
            console.warn('[Deferred] ⚠️ Lỗi ' + task.name + ':', e);
            if (_deferredTasks.length > 0) {
                if (useIdleCallback) {
                    requestIdleCallback(_executeNextTask, { timeout: 1000 });
                } else {
                    setTimeout(_executeNextTask, 50);
                }
            }
        }
    }
    
    // Bắt đầu chạy task đầu tiên khi CPU rảnh
    if (useIdleCallback) {
        requestIdleCallback(_executeNextTask, { timeout: 1000 });
    } else {
        setTimeout(_executeNextTask, 50);
    }
}

// Loading screen helpers
function _updateLoadingText(text) {
    var el = document.getElementById('loadingText');
    if (el) el.innerText = text;
}
function _hideLoadingScreen() {
    var overlay = document.getElementById('loadingOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        // Xóa khỏi DOM sau khi animation kết thúc để giải phóng bộ nhớ
        setTimeout(function() {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 500);
    }
}
// Bảng "đang đồng bộ" nhỏ ở góc màn hình.
// Dùng để nói với người dùng rằng app đã dùng được nhưng dữ liệu đang được
// làm mới ở nền - tránh họ thấy giao diện rồi tưởng đã xong rồi thao tác.
var _syncNoticeEl = null;
function _showSyncingNotice(show) {
    try {
        if (show) {
            if (_syncNoticeEl) return;
            var el = document.createElement('div');
            el.id = 'syncingNotice';
            el.textContent = '⟳ Đang cập nhật dữ liệu...';
            el.style.cssText = 'position:fixed;top:6px;right:6px;z-index:99998;' +
                'background:rgba(0,0,0,.72);color:#fff;font-size:12px;padding:6px 12px;' +
                'border-radius:14px;pointer-events:none;font-family:sans-serif;' +
                'box-shadow:0 2px 8px rgba(0,0,0,.3)';
            document.body.appendChild(el);
            _syncNoticeEl = el;
        } else if (_syncNoticeEl) {
            if (_syncNoticeEl.parentNode) _syncNoticeEl.parentNode.removeChild(_syncNoticeEl);
            _syncNoticeEl = null;
        }
    } catch(e) {}
}

// Cập nhật tên quán trên loading screen (nếu đã có shopInfo)
function _updateLoadingShopName() {
    var titleEl = document.getElementById('loadingTitle');
    if (!titleEl) return;
    var name = '';
    if (window.shopInfo && window.shopInfo.name) {
        name = window.shopInfo.name;
    } else if (window._cachedShopName) {
        name = window._cachedShopName;
    }
    if (name) {
        titleEl.textContent = name;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // OPTIMIZE: Khôi phục UI từ sessionStorage ngay lập tức (nếu có)
    // Giúp UI hiển thị ngay trong khi chờ DB.init() và loadData() hoàn tất
    _restoreFromSessionCache();
    
    _updateLoadingText('Đang kết nối cơ sở dữ liệu...');
    
    // FIX: Gọi DB.init() TRƯỚC, sau đó mới initRealtime()
    // Đảm bảo database đã sẵn sàng trước khi đăng ký subscriptions
    DB.init().then(function() {
        _updateLoadingText('Đang xác thực...');
        if (typeof initAuth === 'function') {
            initAuth();
        }
        _updateLoadingText('Đang tải dữ liệu...');
        return loadData();
    }).then(function() {
        // OPTIMIZE: Lưu vào sessionCache sau khi loadData thành công
        _saveToSessionCache();
    }).then(function() {
        _updateLoadingText('Đang tải đơn tạm...');
        return loadDraftOrders();
    }).then(function() {
        // VẼ UI TRƯỚC, kết nối realtime SAU.
        // switchTab() chỉ đọc cachedTables/menuItems đã nạp ở trên, không cần
        // mạng. Còn initRealtime() kích hoạt ref.on('child_added') cho tables,
        // Firebase sẽ gửi về TOÀN BỘ danh sách bàn - nếu gọi trước thì người dùng
        // phải chờ cú tải đó mới nhìn thấy màn hình.
        // Mặc định hiển thị tab Mang đi (mangdi.html),
        // index.html có thể set window._defaultTab = 'tables' trước khi load pos-app.js
        switchTab(window._defaultTab || 'takeaway');
        
        // Realtime + listener nền: chạy sau khi UI đã hiện
        setTimeout(function() {
            _updateLoadingText('Đang khởi tạo kết nối thời gian thực...');
            initRealtime();
        }, 0);
        
        initEventListeners();
        
        // ========== CHỜ ĐỒNG BỘ NỀN XONG ==========
        // UI đã hiện (dựng từ IndexedDB, vài chục ms). Đồng bộ chạy nền trong
        // DB.init(). Ở đây chỉ chờ nó xong để bổ sung những gì mới, thay vì
        // chặn người dùng ngay từ đầu.
        
        // TRƯỜNG HỢP 1: local rỗng (IndexedDB bị xoá / cài mới).
        // Lúc này không có gì để hiển thị, buộc phải tải. Nhưng vẫn cho UI lên
        // trước, chỉ hiện thông báo đang tải, xong tự điền vào.
        if (_isDataEmpty()) {
            console.log('⚠️ Local data rỗng, sẽ tải từ server...');
            _showSyncingNotice(true);
            DB.forceSyncFromFirebase().then(function() {
                return loadData();
            }).then(function() {
                _showSyncingNotice(false);
                if (typeof renderTables === 'function') renderTables();
                if (typeof renderCustomerList === 'function') renderCustomerList();
                showToast('Đã tải dữ liệu từ server', 'success');
            }).catch(function(err) {
                console.error('⚠️ Force sync failed (may be offline):', err);
                _showSyncingNotice(false);
                showToast('⚠️ Không thể đồng bộ dữ liệu từ server', 'warning', 3000);
            });
            // FIX man hinh khoi tao ket vinh vien:
            // Nhanh nay return som nen BO QUA _hideLoadingScreen() o cuoi ham.
            // Trieu chung: cai app lan dau, may POS ket mai o man hinh
            // 'Dang khoi tao ket noi thoi gian thuc...' du database da ket noi
            // xong va da dong bo thanh cong.
            // Chi xay ra khi local rong - tuc la DUNG truong hop cai moi.
            // An o day; thanh 'Dang dong bo du lieu...' van hien trong luc cho.
            _hideLoadingScreen();
            return;
        }
        
        // TRƯỜNG HỢP 2: có dữ liệu local. Chờ đồng bộ nền xong rồi cập nhật.
        _showSyncingNotice(true);
        
        // Hàm cập nhật lại giao diện sau khi đồng bộ.
        // Gọi lại nhiều lần được vì renderTables() tự đọc nguồn dữ liệu mới nhất.
        function _refreshAfterSync() {
            return Promise.all([
                DB.getAll('menu'),
                DB.getAll('customers'),
                DB.getAll('tables')
            ]).then(function(res) {
                if (!res) return;
                if (res[0] && res[0].length) {
                    menuItems = res[0];
                    _invalidateMenuCache();
                    menuItems.sort(function(a, b) {
                        var oa = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 9999;
                        var ob = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 9999;
                        return oa - ob;
                    });
                    window.menuItems = menuItems;
                }
                if (res[1] && res[1].length) {
                    customers = res[1];
                    window.customers = customers;
                }
                if (typeof _invalidateCustomerCalcCache === 'function') _invalidateCustomerCalcCache();
                if (typeof updateCustomerCalcCache === 'function') updateCustomerCalcCache();
                
                // Bàn: luôn render lại. renderTables() tự đọc lại nguồn dữ liệu
                // nên không phụ thuộc biến cachedTables bên ngoài.
                if (typeof renderTables === 'function') renderTables();
                if (currentTab === 'customers' && typeof renderCustomerList === 'function') renderCustomerList();
                if (typeof updateRecentToast === 'function') updateRecentToast();
                if (typeof startTableTimer === 'function') startTableTimer();
            });
        }
        
        // Lượt 1: chờ đồng bộ nền. whenSyncComplete() có giới hạn 12s nên không
        // bao giờ treo.
        DB.whenSyncComplete().then(function() {
            _showSyncingNotice(false);
            return _refreshAfterSync();
        })['catch'](function(err) {
            _showSyncingNotice(false);
            console.warn('⚠️ Cập nhật sau đồng bộ lỗi:', err);
        });
        
        // Lượt 2: chốt an toàn. Nếu lượt 1 bị timeout hoặc sync chậm, vẫn thử
        // làm mới lại sau 5s. Đây là lưới an toàn để danh sách bàn không bao giờ
        // đứng ở dữ liệu cũ.
        setTimeout(function() {
            _refreshAfterSync()['catch'](function(){});
        }, 5000);
        // Khôi phục trạng thái recentToast (thu gọn/mở rộng)
        if (typeof restoreRecentToastState === 'function') {
            restoreRecentToastState();
        }
        renderCurrentTime();
        
        // PHASE 4: Deferred loading - các module không critical chạy sau UI
        if (typeof initNotifications === 'function') {
            _addDeferredTask('initNotifications', initNotifications);
        }
        // Khởi tạo chat nội bộ
        if (typeof initChat === 'function') {
            _addDeferredTask('initChat', initChat);
        }
        // OPTIMIZE: Khởi tạo event delegation cho menu grid (thay vì inline onclick)
        if (typeof _initMenuEventDelegation === 'function') {
            _addDeferredTask('initMenuEventDelegation', _initMenuEventDelegation);
        }
        // PHASE 4: Deferred load non-critical data (customers, ingredients, tables)
        // OPTIMIZE: Dùng memory cache thay vì IndexedDB reads để không block UI thread
        // loadData() đã load các collection này vào memory cache và window object rồi
        _addDeferredTask('loadCustomers', function() {
            // Đọc từ memory cache (nhanh, không block UI) thay vì IndexedDB
            var cached = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('customers') : null;
            if (cached) {
                customers = cached;
                window.customers = customers;
                return Promise.resolve();
            }
            // Fallback: chỉ đọc IndexedDB nếu memory cache không có
            return DB.getAll('customers').then(function(list) {
                customers = list;
                window.customers = customers;
            });
        });
        _addDeferredTask('loadIngredients', function() {
            var cached = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('ingredients') : null;
            if (cached) {
                ingredients = cached;
                window.ingredients = ingredients;
                return Promise.resolve();
            }
            return DB.getAll('ingredients').then(function(list) {
                ingredients = list;
                window.ingredients = ingredients;
            });
        });
        _addDeferredTask('loadTables', function() {
            var cached = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('tables') : null;
            if (cached) {
                cachedTables = cached;
                tablesCacheTime = Date.now();
                return Promise.resolve();
            }
            return DB.getAll('tables').then(function(list) {
                cachedTables = list;
                tablesCacheTime = Date.now();
            });
        });
        
        // Chạy deferred tasks sau 2s để UI kịp render
        setTimeout(_runDeferredTasks, 2000);
        
        setInterval(renderCurrentTime, 30000);
        
        // Ẩn loading screen và hiển thị thông báo sẵn sàng
        _hideLoadingScreen();
        showToast('POS sẵn sàng', 'success');
    }).catch(function(err) {
        // FIX: Catch mọi lỗi để đảm bảo UI không bị treo
        console.error('❌ Initialization error:', err);
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
    // Đọc từ memoryCache trước (nếu có), fallback về IndexedDB.
    // memoryCache được populate bởi loadFromLocal/smartSync, nhanh hơn IndexedDB.
    //
    // QUAN TRỌNG: đồng bộ nay chạy NỀN, có thể đang ghi memoryCache đúng lúc này.
    // Đọc giữa chừng có thể thấy dữ liệu thiếu, nên ưu tiên IndexedDB (ảnh chụp
    // nhất quán tại một thời điểm) khi đồng bộ chưa xong. IndexedDB đọc nhanh và
    // luôn cho ra dữ liệu đầy đủ của phiên trước; phần mới sẽ tới sau qua
    // event menu:synced / tables:synced.
    var _syncDone = (typeof DB.getSyncState === 'function') ? (DB.getSyncState() === 'done') : true;
    var menuFromCache = _syncDone ? ((typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('menu') : null) : null;
    var menuCatFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('menu_categories') : null;
    var customersFromCache = _syncDone ? ((typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('customers') : null) : null;
    var ingredientsFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('ingredients') : null;
    var tablesFromCache = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('tables') : null;
    
    // Nếu memoryCache có đủ menu + customers -> dùng luôn, không cần đợi IndexedDB
    if (menuFromCache && customersFromCache) {
        menuItems = menuFromCache;
        _invalidateMenuCache();
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
            // Cache tên quán để loading screen có thể hiển thị
            if (shopInfo && shopInfo.name) {
                window._cachedShopName = shopInfo.name;
                _updateLoadingShopName();
            }
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
        _invalidateMenuCache();
        // Sắp xếp menuItems theo sortOrder để kéo thả hoạt động đúng
        menuItems.sort(function(a, b) {
            var orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 9999;
            var orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 9999;
            return orderA - orderB;
        });
        menuCategories = results[1] || [];
        
        // FIX: Khi IndexedDB trả về rỗng (do fullSync đang clear + rewrite),
        // giữ nguyên dữ liệu từ sessionStorage để tránh mất khách hàng
        // Race condition: fullSync() clear IndexedDB trước, sau đó mới lưu từng item qua chain
        // Nếu loadData() đọc giữa lúc đó, IndexedDB trả về [] -> ghi đè customers = []
        var customersFromDB = results[2] || [];
        if (customersFromDB.length > 0) {
            customers = customersFromDB;
        } else if (window.customers && window.customers.length > 0) {
            // Giữ nguyên dữ liệu từ sessionStorage (đã được _restoreFromSessionCache khôi phục)
            console.log('[LoadData] IndexedDB customers rỗng, giữ dữ liệu từ sessionStorage:', window.customers.length, 'khách');
            customers = window.customers;
        } else {
            customers = [];
        }
        
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

    // FIX: Event delegation cho filter-chip (cả trong #historyFilterChips và #historyStaffChips)
    // Dùng delegation trên container cha để tránh phải gán lại listener khi staff chips được tạo động
    var historyView = document.getElementById('historyView');
    if (historyView) {
        historyView.addEventListener('click', function(e) {
            var chip = e.target;
            // Kiểm tra nếu click vào .filter-chip (hoặc .staff-chip)
            if (chip && chip.classList && chip.classList.contains('filter-chip')) {
                // Bỏ active tất cả chip
                var allChips = document.querySelectorAll('#historyFilterChips .filter-chip, #historyStaffChips .filter-chip');
                for (var j = 0; j < allChips.length; j++) {
                    allChips[j].classList.remove('active');
                }
                chip.classList.add('active');
                renderHistoryByDate(currentHistoryDate);
            }
        });
    }

    // Nút chuyển ngày của tab Báo cáo. changeReportDate() chỉ tồn tại trong
    // report.js / pos.js — KHÔNG được load. Hai nút này cũng không tồn tại
    // (index.html không có reportView / reportPrevDayBtn), nên `if (btn)` luôn
    // false. Nhưng nếu sau này thêm tab Báo cáo mà quên load report.js, bấm nút
    // sẽ nổ ReferenceError. Dùng helper cho an toàn.
    var reportPrevDayBtn = document.getElementById('reportPrevDayBtn');
    if (reportPrevDayBtn) reportPrevDayBtn.onclick = function() { _changeReportDateSafe(-1); };

    var reportNextDayBtn = document.getElementById('reportNextDayBtn');
    if (reportNextDayBtn) reportNextDayBtn.onclick = function() { _changeReportDateSafe(1); };

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
    // FIX: confirmSplitBtn bị showSplitBillModal() XÓA khỏi DOM (hàm này thay thế
    // toàn bộ innerHTML của #splitBillModal .form-actions bằng 4 nút mới: TM / CK /
    // Nợ / Hủy, mỗi nút gắn onclick riêng). Nên onclick gán ở đây chỉ tồn tại tới
    // lần mở modal đầu tiên rồi mất. Gỡ hẳn để không gây hiểu nhầm.
    // Lưu ý: id 'confirmSplitBtn' vẫn còn trong index.html nhưng vô nghĩa.
    var confirmSplit = document.getElementById('confirmSplitBtn');
    if (confirmSplit) confirmSplit.onclick = null;

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
        // FIX: rời tab Bàn phải đóng modal chi tiết bàn + xoá currentTableDetailId.
        // Nếu không, quay lại tab Bàn sẽ thấy modal cũ của bàn đã bị thanh toán/xóa
        // ở máy khác, các nút bấm trong đó im lặng không làm gì.
        if (currentTableDetailId) {
            if (typeof closeModal === 'function') closeModal('tableDetailModal');
            currentTableDetailId = null;
        }
        if (draftContainer) draftContainer.style.display = 'none';
        if (recentToast) recentToast.style.display = 'none';

        if (tabId === 'history') {
            renderHistoryByDate(currentHistoryDate);
        } else if (tabId === 'customers') {
            renderCustomerList();
        } else if (tabId === 'report') {
            // Dùng helper: renderReport/currentReportDate chỉ tồn tại trong
            // report.js (KHÔNG được load) → gọi trực tiếp sẽ ReferenceError.
            refreshReportIfAvailable();
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
        } else if (tabId === 'master') {
            if (typeof initMasterTab === 'function') {
                initMasterTab();
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

// ========== TOAST ==========
// Yêu cầu: chỉ hiện 1 toast tại một thời điểm.
// - Toast KHÔNG tự tắt theo thời gian (bỏ setTimeout).
// - Khi có toast mới, toast cũ bị thay thế (xoá ngay).
// - Người dùng có thể tắt thủ công bằng nút ✕ hoặc bấm vào thân toast.
// Tham số `duration` được giữ lại trong chữ ký để không phá ~100 call site
// đang truyền (2500 / 4000 / 0) - nhưng KHÔNG còn tác dụng tự tắt.
var _toastCounter = 0;
var _toastMap = {};
var _toastCurrent = null;   // id của toast đang hiện, null = không có

function _dismissToast(id) {
    var entry = _toastMap[id];
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.element && entry.element.parentNode) entry.element.remove();
    delete _toastMap[id];
    if (_toastCurrent === id) _toastCurrent = null;
}

function showToast(message, type, duration) {
    var container = document.getElementById('toastContainer');
    if (!container) return null;

    // Thay thế toast đang hiện (nếu có) - đây là điểm khác biệt chính so với bản cũ
    if (_toastCurrent !== null) {
        _dismissToast(_toastCurrent);
    }

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;

    var textSpan = document.createElement('span');
    textSpan.className = 'toast-text';
    textSpan.textContent = message;   // textContent tự escape, an toàn với tên do người dùng nhập
    toast.appendChild(textSpan);

    var id = 'toast_' + (++_toastCounter);
    toast.setAttribute('data-toast-id', id);

    // Nút ✕ tắt thủ công - cần thiết vì toast không còn tự biến mất
    var closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.setAttribute('type', 'button');
    closeBtn.setAttribute('aria-label', 'Đóng');
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = function(e) {
        e.stopPropagation();
        _dismissToast(id);
    };
    toast.appendChild(closeBtn);

    // Bấm vào thân toast cũng tắt được
    toast.onclick = function() { _dismissToast(id); };

    container.appendChild(toast);

    _toastMap[id] = { element: toast, timer: null };
    _toastCurrent = id;
    return id;
}

// Giữ tên cũ cho các call site đang dùng
function hideToast(id) {
    if (id === null || id === undefined) return;
    _dismissToast(id);
}

// Ghi thêm 1 dòng phụ vào toast ĐANG HIỆN (không tạo toast mới).
// Dùng khi cần báo nhiều thông tin cho cùng một sự kiện, tránh bị toast mới đè mất.
// Gọi nhiều lần sẽ NỐI thêm dòng, không ghi đè dòng trước.
function _setToastExtra(text) {
    if (_toastCurrent === null) return;
    var entry = _toastMap[_toastCurrent];
    if (!entry || !entry.element) return;
    var line = document.createElement('div');
    line.className = 'toast-extra';
    line.textContent = text;
    entry.element.appendChild(line);
}

// FIX: hàm này trước đây là IDENTITY (trả về chính ký tự gốc) nên không escape gì cả.
// Mọi call site (tên bàn, tên khách, tên món, tên danh mục...) đều tin vào nó -> tên có
// ký tự HTML làm vỡ giao diện, và đây là đường chèn HTML từ dữ liệu người dùng nhập.
// Phải escape đủ & < > " '.
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
// Escape chuỗi để nhúng vào attribute JS trong HTML onclick='...'
//
// SỬA LỖI NGHIÊM TRỌNG: hàm này bị THIẾU trong toàn bộ các file đang load.
// notifications.js (L390-391), messages.js (L320, 361-363, 368-370, 779-781) và
// employees.js đều gọi escapeJsString() mà không có guard -> ReferenceError
// ngay dòng đầu tiên của vòng render => danh sách thông báo / tin nhắn chat
// trắng trơn, admin không thấy gì cả.
// Comment trong notifications.js:10 và messages.js:897-901 ghi "định nghĩa DUY
// NHẤT ở pos-app.js" nhưng pos-app.js chưa bao giờ có nó. Bản định nghĩa duy
// nhất nằm ở settings-core.js — file KHÔNG được load trong index.html.
// Định nghĩa ở đây cho khớp với comment và dùng chung cho cả repo.
function escapeJsString(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/\\/g, '\\\\')   // dấu \ trước tiên, nếu không sẽ hỏng các escape sau
        .replace(/'/g, "\\'")    // dấu nháy đơn -> dùng trong onclick='...'
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/</g, '\\x3C')  // chặn </script> đóng sớm thẻ script
        .replace(/>/g, '\\x3E');
}
// Làm mới tab Báo cáo nếu app có tab đó.
//
// LÝ DO: app.js/auth.js/pos-app.js/realtime-pos.js đều gọi renderReport() và
// changeReportDate(), nhưng cả hai chỉ được định nghĩa trong report.js và pos.js
// — hai file KHÔNG được load trong index.html. Biến currentReportDate cũng
// không được định nghĩa ở bất kỳ đâu. Gọi trực tiếp sẽ ném ReferenceError.
//
// Hiện tại index.html không có data-tab="report" nên currentTab không bao giờ
// bằng 'report' và các nhánh đó là dead code — chưa nổ. Nhưng nếu sau này thêm
// tab Báo cáo (hoặc ai đó gõ tab đó tay trong console) thì lỗi nổ ngay trong
// callback realtime, giết luôn cả chuỗi xử lý. Helper này biến mọi call site
// thành an toàn: không có hàm thì bỏ qua, không báo động giả.
//
// Đặt ở pos-app.js (script #6) để realtime-pos.js (#7), auth.js (#5→gọi lúc
// runtime), settings.js (#26) đều thấy được khi hàm chạy.
function refreshReportIfAvailable() {
    if (typeof renderReport !== 'function') return false;
    try {
        // currentReportDate có thể chưa khai báo → dùng typeof để không nổ
        var d = (typeof currentReportDate !== 'undefined' && currentReportDate)
                ? currentReportDate
                : new Date();
        renderReport(d);
        return true;
    } catch (e) {
        console.error('[refreshReportIfAvailable] Lỗi render báo cáo:', e);
        return false;
    }
}
// Đổi ngày của tab Báo cáo, an toàn khi report.js chưa được load.
// Xem giải thích ở call site trong initEventListeners().
function _changeReportDateSafe(delta) {
    if (typeof changeReportDate !== 'function') {
        console.warn('[report] changeReportDate() chưa có (report.js chưa được load) — bỏ qua chuyển ngày');
        return false;
    }
    try {
        changeReportDate(delta);
        return true;
    } catch (e) {
        console.error('[report] Lỗi chuyển ngày báo cáo:', e);
        return false;
    }
}
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
    
    // FIX: đóng modal đơn phải thoát chế độ sắp xếp.
    // _isReorderMode là biến module, KHÔNG được reset ở đâu khác. Nếu người dùng
    // bật "🔀 Sắp xếp" rồi đóng modal, _isReorderMode vẫn = true. Lần sau mở modal:
    //   - handler delegation chính bắt đầu bằng `if (_isReorderMode) return;`
    //     -> bấm vào món KHÔNG thêm được vào giỏ, im lặng không có lỗi.
    //   - class 'drag-active' vẫn còn trên container.
    //   - _sortOrderChanged vẫn treo, lần bật/tắt kế tiếp sẽ ghi sortOrder
    //     của danh sách món đã bị thay đổi từ lâu.
    if (modalId === 'orderModal') {
        if (typeof _resetReorderModeOnClose === 'function') {
            _resetReorderModeOnClose();
        } else if (typeof _disableDragReorder === 'function' && typeof _getOrderMenuContainer === 'function') {
            _isReorderMode = false;
            _sortOrderChanged = false;
            var mc = _getOrderMenuContainer();
            if (mc && mc.classList) mc.classList.remove('drag-active');
            _disableDragReorder(mc);
        }
    }
    
    // FIX: đóng modal chi tiết bàn phải xoá currentTableDetailId.
    // Trước đây biến này chỉ được xoá khi rời tab hoặc khi bàn bị xoá ở máy khác.
    // Người dùng bấm ✕ đóng modal thì currentTableDetailId vẫn giữ id bàn cũ, nên
    // các đoạn kiểm tra `if (currentTableDetailId === tableId) showTableDetail(tableId)`
    // sau đó tưởng modal đang mở và TỰ MỞ LẠI modal của bàn đã đóng.
    if (modalId === 'tableDetailModal') {
        currentTableDetailId = null;
    }
    
    // FIX: đóng modal chọn khách phải xoá callback treo.
    // pendingCustomerCallback giữ closure của lần gọi trước. Nếu người dùng mở
    // modal chọn khách cho thao tác A rồi đóng, sau đó tạo khách mới từ chỗ khác
    // (createCustomerFromInput) mà không mở lại selector, callback cũ sẽ chạy
    // với khách vừa tạo -> ghi nợ/thanh toán nhầm bàn.
    if (modalId === 'customerSelectorModal') {
        pendingCustomerCallback = null;
    }
    
    // FIX: xoá các biến "đang xử lý" của modal bàn khi đóng modal đó, để không còn
    // trạng thái bàn cũ treo lại. Nếu không, ví dụ mở modal chia hóa đơn bàn A rồi
    // đóng, pendingSplitTableId vẫn là A; nếu sau đó có đường nào gọi
    // confirmSplitPaymentWithMethod mà chưa set lại pending, nó sẽ xử lý nhầm bàn A.
    if (modalId === 'splitBillModal') {
        pendingSplitTableId = null;
    }
    if (modalId === 'transferItemsModal') {
        pendingTransferSourceTable = null;
    }
    if (modalId === 'mergeTableModal') {
        pendingMergeSourceId = null;
    }
    if (modalId === 'deleteTableModal') {
        pendingDeleteTableId = null;
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

// PHASE 2: Debounce để tránh ghi sessionStorage quá nhiều lần
var _sessionCacheDebounceTimer = null;

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

// PHASE 2: Gọi _saveToSessionCache với debounce 500ms
// Được gọi từ DB.create/update/remove để session cache luôn đồng bộ
function _debouncedSaveSessionCache() {
    if (_sessionCacheDebounceTimer) {
        clearTimeout(_sessionCacheDebounceTimer);
    }
    _sessionCacheDebounceTimer = setTimeout(function() {
        _sessionCacheDebounceTimer = null;
        _saveToSessionCache();
    }, 500);
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
            _invalidateMenuCache();
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

// PHASE 3: Cache HTML cho menu items để tránh rebuild lại mỗi lần
// PHASE 4: Giới hạn kích thước cache để tránh memory leak
// ⚠️ Riêng cho tab MANG ĐI. order.js từng dùng chung biến này cho modal đơn
// (đã đổi tên thành _orderMenuHtmlCache bên đó) - dùng chung khiến 2 bên xoá
// cache của nhau mỗi lần load trang.
var _menuHtmlCache = {};
var _menuFilteredCache = null;
var _menuFilterKey = '';
var _MENU_HTML_CACHE_MAX = 20; // Tối đa 20 filter keys trong cache

function _getMenuFilterKey() {
    return (_takeawayCategory || 'all') + '|' + (_takeawaySearch || '');
}

// Xoá cache menu tab MANG ĐI.
// KHÔNG đụng cache của modal đơn (order.js) - trước đây 2 bên dùng chung biến
// _menuHtmlCache nên hàm này xoá nhầm cache modal đơn, và ngược lại
// _orderMenuHtmlCache cũng xoá cache mang đi.
function _invalidateMenuCache() {
    _menuHtmlCache = {};
    _menuFilteredCache = null;
    _menuFilterKey = '';
}

// PHASE 4: Giới hạn kích thước _menuHtmlCache - xóa entries cũ nhất khi vượt quá limit
function _trimMenuHtmlCache() {
    var keys = Object.keys(_menuHtmlCache);
    if (keys.length <= _MENU_HTML_CACHE_MAX) return;
    // Xóa các entries cũ nhất (không phải filter key hiện tại)
    var toRemove = keys.length - _MENU_HTML_CACHE_MAX;
    var removed = 0;
    for (var i = 0; i < keys.length && removed < toRemove; i++) {
        if (keys[i] !== _menuFilterKey) {
            delete _menuHtmlCache[keys[i]];
            removed++;
        }
    }
}

// ========== TAKEAWAY TAB - RENDER MENU ==========
function _renderTakeawayMenu() {
    var container = document.getElementById('takeawayMenuGrid');
    if (!container) return;
    
    var filterKey = _getMenuFilterKey();
    
    // PHASE 3: Kiểm tra cache trước
    if (_menuFilterKey === filterKey && _menuFilteredCache && _menuHtmlCache[filterKey]) {
        container.innerHTML = _menuHtmlCache[filterKey];
        return;
    }
    
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
    
    _menuFilteredCache = filtered;
    _menuFilterKey = filterKey;
    
    if (filtered.length === 0) {
        var emptyHtml = '<div class="empty-text">Không có món nào</div>';
        _menuHtmlCache[filterKey] = emptyHtml;
        _trimMenuHtmlCache();
        container.innerHTML = emptyHtml;
        return;
    }
    
    // PHASE 3: Chunked rendering - chia nhỏ batch để không block UI
    var CHUNK_SIZE = 50;
    var totalItems = filtered.length;
    var currentIndex = 0;
    
    // Clear container trước
    container.innerHTML = '';
    
    function renderChunk() {
        var fragment = document.createDocumentFragment();
        var end = Math.min(currentIndex + CHUNK_SIZE, totalItems);
        for (var i = currentIndex; i < end; i++) {
            var item = filtered[i];
            var price = item.price || 0;
            var div = document.createElement('div');
            div.className = 'takeaway-menu-item';
            div.setAttribute('data-index', i);
            // Dùng closure để capture đúng index
            div.onclick = (function(idx) {
                return function() { _takeawayAddItem(idx); };
            })(i);
            
            var nameDiv = document.createElement('div');
            nameDiv.className = 'item-name';
            nameDiv.textContent = item.name || '';
            
            var priceDiv = document.createElement('div');
            priceDiv.className = 'item-price';
            priceDiv.textContent = formatMoney(price);
            
            div.appendChild(nameDiv);
            div.appendChild(priceDiv);
            fragment.appendChild(div);
        }
        container.appendChild(fragment);
        currentIndex = end;
        
        if (currentIndex < totalItems) {
            // Còn items, schedule chunk tiếp theo
            setTimeout(renderChunk, 0);
        }
    }
    
    renderChunk();
}

// ========== TAKEAWAY TAB - ADD ITEM TO CART ==========
function _takeawayAddItem(menuIndex) {
    // PHASE 3: Dùng cached filtered list thay vì filter lại từ đầu
    var filterKey = _getMenuFilterKey();
    var filtered;
    if (_menuFilterKey === filterKey && _menuFilteredCache) {
        filtered = _menuFilteredCache;
    } else {
        filtered = [];
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
        _menuFilteredCache = filtered;
        _menuFilterKey = filterKey;
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
