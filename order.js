// order.js - Tạo đơn hàng, thêm món, giỏ hàng
// BỐ CỤC 3 CỘT: Danh mục | Menu | Giỏ hàng

// ========== QUYẾT ĐỊNH DÙNG TIỀN DƯ (đơn mang đi) ==========
// Flag _skipOrderCreditCheck cũ được tạo để chặn việc trừ tiền dư 2 lần nhưng
// KHÔNG BAO GIỜ được gán true (giống hệt bug _skipCreditCheck ở tab Bàn).
// Hậu quả thực tế:
//  - Bấm mệnh giá -> toast tiền dư -> thanh toán: trừ tiền dư 2 lần.
//  - Bấm "Không" ở câu hỏi dùng tiền dư: vẫn bị trừ (vì _processTakeawayDirect
//    tự tính lại không cần cờ).
// Nay chỉ còn MỘT chỗ tính + trừ: _processTakeawayDirect().
// handleTakeawayPayment() chỉ ghi lại quyết định của người dùng vào biến này.
var _useTakeawayCreditApproved = false;

// Helper: Dispatch event để settings.js reload doanh thu pos-cash-info
// Được gọi sau khi thanh toán thành công để cập nhật realtime trên cùng máy
// LƯU Ý: không khai báo lại ở đây - bản trong tables.js giống hệt và load sau.
// Khai báo trùng ở đây chỉ gây nhiễu khi tìm code.

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
// LƯU Ý: openAddMenuForTable còn được định nghĩa trong tables.js và BẢN ĐÓ THẮNG
// (tables.js load sau order.js trong index.html). Bản ở tables.js có thêm:
// xác nhận ở màn hình dọc, chặn thêm món vào bàn đã khóa, và reset currentDraftId.
// Giữ lại bản này chỉ để phòng khi file này dùng độc lập (mangdi.html / takeaway.html).

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

// ========== CACHE HTML MENU (modal đơn - tab Bàn) ==========
// ĐỔI TÊN từ _menuHtmlCache sang _orderMenuHtmlCache.
// Trước đây order.js và pos-app.js cùng dùng MỘT biến `_menuHtmlCache` cho hai
// mục đích khác nhau:
//   - pos-app.js: cache menu tab MANG ĐI, key = "<danh mục>|<từ khoá tìm>"
//   - order.js   : cache menu modal đơn,   key = "<danh mục>_<số món>_<sắp xếp>"
// order.js load sau nên `var _menuHtmlCache = {}` xoá sạch cache mang đi mỗi lần
// load trang, và mọi lần gọi _invalidateMenuCache() cũng xoá nhầm cache modal đơn.
// Nay tách riêng, mỗi bên tự quản lý.
var _orderMenuHtmlCache = {};
// Giới hạn số entry cache để tránh phình bộ nhớ.
// Key nay chứa chữ ký của toàn bộ danh sách món nên 1 lần đổi giá là sinh key mới;
// nếu không giới hạn, cache sẽ phình theo số lần sửa menu.
var _ORDER_MENU_CACHE_MAX = 10;
function _trimOrderMenuHtmlCache() {
    var keys = Object.keys(_orderMenuHtmlCache);
    if (keys.length <= _ORDER_MENU_CACHE_MAX) return;
    var toRemove = keys.length - _ORDER_MENU_CACHE_MAX;
    for (var i = 0; i < keys.length && toRemove > 0; i++) {
        delete _orderMenuHtmlCache[keys[i]];
        toRemove--;
    }
}
// Xoá cache modal đơn khi dữ liệu menu thay đổi (giá/tên/thêm/xoá món).
// realtime-pos.js gọi hàm này khi nhận menu mới từ Firebase.
function _invalidateOrderMenuCache() {
    _orderMenuHtmlCache = {};
    _currentRenderedCategory = null;
}
// OPTIMIZE: Cache DOM reference cho menuGrid container
// Có _getOrderMenuContainer() kiểm tra container còn sống trước khi dùng.
var _menuGridContainer = null;

// FIX container cache: trước đây _menuGridContainer được cache 1 lần rồi dùng vĩnh
// viễn. Nếu element bị thay thế (một số luồng dựng lại modal, hoặc tab khác dùng
// chung id) thì cache trỏ tới node cũ đã gỡ khỏi DOM -> mọi lần render im lặng
// không làm gì, modal mở ra trống mà không có lỗi nào hiện ra.
function _getOrderMenuContainer() {
    var container = _menuGridContainer;
    if (container && container.ownerDocument && container.ownerDocument.contains
        && container.ownerDocument.contains(container)) {
        return container;
    }
    container = document.getElementById('menuGrid');
    _menuGridContainer = container;
    return container;
}
// OPTIMIZE: Biến lưu category đang hiển thị để event delegation biết
var _currentRenderedCategory = null;

