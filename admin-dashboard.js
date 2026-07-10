// admin-dashboard.js - Module quản lý Admin Master Dashboard
// ES5, tương thích Android 6, iOS 12
// Tách riêng từ auth.js để dễ bảo trì và mở rộng

// ========== BIẾN NỘI BỘ ==========
var _adminDashboardLoaded = false;

// ========== LOAD DASHBOARD ==========
function loadAdminDashboard(forceReload) {
    var listEl = document.getElementById('adminShopList');
    if (!listEl) {
        console.warn('⚠️ loadAdminDashboard: Không tìm thấy #adminShopList');
        return;
    }
    
    // Nếu đã load rồi và không force reload thì bỏ qua
    if (_adminDashboardLoaded && !forceReload) {
        console.log('🔍 loadAdminDashboard() - Đã load trước đó, bỏ qua (forceReload=false)');
        return;
    }
    
    console.log('🔍 loadAdminDashboard() - Đang tải danh sách POS...');
    listEl.innerHTML = '<div class="admin-loading"><div class="admin-loading-spinner"></div><div>Đang tải danh sách POS...</div></div>';
    
    if (typeof DB === 'undefined' || !DB.getAllShops) {
        console.error('❌ loadAdminDashboard: DB.getAllShops không khả dụng');
        listEl.innerHTML = '<div class="admin-empty"><div class="admin-empty-icon">❌</div><div class="admin-empty-text">DB.getAllShops không khả dụng</div></div>';
        return;
    }
    
    DB.getAllShops().then(function(shops) {
        console.log('🔍 loadAdminDashboard() - Nhận được dữ liệu:', shops ? shops.length + ' POS' : 'null');
        
        // Header
        var html = '<div class="admin-container">';
        html += '<div class="admin-header">';
        html += '<h3>👑 Admin Master - Quản lý POS</h3>';
        html += '<div class="admin-subtitle">Quản lý tất cả POS đã đăng ký. Nhấn "Đăng nhập" để truy cập POS với tài khoản admin.</div>';
        html += '<div class="admin-actions">';
        html += '<button class="admin-btn admin-btn-primary" onclick="showCreatePosModal()">➕ Tạo POS mới</button>';
        html += '<button class="admin-btn admin-btn-purple" onclick="showCreateMasterAdminModal()">👑 Tạo Master Admin</button>';
        html += '</div>';
        html += '</div>';
        
        if (!shops || shops.length === 0) {
            html += '<div class="admin-empty"><div class="admin-empty-icon">📭</div><div class="admin-empty-text">Chưa có POS nào được đăng ký.</div></div>';
            html += '</div>';
            listEl.innerHTML = html;
            _adminDashboardLoaded = true;
            return;
        }
        
        // Card grid
        html += '<div class="pos-card-grid">';
        
        shops.forEach(function(shop) {
            var statusClass = shop.status === 'active' ? 'active' : (shop.status === 'locked' ? 'locked' : 'deleted');
            var statusText = shop.status === 'active' ? '✅ Hoạt động' : (shop.status === 'locked' ? '🔒 Đã khóa' : '🗑️ Đã xóa');
            var fbText = shop.hasCustomConfig ? '🔥 Firebase riêng' : '☁️ Firebase mặc định';
            
            // Format ngày tạo
            var dateStr = '';
            if (shop.createdAt) {
                var d = new Date(shop.createdAt);
                dateStr = ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth()+1)).slice(-2) + '/' + d.getFullYear();
            }
            
            html += '<div class="pos-card">';
            
            // Header: Mã POS + Trạng thái
            html += '<div class="pos-card-header">';
            html += '<span class="pos-card-code">#' + escapeHtml(shop.shopCode) + '</span>';
            html += '<span class="pos-card-status ' + statusClass + '">' + statusText + '</span>';
            html += '</div>';
            
            // Body: thông tin
            html += '<div class="pos-card-body">';
            html += '<div class="pos-card-row">';
            html += '<span class="pos-card-label">Tên quán</span>';
            html += '<span class="pos-card-value">' + escapeHtml(shop.shopName) + '</span>';
            html += '</div>';
            
            html += '<div class="pos-card-row">';
            html += '<span class="pos-card-label">ID Shop</span>';
            html += '<span class="pos-card-value id-shop">' + escapeHtml(shop.shopId) + '</span>';
            html += '</div>';
            
            html += '<div class="pos-card-row">';
            html += '<span class="pos-card-label">Tài khoản</span>';
            html += '<span class="pos-card-value">' + escapeHtml(shop.adminUsername) + '</span>';
            html += '</div>';
            
            html += '<div class="pos-card-row">';
            html += '<span class="pos-card-label">Mật khẩu</span>';
            html += '<span class="pos-card-value">';
            html += '<span id="pass_' + shop.shopCode + '" style="display:none;">' + escapeHtml(shop.adminPassword) + '</span>';
            html += '<span id="passMask_' + shop.shopCode + '">••••••</span>';
            html += ' <button class="pass-toggle-btn" onclick="togglePass(\'' + shop.shopCode + '\')">👁️</button>';
            html += '</span>';
            html += '</div>';
            
            html += '<div class="pos-card-row fb-clickable" onclick="showFirebaseConfigModal(\'' + shop.shopCode + '\',\'' + shop.shopId + '\')">';
            html += '<span class="pos-card-label">Firebase</span>';
            html += '<span class="pos-card-value">' + fbText + '</span>';
            html += '</div>';
            
            if (dateStr) {
                html += '<div class="pos-card-row">';
                html += '<span class="pos-card-label">Ngày tạo</span>';
                html += '<span class="pos-card-value date">' + dateStr + '</span>';
                html += '</div>';
            }
            
            html += '</div>'; // end body
            
            // Actions
            html += '<div class="pos-card-actions">';
            
            // Đăng nhập
            html += '<button class="pos-card-action-btn login" onclick="masterLoginToShop(\'' + shop.shopCode + '\',\'' + escapeHtml(shop.adminUsername) + '\',\'' + escapeHtml(shop.adminPassword) + '\')">🔑 Đăng nhập</button>';
            
            // Khóa / Mở khóa
            if (shop.status === 'active') {
                html += '<button class="pos-card-action-btn lock" onclick="masterToggleShopStatus(\'' + shop.shopCode + '\',\'locked\')">🔒 Khóa</button>';
            }
            if (shop.status === 'locked') {
                html += '<button class="pos-card-action-btn unlock" onclick="masterToggleShopStatus(\'' + shop.shopCode + '\',\'active\')">🔓 Mở khóa</button>';
            }
            
            // Xóa
            if (shop.status !== 'deleted') {
                html += '<button class="pos-card-action-btn delete" onclick="masterDeleteShop(\'' + shop.shopCode + '\')">🗑️ Xóa</button>';
            }
            
            // Sửa TK
            html += '<button class="pos-card-action-btn edit" onclick="masterEditAdmin(\'' + shop.shopCode + '\',\'' + shop.shopId + '\',\'' + escapeHtml(shop.adminUsername) + '\')">✏️ Sửa TK</button>';
            
            html += '</div>'; // end actions
            html += '</div>'; // end card
        });
        
        html += '</div>'; // end grid
        
        // Summary
        html += '<div class="admin-summary">Tổng số: ' + shops.length + ' POS</div>';
        html += '</div>'; // end container
        
        listEl.innerHTML = html;
        _adminDashboardLoaded = true;
    }).catch(function(err) {
        listEl.innerHTML = '<div class="admin-empty"><div class="admin-empty-icon">❌</div><div class="admin-empty-text">Lỗi tải danh sách: ' + (err.message || 'Unknown error') + '</div></div>';
    });
}

