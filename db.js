// ========== FIREBASE CONFIG ==========
const firebaseConfig = {
    apiKey: "AIzaSyCQFIzj8m3kpsE_x354xxJ8MTAuRG9eCx4",
    authDomain: "posmilano.firebaseapp.com",
    projectId: "posmilano",
    databaseURL: "https://posmilano-default-rtdb.firebaseio.com",
    storageBucket: "posmilano.firebasestorage.app",
    messagingSenderId: "34185947554",
    appId: "1:34185947554:web:925f29864d3b17b8d46afb",
    measurementId: "G-J3MX8EL1C8"
};

// ========== KHỞI TẠO FIREBASE ==========
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// ========== CẤU HÌNH ==========
const STORE_NAME = 'pos_data';
const CURRENT_SHOP_ID = 'shop_default';
const CURRENT_DEVICE_ID = localStorage.getItem('device_id') || generateDeviceId();
localStorage.setItem('device_id', CURRENT_DEVICE_ID);

function generateDeviceId() {
    return 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}
// ========== HISTORICAL SYNC CONFIG ==========
var SYNC_CONFIG = {
    transactions: { lastSync: null, daysToSync: 30 },
    reports: { lastSync: null, daysToSync: 30 }
};
var SYNC_STORAGE_KEY = 'pos_sync_metadata';

function loadSyncMetadata() {
    var stored = localStorage.getItem(SYNC_STORAGE_KEY);
    if (stored) {
        try {
            var data = JSON.parse(stored);
            if (data.transactions && typeof data.transactions.lastSync === 'number')
                SYNC_CONFIG.transactions.lastSync = data.transactions.lastSync;
            if (data.reports && typeof data.reports.lastSync === 'number')
                SYNC_CONFIG.reports.lastSync = data.reports.lastSync;
        } catch(e) {}
    }
}
async function syncHistoricalTransactions() {
    if (!isOnline) return;
    var now = Date.now();
    var lastSync = SYNC_CONFIG.transactions.lastSync;
    if (lastSync && (now - lastSync) < 12 * 3600000) {
        console.log('Historical sync transactions skipped, last sync within 12h');
        return;
    }
    var startDate = new Date();
    startDate.setDate(startDate.getDate() - SYNC_CONFIG.transactions.daysToSync);
    var startDateStr = startDate.toISOString().slice(0,10);
    var endDateStr = new Date().toISOString().slice(0,10);
    console.log('Starting historical sync for transactions from', startDateStr, 'to', endDateStr);
    
    var ref = db.ref(CURRENT_SHOP_ID + '/transactions');
    var query = ref.orderByChild('dateKey').startAt(startDateStr).endAt(endDateStr);
    var snapshot = await query.once('value');
    var remoteData = snapshot.val() || {};
    
    var count = 0;
    for (var key in remoteData) {
        if (remoteData.hasOwnProperty(key)) {
            var remoteItem = remoteData[key];
            remoteItem.id = key;
            var localItem = await loadFromLocal('transactions', key);
            var remoteVersion = remoteItem._version || 0;
            var localVersion = localItem ? (localItem._version || 0) : 0;
            if (remoteVersion > localVersion) {
                await saveToLocal('transactions', remoteItem);
                count++;
            }
        }
    }
    SYNC_CONFIG.transactions.lastSync = now;
    saveSyncMetadata();
    console.log('Historical sync transactions completed, updated', count, 'records');
}
async function syncHistoricalReports() {
    if (!isOnline) return;
    var now = Date.now();
    var lastSync = SYNC_CONFIG.reports.lastSync;
    if (lastSync && (now - lastSync) < 12 * 3600000) {
        console.log('Historical sync reports skipped, last sync within 12h');
        return;
    }
    var startDate = new Date();
    startDate.setDate(startDate.getDate() - SYNC_CONFIG.reports.daysToSync);
    var startDateStr = startDate.toISOString().slice(0,10);
    var endDateStr = new Date().toISOString().slice(0,10);
    console.log('Starting historical sync for reports from', startDateStr, 'to', endDateStr);
    
    var ref = db.ref(CURRENT_SHOP_ID + '/reports');
    var query = ref.orderByChild('dateKey').startAt(startDateStr).endAt(endDateStr);
    var snapshot = await query.once('value');
    var remoteData = snapshot.val() || {};
    
    var count = 0;
    for (var key in remoteData) {
        if (remoteData.hasOwnProperty(key)) {
            var remoteItem = remoteData[key];
            remoteItem.id = key;
            var localItem = await loadFromLocal('reports', key);
            var remoteVersion = remoteItem._version || 0;
            var localVersion = localItem ? (localItem._version || 0) : 0;
            if (remoteVersion > localVersion) {
                await saveToLocal('reports', remoteItem);
                count++;
            }
        }
    }
    SYNC_CONFIG.reports.lastSync = now;
    saveSyncMetadata();
    console.log('Historical sync reports completed, updated', count, 'records');
}

