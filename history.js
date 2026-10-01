// history.js - Lịch sử giao dịch
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== KIỂM TRA KHÓA GIAO DỊCH ==========
// Đọc 1 giá trị số từ window.shopConfig, có chặn null/NaN.
// BẮT BUỘC phải chặn null: saveLockConfig() (settings.js) ghi null vào
// shopConfig.lockStartHour khi admin xoá ô (để XOÁ giá trị đã lưu).
// Nếu đọc bằng `!== undefined` thì lockStartHour = null, và
// `hourVN >= null` <=> `hourVN >= 0` => LUÔN TRUE => MỌI giao dịch (kể cả
// 10h sáng) bị coi là đã khóa => nhân viên không hoàn tác được gì.
function _lockCfgNum(key, def) {
    var v = window.shopConfig ? window.shopConfig[key] : undefined;
    if (typeof v === 'number' && !isNaN(v)) return v;
    // Chấp nhận chuỗi số vì Firebase/localStorage có thể trả string
    if (typeof v === 'string' && v.trim() !== '') {
        var n = parseInt(v, 10);
        if (!isNaN(n)) return n;
    }
    return def;
}

// Lấy giờ Việt Nam (UTC+7) từ một Date. Dùng chung với quyết định khóa để
// hiển thị và logic khóa không lệch nhau.
function _getVnTimePartsOf(dateLike) {
    var d = new Date(dateLike);
    if (typeof _getVietnamTimeParts === 'function') {
        return _getVietnamTimeParts(d);
    }
    return { hour: (d.getUTCHours() + 7) % 24, minute: d.getUTCMinutes() };
}

// Kiểm tra xem giao dịch có bị khóa hoàn tác không, dựa trên thời điểm thanh toán (createdAt)
function isTransactionLocked(trans) {
    if (!trans) return false;
    
    // Lấy thời gian thanh toán từ createdAt
    // FIX: dùng chung _getVietnamTimeParts() của tables.js thay vì tự tính
    // "getUTCHours()+7" ở đây. Hai chỗ tự tính dễ lệch nhau khi sửa, và lệch
    // 1 giờ là giao dịch bị khoá hoàn tác oan (hoặc không bị khoá khi phải khoá).
    var payTime = new Date(trans.createdAt || trans.date);
    var vt = _getVnTimePartsOf(payTime);
    var hourVN = vt.hour;
    var minVN = vt.minute;
    
    // Đọc cấu hình lock từ shopConfig, chặn null/NaN
    var lockStartHour = _lockCfgNum('lockStartHour', 22);
    var lockEndHour = _lockCfgNum('lockEndHour', 5);
    var lockEndMinute = _lockCfgNum('lockEndMinute', 30);
    var lockHours = _lockCfgNum('tableLockHours', 5);
    
    // Điều kiện 1: Thanh toán trong khung giờ khóa cố định (vd: 22h-5h30)
    // lockStartHour:00 - 23h59
    if (hourVN >= lockStartHour) return true;
    // 00h00 - lockEndHour:lockEndMinute
    if (hourVN < lockEndHour || (hourVN === lockEndHour && minVN < lockEndMinute)) return true;
    
    // Điều kiện 3: HIỆN TẠI có đang trong khung giờ khóa không?
    // Điều kiện 1 chỉ xét giờ THANH TOÁN. Kịch bản lỗ hổng: khách thanh toán
    // lúc 21:00 (chưa khóa), 23:30 quản lý đã khóa toàn bộ -> giao dịch đó vẫn
    // hoàn tác không cần mật khẩu, và doRefund còn gọi restoreTable() tức tạo
    // lại bàn trong khung giờ khóa - việc mà tables.js / split-transfer-merge.js
    // không bao giờ cho phép.
    var nowParts = _getVnTimePartsOf(new Date());
    if (nowParts.hour >= lockStartHour ||
        nowParts.hour < lockEndHour ||
        (nowParts.hour === lockEndHour && nowParts.minute < lockEndMinute)) return true;

    // Điều kiện 2: Nếu là bàn (dinein), kiểm tra thời gian ngồi quá giới hạn
    if (trans.type === 'dinein' && trans.tableId) {
        // Dùng tableTime nếu có (vd: "2h15p", "5h30p")
        if (trans.tableTime) {
            var match = trans.tableTime.match(/(\d+)h(\d*)p?/);
            if (match) {
                // Dùng >= để khớp với tables.js (`elapsed >= lockMs`).
                // Trước đây dùng `hours > lockHours || (=== && mins > 0)` nên
                // bàn ngồi ĐÚNG 5h00 (tableTime = "5h") bị coi là CHƯA khóa ở
                // đây, trong khi chính bàn đó đang bị tables.js khóa.
                var hours = parseInt(match[1], 10);
                if (hours >= lockHours) return true;
            }
        }
        // Fallback: dùng originalCreatedAt (thời gian gốc) nếu có
        if (trans.originalCreatedAt) {
            var startTime = new Date(trans.originalCreatedAt);
            var elapsed = payTime.getTime() - startTime.getTime();
            if (elapsed >= lockHours * 60 * 60 * 1000) return true;
        }
    } else if (trans.type === 'debt_payment' && trans.tableId) {
        // FIX: ghi nợ tại bàn cũng có tableTime nhưng trước đây bị bỏ qua vì điều
        // kiện chỉ nhận type === 'dinein'. -> ghi nợ của bàn đã ngồi lâu (>5h) vẫn
        // hoàn tác được tuỳ ý, lệch với thanh toán tiền mặt của cùng bàn đó.
        if (trans.tableTime) {
            var dm = trans.tableTime.match(/(\d+)h(\d*)p?/);
            if (dm) {
                // >= để khớp với tables.js (xem giải thích ở nhánh dinein)
                var dh = parseInt(dm[1], 10);
                if (dh >= lockHours) return true;
            }
        }
        if (trans.startTime) {
            var st = new Date(trans.startTime);
            if (payTime.getTime() - st.getTime() >= lockHours * 60 * 60 * 1000) return true;
        }
    }
    
    return false;
}

// ========== BIẾN TOÀN CỤC ==========

