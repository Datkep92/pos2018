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
    var lockStartHour = (window.shopConfig && window.shopConfig.lockStartHour !== undefined) ? window.shopConfig.lockStartHour : 17;
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
var _historyViewMode = 1; // 1: 1 hàng, 2: 2 hàng (dinein / takeaway+grab), 3: 2 hàng (cash / transfer+grab)

// Helper: format Date object thành YYYY-MM-DD theo giờ địa phương (không dùng UTC)
function _toLocalDateStr(dateObj) {
    var y = dateObj.getFullYear();
    var m = ('0' + (dateObj.getMonth() + 1)).slice(-2);
    var d = ('0' + dateObj.getDate()).slice(-2);
    return y + '-' + m + '-' + d;
}

function setHistoryView(mode) {
    _historyViewMode = mode;
    var btns = document.querySelectorAll('#historyViewToggle .hvt-btn');
    for (var i = 0; i < btns.length; i++) {
        btns[i].className = 'hvt-btn' + (parseInt(btns[i].getAttribute('data-view')) === mode ? ' active' : '');
    }
    // Re-render với ngày hiện tại
    var dateStr = document.getElementById('historyDate').innerText;
    if (dateStr && dateStr !== '--/--/----') {
        // Parse lại date từ display (dd/mm/yyyy) -> tạo dateStr YYYY-MM-DD trực tiếp, không qua Date object
        var parts = dateStr.split('/');
        if (parts.length === 3) {
            var y = parseInt(parts[2], 10);
            var m = ('0' + parseInt(parts[1], 10)).slice(-2);
            var d = ('0' + parseInt(parts[0], 10)).slice(-2);
            // Gọi render với dateStr YYYY-MM-DD thay vì Date object để tránh lỗi timezone
            renderHistoryByDateStr(y + '-' + m + '-' + d);
        }
    }
}

