// =====================================================================
// TEST: DOC DANH SACH KEY THAT BAI KHONG DUOC PHAI XOA DU LIEU
// Nap ham that tu pos2018/db.js
// Chay: node test-reconcile-safe.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '.', 'db.js'), 'utf8');
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

// ---- Firebase gia lap: co the bao loi hoac tra du lieu ----
var FB = null;        // du lieu that tren Firebase
var FB_LOI = false;   // mo loi mang
var XOA_TU_LOCAL = [];

function mkSnap(val) {
    return { exists: function () { return val !== null; }, val: function () { return val; } };
}

var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: function () { return 1; }, clearTimeout: function () { },
    Date: Date, Math: Math, JSON: JSON, String: String, Array: Array,
    parseInt: parseInt, isNaN: isNaN, Promise: Promise,
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } }
};
sandbox.window = sandbox;
// Firebase gia lap: doc truc tiep tu host de tien kiem soat
sandbox._mockFbData = null;
sandbox._mockFbLoi = false;
sandbox._getDb = function () {
    return {
        ref: function (p) {
            return {
                once: function (ev, ok, err) {
                    if (sandbox._mockFbLoi) { if (err) err(new Error('mang chap')); return; }
                    if (ok) ok({ exists: function () { return sandbox._mockFbData !== null; },
                                 val: function () { return sandbox._mockFbData; } });
                }
            };
        }
    };
};
vm.createContext(sandbox);
vm.runInContext('var CURRENT_SHOP_ID = "shop1"; var syncQueue = []; var memoryCache = {}; var isOnline = true;' +
    'var MASTER_COLLECTIONS = { customers: true, tables: true };', sandbox);
sandbox.syncQueue = vm.runInContext('syncQueue', sandbox);
sandbox.memoryCache = vm.runInContext('memoryCache', sandbox);

vm.runInContext('var deltaSync = function(){ return Promise.resolve(); };\n' +
    'var saveToLocal = function(c, it){ return Promise.resolve(); };\n' +
    'function deleteFromLocal(col, id){ _mockDeleted.push({col: col, id: id}); return Promise.resolve(); }\n' +
    'var _emit = function(){};\n', sandbox);
sandbox._mockDeleted = XOA_TU_LOCAL;
vm.runInContext(ex('_getFirebaseKeysViaSDK') + '\n' + ex('_getFirebaseKeys') + '\n' +
    ex('_getUnsyncedKeys') + '\n' + ex('reconcileCollection'), sandbox);
// khong dat fetch trong sandbox -> _getFirebaseKeys dung duong SDK
vm.runInContext('var _databaseURL = "https://example.firebaseio.com";', sandbox);

var getKeysSDK = vm.runInContext('_getFirebaseKeysViaSDK', sandbox);
var reconcile = vm.runInContext('reconcileCollection', sandbox);

function setFb(v, loi) { sandbox._mockFbData = v; sandbox._mockFbLoi = !!loi; }
function setMem(keys) {
    vm.runInContext('memoryCache = {};', sandbox);
    vm.runInContext('memoryCache.customers = ' + JSON.stringify(keys) + ';', sandbox);
}
function setQueue(items) {
    vm.runInContext('syncQueue = ' + JSON.stringify(items) + ';', sandbox);
}
function deleted() { return sandbox._mockDeleted.slice(); }
function resetDeleted() { sandbox._mockDeleted.length = 0; }

console.log('TEST: KHONG XOA DU LIEU KHI KHONG XAC MINH DUOC FIREBASE');

