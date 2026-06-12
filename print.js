// print.js - In hoa don nhiet (Bluetooth InnerPrinter)
// =====================================================
// Chi gui ESC/POS bytes qua Bluetooth den InnerPrinter (00:11:22:33:44:55)
// 
// Luong in:
//   1. JS tao ESC/POS bytes hoan chinh (buildReceiptESC)
//   2. JS chuyen bytes -> Base64 (bytesToBase64, KHONG dung btoa)
//   3. JS gui qua Android.printSunmi(base64Data)
//   4. Java decode Base64 -> gui qua BluetoothSocket -> InnerPrinter

var PRINT_MODE = 'sunmi';

// ========== BUILD ESC/POS DATA ==========

function buildReceiptESC(data) {
    var lines = [];
    
    // Initialize printer
    lines.push([0x1B, 0x40]); // ESC @
    
    // Center align
    lines.push([0x1B, 0x61, 0x01]); // ESC a 1
    
    // Bold on
    lines.push([0x1B, 0x45, 0x01]); // ESC E 1
    
    // Store name
    if (data.storeName) {
        lines.push(data.storeName);
    }
    
    // Bold off
    lines.push([0x1B, 0x45, 0x00]); // ESC E 0
    
    // Store address
    if (data.storeAddress) {
        lines.push(data.storeAddress);
    }
    
    // Separator
    lines.push('========================');
    
    // Left align
    lines.push([0x1B, 0x61, 0x00]); // ESC a 0
    
    // Items
    if (data.items && data.items.length > 0) {
        for (var i = 0; i < data.items.length; i++) {
            var item = data.items[i];
            var name = item.name || '';
            var qty = item.quantity || 1;
            var price = item.price || 0;
            var total = qty * price;
            
            if (name.length > 20) name = name.substring(0, 20);
            lines.push(name);
            lines.push('  x' + qty + '    ' + formatPrice(price) + '    ' + formatPrice(total));
        }
    } else if (data.text) {
        lines.push(data.text);
    }
    
    // Separator
    lines.push('========================');
    
    // Total
    if (data.totalAmount) {
        lines.push('Tong cong:    ' + formatPrice(data.totalAmount));
    }
    if (data.paymentMethod) {
        lines.push('Thanh toan:   ' + data.paymentMethod);
    }
    if (data.changeAmount) {
        lines.push('Tien thua:    ' + formatPrice(data.changeAmount));
    }
    
    // Footer
    lines.push('');
    lines.push('Cam on quy khach!');
    if (data.date) {
        lines.push(data.date);
    }
    
    // Feed 3 lines
    lines.push([0x1B, 0x64, 0x03]); // ESC d 3
    
    // Cut paper (full cut)
    lines.push([0x1D, 0x56, 0x00]); // GS V 0
    
    return lines;
}

/**
 * Chuyen string thanh mang bytes ASCII (0-127).
 * Ky tu > 127 (tieng Viet co dau) duoc chuyen thanh ky tu ASCII gan nhat.
 * Tranh loi UTF-8 -> chu Trung Quoc tren may in nhiet.
 */
