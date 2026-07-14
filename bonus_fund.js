// bonus_fund.js - Quỹ thưởng trách nhiệm
// Tự động trích 1% doanh thu (cash + transfer + grab) vào quỹ thưởng
// Sử dụng daily_revenue từ employees.js để tính 1% (không tính từ từng transaction)
// Hỗ trợ: rút quỹ, thưởng thêm, sửa/xóa giao dịch
// ES5, tương thích Android 6, iOS 12
// File độc lập, có thể chạy tách biệt

// ========== BIẾN GLOBAL ==========
var _bonusFundRecords = [];           // Các giao dịch thủ công (withdraw, bonus, cash_shortage)
var _bonusFundTotal = 0;              // Tổng quỹ (manual + revenue_percent)
var _bonusFundCurrentPage = 0;        // Trang hiện tại trong modal
var _bonusFundPageSize = 5;           // Số ngày mỗi trang
var _bonusFundProcessedIds = {};      // Chống realtime thêm lại khi xóa
var _bonusFundInitialized = false;    // Đã khởi tạo chưa
var _bonusFundRendering = false;      // Đang render (chống loop)
var _savingBonusFund = false;         // Đang lưu (chống double-save)
var _bonusFundRevenueCache = {};      // Cache daily_revenue { dateStr: cash+transfer+grab }
var _bonusFundRevenueListener = null; // Firebase listener reference
var _bonusFundRevenueRecords = {};    // Revenue_percent records đã tạo { dateStr: record }
var _bonusFundDeletedRevenueDates = {}; // Các ngày đã xóa revenue_percent (chống tạo lại, lưu localStorage)

// Khôi phục _bonusFundDeletedRevenueDates từ localStorage
try {
    var saved = localStorage.getItem('bf_deleted_revenue_dates');
    if (saved) {
        _bonusFundDeletedRevenueDates = JSON.parse(saved);
    }
} catch(e) {}

// Hàm lưu _bonusFundDeletedRevenueDates xuống localStorage
function _bfSaveDeletedRevenueDates() {
    try {
        localStorage.setItem('bf_deleted_revenue_dates', JSON.stringify(_bonusFundDeletedRevenueDates));
    } catch(e) {}
}

// ========== HÀM TIỆN ÍCH ==========
function _bfGetShopId() {
    return (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
}

function _bfGetTodayDateStr() {
    var now = new Date();
    return now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');
}

// ========== KHỞI TẠO ==========
function initBonusFund() {
    if (_bonusFundInitialized) return Promise.resolve();
    _bonusFundInitialized = true;

    // Bước 1: Load manual records từ bonus_fund collection
    return DB.getAll('bonus_fund').then(function(records) {
        var filtered = [];
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (r.deleted) continue;
            if (_bonusFundProcessedIds[r.id]) continue;
            // Bỏ qua revenue_percent nếu ngày đã bị xóa
            if (r.type === 'revenue_percent' && r.dateKey && _bonusFundDeletedRevenueDates[r.dateKey]) continue;
            // Chỉ lấy manual types (revenue_percent sẽ được tính từ daily_revenue)
            if (r.type === 'revenue_percent') {
                // Cache lại revenue_percent records để tránh tạo trùng
                if (r.dateKey) {
                    _bonusFundRevenueRecords[r.dateKey] = r;
                }
                filtered.push(r);
            } else {
                filtered.push(r);
            }
        }
        _bonusFundRecords = filtered;

        // Bước 2: Khởi tạo daily_revenue listener
        _bfInitRevenueListener();

        // Bước 3: Tính tổng và render
        _calculateTotal();
        _renderBonusFundUI();
    }).catch(function(err) {
        console.error('[BonusFund] Init error:', err);
        _bonusFundRecords = [];
        _bfInitRevenueListener();
        _calculateTotal();
        _renderBonusFundUI();
    });
}

