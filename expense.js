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

// Hàm loại bỏ dấu tiếng Việt (dùng chung cho _filterBothGrids)
function _removeVietnameseTones(str) {
    return str
        .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a')
        .replace(/[èéẹẻẽêềếệểễ]/g, 'e')
        .replace(/[ìíịỉĩ]/g, 'i')
        .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o')
        .replace(/[ùúụủũưừứựửữ]/g, 'u')
        .replace(/[ỳýỵỷỹ]/g, 'y')
        .replace(/[đ]/g, 'd')
        .replace(/[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ]/g, 'A')
        .replace(/[ÈÉẸẺẼÊỀẾỆỂỄ]/g, 'E')
        .replace(/[ÌÍỊỈĨ]/g, 'I')
        .replace(/[ÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ]/g, 'O')
        .replace(/[ÙÚỤỦŨƯỪỨỰỬỮ]/g, 'U')
        .replace(/[ỲÝỴỶỸ]/g, 'Y')
        .replace(/[Đ]/g, 'D');
}

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
        renderIngredientList();
        renderWasteTypeList();
        // Render ngay sau khi cache đã được load xong, tránh race condition
        renderTodayExpenses();
        renderMonthExpenseTotal();
        expenseInitialized = true;
        console.log('Expense module initialized');
        // Cập nhật lại big-value trên manager tab sau khi expense data đã load
        if (typeof managerApplyFilter === 'function') {
            managerApplyFilter();
        }
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
    var isAdmin = currentUser && currentUser.role === 'admin';
    // Selector hỗ trợ cả .fund-source-row (pos.html) và .cost-fund-source (index.html)
    var fundSourceRow = document.querySelector('.fund-source-row, .cost-fund-source');
    if (fundSourceRow) {
        if (isStaff) {
            // Nhân viên: ẩn toàn bộ dòng nguồn tiền, chỉ dùng Két POS mặc định
            fundSourceRow.style.display = 'none';
            switchFundSource('pos_cash');
        } else {
            fundSourceRow.style.display = '';
        }
    }

    // Hiển thị nút "Xóa chi phí cũ" cho admin
    var deleteOldBtn = document.getElementById('deleteOldExpensesBtn');
    if (deleteOldBtn) {
        deleteOldBtn.style.display = isAdmin ? '' : 'none';
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
// FIX 4: Luôn load ingredients từ DB để đảm bảo tồn kho mới nhất
// (đã trừ các giao dịch bán hàng, cộng nhập kho)
// Đăng ký listener để tự động re-render ingredients grid khi dữ liệu thay đổi
var _ingredientListRendered = false;
function _ensureIngredientListener() {
    if (_ingredientListRendered) return;
    _ingredientListRendered = true;
    // Lắng nghe sự kiện db_update từ DB module
    document.addEventListener('db_update', function(e) {
        var detail = e.detail;
        if (!detail || detail.collection !== 'ingredients') return;
        var container = document.getElementById('expenseIngredientGrid');
        if (!container) return;
        // Reset retry count khi có dữ liệu mới
        _ingredientRetryCount = 0;
        if (_ingredientRetryTimer) {
            clearTimeout(_ingredientRetryTimer);
            _ingredientRetryTimer = null;
        }
        // Chỉ re-render nếu grid đang hiển thị (không phải search results)
        var searchResults = document.getElementById('expenseIngredientSearchResults');
        if (searchResults && searchResults.style.display !== 'none') return;
        // Cập nhật window.ingredients từ memory cache
        if (typeof DB.getAll === 'function') {
            DB.getAll('ingredients').then(function(list) {
                if (list && list.length > 0) {
                    window.ingredients = list;
                    _renderIngredientGrid(container, list);
                }
            });
        }
    });
}

// Retry counter để tránh loop vô hạn
var _ingredientRetryCount = 0;
var _ingredientRetryTimer = null;

function renderIngredientList() {
    var container = document.getElementById('expenseIngredientGrid');
    if (!container) return;

    // Đăng ký listener để tự động cập nhật khi ingredients thay đổi
    _ensureIngredientListener();

    // Ưu tiên dùng window.ingredients nếu đã có
    var cachedList = window.ingredients;
    if (cachedList && cachedList.length > 0) {
        _renderIngredientGrid(container, cachedList);
        return;
    }

    if (typeof DB !== 'undefined' && DB.getAll) {
        // Thử load từ IndexedDB trực tiếp (không đợi sync)
        DB.getAll('ingredients').then(function(dbList) {
            if (dbList && dbList.length > 0) {
                window.ingredients = dbList;
                _renderIngredientGrid(container, dbList);
                return;
            }
            // Local trống, thử sync từ Firebase
            if (typeof DB.ensureCollection === 'function') {
                DB.ensureCollection('ingredients').then(function(syncedList) {
                    if (syncedList && syncedList.length > 0) {
                        window.ingredients = syncedList;
                        _renderIngredientGrid(container, syncedList);
                    } else {
                        // Sync xong vẫn không có dữ liệu -> thử lại sau (chờ smartSync/forceSync hoàn thành)
                        _retryIngredientLoad(container);
                    }
                }).catch(function() {
                    _retryIngredientLoad(container);
                });
            } else {
                _retryIngredientLoad(container);
            }
        }).catch(function() {
            _retryIngredientLoad(container);
        });
    } else {
        var list = window.ingredients;
        if (list && list.length > 0) {
            _renderIngredientGrid(container, list);
        } else {
            container.innerHTML = '<div class="empty-text">Chưa có nguyên liệu</div>';
        }
    }
}

// Thử lại sau mỗi 1s nếu chưa có dữ liệu (tối đa 30 lần = 30 giây)
// Giải quyết race condition: loadData() chạy trước, smartSync/forceSync chạy song song chưa xong
function _retryIngredientLoad(container) {
    if (_ingredientRetryCount >= 30) {
        _ingredientRetryCount = 0;
        container.innerHTML = '<div class="empty-text">Chưa có nguyên liệu</div>';
        return;
    }
    _ingredientRetryCount++;
    if (_ingredientRetryTimer) clearTimeout(_ingredientRetryTimer);
    _ingredientRetryTimer = setTimeout(function() {
        _ingredientRetryTimer = null;
        // Kiểm tra window.ingredients trước (nhanh nhất)
        if (window.ingredients && window.ingredients.length > 0) {
            _ingredientRetryCount = 0;
            _renderIngredientGrid(container, window.ingredients);
            return;
        }
        // Thử load từ IndexedDB
        DB.getAll('ingredients').then(function(dbList) {
            if (dbList && dbList.length > 0) {
                _ingredientRetryCount = 0;
                window.ingredients = dbList;
                _renderIngredientGrid(container, dbList);
            } else {
                _retryIngredientLoad(container);
            }
        }).catch(function() {
            _retryIngredientLoad(container);
        });
    }, 1000);
}

// FIX 7 (tiếp): Thêm data-id attribute thay vì onclick selector
// Admin: thêm long-press để quản lý tên nguyên liệu
function _renderIngredientGrid(container, list) {
    if (!list || list.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có nguyên liệu</div>';
        return;
    }

    var currentUser = DB.getCurrentUser();
    var isAdmin = currentUser && currentUser.role === 'admin';

    var html = '';
    for (var i = 0; i < list.length; i++) {
        var ing = list[i];
        // Bỏ qua nguyên liệu đã bị xóa (deleted)
        if (ing.deleted) continue;
        var isSelected = (_expenseSelectedIngredientId === ing.id);
        var extraAttrs = '';
        if (isAdmin) {
            extraAttrs = ' ontouchstart="return _adminIngTouchStart(event, \'' + ing.id + '\')" ' +
                'ontouchend="return _adminIngTouchEnd(event, \'' + ing.id + '\')" ' +
                'onmousedown="return _adminIngMouseDown(event, \'' + ing.id + '\')" ' +
                'onmouseup="return _adminIngMouseUp(event, \'' + ing.id + '\')" ' +
                'onmouseleave="return _adminIngMouseLeave(event)"';
        }
        // Tính tồn kho: ưu tiên ing.stock, fallback về 0
        var stockVal = (typeof ing.stock === 'number' && !isNaN(ing.stock)) ? ing.stock : (parseFloat(ing.stock) || 0);
        var stockDisplay = Math.round(stockVal * 100) / 100;
        var stockStr = stockDisplay + (ing.unit ? ' ' + ing.unit : '');
        // Tính số lượng đã quy đổi (nếu có conversion)
        var convertedStr = '';
        var rate = parseFloat(ing.conversionRate) || 0;
        var convTo = ing.conversionTo ? ing.conversionTo.trim() : '';
        if (rate > 0 && convTo) {
            var convertedVal = Math.round(stockVal * rate * 100) / 100;
            convertedStr = ' <span class="ingredient-item-converted">~ ' + convertedVal + ' ' + convTo + '</span>';
        }
        html += '<div class="ingredient-grid-item' + (isSelected ? ' selected' : '') + '" ' +
            'data-id="' + ing.id + '" ' +
            'onclick="onIngredientSelected(\'' + ing.id + '\', \'' + escapeHtml(ing.name) + '\')"' +
            extraAttrs + '>' +
            '<div class="ingredient-item-name">' + escapeHtml(ing.name) + '</div>' +
            '<div class="ingredient-item-stock-row"><span class="ingredient-item-stock-inline">Tồn: ' + stockStr + '</span>' + convertedStr + '</div>' +
        '</div>';
    }
    // Nếu tất cả đều bị xóa, hiển thị thông báo
    if (!html) {
        container.innerHTML = '<div class="empty-text">Chưa có nguyên liệu</div>';
        return;
    }
    container.innerHTML = html;
}

// ========== CHỌN NGUYÊN LIỆU ==========
// FIX 7: Dùng data-id attribute thay vì [onclick*=...] selector
function onIngredientSelected(ingredientId, ingredientName) {
    _expenseSelectedIngredientId = ingredientId;
    _expenseSelectedIngredientName = ingredientName;

    // Cập nhật UI selected state
    var items = document.querySelectorAll('#expenseIngredientGrid .ingredient-grid-item');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('selected');
    }
    var selectedEl = document.querySelector('#expenseIngredientGrid .ingredient-grid-item[data-id="' + ingredientId + '"]');
    if (selectedEl) selectedEl.classList.add('selected');

    updateIngredientSelectedInfo();

    // Xóa text trên ô tìm kiếm
    var searchInput = document.getElementById('expenseIngredientSearch');
    if (searchInput) searchInput.value = '';

    // Hiển thị modal nhập số lượng + thành tiền
    _showExpenseInputModal('ingredient', ingredientId, ingredientName);
}

function updateIngredientSelectedInfo() {
    // Đã ẩn hoàn toàn - highlight trên grid là đủ
}

// ========== TÍNH TOÁN NGUYÊN LIỆU ==========
// Chỉ nhập số lượng + thành tiền

// ========== RENDER DANH SÁCH HAO PHÍ ==========
// Admin: thêm long-press để quản lý tên hao phí
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

    var currentUser = DB.getCurrentUser();
    var isAdmin = currentUser && currentUser.role === 'admin';

    var html = '';
    for (var i = 0; i < wasteCats.length; i++) {
        var cat = wasteCats[i];
        var extraAttrs = '';
        if (isAdmin) {
            extraAttrs = ' ontouchstart="return _adminWasteTouchStart(event, \'' + escapeHtml(cat.id) + '\')" ' +
                'ontouchend="return _adminWasteTouchEnd(event, \'' + escapeHtml(cat.id) + '\')" ' +
                'onmousedown="return _adminWasteMouseDown(event, \'' + escapeHtml(cat.id) + '\')" ' +
                'onmouseup="return _adminWasteMouseUp(event, \'' + escapeHtml(cat.id) + '\')" ' +
                'onmouseleave="return _adminWasteMouseLeave(event)"';
        }
        // FIX 8: Thêm data-id attribute
        html += '<div class="waste-grid-item" data-id="' + escapeHtml(cat.id) + '" onclick="onWasteTypeSelected(\'' + escapeHtml(cat.id) + '\', \'' + escapeHtml(cat.name) + '\')"' + extraAttrs + '>' +
            '<span class="waste-item-name">' + escapeHtml(cat.name) + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
}

// FIX 8: Dùng data-id attribute thay vì [onclick*=...] selector
function onWasteTypeSelected(wasteId, wasteName) {
    // Cập nhật selected state
    var items = document.querySelectorAll('#expenseWasteGrid .waste-grid-item');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('selected');
    }
    var selectedEl = document.querySelector('#expenseWasteGrid .waste-grid-item[data-id="' + wasteId + '"]');
    if (selectedEl) selectedEl.classList.add('selected');

    // Xóa text trên ô tìm kiếm
    var searchInput = document.getElementById('expenseWasteSearch');
    if (searchInput) searchInput.value = '';

    // Hiển thị modal nhập số tiền
    _showExpenseInputModal('waste', wasteId, wasteName);
}

// ========== MODAL XÁC NHẬN TÙY CHỈNH (thay thế confirm()) ==========
// FIX 11-12: Dùng modal thay vì confirm() native
function _showConfirmModal(message, confirmText, cancelText) {
    return new Promise(function(resolve) {
        var overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center;';
        overlay.onclick = function(e) { if (e.target === overlay) { cleanup(); resolve(false); } };

        var box = document.createElement('div');
        box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;width:320px;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,0.2);text-align:center;';

        box.innerHTML =
            '<div style="font-size:15px;line-height:1.5;margin-bottom:20px;color:#1e293b;">' + message + '</div>' +
            '<div style="display:flex;gap:10px;justify-content:center;">' +
                '<button id="confirmModalCancelBtn" style="flex:1;padding:10px 16px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;color:#475569;font-size:14px;cursor:pointer;">' + (cancelText || 'Hủy') + '</button>' +
                '<button id="confirmModalOkBtn" style="flex:1;padding:10px 16px;border:none;border-radius:10px;background:#ef4444;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">' + (confirmText || 'OK') + '</button>' +
            '</div>';

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function cleanup() {
            if (document.body.contains(overlay)) document.body.removeChild(overlay);
        }

        document.getElementById('confirmModalOkBtn').onclick = function() { cleanup(); resolve(true); };
        document.getElementById('confirmModalCancelBtn').onclick = function() { cleanup(); resolve(false); };
    });
}

