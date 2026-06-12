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

// ========== ĐỊNH DẠNG TIN NHẮN ==========
function formatTelegramTransaction(transaction) {
    if (!transaction) return "";
    
    var emoji = "";
    var typeText = "";
    
    if (transaction.type === "dinein") {
        emoji = "🍽️";
        typeText = "Tại chỗ";
    } else if (transaction.type === "takeaway") {
        emoji = "🛵";
        typeText = "Mang đi";
    } else if (transaction.type === "grab") {
        emoji = "🚕";
        typeText = "Grab";
    } else if (transaction.type === "debt_payment" && transaction.paymentMethod === "debt") {
        emoji = "💢";
        typeText = "Ghi nợ";
    } else if (transaction.type === "debt_payment" && transaction.paymentMethod === "cash") {
        emoji = "💵";
        typeText = "Thanh toán nợ";
    } else {
        emoji = "💳";
        typeText = "Giao dịch";
    }
    
    var methodText = "";
    if (transaction.paymentMethod === "cash") methodText = "💰 Tiền mặt";
    else if (transaction.paymentMethod === "transfer") methodText = "💳 Chuyển khoản";
    else if (transaction.paymentMethod === "debt") methodText = "💢 Ghi nợ";
    else if (transaction.paymentMethod === "grab") methodText = "🚕 Grab";
    
    var locationText = "";
    if (transaction.tableName) locationText = "🪑 " + transaction.tableName;
    else if (transaction.type === "takeaway") locationText = "🛵 Mang đi";
    else if (transaction.type === "grab") locationText = "🚕 Grab";
    else locationText = "🍽️ Tại chỗ";
    
    var customerText = "";
    if (transaction.customer && transaction.customer.name) {
        customerText = "👤 " + transaction.customer.name;
    }
    
    var itemCount = 0;
    if (transaction.items && transaction.items.length) {
        for (var i = 0; i < transaction.items.length; i++) {
            itemCount += transaction.items[i].qty;
        }
    }
    
    var timeStr = new Date().toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit"
    });
    
    var msg = "<b>" + emoji + " GIAO DỊCH MỚI</b>\n";
    msg += "────────────────\n";
    msg += "🕐 " + timeStr + "\n";
    msg += locationText + "\n";
    if (customerText) msg += customerText + "\n";
    msg += "📦 " + itemCount + " món\n";
    msg += methodText + "\n";
    msg += "💰 <b>" + formatMoney(transaction.amount) + "</b>\n";
    
    return msg;
}

function formatTelegramExpense(expenseData) {
    if (!expenseData) return "";
    
    var typeIcon = expenseData.type === "ingredient" ? "🧂" : "📦";
    var typeName = expenseData.type === "ingredient" ? "Nguyên liệu" : "Hao phí";
    var fundIcon = expenseData.fundSource === "pos_cash" ? "🏦" : "👔";
    var fundName = expenseData.fundSource === "pos_cash" ? "Két POS" : "QL Thanh toán";
    
    var timeStr = new Date().toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit"
    });
    
    var msg = "<b>📊 CHI PHÍ MỚI</b>\n";
    msg += "────────────────\n";
    msg += "🕐 " + timeStr + "\n";
    msg += typeIcon + " " + typeName + "\n";
    msg += "📝 " + (expenseData.categoryName || expenseData.name || "") + "\n";
    msg += fundIcon + " " + fundName + "\n";
    msg += "💰 <b>" + formatMoney(expenseData.amount) + "</b>\n";
    
    return msg;
}

function formatTelegramCustom(message) {
    var timeStr = new Date().toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit"
    });
    
    var msg = "<b>📢 THÔNG BÁO</b>\n";
    msg += "────────────────\n";
    msg += "🕐 " + timeStr + "\n";
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
    
    var emoji = "❌";
    var typeText = "";
    
    if (transaction.type === "dinein") {
        emoji = "🍽️";
        typeText = "Tại chỗ";
    } else if (transaction.type === "takeaway") {
        emoji = "🛵";
        typeText = "Mang đi";
    } else if (transaction.type === "grab") {
        emoji = "🚕";
        typeText = "Grab";
    } else if (transaction.type === "debt_payment" && transaction.paymentMethod === "debt") {
        emoji = "💢";
        typeText = "Ghi nợ";
    } else if (transaction.type === "debt_payment" && transaction.paymentMethod === "cash") {
        emoji = "💵";
        typeText = "Thanh toán nợ";
    } else {
        emoji = "💳";
        typeText = "Giao dịch";
    }
    
    var methodText = "";
    if (transaction.paymentMethod === "cash") methodText = "💰 Tiền mặt";
    else if (transaction.paymentMethod === "transfer") methodText = "💳 Chuyển khoản";
    else if (transaction.paymentMethod === "debt") methodText = "💢 Ghi nợ";
    else if (transaction.paymentMethod === "grab") methodText = "🚕 Grab";
    
    var locationText = "";
    if (transaction.tableName) locationText = "🪑 " + transaction.tableName;
    else if (transaction.type === "takeaway") locationText = "🛵 Mang đi";
    else if (transaction.type === "grab") locationText = "🚕 Grab";
    else locationText = "🍽️ Tại chỗ";
    
    var customerText = "";
    if (transaction.customer && transaction.customer.name) {
        customerText = "👤 " + transaction.customer.name;
    }
    
    var itemCount = 0;
    if (transaction.items && transaction.items.length) {
        for (var i = 0; i < transaction.items.length; i++) {
            itemCount += transaction.items[i].qty;
        }
    }
    
    var timeStr = new Date().toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit"
    });
    
    var lockIcon = needPassword ? "🔒" : "🔓";
    var lockText = needPassword ? "Có mật khẩu" : "Không mật khẩu";
    
    var msg = "<b>❌ HOÀN TÁC GIAO DỊCH</b>\n";
    msg += "────────────────\n";
    msg += "🕐 " + timeStr + "\n";
    msg += emoji + " " + typeText + "\n";
    msg += locationText + "\n";
    if (customerText) msg += customerText + "\n";
    msg += "📦 " + itemCount + " món\n";
    msg += methodText + "\n";
    msg += "💰 <b>" + formatMoney(transaction.amount) + "</b>\n";
    msg += "📝 Lý do: " + reason + "\n";
    msg += lockIcon + " " + lockText + "\n";
    
    return msg;
}

function notifyTelegramRefund(transaction, reason, needPassword) {
    var msg = formatTelegramRefund(transaction, reason, needPassword);
    if (msg) sendTelegramMessage(msg);
}
