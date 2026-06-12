// expense.js - Module chi phí thống nhất (thay thế cost.js + staff-cost.js)
// ES5, tương thích Android 6, iOS 12
// Hỗ trợ 2 loại chi phí: Nguyên liệu (ingredient) và Hao phí (waste)
// 2 nguồn tiền: Két POS (pos_cash) và Quản lý thanh toán (management)

// ========== BIẾN GLOBAL ==========
var expenseData = {
    transactions: [],
    categories: []
};

var expenseInitialized = false;

// Biến tạm lưu danh sách hao phí (đồng bộ từ DB)
var _expenseWasteCategories = [];

// Biến trạng thái cho modal expense
var _expenseSelectedType = 'ingredient'; // 'ingredient' | 'waste'
var _expenseSelectedFundSource = 'pos_cash'; // 'pos_cash' | 'management'
var _expenseSelectedIngredientId = null;
var _expenseSelectedIngredientName = '';

// Biến điều hướng ngày xem chi phí
var _expenseViewDate = new Date();
var _expenseViewDateKey = '';

// ========== KHỞI TẠO ==========
function loadExpenseData() {
    return Promise.all([
        DB.getAll('cost_categories'),
        DB.getAll('cost_transactions')
    ]).then(function(results) {
        expenseData.categories = results[0] || [];
        expenseData.transactions = results[1] || [];
        // Đồng bộ với biến global cũ để tương thích
        window.costCategories = expenseData.categories;
        window.costTransactions = expenseData.transactions;
    });
}

function initExpense() {
    if (expenseInitialized) return;
    loadExpenseData().then(function() {
        attachExpenseEvents();
        expenseInitialized = true;
        console.log('Expense module initialized');
    }).catch(function(err) {
        console.error('Init expense error:', err);
    });
}

// ========== MỞ MODAL CHI PHÍ ==========
function openExpenseModal() {
    loadExpenseData().then(function() {
        var modal = document.getElementById('expenseModal');
        if (!modal) {
            showToast('Không tìm thấy modal chi phí', 'error');
            return;
        }

        // Reset form
        _expenseSelectedType = 'ingredient';
        _expenseSelectedIngredientId = null;
        _expenseSelectedIngredientName = '';

        // Mặc định nguồn tiền: Admin = QLTT, Staff = Két POS
        var currentUser = DB.getCurrentUser();
        var isAdminUser = currentUser && currentUser.role === 'admin';
        _expenseSelectedFundSource = isAdminUser ? 'management' : 'pos_cash';
        switchFundSource(_expenseSelectedFundSource);

        var nameInput = document.getElementById('expenseNameInput');
        var amountInput = document.getElementById('expenseAmount');
        var qtyInput = document.getElementById('expenseQty');

        if (nameInput) nameInput.value = '';
        if (amountInput) amountInput.value = '';
        if (qtyInput) qtyInput.value = '1';

        // Gắn sự kiện nếu chưa được gắn
        if (!expenseInitialized) {
            attachExpenseEvents();
            expenseInitialized = true;
        }

        // Khóa QLTT nếu là nhân viên
        applyExpenseRoleRestrictions();

        // Hiển thị tab mặc định
        switchExpenseType('ingredient');

        // Render danh sách
        renderIngredientList();
        renderWasteTypeList();
        renderTodayExpenses();
        renderMonthExpenseTotal();

        modal.style.display = 'flex';
    });
}

// ========== PHÂN QUYỀN CHI PHÍ ==========
function applyExpenseRoleRestrictions() {
    var currentUser = DB.getCurrentUser();
    var isStaff = currentUser && currentUser.role !== 'admin';
    var fundSourceRow = document.querySelector('.fund-source-row');
    if (fundSourceRow) {
        if (isStaff) {
            // Nhân viên: ẩn toàn bộ dòng nguồn tiền, chỉ dùng Két POS mặc định
            fundSourceRow.style.display = 'none';
            switchFundSource('pos_cash');
        } else {
            fundSourceRow.style.display = '';
        }
    }
}

// ========== CHUYỂN TAB LOẠI CHI PHÍ ==========
function switchExpenseType(type) {
    _expenseSelectedType = type;

    // Cập nhật tab buttons
    var ingredientTab = document.getElementById('expenseIngredientTab');
    var wasteTab = document.getElementById('expenseWasteTab');
    if (ingredientTab) ingredientTab.classList.toggle('active', type === 'ingredient');
    if (wasteTab) wasteTab.classList.toggle('active', type === 'waste');

    // Hiển thị/ẩn khu vực tương ứng
    var ingredientArea = document.getElementById('expenseIngredientArea');
    var wasteArea = document.getElementById('expenseWasteArea');
    if (ingredientArea) ingredientArea.style.display = type === 'ingredient' ? 'block' : 'none';
    if (wasteArea) wasteArea.style.display = type === 'waste' ? 'block' : 'none';

    // Reset selected ingredient
    if (type === 'waste') {
        _expenseSelectedIngredientId = null;
        _expenseSelectedIngredientName = '';
        updateIngredientSelectedInfo();
    }
}

// ========== CHỌN NGUỒN TIỀN ==========
function switchFundSource(source) {
    _expenseSelectedFundSource = source;

    var posBtn = document.getElementById('fundSourcePosBtn');
    var mgmtBtn = document.getElementById('fundSourceMgmtBtn');
    if (posBtn) posBtn.classList.toggle('active', source === 'pos_cash');
    if (mgmtBtn) mgmtBtn.classList.toggle('active', source === 'management');
}

