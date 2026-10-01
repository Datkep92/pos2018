// =====================================================================
// TEST: suppressRealtime gom thong bao va bat lai dung thong tin
// Nap code THAT tu pos2018/db.js
// Chay: node test-suppress.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join("C:\\\\Users\\\\cana2\\\\OneDrive\\\\Documents\\\\Default Project\\\\pos2018", '.', 'js.min', 'db.min.js'), 'utf8');
function ex(n) {
    var m = new RegExp('function\\s+' + n + '\\s*\\(').exec(src);
    if (!m) throw new Error('khong tim thay ' + n);
    var i = src.indexOf('{', m.index), d = 0, s = false;
    for (; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } else if (src[i] === '}') { d--; if (s && d === 0) return src.slice(m.index, i + 1); } }
    throw new Error('khong dong ' + n);
}

var pass = 0, fail = 0;
function group(n) { console.log('\n=== ' + n + ' ==='); }
function eq(l, a, e) { if (a === e) { pass++; console.log('  PASS  ' + l + '  [' + a + ']'); } else { fail++; console.log('  FAIL  ' + l + '  actual=' + JSON.stringify(a) + ' expected=' + JSON.stringify(e)); } }
function ok(l, c, x) { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l + (x ? '  ' + x : '')); } }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// Moi truong
var busLog = [];
var cbLog = [];

var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Date: Date, Math: Math, JSON: JSON, isNaN: isNaN, parseInt: parseInt,
    Promise: Promise,
    memoryCache: { customers: { a: { id: 'a' }, b: { id: 'b' } } },
    // Handler giong het file that
    busPush: function (e) { busLog.push(e); },
    cbPush: function (d) { cbLog.push(d.length); }
};

var code = [
    'var _suppressRealtime = 0;',
    'var _pendingNotifyCollections = {};',
    'var _lastChangeInfo = {};',
    'var _notifyTimers = {};',
    'var _notifyQueues = {};',
    'var _suppressWatchdogId = null;',
    'var NOTIFY_DEBOUNCE_MS = 60;',
    'var _SUPPRESS_WATCHDOG_MS = 20000;',
    'var _eventBus = {};',
    'var _localCallbacks = { customers: [function(d){ cbPush(d); }] };',
    'function _notifyComponents(){}',
    'function _drainNotifyQueue(coll){ var q=_notifyQueues[coll]||[]; delete _notifyQueues[coll]; if(!q.length) return; _doNotifyLocal(coll, q[q.length-1], q); }',
    'function _emit(eventType, data) {',
    '  var cbs = _eventBus[eventType];',
    '  if (cbs) for (var i=0;i<cbs.length;i++){ try{cbs[i](data);}catch(e){} }',
    '  var parts = eventType.split(":");',
    '  if (parts.length===2){ var wc=_eventBus[parts[0]+":*"];',
    '    if (wc) for (var j=0;j<wc.length;j++){ try{wc[j]({type:parts[1],collection:parts[0],data:data});}catch(e){} } }',
    '}',
    ex('_doNotifyLocal'),
    ex('_notifyLocal'),
    ex('_notifyLocalNow'),
    ex('_setSuppressRealtime'),
    'this.nLocal = _notifyLocal; this.nNow = _notifyLocalNow; this.setSup = _setSuppressRealtime; this.bus = _eventBus;'
].join('\n');

var ctx = vm.createContext(sandbox);
vm.runInContext(code, ctx);

// Handler giong file that: loc bang !event.data roi push
function mkHandler() {
    return function (e) { if (!e || !e.data) return; busLog.push(e); };
}
sandbox.bus['customers:*'] = [mkHandler()];
sandbox.bus['transactions:*'] = [mkHandler()];

console.log('TEST suppressRealtime (nap _notifyLocal / _notifyLocalNow / _setSuppressRealtime tu db.js)');

