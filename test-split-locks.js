// =====================================================================
// TEST: KHOA CHONG BAM HAI LAN TRONG split-transfer-merge.js
// Nap code THAT tu pos2018/split-transfer-merge.js
// Chay: node test-split-locks.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '.', 'split-transfer-merge.js'), 'utf8');
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

var TOASTS = [];
var locks = {};
var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: function () { return 1; }, clearTimeout: function () { },
    Date: Date, Math: Math, JSON: JSON, String: String, Array: Array,
    parseInt: parseInt, isNaN: isNaN, Promise: Promise,
    localStorage: { getItem: function () { return null; }, setItem: function () { } }
};
sandbox.window = sandbox;
sandbox.showToast = function (m) { TOASTS.push(m); };

// DB gia lap voi khoa that su dung chung voi db.js
sandbox.DB = {
    acquireBusyLock: function (k) {
        if (locks[k]) return false;
        locks[k] = true;
        return true;
    },
    releaseBusyLock: function (k) { delete locks[k]; },
    isBusyLocked: function (k) { return !!locks[k]; },
    _getShopId: function () { return 'shop1'; }
};
vm.createContext(sandbox);
vm.runInContext(ex('_releaseSplitTransferLock') + '\n' + ex('_splitTransferLocked'), sandbox);
var locked = vm.runInContext('_splitTransferLocked', sandbox);
var release = vm.runInContext('_releaseSplitTransferLock', sandbox);

console.log('TEST KHOA CHONG BAM HAI LAN - split-transfer-merge.js');

(function () {
    group('S1: LAY KHOA LAN 1 -> DUOC');
    var chay = locked('splitPay_tb1', 'chia hoá đơn');
    eq('lan 1 khong bi chan', chay, false);
    eq('da giu khoa', sandbox.DB.isBusyLocked('splitPay_tb1'), true);
    ok('co hien thi thong bao cho nguoi dung', TOASTS.length === 0);

    group('S2: BAM LAN 2 TRONG KHI LAN 1 DANG CHAY -> BI CHAN');
    var chay2 = locked('splitPay_tb1', 'chia hoá đơn');
    eq('lan 2 bi bao la dang chay', chay2, true);
    eq('khong ghi them gi', Object.keys(locks).length, 1);

    group('S3: NHANHHA THI MO LAI DUOC');
    release('splitPay_tb1');
    eq('da nha khoa', sandbox.DB.isBusyLocked('splitPay_tb1'), false);
    eq('bam lai duoc', locked('splitPay_tb1', 'chia hoá đơn'), false);

    group('S4: KHOA KHAC NHAU KHANH NHAU');
    release('splitPay_tb1');
    locked('merge_a_b', 'gộp bàn');
    locked('delTable_x', 'xoá bàn');
    locked('transfer_y', 'chuyển bàn');
    eq('3 khoa dang hoat dong', Object.keys(locks).length, 3);
    var chan = locked('merge_a_b', 'gộp bàn');
    eq('gộp bàn bị chặn lần 2', chan, true);
    var banKhac = locked('merge_x_y', 'gộp bàn');
    eq('cặp bàn khac van chay duoc', banKhac, false);

    group('S5: NHANH HA TOAN BO');
    Object.keys(locks).forEach(function (k) { release(k); });
    eq('khong con khoa nao', Object.keys(locks).length, 0);

    group('S6: KHONG THAM SO DB VAN CHAY DUOC (fallback an toan)');
    var dbCua = sandbox.DB;
    sandbox.DB = {};
    var chayKhongDB = locked('x', 'test');
    eq('khong co DB thi khong chan (khong lam hong chuc nang)', chayKhongDB, false);
    sandbox.DB = dbCua;

    console.log('\n=========================================');
    console.log('  TONG: ' + (pass + fail) + ' assertions');
    console.log('  PASS: ' + pass);
    console.log('  FAIL: ' + fail);
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
})();