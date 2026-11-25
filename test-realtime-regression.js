// =====================================================================
// TEST HỒI QUY: DATABASE + REALTIME POS ĐA THIẾT BỊ
// Chay: node test-realtime-regression.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = __dirname;
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function ex(src, n) {
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
function eq(l, a, e) {
    if (a === e) { pass++; console.log('  PASS  ' + l + '  [' + JSON.stringify(a) + ']'); }
    else { fail++; console.log('  FAIL  ' + l + '  actual=' + JSON.stringify(a) + ' expected=' + JSON.stringify(e)); }
}
function ok(l, c, x) {
    if (c) { pass++; console.log('  PASS  ' + l); }
    else { fail++; console.log('  FAIL  ' + l + (x ? '  ' + x : '')); }
}
function baseSandbox(extra) {
    var s = {
        console: { log: function () { }, warn: function () { }, error: function () { } },
        Date: Date, Math: Math, JSON: JSON, String: String, Number: Number,
        Array: Array, Object: Object, Boolean: Boolean, RegExp: RegExp,
        parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
        setTimeout: function () { return 1; }, clearTimeout: function () { },
        setInterval: function () { return 1; }, clearInterval: function () { },
        Promise: Promise, Error: Error
    };
    for (var k in extra) if (extra.hasOwnProperty(k)) s[k] = extra[k];
    s.window = s;
    vm.createContext(s);
    return s;
}

var dbSrc = read('db.js');
var rtSrc = read('realtime-pos.js');
var empSrc = read('employees.js');
var tblSrc = read('tables.js');
var minSrc = read(path.join('js.min', 'db.min.js'));
var minRtSrc = read(path.join('js.min', 'realtime-pos.min.js'));

var chain = Promise.resolve();

// ---------- 1. DEDUP THEO MOC SERVER, KHONG THEO _version ----------
chain = chain.then(function () {
    group('1. Realtime: dedup theo _syncedAt');
    var s = baseSandbox();
    vm.runInContext('var _processedKeys = {}; var _PROCESSED_KEYS_TTL = 10000;' +
        'var memoryCache = {}; var CURRENT_DEVICE_ID = "dev1";', s);
    vm.runInContext([
        ex(dbSrc, '_isRecentlyProcessed'),
        ex(dbSrc, '_markProcessed'),
        ex(dbSrc, '_remoteStamp'),
        ex(dbSrc, '_shouldApplyRemote')
    ].join('\n'), s);
    var mark = vm.runInContext('_markProcessed', s);
    var should = vm.runInContext('_shouldApplyRemote', s);

    mark('customers', 'c1', 1000);
    eq('echo cung moc bi nuot', should('customers', 'c1', { _syncedAt: 1000 }), false);
    eq('moc moi hon duoc qua (dua vua xu ly)', should('customers', 'c1', { _syncedAt: 2000 }), true);
    eq('moc cu hon bi nuot', should('customers', 'c1', { _syncedAt: 1500 }), false);

    s.memoryCache.orders = { o1: { _version: 99, _syncedAt: 5000 } };
    eq('remote cu hon (du _version cao) bi nuot',
        should('orders', 'o1', { _version: 1, _syncedAt: 4000 }), false);
    eq('remote moi hon (du _version thap) duoc qua',
        should('orders', 'o1', { _version: 1, _syncedAt: 6000 }), true);
});

// ---------- 2. patchTable DUNG SNAPSHOT SAU COMMIT ----------
chain = chain.then(function () {
    group('2. patchTable: khong mat mon khi transaction chay lai');
    var saved = [], notified = [];
    var s = baseSandbox({
        STORE: {},
        _getDb: function () {
            return { ref: function (p) {
                return { transaction: function (cb) {
                    var cur = s.STORE[p] ? JSON.parse(JSON.stringify(s.STORE[p])) : null;
                    var first = cb(cur); // lan 1: doc ban cu
                    // Gia lap may khac ghi them mon B trong luc retry.
                    var retried = JSON.parse(JSON.stringify(first || cur || {}));
                    retried.items = [{ id: 'B', name: 'Tra', qty: 1 }];
                    var finalData = cb(retried); // lan 2: thay du lieu moi nhat
                    s.STORE[p] = finalData;
                    return Promise.resolve({
                        committed: true,
                        snapshot: { val: function () { return JSON.parse(JSON.stringify(finalData)); } }
                    });
                } };
            } };
        }
    });
    vm.runInContext('var CURRENT_SHOP_ID = "shop_A"; var CURRENT_DEVICE_ID = "dev1";' +
        'var memoryCache = {}; var _suppressRealtime = 0;', s);
    vm.runInContext(
        'function saveToLocal(c, it){ globalThis.__saved.push(JSON.parse(JSON.stringify(it))); return Promise.resolve(); }\n' +
        'function _notifyLocal(c, e){ globalThis.__notified.push(e); }\n', s);
    s.__saved = saved; s.__notified = notified;
    vm.runInContext(ex(dbSrc, 'patchTable'), s);
    var patchTable = vm.runInContext('patchTable', s);
    s.STORE['shop_A/tables/tb5'] = { id: 'tb5', name: 'Ban 5', items: [] };

    return patchTable('tb5', function (cur) {
        var items = (cur.items || []).slice();
        var hasA = false;
        for (var i = 0; i < items.length; i++) if (items[i].id === 'A') hasA = true;
        if (!hasA) items.push({ id: 'A', name: 'Ca phe', qty: 1 });
        return { items: items };
    }).then(function (r) {
        eq('patchTable commit', r.ok, true);
        eq('ket qua tra ve co ca 2 mon', r.table.items.length, 2);
        eq('cache local co ca 2 mon', saved.length ? saved[0].items.length : -1, 2);
        eq('realtime duoc bao co cap nhat', notified.length, 1);
    });
});

// ---------- 3. REVISION THE BAN: _version khong the so sanh giua 2 may ----------
chain = chain.then(function () {
    group('3. Table card: revision gom ca moc thoi gian');
    var s = baseSandbox();
    vm.runInContext(ex(rtSrc, '_tableRevision'), s);
    var rev = vm.runInContext('_tableRevision', s);
    ok('cung _version, khac updatedAt -> khac revision',
        rev({ _version: 5, updatedAt: 100 }) !== rev({ _version: 5, updatedAt: 200 }));
    ok('_version thap hon nhung moc moi hon -> khac revision',
        rev({ _version: 1, updatedAt: 300 }) !== rev({ _version: 9, updatedAt: 200 }));
    eq('ban ghi khong co moc -> revision on dinh', rev({ id: 'x' }), rev({ id: 'x' }));
});

// ---------- 4. KIEM TRA CAC DIEM NOI DA SUA ----------
chain = chain.then(function () {
    group('4. Lien ket su kien va rules');
    ok('employees lang nghe tren window',
        /window\.addEventListener\(\s*'pos_cash_update'/.test(empSrc) &&
        !/document\.addEventListener\(\s*'pos_cash_update'/.test(empSrc));
    ok('tables dispatch ca window va document',
        /window\.dispatchEvent\(evt\)[\s\S]{0,400}document\.dispatchEvent\(evt\)/.test(tblSrc));
    ok('bonus fund khong goi ham khong ton tai',
        !/refreshBonusFund\(\);/.test(rtSrc));
    ok('co subscription staffs va ingredient_transactions',
        /DB\.subscribe\(\s*'staffs'/.test(rtSrc) &&
        /DB\.subscribe\(\s*'ingredient_transactions'/.test(rtSrc));
    ok('syncDateBasedOnly dung deltaSyncByTime',
        /if \(missing\.length === 0\) return deltaSyncByTime\(collection\);/.test(dbSrc));
    ok('empty snapshot van phat su kien synced',
        dbSrc.indexOf("collection + ':synced'") >= 0);
    ok('fullSync giu lai item pending truoc khi clear',
        dbSrc.indexOf('loadFromLocal(collection).catch(function() { return []; })') >= 0 &&
        dbSrc.indexOf('_queueBelongsToCurrentShop(q)') >= 0);
    ok('doi shop xoa active listeners',
        dbSrc.indexOf('delete _activeListeners[activeCol]') >= 0);

    ['database.rules.json', 'firebase-rules.json'].forEach(function (f) {
        var r = JSON.parse(read(f)).rules;
        var shop = r['$shopId'];
        ok(f + ': doc/alias duoc phep', r['.read'] === true && r['.write'] === true);
        ok(f + ': co index _version cho tables + transactions',
            shop.tables['.indexOn'].indexOf('_version') >= 0 &&
            shop.transactions['.indexOn'].indexOf('_version') >= 0);
        ok(f + ': co refund_failures', !!shop.refund_failures &&
            shop.refund_failures['.indexOn'].indexOf('_version') >= 0);
        ok(f + ': co bonus_fund + messages', !!shop.bonus_fund && !!shop.messages);
    });

    ok('js.min da chua _tableRevision', minRtSrc.indexOf('_tableRevision') >= 0);
    ok('js.min/db da chua dedup moi', minSrc.indexOf('!recStamp || stamp > recStamp') >= 0);
});

// ---------- 5. FULLSYNC KHONG MAT BAN GHI CHUA GUI ----------
chain = chain.then(function () {
    group('5. FullSync: giu ban ghi pending khi server co du lieu');
    var saved = [];
    var s = baseSandbox({
        localDB: {
            transaction: function () {
                return { objectStore: function () {
                    return { clear: function () {
                        var req = {};
                        Promise.resolve().then(function () { if (req.onsuccess) req.onsuccess(); });
                        return req;
                    } };
                } };
            }
        },
        _getDb: function () {
            return { ref: function () { return { once: function (ev, cb) {
                cb({ exists: function () { return true; },
                     val: function () { return { r1: { _version: 1 } }; } });
            } }; } };
        }
    });
    vm.runInContext([
        'var isOnline = true; var CURRENT_SHOP_ID = "shopA"; var THIRTY_DAYS_MS = 1;',
        'var DATE_BASED_COLLECTIONS = {}; var MASTER_COLLECTIONS = { tables: true };',
        'var memoryCache = { tables: {} }; var _syncingCollections = {};',
        'var syncQueue = [{ collection: "tables", status: "pending", targetId: "dirty1", shopId: "shopA" }];',
        'var saved = [];',
        'function _setSuppressRealtime(){} function saveSyncMeta(){} function updateMetaOnFirebase(){} function _emit(){}',
        'function loadFromLocal(){ return Promise.resolve([{ id: "dirty1", _version: 1 }]); }',
        'function saveToLocal(c, it){ saved.push(it.id); return Promise.resolve(); }',
        ex(dbSrc, '_queueBelongsToCurrentShop'),
        ex(dbSrc, '_getUnsyncedKeys'),
        ex(dbSrc, 'fullSync')
    ].join('\n'), s);
    s.saved = saved;
    return vm.runInContext('fullSync("tables")', s).then(function () {
        eq('du lieu server duoc luu', saved.indexOf('r1') >= 0, true);
        eq('ban ghi pending duoc khoi phuc', saved.indexOf('dirty1') >= 0, true);
    });
});

// ---------- 6. REALTIME BAO TAB QUAN LY: DEBOUNCE CO MAXWAIT ----------
chain = chain.then(function () {
    group('6. Realtime bao tab quan ly: debounce co maxWait va guard dirty');
    var timers = {}, seq = 0, now = 1000;
    function fakeSetTimeout(fn, ms) { var id = ++seq; timers[id] = { fn: fn, ms: ms }; return id; }
    function fakeClearTimeout(id) { delete timers[id]; }
    function flushOne() {
        var ids = Object.keys(timers);
        if (!ids.length) return false;
        var t = timers[ids[0]];
        delete timers[ids[0]];
        t.fn();
        return true;
    }
    function longestDelay() {
        var m = 0;
        Object.keys(timers).forEach(function (id) { if (timers[id].ms > m) m = timers[id].ms; });
        return m;
    }
    var s = baseSandbox({
        setTimeout: fakeSetTimeout,
        clearTimeout: fakeClearTimeout,
        Date: { now: function () { return now; } }
    });
    vm.runInContext([
        'var _realtimeTimers = {}; var _realtimeDebounceStart = {};',
        'var currentTab = "manager";',
        'var _dirtyCalls = 0, _refreshCalls = 0;',
        'window.markManagerViewDirty = function(){ _dirtyCalls++; };',
        'window.refreshManagerCurrentView = function(){ _refreshCalls++; };',
        ex(rtSrc, '_debounceRealtime'),
        ex(rtSrc, '_markManagerViewDirty'),
        ex(rtSrc, '_refreshManagerAfterRealtime'),
        ex(rtSrc, '_renderNow')
    ].join('\n'), s);

    ok('co markManagerViewDirty guard',
        /function _markManagerViewDirty\(\)[\s\S]{0,200}window\.markManagerViewDirty/.test(rtSrc));
    ok('debounce co maxWait mac dinh 1000',
        /function _debounceRealtime\(key, fn, delay, maxWait\)/.test(rtSrc) &&
        /maxWait = maxWait \|\| 1000/.test(rtSrc));

    vm.runInContext('_refreshManagerAfterRealtime()', s);
    eq('dang o manager: len lich 1 lan', Object.keys(timers).length, 1);
    ok('delay khong vuot maxWait', longestDelay() <= 1000, 'delay=' + longestDelay());
    flushOne();
    eq('dang o manager: goi refresh', vm.runInContext('_refreshCalls', s), 1);
    eq('dang o manager: khong danh dau dirty', vm.runInContext('_dirtyCalls', s), 0);

    vm.runInContext('currentTab = "tables"; _refreshManagerAfterRealtime()', s);
    eq('khong o manager: danh dau dirty', vm.runInContext('_dirtyCalls', s), 1);
    eq('khong o manager: khong len lich moi', Object.keys(timers).length, 0);

    vm.runInContext('delete window.refreshManagerCurrentView; currentTab = "manager"; _refreshManagerAfterRealtime()', s);
    eq('thieu ham refresh: danh dau dirty', vm.runInContext('_dirtyCalls', s), 2);

    var fired = 0;
    s.__fired = function () { fired++; };
    vm.runInContext('_debounceRealtime("maxWaitKey", function(){ globalThis.__fired(); }, 250, 1000)', s);
    for (var i = 0; i < 3; i++) {
        now += 200;
        vm.runInContext('_debounceRealtime("maxWaitKey", function(){ globalThis.__fired(); }, 250, 1000)', s);
    }
    ok('maxWait: lich hen cuoi khong vuot 1000ms', longestDelay() <= 1000, 'delay=' + longestDelay());
    flushOne();
    eq('maxWait: chay dung 1 lan', fired, 1);
    eq('maxWait: xoa moc sau khi chay', vm.runInContext('_realtimeDebounceStart.maxWaitKey || null', s), null);

    var appSrc = read('pos-app.js'), expSrc = read('expense.js');
    ok('events giao dich/nhan vien/nguyen lieu deu bao quan ly',
        /DB\.on\('transactions:\*'[\s\S]{0,300}_refreshManagerAfterRealtime\(\)/.test(rtSrc) &&
        /function _refreshStaffsRealtime\(\)[\s\S]{0,200}_refreshManagerAfterRealtime\(\)/.test(rtSrc) &&
        /function _refreshIngredientTxRealtime\(\)[\s\S]{0,200}_refreshManagerAfterRealtime\(\)/.test(rtSrc));
    ok('early return co guard dirty',
        /if \(currentTab !== 'tables'\) \{ _markManagerViewDirty\(\); return; \}/.test(rtSrc) &&
        /if \(!event \|\| !event\.data\) \{ _markManagerViewDirty\(\); return; \}/.test(rtSrc));
    ok('expense chi refresh khi tab quan ly active',
        /function _isManagerViewActive\(\)[\s\S]{0,300}window\.currentTab === 'manager'/.test(expSrc) &&
        /_isManagerViewActive\(\) && typeof refreshManagerCurrentView/.test(expSrc));
    ok('pos-app guard initRealtime va giu managerApplyFilter',
        /typeof initRealtime === 'function'/.test(appSrc) &&
        appSrc.indexOf('managerApplyFilter()') >= 0);
});

chain.catch(function (e) {
    fail++;
    console.log('  FAIL  loi khong mong mo: ' + (e && e.stack || e));
}).then(function () {
    console.log('\nTONG: PASS=' + pass + ' FAIL=' + fail);
    if (fail > 0) process.exitCode = 1;
});