// _removeAccents: KHÔNG khai báo lại ở đây.
// Nguồn duy nhất là customers.js (load thứ 10, thắng bản ở đây vì order.js load
// thứ 7). Bản cũ ở order.js dùng bảng map và giữ nguyên chữ hoa chữ thường, còn
// bản customers.js chuẩn hoá về chữ thường + bỏ ký tự đặc biệt -> hành vi tìm
// kiếm khác nhau giữa 2 nơi dùng cùng tên hàm. Nay gộp về customers.js.
// Lưu ý: chỉ gọi sau khi .toLowerCase() nếu cần so khớp không phân biệt hoa thường.

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
    
    var container = _getOrderMenuContainer();
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
        return;
    }
    
    // OPTIMIZE: Kiểm tra cache HTML để tránh rebuild
    //
    // FIX 1: bao gồm _isReorderMode trong cache key để tránh hiển thị HTML cũ khi sắp xếp.
    // FIX 2 (quan trọng): cache key cũ chỉ dùng items.length. Nếu admin SỬA GIÁ hoặc
    //   ĐỔI TÊN món mà số lượng món không đổi thì key trùng -> hàm return sớm ở
    //   dưới đây -> màn hình vẫn hiện GIÁ CŨ. Đây là bug người dùng thấy được:
    //   sửa giá trên máy tính, POS vẫn chốt sai giá.
    // Nay cache key dựa trên thứ tự id + giá + tên, nên đổi bất kỳ dữ liệu hiển thị
    // nào cũng sinh key mới.
    var sig = '';
    for (var c = 0; c < items.length; c++) {
        var it0 = items[c];
        sig += it0.id + ':' + (it0.price || 0) + ':' + (it0.name || '');
        if (it0.hasVariants && it0.variants) {
            for (var w = 0; w < it0.variants.length; w++) {
                sig += '|' + it0.variants[w].name + ':' + (it0.variants[w].price || 0);
            }
        }
        sig += ';';
    }
    var cacheKey = categoryId + '#' + sig + '#' + (_isReorderMode ? '1' : '0');
    
    // Chỉ bỏ qua render khi cache khớp VÀ container thực sự đang hiển thị danh mục
    // này. Trước đây điều kiện là `_menuHtmlCache[cacheKey] && _currentRenderedCategory === categoryId`
    // -> nếu modal vừa mở lại (openOrderModal gọi renderMenuByCategory('all')) mà
    // _currentRenderedCategory vẫn bằng categoryId từ lần trước, hàm return sớm mà
    // container đang TRỐNG -> modal mở ra không hiện món nào.
    if (_orderMenuHtmlCache[cacheKey] && _currentRenderedCategory === categoryId && container.innerHTML === _orderMenuHtmlCache[cacheKey]) {
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
    }
    // Luôn ghi cache (kể cả khi innerHTML đã khớp) để lần mở modal sau không phải
    // dựng lại chuỗi. Bản cũ chỉ ghi cache bên trong if -> nếu innerHTML đã bằng
    // html thì cache trống, mọi lần sau đều phải dựng lại từ đầu.
    _orderMenuHtmlCache[cacheKey] = html;
    _trimOrderMenuHtmlCache();
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
    // Dùng _getOrderMenuContainer() thay vì getElementById trực tiếp, để nếu
    // container bị thay thế trong DOM thì vẫn thao tác đúng element.
    var container = _getOrderMenuContainer();
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

// Thoát chế độ sắp xếp khi đóng modal đơn.
// Gọi từ closeModal('orderModal') trong pos-app.js.
// Không gọi _syncSortOrderToFirebase() cố ý: nếu người dùng kéo thả xong rồi đóng
// modal, thứ tự mới vẫn nằm trong RAM (menuItems đã sort lại và đã gán sortOrder),
// và lần mở modal sau renderMenuByCategory sẽ hiện đúng thứ tự đó. Nếu gọi sync ở
// đây thì mỗi lần đóng modal đều ghi 1 lần lên Firebase dù không thay đổi gì.
function _resetReorderModeOnClose() {
    _isReorderMode = false;
    _sortOrderChanged = false;
    _cleanupDrag();
    var container = _getOrderMenuContainer();
    if (container && container.classList) {
        container.classList.remove('drag-active');
    }
    if (container) _disableDragReorder(container);
    // Đặt lại nút "🔀 Sắp xếp" về trạng thái ban đầu
    var toggleBtn = document.getElementById('reorderToggleBtn');
    if (toggleBtn) {
        toggleBtn.classList.remove('active');
        toggleBtn.textContent = '🔀 Sắp xếp';
    }
    
    // Thoát luôn chế độ sắp xếp DANH MỤC - cùng lý do: nếu không, lần mở modal
    // sau renderOrderCategoriesColumn() sẽ gắn lại drag listener và các nút
    // bị đóng modal giữa chừng.
    if (typeof _isCategoryReorderMode !== 'undefined') {
        _isCategoryReorderMode = false;
        _catSortOrderChanged = false;
        _catDragState = null;
        var catContainer = document.getElementById('orderCategoriesColumn');
        if (catContainer && catContainer.classList) {
            catContainer.classList.remove('drag-active');
        }
        if (catContainer && typeof _disableCatDragReorder === 'function') {
            _disableCatDragReorder(catContainer);
        }
        var catSortBtn = document.getElementById('catReorderToggleBtn');
        if (catSortBtn) {
            catSortBtn.classList.remove('active');
            catSortBtn.innerHTML = '<span class="cat-icon">🔀</span><span>Sắp xếp DM</span>';
        }
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
    // FIX: xoá cache của riêng modal đơn, không đụng cache tab Mang đi
    _orderMenuHtmlCache = {};
    
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
        // FIX MẤT SWIPE-TO-DELETE: gán innerHTML tạo ra node MỚI, các node mới
        // không có listener touch nào. Trước đây chỉ gọi _initCartSwipe() khi SỐ
        // LƯỢNG món thay đổi, còn lại gọi _updateCartIndices() (chỉ set attribute).
        // Hệ quả: bấm "+" để tăng số lượng (số món không đổi) -> innerHTML được
        // thay bằng node mới -> KHÔNG init lại swipe -> vuốt xoá hết ngừng hoạt
        // động, im lặng không có lỗi.
        // Nay luôn init lại sau khi thay innerHTML. _initCartSwipe() đã tự
        // removeEventListener trước khi add nên gọi lại nhiều lần vẫn an toàn.
        _initCartSwipe();
        _updateCartIndices();
        _cartLastItemCount = tempOrder.length;
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
                // Nút đóng (portrait) - landscape thì ko cần nút phụ
                (_isPortrait()
                    ? '<div class="cart-draft-row">' +
                        '<button class="action-btn btn-close-modal" onclick="closeModal(\'orderModal\')">✕ Đóng</button>' +
                    '</div>'
                    : '')
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
                : '');
    } else {
        html = '<span class="header-action-btn btn-total">' + formatMoney(total) + '</span>' +
            '<button class="header-action-btn btn-table" onclick="handleCreateNewTable()">🍽️ Tạo bàn mới</button>' +
            '<button class="header-action-btn btn-cash" onclick="handleTakeawayPayment(\'cash\')">💰 Tiền mặt</button>' +
            '<button class="header-action-btn btn-transfer" onclick="handleTakeawayPayment(\'transfer\')">💳 Chuyển khoản</button>' +
            '<button class="header-action-btn btn-debt" onclick="handleDebtOrder()">💢 Nợ</button>' +
            (_isPortrait()
                ? '<button class="header-action-btn btn-close-modal" onclick="closeModal(\'orderModal\')">✕ Đóng</button>'
                : '') +
            '<button class="header-action-btn btn-sort" onclick="toggleReorderMode()" id="reorderToggleBtn">🔀 Sắp xếp</button>';
    }
    headerActions.innerHTML = html;
}

