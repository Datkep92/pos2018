// settings-lock-config.js - Lock config (load/save)
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// 5b. CẤU HÌNH KHÓA BÀN & THỜI GIAN
// ============================================================

function loadLockConfig() {
    try {
        var info = window.shopInfo || {};
        var startHourInput = document.getElementById('settingsLockStartHour');
        if (startHourInput) startHourInput.value = info.lockStartHour !== undefined ? info.lockStartHour : '';

        var endHourInput = document.getElementById('settingsLockEndHour');
        if (endHourInput) endHourInput.value = info.lockEndHour !== undefined ? info.lockEndHour : '';

        var endMinuteInput = document.getElementById('settingsLockEndMinute');
        if (endMinuteInput) endMinuteInput.value = info.lockEndMinute !== undefined ? info.lockEndMinute : '';

        var tableLockInput = document.getElementById('settingsTableLockHours');
        if (tableLockInput) tableLockInput.value = info.tableLockHours !== undefined ? info.tableLockHours : '';

        var lockPassInput = document.getElementById('settingsLockPassword');
        if (lockPassInput) lockPassInput.value = info.lockPassword || '';
    } catch(e) {
    }
}

function saveLockConfig() {
    var startHour = document.getElementById('settingsLockStartHour').value.trim();
    var endHour = document.getElementById('settingsLockEndHour').value.trim();
    var endMinute = document.getElementById('settingsLockEndMinute').value.trim();
    var tableLockHours = document.getElementById('settingsTableLockHours').value.trim();
    var lockPassword = document.getElementById('settingsLockPassword').value.trim();

    // Validate
    if (startHour) {
        var sh = parseInt(startHour, 10);
        if (isNaN(sh) || sh < 0 || sh > 23) {
            showToast('⚠️ Giờ mở quán không hợp lệ (0-23)', 'warning');
            return;
        }
    }
    if (endHour) {
        var eh = parseInt(endHour, 10);
        if (isNaN(eh) || eh < 0 || eh > 23) {
            showToast('⚠️ Giờ đóng quán không hợp lệ (0-23)', 'warning');
            return;
        }
    }
    if (endMinute) {
        var em = parseInt(endMinute, 10);
        if (isNaN(em) || em < 0 || em > 59) {
            showToast('⚠️ Phút đóng quán không hợp lệ (0-59)', 'warning');
            return;
        }
    }
    if (tableLockHours) {
        var tlh = parseInt(tableLockHours, 10);
        if (isNaN(tlh) || tlh < 1 || tlh > 24) {
            showToast('⚠️ Thời gian ngồi tối đa không hợp lệ (1-24)', 'warning');
            return;
        }
    }

    // Các key này nằm trực tiếp trong info/{shopId} trên Firebase (cùng cấp với name, code)
    // Ghi trực tiếp lên Firebase để đảm bảo đúng path
    var shopId = localStorage.getItem('current_shop_id') || 'shop_default';
    var fbRef = firebase.database().ref(shopId + '/info');
    var updates = {};
    if (startHour) updates.lockStartHour = parseInt(startHour, 10);
    if (endHour) updates.lockEndHour = parseInt(endHour, 10);
    if (endMinute) updates.lockEndMinute = parseInt(endMinute, 10);
    if (tableLockHours) updates.tableLockHours = parseInt(tableLockHours, 10);
    if (lockPassword) updates.lockPassword = lockPassword;

    fbRef.update(updates).then(function() {
        // Cập nhật shopInfo và shopConfig ngay lập tức
        if (window.shopInfo) {
            for (var k in updates) window.shopInfo[k] = updates[k];
        }
        if (window.shopConfig) {
            for (var k in updates) window.shopConfig[k] = updates[k];
        }
        var statusEl = document.getElementById('lockConfigStatus');
        if (statusEl) statusEl.textContent = '✅ Đã lưu cấu hình khóa bàn & thời gian';
        showToast('✅ Đã lưu cấu hình khóa bàn & thời gian', 'success');
    }).catch(function(err) {
        showToast('❌ Lỗi lưu cấu hình', 'error');
    });
}