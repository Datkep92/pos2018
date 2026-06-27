// order.js - Tạo đơn hàng, thêm món, giỏ hàng
// BỐ CỤC 3 CỘT: Danh mục | Menu | Giỏ hàng

// FIX: Flag để tránh kiểm tra credit 2 lần khi qua _takeawayChangeToastPay
// _takeawayChangeToastPay lưu tiền dư vào credit, sau đó gọi handleTakeawayPayment
// và _processTakeawayDirect - cả 2 đều kiểm tra credit, gây trừ credit 2 lần
var _skipOrderCreditCheck = false;

// Helper: Dispatch event để settings.js reload doanh thu pos-cash-info
// Được gọi sau khi thanh toán thành công để cập nhật realtime trên cùng máy
function _dispatchPosCashUpdate() {
    try {
        var evt = document.createEvent('CustomEvent');
        evt.initCustomEvent('pos_cash_update', true, true, {});
        window.dispatchEvent(evt);
    } catch (e) {
    }
}

var _menuCategoryIds = []; // Danh sách category IDs để vuốt chuyển danh mục
var _menuSwipeStartY = 0;

// OPTIMIZE: Cache DOM references cho cart để tránh querySelector mỗi lần render
var _cartDomCache = {
    container: null,
    totalSpan: null,
    actionsDiv: null,
    headerActions: null
};
// OPTIMIZE: Cache HTML string cuối cùng để tránh rebuild không cần thiết
var _cartLastHtml = '';
var _cartLastTotal = -1;
// OPTIMIZE: Debounce timer cho render cart
var _cartRenderTimer = null;
var _cartRenderPending = false;
// OPTIMIZE: Số lượng items lần render trước (để biết có cần rebuild swipe hay không)
var _cartLastItemCount = 0;

// OPTIMIZE: Clone nhanh thay vì JSON.parse(JSON.stringify(...)) - chậm trên Android 6
function _cloneArr(arr) {
    if (!arr) return [];
    var result = [];
    for (var i = 0; i < arr.length; i++) {
        var item = arr[i];
        if (item && typeof item === 'object') {
            var cloned = {};
            for (var k in item) {
                if (item.hasOwnProperty(k)) {
                    cloned[k] = item[k];
                }
            }
            result.push(cloned);
        } else {
            result.push(item);
        }
    }
    return result;
}

// Helper: Kiểm tra xem có đang ở chế độ portrait (dọc) hay không
function _isPortrait() {
    return window.innerHeight > window.innerWidth;
}

// ========== MỞ MODAL ==========
function openAddMenuForTable(tableId) {
    currentAddToTableId = tableId;
    tempOrder = [];
    selectedCustomer = null;
    openOrderModal();
}

function openCreateOrderModal() {
    currentAddToTableId = null;
    currentDraftId = null;  // Reset draft khi tạo đơn mới
    tempOrder = [];
    selectedCustomer = null;
    openOrderModal();
}

function openOrderModal() {
    // Reset cache DOM khi mở modal
    _resetCartDomCache();
    renderOrderCategoriesColumn();
    renderMenuByCategory('all');
    renderCartColumn();
    
    // Cập nhật tiêu đề modal nếu đang chỉnh sửa draft
    var titleEl = document.querySelector('#orderModal .modal-title');
    if (titleEl) {
        if (currentDraftId) {
            var draft = getDraft(currentDraftId);
            if (draft) {
                titleEl.innerText = '✏️ ' + escapeHtml(draft.label) + ' (nháp)';
            } else {
                titleEl.innerText = '🛒 Tạo đơn hàng';
            }
        } else {
            titleEl.innerText = '🛒 Tạo đơn hàng';
        }
    }
    
    document.getElementById('orderModal').style.display = 'flex';
    
    // Khởi tạo vuốt chuyển danh mục
    _initMenuSwipe();
}

// ========== RENDER CỘT DANH MỤC (dọc) ==========
function renderOrderCategoriesColumn() {
    var container = document.getElementById('orderCategoriesColumn');
    if (!container) return;
    
    // CHỈ DÙNG DANH MỤC TỪ DATABASE, KHÔNG CÓ HARDCODE
    var categories = [];
    
    // Thêm danh mục "Tất cả" thủ công
    categories.push({ id: 'all', icon: '📋', name: 'Tất cả' });
    
    // Lấy danh mục từ database (window.menuCategories)
    if (window.menuCategories && window.menuCategories.length) {
        // Tạo bản sao và sắp xếp theo sortOrder
        var sortedCats = window.menuCategories.slice();
        sortedCats.sort(function(a, b) {
            var orderA = (a.sortOrder !== undefined && a.sortOrder !== null) ? a.sortOrder : 9999;
            var orderB = (b.sortOrder !== undefined && b.sortOrder !== null) ? b.sortOrder : 9999;
            return orderA - orderB;
        });
        for (var ci = 0; ci < sortedCats.length; ci++) {
            var cat = sortedCats[ci];
            categories.push({
                id: cat.id,
                icon: cat.icon || '📌',
                name: cat.name
            });
        }
    }
    
    // Cập nhật danh sách category IDs để vuốt chuyển
    _menuCategoryIds = [];
    for (var ci2 = 0; ci2 < categories.length; ci2++) {
        _menuCategoryIds.push(categories[ci2].id);
    }
    
    // === RENDER THANH CATEGORIES NGANG (cho landscape) ===
    var html = '';
    // Nút sắp xếp danh mục - chỉ hiển thị khi có danh mục từ DB
    if (window.menuCategories && window.menuCategories.length > 1) {
        var catBtnClass = _isCategoryReorderMode ? 'active' : '';
        html += '<div class="category-item category-sort-btn ' + catBtnClass + '" id="catReorderToggleBtn" onclick="toggleCategoryReorderMode()">' +
            '<span class="cat-icon">🔀</span>' +
            '<span>' + (_isCategoryReorderMode ? '✅ Xong' : 'Sắp xếp DM') + '</span>' +
        '</div>';
    }
    for (var ci3 = 0; ci3 < categories.length; ci3++) {
        var cat = categories[ci3];
        var activeClass = (currentMenuCategory === cat.id) ? 'active' : '';
        html += '<div class="category-item ' + activeClass + '" data-cat="' + cat.id + '" onclick="renderMenuByCategory(\'' + cat.id + '\')">' +
            '<span class="cat-icon">' + cat.icon + '</span>' +
            '<span>' + escapeHtml(cat.name) + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
    
    // Nếu đang ở chế độ sắp xếp danh mục, gắn drag events
    if (_isCategoryReorderMode) {
        _enableCatDragReorder(container);
    }
    
    // === RENDER DROPDOWN SELECT (cho mobile/portrait) ===
    _renderCategorySelect(categories);
}

// Render dropdown select để chọn danh mục trên mobile (thay thế thanh ngang)
function _renderCategorySelect(categories) {
    var select = document.getElementById('orderCategorySelect');
    if (!select) return;
    
    var currentVal = select.value;
    var html = '';
    for (var i = 0; i < categories.length; i++) {
        var cat = categories[i];
        var selected = (cat.id === currentMenuCategory) ? ' selected' : '';
        html += '<option value="' + cat.id + '"' + selected + '>' + cat.icon + ' ' + escapeHtml(cat.name) + '</option>';
    }
    select.innerHTML = html;
}

// Xử lý khi chọn danh mục từ dropdown (mobile)
function onCategorySelectChange() {
    var select = document.getElementById('orderCategorySelect');
    if (!select) return;
    var categoryId = select.value;
    if (categoryId) {
        renderMenuByCategory(categoryId);
    }
}

// ========== BIẾN CHO KÉO THẢ SẮP XẾP MÓN ==========
var _isReorderMode = false;
// Dùng mouse/touch events thuần - nhẹ, ko lag, ko bị nhảy vị trí
var _dragState = null; // { el, itemId, startX, startY, clone, dropTarget }
// Chỉ sync sortOrder lên Firebase khi thoát chế độ sắp xếp (bấm "✅ Xong")
// Tránh spam sync sau mỗi lần kéo thả
var _sortOrderChanged = false;

// OPTIMIZE: Cache HTML string cho mỗi category để tránh rebuild
var _menuHtmlCache = {};
// OPTIMIZE: Cache DOM reference cho menuGrid container
var _menuGridContainer = null;
// OPTIMIZE: Biến lưu category đang hiển thị để event delegation biết
var _currentRenderedCategory = null;

// Hàm loại bỏ dấu tiếng Việt và khoảng trắng để tìm kiếm
function _removeAccents(str) {
    var map = {
        'à':'a','á':'a','ạ':'a','ả':'a','ã':'a','â':'a','ầ':'a','ấ':'a','ậ':'a','ẩ':'a','ẫ':'a','ă':'a','ằ':'a','ắ':'a','ặ':'a','ẳ':'a','ẵ':'a',
        'è':'e','é':'e','ẹ':'e','ẻ':'e','ẽ':'e','ê':'e','ề':'e','ế':'e','ệ':'e','ể':'e','ễ':'e',
        'ì':'i','í':'i','ị':'i','ỉ':'i','ĩ':'i',
        'ò':'o','ó':'o','ọ':'o','ỏ':'o','õ':'o','ô':'o','ồ':'o','ố':'o','ộ':'o','ổ':'o','ỗ':'o','ơ':'o','ờ':'o','ớ':'o','ợ':'o','ở':'o','ỡ':'o',
        'ù':'u','ú':'u','ụ':'u','ủ':'u','ũ':'u','ư':'u','ừ':'u','ứ':'u','ự':'u','ử':'u','ữ':'u',
        'ỳ':'y','ý':'y','ỵ':'y','ỷ':'y','ỹ':'y',
        'đ':'d',
        'À':'a','Á':'a','Ạ':'a','Ả':'a','Ã':'a','Â':'a','Ầ':'a','Ấ':'a','Ậ':'a','Ẩ':'a','Ẫ':'a','Ă':'a','Ằ':'a','Ắ':'a','Ặ':'a','Ẳ':'a','Ẵ':'a',
        'È':'e','É':'e','Ẹ':'e','Ẻ':'e','Ẽ':'e','Ê':'e','Ề':'e','Ế':'e','Ệ':'e','Ể':'e','Ễ':'e',
        'Ì':'i','Í':'i','Ị':'i','Ỉ':'i','Ĩ':'i',
        'Ò':'o','Ó':'o','Ọ':'o','Ỏ':'o','Õ':'o','Ô':'o','Ồ':'o','Ố':'o','Ộ':'o','Ổ':'o','Ỗ':'o','Ơ':'o','Ờ':'o','Ớ':'o','Ợ':'o','Ở':'o','Ỡ':'o',
        'Ù':'u','Ú':'u','Ụ':'u','Ủ':'u','Ũ':'u','Ư':'u','Ừ':'u','Ứ':'u','Ự':'u','Ử':'u','Ữ':'u',
        'Ỳ':'y','Ý':'y','Ỵ':'y','Ỷ':'y','Ỹ':'y',
        'Đ':'d'
    };
    return str.replace(/[^a-zA-Z0-9\s]/g, function(ch) { return map[ch] || ch; }).replace(/\s+/g, '');
}

// ========== LỌC MENU THEO TỪ KHÓA TÌM KIẾM ==========
var _menuSearchTimeout = null;

function filterMenuBySearch(keyword) {
    if (_menuSearchTimeout) clearTimeout(_menuSearchTimeout);
    _menuSearchTimeout = setTimeout(function() {
        _menuSearchTimeout = null;
        var container = document.getElementById('menuGrid');
        if (!container) return;
        
        keyword = _removeAccents(keyword.trim().toLowerCase());
        if (!keyword) {
            // Nếu không có từ khóa, render lại theo category đang chọn
            renderMenuByCategory(currentMenuCategory);
            return;
        }
        
        // Lọc items theo từ khóa (loại bỏ dấu + khoảng trắng cả 2 vế)
        var filtered = menuItems.filter(function(item) {
            var itemName = _removeAccents(item.name.toLowerCase());
            return itemName.indexOf(keyword) !== -1;
        });
        
        if (filtered.length === 0) {
            container.innerHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8;">🔍 Không tìm thấy món "' + escapeHtml(keyword) + '"</div>';
            return;
        }
        
        // Render kết quả tìm kiếm (dùng logic render giống renderMenuByCategory)
        var html = '';
        for (var i = 0; i < filtered.length; i++) {
            var item = filtered[i];
            if (item.hasVariants && item.variants && item.variants.length) {
                var variantsHtml = '';
                for (var v = 0; v < item.variants.length; v++) {
                    var variant = item.variants[v];
                    variantsHtml += '<button class="variant-btn" data-item-id="' + item.id + '" data-variant="' + escapeHtml(variant.name) + '" data-price="' + variant.price + '">' + escapeHtml(variant.name) + '</button>';
                }
                html += '<div class="menu-item-variant" data-item-id="' + item.id + '">' +
                    '<div class="menu-name">' + escapeHtml(item.name) + '</div>' +
                    '<div class="variant-group">' + variantsHtml + '</div>' +
                '</div>';
            } else {
                var price = item.price || 0;
                html += '<div class="menu-card" data-item-id="' + item.id + '" data-name="' + escapeHtml(item.name) + '" data-price="' + price + '">' +
                    '<div class="menu-name">' + escapeHtml(item.name) + '</div>' +
                    '<div class="menu-price">' + formatMoney(price) + '</div>' +
                '</div>';
            }
        }
        container.innerHTML = html;
    }, 150); // Debounce 150ms
}

// ========== RENDER MENU THEO DANH MỤC - TỐI ƯU ==========
// OPTIMIZE: Dùng event delegation thay vì inline onclick
// OPTIMIZE: Cache HTML string để tránh rebuild khi chuyển qua lại giữa các category
function renderMenuByCategory(categoryId) {
    currentMenuCategory = categoryId;
    
    // OPTIMIZE: Cache DOM reference
    if (!_menuGridContainer) {
        _menuGridContainer = document.getElementById('menuGrid');
    }
    var container = _menuGridContainer;
    if (!container) return;
    
    // Reset scroll của menu column về đầu mỗi khi chuyển danh mục
    var menuColumn = document.querySelector('.order-menu-column');
    if (menuColumn) menuColumn.scrollTop = 0;
    
    // Cập nhật dropdown select nếu đang hiển thị
    var catSelect = document.getElementById('orderCategorySelect');
    if (catSelect) catSelect.value = categoryId;
    
    // Lọc món theo danh mục
    var items = [];
    if (categoryId === 'all') {
        items = menuItems.slice();
    } else {
        items = menuItems.filter(function(i) { return i.categoryId == categoryId; });
    }
    
    if (items.length === 0) {
        container.innerHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8;">📭 Không có món</div>';
        _currentRenderedCategory = categoryId;
        _menuHtmlCache[categoryId] = container.innerHTML;
        return;
    }
    
    // OPTIMIZE: Kiểm tra cache HTML để tránh rebuild
    // FIX: Bao gồm _isReorderMode trong cache key để tránh hiển thị HTML cũ khi sắp xếp
    // FIX: Dùng checksum nhanh thay vì items.length để phát hiện thay đổi dữ liệu
    var cacheKey = categoryId + '_' + (items.length) + '_' + (_isReorderMode ? '1' : '0');
    if (_menuHtmlCache[cacheKey] && _currentRenderedCategory === categoryId) {
        // Đã render rồi, không cần làm gì
        _updateCategoryActive(categoryId);
        return;
    }
    
    var html = '';
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.hasVariants && item.variants && item.variants.length) {
            // Có biến thể
            var variantsHtml = '';
            for (var v = 0; v < item.variants.length; v++) {
                var variant = item.variants[v];
                // OPTIMIZE: Dùng data attributes thay vì inline onclick
                variantsHtml += '<button class="variant-btn" data-item-id="' + item.id + '" data-variant="' + escapeHtml(variant.name) + '" data-price="' + variant.price + '">' + escapeHtml(variant.name) + '</button>';
            }
            html += '<div class="menu-item-variant" data-item-id="' + item.id + '">' +
                '<div class="menu-name">' + escapeHtml(item.name) + '</div>' +
                '<div class="variant-group">' + variantsHtml + '</div>' +
            '</div>';
        } else {
            // Món đơn - Dùng data attributes thay vì inline onclick
            var price = item.price || 0;
            html += '<div class="menu-card" data-item-id="' + item.id + '" data-name="' + escapeHtml(item.name) + '" data-price="' + price + '">' +
                '<div class="menu-name">' + escapeHtml(item.name) + '</div>' +
                '<div class="menu-price">' + formatMoney(price) + '</div>' +
            '</div>';
        }
    }
    
    // OPTIMIZE: Chỉ set innerHTML khi HTML thực sự khác
    if (container.innerHTML !== html) {
        container.innerHTML = html;
        _menuHtmlCache[cacheKey] = html;
    }
    _currentRenderedCategory = categoryId;
    
    // Nếu đang ở chế độ sắp xếp, gắn drag events
    if (_isReorderMode) {
        _enableDragReorder(container);
    }
    
    // Cập nhật active cho danh mục
    _updateCategoryActive(categoryId);
}

