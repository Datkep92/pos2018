// ========== db.js ES5 - TÆ°Æ¡ng thÃ­ch Android 6, iOS 16 ==========
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
        apiKey: "AIzaSyCQFIzj8m3kpsE_x354xxJ8MTAuRG9eCx4",
        authDomain: "posmilano.firebaseapp.com",
        projectId: "posmilano",
        databaseURL: "https://posmilano-default-rtdb.firebaseio.com",
        storageBucket: "posmilano.firebasestorage.app",
        messagingSenderId: "34185947554",
        appId: "1:34185947554:web:925f29864d3b17b8d46afb",
        measurementId: "G-J3MX8EL1C8"
    };
    firebase.initializeApp(firebaseConfig);
    var db = firebase.database();
    var auth = firebase.auth();

    // Constants
    var STORE_NAME = 'pos_data';
    // Äá»c shopId tá»« localStorage, máº·c Ä‘á»‹nh 'shop_default' náº¿u chÆ°a cÃ³
    var CURRENT_SHOP_ID = localStorage.getItem('current_shop_id') || 'shop_default';
    var CURRENT_DEVICE_ID = localStorage.getItem('device_id') || ('device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    localStorage.setItem('device_id', CURRENT_DEVICE_ID);
    
    // Biáº¿n lÆ°u thÃ´ng tin user hiá»‡n táº¡i
    var currentUser = null;
    // Äá»c session tá»« localStorage náº¿u cÃ³
    var savedSession = localStorage.getItem('pos_session');
    if (savedSession) {
        try { currentUser = JSON.parse(savedSession); } catch(e) { localStorage.removeItem('pos_session'); }
    }

    var localDB = null;
    var dbReady = null;
    var syncQueue = [];
    var isOnline = navigator.onLine;
    var listeners = {};
    
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
    
    // OPTIMIZE: CÆ¡ cháº¿ suppress realtime notifications khi batch operations
    // Khi _suppressRealtime > 0, _notifyLocal sáº½ khÃ´ng gá»i callbacks
    // DÃ¹ng cho thanh toÃ¡n, nháº­p hÃ ng loáº¡t, etc.
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
    function _notifyLocal(collection) {
        // OPTIMIZE: Náº¿u Ä‘ang suppress, ghi nháº­n collection cáº§n notify sau
        if (_suppressRealtime > 0) {
            _pendingNotifyCollections[collection] = true;
            return;
        }
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
    function saveToLocal(collection, data) {
        return dbReady.then(function() {
            if (!localDB) throw new Error('DB not ready');
            if (!localDB.objectStoreNames.contains(collection)) throw new Error('Store ' + collection + ' not found');
            // Cáº­p nháº­t memory cache ngay láº­p tá»©c (dÃ¹ng normalized data Ä‘á»ƒ cÃ³ dateKey, dateTypeKey)
            if (!memoryCache[collection]) memoryCache[collection] = {};
            memoryCache[collection][data.id] = normalizeIndexedFields(collection, data);
            cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
            // FIX: Notify local subscribers ngay, khÃ´ng chá» Firebase
            _notifyLocal(collection);
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
        return dbReady.then(function() {
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
        return dbReady.then(function() {
            if (!localDB) return;
            if (!localDB.objectStoreNames.contains(collection)) return;
            // XÃ³a khá»i memory cache ngay
            if (memoryCache[collection]) {
                delete memoryCache[collection][id];
                cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
            }
            // FIX: Notify local subscribers ngay, khÃ´ng chá» Firebase
            _notifyLocal(collection);
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
            status: 'pending'
        };
        syncQueue.push(item);
        saveToLocal('sync_queue', item);
        if (isOnline) processSyncQueue();
        return item.id;
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
    function _batchSyncToFirebase(items) {
        if (items.length === 0) return Promise.resolve();
        var collection = items[0].collection;
        var action = items[0].action;
        var ref = db.ref(CURRENT_SHOP_ID + '/' + collection);
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
        });
    }
    
    // FIX: Retry limit + exponential backoff + lưu retryCount vào IndexedDB
    function _handleSyncError(item, err) {
        item.retryCount = (item.retryCount || 0) + 1;
        var MAX_RETRY = 5;
        if (item.retryCount < MAX_RETRY) {
            item.status = 'pending';
            // Lưu retryCount vào IndexedDB để không bị mất khi reload
            return saveToLocal('sync_queue', item).then(function() {
                var delay = Math.min(2000 * Math.pow(2, item.retryCount - 1), 30000); // exponential backoff, max 30s
                return new Promise(function(r) { setTimeout(r, delay); });
            }).then(function() {
                // Gọi lại processSyncQueue thay vì syncToFirebase trực tiếp
                // để tận dụng batch mechanism
                return processSyncQueue();
            });
        } else {
            item.status = 'failed';
            console.error('Sync failed after ' + MAX_RETRY + ' retries:', item.action, item.collection, item.targetId);
            return saveToLocal('sync_queue', item);
        }
    }

    function syncToFirebase(item) {
        var ref = db.ref(CURRENT_SHOP_ID + '/' + item.collection + '/' + item.targetId);
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
                        db.ref().update(updates).catch(function(err) {
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
            // OPTIMIZE: Memory cache - trÃ¡nh Ä‘á»c IndexedDB
            if (memoryCache.transactions) {
                var allTx = [];
                for (var key in memoryCache.transactions) {
                    if (memoryCache.transactions.hasOwnProperty(key)) {
                        allTx.push(memoryCache.transactions[key]);
                    }
                }
                // FIX: Tá»± Ä‘á»™ng sá»­a dateKey cho dá»¯ liá»‡u cÅ© bá»‹ sai UTC
                for (var i = 0; i < allTx.length; i++) {
                    _fixDateKeyIfNeeded(allTx[i]);
                }
                var filtered = allTx.filter(function(t) { return t.dateKey === dateKey; });
                if (type !== 'all') filtered = filtered.filter(function(t) { return t.type === type; });
                return filtered;
            }
            return new Promise(function(resolve, reject) {
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
                    // FIX: Tá»± Ä‘á»™ng sá»­a dateKey cho dá»¯ liá»‡u cÅ© bá»‹ sai UTC
                    for (var i = 0; i < rows.length; i++) {
                        _fixDateKeyIfNeeded(rows[i]);
                    }
                    // FIX: Load vÃ o memoryCache Ä‘á»ƒ láº§n sau khÃ´ng pháº£i Ä‘á»c IndexedDB
                    if (!memoryCache.transactions) memoryCache.transactions = {};
                    for (var i = 0; i < rows.length; i++) {
                        memoryCache.transactions[rows[i].id] = rows[i];
                    }
                    resolve(rows);
                };
                req.onerror = function() { reject(req.error); };
            });
        });
    }

    function getTransactionsByDateRange(startDateKey, endDateKey, options) {
        options = options || {};
        var type = options.type || 'all';
        return dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains('transactions')) return [];
            // Ưu tiên memory cache
            if (memoryCache.transactions) {
                var allTx = [];
                for (var key in memoryCache.transactions) {
                    if (memoryCache.transactions.hasOwnProperty(key)) {
                        allTx.push(memoryCache.transactions[key]);
                    }
                }
                // FIX: Tá»± Ä‘á»™ng sá»­a dateKey cho dá»¯ liá»‡u cÅ© bá»‹ sai UTC
                for (var i = 0; i < allTx.length; i++) {
                    _fixDateKeyIfNeeded(allTx[i]);
                }
                var filtered = allTx.filter(function(t) {
                    return t.dateKey >= startDateKey && t.dateKey <= endDateKey;
                });
                if (type !== 'all') filtered = filtered.filter(function(t) { return t.type === type; });
                return filtered;
            }
            // Fallback: đọc từ IndexedDB theo dateKey index
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction(['transactions'], 'readonly');
                var store = tx.objectStore('transactions');
                var req;
                if (store.indexNames.contains('dateKey')) {
                    // Lấy tất cả transactions và filter trong memory
                    req = store.index('dateKey').getAll();
                } else {
                    req = store.getAll();
                }
                req.onsuccess = function() {
                    var rows = req.result || [];
                    // FIX: Tá»± Ä‘á»™ng sá»­a dateKey cho dá»¯ liá»‡u cÅ© bá»‹ sai UTC
                    for (var i = 0; i < rows.length; i++) {
                        _fixDateKeyIfNeeded(rows[i]);
                    }
                    var filtered = rows.filter(function(r) {
                        var dk = toDateKey(r.date);
                        return dk >= startDateKey && dk <= endDateKey;
                    });
                    if (type !== 'all') filtered = filtered.filter(function(r) { return r.type === type; });
                    // FIX: Load vÃ o memoryCache Ä‘á»ƒ láº§n sau khÃ´ng pháº£i Ä‘á»c IndexedDB
                    if (!memoryCache.transactions) memoryCache.transactions = {};
                    for (var i = 0; i < rows.length; i++) {
                        memoryCache.transactions[rows[i].id] = rows[i];
                    }
                    resolve(filtered);
                };
                req.onerror = function() { reject(req.error); };
            });
        });
    }

   function subscribeToCollection(collection, callback) {
    // FIX: ÄÄƒng kÃ½ local callback Ä‘á»ƒ UI nháº­n notify ngay sau ghi local
    if (callback) {
        if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
        _localCallbacks[collection].push(callback);
    }
    
    var ref = db.ref(CURRENT_SHOP_ID + '/' + collection);
    
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
        
        // FIX: Chá»‘ng trÃ¹ng transaction tá»« Firebase realtime
        // Náº¿u transaction nÃ y Ä‘Ã£ tá»“n táº¡i trong local (do chÃ­nh mÃ¡y nÃ y táº¡o khi offline),
        // thÃ¬ khÃ´ng ghi Ä‘Ã¨ - giá»¯ nguyÃªn báº£n local (cÃ³ _idempotencyKey vÃ  _version Ä‘áº§y Ä‘á»§)
        if (collection === 'transactions' && memoryCache.transactions && memoryCache.transactions[key]) {
            var localTx = memoryCache.transactions[key];
            // Náº¿u local cÃ³ _version >= 1 vÃ  _syncedAt chÆ°a cÃ³, nghÄ©a lÃ  local chÆ°a sync
            // Giá»¯ nguyÃªn báº£n local, khÃ´ng ghi Ä‘Ã¨ báº±ng Firebase data
            if (localTx._version >= 1 && !localTx._syncedAt) {
                console.log('â­ï¸ Skip Firebase overwrite for pending local transaction:', key);
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
                            console.warn('âš ï¸ Detected duplicate transaction from another device:', key, 'duplicates', ck);
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
    // Network listener
    function initNetwork() {
        window.addEventListener('online', function() {
            isOnline = true;
            showToast('ðŸ“¡ ÄÃ£ káº¿t ná»‘i máº¡ng', 'success');
            processSyncQueue();
        });
        window.addEventListener('offline', function() {
            isOnline = false;
            showToast('âš ï¸ Máº¥t káº¿t ná»‘i', 'warning');
        });
        isOnline = navigator.onLine;
    }

    // Historical sync (simplified, only if needed)
    function syncHistorical() {
        return Promise.resolve(); // bá» qua historical sync cho gá»n, váº«n realtime
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
    'delete_logs'
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
    function seedDefaultShop() {
        return db.ref('shop_registry/123123').once('value').then(function(snapshot) {
            if (snapshot.exists()) return; // ÄÃ£ cÃ³ rá»“i, khÃ´ng cáº§n seed
            
            console.log('ðŸŒ± Seeding default shop data...');
            var staffId = 'staff_admin_' + Date.now().toString(36);
            var updates = {};
            
            // Táº¡o shop_registry cho mÃ£ 123123 -> shop_default
            updates['shop_registry/123123'] = {
                shopId: 'shop_default',
                shopName: 'MILANO COFFEE 259',
                shopCode: '123123',
                createdAt: Date.now()
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
                name: 'MILANO COFFEE 259',
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
            
            return db.ref().update(updates).then(function() {
                console.log('âœ… Default shop seeded: mÃ£ 123123, user admin123123, pass 123123');
            });
        }).catch(function(err) {
            console.error('Seed error:', err);
        });
    }

    // Tá»± Ä‘á»™ng táº¡o config fields cho shop hiá»‡n táº¡i náº¿u chÆ°a cÃ³
    function ensureShopConfig() {
        // Äáº£m báº£o cÃ¡c config fields tá»“n táº¡i trong /info
        return db.ref(CURRENT_SHOP_ID + '/info').once('value').then(function(snapshot) {
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
                return db.ref(CURRENT_SHOP_ID + '/info').update(updates).then(function() {
                    console.log('âœ… Shop config fields created');
                });
            }
        }).catch(function(err) {
            console.error('âš ï¸ ensureShopConfig error:', err);
        });
    }

    // ========== FORCE SYNC Tá»ª FIREBASE ==========
    // DÃ¹ng khi phÃ¡t hiá»‡n IndexedDB bá»‹ xÃ³a (local rá»—ng) - force táº£i láº¡i tá»« Firebase
    function forceSyncFromFirebase() {
        if (!isOnline) {
            console.warn('âš ï¸ Offline, cannot force sync from Firebase');
            return Promise.reject(new Error('Offline'));
        }
        var collections = [
            'tables', 'customers', 'menu', 'menu_categories',
            'ingredients', 'transactions', 'reports',
            'cost_categories', 'cost_transactions', 'cost_transactions_admin',
            'admin_cost_categories', 'daily_balances',
            'inventory_transactions', 'manager_cash_pickups',
            'ingredient_transactions', 'notifications',
            'info',
            'messages'
        ];
        
        console.log('ðŸ”„ Force syncing all collections from Firebase...');
        
        var chain = Promise.resolve();
        for (var c = 0; c < collections.length; c++) {
            chain = chain.then((function(collection) {
                return function() {
                    return _forceSyncCollection(collection);
                };
            })(collections[c]));
        }
        
        return chain.then(function() {
            console.log('âœ… Force sync completed');
        });
    }
    
    function _forceSyncCollection(collection) {
        return new Promise(function(resolve, reject) {
            var ref = db.ref(CURRENT_SHOP_ID + '/' + collection);
            ref.once('value', function(snapshot) {
                var remote = snapshot.val() || {};
                var count = 0;
                
                // XÃ³a toÃ n bá»™ local cache trÆ°á»›c
                if (memoryCache[collection]) {
                    memoryCache[collection] = {};
                }
                
                // FIX: Collection 'info' lÃ  special - gá»™p toÃ n bá»™ object thÃ nh 1 item
                if (collection === 'info') {
                    var infoItem = { id: 'shop_config' };
                    for (var pk in remote) {
                        if (remote.hasOwnProperty(pk)) {
                            infoItem[pk] = remote[pk];
                        }
                    }
                    if (infoItem._version === undefined) infoItem._version = 1;
                    saveToLocal(collection, infoItem).then(function() {
                        console.log('  ðŸ“¥ Synced info: 1 item (shop_config)');
                        resolve();
                    }).catch(function(err) {
                        console.error('  âŒ Error syncing info: ', err);
                        resolve();
                    });
                    return;
                }
                
                // Ghi tá»«ng item tá»« Firebase vÃ o local
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
                                // Äáº£m báº£o _version tá»“n táº¡i
                                if (item._version === undefined) item._version = 1;
                                count++;
                                return saveToLocal(collection, item);
                            });
                        })(key);
                    }
                }
                
                saveChain.then(function() {
                    console.log('  ðŸ“¥ Synced ' + collection + ': ' + count + ' items');
                    resolve();
                }).catch(function(err) {
                    console.error('  âŒ Error syncing ' + collection + ': ', err);
                    resolve(); // KhÃ´ng reject Ä‘á»ƒ tiáº¿p tá»¥c collection khÃ¡c
                });
            }, function(err) {
                console.error('  âŒ Firebase read error for ' + collection + ': ', err);
                resolve(); // KhÃ´ng reject Ä‘á»ƒ tiáº¿p tá»¥c collection khÃ¡c
            });
        });
    }

    // Init Database
    function initDatabase() {
        return initLocalDB().then(function() {
            initNetwork();
            if (isOnline) return syncHistorical();
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
            subscribeToCollection('tables');
            subscribeToCollection('customers');
            subscribeToCollection('menu');
            subscribeToCollection('menu_categories');
            subscribeToCollection('transactions');
            subscribeToCollection('notifications');
            subscribeToCollection('info');
            subscribeToCollection('messages');
            subscribeToCollection('daily_balances');
            subscribeToCollection('ingredients');
            console.log('âœ… Database ready, device:', CURRENT_DEVICE_ID);
            return { isOnline: isOnline, deviceId: CURRENT_DEVICE_ID };
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
    
    // XÃ³a toÃ n bá»™ dá»¯ liá»‡u local (IndexedDB + memory cache) khi chuyá»ƒn POS
    function clearLocalData() {
        // XÃ³a memory cache
        memoryCache = {};
        cacheVersion = {};
        
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
    
    // Äá»•i shopId (khi Ä‘Äƒng nháº­p vÃ o POS khÃ¡c)
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
    
    // ÄÄƒng nháº­p: kiá»ƒm tra shopCode -> láº¥y shopId -> verify staff credentials
    function login(shopCode, username, password) {
        if (!shopCode || !username || !password) {
            return Promise.reject(new Error('Vui lÃ²ng nháº­p Ä‘áº§y Ä‘á»§ thÃ´ng tin'));
        }
        // Tra cá»©u shopCode trong shop_registry
        return db.ref('shop_registry/' + shopCode).once('value').then(function(snapshot) {
            if (!snapshot.exists()) {
                throw new Error('MÃ£ POS khÃ´ng tá»“n táº¡i');
            }
            var shopInfo = snapshot.val();
            var shopId = shopInfo.shopId;
            
            // Kiá»ƒm tra staff credentials trong shops/{shopId}/staffs
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
                    throw new Error('Sai tÃªn Ä‘Äƒng nháº­p hoáº·c máº­t kháº©u');
                }
                
                // XÃ³a dá»¯ liá»‡u local cÅ© trÆ°á»›c khi chuyá»ƒn POS
                return clearLocalData().then(function() {
                    // LÆ°u session
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
                    
                    // Cáº­p nháº­t shopId
                    setShopId(shopId);
                    
                    return currentUser;
                });
            });
        });
    }
    
    // ÄÄƒng kÃ½ POS má»›i (táº¡o shop + admin)
    function registerShop(shopName, shopCode, adminUser, adminPass) {
        if (!shopName || !shopCode || !adminUser || !adminPass) {
            return Promise.reject(new Error('Vui lÃ²ng nháº­p Ä‘áº§y Ä‘á»§ thÃ´ng tin'));
        }
        if (shopCode.length < 3) {
            return Promise.reject(new Error('MÃ£ POS pháº£i cÃ³ Ã­t nháº¥t 3 kÃ½ tá»±'));
        }
        if (adminPass.length < 4) {
            return Promise.reject(new Error('Máº­t kháº©u pháº£i cÃ³ Ã­t nháº¥t 4 kÃ½ tá»±'));
        }
        
        // Kiá»ƒm tra shopCode Ä‘Ã£ tá»“n táº¡i chÆ°a
        return db.ref('shop_registry/' + shopCode).once('value').then(function(snapshot) {
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
                // XÃ³a dá»¯ liá»‡u local cÅ© trÆ°á»›c khi chuyá»ƒn POS má»›i
                return clearLocalData();
            }).then(function() {
                // Tá»± Ä‘á»™ng Ä‘Äƒng nháº­p sau khi Ä‘Äƒng kÃ½
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
    
    // Táº¡o nhÃ¢n viÃªn má»›i (chá»‰ admin)
    function createStaff(staffData) {
        if (!currentUser || currentUser.role !== 'admin') {
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
        
        var ref = db.ref(CURRENT_SHOP_ID + '/staffs/' + staffId);
        return ref.set(data).then(function() {
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
                // Ä&#x2018;á»“ng thá»i fetch Firebase Ä‘á»ƒ cáº­p nháº­t ná»n
                db.ref(CURRENT_SHOP_ID + '/staffs').once('value').then(function(snapshot) {
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
            // KhÃ´ng cÃ³ local cache, fetch tá»« Firebase
            return db.ref(CURRENT_SHOP_ID + '/staffs').once('value').then(function(snapshot) {
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
        // Reset vá» shop máº·c Ä‘á»‹nh
        CURRENT_SHOP_ID = 'shop_default';
        localStorage.setItem('current_shop_id', 'shop_default');
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
    
    // Kiá»ƒm tra cÃ³ pháº£i admin khÃ´ng
    function isAdmin() {
        return currentUser && currentUser.role === 'admin';
    }

    // Äá»c shop config trá»±c tiáº¿p tá»« Firebase
    function getShopConfig() {
        return dbReady.then(function() {
            if (!isOnline) return Promise.resolve({});
            return db.ref(CURRENT_SHOP_ID + '/info').once('value').then(function(snapshot) {
                return snapshot.val() || {};
            }).catch(function() {
                return {};
            });
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
        isOnline: function() { return isOnline; },
        getDeviceId: function() { return CURRENT_DEVICE_ID; },
        processSyncQueue: processSyncQueue,
        getSyncQueue: function() { return syncQueue; },
        // OPTIMIZE: Suppress realtime notifications cho batch operations
        suppressRealtime: function() { _setSuppressRealtime(true); },
        flushRealtime: function() { _setSuppressRealtime(false); },
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
        batchUpdateSortOrder: batchUpdateSortOrder,
        getShopConfig: getShopConfig
    };
})();





