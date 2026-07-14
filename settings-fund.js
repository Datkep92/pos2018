// settings-fund.js - Quỹ thưởng trách nhiệm (Responsibility Bonus Fund)
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js
//
// LOGIC:
// - Mỗi ngày: tự động trích 1% doanh thu (cash+transfer+grab) vào quỹ
// - Khi chốt ngày: nếu thiếu tiền (difference < 0) → trừ từ quỹ
// - Tổng quỹ = Nhập quỹ ban đầu + Tổng thưởng theo ngày - Tổng bù thiếu hụt - Tổng rút
// - UI dạng bảng log: hiển thị từng ngày với +tiền (thưởng) hoặc -tiền (thiếu hụt/rút)
// - Admin có thể xóa giao dịch thưởng theo ngày
// ============================================================

// ============================================================
// MULTI-FIREBASE: Helper lấy đúng DB instance cho quỹ
// Dùng Slave DB (POS) nếu có, fallback Master DB, fallback firebase.database()
// ============================================================
function _getFundDb() {
    if (typeof DB !== 'undefined' && DB.getSlaveDb && DB.getSlaveDb()) {
        return DB.getSlaveDb();
    }
    if (typeof DB !== 'undefined' && DB.getMasterDb && DB.getMasterDb()) {
        return DB.getMasterDb();
    }
    return firebase.database();
}

// ============================================================
// LISTENER QUỸ: cập nhật UI realtime khi có thay đổi từ Firebase
// ============================================================
function initFundListener() {
    try {
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');

        if (_fundListener) {
            fundRef.off('value', _fundListener);
        }

        _fundListener = fundRef.on('value', function(snapshot) {
            var data = snapshot.val() || {};
            _fundData = data;
            _renderFundUI();

            // Dọn dẹp daily_fund_edited entries cũ (nếu còn sót)
            _cleanupFundEditedEntries();
        });
    } catch (e) {
        // Firebase chưa sẵn sàng
    }
}

// ============================================================
// Dọn dẹp daily_fund_edited entries cũ trên Firebase
// ============================================================
function _cleanupFundEditedEntries() {
    try {
        if (!_fundData || !_fundData.history) return;
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');
        var hasEdited = false;
        var cleanupUpdates = {};

        for (var hk in _fundData.history) {
            var hEntry = _fundData.history[hk];
            if (hEntry && hEntry.type === 'daily_fund_edited') {
                cleanupUpdates['history/' + hk] = null;
                hasEdited = true;
            }
        }

        if (hasEdited) {
            fundRef.update(cleanupUpdates).then(function() {
                // Đã xóa, cần tính lại balance
                _recalculateFundBalance();
            }).catch(function() {});
        }
    } catch (e) {}
}

// ============================================================
// LISTENER DOANH THU: cache realtime, tự động ghi 1% vào quỹ
// Gọi 1 lần duy nhất khi load, chạy độc lập ko cần tab settings
// ============================================================
function _initFundRevenueListener() {
    try {
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var revenueRef = _getFundDb().ref(shopId + '/daily_revenue');

        if (_fundRevenueListener) {
            revenueRef.off('value', _fundRevenueListener);
        }

        var isFirstLoad = true;

        _fundRevenueListener = revenueRef.on('value', function(snapshot) {
            var data = snapshot.val() || {};
            _fundRevenueCache = data;

            // Lần đầu: backfill tất cả các ngày
            if (isFirstLoad) {
                isFirstLoad = false;
                _autoContributeAllDays();
            }

            // Tự động ghi 1% doanh thu hôm nay (realtime)
            _autoContributeTodayFund();

            // Cập nhật UI nếu tab settings đang mở
            _renderFundUI();
        });
    } catch (e) {
        // Firebase chưa sẵn sàng, thử lại sau
        setTimeout(_initFundRevenueListener, 1000);
    }
}

// ============================================================
// KHỞI TẠO LISTENER DOANH THU NGAY KHI LOAD (độc lập)
// ============================================================
(function _bootFundRevenue() {
    if (typeof firebase !== 'undefined' && typeof DB !== 'undefined' && DB.getShopId) {
        _initFundRevenueListener();
    } else {
        // Firebase hoặc DB chưa sẵn sàng, thử lại sau
        setTimeout(_bootFundRevenue, 1000);
    }
})();

// ============================================================
// LẮNG NGHE REALTIME: tự động ghi 1% quỹ khi doanh thu thay đổi
// Lắng nghe pos_cash_update (từ order.js, tables.js) và db_update (từ db.js)
// Độc lập hoàn toàn, không phụ thuộc employees.js
// ============================================================
(function _bootFundRealtimeListener() {
    // Debounce timer để tránh ghi Firebase quá nhiều lần
    var _fundDebounceTimer = null;

    function _onFundRevenueChange() {
        try {
            // Chỉ xử lý nếu không có ngày đang được chọn (đang xem hôm nay)
            if (typeof _selectedCloseDate !== 'undefined' && _selectedCloseDate) return;

            // Debounce: đợi 2s sau lần thay đổi cuối cùng mới ghi
            if (_fundDebounceTimer) {
                clearTimeout(_fundDebounceTimer);
            }
            _fundDebounceTimer = setTimeout(function() {
                _fundDebounceTimer = null;
                // Gọi _autoContributeTodayFund để cập nhật 1% realtime
                if (typeof _autoContributeTodayFund === 'function') {
                    _autoContributeTodayFund();
                }
                // Cập nhật UI nếu tab settings đang mở
                if (typeof _renderFundUI === 'function') {
                    _renderFundUI();
                }
            }, 2000);
        } catch (e) {}
    }

    // Lắng nghe db_update (khi có transaction mới từ Firebase)
    window.removeEventListener('db_update', _onFundRevenueChange);
    window.addEventListener('db_update', _onFundRevenueChange);

    // Lắng nghe pos_cash_update (khi thanh toán trên cùng máy)
    window.removeEventListener('pos_cash_update', _onFundRevenueChange);
    window.addEventListener('pos_cash_update', _onFundRevenueChange);
})();

