// =====================================================================
// TEST: GIAO DICH NGUYEN TỐ KHI 2 MÁY CÙNG THANH TOÁN 1 BÀN
// Nap ham THAT tu pos2018/db.js
// Chay: node test-claim-table.js
// =====================================================================
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(path.join("C:\\\\Users\\\\cana2\\\\OneDrive\\\\Documents\\\\Default Project\\\\pos2018", '.', 'js.min', 'db.min.js'), 'utf8');
function ex(n) {
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
function eq(l, a, e) { if (a === e) { pass++; console.log('  PASS  ' + l + '  [' + JSON.stringify(a) + ']'); } else { fail++; console.log('  FAIL  ' + l + '  actual=' + JSON.stringify(a) + ' expected=' + JSON.stringify(e)); } }
function ok(l, c, x) { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l + (x ? '  ' + x : '')); } }

// ---- Firebase gia lap: runTransaction chay TUAN TU nhu server that ----
var DB_STORE = {};          // du lieu that tren "firebase"
var TRANSACTION_LOG = [];   // nhung lan da thay doi data
var FAIL_NEXT = null;       // ep loi mang

var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: function () { return 1; }, clearTimeout: function () { },
    Date: Date, Math: Math, JSON: JSON, String: String, Array: Array,
    parseInt: parseInt, isNaN: isNaN, Promise: Promise,
    localStorage: { getItem: function () { return null; }, setItem: function () { } }
};
sandbox.window = sandbox;
sandbox.DATA = DB_STORE;
sandbox.TXN = TRANSACTION_LOG;
sandbox.FAIL_NEXT = null;

// _getDb().ref(path).transaction(cb)
// cb(null|obj) -> ghi ket qua; tra undefined -> huy
sandbox._getDb = function () {
    return { ref: function (path) {
        return { transaction: function (cb) {
            if (sandbox.FAIL_NEXT) { sandbox.FAIL_NEXT = null; return Promise.reject(new Error('mat mang')); }
            var cur = Object.prototype.hasOwnProperty.call(sandbox.DATA, path) ? sandbox.DATA[path] : null;
            var next = cb(cur ? JSON.parse(JSON.stringify(cur)) : null);
            if (next === undefined) {
                return Promise.resolve({ committed: false, snapshot: { val: function () { return cur; } } });
            }
            sandbox.DATA[path] = next;
            sandbox.TXN.push(path);
            return Promise.resolve({ committed: true, snapshot: { val: function () { return next; } } });
        } };
    } };
};

vm.createContext(sandbox);
vm.runInContext('var CURRENT_SHOP_ID = "shop_A"; var CURRENT_DEVICE_ID = "dev1"; var memoryCache = {}; var _suppressRealtime = 0;', sandbox);
vm.runInContext('function saveToLocal(c, it){ if(memoryCache[c]) memoryCache[c][it.id] = it; return Promise.resolve(); }\n' +
    'function _notifyLocal(){}\n', sandbox);
vm.runInContext(ex('claimTable') + '\n' + ex('releaseTableClaim'), sandbox);
var claimTable = vm.runInContext('claimTable', sandbox);
var releaseTableClaim = vm.runInContext('releaseTableClaim', sandbox);

var BAN = 'shop_A/tables/tb1';
function reset() {
    DB_STORE[BAN] = { id: 'tb1', name: 'Bàn 1', total: 120000, items: [{ name: 'Cà phê', qty: 2, price: 60000 }] };
    TRANSACTION_LOG.length = 0;
    vm.runInContext('memoryCache = {};', sandbox);
}

console.log('TEST GIAO DICH NGUYEN TO - 2 MAY THANH TOAN CUNG 1 BAN');

var chain = Promise.resolve();

chain = chain.then(function () {
    group('C1: MOT MAY -> GIANH DUOC');
    reset();
    return claimTable('tb1').then(function (r) {
        eq('gianh duoc', r.claimed, true);
        ok('co du lieu ban', !!r.table);
        eq('ten ban dung', r.table && r.table.name, 'Bàn 1');
        eq('tong tien dung', r.table && r.table.total, 120000);
        eq('so mon', (r.table && r.table.items || []).length, 1);
    });
});

