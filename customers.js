// ========== QUẢN LÝ KHÁCH HÀNG & CÔNG NỢ (ĐỒNG BỘ FIREBASE) ==========
let customerSearchDebounceTimer;
let mainSearchDebounceTimer;
// ========== HÀM TÍNH SỐ DƯ HIỆN TẠI (NỢ NẾU DƯƠNG, DƯ CÓ NẾU ÂM) ==========
function getCustomerBalance(customer) {
    const totalDebt = (customer.debtHistory || []).reduce((sum, d) => sum + (d.amount || 0), 0);
    const totalPayment = (customer.paymentHistory || []).reduce((sum, p) => sum + (p.amount || 0), 0);
    return totalDebt - totalPayment;
}
async function quickAddCustomer() {
    const name = document.getElementById('customerSearchInput').value.trim();
    if (!name) {
        showToast('Vui lòng nhập tên khách hàng vào ô tìm kiếm!', 'warning');
        return;
    }
    // Kiểm tra trùng tên (không phân biệt hoa thường)
    const existing = window.customers ? window.customers.find(c => c.name.toLowerCase() === name.toLowerCase()) : null;
    if (existing) {
        showToast(`Khách "${name}" đã tồn tại.`, 'error');
        return;
    }
    await addCustomer(name, '', '');
    document.getElementById('customerSearchInput').value = '';
    searchCustomerList();
    showToast(`✅ Đã thêm khách "${name}"`, 'success');
}

// Gắn sự kiện khi DOM sẵn sàng (đặt trong file script.js hoặc ở đây)
if (document.getElementById('quickAddCustomerBtn')) {
    document.getElementById('quickAddCustomerBtn').onclick = quickAddCustomer;
}


// ========== THANH TOÁN NỢ (CÓ THỂ TRẢ DƯ) ==========
async function payCustomerDebt(customerId, amount, method, note = '') {
    let customer = window.customers.find(c => c.id === customerId);
    if (!customer) return;
    customer = JSON.parse(JSON.stringify(customer));
    
    const currentBalance = getCustomerBalance(customer);
    let finalNote = note || `Thanh toán ${formatMoney(amount)} bằng ${method === 'cash' ? 'tiền mặt' : 'chuyển khoản'}`;
    
    customer.paymentHistory = customer.paymentHistory || [];
    customer.paymentHistory.unshift({
        id: Date.now(),
        date: new Date().toISOString(),
        amount: amount,
        method: method,
        note: finalNote
    });
    
    customer.totalDebt = getCustomerBalance(customer);
    
    await DB.update('customers', customerId, customer);
    window.customers = await DB.getAll('customers');
    
    if (typeof addHistory === 'function') {
        await addHistory({
            type: 'debt_payment',
            amount: amount,
            paymentMethod: method,
            customer: { id: customer.id, name: customer.name },
            note: finalNote
        });
    }
    
    showToast(`✅ Đã thanh toán ${formatMoney(amount)} cho khách ${customer.name}`, 'success');
    renderCustomerList();
    renderDebtList();
    if (document.getElementById('customerDetailModal').style.display === 'flex') {
        renderCustomerDetail(customerId);
    }
}

