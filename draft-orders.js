// draft-orders.js - Quản lý đơn nháp (Draft Order)
// Lưu local bằng IndexedDB, không ghi Firebase
// ES5, tương thích Android 6, iOS 12

// ========== BIẾN GLOBAL ==========
var draftOrders = [];           // Danh sách draft order đang active
var currentDraftId = null;      // Draft ID đang được chỉnh sửa
var DRAFT_DB_NAME = 'pos_drafts';
var DRAFT_DB_VERSION = 1;
var DRAFT_STORE = 'drafts';

// ========== INDEXEDDB CHO DRAFT ==========
var _draftDB = null;
var _draftDBReady = null;

function _openDraftDB() {
    if (_draftDBReady) return _draftDBReady;
    _draftDBReady = new Promise(function(resolve, reject) {
        var request = indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
        request.onerror = function(e) { reject(e.target.error); };
        request.onsuccess = function(e) {
            _draftDB = e.target.result;
            resolve(_draftDB);
        };
        request.onupgradeneeded = function(e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(DRAFT_STORE)) {
                db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
            }
        };
    });
    return _draftDBReady;
}

function _saveDraftToDB(draft) {
    return _openDraftDB().then(function() {
        return new Promise(function(resolve, reject) {
            var tx = _draftDB.transaction([DRAFT_STORE], 'readwrite');
            var store = tx.objectStore(DRAFT_STORE);
            var req = store.put(draft);
            req.onsuccess = function() { resolve(); };
            req.onerror = function() { reject(req.error); };
        });
    });
}

function _deleteDraftFromDB(draftId) {
    return _openDraftDB().then(function() {
        return new Promise(function(resolve, reject) {
            var tx = _draftDB.transaction([DRAFT_STORE], 'readwrite');
            var store = tx.objectStore(DRAFT_STORE);
            var req = store.delete(String(draftId));
            req.onsuccess = function() { resolve(); };
            req.onerror = function() { reject(req.error); };
        });
    });
}

function _loadAllDraftsFromDB() {
    return _openDraftDB().then(function() {
        return new Promise(function(resolve, reject) {
            var tx = _draftDB.transaction([DRAFT_STORE], 'readonly');
            var store = tx.objectStore(DRAFT_STORE);
            var req = store.getAll();
            req.onsuccess = function() {
                resolve(req.result || []);
            };
            req.onerror = function() { reject(req.error); };
        });
    });
}

