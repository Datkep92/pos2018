// settings-firebase-config.js - Multi-Firebase config
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// ===== MULTI-FIREBASE: Cấu hình Firebase riêng cho POS =====
// Hiển thị section Firebase Config trong Settings nếu POS có config riêng
function _initFirebaseConfigSection() {
    var fbSection = document.getElementById('settingsFirebaseSection');
    if (!fbSection) return;
    
    // ẨN HOÀN TOÀN: Việc cấu hình Firebase riêng đã được chuyển sang Admin Master Dashboard
    // POS admin thường KHÔNG được tự cấu hình Firebase - chỉ Master Admin mới có quyền này
    fbSection.style.display = 'none';
    return;
    
    // Code cũ được giữ lại để tham khảo:
    // Chỉ hiển thị nếu user là admin
    var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
    if (!isAdmin) {
        fbSection.style.display = 'none';
        return;
    }
    
    // Kiểm tra xem POS hiện tại có config Firebase riêng không
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : '';
    if (!shopId) {
        fbSection.style.display = 'none';
        return;
    }
    
    // Luôn hiển thị section cho admin (có thể cấu hình)
    fbSection.style.display = '';
    
    // Load config từ Master Firebase nếu có
    try {
        var masterDb = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : null;
        if (masterDb) {
            masterDb.ref('firebase_config/' + shopId).once('value').then(function(snapshot) {
                if (snapshot.exists()) {
                    var config = snapshot.val() || {};
                    document.getElementById('fbApiKey').value = config.apiKey || '';
                    document.getElementById('fbAuthDomain').value = config.authDomain || '';
                    document.getElementById('fbDatabaseURL').value = config.databaseURL || '';
                    document.getElementById('fbProjectId').value = config.projectId || '';
                    document.getElementById('fbStorageBucket').value = config.storageBucket || '';
                    document.getElementById('fbMessagingSenderId').value = config.messagingSenderId || '';
                    document.getElementById('fbAppId').value = config.appId || '';
                }
            }).catch(function() {});
        }
    } catch(e) {}
}

// Kiểm tra kết nối Firebase config
function testFirebaseConfig() {
    var statusEl = document.getElementById('firebaseConfigStatus');
    if (!statusEl) return;
    
    var config = _getFirebaseConfigFromForm();
    if (!config.databaseURL) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Vui lòng nhập Database URL</span>';
        return;
    }
    
    statusEl.innerHTML = '<span style="color:#fbbf24;">⏳ Đang kiểm tra kết nối...</span>';
    
    try {
        // Thử tạo Firebase app tạm thời để kiểm tra
        var testApp = firebase.initializeApp(config, 'test_' + Date.now());
        var testDb = testApp.database();
        
        // Thử đọc dữ liệu từ Firebase
        testDb.ref('.info/connected').once('value').then(function(snapshot) {
            var connected = snapshot.val();
            if (connected) {
                statusEl.innerHTML = '<span style="color:#22c55e;">✅ Kết nối thành công! Firebase config hợp lệ.</span>';
            } else {
                statusEl.innerHTML = '<span style="color:#ef4444;">❌ Không thể kết nối đến Firebase. Kiểm tra lại Database URL.</span>';
            }
            // Cleanup test app
            testApp.delete().catch(function() {});
        }).catch(function(err) {
            statusEl.innerHTML = '<span style="color:#ef4444;">❌ Lỗi kết nối: ' + (err.message || 'Unknown error') + '</span>';
            testApp.delete().catch(function() {});
        });
    } catch(e) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Lỗi: ' + (e.message || 'Unknown error') + '</span>';
    }
}

// Lấy Firebase config từ form
function _getFirebaseConfigFromForm() {
    return {
        apiKey: (document.getElementById('fbApiKey') || {}).value || '',
        authDomain: (document.getElementById('fbAuthDomain') || {}).value || '',
        databaseURL: (document.getElementById('fbDatabaseURL') || {}).value || '',
        projectId: (document.getElementById('fbProjectId') || {}).value || '',
        storageBucket: (document.getElementById('fbStorageBucket') || {}).value || '',
        messagingSenderId: (document.getElementById('fbMessagingSenderId') || {}).value || '',
        appId: (document.getElementById('fbAppId') || {}).value || ''
    };
}

