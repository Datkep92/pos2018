// pos-app.js - App RÚT GỌN cho giao diện POS riêng
// Chỉ load các collection POS cần: menu, menu_categories, customers, tables, transactions
// ES5, tương thích Android 6, iOS 12

var currentTab = 'tables';
var tempOrder = [];
var selectedCustomer = null;
var currentHistoryDate = new Date();
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
    // Khởi tạo realtime TRƯỚC DB.init()
    initRealtime();

    DB.init().then(function() {
        if (typeof initAuth === 'function') {
            initAuth();
        }
        return loadData();
    }).then(function() {
        // FIX: Kiểm tra nếu dữ liệu rỗng (IndexedDB bị xóa) -> force sync từ Firebase
        if (_isDataEmpty()) {
            console.log('⚠️ Local data empty, forcing sync from Firebase...');
            return DB.forceSyncFromFirebase().then(function() {
                console.log('✅ Force sync completed, reloading data...');
                return loadData();
            }).catch(function(err) {
                // FIX: Nếu force sync thất bại (offline, timeout...), vẫn tiếp tục
                console.error('⚠️ Force sync failed (may be offline):', err);
                showToast('⚠️ Không thể đồng bộ dữ liệu từ server', 'warning', 3000);
            });
        }
    }).then(function() {
        return loadDraftOrders();
    }).then(function() {
        initEventListeners();
        renderCurrentTime();
        if (typeof initNotifications === 'function') {
            initNotifications();
        }
        // OPTIMIZE: Khởi tạo event delegation cho menu grid (thay vì inline onclick)
        if (typeof _initMenuEventDelegation === 'function') {
            _initMenuEventDelegation();
        }
        setInterval(renderCurrentTime, 30000);
        showToast('POS sẵn sàng', 'success');
    }).catch(function(err) {
        // FIX: Catch mọi lỗi để đảm bảo UI không bị treo
        console.error('❌ Initialization error:', err);
        showToast('⚠️ Lỗi khởi tạo: ' + (err.message || 'unknown'), 'error', 4000);
        // Vẫn cố gắng khởi tạo event listeners để nút bấm hoạt động
        try {
            initEventListeners();
            renderCurrentTime();
        } catch(e) {
            console.error('Fallback init error:', e);
        }
    });
});

// FIX: Kiểm tra dữ liệu local có rỗng không (do IndexedDB bị xóa)
function _isDataEmpty() {
    // Nếu menuItems rỗng và customers rỗng -> khả năng cao local bị xóa
    var menuEmpty = !menuItems || menuItems.length === 0;
    var customersEmpty = !customers || customers.length === 0;
    var tablesEmpty = !cachedTables || cachedTables.length === 0;
    
    // Nếu cả 3 collection chính đều rỗng -> cần force sync
    return menuEmpty && customersEmpty && tablesEmpty;
}