// ========== DAILY REVENUE LISTENER (giống employees.js) ==========
function _bfInitRevenueListener() {
    var shopId = _bfGetShopId();
    if (!shopId || typeof firebase === 'undefined') return;

    // Hủy listener cũ nếu có
    if (_bonusFundRevenueListener) {
        _bonusFundRevenueListener.off();
    }

    if (!_bonusFundRevenueCache) _bonusFundRevenueCache = {};

    var ref = firebase.database().ref(shopId + '/daily_revenue');
    var listener = ref.on('value', function(snapshot) {
        var data = snapshot.val() || {};
        var changed = false;

        // Cập nhật cache: mỗi key là dateStr YYYY-MM-DD
        for (var dateStr in data) {
            if (data.hasOwnProperty(dateStr) && data[dateStr]) {
                var dayData = data[dateStr];
                var revenue = 0;
                if (typeof dayData === 'number') {
                    revenue = dayData;
                } else if (typeof dayData === 'object') {
                    // Ưu tiên cash+transfer+grab nếu có
                    if (dayData.cash !== undefined || dayData.transfer !== undefined || dayData.grab !== undefined) {
                        revenue = (dayData.cash || 0) + (dayData.transfer || 0) + (dayData.grab || 0);
                    } else if (dayData.total) {
                        revenue = dayData.total;
                    }
                }
                if (_bonusFundRevenueCache[dateStr] !== revenue) {
                    _bonusFundRevenueCache[dateStr] = revenue;
                    changed = true;
                }
            }
        }

        if (changed) {
            // Tính toán lại revenue_percent cho các ngày có thay đổi
            _bfSyncRevenuePercent();
        }
    }, function(err) {
        console.error('[BonusFund] Revenue listener error:', err);
    });

    _bonusFundRevenueListener = {
        ref: ref,
        off: function() { ref.off('value', listener); }
    };
}

// ========== ĐỒNG BỘ REVENUE_PERCENT VỚI DAILY_REVENUE ==========
function _bfSyncRevenuePercent() {
    // Thu thập danh sách các ngày cần xử lý
    var pendingDates = [];
    for (var dateStr in _bonusFundRevenueCache) {
        if (_bonusFundRevenueCache.hasOwnProperty(dateStr)) {
            var revenue = _bonusFundRevenueCache[dateStr];
            if (revenue <= 0) continue;

            // BỎ QUA các ngày đã bị admin xóa revenue_percent
            if (_bonusFundDeletedRevenueDates[dateStr]) continue;

            // Dùng Math.round() giống employees.js (dòng 2066)
            var percentAmount = Math.round(revenue * 0.01);
            if (percentAmount <= 0) continue;

            var existingRecord = _bonusFundRevenueRecords[dateStr];

            if (existingRecord) {
                // Đã có record - kiểm tra nếu số tiền thay đổi thì cập nhật
                if (existingRecord.amount !== percentAmount || existingRecord.revenueAmount !== revenue) {
                    pendingDates.push({
                        dateStr: dateStr,
                        percentAmount: percentAmount,
                        revenue: revenue,
                        id: existingRecord.id,
                        isUpdate: true
                    });
                }
            } else {
                // Chưa có - tạo mới
                pendingDates.push({
                    dateStr: dateStr,
                    percentAmount: percentAmount,
                    revenue: revenue,
                    isUpdate: false
                });
            }
        }
    }

    if (pendingDates.length === 0) {
        _calculateTotal();
        _renderBonusFundUI();
        return;
    }

    // Xử lý tuần tự từng ngày để tránh _savingBonusFund blocking
    var chain = Promise.resolve();
    for (var p = 0; p < pendingDates.length; p++) {
        chain = chain.then((function(item) {
            return function() {
                if (item.isUpdate) {
                    return _bfUpdateRevenuePercentRecord(item.id, item.dateStr, item.percentAmount, item.revenue);
                } else {
                    return _bfCreateRevenuePercentRecord(item.dateStr, item.percentAmount, item.revenue);
                }
            };
        })(pendingDates[p]));
    }

    chain.then(function() {
        _calculateTotal();
        _renderBonusFundUI();
    }).catch(function(err) {
        console.error('[BonusFund] Sync revenue percent error:', err);
        _calculateTotal();
        _renderBonusFundUI();
    });
}