// ========== LƯU CHI PHÍ ==========
function saveExpense() {
    var costType = _expenseSelectedType;
    var fundSource = _expenseSelectedFundSource;

    // Cảnh báo admin khi dùng Két POS
    var currentUser = DB.getCurrentUser();
    var isAdminUser = currentUser && currentUser.role === 'admin';
    if (isAdminUser && fundSource === 'pos_cash') {
        var self = this;
        _showConfirmModal(
            '⚠️ Bạn đang dùng <strong>Két POS</strong> (tiền tại quầy).<br><br>Nhấn OK để xác nhận, hoặc Hủy để chuyển sang Quản lý thanh toán.',
            'OK, dùng Két POS',
            'Hủy'
        ).then(function(confirmed) {
            if (confirmed) {
                doSaveExpense();
            }
        });
        return;
    }

    doSaveExpense();
}

function doSaveExpense() {
    var costType = _expenseSelectedType;
    var fundSource = _expenseSelectedFundSource;

    if (costType === 'ingredient') {
        // Lấy tên từ ô tìm kiếm
        var ingredientName = document.getElementById('expenseIngredientSearch').value.trim();
        if (!ingredientName) {
            showToast('Vui lòng nhập tên nguyên liệu hoặc hao phí!', 'warning');
            return;
        }

        // Kiểm tra tên đã tồn tại trong ingredient chưa
        var existsInIngredient = false;
        var ingList = window.ingredients || [];
        for (var ei = 0; ei < ingList.length; ei++) {
            if (ingList[ei] && !ingList[ei].deleted && ingList[ei].name === ingredientName) {
                existsInIngredient = true;
                break;
            }
        }

        // Kiểm tra tên đã tồn tại trong waste chưa
        var existsInWaste = false;
        for (var wi = 0; wi < expenseData.categories.length; wi++) {
            var wc = expenseData.categories[wi];
            if (wc && !wc.deleted && wc.name === ingredientName) {
                existsInWaste = true;
                break;
            }
        }

        if (existsInIngredient && existsInWaste) {
            // Tên đã có ở cả 2 → hỏi người dùng muốn lưu vào đâu
            _showTypeSelectionModal(ingredientName, function(selectedType) {
                if (selectedType === 'ingredient') {
                    var foundIng = null;
                    for (var fi = 0; fi < ingList.length; fi++) {
                        if (ingList[fi] && !ingList[fi].deleted && ingList[fi].name === ingredientName) {
                            foundIng = ingList[fi];
                            break;
                        }
                    }
                    if (foundIng) {
                        _showExpenseInputModal('ingredient', foundIng.id, foundIng.name);
                    }
                } else {
                    saveWasteExpense(ingredientName, 0, fundSource);
                }
            });
            return;
        }

        if (existsInIngredient) {
            // Tên đã có trong ingredient → mở modal nhập số lượng/tiền
            var foundIng = null;
            for (var fi = 0; fi < ingList.length; fi++) {
                if (ingList[fi] && !ingList[fi].deleted && ingList[fi].name === ingredientName) {
                    foundIng = ingList[fi];
                    break;
                }
            }
            if (foundIng) {
                _showExpenseInputModal('ingredient', foundIng.id, foundIng.name);
            }
            return;
        }

        if (existsInWaste) {
            // Tên đã có trong waste → hỏi người dùng muốn lưu vào đâu
            _showTypeSelectionModal(ingredientName, function(selectedType) {
                if (selectedType === 'ingredient') {
                    _doSaveNewIngredient(ingredientName, 0, 0, fundSource);
                } else {
                    saveWasteExpense(ingredientName, 0, fundSource);
                }
            });
            return;
        }

        // Tìm trong danh sách nguyên liệu đã bị xóa (deleted) để tái sử dụng tên
        var existingDeletedIng = null;
        for (var di = 0; di < ingList.length; di++) {
            if (ingList[di].name === ingredientName && ingList[di].deleted) {
                existingDeletedIng = ingList[di];
                break;
            }
        }

        if (existingDeletedIng) {
            // Tái sử dụng nguyên liệu đã xóa: bỏ đánh dấu deleted
            var ingId = existingDeletedIng.id;
            DB.update('ingredients', ingId, { deleted: false }).then(function() {
                existingDeletedIng.deleted = false;
                showToast('✅ Đã khôi phục nguyên liệu: ' + ingredientName, 'success');
                renderIngredientList();
            }).catch(function(err) {
                console.error('Restore ingredient error:', err);
                showToast('Lỗi khi khôi phục nguyên liệu!', 'error');
            });
        } else {
            // Tên chưa tồn tại → hỏi người dùng muốn tạo nguyên liệu hay hao phí
            _showTypeSelectionModal(ingredientName, function(selectedType) {
                if (selectedType === 'ingredient') {
                    _doSaveNewIngredient(ingredientName, 0, 0, fundSource);
                } else {
                    saveWasteExpense(ingredientName, 0, fundSource);
                }
            });
        }

    } else {
        // Waste - hao phí
        var categoryName = document.getElementById('expenseWasteSearch').value.trim();

        if (!categoryName) {
            showToast('Vui lòng nhập tên chi phí!', 'warning');
            return;
        }

        // Kiểm tra tên đã tồn tại trong waste chưa
        var existsInWaste = false;
        for (var wi = 0; wi < expenseData.categories.length; wi++) {
            var wc = expenseData.categories[wi];
            if (wc && !wc.deleted && wc.name === categoryName) {
                existsInWaste = true;
                break;
            }
        }

        // Kiểm tra tên đã tồn tại trong ingredient chưa
        var existsInIngredient = false;
        var ingList = window.ingredients || [];
        for (var ii = 0; ii < ingList.length; ii++) {
            if (ingList[ii] && !ingList[ii].deleted && ingList[ii].name === categoryName) {
                existsInIngredient = true;
                break;
            }
        }

        if (existsInWaste && existsInIngredient) {
            // Tên đã có ở cả 2 → hỏi người dùng muốn lưu vào đâu
            _showTypeSelectionModal(categoryName, function(selectedType) {
                if (selectedType === 'waste') {
                    saveWasteExpense(categoryName, 0, fundSource);
                } else {
                    var foundIng = null;
                    for (var fi = 0; fi < ingList.length; fi++) {
                        if (ingList[fi] && !ingList[fi].deleted && ingList[fi].name === categoryName) {
                            foundIng = ingList[fi];
                            break;
                        }
                    }
                    if (foundIng) {
                        _showExpenseInputModal('ingredient', foundIng.id, foundIng.name);
                    }
                }
            });
            return;
        }

        if (existsInWaste) {
            // Tên đã có trong waste → mở modal nhập số tiền
            saveWasteExpense(categoryName, 0, fundSource);
            return;
        }

        if (existsInIngredient) {
            // Tên đã có trong ingredient → hỏi người dùng muốn lưu vào đâu
            _showTypeSelectionModal(categoryName, function(selectedType) {
                if (selectedType === 'waste') {
                    saveWasteExpense(categoryName, 0, fundSource);
                } else {
                    var foundIng = null;
                    for (var fi = 0; fi < ingList.length; fi++) {
                        if (ingList[fi] && !ingList[fi].deleted && ingList[fi].name === categoryName) {
                            foundIng = ingList[fi];
                            break;
                        }
                    }
                    if (foundIng) {
                        _showExpenseInputModal('ingredient', foundIng.id, foundIng.name);
                    }
                }
            });
            return;
        }

        // Tên chưa tồn tại → hỏi người dùng muốn tạo nguyên liệu hay hao phí
        _showTypeSelectionModal(categoryName, function(selectedType) {
            if (selectedType === 'waste') {
                saveWasteExpense(categoryName, 0, fundSource);
            } else {
                _doSaveNewIngredient(categoryName, 0, 0, fundSource);
            }
        });
    }
}

// Hàm phụ: tạo nguyên liệu mới
function _doSaveNewIngredient(ingredientName, qty, amount, fundSource) {
    var ingredientId = Date.now().toString();
    var newIng = { id: ingredientId, name: ingredientName, stock: 0, createdAt: Date.now() };
    if (window.ingredients) window.ingredients.push(newIng);
    DB.create('ingredients', newIng).then(function() {
        if (qty > 0 && amount > 0) {
            saveIngredientExpense(ingredientId, ingredientName, qty, amount, fundSource);
        } else {
            showToast('✅ Đã tạo nguyên liệu: ' + ingredientName, 'success');
            renderIngredientList();
        }
    }).catch(function(err) {
        console.error('Create ingredient error:', err);
        showToast('Lỗi khi tạo nguyên liệu mới!', 'error');
    });
}

// Hàm phụ: hiển thị modal chọn loại (nguyên liệu hay hao phí)
function _showTypeSelectionModal(itemName, callback) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = function(e) { if (e.target === overlay) { cleanup(); } };

    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;width:320px;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,0.2);text-align:center;';

    box.innerHTML =
        '<div style="font-size:15px;line-height:1.5;margin-bottom:16px;color:#1e293b;">' +
            'Tên "<strong>' + itemName + '</strong>" đã tồn tại ở cả nguyên liệu và hao phí.<br><br>' +
            'Bạn muốn lưu vào loại nào?' +
        '</div>' +
        '<div style="display:flex;gap:10px;justify-content:center;">' +
            '<button id="typeSelectIngBtn" style="flex:1;padding:12px 16px;border:none;border-radius:10px;background:#fef3c7;color:#92400e;font-size:14px;font-weight:600;cursor:pointer;">🧂 Nguyên liệu</button>' +
            '<button id="typeSelectWasteBtn" style="flex:1;padding:12px 16px;border:none;border-radius:10px;background:#e0f2fe;color:#075985;font-size:14px;font-weight:600;cursor:pointer;">📦 Hao phí</button>' +
        '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function cleanup() {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
    }

    document.getElementById('typeSelectIngBtn').onclick = function() { cleanup(); callback('ingredient'); };
    document.getElementById('typeSelectWasteBtn').onclick = function() { cleanup(); callback('waste'); };
}

// ========== MODAL NHẬP NHANH (SAU KHI CHỌN ITEM) ==========
function _showExpenseInputModal(type, id, name) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = function(e) { if (e.target === overlay) { cleanup(); } };

    var isIngredient = (type === 'ingredient');
    var icon = isIngredient ? '🧂' : '📦';
    var typeLabel = isIngredient ? 'Nguyên liệu' : 'Hao phí';

    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;padding:20px;width:320px;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,0.2);';

    var qtyHtml = isIngredient ?
        '<div style="margin-bottom:10px;">' +
            '<label style="display:block;font-size:12px;font-weight:500;color:#64748b;margin-bottom:4px;">Số lượng</label>' +
            '<input type="number" id="modalExpenseQty" class="cost-input" placeholder="0" value="1" min="0" step="1" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;box-sizing:border-box;">' +
        '</div>' : '';

    box.innerHTML =
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">' +
            '<span style="font-size:20px;">' + icon + '</span>' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="font-size:15px;font-weight:600;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(name) + '</div>' +
                '<div style="font-size:11px;color:#94a3b8;">' + typeLabel + '</div>' +
            '</div>' +
        '</div>' +
        qtyHtml +
        '<div style="margin-bottom:14px;">' +
            '<label style="display:block;font-size:12px;font-weight:500;color:#64748b;margin-bottom:4px;">Thành tiền</label>' +
            '<input type="number" id="modalExpenseAmount" class="cost-input" placeholder="0đ" step="1000" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
            '<button id="modalExpenseCancelBtn" style="flex:1;padding:10px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;color:#64748b;font-size:13px;font-weight:500;cursor:pointer;">Hủy</button>' +
            '<button id="modalExpenseSaveBtn" style="flex:2;padding:10px;border:none;border-radius:10px;background:#f97316;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">💾 Lưu chi phí</button>' +
        '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // Focus vào ô nhập đầu tiên
    setTimeout(function() {
        if (isIngredient) {
            var qtyInput = document.getElementById('modalExpenseQty');
            if (qtyInput) qtyInput.focus();
        } else {
            var amountInput = document.getElementById('modalExpenseAmount');
            if (amountInput) amountInput.focus();
        }
    }, 100);

    function cleanup() {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
    }

    document.getElementById('modalExpenseCancelBtn').onclick = function() { cleanup(); };

    document.getElementById('modalExpenseSaveBtn').onclick = function() {
        var amount = parseInt(document.getElementById('modalExpenseAmount').value) || 0;
        if (amount <= 0) {
            showToast('Vui lòng nhập số tiền!', 'warning');
            return;
        }

        if (isIngredient) {
            var qty = parseInt(document.getElementById('modalExpenseQty').value) || 1;
            if (qty <= 0) qty = 1;
            cleanup();
            saveIngredientExpense(id, name, qty, amount, _expenseSelectedFundSource);
        } else {
            cleanup();
            saveWasteExpense(name, amount, _expenseSelectedFundSource);
        }
    };
}

