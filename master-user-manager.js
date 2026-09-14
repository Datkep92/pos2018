// master-user-manager.js - Giao diện quản lý user Master (Tab Master)
// ES5, tương thích Android 6, iOS 12
// Chỉ master admin mới thấy và sử dụng tab này
// Hiển thị danh sách POS, CRUD POS, cấu hình Firebase riêng cho từng POS

// ========== BIẾN TOÀN CỤC ==========
var _masterPosList = [];
var _masterEditingPosId = null;

// ========== KHỞI TẠO TAB MASTER ==========
function initMasterTab() {
    // Chỉ master admin mới được dùng
    if (!MASTER_CONFIG.isMasterAdmin()) {
        showToast('⚠️ Bạn không có quyền truy cập', 'warning');
        return;
    }

    var container = document.getElementById('masterView');
    if (!container) return;

    // OPTIMIZE: Kiểm tra nếu master-container đã được render thì không render lại
    // Tránh render lại toàn bộ mỗi lần click tab
    var existing = container.querySelector('.master-container');
    if (existing) {
        // Container đã có, không cần render lại
        return;
    }

    // Render header
    container.innerHTML =
        '<div class="master-container">' +
            '<div class="master-header">' +
                '<h2>👑 QUẢN LÝ HỆ THỐNG POS</h2>' +
                '<button class="btn-add-pos" onclick="showAddPosForm()">+ Thêm POS</button>' +
            '</div>' +
            '<div class="master-pos-list" id="masterPosList">' +
                '<div class="master-loading">Đang tải danh sách POS...</div>' +
            '</div>' +
        '</div>';

    // Load danh sách POS
    loadMasterPosList();
}

// ========== LOAD DANH SÁCH POS ==========
function loadMasterPosList() {
    var listEl = document.getElementById('masterPosList');
    if (!listEl) return;

    listEl.innerHTML = '<div class="master-loading">Đang tải danh sách POS...</div>';

    MASTER_CONFIG.getPosList().then(function(posList) {
        _masterPosList = posList || [];
        renderMasterPosList();
    }).catch(function(err) {
        listEl.innerHTML = '<div class="master-error">❌ Lỗi tải danh sách: ' + (err.message || 'unknown') + '</div>';
    });
}

// ========== HELPER: BUILD HTML CHO 1 CARD POS ==========
function _buildPosCardHtml(pos, index) {
    var isLocked = pos.locked === true;
    var hasCustomConfig = pos.customFirebaseConfig ? true : false;
    var sourceDeleted = pos.sourceDataDeleted === true;
    var configPreview = '';
    if (pos.customFirebaseConfig) {
        try {
            var configObj = typeof pos.customFirebaseConfig === 'string'
                ? JSON.parse(pos.customFirebaseConfig)
                : pos.customFirebaseConfig;
            configPreview = configObj.databaseURL || configObj.projectId || 'Có config';
        } catch(e) {
            configPreview = '⚠️ JSON lỗi';
        }
    }

    var cardBorderColor = isLocked ? '#dc2626' : '#e2e8f0';
    var cardBgColor = isLocked ? '#fef2f2' : '#fff';

    // Badge trạng thái
    var statusBadge = isLocked
        ? '<span class="pos-badge locked">🔒 Đã khóa</span>'
        : '<span class="pos-badge active">✅ Hoạt động</span>';

    var sourceBadge = sourceDeleted
        ? '<span class="pos-badge deleted">🗑️ Đã xóa gốc</span>'
        : '';

    // Buttons
    var btns = '';

    if (hasCustomConfig) {
        btns += '<button class="pos-btn primary" onclick="handleMigratePosData(\'' + escapeHtml(pos.id) + '\')" id="migrateBtn_' + escapeHtml(pos.id) + '">🔄 Đồng bộ</button>';
    }

    if (hasCustomConfig && !sourceDeleted) {
        btns += '<button class="pos-btn outline-purple" onclick="handleDeleteSourceData(\'' + escapeHtml(pos.id) + '\')" id="deleteSourceBtn_' + escapeHtml(pos.id) + '">🗑️ Xóa gốc</button>';
    }

    btns += '<button class="pos-btn outline-orange" onclick="showEditPosForm(\'' + escapeHtml(pos.id) + '\')">✏️ Sửa</button>';

    if (isLocked) {
        btns += '<button class="pos-btn success" onclick="handleToggleLockPos(\'' + escapeHtml(pos.id) + '\')">🔓 Mở khóa</button>';
    } else {
        btns += '<button class="pos-btn warning" onclick="handleToggleLockPos(\'' + escapeHtml(pos.id) + '\')">🔒 Khóa</button>';
    }

    btns += '<button class="pos-btn danger" onclick="handleDeletePos(\'' + escapeHtml(pos.id) + '\')">🗑️ Xóa</button>';

    var configHtml = hasCustomConfig
        ? '<span>🔥 Firebase riêng: ✅ Có</span>' + (configPreview ? '<span>(' + escapeHtml(configPreview) + ')</span>' : '')
        : '<span>🔥 Firebase riêng: ❌ Không (mặc định)</span>';

    return '<div class="master-pos-card" style="border:1px solid ' + cardBorderColor + ';background:' + cardBgColor + ';">' +
        '<div class="pos-name-row">' +
            '<span class="pos-name">' + escapeHtml(pos.name || '') + '</span>' +
            statusBadge +
            sourceBadge +
        '</div>' +
        '<div class="pos-info-row">' +
            '<span>📌 Mã: <strong>' + escapeHtml(pos.code || '') + '</strong></span>' +
            '<span>👤 User: <strong>' + escapeHtml(pos.username || '') + '</strong></span>' +
            '<span>🔑 Role: <strong>' + (pos.role || 'pos_admin') + '</strong></span>' +
        '</div>' +
        '<div class="pos-config-row">' + configHtml + '</div>' +
        '<div class="pos-actions">' + btns + '</div>' +
    '</div>';
}