// Helper: format Date object thành YYYY-MM-DD theo giờ địa phương (không dùng UTC)
function _toLocalDateStr(dateObj) {
    var y = dateObj.getFullYear();
    var m = ('0' + (dateObj.getMonth() + 1)).slice(-2);
    var d = ('0' + dateObj.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
}

// Helper: tính thời gian đã trôi qua (format giống tableTime: 12p, 2h15p, 5h30p)
function _getElapsedTime(dateStr) {
    var now = new Date();
    var txDate = new Date(dateStr);
    var diffMs = now.getTime() - txDate.getTime();
    if (diffMs < 0) return '0p';
    var totalMin = Math.floor(diffMs / 60000);
    if (totalMin < 1) return 'mới xong';
    if (totalMin < 60) return totalMin + 'p';
    var hours = Math.floor(totalMin / 60);
    var mins = totalMin % 60;
    if (mins === 0) return hours + 'h';
    return hours + 'h' + mins + 'p';
}

function _renderTxItem(tx, index) {
    var isRefunded = tx.refunded === true;
    var txDate = new Date(tx.createdAt || tx.date);
    var elapsedTime = _getElapsedTime(tx.createdAt || tx.date);
    // Dùng GIỜ VIỆT NAM (UTC+7) cho phần hiển thị, giống hệt quyết định khóa.
    // Trước đây dùng txDate.getHours() = giờ LOCAL CỦA MÁY. Máy đặt UTC (phổ
    // biến với tablet Android rẻ) thì mọi giao dịch lệch -7 giờ, trong khi
    // isTransactionLocked vẫn dùng giờ VN => nhân viên thấy giờ không khớp
    // với trạng thái khóa.
    var vt = _getVnTimePartsOf(txDate);
    var hours = vt.hour;
    var minutes = vt.minute;
    var ampm = hours >= 12 ? 'PM' : 'AM';
    var h12 = hours % 12;
    if (h12 === 0) h12 = 12;
    var exactTime = h12 + ':' + ('0' + minutes).slice(-2) + ' ' + ampm;
    
    var isDeleteTable = (tx.type === 'delete_table');
    
    var location = '';
    var tableTimeBadge = '';
    if (isDeleteTable) {
        location = '🗑️ ' + escapeHtml(tx.tableName || 'Đã xóa');
    } else if (tx.tableName) {
        var displayLabel = (tx.customer && tx.customer.name) ? tx.customer.name : tx.tableName;
        location = '🪑 ' + escapeHtml(displayLabel);
        if (tx.tableTime) {
            tableTimeBadge = '<span class="history-table-time">⏱ ' + escapeHtml(tx.tableTime) + '</span>';
        }
    } else if (tx.type === 'takeaway') location = '🛵 Mang đi';
    else if (tx.type === 'grab') location = '🚕 Grab';
    else location = '🍽️ Tại chỗ';

    var isDebtRecord = (tx.type === 'debt_payment' && tx.paymentMethod === 'debt');
    var isDebtPayment = (tx.type === 'debt_payment' && tx.paymentMethod !== 'debt');
    var isCredit = (tx.type === 'credit');

    var method = '';
    var methodClass = '';
    if (isDeleteTable) {
        method = '🗑️ Xóa bàn';
        methodClass = 'delete-table-method';
    } else if (isRefunded) {
        method = '❌ Đã hủy';
        methodClass = 'refunded-method';
    } else if (isCredit) {
        method = '💰 Tiền dư';
        methodClass = 'credit-method';
    } else if (isDebtRecord) {
        method = '📝 Ghi nợ';
        methodClass = 'debt-record-method';
    } else if (isDebtPayment) {
        method = '💵 Thanh toán nợ';
        methodClass = 'debt-payment-method';
    } else if (tx.paymentMethod === 'cash') method = '💰 Tiền mặt';
    else if (tx.paymentMethod === 'transfer') method = '💳 Chuyển khoản';
    else if (tx.paymentMethod === 'grab') method = '🚕 Grab';
    else method = '✅ Thành công';

    var customerHtml = '';
    if (tx.customer && tx.customer.name) {
        customerHtml = '<span class="history-customer">👤 ' + escapeHtml(tx.customer.name) + '</span>';
    }

    var itemCount = 0;
    var itemsListHtml = '';
    if (tx.items && tx.items.length) {
        itemsListHtml = '<div class="history-items-list">';
        for (var j = 0; j < tx.items.length; j++) {
            var item = tx.items[j];
            itemCount += item.qty;
            itemsListHtml += '<span class="history-item-name">' + escapeHtml(item.name) + ' x' + item.qty + '</span>';
        }
        itemsListHtml += '</div>';
    }

    var itemClass = 'history-item';
    if (isDeleteTable) itemClass += ' delete-table-item';
    else if (isRefunded) itemClass += ' refunded';
    else if (isCredit) itemClass += ' credit-item';
    else if (isDebtRecord) itemClass += ' debt-record';
    else if (isDebtPayment) itemClass += ' debt-payment';

    var amountSign = isRefunded ? '-' : (isDebtRecord ? '📝' : (isCredit ? '+' : '+'));
    var amountClass = 'history-amount';
    if (isDeleteTable) amountClass += ' delete-table-amount';
    else if (isRefunded) amountClass += ' refunded-amount';
    else if (isCredit) amountClass += ' credit-amount';
    else if (isDebtRecord) amountClass += ' debt-record-amount';
    else if (isDebtPayment) amountClass += ' debt-payment-amount';

    // Vuốt trái: nút Hoàn tác (giao dịch chưa hoàn tác)
    // Vuốt phải: nút Xóa (chỉ admin, mọi giao dịch)
    var swipeHtml = '';
    var currentUser = DB.getCurrentUser();
    var isAdmin = currentUser && isAdminUser();
    
    // Nút hoàn tác (vuốt trái) - cho giao dịch chưa hoàn tác
    if (!isRefunded) {
        // Staff chỉ được hoàn tác giao dịch trong ngày hôm nay
        var canRefund = true;
        if (!isAdmin) {
            var dateEl = document.getElementById('historyDate');
            var viewingDate = dateEl ? dateEl.getAttribute('data-date') : '';
            // Dùng chung _toLocalDateStr với addHistory() và db.js (cùng dùng giờ
            // local của máy) để cổng ngày khớp với dateKey của giao dịch.
            var todayStr = _toLocalDateStr(new Date());
            // fail-CLOSED: thiếu data-date thì KHÔNG cho phép (trước đây
            // `if (viewingDate && ...)` cho phép khi thiếu data-date)
            canRefund = (viewingDate === todayStr);
        }
        if (canRefund) {
            swipeHtml += '<div class="history-swipe-actions"><button class="swipe-refund-btn" onclick="event.stopPropagation(); refundTransaction(\'' + tx.id + '\')">↩️ Hoàn tác</button></div>';
        }
    }
    
    // Nút xóa (vuốt phải) - chỉ admin, mọi giao dịch (đã hoàn tác hoặc chưa)
    if (isAdmin) {
        swipeHtml += '<div class="history-swipe-left-actions"><button class="swipe-delete-btn" onclick="event.stopPropagation(); deleteTransaction(\'' + tx.id + '\')">🗑️ Xóa</button></div>';
    }

    var staffHtml = tx.createdByName ? '<span class="history-staff">👤 ' + escapeHtml(tx.createdByName) + '</span>' : '';

    var sttHtml = (index !== undefined) ? '<span class="history-stt">#' + (index + 1) + '</span>' : '';

    return '<div class="' + itemClass + '" onclick="showTransactionDetail(\'' + tx.id + '\')">' +
        '<div class="history-line1">' +
            sttHtml +
            '<span class="history-time"><span class="history-elapsed">' + elapsedTime + '</span><span class="history-clock">' + exactTime + '</span></span>' +
            '<span class="history-location">' + location + '</span>' +
            tableTimeBadge +
            '<span class="history-item-count">📦 ' + itemCount + ' món</span>' +
            '<span class="history-method ' + methodClass + '">' + method + '</span>' +
            customerHtml +
            staffHtml +
            '<span class="' + amountClass + ' history-amount-inline">' +
                amountSign + ' ' + formatMoney(tx.amount) +
            '</span>' +
        '</div>' +
        itemsListHtml +
        swipeHtml +
    '</div>';
}

// ========== HÀM TÌM KIẾM LỊCH SỬ ==========
// Bỏ dấu tiếng Việt, chuẩn hóa khoảng trắng để tìm kiếm
function _removeDiacritics(str) {
    if (!str) return '';
    // Bàn phím Android hay nhập dạng NFD (dấu tách rời U+0300-U+036F) trong khi
    // dữ liệu lưu NFC => gõ "to" không khớp "tố". Chuẩn hoá về NFD rồi bỏ
    // nhóm dấu trước khi thay map.
    if (str.normalize) {
        try { str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    }
    var map = {
        'à':'a','á':'a','ạ':'a','ả':'a','ã':'a','â':'a','ầ':'a','ấ':'a','ậ':'a','ẩ':'a','ẫ':'a','ă':'a','ằ':'a','ắ':'a','ặ':'a','ẳ':'a','ẵ':'a',
        'è':'e','é':'e','ẹ':'e','ẻ':'e','ẽ':'e','ê':'e','ề':'e','ế':'e','ệ':'e','ể':'e','ễ':'e',
        'ì':'i','í':'i','ị':'i','ỉ':'i','ĩ':'i',
        'ò':'o','ó':'o','ọ':'o','ỏ':'o','õ':'o','ô':'o','ồ':'o','ố':'o','ộ':'o','ổ':'o','ỗ':'o','ơ':'o','ờ':'o','ớ':'o','ợ':'o','ở':'o','ỡ':'o',
        'ù':'u','ú':'u','ụ':'u','ủ':'u','ũ':'u','ư':'u','ừ':'u','ứ':'u','ự':'u','ử':'u','ữ':'u',
        'ỳ':'y','ý':'y','ỵ':'y','ỷ':'y','ỹ':'y',
        'đ':'d',
        'À':'A','Á':'A','Ạ':'A','Ả':'A','Ã':'A','Â':'A','Ầ':'A','Ấ':'A','Ậ':'A','Ẩ':'A','Ẫ':'A','Ă':'A','Ằ':'A','Ắ':'A','Ặ':'A','Ẳ':'A','Ẵ':'A',
        'È':'E','É':'E','Ẹ':'E','Ẻ':'E','Ẽ':'E','Ê':'E','Ề':'E','Ế':'E','Ệ':'E','Ể':'E','Ễ':'E',
        'Ì':'I','Í':'I','Ị':'I','Ỉ':'I','Ĩ':'I',
        'Ò':'O','Ó':'O','Ọ':'O','Ỏ':'O','Õ':'O','Ô':'O','Ồ':'O','Ố':'O','Ộ':'O','Ổ':'O','Ỗ':'O','Ơ':'O','Ờ':'O','Ớ':'O','Ợ':'O','Ở':'O','Ỡ':'O',
        'Ù':'U','Ú':'U','Ụ':'U','Ủ':'U','Ũ':'U','Ư':'U','Ừ':'U','Ứ':'U','Ự':'U','Ử':'U','Ữ':'U',
        'Ỳ':'Y','Ý':'Y','Ỵ':'Y','Ỷ':'Y','Ỹ':'Y',
        'Đ':'D'
    };
    return str.replace(/[^a-zA-Z0-9\s]/g, function(ch) { return map[ch] || ch; });
}

// Chuẩn hóa keyword: bỏ dấu, lowercase, trim khoảng trắng
function _normalizeKeyword(str) {
    return _removeDiacritics(str).toLowerCase().trim();
}

// Hàm tìm kiếm được gọi từ oninput của ô tìm kiếm
function onHistorySearch() {
    var input = document.getElementById('historySearchInput');
    if (!input) return;
    var keyword = _normalizeKeyword(input.value);
    // Nhớ từ khóa để áp lại sau mỗi lần _renderHistoryCore thay innerHTML
    _historySearchKeyword = keyword;

    var container = document.getElementById('historyList');
    if (!container) return;
    
    // Nếu không có keyword, hiển thị lại tất cả
    if (!keyword) {
        // Re-render lại history với filter hiện tại
        var dateEl = document.getElementById('historyDate');
        var dateStr = dateEl ? dateEl.getAttribute('data-date') : '';
        if (dateStr) {
            _renderHistoryCore(dateStr);
        }
        return;
    }
    
    // Lấy tất cả các item history đang hiển thị
    var items = container.querySelectorAll('.history-item');
    if (!items.length) return;
    
    var hasMatch = false;
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var match = false;
        
        // Lấy text content của item (bao gồm tất cả text trong item)
        var itemText = item.textContent || '';
        var normalizedText = _normalizeKeyword(itemText);
        
        // Kiểm tra keyword có trong text không
        if (normalizedText.indexOf(keyword) !== -1) {
            match = true;
        } else {
            // Kiểm tra số tiền: chỉ chạy khi keyword CHỈ gồm chữ số.
            // Trước đây parseInt(keyword.replace(/[^0-9]/g,'')) gộp mọi chữ số
            // trong keyword, nên "combo 21" bị coi như tìm số tiền 21.
            if (/^\d[\d.\s]*$/.test(keyword)) {
                var amountNum = parseInt(keyword.replace(/[^\d]/g, ''), 10);
                if (amountNum > 0) {
                    // formatMoney dùng toLocaleString('vi-VN') => "50.000đ" (DẤU CHẤM).
                    // Regex cũ /[\+\-]\s*([\d,]+)/ chỉ bắt được "50" trong "50.000"
                    // => tìm số tiền >= 1000 luôn hỏng, chỉ số < 1000 mới ra kết quả.
                    var amountMatch = itemText.match(/[\+\-]\s*([\d.,\s]*\d)/);
                    if (amountMatch) {
                        var itemAmount = parseInt(amountMatch[1].replace(/[^\d]/g, ''), 10);
                        if (itemAmount === amountNum) {
                            match = true;
                        }
                    }
                }
            }
        }
        
        item.style.display = match ? '' : 'none';
        if (match) hasMatch = true;
    }
    
    // Ẩn/hiện summary
    var summary = container.querySelector('.history-summary');
    if (summary) {
        summary.style.display = hasMatch ? '' : 'none';
    }
    
    // Nếu không có kết quả, hiển thị thông báo
    var emptyMsg = container.querySelector('.history-search-empty');
    if (!hasMatch) {
        if (!emptyMsg) {
            emptyMsg = document.createElement('div');
            emptyMsg.className = 'history-search-empty';
            emptyMsg.style.cssText = 'text-align:center;padding:30px 16px;color:#94a3b8;font-size:14px;';
            emptyMsg.textContent = '🔍 Không tìm thấy giao dịch phù hợp';
            container.appendChild(emptyMsg);
        }
        emptyMsg.style.display = '';
    } else {
        if (emptyMsg) emptyMsg.style.display = 'none';
    }
}

// Số thứ tự render + filter/từ khóa đang dùng.
// - _historyRenderSeq: chống 2 render khác ngày chạy chồng nhau (xem _renderHistoryCore)
// - _historyFilter: nhớ filter đang bật, vì chip nhân viên được dựng lại mỗi
//   lần render nên đọc trạng thái từ DOM sẽ mất.
// - _historySearchKeyword: giữ từ khóa tìm kiếm qua các lần render lại.
var _historyRenderSeq = 0;
var _historyFilter = 'all';
var _historySearchKeyword = '';

// FIX: Gộp renderHistoryByDate và renderHistoryByDateStr thành 1 hàm core duy nhất
// để tránh duplicate code ~160 dòng
function _renderHistoryCore(dateStr) {
    var dateEl = document.getElementById('historyDate');
    if (!dateEl) {
        console.warn('⚠️ _renderHistoryCore: #historyDate not found in DOM');
        return;
    }
    var mySeq = ++_historyRenderSeq;

    // Đổi ngày -> bỏ từ khóa tìm kiếm cũ (đang tìm trong ngày khác vô nghĩa)
    if (dateEl.getAttribute('data-date') !== dateStr) {
        _historySearchKeyword = '';
        var searchEl = document.getElementById('historySearchInput');
        if (searchEl) searchEl.value = '';
    }

    dateEl.innerText = formatDateDisplay(dateStr);
    dateEl.setAttribute('data-date', dateStr);
    
    // FIX: Đọc filter từ .filter-chip.active (cả trong #historyFilterChips và #historyStaffChips)
    // HTML dùng filter-chip buttons, không có <select>
    var activeChip = document.querySelector('#historyFilterChips .filter-chip.active, #historyStaffChips .filter-chip.active');
    var filter = activeChip ? activeChip.getAttribute('data-filter') : 'all';
    _historyFilter = filter;
    
    DB.getTransactionsByDate(dateStr).then(function(transactions) {
        // Bỏ qua nếu đã có render mới hơn (bấm ◀ rồi ▶ nhanh: render chậm của
        // ngày cũ có thể tới sau và ghi đè list của ngày mới, trong khi header
        // đã hiện ngày mới -> người dùng bấm Hoàn tác nhầm ngày).
        if (mySeq !== _historyRenderSeq) return;
        var curDate = document.getElementById('historyDate');
        if (curDate && curDate.getAttribute('data-date') !== dateStr) return;
        // Lấy danh sách tên nhân viên duy nhất từ các giao dịch
        var staffNames = [];
        var staffMap = {};
        for (var i = 0; i < transactions.length; i++) {
            var name = transactions[i].createdByName;
            if (name && !staffMap[name]) {
                staffMap[name] = true;
                staffNames.push(name);
            }
        }
        staffNames.sort();
        
        // FIX: Cập nhật staff chips vào #historyStaffChips thay vì <select> options
        // Các chip này sẽ xử lý click qua event delegation (xem pos-app.js)
        var staffChipsContainer = document.getElementById('historyStaffChips');
        if (staffChipsContainer) {
            staffChipsContainer.innerHTML = '';
            if (staffNames.length > 0) {
                for (var i = 0; i < staffNames.length; i++) {
                    var chip = document.createElement('button');
                    // Tên class đúng theo CSS (css/pos-base.css có .filter-chip-staff,
                    // không có .staff-chip) + có title để phân biệt từng nhân viên
                    chip.className = 'filter-chip filter-chip-staff';
                    chip.setAttribute('data-filter', 'staff:' + staffNames[i]);
                    chip.textContent = '👤';
                    chip.title = staffNames[i];
                    // Giữ lại chip đang active. Trước đây innerHTML = '' xoá cả chip
                    // active, nên lần render sau không tìm thấy .filter-chip.active
                    // => filter nhân viên mất hiệu lực im lặng.
                    if (filter === 'staff:' + staffNames[i]) {
                        chip.classList.add('active');
                    }
                    staffChipsContainer.appendChild(chip);
                }
            }
        }
        
        // FIX: Không cần khôi phục giá trị select, dùng filter từ active chip
        
        if (filter !== 'all') {
            transactions = transactions.filter(function(t) {
                if (filter === 'dinein') return t.type === 'dinein';
                if (filter === 'takeaway') return t.type === 'takeaway';
                if (filter === 'grab') return t.type === 'grab';
                if (filter === 'cash') return t.paymentMethod === 'cash';
                if (filter === 'transfer') return t.paymentMethod === 'transfer';
                if (filter === 'debt') return t.type === 'debt_payment' && t.paymentMethod === 'debt';
                if (filter === 'debt_payment') return t.type === 'debt_payment' && t.paymentMethod !== 'debt';
                if (filter === 'cancelled') return t.refunded === true;
                if (filter === 'credit') return t.type === 'credit';
                // FIX: Lọc giao dịch xóa bàn (delete_table) và hoàn tác (refunded)
                if (filter === 'delete_table') return t.type === 'delete_table' || t.refunded === true;
                // Filter staff: value là 'staff:TenNhanVien'
                if (filter.indexOf('staff:') === 0) return t.createdByName === filter.substring(6);
                return true;
            });
        }

        // FIX Phase 1: Chỉ dedup theo id (trùng record do load nhiều lần)
        // Đã loại bỏ dedup 5s theo nội dung - mỗi giao dịch là duy nhất
        var seenIds = {};
        transactions = transactions.filter(function(t) {
            if (seenIds[t.id]) {
                console.warn('⚠️ [DEDUP-ID] Loại bỏ giao dịch trùng id:', t.id, t.amount, t.type);
                return false;
            }
            seenIds[t.id] = true;
            return true;
        });

        // SẮP XẾP: GIAO DỊCH GẦN NHẤT LÊN TRÊN CÙNG
        transactions.sort(function(a, b) {
            var timeA = new Date(a.createdAt || a.date);
            var timeB = new Date(b.createdAt || b.date);
            return timeB - timeA;
        });

        var container = document.getElementById('historyList');
        if (!container) return;

        if (transactions.length === 0) {
            // Nhánh rỗng: phân biệt "ngày này không có giao dịch" với
            // "bộ lọc không khớp giao dịch nào". Trước đây luôn hiện
            // "Không có giao dịch nào trong ngày" -> người dùng tưởng mất dữ liệu.
            var emptyText = (filter && filter !== 'all')
                ? '🔍 Không có giao dịch nào khớp bộ lọc'
                : '📭 Không có giao dịch nào trong ngày';
            container.innerHTML = '<div class="empty-state">' + emptyText + '</div>';
            container.className = 'history-list';
            // Dùng nhãn đã bị giấu bởi bộ lọc: cho phép bỏ lọc bằng 1 chạm
            if (filter && filter !== 'all') {
                // Dùng class có thật trong CSS (css/pos-base.css có .filter-chip,
                // .btn-outline; KHÔNG có .btn-secondary)
                var clearBtn = document.createElement('button');
                clearBtn.className = 'filter-chip';
                clearBtn.setAttribute('data-filter', 'all');
                clearBtn.textContent = '🔄 Xoá bộ lọc';
                clearBtn.style.marginTop = '8px';
                clearBtn.onclick = function() {
                    var chips = document.querySelectorAll('#historyFilterChips .filter-chip, #historyStaffChips .filter-chip');
                    for (var c = 0; c < chips.length; c++) chips[c].classList.remove('active');
                    var allChip = document.querySelector('#historyFilterChips .filter-chip[data-filter="all"]');
                    if (allChip) allChip.classList.add('active');
                    _historyFilter = 'all';
                    renderHistoryByDate(currentHistoryDate);
                };
                container.appendChild(clearBtn);
            }
            return;
        }

        // TÍNH TỔNG: dựa trên transactions đã được lọc
        // Khi filter = 'debt', transactions chỉ còn giao dịch ghi nợ → tính tổng trực tiếp
        // Khi filter = 'all', bỏ qua debt (vì bộ lọc đã có phần lọc trả sau riêng)
        var totalAmount = 0;
        var totalCount = 0;
        var isDebtFilter = (filter === 'debt');
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            if (tx.refunded) continue;
            if (tx.type === 'credit') continue;
            if (tx.type === 'delete_table') continue;
            // Tiền khách NẠP TRƯỚC không phải doanh thu.
            // customers.js tạo transaction type:'prepaid' với amount = số tiền
            // khách nạp. Trước đây không chặn nên bị cộng vào "Tổng" mà
            // nhân viên/quản lý dùng để đối chiếu cuối ngày.
            if (tx.type === 'prepaid') continue;
            // Nếu filter = 'all', bỏ qua giao dịch debt (vì đã có bộ lọc riêng)
            if (!isDebtFilter && tx.type === 'debt_payment' && tx.paymentMethod === 'debt') continue;
            totalCount++;
            totalAmount += tx.amount || 0;
        }
        // Phân quyền: admin thấy tổng tiền, staff chỉ thấy số lượng
        var currentUser = DB.getCurrentUser();
        var isAdmin = currentUser && isAdminUser();
        // Nhãn nói rõ đang tính theo bộ lọc nào, tránh tưởng luôn là tổng cả ngày
        var totalLabel = (filter === 'all') ? 'Tổng' : 'Tổng (theo bộ lọc)';
        var summaryHtml = '';
        if (isAdmin) {
            summaryHtml = '<div class="history-summary">📊 ' + totalLabel + ': <strong>' + totalCount + ' giao dịch</strong> - <strong>' + formatMoney(totalAmount) + '</strong></div>';
        } else {
            summaryHtml = '<div class="history-summary">📊 ' + totalLabel + ': <strong>' + totalCount + ' giao dịch</strong></div>';
        }

        // Luôn hiển thị 1 hàng dọc
        var html = summaryHtml;
        for (var i = 0; i < transactions.length; i++) {
            html += _renderTxItem(transactions[i], i);
        }
        container.innerHTML = html;
        _initHistorySwipe();

        // Áp lại từ khóa tìm kiếm sau mỗi lần render.
        // onHistorySearch() chỉ lọc bằng style.display trên DOM hiện tại, nên
        // innerHTML vừa thay sẽ xoá sạch kết quả lọc: ô tìm kiếm còn chữ nhưng
        // list lại hiện tất cả. Rất dễ xảy ra vì realtime render lại ~200-300ms.
        if (_historySearchKeyword) {
            onHistorySearch();
        }
    }).catch(function(err) {
        if (mySeq !== _historyRenderSeq) return;
        console.error('❌ _renderHistoryCore error:', err);
        var container = document.getElementById('historyList');
        if (container) {
            container.innerHTML = '<div class="empty-state">⚠️ Lỗi tải dữ liệu: ' + escapeHtml(err.message || 'unknown') + '</div>';
        }
    });
}

