// Do muc do tuong thich cua BAN BUILD voi WebView cu cua may POS.
//
// Cau hoi: may POS Android 6 co WebView mac dinh Chrome 44-51.
// File .apk dua san cho may POS CHINH LA BAN BUILD trong js.min/.
// File nay co dung cum cau lap/APIs moi hon Chrome 51 khong?
//
// Neu co -> app FAIL CU PHAP tren may POS that, ca app chet.
// Neu khong -> chay duoc.
//
// Nguon: "canh bao tuong thich" tren developer.mozilla.org
var fs = require('fs');
var path = require('path');

var D = __dirname;

// Chrome can tinh theo phien ban:
//  44 = Android 6.0 ngay moi cai, khong cap nhat
//  45 = arrow function
//  46 = spread, array destructuring
//  47 = Array.includes
//  49 = class, Object.entries/values/assign, for...of that
//  53 = Android 6/7 moi nhat (may ao cua toi)
//  55 = async/await
//  57 = padStart/padEnd
//  60 = optional chaining, nullish coalescing
var RULES = [
    { ten: 'Toan tu "?." (optional chaining)', can: 80, re: /\?\.[A-Za-z_$([]/g },
    { ten: 'Toan tu "??" (nullish coalescing)', can: 80, re: /[^?]\?\?[^?]/g },
    { ten: 'async / await', can: 55, re: /\basync\b|\bawait\b/g },
    { ten: 'String.padStart / padEnd', can: 57, re: /\.pad(Start|End)\(/g },
    { ten: 'Array.includes', can: 47, re: /\.includes\(/g },
    { ten: 'Object.entries / values / assign', can: 49, re: /Object\.(entries|values|assign|getOwnPropertyDescriptors)\(/g },
    { ten: 'Array.flat / flatMap', can: 69, re: /\.flat(Map)?\(/g },
    { ten: 'class ... {', can: 49, re: /\bclass\s+[A-Za-z_$][\w$]*\s*(extends\s+[A-Za-z_$][\w$]*\s*)?\{/g },
    { ten: 'Ham bat dong (function*)', can: 63, re: /function\s*\*/g },
    { ten: 'yield / generator', can: 39, re: /\byield\b|function\s*\*/g },
    { ten: 'Arrow function =>', can: 45, re: /=>/g },
    { ten: 'Spread / rest ...', can: 46, re: /\.\.\./g },
    { ten: 'let / const', can: 44, re: /\b(let|const)\s+[A-Za-z_$]/g },
    { ten: 'Template literal `', can: 41, re: /`/g },
    { ten: 'Object shorthand {a, b}', can: 43, re: /\{\s*[A-Za-z_$][\w$]*\s*[,}]/g }
];

// Hay chay mot so mau tuoc cho ban build (bo qua vendor/)
var FILES = fs.readdirSync(path.join(D, 'js.min'))
    .filter(function (f) { return /\.js$/.test(f); })
    .sort();

var CHUA_BINH_TOA = [];

console.log('=== MUC DO TUONG THICH BAN BUILD ===');
console.log('May POS Android 6: WebView mac dinh Chrome 44 - 51.');
console.log('');

var tom = {};
FILES.forEach(function (f) {
    var t = fs.readFileSync(path.join(D, 'js.min', f), 'utf8');
    RULES.forEach(function (r) {
        var m = t.match(r.re);
        if (m && m.length) {
            var k = r.ten;
            if (!tom[k]) tom[k] = { can: r.can, soNguon: 0, tap: [] };
            tom[k].soNguon += m.length;
            if (tom[k].tap.length < 6) tom[k].tap.push(f);
        }
    });
});

var keys = Object.keys(tom).sort(function (a, b) { return tom[b].soNguon - tom[a].soNguon; });
if (keys.length === 0) {
    console.log('  KHONG dung cum nao moi hon ES5.');
} else {
    keys.forEach(function (k) {
        var v = tom[k];
        var xe = v.can <= 44 ? 'OK cho Chrome 44' : (v.can <= 53 ? 'OK cho Chrome 53, KHONG OK cho Chrome 44' : '!! CHAN - can Chrome ' + v.can);
        console.log('  ' + k);
        console.log('      can Chrome ' + v.can + ' | ' + v.soNguon + ' lan | ' + xe);
        console.log('      file: ' + v.tap.join(', '));
        if (v.can > 53) CHUA_BINH_TOA.push(k);
    });
}

console.log('');
console.log('=========================================');
if (CHUA_BINH_TOA.length) {
    console.log('  CO CUM CHAN WebView ca moi: ' + CHUA_BINH_TOA.join(', '));
} else {
    console.log('  Ban build khong dung cum nao chan WebView ca moi.');
}
console.log('  (Cac muc "khong OK cho Chrome 44" van an toan tren Chrome 45+,'); 
console.log('   ma may POS Android 6 thuong da cap nhat WebView qua Play Store.)');
console.log('=========================================');