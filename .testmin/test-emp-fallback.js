// =====================================================================
// TEST DUONG FALLBACK DOANH THU (empLoadRevenueData)
// Nap code THAT tu pos2018/employees.js
// Chay: node test-emp-fallback.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join("C:\\\\Users\\\\cana2\\\\OneDrive\\\\Documents\\\\Default Project\\\\pos2018", '.', 'js.min', 'employees.min.js'), 'utf8');
function ex(n) {
    var m = new RegExp('function\\s+' + n + '\\s*\\(').exec(src);
    if (!m) throw new Error('khong tim thay ' + n);
    var i = src.indexOf('{', m.index), d = 0, s = false;
    for (; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } else if (src[i] === '}') { d--; if (s && d === 0) return src.slice(m.index, i + 1); } }
    throw new Error('khong dong ' + n);
}

var pass = 0, fail = 0;
function group(n) { console.log('\n=== ' + n + ' ==='); }
function eq(l, a, e) { if (a === e) { pass++; console.log('  PASS  ' + l + '  [' + JSON.stringify(a) + ']'); } else { fail++; console.log('  FAIL  ' + l + '  actual=' + JSON.stringify(a) + ' expected=' + JSON.stringify(e)); } }
function ok(l, c, x) { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l + (x ? '  ' + x : '')); } }

var TX = [];
var WRITES = {};
var FIREBASE_HAS_DAILY = false;   // false -> chay fallback
var RENDER_SAYS = [];
var FETCH_COUNT = 0;

var els = {};
function mkEl() {
    return {
        style: { display: 'none' }, value: '',
        classList: { add: function () {}, remove: function () {} },
        set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h || ''; },
        set textContent(v) { RENDER_SAYS.push(v); }, get textContent() { return ''; },
        addEventListener: function () {}, insertAdjacentHTML: function () {}
    };
}
var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: function (fn) { fn(); return 1; },
    clearTimeout: function () { },
    Date: Date, Math: Math, JSON: JSON, String: String, Array: Array, Number: Number,
    parseInt: parseInt, isNaN: isNaN, Promise: Promise,
    document: { getElementById: function (id) { if (!els[id]) els[id] = mkEl(); return els[id]; }, addEventListener: function () { } },
    showToast: function () { },
    DB: {
        getShopId: function () { return 'shop1'; },
        getTransactionsByDateRange: function (a, b) {
            FETCH_COUNT++;
            return Promise.resolve(TX.slice());
        },
        update: function () { return Promise.resolve(); }
    },
    firebase: {
        database: function () {
            return {
                ref: function (path) {
                    return {
                        update: function (obj) {
                            var key = path || '_root_';
                            if (!WRITES[key]) WRITES[key] = {};
                            for (var k in obj) if (obj.hasOwnProperty(k)) WRITES[key][k] = obj[k];
                            return Promise.resolve();
                        },
                        set: function (v) { WRITES[path] = v; return Promise.resolve(); },
                        orderByKey: function () { return this; },
                        startAt: function () { return this; },
                        endAt: function () { return this; },
                        once: function (ev, cb) {
                            var snap = { val: function () {
                                if (FIREBASE_HAS_DAILY === 'zero') return { '2026-08-10': { total: 0 } };
                                if (FIREBASE_HAS_DAILY === true) return { '2026-08-10': { total: 111 } };
                                return null;
                            } };
                            if (typeof cb !== 'function') return Promise.resolve(snap);
                            cb(snap);
                            return { catch: function () { return Promise.resolve(); }, off: function () { } };
                        },
                        on: function () { return {}; },
                        off: function () { }
                    };
                }
            };
        }
    },
    // stubs cho cac ham UI
    empInitDailyRevenueListener: function () { },
    empRecalculateSalary: function () { },
    empRenderStaffList: function () { },
    _invalidateEmpManagerCache: function () { },
    empUpdateManagerButton: function () { },
    empFormatCurrency: function (n) { return String(n); }
};
sandbox.window = sandbox;
sandbox.EMP = { staffs: [], attendanceCache: {}, salaryCache: {}, _revenueCache: {}, _revenueLoading: {} };

var NEED = ['empGetShopId', 'empGetDaysInMonth', '_empTxDateKey', 'empLoadRevenueData'];
var ctx = vm.createContext(sandbox);
vm.runInContext(NEED.map(ex).join('\n\n'), ctx);
NEED.forEach(function (f) { sandbox[f] = vm.runInContext(f, ctx); });
sandbox.EMP = vm.runInContext('EMP', ctx);

function reset() {
    TX = []; WRITES = {}; FIREBASE_HAS_DAILY = false; FETCH_COUNT = 0; RENDER_SAYS = [];
    vm.runInContext('EMP._revenueCache = {}; EMP._revenueLoading = {};', ctx);
}
function tick() { return new Promise(function (res) { setImmediate(function () { setImmediate(function () { setImmediate(res); }); }); }); }

console.log('TEST DUONG FALLBACK DOANH THU (employees.js)');

