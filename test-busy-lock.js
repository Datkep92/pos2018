// =====================================================================
// TEST: KHOA CHONG BAM HAI LAN TRONG DB
// Nap ham THAT tu pos2018/db.js
// Chay: node test-busy-lock.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join(__dirname, '.', 'db.js'), 'utf8');
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

var timers = [];
var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    // giu lai handler cua setTimeout de kiem tra TTL, khong chay that
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
    clearTimeout: function (id) { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    Date: Date, Math: Math, JSON: JSON, String: String, Array: Array, Promise: Promise,
    parseInt: parseInt, isNaN: isNaN
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext('var _busyLocks = {};', sandbox);
vm.runInContext(ex('acquireBusyLock') + '\n' + ex('releaseBusyLock') + '\n' +
    ex('isBusyLocked') + '\n' + ex('withBusyLock'), sandbox);
var acquire = vm.runInContext('acquireBusyLock', sandbox);
var release = vm.runInContext('releaseBusyLock', sandbox);
var isLocked = vm.runInContext('isBusyLocked', sandbox);
var withLock = vm.runInContext('withBusyLock', sandbox);

console.log('TEST KHOA CHONG THAO TAC TRUNG LAP - db.js');

(function () {
    group('L1: LAN 2 BI CHAN');
    eq('lan 1 lay duoc', acquire('pay1'), true);
    ok('da khoa', isLocked('pay1'));
    eq('lan 2 bi chan', acquire('pay1'), false);
    eq('van khoa sau lan 2 bi chan', isLocked('pay1'), true);

    group('L2: KHOA KHAC NHAU KHANH NHAU');
    eq('khoa A', acquire('payA'), true);
    eq('khoa B khong bi A chan', acquire('payB'), true);
    release('payA');
    eq('A da nha', isLocked('payA'), false);
    ok('B van con', isLocked('payB'));
    release('payB');

    group('L3: NHA KHOA THI MỞ LẠI DUOC NGAY');
    acquire('pay2');
    release('pay2');
    eq('lay duoc lai', acquire('pay2'), true);
    release('pay2');

    group('L4: KHOA KHUONG DAN DUNG');
    release('pay3');
    eq('true', acquire('pay3'), true);
    eq('false', acquire('pay3'), false);
    release('pay3');
    ok('sau khi nha thi false', isLocked('pay3') === false);

    group('L5: TTL - QUEN NHA KHOA THI VAN MO LAI DUOC');
    timers.length = 0;
    acquire('pay4', 50);
    ok('dang khoa', isLocked('pay4'));
    ok('co 1 timer TTL da len', timers.length === 1, 'so timer=' + timers.length);
    eq('TTL dung 50ms', timers[0].ms, 50);
    // mo rong thoi gian: chay callback cua timer
    timers[0].fn();
    ok('het TTL thi khoa mo', isLocked('pay4') === false);
    eq('va lay duoc lai', acquire('pay4', 50), true);
    release('pay4');

    group('L6: TIMER CU CUA KHOA CU BI HUY KHI NHA');
    timers.length = 0;
    acquire('pay5', 999);
    release('pay5');
    ok('timer da bi huy', timers[0].cancelled === true);
    ok('khoa da mo', isLocked('pay5') === false);

    group('L7: withBusyLock - BO CHAY DUNG MOT LAN');
    var soLan = 0;
    var p1 = withLock('w1', 5000, function () {
        soLan++;
        return new Promise(function (res) { setTimeout(function () { res('xong'); }, 5); });
    });
    var p2 = withLock('w1', 5000, function () { soLan++; return 'lan2'; });
    return Promise.all([p1, p2]).then(function (rs) {
        eq('chi chay 1 lan', soLan, 1);
        eq('ket qua that', rs[0], 'xong');
        ok('lan 2 bi bo qua', rs[1] && rs[1].skipped === true, JSON.stringify(rs[1]));
        ok('va sau do khoa da duoc nha', isLocked('w1') === false);
    }).then(function () {
        group('L8: withBusyLock - NHA KHOA KHI HÀM NEM LỖI');
        var loi = false;
        return withLock('w2', 5000, function () { loi = true; throw new Error('hông'); })
            .then(function () { return 'khong nem loi'; }, function (e) { return 'nham loi: ' + e.message; })
            .then(function (r) {
                ok('ham co chay', loi);
                eq('loi duoc truyen ra', r, 'nham loi: hông');
                ok('khoa da duoc nha sau loi', isLocked('w2') === false);
            });
    }).then(function () {
        console.log('\n=========================================');
        console.log('  TONG: ' + (pass + fail) + ' assertions');
        console.log('  PASS: ' + pass);
        console.log('  FAIL: ' + fail);
        console.log('=========================================');
        process.exit(fail === 0 ? 0 : 1);
    });
})();