function saveSyncMetadata() {
    var toStore = {
        transactions: { lastSync: SYNC_CONFIG.transactions.lastSync },
        reports: { lastSync: SYNC_CONFIG.reports.lastSync }
    };
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(toStore));
}
// ========== LOCAL DATABASE (IndexedDB) ==========
let localDB = null;
let dbReadyPromise = null;
let syncQueue = [];
let isOnline = navigator.onLine;
let listeners = {};
let analyticsSubscriptionsStarted = false;



async function backfillTransactionIndexes() {
    try {
        if (!localDB || !localDB.objectStoreNames.contains('transactions')) return;
        const txs = await loadFromLocal('transactions');
        if (!txs || txs.length === 0) return;
        for (let i = 0; i < txs.length; i++) {
            const t = txs[i];
            if (!t) continue;
            if (!t.dateKey || !t.dateTypeKey) {
                await saveToLocal('transactions', t);
            }
            if (i % 50 === 49) await new Promise(resolve => setTimeout(resolve, 0));
        }
    } catch (err) {
        console.warn('⚠️ backfillTransactionIndexes lỗi:', err);
    }
}

// ---------- Local CRUD (có fallback number) ----------
async function saveToLocal(collection, data) {
    await dbReadyPromise;
    if (!localDB) throw new Error('Database chưa được khởi tạo');
    if (!localDB.objectStoreNames.contains(collection)) {
        throw new Error(`Store "${collection}" not found`);
    }
    return new Promise((resolve, reject) => {
        const transaction = localDB.transaction([collection], 'readwrite');
        const store = transaction.objectStore(collection);
        const normalizedData = normalizeIndexedFields(collection, data);
        const request = store.put(normalizedData);
        request.onsuccess = () => resolve(data);
        request.onerror = () => reject(request.error);
    });
}