// OPTIMIZE: Cập nhật data-idx cho các row hiện có (khi sắp xếp lại thứ tự)
//
// FIX: trước đây querySelectorAll('.cart-item-row') ở phạm vi TOÀN TRANG.
// pos-app.js:1396 cũng sinh class .cart-item-row cho tab "Mang đi" (dùng
// _takeawayCart riêng), nên hàm này:
//   1) gán data-idx sai cho các row của tab mang đi
//   2) GHI ĐÈ handler _takeawayUpdateQty(i, ±1) bằng updateCartQty(r, ±1)
//      -> nút +/- của tab mang đi bắt đầu sửa tempOrder của modal đơn.
// Nay chỉ query trong container của giỏ trong modal đơn.
function _updateCartIndices() {
    var container = _getCartDom ? _getCartDom() : null;
    if (!container || !container.querySelectorAll) return;
    var rows = container.querySelectorAll('.cart-item-row');
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
    
    // Không toast khi thêm món: giỏ hàng đã cập nhật trực quan (món mới nhảy lên
    // đầu danh sách). Toast chỉ hiện 1 cái và không tự tắt nên toast "✓ tên món"
    // sẽ dính lại mỗi lần thêm, gây nhiễu màn hình.
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
    
    // Không toast khi thêm món (xem giải thích ở addToCart)
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
// FIX Phase 1: _checkAndDeductIngredients - KHÔNG reject, luôn resolve thành công
// Mọi lỗi DB.update hoặc log đều được catch và log, không ảnh hưởng đến giao dịch
// Wrapper quanh deductIngredients() của ingredients.js.
//
// TRƯỚC ĐÂY order.js:1375 có bản trừ kho riêng, khác ingredients.js:119 ở 3 điểm:
//   1. KHÔNG ghi vào ingredient_transactions -> sổ tồn kho mất một chiều, mọi lần
//      bán đều trừ kho không ghi vết, admin không đối chiếu được tồn thực.
//   2. KHÔNG có idempotency -> bấm 2 lần là trừ 2 lần.
//   3. Nuốt mọi lỗi DB -> không bao giờ biết trừ kho thất bại.
// Nay dùng chung 1 bản duy nhất trong ingredients.js cho mọi luồng.
function _checkAndDeductIngredients(items, idempotencyKey) {
    if (!items || !items.length) return Promise.resolve(true);
    return deductIngredients(items, idempotencyKey).catch(function(err) {
        // Không chặn giao dịch khi lỗi kho (giao dịch đã lưu rồi)
        console.error('[INGREDIENT] Lỗi trừ nguyên liệu:', err);
        return false;
    });
}

// FIX Phase 1: handleCreateNewTable - tách ingredient ra background
function handleCreateNewTable() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    
    // Clone items trước khi clear
    var items = _cloneArr(tempOrder);
    
    // Chống bấm nhiều lần -> tạo trùng 2 bàn cùng tên.
    // Trước đây closeModal() gọi SAU DB.create nên nút vẫn bấm được suốt vòng
    // ghi IndexedDB, và _nextTableNumber đọc cùng 1 cache -> 2 bàn tên giống nhau.
    if (!_lockOrderPayment()) {
        showToast('⏳ Đang xử lý, vui lòng chờ...', 'warning');
        return;
    }
    
    DB.suppressRealtime();
    
    // Lấy danh sách bàn hiện tại từ memory cache
    var allTables = window.cachedTables || [];
    
    // FIX: dùng chung _nextTableNumber/_buildTableName (định nghĩa trong tables.js).
    // Bản cũ dùng parseInt(name.replace(/\D/g,'')) -> "Bàn 1-2" ra 12 (sai),
    // và tên "Bàn 05" cho nextNum = 5 -> "Bàn 5" lệch định dạng so với nơi khác.
    var nextNum = _nextTableNumber(allTables);
    var tableName = _buildTableName(nextNum);
    
    var now = new Date();
    var tableId = Date.now().toString();
    var initTotal = items.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
    var initItems = items.map(function(item) { return { name: item.name, qty: item.qty }; });
    var currentUser = DB.getCurrentUser();
    var newTable = {
        id: tableId,
        name: tableName,
        status: 'occupied',
        time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        startTime: now.toISOString(),
        items: _cloneArr(items),
        total: initTotal,
        // Cờ: kho ĐÃ bị trừ lúc tạo/thêm món vào bàn. Khi thanh toán,
        // tables.js sẽ đọc cờ này và KHÔNG trừ lần nữa (trước đây trừ 2 lần).
        ingredientsDeducted: true,
        customerId: selectedCustomer ? selectedCustomer.id : null,
        customerName: selectedCustomer ? selectedCustomer.name : null,
        recentAdds: [{ items: initItems, time: now.toISOString() }],
        createdByName: (currentUser && currentUser.displayName) || '',
        createdByRole: (currentUser && currentUser.role) || ''
    };
    
    // FIX Phase 1: Chỉ chờ DB.create, ingredient chạy background.
    //
    // FIX 2 lỗi nghiêm trọng:
    // 1) .catch trước đây gọi DB.remove('tables', tableId) cho MỌI lỗi. Nhưng
    //    renderTables() là lệnh ĐỌC UI nằm trong chain và có thể reject
    //    (realtime-pos.js:682 -> DB.getAll). Nếu nó reject, bàn ĐÃ tạo thành công
    //    ở DB.create vẫn bị xoá -> mất bàn ngay sau khi tạo.
    // 2) DB.remove trả promise nhưng không có .catch -> unhandled rejection,
    //    lệnh xoá bù thất bại trong im lặng.
    // Nay: chỉ rollback khi chính DB.create fail. Phần render UI tách ra ngoài.
    var tableCreated = false;
    DB.create('tables', newTable, tableId).then(function() {
        tableCreated = true;
        if (currentDraftId) {
            return deleteDraft(currentDraftId);
        }
    }).then(function() {
        tempOrder = [];
        selectedCustomer = null;
        currentDraftId = null;
        closeModal('orderModal');
        DB.flushRealtime();
        _releaseOrderPayment();
    }).catch(function(err) {
        if (!tableCreated) {
            // Chỉ rollback khi bàn thật sự chưa tạo được
            DB.remove('tables', tableId).catch(function(rmErr) {
                console.error('[ORDER] Không xoá được bàn tạo lỗi:', rmErr);
            });
        }
        DB.flushRealtime();
        showToast(err.message || 'Lỗi!', 'error');
        _releaseOrderPayment();
    });
    
    // Render bàn + highlight SAU khi chuỗi ghi đã xong, để lỗi UI không
    // kéo theo việc xoá nhầm dữ liệu.
    setTimeout(function() {
        Promise.resolve(renderTables()).then(function() {
            var card = document.querySelector('.table-card[data-id="' + tableId + '"]');
            if (card) card.classList.add('table-new');
        }).catch(function() {});
    }, 0);
    
    // FIX Phase 1: Ingredient deduction chạy background.
    // Chỉ trừ sau khi bàn đã tạo thành công (trước đây trừ cả khi DB.create fail).
    setTimeout(function() {
        if (!tableCreated) return;
        _checkAndDeductIngredients(items).then(function() {
            console.log('[INGREDIENT] Đã trừ nguyên liệu cho bàn mới:', tableName);
        }).catch(function() {});
    }, 0);
}

