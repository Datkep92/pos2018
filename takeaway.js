// takeaway.js - Logic riêng cho giao diện bán mang đi siêu nhanh
// ES5, tương thích Android 6, iOS 12
// KHÔNG phụ thuộc pos-app.js, realtime-pos.js

// ---- Biến global cần thiết cho order.js ----
var selectedCustomer = null;
var _skipOrderCreditCheck = false;
var tempOrder = []; // order.js dùng tempOrder (global)
// Đồng bộ window.tempOrder để các hàm khác có thể đọc
window.tempOrder = tempOrder;

// ---- Stub cho các hàm từ pos-app.js mà order.js cần ----
function closeModal(modalId) {
    // takeaway không có modal
}
function showToast(msg, type, duration) {
    // Chuyển tiếp sang _toast của takeaway
    _toast(msg, type);
}
function hideToast() {}

// ---- Khởi tạo ----
document.addEventListener('DOMContentLoaded', function() {
    DB.init().then(function() {
        if (typeof initAuth === 'function') {
            initAuth();
        }
        return _loadTakeawayData();
    }).then(function() {
        _initTakeawaySubscriptions();
        if (typeof initNotifications === 'function') {
            initNotifications();
        }
        // Chờ dữ liệu menu sẵn sàng
        var checkReady = setInterval(function() {
            if (window.menuItems && window.menuItems.length > 0) {
                clearInterval(checkReady);
                _initTakeawayUI();
            }
        }, 100);
        setTimeout(function() { clearInterval(checkReady); }, 15000);
    }).catch(function(err) {
        console.error('Takeaway init error:', err);
    });

    _updateTime();
    setInterval(_updateTime, 30000);
});

function _loadTakeawayData() {
    var cache = {};
    if (typeof DB.getMemoryCache === 'function') {
        cache = DB.getMemoryCache() || {};
    }
    window.menuItems = cache.menu || [];
    window.menuCategories = cache.menu_categories || [];
    window.customers = cache.customers || [];
    window.ingredients = cache.ingredients || [];
    window.shopConfig = window.shopConfig || {};
    return Promise.resolve();
}

// ---- Subscription realtime (chỉ lắng nghe menu thay đổi) ----
function _initTakeawaySubscriptions() {
    DB.subscribe('menu', function(data) {
        if (!data) return;
        DB.getAll('menu').then(function(list) {
            window.menuItems = list || [];
            if (typeof _renderMenu === 'function') _renderMenu();
            if (typeof renderCategories === 'function') renderCategories();
        });
    });

    DB.subscribe('menu_categories', function(data) {
        if (!data) return;
        DB.getAll('menu_categories').then(function(list) {
            window.menuCategories = list || [];
            if (typeof renderCategories === 'function') renderCategories();
            if (typeof _renderMenu === 'function') _renderMenu();
        });
    });
}

// ---- Biến toàn cục cho takeaway ----
var _currentCat = 'all';
var _searchKeyword = '';

// ---- Khởi tạo UI ----
function _initTakeawayUI() {
    renderCategories();
    _renderMenu();
    _updateCartBar();

    var user = DB.getCurrentUser();
    var staffEl = document.getElementById('staffName');
    if (user && staffEl) {
        var icon = user.role === 'admin' ? '🛡️' : '👤';
        staffEl.innerHTML = icon + ' ' + user.displayName;
    }
}

function _updateTime() {
    var el = document.getElementById('currentTime');
    if (el) {
        var now = new Date();
        el.innerText = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    }
}

// ---- RENDER DANH MỤC NGANG ----
function renderCategories() {
    var bar = document.getElementById('catBar');
    if (!bar) return;
    var html = '<button class="cat-btn' + (_currentCat === 'all' ? ' active' : '') + '" onclick="selectCat(\'all\')">📋 Tất cả</button>';
    var cats = window.menuCategories || [];
    for (var i = 0; i < cats.length; i++) {
        var c = cats[i];
        var active = (_currentCat === c.id) ? ' active' : '';
        html += '<button class="cat-btn' + active + '" onclick="selectCat(\'' + c.id + '\')">' + (c.icon || '📌') + ' ' + (c.name || '') + '</button>';
    }
    bar.innerHTML = html;
}

function selectCat(catId) {
    _currentCat = catId;
    _searchKeyword = '';
    var searchEl = document.getElementById('searchInput');
    if (searchEl) searchEl.value = '';
    renderCategories();
    _renderMenu();
    var bar = document.getElementById('catBar');
    if (bar) {
        var activeBtn = bar.querySelector('.cat-btn.active');
        if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
}

// ---- TÌM KIẾM ----
function onSearch() {
    var el = document.getElementById('searchInput');
    _searchKeyword = el ? el.value.trim().toLowerCase() : '';
    _renderMenu();
}

// ---- RENDER MENU ----
function _renderMenu() {
    var area = document.getElementById('menuArea');
    if (!area) return;

    var items = window.menuItems || [];
    if (_currentCat !== 'all') {
        items = items.filter(function(it) { return it.categoryId === _currentCat; });
    }
    if (_searchKeyword) {
        items = items.filter(function(it) {
            return it.name.toLowerCase().indexOf(_searchKeyword) !== -1;
        });
    }

    if (items.length === 0) {
        area.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px 10px;color:#475569;font-size:13px;">🍽️ Không có món</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var price = item.price || 0;
        html += '<div class="m-item" onclick="addToCart(\'' + item.id + '\')">' +
            '<div class="name">' + _esc(item.name) + '</div>' +
            '<div class="price">' + _fmt(price) + '</div>' +
        '</div>';
    }
    area.innerHTML = html;
}

// ---- THÊM VÀO GIỎ ----
function addToCart(itemId) {
    var items = window.menuItems || [];
    var item = null;
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === itemId) { item = items[i]; break; }
    }
    if (!item) return;

    if (item.hasVariants && item.variants && item.variants.length) {
        var v = item.variants[0];
        _addOrder(item.id, v.name, v.price);
        return;
    }
    _addOrder(item.id, null, item.price || 0);
}

