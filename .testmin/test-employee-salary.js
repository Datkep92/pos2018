// =====================================================================
// TEST LOGIC LUONG + THUONG NHAN VIEN
// Nap code THAT tu pos2018/employees.js
// Chay: node test-employee-salary.js
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
function eq(l, a, e) { if (a === e) { pass++; console.log('  PASS  ' + l + '  [' + a + ']'); } else { fail++; console.log('  FAIL  ' + l + '  actual=' + JSON.stringify(a) + ' expected=' + JSON.stringify(e)); } }
function ok(l, c, x) { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l + (x ? '  ' + x : '')); } }

var sandbox = {
    console: { log: function () { }, warn: function () { }, error: function () { } },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Date: Date, Math: Math, JSON: JSON, String: String, Array: Array,
    parseInt: parseInt, isNaN: isNaN, Promise: Promise, firebase: undefined,
    document: { getElementById: function () { return null; }, addEventListener: function () { }, createElement: function () { return { style: {}, classList: { add: function () {} } }; } }
};
sandbox.window = sandbox;
sandbox.EMP = { staffs: [], attendanceCache: {}, salaryCache: {}, _revenueCache: {} };
sandbox.empFormatCurrency = function (n) { return String(Math.round(n || 0)); };

var NEED = ['empGetDaysInMonth', 'empGetDaysInPeriod', 'empGetCurrentPeriod',
    'empCalculateRevenueBonus', 'empCalculateStaffSalary', '_updateRevenueCacheEntry',
    '_empSanitizeAttendance', '_empTxDateKey'];
var ctx = vm.createContext(sandbox);
vm.runInContext(NEED.map(ex).join('\n\n'), ctx);
NEED.forEach(function (f) { sandbox[f] = vm.runInContext(f, ctx); });
sandbox.EMP = vm.runInContext('EMP', ctx);

console.log('TEST LUONG + THUONG NHAN VIEN (nap ham that tu employees.js)');