// ========== XỬ LÝ THÊM VÀO BÀN HIỆN TẠI ==========
// FIX Phase 1: handleAddToExistingTable - tách ingredient ra background
function handleAddToExistingTable() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    if (!currentAddToTableId) {
        showToast('Không xác định bàn đích!', 'error');
        return;
    }
    // Chống bấm nhiều lần -> ghi món vào bàn 2 lần
    if (!_lockOrderPayment()) {
        showToast('⏳ Đang xử lý, vui lòng chờ...', 'warning');
        return;
    }
    
    // Clone items trước khi clear
    var items = _cloneArr(tempOrder);
    
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
        // BẮT BUỘC nhả khoá: nếu không, _orderPaymentInFlight còn true thì mọi
        // lần thanh toán tiếp theo ở quầy bị chặn cho tới khi hết timeout 15 giây.
        // Nhánh này rất dễ xảy ra: cachedTables trong RAM có thể chưa có bàn vừa
        // được tạo ở máy khác.
        _releaseOrderPayment();
        return;
    }
    
    // Bàn đã khoá VẪN ĐƯỢC thêm món (yêu cầu nghiệp vụ).
    // Khoá bàn chỉ chặn xoá món / xoá bàn / chia-chuyển-gộp bàn.
    // Không cần kiểm tra isTableLocked ở đây dù modal để lâu và bàn bị khoá ở
    // máy khác: thêm món vẫn phải được phép.

    // ===== GHI BÀN THEO CÁCH AN TOÀN ĐA THIẾT BỊ =====
    //
    // Trước đây: đọc bàn từ RAM của máy này -> nối thêm món -> DB.update ghi
    // đè TOÀN BỘ bản ghi. Hai máy cùng thêm món vào bàn 5 thì cả hai đọc cùng
    // một mảng cũ, cả hai ghi đè, và phần của một máy BỊ MẤT.
    //
    // Nay: DB.addItemsToTable() chạy runTransaction trên chính node bàn. Firebase
    // thực thi transaction tuần tự nên lần thêm của máy luôn thấy món máy
    // kia vừa thêm và cộng vào đó -> không mất món nào.
    //
    // KHÔNG thay đổi cấu trúc dữ liệu: vẫn là `tables/{id}.items`.
    var recentAdds2 = table.recentAdds ? _cloneArr(table.recentAdds) : [];
    var now2 = new Date();
    var addedItems2 = items.map(function(item) { return { name: item.name, qty: item.qty }; });
    recentAdds2.push({ items: addedItems2, time: now2.toISOString() });
    if (recentAdds2.length > 2) recentAdds2.shift();

    var targetTableId = String(currentAddToTableId);

    // recentAdds và cờ đã-trừ-kho cũng phải ghi trong cùng transaction để không
    // lệch với danh sách món.
    var addPromise;
    if (typeof DB.addItemsToTable === 'function') {
        addPromise = DB.addItemsToTable(targetTableId, items).then(function (res) {
            if (!res.ok) {
                var msg = res.reason === 'Ban khong con ton tai tren may chu'
                    ? 'Bàn không còn tồn tại ở máy khác!'
                    : 'Không lưu được bàn, thử lại nhé.';
                showToast('❌ ' + msg, 'error', 3500);
                var e = new Error(res.reason);
                e._tableWriteFailed = true;
                throw e;
            }
            // Ghi nốt recentAdds/cờ trừ kho (ghi thường, không cần nguyên tử vì
            // chỉ là thông tin phụ - mất nó không mất tiền).
            return DB.update('tables', targetTableId, {
                recentAdds: recentAdds2,
                ingredientsDeducted: true
            });
        });
    } else {
        // Fallback: DB chưa có hàm giao dịch nguyên tử -> dùng cách cũ
        var existingItems = table.items ? _cloneArr(table.items) : [];
        for (var i = 0; i < items.length; i++) {
            existingItems.push(_cloneArr([items[i]])[0]);
        }
        var newTotal = existingItems.reduce(function (sum, item) {
            return sum + (item.price * item.qty);
        }, 0);
        addPromise = DB.update('tables', targetTableId, {
            items: existingItems,
            total: newTotal,
            recentAdds: recentAdds2,
            ingredientsDeducted: true
        });
    }

    addPromise.then(function() {
        if (currentDraftId) {
            return deleteDraft(currentDraftId);
        }
    }).then(function() {
        tempOrder = [];
        selectedCustomer = null;
        currentDraftId = null;
        currentAddToTableId = null;
        closeModal('orderModal');
        DB.flushRealtime();
    }).then(function() {
        showToast('✅ Đã thêm món vào bàn', 'success');
        _releaseOrderPayment();
    }).catch(function(err) {
        DB.flushRealtime();
        showToast(err.message || 'Lỗi khi thêm món!', 'error');
        _releaseOrderPayment();
    });
    
    // FIX Phase 1: Ingredient deduction chạy background.
    // Chỉ trừ sau khi DB.update thành công (trước đây nằm ngoài chain nên
    // update fail/mất mạng vẫn trừ kho cho món chưa được thêm vào bàn).
    setTimeout(function() {
        DB.getAll('tables').then(function(all) {
            var found = false;
            for (var t = 0; t < all.length; t++) {
                if (String(all[t].id) === targetTableId) { found = true; break; }
            }
            if (!found) return false;
            return _checkAndDeductIngredients(items);
        }).then(function() {
            console.log('[INGREDIENT] Đã trừ nguyên liệu cho bàn:', table.name);
        }).catch(function() {});
    }, 0);
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

