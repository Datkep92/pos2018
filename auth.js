// auth.js - Module đăng nhập/đăng ký POS
// ES5, tương thích Android 6, iOS 12
// Hỗ trợ đăng nhập bằng mã POS + user/pass, đăng ký POS mới
// Tích hợp MASTER_CONFIG cho multi-tenant

// ========== BIẾN GLOBAL ==========
var authInitialized = false;
var _lockMonitorRef = null; // Firebase ref để theo dõi trạng thái khóa POS

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
        
        // Nếu là master admin, load danh sách POS
        if (user.role === 'master_admin' && typeof loadMasterPosList === 'function') {
            loadMasterPosList();
        }
        
        // Nếu là POS user (không phải master admin), theo dõi trạng thái khóa
        if (user.role !== 'master_admin' && user.shopCode) {
            startLockMonitor(user.shopCode);
        }
    } else {
        // Chưa đăng nhập, hiện màn hình login
        showLoginScreen();
    }
}

// ========== THEO DÕI KHÓA POS ==========
/**
 * Theo dõi trạng thái khóa của POS trong shop_registry.
 * Nếu POS bị khóa từ xa bởi Master Admin, tự động đăng xuất.
 * @param {string} shopCode - Mã POS cần theo dõi
 */
function startLockMonitor(shopCode) {
    // Dừng monitor cũ nếu có
    stopLockMonitor();
    
    if (!shopCode) return;
    
    try {
        // Dùng _origFirebaseDatabase để đọc từ default Firebase (shop_registry)
        var db = (typeof DB !== 'undefined' && DB._origFirebaseDatabase)
            ? DB._origFirebaseDatabase()
            : (typeof firebase !== 'undefined' ? firebase.database() : null);
        
        if (!db) return;
        
        _lockMonitorRef = db.ref('shop_registry/' + shopCode + '/locked');
        
        // Lắng nghe sự thay đổi của trường locked
        _lockMonitorRef.on('value', function(snapshot) {
            var isLocked = snapshot.val();
            if (isLocked === true) {
                // POS bị khóa từ xa! Buộc đăng xuất
                console.warn('🔒 POS "' + shopCode + '" đã bị khóa bởi Master Admin. Đang đăng xuất...');
                
                // Dừng monitor trước khi logout để tránh loop
                stopLockMonitor();
                
                // Hiển thị thông báo
                if (typeof showToast === 'function') {
                    showToast('🔒 POS đã bị khóa bởi Master Admin. Đang đăng xuất...', 'error', 5000);
                }
                
                // Đăng xuất
                if (typeof DB !== 'undefined' && DB.logout) {
                    DB.logout();
                }
                
                // Reload trang sau 1.5 giây để reset toàn bộ
                setTimeout(function() {
                    window.location.reload();
                }, 1500);
            }
        }, function(error) {
            // Lỗi permission - thường do chưa đăng nhập, bỏ qua
            console.warn('[LockMonitor] Error:', error.message);
        });
    } catch(e) {
        console.warn('[LockMonitor] Init error:', e.message);
    }
}

/**
 * Dừng theo dõi khóa POS.
 */
function stopLockMonitor() {
    if (_lockMonitorRef) {
        try {
            _lockMonitorRef.off('value');
        } catch(e) {
            // Ignore
        }
        _lockMonitorRef = null;
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
    
    if (!user || !pass) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập tên đăng nhập và mật khẩu';
        return;
    }
    
    // Nếu là master admin (admin123123), không cần mã POS
    var isMasterAttempt = (user === 'admin123123' && pass === '123123');
    if (!isMasterAttempt && !code) {
        if (errorEl) errorEl.innerText = 'Vui lòng nhập mã POS';
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
        var loginDisplayName = userData.displayName;
        if (loginDisplayName && loginDisplayName.indexOf('Master Admin') === 0) {
            loginDisplayName = 'Master';
        }
        showToast('Đăng nhập thành công! Chào ' + loginDisplayName, 'success');
        
        // Master admin có nhập mã POS: vào POS đó với quyền master, không cần lock monitor
        // Master admin không nhập mã POS: vào Master Control
        // POS user thường: cần theo dõi khóa POS
        if (userData.role !== 'master_admin' && code) {
            startLockMonitor(code);
        }
        
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
        
        // Bắt đầu theo dõi khóa POS
        startLockMonitor(code);
        
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
    
    // Dừng theo dõi khóa POS
    stopLockMonitor();
    
    DB.logout();
    showToast('Đã đăng xuất', 'info');
    
    // Reload lại trang để reset toàn bộ dữ liệu
    window.location.reload();
}

// ========== HÀM KIỂM TRA QUYỀN GLOBAL ==========

/**
 * Kiểm tra user hiện tại có quyền admin không.
 * Hỗ trợ: 'admin', 'master_admin', 'pos_admin'
 * Dùng trong các file expense.js, history.js, settings.js, employees.js
 */
function isAdminUser() {
    var user = typeof DB !== 'undefined' && DB.getCurrentUser ? DB.getCurrentUser() : null;
    return user && (user.role === 'admin' || user.role === 'master_admin' || user.role === 'pos_admin');
}

// ========== PHÂN QUYỀN GIAO DIỆN ==========

function applyRoleBasedUI(user) {
    if (!user) return;
    
    // Cập nhật tên nhân viên trên header
    var staffNameEl = document.querySelector('.staff-name');
    if (staffNameEl) {
        var roleIcon = user.role === 'master_admin' ? '\uD83D\uDC51' : (user.role === 'admin' ? '\uD83D\uDEE1\uFE0F' : '\uD83D\uDC64');
        var displayName = user.displayName;
        // Rút gọn "Master Admin - ..." thành "Master"
        if (displayName && displayName.indexOf('Master Admin') === 0) {
            displayName = 'Master';
        }
        staffNameEl.innerHTML = roleIcon + ' ' + escapeHtml(displayName);
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
    var masterTab = document.querySelector('.tab-btn[data-tab="master"]');
    
    if (user.role === 'master_admin') {
        // Master admin: hiển thị đầy đủ như admin + thêm tab Master
        if (managerTab) managerTab.style.display = '';
        if (staffTab) staffTab.style.display = '';
        if (inventoryTab) inventoryTab.style.display = '';
        if (reportTab) reportTab.style.display = '';
        if (costTab) costTab.style.display = '';
        if (masterTab) masterTab.style.display = '';
    } else if (user.role === 'admin') {
        if (managerTab) managerTab.style.display = '';
        if (staffTab) staffTab.style.display = '';
        if (inventoryTab) inventoryTab.style.display = '';
        if (reportTab) reportTab.style.display = '';
        if (costTab) costTab.style.display = '';
        if (masterTab) masterTab.style.display = 'none';
    } else {
        if (managerTab) managerTab.style.display = 'none';
        if (staffTab) staffTab.style.display = 'none';
        if (inventoryTab) inventoryTab.style.display = 'none';
        if (reportTab) reportTab.style.display = '';
        if (costTab) costTab.style.display = '';
        if (masterTab) masterTab.style.display = 'none';
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
window.isAdminUser = isAdminUser;
window.openStaffManager = openStaffManager;
window.showAddStaffForm = showAddStaffForm;
window.hideAddStaffForm = hideAddStaffForm;
window.handleAddStaff = handleAddStaff;
window.startLockMonitor = startLockMonitor;
window.stopLockMonitor = stopLockMonitor;
