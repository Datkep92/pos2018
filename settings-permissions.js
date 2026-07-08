// settings-permissions.js - Staff permission wrappers
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// 6. PHÂN QUYỀN NHÂN VIÊN (Staff Permission)
//    Đã chuyển sang employees.js
//    Các hàm này là wrapper để tránh xung đột tên
// ============================================================

// employees.js đã định nghĩa và export các hàm:
//   loadStaffPermissionList, toggleStaffRole, createNewStaff, deleteStaff
// Settings.js chỉ gọi lại qua window để tránh đệ quy

function loadStaffPermissionList() {
    // Gọi implementation từ employees.js qua tên khác để tránh đệ quy
    if (typeof window._empLoadStaffPermList === 'function') {
        window._empLoadStaffPermList();
    }
}

function toggleStaffRole(staffId, currentRole) {
    if (typeof window._empToggleRole === 'function') {
        window._empToggleRole(staffId, currentRole);
    }
}

function createNewStaff() {
    if (typeof window._empCreateStaff === 'function') {
        window._empCreateStaff();
    }
}

function deleteStaff(staffId, staffName) {
    if (typeof window._empDeleteStaff === 'function') {
        window._empDeleteStaff(staffId, staffName);
    }
}