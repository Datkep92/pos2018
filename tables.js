// tables.js - Quản lý bàn
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// Helper: Dispatch event để settings.js reload doanh thu pos-cash-info
// Được gọi sau khi thanh toán thành công để cập nhật realtime trên cùng máy
function _dispatchPosCashUpdate() {
    try {
        var evt = document.createEvent('CustomEvent');
        evt.initCustomEvent('pos_cash_update', true, true, {});
        window.dispatchEvent(evt);
    } catch (e) {
    }
}

// ========== HẰNG SỐ KHÓA BÀN (đọc từ shopConfig, fallback hardcode) ==========
function _getTableLockHours() {
    return (window.shopConfig && window.shopConfig.tableLockHours !== undefined) ? window.shopConfig.tableLockHours : 5;
}
function _getTableLockMs() {
    return _getTableLockHours() * 60 * 60 * 1000;
}
function _getLockPassword() {
    return (window.shopConfig && window.shopConfig.lockPassword) ? window.shopConfig.lockPassword : '28122020';
}
function _getLockStartHour() {
    return (window.shopConfig && window.shopConfig.lockStartHour !== undefined) ? window.shopConfig.lockStartHour : 22;
}
function _getLockEndHour() {
    return (window.shopConfig && window.shopConfig.lockEndHour !== undefined) ? window.shopConfig.lockEndHour : 5;
}
function _getLockEndMinute() {
    return (window.shopConfig && window.shopConfig.lockEndMinute !== undefined) ? window.shopConfig.lockEndMinute : 30;
}

// Biến global lưu ID toast thanh toán để có thể ẩn sau khi xử lý xong
var _paymentToastId = null;

// FIX: Flag để tránh kiểm tra credit 2 lần khi qua _changeToastPay
// _changeToastPay lưu tiền dư vào credit, sau đó gọi paymentAtTableWithCredit
// và _processPaymentDirect - cả 2 đều kiểm tra credit, gây trừ credit 2 lần
var _skipCreditCheck = false;

// ========== HELPER: LẤY BÀN TỪ CACHE (ưu tiên) HOẶC DB ==========
function _getTableFromCache(tableId) {
    // Dùng cachedTables từ app.js nếu có
    if (window.cachedTables && Array.isArray(window.cachedTables)) {
        for (var i = 0; i < window.cachedTables.length; i++) {
            if (String(window.cachedTables[i].id) === String(tableId)) {
                return Promise.resolve(window.cachedTables[i]);
            }
        }
    }
    // Fallback: query DB
    return DB.get('tables', String(tableId));
}

function isInLockPeriod() {
    var now = new Date();
    var hourVietnam = (now.getUTCHours() + 7) % 24;
    var minuteVietnam = now.getUTCMinutes(); // UTC+7, minutes same
    var startH = _getLockStartHour();
    var endH = _getLockEndHour();
    var endM = _getLockEndMinute();
    
    if (hourVietnam >= startH) {
        // startH:00 - 23h59: đang trong lock period
        return true;
    }
    if (hourVietnam < endH || (hourVietnam === endH && minuteVietnam < endM)) {
        // 0h00 - endH:endM: đang trong lock period
        return true;
    }
    // endH:endM - (startH-1):59: ngoài lock period
    return false;
}

// ========== KIỂM TRA KHÓA BÀN ==========
function isTableLocked(table) {
    if (!table || !table.startTime) return false;
    
    // Điều kiện 1: Đang trong lock period (17h-5h30) -> khóa toàn bộ
    if (isInLockPeriod()) return true;
    
    // Điều kiện 2: Ngoài lock period -> khóa theo thời gian ngồi (quá 5h)
    var elapsed = Date.now() - new Date(table.startTime).getTime();
    if (elapsed >= _getTableLockMs()) return true;
    
    return false;
}

function getTableLockInfo(table) {
    if (!table || !table.startTime) return null;
    var now = new Date();
    var elapsed = Date.now() - new Date(table.startTime).getTime();
    var hourVietnam = (now.getUTCHours() + 7) % 24;
    var minuteVietnam = now.getUTCMinutes();
    
    // Đang trong lock period (17h-5h30)
    if (isInLockPeriod()) {
        if (hourVietnam >= _getLockStartHour()) {
            return { hours: 0, mins: 0, elapsed: 0, reason: 'đã qua ' + _getLockStartHour() + 'h' };
        } else {
            return { hours: 0, mins: 0, elapsed: 0, reason: 'khung giờ khóa (17h-5h30)' };
        }
    }
    
    // Ngoài lock period: kiểm tra thời gian ngồi
    if (elapsed >= _getTableLockMs()) {
        var hours = Math.floor(elapsed / 3600000);
        var mins = Math.floor((elapsed % 3600000) / 60000);
        return { hours: hours, mins: mins, elapsed: elapsed, reason: 'quá ' + hours + 'h' + mins + 'p' };
    }
    
    return null;
}

// ========== YÊU CẦU MẬT KHẨU ==========
function requirePassword(action, callback) {
    // NÂNG CẤP: Admin không cần nhập mật khẩu
    var currentUser = DB.getCurrentUser();
    if (currentUser && currentUser.role === 'admin') {
        callback();
        return;
    }
    
    // NÂNG CẤP: Staff không được phép, hiển thị thông báo liên hệ quản lý
    showToast('👑 Vui lòng liên hệ quản lý để ' + action, 'warning');
}

// ========== LOG XÓA VÀO FIREBASE ==========
// Lưu log xóa món/xóa bàn vào Firebase collection 'delete_logs'
// Key structure: { id, action, tableId, tableName, item, details, timestamp, deviceId }
// Sau này có thể mở rộng thêm trường dữ liệu
function logDelete(action, details) {
    var logEntry = {
        action: action, // 'delete_item' | 'delete_table'
        timestamp: Date.now(),
        deviceId: localStorage.getItem('device_id') || 'unknown',
        details: details
    };
    
    // Gửi thông báo Telegram NGAY LẬP TỨC, không đợi Firebase
    try {
        var user = DB.getCurrentUser();
        var staffName = user ? user.displayName : 'Nhân viên';
        var now = new Date();
        var timeStr = now.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
        var msg = '';
        if (action === 'delete_table') {
            var tableName = details.tableName || 'không tên';
            var items = details.items || [];
            var total = 0;
            var itemLines = '';
            for (var i = 0; i < items.length; i++) {
                var it = items[i];
                var line = '  ' + (i + 1) + '. ' + (it.name || '?') + ' x' + (it.qty || 0) + ' = ' + formatMoney((it.price || 0) * (it.qty || 0));
                itemLines += line + '\n';
                total += (it.price || 0) * (it.qty || 0);
            }
            // Thời gian tạo bàn & nhân viên tạo
            var createdByName = details.createdByName || '?';
            var startTimeStr = '?';
            if (details.startTime) {
                var st = new Date(details.startTime);
                startTimeStr = st.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
            }
            // Thời gian hoạt động
            var durationStr = '?';
            if (details.startTime) {
                var elapsed = Math.floor((now.getTime() - new Date(details.startTime).getTime()) / 60000);
                if (elapsed < 60) durationStr = elapsed + ' phút';
                else durationStr = Math.floor(elapsed / 60) + 'h' + (elapsed % 60) + 'p';
            }
            msg = '🗑️ <b>XÓA BÀN: ' + tableName + '</b>\n';
            msg += '────────────────\n';
            msg += '🕐 ' + timeStr + '\n';
            msg += '👤 Người xóa: ' + staffName + '\n';
            msg += '👤 Người tạo: ' + createdByName + '\n';
            msg += '🕐 Tạo lúc: ' + startTimeStr + '\n';
            msg += '⏱ Hoạt động: ' + durationStr + '\n';
            if (details.customerName) msg += '👤 Khách: ' + details.customerName + '\n';
            msg += '────────────────\n';
            msg += '<b>CHI TIẾT MÓN:</b>\n';
            msg += itemLines;
            msg += '────────────────\n';
            msg += '<b>TỔNG: ' + formatMoney(total) + '</b>';
        } else if (action === 'delete_item') {
            var tableName = details.tableName || 'không tên';
            var item = details.item || {};
            var itemTotal = (item.price || 0) * (item.qty || 0);
            // Thông tin bàn hiện tại
            var tableInfo = details.tableInfo || {};
            var createdByName = tableInfo.createdByName || '?';
            var startTimeStr = '?';
            if (tableInfo.startTime) {
                var st = new Date(tableInfo.startTime);
                startTimeStr = st.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
            }
            var durationStr = '?';
            if (tableInfo.startTime) {
                var elapsed = Math.floor((now.getTime() - new Date(tableInfo.startTime).getTime()) / 60000);
                if (elapsed < 60) durationStr = elapsed + ' phút';
                else durationStr = Math.floor(elapsed / 60) + 'h' + (elapsed % 60) + 'p';
            }
            msg = '🗑️ <b>XÓA MÓN: ' + tableName + '</b>\n';
            msg += '────────────────\n';
            msg += '🕐 ' + timeStr + '\n';
            msg += '👤 Người xóa: ' + staffName + '\n';
            msg += '👤 Người tạo bàn: ' + createdByName + '\n';
            msg += '🕐 Bàn tạo lúc: ' + startTimeStr + '\n';
            msg += '⏱ Bàn hoạt động: ' + durationStr + '\n';
            if (tableInfo.customerName) msg += '👤 Khách: ' + tableInfo.customerName + '\n';
            msg += '────────────────\n';
            msg += '🍽️ <b>' + (item.name || 'không tên') + ' x' + (item.qty || 0) + '</b>\n';
            msg += '💰 Đơn giá: ' + formatMoney(item.price || 0) + '\n';
            msg += '💵 Thành tiền: ' + formatMoney(itemTotal);
        }
        if (msg && typeof notifyTelegramWarning === 'function') {
            notifyTelegramWarning(msg);
        }
    } catch(e) {
        console.error('[logDelete] Lỗi gửi Telegram:', e);
    }
    
    // Ghi vào Firebase qua DB.create (lưu local + sync lên Firebase) - không chặn UI
    DB.create('delete_logs', logEntry).catch(function(err) {
        console.error('[logDelete] Lỗi ghi delete_logs:', err);
    });
}