// ========== RENDER DANH SÁCH NGUYÊN LIỆU ==========
function renderIngredientList() {
    var container = document.getElementById('expenseIngredientGrid');
    if (!container) return;

    var list = window.ingredients || [];
    if (list.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có nguyên liệu</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < list.length; i++) {
        var ing = list[i];
        var isSelected = (_expenseSelectedIngredientId === ing.id);
        html += '<div class="ingredient-grid-item' + (isSelected ? ' selected' : '') + '" ' +
            'onclick="onIngredientSelected(\'' + ing.id + '\', \'' + escapeHtml(ing.name) + '\')">' +
            '<div class="ingredient-item-name">' + escapeHtml(ing.name) + '</div>' +
            '<div class="ingredient-item-stock">Tồn: ' + (typeof ing.stock === 'number' ? Math.round(ing.stock * 100) / 100 : (ing.stock || 0)) + (ing.unit ? ' ' + ing.unit : '') + '</div>' +
        '</div>';
    }
    container.innerHTML = html;
}

// ========== CHỌN NGUYÊN LIỆU ==========
function onIngredientSelected(ingredientId, ingredientName) {
    _expenseSelectedIngredientId = ingredientId;
    _expenseSelectedIngredientName = ingredientName;

    // Cập nhật UI selected state
    var items = document.querySelectorAll('#expenseIngredientGrid .ingredient-grid-item');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('selected');
    }
    var selectedEl = document.querySelector('#expenseIngredientGrid .ingredient-grid-item[onclick*="' + ingredientId + '"]');
    if (selectedEl) selectedEl.classList.add('selected');

    updateIngredientSelectedInfo();

    // Focus vào ô số lượng
    var qtyInput = document.getElementById('expenseQty');
    if (qtyInput) qtyInput.focus();
}

function updateIngredientSelectedInfo() {
    // Đã ẩn hoàn toàn - highlight trên grid là đủ
}

// ========== TÍNH TOÁN NGUYÊN LIỆU ==========
// Chỉ nhập số lượng + thành tiền

// ========== RENDER DANH SÁCH HAO PHÍ ==========
function renderWasteTypeList() {
    var container = document.getElementById('expenseWasteGrid');
    if (!container) return;

    // Lấy danh sách hao phí từ cost_categories (đã load trong expenseData.categories)
    var wasteCats = [];
    for (var i = 0; i < expenseData.categories.length; i++) {
        var cat = expenseData.categories[i];
        if (cat && !cat.deleted) {
            wasteCats.push(cat);
        }
    }
    _expenseWasteCategories = wasteCats;

    if (wasteCats.length === 0) {
        container.innerHTML = '<div class="empty-text" style="font-size:12px;padding:12px 0;">Chưa có hao phí. Gõ tên và lưu để thêm mới.</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < wasteCats.length; i++) {
        var cat = wasteCats[i];
        html += '<div class="waste-grid-item" onclick="onWasteTypeSelected(\'' + escapeHtml(cat.id) + '\', \'' + escapeHtml(cat.name) + '\')">' +
            '<span class="waste-item-name">' + escapeHtml(cat.name) + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
}

function onWasteTypeSelected(wasteId, wasteName) {
    // Cập nhật selected state
    var items = document.querySelectorAll('#expenseWasteGrid .waste-grid-item');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('selected');
    }
    var selectedEl = document.querySelector('#expenseWasteGrid .waste-grid-item[onclick*="' + wasteId + '"]');
    if (selectedEl) selectedEl.classList.add('selected');

    // Điền tên vào ô tìm kiếm
    var searchInput = document.getElementById('expenseWasteSearch');
    if (searchInput) searchInput.value = wasteName;

    // Focus vào ô số tiền
    var amountInput = document.getElementById('expenseWasteAmount');
    if (amountInput) amountInput.focus();
}

// ========== LƯU CHI PHÍ ==========
function saveExpense() {
    var costType = _expenseSelectedType;
    var fundSource = _expenseSelectedFundSource;

    // Cảnh báo admin khi dùng Két POS
    var currentUser = DB.getCurrentUser();
    var isAdminUser = currentUser && currentUser.role === 'admin';
    if (isAdminUser && fundSource === 'pos_cash') {
        if (!confirm('⚠️ Bạn đang dùng Két POS (tiền tại quầy).\n\nNhấn OK để xác nhận, hoặc Hủy để chuyển sang Quản lý thanh toán.')) {
            return;
        }
    }

    if (costType === 'ingredient') {
        var qty = parseInt(document.getElementById('expenseQty').value) || 0;
        var amount = parseInt(document.getElementById('expenseAmount').value) || 0;

        if (qty <= 0) {
            showToast('Số lượng phải lớn hơn 0!', 'warning');
            return;
        }
        if (amount <= 0) {
            showToast('Thành tiền phải lớn hơn 0!', 'warning');
            return;
        }

        // Nếu chưa chọn nguyên liệu, lấy từ ô tìm kiếm để tạo mới
        var ingredientId = _expenseSelectedIngredientId;
        var ingredientName = _expenseSelectedIngredientName;
        if (!ingredientId) {
            var searchVal = document.getElementById('expenseIngredientSearch').value.trim();
            ingredientName = searchVal || 'Nguyên liệu mới';
            ingredientId = Date.now().toString();
            // Tạo nguyên liệu mới trong danh sách và lưu vào DB
            var newIng = { id: ingredientId, name: ingredientName, stock: 0, createdAt: Date.now() };
            if (window.ingredients) window.ingredients.push(newIng);
            // Lưu vào IndexedDB trước để addIngredientStock() có thể DB.update() được
            DB.create('ingredients', newIng).then(function() {
                saveIngredientExpense(ingredientId, ingredientName, qty, amount, fundSource);
            }).catch(function(err) {
                console.error('Create ingredient error:', err);
                showToast('Lỗi khi tạo nguyên liệu mới!', 'error');
            });
        } else {
            // Lưu chi phí nguyên liệu (kèm tăng tồn kho + ghi inventory)
            saveIngredientExpense(ingredientId, ingredientName, qty, amount, fundSource);
        }

    } else {
        // Waste - hao phí
        var categoryName = document.getElementById('expenseWasteSearch').value.trim();
        var amount = parseInt(document.getElementById('expenseWasteAmount').value) || 0;

        if (!categoryName) {
            showToast('Vui lòng nhập tên chi phí!', 'warning');
            return;
        }
        if (amount <= 0) {
            showToast('Số tiền phải lớn hơn 0!', 'warning');
            return;
        }

        saveWasteExpense(categoryName, amount, fundSource);
    }
}

