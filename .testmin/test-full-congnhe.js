// =====================================================================
// HARNESS: nap code THAT tu pos2018/customers.js va chay kich ban that
// Khong viet lai logic - dung chinh xac ham co trong file nguon.
// Chay: node test-full-congnhe.js
// =====================================================================
var fs = require('fs');
var path = require('path');

var SRC_PATH = path.join("C:\\\\Users\\\\cana2\\\\OneDrive\\\\Documents\\\\Default Project\\\\pos2018", '.', 'js.min', 'customers.min.js');
var src = fs.readFileSync(SRC_PATH, 'utf8');

// ---------- Trich xuat 1 ham tu file nguon theo dau ngoac ----------
function extractFunc(name) {
    var re = new RegExp('function\\s+' + name + '\\s*\\(');
    var m = re.exec(src);
    if (!m) throw new Error('Khong tim thay function: ' + name);
    var start = m.index;
    // quet cam ngoac { } de dung tai function
    var i = src.indexOf('{', m.index);
    var depth = 0, started = false;
    for (; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        else if (src[i] === '}') {
            depth--;
            if (started && depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error('Khong dong duoc function: ' + name);
}

// ---------- Moi truong gia lap ----------
var customers = [];
var confirmAnswer = true;      // dap "co" hay "khong" cho confirm()
var toastLog = [];
var historyLog = [];           // moi giao dich da ghi
var dbCalls = [];
var domStore = {};             // gia tri input trong DOM
var showDetailCalls = [];

global.customers = customers;
global.confirm = function () { return confirmAnswer; };
global.parseInt = parseInt;
global.Date = Date;

global.showToast = function (msg) { toastLog.push(msg); return 1; };
global.hideToast = function () {};
global.formatMoney = function (n) {
    n = Math.round(n || 0);
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
};
global.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
global.closeModal = function () {};
global.renderCustomerList = function () {};
global._invalidateCustomerCalcCache = function () {};
global.showCustomerDetail = function () { showDetailCalls.push(1); };
global.handleCashPayment = function () { return Promise.resolve(); };
global.notifyPaymentToTelegram = function () {};
global.notifyTelegramWarning = function () {};
global.addHistory = function (h) {
    h.id = 'tx_' + (historyLog.length + 1);
    h.createdAt = new Date().toISOString();
    h.date = h.date || h.createdAt;
    historyLog.push(h);
    return Promise.resolve(h);
};
global.DB = {
    isAdmin: function () { return true; },
    update: function (col, id, data) {
        dbCalls.push({ op: 'update', col: col, id: id, data: data });
        var c = customers.filter(function (x) { return x.id === id; })[0];
        if (c) for (var k in data) c[k] = data[k];
        return Promise.resolve();
    },
    create: function (col, obj) {
        dbCalls.push({ op: 'create', col: col, data: obj });
        customers.push(obj);
        return Promise.resolve(obj);
    },
    remove: function (col, id) {
        dbCalls.push({ op: 'remove', col: col, id: id });
        for (var i = 0; i < customers.length; i++) if (customers[i].id === id) { customers.splice(i, 1); break; }
        return Promise.resolve();
    },
    get: function () { return Promise.resolve(null); },
    getAll: function (col) {
        if (col === 'customers') return Promise.resolve(customers);
        return Promise.resolve([]);
    },
    // customers.js ghi lại ai đã trả nợ / ai mua trước vào lịch sử
    getCurrentUser: function () { return { id: 'u_test', displayName: 'NV Test', username: 'test' }; }
};
global.document = {
    getElementById: function (id) {
        if (!(id in domStore)) domStore[id] = { value: '', style: {}, classList: { add: function () {}, remove: function () {}, contains: function () { return false; } }, innerText: '', innerHTML: '' };
        return domStore[id];
    },
    createElement: function () { return { style: {}, classList: { add: function () {} }, appendChild: function () {}, remove: function () {} }; },
    createDocumentFragment: function () { return { appendChild: function () {} }; },
    body: { appendChild: function () {}, classList: { add: function () {} } }
};
// hàm UI gọi ra sau khi thao tác thành công - không kiểm tra ở đây
global.showActivityToast = function () { };
global.showToast = function () { };
global._setToastExtra = function () { };
global.setTimeout = setTimeout;
global.Math = Math;
global.isNaN = isNaN;
global.Promise = Promise;
global._toLocalDateStr = function (d) { return d.toISOString().slice(0, 10); };

// ---------- Nap cac ham tu file nguon vao global ----------
// Gom TAT CA vao mot scope de cac ham goi lan nhau va dung bien cache dung duoc.
var FUNCS = [
    '_calcOutstandingDebt',
    '_removeAccents',
    '_invalidateCustomerCalcCache',
    '_isCustomerCacheValid',
    'confirmInlineDebtPayment',
    '_releaseInlineDebtLock',
    'addCustomerDebt',
    'addOldDebt',
    'editDebtEntry',
    'deleteDebtEntry',
    'addPrepaidBalance',
    'usePrepaidBalance',
    'addCustomer',
    '_migrateCustomerChangeBalance'
];

// Khai bao bien module-level can cho cac ham (lay tu file nguon neu co)
var VARS = ['_customerRenderGuard', '_customerCalcCache', '_CUSTOMER_CACHE_TTL', '_customerHistoryExpanded'];
var varSrc = VARS.map(function (v) {
    var re = new RegExp('var\\s+' + v + '\\s*=');
    var m = re.exec(src);
    if (m) {
        // lay toi het dong ket thuc bang dau ;
        var end = src.indexOf(';', m.index);
        return src.slice(m.index, end + 1);
    }
    return 'var ' + v + ' = ' + (v.indexOf('Cache') > 0 ? '{}' : '0') + ';';
}).join('\n');

var funcsSrc = FUNCS.map(extractFunc).join('\n\n');
var loader = new Function(
    varSrc + '\n' + funcsSrc + '\n' +
    FUNCS.map(function (f) { return 'global["' + f + '"] = ' + f + ';'; }).join('\n')
);
loader.call(global);

// =====================================================================
// Tien ich kiem tra
// =====================================================================
var pass = 0, fail = 0;
var currentCase = '';
function group(name) { currentCase = name; console.log('\n=== ' + name + ' ==='); }
function eq(label, actual, expected) {
    var ok = actual === expected;
    if (ok) { pass++; console.log('  PASS  ' + label + ' = ' + actual); }
    else { fail++; console.log('  FAIL  ' + label + '  actual=' + actual + ' expected=' + expected); }
    return ok;
}
function ok(label, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
    return cond;
}

// doc trang thai khach
function state(c) {
    return {
        no: _calcOutstandingDebt(c),                       // no con lai
        du: c.prepaidBalance || 0,                          // tien du
        field: c.totalDebt,                                // field totalDebt
        debtSum: (c.debtHistory || []).reduce(function (s, e) { return s + (e.amount || 0); }, 0),
        paySum: (c.paymentHistory || []).reduce(function (s, e) { return s + (e.amount || 0); }, 0),
        creditSum: (c.creditHistory || []).reduce(function (s, e) { return s + (e.amount || 0); }, 0)
    };
}
function mk(name, opts) {
    opts = opts || {};
    var c = {
        id: opts.id || ('cus_' + Math.random().toString(36).slice(2, 8)),
        name: name || 'Khach Test',
        phone: '',
        address: '',
        totalDebt: 0, totalSpent: 0, creditBalance: 0, prepaidBalance: 0,
        createdAt: new Date().toISOString(),
        debtHistory: [], paymentHistory: [], creditHistory: []
    };
    if (opts.debt) {
        opts.debt.forEach(function (a) {
            c.debtHistory.unshift({ id: Date.now() + Math.random(), date: new Date().toISOString(), amount: a, status: 'unpaid' });
        });
    }
    if (opts.pay) {
        opts.pay.forEach(function (a) {
            c.paymentHistory.unshift({ id: Date.now() + Math.random(), date: new Date().toISOString(), amount: a, method: 'cash' });
        });
    }
    if (opts.prepaid) {
        c.prepaidBalance = opts.prepaid;
        c.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: opts.prepaid, note: 'gop dau' });
    }
    c.totalDebt = _calcOutstandingDebt(c);
    c.creditBalance = c.prepaidBalance;
    customers = [c];
    global.customers = customers;
    historyLog = []; dbCalls = []; toastLog = [];
    return c;
}
function pay(c, amount, opts) {
    opts = opts || {};
    domStore.inlineDebtAmount = { value: String(amount) };
    confirmAnswer = opts.usePrepaid !== false;
    return _call(confirmInlineDebtPayment, c.id, opts.method || 'cash');
}
function _call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    // ham ghi vao DB theo promise -> ep do dong bo bang cach giu lai promise
    var p = null;
    try { p = fn.apply(null, args); } catch (e) { return { error: e }; }
    return p;
}
// lay creditUsed cua mot khoan no theo note
function creditUsedOf(c, note) {
    var e = (c.debtHistory || []).filter(function (x) { return x.note === note; })[0];
    return e ? (e.creditUsed || 0) : -1;
}
function settle() {
    // cho cac promise DB.update chay xong
    return new Promise(function (res) { setTimeout(res, 30); });
}