// ========== TẠO REVENUE_PERCENT RECORD ==========
function _bfCreateRevenuePercentRecord(dateStr, percentAmount, revenue) {
    if (_savingBonusFund) return Promise.resolve();

    var data = {
        id: 'bf_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
        type: 'revenue_percent',
        amount: percentAmount,
        note: '1% doanh thu',
        dateKey: dateStr,
        createdAt: Date.now(),
        createdBy: window.currentDeviceId || '',
        revenueAmount: revenue,
        transactionId: null,
        deleted: false,
        editedAt: null,
        editedBy: null
    };

    _savingBonusFund = true;
    return DB.create('bonus_fund', data).then(function() {
        _bonusFundRevenueRecords[dateStr] = data;
        _bonusFundRecords.push(data);
        _savingBonusFund = false;
    }).catch(function(err) {
        console.error('[BonusFund] Create revenue_percent error:', err);
        _savingBonusFund = false;
    });
}

// ========== CẬP NHẬT REVENUE_PERCENT RECORD ==========
function _bfUpdateRevenuePercentRecord(id, dateStr, percentAmount, revenue) {
    if (_savingBonusFund) return Promise.resolve();

    var shopId = _bfGetShopId();
    var fbRef = firebase.database().ref(shopId + '/bonus_fund/' + id);

    _savingBonusFund = true;
    return fbRef.update({
        amount: percentAmount,
        revenueAmount: revenue,
        editedAt: Date.now(),
        editedBy: window.currentDeviceId || ''
    }).then(function() {
        // Cập nhật local cache
        if (_bonusFundRevenueRecords[dateStr]) {
            _bonusFundRevenueRecords[dateStr].amount = percentAmount;
            _bonusFundRevenueRecords[dateStr].revenueAmount = revenue;
            _bonusFundRevenueRecords[dateStr].editedAt = Date.now();
        }
        // Cập nhật trong _bonusFundRecords
        for (var i = 0; i < _bonusFundRecords.length; i++) {
            if (_bonusFundRecords[i].id === id) {
                _bonusFundRecords[i].amount = percentAmount;
                _bonusFundRecords[i].revenueAmount = revenue;
                _bonusFundRecords[i].editedAt = Date.now();
                break;
            }
        }
        _savingBonusFund = false;
    }).catch(function(err) {
        console.error('[BonusFund] Update revenue_percent error:', err);
        _savingBonusFund = false;
    });
}

// ========== TÍNH TỔNG QUỸ ==========
function _calculateTotal() {
    var total = 0;
    for (var i = 0; i < _bonusFundRecords.length; i++) {
        var r = _bonusFundRecords[i];
        if (r.deleted) continue;
        if (_bonusFundProcessedIds[r.id]) continue;
        total += r.amount || 0;
    }
    _bonusFundTotal = total;
    return total;
}

// ========== LẤY TỔNG QUỸ (public) ==========
function getBonusFundTotal() {
    return _bonusFundTotal;
}

// ========== XỬ LÝ THIẾU TIỀN MẶT (từ đối soát quỹ) ==========
function handleCashShortage(dateStr, difference) {
    // difference là số âm (ví dụ: -30000)
    if (difference >= 0) return Promise.resolve(null);

    var now = new Date();
    var data = {
        id: 'bf_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
        type: 'cash_shortage',
        amount: difference, // Số âm
        note: 'Trừ thiếu tiền mặt tại POS',
        dateKey: dateStr || _bfGetTodayDateStr(),
        createdAt: Date.now(),
        createdBy: window.currentDeviceId || '',
        difference: difference,
        deleted: false,
        editedAt: null,
        editedBy: null
    };

    return DB.create('bonus_fund', data).then(function() {
        _bonusFundRecords.push(data);
        _calculateTotal();
        _renderBonusFundUI();
        showToast('💰 Quỹ thưởng bị trừ ' + formatMoney(Math.abs(difference)) + ' do thiếu tiền mặt', 'warning', 3000);
        return data;
    }).catch(function(err) {
        console.error('[BonusFund] Create cash_shortage error:', err);
        return null;
    });
}

