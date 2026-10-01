// Kiem tra AssetServer: duong dan trong APK -> duong dan AssetManager.open().
// Day la phan TU VIET cua app nen phai kiem tra ky, khong doan.
// Sai o day = app mo ra trang trang, may POS khong ban duoc.
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var src = fs.readFileSync(
    path.join(__dirname, 'android', 'app', 'src', 'com', 'milano', 'pos259', 'AssetServer.java'),
    'utf8');

// Lay nguyen body cua class AssetServer de chay thu trong Node
var i = src.indexOf('public class AssetServer');
var j = src.lastIndexOf('}', src.length);
var body = src.slice(i, j + 1);

// Lay phan tinh duong dan (khong phai WebResourceResponse) de thu
var pathLogic = src.slice(src.indexOf('String rel = path;'), src.indexOf('if (rel.contains(".."))'));

// Dung dung thuat toan goc trong AssetServer.java, viet lai de thu
var ROOT = 'assets';
function toAssetPath(urlPath) {
    var rel = urlPath;
    var k = rel.indexOf('/' + ROOT + '/');
    if (k >= 0) {
        rel = rel.substring(k + ROOT.length + 2);
    } else if (rel.indexOf('/' + ROOT) === 0) {
        rel = rel.substring(ROOT.length + 1);
    } else if (rel.charAt(0) === '/') {
        rel = rel.substring(1);
    } else {
        rel = ROOT + '/' + rel;
    }
    if (rel === '') rel = 'index.html';
    return rel;
}

var pass = 0, fail = 0;
function eq(label, actual, expected) {
    if (actual === expected) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + '\n         actual  : ' + actual + '\n         expected: ' + expected); }
}
function ok(label, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + label); }
    else { fail++; console.log('  FAIL  ' + label + (extra ? '  (' + extra + ')' : '')); }
}

console.log('=== AssetServer: URL -> AssetManager.open() ===');
console.log('');

// Lay danh sach tep that trong APK
var assetsDir = path.join(__dirname, 'android', 'build', 'assets');
var thatCoTrongApk = {};
function quet(dir, tienTo) {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(function (f) {
        var p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) quet(p, tienTo + f + '/');
        else thatCoTrongApk[tienTo + f] = fs.statSync(p).size;
    });
}
quet(assetsDir, '');
console.log('  APK co ' + Object.keys(thatCoTrongApk).length + ' tep assets');
console.log('');

var START = 'https://appassets.androidplatform.net/assets/index.html';

console.log('A. Cac duong dan app THAT su yeu cau:');
eq('trang chinh',
    toAssetPath(new URL(START).pathname), 'index.html');

// Doc tat ca duong dan trong index.html + js.min roi doi chieu
var cacYeuCau = [new URL(START).pathname];
var files = ['index.html'];
fs.readdirSync(assetsDir).forEach(function (d) {
    var p = path.join(assetsDir, d);
    if (fs.statSync(p).isDirectory()) files.push(d + '/index.html');
});
files.forEach(function (rel) {
    var p = path.join(assetsDir, rel);
    if (!fs.existsSync(p)) return;
    var t = fs.readFileSync(p, 'utf8');
    var re = /(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)/g;
    var m;
    while ((m = re.exec(t)) !== null) {
        var u = m[1] || m[2];
        if (!u) continue;
        if (/^(https?:)?\/\//.test(u) || /^data:/.test(u) || /^#/.test(u)) continue;
        u = u.split('?')[0].split('#')[0];
        if (!u) continue;
        if (u.charAt(0) === '/') cacYeuCau.push(u);
        else {
            var base = rel.indexOf('/') >= 0 ? rel.slice(0, rel.lastIndexOf('/') + 1) : '';
            cacYeuCau.push('/assets/' + base + u);
        }
    }
});

var thieu = [], sai = [];
var daXet = {};
cacYeuCau.forEach(function (u) {
    if (u.indexOf('/assets/') !== 0) return;
    if (daXet[u]) return;
    daXet[u] = true;
    var rel = toAssetPath(u);
    if (rel.indexOf('\\') >= 0) sai.push(u + ' -> ' + rel);
    if (!thatCoTrongApk.hasOwnProperty(rel)) thieu.push(rel + '   (tu ' + u + ')');
});

eq('khong co duong dan sai dau gach nguoc', sai.length, 0);
if (sai.length) sai.forEach(function (s) { console.log('         ' + s); });
eq('khong thieu tep nao', thieu.length, 0);
if (thieu.length) thieu.slice(0, 10).forEach(function (s) { console.log('         THIEU: ' + s); });

console.log('');
console.log('B. Cac truong hop bien:');
eq('duong dan co gac', toAssetPath('/assets/mangdi.html'), 'mangdi.html');
eq('co duong dan con', toAssetPath('/assets/js.min/db.min.js'), 'js.min/db.min.js');
eq('thu muc goc', toAssetPath('/assets/'), 'index.html');
eq('khong co assets', toAssetPath('/index.html'), 'index.html');
eq('rong', toAssetPath('/assets'), 'index.html');

console.log('');
console.log('C. Chan truy nhap ra ngoai thu muc assets:');
ok('duong dan .. bi chan', toAssetPath('/assets/../../etc/passwd').indexOf('..') >= 0);

console.log('');
console.log('D. Ten tep co ky tu dac biet:');
var dacBiet = [];
for (var k in thatCoTrongApk) { if (/[A-Za-z0-9._\-\/]/.test(k) === false) dacBiet.push(k); }
eq('khong co ten tep la', dacBiet.length, 0);

console.log('');
console.log('=========================================');
console.log('  TONG: ' + (pass + fail) + ' assertions');
console.log('  PASS: ' + pass);
console.log('  FAIL: ' + fail);
console.log('=========================================');
process.exit(fail === 0 ? 0 : 1);