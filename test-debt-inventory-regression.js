// Test hồi quy luồng D: công nợ khách hàng và kiểm chứng tĩnh nhập kho/đổi đơn vị.
// Chạy: node.real --jitless --no-expose-wasm test-debt-inventory-regression.js
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var customersSrc = fs.readFileSync(path.join(__dirname, 'customers.js'), 'utf8');
var invSrc = fs.readFileSync(path.join(__dirname, 'inventory-manager.js'), 'utf8');

var listeners = {};
var domReady = [];
var totalDebtEl = { innerText: '' };
var sandbox = {
    console: console,
    formatMoney: function(v) { return String(v); },
    customers: [],
    document: {
        getElementById: function(id) {
            if (id === 'totalDebtAmount') return totalDebtEl;
            return null;
        },
        createDocumentFragment: function() { return { appendChild: function() {} }; },
        createElement: function() { return { appendChild: function() {} }; }
    },
    window: {
        costTransactions: [],
        addEventListener: function(evt, cb) {
            if (evt === 'DOMContentLoaded') domReady.push(cb);
        },
        DB: {
            on: function(evt, cb) {
                if (!listeners[evt]) listeners[evt] = [];
                listeners[evt].push(cb);
                return function() {};
            }
        }
    }
};

vm.createContext(sandbox);
vm.runInContext(customersSrc, sandbox, { filename: 'customers.js' });

var checks = 0;
function eq(actual, expected, msg) {
    checks++;
    assert.strictEqual(actual, expected, msg);
}
function ok(value, msg) {
    checks++;
    assert.ok(value, msg);
}
function fire(evt) {
    var parts = evt.split(':');
    var cbs = (listeners[evt] || []).concat(listeners[parts[0] + ':*'] || []);
    ok(cbs.length > 0, 'phải có listener cho ' + evt);
    for (var i = 0; i < cbs.length; i++) {
        cbs[i]({ collection: parts[0], type: parts[1], data: null });
    }
}
function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}

// --- B: khoản hoàn tiền không được tính vào nợ ---
var cRefund = {
    debtHistory: [
        { amount: 100, dateKey: todayKey() },
        { amount: 50, refunded: true, dateKey: todayKey() },
        { amount: 7, status: 'refunded', dateKey: todayKey() },
        { amount: 3, refunded: 1, dateKey: todayKey() }
    ],
    paymentHistory: [
        { amount: 20, dateKey: todayKey() },
        { amount: 10, refunded: true, dateKey: todayKey() }
    ]
};
eq(sandbox._calcOutstandingDebt(cRefund), 80, 'nợ = 100 - 20, bỏ mọi entry đã hoàn tiền');
ok(sandbox._isRefundedCustomerEntry(null) === true, 'entry rỗng được coi là đã hoàn tiền');
ok(sandbox._isRefundedCustomerEntry({ amount: 9 }) === false, 'entry thường không bị bỏ');

// --- A: cache tự vô hiệu khi nguồn đổi, không chờ TTL ---
function markFresh() {
    sandbox._customerCalcCache.debtSummary = { old: { outstandingDebt: 1 } };
    sandbox._customerCalcCache.todayActivity = { old: true };
    sandbox._customerCalcCache.lastRender = Date.now();
    eq(sandbox._isCustomerCacheValid(), true, 'cache vừa làm mới phải còn hạn');
}
var events = ['customers:changed', 'transactions:added', 'cost_transactions:changed'];
for (var ei = 0; ei < events.length; ei++) {
    markFresh();
    fire(events[ei]);
    eq(sandbox._isCustomerCacheValid(), false, 'sự kiện ' + events[ei] + ' phải làm cache hết hạn');
    eq(Object.keys(sandbox._customerCalcCache.debtSummary).length, 0, 'sự kiện ' + events[ei] + ' phải xóa summary cũ');
}
var watched = listeners['customers:*'].length;
sandbox._watchCustomerCacheSources();
for (var di = 0; di < domReady.length; di++) domReady[di]();
eq(listeners['customers:*'].length, watched, 'không đăng ký trùng listener');

