// settings-data-fix.js - Fix old cashKept data
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// 6b. SỬA DỮ LIỆU CŨ: cashKept CHO CÁC NGÀY ĐÃ CHỐT
// ============================================================
// Hàm này được admin gọi thủ công qua nút "🔧 Sửa số dư đầu kỳ" trong UI.
// Chỉ sửa đúng 1 ngày được chọn, không tự động quét toàn bộ.
// Công thức: cashKept = expectedClosing + difference
// Vì cashKept là số tiền đếm được, difference = countedTotal - expectedClosing

function fixOldCashKeptData(dateKey) {
    if (!dateKey) {
        showToast('❌ Không có ngày để sửa!', 'error');
        return;
    }
    if (!confirm('🔧 Xác nhận sửa số dư đầu kỳ cho ngày ' + formatDateDisplay(dateKey) + '?\n\n' +
                 'Số dư đầu kỳ (cashKept) sẽ được đặt = expectedClosing + difference\n' +
                 '= số tiền đếm được thực tế khi chốt ca.\n\n' +
                 'LƯU Ý: Hàm này sẽ đọc cashKept của ngày hôm trước để làm openingBalance\n' +
                 'chính xác, thay vì dùng dữ liệu đã lưu (có thể bị sai).\n\n' +
                 'Tiếp tục?')) return;

    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var dbRef = firebase.database().ref(shopId + '/daily_balances');

    // Đọc dữ liệu của ngày cần sửa VÀ ngày hôm trước
    var prevDate = new Date(Date.UTC(
        parseInt(dateKey.split('-')[0], 10),
        parseInt(dateKey.split('-')[1], 10) - 1,
        parseInt(dateKey.split('-')[2], 10)
    ));
    prevDate.setDate(prevDate.getDate() - 1);
    var prevDateStr = prevDate.toISOString().slice(0, 10);

    Promise.all([
        dbRef.child(dateKey).once('value'),
        dbRef.child(prevDateStr).once('value')
    ]).then(function(results) {
        var data = results[0].val() || {};
        var prevData = results[1].val() || {};
        
        var difference = data.difference || 0;
        var currentCashKept = (data.cashKept !== undefined && data.cashKept !== null) ? data.cashKept : 0;

        // openingBalance CHÍNH XÁC = cashKept của ngày hôm trước (đọc từ Firebase)
        // Không dùng data.openingBalance đã lưu vì có thể bị sai do fixMissingCashKept cũ
        var openingBalance = (prevData.cashKept !== undefined && prevData.cashKept !== null) ? prevData.cashKept : 0;
        
        // Lấy cashRevenue, posCashExpense, managerPickupTotal từ dữ liệu đã lưu
        var cashRevenue = data.cashRevenue || 0;
        var posCashExpense = data.posCashExpense || 0;
        var managerPickupTotal = data.managerPickupTotal || 0;
        var expectedClosing = openingBalance + cashRevenue - posCashExpense - managerPickupTotal;

        // Nếu ko có dữ liệu chi tiết (các field = 0), thử dùng _posCashData
        if (cashRevenue === 0 && posCashExpense === 0 && managerPickupTotal === 0 && _posCashData && _posCashData.dateKey === dateKey) {
            expectedClosing = _posCashData.expectedClosing || 0;
        }

        // countedTotal = expectedClosing + difference
        var correctCashKept = expectedClosing + difference;
        if (correctCashKept < 0) correctCashKept = 0;

        // Nếu ko thay đổi thì bỏ qua
        if (correctCashKept === currentCashKept) {
            showToast('✅ Dữ liệu ngày ' + formatDateDisplay(dateKey) + ' đã đúng: ' + formatMoney(correctCashKept), 'success');
            return;
        }

        // Cập nhật cashKept
        dbRef.child(dateKey).update({
            cashKept: correctCashKept,
            updatedAt: Date.now()
        }).then(function() {
            showToast('✅ Đã sửa số dư đầu kỳ ngày ' + formatDateDisplay(dateKey) + ': ' + formatMoney(correctCashKept) + ' (trước: ' + formatMoney(currentCashKept) + ')', 'success');
            // Tải lại dữ liệu
            loadPosCashData();
        }).catch(function(err) {
            showToast('❌ Lỗi khi sửa dữ liệu!', 'error');
        });
    }).catch(function(err) {
        showToast('❌ Lỗi đọc dữ liệu từ Firebase!', 'error');
    });
}

// ============================================================
// 6c. QUÉT & SỬA TẤT CẢ DỮ LIỆU CŨ: cashKept
// ============================================================
// Hàm này duyệt qua tất cả các ngày đã chốt trong daily_balances,
// tính toán tuần tự: cashKept của ngày trước là openingBalance của ngày sau.
// cashKept đúng = expectedClosing + difference
// expectedClosing = openingBalance + cashRevenue - posCashExpense - managerPickupTotal
//
// QUAN TRỌNG: Ngày đầu tiên trong chuỗi, nếu cashKept đã tồn tại và hợp lý,
// dùng luôn cashKept đó làm prevCashKept (ko gán mặc định = 0).
// Chỉ sửa khi có đủ dữ liệu chi tiết (cashRevenue, posCashExpense, managerPickupTotal).

