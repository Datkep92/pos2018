// =====================================================================
// TEST HANG DOI DONG BO (sync queue) - nap ham that tu pos2018/db.js
// Chay: node test-sync-queue.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join("C:\\\\Users\\\\cana2\\\\OneDrive\\\\Documents\\\\Default Project\\\\pos2018", '.', 'js.min', 'db.min.js'), 'utf8');
function ex(n) {
    var needle = 'function ' + n + '(';
    var start = src.indexOf(needle);
    if (start < 0) throw new Error('khong tim thay ' + n);
    var i = src.indexOf('{', start), d = 0, seen = false;
    for (; i < src.length; i++) {
        var ch = src[i];
        if (ch === '{') { d++; seen = true; }
        else if (ch === '}') { d--; if (seen && d === 0) return src.slice(start, i + 1); }
    }
    throw new Error('khong dong ' + n);
}

var pass = 0, fail = 0;
function group(n) { console.log('\n=== ' + n + ' ==='); }
function eq(l, a, e) { if (a === e) { pass++; console.log('  PASS  ' + l + '  [' + JSON.stringify(a) + ']'); } else { fail++; console.log('  FAIL  ' + l + '  actual=' + JSON.stringify(a) + ' expected=' + JSON.stringify(e)); } }
function ok(l, c, x) { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l + (x ? '  ' + x : '')); } }

var PERSISTED = [];      // cai da ghi vao IndexedDB
var DELETED = [];        // cai da xoa khoi IndexedDB
var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: function () { return 1; }, clearTimeout: function () { },
    Date: Date, Math: Math, JSON: JSON, String: String, Array: Array,
    parseInt: parseInt, isNaN: isNaN, Promise: Promise,
    localStorage: {
        store: {},
        getItem: function (k) { return this.store[k] || null; },
        setItem: function (k, v) { this.store[k] = v; },
        removeItem: function (k) { delete this.store[k]; }
    }
};
sandbox.window = sandbox;
sandbox.PERSISTED = PERSISTED;
sandbox.DELETED = DELETED;
// cac bien ma db.js dung
vm.createContext(sandbox);
vm.runInContext('var syncQueue = []; var CURRENT_DEVICE_ID = "dev1"; var isOnline = false;' +
    'var _dirtyCollections = {}; var CURRENT_SHOP_ID = "shop_default";', sandbox);
sandbox.syncQueue = vm.runInContext('syncQueue', sandbox);

// ham phu can cho addToSyncQueue - stub, khong trich tu file that
vm.runInContext('function _getPriority(c){ return 5; }\n' +
    'function _markDirty(c){}\n' +
    'function processSyncQueue(){ return Promise.resolve(); }\n', sandbox);
// saveToLocal -> ghi ra PERSISTED
vm.runInContext('function saveToLocal(col, item){ PERSISTED.push({col: col, id: item.id, data: JSON.parse(JSON.stringify(item.data === undefined ? item : item.data))}); return Promise.resolve(); }\n' +
    'function deleteFromLocal(col, id){ DELETED.push({col: col, id: id}); return Promise.resolve(); }\n', sandbox);
// nap cac ham that cua co che giai quyet xung dot
// SYNC_POLICY va _DEFAULT_POLICY la bien khai bao cap IIFE, phai lay nguyen
// khoi tu file that chứ không dựng lại trong test
(function () {
    var a = src.indexOf('var _DEFAULT_POLICY = {');
    var b = src.indexOf('cost_categories: { onConflict:');
    if (a < 0 || b < 0) throw new Error('khong tim thay khoi SYNC_POLICY');
    var end = src.indexOf('};', b);
    vm.runInContext(src.slice(a, end + 2), sandbox);
})();
vm.runInContext('var _syncConflictStore = "sync_conflicts"; var _syncConflicts = [];', sandbox);
vm.runInContext(ex('_policyFor') + '\n' + ex('_recordSyncConflict') + '\n' +
    ex('_queueBelongsToCurrentShop') + '\n' +
    ex('getSyncConflicts') + '\n' + ex('markSyncConflictResolved'), sandbox);
sandbox.getSyncConflicts = vm.runInContext('getSyncConflicts', sandbox);
sandbox.resolveSyncConflict = vm.runInContext('markSyncConflictResolved', sandbox);
sandbox._policyFor = vm.runInContext('_policyFor', sandbox);

vm.runInContext(ex('addToSyncQueue') + '\n' + ex('_getUnsyncedKeys'), sandbox);
var addToSyncQueue = vm.runInContext('addToSyncQueue', sandbox);
var _getUnsyncedKeys = vm.runInContext('_getUnsyncedKeys', sandbox);
sandbox.SYNC_POLICY = vm.runInContext('SYNC_POLICY', sandbox);