// OPTIMIZE: Tách riêng hàm cập nhật active category
function _updateCategoryActive(categoryId) {
    var cats = document.querySelectorAll('#orderCategoriesColumn .category-item');
    for (var i = 0; i < cats.length; i++) {
        var cat = cats[i].getAttribute('data-cat');
        if (cat == categoryId) cats[i].classList.add('active');
        else cats[i].classList.remove('active');
    }
}

// OPTIMIZE: Event delegation cho menu-grid - chỉ gắn 1 listener thay vì N inline onclick
// Gắn listener này 1 lần khi khởi tạo
function _initMenuEventDelegation() {
    var container = document.getElementById('menuGrid');
    if (!container) return;
    if (container._delegationInitialized) return;
    container._delegationInitialized = true;
    
    container.addEventListener('click', function(e) {
        // Nếu đang ở chế độ sắp xếp, không thêm món vào giỏ hàng
        if (_isReorderMode) return;
        
        var target = e.target;
        
        // Xử lý click trên variant-btn
        if (target.classList.contains('variant-btn')) {
            var itemId = target.getAttribute('data-item-id');
            var variantName = target.getAttribute('data-variant');
            var price = parseFloat(target.getAttribute('data-price')) || 0;
            addToCartWithVariant(itemId, variantName, price);
            return;
        }
        
        // Xử lý click trên menu-card (hoặc con của nó)
        var card = target.closest('.menu-card');
        if (card) {
            var itemId = card.getAttribute('data-item-id');
            var name = card.getAttribute('data-name');
            var price = parseFloat(card.getAttribute('data-price')) || 0;
            addToCart(itemId, name, price);
            return;
        }
        
        // Xử lý click trên menu-item-variant (click vào name)
        var variantContainer = target.closest('.menu-item-variant');
        if (variantContainer && !target.classList.contains('variant-btn')) {
            // Click vào tên món có biến thể - không làm gì, user phải chọn biến thể
            return;
        }
    });
}

// ========== BẬT/TẮT CHẾ ĐỘ SẮP XẾP MÓN ==========
function toggleReorderMode() {
    _isReorderMode = !_isReorderMode;
    var container = document.getElementById('menuGrid');
    if (!container) return;
    
    var toggleBtn = document.getElementById('reorderToggleBtn');
    
    if (_isReorderMode) {
        container.classList.add('drag-active');
        _enableDragReorder(container);
        if (toggleBtn) {
            toggleBtn.classList.add('active');
            toggleBtn.textContent = '✅ Xong';
        }
        showToast('🔄 Kéo thả món để sắp xếp', 'warning');
    } else {
        container.classList.remove('drag-active');
        _disableDragReorder(container);
        if (toggleBtn) {
            toggleBtn.classList.remove('active');
            toggleBtn.textContent = '🔀 Sắp xếp';
        }
        // Chỉ sync lên Firebase nếu có thay đổi - tránh spam sync
        if (_sortOrderChanged) {
            _syncSortOrderToFirebase();
            _sortOrderChanged = false;
        }
        showToast('✅ Đã lưu thứ tự mới', 'success');
    }
}

// ========== GẮN SỰ KIỆN KÉO THẢ (MOUSE + TOUCH) ==========
// Dùng pointer events + touch events thuần - nhẹ, ko lag, ko bị nhảy
function _enableDragReorder(container) {
    var items = container.querySelectorAll('.menu-card, .menu-item-variant');
    for (var i = 0; i < items.length; i++) {
        var el = items[i];
        // Mouse events cho desktop
        el.addEventListener('mousedown', _dragMouseDown);
        // Touch events cho mobile - passive:false để có thể preventDefault khi cần
        el.addEventListener('touchstart', _dragTouchStart, { passive: false });
    }
}

function _disableDragReorder(container) {
    var items = container.querySelectorAll('.menu-card, .menu-item-variant');
    for (var i = 0; i < items.length; i++) {
        var el = items[i];
        el.removeEventListener('mousedown', _dragMouseDown);
        el.removeEventListener('touchstart', _dragTouchStart);
        el.classList.remove('dragging', 'drag-over');
    }
    // Dọn dẹp drag state nếu còn
    _cleanupDrag();
}

// ========== MOUSE EVENTS ==========
function _dragMouseDown(e) {
    if (!_isReorderMode) return;
    // Ko bắt trên variant-btn
    if (e.target.closest('.variant-btn')) return;
    var el = e.currentTarget;
    if (!el) return;
    
    _dragState = {
        el: el,
        itemId: el.getAttribute('data-item-id'),
        startX: e.clientX,
        startY: e.clientY,
        moved: false
    };
    
    document.addEventListener('mousemove', _dragMouseMove);
    document.addEventListener('mouseup', _dragMouseUp);
    e.preventDefault();
}