function fixAllOldCashKeptData() {
    if (!confirm('🔧 Xác nhận quét & sửa tất cả dữ liệu cũ?\n\n' +
                 'Hàm này sẽ duyệt qua tất cả các ngày đã chốt,\n' +
                 'tính toán tuần tự từ ngày đầu tiên:\n' +
                 '- cashKept ngày trước = openingBalance ngày sau\n' +
                 '- cashKept đúng = expectedClosing + difference\n' +
                 '- expectedClosing = openingBalance + cashRevenue - posCashExpense - managerPickupTotal\n\n' +
                 'Các ngày thiếu dữ liệu (cashRevenue, posCashExpense...)\n' +
                 'sẽ giữ nguyên cashKept hiện tại và dùng làm điểm bắt đầu cho ngày tiếp theo.\n' +
                 'Hãy mở từng ngày đó trước để tự động lưu dữ liệu, sau đó chạy lại.\n\n' +
                 'Tiếp tục?')) return;

    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var dbRef = firebase.database().ref(shopId + '/daily_balances');

    dbRef.once('value').then(function(snapshot) {
        var allData = snapshot.val() || {};
        var dateKeys = Object.keys(allData).sort();
        var fixedCount = 0;
        var skipCount = 0;
        var noDataCount = 0;
        var promises = [];
        var prevCashKept = 0;
        var isFirstDay = true; // Đánh dấu ngày đầu tiên trong chuỗi

        dateKeys.forEach(function(dateKey) {
            var data = allData[dateKey];
            if (!data.isClosed) return; // Bỏ qua ngày chưa chốt

            var difference = data.difference || 0;
            var currentCashKept = (data.cashKept !== undefined && data.cashKept !== null) ? data.cashKept : null;

            // Lấy các field từ daily_balances (nếu có)
            var cashRevenue = data.cashRevenue || 0;
            var posCashExpense = data.posCashExpense || 0;
            var managerPickupTotal = data.managerPickupTotal || 0;

            // Kiểm tra xem có đủ dữ liệu chi tiết để tính toán ko
            var hasDetailData = (cashRevenue !== 0 || posCashExpense !== 0 || managerPickupTotal !== 0 || difference !== 0);

            // ===== XỬ LÝ NGÀY ĐẦU TIÊN =====
            if (isFirstDay) {
                isFirstDay = false;
                
                // Nếu ngày đầu có cashKept hợp lệ, dùng nó làm prevCashKept
                if (currentCashKept !== null && currentCashKept > 0) {
                    prevCashKept = currentCashKept;
                    
                    // Nếu có đủ dữ liệu, kiểm tra xem cashKept có đúng ko
                    if (hasDetailData) {
                        // openingBalance cho ngày đầu = 0 (ko có ngày trước)
                        var expectedClosing = 0 + cashRevenue - posCashExpense - managerPickupTotal;
                        var correctCashKept = expectedClosing + difference;
                        if (correctCashKept < 0) correctCashKept = 0;
                        
                        if (currentCashKept !== correctCashKept) {
                            fixedCount++;
                            promises.push(dbRef.child(dateKey).update({
                                cashKept: correctCashKept,
                                updatedAt: Date.now()
                            }));
                            prevCashKept = correctCashKept;
                        } else {
                            skipCount++;
                        }
                    } else {
                        // Ko có dữ liệu chi tiết, giữ nguyên cashKept hiện tại
                        noDataCount++;
                    }
                    return;
                }
                
                // Nếu ngày đầu ko có cashKept, bắt đầu từ 0
                prevCashKept = 0;
            }

            // ===== XỬ LÝ CÁC NGÀY TIẾP THEO =====
            // openingBalance = cashKept của ngày hôm trước (tính tuần tự)
            var openingBalance = prevCashKept;

            // expectedClosing = openingBalance + cashRevenue - posCashExpense - managerPickupTotal
            var expectedClosing = openingBalance + cashRevenue - posCashExpense - managerPickupTotal;

            // countedTotal = expectedClosing + difference
            var correctCashKept = expectedClosing + difference;
            if (correctCashKept < 0) correctCashKept = 0;

            // Nếu ko có dữ liệu chi tiết, giữ nguyên cashKept hiện tại
            if (!hasDetailData) {
                noDataCount++;
                if (currentCashKept !== null) {
                    prevCashKept = currentCashKept;
                } else {
                    prevCashKept = correctCashKept;
                }
                return;
            }

            // Nếu cashKept hiện tại khác với giá trị đúng thì sửa
            if (currentCashKept !== null && currentCashKept !== correctCashKept) {
                fixedCount++;
                promises.push(dbRef.child(dateKey).update({
                    cashKept: correctCashKept,
                    updatedAt: Date.now()
                }));
                prevCashKept = correctCashKept;
            } else {
                skipCount++;
                if (currentCashKept !== null) {
                    prevCashKept = currentCashKept;
                } else {
                    prevCashKept = correctCashKept;
                }
            }
        });

        if (fixedCount === 0 && noDataCount === 0) {
            showToast('✅ Tất cả dữ liệu đã đúng. Không cần sửa.', 'success');
            return;
        }

        var msg = '✅ Đã sửa ' + fixedCount + ' ngày, bỏ qua ' + skipCount + ' ngày (đã đúng)';
        if (noDataCount > 0) {
            msg += ', ' + noDataCount + ' ngày (thiếu dữ liệu - giữ nguyên cashKept hiện tại)';
        }

        if (fixedCount === 0) {
            showToast(msg, 'warning');
            return;
        }

        Promise.all(promises).then(function() {
            showToast(msg, 'success');
            loadPosCashData();
        }).catch(function(err) {
            showToast('❌ Lỗi khi sửa dữ liệu!', 'error');
        });
    }).catch(function(err) {
        showToast('❌ Lỗi đọc dữ liệu từ Firebase!', 'error');
    });
}