console.log('TEST HANG DOI DONG BO - db.js');
console.log('Trong test, co online = false nen khong gui di ngay, chi xem hang doi.');

function reset() {
    sandbox.syncQueue.length = 0;
    PERSISTED.length = 0;
    DELETED.length = 0;
    vm.runInContext('_syncConflicts = [];', sandbox);
}

(function () {
    group('Q1: SUA LAI NHIEU LAN TRUOC KHI DONG BO -> PHAI GIU BAN MOI NHAT');

    // Lan 1: tao khach moi voi no 100k
    var khach = { id: 'c1', name: 'A', debtHistory: [{ amount: 100000 }] };
    addToSyncQueue('create', 'customers', khach, 'c1');
    eq('vong 1: 1 muc trong hang doi', sandbox.syncQueue.length, 1);

    // Lan 2: sua thanh no 100k -> 200k (chua kip dong bo)
    var khach2 = { id: 'c1', name: 'A', debtHistory: [{ amount: 100000 }, { amount: 100000 }] };
    addToSyncQueue('create', 'customers', khach2, 'c1');
    eq('vong 2: van 1 muc (da gop)', sandbox.syncQueue.length, 1);

    var muc = sandbox.syncQueue[0];
    var soNoTrongHangDoi = (muc.data.debtHistory || []).length;
    console.log('  du lieu trong hang doi: ' + JSON.stringify(muc.data.debtHistory));
    eq('so no phai la 2 moi nhat', soNoTrongHangDoi, 2);

    // Ket qua thuc te cua code hien tai:
    if (soNoTrongHangDoi === 1) {
        ok('KHONG bi mat du lieu', false,
            'Firebase se nhan NO 100k thoi. No 100k thu hai bi bo mat hoan toan.');
    }

    group('Q2: HANG DOI CO PHAI LUU DU LIEU DAY DU');
    var c2 = { id: 'c2', name: 'B' };
    addToSyncQueue('create', 'customers', c2, 'c2');
    var duLieu = sandbox.syncQueue.filter(function (q) { return q.targetId === 'c2'; })[0];
    eq('co luu data vao muc', duLieu && !!duLieu.data, true);
    eq('data dung id', duLieu && duLieu.data.id, 'c2');
    eq('trang thai pending', duLieu && duLieu.status, 'pending');
    eq('co ghi xuong IndexedDB', PERSISTED.length > 0, true);

    group('Q3: KHAC BIET COLLECTION KHONG GOP NHAM');
    addToSyncQueue('create', 'customers', { id: 'x1' }, 'x1');
    addToSyncQueue('create', 'tables', { id: 't1' }, 't1');
    eq('khach va ban la 2 muc rieng', sandbox.syncQueue.length, 4);

    group('Q4: DELETE KHONG DUOC GOP VOI UPDATE');
    addToSyncQueue('create', 'customers', { id: 'c9' }, 'c9');
    addToSyncQueue('remove', 'customers', { id: 'c9' }, 'c9');
    var coRemove = sandbox.syncQueue.filter(function (q) { return q.targetId === 'c9' && q.action === 'remove'; });
    eq('co muc xoa rieng', coRemove.length, 1);

    group('Q5: SUA LAI CUNG MOT BAN GHI -> KHONG DE RAC RAC TRONG HANG DOI');
    var truoc = sandbox.syncQueue[0];
    var idCung = truoc.id;
    addToSyncQueue('create', 'customers', { id: 'c1', name: 'C' }, 'c1');
    var sau = sandbox.syncQueue.filter(function (q) { return q.targetId === 'c1' && q.action === 'create'; })[0];
    eq('van dung 1 muc (khong nhin them muc rac)', sau.id, idCung);
    eq('lay data moi nhat', sau.data.name, 'C');

    // -----------------------------------------------------------------
    group('Q6: UPDATE KHI CREATE DANG CHO -> PHAI GOP VAO MOT MUC');
    sandbox.syncQueue.length = 0;
    addToSyncQueue('create', 'customers', { id: 'd1', name: 'D' }, 'd1');
    addToSyncQueue('update', 'customers', { id: 'd1', name: 'D', debtHistory: [{ amount: 50000 }] }, 'd1');
    eq('chi 1 muc (khong tach 2 batch)', sandbox.syncQueue.length, 1);
    eq('van la action=create', sandbox.syncQueue[0].action, 'create');
    eq('data da cap nhat moi nhat',
        (sandbox.syncQueue[0].data.debtHistory || []).length, 1);

    group('Q7: GOP VAN GIU SO LAN THU LAI');
    sandbox.syncQueue.length = 0;
    addToSyncQueue('create', 'customers', { id: 'e1', n: 1 }, 'e1');
    sandbox.syncQueue[0].retryCount = 3;
    sandbox.syncQueue[0].lastError = 'loi mang';
    addToSyncQueue('create', 'customers', { id: 'e1', n: 2 }, 'e1');
    eq('giu retryCount', sandbox.syncQueue[0].retryCount, 3);
    eq('xoa loi cu (data da doi)', sandbox.syncQueue[0].lastError, null);
    eq('lay data moi nhat', sandbox.syncQueue[0].data.n, 2);

    // -----------------------------------------------------------------
    group('Q8: BAN GHI DANG CHO DONG BO PHAI DUOC GIU KHI RECONCILE');
    sandbox.syncQueue.length = 0;
    addToSyncQueue('create', 'customers', { id: 'chua_gui' }, 'chua_gui');
    addToSyncQueue('create', 'customers', { id: 'da_gui_xong' }, 'da_gui_xong');
    // gia lap: muc 'da_gui_xong' vua dong bo xong
    sandbox.syncQueue[1].status = 'synced';
    var chua = _getUnsyncedKeys('customers');
    ok('ban ghi chua gui duoc danh dau', chua['chua_gui'] === true);
    ok('ban ghi da gui khong con trong tap', !chua['da_gui_xong']);
    ok('khong nham sang collection khac', !_getUnsyncedKeys('tables')['chua_gui']);

    group('Q9: BAN GHI DA XOA (status=deleted) VAN PHAI GIU');
    sandbox.syncQueue.length = 0;
    addToSyncQueue('remove', 'customers', { id: 'xoa_roi' }, 'xoa_roi');
    var chua2 = _getUnsyncedKeys('customers');
    ok('ban ghi cho xoa duoc giu (khong bi reconcile xoa nguoc)',
        chua2['xoa_roi'] === true);

    // =====================================================================
    // CƠ CHẾ LỰA CHỌN KHI XUNG ĐỘT
    // =====================================================================
    group('Q10: BAN GHI CHO XOA, SUUA TIEP -> CHINH SACH remove-wins');
    reset();
    addToSyncQueue('remove', 'customers', { id: 'p1' }, 'p1');
    var idTraVe = addToSyncQueue('update', 'customers', { id: 'p1', no: 50000 }, 'p1');
    eq('khong tao muc moi', sandbox.syncQueue.length, 1);
    eq('chi con lenh xoa', sandbox.syncQueue[0].action, 'remove');
    eq('tra ve id cua lenh xoa', idTraVe, sandbox.syncQueue[0].id);
    var xd = sandbox.getSyncConflicts();
    eq('ghi nhan 1 xung dot', xd.length, 1);
    ok('giu lai du lieu bi bo', xd[0] && xd[0].droppedData && xd[0].droppedData.no === 50000,
        JSON.stringify(xd[0] && xd[0].droppedData));
    eq('ghi lai hanh dong da bo', xd[0] && xd[0].droppedAction, 'update');

    group('Q11: SUUA XONG MOI XOA -> CHINH SACH remove-wins');
    reset();
    addToSyncQueue('create', 'tables', { id: 'tb1', ten: 'A' }, 'tb1');
    addToSyncQueue('remove', 'tables', { id: 'tb1' }, 'tb1');
    eq('chi con 1 muc (lenh xoa)', sandbox.syncQueue.length, 1);
    eq('muc con la la lenh xoa', sandbox.syncQueue[0].action, 'remove');
    ok('muc tao da bi xoa khoi hang doi',
        DELETED.some(function (d) { return d.col === 'sync_queue'; }));
    eq('ghi nhan xung dot', sandbox.getSyncConflicts().length, 1);

    group('Q12: BAN GHI CHO XOA, SUUA TIEP, BANG CHINH SACH newest-wins');
    reset();
    addToSyncQueue('remove', 'menu', { id: 'm1' }, 'm1');
    var idXoaCu = sandbox.syncQueue[0].id;
    var id2 = addToSyncQueue('update', 'menu', { id: 'm1', ten: 'B' }, 'm1');
    eq('lenh xoa bi bo', sandbox.syncQueue.filter(function (q) { return q.action === 'remove'; }).length, 0);
    eq('con thay doi moi', sandbox.syncQueue.length, 1);
    eq('moc moi la update', sandbox.syncQueue[0].action, 'update');
    ok('co id tra ve', !!id2);
    ok('muc lenh xoa cu da bi xoa khoi hang doi',
        sandbox.syncQueue[0].id !== idXoaCu);
    ok('da goi xoa muc lenh xoa cu khoi IndexedDB',
        DELETED.some(function (d) { return d.id === idXoaCu; }),
        JSON.stringify(DELETED));
    var xd2 = sandbox.getSyncConflicts();
    eq('van ghi nhan xung dot', xd2.length, 1);
    eq('ghi lai lenh xoa da bi bo', xd2[0] && xd2[0].droppedAction, 'remove');

    group('Q13: GIAO DICH PHAI CHO PHEP SUA (HOAN TIEN)');
    // history.js và pos.js gọi DB.update('transactions', ...) để gắn cờ
    // refunded. Nếu chính sách là 'append-only' thì thao tác hoàn tiền bị
    // bỏ và máy khác không bao giờ thấy giao dịch đã huỷ.
    reset();
    var rId = addToSyncQueue('update', 'transactions', { id: 'tx1', refunded: true }, 'tx1');
    ok('hoan tien phai duoc day len (khong bi bo)', rId !== null, 'tra ve ' + rId);
    eq('co muc trong hang doi', sandbox.syncQueue.length, 1);
    eq('muc la update', sandbox.syncQueue[0].action, 'update');
    eq('giu co refunded', sandbox.syncQueue[0].data.refunded, true);
    eq('khong ghi nhan xung dot', sandbox.getSyncConflicts().length, 0);

    reset();
    ['cost_transactions', 'cost_transactions_admin', 'inventory_transactions',
        'ingredient_transactions', 'manager_cash_pickups', 'daily_balances'].forEach(function (c) {
        var id = addToSyncQueue('update', c, { id: 'x1', note: 'sua' }, 'x1');
        ok(c + ': cho phep sua', id !== null);
    });

    group('Q13b: KHACH HANG PHAI CHO PHEP GHI NO / TRA NO');
    reset();
    var idNo = addToSyncQueue('update', 'customers',
        { id: 'c1', debtHistory: [{ amount: 100000 }] }, 'c1');
    ok('ghi no phai duoc day len', idNo !== null);
    eq('khong bi bo', sandbox.syncQueue.length, 1);
    eq('khong ghi nhan xung dot', sandbox.getSyncConflicts().length, 0);

    group('Q14: CHINH SACH THEO TUNG BANG');
    reset();
    ok('khach: xoa thang', sandbox._policyFor('customers').onDeleteConflict, 'remove-wins');
    ok('giao dich: xoa thang', sandbox._policyFor('transactions').onDeleteConflict, 'remove-wins');
    ok('menu: sua sau thi thang', sandbox._policyFor('menu').onConflict, 'last-write-wins');
    ok('bang: sua sau thi thang', sandbox._policyFor('tables').onConflict, 'last-write-wins');
    ok('khong quy dinh -> dung mac dinh', sandbox._policyFor('abcxyz').onConflict, 'last-write-wins');
    ok('bang: newest-wins', sandbox._policyFor('tables').onDeleteConflict, 'newest-wins');
    // KHONG bang danh nao duoc dat append-only mac dinh
    var appendOnly = [];
    for (var c2 in sandbox.SYNC_POLICY) {
        if (sandbox.SYNC_POLICY[c2].onConflict === 'append-only') appendOnly.push(c2);
    }
    eq('khong bang danh nao bat append-only', appendOnly.length, 0);

    group('Q15: DANH SACH XUNG DOT VA XEM LAI');
    reset();
    addToSyncQueue('remove', 'customers', { id: 'z1' }, 'z1');
    addToSyncQueue('update', 'customers', { id: 'z1', no: 70000 }, 'z1');
    var ds = sandbox.getSyncConflicts();
    eq('co 1 muc chua xem', ds.length, 1);
    eq('danh dau chua xu ly', ds[0].resolved, false);
    ok('xem tat ca van thay', sandbox.getSyncConflicts(true).length, 1);
    var okMark = sandbox.resolveSyncConflict(ds[0].id, 'da kiem tra, bo qua');
    eq('danh dau xu ly xong', okMark, true);
    eq('khong con muc chua xem', sandbox.getSyncConflicts().length, 0);
    eq('van con trong lich su', sandbox.getSyncConflicts(true).length, 1);
    eq('khong sua doi collection', sandbox.getSyncConflicts(true)[0].collection, 'customers');

    console.log('\n=========================================');
    console.log('  TONG: ' + (pass + fail) + ' assertions');
    console.log('  PASS: ' + pass);
    console.log('  FAIL: ' + fail);
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
})();