// ========== RENDER DANH SÁCH POS ==========
function renderMasterPosList() {
    var listEl = document.getElementById('masterPosList');
    if (!listEl) return;

    if (!_masterPosList || _masterPosList.length === 0) {
        listEl.innerHTML = '<div class="master-empty">📋 Chưa có POS nào. Nhấn "Thêm POS" để tạo mới.</div>';
        return;
    }

    var html = '';
    for (var i = 0; i < _masterPosList.length; i++) {
        html += _buildPosCardHtml(_masterPosList[i], i);
    }

    listEl.innerHTML = html;
}


// ========== CẬP NHẬT CARD POS CỤ THỂ ==========
function updatePosCard(index) {
    var listEl = document.getElementById('masterPosList');
    if (!listEl || !_masterPosList || index < 0 || index >= _masterPosList.length) return;

    var pos = _masterPosList[index];
    if (!pos) return;

    var cardHtml = _buildPosCardHtml(pos, index);

    // Tìm card cũ và thay thế
    var cards = listEl.querySelectorAll('.master-pos-card');
    if (cards && cards.length > index && cards[index]) {
        cards[index].outerHTML = cardHtml;
    } else {
        // Fallback: render lại toàn bộ nếu không tìm thấy card đúng vị trí
        renderMasterPosList();
    }
}

// ========== HIỂN THỊ FORM THÊM POS ==========
function showAddPosForm() {
    _masterEditingPosId = null;
    showPosFormModal(null);
}

// ========== HIỂN THỊ FORM SỬA POS ==========
function showEditPosForm(posId) {
    _masterEditingPosId = posId;

    // Tìm POS trong danh sách
    var pos = null;
    for (var i = 0; i < _masterPosList.length; i++) {
        if (_masterPosList[i].id === posId) {
            pos = _masterPosList[i];
            break;
        }
    }

    if (!pos) {
        // Load từ Firebase
        MASTER_CONFIG.getPosById(posId).then(function(data) {
            if (data) {
                showPosFormModal(data);
            } else {
                showToast('❌ Không tìm thấy POS', 'error');
            }
        }).catch(function(err) {
            showToast('❌ Lỗi: ' + (err.message || 'unknown'), 'error');
        });
    } else {
        showPosFormModal(pos);
    }
}