// ========== HIỂN THỊ CHI TIẾT KHÁCH (LỊCH SỬ MINH BẠCH) ==========
async function renderCustomerDetail(customerId) {
    const c = window.customers.find(c => c.id === customerId);
    if (!c) return;
    
    // Gom tất cả giao dịch
    let allTransactions = [];
    if (c.debtHistory) {
        c.debtHistory.forEach(d => {
            allTransactions.push({
                type: 'debt',
                date: d.date,
                amount: d.amount,
                note: d.note
            });
        });
    }
    if (c.paymentHistory) {
        c.paymentHistory.forEach(p => {
            allTransactions.push({
                type: 'payment',
                date: p.date,
                amount: p.amount,
                note: p.note
            });
        });
    }
    
    // Sắp xếp theo thời gian tăng dần (cũ lên đầu) để tính số dư lũy kế
    let sortedAsc = [...allTransactions].sort((a, b) => new Date(a.date) - new Date(b.date));
    let balance = 0;
    let txWithBalance = [];
    for (let tx of sortedAsc) {
        if (tx.type === 'debt') {
            balance += tx.amount;
        } else {
            balance -= tx.amount;
        }
        txWithBalance.push({
            ...tx,
            balance: balance
        });
    }
    // Đảo ngược để mới nhất lên đầu
    txWithBalance.reverse();
    
    let historyHtml = '';
    for (let tx of txWithBalance) {
        const dateStr = new Date(tx.date).toLocaleString('vi-VN');
        const amountClass = tx.type === 'debt' ? 'positive' : 'negative';
        const amountSign = tx.type === 'debt' ? '- ' : '+ ';
        const balanceValue = tx.balance;
        let balanceText = '';
        let balanceClass = '';
        if (balanceValue > 0) {
            balanceText = `Nợ: ${formatMoney(balanceValue)}`;
            balanceClass = 'debt';
        } else if (balanceValue < 0) {
            balanceText = `Dư có: ${formatMoney(-balanceValue)}`;
            balanceClass = 'credit';
        } else {
            balanceText = 'Không nợ';
            balanceClass = 'no-debt';
        }
        
        historyHtml += `
            <div class="tx-item">
                <div class="tx-header">
                    <span class="tx-date">${dateStr}</span>
                    <span class="tx-amount ${amountClass}">${amountSign}${formatMoney(tx.amount)}</span>
                </div>
                <div class="tx-note">${escapeHtml(tx.note)}</div>
                <div class="tx-balance ${balanceClass}">${balanceText}</div>
            </div>
        `;
    }
    
    if (allTransactions.length === 0) {
        historyHtml = '<div class="empty-state">Chưa có giao dịch</div>';
    }
    
    const currentBalance = getCustomerBalance(c);
    const balanceText = currentBalance > 0 ? `Nợ ${formatMoney(currentBalance)}` : (currentBalance < 0 ? `Dư có ${formatMoney(-currentBalance)}` : 'Không nợ');
    const container = document.getElementById('customerDetailContent');
    container.innerHTML = `
        <div class="debt-summary-simple">
            <div class="debt-total">${balanceText}</div>
            <div class="debt-label">Tổng kết</div>
        </div>
        <button class="btn-pay-simple" onclick="openPaymentForCustomer('${c.id}')">💸 Thanh toán</button>
        <div class="history-list-simple">
            ${historyHtml}
        </div>
        <button class="btn-close-simple" onclick="closeModal('customerDetailModal')">🔙 Đóng</button>
    `;
    document.getElementById('customerDetailModal').style.display = 'flex';
}

// ========== MỞ POPUP NHẬP SỐ TIỀN THANH TOÁN ==========
function openPaymentForCustomer(customerId) {
    const c = window.customers.find(c => c.id === customerId);
    if (!c) return;
    const currentBalance = getCustomerBalance(c);
    const message = currentBalance > 0 ? `Nợ ${formatMoney(currentBalance)}` : (currentBalance < 0 ? `Dư có ${formatMoney(-currentBalance)}` : 'Không nợ');
    const amount = prompt(`Nhập số tiền thanh toán cho ${c.name} (hiện tại: ${message}):`, currentBalance > 0 ? currentBalance : 0);
    if (!amount) return;
    const val = parseInt(amount);
    if (isNaN(val) || val <= 0) {
        showToast('Số tiền không hợp lệ', 'warning');
        return;
    }
    payCustomerDebt(customerId, val, 'cash');
}

