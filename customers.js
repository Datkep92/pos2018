// customers.js - Khách hàng, công nợ (trả sau), chọn khách
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12
// OPTIMIZE: Dùng memory cache (customers array) thay vì query DB mỗi lần

// Helper: lấy thời gian (timestamp) giao dịch gần nhất của khách từ debtHistory, paymentHistory, creditHistory
// Trả về 0 nếu không có giao dịch nào
function _getLatestActivityTime(c) {
    var latest = 0;
    if (c.debtHistory && c.debtHistory.length > 0) {
        for (var i = 0; i < c.debtHistory.length; i++) {
            var t = new Date(c.debtHistory[i].date).getTime();
            if (t > latest) latest = t;
        }
    }
    if (c.paymentHistory && c.paymentHistory.length > 0) {
        for (var i = 0; i < c.paymentHistory.length; i++) {
            var t = new Date(c.paymentHistory[i].date).getTime();
            if (t > latest) latest = t;
        }
    }
    if (c.creditHistory && c.creditHistory.length > 0) {
        for (var i = 0; i < c.creditHistory.length; i++) {
            var t = new Date(c.creditHistory[i].date).getTime();
            if (t > latest) latest = t;
        }
    }
    // FIX: Cũng kiểm tra từ transactions collection cho các type mới
    var allTransactions = window.costTransactions || [];
    for (var i = 0; i < allTransactions.length; i++) {
        var tx = allTransactions[i];
        if (tx.customer && tx.customer.id === c.id) {
            if (tx.type === 'prepaid' || tx.type === 'change_in' || tx.type === 'change_use') {
                var t = new Date(tx.createdAt || tx.date).getTime();
                if (t > latest) latest = t;
            }
        }
    }
    return latest;
}

// Helper: loại bỏ dấu tiếng Việt, khoảng trắng, ký tự đặc biệt để tìm kiếm
function _removeAccents(str) {
    if (!str) return '';
    var s = str.toLowerCase();
    // Xử lý đ/Đ trước
    s = s.replace(/đ/g, 'd');
    var accents = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹ';
    var noAccents = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiioooooooooooooooooouuuuuuuuuuuyyyy';
    for (var i = 0; i < accents.length; i++) {
        s = s.replace(new RegExp(accents.charAt(i), 'g'), noAccents.charAt(i));
    }
    s = s.replace(/\s+/g, ''); // loại bỏ khoảng trắng
    s = s.replace(/[^a-z0-9]/g, ''); // chỉ giữ chữ và số
    return s;
}

// ========== KHÁCH HÀNG ==========
// FIX: Guard chống render liên tiếp trong thời gian ngắn
var _customerRenderGuard = 0;
function renderCustomerList() {
    // FIX: Nếu đang trong quá trình render (gọi liên tiếp < 50ms), bỏ qua
    var now = Date.now();
    if (_customerRenderGuard > 0 && (now - _customerRenderGuard) < 50) {
        return;
    }
    _customerRenderGuard = now;
    // Dùng memory cache, không query DB
    var keywordRaw = document.getElementById('customerSearchInput') ? document.getElementById('customerSearchInput').value : '';
    var keyword = _removeAccents(keywordRaw);
    var filtered = keyword ? customers.filter(function(c) { return _removeAccents(c.name).indexOf(keyword) !== -1 || (c.phone && _removeAccents(c.phone).indexOf(keyword) !== -1); }) : customers;
    // Tính tổng công nợ thực tế = outstandingDebt (không trừ prepaid/change vì là tiền riêng)
    var totalDebt = 0;
    for (var i = 0; i < filtered.length; i++) {
        var c = filtered[i];
        var totalFromHistory = 0;
        if (c.debtHistory) {
            for (var hi = 0; hi < c.debtHistory.length; hi++) {
                totalFromHistory += c.debtHistory[hi].amount || 0;
            }
        }
        var totalPayment = 0;
        if (c.paymentHistory) {
            for (var pi = 0; pi < c.paymentHistory.length; pi++) {
                totalPayment += c.paymentHistory[pi].amount || 0;
            }
        }
        var outstandingDebt = Math.max(0, totalFromHistory - totalPayment);
        if (outstandingDebt > 0) totalDebt += outstandingDebt;
    }
    document.getElementById('totalDebtAmount').innerText = formatMoney(totalDebt);
    var container = document.getElementById('customerList');
    if (!container) return;
    if (!filtered.length) { container.innerHTML = '<div class="empty-state">📭 Không có khách hàng</div>'; return; }
    
    // Helper lấy ngày hôm nay theo giờ địa phương YYYY-MM-DD
    var todayStr = '';
    try {
        var now = new Date();
        var y = now.getFullYear();
        var m = ('0' + (now.getMonth() + 1)).slice(-2);
        var d = ('0' + now.getDate()).slice(-2);
        todayStr = y + '-' + m + '-' + d;
    } catch(e) { todayStr = ''; }
    
    // Helper kiểm tra entry có phải hôm nay không (xử lý timezone UTC -> local)
    function _isTodayEntry(entry) {
        if (!entry) return false;
        // Nếu entry có dateKey (local date) thì dùng dateKey
        if (entry.dateKey) return entry.dateKey === todayStr;
        // Nếu không, chuyển ISO string sang local time rồi so sánh
        try {
            var dateStr = typeof entry === 'string' ? entry : entry.date;
            if (!dateStr) return false;
            var d = new Date(dateStr);
            if (isNaN(d.getTime())) return false;
            var y = d.getFullYear();
            var m = ('0' + (d.getMonth() + 1)).slice(-2);
            var day = ('0' + d.getDate()).slice(-2);
            return (y + '-' + m + '-' + day) === todayStr;
        } catch(e) { return false; }
    }
    
    // Helper kiểm tra khách có giao dịch hôm nay không
    function _hasTodayActivity(c) {
        if (c.debtHistory) { for (var i = 0; i < c.debtHistory.length; i++) { if (_isTodayEntry(c.debtHistory[i])) return true; } }
        if (c.paymentHistory) { for (var i = 0; i < c.paymentHistory.length; i++) { if (_isTodayEntry(c.paymentHistory[i])) return true; } }
        if (c.creditHistory) { for (var i = 0; i < c.creditHistory.length; i++) { if (_isTodayEntry(c.creditHistory[i])) return true; } }
        return false;
    }
    // Sắp xếp: ưu tiên khách có giao dịch hôm nay, theo thứ tự chữ cái
    filtered.sort(function(a, b) {
        var aToday = _hasTodayActivity(a);
        var bToday = _hasTodayActivity(b);
        // Nhóm 1: khách có giao dịch hôm nay lên đầu, sắp xếp theo chữ cái
        if (aToday && !bToday) return -1;
        if (!aToday && bToday) return 1;
        if (aToday && bToday) {
            var nameA = (a.name || '').toLowerCase();
            var nameB = (b.name || '').toLowerCase();
            if (nameA < nameB) return -1;
            if (nameA > nameB) return 1;
            return 0;
        }
        // Nhóm 2: khách có giao dịch cũ hơn, theo thời gian gần nhất
        var aLatest = _getLatestActivityTime(a);
        var bLatest = _getLatestActivityTime(b);
        var aHasActivity = aLatest > 0;
        var bHasActivity = bLatest > 0;
        if (aHasActivity && !bHasActivity) return -1;
        if (!aHasActivity && bHasActivity) return 1;
        if (aHasActivity && bHasActivity) {
            if (bLatest !== aLatest) return bLatest - aLatest;
        }
        // Nhóm 3: khách có nợ lên trước
        var debtA = (a.totalDebt || 0);
        var debtB = (b.totalDebt || 0);
        if (debtA > 0 && debtB <= 0) return -1;
        if (debtB > 0 && debtA <= 0) return 1;
        return 0;
    });
    
    var allTransactions = window.costTransactions || [];
    
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var c = filtered[i];
        
        // FIX: Tính toán rõ ràng 3 giá trị: nợ, dư, đưa trước
        var totalFromHistory = 0;
        if (c.debtHistory) {
            for (var hi = 0; hi < c.debtHistory.length; hi++) {
                totalFromHistory += c.debtHistory[hi].amount || 0;
            }
        }
        var totalPayment = 0;
        if (c.paymentHistory) {
            for (var pi = 0; pi < c.paymentHistory.length; pi++) {
                totalPayment += c.paymentHistory[pi].amount || 0;
            }
        }
        var outstandingDebt = Math.max(0, totalFromHistory - totalPayment);
        // FIX: Gộp changeBalance và prepaidBalance thành 1 loại duy nhất (prepaidBalance)
        // Vì cả 2 đều là tiền của khách, cùng bản chất
        var prepaidBal = c.prepaidBalance || 0;
        
        // FIX: Tính toán nợ hôm nay và nợ trước đó
        var debtToday = 0;
        var paymentToday = 0;
        if (c.debtHistory) {
            for (var hi = 0; hi < c.debtHistory.length; hi++) {
                if (_isTodayEntry(c.debtHistory[hi])) {
                    debtToday += c.debtHistory[hi].amount || 0;
                }
            }
        }
        if (c.paymentHistory) {
            for (var pi = 0; pi < c.paymentHistory.length; pi++) {
                if (_isTodayEntry(c.paymentHistory[pi])) {
                    paymentToday += c.paymentHistory[pi].amount || 0;
                }
            }
        }
        var debtBefore = Math.max(0, (totalFromHistory - debtToday) - (totalPayment - paymentToday));
        
        // FIX: Tên + nợ cùng dòng, mỗi phần màu sắc khác nhau
        var hasTodayActivity = debtToday > 0 || paymentToday > 0;
        
        // Badge: chỉ icon
        var badgeIcon = hasTodayActivity ? '🔴' : '';
        var statusIcon = (!outstandingDebt && !prepaidBal) ? '✅' : '';
        
        // Xây dựng text nợ: (nợ trước +nợ hôm nay -trả hôm nay) = 💢 Nợ: tổng
        var debtHtml = '';
        if (outstandingDebt > 0) {
            if (hasTodayActivity) {
                debtHtml += ' <span class="debt-bracket">(</span>';
                debtHtml += '<span class="debt-before">' + formatMoney(debtBefore) + '</span>';
                if (debtToday > 0) debtHtml += ' <span class="debt-today">+' + formatMoney(debtToday) + '</span>';
                if (paymentToday > 0) debtHtml += ' <span class="debt-pay">-' + formatMoney(paymentToday) + '</span>';
                debtHtml += ' <span class="debt-bracket">) = </span>';
            }
            debtHtml += '<span class="debt-total"> ' + formatMoney(outstandingDebt) + '</span>';
        }
        
        // Dòng tên + badge + nợ
        var nameLine = escapeHtml(c.name);
        if (badgeIcon) nameLine += ' ' + badgeIcon;
        if (!debtHtml && statusIcon) nameLine += ' ' + statusIcon;
        
        // Dòng phụ: tiền của khách (dư/trước) - gộp chung 1 loại
        var subLines = [];
        if (prepaidBal > 0) {
            subLines.push('<span class="debt-prepaid">💰 Dư: ' + formatMoney(prepaidBal) + '</span>');
        }
        
        var infoHtml = '<div class="customer-name"><span>' + nameLine + '</span>' + (debtHtml ? '<span class="debt-inline">' + debtHtml + '</span>' : '') + '</div>' +
            '<div class="customer-phone">📞 ' + (c.phone || '') + '</div>';
        
        if (subLines.length > 0) {
            infoHtml += '<div class="customer-debt">' + subLines.join('') + '</div>';
        }
        
        html += '<div class="customer-card" onclick="showCustomerDetail(\'' + c.id + '\')"><div class="customer-avatar">' + c.name.charAt(0).toUpperCase() + '</div><div class="customer-info">' + infoHtml + '</div></div>';
    }
    container.innerHTML = html;
}

