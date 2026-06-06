// app.js - Khởi tạo, biến global, sự kiện, utility
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

var currentTab = 'tables';
var tempOrder = [];
var selectedCustomer = null;
var currentHistoryDate = new Date();
var currentReportDate = new Date();
var costCategories = [];
var costTransactions = [];
var menuItems = [];
var menuCategories = [];
var ingredients = [];
var customers = [];
var currentTableDetailId = null;
var currentMenuCategory = 'all';
var pendingPaymentTableId = null;
var pendingCustomerCallback = null;
var pendingDebtCustomerId = null;
var pendingSplitTableId = null;
var pendingTransferSourceTable = null;
var pendingMergeSourceId = null;
var pendingDeleteTableId = null;
var currentAddToTableId = null;
var renderDebounceTimer = null;
// Cache
var cachedTables = [];
var tablesCacheTime = 0;
var CACHE_TTL = 2000;
var renderScheduled = false;

document.addEventListener('DOMContentLoaded', function() {
    DB.init().then(function() {
        return loadData();
    }).then(function() {
        initEventListeners();
        renderCurrentTime();
        setInterval(renderCurrentTime, 1000);
        showToast('POS sẵn sàng', 'success');
    });
});

function loadData() {
    return Promise.all([
        DB.getAll('menu'),
        DB.getAll('menu_categories'),
        DB.getAll('ingredients'),
        DB.getAll('customers'),
        DB.getAll('cost_categories'),
        DB.getAll('cost_transactions')
    ]).then(function(results) {
        menuItems = results[0] || [];
        menuCategories = results[1] || [];
        ingredients = results[2] || [];
        customers = results[3] || [];
        costCategories = results[4] || [];
        costTransactions = results[5] || [];
        window.menuItems = menuItems;
        window.ingredients = ingredients;
        window.customers = customers;
        return renderTables();
        updateRecentToast();
    }).then(function() {
        renderCustomerList();
        renderHistoryByDate(currentHistoryDate);
        renderReport(currentReportDate);
        initRealtime();
    });
}

function renderRecentTransactions() {
    var todayStr = new Date().toISOString().slice(0, 10);
    DB.getTransactionsByDate(todayStr).then(function(transactions) {
        var validTx = transactions.filter(function(tx) { return !tx.refunded; });
        validTx.sort(function(a, b) {
            return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
        });
        var recent = validTx.slice(0, 3);
        var container = document.getElementById('recentList');
        if (!container) return;
        
        if (recent.length === 0) {
            container.innerHTML = '<div class="empty-text" style="padding: 8px;">Chưa có giao dịch hôm nay</div>';
            return;
        }
        
        var html = '';
        for (var i = 0; i < recent.length; i++) {
            var tx = recent[i];
            var timeDiff = Math.floor((Date.now() - new Date(tx.createdAt || tx.date)) / 60000);
            var timeText = '';
            if (timeDiff < 1) timeText = 'Vừa xong';
            else if (timeDiff < 60) timeText = timeDiff + ' phút trước';
            else timeText = Math.floor(timeDiff / 60) + ' giờ trước';
            
            var totalItems = 0;
            if (tx.items && tx.items.length) {
                for (var j = 0; j < tx.items.length; j++) totalItems += tx.items[j].qty;
            }
            
            var locationInfo = '';
            if (tx.tableName) locationInfo = '🍽️ ' + tx.tableName;
            else if (tx.type === 'takeaway') locationInfo = '🛵 Mang đi';
            else if (tx.type === 'grab') locationInfo = '🚕 Grab';
            else locationInfo = '🍽️ Tại chỗ';
            
            html += `
                <div class="recent-item" onclick="showTransactionDetail('${tx.id}')">
                    <span class="recent-time">${timeText}</span>
                    <span class="recent-info">${locationInfo} - ${totalItems} món</span>
                    <span class="recent-amount">${formatMoney(tx.amount)}</span>
                </div>
            `;
        }
        container.innerHTML = html;
    });
}

