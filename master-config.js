// master-config.js - Module quản lý Master Config (Multi-Tenant)
// ES5, tương thích Android 6, iOS 12
// Quản lý danh sách POS, xác thực master admin, CRUD POS
// Tách riêng để dễ mở rộng sau này

// ========== MASTER CONFIG ==========
var MASTER_CONFIG = (function() {
    // Firebase default config (hardcoded - config gốc để đăng nhập)
    var DEFAULT_FIREBASE_CONFIG = {
        apiKey: "AIzaSyCs4EWdrYMZy1fTKGBFvVjrIiW0VTWIP5Y",
        authDomain: "pos259.firebaseapp.com",
        projectId: "pos259",
        databaseURL: "https://pos259-default-rtdb.firebaseio.com",
        storageBucket: "pos259.firebasestorage.app",
        messagingSenderId: "4958283987",
        appId: "1:4958283987:web:ae456726fd89c4b0d70c26",
        measurementId: "G-2J911QJ5HQ"
    };

    // Master admin credentials
    var MASTER_ADMIN_USER = 'admin123123';
    var MASTER_ADMIN_PASS = '123123';

    var _masterDb = null;
    var _currentMasterUser = null;
    var _initialized = false;

    // ========== KHỞI TẠO ==========
    function init() {
        if (_initialized) return Promise.resolve();
        _initialized = true;

        // Tự động đồng bộ session master admin từ DB nếu có
        // (do db.js load trước master-config.js nên syncSession ở db.js không chạy được)
        _autoSyncSession();

        // Dùng Firebase app đã được khởi tạo bởi db.js
        // Hoặc khởi tạo riêng nếu db.js chưa chạy
        // QUAN TRỌNG: Luôn dùng database gốc (default Firebase) cho master config,
        // không bị ảnh hưởng bởi override firebase.database() trong db.js
        try {
            if (typeof firebase !== 'undefined' && firebase.database) {
                // Thử dùng app mặc định
                try {
                    // Ưu tiên dùng _origFirebaseDatabase từ DB module (đã override firebase.database)
                    if (typeof DB !== 'undefined' && DB._origFirebaseDatabase) {
                        _masterDb = DB._origFirebaseDatabase();
                    } else {
                        _masterDb = firebase.database();
                    }
                } catch(e) {
                    // Nếu chưa có app nào, khởi tạo
                    if (!firebase.apps || firebase.apps.length === 0) {
                        firebase.initializeApp(DEFAULT_FIREBASE_CONFIG);
                    }
                    if (typeof DB !== 'undefined' && DB._origFirebaseDatabase) {
                        _masterDb = DB._origFirebaseDatabase();
                    } else {
                        _masterDb = firebase.database();
                    }
                }
            }
        } catch(e) {
            console.error('[MASTER_CONFIG] Init error:', e);
        }

        return Promise.resolve();
    }

    // ========== XÁC THỰC ==========

    /**
     * Đăng nhập vào hệ thống.
     * Kiểm tra master admin trước, sau đó mới kiểm tra POS list.
     * @param {string} shopCode - Mã POS hoặc để trống nếu là master admin
     * @param {string} username - Tên đăng nhập
     * @param {string} password - Mật khẩu
     * @returns {Promise} { user, posInfo, firebaseConfig, isMasterAdmin }
     */
    function login(shopCode, username, password) {
        if (!username || !password) {
            return Promise.reject(new Error('Vui lòng nhập đầy đủ thông tin'));
        }

        return init().then(function() {
            // Kiểm tra master admin trước
            if (username === MASTER_ADMIN_USER && password === MASTER_ADMIN_PASS) {
                // Nếu master admin có nhập mã POS → vào POS đó với quyền master_admin
                if (shopCode) {
                    return _getPosByCode(shopCode).then(function(posInfo) {
                        if (!posInfo) {
                            throw new Error('Mã POS không tồn tại');
                        }

                        // Kiểm tra POS có bị khóa không
                        if (posInfo.locked === true) {
                            var lockErr = new Error('POS này đã bị khóa. Vui lòng liên hệ Master Admin để được hỗ trợ.');
                            lockErr.locked = true;
                            throw lockErr;
                        }

                        // Xác định Firebase config cho POS này từ shop_registry
                        var firebaseConfig = null;
                        if (posInfo.customFirebaseConfig) {
                            try {
                                firebaseConfig = typeof posInfo.customFirebaseConfig === 'string'
                                    ? JSON.parse(posInfo.customFirebaseConfig)
                                    : posInfo.customFirebaseConfig;
                            } catch(e) {
                                console.warn('[MASTER_CONFIG] Invalid customFirebaseConfig for', shopCode, '- using default');
                            }
                        }

                        var shopId = posInfo.shopId || ('shop_' + posInfo.code);

                        // Master admin login vào POS cụ thể - giữ quyền master_admin
                        var user = {
                            id: 'master_admin',
                            username: MASTER_ADMIN_USER,
                            displayName: 'Master Admin - ' + (posInfo.name || posInfo.code),
                            role: 'master_admin',
                            shopId: shopId,
                            shopCode: posInfo.code,
                            shopName: posInfo.name || ''
                        };

                        return {
                            user: user,
                            isMasterAdmin: true,
                            isMasterInPos: true, // Đánh dấu: master đang login vào POS cụ thể
                            posInfo: posInfo,
                            firebaseConfig: firebaseConfig
                        };
                    });
                }

                // Không có mã POS → vào Master Control như hiện tại
                _currentMasterUser = {
                    id: 'master_admin',
                    username: MASTER_ADMIN_USER,
                    displayName: 'Admin Master',
                    role: 'master_admin',
                    shopCode: 'master'
                };
                return {
                    user: _currentMasterUser,
                    isMasterAdmin: true,
                    isMasterInPos: false,
                    posInfo: null,
                    firebaseConfig: null
                };
            }

            // Nếu không phải master admin, cần có shopCode
            if (!shopCode) {
                return Promise.reject(new Error('Vui lòng nhập mã POS'));
            }

            // Đọc danh sách POS từ master config
            return _getPosByCode(shopCode).then(function(posInfo) {
                if (!posInfo) {
                    throw new Error('Mã POS không tồn tại');
                }

                // Kiểm tra POS có bị khóa không
                if (posInfo.locked === true) {
                    var lockErr = new Error('POS này đã bị khóa. Vui lòng liên hệ Master Admin để được hỗ trợ.');
                    lockErr.locked = true;
                    throw lockErr;
                }

                // Xác định Firebase config cho POS này từ shop_registry
                var firebaseConfig = null;
                if (posInfo.customFirebaseConfig) {
                    try {
                        firebaseConfig = typeof posInfo.customFirebaseConfig === 'string'
                            ? JSON.parse(posInfo.customFirebaseConfig)
                            : posInfo.customFirebaseConfig;
                    } catch(e) {
                        console.warn('[MASTER_CONFIG] Invalid customFirebaseConfig for', shopCode, '- using default');
                    }
                }

                var shopId = posInfo.shopId || ('shop_' + posInfo.code);

                // Kiểm tra username/password từ shop_registry
                // (thông tin đăng nhập được master admin lưu khi tạo/cập nhật POS)
                if (posInfo.username !== username || posInfo.password !== password) {
                    var err = new Error('Sai tên đăng nhập hoặc mật khẩu');
                    if (firebaseConfig) {
                        err.customFirebaseConfig = true; // Đánh dấu để db.js không fallback về legacy
                    }
                    throw err;
                }

                var user = {
                    id: posInfo.id || posInfo.code,
                    username: posInfo.username,
                    displayName: posInfo.name || posInfo.code,
                    role: posInfo.role || 'pos_admin',
                    shopId: shopId,
                    shopCode: posInfo.code,
                    shopName: posInfo.name || ''
                };

                return {
                    user: user,
                    isMasterAdmin: false,
                    isMasterInPos: false,
                    posInfo: posInfo,
                    firebaseConfig: firebaseConfig
                };
            });
        });
    }

    // ========== CRUD POS ==========

    /**
     * Lấy danh sách tất cả POS từ shop_registry (cấu trúc Firebase hiện tại).
     * @returns {Promise<Array>}
     */
    function getPosList() {
        return init().then(function() {
            if (!_masterDb) return [];
            // Đọc từ shop_registry - nơi lưu danh sách POS hiện tại
            return _masterDb.ref('shop_registry').once('value').then(function(snapshot) {
                var data = snapshot.val() || {};
                var list = [];
                for (var key in data) {
                    if (data.hasOwnProperty(key)) {
                        var item = data[key];
                        item.code = key; // key là mã POS (vd: "123", "111111")
                        item.id = 'pos_' + key;
                        // Map các trường từ cấu trúc shop_registry
                        item.name = item.shopName || item.name || key;
                        item.username = item.adminUser || item.username || 'admin';
                        item.password = item.adminPass || item.password || '123';
                        item.role = item.role || 'pos_admin';
                        item.shopId = item.shopId || ('shop_' + key);
                        // customFirebaseConfig đã có sẵn trong shop_registry item
                        list.push(item);
                    }
                }
                return list;
            }).catch(function() {
                return [];
            });
        });
    }

    /**
     * Lấy thông tin 1 POS theo ID.
     * @param {string} posId - VD: "pos_123"
     * @returns {Promise<Object|null>}
     */
    function getPosById(posId) {
        return init().then(function() {
            if (!_masterDb || !posId) return null;
            // Chuyển posId thành mã code (bỏ prefix "pos_")
            var code = posId.replace(/^pos_/, '');
            return _masterDb.ref('shop_registry/' + code).once('value').then(function(snapshot) {
                var data = snapshot.val();
                if (data) {
                    data.code = code;
                    data.id = posId;
                    data.name = data.shopName || data.name || code;
                    data.username = data.adminUser || data.username || 'admin';
                    data.password = data.adminPass || data.password || '123';
                    data.shopId = data.shopId || ('shop_' + code);
                }
                return data || null;
            }).catch(function() {
                return null;
            });
        });
    }

    /**
     * Tìm POS theo mã code.
     * @param {string} code - Mã POS (VD: "123", "111111")
     * @returns {Promise<Object|null>}
     */
    function _getPosByCode(code) {
        return init().then(function() {
            if (!_masterDb || !code) return null;
            return _masterDb.ref('shop_registry/' + code).once('value').then(function(snapshot) {
                var data = snapshot.val();
                if (data) {
                    data.code = code;
                    data.id = 'pos_' + code;
                    data.name = data.shopName || data.name || code;
                    data.username = data.adminUser || data.username || 'admin';
                    data.password = data.adminPass || data.password || '123';
                    data.shopId = data.shopId || ('shop_' + code);
                }
                return data || null;
            }).catch(function() {
                return null;
            });
        });
    }

    /**
     * Tạo POS mới (chỉ master admin).
     * Lưu vào shop_registry để tương thích với cấu trúc Firebase hiện tại.
     * @param {Object} data - { name, code, username, password, role, customFirebaseConfig }
     * @returns {Promise}
     */
    function createPos(data) {
        if (!isMasterAdmin()) {
            return Promise.reject(new Error('Chỉ master admin mới có thể tạo POS'));
        }
        if (!data.name || !data.code || !data.username || !data.password) {
            return Promise.reject(new Error('Vui lòng nhập đầy đủ thông tin: Tên, Mã POS, Username, Password'));
        }
        if (data.code.length < 3) {
            return Promise.reject(new Error('Mã POS phải có ít nhất 3 ký tự'));
        }
        if (data.password.length < 4) {
            return Promise.reject(new Error('Mật khẩu phải có ít nhất 4 ký tự'));
        }

        return init().then(function() {
            // Kiểm tra mã POS đã tồn tại chưa
            return _getPosByCode(data.code).then(function(existing) {
                if (existing) {
                    throw new Error('Mã POS "' + data.code + '" đã tồn tại');
                }

                var shopId = 'shop_' + data.code.toLowerCase();

                // Lưu vào shop_registry (cấu trúc tương thích với legacy)
                var registryData = {
                    shopName: data.name,
                    shopId: shopId,
                    adminUser: data.username,
                    adminPass: data.password,
                    role: data.role || 'pos_admin',
                    customFirebaseConfig: data.customFirebaseConfig || null,
                    createdBy: _currentMasterUser ? _currentMasterUser.id : 'master_admin',
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                };

                return _masterDb.ref('shop_registry/' + data.code).set(registryData).then(function() {
                    // Tạo luôn shop data mặc định trong Firebase
                    var updates = {};
                    updates[shopId + '/staffs/' + 'staff_admin'] = {
                        id: 'staff_admin',
                        username: data.username,
                        password: data.password,
                        displayName: data.name,
                        role: 'admin',
                        createdAt: Date.now(),
                        createdBy: 'master_admin'
                    };
                    updates[shopId + '/info'] = {
                        id: 'shop_config',
                        name: data.name,
                        code: data.code,
                        createdAt: Date.now()
                    };
                    return _masterDb.ref().update(updates);
                }).then(function() {
                    return registryData;
                });
            });
        });
    }

    /**
     * Cập nhật POS (chỉ master admin).
     * @param {string} posId - VD: "pos_123"
     * @param {Object} data - Các trường cần cập nhật
     * @returns {Promise}
     */
    function updatePos(posId, data) {
        if (!isMasterAdmin()) {
            return Promise.reject(new Error('Chỉ master admin mới có thể sửa POS'));
        }
        if (!posId) {
            return Promise.reject(new Error('Thiếu POS ID'));
        }

        return init().then(function() {
            // Chuyển posId thành mã code
            var code = posId.replace(/^pos_/, '');
            var updates = {};
            if (data.name !== undefined) updates.shopName = data.name;
            if (data.username !== undefined) updates.adminUser = data.username;
            if (data.password !== undefined) updates.adminPass = data.password;
            if (data.role !== undefined) updates.role = data.role;
            if (data.customFirebaseConfig !== undefined) updates.customFirebaseConfig = data.customFirebaseConfig;
            updates.updatedAt = Date.now();

            return _masterDb.ref('shop_registry/' + code).update(updates);
        });
    }

    /**
     * Xóa POS (chỉ master admin).
     * @param {string} posId - VD: "pos_123"
     * @returns {Promise}
     */
    function deletePos(posId) {
        if (!isMasterAdmin()) {
            return Promise.reject(new Error('Chỉ master admin mới có thể xóa POS'));
        }
        if (!posId) {
            return Promise.reject(new Error('Thiếu POS ID'));
        }

        return init().then(function() {
            var code = posId.replace(/^pos_/, '');
            return _masterDb.ref('shop_registry/' + code).remove();
        });
    }

    /**
     * Khóa POS (chỉ master admin).
     * POS bị khóa sẽ không thể đăng nhập được.
     * @param {string} posId - VD: "pos_123"
     * @returns {Promise}
     */
    function lockPos(posId) {
        if (!isMasterAdmin()) {
            return Promise.reject(new Error('Chỉ master admin mới có thể khóa POS'));
        }
        if (!posId) {
            return Promise.reject(new Error('Thiếu POS ID'));
        }

        return init().then(function() {
            var code = posId.replace(/^pos_/, '');
            return _masterDb.ref('shop_registry/' + code + '/locked').set(true).then(function() {
                return _masterDb.ref('shop_registry/' + code + '/updatedAt').set(Date.now());
            });
        });
    }

    /**
     * Mở khóa POS (chỉ master admin).
     * @param {string} posId - VD: "pos_123"
     * @returns {Promise}
     */
    function unlockPos(posId) {
        if (!isMasterAdmin()) {
            return Promise.reject(new Error('Chỉ master admin mới có thể mở khóa POS'));
        }
        if (!posId) {
            return Promise.reject(new Error('Thiếu POS ID'));
        }

        return init().then(function() {
            var code = posId.replace(/^pos_/, '');
            return _masterDb.ref('shop_registry/' + code + '/locked').remove().then(function() {
                return _masterDb.ref('shop_registry/' + code + '/updatedAt').set(Date.now());
            });
        });
    }

    /**
     * Xóa dữ liệu shop_xxx trên Firebase gốc sau khi đã đồng bộ sang Firebase riêng.
     * Chỉ master admin mới có thể thực hiện.
     * @param {string} posId - VD: "pos_123"
     * @returns {Promise}
     */
    function deleteShopData(posId) {
        if (!isMasterAdmin()) {
            return Promise.reject(new Error('Chỉ master admin mới có thể xóa dữ liệu gốc'));
        }
        if (!posId) {
            return Promise.reject(new Error('Thiếu POS ID'));
        }

        var code = posId.replace(/^pos_/, '');
        var shopId = 'shop_' + code.toLowerCase();

        return init().then(function() {
            // Xóa toàn bộ dữ liệu shop_xxx trên Firebase gốc
            return _masterDb.ref(shopId).remove().then(function() {
                console.log('[MASTER_CONFIG] Đã xóa dữ liệu gốc:', shopId);
            });
        });
    }

    /**
     * Cập nhật một hoặc nhiều field trong shop_registry/{code}.
     * Dùng để lưu trạng thái như sourceDataDeleted, v.v.
     * @param {string} posId - VD: "pos_123"
     * @param {Object} updates - Các field cần cập nhật, VD: { sourceDataDeleted: true }
     * @returns {Promise}
     */
    function updatePosRegistry(posId, updates) {
        return init().then(function() {
            if (!_masterDb || !posId || !updates) return;
            var code = posId.replace(/^pos_/, '');
            var ref = _masterDb.ref('shop_registry/' + code);
            return ref.update(updates).then(function() {
                console.log('[MASTER_CONFIG] Đã cập nhật shop_registry/' + code, updates);
            });
        });
    }

    // ========== MIGRATE DỮ LIỆU ==========

    /**
     * Đồng bộ toàn bộ dữ liệu POS từ Firebase mặc định sang Firebase riêng.
     * Chỉ master admin mới có thể thực hiện.
     * Dùng Firebase app tạm thời để ghi vào custom Firebase, không ảnh hưởng đến _secondaryDb.
     * @param {string} posId - VD: "pos_123"
     * @param {Object} customConfig - Firebase config object cho project riêng
     * @param {Function} progressCallback - callback(status, message) để cập nhật UI
     * @returns {Promise}
     */
    function migratePosData(posId, customConfig, progressCallback) {
        if (!isMasterAdmin()) {
            return Promise.reject(new Error('Chỉ master admin mới có thể đồng bộ dữ liệu'));
        }
        if (!posId) {
            return Promise.reject(new Error('Thiếu POS ID'));
        }
        if (!customConfig || !customConfig.databaseURL) {
            return Promise.reject(new Error('Config Firebase riêng không hợp lệ: thiếu databaseURL'));
        }

        var code = posId.replace(/^pos_/, '');
        var shopId = 'shop_' + code.toLowerCase();
        var tempAppName = 'migrate_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
        var tempApp = null;
        var tempDb = null;

        function _progress(status, msg) {
            if (typeof progressCallback === 'function') {
                progressCallback(status, msg);
            }
            console.log('[MIGRATE ' + code + '] ' + msg);
        }

        return init().then(function() {
            _progress('reading', 'Đang đọc dữ liệu từ Firebase mặc định...');

            // Đọc toàn bộ dữ liệu từ Firebase mặc định
            return _masterDb.ref(shopId).once('value').then(function(snapshot) {
                var allData = snapshot.val();
                if (!allData) {
                    throw new Error('Không tìm thấy dữ liệu POS tại "' + shopId + '". POS này chưa có dữ liệu để đồng bộ.');
                }

                // Đếm số lượng collection để báo cáo
                var collectionCount = 0;
                for (var key in allData) {
                    if (allData.hasOwnProperty(key) && typeof allData[key] === 'object') {
                        collectionCount++;
                    }
                }
                _progress('connecting', 'Đã đọc ' + collectionCount + ' collections. Đang kết nối Firebase riêng...');

                // Khởi tạo kết nối tạm thời đến Firebase riêng
                try {
                    tempApp = firebase.initializeApp(customConfig, tempAppName);
                    tempDb = tempApp.database();
                } catch(e) {
                    throw new Error('Không thể kết nối Firebase riêng: ' + e.message);
                }

                _progress('writing', 'Đang ghi dữ liệu vào Firebase riêng...');

                // Ghi toàn bộ dữ liệu vào Firebase riêng
                return tempDb.ref(shopId).set(allData).then(function() {
                    _progress('updating', 'Đã ghi xong dữ liệu. Đang cập nhật cấu hình...');

                    // Cập nhật shop_registry với customFirebaseConfig mới
                    return _masterDb.ref('shop_registry/' + code + '/customFirebaseConfig').set(customConfig).then(function() {
                        return _masterDb.ref('shop_registry/' + code + '/updatedAt').set(Date.now());
                    });
                });
            });
        }).then(function() {
            _progress('done', '✅ Đồng bộ dữ liệu hoàn tất!');
        }).catch(function(err) {
            _progress('error', '❌ Lỗi: ' + (err.message || 'unknown'));
            throw err;
        }).then(function() {
            // Dọn dẹp Firebase app tạm thời
            if (tempApp) {
                try {
                    tempApp.delete();
                } catch(e) {
                    console.warn('[MIGRATE] Could not delete temp app:', e.message);
                }
                tempApp = null;
                tempDb = null;
            }
        });
    }

    // ========== UTILITY ==========

    function isMasterAdmin() {
        return _currentMasterUser && _currentMasterUser.role === 'master_admin';
    }

    function getCurrentMasterUser() {
        return _currentMasterUser;
    }

    /**
     * Đồng bộ session từ db.js khi khôi phục session từ localStorage.
     * @param {Object} userData - User data từ db.js
     */
    function syncSession(userData) {
        if (userData && userData.role === 'master_admin') {
            _currentMasterUser = {
                id: 'master_admin',
                username: MASTER_ADMIN_USER,
                displayName: 'Admin Master',
                role: 'master_admin',
                shopCode: 'master'
            };
        }
    }

    /**
     * Tự động đồng bộ session master admin khi master-config.js được load.
     * Giải quyết vấn đề: db.js load trước master-config.js,
     * nên syncSession() trong db.js không gọi được MASTER_CONFIG.syncSession().
     */
    function _autoSyncSession() {
        // Kiểm tra từ DB.getCurrentUser() trước
        if (typeof DB !== 'undefined' && DB && typeof DB.getCurrentUser === 'function') {
            var user = DB.getCurrentUser();
            if (user && user.role === 'master_admin') {
                syncSession(user);
                return;
            }
        }
        // Fallback: đọc trực tiếp từ localStorage
        try {
            var savedSession = localStorage.getItem('pos_session');
            if (savedSession) {
                var sessionData = JSON.parse(savedSession);
                if (sessionData && sessionData.role === 'master_admin') {
                    syncSession(sessionData);
                }
            }
        } catch(e) {
            // Ignore
        }
    }

    function logout() {
        _currentMasterUser = null;
    }

    function getDefaultFirebaseConfig() {
        return DEFAULT_FIREBASE_CONFIG;
    }

    // ========== EXPORT ==========
    return {
        init: init,
        login: login,
        getPosList: getPosList,
        getPosById: getPosById,
        createPos: createPos,
        updatePos: updatePos,
        deletePos: deletePos,
        lockPos: lockPos,
        unlockPos: unlockPos,
        migratePosData: migratePosData,
        deleteShopData: deleteShopData,
        updatePosRegistry: updatePosRegistry,
        isMasterAdmin: isMasterAdmin,
        getCurrentMasterUser: getCurrentMasterUser,
        syncSession: syncSession,
        logout: logout,
        getDefaultFirebaseConfig: getDefaultFirebaseConfig
    };
})();

// Export global
window.MASTER_CONFIG = MASTER_CONFIG;