function quickAddCustomer() {
    var searchInput = document.getElementById('customerSearchInput');
    var name = searchInput ? searchInput.value.trim() : '';
    if (!name) {
        showToast('Nhập tên khách hàng vào ô tìm kiếm!', 'warning');
        if (searchInput) searchInput.focus();
        return;
    }
    // Kiểm tra khách đã tồn tại chưa
    for (var i = 0; i < customers.length; i++) {
        if (customers[i].name.toLowerCase() === name.toLowerCase()) {
            showToast('Khách "' + name + '" đã tồn tại!', 'warning');
            return;
        }
    }
    addCustomer(name, '').then(function() {
        if (searchInput) searchInput.value = '';
        renderCustomerList();
        showToast('✅ Đã thêm khách ' + name, 'success');
    });
}

function addCustomer(name, phone) {
    var newId = Date.now().toString() + Math.random().toString(36).substr(2, 6);
    // FIX: Gộp thành prepaidBalance duy nhất
    var newCustomer = { id: newId, name: name.trim(), phone: phone || '', address: '', totalDebt: 0, totalSpent: 0, creditBalance: 0, prepaidBalance: 0, createdAt: new Date().toISOString(), debtHistory: [], paymentHistory: [], creditHistory: [] };
    return DB.create('customers', newCustomer).then(function() {
        customers.push(newCustomer);
        return newCustomer;
    });
}

// Biến lưu trạng thái mở rộng lịch sử cho customer detail
var _customerHistoryExpanded = false;

function showCustomerDetail(customerId) {
    // Tìm trong memory cache
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return;
    
    // Render ngay từ memory cache
    _renderCustomerDetail(c, customerId);
}

// Hàm render UI
function _renderCustomerDetail(c, customerId) {
    _customerHistoryExpanded = false;
    var allTransactions = window.costTransactions || [];
    var all = [];
    
    // Lấy từ debtHistory và paymentHistory
    // Dùng index trong array (debtIndex) làm định danh duy nhất cho mỗi entry
    if (c.debtHistory) {
        for (var i = 0; i < c.debtHistory.length; i++) {
            var debtEntry = c.debtHistory[i];
            var allItem = { type: 'debt', date: debtEntry.date, amount: debtEntry.amount, note: debtEntry.note, transactionId: null, debtIndex: i };
            if (debtEntry.items && debtEntry.items.length > 0) {
                allItem.items = debtEntry.items;
            }
            all.push(allItem);
        }
    }
    if (c.paymentHistory) {
        for (var i = 0; i < c.paymentHistory.length; i++) {
            all.push({ type: 'payment', date: c.paymentHistory[i].date, amount: c.paymentHistory[i].amount, note: c.paymentHistory[i].note, transactionId: null });
        }
    }
    if (c.creditHistory) {
        for (var i = 0; i < c.creditHistory.length; i++) {
            all.push({ type: 'credit', date: c.creditHistory[i].date, amount: c.creditHistory[i].amount, note: c.creditHistory[i].note, transactionId: null });
        }
    }
    
    // Map transactionId cho debt records từ transactions collection
    for (var i = 0; i < allTransactions.length; i++) {
        var tx = allTransactions[i];
        if (tx.type === 'debt_payment' && tx.customer && tx.customer.id === customerId) {
            var txTime = new Date(tx.createdAt || tx.date).getTime();
            for (var j = 0; j < all.length; j++) {
                var hTime = new Date(all[j].date).getTime();
                if (Math.abs(txTime - hTime) < 60000 && all[j].transactionId === null) {
                    all[j].transactionId = tx.id;
                    all[j].items = tx.items || [];
                    break;
                }
            }
        }
    }
    
    all.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    
    var hasMore = all.length > 5;
    
    var content = document.getElementById('customerDetailContent');
    if (!content) return;
    content.setAttribute('data-customer-id', customerId);
    
    // FIX: Tính toán rõ ràng 3 giá trị: nợ, dư, đưa trước
    var totalFromHistory = 0;
    if (c.debtHistory) {
        for (var hi = 0; hi < c.debtHistory.length; hi++) {
            totalFromHistory += c.debtHistory[hi].amount || 0;
        }
    }
    var totalPayment = 0;
    if (c.paymentHistory) {
        for (var pi = 0; pi < c.paymentHistory.length; pi++) {
            totalPayment += c.paymentHistory[pi].amount || 0;
        }
    }
    var outstandingDebt = Math.max(0, totalFromHistory - totalPayment);
    // FIX: Gộp changeBalance và prepaidBalance thành 1 loại duy nhất
    var prepaidBal = c.prepaidBalance || 0;
    
    // Hiển thị rõ ràng
    var balanceLines = '';
    if (outstandingDebt > 0) {
        balanceLines += '<div style="font-size:13px;color:#ef4444;font-weight:700;">💢 Trả sau: ' + formatMoney(outstandingDebt) + '</div>';
    }
    if (prepaidBal > 0) {
        balanceLines += '<div style="font-size:13px;color:#16a34a;font-weight:700;">💰 Dư: ' + formatMoney(prepaidBal) + '</div>';
    }
    if (!balanceLines) {
        balanceLines = '<span style="color:#94a3b8;font-size:13px;">✅ Thanh toán</span>';
    }
    
    var showPayBtn = outstandingDebt > 0;
    var debtForPayment = outstandingDebt;
    
    var titleEl = document.getElementById('customerDetailTitle');
    if (titleEl) titleEl.innerHTML = '👤 ' + escapeHtml(c.name);
    var balanceEl = document.getElementById('customerDetailBalance');
    if (balanceEl) {
        balanceEl.innerHTML = balanceLines;
        balanceEl.style.display = 'block';
    }
    
    var leftHtml = '';
    if (showPayBtn) {
        leftHtml = '<div class="cus-pay-inline"><input type="number" id="inlineDebtAmount" class="cus-pay-input" value="' + debtForPayment + '" step="1000" placeholder="Số tiền"><div class="cus-pay-btns"><button class="cus-pay-btn cus-pay-cash" onclick="confirmInlineDebtPayment(\'' + c.id + '\',\'cash\')">💰 TM</button><button class="cus-pay-btn cus-pay-transfer" onclick="confirmInlineDebtPayment(\'' + c.id + '\',\'transfer\')">💳 CK</button></div></div>';
    }
    if (DB.isAdmin && DB.isAdmin()) {
        leftHtml += '<div class="cus-admin-actions" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">' +
            '<button class="cus-edit-btn" onclick="editCustomerInfo(\'' + c.id + '\')" style="padding:6px 10px;font-size:12px;border:none;border-radius:6px;background:#3b82f6;color:#fff;cursor:pointer;">✏️ Sửa</button>' +
            '<button class="cus-delete-btn" onclick="deleteCustomer(\'' + c.id + '\')" style="padding:6px 10px;font-size:12px;border:none;border-radius:6px;background:#ef4444;color:#fff;cursor:pointer;">🗑️ Xóa</button>' +
            '<button class="cus-add-debt-btn" onclick="showAddOldDebtForm(\'' + c.id + '\')" style="padding:6px 10px;font-size:12px;border:none;border-radius:6px;background:#f59e0b;color:#fff;cursor:pointer;">➕ Nợ cũ</button>' +
            '<button class="cus-add-debt-btn" onclick="showAddPrepaidForm(\'' + c.id + '\')" style="padding:6px 10px;font-size:12px;border:none;border-radius:6px;background:#16a34a;color:#fff;cursor:pointer;">💰 Trước</button>' +
            '</div>';
    }
    
    // FIX: Gọi _renderCustomerHistoryHtml để lấy historyHtml
    var historyResult = _renderCustomerHistoryHtml(all, _customerHistoryExpanded, customerId);
    var historyHtml = historyResult.html;
    
    var rightHtml = '<div class="cus-history-title">📜 Lịch sử <span style="font-size:12px;font-weight:normal;color:#64748b;">(' + all.length + ' giao dịch)</span></div>' +
        '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">' +
        '<button class="cus-print-btn" onclick="printCustomerDebtHistory(\'' + c.id + '\',\'thermal\')" style="padding:6px 10px;font-size:12px;border:none;border-radius:6px;background:#1e293b;color:#fff;cursor:pointer;">🖨️ In nhiệt</button>' +
        '<button class="cus-pdf-btn" onclick="printCustomerDebtHistory(\'' + c.id + '\',\'pdf\')" style="padding:6px 10px;font-size:12px;border:none;border-radius:6px;background:#ef4444;color:#fff;cursor:pointer;">📄 Xuất PDF</button>' +
        '</div>' +
        '<div id="customerHistoryList">' + (historyHtml || '<div class="empty-state">Chưa có giao dịch</div>') + '</div>' + (hasMore ? '<button class="cus-expand-btn" id="btnExpandHistory" onclick="toggleCustomerHistory(\'' + c.id + '\')">📋 Xem thêm</button>' : '');
    
    content.innerHTML = '<div class="cus-detail-layout"><div class="cus-detail-left">' + leftHtml + '</div><div class="cus-detail-right">' + rightHtml + '</div></div>';
    document.getElementById('customerDetailModal').style.display = 'flex';
}