// ========== XÓA MÓN TRÊN BÀN ==========
function deleteTableItem(tableId, itemIndex) {
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length) return;
        if (itemIndex < 0 || itemIndex >= table.items.length) return;

        var removedItem = table.items[itemIndex];
        var itemName = removedItem.name;
        var itemQty = removedItem.qty;
        var itemPrice = removedItem.price;

        // Kiểm tra đã chốt ngày chưa - nếu đã chốt thì yêu cầu mật khẩu
        // Chống gian lận: nhân viên không thể xóa món sau khi đã chốt ngày
        if (typeof isDayClosed === 'function' && isDayClosed()) {
            requirePassword('xóa món ' + itemName + ' (đã chốt ngày hôm nay)', function() {
                doDeleteTableItem(table, itemIndex, removedItem);
            });
            return;
        }

        // Kiểm tra khóa bàn: nếu bàn bị khóa, yêu cầu mật khẩu
        if (isTableLocked(table)) {
            requirePassword('xóa món ' + itemName + ' (bàn đang bị khóa)', function() {
                doDeleteTableItem(table, itemIndex, removedItem);
            });
        } else {
            doDeleteTableItem(table, itemIndex, removedItem);
        }
    });
}

function doDeleteTableItem(table, itemIndex, removedItem) {
    // 1. Hoàn nguyên nguyên liệu
    restoreIngredients([removedItem]).then(function() {
        // 2. Xóa món khỏi mảng items
        table.items.splice(itemIndex, 1);

        // 3. Tính lại tổng tiền
        var newTotal = 0;
        for (var i = 0; i < table.items.length; i++) {
            newTotal += table.items[i].price * table.items[i].qty;
        }
        table.total = newTotal;

        // 4. Cập nhật bàn trong DB (xóa recentAdds vì đã thay đổi items)
        return DB.update('tables', String(table.id), {
            items: table.items,
            total: newTotal,
            recentAdds: []
        });
    }).then(function() {
        // 5. Log vào Firebase delete_logs
        var details = {
            tableId: table.id,
            tableName: table.name,
            item: {
                name: removedItem.name,
                qty: removedItem.qty,
                price: removedItem.price,
                addedTime: removedItem.addedTime
            },
            tableInfo: {
                createdByName: table.createdByName || '',
                startTime: table.startTime || null,
                customerName: table.customerName || null
            }
        };
        logDelete('delete_item', details);

        // 6. Cập nhật UI
        showToast('🗑️ Đã xóa ' + removedItem.name + ' x' + removedItem.qty, 'success');
        showTableDetail(table.id);
    });
}

// ========== CHI TIẾT BÀN ==========
function showTableDetail(tableId) {
    currentTableDetailId = tableId;
    _getTableFromCache(tableId).then(function(table) {
        if (!table) return;
        var tableName = escapeHtml(table.name);
        var customerName = table.customerName ? ' (' + escapeHtml(table.customerName) + ')' : '';
        var lockInfo = getTableLockInfo(table);
        var lockBadge = lockInfo ? ' <span style="color:#dc2626;font-size:12px;">🔒 ' + lockInfo.reason + '</span>' : '';
        var creatorInfo = table.createdByName ? ' <span style="font-size:11px;color:#94a3b8;">👤 ' + escapeHtml(table.createdByName) + '</span>' : '';
        document.getElementById('detailTableName').innerHTML = '🪑 ' + tableName + customerName + lockBadge + creatorInfo;

        var itemsHtml = '', totalAmount = 0, totalQty = 0;
        // FIX: Lấy đầu ngày hôm nay (theo giờ địa phương) để so sánh
        var now = new Date();
        var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (table.items && table.items.length) {
            for (var i = 0; i < table.items.length; i++) {
                var item = table.items[i];
                totalAmount += item.price * item.qty;
                totalQty += item.qty;
                var timePart = '', datePart = '';
                if (item.addedTime) {
                    var d = new Date(item.addedTime);
                    timePart = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                    // Nếu món gọi khác ngày (qua đêm), hiển thị thêm ngày/tháng phía trên giờ
                    if (d < todayStart) {
                        datePart = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
                    }
                }
                itemsHtml += '<div class="cart-item">' +
                    '<span class="cart-item-time">' + (datePart ? '<span class="cart-item-date">' + datePart + '</span>' : '') + '<span class="cart-item-clock">' + (timePart ? timePart : '') + '</span></span>' +
                    '<span class="cart-item-name">' + escapeHtml(item.name) + '</span>' +
                    '<span class="cart-item-qty">x' + item.qty + '</span>' +
                    '<span class="cart-item-price">' + formatMoney(item.price * item.qty) + '</span>' +
                    '<button class="cart-item-delete" onclick="deleteTableItem(\'' + table.id + '\',' + i + ')" title="Xóa món">✖</button>' +
                '</div>';
            }
        } else {
            itemsHtml = '<div class="empty-state">✨ Chưa có món</div>';
        }
        document.getElementById('detailItems').innerHTML = itemsHtml;
        document.getElementById('detailSummary').innerHTML = '<div class="cart-total"><span class="cart-total-qty">📦 SL: ' + ('0' + totalQty).slice(-2) + '</span><span class="cart-total-amount">Tổng: ' + formatMoney(totalAmount) + '</span></div>';

        var isLocked = isTableLocked(table);
        
        // Nút in thủ công
        var printBtn = '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="printTableBill(\'' + table.id + '\')">🖨️ In hóa đơn</button>';
        
        // === PHẦN CHUNG: Nút mệnh giá thanh toán nhanh + Nút thanh toán ===
        var total = table.total || 0;
        var denoms = [
            { value: 50000, label: '50.000đ' },
            { value: 100000, label: '100.000đ' },
            { value: 200000, label: '200.000đ' },
            { value: 500000, label: '500.000đ' }
        ];
        var denomHtml = '<div class="cart-actions denom-actions">';
        denomHtml += '<button class="denom-btn denom-custom" onclick="showCustomDenomInput(\'' + table.id + '\')">✏️ Tùy chỉnh</button>';
        for (var d = 0; d < denoms.length; d++) {
            if (denoms[d].value >= total) {
                denomHtml += '<button class="denom-btn" onclick="cashPayWithDenom(\'' + table.id + '\',' + denoms[d].value + '); closeModal(\'tableDetailModal\')">' + denoms[d].label + '</button>';
            }
        }
        denomHtml += '</div>';

        var paymentButtonsHtml =
            '<div class="cart-actions payment-actions">' +
                '<button class="cart-action-btn cash" onclick="paymentAtTableWithCredit(\'' + table.id + '\',\'cash\'); closeModal(\'tableDetailModal\')">💰 Tiền mặt</button>' +
                '<button class="cart-action-btn transfer" onclick="paymentAtTableWithCredit(\'' + table.id + '\',\'transfer\'); closeModal(\'tableDetailModal\')">💳 Chuyển khoản</button>' +
                '<button class="cart-action-btn debt" onclick="debtAtTable(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">💢 Ghi nợ</button>' +
            '</div>';

        // === PHẦN KHÁC BIỆT: Locked vs Unlocked ===
        if (isLocked) {
            var editButtonsHtml =
                '<div class="cart-actions edit-actions">' +
                    '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="openAddMenuForTable(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">➕ Thêm món</button>' +
                    '<div style="display:flex;gap:8px;opacity:0.5;pointer-events:none;">' +
                        '<button class="cart-action-btn" style="background:#f1f5f9;flex:1;">🧾 Chia hóa đơn</button>' +
                        '<button class="cart-action-btn" style="background:#f1f5f9;flex:1;">🔄 Chuyển món</button>' +
                        '<button class="cart-action-btn" style="background:#f1f5f9;flex:1;">🔗 Gộp bàn</button>' +
                    '</div>' +
                    printBtn +
                    '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="requirePassword(\'xóa bàn\', function(){ showDeleteTableConfirm(\'' + table.id + '\'); closeModal(\'tableDetailModal\'); })">🗑️ Xóa bàn (🔒)</button>' +
                '</div>' +
                '<div style="text-align:center;color:#dc2626;font-size:12px;margin-bottom:8px;">🔒 ' + lockInfo.reason + ' - Chỉ được thanh toán/ghi nợ</div>';
            document.getElementById('detailActions').innerHTML = editButtonsHtml + denomHtml + paymentButtonsHtml;
        } else {
            var editButtonsHtml =
                '<div class="cart-actions edit-actions">' +
                    '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="openAddMenuForTable(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">➕ Thêm món</button>' +
                    '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="showSplitBillModal(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">🧾 Chia hóa đơn</button>' +
                    '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="showTransferItemsModal(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">🔄 Chuyển món</button>' +
                    '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="showMergeTableModal(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">🔗 Gộp bàn</button>' +
                    printBtn +
                    '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="showDeleteTableConfirm(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">🗑️ Xóa bàn</button>' +
                '</div>';
            document.getElementById('detailActions').innerHTML = editButtonsHtml + denomHtml + paymentButtonsHtml;
        }
        
        document.getElementById('tableDetailModal').style.display = 'flex';
    });
}