function toDateKey(value) {
    if (!value) return '';
    if (typeof value === 'string') {
        if (value.length >= 10 && value[4] === '-' && value[7] === '-') return value.slice(0, 10);
        const parsed = Date.parse(value);
        if (!isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
        return '';
    }
    if (typeof value === 'number') return new Date(value).toISOString().slice(0, 10);
    return '';
}

function normalizeIndexedFields(collection, data) {
    if (!data || typeof data !== 'object') return data;
    if (collection !== 'transactions') return data;
    const normalized = Object.assign({}, data);
    const dateKey = toDateKey(normalized.date || normalized.createdAt || normalized.updatedAt);
    normalized.dateKey = dateKey;
    normalized.type = normalized.type || 'unknown';
    normalized.dateTypeKey = `${dateKey}|${normalized.type}`;
    return normalized;
}

async function loadFromLocal(collection, id = null) {
    await dbReadyPromise;
    if (!localDB) return id ? null : [];
    if (!localDB.objectStoreNames.contains(collection)) return id ? null : [];
    
    return new Promise((resolve, reject) => {
        const transaction = localDB.transaction([collection], 'readonly');
        const store = transaction.objectStore(collection);
        if (id !== null) {
            const strId = String(id);
            const request = store.get(strId);
            request.onsuccess = () => {
                if (request.result) resolve(request.result);
                else {
                    const numId = Number(id);
                    if (!isNaN(numId)) {
                        const req2 = store.get(numId);
                        req2.onsuccess = () => resolve(req2.result || null);
                        req2.onerror = () => reject(req2.error);
                    } else resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        } else {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        }
    });
}

async function deleteFromLocal(collection, id) {
    await dbReadyPromise;
    if (!localDB) return;
    if (!localDB.objectStoreNames.contains(collection)) return;
    const strId = String(id);
    return new Promise((resolve, reject) => {
        const transaction = localDB.transaction([collection], 'readwrite');
        const store = transaction.objectStore(collection);
        const request = store.delete(strId);
        request.onsuccess = () => resolve();
        request.onerror = () => {
            const numId = Number(id);
            if (!isNaN(numId)) {
                const req2 = store.delete(numId);
                req2.onsuccess = () => resolve();
                req2.onerror = () => reject(req2.error);
            } else reject(request.error);
        };
    });
}

async function pruneCollectionByAge(collection, maxAgeMs, dateFieldCandidates) {
    const items = await loadFromLocal(collection);
    if (!items || items.length === 0) return 0;
    const now = Date.now();
    let deletedCount = 0;

    for (let i = 0; i < items.length; i++) {
        const item = items[i] || {};
        let ts = 0;

        for (const field of dateFieldCandidates) {
            const value = item[field];
            if (!value) continue;
            if (typeof value === 'number') {
                ts = value;
                break;
            }
            if (typeof value === 'string') {
                const parsed = Date.parse(value);
                if (!isNaN(parsed)) {
                    ts = parsed;
                    break;
                }
            }
        }

        if (!ts) continue;
        if ((now - ts) > maxAgeMs) {
            await deleteFromLocal(collection, item.id);
            deletedCount++;
        }

        // Yield nhẹ sau mỗi batch để tránh block UI trên thiết bị yếu.
        if (i % 50 === 49) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return deletedCount;
}

async function pruneLocalData() {
    try {
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const prunedTransactions = await pruneCollectionByAge('transactions', THIRTY_DAYS_MS, ['date', 'createdAt', 'updatedAt']);
        const prunedReports = await pruneCollectionByAge('reports', THIRTY_DAYS_MS, ['date', 'createdAt', 'updatedAt']);
        const totalPruned = prunedTransactions + prunedReports;
        if (totalPruned > 0) {
            console.log(`🧹 Đã dọn localDB: ${prunedTransactions} transactions, ${prunedReports} reports`);
        }
    } catch (error) {
        console.warn('⚠️ pruneLocalData lỗi:', error);
    }
}

// ========== SYNC QUEUE ==========
function loadSyncQueue() {
    if (!localDB) return;
    const transaction = localDB.transaction(['sync_queue'], 'readonly');
    const store = transaction.objectStore('sync_queue');
    const request = store.getAll();
    request.onsuccess = () => {
        syncQueue = request.result || [];
    };
}

function addToSyncQueue(action, collection, data, targetId) {
    // Chống trùng lặp pending
    const existing = syncQueue.find(item => item.targetId === targetId && item.action === action && item.status === 'pending');
    if (existing) {
        console.log(`⚠️ Bỏ qua trùng: ${action} ${collection}/${targetId}`);
        return existing.id;
    }
    
    const queueItem = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        action, collection, data, targetId,
        deviceId: CURRENT_DEVICE_ID,
        timestamp: Date.now(),
        retryCount: 0,
        status: 'pending'
    };
    syncQueue.push(queueItem);
    saveToLocal('sync_queue', queueItem);
    if (isOnline) processSyncQueue();
    return queueItem.id;
}

async function processSyncQueue() {
    if (!isOnline) return;
    const pendingItems = syncQueue.filter(item => item.status === 'pending');
    const MAX_RETRIES = 5;
    
    for (let i = 0; i < pendingItems.length; i++) {
        const item = pendingItems[i];
        try {
            await syncToFirebase(item);
            item.status = 'synced';
            await saveToLocal('sync_queue', item);
            await deleteFromLocal('sync_queue', item.id);
            syncQueue = syncQueue.filter(s => s.id !== item.id);
            console.log(`✅ Synced: ${item.action} ${item.collection}/${item.targetId}`);
            if (i % 3 === 2) await new Promise(resolve => setTimeout(resolve, 0));
        } catch (error) {
            item.retryCount++;
            if (item.retryCount < MAX_RETRIES) {
                item.status = 'pending';
                console.warn(`⚠️ Sync retry (${item.retryCount}/${MAX_RETRIES}): ${item.action} ${item.collection}/${item.targetId}`);
                await new Promise(resolve => setTimeout(resolve, 2000 * item.retryCount));
                const retryItem = Object.assign({}, item);
                try {
                    await syncToFirebase(retryItem);
                    item.status = 'synced';
                    console.log(`✅ Retry synced: ${item.action} ${item.collection}/${item.targetId}`);
                    await deleteFromLocal('sync_queue', item.id);
                    syncQueue = syncQueue.filter(s => s.id !== item.id);
                } catch (retryError) {
                    item.status = 'failed';
                    console.error(`❌ Retry failed: ${item.action} ${item.collection}`, retryError);
                }
            } else {
                item.status = 'failed_max_retries';
                console.error(`❌ Sync failed (max retries): ${item.action} ${item.collection}/${item.targetId}`);
                showToast(`❌ Không thể sync: ${item.action} ${item.collection}`, 'error');
            }
            await saveToLocal('sync_queue', item);
        }
    }
}

async function syncToFirebase(queueItem) {
    var action = queueItem.action;
    var collection = queueItem.collection;
    var data = queueItem.data;
    var targetId = queueItem.targetId;
    var deviceId = queueItem.deviceId;
    var ref = db.ref(CURRENT_SHOP_ID + '/' + collection + '/' + targetId);
    
    if (action === 'update' || action === 'create') {
        var snapshot = await ref.once('value');
        var remoteData = snapshot.val();
        var remoteVersion = remoteData ? (remoteData._version || 0) : 0;
        var localVersion = data._version || 0;
        if (localVersion < remoteVersion) {
            console.warn('Skip sync: local version older than remote', targetId);
            return false;
        }
    }
    
    var syncData = {};
    for (var key in data) {
        if (data.hasOwnProperty(key)) {
            syncData[key] = data[key];
        }
    }
    syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
    syncData._syncedBy = deviceId;
    syncData._version = data._version || 1;
    
    if (action === 'create' || action === 'update') {
        await ref.update(syncData);
    } else if (action === 'delete') {
        await ref.remove();
    }
    return true;
}

function subscribeToCollection(collection, callback) {
    const ref = db.ref(`${CURRENT_SHOP_ID}/${collection}`);
    const useIncremental = (collection === 'transactions' || collection === 'reports');

    if (useIncremental) {
        let updateScheduled = false;
        const emitUpdate = async () => {
            if (updateScheduled) return;
            updateScheduled = true;
            setTimeout(async () => {
                updateScheduled = false;
                const data = await loadFromLocal(collection);
                if (callback) callback(data);
                window.dispatchEvent(new CustomEvent('db_update', { detail: { collection, data } }));
            }, 50);
        };

        const onAdded = async (snapshot) => {
            if (!snapshot.exists()) return;
            const key = snapshot.key;
            const source = snapshot.val() || {};
            const item = Object.assign({ id: key }, source);
            await saveToLocal(collection, item);
            await emitUpdate();
        };

        const onChanged = async (snapshot) => {
            if (!snapshot.exists()) return;
            const key = snapshot.key;
            const source = snapshot.val() || {};
            const item = Object.assign({ id: key }, source);
            await saveToLocal(collection, item);
            await emitUpdate();
        };

        const onRemoved = async (snapshot) => {
            const key = snapshot.key;
            await deleteFromLocal(collection, key);
            await emitUpdate();
        };

        ref.on('child_added', onAdded);
        ref.on('child_changed', onChanged);
        ref.on('child_removed', onRemoved);

        if (!listeners[collection]) listeners[collection] = [];
        listeners[collection].push({
            mode: 'incremental',
            added: onAdded,
            changed: onChanged,
            removed: onRemoved
        });

        return () => {
            ref.off('child_added', onAdded);
            ref.off('child_changed', onChanged);
            ref.off('child_removed', onRemoved);
        };
    }

    let lastDataStr = '';
    let updateScheduled = false;
    let isFirstSync = true;
    
    const listener = ref.on('value', async (snapshot) => {
        const remoteData = snapshot.val();
        const remoteMap = new Map();
        if (remoteData) {
            for (const key of Object.keys(remoteData)) {
                var rest = {};
                var source = remoteData[key] || {};
                for (var p in source) {
                    if (Object.prototype.hasOwnProperty.call(source, p) && p !== 'id') {
                        rest[p] = source[p];
                    }
                }
                remoteMap.set(key, Object.assign({ id: key }, rest));
            }
        }

        const localItems = await loadFromLocal(collection);
        const localMap = new Map(localItems.map(item => [String(item.id), item]));
        const now = Date.now();
        const toDelete = [];
        const toSave = [];
        const ONE_DAY_MS = 86400000;
        const STALE_THRESHOLD = ONE_DAY_MS;

        for (const [id, localItem] of localMap.entries()) {
            if (!remoteMap.has(id)) {
                const createdAt = localItem.createdAt || 0;
                if (now - createdAt >= 5000) {
                    toDelete.push(id);
                    if (isFirstSync) console.log(`🗑️ Xóa item cũ (không có remote): ${collection}/${id}`);
                }
            }
        }
        for (const [id, remoteItem] of remoteMap.entries()) {
            const localItem = localMap.get(id);
            const remoteUpdated = remoteItem.updatedAt || 0;
            const remoteVersion = remoteItem._version || 1;
            const localUpdated = localItem ? (localItem.updatedAt || 0) : 0;
            const localVersion = localItem ? (localItem._version || 1) : 0;
            const dataAge = now - remoteUpdated;
            const timeDiff = remoteUpdated - localUpdated;
            
            if (!localItem) {
                toSave.push(remoteItem);
                if (isFirstSync && dataAge > STALE_THRESHOLD) {
                    console.warn(`⚠️ Dữ liệu remote cũ (${Math.floor(dataAge/3600000)}h): ${collection}/${id}`);
                }
            } else if (localVersion < remoteVersion && remoteUpdated > localUpdated) {
                // Remote version cao hơn, accept nó
                if (dataAge > STALE_THRESHOLD) {
                    console.warn(`⚠️ Cập nhật item bằng data remote cũ (${Math.floor(dataAge/3600000)}h), version: ${localVersion}->${remoteVersion}`);
                }
                toSave.push(remoteItem);
            } else if (localVersion > remoteVersion) {
                // Local version cao hơn, reject remote (dữ liệu local mới hơn)
                console.log(`ℹ️ Bỏ qua remote (local version cao hơn ${localVersion}>${remoteVersion}): ${collection}/${id}`);
            } else if (remoteUpdated > localUpdated && Math.abs(timeDiff) < STALE_THRESHOLD) {
                // Cùng version nhưng remote mới hơn và không quá cũ
                toSave.push(remoteItem);
            } else if (remoteUpdated > localUpdated && timeDiff > STALE_THRESHOLD) {
                // Local cũ hơn remote hơn 1 ngày, đó là lỗi, reject
                console.warn(`⚠️ Loại bỏ remote (local cũ hơn ${Math.floor(Math.abs(timeDiff)/3600000)}h): ${collection}/${id}`);
            }
        }
        for (const id of toDelete) await deleteFromLocal(collection, id);
        for (const item of toSave) await saveToLocal(collection, item);

        const newData = await loadFromLocal(collection);
        const newDataStr = JSON.stringify(newData);
        if (newDataStr !== lastDataStr) {
            lastDataStr = newDataStr;
            if (updateScheduled) return;
            updateScheduled = true;
            setTimeout(() => {
                updateScheduled = false;
                if (callback) callback(newData);
                window.dispatchEvent(new CustomEvent('db_update', { detail: { collection, data: newData } }));
            }, 50);
        }
        isFirstSync = false;
    });
    
    if (!listeners[collection]) listeners[collection] = [];
    listeners[collection].push(listener);
    return () => ref.off('value', listener);
}

// ========== CRUD (chuẩn hóa id = string) ==========
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

async function create(collection, data, customId = null) {
    // Nếu không có customId nhưng data có trường id thì dùng nó
    let id = customId;
    if (!id && data.id) {
        id = String(data.id);
    }
    if (!id) {
        id = generateId();
    }
    var newData = Object.assign({ id: id }, data, {
        createdAt: Date.now(),
        createdBy: CURRENT_DEVICE_ID,
        updatedAt: Date.now(),
        _version: 1
    });
    // Loại bỏ trường id cũ trong data (nếu có) để tránh trùng
    delete newData.id; // dòng này thừa? Thực tế newData đã có id, không cần xóa
    // Nhưng cần đảm bảo newData.id = id
    newData.id = id;
    await saveToLocal(collection, newData);
    addToSyncQueue('create', collection, newData, id);
    if (isOnline) await processSyncQueue();
    return newData;
}

async function update(collection, id, data) {
    const oldData = await loadFromLocal(collection, String(id));
    if (!oldData) throw new Error(`Không tìm thấy ${collection}/${id}`);
    var updatedData = Object.assign({}, oldData, data, {
        updatedAt: Date.now(),
        updatedBy: CURRENT_DEVICE_ID,
        _version: (oldData._version || 0) + 1
    });
    await saveToLocal(collection, updatedData);
    addToSyncQueue('update', collection, updatedData, String(id));
    if (isOnline) await processSyncQueue();
    return updatedData;
}

async function remove(collection, id) {
    await deleteFromLocal(collection, String(id));
    addToSyncQueue('delete', collection, { id }, String(id));
    if (isOnline) await processSyncQueue();
    return true;
}

async function get(collection, id = null) {
    return await loadFromLocal(collection, id !== null ? String(id) : null);
}

async function getAll(collection) {
    const data = await loadFromLocal(collection);
    return data || [];
}

async function getTransactionsByDate(dateKey, options = {}) {
    await dbReadyPromise;
    if (!localDB) return [];
    if (!localDB.objectStoreNames.contains('transactions')) return [];

    const type = options.type || 'all';
    return new Promise((resolve, reject) => {
        const tx = localDB.transaction(['transactions'], 'readonly');
        const store = tx.objectStore('transactions');

        let request;
        if (type && type !== 'all' && store.indexNames.contains('dateTypeKey')) {
            request = store.index('dateTypeKey').getAll(`${dateKey}|${type}`);
        } else if (store.indexNames.contains('dateKey')) {
            request = store.index('dateKey').getAll(dateKey);
        } else {
            // Fallback cho dữ liệu/index cũ
            request = store.getAll();
        }

        request.onsuccess = () => {
            let rows = request.result || [];
            if (!store.indexNames.contains('dateKey')) {
                rows = rows.filter(r => toDateKey(r.date) === dateKey);
                if (type && type !== 'all') rows = rows.filter(r => r.type === type);
            }
            resolve(rows);
        };
        request.onerror = () => reject(request.error);
    });
}

// ========== CHỐNG TRÙNG & LOCK ==========
async function updateWithLock(collection, id, updateFn, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const current = await get(collection, id);
        if (!current) throw new Error(`Không tìm thấy ${collection}/${id}`);
        const newData = await updateFn(Object.assign({}, current));
        if (newData._version !== current._version) {
            console.log(`Conflict, retry ${attempt+1}`);
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt+1)));
            continue;
        }
        newData._version = current._version + 1;
        await update(collection, id, newData);
        return newData;
    }
    throw new Error(`Không thể cập nhật sau ${maxRetries} lần`);
}

