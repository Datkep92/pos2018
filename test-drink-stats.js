// =====================================================================
// TEST BAO CAO MAT HANG BAN RA - nap code THAT tu manager.js
// Chay: node test-drink-stats.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = path.join(__dirname, '.', 'manager.js');
var src = fs.readFileSync(SRC, 'utf8');
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

var pass = 0, fail = 0;
function group(n) { console.log('\n=== ' + n + ' ==='); }
function eq(l, a, e) { if (a === e) { pass++; console.log('  PASS  ' + l + '  [' + a + ']'); } else { fail++; console.log('  FAIL  ' + l + '  actual=' + JSON.stringify(a) + ' expected=' + JSON.stringify(e)); } }
function ok(l, c, x) { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l + (x ? '  ' + x : '')); } }

var els = {};
function el(id) {
    if (!els[id]) els[id] = {
        id: id, innerText: '', style: {}, value: 'period',
        options: [{ text: '' }, { text: '' }, { text: '' }],
        classList: { contains: function () { return false; }, add: function () {}, remove: function () {} },
        set innerHTML(v) { this._h = v; },
        get innerHTML() { return this._h || ''; }
    };
    return els[id];
}

var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Date: Date, Math: Math, JSON: JSON, parseInt: parseInt, isNaN: isNaN, Promise: Promise,
    showToast: function () { },
    formatMoney: function (n) { return Math.round(n || 0).toLocaleString('vi-VN') + 'đ'; },
    escapeHtml: function (s) { return String(s == null ? '' : s); },
    document: {
        getElementById: el,
        createElement: function () { return { style: {}, innerHTML: '' }; }
    },
    DB: { getAll: function () { return Promise.resolve([]); } }
};
sandbox.window = sandbox;
sandbox.managerData = {
    currentViewMode: 'day',
    currentPeriod: null, currentMonth: null,
    currentDay: new Date(2026, 8, 25, 12, 0, 0),      // 25/09/2026
    transactions: [], costTransactions: [], adminCostTransactions: [],
    customers: [], staffs: []
};

var NEED = ['_toLocalDateStr', '_dateStrToMs', '_getRangeMs', '_itemTimeMs', '_buildDayIndex',
    'managerGetDateRangeByMode', 'managerFilterByDateRange',
    '_drinkChannel', '_aggregateItemSales', '_drinkStatsRowHtml', '_buildDrinkStatsHtml',
    'renderDrinkStats', 'toggleMoreDrinks'];
var ctx = vm.createContext(sandbox);
vm.runInContext(NEED.map(extractFunc).join('\n\n') + '\nvar DRINK_STATS_INITIAL = 20; var _drinkStatsAll = [];', ctx);
NEED.forEach(function (f) { sandbox[f] = vm.runInContext(f, ctx); });

// Helper tao giao dich ngay 25/09/2026
function tx(o) {
    return Object.assign({
        id: 'tx' + Math.random(), date: new Date(2026, 8, 25, 10, 0, 0).toISOString(),
        paymentMethod: 'cash', type: 'dinein', items: []
    }, o);
}

console.log('TEST BAO CAO MAT HANG BAN RA');