// ========== IN HÓA ĐƠN THỦ CÔNG ==========
function printTableBill(tableId) {
    // Hiển thị popup chọn hình thức in
    var overlay = document.createElement('div');
    overlay.className = 'print-choice-overlay';
    overlay.innerHTML =
        '<div class="print-choice-modal">' +
            '<div class="print-choice-title">🖨️ Chọn hình thức in</div>' +
            '<div class="print-choice-buttons">' +
                '<button class="print-choice-btn thermal" onclick="doPrintThermal(\'' + tableId + '\'); closePrintChoice(this)">' +
                    '<span class="print-choice-icon">🧾</span>' +
                    '<span class="print-choice-label">In nhiệt</span>' +
                    '<span class="print-choice-desc">Máy in hóa đơn Sunmi</span>' +
                '</button>' +
                '<button class="print-choice-btn pdf" onclick="doPrintPDF(\'' + tableId + '\'); closePrintChoice(this)">' +
                    '<span class="print-choice-icon">📄</span>' +
                    '<span class="print-choice-label">Xuất PDF</span>' +
                    '<span class="print-choice-desc">Lưu file PDF / In giấy A4</span>' +
                '</button>' +
            '</div>' +
            '<button class="print-choice-cancel" onclick="closePrintChoice(this)">✕ Đóng</button>' +
        '</div>';
    document.body.appendChild(overlay);
}

function closePrintChoice(btn) {
    var overlay = btn.closest ? btn.closest('.print-choice-overlay') : null;
    if (!overlay) overlay = document.querySelector('.print-choice-overlay');
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
}

function doPrintThermal(tableId) {
    _getTableFromCache(tableId).then(function(table) {
        if (!table) return;
        if (typeof printAfterPayment === 'function') {
            var now = new Date();
            printAfterPayment({
                orderType: 'dinein',
                amount: table.total,
                paymentMethod: 'manual_print',
                items: table.items,
                tableName: table.name,
                customer: table.customerName ? { name: table.customerName } : null,
                tableTime: table.startTime ? _calcTableTime(table.startTime) : null,
                startTime: table.startTime ? new Date(table.startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : null,
                endTime: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                createdAt: now.toISOString()
            });
        } else {
            showToast('Chức năng in chưa sẵn sàng', 'warning');
        }
    });
}

function doPrintPDF(tableId) {
    _getTableFromCache(tableId).then(function(table) {
        if (!table) return;
        if (typeof exportBillPDF === 'function') {
            var now = new Date();
            exportBillPDF({
                orderType: 'dinein',
                amount: table.total,
                paymentMethod: 'manual_print',
                items: table.items,
                tableName: table.name,
                customer: table.customerName ? { name: table.customerName } : null,
                tableTime: table.startTime ? _calcTableTime(table.startTime) : null,
                startTime: table.startTime ? new Date(table.startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : null,
                endTime: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                createdAt: now.toISOString()
            });
        } else {
            showToast('Chức năng xuất PDF chưa sẵn sàng', 'warning');
        }
    });
}

/**
 * Tính thời gian khách ngồi từ startTime đến hiện tại
 */
function _calcTableTime(startTime) {
    if (!startTime) return null;
    var st = new Date(startTime);
    var now = new Date();
    var elapsed = now.getTime() - st.getTime();
    var hours = Math.floor(elapsed / 3600000);
    var mins = Math.floor((elapsed % 3600000) / 60000);
    if (hours > 0) {
        return hours + 'h' + (mins > 0 ? mins + 'p' : '');
    }
    return mins + 'p';
}

// tables.js - Phần sửa hàm openAddMenuForTable

function openAddMenuForTable(tableId) {
    // Kiểm tra nếu là màn hình dọc (điện thoại) -> yêu cầu xác nhận
    var isPortrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
    if (isPortrait) {
        if (!confirm('Xác nhận thêm món?')) {
            return;
        }
    }
    currentAddToTableId = tableId;
    tempOrder = [];
    selectedCustomer = null;
    // Gọi hàm mở modal order với cấu trúc 3 cột
    openOrderModal();
}

function showPaymentForTable(tableId) {
    pendingPaymentTableId = tableId;
    // Hiển thị tùy chọn in hóa đơn
    var printOption = document.getElementById('paymentPrintOption');
    if (printOption) printOption.style.display = 'block';
    document.getElementById('paymentMethodModal').style.display = 'flex';
}

function paymentAtTable(tableId, method) {
    // Luôn yêu cầu xác nhận trước khi thanh toán
    _getTableFromCache(tableId).then(function(table) {
        if (!table) return;
        var total = table.total || 0;
        var methodLabels = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', debt: 'Ghi nợ' };
        var label = methodLabels[method] || method;
        if (!confirm('💳 Xác nhận thanh toán bằng ' + label + '?\n💰 Tổng tiền: ' + formatMoney(total))) {
            return;
        }
        if (method === 'cash') {
            // Tiền mặt: ẩn toast tiền dư (nếu có) rồi thanh toán luôn
            _hideChangeToast();
            _processPaymentDirect(tableId, 'cash');
        } else {
            // Chuyển khoản / Ghi nợ -> thanh toán ngay
            _processPaymentDirect(tableId, method);
        }
    });
}

// OPTIMIZE: paymentAtTableWithCredit - đóng modal ngay, xử lý credit nhanh hơn
function paymentAtTableWithCredit(tableId, method) {
    // OPTIMIZE: Đóng modal ngay lập tức
    if (currentTableDetailId === tableId) closeModal('tableDetailModal');
    
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length) return;
        
        // Kiểm tra nếu là màn hình dọc (điện thoại) -> yêu cầu xác nhận với số tiền
        var isPortrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
        if (isPortrait) {
            var total = table.total || 0;
            var methodLabels = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', debt: 'Ghi nợ' };
            var label = methodLabels[method] || method;
            if (!confirm('💳 Xác nhận thanh toán bằng ' + label + '?\n💰 Tổng tiền: ' + formatMoney(total))) {
                return;
            }
        }
        
        // FIX: Nếu đã qua _changeToastPay (tiền dư đã được lưu), bỏ qua kiểm tra credit
        // để tránh trừ credit 2 lần
        if (!_skipCreditCheck && table.customerId) {
            for (var i = 0; i < customers.length; i++) {
                if (customers[i].id === table.customerId) {
                    if ((customers[i].creditBalance || 0) > 0) {
                        if (confirm('💰 ' + customers[i].name + ' có ' + formatMoney(customers[i].creditBalance) + ' tiền dư.\nDùng số dư này để thanh toán?')) {
                            var creditUsed = Math.min(customers[i].creditBalance || 0, table.total);
                            if (creditUsed > 0) {
                                useCustomerCredit(customers[i].id, creditUsed, 'Trừ tiền dư khi thanh toán bàn ' + table.name).then(function(used) {
                                    if (used > 0) {
                                        showToast('✅ Đã trừ ' + formatMoney(used) + ' từ tiền dư của ' + customers[i].name, 'success');
                                    }
                                    _hideChangeToast();
                                    _processPaymentDirect(tableId, method);
                                });
                                return;
                            }
                        }
                    }
                    break;
                }
            }
        }
        _hideChangeToast();
        _processPaymentDirect(tableId, method);
    });
}