(function () {
    var EMP = sandbox.EMP;

    // -----------------------------------------------------------------
    group('L1: SO NGAY TRONG KY 20/N -> 19/N+1');
    var pi = sandbox.empGetDaysInPeriod(2026, 8);   // ky 20/8 -> 19/9
    eq('thang 8 co 31 ngay (daysInMonth)', pi.daysInMonth, 31);
    eq('ky 20/8-19/9 co 31 ngay (11 + 20)', pi.days, 31);
    eq('ngay bat dau', pi.startDate, '2026-08-20');
    eq('ngay ket thuc', pi.endDate, '2026-09-19');
    // Thang 2 nam nhuan
    var pi2 = sandbox.empGetDaysInPeriod(2028, 2);
    eq('thang 2/2028 co 29 ngay', pi2.daysInMonth, 29);
    // Thang co 30 ngay
    var pi3 = sandbox.empGetDaysInPeriod(2026, 4);
    eq('thang 4 co 30 ngay', pi3.daysInMonth, 30);
    eq('ky 20/4-19/5 co 30 ngay (10 + 20)', pi3.days, 30);

    // -----------------------------------------------------------------
    group('L2: KY HIEN TAI THEO NGAY HIEN TAI');
    var now = new Date();
    var cur = sandbox.empGetCurrentPeriod();
    var expectCur = now.getDate() >= 20
        ? now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
        : (now.getMonth() === 0
            ? (now.getFullYear() - 1) + '-12'
            : now.getFullYear() + '-' + String(now.getMonth()).padStart(2, '0'));
    eq('ky hien tai dung ngay hom nay', cur, expectCur);

    // -----------------------------------------------------------------
    group('L3: LUONG CO BAN');
    EMP.staffs = [{ id: 's1', displayName: 'An', dailySalary: 100000, revenueBonusEnabled: false }];
    EMP.salaryCache = { s1: { '2026-08': { dailySalary: 100000, revenueBonusEnabled: false } } };
    EMP.attendanceCache = { s1: { '2026-08': { offDays: [], otDays: [] } } };
    EMP._revenueCache = {};
    var r = sandbox.empCalculateStaffSalary('s1', '2026-08');
    eq('31 ngay x 100.000', r.baseSalary, 3100000);
    eq('tong luong 3.100.000', r.total, 3100000);
    eq('ngay cong 31', r.workingDays, 31);

    // Nghi 3 ngay
    EMP.attendanceCache.s1['2026-08'] = { offDays: ['2026-08-05', '2026-08-06', '2026-08-07'], otDays: [] };
    r = sandbox.empCalculateStaffSalary('s1', '2026-08');
    eq('nghi 3 ngay -> 28 ngay cong', r.workingDays, 28);
    eq('luong 2.800.000', r.total, 2800000);

    // Tang ca 2 ngay
    EMP.attendanceCache.s1['2026-08'] = { offDays: ['2026-08-05'], otDays: ['2026-08-10', '2026-08-11'] };
    r = sandbox.empCalculateStaffSalary('s1', '2026-08');
    eq('31 - 1 + 2 = 32 ngay cong', r.workingDays, 32);
    eq('luong 3.200.000', r.total, 3200000);

    // Nghi het thang -> 0
    EMP.attendanceCache.s1['2026-08'] = {
        offDays: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05',
            '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10',
            '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15',
            '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20',
            '2026-08-21', '2026-08-22', '2026-08-23', '2026-08-24', '2026-08-25',
            '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30', '2026-08-31'],
        otDays: []
    };
    r = sandbox.empCalculateStaffSalary('s1', '2026-08');
    eq('nghi het thang -> 0 ngay cong', r.workingDays, 0);
    eq('luong 0', r.total, 0);

    // -----------------------------------------------------------------
    group('L4: THUONG DOANH THU 1%');
    EMP.salaryCache.s1['2026-08'] = { dailySalary: 100000, revenueBonusEnabled: true };
    EMP.attendanceCache.s1['2026-08'] = { offDays: [], otDays: [] };
    EMP._revenueCache = {};
    for (var d = 1; d <= 31; d++) {
        EMP._revenueCache['2026-08-' + String(d).padStart(2, '0')] = 1000000;
    }
    r = sandbox.empCalculateStaffSalary('s1', '2026-08');
    eq('31 ngay x 1tr x 1% = 310.000', r.revenueBonus, 310000);
    eq('tong = luong + thuong', r.total, 3100000 + 310000);

    // Nghi 1 ngay -> thuong ngay do = 0
    EMP.attendanceCache.s1['2026-08'] = { offDays: ['2026-08-15'], otDays: [] };
    r = sandbox.empCalculateStaffSalary('s1', '2026-08');
    eq('nghi 15/8 -> thuong 30 ngay = 300.000', r.revenueBonus, 300000);
    eq('luong 30 ngay', r.baseSalary, 3000000);

    // Khong bat thuong
    EMP.salaryCache.s1['2026-08'] = { dailySalary: 100000, revenueBonusEnabled: false };
    r = sandbox.empCalculateStaffSalary('s1', '2026-08');
    eq('tat thuong -> 0', r.revenueBonus, 0);

    // Khong co du lieu doanh thu
    EMP.salaryCache.s1['2026-08'] = { dailySalary: 100000, revenueBonusEnabled: true };
    EMP._revenueCache = null;
    r = sandbox.empCalculateStaffSalary('s1', '2026-08');
    eq('khong co cache doanh thu -> thuong 0 (khong loi)', r.revenueBonus, 0);

    // -----------------------------------------------------------------
    group('L5: THUONG KHI DOANH THU VE 0 (BUG DA SUA)');
    EMP._revenueCache = { '2026-08-01': 5000000, '2026-08-02': 3000000 };
    EMP.attendanceCache.s1['2026-08'] = { offDays: [], otDays: [] };
    // Doanh thu ngay 01/8 bi sua ve 0
    EMP._revenueCache['2026-08-01'] = 0;
    r = sandbox.empCalculateRevenueBonus('s1', '2026-08', 2026, 8);
    eq('chi con ngay 02/8 = 3tr x 1% = 30.000', r, 30000);
    EMP._revenueCache['2026-08-02'] = 0;
    r = sandbox.empCalculateRevenueBonus('s1', '2026-08', 2026, 8);
    eq('ca 2 ngay = 0 -> thuong 0', r, 0);

    // -----------------------------------------------------------------
    group('L6: _updateRevenueCacheEntry - DOC DU 3 DANG DU LIEU');
    var c = {};
    sandbox.EMP._revenueCache = c;
    // Dạng số
    sandbox._updateRevenueCacheEntry('2026-08-01', 15000000);
    eq('dạng số', c['2026-08-01'], 15000000);
    // Dạng object cash/transfer/grab
    sandbox._updateRevenueCacheEntry('2026-08-02', { cash: 5000000, transfer: 7000000, grab: 3000000 });
    eq('dạng cash+transfer+grab', c['2026-08-02'], 15000000);
    // Dạng object total
    sandbox._updateRevenueCacheEntry('2026-08-03', { total: 12000000 });
    eq('dạng total', c['2026-08-03'], 12000000);
    // total = 0 - PHẢI cập nhật (bug đã sửa)
    c['2026-08-04'] = 9999999;
    sandbox._updateRevenueCacheEntry('2026-08-04', { total: 0 });
    eq('total = 0 phải ghi đè giá trị cũ', c['2026-08-04'], 0);
    // cash/transfer/grab = 0
    c['2026-08-05'] = 8888888;
    sandbox._updateRevenueCacheEntry('2026-08-05', { cash: 0, transfer: 0, grab: 0 });
    eq('cash/transfer/grab = 0 -> ghi 0', c['2026-08-05'], 0);
    // null/undefined -> không đụng
    var truoc = c['2026-08-03'];
    sandbox._updateRevenueCacheEntry('2026-08-03', { khac: 1 });
    eq('object không có trường nào -> giữ nguyên', c['2026-08-03'], truoc);
    sandbox._updateRevenueCacheEntry('2026-08-06', null);
    ok('null -> không lỗi', true);
    sandbox._updateRevenueCacheEntry('2026-08-07', undefined);
    ok('undefined -> không lỗi', true);

    // -----------------------------------------------------------------
    group('L7: THUONG CHI TINH THEO THANG N, KHONG LAN SANG KY KHAC');
    var c2 = {};
    sandbox.EMP._revenueCache = c2;
    // Doanh thu thang 7 (ky truoc) va thang 8 (ky nay) va thang 9
    for (var d7 = 1; d7 <= 31; d7++) c2['2026-07-' + String(d7).padStart(2, '0')] = 1000000;
    for (var d8 = 1; d8 <= 31; d8++) c2['2026-08-' + String(d8).padStart(2, '0')] = 2000000;
    for (var d9 = 1; d9 <= 30; d9++) c2['2026-09-' + String(d9).padStart(2, '0')] = 9000000;
    var bonus8 = sandbox.empCalculateRevenueBonus('s1', '2026-08', 2026, 8);
    eq('thuong thang 8 = 31 x 2tr x 1% = 620.000', bonus8, 620000);
    ok('KHONG lan sang thang 7 hay thang 9', bonus8 === 620000);

    // -----------------------------------------------------------------
    group('L8: THUONG VA LUONG DUNG CUNG THANG');
    sandbox.EMP.staffs = [{ id: 's2', displayName: 'Binh', dailySalary: 200000, revenueBonusEnabled: true }];
    sandbox.EMP.salaryCache = { s2: { '2026-08': { dailySalary: 200000, revenueBonusEnabled: true } } };
    sandbox.EMP.attendanceCache = { s2: { '2026-08': { offDays: [], otDays: [] } } };
    sandbox.EMP._revenueCache = c2;
    var r8 = sandbox.empCalculateStaffSalary('s2', '2026-08');
    eq('luong 31 x 200.000 = 6.200.000', r8.baseSalary, 6200000);
    eq('thuong 620.000', r8.revenueBonus, 620000);
    eq('tong 6.820.000', r8.total, 6820000);

    // -----------------------------------------------------------------
    group('L9: THUONG KHONG AM');
    sandbox.EMP.salaryCache.s2['2026-08'] = { dailySalary: 200000, revenueBonusEnabled: false, manualBonus: 0, manualPenalty: 10000000 };
    r8 = sandbox.empCalculateStaffSalary('s2', '2026-08');
    ok('phat toi da khong de tong < 0', r8.total >= 0, 'total=' + r8.total);
    eq('bị chặn về 0', r8.total, 0);

    // -----------------------------------------------------------------
    group('L10: THUONG DANH TINH SAI');
    sandbox.EMP.salaryCache.s2['2026-08'] = { dailySalary: 200000, revenueBonusEnabled: true, manualBonus: 500000 };
    r8 = sandbox.empCalculateStaffSalary('s2', '2026-08');
    eq('thuong don gia 500.000 cong vao', r8.total, 6200000 + 620000 + 500000);

    // -----------------------------------------------------------------
    group('L11: CHI TINH NGAY THUOC THANG N, BO QUA NGAY SAI SOT');
    EMP.staffs = [{ id: 's3', displayName: 'C', dailySalary: 100000, revenueBonusEnabled: false }];
    EMP.salaryCache = { s3: { '2026-08': { dailySalary: 100000, revenueBonusEnabled: false } } };
    EMP._revenueCache = {};
    // Dữ liệu chấm công lẫn ngày của tháng khác (sai sót khi nhập / copy từ kỳ trước)
    EMP.attendanceCache = { s3: { '2026-08': { offDays: ['2026-08-05', '2026-07-14', '2026-09-02'], otDays: ['2026-08-10', '2026-06-01'] } } };
    var r11 = sandbox.empCalculateStaffSalary('s3', '2026-08');
    eq('chi dem 1 ngay nghi trong thang 8', r11.offDays, 1);
    eq('chi dem 1 ngay tang ca trong thang 8', r11.otDays, 1);
    eq('ngay cong 31 - 1 + 1 = 31', r11.workingDays, 31);
    eq('luong khong bi cat', r11.total, 3100000);

    // 31 ngay nghi lan sang thang khac -> khong duoc cat ve 0
    EMP.attendanceCache.s3['2026-08'] = {
        offDays: ['2026-07-01', '2026-07-05', '2026-07-09', '2026-07-13', '2026-07-17',
            '2026-09-01', '2026-09-05', '2026-09-09', '2026-09-13', '2026-09-17',
            '2026-09-21', '2026-09-25', '2026-09-29', '2026-06-02', '2026-06-06',
            '2026-06-10', '2026-06-14', '2026-06-18', '2026-06-22', '2026-06-26',
            '2026-06-30', '2026-05-02', '2026-05-06', '2026-05-10', '2026-05-14',
            '2026-05-18', '2026-05-22', '2026-05-26', '2026-05-30', '2026-04-02',
            '2026-04-06'],
        otDays: []
    };
    var r12 = sandbox.empCalculateStaffSalary('s3', '2026-08');
    eq('31 ngay nghi sai thang -> van 31 ngay cong', r12.workingDays, 31);
    eq('luong van 3.100.000', r12.total, 3100000);

    // Ngay off that su trong thang van bi tru
    EMP.attendanceCache.s3['2026-08'] = {
        offDays: ['2026-08-01', '2026-08-02', '2026-08-03', '2026-07-01', '2026-09-01'],
        otDays: []
    };
    var r13 = sandbox.empCalculateStaffSalary('s3', '2026-08');
    eq('chi tru 3 ngay trong thang', r13.workingDays, 28);

    // Du lieu rac (khong phai chuoi) khong duoc lam hong phep tinh
    EMP.attendanceCache.s3['2026-08'] = { offDays: [null, 123, {}, '2026-08-05'], otDays: [undefined] };
    var r14 = sandbox.empCalculateStaffSalary('s3', '2026-08');
    eq('du lieu rac -> chi tru ngay hop le', r14.workingDays, 30);
    eq('khong loi', true, true);

    // -----------------------------------------------------------------
    group('L12: LAM SACH DU LIEU CHAM CONG');
    var s1 = sandbox._empSanitizeAttendance({
        offDays: ['2026-08-05', '2026-08-05', '2026-07-14', '2026-09-02', '2026-08-06'],
        otDays: ['2026-08-10', '2026-08-05', '2026-06-01']
    }, 2026, 8);
    eq('bo ngay trung lap', s1.offDays.length, 2);
    ok('giu 05/8 va 06/8', s1.offDays.indexOf('2026-08-05') >= 0 && s1.offDays.indexOf('2026-08-06') >= 0,
        JSON.stringify(s1.offDays));
    ok('bo ngay sai thang khoi off', s1.offDays.indexOf('2026-07-14') < 0 && s1.offDays.indexOf('2026-09-02') < 0);
    eq('bo ngay sai thang khoi ot', s1.otDays.length, 1);
    eq('chi con 10/8', s1.otDays[0], '2026-08-10');
    ok('ngay vua nghi vua tang ca -> chi con nghi', s1.otDays.indexOf('2026-08-05') < 0);

    // du lieu rac khong duoc lam hong
    var s2 = sandbox._empSanitizeAttendance({ offDays: [null, 123, {}, '2026-08-07'], otDays: undefined }, 2026, 8);
    eq('du lieu rac -> chi con ngay hop le', s2.offDays.length, 1);
    eq('ngay hop le con lai', s2.offDays[0], '2026-08-07');
    eq('otDays undefined -> mang rong', s2.otDays.length, 0);
    var s3 = sandbox._empSanitizeAttendance(null, 2026, 8);
    eq('null -> rong', s3.offDays.length + s3.otDays.length, 0);
    var s4 = sandbox._empSanitizeAttendance({ offDays: ['2026-8-5'], otDays: [] }, 2026, 8);
    eq('dinh dang sai (khong co so 0) -> bo', s4.offDays.length, 0);

    // thang co 30 ngay: 31/8 la sai -> bo
    var s5 = sandbox._empSanitizeAttendance({ offDays: ['2026-04-30', '2026-04-31'], otDays: [] }, 2026, 4);
    eq('thang 4 chi ton tai toi 30/4', s5.offDays.length, 1);
    eq('30/4 hop le', s5.offDays[0], '2026-04-30');

    // -----------------------------------------------------------------
    group('L13: _empTxDateKey DOC DUON GIA TRI');
    eq('dateKey chuoi', sandbox._empTxDateKey({ dateKey: '2026-08-15' }), '2026-08-15');
    eq('date ISO', sandbox._empTxDateKey({ date: '2026-08-15T10:30:00.000Z' }), '2026-08-15');
    eq('createdAt timestamp', sandbox._empTxDateKey({ createdAt: new Date(2026, 7, 15).getTime() }), '2026-08-15');
    eq('khong co gi -> rong', sandbox._empTxDateKey({}), '');
    eq('null -> rong', sandbox._empTxDateKey(null), '');
    eq('timestamp 0 -> rong', sandbox._empTxDateKey({ createdAt: 0 }), '');

    console.log('\n=========================================');
    console.log('  TONG: ' + (pass + fail) + ' assertions');
    console.log('  PASS: ' + pass);
    console.log('  FAIL: ' + fail);
    console.log('=========================================');
    process.exit(fail === 0 ? 0 : 1);
})();
