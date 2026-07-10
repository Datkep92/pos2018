// ========== db.js ES5 - Tương thích Android 6, iOS 16 ==========
(function() {
    // Polyfill CustomEvent
    if (typeof window.CustomEvent !== "function") {
        window.CustomEvent = function(event, params) {
            params = params || { bubbles: false, cancelable: false, detail: undefined };
            var evt = document.createEvent('CustomEvent');
            evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
            return evt;
        };
        window.CustomEvent.prototype = window.Event.prototype;
    }

    // ========== MASTER-SLAVE FIREBASE CONFIG ==========
    // Firebase Master (luôn tồn tại - project posmilano)
    var MASTER_CONFIG = {
        apiKey: "AIzaSyCQFIzj8m3kpsE_x354xxJ8MTAuRG9eCx4",
        authDomain: "posmilano.firebaseapp.com",
        projectId: "posmilano",
        databaseURL: "https://posmilano-default-rtdb.firebaseio.com",
        storageBucket: "posmilano.firebasestorage.app",
        messagingSenderId: "34185947554",
        appId: "1:34185947554:web:925f29864d3b17b8d46afb",
        measurementId: "G-J3MX8EL1C8"
    };
    // Khởi tạo DEFAULT app trước để tương thích với các file cũ (telegram.js, employees.js, ...)
    // vẫn gọi firebase.database(), firebase.auth() mà không có app name
    // Sau đó lấy reference đến masterApp (có thể là DEFAULT app nếu không tạo được app riêng)
    var masterApp, masterDb, auth;
    try {
        // Thử tạo DEFAULT app trước
        firebase.initializeApp(MASTER_CONFIG);
        masterApp = firebase.app(); // DEFAULT app
        masterDb = masterApp.database();
        auth = firebase.auth();
    } catch(e) {
        // Nếu DEFAULT app đã tồn tại (do script load lại), dùng nó luôn
        masterApp = firebase.app();
        masterDb = masterApp.database();
        auth = firebase.auth();
    }
    
    // Firebase Slave (chỉ tồn tại nếu POS có config riêng)
    var slaveApp = null;
    var slaveDb = null;
    var slaveConfig = null;
    
    // Biến db cũ giữ để tương thích ngược, trỏ về masterDb
    var db = masterDb;
    
    // Collection LUÔN ở Master (staff, registry, firebase_config)
    var MASTER_ONLY_COLLECTIONS = {
        staffs: true,
        shop_registry: true,
        firebase_config: true,
        master_admins: true
    };
    
    // Helper: trả về đúng DB instance dựa trên collection
    function _getDb(collection) {
        if (MASTER_ONLY_COLLECTIONS[collection]) return masterDb;
        return slaveDb || masterDb; // Fallback về Master nếu không có Slave
    }
    
    // Helper: khởi tạo/hủy Slave Firebase App
    function _initSlaveApp(shopId, fbConfig) {
        var appName = 'slave_' + shopId;
        
        // Xây dựng chuỗi Promise để đảm bảo thứ tự: xóa cũ -> tạo mới
        var chain = Promise.resolve();
        
        // Bước 1: Hủy Slave cũ nếu có (delete() là async)
        if (slaveApp) {
            chain = chain.then(function() {
                var _oldApp = slaveApp;
                slaveApp = null;
                slaveDb = null;
                slaveConfig = null;
                try {
                    return _oldApp.delete();
                } catch(e) {
                    return Promise.resolve();
                }
            });
        }
        
        // Bước 2: Kiểm tra và xóa app cũ cùng tên nếu còn
        chain = chain.then(function() {
            try {
                var existing = firebase.app(appName);
                if (existing) {
                    try { return existing.delete(); } catch(e) { return Promise.resolve(); }
                }
            } catch(e) {
                // App chưa tồn tại
            }
            return Promise.resolve();
        });
        
        // Bước 3: Khởi tạo Slave App mới
        chain = chain.then(function() {
            try {
                slaveApp = firebase.initializeApp(fbConfig, appName);
                slaveDb = slaveApp.database();
                slaveConfig = fbConfig;
            } catch(e) {
                console.error('[db.js] Lỗi khởi tạo Slave Firebase:', e);
                throw e;
            }
        });
        
        return chain;
    }
    
    // Helper: huỷ tất cả Firebase listeners
    function _destroyAllListeners() {
        for (var collection in listeners) {
            if (listeners.hasOwnProperty(collection)) {
                var ref = _getDb(collection).ref(CURRENT_SHOP_ID + '/' + collection);
                var colListeners = listeners[collection];
                for (var i = 0; i < colListeners.length; i++) {
                    var l = colListeners[i];
                    if (l.value) ref.off('value', l.value);
                    if (l.child_added) ref.off('child_added', l.child_added);
                    if (l.child_changed) ref.off('child_changed', l.child_changed);
                    if (l.child_removed) ref.off('child_removed', l.child_removed);
                }
            }
        }
        listeners = {};
    }
    
    // Config hash để phát hiện thay đổi Firebase config
    var CONFIG_HASH_KEY = 'pos_firebase_config_hash';
    function _getConfigHash(fbConfig) {
        if (!fbConfig) return 'master';
        return fbConfig.databaseURL || fbConfig.apiKey || 'custom';
    }

    // Helper: di chuyển dữ liệu từ Master DB sang Slave DB khi đổi Firebase config
    // Chỉ migrate các collection không phải MASTER_ONLY (staffs, shop_registry, firebase_config, master_admins)
        // Helper: di chuyển dữ liệu từ Master DB sang Slave DB khi đổi Firebase config
    // Chỉ migrate các collection không phải MASTER_ONLY (staffs, shop_registry, firebase_config, master_admins)
    function _migrateData(shopId, oldDb, newDb) {
        var collections = [];
        for (var c in MASTER_COLLECTIONS) {
            if (MASTER_COLLECTIONS.hasOwnProperty(c) && !MASTER_ONLY_COLLECTIONS[c]) {
                collections.push(c);
            }
        }
        for (var c in DATE_BASED_COLLECTIONS) {
            if (DATE_BASED_COLLECTIONS.hasOwnProperty(c)) {
                collections.push(c);
            }
        }
        // Thêm các collection đặc biệt
        collections.push('messages');
        collections.push('admin_cost_categories');
        collections.push('cost_transactions_admin');

        var migratedCount = 0;

        // OPTIMIZE: Chạy migration SONG SONG thay vì tuần tự
        // Mỗi collection độc lập, không phụ thuộc nhau
        var promises = collections.map(function(collection) {
            return oldDb.ref(shopId + '/' + collection).once('value').then(function(snapshot) {
                if (!snapshot.exists()) return;
                var data = snapshot.val();
                var updates = {};
                for (var key in data) {
                    if (data.hasOwnProperty(key)) {
                        updates[key] = data[key];
                    }
                }
                if (Object.keys(updates).length > 0) {
                    return newDb.ref(shopId + '/' + collection).update(updates).then(function() {
                        migratedCount++;
                        console.log('  📦 Migrated', collection, ':', Object.keys(updates).length, 'items');
                    });
                }
            }).catch(function(err) {
                console.warn('  ⚠️ Migration warning for', collection, ':', err.message);
            });
        });

        return Promise.all(promises).then(function() {
            console.log('✅ Migration completed:', migratedCount, 'collections migrated');
            return migratedCount;
        });
    }// Constants
    var STORE_NAME = 'pos_data';
    
    // Biáº¿n lÆ°u thÃ´ng tin user hiá»‡n táº¡i
    var currentUser = null;
    // Äá»c session tá»« localStorage náº¿u cÃ³
    var savedSession = localStorage.getItem('pos_session');
    if (savedSession) {
        try { currentUser = JSON.parse(savedSession); } catch(e) { localStorage.removeItem('pos_session'); }
    }
    
    // Äá»c shopId tá»« localStorage, máº·c Ä‘á»‹nh 'shop_default' náº¿u chÆ°a cÃ³
    // FIX: Náº¿u current_shop_id khÃ´ng cÃ³ trong localStorage (do xÃ³a browser DB)
    // nhÆ°ng pos_session váº«n cÃ²n, khÃ´i phá»¥c shopId tá»« session
    var CURRENT_SHOP_ID = localStorage.getItem('current_shop_id');
    if (!CURRENT_SHOP_ID) {
        if (currentUser && currentUser.shopId) {
            CURRENT_SHOP_ID = currentUser.shopId;
            localStorage.setItem('current_shop_id', CURRENT_SHOP_ID);
        } else {
            CURRENT_SHOP_ID = 'shop_default';
        }
    }
    // Biến lưu promise khởi tạo Slave Firebase (để tích hợp vào initDatabase)
    var _slaveInitPromise = null;
    // FIX: Khởi tạo lại Slave Firebase nếu user có hasCustomConfig === true
    // Khi F5/reload, session được restore từ localStorage nhưng slaveApp/slaveDb = null
    // Nếu không khởi tạo lại, _getDb() sẽ fallback về masterDb -> đọc nhầm dữ liệu POS mặc định
    if (currentUser && currentUser.hasCustomConfig && currentUser.shopId && currentUser.shopId !== 'master') {
        var _shopId = currentUser.shopId;
        // FIX: Äá»c firebaseConfig tá»« shop_registry (nÆ¡i Admin Master lÆ°u)
        // Fallback: Äá»c tá»« firebase_config/{shopId} cÅ© (tÆ°Æ¡ng thÃ­ch ngÆ°á»£c)
        _slaveInitPromise = masterDb.ref('shop_registry/' + currentUser.shopCode).once('value').then(function(registrySnap) {
            var registryData = registrySnap.val() || {};
            var fbConfig = registryData.firebaseConfig || null;
            
            // Fallback: Äá»c tá»« firebase_config cÅ©
            if (!fbConfig) {
                return masterDb.ref('firebase_config/' + _shopId).once('value').then(function(configSnapshot) {
                    return configSnapshot.val() || null;
                });
            }
            return fbConfig;
        }).then(function(fbConfig) {
            if (fbConfig) {
                console.log('[db.js] Khôi phục Slave Firebase cho', _shopId);
                return _initSlaveApp(_shopId, fbConfig).then(function() {
                    var newHash = _getConfigHash(fbConfig);
                    localStorage.setItem(CONFIG_HASH_KEY, newHash);
                    console.log('[db.js] ✅ Slave Firebase đã khôi phục:', fbConfig.databaseURL);
                });
            } else {
                console.warn('[db.js] ⚠️ User có hasCustomConfig=true nhưng không tìm thấy firebaseConfig cho', _shopId);
                // Fallback: xóa flag để lần sau không thử lại
                currentUser.hasCustomConfig = false;
                localStorage.setItem('pos_session', JSON.stringify(currentUser));
            }
        }).catch(function(err) {
            console.error('[db.js] ❌ Lỗi khôi phục Slave Firebase:', err);
        });
    }
    
    var CURRENT_DEVICE_ID = localStorage.getItem('device_id') || ('device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    localStorage.setItem('device_id', CURRENT_DEVICE_ID);

    var localDB = null;
    var dbReady = null;
    var syncQueue = [];
    var isOnline = navigator.onLine;
    var listeners = {};
    
    // ========== SYNC META ==========
    // sync_meta lưu trong IndexedDB để biết trạng thái đồng bộ của từng collection
    // Cấu trúc: { collection: 'transactions', lastSyncAt: timestamp, maxVersion: 42, dateKeys: ['2026-06-01','2026-06-02',...] }
    var SYNC_META_STORE = 'sync_meta';
    var syncMetaCache = {}; // memory cache cho sync_meta
    
    // Hằng số: 30 ngày tính bằng milliseconds
    var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    
    // Danh sách collection có dateKey (cần giới hạn 30 ngày khi fullSync)
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
    
    // Danh sách collection master (tải toàn bộ khi fullSync)
    var MASTER_COLLECTIONS = {
        tables: true,
        customers: true,
        menu: true,
        menu_categories: true,
        ingredients: true,
        staffs: true,
        cost_categories: true,
        info: true
    };
    
    // OPTIMIZE: Debounce processSyncQueue - trÃ¡nh gá»i sync sau má»—i DB.update riÃªng láº»
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
    
    // OPTIMIZE: Memory cache layer - trÃ¡nh Ä‘á»c IndexedDB liÃªn tá»¥c
    var memoryCache = {};
    var cacheVersion = {};
    
    // FIX: Local callbacks - notify UI ngay sau khi ghi local, khÃ´ng chá» Firebase
    var _localCallbacks = {};
    
    // NÃ‚NG Cáº¤P: Event Bus - Reactive Layer Giai Ä‘oáº¡n 1
    // Cho phÃ©p UI subscribe vÃ o cÃ¡c sá»± kiá»‡n cá»¥ thá»ƒ thay vÃ¬ nháº­n toÃ n bá»™ collection
    // Event types: 'collection:added', 'collection:changed', 'collection:removed'
    // VÃ­ dá»¥: 'tables:added', 'tables:changed', 'tables:removed'
    var _eventBus = {};
    
    // ÄÄƒng kÃ½ listener cho má»™t event type
    function _on(eventType, callback) {
        if (!_eventBus[eventType]) _eventBus[eventType] = [];
        _eventBus[eventType].push(callback);
        return function() {
            _off(eventType, callback);
        };
    }
    
    // Há»§y Ä‘Äƒng kÃ½ listener
    function _off(eventType, callback) {
        var cbs = _eventBus[eventType];
        if (!cbs) return;
        for (var i = cbs.length - 1; i >= 0; i--) {
            if (cbs[i] === callback) {
                cbs.splice(i, 1);
            }
        }
    }
    
    // PhÃ¡t sá»± kiá»‡n - gá»i táº¥t cáº£ listeners Ä‘Ã£ Ä‘Äƒng kÃ½
    function _emit(eventType, data) {
        var cbs = _eventBus[eventType];
        if (cbs) {
            for (var i = 0; i < cbs.length; i++) {
                try { cbs[i](data); } catch(e) { console.error('[EventBus] Lá»—i handler ' + eventType + ':', e); }
            }
        }
        // Wildcard listener: 'collection:*' nháº­n táº¥t cáº£ events cá»§a collection Ä‘Ã³
        var parts = eventType.split(':');
        if (parts.length === 2) {
            var wildcard = parts[0] + ':*';
            var wildcardCbs = _eventBus[wildcard];
            if (wildcardCbs) {
                for (var i = 0; i < wildcardCbs.length; i++) {
                    try { wildcardCbs[i]({ type: parts[1], collection: parts[0], data: data }); } catch(e) { console.error('[EventBus] Lá»—i wildcard handler ' + wildcard + ':', e); }
                }
            }
        }
    }
    
    // OPTIMIZE: CÆ¡ cháº¿ suppress realtime notifications khi batch operations
    // Khi _suppressRealtime > 0, _notifyLocal sáº½ khÃ´ng gá»i callbacks
    // DÃ¹ng cho thanh toÃ¡n, nháº­p hÃ ng loáº¡t, etc.
    // NÂNG CẤP: Component Registry + Fine Render API (Giai đoạn 3)
    // Cho phép UI components đăng ký với 1 collection + 1 selector function
    // Chỉ re-render khi dữ liệu thay đổi, tránh re-render toàn bộ
    var _componentRegistry = {};  // { collection: [ { id, selector, renderFn, lastData } ] }
    var _componentIdCounter = 0;

    // Đăng ký 1 component: renderFn(data) sẽ được gọi khi collection thay đổi
    // selector nhận (oldData, newData) và trả về true nếu cần re-render
    // selector có thể là:
    //   - function(oldData, newData): return true nếu cần render lại
    //   - null/undefined: luôn render lại khi có change event
    // Trả về hàm unsubscribe
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
        // Gọi render ngay lập tức với dữ liệu hiện tại
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
        // Trả về hàm hủy đăng ký
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

    // Thông báo cho tất cả components của 1 collection
    function _notifyComponents(collection, changeInfo) {
        var entries = _componentRegistry[collection];
        if (!entries || entries.length === 0) return;
        var newData = null;
        if (memoryCache[collection]) {
            newData = [];
            for (var key in memoryCache[collection]) {
                if (memoryCache[collection].hasOwnProperty(key)) {
                    newData.push(memoryCache[collection][key]);
                }
            }
        }
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var shouldRender = true;
            if (entry.selector) {
                try {
                    shouldRender = entry.selector(entry.lastData, newData, changeInfo);
                } catch(e) {
                    console.error('[ComponentRegistry] Lỗi selector:', e);
                    shouldRender = true;
                }
            }
            if (shouldRender) {
                entry.lastData = newData;
                try { entry.renderFn(newData, changeInfo); } catch(e) {
                    console.error('[ComponentRegistry] Lỗi render:', e);
                }
            }
        }
    }

    var _suppressRealtime = 0;
    var _pendingNotifyCollections = {};

    // Helper: toDateKey - dÃ¹ng giá» Ä‘á»‹a phÆ°Æ¡ng (getFullYear/getMonth/getDate) thay vÃ¬ UTC
    function toDateKey(value) {
        if (!value) return '';
        if (typeof value === 'string') {
            // FIX TIMEZONE: Náº¿u lÃ  ISO string (cÃ³ 'T', 'Z', hoáº·c timezone +/-), pháº£i parse Ä‘á»ƒ láº¥y local date
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
            // Náº¿u Ä‘Ã£ lÃ  Ä‘á»‹nh dáº¡ng YYYY-MM-DD (10 kÃ½ tá»±), dÃ¹ng trá»±c tiáº¿p
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

    // FIX: Notify local subscribers ngay láº­p tá»©c tá»« memoryCache
    // OPTIMIZE: Callback nháº­n full data array (tÆ°Æ¡ng thÃ­ch ngÆ°á»£c)
    // NgoÃ i ra, changeInfo Ä‘Æ°á»£c lÆ°u vÃ o _lastChangeInfo Ä‘á»ƒ UI cÃ³ thá»ƒ dÃ¹ng náº¿u cáº§n
    var _lastChangeInfo = {};
    function _notifyLocal(collection, changeInfo) {
        // OPTIMIZE: Náº¿u Ä‘ang suppress, ghi nháº­n collection cáº§n notify sau
        if (_suppressRealtime > 0) {
            _pendingNotifyCollections[collection] = true;
            return;
        }
        // NÃ‚NG Cáº¤P: PhÃ¡t sá»± kiá»‡n Event Bus trÆ°á»›c, sau Ä‘Ã³ má»›i gá»i callbacks cÅ©
        // Äáº£m báº£o UI nháº­n Ä‘Æ°á»£c changeInfo chi tiáº¿t
        if (changeInfo && changeInfo.type) {
            var eventType = collection + ':' + changeInfo.type;
            _emit(eventType, {
                collection: collection,
                type: changeInfo.type,
                item: changeInfo.item || null,
                timestamp: Date.now()
            });
        }
        
        // NÂNG CẤP: Thông báo cho Component Registry (Giai đoạn 3)
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
        // LÆ°u changeInfo Ä‘á»ƒ UI cÃ³ thá»ƒ tra cá»©u sau (tÆ°Æ¡ng thÃ­ch ngÆ°á»£c)
        if (changeInfo) {
            _lastChangeInfo[collection] = changeInfo;
        }
        // Gá»i callback vá»›i full data array (giá»¯ nguyÃªn tÆ°Æ¡ng thÃ­ch ngÆ°á»£c)
        for (var i = 0; i < cbs.length; i++) {
            try { cbs[i](data); } catch(e) { console.error('Local callback error:', e); }
        }
    }
    
    // OPTIMIZE: Báº­t/táº¯t suppress realtime notifications
    // DÃ¹ng cho batch operations (thanh toÃ¡n, nháº­p hÃ ng loáº¡t)
    function _setSuppressRealtime(suppress) {
        if (suppress) {
            _suppressRealtime++;
        } else {
            _suppressRealtime--;
            if (_suppressRealtime <= 0) {
                _suppressRealtime = 0;
                // Flush táº¥t cáº£ cÃ¡c collection Ä‘ang pending
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
        // FIX: dbReady có thể là null nếu gọi trước khi initLocalDB()
        var ready = dbReady || Promise.resolve();
        return ready.then(function() {
            if (!localDB) throw new Error('DB not ready');
            if (!localDB.objectStoreNames.contains(collection)) throw new Error('Store ' + collection + ' not found');
            // Cáº­p nháº­t memory cache ngay láº­p tá»©c (dÃ¹ng normalized data Ä‘á»ƒ cÃ³ dateKey, dateTypeKey)
            if (!memoryCache[collection]) memoryCache[collection] = {};
            var isNew = !memoryCache[collection][data.id];
            memoryCache[collection][data.id] = normalizeIndexedFields(collection, data);
            cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
            // FIX: Notify local subscribers ngay, khÃ´ng chá» Firebase
            // OPTIMIZE: Truyá»n thÃ´ng tin item thay Ä‘á»•i Ä‘á»ƒ UI khÃ´ng cáº§n xá»­ lÃ½ toÃ n bá»™
            var type = changeType || (isNew ? 'added' : 'changed');
            _notifyLocal(collection, { type: type, item: data, collection: collection });
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([collection], 'readwrite');
                var store = tx.objectStore(collection);
                var req = store.put(normalizeIndexedFields(collection, data));
                req.onsuccess = function() { resolve(data); };
                req.onerror = function() { reject(req.error); };
            });
        });
    }

    function loadFromLocal(collection, id) {
        // FIX: dbReady có thể là null nếu gọi trước khi initLocalDB()
        var ready = dbReady || Promise.resolve();
        return ready.then(function() {
            if (!localDB) return id !== undefined ? null : [];
            if (!localDB.objectStoreNames.contains(collection)) return id !== undefined ? null : [];
            
            // OPTIMIZE: Memory cache - trÃ¡nh Ä‘á»c IndexedDB liÃªn tá»¥c
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
                            memoryCache[collection][result.id] = result;
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
                            memoryCache[collection][results[i].id] = results[i];
                        }
                        resolve(results);
                    };
                    req.onerror = function() { reject(req.error); };
                }
            });
        });
    }

    function deleteFromLocal(collection, id) {
        // FIX: dbReady có thể là null nếu gọi trước khi initLocalDB()
        var ready = dbReady || Promise.resolve();
        return ready.then(function() {
            if (!localDB) return;
            if (!localDB.objectStoreNames.contains(collection)) return;
            // XÃ³a khá»i memory cache ngay
            if (memoryCache[collection]) {
                delete memoryCache[collection][id];
                cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
            }
            // FIX: Notify local subscribers ngay, khÃ´ng chá» Firebase
            // OPTIMIZE: Truyá»n thÃ´ng tin item bá»‹ xÃ³a
            _notifyLocal(collection, { type: 'removed', item: { id: id }, collection: collection });
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([collection], 'readwrite');
                var store = tx.objectStore(collection);
                var req = store.delete(String(id));
                req.onsuccess = function() { resolve(); };
                req.onerror = function() { reject(req.error); };
            });
        });
    }

    // Sync Queue (simplified)
    function addToSyncQueue(action, collection, data, targetId) {
        var existing = syncQueue.filter(function(q) { return q.targetId === targetId && q.action === action && q.status === 'pending'; })[0];
        if (existing) return existing.id;
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
            dirtyAt: Date.now() // Thời điểm đánh dấu dirty
        };
        syncQueue.push(item);
        saveToLocal('sync_queue', item);
        // Đánh dấu dirty flag cho collection để biết có dữ liệu chưa sync
        _markDirty(collection);
        if (isOnline) processSyncQueue();
        return item.id;
    }
    
    // DIRTY FLAG: Đánh dấu collection có dữ liệu chưa được đồng bộ lên Firebase
    // Dùng để ưu tiên sync các collection có dirty flag khi online trở lại
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
    // Khôi phục dirty flags từ localStorage khi khởi động
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

    function processSyncQueue() {
        if (!isOnline) return Promise.resolve();
        var pending = syncQueue.filter(function(q) { return q.status === 'pending'; });
        if (pending.length === 0) return Promise.resolve();
        
        // OPTIMIZE: Batch cÃ¡c items cÃ¹ng collection thÃ nh 1 Firebase update
        // Gom cÃ¡c pending items theo collection Ä‘á»ƒ batch
        var batches = {};
        for (var i = 0; i < pending.length; i++) {
            var item = pending[i];
            var key = item.collection + '|' + item.action;
            if (!batches[key]) batches[key] = [];
            batches[key].push(item);
        }
        
        var chain = Promise.resolve();
        var batchKeys = Object.keys(batches);
        
        for (var b = 0; b < batchKeys.length; b++) {
            chain = chain.then((function(batchItems) {
                return function() {
                    if (batchItems.length === 1) {
                        // Chá»‰ 1 item - sync bÃ¬nh thÆ°á»ng
                        var item = batchItems[0];
                        return syncToFirebase(item).then(function() {
                            return _markItemSynced(item);
                        }).catch(function(err) {
                            return _handleSyncError(item, err);
                        });
                    } else {
                        // Nhiá»u items cÃ¹ng collection - batch thÃ nh 1 Firebase update
                        return _batchSyncToFirebase(batchItems).then(function() {
                            var chain2 = Promise.resolve();
                            for (var j = 0; j < batchItems.length; j++) {
                                chain2 = chain2.then((function(item) {
                                    return function() { return _markItemSynced(item); };
                                })(batchItems[j]));
                            }
                            return chain2;
                        }).catch(function(err) {
                            // Fallback: sync tá»«ng cÃ¡i náº¿u batch fail
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
    
    // OPTIMIZE: Batch sync nhiá»u items cÃ¹ng collection lÃªn Firebase trong 1 láº§n
    // DÃ¹ng _getDb Ä‘á»ƒ chá»n Master/Slave tÃ¹y theo collection
    function _batchSyncToFirebase(items) {
        if (items.length === 0) return Promise.resolve();
        var collection = items[0].collection;
        var action = items[0].action;
        var ref = _getDb(collection).ref(CURRENT_SHOP_ID + '/' + collection);
        var batchData = {};
        for (var i = 0; i < items.length; i++) {
            var item = items[i];
            var syncData = {};
            for (var k in item.data) if (item.data.hasOwnProperty(k)) syncData[k] = item.data[k];
            syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
            syncData._syncedBy = item.deviceId;
            syncData._version = (item.data._version || 1);
            if (action === 'delete') {
                batchData[item.targetId] = null;
            } else {
                batchData[item.targetId] = syncData;
            }
        }
        return ref.update(batchData);
    }
    
    function _markItemSynced(item) {
        item.status = 'synced';
        return saveToLocal('sync_queue', item).then(function() {
            return deleteFromLocal('sync_queue', item.id);
        }).then(function() {
            var idx = syncQueue.findIndex(function(q) { return q.id === item.id; });
            if (idx !== -1) syncQueue.splice(idx, 1);
            console.log('âœ… Synced:', item.action, item.collection, item.targetId);
            // Kiểm tra nếu không còn pending items cho collection này thì clear dirty flag
            var hasPending = syncQueue.some(function(q) { return q.collection === item.collection && q.status === 'pending'; });
            if (!hasPending) {
                _clearDirty(item.collection);
            }
        });
    }
    
    // FIX: Retry limit + exponential backoff + lưu retryCount vào IndexedDB
    function _handleSyncError(item, err) {
        item.retryCount = (item.retryCount || 0) + 1;
        item.lastError = err.message || String(err);
        var MAX_RETRY = 5;
        if (item.retryCount < MAX_RETRY) {
            item.status = 'pending';
            // Lưu retryCount + lastError vào IndexedDB để không bị mất khi reload
            return saveToLocal('sync_queue', item).then(function() {
                var delay = Math.min(2000 * Math.pow(2, item.retryCount - 1), 30000); // exponential backoff, max 30s
                console.warn('  âš ï¸� Retry', item.retryCount, 'for', item.collection, item.targetId, 'in', delay + 'ms');
                return new Promise(function(r) { setTimeout(r, delay); });
            }).then(function() {
                // Gọi lại processSyncQueue thay vì syncToFirebase trực tiếp
                // để tận dụng batch mechanism
                return processSyncQueue();
            });
        } else {
            item.status = 'failed';
            console.error('â�Œ Sync failed after ' + MAX_RETRY + ' retries:', item.action, item.collection, item.targetId, 'Error:', item.lastError);
            return saveToLocal('sync_queue', item);
        }
    }

    function syncToFirebase(item) {
        var ref = _getDb(item.collection).ref(CURRENT_SHOP_ID + '/' + item.collection + '/' + item.targetId);
        var syncData = {};
        for (var k in item.data) if (item.data.hasOwnProperty(k)) syncData[k] = item.data[k];
        syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
        syncData._syncedBy = item.deviceId;
        syncData._version = (item.data._version || 1);
        if (item.action === 'create' || item.action === 'update') return ref.update(syncData);
        if (item.action === 'delete') return ref.remove();
        return Promise.resolve();
    }

    // CRUD Public
    function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }

    // FIX: Táº¡o idempotency key cho transaction Ä‘á»ƒ chá»‘ng trÃ¹ng khi Ä‘á»“ng bá»™ offline
    // Káº¿t há»£p: deviceId + timestamp (giÃ¢y) + tableId + amount
    function _generateIdempotencyKey(collection, data) {
        if (collection !== 'transactions') return null;
        // DÃ¹ng tableId + amount + paymentMethod + timestamp (Ä‘á»™ phÃ¢n giáº£i giÃ¢y)
        var ts = Math.floor(Date.now() / 1000);
        var tableKey = data.tableId || data.tableName || 'unknown';
        var amt = Math.round(data.amount || 0);
        var method = data.paymentMethod || 'unknown';
        return CURRENT_DEVICE_ID + '|' + ts + '|' + tableKey + '|' + amt + '|' + method;
    }

    // FIX: Kiá»ƒm tra transaction trÃ¹ng trong memory cache trÆ°á»›c khi táº¡o
    function _isDuplicateTransaction(data) {
        if (!data.tableId && !data.tableName) {
            return false;
        }
        var tableKey = data.tableId || data.tableName;
        var amt = Math.round(data.amount || 0);
        var method = data.paymentMethod || '';
        var txCache = memoryCache.transactions;
        if (!txCache) {
            return false;
        }
        for (var key in txCache) {
            if (!txCache.hasOwnProperty(key)) continue;
            var tx = txCache[key];
            if (tx.refunded) continue;
            var txTableKey = tx.tableId || tx.tableName;
            if (txTableKey === tableKey && Math.round(tx.amount || 0) === amt && tx.paymentMethod === method) {
                // Kiá»ƒm tra thá»i gian - náº¿u trong vÃ²ng 30 giÃ¢y thÃ¬ coi lÃ  trÃ¹ng
                var txTime = tx.createdAt || 0;
                var dataTime = data.createdAt || Date.now();
                if (Math.abs(txTime - dataTime) < 30000) {
                    return true;
                }
            }
        }
        return false;
    }

    function create(collection, data, customId) {
        // FIX: Chá»‘ng trÃ¹ng transaction - kiá»ƒm tra trÆ°á»›c khi táº¡o
        if (collection === 'transactions' && _isDuplicateTransaction(data)) {
            console.warn('âš ï¸ Duplicate transaction detected, skipping:', data.tableName, data.amount);
            return Promise.resolve(null);
        }
        var id = customId || data.id || generateId();
        var newData = { id: id };
        for (var k in data) if (data.hasOwnProperty(k) && k !== 'id') newData[k] = data[k];
        newData.createdAt = Date.now();
        newData.createdBy = CURRENT_DEVICE_ID;
        newData.updatedAt = Date.now();
        newData._version = 1;
        // FIX: LÆ°u idempotency key Ä‘á»ƒ kiá»ƒm tra khi nháº­n Firebase event
        if (collection === 'transactions') {
            newData._idempotencyKey = _generateIdempotencyKey(collection, data);
        }
        return saveToLocal(collection, newData).then(function() {
            addToSyncQueue('create', collection, newData, id);
            // OPTIMIZE: Debounce sync - gom nhiá»u operations vÃ o 1 láº§n sync
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
                // OPTIMIZE: Debounce sync - gom nhiá»u operations vÃ o 1 láº§n sync
                if (isOnline) _debouncedProcessSyncQueue();
                return Promise.resolve();
            }).then(function() { return updated; });
        });
    }

    // Batch update sortOrder - ghi vÃ o IndexedDB + Firebase 1 láº§n duy nháº¥t, ko qua sync queue
    // @param {string} collection - TÃªn collection ('menu' hoáº·c 'menu_categories'), máº·c Ä‘á»‹nh 'menu'
    function batchUpdateSortOrder(items, collection) {
        collection = collection || 'menu';
        return dbReady.then(function() {
            if (!localDB) throw new Error('DB not ready');
            var tx = localDB.transaction([collection], 'readwrite');
            var store = tx.objectStore(collection);
            var now = Date.now();
            
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                // Cáº­p nháº­t memory cache - CHá»ˆ sá»­a sortOrder, giá»¯ nguyÃªn cÃ¡c field khÃ¡c
                if (!memoryCache[collection]) memoryCache[collection] = {};
                if (memoryCache[collection][item.id]) {
                    memoryCache[collection][item.id].sortOrder = item.sortOrder;
                }
                // Ghi vÃ o IndexedDB - CHá»ˆ cáº­p nháº­t sortOrder, ko ghi Ä‘Ã¨ toÃ n bá»™
                // DÃ¹ng store.put vá»›i toÃ n bá»™ data cÅ© + sortOrder má»›i
                var fullData = memoryCache[collection][item.id];
                if (fullData) {
                    fullData.sortOrder = item.sortOrder;
                    fullData.updatedAt = now;
                    store.put(normalizeIndexedFields(collection, fullData));
                }
            }
            
            return new Promise(function(resolve, reject) {
                tx.oncomplete = function() {
                    // Sync 1 batch lÃªn Firebase - CHá»ˆ ghi Ä‘Ãºng field sortOrder, ko táº¡o node láº¡
                    if (isOnline && CURRENT_SHOP_ID) {
                        var updates = {};
                        var firebasePath = (collection === 'menu_categories') ? 'menu_categories' : 'menu';
                        for (var i = 0; i < items.length; i++) {
                            var key = CURRENT_SHOP_ID + '/' + firebasePath + '/' + items[i].id + '/sortOrder';
                            updates[key] = items[i].sortOrder;
                        }
                        masterDb.ref().update(updates).catch(function(err) {
                            console.error('Lá»—i batch sync sortOrder cho ' + collection + ':', err);
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
            // OPTIMIZE: Debounce sync - gom nhiá»u operations vÃ o 1 láº§n sync
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

    // FIX: Tá»± Ä‘á»™ng sá»­a dateKey cho dá»¯ liá»‡u cÅ© bá»‹ sai do UTC vs Local time (+7)
    // Kiá»ƒm tra náº¿u dateKey khÃ´ng khá»›p vá»›i createdAt (tÃ­nh theo local time), thÃ¬ cáº­p nháº­t láº¡i
    function _fixDateKeyIfNeeded(tx) {
        if (!tx || !tx.id) return tx;
        var correctKey = toDateKey(tx.createdAt || tx.date || tx.updatedAt);
        if (correctKey && tx.dateKey !== correctKey) {
            
            tx.dateKey = correctKey;
            tx.dateTypeKey = correctKey + '|' + (tx.type || 'unknown');
            // Cáº­p nháº­t trong memoryCache vÃ  IndexedDB
            if (memoryCache.transactions) {
                memoryCache.transactions[tx.id] = tx;
            }
            // Ghi Ä‘Ã¨ vÃ o IndexedDB (fire & forget)
            if (localDB) {
                try {
                    var writeTx = localDB.transaction(['transactions'], 'readwrite');
                    var store = writeTx.objectStore('transactions');
                    store.put(tx);
                } catch(e) {
                    console.warn('KhÃ´ng thá»ƒ ghi fix dateKey vÃ o IndexedDB:', e.message);
                }
            }
        }
        return tx;
    }

    function getTransactionsByDate(dateKey, options) {
        options = options || {};
        var type = options.type || 'all';
        return dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains('transactions')) return [];
            
            // Bước 1: Đọc từ local (memory cache hoặc IndexedDB)
            var localPromise;
            if (memoryCache.transactions) {
                var allTx = [];
                for (var key in memoryCache.transactions) {
                    if (memoryCache.transactions.hasOwnProperty(key)) {
                        allTx.push(memoryCache.transactions[key]);
                    }
                }
                for (var i = 0; i < allTx.length; i++) {
                    _fixDateKeyIfNeeded(allTx[i]);
                }
                var filtered = allTx.filter(function(t) { return t.dateKey === dateKey; });
                if (type !== 'all') filtered = filtered.filter(function(t) { return t.type === type; });
                localPromise = Promise.resolve(filtered);
            } else {
                localPromise = new Promise(function(resolve, reject) {
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
                            memoryCache.transactions[rows[i].id] = rows[i];
                        }
                        resolve(rows);
                    };
                    req.onerror = function() { reject(req.error); };
                });
            }
            
            // Bước 2: Nếu local không có dữ liệu cho ngày này, auto-fetch từ Firebase
            return localPromise.then(function(localData) {
                if (localData && localData.length > 0) {
                    return localData; // Đã có local, trả về ngay
                }
                
                // Không có local data → fetch từ Firebase
                if (!isOnline) return [];
                
                console.log('📡 Auto-fetching transactions for date:', dateKey);
                return syncCollectionByDate('transactions', dateKey).then(function(fetched) {
                    if (type !== 'all' && fetched) {
                        fetched = fetched.filter(function(t) { return t.type === type; });
                    }
                    return fetched || [];
                });
            });
        });
    }

    // Deduplication cho getTransactionsByDateRange: tránh fetch cùng range nhiều lần
    var _fetchingRange = null;
    
    function getTransactionsByDateRange(startDateKey, endDateKey, options) {
        options = options || {};
        var type = options.type || 'all';
        
        // Nếu đang fetch range khác, đợi nó xong rồi thử lại (dùng sync_meta để biết đã có data chưa)
        if (_fetchingRange) {
            return _fetchingRange.then(function() {
                // Sau khi range trước xong, thử lại (lần này sẽ ít missing hơn hoặc hết)
                return _doGetTransactionsByDateRange(startDateKey, endDateKey, type);
            });
        }
        
        var promise = _doGetTransactionsByDateRange(startDateKey, endDateKey, type);
        _fetchingRange = promise;
        return promise.then(function(result) {
            _fetchingRange = null;
            return result;
        }).catch(function(err) {
            _fetchingRange = null;
            throw err;
        });
    }
    
    function _doGetTransactionsByDateRange(startDateKey, endDateKey, type) {
        return dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains('transactions')) return [];
            
            // Bước 1: Đọc từ local (memory cache hoặc IndexedDB)
            var localPromise;
            if (memoryCache.transactions) {
                var allTx = [];
                for (var key in memoryCache.transactions) {
                    if (memoryCache.transactions.hasOwnProperty(key)) {
                        allTx.push(memoryCache.transactions[key]);
                    }
                }
                for (var i = 0; i < allTx.length; i++) {
                    _fixDateKeyIfNeeded(allTx[i]);
                }
                var filtered = allTx.filter(function(t) {
                    return t.dateKey >= startDateKey && t.dateKey <= endDateKey;
                });
                if (type !== 'all') filtered = filtered.filter(function(t) { return t.type === type; });
                localPromise = Promise.resolve(filtered);
            } else {
                localPromise = new Promise(function(resolve, reject) {
                    var tx = localDB.transaction(['transactions'], 'readonly');
                    var store = tx.objectStore('transactions');
                    var req;
                    if (store.indexNames.contains('dateKey')) {
                        req = store.index('dateKey').getAll();
                    } else {
                        req = store.getAll();
                    }
                    req.onsuccess = function() {
                        var rows = req.result || [];
                        for (var i = 0; i < rows.length; i++) {
                            _fixDateKeyIfNeeded(rows[i]);
                        }
                        var filtered = rows.filter(function(r) {
                            var dk = toDateKey(r.date);
                            return dk >= startDateKey && dk <= endDateKey;
                        });
                        if (type !== 'all') filtered = filtered.filter(function(r) { return r.type === type; });
                        if (!memoryCache.transactions) memoryCache.transactions = {};
                        for (var i = 0; i < rows.length; i++) {
                            memoryCache.transactions[rows[i].id] = rows[i];
                        }
                        resolve(filtered);
                    };
                    req.onerror = function() { reject(req.error); };
                });
            }
            
            // Bước 2: Kiểm tra ngày nào còn thiếu, fetch từ Firebase
            // Dùng sync_meta.dateKeys để biết ngày nào đã được fetch (kể cả ko có data)
            return localPromise.then(function(localData) {
                // Thu thập dateKeys đã có trong local data
                var localDateKeys = {};
                for (var i = 0; i < localData.length; i++) {
                    if (localData[i].dateKey) {
                        localDateKeys[localData[i].dateKey] = true;
                    }
                }
                
                // Kiểm tra sync_meta để biết ngày nào đã fetch rồi (dù ko có giao dịch)
                return getSyncMeta('transactions').then(function(meta) {
                    var fetchedDateKeys = (meta && meta.dateKeys) || [];
                    for (var i = 0; i < fetchedDateKeys.length; i++) {
                        localDateKeys[fetchedDateKeys[i]] = true;
                    }
                    
                    // Tìm ngày thiếu trong khoảng
                    var allDateKeys = getDateKeysBetween(startDateKey, endDateKey);
                    var missingDateKeys = [];
                    for (var i = 0; i < allDateKeys.length; i++) {
                        if (!localDateKeys[allDateKeys[i]]) {
                            missingDateKeys.push(allDateKeys[i]);
                        }
                    }
                    
                    if (missingDateKeys.length === 0 || !isOnline) {
                        return localData; // Đã có đủ dữ liệu
                    }
                    
                    // Fetch từng ngày thiếu từ Firebase
                    console.log('📡 Auto-fetching missing dates:', missingDateKeys.length, 'days');
                    
                    var chain = Promise.resolve();
                    for (var i = 0; i < missingDateKeys.length; i++) {
                        chain = chain.then((function(dateKey) {
                            return function() {
                                return syncCollectionByDate('transactions', dateKey);
                            };
                        })(missingDateKeys[i]));
                    }
                    
                    return chain.then(function() {
                        // Đọc lại từ local sau khi đã fetch
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
        });
    }

   function subscribeToCollection(collection, callback, options) {
    // FIX: ÄÄƒng kÃ½ local callback Ä‘á»ƒ UI nháº­n notify ngay sau ghi local
    if (callback) {
        if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
        _localCallbacks[collection].push(callback);
    }
    
    // OPTIMIZE: Há»— trá»£ query options (limitToLast, orderByChild) Ä‘á»ƒ giáº£m dung lÆ°á»£ng download
    // VÃ­ dá»¥: { limitToLast: 200, orderByChild: 'createdAt' } chá»‰ láº¥y 200 item má»›i nháº¥t
    // DÃ¹ng _getDb Ä‘á»ƒ chá»n Master/Slave tÃ¹y theo collection
    var ref = _getDb(collection).ref(CURRENT_SHOP_ID + '/' + collection);
    if (options && options.orderByChild) {
        var queryRef = ref.orderByChild(options.orderByChild);
        if (options.limitToLast) {
            queryRef = queryRef.limitToLast(options.limitToLast);
        }
        ref = queryRef;
    } else if (options && options.limitToLast) {
        ref = ref.limitToLast(options.limitToLast);
    }
    
    // FIX: Collection 'info' lÃ  special - chá»‰ cÃ³ 1 item config duy nháº¥t (shop_config)
    // DÃ¹ng on('value') thay vÃ¬ child_* Ä‘á»ƒ nháº­n toÃ n bá»™ object, trÃ¡nh bá»‹ tÃ¡ch thÃ nh nhiá»u item riÃªng láº»
    if (collection === 'info') {
        var updateScheduledInfo = false;
        var emitUpdateInfo = function() {
            if (updateScheduledInfo) return;
            updateScheduledInfo = true;
            setTimeout(function() {
                updateScheduledInfo = false;
                loadFromLocal(collection).then(function(localData) {
                    if (callback) callback(localData);
                    var evt = document.createEvent('CustomEvent');
                    evt.initCustomEvent('db_update', true, true, { detail: { collection: collection, data: localData } });
                    window.dispatchEvent(evt);
                });
            }, 200);
        };
        var onValue = function(snapshot) {
            if (!snapshot.exists()) return;
            var src = snapshot.val() || {};
            // Gá»™p toÃ n bá»™ object thÃ nh 1 item vá»›i id='shop_config'
            var item = { id: 'shop_config' };
            for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
            saveToLocal(collection, item).then(emitUpdateInfo);
        };
        ref.on('value', onValue);
        if (!listeners[collection]) listeners[collection] = [];
        listeners[collection].push({ value: onValue });
        return function() {
            ref.off('value', onValue);
        };
    }
    
    // P0: Táº¥t cáº£ collections Ä‘á»u dÃ¹ng child_* events thay vÃ¬ on('value')
    // transactions/reports Ä‘Ã£ dÃ¹ng child_* tá»« trÆ°á»›c, giá» má»Ÿ rá»™ng cho táº¥t cáº£
    var updateScheduled = false;
    var emitUpdate = function() {
        if (updateScheduled) return;
        updateScheduled = true;
        setTimeout(function() {
            updateScheduled = false;
            loadFromLocal(collection).then(function(localData) {
                // FIX: Firebase callback - gá»i sau local callback, trÃ¡nh trÃ¹ng
                if (callback) callback(localData);
                var evt = document.createEvent('CustomEvent');
                evt.initCustomEvent('db_update', true, true, { detail: { collection: collection, data: localData } });
                window.dispatchEvent(evt);
            });
        }, 200);
    };
    var onAdded = function(snapshot) {
        if (!snapshot.exists()) return;
        var key = snapshot.key;
        var src = snapshot.val() || {};
        var item = { id: key };
        for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
        
        // FIX: Chỉ skip _version check cho transactions (chống trùng khi offline sync)
        // KHÔNG skip cho tables, customers, menu v.v. vì có thể bàn bị xóa rồi tạo lại
        if (collection !== 'tables') {
            var localItem = memoryCache[collection] ? memoryCache[collection][key] : null;
            if (localItem && (localItem._version || 0) >= (item._version || 0)) {
                return;
            }
        }
        
        // FIX: Chá»‘ng trÃ¹ng transaction tá»« Firebase realtime
        // Náº¿u transaction nÃ y Ä‘Ã£ tá»“n táº¡i trong local (do chÃ­nh mÃ¡y nÃ y táº¡o khi offline),
        // thÃ¬ khÃ´ng ghi Ä‘Ã¨ - giá»¯ nguyÃªn báº£n local (cÃ³ _idempotencyKey vÃ  _version Ä‘áº§y Ä‘á»§)
        if (collection === 'transactions' && memoryCache.transactions && memoryCache.transactions[key]) {
            var localTx = memoryCache.transactions[key];
            // Náº¿u local cÃ³ _version >= 1 vÃ  _syncedAt chÆ°a cÃ³, nghÄ©a lÃ  local chÆ°a sync
            // Giá»¯ nguyÃªn báº£n local, khÃ´ng ghi Ä‘Ã¨ báº±ng Firebase data
            if (localTx._version >= 1 && !localTx._syncedAt) {
                console.log('⏭️ Skip Firebase overwrite for pending local transaction:', key);
                return;
            }
        }
        
        // FIX: Kiá»ƒm tra idempotency - náº¿u transaction tá»« mÃ¡y khÃ¡c cÃ³ cÃ¹ng table+amount+method
        // trong khoáº£ng thá»i gian ngáº¯n, kiá»ƒm tra xem cÃ³ pháº£i trÃ¹ng khÃ´ng
        if (collection === 'transactions' && item.tableId && item.amount) {
            var txCache = memoryCache.transactions;
            if (txCache) {
                for (var ck in txCache) {
                    if (!txCache.hasOwnProperty(ck) || ck === key) continue;
                    var existing = txCache[ck];
                    if (existing.refunded) continue;
                    var sameTable = (existing.tableId === item.tableId) || (existing.tableName === item.tableName);
                    var sameAmount = Math.round(existing.amount || 0) === Math.round(item.amount || 0);
                    var sameMethod = existing.paymentMethod === item.paymentMethod;
                    if (sameTable && sameAmount && sameMethod) {
                        var timeDiff = Math.abs((existing.createdAt || 0) - (item.createdAt || 0));
                        if (timeDiff < 30000 && timeDiff > 0) {
                            // Transaction tá»« mÃ¡y khÃ¡c trÃ¹ng vá»›i local - Ä‘Ã¡nh dáº¥u refunded Ä‘á»ƒ áº©n
                            console.warn('⚠️ Detected duplicate transaction from another device:', key, 'duplicates', ck);
                            item.refunded = true;
                            item.note = (item.note || '') + ' [Tá»± Ä‘á»™ng Ä‘Ã¡nh dáº¥u trÃ¹ng láº·p]';
                            break;
                        }
                    }
                }
            }
        }
        
        saveToLocal(collection, item).then(emitUpdate);
    };
    var onChanged = function(snapshot) {
        if (!snapshot.exists()) return;
        var key = snapshot.key;
        var src = snapshot.val() || {};
        var item = { id: key };
        for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
        
        // FIX: Chỉ skip _version check cho transactions
        // KHÔNG skip cho tables vì có thể bàn bị xóa rồi tạo lại
        if (collection !== 'tables') {
            var localItem = memoryCache[collection] ? memoryCache[collection][key] : null;
            if (localItem && (localItem._version || 0) >= (item._version || 0)) {
                return;
            }
        }
        
        saveToLocal(collection, item).then(emitUpdate);
    };
    var onRemoved = function(snapshot) {
        var key = snapshot.key;
        deleteFromLocal(collection, key).then(emitUpdate);
    };
    ref.on('child_added', onAdded);
    ref.on('child_changed', onChanged);
    ref.on('child_removed', onRemoved);
    if (!listeners[collection]) listeners[collection] = [];
    listeners[collection].push({ added: onAdded, changed: onChanged, removed: onRemoved });
    return function() {
        ref.off('child_added', onAdded);
        ref.off('child_changed', onChanged);
        ref.off('child_removed', onRemoved);
    };
}

    // OPTIMIZE: Subscribe dùng once('value') + polling định kỳ cho collections ít thay đổi
    // Giảm download dữ liệu: không giữ kết nối realtime, chỉ refresh mỗi X giây
    // FIX: Chỉ load lần đầu + tạo pollTimer nếu chưa có (tránh trùng lặp)
    var _pollingTimers = {};
    function subscribeWithPolling(collection, callback, intervalSeconds) {
        intervalSeconds = intervalSeconds || 60; // Mặc định 60 giây
        // Đăng ký local callback
        if (callback) {
            if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
            _localCallbacks[collection].push(callback);
        }
        
        // FIX: Nếu đã có pollTimer cho collection này, không tạo mới
        // Nhưng gọi callback ngay với data hiện có để UI không phải chờ
        // Nếu chưa có data (initial load chưa hoàn thành), đăng ký callback để chờ
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
                        // FIX: memoryCache rỗng (initial load chưa hoàn thành)
                        // Đăng ký callback để được gọi khi initial load hoàn thành qua _notifyLocal
                        console.log('⏳ Polling ' + collection + ': memoryCache empty, registering callback for later');
                        if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
                        _localCallbacks[collection].push(callback);
                    }
                } else {
                    // FIX: memoryCache chưa được khởi tạo, đăng ký callback để chờ
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
        
        // DÃ¹ng _getDb Ä‘á»ƒ chá»n Master/Slave tÃ¹y theo collection
        var ref = _getDb(collection).ref(CURRENT_SHOP_ID + '/' + collection);
        
        // Load lần đầu (chỉ 1 lần) — dùng deltaSync nếu đã có sync_meta
        getSyncMeta(collection).then(function(meta) {
            if (meta && meta.maxVersion > 0) {
                // Đã có dữ liệu cũ, chỉ tải delta
                deltaSync(collection);
            } else {
                // Chưa có dữ liệu, tải toàn bộ
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
        
        // Polling định kỳ — dùng delta query theo _version
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
            
            // FIX: Polling cũng cần phát hiện deletions (item bị xóa trên Firebase không có _version)
            // Chạy cleanupDeletedIds để xóa các item đã bị xóa khỏi local cache
            _cleanupDeletedIds(collection);
        }, intervalSeconds * 1000);
        
        return function() {
            clearInterval(_pollingTimers[collection]);
            delete _pollingTimers[collection];
        };
    }
    
    // Quick Sync: Hàm debounced để đồng bộ nhanh khi tab resume
    // Dùng debounce 500ms để tránh gọi nhiều lần khi visibilitychange + focus cùng lúc
    var _quickSyncTimer = null;
    function _quickSync() {
        if (_quickSyncTimer) clearTimeout(_quickSyncTimer);
        _quickSyncTimer = setTimeout(function() {
            _quickSyncTimer = null;
            if (!isOnline) return;
            console.log('📡 Quick sync on resume...');
            // Tables luôn dùng fullSync để mirror chính xác
            fullSync('tables');
            // Các master collections khác dùng deltaSync
            var masterKeys = Object.keys(MASTER_COLLECTIONS);
            for (var i = 0; i < masterKeys.length; i++) {
                if (masterKeys[i] !== 'tables') {
                    deltaSync(masterKeys[i]);
                }
            }
            // Date-based collections dùng deltaSync
            var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
            for (var j = 0; j < dateKeys.length; j++) {
                deltaSync(dateKeys[j]);
            }
        }, 500);
    }
    
    // Network listener
    function initNetwork() {
        window.addEventListener('online', function() {
            isOnline = true;
            showToast('📡 Đã kết nối mạng', 'success');
            processSyncQueue();
            // FIX: Khi online trở lại, tables dùng fullSync để tải toàn bộ từ Firebase
            // (tables chỉ ~20 items, đảm bảo dữ liệu luôn khớp với Firebase)
            fullSync('tables');
            // Các master collections khác dùng deltaSync (chỉ tải items có _version > localMaxVersion)
            var masterKeys = Object.keys(MASTER_COLLECTIONS);
            for (var i = 0; i < masterKeys.length; i++) {
                if (masterKeys[i] !== 'tables') {
                    deltaSync(masterKeys[i]);
                }
            }
            // Date-based collections dùng deltaSync (chỉ tải giao dịch mới, không tải lại lịch sử)
            var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
            for (var j = 0; j < dateKeys.length; j++) {
                deltaSync(dateKeys[j]);
            }
        });
        window.addEventListener('offline', function() {
            isOnline = false;
            showToast('⚠️ Mất kết nối', 'warning');
        });
        
        // QUICK SYNC: Khi tab resume (visibilitychange + focus)
        // Giải quyết vấn đề: user chuyển tab khác, quay lại thì dữ liệu đã thay đổi
        // trên Firebase (từ máy khác) nhưng chưa được đồng bộ
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
    
    // Đọc sync_meta cho 1 collection từ localStorage (có memory cache)
    // Dùng localStorage thay vì IndexedDB để đảm bảo dữ liệu không bị mất khi F5
    function getSyncMeta(collection) {
        if (syncMetaCache[collection]) {
            return Promise.resolve(syncMetaCache[collection]);
        }
        // Đọc từ localStorage (synchronous, không bị mất khi F5)
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
            // localStorage không khả dụng, bỏ qua
        }
        // Fallback: đọc từ IndexedDB (nếu localStorage không có)
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
                        // Sync lên localStorage cho lần sau
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
    
    // Ghi sync_meta cho 1 collection vào localStorage (synchronous) + IndexedDB (async fallback)
    function saveSyncMeta(collection, meta) {
        syncMetaCache[collection] = meta;
        // Ghi vào localStorage ngay lập tức (synchronous, không bị mất khi F5)
        try {
            var lsKey = LS_SYNC_META_PREFIX + CURRENT_SHOP_ID + '_' + collection;
            localStorage.setItem(lsKey, JSON.stringify({
                id: collection,
                lastSyncAt: meta.lastSyncAt,
                maxVersion: meta.maxVersion,
                dateKeys: meta.dateKeys || []
            }));
        } catch (e) {
            // localStorage không khả dụng, bỏ qua
        }
        // Ghi vào IndexedDB (async, fallback)
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
    
    // Lấy maxVersion của 1 collection từ Firebase _meta node
    function getMaxVersionFromFirebase(collection) {
        if (!isOnline) return Promise.resolve(0);
        // Dùng _getDb() để chọn Master/Slave tùy theo collection
        return _getDb(collection).ref(CURRENT_SHOP_ID + '/_meta/' + collection + '/maxVersion').once('value').then(function(snapshot) {
            return snapshot.val() || 0;
        }).catch(function() { return 0; });
    }
    
    // Cập nhật maxVersion lên Firebase _meta node
    function updateMetaOnFirebase(collection, maxVersion) {
        if (!isOnline) return Promise.resolve();
        // Dùng _getDb() để chọn Master/Slave tùy theo collection
        return _getDb(collection).ref(CURRENT_SHOP_ID + '/_meta/' + collection).update({
            maxVersion: maxVersion,
            lastUpdatedAt: firebase.database.ServerValue.TIMESTAMP
        }).catch(function(err) {
            console.warn('⚠️ Could not update _meta for', collection, err);
        });
    }
    
    // ========== SMART SYNC ==========
    
    // Promise toàn cục để các component có thể đợi smartSync hoàn thành
    var _syncPromise = null;
    
    // Trả về promise để component đợi sync hoàn thành
    function whenSyncComplete() {
        if (_syncPromise) return _syncPromise;
        return Promise.resolve();
    }
    
    // Xác định trạng thái thiết bị và thực hiện đồng bộ phù hợp
        // Xác định trạng thái thiết bị và thực hiện đồng bộ phù hợp
    function smartSync() {
        if (!isOnline) {
            _syncPromise = Promise.resolve();
            return _syncPromise;
        }
        
        console.log('🔄 Smart sync started...');
        
        // OPTIMIZE: Chạy master collections SONG SONG (Promise.all) thay vì tuần tự
        // để giảm thời gian khởi tạo. Các collection độc lập, không phụ thuộc nhau.
        var masterKeys = Object.keys(MASTER_COLLECTIONS);
        var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
        
        var syncResults = { full: [], delta: [], skipped: [] };
        
        // Helper: sync một collection (fullSync hoặc deltaSync tùy theo sync_meta)
        function syncCollection(collection) {
            // FIX: Tables luôn dùng fullSync để đảm bảo dữ liệu khớp 100% với Firebase
            // (tables chỉ ~20 items, fullSync rất nhẹ)
            // Tránh trường hợp tables bị xóa trên Firebase nhưng local vẫn còn
            if (collection === 'tables') {
                syncResults.full.push(collection);
                return fullSync(collection);
            }
            
            return getSyncMeta(collection).then(function(meta) {
                // FIX: Kiểm tra nếu IndexedDB rỗng (memoryCache không có data) thì force fullSync
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
        
        // OPTIMIZE: Chạy master collections SONG SONG để giảm thời gian
        var masterPromises = [];
        for (var m = 0; m < masterKeys.length; m++) {
            (function(collection) {
                masterPromises.push(syncCollection(collection));
            })(masterKeys[m]);
        }
        
        // Date-based collections cũng chạy song song
        var datePromises = [];
        for (var d = 0; d < dateKeys.length; d++) {
            (function(collection) {
                datePromises.push(syncCollection(collection));
            })(dateKeys[d]);
        }
        
        // Chạy TẤT CẢ song song - master và date-based không phụ thuộc nhau
        _syncPromise = Promise.all(masterPromises.concat(datePromises)).then(function() {
            console.log('✅ Smart sync completed. Full:', syncResults.full.length, 'Delta:', syncResults.delta.length, 'Skipped:', syncResults.skipped.length);
            return syncResults;
        });
        return _syncPromise;
    }// FULL SYNC: Tải toàn bộ dữ liệu từ Firebase
    // - Master collections: tải tất cả
    // - Date-based collections: chỉ tải 30 ngày gần nhất
    function fullSync(collection) {
        if (!isOnline) return Promise.resolve();
        
        // FIX: Kiểm tra collection hợp lệ (master hoặc date-based)
        var isDateBased = DATE_BASED_COLLECTIONS[collection];
        var isMaster = MASTER_COLLECTIONS[collection];
        if (!isMaster && !isDateBased) {
            console.warn('  ⚠️ Unknown collection, skipping fullSync:', collection);
            return Promise.resolve();
        }
        
        return new Promise(function(resolve, reject) {
            // DÃ¹ng _getDb Ä‘á»ƒ chá»n Master/Slave tÃ¹y theo collection
            var ref = _getDb(collection).ref(CURRENT_SHOP_ID + '/' + collection);
            
            // Nếu là date-based, chỉ lấy 30 ngày gần nhất
            if (isDateBased) {
                var thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS;
                ref = ref.orderByChild('createdAt').startAt(thirtyDaysAgo);
            }
            
            ref.once('value', function(snapshot) {
                if (!snapshot.exists()) {
                    // Ghi sync_meta với maxVersion = 0
                    saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: 0, dateKeys: [] });
                    resolve();
                    return;
                }
                
                var remote = snapshot.val() || {};
                var count = 0;
                var maxVersion = 0;
                var dateKeys = [];
                
                // NÂNG CẤP: Suppress realtime trong fullSync để tránh hàng loạt event added riêng lẻ
                // Sau khi ghi xong tất cả, phát 1 event synced duy nhất
                _setSuppressRealtime(true);
                
                // Xóa local cache trước (chỉ cho master collections)
                if (isMaster && memoryCache[collection]) {
                    memoryCache[collection] = {};
                }
                
                // MIRROR SYNC: Với master collections, xóa toàn bộ dữ liệu cũ trong IndexedDB trước
                // để tránh items đã xóa trên Firebase vẫn còn trong local
                // Dùng store.clear() để xóa sạch object store, sau đó ghi dữ liệu mới từ Firebase
                // Áp dụng cho TẤT CẢ master collections (tables, menu, menu_categories, ingredients, customers, staffs, cost_categories, info)
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
                
                // Collection 'info' là special
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
                        // Phát 1 event synced duy nhất
                        _setSuppressRealtime(false);
                        _emit(collection + ':synced', { collection: collection, count: 1, timestamp: Date.now() });
                        console.log('  📥 Full synced info: 1 item');
                        resolve();
                    });
                    return;
                }
                
                // Ghi từng item từ Firebase vào local (sau khi đã clear nếu là tables)
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
                                
                                // Thu thập dateKeys cho date-based collections
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
                    // Cập nhật maxVersion lên Firebase _meta
                    updateMetaOnFirebase(collection, maxVersion);
                    // NÂNG CẤP: Phát 1 event synced duy nhất thay vì hàng loạt added
                    _setSuppressRealtime(false);
                    _emit(collection + ':synced', { collection: collection, count: count, timestamp: Date.now() });
                    resolve();
                }).catch(function(err) {
                    console.error('  ❌ Error full syncing ' + collection + ': ', err);
                    _setSuppressRealtime(false);
                    resolve();
                });
            }, function(err) {
                console.error('  ❌ Firebase read error for ' + collection + ': ', err);
                _setSuppressRealtime(false);
                resolve();
            });
        });
    }
    
    // DELTA SYNC: Chỉ tải những item có _version > localMaxVersion
    function deltaSync(collection) {
        if (!isOnline) return Promise.resolve();
        
        return getSyncMeta(collection).then(function(meta) {
            var localMaxVersion = (meta && meta.maxVersion) || 0;
            
            return new Promise(function(resolve, reject) {
                // Query Firebase: lấy items có _version > localMaxVersion
                // Dùng _getDb() để chọn Master/Slave tùy theo collection
                var ref = _getDb(collection).ref(CURRENT_SHOP_ID + '/' + collection);
                var queryRef = ref.orderByChild('_version').startAt(localMaxVersion + 1);
                
                queryRef.once('value', function(snapshot) {
                    var remote = snapshot.exists() ? (snapshot.val() || {}) : {};
                    var count = 0;
                    var newMaxVersion = localMaxVersion;
                    var dateKeys = (meta && meta.dateKeys) || [];
                    var isDateBased = DATE_BASED_COLLECTIONS[collection];
                    
                    // Collection 'info' là special
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
                                    
                                    // Thu thập dateKeys
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
                        // FIX: Sau khi delta sync, so sánh danh sách ID để phát hiện deletions
                        // (khi máy khác xóa item lúc máy này offline, delta sync không phát hiện được vì deletion không có _version)
                        return _cleanupDeletedIds(collection).then(function() {
                            saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: newMaxVersion, dateKeys: dateKeys });
                            updateMetaOnFirebase(collection, newMaxVersion);
                            resolve();
                        });
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
    
    // FIX: So sánh danh sách ID local vs Firebase để xóa các item đã bị xóa trên Firebase
    // Chỉ áp dụng cho master collections (date-based collections có cơ chế dateKey riêng)
    function _cleanupDeletedIds(collection) {
        var isMaster = MASTER_COLLECTIONS[collection];
        if (!isMaster) return Promise.resolve();
        if (!isOnline) return Promise.resolve();
        
        // FIX: Nếu memoryCache chưa được khởi tạo, load từ IndexedDB trước
        // Tránh trường hợp _cleanupDeletedIds return sớm vì memoryCache rỗng
        // trong khi IndexedDB vẫn còn items cũ (đã bị xóa trên Firebase)
        var loadMemory = Promise.resolve();
        if (!memoryCache[collection]) {
            loadMemory = loadFromLocal(collection).then(function(data) {
                if (data) {
                    memoryCache[collection] = data;
                }
            });
        }
        
        return loadMemory.then(function() {
            if (!memoryCache[collection]) return;
            
            var localIds = Object.keys(memoryCache[collection]);
            if (localIds.length === 0) return;
        
            // Query Firebase để lấy tất cả keys hiện tại (chỉ lấy keys, không lấy data - nhẹ)
            // Dùng _getDb() để chọn Master/Slave tùy theo collection
            var ref = _getDb(collection).ref(CURRENT_SHOP_ID + '/' + collection);
            return ref.once('value').then(function(snapshot) {
                var remoteData = snapshot.val() || {};
                var remoteIds = Object.keys(remoteData);
                
                // Tìm ID có trong local nhưng không trong remote (= đã bị xóa)
                var deletedIds = [];
                for (var i = 0; i < localIds.length; i++) {
                    if (remoteIds.indexOf(localIds[i]) === -1) {
                        deletedIds.push(localIds[i]);
                    }
                }
                
                if (deletedIds.length === 0) return;
                
                // Xóa từng ID khỏi local
                var deleteChain = Promise.resolve();
                for (var d = 0; d < deletedIds.length; d++) {
                    (function(delId) {
                        deleteChain = deleteChain.then(function() {
                            return deleteFromLocal(collection, delId);
                        });
                    })(deletedIds[d]);
                }
                return deleteChain;
            }).catch(function(err) {
                // Fallback: nếu lỗi thì vẫn tiếp tục, không block sync
                console.warn('  ⚠️ Could not check deleted IDs for', collection, ':', err.message);
            });
        });
    }
    
    // SNAPSHOT RECONCILE: Kết hợp _cleanupDeletedIds() + fullSync() cho master collections
    // Giải quyết triệt để vấn đề: dữ liệu local lệch với Firebase do:
    // 1. Items bị xóa trên Firebase nhưng local chưa được cleanup
    // 2. Items được cập nhật trên Firebase nhưng local chưa sync
    // 3. sync_meta bị lệch (maxVersion sai) dẫn đến deltaSync bỏ sót items
    // Dùng khi: online trở lại, tab resume, hoặc phát hiện dữ liệu bất thường
    function reconcileSnapshot(collection) {
        if (!isOnline) return Promise.resolve();
        var isMaster = MASTER_COLLECTIONS[collection];
        if (!isMaster) {
            // Date-based collections không cần reconcile (dùng dateKey)
            return Promise.resolve();
        }
        console.log('🔄 Reconcile snapshot for:', collection);
        // Bước 1: Xóa các items đã bị xóa trên Firebase
        return _cleanupDeletedIds(collection).then(function() {
            // Bước 2: Reset sync_meta để force fullSync tải lại toàn bộ
            // Xóa maxVersion để fullSync() không bị giới hạn bởi version cũ
            return saveSyncMeta(collection, { lastSyncAt: 0, maxVersion: 0, dateKeys: [] });
        }).then(function() {
            // Bước 3: FullSync tải toàn bộ dữ liệu mới từ Firebase
            return fullSync(collection);
        });
    }
    
    // Deduplication: tránh fetch cùng 1 dateKey nhiều lần khi nhiều component cùng gọi
    var _fetchingDateKeys = {};
    
    // SYNC COLLECTION BY DATE: Tải transactions cho 1 ngày cụ thể từ Firebase
    function syncCollectionByDate(collection, dateKey) {
        if (!isOnline) return Promise.resolve([]);
        
        // Nếu đang fetch dateKey này rồi, đợi nó hoàn thành
        var fetchKey = collection + '|' + dateKey;
        if (_fetchingDateKeys[fetchKey]) {
            return _fetchingDateKeys[fetchKey];
        }
        
        var promise = _doSyncCollectionByDate(collection, dateKey);
        _fetchingDateKeys[fetchKey] = promise;
        
        // Xóa khỏi dedup cache sau khi hoàn thành
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
            
            // Nếu đã có dateKey này trong sync_meta, không cần tải lại
            if (dateKeys.indexOf(dateKey) >= 0) {
                // Nhưng vẫn đọc từ local để trả về
                return loadFromLocal(collection).then(function(data) {
                    var filtered = [];
                    for (var i = 0; i < data.length; i++) {
                        if (data[i].dateKey === dateKey) filtered.push(data[i]);
                    }
                    return filtered;
                });
            }
            
            // Chưa có dateKey → tải từ Firebase
            console.log('  📥 Fetching', collection, 'for date:', dateKey);
            
            return new Promise(function(resolve, reject) {
                // Dùng _getDb() để chọn Master/Slave tùy theo collection
                var ref = _getDb(collection).ref(CURRENT_SHOP_ID + '/' + collection);
                ref.orderByChild('dateKey').equalTo(dateKey).once('value', function(snapshot) {
                    if (!snapshot.exists()) {
                        // Không có dữ liệu cho ngày này, nhưng vẫn lưu dateKey vào sync_meta
                        // để lần sau không fetch lại ngày này nữa
                        if (dateKeys.indexOf(dateKey) < 0) {
                            dateKeys.push(dateKey);
                        }
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: (meta && meta.maxVersion) || 0, dateKeys: dateKeys });
                        console.log('  📥 Fetched', collection, 'for', dateKey, ': 0 items (no data)');
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
                        // Cập nhật dateKeys
                        if (dateKeys.indexOf(dateKey) < 0) {
                            dateKeys.push(dateKey);
                        }
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: maxVersion, dateKeys: dateKeys });
                        updateMetaOnFirebase(collection, maxVersion);
                        console.log('  📥 Fetched', collection, 'for', dateKey, ':', items.length, 'items');
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
    
    // Lấy danh sách dateKeys giữa 2 ngày (dùng để kiểm tra thiếu ngày nào)
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
            var request = indexedDB.open(STORE_NAME, 19);
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
    'sync_meta'
];
                for (var i = 0; i < stores.length; i++) {
                    if (!db.objectStoreNames.contains(stores[i])) {
                        db.createObjectStore(stores[i], { keyPath: 'id' });
                        console.log('Created store:', stores[i]);
                    }
                }
                // FIX: Kiá»ƒm tra transaction tá»“n táº¡i trÆ°á»›c khi táº¡o index
                // TrÃ¡nh lá»—i khi database vá»«a Ä‘Æ°á»£c táº¡o má»›i (sau khi xÃ³a)
                try {
                    var tx = e.target.transaction;
                    
                    // FIX: XÃ³a dá»¯ liá»‡u cÅ© trong info store (cÃ¡c item láº» tá»« child_* events)
                    // Sau khi chuyá»ƒn sang on('value'), chá»‰ cáº§n 1 item shop_config duy nháº¥t
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

    // Seed dá»¯ liá»‡u cho POS máº·c Ä‘á»‹nh (shop_default) náº¿u chÆ°a cÃ³ shop_registry
    // LUÃ”N ghi vÃ o Master DB
    function seedDefaultShop() {
        return masterDb.ref('shop_registry/123123').once('value').then(function(snapshot) {
            if (snapshot.exists()) return; // ÄÃ£ cÃ³ rá»“i, khÃ´ng cáº§n seed
            
            console.log('ðŸŒ± Seeding default shop data...');
            var staffId = 'staff_admin_' + Date.now().toString(36);
            var updates = {};
            
            // Táº¡o shop_registry cho mÃ£ 123123 -> shop_default
            updates['shop_registry/123123'] = {
                shopId: 'shop_default',
                shopName: 'Hệ Thống Bán Hàng',
                shopCode: '123123',
                createdAt: Date.now(),
                status: 'active'
            };
            
            // Táº¡o staff admin cho shop_default
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
                name: 'Hệ Thống Bán Hàng',
                code: '123123',
                createdAt: Date.now(),
                // Telegram config
                telegramBotToken: '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                telegramChatId: '6372876364',
                telegramShiftCloseToken: '',
                telegramWarningToken: '',
                telegramExpenseToken: '',
                // Lock password cho hoÃ n tÃ¡c
                lockPassword: '28122020',
                // Khung giá» khÃ³a toÃ n bá»™ bÃ n
                lockStartHour: 22,
                lockEndHour: 5,
                lockEndMinute: 30,
                // Thá»i gian ngá»“i tá»‘i Ä‘a trÆ°á»›c khi khÃ³a bÃ n (giá»)
                tableLockHours: 5
            };
            
            return masterDb.ref().update(updates).then(function() {
                console.log('âœ… Default shop seeded: mÃ£ 123123, user admin123123, pass 123123');
            });
        }).catch(function(err) {
            console.error('Seed error:', err);
        });
    }

    // Tá»± Ä‘á»™ng táº¡o config fields cho shop hiá»‡n táº¡i náº¿u chÆ°a cÃ³
    // DÃ¹ng _getDb Ä‘á»ƒ chá»n Master/Slave tÃ¹y theo collection
    function ensureShopConfig() {
        // Äáº£m báº£o cÃ¡c config fields tá»“n táº¡i trong /info
        return _getDb('info').ref(CURRENT_SHOP_ID + '/info').once('value').then(function(snapshot) {
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
                console.log('âš™ï¸ Adding missing config fields to shop info...');
                return _getDb('info').ref(CURRENT_SHOP_ID + '/info').update(updates).then(function() {
                    console.log('âœ… Shop config fields created');
                });
            }
        }).catch(function(err) {
            console.error('âš ï¸ ensureShopConfig error:', err);
        });
    }

    
    // ========== ENSURE COLLECTION ==========
    // Kiá»ƒm tra náº¿u collection trá»‘ng trong local thÃ¬ force sync tá»« Firebase
    // DÃ¹ng khi component cáº§n Ä‘áº£m báº£o dá»¯ liá»‡u Ä‘Ã£ Ä‘Æ°á»£c load trÆ°á»›c khi render
    function ensureCollection(collection) {
        if (!isOnline) return Promise.resolve([]);
        return loadFromLocal(collection).then(function(localData) {
            if (localData && Object.keys(localData).length > 0) {
                // ÄÃ£ cÃ³ dá»¯ liá»‡u, tráº£ vá» dáº¡ng array
                var arr = [];
                for (var k in localData) {
                    if (localData.hasOwnProperty(k)) arr.push(localData[k]);
                }
                return arr;
            }
            // Local trá»‘ng, cáº§n sync tá»« Firebase
            console.log('  ðŸ“¦ Local empty for', collection, '- syncing from Firebase...');
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
// ========== FORCE SYNC Tá»ª FIREBASE ==========
    // DÃ¹ng khi phÃ¡t hiá»‡n IndexedDB bá»‹ xÃ³a (local rá»—ng) - force táº£i láº¡i tá»« Firebase
    function forceSyncFromFirebase() {
        if (!isOnline) {
            console.warn('âš ï¸ Offline, cannot force sync from Firebase');
            return Promise.reject(new Error('Offline'));
        }
        // OPTIMIZE: Chỉ sync các collection thực sự tồn tại trong Firebase
        // Bỏ: reports, cost_transactions_admin, admin_cost_categories (không tồn tại)
        var collections = [
            'tables', 'customers', 'menu', 'menu_categories',
            'ingredients', 'transactions',
            'cost_categories', 'cost_transactions',
            'daily_balances',
            'inventory_transactions', 'manager_cash_pickups',
            'ingredient_transactions', 'notifications',
            'info',
            'messages'
        ];
        
        console.log('ðŸ”„ Force syncing all collections from Firebase...');
        
        // XÃ³a sync_meta cache Ä‘á»ƒ fullSync cháº¡y láº¡i tá»« Ä‘áº§u
        syncMetaCache = {};
        
        var chain = Promise.resolve();
        for (var c = 0; c < collections.length; c++) {
            chain = chain.then((function(collection) {
                return function() {
                    // XÃ³a local cache trÆ°á»›c khi fullSync
                    if (memoryCache[collection]) {
                        memoryCache[collection] = {};
                    }
                    return fullSync(collection);
                };
            })(collections[c]));
        }
        
        // LÆ°u promise Ä‘á»ƒ cÃ¡c component cÃ³ thá»ƒ Ä‘á»£i force sync hoÃ n thÃ nh
        _syncPromise = chain.then(function() {
            console.log('âœ… Force sync completed');
        });
        return _syncPromise;
    }

    // Init Database
    function initDatabase() {
        // Khôi phục dirty flags từ localStorage để biết collection nào chưa sync
        _restoreDirtyFlags();
        // FIX: Đợi Slave Firebase khởi tạo xong (nếu có) trước khi sync data
        // Tránh trường hợp F5/reload: session được restore nhưng slaveApp/slaveDb = null
        // Nếu không đợi, smartSync/forceSync sẽ sync từ masterDb (sai Firebase)
        var slaveReady = _slaveInitPromise || Promise.resolve();
        return slaveReady.then(function() {
            return initLocalDB();
        }).then(function() {
            initNetwork();
            if (isOnline) return smartSync();
            return Promise.resolve();
        }).then(function() {
            // Seed dá»¯ liá»‡u máº·c Ä‘á»‹nh náº¿u chÆ°a cÃ³
            return seedDefaultShop();
        }).then(function() {
            // Tá»± Ä‘á»™ng táº¡o config fields cho shop hiá»‡n táº¡i náº¿u chÆ°a cÃ³
            return ensureShopConfig();
        }).then(function() {
            // Subscribe cÃ¡c collections cáº§n thiáº¿t cho POS
            // tables, customers, menu, menu_categories, transactions, notifications
            // Bá»: ingredients, cost_categories, cost_transactions, cost_transactions_admin,
            //      admin_cost_categories, reports
            // OPTIMIZE: transactions dÃ¹ng limitToLast(200) Ä‘á»ƒ chá»‰ láº¥y 200 giao dá»‹ch gáº§n nháº¥t
            // Giáº£m dung lÆ°á»£ng download tá»« hÃ ng ngÃ n item xuá»‘ng 200 item
            subscribeToCollection('tables');
            // FIX: Cleanup deleted IDs ngay sau khi subscribe tables
            // Đảm bảo IndexedDB không chứa items cũ đã bị xóa trên Firebase
            // trước khi loadData() đọc tables
            // QUAN TRỌNG: Không dùng return ở đây để tránh làm hỏng luồng code
            // Các polling timers và code phía sau vẫn cần được thực thi
            _cleanupDeletedIds('tables').then(function() {
                subscribeToCollection('customers');
                subscribeToCollection('transactions', null, { orderByChild: 'createdAt', limitToLast: 200 });
                subscribeToCollection('notifications');
                subscribeToCollection('info');
                subscribeToCollection('daily_balances');
                // FIX: ThÃªm subscribe cho cost_categories vÃ  cost_transactions
                // Ä‘á»ƒ loadExpenseData() vÃ  managerApplyFilter() cÃ³ dá»¯ liá»‡u
                subscribeToCollection('cost_categories');
                subscribeToCollection('cost_transactions');

                // OPTIMIZE: CÃ¡c collection Ã­t thay Ä‘á»•i dÃ¹ng polling thay vÃ¬ realtime
                // menu, menu_categories, ingredients, messages: refresh má»—i 60s
                // FIX: KhÃ´ng gá»i subscribeWithPolling vá»›i callback null á»Ÿ Ä‘Ã¢y
                // VÃ¬ subscribeWithPolling sáº½ Ä‘Æ°á»£c gá»i tá»« initRealtime() vá»›i callback tháº­t
                // Náº¿u gá»i vá»›i null trÆ°á»›c, láº§n gá»i sau tá»« initRealtime() sáº½ hit early return
                // vÃ  cÃ³ thá»ƒ bá» lá»¡ callback náº¿u memoryCache chÆ°a sáºµn sÃ ng
                // Thay vÃ o Ä‘Ã³, chá»‰ khá»Ÿi táº¡o polling timer náº¿u chÆ°a cÃ³
                // WATCHDOG: Polling riêng cho tables (30s) để phát hiện thay đổi từ máy khác
                // Tables là collection quan trọng nhất, cần độ trễ thấp nhất
                if (!_pollingTimers['tables']) {
                    _pollingTimers['tables'] = setInterval(function() {
                        if (!isOnline) return;
                        // Dùng _cleanupDeletedIds trước để xóa bàn đã bị xóa trên Firebase
                        _cleanupDeletedIds('tables').then(function() {
                            // Sau đó deltaSync để lấy các bàn mới hoặc đã cập nhật
                            return deltaSync('tables');
                        });
                    }, 30000);
                }
                
                if (!_pollingTimers['menu']) {
                    _pollingTimers['menu'] = setInterval(function() {
                        if (!isOnline) return;
                        var ref = _getDb('menu').ref(CURRENT_SHOP_ID + '/menu');
                        getSyncMeta('menu').then(function(meta) {
                            var localMaxVersion = (meta && meta.maxVersion) || 0;
                            ref.orderByChild('_version').startAt(localMaxVersion + 1).once('value', function(snapshot) {
                                if (!snapshot.exists()) return;
                                var remote = snapshot.val() || {};
                                var count = 0, newMaxVersion = localMaxVersion;
                                for (var key in remote) {
                                    if (remote.hasOwnProperty(key)) {
                                        var src = remote[key];
                                        var item = { id: key };
                                        for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                                        if (item._version === undefined) item._version = 1;
                                        if (item._version > newMaxVersion) newMaxVersion = item._version;
                                        var localItem = memoryCache['menu'] ? memoryCache['menu'][key] : null;
                                        saveToLocal('menu', item, localItem ? 'changed' : 'added');
                                        count++;
                                    }
                                }
                                if (count > 0) {
                                    saveSyncMeta('menu', { lastSyncAt: Date.now(), maxVersion: newMaxVersion, dateKeys: (meta && meta.dateKeys) || [] });
                                }
                                // FIX: Polling cũng cần phát hiện deletions
                                _cleanupDeletedIds('menu');
                            });
                        });
                    }, 60000);
                }
                if (!_pollingTimers['menu_categories']) {
                    _pollingTimers['menu_categories'] = setInterval(function() {
                        if (!isOnline) return;
                        var ref = _getDb('menu_categories').ref(CURRENT_SHOP_ID + '/menu_categories');
                        getSyncMeta('menu_categories').then(function(meta) {
                            var localMaxVersion = (meta && meta.maxVersion) || 0;
                            ref.orderByChild('_version').startAt(localMaxVersion + 1).once('value', function(snapshot) {
                                if (!snapshot.exists()) return;
                                var remote = snapshot.val() || {};
                                var count = 0, newMaxVersion = localMaxVersion;
                                for (var key in remote) {
                                    if (remote.hasOwnProperty(key)) {
                                        var src = remote[key];
                                        var item = { id: key };
                                        for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                                        if (item._version === undefined) item._version = 1;
                                        if (item._version > newMaxVersion) newMaxVersion = item._version;
                                        var localItem = memoryCache['menu_categories'] ? memoryCache['menu_categories'][key] : null;
                                        saveToLocal('menu_categories', item, localItem ? 'changed' : 'added');
                                        count++;
                                    }
                                }
                                if (count > 0) {
                                    saveSyncMeta('menu_categories', { lastSyncAt: Date.now(), maxVersion: newMaxVersion, dateKeys: (meta && meta.dateKeys) || [] });
                                }
                                // FIX: Polling cũng cần phát hiện deletions
                                _cleanupDeletedIds('menu_categories');
                            });
                        });
                    }, 60000);
                }
                if (!_pollingTimers['ingredients']) {
                    _pollingTimers['ingredients'] = setInterval(function() {
                        if (!isOnline) return;
                        var ref = _getDb('ingredients').ref(CURRENT_SHOP_ID + '/ingredients');
                        getSyncMeta('ingredients').then(function(meta) {
                            var localMaxVersion = (meta && meta.maxVersion) || 0;
                            ref.orderByChild('_version').startAt(localMaxVersion + 1).once('value', function(snapshot) {
                                if (!snapshot.exists()) return;
                                var remote = snapshot.val() || {};
                                var count = 0, newMaxVersion = localMaxVersion;
                                for (var key in remote) {
                                    if (remote.hasOwnProperty(key)) {
                                        var src = remote[key];
                                        var item = { id: key };
                                        for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                                        if (item._version === undefined) item._version = 1;
                                        if (item._version > newMaxVersion) newMaxVersion = item._version;
                                        var localItem = memoryCache['ingredients'] ? memoryCache['ingredients'][key] : null;
                                        saveToLocal('ingredients', item, localItem ? 'changed' : 'added');
                                        count++;
                                    }
                                }
                                if (count > 0) {
                                    saveSyncMeta('ingredients', { lastSyncAt: Date.now(), maxVersion: newMaxVersion, dateKeys: (meta && meta.dateKeys) || [] });
                                }
                                // FIX: Polling cũng cần phát hiện deletions
                                _cleanupDeletedIds('ingredients');
                            });
                        });
                    }, 60000);
                }
                if (!_pollingTimers['messages']) {
                    _pollingTimers['messages'] = setInterval(function() {
                        if (!isOnline) return;
                        var ref = _getDb('messages').ref(CURRENT_SHOP_ID + '/messages');
                        getSyncMeta('messages').then(function(meta) {
                            var localMaxVersion = (meta && meta.maxVersion) || 0;
                            ref.orderByChild('_version').startAt(localMaxVersion + 1).once('value', function(snapshot) {
                                if (!snapshot.exists()) return;
                                var remote = snapshot.val() || {};
                                var count = 0, newMaxVersion = localMaxVersion;
                                for (var key in remote) {
                                    if (remote.hasOwnProperty(key)) {
                                        var src = remote[key];
                                        var item = { id: key };
                                        for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                                        if (item._version === undefined) item._version = 1;
                                        if (item._version > newMaxVersion) newMaxVersion = item._version;
                                        var localItem = memoryCache['messages'] ? memoryCache['messages'][key] : null;
                                        saveToLocal('messages', item, localItem ? 'changed' : 'added');
                                        count++;
                                    }
                                }
                                if (count > 0) {
                                    saveSyncMeta('messages', { lastSyncAt: Date.now(), maxVersion: newMaxVersion, dateKeys: (meta && meta.dateKeys) || [] });
                                }
                                // FIX: Polling cũng cần phát hiện deletions
                                _cleanupDeletedIds('messages');
                            });
                        });
                    }, 60000);
                }
                console.log('âœ… Database ready, device:', CURRENT_DEVICE_ID);
                return { isOnline: isOnline, deviceId: CURRENT_DEVICE_ID };
            });
        });
    }

    // Helper showToast (dÃ¹ng chung)
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
    
    // XÃ³a toÃ n bá»™ dá»¯ liá»‡u local (IndexedDB + localStorage + memory cache) khi chuyá»ƒn POS
    function clearLocalData() {
        // XÃ³a memory cache
        memoryCache = {};
        cacheVersion = {};
        syncMetaCache = {};
        
        // XÃ³a sync_meta trong localStorage
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
        
        // XÃ³a táº¥t cáº£ object stores trong IndexedDB
        if (!localDB) return Promise.resolve();
        
        var storeNames = [];
        for (var i = 0; i < localDB.objectStoreNames.length; i++) {
            storeNames.push(localDB.objectStoreNames[i]);
        }
        var promises = [];
        for (var i = 0; i < storeNames.length; i++) {
            var name = storeNames[i];
            if (name === 'sync_queue') continue; // Giá»¯ láº¡i sync queue
            promises.push(new Promise(function(resolve, reject) {
                var tx = localDB.transaction([name], 'readwrite');
                var store = tx.objectStore(name);
                var req = store.clear();
                req.onsuccess = function() { resolve(); };
                req.onerror = function() { reject(req.error); };
            }));
        }
        return Promise.all(promises).then(function() {
            console.log('ðŸ—‘ï¸ Cleared all local data for shop switch');
        });
    }
    
    // Đổi shopId (khi đăng nhập vào POS khác)
    function setShopId(shopId) {
        if (!shopId) return;
        CURRENT_SHOP_ID = shopId;
        localStorage.setItem('current_shop_id', shopId);
        console.log('ðŸ”„ Switched to shop:', shopId);
    }
    
    // Láº¥y shopId hiá»‡n táº¡i
    function getShopId() {
        return CURRENT_SHOP_ID;
    }
    
    // FIX: HÃ m helper set currentUser vÃ  lÆ°u session, dÃ¹ng chung cho cáº£ 3 branch cá»§a login()
    // TrÃ¡nh bug login() tráº£ vá» undefined á»Ÿ branch cÃ³ firebase_config riÃªng
    function _setCurrentUserAndSession(foundStaff, shopId, shopCode, shopInfo, hasCustomConfig) {
        currentUser = {
            id: foundStaff.id,
            username: foundStaff.username,
            displayName: foundStaff.displayName || foundStaff.username,
            role: foundStaff.role || 'staff',
            shopId: shopId,
            shopCode: shopCode,
            shopName: shopInfo.shopName || '',
            hasCustomConfig: hasCustomConfig
        };
        localStorage.setItem('pos_session', JSON.stringify(currentUser));
        setShopId(shopId);
        return currentUser;
    }
    
    // ÄÄƒng nháº­p: kiá»ƒm tra shopCode -> láº¥y shopId -> verify staff credentials
    // Há»— trá»£: master_admin (shopCode='master'), POS cÃ³ firebase_config riÃªng, migration tá»± Ä‘á»™ng
        function login(shopCode, username, password) {
        if (!shopCode || !username || !password) {
            return Promise.reject(new Error('Vui lòng nhập đầy đủ thông tin'));
        }

        // ===== TRƯỜNG HỢP 1: Master Admin login =====
        if (shopCode === 'master') {
            return masterDb.ref('master_admins').once('value').then(function(snapshot) {
                var admins = snapshot.val() || {};
                var foundAdmin = null;
                for (var key in admins) {
                    if (admins.hasOwnProperty(key)) {
                        var a = admins[key];
                        if (a.username === username && a.password === password) {
                            foundAdmin = a;
                            foundAdmin.id = key;
                            break;
                        }
                    }
                }
                if (!foundAdmin) {
                    throw new Error('Sai tên đăng nhập hoặc mật khẩu Master Admin');
                }
                // Master admin: set currentUser ngay, không cần clearLocalData
                currentUser = {
                    id: foundAdmin.id,
                    username: foundAdmin.username,
                    displayName: foundAdmin.displayName || foundAdmin.username,
                    role: 'master_admin',
                    shopId: 'master',
                    shopCode: 'master',
                    shopName: 'Master Admin'
                };
                localStorage.setItem('pos_session', JSON.stringify(currentUser));
                setShopId('master');
                // Master admin không cần Slave App
                if (slaveApp) {
                    try { slaveApp.delete(); } catch(e) {}
                    slaveApp = null;
                    slaveDb = null;
                    slaveConfig = null;
                }
                return currentUser;
            });
        }

        // ===== TRƯỜNG HỢP 2: POS login (shopCode bình thường) =====
        // Tra cứu shopCode trong shop_registry (LUÔN ở Master)
        return masterDb.ref('shop_registry/' + shopCode).once('value').then(function(snapshot) {
            if (!snapshot.exists()) {
                throw new Error('Mã POS không tồn tại');
            }
            var shopInfo = snapshot.val();
            var shopId = shopInfo.shopId;

            // Kiểm tra trạng thái POS (locked/active)
            if (shopInfo.status === 'locked') {
                throw new Error('POS này đã bị khóa. Vui lòng liên hệ Admin Master.');
            }
            if (shopInfo.status === 'deleted') {
                throw new Error('POS này đã bị xóa. Vui lòng liên hệ Admin Master.');
            }

            // Đọc firebaseConfig từ shop_registry (nếu có)
            var fbConfig = shopInfo.firebaseConfig || null;
            // Vẫn giữ lại fallback đọc từ firebase_config cũ (tương thích ngược)
            var _fbConfigFallback = null;
            if (!fbConfig) {
                _fbConfigFallback = masterDb.ref('firebase_config/' + shopId).once('value').then(function(configSnapshot) {
                    fbConfig = configSnapshot.val() || null;
                });
            } else {
                _fbConfigFallback = Promise.resolve();
            }

            return _fbConfigFallback.then(function() {
                // Bước 1: Đọc staff từ Master Firebase NGAY LẬP TỨC
                return masterDb.ref(shopId + '/staffs').once('value').then(function(staffSnapshot) {
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

                    // Bước 2: Kiểm tra nếu chuyển sang POS khác -> clear cache cũ
                    var oldShopId = localStorage.getItem('current_shop_id');
                    var isSwitchingShop = oldShopId && oldShopId !== shopId;
                    
                    if (isSwitchingShop) {
                        console.log('🔄 Phát hiện chuyển POS từ', oldShopId, '->', shopId, 'đang clear cache cũ...');
                        // Clear memory cache ngay lập tức
                        memoryCache = {};
                        cacheVersion = {};
                        syncMetaCache = {};
                        // Xóa sync_meta cũ trong localStorage
                        try {
                            var oldLsPrefix = LS_SYNC_META_PREFIX + oldShopId + '_';
                            var keysToRemove = [];
                            for (var i = 0; i < localStorage.length; i++) {
                                var key = localStorage.key(i);
                                if (key && key.indexOf(oldLsPrefix) === 0) {
                                    keysToRemove.push(key);
                                }
                            }
                            for (var i = 0; i < keysToRemove.length; i++) {
                                localStorage.removeItem(keysToRemove[i]);
                            }
                        } catch (e) {}
                    }

                    var hasCustomConfig = !!fbConfig;
                    _setCurrentUserAndSession(foundStaff, shopId, shopCode, shopInfo, hasCustomConfig);

                    // Bước 3: Xử lý Firebase config
                    // Tạo promise cho Slave init để reloadAppData có thể đợi
                    var _slaveInitPromiseForLogin = null;
                    
                    if (fbConfig) {
                        // Có config riêng: init Slave + migrate
                        var oldConfigHash = localStorage.getItem(CONFIG_HASH_KEY);
                        var newConfigHash = _getConfigHash(fbConfig);

                        _slaveInitPromiseForLogin = _initSlaveApp(shopId, fbConfig).then(function() {
                            // Phát hiện thay đổi config -> cần migration
                            if (oldConfigHash && oldConfigHash !== 'master' && oldConfigHash !== newConfigHash) {
                                console.log('🔀 Phát hiện thay đổi Firebase config, chuẩn bị migration...');
                                return _migrateData(shopId, masterDb, slaveDb).then(function() {
                                    localStorage.setItem(CONFIG_HASH_KEY, newConfigHash);
                                    console.log('🔀 Migration hoàn tất cho', shopId);
                                });
                            } else {
                                localStorage.setItem(CONFIG_HASH_KEY, newConfigHash);
                            }
                        }).catch(function(err) {
                            console.error('⚠️ Lỗi init Slave:', err);
                        });
                    } else {
                        // Không có config riêng: dùng Master
                        localStorage.setItem(CONFIG_HASH_KEY, 'master');
                        // Hủy Slave nếu đang tồn tại
                        if (slaveApp) {
                            try { slaveApp.delete(); } catch(e) {}
                            slaveApp = null;
                            slaveDb = null;
                            slaveConfig = null;
                        }
                        _slaveInitPromiseForLogin = Promise.resolve();
                    }

                    // Bước 4: Clear IndexedDB nếu chuyển POS (sau khi đã lưu currentUser)
                    // và đợi Slave init xong để đảm bảo dữ liệu sync đúng Firebase
                    if (isSwitchingShop) {
                        // Đợi Slave init xong rồi mới clear IndexedDB
                        // để tránh clear xong mà Slave chưa kịp init
                        return (_slaveInitPromiseForLogin || Promise.resolve()).then(function() {
                            if (!localDB) return currentUser;
                            var storeNames = [];
                            for (var i = 0; i < localDB.objectStoreNames.length; i++) {
                                storeNames.push(localDB.objectStoreNames[i]);
                            }
                            var promises = [];
                            for (var i = 0; i < storeNames.length; i++) {
                                var name = storeNames[i];
                                if (name === 'sync_queue') continue;
                                promises.push(new Promise(function(resolve, reject) {
                                    var tx = localDB.transaction([name], 'readwrite');
                                    var store = tx.objectStore(name);
                                    var req = store.clear();
                                    req.onsuccess = function() { resolve(); };
                                    req.onerror = function() { reject(req.error); };
                                }));
                            }
                            return Promise.all(promises).then(function() {
                                console.log('🗑️ Cleared IndexedDB data for shop switch to', shopId);
                                return currentUser;
                            });
                        });
                    }

                    // Không chuyển POS: trả về ngay
                    return currentUser;
                });
            });
        });
    }function registerShop(shopName, shopCode, adminUser, adminPass, firebaseConfig) {
        if (!shopName || !shopCode || !adminUser || !adminPass) {
            return Promise.reject(new Error('Vui lÃ²ng nháº­p Ä‘áº§y Ä‘á»§ thÃ´ng tin'));
        }
        if (shopCode.length < 3) {
            return Promise.reject(new Error('MÃ£ POS pháº£i cÃ³ Ã­t nháº¥t 3 kÃ½ tá»±'));
        }
        if (adminPass.length < 4) {
            return Promise.reject(new Error('Máº­t kháº©u pháº£i cÃ³ Ã­t nháº¥t 4 kÃ½ tá»±'));
        }
        
        console.log('ðŸ”„ registerShop() - ÄÄƒng kÃ½ POS má»›i:', { shopName: shopName, shopCode: shopCode, adminUser: adminUser, hasCustomConfig: !!firebaseConfig });
        
        // Kiá»ƒm tra shopCode Ä‘Ã£ tá»“n táº¡i chÆ°a (LUÃ”N á»Ÿ Master)
        return masterDb.ref('shop_registry/' + shopCode).once('value').then(function(snapshot) {
            if (snapshot.exists()) {
                throw new Error('MÃ£ POS nÃ y Ä‘Ã£ Ä‘Æ°á»£c Ä‘Äƒng kÃ½');
            }
            
            // Táº¡o shopId
            var shopId = 'shop_' + shopCode.toLowerCase();
            
            // Táº¡o staff admin
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
            
            // Táº¡o shop_registry entry
            var registryData = {
                shopId: shopId,
                shopName: shopName,
                shopCode: shopCode,
                createdAt: Date.now(),
                status: 'active',
                hasCustomConfig: !!firebaseConfig,
                firebaseConfig: firebaseConfig || null
            };
            
            // Batch write: shop_registry + shop data + staff (LUÃ”N á»Ÿ Master)
            var updates = {};
            updates['shop_registry/' + shopCode] = registryData;
            updates[shopId + '/staffs/' + staffId] = staffData;
            updates[shopId + '/info'] = {
                id: 'shop_config',
                name: shopName,
                code: shopCode,
                createdAt: Date.now()
            };
            
            // Náº¿u cÃ³ firebaseConfig, khá»Ÿi táº¡o Slave App vÃ  táº¡o staff trong Slave Firebase
            var _slaveInitPromise = null;
            if (firebaseConfig) {
                _slaveInitPromise = _initSlaveApp(shopId, firebaseConfig).then(function() {
                    return slaveDb.ref(shopId + '/staffs/' + staffId).set(staffData);
                });
            }
            return masterDb.ref().update(updates).then(function() {
                console.log('âœ… registerShop() - POS Ä‘Ã£ Ä‘Æ°á»£c táº¡o:', { shopId: shopId, shopCode: shopCode });
                // XÃ³a dá»¯ liá»‡u local cÅ© trÆ°á»›c khi chuyá»ƒn POS má»›i
                return clearLocalData();
            }).then(function() {
                if (_slaveInitPromise) return _slaveInitPromise;
            }).then(function() {
                // Tá»± Ä‘á»™ng Ä‘Äƒng nháº­p sau khi Ä‘Äƒng kÃ½
                currentUser = {
                    id: staffId,
                    username: adminUser,
                    displayName: adminUser,
                    role: 'admin',
                    shopId: shopId,
                    shopCode: shopCode,
                    shopName: shopName,
                    hasCustomConfig: !!firebaseConfig
                };
                localStorage.setItem('pos_session', JSON.stringify(currentUser));
                setShopId(shopId);
                return currentUser;
            });
        });
    }
    
    // Táº¡o nhÃ¢n viÃªn má»›i (chá»‰ admin)
    function createStaff(staffData) {
        if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'master_admin')) {
            return Promise.reject(new Error('Chá»‰ admin má»›i cÃ³ thá»ƒ táº¡o nhÃ¢n viÃªn'));
        }
        if (!staffData.username || !staffData.password) {
            return Promise.reject(new Error('Vui lÃ²ng nháº­p tÃªn Ä‘Äƒng nháº­p vÃ  máº­t kháº©u'));
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
        
        // Staff ghi vÃ o Master (luÃ´n) vÃ  Slave (náº¿u cÃ³ custom config)
        var ref = masterDb.ref(CURRENT_SHOP_ID + '/staffs/' + staffId);
        return ref.set(data).then(function() {
            // Náº¿u cÃ³ custom Firebase config, ghi staff vÃ o Slave Firebase
            if (slaveDb && slaveConfig) {
                return slaveDb.ref(CURRENT_SHOP_ID + '/staffs/' + staffId).set(data);
            }
        }).then(function() {
            // LÆ°u vÃ o IndexedDB local
            return saveToLocal('staffs', data);
        }).then(function() {
            return data;
        });
    }
    
    // Láº¥y danh sÃ¡ch nhÃ¢n viÃªn
    function getStaffs() {
        // Æ¯u tiÃªn Ä‘á»c tá»« local cache trÆ°á»›c
        return getAll('staffs').then(function(localStaffs) {
            // Náº¿u cÃ³ local cache, tráº£ vá» ngay
            if (localStaffs && localStaffs.length > 0) {
                // Äá»ng thá»i fetch Firebase Äá»ƒ cáº­p nháº­t ná»n (Slave náº¿u cÃ³, Master náº¿u khÃ´ng)
                var _staffRef = masterDb.ref(CURRENT_SHOP_ID + '/staffs');
                _staffRef.once('value').then(function(snapshot) {
                    var data = snapshot.val() || {};
                    for (var key in data) {
                        if (data.hasOwnProperty(key)) {
                            var item = data[key];
                            item.id = key;
                            saveToLocal('staffs', item);
                        }
                    }
                }).catch(function() {
                    // Lá»—i Firebase, bá» qua
                });
                return localStaffs;
            }
            // KhÃ´ng cÃ³ local cache, fetch tá»« Firebase (Slave náº¿u cÃ³, Master náº¿u khÃ´ng)
            var _staffRef = masterDb.ref(CURRENT_SHOP_ID + '/staffs');
            return _staffRef.once('value').then(function(snapshot) {
                var data = snapshot.val() || {};
                var list = [];
                for (var key in data) {
                    if (data.hasOwnProperty(key)) {
                        var item = data[key];
                        item.id = key;
                        list.push(item);
                    }
                }
                // Cáº­p nháº­t local cache
                for (var i = 0; i < list.length; i++) {
                    saveToLocal('staffs', list[i]);
                }
                return list;
            }).catch(function() {
                // Fallback: Ä‘á»c tá»« local
                return getAll('staffs');
            });
        });
    }
    
    // ÄÄƒng xuáº¥t
    function logout() {
        currentUser = null;
        localStorage.removeItem('pos_session');
        localStorage.removeItem(CONFIG_HASH_KEY);
        // Reset vá» shop máº·c Ä‘á»‹nh
        CURRENT_SHOP_ID = 'shop_default';
        localStorage.setItem('current_shop_id', 'shop_default');
        // Há»§y Slave App náº¿u cÃ³
        if (slaveApp) {
            try { slaveApp.delete(); } catch(e) {}
            slaveApp = null;
            slaveDb = null;
            slaveConfig = null;
        }
        console.log('ðŸ‘‹ Logged out');
    }
    
    // Láº¥y thÃ´ng tin user hiá»‡n táº¡i
    function getCurrentUser() {
        return currentUser;
    }
    
    // Kiá»ƒm tra Ä‘Ã£ Ä‘Äƒng nháº­p chÆ°a
    function isLoggedIn() {
        return currentUser !== null;
    }
    
    // Kiá»ƒm tra cÃ³ pháº£i admin khÃ´ng (bao gá»“m master_admin)
    function isAdmin() {
        return currentUser && (currentUser.role === 'admin' || currentUser.role === 'master_admin');
    }

    // Äá»c shop config trá»±c tiáº¿p tá»« Firebase (dÃ¹ng _getDb Ä‘á»ƒ chá»n Master/Slave)
    function getShopConfig() {
        return dbReady.then(function() {
            if (!isOnline) return Promise.resolve({});
            return _getDb('info').ref(CURRENT_SHOP_ID + '/info').once('value').then(function(snapshot) {
                return snapshot.val() || {};
            }).catch(function() {
                return {};
            });
        });
    }

    // OPTIMIZE: getMemoryCache - đọc trực tiếp từ memory cache thay vì IndexedDB
    // Trả về array các items trong collection, hoặc null nếu collection chưa được cache
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

    // ========== MASTER ADMIN: Lấy danh sách tất cả POS đã đăng ký ==========
    // Trả về mảng các shop: { shopCode, shopId, shopName, status, createdAt, hasCustomConfig, adminUsername, adminPassword }
    function getAllShops() {
        return masterDb.ref('shop_registry').once('value').then(function(snapshot) {
            var registry = snapshot.val() || {};
            var shopCodes = Object.keys(registry);
            var promises = shopCodes.map(function(code) {
                return _getShopStaff(code, registry[code]);
            });
            return Promise.all(promises).then(function(shops) {
                // Sắp xếp theo thời gian tạo mới nhất
                shops.sort(function(a, b) { return b.createdAt - a.createdAt; });
                return shops;
            });
        });
    }
    
    // Helper: lấy thông tin staff cho 1 POS (dùng trong getAllShops)
    // Staff LUÔN được đọc từ Master Firebase (posmilano), bất kể POS có custom config hay không
    function _getShopStaff(code, info) {
        return _readStaffFromMaster(code, info);
    }
    
    // Helper: đọc staff từ Master Firebase
    function _readStaffFromMaster(code, info) {
        return masterDb.ref(info.shopId + '/staffs').once('value').then(function(staffSnap) {
            var staffs = staffSnap.val() || {};
            var adminStaff = null;
            for (var key in staffs) {
                if (staffs.hasOwnProperty(key)) {
                    var s = staffs[key];
                    if (s.role === 'admin') {
                        adminStaff = s;
                        adminStaff.id = key;
                        break;
                    }
                }
            }
            return {
                shopCode: code,
                shopId: info.shopId,
                shopName: info.shopName || '',
                status: info.status || 'active',
                createdAt: info.createdAt || 0,
                hasCustomConfig: !!info.hasCustomConfig,
                adminUsername: adminStaff ? adminStaff.username : '',
                adminPassword: adminStaff ? adminStaff.password : ''
            };
        }).catch(function() {
            return {
                shopCode: code,
                shopId: info.shopId,
                shopName: info.shopName || '',
                status: info.status || 'active',
                createdAt: info.createdAt || 0,
                hasCustomConfig: !!info.hasCustomConfig,
                adminUsername: '',
                adminPassword: ''
            };
        });
    }
    // ========== MASTER ADMIN: Cập nhật trạng thái POS (lock/unlock/delete) ==========
    function updateShopStatus(shopCode, newStatus) {
        return masterDb.ref('shop_registry/' + shopCode + '/status').set(newStatus).then(function() {
            return { success: true, shopCode: shopCode, status: newStatus };
        });
    }

    // ========== MASTER ADMIN: Cập nhật thông tin đăng nhập admin của POS ==========
    // Staff LUÔN được ghi vào Master Firebase (posmilano), bất kể POS có custom config hay không
    function updateShopAdmin(shopCode, shopId, newUsername, newPassword) {
        return _updateAdminInMaster(shopId, newUsername, newPassword).then(function() {
            return { success: true, shopCode: shopCode };
        });
    }
    
    // Helper: cập nhật admin trong Master Firebase (dùng cho POS không có custom config hoặc fallback)
    function _updateAdminInMaster(shopId, newUsername, newPassword) {
        return masterDb.ref(shopId + '/staffs').once('value').then(function(snapshot) {
            var staffs = snapshot.val() || {};
            var adminId = null;
            for (var key in staffs) {
                if (staffs.hasOwnProperty(key)) {
                    var s = staffs[key];
                    if (s.role === 'admin') {
                        adminId = key;
                        break;
                    }
                }
            }
            if (!adminId) {
                throw new Error('Không tìm thấy tài khoản admin của POS này');
            }
            
            var updates = {};
            if (newUsername) updates[shopId + '/staffs/' + adminId + '/username'] = newUsername;
            if (newPassword) updates[shopId + '/staffs/' + adminId + '/password'] = newPassword;
            return masterDb.ref().update(updates);
        });
    }

    // ========== ĐỔI MẬT KHẨU CHO ADMIN POS ==========
    // Cho phép admin POS tự đổi mật khẩu, ghi đè lên Master Firebase
    function changePassword(shopId, staffId, newPassword) {
        if (!currentUser) {
            return Promise.reject(new Error('Chưa đăng nhập'));
        }
        if (currentUser.role !== 'admin' && currentUser.role !== 'master_admin') {
            return Promise.reject(new Error('Chỉ admin mới có thể đổi mật khẩu'));
        }
        if (!newPassword || newPassword.length < 4) {
            return Promise.reject(new Error('Mật khẩu mới phải có ít nhất 4 ký tự'));
        }
        
        console.log('🔑 changePassword() - Đổi mật khẩu cho staff:', { shopId: shopId, staffId: staffId });
        
        // Ghi mật khẩu mới vào Master Firebase (luôn ở Master)
        var masterUpdates = {};
        masterUpdates[shopId + '/staffs/' + staffId + '/password'] = newPassword;
        
        return masterDb.ref().update(masterUpdates).then(function() {
            // Nếu có Slave Firebase, ghi đồng bộ sang Slave
            if (slaveDb && slaveConfig) {
                return slaveDb.ref(shopId + '/staffs/' + staffId + '/password').set(newPassword);
            }
        }).then(function() {
            // Cập nhật currentUser trong memory
            if (currentUser) {
                currentUser.password = newPassword;
            }
            // Cập nhật session trong localStorage
            var session = localStorage.getItem('pos_session');
            if (session) {
                try {
                    var sessionData = JSON.parse(session);
                    sessionData.password = newPassword;
                    localStorage.setItem('pos_session', JSON.stringify(sessionData));
                } catch(e) {}
            }
            console.log('✅ changePassword() - Đã đổi mật khẩu thành công');
            return { success: true };
        });
    }

    // ========== MASTER ADMIN: Tạo tài khoản master admin mới ==========
    function createMasterAdmin(username, password, displayName) {
        if (!username || !password) {
            return Promise.reject(new Error('Vui lòng nhập tên đăng nhập và mật khẩu'));
        }
        if (password.length < 4) {
            return Promise.reject(new Error('Mật khẩu phải có ít nhất 4 ký tự'));
        }
        
        console.log('🔑 createMasterAdmin() - Tạo master admin mới:', { username: username });
        
        var adminId = 'master_' + Date.now().toString(36);
        var adminData = {
            id: adminId,
            username: username,
            password: password,
            displayName: displayName || username,
            role: 'master_admin',
            createdAt: Date.now(),
            createdBy: currentUser ? currentUser.id : 'system'
        };
        
        return masterDb.ref('master_admins/' + adminId).set(adminData).then(function() {
            console.log('✅ createMasterAdmin() - Đã tạo master admin:', { adminId: adminId, username: username });
            return adminData;
        });
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
        // OPTIMIZE: getMemoryCache - đọc trực tiếp từ memory cache
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
        clearLocalData: clearLocalData,
        forceSyncFromFirebase: forceSyncFromFirebase,
        ensureCollection: ensureCollection,
        whenSyncComplete: whenSyncComplete,
        batchUpdateSortOrder: batchUpdateSortOrder,
        getShopConfig: getShopConfig,
        // NÂNG CẤP: reconcileSnapshot - đồng bộ hoàn chỉnh 1 master collection
        reconcileSnapshot: reconcileSnapshot,
        // NÂNG CẤP: getDirtyCollections - lấy danh sách collections chưa sync
        getDirtyCollections: function() { return Object.keys(_dirtyCollections); },
        // NÂNG CẤP: Fine Render API - Component Registry (Giai đoạn 3)
        // renderOn(collection, selector, renderFn) - đăng ký component tự động render
        // selector: function(oldData, newData, changeInfo) => true nếu cần render lại
        // Trả về hàm unsubscribe
        renderOn: function(collection, selector, renderFn) {
            return _renderOn(collection, selector, renderFn);
        },
        // MULTI-FIREBASE: Lấy Master DB instance (dùng cho Admin Master)
        getMasterDb: function() { return masterDb; },
        // MULTI-FIREBASE: Lấy Slave DB instance (dùng cho POS có config riêng)
        getSlaveDb: function() { return slaveDb; },
        // MASTER ADMIN: Lấy danh sách tất cả POS + thông tin admin
        getAllShops: getAllShops,
        // MASTER ADMIN: Cập nhật trạng thái POS (lock/unlock/delete)
        updateShopStatus: updateShopStatus,
        // MASTER ADMIN: Cập nhật username/password admin của POS
        updateShopAdmin: updateShopAdmin,
        // MASTER ADMIN: Tạo tài khoản master admin mới
        createMasterAdmin: createMasterAdmin,
        // ĐỔI MẬT KHẨU: Admin POS tự đổi mật khẩu
        changePassword: changePassword
    };
})();