// ========== RÚT QUỸ (ADMIN) ==========
function withdrawBonusFund() {
    if (!DB.isAdmin || !DB.isAdmin()) {
        showToast('Chỉ admin mới được rút quỹ!', 'error');
        return;
    }

    if (_bonusFundTotal <= 0) {
        showToast('Quỹ thưởng hiện tại là 0đ, không thể rút!', 'warning');
        return;
    }

    var amountStr = prompt('💰 Nhập số tiền cần rút (tối đa ' + formatMoney(_bonusFundTotal) + '):', '');
    if (amountStr === null) return;
    var amount = parseInt(amountStr.replace(/\./g, '').replace(/[^0-9]/g, '')) || 0;
    if (amount <= 0) {
        showToast('Số tiền không hợp lệ!', 'warning');
        return;
    }
    if (amount > _bonusFundTotal) {
        showToast('Số tiền vượt quá số dư quỹ!', 'warning');
        return;
    }

    var reason = prompt('📝 Nhập lý do rút quỹ:', '');
    if (reason === null) return;
    reason = reason.trim();
    if (reason === '') {
        showToast('Vui lòng nhập lý do rút quỹ!', 'warning');
        return;
    }

    var dateKey = _bfGetTodayDateStr();

    var data = {
        id: 'bf_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
        type: 'withdraw',
        amount: -amount, // Số âm
        note: 'Rút quỹ: ' + reason,
        dateKey: dateKey,
        createdAt: Date.now(),
        createdBy: window.currentDeviceId || '',
        reason: reason,
        deleted: false,
        editedAt: null,
        editedBy: null
    };

    _savingBonusFund = true;
    DB.create('bonus_fund', data).then(function() {
        _bonusFundRecords.push(data);
        _calculateTotal();
        _renderBonusFundUI();
        showToast('✅ Đã rút ' + formatMoney(amount) + ' khỏi quỹ thưởng', 'success');
        _savingBonusFund = false;
    }).catch(function(err) {
        console.error('[BonusFund] Withdraw error:', err);
        showToast('Lỗi khi rút quỹ!', 'error');
        _savingBonusFund = false;
    });
}

// ========== THƯỞNG THÊM (ADMIN) ==========
function addBonusFund() {
    if (!DB.isAdmin || !DB.isAdmin()) {
        showToast('Chỉ admin mới được thưởng thêm!', 'error');
        return;
    }

    var amountStr = prompt('🎁 Nhập số tiền thưởng thêm:', '');
    if (amountStr === null) return;
    var amount = parseInt(amountStr.replace(/\./g, '').replace(/[^0-9]/g, '')) || 0;
    if (amount <= 0) {
        showToast('Số tiền không hợp lệ!', 'warning');
        return;
    }

    var reason = prompt('📝 Ghi chú (không bắt buộc):', '');
    if (reason === null) return;
    reason = reason.trim();

    var dateKey = _bfGetTodayDateStr();

    var data = {
        id: 'bf_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
        type: 'bonus',
        amount: amount, // Số dương
        note: reason ? 'Thưởng thêm: ' + reason : 'Thưởng thêm',
        dateKey: dateKey,
        createdAt: Date.now(),
        createdBy: window.currentDeviceId || '',
        reason: reason,
        deleted: false,
        editedAt: null,
        editedBy: null
    };

    _savingBonusFund = true;
    DB.create('bonus_fund', data).then(function() {
        _bonusFundRecords.push(data);
        _calculateTotal();
        _renderBonusFundUI();
        showToast('✅ Đã thêm ' + formatMoney(amount) + ' vào quỹ thưởng', 'success');
        _savingBonusFund = false;
    }).catch(function(err) {
        console.error('[BonusFund] Add bonus error:', err);
        showToast('Lỗi khi thưởng!', 'error');
        _savingBonusFund = false;
    });
}