function _dragMouseMove(e) {
    if (!_dragState || !_isReorderMode) return;
    var dx = e.clientX - _dragState.startX;
    var dy = e.clientY - _dragState.startY;
    
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        _dragState.moved = true;
        _dragState.el.classList.add('dragging');
        _updateDropTarget(e.clientX, e.clientY);
    }
}

function _dragMouseUp(e) {
    if (!_dragState || !_isReorderMode) {
        _cleanupDrag();
        return;
    }
    
    _dragState.el.classList.remove('dragging');
    
    if (_dragState.moved && _dragState.dropTarget && _dragState.dropTarget !== _dragState.el) {
        var targetId = _dragState.dropTarget.getAttribute('data-item-id');
        _reorderMenuItems(_dragState.itemId, targetId);
    }
    
    _cleanupDrag();
    document.removeEventListener('mousemove', _dragMouseMove);
    document.removeEventListener('mouseup', _dragMouseUp);
}

// ========== TOUCH EVENTS ==========
function _dragTouchStart(e) {
    if (!_isReorderMode) return;
    if (e.target.closest('.variant-btn')) return;
    var el = e.currentTarget;
    if (!el) return;
    
    var touch = e.touches[0];
    _dragState = {
        el: el,
        itemId: el.getAttribute('data-item-id'),
        startX: touch.clientX,
        startY: touch.clientY,
        moved: false
    };
    
    document.addEventListener('touchmove', _dragTouchMove, { passive: false });
    document.addEventListener('touchend', _dragTouchEnd, { passive: true });
    // Ko preventDefault ở touchstart để ko chặn scroll
}

function _dragTouchMove(e) {
    if (!_dragState || !_isReorderMode) return;
    var touch = e.touches[0];
    var dx = touch.clientX - _dragState.startX;
    var dy = touch.clientY - _dragState.startY;
    
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        _dragState.moved = true;
        // Chỉ prevent khi event còn cancelable - tránh warning trên mobile
        if (e.cancelable) e.preventDefault();
        _dragState.el.classList.add('dragging');
        _updateDropTarget(touch.clientX, touch.clientY);
    }
}

function _dragTouchEnd(e) {
    if (!_dragState || !_isReorderMode) {
        _cleanupDrag();
        return;
    }
    
    _dragState.el.classList.remove('dragging');
    
    if (_dragState.moved && _dragState.dropTarget && _dragState.dropTarget !== _dragState.el) {
        var targetId = _dragState.dropTarget.getAttribute('data-item-id');
        _reorderMenuItems(_dragState.itemId, targetId);
    }
    
    _cleanupDrag();
    document.removeEventListener('touchmove', _dragTouchMove);
    document.removeEventListener('touchend', _dragTouchEnd);
}

// ========== DÙNG CHUNG: TÌM DROP TARGET ==========
function _updateDropTarget(clientX, clientY) {
    var target = document.elementFromPoint(clientX, clientY);
    if (!target) return;
    
    var dropEl = target.closest('[data-item-id]');
    
    // Xoá drag-over cũ
    var container = document.getElementById('menuGrid');
    var all = container.querySelectorAll('.drag-over');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('drag-over');
    
    if (dropEl && dropEl !== _dragState.el) {
        dropEl.classList.add('drag-over');
        _dragState.dropTarget = dropEl;
    } else {
        _dragState.dropTarget = null;
    }
}

function _cleanupDrag() {
    // Xoá drag-over khỏi tất cả
    var container = document.getElementById('menuGrid');
    if (container) {
        var all = container.querySelectorAll('.drag-over');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('drag-over');
    }
    _dragState = null;
}

// ========== SẮP XẾP LẠI MÓN ==========
function _reorderMenuItems(sourceId, targetId) {
    // Tìm index trong menuItems
    var sourceIdx = -1;
    var targetIdx = -1;
    for (var i = 0; i < menuItems.length; i++) {
        if (menuItems[i].id === sourceId) sourceIdx = i;
        if (menuItems[i].id === targetId) targetIdx = i;
    }
    if (sourceIdx === -1 || targetIdx === -1) return;
    
    // Di chuyển phần tử
    var item = menuItems.splice(sourceIdx, 1)[0];
    menuItems.splice(targetIdx, 0, item);
    
    // Cập nhật sortOrder trong memory - chưa sync lên Firebase
    for (var i = 0; i < menuItems.length; i++) {
        menuItems[i].sortOrder = i;
    }
    _sortOrderChanged = true;
    
    // Xoá cache HTML để buộc render lại với thứ tự mới
    _menuHtmlCache = {};
    
    // Render lại menu
    renderMenuByCategory(currentMenuCategory);
}

// Sync sortOrder lên Firebase - chỉ gọi 1 lần khi thoát chế độ sắp xếp
// Dùng batchUpdateSortOrder để ghi 1 lần duy nhất, ko spam sync queue
function _syncSortOrderToFirebase() {
    var items = [];
    for (var i = 0; i < menuItems.length; i++) {
        items.push({ id: menuItems[i].id, sortOrder: i });
    }
    DB.batchUpdateSortOrder(items).catch(function(err) {
        console.error('Lỗi lưu sortOrder:', err);
    });
}

// ========== BIẾN CHO KÉO THẢ SẮP XẾP DANH MỤC ==========
var _isCategoryReorderMode = false;
var _catDragState = null; // { el, catId, startX, startY, clone, dropTarget }
var _catSortOrderChanged = false;

// ========== BẬT/TẮT CHẾ ĐỘ SẮP XẾP DANH MỤC ==========
function toggleCategoryReorderMode() {
    _isCategoryReorderMode = !_isCategoryReorderMode;
    var container = document.getElementById('orderCategoriesColumn');
    if (!container) return;
    
    var toggleBtn = document.getElementById('catReorderToggleBtn');
    
    if (_isCategoryReorderMode) {
        container.classList.add('drag-active');
        _enableCatDragReorder(container);
        if (toggleBtn) {
            toggleBtn.classList.add('active');
            toggleBtn.textContent = '✅ Xong';
        }
        showToast('🔄 Kéo thả danh mục để sắp xếp', 'warning');
    } else {
        container.classList.remove('drag-active');
        _disableCatDragReorder(container);
        if (toggleBtn) {
            toggleBtn.classList.remove('active');
            toggleBtn.textContent = '🔀 Sắp xếp DM';
        }
        // Chỉ sync lên Firebase nếu có thay đổi
        if (_catSortOrderChanged) {
            _syncCategorySortOrderToFirebase();
            _catSortOrderChanged = false;
        }
        showToast('✅ Đã lưu thứ tự danh mục mới', 'success');
    }
}

// ========== GẮN SỰ KIỆN KÉO THẢ DANH MỤC ==========
function _enableCatDragReorder(container) {
    var items = container.querySelectorAll('.category-item');
    for (var i = 0; i < items.length; i++) {
        var el = items[i];
        el.addEventListener('mousedown', _catDragMouseDown);
        el.addEventListener('touchstart', _catDragTouchStart, { passive: false });
    }
}

function _disableCatDragReorder(container) {
    var items = container.querySelectorAll('.category-item');
    for (var i = 0; i < items.length; i++) {
        var el = items[i];
        el.removeEventListener('mousedown', _catDragMouseDown);
        el.removeEventListener('touchstart', _catDragTouchStart);
        el.classList.remove('dragging', 'drag-over');
    }
    _catCleanupDrag();
}

// ========== MOUSE EVENTS CHO DANH MỤC ==========
function _catDragMouseDown(e) {
    if (!_isCategoryReorderMode) return;
    var el = e.currentTarget;
    if (!el) return;
    // Không kéo được danh mục "Tất cả" và nút sắp xếp
    var catId = el.getAttribute('data-cat');
    if (!catId || catId === 'all') return;
    
    _catDragState = {
        el: el,
        catId: el.getAttribute('data-cat'),
        startX: e.clientX,
        startY: e.clientY,
        moved: false
    };
    
    document.addEventListener('mousemove', _catDragMouseMove);
    document.addEventListener('mouseup', _catDragMouseUp);
    e.preventDefault();
}

function _catDragMouseMove(e) {
    if (!_catDragState || !_isCategoryReorderMode) return;
    var dx = e.clientX - _catDragState.startX;
    var dy = e.clientY - _catDragState.startY;
    
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        _catDragState.moved = true;
        _catDragState.el.classList.add('dragging');
        _catUpdateDropTarget(e.clientX, e.clientY);
    }
}

function _catDragMouseUp(e) {
    if (!_catDragState || !_isCategoryReorderMode) {
        _catCleanupDrag();
        return;
    }
    
    _catDragState.el.classList.remove('dragging');
    
    if (_catDragState.moved && _catDragState.dropTarget && _catDragState.dropTarget !== _catDragState.el) {
        var targetCatId = _catDragState.dropTarget.getAttribute('data-cat');
        _reorderCategories(_catDragState.catId, targetCatId);
    }
    
    _catCleanupDrag();
    document.removeEventListener('mousemove', _catDragMouseMove);
    document.removeEventListener('mouseup', _catDragMouseUp);
}

// ========== TOUCH EVENTS CHO DANH MỤC ==========
function _catDragTouchStart(e) {
    if (!_isCategoryReorderMode) return;
    var el = e.currentTarget;
    if (!el) return;
    // Không kéo được danh mục "Tất cả" và nút sắp xếp
    var catId = el.getAttribute('data-cat');
    if (!catId || catId === 'all') return;
    
    var touch = e.touches[0];
    _catDragState = {
        el: el,
        catId: el.getAttribute('data-cat'),
        startX: touch.clientX,
        startY: touch.clientY,
        moved: false
    };
    
    document.addEventListener('touchmove', _catDragTouchMove, { passive: false });
    document.addEventListener('touchend', _catDragTouchEnd, { passive: true });
}

function _catDragTouchMove(e) {
    if (!_catDragState || !_isCategoryReorderMode) return;
    var touch = e.touches[0];
    var dx = touch.clientX - _catDragState.startX;
    var dy = touch.clientY - _catDragState.startY;
    
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        _catDragState.moved = true;
        if (e.cancelable) e.preventDefault();
        _catDragState.el.classList.add('dragging');
        _catUpdateDropTarget(touch.clientX, touch.clientY);
    }
}

function _catDragTouchEnd(e) {
    if (!_catDragState || !_isCategoryReorderMode) {
        _catCleanupDrag();
        return;
    }
    
    _catDragState.el.classList.remove('dragging');
    
    if (_catDragState.moved && _catDragState.dropTarget && _catDragState.dropTarget !== _catDragState.el) {
        var targetCatId = _catDragState.dropTarget.getAttribute('data-cat');
        _reorderCategories(_catDragState.catId, targetCatId);
    }
    
    _catCleanupDrag();
    document.removeEventListener('touchmove', _catDragTouchMove);
    document.removeEventListener('touchend', _catDragTouchEnd);
}

