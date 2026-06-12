// inventory-manager.js - Quản lý thực đơn & tồn kho (Admin)
// ES5, tương thích Android 6, iOS 12

// ========== BIẾN TẠM ==========
var _editingCategoryId = null;
var _editingMenuItemId = null;
var _editingIngredientId = null;
// FIX: Cờ chống bấm nhiều lần (double-submit)
var _savingCategory = false;
var _savingMenuItem = false;
var _savingIngredient = false;

// ========== BIẾN TẠM CHO MODAL THÊM MÓN (dùng data-driven rendering) ==========
var _addModalSizes = [];         // Mảng các size: { name, price, ingredients: [{ingredientId, quantity, unit}] }
var _addModalIngredients = [];   // Mảng nguyên liệu chung: [{ingredientId, quantity, unit}]

// ========== RENDER DANH MỤC ==========
function renderInventoryCategoryFilter() {
    var filter = document.getElementById('invMenuFilter');
    var catSelect = document.getElementById('invMenuItemCategory');
    var catSelectModal = document.getElementById('invMenuItemCategoryModal');
    if (!filter && !catSelect && !catSelectModal) return;
    
    var cats = menuCategories || [];
    // Sắp xếp theo thứ tự
    cats.sort(function(a, b) { return (a.order || 999) - (b.order || 999); });
    
    var optionsHtml = '<option value="all">📋 Tất cả danh mục</option>';
    var catOptionsHtml = '<option value="">-- Chọn danh mục --</option>';
    for (var i = 0; i < cats.length; i++) {
        var c = cats[i];
        var name = escapeHtml(c.name || '');
        optionsHtml += '<option value="' + c.id + '">' + name + '</option>';
        catOptionsHtml += '<option value="' + c.id + '">' + name + '</option>';
    }
    if (filter) filter.innerHTML = optionsHtml;
    if (catSelect) catSelect.innerHTML = catOptionsHtml;
    if (catSelectModal) catSelectModal.innerHTML = catOptionsHtml;
}

function renderInventoryCategories() {
    var container = document.getElementById('invCategoryList');
    if (!container) return;
    
    var cats = menuCategories || [];
    cats.sort(function(a, b) { return (a.order || 999) - (b.order || 999); });
    
    if (cats.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có danh mục nào</div>';
        return;
    }
    
    var html = '';
    for (var i = 0; i < cats.length; i++) {
        var c = cats[i];
        html += '<div class="inv-category-item" onclick="editCategory(\'' + c.id + '\')">' +
            '<div class="inv-cat-info">' +
                '<span class="inv-cat-name">' + escapeHtml(c.name || '') + '</span>' +
                '<span class="inv-cat-order">#' + (c.order || '-') + '</span>' +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;
}

// ========== CRUD DANH MỤC ==========
function showAddCategoryForm() {
    _editingCategoryId = null;
    var titleEl = document.getElementById('addCategoryModalTitle');
    var nameInput = document.getElementById('addModalCategoryName');
    var orderInput = document.getElementById('addModalCategoryOrder');
    var errorEl = document.getElementById('addModalCategoryError');
    if (titleEl) titleEl.innerText = '➕ Thêm danh mục';
    if (nameInput) { nameInput.value = ''; }
    if (orderInput) orderInput.value = '';
    if (errorEl) errorEl.innerText = '';
    openBottomSheet('addCategoryModal');
    setTimeout(function() { if (nameInput) nameInput.focus(); }, 300);
}

function hideAddCategoryForm() {
    closeModal('addCategoryModal');
    _editingCategoryId = null;
}

function editCategory(catId) {
    if (!catId) return;
    var cats = menuCategories || [];
    var cat = null;
    for (var i = 0; i < cats.length; i++) {
        if (cats[i].id === catId) { cat = cats[i]; break; }
    }
    if (!cat) return;
    
    _editingCategoryId = catId;
    var titleEl = document.getElementById('addCategoryModalTitle');
    var nameInput = document.getElementById('addModalCategoryName');
    var orderInput = document.getElementById('addModalCategoryOrder');
    var errorEl = document.getElementById('addModalCategoryError');
    if (titleEl) titleEl.innerText = '✏️ Sửa danh mục: ' + (cat.name || '');
    if (nameInput) { nameInput.value = cat.name || ''; }
    if (orderInput) orderInput.value = cat.order || '';
    if (errorEl) errorEl.innerText = '';
    openBottomSheet('addCategoryModal');
    setTimeout(function() { if (nameInput) nameInput.focus(); }, 300);
}

function handleSaveCategory() {
    // FIX: Chống double-submit
    if (_savingCategory) return;
    
    var nameInput = document.getElementById('addModalCategoryName');
    var orderInput = document.getElementById('addModalCategoryOrder');
    var errorEl = document.getElementById('addModalCategoryError');
    
    if (!nameInput) return;
    var name = nameInput.value.trim();
    if (!name) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập tên danh mục';
        return;
    }
    
    // FIX: Kiểm tra trùng tên danh mục (chỉ khi thêm mới hoặc đổi tên)
    var cats = menuCategories || [];
    for (var ci = 0; ci < cats.length; ci++) {
        if (cats[ci].name === name && cats[ci].id !== _editingCategoryId) {
            if (errorEl) errorEl.innerText = 'Tên danh mục "' + name + '" đã tồn tại!';
            return;
        }
    }
    
    var order = parseInt(orderInput ? orderInput.value : '') || 0;
    if (errorEl) errorEl.innerText = '';
    
    _savingCategory = true;
    
    if (_editingCategoryId) {
        // Cập nhật
        DB.update('menu_categories', _editingCategoryId, {
            name: name,
            order: order
        }).then(function() {
            showToast('Đã cập nhật danh mục', 'success');
            hideAddCategoryForm();
            // Cập nhật menuCategories từ memory cache
            return DB.getAll('menu_categories');
        }).then(function(cats) {
            menuCategories = cats;
            renderInventoryCategories();
            renderInventoryCategoryFilter();
            renderInventoryMenu();
            _savingCategory = false;
        }).catch(function(err) {
            if (errorEl) errorEl.innerText = err.message || 'Lỗi cập nhật';
            _savingCategory = false;
        });
    } else {
        // Tạo mới
        DB.create('menu_categories', {
            name: name,
            order: order
        }).then(function(newCat) {
            showToast('Đã thêm danh mục', 'success');
            hideAddCategoryForm();
            _savingCategory = false;
            // FIX: Không push newCat vì _notifyLocal() trong saveToLocal()
            // đã gọi callback realtime -> gán menuCategories = data (đã có newCat)
            renderInventoryCategories();
            renderInventoryCategoryFilter();
        }).catch(function(err) {
            if (errorEl) errorEl.innerText = err.message || 'Lỗi tạo danh mục';
            _savingCategory = false;
        });
    }
}

function deleteCategory(catId) {
    if (!catId) return;
    if (!confirm('Xóa danh mục này? Các món trong danh mục sẽ không bị xóa.')) return;
    
    DB.remove('menu_categories', catId).then(function() {
        showToast('Đã xóa danh mục', 'success');
        menuCategories = menuCategories.filter(function(c) { return c.id !== catId; });
        renderInventoryCategories();
        renderInventoryCategoryFilter();
    }).catch(function(err) {
        showToast('Lỗi xóa danh mục', 'error');
    });
}