// ========== MODAL FORM THÊM/SỬA POS ==========
function showPosFormModal(posData) {
    var isEdit = posData && posData.id;
    var title = isEdit ? '✏️ Sửa POS' : '➕ Thêm POS mới';
    var btnText = isEdit ? '💾 Lưu thay đổi' : '➕ Tạo POS';

    // Pre-fill nếu sửa
    var name = isEdit ? (posData.name || '') : '';
    var code = isEdit ? (posData.code || '') : '';
    var username = isEdit ? (posData.username || '') : '';
    var password = isEdit ? '' : ''; // Không pre-fill password khi sửa
    var role = isEdit ? (posData.role || 'pos_admin') : 'pos_admin';
    var configJson = '';
    if (isEdit && posData.customFirebaseConfig) {
        try {
            configJson = typeof posData.customFirebaseConfig === 'string'
                ? posData.customFirebaseConfig
                : JSON.stringify(posData.customFirebaseConfig, null, 2);
        } catch(e) {
            configJson = '';
        }
    }

    // Tạo modal
    var modalId = 'masterPosFormModal';
    var oldModal = document.getElementById(modalId);
    if (oldModal) oldModal.remove();

    var modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal active';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';

    modal.innerHTML =
        '<div class="modal-content" style="max-width:500px;width:90%;border-radius:16px;max-height:90vh;overflow-y:auto;">' +
            '<div class="modal-header" style="padding:16px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center;">' +
                '<span class="modal-title" style="font-size:16px;font-weight:600;">' + title + '</span>' +
                '<span class="modal-close" onclick="closeMasterPosForm()" style="font-size:24px;cursor:pointer;color:#94a3b8;">&times;</span>' +
            '</div>' +
            '<div class="modal-body" style="padding:16px;">' +
                // Tên POS
                '<div class="master-form-group" style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:4px;">🏪 Tên POS <span style="color:#dc2626;">*</span></label>' +
                    '<input type="text" id="masterPosName" class="form-input" value="' + escapeHtml(name) + '" placeholder="VD: Cafe Milano 259" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">' +
                '</div>' +
                // Mã POS
                '<div class="master-form-group" style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:4px;">📌 Mã POS <span style="color:#dc2626;">*</span></label>' +
                    '<input type="text" id="masterPosCode" class="form-input" value="' + escapeHtml(code) + '" placeholder="VD: cafe01 (ít nhất 3 ký tự)" ' + (isEdit ? 'readonly style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;background:#f3f4f6;"' : 'style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;"') + '>' +
                '</div>' +
                // Username
                '<div class="master-form-group" style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:4px;">👤 Username <span style="color:#dc2626;">*</span></label>' +
                    '<input type="text" id="masterPosUsername" class="form-input" value="' + escapeHtml(username) + '" placeholder="Tên đăng nhập admin" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">' +
                '</div>' +
                // Password
                '<div class="master-form-group" style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:4px;">🔑 Password ' + (isEdit ? '<span style="font-size:11px;color:#94a3b8;">(để trống nếu không đổi)</span>' : '<span style="color:#dc2626;">*</span>') + '</label>' +
                    '<input type="password" id="masterPosPassword" class="form-input" placeholder="' + (isEdit ? 'Để trống nếu không đổi' : 'Ít nhất 4 ký tự') + '" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">' +
                '</div>' +
                // Role
                '<div class="master-form-group" style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:4px;">🔑 Vai trò</label>' +
                    '<select id="masterPosRole" class="form-input" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">' +
                        '<option value="pos_admin" ' + (role === 'pos_admin' ? 'selected' : '') + '>Admin POS</option>' +
                        '<option value="pos_staff" ' + (role === 'pos_staff' ? 'selected' : '') + '>Nhân viên POS</option>' +
                    '</select>' +
                '</div>' +
                // Firebase Config (JSON)
                '<div class="master-form-group" style="margin-bottom:12px;">' +
                    '<label style="display:block;font-size:13px;font-weight:500;color:#374151;margin-bottom:4px;">🔥 Firebase Config riêng <span style="font-size:11px;color:#94a3b8;">(JSON, để trống nếu dùng config mặc định)</span></label>' +
                    '<textarea id="masterPosConfig" class="form-input" placeholder=\'{\n  "apiKey": "...",\n  "authDomain": "...",\n  "databaseURL": "...",\n  "projectId": "..."\n}\' style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;font-family:monospace;min-height:120px;resize:vertical;">' + escapeHtml(configJson) + '</textarea>' +
                '</div>' +
                // Status message
                '<div id="masterFormStatus" style="font-size:13px;margin-bottom:8px;min-height:20px;"></div>' +
                // Submit button
                '<button onclick="handleSavePos()" style="width:100%;padding:12px;border:none;border-radius:8px;background:#f97316;color:#fff;font-weight:600;font-size:15px;cursor:pointer;">' + btnText + '</button>' +
            '</div>' +
        '</div>';

    document.body.appendChild(modal);

    // Click outside to close
    modal.addEventListener('click', function(e) {
        if (e.target === modal) closeMasterPosForm();
    });
}

