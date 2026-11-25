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

chain.catch(function (e) {
    fail++;
    console.log('  FAIL  loi khong mong mo: ' + (e && e.stack || e));
}).then(function () {
    console.log('\nTONG: PASS=' + pass + ' FAIL=' + fail);
    if (fail > 0) process.exitCode = 1;
});