// ============================================================
// LẤY DOANH THU TỪ CACHE: ưu tiên _posCashData (realtime) cho hôm nay
// ============================================================
function _getRevenueFromCache(dateKey) {
    // Ưu tiên _posCashData cho ngày hôm nay (luôn realtime từ loadPosCashData)
    var todayKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
    if (dateKey === todayKey && _posCashData && _posCashData.totalRevenue !== undefined) {
        return Math.round(_posCashData.totalRevenue);
    }
    // Fallback EMP._revenueCache (historical data từ employees.js)
    if (typeof EMP !== 'undefined' && EMP._revenueCache) {
        var empRaw = EMP._revenueCache[dateKey];
        if (empRaw !== undefined && empRaw !== null) {
            if (typeof empRaw === 'number') return Math.round(empRaw);
            if (typeof empRaw === 'object') {
                var hasDetail = (empRaw.cash !== undefined || empRaw.transfer !== undefined || empRaw.grab !== undefined);
                if (hasDetail) return Math.round((empRaw.cash || 0) + (empRaw.transfer || 0) + (empRaw.grab || 0));
                if (typeof empRaw.total === 'number') return Math.round(empRaw.total);
            }
        }
    }
    // Fallback _fundRevenueCache
    if (_fundRevenueCache) {
        var raw = _fundRevenueCache[dateKey];
        if (raw) {
            if (typeof raw === 'number') return Math.round(raw);
            if (typeof raw === 'object') {
                var hasDetail = (raw.cash !== undefined || raw.transfer !== undefined || raw.grab !== undefined);
                if (hasDetail) return Math.round((raw.cash || 0) + (raw.transfer || 0) + (raw.grab || 0));
                if (typeof raw.total === 'number') return Math.round(raw.total);
            }
        }
    }
    return 0;
}

// ============================================================
// LẤY REVENUE CACHE TỐT NHẤT: ưu tiên _posCashData cho hôm nay
// ============================================================
function _getBestRevenueCache() {
    // Tạo cache tổng hợp: ưu tiên _posCashData cho hôm nay
    var merged = {};
    // Bắt đầu từ _fundRevenueCache (historical từ Firebase daily_revenue)
    if (_fundRevenueCache && Object.keys(_fundRevenueCache).length > 0) {
        for (var k in _fundRevenueCache) {
            if (_fundRevenueCache.hasOwnProperty(k)) {
                merged[k] = _fundRevenueCache[k];
            }
        }
    }
    // Ghi đè bằng EMP._revenueCache nếu có (historical từ employees.js)
    if (typeof EMP !== 'undefined' && EMP._revenueCache) {
        for (var ek in EMP._revenueCache) {
            if (EMP._revenueCache.hasOwnProperty(ek)) {
                merged[ek] = EMP._revenueCache[ek];
            }
        }
    }
    // Ghi đè bằng _posCashData cho hôm nay (realtime)
    var todayKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
    if (_posCashData && _posCashData.totalRevenue !== undefined) {
        merged[todayKey] = _posCashData.totalRevenue;
    }
    if (Object.keys(merged).length > 0) {
        return merged;
    }
    return null;
}

function _getBestRevenue(dateKey) {
    // Ưu tiên _posCashData cho ngày hôm nay (realtime từ loadPosCashData)
    var todayKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
    if (dateKey === todayKey && _posCashData && _posCashData.totalRevenue !== undefined) {
        return Math.round(_posCashData.totalRevenue);
    }
    // Fallback EMP._revenueCache (historical data)
    if (typeof EMP !== 'undefined' && EMP._revenueCache) {
        var empRaw = EMP._revenueCache[dateKey];
        if (empRaw !== undefined && empRaw !== null) {
            if (typeof empRaw === 'number') return Math.round(empRaw);
            if (typeof empRaw === 'object') {
                var hasDetail = (empRaw.cash !== undefined || empRaw.transfer !== undefined || empRaw.grab !== undefined);
                if (hasDetail) return Math.round((empRaw.cash || 0) + (empRaw.transfer || 0) + (empRaw.grab || 0));
                if (typeof empRaw.total === 'number') return Math.round(empRaw.total);
            }
        }
    }
    // Fallback _fundRevenueCache
    if (_fundRevenueCache) {
        var raw = _fundRevenueCache[dateKey];
        if (raw) {
            if (typeof raw === 'number') return Math.round(raw);
            if (typeof raw === 'object') {
                var hasDetail = (raw.cash !== undefined || raw.transfer !== undefined || raw.grab !== undefined);
                if (hasDetail) return Math.round((raw.cash || 0) + (raw.transfer || 0) + (raw.grab || 0));
                if (typeof raw.total === 'number') return Math.round(raw.total);
            }
        }
    }
    return 0;
}

// ============================================================
// TỰ ĐỘNG GHI 1% DOANH THU HÔM NAY VÀO DAILYFUND
// ============================================================
function _isFundDayRemoved(dateKey) {
    // Kiểm tra trong history có entry daily_fund_removed cho ngày này không
    if (!_fundData || !_fundData.history) return false;
    var history = _fundData.history;
    for (var hk in history) {
        var h = history[hk];
        if (h && h.type === 'daily_fund_removed' && h.date === dateKey) {
            return true;
        }
    }
    return false;
}

function _autoContributeTodayFund() {
    try {
        var todayKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
        var todayRevenue = _getBestRevenue(todayKey);
        if (todayRevenue <= 0) return;

        // Nếu ngày hôm nay đã bị admin xóa, không tự động ghi lại
        if (_isFundDayRemoved(todayKey)) return;

        var contribution = Math.round(todayRevenue * 0.01);
        if (isNaN(contribution) || contribution <= 0) return;

        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');

        fundRef.child('dailyFund/' + todayKey).once('value').then(function(snap) {
            var existing = snap.val() || {};
            var existingRevenue = existing.revenue || 0;
            var existingContribution = existing.contribution || 0;

            // Bỏ qua nếu doanh thu không đổi
            if (existingRevenue === todayRevenue && existingContribution === contribution) {
                return;
            }

            var deficit = existing.deficitCompensation || 0;
            var balanceChange = contribution - deficit;

            var updates = {};
            updates['dailyFund/' + todayKey + '/contribution'] = contribution;
            updates['dailyFund/' + todayKey + '/revenue'] = todayRevenue;
            updates['dailyFund/' + todayKey + '/deficitCompensation'] = deficit;
            updates['dailyFund/' + todayKey + '/balanceChange'] = balanceChange;
            updates['dailyFund/' + todayKey + '/createdAt'] = existing.createdAt || Date.now();

            return fundRef.update(updates).then(function() {
                _recalculateFundBalance();
            });
        }).catch(function(err) {});
    } catch (e) {}
}

