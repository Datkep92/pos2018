// =====================================================================
// BUILD: dong bo file nguon -> js.min/  +  tang ?v= trong index.html
//
// LY DO CAN SCRIPT NAY:
//   index.html CHI nap file trong js.min/ (khong nap file nguoc).
//   Sua file nguon ma khong chay lai script nay thi may POS van chay ban cu,
//   va cac sua do im lang khong bao gio loi.
//
// CACH CHAY (sau moi lan sua file nguon):
//   node build.js
//
//   node build.js --keep   : giu comment trong file build (doc de kiem tra)
//   node build.js --minify : dung terser de nen that (may phai co terser)
//
// KHONG dung tool minify mac dinh. May nay khong co, va nen sai co the lam
// hong ca he thong tien. Mac dinh chi:
//   - bo comment (/* */ va //)
//   - bo khoang trang thua dau dong
//   - bo dong trong
// KHONG doi ten bien, KHONG gop cac dong -> hanh dong giong het file nguon.
//
// AN TOAN: script nay giu NGUYEN VEN phan noi dung giua cac dong nam trong
// template literal (`` ` ``). Trong 14 file co 63 cho nhu vay; bo comment
// sai o do se lam ho so UI mat chu.
// =====================================================================
var fs = require('fs');
var path = require('path');
var child = require('child_process');

var ROOT = __dirname;   // = pos2018/
var POS = ROOT;          // = pos2018/
var OUT = path.join(ROOT, 'js.min');
var INDEX = path.join(POS, 'index.html');

// Thu muc CSS cung duoc app nap qua css.min/*.min.css. Phai build nua,
// neu khong sua CSS se khong bao gio len may POS.
var CSS_DIR = path.join(POS, 'css');
var CSS_OUT = path.join(POS, 'css.min');

// Thu tu build = thu tu nap trong index.html (nhieu file goi len nhau luc chay).
var FILES = [
    'db.js', 'auth.js', 'pos-app.js', 'realtime-pos.js', 'ingredients.js',
    'notifications.js', 'order.js', 'tables.js', 'split-transfer-merge.js',
    'customers.js', 'history.js', 'print.js', 'draft-orders.js',
    'fund-reconciliation.js', 'manager-detail.js', 'inventory-manager.js',
    'expense.js', 'telegram.js', 'esp32_audit.js', 'messages.js',
    'employees.js', 'settings.js', 'master-config.js', 'master-user-manager.js'
];

var BT = String.fromCharCode(96);
var SQ = String.fromCharCode(39);
var DQ = String.fromCharCode(34);
var BS = String.fromCharCode(92);

/**
 * Lam sach nhe, KHONG dung regex phuc tap.
 * @param {string} code
 * @param {boolean} keepComment  true = giu comment (de kiem tra)
 */
function lightMinify(code, keepComment) {
    var out = [];
    var lines = code.split(/\r?\n/);

    // Trang thai phai GIU QUA cac dong: dang trong chuoi ' " hoac template `
    var inS = null;      // null | "'" | '"' | '`'
    var inBlock = false; // dang trong /* */

    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];

        // Äang á»Ÿ GIá»®A template literal nhieu dong: giu nguyen ven ca dong.
        // Bo comment o day se lam mat chu trong UI.
        //
        // KHONG giu dong khi inBlock: phan con lai cua comment /* */ van phai
        // bo, neu giu nguyen se con lai ky tu '*' va lam hong file.
        if (inS === BT) {
            out.push(line);
            scanLine(line);
            continue;
        }

        var res = '';
        var j = 0;
        while (j < line.length) {
            var ch = line.charAt(j);
            var two = line.substr(j, 2);

            if (inBlock) {
                if (two === '*/') {
                    inBlock = false; j += 2;
                    if (!keepComment) res += ' ';
                    continue;
                }
                if (keepComment) res += ch;
                j++;
                continue;
            }

            if (inS) {
                res += ch;
                if (ch === BS) { res += line.charAt(j + 1); j += 2; continue; }
                if (ch === inS) inS = null;
                j++;
                continue;
            }

            if (two === '/*') { inBlock = true; j += 2; if (!keepComment) res += ' '; continue; }
            if (two === '//') break;                     // comment den het dong
            if (ch === DQ || ch === SQ || ch === BT) { inS = ch; res += ch; j++; continue; }
            res += ch;
            j++;
        }

        var trimmed = res.trim();
        if (trimmed !== '') out.push(trimmed);
    }

    // Dong comment "dang doi" bo qua - chi xuat hien trong chuoi nhieu dong
    return out.join('\n');

    // Cap nhat trang thai sau moi dong (dung o nhanh template literal)
    function scanLine(ln) {
        var inStr = inS;
        var blk = inBlock;
        for (var k = 0; k < ln.length; k++) {
            var c2 = ln.charAt(k);
            var t2 = ln.substr(k, 2);
            if (blk) { if (t2 === '*/') { blk = false; k++; } continue; }
            if (inStr) {
                if (c2 === BS) { k++; continue; }
                if (c2 === inStr) inStr = null;
                continue;
            }
            if (t2 === '/*') { blk = true; k++; continue; }
            if (t2 === '//') break;                      // comment cuoi dong
            if (c2 === DQ || c2 === SQ || c2 === BT) inStr = c2;
        }
        inS = inStr; inBlock = blk;
    }
}