function renderHistoryByDate(dateObj) {
    var dateStr = _toLocalDateStr(dateObj);
    _renderHistoryCore(dateStr);
}

function renderHistoryByDateStr(dateStr) {
    _renderHistoryCore(dateStr);
}

function showTransactionDetail(transactionId) {
    DB.get('transactions', transactionId).then(function(tx) {
        if (!tx) return;
        
        // Set thứ - ngày - tháng lên header
        var d = new Date(tx.date);
        var dayNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
        var dayName = dayNames[d.getDay()];
        var dateStrHeader = dayName + ', ' + d.toLocaleDateString('vi-VN');
        document.getElementById('txDetailDate').textContent = dateStrHeader;
        
        // YÊU CẦU 2: Hiển thị thời gian gốc và thời gian hoàn tác
        var dateStr = d.toLocaleString('vi-VN');
        var originalTimeStr = '';
        var currentTimeStr = '';
        
        if (tx.refunded && tx.originalCreatedAt) {
            originalTimeStr = new Date(tx.originalCreatedAt).toLocaleString('vi-VN');
            currentTimeStr = new Date(tx.createdAt).toLocaleString('vi-VN');
        }
        
        // Phân biệt Trả sau (mua chịu) vs Thanh toán trả sau (trả tiền)
        var isDeleteTable = (tx.type === 'delete_table');
        var isDebtRecord = (tx.type === 'debt_payment' && tx.paymentMethod === 'debt');
        var isDebtPayment = (tx.type === 'debt_payment' && tx.paymentMethod !== 'debt');
        var isCredit = (tx.type === 'credit');
        
        var typeName = '';
        if (isDeleteTable) typeName = '🗑️ Xóa bàn';
        else if (tx.type === 'dinein') typeName = 'Tại chỗ';
        else if (tx.type === 'takeaway') typeName = 'Mang đi';
        else if (tx.type === 'grab') typeName = 'Grab';
        else if (isCredit) typeName = '💰 Tiền dư (trả trước)';
        else if (tx.type === 'prepaid') typeName = '💵 Khách đưa trước';
        else if (isDebtRecord) typeName = '📝 Ghi nợ (mua chịu)';
        else if (isDebtPayment) typeName = '💵 Thanh toán nợ (trả tiền)';
        else typeName = tx.type || 'Khác';
        
        var paymentMethodText = '';
        if (isDeleteTable) paymentMethodText = '🗑️ Xóa bàn';
        else if (tx.paymentMethod === 'cash') paymentMethodText = '💰 Tiền mặt';
        else if (tx.paymentMethod === 'transfer') paymentMethodText = '💳 Chuyển khoản';
        else if (tx.paymentMethod === 'debt') paymentMethodText = '📝 Ghi nợ';
        else if (tx.paymentMethod === 'grab') paymentMethodText = '🚕 Grab';
        else if (tx.paymentMethod === 'credit') paymentMethodText = '💰 Tiền dư';
        
        var itemsHtml = '';
        if (tx.items && tx.items.length) {
            itemsHtml = '<div class="detail-items-title">📦 Danh sách món:</div>';
            for (var i = 0; i < tx.items.length; i++) {
                var item = tx.items[i];
                itemsHtml += '<div class="detail-item-row"><span>' + escapeHtml(item.name) + ' x' + item.qty + '</span><span>' + formatMoney(item.price * item.qty) + '</span></div>';
            }
        } else {
            itemsHtml = '<div class="empty-text">Không có món</div>';
        }
        
        var refundInfo = '';
        if (tx.refunded) {
            refundInfo = '<div class="refund-info">❌ Đã hủy lúc: ' + new Date(tx.refundedAt).toLocaleString('vi-VN') + '<br>📝 Lý do: ' + escapeHtml(tx.refundReason || '') + '</div>';
        }
        
        // Xây dựng dòng thời gian
        var timeHtml = '';
        if (tx.refunded && tx.originalCreatedAt) {
            timeHtml =
                '<div class="detail-row"><span>🕒 Thời gian gốc:</span><span>' + originalTimeStr + '</span></div>' +
                '<div class="detail-row"><span>🔄 Thời gian hoàn tác:</span><span>' + currentTimeStr + '</span></div>';
        } else {
            timeHtml = '<div class="detail-row"><span>🕒 Thời gian:</span><span>' + dateStr + '</span></div>';
        }
        
        // Hàm render HTML hoàn chỉnh (dùng callback sau khi lấy thông tin bàn)
        function renderDetail(tableTimeHtml) {
            var tableIcon = isDeleteTable ? '🗑️' : '🪑';
            var infoHtml =
                timeHtml +
                '<div class="detail-row"><span>🍽️ Loại:</span><span>' + typeName + '</span></div>' +
                '<div class="detail-row"><span>💳 Thanh toán:</span><span>' + paymentMethodText + '</span></div>' +
                (tx.tableName ? '<div class="detail-row"><span>' + tableIcon + ' Bàn:</span><span>' + escapeHtml(tx.customer && tx.customer.name ? tx.customer.name : tx.tableName) + '</span></div>' : '') +
                (tx.createdByName ? '<div class="detail-row"><span>👤 Nhân viên:</span><span>' + escapeHtml(tx.createdByName) + '</span></div>' : '') +
                tableTimeHtml +
                '<div class="detail-row" style="margin-top:4px;padding-top:6px;border-top:1px dashed #e2e8f0;"><span>💰 Tổng tiền:</span><span class="detail-amount">' + formatMoney(tx.amount) + '</span></div>' +
                refundInfo;
            
            var html =
                '<div class="detail-section">' + infoHtml + '</div>' +
                '<div class="detail-section">' + itemsHtml + '</div>' +
                '<div class="form-actions" style="margin-top:8px;display:flex;gap:8px;">' +
                    '<button class="btn-save" style="flex:1;" onclick="printTransactionDetail(\'' + transactionId + '\')">🖨️ In nhiệt</button>' +
                    '<button class="btn-save" style="flex:1;background:#f97316;" onclick="exportTransactionPDF(\'' + transactionId + '\')">📄 Xuất PDF</button>' +
                '</div>';
            
            document.getElementById('transactionDetailBody').innerHTML = html;
            document.getElementById('transactionDetailModal').style.display = 'flex';
        }
        
        // YÊU CẦU 1: Lấy thông tin thời gian hoạt động của bàn
        // Ưu tiên dùng startTime/endTime từ transaction (đã lưu khi thanh toán)
        if (tx.startTime || tx.endTime || tx.tableId) {
            var tableTimeHtml = '';
            
            if (tx.startTime && tx.endTime) {
                // Dùng dữ liệu từ transaction
                var startTime = new Date(tx.startTime);
                var endTime = new Date(tx.endTime);
                var startStr = startTime.toLocaleString('vi-VN');
                var endStr = endTime.toLocaleString('vi-VN');
                var elapsed = endTime.getTime() - startTime.getTime();
                var hours = Math.floor(elapsed / 3600000);
                var mins = Math.floor((elapsed % 3600000) / 60000);
                var durationStr = hours + 'h' + (mins > 0 ? mins + 'p' : '');
                
                tableTimeHtml =
                    '<div class="detail-row"><span>🕐 Bàn mở lúc:</span><span>' + startStr + '</span></div>' +
                    '<div class="detail-row"><span>🕐 Bàn đóng lúc:</span><span>' + endStr + '</span></div>' +
                    '<div class="detail-row"><span>⏱ Thời gian hoạt động:</span><span>' + durationStr + '</span></div>';
                renderDetail(tableTimeHtml);
            } else if (tx.tableId) {
                // FIX 2: Dùng window.cachedTables thay vì DB.get('tables', ...)
                var cachedTables = window.cachedTables || [];
                var table = null;
                for (var ti = 0; ti < cachedTables.length; ti++) {
                    if (String(cachedTables[ti].id) === String(tx.tableId)) {
                        table = cachedTables[ti];
                        break;
                    }
                }
                // Fallback: bàn đã bị XOÁ khỏi DB sau khi thanh toán
                // (tables.js gọi DB.remove khi đóng bàn) nên cachedTables chỉ
                // chứa bàn ĐANG HOẠT ĐỘNG => vòng dò trên không tìm thấy.
                // tx.tableTime ("2h15p") vẫn còn trong transaction, dùng làm dự phòng.
                if (!tableTimeHtml && tx.tableTime) {
                    tableTimeHtml = '<div class="detail-row"><span>⏱ Thời gian bàn:</span><span>' + escapeHtml(tx.tableTime) + '</span></div>';
                }
                if (table && table.startTime) {
                    var startTime = new Date(table.startTime);
                    var endTime = table.endTime ? new Date(table.endTime) : new Date(tx.createdAt || tx.date);
                    var startStr = startTime.toLocaleString('vi-VN');
                    var endStr = endTime.toLocaleString('vi-VN');
                    
                    var elapsed = endTime.getTime() - startTime.getTime();
                    var hours = Math.floor(elapsed / 3600000);
                    var mins = Math.floor((elapsed % 3600000) / 60000);
                    var durationStr = hours + 'h' + (mins > 0 ? mins + 'p' : '');
                    
                    tableTimeHtml =
                        '<div class="detail-row"><span>🕐 Bàn mở lúc:</span><span>' + startStr + '</span></div>' +
                        '<div class="detail-row"><span>🕐 Bàn đóng lúc:</span><span>' + endStr + '</span></div>' +
                        '<div class="detail-row"><span>⏱ Thời gian hoạt động:</span><span>' + durationStr + '</span></div>';
                }
                renderDetail(tableTimeHtml);
            } else {
                renderDetail('');
            }
        } else {
            // Ghi nợ tại bàn cũng có tableTime nhưng không có startTime
            if (tx.tableTime) {
                renderDetail('<div class="detail-row"><span>⏱ Thời gian bàn:</span><span>' + escapeHtml(tx.tableTime) + '</span></div>');
            } else {
                renderDetail('');
            }
        }
    }).catch(function(err) {
        console.error('[showTransactionDetail] lỗi:', err);
        showToast('❌ Lỗi tải chi tiết giao dịch', 'error');
    });
}