// ========== HIỆN/ẨN MẬT KHẨU ==========
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

// ========== MASTER ADMIN: ĐĂNG NHẬP VÀO POS ==========
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

// ========== MASTER ADMIN: KHÓA/MỞ KHÓA POS ==========
function masterToggleShopStatus(shopCode, newStatus) {
    var actionText = newStatus === 'locked' ? 'khóa' : 'mở khóa';
    if (!confirm('Bạn có chắc muốn ' + actionText + ' POS "' + shopCode + '"?')) return;
    
    DB.updateShopStatus(shopCode, newStatus).then(function() {
        showToast('✅ Đã ' + actionText + ' POS ' + shopCode, 'success');
        // Cập nhật DOM trực tiếp, không render lại toàn bộ
        _updateShopCardStatus(shopCode, newStatus);
    }).catch(function(err) {
        showToast('❌ Lỗi: ' + (err.message || 'Thất bại'), 'error');
    });
}

// Cập nhật trạng thái card POS trên DOM (không render lại toàn bộ)
function _updateShopCardStatus(shopCode, newStatus) {
    // Tìm card của shop này
    var cards = document.querySelectorAll('.pos-card');
    for (var i = 0; i < cards.length; i++) {
        var codeEl = cards[i].querySelector('.pos-card-code');
        if (codeEl && codeEl.textContent.indexOf('#' + shopCode) !== -1) {
            // Cập nhật status badge
            var statusEl = cards[i].querySelector('.pos-card-status');
            if (statusEl) {
                var statusClass = newStatus === 'active' ? 'active' : (newStatus === 'locked' ? 'locked' : 'deleted');
                var statusText = newStatus === 'active' ? '✅ Hoạt động' : (newStatus === 'locked' ? '🔒 Đã khóa' : '🗑️ Đã xóa');
                statusEl.className = 'pos-card-status ' + statusClass;
                statusEl.textContent = statusText;
            }
            
            // Cập nhật actions: dựng lại toàn bộ nút dựa trên trạng thái mới
            var actionsEl = cards[i].querySelector('.pos-card-actions');
            if (actionsEl) {
                // Lấy thông tin từ các nút hiện tại
                var loginBtn = actionsEl.querySelector('.pos-card-action-btn.login');
                var deleteBtn = actionsEl.querySelector('.pos-card-action-btn.delete');
                var editBtn = actionsEl.querySelector('.pos-card-action-btn.edit');
                
                // Xóa toàn bộ nút cũ
                actionsEl.innerHTML = '';
                
                // Thêm nút Đăng nhập
                if (loginBtn) {
                    var newLogin = document.createElement('button');
                    newLogin.className = 'pos-card-action-btn login';
                    newLogin.innerHTML = '🔑 Đăng nhập';
                    newLogin.setAttribute('onclick', loginBtn.getAttribute('onclick'));
                    actionsEl.appendChild(newLogin);
                }
                
                // Thêm nút Khóa / Mở khóa tùy theo trạng thái
                if (newStatus === 'active') {
                    var lockBtn = document.createElement('button');
                    lockBtn.className = 'pos-card-action-btn lock';
                    lockBtn.innerHTML = '🔒 Khóa';
                    lockBtn.setAttribute('onclick', "masterToggleShopStatus('" + shopCode + "','locked')");
                    actionsEl.appendChild(lockBtn);
                } else if (newStatus === 'locked') {
                    var unlockBtn = document.createElement('button');
                    unlockBtn.className = 'pos-card-action-btn unlock';
                    unlockBtn.innerHTML = '🔓 Mở khóa';
                    unlockBtn.setAttribute('onclick', "masterToggleShopStatus('" + shopCode + "','active')");
                    actionsEl.appendChild(unlockBtn);
                }
                
                // Thêm nút Xóa (nếu không phải deleted)
                if (newStatus !== 'deleted') {
                    var newDelete = document.createElement('button');
                    newDelete.className = 'pos-card-action-btn delete';
                    newDelete.innerHTML = '🗑️ Xóa';
                    newDelete.setAttribute('onclick', "masterDeleteShop('" + shopCode + "')");
                    actionsEl.appendChild(newDelete);
                }
                
                // Thêm nút Sửa TK
                if (editBtn) {
                    var newEdit = document.createElement('button');
                    newEdit.className = 'pos-card-action-btn edit';
                    newEdit.innerHTML = '✏️ Sửa TK';
                    newEdit.setAttribute('onclick', editBtn.getAttribute('onclick'));
                    actionsEl.appendChild(newEdit);
                }
            }
            break;
        }
    }
}