// ========== DÙNG CHUNG: TÌM DROP TARGET CHO DANH MỤC ==========
function _catUpdateDropTarget(clientX, clientY) {
    var target = document.elementFromPoint(clientX, clientY);
    if (!target) return;
    
    var dropEl = target.closest('.category-item');
    
    // Xoá drag-over cũ
    var container = document.getElementById('orderCategoriesColumn');
    var all = container.querySelectorAll('.drag-over');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('drag-over');
    
    if (dropEl && dropEl !== _catDragState.el && dropEl.getAttribute('data-cat') !== 'all') {
        dropEl.classList.add('drag-over');
        _catDragState.dropTarget = dropEl;
    } else {
        _catDragState.dropTarget = null;
    }
}

function _catCleanupDrag() {
    var container = document.getElementById('orderCategoriesColumn');
    if (container) {
        var all = container.querySelectorAll('.drag-over');
        for (var i = 0; i < all.length; i++) all[i].classList.remove('drag-over');
    }
    _catDragState = null;
}

// ========== SẮP XẾP LẠI DANH MỤC ==========
function _reorderCategories(sourceCatId, targetCatId) {
    // Tìm index trong menuCategories
    var sourceIdx = -1;
    var targetIdx = -1;
    for (var i = 0; i < menuCategories.length; i++) {
        if (menuCategories[i].id === sourceCatId) sourceIdx = i;
        if (menuCategories[i].id === targetCatId) targetIdx = i;
    }
    if (sourceIdx === -1 || targetIdx === -1) return;
    
    // Di chuyển phần tử
    var item = menuCategories.splice(sourceIdx, 1)[0];
    menuCategories.splice(targetIdx, 0, item);
    
    // Cập nhật sortOrder trong memory
    for (var i = 0; i < menuCategories.length; i++) {
        menuCategories[i].sortOrder = i;
    }
    _catSortOrderChanged = true;
    
    // Render lại danh mục
    renderOrderCategoriesColumn();
}

// Sync sortOrder danh mục lên Firebase
function _syncCategorySortOrderToFirebase() {
    var items = [];
    for (var i = 0; i < menuCategories.length; i++) {
        items.push({ id: menuCategories[i].id, sortOrder: i });
    }
    DB.batchUpdateSortOrder(items, 'menu_categories').catch(function(err) {
        console.error('Lỗi lưu sortOrder danh mục:', err);
    });
}

// ========== VUỐT LÊN/XUỐNG CHUYỂN DANH MỤC ==========
// Biến lưu scrollTop tại thời điểm touchstart để phát hiện scroll dọc
var _menuSwipeStartScrollTop = 0;

function _initMenuSwipe() {
    var el = document.querySelector('.order-menu-column');
    if (!el) return;
    // Xoá event cũ để tránh dup
    el.removeEventListener('touchstart', _menuSwipeStart);
    el.removeEventListener('touchend', _menuSwipeEnd);
    el.addEventListener('touchstart', _menuSwipeStart);
    el.addEventListener('touchend', _menuSwipeEnd);
}
function _menuSwipeStart(e) {
    _menuSwipeStartY = e.touches[0].clientY;
    // Lưu scrollTop tại thời điểm bắt đầu chạm
    var menuEl = document.querySelector('.order-menu-column');
    _menuSwipeStartScrollTop = menuEl ? menuEl.scrollTop : 0;
}
function _menuSwipeEnd(e) {
    if (_menuCategoryIds.length < 2) return;
    // Khóa vuốt khi đang ở chế độ sắp xếp món
    if (_isReorderMode) return;
    
    // QUAN TRỌNG: Nếu scrollTop thay đổi so với lúc touchstart -> đây là thao tác cuộn, không phải vuốt chuyển danh mục
    var menuEl = document.querySelector('.order-menu-column');
    if (menuEl && menuEl.scrollTop !== _menuSwipeStartScrollTop) return;
    
    var endY = e.changedTouches[0].clientY;
    var diff = _menuSwipeStartY - endY;
    // Ngưỡng 50px để tránh vuốt vô tình
    if (Math.abs(diff) < 50) return;
    
    var currentIdx = -1;
    for (var i = 0; i < _menuCategoryIds.length; i++) {
        if (_menuCategoryIds[i] === currentMenuCategory) {
            currentIdx = i;
            break;
        }
    }
    if (currentIdx === -1) return;
    
    var nextIdx;
    if (diff > 0) {
        // Vuốt lên → danh mục tiếp theo
        nextIdx = currentIdx + 1;
        if (nextIdx >= _menuCategoryIds.length) nextIdx = 0;
    } else {
        // Vuốt xuống → danh mục trước đó
        nextIdx = currentIdx - 1;
        if (nextIdx < 0) nextIdx = _menuCategoryIds.length - 1;
    }
    renderMenuByCategory(_menuCategoryIds[nextIdx]);
}

// ========== RENDER HEADER ACTIONS (landscape only) ==========
// ========== RENDER GIỎ HÀNG (cột 3) - TỐI ƯU ==========
// OPTIMIZE: Cache DOM references, chỉ rebuild khi cần, debounce khi thêm nhiều món
function _getCartDom() {
    if (!_cartDomCache.container) {
        _cartDomCache.container = document.getElementById('cartItemsList');
        _cartDomCache.totalSpan = document.getElementById('cartTotalAmount');
        _cartDomCache.actionsDiv = document.getElementById('cartFooterActions');
        _cartDomCache.headerActions = document.getElementById('orderHeaderActions');
    }
    return _cartDomCache;
}

// OPTIMIZE: Reset cache DOM (gọi khi modal đóng/mở)
function _resetCartDomCache() {
    _cartDomCache.container = null;
    _cartDomCache.totalSpan = null;
    _cartDomCache.actionsDiv = null;
    _cartDomCache.headerActions = null;
    _cartLastHtml = '';
    _cartLastTotal = -1;
    _cartLastItemCount = 0;
}

// OPTIMIZE: Render cart với debounce - gọi từ addToCart, removeFromCart, updateCartQty
// FIX: Dùng _cartDebounceTimer thay vì _cartRenderTimer (biến này không bao giờ được set)
function renderCartColumn() {
    _debouncedRenderCart();
}

// OPTIMIZE: Hàm render thực tế - tách riêng để debounce có thể gọi lại
function _doRenderCart() {
    var dom = _getCartDom();
    var container = dom.container;
    var totalSpan = dom.totalSpan;
    var actionsDiv = dom.actionsDiv;
    var headerActions = dom.headerActions;
    
    if (!container) return;
    
    // Cập nhật header actions (landscape) - chỉ khi có thay đổi
    _renderOrderHeaderActionsFast(headerActions);
    
    if (tempOrder.length === 0) {
        // FIX: Luôn cập nhật DOM khi giỏ hàng rỗng, không dựa vào cache
        // vì _cartLastHtml có thể đã bị reset nhưng DOM vẫn còn items cũ
        container.innerHTML = '<div class="empty-cart">🛒 Chưa có món nào</div>';
        _cartLastHtml = '';
        _cartLastItemCount = 0;
        if (totalSpan) {
            totalSpan.innerText = '0đ';
            _cartLastTotal = 0;
        }
        return;
    }
    
    var total = 0;
    var itemCount = 0;
    var html = '';
    
    for (var i = 0; i < tempOrder.length; i++) {
        var item = tempOrder[i];
        var itemTotal = item.price * item.qty;
        total += itemTotal;
        itemCount += item.qty;
        
        var timeStr = '';
        if (item.addedTime) {
            var date = new Date(item.addedTime);
            timeStr = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        }
        
        // UI 1 DÒNG: Tên 🕒 thời gian [- 2 +] Thành tiền
        // Vuốt phải để xoá món (swipe-to-delete)
        html += '<div class="cart-item-row" data-idx="' + i + '">' +
            '<div class="cart-item-content">' +
                '<span class="cart-item-name">' + escapeHtml(item.name) + '</span>' +
                (timeStr ? '<span class="cart-item-time">🕒 ' + timeStr + '</span>' : '') +
                '<div class="cart-item-qty">' +
                    '<button class="cart-qty-btn" onclick="updateCartQty(' + i + ', -1)">−</button>' +
                    '<span class="cart-qty-num">' + item.qty + '</span>' +
                    '<button class="cart-qty-btn" onclick="updateCartQty(' + i + ', 1)">+</button>' +
                '</div>' +
                '<span class="cart-item-total">' + formatMoney(itemTotal) + '</span>' +
            '</div>' +
            '<div class="cart-item-delete-bg" onclick="removeFromCart(' + i + ')">🗑️ Xoá</div>' +
        '</div>';
    }
    
    // OPTIMIZE: Chỉ set innerHTML khi HTML thực sự thay đổi
    if (html !== _cartLastHtml) {
        container.innerHTML = html;
        _cartLastHtml = html;
        // OPTIMIZE: Chỉ init swipe khi số lượng items thay đổi
        if (tempOrder.length !== _cartLastItemCount) {
            _initCartSwipe();
            _cartLastItemCount = tempOrder.length;
        } else {
            // Chỉ gán lại data-idx cho các row hiện có (khi sắp xếp lại)
            _updateCartIndices();
        }
    }
    
    // OPTIMIZE: Chỉ update totalSpan khi giá trị thay đổi
    if (totalSpan && _cartLastTotal !== total) {
        totalSpan.innerText = formatMoney(total);
        _cartLastTotal = total;
    }
    
    // Render nút action
    if (actionsDiv) {
        if (currentAddToTableId) {
            actionsDiv.innerHTML = '<button class="action-btn btn-table" onclick="handleAddToExistingTable()">🍽️ Thêm vào bàn</button>';
        } else {
            actionsDiv.innerHTML =
                '<div class="cart-info-row">' +
                    '<button class="action-btn btn-table" onclick="handleCreateNewTable()">🍽️ Tạo bàn mới</button>' +
                    '<span class="cart-item-count">' + itemCount + ' món</span>' +
                    '<span class="cart-total-label">' + formatMoney(total) + '</span>' +
                '</div>' +
                // Nút mệnh giá thanh toán nhanh tiền mặt
'<div class="denom-actions">' +
    '<button class="denom-btn denom-custom" onclick="showTakeawayCustomDenomInput()">✏️ Tùy chỉnh</button>' +
    '<button class="denom-btn" onclick="takeawayCashPayWithDenom(50000)">50.000đ</button>' +
    '<button class="denom-btn" onclick="takeawayCashPayWithDenom(100000)">100.000đ</button>' +
    '<button class="denom-btn" onclick="takeawayCashPayWithDenom(200000)">200.000đ</button>' +
    '<button class="denom-btn" onclick="takeawayCashPayWithDenom(500000)">500.000đ</button>' +
'</div>' +
'<div class="cart-pay-actions">' +
    '<button class="action-btn btn-cash" onclick="handleTakeawayPayment(\'cash\')">💰 TM</button>' +
    '<button class="action-btn btn-transfer" onclick="handleTakeawayPayment(\'transfer\')">💳 CK</button>' +
    '<button class="action-btn btn-grab" onclick="handleGrabOrder()">🚕 GR</button>' +
    '<button class="action-btn btn-debt" onclick="handleDebtOrder()">💢 Nợ</button>' +
'</div>' +
                // Nút lưu nháp (landscape) hoặc nút đóng (portrait)
                (_isPortrait()
                    ? '<div class="cart-draft-row">' +
                        '<button class="action-btn btn-close-modal" onclick="closeModal(\'orderModal\')">✕ Đóng</button>' +
                    '</div>'
                    : '<div class="cart-draft-row">' +
                        '<button class="action-btn btn-draft" onclick="minimizeCurrentOrderToDraft()">💬 Lưu nháp</button>' +
                    '</div>')
        }
    }
}