// ========== ĐÓNG FORM ==========
function closeMasterPosForm() {
    var modal = document.getElementById('masterPosFormModal');
    if (modal) {
        modal.classList.add('closing');
        setTimeout(function() {
            modal.style.display = 'none';
            modal.remove();
        }, 200);
    }
}

// ========== LƯU POS (THÊM/SỬA) ==========
function handleSavePos() {
    var nameEl = document.getElementById('masterPosName');
    var codeEl = document.getElementById('masterPosCode');
    var usernameEl = document.getElementById('masterPosUsername');
    var passwordEl = document.getElementById('masterPosPassword');
    var roleEl = document.getElementById('masterPosRole');
    var configEl = document.getElementById('masterPosConfig');
    var statusEl = document.getElementById('masterFormStatus');

    if (!nameEl || !codeEl || !usernameEl || !roleEl) return;

    var name = nameEl.value.trim();
    var code = codeEl.value.trim();
    var username = usernameEl.value.trim();
    var password = passwordEl.value;
    var role = roleEl.value;
    var configStr = configEl ? configEl.value.trim() : '';

    // Validate
    if (!name || !code || !username) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626;">⚠️ Vui lòng nhập đầy đủ Tên, Mã POS và Username</span>';
        return;
    }

    // Validate config JSON nếu có
    var configObj = null;
    if (configStr) {
        try {
            configObj = JSON.parse(configStr);
            // Kiểm tra các trường bắt buộc
            if (!configObj.databaseURL && !configObj.projectId) {
                if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626;">⚠️ Config Firebase phải có ít nhất "databaseURL" hoặc "projectId"</span>';
                return;
            }
        } catch(e) {
            if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626;">⚠️ JSON không hợp lệ: ' + e.message + '</span>';
            return;
        }
    }

    if (statusEl) statusEl.innerHTML = '<span style="color:#f97316;">⏳ Đang xử lý...</span>';

    if (_masterEditingPosId) {
        // Sửa POS
        var updateData = {
            name: name,
            username: username,
            role: role,
            customFirebaseConfig: configObj
        };
        if (password) {
            updateData.password = password;
        }

        MASTER_CONFIG.updatePos(_masterEditingPosId, updateData).then(function() {
            if (statusEl) statusEl.innerHTML = '<span style="color:#16a34a;">✅ Đã cập nhật POS thành công!</span>';
            showToast('✅ Đã cập nhật POS', 'success');
            closeMasterPosForm();
            loadMasterPosList();
        }).catch(function(err) {
            if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626;">❌ Lỗi: ' + (err.message || 'Không thể cập nhật') + '</span>';
        });
    } else {
        // Thêm mới
        if (!password || password.length < 4) {
            if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626;">⚠️ Mật khẩu phải có ít nhất 4 ký tự</span>';
            return;
        }
        if (code.length < 3) {
            if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626;">⚠️ Mã POS phải có ít nhất 3 ký tự</span>';
            return;
        }

        MASTER_CONFIG.createPos({
            name: name,
            code: code,
            username: username,
            password: password,
            role: role,
            customFirebaseConfig: configObj
        }).then(function() {
            if (statusEl) statusEl.innerHTML = '<span style="color:#16a34a;">✅ Đã tạo POS thành công!</span>';
            showToast('✅ Đã tạo POS mới', 'success');
            closeMasterPosForm();
            loadMasterPosList();
        }).catch(function(err) {
            if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626;">❌ Lỗi: ' + (err.message || 'Không thể tạo') + '</span>';
        });
    }
}

// ========== XÓA POS ==========
function handleDeletePos(posId) {
    if (!posId) return;

    // Tìm tên POS và index
    var posName = '';
    var posIndex = -1;
    for (var i = 0; i < _masterPosList.length; i++) {
        if (_masterPosList[i].id === posId) {
            posName = _masterPosList[i].name || _masterPosList[i].code || '';
            posIndex = i;
            break;
        }
    }

    if (!confirm('Bạn có chắc muốn xóa POS "' + posName + '"?\nHành động này không thể hoàn tác!')) return;

    MASTER_CONFIG.deletePos(posId).then(function() {
        showToast('✅ Đã xóa POS "' + posName + '"', 'success');
        // Xóa khỏi mảng
        if (posIndex >= 0 && posIndex < _masterPosList.length) {
            _masterPosList.splice(posIndex, 1);
        }
        // Cập nhật DOM
        if (_masterPosList.length === 0 || posIndex < 0) {
            renderMasterPosList();
        } else {
            var listEl = document.getElementById('masterPosList');
            if (listEl) {
                var cards = listEl.querySelectorAll('.master-pos-card');
                if (cards && cards[posIndex]) {
                    cards[posIndex].remove();
                } else {
                    renderMasterPosList();
                }
            }
        }
    }).catch(function(err) {
        showToast('❌ Lỗi xóa: ' + (err.message || 'unknown'), 'error');
    });
}

