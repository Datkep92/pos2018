// =====================================================================
// SO DOANH THU: employees.js (thuong NV) vs manager.js (bao cao)
// Nap code THAT tu pos2018/
// Chay: node test-revenue-match.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var empSrc = fs.readFileSync(path.join(__dirname, '.', 'employees.js'), 'utf8');
var mgSrc = fs.readFileSync(path.join(__dirname, '.', 'manager.js'), 'utf8');

function ex(src, n) {
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

// ---------------------------------------------------------------
// Sandbox chung: DB gia lap, firebase gia lap
// ---------------------------------------------------------------
var TX = [];            // danh sach giao dich se tra ve tu DB
var WRITES = {};        // nhung gi da ghi len Firebase
var EXISTING = {};      // du lieu daily_revenue dang co tren Firebase
var _dbRangeCalls = [];

function makeSandbox() {
    var sb = {
        console: { log: function () { }, warn: function () { }, error: function () { } },
        setTimeout: function (fn) { fn(); return 1; },   // chay ngay de test khong treo
        clearTimeout: function () { },
        Date: Date, Math: Math, JSON: JSON, String: String, Array: Array, Number: Number,
        parseInt: parseInt, isNaN: isNaN, Promise: Promise,
        DB: {
            getTransactionsByDate: function (d) { return Promise.resolve(TX.filter(function (t) { return t.dateKey === d; })); },
            getTransactionsByDateRange: function (a, b) {
                _dbRangeCalls.push([a, b]);
                // tra ve TAT CA giao dich, khong loc theo dateKey - de test
                // phat hien loi khi code tu tach dateKey tu createdAt
                return Promise.resolve(TX.slice());
            },
            getShopId: function () { return 'shop1'; }
        },
        firebase: {
            database: function () {
                return {
                    ref: function (path) {
                        return {
                            update: function (obj) {
                                // Firebase ref().update() GOP them vao node cu,
                                // khong thay the - mock cung phai gop
                                var key = path || '_root_';
                                if (!WRITES[key]) WRITES[key] = {};
                                for (var k in obj) if (obj.hasOwnProperty(k)) WRITES[key][k] = obj[k];
                                return Promise.resolve();
                            },
                            set: function (v) { WRITES[path] = v; return Promise.resolve(); },
                            once: function (ev, cb) {
                                if (cb) cb({ val: function () { return EXISTING[path || '_root_'] || null; } });
                                return { catch: function () { return Promise.resolve(); } };
                            }
                        };
                    }
                };
            }
        },
        document: { getElementById: function () { return null; } },
        showToast: function () { }
    };
    sb.window = sb;
    return sb;
}

// Nap employees.js
var sbE = makeSandbox();
sbE.EMP = { staffs: [], attendanceCache: {}, salaryCache: {}, _revenueCache: {} };
var ctxE = vm.createContext(sbE);
vm.runInContext('var _empDailyRevenueCache = {}; var _EMP_DAILY_REVENUE_TTL = 30000;' +
    'var _empDailyRevenueDebounceTimer = null;', ctxE);
var NEED_E = ['empGetShopId', 'empGetDaysInMonth', '_debounceFirebaseWrite',
    '_empTxDateKey', '_empZeroStaleRevenueDays',
    'empUpdateDailyRevenue', 'empRecalculateDailyRevenueForPeriod'];
vm.runInContext(NEED_E.map(function (f) { return ex(empSrc, f); }).join('\n\n'), ctxE);
NEED_E.forEach(function (f) { sbE[f] = vm.runInContext(f, ctxE); });

// Nap manager.js
var sbM = makeSandbox();
sbM.managerData = { transactions: [], customers: [], staffs: [] };
var ctxM = vm.createContext(sbM);
vm.runInContext('var DRINK_STATS_INITIAL=20; var _drinkStatsAll=[]; var _drinkStatsExpanded=false;' +
    'var MANAGER_DEBT_LIMIT=30; var _debtListExpanded=false; var _lastDebtBalances=[]; var lowStockDirty=true;', ctxM);
vm.runInContext(ex(mgSrc, '_toLocalDateStr') + '\n' + ex(mgSrc, '_getRangeMs') + '\n' +
    ex(mgSrc, '_itemTimeMs') + '\n' + ex(mgSrc, '_buildDayIndex') + '\n' +
    ex(mgSrc, '_countDaysInMonth') + '\n' + ex(mgSrc, '_getSalaryPeriodOfRange') + '\n' +
    ex(mgSrc, '_dateStrToMs') + '\n' + ex(mgSrc, 'managerComputeSalaryForRange') + '\n' +
    ex(mgSrc, 'managerComputeStats'), ctxM);
sbM.managerComputeStats = vm.runInContext('managerComputeStats', ctxM);

console.log('SO DOANH THU: THUONG NHAN VIEN vs BAO CAO QUAN LY');

function reset() { TX = []; WRITES = {}; EXISTING = {}; _dbRangeCalls = []; vm.runInContext('_empDailyRevenueCache = {};', ctxE); }

// Doanh thu theo cach manager.js
function revManager() {
    return sbM.managerComputeStats(TX, [], [], [], [], new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59)).revenue;
}
// Doanh thu theo cach employees.js (empUpdateDailyRevenue -> daily_revenue)
function revEmployee(dateKey) {
    vm.runInContext('_empDailyRevenueCache = {};', ctxE);
    sbE.empUpdateDailyRevenue(dateKey);
    // ham nay khong tra ve Promise -> cho vong gia de DB.getTransactionsByDate chay xong
    return new Promise(function (res) { setImmediate(function () { setImmediate(function () {
        var c = vm.runInContext('_empDailyRevenueCache', ctxE);
        res(c[dateKey] ? c[dateKey].total : null);
    }); }); });
}