function renderCustomerList() {
    const customers = window.customers || [];
    const container = document.getElementById('customerListContainer');
    if (!container) return;
    const customerSearchInput = document.getElementById('customerSearchInput');
    const keyword = customerSearchInput && customerSearchInput.value ? customerSearchInput.value.toLowerCase() : '';
    let filtered = customers;
if (keyword) filtered = customers.filter(c => c.name.toLowerCase().includes(keyword) || (c.phone && c.phone.includes(keyword)));    const totalNet = filtered.reduce((s, c) => s + (c.totalDebt || 0), 0);
    const totalDebtEl = document.getElementById('totalDebtAmount');
    if (totalDebtEl) totalDebtEl.innerText = totalNet > 0 ? formatMoney(totalNet) : (totalNet < 0 ? `💚 Dư ${formatMoney(-totalNet)}` : '0đ');
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">📭 Không tìm thấy khách hàng</div>';
        return;
    }
    const fragment = document.createDocumentFragment();
    filtered.forEach(c => {
        const balance = c.totalDebt || 0;
        let debtDisplay = '', debtClass = '';
        if (balance > 0) {
            debtDisplay = formatMoney(balance);
            debtClass = 'has-debt';
        } else if (balance < 0) {
            debtDisplay = `💚 Dư ${formatMoney(-balance)}`;
            debtClass = 'has-credit';
        } else {
            debtDisplay = '✅ Không nợ';
            debtClass = 'no-debt';
        }
        const div = document.createElement('div');
        div.className = 'customer-card';
        div.setAttribute('onclick', `renderCustomerDetail('${c.id}')`);
        div.innerHTML = `
            <div class="customer-avatar">${c.name.charAt(0).toUpperCase()}</div>
            <div class="customer-info">
                <div class="customer-name">${escapeHtml(c.name)}</div>
                <div class="customer-contact">📞 ${c.phone || ''}</div>
            </div>
            <div class="customer-debt ${debtClass}">${debtDisplay}</div>
        `;
        fragment.appendChild(div);
    });
    container.innerHTML = '';
    container.appendChild(fragment);
}

async function initCustomers() {
    window.customers = await DB.getAll('customers') || [];
    let needUpdate = false;
    for (let i = 0; i < window.customers.length; i++) {
        const c = window.customers[i];
        const correctBalance = getCustomerBalance(c);
        if (c.totalDebt !== correctBalance) {
            c.totalDebt = correctBalance;
            await DB.update('customers', c.id, { totalDebt: correctBalance });
            needUpdate = true;
            if (i % 10 === 9) await new Promise(resolve => setTimeout(resolve, 0));
        }
    }
    if (needUpdate) window.customers = await DB.getAll('customers');
    renderCustomerList();
    renderDebtList();
    console.log('✅ Đã tải customers:', window.customers.length);
}

// Thêm khách hàng mới
async function addCustomer(name, phone, address) {
    const newId = Date.now().toString() + Math.random().toString(36).substr(2, 6);
    const newCustomer = {
        id: newId,
        name: name.trim(),
        phone: phone || '',
        address: address || '',
        totalDebt: 0,
        totalSpent: 0,    // chỉ tính khi khách thanh toán (trả nợ hoặc trả trực tiếp)
        createdAt: new Date().toISOString(),
        debtHistory: [],
        paymentHistory: []
    };
    await DB.create('customers', newCustomer);
    window.customers = await DB.getAll('customers');
    renderCustomerList();
    renderDebtList();
    showToast(`Đã thêm khách ${name}`, 'success');
    return newCustomer;
}

