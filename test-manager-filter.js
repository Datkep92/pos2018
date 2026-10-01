// =====================================================================
// TEST BO LOC TAB QUAN LY - nap code THAT tu manager.js
// Chay: node test-manager-filter.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = path.join(__dirname, '.', 'manager.js');
var src = fs.readFileSync(SRC, 'utf8');

var pass = 0, fail = 0;
function group(n) { console.log('\n=== ' + n + ' ==='); }
function eq(l, a, e) { if (a === e) { pass++; console.log('  PASS  ' + l + '  [' + a + ']'); } else { fail++; console.log('  FAIL  ' + l + '  actual=' + a + ' expected=' + e); } }
function ok(l, c, x) { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l + (x ? '  ' + x : '')); } }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function extractFunc(name) {
    var m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
    if (!m) throw new Error('khong tim thay ' + name);
    var i = src.indexOf('{', m.index), d = 0, s = false;
    for (; i < src.length; i++) {
        if (src[i] === '{') { d++; s = true; }
        else if (src[i] === '}') { d--; if (s && d === 0) return src.slice(m.index, i + 1); }
    }
    throw new Error('khong dong ' + name);
}

// ---- moi truong ----
var els = {};
function el(id) {
    if (!els[id]) els[id] = {
        id: id, innerText: '', style: {}, value: '',
        classList: { contains: function () { return false; }, add: function () {}, remove: function () {} },
        set innerHTML(v) { this._h = v; },
        get innerHTML() { return this._h || ''; }
    };
    return els[id];
}
var toasts = [];

var sandbox = {
    console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
    Date: Date, Math: Math, JSON: JSON, parseInt: parseInt, isNaN: isNaN,
    Promise: Promise,
    showToast: function (m) { toasts.push(m); },
    formatMoney: function (n) { return String(Math.round(n || 0)); },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    document: { getElementById: function (id) { return el(id); } },
    DB: { getAll: function () { return Promise.resolve([]); } }
};
sandbox.window = sandbox;

// managerData mac dinh
sandbox.managerData = {
    currentViewMode: 'period', currentPeriod: { startDate: null, endDate: null },
    currentMonth: null, currentDay: null,
    transactions: [], costTransactions: [], adminCostTransactions: [],
    customers: [], staffs: []
};
sandbox.managerInitialized = true;

// select mac dinh = 'period'
el('managerViewModeSelect').value = 'period';
el('managerViewModeSelect').options = [{ text: '' }, { text: '' }, { text: '' }];

// nap cac ham can thiet
var NEED = [
    '_toLocalDateStr', '_itemDateStr', '_countDaysInMonth',
    '_getSalaryPeriodOfRange', 'managerComputeSalaryForRange',
    '_dateStrToMs', '_getRangeMs', '_itemTimeMs', '_buildDayIndex',
    'managerGetDateRangeByMode', 'managerFilterByDateRange',
    'managerComputeStats', '_getCurrentPeriodStart',
    'managerShiftPeriod', 'managerShiftMonth', 'managerShiftDay',
    'managerFormatDateShort', 'managerFormatMonthYear',
    'updateManagerViewMode', 'managerApplyFilter',
    'renderExpenseList', 'renderAdminExpenseList', 'renderManagerDebtList',
    'renderDrinkStats', 'managerRenderLowStockAlert', 'updateManagerUI',
    '_refreshFromCache',
    'showAllManagerDebts', 'collapseManagerDebts', 'managerInvalidateLowStock',
    // Ham moi cua bao cao mat hang ban ra
    '_drinkChannel', '_aggregateItemSales', '_drinkStatsRowHtml', '_buildDrinkStatsHtml',
    'toggleMoreDrinks'
];
// Nap ham se duoc thuc hien duoi bang mot khoi chung (xem ben duoi)
// Nap TAT CA ham vao cung mot scope de chung goi lan nhau duoc
// (vi du _getSalaryPeriodOfRange goi _countDaysInMonth)
var shared = NEED.map(extractFunc).join('\n\n');
var sharedCtx = vm.createContext(sandbox);
vm.runInContext(shared, sharedCtx);
// Bien module-level cua bao cao mat hang
vm.runInContext('var DRINK_STATS_INITIAL = 20; var _drinkStatsAll = []; var _drinkStatsExpanded = false;' +
    'var MANAGER_DEBT_LIMIT = 30; var _debtListExpanded = false; var _lastDebtBalances = [];' +
    'var lowStockDirty = true;', sharedCtx);