// ========== LƯU CHI PHÍ NGUYÊN LIỆU ==========
function saveIngredientExpense(ingredientId, ingredientName, qty, amount, fundSource) {
    var now = new Date();
    var dateKey = now.toISOString().slice(0, 10);
    var txId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    var invTxId = 'inv_' + txId;

    // Bước 1: Tăng tồn kho
    addIngredientStock(ingredientId, qty).then(function() {
        // Bước 2: Ghi inventory_transactions
        var invData = {
            id: invTxId,
            type: 'ingredient',
            ingredientId: ingredientId,
            ingredientName: ingredientName,
            quantity: qty,
            unitPrice: Math.round(amount / qty),
            totalAmount: amount,
            date: now.toISOString(),
            dateKey: dateKey,
            createdAt: Date.now(),
            createdBy: (DB.getCurrentUser() && DB.getCurrentUser().id) || window.currentDeviceId || '',
            deleted: false
        };
        return DB.create('inventory_transactions', invData);
    }).then(function() {
        // Bước 3: Ghi cost_transactions
        var costData = {
            id: txId,
            categoryId: 'ingredient_' + String(ingredientId),
            categoryName: ingredientName,
            amount: amount,
            quantity: qty,
            costType: 'ingredient',
            fundSource: fundSource,
            inventoryTxId: invTxId,
            ingredientId: String(ingredientId),
            ingredientName: ingredientName,
            ingredientQty: qty,
            ingredientUnitPrice: Math.round(amount / qty),
            date: now.toISOString(),
            dateKey: dateKey,
            createdAt: Date.now(),
            createdBy: (DB.getCurrentUser() && DB.getCurrentUser().id) || window.currentDeviceId || '',
            deleted: false
        };
        return DB.create('cost_transactions', costData);
    }).then(function() {
        // Gửi thông báo Telegram
        if (typeof notifyExpenseToTelegram === 'function') {
            notifyExpenseToTelegram({
                type: 'ingredient',
                amount: amount,
                categoryName: ingredientName,
                quantity: qty,
                unitPrice: Math.round(amount / qty),
                fundSource: fundSource,
                createdAt: new Date().toISOString()
            });
        }
        return loadExpenseData();
    }).then(function() {
        showToast('✅ Đã thêm chi phí nguyên liệu ' + formatMoney(amount), 'success');
        // Reset form
        document.getElementById('expenseQty').value = '0';
        document.getElementById('expenseAmount').value = '';
        _expenseSelectedIngredientId = null;
        _expenseSelectedIngredientName = '';
        updateIngredientSelectedInfo();

        renderIngredientList();
        renderTodayExpenses();
        renderMonthExpenseTotal();
    }).catch(function(err) {
        console.error('Save ingredient expense error:', err);
        showToast('Lỗi khi lưu chi phí!', 'error');
    });
}

// ========== LƯU CHI PHÍ HAO PHÍ ==========
function saveWasteExpense(categoryName, amount, fundSource) {
    var now = new Date();
    var dateKey = now.toISOString().slice(0, 10);

    // Tìm hoặc tạo category
    var cat = null;
    for (var i = 0; i < expenseData.categories.length; i++) {
        if (expenseData.categories[i].name === categoryName) {
            cat = expenseData.categories[i];
            break;
        }
    }

    var doSave = function(category) {
        var txId = Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
        var costData = {
            id: txId,
            categoryId: category.id,
            categoryName: category.name,
            amount: amount,
            quantity: 1,
            costType: 'waste',
            fundSource: fundSource,
            inventoryTxId: null,
            ingredientId: null,
            ingredientName: null,
            ingredientQty: null,
            ingredientUnitPrice: null,
            date: now.toISOString(),
            dateKey: dateKey,
            createdAt: Date.now(),
            createdBy: (DB.getCurrentUser() && DB.getCurrentUser().id) || window.currentDeviceId || '',
            deleted: false
        };
        return DB.create('cost_transactions', costData);
    };

    var savePromise;
    if (cat) {
        savePromise = doSave(cat);
    } else {
        var newId = Date.now().toString();
        var newCat = { id: newId, name: categoryName, createdAt: Date.now(), createdBy: (DB.getCurrentUser() && DB.getCurrentUser().id) || window.currentDeviceId || '' };
        savePromise = DB.create('cost_categories', newCat).then(function() {
            expenseData.categories.push(newCat);
            return newCat;
        }).then(doSave);
    }

    savePromise.then(function() {
        // Gửi thông báo Telegram
        if (typeof notifyExpenseToTelegram === 'function') {
            notifyExpenseToTelegram({
                type: 'waste',
                amount: amount,
                categoryName: categoryName,
                fundSource: fundSource,
                createdAt: new Date().toISOString()
            });
        }
        return loadExpenseData();
    }).then(function() {
        showToast('✅ Đã thêm chi phí ' + formatMoney(amount), 'success');
        document.getElementById('expenseWasteSearch').value = '';
        document.getElementById('expenseWasteAmount').value = '';

        renderTodayExpenses();
        renderMonthExpenseTotal();
        renderWasteTypeList();
    }).catch(function(err) {
        console.error('Save waste expense error:', err);
        showToast('Lỗi khi lưu chi phí!', 'error');
    });
}

