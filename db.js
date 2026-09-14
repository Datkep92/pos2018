(function() {
    // Polyfill CustomEvent
    if (typeof window.CustomEvent !== "function") {
        function CustomEvent(event, params) {
            params = params || { bubbles: false, cancelable: false, detail: null };
            var evt = document.createEvent('CustomEvent');
            evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
            return evt;
        }
        window.CustomEvent = CustomEvent;
    }

    // Firebase Config
    var firebaseConfig = {
        apiKey: "AIzaSyCs4EWdrYMZy1fTKGBFvVjrIiW0VTWIP5Y",
  authDomain: "pos259.firebaseapp.com",
  projectId: "pos259",
        databaseURL: "https://pos259-default-rtdb.firebaseio.com",
        storageBucket: "pos259.firebasestorage.app",
  messagingSenderId: "4958283987",
  appId: "1:4958283987:web:ae456726fd89c4b0d70c26",
  measurementId: "G-2J911QJ5HQ"
    };
    firebase.initializeApp(firebaseConfig);
    var db = firebase.database();
    var auth = firebase.auth();

    // ========== MULTI-TENANT SUPPORT ==========
    var _secondaryApp = null;
    var _secondaryDb = null;
    
    // Lấy database reference hiện tại (secondary nếu có, fallback về default)
    function _getDb() {
        return _secondaryDb || db;
    }
    
    // Override firebase.database() để tất cả các module khác (employees.js, settings.js, v.v.)
    // tự động dùng đúng database (custom nếu có, default nếu không)
    // Lưu hàm gốc và tất cả static properties TRƯỚC khi override
    var _origFirebaseDatabase = firebase.database.bind(firebase);
    // Lưu ServerValue và các static properties khác từ hàm gốc
    var _origServerValue = firebase.database.ServerValue;
    // Override
    firebase.database = function() {
        return _getDb();
    };
    // Gán lại ServerValue và các static properties
    firebase.database.ServerValue = _origServerValue;
    
    // Khởi tạo với Firebase config riêng cho POS
    function initWithCustomConfig(customConfig) {
        // Dọn dẹp secondary app cũ nếu có
        if (_secondaryApp) {
            try {
                _secondaryApp.delete();
            } catch(e) {
                console.warn('⚠️ Could not delete secondary Firebase app:', e.message);
            }
            _secondaryApp = null;
            _secondaryDb = null;
        }
        
        if (!customConfig || !customConfig.databaseURL) {
            console.log('ℹ️ No custom Firebase config, using default');
            // Reset về URL mặc định
            _databaseURL = firebaseConfig.databaseURL;
            return Promise.resolve(false);
        }
        
        try {
            // Cập nhật databaseURL cho REST API shallow requests
            _databaseURL = customConfig.databaseURL;
            
            // Tạo tên app duy nhất để tránh xung đột
            var appName = 'secondary_' + Date.now();
            _secondaryApp = firebase.initializeApp(customConfig, appName);
            _secondaryDb = _secondaryApp.database();
            console.log('✅ Initialized custom Firebase config:', customConfig.projectId || 'unknown');
            return Promise.resolve(true);
        } catch(e) {
            console.error('❌ Failed to initialize custom Firebase config:', e.message);
            _secondaryApp = null;
            _secondaryDb = null;
            return Promise.reject(e);
        }
    }
    
    // Lấy custom Firebase config từ localStorage (được lưu sau khi login)
    function _loadCustomFirebaseConfig() {
        try {
            var stored = localStorage.getItem('pos_firebase_config');
            if (stored) {
                return JSON.parse(stored);
            }
        } catch(e) {}
        return null;
    }
    
    // Khởi tạo custom config từ localStorage khi load trang
    var _savedCustomConfig = _loadCustomFirebaseConfig();
    if (_savedCustomConfig) {
        initWithCustomConfig(_savedCustomConfig).catch(function(err) {
            console.warn('⚠️ Could not restore custom Firebase config:', err.message);
        });
    }
    
    // Constants
    var STORE_NAME = 'pos_data';
    
    var currentUser = null;
    var savedSession = localStorage.getItem('pos_session');
    if (savedSession) {
        try { currentUser = JSON.parse(savedSession); } catch(e) { localStorage.removeItem('pos_session'); }
    }
    
    // Đồng bộ MASTER_CONFIG nếu session là master admin
    if (currentUser && currentUser.role === 'master_admin' && typeof MASTER_CONFIG !== 'undefined' && MASTER_CONFIG) {
        MASTER_CONFIG.syncSession(currentUser);
    }
    
    var CURRENT_SHOP_ID = localStorage.getItem('current_shop_id');
    if (!CURRENT_SHOP_ID) {
        if (currentUser && currentUser.shopId) {
            CURRENT_SHOP_ID = currentUser.shopId;
            localStorage.setItem('current_shop_id', CURRENT_SHOP_ID);
        } else {
            CURRENT_SHOP_ID = 'shop_default';
        }
    }
    var CURRENT_DEVICE_ID = localStorage.getItem('device_id') || ('device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    localStorage.setItem('device_id', CURRENT_DEVICE_ID);

    var localDB = null;
    var dbReady = null;
    var syncQueue = [];
    var isOnline = navigator.onLine;
    var listeners = {};
    var _unsubscribeFns = {}; // { collection: [function] } - lưu các hàm unsubscribe để cleanup
    
    // ========== PHASE 5: DEDUP & RECONCILE ==========
    // _processedKeys: chống trùng lặp khi xử lý realtime events
    // Khi tab resume, Firebase SDK reconnect -> child_added fire lại cho tất cả items
    // _processedKeys ngăn không cho xử lý items đã được xử lý trong vòng _PROCESSED_KEYS_TTL ms
    var _processedKeys = {}; // { collection: { itemId: timestamp } }
    var _PROCESSED_KEYS_TTL = 10000; // 10 giây - đủ để chờ deltaSync hoàn tất
    
    function _isRecentlyProcessed(collection, key) {
        if (_processedKeys[collection] && _processedKeys[collection][key]) {
            var age = Date.now() - _processedKeys[collection][key];
            if (age < _PROCESSED_KEYS_TTL) {
                return true;
            }
            // Hết hạn, xóa để tránh memory leak
            delete _processedKeys[collection][key];
        }
        return false;
    }
    
    function _markProcessed(collection, key) {
        if (!_processedKeys[collection]) _processedKeys[collection] = {};
        _processedKeys[collection][key] = Date.now();
    }
    
    // Cleanup _processedKeys định kỳ - tránh memory leak
    function _cleanupProcessedKeys() {
        var now = Date.now();
        for (var col in _processedKeys) {
            if (_processedKeys.hasOwnProperty(col)) {
                for (var key in _processedKeys[col]) {
                    if (_processedKeys[col].hasOwnProperty(key)) {
                        if (now - _processedKeys[col][key] > _PROCESSED_KEYS_TTL) {
                            delete _processedKeys[col][key];
                        }
                    }
                }
                // Xóa collection object nếu rỗng
                if (Object.keys(_processedKeys[col]).length === 0) {
                    delete _processedKeys[col];
                }
            }
        }
    }
    
    // ========== PHASE 5: RECONCILIATION ENGINE ==========
    // Lấy danh sách keys từ Firebase (chỉ keys, không lấy data)
    // Dùng REST API shallow=true để tối ưu băng thông
    // Fallback về SDK once('value') nếu REST API lỗi
    
    // Lưu databaseURL để dùng cho REST API (Firebase Database Reference.toString() không hoạt động)
    var _databaseURL = firebaseConfig.databaseURL;
    
    function _getFirebaseKeys(collection) {
        // Xây dựng URL cho REST API shallow=true
        // Firebase REST API: https://<databaseURL>/<path>.json?shallow=true
        var baseUrl = _databaseURL.replace(/\/$/, '');
        var url = baseUrl + '/' + encodeURIComponent(CURRENT_SHOP_ID) + '/' + encodeURIComponent(collection) + '.json?shallow=true';
        
        // Thử dùng fetch với shallow=true trước
        if (typeof fetch === 'function') {
            return fetch(url, { cache: 'no-store' }).then(function(res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function(data) {
                var keys = {};
                if (data && typeof data === 'object') {
                    for (var key in data) {
                        if (data.hasOwnProperty(key)) keys[key] = true;
                    }
                }
                return keys;
            }).catch(function() {
                // Fallback: dùng SDK once('value') và chỉ lấy keys
                return _getFirebaseKeysViaSDK(collection);
            });
        }
        
        // Fallback: dùng SDK
        return _getFirebaseKeysViaSDK(collection);
    }
    
    function _getFirebaseKeysViaSDK(collection) {
        return new Promise(function(resolve) {
            _getDb().ref(CURRENT_SHOP_ID + '/' + collection).once('value', function(snapshot) {
                var keys = {};
                if (snapshot.exists()) {
                    var val = snapshot.val();
                    for (var key in val) {
                        if (val.hasOwnProperty(key)) keys[key] = true;
                    }
                }
                resolve(keys);
            }, function() {
                resolve({});
            });
        });
    }
    
    // Reconciliation: So sánh keys giữa Firebase và local
    // - Keys thiếu (có trên Firebase, không trong local) → tải bổ sung
    // - Keys dư (có trong local, không trên Firebase) → xóa khỏi local
    // Chỉ áp dụng cho MASTER_COLLECTIONS (tables, customers, menu, ...)
    // Date-based collections dùng deltaSync riêng
    function reconcileCollection(collection) {
        if (!isOnline) return Promise.resolve({ added: 0, removed: 0 });
        
        var isMaster = MASTER_COLLECTIONS[collection];
        if (!isMaster) {
            // Date-based collections không reconcile (dùng deltaSync)
            return deltaSync(collection).then(function() {
                return { added: 0, removed: 0 };
            });
        }
        
        return _getFirebaseKeys(collection).then(function(fbKeys) {
            // Lấy local keys từ memory cache
            var localKeys = {};
            if (memoryCache[collection]) {
                for (var key in memoryCache[collection]) {
                    if (memoryCache[collection].hasOwnProperty(key)) {
                        localKeys[key] = true;
                    }
                }
            }
            
            // Tìm keys thiếu (có trên Firebase, không trong local)
            var missingKeys = [];
            for (var key in fbKeys) {
                if (fbKeys.hasOwnProperty(key) && !localKeys[key]) {
                    missingKeys.push(key);
                }
            }
            
            // Tìm keys dư (có trong local, không trên Firebase)
            var extraKeys = [];
            for (var key in localKeys) {
                if (localKeys.hasOwnProperty(key) && !fbKeys[key]) {
                    extraKeys.push(key);
                }
            }
            
            if (missingKeys.length === 0 && extraKeys.length === 0) {
                return { added: 0, removed: 0 };
            }
            
            console.log('[Reconcile] ' + collection + ': thiếu ' + missingKeys.length + ', dư ' + extraKeys.length);
            
            var addedCount = 0;
            var removedCount = 0;
            var chain = Promise.resolve();
            
            // Tải items thiếu từ Firebase
            if (missingKeys.length > 0) {
                var fbRef = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
                for (var i = 0; i < missingKeys.length; i++) {
                    (function(missingKey) {
                        chain = chain.then(function() {
                            return fbRef.child(missingKey).once('value').then(function(itemSnapshot) {
                                if (itemSnapshot.exists()) {
                                    var src = itemSnapshot.val() || {};
                                    var item = { id: missingKey };
                                    for (var p in src) {
                                        if (src.hasOwnProperty(p)) item[p] = src[p];
                                    }
                                    if (item._version === undefined) item._version = 1;
                                    return saveToLocal(collection, item).then(function() {
                                        addedCount++;
                                    });
                                }
                            });
                        });
                    })(missingKeys[i]);
                }
            }
            
            // Xóa items dư khỏi local
            if (extraKeys.length > 0) {
                for (var i = 0; i < extraKeys.length; i++) {
                    (function(extraKey) {
                        chain = chain.then(function() {
                            return deleteFromLocal(collection, extraKey).then(function() {
                                removedCount++;
                            });
                        });
                    })(extraKeys[i]);
                }
            }
            
            return chain.then(function() {
                if (addedCount > 0 || removedCount > 0) {
                    console.log('[Reconcile] ✅ ' + collection + ': thêm ' + addedCount + ', xóa ' + removedCount);
                    // Phát sự kiện reconcile hoàn tất
                    _emit(collection + ':reconciled', { collection: collection, added: addedCount, removed: removedCount, timestamp: Date.now() });
                }
                return { added: addedCount, removed: removedCount };
            });
        });
    }
    
    // ========== SYNC META ==========
    var SYNC_META_STORE = 'sync_meta';
    var syncMetaCache = {}; // memory cache cho sync_meta
    
    var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    
    // ========== DATA RETENTION: Số ngày lưu trữ dữ liệu ==========
    // Admin: 50 ngày, Employee: 2 ngày
    function _getRetentionDays() {
        return _isEmployeeMode() ? 2 : 50;
    }
    function _getRetentionMs() {
        return _getRetentionDays() * 24 * 60 * 60 * 1000;
    }
    
    var _isEmployeeMode = function() {
        return !currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'master_admin');
    };
    
    var DATE_BASED_COLLECTIONS = {
        transactions: true,
        daily_balances: true,
        cost_transactions: true,
        inventory_transactions: true,
        ingredient_transactions: true,
        manager_cash_pickups: true,
        employee_attendance: true,
        employee_salaries: true,
        delete_logs: true,
        drawer_sessions: true,
        notifications: true
    };
    
    var MASTER_COLLECTIONS = {
        tables: true,
        customers: true,
        menu: true,
        menu_categories: true,
        ingredients: true,
        staffs: true,
        cost_categories: true,
        info: true,
        bonus_fund: true
    };
    
    var _syncTimer = null;
    var _syncPending = false;
    function _debouncedProcessSyncQueue() {
        if (_syncPending) return;
        _syncPending = true;
        if (_syncTimer) clearTimeout(_syncTimer);
        _syncTimer = setTimeout(function() {
            _syncTimer = null;
            _syncPending = false;
            processSyncQueue();
        }, 100);
    }
    
    var memoryCache = {};
    var cacheVersion = {};
    
    // FIX: Đánh dấu collection đang được fullSync để tránh race condition
    // Khi fullSync() clear IndexedDB + memoryCache, nếu loadFromLocal() đọc giữa lúc đó
    // sẽ trả về [] -> gây mất dữ liệu (vd: customers chỉ hiện 2/10)
    var _syncingCollections = {}; // { collection: true }
    
    // ========== PHASE 2: Memory Cache theo ngày ==========
    var _currentDateKey = toDateKey(Date.now()); // Ngày hiện tại
    var MEMORY_CACHE_LIMITS = {
        transactions: 2000,  // Giữ 2000 giao dịch gần nhất trong RAM (đủ cho 31 ngày)
        default: 1000
    };
    
    // Kiểm tra xem collection có nên giới hạn theo ngày không
    function _isDateBasedCollection(collection) {
        return collection === 'transactions';
    }
    
    // Lấy ngày hiện tại từ memory cache
    function _getCurrentDateKey() {
        return _currentDateKey;
    }
    
    // Cập nhật ngày hiện tại (khi user chọn ngày khác)
    function _setCurrentDateKey(dateKey) {
        if (dateKey && dateKey !== _currentDateKey) {
            var oldKey = _currentDateKey;
            _currentDateKey = dateKey;
            // Xóa transactions không thuộc ngày mới khỏi memory cache
            _cleanMemoryCacheForDateChange('transactions', oldKey, dateKey);
        }
    }
    
    // Dọn dẹp memory cache khi đổi ngày
    function _cleanMemoryCacheForDateChange(collection, oldDateKey, newDateKey) {
        if (!memoryCache[collection]) return;
        var keys = Object.keys(memoryCache[collection]);
        for (var i = 0; i < keys.length; i++) {
            var item = memoryCache[collection][keys[i]];
            if (item && item.dateKey && item.dateKey !== newDateKey) {
                delete memoryCache[collection][keys[i]];
            }
        }
        console.log('[Cache] Đã dọn ' + collection + ' khi đổi ngày: ' + oldDateKey + ' -> ' + newDateKey + ', còn ' + Object.keys(memoryCache[collection]).length + ' items');
    }
    
    // Giới hạn kích thước memory cache cho 1 collection
    // Chỉ log 1 lần cho mỗi collection khi có xóa, tránh tràn log
    var _enforceLogged = {};
    function _enforceMemoryCacheLimit(collection) {
        if (!memoryCache[collection]) return;
        var limit = MEMORY_CACHE_LIMITS[collection] || MEMORY_CACHE_LIMITS.default;
        var keys = Object.keys(memoryCache[collection]);
        if (keys.length <= limit) return;
        
        // Sắp xếp theo createdAt (cũ nhất trước)
        var sorted = keys.slice().sort(function(a, b) {
            var aTime = memoryCache[collection][a].createdAt || memoryCache[collection][a].updatedAt || 0;
            var bTime = memoryCache[collection][b].createdAt || memoryCache[collection][b].updatedAt || 0;
            return aTime - bTime;
        });
        
        var toRemove = sorted.slice(0, keys.length - limit);
        for (var i = 0; i < toRemove.length; i++) {
            delete memoryCache[collection][toRemove[i]];
            // PHASE 4: Dọn cache timestamp tương ứng
            if (_cacheTimestamps[collection]) {
                delete _cacheTimestamps[collection][toRemove[i]];
            }
        }
        // Chỉ log 1 lần cho mỗi collection để tránh tràn log
        if (!_enforceLogged[collection]) {
            _enforceLogged[collection] = true;
            console.log('[Cache] Đã giới hạn ' + collection + ': xóa ' + toRemove.length + ' items cũ, còn ' + limit + ' items');
        }
    }
    
    // ========== PHASE 4: TTL Cache & Periodic Cleanup ==========
    var _cacheTimestamps = {}; // { collection: { key: timestamp } } - lưu thời điểm cache
    var _CACHE_TTL = 30 * 60 * 1000; // 30 phút
    var _cleanupIntervalId = null;
    
    // Ghi lại thời điểm cache 1 item
    function _markCacheTime(collection, key) {
        if (!_cacheTimestamps[collection]) _cacheTimestamps[collection] = {};
        _cacheTimestamps[collection][key] = Date.now();
    }
    
    // Kiểm tra cache còn hạn không
    function _isCacheValid(collection, key) {
        if (!_cacheTimestamps[collection] || !_cacheTimestamps[collection][key]) return false;
        return (Date.now() - _cacheTimestamps[collection][key]) < _CACHE_TTL;
    }
    
    // Dọn dẹp cache cũ định kỳ
    function _periodicCacheCleanup() {
        var now = Date.now();
        var totalRemoved = 0;
        
        // Các master collections KHÔNG bị xóa khỏi memory cache vì:
        // 1. Dữ liệu ít thay đổi, cần luôn sẵn sàng cho UI
        // 2. Nếu bị xóa, loadData() sẽ fallback về IndexedDB có thể trả về [] (race condition với fullSync)
        // 3. Gây lỗi hiển thị thiếu dữ liệu (vd: customers chỉ hiện 2/10)
        var _masterCollections = {
            customers: true,
            menu: true,
            menu_categories: true,
            ingredients: true,
            tables: true,
            info: true
        };
        
        // Dọn memoryCache items quá hạn
        for (var col in memoryCache) {
            if (!memoryCache.hasOwnProperty(col)) continue;
            if (col === 'transactions') continue; // transactions đã có cơ chế riêng
            if (_masterCollections[col]) continue; // master collections giữ nguyên
            var keys = Object.keys(memoryCache[col]);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (!_isCacheValid(col, key)) {
                    delete memoryCache[col][key];
                    totalRemoved++;
                }
            }
        }
        
        // Dọn _cacheTimestamps cũ
        for (var col in _cacheTimestamps) {
            if (!_cacheTimestamps.hasOwnProperty(col)) continue;
            var tsKeys = Object.keys(_cacheTimestamps[col]);
            for (var i = 0; i < tsKeys.length; i++) {
                if ((now - _cacheTimestamps[col][tsKeys[i]]) > _CACHE_TTL * 2) {
                    delete _cacheTimestamps[col][tsKeys[i]];
                }
            }
        }
        
        // PHASE 4: Dọn _txDateCacheTimestamps cũ
        var txKeys = Object.keys(_txDateCacheTimestamps);
        for (var i = 0; i < txKeys.length; i++) {
            if ((now - _txDateCacheTimestamps[txKeys[i]]) > _TX_DATE_CACHE_TTL * 3) {
                delete _txDateCache[txKeys[i]];
                delete _txDateCacheTimestamps[txKeys[i]];
                totalRemoved++;
            }
        }
        
        if (totalRemoved > 0) {
            console.log('[Cache] 🧹 Periodic cleanup: đã xóa ' + totalRemoved + ' items quá hạn');
        }
    }
    
    // Khởi động periodic cleanup (gọi sau khi DB.init hoàn tất)
    function _startPeriodicCleanup() {
        if (_cleanupIntervalId) return;
        _cleanupIntervalId = setInterval(_periodicCacheCleanup, 5 * 60 * 1000); // 5 phút
    }
    
    var _localCallbacks = {};
    
    // Event types: 'collection:added', 'collection:changed', 'collection:removed'
    var _eventBus = {};
    
    function _on(eventType, callback) {
        if (!_eventBus[eventType]) _eventBus[eventType] = [];
        _eventBus[eventType].push(callback);
        return function() {
            _off(eventType, callback);
        };
    }
    
    function _off(eventType, callback) {
        var cbs = _eventBus[eventType];
        if (!cbs) return;
        for (var i = cbs.length - 1; i >= 0; i--) {
            if (cbs[i] === callback) {
                cbs.splice(i, 1);
            }
        }
    }
    
    function _emit(eventType, data) {
        var cbs = _eventBus[eventType];
        if (cbs) {
            for (var i = 0; i < cbs.length; i++) {
                try { cbs[i](data); } catch(e) { console.error('[EventBus] Lỗi handler ' + eventType + ':', e); }
            }
        }
        var parts = eventType.split(':');
        if (parts.length === 2) {
            var wildcard = parts[0] + ':*';
            var wildcardCbs = _eventBus[wildcard];
            if (wildcardCbs) {
                for (var i = 0; i < wildcardCbs.length; i++) {
                    try { wildcardCbs[i]({ type: parts[1], collection: parts[0], data: data }); } catch(e) { console.error('[EventBus] Lỗi wildcard handler ' + wildcard + ':', e); }
                }
            }
        }
    }
    
    var _componentRegistry = {};  // { collection: [ { id, selector, renderFn, lastData } ] }
    var _componentIdCounter = 0;

    function _renderOn(collection, selector, renderFn) {
        if (!_componentRegistry[collection]) {
            _componentRegistry[collection] = [];
        }
        var id = ++_componentIdCounter;
        var entry = {
            id: id,
            selector: typeof selector === 'function' ? selector : null,
            renderFn: renderFn,
            lastData: null
        };
        _componentRegistry[collection].push(entry);
        if (memoryCache[collection]) {
            var data = [];
            for (var key in memoryCache[collection]) {
                if (memoryCache[collection].hasOwnProperty(key)) {
                    data.push(memoryCache[collection][key]);
                }
            }
            entry.lastData = data;
            try { renderFn(data); } catch(e) { console.error('[ComponentRegistry] Lỗi render lần đầu:', e); }
        }
        return function() {
            var entries = _componentRegistry[collection];
            if (!entries) return;
            for (var i = entries.length - 1; i >= 0; i--) {
                if (entries[i].id === id) {
                    entries.splice(i, 1);
                    break;
                }
            }
        };
    }

    // PHASE 2: Tối ưu _notifyComponents - chỉ gửi delta thay vì toàn bộ collection
    function _notifyComponents(collection, changeInfo) {
        var entries = _componentRegistry[collection];
        if (!entries || entries.length === 0) return;
        
        // Nếu có changeInfo với item cụ thể, tạo delta data
        var deltaData = null;
        if (changeInfo && changeInfo.item) {
            deltaData = changeInfo.item;
        }
        
        // Chỉ rebuild toàn bộ array khi cần (selector cần so sánh)
        var fullData = null;
        var needsFullData = false;
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].selector) {
                needsFullData = true;
                break;
            }
        }
        
        if (needsFullData && memoryCache[collection]) {
            fullData = [];
            for (var key in memoryCache[collection]) {
                if (memoryCache[collection].hasOwnProperty(key)) {
                    fullData.push(memoryCache[collection][key]);
                }
            }
        }
        
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var shouldRender = true;
            if (entry.selector) {
                try {
                    shouldRender = entry.selector(entry.lastData, fullData, changeInfo);
                } catch(e) {
                    console.error('[ComponentRegistry] Lỗi selector:', e);
                    shouldRender = true;
                }
            }
            if (shouldRender) {
                // PHASE 2: Gửi delta data (item thay đổi) kèm changeInfo
                // Render function có thể dùng changeInfo.type để biết là 'added'/'changed'/'removed'
                entry.lastData = fullData;
                try {
                    entry.renderFn(fullData, {
                        type: changeInfo ? changeInfo.type : null,
                        item: deltaData,
                        collection: collection,
                        timestamp: Date.now()
                    });
                } catch(e) {
                    console.error('[ComponentRegistry] Lỗi render:', e);
                }
            }
        }
    }

    var _suppressRealtime = 0;
    var _pendingNotifyCollections = {};

    function toDateKey(value) {
        if (!value) return '';
        if (typeof value === 'string') {
            if (value.indexOf('T') >= 0 || value.indexOf('Z') >= 0 || value.indexOf('+') >= 0) {
                var parsed = Date.parse(value);
                if (!isNaN(parsed)) {
                    var d = new Date(parsed);
                    var y = d.getFullYear();
                    var m = ('0' + (d.getMonth() + 1)).slice(-2);
                    var day = ('0' + d.getDate()).slice(-2);
                    return y + '-' + m + '-' + day;
                }
            }
            if (value.length >= 10 && value[4] === '-' && value[7] === '-') return value.slice(0, 10);
            var parsed = Date.parse(value);
            if (!isNaN(parsed)) {
                var d = new Date(parsed);
                var y = d.getFullYear();
                var m = ('0' + (d.getMonth() + 1)).slice(-2);
                var day = ('0' + d.getDate()).slice(-2);
                return y + '-' + m + '-' + day;
            }
            return '';
        }
        if (typeof value === 'number') {
            var d = new Date(value);
            var y = d.getFullYear();
            var m = ('0' + (d.getMonth() + 1)).slice(-2);
            var day = ('0' + d.getDate()).slice(-2);
            return y + '-' + m + '-' + day;
        }
        return '';
    }

    function normalizeIndexedFields(collection, data) {
        if (!data || typeof data !== 'object') return data;
        if (collection !== 'transactions') return data;
        var norm = {};
        for (var k in data) if (data.hasOwnProperty(k)) norm[k] = data[k];
        var dateKey = toDateKey(norm.date || norm.createdAt || norm.updatedAt);
        norm.dateKey = dateKey;
        norm.type = norm.type || 'unknown';
        norm.dateTypeKey = dateKey + '|' + norm.type;
        return norm;
    }

    var _lastChangeInfo = {};
    function _notifyLocal(collection, changeInfo) {
        if (_suppressRealtime > 0) {
            _pendingNotifyCollections[collection] = true;
            return;
        }
        if (changeInfo && changeInfo.type) {
            var eventType = collection + ':' + changeInfo.type;
            _emit(eventType, {
                collection: collection,
                type: changeInfo.type,
                item: changeInfo.item || null,
                timestamp: Date.now()
            });
        }
        
        _notifyComponents(collection, changeInfo);
        
        var cbs = _localCallbacks[collection];
        if (!cbs || cbs.length === 0) return;
        var data = [];
        if (memoryCache[collection]) {
            for (var key in memoryCache[collection]) {
                if (memoryCache[collection].hasOwnProperty(key)) {
                    data.push(memoryCache[collection][key]);
                }
            }
        }
        if (changeInfo) {
            _lastChangeInfo[collection] = changeInfo;
        }
        for (var i = 0; i < cbs.length; i++) {
            try { cbs[i](data); } catch(e) { console.error('Local callback error:', e); }
        }
    }
    
    function _setSuppressRealtime(suppress) {
        if (suppress) {
            _suppressRealtime++;
        } else {
            _suppressRealtime--;
            if (_suppressRealtime <= 0) {
                _suppressRealtime = 0;
                var collections = Object.keys(_pendingNotifyCollections);
                _pendingNotifyCollections = {};
                for (var i = 0; i < collections.length; i++) {
                    _notifyLocal(collections[i]);
                }
            }
        }
    }

    // IndexedDB operations
    function saveToLocal(collection, data, changeType) {
        return dbReady.then(function() {
            if (!localDB) throw new Error('DB not ready');
            if (!localDB.objectStoreNames.contains(collection)) throw new Error('Store ' + collection + ' not found');
            if (!memoryCache[collection]) memoryCache[collection] = {};
            var isNew = !memoryCache[collection][data.id];
            var normalized = normalizeIndexedFields(collection, data);
            
            // PHASE 2: Xóa cache query transactions khi có thay đổi
            if (collection === 'transactions' && normalized.dateKey) {
                _invalidateTxDateCache(normalized.dateKey);
                // Xóa luôn manager cache để realtime cập nhật big-value
                if (typeof window._invalidateManagerCache === 'function') {
                    window._invalidateManagerCache();
                }
                // Xóa luôn employee manager cache để realtime cập nhật tổng lương
                if (typeof window._invalidateEmpManagerCache === 'function') {
                    window._invalidateEmpManagerCache();
                }
            }
            
            // PHASE 2: Cập nhật session cache realtime (nếu pos-app.js đã load)
            try {
                if (typeof window._debouncedSaveSessionCache === 'function') {
                    window._debouncedSaveSessionCache();
                }
            } catch(e) {}
            
            // PHASE 2: Chỉ giữ transactions của ngày hiện tại trong memory cache
            if (_isDateBasedCollection(collection) && normalized.dateKey && normalized.dateKey !== _currentDateKey) {
                // Không thêm vào memory cache, chỉ lưu IndexedDB
                cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
                var type = changeType || (isNew ? 'added' : 'changed');
                _notifyLocal(collection, { type: type, item: data, collection: collection });
                return new Promise(function(resolve, reject) {
                    var tx = localDB.transaction([collection], 'readwrite');
                    var store = tx.objectStore(collection);
                    var req = store.put(normalized);
                    req.onsuccess = function() { resolve(data); };
                    req.onerror = function() { reject(req.error); };
                });
            }
            
            memoryCache[collection][data.id] = normalized;
            cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
            
            // PHASE 4: Ghi lại thời điểm cache
            _markCacheTime(collection, data.id);
            
            // PHASE 2: Giới hạn kích thước memory cache
            _enforceMemoryCacheLimit(collection);
            
            var type = changeType || (isNew ? 'added' : 'changed');
            _notifyLocal(collection, { type: type, item: data, collection: collection });
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([collection], 'readwrite');
                var store = tx.objectStore(collection);
                var req = store.put(normalized);
                req.onsuccess = function() { resolve(data); };
                req.onerror = function() { reject(req.error); };
            });
        });
    }

    function loadFromLocal(collection, id) {
        return dbReady.then(function() {
            if (!localDB) return id !== undefined ? null : [];
            if (!localDB.objectStoreNames.contains(collection)) return id !== undefined ? null : [];
            
            if (id !== undefined && id !== null) {
                if (memoryCache[collection] && memoryCache[collection][id] !== undefined) {
                    return memoryCache[collection][id];
                }
            } else {
                if (memoryCache[collection]) {
                    var cachedArr = [];
                    for (var key in memoryCache[collection]) {
                        if (memoryCache[collection].hasOwnProperty(key)) {
                            cachedArr.push(memoryCache[collection][key]);
                        }
                    }
                    if (cachedArr.length > 0) return cachedArr;
                }
            }
            
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([collection], 'readonly');
                var store = tx.objectStore(collection);
                if (id !== undefined && id !== null) {
                    var req = store.get(String(id));
                    req.onsuccess = function() {
                        var result = req.result || null;
                        if (result) {
                            if (!memoryCache[collection]) memoryCache[collection] = {};
                            // PHASE 2: Chỉ cache vào memory nếu là ngày hiện tại
                            if (!_isDateBasedCollection(collection) || !result.dateKey || result.dateKey === _currentDateKey) {
                                memoryCache[collection][result.id] = result;
                                // PHASE 4: Ghi lại thời điểm cache
                                _markCacheTime(collection, result.id);
                            }
                        }
                        resolve(result);
                    };
                    req.onerror = function() { reject(req.error); };
                } else {
                    var req = store.getAll();
                    req.onsuccess = function() {
                        var results = req.result || [];
                        if (!memoryCache[collection]) memoryCache[collection] = {};
                        for (var i = 0; i < results.length; i++) {
                            // PHASE 2: Chỉ cache vào memory nếu là ngày hiện tại
                            if (!_isDateBasedCollection(collection) || !results[i].dateKey || results[i].dateKey === _currentDateKey) {
                                memoryCache[collection][results[i].id] = results[i];
                                // PHASE 4: Ghi lại thời điểm cache
                                _markCacheTime(collection, results[i].id);
                            }
                        }
                        resolve(results);
                    };
                    req.onerror = function() { reject(req.error); };
                }
            });
        });
    }

    function deleteFromLocal(collection, id) {
        return dbReady.then(function() {
            if (!localDB) return;
            if (!localDB.objectStoreNames.contains(collection)) return;
            
            // Lưu dateKey của item trước khi xóa khỏi memory cache (để invalidate cache sau)
            var deletedDateKey = null;
            if (memoryCache[collection] && memoryCache[collection][id]) {
                deletedDateKey = memoryCache[collection][id].dateKey || null;
            }
            
            if (memoryCache[collection]) {
                delete memoryCache[collection][id];
                cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
            }
            // PHASE 2: Cập nhật session cache khi xóa dữ liệu
            try {
                if (typeof window._debouncedSaveSessionCache === 'function') {
                    window._debouncedSaveSessionCache();
                }
            } catch(e) {}
            
            // FIX: Chuyển _invalidateTxDateCache và _notifyLocal xuống SAU KHI IndexedDB delete hoàn tất
            // để tránh race condition: nếu getTransactionsByDate() được gọi trước khi delete xong,
            // nó sẽ đọc dữ liệu cũ từ IndexedDB và cache lại kết quả cũ
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([collection], 'readwrite');
                var store = tx.objectStore(collection);
                var req = store.delete(String(id));
                req.onsuccess = function() {
                    // Xóa cache query transactions SAU KHI IndexedDB đã xóa xong
                    if (collection === 'transactions' && deletedDateKey) {
                        _invalidateTxDateCache(deletedDateKey);
                        // Xóa luôn manager cache để realtime cập nhật big-value
                        if (typeof window._invalidateManagerCache === 'function') {
                            window._invalidateManagerCache();
                        }
                        // Xóa luôn employee manager cache để realtime cập nhật tổng lương
                        if (typeof window._invalidateEmpManagerCache === 'function') {
                            window._invalidateEmpManagerCache();
                        }
                    }
                    // Gọi _notifyLocal SAU KHI IndexedDB đã xóa xong
                    _notifyLocal(collection, { type: 'removed', item: { id: id }, collection: collection });
                    resolve();
                };
                req.onerror = function() { reject(req.error); };
            });
        });
    }

    // ========== PHASE 4: Priority Queue ==========
    // Priority levels: 0=critical (transactions), 1=high (tables, customers), 2=normal (menu, ingredients), 3=low (settings, logs)
    var COLLECTION_PRIORITY = {
        transactions: 0,
        daily_balances: 0,
        tables: 1,
        customers: 1,
        debt: 1,
        menu: 2,
        menu_categories: 2,
        ingredients: 2,
        inventory_transactions: 2,
        ingredient_transactions: 2,
        info: 3,
        cost_transactions: 3,
        cost_categories: 3,
        employee_attendance: 3,
        employee_salaries: 3,
        notifications: 3,
        sync_queue: 3
    };
    
    function _getPriority(collection) {
        return COLLECTION_PRIORITY[collection] !== undefined ? COLLECTION_PRIORITY[collection] : 3;
    }
    
    // Sync Queue (simplified)
    function addToSyncQueue(action, collection, data, targetId) {
        var existing = syncQueue.filter(function(q) { return q.targetId === targetId && q.action === action && q.status === 'pending'; })[0];
        if (existing) return existing.id;
        var priority = _getPriority(collection);
        var item = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            action: action,
            collection: collection,
            data: data,
            targetId: targetId,
            deviceId: CURRENT_DEVICE_ID,
            timestamp: Date.now(),
            retryCount: 0,
            status: 'pending',
            lastError: null,   // Lưu lỗi gần nhất để debug
            dirtyAt: Date.now(), // Thời điểm đánh dấu dirty
            priority: priority  // PHASE 4: Priority level
        };
        syncQueue.push(item);
        saveToLocal('sync_queue', item);
        _markDirty(collection);
        // PHASE 4: Queue size warning
        var pendingCount = syncQueue.filter(function(q) { return q.status === 'pending'; }).length;
        if (pendingCount > 50) {
            console.warn('[SyncQueue] ⚠️ Queue có ' + pendingCount + ' items pending, đang đồng bộ...');
        }
        if (isOnline) processSyncQueue();
        return item.id;
    }
    
    var _dirtyCollections = {};
    function _markDirty(collection) {
        _dirtyCollections[collection] = true;
        try {
            localStorage.setItem('dirty_collections_' + CURRENT_SHOP_ID, JSON.stringify(Object.keys(_dirtyCollections)));
        } catch (e) {}
    }
    function _clearDirty(collection) {
        delete _dirtyCollections[collection];
        try {
            var remaining = Object.keys(_dirtyCollections);
            if (remaining.length > 0) {
                localStorage.setItem('dirty_collections_' + CURRENT_SHOP_ID, JSON.stringify(remaining));
            } else {
                localStorage.removeItem('dirty_collections_' + CURRENT_SHOP_ID);
            }
        } catch (e) {}
    }
    function _restoreDirtyFlags() {
        try {
            var stored = localStorage.getItem('dirty_collections_' + CURRENT_SHOP_ID);
            if (stored) {
                var arr = JSON.parse(stored);
                for (var i = 0; i < arr.length; i++) {
                    _dirtyCollections[arr[i]] = true;
                }
            }
        } catch (e) {}
    }

    // PHASE 4: Sắp xếp pending items theo priority (critical trước)
    function _sortByPriority(items) {
        return items.slice().sort(function(a, b) {
            var pa = a.priority !== undefined ? a.priority : 3;
            var pb = b.priority !== undefined ? b.priority : 3;
            if (pa !== pb) return pa - pb;
            return a.timestamp - b.timestamp;
        });
    }

    function processSyncQueue() {
        if (!isOnline) return Promise.resolve();
        var pending = syncQueue.filter(function(q) { return q.status === 'pending'; });
        if (pending.length === 0) return Promise.resolve();
        
        // PHASE 4: Sắp xếp theo priority trước khi batch
        var sorted = _sortByPriority(pending);
        
        var batches = {};
        for (var i = 0; i < sorted.length; i++) {
            var item = sorted[i];
            var key = item.collection + '|' + item.action;
            if (!batches[key]) batches[key] = [];
            batches[key].push(item);
        }
        
        // PHASE 4: Sắp xếp batch keys theo priority thấp nhất trong batch
        var batchKeys = Object.keys(batches).sort(function(a, b) {
            var itemsA = batches[a];
            var itemsB = batches[b];
            var minPA = 3, minPB = 3;
            for (var i = 0; i < itemsA.length; i++) {
                var p = itemsA[i].priority !== undefined ? itemsA[i].priority : 3;
                if (p < minPA) minPA = p;
            }
            for (var i = 0; i < itemsB.length; i++) {
                var p = itemsB[i].priority !== undefined ? itemsB[i].priority : 3;
                if (p < minPB) minPB = p;
            }
            if (minPA !== minPB) return minPA - minPB;
            return itemsA[0].timestamp - itemsB[0].timestamp;
        });
        
        var chain = Promise.resolve();
        
        for (var b = 0; b < batchKeys.length; b++) {
            chain = chain.then((function(batchItems) {
                return function() {
                    if (batchItems.length === 1) {
                        var item = batchItems[0];
                        return syncToFirebase(item).then(function() {
                            return _markItemSynced(item);
                        }).catch(function(err) {
                            return _handleSyncError(item, err);
                        });
                    } else {
                        return _batchSyncToFirebase(batchItems).then(function() {
                            var chain2 = Promise.resolve();
                            for (var j = 0; j < batchItems.length; j++) {
                                chain2 = chain2.then((function(item) {
                                    return function() { return _markItemSynced(item); };
                                })(batchItems[j]));
                            }
                            return chain2;
                        }).catch(function(err) {
                            var chain3 = Promise.resolve();
                            for (var j = 0; j < batchItems.length; j++) {
                                chain3 = chain3.then((function(item) {
                                    return function() {
                                        return syncToFirebase(item).then(function() {
                                            return _markItemSynced(item);
                                        }).catch(function(err2) {
                                            return _handleSyncError(item, err2);
                                        });
                                    };
                                })(batchItems[j]));
                            }
                            return chain3;
                        });
                    }
                };
            })(batches[batchKeys[b]]));
        }
        
        return chain;
    }
    
    function _batchSyncToFirebase(items) {
        if (items.length === 0) return Promise.resolve();
        var collection = items[0].collection;
        var action = items[0].action;
        var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
        var metaRef = _getDb().ref(CURRENT_SHOP_ID + '/_meta/' + collection + '/maxVersion');
        
        if (action === 'delete') {
            var batchData = {};
            for (var i = 0; i < items.length; i++) {
                batchData[items[i].targetId] = null;
            }
            return ref.update(batchData);
        }
        
        return metaRef.transaction(function(currentMax) {
            return (currentMax || 0) + items.length;
        }).then(function(result) {
            var baseVersion = result.snapshot.val() - items.length;
            var batchData = {};
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var syncData = {};
                for (var k in item.data) if (item.data.hasOwnProperty(k)) syncData[k] = item.data[k];
                syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
                syncData._syncedBy = item.deviceId;
                syncData._version = baseVersion + i + 1; // ✅ Mỗi item có _version riêng, tăng dần
                batchData[item.targetId] = syncData;
            }
            return ref.update(batchData);
        }).catch(function(err) {
            console.warn('⚠️ Batch transaction failed, using client versions:', err.message);
            var batchData = {};
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var syncData = {};
                for (var k in item.data) if (item.data.hasOwnProperty(k)) syncData[k] = item.data[k];
                syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
                syncData._syncedBy = item.deviceId;
                syncData._version = (item.data._version || 1);
                batchData[item.targetId] = syncData;
            }
            return ref.update(batchData);
        });
    }
    
    function _markItemSynced(item) {
        item.status = 'synced';
        return saveToLocal('sync_queue', item).then(function() {
            return deleteFromLocal('sync_queue', item.id);
        }).then(function() {
            var idx = syncQueue.findIndex(function(q) { return q.id === item.id; });
            if (idx !== -1) syncQueue.splice(idx, 1);
            console.log('✅ Synced:', item.action, item.collection, item.targetId);
            var hasPending = syncQueue.some(function(q) { return q.collection === item.collection && q.status === 'pending'; });
            if (!hasPending) {
                _clearDirty(item.collection);
            }
        });
    }
    
    function _handleSyncError(item, err) {
        item.retryCount = (item.retryCount || 0) + 1;
        item.lastError = err.message || String(err);
        var MAX_RETRY = 5;
        if (item.retryCount < MAX_RETRY) {
            item.status = 'pending';
            return saveToLocal('sync_queue', item).then(function() {
                var delay = Math.min(2000 * Math.pow(2, item.retryCount - 1), 30000); // exponential backoff, max 30s
                console.warn('  ⚠️ Retry', item.retryCount, 'for', item.collection, item.targetId, 'in', delay + 'ms');
                return new Promise(function(r) { setTimeout(r, delay); });
            }).then(function() {
                return processSyncQueue();
            });
        } else {
            item.status = 'failed';
            console.error('❌ Sync failed after ' + MAX_RETRY + ' retries:', item.action, item.collection, item.targetId, 'Error:', item.lastError);
            return saveToLocal('sync_queue', item);
        }
    }

    function syncToFirebase(item) {
        var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + item.collection + '/' + item.targetId);
        var metaRef = _getDb().ref(CURRENT_SHOP_ID + '/_meta/' + item.collection + '/maxVersion');
        
        if (item.action === 'delete') return ref.remove();
        
        return metaRef.transaction(function(currentMax) {
            return (currentMax || 0) + 1;
        }).then(function(result) {
            var serverVersion = result.snapshot.val();
            var syncData = {};
            for (var k in item.data) if (item.data.hasOwnProperty(k)) syncData[k] = item.data[k];
            syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
            syncData._syncedBy = item.deviceId;
            syncData._version = serverVersion; // ✅ Version từ server, không trùng
            return ref.update(syncData);
        }).catch(function(err) {
            console.warn('⚠️ Transaction failed, using client version:', err.message);
            var syncData = {};
            for (var k in item.data) if (item.data.hasOwnProperty(k)) syncData[k] = item.data[k];
            syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
            syncData._syncedBy = item.deviceId;
            syncData._version = (item.data._version || 1);
            return ref.update(syncData);
        });
    }

    // CRUD Public
    function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }

    function create(collection, data, customId) {
        // FIX Phase 1: Đã loại bỏ _isDuplicateTransaction - mỗi giao dịch là duy nhất
        var id = customId || data.id || generateId();
        var newData = { id: id };
        for (var k in data) if (data.hasOwnProperty(k) && k !== 'id') newData[k] = data[k];
        newData.createdAt = Date.now();
        newData.createdBy = CURRENT_DEVICE_ID;
        newData.updatedAt = Date.now();
        newData._version = 1;
        return saveToLocal(collection, newData).then(function() {
            addToSyncQueue('create', collection, newData, id);
            if (isOnline) _debouncedProcessSyncQueue();
            return Promise.resolve();
        }).then(function() { return newData; });
    }

    function update(collection, id, data) {
        return loadFromLocal(collection, String(id)).then(function(old) {
            if (!old) throw new Error('Not found');
            var updated = {};
            for (var k in old) if (old.hasOwnProperty(k)) updated[k] = old[k];
            for (var k in data) if (data.hasOwnProperty(k)) updated[k] = data[k];
            updated.updatedAt = Date.now();
            updated.updatedBy = CURRENT_DEVICE_ID;
            updated._version = (old._version || 0) + 1;
            return saveToLocal(collection, updated).then(function() {
                addToSyncQueue('update', collection, updated, String(id));
                if (isOnline) _debouncedProcessSyncQueue();
                return Promise.resolve();
            }).then(function() { return updated; });
        });
    }

    function batchUpdateSortOrder(items, collection) {
        collection = collection || 'menu';
        return dbReady.then(function() {
            if (!localDB) throw new Error('DB not ready');
            var tx = localDB.transaction([collection], 'readwrite');
            var store = tx.objectStore(collection);
            var now = Date.now();
            
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (!memoryCache[collection]) memoryCache[collection] = {};
                if (memoryCache[collection][item.id]) {
                    memoryCache[collection][item.id].sortOrder = item.sortOrder;
                }
                var fullData = memoryCache[collection][item.id];
                if (fullData) {
                    fullData.sortOrder = item.sortOrder;
                    fullData.updatedAt = now;
                    store.put(normalizeIndexedFields(collection, fullData));
                }
            }
            
            return new Promise(function(resolve, reject) {
                tx.oncomplete = function() {
                    if (isOnline && CURRENT_SHOP_ID) {
                        var updates = {};
                        var firebasePath = (collection === 'menu_categories') ? 'menu_categories' : 'menu';
                        for (var i = 0; i < items.length; i++) {
                            var key = CURRENT_SHOP_ID + '/' + firebasePath + '/' + items[i].id + '/sortOrder';
                            updates[key] = items[i].sortOrder;
                        }
                        _getDb().ref().update(updates).catch(function(err) {
                            console.error('Lỗi batch sync sortOrder cho ' + collection + ':', err);
                        });
                    }
                    _notifyLocal(collection);
                    resolve();
                };
                tx.onerror = function() { reject(tx.error); };
            });
        });
    }

    function remove(collection, id) {
        return deleteFromLocal(collection, String(id)).then(function() {
            addToSyncQueue('delete', collection, { id: id }, String(id));
            if (isOnline) _debouncedProcessSyncQueue();
            return Promise.resolve();
        }).then(function() { return true; });
    }

    function get(collection, id) {
        if (id !== undefined) return loadFromLocal(collection, String(id));
        return loadFromLocal(collection);
    }

    function getAll(collection) {
        return loadFromLocal(collection).then(function(data) { return data || []; });
    }

    function _fixDateKeyIfNeeded(tx) {
        if (!tx || !tx.id) return tx;
        var correctKey = toDateKey(tx.createdAt || tx.date || tx.updatedAt);
        if (correctKey && tx.dateKey !== correctKey) {
            
            tx.dateKey = correctKey;
            tx.dateTypeKey = correctKey + '|' + (tx.type || 'unknown');
            if (memoryCache.transactions) {
                memoryCache.transactions[tx.id] = tx;
            }
            if (localDB) {
                try {
                    var writeTx = localDB.transaction(['transactions'], 'readwrite');
                    var store = writeTx.objectStore('transactions');
                    store.put(tx);
                } catch(e) {
                    console.warn('Không thể ghi fix dateKey vào IndexedDB:', e.message);
                }
            }
        }
        return tx;
    }

    var _fetchingTxDateKeys = {};
    
    // PHASE 2: Cache kết quả query transactions
    // PHASE 4: Thêm TTL cho _txDateCache - tự động invalidate sau 10 phút
    // P4: Tăng từ 2 phút lên 10 phút để giảm số lần query IndexedDB + auto-fetch Firebase
    var _txDateCache = {}; // { '2024-01-15|all': [transactions] }
    var _txDateCacheTimestamps = {}; // { '2024-01-15|all': timestamp }
    var _TX_DATE_CACHE_TTL = 10 * 60 * 1000; // 10 phút
    
    // Khi có transaction mới, xóa cache liên quan
    function _invalidateTxDateCache(dateKey) {
        if (!dateKey) {
            _txDateCache = {};
            _txDateCacheTimestamps = {};
            return;
        }
        for (var key in _txDateCache) {
            if (_txDateCache.hasOwnProperty(key) && key.indexOf(dateKey) === 0) {
                delete _txDateCache[key];
                delete _txDateCacheTimestamps[key];
            }
        }
    }

    function getTransactionsByDate(dateKey, options) {
        options = options || {};
        var type = options.type || 'all';
        
        // PHASE 2: Kiểm tra cache trước
        // PHASE 4: Kiểm tra TTL cache
        var cacheKey = dateKey + '|' + type;
        if (_txDateCache[cacheKey] && !options.forceRefresh) {
            var cacheTime = _txDateCacheTimestamps[cacheKey] || 0;
            if ((Date.now() - cacheTime) < _TX_DATE_CACHE_TTL) {
                return Promise.resolve(_txDateCache[cacheKey]);
            }
            // Cache quá hạn, xóa để fetch lại
            delete _txDateCache[cacheKey];
            delete _txDateCacheTimestamps[cacheKey];
        }
        
        var txFetchKey = dateKey + '|' + type;
        if (_fetchingTxDateKeys[txFetchKey]) {
            return _fetchingTxDateKeys[txFetchKey];
        }
        
        var promise = dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains('transactions')) return [];
            
            // PHASE 3: Tối ưu - dùng IndexedDB index trực tiếp thay vì iterate memory cache
            // IndexedDB index 'dateKey' hoặc 'dateTypeKey' chỉ query đúng ngày cần
            var localPromise = new Promise(function(resolve, reject) {
                var tx = localDB.transaction(['transactions'], 'readonly');
                var store = tx.objectStore('transactions');
                var req;
                if (type !== 'all' && store.indexNames.contains('dateTypeKey')) {
                    req = store.index('dateTypeKey').getAll(dateKey + '|' + type);
                } else if (store.indexNames.contains('dateKey')) {
                    req = store.index('dateKey').getAll(dateKey);
                } else {
                    req = store.getAll();
                }
                req.onsuccess = function() {
                    var rows = req.result || [];
                    if (!store.indexNames.contains('dateKey')) {
                        rows = rows.filter(function(r) { return toDateKey(r.date) === dateKey; });
                        if (type !== 'all') rows = rows.filter(function(r) { return r.type === type; });
                    }
                    for (var i = 0; i < rows.length; i++) {
                        _fixDateKeyIfNeeded(rows[i]);
                    }
                    if (!memoryCache.transactions) memoryCache.transactions = {};
                    for (var i = 0; i < rows.length; i++) {
                        // PHASE 2: Chỉ cache vào memory nếu là ngày hiện tại
                        if (rows[i].dateKey === _currentDateKey) {
                            memoryCache.transactions[rows[i].id] = rows[i];
                        }
                    }
                    resolve(rows);
                };
                req.onerror = function() { reject(req.error); };
            });
            
            return localPromise.then(function(localData) {
                // PHASE 2: Lưu vào cache
                // PHASE 4: Ghi timestamp cho TTL
                if (localData && localData.length > 0) {
                    _txDateCache[cacheKey] = localData;
                    _txDateCacheTimestamps[cacheKey] = Date.now();
                    return localData;
                }
                
                if (!isOnline) return [];
                
                if (_isEmployeeMode()) {
                    var todayKey = toDateKey(Date.now());
                    var yesterdayMs = Date.now() - 86400000;
                    var yesterdayKey = toDateKey(yesterdayMs);
                    if (dateKey !== todayKey && dateKey !== yesterdayKey) {
                        console.log('📡 Employee mode - skip auto-fetch for date:', dateKey);
                        return [];
                    }
                }
                
                // console.log('📡 Auto-fetching transactions for date:', dateKey);
                return syncCollectionByDate('transactions', dateKey).then(function(fetched) {
                    if (type !== 'all' && fetched) {
                        fetched = fetched.filter(function(t) { return t.type === type; });
                    }
                    // PHASE 2: Lưu vào cache
                    // PHASE 4: Ghi timestamp cho TTL
                    if (fetched && fetched.length > 0) {
                        _txDateCache[cacheKey] = fetched;
                        _txDateCacheTimestamps[cacheKey] = Date.now();
                    }
                    return fetched || [];
                });
            });
        });
        
        _fetchingTxDateKeys[txFetchKey] = promise;
        return promise.then(function(result) {
            delete _fetchingTxDateKeys[txFetchKey];
            return result;
        }).catch(function(err) {
            delete _fetchingTxDateKeys[txFetchKey];
            throw err;
        });
    }

    var _fetchingRange = null;
    
    function getTransactionsByDateRange(startDateKey, endDateKey, options) {
        options = options || {};
        var type = options.type || 'all';
        var noAutoFetch = options.noAutoFetch === true;
        
        if (_fetchingRange) {
            return _fetchingRange.then(function() {
                return _doGetTransactionsByDateRange(startDateKey, endDateKey, type, noAutoFetch);
            });
        }
        
        var promise = _doGetTransactionsByDateRange(startDateKey, endDateKey, type, noAutoFetch);
        _fetchingRange = promise;
        return promise.then(function(result) {
            _fetchingRange = null;
            return result;
        }).catch(function(err) {
            _fetchingRange = null;
            throw err;
        });
    }
    
    function _doGetTransactionsByDateRange(startDateKey, endDateKey, type, noAutoFetch) {
        return dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains('transactions')) return [];
            
            // OPTIMIZE: Kiểm tra _txDateCache trước - nếu tất cả các ngày trong range đã có cache thì dùng luôn
            var allDateKeys = getDateKeysBetween(startDateKey, endDateKey);
            var cachedResults = [];
            var allCached = true;
            var typeSuffix = '|' + type;
            
            for (var d = 0; d < allDateKeys.length; d++) {
                var cacheKey = allDateKeys[d] + typeSuffix;
                if (_txDateCache[cacheKey]) {
                    var cacheTime = _txDateCacheTimestamps[cacheKey] || 0;
                    if ((Date.now() - cacheTime) < _TX_DATE_CACHE_TTL) {
                        // Cache còn hạn, gộp vào kết quả
                        for (var t = 0; t < _txDateCache[cacheKey].length; t++) {
                            cachedResults.push(_txDateCache[cacheKey][t]);
                        }
                        continue;
                    }
                }
                // Thử cache với type='all' nếu type cụ thể không có
                var cacheKeyAll = allDateKeys[d] + '|all';
                if (_txDateCache[cacheKeyAll]) {
                    var cacheTimeAll = _txDateCacheTimestamps[cacheKeyAll] || 0;
                    if ((Date.now() - cacheTimeAll) < _TX_DATE_CACHE_TTL) {
                        // Cache 'all' còn hạn, filter theo type
                        for (var t = 0; t < _txDateCache[cacheKeyAll].length; t++) {
                            var item = _txDateCache[cacheKeyAll][t];
                            if (type === 'all' || item.type === type) {
                                cachedResults.push(item);
                            }
                        }
                        continue;
                    }
                }
                allCached = false;
                break;
            }
            
            if (allCached && cachedResults.length > 0) {
                // Cập nhật memory cache
                if (!memoryCache.transactions) memoryCache.transactions = {};
                for (var i = 0; i < cachedResults.length; i++) {
                    memoryCache.transactions[cachedResults[i].id] = cachedResults[i];
                }
                return cachedResults;
            }
            
            // OPTIMIZE: Dùng IDBKeyRange.bound() để chỉ query transactions trong range cần
            // thay vì getAll() rồi filter trong JS - giảm lượng dữ liệu truyền từ IndexedDB
            localPromise = new Promise(function(resolve, reject) {
                var tx = localDB.transaction(['transactions'], 'readonly');
                var store = tx.objectStore('transactions');
                var req;
                if (store.indexNames.contains('dateKey')) {
                    // Chỉ lấy transactions trong date range, không lấy tất cả
                    var range = IDBKeyRange.bound(startDateKey, endDateKey, false, false);
                    req = store.index('dateKey').getAll(range);
                } else {
                    req = store.getAll();
                }
                req.onsuccess = function() {
                    var rows = req.result || [];
                    for (var i = 0; i < rows.length; i++) {
                        _fixDateKeyIfNeeded(rows[i]);
                    }
                    // rows đã được IndexedDB filter theo dateKey range, chỉ cần filter type nếu cần
                    if (type !== 'all') {
                        rows = rows.filter(function(r) { return r.type === type; });
                    }
                    // Cập nhật memory cache với dữ liệu từ IndexedDB
                    if (!memoryCache.transactions) memoryCache.transactions = {};
                    for (var i = 0; i < rows.length; i++) {
                        memoryCache.transactions[rows[i].id] = rows[i];
                    }
                    resolve(rows);
                };
                req.onerror = function() { reject(req.error); };
            });
            
            return localPromise.then(function(localData) {
                // Bước 1: Xác định những ngày đã có dữ liệu từ local (memory cache + IndexedDB)
                var localDateKeys = {};
                for (var i = 0; i < localData.length; i++) {
                    if (localData[i].dateKey) {
                        localDateKeys[localData[i].dateKey] = true;
                    }
                }
                
                // Bước 2: Xác định tất cả các ngày trong range (đã tính ở trên)
                
                // Bước 3: Tìm những ngày còn thiếu (chưa có trong local)
                var missingDateKeys = [];
                for (var i = 0; i < allDateKeys.length; i++) {
                    if (!localDateKeys[allDateKeys[i]]) {
                        missingDateKeys.push(allDateKeys[i]);
                    }
                }
                
                // Bước 4: Nếu đã có đủ dữ liệu hoặc offline thì trả về localData
                if (missingDateKeys.length === 0 || !isOnline) {
                    return localData;
                }
                
                if (noAutoFetch) {
                    console.log('📡 Auto-fetch skipped (noAutoFetch=true), missing:', missingDateKeys.length, 'days');
                    return localData;
                }
                
                // Bước 5: Giới hạn số ngày auto-fetch theo retention days
                var MAX_AUTO_FETCH_DAYS = _getRetentionDays();
                var dateKeysToFetch = missingDateKeys;
                if (missingDateKeys.length > MAX_AUTO_FETCH_DAYS) {
                    // Chỉ fetch MAX_AUTO_FETCH_DAYS ngày gần nhất
                    dateKeysToFetch = missingDateKeys.slice(missingDateKeys.length - MAX_AUTO_FETCH_DAYS);
                    console.log('📡 Auto-fetch limited to', MAX_AUTO_FETCH_DAYS, 'days (range has', missingDateKeys.length, 'missing days)');
                }
                
                if (dateKeysToFetch.length > 0) {
                    console.log('📡 Auto-fetching missing dates:', dateKeysToFetch.length, 'days');
                }
                
                // Bước 6: Fetch từng ngày còn thiếu từ Firebase
                var chain = Promise.resolve();
                for (var i = 0; i < dateKeysToFetch.length; i++) {
                    chain = chain.then((function(dateKey) {
                        return function() {
                            return syncCollectionByDate('transactions', dateKey);
                        };
                    })(dateKeysToFetch[i]));
                }
                
                // Bước 7: Load lại toàn bộ dữ liệu từ local sau khi fetch
                return chain.then(function() {
                    return loadFromLocal('transactions').then(function(allData) {
                        var result = [];
                        for (var i = 0; i < allData.length; i++) {
                            var dk = allData[i].dateKey;
                            if (dk >= startDateKey && dk <= endDateKey) {
                                if (type === 'all' || allData[i].type === type) {
                                    result.push(allData[i]);
                                }
                            }
                        }
                        return result;
                    });
                });
            });
        });
    }

    // ========== PHASE 4: Lazy Firebase Listeners ==========
    var _activeListeners = {}; // { collection: { ref, handlers, refCount } }
    var _listenerQueue = []; // Queue các collection chờ active
    
    // Active listener cho 1 collection (chỉ khi có component cần)
    function _ensureListener(collection, callback, options) {
        if (_activeListeners[collection]) {
            _activeListeners[collection].refCount++;
            if (callback) {
                if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
                _localCallbacks[collection].push(callback);
            }
            return _activeListeners[collection].unsubFn;
        }
        
        // Thêm callback trước
        if (callback) {
            if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
            _localCallbacks[collection].push(callback);
        }
        
        var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
        if (options && options.orderByChild) {
            var queryRef = ref.orderByChild(options.orderByChild);
            if (options.limitToLast) {
                queryRef = queryRef.limitToLast(options.limitToLast);
            }
            ref = queryRef;
        } else if (options && options.limitToLast) {
            ref = ref.limitToLast(options.limitToLast);
        }
        
        var handlers = {};
        var unsubFn = function() {};
        
        if (collection === 'info') {
            var updateScheduledInfo = false;
            var emitUpdateInfo = function() {
                if (updateScheduledInfo) return;
                updateScheduledInfo = true;
                setTimeout(function() {
                    updateScheduledInfo = false;
                    loadFromLocal(collection).then(function(localData) {
                        var cbs = _localCallbacks[collection];
                        if (cbs) { for (var ci = 0; ci < cbs.length; ci++) { try { cbs[ci](localData); } catch(e) {} } }
                        var evt = document.createEvent('CustomEvent');
                        evt.initCustomEvent('db_update', true, true, { detail: { collection: collection, data: localData } });
                        window.dispatchEvent(evt);
                    });
                }, 200);
            };
            handlers.onValue = function(snapshot) {
                if (!snapshot.exists()) return;
                var src = snapshot.val() || {};
                var item = { id: 'shop_config' };
                for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                saveToLocal(collection, item).then(emitUpdateInfo);
            };
            ref.on('value', handlers.onValue);
            unsubFn = function() {
                ref.off('value', handlers.onValue);
            };
        } else {
            var updateScheduled = false;
            var emitUpdate = function() {
                if (updateScheduled) return;
                updateScheduled = true;
                setTimeout(function() {
                    updateScheduled = false;
                    loadFromLocal(collection).then(function(localData) {
                        var cbs = _localCallbacks[collection];
                        if (cbs) { for (var ci = 0; ci < cbs.length; ci++) { try { cbs[ci](localData); } catch(e) {} } }
                        var evt = document.createEvent('CustomEvent');
                        evt.initCustomEvent('db_update', true, true, { detail: { collection: collection, data: localData } });
                        window.dispatchEvent(evt);
                    });
                }, 200);
            };
            handlers.onAdded = function(snapshot) {
                if (!snapshot.exists()) return;
                var key = snapshot.key;
                
                // PHASE 5: Dedup check - tránh xử lý items đã được xử lý gần đây
                if (_isRecentlyProcessed(collection, key)) return;
                
                var src = snapshot.val() || {};
                var item = { id: key };
                for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                
                if (collection !== 'tables') {
                    var localItem = memoryCache[collection] ? memoryCache[collection][key] : null;
                    if (localItem) {
                        // So sánh _version trước
                        if ((localItem._version || 0) > (item._version || 0)) return;
                        // Nếu _version bằng nhau, so sánh _syncedAt (server timestamp)
                        if ((localItem._version || 0) === (item._version || 0)) {
                            if (localItem._syncedAt && item._syncedAt && localItem._syncedAt >= item._syncedAt) return;
                        }
                    }
                }
                
                if (collection === 'transactions' && memoryCache.transactions && memoryCache.transactions[key]) {
                    var localTx = memoryCache.transactions[key];
                    if (localTx._version >= 1 && !localTx._syncedAt) return;
                }
                
                _markProcessed(collection, key);
                saveToLocal(collection, item).then(emitUpdate);
            };
            handlers.onChanged = function(snapshot) {
                if (!snapshot.exists()) return;
                var key = snapshot.key;
                
                // PHASE 5: Dedup check
                if (_isRecentlyProcessed(collection, key)) return;
                
                var src = snapshot.val() || {};
                var item = { id: key };
                for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                
                if (collection !== 'tables') {
                    var localItem = memoryCache[collection] ? memoryCache[collection][key] : null;
                    if (localItem) {
                        // So sánh _version trước
                        if ((localItem._version || 0) > (item._version || 0)) return;
                        // Nếu _version bằng nhau, so sánh _syncedAt
                        if ((localItem._version || 0) === (item._version || 0)) {
                            if (localItem._syncedAt && item._syncedAt && localItem._syncedAt >= item._syncedAt) return;
                        }
                    }
                }
                
                _markProcessed(collection, key);
                saveToLocal(collection, item).then(emitUpdate);
            };
            handlers.onRemoved = function(snapshot) {
                var key = snapshot.key;
                deleteFromLocal(collection, key).then(emitUpdate);
            };
            ref.on('child_added', handlers.onAdded);
            ref.on('child_changed', handlers.onChanged);
            ref.on('child_removed', handlers.onRemoved);
            unsubFn = function() {
                ref.off('child_added', handlers.onAdded);
                ref.off('child_changed', handlers.onChanged);
                ref.off('child_removed', handlers.onRemoved);
            };
        }
        
        if (!listeners[collection]) listeners[collection] = [];
        listeners[collection].push(handlers);
        
        _activeListeners[collection] = {
            ref: ref,
            handlers: handlers,
            refCount: 1,
            unsubFn: unsubFn
        };
        
        if (!_unsubscribeFns[collection]) _unsubscribeFns[collection] = [];
        _unsubscribeFns[collection].push(unsubFn);
        
        console.log('[Listener] ✅ Active listener cho ' + collection);
        return unsubFn;
    }
    
    // Giảm refCount, tự động unsubscribe khi không còn ai dùng
    function _releaseListener(collection) {
        if (!_activeListeners[collection]) return;
        _activeListeners[collection].refCount--;
        if (_activeListeners[collection].refCount <= 0) {
            _activeListeners[collection].unsubFn();
            delete _activeListeners[collection];
            console.log('[Listener] 🗑️ Đã hủy listener cho ' + collection);
        }
    }

   function subscribeToCollection(collection, callback, options) {
    // PHASE 4: Dùng lazy listener thay vì active ngay
    return _ensureListener(collection, callback, options);
}

    var _pollingTimers = {};
    function subscribeWithPolling(collection, callback, intervalSeconds) {
        intervalSeconds = intervalSeconds || 60; // Mặc định 60 giây
        if (callback) {
            if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
            _localCallbacks[collection].push(callback);
        }
        
        if (_pollingTimers[collection]) {
            if (callback) {
                if (memoryCache[collection]) {
                    var data = [];
                    for (var key in memoryCache[collection]) {
                        if (memoryCache[collection].hasOwnProperty(key)) {
                            data.push(memoryCache[collection][key]);
                        }
                    }
                    if (data.length > 0) {
                        try { callback(data); } catch(e) { console.error('Polling callback error:', e); }
                    } else {
                        console.log('⏳ Polling ' + collection + ': memoryCache empty, registering callback for later');
                        if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
                        _localCallbacks[collection].push(callback);
                    }
                } else {
                    console.log('⏳ Polling ' + collection + ': memoryCache not ready, registering callback for later');
                    if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
                    _localCallbacks[collection].push(callback);
                }
            }
            return function() {
                clearInterval(_pollingTimers[collection]);
                delete _pollingTimers[collection];
            };
        }
        
        var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
        
        getSyncMeta(collection).then(function(meta) {
            if (meta && meta.maxVersion > 0) {
                deltaSync(collection);
            } else {
                ref.once('value', function(snapshot) {
                    if (!snapshot.exists()) return;
                    var remote = snapshot.val() || {};
                    var count = 0;
                    var maxVersion = 0;
                    for (var key in remote) {
                        if (remote.hasOwnProperty(key)) {
                            var src = remote[key];
                            var item = { id: key };
                            for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                            if (item._version === undefined) item._version = 1;
                            if (item._version > maxVersion) maxVersion = item._version;
                            saveToLocal(collection, item, 'added');
                            count++;
                        }
                    }
                    saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: maxVersion, dateKeys: [] });
                    console.log('📥 Polling loaded ' + collection + ': ' + count + ' items');
                });
            }
        });
        
        _pollingTimers[collection] = setInterval(function() {
            if (!isOnline) return;
            
            getSyncMeta(collection).then(function(meta) {
                var localMaxVersion = (meta && meta.maxVersion) || 0;
                var queryRef = ref.orderByChild('_version').startAt(localMaxVersion + 1);
                
                queryRef.once('value', function(snapshot) {
                    if (!snapshot.exists()) return;
                    var remote = snapshot.val() || {};
                    var count = 0;
                    var newMaxVersion = localMaxVersion;
                    
                    for (var key in remote) {
                        if (remote.hasOwnProperty(key)) {
                            var src = remote[key];
                            var item = { id: key };
                            for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                            if (item._version === undefined) item._version = 1;
                            if (item._version > newMaxVersion) newMaxVersion = item._version;
                            
                            var localItem = memoryCache[collection] ? memoryCache[collection][key] : null;
                            saveToLocal(collection, item, localItem ? 'changed' : 'added');
                            count++;
                        }
                    }
                    
                    if (count > 0) {
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: newMaxVersion, dateKeys: (meta && meta.dateKeys) || [] });
                        console.log('📥 Polling delta ' + collection + ': ' + count + ' new items');
                    }
                });
            });
            
            // P5: _cleanupDeletedIds đã được xóa - child_removed listener xử lý việc xóa realtime
            // vì nó đã được gọi trong fullSync/deltaSync và có cache riêng
        }, intervalSeconds * 1000);
        
        return function() {
            clearInterval(_pollingTimers[collection]);
            delete _pollingTimers[collection];
        };
    }
    
    function _cleanupOldData() {
        if (!localDB) return;
        var retentionDays = _getRetentionDays();
        var cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        var cutoffDateKey = toDateKey(cutoffTime);
        var todayKey = toDateKey(Date.now());
        
        console.log('[Retention] Giữ ' + retentionDays + ' ngày (từ ' + cutoffDateKey + ' đến ' + todayKey + ')');
        
        // 1. Xóa memory cache items quá hạn
        var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
        for (var c = 0; c < dateKeys.length; c++) {
            var col = dateKeys[c];
            if (!memoryCache[col]) continue;
            var memKeys = Object.keys(memoryCache[col]);
            var memDeleted = 0;
            for (var i = 0; i < memKeys.length; i++) {
                var item = memoryCache[col][memKeys[i]];
                if (item) {
                    var dk = item.dateKey || (item.date ? toDateKey(item.date) : null);
                    if (dk && dk < cutoffDateKey) {
                        delete memoryCache[col][memKeys[i]];
                        // Dọn cache timestamp tương ứng
                        if (_cacheTimestamps[col]) {
                            delete _cacheTimestamps[col][memKeys[i]];
                        }
                        memDeleted++;
                    }
                }
            }
            if (memDeleted > 0) {
                console.log('[Retention] Đã xóa ' + memDeleted + ' items cũ khỏi memory cache ' + col);
            }
        }
        
        // 2. Xóa IndexedDB items quá hạn và cập nhật syncMeta.dateKeys
        for (var c = 0; c < dateKeys.length; c++) {
            var collection = dateKeys[c];
            if (!localDB.objectStoreNames.contains(collection)) continue;
            
            (function(col) {
                var tx = localDB.transaction([col], 'readwrite');
                var store = tx.objectStore(col);
                var req = store.getAll();
                req.onsuccess = function() {
                    var items = req.result || [];
                    var deleted = 0;
                    var remainingDateKeys = {};
                    for (var i = 0; i < items.length; i++) {
                        var dk = items[i].dateKey || (items[i].date ? toDateKey(items[i].date) : null);
                        if (dk && dk < cutoffDateKey) {
                            store.delete(items[i].id);
                            deleted++;
                        } else if (dk) {
                            // Ghi nhận các dateKeys còn lại (không bị xóa)
                            remainingDateKeys[dk] = true;
                        }
                    }
                    if (deleted > 0) {
                        console.log('[Retention] 🧹 Đã xóa ' + deleted + ' items cũ khỏi IndexedDB ' + col);
                        // Cập nhật syncMeta.dateKeys: chỉ giữ các dateKeys còn items
                        getSyncMeta(col).then(function(meta) {
                            var oldDateKeys = (meta && meta.dateKeys) || [];
                            var newDateKeys = [];
                            for (var i = 0; i < oldDateKeys.length; i++) {
                                if (remainingDateKeys[oldDateKeys[i]] || oldDateKeys[i] >= cutoffDateKey) {
                                    newDateKeys.push(oldDateKeys[i]);
                                }
                            }
                            if (newDateKeys.length !== oldDateKeys.length) {
                                saveSyncMeta(col, {
                                    lastSyncAt: (meta && meta.lastSyncAt) || Date.now(),
                                    maxVersion: (meta && meta.maxVersion) || 0,
                                    dateKeys: newDateKeys
                                });
                                console.log('[Retention] 📋 Đã cập nhật syncMeta.dateKeys cho ' + col + ': ' + oldDateKeys.length + ' → ' + newDateKeys.length + ' dateKeys');
                            }
                        });
                    }
                };
            })(collection);
        }
    }
    
    // DATA RETENTION: Cleanup dữ liệu cũ định kỳ (mỗi 6 tiếng)
    var _dataCleanupIntervalId = null;
    function _startPeriodicDataCleanup() {
        if (_dataCleanupIntervalId) return;
        // Chạy lần đầu sau 5 phút (tránh xung đột với lúc init)
        setTimeout(function() {
            _cleanupOldData();
        }, 5 * 60 * 1000);
        // Sau đó chạy mỗi 6 tiếng
        _dataCleanupIntervalId = setInterval(_cleanupOldData, 6 * 60 * 60 * 1000);
        console.log('[Retention] Đã khởi động periodic data cleanup (6 tiếng/lần, giữ ' + _getRetentionDays() + ' ngày)');
    }
    
    var _quickSyncTimer = null;
    function _quickSync() {
        if (_quickSyncTimer) clearTimeout(_quickSyncTimer);
        _quickSyncTimer = setTimeout(function() {
            _quickSyncTimer = null;
            if (!isOnline) return;
            console.log('📡 Quick sync on resume...');
            
            // Master collections: reconcile (so sánh keys Firebase vs local, thêm thiếu, xóa dư)
            var masterKeys = Object.keys(MASTER_COLLECTIONS);
            var chain = Promise.resolve();
            for (var i = 0; i < masterKeys.length; i++) {
                (function(collection) {
                    chain = chain.then(function() {
                        return reconcileCollection(collection);
                    });
                })(masterKeys[i]);
            }
            
            // Date-based collections: deltaSync (version-based, chỉ lấy items mới hơn)
            var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
            for (var j = 0; j < dateKeys.length; j++) {
                (function(collection) {
                    chain = chain.then(function() {
                        return deltaSync(collection);
                    });
                })(dateKeys[j]);
            }
            
            chain.then(function() {
                _cleanupOldData();
            });
        }, 500);
    }
    
    // Network listener
    function initNetwork() {
        window.addEventListener('online', function() {
            isOnline = true;
            showToast('📡 Đã kết nối mạng', 'success');
            processSyncQueue();
            
            // Master collections: reconcile (so sánh keys Firebase vs local, thêm thiếu, xóa dư)
            var masterKeys = Object.keys(MASTER_COLLECTIONS);
            var chain = Promise.resolve();
            for (var i = 0; i < masterKeys.length; i++) {
                (function(collection) {
                    chain = chain.then(function() {
                        return reconcileCollection(collection);
                    });
                })(masterKeys[i]);
            }
            
            // Date-based collections: deltaSync
            var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
            for (var j = 0; j < dateKeys.length; j++) {
                (function(collection) {
                    chain = chain.then(function() {
                        return deltaSync(collection);
                    });
                })(dateKeys[j]);
            }
        });
        window.addEventListener('offline', function() {
            isOnline = false;
            showToast('⚠️ Mất kết nối', 'warning');
        });
        
        // QUICK SYNC: Khi tab resume (visibilitychange + focus)
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') {
                _quickSync();
            }
        });
        window.addEventListener('focus', function() {
            _quickSync();
        });
        
        isOnline = navigator.onLine;
    }

    // ========== SYNC META OPERATIONS ==========
    
    // Key prefix cho localStorage
    var LS_SYNC_META_PREFIX = 'sync_meta_';
    
    function getSyncMeta(collection) {
        if (syncMetaCache[collection]) {
            return Promise.resolve(syncMetaCache[collection]);
        }
        try {
            var lsKey = LS_SYNC_META_PREFIX + CURRENT_SHOP_ID + '_' + collection;
            var stored = localStorage.getItem(lsKey);
            if (stored) {
                var meta = JSON.parse(stored);
                if (meta && meta.lastSyncAt) {
                    syncMetaCache[collection] = meta;
                    return Promise.resolve(meta);
                }
            }
        } catch (e) {
        }
        if (!dbReady) {
            return Promise.resolve(null);
        }
        return dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains(SYNC_META_STORE)) {
                return null;
            }
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([SYNC_META_STORE], 'readonly');
                var store = tx.objectStore(SYNC_META_STORE);
                var req = store.get(collection);
                req.onsuccess = function() {
                    var meta = req.result || null;
                    if (meta) {
                        syncMetaCache[collection] = meta;
                        try {
                            var lsKey = LS_SYNC_META_PREFIX + CURRENT_SHOP_ID + '_' + collection;
                            localStorage.setItem(lsKey, JSON.stringify(meta));
                        } catch (e) {}
                    }
                    resolve(meta);
                };
                req.onerror = function() { reject(req.error); };
            });
        });
    }
    
    function saveSyncMeta(collection, meta) {
        syncMetaCache[collection] = meta;
        try {
            var lsKey = LS_SYNC_META_PREFIX + CURRENT_SHOP_ID + '_' + collection;
            localStorage.setItem(lsKey, JSON.stringify({
                id: collection,
                lastSyncAt: meta.lastSyncAt,
                maxVersion: meta.maxVersion,
                dateKeys: meta.dateKeys || []
            }));
        } catch (e) {
        }
        if (!dbReady) return Promise.resolve();
        return dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains(SYNC_META_STORE)) return;
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([SYNC_META_STORE], 'readwrite');
                var store = tx.objectStore(SYNC_META_STORE);
                store.put({ id: collection, lastSyncAt: meta.lastSyncAt, maxVersion: meta.maxVersion, dateKeys: meta.dateKeys || [] });
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function() { resolve(); }; // Không reject để tránh lỗi lan truyền
            });
        });
    }
    
    function getMaxVersionFromFirebase(collection) {
        if (!isOnline) return Promise.resolve(0);
        return _getDb().ref(CURRENT_SHOP_ID + '/_meta/' + collection + '/maxVersion').once('value').then(function(snapshot) {
            return snapshot.val() || 0;
        }).catch(function() { return 0; });
    }
    
    function updateMetaOnFirebase(collection, maxVersion) {
        if (!isOnline) return Promise.resolve();
        return _getDb().ref(CURRENT_SHOP_ID + '/_meta/' + collection).update({
            maxVersion: maxVersion,
            lastUpdatedAt: firebase.database.ServerValue.TIMESTAMP
        }).catch(function(err) {
            console.warn('⚠️ Could not update _meta for', collection, err);
        });
    }
    
    // ========== SMART SYNC ==========
    
    var _syncPromise = null;
    
    function whenSyncComplete() {
        if (_syncPromise) return _syncPromise;
        return Promise.resolve();
    }
    
    function smartSync() {
        if (!isOnline) {
            _syncPromise = Promise.resolve();
            return _syncPromise;
        }
        
        console.log('🔄 Smart sync started...');
        
        var masterKeys = Object.keys(MASTER_COLLECTIONS);
        var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
        
        var syncResults = { full: [], delta: [], skipped: [] };
        
        function syncCollection(collection) {
            // Master collections: dùng reconcileCollection (so sánh keys, thêm thiếu, xóa dư)
            // Thay vì fullSync (xóa hết rồi tải lại toàn bộ)
            if (MASTER_COLLECTIONS[collection]) {
                return getSyncMeta(collection).then(function(meta) {
                    var isLocalEmpty = !memoryCache[collection] || Object.keys(memoryCache[collection]).length === 0;
                    
                    if (!meta || isLocalEmpty) {
                        if (isLocalEmpty) {
                            return loadFromLocal(collection).then(function(localData) {
                                var hasLocalData = localData && (Array.isArray(localData) ? localData.length > 0 : Object.keys(localData).length > 0);
                                if (hasLocalData) {
                                    if (!memoryCache[collection]) memoryCache[collection] = {};
                                    for (var i = 0; i < localData.length; i++) {
                                        memoryCache[collection][localData[i].id] = localData[i];
                                    }
                                    if (meta) {
                                        syncResults.delta.push(collection);
                                        return deltaSync(collection);
                                    }
                                }
                                // Không có dữ liệu local → reconcile để tải đúng những gì Firebase có
                                syncResults.delta.push(collection);
                                return reconcileCollection(collection);
                            });
                        }
                        // Không có meta → reconcile thay vì fullSync
                        syncResults.delta.push(collection);
                        return reconcileCollection(collection);
                    }
                    
                    var now = Date.now();
                    var timeSinceLastSync = now - (meta.lastSyncAt || 0);
                    
                    if (timeSinceLastSync > THIRTY_DAYS_MS) {
                        // Quá 30 ngày: reconcile để đảm bảo đồng bộ hoàn toàn
                        syncResults.delta.push(collection);
                        return reconcileCollection(collection);
                    }
                    
                    syncResults.delta.push(collection);
                    return deltaSync(collection);
                });
            }
            
            // Date-based collections: giữ nguyên logic cũ (deltaSync, fullSync nếu cần)
            return getSyncMeta(collection).then(function(meta) {
                var isLocalEmpty = !memoryCache[collection] || Object.keys(memoryCache[collection]).length === 0;
                
                if (!meta || isLocalEmpty) {
                    if (isLocalEmpty) {
                        return loadFromLocal(collection).then(function(localData) {
                            var hasLocalData = localData && (Array.isArray(localData) ? localData.length > 0 : Object.keys(localData).length > 0);
                            if (hasLocalData) {
                                if (!memoryCache[collection]) memoryCache[collection] = {};
                                for (var i = 0; i < localData.length; i++) {
                                    memoryCache[collection][localData[i].id] = localData[i];
                                }
                                if (meta) {
                                    syncResults.delta.push(collection);
                                    return deltaSync(collection);
                                }
                            }
                            syncResults.full.push(collection);
                            return fullSync(collection);
                        });
                    }
                    syncResults.full.push(collection);
                    return fullSync(collection);
                }
                
                var now = Date.now();
                var timeSinceLastSync = now - (meta.lastSyncAt || 0);
                
                if (timeSinceLastSync > THIRTY_DAYS_MS) {
                    syncResults.full.push(collection);
                    return fullSync(collection);
                }
                
                syncResults.delta.push(collection);
                return deltaSync(collection);
            });
        }
        
        var masterPromises = [];
        for (var m = 0; m < masterKeys.length; m++) {
            (function(collection) {
                masterPromises.push(syncCollection(collection));
            })(masterKeys[m]);
        }
        
        var todayKey = toDateKey(Date.now());
        var datePromises = [];

        // Tối ưu: đọc syncMeta 1 lần cho mỗi collection, kiểm tra dateKeys trong memory
        function _syncMissingDates(collection, requiredDateKeys) {
            return getSyncMeta(collection).then(function(meta) {
                var existingDateKeys = (meta && meta.dateKeys) || [];
                var existingSet = {};
                for (var i = 0; i < existingDateKeys.length; i++) {
                    existingSet[existingDateKeys[i]] = true;
                }
                var missingDateKeys = [];
                for (var i = 0; i < requiredDateKeys.length; i++) {
                    if (!existingSet[requiredDateKeys[i]]) {
                        missingDateKeys.push(requiredDateKeys[i]);
                    }
                }
                if (missingDateKeys.length === 0) {
                    // Đã có đủ dateKeys, chỉ chạy deltaSync
                    return deltaSync(collection);
                }
                // Fetch từng ngày còn thiếu
                var chain = Promise.resolve();
                for (var i = 0; i < missingDateKeys.length; i++) {
                    (function(dk) {
                        chain = chain.then(function() {
                            return syncCollectionByDate(collection, dk);
                        });
                    })(missingDateKeys[i]);
                }
                return chain;
            });
        }

        if (_isEmployeeMode()) {
            for (var d = 0; d < dateKeys.length; d++) {
                (function(collection) {
                    datePromises.push(_syncMissingDates(collection, [todayKey]));
                })(dateKeys[d]);
            }
        } else {
            var dateKeysList = getDateKeysBetween(
                toDateKey(Date.now() - THIRTY_DAYS_MS),
                todayKey
            );
            for (var d = 0; d < dateKeys.length; d++) {
                (function(collection) {
                    datePromises.push(_syncMissingDates(collection, dateKeysList));
                })(dateKeys[d]);
            }
        }
        
        _syncPromise = Promise.all(masterPromises).then(function() {
            return Promise.all(datePromises);
        }).then(function() {
            console.log('✅ Smart sync completed' + (_isEmployeeMode() ? ' (today only)' : ' (31 days)') + '. Full:', syncResults.full.length, 'Delta:', syncResults.delta.length, 'Skipped:', syncResults.skipped.length);
            return syncResults;
        });
        return _syncPromise;
    }
    
    function fullSync(collection) {
        if (!isOnline) return Promise.resolve();
        
        var isDateBased = DATE_BASED_COLLECTIONS[collection];
        var isMaster = MASTER_COLLECTIONS[collection];
        if (!isMaster && !isDateBased) {
            console.warn('  ⚠️ Unknown collection, skipping fullSync:', collection);
            return Promise.resolve();
        }
        
        return new Promise(function(resolve, reject) {
            var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
            
            if (isDateBased) {
                var thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS;
                ref = ref.orderByChild('createdAt').startAt(thirtyDaysAgo);
            }
            
            ref.once('value', function(snapshot) {
                if (!snapshot.exists()) {
                    saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: 0, dateKeys: [] });
                    resolve();
                    return;
                }
                
                var remote = snapshot.val() || {};
                var count = 0;
                var maxVersion = 0;
                var dateKeys = [];
                
                _setSuppressRealtime(true);
                
                // FIX: Đánh dấu collection đang được fullSync
                // Để loadFromLocal() biết không đọc từ IndexedDB đã bị clear
                if (isMaster) {
                    _syncingCollections[collection] = true;
                }
                
                if (isMaster && memoryCache[collection]) {
                    memoryCache[collection] = {};
                }
                
                var preClear = Promise.resolve();
                if (isMaster) {
                    preClear = new Promise(function(clearResolve) {
                        var tx = localDB.transaction([collection], 'readwrite');
                        var store = tx.objectStore(collection);
                        var req = store.clear();
                        req.onsuccess = function() { clearResolve(); };
                        req.onerror = function() { clearResolve(); };
                    });
                }
                
                if (collection === 'info') {
                    var infoItem = { id: 'shop_config' };
                    for (var pk in remote) {
                        if (remote.hasOwnProperty(pk)) {
                            infoItem[pk] = remote[pk];
                        }
                    }
                    if (infoItem._version === undefined) infoItem._version = 1;
                    saveToLocal(collection, infoItem).then(function() {
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: infoItem._version || 1, dateKeys: [] });
                        _setSuppressRealtime(false);
                        _emit(collection + ':synced', { collection: collection, count: 1, timestamp: Date.now() });
                        console.log('  📥 Full synced info: 1 item');
                        resolve();
                    });
                    return;
                }
                
                var saveChain = preClear;
                for (var key in remote) {
                    if (remote.hasOwnProperty(key)) {
                        (function(itemKey) {
                            saveChain = saveChain.then(function() {
                                var src = remote[itemKey];
                                var item = { id: itemKey };
                                for (var p in src) {
                                    if (src.hasOwnProperty(p)) {
                                        item[p] = src[p];
                                    }
                                }
                                if (item._version === undefined) item._version = 1;
                                if (item._version > maxVersion) maxVersion = item._version;
                                
                                if (isDateBased && item.dateKey && dateKeys.indexOf(item.dateKey) < 0) {
                                    dateKeys.push(item.dateKey);
                                }
                                
                                count++;
                                return saveToLocal(collection, item);
                            });
                        })(key);
                    }
                }
                
                return saveChain.then(function() {
                    // Ghi sync_meta
                    saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: maxVersion, dateKeys: dateKeys });
                    updateMetaOnFirebase(collection, maxVersion);
                    _setSuppressRealtime(false);
                    if (isMaster) delete _syncingCollections[collection];
                    _emit(collection + ':synced', { collection: collection, count: count, timestamp: Date.now() });
                    resolve();
                }).catch(function(err) {
                    console.error('  ❌ Error full syncing ' + collection + ': ', err);
                    _setSuppressRealtime(false);
                    if (isMaster) delete _syncingCollections[collection];
                    resolve();
                });
            }, function(err) {
                console.error('  ❌ Firebase read error for ' + collection + ': ', err);
                _setSuppressRealtime(false);
                if (isMaster) delete _syncingCollections[collection];
                resolve();
            });
        });
    }
    
    function deltaSync(collection) {
        if (!isOnline) return Promise.resolve();
        
        return getSyncMeta(collection).then(function(meta) {
            var localMaxVersion = (meta && meta.maxVersion) || 0;
            
            return new Promise(function(resolve, reject) {
                var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
                var queryRef = ref.orderByChild('_version').startAt(localMaxVersion + 1);
                
                queryRef.once('value', function(snapshot) {
                    var remote = snapshot.exists() ? (snapshot.val() || {}) : {};
                    var count = 0;
                    var newMaxVersion = localMaxVersion;
                    var dateKeys = (meta && meta.dateKeys) || [];
                    var isDateBased = DATE_BASED_COLLECTIONS[collection];
                    
                    if (collection === 'info') {
                        var infoItem = { id: 'shop_config' };
                        for (var pk in remote) {
                            if (remote.hasOwnProperty(pk)) {
                                infoItem[pk] = remote[pk];
                            }
                        }
                        if (infoItem._version === undefined) infoItem._version = 1;
                        saveToLocal(collection, infoItem).then(function() {
                            saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: infoItem._version || 1, dateKeys: [] });
                            resolve();
                        });
                        return;
                    }
                    
                    var saveChain = Promise.resolve();
                    for (var key in remote) {
                        if (remote.hasOwnProperty(key)) {
                            (function(itemKey) {
                                saveChain = saveChain.then(function() {
                                    var src = remote[itemKey];
                                    var item = { id: itemKey };
                                    for (var p in src) {
                                        if (src.hasOwnProperty(p)) {
                                            item[p] = src[p];
                                        }
                                    }
                                    if (item._version === undefined) item._version = 1;
                                    if (item._version > newMaxVersion) newMaxVersion = item._version;
                                    
                                    if (isDateBased && item.dateKey && dateKeys.indexOf(item.dateKey) < 0) {
                                        dateKeys.push(item.dateKey);
                                    }
                                    
                                    count++;
                                    return saveToLocal(collection, item);
                                });
                            })(key);
                        }
                    }
                    
                    return saveChain.then(function() {
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: newMaxVersion, dateKeys: dateKeys });
                        updateMetaOnFirebase(collection, newMaxVersion);
                        resolve();
                    }).catch(function(err) {
                        console.error('  ❌ Error delta syncing ' + collection + ': ', err);
                        resolve();
                    });
                }, function(err) {
                    console.error('  ❌ Firebase query error for ' + collection + ': ', err);
                    resolve();
                });
            });
        });
    }
    
    
    function reconcileSnapshot(collection) {
        if (!isOnline) return Promise.resolve();
        var isMaster = MASTER_COLLECTIONS[collection];
        console.log('🔄 Reconcile snapshot for:', collection);
        if (isMaster) {
            // Master collections: reset sync_meta + fullSync
            return saveSyncMeta(collection, { lastSyncAt: 0, maxVersion: 0, dateKeys: [] }).then(function() {
                return fullSync(collection);
            });
        } else {
            return deltaSync(collection);
        }
    }
    
    var _fetchingDateKeys = {};
    
    function syncCollectionByDate(collection, dateKey) {
        if (!isOnline) return Promise.resolve([]);
        
        var fetchKey = collection + '|' + dateKey;
        if (_fetchingDateKeys[fetchKey]) {
            return _fetchingDateKeys[fetchKey];
        }
        
        var promise = _doSyncCollectionByDate(collection, dateKey);
        _fetchingDateKeys[fetchKey] = promise;
        
        return promise.then(function(result) {
            delete _fetchingDateKeys[fetchKey];
            return result;
        }).catch(function(err) {
            delete _fetchingDateKeys[fetchKey];
            throw err;
        });
    }
    
    function _doSyncCollectionByDate(collection, dateKey) {
        return getSyncMeta(collection).then(function(meta) {
            var dateKeys = (meta && meta.dateKeys) || [];
            
            // Luôn fetch từ Firebase để đảm bảo dữ liệu đầy đủ
            // Không skip dựa vào dateKeys trong meta vì deltaSync có thể đã thêm
            // dateKey vào meta nhưng chỉ với 1 item (không đầy đủ)
            
            // console.log('  📥 Fetching', collection, 'for date:', dateKey);
            
            return new Promise(function(resolve, reject) {
                var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
                ref.orderByChild('dateKey').equalTo(dateKey).once('value', function(snapshot) {
                    if (!snapshot.exists()) {
                        if (dateKeys.indexOf(dateKey) < 0) {
                            dateKeys.push(dateKey);
                        }
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: (meta && meta.maxVersion) || 0, dateKeys: dateKeys });
                        // console.log('  📥 Fetched', collection, 'for', dateKey, ': 0 items (no data)');
                        resolve([]);
                        return;
                    }
                    
                    var remote = snapshot.val() || {};
                    var items = [];
                    var maxVersion = (meta && meta.maxVersion) || 0;
                    
                    var saveChain = Promise.resolve();
                    for (var key in remote) {
                        if (remote.hasOwnProperty(key)) {
                            (function(itemKey) {
                                saveChain = saveChain.then(function() {
                                    var src = remote[itemKey];
                                    var item = { id: itemKey };
                                    for (var p in src) {
                                        if (src.hasOwnProperty(p)) {
                                            item[p] = src[p];
                                        }
                                    }
                                    if (item._version === undefined) item._version = 1;
                                    if (item._version > maxVersion) maxVersion = item._version;
                                    items.push(item);
                                    return saveToLocal(collection, item);
                                });
                            })(key);
                        }
                    }
                    
                    return saveChain.then(function() {
                        if (dateKeys.indexOf(dateKey) < 0) {
                            dateKeys.push(dateKey);
                        }
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: maxVersion, dateKeys: dateKeys });
                        updateMetaOnFirebase(collection, maxVersion);
                        // console.log('  📥 Fetched', collection, 'for', dateKey, ':', items.length, 'items');
                        resolve(items);
                    }).catch(function(err) {
                        console.error('  ❌ Error fetching', collection, 'by date:', err);
                        resolve([]);
                    });
                }, function(err) {
                    console.error('  ❌ Firebase query error:', err);
                    resolve([]);
                });
            });
        });
    }
    
    function ensureRecentDaysData(daysCount, callback) {
        daysCount = daysCount || 31; // Hôm nay + 30 ngày trước
        callback = callback || function() {};
        
        if (!isOnline) {
            callback({ error: 'OFFLINE' });
            return Promise.reject(new Error('Offline'));
        }
        
        var now = Date.now();
        var endDateKey = toDateKey(now);
        
        var startDate = new Date(now);
        startDate.setDate(startDate.getDate() - (daysCount - 1));
        var startDateKey = toDateKey(startDate.getTime());
        
        var requiredDateKeys = getDateKeysBetween(startDateKey, endDateKey);
        var dateKeysList = Object.keys(DATE_BASED_COLLECTIONS);
        
        var totalTasks = dateKeysList.length;
        var completedTasks = 0;
        var allResults = {};
        
        console.log('📦 ensureRecentDaysData: Need', requiredDateKeys.length, 'dateKeys for', dateKeysList.length, 'collections');
        
        function processCollection(collection) {
            return getSyncMeta(collection).then(function(meta) {
                var existingDateKeys = (meta && meta.dateKeys) || [];
                var existingSet = {};
                for (var i = 0; i < existingDateKeys.length; i++) {
                    existingSet[existingDateKeys[i]] = true;
                }
                
                var missingDateKeys = [];
                for (var i = 0; i < requiredDateKeys.length; i++) {
                    if (!existingSet[requiredDateKeys[i]]) {
                        missingDateKeys.push(requiredDateKeys[i]);
                    }
                }
                
                if (missingDateKeys.length === 0) {
                    completedTasks++;
                    callback({ current: completedTasks, total: totalTasks, collection: collection, dateKey: null, status: 'skipped', missingCount: 0 });
                    return { collection: collection, fetched: 0, skipped: true };
                }
                
                console.log('  📥 Collection', collection, 'missing', missingDateKeys.length, 'days');
                
                var chain = Promise.resolve();
                var fetchedCount = 0;
                
                for (var i = 0; i < missingDateKeys.length; i++) {
                    (function(dateKey) {
                        chain = chain.then(function() {
                            callback({ current: completedTasks, total: totalTasks, collection: collection, dateKey: dateKey, status: 'fetching', missingCount: missingDateKeys.length });
                            return syncCollectionByDate(collection, dateKey).then(function(items) {
                                fetchedCount += (items ? items.length : 0);
                            });
                        });
                    })(missingDateKeys[i]);
                }
                
                return chain.then(function() {
                    completedTasks++;
                    callback({ current: completedTasks, total: totalTasks, collection: collection, dateKey: null, status: 'done', missingCount: missingDateKeys.length, fetchedCount: fetchedCount });
                    return { collection: collection, fetched: fetchedCount, missingCount: missingDateKeys.length };
                });
            });
        }
        
        var chain = Promise.resolve();
        for (var c = 0; c < dateKeysList.length; c++) {
            (function(collection) {
                chain = chain.then(function() {
                    return processCollection(collection);
                }).then(function(result) {
                    allResults[collection] = result;
                });
            })(dateKeysList[c]);
        }
        
        return chain.then(function() {
            console.log('✅ ensureRecentDaysData completed:', allResults);
            return allResults;
        });
    }
    
    function getDateKeysBetween(startDateKey, endDateKey) {
        var keys = [];
        var start = new Date(startDateKey + 'T00:00:00');
        var end = new Date(endDateKey + 'T00:00:00');
        var current = new Date(start);
        while (current <= end) {
            var y = current.getFullYear();
            var m = ('0' + (current.getMonth() + 1)).slice(-2);
            var d = ('0' + current.getDate()).slice(-2);
            keys.push(y + '-' + m + '-' + d);
            current.setDate(current.getDate() + 1);
        }
        return keys;
    }

    // Init IndexedDB
    function initLocalDB() {
        if (dbReady) return dbReady;
        dbReady = new Promise(function(resolve, reject) {
            var request = indexedDB.open(STORE_NAME, 20);
            request.onerror = function(e) { reject(e.target.error); };
            request.onsuccess = function(e) {
                localDB = e.target.result;
                loadSyncQueue();
                resolve(localDB);
            };
            request.onupgradeneeded = function(e) {
                var db = e.target.result;
                var stores = [
    'tables', 'customers', 'menu', 'menu_categories',
    'ingredients', 'transactions', 'reports', 'sync_queue', 'staffs',
    'cost_categories', 'cost_transactions', 'cost_transactions_admin',
    'admin_cost_categories', 'daily_balances',
    'inventory_transactions', 'manager_cash_pickups',
    'ingredient_transactions', 'notifications',
    'info',
    'messages',
    'delete_logs',
    'sync_meta',
    'bonus_fund'
];
                for (var i = 0; i < stores.length; i++) {
                    if (!db.objectStoreNames.contains(stores[i])) {
                        db.createObjectStore(stores[i], { keyPath: 'id' });
                        console.log('Created store:', stores[i]);
                    }
                }
                try {
                    var tx = e.target.transaction;
                    
                    if (e.oldVersion < 17 && tx && tx.objectStoreNames.contains('info')) {
                        var infoStore = tx.objectStore('info');
                        infoStore.clear();
                        console.log('Cleared old info store data for version 17 migration');
                    }
                    
                    if (tx && tx.objectStoreNames.contains('transactions')) {
                        var txStore = tx.objectStore('transactions');
                        if (!txStore.indexNames.contains('dateKey')) txStore.createIndex('dateKey', 'dateKey', { unique: false });
                        if (!txStore.indexNames.contains('type')) txStore.createIndex('type', 'type', { unique: false });
                        if (!txStore.indexNames.contains('dateTypeKey')) txStore.createIndex('dateTypeKey', 'dateTypeKey', { unique: false });
                    }
                } catch(ex) {
                    console.warn('Could not create indexes:', ex);
                }
            };
        });
        return dbReady;
    }

    function loadSyncQueue() {
        if (!localDB) return;
        var tx = localDB.transaction(['sync_queue'], 'readonly');
        var store = tx.objectStore('sync_queue');
        var req = store.getAll();
        req.onsuccess = function() { syncQueue = req.result || []; };
    }

    function seedDefaultShop() {
        return db.ref('shop_registry/123123').once('value').then(function(snapshot) {
            if (snapshot.exists()) return; // Đã có rồi, không cần seed
            
            console.log('🌱 Seeding default shop data...');
            var staffId = 'staff_admin_' + Date.now().toString(36);
            var updates = {};
            
            updates['shop_registry/123123'] = {
                shopId: 'shop_default',
                shopName: 'MILANO COFFEE 259',
                shopCode: '123123',
                createdAt: Date.now()
            };
            
            updates['shop_default/staffs/' + staffId] = {
                id: staffId,
                username: 'admin123123',
                password: '123123',
                displayName: 'Admin',
                role: 'admin',
                createdAt: Date.now(),
                createdBy: 'system'
            };
            
            updates['shop_default/info'] = {
                id: 'shop_config',
                name: 'MILANO COFFEE 259',
                code: '123123',
                createdAt: Date.now(),
                // Telegram config
                telegramBotToken: '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                telegramChatId: '6372876364',
                telegramShiftCloseToken: '',
                telegramWarningToken: '',
                telegramExpenseToken: '',
                lockPassword: '28122020',
                lockStartHour: 22,
                lockEndHour: 5,
                lockEndMinute: 30,
                tableLockHours: 5
            };
            
            return db.ref().update(updates).then(function() {
                console.log('✅ Default shop seeded: mã 123123, user admin123123, pass 123123');
            });
        }).catch(function(err) {
            console.error('Seed error:', err);
        });
    }

    function ensureShopConfig() {
        return _getDb().ref(CURRENT_SHOP_ID + '/info').once('value').then(function(snapshot) {
            var info = snapshot.val() || {};
            var needsUpdate = false;
            var defaults = {
                id: 'shop_config',
                telegramBotToken: '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                telegramChatId: '6372876364',
                telegramShiftCloseToken: '',
                telegramWarningToken: '',
                telegramExpenseToken: '',
                lockPassword: '28122020',
                lockStartHour: 22,
                lockEndHour: 5,
                lockEndMinute: 30,
                tableLockHours: 5
            };
            var updates = {};
            for (var key in defaults) {
                if (defaults.hasOwnProperty(key)) {
                    if (info[key] === undefined || info[key] === null) {
                        updates[key] = defaults[key];
                        needsUpdate = true;
                    }
                }
            }
            if (needsUpdate) {
                console.log('⚙️ Adding missing config fields to shop info...');
                return _getDb().ref(CURRENT_SHOP_ID + '/info').update(updates).then(function() {
                    console.log('✅ Shop config fields created');
                });
            }
        }).catch(function(err) {
            console.error('⚠️ ensureShopConfig error:', err);
        });
    }

    
    // ========== ENSURE COLLECTION ==========
    function ensureCollection(collection) {
        if (!isOnline) return Promise.resolve([]);
        return loadFromLocal(collection).then(function(localData) {
            if (localData && Object.keys(localData).length > 0) {
                var arr = [];
                for (var k in localData) {
                    if (localData.hasOwnProperty(k)) arr.push(localData[k]);
                }
                return arr;
            }
            console.log('  📦 Local empty for', collection, '- syncing from Firebase...');
            return getSyncMeta(collection).then(function(meta) {
                if (!meta) {
                    return fullSync(collection).then(function() {
                        return loadFromLocal(collection).then(function(data) {
                            var arr = [];
                            for (var k in data) {
                                if (data.hasOwnProperty(k)) arr.push(data[k]);
                            }
                            return arr;
                        });
                    });
                }
                return deltaSync(collection).then(function() {
                    return loadFromLocal(collection).then(function(data) {
                        var arr = [];
                        for (var k in data) {
                            if (data.hasOwnProperty(k)) arr.push(data[k]);
                        }
                        return arr;
                    });
                });
            });
        });
    }
    function forceSyncFromFirebase() {
        if (!isOnline) {
            console.warn('⚠️ Offline, cannot force sync from Firebase');
            return Promise.reject(new Error('Offline'));
        }
        
        // Master collections: fullSync (tables, menu, customers, ingredients, staffs...)
        // Date-based collections: syncCollectionByDate
        var isEmployee = _isEmployeeMode();
        var retentionDays = _getRetentionDays();
        console.log('🔔 Force syncing collections from Firebase (master: fullSync, date-based: ' + (isEmployee ? 'today only' : retentionDays + ' days') + ')...');
        
        syncMetaCache = {};
        
        var todayKey = toDateKey(Date.now());
        
        // Master collections: fullSync song song
        var masterKeys = Object.keys(MASTER_COLLECTIONS);
        var masterPromises = [];
        for (var m = 0; m < masterKeys.length; m++) {
            (function(collection) {
                if (memoryCache[collection]) {
                    memoryCache[collection] = {};
                }
                masterPromises.push(fullSync(collection));
            })(masterKeys[m]);
        }
        
        if (memoryCache['messages']) {
            memoryCache['messages'] = {};
        }
        masterPromises.push(fullSync('messages'));
        
        // Date-based collections: syncCollectionByDate song song
        var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
        var dateKeysToFetch = [];
        if (isEmployee) {
            dateKeysToFetch.push(todayKey);
        } else {
            dateKeysToFetch = getDateKeysBetween(
                toDateKey(Date.now() - _getRetentionMs()),
                todayKey
            );
        }
        
        var datePromises = [];
        for (var d = 0; d < dateKeys.length; d++) {
            (function(collection) {
                if (memoryCache[collection]) {
                    memoryCache[collection] = {};
                }
                for (var k = 0; k < dateKeysToFetch.length; k++) {
                    (function(dk) {
                        datePromises.push(syncCollectionByDate(collection, dk));
                    })(dateKeysToFetch[k]);
                }
            })(dateKeys[d]);
        }
        
        _syncPromise = Promise.all(masterPromises).then(function() {
            return Promise.all(datePromises);
        }).then(function() {
            console.log('✅ Force sync completed' + (isEmployee ? ' (today only)' : ' (31 days)'));
        });
        return _syncPromise;
    }

    // Hủy các subscription cũ và đăng ký lại (dùng khi chuyển Firebase config)
    function _reinitializeSubscriptions() {
        // Hủy tất cả listeners realtime cũ bằng cách gọi unsubscribe functions
        for (var col in _unsubscribeFns) {
            if (_unsubscribeFns.hasOwnProperty(col)) {
                var fns = _unsubscribeFns[col];
                for (var i = 0; i < fns.length; i++) {
                    try {
                        fns[i]();
                    } catch(e) {
                        console.warn('⚠️ Error unsubscribing', col, ':', e.message);
                    }
                }
            }
        }
        _unsubscribeFns = {};
        listeners = {};
        
        // Hủy tất cả polling timers cũ
        for (var timerCol in _pollingTimers) {
            if (_pollingTimers.hasOwnProperty(timerCol)) {
                clearInterval(_pollingTimers[timerCol]);
            }
        }
        _pollingTimers = {};
        
        // Đăng ký lại subscriptions với _getDb() (sẽ dùng _secondaryDb nếu có)
        subscribeToCollection('tables');
        subscribeToCollection('customers');
        subscribeToCollection('transactions', null, { orderByChild: 'createdAt', limitToLast: 200 });
        subscribeToCollection('notifications');
        subscribeToCollection('info');
        subscribeToCollection('daily_balances');
        subscribeToCollection('cost_categories');
        subscribeToCollection('cost_transactions');

        // P1+P2: Thay polling bằng Firebase realtime listeners
        // tables đã có child_added/changed/removed listener ở trên, không cần polling 30s nữa
        // menu, menu_categories, ingredients, messages: subscribe realtime listeners thay vì polling 60s
        subscribeToCollection('menu');
        subscribeToCollection('menu_categories');
        subscribeToCollection('ingredients');
        subscribeToCollection('messages');
        console.log('✅ Re-initialized subscriptions for Firebase config:', _secondaryDb ? 'custom' : 'default');
    }

    // Init Database
    function initDatabase() {
        _restoreDirtyFlags();
        return initLocalDB().then(function() {
            initNetwork();
            // Chỉ chạy smartSync nếu đã có session (đã login trước đó)
            // Tránh đổ dữ liệu từ default Firebase khi chưa login
            if (isOnline && currentUser) {
                return smartSync();
            }
            return Promise.resolve();
        }).then(function() {
            // seedDefaultShop chỉ chạy khi dùng default Firebase (không có custom config)
            // và chưa có session (lần đầu tiên)
            if (!_secondaryDb && !currentUser) {
                return seedDefaultShop();
            }
            return Promise.resolve();
        }).then(function() {
            // ensureShopConfig chỉ chạy khi đã có session (đã login)
            // để tránh ghi config vào sai shopId
            if (currentUser) {
                return ensureShopConfig();
            }
            return Promise.resolve();
        }).then(function() {
            // tables, customers, menu, menu_categories, transactions, notifications
            //      admin_cost_categories, reports
            subscribeToCollection('tables');
            subscribeToCollection('customers');
            subscribeToCollection('transactions', null, { orderByChild: 'createdAt', limitToLast: 200 });
            subscribeToCollection('notifications');
            subscribeToCollection('info');
            subscribeToCollection('daily_balances');
            subscribeToCollection('cost_categories');
            subscribeToCollection('cost_transactions');

            // P1+P2: Thay polling bằng Firebase realtime listeners
            // tables đã có child_added/changed/removed listener ở trên, không cần polling 30s nữa
            // menu, menu_categories, ingredients, messages: subscribe realtime listeners thay vì polling 60s
            subscribeToCollection('menu');
            subscribeToCollection('menu_categories');
            subscribeToCollection('ingredients');
            subscribeToCollection('messages');
            // PHASE 4: Khởi động periodic cleanup cache
            _startPeriodicCleanup();
            // DATA RETENTION: Khởi động cleanup dữ liệu cũ định kỳ (mỗi 6 tiếng)
            _startPeriodicDataCleanup();
            console.log('✅ Database ready, device:', CURRENT_DEVICE_ID);
            return { isOnline: isOnline, deviceId: CURRENT_DEVICE_ID };
        });
    }

    function showToast(msg, type) {
        var container = document.getElementById('toastContainer');
        if (!container) { console.log(msg); return; }
        var toast = document.createElement('div');
        toast.className = 'toast ' + (type || 'info');
        toast.innerText = msg;
        container.appendChild(toast);
        setTimeout(function() { toast.remove(); }, 2500);
    }

    // ========== AUTH METHODS ==========
    
    function clearLocalData() {
        memoryCache = {};
        cacheVersion = {};
        syncMetaCache = {};
        // PHASE 4: Dọn cache timestamps khi clear data
        _cacheTimestamps = {};
        _txDateCache = {};
        _txDateCacheTimestamps = {};
        
        try {
            var lsPrefix = LS_SYNC_META_PREFIX + CURRENT_SHOP_ID + '_';
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.indexOf(lsPrefix) === 0) {
                    keysToRemove.push(key);
                }
            }
            for (var i = 0; i < keysToRemove.length; i++) {
                localStorage.removeItem(keysToRemove[i]);
            }
        } catch (e) {}
        
        if (!localDB) return Promise.resolve();
        
        var storeNames = [];
        for (var i = 0; i < localDB.objectStoreNames.length; i++) {
            storeNames.push(localDB.objectStoreNames[i]);
        }
        var promises = [];
        for (var i = 0; i < storeNames.length; i++) {
            var name = storeNames[i];
            if (name === 'sync_queue') continue; // Giữ lại sync queue
            promises.push(new Promise(function(resolve, reject) {
                var tx = localDB.transaction([name], 'readwrite');
                var store = tx.objectStore(name);
                var req = store.clear();
                req.onsuccess = function() { resolve(); };
                req.onerror = function() { reject(req.error); };
            }));
        }
        return Promise.all(promises).then(function() {
            console.log('🗑️ Cleared all local data for shop switch');
        });
    }
    
    function setShopId(shopId) {
        if (!shopId) return;
        CURRENT_SHOP_ID = shopId;
        localStorage.setItem('current_shop_id', shopId);
        console.log('🔔 Switched to shop:', shopId);
    }
    
    function getShopId() {
        return CURRENT_SHOP_ID;
    }
    
    function login(shopCode, username, password) {
        if (!username || !password) {
            return Promise.reject(new Error('Vui lòng nhập tên đăng nhập và mật khẩu'));
        }
        
        // Kiểm tra MASTER_CONFIG trước (nếu đã load)
        if (typeof MASTER_CONFIG !== 'undefined' && MASTER_CONFIG) {
            return MASTER_CONFIG.login(shopCode, username, password).then(function(result) {
                if (result) {
                    // Master admin login
                    if (result.isMasterAdmin) {
                        // Master admin login vào POS cụ thể (có mã POS)
                        if (result.isMasterInPos) {
                            var posInfo = result.posInfo;
                            var shopId = posInfo.shopId || ('shop_' + posInfo.code);
                            
                            // Xóa dữ liệu local trước khi chuyển sang POS khác
                            return clearLocalData().then(function() {
                                // Khởi tạo custom Firebase config nếu có
                                if (result.firebaseConfig) {
                                    localStorage.setItem('pos_firebase_config', JSON.stringify(result.firebaseConfig));
                                    return initWithCustomConfig(result.firebaseConfig).then(function() {
                                        _reinitializeSubscriptions();
                                        currentUser = {
                                            id: 'master_admin',
                                            username: result.user.username,
                                            displayName: result.user.displayName,
                                            role: 'master_admin',
                                            shopId: shopId,
                                            shopCode: posInfo.code,
                                            shopName: posInfo.name || ''
                                        };
                                        localStorage.setItem('pos_session', JSON.stringify(currentUser));
                                        localStorage.setItem('current_shop_id', shopId);
                                        return currentUser;
                                    });
                                } else {
                                    localStorage.removeItem('pos_firebase_config');
                                    return initWithCustomConfig(null).then(function() {
                                        _reinitializeSubscriptions();
                                        currentUser = {
                                            id: 'master_admin',
                                            username: result.user.username,
                                            displayName: result.user.displayName,
                                            role: 'master_admin',
                                            shopId: shopId,
                                            shopCode: posInfo.code,
                                            shopName: posInfo.name || ''
                                        };
                                        localStorage.setItem('pos_session', JSON.stringify(currentUser));
                                        localStorage.setItem('current_shop_id', shopId);
                                        return currentUser;
                                    });
                                }
                            });
                        }
                        
                        // Master admin login không có mã POS → vào Master Control
                        currentUser = {
                            id: 'master_admin',
                            username: result.user.username,
                            displayName: 'Master Admin',
                            role: 'master_admin',
                            shopId: 'master',
                            shopCode: 'master',
                            shopName: 'Master Control'
                        };
                        localStorage.setItem('pos_session', JSON.stringify(currentUser));
                        localStorage.setItem('current_shop_id', 'master');
                        localStorage.removeItem('pos_firebase_config');
                        // Dùng default db
                        initWithCustomConfig(null);
                        return currentUser;
                    }
                    
                    // POS admin login - có thể có custom Firebase config
                    var posInfo = result.posInfo;
                    var shopId = posInfo.shopId || ('shop_' + posInfo.code);
                    
                    // QUAN TRỌNG: Xóa dữ liệu local TRƯỚC khi chuyển sang custom Firebase config
                    // để tránh dữ liệu cũ từ default Firebase bị mix với dữ liệu mới
                    return clearLocalData().then(function() {
                        // Khởi tạo custom Firebase config nếu có
                        if (result.firebaseConfig) {
                            localStorage.setItem('pos_firebase_config', JSON.stringify(result.firebaseConfig));
                            return initWithCustomConfig(result.firebaseConfig).then(function() {
                                _reinitializeSubscriptions();
                                return _completePosLogin(result.user, posInfo, shopId);
                            });
                        } else {
                            localStorage.removeItem('pos_firebase_config');
                            // Dùng default db
                            return initWithCustomConfig(null).then(function() {
                                _reinitializeSubscriptions();
                                return _completePosLogin(result.user, posInfo, shopId);
                            });
                        }
                    });
                }
                // result falsy (null) - không phải master admin, không có trong shop_registry
                // Fallback: login qua shop_registry (tương thích ngược)
                return _legacyLogin(shopCode, username, password);
            }).catch(function(err) {
                // Nếu MASTER_CONFIG bị lỗi HOẶC sai mật khẩu
                // Kiểm tra nếu POS có custom Firebase config thì KHÔNG fallback về legacy
                // vì legacy chỉ đọc từ default Firebase, chắc chắn không có staffs ở đó
                if (err && err.customFirebaseConfig) {
                    throw err;
                }
                // Nếu POS bị khóa, throw luôn không fallback về legacy
                if (err && err.locked) {
                    throw err;
                }
                // Fallback về legacy cho các POS dùng default Firebase
                return _legacyLogin(shopCode, username, password);
            });
        }
        
        // Không có MASTER_CONFIG, dùng legacy login
        return _legacyLogin(shopCode, username, password);
    }
    
    // Login cũ qua shop_registry (giữ để tương thích ngược)
    function _legacyLogin(shopCode, username, password) {
        return db.ref('shop_registry/' + shopCode).once('value').then(function(snapshot) {
            if (!snapshot.exists()) {
                throw new Error('Mã POS không tồn tại');
            }
            var shopInfo = snapshot.val();
            var shopId = shopInfo.shopId;
            
            return db.ref(shopId + '/staffs').once('value').then(function(staffSnapshot) {
                var staffs = staffSnapshot.val() || {};
                var foundStaff = null;
                for (var key in staffs) {
                    if (staffs.hasOwnProperty(key)) {
                        var s = staffs[key];
                        if (s.username === username && s.password === password) {
                            foundStaff = s;
                            foundStaff.id = key;
                            break;
                        }
                    }
                }
                if (!foundStaff) {
                    throw new Error('Sai tên đăng nhập hoặc mật khẩu');
                }
                
                return clearLocalData().then(function() {
                    currentUser = {
                        id: foundStaff.id,
                        username: foundStaff.username,
                        displayName: foundStaff.displayName || foundStaff.username,
                        role: foundStaff.role || 'staff',
                        shopId: shopId,
                        shopCode: shopCode,
                        shopName: shopInfo.shopName || ''
                    };
                    localStorage.setItem('pos_session', JSON.stringify(currentUser));
                    localStorage.removeItem('pos_firebase_config');
                    setShopId(shopId);
                    
                    return currentUser;
                });
            });
        });
    }
    
    // Hoàn tất login POS với thông tin từ master config
    // Lưu ý: clearLocalData() đã được gọi TRƯỚC đó trong login()
    function _completePosLogin(userData, posInfo, shopId) {
        currentUser = {
            id: userData.id || ('staff_' + Date.now().toString(36)),
            username: userData.username,
            displayName: userData.displayName || userData.username,
            role: 'admin',
            shopId: shopId,
            shopCode: posInfo.code,
            shopName: posInfo.name || ''
        };
        localStorage.setItem('pos_session', JSON.stringify(currentUser));
        setShopId(shopId);
        return Promise.resolve(currentUser);
    }
    
    function registerShop(shopName, shopCode, adminUser, adminPass) {
        if (!shopName || !shopCode || !adminUser || !adminPass) {
            return Promise.reject(new Error('Vui lòng nhập đầy đủ thông tin'));
        }
        if (shopCode.length < 3) {
            return Promise.reject(new Error('Mã POS phải có ít nhất 3 ký tự'));
        }
        if (adminPass.length < 4) {
            return Promise.reject(new Error('Mật khẩu phải có ít nhất 4 ký tự'));
        }
        
        return db.ref('shop_registry/' + shopCode).once('value').then(function(snapshot) {
            if (snapshot.exists()) {
                throw new Error('Mã POS này đã được đăng ký');
            }
            
            var shopId = 'shop_' + shopCode.toLowerCase();
            
            var staffId = 'staff_' + Date.now().toString(36);
            var staffData = {
                id: staffId,
                username: adminUser,
                password: adminPass,
                displayName: adminUser,
                role: 'admin',
                createdAt: Date.now(),
                createdBy: 'system'
            };
            
            var registryData = {
                shopId: shopId,
                shopName: shopName,
                shopCode: shopCode,
                adminUser: adminUser,
                adminPass: adminPass,
                role: 'pos_admin',
                createdAt: Date.now()
            };
            
            // Batch write: shop_registry + shop data + staff
            var updates = {};
            updates['shop_registry/' + shopCode] = registryData;
            updates[shopId + '/staffs/' + staffId] = staffData;
            updates[shopId + '/info'] = {
                id: 'shop_config',
                name: shopName,
                code: shopCode,
                createdAt: Date.now()
            };
            
            return db.ref().update(updates).then(function() {
                return clearLocalData();
            }).then(function() {
                currentUser = {
                    id: staffId,
                    username: adminUser,
                    displayName: adminUser,
                    role: 'admin',
                    shopId: shopId,
                    shopCode: shopCode,
                    shopName: shopName
                };
                localStorage.setItem('pos_session', JSON.stringify(currentUser));
                setShopId(shopId);
                return currentUser;
            });
        });
    }
    
    function createStaff(staffData) {
        if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'master_admin')) {
            return Promise.reject(new Error('Chỉ admin mới có thể tạo nhân viên'));
        }
        if (!staffData.username || !staffData.password) {
            return Promise.reject(new Error('Vui lòng nhập tên đăng nhập và mật khẩu'));
        }
        
        var staffId = 'staff_' + Date.now().toString(36);
        var data = {
            id: staffId,
            username: staffData.username,
            password: staffData.password,
            displayName: staffData.displayName || staffData.username,
            role: staffData.role || 'staff',
            createdAt: Date.now(),
            createdBy: currentUser.id
        };
        
        var ref = _getDb().ref(CURRENT_SHOP_ID + '/staffs/' + staffId);
        return ref.set(data).then(function() {
            return saveToLocal('staffs', data);
        }).then(function() {
            return data;
        });
    }
    
    function getStaffs() {
        return getAll('staffs').then(function(localStaffs) {
            if (localStaffs && localStaffs.length > 0) {
                _getDb().ref(CURRENT_SHOP_ID + '/staffs').once('value').then(function(snapshot) {
                    var data = snapshot.val() || {};
                    for (var key in data) {
                        if (data.hasOwnProperty(key)) {
                            var item = data[key];
                            item.id = key;
                            saveToLocal('staffs', item);
                        }
                    }
                }).catch(function() {
                });
                return localStaffs;
            }
            return _getDb().ref(CURRENT_SHOP_ID + '/staffs').once('value').then(function(snapshot) {
                var data = snapshot.val() || {};
                var list = [];
                for (var key in data) {
                    if (data.hasOwnProperty(key)) {
                        var item = data[key];
                        item.id = key;
                        list.push(item);
                    }
                }
                for (var i = 0; i < list.length; i++) {
                    saveToLocal('staffs', list[i]);
                }
                return list;
            }).catch(function() {
                return getAll('staffs');
            });
        });
    }
    
    function logout() {
        currentUser = null;
        localStorage.removeItem('pos_session');
        localStorage.removeItem('pos_firebase_config');
        CURRENT_SHOP_ID = 'shop_default';
        localStorage.setItem('current_shop_id', 'shop_default');
        
        // Dọn dẹp secondary Firebase app nếu có
        if (_secondaryApp) {
            try {
                _secondaryApp.delete();
            } catch(e) {
                console.warn('⚠️ Could not delete secondary Firebase app:', e.message);
            }
            _secondaryApp = null;
            _secondaryDb = null;
        }
        
        console.log('👋 Logged out');
    }
    
    function getCurrentUser() {
        return currentUser;
    }
    
    function isLoggedIn() {
        return currentUser !== null;
    }
    
    function isAdmin() {
        return currentUser && (currentUser.role === 'admin' || currentUser.role === 'master_admin' || currentUser.role === 'pos_admin');
    }

    // Alias for isAdmin - dùng trong expense.js và các module khác
    function isAdminUser() {
        return isAdmin();
    }

    function getShopConfig() {
        return dbReady.then(function() {
            if (!isOnline) return Promise.resolve({});
            return _getDb().ref(CURRENT_SHOP_ID + '/info').once('value').then(function(snapshot) {
                return snapshot.val() || {};
            }).catch(function() {
                return {};
            });
        });
    }

    function getMemoryCache(collection) {
        if (memoryCache[collection]) {
            var arr = [];
            for (var key in memoryCache[collection]) {
                if (memoryCache[collection].hasOwnProperty(key)) {
                    arr.push(memoryCache[collection][key]);
                }
            }
            return arr.length > 0 ? arr : null;
        }
        return null;
    }

    // Export
    window.DB = {
        init: initDatabase,
        create: create,
        update: update,
        remove: remove,
        get: get,
        getAll: getAll,
        getTransactionsByDate: getTransactionsByDate,
        getTransactionsByDateRange: getTransactionsByDateRange,
        subscribe: subscribeToCollection,
        subscribeWithPolling: subscribeWithPolling,
        // NANG CAP: Event Bus API - Reactive Layer Giai doan 1
        on: function(eventType, callback) { return _on(eventType, callback); },
        off: function(eventType, callback) { _off(eventType, callback); },
        isOnline: function() { return isOnline; },
        getDeviceId: function() { return CURRENT_DEVICE_ID; },
        processSyncQueue: processSyncQueue,
        getSyncQueue: function() { return syncQueue; },
        // OPTIMIZE: Suppress realtime notifications cho batch operations
        suppressRealtime: function() { _setSuppressRealtime(true); },
        flushRealtime: function() { _setSuppressRealtime(false); },
        getMemoryCache: getMemoryCache,
        // Auth methods
        setShopId: setShopId,
        getShopId: getShopId,
        login: login,
        registerShop: registerShop,
        createStaff: createStaff,
        getStaffs: getStaffs,
        logout: logout,
        getCurrentUser: getCurrentUser,
        isLoggedIn: isLoggedIn,
        isAdmin: isAdmin,
        isAdminUser: isAdminUser,
        clearLocalData: clearLocalData,
        forceSyncFromFirebase: forceSyncFromFirebase,
        ensureCollection: ensureCollection,
        whenSyncComplete: whenSyncComplete,
        batchUpdateSortOrder: batchUpdateSortOrder,
        getShopConfig: getShopConfig,
        reconcileSnapshot: reconcileSnapshot,
        getDirtyCollections: function() { return Object.keys(_dirtyCollections); },
        renderOn: function(collection, selector, renderFn) {
            return _renderOn(collection, selector, renderFn);
        },
        ensureRecentDaysData: ensureRecentDaysData,
        // Multi-tenant support
        initWithCustomConfig: initWithCustomConfig,
        _getDb: _getDb,
        reinitializeSubscriptions: _reinitializeSubscriptions,
        // Hàm database gốc (cho master-config.js dùng để luôn truy cập default Firebase)
        _origFirebaseDatabase: _origFirebaseDatabase,
        // PHASE 4: Lazy listener management
        releaseListener: function(collection) { _releaseListener(collection); },
        getActiveListeners: function() {
            var result = {};
            for (var col in _activeListeners) {
                if (_activeListeners.hasOwnProperty(col)) {
                    result[col] = { refCount: _activeListeners[col].refCount };
                }
            }
            return result;
        }
    };

    // Global export cho các module cũ gọi isAdminUser() trực tiếp (expense.js, v.v.)
    window.isAdminUser = isAdminUser;
})();
