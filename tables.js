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

// ========== GIỜ VIỆT NAM (nguồn duy nhất) ==========
// Quán chỉ hoạt động ở VN nên khung giờ khóa bàn / khóa hoàn tác phải theo giờ VN
// bất kể máy POS đang đặt múi giờ gì. Trước đây tables.js và history.js tự tính
// riêng ("getUTCHours()+7") dễ lệch nhau khi sửa - nay gom về đây.
// LƯU Ý: các mốc thời gian lưu trong DB (startTime/createdAt) đều là ISO nên
// new Date(iso) là UTC -> so sánh thời gian ngồi vẫn đúng tuyệt đối.
function _getVietnamTimeParts(dateObj) {
    var d = dateObj || new Date();
    return {
        hour: (d.getUTCHours() + 7) % 24,
        minute: d.getUTCMinutes()
    };
}

// ========== ĐÁNH SỐ BÀN (nguồn duy nhất) ==========
// Trước đây có 3 cách đánh số khác nhau:
//   order.js          : parseInt(name.replace(/\D/g,''))  -> "Bàn 1-2" ra 12 (sai)
//   transfer/draft    : /Ban (\d+)/ -> không match "Bàn 05" có dấu, sinh trùng tên
// Nay dùng chung _nextTableNumber cho cả 3 nơi.
function _extractTableNumber(name) {
    if (!name) return null;
    // Ưu tiên số nằm sau chữ "Bàn" (có hoặc không dấu)
    var m = String(name).match(/b[aà]n\s*(\d+)/i);
    if (m) return parseInt(m[1], 10);
    // Nếu tên chỉ là số -> dùng luôn
    var m2 = String(name).match(/(\d+)/);
    return m2 ? parseInt(m2[1], 10) : null;
}
function _nextTableNumber(allTables) {
    var maxNum = 0;
    var list = allTables || [];
    for (var i = 0; i < list.length; i++) {
        var num = _extractTableNumber(list[i] && list[i].name);
        if (num !== null && !isNaN(num) && num > maxNum) maxNum = num;
    }
    return maxNum + 1;
}
function _buildTableName(nextNum) {
    var n = nextNum;
    if (n < 10) n = '0' + n; // Bàn 01..Bàn 09 cho đồng nhất
    return 'Bàn ' + n;
}

// ========== BỌC VÙNG GHI DỮ LIỆU VỚI SUPPRESS REALTIME ==========
// Luôn flush đúng 1 lần, kể cả khi fn ném lỗi hoặc resolve sớm.
// Trước đây mỗi hàm tự gọi suppress/flush thủ công nên dễ kẹt (_suppressRealtime > 0)
// khi người dùng hủy thao tác -> realtime chết toàn hệ thống.
function _withRealtimeSuppressed(fn) {
    DB.suppressRealtime();
    var released = false;
    function release() {
        if (released) return;
        released = true;
        DB.flushRealtime();
    }
    return Promise.resolve().then(fn).then(function(v) {
        release();
        return v;
    }, function(err) {
        release();
        throw err;
    });
}

// Biến global lưu ID toast thanh toán để có thể ẩn sau khi xử lý xong
var _paymentToastId = null;

// ========== QUYẾT ĐỊNH DÙNG TIỀN DƯ ==========
// FIX BUG TRỪ TIỀN DƯ 2 LẦN (sai số liệu tài chính):
// Trước đây paymentAtTableWithCredit() hỏi khách rồi gọi useCustomerCredit() (trừ 1 lần),
// sau đó _processPaymentDirect() LẠI kiểm tra creditBalance và trừ lần nữa.
// -> Bàn 100k, khách dư 200k: trừ 200k, transaction ghi amount=0.
// -> Bàn 100k, khách dư 50k: trừ 50k nhưng transaction ghi amount=100k, note rỗng.
// Flag _skipCreditCheck được tạo ra để chặn nhưng KHÔNG BAO GIỜ được gán true.
//
// Nay chỉ còn MỘT chỗ tính & trừ tiền dư: _processPaymentDirect().
// _requestTablePayment() chỉ ghi lại quyết định của người dùng vào _useCreditApproved.
var _useCreditApproved = false;

// Số tiền khách đưa (dùng cho toast tiền dư)
var _changeToastGivenAmount = 0;

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
    var t = _getVietnamTimeParts();
    var startH = _getLockStartHour();
    var endH = _getLockEndHour();
    var endM = _getLockEndMinute();
    
    if (t.hour >= startH) {
        // startH:00 - 23h59: đang trong lock period
        return true;
    }
    if (t.hour < endH || (t.hour === endH && t.minute < endM)) {
        // 0h00 - endH:endM: đang trong lock period
        return true;
    }
    // endH:endM - (startH-1):59: ngoài lock period
    return false;
}