// ============================================================
// BACKFILL TẤT CẢ CÁC NGÀY TRONG CACHE
// ============================================================
function _autoContributeAllDays() {
    try {
        var bestCache = _getBestRevenueCache();
        if (!bestCache) return;

        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');

        fundRef.child('dailyFund').once('value').then(function(allSnap) {
            var existingDailyFund = allSnap.val() || {};
            var updates = {};
            var hasChanges = false;

            var cacheKeys = Object.keys(bestCache).filter(function(k) {
                return /^\d{4}-\d{2}-\d{2}$/.test(k);
            });

            for (var ki = 0; ki < cacheKeys.length; ki++) {
                var dateKey = cacheKeys[ki];
                // Bỏ qua ngày đã bị admin xóa
                if (_isFundDayRemoved(dateKey)) continue;

                var dayRevenue = _getBestRevenue(dateKey);
                if (dayRevenue <= 0) continue;

                var contribution = Math.round(dayRevenue * 0.01);
                if (isNaN(contribution) || contribution <= 0) continue;

                var existing = existingDailyFund[dateKey] || {};
                var existingRevenue = existing.revenue || 0;
                var existingContribution = existing.contribution || 0;

                if (existingRevenue === dayRevenue && existingContribution === contribution) {
                    continue;
                }

                var deficit = existing.deficitCompensation || 0;
                var balanceChange = contribution - deficit;

                updates['dailyFund/' + dateKey + '/contribution'] = contribution;
                updates['dailyFund/' + dateKey + '/revenue'] = dayRevenue;
                updates['dailyFund/' + dateKey + '/deficitCompensation'] = deficit;
                updates['dailyFund/' + dateKey + '/balanceChange'] = balanceChange;
                updates['dailyFund/' + dateKey + '/createdAt'] = existing.createdAt || Date.now();

                hasChanges = true;
            }

            if (!hasChanges) return;

            return fundRef.update(updates).then(function() {
                _recalculateFundBalance();
            });
        }).catch(function(err) {});
    } catch (e) {}
}

// ============================================================
// TÍNH LẠI BALANCE: dailyFund.balanceChange + tất cả history (trừ daily_fund)
// ============================================================
function _recalculateFundBalance() {
    try {
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');

        fundRef.once('value').then(function(snap) {
            var data = snap.val() || {};
            var dailyFund = data.dailyFund || {};
            var history = data.history || {};

            var balance = 0;

            // Cộng tất cả balanceChange từ dailyFund
            for (var dk in dailyFund) {
                var entry = dailyFund[dk];
                if (entry && entry.balanceChange) {
                    balance += entry.balanceChange;
                }
            }

            // Cộng tất cả history entries (trừ 'daily_fund' và 'daily_fund_edited' vì đã tính qua dailyFund.balanceChange)
            // Bao gồm: withdrawal (âm), refund (dương), initial_deposit (dương),
            //          deficit (âm), daily_fund_removed (âm)
            for (var hk in history) {
                var hEntry = history[hk];
                if (hEntry && hEntry.type !== 'daily_fund' && hEntry.type !== 'daily_fund_edited' && hEntry.amount) {
                    balance += hEntry.amount;
                }
            }

            return fundRef.child('balance').set(balance);
        }).catch(function(err) {});
    } catch (e) {}
}

// ============================================================
// TÍNH BALANCE REALTIME TRONG BỘ NHỚ (không cần đợi Firebase)
// ============================================================
function _calculateBalanceRealtime() {
    var balance = 0;
    var todayKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : '';

    if (_fundData) {
        var dailyFund = _fundData.dailyFund || {};
        var history = _fundData.history || {};

        // Cộng tất cả balanceChange từ dailyFund
        for (var dk in dailyFund) {
            var entry = dailyFund[dk];
            if (entry && entry.balanceChange) {
                balance += entry.balanceChange;
            }
        }

        // Cộng tất cả history entries (trừ 'daily_fund' và 'daily_fund_edited' vì đã tính qua dailyFund.balanceChange)
        for (var hk in history) {
            var hEntry = history[hk];
            if (hEntry && hEntry.type !== 'daily_fund' && hEntry.type !== 'daily_fund_edited' && hEntry.amount) {
                balance += hEntry.amount;
            }
        }

        // Điều chỉnh realtime nếu doanh thu hôm nay thay đổi
        var todayRevenue = _getBestRevenue(todayKey);
        if (todayRevenue > 0) {
            var realtimeContribution = Math.round(todayRevenue * 0.01);
            if (!isNaN(realtimeContribution) && realtimeContribution > 0) {
                var existingEntry = dailyFund[todayKey] || {};
                var existingContribution = existingEntry.contribution || 0;
                var existingDeficit = existingEntry.deficitCompensation || 0;
                var existingBalanceChange = existingEntry.balanceChange || 0;

                if (existingContribution !== realtimeContribution) {
                    var newBalanceChange = realtimeContribution - existingDeficit;
                    balance = balance - existingBalanceChange + newBalanceChange;
                }
            }
        }
    } else {
        var todayRevenue = _getBestRevenue(todayKey);
        if (todayRevenue > 0) {
            balance = Math.round(todayRevenue * 0.01);
        }
    }

    return balance;
}