// Cập nhật công nợ (thanh toán hoặc ghi nợ)
async function updateCustomerDebt(customerId, amount, type, note) {
    let customer = window.customers.find(c => c.id === customerId);
    if (!customer) return;
    
    // Sao chép để tránh tham chiếu
    customer = JSON.parse(JSON.stringify(customer));
    
    if (type === 'pay_debt') {
        // Thanh toán nợ: giảm totalDebt, tăng totalSpent
        customer.totalDebt = Math.max(0, (customer.totalDebt || 0) - amount);
        customer.totalSpent = (customer.totalSpent || 0) + amount;
        customer.paymentHistory = customer.paymentHistory || [];
        customer.paymentHistory.unshift({
            id: Date.now(),
            date: new Date().toISOString(),
            amount: amount,
            method: 'cash',    // có thể truyền method từ ngoài
            note: note
        });
    } else if (type === 'add_debt') {
        // Ghi nợ thêm: chỉ tăng totalDebt, không tăng totalSpent
        customer.totalDebt = (customer.totalDebt || 0) + amount;
        // KHÔNG cộng totalSpent ở đây
        customer.debtHistory = customer.debtHistory || [];
        customer.debtHistory.unshift({
            id: Date.now(),
            date: new Date().toISOString(),
            amount: amount,
            paidAmount: 0,
            remainingAmount: amount,
            note: note,
            status: 'unpaid',
            payments: []
        });
    }
    
    await DB.update('customers', customerId, customer);
    window.customers = await DB.getAll('customers');
    renderCustomerList();
    renderDebtList();
    
    // Nếu đang ở sub-tab nợ, cập nhật lại danh sách nợ trong tab đó
    const activeSubTab = document.querySelector('.sub-tab.active');
    if (activeSubTab && activeSubTab.getAttribute('data-subtab') === 'debt') {
        if (typeof renderDebtListForTab === 'function') await renderDebtListForTab();
    }
}



function renderDebtList() {
    const customers = window.customers || [];
    const container = document.getElementById('debtListContainer');
    if (!container) return;
    const debtCustomers = customers.filter(c => (c.totalDebt || 0) > 0);
    if (debtCustomers.length === 0) {
        container.innerHTML = '<div class="empty-state">✅ Không có khách nợ</div>';
        return;
    }
    container.innerHTML = debtCustomers.map(c => `
        <div class="debt-card" onclick="renderCustomerDetail('${c.id}')">
            <div class="debt-card-header"><div>👤 ${escapeHtml(c.name)}</div><div>${formatMoney(c.totalDebt)}</div></div>
            <div class="debt-card-phone">📞 ${c.phone || 'Chưa có'}</div>
            <div class="debt-card-actions"><button class="btn-pay-debt-small" onclick="event.stopPropagation(); openPaymentForCustomer('${c.id}')">💸 Thanh toán nợ</button></div>
        </div>
    `).join('');
}




async function addCustomerDebt(customerId, amount, note) {
    let customer = window.customers.find(c => c.id === customerId);
    if (!customer) return;
    customer = JSON.parse(JSON.stringify(customer));
    
    let remainingDebt = amount;
    let credit = customer.credit || 0;
    let usedCredit = 0;
    
    if (credit > 0) {
        usedCredit = Math.min(credit, remainingDebt);
        credit -= usedCredit;
        remainingDebt -= usedCredit;
        note += ` (đã cấn trừ ${formatMoney(usedCredit)} từ số dư có)`;
        if (credit > 0) {
            customer.credit = credit;
        } else {
            delete customer.credit;
        }
        showToast(`🔄 Đã cấn trừ ${formatMoney(usedCredit)} từ số dư có của khách`, 'info');
    }
    
    if (remainingDebt > 0) {
        customer.totalDebt = (customer.totalDebt || 0) + remainingDebt;
        customer.debtHistory = customer.debtHistory || [];
        customer.debtHistory.unshift({
            id: Date.now(),
            date: new Date().toISOString(),
            amount: remainingDebt,
            paidAmount: 0,
            remainingAmount: remainingDebt,
            note: note,
            status: 'unpaid',
            payments: []
        });
    } else {
        showToast(`✅ Đã cấn trừ hết nợ từ số dư có. Không phát sinh nợ mới.`, 'success');
    }
    
    await DB.update('customers', customerId, customer);
    window.customers = await DB.getAll('customers');
    renderCustomerList();
    renderDebtList();
    const activeSubTab = document.querySelector('.sub-tab.active');
    if (activeSubTab && activeSubTab.getAttribute('data-subtab') === 'debt') {
        if (typeof renderDebtListForTab === 'function') await renderDebtListForTab();
    }
}