(function () {
    var chain = Promise.resolve();

    // -----------------------------------------------------------------
    chain = chain.then(function () {
        group('F1: XOA BAN KHONG DUOC TINH VAO DOANH THU');
        reset();
        TX = [
            { id: 1, type: 'dinein', paymentMethod: 'cash', amount: 50000, dateKey: '2026-08-10' },
            { id: 2, type: 'delete_table', paymentMethod: 'delete', amount: 300000, dateKey: '2026-08-10' }
        ];
        sandbox.empLoadRevenueData(2026, 8);
        return tick().then(function () {
            eq('10/8 chi con 50.000 (da bo 300.000 cua ban xoa)',
                sandbox.EMP._revenueCache['2026-08-10'], 50000);
            eq('ghi len Firebase cung 50.000',
                WRITES['shop1/daily_revenue/2026-08-10'].total, 50000);
        });
    });

    // -----------------------------------------------------------------
    chain = chain.then(function () {
        group('F2: createdat LA TIMESTAMP -> KEY DUNG DANG YYYY-MM-DD');
        reset();
        TX = [{ id: 1, type: 'dinein', paymentMethod: 'cash', amount: 50000, createdAt: new Date(2026, 7, 10).getTime() }];
        sandbox.empLoadRevenueData(2026, 8);
        return tick().then(function () {
            eq('cache 10/8 = 50.000', sandbox.EMP._revenueCache['2026-08-10'], 50000);
            var keys = Object.keys(WRITES).filter(function (k) { return k.indexOf('daily_revenue') >= 0; });
            ok('khong ghi node dang timestamp', keys.every(function (k) { return /\d{4}-\d{2}-\d{2}$/.test(k); }),
                'node = ' + JSON.stringify(keys));
        });
    });

    // -----------------------------------------------------------------
    chain = chain.then(function () {
        group('F3: XOA TRUONG CU DE KHONG TRANH GHI GIA TRI MOI');
        reset();
        TX = [{ id: 1, type: 'dinein', paymentMethod: 'cash', amount: 70000, dateKey: '2026-08-10' }];
        sandbox.empLoadRevenueData(2026, 8);
        return tick().then(function () {
            var w = WRITES['shop1/daily_revenue/2026-08-10'];
            console.log('  ghi: ' + JSON.stringify(w));
            eq('total moi = 70.000', w.total, 70000);
            eq('cash bi dat null (xoa truong cu)', w.cash, null);
            eq('transfer bi dat null', w.transfer, null);
            eq('grab bi dat null', w.grab, null);
        });
    });

    // -----------------------------------------------------------------
    chain = chain.then(function () {
        group('F4: DA CO DAILY_REVENUE -> DUNG DUONG CHINH');
        reset();
        FIREBASE_HAS_DAILY = true;
        TX = [{ id: 1, type: 'dinein', paymentMethod: 'cash', amount: 70000, dateKey: '2026-08-10' }];
        sandbox.empLoadRevenueData(2026, 8);
        return tick().then(function () {
            eq('dung doanh thu tu Firebase', sandbox.EMP._revenueCache['2026-08-10'], 111);
            eq('khong goi tinh lai tu transactions', FETCH_COUNT, 0);
        });
    });

    // -----------------------------------------------------------------
    chain = chain.then(function () {
        group('F5: DOANH THU = 0 VAN DUOC DOC VAO CACHE');
        reset();
        FIREBASE_HAS_DAILY = 'zero';
        sandbox.EMP._revenueCache['2026-08-10'] = 999999;
        sandbox.empLoadRevenueData(2026, 8);
        return tick().then(function () {
            eq('total = 0 phai ghi de gia tri cu trong cache',
                sandbox.EMP._revenueCache['2026-08-10'], 0);
        });
    });

    // -----------------------------------------------------------------
    chain = chain.then(function () {
        group('F6: CO THOI GIAN NAP LAI KHI MO LAI KY CU');
        reset();
        FIREBASE_HAS_DAILY = true;
        sandbox.empLoadRevenueData(2026, 8);
        return tick().then(function () {
            eq('cua nap bi tat sau khi xong', sandbox.EMP._revenueLoading['2026-8'], undefined);
            // goi lai -> van chay duong chinh (khong bi chan)
            FETCH_COUNT = 0;
            sandbox.empLoadRevenueData(2026, 8);
            return tick().then(function () {
                eq('vao lai ky 8 van nap lai duoc', FETCH_COUNT, 0);
                ok('cua khong con bi chan', !sandbox.EMP._revenueLoading['2026-8']);
            });
        });
    });

    // -----------------------------------------------------------------
    chain = chain.then(function () {
        group('F7: empGetDaysInMonth CHAN THANG SAI');
        eq('thang 0 -> 31 ngay (thang 12/2025)', sandbox.empGetDaysInMonth(2026, 0), 31);
        eq('thang 13 -> 31 ngay', sandbox.empGetDaysInMonth(2026, 13), 31);
        eq('thang 2/2028 -> 29', sandbox.empGetDaysInMonth(2028, 2), 29);
        eq('thang 2/2026 -> 28', sandbox.empGetDaysInMonth(2026, 2), 28);
        eq('thang 12 -> 31', sandbox.empGetDaysInMonth(2026, 12), 31);
        eq('tham so rong -> 0', sandbox.empGetDaysInMonth('a', 'b'), 0);
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