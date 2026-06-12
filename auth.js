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
        var roleText = user.role === 'admin' ? '🛡️ Admin' : '👤 Nhân viên';
        staffNameEl.innerHTML = roleText + ' - ' + escapeHtml(user.displayName) +
            ' <span class="logout-link" onclick="handleLogout()" style="font-size:11px;color:#f97316;cursor:pointer;margin-left:8px;">[Đăng xuất]</span>';
    }
    
    // Ẩn/hiện tab Quản lý, Nhân viên và Menu-Tồn kho dựa trên role
    var managerTab = document.querySelector('.tab-btn[data-tab="manager"]');
    var staffTab = document.querySelector('.tab-btn[data-tab="staff"]');
    var inventoryTab = document.querySelector('.tab-btn[data-tab="inventory"]');
    if (user.role === 'admin') {
        if (managerTab) managerTab.style.display = '';
        if (staffTab) staffTab.style.display = '';
        if (inventoryTab) inventoryTab.style.display = '';
    } else {
        if (managerTab) managerTab.style.display = 'none';
        if (staffTab) staffTab.style.display = 'none';
        if (inventoryTab) inventoryTab.style.display = 'none';
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

function openStaffManager() {
    if (!DB.isAdmin()) {
        showToast('Chỉ admin mới có thể quản lý nhân viên', 'warning');
        return;
    }
    
    var modal = document.getElementById('staffManagerModal');
    if (!modal) return;
    
    // Load danh sách nhân viên
    DB.getStaffs().then(function(staffs) {
        renderStaffList(staffs);
        openBottomSheet('staffManagerModal');
    }).catch(function(err) {
        showToast('Lỗi tải danh sách nhân viên', 'error');
    });
}

function renderStaffList(staffs) {
    var container = document.getElementById('staffList');
    if (!container) return;
    
    if (!staffs || staffs.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có nhân viên nào</div>';
        return;
    }
    
    var html = '';
    for (var i = 0; i < staffs.length; i++) {
        var s = staffs[i];
        var roleLabel = s.role === 'admin' ? '🛡️ Admin' : '👤 Nhân viên';
        var createdDate = '';
        if (s.createdAt) {
            try {
                createdDate = formatDateDisplay(new Date(s.createdAt).toISOString().slice(0, 10));
            } catch(e) {}
        }
        html += '<div class="staff-item">' +
            '<div class="staff-info">' +
                '<div class="staff-name-display"><strong>' + escapeHtml(s.displayName || s.username) + '</strong></div>' +
                '<div class="staff-username">@' + escapeHtml(s.username) + '</div>' +
                '<div class="staff-role">' + roleLabel + '</div>' +
            '</div>' +
            '<div class="staff-actions">' +
                (s.role !== 'admin' ? '<button class="btn-small btn-danger" onclick="deleteStaff(\'' + s.id + '\')">Xóa</button>' : '') +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;
}

function showAddStaffForm() {
    var form = document.getElementById('addStaffForm');
    if (form) form.style.display = 'block';
}

function hideAddStaffForm() {
    var form = document.getElementById('addStaffForm');
    if (form) form.style.display = 'none';
    // Clear form
    var username = document.getElementById('newStaffUsername');
    var password = document.getElementById('newStaffPassword');
    var displayName = document.getElementById('newStaffDisplayName');
    if (username) username.value = '';
    if (password) password.value = '';
    if (displayName) displayName.value = '';
}

function handleAddStaff() {
    var username = document.getElementById('newStaffUsername');
    var password = document.getElementById('newStaffPassword');
    var displayName = document.getElementById('newStaffDisplayName');
    var errorEl = document.getElementById('addStaffError');
    
    if (!username || !password) return;
    
    var user = username.value.trim();
    var pass = password.value;
    var name = displayName ? displayName.value.trim() : user;
    
    if (!user || !pass) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập tên đăng nhập và mật khẩu';
        return;
    }
    if (pass.length < 4) {
        if (errorEl) errorEl.innerText = 'Mật khẩu phải có ít nhất 4 ký tự';
        return;
    }
    
    if (errorEl) errorEl.innerText = '';
    
    DB.createStaff({
        username: user,
        password: pass,
        displayName: name,
        role: 'staff'
    }).then(function() {
        showToast('Thêm nhân viên thành công', 'success');
        hideAddStaffForm();
        // Reload danh sách
        return DB.getStaffs();
    }).then(function(staffs) {
        renderStaffList(staffs);
    }).catch(function(err) {
        if (errorEl) errorEl.innerText = err.message || 'Thêm nhân viên thất bại';
    });
}

function deleteStaff(staffId) {
    if (!staffId) return;
    if (!confirm('Bạn có chắc muốn xóa nhân viên này?')) return;
    
    var ref = firebase.database().ref(DB.getShopId() + '/staffs/' + staffId);
    ref.remove().then(function() {
        showToast('Đã xóa nhân viên', 'success');
        // Reload danh sách
        return DB.getStaffs();
    }).then(function(staffs) {
        renderStaffList(staffs);
    }).catch(function(err) {
        showToast('Lỗi xóa nhân viên', 'error');
    });
}

// Export global
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
window.deleteStaff = deleteStaff;