// ========== TẠO DRAFT ORDER MỚI ==========
function createDraftOrder(type, label) {
    var draftId = 'draft_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    var now = new Date();
    var draft = {
        id: draftId,
        type: type || 'takeaway',       // 'takeaway', 'dinein', 'grab'
        label: label || 'Khách lẻ',      // Tên hiển thị trên bong bóng
        items: [],
        total: 0,
        customerId: null,
        customerName: null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
    return draft;
}

// ========== LƯU DRAFT ==========
function saveDraft(draft) {
    if (!draft || !draft.id) return Promise.resolve();
    draft.updatedAt = new Date().toISOString();
    // Cập nhật trong mảng local
    var found = false;
    for (var i = 0; i < draftOrders.length; i++) {
        if (draftOrders[i].id === draft.id) {
            draftOrders[i] = draft;
            found = true;
            break;
        }
    }
    if (!found) {
        draftOrders.push(draft);
    }
    // Lưu vào IndexedDB
    return _saveDraftToDB(draft).then(function() {
        renderDraftBubbles();
    });
}

// ========== XÓA DRAFT ==========
function deleteDraft(draftId) {
    // Xóa khỏi mảng local
    draftOrders = draftOrders.filter(function(d) { return d.id !== draftId; });
    // Xóa khỏi IndexedDB
    return _deleteDraftFromDB(draftId).then(function() {
        renderDraftBubbles();
    }).catch(function(err) {
        console.error('Lỗi xóa draft khỏi IndexedDB:', err);
        if (typeof showToast === 'function') {
            showToast('❌ Lỗi xóa đơn nháp!', 'error');
        }
    });
}

// ========== LẤY DRAFT THEO ID ==========
function getDraft(draftId) {
    for (var i = 0; i < draftOrders.length; i++) {
        if (draftOrders[i].id === draftId) {
            return draftOrders[i];
        }
    }
    return null;
}

// ========== TẢI TẤT CẢ DRAFT KHI KHỞI ĐỘNG ==========
function loadDraftOrders() {
    return _loadAllDraftsFromDB().then(function(drafts) {
        draftOrders = drafts || [];
        renderDraftBubbles();
        return draftOrders;
    });
}

// ========== RENDER BONG BÓNG DRAFT ==========
function renderDraftBubbles() {
    var container = document.getElementById('draftBubbleContainer');
    if (!container) return;

    if (draftOrders.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'flex';
    var html = '';
    for (var i = 0; i < draftOrders.length; i++) {
        var d = draftOrders[i];
        var itemCount = 0;
        if (d.items && d.items.length) {
            for (var j = 0; j < d.items.length; j++) {
                itemCount += d.items[j].qty;
            }
        }
        var total = 0;
        if (d.items && d.items.length) {
            for (var j = 0; j < d.items.length; j++) {
                total += d.items[j].price * d.items[j].qty;
            }
        }

        var icon = d.type === 'takeaway' ? '🛵' : (d.type === 'grab' ? '🚕' : '🍽️');

        html += '<div class="draft-bubble" data-draft-id="' + d.id + '" onclick="resumeDraftOrder(\'' + d.id + '\')">' +
            '<div class="draft-bubble-header">' +
                '<span class="draft-bubble-icon">' + icon + '</span>' +
                '<span class="draft-bubble-label">' + escapeHtml(d.label) + '</span>' +
                '<button class="draft-bubble-close" onclick="event.stopPropagation(); deleteDraft(\'' + d.id + '\').catch(function(e){ console.error(e); })">&times;</button>' +
            '</div>' +
            '<div class="draft-bubble-body">' +
                '<span class="draft-bubble-count">' + itemCount + ' món</span>' +
                '<span class="draft-bubble-total">' + formatMoney(total) + '</span>' +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;
}

// ========== MỞ DRAFT ĐỂ TIẾP TỤC ==========
function resumeDraftOrder(draftId) {
    var draft = getDraft(draftId);
    if (!draft) {
        showToast('Không tìm thấy đơn nháp!', 'error');
        return;
    }

    // Đặt currentDraftId để biết đang chỉnh sửa draft nào
    currentDraftId = draftId;

    // Copy items vào tempOrder
    tempOrder = [];
    if (draft.items && draft.items.length) {
        for (var i = 0; i < draft.items.length; i++) {
            var item = draft.items[i];
            tempOrder.push({
                id: item.id,
                name: item.name,
                price: item.price,
                qty: item.qty,
                addedTime: item.addedTime,
                variantName: item.variantName || null
            });
        }
    }

    selectedCustomer = draft.customerId ? { id: draft.customerId, name: draft.customerName } : null;
    currentAddToTableId = null;

    // Mở modal order
    openOrderModal();
}

// ========== (ĐÃ XÓA: minimizeCurrentOrderToDraft - ko còn nút Lưu nháp trên UI) ==========

// ========== XÁC NHẬN DRAFT -> TẠO ORDER THẬT ==========
function confirmDraftOrder(draftId, options) {
    options = options || {};
    var draft = getDraft(draftId);
    if (!draft) {
        showToast('Không tìm thấy đơn nháp!', 'error');
        return;
    }

    if (!draft.items || draft.items.length === 0) {
        showToast('Đơn nháp trống!', 'warning');
        return;
    }

    var items = _cloneArr(draft.items);
    var total = items.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
    var now = new Date();

    // Kiểm tra stock trước
    checkStock(items).then(function(ok) {
        if (!ok) return Promise.reject('Hết nguyên liệu');
        return deductIngredients(items);
    }).then(function() {
        var orderType = draft.type || 'takeaway';
        var paymentMethod = options.paymentMethod || 'cash';

        if (orderType === 'dinein' || options.createTable) {
            // Tạo bàn mới trên Firebase
            return DB.getAll('tables').then(function(allTables) {
                var numbers = [];
                for (var i = 0; i < allTables.length; i++) {
                    var name = allTables[i].name;
                    var num = parseInt(name.replace(/\D/g, ''));
                    if (!isNaN(num)) numbers.push(num);
                }
                var maxNum = numbers.length > 0 ? Math.max.apply(null, numbers) : 0;
                var nextNum = maxNum + 1;
                var tableName = 'Bàn ' + nextNum;
                var tableId = Date.now().toString();

                var currentUser = DB.getCurrentUser();
                var newTable = {
                    id: tableId,
                    name: tableName,
                    status: 'occupied',
                    time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                    startTime: now.toISOString(),
                    items: items,
                    total: total,
                    customerId: draft.customerId || null,
                    customerName: draft.customerName || null,
                    createdByName: (currentUser && currentUser.displayName) || '',
                    createdByRole: (currentUser && currentUser.role) || ''
                };

                return DB.create('tables', newTable, tableId).then(function() {
                    // Xóa draft
                    return deleteDraft(draftId).then(function() {
                        showToast('✅ Đã tạo ' + tableName + ' từ đơn nháp', 'success');
                        renderTables();
                    });
                });
            });
        } else if (orderType === 'grab') {
            // Đơn Grab
            return addHistory({
                type: 'grab',
                amount: total,
                paymentMethod: 'grab',
                items: items,
                customer: draft.customerId ? { id: draft.customerId, name: draft.customerName } : null,
                tableName: null,
                note: 'Đơn Grab (từ nháp)',
                createdAt: now.toISOString(),
                dateKey: typeof getTodayDateKey === 'function' ? getTodayDateKey() : now.toISOString().slice(0, 10)
            }).then(function() {
                return deleteDraft(draftId);
            }).then(function() {
                showToast('✅ Đã tạo đơn Grab từ nháp', 'success');
                if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
                if (typeof printAfterPayment === 'function') {
                    printAfterPayment({
                        type: 'grab', amount: total, paymentMethod: 'grab',
                        items: items, tableName: null, customer: draft.customerName ? { name: draft.customerName } : null,
                        createdAt: now.toISOString()
                    });
                }
            });
        } else {
            // Mặc định: takeaway - thanh toán luôn
            return addHistory({
                type: 'takeaway',
                amount: total,
                paymentMethod: paymentMethod,
                items: items,
                customer: draft.customerId ? { id: draft.customerId, name: draft.customerName } : null,
                tableName: null,
                note: 'Mang đi (từ nháp) - ' + (paymentMethod === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'),
                createdAt: now.toISOString(),
                dateKey: typeof getTodayDateKey === 'function' ? getTodayDateKey() : now.toISOString().slice(0, 10)
            }).then(function() {
                return deleteDraft(draftId);
            }).then(function() {
                showToast('✅ Đã thanh toán đơn từ nháp', 'success');
                if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
                if (typeof printAfterPayment === 'function') {
                    printAfterPayment({
                        type: 'takeaway', amount: total, paymentMethod: paymentMethod,
                        items: items, tableName: null, customer: draft.customerName ? { name: draft.customerName } : null,
                        createdAt: now.toISOString()
                    });
                }
            });
        }
    }).catch(function(err) {
        showToast(err && err.message ? err.message : 'Lỗi khi xác nhận đơn nháp!', 'error');
    });
}

// ========== HIỂN THỊ MODAL XÁC NHẬN DRAFT ==========
function showDraftConfirmModal(draftId) {
    var draft = getDraft(draftId);
    if (!draft) return;

    var itemCount = 0;
    if (draft.items) {
        for (var i = 0; i < draft.items.length; i++) itemCount += draft.items[i].qty;
    }
    var total = 0;
    if (draft.items) {
        for (var i = 0; i < draft.items.length; i++) total += draft.items[i].price * draft.items[i].qty;
    }

    var html =
        '<div style="margin-bottom: 16px;">' +
            '<div style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">📋 Xác nhận đơn nháp</div>' +
            '<div style="padding: 12px; background: #f8fafc; border-radius: 8px; margin-bottom: 12px;">' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 4px;">' +
                    '<span style="color: #64748b;">Nhãn:</span>' +
                    '<span style="font-weight: 500;">' + escapeHtml(draft.label) + '</span>' +
                '</div>' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 4px;">' +
                    '<span style="color: #64748b;">Loại:</span>' +
                    '<span style="font-weight: 500;">' + (draft.type === 'takeaway' ? '🛵 Mang đi' : draft.type === 'grab' ? '🚕 Grab' : '🍽️ Tại chỗ') + '</span>' +
                '</div>' +
                '<div style="display: flex; justify-content: space-between; margin-bottom: 4px;">' +
                    '<span style="color: #64748b;">Số món:</span>' +
                    '<span style="font-weight: 500;">' + itemCount + ' món</span>' +
                '</div>' +
                '<div style="display: flex; justify-content: space-between;">' +
                    '<span style="color: #64748b;">Tổng tiền:</span>' +
                    '<span style="font-weight: 600; color: #f97316;">' + formatMoney(total) + '</span>' +
                '</div>' +
            '</div>' +
        '</div>' +
        '<div style="display: flex; flex-direction: column; gap: 8px;">' +
            '<button class="action-btn btn-table" onclick="confirmDraftOrder(\'' + draftId + '\', {createTable: true}); closeModal(\'draftConfirmModal\')" style="padding: 14px;">🍽️ Tạo bàn mới</button>' +
            '<button class="action-btn btn-cash" onclick="confirmDraftOrder(\'' + draftId + '\', {paymentMethod: \'cash\'}); closeModal(\'draftConfirmModal\')" style="padding: 14px;">💰 Thanh toán tiền mặt</button>' +
            '<button class="action-btn btn-transfer" onclick="confirmDraftOrder(\'' + draftId + '\', {paymentMethod: \'transfer\'}); closeModal(\'draftConfirmModal\')" style="padding: 14px;">💳 Chuyển khoản</button>' +
            '<button class="action-btn btn-grab" onclick="confirmDraftOrder(\'' + draftId + '\', {paymentMethod: \'grab\'}); closeModal(\'draftConfirmModal\')" style="padding: 14px;">🚕 Đơn Grab</button>' +
            '<button class="action-btn btn-debt" onclick="showCustomerSelector(function(customer){ confirmDraftOrder(\'' + draftId + '\', {paymentMethod: \'debt\', customer: customer}); closeModal(\'draftConfirmModal\'); })" style="padding: 14px;">💢 Ghi nợ</button>' +
            '<button class="btn-cancel" onclick="closeModal(\'draftConfirmModal\')" style="padding: 12px; margin-top: 4px;">Hủy</button>' +
        '</div>';

    var content = document.getElementById('draftConfirmContent');
    if (content) {
        content.innerHTML = html;
        document.getElementById('draftConfirmModal').style.display = 'flex';
    }
}

// ========== EXPORT GLOBAL ==========
window.createDraftOrder = createDraftOrder;
window.saveDraft = saveDraft;
window.deleteDraft = deleteDraft;
window.getDraft = getDraft;
window.loadDraftOrders = loadDraftOrders;
window.renderDraftBubbles = renderDraftBubbles;
window.resumeDraftOrder = resumeDraftOrder;
window.confirmDraftOrder = confirmDraftOrder;
window.showDraftConfirmModal = showDraftConfirmModal;
