// auth.js - Module đăng nhập/đăng ký POS
// ES5, tương thích Android 6, iOS 12
// Hỗ trợ đăng nhập bằng mã POS + user/pass, đăng ký POS mới

// ========== BIẾN GLOBAL ==========
var authInitialized = false;

// escapeHtml - định nghĩa sẵn để dùng trong auth.js (pos-app.js cũng có nhưng load sau)
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&';
        if (m === '<') return '<';
        if (m === '>') return '>';
        return m;
    });
}

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
    
    // Khôi phục thông tin đăng nhập đã lưu
    var savedShopCode = localStorage.getItem('pos_saved_shopCode');
    var savedUsername = localStorage.getItem('pos_saved_username');
    var savedRemember = localStorage.getItem('pos_remember_login');
    
    var shopCodeInput = document.getElementById('loginShopCode');
    var usernameInput = document.getElementById('loginUsername');
    var rememberCheck = document.getElementById('rememberLogin');
    
    if (shopCodeInput && savedShopCode) shopCodeInput.value = savedShopCode;
    if (usernameInput && savedUsername) usernameInput.value = savedUsername;
    if (rememberCheck) rememberCheck.checked = (savedRemember === 'true');
    
    // Focus vào ô nhập mã POS
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
        
        // Lưu thông tin đăng nhập nếu checkbox "Ghi nhớ" được chọn
        var rememberCheck = document.getElementById('rememberLogin');
        if (rememberCheck && rememberCheck.checked) {
            localStorage.setItem('pos_saved_shopCode', code);
            localStorage.setItem('pos_saved_username', user);
            localStorage.setItem('pos_remember_login', 'true');
        } else {
            localStorage.removeItem('pos_saved_shopCode');
            localStorage.removeItem('pos_saved_username');
            localStorage.removeItem('pos_remember_login');
        }
        
        // FIX: Đợi reload dữ liệu xong mới hiển thị UI
        // Tránh hiển thị dữ liệu mặc định/rỗng trước khi load xong
        reloadAppData().then(function() {
            hideLoginScreen();
            applyRoleBasedUI(userData);
            showToast('Đăng nhập thành công! Chào ' + userData.displayName, 'success');
        }).catch(function() {
            // Nếu reload lỗi vẫn hiển thị UI để user có thể thao tác
            hideLoginScreen();
            applyRoleBasedUI(userData);
            showToast('Đăng nhập thành công!', 'success');
        });
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
    
    // Xác định role thực tế: admin của POS mặc định (shopId === 'shop_default') cũng là master admin
    var effectiveRole = user.role;
    var isMasterAdmin = (user.role === 'master_admin') || (user.role === 'admin' && user.shopId === 'shop_default');
    if (isMasterAdmin) {
        effectiveRole = 'master_admin';
    }
    
    // Cập nhật tên nhân viên trên header
    var staffNameEl = document.querySelector('.staff-name');
    if (staffNameEl) {
        var roleIcon = effectiveRole === 'master_admin' ? '👑' : (user.role === 'admin' ? '🛡️' : '👤');
        staffNameEl.innerHTML = roleIcon + ' ' + escapeHtml(user.displayName);
        staffNameEl.style.cursor = 'pointer';
        staffNameEl.title = 'Đăng xuất';
        staffNameEl.onclick = function() {
            if (confirm('Đăng xuất?')) handleLogout();
        };
    }
    
    // Ẩn/hiện tab dựa trên role
    var managerTab = document.querySelector('.tab-btn[data-tab="manager"]');
    var staffTab = document.querySelector('.tab-btn[data-tab="staff"]');
    var inventoryTab = document.querySelector('.tab-btn[data-tab="inventory"]');
    var reportTab = document.querySelector('.tab-btn[data-tab="report"]');
    var costTab = document.querySelector('.tab-btn[data-tab="cost"]');
    var adminTab = document.querySelector('.tab-btn[data-tab="admin"]');
    
    if (user.role === 'master_admin') {
        // Master Admin thực sự: chỉ thấy tab Admin + Settings
        if (managerTab) managerTab.style.display = 'none';
        if (staffTab) staffTab.style.display = 'none';
        if (inventoryTab) inventoryTab.style.display = 'none';
        if (reportTab) reportTab.style.display = 'none';
        if (costTab) costTab.style.display = 'none';
        if (adminTab) adminTab.style.display = '';
        if (typeof loadAdminDashboard === 'function') {
            setTimeout(loadAdminDashboard, 100);
        }
    } else if (isMasterAdmin) {
        // Admin của POS mặc định: thấy cả tab quản lý + tab Admin
        if (managerTab) managerTab.style.display = '';
        if (staffTab) staffTab.style.display = '';
        if (inventoryTab) inventoryTab.style.display = '';
        if (reportTab) reportTab.style.display = '';
        if (costTab) costTab.style.display = '';
        if (adminTab) adminTab.style.display = '';
        if (typeof loadAdminDashboard === 'function') {
            setTimeout(loadAdminDashboard, 100);
        }
    } else if (user.role === 'admin') {
        if (managerTab) managerTab.style.display = '';
        if (staffTab) staffTab.style.display = '';
        if (inventoryTab) inventoryTab.style.display = '';
        if (reportTab) reportTab.style.display = '';
        if (costTab) costTab.style.display = '';
        if (adminTab) adminTab.style.display = 'none';
    } else {
        if (managerTab) managerTab.style.display = 'none';
        if (staffTab) staffTab.style.display = 'none';
        if (inventoryTab) inventoryTab.style.display = 'none';
        if (reportTab) reportTab.style.display = '';
        if (costTab) costTab.style.display = '';
        if (adminTab) adminTab.style.display = 'none';
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
        return DB.forceSyncFromFirebase().then(function() {
            return doLoad();
        }).catch(function(err) {
            console.warn('⚠️ Force sync after login failed:', err);
            return doLoad();
        });
    } else {
        return doLoad();
    }
}