// ========== RENDER MÓN ĂN (GRID) ==========
function renderInventoryMenu() {
    var container = document.getElementById('invMenuItemList');
    if (!container) return;
    
    var filter = document.getElementById('invMenuFilter');
    var filterCatId = filter ? filter.value : 'all';
    
    var items = menuItems || [];
    if (filterCatId !== 'all') {
        items = items.filter(function(i) { return String(i.categoryId) === String(filterCatId); });
    }
    
    // Xây lookup category name
    var catMap = {};
    var cats = menuCategories || [];
    for (var i = 0; i < cats.length; i++) {
        catMap[cats[i].id] = cats[i].name;
    }
    
    if (items.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có món ăn nào</div>';
        return;
    }
    
    var html = '';
    for (var i = 0; i < items.length; i++) {
        var m = items[i];
        var catName = catMap[m.categoryId] || '';
        
        // Đếm tổng số nguyên liệu (cả chung và theo size)
        var totalIng = 0;
        if (m.ingredients) totalIng += m.ingredients.length;
        var variantData = (m.variants && m.variants.length > 0) ? m.variants : (m.sizes || []);
        for (var vi = 0; vi < variantData.length; vi++) {
            if (variantData[vi].ingredients) totalIng += variantData[vi].ingredients.length;
        }
        
        // Hiển thị số size nếu có
        var sizeInfo = '';
        if (variantData.length > 0) {
            sizeInfo = '<span class="inv-menu-size-badge">' + variantData.length + ' size</span>';
        }
        var ingBadge = totalIng > 0 ? '<span class="inv-menu-ing-badge">' + totalIng + ' NL</span>' : '';
        
        html += '<div class="inv-menu-item" onclick="showMenuItemDetail(\'' + m.id + '\')">' +
            '<div class="inv-menu-info">' +
                '<span class="inv-menu-name">' + escapeHtml(m.name || '') + '</span>' +
                '<span class="inv-menu-price">' + formatMoney(m.price || 0) + '</span>' +
                (catName ? '<span class="inv-menu-cat">' + escapeHtml(catName) + '</span>' : '') +
                sizeInfo +
                ingBadge +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;
}

// ========== CHI TIẾT MÓN ĂN (POPUP) ==========
function showMenuItemDetail(itemId) {
    if (!itemId) return;
    var items = menuItems || [];
    var item = null;
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === itemId) { item = items[i]; break; }
    }
    if (!item) return;
    
    var titleEl = document.getElementById('menuItemDetailTitle');
    var contentEl = document.getElementById('menuItemDetailContent');
    if (!contentEl) return;
    if (titleEl) titleEl.innerText = '🍽️ ' + (item.name || 'Chi tiết món');
    
    // Build category name
    var catName = '';
    var cats = menuCategories || [];
    for (var i = 0; i < cats.length; i++) {
        if (cats[i].id === item.categoryId) { catName = cats[i].name; break; }
    }
    
    // Helper: lookup ingredient name by id
    function _lookupIngName(id) {
        var ings = ingredients || [];
        for (var j = 0; j < ings.length; j++) {
            if (ings[j].id === id) return ings[j].name;
        }
        return '';
    }
    
    // --- THÔNG TIN CƠ BẢN ---
    var html = '';
    html += '<div class="menu-detail-info" style="margin-bottom:12px;">';
    html += '<div class="detail-row" style="padding:6px 0;border-bottom:1px solid #f1f5f9;"><strong>Tên món:</strong> ' + escapeHtml(item.name || '') + '</div>';
    html += '<div class="detail-row" style="padding:6px 0;border-bottom:1px solid #f1f5f9;"><strong>Giá bán:</strong> ' + formatMoney(item.price || 0) + '</div>';
    if (catName) html += '<div class="detail-row" style="padding:6px 0;border-bottom:1px solid #f1f5f9;"><strong>Danh mục:</strong> ' + escapeHtml(catName) + '</div>';
    html += '</div>';
    
    // --- SIZE & CÔNG THỨC ---
    var variantData = (item.variants && item.variants.length > 0) ? item.variants : (item.sizes || []);
    if (variantData.length > 0) {
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="font-weight:700;font-size:15px;margin-bottom:8px;padding:6px 0;border-bottom:2px solid #f59e0b;">📏 Size & Công thức</div>';
        for (var vi = 0; vi < variantData.length; vi++) {
            var v = variantData[vi];
            html += '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px;margin-bottom:8px;">';
            html += '<div style="font-weight:700;font-size:14px;color:#92400e;margin-bottom:4px;">🔸 ' + escapeHtml(v.name || 'Size ' + (vi+1)) + ' — ' + formatMoney(v.price || 0) + '</div>';
            
            // Hiển thị hướng dẫn pha chế (recipe text)
            if (v.recipe && v.recipe.trim()) {
                html += '<div style="margin-top:6px;padding:6px 8px;background:#fefce8;border-radius:6px;border-left:3px solid #f59e0b;">';
                html += '<div style="font-size:11px;color:#92400e;font-weight:600;margin-bottom:2px;">📋 Hướng dẫn pha chế:</div>';
                html += '<div style="font-size:12px;color:#78350f;white-space:pre-wrap;line-height:1.5;">' + escapeHtml(v.recipe) + '</div>';
                html += '</div>';
            }
            
            // Nguyên liệu cho size này
            if (v.ingredients && v.ingredients.length > 0) {
                html += '<div style="font-size:13px;color:#78350f;margin-top:6px;"><strong>🧂 Nguyên liệu:</strong></div>';
                html += '<table style="width:100%;font-size:12px;margin-top:4px;border-collapse:collapse;">';
                html += '<tr style="background:#fef3c7;"><th style="padding:4px 6px;text-align:left;border-bottom:1px solid #fde68a;">Nguyên liệu</th><th style="padding:4px 6px;text-align:right;border-bottom:1px solid #fde68a;">Lượng</th></tr>';
                for (var i = 0; i < v.ingredients.length; i++) {
                    var req = v.ingredients[i];
                    var ingName = req.ingredientName || _lookupIngName(req.ingredientId) || '#' + req.ingredientId;
                    html += '<tr><td style="padding:3px 6px;border-bottom:1px solid #fef3c7;">' + escapeHtml(ingName) + '</td><td style="padding:3px 6px;text-align:right;border-bottom:1px solid #fef3c7;">' + req.quantity + ' ' + escapeHtml(req.unit || '') + '</td></tr>';
                }
                html += '</table>';
            } else {
                html += '<div style="font-size:12px;color:#a16207;margin-top:6px;font-style:italic;">Chưa có nguyên liệu cho size này</div>';
            }
            html += '</div>';
        }
        html += '</div>';
    }
    
    // --- NGUYÊN LIỆU CHUNG ---
    if (item.ingredients && item.ingredients.length > 0) {
        html += '<div style="margin-bottom:12px;">';
        html += '<div style="font-weight:700;font-size:15px;margin-bottom:8px;padding:6px 0;border-bottom:2px solid #3b82f6;">🧂 Nguyên liệu (chung cho mọi size)</div>';
        html += '<table style="width:100%;font-size:13px;border-collapse:collapse;">';
        html += '<tr style="background:#eff6ff;"><th style="padding:4px 8px;text-align:left;border-bottom:1px solid #bfdbfe;">Nguyên liệu</th><th style="padding:4px 8px;text-align:right;border-bottom:1px solid #bfdbfe;">Lượng</th></tr>';
        for (var i = 0; i < item.ingredients.length; i++) {
            var req = item.ingredients[i];
            var ingName = req.ingredientName || _lookupIngName(req.ingredientId) || '#' + req.ingredientId;
            html += '<tr><td style="padding:3px 8px;border-bottom:1px solid #eff6ff;">' + escapeHtml(ingName) + '</td><td style="padding:3px 8px;text-align:right;border-bottom:1px solid #eff6ff;">' + req.quantity + ' ' + escapeHtml(req.unit || '') + '</td></tr>';
        }
        html += '</table>';
        html += '</div>';
    }
    
    // Nếu không có nguyên liệu nào
    var hasAnyIng = (item.ingredients && item.ingredients.length > 0);
    if (!hasAnyIng && variantData.length > 0) {
        var hasVariantIng = false;
        for (var vi = 0; vi < variantData.length; vi++) {
            if (variantData[vi].ingredients && variantData[vi].ingredients.length > 0) { hasVariantIng = true; break; }
        }
        if (!hasVariantIng) {
            html += '<div style="text-align:center;padding:16px;color:#94a3b8;font-style:italic;">Chưa có nguyên liệu / công thức cho món này</div>';
        }
    } else if (!hasAnyIng && (!variantData || variantData.length === 0)) {
        html += '<div style="text-align:center;padding:16px;color:#94a3b8;font-style:italic;">Chưa có nguyên liệu / công thức cho món này</div>';
    }
    
    // --- NÚT HÀNH ĐỘNG ---
    html += '<div style="margin-top:16px;display:flex;gap:8px;">';
    html += '<button class="btn-save" onclick="closeModal(\'menuItemDetailModal\');editMenuItem(\'' + item.id + '\')" style="flex:1;">✏️ Sửa món</button>';
    html += '<button class="btn-danger" onclick="closeModal(\'menuItemDetailModal\');deleteMenuItem(\'' + item.id + '\')" style="flex:1;">🗑️ Xóa</button>';
    html += '</div>';
    
    contentEl.innerHTML = html;
    openBottomSheet('menuItemDetailModal');
}

// ========== CRUD MÓN ĂN ==========
function showAddMenuItemForm() {
    _editingMenuItemId = null;
    var nameInput = document.getElementById('addModalItemName');
    var priceInput = document.getElementById('addModalItemPrice');
    var catSelect = document.getElementById('invMenuItemCategory');
    var catSelectModal = document.getElementById('invMenuItemCategoryModal');
    var errorEl = document.getElementById('addModalItemError');
    if (nameInput) { nameInput.value = ''; }
    if (priceInput) priceInput.value = '';
    if (catSelect) catSelect.value = '';
    if (catSelectModal) catSelectModal.value = '';
    if (errorEl) errorEl.innerText = '';
    renderInventoryCategoryFilter();
    // Reset sizes & ingredients
    _resetMenuItemSizes();
    _resetMenuItemIngredients();
    // Mở popup thay vì form inline
    openBottomSheet('addMenuItemModal');
    // Focus sau khi modal mở
    setTimeout(function() { if (nameInput) nameInput.focus(); }, 300);
}

function hideAddMenuItemForm() {
    closeModal('addMenuItemModal');
    _editingMenuItemId = null;
}

function editMenuItem(itemId) {
    if (!itemId) return;
    var items = menuItems || [];
    var item = null;
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === itemId) { item = items[i]; break; }
    }
    if (!item) return;
    
    _editingMenuItemId = itemId;
    
    // Populate edit modal
    var titleEl = document.getElementById('editMenuItemModalTitle');
    var nameInput = document.getElementById('editMenuItemName');
    var priceInput = document.getElementById('editMenuItemPrice');
    var catSelect = document.getElementById('editMenuItemCategory');
    var errorEl = document.getElementById('editMenuItemError');
    
    if (titleEl) titleEl.innerText = '✏️ Sửa món: ' + (item.name || '');
    if (nameInput) { nameInput.value = item.name || ''; }
    if (priceInput) priceInput.value = item.price || '';
    if (errorEl) errorEl.innerText = '';
    
    // Populate category select
    var cats = menuCategories || [];
    cats.sort(function(a, b) { return (a.order || 999) - (b.order || 999); });
    var catOptionsHtml = '<option value="">-- Chọn danh mục --</option>';
    for (var i = 0; i < cats.length; i++) {
        var selected = String(cats[i].id) === String(item.categoryId) ? ' selected' : '';
        catOptionsHtml += '<option value="' + cats[i].id + '"' + selected + '>' + escapeHtml(cats[i].name || '') + '</option>';
    }
    if (catSelect) catSelect.innerHTML = catOptionsHtml;
    
    // Load variants (sizes) into edit modal
    var sizesContainer = document.getElementById('editMenuItemSizesContainer');
    if (sizesContainer) {
        sizesContainer.innerHTML = '';
        var variantData = (item.variants && item.variants.length > 0) ? item.variants : (item.sizes || []);
        if (variantData.length > 0) {
            for (var i = 0; i < variantData.length; i++) {
                _addEditMenuItemSizeRow(variantData[i].name || '', variantData[i].price || '', variantData[i].ingredients || [], variantData[i].recipe || '');
            }
        } else {
            _addEditMenuItemSizeRow('', '', [], '');
        }
    }
    
    // Load ingredients into edit modal
    var ingsContainer = document.getElementById('editMenuItemIngredientsContainer');
    if (ingsContainer) {
        ingsContainer.innerHTML = '';
        if (item.ingredients && item.ingredients.length > 0) {
            for (var i = 0; i < item.ingredients.length; i++) {
                _addEditMenuItemIngredientRow(item.ingredients[i].ingredientId || '', item.ingredients[i].quantity || '', item.ingredients[i].unit || '');
            }
        } else {
            _addEditMenuItemIngredientRow('', '', '');
        }
    }
    
    openBottomSheet('editMenuItemModal');
}

// ========== MENU ITEM SIZES (DATA-DRIVEN) ==========
function _resetMenuItemSizes() {
    _addModalSizes = [];
    // Thêm 1 row mặc định
    _addModalSizes.push({ name: '', price: '', ingredients: [], recipe: '' });
    _renderAddModalSizes();
}

function _addMenuItemSizeRow(sizeName, sizePrice, sizeIngredients, sizeRecipe) {
    _addModalSizes.push({
        name: sizeName || '',
        price: sizePrice || '',
        ingredients: sizeIngredients || [],
        recipe: sizeRecipe || ''
    });
    _renderAddModalSizes();
}

