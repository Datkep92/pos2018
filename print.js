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
    else if (data.orderType === 'debt_payment') orderInfo = 'Tra sau';
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
        var now = new Date();
        var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        for (var i = 0; i < data.items.length; i++) {
            var item = data.items[i];
            var name = removeAccent(item.name || '');
            var qty = item.qty || item.quantity || 1;
            var price = item.price || 0;
            var total = qty * price;

            // Cat ten mon neu qua dai
            if (name.length > 22) name = name.substring(0, 19) + '...';

            // Dong mon chinh
            lines.push(padRight(name, 22) + padLeft(qty.toString(), 4) + padLeft(formatPrice(price), 8) + padLeft(formatPrice(total), 8));

            // Hien thi gio them mon + ngay neu khac ngay
            if (item.addedTime) {
                var d = new Date(item.addedTime);
                var hh = d.getHours(), mm = d.getMinutes();
                if (hh < 10) hh = '0' + hh;
                if (mm < 10) mm = '0' + mm;
                var timeStr = hh + ':' + mm;
                if (d < todayStart) {
                    var day = d.getDate(), mon = d.getMonth() + 1;
                    if (day < 10) day = '0' + day;
                    if (mon < 10) mon = '0' + mon;
                    timeStr += ' ' + day + '/' + mon;
                }
                lines.push(padRight('  ' + timeStr, PW));
            }
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
        else if (data.paymentMethod === 'debt') method = 'Tra sau';
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
        storeName: paymentData.shopName || (shop ? shop.name : null) || 'Hệ Thống Bán Hàng',
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

// ========== IN LỊCH SỬ NỢ (THERMAL) ==========
function buildDebtHistoryReceipt(data) {
    var lines = [];
    // Reset
    lines.push([0x1B, 0x40]);                 // ESC @
    // Center + bold
    lines.push([0x1B, 0x61, 0x01]);           // ESC a 1 (center)
    lines.push([0x1B, 0x45, 0x01]);           // ESC E 1 (bold ON)
    if (data.storeName) {
        lines.push([0x1B, 0x21, 0x10]);       // ESC ! 0x10 (double height)
        lines.push(removeAccent(data.storeName));
        lines.push([0x1B, 0x21, 0x00]);       // ESC ! 0x00 (normal)
    }
    lines.push([0x1B, 0x45, 0x00]);           // ESC E 0 (bold OFF)
    lines.push([0x1B, 0x61, 0x00]);           // ESC a 0 (left)
    if (data.storeAddress) lines.push(removeAccent(data.storeAddress));
    if (data.storePhone) lines.push('Tel: ' + data.storePhone);
    lines.push('');
    // Title
    lines.push([0x1B, 0x61, 0x01]);           // center
    lines.push([0x1B, 0x45, 0x01]);           // bold ON
    lines.push('=== LICH SU TRA SAU ===');
    lines.push([0x1B, 0x45, 0x00]);           // bold OFF
    lines.push([0x1B, 0x61, 0x00]);           // left
    if (data.customerName) lines.push('Khach: ' + removeAccent(data.customerName));
    if (data.customerPhone) lines.push('SDT: ' + data.customerPhone);
    if (data.printDate) lines.push('Ngay in: ' + data.printDate);
    lines.push('');
    // Separator
    var sep = repeatChar('-', PW);
    lines.push(sep);
    // Header
    lines.push([0x1B, 0x45, 0x01]); // bold ON
    lines.push(padRight('Ngay', 12) + padRight('Loai', 10) + padLeft('So tien', 10) + padLeft('Con lai', 10));
    lines.push([0x1B, 0x45, 0x00]); // bold OFF
    // Items
    if (data.history && data.history.length > 0) {
        for (var i = 0; i < data.history.length; i++) {
            var h = data.history[i];
            var dateStr = h.dateStr || '';
            var typeLabel = '';
            if (h.type === 'debt') typeLabel = 'Ghi tra sau';
            else if (h.type === 'payment') typeLabel = 'Thanh toan';
            else if (h.type === 'credit') typeLabel = 'Tra du';
            else typeLabel = h.type || '';
            var amountStr = formatPrice(Math.abs(h.amount));
            if (h.type === 'debt') {
                amountStr = '+' + amountStr;
            } else {
                amountStr = '-' + amountStr;
            }
            // Dùng balance từ dữ liệu (đã tính sẵn theo đúng thứ tự)
            var balance = (h.balance !== undefined && h.balance !== null) ? h.balance : 0;
            if (dateStr.length > 12) dateStr = dateStr.substring(0, 10);
            if (typeLabel.length > 10) typeLabel = typeLabel.substring(0, 8) + '.';
            lines.push(padRight(dateStr, 12) + padRight(typeLabel, 10) + padLeft(amountStr, 10) + padLeft(formatPrice(balance), 10));
            // Neu co items, in chi tiet mon
            if (h.items && h.items.length > 0) {
                for (var j = 0; j < h.items.length; j++) {
                    var it = h.items[j];
                    var itName = removeAccent(it.name || '');
                    if (itName.length > 20) itName = itName.substring(0, 17) + '...';
                    var itLine = '  ' + itName + ' x' + (it.qty || 1) + ' = ' + formatPrice((it.price || 0) * (it.qty || 1));
                    lines.push(itLine);
                }
            }
        }
    }
    lines.push(sep);
    // Summary
    lines.push([0x1B, 0x45, 0x01]); // bold ON
    lines.push(padLeft('Tong tra sau: ' + formatPrice(data.totalDebt || 0), PW));
    if (data.creditBalance > 0) {
        lines.push(padLeft('Tien du: ' + formatPrice(data.creditBalance), PW));
        lines.push(padLeft('Con lai: ' + formatPrice(Math.max(0, (data.totalDebt || 0) - (data.creditBalance || 0))), PW));
    }
    lines.push([0x1B, 0x45, 0x00]); // bold OFF
    lines.push('');
    // Footer
    lines.push([0x1B, 0x61, 0x01]); // center
    lines.push([0x1B, 0x45, 0x01]); // bold ON
    lines.push('Cam on quy khach!');
    lines.push([0x1B, 0x45, 0x00]); // bold OFF
    lines.push([0x1B, 0x61, 0x00]); // left
    // Cut
    lines.push([0x1B, 0x64, 0x04]); // ESC d 4 (4 line feeds)
    lines.push([0x1D, 0x56, 0x00]); // GS V 0 (full cut)
    return lines;
}

function printDebtHistoryThermal(data) {
    var escLines = buildDebtHistoryReceipt(data);
    var bytes = escLinesToBytes(escLines);
    var base64Data = bytesToBase64(bytes);
    if (typeof Android !== 'undefined' && typeof Android.printSunmi === 'function') {
        var result = Android.printSunmi(base64Data);
        if (result === 'ok') {
            showToast('Da in lich su no', 'success');
            return true;
        } else {
            showToast('In that bai: ' + result, 'error');
            return false;
        }
    } else {
        showToast('Khong co bridge Android', 'error');
        return false;
    }
}

// ========== XUẤT PDF LỊCH SỬ NỢ ==========
function exportDebtHistoryPdf(data) {
    // Tạo HTML để in / xuất PDF
    var shopName = data.storeName || 'Hệ Thống Bán Hàng';
    var customerName = data.customerName || '';
    var customerPhone = data.customerPhone || '';
    var printDate = data.printDate || '';
    
    var rowsHtml = '';
    if (data.history && data.history.length > 0) {
        for (var i = 0; i < data.history.length; i++) {
            var h = data.history[i];
            var dateStr = h.dateStr || '';
            var typeLabel = '';
            var amountColor = '';
            if (h.type === 'debt') {
                typeLabel = 'Ghi trả sau';
                amountColor = '#ef4444';
            } else if (h.type === 'payment') {
                typeLabel = 'Thanh toán';
                amountColor = '#16a34a';
            } else if (h.type === 'credit') {
                typeLabel = 'Trả dư';
                amountColor = '#f59e0b';
            }
            var amountStr = formatPrice(Math.abs(h.amount));
            var noteStr = h.note ? escapeHtml(h.note) : '';
            // Dùng balance từ dữ liệu (đã tính sẵn theo đúng thứ tự)
            var balance = (h.balance !== undefined && h.balance !== null) ? h.balance : 0;
            
            rowsHtml += '<tr>';
            rowsHtml += '<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;">' + dateStr + '</td>';
            rowsHtml += '<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;">' + typeLabel + '</td>';
            rowsHtml += '<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;color:' + amountColor + ';text-align:right;">' + amountStr + '</td>';
            rowsHtml += '<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;">' + formatPrice(balance) + '</td>';
            rowsHtml += '</tr>';
            
            // Items detail
            if (h.items && h.items.length > 0) {
                for (var j = 0; j < h.items.length; j++) {
                    var it = h.items[j];
                    var itName = escapeHtml(it.name || '');
                    var itTotal = formatPrice((it.price || 0) * (it.qty || 1));
                    rowsHtml += '<tr style="background:#f8fafc;">';
                    rowsHtml += '<td colspan="4" style="padding:2px 8px 2px 24px;border-bottom:1px solid #e2e8f0;font-size:12px;color:#64748b;">';
                    rowsHtml += '• ' + itName + ' <span style="color:#94a3b8;">x' + (it.qty || 1) + '</span> = <span style="color:#334155;">' + itTotal + '</span>';
                    rowsHtml += '</td></tr>';
                }
            }
        }
    }
    
    var totalDebt = data.totalDebt || 0;
    var creditBalance = data.creditBalance || 0;
    var remaining = Math.max(0, totalDebt - creditBalance);
    
    var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
    html += '<title>Lich su tra sau - ' + customerName + '</title>';
    html += '<style>';
    html += 'body { font-family: "DejaVu Sans", Arial, sans-serif; margin: 20px; color: #1e293b; }';
    html += 'h1 { font-size: 18px; text-align: center; margin: 0 0 4px 0; color: #1e293b; }';
    html += 'h2 { font-size: 15px; text-align: center; margin: 0 0 4px 0; color: #475569; font-weight: normal; }';
    html += '.info { text-align: center; font-size: 13px; color: #64748b; margin-bottom: 16px; }';
    html += 'table { width: 100%; border-collapse: collapse; margin-top: 8px; }';
    html += 'th { background: #1e293b; color: #fff; padding: 8px; font-size: 13px; text-align: left; }';
    html += 'th.right { text-align: right; }';
    html += '.summary { margin-top: 12px; text-align: right; font-size: 14px; }';
    html += '.summary-item { margin: 4px 0; }';
    html += '.summary-total { font-weight: bold; font-size: 16px; color: #ef4444; }';
    html += '.footer { text-align: center; margin-top: 24px; font-size: 12px; color: #94a3b8; }';
    html += '@media print { body { margin: 10px; } }';
    html += '</style></head><body>';
    html += '<h1>' + escapeHtml(shopName) + '</h1>';
    html += '<h2>LỊCH SỬ TRẢ SAU</h2>';
    html += '<div class="info">';
    html += 'Khách: <strong>' + escapeHtml(customerName) + '</strong>';
    if (customerPhone) html += ' | SDT: ' + escapeHtml(customerPhone);
    html += '<br>Ngày in: ' + printDate;
    html += '</div>';
    html += '<table><thead><tr>';
    html += '<th>Ngày</th><th>Loại</th><th class="right">Số tiền</th><th class="right">Còn lại</th>';
    html += '</tr></thead><tbody>';
    html += rowsHtml;
    html += '</tbody></table>';
    html += '<div class="summary">';
    html += '<div class="summary-item">Tổng trả sau: <strong>' + formatPrice(totalDebt) + 'đ</strong></div>';
    if (creditBalance > 0) {
        html += '<div class="summary-item">Tiền dư: <strong style="color:#16a34a;">' + formatPrice(creditBalance) + 'đ</strong></div>';
        html += '<div class="summary-item summary-total">Còn lại: ' + formatPrice(remaining) + 'đ</div>';
    }
    html += '</div>';
    html += '<div class="footer">Phần mềm quản lý bán hàng</div>';
    html += '</body></html>';
    
    // Mở cửa sổ in mới
    var printWindow = window.open('', '_blank', 'width=800,height=600');
    if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(function() {
            printWindow.print();
        }, 500);
    } else {
        showToast('Trình duyệt đã chặn cửa sổ popup!', 'error');
}
}

