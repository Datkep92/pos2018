// settings-esp32.js - ESP32 config + clear IndexedDB
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// 7. CẤU HÌNH ESP32 (KÉT TIỀN)
// ============================================================

/**
 * Lấy shopId cho ESP32 config
 */
function _getEsp32ShopId() {
    return localStorage.getItem('current_shop_id') || 'shop_default';
}

/**
 * Toggle hiển thị Telegram token trong phần ESP32
 */
function toggleEsp32TelegramToken() {
    var input = document.getElementById('esp32TelegramToken');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
}

/**
 * Lưu cấu hình ESP32 lên Firebase
 * ESP32 sẽ đọc cấu hình này khi khởi động thay vì hardcode
 */
function saveEsp32Config() {
    var ssid = document.getElementById('esp32WifiSsid').value.trim();
    var password = document.getElementById('esp32WifiPassword').value.trim();
    var fbHost = document.getElementById('esp32FirebaseHost').value.trim();
    var shopId = document.getElementById('esp32ShopId').value.trim();
    var tgToken = document.getElementById('esp32TelegramToken').value.trim();
    var tgChatId = document.getElementById('esp32TelegramChatId').value.trim();

    if (!ssid) {
        showToast('⚠️ Vui lòng nhập WiFi SSID', 'warning');
        return;
    }
    if (!password) {
        showToast('⚠️ Vui lòng nhập WiFi Password', 'warning');
        return;
    }
    if (!fbHost) {
        showToast('⚠️ Vui lòng nhập Firebase Host', 'warning');
        return;
    }

    var config = {
        wifi: {
            ssid: ssid,
            password: password
        },
        firebase: {
            host: fbHost,
            shopId: shopId || 'shop_default'
        },
        telegram: {
            token: tgToken || '',
            chatId: tgChatId || ''
        },
        updatedAt: new Date().toISOString(),
        updatedBy: (function() {
            try {
                var s = localStorage.getItem('pos_session');
                if (s) {
                    var u = JSON.parse(s);
                    return u.displayName || u.username || 'admin';
                }
            } catch(e) {}
            return 'admin';
        })()
    };

    var statusEl = document.getElementById('esp32ConfigStatus');
    if (statusEl) statusEl.textContent = '⏳ Đang lưu...';

    var currentShopId = _getEsp32ShopId();
    var dbRef = firebase.database().ref(currentShopId + '/esp32_config');

    dbRef.set(config).then(function() {
        if (statusEl) statusEl.textContent = '✅ Đã lưu cấu hình ESP32';
        showToast('✅ Đã lưu cấu hình ESP32', 'success');
    }).catch(function(err) {
        if (statusEl) statusEl.textContent = '❌ Lỗi: ' + err.message;
        showToast('❌ Lỗi lưu cấu hình ESP32', 'error');
    });
}

/**
 * Tải cấu hình ESP32 từ Firebase và điền vào form
 */
