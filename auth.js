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
        var roleIcon = user.role === 'admin' ? '🛡️' : (user.role === 'master_admin' ? '👑' : '👤');
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
        // Master Admin: chỉ thấy tab Admin Dashboard + Settings
        if (managerTab) managerTab.style.display = 'none';
        if (staffTab) staffTab.style.display = 'none';
        if (inventoryTab) inventoryTab.style.display = 'none';
        if (reportTab) reportTab.style.display = 'none';
        if (costTab) costTab.style.display = 'none';
        if (adminTab) adminTab.style.display = '';
        // Load danh sách POS
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

// ========== MASTER ADMIN: QUẢN LÝ DANH SÁCH POS ==========

function loadAdminDashboard() {
    var listEl = document.getElementById('adminShopList');
    if (!listEl) return;
    
    listEl.innerHTML = '<div class="permission-loading">Đang tải danh sách POS...</div>';
    
    DB.getAllShops().then(function(shops) {
        if (!shops || shops.length === 0) {
            listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#888;">Chưa có POS nào được đăng ký.</div>';
            return;
        }
        
        var html = '<div style="overflow-x:auto;">';
        html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
        html += '<thead><tr style="background:#f1f5f9;">';
        html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Mã POS</th>';
        html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Tên quán</th>';
        html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Tài khoản</th>';
        html += '<th style="padding:8px;text-align:left;border-bottom:2px solid #e2e8f0;">Mật khẩu</th>';
        html += '<th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">Trạng thái</th>';
        html += '<th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">Firebase</th>';
        html += '<th style="padding:8px;text-align:center;border-bottom:2px solid #e2e8f0;">Thao tác</th>';
        html += '</tr></thead><tbody>';
        
        shops.forEach(function(shop) {
            var statusColor = shop.status === 'active' ? '#22c55e' : (shop.status === 'locked' ? '#ef4444' : '#888');
            var statusText = shop.status === 'active' ? '✅ Hoạt động' : (shop.status === 'locked' ? '🔒 Đã khóa' : '🗑️ Đã xóa');
            var fbText = shop.hasCustomConfig ? '🔥 Riêng' : '☁️ Mặc định';
            
            html += '<tr style="border-bottom:1px solid #f1f5f9;">';
            html += '<td style="padding:8px;font-weight:bold;">' + escapeHtml(shop.shopCode) + '</td>';
            html += '<td style="padding:8px;">' + escapeHtml(shop.shopName) + '</td>';
            html += '<td style="padding:8px;">' + escapeHtml(shop.adminUsername) + '</td>';
            html += '<td style="padding:8px;">';
            html += '<span id="pass_' + shop.shopCode + '" style="display:none;">' + escapeHtml(shop.adminPassword) + '</span>';
            html += '<span id="passMask_' + shop.shopCode + '">••••••</span>';
            html += ' <button onclick="togglePass(\'' + shop.shopCode + '\')" style="background:none;border:none;cursor:pointer;font-size:12px;">👁️</button>';
            html += '</td>';
            html += '<td style="padding:8px;text-align:center;"><span style="color:' + statusColor + ';">' + statusText + '</span></td>';
            html += '<td style="padding:8px;text-align:center;">' + fbText + '</td>';
            html += '<td style="padding:8px;text-align:center;white-space:nowrap;">';
            
            // Nút đăng nhập vào POS này
            html += '<button onclick="masterLoginToShop(\'' + shop.shopCode + '\',\'' + escapeHtml(shop.adminUsername) + '\',\'' + escapeHtml(shop.adminPassword) + '\')" style="background:#3b82f6;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;margin:2px;">🔑 Đăng nhập</button>';
            
            // Nếu đang active -> hiện nút Khóa
            if (shop.status === 'active') {
                html += '<button onclick="masterToggleShopStatus(\'' + shop.shopCode + '\',\'locked\')" style="background:#f59e0b;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;margin:2px;">🔒 Khóa</button>';
            }
            // Nếu đang locked -> hiện nút Mở khóa
            if (shop.status === 'locked') {
                html += '<button onclick="masterToggleShopStatus(\'' + shop.shopCode + '\',\'active\')" style="background:#22c55e;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;margin:2px;">🔓 Mở khóa</button>';
            }
            // Nút Xóa (chỉ khi không phải active)
            if (shop.status !== 'deleted') {
                html += '<button onclick="masterDeleteShop(\'' + shop.shopCode + '\')" style="background:#ef4444;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;margin:2px;">🗑️ Xóa</button>';
            }
            
            // Nút sửa thông tin admin
            html += '<br><button onclick="masterEditAdmin(\'' + shop.shopCode + '\',\'' + shop.shopId + '\',\'' + escapeHtml(shop.adminUsername) + '\')" style="background:#64748b;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;margin:2px;">✏️ Sửa TK</button>';
            
            html += '</td>';
            html += '</tr>';
        });
        
        html += '</tbody></table>';
        html += '<div style="margin-top:10px;font-size:12px;color:#888;text-align:center;">Tổng số: ' + shops.length + ' POS</div>';
        html += '</div>';
        
        listEl.innerHTML = html;
    }).catch(function(err) {
        listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;">❌ Lỗi tải danh sách: ' + (err.message || 'Unknown error') + '</div>';
    });
}