// ========== MASTER ADMIN: XÓA POS ==========
function masterDeleteShop(shopCode) {
    if (!confirm('⚠️ Bạn có chắc muốn xóa POS "' + shopCode + '"?\nPOS sẽ không thể đăng nhập được nữa.')) return;
    if (!confirm('Xác nhận lần cuối: Xóa POS "' + shopCode + '"?')) return;
    
    DB.updateShopStatus(shopCode, 'deleted').then(function() {
        showToast('✅ Đã xóa POS ' + shopCode, 'success');
        _updateShopCardStatus(shopCode, 'deleted');
    }).catch(function(err) {
        showToast('❌ Lỗi: ' + (err.message || 'Thất bại'), 'error');
    });
}

// ========== MASTER ADMIN: SỬA THÔNG TIN ADMIN POS ==========
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
        // Cập nhật DOM trực tiếp
        var cards = document.querySelectorAll('.pos-card');
        for (var i = 0; i < cards.length; i++) {
            var codeEl = cards[i].querySelector('.pos-card-code');
            if (codeEl && codeEl.textContent.indexOf('#' + shopCode) !== -1) {
                // Cập nhật tên đăng nhập
                var rows = cards[i].querySelectorAll('.pos-card-row');
                for (var j = 0; j < rows.length; j++) {
                    var label = rows[j].querySelector('.pos-card-label');
                    if (label && label.textContent === 'Tài khoản') {
                        var val = rows[j].querySelector('.pos-card-value');
                        if (val && newUsername) val.textContent = newUsername;
                    }
                }
                break;
            }
        }
    }).catch(function(err) {
        showToast('❌ Lỗi: ' + (err.message || 'Thất bại'), 'error');
    });
}