// ========== KHOÁ CHỐNG THANH TOÁN 2 LẦN ==========
// tables.js có _paymentInFlight / _releasePaymentLock nhưng order.js KHÔNG có.
// Thiếu khoá này thì bấm 2 lần "Tiền mặt" (hoặc "Tạo bàn mới", "Ghi nợ") tạo ra
// 2 addHistory + 2 handleCashPayment = mở két 2 lần, ghi doanh thu 2 lần.
// Tự nhả sau 15s như tables.js để nếu một luồng bị treo không khoá vĩnh viễn.
var _orderPaymentInFlight = false;
var _orderPaymentTimer = null;

function _lockOrderPayment() {
    if (_orderPaymentInFlight) return false;
    _orderPaymentInFlight = true;
    if (_orderPaymentTimer) clearTimeout(_orderPaymentTimer);
    _orderPaymentTimer = setTimeout(function() {
        _orderPaymentInFlight = false;
        _orderPaymentTimer = null;
    }, 15000);
    return true;
}

function _releaseOrderPayment() {
    if (_orderPaymentTimer) {
        clearTimeout(_orderPaymentTimer);
        _orderPaymentTimer = null;
    }
    _orderPaymentInFlight = false;
}

// ========== XỬ LÝ THANH TOÁN MANG ĐI ==========
function handleTakeawayPayment(method) {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    
    // Chống bấm nhiều lần -> thanh toán 2 lần
    if (!_lockOrderPayment()) {
        showToast('⏳ Đang xử lý, vui lòng chờ...', 'warning');
        return;
    }
    
    if (method === 'cash') {
        // Tiền mặt: ẩn toast tiền dư (nếu có) rồi thanh toán luôn
        _hideTakeawayChangeToast();
    }
    
    // FIX SAI LOGIC (cùng loại lỗi trừ tiền dư 2 lần đã sửa cho tab Bàn):
    // Bản cũ hỏi "có dùng tiền dư không?" rồi gọi _processTakeawayDirect() với
    // _skipOrderCreditCheck VẪN = false, và _processTakeawayDirect() lại tự tính
    // credit lần nữa. Tệ hơn: nếu người dùng bấm "Không" thì nhánh if rơi xuống
    // _processTakeawayDirect(method) ở dưới -> vẫn bị trừ tiền dư sau khi họ đã
    // từ chối.
    // Nay chỉ ghi nhận quyết định, việc tính + trừ do _processTakeawayDirect lo.
    _useTakeawayCreditApproved = false;
    if (selectedCustomer && (selectedCustomer.prepaidBalance || selectedCustomer.creditBalance || 0) > 0) {
        var bal = selectedCustomer.prepaidBalance || selectedCustomer.creditBalance || 0;
        var sum = tempOrder.reduce(function(s2, item) { return s2 + (item.price * item.qty); }, 0);
        if (sum > 0) {
            if (confirm('💰 ' + selectedCustomer.name + ' có ' + formatMoney(bal) + ' tiền dư.\nDùng số dư này để thanh toán?')) {
                _useTakeawayCreditApproved = true;
            }
        }
    }
    
    _processTakeawayDirect(method);
}

