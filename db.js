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

// ========== LOCAL DATABASE (IndexedDB) ==========
let localDB = null;
let dbReadyPromise = null;
let syncQueue = [];
let isOnline = navigator.onLine;
let listeners = {};

function initLocalDB() {
    if (dbReadyPromise) return dbReadyPromise;
    
    dbReadyPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(STORE_NAME, 4); // tăng version để đảm bảo upgrade
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            localDB = request.result;
            loadSyncQueue();
            resolve(localDB);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            const stores = [
                'tables', 'customers', 'menu', 'menu_categories',
                'ingredients', 'transactions', 'reports', 'sync_queue', 'staffs'
            ];
            for (const storeName of stores) {
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName, { keyPath: 'id' });
                    console.log(`✅ Created object store: ${storeName}`);
                }
            }
        };
    });
    
    return dbReadyPromise;
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
        const request = store.put(data);
        request.onsuccess = () => resolve(data);
        request.onerror = () => reject(request.error);
    });
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
    for (let i = 0; i < pendingItems.length; i++) {
        const item = pendingItems[i];
        try {
            await syncToFirebase(item);
            item.status = 'synced';
            await saveToLocal('sync_queue', item);
            await deleteFromLocal('sync_queue', item.id);
            syncQueue = syncQueue.filter(i => i.id !== item.id);
            console.log(`✅ Synced: ${item.action} ${item.collection}/${item.targetId}`);
            if (i % 3 === 2) await new Promise(resolve => setTimeout(resolve, 0));
        } catch (error) {
            item.retryCount++;
            item.status = 'failed';
            await saveToLocal('sync_queue', item);
            console.error(`❌ Sync failed: ${item.action} ${item.collection}`, error);
        }
    }
}

async function syncToFirebase(queueItem) {
    const { action, collection, data, targetId, deviceId } = queueItem;
    const ref = db.ref(`${CURRENT_SHOP_ID}/${collection}/${targetId}`);
    // KHÔNG tăng _version (đã tăng ở update/create)
    var syncData = Object.assign({}, data, {
        _syncedAt: firebase.database.ServerValue.TIMESTAMP,
        _syncedBy: deviceId,
        _version: data._version || 1
    });
    if (action === 'create' || action === 'update') {
        await ref.update(syncData);
    } else if (action === 'delete') {
        await ref.remove();
    }
    return true;
}

function subscribeToCollection(collection, callback) {
    const ref = db.ref(`${CURRENT_SHOP_ID}/${collection}`);
    let lastDataStr = '';
    let updateScheduled = false;
    
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

        for (const [id, localItem] of localMap.entries()) {
            if (!remoteMap.has(id)) {
                const createdAt = localItem.createdAt || 0;
                if (now - createdAt >= 5000) toDelete.push(id);
            }
        }
        for (const [id, remoteItem] of remoteMap.entries()) {
            const localItem = localMap.get(id);
            if (!localItem || (remoteItem.updatedAt || 0) > (localItem.updatedAt || 0)) {
                toSave.push(remoteItem);
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
    initNetworkListener();
    initStaffList();

    // Đăng ký lắng nghe tất cả collection cần realtime
    subscribeToCollection('tables', async (tables) => {
        for (const remote of tables) {
            const local = await get('tables', remote.id);
            if (local && local._version !== remote._version) {
                const merged = mergeTableData(local, remote);
                await saveToLocal('tables', merged);
            }
        }
    });
    subscribeToCollection('customers');
    subscribeToCollection('menu');
    subscribeToCollection('menu_categories');  // QUAN TRỌNG
    subscribeToCollection('ingredients');
    subscribeToCollection('transactions');
    subscribeToCollection('reports');

    console.log('✅ Database initialized, device:', CURRENT_DEVICE_ID);
    return { isOnline, deviceId: CURRENT_DEVICE_ID };
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
    updateWithLock, lockTable, unlockTable, getTableLock,
    isOnline: () => isOnline,
    getDeviceId: () => CURRENT_DEVICE_ID,
    subscribe: subscribeToCollection,
    getSyncQueue: () => syncQueue,
    processSyncQueue
};

console.log('✅ db.js loaded - Firebase + Offline Queue ready');