// ========== LƯU CHI PHÍ NGUYÊN LIỆU ==========
function saveIngredientExpense(ingredientId, ingredientName, qty, amount, fundSource) {
    var now = new Date();
    var dateKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : now.toISOString().slice(0, 10);
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
        document.getElementById('expenseIngredientSearch').value = '';
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
function saveWasteExpense(categoryName, amount, fundSource, fundHistoryKey) {
    var now = new Date();
    var dateKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : now.toISOString().slice(0, 10);

    // Tìm category (kể cả đã bị xóa) để tái sử dụng tên
    var cat = null;
    var deletedCat = null;
    for (var i = 0; i < expenseData.categories.length; i++) {
        if (expenseData.categories[i].name === categoryName) {
            if (expenseData.categories[i].deleted) {
                deletedCat = expenseData.categories[i];
            } else {
                cat = expenseData.categories[i];
                break;
            }
        }
    }

    // Nếu tìm thấy category đã bị xóa, khôi phục nó trước
    if (!cat && deletedCat) {
        cat = deletedCat;
        // Khôi phục: bỏ đánh dấu deleted
        DB.update('cost_categories', cat.id, { deleted: false }).then(function() {
            cat.deleted = false;
            renderWasteTypeList();
        });
    }

    var doSave = function(category) {
        // Nếu amount=0 thì chỉ tạo/kích hoạt tên, không ghi cost_transactions
        if (amount <= 0) {
            showToast('✅ Đã tạo hao phí: ' + categoryName, 'success');
            document.getElementById('expenseWasteSearch').value = '';
            renderWasteTypeList();
            return;
        }

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
            deleted: false,
            fundHistoryKey: fundHistoryKey || null
        };
        return DB.create('cost_transactions', costData);
    };

    var savePromise;
    if (cat) {
        savePromise = Promise.resolve(cat).then(doSave);
    } else {
        var newId = Date.now().toString();
        var newCat = { id: newId, name: categoryName, createdAt: Date.now(), createdBy: (DB.getCurrentUser() && DB.getCurrentUser().id) || window.currentDeviceId || '' };
        savePromise = DB.create('cost_categories', newCat).then(function() {
            expenseData.categories.push(newCat);
            return newCat;
        }).then(doSave);
    }

    if (amount > 0) {
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

            renderTodayExpenses();
            renderMonthExpenseTotal();
            renderWasteTypeList();
        }).catch(function(err) {
            console.error('Save waste expense error:', err);
            showToast('Lỗi khi lưu chi phí!', 'error');
        });
    }
}

// ========== DATE NAVIGATION ==========
function expenseUpdateDateDisplay() {
    var displayEl = document.getElementById('expenseDateDisplay');
    if (!displayEl) return;
    var today = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
    if (_expenseViewDateKey === today) {
        displayEl.textContent = '📅 Hôm nay';
    } else {
        var parts = _expenseViewDateKey.split('-');
        displayEl.textContent = '📅 ' + parts[2] + '/' + parts[1] + '/' + parts[0];
    }
}

// FIX 10: Clone date trước khi mutate để tránh lỗi tham chiếu
function expenseDateChange(delta) {
    var newDate = new Date(_expenseViewDate.getTime());
    newDate.setDate(newDate.getDate() + delta);
    _expenseViewDate = newDate;
    // expenseDateChange: dùng Date.UTC để convert đúng VN timezone
    _expenseViewDateKey = new Date(Date.UTC(_expenseViewDate.getFullYear(), _expenseViewDate.getMonth(), _expenseViewDate.getDate())).toISOString().slice(0, 10);
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

// ========== BIẾN CHO ADMIN CONTEXT MENU ==========
var _adminContextTxId = null;
var _adminContextSelectedIds = [];
var _adminContextMode = 'single'; // 'single' | 'multi'

// ========== HIỂN THỊ CHI PHÍ THEO NGÀY ==========
// FIX 1: Dùng expenseData.transactions (memory cache) thay vì DB.getAll('cost_transactions')
function renderExpensesByDate(dateKey) {
    var container = document.getElementById('expenseTodayList');
    if (!container) return;

    var allTx = expenseData.transactions || [];
    var currentUser = DB.getCurrentUser();
    var isAdminUser = currentUser && currentUser.role === 'admin';
    var today = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);

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
        // - Admin: sửa/xóa được tất cả, có long-press context menu
        // - Staff: chỉ sửa/xóa được chi phí hôm nay (dateKey === today)
        var canEdit = isAdminUser || (dateKey === today);
        var actionsHtml = '';
        if (canEdit) {
            // Cả admin và staff đều dùng context menu (click để mở)
            // Staff chỉ thấy context menu cho chi phí hôm nay
            actionsHtml = '<span class="cost-admin-badge">👤</span>';
        }

        var detailStr = '';
        if (tx.costType === 'ingredient' && tx.ingredientQty && tx.ingredientUnitPrice) {
            detailStr = ' <span class="cost-item-qty">x' + tx.ingredientQty + ' × ' + formatMoney(tx.ingredientUnitPrice) + '</span>';
        }

        // Thêm data-id + long-press attributes + swipe attributes
        var itemAttrs = 'class="cost-item"';
        if (canEdit) {
            itemAttrs = 'class="cost-item cost-item-admin" data-tx-id="' + tx.id + '" ' +
                'ontouchstart="return _adminTouchStart(event, \'' + tx.id + '\')" ' +
                'ontouchend="return _adminTouchEnd(event, \'' + tx.id + '\')" ' +
                'ontouchmove="return _adminTouchMove(event, \'' + tx.id + '\')" ' +
                'onmousedown="return _adminMouseDown(event, \'' + tx.id + '\')" ' +
                'onmouseup="return _adminMouseUp(event, \'' + tx.id + '\')" ' +
                'onmouseleave="return _adminMouseLeave(event)"';
        }

        html += '<div ' + itemAttrs + '>' +
            '<div class="cost-item-inner">' +
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
            '</div>' +
            '<div class="cost-item-swipe-actions">' +
                '<button class="cost-swipe-delete" onclick="_adminSwipeDelete(\'' + tx.id + '\')">🗑️ Xóa</button>' +
            '</div>' +
        '</div>';
    }

    html += '<div class="cost-total">Tổng: ' + formatMoney(total) + '</div>';
    container.innerHTML = html;
}

// ========== SWIPE-TO-DELETE: VUỐT TRÁI ĐỂ XÓA ==========
var _swipeStartX = 0;
var _swipeStartY = 0;
var _swipeTxId = null;
var _swipeThreshold = 60; // px - vuốt qua ngưỡng này thì hiện nút xóa

function _adminTouchStart(event, txId) {
    if (event.touches && event.touches.length > 0) {
        _swipeStartX = event.touches[0].clientX;
        _swipeStartY = event.touches[0].clientY;
        _swipeTxId = txId;
    }
    _startAdminLongPress(txId);
    return true;
}

function _adminTouchMove(event, txId) {
    if (!event.touches || event.touches.length === 0) return true;
    var dx = _swipeStartX - event.touches[0].clientX;
    var dy = Math.abs(_swipeStartY - event.touches[0].clientY);

    // Nếu vuốt dọc nhiều hơn ngang thì bỏ qua (đang scroll)
    if (dy > Math.abs(dx) * 1.5) {
        _resetSwipe(event.target);
        return true;
    }

    // Tìm cost-item cha
    var el = event.currentTarget;
    if (!el) return true;

    // Giới hạn translateX: không cho vuốt quá 120px
    var translateX = Math.min(Math.max(dx, 0), 120);
    var inner = el.querySelector('.cost-item-inner');
    if (inner) {
        inner.style.transition = 'none';
        inner.style.transform = 'translateX(-' + translateX + 'px)';
    }

    // Hiện/ẩn nút xóa dựa trên ngưỡng
    var actions = el.querySelector('.cost-item-swipe-actions');
    if (actions) {
        if (translateX >= _swipeThreshold) {
            actions.classList.add('visible');
        } else {
            actions.classList.remove('visible');
        }
    }

    return true;
}

function _adminTouchEnd(event, txId) {
    _clearAdminLongPress();

    var el = event.currentTarget;
    if (el) {
        var inner = el.querySelector('.cost-item-inner');
        var actions = el.querySelector('.cost-item-swipe-actions');
        var translateX = 0;
        if (inner && inner.style.transform) {
            var match = inner.style.transform.match(/translateX\(-(\d+)px\)/);
            if (match) translateX = parseInt(match[1], 10);
        }

        if (translateX >= _swipeThreshold) {
            // Mở swipe actions
            inner.style.transition = 'transform 0.2s ease';
            inner.style.transform = 'translateX(-80px)';
            if (actions) actions.classList.add('visible');
        } else {
            // Đóng swipe actions
            _resetSwipe(el);
        }
    }

    _swipeTxId = null;
    return true;
}

function _resetSwipe(el) {
    if (!el) return;
    var inner = el.querySelector('.cost-item-inner');
    if (inner) {
        inner.style.transition = 'transform 0.2s ease';
        inner.style.transform = 'translateX(0)';
    }
    var actions = el.querySelector('.cost-item-swipe-actions');
    if (actions) actions.classList.remove('visible');
}

function _adminSwipeDelete(txId) {
    // Reset tất cả swipe đang mở
    var items = document.querySelectorAll('.cost-item-admin');
    for (var i = 0; i < items.length; i++) {
        _resetSwipe(items[i]);
    }

    // Gọi xóa trực tiếp (không qua _adminDeleteExpense vì hàm đó dùng _adminContextTxId)
    if (txId) deleteExpense(txId);
}

// ========== ADMIN LONG-PRESS: PHÁT HIỆN ẤN GIỮ ==========
var _adminPressTimer = null;
var _adminPressTxId = null;
var _adminPressStartX = 0;
var _adminPressStartY = 0;
var _adminLongPressThreshold = 500; // ms
var _adminMoveThreshold = 15; // px - nếu di chuyển quá thì ko tính là giữ

function _adminMouseDown(event, txId) {
    _adminPressStartX = event.clientX;
    _adminPressStartY = event.clientY;
    _startAdminLongPress(txId);
    return true;
}

function _adminMouseUp(event, txId) {
    _clearAdminLongPress();
    // Click ngắn không làm gì - chỉ long-press mới mở context menu
    return true;
}

function _adminMouseLeave(event) {
    _clearAdminLongPress();
}

function _startAdminLongPress(txId) {
    _clearAdminLongPress();
    _adminPressTxId = txId;
    _adminPressTimer = setTimeout(function() {
        // Long press detected!
        _adminContextTxId = _adminPressTxId;
        _adminPressTxId = null;
        _showAdminContextMenu(_adminContextTxId, null);
    }, _adminLongPressThreshold);
}

function _clearAdminLongPress() {
    if (_adminPressTimer) {
        clearTimeout(_adminPressTimer);
        _adminPressTimer = null;
    }
    _adminPressTxId = null;
}

// ========== ADMIN LONG-PRESS: NGUYÊN LIỆU GRID ==========
var _adminIngPressTimer = null;
var _adminIngPressId = null;
var _adminIngPressStartX = 0;
var _adminIngPressStartY = 0;

function _adminIngTouchStart(event, ingId) {
    if (event.touches && event.touches.length > 0) {
        _adminIngPressStartX = event.touches[0].clientX;
        _adminIngPressStartY = event.touches[0].clientY;
    }
    _startAdminIngLongPress(ingId);
    return true;
}

function _adminIngTouchEnd(event, ingId) {
    _clearAdminIngLongPress();
    // Chỉ mở context menu nếu là long-press (1-2s), click ngắn thì bỏ qua
    return true;
}

function _adminIngMouseDown(event, ingId) {
    _adminIngPressStartX = event.clientX;
    _adminIngPressStartY = event.clientY;
    _startAdminIngLongPress(ingId);
    return true;
}

function _adminIngMouseUp(event, ingId) {
    _clearAdminIngLongPress();
    // Chỉ mở context menu nếu là long-press, click ngắn thì bỏ qua
    return true;
}

function _adminIngMouseLeave(event) {
    _clearAdminIngLongPress();
}

function _startAdminIngLongPress(ingId) {
    _clearAdminIngLongPress();
    _adminIngPressId = ingId;
    _adminIngPressTimer = setTimeout(function() {
        _adminIngPressId = null;
        _adminShowIngredientContext(ingId, null);
    }, _adminLongPressThreshold);
}

function _clearAdminIngLongPress() {
    if (_adminIngPressTimer) {
        clearTimeout(_adminIngPressTimer);
        _adminIngPressTimer = null;
    }
    _adminIngPressId = null;
}

// ========== ADMIN LONG-PRESS: HAO PHÍ GRID ==========
var _adminWastePressTimer = null;
var _adminWastePressId = null;
var _adminWastePressStartX = 0;
var _adminWastePressStartY = 0;

function _adminWasteTouchStart(event, wasteId) {
    if (event.touches && event.touches.length > 0) {
        _adminWastePressStartX = event.touches[0].clientX;
        _adminWastePressStartY = event.touches[0].clientY;
    }
    _startAdminWasteLongPress(wasteId);
    return true;
}

function _adminWasteTouchEnd(event, wasteId) {
    _clearAdminWasteLongPress();
    // Chỉ mở context menu nếu là long-press, click ngắn thì bỏ qua
    return true;
}

function _adminWasteMouseDown(event, wasteId) {
    _adminWastePressStartX = event.clientX;
    _adminWastePressStartY = event.clientY;
    _startAdminWasteLongPress(wasteId);
    return true;
}

function _adminWasteMouseUp(event, wasteId) {
    _clearAdminWasteLongPress();
    // Chỉ mở context menu nếu là long-press, click ngắn thì bỏ qua
    return true;
}

function _adminWasteMouseLeave(event) {
    _clearAdminWasteLongPress();
}

function _startAdminWasteLongPress(wasteId) {
    _clearAdminWasteLongPress();
    _adminWastePressId = wasteId;
    _adminWastePressTimer = setTimeout(function() {
        _adminWastePressId = null;
        _adminShowWasteContext(wasteId, null);
    }, _adminLongPressThreshold);
}

function _clearAdminWasteLongPress() {
    if (_adminWastePressTimer) {
        clearTimeout(_adminWastePressTimer);
        _adminWastePressTimer = null;
    }
    _adminWastePressId = null;
}

// ========== CONTEXT MENU CHO COST ITEM (admin + staff) ==========
function _showAdminContextMenu(txId, event) {
    var tx = _findTxInCache(txId);
    if (!tx) return;

    var currentUser = DB.getCurrentUser();
    var isAdmin = currentUser && currentUser.role === 'admin';

    _adminContextTxId = txId;
    _adminContextMode = 'single';

    var typeLabel = tx.costType === 'ingredient' ? '🧂 Nguyên liệu' : '📦 Hao phí';
    var fundLabel = tx.fundSource === 'pos_cash' ? '🏦 Két POS' : '👔 QLTT';

    var html =
        '<div id="adminContextOverlay" class="modal-overlay" onclick="if(event.target===this)_closeAdminContextMenu()">' +
            '<div class="modal-box" style="text-align:left;">' +
                '<div class="modal-title">⚙️ Chi phí: ' + escapeHtml(tx.categoryName) + '</div>' +
                '<div style="font-size:13px;color:#64748b;margin-bottom:16px;">' +
                    formatMoney(tx.amount) + ' · ' + typeLabel + ' · ' + fundLabel +
                '</div>' +
                '<div class="admin-context-actions">' +
                    '<button class="admin-context-btn" onclick="_adminEditExpense()">✏️ Sửa chi phí</button>' +
                    '<button class="admin-context-btn" onclick="_adminDeleteExpense()">🗑️ Xóa chi phí</button>' +
                    '<button class="admin-context-btn" onclick="_adminStartMerge()">🔗 Gộp chi phí</button>' +
                '</div>' +
                '<button class="admin-context-close" onclick="_closeAdminContextMenu()">Đóng</button>' +
            '</div>' +
        '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);
}