// OPTIMIZE: Phiên bản header actions nhanh - cache DOM, tránh rebuild HTML không cần
function _renderOrderHeaderActionsFast(headerActions) {
    if (!headerActions) return;
    
    var total = 0;
    for (var i = 0; i < tempOrder.length; i++) {
        total += tempOrder[i].price * tempOrder[i].qty;
    }
    
    var html;
    if (currentAddToTableId) {
        html = '<span class="header-action-btn btn-total">' + formatMoney(total) + '</span>' +
            '<button class="header-action-btn btn-table" onclick="handleAddToExistingTable()">🍽️ Nhập vào bàn</button>' +
            (_isPortrait()
                ? '<button class="header-action-btn btn-close-modal" onclick="closeModal(\'orderModal\')">✕ Đóng</button>'
                : '<button class="header-action-btn btn-draft" onclick="minimizeCurrentOrderToDraft()">💬 Lưu nháp</button>');
    } else {
        html = '<span class="header-action-btn btn-total">' + formatMoney(total) + '</span>' +
            '<button class="header-action-btn btn-table" onclick="handleCreateNewTable()">🍽️ Tạo bàn mới</button>' +
            '<button class="header-action-btn btn-cash" onclick="handleTakeawayPayment(\'cash\')">💰 Tiền mặt</button>' +
            '<button class="header-action-btn btn-transfer" onclick="handleTakeawayPayment(\'transfer\')">💳 Chuyển khoản</button>' +
            '<button class="header-action-btn btn-debt" onclick="handleDebtOrder()">💢 Nợ</button>' +
            (_isPortrait()
                ? '<button class="header-action-btn btn-close-modal" onclick="closeModal(\'orderModal\')">✕ Đóng</button>'
                : '<button class="header-action-btn btn-draft" onclick="minimizeCurrentOrderToDraft()">💬 Lưu nháp</button>') +
            '<button class="header-action-btn btn-sort" onclick="toggleReorderMode()" id="reorderToggleBtn">🔀 Sắp xếp</button>';
    }
    headerActions.innerHTML = html;
}

// OPTIMIZE: Cập nhật data-idx cho các row hiện có (khi sắp xếp lại thứ tự)
function _updateCartIndices() {
    var rows = document.querySelectorAll('.cart-item-row');
    for (var r = 0; r < rows.length; r++) {
        rows[r].setAttribute('data-idx', r);
        // Cập nhật onclick cho các nút qty và delete
        var qtyBtns = rows[r].querySelectorAll('.cart-qty-btn');
        if (qtyBtns.length >= 2) {
            qtyBtns[0].setAttribute('onclick', 'updateCartQty(' + r + ', -1)');
            qtyBtns[1].setAttribute('onclick', 'updateCartQty(' + r + ', 1)');
        }
        var deleteBg = rows[r].querySelector('.cart-item-delete-bg');
        if (deleteBg) {
            deleteBg.setAttribute('onclick', 'removeFromCart(' + r + ')');
        }
    }
}

// OPTIMIZE: Debounce render - gom nhiều lần gọi renderCartColumn trong 80ms thành 1 lần
// FIX: Luôn debounce, KHÔNG render ngay lần đầu để tránh layout thrashing khi click nhanh
var _cartDebounceTimer = null;
function _debouncedRenderCart() {
    if (_cartDebounceTimer) {
        // Đã có timer, đánh dấu pending
        _cartRenderPending = true;
        return;
    }
    // FIX: KHÔNG render ngay - đặt timer luôn để gom các lần click nhanh
    _cartRenderPending = true;
    _cartDebounceTimer = setTimeout(function() {
        _cartDebounceTimer = null;
        if (_cartRenderPending) {
            _cartRenderPending = false;
            _doRenderCart();
        }
    }, 80);
}


// ========== THÊM MÓN VÀO GIỎ (MỚI HIỂN THỊ TRÊN CÙNG) - TỐI ƯU ==========
// OPTIMIZE: Dùng _debouncedRenderCart để gom nhiều lần thêm món liên tiếp
function addToCart(id, name, price) {
    var now = new Date();
    var timeStr = now.toISOString();
    
    // Tìm món trùng trong giỏ
    var existingIndex = -1;
    for (var i = 0; i < tempOrder.length; i++) {
        if (tempOrder[i].id === id && !tempOrder[i].variantName) {
            existingIndex = i;
            break;
        }
    }
    
    if (existingIndex !== -1) {
        // Nếu đã tồn tại: tăng số lượng
        tempOrder[existingIndex].qty += 1;
        // CẬP NHẬT thời gian mới nhất
        tempOrder[existingIndex].addedTime = timeStr;
        // LẤY PHẦN TỬ ĐÓ RA
        var updatedItem = tempOrder.splice(existingIndex, 1)[0];
        // ĐƯA LÊN ĐẦU MẢNG (hiển thị trên cùng)
        tempOrder.unshift(updatedItem);
    } else {
        // Món mới: thêm vào ĐẦU mảng
        tempOrder.unshift({
            id: id,
            name: name,
            price: price,
            qty: 1,
            addedTime: timeStr,
            variantName: null
        });
    }
    
    // OPTIMIZE: Dùng debounced render - UI phản hồi tức thì, render gộp sau 50ms
    _debouncedRenderCart();
    
    // Toast nhẹ - dùng setTimeout để không chen vào critical path
    setTimeout(function() { showToast('✓ ' + name, 'success', 800); }, 0);
}

// ========== THÊM MÓN CÓ BIẾN THỂ (MỚI HIỂN THỊ TRÊN CÙNG) ==========
function addToCartWithVariant(itemId, variantName, price) {
    // Tìm item gốc để lấy tên
    var baseItem = null;
    for (var i = 0; i < menuItems.length; i++) {
        if (menuItems[i].id === itemId) {
            baseItem = menuItems[i];
            break;
        }
    }
    var displayName = baseItem ? baseItem.name + ' (' + variantName + ')' : variantName;
    var uniqueId = itemId + '_' + variantName;
    var now = new Date();
    var timeStr = now.toISOString();
    
    // Tìm món trùng trong giỏ
    var existingIndex = -1;
    for (var i = 0; i < tempOrder.length; i++) {
        if (tempOrder[i].id === uniqueId) {
            existingIndex = i;
            break;
        }
    }
    
    if (existingIndex !== -1) {
        // Nếu đã tồn tại: tăng số lượng
        tempOrder[existingIndex].qty += 1;
        // CẬP NHẬT thời gian mới nhất
        tempOrder[existingIndex].addedTime = timeStr;
        // LẤY PHẦN TỬ ĐÓ RA
        var updatedItem = tempOrder.splice(existingIndex, 1)[0];
        // ĐƯA LÊN ĐẦU MẢNG (hiển thị trên cùng)
        tempOrder.unshift(updatedItem);
    } else {
        // Món mới: thêm vào ĐẦU mảng
        tempOrder.unshift({
            id: uniqueId,
            name: displayName,
            price: price,
            qty: 1,
            addedTime: timeStr,
            variantName: variantName
        });
    }
    
    // OPTIMIZE: Dùng debounced render
    _debouncedRenderCart();
    
    // Toast nhẹ - dùng setTimeout để không chen vào critical path
    setTimeout(function() { showToast('✓ ' + displayName, 'success', 800); }, 0);
}



function removeFromCart(idx) {
    tempOrder.splice(idx, 1);
    // OPTIMIZE: Dùng debounced render
    _debouncedRenderCart();
}

function updateCartQty(idx, delta) {
    if (tempOrder[idx]) {
        var newQty = tempOrder[idx].qty + delta;
        if (newQty <= 0) {
            tempOrder.splice(idx, 1);
        } else {
            tempOrder[idx].qty = newQty;
        }
        // OPTIMIZE: Dùng debounced render
        _debouncedRenderCart();
    }
}
// ========== TẠO BÀN MỚI - TỰ ĐỘNG (phiên bản đơn giản) ==========
// OPTIMIZE: Gộp checkStock + deductIngredients thành 1 lần duyệt (dùng chung)
// FIX: Bỏ điều kiện menuItem.ingredients - dùng _getIngredientsForItem để hỗ trợ variant
function _checkAndDeductIngredients(items) {
    _buildLookups();
    var updates = [];
    for (var i = 0; i < items.length; i++) {
        var orderItem = items[i];
        var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
        var menuItem = _menuLookup[orderItem.id] || _menuLookup[baseName];
        if (menuItem) {
            var ings = _getIngredientsForItem(menuItem, orderItem);
            for (var k = 0; k < ings.length; k++) {
                var req = ings[k];
                var ing = _ingredientLookup[req.ingredientId];
                if (ing) {
                    var needed = _getConvertedQuantity(ing, req.quantity * orderItem.qty, req.unit);
                    // Cho phép âm kho - không chặn giao dịch khi hết nguyên liệu
                    // Deduct
                    ing.stock = (ing.stock || 0) - needed;
                    updates.push(DB.update('ingredients', ing.id, { stock: ing.stock }));
                    
                    var unit = ing.unit || '';
                    var note = 'Bán: ' + orderItem.name + ' x' + orderItem.qty + ' (-' + Math.round(needed * 1000) / 1000 + ' ' + unit + ')';
                    _logIngredientTransaction(ing.id, 'export', Math.round(needed * 1000) / 1000, unit, note).catch(function(err) {
                        console.error('Log export error:', err);
                    });
                }
            }
        }
    }
    return Promise.all(updates);
}

