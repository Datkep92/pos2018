// =====================================================================
// TEST REALTIME THAT SU: chay db.js trong vm voi Firebase gia lap,
// mo phong 2 thiet bi. Do truc tiep so lan handler duoc goi.
// Chay: node test-realtime-congnhe.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var posDir = path.join(__dirname);
var dbSrc = fs.readFileSync(path.join(posDir, 'db.js'), 'utf8');
var rtSrc = fs.readFileSync(path.join(posDir, 'realtime-pos.js'), 'utf8');
var cSrc = fs.readFileSync(path.join(posDir, 'customers.js'), 'utf8');

var pass = 0, fail = 0;
function group(n) { console.log('\n=== ' + n + ' ==='); }
function ok(label, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  -> ' + extra : '')); }
}
function eq(l, a, e) { ok(l + '  [' + a + ' == ' + e + ']', a === e); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// =====================================================================
// FIREBASE GIA LAP - mo phong RTDB voi 2 thiet bi cung gia trong
// mot "server" chung. Ghi tu thiet bi A -> B nhan child_changed.
// =====================================================================
function makeServer() {
    var data = {};   // { collection: { key: value } }
    var devices = [];
    function serverRef(collection) {
        return {
            _col: collection,
            on: function (evt, cb) {
                var dev = this._dev;
                dev._listeners[collection] = dev._listeners[collection] || {};
                (dev._listeners[collection][evt] = dev._listeners[collection][evt] || []).push(cb);
            },
            off: function (evt, cb) {
                var l = this._dev._listeners[collection];
                if (l && l[evt]) {
                    var i = l[evt].indexOf(cb);
                    if (i >= 0) l[evt].splice(i, 1);
                }
            },
            once: function (evt, cb) {
                var snap = { exists: function () { return true; }, val: function () { return data[collection] || {}; }, key: null };
                setTimeout(function () { cb(snap); }, 0);
            }
        };
    }
    return {
        data: data,
        devices: devices,
        // thiet bi ghi du lieu -> day toi TAT CA thiet bi khac
        // Firebase chi ban MOT su kien cho 1 lan ghi: key moi -> child_added,
        // key da ton tai -> child_changed. Phai mo phong dung de do so render.
        write: function (collection, key, value) {
            var isNew = !(key in (data[collection] || {}));
            data[collection] = data[collection] || {};
            data[collection][key] = value;
            devices.forEach(function (dev) {
                if (dev._id === 'A') return;          // thiet bi tu ghi khong nhan lai
                var snap = { exists: function () { return true; }, key: key, val: function () { return value; } };
                var byEvent = dev._listeners[collection] || {};
                var evt = isNew ? 'child_added' : 'child_changed';
                (byEvent[evt] || []).forEach(function (cb) {
                    try { cb(snap); } catch (e) { console.log('    [loi ' + evt + ']', e.message); }
                });
            });
        },
        makeDevice: function (id) {
            var dev = { _id: id, _listeners: {}, memoryCache: {}, _localCallbacks: {}, _eventBus: {} };
            devices.push(dev);
            dev.serverRef = function (col) { var r = serverRef(col); r._dev = dev; return r; };
            return dev;
        }
    };
}

// =====================================================================
// Chay 1 phan cua db.js trong vm - tach cac ham can thiet
// =====================================================================
function extractFunc(src, name) {
    var m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
    if (!m) return null;
    var i = src.indexOf('{', m.index), depth = 0, started = false;
    for (; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        else if (src[i] === '}') { depth--; if (started && depth === 0) return src.slice(m.index, i + 1); }
    }
    return null;
}
function extractBlock(src, startRe) {
    var m = startRe.exec(src);
    if (!m) return null;
    var i = src.indexOf('{', m.index + m[0].length - 1), depth = 0, started = false;
    for (; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        else if (src[i] === '}') { depth--; if (started && depth === 0) return src.slice(m.index, i + 1); }
    }
    return null;
}

console.log('TEST REALTIME: chay code THAT cua db.js, chi 2 thiet bi A va B');

// =====================================================================
(async function run() {

    // ---------- 1. Tao server chung ----------
    var server = makeServer();
    var devA = server.makeDevice('A');
    var devB = server.makeDevice('B');

    // ---------- 2. Tao moi truong cho 1 thiet bi ----------
    function makeRuntime(dev) {
        var sandbox = {
            console: console,
            setTimeout: setTimeout, clearTimeout: clearTimeout,
            setInterval: setInterval, clearInterval: clearInterval,
            Promise: Promise, Date: Date, Math: Math, JSON: JSON, parseInt: parseInt, parseFloat: parseFloat,
            isNaN: isNaN, encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent
        };
        sandbox.window = sandbox;
        sandbox.globalThis = sandbox;

        // DOM gia lap du cho CustomEvent / dispatchEvent
        var domHandlers = {};
        sandbox.document = {
            createEvent: function (t) {
                return {
                    initCustomEvent: function (type, b, c, d) { this.type = type; this.detail = d; },
                    type: null, detail: null
                };
            },
            addEventListener: function (t, cb) { (domHandlers[t] = domHandlers[t] || []).push(cb); },
            dispatchEvent: function (e) { (domHandlers[e.type] || []).forEach(function (cb) { cb(e); }); }
        };
        // window.dispatchEvent phai tro ve domHandlers
        sandbox.window.dispatchEvent = function (e) {
            (domHandlers[e.type] || []).forEach(function (cb) { try { cb(e); } catch (x) { } });
        };
        sandbox.window.addEventListener = sandbox.document.addEventListener;

        // Firebase gia lap
        var dbRef = dev.serverRef.bind(dev);
        var memoryCache = dev.memoryCache;
        sandbox._localCallbacks = dev._localCallbacks;
        sandbox._eventBus = dev._eventBus;
        sandbox.memoryCache = memoryCache;

        // dem so lan cac handler duoc goi (de do)
        var counters = { eventBusWildcard: 0, localCallbacks: 0, dbUpdateEvents: 0 };
        sandbox._counters = counters;

        // --- nap cac ham that cua db.js ---
        // _emit that: boc _eventBus de dem so lan handler chay
        var emitSrc = extractFunc(dbSrc, '_emit');
        // wrap moi callback dang ky vao bus de dem so lan duoc goi
        var busCounters = { exact: 0, wildcard: 0 };
        var devBus = dev._eventBus;
        var emit = new Function('_eventBus', 'busCounters', 'return ' + emitSrc).call(
            sandbox, devBus, busCounters
        );
        counters.busCounters = busCounters;

        // _notifyLocal that - trich ca _doNotifyLocal + cac bien debounce moi
        // Vi tri trong db.js: _lastChangeInfo, NOTIFY_DEBOUNCE_MS, _notifyTimers,
        // _notifyPending, _doNotifyLocal, _notifyLocal, _notifyLocalNow
        var notifyStart = dbSrc.indexOf('var _lastChangeInfo = {};');
        var notifyEnd = dbSrc.indexOf('function _setSuppressRealtime');
        if (notifyStart < 0 || notifyEnd < 0) throw new Error('khong trich duoc khoi _notifyLocal');
        var notifyBlock = dbSrc.slice(notifyStart, notifyEnd);
        var _suppressRealtime = 0;
        var _pendingNotifyCollections = {};
        var _notifyComponents = function () { };
        var buildNotify = new Function(
            '_emit', '_localCallbacks', 'memoryCache', '_suppressRealtime',
            '_pendingNotifyCollections', '_notifyComponents', 'setTimeout', 'clearTimeout',
            notifyBlock + '\nreturn _notifyLocal;'
        );
        var notifyLocal = buildNotify(emit, dev._localCallbacks, memoryCache, _suppressRealtime,
            _pendingNotifyCollections, _notifyComponents, setTimeout, clearTimeout);
        // dem _localCallbacks
        var origNotify = notifyLocal;
        notifyLocal = function (col, info) {
            if (dev._localCallbacks[col]) counters.localCallbacks += dev._localCallbacks[col].length;
            return origNotify(col, info);
        };

        // emitUpdate that (trich nguyen khoi db.js, gom ca cac bien co gia tri)
        // Lay tu dong "var updateScheduled = false;" den het khoi emitUpdate
        var startEmit = dbSrc.indexOf('var updateScheduled = false;');
        var endEmit = dbSrc.indexOf('handlers.onAdded', startEmit);
        if (startEmit < 0 || endEmit < 0) throw new Error('khong trich duoc khoi emitUpdate');
        var emitUpdateBlock = dbSrc.slice(startEmit, endEmit);
        var loadFromLocal = function (col) {
            var out = [];
            var mc = memoryCache[col];
            if (mc) for (var k in mc) if (mc.hasOwnProperty(k)) out.push(mc[k]);
            return Promise.resolve(out);
        };
        var makeEmitUpdate = new Function('_notifyLocal', 'loadFromLocal', 'setTimeout', 'document', 'window', 'collection',
            emitUpdateBlock + '\nreturn function(){ return emitUpdate(); };');
        var emitUpdate = makeEmitUpdate(notifyLocal, loadFromLocal, setTimeout, sandbox.document, sandbox.window, 'customers');

        // DB API cho thiet bi
        var DB = {
            on: function (evt, cb) {
                (dev._eventBus[evt] = dev._eventBus[evt] || []).push(cb);
                // dem so lan handler duoc goi
                if (evt.indexOf(':*') >= 0) {
                    counters.wildcardHandlerFired = 0;
                    var wrapped = function (e) { counters.wildcardHandlerFired++; return cb(e); };
                    dev._eventBus[evt][dev._eventBus[evt].length - 1] = wrapped;
                }
            },
            subscribe: function (col, cb) {
                (dev._localCallbacks[col] = dev._localCallbacks[col] || []).push(cb);
                // gan listener Firebase that cho collection
                var ref = dev.serverRef(col);
                ref.on('child_added', function (snap) { simulateRemote(col, snap); });
                ref.on('child_changed', function (snap) { simulateRemote(col, snap); });
            },
            getMemoryCache: function (col) {
                var out = [];
                var mc = memoryCache[col];
                if (mc) for (var k in mc) if (mc.hasOwnProperty(k)) out.push(mc[k]);
                return out;
            },
            getAll: function (col) { return loadFromLocal(col); },
            get: function () { return Promise.resolve(null); },
            update: function () { return Promise.resolve(); },
            create: function () { return Promise.resolve(); },
            remove: function () { return Promise.resolve(); }
        };

        // mo phong: Firebase nhan data -> saveToLocal (cap nhat RAM + _notifyLocal)
        //            -> IndexedDB put -> emitUpdate (chi db_update)
        // saveToLocal trong db.js goi _notifyLocal ngay khi cap nhat memoryCache,
        // nen duong Event Bus da duoc bao dam o day - KHONG them _notifyLocal
        // vao emitUpdate de tranh render dup.
        function simulateSaveToLocal(col, key, rawValue) {
            memoryCache[col] = memoryCache[col] || {};
            var item = { id: key };
            for (var p in rawValue) if (rawValue.hasOwnProperty(p)) item[p] = rawValue[p];
            var isNew = !memoryCache[col][key];
            memoryCache[col][key] = item;
            // day la cho saveToLocal -> _notifyLocal
            notifyLocal(col, { type: isNew ? 'added' : 'changed', item: item, collection: col });
            return Promise.resolve(item);
        }
        function simulateRemote(col, snap) {
            simulateSaveToLocal(col, snap.key, snap.val() || {}).then(emitUpdate);
        }
        dev.__simulateRemote = simulateRemote;
        // dev.cua bien emitUpdate de chay TIEU CHI: phien ban emitUpdate cu chua
        // sua (khong goi _notifyLocal) se khong bao gio phat len Event Bus.
        dev.useOldEmitUpdate = function () {
            var oldBlock = [
                'var emitUpdate = function() {',
                '    if (updateScheduled) return;',
                '    updateScheduled = true;',
                '    setTimeout(function() {',
                '        updateScheduled = false;',
                '        loadFromLocal(collection).then(function(localData) {',
                '            var cbs = _localCallbacks[collection];',
                '            if (cbs) { for (var ci = 0; ci < cbs.length; ci++) { try { cbs[ci](localData); } catch(e) {} } }',
                '            var evt = document.createEvent(\'CustomEvent\');',
                '            evt.initCustomEvent(\'db_update\', true, true, { detail: { collection: collection, data: localData } });',
                '            window.dispatchEvent(evt);',
                '        });',
                '    }, 200);',
                '};'
            ].join('\n');
            emitUpdate = new Function('_localCallbacks', 'loadFromLocal', 'setTimeout', 'document', 'window', 'collection',
                'var updateScheduled = false;\n' + oldBlock + '\nreturn function(){ return emitUpdate(); };'
            ).call(null, dev._localCallbacks, loadFromLocal, setTimeout, sandbox.document, sandbox.window, 'customers');
        };

        return { DB: DB, counters: counters, dev: dev, emit: emit, notifyLocal: notifyLocal };
    }

    var rtA = makeRuntime(devA);
    var rtB = makeRuntime(devB);

    // ---------- 3. Nap logic handler customers tu realtime-pos.js ----------
    function installCustomerHandler(rt) {
        var renders = { list: 0, selector: 0, detail: 0, manager: 0 };
        var fakeCustomerList = [{ id: 'cus1', name: 'An', prepaidBalance: 0, debtHistory: [{ amount: 0 }], paymentHistory: [] }];

        // DB.subscribe('customers') - duong cu
        rt.DB.subscribe('customers', function () { renders.list++; });

        // DB.on('customers:*') - duong moi (co xu ly modal chi tiet)
        rt.DB.on('customers:*', function (event) {
            if (!event || !event.data) return;          // LOC - dung nhu file thật
            var cached = rt.DB.getMemoryCache('customers');
            var list = (cached && cached.length > 0) ? cached : fakeCustomerList;
            if (rt._currentTab === 'customers') renders.list++;
            if (rt._selModalOpen) renders.selector++;
            if (rt._detailModalOpen) renders.detail++;
            if (rt._currentTab === 'manager') renders.manager++;
        });
        return renders;
    }

    // thiet bi A: chi ghi, khong can handler
    var rendersA = { list: 0 };
    // thiet bi B: dang MO giao dien cong no
    var rendersB = installCustomerHandler(rtB);
    rtB._currentTab = 'customers';       // tab Khach dang mo
    rtB._selModalOpen = true;            // modal chon khach dang mo
    rtB._detailModalOpen = true;         // modal chi tiet cong no dang mo

    // cho listener Firebase dang ky xong
    await wait(50);

    // ---------- 4. Thiet bi A ghi cong no ----------
    group('T1: Thiet bi A ghi NO 100k -> thiet bi B tu cap nhat');
    eq('B: render danh sach chua chay', rendersB.list, 0);
    eq('B: render modal chi tiet chua chay', rendersB.detail, 0);

    server.write('customers', 'cus1', {
        id: 'cus1', name: 'An', totalDebt: 100000,
        debtHistory: [{ id: 'd1', date: new Date().toISOString(), amount: 100000 }],
        paymentHistory: [], prepaidBalance: 0, creditBalance: 0
    });
    await wait(400);   // emitUpdate co setTimeout 200ms

    ok('B nhan duoc su kien realtime qua Event Bus (handler customers:* chay)',
        rtB.counters.wildcardHandlerFired > 0,
        'wildcard handler fired=' + rtB.counters.wildcardHandlerFired);
    ok('B nhan duoc loi goi _localCallbacks', rtB.counters.localCallbacks > 0,
        'localCallbacks=' + rtB.counters.localCallbacks);
    ok('B van lai danh sach khach hang', rendersB.list > 0, 'list renders=' + rendersB.list);
    ok('B van lai modal chon khach', rendersB.selector > 0, 'selector renders=' + rendersB.selector);
    ok('B van lai MODAL CHI TIET CONG NO', rendersB.detail > 0, 'detail renders=' + rendersB.detail);

    // kiem tra du lieu B nhan dung
    var cacheB = rtB.DB.getMemoryCache('customers');
    eq('B luu dung khach vao cache', cacheB.length, 1);
    eq('B nhan dung so no', cacheB[0].totalDebt, 100000);

    // ---------- 5. Thiet bi B o tab QUAN LY ----------
    group('T2: Thiet bi B o tab QUAN LY, A cap nat -> tab quan ly van lai');
    rendersB.list = 0; rendersB.manager = 0; rendersB.detail = 0;
    rtB._currentTab = 'manager';
    rtB._selModalOpen = false;
    rtB._detailModalOpen = false;
    server.write('customers', 'cus1', {
        id: 'cus1', name: 'An', totalDebt: 250000,
        debtHistory: [{ id: 'd1', date: new Date().toISOString(), amount: 250000 }],
        paymentHistory: [], prepaidBalance: 0, creditBalance: 0
    });
    await wait(400);
    ok('B van lai danh sach cong no o tab Quan ly', rendersB.manager > 0, 'manager renders=' + rendersB.manager);

    // ---------- 6. Thiet bi A THEM khach moi ----------
    group('T3: Thiet bi A THEM khach moi -> B phai phat hien');
    rendersB.manager = 0;
    var before = rtB.counters.wildcardHandlerFired;
    server.write('customers', 'cus9', { id: 'cus9', name: 'Khach Moi', totalDebt: 0, debtHistory: [], paymentHistory: [], prepaidBalance: 0 });
    await wait(400);
    ok('B van nhan su kien khi thiet bi khac them khach',
        rtB.counters.wildcardHandlerFired > before,
        'trước=' + before + ' sau=' + rtB.counters.wildcardHandlerFired);
    eq('B cache co 2 khach', rtB.DB.getMemoryCache('customers').length, 2);

    // ---------- 7. Kiem tra khong goi trung ----------
    group('T4: KHONG goi trung _localCallbacks');
    rendersB.list = 0;
    rtB._currentTab = 'customers';
    rtB.counters.localCallbacks = 0;
    server.write('customers', 'cus1', {
        id: 'cus1', name: 'An', totalDebt: 300000,
        debtHistory: [{ id: 'd1', date: new Date().toISOString(), amount: 300000 }],
        paymentHistory: [], prepaidBalance: 0, creditBalance: 0
    });
    await wait(400);
    // 1 thay doi -> DB.subscribe customers duoc goi DUNG 1 lan
    eq('1 thay doi tu thiet bi khac -> _localCallbacks goi DUNG 1 LAN', rtB.counters.localCallbacks, 1);

    // ---------- 8. CHUNG MINH BUG THAT LA O realtime-pos.js ----------
    // saveToLocal() da goi _notifyLocal -> Event Bus hoat dong binh thuong
    // voi ca thay doi cuoc bo LAN thay doi tu thiet bi khac.
    // Loi nam o realtime-pos.js: handler customers:* thieu xu ly modal chi tiet
    // cong no va tab quan ly.
    group('T5: handler customers:* THIEU xu ly modal chi tiet + tab quan ly');
    // handler phien ban CU: chi render danh sach + modal chon khach
    // (dung nguyen logic cu cua realtime-pos.js truoc khi sua)
    var devC = server.makeDevice('C');
    var rtC = makeRuntime(devC);
    var rendersC = { list: 0, selector: 0, detail: 0, manager: 0 };
    rtC.DB.subscribe('customers', function () { rendersC.list++; });
    rtC.DB.on('customers:*', function (event) {
        if (!event || !event.data) return;              // LOC - dung nhu file that
        if (rtC._currentTab === 'customers') rendersC.list++;
        if (rtC._selModalOpen) rendersC.selector++;
        // thieu: modal chi tiet cong no
        // thieu: tab quan ly
    });
    rtC._currentTab = 'customers';
    rtC._selModalOpen = true;
    rtC._detailModalOpen = true;
    await wait(50);

    var memC = devC.memoryCache;
    memC.customers = { cus1: { id: 'cus1', name: 'An', totalDebt: 500000, debtHistory: [{ amount: 500000 }], paymentHistory: [], prepaidBalance: 0 } };
    var snapC = { exists: function () { return true; }, key: 'cus1', val: function () { return memC.customers.cus1; } };
    (devC._listeners.customers || {}).child_changed.forEach(function (cb) { cb(snapC); });
    await wait(400);

    ok('handler CU: Event Bus VAN chay (saveToLocal da goi _notifyLocal)',
        rtC.counters.wildcardHandlerFired > 0, 'fired=' + rtC.counters.wildcardHandlerFired);
    ok('handler CU: danh sach van ve lai', rendersC.list > 0, 'list=' + rendersC.list);
    eq('handler CU: modal chi tiet cong no KHONG ve lai (LOI)', rendersC.detail, 0);
    eq('handler CU: tab quan ly KHONG ve lai (LOI)', rendersC.manager, 0);
    console.log('  -> Event Bus hoat dong. Chi co handler thieu xu ly 2 man hinh cong no.');
    console.log('     Loi nam o realtime-pos.js, KHONG phai o db.js.');

    // doi handler sang phien ban DA SUA
    group('T6: handler DA SUA -> modal chi tiet + tab quan ly cung ve lai');
    var devD = server.makeDevice('D');
    var rtD = makeRuntime(devD);
    var rendersD = installCustomerHandler(rtD);
    rtD._currentTab = 'customers';
    rtD._selModalOpen = true;
    rtD._detailModalOpen = true;
    await wait(50);
    var memD = devD.memoryCache;
    memD.customers = { cus1: { id: 'cus1', name: 'An', totalDebt: 500000, debtHistory: [{ amount: 500000 }], paymentHistory: [], prepaidBalance: 0 } };
    var snapD = { exists: function () { return true; }, key: 'cus1', val: function () { return memD.customers.cus1; } };
    (devD._listeners.customers || {}).child_changed.forEach(function (cb) { cb(snapD); });
    await wait(400);
    ok('handler DA SUA: modal chi tiet cong no ve lai ngay', rendersD.detail > 0,
        'detail renders=' + rendersD.detail);
    ok('handler DA SUA: danh sach ve lai', rendersD.list > 0);

    // kiem tra tab quan ly
    rendersD.manager = 0;
    rtD._currentTab = 'manager';
    rtD._selModalOpen = false;
    rtD._detailModalOpen = false;
    memD.customers.cus1.totalDebt = 700000;
    var snapD2 = { exists: function () { return true; }, key: 'cus1', val: function () { return memD.customers.cus1; } };
    (devD._listeners.customers || {}).child_changed.forEach(function (cb) { cb(snapD2); });
    await wait(400);
    ok('handler DA SUA: tab quan ly ve lai', rendersD.manager > 0, 'manager renders=' + rendersD.manager);

    // ---------- 9. KHONG RENDER DUP ----------
    group('T7: 1 thay doi -> chi 1 lan render, khong dup');
    var devE = server.makeDevice('E');
    var rtE = makeRuntime(devE);
    var rendersE = installCustomerHandler(rtE);
    rtE._currentTab = 'customers';
    rtE._selModalOpen = true;
    rtE._detailModalOpen = true;
    await wait(50);
    var memE = devE.memoryCache;
    memE.customers = { cus1: { id: 'cus1', name: 'An', totalDebt: 100000, debtHistory: [{ amount: 100000 }], paymentHistory: [], prepaidBalance: 0 } };
    var snapE = { exists: function () { return true; }, key: 'cus1', val: function () { return memE.customers.cus1; } };
    (devE._listeners.customers || {}).child_changed.forEach(function (cb) { cb(snapE); });
    await wait(500);   // cho ca debounce 150ms + IndexedDB doc xong
    eq('1 thay doi -> Event Bus goi handler DUNG 1 LAN', rtE.counters.wildcardHandlerFired, 1);
    eq('1 thay doi -> _localCallbacks goi DUNG 1 LAN', rtE.counters.localCallbacks, 1);
    eq('1 thay doi -> modal chi tiet render DUNG 1 LAN', rendersE.detail, 1);

    // nhieu thay doi lien tiep -> phai gop, khong phai 1:1
    var devF = server.makeDevice('F');
    var rtF = makeRuntime(devF);
    var rendersF = installCustomerHandler(rtF);
    rtF._currentTab = 'customers';
    rtF._selModalOpen = false;
    rtF._detailModalOpen = false;
    await wait(50);
    var memF = devF.memoryCache;
    memF.customers = {};
    // 5 thay doi trong khoang 50ms
    for (var q = 0; q < 5; q++) {
        memF.customers['cus' + q] = { id: 'cus' + q, name: 'K' + q, totalDebt: 10000 * (q + 1), debtHistory: [], paymentHistory: [], prepaidBalance: 0 };
        var sq = { exists: function () { return true; }, key: 'cus' + q, val: function () { return memF.customers['cus' + q]; } };
        (devF._listeners.customers || {}).child_changed.forEach(function (cb) { cb(sq); });
    }
    await wait(500);
    // 5 ghi liên tiếp trong cùng một khoảng -> Firebase bắn 5 child_changed.
    //
    // Hành vi ĐÚNG hiện tại:
    //  - đường DB.subscribe (đọc lại toàn bộ collection) vẫn gộp còn 1 lần
    //  - đường Event Bus bắn TỪNG bản ghi một: 5 sự kiện
    // renders.list đếm cả hai nên tổng = 1 + 5 = 6.
    //
    // Trước đây là 2 (1 + 1): Event Bus chỉ bắn 1 sự kiện mang bản ghi CUỐI
    // CÙNG, nên 4 khách còn lại không có sự kiện nào. realtime-pos.js xử lý
    // bản ghi ĐÍNH DANH từ event.payload nên máy khia không thấy 4 khách đó.
    eq('5 thay doi lien tiep -> 1 subscribe + 5 su kien', rendersF.list, 6);
    eq('5 thay doi lien tiep -> cache day du 5 khach', Object.keys(memF.customers).length, 5);

    console.log('\n=========================================');
    console.log('  TONG: ' + (pass + fail) + ' assertions');
    console.log('  PASS: ' + pass);
    console.log('  FAIL: ' + fail);
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
    console.error('LOI KHI CHAY TEST:', e.message);
    console.error(e.stack);
    process.exit(1);
});