// ========== MODAL: TẠO POS MỚI ==========
function showCreatePosModal() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:90%;max-width:480px;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    
    modal.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">' +
        '<h3 style="margin:0;font-size:18px;">➕ Tạo POS mới</h3>' +
        '<button onclick="this.closest(\'[data-overlay]\').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#888;">✕</button>' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;font-weight:bold;margin-bottom:4px;color:#374151;">Tên quán</label>' +
        '<input id="newPosName" type="text" placeholder="VD: Quán Cafe ABC" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;font-weight:bold;margin-bottom:4px;color:#374151;">Mã POS (shopCode)</label>' +
        '<input id="newPosCode" type="text" placeholder="VD: cafe-abc" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
        '<div style="font-size:11px;color:#888;margin-top:4px;">Chỉ gồm chữ thường, số và dấu gạch ngang. Không có khoảng trắng.</div>' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;font-weight:bold;margin-bottom:4px;color:#374151;">Tên đăng nhập admin</label>' +
        '<input id="newPosAdmin" type="text" placeholder="VD: admin" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:20px;">' +
        '<label style="display:block;font-size:13px;font-weight:bold;margin-bottom:4px;color:#374151;">Mật khẩu admin</label>' +
        '<input id="newPosPass" type="password" placeholder="VD: 123456" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
        '</div>' +
        '<div id="newPosStatus" style="font-size:13px;margin-bottom:12px;"></div>' +
        '<button onclick="handleCreatePos()" style="width:100%;background:#3b82f6;color:#fff;border:none;padding:10px;border-radius:6px;cursor:pointer;font-size:15px;font-weight:bold;">✅ Tạo POS</button>';
    
    overlay.setAttribute('data-overlay', '');
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// Xử lý tạo POS
function handleCreatePos() {
    var name = document.getElementById('newPosName');
    var code = document.getElementById('newPosCode');
    var admin = document.getElementById('newPosAdmin');
    var pass = document.getElementById('newPosPass');
    var statusEl = document.getElementById('newPosStatus');
    
    if (!name.value.trim()) { statusEl.innerHTML = '<span style="color:#ef4444;">Vui lòng nhập tên quán</span>'; name.focus(); return; }
    if (!code.value.trim()) { statusEl.innerHTML = '<span style="color:#ef4444;">Vui lòng nhập mã POS</span>'; code.focus(); return; }
    if (!/^[a-z0-9-]+$/.test(code.value.trim())) { statusEl.innerHTML = '<span style="color:#ef4444;">Mã POS chỉ gồm chữ thường, số và dấu gạch ngang</span>'; code.focus(); return; }
    if (!admin.value.trim()) { statusEl.innerHTML = '<span style="color:#ef4444;">Vui lòng nhập tên đăng nhập admin</span>'; admin.focus(); return; }
    if (!pass.value.trim()) { statusEl.innerHTML = '<span style="color:#ef4444;">Vui lòng nhập mật khẩu admin</span>'; pass.focus(); return; }
    if (pass.value.trim().length < 4) { statusEl.innerHTML = '<span style="color:#ef4444;">Mật khẩu phải có ít nhất 4 ký tự</span>'; pass.focus(); return; }
    
    statusEl.innerHTML = '<span style="color:#fbbf24;">⏳ Đang tạo POS...</span>';
    
    if (typeof DB === 'undefined' || !DB.registerShop) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ DB.registerShop không khả dụng</span>';
        return;
    }
    
    DB.registerShop(name.value.trim(), code.value.trim(), admin.value.trim(), pass.value.trim()).then(function(result) {
        statusEl.innerHTML = '<span style="color:#22c55e;">✅ Tạo POS thành công!</span>';
        setTimeout(function() {
            var overlay = document.querySelector('[data-overlay]');
            if (overlay) overlay.remove();
            loadAdminDashboard();
        }, 1500);
    }).catch(function(err) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ ' + (err.message || 'Lỗi không xác định') + '</span>';
    });
}

// ========== MODAL: TẠO MASTER ADMIN ==========
function showCreateMasterAdminModal() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
    
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:90%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    
    modal.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">' +
        '<h3 style="margin:0;font-size:18px;">👑 Tạo Master Admin</h3>' +
        '<button onclick="this.closest(\'[data-overlay]\').remove()" style="background:none;border:none;font-size:24px;cursor:pointer;color:#888;">✕</button>' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;font-weight:bold;margin-bottom:4px;color:#374151;">Tên đăng nhập</label>' +
        '<input id="newMasterUser" type="text" placeholder="VD: superadmin" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;font-weight:bold;margin-bottom:4px;color:#374151;">Mật khẩu</label>' +
        '<input id="newMasterPass" type="password" placeholder="VD: 123456" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
        '<label style="display:block;font-size:13px;font-weight:bold;margin-bottom:4px;color:#374151;">Tên hiển thị</label>' +
        '<input id="newMasterName" type="text" placeholder="VD: Super Admin" style="width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;box-sizing:border-box;">' +
        '</div>' +
        '<div id="newMasterStatus" style="font-size:13px;margin-bottom:12px;"></div>' +
        '<button onclick="handleCreateMasterAdmin()" style="width:100%;background:#8b5cf6;color:#fff;border:none;padding:10px;border-radius:6px;cursor:pointer;font-size:15px;font-weight:bold;">👑 Tạo Master Admin</button>';
    
    overlay.setAttribute('data-overlay', '');
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// Xử lý tạo Master Admin
function handleCreateMasterAdmin() {
    var user = document.getElementById('newMasterUser');
    var pass = document.getElementById('newMasterPass');
    var name = document.getElementById('newMasterName');
    var statusEl = document.getElementById('newMasterStatus');
    
    if (!user.value.trim()) { statusEl.innerHTML = '<span style="color:#ef4444;">Vui lòng nhập tên đăng nhập</span>'; user.focus(); return; }
    if (!pass.value.trim()) { statusEl.innerHTML = '<span style="color:#ef4444;">Vui lòng nhập mật khẩu</span>'; pass.focus(); return; }
    if (pass.value.trim().length < 4) { statusEl.innerHTML = '<span style="color:#ef4444;">Mật khẩu phải có ít nhất 4 ký tự</span>'; pass.focus(); return; }
    
    statusEl.innerHTML = '<span style="color:#fbbf24;">⏳ Đang tạo...</span>';
    
    if (typeof DB === 'undefined' || !DB.createMasterAdmin) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ DB.createMasterAdmin không khả dụng</span>';
        return;
    }
    
    DB.createMasterAdmin(user.value.trim(), pass.value.trim(), name.value.trim() || user.value.trim()).then(function(result) {
        statusEl.innerHTML = '<span style="color:#22c55e;">✅ Tạo master admin thành công!</span>';
        setTimeout(function() {
            var overlay = document.querySelector('[data-overlay]');
            if (overlay) overlay.remove();
        }, 1500);
    }).catch(function(err) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ ' + (err.message || 'Lỗi không xác định') + '</span>';
    });
}

