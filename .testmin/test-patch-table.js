// =====================================================================
// TEST: GHI BAN NGUYEN TO - KHONG MAT MON KHI 2 MAY THAO TAC DONG THOI
// Nap code THAT tu pos2018/db.js
// Chay: node test-patch-table.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join("C:\\\\Users\\\\cana2\\\\OneDrive\\\\Documents\\\\Default Project\\\\pos2018", '.', 'js.min', 'db.min.js'), 'utf8');
function ex(n) {
    var s = src.indexOf('function ' + n + '(');
    if (s < 0) throw new Error('khong tim thay ' + n);
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

var TB = 'shop_A/tables/tb5';
var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: function () { return 1; }, clearTimeout: function () { },
    Date: Date, Math: Math, JSON: JSON, String: String, Array: Array,
    parseInt: parseInt, isNaN: isNaN, Promise: Promise,
    localStorage: { getItem: function () { return null; }, setItem: function () { } }
};
sandbox.window = sandbox;
sandbox.STORE = {};
sandbox._getDb = function () {
    return { ref: function (p) {
        return { transaction: function (cb) {
            var cur = Object.prototype.hasOwnProperty.call(sandbox.STORE, p) ? JSON.parse(JSON.stringify(sandbox.STORE[p])) : null;
            var next = cb(cur);
            if (next === undefined) return Promise.resolve({ committed: false });
            sandbox.STORE[p] = next;
            return Promise.resolve({ committed: true });
        } };
    } };
};
vm.createContext(sandbox);
vm.runInContext('var CURRENT_SHOP_ID = "shop_A"; var CURRENT_DEVICE_ID = "dev1"; var memoryCache = {}; var _suppressRealtime = 0;', sandbox);
vm.runInContext('function saveToLocal(c, it){ if(memoryCache[c]) memoryCache[c][it.id] = it; return Promise.resolve(); }\n' +
    'function _notifyLocal(){}\n', sandbox);
vm.runInContext(ex('patchTable') + '\n' + ex('addItemsToTable') + '\n' + ex('removeItemsFromTable'), sandbox);
var addItems = vm.runInContext('addItemsToTable', sandbox);
var removeItems = vm.runInContext('removeItemsFromTable', sandbox);

function ban() { return sandbox.STORE[TB]; }
function soMon() { return ban() && ban().items ? ban().items.length : 0; }
function timTen(n) { var b = ban(); if (!b || !b.items) return 0; var c = 0; for (var i = 0; i < b.items.length; i++) if (b.items[i].name === n) c += b.items[i].qty; return c; }

function reset(items) {
    sandbox.STORE[TB] = { id: 'tb5', name: 'Bàn 5', total: 0, items: items || [], ingredientsDeducted: true };
}

console.log('TEST GHI BAN NGUYEN TO - pos2018/db.js');

var chain = Promise.resolve();

chain = chain.then(function () {
    group('P1: THEM MON DON GIAN');
    reset();
    return addItems('tb5', [{ id: 'a1', name: 'Cà phê', price: 30000, qty: 2 }]).then(function (r) {
        eq('ghi thanh cong', r.ok, true);
        eq('so mon', soMon(), 1);
        eq('so luong', timTen('Cà phê'), 2);
        eq('tong tien dung', ban().total, 60000);
    });
});

chain = chain.then(function () {
    group('P2: GHI DE CHUNG TEN -> TANG SO LUONG KHONG TAO DONG MOI');
    reset();
    return addItems('tb5', [{ id: 'a1', name: 'Cà phê', price: 30000, qty: 1 }]).then(function () {
        return addItems('tb5', [{ id: 'a2', name: 'Cà phê', price: 30000, qty: 3 }]);
    }).then(function () {
        eq('van 1 dong', soMon(), 1);
        eq('cong lai so luong', timTen('Cà phê'), 4);
    });
});

chain = chain.then(function () {
    group('P3: HAI MAY CUNG THEM MON -> KHONG MAT MON NAO');
    reset([{ id: 'x1', name: 'Trà', price: 25000, qty: 1 }]);
    // goi dong thoi, khong await - gia lap 2 may bam cung luc
    var a = addItems('tb5', [{ id: 'm1', name: 'Bạc xỉu', price: 35000, qty: 2 }]);
    var b = addItems('tb5', [{ id: 'm2', name: 'Cà phê sữa', price: 45000, qty: 1 }]);
    return Promise.all([a, b]).then(function () {
        eq('ca 3 mon deu con', soMon(), 3);
        ok('mon may A con nguyen', timTen('Bạc xỉu') === 2, 'qty=' + timTen('Bạc xỉu'));
        ok('mon may B con nguyen', timTen('Cà phê sữa') === 1, 'qty=' + timTen('Cà phê sữa'));
        ok('mon co san truoc do khong mat', timTen('Trà') === 1, 'qty=' + timTen('Trà'));
        var tinh = 0;
        for (var i = 0; i < ban().items.length; i++) tinh += ban().items[i].price * ban().items[i].qty;
        eq('tong tien khop voi tong don', ban().total, tinh);
        eq('tong tien dung', ban().total, 25 + 70 + 45 === 0 ? 0 : 25 * 1000 + 35000 * 2 + 45000);
    });
});

chain = chain.then(function () {
    group('P4: XOA MON THEO MA KHONG PHA NHAM');
    reset([
        { id: 'i1', name: 'A', price: 10000, qty: 1 },
        { id: 'i2', name: 'B', price: 20000, qty: 1 },
        { id: 'i3', name: 'C', price: 30000, qty: 1 }
    ]);
    return removeItems('tb5', function (it) { return it.id === 'i2'; }).then(function (r) {
        eq('xoa thanh cong', r.ok, true);
        eq('con 2 mon', soMon(), 2);
        ok('xoa dung mon B', timTen('B') === 0);
        eq('tong tien dung', ban().total, 40000);
    });
});

chain = chain.then(function () {
    group('P5: MAU MA DO KHONG LUU');
    reset([{ id: 'k1', name: 'X', price: 10000, qty: 1 }]);
    return removeItems('tb5', function (it) { return it.id === 'khong-ton-tai'; }).then(function (r) {
        eq('khong xoa gi', soMon(), 1);
        ok('bao khong commit', r.ok === false);
    });
});

chain = chain.then(function () {
    group('P6: BAN DA BI XOA O MAY KHAC');
    delete sandbox.STORE[TB];
    return addItems('tb5', [{ id: 'z', name: 'Q', price: 1000, qty: 1 }]).then(function (r) {
        eq('khong ghi them', r.ok, false);
        ok('va khong tao lai ban', sandbox.STORE[TB] === undefined);
    });
});

chain = chain.then(function () {
    group('P7: KHONG THEM TRUONG MOI NAO');
    reset([{ id: 'q1', name: 'Z', price: 10000, qty: 1, addedTime: '2026-10-01T10:00:00.000Z' }]);
    var truoc = Object.keys(ban()).sort().join(',');
    return addItems('tb5', [{ id: 'n1', name: 'Y', price: 5000, qty: 1 }]).then(function () {
        var sau = Object.keys(ban()).sort().join(',');
        var bo = function (s) { return s.split(',').filter(function (k) { return k !== 'updatedAt' && k !== 'updatedBy'; }).join(','); };
        eq('khong them truong nao', bo(sau), bo(truoc));
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