// FIX: Render danh sách lịch sử - hiển thị TẤT CẢ các loại giao dịch
// bao gồm debt, payment, credit, prepaid, change_in, change_use
// customerId được truyền trực tiếp từ nơi gọi, không đọc từ DOM (tránh sai lệch)
// Trả về { html, latestBalance } - latestBalance là số dư của entry mới nhất
function _renderCustomerHistoryHtml(all, expanded, customerId) {
    var html = '';
    var isAdmin = DB.isAdmin && DB.isAdmin();
    
    // FIX: KHÔNG lọc bỏ credit nữa - hiển thị tất cả
    var filtered = all;
    
    var limit = expanded ? filtered.length : Math.min(5, filtered.length);
    
    // Tính dư nợ lũy kế cho từng giao dịch (kiểu sao kê ngân hàng)
    // filtered[0] = mới nhất, filtered[cuối] = cũ nhất
    // balances[i] = dư nợ sau giao dịch filtered[i] (dương = còn nợ, âm = đang dư)
    var balances = {};
    var total = 0;
    // Vòng 1: chạy từ cũ nhất (cuối) đến mới nhất (đầu) để tính tổng
    for (var idx = filtered.length - 1; idx >= 0; idx--) {
        var hh = filtered[idx];
        if (hh.type === 'debt') {
            total += hh.amount;
        } else if (hh.type === 'payment') {
            total -= hh.amount;
        }
        // credit, prepaid, change_in, change_use không ảnh hưởng dư nợ
    }
    // Vòng 2: chạy từ mới nhất (đầu) đến cũ nhất (cuối)
    var accumulated = total;
    for (var idx = 0; idx < filtered.length; idx++) {
        var hh = filtered[idx];
        balances[idx] = accumulated;
        if (hh.type === 'debt') {
            accumulated -= hh.amount;
        } else if (hh.type === 'payment') {
            accumulated += hh.amount;
        }
    }
    
    for (var i = 0; i < limit; i++) {
        var h = filtered[i];
        
        // Định dạng ngày
        var d = new Date(h.date);
        var dateStr = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth()+1)).slice(-2) + '/' + d.getFullYear();
        
        // Dư nợ sau giao dịch này
        var balance = balances[i] || 0;
        
        // FIX: Xác định nhãn và số tiền cho TẤT CẢ các loại giao dịch
        var label = '';
        var amountColor = '';
        var isCreditTx = false;
        if (h.type === 'debt') {
            label = 'Ghi trả sau';
            amountColor = '#dc2626';
        } else if (h.type === 'payment') {
            label = 'Thanh toán';
            amountColor = '#16a34a';
        } else if (h.type === 'credit' || h.type === 'change_in') {
            // Tiền dư (từ thanh toán dư)
            label = (h.amount >= 0) ? '💰 Tiền dư +' : '💰 Dùng tiền dư';
            amountColor = '#16a34a';
            isCreditTx = true;
        } else if (h.type === 'prepaid') {
            // Tiền đưa trước
            label = '💳 Đưa trước';
            amountColor = '#8b5cf6';
            isCreditTx = true;
        } else if (h.type === 'change_use') {
            label = '💰 Dùng tiền dư';
            amountColor = '#f59e0b';
            isCreditTx = true;
        }
        
        // Format tổng nợ
        var balanceText = '';
        var balanceColor = '';
        if (balance > 0) {
            balanceText = formatMoney(balance);
            balanceColor = '#dc2626';
        } else if (balance < 0) {
            balanceText = 'Dư ' + formatMoney(Math.abs(balance));
            balanceColor = '#16a34a';
        } else {
            balanceText = '0đ';
            balanceColor = '#64748b';
        }
        
        // FIX: Với giao dịch credit/prepaid, không hiển thị "Tổng tiền" (dư nợ)
        // vì các giao dịch này không ảnh hưởng dư nợ
        var showBalance = !isCreditTx;
        
        // Nếu có items
        var hasItems = h.items && h.items.length > 0;
        var itemsHtml = '';
        if (hasItems) {
            itemsHtml = '<div style="font-size:11px;color:#666;margin:2px 0 4px 0;padding:4px 8px;background:#f8f9fa;border-radius:4px;">';
            for (var j = 0; j < h.items.length; j++) {
                var itemName = escapeHtml(h.items[j].name);
                var itemQty = h.items[j].qty;
                var itemTotal = formatMoney(h.items[j].price * h.items[j].qty);
                itemsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:1px 0;">';
                itemsHtml += '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">• ' + itemName + ' <span style="color:#999;">x' + itemQty + '</span></span>';
                itemsHtml += '<span style="white-space:nowrap;font-weight:500;color:#333;">' + itemTotal + '</span>';
                itemsHtml += '</div>';
            }
            itemsHtml += '</div>';
        }
        
        // Nút Sửa/Xóa cho dòng nợ (chỉ admin)
        var actionBtns = '';
        if (isAdmin && h.type === 'debt' && customerId && h.debtIndex !== undefined && h.debtIndex !== null) {
            actionBtns = '<div style="display:flex;gap:4px;margin-top:2px;">' +
                '<button onclick="editDebtEntryUI(\'' + customerId + '\',' + h.debtIndex + ')" style="padding:2px 8px;font-size:11px;border:1px solid #f59e0b;border-radius:4px;background:#fef3c7;color:#92400e;cursor:pointer;">✏️ Sửa</button>' +
                '<button onclick="deleteDebtEntry(\'' + customerId + '\',' + h.debtIndex + ')" style="padding:2px 8px;font-size:11px;border:1px solid #ef4444;border-radius:4px;background:#fee2e2;color:#991b1b;cursor:pointer;">🗑️ Xóa</button>' +
                '</div>';
        }
        
        // Mỗi giao dịch là 1 dòng
        html += '<div style="border-bottom:1px solid #e2e8f0;padding:8px 0;">';
        
        // Dòng 1: ngày
        html += '<div style="font-size:12px;color:#64748b;margin-bottom:4px;">ngày ' + dateStr + '</div>';
        
        // Dòng 2: Loại giao dịch | Tổng nợ (chỉ hiển thị Tổng tiền cho debt/payment)
        html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        html += '  <span style="font-size:14px;font-weight:600;color:' + amountColor + ';">' + label + ': ' + formatMoney(Math.abs(h.amount)) + '</span>';
        if (showBalance) {
            html += '  <span style="font-size:14px;font-weight:700;color:' + balanceColor + ';">Tổng tiền: ' + balanceText + '</span>';
        }
        html += '</div>';
        
        // Ghi chú + items
        if (h.note) {
            html += '<div style="font-size:11px;color:#64748b;margin-top:4px;">📝 ' + escapeHtml(h.note) + '</div>';
        }
        html += itemsHtml;
        html += actionBtns;
        
        html += '</div>';
    }
    
    // Trả về cả html và số dư của entry đầu tiên (mới nhất) để hiển thị header
    var firstBalance = filtered.length > 0 ? (balances[0] || 0) : 0;
    return { html: html, latestBalance: firstBalance };
}
// Toggle mở rộng lịch sử
function toggleCustomerHistory(customerId) {
    _customerHistoryExpanded = !_customerHistoryExpanded;
    // Dùng memory cache
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return;
    
    var allTransactions = window.costTransactions || [];
    var all = [];
    if (c.debtHistory) {
        for (var i = 0; i < c.debtHistory.length; i++) {
            var debtEntry = c.debtHistory[i];
            all.push({ type: 'debt', date: debtEntry.date, amount: debtEntry.amount, note: debtEntry.note, transactionId: null, debtIndex: i });
        }
    }
    if (c.paymentHistory) {
        for (var i = 0; i < c.paymentHistory.length; i++) {
            all.push({ type: 'payment', date: c.paymentHistory[i].date, amount: c.paymentHistory[i].amount, note: c.paymentHistory[i].note, transactionId: null });
        }
    }
    if (c.creditHistory) {
        for (var i = 0; i < c.creditHistory.length; i++) {
            all.push({ type: 'credit', date: c.creditHistory[i].date, amount: c.creditHistory[i].amount, note: c.creditHistory[i].note, transactionId: null });
        }
    }
    
    // FIX: Thêm các giao dịch mới từ transactions collection
    for (var i = 0; i < allTransactions.length; i++) {
        var tx = allTransactions[i];
        if (tx.customer && tx.customer.id === customerId) {
            // Các type mới: prepaid, change_in, change_use
            if (tx.type === 'prepaid' || tx.type === 'change_in' || tx.type === 'change_use') {
                all.push({
                    type: tx.type,
                    date: tx.createdAt || tx.date,
                    amount: tx.amount,
                    note: tx.note || '',
                    transactionId: tx.id,
                    items: tx.items || []
                });
            } else if (tx.type === 'debt_payment') {
                var txTime = new Date(tx.createdAt || tx.date).getTime();
                for (var j = 0; j < all.length; j++) {
                    var hTime = new Date(all[j].date).getTime();
                    if (Math.abs(txTime - hTime) < 60000 && all[j].transactionId === null) {
                        all[j].transactionId = tx.id;
                        all[j].items = tx.items || [];
                        break;
                    }
                }
            }
        }
    }
    
    all.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    
    var listEl = document.getElementById('customerHistoryList');
    var btnEl = document.getElementById('btnExpandHistory');
    if (listEl) {
        var histResult = _renderCustomerHistoryHtml(all, _customerHistoryExpanded, customerId);
        listEl.innerHTML = (histResult && histResult.html) || '<div class="empty-state">Chưa có giao dịch</div>';
    }
    if (btnEl) {
        btnEl.innerText = _customerHistoryExpanded ? '📋 Thu gọn' : '📋 Xem thêm';
    }
}

