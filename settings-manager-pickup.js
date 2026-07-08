// settings-manager-pickup.js - Manager pickup (save/delete)
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

function saveManagerPickup() {
    var input = document.getElementById('mgrPickupInput');
    if (!input) return;
    var amount = parseFloat(input.value) || 0;
    if (amount <= 0) {
        showToast('⚠️ Nhập số tiền hợp lệ', 'warning');
        return;
    }

    var today = getTodayDateKey();
    var now = Date.now();
    var pickupId = 'pickup_' + now.toString(36) + '_' + Math.random().toString(36).substr(2, 4);

    // Tính số tiền POS còn lại sau khi QL nhận
    var currentPosCash = _posCashData ? _posCashData.expectedClosing : 0;
    var remainingPosCash = currentPosCash - amount;
    if (remainingPosCash < 0) remainingPosCash = 0;

    var pickupData = {
        id: pickupId,
        amount: amount,
        dateKey: today,
        createdAt: now,
        createdBy: (DB.getCurrentUser && DB.getCurrentUser() && DB.getCurrentUser().id) || window.currentDeviceId || 'admin',
        note: 'Quản lý nhận tiền mặt',
        remainingPosCash: remainingPosCash
    };

    // Cập nhật UI ngay lập tức (optimistic) trước khi ghi vào DB
    _updatePickupUIOptimistic(amount, pickupData);

    // Bước 1: Lưu vào IndexedDB qua DB.create trước -> memoryCache được cập nhật ngay
    // -> realtime subscription nhận notify -> UI cập nhật
    if (typeof DB !== 'undefined' && typeof DB.create === 'function') {
        DB.create('manager_cash_pickups', pickupData).then(function() {
            // Bước 2: Sau khi DB.create thành công, ghi lên Firebase để đồng bộ các máy khác
            var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
            var dbRef = firebase.database().ref(shopId + '/manager_cash_pickups/' + pickupId);
            dbRef.set(pickupData).catch(function(err) {});

            showToast('✅ Đã lưu: ' + formatMoney(amount), 'success');
            // Clear cache để lần loadPosCashData tiếp theo lấy dữ liệu mới
            _clearPickupCache();
            // Gọi load nhẹ: cập nhật _posCashData + render, không fetch lại toàn bộ Firebase
            _quickReloadPosCashAfterPickup();
        }).catch(function(err) {
            showToast('❌ Lỗi khi lưu!', 'error');
        });
    } else {
        // Fallback: ghi thẳng lên Firebase nếu DB.create không có sẵn
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var dbRef = firebase.database().ref(shopId + '/manager_cash_pickups/' + pickupId);
        dbRef.set(pickupData).catch(function(err) {});
        showToast('✅ Đã lưu: ' + formatMoney(amount) + ' (chưa đồng bộ)', 'success');
        _clearPickupCache();
        _quickReloadPosCashAfterPickup();
    }
}

// ========== CẬP NHẬT UI NGAY LẬP TỨC (OPTIMISTIC) ==========
function _updatePickupUIOptimistic(amount, pickupData) {
    try {
        // Cập nhật _posCashData ngay trong bộ nhớ
        if (_posCashData) {
            _posCashData.managerPickupTotal = (_posCashData.managerPickupTotal || 0) + amount;
            _posCashData.expectedClosing = (_posCashData.expectedClosing || 0) - amount;
            if (_posCashData.expectedClosing < 0) _posCashData.expectedClosing = 0;
            // Thêm vào pickupHistory
            if (!_posCashData.pickupHistory) _posCashData.pickupHistory = [];
            _posCashData.pickupHistory.push(pickupData);
        }
        // Render lại cash counter ngay (không cần đợi Firebase)
        var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
        renderCashCounter(isAdmin);
        // Xóa input
        var input = document.getElementById('mgrPickupInput');
        if (input) input.value = '';
    } catch (e) {}
}

// ========== CLEAR CACHE PICKUP ==========
function _clearPickupCache() {
    if (typeof _posCashCache !== 'undefined' && _posCashCache) {
        _posCashCache.managerPickups = null;
    }
}

