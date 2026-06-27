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

// ========== DOM HELPER FUNCTIONS ==========
// Tránh lỗi khi cấu trúc HTML thay đổi - kiểm tra tồn tại element trước khi đọc value
function _safeVal(selector, parent) {
    parent = parent || document;
    var el = parent.querySelector(selector);
    return el ? el.value.trim() : '';
}

function _safeInt(selector, parent, fallback) {
    parent = parent || document;
    fallback = fallback || 0;
    var el = parent.querySelector(selector);
    return el ? parseInt(el.value) || fallback : fallback;
}

function _safeFloat(selector, parent, fallback) {
    parent = parent || document;
    fallback = fallback || 0;
    var el = parent.querySelector(selector);
    return el ? parseFloat(el.value) || fallback : fallback;
}

function _safeText(selector, parent) {
    parent = parent || document;
    var el = parent.querySelector(selector);
    return el ? el.innerText.trim() : '';
}

// Global helper: tra cứu tên nguyên liệu theo ID
function _lookupIngName(id) {
    var ings = window.ingredients || ingredients || [];
    for (var j = 0; j < ings.length; j++) {
        if (ings[j].id === id) return ings[j].name;
    }
    return '';
}

function _collectSelectValues(containerSelector, selectSelector, qtySelector, unitSelector) {
    // Collect paired values from multiple rows: select, qty, unit
    var container = document.querySelector(containerSelector);
    if (!container) return [];
    var result = [];
    var selects = container.querySelectorAll(selectSelector);
    var qtys = container.querySelectorAll(qtySelector);
    var units = container.querySelectorAll(unitSelector);
    for (var i = 0; i < selects.length; i++) {
        var ingId = selects[i].value;
        var ingQty = parseFloat(qtys[i] ? qtys[i].value : 0) || 0;
        var ingUnit = units[i] ? units[i].value.trim() : '';
        if (ingId && ingQty > 0) {
            result.push({
                ingredientId: ingId,
                ingredientName: _lookupIngName(ingId),
                quantity: ingQty,
                unit: ingUnit
            });
        }
    }
    return result;
}

function _collectSizeRows(containerSelector, nameSelector, priceSelector, ingSelectSelector, ingQtySelector, ingUnitSelector, recipeSelector) {
    // Collect size/variant rows from a container
    var container = document.querySelector(containerSelector);
    if (!container) return [];
    var sizes = [];
    var rows = container.querySelectorAll('.inv-form-row');
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var sName = _safeVal(nameSelector, row);
        if (!sName) continue;
        var sPrice = _safeInt(priceSelector, row);
        
        // Collect per-variant ingredients
        var sizeIngs = [];
        var ingSelects = row.querySelectorAll(ingSelectSelector);
        var ingQtys = row.querySelectorAll(ingQtySelector);
        var ingUnits = row.querySelectorAll(ingUnitSelector);
        for (var si = 0; si < ingSelects.length; si++) {
            var ingId = ingSelects[si].value;
            var ingQty = parseFloat(ingQtys[si] ? ingQtys[si].value : 0) || 0;
            var ingUnit = ingUnits[si] ? ingUnits[si].value.trim() : '';
            if (ingId && ingQty > 0) {
                sizeIngs.push({
                    ingredientId: ingId,
                    ingredientName: _lookupIngName(ingId),
                    quantity: ingQty,
                    unit: ingUnit
                });
            }
        }
        
        var recipe = _safeVal(recipeSelector, row);
        
        sizes.push({
            name: sName,
            price: sPrice,
            ingredients: sizeIngs.length > 0 ? sizeIngs : [],
            recipe: recipe
        });
    }
    return sizes;
}

// ========== BIẾN TẠM CHO MODAL THÊM MÓN ==========
// Đã chuyển sang DOM-based collection, không cần data-driven arrays nữa

// Biến tracking cho filter danh mục dạng nút bấm
var _invFilterCategoryId = 'all';

// Biến timeout cho debounce tìm kiếm
var _invSearchTimeout = null;

// Hàm lọc món trong tab Quản lý thực đơn
function filterInventoryMenu(keyword) {
    if (_invSearchTimeout) clearTimeout(_invSearchTimeout);
    _invSearchTimeout = setTimeout(function() {
        _invSearchTimeout = null;
        var container = document.getElementById('invMenuItemList');
        if (!container) return;
        
        keyword = _removeAccents(keyword.trim().toLowerCase());
        if (!keyword) {
            renderInventoryMenu();
            return;
        }
        
        var items = menuItems || [];
        var filtered = items.filter(function(item) {
            return _removeAccents(item.name.toLowerCase()).indexOf(keyword) !== -1;
        });
        
        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-text">🔍 Không tìm thấy món</div>';
            return;
        }
        
        // Render lại danh sách đã lọc (dùng _doRenderInventoryMenu với cat='all' để hiển thị tất cả kết quả)
        var cats = menuCategories || [];
        _doRenderInventoryMenu(filtered, cats, 'all', container);
    }, 150);
}

// Hàm lọc nguyên liệu trong tab Quản lý tồn kho
function filterInventoryIngredients(keyword) {
    if (_invSearchTimeout) clearTimeout(_invSearchTimeout);
    _invSearchTimeout = setTimeout(function() {
        _invSearchTimeout = null;
        var container = document.getElementById('invIngredientList');
        if (!container) return;
        
        keyword = _removeAccents(keyword.trim().toLowerCase());
        if (!keyword) {
            renderInventoryIngredients();
            return;
        }
        
        var ings = ingredients || [];
        var filtered = ings.filter(function(ing) {
            if (ing.deleted) return false;
            return _removeAccents((ing.name || '').toLowerCase()).indexOf(keyword) !== -1;
        });
        
        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-text">🔍 Không tìm thấy nguyên liệu</div>';
            return;
        }
        
        // Render lại danh sách đã lọc (dùng logic render giống renderInventoryIngredients)
        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            var ing = filtered[i];
            var stock = parseFloat(ing.stock) || 0;
            var minStock = parseFloat(ing.minStock) || 0;
            var isLow = minStock > 0 && stock <= minStock;
            var unit = ing.unit || '';
            
            var conversionHtml = '';
            var convertedStockHtml = '';
            if (ing.conversionFrom && ing.conversionTo && ing.conversionRate) {
                conversionHtml = '<span class="inv-ing-conversion">1 ' + escapeHtml(ing.conversionFrom) + ' → ' + ing.conversionRate + ' ' + escapeHtml(ing.conversionTo) + '</span>';
                var convertedStock = Math.round(stock * ing.conversionRate * 10) / 10;
                convertedStockHtml = '<span class="inv-ing-converted">' + convertedStock + ' ' + escapeHtml(ing.conversionTo) + '</span>';
            }
            
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
    }, 150);
}