const tableLocks = new Map();
async function lockTable(tableId, userId, timeout = 30000) {
    const table = await get('tables', String(tableId));
    if (!table) return { success: false, error: 'Bàn không tồn tại' };
    const existing = tableLocks.get(String(tableId));
    if (existing && existing.expiresAt > Date.now() && existing.userId !== userId) {
        return { success: false, lockedBy: existing.userId, expiresIn: existing.expiresAt - Date.now() };
    }
    const lock = { userId: userId, expiresAt: Date.now() + timeout, tableData: Object.assign({}, table) };
    tableLocks.set(String(tableId), lock);
    setTimeout(() => {
        const existingLock = tableLocks.get(String(tableId));
        if (existingLock && existingLock.expiresAt <= Date.now()) tableLocks.delete(String(tableId));
    }, timeout);
    return { success: true, lock };
}
function unlockTable(tableId, userId) {
    const lock = tableLocks.get(String(tableId));
    if (lock && lock.userId === userId) return tableLocks.delete(String(tableId));
    return false;
}
function getTableLock(tableId) {
    const lock = tableLocks.get(String(tableId));
    if (lock && lock.expiresAt > Date.now()) return lock;
    return null;
}

function mergeTableData(localData, remoteData) {
    var mergedItems = localData.items ? localData.items.slice() : [];
    for (var ri = 0; ri < (remoteData.items || []).length; ri++) {
        var remoteItem = remoteData.items[ri];
        var existingIndex = mergedItems.findIndex(function(i) { return i.name === remoteItem.name; });
        if (existingIndex >= 0) {
            mergedItems[existingIndex].qty = Math.max(mergedItems[existingIndex].qty, remoteItem.qty);
        } else {
            mergedItems.push(Object.assign({}, remoteItem));
        }
    }
    var total = mergedItems.reduce(function(sum, i) { return sum + (i.price || 0) * (i.qty || 0); }, 0);
    return Object.assign({}, localData, remoteData, {
        items: mergedItems,
        total: total,
        _mergedAt: Date.now()
    });
}