function _closeAdminContextMenu() {
    var overlay = document.getElementById('adminContextOverlay');
    if (overlay && document.body.contains(overlay)) {
        document.body.removeChild(overlay);
    }
    _adminContextTxId = null;
    _adminContextSelectedIds = [];
    _adminContextMode = 'single';
}

function _adminEditExpense() {
    var id = _adminContextTxId;
    _closeAdminContextMenu();
    if (id) editExpense(id);
}

function _adminDeleteExpense() {
    var id = _adminContextTxId;
    _closeAdminContextMenu();
    if (id) deleteExpense(id);
}

// ========== ADMIN GỘP CHI PHÍ ==========
function _adminStartMerge() {
    var firstId = _adminContextTxId;
    _adminContextMode = 'multi';
    _adminContextSelectedIds = [firstId];

    var html =
        '<div id="adminMergeOverlay" class="modal-overlay" onclick="if(event.target===this)_adminCancelMerge()">' +
            '<div class="modal-box" style="text-align:left;">' +
                '<div class="modal-title">🔗 Gộp chi phí</div>' +
                '<div style="font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5;">' +
                    'Đã chọn <strong id="adminMergeCount">1</strong> chi phí.<br>' +
                    'Nhấn vào các chi phí khác cùng ngày để thêm vào danh sách gộp.<br>' +
                    'Tổng tiền: <strong id="adminMergeTotal">' + formatMoney(_adminGetSelectedTotal()) + '</strong>' +
                '</div>' +
                '<div id="adminMergeList" style="max-height:200px;overflow-y:auto;margin-bottom:12px;font-size:13px;"></div>' +
                '<div style="display:flex;gap:8px;">' +
                    '<button class="btn-save" style="flex:1;" onclick="_adminConfirmMerge()">✅ Gộp</button>' +
                    '<button class="btn-cancel" style="flex:1;" onclick="_adminCancelMerge()">❌ Hủy</button>' +
                '</div>' +
            '</div>' +
        '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);

    // Highlight các item có thể chọn
    _adminUpdateMergeUI();
    _adminAttachMergeClickHandlers();
}

function _adminGetSelectedTotal() {
    var total = 0;
    for (var i = 0; i < _adminContextSelectedIds.length; i++) {
        var tx = _findTxInCache(_adminContextSelectedIds[i]);
        if (tx) total += tx.amount;
    }
    return total;
}

function _adminUpdateMergeUI() {
    var countEl = document.getElementById('adminMergeCount');
    var totalEl = document.getElementById('adminMergeTotal');
    var listEl = document.getElementById('adminMergeList');
    if (countEl) countEl.textContent = _adminContextSelectedIds.length;
    if (totalEl) totalEl.textContent = formatMoney(_adminGetSelectedTotal());

    if (listEl) {
        var html = '';
        for (var i = 0; i < _adminContextSelectedIds.length; i++) {
            var tx = _findTxInCache(_adminContextSelectedIds[i]);
            if (tx) {
                var icon = tx.costType === 'ingredient' ? '🧂' : '📦';
                html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">' +
                    '<span>' + icon + ' ' + escapeHtml(tx.categoryName) + '</span>' +
                    '<span style="font-weight:600;">' + formatMoney(tx.amount) + '</span>' +
                '</div>';
            }
        }
        listEl.innerHTML = html;
    }
}

function _adminAttachMergeClickHandlers() {
    // Gắn click cho các cost-item để chọn thêm
    var items = document.querySelectorAll('#expenseTodayList .cost-item-admin');
    for (var i = 0; i < items.length; i++) {
        (function(el) {
            var id = el.getAttribute('data-tx-id');
            if (!id) return;
            // Bỏ highlight cũ
            el.classList.remove('cost-item-selected');
            // Nếu đã chọn thì highlight
            if (_adminContextSelectedIds.indexOf(id) !== -1) {
                el.classList.add('cost-item-selected');
            }
            // Gắn click để toggle chọn
            el.onclick = function(e) {
                e.stopPropagation();
                _adminToggleMergeItem(id, el);
            };
        })(items[i]);
    }
}

function _adminToggleMergeItem(id, el) {
    var idx = _adminContextSelectedIds.indexOf(id);
    if (idx !== -1) {
        // Nếu chỉ còn 1 item thì ko cho bỏ chọn
        if (_adminContextSelectedIds.length <= 1) {
            showToast('Cần ít nhất 1 chi phí để gộp!', 'warning');
            return;
        }
        _adminContextSelectedIds.splice(idx, 1);
        el.classList.remove('cost-item-selected');
    } else {
        _adminContextSelectedIds.push(id);
        el.classList.add('cost-item-selected');
    }
    _adminUpdateMergeUI();
}

function _adminConfirmMerge() {
    if (_adminContextSelectedIds.length < 1) {
        showToast('Chưa chọn chi phí nào!', 'warning');
        return;
    }

    var ids = _adminContextSelectedIds.slice();
    var firstTx = _findTxInCache(ids[0]);
    if (!firstTx) return;

    // Tính tổng tiền
    var totalAmount = 0;
    var names = [];
    for (var i = 0; i < ids.length; i++) {
        var tx = _findTxInCache(ids[i]);
        if (tx) {
            totalAmount += tx.amount;
            names.push(tx.categoryName);
        }
    }

    // Cập nhật transaction đầu tiên với tổng tiền + tên gộp
    var mergedName = names.join(' + ');
    if (mergedName.length > 100) mergedName = mergedName.slice(0, 97) + '...';

    var updateData = {
        amount: totalAmount,
        categoryName: mergedName
    };

    // Nếu là ingredient, cập nhật qty
    if (firstTx.costType === 'ingredient') {
        var totalQty = 0;
        for (var j = 0; j < ids.length; j++) {
            var tj = _findTxInCache(ids[j]);
            if (tj && tj.ingredientQty) totalQty += tj.ingredientQty;
        }
        updateData.ingredientQty = totalQty;
        updateData.quantity = totalQty;
        updateData.ingredientUnitPrice = Math.round(totalAmount / totalQty);
    }

    // Xóa các transaction còn lại (đánh dấu deleted)
    var promises = [];
    for (var k = 1; k < ids.length; k++) {
        promises.push(DB.update('cost_transactions', ids[k], { deleted: true }));
    }

    // Cập nhật transaction đầu
    promises.unshift(DB.update('cost_transactions', ids[0], updateData));

    Promise.all(promises).then(function() {
        return loadExpenseData();
    }).then(function() {
        showToast('✅ Đã gộp ' + ids.length + ' chi phí thành công', 'success');
        _adminCancelMerge();
        renderTodayExpenses();
        renderMonthExpenseTotal();
    }).catch(function(err) {
        console.error('Merge expense error:', err);
        showToast('Lỗi khi gộp chi phí!', 'error');
    });
}

function _adminCancelMerge() {
    var overlay = document.getElementById('adminMergeOverlay');
    if (overlay && document.body.contains(overlay)) {
        document.body.removeChild(overlay);
    }
    // Reset click handlers
    var items = document.querySelectorAll('#expenseTodayList .cost-item-admin');
    for (var i = 0; i < items.length; i++) {
        items[i].onclick = null;
        items[i].classList.remove('cost-item-selected');
    }
    _adminContextSelectedIds = [];
    _adminContextMode = 'single';
    _adminContextTxId = null;
}

// ========== ADMIN: QUẢN LÝ DANH SÁCH TÊN NGUYÊN LIỆU ==========
// Chỉ admin mới có quyền sửa/xóa/gộp tên nguyên liệu trong grid
var _adminIngredientContextId = null;
var _adminIngredientSelectedIds = [];
var _adminIngredientMergeMode = false;

function _adminShowIngredientContext(ingredientId, event) {
    var currentUser = DB.getCurrentUser();
    if (!currentUser || currentUser.role !== 'admin') return;

    _adminIngredientContextId = ingredientId;
    _adminIngredientSelectedIds = [ingredientId];
    _adminIngredientMergeMode = false;

    var ing = null;
    var list = window.ingredients || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === ingredientId) { ing = list[i]; break; }
    }
    if (!ing) return;

    var html =
        '<div id="adminIngContextOverlay" class="modal-overlay" onclick="if(event.target===this)_adminCloseIngredientContext()">' +
            '<div class="modal-box" style="text-align:left;">' +
                '<div class="modal-title">🧂 Nguyên liệu: ' + escapeHtml(ing.name) + '</div>' +
                '<div style="font-size:13px;color:#64748b;margin-bottom:16px;">' +
                    'Tồn: ' + (typeof ing.stock === 'number' ? Math.round(ing.stock * 100) / 100 : (ing.stock || 0)) + (ing.unit ? ' ' + ing.unit : '') +
                '</div>' +
                '<div class="admin-context-actions">' +
                    '<button class="admin-context-btn" onclick="_adminEditIngredientName()">✏️ Sửa tên</button>' +
                    '<button class="admin-context-btn" onclick="_adminDeleteIngredient()">🗑️ Xóa nguyên liệu</button>' +
                    '<button class="admin-context-btn" onclick="_adminMergeIngredients()">🔗 Gộp nguyên liệu</button>' +
                '</div>' +
                '<button class="admin-context-close" onclick="_adminCloseIngredientContext()">Đóng</button>' +
            '</div>' +
        '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);
}

function _adminCloseIngredientContext() {
    var overlay = document.getElementById('adminIngContextOverlay');
    if (overlay && document.body.contains(overlay)) {
        document.body.removeChild(overlay);
    }
    _adminIngredientContextId = null;
    _adminIngredientSelectedIds = [];
    _adminIngredientMergeMode = false;
    // Reset highlight trên grid
    var items = document.querySelectorAll('#expenseIngredientGrid .ingredient-grid-item');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('ingredient-item-selected');
    }
}

function _adminEditIngredientName() {
    var id = _adminIngredientContextId;
    _adminCloseIngredientContext();
    if (!id) return;

    var ing = null;
    var list = window.ingredients || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) { ing = list[i]; break; }
    }
    if (!ing) return;

    var html =
        '<div id="editIngredientOverlay" class="modal-overlay" onclick="if(event.target===this)_adminCancelEditIngredient()">' +
            '<div class="modal-box" style="text-align:left;">' +
                '<div class="modal-title">✏️ Sửa tên nguyên liệu</div>' +
                '<div class="edit-field"><label class="edit-label">Tên nguyên liệu</label>' +
                    '<input type="text" id="editIngredientNameInput" class="form-input" value="' + escapeHtml(ing.name) + '"></div>' +
                '<div class="edit-field"><label class="edit-label">Đơn vị</label>' +
                    '<input type="text" id="editIngredientUnitInput" class="form-input" value="' + escapeHtml(ing.unit || '') + '" placeholder="kg, lít, túi..."></div>' +
                '<div class="edit-actions">' +
                    '<button class="btn-save" onclick="_adminConfirmEditIngredient(\'' + id + '\')">✅ Lưu</button>' +
                    '<button class="btn-cancel" onclick="_adminCancelEditIngredient()">❌ Hủy</button>' +
                '</div>' +
            '</div>' +
        '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);
    // Focus vào input
    setTimeout(function() {
        var input = document.getElementById('editIngredientNameInput');
        if (input) input.focus();
    }, 100);
}

function _adminCancelEditIngredient() {
    var overlay = document.getElementById('editIngredientOverlay');
    if (overlay && document.body.contains(overlay)) {
        document.body.removeChild(overlay);
    }
}

function _adminConfirmEditIngredient(id) {
    var newName = document.getElementById('editIngredientNameInput').value.trim();
    var newUnit = document.getElementById('editIngredientUnitInput').value.trim();
    if (!newName) {
        showToast('Vui lòng nhập tên nguyên liệu!', 'warning');
        return;
    }

    var updateData = { name: newName };
    if (newUnit) updateData.unit = newUnit;
    else updateData.unit = '';

    DB.update('ingredients', id, updateData).then(function() {
        // Cập nhật cache
        var list = window.ingredients || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === id) {
                list[i].name = newName;
                if (newUnit) list[i].unit = newUnit;
                else list[i].unit = '';
                break;
            }
        }
        showToast('✅ Đã cập nhật tên nguyên liệu', 'success');
        _adminCancelEditIngredient();
        renderIngredientList();
    }).catch(function(err) {
        console.error('Edit ingredient error:', err);
        showToast('Lỗi khi cập nhật!', 'error');
    });
}

function _adminDeleteIngredient() {
    var id = _adminIngredientContextId;
    _adminCloseIngredientContext();
    if (!id) return;

    // Kiểm tra xem nguyên liệu có giao dịch không
    var hasTx = false;
    var txs = expenseData.transactions || [];
    for (var i = 0; i < txs.length; i++) {
        if (txs[i].ingredientId === id && !txs[i].deleted) {
            hasTx = true;
            break;
        }
    }

    var msg = 'Bạn có chắc muốn xóa nguyên liệu này?';
    if (hasTx) {
        msg = '⚠️ <strong>Cảnh báo:</strong> Nguyên liệu này đã có giao dịch chi phí.<br><br>Xóa sẽ chỉ đánh dấu ẩn, không ảnh hưởng dữ liệu cũ. Tiếp tục?';
    }

    _showConfirmModal(msg, 'Xóa', 'Hủy').then(function(confirmed) {
        if (!confirmed) return;
        DB.update('ingredients', id, { deleted: true }).then(function() {
            // Cập nhật cache
            var list = window.ingredients || [];
            for (var i = 0; i < list.length; i++) {
                if (list[i].id === id) {
                    list[i].deleted = true;
                    break;
                }
            }
            showToast('🗑️ Đã xóa nguyên liệu', 'success');
            renderIngredientList();
        }).catch(function(err) {
            console.error('Delete ingredient error:', err);
            showToast('Lỗi khi xóa!', 'error');
        });
    });
}