/**
 * Lam sach CSS: bo comment, gom khoang trang thua, dong het vao 1 dong.
 *
 * PHAI GIU NGUYEN:
 *   - content: "..."  va  content: '...'   (chuoi trong CSS)
 *   - url(...)        (duong dan anh, dau '/' va "http" KHONG phai comment)
 *   - @media, @supports, @keyframes
 *   - dau ',' phai tach duoc; dau ';' cuoi phai con
 */
function minifyCss(code) {
    var out = [];
    var i = 0, n = code.length;
    var inBlock = false;
    while (i < n) {
        var c = code.charAt(i), two = code.substr(i, 2);

        if (inBlock) {
            if (two === '*/') { inBlock = false; i += 2; out.push(' '); }
            else i++;
            continue;
        }
        if (two === '/*') { inBlock = true; i += 2; continue; }

        if (c === DQ || c === SQ) {                 // chuoi trong CSS
            var q = c, s = c; i++;
            while (i < n) {
                var d = code.charAt(i); s += d;
                if (d === BS) { s += code.charAt(i + 1); i += 2; continue; }
                i++;
                if (d === q) break;
            }
            out.push(s);
            continue;
        }

        if (/\s/.test(c)) {                          // gom khoang trang
            var sp = i;
            while (i < n && /\s/.test(code.charAt(i))) i++;
            if (i >= n) break;
            var nx = code.charAt(i), pv = out.length ? out[out.length - 1] : '';
            // khong giu khoang trang quanh dau phay, dau ngoac, dau cham phay
            if (nv(nx)) continue;
            if (nv(pv.charAt(pv.length - 1))) continue;
            out.push(' ');
            continue;
        }

        if (c === '/' && !inBlock) {
            var after = code.substr(i + 1, 1);
            if (after === '/') {                     // comment // (CSS rat hiem)
                while (i < n && code.charAt(i) !== '\n') i++;
                continue;
            }
            // con lai: url(...) hoac phep chia - giu nguyen
            var t3 = code.substr(i, 8);
            if (t3.indexOf('url(') === 0 || (i > 0 && /[)\s]/.test(code.charAt(i - 1)))) {
                out.push(c); i++; continue;
            }
        }

        out.push(c); i++;
    }
    return out.join('');

    function nv(x) { return x === ',' || x === ';' || x === '{' || x === '}' || x === '(' || x === ')'; }
}

// ---------------------------------------------------------------------
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
if (fs.existsSync(CSS_DIR) && !fs.existsSync(CSS_OUT)) fs.mkdirSync(CSS_OUT, { recursive: true });

var keepComment = process.argv.indexOf('--keep') >= 0;
var terser = null;
if (process.argv.indexOf('--minify') >= 0) {
    try { terser = require('terser'); }
    catch (e) { console.log('Khong co terser -> dung lam sach nhe (an toan)'); }
}

var totalBefore = 0, totalAfter = 0;
var built = 0, missing = [], checked = 0, syntaxFail = [];