// Modal thêm/sửa khách
function openAddCustomerModal() {
    document.getElementById('customerFormTitle').innerText = '➕ Thêm khách hàng';
    document.getElementById('customerFormId').value = '';
    document.getElementById('customerFormName').value = '';
    document.getElementById('customerFormPhone').value = '';
    document.getElementById('customerFormAddress').value = '';
    document.getElementById('customerFormModal').style.display = 'flex';
}

function editCustomer(id) {
    const c = window.customers.find(c => c.id === id);
    if (!c) return;
    document.getElementById('customerFormTitle').innerText = '✏️ Sửa khách hàng';
    document.getElementById('customerFormId').value = c.id;
    document.getElementById('customerFormName').value = c.name;
    document.getElementById('customerFormPhone').value = c.phone || '';
    document.getElementById('customerFormAddress').value = c.address || '';
    document.getElementById('customerFormModal').style.display = 'flex';
}

async function saveCustomerForm() {
    const id = document.getElementById('customerFormId').value;
    const name = document.getElementById('customerFormName').value.trim();
    const phone = document.getElementById('customerFormPhone').value;
    const address = document.getElementById('customerFormAddress').value;
    if (!name) { showToast('Vui lòng nhập tên khách hàng!', 'warning'); return; }
    // Không bắt buộc phone và address nữa
    
    if (id) {
        const c = window.customers.find(c => c.id === id);
        if (c) {
            c.name = name;
            c.phone = phone;
            c.address = address;
            await DB.update('customers', id, c);
            window.customers = await DB.getAll('customers');
            renderCustomerList();
            renderDebtList();
            showToast('Đã cập nhật', 'success');
        }
    } else {
        await addCustomer(name, phone, address);
    }
    closeModal('customerFormModal');
}

async function deleteCustomer(id) {
    if (confirm('Xóa khách hàng này?')) {
        await DB.remove('customers', id);
        window.customers = await DB.getAll('customers');
        renderCustomerList();
        renderDebtList();
        showToast('Đã xóa', 'success');
    }
}


// ========== CHỌN KHÁCH (VỚI INPUT TÌM KIẾM VÀ TẠO MỚI) ==========
let pendingCustomerCallback = null;

function showCustomerSelector(callback) {
    pendingCustomerCallback = callback;
    const container = document.getElementById('customerSelectorList');
    const searchInput = document.getElementById('customerSelectorSearch');
    if (!container) return;
    
    // Reset ô tìm kiếm
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
    }
    
    // Hiển thị danh sách khách hàng ban đầu
    renderCustomerSelectorList('');
    
    // Tạo nút "Tạo khách mới" nếu chưa tồn tại
    let actionBtn = document.getElementById('customerSelectorCreateBtn');
    if (!actionBtn) {
        actionBtn = document.createElement('button');
        actionBtn.id = 'customerSelectorCreateBtn';
        actionBtn.className = 'btn-create-customer';
        actionBtn.innerText = '💾 Lưu (tạo khách mới)';
        actionBtn.onclick = () => createCustomerFromInput();
        const modalBody = document.querySelector('#customerSelectorModal .modal-body');
        if (modalBody && !modalBody.querySelector('#customerSelectorCreateBtn')) {
            modalBody.appendChild(actionBtn);
        }
    } else {
        actionBtn.style.display = 'block';
    }
    
    document.getElementById('customerSelectorModal').style.display = 'flex';
}

