/* =============================================================================
 * BUILD CSS/JS - TAO BAN TOI THUONG CHO MAY POS
 * -----------------------------------------------------------------------------
 * KHONG chay shell (duong dan co khoang trang), dung API cua terser/clean-css
 * truc tiep -> khong loi escape.
 *
 * AN TOAN:
 *  1. KHONG doi ten ham/bien. index.html co 119 inline onclick goi truc tiep
 *     ten ham toan cuc (handleLogin, paymentAtTable, ...). Do minifier doi ten
 *     -> tat ca nut bam chet ngay. -> mang = false.
 *  2. ES5 ONLY (Android 6 / WebView cu): ecma = 5.
 *  3. File goc giu nguyen trong thu muc goc / css/. Ban .min sinh ra o
 *     js.min/ va css.min/ dung de chay.
 *
 * Chay: node build-min.js
 * ============================================================================= */
const fs = require('fs');
const path = require('path');
const { minify } = require(process.env.TEMP + '/opencode/node_modules/terser');
const CleanCSS = require(process.env.TEMP + '/opencode/node_modules/clean-css');
const acorn = require(process.env.TEMP + '/opencode/node_modules/acorn');

const root = __dirname;

function refsOf(htmlFile) {
  const p = path.join(root, htmlFile);
  if (!fs.existsSync(p)) return { js: [], css: [] };
  const src = fs.readFileSync(p, 'utf8');
  const js = [...src.matchAll(/src="([^"]+\.js)(\?[^"]*)?"/g)]
    .map(m => m[1])
    .filter(f => !/^https/.test(f) && fs.existsSync(path.join(root, f)));
  const css = [...src.matchAll(/href="(css\/[^"]+\.css)(\?[^"]*)?"/g)]
    .map(m => m[1])
    .filter(f => fs.existsSync(path.join(root, f)));
  return { js: [...new Set(js)], css: [...new Set(css)] };
}

const { js: JS_FILES, css: CSS_FILES } = refsOf('index.html');

const OUT_JS = path.join(root, 'js.min');
const OUT_CSS = path.join(root, 'css.min');
fs.mkdirSync(OUT_JS, { recursive: true });
fs.mkdirSync(OUT_CSS, { recursive: true });

// DANH SÁCH HÀM HTML GỌI TRỰC TIẾP - phải còn nguyên sau khi nén.
// Lấy tự động từ mọi thẻ onclick="ten(...)" trong các file HTML.
const GLOBAL_FNS = (() => {
  const set = new Set();
  ['index.html', 'mangdi.html', 'pos.html', 'takeaway.html'].forEach(function (h) {
    const p = path.join(root, h);
    if (!fs.existsSync(p)) return;
    const src = fs.readFileSync(p, 'utf8');
    const re = /on(?:click|change|input|keydown|load)\s*=\s*"([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let m;
    while ((m = re.exec(src))) set.add(m[1]);
  });
  return [...set];
})();
console.log('So ham HTML goi truc tiep can bao toan: ' + GLOBAL_FNS.length);
console.log('');

const kb = n => (n / 1024).toFixed(1) + ' KB';

// Xác định mức ES mà file GỐC thực sự cần (đo bằng acorn, không đoán).
// Lý do: không phải file nào cũng là ES5. employees.js dùng optional chaining
// "?." (ES2020) - đã chạy được trên máy khách nên WebView của họ là bản
// hiện đại. Ép tất cả về ES5 là sai lệch với thực tế.
// Nguyên tắc: bản .min KHÔNG được dùng cú pháp mới hơn bản gốc.
const ES_LEVELS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
                   2020, 2021, 2022, 2023, 2024];
function parseAt(code, v) {
  try {
    acorn.parse(code, {
      ecmaVersion: v,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    });
    return true;
  } catch (e) { return false; }
}
function requiredLevel(code) {
  for (const v of ES_LEVELS) if (parseAt(code, v)) return v;
  return null;
}

// Đảm bảo bản nén không dùng cú pháp mới hơn bản gốc
function assertNotNewer(code, srcLevel, label) {
  if (!parseAt(code, srcLevel)) {
    throw new Error('nen xong khong parse duoc o muc cua file goc');
  }
}