function initEventListeners() {
    // Chuyển tab
    var tabs = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].onclick = (function(tab) {
            return function() { switchTab(tab.getAttribute('data-tab')); };
        })(tabs[i]);
    }

    // Các nút chính
    var createOrderBtn = document.getElementById('createOrderBtn');
    if (createOrderBtn) createOrderBtn.onclick = openCreateOrderModal;

    var staffCostFloatBtn = document.getElementById('staffCostFloatBtn');
    if (staffCostFloatBtn) staffCostFloatBtn.onclick = function() {
        if (typeof openStaffCostModal === 'function') {
            openStaffCostModal();
        } else {
            showToast('Chức năng chi phí nhân viên chưa sẵn sàng', 'warning');
        }
    };

    var prevDayBtn = document.getElementById('prevDayBtn');
    if (prevDayBtn) prevDayBtn.onclick = function() { changeHistoryDate(-1); };

    var nextDayBtn = document.getElementById('nextDayBtn');
    if (nextDayBtn) nextDayBtn.onclick = function() { changeHistoryDate(1); };

    var historyFilter = document.getElementById('historyFilter');
    if (historyFilter) historyFilter.onchange = function() { renderHistoryByDate(currentHistoryDate); };

    var reportPrevDayBtn = document.getElementById('reportPrevDayBtn');
    if (reportPrevDayBtn) reportPrevDayBtn.onclick = function() { changeReportDate(-1); };

    var reportNextDayBtn = document.getElementById('reportNextDayBtn');
    if (reportNextDayBtn) reportNextDayBtn.onclick = function() { changeReportDate(1); };

    var quickAddCustomerBtn = document.getElementById('quickAddCustomerBtn');
    if (quickAddCustomerBtn) quickAddCustomerBtn.onclick = quickAddCustomer;

    var saveCostBtn = document.getElementById('saveCostBtn');
    if (saveCostBtn) saveCostBtn.onclick = saveExpense;

    var createCustomerBtn = document.getElementById('createCustomerFromSelectorBtn');
    if (createCustomerBtn) createCustomerBtn.onclick = createCustomerFromInput;

    var confirmDebtBtn = document.getElementById('confirmDebtPaymentBtn');
    if (confirmDebtBtn) confirmDebtBtn.onclick = confirmDebtPayment;

    var paymentCash = document.getElementById('paymentCashBtn');
    if (paymentCash) paymentCash.onclick = function() {
        if (pendingPaymentTableId) paymentAtTable(pendingPaymentTableId, 'cash');
        closeModal('paymentMethodModal');
    };

    var paymentTransfer = document.getElementById('paymentTransferBtn');
    if (paymentTransfer) paymentTransfer.onclick = function() {
        if (pendingPaymentTableId) paymentAtTable(pendingPaymentTableId, 'transfer');
        closeModal('paymentMethodModal');
    };

    var paymentDebt = document.getElementById('paymentDebtBtn');
    if (paymentDebt) paymentDebt.onclick = function() {
        if (pendingPaymentTableId) {
            closeModal('paymentMethodModal');
            debtAtTable(pendingPaymentTableId);
        }
    };

    // Modal chia hóa đơn, chuyển món, xóa bàn
    var confirmSplit = document.getElementById('confirmSplitBtn');
    if (confirmSplit) confirmSplit.onclick = confirmSplitPayment;

    var confirmTransfer = document.getElementById('confirmTransferBtn');
    if (confirmTransfer) confirmTransfer.onclick = confirmTransferItems;

    var confirmDelete = document.getElementById('confirmDeleteTableBtn');
    if (confirmDelete) confirmDelete.onclick = confirmDeleteTable;

    // Gắn sự kiện cho các nút số tiền nhanh trong modal chi phí
    var quickMoneyBtns = document.querySelectorAll('.quick-money-btn');
    for (var i = 0; i < quickMoneyBtns.length; i++) {
        quickMoneyBtns[i].onclick = function(e) {
            e.stopPropagation();
            var amount = this.getAttribute('data-amount');
            if (amount) {
                var costAmountInput = document.getElementById('costAmount');
                if (costAmountInput) costAmountInput.value = amount;
            }
        };
    }
}

function switchTab(tabId) {
    currentTab = tabId;
    var tabs = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < tabs.length; i++) {
        if (tabs[i].getAttribute('data-tab') === tabId) tabs[i].classList.add('active');
        else tabs[i].classList.remove('active');
    }
    var contents = document.querySelectorAll('.tab-content');
    for (var i = 0; i < contents.length; i++) {
        if (contents[i].id === tabId + 'View') contents[i].classList.add('active');
        else contents[i].classList.remove('active');
    }
}

function formatMoney(amount) { return (amount || 0).toLocaleString('vi-VN') + 'đ'; }
function showToast(message, type) { var toast = document.createElement('div'); toast.className = 'toast ' + type; toast.innerText = message; document.getElementById('toastContainer').appendChild(toast); setTimeout(function() { toast.remove(); }, 2500); }
function closeModal(modalId) { var m = document.getElementById(modalId); if (m) m.style.display = 'none'; }
function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, function(m) { if (m === '&') return '&'; if (m === '<') return '<'; if (m === '>') return '>'; return m; }); }
function formatDateDisplay(dateStr) { var d = new Date(dateStr); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }
function renderCurrentTime() { var now = new Date(); var timeEl = document.getElementById('currentTime'); if (timeEl) timeEl.innerText = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }); }

// Ghi đè hàm closeModal để bỏ chặn cuộn
var originalCloseModal = window.closeModal;
window.closeModal = function(modalId) {
    var modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('closing');
        setTimeout(function() {
            modal.style.display = 'none';
            modal.classList.remove('closing');
        }, 200);
    }
    document.body.classList.remove('modal-open');
    if (originalCloseModal) originalCloseModal(modalId);
};

// Hàm mở modal mới (chặn cuộn body)
function openBottomSheet(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

// Tự động thêm class modal-open khi bất kỳ modal nào hiển thị
var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            var modal = mutation.target;
            if (modal.style.display === 'flex') {
                document.body.classList.add('modal-open');
            }
        }
    });
});
document.querySelectorAll('.modal').forEach(function(modal) {
    observer.observe(modal, { attributes: true });
});
// Đóng modal khi click ra ngoài vùng .modal-content
document.querySelectorAll('.modal').forEach(function(modal) {
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            closeModal(modal.id);
        }
    });
});

