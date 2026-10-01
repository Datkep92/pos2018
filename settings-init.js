// settings-init.js - initSettingsTab + fund hide for staff
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// 2. CÀI ĐẶT ỨNG DỤNG (Settings)
// ============================================================

/**
 * Nạp cấu hình quán từ IndexedDB rồi điền vào form Cài đặt.
 *
 * Nguồn: DB.getShopConfig() đọc IndexedDB (nhanh, không mạng). Dùng nguồn này
 * thay vì window.shopConfig vì global có thể chưa sẵn sàng lúc mở tab.
 *
 * Chỉ điền vào ô đang TRỐNG, nên không đè lên thứ admin đang gõ dở.
 */
function _loadSettingsConfigFromDB() {
    if (typeof DB === 'undefined' || typeof DB.getShopConfig !== 'function') return;
    var fill = window._settingsFillIfEmpty;
    if (typeof fill !== 'function') {
        // initSettingsTab() chưa chạy lần nào -> tự tạo hàm điền tối thiểu
        fill = function (el, val) {
            if (!el) return;
            if (el.value && el.value.length > 0) return;
            el.value = val == null ? '' : val;
        };
        window._settingsFillIfEmpty = fill;
    }

    DB.getShopConfig().then(function (cfg) {
        if (!cfg) return;

        // Cờ "cấu hình đã sẵn sàng". Form Cài đặt có thể mở trước lúc dữ liệu
        // tới - lúc đó mọi ô đều trống và BẤM LƯU sẽ xoá sạch cấu hình trên
        // Firebase. Các hàm lưu kiểm tra cờ này để chặn.
        // Đánh dấu khi có bất kỳ dữ liệu cấu hình nào (khác rỗng toàn bộ).
        var _hasAny = false;
        for (var _k in cfg) {
            if (cfg.hasOwnProperty(_k) && cfg[_k] !== '' && cfg[_k] !== null && cfg[_k] !== undefined) {
                _hasAny = true; break;
            }
        }
        if (_hasAny) window._shopConfigReady = true;

        // Gom vào window.shopConfig để các hàm khác (gửi Telegram, khóa bàn)
        // đọc được ngay, kể cả khi chưa có db_update nào bắn.
        if (!window.shopConfig) window.shopConfig = {};
        for (var k in cfg) {
            if (cfg.hasOwnProperty(k) && window.shopConfig[k] === undefined) {
                window.shopConfig[k] = cfg[k];
            }
        }

        // Telegram
        fill(document.getElementById('telegramBotToken'), cfg.telegramBotToken);
        fill(document.getElementById('telegramChatId'), cfg.telegramChatId);
        fill(document.getElementById('telegramShiftCloseToken'), cfg.telegramShiftCloseToken);
        fill(document.getElementById('telegramWarningToken'), cfg.telegramWarningToken);
        fill(document.getElementById('telegramExpenseToken'), cfg.telegramExpenseToken);

        // Khóa bàn & thời gian
        fill(document.getElementById('settingsLockStartHour'), cfg.lockStartHour);
        fill(document.getElementById('settingsLockEndHour'), cfg.lockEndHour);
        fill(document.getElementById('settingsLockEndMinute'), cfg.lockEndMinute);
        fill(document.getElementById('settingsTableLockHours'), cfg.tableLockHours);
        fill(document.getElementById('settingsLockPassword'), cfg.lockPassword);

        // Thông tin quán
        fill(document.getElementById('shopInfoName'), cfg.name);
        if (cfg.address) fill(document.getElementById('shopInfoAddress'), cfg.address);
        if (cfg.phone) fill(document.getElementById('shopInfoPhone'), cfg.phone);
    }).catch(function () {
        // Không đọc được thì để nguyên form, không đụng gì
    });
}