// FIX 7: printTransactionDetail nhận tham số transaction từ cache (nếu có)
// để tránh query DB lại. Nếu chỉ có transactionId thì mới query.
function printTransactionDetail(transactionId, tx) {
    if (!tx) {
        DB.get('transactions', transactionId).then(function(fetchedTx) {
            if (!fetchedTx) return;
            _doPrintTransaction(fetchedTx);
        });
    } else {
        _doPrintTransaction(tx);
    }
}

function _doPrintTransaction(tx) {
    if (typeof printAfterPayment === 'function') {
        printAfterPayment({
            orderType: tx.type || 'dinein',
            amount: tx.amount || 0,
            paymentMethod: tx.paymentMethod || 'cash',
            items: tx.items || [],
            tableName: tx.tableName || null,
            customer: tx.customer || null,
            tableTime: tx.tableTime || null,
            startTime: tx.startTime || null,
            endTime: tx.endTime || null,
            createdAt: tx.createdAt || tx.date
        });
    }
}

function exportTransactionPDF(transactionId) {
    DB.get('transactions', transactionId).then(function(tx) {
        if (!tx) {
            showToast('❌ Không tìm thấy giao dịch', 'error');
            return;
        }
        if (typeof exportBillPDF === 'function') {
            exportBillPDF({
                orderType: tx.type || 'dinein',
                amount: tx.amount || 0,
                paymentMethod: tx.paymentMethod || 'cash',
                items: tx.items || [],
                tableName: tx.tableName || null,
                customer: tx.customer || null,
                tableTime: tx.tableTime || null,
                startTime: tx.startTime || null,
                endTime: tx.endTime || null,
                createdAt: tx.createdAt || tx.date
            });
        } else {
            showToast('❌ Chức năng xuất PDF chưa sẵn sàng', 'error');
        }
    }).catch(function(err) {
        console.error('[exportTransactionPDF] Lỗi:', err);
        showToast('❌ Lỗi khi xuất PDF', 'error');
    });
}