function stringToBytes(str) {
    var map = {
        'à':'a','á':'a','ả':'a','ã':'a','ạ':'a','ă':'a','ằ':'a','ắ':'a','ẳ':'a','ẵ':'a','ặ':'a',
        'â':'a','ầ':'a','ấ':'a','ẩ':'a','ẫ':'a','ậ':'a',
        'è':'e','é':'e','ẻ':'e','ẽ':'e','ẹ':'e','ê':'e','ề':'e','ế':'e','ể':'e','ễ':'e','ệ':'e',
        'ì':'i','í':'i','ỉ':'i','ĩ':'i','ị':'i',
        'ò':'o','ó':'o','ỏ':'o','õ':'o','ọ':'o','ô':'o','ồ':'o','ố':'o','ổ':'o','ỗ':'o','ộ':'o',
        'ơ':'o','ờ':'o','ớ':'o','ở':'o','ỡ':'o','ợ':'o',
        'ù':'u','ú':'u','ủ':'u','ũ':'u','ụ':'u','ư':'u','ừ':'u','ứ':'u','ử':'u','ữ':'u','ự':'u',
        'ỳ':'y','ý':'y','ỷ':'y','ỹ':'y','ỵ':'y',
        'đ':'d',
        'À':'A','Á':'A','Ả':'A','Ã':'A','Ạ':'A','Ă':'A','Ằ':'A','Ắ':'A','Ẳ':'A','Ẵ':'A','Ặ':'A',
        'Â':'A','Ầ':'A','Ấ':'A','Ẩ':'A','Ẫ':'A','Ậ':'A',
        'È':'E','É':'E','Ẻ':'E','Ẽ':'E','Ẹ':'E','Ê':'E','Ề':'E','Ế':'E','Ể':'E','Ễ':'E','Ệ':'E',
        'Ì':'I','Í':'I','Ỉ':'I','Ĩ':'I','Ị':'I',
        'Ò':'O','Ó':'O','Ỏ':'O','Õ':'O','Ọ':'O','Ô':'O','Ồ':'O','Ố':'O','Ổ':'O','Ỗ':'O','Ộ':'O',
        'Ơ':'O','Ờ':'O','Ớ':'O','Ở':'O','Ỡ':'O','Ợ':'O',
        'Ù':'U','Ú':'U','Ủ':'U','Ũ':'U','Ụ':'U','Ư':'U','Ừ':'U','Ứ':'U','Ử':'U','Ữ':'U','Ự':'U',
        'Ỳ':'Y','Ý':'Y','Ỷ':'Y','Ỹ':'Y','Ỵ':'Y',
        'Đ':'D'
    };
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
        var c = str.charAt(i);
        var code = str.charCodeAt(i);
        if (code < 128) {
            bytes.push(code);
        } else if (map[c] !== undefined) {
            var ascii = map[c].charCodeAt(0);
            bytes.push(ascii);
        } else {
            bytes.push(63); // '?'
        }
    }
    return bytes;
}

function escLinesToBytes(lines) {
    var bytes = [];
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (typeof line === 'string') {
            // Text line - encode as ASCII bytes (khong UTF-8 de tranh chu Trung Quoc)
            var asciiBytes = stringToBytes(line);
            for (var j = 0; j < asciiBytes.length; j++) {
                bytes.push(asciiBytes[j]);
            }
            bytes.push(0x0A); // LF
        } else if (Array.isArray(line)) {
            // ESC/POS command
            for (var j = 0; j < line.length; j++) {
                bytes.push(line[j]);
            }
        }
    }
    return bytes;
}

