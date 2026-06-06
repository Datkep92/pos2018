// customers.js - Khách hàng, công nợ, chọn khách
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== KHÁCH HÀNG ==========
function renderCustomerList() {
    DB.getAll('customers').then(function(custs) {
        customers = custs;
        var keyword = document.getElementById('customerSearchInput') ? document.getElementById('customerSearchInput').value.toLowerCase() : '';
        var filtered = keyword ? customers.filter(function(c) { return c.name.toLowerCase().indexOf(keyword) !== -1 || (c.phone && c.phone.indexOf(keyword) !== -1); }) : customers;
        var totalDebt = 0;
        for (var i = 0; i < filtered.length; i++) totalDebt += (filtered[i].totalDebt || 0);
        document.getElementById('totalDebtAmount').innerText = formatMoney(totalDebt);
        var container = document.getElementById('customerList');
        if (!container) return;
        if (!filtered.length) { container.innerHTML = '<div class="empty-state">📭 Không có khách hàng</div>'; return; }
        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            var c = filtered[i];
            html += '<div class="customer-card" onclick="showCustomerDetail(\'' + c.id + '\')"><div class="customer-avatar">' + c.name.charAt(0).toUpperCase() + '</div><div class="customer-info"><div class="customer-name">' + escapeHtml(c.name) + '</div><div class="customer-phone">📞 ' + (c.phone || '') + '</div></div><div class="customer-debt">' + ((c.totalDebt || 0) > 0 ? formatMoney(c.totalDebt) : '✅') + '</div></div>';
        }
        container.innerHTML = html;
    });
}

function quickAddCustomer() {
    var name = prompt('👤 Nhập tên khách hàng:');
    if (!name) return;
    for (var i = 0; i < customers.length; i++) {
        if (customers[i].name.toLowerCase() === name.toLowerCase()) { showToast('Khách đã tồn tại!', 'warning'); return; }
    }
    addCustomer(name, '').then(function() {
        if (document.getElementById('customerSearchInput')) document.getElementById('customerSearchInput').value = '';
        renderCustomerList();
        showToast('✅ Đã thêm khách ' + name, 'success');
    });
}

function addCustomer(name, phone) {
    var newId = Date.now().toString() + Math.random().toString(36).substr(2, 6);
    var newCustomer = { id: newId, name: name.trim(), phone: phone || '', address: '', totalDebt: 0, totalSpent: 0, createdAt: new Date().toISOString(), debtHistory: [], paymentHistory: [] };
    return DB.create('customers', newCustomer).then(function() {
        customers.push(newCustomer);
        return newCustomer;
    });
}

function showCustomerDetail(customerId) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return;
    var historyHtml = '';
    var all = [];
    if (c.debtHistory) {
        for (var i = 0; i < c.debtHistory.length; i++) all.push({ type: 'debt', date: c.debtHistory[i].date, amount: c.debtHistory[i].amount, note: c.debtHistory[i].note });
    }
    if (c.paymentHistory) {
        for (var i = 0; i < c.paymentHistory.length; i++) all.push({ type: 'payment', date: c.paymentHistory[i].date, amount: c.paymentHistory[i].amount, note: c.paymentHistory[i].note });
    }
    all.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    for (var i = 0; i < all.length; i++) {
        var h = all[i];
        var amountClass = h.type === 'debt' ? 'var(--danger)' : 'var(--success)';
        var sign = h.type === 'debt' ? '-' : '+';
        historyHtml += '<div class="cart-item"><span>' + new Date(h.date).toLocaleString('vi-VN') + '</span><span style="color:' + amountClass + '">' + sign + formatMoney(h.amount) + '</span></div><div style="font-size:11px; margin-bottom:8px;">📝 ' + escapeHtml(h.note || '') + '</div>';
    }
    var content = document.getElementById('customerDetailContent');
    if (!content) return;
    // Lưu customerId vào data attribute để realtime có thể cập nhật lại
    content.setAttribute('data-customer-id', customerId);
    content.innerHTML = '<div class="debt-summary" style="margin-bottom:16px;"><span>💰 Công nợ</span><span style="color:#ef4444; font-size:20px;">' + formatMoney(c.totalDebt || 0) + '</span></div>' + ((c.totalDebt || 0) > 0 ? '<button class="btn-save" onclick="openDebtPayment(\'' + c.id + '\', ' + (c.totalDebt || 0) + ')" style="margin-bottom:16px;">💸 Thanh toán nợ</button>' : '') + '<div class="cost-history-title">📜 Lịch sử</div>' + (historyHtml || '<div class="empty-state">Chưa có giao dịch</div>');
    document.getElementById('customerDetailModal').style.display = 'flex';
}