// FIX Phase 1: _processTakeawayDirect - Optimistic UI
// 1. Lưu transaction vào IndexedDB NGAY (không chờ ingredient)
// 2. Ingredient deduction chạy background (fire-and-forget)
// 3. Không block giao dịch dù ingredient có lỗi
function _processTakeawayDirect(method) {
    if (!tempOrder.length) {
        _releaseOrderPayment();
        return;
    }
    
    // Clone items TRƯỚC khi đóng modal (vì closeModal có thể clear tempOrder)
    var items = _cloneArr(tempOrder);
    var total = items.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
    var now = new Date();
    
    // Đóng modal ngay lập tức
    // Bắt currentDraftId TRƯỚC khi closeModal.
    // pos-app.js:908 (closeModal) set currentDraftId = null khi đóng orderModal.
    // Trước đây closeModal chạy trước, rồi mới `if (currentDraftId) deleteDraft(...)`
    // -> nhánh đó KHÔNG BAO GIỜ chạy -> nháp đơn sống dai, mở lại thanh toán 2 lần.
    var draftIdToDelete = currentDraftId;
    closeModal('orderModal');
    var _takeawayToastId = showToast('⏳ Đang xử lý thanh toán...', 'info', 0);
    
    // Suppress realtime notifications trong quá trình batch operations
    DB.suppressRealtime();
    
    // Kiểm tra credit của khách - CHỈ khi người dùng đã đồng ý
    var creditUsed = 0;
    var customerInfo = selectedCustomer ? { id: selectedCustomer.id, name: selectedCustomer.name } : null;
    
    if (_useTakeawayCreditApproved && selectedCustomer) {
        var bal2 = selectedCustomer.prepaidBalance || selectedCustomer.creditBalance || 0;
        if (bal2 > 0) {
            creditUsed = Math.min(bal2, total);
            if (creditUsed > 0) {
                total = total - creditUsed;
            }
        }
    }
    _useTakeawayCreditApproved = false;
    
    // FIX Phase 1: Lưu transaction vào IndexedDB NGAY, ingredient chạy background
    // Bước 1: Lưu history trước (quan trọng nhất - ghi nhận giao dịch)
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
        // FIX: thiếu creditUsed -> history.js:1232 ghi 0 -> khi hoàn tác
        // restoreCustomerCredit(id, 0) hoàn 0đ, KHÁCH MẤT TIỀN DƯ.
        // tables.js:777 và :1121 đã truyền đúng, order.js bị bỏ sót.
        creditUsed: creditUsed
        // createdAt / dateKey cố ý KHÔNG truyền: addHistory tự sinh từ new Date().
        // Trước đây truyền vào nhưng bị addHistory bỏ qua vô ích, riêng dateKey
        // còn dùng String.padStart (ES2017) - WebView Android 6 sẽ ném TypeError
        // ngay sau DB.suppressRealtime() làm kẹt realtime.
    });
    
    // Chạy credit + history song song (cả 2 đều quan trọng cho giao dịch)
    Promise.all([creditPromise, historyPromise]).then(function() {
        DB.flushRealtime();
        
        // AUDIT: Nếu thanh toán tiền mặt, kiểm tra két
        if (method === 'cash') {
            handleCashPayment(total, null, {type: 'takeaway', tableName: null, customer: customerInfo}).catch(function(err) {
                console.error('[AUDIT] handleCashPayment lỗi:', err);
            });
        }
        
        // Gửi thông báo Telegram giao dịch
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
        
        // Xóa draft (fire-and-forget) - dùng id đã bắt trước closeModal
        if (draftIdToDelete) {
            deleteDraft(draftIdToDelete);
        }
        
        tempOrder = [];
        selectedCustomer = null;
        currentDraftId = null;
        
        hideToast(_takeawayToastId);
        var _taker = DB.getCurrentUser();
        showActivityToast('✅', {
            amount: total,
            paymentMethod: method,
            type: 'takeaway',
            tableName: null,
            items: items,
            customer: customerInfo,
            createdByName: _taker ? _taker.displayName : '',
            createdByRole: _taker ? _taker.role : ''
        }, 'success', creditUsed > 0 ? 4500 : 3500);
        if (creditUsed > 0) {
            _setToastExtra('💳 Đã dùng ' + formatMoney(creditUsed) + ' tiền dư của khách');
        }
        if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
        _dispatchPosCashUpdate();
        _releaseOrderPayment();
    }).catch(function(err) {
        hideToast(_takeawayToastId);
        DB.flushRealtime();
        showToast(err.message || 'Lỗi khi thanh toán!', 'error');
        _releaseOrderPayment();
    });
    
    // FIX Phase 1: Ingredient deduction chạy background - KHÔNG block giao dịch.
    // CHỈ trừ khi giao dịch ghi thành công: trước đây setTimeout nằm NGOÀI chain
    // nên khi addHistory fail (mất mạng) vẫn trừ kho cho một giao dịch không tồn tại.
    setTimeout(function() {
        Promise.all([creditPromise, historyPromise]).then(function() {
            return _checkAndDeductIngredients(items);
        }).then(function() {
            console.log('[INGREDIENT] Đã trừ nguyên liệu cho đơn mang đi');
        }).catch(function() {
            // đã báo lỗi ở .catch phía trên
        });
    }, 0);
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
    
    // Tạo toast đặc biệt to, nổi bật - chỉ hiển thị tiền dư trả lại khách
    var toast = document.createElement('div');
    toast.className = 'change-toast';
    toast.id = 'changeToast';
    toast.innerHTML =
        '<div class="change-label">💵 TIỀN DƯ</div>' +
        '<div class="change-given">Khách đưa: ' + formatMoney(givenAmount) + '</div>' +
        '<div class="change-amount">' + formatMoney(change) + '</div>' +
        '<div class="change-return">🔄 Trả lại khách: <strong>' + formatMoney(change) + '</strong></div>' +
        '<div style="display:flex;gap:8px;margin-top:10px;">' +
            '<button onclick="_takeawayChangeToastPay()" style="flex:1;padding:10px;border-radius:40px;border:none;background:#f97316;color:#fff;font-weight:700;font-size:14px;cursor:pointer;-webkit-appearance:none;">✅ Thanh toán</button>' +
            '<button onclick="_hideTakeawayChangeToast()" style="padding:10px 16px;border-radius:40px;border:none;background:#475569;color:#fff;font-size:13px;cursor:pointer;-webkit-appearance:none;">✕</button>' +
        '</div>';
    document.body.appendChild(toast);
    _takeawayChangeToastEl = toast;
}

function _takeawayChangeToastPay() {
    _hideTakeawayChangeToast();
    // Đơn giản: chỉ thanh toán tiền mặt, không lưu tiền dư vào credit
    handleTakeawayPayment('cash');
}

function _hideTakeawayChangeToast() {
    if (_takeawayChangeToastEl) {
        if (_takeawayChangeToastEl.parentNode) _takeawayChangeToastEl.remove();
        _takeawayChangeToastEl = null;
    }
    _takeawayChangeGivenAmount = 0;
}

