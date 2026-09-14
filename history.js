// history.js - Lịch sử giao dịch
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== KIỂM TRA KHÓA GIAO DỊCH ==========
// Kiểm tra xem giao dịch có bị khóa hoàn tác không, dựa trên thời điểm thanh toán (createdAt)
function isTransactionLocked(trans) {
    if (!trans) return false;
    
    // Lấy thời gian thanh toán từ createdAt
    var payTime = new Date(trans.createdAt || trans.date);
    var hourVN = (payTime.getUTCHours() + 7) % 24;
    var minVN = payTime.getUTCMinutes();
    
    // Đọc cấu hình lock từ shopConfig (giống tables.js)
    var lockStartHour = (window.shopConfig && window.shopConfig.lockStartHour !== undefined) ? window.shopConfig.lockStartHour : 22;
    var lockEndHour = (window.shopConfig && window.shopConfig.lockEndHour !== undefined) ? window.shopConfig.lockEndHour : 5;
    var lockEndMinute = (window.shopConfig && window.shopConfig.lockEndMinute !== undefined) ? window.shopConfig.lockEndMinute : 30;
    var lockHours = (window.shopConfig && window.shopConfig.tableLockHours !== undefined) ? window.shopConfig.tableLockHours : 5;
    
    // Điều kiện 1: Thanh toán trong khung giờ khóa cố định (vd: 22h-5h30)
    // lockStartHour:00 - 23h59
    if (hourVN >= lockStartHour) return true;
    // 00h00 - lockEndHour:lockEndMinute
    if (hourVN < lockEndHour || (hourVN === lockEndHour && minVN < lockEndMinute)) return true;
    
    // Điều kiện 2: Nếu là bàn (dinein), kiểm tra thời gian ngồi quá giới hạn
    if (trans.type === 'dinein' && trans.tableId) {
        // Dùng tableTime nếu có (vd: "2h15p", "5h30p")
        if (trans.tableTime) {
            var match = trans.tableTime.match(/(\d+)h(\d*)p?/);
            if (match) {
                var hours = parseInt(match[1], 10);
                var mins = parseInt(match[2] || '0', 10);
                if (hours > lockHours || (hours === lockHours && mins > 0)) return true;
            }
        }
        // Fallback: dùng originalCreatedAt (thời gian gốc) nếu có
        if (trans.originalCreatedAt) {
            var startTime = new Date(trans.originalCreatedAt);
            var elapsed = payTime.getTime() - startTime.getTime();
            if (elapsed >= lockHours * 60 * 60 * 1000) return true;
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
    // FIX: Format giờ 12h với AM/PM thay vì 24h
    var hours = txDate.getHours();
    var minutes = txDate.getMinutes();
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
            var todayStr = '';
            try {
                var now = new Date();
                var y = now.getFullYear();
                var m = ('0' + (now.getMonth() + 1)).slice(-2);
                var d = ('0' + now.getDate()).slice(-2);
                todayStr = y + '-' + m + '-' + d;
            } catch(e) { todayStr = ''; }
            if (viewingDate && viewingDate !== todayStr) canRefund = false;
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
            // Kiểm tra số tiền: nếu keyword là số, so sánh với amount
            var amountNum = parseInt(keyword.replace(/[^0-9]/g, ''), 10);
            if (amountNum > 0) {
                // Tìm số tiền trong item (format: + 50,000 hoặc - 20,000)
                var amountMatch = itemText.match(/[\+\-]\s*([\d,]+)/);
                if (amountMatch) {
                    var itemAmount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
                    if (itemAmount === amountNum) {
                        match = true;
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

// FIX: Gộp renderHistoryByDate và renderHistoryByDateStr thành 1 hàm core duy nhất
// để tránh duplicate code ~160 dòng
function _renderHistoryCore(dateStr) {
    var dateEl = document.getElementById('historyDate');
    if (!dateEl) {
        console.warn('⚠️ _renderHistoryCore: #historyDate not found in DOM');
        return;
    }
    dateEl.innerText = formatDateDisplay(dateStr);
    dateEl.setAttribute('data-date', dateStr);
    
    // FIX: Đọc filter từ .filter-chip.active (cả trong #historyFilterChips và #historyStaffChips)
    // HTML dùng filter-chip buttons, không có <select>
    var activeChip = document.querySelector('#historyFilterChips .filter-chip.active, #historyStaffChips .filter-chip.active');
    var filter = activeChip ? activeChip.getAttribute('data-filter') : 'all';
    
    DB.getTransactionsByDate(dateStr).then(function(transactions) {
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
            chip.className = 'filter-chip staff-chip';
            chip.setAttribute('data-filter', 'staff:' + staffNames[i]);
            chip.textContent = '👤'; // chỉ icon
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
            container.innerHTML = '<div class="empty-state">📭 Không có giao dịch nào trong ngày</div>';
            container.className = 'history-list';
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
            // Nếu filter = 'all', bỏ qua giao dịch debt (vì đã có bộ lọc riêng)
            if (!isDebtFilter && tx.type === 'debt_payment' && tx.paymentMethod === 'debt') continue;
            totalCount++;
            totalAmount += tx.amount || 0;
        }
        // Phân quyền: admin thấy tổng tiền, staff chỉ thấy số lượng
        var currentUser = DB.getCurrentUser();
        var isAdmin = currentUser && isAdminUser();
        var summaryHtml = '';
        if (isAdmin) {
            summaryHtml = '<div class="history-summary">📊 Tổng: <strong>' + totalCount + ' giao dịch</strong> - <strong>' + formatMoney(totalAmount) + '</strong></div>';
        } else {
            summaryHtml = '<div class="history-summary">📊 Tổng: <strong>' + totalCount + ' giao dịch</strong></div>';
        }

        // Luôn hiển thị 1 hàng dọc
        var html = summaryHtml;
        for (var i = 0; i < transactions.length; i++) {
            html += _renderTxItem(transactions[i], i);
        }
        container.innerHTML = html;
        _initHistorySwipe();
    }).catch(function(err) {
        console.error('❌ _renderHistoryCore error:', err);
        var container = document.getElementById('historyList');
        if (container) {
            container.innerHTML = '<div class="empty-state">⚠️ Lỗi tải dữ liệu: ' + (err.message || 'unknown') + '</div>';
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
        else if (isDebtRecord) typeName = '📝 Ghi nợ (mua chịu)';
        else if (isDebtPayment) typeName = '💵 Thanh toán nợ (trả tiền)';
        
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
            renderDetail('');
        }
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
        if (!trans || trans.refunded) return;
        
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
function restoreCustomerCredit(customerId, creditUsed, prepaidChange) {
    return new Promise(function(resolve) {
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
                // Xóa creditHistory entry tương ứng (entry có amount = -creditUsed)
                if (cust.creditHistory) {
                    for (var k = 0; k < cust.creditHistory.length; k++) {
                        if (cust.creditHistory[k].amount === -creditUsed) {
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
                // Xóa creditHistory entry tương ứng (entry có amount = prepaidChange)
                if (cust.creditHistory) {
                    for (var k = 0; k < cust.creditHistory.length; k++) {
                        if (cust.creditHistory[k].amount === prepaidChange) {
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
                DB.update('customers', cust.id, updateData).then(function() { resolve(); });
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
            });
        }
    });
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
            ingPromise.then(function() {
                // Xử lý hoàn tác trả sau: trả về Promise để đợi hoàn thành trước khi update transaction
                var debtPromise = Promise.resolve();
                
                if (trans.type === 'debt_payment' && trans.customer) {
                    if (trans.paymentMethod === 'debt') {
                        // GHI NỢ: hoàn tác = xóa entry debtHistory gốc và trừ totalDebt
                        // KHÔNG thêm entry mới để tránh sai lệch lịch sử trả sau
                        debtPromise = new Promise(function(resolve) {
                            var c = null;
                            for (var i = 0; i < customers.length; i++) {
                                if (customers[i].id === trans.customer.id) { c = customers[i]; break; }
                            }
                            function doRestoreDebt(cust) {
                                // Tìm và xóa entry debtHistory gốc tương ứng với giao dịch trả sau này
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
                                        cust.debtHistory.splice(foundIdx, 1);
                                    }
                                }
                                // Trừ totalDebt (vì đã xóa entry nợ gốc)
                                cust.totalDebt = Math.max(0, (cust.totalDebt || 0) - trans.amount);
                                DB.update('customers', cust.id, {
                                    totalDebt: cust.totalDebt,
                                    debtHistory: cust.debtHistory || []
                                }).then(function() {
                                    resolve();
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
                                });
                            }
                        });
                    } else {
                        // THANH TOÁN NỢ: hoàn tác = khôi phục nợ bằng cách xóa paymentHistory entry và cộng lại totalDebt
                        // KHÔNG thêm entry mới vào debtHistory để tránh sai lệch lịch sử
                        debtPromise = new Promise(function(resolve) {
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
                                        if (entry.amount === trans.amount) {
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
                                // Khôi phục: cộng lại số tiền đã thanh toán
                                cust.totalDebt = (cust.totalDebt || 0) + trans.amount;
                                DB.update('customers', cust.id, {
                                    totalDebt: cust.totalDebt,
                                    paymentHistory: cust.paymentHistory || []
                                }).then(function() {
                                    resolve();
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
                var creditPromise = restoreCustomerCredit(
                    trans.customer ? trans.customer.id : null,
                    trans.creditUsed || 0,
                    trans.prepaidChange || 0
                );
                
                // Đợi xử lý trả sau + khôi phục bàn + khôi phục credit xong mới update transaction
                Promise.all([debtPromise, tablePromise, creditPromise]).then(function() {
                    // FIX TIMEZONE: KHÔNG ghi đè trans.createdAt để giữ nguyên ngày gốc của giao dịch
                    // Thay vào đó, dùng refundedAt để sort nếu cần
                    trans.refunded = true;
                    trans.refundReason = reason;
                    trans.refundedAt = Date.now();
                    
                    DB.update('transactions', transactionId, trans).then(function() {
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
                        // Cập nhật lại lịch sử và báo cáo
                        if (currentTab === 'history') {
                            renderHistoryByDate(currentHistoryDate);
                        }
                        if (currentTab === 'report') {
                            renderReport(currentReportDate);
                        }
                    });
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
    return new Promise(function(resolve) {
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
            recentAdds: []
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
            if (existingTable) {
                // Bàn đã tồn tại (rỗng) -> cập nhật
                DB.update('tables', String(trans.tableId), tableData).then(function() {
                    resolve();
                }).catch(function() {
                    resolve();
                });
            } else {
                // Bàn chưa tồn tại -> tạo mới
                tableData.id = trans.tableId;
                DB.create('tables', tableData, String(trans.tableId)).then(function() {
                    resolve();
                }).catch(function() {
                    resolve();
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
        id: Date.now().toString(),
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
    // Bổ sung tên nhân viên thực hiện
    var user = DB.getCurrentUser();
    if (user && user.displayName) {
        newTrans.createdByName = user.displayName;
    }
    return DB.create('transactions', newTrans).then(function(result) {
        // KHÔNG gọi render trực tiếp nữa, để realtime subscription tự cập nhật
    });
}

// ========== SWIPE: TRÁI = HOÀN TÁC, PHẢI = XÓA ==========
// FIX 6: Dùng data attribute để đánh dấu item đã có listener, tránh gắn listener chồng chéo
function _initHistorySwipe() {
    var items = document.querySelectorAll('.history-item');
    for (var i = 0; i < items.length; i++) {
        var el = items[i];
        // Nếu đã có listener thì bỏ qua
        if (el.getAttribute('data-swipe-initialized') === 'true') continue;
        el.setAttribute('data-swipe-initialized', 'true');
        
        (function(el) {
            var startX = 0, currentX = 0, isDragging = false;
            el.addEventListener('touchstart', function(e) {
                startX = e.touches[0].clientX;
                isDragging = true;
            }, { passive: true });
            el.addEventListener('touchmove', function(e) {
                if (!isDragging) return;
                currentX = e.touches[0].clientX;
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
                var dateStr = dateEl.getAttribute('data-date') || dateEl.innerText;
                renderHistoryByDateStr(dateStr);
            }
        }).catch(function(err) {
            console.error('[deleteTransaction] Lỗi:', err);
            showToast('❌ Lỗi khi xóa giao dịch', 'error');
        });
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