function loadData() {
    return Promise.all([
        DB.getAll('menu'),
        DB.getAll('menu_categories'),
        DB.getAll('customers')
    ]).then(function(results) {
        menuItems = results[0] || [];
        // Sắp xếp menuItems theo sortOrder để kéo thả hoạt động đúng
        menuItems.sort(function(a, b) {
            var orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 9999;
            var orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 9999;
            return orderA - orderB;
        });
        menuCategories = results[1] || [];
        customers = results[2] || [];
        window.menuItems = menuItems;
        window.customers = customers;
        window.ingredients = ingredients;
        renderTables();
        updateRecentToast();
    }).then(function() {
        renderCustomerList();
        renderHistoryByDate(currentHistoryDate);
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
            if (tx.tableName) {
                var displayLabel = (tx.customer && tx.customer.name) ? tx.customer.name : tx.tableName;
                locationInfo = '\uD83C\uDF7D\uFE0F ' + displayLabel;
            } else if (tx.type === 'takeaway') locationInfo = '\uD83D\uDEF5 Mang \u0111i';
            else if (tx.type === 'grab') locationInfo = '\uD83D\uDE95 Grab';
            else locationInfo = '\uD83C\uDF7D\uFE0F T\u1EA1i ch\u1ED7';

            html += '<div class="recent-item" onclick="showTransactionDetail(\'' + tx.id + '\')">' +
                '<span class="recent-time">' + timeText + '</span>' +
                '<span class="recent-info">' + locationInfo + ' - ' + totalItems + ' món</span>' +
                '<span class="recent-amount">' + formatMoney(tx.amount) + '</span>' +
            '</div>';
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

    // Nút tạo đơn
    var createOrderBtn = document.getElementById('createOrderBtn');
    if (createOrderBtn) createOrderBtn.onclick = openCreateOrderModal;

    // Nút chi phí (giữ nguyên để tương thích, nhưng có thể ẩn nếu ko cần)
    var expenseFloatBtn = document.getElementById('expenseFloatBtn');
    if (expenseFloatBtn) {
        expenseFloatBtn.onclick = function() {
            if (typeof openExpenseModal === 'function') {
                openExpenseModal();
            } else {
                showToast('Chức năng chi phí chưa sẵn sàng', 'warning');
            }
        };
    }

    var prevDayBtn = document.getElementById('prevDayBtn');
    if (prevDayBtn) prevDayBtn.onclick = function() { changeHistoryDate(-1); };

    var nextDayBtn = document.getElementById('nextDayBtn');
    if (nextDayBtn) nextDayBtn.onclick = function() { changeHistoryDate(1); };

    var historyFilter = document.getElementById('historyFilter');
    if (historyFilter) historyFilter.onchange = function() { renderHistoryByDate(currentHistoryDate); };

    var quickAddCustomerBtn = document.getElementById('quickAddCustomerBtn');
    if (quickAddCustomerBtn) quickAddCustomerBtn.onclick = quickAddCustomer;

    var customerSearchInput = document.getElementById('customerSearchInput');
    if (customerSearchInput) {
        customerSearchInput.oninput = function() { renderCustomerList(); };
        customerSearchInput.onkeydown = function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                quickAddCustomer();
            }
        };
    }

    var createCustomerBtn = document.getElementById('createCustomerFromSelectorBtn');
    if (createCustomerBtn) createCustomerBtn.onclick = createCustomerFromInput;

    // Split, transfer, delete
    var confirmSplit = document.getElementById('confirmSplitBtn');
    if (confirmSplit) confirmSplit.onclick = confirmSplitPayment;

    var confirmTransfer = document.getElementById('confirmTransferBtn');
    if (confirmTransfer) confirmTransfer.onclick = confirmTransferItems;

    var confirmDelete = document.getElementById('confirmDeleteTableBtn');
    if (confirmDelete) confirmDelete.onclick = confirmDeleteTable;
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

    var draftContainer = document.getElementById('draftBubbleContainer');
    var recentToast = document.getElementById('recentToast');
    if (tabId === 'tables') {
        if (draftContainer) draftContainer.style.display = '';
        if (recentToast) recentToast.style.display = '';
        renderTables();
        if (typeof startTableTimer === 'function') {
            startTableTimer();
        }
    } else {
        if (typeof stopTableTimer === 'function') {
            stopTableTimer();
        }
        if (draftContainer) draftContainer.style.display = 'none';
        if (recentToast) recentToast.style.display = 'none';

        if (tabId === 'history') {
            renderHistoryByDate(currentHistoryDate);
        } else if (tabId === 'customers') {
            renderCustomerList();
        } else if (tabId === 'settings') {
            if (typeof initSettingsTab === 'function') {
                initSettingsTab();
            }
        }
    }
}

// Cache formatMoney
var _moneyCache = {};
var _moneyCacheKeys = [];
var _MONEY_CACHE_MAX = 1000;
function formatMoney(amount) {
    var val = amount || 0;
    var key = String(val);
    if (_moneyCache[key] !== undefined) return _moneyCache[key];
    var result = val.toLocaleString('vi-VN') + '\u0111';
    if (_moneyCacheKeys.length >= _MONEY_CACHE_MAX) {
        var oldestKey = _moneyCacheKeys.shift();
        delete _moneyCache[oldestKey];
    }
    _moneyCache[key] = result;
    _moneyCacheKeys.push(key);
    return result;
}

var _toastCounter = 0;
var _toastMap = {};