// ========== ĐỔI MẬT KHẨU ==========

function handleChangePassword() {
    var currentPassEl = document.getElementById('changePassCurrent');
    var newPassEl = document.getElementById('changePassNew');
    var confirmPassEl = document.getElementById('changePassConfirm');
    var statusEl = document.getElementById('changePasswordStatus');
    
    if (!currentPassEl || !newPassEl || !confirmPassEl || !statusEl) return;
    
    var currentPass = currentPassEl.value;
    var newPass = newPassEl.value;
    var confirmPass = confirmPassEl.value;
    
    // Kiểm tra đầu vào
    if (!currentPass) {
        statusEl.innerHTML = '<span style="color:#ef4444;">Vui lòng nhập mật khẩu hiện tại</span>';
        currentPassEl.focus();
        return;
    }
    if (!newPass) {
        statusEl.innerHTML = '<span style="color:#ef4444;">Vui lòng nhập mật khẩu mới</span>';
        newPassEl.focus();
        return;
    }
    if (newPass.length < 4) {
        statusEl.innerHTML = '<span style="color:#ef4444;">Mật khẩu mới phải có ít nhất 4 ký tự</span>';
        newPassEl.focus();
        return;
    }
    if (newPass !== confirmPass) {
        statusEl.innerHTML = '<span style="color:#ef4444;">Mật khẩu xác nhận không khớp</span>';
        confirmPassEl.focus();
        return;
    }
    
    // Kiểm tra mật khẩu hiện tại
    var user = DB.getCurrentUser();
    if (!user) {
        statusEl.innerHTML = '<span style="color:#ef4444;">Bạn chưa đăng nhập</span>';
        return;
    }
    
    // Chỉ admin mới được đổi mật khẩu
    if (user.role !== 'admin' && user.role !== 'master_admin') {
        statusEl.innerHTML = '<span style="color:#ef4444;">Chỉ admin mới có thể đổi mật khẩu</span>';
        return;
    }
    
    // Xác thực mật khẩu hiện tại (so sánh với session đã lưu)
    // Lưu ý: password được lưu trong session nhưng không hiển thị trong currentUser
    // Nên cần kiểm tra qua DB.login() để xác thực
    statusEl.innerHTML = '<span style="color:#fbbf24;">⏳ Đang xác thực...</span>';
    
    // Dùng DB.login để xác thực mật khẩu hiện tại
    DB.login(user.shopCode, user.username, currentPass).then(function() {
        // Xác thực thành công, tiến hành đổi mật khẩu
        statusEl.innerHTML = '<span style="color:#fbbf24;">⏳ Đang đổi mật khẩu...</span>';
        
        return DB.changePassword(user.shopId, user.id, newPass);
    }).then(function() {
        statusEl.innerHTML = '<span style="color:#22c55e;">✅ Đổi mật khẩu thành công!</span>';
        // Xóa các trường nhập
        if (currentPassEl) currentPassEl.value = '';
        if (newPassEl) newPassEl.value = '';
        if (confirmPassEl) confirmPassEl.value = '';
        showToast('🔑 Đã đổi mật khẩu thành công', 'success');
    }).catch(function(err) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ ' + (err.message || 'Đổi mật khẩu thất bại') + '</span>';
    });
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