function _renderTxItem(tx) {
    var isRefunded = tx.refunded === true;
    var txDate = new Date(tx.createdAt || tx.date);
    var time = txDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    var location = '';
    var tableTimeBadge = '';
    if (tx.tableName) {
        var displayLabel = (tx.customer && tx.customer.name) ? tx.customer.name : tx.tableName;
        location = '🪑 ' + escapeHtml(displayLabel);
        if (tx.tableTime) {
            tableTimeBadge = '<span class="history-table-time">⏱ ' + escapeHtml(tx.tableTime) + '</span>';
        }
    } else if (tx.type === 'takeaway') location = '🛵 Mang đi';
    else if (tx.type === 'grab') location = '🚕 Grab';
    else location = '🍽️ Tại chỗ';

    var isDebtRecord = (tx.type === 'debt_payment' && tx.paymentMethod === 'debt');
    var isDebtPayment = (tx.type === 'debt_payment' && tx.paymentMethod === 'cash');
    var isCredit = (tx.type === 'credit');

    var method = '';
    var methodClass = '';
    if (isRefunded) {
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
    if (tx.items && tx.items.length) {
        for (var j = 0; j < tx.items.length; j++) {
            itemCount += tx.items[j].qty;
        }
    }

    var itemClass = 'history-item';
    if (isRefunded) itemClass += ' refunded';
    else if (isCredit) itemClass += ' credit-item';
    else if (isDebtRecord) itemClass += ' debt-record';
    else if (isDebtPayment) itemClass += ' debt-payment';

    var amountSign = isRefunded ? '-' : (isDebtRecord ? '📝' : (isCredit ? '+' : '+'));
    var amountClass = 'history-amount';
    if (isRefunded) amountClass += ' refunded-amount';
    else if (isCredit) amountClass += ' credit-amount';
    else if (isDebtRecord) amountClass += ' debt-record-amount';
    else if (isDebtPayment) amountClass += ' debt-payment-amount';

    // Vuốt trái để hoàn tác (swipe-to-refund)
    var swipeHtml = isRefunded ? '' :
        '<div class="history-swipe-actions"><button class="swipe-refund-btn" onclick="event.stopPropagation(); refundTransaction(\'' + tx.id + '\')">↩️ Hoàn tác</button></div>';

    return '<div class="' + itemClass + '" onclick="showTransactionDetail(\'' + tx.id + '\')">' +
        '<div class="history-line1">' +
            '<span class="history-time">' + time + '</span>' +
            '<span class="history-location">' + location + '</span>' +
            tableTimeBadge +
            '<span class="history-item-count">📦 ' + itemCount + ' món</span>' +
            '<span class="history-method ' + methodClass + '">' + method + '</span>' +
            customerHtml +
            '<span class="' + amountClass + ' history-amount-inline">' +
                amountSign + ' ' + formatMoney(tx.amount) +
            '</span>' +
        '</div>' +
        swipeHtml +
    '</div>';
}

function renderHistoryByDate(dateObj) {
    // Fix timezone: dùng getFullYear/getMonth/getDate thay vì toISOString()
    var dateStr = _toLocalDateStr(dateObj);
    document.getElementById('historyDate').innerText = formatDateDisplay(dateStr);
    
    var filter = document.getElementById('historyFilter').value;
    
    DB.getTransactionsByDate(dateStr).then(function(transactions) {
        if (filter !== 'all') {
            transactions = transactions.filter(function(t) {
                if (filter === 'dinein') return t.type === 'dinein';
                if (filter === 'takeaway') return t.type === 'takeaway';
                if (filter === 'grab') return t.type === 'grab';
                if (filter === 'cash') return t.paymentMethod === 'cash';
                if (filter === 'transfer') return t.paymentMethod === 'transfer';
                if (filter === 'debt_payment') return t.type === 'debt_payment';
                if (filter === 'cancelled') return t.refunded === true;
                if (filter === 'credit') return t.type === 'credit';
                return true;
            });
        }

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

        var mode = _historyViewMode || 1;
        container.className = 'history-list view-' + mode;

        if (mode === 1) {
            // Chế độ 1: 1 hàng dọc
            var html = '';
            for (var i = 0; i < transactions.length; i++) {
                html += _renderTxItem(transactions[i]);
            }
            container.innerHTML = html;
        } else if (mode === 2) {
            // Chế độ 2: 2 cột - dinein / takeaway+grab
            var dinein = [];
            var other = [];
            for (var i = 0; i < transactions.length; i++) {
                var tx = transactions[i];
                if (tx.type === 'dinein') dinein.push(tx);
                else other.push(tx);
            }
            var html1 = '', html2 = '';
            for (var i = 0; i < dinein.length; i++) html1 += _renderTxItem(dinein[i]);
            for (var i = 0; i < other.length; i++) html2 += _renderTxItem(other[i]);
            container.innerHTML =
                '<div class="history-column"><div class="history-column-title">🍽️ Tại bàn</div>' + (html1 || '<div class="empty-state" style="padding:12px;">Không có</div>') + '</div>' +
                '<div class="history-column"><div class="history-column-title">🛵🚕 Mang đi / Grab</div>' + (html2 || '<div class="empty-state" style="padding:12px;">Không có</div>') + '</div>';
        } else if (mode === 3) {
            // Chế độ 3: 2 cột - cash / transfer+grab
            var cash = [];
            var otherPay = [];
            for (var i = 0; i < transactions.length; i++) {
                var tx = transactions[i];
                if (tx.paymentMethod === 'cash') cash.push(tx);
                else otherPay.push(tx);
            }
            var html1 = '', html2 = '';
            for (var i = 0; i < cash.length; i++) html1 += _renderTxItem(cash[i]);
            for (var i = 0; i < otherPay.length; i++) html2 += _renderTxItem(otherPay[i]);
            container.innerHTML =
                '<div class="history-column"><div class="history-column-title">💰 Tiền mặt</div>' + (html1 || '<div class="empty-state" style="padding:12px;">Không có</div>') + '</div>' +
                '<div class="history-column"><div class="history-column-title">💳🚕 CK / Grab</div>' + (html2 || '<div class="empty-state" style="padding:12px;">Không có</div>') + '</div>';
        }
        _initHistorySwipe();
    });
}

// renderHistoryByDateStr - render với dateStr YYYY-MM-DD có sẵn (tránh lỗi timezone)
function renderHistoryByDateStr(dateStr) {
    document.getElementById('historyDate').innerText = formatDateDisplay(dateStr);
    
    var filter = document.getElementById('historyFilter').value;
    
    DB.getTransactionsByDate(dateStr).then(function(transactions) {
        if (filter !== 'all') {
            transactions = transactions.filter(function(t) {
                if (filter === 'dinein') return t.type === 'dinein';
                if (filter === 'takeaway') return t.type === 'takeaway';
                if (filter === 'grab') return t.type === 'grab';
                if (filter === 'cash') return t.paymentMethod === 'cash';
                if (filter === 'transfer') return t.paymentMethod === 'transfer';
                if (filter === 'debt_payment') return t.type === 'debt_payment';
                if (filter === 'cancelled') return t.refunded === true;
                if (filter === 'credit') return t.type === 'credit';
                return true;
            });
        }

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

        var mode = _historyViewMode || 1;
        container.className = 'history-list view-' + mode;

        if (mode === 1) {
            // Chế độ 1: 1 hàng dọc
            var html = '';
            for (var i = 0; i < transactions.length; i++) {
                html += _renderTxItem(transactions[i]);
            }
            container.innerHTML = html;
        } else if (mode === 2) {
            // Chế độ 2: 2 cột - dinein / takeaway+grab
            var dinein = [];
            var other = [];
            for (var i = 0; i < transactions.length; i++) {
                var tx = transactions[i];
                if (tx.type === 'dinein') dinein.push(tx);
                else other.push(tx);
            }
            var html1 = '', html2 = '';
            for (var i = 0; i < dinein.length; i++) html1 += _renderTxItem(dinein[i]);
            for (var i = 0; i < other.length; i++) html2 += _renderTxItem(other[i]);
            container.innerHTML =
                '<div class="history-column"><div class="history-column-title">🍽️ Tại bàn</div>' + (html1 || '<div class="empty-state" style="padding:12px;">Không có</div>') + '</div>' +
                '<div class="history-column"><div class="history-column-title">🛵🚕 Mang đi / Grab</div>' + (html2 || '<div class="empty-state" style="padding:12px;">Không có</div>') + '</div>';
        } else if (mode === 3) {
            // Chế độ 3: 2 cột - cash / transfer+grab
            var cash = [];
            var otherPay = [];
            for (var i = 0; i < transactions.length; i++) {
                var tx = transactions[i];
                if (tx.paymentMethod === 'cash') cash.push(tx);
                else otherPay.push(tx);
            }
            var html1 = '', html2 = '';
            for (var i = 0; i < cash.length; i++) html1 += _renderTxItem(cash[i]);
            for (var i = 0; i < otherPay.length; i++) html2 += _renderTxItem(otherPay[i]);
            container.innerHTML =
                '<div class="history-column"><div class="history-column-title">💰 Tiền mặt</div>' + (html1 || '<div class="empty-state" style="padding:12px;">Không có</div>') + '</div>' +
                '<div class="history-column"><div class="history-column-title">💳🚕 CK / Grab</div>' + (html2 || '<div class="empty-state" style="padding:12px;">Không có</div>') + '</div>';
        }
        _initHistorySwipe();
    });
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
        
        // Phân biệt Ghi nợ (mua chịu) vs Thanh toán nợ (trả tiền)
        var isDebtRecord = (tx.type === 'debt_payment' && tx.paymentMethod === 'debt');
        var isDebtPayment = (tx.type === 'debt_payment' && tx.paymentMethod === 'cash');
        var isCredit = (tx.type === 'credit');
        
        var typeName = '';
        if (tx.type === 'dinein') typeName = 'Tại chỗ';
        else if (tx.type === 'takeaway') typeName = 'Mang đi';
        else if (tx.type === 'grab') typeName = 'Grab';
        else if (isCredit) typeName = '💰 Tiền dư (trả trước)';
        else if (isDebtRecord) typeName = '📝 Ghi nợ (mua chịu)';
        else if (isDebtPayment) typeName = '💵 Thanh toán nợ (trả tiền)';
        
        var paymentMethodText = '';
        if (tx.paymentMethod === 'cash') paymentMethodText = '💰 Tiền mặt';
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
            var infoHtml =
                timeHtml +
                '<div class="detail-row"><span>🍽️ Loại:</span><span>' + typeName + '</span></div>' +
                '<div class="detail-row"><span>💳 Thanh toán:</span><span>' + paymentMethodText + '</span></div>' +
                (tx.tableName ? '<div class="detail-row"><span>🪑 Bàn:</span><span>' + escapeHtml(tx.customer && tx.customer.name ? tx.customer.name : tx.tableName) + '</span></div>' : '') +
                tableTimeHtml +
                '<div class="detail-row"><span>💰 Tổng tiền:</span><span class="detail-amount">' + formatMoney(tx.amount) + '</span></div>' +
                (tx.note ? '<div class="detail-row"><span>📝 Ghi chú:</span><span>' + escapeHtml(tx.note) + '</span></div>' : '') +
                refundInfo;
            
            var html =
                '<div class="detail-section">' + infoHtml + '</div>' +
                '<div class="detail-section">' + itemsHtml + '</div>' +
                '<div class="form-actions" style="margin-top:12px;">' +
                    '<button class="btn-save" onclick="printTransactionDetail(\'' + transactionId + '\')">🖨️ In hóa đơn</button>' +
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
                // Fallback: lấy từ table (cho các giao dịch cũ chưa có startTime/endTime)
                DB.get('tables', String(tx.tableId)).then(function(table) {
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
                });
            } else {
                renderDetail('');
            }
        } else {
            renderDetail('');
        }
    });
}

