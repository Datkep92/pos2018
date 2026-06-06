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
    var CURRENT_SHOP_ID = 'shop_default';
    var CURRENT_DEVICE_ID = localStorage.getItem('device_id') || ('device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    localStorage.setItem('device_id', CURRENT_DEVICE_ID);

    var localDB = null;
    var dbReady = null;
    var syncQueue = [];
    var isOnline = navigator.onLine;
    var listeners = {};
    var analyticsStarted = false;

    // Helper: toDateKey
    function toDateKey(value) {
        if (!value) return '';
        if (typeof value === 'string') {
            if (value.length >= 10 && value[4] === '-' && value[7] === '-') return value.slice(0, 10);
            var parsed = Date.parse(value);
            if (!isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
            return '';
        }
        if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
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

    // IndexedDB operations
    function saveToLocal(collection, data) {
        return dbReady.then(function() {
            if (!localDB) throw new Error('DB not ready');
            if (!localDB.objectStoreNames.contains(collection)) throw new Error('Store ' + collection + ' not found');
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
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([collection], 'readonly');
                var store = tx.objectStore(collection);
                if (id !== undefined && id !== null) {
                    var req = store.get(String(id));
                    req.onsuccess = function() { resolve(req.result || null); };
                    req.onerror = function() { reject(req.error); };
                } else {
                    var req = store.getAll();
                    req.onsuccess = function() { resolve(req.result || []); };
                    req.onerror = function() { reject(req.error); };
                }
            });
        });
    }

    function deleteFromLocal(collection, id) {
        return dbReady.then(function() {
            if (!localDB) return;
            if (!localDB.objectStoreNames.contains(collection)) return;
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
        var chain = Promise.resolve();
        for (var i = 0; i < pending.length; i++) {
            chain = chain.then((function(item) {
                return function() {
                    return syncToFirebase(item).then(function() {
                        item.status = 'synced';
                        return saveToLocal('sync_queue', item).then(function() {
                            return deleteFromLocal('sync_queue', item.id);
                        }).then(function() {
                            var idx = syncQueue.findIndex(function(q) { return q.id === item.id; });
                            if (idx !== -1) syncQueue.splice(idx, 1);
                            console.log('✅ Synced:', item.action, item.collection, item.targetId);
                        });
                    }).catch(function(err) {
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
                    });
                };
            })(pending[i]));
        }
        return chain;
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

    function create(collection, data, customId) {
        var id = customId || data.id || generateId();
        var newData = { id: id };
        for (var k in data) if (data.hasOwnProperty(k) && k !== 'id') newData[k] = data[k];
        newData.createdAt = Date.now();
        newData.createdBy = CURRENT_DEVICE_ID;
        newData.updatedAt = Date.now();
        newData._version = 1;
        return saveToLocal(collection, newData).then(function() {
            addToSyncQueue('create', collection, newData, id);
            if (isOnline) return processSyncQueue();
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
                if (isOnline) return processSyncQueue();
                return Promise.resolve();
            }).then(function() { return updated; });
        });
    }

    function remove(collection, id) {
        return deleteFromLocal(collection, String(id)).then(function() {
            addToSyncQueue('delete', collection, { id: id }, String(id));
            if (isOnline) return processSyncQueue();
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
    var ref = db.ref(CURRENT_SHOP_ID + '/' + collection);
    var useIncremental = (collection === 'transactions' || collection === 'reports');
    if (useIncremental) {
        var updateScheduled = false;
        var emitUpdate = function() {
            if (updateScheduled) return;
            updateScheduled = true;
            setTimeout(function() {
                updateScheduled = false;
                loadFromLocal(collection).then(function(localData) {
                    if (callback) callback(localData);
                    var evt = document.createEvent('CustomEvent');
                    evt.initCustomEvent('db_update', true, true, { detail: { collection: collection, data: localData } });
                    window.dispatchEvent(evt);
                });
            }, 50);
        };
        var onAdded = function(snapshot) {
            if (!snapshot.exists()) return;
            var key = snapshot.key;
            var src = snapshot.val() || {};
            var item = { id: key };
            for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
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
    } else {
        var lastStr = '';
        var scheduled = false;
        var handler = ref.on('value', function(snapshot) {
            var remote = snapshot.val() || {};
            var remoteMap = {};
            for (var key in remote) {
                if (remote.hasOwnProperty(key)) {
                    var item = { id: key };
                    var src = remote[key];
                    for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                    remoteMap[key] = item;
                }
            }
            loadFromLocal(collection).then(function(localItems) {
                var toDelete = [];
                var toSave = [];
                var localMap = {};
                for (var i = 0; i < localItems.length; i++) localMap[localItems[i].id] = localItems[i];
                for (var id in localMap) {
                    if (!remoteMap[id]) toDelete.push(id);
                }
                for (var id in remoteMap) {
                    var local = localMap[id];
                    if (!local) toSave.push(remoteMap[id]);
                    else if ((remoteMap[id]._version || 0) > (local._version || 0)) toSave.push(remoteMap[id]);
                }
                var delPromises = toDelete.map(function(id) { return deleteFromLocal(collection, id); });
                var savePromises = toSave.map(function(item) { return saveToLocal(collection, item); });
                return Promise.all(delPromises.concat(savePromises)).then(function() {
                    return loadFromLocal(collection);
                }).then(function(newData) {
                    var newStr = JSON.stringify(newData);
                    if (newStr !== lastStr) {
                        lastStr = newStr;
                        if (scheduled) return;
                        scheduled = true;
                        setTimeout(function() {
                            scheduled = false;
                            if (callback) callback(newData);
                            var evt = document.createEvent('CustomEvent');
                            evt.initCustomEvent('db_update', true, true, { detail: { collection: collection, data: newData } });
                            window.dispatchEvent(evt);
                        }, 50);
                    }
                });
            });
        });
        if (!listeners[collection]) listeners[collection] = [];
        listeners[collection].push(handler);
        return function() { ref.off('value', handler); };
    }
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
            var request = indexedDB.open(STORE_NAME, 10);
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
    'admin_cost_categories', 'daily_balances'   // ← thêm dòng này
];
                for (var i = 0; i < stores.length; i++) {
                    if (!db.objectStoreNames.contains(stores[i])) {
                        db.createObjectStore(stores[i], { keyPath: 'id' });
                        console.log('Created store:', stores[i]);
                    }
                }
                var txStore = e.target.transaction.objectStore('transactions');
                if (!txStore.indexNames.contains('dateKey')) txStore.createIndex('dateKey', 'dateKey', { unique: false });
                if (!txStore.indexNames.contains('type')) txStore.createIndex('type', 'type', { unique: false });
                if (!txStore.indexNames.contains('dateTypeKey')) txStore.createIndex('dateTypeKey', 'dateTypeKey', { unique: false });
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

    // Init Database
    function initDatabase() {
        return initLocalDB().then(function() {
            initNetwork();
            if (isOnline) return syncHistorical();
            return Promise.resolve();
        }).then(function() {
            // Subscribe to essential collections (real-time)
            subscribeToCollection('tables');
            subscribeToCollection('customers');
            subscribeToCollection('menu');
            subscribeToCollection('menu_categories');
            subscribeToCollection('ingredients');
            subscribeToCollection('cost_categories');
            subscribeToCollection('cost_transactions');
            subscribeToCollection('cost_transactions_admin');
            subscribeToCollection('admin_cost_categories');
            subscribeToCollection('transactions');
            subscribeToCollection('reports');
            subscribeToCollection('daily_balances');
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
        getSyncQueue: function() { return syncQueue; }
    };
})();