// OPTIMIZE: _processPaymentDirect - đóng modal ngay, song song hóa Promise, dùng _checkAndDeductIngredients
function _processPaymentDirect(tableId, method) {
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length) return;
        
        // OPTIMIZE: Đóng modal ngay lập tức để UI không bị đơ
        if (currentTableDetailId === tableId) closeModal('tableDetailModal');
        _paymentToastId = showToast('⏳ Đang xử lý thanh toán...', 'info', 0);
        
        // OPTIMIZE: Suppress realtime notifications trong quá trình batch operations
        DB.suppressRealtime();
        
        var now = new Date();
        var items = table.items;
        var total = table.total;
        var tableName = table.name;
        var customerId = table.customerId;
        var customerName = table.customerName;
        var startTime = table.startTime;
        var endTime = now.toISOString();
        
        // Tính thời gian khách ngồi (có thể tính song song)
        var tableTime = '';
        if (startTime) {
            var st = new Date(startTime);
            var elapsed = now.getTime() - st.getTime();
            var hours = Math.floor(elapsed / 3600000);
            var mins = Math.floor((elapsed % 3600000) / 60000);
            tableTime = hours > 0 ? hours + 'h' + (mins > 0 ? mins + 'p' : '') : mins + 'p';
        }
        
        // FIX: Kiểm tra credit của khách - chỉ kiểm tra nếu chưa qua _changeToastPay
        // (vì _changeToastPay đã lưu tiền dư và set _skipCreditCheck = true)
        var finalAmount = total;
        var creditUsed = 0;
        var customerInfo = customerName ? { name: customerName } : null;
        
        if (!_skipCreditCheck && customerId) {
            for (var i = 0; i < customers.length; i++) {
                if (customers[i].id === customerId) {
                    if ((customers[i].creditBalance || 0) > 0) {
                        creditUsed = Math.min(customers[i].creditBalance || 0, finalAmount);
                        if (creditUsed > 0) {
                            finalAmount = finalAmount - creditUsed;
                            customerInfo = { id: customerId, name: customerName };
                        }
                    }
                    break;
                }
            }
        }
        // Reset flag sau khi đã xử lý
        _skipCreditCheck = false;
        
        // OPTIMIZE: Gộp checkStock + deductIngredients thành 1 lần duyệt
        // Cho phép âm kho - không chặn giao dịch khi hết nguyên liệu
        var stockAndDeductPromise = _checkAndDeductIngredients(items).then(function() {
            return true;
        }).catch(function(err) {
            console.warn('⚠️ Nguyên liệu không đủ (cho phép âm kho):', err.message);
            return true; // Vẫn cho phép giao dịch tiếp tục
        });
        
        stockAndDeductPromise.then(function(stockOk) {
            if (!stockOk) {
                hideToast(_paymentToastId);
                DB.flushRealtime();
                return;
            }
            
            // OPTIMIZE: Chạy song song creditUpdate + addHistory + remove
            var creditPromise = Promise.resolve();
            if (creditUsed > 0 && customerId) {
                creditPromise = useCustomerCredit(customerId, creditUsed, 'Trừ tiền dư khi thanh toán bàn ' + tableName);
            }
            
            // OPTIMIZE: Chạy song song deduct và credit
            Promise.all([stockAndDeductPromise, creditPromise]).then(function() {
                // addHistory và DB.remove có thể chạy song song
                var historyPromise = addHistory({
                    type: 'dinein',
                    amount: finalAmount,
                    paymentMethod: method,
                    items: items,
                    customer: customerInfo,
                    tableName: tableName,
                    tableId: tableId,
                    note: creditUsed > 0 ? 'Đã dùng ' + formatMoney(creditUsed) + ' tiền dư' : '',
                    createdAt: now.toISOString(),
                    tableTime: tableTime,
                    startTime: startTime,
                    endTime: endTime
                });
                
                var removePromise = DB.remove('tables', String(tableId));
                
                Promise.all([historyPromise, removePromise]).then(function() {
                    // OPTIMIZE: Flush realtime sau khi tất cả operations hoàn tất
                    DB.flushRealtime();
                    
                    // AUDIT: Nếu thanh toán tiền mặt, kiểm tra két
                    // handleCashPayment luôn tồn tại (định nghĩa trong pos.html)
                    if (method === 'cash') {
                        handleCashPayment(finalAmount, null, {type: 'dinein', tableName: tableName, customer: customerInfo}).catch(function(err) {
                            console.error('[AUDIT] handleCashPayment lỗi:', err);
                        });
                    }
                    
                    // Gửi thông báo Telegram (fire-and-forget, không chờ)
                    if (typeof notifyPaymentToTelegram === 'function') {
                        notifyPaymentToTelegram({
                            type: 'dinein',
                            amount: finalAmount,
                            paymentMethod: method,
                            items: items,
                            tableName: tableName,
                            customer: customerInfo,
                            createdAt: now.toISOString()
                        });
                    }
                    
                    hideToast(_paymentToastId);
                    var msg = '✅ Thanh toán ' + formatMoney(finalAmount) + ' thành công';
                    if (creditUsed > 0) msg += ' (đã dùng ' + formatMoney(creditUsed) + ' tiền dư)';
                    showToast(msg, 'success');
                    // Cập nhật doanh thu pos-cash-info realtime
                    _dispatchPosCashUpdate();
                });
            }).catch(function(err) {
                hideToast(_paymentToastId);
                DB.flushRealtime();
                showToast('❌ Lỗi thanh toán: ' + (err.message || err), 'error');
            });
        });
    });
}

// Biến lưu trạng thái toast tiền dư
var _changeToastEl = null;
var _changeToastTableId = null;