// ========== LÝ DO HỦY MẪU ==========
var REFUND_REASONS = [
    'Nhầm món',
    'Nhầm PTTT',
    'Nhầm khách',
    'Khác'
];

function showRefundReasonModal(callback) {
    var modal = document.getElementById('refundReasonModal');
    if (!modal) {
        // Tạo modal nếu chưa có
        modal = document.createElement('div');
        modal.id = 'refundReasonModal';
        modal.className = 'modal';
        modal.innerHTML =
            '<div class="modal-content" style="max-width:400px;">' +
                '<div class="modal-header">📝 Lý do hủy</div>' +
                '<div id="refundReasonList" style="padding:16px;display:flex;flex-direction:column;gap:8px;"></div>' +
                '<div id="refundReasonOther" style="padding:0 16px 16px;display:none;">' +
                    '<input type="text" id="refundReasonOtherInput" class="form-input" placeholder="Nhập lý do khác..." style="width:100%;">' +
                '</div>' +
                '<div class="form-actions" style="padding:0 16px 16px;">' +
                    '<button class="btn-cancel" onclick="closeModal(\'refundReasonModal\')">Hủy</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(modal);
    }
    
    var list = document.getElementById('refundReasonList');
    var otherDiv = document.getElementById('refundReasonOther');
    var otherInput = document.getElementById('refundReasonOtherInput');
    if (otherInput) otherInput.value = '';
    if (otherDiv) otherDiv.style.display = 'none';
    
    // FIX 5: Cleanup event listeners cũ - xóa nút confirm cũ nếu có
    var oldConfirmBtn = document.getElementById('refundReasonOtherConfirm');
    if (oldConfirmBtn) {
        oldConfirmBtn.onclick = null;
        oldConfirmBtn.parentNode.removeChild(oldConfirmBtn);
    }
    if (otherInput) {
        otherInput.onkeydown = null; // Xóa listener cũ
    }
    
    var html = '';
    for (var i = 0; i < REFUND_REASONS.length; i++) {
        (function(reason) {
            html += '<button class="btn-save" data-reason="' + reason + '" style="width:100%;text-align:center;">' + reason + '</button>';
        })(REFUND_REASONS[i]);
    }
    list.innerHTML = html;
    
    // Gắn sự kiện cho các nút
    var btns = list.querySelectorAll('.btn-save');
    for (var i = 0; i < btns.length; i++) {
        (function(btn) {
            btn.onclick = function() {
                var reason = btn.getAttribute('data-reason');
                if (reason === 'Khác') {
                    var otherDiv = document.getElementById('refundReasonOther');
                    var otherInput = document.getElementById('refundReasonOtherInput');
                    if (otherDiv) otherDiv.style.display = 'block';
                    if (otherInput) {
                        otherInput.focus();
                        otherInput.onkeydown = function(e) {
                            if (e.key === 'Enter' && otherInput.value.trim()) {
                                closeModal('refundReasonModal');
                                callback(otherInput.value.trim());
                            }
                        };
                        // Nút xác nhận cho "Khác"
                        var confirmBtn = document.createElement('button');
                        confirmBtn.id = 'refundReasonOtherConfirm';
                        confirmBtn.className = 'btn-save';
                        confirmBtn.innerText = 'Xác nhận';
                        confirmBtn.style.marginTop = '8px';
                        otherDiv.appendChild(confirmBtn);
                        confirmBtn.onclick = function() {
                            if (otherInput.value.trim()) {
                                closeModal('refundReasonModal');
                                callback(otherInput.value.trim());
                            }
                        };
                    }
                } else {
                    closeModal('refundReasonModal');
                    callback(reason);
                }
            };
        })(btns[i]);
    }
    
    modal.style.display = 'flex';
}

function refundTransaction(transactionId) {
    // Kiểm tra xem giao dịch có thuộc ngày hôm nay không
    // Fix timezone: dùng _toLocalDateStr thay vì toISOString().slice(0,10)
    var todayStr = _toLocalDateStr(new Date());
    
    DB.get('transactions', transactionId).then(function(trans) {
        if (!trans) {
            showToast('⚠️ Không tìm thấy giao dịch', 'warning');
            return;
        }
        if (trans.refunded) {
            showToast('ℹ️ Giao dịch này đã được hủy trước đó', 'warning');
            return;
        }
        
        // YÊU CẦU 1: Chặn hoàn tác giao dịch ngày trước đó
        // Fix timezone: nếu không có dateKey, parse trans.date theo giờ địa phương
        var transDate = trans.dateKey;
        if (!transDate && trans.date) {
            transDate = _toLocalDateStr(new Date(trans.date));
        }
        if (transDate !== todayStr) {
            showToast('❌ Không thể hoàn tác giao dịch của ngày trước đó', 'error');
            return;
        }
        
        // Chặn khi CHƯA BIẾT ngày đã chốt hay chưa.
        // isDayClosed() trả false khi _dayClosedCache === null (dữ liệu chốt
        // ngày chưa tải xong) => vài giây đầu sau khi mở app (hoặc khi offline)
        // nhân viên có thể hoàn tác mà không bị hỏi mật khẩu, kể cả khi ngày
        // thực sự đã chốt. Phải chặn (fail-closed) chứ không cho qua.
        if (typeof isDayClosedUnknown === 'function' && isDayClosedUnknown()) {
            showToast('⏳ Đang tải trạng thái chốt ngày, vui lòng thử lại sau', 'warning');
            return;
        }
        
        // YÊU CẦU 3: Kiểm tra đã chốt ngày chưa - nếu đã chốt thì yêu cầu mật khẩu
        // Chống gian lận: nhân viên không thể hoàn tác sau khi đã chốt ngày
        if (typeof isDayClosed === 'function' && isDayClosed()) {
            requirePassword('hoàn tác giao dịch (đã chốt ngày hôm nay)', function() {
                // YÊU CẦU 2: Kiểm tra khóa giao dịch dựa trên thời điểm thanh toán
                var locked = isTransactionLocked(trans);
                return proceedRefund(trans, locked);
            });
            return;
        }
        
        // YÊU CẦU 2: Kiểm tra khóa giao dịch dựa trên thời điểm thanh toán
        // - Giao dịch bị khóa (thanh toán trong khung giờ khóa 17h-5h30, hoặc ngồi quá 5h) → yêu cầu mật khẩu
        // - Giao dịch không bị khóa → không cần mật khẩu
        var locked = isTransactionLocked(trans);
        return proceedRefund(trans, locked);
    });
}