// Hàm thanh toán trả sau inline - gộp từ openDebtPayment + confirmDebtPayment
function confirmInlineDebtPayment(customerId, method) {
    var amount = parseInt(document.getElementById('inlineDebtAmount').value) || 0;
    if (amount <= 0) { showToast('Số tiền không hợp lệ!', 'warning'); return; }
    var customer = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { customer = customers[i]; break; } }
    if (!customer) return;
    
    var methodLabel = method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản';
    
    // Tính tổng nợ thực tế từ debtHistory (chính xác hơn totalDebt)
    var totalFromHistory = 0;
    if (customer.debtHistory) {
        for (var hi = 0; hi < customer.debtHistory.length; hi++) {
            totalFromHistory += customer.debtHistory[hi].amount || 0;
        }
    }
    // Tính tổng đã trả
    var totalPayment = 0;
    if (customer.paymentHistory) {
        for (var pi = 0; pi < customer.paymentHistory.length; pi++) {
            totalPayment += customer.paymentHistory[pi].amount || 0;
        }
    }
    // Nợ còn lại = tổng nợ - tổng đã trả
    var outstandingDebt = Math.max(0, totalFromHistory - totalPayment);
    
    // FIX: Gộp tiền dư và tiền đưa trước thành 1 loại (prepaidBalance)
    var prepaidBalance = customer.prepaidBalance || 0;
    var creditUsed = 0;
    var actualPayment = amount;
    
    if (prepaidBalance > 0) {
        // Hỏi khách có muốn dùng tiền này không
        var msg = '💰 ' + customer.name + ' có ' + formatMoney(prepaidBalance) + ' tiền.\nDùng số tiền này để thanh toán?';
        
        if (confirm(msg)) {
            creditUsed = Math.min(prepaidBalance, amount);
            actualPayment = amount - creditUsed;
            customer.prepaidBalance = prepaidBalance - creditUsed;
            customer.creditHistory = customer.creditHistory || [];
            customer.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: -creditUsed, note: 'Dùng tiền khi thanh toán trả sau' });
        }
    }
    
    // FIX: Dùng outstandingDebt (nợ còn lại) thay vì totalFromHistory (tổng nợ lịch sử)
    // để phát hiện trả dư chính xác. Ví dụ: nợ 100k, đã trả 60k, còn 40k.
    // Nếu khách trả 50k -> actualPayment=50k, outstandingDebt=40k -> payment=40k, overpay=10k (đúng)
    var payment = Math.min(actualPayment, outstandingDebt);
    var overpay = actualPayment - payment;
    
    customer.totalDebt = outstandingDebt - payment;
    customer.paymentHistory = customer.paymentHistory || [];
    var now = new Date();
    var y = now.getFullYear();
    var m = ('0' + (now.getMonth() + 1)).slice(-2);
    var d = ('0' + now.getDate()).slice(-2);
    var dateKey = y + '-' + m + '-' + d;
    // FIX: Lưu note chi tiết để refund có thể parse chính xác
    var payNote = 'Thanh toán trả sau ' + formatMoney(actualPayment) + ' (' + methodLabel + ')';
    if (creditUsed > 0) {
        payNote += ' (đã dùng ' + formatMoney(creditUsed) + ' tiền dư/trước)';
    }
    if (overpay > 0) {
        payNote += ' (dư ' + formatMoney(overpay) + ')';
    }
    customer.paymentHistory.unshift({ id: Date.now(), date: now.toISOString(), dateKey: dateKey, amount: actualPayment, method: method, note: payNote });
    
    // FIX: Nếu trả dư, lưu vào prepaidBalance (gộp chung tiền dư và tiền đưa trước)
    if (overpay > 0) {
        customer.prepaidBalance = (customer.prepaidBalance || 0) + overpay;
        customer.creditHistory = customer.creditHistory || [];
        customer.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: overpay, note: 'Trả dư khi thanh toán trả sau +' + formatMoney(overpay) });
    }
    
    // OPTIMIZE: Cập nhật DB
    var updateData = {
        totalDebt: customer.totalDebt,
        paymentHistory: customer.paymentHistory,
        prepaidBalance: customer.prepaidBalance || 0,
        creditBalance: customer.prepaidBalance || 0,
        creditHistory: customer.creditHistory || []
    };
    DB.update('customers', customer.id, updateData).then(function() {
        var historyNote = 'Thanh toán trả sau (' + methodLabel + ')';
        if (creditUsed > 0) historyNote += ' (đã dùng ' + formatMoney(creditUsed) + ' tiền dư/trước)';
        if (overpay > 0) historyNote += ' (dư ' + formatMoney(overpay) + ')';
        // FIX: Lưu creditUsed vào note để refund có thể parse
        // Format: "đã dùng 20,000 tiền dư/trước"
        return addHistory({ type: 'debt_payment', amount: actualPayment, paymentMethod: method, items: [], customer: { id: customer.id, name: customer.name }, note: historyNote });
    }).then(function() {
        if (method === 'cash' && actualPayment > 0) {
            handleCashPayment(actualPayment, null, {type: 'debt_payment', tableName: null, customer: {id: customer.id, name: customer.name}}).catch(function(err) {
                console.error('[AUDIT] handleCashPayment lỗi:', err);
            });
        }
        
        if (typeof notifyPaymentToTelegram === 'function') {
            notifyPaymentToTelegram({
                type: 'debt_payment',
                amount: actualPayment,
                paymentMethod: method,
                items: [],
                tableName: null,
                customer: { id: customer.id, name: customer.name },
                createdAt: new Date().toISOString()
            });
        }
        
        var msg = '✅ Đã thanh toán ' + formatMoney(actualPayment) + ' (' + methodLabel + ')';
        if (creditUsed > 0) msg += ', đã dùng ' + formatMoney(creditUsed) + ' tiền dư/trước';
        if (overpay > 0) msg += ', dư ' + formatMoney(overpay) + ' làm tiền dư';
        showToast(msg, 'success');
        renderCustomerList();
        showCustomerDetail(customer.id);
    });
}

function addCustomerDebt(customerId, amount, note, items) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return Promise.resolve({ debtAmount: amount, creditUsed: 0 });
    
    // FIX: Gộp tiền dư và tiền đưa trước thành 1 loại (prepaidBalance)
    // Khi ghi nợ, tự động trừ tiền của khách trước
    var prepaidBal = c.prepaidBalance || 0;
    var creditUsed = 0;
    var debtAmount = amount;
    
    if (prepaidBal > 0) {
        var useFromPrepaid = Math.min(prepaidBal, debtAmount);
        creditUsed += useFromPrepaid;
        debtAmount -= useFromPrepaid;
        c.prepaidBalance = prepaidBal - useFromPrepaid;
    }
    
    // Ghi nhận lịch sử dùng credit (nếu có)
    if (creditUsed > 0) {
        c.creditHistory = c.creditHistory || [];
        c.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: -creditUsed, note: 'Tự động trừ khi ghi nợ: ' + note });
    }
    
    if (debtAmount > 0) {
        c.totalDebt = (c.totalDebt || 0) + debtAmount;
        c.debtHistory = c.debtHistory || [];
        var now = new Date();
        // FIX: Lưu creditUsed vào debtEntry để editDebtEntry/deleteDebtEntry có thể khôi phục prepaidBalance
        var debtEntry = { id: Date.now(), date: now.toISOString(), amount: debtAmount, note: note, status: 'unpaid', creditUsed: creditUsed };
        var y = now.getFullYear();
        var m = ('0' + (now.getMonth() + 1)).slice(-2);
        var d = ('0' + now.getDate()).slice(-2);
        debtEntry.dateKey = y + '-' + m + '-' + d;
        if (items && items.length > 0) {
            debtEntry.items = items.map(function(it) { return { name: it.name, qty: it.qty, price: it.price }; });
        }
        c.debtHistory.unshift(debtEntry);
    }
    
    // Cập nhật creditBalance cho backward compatibility
    c.creditBalance = c.prepaidBalance || 0;
    
    var updateData = {
        totalDebt: c.totalDebt || 0,
        debtHistory: c.debtHistory || [],
        prepaidBalance: c.prepaidBalance || 0,
        creditBalance: c.creditBalance || 0,
        creditHistory: c.creditHistory || []
    };
    return DB.update('customers', customerId, updateData).then(function() {
        return { debtAmount: debtAmount, creditUsed: creditUsed };
    });
}

// ========== THÊM NỢ CŨ (ADMIN) ==========
// Thêm khoản nợ cũ với ngày tùy chỉnh, KHÔNG ảnh hưởng doanh thu
function addOldDebt(customerId, amount, note, dateStr) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return Promise.resolve();
    if (amount <= 0) { showToast('⚠️ Số tiền không hợp lệ', 'warning'); return Promise.resolve(); }
    
    // KHÔNG tự động trừ creditBalance (vì là nợ cũ, không liên quan giao dịch hiện tại)
    c.totalDebt = (c.totalDebt || 0) + amount;
    c.debtHistory = c.debtHistory || [];
    
    var now = dateStr ? new Date(dateStr + 'T12:00:00') : new Date();
    var debtEntry = {
        id: 'debt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        date: now.toISOString(),
        amount: amount,
        note: note || 'Thêm nợ cũ',
        status: 'unpaid'
    };
    var y = now.getFullYear();
    var m = ('0' + (now.getMonth() + 1)).slice(-2);
    var d = ('0' + now.getDate()).slice(-2);
    debtEntry.dateKey = y + '-' + m + '-' + d;
    c.debtHistory.unshift(debtEntry);
    
    return DB.update('customers', customerId, {
        totalDebt: c.totalDebt,
        debtHistory: c.debtHistory
    }).then(function() {
        showToast('✅ Đã thêm nợ cũ: ' + formatMoney(amount), 'success');
        renderCustomerList();
        showCustomerDetail(customerId);
    });
}