// ========== MODAL: CẤU HÌNH FIREBASE CHO TỪNG POS ==========
function showFirebaseConfigModal(shopCode, shopId) {
    // Tạo overlay
    var overlay = document.createElement('div');
    overlay.className = 'fb-modal-overlay';
    
    var modal = document.createElement('div');
    modal.className = 'fb-modal';
    
    // Header
    var header = document.createElement('div');
    header.className = 'fb-modal-header';
    header.innerHTML = '<h3>🔥 Cấu hình Firebase - #' + escapeHtml(shopCode) + '</h3>' +
        '<button class="fb-modal-close" onclick="this.closest(\'.fb-modal-overlay\').remove()">✕</button>';
    modal.appendChild(header);
    
    // Body
    var body = document.createElement('div');
    body.className = 'fb-modal-body';
    
    // Info
    var info = document.createElement('div');
    info.className = 'fb-modal-info';
    info.id = 'fbModalInfo_' + shopCode;
    info.innerHTML = '⏳ Đang tải cấu hình...';
    body.appendChild(info);
    
    // Form fields
    var fields = [
        { id: 'fbApiKey_' + shopCode, label: 'API Key', placeholder: 'AIzaSy...' },
        { id: 'fbAuthDomain_' + shopCode, label: 'Auth Domain', placeholder: 'project.firebaseapp.com' },
        { id: 'fbDatabaseURL_' + shopCode, label: 'Database URL', placeholder: 'https://project-default-rtdb.firebaseio.com' },
        { id: 'fbProjectId_' + shopCode, label: 'Project ID', placeholder: 'project-id' },
        { id: 'fbStorageBucket_' + shopCode, label: 'Storage Bucket', placeholder: 'project.appspot.com' },
        { id: 'fbMessagingSenderId_' + shopCode, label: 'Messaging Sender ID', placeholder: '123456789' },
        { id: 'fbAppId_' + shopCode, label: 'App ID', placeholder: '1:123456789:web:abc123' }
    ];
    
    for (var i = 0; i < fields.length; i++) {
        var fieldDiv = document.createElement('div');
        fieldDiv.className = 'fb-modal-field';
        fieldDiv.innerHTML = '<label for="' + fields[i].id + '">' + fields[i].label + '</label>' +
            '<input type="text" id="' + fields[i].id + '" placeholder="' + fields[i].placeholder + '">';
        body.appendChild(fieldDiv);
    }
    
    // Status
    var statusDiv = document.createElement('div');
    statusDiv.className = 'fb-modal-status';
    statusDiv.id = 'fbModalStatus_' + shopCode;
    body.appendChild(statusDiv);
    
    // Actions
    var actions = document.createElement('div');
    actions.className = 'fb-modal-actions';
    actions.innerHTML =
        '<button class="fb-modal-btn save" onclick="masterSaveFirebaseConfig(\'' + shopCode + '\',\'' + shopId + '\')">💾 Lưu cấu hình</button>' +
        '<button class="fb-modal-btn sync" onclick="masterSyncFirebaseData(\'' + shopCode + '\',\'' + shopId + '\')">🔄 Đồng bộ dữ liệu</button>' +
        '<button class="fb-modal-btn test" onclick="masterTestFirebaseConfig(\'' + shopCode + '\')">🔌 Kiểm tra</button>' +
        '<button class="fb-modal-btn clear" onclick="masterClearFirebaseConfig(\'' + shopCode + '\',\'' + shopId + '\')">🗑️ Xóa cấu hình</button>' +
        '<button class="fb-modal-btn cancel" onclick="this.closest(\'.fb-modal-overlay\').remove()">✕ Đóng</button>';
    body.appendChild(actions);
    
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Load config từ Master Firebase
    _loadFirebaseConfigToModal(shopCode, shopId);
}