// OPTIMIZE: handleCreateNewTable - suppress realtime, gộp checkStock+deductIngredients
// FIX: Dùng window.cachedTables thay vì DB.getAll('tables') để tránh query DB mỗi lần
function handleCreateNewTable() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    
    // OPTIMIZE: Suppress realtime notifications
    DB.suppressRealtime();
    
    // Lấy danh sách bàn hiện tại từ memory cache
    var allTables = window.cachedTables || [];
    
    // Tìm số bàn lớn nhất
    var numbers = [];
    for (var i = 0; i < allTables.length; i++) {
        var name = allTables[i].name;
        var num = parseInt(name.replace(/\D/g, '')); // Lấy số từ tên
        if (!isNaN(num)) numbers.push(num);
    }
    
    // Tìm số lớn nhất
    var maxNum = Math.max.apply(null, numbers);
    if (maxNum === -Infinity) maxNum = 0;
    
    var nextNum = maxNum + 1;
    var tableName = 'Bàn ' + nextNum;
    
    var now = new Date();
    var tableId = Date.now().toString();
    var initTotal = tempOrder.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
    // Lưu danh sách món vừa thêm
    var initItems = tempOrder.map(function(item) { return { name: item.name, qty: item.qty }; });
    var currentUser = DB.getCurrentUser();
    var newTable = {
        id: tableId,
        name: tableName,
        status: 'occupied',
        time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        startTime: now.toISOString(),
        items: _cloneArr(tempOrder),
        total: initTotal,
        customerId: selectedCustomer ? selectedCustomer.id : null,
        customerName: selectedCustomer ? selectedCustomer.name : null,
        recentAdds: [{ items: initItems, time: now.toISOString() }],
        createdByName: (currentUser && currentUser.displayName) || '',
        createdByRole: (currentUser && currentUser.role) || ''
    };
    
    // OPTIMIZE: Gộp checkStock + deductIngredients, chạy song song với DB.create
    var createPromise = DB.create('tables', newTable, tableId);
    var stockPromise = _checkAndDeductIngredients(tempOrder);
    
    Promise.all([createPromise, stockPromise]).then(function() {
        // Xóa draft nếu đang chỉnh sửa draft
        if (currentDraftId) {
            return deleteDraft(currentDraftId);
        }
    }).then(function() {
        tempOrder = [];
        selectedCustomer = null;
        currentDraftId = null;
        closeModal('orderModal');
        
        // OPTIMIZE: Flush realtime sau khi tất cả operations hoàn tất
        DB.flushRealtime();
        
        return renderTables();
    }).then(function() {
        // Thêm class table-new để chạy hiệu ứng glow 30s
        var card = document.querySelector('.table-card[data-id="' + tableId + '"]');
        if (card) card.classList.add('table-new');
        showToast('✅ Đã tạo ' + tableName, 'success');
    }).catch(function(err) {
        DB.remove('tables', tableId);
        DB.flushRealtime();
        showToast(err.message || 'Lỗi!', 'error');
    });
}

// ========== XỬ LÝ THÊM VÀO BÀN HIỆN TẠI ==========
// OPTIMIZE: handleAddToExistingTable - suppress realtime, gộp checkStock+deductIngredients
// FIX: Dùng window.cachedTables thay vì DB.get('tables', ...) để tránh query DB mỗi lần
function handleAddToExistingTable() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    if (!currentAddToTableId) {
        showToast('Không xác định bàn đích!', 'error');
        return;
    }
    
    // OPTIMIZE: Suppress realtime notifications
    DB.suppressRealtime();
    
    // Lấy bàn từ memory cache
    var allTables = window.cachedTables || [];
    var table = null;
    for (var t = 0; t < allTables.length; t++) {
        if (String(allTables[t].id) === String(currentAddToTableId)) {
            table = allTables[t];
            break;
        }
    }
    
    if (!table) {
        showToast('Bàn không tồn tại!', 'error');
        DB.flushRealtime();
        return;
    }
    
    // OPTIMIZE: Gộp checkStock + deductIngredients thành 1 lần duyệt
    var stockPromise = _checkAndDeductIngredients(tempOrder);
    
    // Chuẩn bị dữ liệu cập nhật bàn (có thể tính song song)
    var existingItems = table.items || [];
    for (var i = 0; i < tempOrder.length; i++) {
        existingItems.push(_cloneArr([tempOrder[i]])[0]);
    }
    
    var newTotal = existingItems.reduce(function(sum, item) {
        return sum + (item.price * item.qty);
    }, 0);
    
    var recentAdds = table.recentAdds || [];
    var now = new Date();
    var addedItems = tempOrder.map(function(item) { return { name: item.name, qty: item.qty }; });
    recentAdds.push({ items: addedItems, time: now.toISOString() });
    if (recentAdds.length > 2) recentAdds.shift();
    
    // OPTIMIZE: Chạy song song checkStock+deductIngredients và DB.update
    var updatePromise = DB.update('tables', String(currentAddToTableId), {
        items: existingItems,
        total: newTotal,
        recentAdds: recentAdds
    });
    
    Promise.all([stockPromise, updatePromise]).then(function() {
        // Xóa draft nếu đang chỉnh sửa draft
        if (currentDraftId) {
            return deleteDraft(currentDraftId);
        }
    }).then(function() {
        tempOrder = [];
        selectedCustomer = null;
        currentDraftId = null;
        closeModal('orderModal');
        
        // OPTIMIZE: Flush realtime sau khi tất cả operations hoàn tất
        DB.flushRealtime();
        
        return renderTables();
    }).then(function() {
        // Thêm class table-new để chạy hiệu ứng glow 30s
        var card = document.querySelector('.table-card[data-id="' + currentAddToTableId + '"]');
        if (card) card.classList.add('table-new');
        showToast('✅ Đã thêm món vào bàn', 'success');
    }).catch(function(err) {
        DB.flushRealtime();
        showToast(err.message || 'Lỗi khi thêm món!', 'error');
    });
}

// Biến lưu trạng thái toast tiền dư cho takeaway
var _takeawayChangeToastEl = null;
var _takeawayChangeGivenAmount = 0;

// Hàm hiển thị popup nhập số tiền tùy chỉnh cho takeaway
function showTakeawayCustomDenomInput() {
    // Xóa popup cũ nếu có
    var oldOverlay = document.getElementById('customDenomOverlay');
    if (oldOverlay) oldOverlay.remove();

    var overlay = document.createElement('div');
    overlay.id = 'customDenomOverlay';
    overlay.className = 'custom-denom-overlay';
    overlay.innerHTML =
        '<div class="custom-denom-modal">' +
            '<div class="custom-denom-header">✏️ Nhập số tiền khách đưa</div>' +
            '<div class="custom-denom-body">' +
                '<input type="number" id="customDenomInput" class="custom-denom-input" placeholder="0" min="0" step="1000" inputmode="numeric">' +
                
            '</div>' +
            '<div class="custom-denom-footer">' +
                '<button class="denom-cancel-btn" onclick="closeCustomDenomInput()">Hủy</button>' +
                '<button class="denom-confirm-btn" onclick="confirmTakeawayCustomDenom()">Xác nhận</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);

    // Focus vào input
    setTimeout(function() {
        var input = document.getElementById('customDenomInput');
        if (input) input.focus();
    }, 100);

    // Enter để xác nhận
    setTimeout(function() {
        var input = document.getElementById('customDenomInput');
        if (input) {
            input.onkeydown = function(e) {
                if (e.key === 'Enter') {
                    confirmTakeawayCustomDenom();
                }
            };
        }
    }, 200);
}

function confirmTakeawayCustomDenom() {
    var input = document.getElementById('customDenomInput');
    if (!input) return;
    var amount = parseInt(input.value);
    if (!amount || amount <= 0) {
        showToast('❌ Vui lòng nhập số tiền hợp lệ', 'error');
        return;
    }
    closeCustomDenomInput();
    takeawayCashPayWithDenom(amount);
}

// ========== XỬ LÝ THANH TOÁN MANG ĐI ==========
function handleTakeawayPayment(method) {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    
    if (method === 'cash') {
        // Tiền mặt: ẩn toast tiền dư (nếu có) rồi thanh toán luôn
        _hideTakeawayChangeToast();
    }
    
    // FIX: Nếu đã qua _takeawayChangeToastPay (tiền dư đã được lưu), bỏ qua kiểm tra credit
    // để tránh trừ credit 2 lần
    if (!_skipOrderCreditCheck && selectedCustomer && (selectedCustomer.creditBalance || 0) > 0) {
        var creditBalance = selectedCustomer.creditBalance || 0;
        var total = tempOrder.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
        if (creditBalance > 0 && total > 0) {
            if (confirm('💰 ' + selectedCustomer.name + ' có ' + formatMoney(creditBalance) + ' tiền dư.\nDùng số dư này để thanh toán?')) {
                // Sẽ xử lý credit trong _processTakeawayDirect
                _processTakeawayDirect(method);
                return;
            }
        }
    }
    
    _processTakeawayDirect(method);
}