function _renderAddModalSizes() {
    var container = document.getElementById('addModalSizesContainer');
    if (!container) return;
    
    // Đảm bảo luôn có ít nhất 1 size
    if (_addModalSizes.length === 0) {
        _addModalSizes.push({ name: '', price: '', ingredients: [], recipe: '' });
    }
    
    var html = '';
    for (var si = 0; si < _addModalSizes.length; si++) {
        var s = _addModalSizes[si];
        var idx = si;
        html += '<div class="inv-form-row" style="margin-top:4px;flex-direction:column;border:1px solid #e2e8f0;border-radius:6px;padding:8px;width:100%;box-sizing:border-box;">';
        html += '<div style="display:flex;gap:6px;align-items:center;width:100%;">';
        html += '<input type="text" class="menu-size-name" placeholder="Tên size (VD: Nhỏ)" value="' + escapeHtml(s.name || '') + '" style="flex:1;" onchange="_addModalSizes[' + idx + '].name=this.value">';
        html += '<input type="number" class="menu-size-price" placeholder="Giá" value="' + (s.price || '') + '" style="flex:0.8;" step="1000" onchange="_addModalSizes[' + idx + '].price=this.value">';
        html += '<button class="btn-small btn-danger" onclick="_addModalSizes.splice(' + idx + ',1);_renderAddModalSizes()" style="padding:4px 8px;">✕</button>';
        html += '</div>';
        
        // Ô nhập công thức pha chế (hướng dẫn text)
        html += '<div style="margin-top:6px;width:100%;">';
        html += '<label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:2px;">📋 Hướng dẫn pha chế</label>';
        html += '<textarea class="menu-size-recipe" placeholder="VD: Nước sôi 85 độ, ủ 15 phút..." style="width:100%;min-height:50px;font-size:12px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;resize:vertical;box-sizing:border-box;" onchange="_addModalSizes[' + idx + '].recipe=this.value">' + escapeHtml(s.recipe || '') + '</textarea>';
        html += '</div>';
        
        // Nguyên liệu cho size này
        html += '<div class="size-ingredients" style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;width:100%;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
        html += '<span style="font-size:11px;color:#64748b;font-weight:600;">🧂 Nguyên liệu cho size này</span>';
        html += '<button class="btn-small btn-outline" onclick="_addModalSizeIngredient(' + idx + ')" style="font-size:10px;padding:2px 6px;">+ Thêm NL</button>';
        html += '</div>';
        
        var sIngs = s.ingredients || [];
        for (var ii = 0; ii < sIngs.length; ii++) {
            html += _buildSizeIngRowHtml(idx, ii, sIngs[ii].ingredientId || '', sIngs[ii].quantity || '', sIngs[ii].unit || '');
        }
        if (sIngs.length === 0) {
            html += _buildSizeIngRowHtml(idx, -1, '', '', '');
        }
        html += '</div></div>';
    }
    
    container.innerHTML = html;
    
    // Scroll xuống cuối
    setTimeout(function() {
        var modalBody = document.getElementById('addMenuItemModalBody');
        if (modalBody) {
            modalBody.scrollTop = modalBody.scrollHeight;
        }
    }, 50);
}

function _addModalSizeIngredient(sizeIdx) {
    if (!_addModalSizes[sizeIdx]) return;
    if (!_addModalSizes[sizeIdx].ingredients) {
        _addModalSizes[sizeIdx].ingredients = [];
    }
    _addModalSizes[sizeIdx].ingredients.push({ ingredientId: '', quantity: '', unit: '' });
    _renderAddModalSizes();
}