// ============================================================
// XỬ LÝ QUỸ KHI CHỐT/HỦY CHỐT NGÀY
// ============================================================
function processFundForClose(closeDate, difference, action) {
    try {
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');

        if (action === 'close') {
            fundRef.once('value').then(function(snapshot) {
                var fundData = snapshot.val() || {};
                var currentBalance = fundData.balance || 0;

                // Chỉ giảm quỹ nếu âm (difference < 0)
                var balanceChange = (difference < 0) ? difference : 0;

                var now = Date.now();
                var updates = {};

                var existingDF = fundData.dailyFund && fundData.dailyFund[closeDate];
                var oldContribution = (existingDF && existingDF.contribution) ? existingDF.contribution : 0;
                var oldRevenue = (existingDF && existingDF.revenue) ? existingDF.revenue : 0;

                var dailyFundData = {
                    difference: difference,
                    balanceChange: balanceChange,
                    createdAt: now
                };
                if (oldContribution > 0) {
                    dailyFundData.contribution = oldContribution;
                    dailyFundData.revenue = oldRevenue;
                }
                updates['dailyFund/' + closeDate] = dailyFundData;

                // Nếu âm: ghi history deficit
                if (difference < 0) {
                    var deficitAmt = Math.abs(difference);
                    var histRef = fundRef.child('history').push();
                    updates['history/' + histRef.key] = {
                        type: 'deficit',
                        amount: -deficitAmt,
                        date: closeDate,
                        balanceBefore: currentBalance,
                        balanceAfter: currentBalance + balanceChange,
                        createdAt: now
                    };
                }

                // Xóa daily_fund_removed cũ (nếu có) để cho phép đóng lại sau khi hủy
                var history = fundData.history || {};
                for (var hk in history) {
                    var h = history[hk];
                    if (h && h.type === 'daily_fund_removed' && h.date === closeDate) {
                        updates['history/' + hk] = null;
                    }
                }

                return fundRef.update(updates).then(function() {
                    _recalculateFundBalance();
                });
            }).catch(function(err) {});
        } else if (action === 'unlock') {
            fundRef.child('dailyFund/' + closeDate).once('value').then(function(dfSnap) {
                var dfData = dfSnap.val();
                if (!dfData) return;

                var now = Date.now();
                var updates = {};

                // Lưu contribution/revenue vào history trước khi xóa
                var oldContribution = dfData.contribution || 0;
                var oldRevenue = dfData.revenue || 0;
                if (oldContribution > 0) {
                    var contribHistRef = fundRef.child('history').push();
                    updates['history/' + contribHistRef.key] = {
                        type: 'daily_fund',
                        amount: oldContribution,
                        contribution: oldContribution,
                        revenue: oldRevenue,
                        date: closeDate,
                        createdAt: now - 2
                    };
                }

                // Xóa dailyFund entry
                updates['dailyFund/' + closeDate] = null;

                // Ghi history refund nếu có balanceChange
                var origBalanceChange = dfData.balanceChange || 0;
                if (origBalanceChange !== 0) {
                    var refundAmount = -origBalanceChange;
                    var histRef = fundRef.child('history').push();
                    updates['history/' + histRef.key] = {
                        type: 'refund',
                        amount: refundAmount,
                        date: closeDate,
                        note: '🔓 Hủy chốt ngày ' + (typeof formatDateDisplay === 'function' ? formatDateDisplay(closeDate) : closeDate),
                        createdAt: now
                    };
                }

                // Đánh dấu ngày này đã bị hủy chốt để _autoContributeTodayFund()
                // và _autoContributeAllDays() không tự động tạo lại contribution
                var removedHistRef = fundRef.child('history').push();
                updates['history/' + removedHistRef.key] = {
                    type: 'daily_fund_removed',
                    amount: 0,
                    date: closeDate,
                    createdAt: now - 1
                };

                return fundRef.update(updates).then(function() {
                    _recalculateFundBalance();
                });
            }).catch(function(err) {});
        }
    } catch (e) {}
}

// ============================================================
// NHẬP QUỸ BAN ĐẦU (Admin)
// ============================================================
function saveFundInitial() {
    try {
        var input = document.getElementById('fundInitialInput');
        if (!input) return;

        var amount = parseInt(input.value, 10);
        if (isNaN(amount) || amount <= 0) {
            showToast('❌ Vui lòng nhập số tiền hợp lệ', 'error');
            return;
        }

        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');

        fundRef.child('balance').once('value').then(function(snapshot) {
            var currentBalance = snapshot.val() || 0;
            var newBalance = currentBalance + amount;

            var historyEntry = {
                type: 'initial_deposit',
                amount: amount,
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                note: 'Nhập quỹ ban đầu',
                createdAt: Date.now(),
                createdBy: window.currentDeviceId || 'admin'
            };

            var historyRef = fundRef.child('history').push();
            var updates = {};
            updates['history/' + historyRef.key] = historyEntry;

            return fundRef.update(updates).then(function() {
                _recalculateFundBalance();
            });
        }).then(function() {
            showToast('✅ Đã cập nhật quỹ: +' + formatMoney(amount), 'success');
            input.value = '';
        }).catch(function(err) {
            showToast('❌ Lỗi khi cập nhật quỹ', 'error');
        });
    } catch (e) {
        showToast('❌ Lỗi: ' + e.message, 'error');
    }
}