(function () {
    var chain = Promise.resolve();

    chain = chain.then(function () {
        group('R1: DOC KEY THAT BAI -> PHAI BAO LOI, KHONG TRA DANH SACH RONG');
        setFb(null, true);
        return getKeysSDK('customers').then(function (r) {
            ok('khong duoc tra {} (se lam xoa sach collection)', false, 'tra ve ' + JSON.stringify(r));
        }).catch(function (e) {
            ok('bao loi thay vi tra danh sach rong', !!e, e && e.message);
        });
    });

    chain = chain.then(function () {
        group('R2: MAT MANG KHI RECONCILE -> KHONG XOA GI CA');
        resetDeleted();
        setFb(null, true);
        // 3 khach trong local, khong muc nao trong hang doi
        setMem({ k1: { id: 'k1' }, k2: { id: 'k2' }, k3: { id: 'k3' } });
        setQueue([]);
        return reconcile('customers').then(function (r) {
            eq('so ban ghi bi xoa', deleted().length, 0);
            ok('bao cho biet da bo qua', r.skipped === true, JSON.stringify(r));
        });
    });

    chain = chain.then(function () {
        group('R3: CO DU LIEU THAT -> VAN XOA BAN GHI THUA');
        resetDeleted();
        setFb({ k1: { id: 'k1' }, k2: { id: 'k2' } }, false);   // k3 khong co tren FB
        setMem({ k1: { id: 'k1' }, k2: { id: 'k2' }, k3: { id: 'k3' } });
        setQueue([]);
        return reconcile('customers').then(function (r) {
            eq('chi xoa k3', deleted().length, 1);
            eq('xoa dung ban ghi', deleted()[0] && deleted()[0].id, 'k3');
        });
    });

    chain = chain.then(function () {
        group('R4: BAN GHI CHUA GUI DI -> PHAI GIU LAI DU KHONG CO TREN FIREBASE');
        resetDeleted();
        setFb({}, false);                       // Firebase chua co gi ca
        setMem({ moi: { id: 'moi' } });
        // muc hàng đợi chưa đồng bộ
        setQueue([{ collection: 'customers', targetId: 'moi', action: 'create', status: 'pending' }]);
        return reconcile('customers').then(function () {
            eq('khong xoa ban ghi dang cho gui', deleted().length, 0);
        });
    });

    chain = chain.then(function () {
        group('R5: BAN GHI DA XOA -> VAN PHAI GIU LAI CHO DEN KHI XOA XONG');
        resetDeleted();
        setFb({}, false);
        setMem({ x: { id: 'x' } });
        setQueue([{ collection: 'customers', targetId: 'x', action: 'remove', status: 'pending' }]);
        return reconcile('customers').then(function () {
            eq('khong xoa nguoc ban ghi dang cho xoa', deleted().length, 0);
        });
    });

    chain = chain.then(function () {
        group('R6: BAN GHI DA XOA XONG -> DUOC PHEP XOA');
        resetDeleted();
        // Firebase phải còn ít nhất 1 key. Nếu trả về 0 key, db.js cố ý BỎ QUA
        // xoá (coi như lỗi đọc / sai shopId) - xem R6b.
        setFb({ khac: { id: 'khac' } }, false);
        setMem({ khac: { id: 'khac' }, x: { id: 'x' } });
        setQueue([{ collection: 'customers', targetId: 'x', action: 'remove', status: 'synced' }]);
        return reconcile('customers').then(function () {
            eq('xoa duoc ban ghi da xoa xong', deleted().length, 1);
            eq('xoa dung ban ghi', deleted()[0] && deleted()[0].id, 'x');
        });
    });

    chain = chain.then(function () {
        group('R6b: FIREBASE TRA 0 KEY -> TU CHOI XOA GI HET');
        resetDeleted();
        setFb({}, false);                       // Firebase khong co gi
        setMem({ a: { id: 'a' }, b: { id: 'b' } });
        setQueue([]);
        return reconcile('customers').then(function (r) {
            eq('khong xoa gi', deleted().length, 0);
            ok('bao cho biet bo qua', r.skipped === true, JSON.stringify(r));
        });
    });

    chain = chain.then(function () {
        group('R7: HANG DOI CHO COLLECTION KHAC KHONG BAO VE COLLECTION NAY');
        resetDeleted();
        setFb({ khac: { id: 'khac' } }, false);
        setMem({ khac: { id: 'khac' }, y: { id: 'y' } });
        // muc cho bang 'tables' trong khi dang xoa thu muc 'customers'.
        // id giong nhau (y) nhung la hai bang khac nhau.
        setQueue([{ collection: 'tables', targetId: 'y', action: 'create', status: 'pending' }]);
        return reconcile('customers').then(function () {
            eq('khach khong co trong hang doi -> van bi xoa dung', deleted().length, 1);
            eq('xoa dung khach y', deleted()[0] && deleted()[0].id, 'y');
        });
    });

    chain.then(function () {
        console.log('\n=========================================');
        console.log('  TONG: ' + (pass + fail) + ' assertions');
        console.log('  PASS: ' + pass);
        console.log('  FAIL: ' + fail);
        console.log('=========================================');
        process.exit(fail === 0 ? 0 : 1);
    });
})();