// ========== LOAD NHẸ SAU KHI LƯU PICKUP ==========
// Chỉ fetch manager_cash_pickups từ Firebase để cập nhật _posCashData,
// không fetch lại toàn bộ transactions, tables, cost_transactions, daily_balances
function _quickReloadPosCashAfterPickup() {
    try {
        var today = getTodayDateKey();
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var dbRef = firebase.database().ref(shopId);

        // Chỉ fetch manager_cash_pickups từ Firebase để đồng bộ với các máy khác
        dbRef.child('manager_cash_pickups').once('value').then(function(snapshot) {
            var pickupsSnapshot = snapshot.val() || {};
            var pickups = [];
            for (var key2 in pickupsSnapshot) {
                if (pickupsSnapshot.hasOwnProperty(key2)) {
                    var item = pickupsSnapshot[key2];
                    item.id = key2;
                    pickups.push(item);
                }
            }

            // Cập nhật _posCashData
            if (_posCashData) {
                var totalPickup = 0;
                var history = [];
                for (var k = 0; k < pickups.length; k++) {
                    if (pickups[k].dateKey === today) {
                        totalPickup += pickups[k].amount;
                        history.push(pickups[k]);
                    }
                }
                history.sort(function(a, b) {
                    return (a.createdAt || 0) - (b.createdAt || 0);
                });
                _posCashData.managerPickupTotal = totalPickup;
                _posCashData.pickupHistory = history;
                // Tính lại expectedClosing
                _posCashData.expectedClosing = (_posCashData.openingBalance || 0) + (_posCashData.cashRevenue || 0) - (_posCashData.posCashExpense || 0) - totalPickup;
            }

            // Render lại UI
            var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
            renderCashCounter(isAdmin);
        }).catch(function(err) {
            // Fallback: render lại với dữ liệu hiện tại
            var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
            renderCashCounter(isAdmin);
        });
    } catch (e) {
        var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
        renderCashCounter(isAdmin);
    }
}

// ========== QUẢN LÝ: XÓA TIỀN QUẢN LÝ NHẬN ==========
function deleteManagerPickup(pickupId) {
    if (!pickupId) {
        showToast('⚠️ Không tìm thấy mã pickup', 'warning');
        return;
    }
    if (!confirm('🗑️ Xóa khoản tiền QL nhận này?\nThao tác này không thể hoàn tác!')) {
        return;
    }

    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';

    // Cập nhật UI ngay lập tức (optimistic) trước khi xóa
    _deletePickupUIOptimistic(pickupId);

    // Bước 1: Xóa trên Firebase
    var dbRef = firebase.database().ref(shopId + '/manager_cash_pickups/' + pickupId);
    dbRef.remove().catch(function(err) {
    });

    // Bước 2: Xóa trong IndexedDB qua DB.remove (nếu có)
    if (typeof DB !== 'undefined' && typeof DB.remove === 'function') {
        DB.remove('manager_cash_pickups', pickupId).then(function() {
            showToast('✅ Đã xóa pickup', 'success');
            _clearPickupCache();
            _quickReloadPosCashAfterPickup();
        }).catch(function(err) {
            showToast('✅ Đã xóa trên Firebase', 'success');
            _clearPickupCache();
            _quickReloadPosCashAfterPickup();
        });
    } else {
        showToast('✅ Đã xóa pickup', 'success');
        _clearPickupCache();
        _quickReloadPosCashAfterPickup();
    }
}

// ========== CẬP NHẬT UI NGAY KHI XÓA (OPTIMISTIC) ==========
function _deletePickupUIOptimistic(pickupId) {
    try {
        if (!_posCashData || !_posCashData.pickupHistory) return;
        // Tìm pickup trong history
        var removedAmount = 0;
        var newHistory = [];
        for (var i = 0; i < _posCashData.pickupHistory.length; i++) {
            var p = _posCashData.pickupHistory[i];
            if (p.id === pickupId) {
                removedAmount = p.amount || 0;
            } else {
                newHistory.push(p);
            }
        }
        if (removedAmount > 0) {
            _posCashData.managerPickupTotal = (_posCashData.managerPickupTotal || 0) - removedAmount;
            _posCashData.expectedClosing = (_posCashData.expectedClosing || 0) + removedAmount;
            _posCashData.pickupHistory = newHistory;
        }
        // Render lại UI
        var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
        renderCashCounter(isAdmin);
    } catch (e) {}
}