// ========== SỬA GIAO DỊCH (ADMIN) ==========
function editBonusFund(id) {
    if (!DB.isAdmin || !DB.isAdmin()) {
        showToast('Chỉ admin mới được sửa!', 'error');
        return;
    }

    // Tìm record
    var record = null;
    for (var i = 0; i < _bonusFundRecords.length; i++) {
        if (_bonusFundRecords[i].id === id) {
            record = _bonusFundRecords[i];
            break;
        }
    }
    if (!record) {
        showToast('Không tìm thấy giao dịch!', 'error');
        return;
    }

    var currentAmount = record.amount;
    var absAmount = Math.abs(currentAmount);
    var isNegative = currentAmount < 0;

    var amountStr = prompt('✏️ Nhập số tiền mới (hiện tại: ' + formatMoney(absAmount) + '):', formatMoney(absAmount).replace(/\./g, ''));
    if (amountStr === null) return;
    var newAmount = parseInt(amountStr.replace(/\./g, '').replace(/[^0-9]/g, '')) || 0;
    if (newAmount <= 0) {
        showToast('Số tiền không hợp lệ!', 'warning');
        return;
    }

    // Giữ nguyên dấu
    var finalAmount = isNegative ? -newAmount : newAmount;

    // Cập nhật Firebase
    var updateData = {
        amount: finalAmount,
        editedAt: Date.now(),
        editedBy: window.currentDeviceId || ''
    };

    var shopId = _bfGetShopId();
    var fbRef = firebase.database().ref(shopId + '/bonus_fund/' + id);

    fbRef.update(updateData).then(function() {
        // Cập nhật local
        record.amount = finalAmount;
        record.editedAt = updateData.editedAt;
        record.editedBy = updateData.editedBy;
        _calculateTotal();
        _renderBonusFundUI();
        showToast('✅ Đã cập nhật số tiền', 'success');
    }).catch(function(err) {
        console.error('[BonusFund] Edit error:', err);
        showToast('Lỗi khi sửa!', 'error');
    });
}

// ========== XÓA GIAO DỊCH (ADMIN) ==========
function deleteBonusFund(id) {
    if (!DB.isAdmin || !DB.isAdmin()) {
        showToast('Chỉ admin mới được xóa!', 'error');
        return;
    }

    if (!confirm('🗑️ Xóa giao dịch này khỏi quỹ thưởng?')) return;

    // Đánh dấu để chống realtime thêm lại
    _bonusFundProcessedIds[id] = true;

    // Nếu là revenue_percent, đánh dấu ngày đã xóa để _bfSyncRevenuePercent không tạo lại
    for (var i = 0; i < _bonusFundRecords.length; i++) {
        if (_bonusFundRecords[i].id === id && _bonusFundRecords[i].type === 'revenue_percent') {
            var dateKey = _bonusFundRecords[i].dateKey;
            if (dateKey) {
                _bonusFundDeletedRevenueDates[dateKey] = true;
                _bfSaveDeletedRevenueDates(); // Lưu xuống localStorage
                // Xóa khỏi cache để _bfSyncRevenuePercent không cập nhật record cũ
                if (_bonusFundRevenueRecords[dateKey]) {
                    delete _bonusFundRevenueRecords[dateKey];
                }
            }
            break;
        }
    }

    DB.remove('bonus_fund', id).then(function() {
        // Xóa khỏi local cache
        var newRecords = [];
        for (var i = 0; i < _bonusFundRecords.length; i++) {
            if (_bonusFundRecords[i].id !== id) {
                newRecords.push(_bonusFundRecords[i]);
            }
        }
        _bonusFundRecords = newRecords;
        _calculateTotal();
        _renderBonusFundUI();
        showToast('✅ Đã xóa giao dịch', 'success');
    }).catch(function(err) {
        console.error('[BonusFund] Delete error:', err);
        delete _bonusFundProcessedIds[id]; // Bỏ đánh dấu nếu lỗi
    });
}

// ========== REFRESH (gọi từ realtime) ==========
function refreshBonusFund() {
    if (_bonusFundRendering) return;
    _bonusFundRendering = true;

    DB.getAll('bonus_fund').then(function(records) {
        // Lọc bỏ các record đã xóa (processed)
        var filtered = [];
        var revenueRecords = {};
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (r.deleted) continue;
            if (_bonusFundProcessedIds[r.id]) continue;
            // Bỏ qua revenue_percent nếu ngày đã bị xóa
            if (r.type === 'revenue_percent' && r.dateKey && _bonusFundDeletedRevenueDates[r.dateKey]) continue;
            if (r.type === 'revenue_percent' && r.dateKey) {
                revenueRecords[r.dateKey] = r;
            }
            filtered.push(r);
        }
        _bonusFundRevenueRecords = revenueRecords;
        _bonusFundRecords = filtered;
        _calculateTotal();
        _renderBonusFundUI();
        _bonusFundRendering = false;
    }).catch(function(err) {
        console.error('[BonusFund] Refresh error:', err);
        _bonusFundRendering = false;
    });
}

