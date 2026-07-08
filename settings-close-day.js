// settings-close-day.js - Staff close day + Telegram shift close + unlock
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

function staffCloseDay() {
    var countedTotal = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        countedTotal += CASH_DENOMS[i].value * (cashCounts[CASH_DENOMS[i].value] || 0);
    }

    var data = _posCashData || {
        openingBalance: 0, cashRevenue: 0, posCashExpense: 0,
        managerPickupTotal: 0, expectedClosing: 0
    };
    var managerPickupTotal = data.managerPickupTotal || 0;
    var expectedClosing = data.expectedClosing || 0;

    // expectedClosing đã trừ QL nhận
    var expectedAfterPickup = expectedClosing;
    var difference = countedTotal - expectedAfterPickup;
    var isNegative = difference < 0;
    var isSurplus = difference > 0;

    // differenceType: 'surplus' (dư), 'deficit' (thiếu), 'balanced' (cân bằng)
    // Dùng cho admin lọc danh sách chốt ngày dễ dàng
    var differenceType = isSurplus ? 'surplus' : (isNegative ? 'deficit' : 'balanced');

    // Dùng ngày đã chọn (nếu có), nếu không thì dùng hôm nay
    var closeDate = _selectedCloseDate || data.dateKey || getTodayDateKey();

    // Tạo thời gian chốt ca theo UTC+7
    var now = new Date();
    var vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    var closedAtTime = ('0' + vnTime.getUTCHours()).slice(-2) + ':' +
                       ('0' + vnTime.getUTCMinutes()).slice(-2) + ' ' +
                       ('0' + vnTime.getUTCDate()).slice(-2) + '/' +
                       ('0' + (vnTime.getUTCMonth() + 1)).slice(-2) + '/' +
                       vnTime.getUTCFullYear();

    // Nếu countedTotal = 0 (ko đếm tiền), dùng expectedClosing để tránh số dư đầu kỳ = 0
    var finalCashKept = countedTotal > 0 ? countedTotal : expectedAfterPickup;

    // Ghi lên Firebase - các máy khác đọc realtime sẽ tự cập nhật
    // Lưu thêm openingBalance, cashRevenue, posCashExpense, managerPickupTotal để sau này có thể tính lại cashKept
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var dbRef = firebase.database().ref(shopId + '/daily_balances/' + closeDate);
    dbRef.update({
        cashKept: finalCashKept,
        difference: difference,
        differenceType: differenceType,
        isClosed: true,
        closedAt: Date.now(),
        closedAtTime: closedAtTime,
        closedBy: window.currentDeviceId || 'staff',
        updatedAt: Date.now(),
        openingBalance: data.openingBalance || 0,
        cashRevenue: data.cashRevenue || 0,
        posCashExpense: data.posCashExpense || 0,
        managerPickupTotal: managerPickupTotal
    }).then(function() {
        // Thông báo kết quả
        try {
            var toastMsg = '';
            var isSurplus = difference > 0;
            if (isNegative) {
                toastMsg = '🔒 ĐÃ CHỐT NGÀY ' + formatDateDisplay(closeDate) + '\n' +
                           '🔴 THIẾU ' + formatMoney(Math.abs(difference)) + ' - BÁO QUẢN LÝ!\n\n' +
                           '📂 Đầu kỳ: ' + formatMoney(data.openingBalance) + '\n' +
                           '💵 Đếm được: ' + formatMoney(countedTotal) + '\n' +
                           '💰 QL nhận: ' + formatMoney(managerPickupTotal) + '\n' +
                           '📐 Dự kiến còn: ' + formatMoney(expectedAfterPickup) + '\n' +
                           '📋 Thiếu: ' + formatMoney(Math.abs(difference));
                showCloseableToast(toastMsg, 'error', [{ label: '🔇 Tắt cảnh báo', onClick: _stopAlertSound }]);
                // Cảnh báo âm thanh khi thiếu tiền (âm)
                _playAlertSound();
            } else if (isSurplus) {
                toastMsg = '🔒 ĐÃ CHỐT NGÀY ' + formatDateDisplay(closeDate) + '\n' +
                           '⚠️ Dư tiền! Vui lòng nhập dữ liệu lần sau chính xác hơn.\n\n' +
                           '📂 Đầu kỳ: ' + formatMoney(data.openingBalance) + '\n' +
                           '💵 Đếm được: ' + formatMoney(countedTotal) + '\n' +
                           '💰 QL nhận: ' + formatMoney(managerPickupTotal) + '\n' +
                           '📐 Dự kiến còn: ' + formatMoney(expectedAfterPickup);
                showCloseableToast(toastMsg, 'warning');
            } else {
                toastMsg = '🔒 ĐÃ CHỐT NGÀY ' + formatDateDisplay(closeDate) + '\n' +
                           '✅ Số dư đầu kỳ mai: ' + formatMoney(countedTotal) + '\n\n' +
                           '📂 Đầu kỳ: ' + formatMoney(data.openingBalance) + '\n' +
                           '💵 Đếm được: ' + formatMoney(countedTotal) + '\n' +
                           '💰 QL nhận: ' + formatMoney(managerPickupTotal) + '\n' +
                           '📐 Dự kiến còn: ' + formatMoney(expectedAfterPickup) + '\n' +
                           '📋 Không chênh lệch';
                showCloseableToast(toastMsg, 'success');
            }
        } catch (e) {
        }

        // Gửi Telegram cho admin (dùng token riêng cho chốt ca - luồng riêng, ko qua telegram.js)
        // Tính thống kê doanh thu từ transactions
        // Cách đơn giản: gửi trực tiếp, đồng bộ (giống unlockDayClose)
        // Thử đọc transactions từ IndexedDB, nếu lỗi thì gửi với số liệu = 0
        var totalRevenue = 0;
        var cashCount = 0, cashAmount = 0;
        var transferCount = 0, transferAmount = 0;
        var grabCount = 0, grabAmount = 0;
        
        // Hàm xử lý transactions và gửi Telegram
        function _processTransactionsAndSend(txList) {
            for (var t = 0; t < txList.length; t++) {
                var tx = txList[t];
                if (tx.refunded) continue;
                // Bỏ qua ghi nợ - chỉ tính doanh thu thực tế khi khách thanh toán
                if (tx.paymentMethod === 'debt') continue;
                var amt = tx.amount || 0;
                totalRevenue += amt;
                if (tx.paymentMethod === 'cash') {
                    cashCount++;
                    cashAmount += amt;
                } else if (tx.paymentMethod === 'transfer') {
                    transferCount++;
                    transferAmount += amt;
                } else if (tx.paymentMethod === 'grab') {
                    grabCount++;
                    grabAmount += amt;
                }
            }
            _sendShiftCloseTelegram(closeDate, data, countedTotal, managerPickupTotal, expectedAfterPickup, difference, isNegative, isSurplus, closedAtTime, totalRevenue, cashCount, cashAmount, transferCount, transferAmount, grabCount, grabAmount);
        }
        
        // Đọc transactions từ IndexedDB (bất đồng bộ)
        try {
            if (typeof DB !== 'undefined' && typeof DB.getTransactionsByDate === 'function') {
                var txPromise = DB.getTransactionsByDate(closeDate);
                if (txPromise && typeof txPromise.then === 'function') {
                    txPromise.then(function(txList) {
                        _processTransactionsAndSend(txList || []);
                    }).catch(function() {
                        _processTransactionsAndSend([]);
                    });
                } else if (Array.isArray(txPromise)) {
                    _processTransactionsAndSend(txPromise);
                } else {
                    _processTransactionsAndSend([]);
                }
            } else {
                _processTransactionsAndSend([]);
            }
        } catch (e) {
            _processTransactionsAndSend([]);
        }

        // Tính toán quỹ thưởng trách nhiệm sau khi chốt
        // Dùng data.totalRevenue đã được tính từ loadPosCashData (đồng bộ, chính xác)
        try {
            var fundRevenue = data.totalRevenue || 0;
            // diffPercent tính theo doanh thu (theo yêu cầu: lệch dư >1% doanh thu)
            var diffPercentByRevenue = 0;
            if (fundRevenue > 0) {
                diffPercentByRevenue = Math.round(difference / fundRevenue * 10000) / 100;
            }
            processFundForClose(closeDate, difference, 'close');
        } catch (e) {
            // Bỏ qua lỗi quỹ, không ảnh hưởng chốt ngày
        }

        // Sau khi chốt, quay về ngày hôm nay
        _selectedCloseDate = null;
        loadPosCashData();
    }).catch(function(err) {
        // Vẫn thử gửi Telegram ngay cả khi Firebase lỗi
        try {
            _sendShiftCloseTelegram(closeDate, data || {}, countedTotal || 0, managerPickupTotal || 0, expectedAfterPickup || 0, difference || 0, isNegative, isSurplus, closedAtTime || '', 0, 0, 0, 0, 0, 0, 0);
        } catch(e3) {
        }
        showToast('❌ Lỗi khi chốt ngày!', 'error');
    });
}