// --- A+B chạy thật qua renderCustomerList: cache cũ không giữ nợ cũ, cache mới bỏ hoàn tiền ---
var key = todayKey();
sandbox.customers = [{
    id: 'c1',
    name: 'Khach A',
    debtHistory: [
        { amount: 100, dateKey: key },
        { amount: 50, refunded: true, dateKey: key }
    ],
    paymentHistory: [
        { amount: 20, dateKey: key },
        { amount: 10, status: 'refunded', dateKey: key }
    ]
}];
sandbox._invalidateCustomerCalcCache();
sandbox._customerRenderGuard = 0;
sandbox.renderCustomerList();
var sum = sandbox._customerCalcCache.debtSummary.c1;
eq(sum.totalFromHistory, 100, 'tổng nợ lịch sử bỏ entry hoàn tiền');
eq(sum.totalPayment, 20, 'tổng trả nợ bỏ entry hoàn tiền');
eq(sum.outstandingDebt, 80, 'nợ hiển thị bỏ entry hoàn tiền');
eq(sum.debtToday, 100, 'nợ hôm nay bỏ entry hoàn tiền');
eq(sum.paymentToday, 20, 'tiền thu hôm nay bỏ entry hoàn tiền');
eq(totalDebtEl.innerText, '80', 'tổng nợ ghi ra DOM đúng sau khi bỏ hoàn tiền');

sandbox.customers[0].debtHistory.push({ amount: 30, dateKey: key });
fire('customers:changed');
sandbox._customerRenderGuard = 0;
sandbox.renderCustomerList();
eq(sandbox._customerCalcCache.debtSummary.c1.outstandingDebt, 110, 'nợ mới có ngay sau sự kiện DB, không đợi TTL');

// --- C: kiểm chứng tĩnh khóa dedup nhập kho (không sửa code) ---
var dedupFrom = invSrc.indexOf('// Deduplicate:');
var dedupTo = invSrc.indexOf('// Get date filter values');
ok(dedupFrom > 0 && dedupTo > dedupFrom, 'tìm được vùng dedup trong inventory-manager.js');
var dedup = invSrc.slice(dedupFrom, dedupTo);
ok(dedup.indexOf("_source === 'cost'") !== -1, 'khóa cost được đánh dấu _source');
ok(dedup.indexOf("_source === 'ing_tx'") !== -1, 'khóa ingredient_transactions được đánh dấu _source');
ok(dedup.indexOf("dateKey + '_' + Math.round(allTx[di].quantity * 1000)") !== -1, 'hai nguồn dùng chung khóa ngày + số lượng');
ok(invSrc.indexOf("_source = 'ing_tx'") !== -1 && invSrc.indexOf("_source: 'cost'") !== -1, 'cả hai luồng nhập đều gắn _source');

// --- D: kiểm chứng tĩnh đổi đơn vị (không sửa code) ---
var fmtFrom = invSrc.indexOf('function _fmtQty');
var fmtTo = invSrc.indexOf('// Load transaction history');
ok(fmtFrom > 0 && fmtTo > fmtFrom, 'tìm được hàm _fmtQty');
var fmt = invSrc.slice(fmtFrom, fmtTo);
ok(fmt.indexOf('qty * convRate') !== -1, 'convRate là hệ số nhân duy nhất');
var convBlock = invSrc.slice(invSrc.indexOf('var baseUnit = ing.unit'), fmtFrom);
ok(convBlock.indexOf('convFrom') !== -1 && convBlock.indexOf('convRate') !== -1 && fmt.indexOf('hasConv') !== -1, 'convFrom chỉ là điều kiện hiển thị');
ok(fmt.indexOf('qty /') === -1, 'không chia thêm cho đơn vị nguồn (tránh quy đổi kép)');
ok(invSrc.indexOf('data.conversionFrom = conversionFrom;') !== -1 &&
   invSrc.indexOf('data.conversionRate = conversionRate;') !== -1, 'đổi đơn vị lưu nhãn và hệ số riêng biệt');

console.log('PASS: ' + checks + ' kiểm tra trong test-debt-inventory-regression.js');