// ========== NETWORK STATUS (fix duplicate) ==========
function initNetworkListener() {
    window.removeEventListener('online', window._onlineHandler);
    window.removeEventListener('offline', window._offlineHandler);
    window._onlineHandler = () => {
        isOnline = true;
        showToast('📡 Đã kết nối mạng, đang đồng bộ...', 'success');
        processSyncQueue();
    };
    window._offlineHandler = () => {
        isOnline = false;
        showToast('⚠️ Mất kết nối mạng. Dữ liệu sẽ được lưu tạm.', 'warning');
    };
    window.addEventListener('online', window._onlineHandler);
    window.addEventListener('offline', window._offlineHandler);
    isOnline = navigator.onLine;
}

// Danh sách các collection cần đồng bộ (thêm bớt ở đây)
const SYNC_COLLECTIONS = [
    'tables',
    'customers',
    'menu',
    'menu_categories',
    'ingredients',
    'transactions',
    'reports'
];

async function initDatabase() {
    await initLocalDB();
    loadSyncMetadata();
    if (isOnline) {
    console.log('🔄 Starting historical sync...');
    await syncHistoricalTransactions();
    await syncHistoricalReports();
}
    await pruneLocalData();
    initNetworkListener();
    initStaffList();

    if (isOnline) {
        console.log('🔄 Đang tải dữ liệu từ Firebase lần đầu...');
        await new Promise(resolve => setTimeout(resolve, 500));
        const pendingCount = syncQueue.filter(item => item.status === 'pending').length;
        if (pendingCount > 0) {
            console.log(`⏳ Đồng bộ ${pendingCount} thay đổi chưa sync...`);
            await processSyncQueue();
        }
    } else {
        const pendingCount = syncQueue.filter(item => item.status === 'pending').length;
        if (pendingCount > 0) {
            console.log(`⚠️ Offline, sẽ sync ${pendingCount} thay đổi sau khi online`);
        }
    }

    subscribeToCollection('tables', async (tables) => {
        // ... code xử lý bàn
    });
    subscribeToCollection('customers');
    subscribeToCollection('menu');
    subscribeToCollection('menu_categories');
    subscribeToCollection('ingredients');
    subscribeToCollection('cost_categories');
    subscribeToCollection('cost_transactions');
    subscribeToCollection('cost_transactions_admin');
    subscribeToCollection('admin_cost_categories');  // 👈 THÊM DÒNG NÀY




    // 👇 THÊM DÒNG NÀY
    ensureAnalyticsSubscriptions();

    console.log('✅ Database initialized, device:', CURRENT_DEVICE_ID);
    return { isOnline, deviceId: CURRENT_DEVICE_ID };
}

