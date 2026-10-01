// =====================================================================
// TEST: GOM THONG BAO KHONG DUOC NUOT MAT BAN GHI
// Nap ham THAT tu pos2018/db.js
// Chay: node test-notify-queue.js
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

var EVENTS = [];
var timers = [];
var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
    clearTimeout: function (id) { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    Date: Date, Math: Math, JSON: JSON, String: String, Array: Array, Promise: Promise,
    parseInt: parseInt, isNaN: isNaN
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext('var _suppressRealtime = 0; var _suppressWatchdogId = null; var _SUPPRESS_WATCHDOG_MS = 20000;' +
    'var NOTIFY_DEBOUNCE_MS = 60; var _notifyTimers = {}; var _notifyQueues = {};' +
    'var _pendingNotifyCollections = {}; var _lastChangeInfo = {};' +
    'var _eventBus = {}; var _localCallbacks = {};' +
    'var memoryCache = { tables: { t12: {id:"t12",name:"Bàn 12"}, t07: {id:"t07",name:"Bàn 07"} } };' +
    'var CURRENT_DEVICE_ID = "dev1";', sandbox);
vm.runInContext('function _emit(t,d){ EVENTS.push({type:t, item:d&&d.item}); }\n' +
    'function _notifyComponents(){}\n', sandbox);
vm.runInContext(ex('_doNotifyLocal') + '\n' + ex('_drainNotifyQueue') + '\n' +
    ex('_notifyLocal') + '\n' + ex('_notifyLocalNow') + '\n' +
    ex('_setSuppressRealtime'), sandbox);
var notifyLocal = vm.runInContext('_notifyLocal', sandbox);
var setSuppress = vm.runInContext('_setSuppressRealtime', sandbox);
sandbox.EVENTS = EVENTS;

function fireAllTimers() {
    var list = timers.slice();
    timers.length = 0;
    // KHÔNG kích hoạt watchdog 20s của suppress - nó có tác dụng khác
    list.forEach(function (t) { if (!t.cancelled && t.ms !== 20000) t.fn(); });
}

console.log('TEST GOM THONG BAO - db.js');

(function () {
    group('Q1: HAI BAN GHI TRONG CUNG CUA SO -> CA HAI PHAI DEN');
    EVENTS.length = 0; timers.length = 0;
    vm.runInContext('_suppressRealtime = 0;', sandbox);
    notifyLocal('tables', { type: 'added', item: { id: 't12', name: 'Bàn 12' } });
    notifyLocal('tables', { type: 'removed', item: { id: 't07' } });
    eq('chua bat den khi het 60ms', EVENTS.length, 0);
    fireAllTimers();
    var loai = EVENTS.map(function (e) { return e.type; }).sort();
    eq('bat ca 2 su kien', EVENTS.length, 2);
    ok('co su kien added', loai.indexOf('tables:added') >= 0, JSON.stringify(loai));
    ok('co su kien removed', loai.indexOf('tables:removed') >= 0, JSON.stringify(loai));
    var ban12 = EVENTS.filter(function (e) { return e.type === 'tables:added'; })[0];
    ok('added mang dung ban ghi', ban12 && ban12.item && ban12.item.id === 't12',
        JSON.stringify(ban12));

    group('Q2: NHIEU BAN GHI HON NUA CUNG KHONG BI MAT');
    EVENTS.length = 0; timers.length = 0;
    for (var i = 1; i <= 6; i++) {
        notifyLocal('tables', { type: 'added', item: { id: 'k' + i, name: 'Bàn ' + i } });
    }
    fireAllTimers();
    eq('bat het 6 su kien', EVENTS.length, 6);
    var ids = EVENTS.map(function (e) { return e.item.id; }).sort();
    eq('du tat ca 6 ban ghi', ids.join(','), 'k1,k2,k3,k4,k5,k6');

    group('Q3: DA PHAI DUONG DOC LAI THI VAN CHAY DUNG MOT LAN');
    vm.runInContext('_localCallbacks = { tables: [function(d){ EVENTS.push({type:"callback", n:d.length}); }] };', sandbox);
    EVENTS.length = 0; timers.length = 0;
    notifyLocal('tables', { type: 'added', item: { id: 'a' } });
    notifyLocal('tables', { type: 'added', item: { id: 'b' } });
    notifyLocal('tables', { type: 'added', item: { id: 'c' } });
    fireAllTimers();
    var cbs = EVENTS.filter(function (e) { return e.type === 'callback'; });
    eq('callback doc lai chi chay 1 lan cho ca loat', cbs.length, 1);
    eq('va nhan du ca collection', cbs[0] && cbs[0].n, 2);

    group('Q4: KHI DANG KHOA THI KHONG BAT, MO KHOA PHAI BAT LAI DU');
    vm.runInContext('_localCallbacks = {};', sandbox);
    EVENTS.length = 0; timers.length = 0;
    setSuppress(true);
    notifyLocal('tables', { type: 'added', item: { id: 'khoa1' } });
    notifyLocal('tables', { type: 'removed', item: { id: 'khoa2' } });
    fireAllTimers();
    eq('dang khoa thi khong bat su kien', EVENTS.length, 0);
    setSuppress(false);
    var loai2 = EVENTS.map(function (e) { return e.type; }).sort();
    eq('mo khoa -> bat ca 2', EVENTS.length, 2);
    ok('khong con su kien undefined (chu kich hoat loi cu)', loai2.indexOf('undefined') < 0, JSON.stringify(loai2));

    group('Q5: _notifyLocalNow XA HANG DOI CHO');
    EVENTS.length = 0; timers.length = 0;
    vm.runInContext('_suppressRealtime = 0;', sandbox);
    notifyLocal('tables', { type: 'added', item: { id: 'x1' } });
    notifyLocal('tables', { type: 'added', item: { id: 'x2' } });
    // goi now TRUOC khi het 60ms
    vm.runInContext('_notifyLocalNow("tables", { type: "changed", item: { id: "x3" } });', sandbox);
    fireAllTimers();
    eq('khong ban ghi nao bi bo', EVENTS.length, 3);
    ok('da co su kien changed', EVENTS.some(function (e) { return e.type === 'tables:changed'; }));

    console.log('\n=========================================');
    console.log('  TONG: ' + (pass + fail) + ' assertions');
    console.log('  PASS: ' + pass);
    console.log('  FAIL: ' + fail);
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
})();