// ========== DATE NAVIGATION ==========
function expenseUpdateDateDisplay() {
    var displayEl = document.getElementById('expenseDateDisplay');
    if (!displayEl) return;
    var today = new Date().toISOString().slice(0, 10);
    if (_expenseViewDateKey === today) {
        displayEl.textContent = '📅 Hôm nay';
    } else {
        var parts = _expenseViewDateKey.split('-');
        displayEl.textContent = '📅 ' + parts[2] + '/' + parts[1] + '/' + parts[0];
    }
}

function expenseDateChange(delta) {
    _expenseViewDate.setDate(_expenseViewDate.getDate() + delta);
    _expenseViewDateKey = _expenseViewDate.toISOString().slice(0, 10);
    expenseUpdateDateDisplay();
    renderExpensesByDate(_expenseViewDateKey);
}

function expensePickDate() {
    var input = document.createElement('input');
    input.type = 'date';
    input.value = _expenseViewDateKey;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function() {
        if (this.value) {
            _expenseViewDate = new Date(this.value + 'T00:00:00');
            _expenseViewDateKey = this.value;
            expenseUpdateDateDisplay();
            renderExpensesByDate(_expenseViewDateKey);
        }
        document.body.removeChild(input);
    });
    input.addEventListener('blur', function() {
        // Fallback nếu không chọn
        setTimeout(function() {
            if (document.body.contains(input)) document.body.removeChild(input);
        }, 500);
    });
    // Click để mở native date picker
    setTimeout(function() { input.click(); }, 100);
}