function initSettingsTab() {
    try {
    // Phân quyền hiển thị:
    // - Nhân viên: chỉ thấy "📝 Ghi chú"
    // - Admin: thấy tất cả (Telegram, ESP32, Thông tin quán, Chat)
    // Phân quyền nhân viên đã chuyển sang modal employees.js
    var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
    var shopSection = document.getElementById('settingsShopSection');
    var telegramSection = document.getElementById('settingsTelegramSection');
    var permSection = document.getElementById('settingsPermissionSection');
    var chatSection = document.getElementById('settingsChatSection');
    var esp32Section = document.getElementById('settingsEsp32Section');
    var chatLockField = document.getElementById('chatLockField');
    var staffNoteSection = document.getElementById('settingsStaffNoteSection');
    var lockSection = document.getElementById('settingsLockSection');
    var fundSection = document.getElementById('settingsResponsibilityFundSection');
    var fundInitialField = document.getElementById('fundInitialField');
    var fundAutoField = document.getElementById('fundAutoField');
    var fundHideForStaffField = document.getElementById('fundHideForStaffField');

    // Admin: hiển thị TOÀN BỘ các section - chỉ ẩn "Ghi chú nhân viên"
    // Nhân viên: ẩn TOÀN BỘ các section - chỉ hiển thị "Ghi chú" và "Quỹ thưởng" (nhưng ẩn các field admin)
    if (isAdmin) {
        // Admin: hiển thị tất cả section cài đặt
        if (shopSection) shopSection.style.display = '';
        if (telegramSection) telegramSection.style.display = '';
        if (esp32Section) esp32Section.style.display = '';
        if (chatSection) chatSection.style.display = '';
        if (chatLockField) chatLockField.style.display = '';
        if (lockSection) lockSection.style.display = '';
        if (fundSection) fundSection.style.display = '';
        if (fundInitialField) fundInitialField.style.display = '';
        if (fundAutoField) fundAutoField.style.display = '';
        if (fundHideForStaffField) fundHideForStaffField.style.display = '';
        // Staff note section: ẩn với admin
        if (staffNoteSection) staffNoteSection.style.display = 'none';
        // Permission section: luôn ẩn (đã chuyển sang modal employees.js)
        if (permSection) permSection.style.display = 'none';
        // Đọc trạng thái hideFundForStaff từ Firebase
        _loadFundHideForStaffSetting();
    } else {
        // Nhân viên: ẩn tất cả section cài đặt, chỉ hiển thị "Ghi chú" và "Quỹ thưởng"
        if (shopSection) shopSection.style.display = 'none';
        if (telegramSection) telegramSection.style.display = 'none';
        if (esp32Section) esp32Section.style.display = 'none';
        if (chatSection) chatSection.style.display = 'none';
        if (chatLockField) chatLockField.style.display = 'none';
        if (lockSection) lockSection.style.display = 'none';
        if (permSection) permSection.style.display = 'none';
        // Fund section: kiểm tra setting ẩn/hiện
        _applyFundVisibilityForStaff(fundSection);
        // Ẩn các field chỉ dành cho admin (nhập quỹ ban đầu, tự động tính quỹ, toggle ẩn)
        if (fundInitialField) fundInitialField.style.display = 'none';
        if (fundAutoField) fundAutoField.style.display = 'none';
        if (fundHideForStaffField) fundHideForStaffField.style.display = 'none';
        // Staff note section: hiển thị cho nhân viên
        if (staffNoteSection) staffNoteSection.style.display = '';
    }

    // Load Telegram config vào UI
    //
    // NGUỒN ĐÚNG là cấu hình quán (Firebase), KHÔNG phải localStorage. Trước đây
    // đọc localStorage rồi ghi đè lên form: trên máy mới localStorage chưa có
    // gì nên mỗi lần bấm vào tab Cài đặt là 5 ô bị xoá trắng, dù Firebase vẫn
    // còn token hợp lệ.
    if (!window.shopConfig) {
        window.shopConfig = {};
    }
    var _cfg = window.shopConfig;

    // Chỉ ghi vào ô khi ô đang trống. Nếu admin đang sửa dở thì không được
    // xoá nội dung họ vừa gõ.
    function _fillIfEmpty(el, val) {
        if (!el) return;
        if (el.value && el.value.length > 0) return;   // đã có nội dung -> giữ
        el.value = val == null ? '' : val;
    }
    window._settingsFillIfEmpty = _fillIfEmpty;

    // Sửa dụng các hàm lưu giá trị để nạp từ localStorage khi Firebase chưa có
    function _persist(key, val) {
        if (val) { try { localStorage.setItem(key, val); } catch (e) {} }
    }
    function _ls(key) {
        try { return localStorage.getItem(key) || ''; } catch (e) { return ''; }
    }

    // Load staff permission list (đã chuyển sang modal employees.js)
    // Giữ lại để tương thích nếu có gọi từ nơi khác

    // Khởi tạo Đếm tiền nhanh
    if (typeof initQuickCashCounter === 'function') {
        initQuickCashCounter();
    }

    // Load shop info
    if (typeof loadShopInfo === 'function') {
        loadShopInfo();
    }

    // Load ESP32 config
    if (typeof loadEsp32Config === 'function') {
        loadEsp32Config();
    }

    // Load lock config
    loadLockConfig();

    // Nạp lại cấu hình từ IndexedDB (đọc local, không chờ mạng).
    //
    // initSettingsTab() chạy ngay khi bấm tab. Nếu bấm sớm lúc app còn đang
    // đồng bộ thì window.shopConfig / window.shopInfo chưa có dữ liệu, form
    // hiện trống hết. Rồi admin bấm "Lưu cấu hình" là saveLockConfig() ghi
    // null lên Firebase và XOÁ mật khẩu khóa bàn của cả shop.
    // Đọc thẳng IndexedDB thì luôn có dữ liệu ngay, không phụ thuộc thứ tự.
    _loadSettingsConfigFromDB();

    // Đồng bộ trạng thái toggle khóa chat
    // Sử dụng isChatLocked() từ messages.js (đã đồng bộ qua Firebase realtime)
    if (isAdmin) {
        var chatLockToggle = document.getElementById('chatLockToggle');
        var chatLockLabel = document.getElementById('chatLockStatusLabel');
        if (chatLockToggle) {
            var locked = false;
            if (typeof isChatLocked === 'function') {
                locked = isChatLocked();
            } else {
                // Fallback nếu messages.js chưa load
                try {
                    locked = localStorage.getItem('chat_staff_locked') === 'true';
                } catch(e) {}
            }
            chatLockToggle.checked = locked;
            if (chatLockLabel) {
                chatLockLabel.textContent = locked ? '🔒 Đã khóa' : '🔓 Đã mở';
            }
        }
    }

    // Load ghi chú nhân viên từ localStorage
    var staffNoteInput = document.getElementById('staffNoteInput');
    if (staffNoteInput) {
        try {
            var savedNote = localStorage.getItem('staff_note');
            if (savedNote !== null) {
                staffNoteInput.value = savedNote;
            }
        } catch(e) {}
    }

    // Khởi tạo listener quỹ thưởng trách nhiệm
    if (typeof initFundListener === 'function') {
        initFundListener();
    }

    // MULTI-FIREBASE: Khởi tạo section Firebase Config
    if (typeof _initFirebaseConfigSection === 'function') {
        _initFirebaseConfigSection();
    }

    } catch(e) {
    }
}