function _addOrder(itemId, variantName, price) {
    var found = null;
    for (var i = 0; i < tempOrder.length; i++) {
        var o = tempOrder[i];
        if (o.id === itemId && o.variant === variantName) {
            found = o;
            break;
        }
    }
    if (found) {
        found.qty = (found.qty || 1) + 1;
    } else {
        tempOrder.push({
            id: itemId,
            name: _getItemName(itemId),
            variant: variantName,
            price: price,
            qty: 1
        });
    }
    _updateCartBar();
}

function _getItemName(itemId) {
    var items = window.menuItems || [];
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === itemId) return items[i].name;
    }
    return '';
}

// ---- CẬP NHẬT GIỎ HÀNG (THANH DƯỚI) ----
function _updateCartBar() {
    var countEl = document.getElementById('cartCount');
    var totalEl = document.getElementById('cartTotal');
    var payBtns = document.querySelectorAll('.pay-btn');

    var total = 0;
    var count = 0;
    for (var i = 0; i < tempOrder.length; i++) {
        var o = tempOrder[i];
        total += (o.price || 0) * (o.qty || 1);
        count += (o.qty || 1);
    }

    if (countEl) countEl.innerText = '🛒 ' + count + ' món';
    if (totalEl) totalEl.innerText = _fmt(total);

    var disabled = (count === 0);
    for (var j = 0; j < payBtns.length; j++) {
        payBtns[j].disabled = disabled;
    }
}

// ---- MỞ/ĐÓNG POPUP GIỎ HÀNG ----
function toggleCartPopup() {
    var overlay = document.getElementById('cartOverlay');
    if (!overlay) return;
    if (overlay.classList.contains('show')) {
        closeCartPopup();
    } else {
        openCartPopup();
    }
}

function openCartPopup() {
    var overlay = document.getElementById('cartOverlay');
    if (!overlay) return;
    overlay.classList.add('show');
    _renderCartPopup();
}

function closeCartPopup(e) {
    if (e && e.target !== e.currentTarget) return;
    var overlay = document.getElementById('cartOverlay');
    if (overlay) overlay.classList.remove('show');
}

function _renderCartPopup() {
    var container = document.getElementById('cartPopupItems');
    if (!container) return;
    if (tempOrder.length === 0) {
        container.innerHTML = '<div class="cp-empty">🛒 Chưa có món</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < tempOrder.length; i++) {
        var o = tempOrder[i];
        var itemTotal = (o.price || 0) * (o.qty || 1);
        var name = o.name || '';
        if (o.variant) name += ' (' + o.variant + ')';
        html += '<div class="cp-item">' +
            '<div class="cp-name">' + _esc(name) + '</div>' +
            '<div class="cp-qty">' +
                '<button onclick="cpQty(' + i + ',-1)">−</button>' +
                '<span>' + (o.qty || 1) + '</span>' +
                '<button onclick="cpQty(' + i + ',1)">+</button>' +
            '</div>' +
            '<div class="cp-price">' + _fmt(itemTotal) + '</div>' +
            '<button class="cp-del" onclick="cpDel(' + i + ')">✕</button>' +
        '</div>';
    }
    container.innerHTML = html;
}

function cpQty(index, delta) {
    if (index < 0 || index >= tempOrder.length) return;
    var newQty = (tempOrder[index].qty || 1) + delta;
    if (newQty <= 0) {
        tempOrder.splice(index, 1);
    } else {
        tempOrder[index].qty = newQty;
    }
    _updateCartBar();
    _renderCartPopup();
}

function cpDel(index) {
    if (index >= 0 && index < tempOrder.length) tempOrder.splice(index, 1);
    _updateCartBar();
    _renderCartPopup();
    if (!tempOrder.length) closeCartPopup();
}

// ---- THANH TOÁN ----
function pay(method) {
    if (tempOrder.length === 0) {
        _toast('Chưa có món trong giỏ!', 'warning');
        return;
    }

    if (method === 'grab') {
        if (typeof window.handleGrabOrder === 'function') {
            window.handleGrabOrder();
            setTimeout(function() {
                tempOrder.length = 0;
                _updateCartBar();
                closeCartPopup();
            }, 100);
        } else {
            _toast('Lỗi: chưa sẵn sàng', 'error');
        }
        return;
    }

    if (typeof window.handleTakeawayPayment === 'function') {
        window.handleTakeawayPayment(method);
        setTimeout(function() {
            tempOrder.length = 0;
            _updateCartBar();
            closeCartPopup();
        }, 100);
    } else {
        _toast('Lỗi: chưa sẵn sàng', 'error');
    }
}

// ---- TOAST ----
function _toast(msg, type) {
    type = type || 'info';
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerText = msg;
    container.appendChild(el);
    setTimeout(function() {
        if (el.parentNode) el.parentNode.removeChild(el);
    }, 2000);
}

// ---- HELPERS ----
function _esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#039;');
}

function _fmt(amount) {
    if (amount === null || amount === undefined) amount = 0;
    return Number(amount).toLocaleString('vi-VN') + 'đ';
}