function formatPrice(amount) {
    if (typeof amount !== 'number') return '0';
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Chuyen mang bytes thanh Base64 chuan.
 * KHONG dung btoa() vi Android 6.0.1 WebView khong ho tro binary string.
 * Base64 output luon co do dai la boi so cua 4 (co padding =).
 */
function bytesToBase64(bytes) {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var result = '';
    var i = 0;
    var len = bytes.length;
    
    while (i < len) {
        var remaining = len - i;
        
        if (remaining >= 3) {
            var a = bytes[i++];
            var b = bytes[i++];
            var c = bytes[i++];
            
            var b1 = a >>> 2;
            var b2 = ((a & 3) << 4) | (b >>> 4);
            var b3 = ((b & 15) << 2) | (c >>> 6);
            var b4 = c & 63;
            
            result += chars.charAt(b1) + chars.charAt(b2) +
                      chars.charAt(b3) + chars.charAt(b4);
        } else if (remaining === 2) {
            var a = bytes[i++];
            var b = bytes[i++];
            
            var b1 = a >>> 2;
            var b2 = ((a & 3) << 4) | (b >>> 4);
            var b3 = (b & 15) << 2;
            
            result += chars.charAt(b1) + chars.charAt(b2) +
                      chars.charAt(b3) + '=';
        } else {
            var a = bytes[i++];
            
            var b1 = a >>> 2;
            var b2 = (a & 3) << 4;
            
            result += chars.charAt(b1) + chars.charAt(b2) + '==';
        }
    }
    return result;
}

// ========== PRINT VIA SUNMI (BLUETOOTH) ==========

function printViaSunmi(data) {
    return new Promise(function(resolve, reject) {
        try {
            console.log('printViaSunmi: data type:', typeof data, 'keys:', Object.keys(data).join(','));
            
            // Tao ESC/POS bytes hoan chinh
            var escLines = buildReceiptESC(data);
            console.log('printViaSunmi: escLines length:', escLines ? escLines.length : 'null');
            var bytes = escLinesToBytes(escLines);
            console.log('printViaSunmi: bytes length:', bytes ? bytes.length : 'null');
            
            // Chuyen bytes thanh Base64 (khong dung btoa)
            var base64Data = bytesToBase64(bytes);
            console.log('printViaSunmi: base64 length:', base64Data ? base64Data.length : 'null');
            
            // Gui qua Android bridge
            if (typeof Android !== 'undefined' && typeof Android.printSunmi === 'function') {
                console.log('printViaSunmi: calling Android.printSunmi()...');
                var result = Android.printSunmi(base64Data);
                console.log('printViaSunmi: Android.printSunmi() returned:', result);
                
                if (result === 'ok') {
                    resolve(true);
                } else {
                    reject(new Error('Print failed: ' + result));
                }
            } else {
                console.log('printViaSunmi: Android.printSunmi is', typeof Android.printSunmi, 'Android is', typeof Android);
                reject(new Error('Android bridge not available'));
            }
        } catch (e) {
            console.error('printViaSunmi error:', e.message, 'stack:', e.stack);
            reject(e);
        }
    });
}

// ========== PRINT RECEIPT ==========

function printReceipt(data) {
    return printViaSunmi(data).then(function() {
        showToast('Da in hoa don', 'success');
        return true;
    }).catch(function(err) {
        console.warn('Print failed:', err ? err.message : 'unknown');
        showToast('In that bai: ' + (err ? err.message : 'Loi khong xac dinh'), 'error');
        return false;
    });
}

// ========== PRINT AFTER PAYMENT ==========

function printAfterPayment(paymentData) {
    var printData = {
        storeName: paymentData.shopName || 'POS CAFE',
        storeAddress: paymentData.shopAddress || null,
        tableName: paymentData.tableName || null,
        customerName: paymentData.customer ? (paymentData.customer.name || null) : null,
        items: paymentData.items || [],
        totalAmount: paymentData.amount || 0,
        paymentMethod: paymentData.paymentMethod || 'cash',
        changeAmount: paymentData.changeAmount || 0,
        date: paymentData.createdAt || new Date().toISOString()
    };
    printReceipt(printData);
}

// ========== CHECK PRINTER ==========

function testSunmiService() {
    if (typeof Android !== 'undefined' && typeof Android.checkSunmiPrinter === 'function') {
        try {
            var info = Android.checkSunmiPrinter();
            console.log('Sunmi printer info:', info);
            try {
                var parsed = JSON.parse(info);
                if (parsed.status === 'ok') {
                    showToast('May in san sang', 'success');
                } else {
                    showToast('May in chua ket noi: ' + (parsed.service || 'unknown'), 'warning');
                }
            } catch (e) {
                showToast(info, 'info');
            }
        } catch (e) {
            showToast('Loi kiem tra may in', 'error');
        }
    } else {
        showToast('Khong co bridge Android', 'error');
    }
}

// ========== AUTO DETECT ==========

function autoDetectPrinter() {
    // Chi kiem tra Bluetooth printer
    if (typeof Android !== 'undefined' && typeof Android.checkSunmiPrinter === 'function') {
        try {
            var info = Android.checkSunmiPrinter();
            try {
                var parsed = JSON.parse(info);
                if (parsed.status === 'ok') {
                    PRINT_MODE = 'sunmi';
                    console.log('autoDetect: Bluetooth printer ready');
                    return;
                }
            } catch (e) { }
        } catch (e) { }
    }
    console.log('autoDetect: Bluetooth printer not available');
}

// ========== INIT ==========

// Tu dong phat hien may in khi khoi dong
setTimeout(autoDetectPrinter, 1000);