// OPTIMIZE: _processTakeawayDirect - đóng modal ngay, song song hóa Promise, batch ingredients
// FIX: Dùng items (đã clone) thay vì tempOrder cho _checkAndDeductIngredients
// vì closeModal có thể clear tempOrder
function _processTakeawayDirect(method) {
    if (!tempOrder.length) return;
    
    // OPTIMIZE: Clone items TRƯỚC khi đóng modal (vì closeModal có thể clear tempOrder)
    var items = _cloneArr(tempOrder);
    var total = items.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
    var now = new Date();
    
    // OPTIMIZE: Đóng modal ngay lập tức
    closeModal('orderModal');
    _paymentToastId = showToast('⏳ Đang xử lý thanh toán...', 'info', 0);
    
    // OPTIMIZE: Suppress realtime notifications trong quá trình batch operations
    DB.suppressRealtime();
    
    // FIX: Kiểm tra credit của khách - chỉ kiểm tra nếu chưa qua _takeawayChangeToastPay
    // (vì _takeawayChangeToastPay đã lưu tiền dư và set _skipOrderCreditCheck = true)
    var creditUsed = 0;
    var customerInfo = selectedCustomer ? { id: selectedCustomer.id, name: selectedCustomer.name } : null;
    
    if (!_skipOrderCreditCheck && selectedCustomer && (selectedCustomer.creditBalance || 0) > 0) {
        creditUsed = Math.min(selectedCustomer.creditBalance || 0, total);
        if (creditUsed > 0) {
            total = total - creditUsed;
        }
    }
    // Reset flag sau khi đã xử lý
    _skipOrderCreditCheck = false;
    
    // OPTIMIZE: Dùng _checkAndDeductIngredients thay vì inline
    // FIX: Dùng items (đã clone) thay vì tempOrder
    var stockAndDeductPromise = _checkAndDeductIngredients(items).then(function() {
        return true;
    }).catch(function(err) {
        showToast('⚠️ ' + (err.message || 'Hết nguyên liệu'), 'error');
        return false;
    });
    
    stockAndDeductPromise.then(function(result) {
        if (!result) {
            hideToast(_paymentToastId);
            DB.flushRealtime();
            return;
        }
        
        // OPTIMIZE: Chạy song song credit + addHistory
        var creditPromise = Promise.resolve();
        if (creditUsed > 0 && selectedCustomer) {
            creditPromise = useCustomerCredit(selectedCustomer.id, creditUsed, 'Trừ tiền dư khi mua mang đi');
        }
        
        var historyPromise = addHistory({
            type: 'takeaway',
            amount: total,
            paymentMethod: method,
            items: items,
            customer: customerInfo,
            tableName: null,
            note: 'Mang đi - ' + (method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản') + (creditUsed > 0 ? ' (dùng ' + formatMoney(creditUsed) + ' tiền dư)' : ''),
            createdAt: now.toISOString(),
            dateKey: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
        });
        
        // FIX: Đồng bộ dateKey trong DB.create - normalizeIndexedFields sẽ tính lại dateKey theo local time
        // Nhưng createdAt vẫn là ISO string (UTC) - cần đảm bảo dateKey đúng local time
        // DB.create sẽ gọi saveToLocal -> normalizeIndexedFields -> toDateKey dùng getFullYear/getMonth/getDate (local)
        
        // OPTIMIZE: Chạy song song creditPromise + historyPromise
        Promise.all([creditPromise, historyPromise]).then(function() {
            // OPTIMIZE: Flush realtime sau khi tất cả operations hoàn tất
            DB.flushRealtime();
            
            // AUDIT: Nếu thanh toán tiền mặt, kiểm tra két
            // handleCashPayment luôn tồn tại (định nghĩa trong pos.html)
            if (method === 'cash') {
                handleCashPayment(total, null, {type: 'takeaway', tableName: null, customer: customerInfo}).catch(function(err) {
                    console.error('[AUDIT] handleCashPayment lỗi:', err);
                });
            }
            
            // Gửi thông báo Telegram giao dịch (cho tất cả phương thức)
            if (typeof notifyPaymentToTelegram === 'function') {
                notifyPaymentToTelegram({
                    type: 'takeaway',
                    amount: total,
                    paymentMethod: method,
                    items: items,
                    tableName: null,
                    customer: customerInfo,
                    createdAt: now.toISOString()
                });
            }
            
            // Xóa draft (fire-and-forget)
            if (currentDraftId) {
                deleteDraft(currentDraftId);
            }
            
            tempOrder = [];
            selectedCustomer = null;
            currentDraftId = null;
            
            hideToast(_paymentToastId);
            var msg = '✅ Đã thanh toán đơn mang đi thành công';
            if (creditUsed > 0) msg += ' (đã dùng ' + formatMoney(creditUsed) + ' tiền dư)';
            showToast(msg, 'success');
            if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
            // Cập nhật doanh thu pos-cash-info realtime
            _dispatchPosCashUpdate();
        }).catch(function(err) {
            hideToast(_paymentToastId);
            DB.flushRealtime();
            showToast(err.message || 'Lỗi khi thanh toán!', 'error');
        });
    }).catch(function(err) {
        hideToast(_paymentToastId);
        DB.flushRealtime();
        showToast('❌ Lỗi xử lý nguyên liệu: ' + (err.message || err), 'error');
    });
}

// ========== HIỂN THỊ SỐ TIỀN DƯ KHI CHỌN MỆNH GIÁ (MANG ĐI) ==========
// Click nút mệnh giá → chỉ toast số tiền dư cần trả, KHÔNG thanh toán
// Click TM hoặc nút trong toast → thanh toán và ẩn toast
// Click ✕ → đóng toast (đổi PTTT)
function takeawayCashPayWithDenom(givenAmount) {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    var total = tempOrder.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
    if (givenAmount < total) {
        showToast('❌ Số tiền ' + formatMoney(givenAmount) + ' không đủ!', 'error');
        return;
    }
    var change = givenAmount - total;
    // Xóa toast cũ nếu có
    _hideTakeawayChangeToast();
    // Lưu givenAmount
    _takeawayChangeGivenAmount = givenAmount;
    
    // Kiểm tra nếu có chọn khách hàng và có tiền dư
    var creditNote = '';
    if (change > 0 && selectedCustomer) {
        creditNote = '<div style="font-size:12px;color:#d97706;margin-top:6px;">💡 ' + selectedCustomer.name + ' có ' + formatMoney(change) + ' tiền dư sẽ được lưu làm tiền trả trước</div>';
    }
    
    // Tạo toast đặc biệt to, nổi bật
    var toast = document.createElement('div');
    toast.className = 'change-toast';
    toast.id = 'changeToast';
    toast.innerHTML =
        '<div class="change-label">💵 TIỀN DƯ</div>' +
        '<div class="change-given">Khách đưa: ' + formatMoney(givenAmount) + '</div>' +
        '<div class="change-amount">' + formatMoney(change) + '</div>' +
        creditNote +
        '<div style="display:flex;gap:8px;margin-top:10px;">' +
            '<button onclick="_takeawayChangeToastPay()" style="flex:1;padding:10px;border-radius:40px;border:none;background:#f97316;color:#fff;font-weight:700;font-size:14px;cursor:pointer;-webkit-appearance:none;">✅ Thanh toán</button>' +
            '<button onclick="_hideTakeawayChangeToast()" style="padding:10px 16px;border-radius:40px;border:none;background:#475569;color:#fff;font-size:13px;cursor:pointer;-webkit-appearance:none;">✕</button>' +
        '</div>';
    document.body.appendChild(toast);
    _takeawayChangeToastEl = toast;
}

function _takeawayChangeToastPay() {
    var givenAmount = _takeawayChangeGivenAmount;
    _hideTakeawayChangeToast();
    
    // Nếu có chọn khách và tiền dư > 0, lưu credit trước
    if (tempOrder.length && selectedCustomer) {
        var total = tempOrder.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
        var change = givenAmount - total;
        if (change > 0) {
            addCustomerCredit(selectedCustomer.id, change, 'Trả dư khi mua mang đi').then(function() {
                showToast('💰 Đã lưu ' + formatMoney(change) + ' tiền dư cho ' + selectedCustomer.name, 'success');
                // FIX: Đánh dấu đã qua _takeawayChangeToastPay để handleTakeawayPayment
                // và _processTakeawayDirect không kiểm tra credit thêm lần nữa
                _skipOrderCreditCheck = true;
                handleTakeawayPayment('cash');
            });
            return;
        }
    }
    handleTakeawayPayment('cash');
}

function _hideTakeawayChangeToast() {
    if (_takeawayChangeToastEl) {
        if (_takeawayChangeToastEl.parentNode) _takeawayChangeToastEl.remove();
        _takeawayChangeToastEl = null;
    }
    _takeawayChangeGivenAmount = 0;
}

// OPTIMIZE: handleGrabOrder - đóng modal ngay, song song hóa Promise, batch ingredients
function handleGrabOrder() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    
    // OPTIMIZE: Clone items TRƯỚC khi đóng modal (vì closeModal có thể clear tempOrder)
    var items = _cloneArr(tempOrder);
    var total = items.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
    var now = new Date();
    
    // OPTIMIZE: Đóng modal ngay lập tức
    closeModal('orderModal');
    _paymentToastId = showToast('⏳ Đang xử lý đơn Grab...', 'info', 0);
    
    // OPTIMIZE: Suppress realtime notifications trong quá trình batch operations
    DB.suppressRealtime();
    
    // OPTIMIZE: Dùng _checkAndDeductIngredients thay vì inline
    // FIX: Dùng items (đã clone) thay vì tempOrder
    var stockAndDeductPromise = _checkAndDeductIngredients(items).then(function() {
        return true;
    }).catch(function(err) {
        showToast('⚠️ ' + (err.message || 'Hết nguyên liệu'), 'error');
        return false;
    });
    
    stockAndDeductPromise.then(function(result) {
        if (!result) {
            hideToast(_paymentToastId);
            DB.flushRealtime();
            return;
        }
        
        addHistory({
            type: 'grab',
            amount: total,
            paymentMethod: 'grab',
            items: items,
            customer: null,
            tableName: null,
            note: 'Đơn Grab',
            createdAt: now.toISOString(),
            dateKey: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
        }).then(function() {
            // OPTIMIZE: Flush realtime sau khi tất cả operations hoàn tất
            DB.flushRealtime();
            
            // Gửi thông báo Telegram giao dịch Grab
            if (typeof notifyPaymentToTelegram === 'function') {
                notifyPaymentToTelegram({
                    type: 'grab',
                    amount: total,
                    paymentMethod: 'grab',
                    items: items,
                    tableName: null,
                    customer: null,
                    createdAt: now.toISOString()
                });
            }
            
            // Xóa draft (fire-and-forget)
            if (currentDraftId) {
                deleteDraft(currentDraftId);
            }
            
            tempOrder = [];
            selectedCustomer = null;
            currentDraftId = null;
            
            hideToast(_paymentToastId);
            showToast('✅ Đã tạo đơn Grab thành công', 'success');
            if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
            // Cập nhật doanh thu pos-cash-info realtime
            _dispatchPosCashUpdate();
        }).catch(function(err) {
            hideToast(_paymentToastId);
            DB.flushRealtime();
            showToast(err.message || 'Lỗi khi tạo đơn Grab!', 'error');
        });
    }).catch(function(err) {
        hideToast(_paymentToastId);
        DB.flushRealtime();
        showToast('❌ Lỗi xử lý nguyên liệu: ' + (err.message || err), 'error');
    });
}