// ========== KIỂM TRA KHÓA BÀN ==========
function isTableLocked(table) {
    if (!table || !table.startTime) return false;
    
    // Điều kiện 1: Đang trong lock period (mặc định 22h-5h30) -> khóa toàn bộ
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
    var t = _getVietnamTimeParts(now);
    
    // Đang trong lock period
    if (isInLockPeriod()) {
        if (t.hour >= _getLockStartHour()) {
            return { hours: 0, mins: 0, elapsed: 0, reason: 'đã qua ' + _getLockStartHour() + 'h' };
        } else {
            return { hours: 0, mins: 0, elapsed: 0, reason: 'khung giờ khóa (' + _getLockStartHour() + 'h-' + _getLockEndHour() + 'h' + _getLockEndMinute() + ')' };
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
    if (DB.isAdmin()) {
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

function _releaseDelItemLock(tableId, itemIndex) {
    if (typeof DB !== 'undefined' && DB.releaseBusyLock) {
        DB.releaseBusyLock('delItem_' + tableId + '_' + itemIndex);
    }
}

// ========== XÓA MÓN TRÊN BÀN ==========
function deleteTableItem(tableId, itemIndex) {
    // Chống bấm hai lần: xoá món sẽ HOÀN KHO nguyên liệu. Bấm 2 lần là
    // tồn kho bị phình lên (hàng đã bán lại thành có thêm).
    if (typeof DB !== 'undefined' && DB.acquireBusyLock) {
        if (!DB.acquireBusyLock('delItem_' + tableId + '_' + itemIndex)) {
            showToast('⏳ Đang xoá món, vui lòng chờ...', 'warning');
            return;
        }
    }
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length) {
            _releaseDelItemLock(tableId, itemIndex);
            return;
        }
        if (itemIndex < 0 || itemIndex >= table.items.length) {
            _releaseDelItemLock(tableId, itemIndex);
            return;
        }

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
    // 1. Hoàn nguyên nguyên liệu.
    // CHỈ hoàn nếu bàn thật sự đã bị trừ kho (order.js set ingredientsDeducted khi
    // tạo/thêm món vào bàn). Bàn chưa từng bị trừ mà vẫn hoàn -> tồn kho tăng ảo.
    var restorePromise = (table.ingredientsDeducted === true)
        ? restoreIngredients([removedItem])
        : Promise.resolve();

    // ===== XOÁ MÓN AN TOÀN ĐA THIẾT BỊ =====
    //
    // Trước đây: `table.items.splice(itemIndex, 1)` rồi ghi đè cả bản ghi.
    // Chỉ số itemIndex là do giao diện truyền vào. Nếu máy khác vừa thêm món
    // vào bàn, mảng đã dịch chuyển -> bấm "xoá" ở máy này có thể XOÁ NHẦM
    // món khác, đồng thời ghi đè mất món máy kia vừa thêm.
    //
    // Nay: removeItemsFromTable() chạy runTransaction và khớp món theo
    // `id` + thời điểm thêm (không phải theo chỉ số), trên dữ liệu mới nhất
    // từ server. Món không còn ở đúng vị trí cũ vẫn xoá đúng, và món máy khác
    // vừa thêm không bị mất.
    var removedMatch = (function () {
        var wantId = removedItem.id;
        var wantName = removedItem.name;
        var wantTime = removedItem.addedTime;
        return function (it) {
            if (!it) return false;
            if (wantId && it.id) return String(it.id) === String(wantId);
            if (wantTime && it.addedTime) return it.addedTime === wantTime && it.name === wantName;
            return it.name === wantName;
        };
    })();

    var writePromise;
    if (typeof DB.removeItemsFromTable === 'function') {
        writePromise = restorePromise.then(function () {
            return DB.removeItemsFromTable(String(table.id), removedMatch);
        }).then(function (res) {
            if (!res.ok) throw new Error(res.reason || 'Không xoá được món');
            // Cập nhật bản cache của máy này theo kết quả server
            if (res.table && res.table.items) {
                table.items = res.table.items;
                table.total = res.table.total;
            }
            return DB.update('tables', String(table.id), { recentAdds: [] });
        });
    } else {
        writePromise = restorePromise.then(function() {
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
        });
    }

    writePromise.then(function() {
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
        _releaseDelItemLock(tableId, itemIndex);
    }).catch(function(err) {
        _releaseDelItemLock(tableId, itemIndex);
        console.error('[TABLE] Lỗi xoá món:', err);
        showToast('❌ Lỗi xoá món: ' + (err.message || err), 'error');
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
            // Bàn khoá: vẫn cho THÊM MÓN (nghiệp vụ yêu cầu), chỉ khoá
            // xoá món / chia hóa đơn / chuyển món / gộp bàn / xoá bàn.
            // Nút "➕ Thêm món" và "🖨️ In" vẫn bấm được.
            // Các nút bị vô hiệu dùng thẻ disabled (thay vì pointer-events:none
            // của bản cũ, vẫn focus được bằng bàn phím và trông như nút lỗi).
            var editButtonsHtml =
                '<div class="cart-actions edit-actions">' +
                    '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="openAddMenuForTable(\'' + table.id + '\'); closeModal(\'tableDetailModal\')">➕ Thêm món</button>' +
                    '<div style="display:flex;gap:8px;opacity:0.45;">' +
                        '<button class="cart-action-btn" style="background:#f1f5f9;flex:1;" disabled>🧾 Chia hóa đơn</button>' +
                        '<button class="cart-action-btn" style="background:#f1f5f9;flex:1;" disabled>🔄 Chuyển món</button>' +
                    '</div>' +
                    '<div style="display:flex;gap:8px;opacity:0.45;">' +
                        '<button class="cart-action-btn" style="background:#f1f5f9;flex:1;" disabled>🔗 Gộp bàn</button>' +
                    '</div>' +
                    printBtn +
                    '<button class="cart-action-btn" style="background:#f1f5f9;" onclick="requirePassword(\'xóa bàn\', function(){ showDeleteTableConfirm(\'' + table.id + '\'); closeModal(\'tableDetailModal\'); })">🗑️ Xóa bàn (🔒)</button>' +
                '</div>' +
                '<div style="text-align:center;color:#dc2626;font-size:12px;margin-bottom:8px;">🔒 ' + lockInfo.reason + ' - Vẫn thêm món được, không xoá/chuyển/gộp</div>';
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

// ========== THÊM MÓN VÀO BÀN ĐANG CÓ ==========
// Bản này ở tables.js thắng bản trùng trong order.js (file này load sau).
// Khác biệt có chủ đích: bản order.js không có bước xác nhận và không reset
// currentDraftId -> mở lại modal thêm món từ một đơn nháp sẽ giữ nhầm draft.
function openAddMenuForTable(tableId) {
    // Màn hình dọc (điện thoại) -> xác nhận trước, tránh mở nhầm modal
    var isPortrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
    if (isPortrait) {
        if (!confirm('Xác nhận thêm món?')) {
            return;
        }
    }
    
    // Bàn đã khoá VẪN ĐƯỢC thêm món (yêu cầu nghiệp vụ).
    // Khoá bàn chỉ chặn: xoá món, xoá bàn, chia/chuyển/gộp bàn.
    // Thanh toán và ghi nợ luôn mở vì đó là việc phải dọn bàn.
    // -> KHÔNG chặn ở đây, cũng không chặn trong handleAddToExistingTable().
    
    currentAddToTableId = tableId;
    tempOrder = [];
    selectedCustomer = null;
    currentDraftId = null;
    openOrderModal();
}

// ========== LUỒNG THANH TOÁN TẠI BÀN (gộp 3 nguồn gọi) ==========
// Trước đây có 3 hàm tách rời (paymentAtTable, paymentAtTableWithCredit,
// _changeToastPay) với 3 kiểu xác nhận khác nhau và cùng một lỗi trừ tiền dư.
// Nay gom về _requestTablePayment() với tham số tường minh:
//   fromCard  - bấm nút TM/CK ngay trên thẻ bàn -> xác nhận LUÔN (tránh bấm nhầm)
//   fromModal - bấm nút trong modal chi tiết -> chỉ xác nhận ở màn hình dọc
//   fromChange- bấm "✅ Thanh toán" trong toast tiền dư -> đã xác nhận ở toast, không hỏi lại
// Khoá chống bấm 2 lần. Một lần thanh toán mất vài trăm ms (ghi lịch sử + xoá
// bàn qua IndexedDB). Nếu người dùng bấm nhanh 2 lần hoặc vô tình bấm trúng cả
// nút TM và CK, cả 2 lệnh đều đọc cùng một bàn đang tồn tại -> 2 giao dịch trùng
// tiền, 2 lần trừ tiền dư, 2 lần ghi két.
var _paymentInFlight = {};
function _isPaymentLocked(tableId) {
    var k = String(tableId);
    if (_paymentInFlight[k]) return true;
    _paymentInFlight[k] = true;
    // Tự mở khoá sau 15s để một lỗi bất thường nào đó không khoá vĩnh viễn
    setTimeout(function() { delete _paymentInFlight[k]; }, 15000);
    return false;
}
function _releasePaymentLock(tableId) {
    delete _paymentInFlight[String(tableId)];
}

function _requestTablePayment(tableId, method, fromCard) {
    if (_isPaymentLocked(tableId)) {
        showToast('⏳ Đang xử lý thanh toán bàn này, vui lòng chờ...', 'warning');
        return;
    }
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length) {
            _releasePaymentLock(tableId);
            showToast('Bàn không có món để thanh toán!', 'warning');
            return;
        }
        
        var total = table.total || 0;
        var methodLabels = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', debt: 'Ghi nợ' };
        var label = methodLabels[method] || method;
        var isPortrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
        
        // Xác nhận thanh toán
        if (fromCard || isPortrait) {
            if (!confirm('💳 Xác nhận thanh toán bằng ' + label + '?\n💰 Tổng tiền: ' + formatMoney(total))) {
                _releasePaymentLock(tableId);
                return;
            }
        }
        
        // Hỏi dùng tiền dư - CHỈ ghi nhận quyết định, KHÔNG trừ ở đây.
        // Việc tính + trừ thuộc về _processPaymentDirect() (đúng 1 chỗ, 1 lần).
        _useCreditApproved = false;
        if (table.customerId) {
            for (var i = 0; i < customers.length; i++) {
                // String(): id khách có thể number hoặc string tu nguon khac nhau
                if (String(customers[i].id) === String(table.customerId)) {
                    var bal = customers[i].prepaidBalance || customers[i].creditBalance || 0;
                    if (bal > 0) {
                        if (confirm('💰 ' + customers[i].name + ' có ' + formatMoney(bal) + ' tiền dư.\nDùng số dư này để thanh toán?')) {
                            _useCreditApproved = true;
                        }
                    }
                    break;
                }
            }
        }
        
        _hideChangeToast();
        _processPaymentDirect(tableId, method);
    })['catch'](function(err) {
        // KHÔNG có catch thì promise reject sẽ bị nuốt im lặng:
        // - người dùng bấm nút, không có gì xảy ra, tưởng app treo
        // - khoá thanh toán vẫn giữ trong 15s -> bấm lại báo "đang xử lý"
        // hay gặp khi DB.get lỗi IndexedDB (thường xảy ra trên máy chạy lâu).
        _releasePaymentLock(tableId);
        console.error('[PAYMENT] Lỗi đọc bàn khi thanh toán:', err);
        showToast('❌ Không đọc được thông tin bàn. Vui lòng thử lại.', 'error', 3000);
        if (typeof renderTables === 'function') renderTables();
    });
}

// Nút thanh toán nhanh trên thẻ bàn
function paymentAtTable(tableId, method) {
    _requestTablePayment(tableId, method, true);
}

// Nút thanh toán trong modal chi tiết bàn
function paymentAtTableWithCredit(tableId, method) {
    // String() de id number/string van so sanh dung
    if (currentTableDetailId && String(currentTableDetailId) === String(tableId)) {
        closeModal('tableDetailModal');
    }
    _requestTablePayment(tableId, method, false);
}

// FIX Phase 1: _processPaymentDirect - Optimistic UI, ingredient chạy background
function _processPaymentDirect(tableId, method) {
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length) {
            // Bàn đã bị xoá/thanh toán ở máy khác trong lúc đang chờ -> nhả khoá
            // cho phép thử lại, đồng thời thông báo rõ thay vì im lặng.
            _releasePaymentLock(tableId);
            showToast('Bàn không còn món để thanh toán!', 'warning');
            return;
        }

        _paymentToastId = showToast('⏳ Đang xử lý thanh toán...', 'info', 0);

        // ===== GIÀNH BÀN TRƯỚC KHI THU TIỀN =====
        //
        // Bảng `tables` trong RAM mỗi máy một bản riêng. Hai máy cùng mở bàn
        // này và cùng bấm Thanh toán thì cả hai đều thấy bàn còn món, cả hai
        // ghi một giao dịch lịch sử với id khác nhau và cả hai mở két tiền ->
        // thu 2 lần cho 1 hoá đơn, còn bàn chỉ bị xoá 1 lần.
        //
        // claimTable() chạy runTransaction trên chính node bàn: chỉ một máy
        // thấy bàn còn tồn tại và giành được (thao tác xoá chính là "giành quyền
        // thanh toán"). Máy còn lại bị từ chối và không ghi gì cả.
        // KHÔNG thêm trường nào vào dữ liệu.
        //
        // Đọc lại `table` từ kết quả giành (dữ liệu mới nhất trên server),
        // không dùng bản cache có thể cũ.
        if (typeof DB.claimTable !== 'function') {
            _finishTablePayment(tableId, method, table, table);
            return;
        }

        DB.claimTable(String(tableId)).then(function (claim) {
            if (!claim.claimed) {
                _releasePaymentLock(tableId);
                hideToast(_paymentToastId);
                showToast('⚠️ ' + claim.reason + '. Không ghi nhận trùng.', 'warning', 3500);
                if (typeof renderTables === 'function') renderTables();
                return;
            }
            var fresh = claim.table || table;
            _finishTablePayment(tableId, method, fresh, table);
        }).catch(function (err) {
            _releasePaymentLock(tableId);
            hideToast(_paymentToastId);
            console.error('[AUDIT] claimTable lỗi:', err);
            showToast('❌ Không kiểm tra được bàn, đã huỷ thanh toán', 'error', 3500);
        });
    }).catch(function (err) {
        // Bắt lỗi chung cho cả nhánh trên: trước đây không có .catch nên một
        // lỗi đồng bộ giữa chừng làm khoá kẹt và màn hình đứng.
        _releasePaymentLock(tableId);
        hideToast(_paymentToastId);
        console.error('[AUDIT] _processPaymentDirect lỗi:', err);
    });
}