// Preview realtime khi nhập số tiền mặt thực nhận
var actualCashInput = document.getElementById('actualCashInput');
if (actualCashInput) {
    actualCashInput.addEventListener('input', function(e) {
        var val = parseInt(e.target.value) || 0;
        previewCashKept(val);
    });
} else {
    console.warn('Không tìm thấy input #actualCashInput, preview realtime bị vô hiệu');
}

function previewCashKept(enteredActualCash) {
    var dateStr = currentReportDate.toISOString().slice(0, 10);
    Promise.all([
        DB.getTransactionsByDate(dateStr),
        DB.get('daily_balances', dateStr)
    ]).then(function(results) {
        var transactions = results[0].filter(function(t) { return !t.refunded; });
        var dailyBalance = results[1] || { cashKept: 0 };
        var cashTotal = 0;
        for (var i = 0; i < transactions.length; i++) {
            if (transactions[i].paymentMethod === 'cash') cashTotal += transactions[i].amount;
        }
        var prevDate = new Date(currentReportDate);
        prevDate.setDate(prevDate.getDate() - 1);
        var prevDateStr = prevDate.toISOString().slice(0, 10);
        DB.get('daily_balances', prevDateStr).then(function(prevBalance) {
            var cashKeptPrev = (prevBalance && prevBalance.cashKept) || 0;
            var cashKeptPreview = cashTotal + cashKeptPrev - enteredActualCash;
            if (cashKeptPreview < 0) cashKeptPreview = 0;
            var lastStatCard = document.querySelector('#reportStats .stat-card:last-child');
            if (lastStatCard) {
                var targetRow = lastStatCard.querySelector('.stat-row:last-child');
                if (targetRow) {
                    var valueSpan = targetRow.querySelector('span:last-child');
                    if (valueSpan) {
                        valueSpan.innerHTML = formatMoney(cashKeptPreview);
                        valueSpan.style.color = '#f97316';
                        valueSpan.style.fontWeight = 'bold';
                        var noteSpan = targetRow.querySelector('.preview-note');
                        if (!noteSpan) {
                            noteSpan = document.createElement('small');
                            noteSpan.className = 'preview-note';
                            noteSpan.style.marginLeft = '8px';
                            noteSpan.style.fontSize = '10px';
                            noteSpan.style.color = '#f97316';
                            noteSpan.innerText = '(chưa lưu)';
                            targetRow.appendChild(noteSpan);
                        } else {
                            noteSpan.style.display = 'inline';
                        }
                    }
                }
            }
        });
    });
}

// Nút gửi báo cáo: nhập tiền mặt thực nhận -> lưu và tự tính số dư cuối ngày
var submitActualCashBtn = document.getElementById('submitActualCashBtn');
if (submitActualCashBtn) {
    submitActualCashBtn.onclick = function() {
        var actualCashReceived = parseInt(document.getElementById('actualCashInput').value) || 0;
        if (actualCashReceived <= 0) {
            showToast('Vui lòng nhập số tiền mặt thực nhận lớn hơn 0!', 'warning');
            return;
        }
        
        var dateStr = currentReportDate.toISOString().slice(0, 10);
        
        Promise.all([
            DB.getTransactionsByDate(dateStr),
            DB.get('daily_balances', dateStr)
        ]).then(function(results) {
            var transactions = results[0].filter(function(t) { return !t.refunded; });
            var dailyBalance = results[1] || { cashKept: 0 };
            
            var cashTotal = 0;
            for (var i = 0; i < transactions.length; i++) {
                if (transactions[i].paymentMethod === 'cash') cashTotal += transactions[i].amount;
            }
            
            var prevDate = new Date(currentReportDate);
            prevDate.setDate(prevDate.getDate() - 1);
            var prevDateStr = prevDate.toISOString().slice(0, 10);
            
            DB.get('daily_balances', prevDateStr).then(function(prevBalance) {
                var cashKeptPrev = (prevBalance && prevBalance.cashKept) || 0;
                var cashKeptToday = cashTotal + cashKeptPrev - actualCashReceived;
                if (cashKeptToday < 0) cashKeptToday = 0;
                
                var data = {
                    id: dateStr,
                    cashKept: cashKeptToday,
                    cashReceived: actualCashReceived
                };
                DB.create('daily_balances', data, dateStr).then(function() {
                    showToast('Đã lưu báo cáo: tiền mặt thực nhận = ' + formatMoney(actualCashReceived), 'success');
                    var noteSpan = document.querySelector('#reportStats .stat-card:last-child .preview-note');
                    if (noteSpan) noteSpan.style.display = 'none';
                    var valueSpan = document.querySelector('#reportStats .stat-card:last-child .stat-row:last-child span:last-child');
                    if (valueSpan) {
                        valueSpan.style.color = '';
                        valueSpan.style.fontWeight = '';
                        valueSpan.innerHTML = formatMoney(cashKeptToday);
                    }
                    renderReport(currentReportDate);
                });
            });
        });
    };
}