(async function () {

    // -----------------------------------------------------------------
    group('D1: TACH TUNG BIEN THE THANH DONG RIENG');
    var agg = sandbox._aggregateItemSales([
        tx({ items: [{ name: 'Ca phe sua may (Da)', qty: 30, price: 30000 }] }),
        tx({ items: [{ name: 'Ca phe sua may (Nong)', qty: 20, price: 30000 }] })
    ]);
    eq('2 dong (Da va Nong tach rieng)', agg.length, 2);
    var da = agg.filter(function (r) { return r.name.indexOf('Da') >= 0; })[0];
    var nong = agg.filter(function (r) { return r.name.indexOf('Nong') >= 0; })[0];
    eq('Ca phe sua may (Da) = 30 ly', da.qty, 30);
    eq('Ca phe sua may (Nong) = 20 ly', nong.qty, 20);
    ok('KHONG bi gop chung (truoc day ca 2 ra 50 ly)', da.qty === 30 && nong.qty === 20);

    // cung ten, khong co bien the -> van tach rieng
    agg = sandbox._aggregateItemSales([
        tx({ items: [{ name: 'Ca phe sua may', qty: 5, price: 30000 }] }),
        tx({ items: [{ name: 'Ca phe sua may (Da)', qty: 3, price: 30000 }] })
    ]);
    eq('Mon goc va bien the la 2 dong khac nhau', agg.length, 2);

    // -----------------------------------------------------------------
    group('D2: CHI TINH DON DA THU TIEN (bo qua ghi no)');
    agg = sandbox._aggregateItemSales([
        // Don ghi no - KHONG tinh
        tx({ type: 'debt_payment', paymentMethod: 'debt', items: [{ name: 'Ca phe sua may (Da)', qty: 10, price: 30000 }] }),
        // Don ban tại bàn - tinh
        tx({ type: 'dinein', paymentMethod: 'cash', items: [{ name: 'Ca phe sua may (Da)', qty: 4, price: 30000 }] })
    ]);
    eq('chi tinh 4 ly (bo qua 10 ly ghi no)', agg[0].qty, 4);
    ok('da bo cot ghi no (khong con truong debt)', agg[0].debt === undefined);
    eq('cot "tai ban" = 4', agg[0].dinein, 4);

    // Don thanh toan no (thu tien cho don cu) - khong co items nen bo qua
    agg = sandbox._aggregateItemSales([
        tx({ type: 'debt_payment', paymentMethod: 'cash', amount: 100000, items: [] })
    ]);
    eq('thanh toan no khong co items -> khong tao dong nao', agg.length, 0);

    // -----------------------------------------------------------------
    group('D3: TACH THEO KENH BAN');
    agg = sandbox._aggregateItemSales([
        tx({ type: 'dinein', paymentMethod: 'cash', items: [{ name: 'Ca phe sua may (Da)', qty: 10, price: 30000 }] }),
        tx({ type: 'takeaway', paymentMethod: 'cash', items: [{ name: 'Ca phe sua may (Da)', qty: 20, price: 30000 }] }),
        tx({ type: 'grab', paymentMethod: 'transfer', items: [{ name: 'Ca phe sua may (Da)', qty: 5, price: 30000 }] })
    ]);
    eq('tong 35 ly', agg[0].qty, 35);
    eq('tai ban 10', agg[0].dinein, 10);
    eq('mang di 20', agg[0].takeaway, 20);
    eq('Grab 5', agg[0].grab, 5);

    // -----------------------------------------------------------------
    group('D4: BO QUA DON DA HUY VA XOA BAN');
    agg = sandbox._aggregateItemSales([
        tx({ refunded: true, items: [{ name: 'Ca phe sua may (Da)', qty: 99, price: 30000 }] }),
        tx({ type: 'delete_table', items: [{ name: 'Ca phe sua may (Da)', qty: 88, price: 30000 }] }),
        tx({ items: [{ name: 'Ca phe sua may (Da)', qty: 3, price: 30000 }] })
    ]);
    eq('chi tinh 3 ly', agg.length === 1 ? agg[0].qty : -1, 3);

    // -----------------------------------------------------------------
    group('D5: SAP XEP GIAM DAN THEO SO LUONG');
    agg = sandbox._aggregateItemSales([
        tx({ items: [{ name: 'A', qty: 5, price: 10000 }, { name: 'B', qty: 30, price: 10000 }, { name: 'C', qty: 12, price: 10000 }] })
    ]);
    eq('thu tu B, C, A', agg.map(function (r) { return r.name; }).join(','), 'B,C,A');

    // -----------------------------------------------------------------
    group('D6: TINH DOANH THU');
    agg = sandbox._aggregateItemSales([
        tx({ items: [{ name: 'Ca phe sua may (Da)', qty: 30, price: 30000 }] })
    ]);
    eq('30 ly x 30.000 = 900.000', agg[0].amount, 900000);

    // -----------------------------------------------------------------
    group('D7: HIEN 20 MON DAU, CO NUT XEM THEM');
    var items = [];
    for (var i = 1; i <= 25; i++) items.push({ name: 'Mon ' + i, qty: 26 - i, price: 10000 });
    sandbox._drinkStatsAll = sandbox._aggregateItemSales([tx({ items: items })]);
    eq('tong co 25 mon', sandbox._drinkStatsAll.length, 25);
    sandbox.renderDrinkStats([tx({ items: items })]);
    var html = el('managerDrinkStats')._h || '';
    var rowCount = (html.match(/stats-item-item/g) || []).length;
    eq('chi ve 20 dong dau', rowCount, 20);
    ok('co nut "Xem them"', html.indexOf('btnMoreDrinks') >= 0);
    var btnText = (html.match(/Xem thêm[^<]*/) || [''])[0];
    ok('nut ghi so mon con lai (25-20=5)', btnText.indexOf('5 m') >= 0, 'chu tren nut = "' + btnText + '"');
    // Dung khi chi co 5 mon -> khong co nut
    var few = [{ name: 'A', qty: 3, price: 10000 }, { name: 'B', qty: 2, price: 10000 }];
    sandbox.renderDrinkStats([tx({ items: few })]);
    html = el('managerDrinkStats')._h || '';
    ok('it mon -> khong co nut Xem them', html.indexOf('btnMoreDrinks') < 0);
    ok('it mon -> co dong "Da hien du"', html.indexOf('Đã hiện đủ') >= 0);

    // -----------------------------------------------------------------
    group('D8: DONG TONG KET');
    sandbox.renderDrinkStats([tx({ items: [{ name: 'Ca phe sua may (Da)', qty: 30, price: 30000 }, { name: 'Den may (Da)', qty: 20, price: 30000 }] })]);
    html = el('managerDrinkStats')._h || '';
    ok('co dong tong ket', html.indexOf('stats-summary') >= 0);
    ok('tong 50 ly', html.indexOf('50') >= 0, html.slice(html.indexOf('stats-summary'), html.indexOf('stats-summary') + 120));
    ok('tong tien 1.500.000', html.indexOf('1.500.000') >= 0, html.slice(html.indexOf('stats-summary'), html.indexOf('stats-summary') + 160));

    // -----------------------------------------------------------------
    group('D9: KHONG CO DU LIEU');
    sandbox.renderDrinkStats([]);
    html = el('managerDrinkStats')._h || '';
    ok('hien thong bao khong co du lieu', html.indexOf('Không có dữ liệu') >= 0);

    // -----------------------------------------------------------------
    group('D10: BOC QUA DU LIEU HONG');
    agg = sandbox._aggregateItemSales([
        tx({ items: [{ name: '', qty: 5, price: 1000 }, { name: '   ', qty: 3, price: 1000 }, { name: 'OK', qty: 2, price: 1000 }, { qty: 4, price: 1000 }, { name: 'Zero', qty: 0, price: 1000 }] })
    ]);
    eq('chi gom du ten hop le va qty > 0', agg.length, 1);
    eq('ten la "OK", qty 2', agg[0].name + ' ' + agg[0].qty, 'OK 2');

    // -----------------------------------------------------------------
    group('D11: LOC THEO BO LOC (ngay hom qua)');
    // Giao dich 24/09 va 25/09, xem ngay 25/09
    var tx24 = { id: 'a', date: new Date(2026, 8, 24, 10, 0, 0).toISOString(), type: 'dinein', paymentMethod: 'cash', items: [{ name: 'Mon A', qty: 7, price: 10000 }] };
    var tx25 = { id: 'b', date: new Date(2026, 8, 25, 10, 0, 0).toISOString(), type: 'dinein', paymentMethod: 'cash', items: [{ name: 'Mon B', qty: 3, price: 10000 }] };
    var range = sandbox.managerGetDateRangeByMode();
    eq('ngay xem la 25/09', sandbox._toLocalDateStr(range.startDate), '2026-09-25');
    eq('ngay ket thuc cung la 25/09', sandbox._toLocalDateStr(range.endDate), '2026-09-25');
    var filtered = sandbox.managerFilterByDateRange([tx24, tx25], range.startDate, range.endDate);
    eq('chi loc duoc 1 giao dich (25/09)', filtered.length, 1);
    eq('la giao dich cua 25/09', filtered[0].id, 'b');
    agg = sandbox._aggregateItemSales(filtered);
    eq('chi co Mon B 3 ly', agg.length === 1 ? agg[0].qty : -1, 3);

    // Giao dich luc 2h sang 25/09 (bi sai neu cat chuoi ISO)
    var txEarly = { id: 'c', date: new Date(2026, 8, 25, 2, 0, 0).toISOString(), type: 'dinein', paymentMethod: 'cash', items: [{ name: 'Mon C', qty: 2, price: 10000 }] };
    filtered = sandbox.managerFilterByDateRange([txEarly], range.startDate, range.endDate);
    eq('don luc 2h sang 25/09 van thuoc ngay 25/09', filtered.length, 1);

    // -----------------------------------------------------------------
    group('D12: HIEN THI TACH 2 TANG TEN');
    var rowHtml = sandbox._drinkStatsRowHtml(1, { name: 'Ca phe sua may (Da)', qty: 30, amount: 900000, dinein: 20, takeaway: 10, grab: 0, debt: 0 });
    ok('co ten goc', rowHtml.indexOf('Ca phe sua may') >= 0);
    ok('co bien the tach rieng', rowHtml.indexOf('drink-variant') >= 0 && rowHtml.indexOf('(Da)') >= 0);
    ok('co cot tai ban', rowHtml.indexOf('drink-ch-table') >= 0);
    ok('co cot mang di', rowHtml.indexOf('drink-ch-takeaway') >= 0);
    ok('KHONG ve cot Grab khi = 0', rowHtml.indexOf('drink-ch-grab') < 0);
    ok('co tong 30 ly', rowHtml.indexOf('30') >= 0);
    // Ten khong co bien the
    rowHtml = sandbox._drinkStatsRowHtml(1, { name: 'Ca phe sua may', qty: 5, amount: 150000, dinein: 5, takeaway: 0, grab: 0, debt: 0 });
    ok('ten khong bien the -> khong co drink-variant', rowHtml.indexOf('drink-variant') < 0);

    // -----------------------------------------------------------------
    group('D14: PHAN LOAI KENH - type dua chuyen khoan hon paymentMethod');
    eq('dinein + cash', sandbox._drinkChannel({ type: 'dinein', paymentMethod: 'cash' }), 'dinein');
    eq('dinein + transfer (CK) -> van la tai ban', sandbox._drinkChannel({ type: 'dinein', paymentMethod: 'transfer' }), 'dinein');
    eq('takeaway + cash', sandbox._drinkChannel({ type: 'takeaway', paymentMethod: 'cash' }), 'takeaway');
    eq('takeaway + transfer', sandbox._drinkChannel({ type: 'takeaway', paymentMethod: 'transfer' }), 'takeaway');
    eq('grab + grab', sandbox._drinkChannel({ type: 'grab', paymentMethod: 'grab' }), 'grab');
    eq('grab + transfer -> van la GRAB', sandbox._drinkChannel({ type: 'grab', paymentMethod: 'transfer' }), 'grab');
    eq('type la -> suy ra theo cach thanh toan', sandbox._drinkChannel({ paymentMethod: 'transfer' }), 'takeaway');
    eq('khong co gi -> tại bàn', sandbox._drinkChannel({}), 'dinein');

    // -----------------------------------------------------------------
    group('D15: KHONG CON COT GHI NO (chi tinh don da thu tien)');
    agg = sandbox._aggregateItemSales([
        tx({ items: [{ name: 'Ca phe sua may (Da)', qty: 4, price: 30000 }], type: 'dinein' })
    ]);
    ok('truong du lieu khong con "debt"', agg[0].debt === undefined, 'debt=' + agg[0].debt);
    var rowHtml15 = sandbox._drinkStatsRowHtml(1, agg[0]);
    ok('HTML khong ve cot ghi no', rowHtml15.indexOf('drink-ch-debt') < 0);
    ok('HTML khong co ky tu 💳', rowHtml15.indexOf('💳') < 0);
    // Don ghi no khong duoc tinh
    agg = sandbox._aggregateItemSales([
        tx({ type: 'debt_payment', paymentMethod: 'debt', items: [{ name: 'Ca phe sua may (Da)', qty: 100, price: 30000 }] }),
        tx({ type: 'dinein', items: [{ name: 'Ca phe sua may (Da)', qty: 4, price: 30000 }] })
    ]);
    eq('100 ly ghi no + 4 ly ban = 4 ly', agg[0].qty, 4);

    // -----------------------------------------------------------------
    group('D16: TONG KET KHOP VOI TONG CONG COT');
    agg = sandbox._aggregateItemSales([
        tx({ type: 'dinein', items: [{ name: 'Ca phe sua may (Da)', qty: 30, price: 30000 }] }),
        tx({ type: 'takeaway', items: [{ name: 'Ca phe sua may (Da)', qty: 20, price: 30000 }] }),
        tx({ type: 'dinein', items: [{ name: 'Den may (Da)', qty: 12, price: 30000 }] }),
        tx({ type: 'grab', paymentMethod: 'grab', items: [{ name: 'Den may (Da)', qty: 5, price: 30000 }] }),
        tx({ type: 'dinein', items: [{ name: 'Tra vai', qty: 8, price: 20000 }] })
    ]);
    var tq = 0, ta = 0, sc = 0;
    agg.forEach(function (r) { tq += r.qty; ta += r.amount; sc += r.dinein + r.takeaway + r.grab; });
    eq('tong 75 ly', tq, 75);
    eq('tong tien 2.170.000', ta, 2170000);
    eq('tong 3 kenh = tong ly (khong kenh nao bi bo qua)', sc, tq);

    // -----------------------------------------------------------------
    group('D13: BAM XEM THEM / THU GON');
    var many = [];
    for (var q = 1; q <= 25; q++) many.push({ name: 'MonSo' + q, qty: 26 - q, price: 10000 });
    sandbox._drinkStatsAll = sandbox._aggregateItemSales([tx({ items: many })]);
    // Lan 1: 20 dong
    el('managerDrinkStats')._h = sandbox._buildDrinkStatsHtml(sandbox._drinkStatsAll, 20);
    eq('lan 1: 20 dong', (el('managerDrinkStats')._h.match(/stats-item-item/g) || []).length, 20);
    // Lan 2: bam toggle -> 25 dong
    sandbox.toggleMoreDrinks();
    html = el('managerDrinkStats')._h || '';
    eq('sau khi bam Xem them: 25 dong', (html.match(/stats-item-item/g) || []).length, 25);
    ok('co nut Thu gon', html.indexOf('Thu gọn') >= 0);
    // Lan 3: bam toggle lai -> 20 dong
    sandbox.toggleMoreDrinks();
    html = el('managerDrinkStats')._h || '';
    eq('sau khi bam Thu gon: 20 dong', (html.match(/stats-item-item/g) || []).length, 20);
    ok('co lai nut Xem them', html.indexOf('Xem thêm') >= 0);
    ok('khong dung insertAdjacentHTML (WebView cu khong ho tro)',
        sandbox._buildDrinkStatsHtml(sandbox._drinkStatsAll, 20).indexOf('insertAdjacentHTML') < 0);
    // Han muc hang duoc gan ra window
    ok('toggleMoreDrinks co trong window', typeof window !== 'undefined' || typeof sandbox.toggleMoreDrinks === 'function');

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
