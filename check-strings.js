// Kiem tra chat luong bo comment: so sanh CHUOI va TEMPLATE giua file nguon
// va file build. CA HAI BEN deu bo comment va deu BO QUA REGEX LITERAL
// (regex chua dau nhay la nguon gay nhieu nham loi truoc day).
//
// Ket luan: neu moi chuoi trong build deu tim thay trong file nguon, va khong
// co chuoi nao doc them, thi bo comment KHONG lam mat ky tu nao.
var fs = require('fs');
var path = require('path');

var FILES = ['db.js', 'auth.js', 'pos-app.js', 'realtime-pos.js', 'ingredients.js',
    'notifications.js', 'order.js', 'tables.js', 'split-transfer-merge.js',
    'customers.js', 'history.js', 'print.js', 'draft-orders.js',
    'fund-reconciliation.js', 'manager-detail.js', 'inventory-manager.js',
    'expense.js', 'telegram.js', 'esp32_audit.js', 'messages.js',
    'employees.js', 'settings.js', 'master-config.js', 'master-user-manager.js'];

var BT = String.fromCharCode(96), SQ = String.fromCharCode(39), DQ = String.fromCharCode(34), BS = String.fromCharCode(92);

/** Regex literal bat dau sau ky tu / tu khoa nay */
var REGEX_OK = /[=(,:[!&|?{};+\-*%^~<>]$/;
var REGEX_KEYWORD = '(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)';

/**
 * Lay noi dung chuoi, bo comment, bo regex literal.
 * @param code  ma nguon
 * @param wantRegex  true = giu regex trong ket qua (de dem)
 */
function layChuoi(code, wantRegex) {
    var res = [];
    var i = 0, n = code.length, inBlock = false;
    var prevSig = '';   // ky tu/tu khoa truoc do, quyet dinh '/' la regex hay chia
    while (i < n) {
        var c = code.charAt(i), two = code.substr(i, 2);

        if (inBlock) { if (two === '*/') { inBlock = false; i += 2; } else i++; continue; }
        if (two === '/*') { inBlock = true; i += 2; continue; }
        if (two === '//') { while (i < n && code.charAt(i) !== '\n') i++; continue; }

        // Regex literal?
        if (c === '/' && (prevSig === '' || REGEX_OK.test(prevSig))) {
            var buf = '/'; i++;
            var inCls = false, done = false;
            while (i < n) {
                var d = code.charAt(i);
                buf += d;
                if (d === BS) { buf += code.charAt(i + 1); i += 2; continue; }
                i++;
                if (d === '[') inCls = true;
                else if (d === ']') inCls = false;
                else if (d === '/' && !inCls) { done = true; break; }
                else if (d === '\n') { done = false; break; }
            }
            if (done) {
                while (i < n && /[gimsuy]/.test(code.charAt(i))) { buf += code.charAt(i); i++; }
                if (wantRegex) res.push('RE:' + buf);
                prevSig = 'X';
                continue;
            }
            // Khong phai regex -> dau '/' cua phep chia
            if (wantRegex) res.push('OP:/');
            prevSig = 'X';
            continue;
        }

        if (c === DQ || c === SQ || c === BT) {
            var q = c, s = c; i++;
            while (i < n) {
                var e = code.charAt(i);
                s += e;
                if (e === BS) { s += code.charAt(i + 1); i += 2; continue; }
                i++;
                if (e === q) break;
            }
            res.push(s);
            prevSig = 'X';
            continue;
        }

        // Chu / so: nho lai de biet '/' sau day co phai regex khong
        if (/[A-Za-z_$À-ỹ]/.test(c)) {
            var w = '';
            while (i < n && /[A-Za-z0-9_$À-ỹ]/.test(code.charAt(i))) { w += code.charAt(i); i++; }
            prevSig = new RegExp(REGEX_KEYWORD + '$').test(w) ? w + ' ' : 'X';
            continue;
        }
        if (/\s/.test(c)) { i++; continue; }
        prevSig = c;
        i++;
    }
    return res;
}

var tong = 0, loi = 0, tongChuoi = 0, mat = 0, them = 0;
for (var i = 0; i < FILES.length; i++) {
    var src = fs.readFileSync(path.join(__dirname, '.', FILES[i]), 'utf8');
    var bld = fs.readFileSync(path.join(__dirname, 'js.min', FILES[i].replace(/\.js$/, '.min.js')), 'utf8');
    var a = layChuoi(src, true), b = layChuoi(bld, true);
    tongChuoi += a.length;

    var bs = {}, k;
    for (k = 0; k < b.length; k++) bs[b[k]] = (bs[b[k]] || 0) + 1;

    var thieu = [];
    for (k = 0; k < a.length; k++) {
        if (bs[a[k]] > 0) { bs[a[k]]--; continue; }
        thieu.push(a[k]);
    }
    var du = [];
    for (k in bs) if (bs[k] > 0) for (var q2 = 0; q2 < bs[k]; q2++) du.push(k);

    if (thieu.length || du.length) {
        loi++;
        console.log('  ' + FILES[i] + ' : mat ' + thieu.length + ', thua ' + du.length);
        for (k = 0; k < Math.min(2, thieu.length); k++) console.log('     MAT : ' + thieu[k].substring(0, 110).replace(/\n/g, '\\n'));
        for (k = 0; k < Math.min(2, du.length); k++) console.log('     THUA: ' + du[k].substring(0, 110).replace(/\n/g, '\\n'));
    }
    mat += thieu.length; them += du.length; tong++;
}

console.log('');
console.log('=== KIEM TRA CHUOI + REGIX ===');
console.log('  File kiem tra : ' + FILES.length);
console.log('  File co lech   : ' + loi);
console.log('  Tong chuoi     : ' + tongChuoi);
console.log('  Mat            : ' + mat);
console.log('  Thua           : ' + them);
if (loi === 0) console.log('  => Giong het. Bo comment KHONG lam mat gi.');