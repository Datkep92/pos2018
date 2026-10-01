// =====================================================================
// HARNESS 2: nap code THAT tu pos2018/history.js de kiem tra hoan tac
// Kiem tra 2 nhanh refund: ghi no (paymentMethod='debt') va thanh toan no.
// Chay: node test-refund-congnhe.js
// =====================================================================
var fs = require('fs');
var path = require('path');

var SRC = path.join("C:\\\\Users\\\\cana2\\\\OneDrive\\\\Documents\\\\Default Project\\\\pos2018", '.', 'js.min', 'history.min.js');
var src = fs.readFileSync(SRC, 'utf8');

function extractFunc(name) {
    var re = new RegExp('function\\s+' + name + '\\s*\\(');
    var m = re.exec(src);
    if (!m) throw new Error('Khong tim thay function: ' + name);
    var i = src.indexOf('{', m.index);
    var depth = 0, started = false;
    for (; i < src.length; i++) {
        if (src[i] === '{') { depth++; started = true; }
        else if (src[i] === '}') { depth--; if (started && depth === 0) return src.slice(m.index, i + 1); }
    }
    throw new Error('Khong dong duoc: ' + name);
}

// ---------------- moi truong ----------------
var customers = [];
var dbLog = [];
var pendingReason = null;

global.customers = customers;
global.formatMoney = function (n) { n = Math.round(n || 0); return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ'; };
global.showToast = function () {};
global.hideToast = function () {};
global.showRefundReasonModal = function (cb) { pendingReason = cb; };
global.restoreIngredients = function () { return Promise.resolve(); };
global.restoreTable = function () { return Promise.resolve(); };
global.notifyTelegramWarning = function () {};
global.isDayClosed = function () { return false; };
global.requirePassword = function (label, cb) { cb(); };
global.isTransactionLocked = function () { return false; };
global.currentTab = 'history';
global.currentHistoryDate = '2026-01-01';
global.currentReportDate = '2026-01-01';
global.renderHistoryByDate = function () {};
global.renderReport = function () {};
global.document = { getElementById: function () { return null; } };
global.DB = {
    update: function (col, id, data) {
        dbLog.push({ col: col, id: id, data: JSON.parse(JSON.stringify(data)) });
        var c = customers.filter(function (x) { return x.id === id; })[0];
        if (c) for (var k in data) c[k] = data[k];
        return Promise.resolve();
    },
    getAll: function (col) { return col === 'customers' ? Promise.resolve(customers) : Promise.resolve([]); }
};
// nap _calcOutstandingDebt tu customers.js de ham refund goi duoc
var csrc = fs.readFileSync(path.join("C:\\\\Users\\\\cana2\\\\OneDrive\\\\Documents\\\\Default Project\\\\pos2018", '.', 'js.min', 'customers.min.js'), 'utf8');
var cfn = new RegExp('function\\s+_calcOutstandingDebt\\s*\\(');
var cm = cfn.exec(csrc);
(function () {
    var i = csrc.indexOf('{', cm.index), depth = 0, started = false;
    for (; i < csrc.length; i++) {
        if (csrc[i] === '{') { depth++; started = true; }
        else if (csrc[i] === '}') { depth--; if (started && depth === 0) { new Function(csrc.slice(cm.index, i + 1) + '; global._calcOutstandingDebt = _calcOutstandingDebt;')(); break; } }
    }
})();

// nap ham refund
var f1 = extractFunc('_isNearTransTime');
var f2 = extractFunc('restoreCustomerCredit');
var f3 = extractFunc('proceedRefund');
new Function(f1 + '\n' + f2 + '\n' + f3 + '\nglobal._isNearTransTime=_isNearTransTime; global.restoreCustomerCredit=restoreCustomerCredit; global.proceedRefund=proceedRefund;')();

var pass = 0, fail = 0;
function group(n) { console.log('\n=== ' + n + ' ==='); }
function eq(label, actual, expected) {
    var ok = actual === expected;
    if (ok) { pass++; console.log('  PASS  ' + label + ' = ' + actual); }
    else { fail++; console.log('  FAIL  ' + label + '  actual=' + actual + ' expected=' + expected); }
}
function ok(label, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  ' + extra : '')); }
}
function settle() { return new Promise(function (r) { setTimeout(r, 30); }); }
function no(c) { return _calcOutstandingDebt(c); }

function mk(name, opts) {
    opts = opts || {};
    var c = {
        id: opts.id || 'cus1', name: name, phone: '', totalDebt: 0,
        creditBalance: 0, prepaidBalance: 0,
        debtHistory: [], paymentHistory: [], creditHistory: []
    };
    (opts.debt || []).forEach(function (a) { c.debtHistory.push({ id: Math.random(), date: new Date().toISOString(), amount: a, status: 'unpaid', creditUsed: opts.creditUsed || 0 }); });
    (opts.pay || []).forEach(function (a) { c.paymentHistory.push({ id: Math.random(), date: new Date().toISOString(), amount: a }); });
    if (opts.prepaid) { c.prepaidBalance = opts.prepaid; c.creditBalance = opts.prepaid; }
    c.totalDebt = no(c);
    customers = [c]; global.customers = customers; dbLog = [];
    return c;
}

console.log('HARNESS 2: nap proceedRefund + restoreCustomerCredit tu ' + path.basename(SRC));

// chay refund va tra ve promise khi hoan tat
function runRefund(trans) {
    var done = false;
    // buoc 1: goi proceedRefund -> no se goi showRefundReasonModal
    proceedRefund(trans, false);
    // buoc 2: cung cap ly do
    if (pendingReason) { var cb = pendingReason; pendingReason = null; cb('Ly do test'); }
    return settle();
}

(async function run() {

    // ---------------------------------------------------------------
    group('R1: HOAN TAC THANH TOAN NO - tra 150k tren no 100k');
    // ---------------------------------------------------------------
    var c = mk('R1', { debt: [100000] });
    // trang thai sau khi thanh toan: paymentHistory 100k, du 50k
    c.paymentHistory.push({ id: 1, date: new Date().toISOString(), amount: 100000 });
    c.prepaidBalance = 50000; c.creditBalance = 50000;
    c.creditHistory.push({ id: 1, date: new Date().toISOString(), amount: 50000, note: 'du' });
    c.totalDebt = no(c);
    eq('truoc refund: no = 0', no(c), 0);
    eq('truoc refund: du = 50k', c.prepaidBalance, 50000);

    var trans = {
        id: 'tx1', type: 'debt_payment', paymentMethod: 'cash',
        amount: 150000,          // tien thuc nhan
        debtSettled: 100000,     // no thuc su bi xoa
        creditUsed: 0, prepaidChange: 50000,
        customer: { id: 'cus1', name: 'R1' },
        createdAt: new Date().toISOString(), items: []
    };
    await runRefund(trans);
    eq('sau refund: no khoi phuc 100k', no(c), 100000);
    eq('sau refund: du ve 0', c.prepaidBalance, 0);
    eq('sau refund: field totalDebt khop', c.totalDebt, 100000);
    ok('transaction da danh dau refunded', trans.refunded === true);

    // ---------------------------------------------------------------
    group('R2: HOAN TAC THANH TOAN NO - dung tiền gửi trước');
    // ---------------------------------------------------------------
    // Khách nợ 100k, có 50k dư, trả 100k (dùng 50k dư + 50k tiền mặt)
    c = mk('R2', { debt: [100000] });
    c.paymentHistory.push({ id: 1, date: new Date().toISOString(), amount: 100000 });
    c.prepaidBalance = 0; c.creditBalance = 0;
    c.creditHistory.push({ id: 1, date: new Date().toISOString(), amount: -50000, note: 'dung tien du' });
    c.totalDebt = no(c);
    eq('truoc refund: no = 0', no(c), 0);
    eq('truoc refund: du = 0', c.prepaidBalance, 0);

    trans = {
        id: 'tx2', type: 'debt_payment', paymentMethod: 'cash',
        amount: 50000, debtSettled: 100000,
        creditUsed: 50000, prepaidChange: 0,
        customer: { id: 'cus1', name: 'R2' },
        createdAt: new Date().toISOString(), items: []
    };
    await runRefund(trans);
    eq('sau refund: no khoi phuc 100k', no(c), 100000);
    eq('sau refund: du hoan lai 50k', c.prepaidBalance, 50000);
    eq('sau refund: field khop', c.totalDebt, 100000);

    // ---------------------------------------------------------------
    group('R3: HOAN TAC GHI NO - xoa khoan nợ, KHÔNG hoàn tiền dư');
    // ---------------------------------------------------------------
    c = mk('R3', { debt: [80000, 60000] });  // 2 khoan no, khong dung tien du
    eq('truoc refund: no = 140k', no(c), 140000);

    trans = {
        id: 'tx3', type: 'debt_payment', paymentMethod: 'debt',
        amount: 60000, items: [], customer: { id: 'cus1', name: 'R3' },
        createdAt: new Date().toISOString()
    };
    await runRefund(trans);
    eq('sau refund: no con 80k', no(c), 80000);
    eq('sau refund: khong co du', c.prepaidBalance, 0);
    eq('sau refund: field khop', c.totalDebt, 80000);

    // ---------------------------------------------------------------
    group('R4: HOAN TAC GHI NO - PHẢI hoàn tiền dư đã tự trừ');
    // ---------------------------------------------------------------
    // Khách gửi trước 60k, mua 100k -> nợ ghi 40k, creditUsed = 60k
    c = mk('R4', {});
    c.debtHistory.push({ id: 1, date: new Date().toISOString(), amount: 40000, status: 'unpaid', creditUsed: 60000 });
    c.prepaidBalance = 0; c.creditBalance = 0;
    c.creditHistory.push({ id: 1, date: new Date().toISOString(), amount: -60000, note: 'tu tru khi ghi no' });
    c.totalDebt = no(c);
    eq('truoc refund: no = 40k', no(c), 40000);
    eq('truoc refund: du = 0', c.prepaidBalance, 0);

    trans = {
        id: 'tx4', type: 'debt_payment', paymentMethod: 'debt',
        amount: 40000, items: [], customer: { id: 'cus1', name: 'R4' },
        createdAt: new Date().toISOString()
    };
    await runRefund(trans);
    eq('sau refund: no = 0', no(c), 0);
    eq('sau refund: DU HOAN LAI 60k (quan trong)', c.prepaidBalance, 60000);
    eq('sau refund: creditBalance dong bo', c.creditBalance, 60000);
    eq('sau refund: field khop', c.totalDebt, 0);

    // ---------------------------------------------------------------
    group('R5: HOAN TAC GHI NO - nhieu khoan cung so tien, khop theo thoi gian');
    // ---------------------------------------------------------------
    c = mk('R5', {});
    var old = new Date(Date.now() - 600000).toISOString();   // 10 phút truoc
    var recent = new Date().toISOString();
    c.debtHistory.push({ id: 1, date: old, amount: 40000, status: 'unpaid', creditUsed: 0 });
    c.debtHistory.push({ id: 2, date: recent, amount: 40000, status: 'unpaid', creditUsed: 0 });
    c.totalDebt = no(c);
    eq('truoc: 2 khoan 40k', no(c), 80000);
    trans = {
        id: 'tx5', type: 'debt_payment', paymentMethod: 'debt',
        amount: 40000, items: [], customer: { id: 'cus1', name: 'R5' },
        createdAt: new Date().toISOString()
    };
    await runRefund(trans);
    eq('sau refund: chi xoa khoan MOI nhat', no(c), 40000);
    eq('sau refund: con 1 khoan 40k', c.debtHistory.length, 1);
    ok('con lai khoan CU (khong phai khoan moi)', c.debtHistory[0].id === 1, 'id con lai=' + c.debtHistory[0].id);

    // ---------------------------------------------------------------
    group('R6: KHACH KHONG TON TAI - refund khong duoc treo');
    // ---------------------------------------------------------------
    customers = []; global.customers = [];
    trans = {
        id: 'tx6', type: 'debt_payment', paymentMethod: 'cash',
        amount: 100000, debtSettled: 100000,
        customer: { id: 'khong_co', name: 'X' },
        createdAt: new Date().toISOString(), items: []
    };
    var hung = false;
    try {
        await Promise.race([
            runRefund(trans),
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error('timeout')); }, 1500); })
        ]);
    } catch (e) { hung = true; }
    ok('refund khach khong ton tai khong treo', !hung, hung ? 'TIMEOUT' : '');

    // ---------------------------------------------------------------
    group('R7: _isNearTransTime');
    // ---------------------------------------------------------------
    var now = Date.now();
    ok('cung thoi gian -> true', _isNearTransTime(new Date(now).toISOString(), now) === true);
    ok('lech 1 phut -> true', _isNearTransTime(new Date(now - 60000).toISOString(), now) === true);
    ok('lech 5 phut -> false', _isNearTransTime(new Date(now - 300000).toISOString(), now) === false);
    // Mốc thời gian hỏng thì KHÔNG được khớp. Trả true khiến mọi entry cùng số
    // tiền đều khớp -> xoá nhầm entry khác. Đây là hành vi cũ, đã sửa.
    ok('khong co txTime -> false', _isNearTransTime(new Date(now).toISOString(), null) === false);
    ok('date hong -> false', _isNearTransTime('khong_hop_le', now) === false);

    // ---------------------------------------------------------------
    console.log('\n=========================================');
    console.log('  TONG: ' + (pass + fail) + ' assertions');
    console.log('  PASS: ' + pass);
    console.log('  FAIL: ' + fail);
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
})();