// ========== KHÔI PHỤC PREPAIDBALANCE KHI HOÀN TÁC ==========
// creditUsed: số tiền đã dùng từ prepaidBalance (cần cộng lại)
// prepaidChange: số tiền dư được thêm vào prepaidBalance (cần trừ đi)
// txTime: thời điểm giao dịch, dùng để xác định đúng creditHistory entry cần xóa
function restoreCustomerCredit(customerId, creditUsed, prepaidChange, txTime) {
    return new Promise(function(resolve, reject) {
        if (!customerId || (!creditUsed && !prepaidChange)) { resolve(); return; }
        var c = null;
        for (var i = 0; i < customers.length; i++) {
            if (customers[i].id === customerId) { c = customers[i]; break; }
        }
        function doRestore(cust) {
            var updateData = {};
            var changed = false;
            
            // 1. Khôi phục prepaidBalance nếu đã dùng credit (creditUsed > 0)
            if (creditUsed > 0) {
                cust.prepaidBalance = (cust.prepaidBalance || 0) + creditUsed;
                updateData.prepaidBalance = cust.prepaidBalance;
                // Xóa creditHistory entry tương ứng.
                // FIX: so sánh theo cả số tiền VÀ thời gian gần với giao dịch.
                // Trước đây chỉ so amount === -creditUsed nên khi khách dùng tiền dư
                // 2 lần cùng số tiền, sẽ xóa nhầm entry cũ và để lại entry mới
                // -> lịch sử hiển thị sai.
                if (cust.creditHistory) {
                    for (var k = 0; k < cust.creditHistory.length; k++) {
                        if (cust.creditHistory[k].amount === -creditUsed && _isNearTransTime(cust.creditHistory[k].date, txTime)) {
                            cust.creditHistory.splice(k, 1);
                            break;
                        }
                    }
                }
                updateData.creditHistory = cust.creditHistory || [];
                changed = true;
            }
            
            // 2. Trừ prepaidBalance nếu có overpay (prepaidChange > 0)
            if (prepaidChange > 0) {
                cust.prepaidBalance = Math.max(0, (cust.prepaidBalance || 0) - prepaidChange);
                updateData.prepaidBalance = cust.prepaidBalance;
                // Xóa creditHistory entry tương ứng (cũng so cả số tiền và thời gian)
                if (cust.creditHistory) {
                    for (var k = 0; k < cust.creditHistory.length; k++) {
                        if (cust.creditHistory[k].amount === prepaidChange && _isNearTransTime(cust.creditHistory[k].date, txTime)) {
                            cust.creditHistory.splice(k, 1);
                            break;
                        }
                    }
                }
                updateData.creditHistory = cust.creditHistory || [];
                changed = true;
            }
            
            if (changed) {
                updateData.creditBalance = cust.prepaidBalance || 0;
                // PHẢI có .catch + truyền reject: trước đây chỉ có .then(resolve)
                // nên khi DB.update() lỗi thì promise KHÔNG BAO GIỜ settle ->
                // Promise.all trong doRefund treo vĩnh viễn, giao dịch không
                // bao giờ được đánh dấu refunded và không có báo lỗi nào.
                DB.update('customers', cust.id, updateData).then(function() {
                    // Bỏ cache tính toán (TTL 5 phút) để số nợ/tiền dư hiển thị đúng
                    if (typeof _invalidateCustomerCalcCache === 'function') {
                        _invalidateCustomerCalcCache();
                    }
                    resolve();
                }).catch(function(err) {
                    console.error('[restoreCustomerCredit] lỗi cập nhật khách:', err);
                    reject(err);
                });
            } else {
                resolve();
            }
        }
        if (c) {
            doRestore(c);
        } else {
            DB.getAll('customers').then(function(allC) {
                for (var i = 0; i < allC.length; i++) {
                    if (allC[i].id === customerId) { c = allC[i]; break; }
                }
                if (c) { doRestore(c); } else { resolve(); }
            }).catch(function(err) {
                console.error('[restoreCustomerCredit] lỗi đọc khách:', err);
                reject(err);
            });
        }
    });
}

// Kiểm tra 2 mốc thời gian có gần nhau trong 2 phút không
// Dùng khi cần khớp entry lịch sử với giao dịch mà chỉ biết số tiền + thời gian
function _isNearTransTime(entryDate, txTime) {
    // Mốc thời gian hỏng thì KHÔNG được khớp. Trước đây trả true khiến mọi entry
    // cùng số tiền đều khớp -> xoá nhầm entry khác, đúng cái tình huống mà
    // điều kiện 2 phút sinh ra để tránh.
    if (!txTime || isNaN(txTime)) return false;
    var t = new Date(entryDate).getTime();
    if (isNaN(t)) return false;
    return Math.abs(t - txTime) < 120000;
}