(async function () {

    // -----------------------------------------------------------------
    group('S1: BAT KOA - KHONG BAT GI');
    busLog = []; cbLog = [];
    sandbox.setSup(true);
    sandbox.nLocal('customers', { type: 'updated', item: { id: 'a' } });
    sandbox.nLocal('customers', { type: 'updated', item: { id: 'b' } });
    eq('chua bat ngay khi dang khoa', busLog.length, 0);
    await wait(120);
    eq('van chua bat sau 120ms', busLog.length, 0);

    // -----------------------------------------------------------------
    group('S2: MO KHOA - PHAT LAI DU THONG TIN');
    busLog = []; cbLog = [];
    sandbox.setSup(false);
    await wait(30);
    eq('2 thay doi -> bat 2 su kien (khong bo ban ghi)', busLog.length, 2);
    ok('co type', busLog[0] && busLog[0].type === 'updated', 'type=' + (busLog[0] && busLog[0].type));
    ok('co collection', busLog[0] && busLog[0].collection === 'customers');
    ok('co data', !!(busLog[0] && busLog[0].data));
    ok('callback local cung chay', cbLog.length >= 1, 'cb=' + cbLog.length);

    // -----------------------------------------------------------------
    group('S3: BO DEM KHOA PHAI CAN BANG');
    busLog = []; cbLog = [];
    sandbox.setSup(true); sandbox.setSup(true); sandbox.setSup(true);
    sandbox.nLocal('transactions', { type: 'updated' });
    sandbox.nLocal('customers', { type: 'updated' });
    await wait(100);
    eq('khoa 3 lan -> khong bat', busLog.length, 0);
    sandbox.setSup(false);
    await wait(30);
    eq('mo 1 lan (con 2) -> van khoa', busLog.length, 0);
    sandbox.setSup(false);
    await wait(30);
    eq('mo 2 lan (con 1) -> van khoa', busLog.length, 0);
    sandbox.setSup(false);
    await wait(30);
    ok('mo 3 lan -> moi bat (gom 2 collection)', busLog.length === 2, 'bat=' + busLog.length);
    sandbox.setSup(false);
    await wait(30);
    eq('mo them -> khong bat them', busLog.length, 2);

    // -----------------------------------------------------------------
    group('S4: KHONG KHOA - BAT DANH BINH');
    busLog = []; cbLog = [];
    sandbox.nLocal('customers', { type: 'updated', item: { id: 'x' } });
    await wait(120);
    eq('bat 1 su kien', busLog.length, 1);
    ok('co type', busLog[0] && busLog[0].type === 'updated');

    // -----------------------------------------------------------------
    group('S5: NHIEU THAY DOI LIEN TIEP -> GOM 1 LAN');
    busLog = []; cbLog = [];
    for (var i = 0; i < 10; i++) {
        sandbox.nLocal('customers', { type: 'updated', item: { id: 'n' + i } });
    }
    await wait(120);
    eq('10 thay doi -> bat het 10 su kien', busLog.length, 10);
    eq('callback local cung 1 lan', cbLog.length, 1);

    // -----------------------------------------------------------------
    group('S6: _notifyLocalNow BAT NGAY VA HUY TIMER');
    busLog = []; cbLog = [];
    sandbox.nNow('customers', { type: 'updated', item: { id: 'now' } });
    eq('bat ngay (khong cho debounce)', busLog.length, 1);
    ok('co type', busLog[0] && busLog[0].type === 'updated');
    sandbox.nLocal('customers', { type: 'updated' });   // hen timer 60ms
    sandbox.nNow('customers', { type: 'updated' });     // bat ngay, huy timer
    await wait(120);
    // 1 sự kiện từ nNow() đầu tiên, rồi nLocal() xếp 1 thay đổi vào hàng đợi và
    // nNow() thứ hai xả cả hàng đợi (1) + thay đổi truyền vào (1) = 2.
    // Tổng 3. Trước đây là 2 vì hàng đợi bị xoá mà không bắn.
    eq('timer da bi huy -> van bat ca thay doi da gom', busLog.length, 3);

    // -----------------------------------------------------------------
    group('S7: DU LIEU TRU YEN');
    cbLog = [];
    sandbox.nLocal('customers', { type: 'updated' });
    await wait(120);
    eq('callback chay 1 lan', cbLog.length, 1);
    ok('du lieu co 2 khach', cbLog[0] === 2, 'n=' + cbLog[0]);

    // -----------------------------------------------------------------
    group('S8: KHOA ROI MO - DU LIEU VAN DUNG');
    busLog = []; cbLog = [];
    sandbox.setSup(true);
    sandbox.nLocal('customers', { type: 'removed', item: { id: 'a' } });
    await wait(120);
    eq('khoa -> khong bat', busLog.length, 0);
    sandbox.setSup(false);
    await wait(30);
    eq('mo khoa -> bat 1 su kien', busLog.length, 1);
    ok('GIU NGUYEN type cua thay doi (removed)', busLog[0] && busLog[0].type === 'removed',
        'type=' + (busLog[0] && busLog[0].type));

    console.log('\n=========================================');
    console.log('  TONG: ' + (pass + fail) + ' assertions');
    console.log('  PASS: ' + pass);
    console.log('  FAIL: ' + fail);
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) { console.error('LOI:', e.message); console.error(e.stack); process.exit(1); });