function showToast(message, type, duration) {
    if (duration === undefined) duration = 2500;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerText = message;
    document.getElementById('toastContainer').appendChild(toast);
    var id = 'toast_' + (++_toastCounter);
    toast.setAttribute('data-toast-id', id);
    if (duration > 0) {
        var timer = setTimeout(function() { toast.remove(); delete _toastMap[id]; }, duration);
        _toastMap[id] = { element: toast, timer: timer };
    } else {
        _toastMap[id] = { element: toast, timer: null };
    }
    return id;
}

function hideToast(id) {
    var entry = _toastMap[id];
    if (entry) {
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.element && entry.element.parentNode) entry.element.remove();
        delete _toastMap[id];
    }
}

function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, function(m) { if (m === '&') return '&'; if (m === '<') return '<'; if (m === '>') return '>'; return m; }); }
function formatDateDisplay(dateStr) {
    // Fix timezone: nếu dateStr là YYYY-MM-DD, parse thủ công để tránh lỗi UTC
    if (typeof dateStr === 'string' && dateStr.length === 10 && dateStr[4] === '-' && dateStr[7] === '-') {
        var parts = dateStr.split('-');
        return parseInt(parts[2], 10) + '/' + parseInt(parts[1], 10) + '/' + parseInt(parts[0], 10);
    }
    var d = new Date(dateStr);
    return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
}
function renderCurrentTime() {
    var now = new Date();
    var timeEl = document.getElementById('currentTime');
    if (timeEl) timeEl.innerText = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    var dateEl = document.getElementById('headerDate');
    if (dateEl) {
        var dayNames = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
        dateEl.innerText = dayNames[now.getDay()] + ', ' + now.toLocaleDateString('vi-VN');
    }
}

// FIX: closeModal - dùng window.closeModal để các event listener khác (click outside) cũng gọi đúng hàm này
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
    
    // FIX: Khi đóng orderModal: LUÔN clear tempOrder và cart cache
    // để lần mở sau ko bị giữ lại items cũ (kể cả khi thanh toán thất bại)
    if (modalId === 'orderModal') {
        tempOrder = [];
        if (typeof _resetCartDomCache === 'function') {
            _resetCartDomCache();
        }
        currentAddToTableId = null;
        currentDraftId = null;
    }
};

function openBottomSheet(modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

// FIX: Đóng modal khi click ra ngoài - dùng window.closeModal thay vì closeModal local
document.querySelectorAll('.modal').forEach(function(modal) {
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            window.closeModal(modal.id);
        }
    });
});

// ========== TOAST ==========
var _toastCounter = 0;
var _toastMap = {};

function showToast(message, type, duration) {
    if (duration === undefined) duration = 2500;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerText = message;
    document.getElementById('toastContainer').appendChild(toast);
    var id = 'toast_' + (++_toastCounter);
    toast.setAttribute('data-toast-id', id);
    if (duration > 0) {
        var timer = setTimeout(function() { toast.remove(); delete _toastMap[id]; }, duration);
        _toastMap[id] = { element: toast, timer: timer };
    } else {
        _toastMap[id] = { element: toast, timer: null };
    }
    return id;
}

function hideToast(id) {
    var entry = _toastMap[id];
    if (entry) {
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.element && entry.element.parentNode) entry.element.remove();
        delete _toastMap[id];
    }
}

// ========== SETTINGS / AUTO-UPDATE UI ==========

/**
 * Khởi tạo settings tab - load token, version, skip status
 */
function initSettingsTab() {
    // Hiển thị phiên bản
    var versionEl = document.getElementById('settingsCurrentVersion');
    if (versionEl && window.Android) {
        var vName = Android.getCurrentVersionName();
        var vCode = Android.getCurrentVersionCode();
        versionEl.textContent = 'v' + vName + ' (code ' + vCode + ')';
    } else if (versionEl) {
        versionEl.textContent = 'v1.0 (chỉ trên Android)';
    }

    // Load token đã lưu
    if (window.Android) {
        var token = Android.getGitHubToken();
        var tokenInput = document.getElementById('settingsGithubToken');
        if (tokenInput && token) {
            tokenInput.value = token;
        }
        // Load skip version
        var skipped = Android.getSkipVersion();
        var skipEl = document.getElementById('settingsSkippedVersion');
        if (skipEl) {
            skipEl.textContent = skipped ? 'v' + skipped : 'Không có';
        }
    }

    // Cập nhật trạng thái
    updateSettingsStatus();
}