// Load Firebase config vào modal
function _loadFirebaseConfigToModal(shopCode, shopId) {
    var infoEl = document.getElementById('fbModalInfo_' + shopCode);
    var statusEl = document.getElementById('fbModalStatus_' + shopCode);
    
    try {
        var masterDb = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : null;
        if (!masterDb) {
            if (infoEl) infoEl.innerHTML = '⚠️ Không tìm thấy Master Firebase DB';
            return;
        }
        
        // Load shop registry để biết trạng thái + lấy firebaseConfig (nếu có)
        masterDb.ref('shop_registry/' + shopCode).once('value').then(function(snap) {
            var shopData = snap.val() || {};
            var hasCustom = shopData.hasCustomConfig;
            var fbConfig = shopData.firebaseConfig || null;
            
            if (infoEl) {
                if (hasCustom) {
                    infoEl.innerHTML = '✅ POS này đang dùng <strong>Firebase riêng</strong>. Bạn có thể sửa hoặc xóa cấu hình bên dưới.';
                } else {
                    infoEl.innerHTML = '☁️ POS này đang dùng <strong>Firebase mặc định</strong> (Master). Nhập thông tin Firebase mới để chuyển sang cấu hình riêng.';
                }
            }
            
            // Điền config vào form nếu có (đã lưu trong shop_registry)
            if (fbConfig) {
                _setFieldValue('fbApiKey_' + shopCode, fbConfig.apiKey || '');
                _setFieldValue('fbAuthDomain_' + shopCode, fbConfig.authDomain || '');
                _setFieldValue('fbDatabaseURL_' + shopCode, fbConfig.databaseURL || '');
                _setFieldValue('fbProjectId_' + shopCode, fbConfig.projectId || '');
                _setFieldValue('fbStorageBucket_' + shopCode, fbConfig.storageBucket || '');
                _setFieldValue('fbMessagingSenderId_' + shopCode, fbConfig.messagingSenderId || '');
                _setFieldValue('fbAppId_' + shopCode, fbConfig.appId || '');
            }
            if (statusEl) {
                statusEl.className = 'fb-modal-status';
                statusEl.innerHTML = '';
            }
        }).catch(function(err) {
            if (infoEl) infoEl.innerHTML = '⚠️ Lỗi tải cấu hình: ' + (err.message || 'Unknown error');
        });
    } catch(e) {
        if (infoEl) infoEl.innerHTML = '⚠️ Lỗi: ' + (e.message || 'Unknown error');
    }
}

function _setFieldValue(id, value) {
    var el = document.getElementById(id);
    if (el) el.value = value;
}

function _getFirebaseConfigFromModal(shopCode) {
    return {
        apiKey: _getFieldValue('fbApiKey_' + shopCode),
        authDomain: _getFieldValue('fbAuthDomain_' + shopCode),
        databaseURL: _getFieldValue('fbDatabaseURL_' + shopCode),
        projectId: _getFieldValue('fbProjectId_' + shopCode),
        storageBucket: _getFieldValue('fbStorageBucket_' + shopCode),
        messagingSenderId: _getFieldValue('fbMessagingSenderId_' + shopCode),
        appId: _getFieldValue('fbAppId_' + shopCode)
    };
}