// OPTIMIZE: handleDebtOrder - đóng modal ngay, song song hóa Promise, batch ingredients
function handleDebtOrder() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    
    // OPTIMIZE: Clone items TRƯỚC khi đóng modal (vì closeModal có thể clear tempOrder)
    var items = _cloneArr(tempOrder);
    var total = items.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
    var now = new Date();
    
    // OPTIMIZE: Đóng modal ngay lập tức
    closeModal('orderModal');
    _paymentToastId = showToast('⏳ Đang xử lý ghi nợ...', 'info', 0);
    
    // OPTIMIZE: Suppress realtime notifications trong quá trình batch operations
    DB.suppressRealtime();
    
    // Hiển thị modal chọn khách hàng
    showCustomerSelector(function(customer) {
        if (!customer) {
            hideToast(_paymentToastId);
            DB.flushRealtime();
            showToast('Cần chọn khách hàng để ghi nợ!', 'warning');
            return;
        }
        var debtAmount = total;
        var creditUsed = 0;
        var debtNote = 'Ghi nợ - ' + customer.name;
        
        // OPTIMIZE: Dùng _checkAndDeductIngredients thay vì inline
        // FIX: Dùng items (đã clone) thay vì tempOrder
        var stockAndDeductPromise = _checkAndDeductIngredients(items).then(function() {
            return true;
        }).catch(function(err) {
            showToast('⚠️ ' + (err.message || 'Hết nguyên liệu'), 'error');
            return false;
        });
        
        stockAndDeductPromise.then(function(result) {
            if (!result) {
                hideToast(_paymentToastId);
                DB.flushRealtime();
                return;
            }
            
            // OPTIMIZE: Pre-calculate debtAmount và creditUsed từ memory cache
            // để chạy song song addCustomerDebt + addHistory thay vì tuần tự
            var creditBalance = customer.creditBalance || 0;
            var preCreditUsed = Math.min(creditBalance, total);
            var preDebtAmount = total - preCreditUsed;
            
            // Chạy song song addCustomerDebt và addHistory
            var debtPromise = addCustomerDebt(customer.id, total, 'Mua hàng tại quầy', items);
            var historyPromise = addHistory({
                type: 'debt_payment',
                amount: preDebtAmount,
                paymentMethod: 'debt',
                items: items,
                customer: { id: customer.id, name: customer.name },
                tableName: null,
                note: debtNote + (preCreditUsed > 0 ? ' (đã dùng ' + formatMoney(preCreditUsed) + ' tiền dư)' : ''),
                createdAt: now.toISOString(),
                dateKey: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0')
            });
            
            return Promise.all([debtPromise, historyPromise]).then(function(results) {
                // Lấy kết quả thực tế từ addCustomerDebt (để đảm bảo chính xác)
                var debtResult = results[0];
                debtAmount = debtResult.debtAmount;
                creditUsed = debtResult.creditUsed;
            });
        }).then(function() {
            // OPTIMIZE: Flush realtime sau khi tất cả operations hoàn tất
            DB.flushRealtime();
            
            // Gửi thông báo Telegram giao dịch ghi nợ
            // FIX: Sửa type từ 'takeaway' thành 'debt_payment' để phân biệt với thanh toán mang đi
            if (typeof notifyPaymentToTelegram === 'function') {
                notifyPaymentToTelegram({
                    type: 'debt_payment',
                    amount: debtAmount,
                    paymentMethod: 'debt',
                    items: items,
                    tableName: null,
                    customer: { id: customer.id, name: customer.name },
                    createdAt: now.toISOString()
                });
            }
            
            // Xóa draft (fire-and-forget)
            if (currentDraftId) {
                deleteDraft(currentDraftId);
            }
            
            tempOrder = [];
            selectedCustomer = null;
            currentDraftId = null;
            
            hideToast(_paymentToastId);
            var msg = '✅ Đã ghi nợ ' + formatMoney(debtAmount) + ' cho ' + customer.name;
            if (creditUsed > 0) msg += ' (đã trừ ' + formatMoney(creditUsed) + ' tiền dư)';
            showToast(msg, 'success');
            if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
            if (typeof renderCustomerList === 'function') renderCustomerList();
            // Cập nhật doanh thu pos-cash-info realtime
            _dispatchPosCashUpdate();
        }).catch(function(err) {
            hideToast(_paymentToastId);
            DB.flushRealtime();
            showToast(err.message || 'Lỗi khi ghi nợ!', 'error');
        });
    });
}

// ========== TẠO MÓN NHANH (QUICK CREATE MENU ITEM) ==========
function showQuickCreateMenuItem() {
    var oldOverlay = document.getElementById('quickCreateOverlay');
    if (oldOverlay) oldOverlay.remove();

    // Lấy danh sách danh mục từ window.menuCategories
    var cats = window.menuCategories || [];
    var catOptions = '';
    for (var i = 0; i < cats.length; i++) {
        var c = cats[i];
        catOptions += '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + '</option>';
    }

    var overlay = document.createElement('div');
    overlay.id = 'quickCreateOverlay';
    overlay.className = 'quick-create-overlay';
    // Click overlay = đóng popup, tránh cảm giác lag
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeQuickCreateMenuItem();
    });
    overlay.innerHTML =
        '<div class="quick-create-modal">' +
            '<div class="quick-create-header">➕ Tạo món nhanh</div>' +
            '<div class="quick-create-body">' +
                '<div class="quick-create-field">' +
                    '<label>Tên món</label>' +
                    '<input type="text" id="quickCreateName" class="form-input" placeholder="Nhập tên món..." autocomplete="off">' +
                '</div>' +
                '<div class="quick-create-field">' +
                    '<label>Danh mục</label>' +
                    '<select id="quickCreateCategory" class="form-input">' +
                        catOptions +
                    '</select>' +
                '</div>' +
                '<div class="quick-create-field">' +
                    '<label>Giá bán</label>' +
                    '<input type="number" id="quickCreatePrice" class="form-input" placeholder="0" min="0" step="1000" inputmode="numeric">' +
                '</div>' +
            '</div>' +
            '<div class="quick-create-footer">' +
                '<button class="quick-create-cancel-btn" onclick="closeQuickCreateMenuItem()">Hủy</button>' +
                '<button class="quick-create-confirm-btn" onclick="confirmQuickCreateMenuItem()">Tạo món</button>' +
            '</div>' +
        '</div>';
    document.body.appendChild(overlay);

    // Focus vào ô tên
    setTimeout(function() {
        var nameInput = document.getElementById('quickCreateName');
        if (nameInput) nameInput.focus();
    }, 200);

    // Enter để submit
    var priceInput = document.getElementById('quickCreatePrice');
    if (priceInput) {
        priceInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                confirmQuickCreateMenuItem();
            }
        });
    }
    var nameInput2 = document.getElementById('quickCreateName');
    if (nameInput2) {
        nameInput2.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var priceInput2 = document.getElementById('quickCreatePrice');
                if (priceInput2) priceInput2.focus();
            }
        });
    }
}

function closeQuickCreateMenuItem() {
    var overlay = document.getElementById('quickCreateOverlay');
    if (overlay) overlay.remove();
}

function confirmQuickCreateMenuItem() {
    var nameInput = document.getElementById('quickCreateName');
    var catSelect = document.getElementById('quickCreateCategory');
    var priceInput = document.getElementById('quickCreatePrice');

    if (!nameInput || !catSelect || !priceInput) return;

    var name = nameInput.value.trim();
    var categoryId = catSelect.value;
    var price = parseInt(priceInput.value);

    if (!name) {
        showToast('❌ Vui lòng nhập tên món', 'error');
        nameInput.focus();
        return;
    }
    if (!categoryId) {
        showToast('❌ Vui lòng chọn danh mục', 'error');
        return;
    }
    if (!price || price <= 0) {
        showToast('❌ Vui lòng nhập giá bán hợp lệ', 'error');
        priceInput.focus();
        return;
    }

    // Tìm sortOrder cao nhất để thêm món mới xuống cuối
    var maxSort = 0;
    for (var i = 0; i < menuItems.length; i++) {
        var s = menuItems[i].sortOrder || 0;
        if (s > maxSort) maxSort = s;
    }

    var newItem = {
        name: name,
        categoryId: categoryId,
        price: price,
        sortOrder: maxSort + 1,
        hasVariants: false,
        createdAt: new Date().toISOString()
    };

    closeQuickCreateMenuItem();
    showToast('⏳ Đang tạo món...', 'warning');

    DB.create('menu', newItem).then(function(saved) {
        showToast('✅ Đã tạo món "' + name + '"', 'success');
        // Menu sẽ tự cập nhật qua realtime subscription
    }).catch(function(err) {
        console.error('Lỗi tạo món:', err);
        showToast('❌ Lỗi tạo món: ' + (err.message || 'unknown'), 'error');
    });
}

// ========== SWIPE TO DELETE CHO CART ITEM ==========
function _initCartSwipe() {
    var rows = document.querySelectorAll('.cart-item-row');
    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        // Xóa event cũ để tránh dup
        row.removeEventListener('touchstart', _swipeHandler);
        row.removeEventListener('touchmove', _swipeHandler);
        row.removeEventListener('touchend', _swipeHandler);
        row.removeEventListener('touchcancel', _swipeHandler);
        // Gắn handler mới
        row.addEventListener('touchstart', _swipeHandler);
        row.addEventListener('touchmove', _swipeHandler);
        row.addEventListener('touchend', _swipeHandler);
        row.addEventListener('touchcancel', _swipeHandler);
    }
}

function _swipeHandler(e) {
    var row = e.currentTarget;
    if (e.type === 'touchstart') {
        row._swipeStartX = e.touches[0].clientX;
        row._swipeStartY = e.touches[0].clientY;
        row._swipeDeltaX = 0;
        row._swipeActive = true;
        return;
    }
    if (!row._swipeActive) return;
    
    if (e.type === 'touchmove') {
        var dx = e.touches[0].clientX - row._swipeStartX;
        var dy = e.touches[0].clientY - row._swipeStartY;
        // Chỉ swipe ngang, bỏ qua nếu vuốt dọc nhiều
        if (Math.abs(dy) > Math.abs(dx) * 2) {
            row._swipeActive = false;
            row.classList.remove('swiping');
            return;
        }
        row._swipeDeltaX = dx;
        if (dx < -20) {
            row.classList.add('swiping');
        } else {
            row.classList.remove('swiping');
        }
        return;
    }
    
    // touchend / touchcancel
    row._swipeActive = false;
    if (row._swipeDeltaX < -60) {
        // Vuốt đủ xa -> xoá món
        var idx = parseInt(row.getAttribute('data-idx'));
        if (!isNaN(idx)) {
            removeFromCart(idx);
        }
    } else {
        row.classList.remove('swiping');
    }
}
// ========== EXPORT GLOBAL ==========
window.addToCart = addToCart;
window.addToCartWithVariant = addToCartWithVariant;
window.removeFromCart = removeFromCart;
window.updateCartQty = updateCartQty;
window.renderMenuByCategory = renderMenuByCategory;
window.handleAddToExistingTable = handleAddToExistingTable;
window.handleCreateNewTable = handleCreateNewTable;
window.handleTakeawayPayment = handleTakeawayPayment;
window.handleGrabOrder = handleGrabOrder;
window.handleDebtOrder = handleDebtOrder;
window.toggleReorderMode = toggleReorderMode;
window.toggleCategoryReorderMode = toggleCategoryReorderMode;
// OPTIMIZE: Export _checkAndDeductIngredients để tables.js có thể dùng chung
window._checkAndDeductIngredients = _checkAndDeductIngredients;
// OPTIMIZE: Export _initMenuEventDelegation để pos-app.js có thể gọi khi khởi tạo
window._initMenuEventDelegation = _initMenuEventDelegation;
// Export tạo món nhanh
window.showQuickCreateMenuItem = showQuickCreateMenuItem;
window.closeQuickCreateMenuItem = closeQuickCreateMenuItem;
window.confirmQuickCreateMenuItem = confirmQuickCreateMenuItem;
// Export takeaway helpers (dùng trong inline onclick)
window.takeawayCashPayWithDenom = takeawayCashPayWithDenom;
window._takeawayChangeToastPay = _takeawayChangeToastPay;
window._hideTakeawayChangeToast = _hideTakeawayChangeToast;
window.showTakeawayCustomDenomInput = showTakeawayCustomDenomInput;
window.confirmTakeawayCustomDenom = confirmTakeawayCustomDenom;
window.renderCartColumn = renderCartColumn;