function ensureAnalyticsSubscriptions() {
    if (analyticsSubscriptionsStarted) return;
    analyticsSubscriptionsStarted = true;
    subscribeToCollection('transactions');
    subscribeToCollection('reports');
    console.log('📊 Analytics realtime subscriptions started');
}

async function deleteItem(tableName, id) {
    try {
        const db = firebase.database();

        // Xóa trên Firebase (QUAN TRỌNG)
        await db.ref(`${tableName}/${id}`).remove();

        console.log(`🗑️ Deleted ${tableName}/${id}`);

    } catch (err) {
        console.error("❌ deleteItem lỗi:", err);
    }
}
// ========== STAFF (bỏ password khỏi code mẫu - dùng Firebase Auth thực tế) ==========
function initStaffList() {
    const staffRef = db.ref(`${CURRENT_SHOP_ID}/staffs`);
    staffRef.once('value', (snapshot) => {
        if (!snapshot.exists()) {
            const defaultStaff = [
                { id: 'admin_001', email: 'admin@pos.com', name: 'Quản trị viên', role: 'admin', avatar: '👑', isActive: true },
                { id: 'staff_001', email: 'nhanvien@pos.com', name: 'Nguyễn Thị Nhân Viên', role: 'staff', avatar: '👩‍💼', isActive: true }
            ];
            defaultStaff.forEach(staff => {
                staffRef.child(staff.id).set({
                    email: staff.email,
                    name: staff.name,
                    role: staff.role,
                    avatar: staff.avatar,
                    isActive: staff.isActive,
                    createdAt: Date.now()
                });
            });
            console.log('✅ Đã tạo danh sách nhân viên mặc định (không password)');
        } else {
            var data = snapshot.val();
            window.staffList = Object.keys(data).map(function(key) {
                var item = data[key] || {};
                var result = Object.assign({ id: key }, item);
                return result;
            });
            console.log('✅ Đã tải ' + window.staffList.length + ' nhân viên');
        }
    });
}