(async function main() {
  let jsB = 0, jsA = 0, jsBad = 0;
  const okOutputs = [];
  const esNewer = [];
  console.log('=== MINIFY JS ===');
  for (const f of JS_FILES) {
    const code = fs.readFileSync(path.join(root, f), 'utf8');
    const out = path.join(OUT_JS, path.basename(f, '.js') + '.min.js');
    const lvl = requiredLevel(code);
    if (lvl === null) throw new Error('file goc khong parse duoc o bat ky muc ES');
    try {
      const res = await minify(code, {
        ecma: lvl,
        compress: {
          ecma: 5, passes: 2,
          drop_console: false,     // giữ log, tôi còn dùng để chẩn đoán
          drop_debugger: true,
          // !!! QUAN TRỌNG
          // keep_fnames: giữ tên hàm.
          // unused: false: KHÔNG xoá biến/hàm "không dùng".
          // Lý do: có hàm CHỈ được HTML gọi qua onclick, JS không tham chiếu
          // (vd showManagerEmployeeDetail). Terser mặc định coi là biến chết
          // và xoá hẳn -> nút bấm đó chết im lặng trên máy khách.
          keep_fnames: true,
          unused: false
        },
        mangle: false,              // !!! TUYET DOI KHONG doi ten ham toan cuc
        format: { ecma: 5, comments: false }
      });
      if (!res || !res.code) throw new Error('khong co ket qua');
      try { assertNotNewer(res.code, lvl, f); } catch (e) { throw new Error(e.message); }
      fs.writeFileSync(out, res.code, 'utf8');
      okOutputs.push(res.code);
      if (lvl !== 5) esNewer.push(f + ' (can ' + lvl + ')');
      const a = res.code.length;
      jsB += Buffer.byteLength(code); jsA += a;
      console.log('   ' + f.padEnd(26) + kb(Buffer.byteLength(code)).padStart(9) +
                  ' -> ' + kb(a).padStart(9) + '  (' +
                  Math.round((1 - a / Buffer.byteLength(code)) * 100) + '%)');
    } catch (e) {
      jsBad++;
      console.log('   ' + f.padEnd(26) + 'LOI [' + e.message + '] - GIU NGUYEN BAN GOC');
    }
  }

  console.log('');
  console.log('=== MINIFY CSS ===');
  let cB = 0, cA = 0, cBad = 0;
  for (const f of CSS_FILES) {
    const code = fs.readFileSync(path.join(root, f), 'utf8');
    const out = path.join(OUT_CSS, path.basename(f, '.css') + '.min.css');
    try {
      const r = new CleanCSS({ level: 2, format: 'breaks=after-comma' }).minify(code);
      if (r.errors && r.errors.length) throw new Error(r.errors[0]);
      const o = r.styles;
      const ob = (o.match(/\{/g) || []).length, cb = (o.match(/\}/g) || []).length;
      if (ob !== cb) throw new Error('ngoac khong can bang ' + ob + '/' + cb);
      fs.writeFileSync(out, o, 'utf8');
      cB += Buffer.byteLength(code); cA += Buffer.byteLength(o);
      console.log('   ' + f.padEnd(26) + kb(Buffer.byteLength(code)).padStart(9) +
                  ' -> ' + kb(Buffer.byteLength(o)).padStart(9) + '  (' +
                  Math.round((1 - Buffer.byteLength(o) / Buffer.byteLength(code)) * 100) + '%)');
    } catch (e) {
      cBad++;
      console.log('   ' + f.padEnd(26) + 'LOI [' + e.message + ']');
    }
  }

  console.log('');
  console.log('=== KIEM TRA HAM TOAN CUC (HTML goi truc tiep) ===');
  // Bundle THUC SU se chay: ban .min cho file nen duoc, ban goc cho file loi.
  const bundle = [];
  JS_FILES.forEach(function (f) {
    const mn = path.join(OUT_JS, path.basename(f, '.js') + '.min.js');
    if (fs.existsSync(mn)) bundle.push(fs.readFileSync(mn, 'utf8'));
    else bundle.push(fs.readFileSync(path.join(root, f), 'utf8'));
  });
  const allMin = bundle.join('\n');
  const missingFns = GLOBAL_FNS.filter(function (n) {
    const re = new RegExp('(^|[;{}\\s])' + n + '\\s*(=)?\\s*(function|\\()|window\\.' + n + '\\s*=');
    return !re.test(allMin);
  });
  if (missingFns.length === 0) {
    console.log('   OK - tat ca ' + GLOBAL_FNS.length + ' ham deu con nguyen');
  } else {
    console.log('   !! KHONG CO ' + missingFns.length + ' ham (trong ' + missingFns.length +
                ' ham ma HTML goi):');
    console.log('      ' + missingFns.join(', '));
    console.log('   -> Day la LOI CO SAN trong HTML (goi ham khong ton tai),');
    console.log('      KHONG phai do minifier. Ban .min van dung duoc.');
  }
  if (esNewer.length) {
    console.log('');
    console.log('   Luu y: ' + esNewer.length + ' file goi muc ES cao hon ES5:');
    esNewer.forEach(x => console.log('      ' + x));
  }
  console.log('');
  console.log('==========================================');
  console.log('JS : ' + kb(jsB) + ' -> ' + kb(jsA) + '   giam ' + Math.round((1 - jsA / jsB) * 100) + '%');
  console.log('CSS: ' + kb(cB) + ' -> ' + kb(cA) + '   giam ' + Math.round((1 - cA / cB) * 100) + '%');
  console.log('TOT: ' + kb(jsB + cB) + ' -> ' + kb(jsA + cA) + '   giam ' +
              Math.round((1 - (jsA + cA) / (jsB + cB)) * 100) + '%');
  if (jsBad) console.log('!! ' + jsBad + ' file JS loi');
  if (cBad) console.log('!! ' + cBad + ' file CSS loi');
  console.log('==========================================');
})();