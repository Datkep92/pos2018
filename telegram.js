// telegram.js - Gửi thông báo qua Telegram Queue (Firebase)
// ESP32 sẽ đọc queue và gửi thực tế, không gửi trực tiếp từ trình duyệt
// Cơ chế tự động xóa queue: message được xóa sau 30 giây (đủ cho ESP32 đọc và gửi)
// Đồng thời chạy dọn dẹp định kỳ mỗi 5 phút, xóa message cũ hơn 1 giờ
(function() {
    // Lấy shopId hiện tại
    function _getShopId() {
        return localStorage.getItem('current_shop_id') || 'shop_default';
    }

    // Hàm gửi tin nhắn Telegram
    // - Nếu ESP32 online → đẩy vào queue (ESP32 xử lý), tự động xóa sau 30 giây
    // - Nếu ESP32 offline → gửi trực tiếp qua Telegram Bot API
    // Có thể truyền token và chatId tùy chỉnh (cho các bot riêng biệt)
    window.queueTelegramMessage = function(message, customToken, customChatId) {
        if (!message) return Promise.resolve();
        
        // Kiểm tra trạng thái ESP32
        if (typeof window.isEsp32Active === 'function' && window.isEsp32Active()) {
            // ESP online → đẩy vào queue (luồng gốc)
            var shopId = _getShopId();
            var ref = firebase.database().ref(shopId + '/drawer_telegram_queue');
            return ref.push({
                message: message,
                timestamp: firebase.database.ServerValue.TIMESTAMP,
                source: 'pos'
            }).then(function(newRef) {
                // Tự động xóa message sau 30 giây (đủ cho ESP32 đọc và gửi)
                // Dùng setTimeout thay vì Firebase Rule để linh hoạt hơn
                var messageKey = newRef.key;
                setTimeout(function() {
                    ref.child(messageKey).remove().catch(function(err) {
                        console.error('[Telegram] Lỗi xóa queue message:', err);
                    });
                }, 30000);
            }).catch(function(err) {
                console.error('[Telegram] Lỗi gửi queue:', err);
            });
        } else {
            // ESP offline → gửi trực tiếp qua Telegram Bot API
            return _sendTelegramDirect(message, customToken, customChatId);
        }
    };
    
    // Gửi trực tiếp qua Telegram Bot API (dùng fetch, ko cần ESP32)
    // Có thể truyền token và chatId tùy chỉnh, nếu ko thì dùng telegramBotToken mặc định
    function _sendTelegramDirect(message, customToken, customChatId) {
        var shopId = _getShopId();
        // Đọc token và chatId từ shopConfig (đã có sẵn trong window)
        var config = window.shopConfig || {};
        var botToken = customToken || config.telegramBotToken;
        var chatId = customChatId || config.telegramChatId;
        
        if (!botToken || !chatId) {
            console.error('[Telegram] Thiếu botToken hoặc chatId');
            return Promise.resolve();
        }
        
        var url = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
        var payload = {
            chat_id: String(chatId),
            text: message,
            parse_mode: 'HTML',
            disable_web_page_preview: true
        };
        
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function(response) {
            if (!response.ok) {
                console.error('[Telegram] Lỗi gửi direct:', response.status, response.statusText);
            } else {
                console.log('[Telegram] Gửi direct thành công');
            }
        }).catch(function(err) {
            console.error('[Telegram] Lỗi fetch gửi direct:', err);
        });
    }

    // ========== CÁC HÀM ĐỊNH DẠNG (GIỮ NGUYÊN) ==========
    function _tgTime() {
        return new Date().toLocaleString("vi-VN", {
            hour: "2-digit", minute: "2-digit",
            day: "2-digit", month: "2-digit"
        });
    }

    function _tgMethod(transaction) {
        if (transaction.paymentMethod === "cash") return "TM";
        if (transaction.paymentMethod === "transfer") return "CK";
        if (transaction.paymentMethod === "debt") return "Nợ";
        if (transaction.paymentMethod === "grab") return "Grab";
        return "";
    }

    function _tgLocation(transaction) {
        if (transaction.tableName) return transaction.tableName;
        if (transaction.type === "takeaway") return "Mang đi";
        if (transaction.type === "grab") return "Grab";
        return "Tại chỗ";
    }

    function _tgCustomer(transaction) {
        if (transaction.customer && transaction.customer.name) return transaction.customer.name;
        return "";
    }

    function _tgItemCount(transaction) {
        if (!transaction.items || !transaction.items.length) return 0;
        var count = 0;
        for (var i = 0; i < transaction.items.length; i++) count += transaction.items[i].qty;
        return count;
    }

    function _tgFirstItemName(transaction) {
        if (!transaction.items || !transaction.items.length) return "";
        return transaction.items[0].name || "";
    }

    function formatMoney(amount) {
        if (!amount && amount !== 0) return '0đ';
        var s = String(amount);
        var res = '';
        for (var i = s.length - 1, j = 0; i >= 0; i--, j++) {
            if (j > 0 && j % 3 === 0) res = '.' + res;
            res = s[i] + res;
        }
        return res + 'đ';
    }

    // Định dạng giao dịch - 1 dòng, ngắn gọn
    // Format: {method} - {số món} +{amount} - {tên món} - {location}
    window.formatTelegramTransaction = function(transaction) {
        if (!transaction) return "";
        var m = _tgMethod(transaction) || "TM";
        var count = _tgItemCount(transaction);
        var amountStr = formatMoney(transaction.amount);
        var itemName = _tgFirstItemName(transaction);
        var loc = _tgLocation(transaction);
        var msg = m + " - " + count + " món +" + amountStr;
        if (itemName) msg += " - " + itemName;
        msg += " - " + loc;
        return msg;
    };

    window.formatTelegramExpense = function(expenseData) {
        if (!expenseData) return "";
        var typeName = expenseData.type === "ingredient" ? "Nguyên liệu" : "Hao phí";
        var fundName = expenseData.fundSource === "pos_cash" ? "Két POS" : "QL Thanh toán";
        var parts = ["CHI PHÍ", _tgTime(), typeName, (expenseData.categoryName || expenseData.name || ""), fundName, formatMoney(expenseData.amount)];
        return parts.join(" - ");
    };

    window.formatTelegramCustom = function(message) {
        return "THÔNG BÁO - " + _tgTime() + " - " + message;
    };

    window.formatTelegramRefund = function(transaction, reason, needPassword) {
        if (!transaction) return "";
        var m = _tgMethod(transaction) || "TM";
        var count = _tgItemCount(transaction);
        var amountStr = formatMoney(transaction.amount);
        var itemName = _tgFirstItemName(transaction);
        var loc = _tgLocation(transaction);
        var msg = m + " - " + count + " món -" + amountStr;
        if (itemName) msg += " - " + itemName;
        msg += " - " + loc;
        msg += " - " + reason;
        if (needPassword) msg += " - 🔒";
        return msg;
    };

    // ========== CÁC HÀM GỬI NHANH (QUA QUEUE) ==========
    window.notifyTelegramTransaction = function(transaction) {
        var msg = window.formatTelegramTransaction(transaction);
        if (msg) window.queueTelegramMessage(msg);
    };

    // Gửi chi phí qua token chi phí riêng (telegramExpenseToken), dùng chung Chat ID
    window.notifyTelegramExpense = function(expenseData) {
        var msg = window.formatTelegramExpense(expenseData);
        if (msg) {
            var config = window.shopConfig || {};
            var expenseToken = config.telegramExpenseToken;
            var chatId = config.telegramChatId;
            if (expenseToken && chatId) {
                window.queueTelegramMessage(msg, expenseToken, chatId);
            } else {
                // Fallback về token chính nếu chưa cấu hình token chi phí
                window.queueTelegramMessage(msg);
            }
        }
    };

    window.notifyTelegramCustom = function(message) {
        var msg = window.formatTelegramCustom(message);
        if (msg) window.queueTelegramMessage(msg);
    };

    window.notifyTelegramRefund = function(transaction, reason, needPassword) {
        var msg = window.formatTelegramRefund(transaction, reason, needPassword);
        if (msg) window.queueTelegramMessage(msg);
    };

    // Gửi cảnh báo (tồn kho, xóa bàn, xóa món) qua token cảnh báo riêng, dùng chung Chat ID
    window.notifyTelegramWarning = function(warningMessage) {
        if (!warningMessage) return;
        var config = window.shopConfig || {};
        var warningToken = config.telegramWarningToken;
        var chatId = config.telegramChatId;
        if (warningToken && chatId) {
            var msg = window.formatTelegramCustom(warningMessage);
            window.queueTelegramMessage(msg, warningToken, chatId);
        } else {
            console.log('[Telegram] Chưa cấu hình token cảnh báo, bỏ qua:', warningMessage);
        }
    };

    // ========== ESP32 STATUS MONITOR ==========
    // Biến trạng thái ESP32 (optimistic: mặc định online)
    var _esp32Online = true;

    // Khởi tạo monitor
    (function _initEsp32Monitor() {
        var shopId = _getShopId();
        var espRef = firebase.database().ref(shopId + '/esp32_status');
        
        // Đọc giá trị hiện tại
        espRef.once('value').then(function(snapshot) {
            var data = snapshot.val();
            if (data && data.lastHeartbeat) {
                var elapsed = Date.now() - data.lastHeartbeat;
                _esp32Online = (elapsed < 30000);
                console.log('[Telegram] ESP32 initial status:', _esp32Online ? 'ONLINE' : 'OFFLINE',
                    'lastHeartbeat:', new Date(data.lastHeartbeat).toLocaleString());
            } else {
                _esp32Online = false;
                console.log('[Telegram] ESP32 status node not found, set OFFLINE');
            }
        }).catch(function(err) {
            console.error('[Telegram] Lỗi đọc ESP32 status:', err);
            _esp32Online = false;
        });
        
        // Lắng nghe thay đổi realtime
        espRef.on('value', function(snapshot) {
            var data = snapshot.val();
            if (data && data.lastHeartbeat) {
                var elapsed = Date.now() - data.lastHeartbeat;
                _esp32Online = (elapsed < 30000);
            } else {
                _esp32Online = false;
            }
        });
    })();

    // Public API: cho phép tables.js, order.js kiểm tra trạng thái ESP32
    window.isEsp32Active = function() {
        return _esp32Online;
    };

    // ========== DỌN DẸP QUEUE ĐỊNH KỲ ==========
    // Xóa các message cũ hơn 1 giờ để tránh queue phình to
    // Chạy mỗi 5 phút
    function _cleanupOldQueue() {
        var shopId = _getShopId();
        var ref = firebase.database().ref(shopId + '/drawer_telegram_queue');
        var cutoff = Date.now() - 3600000; // 1 giờ trước
        
        ref.orderByChild('timestamp').endAt(cutoff).once('value').then(function(snapshot) {
            var updates = {};
            var count = 0;
            snapshot.forEach(function(child) {
                updates[child.key] = null; // xóa
                count++;
            });
            if (count > 0) {
                ref.update(updates).catch(function(err) {
                    console.error('[Telegram] Lỗi dọn queue cũ:', err);
                });
                console.log('[Telegram] Đã dọn ' + count + ' message queue cũ');
            }
        }).catch(function(err) {
            console.error('[Telegram] Lỗi đọc queue để dọn:', err);
        });
    }

    // Chạy dọn dẹp lần đầu sau 1 phút, sau đó mỗi 5 phút
    setTimeout(_cleanupOldQueue, 60000);
    setInterval(_cleanupOldQueue, 300000);

    console.log('[Telegram] Module loaded (queue mode + ESP32 monitor + auto cleanup)');
})();