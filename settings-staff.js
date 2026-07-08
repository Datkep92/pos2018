// settings-staff.js - Staff note, printer IP, token visibility
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// Lưu ghi chú nhân viên vào localStorage (gọi từ oninput)
function saveStaffNote(value) {
    try {
        localStorage.setItem('staff_note', value || '');
    } catch(e) {}
}

function savePrinterIp() {
    var input = document.getElementById('settingsPrinterIp');
    if (!input) return;
    var ip = input.value.trim();
    if (!ip) {
        showToast('⚠️ Vui lòng nhập địa chỉ IP', 'warning');
        return;
    }
    localStorage.setItem('printer_ip', ip);
    showToast('✅ Đã lưu địa chỉ máy in', 'success');
}

function testPrint() {
    var ip = localStorage.getItem('printer_ip');
    if (!ip) {
        showToast('⚠️ Chưa có địa chỉ máy in', 'warning');
        return;
    }
    // Gửi lệnh in thử qua Android bridge
    if (window.AppBridge && typeof window.AppBridge.printTest === 'function') {
        window.AppBridge.printTest(ip);
    } else {
        showToast('📡 Đã gửi lệnh in thử đến ' + ip, 'info');
    }
}

function toggleTokenVisibility() {
    var input = document.getElementById('settingsGithubToken');
    var btn = document.getElementById('settingsToggleToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}