for (var i = 0; i < FILES.length; i++) {
    var name = FILES[i];
    var srcPath = path.join(POS, name);
    if (!fs.existsSync(srcPath)) { missing.push(name); continue; }

    var src = fs.readFileSync(srcPath, 'utf8');
    var out;

    if (terser) {
        try { out = terser.minify_sync ? terser.minify_sync(src) : src; }
        catch (e) { console.log('  ! terser loi ' + name + ' -> dung lam sach nhe'); out = lightMinify(src, keepComment); }
    } else {
        out = lightMinify(src, keepComment);
    }

    var destName = name.replace(/\.js$/, '.min.js');
    var destPath = path.join(OUT, destName);

    // KIEM TRA CUNG PHAP: ban build phai chay duoc truoc khi ghi de.
    // Neu co file nao hong, dung lai - khong ghi de het.
    var tmp = destPath + '.check.js';
    fs.writeFileSync(tmp, out, 'utf8');
    var okSyntax = true;
    try {
        child.execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
        checked++;
    } catch (e) {
        okSyntax = false;
        syntaxFail.push(name + ' :: ' + String(e.stderr || e.message).split('\n')[0]);
    }
    fs.unlinkSync(tmp);

    if (!okSyntax) { console.log('  !! BO QUA ' + name + ' (file build hong)'); continue; }

    fs.writeFileSync(destPath, out, 'utf8');
    totalBefore += src.length;
    totalAfter += out.length;
    built++;
}

// ---------------------------------------------------------------------
// BUILD CSS: css/*.css -> css.min/*.min.css
// app nap qua <link href="css.min/pos-base.min.css?v=..."> nen CSS cung phai
// build, neu khong sua CSS se khong bao gio len may POS.
var cssBuilt = 0, cssBefore = 0, cssAfter = 0, cssList = [];
if (fs.existsSync(CSS_DIR)) {
    cssList = fs.readdirSync(CSS_DIR).filter(function (f) { return /\.css$/.test(f); }).sort();
    cssList.forEach(function (f) {
        var src = fs.readFileSync(path.join(CSS_DIR, f), 'utf8');
        var out = minifyCss(src);
        fs.writeFileSync(path.join(CSS_OUT, f.replace(/\.css$/, '.min.css')), out, 'utf8');
        cssBuilt++; cssBefore += src.length; cssAfter += out.length;
    });
}

// ---------------------------------------------------------------------
// Tang ?v= de may POS tai lai file moi
var stamp = Date.now();
var idx = fs.readFileSync(INDEX, 'utf8');
var changed = 0;
idx = idx.replace(/js\.min\/([A-Za-z0-9_\-]+)\.min\.js(\?v=\d+)?/g, function (all, base) {
    changed++;
    return 'js.min/' + base + '.min.js?v=' + stamp;
});
// Tang ?v= cho CSS: app nap qua <link href="css.min/....min.css?v=...">
idx = idx.replace(/css\.min\/([A-Za-z0-9_\-]+)\.min\.css(\?v=\d+)?/g, function (all, base) {
    changed++;
    return 'css.min/' + base + '.min.css?v=' + stamp;
});
fs.writeFileSync(INDEX, idx, 'utf8');

// ---------------------------------------------------------------------
console.log('');
console.log('=== BUILD XONG ===');
console.log('  JS da build     : ' + built + '/' + FILES.length + '  (kiem tra cu phap: ' + checked + ')');
if (missing.length) console.log('  THIEU file nguon: ' + missing.join(', '));
if (syntaxFail.length) {
    console.log('  FILE HONG (da giu ban cu):');
    for (var s = 0; s < syntaxFail.length; s++) console.log('    - ' + syntaxFail[s]);
}
console.log('  JS kich thuoc   : ' + (totalBefore / 1024).toFixed(1) + ' KB -> ' + (totalAfter / 1024).toFixed(1) + ' KB');
console.log('  CSS da build    : ' + cssBuilt + '/' + cssList.length + '  ' +
    (cssList.length ? '(' + (cssBefore / 1024).toFixed(1) + ' KB -> ' + (cssAfter / 1024).toFixed(1) + ' KB)' : ''));
console.log('  ?v= moi         : ' + stamp + ' (' + changed + ' the)');
console.log('');
console.log('  index.html van nap js.min/ + css.min/ - KHONG doi.');
console.log('  Nho chay lai "node build.js" sau moi lan sua file nguon (JS hoac CSS).');