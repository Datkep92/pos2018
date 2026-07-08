// settings-shop-info.js - Shop info (load/save/clear)
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// 3. THÔNG TIN QUÁN (Shop Info)
// ============================================================

function loadShopInfo() {
    var nameEl = document.getElementById('shopInfoName');
    var addressEl = document.getElementById('shopInfoAddress');
    var phoneEl = document.getElementById('shopInfoPhone');
    if (!nameEl) return;

    if (window.shopInfo) {
        nameEl.value = window.shopInfo.name || '';
        addressEl.value = window.shopInfo.address || '';
        phoneEl.value = window.shopInfo.phone || '';
    } else {
        nameEl.value = '';
        addressEl.value = '';
        phoneEl.value = '';
    }
}

function saveShopInfo() {
    var name = document.getElementById('shopInfoName').value.trim();
    var address = document.getElementById('shopInfoAddress').value.trim();
    var phone = document.getElementById('shopInfoPhone').value.trim();

    if (!name) {
        showToast('⚠️ Vui lòng nhập tên quán', 'warning');
        return;
    }

    var data = {
        id: 'shop_info',
        name: name,
        address: address,
        phone: phone,
        updatedAt: new Date().toISOString()
    };

    DB.create('info', data, 'shop_info').then(function() {
        window.shopInfo = data;
        showToast('✅ Đã lưu thông tin quán', 'success');
    }).catch(function(err) {
        showToast('❌ Lỗi lưu thông tin quán', 'error');
    });
}

function clearShopInfo() {
    if (!confirm('Xóa thông tin quán?')) return;
    DB.remove('info', 'shop_info').then(function() {
        window.shopInfo = null;
        loadShopInfo();
        showToast('🗑️ Đã xóa thông tin quán', 'info');
    }).catch(function(err) {
        showToast('❌ Lỗi xóa thông tin quán', 'error');
    });
}