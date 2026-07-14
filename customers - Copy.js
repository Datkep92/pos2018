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
    return latest;
}

// ========== KHÁCH HÀNG ==========
function renderCustomerList() {
    // Dùng memory cache, không query DB
    var keyword = document.getElementById('customerSearchInput') ? document.getElementById('customerSearchInput').value.toLowerCase() : '';
    var filtered = keyword ? customers.filter(function(c) { return c.name.toLowerCase().indexOf(keyword) !== -1 || (c.phone && c.phone.indexOf(keyword) !== -1); }) : customers;
    // Tính tổng công nợ thực tế = tổng số dư âm (totalDebt - creditBalance)
    var totalDebt = 0;
    for (var i = 0; i < filtered.length; i++) {
        var net = (filtered[i].totalDebt || 0) - (filtered[i].creditBalance || 0);
        if (net > 0) totalDebt += net;
    }
    document.getElementById('totalDebtAmount').innerText = formatMoney(totalDebt);
    var container = document.getElementById('customerList');
    if (!container) return;
    if (!filtered.length) { container.innerHTML = '<div class="empty-state">📭 Không có khách hàng</div>'; return; }
    // Sắp xếp: khách có giao dịch ghi nợ/thanh toán lên đầu, theo thời gian gần nhất
    filtered.sort(function(a, b) {
        // Lấy thời gian giao dịch gần nhất của mỗi khách (từ debtHistory, paymentHistory, creditHistory)
        var aLatest = _getLatestActivityTime(a);
        var bLatest = _getLatestActivityTime(b);
        // Khách có giao dịch (aLatest > 0) được ưu tiên lên trước khách không có giao dịch
        var aHasActivity = aLatest > 0;
        var bHasActivity = bLatest > 0;
        if (aHasActivity && !bHasActivity) return -1;
        if (!aHasActivity && bHasActivity) return 1;
        // Nếu cả 2 đều có giao dịch, khách có giao dịch gần hơn lên trước
        if (aHasActivity && bHasActivity) {
            if (bLatest !== aLatest) return bLatest - aLatest;
        }
        // Cùng cấp: khách có nợ (netBalance < 0) lên trước
        var debtA = (a.totalDebt || 0) - (a.creditBalance || 0);
        var debtB = (b.totalDebt || 0) - (b.creditBalance || 0);
        if (debtA > 0 && debtB <= 0) return -1;
        if (debtB > 0 && debtA <= 0) return 1;
        return 0;
    });
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
    
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var c = filtered[i];
        var netBalance = (c.creditBalance || 0) - (c.totalDebt || 0);
        
        // Tính nợ hôm nay từ debtHistory
        var todayDebt = 0;
        if (todayStr && c.debtHistory) {
            for (var d = 0; d < c.debtHistory.length; d++) {
                var entry = c.debtHistory[d];
                if (_isTodayEntry(entry)) {
                    todayDebt += entry.amount || 0;
                }
            }
        }
        // Tính thanh toán hôm nay từ paymentHistory
        var todayPayment = 0;
        if (todayStr && c.paymentHistory) {
            for (var d = 0; d < c.paymentHistory.length; d++) {
                var entry = c.paymentHistory[d];
                if (_isTodayEntry(entry)) {
                    todayPayment += entry.amount || 0;
                }
            }
        }
        var oldDebt = (c.totalDebt || 0) - todayDebt + todayPayment;
        
        // Tính tiền dư hôm nay từ creditHistory
        var todayCredit = 0; // tiền dư thêm hôm nay (số dương)
        var todayUsed = 0;   // tiền dư đã dùng hôm nay (số âm)
        if (todayStr && c.creditHistory) {
            for (var d = 0; d < c.creditHistory.length; d++) {
                var entry = c.creditHistory[d];
                if (_isTodayEntry(entry)) {
                    var amt = entry.amount || 0;
                    if (amt > 0) todayCredit += amt;
                    else todayUsed += amt; // số âm
                }
            }
        }
        var oldCredit = (c.creditBalance || 0) - todayCredit - todayUsed; // todayUsed là số âm, trừ todayUsed = cộng
        
        var balanceHtml = '';
        if (netBalance > 0) {
            var totalCreditVal = c.creditBalance || 0;
            if (todayCredit > 0 && todayUsed < 0) {
                // Vừa thêm tiền dư vừa dùng tiền dư trong cùng ngày
                var creditParts = '';
                if (oldCredit > 0) {
                    creditParts += '<span style="color:#64748b;">' + formatMoney(oldCredit) + '</span> +';
                }
                creditParts += '<span style="color:#16a34a;font-weight:700;">' + formatMoney(todayCredit) + '</span>' +
                    ' -<span style="color:#f97316;font-weight:700;">' + formatMoney(Math.abs(todayUsed)) + '</span>' +
                    ' = <span style="color:#16a34a;font-weight:700;">+' + formatMoney(totalCreditVal) + '</span>';
                balanceHtml = '<div style="font-size:11px;line-height:1.4;text-align:right;">' + creditParts + '</div>';
            } else if (todayCredit > 0) {
                // Chỉ thêm tiền dư hôm nay
                var creditParts = '';
                if (oldCredit > 0) {
                    creditParts += '<span style="color:#64748b;">' + formatMoney(oldCredit) + '</span> +';
                }
                creditParts += '<span style="color:#16a34a;font-weight:700;">' + formatMoney(todayCredit) + '</span>' +
                    ' = <span style="color:#16a34a;font-weight:700;">+' + formatMoney(totalCreditVal) + '</span>';
                balanceHtml = '<div style="font-size:11px;line-height:1.4;text-align:right;">' + creditParts + '</div>';
            } else if (todayUsed < 0) {
                // Chỉ dùng tiền dư hôm nay
                var creditParts = '';
                if (oldCredit > 0) {
                    creditParts += '<span style="color:#64748b;">' + formatMoney(oldCredit) + '</span> -';
                } else {
                    creditParts += '0 -';
                }
                creditParts += '<span style="color:#f97316;font-weight:700;">' + formatMoney(Math.abs(todayUsed)) + '</span>' +
                    ' = <span style="color:#16a34a;font-weight:700;">+' + formatMoney(totalCreditVal) + '</span>';
                balanceHtml = '<div style="font-size:11px;line-height:1.4;text-align:right;">' + creditParts + '</div>';
            } else {
                balanceHtml = '<span style="color:#16a34a;">+' + formatMoney(netBalance) + '</span>';
            }
        } else if (netBalance < 0) {
            var totalDebtVal = c.totalDebt || 0;
            // Nếu có trả sau mới hôm nay: hiển thị dạng "Cũ + Mới = Tổng"
            if (todayDebt > 0 && todayPayment > 0) {
                // Vừa ghi trả sau vừa thanh toán trong cùng ngày
                balanceHtml = '<div style="font-size:11px;line-height:1.4;text-align:right;">' +
                    '<span style="color:#64748b;">' + formatMoney(oldDebt) + '</span>' +
                    ' +<span style="color:#f97316;font-weight:700;">' + formatMoney(todayDebt) + '</span>' +
                    ' -<span style="color:#16a34a;font-weight:700;">' + formatMoney(todayPayment) + '</span>' +
                    ' = <span style="color:#ef4444;font-weight:700;">' + formatMoney(totalDebtVal) + '</span>' +
                    '</div>';
            } else if (todayDebt > 0) {
                balanceHtml = '<div style="font-size:11px;line-height:1.4;text-align:right;">' +
                    '<span style="color:#64748b;">' + formatMoney(oldDebt) + '</span>' +
                    ' + <span style="color:#f97316;font-weight:700;">' + formatMoney(todayDebt) + '</span>' +
                    ' = <span style="color:#ef4444;font-weight:700;">' + formatMoney(totalDebtVal) + '</span>' +
                    '</div>';
            } else if (todayPayment > 0) {
                // Chỉ thanh toán hôm nay, không ghi trả sau mới
                balanceHtml = '<div style="font-size:11px;line-height:1.4;text-align:right;">' +
                    '<span style="color:#64748b;">' + formatMoney(oldDebt) + '</span>' +
                    ' - <span style="color:#16a34a;font-weight:700;">' + formatMoney(todayPayment) + '</span>' +
                    ' = <span style="color:#ef4444;font-weight:700;">' + formatMoney(totalDebtVal) + '</span>' +
                    '</div>';
            } else {
                balanceHtml = '<span style="color:#ef4444;">-' + formatMoney(Math.abs(netBalance)) + '</span>';
            }
        } else {
            balanceHtml = '✅';
        }
        html += '<div class="customer-card" onclick="showCustomerDetail(\'' + c.id + '\')"><div class="customer-avatar">' + c.name.charAt(0).toUpperCase() + '</div><div class="customer-info"><div class="customer-name">' + escapeHtml(c.name) + '</div><div class="customer-phone">📞 ' + (c.phone || '') + '</div></div><div class="customer-debt">' + balanceHtml + '</div></div>';
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
    var newCustomer = { id: newId, name: name.trim(), phone: phone || '', address: '', totalDebt: 0, totalSpent: 0, creditBalance: 0, createdAt: new Date().toISOString(), debtHistory: [], paymentHistory: [], creditHistory: [] };
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
    
    var historyHtml = _renderCustomerHistoryHtml(all, false, customerId);
    var hasMore = all.length > 5;
    
    var content = document.getElementById('customerDetailContent');
    if (!content) return;
    content.setAttribute('data-customer-id', customerId);
    
    var netBalance = (c.creditBalance || 0) - (c.totalDebt || 0);
    var balanceColor = netBalance >= 0 ? '#16a34a' : '#ef4444';
    var showPayBtn = netBalance < 0;
    var debtForPayment = Math.abs(netBalance);
    
    var titleEl = document.getElementById('customerDetailTitle');
    if (titleEl) titleEl.innerHTML = '👤 ' + escapeHtml(c.name);
    var balanceEl = document.getElementById('customerDetailBalance');
    if (balanceEl) {
        if (netBalance !== 0) {
            balanceEl.innerHTML = (netBalance > 0 ? '💰 +' : '💢 ') + formatMoney(Math.abs(netBalance));
            balanceEl.style.color = balanceColor;
            balanceEl.style.display = 'inline-block';
        } else {
            balanceEl.style.display = 'none';
        }
    }
    
    var leftHtml = '';
    if (showPayBtn) {
        leftHtml = '<div class="cus-pay-inline"><input type="number" id="inlineDebtAmount" class="cus-pay-input" value="' + debtForPayment + '" step="1000" placeholder="Số tiền"><div class="cus-pay-btns"><button class="cus-pay-btn cus-pay-cash" onclick="confirmInlineDebtPayment(\'' + c.id + '\',\'cash\')">💰 TM</button><button class="cus-pay-btn cus-pay-transfer" onclick="confirmInlineDebtPayment(\'' + c.id + '\',\'transfer\')">💳 CK</button></div></div>';
    }
    if (DB.isAdmin && DB.isAdmin()) {
        leftHtml += '<div class="cus-admin-actions">' +
            '<button class="cus-edit-btn" onclick="editCustomerInfo(\'' + c.id + '\')">✏️ Sửa</button>' +
            '<button class="cus-delete-btn" onclick="deleteCustomer(\'' + c.id + '\')">🗑️ Xóa</button>' +
            '</div>' +
            '<div class="cus-admin-actions" style="margin-top:6px;">' +
            '<button class="cus-add-debt-btn" onclick="showAddOldDebtForm(\'' + c.id + '\')" style="padding:8px 12px;font-size:13px;border:none;border-radius:6px;background:#f59e0b;color:#fff;cursor:pointer;width:100%;">➕ Thêm nợ cũ</button>' +
            '</div>';
    }
    
    var rightHtml = '<div class="cus-history-title">📜 Lịch sử <span style="font-size:12px;font-weight:normal;color:#64748b;">(' + all.length + ' giao dịch)</span></div>' +
        '<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">' +
        '<button class="cus-print-btn" onclick="printCustomerDebtHistory(\'' + c.id + '\',\'thermal\')" style="padding:6px 10px;font-size:12px;border:none;border-radius:6px;background:#1e293b;color:#fff;cursor:pointer;">🖨️ In nhiệt</button>' +
        '<button class="cus-pdf-btn" onclick="printCustomerDebtHistory(\'' + c.id + '\',\'pdf\')" style="padding:6px 10px;font-size:12px;border:none;border-radius:6px;background:#ef4444;color:#fff;cursor:pointer;">📄 Xuất PDF</button>' +
        '</div>' +
        '<div id="customerHistoryList">' + (historyHtml || '<div class="empty-state">Chưa có giao dịch</div>') + '</div>' + (hasMore ? '<button class="cus-expand-btn" id="btnExpandHistory" onclick="toggleCustomerHistory(\'' + c.id + '\')">📋 Xem thêm</button>' : '');
    
    content.innerHTML = '<div class="cus-detail-layout"><div class="cus-detail-left">' + leftHtml + '</div><div class="cus-detail-right">' + rightHtml + '</div></div>';
    document.getElementById('customerDetailModal').style.display = 'flex';
}