function renderCustomerSelectorList(searchTerm) {
    const container = document.getElementById('customerSelectorList');
    if (!container) return;
    let customers = window.customers || [];
    if (searchTerm) {
        const lowerTerm = searchTerm.toLowerCase();
        customers = customers.filter(c => 
            c.name.toLowerCase().includes(lowerTerm) || 
            (c.phone && c.phone.includes(searchTerm))
        );
    }
    if (customers.length === 0) {
        container.innerHTML = `<div class="empty-state">📭 Không tìm thấy khách.<br>Nhập tên ở trên và bấm "Lưu" để tạo mới.</div>`;
        return;
    }
    container.innerHTML = customers.map(c => {
        const balance = c.totalDebt || 0;
        let debtText = '';
        let debtClass = '';
        if (balance > 0) {
            debtText = `🔴 Nợ ${formatMoney(balance)}`;
            debtClass = 'debt-negative';
        } else if (balance < 0) {
            debtText = `💚 Dư ${formatMoney(-balance)}`;
            debtClass = 'debt-positive';
        } else {
            debtText = '✅ Không nợ';
            debtClass = 'debt-zero';
        }
        return `
            <div class="customer-select-item" onclick="selectCustomer('${c.id}')">
                <div class="customer-select-avatar">${c.name.charAt(0).toUpperCase()}</div>
                <div class="customer-select-info">
                    <div class="customer-select-name">${escapeHtml(c.name)}</div>
                    <div class="customer-select-debt ${debtClass}">${debtText}</div>
                </div>
            </div>
        `;
    }).join('');
}

function filterCustomerSelector() {
    if (customerSearchDebounceTimer) clearTimeout(customerSearchDebounceTimer);
    customerSearchDebounceTimer = setTimeout(() => {
        const searchInput = document.getElementById('customerSelectorSearch');
        if (searchInput) renderCustomerSelectorList(searchInput.value);
    }, 150);
}

async function createCustomerFromInput() {
    const searchInput = document.getElementById('customerSelectorSearch');
    let name = searchInput ? searchInput.value.trim() : '';
    if (!name) {
        showToast('Vui lòng nhập tên khách hàng!', 'warning');
        return;
    }
    
    // Kiểm tra trùng tên (không phân biệt hoa thường)
    const existing = window.customers ? window.customers.find(c => c.name.toLowerCase() === name.toLowerCase()) : null;
    if (existing) {
        // Nếu trùng, hỏi có muốn chọn khách đó không
        if (confirm(`Khách "${existing.name}" đã tồn tại. Bạn có muốn chọn khách này không?`)) {
            selectCustomer(existing.id);
        }
        return;
    }
    
    // Tạo khách mới
    if (typeof addCustomer === 'function') {
        const newCustomer = await addCustomer(name, '', '');
        if (newCustomer && pendingCustomerCallback) {
            pendingCustomerCallback(newCustomer);
            pendingCustomerCallback = null;
        }
        closeModal('customerSelectorModal');
        showToast(`✅ Đã tạo khách hàng "${name}"`, 'success');
    }
}

function selectCustomer(customerId) {
    const customer = window.customers ? window.customers.find(c => c.id === customerId) : null;
    if (customer && pendingCustomerCallback) {
        pendingCustomerCallback(customer);
        pendingCustomerCallback = null;
    }
    closeModal('customerSelectorModal');
}

function openAddCustomerModalFromSelector() {
    closeModal('customerSelectorModal');
    openAddCustomerModal();
}

function searchCustomerList() {
    if (mainSearchDebounceTimer) clearTimeout(mainSearchDebounceTimer);
    mainSearchDebounceTimer = setTimeout(() => {
        renderCustomerList();
    }, 200);
}

// Hàm thoát HTML để tránh XSS
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
window.quickAddCustomer = quickAddCustomer;
// Export toàn cục
window.initCustomers = initCustomers;
window.renderCustomerList = renderCustomerList;
window.renderDebtList = renderDebtList;
window.renderCustomerDetail = renderCustomerDetail;
window.openAddCustomerModal = openAddCustomerModal;
window.editCustomer = editCustomer;
window.saveCustomerForm = saveCustomerForm;
window.deleteCustomer = deleteCustomer;
window.addCustomerDebt = addCustomerDebt;
window.updateCustomerDebt = updateCustomerDebt;
window.payCustomerDebt = payCustomerDebt;
window.openPaymentForCustomer = openPaymentForCustomer;
window.showCustomerSelector = showCustomerSelector;
window.selectCustomer = selectCustomer;
window.openAddCustomerModalFromSelector = openAddCustomerModalFromSelector;
window.filterCustomerSelector = filterCustomerSelector;
window.searchCustomerList = searchCustomerList;