function loadEsp32Config() {
    var statusEl = document.getElementById('esp32ConfigStatus');
    if (statusEl) statusEl.textContent = '⏳ Đang tải...';

    var currentShopId = _getEsp32ShopId();
    var dbRef = firebase.database().ref(currentShopId + '/esp32_config');

    dbRef.once('value').then(function(snapshot) {
        var config = snapshot.val();
        if (!config) {
            if (statusEl) statusEl.textContent = 'ℹ️ Chưa có cấu hình ESP32';
            return;
        }

        // Điền WiFi
        var ssidEl = document.getElementById('esp32WifiSsid');
        if (ssidEl && config.wifi) ssidEl.value = config.wifi.ssid || '';

        var passEl = document.getElementById('esp32WifiPassword');
        if (passEl && config.wifi) passEl.value = config.wifi.password || '';

        // Điền Firebase
        var fbHostEl = document.getElementById('esp32FirebaseHost');
        if (fbHostEl && config.firebase) fbHostEl.value = config.firebase.host || '';

        var shopIdEl = document.getElementById('esp32ShopId');
        if (shopIdEl && config.firebase) shopIdEl.value = config.firebase.shopId || '';

        // Điền Telegram
        var tgTokenEl = document.getElementById('esp32TelegramToken');
        if (tgTokenEl && config.telegram) tgTokenEl.value = config.telegram.token || '';

        var tgChatIdEl = document.getElementById('esp32TelegramChatId');
        if (tgChatIdEl && config.telegram) tgChatIdEl.value = config.telegram.chatId || '';

        if (statusEl) {
            var updated = config.updatedAt ? ' (cập nhật: ' + new Date(config.updatedAt).toLocaleString('vi-VN') + ')' : '';
            statusEl.textContent = '✅ Đã tải cấu hình' + updated;
        }
        showToast('✅ Đã tải cấu hình ESP32', 'success');
    }).catch(function(err) {
        if (statusEl) statusEl.textContent = '❌ Lỗi: ' + err.message;
        showToast('❌ Lỗi tải cấu hình ESP32', 'error');
    });
}

/**
 * Xóa cấu hình ESP32 khỏi Firebase
 */
function clearEsp32Config() {
    if (!confirm('Xóa cấu hình ESP32? ESP32 sẽ không thể kết nối nếu chưa có cấu hình mới.')) return;

    var statusEl = document.getElementById('esp32ConfigStatus');
    if (statusEl) statusEl.textContent = '⏳ Đang xóa...';

    var currentShopId = _getEsp32ShopId();
    var dbRef = firebase.database().ref(currentShopId + '/esp32_config');

    dbRef.remove().then(function() {
        // Xóa các field trên form
        var ids = ['esp32WifiSsid', 'esp32WifiPassword', 'esp32FirebaseHost',
                   'esp32ShopId', 'esp32TelegramToken', 'esp32TelegramChatId'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });

        if (statusEl) statusEl.textContent = '🗑️ Đã xóa cấu hình ESP32';
        showToast('🗑️ Đã xóa cấu hình ESP32', 'info');
    }).catch(function(err) {
        if (statusEl) statusEl.textContent = '❌ Lỗi: ' + err.message;
        showToast('❌ Lỗi xóa cấu hình ESP32', 'error');
    });
}

/**
 * Xóa toàn bộ IndexedDB và tải lại trang từ Firebase
 * Dùng khi dữ liệu cache hiển thị không chính xác
 */
function clearIndexedDB() {
    if (!confirm('⚠️ Xóa toàn bộ dữ liệu cache trên trình duyệt?\n\n' +
                 '• Dữ liệu trên Firebase KHÔNG bị ảnh hưởng\n' +
                 '• Trang sẽ tự động tải lại để đồng bộ từ Firebase\n\n' +
                 'Tiếp tục?')) return;

    showToast('⏳ Đang xóa cache...', 'info', 0);

    // Xóa IndexedDB
    if (window.indexedDB && indexedDB.databases) {
        indexedDB.databases().then(function(list) {
            list.forEach(function(db) {
                if (db.name) {
                    indexedDB.deleteDatabase(db.name);
                }
            });
            // Force reload sau khi xóa
            setTimeout(function() {
                location.reload(true);
            }, 500);
        }).catch(function() {
            // Fallback: xóa các database phổ biến của POS
            var names = ['posDB', 'PosDB', 'pos_db', 'firebase', 'firebase-db'];
            names.forEach(function(n) {
                indexedDB.deleteDatabase(n);
            });
            setTimeout(function() {
                location.reload(true);
            }, 500);
        });
    } else {
        // Fallback cho trình duyệt cũ không hỗ trợ indexedDB.databases()
        var names = ['posDB', 'PosDB', 'pos_db', 'firebase', 'firebase-db'];
        names.forEach(function(n) {
            indexedDB.deleteDatabase(n);
        });
        setTimeout(function() {
            location.reload(true);
        }, 500);
    }
}