// Thân thanh toán, chạy SAU khi đã giành được bàn thành công.
// serverTable = bản ghi mới nhất lấy từ server (không thêm trường).
// localTable  = bản cache, dùng để khôi phục nếu ghi lịch sử thất bại.
function _finishTablePayment(tableId, method, serverTable, localTable) {
    var table = serverTable;
    {
        // Clone items trước khi xóa
        var items = _cloneArr(table.items);

        // Kho ĐÃ bị trừ lúc tạo bàn / thêm món vào bàn (order.js set cờ này).
        // Trước đây thanh toán lại trừ thêm một lần nữa -> mỗi món bán tại bàn
        // bị trừ kho GẤP ĐÔI. Giờ chỉ trừ khi bàn chưa từng bị trừ.
        var alreadyDeducted = table.ingredientsDeducted === true;

        // Đóng modal ngay lập tức
        // String() de id number/string van so sanh dung
        if (currentTableDetailId && String(currentTableDetailId) === String(tableId)) {
            closeModal('tableDetailModal');
        }

        DB.suppressRealtime();

        var now = new Date();
        var total = table.total;
        var tableName = table.name;
        var customerId = table.customerId;
        var customerName = table.customerName;
        var startTime = table.startTime;
        var endTime = now.toISOString();
        
        // Tính thời gian khách ngồi
        var tableTime = '';
        if (startTime) {
            var st = new Date(startTime);
            var elapsed = now.getTime() - st.getTime();
            var hours = Math.floor(elapsed / 3600000);
            var mins = Math.floor((elapsed % 3600000) / 60000);
            tableTime = hours > 0 ? hours + 'h' + (mins > 0 ? mins + 'p' : '') : mins + 'p';
        }
        
        // FIX: chỉ dùng tiền dư khi người dùng đã bấm đồng ý (_useCreditApproved).
        // Trước đây luôn tự trừ creditBalance dù người dùng có thể đã bấm "Không".
        var finalAmount = total;
        var creditUsed = 0;
        var customerInfo = customerName ? { name: customerName } : null;
        
        if (_useCreditApproved && customerId) {
            for (var i = 0; i < customers.length; i++) {
                if (customers[i].id === customerId) {
                    var bal = customers[i].prepaidBalance || customers[i].creditBalance || 0;
                    if (bal > 0) {
                        creditUsed = Math.min(bal, finalAmount);
                        if (creditUsed > 0) {
                            finalAmount = finalAmount - creditUsed;
                            customerInfo = { id: customerId, name: customerName };
                        }
                    }
                    break;
                }
            }
        }
        _useCreditApproved = false;
        
        // FIX Phase 1: Lưu transaction NGAY, không chờ ingredient
        var creditPromise = Promise.resolve();
        if (creditUsed > 0 && customerId) {
            creditPromise = useCustomerCredit(customerId, creditUsed, 'Trừ tiền dư khi thanh toán bàn ' + tableName);
        }
        
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
            endTime: endTime,
            // FIX: trước đây thiếu creditUsed -> history.js lúc hoàn tác/đối soát
            // không biết đã dùng bao nhiêu tiền dứ khách
            creditUsed: creditUsed
        });
        
        // Bàn ĐÃ bị xoá từ lúc claimTable() (đó chính là cách giành quyền thanh
        // toán giữa các máy). Ở đây chỉ cần ghi lịch sử và xử lý tiền.
        //
        // Nếu ghi lịch sử thất bại (mạng lỗi) thì trả bàn về đúng chỗ bằng
        // releaseTableClaim() - dữ liệu quay về y hệt trước khi thanh toán,
        // khách thử lại được, không mất món.
        Promise.all([creditPromise, historyPromise]).then(function() {
            return true;
        }).then(function() {
            DB.flushRealtime();
            
            if (method === 'cash') {
                handleCashPayment(finalAmount, null, {type: 'dinein', tableName: tableName, customer: customerInfo}).catch(function(err) {
                    console.error('[AUDIT] handleCashPayment lỗi:', err);
                });
            }
            
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
            
            // In hoá đơn: GIỮ NGUYÊN hành vi cũ - không in tự động khi thanh toán tại
            // bàn. Người dùng bấm nút 🖨️ trên thẻ bàn / trong modal để in thủ công.
            
            hideToast(_paymentToastId);
            _releasePaymentLock(tableId);
            // Toast 1 dòng, thống nhất với panel "Giao dịch gần đây"
            var _payer = DB.getCurrentUser();
            showActivityToast('✅', {
                amount: finalAmount,
                paymentMethod: method,
                type: 'dinein',
                tableName: tableName,
                items: items,
                customer: customerInfo,
                createdByName: _payer ? _payer.displayName : '',
                createdByRole: _payer ? _payer.role : ''
            }, 'success', creditUsed > 0 ? 4500 : 3500);
            // Toast chỉ hiện 1 cái, thông tin tiền dư gộp chung để không bị đè mất
            if (creditUsed > 0) {
                _setToastExtra('💳 Đã trừ ' + formatMoney(creditUsed) + ' tiền dư của khách');
            }
            _dispatchPosCashUpdate();
            // FIX Android 6: Gọi renderTables() để đồng bộ UI sau thanh toán
            // Tránh trường hợp IndexedDB đọc lỗi làm mất bàn trên Android 6
            if (typeof renderTables === 'function') {
                renderTables();
            }
        }).catch(function(err) {
            hideToast(_paymentToastId);
            DB.flushRealtime();
            _releasePaymentLock(tableId);
            console.error('[AUDIT] lỗi thanh toán bàn ' + tableId + ':', err);

            // Khôi phục bàn: bàn đã bị xoá lúc giành quyền thanh toán. Nếu
            // ghi lịch sử/thu tiền hỏng thì trả bản ghi cũ về đúng chỗ, khách
            // không mất món và thử lại được.
            if (typeof DB.releaseTableClaim === 'function') {
                DB.releaseTableClaim(String(tableId), localTable).then(function (restored) {
                    if (!restored) {
                        console.warn('[AUDIT] Không khôi phục được bàn ' + tableId + ' - cần kiểm tra tay');
                    }
                    if (typeof renderTables === 'function') renderTables();
                });
            }

            showToast('❌ Lỗi thanh toán: ' + (err.message || err) + '. Đã trả lại bàn, vui lòng thử lại.', 'error', 4000);
        });

        // FIX Phase 1: Ingredient deduction chạy background
        // Chỉ trừ nếu bàn chưa từng bị trừ kho (tránh trừ 2 lần)
        if (!alreadyDeducted) {
            setTimeout(function() {
                _checkAndDeductIngredients(items).then(function() {
                    console.log('[INGREDIENT] Đã trừ nguyên liệu cho bàn:', tableName);
                }).catch(function (e) {
                    console.error('[INGREDIENT] lỗi trừ kho bàn:', e);
                });
            }, 0);
        }
    }
}