// ============================================================
// RÚT QUỸ (Staff)
// ============================================================
function staffWithdrawFund() {
    try {
        var input = document.getElementById('fundWithdrawInput');
        if (!input) return;

        var amount = parseInt(input.value, 10);
        if (isNaN(amount) || amount <= 0) {
            showToast('❌ Vui lòng nhập số tiền hợp lệ', 'error');
            return;
        }

        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');

        fundRef.child('balance').once('value').then(function(snapshot) {
            var currentBalance = snapshot.val() || 0;

            if (amount > currentBalance) {
                showToast('❌ Số dư quỹ không đủ! Hiện tại: ' + formatMoney(currentBalance), 'error');
                return;
            }

            var newBalance = currentBalance - amount;

            var historyEntry = {
                type: 'withdrawal',
                amount: -amount,
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                note: 'Rút quỹ',
                createdAt: Date.now(),
                createdBy: window.currentDeviceId || 'staff'
            };

            var historyRef = fundRef.child('history').push();
            var historyKey = historyRef.key;
            var updates = {};
            updates['history/' + historyKey] = historyEntry;

            return fundRef.update(updates).then(function() {
                _recalculateFundBalance();
                try {
                    if (typeof saveWasteExpense === 'function') {
                        saveWasteExpense('Rút quỹ thưởng trách nhiệm', amount, 'pos_cash', historyKey);
                    }
                } catch (e) {}
            });
        }).then(function() {
            showToast('✅ Đã rút quỹ: ' + formatMoney(amount), 'success');
            input.value = '';
        }).catch(function(err) {
            showToast('❌ Lỗi khi rút quỹ', 'error');
        });
    } catch (e) {
        showToast('❌ Lỗi: ' + e.message, 'error');
    }
}

// ============================================================
// RÚT QUỸ (Admin)
// ============================================================
function adminWithdrawFund() {
    try {
        var amount = prompt('Nhập số tiền cần rút khỏi quỹ:');
        if (!amount) return;

        amount = parseInt(amount, 10);
        if (isNaN(amount) || amount <= 0) {
            showToast('❌ Số tiền không hợp lệ', 'error');
            return;
        }

        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');

        fundRef.child('balance').once('value').then(function(snapshot) {
            var currentBalance = snapshot.val() || 0;

            if (amount > currentBalance) {
                showToast('❌ Số dư quỹ không đủ! Hiện tại: ' + formatMoney(currentBalance), 'error');
                return;
            }

            var newBalance = currentBalance - amount;

            try {
                if (typeof saveWasteExpense === 'function') {
                    saveWasteExpense('Rút quỹ thưởng trách nhiệm', amount, 'pos_cash');
                }
            } catch (e) {}

            var historyEntry = {
                type: 'withdrawal',
                amount: -amount,
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                note: 'Admin rút quỹ',
                createdAt: Date.now(),
                createdBy: window.currentDeviceId || 'admin'
            };

            var historyRef = fundRef.child('history').push();
            var updates = {};
            updates['history/' + historyRef.key] = historyEntry;

            return fundRef.update(updates).then(function() {
                _recalculateFundBalance();
            });
        }).then(function() {
            showToast('✅ Đã rút quỹ: ' + formatMoney(amount), 'success');
        }).catch(function(err) {
            showToast('❌ Lỗi khi rút quỹ', 'error');
        });
    } catch (e) {
        showToast('❌ Lỗi: ' + e.message, 'error');
    }
}

// ============================================================
// XÓA GIAO DỊCH RÚT QUỸ (chỉ giao dịch hôm nay)
// ============================================================
function deleteFundHistoryEntry(historyKey) {
    if (!historyKey) return;
    if (!confirm('🗑️ Xóa giao dịch rút quỹ này?\nSố tiền sẽ được hoàn lại vào quỹ.')) return;

    try {
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');

        fundRef.once('value').then(function(snapshot) {
            var fundData = snapshot.val() || {};
            var history = fundData.history || {};
            var entry = history[historyKey];

            if (!entry) {
                showToast('❌ Không tìm thấy giao dịch', 'error');
                return;
            }

            if (entry.type !== 'withdrawal') {
                showToast('❌ Chỉ có thể xóa giao dịch rút quỹ', 'error');
                return;
            }

            var todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            if (!entry.createdAt || entry.createdAt < todayStart.getTime()) {
                showToast('❌ Chỉ có thể xóa giao dịch trong hôm nay', 'error');
                return;
            }

            var currentBalance = fundData.balance || 0;
            var withdrawnAmount = Math.abs(entry.amount || 0);
            var newBalance = currentBalance + withdrawnAmount;

            var refundEntry = {
                type: 'refund',
                amount: withdrawnAmount,
                balanceBefore: currentBalance,
                balanceAfter: newBalance,
                note: 'Hoàn tiền xóa rút quỹ',
                originalHistoryKey: historyKey,
                createdAt: Date.now(),
                createdBy: window.currentDeviceId || 'admin'
            };

            var historyRef = fundRef.child('history').push();
            var updates = {};
            updates['history/' + historyRef.key] = refundEntry;
            updates['history/' + historyKey] = null;

            return fundRef.update(updates).then(function() {
                _recalculateFundBalance();
            });
        }).then(function() {
            try {
                if (typeof DB !== 'undefined' && DB.getAll) {
                    DB.getAll('cost_transactions').then(function(costs) {
                        if (!costs) return;
                        for (var ci = 0; ci < costs.length; ci++) {
                            var c = costs[ci];
                            if (c && c.fundHistoryKey === historyKey && !c.deleted) {
                                DB.update('cost_transactions', c.id, { deleted: true });
                                break;
                            }
                        }
                    });
                }
            } catch (e) {}
            showToast('✅ Đã xóa giao dịch rút quỹ và hoàn tiền', 'success');
        }).catch(function(err) {
            showToast('❌ Lỗi khi xóa giao dịch', 'error');
        });
    } catch (e) {
        showToast('❌ Lỗi: ' + e.message, 'error');
    }
}