// ========== SỬA KHOẢN NỢ (ADMIN) - DÙNG INDEX ==========
// debtIndex là index trong c.debtHistory array, được truyền từ data-debt-index trong HTML
function editDebtEntry(customerId, debtIndex, newAmount, newNote) {
    if (newAmount <= 0) { showToast('⚠️ Số tiền không hợp lệ', 'warning'); return Promise.resolve(); }
    
    // Tìm customer trong memory cache
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) { showToast('⚠️ Không tìm thấy khách hàng', 'error'); return Promise.resolve(); }
    
    // Đảm bảo debtIndex là number
    if (typeof debtIndex === 'string') debtIndex = parseInt(debtIndex, 10);
    
    var debtHistory = c.debtHistory || [];
    if (isNaN(debtIndex) || debtIndex < 0 || debtIndex >= debtHistory.length) {
        showToast('⚠️ Không tìm thấy khoản nợ', 'error');
        return Promise.resolve();
    }
    
    var entry = debtHistory[debtIndex];
    var oldAmount = entry.amount;
    var oldCreditUsed = entry.creditUsed || 0;
    
    // FIX: Khi sửa nợ, nếu entry có creditUsed > 0 (đã auto-deduct từ prepaidBalance)
    // thì cần khôi phục lại prepaidBalance trước khi tính toán lại
    if (oldCreditUsed > 0) {
        c.prepaidBalance = (c.prepaidBalance || 0) + oldCreditUsed;
        // Ghi nhận vào creditHistory
        c.creditHistory = c.creditHistory || [];
        c.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: oldCreditUsed, note: 'Hoàn trả credit khi sửa nợ (cũ: ' + formatMoney(oldAmount) + ' → mới: ' + formatMoney(newAmount) + ')' });
    }
    
    // Cập nhật totalDebt: trừ nợ cũ, cộng nợ mới
    c.totalDebt = (c.totalDebt || 0) - oldAmount + newAmount;
    entry.amount = newAmount;
    // Reset creditUsed vì đã hoàn trả, nợ mới sẽ không auto-deduct (người dùng tự điều chỉnh)
    entry.creditUsed = 0;
    if (newNote !== undefined && newNote !== null) {
        entry.note = newNote;
    }
    
    // Cập nhật creditBalance cho backward compatibility
    c.creditBalance = c.prepaidBalance || 0;
    
    return DB.update('customers', customerId, {
        totalDebt: c.totalDebt,
        debtHistory: debtHistory,
        prepaidBalance: c.prepaidBalance || 0,
        creditBalance: c.creditBalance || 0,
        creditHistory: c.creditHistory || []
    }).then(function() {
        showToast('✅ Đã sửa khoản nợ: ' + formatMoney(oldAmount) + ' → ' + formatMoney(newAmount), 'success');
        renderCustomerList();
        showCustomerDetail(customerId);
    });
}

// ========== XÓA KHOẢN NỢ (ADMIN) - DÙNG INDEX ==========
function deleteDebtEntry(customerId, debtIndex) {
    // Tìm customer trong memory cache
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) { showToast('⚠️ Không tìm thấy khách hàng', 'error'); return; }
    
    // Đảm bảo debtIndex là number
    if (typeof debtIndex === 'string') debtIndex = parseInt(debtIndex, 10);
    
    var debtHistory = c.debtHistory || [];
    if (isNaN(debtIndex) || debtIndex < 0 || debtIndex >= debtHistory.length) {
        showToast('⚠️ Không tìm thấy khoản nợ', 'error');
        return;
    }
    
    var entry = debtHistory[debtIndex];
    var removedAmount = entry.amount;
    var removedCreditUsed = entry.creditUsed || 0;
    
    if (!confirm('🗑️ Xóa khoản nợ ' + formatMoney(removedAmount) + '?\nHành động này không thể hoàn tác!')) {
        return;
    }
    
    // FIX: Nếu entry có creditUsed > 0 (đã auto-deduct từ prepaidBalance),
    // cần khôi phục lại prepaidBalance
    if (removedCreditUsed > 0) {
        c.prepaidBalance = (c.prepaidBalance || 0) + removedCreditUsed;
        c.creditHistory = c.creditHistory || [];
        c.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: removedCreditUsed, note: 'Hoàn trả credit khi xóa nợ: ' + formatMoney(removedAmount) });
    }
    
    debtHistory.splice(debtIndex, 1);
    c.totalDebt = (c.totalDebt || 0) - removedAmount;
    if (c.totalDebt < 0) c.totalDebt = 0;
    
    // Cập nhật creditBalance cho backward compatibility
    c.creditBalance = c.prepaidBalance || 0;
    
    return DB.update('customers', customerId, {
        totalDebt: c.totalDebt,
        debtHistory: debtHistory,
        prepaidBalance: c.prepaidBalance || 0,
        creditBalance: c.creditBalance || 0,
        creditHistory: c.creditHistory || []
    }).then(function() {
        showToast('✅ Đã xóa khoản nợ: ' + formatMoney(removedAmount), 'success');
        renderCustomerList();
        showCustomerDetail(customerId);
    });
}

// ========== CẬP NHẬT TIỀN CỦA KHÁCH ==========
// FIX: Gộp changeBalance và prepaidBalance thành 1 loại duy nhất (prepaidBalance)
// Giữ addCustomerCredit và useCustomerCredit cho tương thích ngược

function addCustomerCredit(customerId, amount, note) {
    return addPrepaidBalance(customerId, amount, note);
}

function useCustomerCredit(customerId, amount, note) {
    return usePrepaidBalance(customerId, amount, note);
}

// Thêm tiền cho khách (dư/trước - gộp chung)
function addPrepaidBalance(customerId, amount, note) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return Promise.resolve();
    c.prepaidBalance = (c.prepaidBalance || 0) + amount;
    c.creditBalance = (c.creditBalance || 0) + amount; // Giữ tương thích
    c.creditHistory = c.creditHistory || [];
    c.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: amount, note: note });
    return DB.update('customers', customerId, { prepaidBalance: c.prepaidBalance, creditBalance: c.creditBalance, creditHistory: c.creditHistory }).then(function() {
        // OPTIMIZE: Không cần DB.getAll('customers') - memory cache đã được cập nhật
    });
}

// Dùng tiền của khách (chỉ 1 loại prepaidBalance)
function usePrepaidBalance(customerId, amount, note) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return Promise.resolve(0);
    
    var prepaidBal = c.prepaidBalance || 0;
    var used = Math.min(amount, prepaidBal);
    if (used <= 0) return Promise.resolve(0);
    
    c.prepaidBalance = prepaidBal - used;
    c.creditBalance = c.prepaidBalance; // Giữ tương thích
    c.creditHistory = c.creditHistory || [];
    c.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: -used, note: note });
    
    return DB.update('customers', customerId, {
        prepaidBalance: c.prepaidBalance,
        creditBalance: c.creditBalance,
        creditHistory: c.creditHistory
    }).then(function() {
        return used;
    });
}

// ========== CHỌN KHÁCH ==========
function showCustomerSelector(callback) {
    pendingCustomerCallback = callback;
    renderCustomerSelectorList('');
    var searchInput = document.getElementById('customerSelectorSearch');
    if (searchInput) searchInput.value = '';
    document.getElementById('customerSelectorModal').style.display = 'flex';
    if (searchInput) {
        searchInput.oninput = function() { renderCustomerSelectorList(this.value); };
    }
}

function renderCustomerSelectorList(searchTerm) {
    // Sắp xếp customers theo tên A-Z (không dấu) để dễ tìm kiếm
    var sorted = customers.slice().sort(function(a, b) {
        var nameA = (a.name || '').toLowerCase();
        var nameB = (b.name || '').toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return 0;
    });
    var filtered = sorted;
    if (searchTerm) {
        var lower = searchTerm.toLowerCase();
        filtered = sorted.filter(function(c) { return c.name.toLowerCase().indexOf(lower) !== -1 || (c.phone && c.phone.indexOf(searchTerm) !== -1); });
    }
    var container = document.getElementById('customerSelectorList');
    if (!container) return;
    if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">📭 Không tìm thấy khách</div>'; return; }
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var c = filtered[i];
        // FIX: Tính toán rõ ràng nợ, dư, đưa trước
        var totalFromHistory = 0;
        if (c.debtHistory) {
            for (var hi = 0; hi < c.debtHistory.length; hi++) {
                totalFromHistory += c.debtHistory[hi].amount || 0;
            }
        }
        var totalPayment = 0;
        if (c.paymentHistory) {
            for (var pi = 0; pi < c.paymentHistory.length; pi++) {
                totalPayment += c.paymentHistory[pi].amount || 0;
            }
        }
        var outstandingDebt = Math.max(0, totalFromHistory - totalPayment);
        var prepaidBal = c.prepaidBalance || 0;
        var totalCredit = prepaidBal;
        
        var balanceClass = totalCredit > 0 ? 'cus-grid-pos' : (outstandingDebt > 0 ? 'cus-grid-neg' : '');
        var balanceText = '';
        if (outstandingDebt > 0) {
            balanceText = '<span class="cus-grid-bal cus-grid-neg">💢 ' + formatMoney(outstandingDebt) + '</span>';
        }
        if (totalCredit > 0) {
            balanceText += '<span class="cus-grid-bal cus-grid-pos" style="margin-left:4px;">💰 ' + formatMoney(totalCredit) + '</span>';
        }
        if (!balanceText) {
            balanceText = '<span class="cus-grid-bal" style="color:#94a3b8;">✅ 0</span>';
        }
        html += '<div class="cus-grid-item ' + balanceClass + '" onclick="selectCustomer(\'' + c.id + '\')"><span class="cus-grid-name">' + escapeHtml(c.name) + '</span>' + balanceText + '</div>';
    }
    container.innerHTML = html;
}

function selectCustomer(customerId) {
    var customer = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { customer = customers[i]; break; } }
    if (customer && pendingCustomerCallback) {
        pendingCustomerCallback(customer);
        pendingCustomerCallback = null;
    }
    closeModal('customerSelectorModal');
}