function _adminMergeIngredients() {
    var firstId = _adminIngredientContextId;
    _adminIngredientMergeMode = true;
    _adminIngredientSelectedIds = [firstId];

    // Tạo danh sách tất cả nguyên liệu (chưa bị xóa) với checkbox
    var list = window.ingredients || [];
    var checklistHtml = '';
    for (var i = 0; i < list.length; i++) {
        var ing = list[i];
        if (ing.deleted) continue;
        var checked = (ing.id === firstId) ? 'checked' : '';
        var stockStr = (typeof ing.stock === 'number' ? Math.round(ing.stock * 100) / 100 : (ing.stock || 0));
        checklistHtml +=
            '<label class="merge-checkbox-item" data-id="' + ing.id + '">' +
                '<input type="checkbox" class="merge-ing-checkbox" value="' + ing.id + '" ' + checked + '>' +
                '<span class="merge-item-icon">🧂</span>' +
                '<span class="merge-item-name">' + escapeHtml(ing.name) + '</span>' +
                '<span class="merge-item-stock">Tồn: ' + stockStr + (ing.unit ? ' ' + ing.unit : '') + '</span>' +
            '</label>';
    }

    var html =
        '<div id="adminMergeIngOverlay" class="modal-overlay" onclick="if(event.target===this)_adminCancelMergeIngredients()">' +
            '<div class="modal-box" style="text-align:left;">' +
                '<div class="modal-title">🔗 Gộp nguyên liệu</div>' +
                '<div style="font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5;">' +
                    'Chọn các nguyên liệu muốn gộp (tích vào ô checkbox).<br>' +
                    'Đã chọn: <strong id="adminMergeIngCount">1</strong> nguyên liệu.<br>' +
                    'Sau khi gộp, các giao dịch cũ sẽ trỏ về nguyên liệu được giữ lại.' +
                '</div>' +
                '<div id="adminMergeIngList" class="merge-checklist">' +
                    checklistHtml +
                '</div>' +
                '<div style="display:flex;gap:8px;margin-top:12px;">' +
                    '<button class="btn-save" style="flex:1;" onclick="_adminConfirmMergeIngredients()">✅ Gộp</button>' +
                    '<button class="btn-cancel" style="flex:1;" onclick="_adminCancelMergeIngredients()">❌ Hủy</button>' +
                '</div>' +
            '</div>' +
        '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);

    // Gắn sự kiện change cho checkbox
    var checkboxes = document.querySelectorAll('.merge-ing-checkbox');
    for (var i = 0; i < checkboxes.length; i++) {
        checkboxes[i].addEventListener('change', function() {
            _adminIngredientSelectedIds = [];
            var cbs = document.querySelectorAll('.merge-ing-checkbox:checked');
            for (var j = 0; j < cbs.length; j++) {
                _adminIngredientSelectedIds.push(cbs[j].value);
            }
            if (_adminIngredientSelectedIds.length === 0) {
                // Luôn giữ ít nhất 1
                this.checked = true;
                _adminIngredientSelectedIds.push(this.value);
            }
            _adminUpdateMergeIngUI();
        });
    }

    _adminUpdateMergeIngUI();
}

function _adminUpdateMergeIngUI() {
    var countEl = document.getElementById('adminMergeIngCount');
    if (countEl) countEl.textContent = _adminIngredientSelectedIds.length;
}

function _adminConfirmMergeIngredients() {
    if (_adminIngredientSelectedIds.length < 1) {
        showToast('Chưa chọn nguyên liệu nào!', 'warning');
        return;
    }

    var ids = _adminIngredientSelectedIds.slice();
    var list = window.ingredients || [];

    // Lấy danh sách tên từ các nguyên liệu được chọn
    var nameOptions = [];
    for (var i = 0; i < ids.length; i++) {
        for (var j = 0; j < list.length; j++) {
            if (list[j].id === ids[i]) {
                nameOptions.push({ id: ids[i], name: list[j].name });
                break;
            }
        }
    }

    // Tạo modal chọn tên
    var nameRadiosHtml = '';
    for (var n = 0; n < nameOptions.length; n++) {
        var checked = (n === 0) ? 'checked' : '';
        nameRadiosHtml +=
            '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px;cursor:pointer;background:#fff;">' +
                '<input type="radio" name="mergeIngName" value="' + escapeHtml(nameOptions[n].name) + '" ' + checked + ' style="width:16px;height:16px;">' +
                '<span style="font-size:14px;">🧂 ' + escapeHtml(nameOptions[n].name) + '</span>' +
            '</label>';
    }

    var html =
        '<div id="adminMergeIngNameOverlay" class="modal-overlay" onclick="if(event.target===this)_adminCancelMergeIngredients()">' +
            '<div class="modal-box" style="text-align:left;">' +
                '<div class="modal-title">🔗 Chọn tên hiển thị sau gộp</div>' +
                '<div style="font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5;">' +
                    'Chọn tên từ danh sách hoặc nhập tên mới bên dưới:' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    nameRadiosHtml +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label class="edit-label">Hoặc nhập tên mới:</label>' +
                    '<input id="mergeIngNewNameInput" class="edit-field" type="text" placeholder="Nhập tên nguyên liệu mới..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;">' +
                '</div>' +
                '<div style="display:flex;gap:8px;">' +
                    '<button class="btn-save" style="flex:1;" onclick="_adminDoMergeIngredients()">✅ Xác nhận gộp</button>' +
                    '<button class="btn-cancel" style="flex:1;" onclick="_adminCancelMergeIngredients()">❌ Hủy</button>' +
                '</div>' +
            '</div>' +
        '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);

    // Focus vào input khi modal mở
    setTimeout(function() {
        var input = document.getElementById('mergeIngNewNameInput');
        if (input) input.focus();
    }, 100);
}

function _adminDoMergeIngredients() {
    var ids = _adminIngredientSelectedIds.slice();
    if (ids.length < 1) {
        showToast('Chưa chọn nguyên liệu nào!', 'warning');
        return;
    }

    // Lấy tên đã chọn từ radio hoặc input
    var selectedRadio = document.querySelector('input[name="mergeIngName"]:checked');
    var newNameInput = document.getElementById('mergeIngNewNameInput');
    var newName = '';

    if (newNameInput && newNameInput.value.trim()) {
        newName = newNameInput.value.trim();
    } else if (selectedRadio) {
        newName = selectedRadio.value;
    } else {
        showToast('Vui lòng chọn tên hoặc nhập tên mới!', 'warning');
        return;
    }

    if (!newName) {
        showToast('Vui lòng chọn tên hoặc nhập tên mới!', 'warning');
        return;
    }

    // Tìm targetId dựa trên tên đã chọn (nếu là tên từ danh sách)
    var targetId = ids[0];
    var list = window.ingredients || [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].name === newName && ids.indexOf(list[i].id) !== -1) {
            targetId = list[i].id;
            break;
        }
    }

    // Nếu là tên mới, cập nhật tên cho nguyên liệu đầu tiên
    var updateTargetName = false;
    var currentTargetName = '';
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === targetId) {
            currentTargetName = list[i].name;
            break;
        }
    }
    if (currentTargetName !== newName) {
        updateTargetName = true;
    }

    // Đóng modal chọn tên
    var nameOverlay = document.getElementById('adminMergeIngNameOverlay');
    if (nameOverlay && document.body.contains(nameOverlay)) {
        document.body.removeChild(nameOverlay);
    }

    // Cập nhật tất cả giao dịch cost_transactions trỏ về targetId
    var promises = [];
    var txs = expenseData.transactions || [];
    for (var i = 0; i < txs.length; i++) {
        var tx = txs[i];
        if (tx.ingredientId && ids.indexOf(tx.ingredientId) !== -1 && tx.ingredientId !== targetId) {
            promises.push(DB.update('cost_transactions', tx.id, { ingredientId: targetId }));
        }
    }

    // Cập nhật tên nếu là tên mới
    if (updateTargetName) {
        promises.push(DB.update('ingredients', targetId, { name: newName }));
    }

    // Cập nhật inventory_transactions
    promises.push(DB.getAll('inventory_transactions').then(function(invTxs) {
        var invPromises = [];
        for (var i = 0; i < invTxs.length; i++) {
            var inv = invTxs[i];
            if (inv.ingredientId && ids.indexOf(inv.ingredientId) !== -1 && inv.ingredientId !== targetId) {
                invPromises.push(DB.update('inventory_transactions', inv.id, { ingredientId: targetId }));
            }
        }
        return Promise.all(invPromises);
    }));

    // Xóa các nguyên liệu còn lại (đánh dấu deleted)
    for (var k = 0; k < ids.length; k++) {
        if (ids[k] !== targetId) {
            promises.push(DB.update('ingredients', ids[k], { deleted: true }));
        }
    }

    Promise.all(promises).then(function() {
        // Refresh cache
        return DB.getAll('ingredients');
    }).then(function(dbList) {
        window.ingredients = dbList;
        showToast('✅ Đã gộp ' + ids.length + ' nguyên liệu thành công', 'success');
        _adminCancelMergeIngredients();
        renderIngredientList();
    }).catch(function(err) {
        console.error('Merge ingredients error:', err);
        showToast('Lỗi khi gộp nguyên liệu!', 'error');
    });
}