// ============================================================
// XÓA GIAO DỊCH THƯỞNG THEO NGÀY (Admin)
// ============================================================
function deleteFundDailyEntry(dateKey) {
    if (!dateKey) return;
    if (!confirm('🗑️ Xóa giao dịch thưởng ngày ' + formatDateDisplay(dateKey) + '?\nSố tiền thưởng sẽ bị xóa khỏi quỹ.')) return;

    try {
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');

        fundRef.child('dailyFund/' + dateKey).once('value').then(function(snap) {
            var dfData = snap.val();
            if (!dfData) {
                showToast('❌ Không tìm thấy giao dịch', 'error');
                return;
            }

            var now = Date.now();
            var updates = {};

            // Lưu vào history trước khi xóa
            var contribution = dfData.contribution || 0;
            var revenue = dfData.revenue || 0;
            if (contribution > 0) {
                var histRef = fundRef.child('history').push();
                updates['history/' + histRef.key] = {
                    type: 'daily_fund_removed',
                    amount: -contribution,
                    contribution: contribution,
                    revenue: revenue,
                    date: dateKey,
                    note: '🗑️ Admin xóa thưởng ngày ' + formatDateDisplay(dateKey),
                    createdAt: now
                };
            }

            // Xóa dailyFund entry
            updates['dailyFund/' + dateKey] = null;

            return fundRef.update(updates).then(function() {
                _recalculateFundBalance();
                showToast('✅ Đã xóa giao dịch thưởng ngày ' + formatDateDisplay(dateKey), 'success');
            });
        }).catch(function(err) {
            showToast('❌ Lỗi khi xóa giao dịch', 'error');
        });
    } catch (e) {
        showToast('❌ Lỗi: ' + e.message, 'error');
    }
}

// ============================================================
// RENDER UI QUỸ CHÍNH (dạng bảng log)
// ============================================================
function _renderFundUI() {
    var balance = _calculateBalanceRealtime();
    var todayKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : '';

    // Cập nhật số dư
    var balanceDisplay = document.getElementById('fundBalanceDisplay');
    if (balanceDisplay) {
        balanceDisplay.textContent = formatMoney(balance);
        balanceDisplay.style.color = balance >= 0 ? '#fbbf24' : '#ef4444';
    }

    // Render bảng log lịch sử
    _renderFundLog();

    // Cập nhật trong cash counter
    _updateFundInCashCounter();
}

// ============================================================
// RENDER BẢNG LOG LỊCH SỬ QUỸ
// ============================================================
function _renderFundLog() {
    var container = document.getElementById('fundLogList');
    if (!container) return;

    // Xây dựng danh sách entries từ _fundData + cache
    var entries = _buildFundLogEntries();

    if (entries.length === 0) {
        container.innerHTML = '<div style="color:#64748b;font-size:12px;text-align:center;padding:20px;">📭 Chưa có dữ liệu quỹ</div>';
        return;
    }

    // Kiểm tra trạng thái mở rộng
    var isExpanded = container.getAttribute('data-expanded') === 'true';
    var maxDays = isExpanded ? entries.length : 3;
    var hasMore = entries.length > 3;

    var html = '';
    var todayKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : '';
    var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();

    for (var i = 0; i < entries.length && i < maxDays; i++) {
        var e = entries[i];
        var isToday = e.dateKey === todayKey;
        var dateLabel = e.dateKey ? formatDateDisplay(e.dateKey) : 'Không xác định';

        // Header ngày
        html += '<div class="fund-log-date">';
        html += '  <span>📅 ' + dateLabel + '</span>';
        if (isToday) {
            html += '  <span class="fund-log-today">Hôm nay</span>';
        }
        html += '</div>';

        // Các giao dịch trong ngày
        for (var j = 0; j < e.items.length; j++) {
            var item = e.items[j];
            var isPositive = item.amount >= 0;
            var sign = isPositive ? '+' : '';
            var color = isPositive ? '#22c55e' : '#ef4444';
            var icon = item.icon || '📌';
            var label = item.label || '';

            html += '<div class="fund-log-row">';
            html += '  <div class="fund-log-info">';
            html += '    <span class="fund-log-icon">' + icon + '</span>';
            html += '    <div class="fund-log-label">';
            html += '      <span>' + label + '</span>';
            if (item.detail) {
                html += '      <span class="fund-log-detail">' + item.detail + '</span>';
            }
            html += '    </div>';
            html += '  </div>';
            html += '  <div class="fund-log-amount" style="color:' + color + ';">' + sign + formatMoney(Math.abs(item.amount)) + '</div>';
            // Nút xóa/sửa cho admin (chỉ daily_fund)
            if (isAdmin && item.canDelete && item.dateKey && item.type === 'daily_fund') {
                html += '  <button class="fund-log-delete" onclick="editFundDailyEntry(\'' + item.dateKey + '\')" title="Sửa doanh thu ngày này">✏️</button>';
                html += '  <button class="fund-log-delete" onclick="deleteFundDailyEntry(\'' + item.dateKey + '\')" title="Xóa giao dịch này">🗑️</button>';
            }
            html += '</div>';
        }
    }

    // Nút mở rộng/thu gọn
    if (hasMore) {
        var btnText = isExpanded ? '📋 Thu gọn' : '📋 Xem thêm (' + (entries.length - 3) + ' ngày cũ hơn)';
        html += '<div style="text-align:center;padding:8px;">';
        html += '  <button class="settings-btn" onclick="toggleFundLogExpand()" style="font-size:12px;padding:6px 16px;">' + btnText + '</button>';
        html += '</div>';
    }

    container.innerHTML = html;
}

function toggleFundLogExpand() {
    var container = document.getElementById('fundLogList');
    if (!container) return;
    var isExpanded = container.getAttribute('data-expanded') === 'true';
    container.setAttribute('data-expanded', isExpanded ? 'false' : 'true');
    _renderFundLog();
}