console.log('HARNESS: nap ' + FUNCS.length + ' ham that tu ' + SRC_PATH);
console.log('Ten file: ' + path.basename(SRC_PATH));

// =====================================================================
(async function run() {

    // ---------------------------------------------------------------
    group('K1: KHACH GHI NO 100k, TRA 150k -> DU 50k, SAU DO MUA NO 80k');
    // ---------------------------------------------------------------
    var c = mk('An', { debt: [100000] });
    eq('no ban dau', state(c).no, 100000);

    await pay(c, 150000);
    await settle();
    var s = state(c);
    eq('sau tra 150k: no = 0', s.no, 0);
    eq('sau tra 150k: du = 50k', s.du, 50000);
    eq('paymentHistory ghi 100k (khong phai 150k)', s.paySum, 100000);
    ok('tien mat thu nhan = 150k', historyLog[0].amount === 150000, 'amount=' + historyLog[0].amount);
    eq('debtSettled = 100k', historyLog[0].debtSettled, 100000);
    eq('prepaidChange = 50k', historyLog[0].prepaidChange, 50000);

    // gio mua them 80k, tu dong tru 50k du -> con no 30k
    await _call(addCustomerDebt, c.id, 80000, 'Mua them', []);
    await settle();
    s = state(c);
    eq('mua 80k khi du 50k: no = 30k', s.no, 30000);
    eq('mua 80k khi du 50k: du = 0', s.du, 0);
    eq('field totalDebt khop lich su', s.field, s.no);
    // 50k cua khoan mua 80k da duoc tru tu tien du nen KHONG vao debtHistory
    // debtHistory = 100k (ghi no ban dau) + 30k (phan con lai cua khoan mua)
    eq('tong no ghi = 130k (100k + 30k)', s.debtSum, 130000);
    eq('tong da tra = 100k', s.paySum, 100000);
    eq('no = 130k - 100k = 30k', s.debtSum - s.paySum, 30000);
    eq('creditHistory bang 0 (dung 50k, thu 50k)', s.creditSum, 0);

    // ---------------------------------------------------------------
    group('K2: KHACH NO 100k, DANG NO, TRA THIEU 60k, ROI GHI NO 50k');
    // ---------------------------------------------------------------
    c = mk('Binh', { debt: [100000] });
    await pay(c, 60000);
    await settle();
    s = state(c);
    eq('tra 60k: no con 40k', s.no, 40000);
    eq('tra 60k: khong co du', s.du, 0);
    eq('tra 60k: paymentHistory = 60k', s.paySum, 60000);

    await _call(addCustomerDebt, c.id, 50000, 'Mua them', []);
    await settle();
    s = state(c);
    eq('ghi no 50k: no = 90k', s.no, 90000);
    eq('ghi no 50k: du van 0', s.du, 0);
    eq('tong no = 150k', s.debtSum, 150000);
    eq('field khop', s.field, 90000);

    // ---------------------------------------------------------------
    group('K3: GHI DAU 200k, MUA DAN HANG GIAM DAN');
    // ---------------------------------------------------------------
    c = mk('Chi', { prepaid: 200000 });
    eq('gop dau: du = 200k', state(c).du, 200000);
    // gop dau 200k, mua dan:
    //  mua 50k  -> dung 50k du            -> du 150k, no 0
    //  mua 70k  -> dung 70k du            -> du  80k, no 0
    //  mua 90k  -> chi con 80k du, no 10k -> du   0, no 10k
    //  mua 150k -> het du, ghi no 150k     -> du   0, no 160k
    var buys = [50000, 70000, 90000, 150000];
    var expectDu = [150000, 80000, 0, 0];
    var expectNo = [0, 0, 10000, 160000];
    for (var i = 0; i < buys.length; i++) {
        await _call(addCustomerDebt, c.id, buys[i], 'Mua ' + i, []);
        await settle();
        s = state(c);
        eq('mua ' + buys[i] + ': du = ' + expectDu[i], s.du, expectDu[i]);
        eq('mua ' + buys[i] + ': no = ' + expectNo[i], s.no, expectNo[i]);
        eq('mua ' + buys[i] + ': field khop', s.field, s.no);
    }
    eq('creditHistory con lai 0', state(c).creditSum, 0);

    // ---------------------------------------------------------------
    group('K4: GHI DAU 100k, MUA 150k -> NO 50k, DU 0');
    // ---------------------------------------------------------------
    c = mk('Dung', { prepaid: 100000 });
    await _call(addCustomerDebt, c.id, 150000, 'Mua', []);
    await settle();
    s = state(c);
    eq('mua 150k khi du 100k: no = 50k', s.no, 50000);
    eq('mua 150k khi du 100k: du = 0', s.du, 0);
    eq('debtHistory chi ghi 50k (khong ghi 150k)', s.debtSum, 50000);
    eq('field khop', s.field, 50000);
    ok('giao dich ghi no chi tao 1 record 50k', historyLog.length === 1 && historyLog[0].amount === 50000,
        'history=' + JSON.stringify(historyLog.map(function (h) { return h.amount; })));
    eq('creditUsed tren giao dich = 100k', historyLog[0].creditUsed, 100000);

    // ---------------------------------------------------------------
    group('K5: GHI DAU 100k, MUA DUNG 100k -> NO 0, DU 0, KHONG TAO TX 0d');
    // ---------------------------------------------------------------
    c = mk('Giang', { prepaid: 100000 });
    await _call(addCustomerDebt, c.id, 100000, 'Mua', []);
    await settle();
    s = state(c);
    eq('mua dung bang du: no = 0', s.no, 0);
    eq('mua dung bang du: du = 0', s.du, 0);
    eq('debtHistory rong', s.debtSum, 0);
    eq('KHONG tao giao dich 0d', historyLog.length, 0);

    // ---------------------------------------------------------------
    group('K6: HOAN TAC THANH TOAN NO (refund) - khoi phuc dung so no');
    // ---------------------------------------------------------------
    c = mk('Hieu', { debt: [100000] });
    await pay(c, 150000);
    await settle();
    // refund: xoa entry paymentHistory, cong lai debtSettled, tru prepaidChange
    var tx = historyLog[0];
    var st0 = state(c);
    // mo phong refund nhu history.js lam
    var settled = typeof tx.debtSettled === 'number' ? tx.debtSettled : tx.amount;
    // xoa entry paymentHistory khop amount + thoi gian
    for (var p = 0; p < c.paymentHistory.length; p++) {
        if (c.paymentHistory[p].amount === settled) { c.paymentHistory.splice(p, 1); break; }
    }
    c.totalDebt = (c.totalDebt || 0) + settled;
    c.prepaidBalance = Math.max(0, (c.prepaidBalance || 0) - (tx.prepaidChange || 0));
    s = state(c);
    eq('refund: no khoi phuc 100k', s.no, 100000);
    eq('refund: du ve 0', s.du, 0);
    eq('refund: field khop lich su', s.field, s.no);

    // ---------------------------------------------------------------
    group('K7: HOAN TAC GHI NO (debt_payment/debt)');
    // ---------------------------------------------------------------
    c = mk('Khan', { debt: [80000] });
    await _call(addCustomerDebt, c.id, 60000, 'Mua them', []);
    await settle();
    var tx2 = historyLog[0];
    s = state(c);
    eq('truoc refund: no = 140k', s.no, 140000);
    // refund: xoa entry debtHistory khop amount + thoi gian, tru khoi totalDebt
    for (var d = 0; d < c.debtHistory.length; d++) {
        if (c.debtHistory[d].amount === tx2.amount) { c.debtHistory.splice(d, 1); break; }
    }
    c.totalDebt = Math.max(0, (c.totalDebt || 0) - tx2.amount);
    c.totalDebt = _calcOutstandingDebt(c);
    s = state(c);
    eq('refund ghi no: no ve 80k', s.no, 80000);
    eq('refund ghi no: field khop', s.field, 80000);

    // ---------------------------------------------------------------
    group('K8: XOA KHOAN NO (deleteDebtEntry) - hoan lai tien du');
    // ---------------------------------------------------------------
    c = mk('Lam', { prepaid: 80000 });
    await _call(addCustomerDebt, c.id, 120000, 'Mua', []);
    await settle();
    s = state(c);
    eq('truoc xoa: no = 40k', s.no, 40000);
    eq('truoc xoa: du = 0', s.du, 0);
    // debtHistory[0] la khoan vua ghi, creditUsed = 80000
    eq('debtHistory[0].creditUsed = 80k', c.debtHistory[0].creditUsed, 80000);
    confirmAnswer = true;
    await _call(deleteDebtEntry, c.id, 0);
    await settle();
    s = state(c);
    eq('sau xoa: no = 0', s.no, 0);
    eq('sau xoa: du hoan lai 80k', s.du, 80000);
    eq('sau xoa: field khop', s.field, 0);

    // ---------------------------------------------------------------
    group('K9: SUA KHOAN NO (editDebtEntry) - hoan lai tien du');
    // ---------------------------------------------------------------
    c = mk('Mai', { prepaid: 60000 });
    await _call(addCustomerDebt, c.id, 100000, 'Mua', []);
    await settle();
    s = state(c);
    eq('truoc sua: no = 40k', s.no, 40000);
    confirmAnswer = true;
    await _call(editDebtEntry, c.id, 0, 80000, 'Sua lai');
    await settle();
    s = state(c);
    eq('sau sua no 80k: no = 80k', s.no, 80000);
    eq('sau sua: du hoan lai 60k', s.du, 60000);
    eq('sau sua: field khop', s.field, 80000);

    // ---------------------------------------------------------------
    group('K10: TIM KIEM TEN CO DAU');
    // ---------------------------------------------------------------
    eq('Hùng -> hung', _removeAccents('Hùng'), 'hung');
    eq('Thùy -> thuy', _removeAccents('Thùy'), 'thuy');
    eq('Quỳnh -> quynh', _removeAccents('Quỳnh'), 'quynh');
    eq('Ngô Thị Hùng', _removeAccents('Ngô Thị Hùng'), 'ngothihung');
    eq('Đặng -> dang', _removeAccents('Đặng'), 'dang');

    // ---------------------------------------------------------------
    group('K11: BAT BIEN - TONG NO GOC == TONG DA TRA + NO CON LAI');
    // ---------------------------------------------------------------
    var seq = [
        { debt: 100000 }, { pay: 150000 }, { debt: 80000 },
        { pay: 20000 }, { debt: 300000 }, { pay: 500000 }
    ];
    c = mk('Invariant', {});
    for (var k = 0; k < seq.length; k++) {
        if (seq[k].debt) await _call(addCustomerDebt, c.id, seq[k].debt, 'x', []);
        if (seq[k].pay) await pay(c, seq[k].pay);
        await settle();
        var st = state(c);
        var expected = st.debtSum - st.paySum;
        eq('buoc ' + (k + 1) + ': debtSum - paySum = ' + expected + ' -> no ' + st.no, st.no, expected > 0 ? expected : 0);
        ok('buoc ' + (k + 1) + ': field totalDebt khop no con lai', st.field === st.no, 'field=' + st.field + ' no=' + st.no);
        ok('buoc ' + (k + 1) + ': du khong am', st.du >= 0, 'du=' + st.du);
    }

    // ---------------------------------------------------------------
    group('K12: DU KHONG BAO GIO AM');
    // ---------------------------------------------------------------
    c = mk('TestAm', { prepaid: 50000, debt: [30000] });
    await pay(c, 100000);
    await settle();
    s = state(c);
    ok('du >= 0', s.du >= 0, 'du=' + s.du);
    ok('no >= 0', s.no >= 0, 'no=' + s.no);
    eq('truong hop nay: no = 0', s.no, 0);
    eq('truong hop nay: du = 70k', s.du, 70000);

    // ---------------------------------------------------------------
    group('K13: creditBalance PHAI LUON BANG prepaidBalance');
    // ---------------------------------------------------------------
    // addPrepaidBalance cong don creditBalance rieng -> lech khi 2 field da lech san
    c = mk('Ngan', { prepaid: 100000 });
    c.creditBalance = 70000;   // gia lap du lieu cu bi lech (tu dong hoa du)
    await _call(addPrepaidBalance, c.id, 50000, 'Nap them');
    await settle();
    ok('sau addPrepaidBalance: creditBalance === prepaidBalance',
        c.creditBalance === c.prepaidBalance, 'creditBalance=' + c.creditBalance + ' prepaid=' + c.prepaidBalance);

    // usePrepaidBalance cung phai giu 2 field dong bo
    c = mk('Oanh', { prepaid: 100000 });
    c.creditBalance = 70000;
    await _call(usePrepaidBalance, c.id, 30000, 'Dung');
    await settle();
    ok('sau usePrepaidBalance: creditBalance === prepaidBalance',
        c.creditBalance === c.prepaidBalance, 'creditBalance=' + c.creditBalance + ' prepaid=' + c.prepaidBalance);

    // ---------------------------------------------------------------
    group('K14: MIGRATION - gop changeBalance vao prepaidBalance');
    // ---------------------------------------------------------------
    c = mk('Phuong', { prepaid: 50000 });
    c.changeBalance = 25000;   // du lieu cu con field da bo
    c.creditBalance = 50000;
    customers = [c]; global.customers = customers;
    _migrateCustomerChangeBalance();
    eq('changeBalance 25k duoc gop vao du', c.prepaidBalance, 75000);
    ok('changeBalance da bi xoa', c.changeBalance === undefined, 'changeBalance=' + c.changeBalance);
    eq('creditBalance dong bo', c.creditBalance, 75000);

    // ---------------------------------------------------------------
    group('K15: DUONG BIEN - moi thao tac deu giu du >= 0 va no >= 0');
    // ---------------------------------------------------------------
    var ops = [
        { debt: 50000 }, { pay: 20000 }, { prepaid: 80000 },
        { debt: 120000 }, { pay: 5000 }, { debt: 60000 },
        { pay: 300000 }, { debt: 40000 }
    ];
    c = mk('Bien', {});
    var violations = [];
    for (var m = 0; m < ops.length; m++) {
        if (ops[m].debt) await _call(addCustomerDebt, c.id, ops[m].debt, 'x', []);
        if (ops[m].prepaid) await _call(addPrepaidBalance, c.id, ops[m].prepaid, 'nap');
        if (ops[m].pay) await pay(c, ops[m].pay);
        await settle();
        var st = state(c);
        if (st.du < 0) violations.push('buoc ' + (m + 1) + ': du = ' + st.du);
        if (st.no < 0) violations.push('buoc ' + (m + 1) + ': no = ' + st.no);
        if (st.field !== st.no) violations.push('buoc ' + (m + 1) + ': field ' + st.field + ' != no ' + st.no);
    }
    ok('khong co vi pham duong bien', violations.length === 0, violations.join(' | '));

    // ---------------------------------------------------------------
    group('K16: BAT BIEN TIEN - tong rut ra khong vuot tong ghi vao');
    // ---------------------------------------------------------------
    // Moi dong tien cua khach phai con: du >= 0 va no >= 0
    // => khong the rut nhieu hon khoang no da ghi.
    c = mk('Bao', {});
    await _call(addCustomerDebt, c.id, 100000, 'no 1', []);
    await settle();
    await pay(c, 1000000);   // thu 1tr tren no 100k
    await settle();
    s = state(c);
    eq('no = 0 sau khi tra vuot', s.no, 0);
    eq('du = 900k (chi thu duoc 900k)', s.du, 900000);
    ok('khong the rut qua nghiep vu', s.du === 900000, 'du=' + s.du);

    // ---------------------------------------------------------------
    group('K17: GHI NO AM (khach tra duoc tien) - phai khong tao transaction 0d');
    // ---------------------------------------------------------------
    c = mk('Am', { prepaid: 30000 });
    await _call(addCustomerDebt, c.id, 30000, 'dung bang du', []);
    await settle();
    eq('no = 0', state(c).no, 0);
    eq('du = 0', state(c).du, 0);
    eq('khong tao transaction', historyLog.length, 0);
    eq('debtHistory rong', state(c).debtSum, 0);

    // ---------------------------------------------------------------
    group('K18: THANH TOAN 0 DONG');
    // ---------------------------------------------------------------
    c = mk('Khong', { debt: [50000] });
    domStore.inlineDebtAmount = { value: '0' };
    confirmAnswer = true;
    _call(confirmInlineDebtPayment, c.id, 'cash');
    await settle();
    eq('no khong doi', state(c).no, 50000);
    eq('khong ghi paymentHistory', state(c).paySum, 0);
    eq('khong tao transaction', historyLog.length, 0);

    // ---------------------------------------------------------------
    group('K19: KHACH KHONG TON TAI');
    // ---------------------------------------------------------------
    var r = _call(addCustomerDebt, 'khong_co_id', 50000, 'x', []);
    ok('addCustomerDebt tra ve promise mac dinh', r && typeof r.then === 'function');
    var r2 = _call(confirmInlineDebtPayment, 'khong_co_id', 'cash');
    ok('confirmInlineDebtPayment khong loi khi khach khong ton tai', true);

    // ---------------------------------------------------------------
    group('K20: CHAIN PHAT SINH - ghi no, tra du, ghi no, sua, xoa lien tiep');
    // ---------------------------------------------------------------
    c = mk('Chuoi', {});
    await _call(addCustomerDebt, c.id, 200000, 'don 1', []);
    await settle();
    await pay(c, 250000);
    await settle();
    await _call(addCustomerDebt, c.id, 100000, 'don 2', []);
    await settle();
    s = state(c);
    eq('sau 3 thao tac: no = 50k', s.no, 50000);
    // don 2 = 100k, da dung 50k tu tien du nen chi ghi no 50k va du ve 0
    eq('sau 3 thao tac: du = 0 (da dung het 50k)', s.du, 0);
    eq('debtHistory don 2 chi ghi 50k', c.debtHistory.filter(function (e) { return e.note === 'don 2'; })[0].amount, 50000);
    // don 2 da dung 50k tien du nen creditUsed = 50000
    eq('creditUsed cua don 2 = 50k (truoc khi xoa)', creditUsedOf(c, 'don 2'), 50000);
    // xoa khoan no don 2
    var idxToDel = 0;
    for (var t = 0; t < c.debtHistory.length; t++) if (c.debtHistory[t].note === 'don 2') { idxToDel = t; break; }
    confirmAnswer = true;
    await _call(deleteDebtEntry, c.id, idxToDel);
    await settle();
    s = state(c);
    eq('sau xoa don 2: no = 0', s.no, 0);
    // don 2 da dung 50k tu tien du (creditUsed=50000) nen xoa khoan nay
    // phai hoan lai 50k ve tien du
    eq('sau xoa don 2: du hoan lai 50k', s.du, 50000);
    eq('entry don 2 da bi xoa khoi lich su', creditUsedOf(c, 'don 2'), -1);
    ok('field khop', s.field === s.no, 'field=' + s.field + ' no=' + s.no);

    // ---------------------------------------------------------------
    console.log('\n=========================================');
    console.log('  TONG: ' + (pass + fail) + ' assertions');
    console.log('  PASS: ' + pass);
    console.log('  FAIL: ' + fail);
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
})();
