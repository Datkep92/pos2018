// auth.js - Module đăng nhập/đăng ký POS
// ES5, tương thích Android 6, iOS 12
// Hỗ trợ đăng nhập bằng mã POS + user/pass, đăng ký POS mới

// ========== BIẾN GLOBAL ==========
var authInitialized = false;

// ========== KHỞI TẠO ==========
function initAuth() {
    if (authInitialized) return;
    authInitialized = true;
    
    // Kiểm tra session đã lưu
    var user = DB.getCurrentUser();
    if (user) {
        // Đã đăng nhập, ẩn màn hình login
        hideLoginScreen();
        applyRoleBasedUI(user);
    } else {
        // Chưa đăng nhập, hiện màn hình login
        showLoginScreen();
    }
}

// ========== HIỂN THỊ MÀN HÌNH ==========

function showLoginScreen() {
    var overlay = document.getElementById('authOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    
    var loginForm = document.getElementById('loginForm');
    var registerForm = document.getElementById('registerForm');
    if (loginForm) loginForm.style.display = 'block';
    if (registerForm) registerForm.style.display = 'none';
    
    // Focus vào ô nhập mã POS
    var shopCodeInput = document.getElementById('loginShopCode');
    if (shopCodeInput) setTimeout(function() { shopCodeInput.focus(); }, 300);
}

function hideLoginScreen() {
    var overlay = document.getElementById('authOverlay');
    if (overlay) overlay.style.display = 'none';
}

function showRegisterForm() {
    var loginForm = document.getElementById('loginForm');
    var registerForm = document.getElementById('registerForm');
    if (loginForm) loginForm.style.display = 'none';
    if (registerForm) registerForm.style.display = 'block';
}

function showLoginForm() {
    var loginForm = document.getElementById('loginForm');
    var registerForm = document.getElementById('registerForm');
    if (loginForm) loginForm.style.display = 'block';
    if (registerForm) registerForm.style.display = 'none';
}

// ========== ĐĂNG NHẬP ==========

function handleLogin() {
    var shopCode = document.getElementById('loginShopCode');
    var username = document.getElementById('loginUsername');
    var password = document.getElementById('loginPassword');
    var errorEl = document.getElementById('loginError');
    var btn = document.getElementById('loginBtn');
    
    if (!shopCode || !username || !password) return;
    
    var code = shopCode.value.trim();
    var user = username.value.trim();
    var pass = password.value;
    
    if (!code || !user || !pass) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập đầy đủ thông tin';
        return;
    }
    
    // Disable nút để tránh spam
    if (btn) { btn.disabled = true; btn.innerText = 'Đang đăng nhập...'; }
    if (errorEl) errorEl.innerText = '';
    
    DB.login(code, user, pass).then(function(userData) {
        // Đăng nhập thành công
        if (errorEl) errorEl.innerText = '';
        hideLoginScreen();
        applyRoleBasedUI(userData);
        showToast('Đăng nhập thành công! Chào ' + userData.displayName, 'success');
        
        // Reload lại dữ liệu cho shop mới
        reloadAppData();
    }).catch(function(err) {
        if (errorEl) errorEl.innerText = err.message || 'Đăng nhập thất bại';
        if (btn) { btn.disabled = false; btn.innerText = 'Đăng nhập'; }
    });
}

// ========== ĐĂNG KÝ POS MỚI ==========

function handleRegister() {
    var shopName = document.getElementById('regShopName');
    var shopCode = document.getElementById('regShopCode');
    var adminUser = document.getElementById('regAdminUser');
    var adminPass = document.getElementById('regAdminPass');
    var confirmPass = document.getElementById('regConfirmPass');
    var errorEl = document.getElementById('registerError');
    var btn = document.getElementById('registerBtn');
    
    if (!shopName || !shopCode || !adminUser || !adminPass || !confirmPass) return;
    
    var name = shopName.value.trim();
    var code = shopCode.value.trim();
    var user = adminUser.value.trim();
    var pass = adminPass.value;
    var confirm = confirmPass.value;
    
    if (!name || !code || !user || !pass) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập đầy đủ thông tin';
        return;
    }
    if (pass !== confirm) {
        if (errorEl) errorEl.innerText = 'Mật khẩu xác nhận không khớp';
        return;
    }
    
    if (btn) { btn.disabled = true; btn.innerText = 'Đang đăng ký...'; }
    if (errorEl) errorEl.innerText = '';
    
    DB.registerShop(name, code, user, pass).then(function(userData) {
        if (errorEl) errorEl.innerText = '';
        hideLoginScreen();
        applyRoleBasedUI(userData);
        showToast('Đăng ký POS thành công!', 'success');
        
        // Reload lại dữ liệu cho shop mới
        reloadAppData();
    }).catch(function(err) {
        if (errorEl) errorEl.innerText = err.message || 'Đăng ký thất bại';
        if (btn) { btn.disabled = false; btn.innerText = 'Đăng ký'; }
    });
}

// ========== ĐĂNG XUẤT ==========

function handleLogout() {
    if (!confirm('Bạn có chắc muốn đăng xuất?')) return;
    
    DB.logout();
    showToast('Đã đăng xuất', 'info');
    
    // Reload lại trang để reset toàn bộ dữ liệu
    window.location.reload();
}