// ========== HIỂN THỊ SỐ TIỀN DƯ KHI CHỌN MỆNH GIÁ ==========
// Click nút mệnh giá → chỉ toast số tiền dư cần trả, KHÔNG thanh toán
// Click TM hoặc nút trong toast → thanh toán và ẩn toast
// Click ✕ → đóng toast (đổi PTTT)
function cashPayWithDenom(tableId, givenAmount) {
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length) return;
        var total = table.total;
        if (givenAmount < total) {
            showToast('❌ Số tiền ' + formatMoney(givenAmount) + ' không đủ!', 'error');
            return;
        }
        var change = givenAmount - total;
        // Xóa toast cũ nếu có
        _hideChangeToast();
        // Lưu tableId và số tiền khách đưa để nút thanh toán trong toast có thể dùng
        _changeToastTableId = tableId;
        _changeToastGivenAmount = givenAmount;
        
        // Kiểm tra nếu bàn có gán khách hàng và có tiền dư
        var creditNote = '';
        if (change > 0 && table.customerId) {
            creditNote = '<div style="font-size:12px;color:#d97706;margin-top:6px;">💡 Khách có ' + formatMoney(change) + ' tiền dư sẽ được lưu làm tiền trả trước</div>';
        }
        
        // Tạo toast đặc biệt to, nổi bật
        var toast = document.createElement('div');
        toast.className = 'change-toast';
        toast.id = 'changeToast';
        toast.innerHTML =
            '<div class="change-label">💵 TIỀN DƯ</div>' +
            '<div class="change-given">Khách đưa: ' + formatMoney(givenAmount) + '</div>' +
            '<div class="change-amount">' + formatMoney(change) + '</div>' +
            creditNote +
            '<div style="display:flex;gap:8px;margin-top:10px;">' +
                '<button onclick="_changeToastPay()" style="flex:1;padding:10px;border-radius:40px;border:none;background:#f97316;color:#fff;font-weight:700;font-size:14px;cursor:pointer;-webkit-appearance:none;">✅ Thanh toán</button>' +
                '<button onclick="_hideChangeToast()" style="padding:10px 16px;border-radius:40px;border:none;background:#475569;color:#fff;font-size:13px;cursor:pointer;-webkit-appearance:none;">✕</button>' +
            '</div>';
        document.body.appendChild(toast);
        _changeToastEl = toast;
    });
}

// ========== POPUP NHẬP SỐ TIỀN TÙY CHỈNH ==========
function showCustomDenomInput(tableId) {
    // Xóa popup cũ nếu có
    var oldOverlay = document.getElementById('customDenomOverlay');
    if (oldOverlay) oldOverlay.remove();

    var overlay = document.createElement('div');
    overlay.id = 'customDenomOverlay';
    overlay.className = 'custom-denom-overlay';
    overlay.innerHTML =
        '<div class="custom-denom-modal">' +
            '<div class="custom-denom-header">✏️ Nhập số tiền</div>' +
            '<div class="custom-denom-body">' +
                '<input type="number" id="customDenomInput" class="custom-denom-input" placeholder="0" min="0" step="1000" inputmode="numeric">' +
                '<div class="custom-denom-suggestions">' +
                    '<button class="denom-suggest-btn" data-amount="20000">20.000đ</button>' +
                    '<button class="denom-suggest-btn" data-amount="50000">50.000đ</button>' +
                    '<button class="denom-suggest-btn" data-amount="100000">100.000đ</button>' +
                    '<button class="denom-suggest-btn" data-amount="200000">200.000đ</button>' +
                    '<button class="denom-suggest-btn" data-amount="500000">500.000đ</button>' +
                    '<button class="denom-suggest-btn" data-amount="1000000">1.000.000đ</button>' +
                '</div>' +
            '</div>' +
            '<div class="custom-denom-footer">' +
                '<button class="denom-cancel-btn" onclick="closeCustomDenomInput()">Hủy</button>' +
                '<button class="denom-confirm-btn" onclick="confirmCustomDenom(\'' + tableId + '\')">Xác nhận</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);

    // Focus vào input
    setTimeout(function() {
        var input = document.getElementById('customDenomInput');
        if (input) input.focus();
    }, 100);

    // Gán sự kiện click cho các nút gợi ý
    var suggestBtns = overlay.querySelectorAll('.denom-suggest-btn');
    for (var i = 0; i < suggestBtns.length; i++) {
        suggestBtns[i].onclick = function() {
            var amount = parseInt(this.getAttribute('data-amount'));
            document.getElementById('customDenomInput').value = amount;
        };
    }

    // Enter để xác nhận
    setTimeout(function() {
        var input = document.getElementById('customDenomInput');
        if (input) {
            input.onkeydown = function(e) {
                if (e.key === 'Enter') {
                    confirmCustomDenom(tableId);
                }
            };
        }
    }, 200);
}

function closeCustomDenomInput() {
    var overlay = document.getElementById('customDenomOverlay');
    if (overlay) overlay.remove();
}

function confirmCustomDenom(tableId) {
    var input = document.getElementById('customDenomInput');
    if (!input) return;
    var amount = parseInt(input.value);
    if (!amount || amount <= 0) {
        showToast('❌ Vui lòng nhập số tiền hợp lệ', 'error');
        return;
    }
    closeCustomDenomInput();
    closeModal('tableDetailModal');
    cashPayWithDenom(tableId, amount);
}

function _changeToastPay() {
    var tid = _changeToastTableId;
    var givenAmount = _changeToastGivenAmount;
    _hideChangeToast();
    if (tid) {
        // Lưu tiền dư vào credit của khách nếu bàn có gán khách
        _getTableFromCache(tid).then(function(table) {
            if (!table) {
                paymentAtTableWithCredit(tid, 'cash');
                return;
            }
            var change = givenAmount - (table.total || 0);
            if (change > 0 && table.customerId) {
                // Có tiền dư và bàn có gán khách -> lưu credit trước
                var customer = null;
                for (var i = 0; i < customers.length; i++) {
                    if (customers[i].id === table.customerId) {
                        customer = customers[i];
                        break;
                    }
                }
                if (customer) {
                    addCustomerCredit(customer.id, change, 'Trả dư khi thanh toán bàn ' + table.name).then(function() {
                        showToast('💰 Đã lưu ' + formatMoney(change) + ' tiền dư cho ' + customer.name, 'success');
                        // FIX: Đánh dấu đã qua _changeToastPay để paymentAtTableWithCredit
                        // và _processPaymentDirect không kiểm tra credit thêm lần nữa
                        _skipCreditCheck = true;
                        paymentAtTableWithCredit(tid, 'cash');
                    });
                    return;
                }
            }
            paymentAtTableWithCredit(tid, 'cash');
        });
    }
}

function _hideChangeToast() {
    if (_changeToastEl) {
        if (_changeToastEl.parentNode) _changeToastEl.remove();
        _changeToastEl = null;
    }
    _changeToastTableId = null;
    _changeToastGivenAmount = 0;
}