function openDebtPayment(customerId, currentDebt) {
    for (var i = 0; i < customers.length; i++) {
        if (customers[i].id === customerId) {
            document.getElementById('debtPaymentInfo').innerHTML = '💰 Khách: ' + customers[i].name + '<br>💢 Nợ: ' + formatMoney(currentDebt);
            break;
        }
    }
    document.getElementById('debtPaymentAmount').value = currentDebt;
    document.getElementById('debtPaymentModal').style.display = 'flex';
    pendingDebtCustomerId = customerId;
}

function confirmDebtPayment() {
    var amount = parseInt(document.getElementById('debtPaymentAmount').value) || 0;
    if (amount <= 0) { showToast('Số tiền không hợp lệ!', 'warning'); return; }
    var customer = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === pendingDebtCustomerId) { customer = customers[i]; break; } }
    if (!customer) return;
    var payment = Math.min(amount, customer.totalDebt || 0);
    customer.totalDebt = (customer.totalDebt || 0) - payment;
    customer.paymentHistory = customer.paymentHistory || [];
    customer.paymentHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: payment, method: 'cash', note: 'Thanh toán nợ ' + formatMoney(payment) });
    DB.update('customers', customer.id, { totalDebt: customer.totalDebt, paymentHistory: customer.paymentHistory }).then(function() {
        return addHistory({ type: 'debt_payment', amount: payment, paymentMethod: 'cash', customer: { id: customer.id, name: customer.name }, note: 'Thanh toán nợ' });
    }).then(function() {
        return DB.getAll('customers');
    }).then(function(newCusts) {
        customers = newCusts;
        showToast('✅ Đã thanh toán ' + formatMoney(payment), 'success');
        closeModal('debtPaymentModal');
        renderCustomerList();
        showCustomerDetail(customer.id);
    });
}

function addCustomerDebt(customerId, amount, note) {
    var c = null;
    for (var i = 0; i < customers.length; i++) { if (customers[i].id === customerId) { c = customers[i]; break; } }
    if (!c) return Promise.resolve();
    c.totalDebt = (c.totalDebt || 0) + amount;
    c.debtHistory = c.debtHistory || [];
    c.debtHistory.unshift({ id: Date.now(), date: new Date().toISOString(), amount: amount, note: note, status: 'unpaid' });
    return DB.update('customers', customerId, { totalDebt: c.totalDebt, debtHistory: c.debtHistory }).then(function() {
        return DB.getAll('customers').then(function(newCusts) { customers = newCusts; });
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
        var debtText = (c.totalDebt || 0) > 0 ? ' - Nợ: ' + formatMoney(c.totalDebt) : '';
        html += '<div class="customer-select-item" onclick="selectCustomer(\'' + c.id + '\')"><div class="customer-avatar" style="width:36px;height:36px;">' + c.name.charAt(0).toUpperCase() + '</div><div><div style="font-weight:600;">' + escapeHtml(c.name) + '</div><div style="font-size:11px;">' + (c.phone || '') + debtText + '</div></div></div>';
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

// Export global
window.showCustomerDetail = showCustomerDetail;
window.openDebtPayment = openDebtPayment;
window.confirmDebtPayment = confirmDebtPayment;
window.selectCustomer = selectCustomer;
window.quickAddCustomer = quickAddCustomer;