// ========== GỬI TELEGRAM CHỐT CA (LUỒNG RIÊNG - KO QUA telegram.js) ==========
// Dùng token riêng cho chốt ca, KHÔNG fallback về token chính
// Nếu chưa cấu hình token chốt ca thì bỏ qua (ko gửi)
function _sendShiftCloseTelegram(closeDate, data, countedTotal, managerPickupTotal, expectedAfterPickup, difference, isNegative, isSurplus, closedAtTime, totalRevenue, cashCount, cashAmount, transferCount, transferAmount, grabCount, grabAmount) {
    // Đọc token từ window.shopConfig (cập nhật realtime từ Firebase)
    // Fallback: đọc trực tiếp từ localStorage nếu shopConfig chưa kịp cập nhật
    var config = window.shopConfig || {};
    var botToken = config.telegramShiftCloseToken;
    var chatId = config.telegramChatId;

    // Fallback sang localStorage nếu window.shopConfig chưa có
    if (!botToken) {
        botToken = localStorage.getItem('telegram_shift_close_token');
    }
    if (!chatId) {
        chatId = localStorage.getItem('telegram_chat_id');
    }

    // Nếu ko có token shift -> bỏ qua (ko fallback về token chính)
    // Chỉ gửi qua token chốt ca riêng
    if (!botToken || !chatId) {
        return;
    }

    var icon = isNegative ? '🔴' : (isSurplus ? '⚠️' : '✅');
    var message = icon + ' NHÂN VIÊN CHỐT NGÀY ' + formatDateDisplay(closeDate) + '\n\n' +
                '🕐 Thời gian chốt: ' + closedAtTime + '\n' +
                '📂 Đầu kỳ: ' + formatMoney(data.openingBalance) + '\n' +
                '💵 Doanh thu TM: ' + formatMoney(data.cashRevenue) + '\n' +
                '🏦 Chi phí POS: ' + formatMoney(data.posCashExpense) + '\n' +
                '💰 QL nhận: ' + formatMoney(managerPickupTotal) + '\n' +
                '📐 Dự kiến còn: ' + formatMoney(expectedAfterPickup) + '\n' +
                '📊 Đếm được: ' + formatMoney(countedTotal) + '\n' +
                '📋 Chênh lệch: ' + (difference >= 0 ? '+' : '') + formatMoney(difference);

    // Thống kê doanh thu theo phương thức
    totalRevenue = totalRevenue || 0;
    cashCount = cashCount || 0;
    cashAmount = cashAmount || 0;
    transferCount = transferCount || 0;
    transferAmount = transferAmount || 0;
    grabCount = grabCount || 0;
    grabAmount = grabAmount || 0;
    var totalOrders = cashCount + transferCount + grabCount;

    message += '\n\n📊 TỔNG DOANH THU: ' + formatMoney(totalRevenue) + ' (' + totalOrders + ' đơn)';
    message += '\n💵 Tiền mặt: ' + cashCount + ' đơn - ' + formatMoney(cashAmount);
    message += '\n💳 Chuyển khoản: ' + transferCount + ' đơn - ' + formatMoney(transferAmount);
    message += '\n🛵 Grab: ' + grabCount + ' đơn - ' + formatMoney(grabAmount);

    if (isNegative) {
        message += '\n\n🔴 THIẾU ' + formatMoney(Math.abs(difference)) + ' - CẦN KIỂM TRA!';
    } else if (isSurplus) {
        message += '\n\n⚠️ DƯ ' + formatMoney(difference) + ' - Cần kiểm tra!';
    }

    // Gửi trực tiếp qua Telegram Bot API (ko qua ESP32, ko qua telegram.js)
    // Dùng XMLHttpRequest để tương thích Android 6 (WebView cũ)
    var url = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
    var params = JSON.stringify({
        chat_id: String(chatId),
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });

    // Cách 1: XMLHttpRequest (ưu tiên)
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 10000;
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
            } else {
                // Fallback: thử gửi bằng Image() nếu XHR lỗi
                _sendShiftCloseViaImage(url, chatId, message);
            }
        };
        xhr.onerror = function() {
            _sendShiftCloseViaImage(url, chatId, message);
        };
        xhr.ontimeout = function() {
            _sendShiftCloseViaImage(url, chatId, message);
        };
        xhr.send(params);
    } catch (e) {
        _sendShiftCloseViaImage(url, chatId, message);
    }
}