/**
 * Cập nhật trạng thái kiểm tra
 */
function updateSettingsStatus() {
    var statusEl = document.getElementById('settingsUpdateStatus');
    if (!statusEl) return;
    if (window.Android) {
        var token = Android.getGitHubToken();
        if (token) {
            statusEl.textContent = '✅ Đã cấu hình GitHub token';
            statusEl.style.color = '#16a34a';
        } else {
            statusEl.textContent = '⏸️ Chưa có GitHub token - vào https://github.com/settings/tokens để tạo';
            statusEl.style.color = '#ca8a04';
        }
    } else {
        statusEl.textContent = '❌ Chỉ hoạt động trên ứng dụng Android';
        statusEl.style.color = '#dc2626';
    }
}

/**
 * Lưu GitHub token
 */
function saveGitHubToken() {
    if (!window.Android) {
        showToast('❌ Chỉ hoạt động trên ứng dụng Android', 'error', 3000);
        return;
    }
    var input = document.getElementById('settingsGithubToken');
    if (!input) return;
    var token = input.value.trim();
    if (!token) {
        showToast('⚠️ Vui lòng nhập GitHub token', 'warning', 2000);
        return;
    }
    Android.setGitHubToken(token);
    showToast('✅ Đã lưu GitHub token', 'success', 2000);
    updateSettingsStatus();
}

/**
 * Xóa GitHub token
 */
function clearGitHubToken() {
    if (!window.Android) {
        showToast('❌ Chỉ hoạt động trên ứng dụng Android', 'error', 3000);
        return;
    }
    if (confirm('Xóa GitHub token?')) {
        Android.clearGitHubToken();
        document.getElementById('settingsGithubToken').value = '';
        showToast('🗑️ Đã xóa GitHub token', 'success', 2000);
        updateSettingsStatus();
    }
}

/**
 * Kiểm tra cập nhật ngay lập tức
 */
function checkUpdateNow() {
    if (!window.Android) {
        showToast('❌ Chỉ hoạt động trên ứng dụng Android', 'error', 3000);
        return;
    }
    showToast('🔄 Đang kiểm tra cập nhật...', 'info', 3000);
    Android.checkForUpdateFromJS();
}

/**
 * Bỏ bỏ qua phiên bản (kiểm tra lại)
 */
function clearSkipVersion() {
    if (!window.Android) {
        showToast('❌ Chỉ hoạt động trên ứng dụng Android', 'error', 3000);
        return;
    }
    Android.clearSkipVersion();
    document.getElementById('settingsSkippedVersion').textContent = 'Không có';
    showToast('🔄 Đã xóa bỏ qua, sẽ kiểm tra lại', 'success', 2000);
}

/**
 * Lưu địa chỉ IP máy in từ Settings tab
 */
function savePrinterIp() {
    var input = document.getElementById('printerIpInput');
    if (!input) return;
    var ip = input.value.trim();
    if (!ip) {
        showToast('⚠️ Vui lòng nhập địa chỉ IP máy in', 'warning', 2000);
        return;
    }
    setPrinterIP(ip);
    showToast('✅ Đã lưu IP máy in: ' + ip, 'success', 2000);
}

/**
 * In thử hóa đơn test
 */
function testPrint() {
    var testData = {
        shopName: 'POS CAFE',
        tableName: 'In thử',
        items: [
            { name: 'Cà phê đen', quantity: 1, price: 25000 },
            { name: 'Cà phê sữa', quantity: 2, price: 30000 }
        ],
        total: 85000,
        paymentMethod: 'cash',
        createdAt: new Date().toISOString()
    };
    showToast('🖨️ Đang in thử...', 'info', 2000);
    printReceipt(testData);
}

/**
 * Hiện/ẩn token
 */
function toggleTokenVisibility() {
    var input = document.getElementById('settingsGithubToken');
    var btn = document.getElementById('settingsToggleToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}