// FIX Phase 1: handleGrabOrder - Optimistic UI
// Lưu transaction NGAY, ingredient chạy background
function handleGrabOrder() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    // Chống bấm nhiều lần -> tạo 2 đơn Grab
    if (!_lockOrderPayment()) {
        showToast('⏳ Đang xử lý, vui lòng chờ...', 'warning');
        return;
    }
    
    // Clone items TRƯỚC khi đóng modal
    var items = _cloneArr(tempOrder);
    var total = items.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
    var now = new Date();
    
    // Đóng modal ngay lập tức
    var draftIdToDelete = currentDraftId;   // bắt trước closeModal (xem _processTakeawayDirect)
    closeModal('orderModal');
    var _grabToastId = showToast('⏳ Đang xử lý đơn Grab...', 'info', 0);
    
    // Suppress realtime notifications
    DB.suppressRealtime();
    
    // FIX Phase 1: Lưu transaction NGAY, không chờ ingredient
    var grabHistoryPromise = addHistory({
        type: 'grab',
        amount: total,
        paymentMethod: 'grab',
        items: items,
        customer: null,
        tableName: null,
        note: 'Đơn Grab'
        // createdAt / dateKey không truyền: addHistory tự sinh. dateKey còn dùng
        // String.padStart (ES2017) -> nguy hiểm trên WebView Android 6.
    });
    grabHistoryPromise.then(function() {
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
        
        // Xóa draft (fire-and-forget) - dùng id đã bắt trước closeModal
        if (draftIdToDelete) {
            deleteDraft(draftIdToDelete);
        }
        
        tempOrder = [];
        selectedCustomer = null;
        currentDraftId = null;
        
        hideToast(_grabToastId);
        var _grabber = DB.getCurrentUser();
        showActivityToast('✅', {
            amount: total,
            paymentMethod: 'grab',
            type: 'grab',
            tableName: null,
            items: items,
            customer: null,
            createdByName: _grabber ? _grabber.displayName : '',
            createdByRole: _grabber ? _grabber.role : ''
        }, 'success');
        if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
        _dispatchPosCashUpdate();
        _releaseOrderPayment();
    }).catch(function(err) {
        hideToast(_grabToastId);
        DB.flushRealtime();
        showToast(err.message || 'Lỗi khi tạo đơn Grab!', 'error');
        _releaseOrderPayment();
    });
    
    // FIX Phase 1: Ingredient deduction chạy background.
    // CHỈ trừ khi transaction ghi thành công (trước đây nằm ngoài chain nên
    // addHistory fail vẫn trừ kho cho đơn không tồn tại).
    setTimeout(function() {
        grabHistoryPromise.then(function() {
            return _checkAndDeductIngredients(items);
        }).then(function() {
            console.log('[INGREDIENT] Đã trừ nguyên liệu cho đơn Grab');
        }).catch(function() {});
    }, 0);
}