function _getFieldValue(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

// Master Admin: Lưu Firebase config cho POS
function masterSaveFirebaseConfig(shopCode, shopId) {
    var statusEl = document.getElementById('fbModalStatus_' + shopCode);
    if (!statusEl) return;
    
    var config = _getFirebaseConfigFromModal(shopCode);
    if (!config.databaseURL) {
        statusEl.className = 'fb-modal-status error';
        statusEl.innerHTML = '❌ Vui lòng nhập ít nhất Database URL';
        return;
    }
    
    statusEl.className = 'fb-modal-status loading';
    statusEl.innerHTML = '⏳ Đang lưu cấu hình...';
    
    try {
        var masterDb = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : null;
        if (!masterDb) {
            statusEl.className = 'fb-modal-status error';
            statusEl.innerHTML = '❌ Không tìm thấy Master Firebase';
            return;
        }
        
        // Lưu config vào shop_registry (để khi login có thể đọc trực tiếp)
        // Đồng thời cập nhật hasCustomConfig = true
        masterDb.ref('shop_registry/' + shopCode).update({
            firebaseConfig: config,
            hasCustomConfig: true
        }).then(function() {
            statusEl.className = 'fb-modal-status success';
            statusEl.innerHTML = '✅ Đã lưu cấu hình Firebase cho POS ' + shopCode + '!';
            
            // Cập nhật DOM: đổi text Firebase row
            _updateFirebaseRow(shopCode, true);
        }).catch(function(err) {
            statusEl.className = 'fb-modal-status error';
            statusEl.innerHTML = '❌ Lỗi lưu: ' + (err.message || 'Unknown error');
        });
    } catch(e) {
        statusEl.className = 'fb-modal-status error';
        statusEl.innerHTML = '❌ Lỗi: ' + (e.message || 'Unknown error');
    }
}

// Master Admin: Xóa Firebase config (quay về Firebase mặc định)
function masterClearFirebaseConfig(shopCode, shopId) {
    var statusEl = document.getElementById('fbModalStatus_' + shopCode);
    if (!statusEl) return;
    
    if (!confirm('Xóa cấu hình Firebase riêng cho POS "' + shopCode + '"? Dữ liệu sẽ quay về Firebase mặc định.')) return;
    
    statusEl.className = 'fb-modal-status loading';
    statusEl.innerHTML = '⏳ Đang xóa cấu hình...';
    
    try {
        var masterDb = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : null;
        if (!masterDb) {
            statusEl.className = 'fb-modal-status error';
            statusEl.innerHTML = '❌ Không tìm thấy Master Firebase';
            return;
        }
        
        // Xóa firebaseConfig khỏi shop_registry
        masterDb.ref('shop_registry/' + shopCode + '/firebaseConfig').remove().then(function() {
            // Cập nhật hasCustomConfig = false
            return masterDb.ref('shop_registry/' + shopCode).update({
                hasCustomConfig: false
            });
        }).then(function() {
            statusEl.className = 'fb-modal-status success';
            statusEl.innerHTML = '✅ Đã xóa cấu hình Firebase riêng. POS sẽ dùng Firebase mặc định.';
            
            // Cập nhật DOM
            _updateFirebaseRow(shopCode, false);
        }).catch(function(err) {
            statusEl.className = 'fb-modal-status error';
            statusEl.innerHTML = '❌ Lỗi xóa: ' + (err.message || 'Unknown error');
        });
    } catch(e) {
        statusEl.className = 'fb-modal-status error';
        statusEl.innerHTML = '❌ Lỗi: ' + (e.message || 'Unknown error');
    }
}

// Master Admin: Kiểm tra kết nối Firebase config
function masterTestFirebaseConfig(shopCode) {
    var statusEl = document.getElementById('fbModalStatus_' + shopCode);
    if (!statusEl) return;
    
    var config = _getFirebaseConfigFromModal(shopCode);
    if (!config.databaseURL) {
        statusEl.className = 'fb-modal-status error';
        statusEl.innerHTML = '❌ Vui lòng nhập Database URL';
        return;
    }
    if (!config.apiKey) {
        statusEl.className = 'fb-modal-status error';
        statusEl.innerHTML = '❌ Vui lòng nhập API Key (cần để khởi tạo kết nối Firebase)';
        return;
    }
    
    statusEl.className = 'fb-modal-status loading';
    statusEl.innerHTML = '⏳ Đang kiểm tra kết nối...';
    
    try {
        var appName = 'test_admin_' + Date.now();
        var testApp = firebase.initializeApp(config, appName);
        var testDb = testApp.database();
        
        // Thử đọc một node bất kỳ để kiểm tra kết nối
        // .info/connected có thể không hoạt động với app tạm thời
        testDb.ref('/.info/connected').once('value').then(function(snapshot) {
            var connected = snapshot.val();
            if (connected === true) {
                statusEl.className = 'fb-modal-status success';
                statusEl.innerHTML = '✅ Kết nối thành công! Firebase config hợp lệ.';
            } else {
                // Thử đọc trực tiếp để kiểm tra
                return testDb.ref('/').once('value').then(function() {
                    statusEl.className = 'fb-modal-status success';
                    statusEl.innerHTML = '✅ Kết nối thành công! Firebase config hợp lệ.';
                }).catch(function(err2) {
                    statusEl.className = 'fb-modal-status error';
                    statusEl.innerHTML = '❌ Không thể kết nối. Lỗi: ' + (err2.message || 'Database URL không đúng hoặc Firebase chưa được khởi tạo.');
                });
            }
            testApp.delete().catch(function() {});
        }).catch(function(err) {
            // Fallback: thử đọc trực tiếp
            testDb.ref('/').once('value').then(function() {
                statusEl.className = 'fb-modal-status success';
                statusEl.innerHTML = '✅ Kết nối thành công! Firebase config hợp lệ.';
                testApp.delete().catch(function() {});
            }).catch(function(err2) {
                statusEl.className = 'fb-modal-status error';
                statusEl.innerHTML = '❌ Lỗi kết nối: ' + (err2.message || 'Không thể kết nối đến Firebase. Kiểm tra lại Database URL và API Key.');
                testApp.delete().catch(function() {});
            });
        });
    } catch(e) {
        statusEl.className = 'fb-modal-status error';
        statusEl.innerHTML = '❌ Lỗi: ' + (e.message || 'Không thể khởi tạo kết nối. Kiểm tra lại các thông số cấu hình.');
    }
}

// Master Admin: Đồng bộ dữ liệu từ Master Firebase sang Firebase riêng
function masterSyncFirebaseData(shopCode, shopId) {
    var statusEl = document.getElementById('fbModalStatus_' + shopCode);
    if (!statusEl) return;
    
    var config = _getFirebaseConfigFromModal(shopCode);
    if (!config.databaseURL) {
        statusEl.className = 'fb-modal-status error';
        statusEl.innerHTML = '❌ Vui lòng nhập Database URL của Firebase mới trước';
        return;
    }
    
    if (!confirm('Đồng bộ toàn bộ dữ liệu của POS "' + shopCode + '" từ Master Firebase sang Firebase mới?\n\nQuá trình này có thể mất vài phút. Dữ liệu cũ vẫn được giữ nguyên trên Master.')) return;
    
    statusEl.className = 'fb-modal-status loading';
    statusEl.innerHTML = '⏳ Đang đồng bộ dữ liệu...';
    
    try {
        var masterDb = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : null;
        if (!masterDb) {
            statusEl.className = 'fb-modal-status error';
            statusEl.innerHTML = '❌ Không tìm thấy Master Firebase';
            return;
        }
        
        // Tạo Slave app tạm thời
        var tempAppName = 'sync_admin_' + Date.now();
        var slaveApp = firebase.initializeApp(config, tempAppName);
        var slaveDb = slaveApp.database();
        
        // Danh sách collections cần đồng bộ
        var DATA_COLLECTIONS = [
            'info', 'shop_info', 'menu', 'menu_categories', 'ingredients',
            'tables', 'transactions', 'cost_transactions', 'messages',
            'daily_balances', 'manager_cash_pickups', 'responsibility_fund',
            'settings', 'esp32_config', 'sync_meta'
        ];
        
        var chain = Promise.resolve();
        var syncedCount = 0;
        
        DATA_COLLECTIONS.forEach(function(collection) {
            chain = chain.then(function() {
                return masterDb.ref(shopId + '/' + collection).once('value').then(function(snapshot) {
                    if (snapshot.exists()) {
                        var data = snapshot.val();
                        return slaveDb.ref(shopId + '/' + collection).set(data).then(function() {
                            syncedCount++;
                            statusEl.innerHTML = '⏳ Đã đồng bộ ' + syncedCount + '/' + DATA_COLLECTIONS.length + ' collections...';
                        });
                    } else {
                        syncedCount++;
                        return Promise.resolve();
                    }
                }).catch(function(err) {
                    console.warn('⚠️ Lỗi đồng bộ collection', collection, err);
                    syncedCount++;
                    return Promise.resolve();
                });
            });
        });
        
        chain.then(function() {
            statusEl.className = 'fb-modal-status success';
            statusEl.innerHTML = '✅ Đồng bộ hoàn tất! Đã đồng bộ ' + syncedCount + ' collections sang Firebase mới.';
            slaveApp.delete().catch(function() {});
        }).catch(function(err) {
            statusEl.className = 'fb-modal-status error';
            statusEl.innerHTML = '❌ Lỗi đồng bộ: ' + (err.message || 'Unknown error');
            slaveApp.delete().catch(function() {});
        });
    } catch(e) {
        statusEl.className = 'fb-modal-status error';
        statusEl.innerHTML = '❌ Lỗi: ' + (e.message || 'Unknown error');
    }
}

// Cập nhật dòng Firebase trên card POS (DOM only)
function _updateFirebaseRow(shopCode, hasCustomConfig) {
    var cards = document.querySelectorAll('.pos-card');
    for (var i = 0; i < cards.length; i++) {
        var codeEl = cards[i].querySelector('.pos-card-code');
        if (codeEl && codeEl.textContent.indexOf('#' + shopCode) !== -1) {
            var rows = cards[i].querySelectorAll('.pos-card-row');
            for (var j = 0; j < rows.length; j++) {
                var label = rows[j].querySelector('.pos-card-label');
                if (label && label.textContent === 'Firebase') {
                    var val = rows[j].querySelector('.pos-card-value');
                    if (val) {
                        val.textContent = hasCustomConfig ? '🔥 Firebase riêng' : '☁️ Firebase mặc định';
                    }
                    break;
                }
            }
            break;
        }
    }
}

// ========== EXPORT GLOBAL ==========
window.loadAdminDashboard = loadAdminDashboard;
window.togglePass = togglePass;
window.masterLoginToShop = masterLoginToShop;
window.masterToggleShopStatus = masterToggleShopStatus;
window.masterDeleteShop = masterDeleteShop;
window.masterEditAdmin = masterEditAdmin;
window.showCreatePosModal = showCreatePosModal;
window.handleCreatePos = handleCreatePos;
window.showCreateMasterAdminModal = showCreateMasterAdminModal;
window.handleCreateMasterAdmin = handleCreateMasterAdmin;
window.showFirebaseConfigModal = showFirebaseConfigModal;
window.masterSaveFirebaseConfig = masterSaveFirebaseConfig;
window.masterClearFirebaseConfig = masterClearFirebaseConfig;
window.masterTestFirebaseConfig = masterTestFirebaseConfig;
window.masterSyncFirebaseData = masterSyncFirebaseData;