// ========== PHÂN QUYỀN GIAO DIỆN ==========

function applyRoleBasedUI(user) {
    if (!user) return;
    
    // Cập nhật tên nhân viên trên header
    var staffNameEl = document.querySelector('.staff-name');
    if (staffNameEl) {
        var roleIcon = user.role === 'admin' ? '🛡️' : '👤';
        staffNameEl.innerHTML = roleIcon + ' ' + escapeHtml(user.displayName);
        staffNameEl.style.cursor = 'pointer';
        staffNameEl.title = 'Đăng xuất';
        staffNameEl.onclick = function() {
            if (confirm('Đăng xuất?')) handleLogout();
        };
    }
    
    // Ẩn/hiện tab Quản lý, Nhân viên, Menu-Tồn kho dựa trên role
    // Tab Báo cáo và Chi phí hiển thị cho tất cả (staff và admin)
    var managerTab = document.querySelector('.tab-btn[data-tab="manager"]');
    var staffTab = document.querySelector('.tab-btn[data-tab="staff"]');
    var inventoryTab = document.querySelector('.tab-btn[data-tab="inventory"]');
    var reportTab = document.querySelector('.tab-btn[data-tab="report"]');
    var costTab = document.querySelector('.tab-btn[data-tab="cost"]');
    if (user.role === 'admin') {
        if (managerTab) managerTab.style.display = '';
        if (staffTab) staffTab.style.display = '';
        if (inventoryTab) inventoryTab.style.display = '';
        if (reportTab) reportTab.style.display = '';
        if (costTab) costTab.style.display = '';
    } else {
        if (managerTab) managerTab.style.display = 'none';
        if (staffTab) staffTab.style.display = 'none';
        if (inventoryTab) inventoryTab.style.display = 'none';
        // Staff vẫn thấy tab Báo cáo và Chi phí
        if (reportTab) reportTab.style.display = '';
        if (costTab) costTab.style.display = '';
    }
    
    // Hiển thị mã POS trong tab nhân viên
    var posIdEl = document.getElementById('staffPosId');
    if (posIdEl) {
        posIdEl.textContent = '🏪 Mã POS: ' + (user.shopCode || '') + ' | ID: ' + (user.shopId || '');
    }
    // Hiển thị mã POS trong tab menu-tồn kho
    var invPosIdEl = document.getElementById('invPosId');
    if (invPosIdEl) {
        invPosIdEl.textContent = '🏪 Mã POS: ' + (user.shopCode || '') + ' | ID: ' + (user.shopId || '');
    }
}

// ========== RELOAD DỮ LIỆU ==========

function reloadAppData() {
    // FIX: Sau khi clearLocalData() xóa IndexedDB, cần force sync từ Firebase
    // trước khi loadData() để tránh render UI rỗng
    var doLoad = function() {
        return loadData().then(function() {
            // Re-render các tab
            if (typeof renderTables === 'function') renderTables();
            if (typeof renderCustomerList === 'function') renderCustomerList();
            if (typeof renderHistoryByDate === 'function') renderHistoryByDate(currentHistoryDate);
            if (typeof renderReport === 'function') renderReport(currentReportDate);
            if (typeof managerApplyFilter === 'function') managerApplyFilter();
            // Load staff list nếu là admin
            if (DB.isAdmin && DB.isAdmin() && typeof DB.getStaffs === 'function') {
                DB.getStaffs().then(function(staffs) {
                    if (typeof renderStaffList === 'function') renderStaffList(staffs);
                });
            }
        });
    };
    
    // Kiểm tra online và force sync nếu cần
    if (DB.isOnline() && typeof DB.forceSyncFromFirebase === 'function') {
        DB.forceSyncFromFirebase().then(function() {
            return doLoad();
        }).catch(function(err) {
            console.warn('⚠️ Force sync after login failed:', err);
            return doLoad();
        });
    } else {
        doLoad();
    }
}

// ========== QUẢN LÝ NHÂN VIÊN (ADMIN) ==========
// Đã chuyển hoàn toàn sang employees.js
// Các hàm dưới đây là fallback tối thiểu, employees.js sẽ ghi đè khi load

function openStaffManager() {
    // employees.js sẽ ghi đè hàm này khi load
    // Fallback: mở modal từ employees.js nếu có
    if (typeof window.openStaffManager === 'function') {
        window.openStaffManager();
    } else {
        showToast('⚠️ Chưa sẵn sàng (employees.js chưa load)', 'warning');
    }
}

function renderStaffList(staffs) {
    // employees.js sẽ ghi đè
}

function showAddStaffForm() {}
function hideAddStaffForm() {}
function handleAddStaff() {}

// Export global - employees.js sẽ ghi đè các hàm này khi load
window.initAuth = initAuth;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout = handleLogout;
window.showRegisterForm = showRegisterForm;
window.showLoginForm = showLoginForm;
window.openStaffManager = openStaffManager;
window.showAddStaffForm = showAddStaffForm;
window.hideAddStaffForm = hideAddStaffForm;
window.handleAddStaff = handleAddStaff;
