// =====================================================================
// TEST: HANG DOI DONG BO PHAI THUOC VE DUNG SHOP
// Nap code THAT tu pos2018/db.js
// Chay: node test-shop-scope.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '.', 'db.js'), 'utf8');
function ex(n) {
    var s = src.indexOf('function ' + n + '(');
    if (s < 0) throw new Error('khong tim thay ham ' + n);
    var i = src.indexOf('{', s), d = 0, seen = false;
    for (; i < src.length; i++) {
        if (src[i] === '{') { d++; seen = true; }
        else if (src[i] === '}') { d--; if (seen && d === 0) return src.slice(s, i + 1); }
    }
    throw new Error('khong dong ' + n);
}

var pass = 0, fail = 0;
function group(n) { console.log('\n=== ' + n + ' ==='); }
function eq(l, a, e) { if (a === e) { pass++; console.log('  PASS  ' + l + '  [' + JSON.stringify(a) + ']'); } else { fail++; console.log('  FAIL  ' + l + '  actual=' + JSON.stringify(a) + ' expected=' + JSON.stringify(e)); } }
function ok(l, c, x) { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l + (x ? '  ' + x : '')); } }

// Firebase gia lap: ghi lai duong dan de biet muc nao bi day nham sang shop nao
var WRITES = [];
var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: function (fn, ms) { return 1; }, clearTimeout: function () { },
    Date: Date, Math: Math, JSON: JSON, String: String, Array: Array, Number: Number,
    parseInt: parseInt, isNaN: isNaN, Promise: Promise,
    firebase: {
        database: {
            ServerValue: { TIMESTAMP: 'SERVER_TS' }
        }
    },
    localStorage: { getItem: function () { return null; }, setItem: function () { }, removeItem: function () { } }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext('var CURRENT_SHOP_ID = "shop_A"; var syncQueue = []; var isOnline = false;' +
    'var CURRENT_DEVICE_ID = "dev1"; var memoryCache = {};', sandbox);
sandbox.syncQueue = vm.runInContext('syncQueue', sandbox);
sandbox.WRITES = WRITES;

vm.runInContext('function _getPriority(){ return 5; }\n' +
    'function _markDirty(){}\n' +
    'function saveToLocal(col, it){ return Promise.resolve(); }\n' +
    'function deleteFromLocal(col, id){ return Promise.resolve(); }\n' +
    'function _getDb(){ return { ref: function(p){ return { update: function(o){ WRITES.push({ path: p, data: o }); return Promise.resolve(); } }; } }; }\n' +
    'var _deferred = null;\n' +
    'function processSyncQueue(){ _deferred = true; return Promise.resolve(); }\n', sandbox);

// nap co che giai quyet xung cot
(function () {
    var a = src.indexOf('var _DEFAULT_POLICY = {');
    var b = src.indexOf('cost_categories: { onConflict:');
    var end = src.indexOf('};', b);
    vm.runInContext(src.slice(a, end + 2), sandbox);
})();
vm.runInContext('var _syncConflictStore = "sync_conflicts"; var _syncConflicts = [];', sandbox);
vm.runInContext(ex('_policyFor') + '\n' + ex('_recordSyncConflict') + '\n' + ex('_queueBelongsToCurrentShop'), sandbox);
vm.runInContext(ex('addToSyncQueue'), sandbox);
var addToSyncQueue = vm.runInContext('addToSyncQueue', sandbox);

console.log('TEST: HANG DOI DONG BO KHONG DUOC LAN SANG SHOP KHAC');

(function () {
    group('S1: MUC CHO GHI LAI SHOP NAO');
    vm.runInContext('syncQueue = [];', sandbox);
    WRITES.length = 0;
    addToSyncQueue('create', 'transactions', { id: 'tx1', amount: 50000 }, 'tx1');
    var m = sandbox.syncQueue[0];
    ok('co truong shopId', m && m.shopId !== undefined, JSON.stringify(m));
    eq('shopId dung shop hien tai', m && m.shopId, 'shop_A');

    group('S2: DOI SHOP -> MUC CU KHONG DUOC DAY SANG SHOP MOI');
    // shop_A co 1 giao dich chua gui (dung kieu cu da co san)
    vm.runInContext('CURRENT_SHOP_ID = "shop_A";', sandbox);
    vm.runInContext('syncQueue = [];', sandbox);
    addToSyncQueue('create', 'transactions', { id: 'tx_A', amount: 50000 }, 'tx_A');
    eq('muc cua shop_A duoc gan shopId', sandbox.syncQueue[0].shopId, 'shop_A');

    // nguoi dung dang nhap shop_B: clearLocalData() GIU LAI sync_queue roi doi shop
    vm.runInContext('CURRENT_SHOP_ID = "shop_B";', sandbox);
    var all = sandbox.syncQueue;
    var cuaShopB = all.filter(function (q) { return q.shopId === 'shop_B'; });
    eq('KHONG muc nao cua shop_A bi tinh la cua shop_B', cuaShopB.length, 0);
    ok('muc van con trong hang doi (khong bi xoa mat)', all.length === 1);
    eq('muc giu nguyen shop cu', all[0].shopId, 'shop_A');

    group('S3: MUC MOI TRONG SHOP MOI VAN DUOC GHI DUNG SHOP');
    addToSyncQueue('create', 'transactions', { id: 'tx_B', amount: 70000 }, 'tx_B');
    var cuaB = sandbox.syncQueue.filter(function (q) { return q.shopId === 'shop_B'; });
    eq('1 muc thuoc shop_B', cuaB.length, 1);
    eq('muc do la cua shop_B', cuaB[0].targetId, 'tx_B');

    console.log('\n=========================================');
    console.log('  TONG: ' + (pass + fail) + ' assertions');
    console.log('  PASS: ' + pass);
    console.log('  FAIL: ' + fail);
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
})();