NEED.forEach(function (f) {
    sandbox[f] = vm.runInContext(f, sharedCtx);
});

console.log('TEST BO LOC QUAN LY: nap ' + NEED.length + ' ham that tu manager.js');

(async function run() {

    // -----------------------------------------------------------------
    group('F1: LAY NGAY THEO GIO VIET (truoc day toISOString -> gio UTC)');
    // 01/10/2026 02:00 gio Viet -> UTC la 30/09 19:00
    var d = new Date(2026, 9, 1, 2, 0, 0);
    eq('01/10 02:00 gio VN theo gio local', sandbox._toLocalDateStr(d), '2026-10-01');
    eq('truoc day toISOString cho ra', d.toISOString().slice(0, 10), '2026-09-30');
    console.log('  -> Dung toISOString se lam giao dich 2h sang sot sang 30/9.');

    // -----------------------------------------------------------------
    group('F2: LOC GIAO DICH 2H SANG PHAI VAO DUNG KY');
    // Thang 0-index: 9 = thang 10, 8 = thang 9, 7 = thang 8
    var tx = [
        { id: 'a', type: 'dinein', paymentMethod: 'cash', amount: 100000, date: new Date(2026, 9, 1, 2, 0, 0).toISOString() },
        { id: 'b', type: 'dinein', paymentMethod: 'cash', amount: 50000, date: new Date(2026, 9, 15, 10, 0, 0).toISOString() },
        { id: 'c', type: 'dinein', paymentMethod: 'cash', amount: 70000, date: new Date(2026, 8, 25, 10, 0, 0).toISOString() },  // 25/9 -> trong ky
        { id: 'd', type: 'dinein', paymentMethod: 'cash', amount: 90000, date: new Date(2026, 7, 25, 10, 0, 0).toISOString() }   // 25/8 -> truoc ky
    ];
    // ky 20/9 - 19/10. LUU Y: thang trong new Date la 0-index, 9 = thang 10.
    var r = sandbox.managerFilterByDateRange(tx, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('giao dich trong ky 20/9-19/10', r.length, 3);
    ok('vao giao dich luc 2h sang 01/10', r.some(function (x) { return x.id === 'a'; }));
    ok('vao giao dich 25/9 (trong ky)', r.some(function (x) { return x.id === 'c'; }));
    ok('KHONG vao giao dich 25/8 (truoc ky)', !r.some(function (x) { return x.id === 'd'; }));
    // Giao dich 25/8 10:00 VN -> ISO 25/8 03:00 UTC. Neu cat chuoi theo UTC
    // thi ra 25/8 (dung), nhung neu doi chieu nham thi se sai thanh 19/9.
    // Kiem tra nguoc lai: giao dich 01/10 00:30 VN -> ISO 30/9 17:30 UTC
    var txEdge = [
        { id: 'edge', type: 'dinein', paymentMethod: 'cash', amount: 1000, date: new Date(2026, 9, 1, 0, 30, 0).toISOString() }
    ];
    var rEdge = sandbox.managerFilterByDateRange(txEdge, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('00:30 ngay 01/10 van thuoc ky 20/9-19/10', rEdge.length, 1);
    var rEdge2 = sandbox.managerFilterByDateRange(txEdge, new Date(2026, 7, 20), new Date(2026, 8, 19, 23, 59, 59));
    eq('00:30 ngay 01/10 KHONG thuoc ky truoc 20/8-19/9', rEdge2.length, 0);

    // -----------------------------------------------------------------
    group('F3: DOANH THU CHI TINH KHI THU TIEN (khong tinh ghi no)');
    var tx2 = [
        { id: '1', type: 'dinein', paymentMethod: 'cash', amount: 100000, date: new Date(2026, 9, 5, 10, 0, 0).toISOString() },
        { id: '2', type: 'debt_payment', paymentMethod: 'debt', amount: 50000, date: new Date(2026, 9, 6, 10, 0, 0).toISOString() },
        { id: '3', type: 'debt_payment', paymentMethod: 'cash', amount: 30000, date: new Date(2026, 9, 7, 10, 0, 0).toISOString() },
        { id: '4', type: 'grab', paymentMethod: 'transfer', amount: 20000, date: new Date(2026, 9, 8, 10, 0, 0).toISOString() }
    ];
    var st = sandbox.managerComputeStats(tx2, [], [], [], [], new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('doanh thu (100k ban + 30k thu no + 20k grab)', st.revenue, 150000);
    ok('ghi no 50k KHONG vao doanh thu', st.revenue < 200000, 'revenue=' + st.revenue);
    eq('tien mat (100k ban + 30k thu no)', st.cash, 130000);
    eq('grab', st.grab, 20000);
    eq('chuyen khoan', st.bank, 0);
    eq('TIEN MAT + CK + GRAB == DOANH THU', st.cash + st.bank + st.grab, st.revenue);
    ok('ghi no duoc tach rieng', st.debtRecorded === 50000, 'debtRecorded=' + st.debtRecorded);
    console.log('  -> Truoc day: doanh thu 200k nhung tong 3 o chi 150k -> lech 50k.');

    // -----------------------------------------------------------------
    group('F4: TONG CONG NO TINH TU LICH SU (khong dung field totalDebt)');
    var custs = [
        {
            id: 'c1', name: 'A', totalDebt: 999999,   // field sai lam
            debtHistory: [{ amount: 100000, date: new Date(2026, 8, 25).toISOString() }],
            paymentHistory: [{ amount: 40000, date: new Date(2026, 9, 2).toISOString() }]
        },
        {
            id: 'c2', name: 'B', totalDebt: 0,
            debtHistory: [{ amount: 50000, date: new Date(2026, 9, 3).toISOString() }],
            paymentHistory: []
        }
    ];
    st = sandbox.managerComputeStats([], [], [], custs, [], new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('tong no = (100k-40k) + 50k', st.totalDebt, 110000);
    ok('khong tin field totalDebt sai (999999)', st.totalDebt !== 999999);
    eq('no phat sinh trong ky', st.debtOccur, 150000);

    // -----------------------------------------------------------------
    group('F5: LUONG THEO KY 20/N -> 19/N+1');
    // Luong thang 8 (01-31/8) -> ky 20/8 - 19/9
    var p = sandbox._getSalaryPeriodOfRange(new Date(2026, 7, 20), new Date(2026, 8, 19, 23, 59, 59));
    eq('ky 20/8-19/9 tra luong thang', p.key, '2026-08');
    // ky 20/9 - 19/10 -> thang 9
    p = sandbox._getSalaryPeriodOfRange(new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('ky 20/9-19/10 tra luong thang', p.key, '2026-09');
    // ky chay qua nam
    p = sandbox._getSalaryPeriodOfRange(new Date(2025, 11, 20), new Date(2026, 0, 19, 23, 59, 59));
    eq('ky 20/12/2025-19/1/2026 tra luong thang 12/2025', p.key, '2025-12');

    // tinh tien luong
    sandbox.managerData.currentViewMode = 'period';
    sandbox.managerData.staffs = [{ id: 's1', dailySalary: 100000 }, { id: 's2', dailySalary: 50000 }];
    var sal = sandbox.managerComputeSalaryForRange(new Date(2026, 7, 20), new Date(2026, 8, 19, 23, 59, 59));
    // thang 8 co 31 ngay: 100000*31 + 50000*31 = 3100000 + 1550000 = 4650000
    eq('luong 2 NV thang 8 (100k+50k/ngay x 31 ngay)', sal, 4650000);
    console.log('  -> VD cua ban: luong thang 8 tinh vao ky 19/8-20/9. O day dung 20/8-19/9');

    // -----------------------------------------------------------------
    group('F6: LUONG = 0 KHI XEM THEO THANG HOAC NGAY');
    sandbox.managerData.currentViewMode = 'month';
    eq('xem theo thang -> luong = 0', sandbox.managerComputeSalaryForRange(new Date(2026, 7, 1), new Date(2026, 7, 31, 23, 59, 59)), 0);
    sandbox.managerData.currentViewMode = 'day';
    eq('xem theo ngay -> luong = 0', sandbox.managerComputeSalaryForRange(new Date(2026, 7, 15), new Date(2026, 7, 15, 23, 59, 59)), 0);
    sandbox.managerData.currentViewMode = 'period';

    // -----------------------------------------------------------------
    group('F7: LOI NHUAN DAU GI AN LUONG');
    var st7 = sandbox.managerComputeStats(
        [{ id: '1', type: 'dinein', paymentMethod: 'cash', amount: 10000000, date: new Date(2026, 9, 5, 10).toISOString() }],
        [], [], [], sandbox.managerData.staffs,
        new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('doanh thu 10tr', st7.revenue, 10000000);
    ok('luong > 0 (truoc day luong = 0)', st7.totalSalary > 0, 'salary=' + st7.totalSalary);
    eq('loi nhuan = doanh thu - luong', st7.netIncome, 10000000 - st7.totalSalary);
    ok('truoc day loi nhuan bi tinh cao hon', st7.netIncome < 10000000);

    // -----------------------------------------------------------------
    group('F8: CHE DO NGAY - KHONG LECH 2 NGAY');
    sandbox.managerData.currentViewMode = 'day';
    sandbox.managerData.currentDay = new Date(2026, 9, 1, 15, 30, 0);
    var range = sandbox.managerGetDateRangeByMode();
    eq('ngay bat dau', sandbox._toLocalDateStr(range.startDate), '2026-10-01');
    eq('ngay ket thuc', sandbox._toLocalDateStr(range.endDate), '2026-10-01');
    // loc 1 giao dich luc 2h sang 01/10
    var r8 = sandbox.managerFilterByDateRange(
        [{ id: 'x', type: 'dinein', paymentMethod: 'cash', amount: 1000, date: new Date(2026, 9, 1, 2, 0, 0).toISOString() }],
        range.startDate, range.endDate);
    eq('giao dich 2h sang 01/10 van ra trong ngay 01/10', r8.length, 1);
    sandbox.managerData.currentViewMode = 'period';

    // -----------------------------------------------------------------
    group('F9: CHAN KY / THANG TUONG LAI');
    // Hien nay la 01/10/2026 -> ky hien tai bat dau 20/9/2026
    var curStart = sandbox._getCurrentPeriodStart();
    eq('ky hien tai bat dau 20/9/2026', sandbox._toLocalDateStr(curStart), '2026-09-20');

    // Dung ky hien tai, bam < -> den ky truoc
    sandbox.managerData.currentPeriod = { startDate: new Date(curStart), endDate: new Date(2026, 9, 19) };
    toasts = [];
    sandbox.managerShiftPeriod(-1);
    eq('bam < tu ky hien tai -> ky truoc 20/8', sandbox._toLocalDateStr(sandbox.managerData.currentPeriod.startDate), '2026-08-20');
    eq('khong bao loi khi lui ky', toasts.length, 0);

    // Bai > nhieu lan cho den vuot qua ky hien tai -> bi chan
    toasts = [];
    for (var z = 0; z < 6; z++) sandbox.managerShiftPeriod(1);
    ok('bam > vuot qua ky hien tai se bi chan', toasts.length > 0, 'toasts=' + toasts.length);
    ok('khong vuot qua ky hien tai', sandbox.managerData.currentPeriod.startDate <= curStart,
        'start=' + sandbox._toLocalDateStr(sandbox.managerData.currentPeriod.startDate) + ' cur=' + sandbox._toLocalDateStr(curStart));
    eq('co thong bao cho nguoi dung', toasts[0], 'Không có dữ liệu cho kỳ tương lai');

    // -----------------------------------------------------------------
    group('F10: DOI THANG KHONG NHAY NGAY 31');
    sandbox.managerData.currentViewMode = 'month';
    sandbox.managerData.currentMonth = new Date(2026, 0, 31);   // 31/01/2026
    sandbox.managerShiftMonth(-1);
    eq('31/01 lui 1 thang -> 01/12/2025', sandbox._toLocalDateStr(sandbox.managerData.currentMonth), '2025-12-01');
    console.log('  -> Truoc day: 31/01 lui 1 thang ra 03/01/2026 (sai).');
    // Bai > thang tuong lai
    sandbox.managerData.currentMonth = new Date(2026, 8, 15);   // 15/09/2026
    toasts = [];
    for (var z2 = 0; z2 < 4; z2++) sandbox.managerShiftMonth(1);
    ok('bam > vuot qua thang hien tai se bi chan', toasts.length > 0, 'toasts=' + toasts.length);
    sandbox.managerData.currentViewMode = 'period';

    // -----------------------------------------------------------------
    group('F10b: CHAN NGAY TUONG LAI');
    sandbox.managerData.currentViewMode = 'day';
    sandbox.managerData.currentDay = new Date(2026, 9, 1, 10, 0, 0);
    toasts = [];
    sandbox.managerShiftDay(1);
    ok('bam > o ngay hien nay se bi chan', toasts.length > 0, 'toasts=' + toasts.length);
    eq('van o ngay hien nay', sandbox._toLocalDateStr(sandbox.managerData.currentDay), '2026-10-01');
    sandbox.managerData.currentViewMode = 'period';

    // -----------------------------------------------------------------
    group('F11: BAN GHI THIEU date KHONG LAM HONG LOC');
    var r11 = sandbox.managerFilterByDateRange(
        [{ id: 'noDate' }, { id: 'ok', date: new Date(2026, 9, 5).toISOString() }, null, undefined],
        new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('chi lay 1 ban ghi co ngay hop le', r11.length, 1);
    ok('khong loi khi ban ghi thieu date', true);

    // -----------------------------------------------------------------
    group('F12: UU TIEN date TRUOC dateKey (du lieu co mau thuan)');
    // Trong DB ton tai 2 cach sinh dateKey: cost.js dung UTC (sai),
    // customers.js/db.js dung gio Viet (dung). Cung mot su kien ra 2 gia tri.
    var conflictTx = [
        { id: 'A', date: new Date(2026, 9, 1, 10, 0, 0).toISOString(), dateKey: '2026-10-01' },
        { id: 'B', date: new Date(2026, 9, 1, 2, 0, 0).toISOString(), dateKey: '2026-09-30' },
        { id: 'C', date: new Date(2026, 9, 1, 8, 0, 0).toISOString() }
    ];
    var r12 = sandbox.managerFilterByDateRange(conflictTx, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('ca 3 vao ky 20/9-19/10', r12.length, 3);
    ok('A (dateKey dung) vao ky', r12.some(function (x) { return x.id === 'A'; }));
    ok('B (dateKey SAI) van vao ky vi dung date that', r12.some(function (x) { return x.id === 'B'; }));
    ok('C (khong dateKey) vao ky', r12.some(function (x) { return x.id === 'C'; }));
    var r12b = sandbox.managerFilterByDateRange(conflictTx, new Date(2026, 7, 20), new Date(2026, 8, 19, 23, 59, 59));
    eq('khong giao dich nao lot sang ky truoc', r12b.length, 0);
    console.log('  -> Bo qua dateKey sai, dung thoi diem that cua su kien.');

    // -----------------------------------------------------------------
    group('F13: HIEU NANG - DUNG CHI MUC NGAY');
    var big = [];
    for (var b = 0; b < 10000; b++) {
        var t2 = new Date(2026, 0, 1).getTime() + b * 60 * 60 * 1000 * 8;
        big.push({ id: 'x' + b, type: 'dinein', paymentMethod: 'cash', amount: 50000, date: new Date(t2).toISOString() });
    }
    // KHONG dung chi muc: moi lan loc deu tao Date lai
    var tNo = Date.now();
    for (var r1 = 0; r1 < 10; r1++) {
        sandbox.managerFilterByDateRange(big, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    }
    var noIdx = Date.now() - tNo;

    // Dung chi muc: dung nhu loadAllDayIndex trong app
    sandbox._buildDayIndex(big);
    var tWith = Date.now();
    for (var r2 = 0; r2 < 10; r2++) {
        sandbox.managerFilterByDateRange(big, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    }
    var withIdx = Date.now() - tWith;

    console.log('  10.000 giao dich x 10 lan, KHONG chi muc = ' + noIdx + ' ms');
    console.log('  10.000 giao dich x 10 lan, CO    chi muc = ' + withIdx + ' ms');
    ok('dung chi muc nhanh hon', withIdx < noIdx, withIdx + ' vs ' + noIdx);
    ok('100.000 lan kiem tra duoi 200ms', withIdx < 200, withIdx + ' ms');

    // Ket qua phai giong nhau co du dung chi muc hay khong
    var r13a = sandbox.managerFilterByDateRange(big, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('loc co chi muc ra du so giao dich', r13a.length > 0, true);
    // Xoa chi muc roi loc lai -> phai ra cung ket qua
    for (var del = 0; del < big.length; del++) delete big[del].__dayMs;
    var r13b = sandbox.managerFilterByDateRange(big, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('xoa chi muc roi loc lai: ket qua KHONG doi', r13b.length, r13a.length);

    // Ban ghi moi them vao (chua co chi muc) van phai loc dung
    big.push({ id: 'new', type: 'dinein', paymentMethod: 'cash', amount: 1000, date: new Date(2026, 9, 10, 12, 0, 0).toISOString() });
    var r13c = sandbox.managerFilterByDateRange(big, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('ban ghi vua them (chua co chi muc) van duoc loc dung', r13c.length, r13a.length + 1);

    // -----------------------------------------------------------------
    group('F14: CACHE DUNG - KET QUA NHAT QUAN');
    var r14a = sandbox.managerFilterByDateRange(conflictTx, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    var r14b = sandbox.managerFilterByDateRange(conflictTx, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('loc 2 lan cho cung ket qua', r14a.length, r14b.length);
    eq('cung danh sach', r14a.map(function (x) { return x.id; }).join(','), r14b.map(function (x) { return x.id; }).join(','));
    var r14c = sandbox.managerFilterByDateRange(conflictTx, new Date(2026, 7, 20), new Date(2026, 8, 19, 23, 59, 59));
    eq('ky khac -> ket qua khac (cache khong bi dung nham)', r14c.length, 0);
    // Loc lai sau khi doi ky nhieu lan
    sandbox.managerFilterByDateRange(big, new Date(2026, 0, 1), new Date(2026, 0, 31, 23, 59, 59));
    var r14d = sandbox.managerFilterByDateRange(conflictTx, new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    eq('loc ky khac xong, quay lai ky cu van dung ket qua', r14d.length, 3);

    // -----------------------------------------------------------------
    group('F15: renderManagerDebtList NHAN danh sach san');
    var fakeCusts = [
        { id: 'c1', name: 'A', debtHistory: [{ amount: 100000 }], paymentHistory: [{ amount: 30000 }] },
        { id: 'c2', name: 'B', debtHistory: [{ amount: 50000 }], paymentHistory: [] },
        { id: 'c3', name: 'C', debtHistory: [{ amount: 20000 }], paymentHistory: [{ amount: 50000 }] }  // da tran
    ];
    // Tinh stats -> lay danh sach khach no
    var st15 = sandbox.managerComputeStats([], [], [], fakeCusts, [], new Date(2026, 8, 20), new Date(2026, 9, 19, 23, 59, 59));
    ok('stats.co co debtBalances', !!st15.debtBalances, 'debtBalances=' + JSON.stringify(st15.debtBalances));
    eq('chi 2 khach con no (C da tran het)', st15.debtBalances.length, 2);
    var byId = {};
    st15.debtBalances.forEach(function (x) { byId[x.id] = x.totalDebt; });
    eq('khach A con no 70k', byId.c1, 70000);
    eq('khach B con no 50k', byId.c2, 50000);
    eq('tong cong no khop', st15.totalDebt, 120000);

    // Gọi render với danh sách sẵn -> phải vẽ ra 2 dòng
    el('managerDebtList')._debtSig = null;
    el('managerDebtList')._h = '';
    sandbox.renderManagerDebtList(st15.debtBalances);
    var html15 = el('managerDebtList')._h || '';
    ok('ve ra 2 dong', (html15.match(/manager-item/g) || []).length === 2, 'so dong=' + (html15.match(/manager-item/g) || []).length);
    ok('co ten khach A', html15.indexOf('A') >= 0);
    ok('khong co khach C (da tran het)', html15.indexOf('>C<') < 0 && html15.indexOf('C<') < 0);

    // Gọi không truyền tham số -> tự tính lại, phải cho CÙNG kết quả
    el('managerDebtList')._debtSig = null;
    el('managerDebtList')._h = '';
    sandbox.managerData.customers = fakeCusts;
    sandbox.renderManagerDebtList(null);
    var html15b = el('managerDebtList')._h || '';
    ok('tu tinh lai cho cung so dong', (html15b.match(/manager-item/g) || []).length === 2,
        'so dong=' + (html15b.match(/manager-item/g) || []).length);

    // Danh sach rong -> hien thong bao
    el('managerDebtList')._debtSig = null;
    el('managerDebtList')._h = '';
    sandbox.renderManagerDebtList([]);
    ok('danh sach rong -> hien thong bao', (el('managerDebtList')._h || '').indexOf('Không có khách nợ') >= 0);

    // -----------------------------------------------------------------
    group('F16b: CHI VE 30 KHACH NO DAU, CO NUT XEM THEM');
    var nhieu = [];
    for (var q = 0; q < 50; q++) {
        nhieu.push({ id: 'k' + q, name: 'Khach ' + q, totalDebt: 100000 - q * 1000 });
    }
    el('managerDebtList')._debtSig = null;
    el('managerDebtList')._h = '';
    sandbox.renderManagerDebtList(nhieu);
    var h16 = el('managerDebtList')._h || '';
    eq('50 khach -> chi ve 30 dong', (h16.match(/manager-item/g) || []).length, 30);
    ok('co nut Xem them 20 khach', h16.indexOf('Xem thêm 20 khách') >= 0,
        h16.slice(Math.max(0, h16.indexOf('btnMoreDebts') - 20), h16.indexOf('btnMoreDebts') + 40));
    sandbox.showAllManagerDebts();
    h16 = el('managerDebtList')._h || '';
    eq('sau khi bam Xem them: ve het 50 dong', (h16.match(/manager-item/g) || []).length, 50);
    ok('co nut Thu gon', h16.indexOf('Thu gọn') >= 0);
    sandbox.collapseManagerDebts();
    h16 = el('managerDebtList')._h || '';
    eq('sau khi Thu gon: ve lai 30 dong', (h16.match(/manager-item/g) || []).length, 30);

    // -----------------------------------------------------------------
    group('F16c: KHONG VE LAI KHI NOI DUNG KHONG DOI');
    el('managerDebtList')._debtSig = null;
    el('managerDebtList')._h = '';
    sandbox.renderManagerDebtList(nhieu);
    ok('lan 1 co ve', (el('managerDebtList')._h || '').length > 0);
    el('managerDebtList')._h = '';
    sandbox.renderManagerDebtList(nhieu);
    eq('lan 2 cung du lieu -> khong ve lai (tiet kiem DOM)', (el('managerDebtList')._h || '').length, 0);
    nhieu[0].totalDebt = 999999;
    el('managerDebtList')._h = '';
    sandbox.renderManagerDebtList(nhieu);
    ok('du lieu doi -> ve lai', (el('managerDebtList')._h || '').length > 0);

    // -----------------------------------------------------------------
    group('F16: _refreshFromCache KHONG doc lai IndexedDB');
    // Dung cache trong RAM -> phai nhanh
    var readAll = 0;
    // Cache co san du lieu trong RAM
    sandbox.managerData._transactions = [{ id: 't1', type: 'dinein', amount: 1000, date: new Date(2026, 9, 5).toISOString() }];
    sandbox.DB = {
        getMemoryCache: function (n) { return sandbox.managerData['_' + n] || []; },
        getAll: function () { readAll++; return Promise.resolve([]); }
    };
    sandbox._refreshFromCache('transactions');
    eq('co du lieu trong RAM -> KHONG goi getAll', readAll, 0);
    eq('da lay du lieu tu RAM', sandbox.managerData.transactions.length, 1);
    ok('da dung chung muc cua giao dich', sandbox.managerData.transactions[0].__dayMs !== undefined,
        '__dayMs=' + sandbox.managerData.transactions[0].__dayMs);
    // Khong co cache -> phai doc dia
    sandbox.managerData._transactions = [];
    sandbox._refreshFromCache('transactions');
    ok('khong co cache -> co goi getAll', readAll >= 1, 'readAll=' + readAll);

    console.log('\n=========================================');
    console.log('  TONG: ' + (pass + fail) + ' assertions');
    console.log('  PASS: ' + pass);
    console.log('  FAIL: ' + fail);
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
})().catch(function (e) {
    console.error('LOI:', e.message);
    console.error(e.stack);
    process.exit(1);
});