// Render danh sách lịch sử, nếu expanded=false chỉ lấy 5 cái đầu
// customerId được truyền trực tiếp từ nơi gọi, không đọc từ DOM (tránh sai lệch)
function _renderCustomerHistoryHtml(all, expanded, customerId) {
    var html = '';
    var isAdmin = DB.isAdmin && DB.isAdmin();
    
    // Lọc: chỉ hiển thị debt và payment, bỏ credit (vì credit đã được gộp vào payment)
    var filtered = [];
    for (var idx = 0; idx < all.length; idx++) {
        if (all[idx].type !== 'credit') {
            filtered.push(all[idx]);
        }
    }
    
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
        
        // Xác định nhãn và số tiền
        var label = '';
        var amountColor = '';
        if (h.type === 'debt') {
            label = 'Ghi trả sau';
            amountColor = '#dc2626';
        } else if (h.type === 'payment') {
            label = 'Thanh toán';
            amountColor = '#16a34a';
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
        
        // Dòng 2: Loại giao dịch | Tổng nợ
        html += '<div style="display:flex;justify-content:space-between;align-items:center;">';
        html += '  <span style="font-size:14px;font-weight:600;color:' + amountColor + ';">' + label + ': ' + formatMoney(h.amount) + '</span>';
        html += '  <span style="font-size:14px;font-weight:700;color:' + balanceColor + ';">Tổng tiền: ' + balanceText + '</span>';
        html += '</div>';
        
        // Ghi chú + items
        if (h.note) {
            html += '<div style="font-size:11px;color:#64748b;margin-top:4px;">📝 ' + escapeHtml(h.note) + '</div>';
        }
        html += itemsHtml;
        html += actionBtns;
        
        html += '</div>';
    }
    return html;
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
    
    var listEl = document.getElementById('customerHistoryList');
    var btnEl = document.getElementById('btnExpandHistory');
    if (listEl) {
        listEl.innerHTML = _renderCustomerHistoryHtml(all, _customerHistoryExpanded, customerId) || '<div class="empty-state">Chưa có giao dịch</div>';
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
    var creditBalance = customer.creditBalance || 0;
    
    // Tự động trừ tiền dư trước khi thanh toán
    var creditUsed = 0;
    var actualPayment = amount; // số tiền thực tế khách đưa
    if (creditBalance > 0) {
        creditUsed = Math.min(creditBalance, amount);
        actualPayment = amount - creditUsed; // số tiền khách cần trả sau khi đã dùng tiền dư
        customer.creditBalance = creditBalance - creditUsed;
        customer.creditHistory = customer.creditHistory || [];
        customer.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: -creditUsed, note: 'Dùng tiền dư khi thanh toán trả sau' });
    }
    
    // Xử lý: nếu trả nhiều hơn số cần, phần dư thành credit
    var payment = Math.min(actualPayment, customer.totalDebt || 0);
    var overpay = actualPayment - payment;
    
    customer.totalDebt = (customer.totalDebt || 0) - payment;
    customer.paymentHistory = customer.paymentHistory || [];
    var now = new Date();
    var y = now.getFullYear();
    var m = ('0' + (now.getMonth() + 1)).slice(-2);
    var d = ('0' + now.getDate()).slice(-2);
    var dateKey = y + '-' + m + '-' + d;
    customer.paymentHistory.unshift({ id: Date.now(), date: now.toISOString(), dateKey: dateKey, amount: actualPayment, method: method, note: 'Thanh toán trả sau ' + formatMoney(actualPayment) + ' (' + methodLabel + ')' + (creditUsed > 0 ? ' (đã dùng ' + formatMoney(creditUsed) + ' tiền dư)' : '') });
    
    // Nếu có tiền dư (trả hơn số cần sau khi đã trừ credit), lưu thêm vào creditBalance
    if (overpay > 0) {
        customer.creditBalance = (customer.creditBalance || 0) + overpay;
        customer.creditHistory = customer.creditHistory || [];
        customer.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: overpay, note: 'Trả dư khi thanh toán trả sau +' + formatMoney(overpay) });
    }
    
    // OPTIMIZE: Cập nhật DB trước, không cần DB.getAll('transactions') để tìm items
    DB.update('customers', customer.id, {
        totalDebt: customer.totalDebt,
        paymentHistory: customer.paymentHistory,
        creditBalance: customer.creditBalance || 0,
        creditHistory: customer.creditHistory || []
    }).then(function() {
        var historyNote = 'Thanh toán trả sau (' + methodLabel + ')';
        if (creditUsed > 0) historyNote += ' (đã dùng ' + formatMoney(creditUsed) + ' tiền dư)';
        if (overpay > 0) historyNote += ' (dư ' + formatMoney(overpay) + ')';
        // FIX: Ghi actualPayment (tổng tiền khách đưa) thay vì payment (chỉ phần thanh toán)
        // vì tiền đã vào quỹ nên phải tính đủ doanh thu
        return addHistory({ type: 'debt_payment', amount: actualPayment, paymentMethod: method, items: [], customer: { id: customer.id, name: customer.name }, note: historyNote });
    }).then(function() {
        // AUDIT: Nếu thanh toán trả sau bằng tiền mặt, ghi nhận actualPayment (tổng tiền vào két)
        if (method === 'cash' && actualPayment > 0) {
            handleCashPayment(actualPayment, null, {type: 'debt_payment', tableName: null, customer: {id: customer.id, name: customer.name}}).catch(function(err) {
                console.error('[AUDIT] handleCashPayment lỗi:', err);
            });
        }
        
        // Gửi thông báo Telegram giao dịch thanh toán trả sau (cho tất cả phương thức)
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
        if (creditUsed > 0) msg += ', đã dùng ' + formatMoney(creditUsed) + ' tiền dư';
        if (overpay > 0) msg += ', dư ' + formatMoney(overpay) + ' làm tiền trả trước';
        showToast(msg, 'success');
        renderCustomerList();
        showCustomerDetail(customer.id);
    });
}