// Lưu Firebase config lên Master Firebase
function saveFirebaseConfig() {
    var statusEl = document.getElementById('firebaseConfigStatus');
    if (!statusEl) return;
    
    var config = _getFirebaseConfigFromForm();
    if (!config.databaseURL) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Vui lòng nhập ít nhất Database URL</span>';
        return;
    }
    
    statusEl.innerHTML = '<span style="color:#fbbf24;">⏳ Đang lưu cấu hình...</span>';
    
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : '';
    if (!shopId) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Không tìm thấy Shop ID</span>';
        return;
    }
    
    try {
        var masterDb = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : null;
        if (masterDb) {
            // Lưu config lên Master Firebase
            masterDb.ref('firebase_config/' + shopId).set(config).then(function() {
                statusEl.innerHTML = '<span style="color:#22c55e;">✅ Đã lưu cấu hình Firebase! Vui lòng đăng nhập lại để áp dụng.</span>';
                
                // Cập nhật hasCustomConfig trong shop_registry
                var _curUser = (typeof DB !== 'undefined' && DB.getCurrentUser) ? DB.getCurrentUser() : null;
                var _shopCode = (_curUser && _curUser.shopCode) ? _curUser.shopCode : shopId.replace('shop_', '');
                masterDb.ref('shop_registry/' + _shopCode).update({
                    hasCustomConfig: true
                }).catch(function() {});
            }).catch(function(err) {
                statusEl.innerHTML = '<span style="color:#ef4444;">❌ Lỗi lưu: ' + (err.message || 'Unknown error') + '</span>';
            });
        } else {
            statusEl.innerHTML = '<span style="color:#ef4444;">❌ Không tìm thấy Master Firebase</span>';
        }
    } catch(e) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Lỗi: ' + (e.message || 'Unknown error') + '</span>';
    }
}

// Xóa Firebase config (quay về dùng Firebase mặc định)
function clearFirebaseConfig() {
    var statusEl = document.getElementById('firebaseConfigStatus');
    if (!statusEl) return;
    
    if (!confirm('Xóa cấu hình Firebase riêng? Dữ liệu sẽ quay về Firebase mặc định.')) return;
    
    statusEl.innerHTML = '<span style="color:#fbbf24;">⏳ Đang xóa cấu hình...</span>';
    
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : '';
    if (!shopId) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Không tìm thấy Shop ID</span>';
        return;
    }
    
    try {
        var masterDb = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : null;
        if (masterDb) {
            // Xóa config khỏi Master Firebase
            masterDb.ref('firebase_config/' + shopId).remove().then(function() {
                statusEl.innerHTML = '<span style="color:#22c55e;">✅ Đã xóa cấu hình Firebase! Vui lòng đăng nhập lại để dùng Firebase mặc định.</span>';
                
                // Cập nhật hasCustomConfig trong shop_registry
                var _curUser = (typeof DB !== 'undefined' && DB.getCurrentUser) ? DB.getCurrentUser() : null;
                var _shopCode = (_curUser && _curUser.shopCode) ? _curUser.shopCode : shopId.replace('shop_', '');
                masterDb.ref('shop_registry/' + _shopCode).update({
                    hasCustomConfig: false
                }).catch(function() {});
            }).catch(function(err) {
                statusEl.innerHTML = '<span style="color:#ef4444;">❌ Lỗi xóa: ' + (err.message || 'Unknown error') + '</span>';
            });
        } else {
            statusEl.innerHTML = '<span style="color:#ef4444;">❌ Không tìm thấy Master Firebase</span>';
        }
    } catch(e) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Lỗi: ' + (e.message || 'Unknown error') + '</span>';
    }
}

// Đồng bộ dữ liệu từ Firebase cũ sang Firebase mới
function syncDataToNewFirebase() {
    var statusEl = document.getElementById('firebaseConfigStatus');
    if (!statusEl) return;
    
    var config = _getFirebaseConfigFromForm();
    if (!config.databaseURL) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Vui lòng nhập Database URL của Firebase mới</span>';
        return;
    }
    
    if (!confirm('Đồng bộ toàn bộ dữ liệu từ Firebase hiện tại sang Firebase mới? Quá trình này có thể mất vài phút.')) return;
    
    statusEl.innerHTML = '<span style="color:#fbbf24;">⏳ Đang đồng bộ dữ liệu...</span>';
    
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : '';
    if (!shopId) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Không tìm thấy Shop ID</span>';
        return;
    }
    
    try {
        var masterDb = (typeof DB !== 'undefined' && DB.getMasterDb) ? DB.getMasterDb() : null;
        if (!masterDb) {
            statusEl.innerHTML = '<span style="color:#ef4444;">❌ Không tìm thấy Master Firebase</span>';
            return;
        }
        
        // Tạo Slave app tạm thời để đồng bộ
        var tempAppName = 'sync_' + Date.now();
        var slaveApp = firebase.initializeApp(config, tempAppName);
        var slaveDb = slaveApp.database();
        
        // Danh sách collections cần đồng bộ (không bao gồm staffs, shop_registry, firebase_config, master_admins)
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
                            statusEl.innerHTML = '<span style="color:#fbbf24;">⏳ Đã đồng bộ ' + syncedCount + '/' + DATA_COLLECTIONS.length + ' collections...</span>';
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
            statusEl.innerHTML = '<span style="color:#22c55e;">✅ Đồng bộ hoàn tất! Đã đồng bộ ' + syncedCount + ' collections.</span>';
            slaveApp.delete().catch(function() {});
        }).catch(function(err) {
            statusEl.innerHTML = '<span style="color:#ef4444;">❌ Lỗi đồng bộ: ' + (err.message || 'Unknown error') + '</span>';
            slaveApp.delete().catch(function() {});
        });
    } catch(e) {
        statusEl.innerHTML = '<span style="color:#ef4444;">❌ Lỗi: ' + (e.message || 'Unknown error') + '</span>';
    }
}