// OPTIMIZE: debtAtTable - đóng modal ngay, song song hóa Promise, batch ingredients
function debtAtTable(tableId) {
    // OPTIMIZE: Đóng modal ngay lập tức
    if (currentTableDetailId === tableId) closeModal('tableDetailModal');
    _paymentToastId = showToast('⏳ Đang xử lý ghi nợ...', 'info', 0);
    
    // OPTIMIZE: Suppress realtime notifications trong quá trình batch operations
    DB.suppressRealtime();
    
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length || !table.total || table.total <= 0) {
            hideToast(_paymentToastId);
            DB.flushRealtime();
            if (table && (!table.total || table.total <= 0)) {
                showToast('❌ Bàn chưa có món hoặc tổng tiền = 0, không thể ghi nợ!', 'warning');
            }
            return;
        }
        showCustomerSelector(function(customer) {
            var now = new Date();
            var endTime = now.toISOString();
            
            // Tính thời gian khách ngồi
            var tableTime = '';
            if (table.startTime) {
                var startTime = new Date(table.startTime);
                var elapsed = now.getTime() - startTime.getTime();
                var hours = Math.floor(elapsed / 3600000);
                var mins = Math.floor((elapsed % 3600000) / 60000);
                if (hours > 0) {
                    tableTime = hours + 'h' + (mins > 0 ? mins + 'p' : '');
                } else {
                    tableTime = mins + 'p';
                }
            }
            
            // OPTIMIZE: Gộp checkStock + deductIngredients thành 1 lần duyệt
            // Cho phép âm kho - không chặn giao dịch khi hết nguyên liệu
            var stockAndDeductPromise = new Promise(function(resolve, reject) {
                _buildLookups();
                var updates = [];
                for (var i = 0; i < table.items.length; i++) {
                    var orderItem = table.items[i];
                    var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
                    var menuItem = _menuLookup[orderItem.id] || _menuLookup[baseName];
                    if (menuItem) {
                        var ings = _getIngredientsForItem(menuItem, orderItem);
                        for (var k = 0; k < ings.length; k++) {
                            var req = ings[k];
                            var ing = _ingredientLookup[req.ingredientId];
                            if (ing) {
                                var needed = _getConvertedQuantity(ing, req.quantity * orderItem.qty, req.unit);
                                // Cho phép âm kho - không chặn giao dịch khi hết nguyên liệu
                                // Deduct
                                ing.stock = (ing.stock || 0) - needed;
                                updates.push(DB.update('ingredients', ing.id, { stock: ing.stock }));
                                
                                var unit = ing.unit || '';
                                var note = 'Bán: ' + orderItem.name + ' x' + orderItem.qty + ' (-' + Math.round(needed * 1000) / 1000 + ' ' + unit + ')';
                                _logIngredientTransaction(ing.id, 'export', Math.round(needed * 1000) / 1000, unit, note).catch(function(err) {
                                    console.error('Log export error:', err);
                                });
                            }
                        }
                    }
                }
                resolve(Promise.all(updates));
            });
            
            stockAndDeductPromise.then(function(result) {
                if (!result) {
                    hideToast(_paymentToastId);
                    DB.flushRealtime();
                    return;
                }
                
                // OPTIMIZE: Chạy song song addCustomerDebt + (result là Promise.all đã resolve)
                var debtPromise = addCustomerDebt(customer.id, table.total, 'Mua tai ' + table.name, table.items);
                
                debtPromise.then(function(debtResult) {
                    var debtAmount = debtResult.debtAmount;
                    var creditUsed = debtResult.creditUsed;
                    var note = creditUsed > 0 ? 'Đã dùng ' + formatMoney(creditUsed) + ' tiền dư' : '';
                    
                    // OPTIMIZE: addHistory và DB.remove chạy song song
                    var historyPromise = addHistory({
                        type: 'debt_payment',
                        amount: debtAmount,
                        paymentMethod: 'debt',
                        items: table.items,
                        customer: { id: customer.id, name: customer.name },
                        tableName: table.name,
                        tableId: tableId,
                        note: note,
                        createdAt: now.toISOString(),
                        tableTime: tableTime,
                        startTime: table.startTime,
                        endTime: endTime
                    });
                    
                    var removePromise = DB.remove('tables', String(tableId));
                    
                    Promise.all([historyPromise, removePromise]).then(function() {
                        // OPTIMIZE: Flush realtime sau khi tất cả operations hoàn tất
                        DB.flushRealtime();
                        
                        // Gửi thông báo Telegram giao dịch ghi nợ
                        // FIX: Sửa type từ 'dinein' thành 'debt_payment' để phân biệt với thanh toán tại bàn
                        if (typeof notifyPaymentToTelegram === 'function') {
                            notifyPaymentToTelegram({
                                type: 'debt_payment',
                                amount: debtAmount,
                                paymentMethod: 'debt',
                                items: table.items,
                                tableName: table.name,
                                customer: { id: customer.id, name: customer.name },
                                createdAt: now.toISOString()
                            });
                        }
                        
                        hideToast(_paymentToastId);
                        var msg = '💰 Đã ghi nợ ' + formatMoney(debtAmount) + ' cho ' + customer.name;
                        if (creditUsed > 0) msg += ' (đã trừ ' + formatMoney(creditUsed) + ' tiền dư)';
                        showToast(msg, 'success');
                        
                        // In hóa đơn (fire-and-forget, không chờ)
                        var printCheck = document.getElementById('printAfterPaymentCheck');
                        if (printCheck && printCheck.checked && typeof printAfterPayment === 'function') {
                            printAfterPayment({
                                orderType: 'debt_payment',
                                amount: debtAmount,
                                paymentMethod: 'debt',
                                items: table.items,
                                tableName: table.name,
                                customer: { id: customer.id, name: customer.name },
                                tableTime: table.startTime ? _calcTableTime(table.startTime) : null,
                                startTime: table.startTime ? new Date(table.startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : null,
                                endTime: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                                createdAt: now.toISOString()
                            });
                        }
                    });
                }).catch(function(err) {
                    hideToast(_paymentToastId);
                    DB.flushRealtime();
                    showToast('❌ Lỗi ghi nợ: ' + (err.message || err), 'error');
                });
            }).catch(function(err) {
                hideToast(_paymentToastId);
                DB.flushRealtime();
                showToast('❌ Lỗi xử lý nguyên liệu: ' + (err.message || err), 'error');
            });
        });
    });
}

function showCustomerSelectorForTable(tableId) {
    showCustomerSelector(function(customer) {
        DB.update('tables', String(tableId), { customerId: customer.id, customerName: customer.name }).then(function() {
            // Realtime subscription sẽ tự động cập nhật tables
            if (currentTableDetailId === tableId) showTableDetail(tableId);
            showToast('✅ Đã gán khách ' + customer.name + ' cho bàn', 'success');
        });
    });
}