function createCustomerFromInput() {
    var name = document.getElementById('customerSelectorSearch').value.trim();
    if (!name) { showToast('Nhập tên khách hàng!', 'warning'); return; }
    for (var i = 0; i < customers.length; i++) {
        if (customers[i].name.toLowerCase() === name.toLowerCase()) {
            if (confirm('Khách "' + name + '" đã tồn tại. Chọn khách này?')) {
                selectCustomer(customers[i].id);
            }
            return;
        }
    }
    addCustomer(name, '').then(function(newC) {
        if (newC && pendingCustomerCallback) {
            pendingCustomerCallback(newC);
            pendingCustomerCallback = null;
        }
        closeModal('customerSelectorModal');
        showToast('✅ Đã tạo khách ' + name, 'success');
        renderCustomerList();
    });
}

// ========== SỬA/XÓA KHÁCH HÀNG (CHỦ ADMIN) ==========
function editCustomerInfo(customerId) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return;
    
    // Tạo modal động thay vì prompt() (prompt không hoạt động trên mobile)
    var modalId = 'editCustomerModal';
    var existingModal = document.getElementById(modalId);
    if (existingModal) existingModal.remove();
    
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = modalId;
    modal.style.display = 'flex';
    modal.innerHTML = '<div class="modal-content" style="max-width:360px;">' +
        '<div class="modal-header">' +
            '<span class="modal-title">✏️ Sửa thông tin khách</span>' +
            '<span class="modal-close" onclick="closeModal(\'' + modalId + '\')">&times;</span>' +
        '</div>' +
        '<div class="modal-body" style="padding:16px;">' +
            '<label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Tên khách hàng</label>' +
            '<input type="text" id="editCusName" class="form-input" value="' + escapeHtml(c.name) + '" style="margin-bottom:12px;">' +
            '<label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Số điện thoại</label>' +
            '<input type="text" id="editCusPhone" class="form-input" value="' + escapeHtml(c.phone || '') + '" style="margin-bottom:12px;">' +
            '<label style="display:block;font-size:13px;font-weight:600;margin-bottom:4px;">Địa chỉ</label>' +
            '<input type="text" id="editCusAddress" class="form-input" value="' + escapeHtml(c.address || '') + '" style="margin-bottom:16px;">' +
            '<button class="btn-primary" style="width:100%;padding:10px;font-size:15px;" onclick="saveCustomerEdit(\'' + customerId + '\')">💾 Lưu thay đổi</button>' +
        '</div>' +
    '</div>';
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');
    
    // Focus vào ô tên
    setTimeout(function() {
        var nameInput = document.getElementById('editCusName');
        if (nameInput) nameInput.focus();
    }, 300);
}

function saveCustomerEdit(customerId) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return;
    
    var nameInput = document.getElementById('editCusName');
    var phoneInput = document.getElementById('editCusPhone');
    var addressInput = document.getElementById('editCusAddress');
    
    if (!nameInput) return;
    var name = nameInput.value.trim();
    if (!name) { showToast('❌ Tên không được để trống', 'error'); return; }
    var phone = phoneInput ? phoneInput.value.trim() : '';
    var address = addressInput ? addressInput.value.trim() : '';
    
    DB.update('customers', customerId, { name: name, phone: phone, address: address }).then(function() {
        c.name = name;
        c.phone = phone;
        c.address = address;
        closeModal('editCustomerModal');
        showToast('✅ Đã cập nhật thông tin khách', 'success');
        renderCustomerList();
        showCustomerDetail(customerId);
    }).catch(function(err) {
        showToast('❌ Lỗi cập nhật: ' + (err.message || ''), 'error');
    });
}

function deleteCustomer(customerId) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return;
    if (!confirm('⚠️ Xóa khách "' + c.name + '"?' + (c.totalDebt > 0 ? ' Khách đang trả sau ' + formatMoney(c.totalDebt) + '!' : ''))) return;
    DB.remove('customers', customerId).then(function() {
        for (var i = 0; i < customers.length; i++) {
            if (customers[i].id === customerId) { customers.splice(i, 1); break; }
        }
        closeModal('customerDetailModal');
        showToast('✅ Đã xóa khách ' + c.name, 'success');
        renderCustomerList();
    }).catch(function(err) {
        showToast('❌ Lỗi xóa: ' + (err.message || ''), 'error');
    });
}

// ========== IN / XUẤT PDF LỊCH SỬ TRẢ SAU ==========
function printCustomerDebtHistory(customerId, mode) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return;
    
    // Gom lịch sử (giống showCustomerDetail)
    var allTransactions = window.costTransactions || [];
    var all = [];
    if (c.debtHistory) {
        for (var i = 0; i < c.debtHistory.length; i++) {
            var debtEntry = c.debtHistory[i];
            var allItem = { type: 'debt', date: debtEntry.date, amount: debtEntry.amount, note: debtEntry.note, transactionId: null };
            if (debtEntry.items && debtEntry.items.length > 0) {
                allItem.items = debtEntry.items;
            }
            all.push(allItem);
        }
    }
    if (c.paymentHistory) {
        for (var i = 0; i < c.paymentHistory.length; i++) {
            all.push({ type: 'payment', date: c.paymentHistory[i].date, amount: c.paymentHistory[i].amount, note: c.paymentHistory[i].note, transactionId: null });
        }
    }
    if (c.creditHistory) {
        for (var i = 0; i < c.creditHistory.length; i++) {
            all.push({ type: 'credit', date: c.creditHistory[i].date, amount: c.creditHistory[i].amount, note: c.creditHistory[i].note, transactionId: null });
        }
    }
    // FIX: Thêm các giao dịch mới từ transactions collection
    for (var i = 0; i < allTransactions.length; i++) {
        var tx = allTransactions[i];
        if (tx.customer && tx.customer.id === customerId) {
            if (tx.type === 'prepaid' || tx.type === 'change_in' || tx.type === 'change_use') {
                all.push({
                    type: tx.type,
                    date: tx.createdAt || tx.date,
                    amount: tx.amount,
                    note: tx.note || '',
                    transactionId: tx.id,
                    items: tx.items || []
                });
            } else if (tx.type === 'debt_payment') {
                var txTime = new Date(tx.createdAt || tx.date).getTime();
                for (var j = 0; j < all.length; j++) {
                    var hTime = new Date(all[j].date).getTime();
                    if (Math.abs(txTime - hTime) < 60000 && all[j].transactionId === null) {
                        all[j].transactionId = tx.id;
                        all[j].items = tx.items || [];
                        break;
                    }
                }
            }
        }
    }
    all.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    
    // FIX: KHÔNG lọc bỏ credit - hiển thị tất cả giao dịch
    var filtered = all;
    
    // Tính dư nợ lũy kế (giống _renderCustomerHistoryHtml)
    var balances = {};
    var total = 0;
    for (var idx = filtered.length - 1; idx >= 0; idx--) {
        var hh = filtered[idx];
        if (hh.type === 'debt') { total += hh.amount; }
        else if (hh.type === 'payment') { total -= hh.amount; }
    }
    var accumulated = total;
    for (var idx = 0; idx < filtered.length; idx++) {
        var hh = filtered[idx];
        balances[idx] = accumulated;
        if (hh.type === 'debt') { accumulated -= hh.amount; }
        else if (hh.type === 'payment') { accumulated += hh.amount; }
    }
    
    // Format history data
    var shop = (typeof shopInfo !== 'undefined' && shopInfo) ? shopInfo : null;
    var now = new Date();
    var dateStr = ('0' + now.getDate()).slice(-2) + '/' + ('0' + (now.getMonth() + 1)).slice(-2) + '/' + now.getFullYear() + ' ' + ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
    
    var historyData = [];
    for (var i = 0; i < filtered.length; i++) {
        var h = filtered[i];
        var d = new Date(h.date);
        var ds = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
        historyData.push({
            type: h.type,
            dateStr: ds,
            amount: h.amount,
            note: h.note,
            items: h.items || [],
            balance: balances[i] || 0
        });
    }
    
    var printData = {
        storeName: shop ? shop.name : 'Hệ Thống Bán Hàng',
        storeAddress: shop ? shop.address : null,
        storePhone: shop ? shop.phone : null,
        customerName: c.name,
        customerPhone: c.phone || '',
        printDate: dateStr,
        history: historyData,
        totalDebt: c.totalDebt || 0,
        creditBalance: c.creditBalance || 0,
        prepaidBalance: c.prepaidBalance || 0,
        initialBalance: 0
    };
    
    // Tạo preview trước khi in
    _showPrintPreview(printData, mode);
}