function proceedRefund(trans, needPassword) {
    var transactionId = trans.id;
    function doRefund() {
        showRefundReasonModal(function(reason) {
            if (!reason) return;
            // NÂNG CẤP: Khi hoàn tác xóa bàn, không gọi restoreIngredients lần nữa
            // vì restoreIngredients đã được gọi trong doDeleteTable() khi xóa bàn
            var ingPromise = Promise.resolve();
            if (trans.type !== 'delete_table') {
                ingPromise = restoreIngredients(trans.items);
            }
            // Có .catch để lỗi hoàn kho không làm đứt chuỗi im lặng
            ingPromise.catch(function(err) {
                console.error('[refund] lỗi hoàn nguyên liệu:', err);
            }).then(function() {
                // Xử lý hoàn tác trả sau: trả về Promise để đợi hoàn thành trước khi update transaction
                var debtPromise = Promise.resolve();
                
                if (trans.type === 'debt_payment' && trans.customer) {
                    if (trans.paymentMethod === 'debt') {
                        // GHI NỢ: hoàn tác = xóa entry debtHistory gốc và trừ totalDebt
                        // KHÔNG thêm entry mới để tránh sai lệch lịch sử trả sau
                        // (creditUsed được hoàn ở creditPromise bên dưới để tránh cộng 2 lần)
                        debtPromise = new Promise(function(resolve, reject) {
                            var c = null;
                            for (var i = 0; i < customers.length; i++) {
                                if (customers[i].id === trans.customer.id) { c = customers[i]; break; }
                            }
                            function doRestoreDebt(cust) {
                                // Tìm và xóa entry debtHistory gốc tương ứng với giao dịch trả sau này
                                var removedEntry = null;
                                if (cust.debtHistory) {
                                    var foundIdx = -1;
                                    for (var d = 0; d < cust.debtHistory.length; d++) {
                                        var entry = cust.debtHistory[d];
                                        if (entry.amount === trans.amount && entry.status !== 'cancelled') {
                                            var entryTime = new Date(entry.date).getTime();
                                            var txTime = new Date(trans.createdAt || trans.date).getTime();
                                            if (Math.abs(entryTime - txTime) < 120000) {
                                                foundIdx = d;
                                                break;
                                            }
                                        }
                                    }
                                    if (foundIdx >= 0) {
                                        removedEntry = cust.debtHistory[foundIdx];
                                        cust.debtHistory.splice(foundIdx, 1);
                                    }
                                }
                                // FIX: khi ghi nợ đã tự trừ tiền dư của khách (creditUsed)
                                // mà không hoàn lại thì khách mất tiền.
                                //
                                // Lỗi cũ: khối này cộng prepaidBalance +=
                                // removedEntry.creditUsed, đồng thời creditPromise bên
                                // dưới lại gọi restoreCustomerCredit với trans.creditUsed
                                // (đúng số đó) => cộng 2 lần.
                                // Cách sửa lúc đó: bỏ cộng ở đây và truyền
                                // creditUsed = 0 cho creditPromise.
                                //
                                // Nhưng làm vậy thì CẢ HAI đều không hoàn: khối này bỏ
                                // cộng, còn restoreCustomerCredit nhận creditUsed = 0 nên
                                // thoát ngay ở dòng
                                //   if (!customerId || (!creditUsed && !prepaidChange)) ...
                                // Khách gửi trước 60k, ghi nợ dùng 60k đó, rồi hoàn tác
                                // giao dịch ghi nợ => mất trắng 60k tiền dư.
                                //
                                // Nay hoàn ở ĐÂY, lấy creditUsed từ chính entry gốc vừa
                                // xoá (chính xác hơn trans.creditUsed vì trans có thể đã
                                // bị sửa). creditPromise vẫn nhận 0 nên không còn nguy cơ
                                // cộng hai lần.
                                var txTimeRef = new Date(trans.createdAt || trans.date).getTime();
                                var creditToRestore = (removedEntry && typeof removedEntry.creditUsed === 'number')
                                    ? removedEntry.creditUsed : 0;
                                if (creditToRestore > 0) {
                                    cust.prepaidBalance = (cust.prepaidBalance || 0) + creditToRestore;
                                    // Gỡ đúng dòng creditHistory đã trừ lúc ghi nợ
                                    if (cust.creditHistory) {
                                        for (var ch = 0; ch < cust.creditHistory.length; ch++) {
                                            if (cust.creditHistory[ch].amount === -creditToRestore &&
                                                _isNearTransTime(cust.creditHistory[ch].date, txTimeRef)) {
                                                cust.creditHistory.splice(ch, 1);
                                                break;
                                            }
                                        }
                                    }
                                }

                                // FIX: tính lại totalDebt từ lịch sử thay vì trừ dồn
                                // (field totalDebt có thể đã lệch sẵn, trừ dồn nhân bản lệch đó)
                                cust.totalDebt = Math.max(0, (cust.totalDebt || 0) - trans.amount);
                                if (typeof _calcOutstandingDebt === 'function') {
                                    cust.totalDebt = _calcOutstandingDebt(cust);
                                }
                                DB.update('customers', cust.id, {
                                    totalDebt: cust.totalDebt,
                                    debtHistory: cust.debtHistory || [],
                                    prepaidBalance: cust.prepaidBalance || 0,
                                    // creditBalance luôn bằng prepaidBalance (xem
                                    // restoreCustomerCredit). Trước đây ghi
                                    // cust.creditBalance cũ => lệch với tiền dư thật.
                                    creditBalance: cust.prepaidBalance || 0,
                                    creditHistory: cust.creditHistory || []
                                }).then(function() {
                                    if (typeof _invalidateCustomerCalcCache === 'function') {
                                        _invalidateCustomerCalcCache();
                                    }
                                    resolve();
                                }).catch(function(err) {
                                    console.error('[refund] lỗi cập nhật nợ:', err);
                                    reject(err);
                                });
                            }
                            if (c) {
                                doRestoreDebt(c);
                            } else {
                                DB.getAll('customers').then(function(allCustomers) {
                                    for (var i = 0; i < allCustomers.length; i++) {
                                        if (allCustomers[i].id === trans.customer.id) { c = allCustomers[i]; break; }
                                    }
                                    if (c) {
                                        doRestoreDebt(c);
                                    } else {
                                        resolve();
                                    }
                                }).catch(function(err) {
                                    console.error('[refund] lỗi đọc khách:', err);
                                    reject(err);
                                });
                            }
                        });
                    } else {
                        // THANH TOÁN NỢ: hoàn tác = khôi phục nợ bằng cách xóa paymentHistory entry và cộng lại totalDebt
                        // KHÔNG thêm entry mới vào debtHistory để tránh sai lệch lịch sử
                        // FIX: dùng debtSettled (nợ thực sự được xóa) thay vì trans.amount.
                        // trans.amount là tiền thực nhận (đã gồm phần dùng tiền dư và phần trả dư),
                        // dùng nó để cộng lại nợ sẽ làm nợ phình to hơn đúng số đã trừ.
                        var settled = (typeof trans.debtSettled === 'number') ? trans.debtSettled : trans.amount;
                        debtPromise = new Promise(function(resolve, reject) {
                            var c = null;
                            for (var i = 0; i < customers.length; i++) {
                                if (customers[i].id === trans.customer.id) { c = customers[i]; break; }
                            }
                            function doRestoreDebt(cust) {
                                // Tìm và xóa entry paymentHistory tương ứng (dựa trên amount và thời gian gần)
                                if (cust.paymentHistory) {
                                    var foundIdx = -1;
                                    for (var p = 0; p < cust.paymentHistory.length; p++) {
                                        var entry = cust.paymentHistory[p];
                                        if (entry.amount === settled) {
                                            var entryTime = new Date(entry.date).getTime();
                                            var txTime = new Date(trans.createdAt || trans.date).getTime();
                                            if (Math.abs(entryTime - txTime) < 120000) { // sai lệch trong 2 phút
                                                foundIdx = p;
                                                break;
                                            }
                                        }
                                    }
                                    if (foundIdx >= 0) {
                                        cust.paymentHistory.splice(foundIdx, 1);
                                    }
                                }
                                // Khôi phục: cộng lại số nợ đã được trừ
                                // FIX: tính lại từ lịch sử sau khi đã xóa entry paymentHistory
                                cust.totalDebt = (cust.totalDebt || 0) + settled;
                                if (typeof _calcOutstandingDebt === 'function') {
                                    cust.totalDebt = _calcOutstandingDebt(cust);
                                }
                                DB.update('customers', cust.id, {
                                    totalDebt: cust.totalDebt,
                                    paymentHistory: cust.paymentHistory || []
                                }).then(function() {
                                    if (typeof _invalidateCustomerCalcCache === 'function') {
                                        _invalidateCustomerCalcCache();
                                    }
                                    resolve();
                                }).catch(function(err) {
                                    console.error('[refund] lỗi cập nhật lịch sử trả nợ:', err);
                                    reject(err);
                                });
                            }
                            if (c) {
                                doRestoreDebt(c);
                            } else {
                                DB.getAll('customers').then(function(allCustomers) {
                                    for (var i = 0; i < allCustomers.length; i++) {
                                        if (allCustomers[i].id === trans.customer.id) { c = allCustomers[i]; break; }
                                    }
                                    if (c) {
                                        doRestoreDebt(c);
                                    } else {
                                        resolve();
                                    }
                                }).catch(function(err) {
                                    console.error('[refund] lỗi đọc khách:', err);
                                    reject(err);
                                });
                            }
                        });
                    }
                }
                
                // Khôi phục bàn nếu là giao dịch tại bàn (dinein), trả sau tại bàn, hoặc xóa bàn
                // KHÔNG khôi phục bàn khi thanh toán trả sau (paymentMethod === 'cash')
                var tablePromise = Promise.resolve();
                if (trans.tableId) {
                    if (trans.type === 'dinein') {
                        tablePromise = restoreTable(trans);
                    } else if (trans.type === 'debt_payment' && trans.paymentMethod === 'debt') {
                        // Trả sau tại bàn: khôi phục bàn
                        tablePromise = restoreTable(trans);
                    } else if (trans.type === 'delete_table') {
                        // NÂNG CẤP: Hoàn tác xóa bàn = khôi phục bàn
                        // Kiểm tra không trùng id: restoreTable() đã có logic kiểm tra cachedTables
                        // Nếu bàn đã tồn tại và có dữ liệu → không ghi đè
                        // Nếu bàn chưa tồn tại → tạo mới
                        tablePromise = restoreTable(trans);
                    }
                }
                
                // Khôi phục prepaidBalance và creditHistory nếu giao dịch có dùng tiền dư/trả dư
                //
                // GHI NỢ (debt_payment + paymentMethod 'debt'): truyền creditUsed = 0.
                // Nhánh debtPromise ở trên KHÔNG cộng lại prepaidBalance nữa (xem
                // comment ở đó) - nếu truyền creditUsed thật thì số tiền bị cộng 2 lần.
                var isDebtRecordTx = (trans.type === 'debt_payment' && trans.paymentMethod === 'debt');
                var creditPromise = restoreCustomerCredit(
                    trans.customer ? trans.customer.id : null,
                    isDebtRecordTx ? 0 : (trans.creditUsed || 0),
                    trans.prepaidChange || 0,
                    new Date(trans.createdAt || trans.date).getTime()
                );
                
                // Đợi xử lý trả sau + khôi phục bàn + khôi phục credit xong mới update transaction
                Promise.all([debtPromise, tablePromise, creditPromise]).then(function() {
                    // FIX TIMEZONE: KHÔNG ghi đè trans.createdAt để giữ nguyên ngày gốc của giao dịch
                    // Dùng originalCreatedAt để lưu mốc gốc (nếu chưa có) + refundedAt cho mốc hủy
                    if (!trans.originalCreatedAt) {
                        trans.originalCreatedAt = trans.createdAt || trans.date;
                    }
                    trans.refunded = true;
                    trans.refundReason = reason;
                    trans.refundedAt = Date.now();
                    
                    // PHẢI trả về promise + có .catch.
                    // Trước đây .then() không return nên DB.update lỗi bị nuốt im lặng,
                    // trong khi bàn/ngợ/tiền dư/nguyên liệu ĐÃ hoàn nguyên => lệch dữ liệu
                    // không có đường undo.
                    return DB.update('transactions', transactionId, trans).catch(function(err) {
                        console.error('[refund] lỗi cập nhật transaction:', err);
                        // Trả lại trạng thái trong RAM để không hiện "Đã hủy" giả
                        trans.refunded = false;
                        delete trans.refundReason;
                        delete trans.refundedAt;
                        // Ghi log để quản lý biết cần kiểm tra lại
                        try {
                            DB.create('refund_failures', {
                                transactionId: transactionId,
                                amount: trans.amount || 0,
                                reason: reason,
                                error: String(err && err.message ? err.message : err),
                                at: Date.now()
                            }).catch(function() {});
                        } catch (e) {}
                        throw err;
                    });
                }).then(function() {
                        showToast('✅ Đã hủy giao dịch', 'success');
                        // Gửi thông báo Telegram qua bot cảnh báo
                        if (typeof notifyTelegramWarning === 'function') {
                            var refundMsg = '❌ <b>HOÀN TÁC GIAO DỊCH</b>\n';
                            refundMsg += '────────────────\n';
                            refundMsg += '💰 Số tiền: ' + formatMoney(trans.amount) + '\n';
                            refundMsg += '📝 Lý do: ' + reason + '\n';
                            if (trans.tableName) refundMsg += '🍽️ Bàn: ' + trans.tableName + '\n';
                            if (trans.paymentMethod) refundMsg += '💳 Phương thức: ' + trans.paymentMethod;
                            notifyTelegramWarning(refundMsg);
                        }
                        // Cập nhật lại lịch sử
                        if (currentTab === 'history') {
                            renderHistoryByDate(currentHistoryDate);
                        }
                        // KHÔNG gọi renderReport: hàm này chỉ tồn tại trong
                        // report.js (KHÔNG được load trong index.html) và index.html
                        // cũng không có tab 'report'. Nếu sau này thêm tab thì
                        // ReferenceError ngay sau khi refund đã ghi xong.
                }).catch(function(err) {
                    // Bắt lỗi từ cả 3 nhánh hoàn nguyên lẫn từ DB.update.
                    // Trước đây Promise.all không có .catch và 2 promise không hề
                    // settle khi lỗi => treo vĩnh viễn, không báo gì cho người dùng.
                    console.error('[refund] Hoàn tác lỗi:', err);
                    showToast('❌ Hoàn tác lỗi: ' + (err && err.message ? err.message : 'không xác định') + ' — dữ liệu CÓ THỂ đã lệch, cần quản lý kiểm tra', 'error', 6000);
                });
            });
        });
    }
    
    if (needPassword) {
        requirePassword('hoàn tác giao dịch thanh toán', doRefund);
    } else {
        doRefund();
    }
}

