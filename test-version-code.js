// Kiem tra logic phien ban - CHAY THAT ham Java, khong transpile.
//
//   UpdateChecker.parseVersion  (Java, bien dich roi chay that)
//       so voi
//   VersionCodeTuTen            (PowerShell trong build-apk.ps1)
//
// Neu hai ben lech, may POS so sanh sai va KHONG BAO GIO nhan ban cap nhat -
// loai bug im lang, khong bao loi gi tren man hinh POS.
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var AND = path.join(__dirname, 'android');
var pass = 0, fail = 0;

function ok(l, c, extra) {
    if (c) { pass++; console.log('  PASS  ' + l); }
    else { fail++; console.log('  FAIL  ' + l + (extra ? '\n         ' + extra : '')); }
}

// ---------------------------------------------------------------------
// Chay Java that
// ---------------------------------------------------------------------
console.log('=== LOGIC PHIEN BAN ===');
console.log('');
console.log('Buoc 1: bien dich va chay that UpdateChecker.parseVersion');
var r = cp.spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File',
    path.join(AND, 'test-version-code.ps1')], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
var out = (r.stdout || '') + (r.stderr || '');
if (out.indexOf('JAVA_OK') < 0) {
    console.log('  FAIL  khong chay duoc Java');
    console.log(out.split('\n').slice(0, 12).map(function (l) { return '         ' + l; }).join('\n'));
    process.exit(1);
}
console.log('  -> Java chay OK');

var javaVal = {}, javaCmp = {}, javaPrompt = {};
out.split(/\r?\n/).forEach(function (l) {
    var m = l.match(/^(\S+)\s+(-?\d+)$/);
    if (m) { javaVal[m[1]] = parseInt(m[2], 10); return; }
    var c = l.match(/^CMP (\S+) (\S+) (\S+) (\S+)$/);
    if (c) { javaCmp[c[1] + '|' + c[2]] = { got: c[3], want: c[4] }; return; }
    var p = l.match(/^PROMPT (\S+) (\S+) (\S+) (\S+)$/);
    if (p) { javaPrompt[p[2]] = { got: p[3], want: p[4] }; return; }
});

// ---------------------------------------------------------------------
// Buoc 2: chay PowerShell
// ---------------------------------------------------------------------
console.log('Buoc 2: chay VersionCodeTuTen trong build-apk.ps1');
var ps = cp.spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File',
    path.join(AND, 'print-version-code.ps1')], { encoding: 'utf8' });
var psOut = (ps.stdout || '') + (ps.stderr || '');
if (psOut.indexOf('PS_OK') < 0) {
    console.log('  FAIL  khong chay duoc PowerShell');
    console.log(psOut.split('\n').slice(0, 12).map(function (l) { return '         ' + l; }).join('\n'));
    process.exit(1);
}
var psVal = {};
psOut.split(/\r?\n/).forEach(function (l) {
    var m = l.match(/^(\S+)\s+(-?\d+)$/);
    if (m) psVal[m[1]] = parseInt(m[2], 10);
});
console.log('  -> PowerShell chay OK');
console.log('');

// ---------------------------------------------------------------------
// A. Hai cong thuc phai cho cung ket qua
// ---------------------------------------------------------------------
console.log('A. Java va PowerShell phai KHOP nhau:');
Object.keys(javaVal).forEach(function (k) {
    var psV = psVal[k];
    ok('"' + k + '" -> java ' + javaVal[k] + ' / ps ' + psV, javaVal[k] === psV,
        'java=' + javaVal[k] + '  ps=' + psV);
});
console.log('');

// ---------------------------------------------------------------------
// B. Thu tu phai dung (chay that tren Java)
// ---------------------------------------------------------------------
console.log('B. So sanh phien ban:');
Object.keys(javaCmp).forEach(function (k) {
    var v = javaCmp[k];
    ok(k.replace('|', ' vs ') + ' -> ' + v.got, v.got === v.want, 'mong doi ' + v.want);
});
console.log('');

// ---------------------------------------------------------------------
// C. May ban CU co nhan duoc ban moi khong
// ---------------------------------------------------------------------
console.log('C. May dang chay 1.0.0, co bao hop thoai khong:');
Object.keys(javaPrompt).forEach(function (k) {
    var v = javaPrompt[k];
    ok('release ' + k + ' -> ' + v.got, v.got === v.want, 'mong doi ' + v.want);
});
console.log('');

// ---------------------------------------------------------------------
// D. Gia tri phai dung theo cong thuc major*10000 + minor*100 + patch
// ---------------------------------------------------------------------
console.log('D. Cong thuc major*10000 + minor*100 + patch:');
[['1.0.0', 10000], ['1.0.1', 10001], ['1.0.10', 10010], ['1.1.0', 10100],
 ['1.9.9', 10909], ['1.10.0', 11000], ['2.0.0', 20000], ['0.9.9', 909]].forEach(function (c) {
    ok(c[0] + ' = ' + c[1], javaVal[c[0]] === c[1], 'thuc te = ' + javaVal[c[0]]);
});
console.log('');

// ---------------------------------------------------------------------
// E. Lo khop voi ban da phat hanh
// ---------------------------------------------------------------------
console.log('E. Ban da phat hanh (v1.0.0) khong bi "lui" ve sau:');
try {
    var rel = cp.spawnSync('gh', ['release', 'list', '--repo', 'Datkep92/pos2018',
        '--limit', '10', '--json', 'tagName'], { encoding: 'utf8' });
    if (rel.status === 0 && rel.stdout.trim()) {
        var tags = JSON.parse(rel.stdout);
        console.log('  Release tren GitHub: ' + tags.join(', '));
        tags.forEach(function (t) {
            var v = javaVal[t.replace(/^[vV]/, '')];
            if (v === undefined) {
                ok('tag ' + t + ' -> phai co versionCode', false, 'parse that bai');
            } else {
                ok('tag ' + t + ' -> versionCode ' + v, true);
            }
        });
    }
} catch (e) { /* khong co gh - bo qua */ }

console.log('');
console.log('=========================================');
console.log('  TONG: ' + (pass + fail) + ' assertions');
console.log('  PASS: ' + pass);
console.log('  FAIL: ' + fail);
console.log('=========================================');
process.exit(fail === 0 ? 0 : 1);