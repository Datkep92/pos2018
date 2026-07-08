// settings-telegram.js - Telegram config (save/test/clear)
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// 5. TELEGRAM CONFIG
// ============================================================

function toggleTelegramTokenVisibility() {
    var input = document.getElementById('telegramBotToken');
    var btn = document.getElementById('settingsToggleTelegramToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

function toggleShiftCloseTokenVisibility() {
    var input = document.getElementById('telegramShiftCloseToken');
    var btn = document.getElementById('settingsToggleShiftCloseToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

function toggleWarningTokenVisibility() {
    var input = document.getElementById('telegramWarningToken');
    var btn = document.getElementById('settingsToggleWarningToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

function toggleExpenseTokenVisibility() {
    var input = document.getElementById('telegramExpenseToken');
    var btn = document.getElementById('settingsToggleExpenseToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

function testShiftCloseTelegram() {
    var token = localStorage.getItem('telegram_shift_close_token');
    var chatId = localStorage.getItem('telegram_chat_id');
    if (!token) {
        showToast('⚠️ Chưa có token chốt ca, dùng token chính để thử', 'warning');
        token = localStorage.getItem('telegram_bot_token');
        chatId = localStorage.getItem('telegram_chat_id');
        if (!token || !chatId) {
            showToast('⚠️ Chưa có cấu hình Telegram nào', 'warning');
            return;
        }
    }

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '📨 Đang gửi tin nhắn thử chốt ca...';

    var message = encodeURIComponent('🔒 *Tin nhắn thử từ POS - Chốt ca* \n\nNếu bạn thấy tin nhắn này, cấu hình Telegram chốt ca đã hoạt động!');
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage?chat_id=' + chatId + '&text=' + message + '&parse_mode=Markdown';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 10000;

    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            if (statusEl) statusEl.textContent = '✅ Gửi thử chốt ca thành công!';
            showToast('✅ Gửi tin nhắn thử chốt ca thành công', 'success');
        } else {
            if (statusEl) statusEl.textContent = '❌ Lỗi: ' + xhr.status;
            showToast('❌ Gửi thử chốt ca thất bại (HTTP ' + xhr.status + ')', 'error');
        }
    };

    xhr.onerror = function() {
        if (statusEl) statusEl.textContent = '❌ Không thể kết nối Telegram';
        showToast('❌ Không thể kết nối Telegram API', 'error');
    };

    xhr.ontimeout = function() {
        if (statusEl) statusEl.textContent = '❌ Hết thời gian chờ';
        showToast('❌ Hết thời gian chờ kết nối Telegram', 'error');
    };

    xhr.send();
}

function saveTelegramConfig() {
    var token = document.getElementById('telegramBotToken').value.trim();
    var chatId = document.getElementById('telegramChatId').value.trim();
    var botName = document.getElementById('telegramBotName').value.trim();

    // Shift-close token (không bắt buộc)
    var shiftCloseToken = document.getElementById('telegramShiftCloseToken').value.trim();

    // Warning token (không bắt buộc) - dùng chung Chat ID
    var warningToken = document.getElementById('telegramWarningToken').value.trim();

    // Expense token (không bắt buộc) - dùng chung Chat ID
    var expenseToken = document.getElementById('telegramExpenseToken').value.trim();

    if (!token || !chatId) {
        showToast('⚠️ Vui lòng nhập Bot Token và Chat ID cho thông báo chung', 'warning');
        return;
    }

    localStorage.setItem('telegram_bot_token', token);
    localStorage.setItem('telegram_chat_id', chatId);
    if (botName) {
        localStorage.setItem('telegram_bot_name', botName);
    }

    // Lưu shift-close token
    if (shiftCloseToken) {
        localStorage.setItem('telegram_shift_close_token', shiftCloseToken);
    } else {
        localStorage.removeItem('telegram_shift_close_token');
    }

    // Lưu warning token (dùng chung Chat ID)
    if (warningToken) {
        localStorage.setItem('telegram_warning_token', warningToken);
    } else {
        localStorage.removeItem('telegram_warning_token');
    }

    // Lưu expense token (dùng chung Chat ID)
    if (expenseToken) {
        localStorage.setItem('telegram_expense_token', expenseToken);
    } else {
        localStorage.removeItem('telegram_expense_token');
    }

    // Cập nhật biến global trong telegram.js nếu có
    if (typeof window.TELEGRAM_BOT_TOKEN !== 'undefined') {
        window.TELEGRAM_BOT_TOKEN = token;
    }
    if (typeof window.TELEGRAM_CHAT_ID !== 'undefined') {
        window.TELEGRAM_CHAT_ID = chatId;
    }

    // Cập nhật shopConfig để _sendShiftCloseTelegram() đọc được
    if (!window.shopConfig) {
        window.shopConfig = {};
    }
    window.shopConfig.telegramBotToken = token;
    window.shopConfig.telegramChatId = chatId;
    window.shopConfig.telegramShiftCloseToken = shiftCloseToken || '';
    window.shopConfig.telegramWarningToken = warningToken || '';
    window.shopConfig.telegramExpenseToken = expenseToken || '';

    // Ghi lên Firebase để đồng bộ
    var shopId = localStorage.getItem('current_shop_id') || 'shop_default';
    var fbRef = firebase.database().ref(shopId + '/info');
    fbRef.update({
        telegramBotToken: token,
        telegramChatId: chatId,
        telegramShiftCloseToken: shiftCloseToken || '',
        telegramWarningToken: warningToken || '',
        telegramExpenseToken: expenseToken || ''
    }).catch(function(err) {
    });

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '✅ Đã lưu cấu hình Telegram';
    showToast('✅ Đã lưu cấu hình Telegram', 'success');
}

function testTelegramConfig() {
    var token = localStorage.getItem('telegram_bot_token');
    var chatId = localStorage.getItem('telegram_chat_id');
    if (!token || !chatId) {
        showToast('⚠️ Chưa có cấu hình Telegram', 'warning');
        return;
    }

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '📨 Đang gửi tin nhắn thử...';

    var message = encodeURIComponent('🟢 *Tin nhắn thử từ POS* \n\nNếu bạn thấy tin nhắn này, cấu hình Telegram đã hoạt động!');
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage?chat_id=' + chatId + '&text=' + message + '&parse_mode=Markdown';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 10000;

    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            if (statusEl) statusEl.textContent = '✅ Gửi thử thành công!';
            showToast('✅ Gửi tin nhắn thử thành công', 'success');
        } else {
            if (statusEl) statusEl.textContent = '❌ Lỗi: ' + xhr.status;
            showToast('❌ Gửi thử thất bại (HTTP ' + xhr.status + ')', 'error');
        }
    };

    xhr.onerror = function() {
        if (statusEl) statusEl.textContent = '❌ Không thể kết nối Telegram';
        showToast('❌ Không thể kết nối Telegram API', 'error');
    };

    xhr.ontimeout = function() {
        if (statusEl) statusEl.textContent = '❌ Hết thời gian chờ';
        showToast('❌ Hết thời gian chờ kết nối Telegram', 'error');
    };

    xhr.send();
}

function clearTelegramConfig() {
    if (!confirm('Xóa cấu hình Telegram?')) return;
    localStorage.removeItem('telegram_bot_token');
    localStorage.removeItem('telegram_chat_id');
    localStorage.removeItem('telegram_bot_name');
    localStorage.removeItem('telegram_shift_close_token');
    localStorage.removeItem('telegram_warning_token');
    localStorage.removeItem('telegram_expense_token');

    document.getElementById('telegramBotToken').value = '';
    document.getElementById('telegramChatId').value = '';
    document.getElementById('telegramBotName').value = '';
    document.getElementById('telegramShiftCloseToken').value = '';
    document.getElementById('telegramWarningToken').value = '';
    document.getElementById('telegramExpenseToken').value = '';

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '🗑️ Đã xóa cấu hình Telegram';
    showToast('🗑️ Đã xóa cấu hình Telegram', 'info');
}