// ========== KHÔI PHỤC BÀN KHI HOÀN TÁC GIAO DỊCH DINEIN ==========
function restoreTable(trans) {
    return new Promise(function(resolve, reject) {
        // Tính tổng tiền từ items (ưu tiên dùng trans.amount)
        var total = trans.amount || 0;
        if (total === 0 && trans.items && trans.items.length) {
            for (var i = 0; i < trans.items.length; i++) {
                total += (trans.items[i].price || 0) * (trans.items[i].qty || 1);
            }
        }
        
        // Lấy customerId, customerName từ transaction
        var customerId = null;
        var customerName = null;
        if (trans.customer) {
            customerId = trans.customer.id || null;
            customerName = trans.customer.name || null;
        }
        
        // Tạo dữ liệu bàn để khôi phục
        var tableData = {
            name: trans.tableName || 'Bàn',
            items: trans.items || [],
            total: total,
            startTime: trans.startTime || new Date().toISOString(),
            customerId: customerId,
            customerName: customerName,
            recentAdds: [],
            // BẮT BUỘC: cờ "đã trừ kho".
            // Bước hoàn tác đã gọi restoreIngredients() trả kho lại. Nếu bàn
            // khôi phục thiếu cờ này thì lần thanh toán sau sẽ thấy
            // alreadyDeducted = false và trừ kho LẦN THỨ HAI -> kho phình dần
            // sau mỗi vòng hoàn tác, sai vốn/giá vốn.
            ingredientsDeducted: true
        };
        
        // FIX 4: Dùng window.cachedTables thay vì DB.get('tables', ...)
        var cachedTables = window.cachedTables || [];
        var existingTable = null;
        for (var ti = 0; ti < cachedTables.length; ti++) {
            if (String(cachedTables[ti].id) === String(trans.tableId)) {
                existingTable = cachedTables[ti];
                break;
            }
        }
        
        if (existingTable && existingTable.items && existingTable.items.length > 0) {
            // Bàn đã có dữ liệu (có thể đã được dùng lại) -> không ghi đè
            resolve();
        } else {
            // Khôi phục bàn: tạo mới hoặc cập nhật
            // KHÔNG nuốt lỗi trong .catch: trước đây resolve() ở cả nhánh lỗi
            // khiến người dùng thấy "✅ Đã hủy giao dịch" dù bàn không được
            // khôi phục, món đã hoàn kho => mất đơn mà không có dấu hiệu gì.
            if (existingTable) {
                // Bàn đã tồn tại (rỗng) -> cập nhật
                DB.update('tables', String(trans.tableId), tableData).then(function() {
                    resolve();
                }).catch(function(err) {
                    console.error('[restoreTable] lỗi cập nhật bàn:', err);
                    reject(err);
                });
            } else {
                // Bàn chưa tồn tại -> tạo mới
                tableData.id = trans.tableId;
                DB.create('tables', tableData, String(trans.tableId)).then(function() {
                    resolve();
                }).catch(function(err) {
                    console.error('[restoreTable] lỗi tạo bàn:', err);
                    reject(err);
                });
            }
        }
    });
}

function changeHistoryDate(delta) {
    var nd = new Date(currentHistoryDate);
    nd.setDate(nd.getDate() + delta);
    currentHistoryDate = nd;
    renderHistoryByDate(currentHistoryDate);
}

// Nhảy đến ngày được chọn từ date picker (lịch)
function jumpHistoryDate(dateStr) {
    if (!dateStr) return;
    var parts = dateStr.split('-');
    var nd = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    currentHistoryDate = nd;
    renderHistoryByDate(currentHistoryDate);
}

// ========== THÊM GIAO DỊCH ==========
function addHistory(transaction) {
    var now = new Date();
    var dateKey = _toLocalDateStr(now);
    var newTrans = {
        // KHÔNG dùng Date.now().toString() một mình: hai giao dạch tạo trong cùng
        // 1 mili giây sẽ trùng id. DB.create() lấy data.id làm khoá và
        // saveToLocal dùng store.put => ghi đè, GIAO DỊCH MẤT IM LẶNG
        // (kể cả trên Firebase: addToSyncQueue ghi vào ref.child(id)).
        // Khối dedup ở _renderHistoryCore KHÔNG cứu được vì IndexedDB đã ghi đè
        // từ lúc ghi, getTransactionsByDate không bao giờ trả về 2 bản cùng id.
        id: Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 6),
        date: now.toISOString(),
        dateKey: dateKey,
        type: transaction.type,
        amount: transaction.amount,
        paymentMethod: transaction.paymentMethod,
        items: transaction.items || [],
        customer: transaction.customer || null,
        tableName: transaction.tableName || null,
        tableId: transaction.tableId || null, // Lưu tableId để kiểm tra khoá khi hoàn tác
        note: transaction.note || '',
        refunded: false,
        tableTime: transaction.tableTime || '', // Thời gian khách ngồi (vd: "2h15p")
        startTime: transaction.startTime || null, // Thời gian bắt đầu ngồi
        endTime: transaction.endTime || null,      // Thời gian kết thúc (thanh toán)
        creditUsed: transaction.creditUsed || 0,   // Số tiền đã dùng từ prepaidBalance khi ghi nợ/thanh toán
        prepaidChange: transaction.prepaidChange || 0 // Số tiền dư được thêm vào prepaidBalance (overpay)
    };
    // Bổ sung tên + vai trò nhân viên thực hiện (dùng cho toast giao dịch gần đây)
    var user = DB.getCurrentUser();
    if (user && user.displayName) {
        newTrans.createdByName = user.displayName;
    }
    if (user && user.role) {
        newTrans.createdByRole = user.role;
    }
    return DB.create('transactions', newTrans).then(function(result) {
        // KHÔNG gọi render trực tiếp nữa, để realtime subscription tự cập nhật
    });
}

// ========== SWIPE: TRÁI = HOÀN TÁC, PHẢI = XÓA ==========
// FIX 6: Dùng data attribute để đánh dấu item đã có listener, tránh gắn listener chồng chéo
function _initHistorySwipe() {
    // Scope vào #historyList để không gắn nhầm .history-item ở màn hình khác
    var items = document.querySelectorAll('#historyList .history-item');
    for (var i = 0; i < items.length; i++) {
        var el = items[i];
        // Nếu đã có listener thì bỏ qua
        if (el.getAttribute('data-swipe-initialized') === 'true') continue;
        el.setAttribute('data-swipe-initialized', 'true');
        
        (function(el) {
            var startX = 0, startY = 0, currentX = 0, isDragging = false, axisLocked = false;
            function reset() {
                isDragging = false;
                axisLocked = false;
                el.style.transition = 'transform 0.2s ease';
                el.classList.remove('swipe-reveal');
                el.classList.remove('swipe-left-reveal');
                el.style.transform = '';
            }
            el.addEventListener('touchstart', function(e) {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                axisLocked = false;
                isDragging = true;
            }, { passive: true });
            el.addEventListener('touchmove', function(e) {
                if (!isDragging) return;
                var t = e.touches[0];
                // Khoá trục: chỉ vào chế độ vuốt ngang khi chuyển động ngang
                // rõ ràng. Trước đây vuốt DỌC (cuộn danh sách) cũng làm item
                // dịch ngang 80px.
                if (!axisLocked) {
                    var dx0 = Math.abs(t.clientX - startX);
                    var dy0 = Math.abs(t.clientY - startY);
                    if (dx0 < 10 && dy0 < 10) return;
                    if (dy0 > dx0) { isDragging = false; return; }  // vuốt dọc -> bỏ qua
                    axisLocked = true;
                }
                currentX = t.clientX;
                var diff = startX - currentX;
                if (diff > 0) {
                    // Vuốt trái: hiện nút hoàn tác (bên phải)
                    el.style.transition = 'none';
                    el.style.transform = 'translateX(' + (-Math.min(diff, 80)) + 'px)';
                } else {
                    // Vuốt phải: hiện nút xóa (bên trái)
                    el.style.transition = 'none';
                    el.style.transform = 'translateX(' + Math.min(-diff, 80) + 'px)';
                }
            }, { passive: true });
            el.addEventListener('touchend', function(e) {
                if (!isDragging) return;
                isDragging = false;
                if (!axisLocked) { axisLocked = false; return; }
                axisLocked = false;
                el.style.transition = 'transform 0.2s ease';
                var diff = startX - currentX;
                if (diff > 50) {
                    // Vuốt trái đủ xa: hiện nút hoàn tác
                    el.classList.add('swipe-reveal');
                    el.classList.remove('swipe-left-reveal');
                    el.style.transform = '';
                } else if (diff < -50) {
                    // Vuốt phải đủ xa: hiện nút xóa
                    el.classList.add('swipe-left-reveal');
                    el.classList.remove('swipe-reveal');
                    el.style.transform = '';
                } else {
                    el.classList.remove('swipe-reveal');
                    el.classList.remove('swipe-left-reveal');
                    el.style.transform = '';
                }
            }, { passive: true });
            // Không có touchcancel thì gesture bị trình duyệt cắt sẽ để lại
            // isDragging = true và transform dạch ngang => item kẹt lệch.
            el.addEventListener('touchcancel', function() {
                reset();
            }, { passive: true });
        })(el);
    }
}

// ========== XÓA GIAO DỊCH (CHỈ ADMIN) ==========
function deleteTransaction(transactionId) {
    if (!transactionId) return;
    
    // Kiểm tra quyền admin
    var currentUser = DB.getCurrentUser();
    if (!currentUser || !isAdminUser()) {
        showToast('👑 Chỉ quản lý mới có thể xóa giao dịch', 'warning');
        return;
    }
    
    if (!confirm('🗑️ Xác nhận xóa giao dịch này?\n\nGiao dịch sẽ bị xóa vĩnh viễn khỏi lịch sử.')) return;
    
    DB.get('transactions', transactionId).then(function(trans) {
        if (!trans) {
            showToast('Giao dịch không tồn tại!', 'warning');
            return;
        }
        
        // Xóa vĩnh viễn khỏi DB
        DB.remove('transactions', transactionId).then(function() {
            showToast('✅ Đã xóa giao dịch', 'success');
            // Refresh lại danh sách
            var dateEl = document.getElementById('historyDate');
            if (dateEl) {
                // CHỈ dùng data-date. Fallback innerText là định dạng d/m/Y
                // (vd "5/10/2026") không phải dateKey YYYY-MM-DD =>
                // getTransactionsByDate trả rỗng -> list trống sau khi xoá.
                var dateStr = dateEl.getAttribute('data-date');
                if (dateStr) {
                    renderHistoryByDateStr(dateStr);
                } else {
                    renderHistoryByDate(currentHistoryDate);
                }
            }
        }).catch(function(err) {
            console.error('[deleteTransaction] Lỗi:', err);
            showToast('❌ Lỗi khi xóa giao dịch', 'error');
        });
    }).catch(function(err) {
        console.error('[deleteTransaction] Lỗi đọc giao dịch:', err);
        showToast('❌ Lỗi khi tải giao dịch', 'error');
    });
}

// FIX 8: Export global cho tất cả hàm cần thiết
window.refundTransaction = refundTransaction;
window.deleteTransaction = deleteTransaction;
window.changeHistoryDate = changeHistoryDate;
window.showTransactionDetail = showTransactionDetail;
window.printTransactionDetail = printTransactionDetail;
window.renderHistoryByDateStr = renderHistoryByDateStr;
window.renderHistoryByDate = renderHistoryByDate;
window.exportTransactionPDF = exportTransactionPDF;