// ========== RENDER UI TRONG SETTINGS ==========
function _renderBonusFundUI() {
    var totalEl = document.getElementById('bonusFundTotal');
    if (totalEl) {
        totalEl.textContent = formatMoney(_bonusFundTotal);
    }
    var statusEl = document.getElementById('bonusFundStatus');
    if (statusEl) {
        var count = 0;
        for (var i = 0; i < _bonusFundRecords.length; i++) {
            if (!_bonusFundRecords[i].deleted) count++;
        }
        statusEl.textContent = '📊 Tổng số giao dịch: ' + count;
    }
}

// ========== LẤY RANGE NGÀY CHO TRANG ==========
function _getDateRangeForPage(page) {
    // page 0 = hôm nay, page 1 = 5 ngày trước, v.v.
    var today = new Date();
    var endDate = new Date(today);
    endDate.setDate(endDate.getDate() - (page * _bonusFundPageSize));
    var startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - _bonusFundPageSize + 1);

    var startKey = startDate.getFullYear() + '-' +
        String(startDate.getMonth() + 1).padStart(2, '0') + '-' +
        String(startDate.getDate()).padStart(2, '0');
    var endKey = endDate.getFullYear() + '-' +
        String(endDate.getMonth() + 1).padStart(2, '0') + '-' +
        String(endDate.getDate()).padStart(2, '0');

    return { startKey: startKey, endKey: endKey, startDate: startDate, endDate: endDate };
}

// ========== MỞ MODAL CHI TIẾT ==========
function openBonusFundModal() {
    var modal = document.getElementById('bonusFundModal');
    if (!modal) {
        showToast('Không tìm thấy modal!', 'error');
        return;
    }
    _bonusFundCurrentPage = 0;
    _renderBonusFundModal();
    modal.style.display = 'flex';
}

// ========== CHUYỂN TRANG ==========
function bonusFundPrevPage() {
    if (_bonusFundCurrentPage < 0) return;
    _bonusFundCurrentPage++;
    _renderBonusFundModal();
}

function bonusFundNextPage() {
    if (_bonusFundCurrentPage > 0) {
        _bonusFundCurrentPage--;
        _renderBonusFundModal();
    }
}