function _buildSizeIngRowHtml(sizeIdx, ingIdx, ingId, qty, unit) {
    var ings = ingredients || [];
    var optionsHtml = '<option value="">-- Chọn NL --</option>';
    for (var i = 0; i < ings.length; i++) {
        var ing = ings[i];
        var selected = String(ing.id) === String(ingId) ? ' selected' : '';
        var stock = parseFloat(ing.stock) || 0;
        var unitLabel = ing.unit || '';
        var convInfo = '';
        if (ing.conversionFrom && ing.conversionTo && ing.conversionRate) {
            convInfo = ' (' + Math.round(stock * 10) / 10 + unitLabel + ' → ~' + Math.round(stock * ing.conversionRate) + ing.conversionTo + ')';
        } else {
            convInfo = ' (' + Math.round(stock * 10) / 10 + unitLabel + ')';
        }
        optionsHtml += '<option value="' + ing.id + '"' + selected + '>' + escapeHtml(ing.name || '') + convInfo + '</option>';
    }
    
    var onChange = 'onchange="_addModalSizes[' + sizeIdx + '].ingredients[' + ingIdx + '].ingredientId=this.value"';
    var onQtyChange = 'onchange="_addModalSizes[' + sizeIdx + '].ingredients[' + ingIdx + '].quantity=this.value"';
    var onUnitChange = 'onchange="_addModalSizes[' + sizeIdx + '].ingredients[' + ingIdx + '].unit=this.value"';
    var onRemove = 'onclick="_addModalSizes[' + sizeIdx + '].ingredients.splice(' + ingIdx + ',1);_renderAddModalSizes()"';
    
    // Nếu ingIdx là -1 (hàng mặc định khi chưa có NL nào), dùng cách khác
    if (ingIdx === -1) {
        onChange = 'onchange="if(this.value){_addModalSizes[' + sizeIdx + '].ingredients.push({ingredientId:this.value,quantity:\'\',unit:\'\'});_renderAddModalSizes()}"';
        onQtyChange = 'disabled';
        onUnitChange = 'disabled';
        onRemove = 'style="display:none"';
    }
    
    return '<div style="display:flex;gap:4px;margin-top:4px;align-items:center;">' +
        '<select class="menu-ing-select" style="flex:1.2;font-size:11px;padding:4px 6px;" ' + onChange + '>' + optionsHtml + '</select>' +
        '<input type="number" class="menu-ing-qty" placeholder="SL" value="' + (qty || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;" step="0.1" ' + onQtyChange + '>' +
        '<input type="text" class="menu-ing-unit" placeholder="ĐV" value="' + escapeHtml(unit || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;" ' + onUnitChange + '>' +
        '<button class="btn-small btn-danger" onclick="this.parentElement.remove()" style="padding:2px 6px;font-size:10px;" ' + onRemove + '>✕</button>' +
    '</div>';
}

function _createSizeIngRow(ingId, qty, unit) {
    // Không còn dùng - giữ để tương thích
    var div = document.createElement('div');
    div.innerHTML = '<div style="display:flex;gap:4px;margin-top:4px;align-items:center;">' +
        '<select class="menu-ing-select" style="flex:1.2;font-size:11px;padding:4px 6px;"><option value="">-- Chọn NL --</option></select>' +
        '<input type="number" class="menu-ing-qty" placeholder="SL" value="' + (qty || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;" step="0.1">' +
        '<input type="text" class="menu-ing-unit" placeholder="ĐV" value="' + escapeHtml(unit || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;">' +
        '<button class="btn-small btn-danger" onclick="this.parentElement.remove()" style="padding:2px 6px;font-size:10px;">✕</button>' +
    '</div>';
    return div.firstElementChild;
}

function _resetMenuItemIngredients() {
    _addModalIngredients = [];
    // Thêm 1 row mặc định
    _addModalIngredients.push({ ingredientId: '', quantity: '', unit: '' });
    _renderAddModalIngredients();
}

function _addMenuItemIngredientRow(ingId, qty, unit) {
    _addModalIngredients.push({
        ingredientId: ingId || '',
        quantity: qty || '',
        unit: unit || ''
    });
    _renderAddModalIngredients();
}

function _renderAddModalIngredients() {
    var container = document.getElementById('addModalIngredientsContainer');
    if (!container) return;
    
    // Đảm bảo luôn có ít nhất 1 hàng
    if (_addModalIngredients.length === 0) {
        _addModalIngredients.push({ ingredientId: '', quantity: '', unit: '' });
    }
    
    var ings = ingredients || [];
    var html = '';
    for (var i = 0; i < _addModalIngredients.length; i++) {
        var ing = _addModalIngredients[i];
        var idx = i;
        
        var optionsHtml = '<option value="">-- Chọn NL --</option>';
        for (var j = 0; j < ings.length; j++) {
            var ingData = ings[j];
            var selected = String(ingData.id) === String(ing.ingredientId) ? ' selected' : '';
            var stock = parseFloat(ingData.stock) || 0;
            var unitLabel = ingData.unit || '';
            var convInfo = '';
            if (ingData.conversionFrom && ingData.conversionTo && ingData.conversionRate) {
                convInfo = ' (' + stock + unitLabel + ' → ~' + Math.round(stock * ingData.conversionRate) + ingData.conversionTo + ')';
            } else {
                convInfo = ' (' + stock + unitLabel + ')';
            }
            optionsHtml += '<option value="' + ingData.id + '"' + selected + '>' + escapeHtml(ingData.name || '') + convInfo + '</option>';
        }
        
        html += '<div class="inv-form-row" style="margin-top:4px;">' +
            '<select class="menu-ing-select" style="flex:1.2;" onchange="_addModalIngredients[' + idx + '].ingredientId=this.value">' + optionsHtml + '</select>' +
            '<input type="number" class="menu-ing-qty" placeholder="SL" value="' + (ing.quantity || '') + '" style="flex:0.5;" step="0.1" onchange="_addModalIngredients[' + idx + '].quantity=this.value">' +
            '<input type="text" class="menu-ing-unit" placeholder="ĐV" value="' + escapeHtml(ing.unit || '') + '" style="flex:0.5;" onchange="_addModalIngredients[' + idx + '].unit=this.value">' +
            '<button class="btn-small btn-danger" onclick="_addModalIngredients.splice(' + idx + ',1);_renderAddModalIngredients()" style="padding:4px 8px;">✕</button>' +
        '</div>';
    }
    
    container.innerHTML = html;
    
    // Scroll xuống cuối
    setTimeout(function() {
        var modalBody = document.getElementById('addMenuItemModalBody');
        if (modalBody) {
            modalBody.scrollTop = modalBody.scrollHeight;
        }
    }, 50);
}

function handleSaveMenuItem() {
    // FIX: Chống double-submit
    if (_savingMenuItem) return;
    
    var nameInput = document.getElementById('addModalItemName');
    var priceInput = document.getElementById('addModalItemPrice');
    // Khi thêm mới (không editing) thì đọc từ modal select, khi sửa thì đọc từ edit select
    var catSelect = _editingMenuItemId
        ? document.getElementById('editMenuItemCategory')
        : document.getElementById('invMenuItemCategoryModal');
    var errorEl = document.getElementById('addModalItemError');
    
    if (!nameInput || !priceInput) return;
    var name = nameInput.value.trim();
    var price = parseInt(priceInput.value) || 0;
    var categoryId = catSelect ? catSelect.value : '';
    
    if (!name) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập tên món';
        return;
    }
    if (price <= 0) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập giá bán hợp lệ';
        return;
    }
    if (errorEl) errorEl.innerText = '';
    
    // FIX: Kiểm tra trùng tên món (chỉ khi thêm mới hoặc đổi tên)
    var items = menuItems || [];
    for (var mi = 0; mi < items.length; mi++) {
        if (items[mi].name === name && items[mi].id !== _editingMenuItemId) {
            if (errorEl) errorEl.innerText = 'Tên món "' + name + '" đã tồn tại!';
            return;
        }
    }
    
    _savingMenuItem = true;
    
    // Helper: lấy tên nguyên liệu từ id
    function _lookupIngName(ingId) {
        var ings = ingredients || [];
        for (var j = 0; j < ings.length; j++) {
            if (String(ings[j].id) === String(ingId)) return ings[j].name;
        }
        return '';
    }
    
    // Collect sizes from _addModalSizes (data-driven)
    var sizes = [];
    for (var i = 0; i < _addModalSizes.length; i++) {
        var s = _addModalSizes[i];
        var sName = (s.name || '').trim();
        var sPrice = parseInt(s.price) || 0;
        if (!sName) continue;
        
        var sizeIngs = [];
        var sIngs = s.ingredients || [];
        for (var si = 0; si < sIngs.length; si++) {
            var ingId = sIngs[si].ingredientId || '';
            var ingQty = parseFloat(sIngs[si].quantity) || 0;
            var ingUnit = (sIngs[si].unit || '').trim();
            if (ingId && ingQty > 0) {
                sizeIngs.push({
                    ingredientId: ingId,
                    ingredientName: _lookupIngName(ingId),
                    quantity: ingQty,
                    unit: ingUnit
                });
            }
        }
        
        sizes.push({
            name: sName,
            price: sPrice,
            ingredients: sizeIngs,
            recipe: s.recipe || ''
        });
    }
    
    // Collect global ingredients from _addModalIngredients (data-driven)
    var ingredients_data = [];
    for (var i = 0; i < _addModalIngredients.length; i++) {
        var ing = _addModalIngredients[i];
        var ingId = ing.ingredientId || '';
        var ingQty = parseFloat(ing.quantity) || 0;
        var ingUnit = (ing.unit || '').trim();
        if (ingId && ingQty > 0) {
            ingredients_data.push({
                ingredientId: ingId,
                ingredientName: _lookupIngName(ingId),
                quantity: ingQty,
                unit: ingUnit
            });
        }
    }
    
    var hasVariants = sizes.length > 0;
    var data = {
        name: name,
        price: price,
        categoryId: categoryId,
        hasVariants: hasVariants,
        variants: hasVariants ? sizes : [],
        sizes: hasVariants ? sizes : [],
        ingredients: ingredients_data.length > 0 ? ingredients_data : []
    };
    
    if (_editingMenuItemId) {
        DB.update('menu', _editingMenuItemId, data).then(function() {
            showToast('Đã cập nhật món', 'success');
            closeModal('editMenuItemModal');
            _savingMenuItem = false;
            return DB.getAll('menu');
        }).then(function(items) {
            menuItems = items;
            window.menuItems = items;
            renderInventoryMenu();
            _invalidateLookups();
        }).catch(function(err) {
            if (errorEl) errorEl.innerText = err.message || 'Lỗi cập nhật';
            _savingMenuItem = false;
        });
    } else {
        DB.create('menu', data).then(function(newItem) {
            showToast('Đã thêm món', 'success');
            hideAddMenuItemForm();
            _savingMenuItem = false;
            // FIX: Không push newItem vì _notifyLocal() trong saveToLocal()
            // đã gọi callback realtime -> gán menuItems = data (đã có newItem)
            renderInventoryMenu();
            _invalidateLookups();
        }).catch(function(err) {
            if (errorEl) errorEl.innerText = err.message || 'Lỗi tạo món';
            _savingMenuItem = false;
        });
    }
}

function deleteMenuItem(itemId) {
    if (!itemId) return;
    if (!confirm('Xóa món này?')) return;
    
    DB.remove('menu', itemId).then(function() {
        showToast('Đã xóa món', 'success');
        menuItems = menuItems.filter(function(m) { return m.id !== itemId; });
        window.menuItems = menuItems;
        renderInventoryMenu();
        _invalidateLookups();
    }).catch(function(err) {
        showToast('Lỗi xóa món', 'error');
    });
}

// ========== EDIT MENU ITEM MODAL HELPERS ==========
function _addEditMenuItemSizeRow(sizeName, sizePrice, sizeIngredients, sizeRecipe) {
    var container = document.getElementById('editMenuItemSizesContainer');
    if (!container) return;
    var rowId = 'edit_size_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    var row = document.createElement('div');
    row.className = 'inv-form-row';
    row.id = rowId;
    row.style.cssText = 'margin-top:4px;flex-direction:column;border:1px solid #e2e8f0;border-radius:6px;padding:8px;';
    
    var headerHtml =
        '<div style="display:flex;gap:6px;align-items:center;width:100%;">' +
            '<input type="text" class="edit-menu-size-name" placeholder="Tên size (VD: Nhỏ)" value="' + escapeHtml(sizeName || '') + '" style="flex:1;">' +
            '<input type="number" class="edit-menu-size-price" placeholder="Giá" value="' + (sizePrice || '') + '" style="flex:0.8;" step="1000">' +
            '<button class="btn-small btn-danger" onclick="this.closest(\'.inv-form-row\').remove()" style="padding:4px 8px;">✕</button>' +
        '</div>';
    
    // Ô nhập công thức pha chế (hướng dẫn text)
    var recipeHtml = '<div style="margin-top:6px;width:100%;">';
    recipeHtml += '<label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:2px;">📋 Hướng dẫn pha chế</label>';
    recipeHtml += '<textarea class="edit-menu-size-recipe" placeholder="VD: Nước sôi 85 độ, ủ 15 phút..." style="width:100%;min-height:50px;font-size:12px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;resize:vertical;box-sizing:border-box;">' + escapeHtml(sizeRecipe || '') + '</textarea>';
    recipeHtml += '</div>';
    
    // Build ingredients section for this size (luôn hiển thị)
    var ingsHtml = '<div class="edit-size-ingredients" style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;width:100%;">';
    ingsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
    ingsHtml += '<span style="font-size:11px;color:#64748b;font-weight:600;">🧂 Nguyên liệu cho size này</span>';
    ingsHtml += '<button class="btn-small btn-outline" onclick="document.getElementById(\'' + rowId + '\').querySelector(\'.edit-size-ing-rows\').appendChild(_createEditSizeIngRow(\'\',\'\',\'\'))" style="font-size:10px;padding:2px 6px;">+ Thêm NL</button>';
    ingsHtml += '</div>';
    ingsHtml += '<div class="edit-size-ing-rows">';
    
    // Add ingredient rows
    if (sizeIngredients && sizeIngredients.length) {
        for (var i = 0; i < sizeIngredients.length; i++) {
            var si = sizeIngredients[i];
            ingsHtml += _buildEditSizeIngRowHtml(si.ingredientId || '', si.quantity || '', si.unit || '');
        }
    } else {
        ingsHtml += _buildEditSizeIngRowHtml('', '', '');
    }
    
    ingsHtml += '</div></div>';
    
    row.innerHTML = headerHtml + recipeHtml + ingsHtml;
    container.appendChild(row);
}

function _buildEditSizeIngRowHtml(ingId, qty, unit) {
    var ings = ingredients || [];
    var optionsHtml = '<option value="">-- Chọn NL --</option>';
    for (var i = 0; i < ings.length; i++) {
        var ing = ings[i];
        var selected = String(ing.id) === String(ingId) ? ' selected' : '';
        var stock = parseFloat(ing.stock) || 0;
        var unitLabel = ing.unit || '';
        var convInfo = '';
        if (ing.conversionFrom && ing.conversionTo && ing.conversionRate) {
            convInfo = ' (' + Math.round(stock * 10) / 10 + unitLabel + ' → ~' + Math.round(stock * ing.conversionRate) + ing.conversionTo + ')';
        } else {
            convInfo = ' (' + Math.round(stock * 10) / 10 + unitLabel + ')';
        }
        optionsHtml += '<option value="' + ing.id + '"' + selected + '>' + escapeHtml(ing.name || '') + convInfo + '</option>';
    }
    return '<div style="display:flex;gap:4px;margin-top:4px;align-items:center;">' +
        '<select class="edit-menu-ing-select" style="flex:1.2;font-size:11px;padding:4px 6px;">' + optionsHtml + '</select>' +
        '<input type="number" class="edit-menu-ing-qty" placeholder="SL" value="' + (qty || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;" step="0.1">' +
        '<input type="text" class="edit-menu-ing-unit" placeholder="ĐV" value="' + escapeHtml(unit || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;">' +
        '<button class="btn-small btn-danger" onclick="this.parentElement.remove()" style="padding:2px 6px;font-size:10px;">✕</button>' +
    '</div>';
}

function _createEditSizeIngRow(ingId, qty, unit) {
    var div = document.createElement('div');
    div.innerHTML = _buildEditSizeIngRowHtml(ingId, qty, unit);
    return div.firstElementChild;
}

function _addEditMenuItemIngredientRow(ingId, qty, unit) {
    var container = document.getElementById('editMenuItemIngredientsContainer');
    if (!container) return;
    
    var ings = ingredients || [];
    var optionsHtml = '<option value="">-- Chọn NL --</option>';
    for (var i = 0; i < ings.length; i++) {
        var ing = ings[i];
        var selected = String(ing.id) === String(ingId) ? ' selected' : '';
        var stock = parseFloat(ing.stock) || 0;
        var unitLabel = ing.unit || '';
        var convInfo = '';
        if (ing.conversionFrom && ing.conversionTo && ing.conversionRate) {
            convInfo = ' (' + stock + unitLabel + ' → ~' + Math.round(stock * ing.conversionRate) + ing.conversionTo + ')';
        } else {
            convInfo = ' (' + stock + unitLabel + ')';
        }
        optionsHtml += '<option value="' + ing.id + '"' + selected + '>' + escapeHtml(ing.name || '') + convInfo + '</option>';
    }
    
    var row = document.createElement('div');
    row.className = 'inv-form-row';
    row.style.marginTop = '4px';
    row.innerHTML =
        '<select class="edit-menu-ing-select" style="flex:1.2;">' + optionsHtml + '</select>' +
        '<input type="number" class="edit-menu-ing-qty" placeholder="SL" value="' + (qty || '') + '" style="flex:0.5;" step="0.1">' +
        '<input type="text" class="edit-menu-ing-unit" placeholder="ĐV" value="' + escapeHtml(unit || '') + '" style="flex:0.5;">' +
        '<button class="btn-small btn-danger" onclick="this.parentElement.remove()" style="padding:4px 8px;">✕</button>';
    container.appendChild(row);
}

function handleEditMenuItemSave() {
    // FIX: Chống double-submit
    if (_savingMenuItem) return;
    
    var nameInput = document.getElementById('editMenuItemName');
    var priceInput = document.getElementById('editMenuItemPrice');
    var catSelect = document.getElementById('editMenuItemCategory');
    var errorEl = document.getElementById('editMenuItemError');
    
    if (!nameInput || !priceInput) return;
    var name = nameInput.value.trim();
    var price = parseInt(priceInput.value) || 0;
    var categoryId = catSelect ? catSelect.value : '';
    
    if (!name) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập tên món';
        return;
    }
    if (price <= 0) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập giá bán hợp lệ';
        return;
    }
    if (errorEl) errorEl.innerText = '';
    
    // FIX: Kiểm tra trùng tên món khi sửa
    var items = menuItems || [];
    for (var mi = 0; mi < items.length; mi++) {
        if (items[mi].name === name && items[mi].id !== _editingMenuItemId) {
            if (errorEl) errorEl.innerText = 'Tên món "' + name + '" đã tồn tại!';
            return;
        }
    }
    
    _savingMenuItem = true;
    
    // Collect sizes with per-variant ingredients
    var sizes = [];
    var sizeRows = document.querySelectorAll('#editMenuItemSizesContainer .inv-form-row');
    for (var i = 0; i < sizeRows.length; i++) {
        var row = sizeRows[i];
        var sNameInput = row.querySelector('.edit-menu-size-name');
        var sPriceInput = row.querySelector('.edit-menu-size-price');
        if (!sNameInput) continue;
        var sName = sNameInput.value.trim();
        var sPrice = parseInt(sPriceInput ? sPriceInput.value : 0) || 0;
        if (!sName) continue;
        
        // Collect per-variant ingredients from this size row
        var sizeIngs = [];
        var ingRows = row.querySelectorAll('.edit-size-ing-rows .edit-menu-ing-select');
        var ingQtyRows = row.querySelectorAll('.edit-size-ing-rows .edit-menu-ing-qty');
        var ingUnitRows = row.querySelectorAll('.edit-size-ing-rows .edit-menu-ing-unit');
        for (var si = 0; si < ingRows.length; si++) {
            var ingId = ingRows[si].value;
            var ingQty = parseFloat(ingQtyRows[si].value) || 0;
            var ingUnit = ingUnitRows[si].value.trim();
            if (ingId && ingQty > 0) {
                var ingName = '';
                var ings = ingredients || [];
                for (var j = 0; j < ings.length; j++) {
                    if (String(ings[j].id) === String(ingId)) { ingName = ings[j].name; break; }
                }
                sizeIngs.push({
                    ingredientId: ingId,
                    ingredientName: ingName,
                    quantity: ingQty,
                    unit: ingUnit
                });
            }
        }
        
        // Read recipe text from textarea
        var recipeInput = row.querySelector('.edit-menu-size-recipe');
        var recipe = recipeInput ? recipeInput.value.trim() : '';
        
        sizes.push({
            name: sName,
            price: sPrice,
            ingredients: sizeIngs.length > 0 ? sizeIngs : [],
            recipe: recipe
        });
    }
    
    // Collect global ingredients (shared across all sizes)
    var ingredients_data = [];
    var ingSelects = document.querySelectorAll('#editMenuItemIngredientsContainer .edit-menu-ing-select');
    var ingQtys = document.querySelectorAll('#editMenuItemIngredientsContainer .edit-menu-ing-qty');
    var ingUnits = document.querySelectorAll('#editMenuItemIngredientsContainer .edit-menu-ing-unit');
    for (var i = 0; i < ingSelects.length; i++) {
        var ingId = ingSelects[i].value;
        var ingQty = parseFloat(ingQtys[i].value) || 0;
        var ingUnit = ingUnits[i].value.trim();
        if (ingId && ingQty > 0) {
            var ingName = '';
            var ings = ingredients || [];
            for (var j = 0; j < ings.length; j++) {
                if (String(ings[j].id) === String(ingId)) { ingName = ings[j].name; break; }
            }
            ingredients_data.push({
                ingredientId: ingId,
                ingredientName: ingName,
                quantity: ingQty,
                unit: ingUnit
            });
        }
    }
    
    var hasVariants = sizes.length > 0;
    var data = {
        name: name,
        price: price,
        categoryId: categoryId,
        hasVariants: hasVariants,
        variants: hasVariants ? sizes : [],
        sizes: hasVariants ? sizes : [],
        ingredients: ingredients_data.length > 0 ? ingredients_data : []
    };
    
    if (!_editingMenuItemId) {
        if (errorEl) errorEl.innerText = 'Lỗi: không tìm thấy món';
        _savingMenuItem = false;
        return;
    }
    
    DB.update('menu', _editingMenuItemId, data).then(function() {
        showToast('Đã cập nhật món', 'success');
        closeModal('editMenuItemModal');
        _savingMenuItem = false;
        return DB.getAll('menu');
    }).then(function(items) {
        menuItems = items;
        window.menuItems = items;
        renderInventoryMenu();
        _invalidateLookups();
    }).catch(function(err) {
        if (errorEl) errorEl.innerText = err.message || 'Lỗi cập nhật';
        _savingMenuItem = false;
    });
}

// ========== RENDER NGUYÊN LIỆU (GRID) ==========
function renderInventoryIngredients() {
    var container = document.getElementById('invIngredientList');
    if (!container) return;
    
    var ings = ingredients || [];
    
    if (ings.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có nguyên liệu nào</div>';
        return;
    }
    
    var html = '';
    for (var i = 0; i < ings.length; i++) {
        var ing = ings[i];
        var stock = parseFloat(ing.stock) || 0;
        var minStock = parseFloat(ing.minStock) || 0;
        var isLow = minStock > 0 && stock <= minStock;
        var unit = ing.unit || '';
        
        // Hiển thị thông tin quy đổi nếu có
        var conversionHtml = '';
        var convertedStockHtml = '';
        if (ing.conversionFrom && ing.conversionTo && ing.conversionRate) {
            conversionHtml = '<span class="inv-ing-conversion">1 ' + escapeHtml(ing.conversionFrom) + ' → ' + ing.conversionRate + ' ' + escapeHtml(ing.conversionTo) + '</span>';
            var convertedStock = Math.round(stock * ing.conversionRate * 10) / 10;
            convertedStockHtml = '<span class="inv-ing-converted">' + convertedStock + ' ' + escapeHtml(ing.conversionTo) + '</span>';
        }
        
        // Round stock to 1 decimal
        var displayStock = Math.round(stock * 10) / 10;
        
        html += '<div class="inv-ingredient-item' + (isLow ? ' low-stock' : '') + '" onclick="showIngredientUsage(\'' + ing.id + '\')">' +
            '<div class="inv-ing-info">' +
                '<span class="inv-ing-name">' + escapeHtml(ing.name || '') + '</span>' +
                '<span class="inv-ing-stock ' + (isLow ? 'text-danger' : '') + '">' +
                    displayStock + ' ' + escapeHtml(unit) +
                    (isLow ? ' ⚠️' : '') +
                '</span>' +
                (convertedStockHtml ? '<span class="inv-ing-stock-converted">= ' + convertedStockHtml + '</span>' : '') +
                conversionHtml +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;
}

// ========== CRUD NGUYÊN LIỆU ==========
function showAddIngredientForm() {
    _editingIngredientId = null;
    var titleEl = document.getElementById('addIngredientModalTitle');
    var nameInput = document.getElementById('addModalIngredientName');
    var unitInput = document.getElementById('addModalIngredientUnit');
    var stockInput = document.getElementById('addModalIngredientStock');
    var minStockInput = document.getElementById('addModalIngredientMinStock');
    var errorEl = document.getElementById('addModalIngredientError');
    if (titleEl) titleEl.innerText = '➕ Thêm nguyên liệu';
    if (nameInput) { nameInput.value = ''; }
    if (unitInput) unitInput.value = '';
    if (stockInput) stockInput.value = '';
    if (minStockInput) minStockInput.value = '';
    if (errorEl) errorEl.innerText = '';
    // Reset conversion fields
    var convFrom = document.getElementById('addModalIngredientConvFrom');
    var convTo = document.getElementById('addModalIngredientConvTo');
    var convRate = document.getElementById('addModalIngredientConvRate');
    if (convFrom) convFrom.value = '';
    if (convTo) convTo.value = '';
    if (convRate) convRate.value = '';
    openBottomSheet('addIngredientModal');
    setTimeout(function() { if (nameInput) nameInput.focus(); }, 300);
}

function hideAddIngredientForm() {
    closeModal('addIngredientModal');
    _editingIngredientId = null;
}

function editIngredient(ingId) {
    if (!ingId) return;
    var ings = ingredients || [];
    var ing = null;
    for (var i = 0; i < ings.length; i++) {
        if (ings[i].id === ingId) { ing = ings[i]; break; }
    }
    if (!ing) return;
    
    _editingIngredientId = ingId;
    
    // Populate edit modal
    var titleEl = document.getElementById('editIngredientModalTitle');
    var nameInput = document.getElementById('editIngredientName');
    var unitInput = document.getElementById('editIngredientUnit');
    var stockInput = document.getElementById('editIngredientStock');
    var minStockInput = document.getElementById('editIngredientMinStock');
    var errorEl = document.getElementById('editIngredientError');
    
    if (titleEl) titleEl.innerText = '✏️ Sửa: ' + (ing.name || '');
    if (nameInput) { nameInput.value = ing.name || ''; }
    if (unitInput) unitInput.value = ing.unit || '';
    if (stockInput) stockInput.value = ing.stock || '';
    if (minStockInput) minStockInput.value = ing.minStock || '';
    if (errorEl) errorEl.innerText = '';
    
    // Load conversion fields
    var convFrom = document.getElementById('editIngredientConvFrom');
    var convTo = document.getElementById('editIngredientConvTo');
    var convRate = document.getElementById('editIngredientConvRate');
    if (convFrom) convFrom.value = ing.conversionFrom || '';
    if (convTo) convTo.value = ing.conversionTo || '';
    if (convRate) convRate.value = ing.conversionRate || '';
    
    openBottomSheet('editIngredientModal');
}

function handleIngredientQuickImport() {
    var ingId = _editingIngredientId;
    if (!ingId) { showToast('Không tìm thấy nguyên liệu', 'error'); return; }
    
    var qtyInput = document.getElementById('editIngredientAddStock');
    if (!qtyInput) return;
    var qty = parseFloat(qtyInput.value);
    if (!qty || qty <= 0) { showToast('Vui lòng nhập số lượng > 0', 'error'); return; }
    
    if (typeof addIngredientStock === 'function') {
        addIngredientStock(ingId, qty).then(function() {
            showToast('✅ Đã nhập kho +' + qty, 'success');
            qtyInput.value = '';
            // Refresh ingredient list
            if (typeof renderInventoryIngredients === 'function') {
                renderInventoryIngredients();
            }
            // Update stock display in edit modal
            var ings = ingredients || [];
            for (var i = 0; i < ings.length; i++) {
                if (ings[i].id === ingId) {
                    var stockInput = document.getElementById('editIngredientStock');
                    if (stockInput) stockInput.value = ings[i].stock || '';
                    break;
                }
            }
        }).catch(function(err) {
            showToast('Lỗi nhập kho: ' + err.message, 'error');
        });
    } else {
        showToast('Chức năng nhập kho chưa sẵn sàng', 'error');
    }
}

function handleSaveIngredient() {
    // FIX: Chống double-submit
    if (_savingIngredient) return;
    
    var nameInput = document.getElementById('addModalIngredientName');
    var unitInput = document.getElementById('addModalIngredientUnit');
    var stockInput = document.getElementById('addModalIngredientStock');
    var minStockInput = document.getElementById('addModalIngredientMinStock');
    var errorEl = document.getElementById('addModalIngredientError');
    
    if (!nameInput) return;
    var name = nameInput.value.trim();
    var unit = unitInput ? unitInput.value.trim() : '';
    var stock = parseFloat(stockInput ? stockInput.value : '') || 0;
    var minStock = parseFloat(minStockInput ? minStockInput.value : '') || 0;
    
    if (!name) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập tên nguyên liệu';
        return;
    }
    if (errorEl) errorEl.innerText = '';
    
    // FIX: Kiểm tra trùng tên nguyên liệu (chỉ khi thêm mới hoặc đổi tên)
    var ings = ingredients || [];
    for (var ii = 0; ii < ings.length; ii++) {
        if (ings[ii].name === name && ings[ii].id !== _editingIngredientId) {
            if (errorEl) errorEl.innerText = 'Tên nguyên liệu "' + name + '" đã tồn tại!';
            return;
        }
    }
    
    _savingIngredient = true;
    
    // Collect conversion data
    var convFrom = document.getElementById('addModalIngredientConvFrom');
    var convTo = document.getElementById('addModalIngredientConvTo');
    var convRate = document.getElementById('addModalIngredientConvRate');
    var conversionFrom = convFrom ? convFrom.value.trim() : '';
    var conversionTo = convTo ? convTo.value.trim() : '';
    var conversionRate = parseFloat(convRate ? convRate.value : '') || 0;
    
    var data = {
        name: name,
        unit: unit,
        stock: stock,
        minStock: minStock
    };
    
    // Only save conversion if all fields are filled
    if (conversionFrom && conversionTo && conversionRate > 0) {
        data.conversionFrom = conversionFrom;
        data.conversionTo = conversionTo;
        data.conversionRate = conversionRate;
    } else {
        // Clear conversion if not fully specified
        data.conversionFrom = '';
        data.conversionTo = '';
        data.conversionRate = 0;
    }
    
    if (_editingIngredientId) {
        DB.update('ingredients', _editingIngredientId, data).then(function() {
            showToast('Đã cập nhật nguyên liệu', 'success');
            hideAddIngredientForm();
            _savingIngredient = false;
            return DB.getAll('ingredients');
        }).then(function(ings) {
            ingredients = ings;
            window.ingredients = ings;
            renderInventoryIngredients();
            _invalidateLookups();
        }).catch(function(err) {
            if (errorEl) errorEl.innerText = err.message || 'Lỗi cập nhật';
            _savingIngredient = false;
        });
    } else {
        DB.create('ingredients', data).then(function(newIng) {
            showToast('Đã thêm nguyên liệu', 'success');
            hideAddIngredientForm();
            _savingIngredient = false;
            // FIX: Không push newIng vào ingredients vì _notifyLocal() trong saveToLocal()
            // đã gọi callback realtime -> gán ingredients = data (từ memoryCache, đã có newIng)
            // Nếu push thêm sẽ bị duplicate
            renderInventoryIngredients();
            _invalidateLookups();
        }).catch(function(err) {
            if (errorEl) errorEl.innerText = err.message || 'Lỗi tạo nguyên liệu';
            _savingIngredient = false;
        });
    }
}

function handleEditIngredientSave() {
    // Chống double-click
    if (_savingIngredient) return;
    
    var nameInput = document.getElementById('editIngredientName');
    var unitInput = document.getElementById('editIngredientUnit');
    var stockInput = document.getElementById('editIngredientStock');
    var minStockInput = document.getElementById('editIngredientMinStock');
    var errorEl = document.getElementById('editIngredientError');
    
    if (!nameInput) return;
    var name = nameInput.value.trim();
    var unit = unitInput ? unitInput.value.trim() : '';
    var stock = parseFloat(stockInput ? stockInput.value : '') || 0;
    var minStock = parseFloat(minStockInput ? minStockInput.value : '') || 0;
    
    if (!name) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập tên nguyên liệu';
        return;
    }
    if (errorEl) errorEl.innerText = '';
    
    // FIX: Kiểm tra trùng tên nguyên liệu khi sửa
    var ings = ingredients || [];
    for (var ii = 0; ii < ings.length; ii++) {
        if (ings[ii].name === name && ings[ii].id !== _editingIngredientId) {
            if (errorEl) errorEl.innerText = 'Tên nguyên liệu "' + name + '" đã tồn tại!';
            return;
        }
    }
    
    // Thu thập dữ liệu chuyển đổi đơn vị
    var convFrom = document.getElementById('editIngredientConvFrom');
    var convTo = document.getElementById('editIngredientConvTo');
    var convRate = document.getElementById('editIngredientConvRate');
    var conversionFrom = convFrom ? convFrom.value.trim() : '';
    var conversionTo = convTo ? convTo.value.trim() : '';
    var conversionRate = parseFloat(convRate ? convRate.value : '') || 0;
    
    var data = {
        name: name,
        unit: unit,
        stock: stock,
        minStock: minStock
    };
    
    if (conversionFrom && conversionTo && conversionRate > 0) {
        data.conversionFrom = conversionFrom;
        data.conversionTo = conversionTo;
        data.conversionRate = conversionRate;
    } else {
        data.conversionFrom = '';
        data.conversionTo = '';
        data.conversionRate = 0;
    }
    
    if (!_editingIngredientId) {
        if (errorEl) errorEl.innerText = 'Lỗi: không tìm thấy nguyên liệu';
        _savingIngredient = false;
        return;
    }
    
    _savingIngredient = true;
    
    DB.update('ingredients', _editingIngredientId, data).then(function() {
        showToast('Đã cập nhật nguyên liệu', 'success');
        closeModal('editIngredientModal');
        return DB.getAll('ingredients');
    }).then(function(ings) {
        ingredients = ings;
        window.ingredients = ings;
        renderInventoryIngredients();
        _invalidateLookups();
        _savingIngredient = false;
    }).catch(function(err) {
        if (errorEl) errorEl.innerText = err.message || 'Lỗi cập nhật';
        _savingIngredient = false;
    });
}

function deleteIngredient(ingId) {
    if (!ingId) return;
    if (!confirm('Xóa nguyên liệu này?')) return;
    
    DB.remove('ingredients', ingId).then(function() {
        showToast('Đã xóa nguyên liệu', 'success');
        ingredients = ingredients.filter(function(i) { return i.id !== ingId; });
        window.ingredients = ingredients;
        renderInventoryIngredients();
        _invalidateLookups();
    }).catch(function(err) {
        showToast('Lỗi xóa nguyên liệu', 'error');
    });
}

// ========== LỊCH SỬ SỬ DỤNG NGUYÊN LIỆU ==========
function showIngredientUsage(ingId) {
    if (!ingId) return;
    window._currentIngId = ingId;
    var ings = ingredients || [];
    var ing = null;
    for (var i = 0; i < ings.length; i++) {
        if (ings[i].id === ingId) { ing = ings[i]; break; }
    }
    if (!ing) return;

    var titleEl = document.getElementById('ingredientUsageTitle');
    var summaryEl = document.getElementById('ingUsageSummary');
    var datesEl = document.getElementById('ingUsageDates');
    var txListEl = document.getElementById('ingTxList');
    if (!datesEl) return;

    if (titleEl) titleEl.innerText = '🧂 ' + (ing.name || 'Nguyên liệu');

    // Reset tabs to show Usage tab by default
    var tabs = document.querySelectorAll('.ing-usage-tab');
    for (var ti = 0; ti < tabs.length; ti++) { tabs[ti].classList.remove('active'); }
    var usageTab = document.querySelector('.ing-usage-tab[data-tab="usage"]');
    if (usageTab) usageTab.classList.add('active');
    var usageContent = document.getElementById('ingUsageTabUsage');
    var txContent = document.getElementById('ingUsageTabTransactions');
    if (usageContent) usageContent.style.display = '';
    if (txContent) txContent.style.display = 'none';

    // Find which menu items use this ingredient
    var menuItems = window.menuItems || [];
    var relatedMenuIds = {};
    var relatedMenuNames = {};
    for (var i = 0; i < menuItems.length; i++) {
        var mi = menuItems[i];
        if (mi.ingredients && mi.ingredients.length > 0) {
            for (var j = 0; j < mi.ingredients.length; j++) {
                if (String(mi.ingredients[j].ingredientId) === String(ingId)) {
                    relatedMenuIds[mi.id] = true;
                    relatedMenuNames[mi.id] = mi.name;
                    break;
                }
            }
        }
        // Also check per-variant ingredients
        var variantData = (mi.variants && mi.variants.length > 0) ? mi.variants : (mi.sizes || []);
        for (var vi = 0; vi < variantData.length; vi++) {
            var vIngs = variantData[vi].ingredients || [];
            for (var j = 0; j < vIngs.length; j++) {
                if (String(vIngs[j].ingredientId) === String(ingId)) {
                    relatedMenuIds[mi.id] = true;
                    relatedMenuNames[mi.id] = mi.name;
                    break;
                }
            }
        }
    }

    var relatedCount = Object.keys(relatedMenuIds).length;

    // Determine display units
    var baseUnit = ing.unit || '';
    var convRate = parseFloat(ing.conversionRate) || 0;
    var convTo = ing.conversionTo || '';
    var hasConv = convRate > 0 && convTo;
    // For usage tab (recipe quantities are in converted unit), use convTo if available
    var displayUnit = hasConv ? convTo : baseUnit;

    // Helper: format quantity with both base and converted units
    function _fmtQty(qty, showConv) {
        var s = Math.round(qty * 100) / 100 + ' ' + baseUnit;
        if (showConv && hasConv) {
            var convQty = Math.round(qty * convRate * 100) / 100;
            s += ' (' + convQty + ' ' + convTo + ')';
        }
        return s;
    }

    // Load transaction history (nhập từ cost_transactions + xuất từ transactions/orders + ingredient_transactions)
    var txPromises = [];
    if (typeof getIngredientTransactions === 'function') {
        txPromises.push(getIngredientTransactions(ingId));
    }
    // Get import data from cost_transactions
    txPromises.push(DB.getAll('cost_transactions').then(function(costs) {
        if (!costs || !costs.length) return [];
        var result = [];
        for (var ci = 0; ci < costs.length; ci++) {
            var c = costs[ci];
            if (c.deleted) continue;
            if (String(c.ingredientId) === String(ingId) || c.categoryId === 'ingredient_' + String(ingId)) {
                result.push({
                    type: 'import',
                    quantity: parseFloat(c.ingredientQty) || parseFloat(c.quantity) || 0,
                    unit: baseUnit,
                    note: 'Mua: ' + (c.ingredientName || c.categoryName || '') + ' - ' + formatMoney(c.amount),
                    dateKey: c.dateKey || '',
                    time: c.date ? c.date.slice(11, 19) : '',
                    createdAt: c.createdAt || 0,
                    _source: 'cost'
                });
            }
        }
        return result;
    }));
    // Get export data from transactions (order history) - same logic as usage tab
    txPromises.push(DB.getAll('transactions').then(function(transactions) {
        if (!transactions || !transactions.length) return [];
        var result = [];
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            if (tx.refunded) continue;
            if (!tx.items || !tx.items.length) continue;
            var dateKey = tx.dateKey || '';
            if (!dateKey) continue;
            for (var j = 0; j < tx.items.length; j++) {
                var orderItem = tx.items[j];
                var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
                var isRelated = false;
                for (var mid in relatedMenuIds) {
                    if (relatedMenuIds.hasOwnProperty(mid)) {
                        if (orderItem.id === mid || relatedMenuNames[mid] === baseName) {
                            isRelated = true;
                            break;
                        }
                    }
                }
                if (!isRelated) continue;
                // Find recipe quantity for this ingredient
                var recipeQty = 0;
                for (var k = 0; k < menuItems.length; k++) {
                    if (menuItems[k].id === orderItem.id || menuItems[k].name === baseName) {
                        if (menuItems[k].ingredients) {
                            for (var l = 0; l < menuItems[k].ingredients.length; l++) {
                                if (String(menuItems[k].ingredients[l].ingredientId) === String(ingId)) {
                                    recipeQty = menuItems[k].ingredients[l].quantity || 0;
                                    break;
                                }
                            }
                        }
                        if (recipeQty === 0) {
                            var variantData = (menuItems[k].variants && menuItems[k].variants.length > 0) ? menuItems[k].variants : (menuItems[k].sizes || []);
                            for (var vi = 0; vi < variantData.length; vi++) {
                                var vIngs = variantData[vi].ingredients || [];
                                for (var l = 0; l < vIngs.length; l++) {
                                    if (String(vIngs[l].ingredientId) === String(ingId)) {
                                        recipeQty = vIngs[l].quantity || 0;
                                        break;
                                    }
                                }
                                if (recipeQty > 0) break;
                            }
                        }
                        break;
                    }
                }
                if (recipeQty <= 0) continue;
                var qtyUsed = recipeQty * orderItem.qty;
                // Convert recipe qty (in display unit) to base unit for consistent display
                var baseQty = hasConv ? (qtyUsed / convRate) : qtyUsed;
                result.push({
                    type: 'export',
                    quantity: baseQty,
                    unit: baseUnit,
                    note: 'Bán: ' + orderItem.name + ' x' + orderItem.qty + ' (' + Math.round(qtyUsed * 100) / 100 + ' ' + displayUnit + ')',
                    dateKey: dateKey,
                    time: tx.time || '',
                    createdAt: tx.createdAt || 0,
                    _source: 'order'
                });
            }
        }
        return result;
    }));

    Promise.all(txPromises).then(function(results) {
        if (txListEl) {
            // Merge all transactions
            var allTx = [];
            for (var ri = 0; ri < results.length; ri++) {
                if (results[ri] && results[ri].length) {
                    allTx = allTx.concat(results[ri]);
                }
            }

            // Tag ingredient_transactions records with _source for dedup
            // (they come from getIngredientTransactions which returns raw store records)
            for (var ti = 0; ti < allTx.length; ti++) {
                if (!allTx[ti]._source) {
                    allTx[ti]._source = 'ing_tx';
                }
            }

            // Deduplicate: remove ingredient_transactions imports that have matching cost_transactions
            // (saveIngredientExpense logs to BOTH ingredient_transactions AND cost_transactions)
            var costKeys = {};
            for (var di = 0; di < allTx.length; di++) {
                if (allTx[di]._source === 'cost') {
                    var key = allTx[di].dateKey + '_' + Math.round(allTx[di].quantity * 1000);
                    costKeys[key] = true;
                }
            }
            var deduped = [];
            for (var di = 0; di < allTx.length; di++) {
                if (allTx[di]._source === 'ing_tx' && allTx[di].type === 'import') {
                    var key = allTx[di].dateKey + '_' + Math.round(allTx[di].quantity * 1000);
                    if (costKeys[key]) continue; // Skip, already in cost_transactions
                }
                deduped.push(allTx[di]);
            }
            allTx = deduped;

            // Get date filter values
            var filterFrom = document.getElementById('ingTxFilterFrom');
            var filterTo = document.getElementById('ingTxFilterTo');
            var fromVal = filterFrom ? filterFrom.value : '';
            var toVal = filterTo ? filterTo.value : '';

            // Apply date filter
            if (fromVal || toVal) {
                var filtered = [];
                for (var fi = 0; fi < allTx.length; fi++) {
                    var dk = allTx[fi].dateKey || '';
                    if (fromVal && dk < fromVal) continue;
                    if (toVal && dk > toVal) continue;
                    filtered.push(allTx[fi]);
                }
                allTx = filtered;
            }

            if (allTx.length === 0) {
                txListEl.innerHTML = '<div class="ing-usage-empty">📭 Chưa có giao dịch nhập/xuất</div>';
            } else {
                // Sort by date (oldest first for running balance), then by time
                allTx.sort(function(a, b) {
                    if (a.dateKey !== b.dateKey) return a.dateKey.localeCompare(b.dateKey);
                    return (a.createdAt || 0) - (b.createdAt || 0);
                });

                // Calculate running balance
                var currentStock = parseFloat(ing.stock) || 0;
                // Work backwards: start from current stock, reverse transactions to get historical balance
                // First, calculate total net change from all transactions
                var totalNetChange = 0;
                for (var si = 0; si < allTx.length; si++) {
                    if (allTx[si].type === 'import') totalNetChange += allTx[si].quantity;
                    else totalNetChange -= allTx[si].quantity;
                }
                // Starting balance = current stock - total net change
                var runningBalance = currentStock - totalNetChange;

                // Group by dateKey (newest first for display)
                var txByDate = {};
                for (var ti = 0; ti < allTx.length; ti++) {
                    var txn = allTx[ti];
                    var dk = txn.dateKey || '';
                    if (!dk) continue;
                    if (!txByDate[dk]) {
                        txByDate[dk] = { items: [], importTotal: 0, exportTotal: 0 };
                    }
                    txByDate[dk].items.push(txn);
                    if (txn.type === 'import') {
                        txByDate[dk].importTotal += txn.quantity;
                    } else {
                        txByDate[dk].exportTotal += txn.quantity;
                    }
                }

                var dateKeys = Object.keys(txByDate).sort().reverse();
                var txHtml = '';
                for (var di = 0; di < dateKeys.length; di++) {
                    var dk = dateKeys[di];
                    var dayData = txByDate[dk];
                    var dateLabel = formatDateDisplay(dk);

                    // Calculate running balance for this date's items (oldest first within the day)
                    var dayItems = dayData.items;
                    dayItems.sort(function(a, b) {
                        return (a.createdAt || 0) - (b.createdAt || 0);
                    });

                    // Build items for this date
                    var dayItemsHtml = '';
                    for (var tii = 0; tii < dayItems.length; tii++) {
                        var txn = dayItems[tii];
                        var isImport = txn.type === 'import';
                        var icon = isImport ? '📥' : '📤';
                        var iconClass = isImport ? 'import' : 'export';
                        var qtyClass = isImport ? 'import' : 'export';
                        var qtyStr = (isImport ? '+' : '-') + _fmtQty(txn.quantity, true);
                        var timeStr = txn.time ? ' ' + txn.time : '';

                        // Update running balance
                        if (isImport) runningBalance += txn.quantity;
                        else runningBalance -= txn.quantity;
                        var balStr = _fmtQty(runningBalance, true);

                        dayItemsHtml +=
                            '<div class="ing-tx-item">' +
                                '<div class="ing-tx-icon ' + iconClass + '">' + icon + '</div>' +
                                '<div class="ing-tx-info">' +
                                    '<div class="ing-tx-note">' + escapeHtml(txn.note || '') + '</div>' +
                                    '<div class="ing-tx-meta">' + timeStr + '</div>' +
                                '</div>' +
                                '<div class="ing-tx-qty ' + qtyClass + '">' + qtyStr + '</div>' +
                                '<div class="ing-tx-balance" title="Tồn còn lại">' + balStr + '</div>' +
                            '</div>';
                    }

                    // Calculate daily net (base unit)
                    var netQty = dayData.importTotal - dayData.exportTotal;
                    var netStr = _fmtQty(Math.abs(netQty), true);
                    if (netQty > 0) netStr = '+' + netStr;
                    else if (netQty < 0) netStr = '-' + netStr;
                    else netStr = '0 ' + baseUnit + (hasConv ? ' (0 ' + convTo + ')' : '');

                    // Build header summary
                    var importStr = '+' + _fmtQty(dayData.importTotal, true);
                    var exportStr = '-' + _fmtQty(dayData.exportTotal, true);

                    txHtml +=
                        '<div class="ing-usage-date-group">' +
                            '<div class="ing-usage-date-header" onclick="toggleIngUsageDate(this)">' +
                                '<div class="date-info">' +
                                    '<span class="date-toggle">▶</span>' +
                                    '<span>' + dateLabel + '</span>' +
                                '</div>' +
                                '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:2px;">' +
                                    '<span style="font-size:11px;color:#16a34a;font-weight:500;">Nhập: ' + importStr + '</span>' +
                                    '<span style="font-size:11px;color:#dc2626;font-weight:500;">Xuất: ' + exportStr + '</span>' +
                                    '<span class="date-total" style="font-size:12px;">Tổng: ' + netStr + '</span>' +
                                '</div>' +
                            '</div>' +
                            '<div class="ing-usage-date-body">' +
                                dayItemsHtml +
                            '</div>' +
                        '</div>';
                }
                txListEl.innerHTML = txHtml;
            }
        }
    });

    // Query all transactions to find usage
    DB.getAll('transactions').then(function(transactions) {
        // Group by dateKey
        var usageByDate = {};
        var totalUsed = 0;
        var totalOrders = 0;

        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            if (tx.refunded) continue; // Skip refunded transactions
            if (!tx.items || !tx.items.length) continue;

            var dateKey = tx.dateKey || '';
            if (!dateKey) continue;

            for (var j = 0; j < tx.items.length; j++) {
                var orderItem = tx.items[j];
                // Check if this item is related to our ingredient
                var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
                var isRelated = false;
                for (var mid in relatedMenuIds) {
                    if (relatedMenuIds.hasOwnProperty(mid)) {
                        if (orderItem.id === mid || relatedMenuNames[mid] === baseName) {
                            isRelated = true;
                            break;
                        }
                    }
                }
                if (!isRelated) continue;

                // Find the recipe quantity for this ingredient
                var recipeQty = 0;
                for (var k = 0; k < menuItems.length; k++) {
                    if (menuItems[k].id === orderItem.id || menuItems[k].name === baseName) {
                        // Check global ingredients
                        if (menuItems[k].ingredients) {
                            for (var l = 0; l < menuItems[k].ingredients.length; l++) {
                                if (String(menuItems[k].ingredients[l].ingredientId) === String(ingId)) {
                                    recipeQty = menuItems[k].ingredients[l].quantity || 0;
                                    break;
                                }
                            }
                        }
                        // If not found in global, check per-variant ingredients
                        if (recipeQty === 0) {
                            var variantData = (menuItems[k].variants && menuItems[k].variants.length > 0) ? menuItems[k].variants : (menuItems[k].sizes || []);
                            for (var vi = 0; vi < variantData.length; vi++) {
                                var vIngs = variantData[vi].ingredients || [];
                                for (var l = 0; l < vIngs.length; l++) {
                                    if (String(vIngs[l].ingredientId) === String(ingId)) {
                                        recipeQty = vIngs[l].quantity || 0;
                                        break;
                                    }
                                }
                                if (recipeQty > 0) break;
                            }
                        }
                        break;
                    }
                }

                var qtyUsed = recipeQty * orderItem.qty;
                totalUsed += qtyUsed;
                totalOrders += orderItem.qty;

                if (!usageByDate[dateKey]) {
                    usageByDate[dateKey] = {
                        items: {},
                        totalQty: 0,
                        orderCount: 0
                    };
                }
                var itemKey = orderItem.id + '_' + orderItem.name;
                if (!usageByDate[dateKey].items[itemKey]) {
                    usageByDate[dateKey].items[itemKey] = {
                        name: orderItem.name,
                        qty: 0,
                        count: 0
                    };
                }
                usageByDate[dateKey].items[itemKey].qty += qtyUsed;
                usageByDate[dateKey].items[itemKey].count += orderItem.qty;
                usageByDate[dateKey].totalQty += qtyUsed;
                usageByDate[dateKey].orderCount += orderItem.qty;
            }
        }

        var summaryHtml =
            '<div class="usage-stat">' +
                '<span class="usage-stat-label">📦 Món có chứa nguyên liệu:</span>' +
                '<span class="usage-stat-value">' + relatedCount + ' món</span>' +
            '</div>' +
            '<div class="usage-stat">' +
                '<span class="usage-stat-label">📊 Tổng số lượng đã dùng:</span>' +
                '<span class="usage-stat-value">' + Math.round(totalUsed * 100) / 100 + ' ' + escapeHtml(displayUnit) + '</span>' +
            '</div>' +
            '<div class="usage-stat">' +
                '<span class="usage-stat-label">📋 Tổng số món đã bán:</span>' +
                '<span class="usage-stat-value">' + totalOrders + ' món</span>' +
            '</div>' +
            '<div style="margin-top:8px;display:flex;gap:6px;">' +
                '<button class="btn-small btn-outline" onclick="closeModal(\'ingredientUsageModal\');editIngredient(\'' + ing.id + '\')" style="flex:1;font-size:12px;">✏️ Sửa nguyên liệu</button>' +
                '<button class="btn-small btn-danger" onclick="closeModal(\'ingredientUsageModal\');deleteIngredient(\'' + ing.id + '\')" style="flex:1;font-size:12px;">🗑️ Xóa</button>' +
            '</div>';
        if (summaryEl) summaryEl.innerHTML = summaryHtml;

        // Build date groups
        var dateKeys = Object.keys(usageByDate).sort().reverse(); // newest first
        if (dateKeys.length === 0) {
            if (datesEl) datesEl.innerHTML = '<div class="ing-usage-empty">📭 Chưa có dữ liệu sử dụng</div>';
            openBottomSheet('ingredientUsageModal');
            return;
        }

        var datesHtml = '';
        for (var d = 0; d < dateKeys.length; d++) {
            var dk = dateKeys[d];
            var dayData = usageByDate[dk];
            var dateLabel = formatDateDisplay(dk);
            var itemKeys = Object.keys(dayData.items);

            var itemsHtml = '';
            for (var m = 0; m < itemKeys.length; m++) {
                var itemData = dayData.items[itemKeys[m]];
                itemsHtml += '<div class="ing-usage-item">' +
                    '<div>' +
                        '<div class="item-name">' + escapeHtml(itemData.name) + '</div>' +
                        '<div class="item-order-info">Đã bán: ' + itemData.count + ' món</div>' +
                    '</div>' +
                    '<div class="item-qty">' + Math.round(itemData.qty * 100) / 100 + ' ' + escapeHtml(displayUnit) + '</div>' +
                '</div>';
            }

            datesHtml +=
                '<div class="ing-usage-date-group">' +
                    '<div class="ing-usage-date-header" onclick="toggleIngUsageDate(this)">' +
                        '<div class="date-info">' +
                            '<span class="date-toggle">▶</span>' +
                            '<span>' + dateLabel + '</span>' +
                        '</div>' +
                        '<div>' +
                            '<span class="date-total">' + Math.round(dayData.totalQty * 100) / 100 + ' ' + escapeHtml(displayUnit) + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="ing-usage-date-body">' +
                        itemsHtml +
                    '</div>' +
                '</div>';
        }
        if (datesEl) datesEl.innerHTML = datesHtml;

        openBottomSheet('ingredientUsageModal');
    });
}