// ========== HIỂN THỊ CHI PHÍ THEO NGÀY ==========
function renderExpensesByDate(dateKey) {
    var container = document.getElementById('expenseTodayList');
    if (!container) return;

    DB.getAll('cost_transactions').then(function(allTx) {
        var currentUser = DB.getCurrentUser();
        var isAdminUser = currentUser && currentUser.role === 'admin';
        var today = new Date().toISOString().slice(0, 10);

        var filtered = [];
        for (var i = 0; i < allTx.length; i++) {
            var tx = allTx[i];
            if (tx && tx.dateKey === dateKey && !tx.deleted) {
                // Nhân viên: chỉ thấy giao dịch dùng Két POS (pos_cash)
                if (!isAdminUser && tx.fundSource !== 'pos_cash') continue;
                filtered.push(tx);
            }
        }

        // Sắp xếp mới nhất lên đầu
        filtered.sort(function(a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        // Cập nhật header tổng chi phí
        var headerTotalEl = document.getElementById('expenseHeaderTotal');
        if (headerTotalEl) {
            if (filtered.length === 0) {
                headerTotalEl.textContent = '';
            } else {
                var sum = 0;
                for (var si = 0; si < filtered.length; si++) {
                    sum += filtered[si].amount;
                }
                var countStr = filtered.length < 10 ? '0' + filtered.length : '' + filtered.length;
                headerTotalEl.textContent = 'SL: ' + countStr + '  -  Tổng: ' + formatMoney(sum);
            }
        }

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-text">📭 Không có chi phí ngày này</div>';
            return;
        }

        var total = 0;
        var html = '';

        for (var i = 0; i < filtered.length; i++) {
            var tx = filtered[i];
            total += tx.amount;

            var typeIcon = tx.costType === 'ingredient' ? '🧂' : '📦';
            var fundIcon = tx.fundSource === 'pos_cash' ? '🏦' : '👔';
            var timeStr = '';
            if (tx.date) {
                try {
                    var d = new Date(tx.date);
                    timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
                } catch(e) { timeStr = ''; }
            }

            // Phân quyền:
            // - Admin: sửa/xóa được tất cả
            // - Staff: chỉ sửa/xóa được chi phí hôm nay (dateKey === today)
            var canEdit = isAdminUser || (dateKey === today);
            var actionsHtml = '';
            if (canEdit) {
                actionsHtml = '<button class="cost-edit-btn" onclick="editExpense(\'' + tx.id + '\')">✏️</button>' +
                    '<button class="cost-delete-btn" onclick="deleteExpense(\'' + tx.id + '\')">🗑️</button>';
            }

            var detailStr = '';
            if (tx.costType === 'ingredient' && tx.ingredientQty && tx.ingredientUnitPrice) {
                detailStr = ' <span class="cost-item-qty">x' + tx.ingredientQty + ' × ' + formatMoney(tx.ingredientUnitPrice) + '</span>';
            }

            html += '<div class="cost-item">' +
                '<div class="cost-item-left">' +
                    '<span class="cost-item-time">' + timeStr + '</span>' +
                    '<span class="cost-item-icons">' + fundIcon + ' ' + typeIcon + '</span>' +
                    '<span class="cost-item-name">' + escapeHtml(tx.categoryName) + '</span>' +
                    detailStr +
                '</div>' +
                '<div class="cost-item-right">' +
                    '<span class="cost-item-amount">' + formatMoney(tx.amount) + '</span>' +
                    actionsHtml +
                '</div>' +
            '</div>';
        }

        html += '<div class="cost-total">Tổng: ' + formatMoney(total) + '</div>';
        container.innerHTML = html;
    }).catch(function(err) {
        console.error('renderExpensesByDate error:', err);
        container.innerHTML = '<div class="empty-text">Lỗi tải dữ liệu</div>';
    });
}

// Giữ alias cho tương thích
function renderTodayExpenses() {
    _expenseViewDate = new Date();
    _expenseViewDateKey = _expenseViewDate.toISOString().slice(0, 10);
    expenseUpdateDateDisplay();
    renderExpensesByDate(_expenseViewDateKey);
}

// ========== TỔNG CHI PHÍ THÁNG (NHÓM THEO NGÀY, CÓ NÚT MỞ RỘNG) ==========
function renderMonthExpenseTotal() {
    var container = document.getElementById('expenseMonthTotal');
    if (!container) return;

    // Lấy dữ liệu trực tiếp từ DB
    DB.getAll('cost_transactions').then(function(allTx) {
        var currentUser = DB.getCurrentUser();
        var isAdminUser = currentUser && currentUser.role === 'admin';
        var now = new Date();
        var start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        var end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

        // Lọc giao dịch trong tháng
        var monthTxs = [];
        for (var i = 0; i < allTx.length; i++) {
            var tx = allTx[i];
            if (tx && !tx.deleted && tx.dateKey >= start && tx.dateKey <= end) {
                // Nhân viên: chỉ thấy giao dịch dùng Két POS (pos_cash)
                if (!isAdminUser && tx.fundSource !== 'pos_cash') continue;
                monthTxs.push(tx);
            }
        }

        if (monthTxs.length === 0) {
            container.innerHTML = '<div class="empty-text">📭 Chưa có chi phí trong tháng</div>';
            return;
        }

        // Nhóm theo ngày (dateKey)
        var groups = {};
        for (var j = 0; j < monthTxs.length; j++) {
            var tx = monthTxs[j];
            var key = tx.dateKey || 'unknown';
            if (!groups[key]) groups[key] = [];
            groups[key].push(tx);
        }

        // Sắp xếp ngày từ mới nhất đến cũ nhất
        var sortedDates = Object.keys(groups).sort().reverse();

        var grandTotal = 0;
        var html = '';

        for (var d = 0; d < sortedDates.length; d++) {
            var dateKey = sortedDates[d];
            var items = groups[dateKey];
            var dayTotal = 0;
            for (var k = 0; k < items.length; k++) {
                dayTotal += items[k].amount;
            }
            grandTotal += dayTotal;

            // Format ngày: DD/MM
            var dateParts = dateKey.split('-');
            var displayDate = dateParts[2] + '/' + dateParts[1];

            // Tạo id duy nhất cho expandable section
            var sectionId = 'expMonthDate_' + dateKey.replace(/-/g, '');

            html += '<div class="month-cost-group">' +
                '<div class="month-cost-group-header" onclick="toggleMonthDateDetail(\'' + sectionId + '\')">' +
                    '<span>📅 <strong>' + displayDate + '</strong> (' + items.length + ' khoản)</span>' +
                    '<span style="display:flex;align-items:center;gap:6px;">' +
                        '<span style="font-weight:600;">' + formatMoney(dayTotal) + '</span>' +
                        '<span class="exp-month-expand-icon" id="' + sectionId + '_icon">▶</span>' +
                    '</span>' +
                '</div>' +
                '<div class="month-cost-detail" id="' + sectionId + '" style="display:none;">';

            // Sắp xếp items trong ngày: mới nhất lên đầu
            items.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

            for (var l = 0; l < items.length; l++) {
                var tx2 = items[l];
                var typeIcon = tx2.costType === 'ingredient' ? '🧂' : '📦';
                var fundIcon = tx2.fundSource === 'pos_cash' ? '🏦' : '👔';
                var timeStr = '';
                if (tx2.date) {
                    try {
                        var td = new Date(tx2.date);
                        timeStr = td.getHours().toString().padStart(2, '0') + ':' + td.getMinutes().toString().padStart(2, '0');
                    } catch(e) { timeStr = ''; }
                }
                var detailStr = '';
                if (tx2.costType === 'ingredient' && tx2.ingredientQty && tx2.ingredientUnitPrice) {
                    detailStr = ' <span style="font-size:11px;color:#64748b;">x' + tx2.ingredientQty + ' × ' + formatMoney(tx2.ingredientUnitPrice) + '</span>';
                }

                html += '<div class="month-cost-item">' +
                    '<span style="font-size:12px;color:#64748b;">' + timeStr + ' ' + typeIcon + ' ' + fundIcon + ' ' + escapeHtml(tx2.categoryName) + detailStr + '</span>' +
                    '<span style="font-weight:500;">' + formatMoney(tx2.amount) + '</span>' +
                '</div>';
            }

            html += '</div></div>';
        }

        // Tổng cuối tháng
        html += '<div class="cost-total" style="margin-top:8px;">Tổng tháng: ' + formatMoney(grandTotal) + '</div>';
        container.innerHTML = html;
    }).catch(function(err) {
        console.error('renderMonthExpenseTotal error:', err);
        container.innerHTML = '<div class="empty-text">Lỗi tải dữ liệu</div>';
    });
}

// ========== MỞ RỘNG/THU GỌN CHI TIẾT THEO NGÀY ==========
function toggleMonthDateDetail(sectionId) {
    var el = document.getElementById(sectionId);
    var icon = document.getElementById(sectionId + '_icon');
    if (!el) return;
    if (el.style.display === 'none') {
        el.style.display = 'block';
        if (icon) icon.textContent = '▼';
    } else {
        el.style.display = 'none';
        if (icon) icon.textContent = '▶';
    }
}

// ========== MỞ RỘNG/THU GỌN TẤT CẢ NGÀY TRONG THÁNG ==========
var _allMonthDatesExpanded = false;
function toggleAllMonthDates() {
    _allMonthDatesExpanded = !_allMonthDatesExpanded;
    var groups = document.querySelectorAll('.month-cost-detail');
    var icons = document.querySelectorAll('.exp-month-expand-icon');
    var isExpand = _allMonthDatesExpanded;
    for (var i = 0; i < groups.length; i++) {
        groups[i].style.display = isExpand ? 'block' : 'none';
    }
    for (var j = 0; j < icons.length; j++) {
        icons[j].textContent = isExpand ? '▼' : '▶';
    }
    var btn = document.getElementById('expMonthToggleAll');
    if (btn) {
        btn.textContent = isExpand ? '📂 Thu gọn tất cả' : '📂 Mở rộng tất cả';
    }
}

// ========== SỬA CHI PHÍ ==========
function editExpense(id) {
    var tx = null;
    for (var i = 0; i < expenseData.transactions.length; i++) {
        if (expenseData.transactions[i].id === id) {
            tx = expenseData.transactions[i];
            break;
        }
    }
    if (!tx) {
        showToast('Không tìm thấy chi phí!', 'error');
        return;
    }

    // Phân quyền: admin sửa được tất cả, staff chỉ sửa được chi phí hôm nay
    var currentUser = DB.getCurrentUser();
    var isAdminUser = currentUser && currentUser.role === 'admin';
    if (!isAdminUser) {
        var today = new Date().toISOString().slice(0, 10);
        if (tx.dateKey !== today) {
            showToast('Bạn chỉ được sửa chi phí trong ngày hôm nay!', 'warning');
            return;
        }
    }

    // Tạo modal inline sửa chi phí
    var editHtml = '<div class="expense-edit-form">';
    editHtml += '<div style="margin-bottom:8px;"><label style="font-size:13px;font-weight:600;">Tên chi phí</label>';
    editHtml += '<input type="text" id="editExpenseName" class="form-input" value="' + escapeHtml(tx.categoryName) + '"></div>';

    if (tx.costType === 'ingredient') {
        editHtml += '<div style="margin-bottom:8px;"><label style="font-size:13px;font-weight:600;">Số lượng</label>';
        editHtml += '<input type="number" id="editExpenseQty" class="form-input" value="' + (tx.ingredientQty || 1) + '" min="1" step="1"></div>';
    }

    editHtml += '<div style="margin-bottom:12px;"><label style="font-size:13px;font-weight:600;">Thành tiền</label>';
    editHtml += '<input type="number" id="editExpenseAmount" class="form-input" value="' + tx.amount + '" step="1000"></div>';

    editHtml += '<div style="display:flex;gap:8px;">';
    editHtml += '<button class="btn-save" style="flex:1;" onclick="confirmEditExpense(\'' + tx.id + '\')">✅ Lưu</button>';
    editHtml += '<button class="btn-cancel" style="flex:1;" onclick="cancelEditExpense()">❌ Hủy</button>';
    editHtml += '</div></div>';

    // Hiển thị form sửa trong 1 overlay nhỏ
    var overlay = document.createElement('div');
    overlay.id = 'editExpenseOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = function(e) { if (e.target === overlay) cancelEditExpense(); };

    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;padding:20px;width:320px;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
    box.innerHTML = '<div style="font-size:16px;font-weight:700;margin-bottom:12px;">✏️ Sửa chi phí</div>' + editHtml;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
}

function confirmEditExpense(id) {
    var newName = document.getElementById('editExpenseName').value.trim();
    var newAmount = parseInt(document.getElementById('editExpenseAmount').value) || 0;

    if (!newName) {
        showToast('Vui lòng nhập tên chi phí!', 'warning');
        return;
    }
    if (newAmount <= 0) {
        showToast('Số tiền không hợp lệ!', 'warning');
        return;
    }

    var updateData = {
        categoryName: newName,
        amount: newAmount
    };

    // Nếu là chi phí nguyên liệu, cho phép sửa số lượng
    var qtyInput = document.getElementById('editExpenseQty');
    if (qtyInput) {
        var newQty = parseInt(qtyInput.value) || 0;
        if (newQty > 0) {
            updateData.ingredientQty = newQty;
            updateData.quantity = newQty;
            updateData.ingredientUnitPrice = Math.round(newAmount / newQty);
        }
    } else {
        // Waste: cập nhật unitPrice nếu có quantity
        var tx = null;
        for (var i = 0; i < expenseData.transactions.length; i++) {
            if (expenseData.transactions[i].id === id) {
                tx = expenseData.transactions[i];
                break;
            }
        }
        if (tx && tx.ingredientQty > 0) {
            updateData.ingredientUnitPrice = Math.round(newAmount / tx.ingredientQty);
        }
    }

    DB.update('cost_transactions', id, updateData).then(function() {
        return loadExpenseData();
    }).then(function() {
        showToast('✅ Đã cập nhật chi phí', 'success');
        cancelEditExpense();
        renderTodayExpenses();
        renderMonthExpenseTotal();
    }).catch(function(err) {
        console.error('Edit expense error:', err);
        showToast('Lỗi khi cập nhật!', 'error');
    });
}

function cancelEditExpense() {
    var overlay = document.getElementById('editExpenseOverlay');
    if (overlay) {
        document.body.removeChild(overlay);
    }
}

// ========== XÓA CHI PHÍ ==========
function deleteExpense(id) {
    var tx = null;
    for (var i = 0; i < expenseData.transactions.length; i++) {
        if (expenseData.transactions[i].id === id) {
            tx = expenseData.transactions[i];
            break;
        }
    }
    if (!tx) {
        showToast('Không tìm thấy chi phí!', 'error');
        return;
    }

    // Phân quyền: admin xóa được tất cả, staff chỉ xóa được chi phí hôm nay
    var currentUser = DB.getCurrentUser();
    var isAdminUser = currentUser && currentUser.role === 'admin';
    if (!isAdminUser) {
        var today = new Date().toISOString().slice(0, 10);
        if (tx.dateKey !== today) {
            showToast('Bạn chỉ được xóa chi phí trong ngày hôm nay!', 'warning');
            return;
        }
    }

    if (!confirm('Bạn có chắc muốn xóa chi phí "' + tx.categoryName + '"?')) return;

    // Nếu là chi phí nguyên liệu, cần hỏi có hoàn lại tồn kho không
    var deletePromise;
    if (tx.costType === 'ingredient' && tx.ingredientId && tx.ingredientQty) {
        if (confirm('Chi phí này đã tăng tồn kho. Bạn có muốn hoàn lại tồn kho không?')) {
            // Hoàn lại tồn kho: trừ đi số lượng đã nhập
            deletePromise = addIngredientStock(tx.ingredientId, -tx.ingredientQty);
        } else {
            deletePromise = Promise.resolve();
        }
    } else {
        deletePromise = Promise.resolve();
    }

    deletePromise.then(function() {
        return DB.update('cost_transactions', id, { deleted: true });
    }).then(function() {
        return loadExpenseData();
    }).then(function() {
        showToast('🗑️ Đã xóa chi phí', 'success');
        renderTodayExpenses();
        renderMonthExpenseTotal();
        renderIngredientList();
    }).catch(function(err) {
        console.error('Delete expense error:', err);
        showToast('Lỗi khi xóa chi phí!', 'error');
    });
}

// ========== GẮN SỰ KIỆN ==========
function attachExpenseEvents() {
    // Nút lưu chi phí
    var saveBtn = document.getElementById('saveExpenseBtn');
    if (saveBtn) saveBtn.onclick = saveExpense;

    // Đóng modal
    var closeBtns = document.querySelectorAll('[data-close="expenseModal"]');
    for (var i = 0; i < closeBtns.length; i++) {
        closeBtns[i].onclick = function() { closeModal('expenseModal'); };
    }

    // Chỉ cho phép số khi nhập
    var qtyInput = document.getElementById('expenseQty');
    var amountInput = document.getElementById('expenseAmount');

    function onIngredientInput() {
        if (qtyInput) qtyInput.value = qtyInput.value.replace(/[^0-9]/g, '');
        if (amountInput) amountInput.value = amountInput.value.replace(/[^0-9]/g, '');
    }

    if (qtyInput) {
        qtyInput.addEventListener('input', onIngredientInput);
    }
    if (amountInput) {
        amountInput.addEventListener('input', onIngredientInput);
    }

    // Filter nguyên liệu
    var filterInput = document.getElementById('expenseIngredientSearch');
    if (filterInput) {
        filterInput.addEventListener('input', function() {
            var keyword = this.value.trim().toLowerCase();
            var items = document.querySelectorAll('#expenseIngredientGrid .ingredient-grid-item');
            for (var i = 0; i < items.length; i++) {
                var nameEl = items[i].querySelector('.ingredient-item-name');
                if (!nameEl) continue;
                var name = nameEl.innerText.toLowerCase();
                items[i].style.display = (keyword === '' || name.indexOf(keyword) !== -1) ? '' : 'none';
            }
        });
    }

    // Filter hao phí
    var wasteFilter = document.getElementById('expenseWasteSearch');
    if (wasteFilter) {
        wasteFilter.addEventListener('input', function() {
            var keyword = this.value.trim().toLowerCase();
            var items = document.querySelectorAll('#expenseWasteGrid .waste-grid-item');
            for (var i = 0; i < items.length; i++) {
                var nameEl = items[i].querySelector('.waste-item-name');
                if (!nameEl) continue;
                var name = nameEl.innerText.toLowerCase();
                items[i].style.display = (keyword === '' || name.indexOf(keyword) !== -1) ? '' : 'none';
            }
        });
    }
}

// ========== MANAGER TAB: HIỂN THỊ CHI PHÍ ==========
// Hàm này được gọi từ app.js switchTab và realtime.js khi có data thay đổi
function managerApplyFilter() {
    var container = document.getElementById('managerExpenseList');
    if (!container) return;

    // Lấy period từ select
    var modeSelect = document.getElementById('managerViewModeSelect');
    var mode = modeSelect ? modeSelect.value : 'period';

    // Tính date range
    var now = new Date();
    var startDate, endDate;

    if (mode === 'day') {
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    } else if (mode === 'month') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else {
        // period: 20/tháng trước -> 19/tháng này
        var day = now.getDate();
        if (day >= 20) {
            startDate = new Date(now.getFullYear(), now.getMonth(), 20);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 19, 23, 59, 59);
        } else {
            startDate = new Date(now.getFullYear(), now.getMonth() - 1, 20);
            endDate = new Date(now.getFullYear(), now.getMonth(), 19, 23, 59, 59);
        }
    }

    var startStr = startDate.toISOString().slice(0, 10);
    var endStr = endDate.toISOString().slice(0, 10);

    // Cập nhật label period
    if (modeSelect) {
        var label = '';
        if (mode === 'period') {
            label = 'Kỳ ' + formatDateDisplay(startStr) + ' → ' + formatDateDisplay(endStr);
        } else if (mode === 'month') {
            label = 'Tháng ' + (now.getMonth() + 1) + '/' + now.getFullYear();
        } else {
            label = 'Ngày ' + formatDateDisplay(startStr);
        }
        modeSelect.options[0].innerText = label;
    }

    // Lấy tất cả cost_transactions
    DB.getAll('cost_transactions').then(function(allCosts) {
        var filtered = allCosts.filter(function(c) {
            return c.dateKey >= startStr && c.dateKey <= endStr && !c.deleted;
        });

        // Sắp xếp mới nhất lên đầu
        filtered.sort(function(a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        // Tính tổng theo loại
        var totalStaff = 0; // fundSource === 'pos_cash' (staff dùng Két POS)
        var totalManagement = 0; // fundSource === 'management'
        var totalIngredient = 0;
        var totalWaste = 0;

        for (var i = 0; i < filtered.length; i++) {
            var c = filtered[i];
            if (c.fundSource === 'pos_cash') totalStaff += c.amount;
            else totalManagement += c.amount;
            if (c.costType === 'ingredient') totalIngredient += c.amount;
            else totalWaste += c.amount;
        }

        // Render danh sách
        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state">📭 Không có chi phí trong kỳ</div>';
        } else {
            var html = '<div class="cost-summary" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
                '<span style="font-size:13px;background:#fff7ed;padding:6px 12px;border-radius:40px;">🧂 NL: ' + formatMoney(totalIngredient) + '</span>' +
                '<span style="font-size:13px;background:#f0fdf4;padding:6px 12px;border-radius:40px;">📦 HP: ' + formatMoney(totalWaste) + '</span>' +
                '<span style="font-size:13px;background:#fffbeb;padding:6px 12px;border-radius:40px;">🏦 POS: ' + formatMoney(totalStaff) + '</span>' +
                '<span style="font-size:13px;background:#f0f9ff;padding:6px 12px;border-radius:40px;">👔 QL: ' + formatMoney(totalManagement) + '</span>' +
            '</div>';

            for (var j = 0; j < filtered.length; j++) {
                var tx = filtered[j];
                var typeIcon = tx.costType === 'ingredient' ? '🧂' : '📦';
                var fundIcon = tx.fundSource === 'pos_cash' ? '🏦' : '👔';
                var timeStr = '';
                if (tx.date) {
                    try {
                        var d = new Date(tx.date);
                        timeStr = d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
                    } catch(e) { timeStr = ''; }
                }

                html += '<div class="cost-item">' +
                    '<div style="flex:1;">' +
                        '<div>' + typeIcon + ' ' + fundIcon + ' <strong>' + escapeHtml(tx.categoryName) + '</strong></div>' +
                        '<div style="font-size:11px;color:#94a3b8;">' + timeStr + ' ' + formatDateDisplay(tx.dateKey) + '</div>' +
                    '</div>' +
                    '<div style="font-weight:600;text-align:right;">' + formatMoney(tx.amount) + '</div>' +
                '</div>';
            }

            var grandTotal = totalStaff + totalManagement;
            html += '<div class="cost-total" style="margin-top:8px;">Tổng: ' + formatMoney(grandTotal) + '</div>';
            container.innerHTML = html;
        }

        // Cập nhật KPI boxes
        var expenseBox = document.getElementById('managerExpense');
        if (expenseBox) {
            var valEl = expenseBox.querySelector('.big-value');
            if (valEl) valEl.innerText = formatMoney(totalStaff);
        }
        var adminExpenseBox = document.getElementById('managerAdminExpense');
        if (adminExpenseBox) {
            var valEl2 = adminExpenseBox.querySelector('.big-value');
            if (valEl2) valEl2.innerText = formatMoney(totalManagement);
        }
    });
}

// Export global
window.openExpenseModal = openExpenseModal;
window.switchExpenseType = switchExpenseType;
window.switchFundSource = switchFundSource;
window.onIngredientSelected = onIngredientSelected;
window.onWasteTypeSelected = onWasteTypeSelected;
window.saveExpense = saveExpense;
window.editExpense = editExpense;
window.confirmEditExpense = confirmEditExpense;
window.cancelEditExpense = cancelEditExpense;
window.deleteExpense = deleteExpense;
window.initExpense = initExpense;
window.loadExpenseData = loadExpenseData;
window.renderTodayExpenses = renderTodayExpenses;
window.renderExpensesByDate = renderExpensesByDate;
window.renderMonthExpenseTotal = renderMonthExpenseTotal;
window.managerApplyFilter = managerApplyFilter;
window.toggleMonthDateDetail = toggleMonthDateDetail;
window.expenseDateChange = expenseDateChange;
window.expensePickDate = expensePickDate;
window.toggleAllMonthDates = toggleAllMonthDates;