// ========== PREVIEW TRƯỚC KHI IN ==========
function _showPrintPreview(printData, mode) {
    var modeLabel = (mode === 'thermal') ? '🖨️ In nhiệt' : '📄 Xuất PDF';
    var modeIcon = (mode === 'thermal') ? '🖨️' : '📄';
    
    // Tạo nội dung preview HTML
    var previewHtml = '';
    previewHtml += '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">';
    
    // Header
    previewHtml += '<div style="text-align:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid #1e293b;">';
    previewHtml += '<div style="font-size:16px;font-weight:700;color:#1e293b;">' + escapeHtml(printData.storeName) + '</div>';
    previewHtml += '<div style="font-size:13px;font-weight:600;color:#475569;margin-top:4px;">LỊCH SỬ TRẢ SAU</div>';
    previewHtml += '<div style="font-size:12px;color:#64748b;margin-top:4px;">Khách: <strong>' + escapeHtml(printData.customerName) + '</strong>';
    if (printData.customerPhone) previewHtml += ' | SDT: ' + escapeHtml(printData.customerPhone);
    previewHtml += '<br>Ngày in: ' + printData.printDate;
    previewHtml += '</div></div>';
    
    // Danh sách giao dịch
    if (printData.history && printData.history.length > 0) {
        for (var i = 0; i < printData.history.length; i++) {
            var h = printData.history[i];
            var balance = h.balance || 0;
            
            var label = '';
            var amountColor = '';
            var isCreditTx = false;
            if (h.type === 'debt') {
                label = 'Ghi trả sau';
                amountColor = '#dc2626';
            } else if (h.type === 'payment') {
                label = 'Thanh toán';
                amountColor = '#16a34a';
            } else if (h.type === 'credit' || h.type === 'change_in') {
                label = (h.amount >= 0) ? '💰 Tiền dư +' : '💰 Dùng tiền dư';
                amountColor = '#16a34a';
                isCreditTx = true;
            } else if (h.type === 'prepaid') {
                label = '💳 Đưa trước';
                amountColor = '#8b5cf6';
                isCreditTx = true;
            } else if (h.type === 'change_use') {
                label = '💰 Dùng tiền dư';
                amountColor = '#f59e0b';
                isCreditTx = true;
            }
            
            var balanceText = '';
            var balanceColor = '';
            if (balance > 0) {
                balanceText = formatMoney(balance);
                balanceColor = '#dc2626';
            } else if (balance < 0) {
                balanceText = 'Dư ' + formatMoney(Math.abs(balance));
                balanceColor = '#16a34a';
            } else {
                balanceText = '0đ';
                balanceColor = '#64748b';
            }
            
            previewHtml += '<div style="border-bottom:1px solid #e2e8f0;padding:8px 0;">';
            previewHtml += '<div style="font-size:12px;color:#64748b;margin-bottom:4px;">ngày ' + h.dateStr + '</div>';
            previewHtml += '<div style="display:flex;justify-content:space-between;align-items:center;">';
            previewHtml += '  <span style="font-size:14px;font-weight:600;color:' + amountColor + ';">' + label + ': ' + formatMoney(Math.abs(h.amount)) + '</span>';
            if (!isCreditTx) {
                previewHtml += '  <span style="font-size:14px;font-weight:700;color:' + balanceColor + ';">Tổng tiền: ' + balanceText + '</span>';
            }
            previewHtml += '</div>';
            
            if (h.note) {
                previewHtml += '<div style="font-size:11px;color:#64748b;margin-top:4px;">📝 ' + escapeHtml(h.note) + '</div>';
            }
            if (h.items && h.items.length > 0) {
                previewHtml += '<div style="font-size:11px;color:#666;margin:2px 0 4px 0;padding:4px 8px;background:#f8f9fa;border-radius:4px;">';
                for (var j = 0; j < h.items.length; j++) {
                    var it = h.items[j];
                    var itTotal = formatMoney((it.price || 0) * (it.qty || 1));
                    previewHtml += '<div style="display:flex;justify-content:space-between;padding:1px 0;">';
                    previewHtml += '<span>• ' + escapeHtml(it.name || '') + ' <span style="color:#999;">x' + (it.qty || 1) + '</span></span>';
                    previewHtml += '<span style="font-weight:500;">' + itTotal + '</span>';
                    previewHtml += '</div>';
                }
                previewHtml += '</div>';
            }
            previewHtml += '</div>';
        }
    } else {
        previewHtml += '<div style="text-align:center;padding:24px;color:#94a3b8;">Chưa có giao dịch</div>';
    }
    
    previewHtml += '</div>';
    
    // Tạo modal preview
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    
    var modalContent = document.createElement('div');
    modalContent.style.cssText = 'background:#fff;border-radius:12px;max-width:500px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    
    modalContent.innerHTML =
        '<div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;position:sticky;top:0;background:#fff;border-radius:12px 12px 0 0;z-index:1;">' +
        '  <span style="font-size:16px;font-weight:700;color:#1e293b;">' + modeIcon + ' Xem trước nội dung</span>' +
        '  <span onclick="this.closest(\'div[style]\').parentElement.remove()" style="font-size:20px;cursor:pointer;color:#94a3b8;padding:4px 8px;">&times;</span>' +
        '</div>' +
        '<div style="padding:16px 20px;">' + previewHtml + '</div>' +
        '<div style="padding:12px 20px;border-top:1px solid #e2e8f0;display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:0;background:#fff;border-radius:0 0 12px 12px;">' +
        '  <button id="previewCancelBtn" style="padding:10px 20px;font-size:14px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#475569;cursor:pointer;">Hủy</button>' +
        '  <button id="previewConfirmBtn" style="padding:10px 20px;font-size:14px;border:none;border-radius:8px;background:#1e293b;color:#fff;cursor:pointer;">' + modeLabel + '</button>' +
        '</div>';
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Xử lý nút Hủy
    document.getElementById('previewCancelBtn').onclick = function() {
        modal.remove();
    };
    
    // Xử lý nút Xác nhận in
    document.getElementById('previewConfirmBtn').onclick = function() {
        modal.remove();
        // Tiến hành in/xuất
        if (mode === 'thermal') {
            if (typeof printDebtHistoryThermal === 'function') {
                printDebtHistoryThermal(printData);
            } else {
                showToast('Chức năng in nhiệt chưa sẵn sàng', 'error');
            }
        } else if (mode === 'pdf') {
            if (typeof exportDebtHistoryPdf === 'function') {
                exportDebtHistoryPdf(printData);
            } else {
                showToast('Chức năng xuất PDF chưa sẵn sàng', 'error');
            }
        }
    };
    
    // Click outside to close
    modal.onclick = function(e) {
        if (e.target === modal) modal.remove();
    };
}

// ========== UI: FORM THÊM NỢ CŨ (ADMIN) ==========
function showAddOldDebtForm(customerId) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return;
    
    // Xóa modal cũ nếu có (tránh chồng modal)
    var oldModal = document.getElementById('addOldDebtModal');
    if (oldModal) oldModal.remove();
    
    // Tạo modal nhập liệu
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
    modal.id = 'addOldDebtModal';
    
    var today = new Date();
    var y = today.getFullYear();
    var m = ('0' + (today.getMonth() + 1)).slice(-2);
    var d = ('0' + today.getDate()).slice(-2);
    var dateStr = y + '-' + m + '-' + d;
    
    modal.innerHTML = '<div style="background:#fff;border-radius:12px;padding:24px;width:90%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">' +
        '<h3 style="margin:0 0 16px 0;font-size:18px;">➕ Thêm nợ cũ - ' + escapeHtml(c.name) + '</h3>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px;">Số tiền nợ (VNĐ)</label>' +
        '<input type="number" id="oldDebtAmount" class="cus-pay-input" value="0" step="1000" min="1000" style="width:100%;padding:10px;font-size:16px;border:2px solid #e2e8f0;border-radius:8px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px;">Ghi chú</label>' +
        '<input type="text" id="oldDebtNote" class="cus-pay-input" value="Nợ cũ" style="width:100%;padding:10px;font-size:14px;border:2px solid #e2e8f0;border-radius:8px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
        '<label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px;">Ngày phát sinh</label>' +
        '<input type="date" id="oldDebtDate" class="cus-pay-input" value="' + dateStr + '" style="width:100%;padding:10px;font-size:14px;border:2px solid #e2e8f0;border-radius:8px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button onclick="document.getElementById(\'addOldDebtModal\').remove()" style="flex:1;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;cursor:pointer;font-size:14px;">Hủy</button>' +
        '<button onclick="confirmAddOldDebt(\'' + customerId + '\')" style="flex:1;padding:10px;border:none;border-radius:8px;background:#f59e0b;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">✅ Xác nhận</button>' +
        '</div>' +
        '</div>';
    
    document.body.appendChild(modal);
    // Focus vào input số tiền
    setTimeout(function() { document.getElementById('oldDebtAmount').focus(); }, 100);
}

// Xác nhận thêm nợ cũ
function confirmAddOldDebt(customerId) {
    var amount = parseInt(document.getElementById('oldDebtAmount').value) || 0;
    var note = document.getElementById('oldDebtNote').value || 'Nợ cũ';
    var dateStr = document.getElementById('oldDebtDate').value || '';
    
    if (amount < 1000) {
        showToast('⚠️ Số tiền tối thiểu 1.000đ', 'warning');
        return;
    }
    
    var modal = document.getElementById('addOldDebtModal');
    if (modal) modal.remove();
    
    addOldDebt(customerId, amount, note, dateStr);
}

// ========== THÊM TIỀN KHÁCH ĐƯA TRƯỚC (ADMIN) ==========
// Khách đưa tiền trước (gối đầu) - ghi nhận như thanh toán, cộng vào doanh thu
// method: 'cash' hoặc 'transfer'
function showAddPrepaidForm(customerId) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return;
    
    // Xóa modal cũ nếu có
    var oldModal = document.getElementById('addPrepaidModal');
    if (oldModal) oldModal.remove();
    
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
    modal.id = 'addPrepaidModal';
    
    modal.innerHTML = '<div style="background:#fff;border-radius:12px;padding:24px;width:90%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">' +
        '<h3 style="margin:0 0 16px 0;font-size:18px;">💰 Thêm tiền đưa trước - ' + escapeHtml(c.name) + '</h3>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px;">Số tiền (VNĐ)</label>' +
        '<input type="number" id="prepaidAmount" class="cus-pay-input" value="0" step="1000" min="1000" style="width:100%;padding:10px;font-size:16px;border:2px solid #e2e8f0;border-radius:8px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px;">Ghi chú</label>' +
        '<input type="text" id="prepaidNote" class="cus-pay-input" value="Khách đưa trước" style="width:100%;padding:10px;font-size:14px;border:2px solid #e2e8f0;border-radius:8px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
        '<label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px;">Phương thức</label>' +
        '<div style="display:flex;gap:8px;">' +
        '<button id="prepaidMethodCash" onclick="document.getElementById(\'prepaidMethodCash\').classList.add(\'selected\');document.getElementById(\'prepaidMethodCash\').style.borderColor=\'#16a34a\';document.getElementById(\'prepaidMethodCash\').style.background=\'#f0fdf4\';document.getElementById(\'prepaidMethodTransfer\').classList.remove(\'selected\');document.getElementById(\'prepaidMethodTransfer\').style.borderColor=\'#e2e8f0\';document.getElementById(\'prepaidMethodTransfer\').style.background=\'#fff\';" style="flex:1;padding:10px;border:2px solid #e2e8f0;border-radius:8px;background:#fff;color:#333;cursor:pointer;font-size:14px;font-weight:600;">💰 Tiền mặt</button>' +
        '<button id="prepaidMethodTransfer" onclick="document.getElementById(\'prepaidMethodTransfer\').classList.add(\'selected\');document.getElementById(\'prepaidMethodTransfer\').style.borderColor=\'#16a34a\';document.getElementById(\'prepaidMethodTransfer\').style.background=\'#f0fdf4\';document.getElementById(\'prepaidMethodCash\').classList.remove(\'selected\');document.getElementById(\'prepaidMethodCash\').style.borderColor=\'#e2e8f0\';document.getElementById(\'prepaidMethodCash\').style.background=\'#fff\';" style="flex:1;padding:10px;border:2px solid #e2e8f0;border-radius:8px;background:#fff;color:#333;cursor:pointer;font-size:14px;font-weight:600;">💳 Chuyển khoản</button>' +
        '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button onclick="document.getElementById(\'addPrepaidModal\').remove()" style="flex:1;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;cursor:pointer;font-size:14px;">Hủy</button>' +
        '<button onclick="confirmAddPrepaid(\'' + customerId + '\')" style="flex:1;padding:10px;border:none;border-radius:8px;background:#16a34a;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">✅ Xác nhận</button>' +
        '</div>' +
        '</div>';
    
    document.body.appendChild(modal);
    // Mặc định chọn Tiền mặt
    setTimeout(function() {
        var cashBtn = document.getElementById('prepaidMethodCash');
        if (cashBtn) { cashBtn.classList.add('selected'); cashBtn.style.borderColor = '#16a34a'; cashBtn.style.background = '#f0fdf4'; }
        document.getElementById('prepaidAmount').focus();
    }, 100);
}