function toggleIngUsageDate(headerEl) {
    if (!headerEl) return;
    var toggle = headerEl.querySelector('.date-toggle');
    var body = headerEl.nextElementSibling;
    if (!body) return;
    if (body.classList.contains('expanded')) {
        body.classList.remove('expanded');
        if (toggle) toggle.classList.remove('expanded');
    } else {
        body.classList.add('expanded');
        if (toggle) toggle.classList.add('expanded');
    }
}

function switchIngUsageTab(tabName) {
    var tabs = document.querySelectorAll('.ing-usage-tab');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tabName);
    }
    var usageContent = document.getElementById('ingUsageTabUsage');
    var txContent = document.getElementById('ingUsageTabTransactions');
    if (usageContent) usageContent.style.display = tabName === 'usage' ? '' : 'none';
    if (txContent) txContent.style.display = tabName === 'transactions' ? '' : 'none';
}

// Export global functions
window.renderInventoryMenu = renderInventoryMenu;
window.renderInventoryIngredients = renderInventoryIngredients;
window.renderInventoryCategoryFilter = renderInventoryCategoryFilter;
window.renderInventoryCategories = renderInventoryCategories;
window.showAddCategoryForm = showAddCategoryForm;
window.hideAddCategoryForm = hideAddCategoryForm;
window.editCategory = editCategory;
window.handleSaveCategory = handleSaveCategory;
window.deleteCategory = deleteCategory;
window.showAddMenuItemForm = showAddMenuItemForm;
window.hideAddMenuItemForm = hideAddMenuItemForm;
window.editMenuItem = editMenuItem;
window.handleSaveMenuItem = handleSaveMenuItem;
window.deleteMenuItem = deleteMenuItem;
window.showAddIngredientForm = showAddIngredientForm;
window.hideAddIngredientForm = hideAddIngredientForm;
window.editIngredient = editIngredient;
window.handleSaveIngredient = handleSaveIngredient;
window.handleEditIngredientSave = handleEditIngredientSave;
window.deleteIngredient = deleteIngredient;
window.showMenuItemDetail = showMenuItemDetail;
window.handleEditMenuItemSave = handleEditMenuItemSave;
window._addEditMenuItemSizeRow = _addEditMenuItemSizeRow;
window._addEditMenuItemIngredientRow = _addEditMenuItemIngredientRow;
window._createEditSizeIngRow = _createEditSizeIngRow;
// Export cho form thêm món (addMenuItemModal)
window._addMenuItemSizeRow = _addMenuItemSizeRow;
window._addMenuItemIngredientRow = _addMenuItemIngredientRow;
window._createSizeIngRow = _createSizeIngRow;
window._resetMenuItemSizes = _resetMenuItemSizes;
window._resetMenuItemIngredients = _resetMenuItemIngredients;
window.showIngredientUsage = showIngredientUsage;
window.toggleIngUsageDate = toggleIngUsageDate;
window.switchIngUsageTab = switchIngUsageTab;
window.handleIngredientQuickImport = handleIngredientQuickImport;