// ========== CHIA HÓA ĐƠN ==========
function confirmSplitPaymentWithMethod(method, customer) {
    var tableId = pendingSplitTableId;
    if (!tableId) return;
    
    _getTableFromCache(tableId).then(function(table) {
        if (!table) return;
        
        // Lấy các món đã chọn để thanh toán (giống logic cũ)
        var splitItems = [];
        var remainingItems = [];
        for (var i = 0; i < table.items.length; i++) {
            remainingItems.push({
                name: table.items[i].name,
                price: table.items[i].price,
                qty: table.items[i].qty
            });
        }
        
        var rows = document.querySelectorAll('.split-item-row');
        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var idx = parseInt(row.getAttribute('data-idx'));
            var input = document.getElementById('split-qty-' + idx);
            var qty = input ? parseInt(input.value) : 0;
            if (qty > 0) {
                var item = remainingItems[idx];
                if (qty > item.qty) qty = item.qty;
                splitItems.push({
                    name: item.name,
                    price: item.price,
                    qty: qty
                });
                item.qty -= qty;
            }
        }
        
        if (splitItems.length === 0) {
            showToast('Chưa chọn món để thanh toán!', 'warning');
            return;
        }
        
        var splitTotal = splitItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        var finalItems = remainingItems.filter(function(i) { return i.qty > 0; });
        var newTotal = finalItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        
        // Trừ nguyên liệu (cho phép âm kho - không chặn giao dịch khi hết nguyên liệu)
        deductIngredients(splitItems).then(function() {
            // Nếu là ghi nợ, cần có customer
            if (method === 'debt' && !customer) {
                showToast('Cần chọn khách hàng để ghi nợ!', 'warning');
                return;
            }
            
            // Cập nhật bàn: giảm số lượng món đã thanh toán
            DB.update('tables', String(tableId), { items: finalItems, total: newTotal }).then(function() {
                // Tính thời gian khách ngồi
                var tableTime = '';
                if (table.startTime) {
                    var startTime = new Date(table.startTime);
                    var endTime = new Date();
                    var elapsed = endTime.getTime() - startTime.getTime();
                    var hours = Math.floor(elapsed / 3600000);
                    var mins = Math.floor((elapsed % 3600000) / 60000);
                    if (hours > 0) {
                        tableTime = hours + 'h' + (mins > 0 ? mins + 'p' : '');
                    } else {
                        tableTime = mins + 'p';
                    }
                }
                // Lưu lịch sử giao dịch
                var historyPromise;
                if (method === 'debt') {
                        // Ghi nợ: cộng nợ cho khách
                        addCustomerDebt(customer.id, splitTotal, 'Chia hóa đơn tại bàn ' + table.name, splitItems).then(function() {
                            historyPromise = addHistory({
                                type: 'debt_payment',
                                amount: splitTotal,
                                paymentMethod: 'debt',
                                items: splitItems,
                                customer: { id: customer.id, name: customer.name },
                                tableName: table.name,
                                tableId: tableId,
                                note: 'Chia hóa đơn',
                                tableTime: tableTime
                            });
                        });
                    } else {
                        historyPromise = addHistory({
                            type: 'dinein',
                            amount: splitTotal,
                            paymentMethod: method,
                            items: splitItems,
                            customer: null,
                            tableName: table.name,
                            tableId: tableId,
                            note: 'Chia hóa đơn',
                            tableTime: tableTime
                        });
                    }
                    
                    Promise.resolve(historyPromise).then(function() {
                        // AUDIT: Nếu thanh toán tiền mặt, kiểm tra két
                        if (method === 'cash') {
                            handleCashPayment(splitTotal, null, {type: 'dinein', tableName: table.name, customer: null}).catch(function(err) {
                                console.error('[AUDIT] handleCashPayment lỗi:', err);
                            });
                        }
                        
                        // Gửi thông báo Telegram giao dịch chia hóa đơn
                        // FIX: Sửa type đúng: 'dinein' cho cash/transfer, 'debt_payment' cho debt
                        if (typeof notifyPaymentToTelegram === 'function') {
                            notifyPaymentToTelegram({
                                type: method === 'debt' ? 'debt_payment' : 'dinein',
                                amount: splitTotal,
                                paymentMethod: method,
                                items: splitItems,
                                tableName: table.name,
                                customer: method === 'debt' && customer ? { id: customer.id, name: customer.name } : null,
                                createdAt: new Date().toISOString()
                            });
                        }
                        
                        // Realtime subscription sẽ tự động cập nhật tables, history, report
                        if (currentTableDetailId === tableId) showTableDetail(tableId);
                        closeModal('splitBillModal');
                        showToast('✅ Đã thanh toán phần chia ' + formatMoney(splitTotal) + (method === 'debt' ? ' (ghi nợ)' : ''), 'success');
                });
            });
        });
    });
}

function showSplitBillModal(tableId) {
    pendingSplitTableId = tableId;
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || table.items.length < 2) {
            showToast('Cần ít nhất 2 món để chia hóa đơn!', 'warning');
            return;
        }
        var container = document.getElementById('splitItemsList');
        if (!container) return;
        
        // Tạo danh sách các món với ô nhập số lượng
        var html = '';
        for (var i = 0; i < table.items.length; i++) {
            var item = table.items[i];
            html += '<div class="split-item-row" data-idx="' + i + '" data-price="' + item.price + '" data-max="' + item.qty + '">' +
                '<span>' + escapeHtml(item.name) + '</span>' +
                '<div class="split-qty-control">' +
                    '<button class="split-qty-minus" data-idx="' + i + '">-</button>' +
                    '<input type="number" class="split-qty-input" id="split-qty-' + i + '" value="0" min="0" max="' + item.qty + '" step="1">' +
                    '<button class="split-qty-plus" data-idx="' + i + '">+</button>' +
                    '<span>/ ' + item.qty + '</span>' +
                '</div>' +
                '<span id="split-price-' + i + '" class="split-item-price">0đ</span>' +
            '</div>';
        }
        container.innerHTML = html;
        
        // Gắn sự kiện tăng/giảm số lượng
        attachSplitQtyEvents();
        updateSplitTotal();
        
        // *** THAY ĐỔI KHU VỰC NÚT ***
        var formActions = document.querySelector('#splitBillModal .form-actions');
        if (formActions) {
            formActions.innerHTML = `
                <button class="cart-action-btn cash" id="splitCashBtn">💰 Tiền mặt</button>
                <button class="cart-action-btn transfer" id="splitTransferBtn">💳 Chuyển khoản</button>
                <button class="cart-action-btn debt" id="splitDebtBtn">💢 Ghi nợ</button>
                <button class="btn-cancel" onclick="closeModal('splitBillModal')">Hủy</button>
            `;
            
            // Gắn sự kiện cho các nút mới
            document.getElementById('splitCashBtn').onclick = function() {
                confirmSplitPaymentWithMethod('cash', null);
            };
            document.getElementById('splitTransferBtn').onclick = function() {
                confirmSplitPaymentWithMethod('transfer', null);
            };
            document.getElementById('splitDebtBtn').onclick = function() {
                showCustomerSelector(function(customer) {
                    confirmSplitPaymentWithMethod('debt', customer);
                });
            };
        }
        
        document.getElementById('splitBillModal').style.display = 'flex';
    });
}

function attachSplitQtyEvents() {
    var minusBtns = document.querySelectorAll('.split-qty-minus');
    var plusBtns = document.querySelectorAll('.split-qty-plus');
    for (var i = 0; i < minusBtns.length; i++) {
        minusBtns[i].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('split-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value) || 0;
                    if (val > 0) input.value = val - 1;
                    updateSplitTotal();
                }
            };
        })(minusBtns[i]);
    }
    for (var i = 0; i < plusBtns.length; i++) {
        plusBtns[i].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('split-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value) || 0;
                    var max = parseInt(input.getAttribute('max')) || 0;
                    if (val < max) input.value = val + 1;
                    updateSplitTotal();
                }
            };
        })(plusBtns[i]);
    }
}

function updateSplitTotal() {
    var total = 0;
    var rows = document.querySelectorAll('.split-item-row');
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var idx = row.getAttribute('data-idx');
        var price = parseInt(row.getAttribute('data-price'));
        var input = document.getElementById('split-qty-' + idx);
        var qty = input ? parseInt(input.value) : 0;
        var itemTotal = price * qty;
        total += itemTotal;
        var priceSpan = document.getElementById('split-price-' + idx);
        if (priceSpan) priceSpan.innerText = formatMoney(itemTotal);
    }
    var totalSpan = document.getElementById('splitTotalAmount');
    if (totalSpan) totalSpan.innerText = formatMoney(total);
}


// ========== CHUYỂN MÓN ==========
function showTransferItemsModal(sourceId) {
    _getTableFromCache(sourceId).then(function(table) {
        if (!table || !table.items || !table.items.length) { showToast('Không có món để chuyển!', 'warning'); return; }
        pendingTransferSourceTable = table;
        var container = document.getElementById('transferItemsList');
        if (!container) return;
        var html = '';
        for (var i = 0; i < table.items.length; i++) {
            var item = table.items[i];
            html += '<div class="transfer-item-row" data-idx="' + i + '" data-price="' + item.price + '" data-max="' + item.qty + '">' +
                '<span>' + escapeHtml(item.name) + '</span>' +
                '<div class="transfer-qty-control">' +
                    '<button class="transfer-qty-minus" data-idx="' + i + '">-</button>' +
                    '<input type="number" class="transfer-qty-input" id="transfer-qty-' + i + '" value="0" min="0" max="' + item.qty + '" step="1" style="width:60px;text-align:center;">' +
                    '<button class="transfer-qty-plus" data-idx="' + i + '">+</button>' +
                    '<span>/ ' + item.qty + '</span>' +
                '</div>' +
            '</div>';
        }
        container.innerHTML = html;
        attachTransferQtyEvents();
        var targetInput = document.getElementById('transferTargetTable');
        if (targetInput) targetInput.value = '';
        document.getElementById('transferItemsModal').style.display = 'flex';
    });
}

function attachTransferQtyEvents() {
    var minusBtns = document.querySelectorAll('.transfer-qty-minus');
    var plusBtns = document.querySelectorAll('.transfer-qty-plus');
    for (var i = 0; i < minusBtns.length; i++) {
        minusBtns[i].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('transfer-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value) || 0;
                    if (val > 0) input.value = val - 1;
                }
            };
        })(minusBtns[i]);
    }
    for (var i = 0; i < plusBtns.length; i++) {
        plusBtns[i].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('transfer-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value) || 0;
                    var max = parseInt(input.getAttribute('max')) || 0;
                    if (val < max) input.value = val + 1;
                }
            };
        })(plusBtns[i]);
    }
}

