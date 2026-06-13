// ========== db.js ES5 - Tương thích Android 6, iOS 16 ==========
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
    // Đọc shopId từ localStorage, mặc định 'shop_default' nếu chưa có
    var CURRENT_SHOP_ID = localStorage.getItem('current_shop_id') || 'shop_default';
    var CURRENT_DEVICE_ID = localStorage.getItem('device_id') || ('device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    localStorage.setItem('device_id', CURRENT_DEVICE_ID);
    
    // Biến lưu thông tin user hiện tại
    var currentUser = null;
    // Đọc session từ localStorage nếu có
    var savedSession = localStorage.getItem('pos_session');
    if (savedSession) {
        try { currentUser = JSON.parse(savedSession); } catch(e) { localStorage.removeItem('pos_session'); }
    }

    var localDB = null;
    var dbReady = null;
    var syncQueue = [];
    var isOnline = navigator.onLine;
    var listeners = {};
    
    // OPTIMIZE: Debounce processSyncQueue - tránh gọi sync sau mỗi DB.update riêng lẻ
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
    
    // OPTIMIZE: Memory cache layer - tránh đọc IndexedDB liên tục
    var memoryCache = {};
    var cacheVersion = {};
    
    // FIX: Local callbacks - notify UI ngay sau khi ghi local, không chờ Firebase
    var _localCallbacks = {};
    
    // OPTIMIZE: Cơ chế suppress realtime notifications khi batch operations
    // Khi _suppressRealtime > 0, _notifyLocal sẽ không gọi callbacks
    // Dùng cho thanh toán, nhập hàng loạt, etc.
    var _suppressRealtime = 0;
    var _pendingNotifyCollections = {};

    // Helper: toDateKey - dùng giờ địa phương (getFullYear/getMonth/getDate) thay vì UTC
    function toDateKey(value) {
        if (!value) return '';
        if (typeof value === 'string') {
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

    // FIX: Notify local subscribers ngay lập tức từ memoryCache
    function _notifyLocal(collection) {
        // OPTIMIZE: Nếu đang suppress, ghi nhận collection cần notify sau
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
    
    // OPTIMIZE: Bật/tắt suppress realtime notifications
    // Dùng cho batch operations (thanh toán, nhập hàng loạt)
    function _setSuppressRealtime(suppress) {
        if (suppress) {
            _suppressRealtime++;
        } else {
            _suppressRealtime--;
            if (_suppressRealtime <= 0) {
                _suppressRealtime = 0;
                // Flush tất cả các collection đang pending
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
            // Cập nhật memory cache ngay lập tức
            if (!memoryCache[collection]) memoryCache[collection] = {};
            memoryCache[collection][data.id] = data;
            cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
            // FIX: Notify local subscribers ngay, không chờ Firebase
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
            
            // OPTIMIZE: Memory cache - tránh đọc IndexedDB liên tục
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
            // Xóa khỏi memory cache ngay
            if (memoryCache[collection]) {
                delete memoryCache[collection][id];
                cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
            }
            // FIX: Notify local subscribers ngay, không chờ Firebase
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
        
        // OPTIMIZE: Batch các items cùng collection thành 1 Firebase update
        // Gom các pending items theo collection để batch
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
                        // Chỉ 1 item - sync bình thường
                        var item = batchItems[0];
                        return syncToFirebase(item).then(function() {
                            return _markItemSynced(item);
                        }).catch(function(err) {
                            return _handleSyncError(item, err);
                        });
                    } else {
                        // Nhiều items cùng collection - batch thành 1 Firebase update
                        return _batchSyncToFirebase(batchItems).then(function() {
                            var chain2 = Promise.resolve();
                            for (var j = 0; j < batchItems.length; j++) {
                                chain2 = chain2.then((function(item) {
                                    return function() { return _markItemSynced(item); };
                                })(batchItems[j]));
                            }
                            return chain2;
                        }).catch(function(err) {
                            // Fallback: sync từng cái nếu batch fail
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
    
    // OPTIMIZE: Batch sync nhiều items cùng collection lên Firebase trong 1 lần
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
            console.log('✅ Synced:', item.action, item.collection, item.targetId);
        });
    }
    
    function _handleSyncError(item, err) {
        item.retryCount++;
        if (item.retryCount < 5) {
            item.status = 'pending';
            return new Promise(function(r) { setTimeout(r, 2000 * item.retryCount); }).then(function() {
                return syncToFirebase(item).then(function() {
                    item.status = 'synced';
                    return deleteFromLocal('sync_queue', item.id);
                }).catch(function() {});
            });
        } else {
            item.status = 'failed';
            console.error('Sync failed:', item.action, item.collection, item.targetId);
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

    // FIX: Tạo idempotency key cho transaction để chống trùng khi đồng bộ offline
    // Kết hợp: deviceId + timestamp (giây) + tableId + amount
    function _generateIdempotencyKey(collection, data) {
        if (collection !== 'transactions') return null;
        // Dùng tableId + amount + paymentMethod + timestamp (độ phân giải giây)
        var ts = Math.floor(Date.now() / 1000);
        var tableKey = data.tableId || data.tableName || 'unknown';
        var amt = Math.round(data.amount || 0);
        var method = data.paymentMethod || 'unknown';
        return CURRENT_DEVICE_ID + '|' + ts + '|' + tableKey + '|' + amt + '|' + method;
    }

    // FIX: Kiểm tra transaction trùng trong memory cache trước khi tạo
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
                // Kiểm tra thời gian - nếu trong vòng 30 giây thì coi là trùng
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
        // FIX: Chống trùng transaction - kiểm tra trước khi tạo
        if (collection === 'transactions' && _isDuplicateTransaction(data)) {
            console.warn('⚠️ Duplicate transaction detected, skipping:', data.tableName, data.amount);
            return Promise.resolve(null);
        }
        var id = customId || data.id || generateId();
        var newData = { id: id };
        for (var k in data) if (data.hasOwnProperty(k) && k !== 'id') newData[k] = data[k];
        newData.createdAt = Date.now();
        newData.createdBy = CURRENT_DEVICE_ID;
        newData.updatedAt = Date.now();
        newData._version = 1;
        // FIX: Lưu idempotency key để kiểm tra khi nhận Firebase event
        if (collection === 'transactions') {
            newData._idempotencyKey = _generateIdempotencyKey(collection, data);
        }
        return saveToLocal(collection, newData).then(function() {
            addToSyncQueue('create', collection, newData, id);
            // OPTIMIZE: Debounce sync - gom nhiều operations vào 1 lần sync
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
                // OPTIMIZE: Debounce sync - gom nhiều operations vào 1 lần sync
                if (isOnline) _debouncedProcessSyncQueue();
                return Promise.resolve();
            }).then(function() { return updated; });
        });
    }

    // Batch update sortOrder - ghi vào IndexedDB + Firebase 1 lần duy nhất, ko qua sync queue
    // @param {string} collection - Tên collection ('menu' hoặc 'menu_categories'), mặc định 'menu'
    function batchUpdateSortOrder(items, collection) {
        collection = collection || 'menu';
        return dbReady.then(function() {
            if (!localDB) throw new Error('DB not ready');
            var tx = localDB.transaction([collection], 'readwrite');
            var store = tx.objectStore(collection);
            var now = Date.now();
            
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                // Cập nhật memory cache - CHỈ sửa sortOrder, giữ nguyên các field khác
                if (!memoryCache[collection]) memoryCache[collection] = {};
                if (memoryCache[collection][item.id]) {
                    memoryCache[collection][item.id].sortOrder = item.sortOrder;
                }
                // Ghi vào IndexedDB - CHỈ cập nhật sortOrder, ko ghi đè toàn bộ
                // Dùng store.put với toàn bộ data cũ + sortOrder mới
                var fullData = memoryCache[collection][item.id];
                if (fullData) {
                    fullData.sortOrder = item.sortOrder;
                    fullData.updatedAt = now;
                    store.put(normalizeIndexedFields(collection, fullData));
                }
            }
            
            return new Promise(function(resolve, reject) {
                tx.oncomplete = function() {
                    // Sync 1 batch lên Firebase - CHỈ ghi đúng field sortOrder, ko tạo node lạ
                    if (isOnline && CURRENT_SHOP_ID) {
                        var updates = {};
                        var firebasePath = (collection === 'menu_categories') ? 'menu_categories' : 'menu';
                        for (var i = 0; i < items.length; i++) {
                            var key = CURRENT_SHOP_ID + '/' + firebasePath + '/' + items[i].id + '/sortOrder';
                            updates[key] = items[i].sortOrder;
                        }
                        db.ref().update(updates).catch(function(err) {
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
            // OPTIMIZE: Debounce sync - gom nhiều operations vào 1 lần sync
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

    function getTransactionsByDate(dateKey, options) {
        options = options || {};
        var type = options.type || 'all';
        return dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains('transactions')) return [];
            // OPTIMIZE: Memory cache - tránh đọc IndexedDB
            if (memoryCache.transactions) {
                var allTx = [];
                for (var key in memoryCache.transactions) {
                    if (memoryCache.transactions.hasOwnProperty(key)) {
                        allTx.push(memoryCache.transactions[key]);
                    }
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
                    resolve(rows);
                };
                req.onerror = function() { reject(req.error); };
            });
        });
    }

   function subscribeToCollection(collection, callback) {
    // FIX: Đăng ký local callback để UI nhận notify ngay sau ghi local
    if (callback) {
        if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
        _localCallbacks[collection].push(callback);
    }
    
    var ref = db.ref(CURRENT_SHOP_ID + '/' + collection);
    // P0: Tất cả collections đều dùng child_* events thay vì on('value')
    // transactions/reports đã dùng child_* từ trước, giờ mở rộng cho tất cả
    var updateScheduled = false;
    var emitUpdate = function() {
        if (updateScheduled) return;
        updateScheduled = true;
        setTimeout(function() {
            updateScheduled = false;
            loadFromLocal(collection).then(function(localData) {
                // FIX: Firebase callback - gọi sau local callback, tránh trùng
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
        
        // FIX: Chống trùng transaction từ Firebase realtime
        // Nếu transaction này đã tồn tại trong local (do chính máy này tạo khi offline),
        // thì không ghi đè - giữ nguyên bản local (có _idempotencyKey và _version đầy đủ)
        if (collection === 'transactions' && memoryCache.transactions && memoryCache.transactions[key]) {
            var localTx = memoryCache.transactions[key];
            // Nếu local có _version >= 1 và _syncedAt chưa có, nghĩa là local chưa sync
            // Giữ nguyên bản local, không ghi đè bằng Firebase data
            if (localTx._version >= 1 && !localTx._syncedAt) {
                console.log('⏭️ Skip Firebase overwrite for pending local transaction:', key);
                return;
            }
        }
        
        // FIX: Kiểm tra idempotency - nếu transaction từ máy khác có cùng table+amount+method
        // trong khoảng thời gian ngắn, kiểm tra xem có phải trùng không
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
                            // Transaction từ máy khác trùng với local - đánh dấu refunded để ẩn
                            console.warn('⚠️ Detected duplicate transaction from another device:', key, 'duplicates', ck);
                            item.refunded = true;
                            item.note = (item.note || '') + ' [Tự động đánh dấu trùng lặp]';
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
            showToast('📡 Đã kết nối mạng', 'success');
            processSyncQueue();
        });
        window.addEventListener('offline', function() {
            isOnline = false;
            showToast('⚠️ Mất kết nối', 'warning');
        });
        isOnline = navigator.onLine;
    }

    // Historical sync (simplified, only if needed)
    function syncHistorical() {
        return Promise.resolve(); // bỏ qua historical sync cho gọn, vẫn realtime
    }

    // Init IndexedDB
    function initLocalDB() {
        if (dbReady) return dbReady;
        dbReady = new Promise(function(resolve, reject) {
            var request = indexedDB.open(STORE_NAME, 16);
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
    'info'
];
                for (var i = 0; i < stores.length; i++) {
                    if (!db.objectStoreNames.contains(stores[i])) {
                        db.createObjectStore(stores[i], { keyPath: 'id' });
                        console.log('Created store:', stores[i]);
                    }
                }
                // FIX: Kiểm tra transaction tồn tại trước khi tạo index
                // Tránh lỗi khi database vừa được tạo mới (sau khi xóa)
                try {
                    var tx = e.target.transaction;
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

    // Seed dữ liệu cho POS mặc định (shop_default) nếu chưa có shop_registry
    function seedDefaultShop() {
        return db.ref('shop_registry/123123').once('value').then(function(snapshot) {
            if (snapshot.exists()) return; // Đã có rồi, không cần seed
            
            console.log('🌱 Seeding default shop data...');
            var staffId = 'staff_admin_' + Date.now().toString(36);
            var updates = {};
            
            // Tạo shop_registry cho mã 123123 -> shop_default
            updates['shop_registry/123123'] = {
                shopId: 'shop_default',
                shopName: 'MILANO COFFEE 259',
                shopCode: '123123',
                createdAt: Date.now()
            };
            
            // Tạo staff admin cho shop_default
            updates['shop_default/staffs/' + staffId] = {
                id: staffId,
                username: 'admin123123',
                password: '123123',
                displayName: 'Admin',
                role: 'admin',
                createdAt: Date.now(),
                createdBy: 'system'
            };
            
            updates['shop_default/info/shop_config'] = {
                id: 'shop_config',
                name: 'MILANO COFFEE 259',
                code: '123123',
                createdAt: Date.now(),
                // Telegram config
                telegramBotToken: '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                telegramChatId: '6372876364',
                // Lock password cho hoàn tác
                lockPassword: '28122020',
                // Khung giờ khóa toàn bộ bàn
                lockStartHour: 17,
                lockEndHour: 5,
                lockEndMinute: 30,
                // Thời gian ngồi tối đa trước khi khóa bàn (giờ)
                tableLockHours: 5
            };
            
            return db.ref().update(updates).then(function() {
                console.log('✅ Default shop seeded: mã 123123, user admin123123, pass 123123');
            });
        }).catch(function(err) {
            console.error('Seed error:', err);
        });
    }

    // Tự động tạo config fields cho shop hiện tại nếu chưa có
    function ensureShopConfig() {
        // Bước 1: Kiểm tra dữ liệu cũ ở /info (dạng flat) để migrate
        var migratePromise = db.ref(CURRENT_SHOP_ID + '/info').once('value').then(function(oldSnapshot) {
            var oldVal = oldSnapshot.val();
            // Nếu /info tồn tại và có dữ liệu flat (không phải dạng { shop_config: {...} })
            if (oldVal && typeof oldVal === 'object' && !oldVal.shop_config) {
                // Kiểm tra xem có phải dữ liệu cũ dạng flat không (có id: 'shop_config' hoặc có lockStartHour)
                if (oldVal.id === 'shop_config' || oldVal.lockStartHour !== undefined) {
                    console.log('🔄 Migrating old flat /info data to /info/shop_config...');
                    // Ghi vào /info/shop_config
                    return db.ref(CURRENT_SHOP_ID + '/info/shop_config').set(oldVal).then(function() {
                        // Xóa dữ liệu cũ ở /info (chỉ xóa các field flat, giữ nguyên nếu có child khác)
                        var cleanUpdates = {};
                        for (var k in oldVal) {
                            if (oldVal.hasOwnProperty(k)) {
                                cleanUpdates[k] = null;
                            }
                        }
                        return db.ref(CURRENT_SHOP_ID + '/info').update(cleanUpdates).then(function() {
                            console.log('✅ Migrated old flat /info data to /info/shop_config');
                        });
                    });
                }
            }
        }).catch(function(err) {
            console.error('⚠️ ensureShopConfig migrate check error:', err);
        });
        
        // Bước 2: Đảm bảo các config fields tồn tại trong /info/shop_config
        return migratePromise.then(function() {
            return db.ref(CURRENT_SHOP_ID + '/info/shop_config').once('value').then(function(snapshot) {
                var info = snapshot.val() || {};
                var needsUpdate = false;
                var defaults = {
                    id: 'shop_config',
                    telegramBotToken: '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                    telegramChatId: '6372876364',
                    lockPassword: '28122020',
                    lockStartHour: 17,
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
                    return db.ref(CURRENT_SHOP_ID + '/info/shop_config').update(updates).then(function() {
                        console.log('✅ Shop config fields created');
                    });
                }
            });
        }).catch(function(err) {
            console.error('⚠️ ensureShopConfig error:', err);
        });
    }

    // ========== FORCE SYNC TỪ FIREBASE ==========
    // Dùng khi phát hiện IndexedDB bị xóa (local rỗng) - force tải lại từ Firebase
    function forceSyncFromFirebase() {
        if (!isOnline) {
            console.warn('⚠️ Offline, cannot force sync from Firebase');
            return Promise.reject(new Error('Offline'));
        }
        var collections = [
            'tables', 'customers', 'menu', 'menu_categories',
            'ingredients', 'transactions', 'reports',
            'cost_categories', 'cost_transactions', 'cost_transactions_admin',
            'admin_cost_categories', 'daily_balances',
            'inventory_transactions', 'manager_cash_pickups',
            'ingredient_transactions', 'notifications',
            'info'
        ];
        
        console.log('🔄 Force syncing all collections from Firebase...');
        
        var chain = Promise.resolve();
        for (var c = 0; c < collections.length; c++) {
            chain = chain.then((function(collection) {
                return function() {
                    return _forceSyncCollection(collection);
                };
            })(collections[c]));
        }
        
        return chain.then(function() {
            console.log('✅ Force sync completed');
        });
    }
    
    function _forceSyncCollection(collection) {
        return new Promise(function(resolve, reject) {
            var ref = db.ref(CURRENT_SHOP_ID + '/' + collection);
            ref.once('value', function(snapshot) {
                var remote = snapshot.val() || {};
                var count = 0;
                
                // Xóa toàn bộ local cache trước
                if (memoryCache[collection]) {
                    memoryCache[collection] = {};
                }
                
                // Ghi từng item từ Firebase vào local
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
                                // Đảm bảo _version tồn tại
                                if (item._version === undefined) item._version = 1;
                                count++;
                                return saveToLocal(collection, item);
                            });
                        })(key);
                    }
                }
                
                saveChain.then(function() {
                    console.log('  📥 Synced ' + collection + ': ' + count + ' items');
                    resolve();
                }).catch(function(err) {
                    console.error('  ❌ Error syncing ' + collection + ': ', err);
                    resolve(); // Không reject để tiếp tục collection khác
                });
            }, function(err) {
                console.error('  ❌ Firebase read error for ' + collection + ': ', err);
                resolve(); // Không reject để tiếp tục collection khác
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
            // Seed dữ liệu mặc định nếu chưa có
            return seedDefaultShop();
        }).then(function() {
            // Tự động tạo config fields cho shop hiện tại nếu chưa có
            return ensureShopConfig();
        }).then(function() {
            // Subscribe các collections cần thiết cho POS
            // tables, customers, menu, menu_categories, transactions, notifications
            // Bỏ: ingredients, cost_categories, cost_transactions, cost_transactions_admin,
            //      admin_cost_categories, reports, daily_balances
            subscribeToCollection('tables');
            subscribeToCollection('customers');
            subscribeToCollection('menu');
            subscribeToCollection('menu_categories');
            subscribeToCollection('transactions');
            subscribeToCollection('notifications');
            subscribeToCollection('info');
            console.log('✅ Database ready, device:', CURRENT_DEVICE_ID);
            return { isOnline: isOnline, deviceId: CURRENT_DEVICE_ID };
        });
    }

    // Helper showToast (dùng chung)
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
    
    // Xóa toàn bộ dữ liệu local (IndexedDB + memory cache) khi chuyển POS
    function clearLocalData() {
        // Xóa memory cache
        memoryCache = {};
        cacheVersion = {};
        
        // Xóa tất cả object stores trong IndexedDB
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
    
    // Đổi shopId (khi đăng nhập vào POS khác)
    function setShopId(shopId) {
        if (!shopId) return;
        CURRENT_SHOP_ID = shopId;
        localStorage.setItem('current_shop_id', shopId);
        console.log('🔄 Switched to shop:', shopId);
    }
    
    // Lấy shopId hiện tại
    function getShopId() {
        return CURRENT_SHOP_ID;
    }
    
    // Đăng nhập: kiểm tra shopCode -> lấy shopId -> verify staff credentials
    function login(shopCode, username, password) {
        if (!shopCode || !username || !password) {
            return Promise.reject(new Error('Vui lòng nhập đầy đủ thông tin'));
        }
        // Tra cứu shopCode trong shop_registry
        return db.ref('shop_registry/' + shopCode).once('value').then(function(snapshot) {
            if (!snapshot.exists()) {
                throw new Error('Mã POS không tồn tại');
            }
            var shopInfo = snapshot.val();
            var shopId = shopInfo.shopId;
            
            // Kiểm tra staff credentials trong shops/{shopId}/staffs
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
                
                // Xóa dữ liệu local cũ trước khi chuyển POS
                return clearLocalData().then(function() {
                    // Lưu session
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
                    
                    // Cập nhật shopId
                    setShopId(shopId);
                    
                    return currentUser;
                });
            });
        });
    }
    
    // Đăng ký POS mới (tạo shop + admin)
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
        
        // Kiểm tra shopCode đã tồn tại chưa
        return db.ref('shop_registry/' + shopCode).once('value').then(function(snapshot) {
            if (snapshot.exists()) {
                throw new Error('Mã POS này đã được đăng ký');
            }
            
            // Tạo shopId
            var shopId = 'shop_' + shopCode.toLowerCase();
            
            // Tạo staff admin
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
            
            // Tạo shop_registry entry
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
            updates[shopId + '/info/shop_config'] = {
                id: 'shop_config',
                name: shopName,
                code: shopCode,
                createdAt: Date.now()
            };
            
            return db.ref().update(updates).then(function() {
                // Xóa dữ liệu local cũ trước khi chuyển POS mới
                return clearLocalData();
            }).then(function() {
                // Tự động đăng nhập sau khi đăng ký
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
    
    // Tạo nhân viên mới (chỉ admin)
    function createStaff(staffData) {
        if (!currentUser || currentUser.role !== 'admin') {
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
        
        var ref = db.ref(CURRENT_SHOP_ID + '/staffs/' + staffId);
        return ref.set(data).then(function() {
            // Lưu vào IndexedDB local
            return saveToLocal('staffs', data);
        }).then(function() {
            return data;
        });
    }
    
    // Lấy danh sách nhân viên
    function getStaffs() {
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
            // Cập nhật local cache
            for (var i = 0; i < list.length; i++) {
                saveToLocal('staffs', list[i]);
            }
            return list;
        }).catch(function() {
            // Fallback: đọc từ local
            return getAll('staffs');
        });
    }
    
    // Đăng xuất
    function logout() {
        currentUser = null;
        localStorage.removeItem('pos_session');
        // Reset về shop mặc định
        CURRENT_SHOP_ID = 'shop_default';
        localStorage.setItem('current_shop_id', 'shop_default');
        console.log('👋 Logged out');
    }
    
    // Lấy thông tin user hiện tại
    function getCurrentUser() {
        return currentUser;
    }
    
    // Kiểm tra đã đăng nhập chưa
    function isLoggedIn() {
        return currentUser !== null;
    }
    
    // Kiểm tra có phải admin không
    function isAdmin() {
        return currentUser && currentUser.role === 'admin';
    }

    // Đọc shop config trực tiếp từ Firebase
    function getShopConfig() {
        return dbReady.then(function() {
            if (!isOnline) return Promise.resolve({});
            return db.ref(CURRENT_SHOP_ID + '/info/shop_config').once('value').then(function(snapshot) {
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