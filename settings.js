// settings.js - Loader chính cho Settings + Tiền mặt tại POS
// ES5, tương thích Android 6, iOS 12
//
// File này đã được tái cấu trúc thành các module riêng biệt:
//   settings-core.js       - Biến global + Hàm dùng chung
//   settings-cash-counter.js - Cash counter + đối soát
//   settings-manager-pickup.js - Manager pickup (save/delete)
//   settings-date.js        - Date selection
//   settings-alert.js       - Alert sound
//   settings-close-day.js   - Staff close day + Telegram shift close + unlock
//   settings-toast.js       - Closeable toast + toggle sections
//   settings-init.js        - initSettingsTab + fund hide for staff
//   settings-staff.js       - Staff note, printer IP, token visibility
//   settings-shop-info.js   - Shop info (load/save/clear)
//   settings-telegram.js    - Telegram config (save/test/clear)
//   settings-lock-config.js - Lock config (load/save)
//   settings-permissions.js - Staff permission wrappers
//   settings-escape.js      - Escape helpers + version compare (dự phòng)
//   settings-data-fix.js    - Fix old cashKept data
//   settings-esp32.js       - ESP32 config + clear IndexedDB
//   settings-modals.js      - Detail modals (active tables, debt, grab, cost, transfer, cash)
//   settings-print.js       - Print manager pickup + staff close receipt
//   settings-fund.js        - Responsibility fund
//   settings-firebase-config.js - Multi-Firebase config
//   settings-visibility.js  - Online/offline + visibility detection
//
// Các hàm trùng lặp đã được gộp:
//   - escapeHtml, escapeJsString: dùng từ pos-app.js (settings-core.js có fallback)
//   - showActiveTablesModal: dùng từ report.js (settings-modals.js có bản sao)
//   - saveManagerPickup, deleteManagerPickup: dùng từ fund-reconciliation.js
// ============================================================