function addCustomerDebt(customerId, amount, note, items) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return Promise.resolve({ debtAmount: amount, creditUsed: 0 });
    
    // Tự động trừ creditBalance trước khi ghi trả sau
    var creditBalance = c.creditBalance || 0;
    var creditUsed = 0;
    var debtAmount = amount;
    
    if (creditBalance > 0) {
        creditUsed = Math.min(creditBalance, amount);
        debtAmount = amount - creditUsed;
        c.creditBalance = creditBalance - creditUsed;
        c.creditHistory = c.creditHistory || [];
        c.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: -creditUsed, note: 'Trừ tiền dư khi ghi trả sau: ' + note });
    }
    
    if (debtAmount > 0) {
        c.totalDebt = (c.totalDebt || 0) + debtAmount;
        c.debtHistory = c.debtHistory || [];
        // Lưu items vào debtHistory để hiển thị chi tiết mặt hàng trong tab khách hàng
        var now = new Date();
        var debtEntry = { id: Date.now(), date: now.toISOString(), amount: debtAmount, note: note, status: 'unpaid' };
        // Lưu dateKey (local date YYYY-MM-DD) để so sánh ngày chính xác, tránh lệch timezone
        var y = now.getFullYear();
        var m = ('0' + (now.getMonth() + 1)).slice(-2);
        var d = ('0' + now.getDate()).slice(-2);
        debtEntry.dateKey = y + '-' + m + '-' + d;
        if (items && items.length > 0) {
            debtEntry.items = items.map(function(it) { return { name: it.name, qty: it.qty, price: it.price }; });
        }
        c.debtHistory.unshift(debtEntry);
    }
    
    var updateData = { totalDebt: c.totalDebt || 0, debtHistory: c.debtHistory || [] };
    if (creditUsed > 0) {
        updateData.creditBalance = c.creditBalance;
        updateData.creditHistory = c.creditHistory;
    }
    return DB.update('customers', customerId, updateData).then(function() {
        // OPTIMIZE: Không cần DB.getAll('customers') - memory cache đã được cập nhật
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
    
    // Cập nhật totalDebt: trừ nợ cũ, cộng nợ mới
    c.totalDebt = (c.totalDebt || 0) - oldAmount + newAmount;
    entry.amount = newAmount;
    if (newNote !== undefined && newNote !== null) {
        entry.note = newNote;
    }
    
    return DB.update('customers', customerId, {
        totalDebt: c.totalDebt,
        debtHistory: debtHistory
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
    
    var removedAmount = debtHistory[debtIndex].amount;
    
    if (!confirm('🗑️ Xóa khoản nợ ' + formatMoney(removedAmount) + '?\nHành động này không thể hoàn tác!')) {
        return;
    }
    
    debtHistory.splice(debtIndex, 1);
    c.totalDebt = (c.totalDebt || 0) - removedAmount;
    if (c.totalDebt < 0) c.totalDebt = 0;
    
    return DB.update('customers', customerId, {
        totalDebt: c.totalDebt,
        debtHistory: debtHistory
    }).then(function() {
        showToast('✅ Đã xóa khoản nợ: ' + formatMoney(removedAmount), 'success');
        renderCustomerList();
        showCustomerDetail(customerId);
    });
}

// ========== CẬP NHẬT CREDIT CHO KHÁCH ==========
function addCustomerCredit(customerId, amount, note) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return Promise.resolve();
    c.creditBalance = (c.creditBalance || 0) + amount;
    c.creditHistory = c.creditHistory || [];
    c.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: amount, note: note });
    return DB.update('customers', customerId, { creditBalance: c.creditBalance, creditHistory: c.creditHistory }).then(function() {
        // OPTIMIZE: Không cần DB.getAll('customers') - memory cache đã được cập nhật
    });
}