// Biến lưu trạng thái toast tiền dư
var _changeToastEl = null;
var _changeToastTableId = null;

// ========== HIỂN THỊ SỐ TIỀN DƯ KHI CHỌN MỆNH GIÁ ==========
// Click nút mệnh giá → chỉ toast số tiền dư cần trả, KHÔNG thanh toán
// Click TM hoặc nút trong toast → thanh toán và ẩn toast
// Click ✕ → đóng toast (đổi PTTT)
function cashPayWithDenom(tableId, givenAmount) {
    // Khoá chống bấm 2 lần (giống _requestTablePayment).
    // Nút mệnh giá nằm ngay cạnh nhau, bấm nhầm 2 cái sẽ mở 2 toast tiền dư chồng
    // lên nhau và 2 lần _changeToastPay -> 2 giao dịch.
    if (_isPaymentLocked(tableId)) {
        showToast('⏳ Đang xử lý bàn này, vui lòng chờ...', 'warning');
        return;
    }
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length) {
            _releasePaymentLock(tableId);
            showToast('Bàn không có món để thanh toán!', 'warning');
            return;
        }
        var total = table.total;
        if (givenAmount < total) {
            _releasePaymentLock(tableId);
            showToast('❌ Số tiền ' + formatMoney(givenAmount) + ' không đủ!', 'error');
            return;
        }
        var change = givenAmount - total;
        // Xóa toast cũ nếu có
        _hideChangeToast();
        // Lưu tableId và số tiền khách đưa để nút thanh toán trong toast có thể dùng
        _changeToastTableId = tableId;
        _changeToastGivenAmount = givenAmount;
        
        // Tạo toast đặc biệt to, nổi bật - chỉ hiển thị tiền dư trả lại khách
        var toast = document.createElement('div');
        toast.className = 'change-toast';
        toast.id = 'changeToast';
        toast.innerHTML =
            '<div class="change-label">💵 TIỀN DƯ</div>' +
            '<div class="change-given">Khách đưa: ' + formatMoney(givenAmount) + '</div>' +
            '<div class="change-amount">' + formatMoney(change) + '</div>' +
            '<div class="change-return">🔄 Trả lại khách: <strong>' + formatMoney(change) + '</strong></div>' +
            '<div style="display:flex;gap:8px;margin-top:10px;">' +
                '<button onclick="_changeToastPay()" style="flex:1;padding:10px;border-radius:40px;border:none;background:#f97316;color:#fff;font-weight:700;font-size:14px;cursor:pointer;-webkit-appearance:none;">✅ Thanh toán</button>' +
                '<button onclick="_hideChangeToast()" style="padding:10px 16px;border-radius:40px;border:none;background:#475569;color:#fff;font-size:13px;cursor:pointer;-webkit-appearance:none;">✕</button>' +
            '</div>';
        document.body.appendChild(toast);
        _changeToastEl = toast;
    })['catch'](function(err) {
        // Tương tự _requestTablePayment: không có catch thì lỗi bị nuốt im lặng
        // và khoá kẹt 15s -> người dùng bấm lại báo "đang xử lý thanh toán".
        _releasePaymentLock(tableId);
        console.error('[PAYMENT] Lỗi khi chọn mệnh giá:', err);
        showToast('❌ Không đọc được thông tin bàn. Vui lòng thử lại.', 'error', 3000);
        if (typeof renderTables === 'function') renderTables();
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
    // Nhả khoá của cashPayWithDenom TRƯỚC, vì _requestTablePayment sẽ tự khoá lại.
    // Nếu không nhả, _isPaymentLocked thấy khoá cũ còn và báo "đang xử lý" -> không
    // thanh toán được dù người dùng đã bấm ✅.
    _hideChangeToast();
    if (tid) {
        // FIX: bấm "✅ Thanh toán" trong toast tiền dư ĐÃ là xác nhận rồi.
        // Trước đây gọi paymentAtTableWithCredit -> ở màn hình dọc bị confirm() lần 2
        // ("Xác nhận thanh toán bằng Tiền mặt?") dù người dùng vừa bấm xác nhận.
        // fromCard=false + vẫn hỏi về tiền dư (đó mới là quyết định cần hỏi).
        _requestTablePayment(tid, 'cash', false);
    }
}

function _hideChangeToast() {
    if (_changeToastEl) {
        if (_changeToastEl.parentNode) _changeToastEl.remove();
        _changeToastEl = null;
    }
    // Đóng toast tiền dư bằng ✕ nghĩa là người dùng bỏ thanh toán mệnh giá này
    // (đổi phương thức thanh toán) -> nhả khoá để bấm mệnh giá khác hoặc bấm nút
    // TM/CK trên thẻ bàn được ngay.
    if (_changeToastTableId) {
        _releasePaymentLock(_changeToastTableId);
    }
    _changeToastTableId = null;
    _changeToastGivenAmount = 0;
}

// OPTIMIZE: debtAtTable - đóng modal ngay, song song hóa Promise, batch ingredients
function debtAtTable(tableId) {
    // Khoá chống bấm 2 lần - dùng chung với _requestTablePayment
    if (_isPaymentLocked(tableId)) {
        showToast('⏳ Đang xử lý bàn này, vui lòng chờ...', 'warning');
        return;
    }
    // OPTIMIZE: Đóng modal ngay lập tức
    // String() de id number/string van so sanh dung
    if (currentTableDetailId && String(currentTableDetailId) === String(tableId)) {
        closeModal('tableDetailModal');
    }
    _paymentToastId = showToast('⏳ Đang xử lý ghi nợ...', 'info', 0);
    
    // FIX BUG KẸT SUPPRESS REALTIME (rất nghiêm trọng):
    // Trước đây DB.suppressRealtime() được gọi TRƯỚC showCustomerSelector().
    // Người dùng bấm ✕ đóng modal chọn khách -> callback không chạy -> không ai gọi
    // DB.flushRealtime() -> _suppressRealtime kẹt > 0 vĩnh viễn -> MỌI event realtime
    // của mọi collection (bàn, khách, giao dịch, chi phí) bị nuốt -> UI đứng hình
    // tới khi F5 máy.
    // Nay: KHÔNG suppress trước khi mở modal. Chỉ suppress quanh đúng vùng ghi DB,
    // và bọc trong _withRealtimeSuppressed() để luôn flush đúng 1 lần.
    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length) {
            hideToast(_paymentToastId);
            _releasePaymentLock(tableId);
            showToast('❌ Bàn chưa có món, không thể ghi nợ!', 'warning');
            return;
        }
        if (!table.total || table.total <= 0) {
            hideToast(_paymentToastId);
            _releasePaymentLock(tableId);
            showToast('❌ Tổng tiền = 0, không thể ghi nợ!', 'warning');
            return;
        }
        
        showCustomerSelector(function(customer) {
            if (!customer) {
                hideToast(_paymentToastId);
                // Người dùng đóng modal chưa chọn khách -> nhả khoá để thử lại
                _releasePaymentLock(tableId);
                showToast('Cần chọn khách hàng để ghi nợ!', 'warning');
                return;
            }
            var now = new Date();
            var endTime = now.toISOString();
            var tableTime = _calcTableTime(table.startTime) || '';
            var debtAmount = table.total;
            var creditUsed = 0;
            
            _withRealtimeSuppressed(function() {
                // Dùng chung deductIngredients() của ingredients.js (đã có idempotency
                // + ghi ingredient_transactions). Trước đây debtAtTable có bản trừ kho
                // riêng ở đây -> tồn tại 3 bản trừ kho lệch nhau trong dự án.
                // Chỉ trừ nếu bàn chưa từng bị trừ kho (xem _processPaymentDirect).
                var stockAndDeductPromise = (table.ingredientsDeducted === true)
                    ? Promise.resolve(true)
                    : _checkAndDeductIngredients(table.items);
                
                return stockAndDeductPromise.then(function() {
                    // addCustomerDebt tự tạo transaction history bên trong.
                    // Truyền thêm tableId/tableName để lần hoàn tác khôi phục được bàn.
                    return addCustomerDebt(customer.id, table.total, 'Mua tai ' + table.name, table.items, {
                        tableId: table.id,
                        tableName: table.name,
                        tableTime: tableTime,
                        startTime: table.startTime,
                        endTime: endTime
                    });
                }).then(function(debtResult) {
                    debtAmount = debtResult.debtAmount;
                    creditUsed = debtResult.creditUsed;
                    
                    // KHÔNG gọi addHistory ở đây nữa.
                    // addCustomerDebt (customers.js) ĐÃ tự ghi 1 transaction
                    // debt_payment bên trong nó. Trước đây gọi cả hai -> mỗi lần ghi
                    // nợ bàn sinh ra 2 dòng lịch sử, và dòng thừa không có tableId
                    // nên hoàn tác không khôi phục được bàn.
                    // Xem addCustomerDebt(..., extraFields) - extraFields đã được
                    // gộp vào transaction đó nên không mất thông tin nào.
                    return true;
                }).then(function() {
                    // FIX THỨ TỰ GHI: xóa bàn SAU khi đã ghi lịch sử (trong
                    // addCustomerDebt). Trước đây addHistory + DB.remove chạy song
                    // song -> ghi lịch sử fail thì bàn đã mất mà lịch sử trống.
                    return DB.remove('tables', String(tableId));
                });
            }).then(function() {
                // Gửi thông báo Telegram giao dịch ghi nợ
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
                _releasePaymentLock(tableId);
                var _debter2 = DB.getCurrentUser();
                showActivityToast('💰', {
                    amount: debtAmount,
                    paymentMethod: 'debt',
                    type: 'debt_payment',
                    tableName: table.name,
                    items: table.items,
                    customer: { id: customer.id, name: customer.name },
                    createdByName: _debter2 ? _debter2.displayName : '',
                    createdByRole: _debter2 ? _debter2.role : ''
                }, 'success', creditUsed > 0 ? 4500 : 3500);
                if (creditUsed > 0) {
                    _setToastExtra('💳 Đã trừ ' + formatMoney(creditUsed) + ' tiền dư của khách');
                }
                
                // FIX Android 6: Gọi renderTables() để đồng bộ UI sau ghi nợ
                if (typeof renderTables === 'function') {
                    renderTables();
                }
                
                // In hoá đơn: GIỮ NGUYÊN hành vi cũ - chỉ in khi có ô
                // #printAfterPaymentCheck được tick. Ô này hiện không có trong
                // index.html nên mặc định là KHÔNG in, in thủ công qua nút 🖨️.
                var printCheck = document.getElementById('printAfterPaymentCheck');
                if (printCheck && printCheck.checked && typeof printAfterPayment === 'function') {
                    printAfterPayment({
                        orderType: 'debt_payment',
                        amount: debtAmount,
                        paymentMethod: 'debt',
                        items: table.items,
                        tableName: table.name,
                        customer: { id: customer.id, name: customer.name },
                        tableTime: tableTime || null,
                        startTime: table.startTime ? new Date(table.startTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : null,
                        endTime: new Date(endTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                        createdAt: now.toISOString()
                    });
                }
            }).catch(function(err) {
                hideToast(_paymentToastId);
                // Bàn vẫn còn (vì DB.remove chạy sau addHistory) -> nhả khoá cho thử lại
                _releasePaymentLock(tableId);
                showToast('❌ Lỗi ghi nợ: ' + (err.message || err) + '. Bàn vẫn còn, vui lòng thử lại.', 'error', 4000);
                if (typeof renderTables === 'function') renderTables();
            });
        });
    })['catch'](function(err) {
        // Lớp ngoài chưa có catch: lỗi khi đọc bàn (DB.get lỗi IndexedDB) bị nuốt
        // im lặng và toast "đang xử lý ghi nợ" treo vô hạn trên màn hình.
        hideToast(_paymentToastId);
        _releasePaymentLock(tableId);
        console.error('[DEBT] Lỗi đọc bàn khi ghi nợ:', err);
        showToast('❌ Không đọc được thông tin bàn. Vui lòng thử lại.', 'error', 3000);
        if (typeof renderTables === 'function') renderTables();
    });
}