// ============================================================
// LẮNG NGHE FIREBASE REALTIME: cập nhật window.shopConfig + UI tự động
// Khi admin thay đổi token Telegram / thông tin quán từ Settings,
// tất cả thiết bị đều nhận được mà không cần F5
// ============================================================
(function _initSettingsRealtime() {
    // Khởi tạo window.shopConfig nếu chưa có
    if (!window.shopConfig) {
        window.shopConfig = {};
    }

    // === Hàm cập nhật UI Telegram từ config ===
    function _updateTelegramUI(config) {
        var tokenInput = document.getElementById('telegramBotToken');
        if (tokenInput && config.telegramBotToken !== undefined) {
            tokenInput.value = config.telegramBotToken || '';
        }
        var chatIdInput = document.getElementById('telegramChatId');
        if (chatIdInput && config.telegramChatId !== undefined) {
            chatIdInput.value = config.telegramChatId || '';
        }
        var shiftCloseInput = document.getElementById('telegramShiftCloseToken');
        if (shiftCloseInput && config.telegramShiftCloseToken !== undefined) {
            shiftCloseInput.value = config.telegramShiftCloseToken || '';
        }
        var warningInput = document.getElementById('telegramWarningToken');
        if (warningInput && config.telegramWarningToken !== undefined) {
            warningInput.value = config.telegramWarningToken || '';
        }
        var expenseInput = document.getElementById('telegramExpenseToken');
        if (expenseInput && config.telegramExpenseToken !== undefined) {
            expenseInput.value = config.telegramExpenseToken || '';
        }
    }

    // === Hàm cập nhật UI Shop Info từ data ===
    function _updateShopInfoUI(data) {
        var nameEl = document.getElementById('shopInfoName');
        if (nameEl && data.name !== undefined) nameEl.value = data.name || '';
        var addressEl = document.getElementById('shopInfoAddress');
        if (addressEl && data.address !== undefined) addressEl.value = data.address || '';
        var phoneEl = document.getElementById('shopInfoPhone');
        if (phoneEl && data.phone !== undefined) phoneEl.value = data.phone || '';
        // Cập nhật lock config nếu có
        var lockStartInput = document.getElementById('settingsLockStartHour');
        if (lockStartInput && data.lockStartHour !== undefined) lockStartInput.value = data.lockStartHour !== null ? data.lockStartHour : '';
        var lockEndHourInput = document.getElementById('settingsLockEndHour');
        if (lockEndHourInput && data.lockEndHour !== undefined) lockEndHourInput.value = data.lockEndHour !== null ? data.lockEndHour : '';
        var lockEndMinInput = document.getElementById('settingsLockEndMinute');
        if (lockEndMinInput && data.lockEndMinute !== undefined) lockEndMinInput.value = data.lockEndMinute !== null ? data.lockEndMinute : '';
        var tableLockInput = document.getElementById('settingsTableLockHours');
        if (tableLockInput && data.tableLockHours !== undefined) tableLockInput.value = data.tableLockHours !== null ? data.tableLockHours : '';
    }

    // Lắng nghe sự kiện db_update từ db.js (khi Firebase thay đổi)
    window.addEventListener('db_update', function(e) {
        var detail = e.detail;
        if (!detail || !detail.data) return;

        // --- Xử lý collection 'info' (Telegram config + Lock config) ---
        if (detail.collection === 'info') {
            var infoData = detail.data;
            var config = Array.isArray(infoData) ? (infoData[0] || {}) : infoData;
            if (config.id === 'shop_config') {
                // Cập nhật window.shopConfig
                window.shopConfig.telegramBotToken = config.telegramBotToken || '';
                window.shopConfig.telegramChatId = config.telegramChatId || '';
                window.shopConfig.telegramShiftCloseToken = config.telegramShiftCloseToken || '';
                window.shopConfig.telegramWarningToken = config.telegramWarningToken || '';
                window.shopConfig.telegramExpenseToken = config.telegramExpenseToken || '';
                // Cập nhật UI Telegram nếu đang mở
                _updateTelegramUI(config);
                // Cập nhật UI lock config
                _updateShopInfoUI(config);
            }
        }

        // --- Xử lý collection 'shop_info' (Thông tin quán) ---
        if (detail.collection === 'shop_info') {
            var shopData = detail.data;
            var infoItem = Array.isArray(shopData) ? (shopData[0] || {}) : shopData;
            if (infoItem && infoItem.id === 'shop_info') {
                window.shopInfo = infoItem;
                _updateShopInfoUI(infoItem);
            }
        }
    });

    // Cũng lắng nghe trực tiếp từ Firebase (nếu firebase sẵn sàng)
    // Đảm bảo dữ liệu được cập nhật ngay cả khi db_update chưa kịp dispatch
    setTimeout(function() {
        try {
            var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : localStorage.getItem('current_shop_id');
            if (shopId && typeof firebase !== 'undefined' && firebase.database) {
                // MULTI-FIREBASE: Dùng _getDb() để chọn Master/Slave tùy collection
                // Lấy đúng DB instance cho collection 'info'
                var infoDb = (typeof DB !== 'undefined' && DB.getSlaveDb && DB.getSlaveDb()) ||
                             (typeof DB !== 'undefined' && DB.getMasterDb && DB.getMasterDb()) ||
                             firebase.database();
                var infoRef = infoDb.ref(shopId + '/info');
                infoRef.on('value', function(snapshot) {
                    if (!snapshot.exists()) return;
                    var src = snapshot.val() || {};
                    window.shopConfig.telegramBotToken = src.telegramBotToken || '';
                    window.shopConfig.telegramChatId = src.telegramChatId || '';
                    window.shopConfig.telegramShiftCloseToken = src.telegramShiftCloseToken || '';
                    window.shopConfig.telegramWarningToken = src.telegramWarningToken || '';
                    window.shopConfig.telegramExpenseToken = src.telegramExpenseToken || '';
                    // Cập nhật UI
                    _updateTelegramUI(src);
                    _updateShopInfoUI(src);
                });

                // Lấy đúng DB instance cho collection 'shop_info'
                var shopInfoDb = (typeof DB !== 'undefined' && DB.getSlaveDb && DB.getSlaveDb()) ||
                                 (typeof DB !== 'undefined' && DB.getMasterDb && DB.getMasterDb()) ||
                                 firebase.database();
                var shopInfoRef = shopInfoDb.ref(shopId + '/shop_info');
                shopInfoRef.on('value', function(snapshot) {
                    if (!snapshot.exists()) return;
                    var src = snapshot.val() || {};
                    // shop_info là object, lấy item đầu tiên
                    for (var key in src) {
                        if (src.hasOwnProperty(key)) {
                            var item = src[key];
                            if (item && item.id === 'shop_info') {
                                window.shopInfo = item;
                                _updateShopInfoUI(item);
                            }
                            break;
                        }
                    }
                });
            }
        } catch (e) {
        }
    }, 3000); // Đợi 3s cho Firebase khởi tạo
})();

// ============================================================
// LẮNG NGHE GLOBAL: Cập nhật doanh thu pos-cash-info realtime
// Đăng ký ngay khi settings.js load, không phụ thuộc vào tab Settings
// ============================================================
(function _initPosCashRealtime() {
    // Hàm xử lý db_update cho pos-cash-info (doanh thu)
    function _onPosCashDbUpdate(e) {
        try {
            var detail = e.detail;
            if (!detail || !detail.collection) return;
            if (_selectedCloseDate) return;
            if (detail.collection === 'transactions' || detail.collection === 'tables' || detail.collection === 'cost_transactions') {
                loadPosCashData();
            }
        } catch (e) {
        }
    }

    // Hàm xử lý pos_cash_update từ order.js và tables.js (thanh toán trên cùng máy)
    function _onPosCashLocalUpdate() {
        try {
            if (_selectedCloseDate) return;
            loadPosCashData();
        } catch (e) {
        }
    }

    // Đăng ký listener global - luôn sẵn sàng dù tab nào đang mở
    window.removeEventListener('db_update', _onPosCashDbUpdate);
    window.addEventListener('db_update', _onPosCashDbUpdate);
    window.removeEventListener('pos_cash_update', _onPosCashLocalUpdate);
    window.addEventListener('pos_cash_update', _onPosCashLocalUpdate);
})();