function confirmTransferItems() {
    if (!pendingTransferSourceTable) return;
    var selectedItems = [];
    var remainingItems = [];
    for (var i = 0; i < pendingTransferSourceTable.items.length; i++) {
        remainingItems.push({ name: pendingTransferSourceTable.items[i].name, price: pendingTransferSourceTable.items[i].price, qty: pendingTransferSourceTable.items[i].qty });
    }
    var rows = document.querySelectorAll('.transfer-item-row');
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var idx = parseInt(row.getAttribute('data-idx'));
        var input = document.getElementById('transfer-qty-' + idx);
        var qty = input ? parseInt(input.value) : 0;
        if (qty > 0) {
            var item = remainingItems[idx];
            if (qty > item.qty) qty = item.qty;
            selectedItems.push({ name: item.name, price: item.price, qty: qty });
            item.qty -= qty;
        }
    }
    if (selectedItems.length === 0) { showToast('Chưa chọn món để chuyển!', 'warning'); return; }
    var targetName = document.getElementById('transferTargetTable').value.trim();
    if (!targetName) { showToast('Nhập tên bàn đích!', 'warning'); return; }
    // Dùng cachedTables nếu có, fallback DB.getAll
    var allTablesPromise = (window.cachedTables && Array.isArray(window.cachedTables) && window.cachedTables.length > 0)
        ? Promise.resolve(window.cachedTables)
        : DB.getAll('tables');
    allTablesPromise.then(function(allTables) {
        var targetTable = null;
        for (var i = 0; i < allTables.length; i++) {
            if (allTables[i].name === targetName) { targetTable = allTables[i]; break; }
        }
        var createNew = false;
        if (!targetTable) {
            createNew = true;
            var maxNum = 0;
            for (var i = 0; i < allTables.length; i++) {
                var match = allTables[i].name.match(/Ban (\d+)/);
                if (match && parseInt(match[1]) > maxNum) maxNum = parseInt(match[1]);
            }
            var newNumber = maxNum + 1;
            if (newNumber > 99) { showToast('Đã đạt giới hạn 99 bàn!', 'warning'); return; }
            var newId = Date.now().toString();
            var now = new Date();
            var currentUser = DB.getCurrentUser();
            targetTable = {
                id: newId, name: targetName, status: 'occupied',
                time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                startTime: now.toISOString(),
                items: [], total: 0, customerId: null, customerName: null,
                createdByName: (currentUser && currentUser.displayName) || '',
                createdByRole: (currentUser && currentUser.role) || ''
            };
        }
        var targetItems = targetTable.items || [];
        for (var i = 0; i < selectedItems.length; i++) {
            var sel = selectedItems[i];
            var found = false;
            for (var j = 0; j < targetItems.length; j++) {
                if (targetItems[j].name === sel.name) {
                    targetItems[j].qty += sel.qty;
                    found = true;
                    break;
                }
            }
            if (!found) targetItems.push({ name: sel.name, price: sel.price, qty: sel.qty, addedTime: new Date().toISOString() });
        }
        var newTargetTotal = targetItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        var finalSourceItems = remainingItems.filter(function(i) { return i.qty > 0; });
        var newSourceTotal = finalSourceItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        var promise = createNew ? DB.create('tables', targetTable, targetTable.id) : Promise.resolve();
        promise.then(function() {
            return DB.update('tables', targetTable.id, { items: targetItems, total: newTargetTotal });
        }).then(function() {
            return DB.update('tables', pendingTransferSourceTable.id, { items: finalSourceItems, total: newSourceTotal });
        }).then(function() {
            // Realtime subscription sẽ tự động cập nhật tables
            if (currentTableDetailId === pendingTransferSourceTable.id) showTableDetail(pendingTransferSourceTable.id);
            closeModal('transferItemsModal');
            var totalQty = 0;
            for (var i = 0; i < selectedItems.length; i++) totalQty += selectedItems[i].qty;
            showToast('Đã chuyển ' + totalQty + ' món sang ' + targetName, 'success');
        });
    });
}

// ========== GỘP BÀN ==========
function showMergeTableModal(sourceId) {
    pendingMergeSourceId = sourceId;
    _getTableFromCache(sourceId).then(function(source) {
        if (!source || !source.items || !source.items.length) { showToast('Bàn nguồn không có món!', 'warning'); return; }
        // Dùng cachedTables nếu có, fallback DB.getAll
        var allTablesPromise = (window.cachedTables && Array.isArray(window.cachedTables) && window.cachedTables.length > 0)
            ? Promise.resolve(window.cachedTables)
            : DB.getAll('tables');
        allTablesPromise.then(function(allTables) {
            var targets = allTables.filter(function(t) { return t.id !== sourceId && (t.items && t.items.length) && t.total > 0; });
            if (targets.length === 0) { showToast('Không có bàn nào để gộp!', 'warning'); return; }
            var container = document.getElementById('mergeTablesList');
            if (!container) return;
            var html = '';
            for (var i = 0; i < targets.length; i++) {
                var t = targets[i];
                html += '<div class="merge-table-item" data-id="' + t.id + '"><strong>' + escapeHtml(t.name) + '</strong> - ' + (t.customerName || 'chưa có khách') + ' - ' + formatMoney(t.total) + '</div>';
            }
            container.innerHTML = html;
            var items = document.querySelectorAll('.merge-table-item');
            for (var i = 0; i < items.length; i++) {
                items[i].onclick = (function(item) {
                    return function() {
                        var targetId = item.getAttribute('data-id');
                        mergeTables(sourceId, targetId);
                        closeModal('mergeTableModal');
                    };
                })(items[i]);
            }
            document.getElementById('mergeTableModal').style.display = 'flex';
        });
    });
}

function mergeTables(sourceId, targetId) {
    // Kiểm tra không merge cùng bàn
    if (String(sourceId) === String(targetId)) {
        showToast('❌ Không thể gộp bàn với chính nó!', 'error');
        return;
    }
    Promise.all([_getTableFromCache(sourceId), _getTableFromCache(targetId)]).then(function(results) {
        var source = results[0];
        var target = results[1];
        if (!source || !target) return;
        var targetItems = target.items || [];
        for (var i = 0; i < source.items.length; i++) {
            var srcItem = source.items[i];
            var found = false;
            for (var j = 0; j < targetItems.length; j++) {
                if (targetItems[j].name === srcItem.name) {
                    targetItems[j].qty += srcItem.qty;
                    found = true;
                    break;
                }
            }
            if (!found) targetItems.push({ name: srcItem.name, price: srcItem.price, qty: srcItem.qty, addedTime: srcItem.addedTime });
        }
        var newTotal = targetItems.reduce(function(s, i) { return s + i.price * i.qty; }, 0);
        DB.update('tables', targetId, { items: targetItems, total: newTotal }).then(function() {
            return DB.remove('tables', String(sourceId));
        }).then(function() {
            // Realtime subscription sẽ tự động cập nhật tables
            if (currentTableDetailId === sourceId || currentTableDetailId === targetId) showTableDetail(targetId);
            showToast('✅ Đã gộp bàn ' + source.name + ' vào ' + target.name, 'success');
        });
    });
}

// Export global
window.showTableDetail = showTableDetail;
window.openAddMenuForTable = openAddMenuForTable;
window.showPaymentForTable = showPaymentForTable;
window.showCustomerSelectorForTable = showCustomerSelectorForTable;
window.showSplitBillModal = showSplitBillModal;
window.showTransferItemsModal = showTransferItemsModal;
window.showMergeTableModal = showMergeTableModal;
window.confirmTransferItems = confirmTransferItems;
window.deleteTableItem = deleteTableItem;
window.logDelete = logDelete;
window.paymentAtTableWithCredit = paymentAtTableWithCredit;