// ============================================================
// XÂY DỰNG DANH SÁCH ENTRIES CHO BẢNG LOG
// ============================================================
function _buildFundLogEntries() {
    var todayKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : '';
    var entriesMap = {}; // dateKey -> { dateKey, items: [] }
    var dateOrder = [];

    function _addEntry(dateKey, item) {
        if (!entriesMap[dateKey]) {
            entriesMap[dateKey] = { dateKey: dateKey, items: [] };
            dateOrder.push(dateKey);
        }
        entriesMap[dateKey].items.push(item);
    }

    // 1. Từ dailyFund
    if (_fundData && _fundData.dailyFund) {
        var dailyFund = _fundData.dailyFund;
        for (var dk in dailyFund) {
            var df = dailyFund[dk];
            if (!df) continue;

            // Contribution (thưởng)
            var contribution = df.contribution || 0;
            if (contribution > 0) {
                var revenue = df.revenue || 0;
                _addEntry(dk, {
                    type: 'daily_fund',
                    amount: contribution,
                    label: '🏆 Thưởng trách nhiệm',
                    icon: '🏆',
                    detail: '1% của ' + formatMoney(revenue),
                    dateKey: dk,
                    canDelete: true
                });
            }

            // Deficit compensation (bù thiếu hụt)
            var deficit = df.deficitCompensation || 0;
            if (deficit > 0) {
                _addEntry(dk, {
                    type: 'deficit',
                    amount: -deficit,
                    label: '🔴 Bù thiếu hụt chốt ngày',
                    icon: '🔴',
                    detail: '',
                    dateKey: dk,
                    canDelete: false
                });
            }

            // BalanceChange âm từ processFundForClose (không có deficitCompensation riêng)
            if (df.balanceChange < 0 && !df.deficitCompensation) {
                _addEntry(dk, {
                    type: 'deficit',
                    amount: df.balanceChange,
                    label: '🔴 Bù thiếu hụt chốt ngày',
                    icon: '🔴',
                    detail: '',
                    dateKey: dk,
                    canDelete: false
                });
            }
        }
    }

    // 2. Thêm realtime contribution cho hôm nay nếu chưa có trong dailyFund
    var todayRevenue = _getBestRevenue(todayKey);
    if (todayRevenue > 0) {
        var realtimeContribution = Math.round(todayRevenue * 0.01);
        if (!isNaN(realtimeContribution) && realtimeContribution > 0) {
            var todayHasEntry = false;
            if (entriesMap[todayKey]) {
                for (var ti = 0; ti < entriesMap[todayKey].items.length; ti++) {
                    if (entriesMap[todayKey].items[ti].type === 'daily_fund') {
                        todayHasEntry = true;
                        break;
                    }
                }
            }
            if (!todayHasEntry) {
                _addEntry(todayKey, {
                    type: 'daily_fund',
                    amount: realtimeContribution,
                    label: '🏆 Thưởng trách nhiệm (realtime)',
                    icon: '🏆',
                    detail: '1% của ' + formatMoney(todayRevenue),
                    dateKey: todayKey,
                    canDelete: true
                });
            }
        }
    }

    // 3. Từ history (withdrawal, initial_deposit, deficit, refund, daily_fund_removed)
    if (_fundData && _fundData.history) {
        var history = _fundData.history;
        for (var hk in history) {
            var h = history[hk];
            if (!h) continue;

            var hDateKey = h.date || '';
            if (!hDateKey) {
                // Fallback: lấy từ createdAt
                if (h.createdAt) {
                    var d = new Date(h.createdAt);
                    hDateKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
                }
            }
            if (!hDateKey) continue;

            if (h.type === 'withdrawal') {
                var amt = h.amount || 0;
                _addEntry(hDateKey, {
                    type: 'withdrawal',
                    amount: amt,
                    label: '💸 Rút quỹ' + (h.note && h.note !== 'Rút quỹ' ? ' (' + h.note + ')' : ''),
                    icon: '💸',
                    detail: '',
                    dateKey: hDateKey,
                    canDelete: false,
                    historyKey: hk
                });
            } else if (h.type === 'initial_deposit') {
                _addEntry(hDateKey, {
                    type: 'initial_deposit',
                    amount: h.amount || 0,
                    label: '💰 ' + (h.note || 'Nhập quỹ ban đầu'),
                    icon: '💰',
                    detail: '',
                    dateKey: hDateKey,
                    canDelete: false
                });
            } else if (h.type === 'deficit') {
                _addEntry(hDateKey, {
                    type: 'deficit',
                    amount: h.amount || 0,
                    label: '🔴 Bù thiếu hụt chốt ngày',
                    icon: '🔴',
                    detail: '',
                    dateKey: hDateKey,
                    canDelete: false
                });
            } else if (h.type === 'refund') {
                _addEntry(hDateKey, {
                    type: 'refund',
                    amount: h.amount || 0,
                    label: '🔄 ' + (h.note || 'Hoàn tiền'),
                    icon: '🔄',
                    detail: '',
                    dateKey: hDateKey,
                    canDelete: false
                });
            } else if (h.type === 'daily_fund_removed') {
                _addEntry(hDateKey, {
                    type: 'daily_fund_removed',
                    amount: h.amount || 0,
                    label: '🗑️ ' + (h.note || 'Xóa thưởng'),
                    icon: '🗑️',
                    detail: '',
                    dateKey: hDateKey,
                    canDelete: false
                });
            } else if (h.type === 'daily_fund_edited') {
                // Không hiển thị entry này trong log để tránh rối UI
                // Dữ liệu đã được cập nhật trực tiếp trong dailyFund
            }
        }
    }

    // 4. Sắp xếp theo ngày giảm dần (mới nhất lên đầu)
    dateOrder.sort(function(a, b) {
        return b.localeCompare(a);
    });

    // 5. Chuyển thành mảng kết quả
    var result = [];
    for (var di = 0; di < dateOrder.length; di++) {
        result.push(entriesMap[dateOrder[di]]);
    }

    return result;
}

