// print.js - In hoa don nhiet (Bluetooth InnerPrinter)
// =====================================================
// BO CUC TOI UU: can chinh cot, tiet kiem giay, khong loi font Trung Quoc
// Chi gui ESC/POS bytes qua Bluetooth den InnerPrinter

var PRINT_MODE = 'sunmi';

// ========== UTILS ==========
function formatPrice(amount) {
    if (typeof amount !== 'number') return '0';
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function padRight(str, len) {
    str = str || '';
    while (str.length < len) str += ' ';
    return str;
}

function padLeft(str, len) {
    str = str || '';
    while (str.length < len) str = ' ' + str;
    return str;
}

// Bo dau tieng Viet (tranh chu Trung Quoc)
function removeAccent(str) {
    if (!str) return '';
    var map = {
        'à':'a','á':'a','ả':'a','ã':'a','ạ':'a','ă':'a','ằ':'a','ẳ':'a','ẵ':'a','ặ':'a',
        'â':'a','ầ':'a','ấ':'a','ẩ':'a','ẫ':'a','ậ':'a','è':'e','é':'e','ẻ':'e','ẽ':'e',
        'ẹ':'e','ê':'e','ề':'e','ế':'e','ể':'e','ễ':'e','ệ':'e','ì':'i','í':'i','ỉ':'i',
        'ĩ':'i','ị':'i','ò':'o','ó':'o','ỏ':'o','õ':'o','ọ':'o','ô':'o','ồ':'o','ố':'o',
        'ổ':'o','ỗ':'o','ộ':'o','ơ':'o','ờ':'o','ớ':'o','ở':'o','ỡ':'o','ợ':'o','ù':'u',
        'ú':'u','ủ':'u','ũ':'u','ụ':'u','ư':'u','ừ':'u','ứ':'u','ử':'u','ữ':'u','ự':'u',
        'ỳ':'y','ý':'y','ỷ':'y','ỹ':'y','ỵ':'y','đ':'d',
        'À':'A','Á':'A','Ả':'A','Ã':'A','Ạ':'A','Ă':'A','Ằ':'A','Ẳ':'A','Ẵ':'A','Ặ':'A',
        'Â':'A','Ầ':'A','Ấ':'A','Ẩ':'A','Ẫ':'A','Ậ':'A','È':'E','É':'E','Ẻ':'E','Ẽ':'E',
        'Ẹ':'E','Ê':'E','Ề':'E','Ế':'E','Ể':'E','Ễ':'E','Ệ':'E','Ì':'I','Í':'I','Ỉ':'I',
        'Ĩ':'I','Ị':'I','Ò':'O','Ó':'O','Ỏ':'O','Õ':'O','Ọ':'O','Ô':'O','Ồ':'O','Ố':'O',
        'Ổ':'O','Ỗ':'O','Ộ':'O','Ơ':'O','Ờ':'O','Ớ':'O','Ở':'O','Ỡ':'O','Ợ':'O','Ù':'U',
        'Ú':'U','Ủ':'U','Ũ':'U','Ụ':'U','Ư':'U','Ừ':'U','Ứ':'U','Ử':'U','Ữ':'U','Ự':'U',
        'Ỳ':'Y','Ý':'Y','Ỷ':'Y','Ỹ':'Y','Ỵ':'Y','Đ':'D'
    };
    var result = '';
    for (var i = 0; i < str.length; i++) {
        var c = str[i];
        result += map[c] || c;
    }
    return result;
}

function stringToBytes(str) {
    var cleaned = removeAccent(str);
    var bytes = [];
    for (var i = 0; i < cleaned.length; i++) {
        var code = cleaned.charCodeAt(i);
        if (code < 128) bytes.push(code);
        else bytes.push(63); // '?'
    }
    return bytes;
}

function escLinesToBytes(lines) {
    var bytes = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (typeof line === 'string') {
            var asciiBytes = stringToBytes(line);
            for (var j = 0; j < asciiBytes.length; j++) bytes.push(asciiBytes[j]);
            bytes.push(0x0A);
        } else if (Array.isArray(line)) {
            for (var j = 0; j < line.length; j++) bytes.push(line[j]);
        }
    }
    return bytes;
}

function bytesToBase64(bytes) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var result = '';
    var i = 0;
    var len = bytes.length;
    while (i < len) {
        var remaining = len - i;
        if (remaining >= 3) {
            var a = bytes[i++], b = bytes[i++], c = bytes[i++];
            result += chars.charAt(a >>> 2) +
                      chars.charAt(((a & 3) << 4) | (b >>> 4)) +
                      chars.charAt(((b & 15) << 2) | (c >>> 6)) +
                      chars.charAt(c & 63);
        } else if (remaining === 2) {
            var a = bytes[i++], b = bytes[i++];
            result += chars.charAt(a >>> 2) +
                      chars.charAt(((a & 3) << 4) | (b >>> 4)) +
                      chars.charAt((b & 15) << 2) + '=';
        } else {
            var a = bytes[i++];
            result += chars.charAt(a >>> 2) +
                      chars.charAt((a & 3) << 4) + '==';
        }
    }
    return result;
}