function showCustomerSelectorForTable(tableId) {
    showCustomerSelector(function(customer) {
        if (!customer) return;
        DB.update('tables', String(tableId), { customerId: customer.id, customerName: customer.name }).then(function() {
            // Realtime subscription sẽ tự động cập nhật tables
            // So sanh bang String(): id ban co the number hoac string tu nguon khac nhau
            if (currentTableDetailId && String(currentTableDetailId) === String(tableId)) {
                showTableDetail(tableId);
            }
            showToast('✅ Đã gán khách ' + customer.name + ' cho bàn', 'success');
        }).catch(function(err) {
            showToast('❌ Lỗi gán khách: ' + (err.message || err), 'error');
        });
    });
}

// ========== CHIA HOA DON / CHUYEN MON / GOP BAN / XOA BAN ==========
// Đã chuyển hết sang split-transfer-merge.js (file đó load sau nên bản đó là bản chạy thật).
// Bản cũ nằm trong file này là code chết ~455 dòng -> đã gỡ bỏ để tránh sửa nhầm nhầm bản.

// Export global
window.showTableDetail = showTableDetail;
window.openAddMenuForTable = openAddMenuForTable;
window.showCustomerSelectorForTable = showCustomerSelectorForTable;
window.deleteTableItem = deleteTableItem;
window.logDelete = logDelete;
window.paymentAtTable = paymentAtTable;
window.paymentAtTableWithCredit = paymentAtTableWithCredit;
window.debtAtTable = debtAtTable;
window.doPrintThermal = doPrintThermal;
window.doPrintPDF = doPrintPDF;
window.printTableBill = printTableBill;