// ========== KHÓA / MỞ KHÓA POS ==========
function handleToggleLockPos(posId) {
    if (!posId) return;

    // Tìm thông tin POS
    var pos = null;
    var posIndex = -1;
    for (var i = 0; i < _masterPosList.length; i++) {
        if (_masterPosList[i].id === posId) {
            pos = _masterPosList[i];
            posIndex = i;
            break;
        }
    }

    if (!pos) {
        showToast('❌ Không tìm thấy POS', 'error');
        return;
    }

    var isLocked = pos.locked === true;
    var posName = pos.name || pos.code || '';
    var action = isLocked ? 'mở khóa' : 'khóa';
    var confirmMsg = isLocked
        ? 'Bạn có chắc muốn mở khóa POS "' + posName + '"?\nSau khi mở khóa, POS này có thể đăng nhập lại bình thường.'
        : 'Bạn có chắc muốn khóa POS "' + posName + '"?\nSau khi khóa, POS này sẽ KHÔNG THỂ đăng nhập được cho đến khi được mở khóa.';

    if (!confirm(confirmMsg)) return;

    var promise = isLocked ? MASTER_CONFIG.unlockPos(posId) : MASTER_CONFIG.lockPos(posId);

    promise.then(function() {
        showToast('✅ Đã ' + action + ' POS "' + posName + '"', 'success');
        // Cập nhật trạng thái locked trong mảng _masterPosList
        _masterPosList[posIndex].locked = !isLocked;
        // Chỉ render lại card POS này
        updatePosCard(posIndex);
    }).catch(function(err) {
        showToast('❌ Lỗi ' + action + ': ' + (err.message || 'unknown'), 'error');
    });
}

// ========== ĐỒNG BỘ DỮ LIỆU SANG FIREBASE RIÊNG ==========
function handleMigratePosData(posId) {
    if (!posId) return;

    // Tìm thông tin POS
    var pos = null;
    var posIndex = -1;
    for (var i = 0; i < _masterPosList.length; i++) {
        if (_masterPosList[i].id === posId) {
            pos = _masterPosList[i];
            posIndex = i;
            break;
        }
    }

    if (!pos) {
        showToast('❌ Không tìm thấy POS', 'error');
        return;
    }

    if (!pos.customFirebaseConfig) {
        showToast('⚠️ POS này chưa có cấu hình Firebase riêng', 'warning');
        return;
    }

    var posName = pos.name || pos.code || '';
    var configObj = typeof pos.customFirebaseConfig === 'string'
        ? JSON.parse(pos.customFirebaseConfig)
        : pos.customFirebaseConfig;

    if (!confirm('Bạn có chắc muốn đồng bộ toàn bộ dữ liệu của POS "' + posName + '" sang Firebase riêng?\n\n' +
        '🔹 Dữ liệu sẽ được sao chép từ Firebase mặc định sang Firebase riêng.\n' +
        '🔹 Quá trình này có thể mất vài phút tùy vào dung lượng dữ liệu.\n' +
        '🔹 Dữ liệu hiện có trên Firebase riêng sẽ bị GHI ĐÈ.\n\n' +
        'Bạn có muốn tiếp tục?')) return;

    // Vô hiệu hóa nút để tránh bấm nhiều lần
    var migrateBtn = document.getElementById('migrateBtn_' + posId);
    if (migrateBtn) {
        migrateBtn.disabled = true;
        migrateBtn.textContent = '⏳ Đang đồng bộ...';
        migrateBtn.style.opacity = '0.6';
        migrateBtn.style.cursor = 'not-allowed';
    }

    // Hàm cập nhật tiến trình
    function updateProgress(msg) {
        if (migrateBtn) {
            migrateBtn.textContent = '⏳ ' + msg;
        }
        showToast(msg, 'info');
    }

    MASTER_CONFIG.migratePosData(posId, configObj, updateProgress).then(function(result) {
        showToast('✅ Đã đồng bộ dữ liệu POS "' + posName + '" thành công!', 'success');

        // Khôi phục nút
        if (migrateBtn) {
            migrateBtn.disabled = false;
            migrateBtn.textContent = '🔄 Đồng bộ DL';
            migrateBtn.style.opacity = '1';
            migrateBtn.style.cursor = 'pointer';
        }

        // Hỏi người dùng có muốn xóa dữ liệu gốc không
        var deleteSource = confirm(
            '✅ Đã đồng bộ dữ liệu thành công!\n\n' +
            'Bạn có muốn xóa dữ liệu gốc của POS "' + posName + '" trên Firebase mặc định không?\n\n' +
            '⚠️ Hành động này sẽ xóa toàn bộ dữ liệu shop_' + pos.code.toLowerCase() + ' trên Firebase gốc.\n' +
            '⚠️ Dữ liệu đã được sao chép sang Firebase riêng, nhưng hãy chắc chắn trước khi xóa.\n\n' +
            'Nhấn OK để xóa, Cancel để giữ lại.'
        );

        if (deleteSource) {
            handleDeleteSourceData(posId);
        }
    }).catch(function(err) {
        showToast('❌ Lỗi đồng bộ: ' + (err.message || 'unknown'), 'error');

        // Khôi phục nút
        if (migrateBtn) {
            migrateBtn.disabled = false;
            migrateBtn.textContent = '🔄 Đồng bộ DL';
            migrateBtn.style.opacity = '1';
            migrateBtn.style.cursor = 'pointer';
        }
    });
}