chain = chain.then(function () {
    group('C2: HAI MAY CUNG BAM -> CHI MOT MAY GIANH DUOC');
    reset();
    // Gia lap hai may: goi claimTable gần như dong thoi (khong await giua)
    var a = claimTable('tb1');
    var b = claimTable('tb1');
    return Promise.all([a, b]).then(function (rs) {
        var claimedCount = rs.filter(function (r) { return r.claimed; }).length;
        eq('CHI MOT may gianh duoc', claimedCount, 1);
        var rejected = rs.filter(function (r) { return !r.claimed; })[0];
        ok('may bi tu choi co ly do', rejected && rejected.reason.length > 0, JSON.stringify(rejected));
    });
});

chain = chain.then(function () {
    group('C3: BAN DA BI THANH TOAN -> MAY KHAC BI TOI CHOI');
    reset();
    return claimTable('tb1').then(function () {
        return claimTable('tb1');   // may 2 bam tiep theo
    }).then(function (r) {
        eq('lan sau bi tu choi', r.claimed, false);
        ok('khong co du lieu ban', r.table === null);
    });
});

chain = chain.then(function () {
    group('C4: BAN RONG -> KHONG AI GIANH DUOC');
    reset();
    DB_STORE[BAN] = { id: 'tb1', name: 'Bàn 1', total: 0, items: [] };
    return claimTable('tb1').then(function (r) {
        eq('ban rong khong gianh duoc', r.claimed, false);
    });
});

chain = chain.then(function () {
    group('C5: MAT MANG -> KHONG DUOC COI LA GIANH DUOC');
    reset();
    sandbox.FAIL_NEXT = true;      // loi xay ra o may nay
    return claimTable('tb1').then(function (r) {
        eq('loi mang -> khong gianh duoc', r.claimed, false);
        ok('va ban van con nguyen', !!DB_STORE[BAN]);
    });
});

chain = chain.then(function () {
    group('C6: KHÔI PHỤC BAN KHI GHI LICH SU LOI');
    reset();
    return claimTable('tb1').then(function (r) {
        var banDaGianh = r.table;
        ok('da gianh, ban bi xoa', DB_STORE[BAN] === undefined || DB_STORE[BAN] === null);
        return releaseTableClaim('tb1', banDaGianh);
    }).then(function (restored) {
        eq('khoi phuc thanh cong', restored, true);
        ok('ban co lai tren server', !!DB_STORE[BAN]);
        eq('ten ban dung khoi phuc', DB_STORE[BAN] && DB_STORE[BAN].name, 'Bàn 1');
        eq('tong tien dung khoi phuc', DB_STORE[BAN] && DB_STORE[BAN].total, 120000);
        eq('so mon dung khoi phuc', (DB_STORE[BAN] && DB_STORE[BAN].items || []).length, 1);
    });
});

chain = chain.then(function () {
    group('C7: KHÔNG KHÔI PHỤC KHI BAN ĐÃ ĐƯỢC TẠO LẠI');
    reset();
    return claimTable('tb1').then(function (r) {
        // may khac da tao lai ban moi trong luc dang xu ly
        DB_STORE[BAN] = { id: 'tb1', name: 'Bàn 1 (mới)', total: 50000, items: [{ name: 'Trà', qty: 1, price: 50000 }] };
        return releaseTableClaim('tb1', r.table);
    }).then(function (restored) {
        eq('khong ghi de ban moi', restored, false);
        eq('van la ban moi', DB_STORE[BAN].name, 'Bàn 1 (mới)');
        eq('tong tien ban moi giu nguyen', DB_STORE[BAN].total, 50000);
    });
});

chain = chain.then(function () {
    group('C8: KHÔNG THÊM TRƯỜNG NÀO VÀO DU LIEU');
    reset();
    var truoc = Object.keys(DB_STORE[BAN]).sort().join(',');
    return claimTable('tb1').then(function (r) {
        return releaseTableClaim('tb1', r.table);
    }).then(function () {
        var sau = Object.keys(DB_STORE[BAN]).sort().join(',');
        // updatedAt/updatedBy là 2 trường hệ thống vốn đã có trong mọi bản ghi
        var truocList = truoc.split(',').filter(function (k) { return k !== 'updatedAt' && k !== 'updatedBy' && k !== 'updatedAt' && k !== 'updatedBy'; });
        var sauList = sau.split(',').filter(function (k) { return k !== 'updatedAt' && k !== 'updatedBy' && k !== 'updatedAt' && k !== 'updatedBy'; });
        eq('khong them truong moi nao', sauList.join(','), truocList.join(','));
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