// Fallback: gửi Telegram bằng Image() (ko bị CORS, tương thích mọi trình duyệt)
function _sendShiftCloseViaImage(url, chatId, message) {
    try {
        // Telegram API hỗ trợ GET method
        var getUrl = url + '?chat_id=' + encodeURIComponent(String(chatId)) +
                     '&text=' + encodeURIComponent(message) +
                     '&parse_mode=HTML&disable_web_page_preview=true';
        var img = new Image();
        img.onload = function() { console.log('[ShiftClose] Gửi qua Image thành công'); };
        img.onerror = function() { console.error('[ShiftClose] Gửi qua Image thất bại'); };
        img.src = getUrl;
    } catch (e) {
    }
}

// Gửi thông báo hủy chốt qua luồng riêng (token chốt ca)
function _sendShiftCloseUnlock(closeDate) {
    var config = window.shopConfig || {};
    var botToken = config.telegramShiftCloseToken;
    var chatId = config.telegramChatId;

    // Fallback sang localStorage nếu window.shopConfig chưa có
    if (!botToken) {
        botToken = localStorage.getItem('telegram_shift_close_token');
    }
    if (!chatId) {
        chatId = localStorage.getItem('telegram_chat_id');
    }

    // Nếu ko có token shift -> bỏ qua (ko fallback sang token chính)
    if (!botToken || !chatId) {
        return;
    }

    var dateLabel = formatDateDisplay(closeDate);
    var message = '🔓 QUẢN LÝ HỦY CHỐT NGÀY ' + dateLabel + '\n\n' +
                  'Nhân viên có thể chốt lại ngày này.';

    var url = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
    var params = JSON.stringify({
        chat_id: String(chatId),
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });

    // Cách 1: XMLHttpRequest (ưu tiên)
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 10000;
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
            } else {
                _sendShiftCloseViaImage(url, chatId, message);
            }
        };
        xhr.onerror = function() {
            _sendShiftCloseViaImage(url, chatId, message);
        };
        xhr.ontimeout = function() {
            _sendShiftCloseViaImage(url, chatId, message);
        };
        xhr.send(params);
    } catch (e) {
        _sendShiftCloseViaImage(url, chatId, message);
    }
}