function _adminCancelMergeIngredients() {
    // Đóng cả 2 overlay: danh sách chọn và chọn tên
    var overlays = ['adminMergeIngOverlay', 'adminMergeIngNameOverlay'];
    for (var oi = 0; oi < overlays.length; oi++) {
        var overlay = document.getElementById(overlays[oi]);
        if (overlay && document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    }
    _adminIngredientSelectedIds = [];
    _adminIngredientMergeMode = false;
    _adminIngredientContextId = null;
}

// ========== ADMIN: QUẢN LÝ DANH SÁCH TÊN HAO PHÍ ==========
var _adminWasteContextId = null;
var _adminWasteSelectedIds = [];
var _adminWasteMergeMode = false;

function _adminShowWasteContext(wasteId, event) {
    var currentUser = DB.getCurrentUser();
    if (!currentUser || currentUser.role !== 'admin') return;

    _adminWasteContextId = wasteId;
    _adminWasteSelectedIds = [wasteId];
    _adminWasteMergeMode = false;

    var cat = null;
    for (var i = 0; i < expenseData.categories.length; i++) {
        if (expenseData.categories[i].id === wasteId) { cat = expenseData.categories[i]; break; }
    }
    if (!cat) return;

    var html =
        '<div id="adminWasteContextOverlay" class="modal-overlay" onclick="if(event.target===this)_adminCloseWasteContext()">' +
            '<div class="modal-box" style="text-align:left;">' +
                '<div class="modal-title">📦 Hao phí: ' + escapeHtml(cat.name) + '</div>' +
                '<div class="admin-context-actions">' +
                    '<button class="admin-context-btn" onclick="_adminEditWasteCategory()">✏️ Sửa tên</button>' +
                    '<button class="admin-context-btn" onclick="_adminDeleteWasteCategory()">🗑️ Xóa hao phí</button>' +
                    '<button class="admin-context-btn" onclick="_adminMergeWasteCategories()">🔗 Gộp hao phí</button>' +
                '</div>' +
                '<button class="admin-context-close" onclick="_adminCloseWasteContext()">Đóng</button>' +
            '</div>' +
        '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);
}

function _adminCloseWasteContext() {
    var overlay = document.getElementById('adminWasteContextOverlay');
    if (overlay && document.body.contains(overlay)) {
        document.body.removeChild(overlay);
    }
    _adminWasteContextId = null;
    _adminWasteSelectedIds = [];
    _adminWasteMergeMode = false;
    var items = document.querySelectorAll('#expenseWasteGrid .waste-grid-item');
    for (var i = 0; i < items.length; i++) {
        items[i].classList.remove('waste-item-selected');
    }
}

function _adminEditWasteCategory() {
    var id = _adminWasteContextId;
    _adminCloseWasteContext();
    if (!id) return;

    var cat = null;
    for (var i = 0; i < expenseData.categories.length; i++) {
        if (expenseData.categories[i].id === id) { cat = expenseData.categories[i]; break; }
    }
    if (!cat) return;

    var html =
        '<div id="editWasteOverlay" class="modal-overlay" onclick="if(event.target===this)_adminCancelEditWaste()">' +
            '<div class="modal-box" style="text-align:left;">' +
                '<div class="modal-title">✏️ Sửa tên hao phí</div>' +
                '<div class="edit-field"><label class="edit-label">Tên hao phí</label>' +
                    '<input type="text" id="editWasteNameInput" class="form-input" value="' + escapeHtml(cat.name) + '"></div>' +
                '<div class="edit-actions">' +
                    '<button class="btn-save" onclick="_adminConfirmEditWaste(\'' + id + '\')">✅ Lưu</button>' +
                    '<button class="btn-cancel" onclick="_adminCancelEditWaste()">❌ Hủy</button>' +
                '</div>' +
            '</div>' +
        '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);
    setTimeout(function() {
        var input = document.getElementById('editWasteNameInput');
        if (input) input.focus();
    }, 100);
}

function _adminCancelEditWaste() {
    var overlay = document.getElementById('editWasteOverlay');
    if (overlay && document.body.contains(overlay)) {
        document.body.removeChild(overlay);
    }
}

function _adminConfirmEditWaste(id) {
    var newName = document.getElementById('editWasteNameInput').value.trim();
    if (!newName) {
        showToast('Vui lòng nhập tên hao phí!', 'warning');
        return;
    }

    DB.update('cost_categories', id, { name: newName }).then(function() {
        // Cập nhật cache
        for (var i = 0; i < expenseData.categories.length; i++) {
            if (expenseData.categories[i].id === id) {
                expenseData.categories[i].name = newName;
                break;
            }
        }
        showToast('✅ Đã cập nhật tên hao phí', 'success');
        _adminCancelEditWaste();
        renderWasteTypeList();
    }).catch(function(err) {
        console.error('Edit waste category error:', err);
        showToast('Lỗi khi cập nhật!', 'error');
    });
}

function _adminDeleteWasteCategory() {
    var id = _adminWasteContextId;
    _adminCloseWasteContext();
    if (!id) return;

    // Kiểm tra xem hao phí có giao dịch không
    var hasTx = false;
    var txs = expenseData.transactions || [];
    for (var i = 0; i < txs.length; i++) {
        if (txs[i].categoryId === id && !txs[i].deleted) {
            hasTx = true;
            break;
        }
    }

    var msg = 'Bạn có chắc muốn xóa hao phí này?';
    if (hasTx) {
        msg = '⚠️ <strong>Cảnh báo:</strong> Hao phí này đã có giao dịch.<br><br>Xóa sẽ chỉ đánh dấu ẩn, không ảnh hưởng dữ liệu cũ. Tiếp tục?';
    }

    _showConfirmModal(msg, 'Xóa', 'Hủy').then(function(confirmed) {
        if (!confirmed) return;
        DB.update('cost_categories', id, { deleted: true }).then(function() {
            // Cập nhật cache
            for (var i = 0; i < expenseData.categories.length; i++) {
                if (expenseData.categories[i].id === id) {
                    expenseData.categories[i].deleted = true;
                    break;
                }
            }
            showToast('🗑️ Đã xóa hao phí', 'success');
            renderWasteTypeList();
        }).catch(function(err) {
            console.error('Delete waste category error:', err);
            showToast('Lỗi khi xóa!', 'error');
        });
    });
}

function _adminMergeWasteCategories() {
    var firstId = _adminWasteContextId;
    _adminWasteMergeMode = true;
    _adminWasteSelectedIds = [firstId];

    // Tạo danh sách tất cả hao phí (chưa bị xóa) với checkbox
    var categories = expenseData.categories || [];
    var checklistHtml = '';
    for (var i = 0; i < categories.length; i++) {
        var cat = categories[i];
        if (cat.deleted) continue;
        var checked = (cat.id === firstId) ? 'checked' : '';
        checklistHtml +=
            '<label class="merge-checkbox-item" data-id="' + cat.id + '">' +
                '<input type="checkbox" class="merge-waste-checkbox" value="' + cat.id + '" ' + checked + '>' +
                '<span class="merge-item-icon">📦</span>' +
                '<span class="merge-item-name">' + escapeHtml(cat.name) + '</span>' +
            '</label>';
    }

    var html =
        '<div id="adminMergeWasteOverlay" class="modal-overlay" onclick="if(event.target===this)_adminCancelMergeWaste()">' +
            '<div class="modal-box" style="text-align:left;">' +
                '<div class="modal-title">🔗 Gộp hao phí</div>' +
                '<div style="font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5;">' +
                    'Chọn các hao phí muốn gộp (tích vào ô checkbox).<br>' +
                    'Đã chọn: <strong id="adminMergeWasteCount">1</strong> hao phí.<br>' +
                    'Sau khi gộp, các giao dịch cũ sẽ trỏ về hao phí được giữ lại.' +
                '</div>' +
                '<div id="adminMergeWasteList" class="merge-checklist">' +
                    checklistHtml +
                '</div>' +
                '<div style="display:flex;gap:8px;margin-top:12px;">' +
                    '<button class="btn-save" style="flex:1;" onclick="_adminConfirmMergeWaste()">✅ Gộp</button>' +
                    '<button class="btn-cancel" style="flex:1;" onclick="_adminCancelMergeWaste()">❌ Hủy</button>' +
                '</div>' +
            '</div>' +
        '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);

    // Gắn sự kiện change cho checkbox
    var checkboxes = document.querySelectorAll('.merge-waste-checkbox');
    for (var i = 0; i < checkboxes.length; i++) {
        checkboxes[i].addEventListener('change', function() {
            _adminWasteSelectedIds = [];
            var cbs = document.querySelectorAll('.merge-waste-checkbox:checked');
            for (var j = 0; j < cbs.length; j++) {
                _adminWasteSelectedIds.push(cbs[j].value);
            }
            if (_adminWasteSelectedIds.length === 0) {
                this.checked = true;
                _adminWasteSelectedIds.push(this.value);
            }
            _adminUpdateMergeWasteUI();
        });
    }

    _adminUpdateMergeWasteUI();
}

function _adminUpdateMergeWasteUI() {
    var countEl = document.getElementById('adminMergeWasteCount');
    if (countEl) countEl.textContent = _adminWasteSelectedIds.length;
}

function _adminConfirmMergeWaste() {
    if (_adminWasteSelectedIds.length < 1) {
        showToast('Chưa chọn hao phí nào!', 'warning');
        return;
    }

    var ids = _adminWasteSelectedIds.slice();
    var categories = expenseData.categories || [];

    // Lấy danh sách tên từ các hao phí được chọn
    var nameOptions = [];
    for (var i = 0; i < ids.length; i++) {
        for (var j = 0; j < categories.length; j++) {
            if (categories[j].id === ids[i]) {
                nameOptions.push({ id: ids[i], name: categories[j].name });
                break;
            }
        }
    }

    // Tạo modal chọn tên
    var nameRadiosHtml = '';
    for (var n = 0; n < nameOptions.length; n++) {
        var checked = (n === 0) ? 'checked' : '';
        nameRadiosHtml +=
            '<label style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:6px;margin-bottom:6px;cursor:pointer;background:#fff;">' +
                '<input type="radio" name="mergeWasteName" value="' + escapeHtml(nameOptions[n].name) + '" ' + checked + ' style="width:16px;height:16px;">' +
                '<span style="font-size:14px;">📦 ' + escapeHtml(nameOptions[n].name) + '</span>' +
            '</label>';
    }

    var html =
        '<div id="adminMergeWasteNameOverlay" class="modal-overlay" onclick="if(event.target===this)_adminCancelMergeWaste()">' +
            '<div class="modal-box" style="text-align:left;">' +
                '<div class="modal-title">🔗 Chọn tên hiển thị sau gộp</div>' +
                '<div style="font-size:13px;color:#475569;margin-bottom:12px;line-height:1.5;">' +
                    'Chọn tên từ danh sách hoặc nhập tên mới bên dưới:' +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    nameRadiosHtml +
                '</div>' +
                '<div style="margin-bottom:12px;">' +
                    '<label class="edit-label">Hoặc nhập tên mới:</label>' +
                    '<input id="mergeWasteNewNameInput" class="edit-field" type="text" placeholder="Nhập tên hao phí mới..." style="width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;">' +
                '</div>' +
                '<div style="display:flex;gap:8px;">' +
                    '<button class="btn-save" style="flex:1;" onclick="_adminDoMergeWaste()">✅ Xác nhận gộp</button>' +
                    '<button class="btn-cancel" style="flex:1;" onclick="_adminCancelMergeWaste()">❌ Hủy</button>' +
                '</div>' +
            '</div>' +
        '</div>';

    var temp = document.createElement('div');
    temp.innerHTML = html;
    document.body.appendChild(temp.firstElementChild);

    // Focus vào input khi modal mở
    setTimeout(function() {
        var input = document.getElementById('mergeWasteNewNameInput');
        if (input) input.focus();
    }, 100);
}

function _adminDoMergeWaste() {
    var ids = _adminWasteSelectedIds.slice();
    if (ids.length < 1) {
        showToast('Chưa chọn hao phí nào!', 'warning');
        return;
    }

    // Lấy tên đã chọn từ radio hoặc input
    var selectedRadio = document.querySelector('input[name="mergeWasteName"]:checked');
    var newNameInput = document.getElementById('mergeWasteNewNameInput');
    var newName = '';

    if (newNameInput && newNameInput.value.trim()) {
        newName = newNameInput.value.trim();
    } else if (selectedRadio) {
        newName = selectedRadio.value;
    } else {
        showToast('Vui lòng chọn tên hoặc nhập tên mới!', 'warning');
        return;
    }

    if (!newName) {
        showToast('Vui lòng chọn tên hoặc nhập tên mới!', 'warning');
        return;
    }

    // Tìm targetId dựa trên tên đã chọn (nếu là tên từ danh sách)
    var targetId = ids[0];
    var categories = expenseData.categories || [];
    for (var i = 0; i < categories.length; i++) {
        if (categories[i].name === newName && ids.indexOf(categories[i].id) !== -1) {
            targetId = categories[i].id;
            break;
        }
    }

    // Nếu là tên mới, cập nhật tên cho category đầu tiên
    var updateTargetName = false;
    var currentTargetName = '';
    for (var i = 0; i < categories.length; i++) {
        if (categories[i].id === targetId) {
            currentTargetName = categories[i].name;
            break;
        }
    }
    if (currentTargetName !== newName) {
        updateTargetName = true;
    }

    // Đóng modal chọn tên
    var nameOverlay = document.getElementById('adminMergeWasteNameOverlay');
    if (nameOverlay && document.body.contains(nameOverlay)) {
        document.body.removeChild(nameOverlay);
    }

    // Cập nhật tất cả giao dịch cost_transactions trỏ về targetId
    var promises = [];
    var txs = expenseData.transactions || [];
    for (var i = 0; i < txs.length; i++) {
        var tx = txs[i];
        if (tx.categoryId && ids.indexOf(tx.categoryId) !== -1 && tx.categoryId !== targetId) {
            promises.push(DB.update('cost_transactions', tx.id, { categoryId: targetId }));
        }
    }

    // Cập nhật tên nếu là tên mới
    if (updateTargetName) {
        promises.push(DB.update('cost_categories', targetId, { name: newName }));
    }

    // Xóa các category còn lại
    for (var k = 0; k < ids.length; k++) {
        if (ids[k] !== targetId) {
            promises.push(DB.update('cost_categories', ids[k], { deleted: true }));
        }
    }

    Promise.all(promises).then(function() {
        return loadExpenseData();
    }).then(function() {
        showToast('✅ Đã gộp ' + ids.length + ' hao phí thành công', 'success');
        _adminCancelMergeWaste();
        renderWasteTypeList();
    }).catch(function(err) {
        console.error('Merge waste categories error:', err);
        showToast('Lỗi khi gộp hao phí!', 'error');
    });
}

function _adminCancelMergeWaste() {
    // Đóng cả 2 overlay: danh sách chọn và chọn tên
    var overlays = ['adminMergeWasteOverlay', 'adminMergeWasteNameOverlay'];
    for (var oi = 0; oi < overlays.length; oi++) {
        var overlay = document.getElementById(overlays[oi]);
        if (overlay && document.body.contains(overlay)) {
            document.body.removeChild(overlay);
        }
    }
    _adminWasteSelectedIds = [];
    _adminWasteMergeMode = false;
    _adminWasteContextId = null;
}

// Giữ alias cho tương thích
function renderTodayExpenses() {
    _expenseViewDate = new Date();
    _expenseViewDateKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : _expenseViewDate.toISOString().slice(0, 10);
    expenseUpdateDateDisplay();
    renderExpensesByDate(_expenseViewDateKey);
}

// ========== TỔNG CHI PHÍ THÁNG (NHÓM THEO NGÀY, CÓ NÚT MỞ RỘNG) ==========
// FIX 2: Dùng expenseData.transactions (memory cache) thay vì DB.getAll('cost_transactions')
function renderMonthExpenseTotal() {
    var container = document.getElementById('expenseMonthTotal');
    if (!container) return;

    var allTx = expenseData.transactions || [];
    var currentUser = DB.getCurrentUser();
    var isAdminUser = currentUser && currentUser.role === 'admin';
    var now = new Date();
    // Dùng Date.UTC để tính start/end tháng đúng VN timezone
    var start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
    var end = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).toISOString().slice(0, 10);

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
// FIX 13: Dùng HTML string template thay vì document.createElement + inline styles
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
        var today = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
        if (tx.dateKey !== today) {
            showToast('Bạn chỉ được sửa chi phí trong ngày hôm nay!', 'warning');
            return;
        }
    }

    // Tạo modal inline sửa chi phí bằng HTML string template
    var qtyFieldHtml = '';
    if (tx.costType === 'ingredient') {
        qtyFieldHtml = '<div class="edit-field"><label class="edit-label">Số lượng</label>' +
            '<input type="number" id="editExpenseQty" class="form-input" value="' + (tx.ingredientQty || 1) + '" min="1" step="1"></div>';
    }

    var editHtml =
        '<div id="editExpenseOverlay" class="modal-overlay" onclick="if(event.target===this)cancelEditExpense()">' +
            '<div class="modal-box">' +
                '<div class="modal-title">✏️ Sửa chi phí</div>' +
                '<div class="expense-edit-form">' +
                    '<div class="edit-field"><label class="edit-label">Tên chi phí</label>' +
                        '<input type="text" id="editExpenseName" class="form-input" value="' + escapeHtml(tx.categoryName) + '"></div>' +
                    qtyFieldHtml +
                    '<div class="edit-field"><label class="edit-label">Thành tiền</label>' +
                        '<input type="number" id="editExpenseAmount" class="form-input" value="' + tx.amount + '" step="1000"></div>' +
                    '<div class="edit-actions">' +
                        '<button class="btn-save" onclick="confirmEditExpense(\'' + tx.id + '\')">✅ Lưu</button>' +
                        '<button class="btn-cancel" onclick="cancelEditExpense()">❌ Hủy</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';

    // Chèn vào body
    var tempContainer = document.createElement('div');
    tempContainer.innerHTML = editHtml;
    document.body.appendChild(tempContainer.firstElementChild);
}