// ========== XAY DUNG HOA DON (80mm - 42 ky tu font A) ==========
var PW = 42; // 80mm: 42 ky tu font A (12x24)

function buildReceiptESC(data) {
    var lines = [];

    // Reset
    lines.push([0x1B, 0x40]);                 // ESC @

    // ===== HEADER: can giua, in dam =====
    lines.push([0x1B, 0x61, 0x01]);           // ESC a 1 (center)
    lines.push([0x1B, 0x45, 0x01]);           // ESC E 1 (bold ON)

    if (data.storeName) {
        // Ten cua hang: font to (double height)
        lines.push([0x1B, 0x21, 0x10]);       // ESC ! 0x10 (double height)
        lines.push(removeAccent(data.storeName));
        lines.push([0x1B, 0x21, 0x00]);       // ESC ! 0x00 (normal)
    }

    lines.push([0x1B, 0x45, 0x00]);           // ESC E 0 (bold OFF)
    lines.push([0x1B, 0x61, 0x00]);           // ESC a 0 (left)

    if (data.storeAddress) lines.push(removeAccent(data.storeAddress));
    if (data.storePhone) lines.push('Tel: ' + data.storePhone);

    lines.push(''); // dong trong

    // ===== THONG TIN DON =====
    lines.push([0x1B, 0x61, 0x00]);           // left

    // Loai don + ban
    var orderInfo = '';
    if (data.orderType === 'dinein') {
        orderInfo = 'Ban: ' + (data.tableName ? removeAccent(data.tableName) : '???');
    } else if (data.orderType === 'takeaway') orderInfo = 'Mang di';
    else if (data.orderType === 'grab') orderInfo = 'Grab';
    else if (data.orderType === 'debt_payment') orderInfo = 'Ghi no';
    else orderInfo = 'Tai cho';
    lines.push(orderInfo);

    if (data.customerName) lines.push('Khach: ' + removeAccent(data.customerName));

    // Gio vao - gio ra
    var timeStr = '';
    if (data.startTime) timeStr += data.startTime;
    if (data.endTime) timeStr += ' - ' + data.endTime;
    if (data.tableTime) timeStr += '  (' + data.tableTime + ')';
    if (timeStr) lines.push(timeStr);

    lines.push('');

    // ===== DANH SACH MON =====
    // Duong ke
    var sep = repeatChar('-', PW);
    lines.push(sep);

    // Header cot: Ten mon (22) | SL (4) | Don gia (8) | T.tien (8)
    lines.push([0x1B, 0x45, 0x01]); // bold ON
    lines.push(padRight('Ten mon', 22) + padLeft('SL', 4) + padLeft('Don gia', 8) + padLeft('T.tien', 8));
    lines.push([0x1B, 0x45, 0x00]); // bold OFF

    if (data.items && data.items.length > 0) {
        for (var i = 0; i < data.items.length; i++) {
            var item = data.items[i];
            var name = removeAccent(item.name || '');
            var qty = item.quantity || 1;
            var price = item.price || 0;
            var total = qty * price;

            // Cat ten mon neu qua dai
            if (name.length > 22) name = name.substring(0, 19) + '...';

            // Dong mon chinh
            lines.push(padRight(name, 22) + padLeft(qty.toString(), 4) + padLeft(formatPrice(price), 8) + padLeft(formatPrice(total), 8));
        }
    } else if (data.text) {
        lines.push(removeAccent(data.text));
    }

    lines.push(sep);

    // ===== TONG TIEN =====
    if (data.totalAmount) {
        lines.push([0x1B, 0x45, 0x01]); // bold ON
        lines.push(padLeft('Tong cong: ' + formatPrice(data.totalAmount), PW));
        lines.push([0x1B, 0x45, 0x00]); // bold OFF
    }

    if (data.paymentMethod) {
        var method = '';
        if (data.paymentMethod === 'cash') method = 'Tien mat';
        else if (data.paymentMethod === 'transfer') method = 'Chuyen khoan';
        else if (data.paymentMethod === 'grab') method = 'Grab';
        else if (data.paymentMethod === 'debt') method = 'Ghi no';
        else method = data.paymentMethod;
        lines.push(padLeft('Thanh toan: ' + method, PW));
    }

    if (data.changeAmount && data.changeAmount > 0) {
        lines.push(padLeft('Tien thua: ' + formatPrice(data.changeAmount), PW));
    }

    lines.push('');

    // ===== CAM ON =====
    lines.push([0x1B, 0x61, 0x01]); // center
    lines.push([0x1B, 0x45, 0x01]); // bold ON
    lines.push('Cam on quy khach!');
    lines.push([0x1B, 0x45, 0x00]); // bold OFF
    lines.push([0x1B, 0x61, 0x00]); // left

    // Ngay gio
    if (data.date) {
        var d2 = new Date(data.date);
        var day = d2.getDate(), mon = d2.getMonth() + 1, year = d2.getFullYear();
        var h2 = d2.getHours(), m2 = d2.getMinutes();
        if (day < 10) day = '0' + day;
        if (mon < 10) mon = '0' + mon;
        if (h2 < 10) h2 = '0' + h2;
        if (m2 < 10) m2 = '0' + m2;
        var dateStr = day + '/' + mon + '/' + year + ' ' + h2 + ':' + m2;
        lines.push([0x1B, 0x61, 0x01]); // center
        lines.push(dateStr);
        lines.push([0x1B, 0x61, 0x00]); // left
    }

    // QR Code (neu co)
    if (data.qrCode) {
        lines.push('');
        var qrContent = data.qrCode;
        var qrLen = qrContent.length + 3;
        lines.push([0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
        lines.push([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x08]);
        var pL = qrLen & 0xFF;
        var pH = (qrLen >> 8) & 0xFF;
        var storeCmd = [0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30];
        for (var qi = 0; qi < qrContent.length; qi++) {
            storeCmd.push(qrContent.charCodeAt(qi));
        }
        lines.push(storeCmd);
        lines.push([0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
    }

    // Xuong dong + cat giay
    lines.push([0x1B, 0x64, 0x04]); // ESC d 4 (4 line feeds)
    lines.push([0x1D, 0x56, 0x00]); // GS V 0 (full cut)

    return lines;
}

function repeatChar(ch, count) {
    var s = '';
    for (var i = 0; i < count; i++) s += ch;
    return s;
}

// ========== IN QUA SUNMI ==========
function printViaSunmi(data) {
    return new Promise(function(resolve, reject) {
        try {
            var escLines = buildReceiptESC(data);
            var bytes = escLinesToBytes(escLines);
            var base64Data = bytesToBase64(bytes);

            if (typeof Android !== 'undefined' && typeof Android.printSunmi === 'function') {
                var result = Android.printSunmi(base64Data);
                if (result === 'ok') resolve(true);
                else reject(new Error(result));
            } else {
                reject(new Error('Android bridge not available'));
            }
        } catch (e) {
            reject(e);
        }
    });
}

function printReceipt(data) {
    return printViaSunmi(data).then(function() {
        showToast('Da in hoa don', 'success');
        return true;
    }).catch(function(err) {
        console.warn('Print failed:', err);
        showToast('In that bai: ' + (err ? err.message : 'Loi'), 'error');
        return false;
    });
}

function printAfterPayment(paymentData) {
    var shop = (typeof shopInfo !== 'undefined' && shopInfo) ? shopInfo : null;
    var printData = {
        storeName: paymentData.shopName || (shop ? shop.name : null) || 'MILANO COFFEE 259',
        storeAddress: paymentData.shopAddress || (shop ? shop.address : null) || null,
        storePhone: shop ? shop.phone : null,
        qrCode: shop ? shop.qrCode : null,
        orderType: paymentData.orderType || paymentData.type || 'dinein',
        tableName: paymentData.tableName || null,
        customerName: paymentData.customer ? (paymentData.customer.name || null) : null,
        tableTime: paymentData.tableTime || null,
        startTime: paymentData.startTime || null,
        endTime: paymentData.endTime || null,
        items: paymentData.items || [],
        totalAmount: paymentData.amount || 0,
        paymentMethod: paymentData.paymentMethod || 'cash',
        changeAmount: paymentData.changeAmount || 0,
        date: paymentData.createdAt || new Date().toISOString()
    };
    printReceipt(printData);
}

function testSunmiService() {
    if (typeof Android !== 'undefined' && typeof Android.checkSunmiPrinter === 'function') {
        try {
            var info = Android.checkSunmiPrinter();
            var parsed = JSON.parse(info);
            if (parsed.status === 'ok') showToast('May in san sang', 'success');
            else showToast('May in chua ket noi', 'warning');
        } catch (e) {
            showToast('Loi kiem tra may in', 'error');
        }
    } else {
        showToast('Khong co bridge Android', 'error');
    }
}

function autoDetectPrinter() {
    if (typeof Android !== 'undefined' && typeof Android.checkSunmiPrinter === 'function') {
        try {
            var info = Android.checkSunmiPrinter();
            var parsed = JSON.parse(info);
            if (parsed.status === 'ok') PRINT_MODE = 'sunmi';
        } catch (e) {}
    }
}

setTimeout(autoDetectPrinter, 1000);