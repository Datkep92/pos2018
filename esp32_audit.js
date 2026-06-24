// esp32_audit.js - Hệ thống kiểm soát két tiền (Cash Drawer Audit)
// ES5, tương thích Android 6, iOS 12
//
// CƠ CHẾ MỚI (v2):
// POS ghi giao dịch tiền mặt vào Firebase node cash_transactions
// ESP32 C2 (firmware) đọc node này và tự gán vào session mở/đóng két
// ESP32 C2 tự gửi Telegram cảnh báo khi cần thiết
// File này chỉ có nhiệm vụ ghi dữ liệu từ POS lên Firebase
//
// Firebase structure:
// {shopId}/cash_transactions/{pushId} = {
//   invoiceId, amount, cashier, paymentMethod, type,
//   tableName, customer, timestamp,
//   sessionId: null,  // ESP32 sẽ gán sau
//   status: "pending", // pending | linked | orphan
//   reason: "cash_payment" // Lý do mở két
// }
//
// Các giá trị reason:
// - cash_payment: Thanh toán tiền mặt (mặc định)
// - change_return: Trả lại tiền thừa
// - manual: Quản lý mở két thủ công
// - audit: Kiểm quỹ
// - unknown: Không xác định
//
// QUAN TRỌNG: Ghi đè handleCashPayment đã được định nghĩa trong pos.html
// để xử lý các pending payments trước đó
window.handleCashPayment = function(amount, invoiceId, txInfo) {
    console.log('[AUDIT] handleCashPayment called amount=' + amount + ' invoiceId=' + (invoiceId || 'auto'));
    
    if (!amount || amount <= 0) return Promise.resolve();
    invoiceId = invoiceId || _generateInvoiceId();
    var cashier = _getCurrentCashier();
    txInfo = txInfo || {};
    
    // Xác định lý do mở két dựa trên loại giao dịch
    var reason = txInfo.reason || 'cash_payment';
    // Nếu là debt_payment, vẫn là cash_payment vì có tiền mặt
    if (txInfo.type === 'debt_payment') reason = 'cash_payment';
    
    var shopId = _getShopId();
    var espOnline = (typeof window.isEsp32Active === 'function') ? window.isEsp32Active() : false;
    
    // LUÔN ghi cash_transactions vào Firebase, dù ESP online hay offline
    // Khi ESP online: ESP32 sẽ đọc và gán session
    // Khi ESP offline: dữ liệu vẫn được lưu, ESP sẽ xử lý sau khi online lại
    var ref = firebase.database().ref(shopId + '/cash_transactions');
    return ref.push({
        invoiceId: invoiceId,
        amount: amount,
        cashier: cashier,
        paymentMethod: 'cash',
        type: txInfo.type || 'dinein',          // dinein | takeaway | debt_payment
        tableName: txInfo.tableName || null,
        customer: txInfo.customer || null,
        timestamp: firebase.database.ServerValue.TIMESTAMP,
        sessionId: null,    // ESP32 sẽ gán sessionId sau
        status: 'pending',  // pending → linked (đã gán session) | orphan (ko có session)
        reason: reason       // Lý do mở két: cash_payment | change_return | manual | audit | unknown
    }).then(function(newRef) {
        console.log('[AUDIT] Đã ghi cash_transaction, key:', newRef.key, 'amount:', amount, 'type:', txInfo.type, 'reason:', reason);
        
        // Nếu ESP32 offline, gửi Telegram qua queue Firebase để đảm bảo luôn có thông báo
        if (!espOnline) {
            console.log('[AUDIT] ESP32 offline, gửi Telegram qua queue Firebase');
            var typeLabel = txInfo.type === 'dinein' ? 'Tại bàn' : (txInfo.type === 'takeaway' ? 'Mang đi' : 'Thanh toán nợ');
            var tableInfo = txInfo.tableName ? (' - ' + txInfo.tableName) : '';
            var customerInfo = txInfo.customer ? ('\n👤 ' + txInfo.customer) : '';
            var msg = '🛒 THANH TOÁN TIỀN MẶT\n' +
                      '💰 ' + _formatMoney(amount) + '\n' +
                      '📋 ' + typeLabel + tableInfo + '\n' +
                      '🧾 ' + invoiceId + '\n' +
                      '👤 ' + cashier + customerInfo + '\n' +
                      '⚠️ ESP32 OFFLINE - Chưa gán session';
            
            // Ghi vào queue Telegram trên Firebase
            var queueRef = firebase.database().ref(shopId + '/drawer_telegram_queue').push();
            return queueRef.set({
                message: msg,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                source: 'esp32_audit_offline'
            }).then(function() {
                console.log('[AUDIT] Đã gửi Telegram queue (offline fallback)');
            });
        }
    }).catch(function(err) {
        console.error('[AUDIT] Lỗi ghi cash_transactions:', err);
    });
};

(function() {
    // Đánh dấu module chưa sẵn sàng
    window._auditReady = false;
    
    // Lấy shopId hiện tại
    function _getShopId() {
        return localStorage.getItem('current_shop_id') || 'shop_default';
    }

    // Lấy tên thu ngân hiện tại từ session
    function _getCurrentCashier() {
        var session = localStorage.getItem('pos_session');
        if (session) {
            try {
                var user = JSON.parse(session);
                return user.displayName || user.username || user.email || 'Nhân viên';
            } catch(e) {}
        }
        return 'Nhân viên';
    }

    // Tạo mã hóa đơn tự động
    function _generateInvoiceId() {
        var now = new Date();
        var dateStr = ('0' + now.getDate()).slice(-2) +
                      ('0' + (now.getMonth() + 1)).slice(-2);
        var timeStr = ('0' + now.getHours()).slice(-2) +
                      ('0' + now.getMinutes()).slice(-2) +
                      ('0' + now.getSeconds()).slice(-2);
        return 'HD' + dateStr + timeStr;
    }

    // Format số tiền (1000000 -> 1.000.000đ)
    function _formatMoney(amount) {
        if (!amount) return '0đ';
        var s = String(amount);
        var res = '';
        var len = s.length;
        for (var i = len - 1, j = 0; i >= 0; i--, j++) {
            if (j > 0 && j % 3 === 0) res = '.' + res;
            res = s[i] + res;
        }
        return res + 'đ';
    }

    // Expose _generateInvoiceId ra global để handleCashPayment (bên ngoài IIFE) có thể gọi
    window._generateInvoiceId = _generateInvoiceId;
    window._getShopId = _getShopId;
    window._getCurrentCashier = _getCurrentCashier;
    window._formatMoney = _formatMoney;

    // Đánh dấu module đã sẵn sàng
    window._auditReady = true;
    
    // Xử lý các pending payments từ trước khi esp32_audit.js load
    var pending = window._pendingCashPayments || [];
    window._pendingCashPayments = [];
    if (pending.length > 0) {
        console.log('[AUDIT] Xử lý ' + pending.length + ' pending payment(s) từ queue');
        pending.forEach(function(p) {
            window.handleCashPayment(p.amount, p.invoiceId, p.txInfo);
        });
    }
    
    console.log('[AUDIT] ESP32 Audit module loaded (cash_transactions mode v2)');
})();