// FIX 5: confirmEditExpense dùng cache thay vì query lại expenseData.transactions
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

    // Lưu thông tin cũ để điều chỉnh quỹ sau này
    var oldTx = _findTxInCache(id);
    var oldAmount = oldTx ? oldTx.amount : 0;
    var oldName = oldTx ? oldTx.categoryName : '';
    var oldFundSource = oldTx ? oldTx.fundSource : '';
    
    // Xác định xem có cần điều chỉnh quỹ không
    // - Cũ là "Quỹ trách nhiệm" + pos_cash → cần hoàn lại oldAmount
    // - Mới là "Quỹ trách nhiệm" + pos_cash → cần trừ newAmount
    var wasFundExpense = oldName === 'Quỹ trách nhiệm' && oldFundSource === 'pos_cash';
    var willBeFundExpense = newName === 'Quỹ trách nhiệm'; // fundSource giữ nguyên pos_cash

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
        // Waste: cập nhật unitPrice nếu có quantity - dùng cache
        var tx = _findTxInCache(id);
        if (tx && tx.ingredientQty > 0) {
            updateData.ingredientUnitPrice = Math.round(newAmount / tx.ingredientQty);
        }
    }

    DB.update('cost_transactions', id, updateData).then(function() {
        return loadExpenseData();
    }).then(function() {
        // Điều chỉnh quỹ nếu liên quan đến "Quỹ trách nhiệm"
        if (wasFundExpense && willBeFundExpense) {
            // Cả cũ và mới đều là quỹ trách nhiệm → điều chỉnh chênh lệch
            if (oldAmount !== newAmount) {
                _adjustFundForExpenseChange('edit', oldAmount, newAmount);
            }
        } else if (wasFundExpense && !willBeFundExpense) {
            // Đổi từ quỹ trách nhiệm → loại khác → hoàn lại toàn bộ
            _adjustFundForExpenseChange('edit', oldAmount, 0);
        } else if (!wasFundExpense && willBeFundExpense) {
            // Đổi từ loại khác → quỹ trách nhiệm → trừ tiền (ghi nhận rút quỹ)
            _adjustFundForExpenseChange('edit', 0, newAmount);
        }
        showToast('✅ Đã cập nhật chi phí', 'success');
        cancelEditExpense();
        renderTodayExpenses();
        renderMonthExpenseTotal();
    }).catch(function(err) {
        console.error('Edit expense error:', err);
        showToast('Lỗi khi cập nhật!', 'error');
    });
}

// Helper: tìm transaction trong cache theo id
function _findTxInCache(id) {
    var txs = expenseData.transactions || [];
    for (var i = 0; i < txs.length; i++) {
        if (txs[i].id === id) return txs[i];
    }
    return null;
}

function cancelEditExpense() {
    var overlay = document.getElementById('editExpenseOverlay');
    if (overlay) {
        document.body.removeChild(overlay);
    }
}

// ========== XÓA CHI PHÍ ==========
// FIX 12: Dùng _showConfirmModal thay vì confirm() native
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
        var today = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
        if (tx.dateKey !== today) {
            showToast('Bạn chỉ được xóa chi phí trong ngày hôm nay!', 'warning');
            return;
        }
    }

    // Admin: cảnh báo nếu trong kỳ có chi phí khác
    if (isAdminUser) {
        var periodCosts = _countPeriodCosts(tx);
        if (periodCosts > 0) {
            _showConfirmModal(
                '⚠️ <strong>Cảnh báo:</strong> Trong kỳ này còn <strong>' + periodCosts + '</strong> chi phí khác.<br><br>' +
                'Xóa chi phí này có thể ảnh hưởng đến báo cáo kỳ. Bạn có chắc muốn xóa?',
                'Tiếp tục xóa',
                'Hủy'
            ).then(function(proceed) {
                if (proceed) {
                    _doDeleteConfirmSteps(tx, id);
                }
            });
            return;
        }
    }

    _doDeleteConfirmSteps(tx, id);
}

// Đếm số chi phí khác trong cùng kỳ (kỳ 20-tháng trước → 19-tháng này)
function _countPeriodCosts(tx) {
    if (!tx || !tx.dateKey) return 0;
    var parts = tx.dateKey.split('-');
    if (parts.length !== 3) return 0;
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10);
    var day = parseInt(parts[2], 10);

    // Dùng Date.UTC để tạo date string đúng với timezone VN (+7)
    function toDateKeyUTC(y, m, d) {
        var dt = new Date(Date.UTC(y, m - 1, d));
        return dt.toISOString().slice(0, 10);
    }

    var startStr, endStr;
    if (day >= 20) {
        startStr = toDateKeyUTC(year, month, 20);
        endStr = toDateKeyUTC(year, month + 1, 19);
    } else {
        startStr = toDateKeyUTC(year, month - 1, 20);
        endStr = toDateKeyUTC(year, month, 19);
    }

    var count = 0;
    var allTx = expenseData.transactions || [];
    for (var i = 0; i < allTx.length; i++) {
        var c = allTx[i];
        if (c && !c.deleted && c.id !== tx.id && c.dateKey >= startStr && c.dateKey <= endStr) {
            count++;
        }
    }
    return count;
}

function _doDeleteConfirmSteps(tx, id) {
    // Bước 1: Xác nhận xóa
    _showConfirmModal(
        'Bạn có chắc muốn xóa chi phí "<strong>' + escapeHtml(tx.categoryName) + '</strong>"?',
        'Xóa',
        'Hủy'
    ).then(function(confirmed) {
        if (!confirmed) return;

        // Bước 2: Nếu là chi phí nguyên liệu, hỏi có hoàn lại tồn kho không
        if (tx.costType === 'ingredient' && tx.ingredientId && tx.ingredientQty) {
            _showConfirmModal(
                'Chi phí này đã tăng tồn kho.<br><br>Bạn có muốn <strong>hoàn lại tồn kho</strong> không?',
                '✅ Hoàn lại',
                '❌ Không hoàn'
            ).then(function(revertStock) {
                doDeleteExpense(tx, id, revertStock);
            });
        } else {
            doDeleteExpense(tx, id, false);
        }
    });
}

function doDeleteExpense(tx, id, revertStock) {
    var deletePromise;
    if (revertStock && tx.ingredientId && tx.ingredientQty) {
        deletePromise = addIngredientStock(tx.ingredientId, -tx.ingredientQty);
    } else {
        deletePromise = Promise.resolve();
    }

    deletePromise.then(function() {
        return DB.update('cost_transactions', id, { deleted: true });
    }).then(function() {
        return loadExpenseData();
    }).then(function() {
        // Nếu xóa chi phí "Quỹ trách nhiệm" → hoàn lại tiền vào quỹ
        if (tx && tx.categoryName === 'Quỹ trách nhiệm' && tx.fundSource === 'pos_cash' && tx.amount > 0) {
            _adjustFundForExpenseChange('delete', tx.amount, 0);
        }
        showToast('🗑️ Đã xóa chi phí', 'success');
        renderTodayExpenses();
        renderMonthExpenseTotal();
        renderIngredientList();
    }).catch(function(err) {
        console.error('Delete expense error:', err);
        showToast('Lỗi khi xóa chi phí!', 'error');
    });
}

// Điều chỉnh quỹ trách nhiệm khi xóa/sửa chi phí liên quan
// type: 'delete' | 'edit'
// oldAmount: số tiền cũ của chi phí
// newAmount: số tiền mới (0 nếu xóa)
function _adjustFundForExpenseChange(type, oldAmount, newAmount) {
    try {
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = firebase.database().ref(shopId + '/responsibility_fund');
        
        fundRef.child('balance').once('value').then(function(snapshot) {
            var currentBalance = snapshot.val() || 0;
            
            // Tính số tiền cần điều chỉnh
            // Xóa: hoàn lại oldAmount (balance + oldAmount)
            // Sửa: hoàn oldAmount, trừ newAmount (balance + oldAmount - newAmount)
            var adjustment = oldAmount - newAmount;
            var newBalance = currentBalance + adjustment;
            
            // Nếu sửa tăng số tiền, kiểm tra không vượt quá quỹ
            // (adjustment âm = đang trừ thêm tiền từ quỹ)
            // Cho phép âm quỹ nhưng cảnh báo
            if (adjustment < 0 && newBalance < 0) {
                // Cảnh báo quỹ sẽ âm nhưng vẫn cho phép
            }
            
            var note = '';
            if (type === 'delete') {
                note = 'Hoàn lại từ xóa chi phí';
            } else {
                note = 'Điều chỉnh từ sửa chi phí (cũ: ' + formatMoney(oldAmount) + ' → mới: ' + formatMoney(newAmount) + ')';
            }
            
            var historyEntry = {
                type: 'refund',
                amount: adjustment,
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                note: note,
                createdAt: Date.now(),
                createdBy: window.currentDeviceId || 'system'
            };
            
            var historyRef = fundRef.child('history').push();
            var updates = {};
            updates['balance'] = newBalance;
            updates['history/' + historyRef.key] = historyEntry;
            
            return fundRef.update(updates);
        }).catch(function(err) {
            // Bỏ qua lỗi, không ảnh hưởng chính
        });
    } catch (e) {
        // Bỏ qua lỗi
    }
}

// ========== GẮN SỰ KIỆN ==========
// FIX 9: Kiểm tra _eventsAttached flag để tránh gắn listener chồng chéo
var _expenseEventsAttached = false;

function attachExpenseEvents() {
    if (_expenseEventsAttached) return;
    _expenseEventsAttached = true;

    // Đóng modal
    var closeBtns = document.querySelectorAll('[data-close="expenseModal"]');
    for (var i = 0; i < closeBtns.length; i++) {
        closeBtns[i].onclick = function() { closeModal('expenseModal'); };
    }

    // Biến tham chiếu ô tìm kiếm (dùng chung cho _filterBothGrids và _renderSearchResults)
    var _ingSearchRef = document.getElementById('expenseIngredientSearch');
    var _wasteSearchRef = document.getElementById('expenseWasteSearch');

    // Nút "+ Thêm" - gọi doSaveExpense với giá trị từ ô tìm kiếm
    var addIngBtn = document.getElementById('addNewIngredientBtn');
    if (addIngBtn) {
        addIngBtn.onclick = function() {
            var searchVal = document.getElementById('expenseIngredientSearch').value.trim();
            if (!searchVal) {
                showToast('Vui lòng nhập tên nguyên liệu hoặc hao phí!', 'warning');
                return;
            }
            _expenseSelectedType = 'ingredient';
            doSaveExpense();
        };
    }

    var addWasteBtn = document.getElementById('addNewWasteBtn');
    if (addWasteBtn) {
        addWasteBtn.onclick = function() {
            var searchVal = document.getElementById('expenseWasteSearch').value.trim();
            if (!searchVal) {
                showToast('Vui lòng nhập tên nguyên liệu hoặc hao phí!', 'warning');
                return;
            }
            _expenseSelectedType = 'waste';
            doSaveExpense();
        };
    }

    // Tìm kiếm chung: gõ ở ô tìm kiếm nào cũng hiển thị kết quả chung (nguyên liệu + hao phí)
    function _filterBothGrids() {
        var rawKeyword = this.value.trim();
        var keyword = rawKeyword.toLowerCase();
        var searchKey = _removeVietnameseTones(keyword).replace(/\s+/g, '');

        var ingGrid = document.getElementById('expenseIngredientGrid');
        var wasteGrid = document.getElementById('expenseWasteGrid');
        var ingResults = document.getElementById('expenseIngredientSearchResults');
        var wasteResults = document.getElementById('expenseWasteSearchResults');

        // Đồng bộ giá trị sang ô tìm kiếm kia
        if (this !== _ingSearchRef && _ingSearchRef) _ingSearchRef.value = this.value;
        if (this !== _wasteSearchRef && _wasteSearchRef) _wasteSearchRef.value = this.value;

        if (searchKey === '') {
            // Không có từ khóa: ẩn kết quả tìm kiếm, hiện grid gốc
            if (ingResults) ingResults.style.display = 'none';
            if (wasteResults) wasteResults.style.display = 'none';
            if (ingGrid) ingGrid.style.display = '';
            if (wasteGrid) wasteGrid.style.display = '';
            return;
        }

        // Có từ khóa: thu thập kết quả từ cả nguyên liệu và hao phí
        var exactResults = [];   // Khớp chính xác (cả dấu)
        var fuzzyResults = [];   // Khớp gần đúng (sau khi bỏ dấu)

        // Tìm trong nguyên liệu (window.ingredients)
        var ingList = window.ingredients || [];
        for (var i = 0; i < ingList.length; i++) {
            var ing = ingList[i];
            if (ing.deleted) continue;
            var ingNameLower = ing.name.toLowerCase();
            var ingNameNoTone = _removeVietnameseTones(ingNameLower).replace(/\s+/g, '');

            if (ingNameLower.indexOf(keyword) !== -1) {
                // Khớp chính xác (có dấu)
                var stockVal = (typeof ing.stock === 'number' && !isNaN(ing.stock)) ? ing.stock : (parseFloat(ing.stock) || 0);
                exactResults.push({
                    type: 'ingredient',
                    id: ing.id,
                    name: ing.name,
                    stock: Math.round(stockVal * 100) / 100 + (ing.unit ? ' ' + ing.unit : '')
                });
            } else if (ingNameNoTone.indexOf(searchKey) !== -1) {
                // Khớp gần đúng (bỏ dấu)
                var stockVal = (typeof ing.stock === 'number' && !isNaN(ing.stock)) ? ing.stock : (parseFloat(ing.stock) || 0);
                fuzzyResults.push({
                    type: 'ingredient',
                    id: ing.id,
                    name: ing.name,
                    stock: Math.round(stockVal * 100) / 100 + (ing.unit ? ' ' + ing.unit : '')
                });
            }
        }

        // Tìm trong hao phí (expenseData.categories)
        var wasteList = expenseData.categories || [];
        for (var i = 0; i < wasteList.length; i++) {
            var cat = wasteList[i];
            if (cat && !cat.deleted) {
                var catNameLower = cat.name.toLowerCase();
                var catNameNoTone = _removeVietnameseTones(catNameLower).replace(/\s+/g, '');

                if (catNameLower.indexOf(keyword) !== -1) {
                    // Khớp chính xác (có dấu)
                    exactResults.push({
                        type: 'waste',
                        id: cat.id,
                        name: cat.name
                    });
                } else if (catNameNoTone.indexOf(searchKey) !== -1) {
                    // Khớp gần đúng (bỏ dấu)
                    fuzzyResults.push({
                        type: 'waste',
                        id: cat.id,
                        name: cat.name
                    });
                }
            }
        }

        // Ẩn grid gốc, hiện kết quả tìm kiếm
        if (ingGrid) ingGrid.style.display = 'none';
        if (wasteGrid) wasteGrid.style.display = 'none';

        // Render kết quả vào container tương ứng
        _renderSearchResults(ingResults, exactResults, fuzzyResults);
        _renderSearchResults(wasteResults, exactResults, fuzzyResults);

        if (ingResults) ingResults.style.display = '';
        if (wasteResults) wasteResults.style.display = '';
    }

    // Helper: render danh sách kết quả tìm kiếm chung vào container
    function _renderSearchResults(container, exactResults, fuzzyResults) {
        if (!container) return;

        if (exactResults.length === 0 && fuzzyResults.length === 0) {
            container.innerHTML = '<div class="search-empty">Không tìm thấy kết quả phù hợp</div>';
            return;
        }

        var html = '';

        // Render kết quả chính xác trước
        for (var i = 0; i < exactResults.length; i++) {
            var item = exactResults[i];
            var icon = (item.type === 'ingredient') ? '🧂' : '📦';
            var typeLabel = (item.type === 'ingredient') ? 'Nguyên liệu' : 'Hao phí';
            var stockHtml = (item.type === 'ingredient' && item.stock) ? '<span class="search-result-stock">Tồn: ' + item.stock + '</span>' : '';

            html += '<div class="search-result-item" data-type="' + item.type + '" data-id="' + escapeHtml(item.id) + '" data-name="' + escapeHtml(item.name) + '">' +
                '<span class="search-result-icon">' + icon + '</span>' +
                '<div class="search-result-info">' +
                    '<div class="search-result-name">' + escapeHtml(item.name) + '</div>' +
                    '<div class="search-result-type">' + typeLabel + '</div>' +
                '</div>' +
                stockHtml +
            '</div>';
        }

        // Render kết quả đề xuất (nếu có)
        if (fuzzyResults.length > 0) {
            html += '<div class="search-result-divider">🔍 Gợi ý</div>';
            for (var i = 0; i < fuzzyResults.length; i++) {
                var item = fuzzyResults[i];
                var icon = (item.type === 'ingredient') ? '🧂' : '📦';
                var typeLabel = (item.type === 'ingredient') ? 'Nguyên liệu' : 'Hao phí';
                var stockHtml = (item.type === 'ingredient' && item.stock) ? '<span class="search-result-stock">Tồn: ' + item.stock + '</span>' : '';

                html += '<div class="search-result-item search-result-fuzzy" data-type="' + item.type + '" data-id="' + escapeHtml(item.id) + '" data-name="' + escapeHtml(item.name) + '">' +
                    '<span class="search-result-icon">' + icon + '</span>' +
                    '<div class="search-result-info">' +
                        '<div class="search-result-name">' + escapeHtml(item.name) + '</div>' +
                        '<div class="search-result-type">' + typeLabel + '</div>' +
                    '</div>' +
                    stockHtml +
                '</div>';
            }
        }

        container.innerHTML = html;

        // Gắn sự kiện click cho từng item
        var items = container.querySelectorAll('.search-result-item');
        for (var i = 0; i < items.length; i++) {
            items[i].onclick = function() {
                var type = this.getAttribute('data-type');
                var id = this.getAttribute('data-id');
                var name = this.getAttribute('data-name');

                if (type === 'ingredient') {
                    onIngredientSelected(id, name);
                } else {
                    onWasteTypeSelected(id, name);
                }

                // Đồng bộ clear ô tìm kiếm còn lại
                if (_ingSearchRef) _ingSearchRef.value = '';
                if (_wasteSearchRef) _wasteSearchRef.value = '';

                // Ẩn kết quả tìm kiếm, hiện lại grid
                var ingResults = document.getElementById('expenseIngredientSearchResults');
                var wasteResults = document.getElementById('expenseWasteSearchResults');
                var ingGrid = document.getElementById('expenseIngredientGrid');
                var wasteGrid = document.getElementById('expenseWasteGrid');
                if (ingResults) ingResults.style.display = 'none';
                if (wasteResults) wasteResults.style.display = 'none';
                if (ingGrid) ingGrid.style.display = '';
                if (wasteGrid) wasteGrid.style.display = '';
            };
        }
    }

    if (_ingSearchRef) {
        _ingSearchRef.addEventListener('input', _filterBothGrids);
    }

    if (_wasteSearchRef) {
        _wasteSearchRef.addEventListener('input', _filterBothGrids);
    }
}

