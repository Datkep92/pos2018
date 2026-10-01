/* =============================================================================
 * DOI DUONG DAN TRONG HTML SANG BAN .MIN
 * -----------------------------------------------------------------------------
 * - File goc (js/, .js va css/*.css) GIU NGUYEN - dung de sua code.
 * - HTML tro sang js.min/ va css.min/.
 * - Tu them ?v=<timestamp> de trinh duyet khong dung ban cu.
 * - Co the chay lai nhieu lan; dung thu muc ban goc neu kiem tra nguoi dung.
 *
 * Cach dung nhanh quay lai ban goc:
 *   node build-min.js --dev
 *
 * Chay: node build-min.js
 * ============================================================================= */
const fs = require('fs');
const path = require('path');
const root = __dirname;

const DEV = process.argv.includes('--dev');
const HTMLS = ['index.html', 'mangdi.html', 'pos.html', 'takeaway.html'];

const STAMP = Date.now().toString();

function convert(html, file) {
  let src = fs.readFileSync(html, 'utf8');
  const before = src;

  // Chuẩn hoá: lần chạy trước có thể đã ghi dấu gạch ngược (Windows).
  // Trong URL phải dùng gạch xuong.
  src = src.replace(/js\.min\\/g, 'js.min/');

  if (DEV) {
    // -> ve ban goc: bo .min, bo ?v=, va gach xuong -> dau gach ngan
    src = src.replace(/src="js\.min\/([^"]+)\.min\.js(?:\?v=\d+)?"/g, 'src="$1.js"');
    src = src.replace(/href="css\.min\/([^"]+)\.min\.css(?:\?v=\d+)?"/g, 'href="css/$1.css"');
    src = src.replace(/src="([^"]+)\.js\?v=\d+"/g, 'src="$1.js"');
    src = src.replace(/href="([^"]+)\.css\?v=\d+"/g, 'href="$1.css"');
  } else {
    // -> sang ban min
    src = src.replace(/src="(?!https)([A-Za-z0-9._-]+)\.js(\?v=\d*)?"/g,
      function (m, name, q) {
        const out = 'js.min/' + name + '.min.js';   // LUON dung dau gach xuong
        if (!fs.existsSync(path.join(root, out))) return m;   // khong co ban min -> giu nguyen
        return 'src="' + out + '?v=' + STAMP + '"';
      });
    src = src.replace(/href="css\/([^"]+)\.css(\?v=\d*)?"/g,
      function (m, name, q) {
        const out = 'css.min/' + name + '.min.css';
        if (!fs.existsSync(path.join(root, out))) return m;
        return 'href="' + out + '?v=' + STAMP + '"';
      });
  }

  if (src !== before) {
    fs.writeFileSync(html, src, 'utf8');
    console.log('   ' + file + ': da doi');
  } else {
    console.log('   ' + file + ': khong thay doi gi');
  }
}

console.log(DEV ? '=== CHUYEN VE BAN GOC (dev) ===' : '=== CHUYEN SANG BAN MIN (production) ===');
HTMLS.forEach(function (h) {
  const p = path.join(root, h);
  if (fs.existsSync(p)) convert(p, h);
});
console.log('');
console.log('Nho chay "node build-min.js" TRUOC khi chuyen sang ban min.');
console.log('Quay lai ban goc: node build-min.js --dev');