// ============================================================
// CẬP NHẬT THÔNG TIN QUỸ TRONG CASH COUNTER (có collapse)
// ============================================================
function _updateFundInCashCounter() {
    try {
        var fundInfoDiv = document.getElementById('fundInfoInCashCounter');
        if (!fundInfoDiv) return;

        var balance = _calculateBalanceRealtime();
        var todayKey = typeof getTodayDateKey === 'function' ? getTodayDateKey() : '';
        var todayRevenue = _getBestRevenue(todayKey);
        var todayContribution = Math.round(todayRevenue * 0.01);
        if (isNaN(todayContribution)) todayContribution = 0;

        // Kiểm tra trạng thái collapse
        var isCollapsed = fundInfoDiv.getAttribute('data-collapsed') === 'true';

        var html = '';
        // Header có collapse icon
        html += '<div style="margin-top:8px;padding:8px 12px;background:#1e293b;border-radius:8px;border:1px solid #334155;">';
        html += '  <div onclick="_toggleFundCashCounterCollapse()" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;cursor:pointer;user-select:none;">';
        html += '    <span style="font-size:12px;color:#94a3b8;">';
        html += '      <span class="collapse-icon" style="display:inline-block;transition:transform 0.2s;' + (isCollapsed ? '' : 'transform:rotate(90deg);') + '">▶</span>';
        html += '      🏆 Quỹ thưởng trách nhiệm';
        html += '    </span>';
        html += '    <span style="font-size:16px;font-weight:700;color:#fbbf24;">' + formatMoney(balance) + '</span>';
        html += '  </div>';
        // Nội dung chi tiết (ẩn/hiện theo collapse)
        if (!isCollapsed) {
            // FIX: Chỉ admin mới thấy dòng "Hôm nay +1%" - ẩn với nhân viên
            if (todayContribution > 0 && DB.isAdmin && DB.isAdmin()) {
                html += '  <div style="display:flex;justify-content:space-between;align-items:center;">';
                html += '    <span style="font-size:11px;color:#64748b;">Hôm nay +1%</span>';
                html += '    <span style="font-size:12px;color:#22c55e;">+' + formatMoney(todayContribution) + '</span>';
                html += '  </div>';
            }
        }
        html += '</div>';

        fundInfoDiv.innerHTML = html;
    } catch (e) {}
}

// ============================================================
// SỬA DOANH THU NGÀY (Admin)
// ============================================================
function editFundDailyEntry(dateKey) {
    if (!dateKey) return;
    if (!DB.isAdmin || !DB.isAdmin()) {
        showToast('❌ Chỉ admin mới có quyền sửa', 'error');
        return;
    }

    // Lấy dữ liệu hiện tại
    var currentRevenue = 0;
    var currentContribution = 0;
    if (_fundData && _fundData.dailyFund && _fundData.dailyFund[dateKey]) {
        var df = _fundData.dailyFund[dateKey];
        currentRevenue = df.revenue || 0;
        currentContribution = df.contribution || 0;
    }

    var dateLabel = typeof formatDateDisplay === 'function' ? formatDateDisplay(dateKey) : dateKey;
    var newRevenue = prompt(
        '✏️ Sửa doanh thu ngày ' + dateLabel + '\n' +
        'Doanh thu hiện tại: ' + formatMoney(currentRevenue) + '\n' +
        '1% hiện tại: ' + formatMoney(currentContribution) + '\n\n' +
        'Nhập doanh thu đúng (VNĐ):',
        currentRevenue > 0 ? String(currentRevenue) : ''
    );

    if (newRevenue === null) return; // Hủy
    newRevenue = parseInt(newRevenue.replace(/[^0-9]/g, '')) || 0;
    if (newRevenue <= 0) {
        showToast('❌ Doanh thu không hợp lệ', 'error');
        return;
    }
    if (newRevenue === currentRevenue) {
        showToast('ℹ️ Doanh thu không thay đổi', 'info');
        return;
    }

    var newContribution = Math.round(newRevenue * 0.01);
    if (isNaN(newContribution) || newContribution <= 0) {
        showToast('❌ Doanh thu quá nhỏ, không đủ 1%', 'error');
        return;
    }

    if (!confirm('📊 Xác nhận sửa doanh thu ngày ' + dateLabel + ':\n' +
        'Doanh thu: ' + formatMoney(currentRevenue) + ' → ' + formatMoney(newRevenue) + '\n' +
        '1%: ' + formatMoney(currentContribution) + ' → ' + formatMoney(newContribution) + '\n\n' +
        'Số dư quỹ sẽ được cập nhật tự động.')) return;

    try {
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = _getFundDb().ref(shopId + '/responsibility_fund');
        var now = Date.now();
        var updates = {};

        // Cập nhật dailyFund entry
        var deficit = 0;
        if (_fundData && _fundData.dailyFund && _fundData.dailyFund[dateKey]) {
            deficit = _fundData.dailyFund[dateKey].deficitCompensation || 0;
        }
        var balanceChange = newContribution - deficit;

        updates['dailyFund/' + dateKey + '/contribution'] = newContribution;
        updates['dailyFund/' + dateKey + '/revenue'] = newRevenue;
        updates['dailyFund/' + dateKey + '/balanceChange'] = balanceChange;
        updates['dailyFund/' + dateKey + '/updatedAt'] = now;

        // Xóa daily_fund_edited entry cũ (nếu có) để tránh ảnh hưởng balance
        if (_fundData && _fundData.history) {
            for (var hk in _fundData.history) {
                var hEntry = _fundData.history[hk];
                if (hEntry && hEntry.type === 'daily_fund_edited' && hEntry.dateKey === dateKey) {
                    updates['history/' + hk] = null; // Xóa entry cũ
                }
            }
        }

        // Cập nhật daily_revenue trên Firebase để đồng bộ
        try {
            var revRef = _getFundDb().ref(shopId + '/daily_revenue/' + dateKey);
            revRef.update({
                total: newRevenue,
                updatedAt: now
            }).catch(function() {});
        } catch (e) {}

        return fundRef.update(updates).then(function() {
            _recalculateFundBalance();
            showToast('✅ Đã cập nhật doanh thu ngày ' + dateLabel + ': ' + formatMoney(newRevenue) + ' (1%: ' + formatMoney(newContribution) + ')', 'success');
        }).catch(function(err) {
            showToast('❌ Lỗi khi cập nhật: ' + (err.message || ''), 'error');
        });
    } catch (e) {
        showToast('❌ Lỗi: ' + e.message, 'error');
    }
}

// ========== TOGGLE COLLAPSE CHO FUND TRONG CASH COUNTER ==========
function _toggleFundCashCounterCollapse() {
    try {
        var fundInfoDiv = document.getElementById('fundInfoInCashCounter');
        if (!fundInfoDiv) return;
        var isCollapsed = fundInfoDiv.getAttribute('data-collapsed') === 'true';
        fundInfoDiv.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
        _updateFundInCashCounter();
    } catch (e) {}
}