// Hiện/ẩn mật khẩu
function togglePass(shopCode) {
    var passEl = document.getElementById('pass_' + shopCode);
    var maskEl = document.getElementById('passMask_' + shopCode);
    if (!passEl || !maskEl) return;
    if (passEl.style.display === 'none') {
        passEl.style.display = 'inline';
        maskEl.style.display = 'none';
    } else {
        passEl.style.display = 'none';
        maskEl.style.display = 'inline';
    }
}

// Master Admin đăng nhập vào POS cụ thể
function masterLoginToShop(shopCode, username, password) {
    if (!confirm('Đăng nhập vào POS "' + shopCode + '" với tài khoản admin?\nSau đó có thể đăng xuất để quay lại Master Admin.')) return;
    
    DB.login(shopCode, username, password).then(function(userData) {
        hideLoginScreen();
        applyRoleBasedUI(userData);
        showToast('✅ Đã đăng nhập vào POS ' + shopCode, 'success');
        reloadAppData();
    }).catch(function(err) {
        showToast('❌ ' + (err.message || 'Đăng nhập thất bại'), 'error');
    });
}

// Master Admin khóa/mở khóa POS
function masterToggleShopStatus(shopCode, newStatus) {
    var actionText = newStatus === 'locked' ? 'khóa' : 'mở khóa';
    if (!confirm('Bạn có chắc muốn ' + actionText + ' POS "' + shopCode + '"?')) return;
    
    DB.updateShopStatus(shopCode, newStatus).then(function() {
        showToast('✅ Đã ' + actionText + ' POS ' + shopCode, 'success');
        loadAdminDashboard(); // Reload danh sách
    }).catch(function(err) {
        showToast('❌ Lỗi: ' + (err.message || 'Thất bại'), 'error');
    });
}

// Master Admin xóa POS
function masterDeleteShop(shopCode) {
    if (!confirm('⚠️ Bạn có chắc muốn xóa POS "' + shopCode + '"?\nPOS sẽ không thể đăng nhập được nữa.')) return;
    if (!confirm('Xác nhận lần cuối: Xóa POS "' + shopCode + '"?')) return;
    
    DB.updateShopStatus(shopCode, 'deleted').then(function() {
        showToast('✅ Đã xóa POS ' + shopCode, 'success');
        loadAdminDashboard();
    }).catch(function(err) {
        showToast('❌ Lỗi: ' + (err.message || 'Thất bại'), 'error');
    });
}

// Master Admin sửa thông tin đăng nhập admin của POS
function masterEditAdmin(shopCode, shopId, currentUsername) {
    var newUsername = prompt('Nhập tên đăng nhập mới cho POS "' + shopCode + '":', currentUsername);
    if (newUsername === null) return; // Hủy
    
    var newPassword = prompt('Nhập mật khẩu mới cho POS "' + shopCode + '":');
    if (newPassword === null) return; // Hủy
    
    if (!newUsername && !newPassword) {
        showToast('⚠️ Vui lòng nhập ít nhất tên đăng nhập hoặc mật khẩu mới', 'warning');
        return;
    }
    
    DB.updateShopAdmin(shopCode, shopId, newUsername || null, newPassword || null).then(function() {
        showToast('✅ Đã cập nhật thông tin admin cho POS ' + shopCode, 'success');
        loadAdminDashboard();
    }).catch(function(err) {
        showToast('❌ Lỗi: ' + (err.message || 'Thất bại'), 'error');
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
window.loadAdminDashboard = loadAdminDashboard;
window.togglePass = togglePass;
window.masterLoginToShop = masterLoginToShop;
window.masterToggleShopStatus = masterToggleShopStatus;
window.masterDeleteShop = masterDeleteShop;
window.masterEditAdmin = masterEditAdmin;