function useCustomerCredit(customerId, amount, note) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return Promise.resolve(0);
    var used = Math.min(amount, c.creditBalance || 0);
    if (used <= 0) return Promise.resolve(0);
    c.creditBalance = (c.creditBalance || 0) - used;
    c.creditHistory = c.creditHistory || [];
    c.creditHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: -used, note: note });
    return DB.update('customers', customerId, { creditBalance: c.creditBalance, creditHistory: c.creditHistory }).then(function() {
        // OPTIMIZE: Không cần DB.getAll('customers') - memory cache đã được cập nhật
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
    var filtered = customers;
    if (searchTerm) {
        var lower = searchTerm.toLowerCase();
        filtered = customers.filter(function(c) { return c.name.toLowerCase().indexOf(lower) !== -1 || (c.phone && c.phone.indexOf(searchTerm) !== -1); });
    }
    var container = document.getElementById('customerSelectorList');
    if (!container) return;
    if (filtered.length === 0) { container.innerHTML = '<div class="empty-state">📭 Không tìm thấy khách</div>'; return; }
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var c = filtered[i];
        var netBalance = (c.creditBalance || 0) - (c.totalDebt || 0);
        var balanceClass = netBalance > 0 ? 'cus-grid-pos' : (netBalance < 0 ? 'cus-grid-neg' : '');
        var balanceText = '';
        if (netBalance > 0) {
            balanceText = '<span class="cus-grid-bal cus-grid-pos">+ ' + formatMoney(netBalance) + '</span>';
        } else if (netBalance < 0) {
            balanceText = '<span class="cus-grid-bal cus-grid-neg">- ' + formatMoney(Math.abs(netBalance)) + '</span>';
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
    // Map transactionId cho debt records
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
    
    // Lọc: chỉ lấy debt và payment, bỏ credit (giống _renderCustomerHistoryHtml)
    var filtered = [];
    for (var idx = 0; idx < all.length; idx++) {
        if (all[idx].type !== 'credit') {
            filtered.push(all[idx]);
        }
    }
    
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
        storeName: shop ? shop.name : 'MILANO COFFEE 259',
        storeAddress: shop ? shop.address : null,
        storePhone: shop ? shop.phone : null,
        customerName: c.name,
        customerPhone: c.phone || '',
        printDate: dateStr,
        history: historyData,
        totalDebt: c.totalDebt || 0,
        creditBalance: c.creditBalance || 0,
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
            if (h.type === 'debt') {
                label = 'Ghi trả sau';
                amountColor = '#dc2626';
            } else if (h.type === 'payment') {
                label = 'Thanh toán';
                amountColor = '#16a34a';
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
            previewHtml += '  <span style="font-size:14px;font-weight:600;color:' + amountColor + ';">' + label + ': ' + formatMoney(h.amount) + '</span>';
            previewHtml += '  <span style="font-size:14px;font-weight:700;color:' + balanceColor + ';">Tổng tiền: ' + balanceText + '</span>';
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