// ========== XUẤT PDF HÓA ĐƠN BÀN ==========
function exportBillPDF(paymentData) {
var shop = (typeof shopInfo !== 'undefined' && shopInfo) ? shopInfo : null;
var storeName = paymentData.shopName || (shop ? shop.name : null) || 'Hệ Thống Bán Hàng';
var storeAddress = paymentData.shopAddress || (shop ? shop.address : null) || '';
var storePhone = shop ? shop.phone : '';

var orderType = paymentData.orderType || 'dinein';
var tableName = paymentData.tableName || '';
var customerName = paymentData.customer ? (paymentData.customer.name || '') : '';
var tableTime = paymentData.tableTime || '';
var startTime = paymentData.startTime || '';
var endTime = paymentData.endTime || '';
var totalAmount = paymentData.amount || 0;
var paymentMethod = paymentData.paymentMethod || '';
var changeAmount = paymentData.changeAmount || 0;
var createdAt = paymentData.createdAt || new Date().toISOString();

// Format ngày giờ
var d = new Date(createdAt);
var day = d.getDate(), mon = d.getMonth() + 1, year = d.getFullYear();
var h = d.getHours(), m = d.getMinutes();
if (day < 10) day = '0' + day;
if (mon < 10) mon = '0' + mon;
if (h < 10) h = '0' + h;
if (m < 10) m = '0' + m;
var dateStr = day + '/' + mon + '/' + year + ' ' + h + ':' + m;

// Phương thức thanh toán
var methodLabel = '';
if (paymentMethod === 'cash') methodLabel = 'Tiền mặt';
else if (paymentMethod === 'transfer') methodLabel = 'Chuyển khoản';
else if (paymentMethod === 'debt') methodLabel = 'Trả sau';
else if (paymentMethod === 'grab') methodLabel = 'Grab';
else if (paymentMethod === 'manual_print') methodLabel = 'In thủ công';
else methodLabel = paymentMethod;

// Danh sách món
var itemsHtml = '';
var items = paymentData.items || [];
var now = new Date();
var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
for (var i = 0; i < items.length; i++) {
var item = items[i];
var itemName = escapeHtml(item.name || '');
var qty = item.qty || 1;
var price = item.price || 0;
var total = qty * price;
// Hiển thị giờ thêm món + ngày nếu khác ngày
var timeLabel = '';
if (item.addedTime) {
    var d = new Date(item.addedTime);
    var hh = d.getHours(), mm = d.getMinutes();
    if (hh < 10) hh = '0' + hh;
    if (mm < 10) mm = '0' + mm;
    timeLabel = hh + ':' + mm;
    if (d < todayStart) {
        var day = d.getDate(), mon = d.getMonth() + 1;
        if (day < 10) day = '0' + day;
        if (mon < 10) mon = '0' + mon;
        timeLabel += ' ' + day + '/' + mon;
    }
}
itemsHtml += '<tr>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;">' + itemName + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:center;">' + qty + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;">' + formatPrice(price) + '</td>' +
    '<td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:13px;text-align:right;font-weight:600;">' + formatPrice(total) + '</td>' +
'</tr>';
// Dòng phụ hiển thị giờ gọi món
if (timeLabel) {
    itemsHtml += '<tr style="background:#f8fafc;">' +
        '<td colspan="4" style="padding:2px 8px 6px 8px;border-bottom:1px solid #e2e8f0;font-size:11px;color:#94a3b8;">🕐 ' + timeLabel + '</td>' +
    '</tr>';
}
}

// Thông tin order
var orderInfo = '';
if (orderType === 'dinein') orderInfo = 'Bàn: ' + escapeHtml(tableName);
else if (orderType === 'takeaway') orderInfo = 'Mang đi';
else if (orderType === 'grab') orderInfo = 'Grab';
else orderInfo = 'Tại chỗ';

var timeInfo = '';
if (startTime) timeInfo += 'Giờ vào: ' + startTime;
if (endTime) timeInfo += ' | Giờ ra: ' + endTime;
if (tableTime) timeInfo += ' (' + tableTime + ')';

var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
html += '<title>Hoa don - ' + escapeHtml(tableName) + '</title>';
html += '<style>';
html += 'body { font-family: "DejaVu Sans", Arial, sans-serif; margin: 30px; color: #1e293b; }';
html += '.header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #1e293b; padding-bottom: 12px; }';
html += '.header h1 { font-size: 20px; margin: 0 0 4px 0; color: #1e293b; }';
html += '.header .sub { font-size: 13px; color: #64748b; }';
html += '.info-row { display: flex; justify-content: space-between; font-size: 13px; color: #475569; margin: 4px 0; }';
html += 'table { width: 100%; border-collapse: collapse; margin-top: 12px; }';
html += 'th { background: #1e293b; color: #fff; padding: 8px; font-size: 13px; text-align: left; }';
html += 'th.right { text-align: right; }';
html += 'th.center { text-align: center; }';
html += '.summary { margin-top: 16px; text-align: right; font-size: 15px; }';
html += '.summary .total { font-weight: bold; font-size: 18px; color: #f97316; }';
html += '.summary .method { font-size: 13px; color: #64748b; margin-top: 4px; }';
html += '.footer { text-align: center; margin-top: 32px; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }';
html += '@media print { body { margin: 10px; } }';
html += '</style></head><body>';
html += '<div class="header">';
html += '<h1>' + escapeHtml(storeName) + '</h1>';
if (storeAddress) html += '<div class="sub">' + escapeHtml(storeAddress) + '</div>';
if (storePhone) html += '<div class="sub">Tel: ' + escapeHtml(storePhone) + '</div>';
html += '</div>';
html += '<div class="info-row"><span><strong>' + orderInfo + '</strong></span><span>' + dateStr + '</span></div>';
if (customerName) html += '<div class="info-row"><span>Khách: <strong>' + escapeHtml(customerName) + '</strong></span></div>';
if (timeInfo) html += '<div class="info-row"><span>' + timeInfo + '</span></div>';
html += '<table><thead><tr>';
html += '<th>Tên món</th><th class="center">SL</th><th class="right">Đơn giá</th><th class="right">Thành tiền</th>';
html += '</tr></thead><tbody>';
html += itemsHtml;
html += '</tbody></table>';
html += '<div class="summary">';
html += '<div class="total">Tổng cộng: ' + formatPrice(totalAmount) + 'đ</div>';
html += '<div class="method">Thanh toán: ' + methodLabel + '</div>';
if (changeAmount > 0) html += '<div class="method">Tiền thừa: ' + formatPrice(changeAmount) + 'đ</div>';
html += '</div>';
html += '<div class="footer">Phần mềm quản lý bán hàng ' + escapeHtml(storeName) + '</div>';
html += '</body></html>';

// Mở cửa sổ in mới
var printWindow = window.open('', '_blank', 'width=800,height=600');
if (printWindow) {
printWindow.document.write(html);
printWindow.document.close();
printWindow.focus();
setTimeout(function() {
    printWindow.print();
}, 500);
} else {
showToast('Trình duyệt đã chặn cửa sổ popup!', 'error');
}
}