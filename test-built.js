// Chay lai TOAN BO test nhung doc ban BUILD trong js.min/ thay vi file nguon.
// Day la bang chung app thuc su chay dung code da sua.
var fs = require('fs');
var path = require('path');
var child = require('child_process');

var ROOT = __dirname;
var POS = ROOT;

// Test -> file canh doi sang ban build
var MAP = {
    'db': 'db.min.js',
    'customers': 'customers.min.js',
    'history': 'history.min.js',
    'employees': 'employees.min.js',
    'split-transfer-merge': 'split-transfer-merge.min.js',
    'realtime-pos': 'realtime-pos.min.js'
};

var TESTS = [
    'test-busy-lock.js', 'test-claim-table.js', 'test-emp-fallback.js',
    'test-employee-salary.js', 'test-full-congnhe.js', 'test-notify-queue.js',
    'test-patch-table.js', 'test-realtime-congnhe.js', 'test-reconcile-safe.js',
    'test-refund-congnhe.js', 'test-revenue-match.js', 'test-shop-scope.js',
    'test-split-locks.js', 'test-suppress.js', 'test-sync-queue.js'
];

var tmpDir = path.join(ROOT, '.testmin');
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

// Che file nguon cua pos2018? Khong can - test doc bang duong dan tuyet doi
// relative __dirname. De chay tren ban build, tao ban sao test tro sang js.min.
var tmpFiles = [];
TESTS.forEach(function (t) {
    var src = fs.readFileSync(path.join(ROOT, t), 'utf8');
    Object.keys(MAP).forEach(function (base) {
        // Test doc duong dan dang: path.join(__dirname, '.', 'db.js')
        // Chi thay DUONG DAN, khong dung file nao khac cung ten.
        src = src.split("'" + base + ".js'")
               .join("'js.min', '" + MAP[base] + "'");
        src = src.split('"pos2018", "' + base + '.js"')
               .join('"pos2018", "js.min", "' + MAP[base] + '"');
    });
    // __dirname phai tro ve thu muc goc de duong dan hoat dong
    src = src.replace(/__dirname/g, JSON.stringify(ROOT).replace(/\\/g, '\\\\'));
    var out = path.join(tmpDir, t);
    fs.writeFileSync(out, src, 'utf8');
    tmpFiles.push(out);
});

var tongPass = 0, coFail = [];
tmpFiles.forEach(function (f) {
    var r;
    try {
        r = child.spawnSync(process.execPath, [f], { cwd: ROOT, encoding: 'utf8' });
    } catch (e) {
        coFail.push(path.basename(f) + ' : chay loi ' + e.message);
        return;
    }
    var out = (r.stdout || '') + (r.stderr || '');
    var m = out.match(/PASS:\s*(\d+)/);
    var name = path.basename(f);
    if (r.status !== 0) {
        coFail.push(name);
        console.log('  FAIL  ' + name);
        out.split('\n').filter(function (l) { return l.indexOf('FAIL ') >= 0; })
            .slice(0, 4).forEach(function (l) { console.log('        ' + l.trim()); });
        return;
    }
    if (m) { tongPass += parseInt(m[1], 10); console.log('  PASS  ' + name + '  (' + m[1] + ')'); }
    else { console.log('  PASS  ' + name); }
});

console.log('');
console.log('=== TEST TREN BAN BUILD (js.min/) ===');
console.log('  File test  : ' + TESTS.length);
console.log('  Assertions : ' + tongPass);
console.log('  File fail  : ' + coFail.length);
if (coFail.length) console.log('  -> ' + coFail.join(', '));
else console.log('  => Ban build chay dung nhu file nguon.');
process.exit(coFail.length ? 1 : 0);