// ========== RENDER MODAL ==========
function _renderBonusFundModal() {
    var range = _getDateRangeForPage(_bonusFundCurrentPage);
    var dateRangeEl = document.getElementById('bonusFundDateRange');
    if (dateRangeEl) {
        var startStr = range.startDate.getDate() + '/' + (range.startDate.getMonth() + 1) + '/' + range.startDate.getFullYear();
        var endStr = range.endDate.getDate() + '/' + (range.endDate.getMonth() + 1) + '/' + range.endDate.getFullYear();
        dateRangeEl.textContent = startStr + ' - ' + endStr;
    }

    var dayListEl = document.getElementById('bonusFundDayList');
    if (!dayListEl) return;

    // Nhóm records theo dateKey
    var dayMap = {};
    for (var i = 0; i < _bonusFundRecords.length; i++) {
        var r = _bonusFundRecords[i];
        if (r.deleted) continue;
        if (_bonusFundProcessedIds[r.id]) continue;
        if (r.dateKey < range.startKey || r.dateKey > range.endKey) continue;
        if (!dayMap[r.dateKey]) dayMap[r.dateKey] = [];
        dayMap[r.dateKey].push(r);
    }

    // Sắp xếp ngày giảm dần
    var dayKeys = Object.keys(dayMap).sort().reverse();

    if (dayKeys.length === 0) {
        dayListEl.innerHTML = '<div class="empty-text" style="padding:20px;text-align:center;color:#64748b;">📭 Không có giao dịch trong khoảng ngày này</div>';
        return;
    }

    var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
    var html = '';

    for (var d = 0; d < dayKeys.length; d++) {
        var dk = dayKeys[d];
        var dayRecords = dayMap[dk];
        // Sắp xếp theo createdAt giảm dần
        dayRecords.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

        // Tính tổng ngày
        var dayTotal = 0;
        for (var ri = 0; ri < dayRecords.length; ri++) {
            dayTotal += dayRecords[ri].amount || 0;
        }

        var dateParts = dk.split('-');
        var displayDate = 'Ngày ' + dateParts[2] + '/' + dateParts[1] + '/' + dateParts[0];

        html += '<div class="bonus-fund-day">' +
            '<div class="bonus-fund-day-header">' +
                '<span>' + displayDate + '</span>' +
                '<span class="bonus-fund-day-total">' +
                    (dayTotal >= 0 ? '+' : '') + formatMoney(dayTotal) +
                '</span>' +
            '</div>';

        for (var ri = 0; ri < dayRecords.length; ri++) {
            var r = dayRecords[ri];
            var icon = _getTypeIcon(r.type);
            var desc = _getTypeDescription(r);
            var amountClass = r.amount >= 0 ? 'positive' : 'negative';
            var amountStr = (r.amount >= 0 ? '+' : '') + formatMoney(r.amount);

            html += '<div class="bonus-fund-item">' +
                '<span class="bonus-fund-item-icon">' + icon + '</span>' +
                '<span class="bonus-fund-item-desc">' + escapeHtml(desc) + '</span>';

            // Hiển thị doanh thu gốc nếu là revenue_percent
            if (r.type === 'revenue_percent' && r.revenueAmount) {
                html += '<span class="bonus-fund-revenue-detail">(' + formatMoney(r.revenueAmount) + ')</span>';
            }

            html += '<span class="bonus-fund-item-amount ' + amountClass + '">' + amountStr + '</span>';

            if (isAdmin) {
                html += '<span class="bonus-fund-item-actions">' +
                    '<button class="bonus-fund-item-btn edit" onclick="editBonusFund(\'' + r.id + '\')" title="Sửa">✏️</button>' +
                    '<button class="bonus-fund-item-btn delete" onclick="deleteBonusFund(\'' + r.id + '\')" title="Xóa">🗑️</button>' +
                '</span>';
            }

            html += '</div>';
        }

        html += '</div>';
    }

    dayListEl.innerHTML = html;
}

// ========== LẤY ICON THEO LOẠI ==========
function _getTypeIcon(type) {
    switch (type) {
        case 'revenue_percent': return '📈';
        case 'cash_shortage': return '🔴';
        case 'withdraw': return '🏧';
        case 'bonus': return '🎁';
        default: return '💰';
    }
}

// ========== LẤY MÔ TẢ THEO LOẠI ==========
function _getTypeDescription(record) {
    switch (record.type) {
        case 'revenue_percent':
            return '1% doanh thu';
        case 'cash_shortage':
            return 'Trừ thiếu tiền mặt tại POS';
        case 'withdraw':
            return record.reason ? 'Rút quỹ: ' + record.reason : 'Rút quỹ';
        case 'bonus':
            return record.reason ? 'Thưởng thêm: ' + record.reason : 'Thưởng thêm';
        default:
            return record.note || 'Giao dịch quỹ thưởng';
    }
}

// ========== EXPORT GLOBAL ==========
window.initBonusFund = initBonusFund;
window.refreshBonusFund = refreshBonusFund;
window.handleCashShortage = handleCashShortage;
window.withdrawBonusFund = withdrawBonusFund;
window.addBonusFund = addBonusFund;
window.editBonusFund = editBonusFund;
window.deleteBonusFund = deleteBonusFund;
window.openBonusFundModal = openBonusFundModal;
window.bonusFundPrevPage = bonusFundPrevPage;
window.bonusFundNextPage = bonusFundNextPage;
window.getBonusFundTotal = getBonusFundTotal;

// ========== ĐĂNG KÝ EVENT LISTENER ==========
// Lắng nghe sự kiện thanh toán để cập nhật daily_revenue (giống employees.js)
document.addEventListener('pos_cash_update', function() {
    // Firebase daily_revenue listener sẽ tự động cập nhật
    // Không cần làm gì thêm vì _bfInitRevenueListener đã lắng nghe daily_revenue
});