// ========== ADMIN: HỦY CHỐT NGÀY ==========
// Admin có thể hủy chốt để cho phép nhân viên chốt lại
function unlockDayClose() {
    var closeDate = _selectedCloseDate || (_posCashData && _posCashData.dateKey) || getTodayDateKey();
    var dateLabel = formatDateDisplay(closeDate);

    if (!confirm('🔓 Xác nhận hủy chốt ngày ' + dateLabel + '?\n\nSau khi hủy chốt:\n- Nhân viên có thể chốt lại\n- Hoàn tác/xóa món/xóa bàn sẽ yêu cầu mật khẩu (đã chốt)\n- Số dư quỹ sẽ được khôi phục về trước khi chốt\n\nTiếp tục?')) return;

    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';

    var dbRef = firebase.database().ref(shopId + '/daily_balances/' + closeDate);

    // Cập nhật daily_balances: hủy chốt
    dbRef.update({
        isClosed: false,
        closedAt: null,
        closedBy: null,
        updatedAt: Date.now()
    }).then(function() {
        // Xử lý quỹ: đảo ngược thay đổi nếu có (dùng chung 1 hàm)
        processFundForClose(closeDate, 0, 'unlock');

        showToast('🔓 Đã hủy chốt ngày ' + dateLabel, 'success');

        // Gửi thông báo hủy chốt qua luồng riêng (token chốt ca)
        _sendShiftCloseUnlock(closeDate);

        // Quay về ngày hôm nay sau khi hủy chốt
        _selectedCloseDate = null;
        loadPosCashData();
    }).catch(function(err) {
        showToast('❌ Lỗi khi hủy chốt!', 'error');
    });
}