var D = '2026-08-15';

var tests = [
    { ten: 'ban tra tien', tx: [{ id: 1, type: 'dinein', paymentMethod: 'cash', amount: 50000, dateKey: D }], expect: 50000 },
    { ten: 'ban chuyen khoan', tx: [{ id: 1, type: 'dinein', paymentMethod: 'transfer', amount: 70000, dateKey: D }], expect: 70000 },
    { ten: 'ban Grab', tx: [{ id: 1, type: 'grab', paymentMethod: 'grab', amount: 90000, dateKey: D }], expect: 90000 },
    { ten: 'ghi no (chua thu tien)', tx: [{ id: 1, type: 'debt_payment', paymentMethod: 'debt', amount: 120000, dateKey: D }], expect: 0 },
    { ten: 'khach tra no bang tien mat', tx: [{ id: 1, type: 'debt_payment', paymentMethod: 'cash', amount: 120000, dateKey: D }], expect: 120000 },
    { ten: 'don da hoan tien', tx: [{ id: 1, type: 'dinein', paymentMethod: 'cash', amount: 50000, dateKey: D, refunded: true }], expect: 0 },
    { ten: 'XOA BAN (da xoá)', tx: [{ id: 1, type: 'delete_table', paymentMethod: 'delete', amount: 300000, dateKey: D }], expect: 0 }
];

(function run() {
    var chain = Promise.resolve();
    tests.forEach(function (t) {
        chain = chain.then(function () {
            group('KHOI DONG: ' + t.ten);
            reset();
            TX = t.tx;
            var mRev = revManager();
            eq('manager.js bao cao', mRev, t.expect);
            return revEmployee(D).then(function (eRev) {
                eq('employees.js tinh thuong', eRev, t.expect);
                if (eRev !== mRev) {
                    ok('HAI BEN KHONG KHOIP', false,
                        'chenh lech ' + Math.abs(eRev - mRev) + 'd -> thuong NV sai so voi bao cao');
                } else {
                    ok('HAI BEN KHOIP', true);
                }
            });
        });
    });

    // ---- createdAt la TIMESTAMP (so) ----
    chain = chain.then(function () {
        group('createdat LA TIMESTAMP (SO)');
        reset();
        TX = [{ id: 1, type: 'dinein', paymentMethod: 'cash', amount: 50000, createdAt: new Date(2026, 7, 15).getTime() }];
        sbE.empRecalculateDailyRevenueForPeriod(2026, 8);
        return new Promise(function (res) { setImmediate(function () { setImmediate(res); }); }).then(function () {
            // code dung ref().update({...}) -> gom nhieu node vao 1 lan
            var keys = Object.keys(WRITES['_root_'] || {}).filter(function (k) { return k.indexOf('daily_revenue') >= 0; });
            console.log('  node da ghi: ' + JSON.stringify(keys));
            ok('ghi dung node YYYY-MM-DD', keys.length === 1 && /daily_revenue\/\d{4}-\d{2}-\d{2}$/.test(keys[0]),
                'thuc te = ' + JSON.stringify(keys));
        });
    });

    // ---- ngay het giao dich nhung firebase van con so cu ----
    chain = chain.then(function () {
        group('NGAY DA HET GIAO DICH -> PHAI GHI 0');
        reset();
        TX = [];
        sbE.empUpdateDailyRevenue(D);
        return new Promise(function (res) { setImmediate(function () { setImmediate(res); }); }).then(function () {
            var w = WRITES['shop1/daily_revenue/' + D];
            console.log('  da ghi: ' + JSON.stringify(w));
            ok('ghi 0 de xoa so cu', !!w && w.total === 0,
                'khong ghi gi -> Firebase giu so cu -> thuong sai');
        });
    });

    // ---- ca thang: ngay 03/8 het don, firebase van con 5 trieu ----
    chain = chain.then(function () {
        group('CA THANG: NGAY DA HET GIAO DICH BI GHI 0');
        reset();
        EXISTING = {
            'shop1/daily_revenue': {
                '2026-08-02': { total: 4000000, orderCount: 40 },
                '2026-08-03': { total: 5000000, orderCount: 50 },   // het don -> phai ve 0
                '2026-08-04': { total: 6000000, orderCount: 60 },   // con don -> ghi lai
                '2026-08-05': { total: 0, orderCount: 0 }            // da 0 roi -> bo qua
            }
        };
        TX = [
            { id: 1, type: 'dinein', paymentMethod: 'cash', amount: 2000000, dateKey: '2026-08-02' },
            { id: 2, type: 'dinein', paymentMethod: 'cash', amount: 3000000, dateKey: '2026-08-04' }
        ];
        sbE.empRecalculateDailyRevenueForPeriod(2026, 8);
        return new Promise(function (res) { setImmediate(function () { setImmediate(res); }); }).then(function () {
            var u = WRITES['_root_'] || {};
            var n03 = u['shop1/daily_revenue/2026-08-03'];
            var n04 = u['shop1/daily_revenue/2026-08-04'];
            var n05 = u['shop1/daily_revenue/2026-08-05'];
            console.log('  03/8 (het don) -> ' + JSON.stringify(n03 && { total: n03.total }));
            console.log('  04/8 (con don) -> ' + JSON.stringify(n04 && { total: n04.total }));
            eq('03/8 het don -> ghi 0', n03 && n03.total, 0);
            eq('04/8 con don -> ghi 3.000.000', n04 && n04.total, 3000000);
            ok('05/8 da 0 roi -> khong ghi lai', !n05);
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