function printTransactionDetail(transactionId) {
    DB.get('transactions', transactionId).then(function(tx) {
        if (!tx) return;
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
                        var confirmBtn = document.getElementById('refundReasonOtherConfirm');
                        if (!confirmBtn) {
                            confirmBtn = document.createElement('button');
                            confirmBtn.id = 'refundReasonOtherConfirm';
                            confirmBtn.className = 'btn-save';
                            confirmBtn.innerText = 'Xác nhận';
                            confirmBtn.style.marginTop = '8px';
                            otherDiv.appendChild(confirmBtn);
                        }
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

function proceedRefund(trans, needPassword) {
    var transactionId = trans.id;
    function doRefund() {
        showRefundReasonModal(function(reason) {
            if (!reason) return;
            restoreIngredients(trans.items).then(function() {
                // Xử lý hoàn tác nợ: trả về Promise để đợi hoàn thành trước khi update transaction
                var debtPromise = Promise.resolve();
                
                if (trans.type === 'debt_payment' && trans.customer) {
                    if (trans.paymentMethod === 'debt') {
                        // GHI NỢ: hoàn tác = trừ nợ (vì lúc ghi nợ đã cộng nợ)
                        debtPromise = new Promise(function(resolve) {
                            var c = null;
                            for (var i = 0; i < customers.length; i++) {
                                if (customers[i].id === trans.customer.id) { c = customers[i]; break; }
                            }
                            if (c) {
                                c.totalDebt = Math.max(0, (c.totalDebt || 0) - trans.amount);
                                c.debtHistory = c.debtHistory || [];
                                c.debtHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: -trans.amount, note: 'Hoàn tác ghi nợ - ' + reason, status: 'cancelled' });
                                DB.update('customers', c.id, { totalDebt: c.totalDebt, debtHistory: c.debtHistory }).then(function() {
                                    return DB.getAll('customers').then(function(newCusts) {
                                        customers = newCusts;
                                        resolve();
                                    });
                                });
                            } else {
                                resolve();
                            }
                        });
                    } else {
                        // THANH TOÁN NỢ: hoàn tác = cộng lại nợ (vì lúc thanh toán đã trừ nợ)
                        debtPromise = addCustomerDebt(trans.customer.id, trans.amount, 'Hoàn tiền - ' + reason);
                    }
                }
                
                // Khôi phục bàn nếu là giao dịch dinein
                var tablePromise = Promise.resolve();
                if (trans.type === 'dinein' && trans.tableId) {
                    tablePromise = restoreTable(trans);
                }
                
                // Đợi xử lý nợ + khôi phục bàn xong mới update transaction
                Promise.all([debtPromise, tablePromise]).then(function() {
                    // YÊU CẦU 2: Lưu thời gian gốc trước khi cập nhật createdAt
                    if (!trans.originalCreatedAt) {
                        trans.originalCreatedAt = trans.createdAt;
                    }
                    trans.createdAt = new Date().toISOString(); // Cập nhật để nổi lên đầu sort
                    trans.refunded = true;
                    trans.refundReason = reason;
                    trans.refundedAt = Date.now();
                    
                    DB.update('transactions', transactionId, trans).then(function() {
                        showToast('✅ Đã hủy giao dịch', 'success');
                        // Gửi thông báo Telegram
                        if (typeof notifyTelegramRefund === 'function') {
                            notifyTelegramRefund(trans, reason, needPassword);
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
        
        // Kiểm tra xem bàn đã tồn tại chưa (tránh ghi đè nếu bàn đã được tạo lại)
        DB.get('tables', String(trans.tableId)).then(function(existingTable) {
            if (existingTable && existingTable.items && existingTable.items.length > 0) {
                // Bàn đã có dữ liệu (có thể đã được dùng lại) -> không ghi đè
                console.warn('Table ' + trans.tableId + ' already has data, skipping restore');
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
        }).catch(function() {
            // Nếu lỗi khi get, thử tạo mới
            tableData.id = trans.tableId;
            DB.create('tables', tableData, String(trans.tableId)).then(function() {
                resolve();
            }).catch(function() {
                resolve();
            });
        });
    });
}

function changeHistoryDate(delta) {
    var nd = new Date(currentHistoryDate);
    nd.setDate(nd.getDate() + delta);
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
        endTime: transaction.endTime || null      // Thời gian kết thúc (thanh toán)
    };
    return DB.create('transactions', newTrans).then(function(result) {
        // KHÔNG gọi render trực tiếp nữa, để realtime subscription tự cập nhật
    });
}

// ========== SWIPE TO REFUND ==========
function _initHistorySwipe() {
    var items = document.querySelectorAll('.history-item');
    for (var i = 0; i < items.length; i++) {
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
                    el.style.transition = 'none';
                    el.style.transform = 'translateX(' + (-Math.min(diff, 80)) + 'px)';
                }
            }, { passive: true });
            el.addEventListener('touchend', function(e) {
                if (!isDragging) return;
                isDragging = false;
                el.style.transition = 'transform 0.2s ease';
                var diff = startX - currentX;
                if (diff > 50) {
                    el.classList.add('swipe-reveal');
                    el.style.transform = '';
                } else {
                    el.classList.remove('swipe-reveal');
                    el.style.transform = '';
                }
            }, { passive: true });
        })(items[i]);
    }
}

// Export global
window.refundTransaction = refundTransaction;