// ========== XÓA CHI PHÍ CŨ THEO NGÀY ==========
function _showDeleteOldExpensesModal() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = function(e) { if (e.target === overlay) { cleanup(); } };

    var now = new Date();
    var firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    var yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    function fmt(d) {
        // Dùng getTodayDateKey nếu là hôm nay, nếu không thì dùng toISOString
        var now = new Date();
        if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
            return typeof getTodayDateKey === 'function' ? getTodayDateKey() : d.toISOString().slice(0, 10);
        }
        return d.toISOString().slice(0, 10);
    }

    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;padding:24px;width:380px;max-width:90vw;box-shadow:0 8px 30px rgba(0,0,0,0.2);';

    box.innerHTML =
        '<div style="font-size:17px;font-weight:600;margin-bottom:16px;color:#1e293b;">🗑️ Xóa chi phí cũ</div>' +
        '<div style="font-size:13px;color:#64748b;margin-bottom:16px;">Chọn khoảng ngày để xóa chi phí. Chi phí trong khoảng này sẽ bị xóa nhưng <b>danh sách tên nguyên liệu/hao phí vẫn được giữ nguyên</b>.</div>' +
        '<div style="margin-bottom:12px;">' +
            '<label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:4px;">Từ ngày</label>' +
            '<input type="date" id="deleteFromDate" value="' + fmt(firstDay) + '" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
            '<label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:4px;">Đến ngày</label>' +
            '<input type="date" id="deleteToDate" value="' + fmt(yesterday) + '" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">' +
        '</div>' +
        '<div id="deletePreviewInfo" style="font-size:13px;color:#64748b;margin-bottom:16px;padding:10px;background:#f8fafc;border-radius:8px;">Đang tính toán...</div>' +
        '<div style="display:flex;gap:10px;justify-content:center;">' +
            '<button id="deleteOldCancelBtn" style="flex:1;padding:10px 16px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;color:#475569;font-size:14px;cursor:pointer;">Hủy</button>' +
            '<button id="deleteOldConfirmBtn" style="flex:1;padding:10px 16px;border:none;border-radius:10px;background:#ef4444;color:#fff;font-size:14px;font-weight:600;cursor:pointer;" disabled>Xóa</button>' +
        '</div>';

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function cleanup() {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
    }

    // Cập nhật preview khi thay đổi ngày
    function updatePreview() {
        var fromDate = document.getElementById('deleteFromDate').value;
        var toDate = document.getElementById('deleteToDate').value;
        var previewEl = document.getElementById('deletePreviewInfo');
        var confirmBtn = document.getElementById('deleteOldConfirmBtn');

        if (!fromDate || !toDate) {
            previewEl.innerHTML = 'Vui lòng chọn đầy đủ ngày bắt đầu và kết thúc.';
            confirmBtn.disabled = true;
            return;
        }
        if (fromDate > toDate) {
            previewEl.innerHTML = '⚠️ Ngày bắt đầu phải trước ngày kết thúc.';
            confirmBtn.disabled = true;
            return;
        }

        // Đếm số giao dịch trong khoảng
        var count = 0;
        var totalAmount = 0;
        var txList = window.expenseData ? (window.expenseData.transactions || []) : [];
        for (var i = 0; i < txList.length; i++) {
            var tx = txList[i];
            if (tx.dateKey >= fromDate && tx.dateKey <= toDate && !tx.deleted) {
                count++;
                totalAmount += tx.amount || 0;
            }
        }

        if (count === 0) {
            previewEl.innerHTML = '✅ Không có chi phí nào trong khoảng ngày này.';
            confirmBtn.disabled = true;
        } else {
            previewEl.innerHTML = '📋 Có <b>' + count + '</b> giao dịch chi phí, tổng tiền: <b>' + formatMoney(totalAmount) + '</b>';
            confirmBtn.disabled = false;
        }
    }

    document.getElementById('deleteFromDate').addEventListener('change', updatePreview);
    document.getElementById('deleteToDate').addEventListener('change', updatePreview);
    document.getElementById('deleteOldCancelBtn').onclick = cleanup;
    document.getElementById('deleteOldConfirmBtn').onclick = function() {
        var fromDate = document.getElementById('deleteFromDate').value;
        var toDate = document.getElementById('deleteToDate').value;
        cleanup();
        _doDeleteOldExpenses(fromDate, toDate);
    };

    // Preview ngay khi mở
    setTimeout(updatePreview, 50);
}

function _doDeleteOldExpenses(fromDate, toDate) {
    var txList = window.expenseData ? (window.expenseData.transactions || []) : [];
    var toDelete = [];
    var totalAmount = 0;
    for (var i = 0; i < txList.length; i++) {
        var tx = txList[i];
        if (tx.dateKey >= fromDate && tx.dateKey <= toDate && !tx.deleted) {
            toDelete.push(tx);
            totalAmount += tx.amount || 0;
        }
    }

    if (toDelete.length === 0) {
        showToast('Không có chi phí nào để xóa!', 'info');
        return;
    }

    _showConfirmModal(
        'Bạn có chắc chắn muốn xóa <b>' + toDelete.length + '</b> giao dịch chi phí (tổng <b>' + formatMoney(totalAmount) + '</b>) trong khoảng từ <b>' + fromDate + '</b> đến <b>' + toDate + '</b>?<br><br>📌 <b>Danh sách tên nguyên liệu và hao phí sẽ được giữ nguyên.</b>',
        'Xóa tất cả',
        'Hủy'
    ).then(function(confirmed) {
        if (!confirmed) return;

        var deletedCount = 0;
        var promises = [];
        for (var j = 0; j < toDelete.length; j++) {
            (function(tx) {
                promises.push(
                    DB.update('cost_transactions', tx.id, { deleted: true }).then(function() {
                        tx.deleted = true;
                        deletedCount++;
                    }).catch(function(err) {
                        console.error('Delete expense error:', tx.id, err);
                    })
                );
            })(toDelete[j]);
        }

        Promise.all(promises).then(function() {
            showToast('✅ Đã xóa ' + deletedCount + '/' + toDelete.length + ' giao dịch chi phí!', 'success');
            // Reload dữ liệu
            loadExpenseData().then(function() {
                renderTodayExpenses();
                renderMonthExpenseTotal();
            });
        });
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
window.toggleMonthDateDetail = toggleMonthDateDetail;
window.expenseDateChange = expenseDateChange;
window.expensePickDate = expensePickDate;
window.toggleAllMonthDates = toggleAllMonthDates;

// Export swipe + admin context menu functions (gọi từ HTML onclick)
window._adminTouchStart = _adminTouchStart;
window._adminTouchMove = _adminTouchMove;
window._adminTouchEnd = _adminTouchEnd;
window._adminSwipeDelete = _adminSwipeDelete;
window._adminMouseDown = _adminMouseDown;
window._adminMouseUp = _adminMouseUp;
window._adminMouseLeave = _adminMouseLeave;
window._showAdminContextMenu = _showAdminContextMenu;
window._closeAdminContextMenu = _closeAdminContextMenu;
window._adminEditExpense = _adminEditExpense;
window._adminDeleteExpense = _adminDeleteExpense;
window._adminStartMerge = _adminStartMerge;
window._adminToggleMergeItem = _adminToggleMergeItem;
window._adminConfirmMerge = _adminConfirmMerge;
window._adminCancelMerge = _adminCancelMerge;

// Export ingredient admin functions
window._adminIngTouchStart = _adminIngTouchStart;
window._adminIngTouchEnd = _adminIngTouchEnd;
window._adminIngMouseDown = _adminIngMouseDown;
window._adminIngMouseUp = _adminIngMouseUp;
window._adminIngMouseLeave = _adminIngMouseLeave;
window._adminShowIngredientContext = _adminShowIngredientContext;
window._adminCloseIngredientContext = _adminCloseIngredientContext;
window._adminEditIngredientName = _adminEditIngredientName;
window._adminCancelEditIngredient = _adminCancelEditIngredient;
window._adminConfirmEditIngredient = _adminConfirmEditIngredient;
window._adminDeleteIngredient = _adminDeleteIngredient;
window._adminMergeIngredients = _adminMergeIngredients;
window._adminConfirmMergeIngredients = _adminConfirmMergeIngredients;
window._adminDoMergeIngredients = _adminDoMergeIngredients;
window._adminCancelMergeIngredients = _adminCancelMergeIngredients;

// Export waste admin functions
window._adminWasteTouchStart = _adminWasteTouchStart;
window._adminWasteTouchEnd = _adminWasteTouchEnd;
window._adminWasteMouseDown = _adminWasteMouseDown;
window._adminWasteMouseUp = _adminWasteMouseUp;
window._adminWasteMouseLeave = _adminWasteMouseLeave;
window._adminShowWasteContext = _adminShowWasteContext;
window._adminCloseWasteContext = _adminCloseWasteContext;
window._adminEditWasteCategory = _adminEditWasteCategory;
window._adminCancelEditWaste = _adminCancelEditWaste;
window._adminConfirmEditWaste = _adminConfirmEditWaste;
window._adminDeleteWasteCategory = _adminDeleteWasteCategory;
window._adminMergeWasteCategories = _adminMergeWasteCategories;
window._adminConfirmMergeWaste = _adminConfirmMergeWaste;
window._adminDoMergeWaste = _adminDoMergeWaste;
window._adminCancelMergeWaste = _adminCancelMergeWaste;

// Export delete old expenses functions
window._showDeleteOldExpensesModal = _showDeleteOldExpensesModal;
window._doDeleteOldExpenses = _doDeleteOldExpenses;