// ========== HELPER ==========
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) { console.log(message); return; }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// ========== EXPORT ==========
window.DB = {
    init: initDatabase,
    create, update, remove, get, getAll,
    getTransactionsByDate,
    updateWithLock, lockTable, unlockTable, getTableLock,
    isOnline: () => isOnline,
    getDeviceId: () => CURRENT_DEVICE_ID,
    subscribe: subscribeToCollection,
    ensureAnalyticsSubscriptions,
    getSyncQueue: () => syncQueue,
    processSyncQueue
};
function initLocalDB() {
    if (dbReadyPromise) return dbReadyPromise;
    
    dbReadyPromise = new Promise((resolve, reject) => {
        const DB_VERSION = 9; // tăng lên 8 để chắc chắn
        
        function doOpen(version) {
            const request = indexedDB.open(STORE_NAME, version);
            
            request.onerror = (event) => {
                const error = event.target.error;
                if (error && error.name === 'VersionError') {
                    console.warn('VersionError: Xóa database cũ và thử lại...');
                    const deleteRequest = indexedDB.deleteDatabase(STORE_NAME);
                    deleteRequest.onsuccess = () => {
                        doOpen(version);
                    };
                    deleteRequest.onerror = () => reject(deleteRequest.error);
                    return;
                }
                reject(error);
            };
            
            request.onsuccess = () => {
                localDB = request.result;
                loadSyncQueue();
                backfillTransactionIndexes();
                resolve(localDB);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const stores = [
            'tables', 'customers', 'menu', 'menu_categories',
            'ingredients', 'transactions', 'reports', 'sync_queue', 'staffs',
            'cost_categories', 'cost_transactions', 'cost_transactions_admin',
            'admin_cost_categories'  // 👈 THÊM DÒNG NÀY
        ];
                for (let i = 0; i < stores.length; i++) {
                    const storeName = stores[i];
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName, { keyPath: 'id' });
                        console.log('✅ Created object store: ' + storeName);
                    }
                }
                if (db.objectStoreNames.contains('transactions')) {
                    const txStore = event.target.transaction.objectStore('transactions');
                    if (!txStore.indexNames.contains('dateKey')) {
                        txStore.createIndex('dateKey', 'dateKey', { unique: false });
                    }
                    if (!txStore.indexNames.contains('type')) {
                        txStore.createIndex('type', 'type', { unique: false });
                    }
                    if (!txStore.indexNames.contains('dateTypeKey')) {
                        txStore.createIndex('dateTypeKey', 'dateTypeKey', { unique: false });
                    }
                }
            };
        }
        
        doOpen(DB_VERSION);
    });
    
    return dbReadyPromise;
}
console.log('✅ db.js loaded - Firebase + Offline Queue ready');