// ========== XÓA DỮ LIỆU GỐC TRÊN FIREBASE MẶC ĐỊNH ==========
function handleDeleteSourceData(posId) {
    if (!posId) return;

    // Tìm thông tin POS
    var pos = null;
    var posIndex = -1;
    for (var i = 0; i < _masterPosList.length; i++) {
        if (_masterPosList[i].id === posId) {
            pos = _masterPosList[i];
            posIndex = i;
            break;
        }
    }

    if (!pos) {
        showToast('❌ Không tìm thấy POS', 'error');
        return;
    }

    var posName = pos.name || pos.code || '';
    var code = pos.code || '';
    var shopId = 'shop_' + code.toLowerCase();

    if (!confirm(
        '⚠️ XÓA DỮ LIỆU GỐC\n\n' +
        'Bạn có chắc muốn xóa toàn bộ dữ liệu gốc của POS "' + posName + '" trên Firebase mặc định?\n\n' +
        '🔹 Node "' + shopId + '" trên Firebase gốc sẽ bị xóa.\n' +
        '🔹 Dữ liệu trên Firebase riêng vẫn còn nguyên.\n' +
        '🔹 Hành động này KHÔNG THỂ hoàn tác!\n\n' +
        'Nhấn OK để xác nhận xóa.'
    )) return;

    // Vô hiệu hóa nút xóa
    var deleteBtn = document.getElementById('deleteSourceBtn_' + posId);
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.textContent = '⏳ Đang xóa...';
        deleteBtn.style.opacity = '0.6';
        deleteBtn.style.cursor = 'not-allowed';
    }

    MASTER_CONFIG.deleteShopData(posId).then(function() {
        showToast('✅ Đã xóa dữ liệu gốc của POS "' + posName + '"', 'success');

        // Cập nhật trạng thái trong mảng
        if (posIndex >= 0 && posIndex < _masterPosList.length) {
            _masterPosList[posIndex].sourceDataDeleted = true;
        }

        // Cập nhật trạng thái trên Firebase registry
        MASTER_CONFIG.updatePosRegistry(posId, { sourceDataDeleted: true }).catch(function(err) {
            console.warn('[MasterUserManager] Không thể cập nhật sourceDataDeleted:', err);
        });

        // Render lại card
        updatePosCard(posIndex);
    }).catch(function(err) {
        showToast('❌ Lỗi xóa dữ liệu gốc: ' + (err.message || 'unknown'), 'error');

        // Khôi phục nút
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = '🗑️ Xóa DL gốc';
            deleteBtn.style.opacity = '1';
            deleteBtn.style.cursor = 'pointer';
        }
    });
}

// ========== EXPORT ==========
window.initMasterTab = initMasterTab;
window.loadMasterPosList = loadMasterPosList;
window.showAddPosForm = showAddPosForm;
window.showEditPosForm = showEditPosForm;
window.showPosFormModal = showPosFormModal;
window.closeMasterPosForm = closeMasterPosForm;
window.handleSavePos = handleSavePos;
window.handleDeletePos = handleDeletePos;
window.handleToggleLockPos = handleToggleLockPos;
window.handleMigratePosData = handleMigratePosData;
window.handleDeleteSourceData = handleDeleteSourceData;