// Hàm chọn filter danh mục (gọi từ onclick)
function setInvMenuFilter(catId) {
    _invFilterCategoryId = catId || 'all';
    // Cập nhật active class cho các nút
    var container = document.getElementById('invMenuFilter');
    if (container) {
        var btns = container.querySelectorAll('.inv-filter-btn');
        for (var i = 0; i < btns.length; i++) {
            var btn = btns[i];
            if (btn.getAttribute('data-cat') === _invFilterCategoryId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    }
    renderInventoryMenu();
}

// ========== CONTEXT MENU CHO DANH MỤC (long-press / right-click) ==========
function showInvCategoryContextMenu(catId, event) {
    if (!catId) return;
    var cats = menuCategories || [];
    var cat = null;
    for (var i = 0; i < cats.length; i++) {
        if (cats[i].id === catId) { cat = cats[i]; break; }
    }
    if (!cat) return;
    
    // Tạo context menu overlay
    var existing = document.getElementById('invCategoryContextMenu');
    if (existing) existing.remove();
    
    var overlay = document.createElement('div');
    overlay.id = 'invCategoryContextMenu';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.3);';
    
    var menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;z-index:10000;background:#fff;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.25);padding:8px 0;min-width:200px;max-width:260px;';
    
    // Xác định vị trí
    var x, y;
    if (event && event.touches && event.touches.length > 0) {
        x = event.touches[0].clientX;
        y = event.touches[0].clientY;
    } else if (event && (event.clientX !== undefined)) {
        x = event.clientX;
        y = event.clientY;
    } else {
        x = window.innerWidth / 2;
        y = window.innerHeight / 2;
    }
    
    // Giới hạn menu không tràn màn hình
    var menuW = 220;
    var menuH = 120;
    if (x + menuW > window.innerWidth) x = window.innerWidth - menuW - 10;
    if (y + menuH > window.innerHeight) y = window.innerHeight - menuH - 10;
    if (x < 10) x = 10;
    if (y < 10) y = 10;
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    
    // Tiêu đề
    var title = document.createElement('div');
    title.style.cssText = 'padding:8px 16px;font-weight:600;font-size:14px;color:#1e293b;border-bottom:1px solid #e2e8f0;';
    title.innerText = cat.name || 'Danh mục';
    menu.appendChild(title);
    
    // Nút sửa
    var editBtn = document.createElement('button');
    editBtn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:10px 16px;border:none;background:none;font-size:14px;color:#1e293b;cursor:pointer;text-align:left;';
    editBtn.innerHTML = '✏️ Sửa danh mục';
    editBtn.onmouseover = function() { this.style.background = '#f1f5f9'; };
    editBtn.onmouseout = function() { this.style.background = 'none'; };
    editBtn.onclick = function() {
        closeInvCategoryContextMenu();
        editCategory(catId);
    };
    menu.appendChild(editBtn);
    
    // Nút xóa
    var delBtn = document.createElement('button');
    delBtn.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:10px 16px;border:none;background:none;font-size:14px;color:#ef4444;cursor:pointer;text-align:left;';
    delBtn.innerHTML = '🗑️ Xóa danh mục';
    delBtn.onmouseover = function() { this.style.background = '#fef2f2'; };
    delBtn.onmouseout = function() { this.style.background = 'none'; };
    delBtn.onclick = function() {
        closeInvCategoryContextMenu();
        deleteCategory(catId);
    };
    menu.appendChild(delBtn);
    
    overlay.appendChild(menu);
    overlay.onclick = function(e) {
        if (e.target === overlay) closeInvCategoryContextMenu();
    };
    
    document.body.appendChild(overlay);
}

function closeInvCategoryContextMenu() {
    var el = document.getElementById('invCategoryContextMenu');
    if (el) el.remove();
}

// ========== RENDER DANH MỤC ==========
function renderInventoryCategoryFilter() {
    var filter = document.getElementById('invMenuFilter');
    var catSelect = document.getElementById('invMenuItemCategory');
    var catSelectModal = document.getElementById('invMenuItemCategoryModal');
    if (!filter && !catSelect && !catSelectModal) return;
    
    // FIX: Ưu tiên window.menuCategories (đã được load từ pos-app.js) trước
    var cats = window.menuCategories || menuCategories || [];
    
    // Nếu chưa có dữ liệu categories, load từ DB
    if (cats.length === 0 && typeof DB !== 'undefined' && DB.getAll) {
        DB.getAll('menu_categories').then(function(dbCats) {
            if (dbCats && dbCats.length > 0) {
                window.menuCategories = dbCats;
                menuCategories = dbCats;
            }
            renderInventoryCategoryFilter();
        }).catch(function() {});
        return;
    }
    
    // Sắp xếp theo thứ tự
    cats.sort(function(a, b) { return (a.order || 999) - (b.order || 999); });
    
    // Render buttons cho invMenuFilter
    var btnsHtml = '<button class="inv-filter-btn' + (_invFilterCategoryId === 'all' ? ' active' : '') + '" data-cat="all" onclick="setInvMenuFilter(\'all\')">📋 Tất cả</button>';
    for (var i = 0; i < cats.length; i++) {
        var c = cats[i];
        var name = escapeHtml(c.name || '');
        var activeClass = (_invFilterCategoryId === c.id) ? ' active' : '';
        btnsHtml += '<button class="inv-filter-btn' + activeClass + '" data-cat="' + c.id + '" data-cat-id="' + c.id + '" onclick="setInvMenuFilter(\'' + c.id + '\')" oncontextmenu="event.preventDefault();showInvCategoryContextMenu(\'' + c.id + '\', event)">' + name + '</button>';
    }
    if (filter) {
        filter.innerHTML = btnsHtml;
        // Gán long-press cho các nút danh mục (không phải nút "Tất cả")
        var btns = filter.querySelectorAll('.inv-filter-btn[data-cat-id]');
        for (var i = 0; i < btns.length; i++) {
            (function(btn) {
                var pressTimer = null;
                var catId = btn.getAttribute('data-cat-id');
                function onStart(e) {
                    if (pressTimer) clearTimeout(pressTimer);
                    pressTimer = setTimeout(function() {
                        pressTimer = null;
                        showInvCategoryContextMenu(catId, e);
                    }, 500);
                }
                function onEnd(e) {
                    if (pressTimer) {
                        clearTimeout(pressTimer);
                        pressTimer = null;
                    }
                }
                btn.addEventListener('touchstart', onStart, {passive: true});
                btn.addEventListener('touchend', onEnd);
                btn.addEventListener('touchmove', onEnd);
                btn.addEventListener('mousedown', onStart);
                btn.addEventListener('mouseup', onEnd);
                btn.addEventListener('mouseleave', onEnd);
            })(btns[i]);
        }
    }
    
    // Render select cho modal (giữ nguyên)
    var catOptionsHtml = '<option value="">-- Chọn danh mục --</option>';
    for (var j = 0; j < cats.length; j++) {
        var c2 = cats[j];
        var name2 = escapeHtml(c2.name || '');
        catOptionsHtml += '<option value="' + c2.id + '">' + name2 + '</option>';
    }
    if (catSelect) catSelect.innerHTML = catOptionsHtml;
    if (catSelectModal) catSelectModal.innerHTML = catOptionsHtml;
}

function renderInventoryCategories() {
    var container = document.getElementById('invCategoryList');
    if (!container) return;
    
    var cats = menuCategories || [];
    
    // Nếu chưa có dữ liệu categories, load từ DB
    if (cats.length === 0 && typeof DB !== 'undefined' && DB.getAll) {
        DB.getAll('menu_categories').then(function(dbCats) {
            if (dbCats && dbCats.length > 0) {
                window.menuCategories = dbCats;
            }
            renderInventoryCategories();
        }).catch(function() {
            container.innerHTML = '<div class="empty-text">Chưa có danh mục nào</div>';
        });
        return;
    }
    
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
// Biến đếm số lần retry cho renderInventoryMenu
var _invMenuRetryCount = 0;
var _invMenuRetryMax = 30; // 30 lần * 1s = 30s

function renderInventoryMenu() {
    var container = document.getElementById('invMenuItemList');
    if (!container) return;
    
    var filterCatId = _invFilterCategoryId || 'all';
    
    // FIX: Ưu tiên window.menuItems (đã được load từ pos-app.js) trước
    var items = window.menuItems || menuItems || [];
    var cats = window.menuCategories || menuCategories || [];
    
    // Nếu chưa có dữ liệu menu items, load từ DB
    if (items.length === 0 && typeof DB !== 'undefined' && DB.getAll) {
        // FIX: Chờ sync hoàn thành trước khi load từ DB
        if (typeof DB.whenSyncComplete === 'function') {
            DB.whenSyncComplete().then(function() {
                return DB.getAll('menu');
            }).then(function(dbItems) {
                if (dbItems && dbItems.length > 0) {
                    window.menuItems = dbItems;
                    menuItems = dbItems;
                }
                // Load categories nếu chưa có
                if (cats.length === 0) {
                    return DB.getAll('menu_categories').then(function(dbCats) {
                        if (dbCats && dbCats.length > 0) {
                            window.menuCategories = dbCats;
                            menuCategories = dbCats;
                        }
                        renderInventoryMenu();
                    });
                }
                renderInventoryMenu();
            }).catch(function() {
                container.innerHTML = '<div class="empty-text">Chưa có món ăn nào</div>';
            });
        } else {
            DB.getAll('menu').then(function(dbItems) {
                if (dbItems && dbItems.length > 0) {
                    window.menuItems = dbItems;
                    menuItems = dbItems;
                }
                if (cats.length === 0) {
                    return DB.getAll('menu_categories').then(function(dbCats) {
                        if (dbCats && dbCats.length > 0) {
                            window.menuCategories = dbCats;
                            menuCategories = dbCats;
                        }
                        renderInventoryMenu();
                    });
                }
                renderInventoryMenu();
            }).catch(function() {
                container.innerHTML = '<div class="empty-text">Chưa có món ăn nào</div>';
            });
        }
        return;
    }
    
    // Nếu chỉ thiếu categories
    if (cats.length === 0 && typeof DB !== 'undefined' && DB.getAll) {
        DB.getAll('menu_categories').then(function(dbCats) {
            if (dbCats && dbCats.length > 0) {
                window.menuCategories = dbCats;
                menuCategories = dbCats;
            }
            renderInventoryMenu();
        }).catch(function() {
            // Render tiếp với cats rỗng
            _doRenderInventoryMenu(items, cats, filterCatId, container);
        });
        return;
    }
    
    // FIX: Nếu items vẫn rỗng, thử retry (chờ sync hoàn thành)
    if (items.length === 0 && _invMenuRetryCount < _invMenuRetryMax) {
        _invMenuRetryCount++;
        console.log('⏳ renderInventoryMenu retry ' + _invMenuRetryCount + '/' + _invMenuRetryMax);
        setTimeout(renderInventoryMenu, 1000);
        return;
    }
    _invMenuRetryCount = 0;
    
    _doRenderInventoryMenu(items, cats, filterCatId, container);
}

function _doRenderInventoryMenu(items, cats, filterCatId, container) {
    if (filterCatId !== 'all') {
        items = items.filter(function(i) { return String(i.categoryId) === String(filterCatId); });
    }
    
    // Xây lookup category name
    var catMap = {};
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
    
    // Render form HTML vào modal body
    var modalBody = document.getElementById('addMenuItemModalBody');
    if (!modalBody) return;
    
    // Build category options
    var cats = menuCategories || [];
    cats.sort(function(a, b) { return (a.order || 999) - (b.order || 999); });
    var catOptionsHtml = '<option value="">-- Chọn danh mục --</option>';
    for (var i = 0; i < cats.length; i++) {
        catOptionsHtml += '<option value="' + cats[i].id + '">' + escapeHtml(cats[i].name || '') + '</option>';
    }
    
    var html = '';
    html += '<div class="inv-form" style="display:flex;flex-direction:column;gap:10px;">';
    
    // Tên món
    html += '<div class="inv-form-row">';
    html += '<label style="font-weight:600;font-size:13px;">Tên món <span style="color:red;">*</span></label>';
    html += '<input type="text" id="addModalItemName" class="form-input" placeholder="VD: Cà phê sữa đá">';
    html += '</div>';
    
    // Giá bán
    html += '<div class="inv-form-row">';
    html += '<label style="font-weight:600;font-size:13px;">Giá bán <span style="color:red;">*</span></label>';
    html += '<input type="number" id="addModalItemPrice" class="form-input" placeholder="VD: 35000" step="1000">';
    html += '</div>';
    
    // Danh mục
    html += '<div class="inv-form-row">';
    html += '<label style="font-weight:600;font-size:13px;">Danh mục</label>';
    html += '<select id="invMenuItemCategoryModal" class="form-input">' + catOptionsHtml + '</select>';
    html += '</div>';
    
    // Error
    html += '<div id="addModalItemError" style="color:#ef4444;font-size:12px;min-height:18px;"></div>';
    
    // === SIZE / VARIANT ===
    html += '<div style="border-top:1px solid var(--border);padding-top:8px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<span style="font-weight:600;font-size:13px;">📏 Size / Phiên bản</span>';
    html += '<button class="btn-small btn-outline" onclick="_addMenuItemSizeRow(\'\', \'\', [], \'\')" style="font-size:11px;">+ Thêm size</button>';
    html += '</div>';
    html += '<div id="addModalSizesContainer"></div>';
    html += '</div>';
    
    // === NGUYÊN LIỆU CHUNG ===
    html += '<div style="border-top:1px solid var(--border);padding-top:8px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
    html += '<span style="font-weight:600;font-size:13px;">🧂 Nguyên liệu chung (cho mọi size)</span>';
    html += '<button class="btn-small btn-outline" onclick="_addModalIngredient()" style="font-size:11px;">+ Thêm NL</button>';
    html += '</div>';
    html += '<div id="addModalIngredientsContainer"></div>';
    html += '</div>';
    
    // Nút hành động
    html += '<div style="display:flex;gap:8px;margin-top:8px;padding-top:12px;border-top:1px solid var(--border);">';
    html += '<button class="btn-save" onclick="handleSaveMenuItem()" style="flex:1;">💾 Lưu món</button>';
    html += '<button class="btn-cancel" onclick="closeModal(\'addMenuItemModal\')" style="flex:1;">Hủy</button>';
    html += '</div>';
    
    html += '</div>';
    modalBody.innerHTML = html;
    
    renderInventoryCategoryFilter();
    // Reset sizes & ingredients (DOM-based)
    _resetMenuItemSizes();
    _resetMenuItemIngredients();
    // Mở popup
    openBottomSheet('addMenuItemModal');
    // Focus sau khi modal mở
    setTimeout(function() {
        var nameInput = document.getElementById('addModalItemName');
        if (nameInput) nameInput.focus();
    }, 300);
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

// ========== MENU ITEM SIZES (DOM-BASED) ==========
function _resetMenuItemSizes() {
    var container = document.getElementById('addModalSizesContainer');
    if (!container) return;
    container.innerHTML = '';
    // Thêm 1 row mặc định
    _addMenuItemSizeRow('', '', [], '');
}

function _addMenuItemSizeRow(sizeName, sizePrice, sizeIngredients, sizeRecipe) {
    var container = document.getElementById('addModalSizesContainer');
    if (!container) return;
    
    var rowId = 'add_size_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    var row = document.createElement('div');
    row.className = 'inv-form-row add-menu-size-row';
    row.id = rowId;
    row.style.cssText = 'margin-top:4px;flex-direction:column;border:1px solid #e2e8f0;border-radius:6px;padding:8px;width:100%;box-sizing:border-box;';
    
    var headerHtml =
        '<div style="display:flex;gap:6px;align-items:center;width:100%;">' +
            '<input type="text" class="add-menu-size-name" placeholder="Tên size (VD: Nhỏ)" value="' + escapeHtml(sizeName || '') + '" style="flex:1;">' +
            '<input type="number" class="add-menu-size-price" placeholder="Giá" value="' + (sizePrice || '') + '" style="flex:0.8;" step="1000">' +
            '<button class="btn-small btn-danger" onclick="this.closest(\'.inv-form-row\').remove()" style="padding:4px 8px;">✕</button>' +
        '</div>';
    
    // Ô nhập công thức pha chế
    var recipeHtml = '<div style="margin-top:6px;width:100%;">';
    recipeHtml += '<label style="font-size:11px;color:#64748b;font-weight:600;display:block;margin-bottom:2px;">📋 Hướng dẫn pha chế</label>';
    recipeHtml += '<textarea class="add-menu-size-recipe" placeholder="VD: Nước sôi 85 độ, ủ 15 phút..." style="width:100%;min-height:50px;font-size:12px;padding:6px;border:1px solid #e2e8f0;border-radius:6px;resize:vertical;box-sizing:border-box;">' + escapeHtml(sizeRecipe || '') + '</textarea>';
    recipeHtml += '</div>';
    
    // Build ingredients section for this size
    var ingsHtml = '<div class="add-size-ingredients" style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;width:100%;">';
    ingsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
    ingsHtml += '<span style="font-size:11px;color:#64748b;font-weight:600;">🧂 Nguyên liệu cho size này</span>';
    ingsHtml += '<button class="btn-small btn-outline" onclick="document.getElementById(\'' + rowId + '\').querySelector(\'.add-size-ing-rows\').appendChild(_createAddSizeIngRow(\'\',\'\',\'\'))" style="font-size:10px;padding:2px 6px;">+ Thêm NL</button>';
    ingsHtml += '</div>';
    ingsHtml += '<div class="add-size-ing-rows">';
    
    // Add ingredient rows
    if (sizeIngredients && sizeIngredients.length) {
        for (var i = 0; i < sizeIngredients.length; i++) {
            var si = sizeIngredients[i];
            ingsHtml += _buildAddSizeIngRowHtml(si.ingredientId || '', si.quantity || '', si.unit || '');
        }
    } else {
        ingsHtml += _buildAddSizeIngRowHtml('', '', '');
    }
    
    ingsHtml += '</div></div>';
    
    row.innerHTML = headerHtml + recipeHtml + ingsHtml;
    container.appendChild(row);
    
    // Scroll xuống cuối
    setTimeout(function() {
        var modalBody = document.getElementById('addMenuItemModalBody');
        if (modalBody) {
            modalBody.scrollTop = modalBody.scrollHeight;
        }
    }, 50);
}

function _buildAddSizeIngRowHtml(ingId, qty, unit) {
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
        '<select class="add-menu-ing-select" style="flex:1.2;font-size:11px;padding:4px 6px;">' + optionsHtml + '</select>' +
        '<input type="number" class="add-menu-ing-qty" placeholder="SL" value="' + (qty || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;" step="0.1">' +
        '<input type="text" class="add-menu-ing-unit" placeholder="ĐV" value="' + escapeHtml(unit || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;">' +
        '<button class="btn-small btn-danger" onclick="this.parentElement.remove()" style="padding:2px 6px;font-size:10px;">✕</button>' +
    '</div>';
}

function _createAddSizeIngRow(ingId, qty, unit) {
    var div = document.createElement('div');
    div.innerHTML = _buildAddSizeIngRowHtml(ingId, qty, unit);
    return div.firstElementChild;
}

function _createSizeIngRow(ingId, qty, unit) {
    // Giữ để tương thích - chuyển sang DOM-based
    return _createAddSizeIngRow(ingId, qty, unit);
}

// ========== MENU ITEM GLOBAL INGREDIENTS (DOM-BASED) ==========
function _addModalIngredient() {
    _addMenuItemIngredientRow('', '', '');
}

function _resetMenuItemIngredients() {
    var container = document.getElementById('addModalIngredientsContainer');
    if (!container) return;
    container.innerHTML = '';
    // Thêm 1 row mặc định
    _addMenuItemIngredientRow('', '', '');
}

function _addMenuItemIngredientRow(ingId, qty, unit) {
    var container = document.getElementById('addModalIngredientsContainer');
    if (!container) return;
    
    var ings = ingredients || [];
    var optionsHtml = '<option value="">-- Chọn NL --</option>';
    for (var i = 0; i < ings.length; i++) {
        var ingData = ings[i];
        var selected = String(ingData.id) === String(ingId) ? ' selected' : '';
        var stock = parseFloat(ingData.stock) || 0;
        var unitLabel = ingData.unit || '';
        var convInfo = '';
        if (ingData.conversionFrom && ingData.conversionTo && ingData.conversionRate) {
            convInfo = ' (' + stock + unitLabel + ' → ~' + Math.round(stock * ingData.conversionRate) + ingData.conversionTo + ')';
        } else {
            convInfo = ' (' + stock + unitLabel + ')';
        }
        optionsHtml += '<option value="' + ingData.id + '"' + selected + ' data-unit="' + escapeHtml(unitLabel) + '">' + escapeHtml(ingData.name || '') + convInfo + '</option>';
    }
    
    var row = document.createElement('div');
    row.className = 'inv-form-row add-menu-global-ing-row';
    row.style.marginTop = '4px';
    row.innerHTML =
        '<select class="add-menu-ing-select" style="flex:1.2;" onchange="var u=this.options[this.selectedIndex];var ingUnit=u?u.getAttribute(\'data-unit\')||\'\':\'\';var unitInput=this.parentElement.querySelector(\'.add-menu-ing-unit\');if(unitInput&&!unitInput.value.trim())unitInput.value=ingUnit;">' + optionsHtml + '</select>' +
        '<input type="number" class="add-menu-ing-qty" placeholder="SL" value="' + (qty || '') + '" style="flex:0.5;" step="0.1">' +
        '<input type="text" class="add-menu-ing-unit" placeholder="ĐV" value="' + escapeHtml(unit || '') + '" style="flex:0.5;">' +
        '<button class="btn-small btn-danger" onclick="this.parentElement.remove()" style="padding:4px 8px;">✕</button>';
    container.appendChild(row);
    
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
    
    // Collect sizes from DOM using helper
    var sizes = _collectSizeRows(
        '#addModalSizesContainer',
        '.add-menu-size-name',
        '.add-menu-size-price',
        '.add-size-ing-rows .add-menu-ing-select',
        '.add-size-ing-rows .add-menu-ing-qty',
        '.add-size-ing-rows .add-menu-ing-unit',
        '.add-menu-size-recipe'
    );
    
    // Collect global ingredients from DOM using helper
    var ingredients_data = _collectSelectValues(
        '#addModalIngredientsContainer',
        '.add-menu-ing-select',
        '.add-menu-ing-qty',
        '.add-menu-ing-unit'
    );
    
    var hasVariants = sizes.length > 0;
    var data = {
        name: name,
        price: price,
        categoryId: categoryId,
        hasVariants: hasVariants,
        variants: hasVariants ? sizes : [],
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
        optionsHtml += '<option value="' + ing.id + '"' + selected + ' data-unit="' + escapeHtml(unitLabel) + '">' + escapeHtml(ing.name || '') + convInfo + '</option>';
    }
    
    var row = document.createElement('div');
    row.className = 'inv-form-row';
    row.style.marginTop = '4px';
    row.innerHTML =
        '<select class="edit-menu-ing-select" style="flex:1.2;" onchange="var u=this.options[this.selectedIndex];var ingUnit=u?u.getAttribute(\'data-unit\')||\'\':\'\';var unitInput=this.parentElement.querySelector(\'.edit-menu-ing-unit\');if(unitInput&&!unitInput.value.trim())unitInput.value=ingUnit;">' + optionsHtml + '</select>' +
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
    
    // Collect sizes with per-variant ingredients using helper
    var sizes = _collectSizeRows(
        '#editMenuItemSizesContainer',
        '.edit-menu-size-name',
        '.edit-menu-size-price',
        '.edit-size-ing-rows .edit-menu-ing-select',
        '.edit-size-ing-rows .edit-menu-ing-qty',
        '.edit-size-ing-rows .edit-menu-ing-unit',
        '.edit-menu-size-recipe'
    );
    console.log('🔍 handleEditMenuItemSave: sizes collected:', sizes.length);
    
    // Collect global ingredients (shared across all sizes) using helper
    var ingredients_data = _collectSelectValues(
        '#editMenuItemIngredientsContainer',
        '.edit-menu-ing-select',
        '.edit-menu-ing-qty',
        '.edit-menu-ing-unit'
    );
    
    var hasVariants = sizes.length > 0;
    var data = {
        name: name,
        price: price,
        categoryId: categoryId,
        hasVariants: hasVariants,
        variants: hasVariants ? sizes : [],
        ingredients: ingredients_data.length > 0 ? ingredients_data : []
    };
    
    console.log('🔍 handleEditMenuItemSave FINAL DATA:', JSON.stringify(data));
    
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
// Biến đếm số lần retry cho renderInventoryIngredients
var _invIngRetryCount = 0;
var _invIngRetryMax = 30; // 30 lần * 1s = 30s

// OPTIMIZE: Cache version để tránh render lại khi dữ liệu không đổi
var _invIngRenderVersion = 0;
var _invIngLastRenderData = null;

function renderInventoryIngredients() {
    var container = document.getElementById('invIngredientList');
    if (!container) return;
    
    // FIX: Ưu tiên window.ingredients (đã được load từ pos-app.js) trước
    var ings = window.ingredients || ingredients || [];
    
    // Nếu chưa có dữ liệu, load từ DB
    if (ings.length === 0) {
        if (typeof DB !== 'undefined' && DB.getAll) {
            // FIX: Chờ sync hoàn thành trước khi load từ DB
            var loadPromise;
            if (typeof DB.whenSyncComplete === 'function') {
                loadPromise = DB.whenSyncComplete().then(function() {
                    return DB.getAll('ingredients');
                });
            } else {
                loadPromise = DB.getAll('ingredients');
            }
            loadPromise.then(function(dbIngs) {
                if (dbIngs && dbIngs.length > 0) {
                    window.ingredients = dbIngs;
                    ingredients = dbIngs;
                    _invIngRetryCount = 0;
                    _invIngRenderVersion++; // Đánh dấu data đã thay đổi
                    renderInventoryIngredients();
                } else {
                    // FIX: Nếu DB vẫn rỗng, thử retry (chờ sync hoàn thành)
                    if (_invIngRetryCount < _invIngRetryMax) {
                        _invIngRetryCount++;
                        setTimeout(renderInventoryIngredients, 1000);
                    } else {
                        container.innerHTML = '<div class="empty-text">Chưa có nguyên liệu nào</div>';
                    }
                }
            }).catch(function() {
                // FIX: Nếu lỗi, thử retry
                if (_invIngRetryCount < _invIngRetryMax) {
                    _invIngRetryCount++;
                    setTimeout(renderInventoryIngredients, 1000);
                } else {
                    container.innerHTML = '<div class="empty-text">Chưa có nguyên liệu nào</div>';
                }
            });
            return;
        }
        // FIX: Nếu DB chưa sẵn sàng, thử retry
        if (_invIngRetryCount < _invIngRetryMax) {
            _invIngRetryCount++;
            setTimeout(renderInventoryIngredients, 1000);
            return;
        }
        container.innerHTML = '<div class="empty-text">Chưa có nguyên liệu nào</div>';
        return;
    }
    
    _invIngRetryCount = 0;
    
    // OPTIMIZE: Cache check - nếu data không đổi thì không render lại
    var currentDataHash = ings.map(function(i){ return i.id + ':' + (i.stock||'') + ':' + (i.name||''); }).join('|');
    if (currentDataHash === _invIngLastRenderData) {
        return; // Data không đổi, bỏ qua render
    }
    _invIngLastRenderData = currentDataHash;
    
    var html = '';
    for (var i = 0; i < ings.length; i++) {
        var ing = ings[i];
        // Bỏ qua nguyên liệu đã bị xóa (deleted)
        if (ing.deleted) continue;
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
    // Nếu tất cả đều bị xóa, hiển thị thông báo
    if (!html) {
        container.innerHTML = '<div class="empty-text">Chưa có nguyên liệu nào</div>';
        return;
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
    console.log('🔍 handleSaveIngredient START', { _editingIngredientId: _editingIngredientId, _savingIngredient: _savingIngredient });
    // FIX: Chống double-submit
    if (_savingIngredient) return;
    
    var nameInput = document.getElementById('addModalIngredientName');
    var unitInput = document.getElementById('addModalIngredientUnit');
    var stockInput = document.getElementById('addModalIngredientStock');
    var minStockInput = document.getElementById('addModalIngredientMinStock');
    var errorEl = document.getElementById('addModalIngredientError');
    
    console.log('🔍 handleSaveIngredient DOM:', { nameInput: !!nameInput, unitInput: !!unitInput, stockInput: !!stockInput, minStockInput: !!minStockInput, errorEl: !!errorEl });
    
    if (!nameInput) { console.log('🔍 handleSaveIngredient: nameInput not found!'); return; }
    var name = nameInput.value.trim();
    var unit = unitInput ? unitInput.value.trim() : '';
    var stock = parseFloat(stockInput ? stockInput.value : '') || 0;
    var minStock = parseFloat(minStockInput ? minStockInput.value : '') || 0;
    
    console.log('🔍 handleSaveIngredient values:', { name: name, unit: unit, stock: stock, minStock: minStock });
    
    if (!name) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập tên nguyên liệu';
        return;
    }
    if (errorEl) errorEl.innerText = '';
    
    // FIX: Kiểm tra trùng tên nguyên liệu (chỉ khi thêm mới hoặc đổi tên)
    // So sánh không phân biệt hoa/thường, trim khoảng trắng, bỏ qua deleted
    var ings = ingredients || [];
    var nameLower = name.toLowerCase().trim();
    console.log('🔍 handleSaveIngredient check duplicate:', { name: name, nameLower: nameLower, ingsCount: ings.length, ings: ings.map(function(i){return i.name+'('+i.id+')';}) });
    for (var ii = 0; ii < ings.length; ii++) {
        if (ings[ii].deleted) continue; // Bỏ qua nguyên liệu đã xóa
        var existingName = (ings[ii].name || '').toLowerCase().trim();
        if (existingName === nameLower && ings[ii].id !== _editingIngredientId) {
            console.log('🔍 handleSaveIngredient DUPLICATE FOUND:', { existingName: ings[ii].name, existingId: ings[ii].id });
            if (errorEl) errorEl.innerText = 'Tên nguyên liệu "' + name + '" đã tồn tại!';
            showToast('Tên nguyên liệu "' + name + '" đã tồn tại!', 'error');
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
            console.log('🔍 handleSaveIngredient DB.create success:', { newIng: newIng, windowIngredientsLen: (window.ingredients||[]).length, ingredientsLen: (ingredients||[]).length });
            showToast('Đã thêm nguyên liệu', 'success');
            hideAddIngredientForm();
            _savingIngredient = false;
            // FIX: Push newIng vào ingredients vì subscribeToCollection('ingredients')
            // không có callback nên _notifyLocal() không cập nhật window.ingredients
            if (newIng) {
                var ings = window.ingredients || ingredients || [];
                console.log('🔍 handleSaveIngredient before push:', { ingsLen: ings.length, sameAsWindow: ings === window.ingredients, sameAsIngredients: ings === ingredients });
                ings.push(newIng);
                window.ingredients = ings;
                ingredients = ings;
                console.log('🔍 handleSaveIngredient after push:', { windowIngredientsLen: (window.ingredients||[]).length, ingredientsLen: (ingredients||[]).length });
            }
            console.log('🔍 handleSaveIngredient calling renderInventoryIngredients');
            renderInventoryIngredients();
            _invalidateLookups();
        }).catch(function(err) {
            console.log('🔍 handleSaveIngredient DB.create ERROR:', err);
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
    // So sánh không phân biệt hoa/thường, trim khoảng trắng, bỏ qua deleted
    var ings = ingredients || [];
    var nameLower = name.toLowerCase().trim();
    for (var ii = 0; ii < ings.length; ii++) {
        if (ings[ii].deleted) continue;
        var existingName = (ings[ii].name || '').toLowerCase().trim();
        if (existingName === nameLower && ings[ii].id !== _editingIngredientId) {
            if (errorEl) errorEl.innerText = 'Tên nguyên liệu "' + name + '" đã tồn tại!';
            showToast('Tên nguyên liệu "' + name + '" đã tồn tại!', 'error');
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
    var convFrom = ing.conversionFrom || '';
    var convTo = ing.conversionTo || '';
    var hasConv = convRate > 0 && convFrom && convTo;
    // For usage tab display
    var displayUnit = baseUnit;

    // Helper: format quantity with both base and converted units
    // qty luôn ở đơn vị tồn kho (baseUnit)
    function _fmtQty(qty, showConv) {
        var s = Math.round(qty * 100) / 100 + ' ' + baseUnit;
        if (showConv && hasConv) {
            // Quy đổi từ đơn vị tồn kho sang đơn vị nhỏ (convTo)
            // VD: 0.105 hộp * 200 = 21 điếu
            var convQty = Math.round(qty * convRate * 100) / 100;
            s += ' (~' + convQty + ' ' + convTo + ')';
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
                var recipeUnit = '';
                for (var k = 0; k < menuItems.length; k++) {
                    if (menuItems[k].id === orderItem.id || menuItems[k].name === baseName) {
                        if (menuItems[k].ingredients) {
                            for (var l = 0; l < menuItems[k].ingredients.length; l++) {
                                if (String(menuItems[k].ingredients[l].ingredientId) === String(ingId)) {
                                    recipeQty = menuItems[k].ingredients[l].quantity || 0;
                                    recipeUnit = menuItems[k].ingredients[l].unit || '';
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
                                        recipeUnit = vIngs[l].unit || '';
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
                // FIX: Dùng _getConvertedQuantity để tính số lượng thực tế cần trừ
                // Dựa trên recipeUnit (đơn vị gán cho món) và ingredient (có conversionFrom/To)
                var baseQty = _getConvertedQuantity(ing, qtyUsed, recipeUnit);
                result.push({
                    type: 'export',
                    quantity: baseQty,
                    unit: baseUnit,
                    note: 'Bán: ' + orderItem.name + ' x' + orderItem.qty + ' (' + Math.round(qtyUsed * 100) / 100 + ' ' + (recipeUnit || displayUnit) + ')',
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
                var recipeUnit = '';
                for (var k = 0; k < menuItems.length; k++) {
                    if (menuItems[k].id === orderItem.id || menuItems[k].name === baseName) {
                        // Check global ingredients
                        if (menuItems[k].ingredients) {
                            for (var l = 0; l < menuItems[k].ingredients.length; l++) {
                                if (String(menuItems[k].ingredients[l].ingredientId) === String(ingId)) {
                                    recipeQty = menuItems[k].ingredients[l].quantity || 0;
                                    recipeUnit = menuItems[k].ingredients[l].unit || '';
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
                                        recipeUnit = vIngs[l].unit || '';
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
                // FIX: Dùng _getConvertedQuantity để tính số lượng thực tế
                var baseQty = _getConvertedQuantity(ing, qtyUsed, recipeUnit);
                totalUsed += baseQty;
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
                usageByDate[dateKey].items[itemKey].qty += baseQty;
                usageByDate[dateKey].items[itemKey].count += orderItem.qty;
                usageByDate[dateKey].totalQty += baseQty;
                usageByDate[dateKey].orderCount += orderItem.qty;
            }
        }

        var summaryHtml =
            '<div class="usage-stat" style="cursor:pointer;" onclick="switchIngUsageTab(\'menuitems\')" title="Xem danh sách món chứa nguyên liệu">' +
                '<span class="usage-stat-label">📦 Món có chứa nguyên liệu:</span>' +
                '<span class="usage-stat-value" style="color:#f97316;">' + relatedCount + ' món →</span>' +
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

// ========== RELATED MENU ITEMS (TAB "MÓN CHỨA NL") ==========
var _ingRelatedMenuFilter = '';

function _renderRelatedMenuItems(ingId) {
    if (!ingId) return;
    var listEl = document.getElementById('ingRelatedMenuList');
    if (!listEl) return;
    
    var items = window.menuItems || [];
    var relatedIds = {};
    var relatedData = {};
    
    // Find all menu items that use this ingredient
    for (var i = 0; i < items.length; i++) {
        var mi = items[i];
        var found = false;
        // Check global ingredients
        if (mi.ingredients && mi.ingredients.length > 0) {
            for (var j = 0; j < mi.ingredients.length; j++) {
                if (String(mi.ingredients[j].ingredientId) === String(ingId)) {
                    found = true;
                    break;
                }
            }
        }
        // Check per-variant ingredients
        if (!found) {
            var variantData = (mi.variants && mi.variants.length > 0) ? mi.variants : (mi.sizes || []);
            for (var vi = 0; vi < variantData.length; vi++) {
                var vIngs = variantData[vi].ingredients || [];
                for (var j = 0; j < vIngs.length; j++) {
                    if (String(vIngs[j].ingredientId) === String(ingId)) {
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
        }
        if (found) {
            relatedIds[mi.id] = true;
            relatedData[mi.id] = mi;
        }
    }
    
    var relatedIdsArr = Object.keys(relatedIds);
    
    // Apply search filter
    var keyword = _ingRelatedMenuFilter;
    if (keyword) {
        var filtered = [];
        for (var i = 0; i < relatedIdsArr.length; i++) {
            var mi = relatedData[relatedIdsArr[i]];
            if (mi && _removeAccents(mi.name || '').toLowerCase().indexOf(_removeAccents(keyword).toLowerCase()) !== -1) {
                filtered.push(relatedIdsArr[i]);
            }
        }
        relatedIdsArr = filtered;
    }
    
    if (relatedIdsArr.length === 0) {
        if (keyword) {
            listEl.innerHTML = '<div class="ing-usage-empty">🔍 Không tìm thấy món phù hợp</div>';
        } else {
            listEl.innerHTML = '<div class="ing-usage-empty">📭 Chưa có món nào chứa nguyên liệu này</div>';
        }
        return;
    }
    
    var html = '';
    for (var i = 0; i < relatedIdsArr.length; i++) {
        var mi = relatedData[relatedIdsArr[i]];
        if (!mi) continue;
        
        // Count how many ingredients this menu item has
        var ingCount = (mi.ingredients ? mi.ingredients.length : 0);
        var variantData = (mi.variants && mi.variants.length > 0) ? mi.variants : (mi.sizes || []);
        for (var vi = 0; vi < variantData.length; vi++) {
            ingCount += (variantData[vi].ingredients ? variantData[vi].ingredients.length : 0);
        }
        
        html += '<div class="ing-related-menu-item" onclick="_showEditMenuItemIngredients(\'' + mi.id + '\', \'' + ingId + '\')">' +
            '<span class="ing-related-menu-name" style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(mi.name || '') + '</span>' +
            '<span class="ing-related-menu-price">' + formatMoney(mi.price || 0) + '</span>' +
            '<span class="ing-related-menu-ingcount">' + ingCount + ' NL</span>' +
            '<button class="btn-small btn-outline" onclick="event.stopPropagation();_showEditMenuItemIngredients(\'' + mi.id + '\', \'' + ingId + '\')" style="font-size:10px;padding:2px 6px;flex-shrink:0;">✏️ Sửa</button>' +
        '</div>';
    }
    listEl.innerHTML = html;
}

function filterIngRelatedMenu(keyword) {
    _ingRelatedMenuFilter = keyword;
    if (window._currentIngId) {
        _renderRelatedMenuItems(window._currentIngId);
    }
}

// ========== SỬA NGUYÊN LIỆU TRỰC TIẾP TRONG MÓN (TỪ MODAL NGUYÊN LIỆU) ==========
function _showEditMenuItemIngredients(menuItemId, ingId) {
    if (!menuItemId) return;
    
    // Find the menu item
    var items = window.menuItems || [];
    var item = null;
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === menuItemId) { item = items[i]; break; }
    }
    if (!item) return;
    
    // Close ingredient modal and open edit menu item modal
    closeModal('ingredientUsageModal');
    
    // Use the existing editMenuItem function but highlight the ingredient
    editMenuItem(menuItemId);
    
    // Store the ingredient ID to highlight after modal opens
    window._highlightIngId = ingId;
    
    // After a short delay, scroll to and highlight the ingredient row
    setTimeout(function() {
        if (ingId) {
            var selects = document.querySelectorAll('#editMenuItemIngredientsContainer .edit-menu-ing-select, #editMenuItemSizesContainer .edit-menu-ing-select');
            for (var i = 0; i < selects.length; i++) {
                if (String(selects[i].value) === String(ingId)) {
                    var row = selects[i].closest('[style*="display: flex"]') || selects[i].parentElement;
                    if (row) {
                        row.style.background = '#fef3c7';
                        row.style.borderRadius = '4px';
                        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }
                    break;
                }
            }
        }
        window._highlightIngId = null;
    }, 500);
}

// ========== GÁN NGUYÊN LIỆU CHO MÓN ==========
var _assignIngTargetId = null;
var _assignIngFilter = '';

function _showAssignIngredientToMenu() {
    var ingId = window._currentIngId;
    if (!ingId) return;
    
    _assignIngTargetId = null;
    _assignIngFilter = '';
    
    var titleEl = document.getElementById('assignIngredientModalTitle');
    var ings = window.ingredients || [];
    var ingName = '';
    for (var i = 0; i < ings.length; i++) {
        if (ings[i].id === ingId) { ingName = ings[i].name; break; }
    }
    if (titleEl) titleEl.innerText = '📌 Gán "' + (ingName || 'NL') + '" cho món';
    
    // Reset UI
    var searchInput = document.getElementById('assignIngMenuSearch');
    if (searchInput) searchInput.value = '';
    
    var sizeSection = document.getElementById('assignIngSizeSection');
    if (sizeSection) sizeSection.style.display = 'none';
    
    var sizeContainer = document.getElementById('assignIngSizeContainer');
    if (sizeContainer) sizeContainer.innerHTML = '';
    
    var globalContainer = document.getElementById('assignIngGlobalIngContainer');
    if (globalContainer) globalContainer.innerHTML = '';
    
    var errorEl = document.getElementById('assignIngError');
    if (errorEl) errorEl.innerText = '';
    
    // Render menu list
    _renderAssignIngMenuList();
    
    openBottomSheet('assignIngredientModal');
}

function _renderAssignIngMenuList() {
    var listEl = document.getElementById('assignIngMenuList');
    if (!listEl) return;
    
    var items = window.menuItems || [];
    var keyword = _assignIngFilter;
    
    var filtered = [];
    for (var i = 0; i < items.length; i++) {
        var mi = items[i];
        if (keyword) {
            var name = _removeAccents(mi.name || '').toLowerCase();
            var kw = _removeAccents(keyword).toLowerCase();
            if (name.indexOf(kw) === -1) continue;
        }
        filtered.push(mi);
    }
    
    if (filtered.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:12px;color:#94a3b8;font-size:13px;">🔍 Không tìm thấy món</div>';
        return;
    }
    
    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var mi = filtered[i];
        var selected = String(_assignIngTargetId) === String(mi.id) ? ' style="background:#fef3c7;border-color:#f59e0b;"' : '';
        html += '<div class="assign-ing-menu-item"' + selected + ' onclick="_selectAssignIngMenuItem(\'' + mi.id + '\')">' +
            '<span>' + escapeHtml(mi.name || '') + '</span>' +
            '<span style="font-size:11px;color:#64748b;">' + formatMoney(mi.price || 0) + '</span>' +
        '</div>';
    }
    listEl.innerHTML = html;
}

function filterAssignIngMenu(keyword) {
    _assignIngFilter = keyword;
    _renderAssignIngMenuList();
}

function _selectAssignIngMenuItem(menuItemId) {
    _assignIngTargetId = menuItemId;
    _renderAssignIngMenuList();
    
    // Show size section
    var sizeSection = document.getElementById('assignIngSizeSection');
    if (sizeSection) sizeSection.style.display = 'block';
    
    // Find the menu item to pre-populate
    var items = window.menuItems || [];
    var item = null;
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === menuItemId) { item = items[i]; break; }
    }
    
    var sizeContainer = document.getElementById('assignIngSizeContainer');
    var globalContainer = document.getElementById('assignIngGlobalIngContainer');
    if (sizeContainer) sizeContainer.innerHTML = '';
    if (globalContainer) globalContainer.innerHTML = '';
    
    if (item) {
        // Pre-populate existing sizes
        var variantData = (item.variants && item.variants.length > 0) ? item.variants : (item.sizes || []);
        if (variantData.length > 0) {
            for (var vi = 0; vi < variantData.length; vi++) {
                _addAssignIngSizeRow(variantData[vi].name || '', variantData[vi].price || '', variantData[vi].ingredients || []);
            }
        } else {
            _addAssignIngSizeRow('', '', []);
        }
        
        // Pre-populate global ingredients
        if (item.ingredients && item.ingredients.length > 0) {
            for (var i = 0; i < item.ingredients.length; i++) {
                _addAssignIngGlobalIngRow(item.ingredients[i].ingredientId || '', item.ingredients[i].quantity || '', item.ingredients[i].unit || '');
            }
        } else {
            _addAssignIngGlobalIngRow('', '', '');
        }
    } else {
        _addAssignIngSizeRow('', '', []);
        _addAssignIngGlobalIngRow('', '', '');
    }
}

function _addAssignIngSizeRow(sizeName, sizePrice, sizeIngredients) {
    var container = document.getElementById('assignIngSizeContainer');
    if (!container) return;
    var rowId = 'assign_size_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    var row = document.createElement('div');
    row.className = 'inv-form-row';
    row.id = rowId;
    row.style.cssText = 'margin-top:4px;flex-direction:column;border:1px solid #e2e8f0;border-radius:6px;padding:8px;';
    
    var headerHtml =
        '<div style="display:flex;gap:6px;align-items:center;width:100%;">' +
            '<input type="text" class="assign-ing-size-name" placeholder="Tên size (VD: Nhỏ)" value="' + escapeHtml(sizeName || '') + '" style="flex:1;">' +
            '<input type="number" class="assign-ing-size-price" placeholder="Giá" value="' + (sizePrice || '') + '" style="flex:0.8;" step="1000">' +
            '<button class="btn-small btn-danger" onclick="this.closest(\'.inv-form-row\').remove()" style="padding:4px 8px;">✕</button>' +
        '</div>';
    
    var ingsHtml = '<div class="assign-size-ingredients" style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;width:100%;">';
    ingsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
    ingsHtml += '<span style="font-size:11px;color:#64748b;font-weight:600;">🧂 Nguyên liệu cho size này</span>';
    ingsHtml += '<button class="btn-small btn-outline" onclick="document.getElementById(\'' + rowId + '\').querySelector(\'.assign-size-ing-rows\').appendChild(_createAssignSizeIngRow(\'\',\'\',\'\'))" style="font-size:10px;padding:2px 6px;">+ Thêm NL</button>';
    ingsHtml += '</div>';
    ingsHtml += '<div class="assign-size-ing-rows">';
    
    if (sizeIngredients && sizeIngredients.length) {
        for (var i = 0; i < sizeIngredients.length; i++) {
            var si = sizeIngredients[i];
            ingsHtml += _buildAssignSizeIngRowHtml(si.ingredientId || '', si.quantity || '', si.unit || '');
        }
    } else {
        ingsHtml += _buildAssignSizeIngRowHtml('', '', '');
    }
    
    ingsHtml += '</div></div>';
    
    row.innerHTML = headerHtml + ingsHtml;
    container.appendChild(row);
}

function _buildAssignSizeIngRowHtml(ingId, qty, unit) {
    var ings = window.ingredients || [];
    var optionsHtml = '<option value="">-- Chọn NL --</option>';
    for (var i = 0; i < ings.length; i++) {
        var ing = ings[i];
        var selected = String(ing.id) === String(ingId) ? ' selected' : '';
        var stock = parseFloat(ing.stock) || 0;
        var unitLabel = ing.unit || '';
        optionsHtml += '<option value="' + ing.id + '"' + selected + '>' + escapeHtml(ing.name || '') + ' (' + Math.round(stock * 10) / 10 + unitLabel + ')</option>';
    }
    return '<div style="display:flex;gap:4px;margin-top:4px;align-items:center;">' +
        '<select class="assign-ing-ing-select" style="flex:1.2;font-size:11px;padding:4px 6px;">' + optionsHtml + '</select>' +
        '<input type="number" class="assign-ing-ing-qty" placeholder="SL" value="' + (qty || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;" step="0.1">' +
        '<input type="text" class="assign-ing-ing-unit" placeholder="ĐV" value="' + escapeHtml(unit || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;">' +
        '<button class="btn-small btn-danger" onclick="this.parentElement.remove()" style="padding:2px 6px;font-size:10px;">✕</button>' +
    '</div>';
}

function _createAssignSizeIngRow(ingId, qty, unit) {
    var div = document.createElement('div');
    div.innerHTML = _buildAssignSizeIngRowHtml(ingId, qty, unit);
    return div.firstElementChild;
}

function _addAssignIngGlobalIngRow(ingId, qty, unit) {
    var container = document.getElementById('assignIngGlobalIngContainer');
    if (!container) return;
    var row = document.createElement('div');
    row.innerHTML = _buildAssignSizeIngRowHtml(ingId, qty, unit);
    container.appendChild(row.firstElementChild);
}

function _handleAssignIngredientSave() {
    var ingId = window._currentIngId;
    var menuItemId = _assignIngTargetId;
    var errorEl = document.getElementById('assignIngError');
    
    if (!ingId) { if (errorEl) errorEl.innerText = 'Lỗi: không tìm thấy nguyên liệu'; return; }
    if (!menuItemId) { if (errorEl) errorEl.innerText = 'Vui lòng chọn món'; return; }
    if (errorEl) errorEl.innerText = '';
    
    // Find the menu item
    var items = window.menuItems || [];
    var item = null;
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === menuItemId) { item = items[i]; break; }
    }
    if (!item) { if (errorEl) errorEl.innerText = 'Lỗi: không tìm thấy món'; return; }
    
    // Get ingredient info
    var ings = window.ingredients || [];
    var ingName = '';
    for (var i = 0; i < ings.length; i++) {
        if (ings[i].id === ingId) { ingName = ings[i].name; break; }
    }
    
    // Collect sizes
    var sizes = [];
    var sizeRows = document.querySelectorAll('#assignIngSizeContainer .inv-form-row');
    for (var i = 0; i < sizeRows.length; i++) {
        var row = sizeRows[i];
        var sNameInput = row.querySelector('.assign-ing-size-name');
        var sPriceInput = row.querySelector('.assign-ing-size-price');
        if (!sNameInput) continue;
        var sName = sNameInput.value.trim();
        var sPrice = parseInt(sPriceInput ? sPriceInput.value : 0) || 0;
        if (!sName) continue;
        
        var sizeIngs = [];
        var ingSelects = row.querySelectorAll('.assign-size-ing-rows .assign-ing-ing-select');
        var ingQtys = row.querySelectorAll('.assign-size-ing-rows .assign-ing-ing-qty');
        var ingUnits = row.querySelectorAll('.assign-size-ing-rows .assign-ing-ing-unit');
        for (var si = 0; si < ingSelects.length; si++) {
            var sid = ingSelects[si].value;
            var sqty = parseFloat(ingQtys[si].value) || 0;
            var sunit = ingUnits[si].value.trim();
            if (sid && sqty > 0) {
                var sIngName = '';
                for (var j = 0; j < ings.length; j++) {
                    if (String(ings[j].id) === String(sid)) { sIngName = ings[j].name; break; }
                }
                sizeIngs.push({ ingredientId: sid, ingredientName: sIngName, quantity: sqty, unit: sunit });
            }
        }
        
        sizes.push({ name: sName, price: sPrice, ingredients: sizeIngs.length > 0 ? sizeIngs : [], recipe: '' });
    }
    
    // Collect global ingredients
    var globalIngs = [];
    var gSelects = document.querySelectorAll('#assignIngGlobalIngContainer .assign-ing-ing-select');
    var gQtys = document.querySelectorAll('#assignIngGlobalIngContainer .assign-ing-ing-qty');
    var gUnits = document.querySelectorAll('#assignIngGlobalIngContainer .assign-ing-ing-unit');
    for (var i = 0; i < gSelects.length; i++) {
        var gid = gSelects[i].value;
        var gqty = parseFloat(gQtys[i].value) || 0;
        var gunit = gUnits[i].value.trim();
        if (gid && gqty > 0) {
            var gIngName = '';
            for (var j = 0; j < ings.length; j++) {
                if (String(ings[j].id) === String(gid)) { gIngName = ings[j].name; break; }
            }
            globalIngs.push({ ingredientId: gid, ingredientName: gIngName, quantity: gqty, unit: gunit });
        }
    }
    
    var hasVariants = sizes.length > 0;
    var data = {
        name: item.name,
        price: item.price,
        categoryId: item.categoryId,
        hasVariants: hasVariants,
        variants: hasVariants ? sizes : [],
        sizes: hasVariants ? sizes : [],
        ingredients: globalIngs.length > 0 ? globalIngs : []
    };
    
    // Save
    DB.update('menu', menuItemId, data).then(function() {
        showToast('Đã gán nguyên liệu cho món "' + (item.name || '') + '"', 'success');
        closeModal('assignIngredientModal');
        return DB.getAll('menu');
    }).then(function(items) {
        window.menuItems = items;
        renderInventoryMenu();
        _invalidateLookups();
        // Re-render related menu items if modal is open
        if (window._currentIngId) {
            _renderRelatedMenuItems(window._currentIngId);
        }
    }).catch(function(err) {
        if (errorEl) errorEl.innerText = err.message || 'Lỗi lưu';
    });
}

// ========== TẠO MÓN MỚI TỪ NGUYÊN LIỆU ==========
function _showCreateMenuItemFromIng() {
    var ingId = window._currentIngId;
    if (!ingId) return;
    
    var titleEl = document.getElementById('createMenuItemFromIngTitle');
    var ings = window.ingredients || [];
    var ingName = '';
    for (var i = 0; i < ings.length; i++) {
        if (ings[i].id === ingId) { ingName = ings[i].name; break; }
    }
    if (titleEl) titleEl.innerText = '➕ Tạo món mới từ "' + (ingName || 'NL') + '"';
    
    // Reset form
    var nameInput = document.getElementById('createIngMenuItemName');
    var priceInput = document.getElementById('createIngMenuItemPrice');
    var catSelect = document.getElementById('createIngMenuItemCategory');
    var errorEl = document.getElementById('createIngMenuItemError');
    if (nameInput) nameInput.value = '';
    if (priceInput) priceInput.value = '';
    if (errorEl) errorEl.innerText = '';
    
    // Populate category select
    var cats = window.menuCategories || [];
    cats.sort(function(a, b) { return (a.order || 999) - (b.order || 999); });
    var catOptionsHtml = '<option value="">-- Chọn danh mục --</option>';
    for (var i = 0; i < cats.length; i++) {
        catOptionsHtml += '<option value="' + cats[i].id + '">' + escapeHtml(cats[i].name || '') + '</option>';
    }
    if (catSelect) catSelect.innerHTML = catOptionsHtml;
    
    // Reset sizes and ingredients
    var sizesContainer = document.getElementById('createIngSizesContainer');
    if (sizesContainer) sizesContainer.innerHTML = '';
    _addCreateIngSizeRow('', '', []);
    
    var globalContainer = document.getElementById('createIngGlobalIngContainer');
    if (globalContainer) globalContainer.innerHTML = '';
    // Pre-add the current ingredient
    _addCreateIngGlobalIngRow(ingId, '', '');
    
    closeModal('ingredientUsageModal');
    openBottomSheet('createMenuItemFromIngModal');
}

function _addCreateIngSizeRow(sizeName, sizePrice, sizeIngredients) {
    var container = document.getElementById('createIngSizesContainer');
    if (!container) return;
    var rowId = 'create_size_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    var row = document.createElement('div');
    row.className = 'inv-form-row';
    row.id = rowId;
    row.style.cssText = 'margin-top:4px;flex-direction:column;border:1px solid #e2e8f0;border-radius:6px;padding:8px;';
    
    var headerHtml =
        '<div style="display:flex;gap:6px;align-items:center;width:100%;">' +
            '<input type="text" class="create-ing-size-name" placeholder="Tên size (VD: Nhỏ)" value="' + escapeHtml(sizeName || '') + '" style="flex:1;">' +
            '<input type="number" class="create-ing-size-price" placeholder="Giá" value="' + (sizePrice || '') + '" style="flex:0.8;" step="1000">' +
            '<button class="btn-small btn-danger" onclick="this.closest(\'.inv-form-row\').remove()" style="padding:4px 8px;">✕</button>' +
        '</div>';
    
    var ingsHtml = '<div class="create-size-ingredients" style="margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;width:100%;">';
    ingsHtml += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">';
    ingsHtml += '<span style="font-size:11px;color:#64748b;font-weight:600;">🧂 Nguyên liệu cho size này</span>';
    ingsHtml += '<button class="btn-small btn-outline" onclick="document.getElementById(\'' + rowId + '\').querySelector(\'.create-size-ing-rows\').appendChild(_createCreateSizeIngRow(\'\',\'\',\'\'))" style="font-size:10px;padding:2px 6px;">+ Thêm NL</button>';
    ingsHtml += '</div>';
    ingsHtml += '<div class="create-size-ing-rows">';
    
    if (sizeIngredients && sizeIngredients.length) {
        for (var i = 0; i < sizeIngredients.length; i++) {
            var si = sizeIngredients[i];
            ingsHtml += _buildCreateSizeIngRowHtml(si.ingredientId || '', si.quantity || '', si.unit || '');
        }
    } else {
        ingsHtml += _buildCreateSizeIngRowHtml('', '', '');
    }
    
    ingsHtml += '</div></div>';
    
    row.innerHTML = headerHtml + ingsHtml;
    container.appendChild(row);
}

function _buildCreateSizeIngRowHtml(ingId, qty, unit) {
    var ings = window.ingredients || [];
    var optionsHtml = '<option value="">-- Chọn NL --</option>';
    for (var i = 0; i < ings.length; i++) {
        var ing = ings[i];
        var selected = String(ing.id) === String(ingId) ? ' selected' : '';
        var stock = parseFloat(ing.stock) || 0;
        var unitLabel = ing.unit || '';
        optionsHtml += '<option value="' + ing.id + '"' + selected + '>' + escapeHtml(ing.name || '') + ' (' + Math.round(stock * 10) / 10 + unitLabel + ')</option>';
    }
    return '<div style="display:flex;gap:4px;margin-top:4px;align-items:center;">' +
        '<select class="create-ing-ing-select" style="flex:1.2;font-size:11px;padding:4px 6px;">' + optionsHtml + '</select>' +
        '<input type="number" class="create-ing-ing-qty" placeholder="SL" value="' + (qty || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;" step="0.1">' +
        '<input type="text" class="create-ing-ing-unit" placeholder="ĐV" value="' + escapeHtml(unit || '') + '" style="flex:0.5;font-size:11px;padding:4px 6px;">' +
        '<button class="btn-small btn-danger" onclick="this.parentElement.remove()" style="padding:2px 6px;font-size:10px;">✕</button>' +
    '</div>';
}

function _createCreateSizeIngRow(ingId, qty, unit) {
    var div = document.createElement('div');
    div.innerHTML = _buildCreateSizeIngRowHtml(ingId, qty, unit);
    return div.firstElementChild;
}

function _addCreateIngGlobalIngRow(ingId, qty, unit) {
    var container = document.getElementById('createIngGlobalIngContainer');
    if (!container) return;
    var row = document.createElement('div');
    row.innerHTML = _buildCreateSizeIngRowHtml(ingId, qty, unit);
    container.appendChild(row.firstElementChild);
}

function _handleCreateMenuItemFromIng() {
    var nameInput = document.getElementById('createIngMenuItemName');
    var priceInput = document.getElementById('createIngMenuItemPrice');
    var catSelect = document.getElementById('createIngMenuItemCategory');
    var errorEl = document.getElementById('createIngMenuItemError');
    
    var name = nameInput ? nameInput.value.trim() : '';
    var price = parseInt(priceInput ? priceInput.value : 0) || 0;
    var categoryId = catSelect ? catSelect.value : '';
    
    if (!name) { if (errorEl) errorEl.innerText = 'Vui lòng nhập tên món'; return; }
    if (price <= 0) { if (errorEl) errorEl.innerText = 'Vui lòng nhập giá bán'; return; }
    if (errorEl) errorEl.innerText = '';
    
    // Check duplicate name
    var items = window.menuItems || [];
    for (var mi = 0; mi < items.length; mi++) {
        if (items[mi].name === name) {
            if (errorEl) errorEl.innerText = 'Tên món "' + name + '" đã tồn tại!';
            return;
        }
    }
    
    // Collect sizes
    var sizes = [];
    var sizeRows = document.querySelectorAll('#createIngSizesContainer .inv-form-row');
    for (var i = 0; i < sizeRows.length; i++) {
        var row = sizeRows[i];
        var sNameInput = row.querySelector('.create-ing-size-name');
        var sPriceInput = row.querySelector('.create-ing-size-price');
        if (!sNameInput) continue;
        var sName = sNameInput.value.trim();
        var sPrice = parseInt(sPriceInput ? sPriceInput.value : 0) || 0;
        if (!sName) continue;
        
        var sizeIngs = [];
        var ingSelects = row.querySelectorAll('.create-size-ing-rows .create-ing-ing-select');
        var ingQtys = row.querySelectorAll('.create-size-ing-rows .create-ing-ing-qty');
        var ingUnits = row.querySelectorAll('.create-size-ing-rows .create-ing-ing-unit');
        var ings = window.ingredients || [];
        for (var si = 0; si < ingSelects.length; si++) {
            var sid = ingSelects[si].value;
            var sqty = parseFloat(ingQtys[si].value) || 0;
            var sunit = ingUnits[si].value.trim();
            if (sid && sqty > 0) {
                var sIngName = '';
                for (var j = 0; j < ings.length; j++) {
                    if (String(ings[j].id) === String(sid)) { sIngName = ings[j].name; break; }
                }
                sizeIngs.push({ ingredientId: sid, ingredientName: sIngName, quantity: sqty, unit: sunit });
            }
        }
        sizes.push({ name: sName, price: sPrice, ingredients: sizeIngs.length > 0 ? sizeIngs : [], recipe: '' });
    }
    
    // Collect global ingredients
    var globalIngs = [];
    var gSelects = document.querySelectorAll('#createIngGlobalIngContainer .create-ing-ing-select');
    var gQtys = document.querySelectorAll('#createIngGlobalIngContainer .create-ing-ing-qty');
    var gUnits = document.querySelectorAll('#createIngGlobalIngContainer .create-ing-ing-unit');
    var ings = window.ingredients || [];
    for (var i = 0; i < gSelects.length; i++) {
        var gid = gSelects[i].value;
        var gqty = parseFloat(gQtys[i].value) || 0;
        var gunit = gUnits[i].value.trim();
        if (gid && gqty > 0) {
            var gIngName = '';
            for (var j = 0; j < ings.length; j++) {
                if (String(ings[j].id) === String(gid)) { gIngName = ings[j].name; break; }
            }
            globalIngs.push({ ingredientId: gid, ingredientName: gIngName, quantity: gqty, unit: gunit });
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
        ingredients: globalIngs.length > 0 ? globalIngs : []
    };
    
    DB.create('menu', data).then(function(newItem) {
        showToast('Đã tạo món "' + name + '"', 'success');
        closeModal('createMenuItemFromIngModal');
        return DB.getAll('menu');
    }).then(function(items) {
        window.menuItems = items;
        renderInventoryMenu();
        _invalidateLookups();
    }).catch(function(err) {
        if (errorEl) errorEl.innerText = err.message || 'Lỗi tạo món';
    });
}

function switchIngUsageTab(tabName) {
    var tabs = document.querySelectorAll('.ing-usage-tab');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tabName);
    }
    var usageContent = document.getElementById('ingUsageTabUsage');
    var menuItemsContent = document.getElementById('ingUsageTabMenuItems');
    var txContent = document.getElementById('ingUsageTabTransactions');
    if (usageContent) usageContent.style.display = tabName === 'usage' ? '' : 'none';
    if (menuItemsContent) menuItemsContent.style.display = tabName === 'menuitems' ? '' : 'none';
    if (txContent) txContent.style.display = tabName === 'transactions' ? '' : 'none';
    
    // Render related menu items when switching to menuitems tab
    if (tabName === 'menuitems' && window._currentIngId) {
        _renderRelatedMenuItems(window._currentIngId);
    }
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
window._createAddSizeIngRow = _createAddSizeIngRow;
window._buildAddSizeIngRowHtml = _buildAddSizeIngRowHtml;
window._resetMenuItemSizes = _resetMenuItemSizes;
window._resetMenuItemIngredients = _resetMenuItemIngredients;
window._addModalIngredient = _addModalIngredient;
window.showIngredientUsage = showIngredientUsage;
window.toggleIngUsageDate = toggleIngUsageDate;
window.switchIngUsageTab = switchIngUsageTab;
window.handleIngredientQuickImport = handleIngredientQuickImport;
window.showInvCategoryContextMenu = showInvCategoryContextMenu;
window.closeInvCategoryContextMenu = closeInvCategoryContextMenu;
// Export new ingredient-related menu functions
window._renderRelatedMenuItems = _renderRelatedMenuItems;
window.filterIngRelatedMenu = filterIngRelatedMenu;
window._showEditMenuItemIngredients = _showEditMenuItemIngredients;
window._showAssignIngredientToMenu = _showAssignIngredientToMenu;
window._renderAssignIngMenuList = _renderAssignIngMenuList;
window.filterAssignIngMenu = filterAssignIngMenu;
window._selectAssignIngMenuItem = _selectAssignIngMenuItem;
window._addAssignIngSizeRow = _addAssignIngSizeRow;
window._addAssignIngGlobalIngRow = _addAssignIngGlobalIngRow;
window._createAssignSizeIngRow = _createAssignSizeIngRow;
window._handleAssignIngredientSave = _handleAssignIngredientSave;
window._showCreateMenuItemFromIng = _showCreateMenuItemFromIng;
window._addCreateIngSizeRow = _addCreateIngSizeRow;
window._addCreateIngGlobalIngRow = _addCreateIngGlobalIngRow;
window._createCreateSizeIngRow = _createCreateSizeIngRow;
window._handleCreateMenuItemFromIng = _handleCreateMenuItemFromIng;
