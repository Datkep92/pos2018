// settings-init.js - initSettingsTab + fund hide for staff
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// 2. CÀI ĐẶT ỨNG DỤNG (Settings)
// ============================================================

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

    // Load Telegram config từ localStorage
    var savedToken = localStorage.getItem('telegram_bot_token');
    var savedChatId = localStorage.getItem('telegram_chat_id');
    var savedBotName = localStorage.getItem('telegram_bot_name');
    var savedShiftCloseToken = localStorage.getItem('telegram_shift_close_token');
    var savedWarningToken = localStorage.getItem('telegram_warning_token');
    var savedExpenseToken = localStorage.getItem('telegram_expense_token');

    // Khởi tạo window.shopConfig để các hàm gửi Telegram (cả chung và chốt ca) đọc được
    // Ưu tiên giữ giá trị từ Firebase realtime nếu đã có (tránh ghi đè bằng localStorage rỗng)
    if (!window.shopConfig) {
        window.shopConfig = {};
    }
    // Chỉ ghi đè nếu localStorage có giá trị, nếu không giữ nguyên từ Firebase realtime
    if (savedToken) window.shopConfig.telegramBotToken = savedToken;
    if (savedChatId) window.shopConfig.telegramChatId = savedChatId;
    if (savedShiftCloseToken) window.shopConfig.telegramShiftCloseToken = savedShiftCloseToken;
    if (savedWarningToken) window.shopConfig.telegramWarningToken = savedWarningToken;
    if (savedExpenseToken) window.shopConfig.telegramExpenseToken = savedExpenseToken;

    // Load Telegram config vào UI
    var tokenInput = document.getElementById('telegramBotToken');
    if (tokenInput) tokenInput.value = savedToken || '';
    var chatIdInput = document.getElementById('telegramChatId');
    if (chatIdInput) chatIdInput.value = savedChatId || '';
    var botNameInput = document.getElementById('telegramBotName');
    if (botNameInput) botNameInput.value = savedBotName || '';

    // Load shift-close Telegram config vào UI
    var shiftCloseTokenInput = document.getElementById('telegramShiftCloseToken');
    if (shiftCloseTokenInput) shiftCloseTokenInput.value = savedShiftCloseToken || '';

    // Load warning Telegram config vào UI
    var warningTokenInput = document.getElementById('telegramWarningToken');
    if (warningTokenInput) warningTokenInput.value = savedWarningToken || '';

    // Load expense Telegram config vào UI
    var expenseTokenInput = document.getElementById('telegramExpenseToken');
    if (expenseTokenInput) expenseTokenInput.value = savedExpenseToken || '';

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