// ===== Admin toggle: Ẩn quỹ với nhân viên =====
function _loadFundHideForStaffSetting() {
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var toggle = document.getElementById('fundHideForStaffToggle');
    var label = document.getElementById('fundHideForStaffLabel');
    if (!toggle) return;
    // MULTI-FIREBASE: settings là MASTER_ONLY collection, dùng Master DB
    var db = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : firebase.database();
    db.ref(shopId + '/settings/hideFundForStaff').once('value').then(function(snap) {
        var val = snap.val();
        toggle.checked = !!val;
        if (label) {
            label.textContent = val ? 'Nhân viên không thể xem quỹ' : 'Nhân viên có thể xem quỹ';
        }
    }).catch(function() {});
}

function _applyFundVisibilityForStaff(fundSection) {
    if (!fundSection) return;
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    // MULTI-FIREBASE: settings là MASTER_ONLY collection, dùng Master DB
    var db = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : firebase.database();
    db.ref(shopId + '/settings/hideFundForStaff').once('value').then(function(snap) {
        fundSection.style.display = snap.val() ? 'none' : '';
    }).catch(function() {
        fundSection.style.display = '';
    });
}

function toggleFundHideForStaff() {
    var toggle = document.getElementById('fundHideForStaffToggle');
    var label = document.getElementById('fundHideForStaffLabel');
    if (!toggle) return;
    var isHidden = toggle.checked;
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    // MULTI-FIREBASE: settings là MASTER_ONLY collection, dùng Master DB
    var db = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : firebase.database();
    db.ref(shopId + '/settings/hideFundForStaff').set(isHidden).then(function() {
        if (label) {
            label.textContent = isHidden ? 'Nhân viên không thể xem quỹ' : 'Nhân viên có thể xem quỹ';
        }
        if (typeof showToast === 'function') {
            showToast(isHidden ? '✅ Đã ẩn quỹ với nhân viên' : '✅ Nhân viên có thể xem quỹ', 'success');
        }
    }).catch(function() {
        if (typeof showToast === 'function') {
            showToast('❌ Lỗi khi lưu!', 'error');
        }
    });
}