// FIX Phase 1: handleDebtOrder - TUẦN TỰ, không song song
// 1. Lưu history TRƯỚC (tạo id duy nhất)
// 2. Dùng id đó để gọi addCustomerDebt (đảm bảo 1-1)
// 3. Ingredient chạy background
function handleDebtOrder() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    // Chống bấm nhiều lần -> ghi nợ 2 lần
    if (!_lockOrderPayment()) {
        showToast('⏳ Đang xử lý, vui lòng chờ...', 'warning');
        return;
    }
    
    // Clone items TRƯỚC khi đóng modal
    var items = _cloneArr(tempOrder);
    var total = items.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
    var now = new Date();
    
    // Bắt currentDraftId TRƯỚC closeModal (pos-app.js:908 set null khi đóng modal)
    var draftIdToDelete = currentDraftId;
    closeModal('orderModal');
    
    // FIX BUG KẸT SUPPRESS REALTIME (giống tab Bàn):
    // Trước đây DB.suppressRealtime() gọi TRƯỚC showCustomerSelector(). Người dùng
    // bấm ✕ đóng modal -> callback không chạy -> không ai flush -> _suppressRealtime
    // kẹt > 0 vĩnh viễn -> realtime của MỌI collection chết, phải F5 máy.
    // Nay: chỉ suppress quanh vùng ghi DB, sau khi đã chọn được khách.
    showCustomerSelector(function(customer) {
        if (!customer) {
            showToast('Cần chọn khách hàng để ghi nợ!', 'warning');
            // KHÔNG trừ kho ở nhánh này (xem ghi chú gần _checkAndDeductIngredients bên dưới)
            _releaseOrderPayment();
            return;
        }
        // Dùng biến RIÊNG thay vì _paymentToastId (biến chung với tables.js).
        // Toast chỉ 1 slot: nếu 2 luồng chạy song song, hideToast(_paymentToastId)
        // của luồng này sẽ xoá nhầm toast của luồng kia và để lại toast kẹt.
        var _debtToastId = showToast('⏳ Đang xử lý ghi nợ...', 'info', 0);
        var debtAmount = total;
        var creditUsed = 0;
        
        var debtPromise = _withRealtimeSuppressed(function() {
            // addCustomerDebt tự tạo transaction history bên trong
            return addCustomerDebt(customer.id, total, 'Mua hàng tại quầy', items);
        });
        debtPromise.then(function(debtResult) {
            debtAmount = debtResult.debtAmount;
            creditUsed = debtResult.creditUsed;
            
            // Gửi thông báo Telegram
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
            
            // Xóa draft (fire-and-forget) - dùng id đã bắt trước closeModal
            if (draftIdToDelete) {
                deleteDraft(draftIdToDelete);
            }
            
            tempOrder = [];
            selectedCustomer = null;
            currentDraftId = null;
            
            hideToast(_debtToastId);
            var _debter = DB.getCurrentUser();
            showActivityToast('✅', {
                amount: debtAmount,
                paymentMethod: 'debt',
                type: 'debt_payment',
                tableName: null,
                items: items,
                customer: { id: customer.id, name: customer.name },
                createdByName: _debter ? _debter.displayName : '',
                createdByRole: _debter ? _debter.role : ''
            }, 'success', creditUsed > 0 ? 4500 : 3500);
            if (creditUsed > 0) {
                _setToastExtra('💳 Đã trừ ' + formatMoney(creditUsed) + ' tiền dư của khách');
            }
            if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
            if (typeof renderCustomerList === 'function') renderCustomerList();
            _dispatchPosCashUpdate();
            _releaseOrderPayment();

            // Trừ nguyên liệu: chỉ chạy SAU khi ghi nợ thành công.
            //
            // BUG ĐÃ SỬA (lần 2): khối trừ kho trước đây đặt trong
            // setTimeout(...) ở NGOÀI callback showCustomerSelector. setTimeout 0
            // chạy ngay ở tick kế tiếp, còn user chưa kịp chọn khách, nên
            // debtPromise lúc đó còn là undefined -> `undefined.then(...)` ném
            // TypeError. Lỗi này xảy ra NGOÀI chuỗi .catch nên không ai bắt,
            // và _checkAndDeductIngredients() KHÔNG BAO GIỜ chạy: mọi đơn ghi nợ
            // tại quầy đều không trừ kho, tồn kho phình lên vô hạn.
            //
            // Nay gắn thẳng vào nhánh thành công của debtPromise:
            //   - huỷ modal          -> không trừ kho
            //   - ghi nợ lỗi (mạng) -> không trừ kho
            //   - ghi nợ thành công -> trừ đúng 1 lần
            if (typeof _checkAndDeductIngredients === 'function') {
                _checkAndDeductIngredients(items).then(function() {
                    console.log('[INGREDIENT] Đã trừ nguyên liệu cho đơn ghi nợ');
                }).catch(function(e) {
                    console.error('[INGREDIENT] Lỗi trừ nguyên liệu đơn ghi nợ:', e);
                });
            }
        }).catch(function(err) {
            hideToast(_debtToastId);
            showToast((err.message || 'Lỗi khi ghi nợ!') + ' (chưa ghi nợ, thử lại được)', 'error', 4000);
            _releaseOrderPayment();
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
    // Thêm option tạo danh mục mới
    catOptions += '<option value="__new__">➕ Thêm danh mục mới...</option>';

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
                    '<select id="quickCreateCategory" class="form-input" onchange="_onQuickCreateCategoryChange(this)">' +
                        catOptions +
                    '</select>' +
                '</div>' +
                '<div class="quick-create-field" id="quickCreateNewCatField" style="display:none;">' +
                    '<label>Tên danh mục mới</label>' +
                    '<input type="text" id="quickCreateNewCatName" class="form-input" placeholder="Nhập tên danh mục..." autocomplete="off">' +
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

// Khi chọn category thay đổi - hiện/ẩn ô nhập tên danh mục mới
function _onQuickCreateCategoryChange(select) {
    var newCatField = document.getElementById('quickCreateNewCatField');
    var newCatInput = document.getElementById('quickCreateNewCatName');
    if (select.value === '__new__') {
        newCatField.style.display = '';
        if (newCatInput) {
            newCatInput.focus();
        }
    } else {
        newCatField.style.display = 'none';
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

    // Nếu chọn tạo danh mục mới
    if (categoryId === '__new__') {
        var newCatInput = document.getElementById('quickCreateNewCatName');
        var newCatName = newCatInput ? newCatInput.value.trim() : '';
        if (!newCatName) {
            showToast('❌ Vui lòng nhập tên danh mục mới', 'error');
            if (newCatInput) newCatInput.focus();
            return;
        }

        closeQuickCreateMenuItem();
        showToast('⏳ Đang tạo danh mục...', 'warning');

        // Tìm sortOrder cao nhất cho category
        var maxCatSort = 0;
        var cats = window.menuCategories || [];
        for (var i = 0; i < cats.length; i++) {
            var s = cats[i].sortOrder || 0;
            if (s > maxCatSort) maxCatSort = s;
        }

        // Tạo category trước
        var newCategory = {
            name: newCatName,
            sortOrder: maxCatSort + 1,
            createdAt: new Date().toISOString()
        };

        DB.create('menu_categories', newCategory).then(function(savedCat) {
            // Category đã được tạo, giờ tạo menu item với categoryId mới
            var maxSort = 0;
            for (var i = 0; i < menuItems.length; i++) {
                var s = menuItems[i].sortOrder || 0;
                if (s > maxSort) maxSort = s;
            }

            var newItem = {
                name: name,
                categoryId: savedCat.id,
                price: price,
                sortOrder: maxSort + 1,
                hasVariants: false,
                createdAt: new Date().toISOString()
            };

            return DB.create('menu', newItem);
        }).then(function(saved) {
            showToast('✅ Đã tạo danh mục "' + newCatName + '" và món "' + name + '"', 'success');
            // Menu + Category sẽ tự cập nhật qua realtime subscription
        }).catch(function(err) {
            console.error('Lỗi tạo danh mục + món:', err);
            showToast('❌ Lỗi: ' + (err.message || 'unknown'), 'error');
        });

        return;
    }

    // Trường hợp bình thường: chọn danh mục có sẵn
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
    // FIX: query trong container của modal đơn, không query toàn trang.
    // Nếu query toàn trang, các row của tab "Mang đi" (pos-app.js:1396, dùng
    // _takeawayCart riêng) cũng nhận handler này -> khi swipe xoá ở tab mang đi
    // sẽ gọi removeFromCart(idx của DOM) và xoá nhầm món trong giỏ modal đơn.
    var container = _getCartDom ? _getCartDom() : null;
    if (!container || !container.querySelectorAll) return;
    var rows = container.querySelectorAll('.cart-item-row');
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
window._onQuickCreateCategoryChange = _onQuickCreateCategoryChange;
// Export takeaway helpers (dùng trong inline onclick)
window.takeawayCashPayWithDenom = takeawayCashPayWithDenom;
window._takeawayChangeToastPay = _takeawayChangeToastPay;
window._hideTakeawayChangeToast = _hideTakeawayChangeToast;
window.showTakeawayCustomDenomInput = showTakeawayCustomDenomInput;
window.confirmTakeawayCustomDenom = confirmTakeawayCustomDenom;
window.renderCartColumn = renderCartColumn;