function confirmAddPrepaid(customerId) {
    var amount = parseInt(document.getElementById('prepaidAmount').value) || 0;
    var note = document.getElementById('prepaidNote').value || 'Khách đưa trước';
    
    // Xác định phương thức từ nút đang selected
    var cashBtn = document.getElementById('prepaidMethodCash');
    var isCash = cashBtn && cashBtn.classList.contains('selected');
    var method = isCash ? 'cash' : 'transfer';
    var methodLabel = isCash ? 'Tiền mặt' : 'Chuyển khoản';
    
    if (amount < 1000) {
        showToast('⚠️ Số tiền tối thiểu 1.000đ', 'warning');
        return;
    }
    
    var modal = document.getElementById('addPrepaidModal');
    if (modal) modal.remove();
    
    // Tìm customer trong memory cache
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) { showToast('⚠️ Không tìm thấy khách hàng', 'error'); return; }
    
    // FIX: Dùng prepaidBalance riêng thay vì creditBalance chung
    // Ghi nhận tiền đưa trước:
    // 1. Cộng vào prepaidBalance (tiền đưa trước) của khách
    // 2. Ghi vào creditHistory (giữ để tương thích)
    // 3. Ghi addHistory với type='prepaid' (riêng biệt)
    // 4. Nếu là TM, gọi handleCashPayment để ghi vào két
    
    c.prepaidBalance = (c.prepaidBalance || 0) + amount;
    c.creditBalance = (c.creditBalance || 0) + amount; // Giữ tương thích
    c.creditHistory = c.creditHistory || [];
    var now = new Date();
    c.creditHistory.unshift({ id: Date.now(), date: now.toISOString(), amount: amount, note: 'Khách đưa trước: ' + note + ' (' + methodLabel + ')' });
    
    DB.update('customers', customerId, {
        prepaidBalance: c.prepaidBalance,
        creditBalance: c.creditBalance,
        creditHistory: c.creditHistory
    }).then(function() {
        // FIX: Dùng type 'prepaid' riêng thay vì 'debt_payment'
        return addHistory({
            type: 'prepaid',
            amount: amount,
            paymentMethod: method,
            items: [],
            customer: { id: c.id, name: c.name },
            note: 'Khách đưa trước: ' + note + ' (' + methodLabel + ')'
        });
    }).then(function() {
        // Nếu là tiền mặt, ghi vào két
        if (method === 'cash') {
            if (typeof handleCashPayment === 'function') {
                handleCashPayment(amount, null, {type: 'prepaid', tableName: null, customer: {id: c.id, name: c.name}}).catch(function(err) {
                    console.error('[AUDIT] handleCashPayment lỗi:', err);
                });
            }
        }
        
        // Gửi thông báo Telegram
        if (typeof notifyPaymentToTelegram === 'function') {
            notifyPaymentToTelegram({
                type: 'prepaid',
                amount: amount,
                paymentMethod: method,
                items: [],
                tableName: null,
                customer: { id: c.id, name: c.name },
                createdAt: now.toISOString()
            });
        }
        
        showToast('✅ Đã ghi nhận ' + formatMoney(amount) + ' tiền đưa trước (' + methodLabel + ')', 'success');
        renderCustomerList();
        showCustomerDetail(customerId);
    }).catch(function(err) {
        showToast('❌ Lỗi: ' + (err.message || err), 'error');
    });
}

// ========== UI: FORM SỬA KHOẢN NỢ (ADMIN) ==========
function editDebtEntryUI(customerId, debtIndex) {
    // Xóa modal cũ nếu có (tránh chồng modal - fix lỗi "mở sửa khách A hiển thị khách B")
    var oldModal = document.getElementById('editDebtModal');
    if (oldModal) oldModal.remove();
    
    // Tìm customer trong memory cache
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) { showToast('⚠️ Không tìm thấy khách hàng', 'error'); return; }
    
    // Đảm bảo debtHistory là array
    var debtHistory = c.debtHistory || [];
    // Nếu debtIndex là string (từ data attribute), chuyển về number
    if (typeof debtIndex === 'string') debtIndex = parseInt(debtIndex, 10);
    if (isNaN(debtIndex) || debtIndex < 0 || debtIndex >= debtHistory.length) {
        showToast('⚠️ Không tìm thấy khoản nợ', 'error');
        return;
    }
    var entry = debtHistory[debtIndex];
    
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;';
    modal.id = 'editDebtModal';
    
    modal.innerHTML = '<div style="background:#fff;border-radius:12px;padding:24px;width:90%;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">' +
        '<h3 style="margin:0 0 16px 0;font-size:18px;">✏️ Sửa khoản nợ - ' + escapeHtml(c.name) + '</h3>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px;">Số tiền nợ (VNĐ)</label>' +
        '<input type="number" id="editDebtAmount" class="cus-pay-input" value="' + entry.amount + '" step="1000" min="1000" style="width:100%;padding:10px;font-size:16px;border:2px solid #e2e8f0;border-radius:8px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
        '<label style="display:block;font-size:13px;color:#64748b;margin-bottom:4px;">Ghi chú</label>' +
        '<input type="text" id="editDebtNote" class="cus-pay-input" value="' + escapeHtml(entry.note || '') + '" style="width:100%;padding:10px;font-size:14px;border:2px solid #e2e8f0;border-radius:8px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
        '<button onclick="document.getElementById(\'editDebtModal\').remove()" style="flex:1;padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#64748b;cursor:pointer;font-size:14px;">Hủy</button>' +
        '<button onclick="confirmEditDebt(\'' + customerId + '\',' + debtIndex + ')" style="flex:1;padding:10px;border:none;border-radius:8px;background:#f59e0b;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">✅ Lưu</button>' +
        '</div>' +
        '</div>';
    
    document.body.appendChild(modal);
    setTimeout(function() { document.getElementById('editDebtAmount').focus(); }, 100);
}

// Xác nhận sửa nợ
function confirmEditDebt(customerId, debtIndex) {
    var newAmount = parseInt(document.getElementById('editDebtAmount').value) || 0;
    var newNote = document.getElementById('editDebtNote').value || '';
    
    if (newAmount < 1000) {
        showToast('⚠️ Số tiền tối thiểu 1.000đ', 'warning');
        return;
    }
    
    var modal = document.getElementById('editDebtModal');
    if (modal) modal.remove();
    
    editDebtEntry(customerId, debtIndex, newAmount, newNote);
}

// ========== MIGRATION: GỘP changeBalance VÀO prepaidBalance ==========
// Hàm này migrate dữ liệu cũ: nếu customer có changeBalance > 0 thì cộng vào prepaidBalance
// và xoá changeBalance. Gọi sau khi load customers từ DB.
function _migrateCustomerChangeBalance() {
    if (!customers) return;
    var changed = false;
    for (var i = 0; i < customers.length; i++) {
        var c = customers[i];
        var oldChange = c.changeBalance || 0;
        if (oldChange > 0) {
            c.prepaidBalance = (c.prepaidBalance || 0) + oldChange;
            c.creditBalance = c.prepaidBalance;
            delete c.changeBalance;
            changed = true;
        }
        // Đảm bảo creditBalance luôn đồng bộ với prepaidBalance
        if (c.prepaidBalance) {
            c.creditBalance = c.prepaidBalance;
        }
    }
    if (changed) {
        console.log('[MIGRATE] Đã gộp changeBalance vào prepaidBalance cho ' + customers.length + ' khách hàng');
    }
}

// Export global
window.showCustomerDetail = showCustomerDetail;
window.printCustomerDebtHistory = printCustomerDebtHistory;
window.confirmInlineDebtPayment = confirmInlineDebtPayment;
window.toggleCustomerHistory = toggleCustomerHistory;
window.selectCustomer = selectCustomer;
window.quickAddCustomer = quickAddCustomer;
window.addCustomerCredit = addCustomerCredit;
window.useCustomerCredit = useCustomerCredit;
window.editCustomerInfo = editCustomerInfo;
window.saveCustomerEdit = saveCustomerEdit;
window.deleteCustomer = deleteCustomer;
window.addOldDebt = addOldDebt;
window.showAddOldDebtForm = showAddOldDebtForm;
window.confirmAddOldDebt = confirmAddOldDebt;
window.editDebtEntry = editDebtEntry;
window.editDebtEntryUI = editDebtEntryUI;
window.confirmEditDebt = confirmEditDebt;
window.deleteDebtEntry = deleteDebtEntry;
window.showAddPrepaidForm = showAddPrepaidForm;
window.confirmAddPrepaid = confirmAddPrepaid;
window._migrateCustomerChangeBalance = _migrateCustomerChangeBalance;