// Kiem tra repo "ban hoan chinh": moi tep ma index.html (va cac trang HTML
// khac) tro toi deu phai CO trong git.
//
// Dung de tra loi: clone repo ve may moi -> app co chay duoc khong?
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var D = __dirname;

// Liet ke file git dang theo doi
var tracked = {};
cp.execSync('git ls-files', { cwd: D, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/).forEach(function (f) { if (f) tracked[f] = true; });

var HTMLS = fs.readdirSync(D).filter(function (f) { return /\.html$/.test(f); });

var thieu = [], daNap = 0, tuCDN = {};
HTMLS.forEach(function (h) {
    var t = fs.readFileSync(path.join(D, h), 'utf8');
    var re = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
    var m;
    while ((m = re.exec(t)) !== null) {
        var u = m[1];
        if (!u) continue;
        if (/^(https?:)?\/\//.test(u) || /^data:/.test(u) || /^#/.test(u) || /^javascript:/.test(u)) {
            // Tai nguyen ngoai: ghi lai de bao cao
            var host = u.replace(/^https?:\/\//, '').split('/')[0];
            tuCDN[host] = (tuCDN[host] || 0) + 1;
            continue;
        }
        var rel = u.split('?')[0].split('#')[0];
        if (!rel) continue;
        rel = rel.replace(/^\.\//, '');
        daNap++;
        // Trang HTML tro toi trang HTML
        if (!tracked[rel] && !fs.existsSync(path.join(D, rel))) {
            thieu.push(h + '  ->  ' + rel);
        } else if (!tracked[rel]) {
            thieu.push(h + '  ->  ' + rel + '   (CO tren dia nhung CHUA commit vao git)');
        }
    }
});

console.log('=== REPO CO TU CHUA DU KHONG ===');
console.log('');
console.log('  File theo doi trong git : ' + Object.keys(tracked).length);
console.log('  Trang HTML              : ' + HTMLS.length);
console.log('  Tai nguyen cuc bo tro toi: ' + daNap);
console.log('');

if (thieu.length === 0) {
    console.log('  KHONG THIEU file nao.');
} else {
    console.log('  !! THIEU ' + thieu.length + ' tep:');
    thieu.forEach(function (x) { console.log('     ' + x); });
}

console.log('');
console.log('  Tai nguyen NGOAI (can mang, app van chay duoc):');
Object.keys(tuCDN).sort().forEach(function (h) {
    console.log('     ' + h + '  x' + tuCDN[h]);
});

console.log('');
console.log('=========================================');
if (thieu.length === 0) {
    console.log('  Repo du dung de chay app doc lap.');
} else {
    console.log('  Repo THIEU tep - clone ve may moi se hong.');
}
console.log('=========================================');
process.exit(thieu.length ? 1 : 0);