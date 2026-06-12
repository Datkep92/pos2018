// telegram.js - Gửi thông báo giao dịch qua Telegram Bot
// ES5, tương thích Android 6, iOS 12

var TELEGRAM_BOT_TOKEN = "8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc";
var TELEGRAM_CHAT_ID = "6372876364";

// ========== GỬI THÔNG BÁO ĐƠN GIẢN ==========
function sendTelegramMessage(message) {
    if (!message) return Promise.resolve();
    
    var url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage";
    var params = {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: "HTML"
    };
    
    // Dùng XMLHttpRequest để tương thích ES5
    return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    resolve(JSON.parse(xhr.responseText));
                } else {
                    console.warn("Telegram send failed:", xhr.status, xhr.responseText);
                    resolve(null); // Không reject để không ảnh hưởng luồng chính
                }
            }
        };
        xhr.onerror = function() {
            console.warn("Telegram network error");
            resolve(null);
        };
        xhr.send(JSON.stringify(params));
    });
}

// ========== HÀM DÙNG CHUNG ==========
function _tgTime() {
    return new Date().toLocaleString("vi-VN", {
        hour: "2-digit", minute: "2-digit",
        day: "2-digit", month: "2-digit"
    });
}

function _tgType(transaction) {
    if (transaction.type === "dinein") return "🍽️ Tại chỗ";
    if (transaction.type === "takeaway") return "🛵 Mang đi";
    if (transaction.type === "grab") return "🚕 Grab";
    if (transaction.type === "debt_payment") return "💵 Trả nợ";
    if (transaction.type === "draft") return "📋 Nháp";
    if (transaction.type === "cancelled") return "❌ Hủy";
    return "💳 Giao dịch";
}

function _tgMethod(transaction) {
    if (transaction.paymentMethod === "cash") return "💰 Tiền mặt";
    if (transaction.paymentMethod === "transfer") return "💳 Chuyển khoản";
    if (transaction.paymentMethod === "debt") return "💢 Ghi nợ";
    if (transaction.paymentMethod === "grab") return "🚕 Grab";
    return "";
}

function _tgLocation(transaction) {
    if (transaction.tableName) return "🪑 " + transaction.tableName;
    if (transaction.type === "takeaway") return "🛵 Mang đi";
    if (transaction.type === "grab") return "🚕 Grab";
    return "🍽️ Tại chỗ";
}

function _tgCustomer(transaction) {
    if (transaction.customer && transaction.customer.name) return "👤 " + transaction.customer.name;
    return "";
}

function _tgItemCount(transaction) {
    if (!transaction.items || !transaction.items.length) return 0;
    var count = 0;
    for (var i = 0; i < transaction.items.length; i++) count += transaction.items[i].qty;
    return count;
}

// ========== ĐỊNH DẠNG TIN NHẮN ==========
function formatTelegramTransaction(transaction) {
    if (!transaction) return "";
    
    var timeStr = _tgTime();
    var typeStr = _tgType(transaction);
    var methodStr = _tgMethod(transaction);
    var locationStr = _tgLocation(transaction);
    var customerStr = _tgCustomer(transaction);
    var itemCount = _tgItemCount(transaction);
    var amountStr = formatMoney(transaction.amount);
    
    var msg = "<b>🛒 ĐƠN MỚI +" + amountStr + "</b>\n";
    msg += "────────────────\n";
    msg += "🕐 " + timeStr + "\n";
    msg += typeStr + "\n";
    msg += locationStr + "\n";
    if (customerStr) msg += customerStr + "\n";
    msg += "📦 " + itemCount + " món\n";
    if (methodStr) msg += methodStr + "\n";
    msg += "💰 <b>" + amountStr + "</b>\n";
    
    return msg;
}

function formatTelegramExpense(expenseData) {
    if (!expenseData) return "";
    
    var typeIcon = expenseData.type === "ingredient" ? "🧂" : "📦";
    var typeName = expenseData.type === "ingredient" ? "Nguyên liệu" : "Hao phí";
    var fundIcon = expenseData.fundSource === "pos_cash" ? "🏦" : "👔";
    var fundName = expenseData.fundSource === "pos_cash" ? "Két POS" : "QL Thanh toán";
    
    var msg = "<b>📊 CHI PHÍ</b>\n";
    msg += "────────────────\n";
    msg += "🕐 " + _tgTime() + "\n";
    msg += typeIcon + " " + typeName + "\n";
    msg += "📝 " + (expenseData.categoryName || expenseData.name || "") + "\n";
    msg += fundIcon + " " + fundName + "\n";
    msg += "💰 <b>" + formatMoney(expenseData.amount) + "</b>\n";
    
    return msg;
}

function formatTelegramCustom(message) {
    var msg = "<b>📢 THÔNG BÁO</b>\n";
    msg += "────────────────\n";
    msg += "🕐 " + _tgTime() + "\n";
    msg += message + "\n";
    
    return msg;
}

// ========== HÀM GỬI NHANH ==========
function notifyTelegramTransaction(transaction) {
    var msg = formatTelegramTransaction(transaction);
    if (msg) sendTelegramMessage(msg);
}

function notifyTelegramExpense(expenseData) {
    var msg = formatTelegramExpense(expenseData);
    if (msg) sendTelegramMessage(msg);
}

function notifyTelegramCustom(message) {
    var msg = formatTelegramCustom(message);
    if (msg) sendTelegramMessage(msg);
}

// ========== THÔNG BÁO HOÀN TÁC GIAO DỊCH ==========
function formatTelegramRefund(transaction, reason, needPassword) {
    if (!transaction) return "";
    
    var timeStr = _tgTime();
    var typeStr = _tgType(transaction);
    var methodStr = _tgMethod(transaction);
    var locationStr = _tgLocation(transaction);
    var customerStr = _tgCustomer(transaction);
    var itemCount = _tgItemCount(transaction);
    var amountStr = formatMoney(transaction.amount);
    var lockIcon = needPassword ? "🔒" : "🔓";
    var lockText = needPassword ? "Có mật khẩu" : "Không mật khẩu";
    
    var msg = "<b>❌ HOÀN TÁC -" + amountStr + "</b>\n";
    msg += "────────────────\n";
    msg += "🕐 " + timeStr + "\n";
    msg += typeStr + "\n";
    msg += locationStr + "\n";
    if (customerStr) msg += customerStr + "\n";
    msg += "📦 " + itemCount + " món\n";
    if (methodStr) msg += methodStr + "\n";
    msg += "💰 <b>" + amountStr + "</b>\n";
    msg += "📝 Lý do: " + reason + "\n";
    msg += lockIcon + " " + lockText + "\n";
    
    return msg;
}

function notifyTelegramRefund(transaction, reason, needPassword) {
    var msg = formatTelegramRefund(transaction, reason, needPassword);
    if (msg) sendTelegramMessage(msg);
}
