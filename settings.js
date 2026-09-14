// settings.js - Cài đặt ứng dụng + Tiền mặt tại POS
// ES5, tương thích Android 6, iOS 12

// ============================================================
// LẮNG NGHE FIREBASE REALTIME: cập nhật window.shopConfig + UI tự động
// Khi admin thay đổi token Telegram / thông tin quán từ Settings,
// tất cả thiết bị đều nhận được mà không cần F5
// ============================================================
(function _initSettingsRealtime() {
    // Khởi tạo window.shopConfig nếu chưa có
    if (!window.shopConfig) {
        window.shopConfig = {};
    }

    // === Hàm cập nhật UI Telegram từ config ===
    function _updateTelegramUI(config) {
        var tokenInput = document.getElementById('telegramBotToken');
        if (tokenInput && config.telegramBotToken !== undefined) {
            tokenInput.value = config.telegramBotToken || '';
        }
        var chatIdInput = document.getElementById('telegramChatId');
        if (chatIdInput && config.telegramChatId !== undefined) {
            chatIdInput.value = config.telegramChatId || '';
        }
        var shiftCloseInput = document.getElementById('telegramShiftCloseToken');
        if (shiftCloseInput && config.telegramShiftCloseToken !== undefined) {
            shiftCloseInput.value = config.telegramShiftCloseToken || '';
        }
        var warningInput = document.getElementById('telegramWarningToken');
        if (warningInput && config.telegramWarningToken !== undefined) {
            warningInput.value = config.telegramWarningToken || '';
        }
        var expenseInput = document.getElementById('telegramExpenseToken');
        if (expenseInput && config.telegramExpenseToken !== undefined) {
            expenseInput.value = config.telegramExpenseToken || '';
        }
    }

    // === Hàm cập nhật UI Shop Info từ data ===
    function _updateShopInfoUI(data) {
        var nameEl = document.getElementById('shopInfoName');
        if (nameEl && data.name !== undefined) nameEl.value = data.name || '';
        var addressEl = document.getElementById('shopInfoAddress');
        if (addressEl && data.address !== undefined) addressEl.value = data.address || '';
        var phoneEl = document.getElementById('shopInfoPhone');
        if (phoneEl && data.phone !== undefined) phoneEl.value = data.phone || '';
        // Cập nhật lock config nếu có
        var lockStartInput = document.getElementById('settingsLockStartHour');
        if (lockStartInput && data.lockStartHour !== undefined) lockStartInput.value = data.lockStartHour !== null ? data.lockStartHour : '';
        var lockEndHourInput = document.getElementById('settingsLockEndHour');
        if (lockEndHourInput && data.lockEndHour !== undefined) lockEndHourInput.value = data.lockEndHour !== null ? data.lockEndHour : '';
        var lockEndMinInput = document.getElementById('settingsLockEndMinute');
        if (lockEndMinInput && data.lockEndMinute !== undefined) lockEndMinInput.value = data.lockEndMinute !== null ? data.lockEndMinute : '';
        var tableLockInput = document.getElementById('settingsTableLockHours');
        if (tableLockInput && data.tableLockHours !== undefined) tableLockInput.value = data.tableLockHours !== null ? data.tableLockHours : '';
    }

    // Lắng nghe sự kiện db_update từ db.js (khi Firebase thay đổi)
    window.addEventListener('db_update', function(e) {
        var detail = e.detail;
        if (!detail || !detail.data) return;

        // --- Xử lý collection 'info' (Telegram config + Lock config) ---
        if (detail.collection === 'info') {
            var infoData = detail.data;
            var config = Array.isArray(infoData) ? (infoData[0] || {}) : infoData;
            if (config.id === 'shop_config') {
                // Cập nhật window.shopConfig
                window.shopConfig.telegramBotToken = config.telegramBotToken || '';
                window.shopConfig.telegramChatId = config.telegramChatId || '';
                window.shopConfig.telegramShiftCloseToken = config.telegramShiftCloseToken || '';
                window.shopConfig.telegramWarningToken = config.telegramWarningToken || '';
                window.shopConfig.telegramExpenseToken = config.telegramExpenseToken || '';
                // Cập nhật UI Telegram nếu đang mở
                _updateTelegramUI(config);
                // Cập nhật UI lock config
                _updateShopInfoUI(config);
            }
        }

        // --- Xử lý collection 'shop_info' (Thông tin quán) ---
        if (detail.collection === 'shop_info') {
            var shopData = detail.data;
            var infoItem = Array.isArray(shopData) ? (shopData[0] || {}) : shopData;
            if (infoItem && infoItem.id === 'shop_info') {
                window.shopInfo = infoItem;
                _updateShopInfoUI(infoItem);
            }
        }
    });

    // Cũng lắng nghe trực tiếp từ Firebase (nếu firebase sẵn sàng)
    // Đảm bảo dữ liệu được cập nhật ngay cả khi db_update chưa kịp dispatch
    setTimeout(function() {
        try {
            var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : localStorage.getItem('current_shop_id');
            if (shopId && typeof firebase !== 'undefined' && firebase.database) {
                // Lắng nghe collection 'info'
                var infoRef = firebase.database().ref(shopId + '/info');
                infoRef.on('value', function(snapshot) {
                    if (!snapshot.exists()) return;
                    var src = snapshot.val() || {};
                    window.shopConfig.telegramBotToken = src.telegramBotToken || '';
                    window.shopConfig.telegramChatId = src.telegramChatId || '';
                    window.shopConfig.telegramShiftCloseToken = src.telegramShiftCloseToken || '';
                    window.shopConfig.telegramWarningToken = src.telegramWarningToken || '';
                    window.shopConfig.telegramExpenseToken = src.telegramExpenseToken || '';
                    // Cập nhật UI
                    _updateTelegramUI(src);
                    _updateShopInfoUI(src);
                });

                // Lắng nghe collection 'shop_info'
                var shopInfoRef = firebase.database().ref(shopId + '/shop_info');
                shopInfoRef.on('value', function(snapshot) {
                    if (!snapshot.exists()) return;
                    var src = snapshot.val() || {};
                    // shop_info là object, lấy item đầu tiên
                    for (var key in src) {
                        if (src.hasOwnProperty(key)) {
                            var item = src[key];
                            if (item && item.id === 'shop_info') {
                                window.shopInfo = item;
                                _updateShopInfoUI(item);
                            }
                            break;
                        }
                    }
                });
            }
        } catch (e) {
        }
    }, 3000); // Đợi 3s cho Firebase khởi tạo
})();

// ============================================================
// LẮNG NGHE GLOBAL: Cập nhật doanh thu pos-cash-info realtime
// Đăng ký ngay khi settings.js load, không phụ thuộc vào tab Settings
// ============================================================
(function _initPosCashRealtime() {
    // Hàm xử lý db_update cho pos-cash-info (doanh thu)
    function _onPosCashDbUpdate(e) {
        try {
            var detail = e.detail;
            if (!detail || !detail.collection) return;
            if (_selectedCloseDate) return;
            // Lắng nghe tất cả collection liên quan đến POS cash:
            // transactions, tables, cost_transactions, manager_cash_pickups
            if (detail.collection === 'transactions' || detail.collection === 'tables' ||
                detail.collection === 'cost_transactions' || detail.collection === 'manager_cash_pickups') {
                loadPosCashData();
            }
        } catch (e) {
        }
    }

    // Hàm xử lý pos_cash_update từ order.js và tables.js (thanh toán trên cùng máy)
    function _onPosCashLocalUpdate() {
        try {
            if (_selectedCloseDate) return;
            loadPosCashData();
        } catch (e) {
        }
    }

    // Đăng ký listener global - luôn sẵn sàng dù tab nào đang mở
    window.removeEventListener('db_update', _onPosCashDbUpdate);
    window.addEventListener('db_update', _onPosCashDbUpdate);
    window.removeEventListener('pos_cash_update', _onPosCashLocalUpdate);
    window.addEventListener('pos_cash_update', _onPosCashLocalUpdate);
})();

// ============================================================
// LẮNG NGHE REALTIME: cost_transactions + manager_cash_pickups
// Đăng ký NGAY KHI LOAD, không phụ thuộc vào tab Settings
// Đảm bảo thiết bị khác nhận được realtime khi có thay đổi
// ============================================================
(function _initGlobalRealtime() {
    // Đợi Firebase sẵn sàng rồi mới đăng ký listener
    var _waitForFirebase = setInterval(function() {
        try {
            if (typeof firebase === 'undefined' || !firebase.database) return;
            var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : null;
            if (!shopId) return;
            
            clearInterval(_waitForFirebase);
            var dbRef = firebase.database().ref(shopId);
            
            // Lắng nghe cost_transactions để cập nhật cache realtime
            dbRef.child('cost_transactions').on('child_added', function(snapshot) {
                var key = snapshot.key;
                var val = snapshot.val();
                if (val) {
                    if (!_costTxCache) _costTxCache = {};
                    val.id = key;
                    _costTxCache[key] = val;
                    _costTxCacheLoaded = true;
                    if (!_selectedCloseDate) {
                        loadPosCashData();
                    }
                }
            });
            dbRef.child('cost_transactions').on('child_changed', function(snapshot) {
                var key = snapshot.key;
                var val = snapshot.val();
                if (val) {
                    if (!_costTxCache) _costTxCache = {};
                    val.id = key;
                    _costTxCache[key] = val;
                    _costTxCacheLoaded = true;
                    if (!_selectedCloseDate) {
                        loadPosCashData();
                    }
                }
            });
            dbRef.child('cost_transactions').on('child_removed', function(snapshot) {
                var key = snapshot.key;
                if (_costTxCache && _costTxCache[key]) {
                    delete _costTxCache[key];
                    if (!_selectedCloseDate) {
                        loadPosCashData();
                    }
                }
            });
            
            // Lắng nghe manager_cash_pickups để cập nhật cache realtime
            dbRef.child('manager_cash_pickups').on('child_added', function(snapshot) {
                var key = snapshot.key;
                var val = snapshot.val();
                if (val) {
                    if (!_pickupsCache) _pickupsCache = {};
                    val.id = key;
                    _pickupsCache[key] = val;
                    _pickupsCacheLoaded = true;
                    if (!_selectedCloseDate) {
                        loadPosCashData();
                    }
                }
            });
            dbRef.child('manager_cash_pickups').on('child_changed', function(snapshot) {
                var key = snapshot.key;
                var val = snapshot.val();
                if (val) {
                    if (!_pickupsCache) _pickupsCache = {};
                    val.id = key;
                    _pickupsCache[key] = val;
                    _pickupsCacheLoaded = true;
                    if (!_selectedCloseDate) {
                        loadPosCashData();
                    }
                }
            });
            dbRef.child('manager_cash_pickups').on('child_removed', function(snapshot) {
                var key = snapshot.key;
                if (_pickupsCache && _pickupsCache[key]) {
                    delete _pickupsCache[key];
                    if (!_selectedCloseDate) {
                        loadPosCashData();
                    }
                }
            });
        } catch(e) {}
    }, 1000);
})();

// ============================================================
// 0. HÀM KIỂM TRA CHỐT NGÀY (dùng chung cho toàn bộ POS)
// ============================================================
// Kiểm tra xem hôm nay đã chốt ngày chưa
// Dùng để chặn refund/xóa món/xóa bàn sau khi chốt
var _dayClosedCache = false;

function isDayClosed() {
    return _dayClosedCache;
}

// Cập nhật cache từ dữ liệu _posCashData
function _updateDayClosedCache() {
    if (_posCashData) {
        _dayClosedCache = _posCashData.isClosed === true;
    }
}

// ============================================================
// 1. TIỀN MẶT TẠI POS (Cash Counter + Đối soát quỹ)
// ============================================================
var CASH_DENOMS = [
    { value: 1000, label: '1k' },
    { value: 2000, label: '2k' },
    { value: 5000, label: '5k' },
    { value: 10000, label: '10k' },
    { value: 20000, label: '20k' },
    { value: 50000, label: '50k' },
    { value: 100000, label: '100k' },
    { value: 200000, label: '200k' },
    { value: 500000, label: '500k' }
];
var cashCounts = {};
var _posCashData = null; // Cache dữ liệu đối soát

// === Lưu/Khôi phục số đếm tiền mặt vào localStorage (tránh mất khi chuyển tab) ===
function _getCashCountStorageKey() {
    var today = typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10);
    return 'pos_cash_counts_' + today;
}

function _saveCashCountsToLocal() {
    try {
        var key = _getCashCountStorageKey();
        var data = {};
        for (var i = 0; i < CASH_DENOMS.length; i++) {
            var v = CASH_DENOMS[i].value;
            if (cashCounts[v] > 0) {
                data[v] = cashCounts[v];
            }
        }
        localStorage.setItem(key, JSON.stringify(data));
    } catch(e) {}
}

function _loadCashCountsFromLocal() {
    try {
        var key = _getCashCountStorageKey();
        var saved = localStorage.getItem(key);
        if (saved) {
            var data = JSON.parse(saved);
            for (var i = 0; i < CASH_DENOMS.length; i++) {
                var v = CASH_DENOMS[i].value;
                if (data[v] !== undefined) {
                    cashCounts[v] = data[v];
                }
            }
        }
    } catch(e) {}
}

// Gọi khôi phục ngay khi load
_loadCashCountsFromLocal();
var _selectedCloseDate = null; // Ngày đang chọn để chốt (null = hôm nay)

// Hàm lấy ngày hôm nay theo giờ Việt Nam (UTC+7), trả về định dạng YYYY-MM-DD
// Tránh lỗi timezone khi dùng new Date().toISOString()
function getTodayDateKey() {
    var now = new Date();
    // Chuyển sang giờ Việt Nam (UTC+7)
    var vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return vnTime.toISOString().slice(0, 10);
}

function initQuickCashCounter() {
    var today = getTodayDateKey();

    // TỐI ƯU: Nếu đã có dữ liệu cho ngày hôm nay trong cache, chỉ cần render lại UI
    // Không cần gọi loadPosCashData() (6 requests Firebase/IndexedDB) và _subscribeDayClosedRealtime() (7 listeners)
    // Logic realtime vẫn hoạt động: child_* events, db_update, pos_cash_update vẫn gọi loadPosCashData() bình thường
    if (_posCashData && _posCashData.dateKey === today) {
        renderCashCounter();
        return;
    }

    cashCounts = {};
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        cashCounts[CASH_DENOMS[i].value] = 0;
    }
    // Khôi phục số đếm đã lưu trong localStorage (nếu có)
    _loadCashCountsFromLocal();
    _posCashData = null;
    _selectedCloseDate = null;
    loadPosCashData();

    // Subscribe realtime vào daily_balances hôm nay để cập nhật _dayClosedCache
    // Khi admin hủy chốt từ thiết bị khác, nhân viên sẽ thấy ngay
    _subscribeDayClosedRealtime();

    // Tự động fix dữ liệu cũ: các ngày đã chốt nhưng thiếu cashKept
    // Chỉ chạy 1 lần khi khởi tạo, không block UI
    setTimeout(function() {
        fixMissingCashKept();
    }, 2000);
}

// Lắng nghe realtime thay đổi daily_balances (chốt ngày, chênh lệch, hủy chốt...)
// Biến cache cho cost_transactions và manager_cash_pickups
// Giúp loadPosCashData không cần tải lại toàn bộ từ Firebase mỗi lần
var _costTxCache = null; // { id: item, ... }
var _pickupsCache = null; // { id: item, ... }
var _costTxCacheLoaded = false;
var _pickupsCacheLoaded = false;

function _subscribeDayClosedRealtime() {
    try {
        var today = getTodayDateKey();
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var dbRef = firebase.database().ref(shopId);

        // Lắng nghe thay đổi trên daily_balances hôm nay
        // Khi nhân viên A chốt ngày (ghi difference + isClosed lên Firebase),
        // nhân viên B và admin sẽ nhận được cập nhật realtime và reload UI
        // LƯU Ý: cost_transactions và manager_cash_pickups đã được lắng nghe
        // bởi _initGlobalRealtime() ngay khi settings.js load (xem phần đầu file)
        dbRef.child('daily_balances/' + today).on('value', function(snapshot) {
            var data = snapshot.val();
            if (data) {
                var newIsClosed = data.isClosed === true;
                // Luôn cập nhật cache isClosed
                _dayClosedCache = newIsClosed;
                // Chỉ reload nếu không đang xem ngày khác (không có _selectedCloseDate)
                // Tránh reset về ngày hôm nay khi đang xem ngày trước đó
                if (!_selectedCloseDate) {
                    loadPosCashData();
                }
            }
        });
    } catch (e) {
    }
}

function loadPosCashData(targetDate) {
    try {
    // FIX: Dùng hàm getTodayDateKey() để lấy ngày theo giờ Việt Nam (UTC+7), tránh lỗi timezone
    var today = targetDate || getTodayDateKey();
    var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();

    // Lấy ngày hôm trước để tính số dư đầu kỳ
    // FIX: Dùng Date.UTC để tránh lỗi timezone (toISOString trả về UTC, trong khi setDate tính theo local time)
    var prevDate = new Date(Date.UTC(
        parseInt(today.split('-')[0], 10),
        parseInt(today.split('-')[1], 10) - 1,
        parseInt(today.split('-')[2], 10)
    ));
    prevDate.setDate(prevDate.getDate() - 1);
    var prevDateStr = prevDate.toISOString().slice(0, 10);


    // Lấy shopId từ DB
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var dbRef = firebase.database().ref(shopId);

    // Đọc trực tiếp từ Firebase Realtime Database vì cost_transactions, daily_balances, manager_cash_pickups
    // KHÔNG được subscribe (đồng bộ) xuống IndexedDB local (xem db.js initDatabase)
    // TỐI ƯU: Dùng cache (_costTxCache, _pickupsCache) đã được cập nhật realtime qua child_* events
    // Chỉ tải từ Firebase nếu cache chưa có dữ liệu (lần đầu hoặc chưa có listener)
    var costTxPromise;
    if (_costTxCacheLoaded && _costTxCache) {
        costTxPromise = Promise.resolve(_costTxCache);
    } else {
        costTxPromise = dbRef.child('cost_transactions').once('value').then(function(snapshot) {
            var data = snapshot.val() || {};
            _costTxCache = {};
            for (var k in data) {
                if (data.hasOwnProperty(k)) {
                    var item = data[k];
                    item.id = k;
                    _costTxCache[k] = item;
                }
            }
            _costTxCacheLoaded = true;
            return _costTxCache;
        });
    }

    var pickupsPromise;
    if (_pickupsCacheLoaded && _pickupsCache) {
        pickupsPromise = Promise.resolve(_pickupsCache);
    } else {
        pickupsPromise = dbRef.child('manager_cash_pickups').once('value').then(function(snapshot) {
            var data = snapshot.val() || {};
            _pickupsCache = {};
            for (var k in data) {
                if (data.hasOwnProperty(k)) {
                    var item = data[k];
                    item.id = k;
                    _pickupsCache[k] = item;
                }
            }
            _pickupsCacheLoaded = true;
            return _pickupsCache;
        });
    }

    Promise.all([
        // Số dư đầu kỳ = cashKept của ngày hôm trước
        dbRef.child('daily_balances/' + prevDateStr).once('value'),
        // Doanh thu tiền mặt trong ngày (từ IndexedDB - transactions đã được subscribe)
        DB.getTransactionsByDate(today),
        // Chi phí từ Két POS - dùng cache nếu có, chỉ tải từ Firebase nếu chưa có
        costTxPromise,
        // Tiền quản lý nhận - dùng cache nếu có, chỉ tải từ Firebase nếu chưa có
        pickupsPromise,
        // daily_balances của ngày target (đã lưu) - đọc trực tiếp từ Firebase
        dbRef.child('daily_balances/' + today).once('value'),
        // Bàn đang hoạt động
        DB.getAll('tables')
    ]).then(function(results) {
        var prevBalance = results[0].val() || {};
        var transactions = results[1] || [];
        var allCostsCache = results[2] || {}; // Đã là object {id: item}
        var pickupsCache = results[3] || {};  // Đã là object {id: item}
        var savedBalance = results[4].val() || {};
        var allTables = results[5] || [];

        // Chuyển đổi cache object thành array
        var allCosts = [];
        for (var key in allCostsCache) {
            if (allCostsCache.hasOwnProperty(key)) {
                var item = allCostsCache[key];
                allCosts.push(item);
            }
        }

        var pickups = [];
        for (var key2 in pickupsCache) {
            if (pickupsCache.hasOwnProperty(key2)) {
                var item2 = pickupsCache[key2];
                pickups.push(item2);
            }
        }

        // Lọc transactions không bị refund
        if (Array.isArray(transactions)) {
            transactions = transactions.filter(function(t) { return !t.refunded; });
        } else {
            transactions = [];
        }


        // Số dư đầu kỳ
        var openingBalance = (prevBalance && prevBalance.cashKept) || 0;
        // Thống kê doanh thu theo phương thức thanh toán
        var totalRevenue = 0;
        var totalCount = 0;
        var cashCount = 0, cashRevenue = 0;
        var transferCount = 0, transferAmount = 0;
        var grabCount = 0, grabAmount = 0;
        var debtCount = 0, debtAmount = 0;
        var debtPaymentCount = 0, debtPaymentAmount = 0; // Khách trả nợ bằng tiền mặt/chuyển khoản
        var prepaidCount = 0, prepaidAmount = 0; // Khách đưa trước bằng tiền mặt/chuyển khoản
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            var amt = tx.amount || 0;
            if (tx.paymentMethod === 'debt') {
                debtCount++;
                debtAmount += amt;
            } else if (tx.paymentMethod === 'cash' || tx.paymentMethod === 'transfer' || tx.paymentMethod === 'grab') {
                // Tất cả giao dịch cash/transfer/grab đều tính vào tổng doanh thu (kể cả trả nợ, prepaid)
                totalCount++;
                totalRevenue += amt;
                // Thống kê riêng theo loại giao dịch
                if (tx.type === 'debt_payment') {
                    debtPaymentCount++;
                    debtPaymentAmount += amt;
                } else if (tx.type === 'prepaid') {
                    prepaidCount++;
                    prepaidAmount += amt;
                }
                if (tx.paymentMethod === 'cash') {
                    cashCount++;
                    cashRevenue += amt;
                } else if (tx.paymentMethod === 'transfer') {
                    transferCount++;
                    transferAmount += amt;
                } else if (tx.paymentMethod === 'grab') {
                    grabCount++;
                    grabAmount += amt;
                }
            }
            // Các phương thức thanh toán không xác định khác: bỏ qua, không tính vào tổng doanh thu
        }

        // Chi phí từ Két POS
        var posCashExpense = 0;
        var posCostCount = 0;
        for (var j = 0; j < allCosts.length; j++) {
            var c = allCosts[j];
            if (c.dateKey === today && !c.deleted && c.fundSource === 'pos_cash') {
                posCashExpense += c.amount;
                posCostCount++;
            }
        }

        // Tiền quản lý nhận + lịch sử
        var managerPickupTotal = 0;
        var pickupHistory = [];
        for (var k = 0; k < pickups.length; k++) {
            if (pickups[k].dateKey === today) {
                managerPickupTotal += pickups[k].amount;
                pickupHistory.push(pickups[k]);
            }
        }
        // Sắp xếp lịch sử theo thời gian tăng dần
        pickupHistory.sort(function(a, b) {
            return (a.createdAt || 0) - (b.createdAt || 0);
        });

        // expectedClosing = số tiền dự kiến phải có trong két SAU KHI trừ QL nhận
        // Nếu đã lưu đối soát trước đó thì ưu tiên dùng expectedClosing đã lưu (tránh sai lệch khi F5)
        var expectedClosing;
        if (savedBalance && savedBalance.expectedClosing !== undefined && savedBalance.expectedClosing !== null) {
            expectedClosing = savedBalance.expectedClosing;
        } else {
            expectedClosing = openingBalance + cashRevenue - posCashExpense - managerPickupTotal;
        }


        // Bàn đang hoạt động
        var activeTables = allTables.filter(function(t) { return (t.items && t.items.length) || t.total > 0; });
        var activeTableTotal = 0;
        for (var ti = 0; ti < activeTables.length; ti++) {
            activeTableTotal += activeTables[ti].total || 0;
        }

        _posCashData = {
            openingBalance: openingBalance,
            cashRevenue: cashRevenue,
            posCashExpense: posCashExpense,
            posCostCount: posCostCount,
            managerPickupTotal: managerPickupTotal,
            pickupHistory: pickupHistory,
            expectedClosing: expectedClosing,
            actualClosing: (savedBalance.actualClosing !== undefined && savedBalance.actualClosing !== null) ? savedBalance.actualClosing : null,
            isClosed: savedBalance.isClosed || false,
            cashKept: (savedBalance.cashKept !== undefined && savedBalance.cashKept !== null) ? savedBalance.cashKept : null,
            difference: (savedBalance.difference !== undefined && savedBalance.difference !== null) ? savedBalance.difference : null,
            diffPercent: (savedBalance.diffPercent !== undefined && savedBalance.diffPercent !== null) ? savedBalance.diffPercent : null,
            status: savedBalance.status || null,
            closedAtTime: savedBalance.closedAtTime || null,
            // Thống kê doanh thu theo phương thức
            totalRevenue: totalRevenue,
            totalCount: totalCount,
            cashCount: cashCount,
            transferCount: transferCount,
            transferAmount: transferAmount,
            grabCount: grabCount,
            grabAmount: grabAmount,
            debtCount: debtCount,
            debtAmount: debtAmount,
            debtPaymentCount: debtPaymentCount,
            debtPaymentAmount: debtPaymentAmount,
            prepaidCount: prepaidCount,
            prepaidAmount: prepaidAmount,
            // Bàn đang hoạt động
            activeTables: activeTables,
            activeTableTotal: activeTableTotal,
            dateKey: today
        };

        // Cập nhật cache isDayClosed để các module khác (refund, xóa món, xóa bàn) kiểm tra
        // CHỈ cập nhật cache nếu đang xem ngày hôm nay (không phải ngày trước đó)
        if (!targetDate) {
            _updateDayClosedCache();
        }

        renderCashCounter(isAdmin);
    }).catch(function(err) {
        renderCashCounter(isAdmin);
    });
    } catch(e) {
        renderCashCounter(isAdmin);
    }
}

function renderCashCounter(isAdmin) {
    var container = document.getElementById('quickCashContainer');
    if (!container) return;
    if (isAdmin === undefined) {
        isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
    }

    // Tính tổng tiền đếm được
    var countedTotal = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        countedTotal += CASH_DENOMS[i].value * (cashCounts[CASH_DENOMS[i].value] || 0);
    }

    var data = _posCashData || {
        openingBalance: 0, cashRevenue: 0, posCashExpense: 0, posCostCount: 0,
        managerPickupTotal: 0, pickupHistory: [], expectedClosing: 0, actualClosing: null,
        isClosed: false, cashKept: null, difference: null, diffPercent: null, status: null,
        totalRevenue: 0, totalCount: 0, cashCount: 0,
        transferCount: 0, transferAmount: 0,
        grabCount: 0, grabAmount: 0,
        debtCount: 0, debtAmount: 0,
        activeTables: [], activeTableTotal: 0
    };

    // expectedClosing đã trừ QL nhận, nên chênh lệch = đếm được - dự kiến còn
    var liveDiff = countedTotal - data.expectedClosing;
    var liveDiffClass = liveDiff >= 0 ? 'pos-cash-positive' : 'pos-cash-negative';

    // Số tiền tại POS hiện tại = expectedClosing (đã trừ QL nhận)
    // Khi đã đếm: lấy countedTotal
    var currentPosCash = data.expectedClosing;
    var actualPosCash = countedTotal > 0 ? countedTotal : currentPosCash;
    if (actualPosCash < 0) actualPosCash = 0;

    var html = '';
    html += '<div class="cash-counter">';

    // ===== HEADER =====
    var displayDate = data.dateKey || getTodayDateKey();
    var todayStr = getTodayDateKey();
    var isToday = (displayDate === todayStr);
    var minDate = '2020-01-01';
    html += '  <div class="cash-counter-header">';
    html += '    <span class="cash-counter-title">💰 Tiền mặt tại POS</span>';
    if (data.isClosed) {
        html += '    <span class="cash-closed-badge">🔒 Đã chốt</span>';
    }
    if (!isToday && !data.isClosed) {
        html += '    <span style="font-size:11px;color:#e67e22;background:#fef3e2;padding:2px 6px;border-radius:4px;margin-left:6px;">⚠️ Chưa chốt</span>';
    }
    if (!isToday) {
        html += '    <button class="cash-action-btn" style="padding:4px 8px;font-size:11px;margin-left:auto;" onclick="selectCloseDate(\'' + todayStr + '\')">📅 Hôm nay</button>';
    }
    html += '  </div>';
    // Date selector: ◀ Ngày ▶ + click vào ngày để mở date picker
    html += '  <div class="pos-cash-date-selector" style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:#f8f9fa;border-radius:8px;margin-bottom:8px;">';
    html += '    <button class="cash-action-btn" style="padding:6px 10px;font-size:14px;line-height:1;" onclick="changeCloseDate(-1)" ' + (displayDate <= minDate ? 'disabled' : '') + '>◀</button>';
    html += '    <span style="flex:1;text-align:center;font-size:14px;font-weight:600;color:#2c3e50;cursor:pointer;" onclick="document.getElementById(\'posCashDatePicker\').showPicker()">' + formatDateDisplay(displayDate) + '</span>';
    html += '    <input type="date" id="posCashDatePicker" value="' + displayDate + '" min="' + minDate + '" max="' + todayStr + '" style="width:0;height:0;padding:0;border:none;opacity:0;position:absolute;" onchange="jumpToDate(this.value)">';
    html += '    <button class="cash-action-btn" style="padding:6px 10px;font-size:14px;line-height:1;" onclick="changeCloseDate(1)" ' + (isToday ? 'disabled' : '') + '>▶</button>';
    html += '  </div>';

    // ===== THÔNG TIN ĐỐI SOÁT (chỉ Quản lý mới thấy) =====
    if (isAdmin) {
        html += '  <div class="pos-cash-info">';

        // Layout 2 cột flex - dùng flex:1 1 0 để 2 cột luôn bằng nhau, dàn đều 2 bên
        html += '    <div style="display:flex;gap:12px;flex-wrap:wrap;">';

        // ===== CỘT 1: DOANH THU =====
        html += '      <div style="flex:1 1 0;min-width:180px;">';
        html += '        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px;">📈 Doanh thu</div>';
        html += '        <div class="pos-cash-row" style="border-bottom:1px dashed #e2e8f0;padding-bottom:4px;margin-bottom:4px;"><span style="font-weight:600;">📊 Tổng doanh thu</span><span style="font-weight:600;">' + data.totalCount + ' đơn - ' + formatMoney(data.totalRevenue) + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'cash\')" title="Xem danh sách giao dịch tiền mặt"><span>💵 Tiền mặt</span><span>' + data.cashCount + ' đơn - ' + formatMoney(data.cashRevenue) + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'transfer\')" title="Xem danh sách giao dịch chuyển khoản"><span>💳 Chuyển khoản</span><span>' + data.transferCount + ' đơn - ' + formatMoney(data.transferAmount) + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'grab\')" title="Xem danh sách giao dịch Grab"><span>🛵 Grab</span><span>' + data.grabCount + ' đơn - ' + formatMoney(data.grabAmount) + '</span></div>';
        // Divider: phân cách doanh thu bán hàng và các khoản khác
        html += '        <div style="border-top:1px dashed #cbd5e1;margin:4px 0;"></div>';
        if (data.debtPaymentCount > 0) {
            html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'debt_payment\')" title="Xem danh sách khách trả nợ"><span>💳 Khách trả nợ</span><span>' + data.debtPaymentCount + ' đơn - ' + formatMoney(data.debtPaymentAmount) + '</span></div>';
        }
        if (data.prepaidCount > 0) {
            html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'prepaid\')" title="Xem danh sách khách đưa trước"><span>💰 Khách đưa trước</span><span>' + data.prepaidCount + ' đơn - ' + formatMoney(data.prepaidAmount) + '</span></div>';
        }
        if (data.debtCount > 0) {
            html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'debt\')" title="Xem danh sách giao dịch nợ"><span>📝 Nợ trong ngày</span><span>' + data.debtCount + ' đơn - ' + formatMoney(data.debtAmount) + '</span></div>';
        }
        html += '      </div>';

        // ===== CỘT 2: THÔNG TIN =====
        html += '      <div style="flex:1 1 0;min-width:180px;">';
        html += '        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px;">📋 Thông tin</div>';
html += '        <div class="pos-cash-row" style="cursor:pointer;" onclick="showActiveTablesModal()"><span>🪑 Bàn đang hoạt động</span><span style="color:#ca8a04;font-weight:600;">' + (data.activeTables ? data.activeTables.length : 0) + ' bàn - ' + formatMoney(data.activeTableTotal) + '</span></div>';
        html += '        <div class="pos-cash-row"><span>📂 Số dư đầu kỳ</span><span>' + formatMoney(data.openingBalance) + '</span></div>';
        html += '        <div class="pos-cash-row" style="cursor:pointer;" onclick="showPosCostTransactions()" title="Xem danh sách chi phí Két POS"><span>🏦 Chi phí Két POS</span><span>' + data.posCostCount + ' khoản - ' + formatMoney(data.posCashExpense) + '</span></div>';
        html += '        <div class="pos-cash-row"><span>💰 QL nhận</span><span>' + formatMoney(data.managerPickupTotal) + '</span></div>';
        html += '        <div class="pos-cash-row pos-cash-formula" style="border-top:1px dashed #e2e8f0;padding-top:4px;margin-top:4px;">';
        html += '          <span>📐 Dự kiến còn:</span>';
        html += '          <span class="pos-cash-expected" id="posCashExpected">' + formatMoney(data.expectedClosing) + '</span>';
        html += '        </div>';
        var adminPosCashDisplay = countedTotal > 0 ? countedTotal : data.expectedClosing;
        html += '        <div class="pos-cash-row">';
        html += '          <span>💵 Số tiền tại POS hiện tại:</span>';
        html += '          <span class="' + (adminPosCashDisplay >= 0 ? 'pos-cash-positive' : 'pos-cash-negative') + '" id="adminPosCashValue">' + formatMoney(adminPosCashDisplay) + '</span>';
        html += '        </div>';
        var displayDiff = data.difference !== null && data.difference !== undefined ? data.difference : liveDiff;
        var diffSuffix = data.isClosed ? ' (đã chốt)' : '';
        var diffPercent = 0;
        var baseForPercent = data.expectedClosing || data.openingBalance || 1;
        if (baseForPercent > 0) {
            diffPercent = Math.round(displayDiff / baseForPercent * 10000) / 100;
        }
        var isWithinLimit = Math.abs(diffPercent) <= 1;
        var displayDiffClass = displayDiff < 0 ? 'pos-cash-negative' : (displayDiff > 0 ? 'pos-cash-warning' : 'pos-cash-positive');
        html += '        <div class="pos-cash-row pos-cash-diff" id="posCashDiffRow" style="border-top:1px dashed #e2e8f0;padding-top:4px;margin-top:4px;">';
        html += '          <span>📋 Chênh lệch:</span>';
        html += '          <span class="' + displayDiffClass + '" id="posCashDiffValue">' + (displayDiff >= 0 ? '+' : '') + formatMoney(displayDiff) + ' (' + (displayDiff >= 0 ? '+' : '') + diffPercent + '%)' + diffSuffix + '</span>';
        if (!isWithinLimit && displayDiff > 0) {
            html += '          <span class="pos-cash-warning" style="margin-left:8px;font-size:11px;">⚠️ Dư >1% - Kiểm tra lại!</span>';
        } else if (!isWithinLimit && displayDiff < 0) {
            html += '          <span class="pos-cash-negative" style="margin-left:8px;font-size:11px;">🔴 Thiếu >1% - Cần rà soát!</span>';
        }
        html += '        </div>';
        html += '      </div>';

        html += '    </div>'; // end flex row

        // ===== PHẦN CHỐT CA (full width, chỉ hiển thị khi đã chốt) =====
        if (data.isClosed) {
            html += '    <div style="margin-top:8px;border-top:2px solid #2ecc71;padding-top:8px;">';
            var closedCashDisplay = (data.cashKept !== null && data.cashKept !== undefined) ? data.cashKept : data.expectedClosing;
            html += '    <div class="pos-cash-row">';
            html += '      <span style="font-weight:700;color:#27ae60;">💰 Số tiền quỹ POS thực tế sau chốt:</span>';
            html += '      <span style="font-weight:700;color:#27ae60;font-size:16px;">' + formatMoney(closedCashDisplay) + '</span>';
            html += '    </div>';
            if (data.closedAtTime) {
                html += '    <div class="pos-cash-row">';
                html += '      <span>🕐 Chốt lúc:</span>';
                html += '      <span style="font-weight:600;color:#2c3e50;">' + data.closedAtTime + '</span>';
                html += '    </div>';
            }
            html += '    </div>';
        }

        html += '  </div>';
    }

    // ===== HIỂN THỊ THÔNG TIN CHO NHÂN VIÊN =====
    if (!isAdmin) {
        html += '  <div class="pos-cash-staff-result">';

        // Layout 2 cột ngang
        html += '    <div style="display:flex;gap:12px;flex-wrap:wrap;">';

        // ===== CỘT 1: DOANH THU =====
        html += '      <div style="flex:1;min-width:180px;">';
        html += '        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px;">📈 Doanh thu</div>';
        html += '        <div class="pos-cash-row" style="border-bottom:1px dashed #e2e8f0;padding-bottom:4px;margin-bottom:4px;"><span style="font-weight:600;">📊 Tổng doanh thu</span><span style="font-weight:600;">' + data.totalCount + ' đơn' + (data.isClosed ? ' - ' + formatMoney(data.totalRevenue) : '') + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'cash\')" title="Xem danh sách giao dịch tiền mặt"><span>💵 Tiền mặt</span><span>' + data.cashCount + ' đơn' + (data.isClosed ? ' - ' + formatMoney(data.cashRevenue) : '') + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'transfer\')" title="Xem danh sách giao dịch chuyển khoản"><span>💳 Chuyển khoản</span><span>' + data.transferCount + ' đơn' + (data.isClosed ? ' - ' + formatMoney(data.transferAmount) : '') + '</span></div>';
        html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'grab\')" title="Xem danh sách giao dịch Grab"><span>🛵 Grab</span><span>' + data.grabCount + ' đơn' + (data.isClosed ? ' - ' + formatMoney(data.grabAmount) : '') + '</span></div>';
        // Divider: phân cách doanh thu bán hàng và các khoản khác
        html += '        <div style="border-top:1px dashed #cbd5e1;margin:4px 0;"></div>';
        if (data.debtPaymentCount > 0) {
            html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'debt_payment\')" title="Xem danh sách khách trả nợ"><span>💳 Khách trả nợ</span><span>' + data.debtPaymentCount + ' đơn - ' + formatMoney(data.debtPaymentAmount) + '</span></div>';
        }
        if (data.prepaidCount > 0) {
            html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'prepaid\')" title="Xem danh sách khách đưa trước"><span>💰 Khách đưa trước</span><span>' + data.prepaidCount + ' đơn - ' + formatMoney(data.prepaidAmount) + '</span></div>';
        }
        if (data.debtCount > 0) {
            html += '        <div class="pos-cash-row" style="padding-left:8px;cursor:pointer;" onclick="showPaymentMethodTransactions(\'debt\')" title="Xem danh sách giao dịch nợ"><span>📝 Nợ trong ngày</span><span>' + data.debtCount + ' đơn - ' + formatMoney(data.debtAmount) + '</span></div>';
        }
        html += '      </div>';

        // ===== CỘT 2: THÔNG TIN KHÁC =====
        html += '      <div style="flex:1;min-width:180px;">';
        html += '        <div style="font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;margin-bottom:4px;">📋 Thông tin</div>';
        html += '        <div class="pos-cash-row" style="cursor:pointer;" onclick="showActiveTablesModal()"><span>🪑 Bàn đang hoạt động</span><span>' + (data.activeTables ? data.activeTables.length : 0) + ' bàn - ' + formatMoney(data.activeTableTotal) + '</span></div>';
        html += '        <div class="pos-cash-row"><span>📂 Số dư đầu kỳ</span><span>' + formatMoney(data.openingBalance) + '</span></div>';
        html += '        <div class="pos-cash-row" style="cursor:pointer;" onclick="showPosCostTransactions()" title="Xem danh sách chi phí Két POS"><span>🏦 Chi phí Két POS</span><span>' + data.posCostCount + ' khoản - ' + formatMoney(data.posCashExpense) + '</span></div>';
        html += '        <div class="pos-cash-row"><span>💰 QL nhận</span><span>' + formatMoney(data.managerPickupTotal) + '</span></div>';

        // 💵 Tổng số tiền đếm được - hiển thị khi nhân viên đã nhập mệnh giá (countedTotal > 0)
        // Khi chưa nhập mệnh giá: ẩn hoàn toàn, không hiển thị số dự kiến
        if (countedTotal > 0) {
            html += '        <div class="pos-cash-row" style="border-top:1px dashed #e2e8f0;padding-top:4px;margin-top:4px;">';
            html += '          <span>🔢 Tổng số tiền đếm được:</span>';
            html += '          <span class="pos-cash-positive" style="font-weight:700;font-size:15px;" id="staffPosCashValue">' + formatMoney(countedTotal) + '</span>';
            html += '        </div>';
        }
        html += '      </div>';

        html += '    </div>'; // end flex row

        // Chỉ hiển thị dự kiến còn, chênh lệch SAU KHI đã chốt ngày
        if (data.isClosed) {
            html += '    <div style="margin-top:8px;border-top:1px solid #e2e8f0;padding-top:8px;">';
            // 💵 Doanh thu tiền mặt
            html += '    <div class="pos-cash-row"><span>💵 Doanh thu tiền mặt</span><span>' + formatMoney(data.cashRevenue) + '</span></div>';

            // 💵 Số tiền tại POS hiện tại
            var staffPosDisplay = countedTotal > 0 ? countedTotal : data.expectedClosing;
            html += '    <div class="pos-cash-row">';
            html += '      <span>💵 Số tiền tại POS hiện tại:</span>';
            html += '      <span class="' + (staffPosDisplay >= 0 ? 'pos-cash-positive' : 'pos-cash-negative') + '" id="adminPosCashValue">' + formatMoney(staffPosDisplay) + '</span>';
            html += '    </div>';

            // 📐 Dự kiến còn
            var expectedClosing = (data.openingBalance || 0) + (data.cashRevenue || 0) - (data.posCashExpense || 0) - (data.managerPickupTotal || 0);
            html += '    <div class="pos-cash-row" style="border-top:1px dashed #ddd;padding-top:6px;">';
            html += '      <span>📐 Dự kiến còn:</span>';
            html += '      <span style="font-weight:600;color:#2c3e50;" id="staffExpectedClosing">' + formatMoney(expectedClosing) + '</span>';
            html += '    </div>';

            // 📊 Chênh lệch - dùng data.difference từ Firebase (do nhân viên A đã chốt ghi lên)
            var savedDiff = (data.difference !== null && data.difference !== undefined) ? data.difference : null;
            if (savedDiff !== null) {
                var baseForPct = expectedClosing || data.openingBalance || 1;
                var diffPct = Math.round(savedDiff / baseForPct * 10000) / 100;
                var isWithinLimit = Math.abs(diffPct) <= 1;

                if (savedDiff > 0) {
                    html += '    <div class="pos-cash-row pos-cash-diff" id="staffDiffRow">';
                    html += '      <span>📊 Chênh lệch thực tế:</span>';
                    html += '      <span class="pos-cash-warning" id="staffDiffValue">+' + formatMoney(savedDiff) + ' (+' + diffPct + '%) (đã chốt)</span>';
                    html += '    </div>';
                    if (!isWithinLimit) {
                        html += '    <div class="pos-cash-row" style="margin-top:4px;">';
                        html += '      <span style="color:#e67e22;font-size:12px;">⚠️ Nhập máy thiếu so với tiền mặt tại POS - Yêu cầu nhập đầy đủ lần sau.</span>';
                        html += '    </div>';
                    }
                } else if (savedDiff < 0) {
                    html += '    <div class="pos-cash-row pos-cash-diff" id="staffDiffRow">';
                    html += '      <span>📊 Chênh lệch thực tế:</span>';
                    html += '      <span class="pos-cash-negative" id="staffDiffValue">' + formatMoney(savedDiff) + ' (' + diffPct + '%) (đã chốt)</span>';
                    html += '    </div>';
                    if (!isWithinLimit) {
                        html += '    <div class="pos-cash-row" style="margin-top:4px;">';
                        html += '      <span style="color:#e74c3c;font-size:12px;">🔴 Số tiền bị thiếu so với nhập máy. Thực tế so với máy chênh lệch ' + formatMoney(Math.abs(savedDiff)) + ' - Yêu cầu rà soát lại giao dịch, gửi thông báo tới quản lý.</span>';
                        html += '    </div>';
                    }
                } else {
                    html += '    <div class="pos-cash-row pos-cash-diff" id="staffDiffRow">';
                    html += '      <span>📊 Chênh lệch thực tế:</span>';
                    html += '      <span class="pos-cash-positive" id="staffDiffValue">' + formatMoney(savedDiff) + ' (0%) (đã chốt)</span>';
                    html += '    </div>';
                }
            }
            html += '    </div>'; // end closed section
        }

        html += '  </div>';
    }

    // ===== BẢNG ĐẾM TIỀN =====
    html += '  <div class="pos-cash-section-title">🔢 Kiểm tiền mặt</div>';
    html += '  <div class="denom-grid">';

    for (var i = 0; i < CASH_DENOMS.length; i++) {
        var denom = CASH_DENOMS[i];
        var count = cashCounts[denom.value] || 0;
        var subtotal = denom.value * count;
        html += '    <div class="denom-card">';
        html += '      <div class="denom-label">' + denom.label + '</div>';
        html += '      <div class="denom-controls">';
        html += '        <button class="ctrl-btn ctrl-minus" onclick="adjustCashCount(' + denom.value + ', -1)">−</button>';
        html += '        <input type="number" class="denom-input" id="cashInput_' + denom.value + '" value="' + count + '" min="0" onchange="setCashCount(' + denom.value + ', this.value)" onfocus="this.select()">';
        html += '        <button class="ctrl-btn ctrl-plus" onclick="adjustCashCount(' + denom.value + ', 1)">+</button>';
        html += '      </div>';
        html += '      <div class="denom-subtotal" id="denomSubtotal_' + denom.value + '">' + formatMoney(subtotal) + '</div>';
        html += '    </div>';
    }

    html += '  </div>';

    // ===== NÚT HÀNH ĐỘNG =====
    var displayDate = data.dateKey || (typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10));
    var dateLabel = formatDateDisplay(displayDate);
    var hasPickupHistory = data.pickupHistory && data.pickupHistory.length > 0;
    if (isAdmin) {
        html += '  <div class="cash-counter-actions">';
        html += '    <button class="cash-action-btn cash-reset-btn" onclick="resetCashCounter()">🔄 Làm lại</button>';
        if (!data.isClosed) {
            // NÂNG CẤP: Admin cũng có nút chốt ngày để chốt thay nhân viên
            html += '    <button class="cash-action-btn cash-close-btn" onclick="staffCloseDay()">🔒 Chốt ngày ' + dateLabel + '</button>';
        } else {
            // Admin có nút "Hủy chốt" để mở khóa cho nhân viên chốt lại
            html += '    <button class="cash-action-btn cash-unlock-btn" onclick="unlockDayClose()">🔓 Hủy chốt ' + dateLabel + '</button>';
            // Nút in phiếu chốt ca cho admin
            html += '    <button class="cash-action-btn" style="background:#27ae60;color:#fff;" onclick="printStaffCloseReceipt()">🖨️ In chốt ca</button>';
        }
        // Nút in phiếu QL nhận tiền - nằm trong cash-counter-actions cho admin
        if (hasPickupHistory) {
            html += '    <button class="cash-action-btn" style="background:#2c3e50;color:#fff;" onclick="printManagerPickup()">🖨️ In QL nhận</button>';
        }
        html += '  </div>';
    } else {
        html += '  <div class="cash-counter-actions">';
        html += '    <button class="cash-action-btn cash-reset-btn" onclick="resetCashCounter()">🔄 Làm lại</button>';
        if (!data.isClosed) {
            html += '    <button class="cash-action-btn cash-close-btn" onclick="staffCloseDay()">🔒 Chốt ngày ' + dateLabel + '</button>';
        } else {
            // Nút in phiếu chốt ca cho nhân viên
            html += '    <button class="cash-action-btn" style="background:#27ae60;color:#fff;" onclick="printStaffCloseReceipt()">🖨️ In chốt ca</button>';
        }
        // Nút in phiếu QL nhận tiền cho nhân viên (nếu có lịch sử)
        if (hasPickupHistory) {
            html += '    <button class="cash-action-btn" style="background:#2c3e50;color:#fff;" onclick="printManagerPickup()">🖨️ In QL nhận</button>';
        }
        html += '  </div>';
    }

    html += '</div>';

    // ===== PHẦN RIÊNG: TIỀN QUẢN LÝ NHẬN (input + lưu Firebase) =====
    if (isAdmin) {
        html += '<div class="cash-counter" style="margin-top:12px;">';
        html += '  <div class="cash-counter-header">';
        html += '    <span class="cash-counter-title">💰 Tiền QL nhận</span>';
        html += '  </div>';
        html += '  <div class="pos-cash-info">';
        html += '    <div class="pos-cash-row">';
        html += '      <span>Tiền QL nhận:</span>';
        html += '      <span class="pos-cash-mgr-pickup">';
        html += '        <input type="number" class="mgr-pickup-input" id="mgrPickupInput" value="" min="0" placeholder="0">';
        html += '        <button class="mgr-pickup-btn" onclick="saveManagerPickup()">💾 Lưu</button>';
        html += '      </span>';
        html += '    </div>';

        // Lịch sử quản lý nhận tiền hôm nay
        if (data.pickupHistory && data.pickupHistory.length > 0) {
            for (var hi = 0; hi < data.pickupHistory.length; hi++) {
                var ph = data.pickupHistory[hi];
                var timeStr = '';
                if (ph.createdAt) {
                    var d = new Date(ph.createdAt);
                    timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                }
                var pickupId = ph.id || '';
                var remainingStr = ph.remainingPosCash !== undefined ? formatMoney(ph.remainingPosCash) : '...';
                html += '    <div class="pos-cash-row pos-cash-pickup-log">';
                html += '      <span>🕐 ' + timeStr + '</span>';
                html += '      <span>-' + formatMoney(ph.amount) + '</span>';
                html += '      <span style="font-size:11px;color:#64748b;margin-left:8px;">📦 Còn: ' + remainingStr + '</span>';
                html += '      <button class="cash-action-btn" style="padding:2px 6px;font-size:10px;margin-left:auto;color:#e74c3c;background:none;border:1px solid #e74c3c;border-radius:4px;cursor:pointer;" onclick="deleteManagerPickup(\'' + pickupId + '\')" title="Xóa">🗑️</button>';
                html += '    </div>';
            }
        }
        html += '  </div>';
        html += '</div>';
    }

    container.innerHTML = html;
}

function adjustCashCount(denomValue, delta) {
    var current = cashCounts[denomValue] || 0;
    var newVal = current + delta;
    if (newVal < 0) newVal = 0;
    cashCounts[denomValue] = newVal;
    _saveCashCountsToLocal();
    updateDenomSubtotal(denomValue);
    updateCashGrandTotal();
}

function setCashCount(denomValue, val) {
    var num = parseInt(val, 10);
    if (isNaN(num) || num < 0) num = 0;
    cashCounts[denomValue] = num;
    _saveCashCountsToLocal();
    updateDenomSubtotal(denomValue);
    updateCashGrandTotal();
}

function updateDenomSubtotal(denomValue) {
    var count = cashCounts[denomValue] || 0;
    var subtotal = denomValue * count;
    var el = document.getElementById('denomSubtotal_' + denomValue);
    if (el) el.textContent = formatMoney(subtotal);
    var input = document.getElementById('cashInput_' + denomValue);
    if (input) input.value = count;
}

function updateCashGrandTotal() {
    var total = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        var denom = CASH_DENOMS[i];
        total += denom.value * (cashCounts[denom.value] || 0);
    }

    // Số tiền thực tế
    // - Nếu đã chốt ngày: hiển thị cashKept đã lưu (không thay đổi theo số đếm)
    //   Nếu cashKept null (dữ liệu cũ): fallback về expectedClosing
    // - Nếu chưa chốt: hiển thị tổng đếm được (total)
    var el = document.getElementById('cashGrandTotal');
    if (el) {
        var isClosed = _posCashData && _posCashData.isClosed;
        var displayTotal;
        if (isClosed) {
            displayTotal = (_posCashData.cashKept !== null && _posCashData.cashKept !== undefined) ? _posCashData.cashKept : _posCashData.expectedClosing;
        } else {
            displayTotal = total;
        }
        el.textContent = formatMoney(displayTotal);
    }

    // Cập nhật chênh lệch realtime (admin)
    var expectedClosing = _posCashData ? _posCashData.expectedClosing : 0;
    var liveDiff = total - expectedClosing;
    var diffEl = document.getElementById('posCashDiffValue');
    if (diffEl) {
        var diffClass = liveDiff >= 0 ? 'pos-cash-positive' : 'pos-cash-negative';
        diffEl.textContent = (liveDiff >= 0 ? '+' : '') + formatMoney(liveDiff);
        diffEl.className = diffClass;
    }

    // Cập nhật Tổng số tiền đếm được (staff) - realtime khi nhập mệnh giá
    var staffPosCashEl = document.getElementById('staffPosCashValue');
    if (staffPosCashEl) {
        if (total > 0) {
            staffPosCashEl.textContent = formatMoney(total);
            staffPosCashEl.className = 'pos-cash-positive';
            // Hiện dòng nếu đang bị ẩn (lần đầu nhập mệnh giá)
            var parentRow = staffPosCashEl.closest('.pos-cash-row');
            if (parentRow) parentRow.style.display = '';
        } else {
            // Ẩn dòng số tiền khi chưa nhập mệnh giá
            var parentRow = staffPosCashEl.closest('.pos-cash-row');
            if (parentRow) parentRow.style.display = 'none';
        }
    }

    // Cập nhật 💵 Số tiền tại POS hiện tại (admin) - realtime khi nhập mệnh giá
    var adminPosCashEl = document.getElementById('adminPosCashValue');
    if (adminPosCashEl) {
        var adminDisplayValue = total > 0 ? total : (_posCashData ? _posCashData.expectedClosing : 0);
        adminPosCashEl.textContent = formatMoney(adminDisplayValue);
        adminPosCashEl.className = adminDisplayValue >= 0 ? 'pos-cash-positive' : 'pos-cash-negative';
    }
}

function resetCashCounter() {
    // Nếu đã chốt ngày thì không cho reset - tránh nhầm lẫn số liệu
    if (_posCashData && _posCashData.isClosed) {
        showToast('🔒 Đã chốt ngày, không thể làm lại', 'warning');
        return;
    }
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        cashCounts[CASH_DENOMS[i].value] = 0;
    }
    _saveCashCountsToLocal();
    renderCashCounter();
}

function copyCashResult() {
    var total = 0;
    var lines = [];
    lines.push('=== KIỂM TIỀN MẶT POS ===');
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        var denom = CASH_DENOMS[i];
        var count = cashCounts[denom.value] || 0;
        if (count > 0) {
            var subtotal = denom.value * count;
            total += subtotal;
            lines.push(denom.label + ': ' + count + ' tờ = ' + formatMoney(subtotal));
        }
    }
    lines.push('---------------------');
    lines.push('TỔNG CỘNG: ' + formatMoney(total));

    if (_posCashData) {
        lines.push('');
        lines.push('📊 ĐỐI SOÁT:');
        lines.push('Dự kiến: ' + formatMoney(_posCashData.expectedClosing));
        lines.push('Thực tế: ' + formatMoney(total));
        var diff = total - _posCashData.expectedClosing;
        lines.push('Chênh lệch: ' + (diff >= 0 ? '+' : '') + formatMoney(diff));
    }

    var text = lines.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            showToast('✅ Đã sao chép kết quả', 'success');
        }).catch(function() {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showToast('✅ Đã sao chép kết quả', 'success');
    } catch (e) {
        showToast('❌ Không thể sao chép', 'error');
    }
    document.body.removeChild(textarea);
}

// ========== QUẢN LÝ: NHẬP TIỀN QUẢN LÝ NHẬN ==========
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

    // Cập nhật cache ngay lập tức để loadPosCashData() thấy dữ liệu mới
    // (vì child_added từ Firebase có thể chưa kịp gửi về)
    if (!_pickupsCache) _pickupsCache = {};
    _pickupsCache[pickupId] = pickupData;
    _pickupsCacheLoaded = true;

    // Bước 1: Lưu vào IndexedDB qua DB.create trước -> memoryCache được cập nhật ngay
    // -> realtime subscription nhận notify -> UI cập nhật
    if (typeof DB !== 'undefined' && typeof DB.create === 'function') {
        DB.create('manager_cash_pickups', pickupData).then(function() {
            // Bước 2: Sau khi DB.create thành công, ghi lên Firebase để đồng bộ các máy khác
            var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
            var dbRef = firebase.database().ref(shopId + '/manager_cash_pickups/' + pickupId);
            dbRef.set(pickupData).catch(function(err) {});

            showToast('✅ Đã lưu: ' + formatMoney(amount), 'success');
            loadPosCashData();
        }).catch(function(err) {
            showToast('❌ Lỗi khi lưu!', 'error');
        });
    } else {
        // Fallback: ghi thẳng lên Firebase nếu DB.create không có sẵn
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var dbRef = firebase.database().ref(shopId + '/manager_cash_pickups/' + pickupId);
        dbRef.set(pickupData).catch(function(err) {});
        showToast('✅ Đã lưu: ' + formatMoney(amount) + ' (chưa đồng bộ)', 'success');
        loadPosCashData();
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

    // Cập nhật cache ngay lập tức (xóa khỏi _pickupsCache)
    // để loadPosCashData() không còn thấy item đã xóa
    if (_pickupsCache && _pickupsCache[pickupId]) {
        delete _pickupsCache[pickupId];
    }

    // Bước 1: Xóa trên Firebase
    var dbRef = firebase.database().ref(shopId + '/manager_cash_pickups/' + pickupId);
    dbRef.remove().catch(function(err) {
    });

    // Bước 2: Xóa trong IndexedDB qua DB.remove (nếu có)
    if (typeof DB !== 'undefined' && typeof DB.remove === 'function') {
        DB.remove('manager_cash_pickups', pickupId).then(function() {
            showToast('✅ Đã xóa pickup', 'success');
            loadPosCashData();
        }).catch(function(err) {
            showToast('✅ Đã xóa trên Firebase', 'success');
            loadPosCashData();
        });
    } else {
        showToast('✅ Đã xóa pickup', 'success');
        loadPosCashData();
    }
}


// ========== HÀM CHỌN NGÀY TRƯỚC ĐÓ ĐỂ CHỐT ==========
function selectCloseDate(dateStr) {
    if (!dateStr) return;
    _selectedCloseDate = dateStr;
    // Reset bộ đếm tiền khi chuyển ngày
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        cashCounts[CASH_DENOMS[i].value] = 0;
    }
    loadPosCashData(dateStr);
}

// Lùi/Tiến ngày (delta = -1: lùi, delta = 1: tiến)
function changeCloseDate(delta) {
    var currentDate = _selectedCloseDate || (_posCashData && _posCashData.dateKey) || getTodayDateKey();
    var d = new Date(Date.UTC(
        parseInt(currentDate.split('-')[0], 10),
        parseInt(currentDate.split('-')[1], 10) - 1,
        parseInt(currentDate.split('-')[2], 10)
    ));
    d.setDate(d.getDate() + delta);
    var newDateStr = d.toISOString().slice(0, 10);
    selectCloseDate(newDateStr);
}

// Nhảy đến ngày được chọn từ date picker
function jumpToDate(dateStr) {
    if (!dateStr) return;
    selectCloseDate(dateStr);
}

// ========== NHÂN VIÊN: CHỐT NGÀY ==========
function staffCloseDay() {
    var countedTotal = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        countedTotal += CASH_DENOMS[i].value * (cashCounts[CASH_DENOMS[i].value] || 0);
    }

    var data = _posCashData || {
        openingBalance: 0, cashRevenue: 0, posCashExpense: 0,
        managerPickupTotal: 0, expectedClosing: 0
    };
    var managerPickupTotal = data.managerPickupTotal || 0;
    var expectedClosing = data.expectedClosing || 0;

    // expectedClosing đã trừ QL nhận
    var expectedAfterPickup = expectedClosing;
    var difference = countedTotal - expectedAfterPickup;
    var isNegative = difference < 0;
    var isSurplus = difference > 0;

    // differenceType: 'surplus' (dư), 'deficit' (thiếu), 'balanced' (cân bằng)
    // Dùng cho admin lọc danh sách chốt ngày dễ dàng
    var differenceType = isSurplus ? 'surplus' : (isNegative ? 'deficit' : 'balanced');

    // Dùng ngày đã chọn (nếu có), nếu không thì dùng hôm nay
    var closeDate = _selectedCloseDate || data.dateKey || getTodayDateKey();

    // Tạo thời gian chốt ca theo UTC+7
    var now = new Date();
    var vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    var closedAtTime = ('0' + vnTime.getUTCHours()).slice(-2) + ':' +
                       ('0' + vnTime.getUTCMinutes()).slice(-2) + ' ' +
                       ('0' + vnTime.getUTCDate()).slice(-2) + '/' +
                       ('0' + (vnTime.getUTCMonth() + 1)).slice(-2) + '/' +
                       vnTime.getUTCFullYear();

    // Ghi lên Firebase - các máy khác đọc realtime sẽ tự cập nhật
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var dbRef = firebase.database().ref(shopId + '/daily_balances/' + closeDate);
    dbRef.update({
        cashKept: countedTotal,
        difference: difference,
        differenceType: differenceType,
        isClosed: true,
        closedAt: Date.now(),
        closedAtTime: closedAtTime,
        closedBy: window.currentDeviceId || 'staff',
        updatedAt: Date.now()
    }).then(function() {
        // Thông báo kết quả
        try {
            var toastMsg = '';
            var isSurplus = difference > 0;
            if (isNegative) {
                toastMsg = '🔒 ĐÃ CHỐT NGÀY ' + formatDateDisplay(closeDate) + '\n' +
                           '🔴 THIẾU ' + formatMoney(Math.abs(difference)) + ' - BÁO QUẢN LÝ!\n\n' +
                           '📂 Đầu kỳ: ' + formatMoney(data.openingBalance) + '\n' +
                           '💵 Đếm được: ' + formatMoney(countedTotal) + '\n' +
                           '💰 QL nhận: ' + formatMoney(managerPickupTotal) + '\n' +
                           '📐 Dự kiến còn: ' + formatMoney(expectedAfterPickup) + '\n' +
                           '📋 Thiếu: ' + formatMoney(Math.abs(difference));
                showCloseableToast(toastMsg, 'error');
            } else if (isSurplus) {
                toastMsg = '🔒 ĐÃ CHỐT NGÀY ' + formatDateDisplay(closeDate) + '\n' +
                           '⚠️ Dư tiền! Vui lòng nhập dữ liệu lần sau chính xác hơn.\n\n' +
                           '📂 Đầu kỳ: ' + formatMoney(data.openingBalance) + '\n' +
                           '💵 Đếm được: ' + formatMoney(countedTotal) + '\n' +
                           '💰 QL nhận: ' + formatMoney(managerPickupTotal) + '\n' +
                           '📐 Dự kiến còn: ' + formatMoney(expectedAfterPickup);
                showCloseableToast(toastMsg, 'warning');
            } else {
                toastMsg = '🔒 ĐÃ CHỐT NGÀY ' + formatDateDisplay(closeDate) + '\n' +
                           '✅ Số dư đầu kỳ mai: ' + formatMoney(countedTotal) + '\n\n' +
                           '📂 Đầu kỳ: ' + formatMoney(data.openingBalance) + '\n' +
                           '💵 Đếm được: ' + formatMoney(countedTotal) + '\n' +
                           '💰 QL nhận: ' + formatMoney(managerPickupTotal) + '\n' +
                           '📐 Dự kiến còn: ' + formatMoney(expectedAfterPickup) + '\n' +
                           '📋 Không chênh lệch';
                showCloseableToast(toastMsg, 'success');
            }
        } catch (e) {
        }

        // Gửi Telegram cho admin (dùng token riêng cho chốt ca - luồng riêng, ko qua telegram.js)
        // Tính thống kê doanh thu từ transactions
        // Cách đơn giản: gửi trực tiếp, đồng bộ (giống unlockDayClose)
        // Thử đọc transactions từ IndexedDB, nếu lỗi thì gửi với số liệu = 0
        var totalRevenue = 0;
        var cashCount = 0, cashAmount = 0;
        var transferCount = 0, transferAmount = 0;
        var grabCount = 0, grabAmount = 0;
        
        // Hàm xử lý transactions và gửi Telegram
        function _processTransactionsAndSend(txList) {
            for (var t = 0; t < txList.length; t++) {
                var tx = txList[t];
                if (tx.refunded) continue;
                // Bỏ qua ghi nợ - chỉ tính doanh thu thực tế khi khách thanh toán
                if (tx.paymentMethod === 'debt') continue;
                var amt = tx.amount || 0;
                totalRevenue += amt;
                if (tx.paymentMethod === 'cash') {
                    cashCount++;
                    cashAmount += amt;
                } else if (tx.paymentMethod === 'transfer') {
                    transferCount++;
                    transferAmount += amt;
                } else if (tx.paymentMethod === 'grab') {
                    grabCount++;
                    grabAmount += amt;
                }
            }
            _sendShiftCloseTelegram(closeDate, data, countedTotal, managerPickupTotal, expectedAfterPickup, difference, isNegative, isSurplus, closedAtTime, totalRevenue, cashCount, cashAmount, transferCount, transferAmount, grabCount, grabAmount);
        }
        
        // Đọc transactions từ IndexedDB (bất đồng bộ)
        try {
            if (typeof DB !== 'undefined' && typeof DB.getTransactionsByDate === 'function') {
                var txPromise = DB.getTransactionsByDate(closeDate);
                if (txPromise && typeof txPromise.then === 'function') {
                    txPromise.then(function(txList) {
                        _processTransactionsAndSend(txList || []);
                    }).catch(function() {
                        _processTransactionsAndSend([]);
                    });
                } else if (Array.isArray(txPromise)) {
                    _processTransactionsAndSend(txPromise);
                } else {
                    _processTransactionsAndSend([]);
                }
            } else {
                _processTransactionsAndSend([]);
            }
        } catch (e) {
            _processTransactionsAndSend([]);
        }

        // Sau khi chốt, quay về ngày hôm nay
        _selectedCloseDate = null;
        loadPosCashData();
    }).catch(function(err) {
        // Vẫn thử gửi Telegram ngay cả khi Firebase lỗi
        try {
            _sendShiftCloseTelegram(closeDate, data || {}, countedTotal || 0, managerPickupTotal || 0, expectedAfterPickup || 0, difference || 0, isNegative, isSurplus, closedAtTime || '', 0, 0, 0, 0, 0, 0, 0);
        } catch(e3) {
        }
        showToast('❌ Lỗi khi chốt ngày!', 'error');
    });
}

// ========== GỬI TELEGRAM CHỐT CA (LUỒNG RIÊNG - KO QUA telegram.js) ==========
// Dùng token riêng cho chốt ca, KHÔNG fallback về token chính
// Nếu chưa cấu hình token chốt ca thì bỏ qua (ko gửi)
function _sendShiftCloseTelegram(closeDate, data, countedTotal, managerPickupTotal, expectedAfterPickup, difference, isNegative, isSurplus, closedAtTime, totalRevenue, cashCount, cashAmount, transferCount, transferAmount, grabCount, grabAmount) {
    // Đọc token từ window.shopConfig (cập nhật realtime từ Firebase)
    // Fallback: đọc trực tiếp từ localStorage nếu shopConfig chưa kịp cập nhật
    var config = window.shopConfig || {};
    var botToken = config.telegramShiftCloseToken;
    var chatId = config.telegramChatId;

    // Fallback sang localStorage nếu window.shopConfig chưa có
    if (!botToken) {
        botToken = localStorage.getItem('telegram_shift_close_token');
    }
    if (!chatId) {
        chatId = localStorage.getItem('telegram_chat_id');
    }

    // Nếu ko có token shift -> bỏ qua (ko fallback về token chính)
    // Chỉ gửi qua token chốt ca riêng
    if (!botToken || !chatId) {
        return;
    }

    var icon = isNegative ? '🔴' : (isSurplus ? '⚠️' : '✅');
    var message = icon + ' NHÂN VIÊN CHỐT NGÀY ' + formatDateDisplay(closeDate) + '\n\n' +
                '🕐 Thời gian chốt: ' + closedAtTime + '\n' +
                '📂 Đầu kỳ: ' + formatMoney(data.openingBalance) + '\n' +
                '💵 Doanh thu TM: ' + formatMoney(data.cashRevenue) + '\n' +
                '🏦 Chi phí POS: ' + formatMoney(data.posCashExpense) + '\n' +
                '💰 QL nhận: ' + formatMoney(managerPickupTotal) + '\n' +
                '📐 Dự kiến còn: ' + formatMoney(expectedAfterPickup) + '\n' +
                '📊 Đếm được: ' + formatMoney(countedTotal) + '\n' +
                '📋 Chênh lệch: ' + (difference >= 0 ? '+' : '') + formatMoney(difference);

    // Thống kê doanh thu theo phương thức
    totalRevenue = totalRevenue || 0;
    cashCount = cashCount || 0;
    cashAmount = cashAmount || 0;
    transferCount = transferCount || 0;
    transferAmount = transferAmount || 0;
    grabCount = grabCount || 0;
    grabAmount = grabAmount || 0;
    var totalOrders = cashCount + transferCount + grabCount;

    message += '\n\n📊 TỔNG DOANH THU: ' + formatMoney(totalRevenue) + ' (' + totalOrders + ' đơn)';
    message += '\n💵 Tiền mặt: ' + cashCount + ' đơn - ' + formatMoney(cashAmount);
    message += '\n💳 Chuyển khoản: ' + transferCount + ' đơn - ' + formatMoney(transferAmount);
    message += '\n🛵 Grab: ' + grabCount + ' đơn - ' + formatMoney(grabAmount);

    if (isNegative) {
        message += '\n\n🔴 THIẾU ' + formatMoney(Math.abs(difference)) + ' - CẦN KIỂM TRA!';
    } else if (isSurplus) {
        message += '\n\n⚠️ DƯ ' + formatMoney(difference) + ' - Cần kiểm tra!';
    }

    // Gửi trực tiếp qua Telegram Bot API (ko qua ESP32, ko qua telegram.js)
    // Dùng XMLHttpRequest để tương thích Android 6 (WebView cũ)
    var url = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
    var params = JSON.stringify({
        chat_id: String(chatId),
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });

    // Cách 1: XMLHttpRequest (ưu tiên)
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 10000;
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
            } else {
                // Fallback: thử gửi bằng Image() nếu XHR lỗi
                _sendShiftCloseViaImage(url, chatId, message);
            }
        };
        xhr.onerror = function() {
            _sendShiftCloseViaImage(url, chatId, message);
        };
        xhr.ontimeout = function() {
            _sendShiftCloseViaImage(url, chatId, message);
        };
        xhr.send(params);
    } catch (e) {
        _sendShiftCloseViaImage(url, chatId, message);
    }
}

// Fallback: gửi Telegram bằng Image() (ko bị CORS, tương thích mọi trình duyệt)
function _sendShiftCloseViaImage(url, chatId, message) {
    try {
        // Telegram API hỗ trợ GET method
        var getUrl = url + '?chat_id=' + encodeURIComponent(String(chatId)) +
                     '&text=' + encodeURIComponent(message) +
                     '&parse_mode=HTML&disable_web_page_preview=true';
        var img = new Image();
        img.onload = function() { console.log('[ShiftClose] Gửi qua Image thành công'); };
        img.onerror = function() { console.error('[ShiftClose] Gửi qua Image thất bại'); };
        img.src = getUrl;
    } catch (e) {
    }
}

// Gửi thông báo hủy chốt qua luồng riêng (token chốt ca)
function _sendShiftCloseUnlock(closeDate) {
    var config = window.shopConfig || {};
    var botToken = config.telegramShiftCloseToken;
    var chatId = config.telegramChatId;

    // Fallback sang localStorage nếu window.shopConfig chưa có
    if (!botToken) {
        botToken = localStorage.getItem('telegram_shift_close_token');
    }
    if (!chatId) {
        chatId = localStorage.getItem('telegram_chat_id');
    }

    // Nếu ko có token shift -> bỏ qua (ko fallback sang token chính)
    if (!botToken || !chatId) {
        return;
    }

    var dateLabel = formatDateDisplay(closeDate);
    var message = '🔓 QUẢN LÝ HỦY CHỐT NGÀY ' + dateLabel + '\n\n' +
                  'Nhân viên có thể chốt lại ngày này.';

    var url = 'https://api.telegram.org/bot' + botToken + '/sendMessage';
    var params = JSON.stringify({
        chat_id: String(chatId),
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });

    // Cách 1: XMLHttpRequest (ưu tiên)
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.timeout = 10000;
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
            } else {
                _sendShiftCloseViaImage(url, chatId, message);
            }
        };
        xhr.onerror = function() {
            _sendShiftCloseViaImage(url, chatId, message);
        };
        xhr.ontimeout = function() {
            _sendShiftCloseViaImage(url, chatId, message);
        };
        xhr.send(params);
    } catch (e) {
        _sendShiftCloseViaImage(url, chatId, message);
    }
}

// ========== ADMIN: HỦY CHỐT NGÀY ==========
// Admin có thể hủy chốt để cho phép nhân viên chốt lại
function unlockDayClose() {
    var closeDate = _selectedCloseDate || (_posCashData && _posCashData.dateKey) || getTodayDateKey();
    var dateLabel = formatDateDisplay(closeDate);

    if (!confirm('🔓 Xác nhận hủy chốt ngày ' + dateLabel + '?\n\nSau khi hủy chốt:\n- Nhân viên có thể chốt lại\n- Hoàn tác/xóa món/xóa bàn sẽ yêu cầu mật khẩu (đã chốt)\n\nTiếp tục?')) return;

    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';

    var dbRef = firebase.database().ref(shopId + '/daily_balances/' + closeDate);
    dbRef.update({
        isClosed: false,
        closedAt: null,
        closedBy: null,
        updatedAt: Date.now()
    }).then(function() {
        showToast('🔓 Đã hủy chốt ngày ' + dateLabel, 'success');

        // Gửi thông báo hủy chốt qua luồng riêng (token chốt ca)
        _sendShiftCloseUnlock(closeDate);

        // Quay về ngày hôm nay sau khi hủy chốt
        _selectedCloseDate = null;
        loadPosCashData();
    }).catch(function(err) {
        showToast('❌ Lỗi khi hủy chốt!', 'error');
    });
}

// ========== TOAST CÓ NÚT TẮT ==========
function showCloseableToast(message, type) {
    var toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'success') + ' toast-closeable';
    toast.style.cursor = 'default';

    var msgSpan = document.createElement('span');
    msgSpan.style.whiteSpace = 'pre-line';
    msgSpan.style.flex = '1';
    msgSpan.style.fontSize = '13px';
    msgSpan.style.lineHeight = '1.6';
    msgSpan.textContent = message;

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0 0 0 12px;opacity:0.8;flex-shrink:0;';
    closeBtn.onclick = function() {
        if (toast.parentNode) toast.remove();
    };

    toast.appendChild(msgSpan);
    toast.appendChild(closeBtn);
    document.getElementById('toastContainer').appendChild(toast);

    // Auto-dismiss sau 15 giây nếu không tắt
    setTimeout(function() {
        if (toast.parentNode) {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.5s';
            setTimeout(function() {
                if (toast.parentNode) toast.remove();
            }, 500);
        }
    }, 15000);
}

// ============================================================
// 2. CÀI ĐẶT ỨNG DỤNG (Settings)
// ============================================================

function initSettingsTab() {
    try {
    // Phân quyền hiển thị:
    // - Nhân viên: chỉ thấy "📝 Ghi chú"
    // - Admin: thấy tất cả (Telegram, ESP32, Thông tin quán, Chat)
    // Phân quyền nhân viên đã chuyển sang modal employees.js
    var isAdmin = typeof DB !== 'undefined' && DB.isAdmin && DB.isAdmin();
    var shopSection = document.getElementById('settingsShopSection');
    var telegramSection = document.getElementById('settingsTelegramSection');
    var permSection = document.getElementById('settingsPermissionSection');
    var chatSection = document.getElementById('settingsChatSection');
    var esp32Section = document.getElementById('settingsEsp32Section');
    var chatLockField = document.getElementById('chatLockField');
    var staffNoteSection = document.getElementById('settingsStaffNoteSection');
    var lockSection = document.getElementById('settingsLockSection');
    var bonusFundSection = document.getElementById('settingsBonusFundSection');
    var syncDataSection = document.getElementById('settingsSyncDataSection');

    // Admin: hiển thị TOÀN BỘ các section - chỉ ẩn "Ghi chú nhân viên"
    // Nhân viên: ẩn TOÀN BỘ các section - chỉ hiển thị "Ghi chú nhân viên"
    if (isAdmin) {
        // Admin: hiển thị tất cả section cài đặt
        if (shopSection) shopSection.style.display = '';
        if (telegramSection) telegramSection.style.display = '';
        if (esp32Section) esp32Section.style.display = '';
        if (chatSection) chatSection.style.display = '';
        if (chatLockField) chatLockField.style.display = '';
        if (lockSection) lockSection.style.display = '';
        if (bonusFundSection) bonusFundSection.style.display = '';
        if (syncDataSection) syncDataSection.style.display = '';
        // Staff note section: ẩn với admin
        if (staffNoteSection) staffNoteSection.style.display = 'none';
        // Permission section: luôn ẩn (đã chuyển sang modal employees.js)
        if (permSection) permSection.style.display = 'none';
    } else {
        // Nhân viên: ẩn tất cả section cài đặt, chỉ hiển thị "Ghi chú"
        if (shopSection) shopSection.style.display = 'none';
        if (telegramSection) telegramSection.style.display = 'none';
        if (esp32Section) esp32Section.style.display = 'none';
        if (chatSection) chatSection.style.display = 'none';
        if (chatLockField) chatLockField.style.display = 'none';
        if (lockSection) lockSection.style.display = 'none';
        if (bonusFundSection) bonusFundSection.style.display = 'none';
        if (syncDataSection) syncDataSection.style.display = 'none';
        if (permSection) permSection.style.display = 'none';
        // Staff note section: hiển thị cho nhân viên
        if (staffNoteSection) staffNoteSection.style.display = '';
    }

    // Mặc định thu gọn tất cả collapsible section
    var allCollapsible = document.querySelectorAll('.collapsible-section');
    for (var ci = 0; ci < allCollapsible.length; ci++) {
        allCollapsible[ci].classList.remove('expanded');
        var body = allCollapsible[ci].querySelector('.settings-section-body');
        if (body) body.style.display = 'none';
        var icon = allCollapsible[ci].querySelector('.settings-toggle-icon');
        if (icon) {
            icon.textContent = '▶';
        }
    }

    // Load Telegram config từ localStorage
    var savedToken = localStorage.getItem('telegram_bot_token');
    var savedChatId = localStorage.getItem('telegram_chat_id');
    var savedBotName = localStorage.getItem('telegram_bot_name');
    var savedShiftCloseToken = localStorage.getItem('telegram_shift_close_token');
    var savedWarningToken = localStorage.getItem('telegram_warning_token');
    var savedExpenseToken = localStorage.getItem('telegram_expense_token');

    // Khởi tạo window.shopConfig để các hàm gửi Telegram (cả chung và chốt ca) đọc được
    // Ưu tiên giữ giá trị từ Firebase realtime nếu đã có (tránh ghi đè bằng localStorage rỗng)
    if (!window.shopConfig) {
        window.shopConfig = {};
    }
    // Chỉ ghi đè nếu localStorage có giá trị, nếu không giữ nguyên từ Firebase realtime
    if (savedToken) window.shopConfig.telegramBotToken = savedToken;
    if (savedChatId) window.shopConfig.telegramChatId = savedChatId;
    if (savedShiftCloseToken) window.shopConfig.telegramShiftCloseToken = savedShiftCloseToken;
    if (savedWarningToken) window.shopConfig.telegramWarningToken = savedWarningToken;
    if (savedExpenseToken) window.shopConfig.telegramExpenseToken = savedExpenseToken;

    // Load Telegram config vào UI
    var tokenInput = document.getElementById('telegramBotToken');
    if (tokenInput) tokenInput.value = savedToken || '';
    var chatIdInput = document.getElementById('telegramChatId');
    if (chatIdInput) chatIdInput.value = savedChatId || '';
    var botNameInput = document.getElementById('telegramBotName');
    if (botNameInput) botNameInput.value = savedBotName || '';

    // Load shift-close Telegram config vào UI
    var shiftCloseTokenInput = document.getElementById('telegramShiftCloseToken');
    if (shiftCloseTokenInput) shiftCloseTokenInput.value = savedShiftCloseToken || '';

    // Load warning Telegram config vào UI
    var warningTokenInput = document.getElementById('telegramWarningToken');
    if (warningTokenInput) warningTokenInput.value = savedWarningToken || '';

    // Load expense Telegram config vào UI
    var expenseTokenInput = document.getElementById('telegramExpenseToken');
    if (expenseTokenInput) expenseTokenInput.value = savedExpenseToken || '';

    // Load staff permission list (đã chuyển sang modal employees.js)
    // Giữ lại để tương thích nếu có gọi từ nơi khác

    // Khởi tạo Đếm tiền nhanh
    if (typeof initQuickCashCounter === 'function') {
        initQuickCashCounter();
    }

    // Load shop info
    if (typeof loadShopInfo === 'function') {
        loadShopInfo();
    }

    // Load ESP32 config
    if (typeof loadEsp32Config === 'function') {
        loadEsp32Config();
    }

    // Load lock config
    loadLockConfig();

    // Đồng bộ trạng thái toggle khóa chat
    // Sử dụng isChatLocked() từ messages.js (đã đồng bộ qua Firebase realtime)
    if (isAdmin) {
        var chatLockToggle = document.getElementById('chatLockToggle');
        var chatLockLabel = document.getElementById('chatLockStatusLabel');
        if (chatLockToggle) {
            var locked = false;
            if (typeof isChatLocked === 'function') {
                locked = isChatLocked();
            } else {
                // Fallback nếu messages.js chưa load
                try {
                    locked = localStorage.getItem('chat_staff_locked') === 'true';
                } catch(e) {}
            }
            chatLockToggle.checked = locked;
            if (chatLockLabel) {
                chatLockLabel.textContent = locked ? '🔒 Đã khóa' : '🔓 Đã mở';
            }
        }
    }

    // Load ghi chú nhân viên từ localStorage
    var staffNoteInput = document.getElementById('staffNoteInput');
    if (staffNoteInput) {
        try {
            var savedNote = localStorage.getItem('staff_note');
            if (savedNote !== null) {
                staffNoteInput.value = savedNote;
            }
        } catch(e) {}
    }

    } catch(e) {
    }
}

// Lưu ghi chú nhân viên vào localStorage (gọi từ oninput)
function saveStaffNote(value) {
    try {
        localStorage.setItem('staff_note', value || '');
    } catch(e) {}
}

// OPTIMIZE: Xử lý nút "Tải toàn bộ dữ liệu" trong Settings
// Gọi forceSyncFromFirebase để tải lại tất cả collections từ Firebase
function handleLoadAllData() {
    var btn = document.getElementById('btnLoadAllData');
    var statusEl = document.getElementById('loadAllDataStatus');
    if (!btn || !statusEl) return;
    
    // Chống double-click
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '⏳ Đang tải...';
    statusEl.textContent = 'Đang tải lại dữ liệu từ Firebase...';
    statusEl.style.color = '#888';
    
    if (typeof DB === 'undefined' || typeof DB.forceSyncFromFirebase !== 'function') {
        statusEl.textContent = '❌ DB chưa sẵn sàng, vui lòng thử lại sau';
        statusEl.style.color = '#ef4444';
        btn.disabled = false;
        btn.textContent = '📥 Tải toàn bộ dữ liệu';
        return;
    }
    
    if (typeof DB.isOnline === 'function' && !DB.isOnline()) {
        statusEl.textContent = '❌ Không có kết nối mạng';
        statusEl.style.color = '#ef4444';
        btn.disabled = false;
        btn.textContent = '📥 Tải toàn bộ dữ liệu';
        return;
    }
    
    // Gọi forceSyncFromFirebase - admin sẽ tải 31 ngày, employee tải ngày hiện tại
    DB.forceSyncFromFirebase().then(function() {
        statusEl.textContent = '✅ Hoàn tất! Đã tải lại toàn bộ dữ liệu từ Firebase.';
        statusEl.style.color = '#22c55e';
        btn.disabled = false;
        btn.textContent = '📥 Tải toàn bộ dữ liệu';
    }).catch(function(err) {
        if (err && err.message === 'Offline') {
            statusEl.textContent = '❌ Không có kết nối mạng';
        } else {
            statusEl.textContent = '❌ Lỗi: ' + (err && err.message ? err.message : 'Không xác định');
        }
        statusEl.style.color = '#ef4444';
        btn.disabled = false;
        btn.textContent = '📥 Tải toàn bộ dữ liệu';
    });
}

function savePrinterIp() {
    var input = document.getElementById('settingsPrinterIp');
    if (!input) return;
    var ip = input.value.trim();
    if (!ip) {
        showToast('⚠️ Vui lòng nhập địa chỉ IP', 'warning');
        return;
    }
    localStorage.setItem('printer_ip', ip);
    showToast('✅ Đã lưu địa chỉ máy in', 'success');
}

function testPrint() {
    var ip = localStorage.getItem('printer_ip');
    if (!ip) {
        showToast('⚠️ Chưa có địa chỉ máy in', 'warning');
        return;
    }
    // Gửi lệnh in thử qua Android bridge
    if (window.AppBridge && typeof window.AppBridge.printTest === 'function') {
        window.AppBridge.printTest(ip);
    } else {
        showToast('📡 Đã gửi lệnh in thử đến ' + ip, 'info');
    }
}

function toggleTokenVisibility() {
    var input = document.getElementById('settingsGithubToken');
    var btn = document.getElementById('settingsToggleToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

// ============================================================
// 3. THÔNG TIN QUÁN (Shop Info)
// ============================================================

function loadShopInfo() {
    var nameEl = document.getElementById('shopInfoName');
    var addressEl = document.getElementById('shopInfoAddress');
    var phoneEl = document.getElementById('shopInfoPhone');
    if (!nameEl) return;

    if (window.shopInfo) {
        nameEl.value = window.shopInfo.name || '';
        addressEl.value = window.shopInfo.address || '';
        phoneEl.value = window.shopInfo.phone || '';
    } else {
        nameEl.value = '';
        addressEl.value = '';
        phoneEl.value = '';
    }
}

function saveShopInfo() {
    var name = document.getElementById('shopInfoName').value.trim();
    var address = document.getElementById('shopInfoAddress').value.trim();
    var phone = document.getElementById('shopInfoPhone').value.trim();

    if (!name) {
        showToast('⚠️ Vui lòng nhập tên quán', 'warning');
        return;
    }

    var data = {
        id: 'shop_info',
        name: name,
        address: address,
        phone: phone,
        updatedAt: new Date().toISOString()
    };

    DB.create('info', data, 'shop_info').then(function() {
        window.shopInfo = data;
        showToast('✅ Đã lưu thông tin quán', 'success');
    }).catch(function(err) {
        showToast('❌ Lỗi lưu thông tin quán', 'error');
    });
}

function clearShopInfo() {
    if (!confirm('Xóa thông tin quán?')) return;
    DB.remove('info', 'shop_info').then(function() {
        window.shopInfo = null;
        loadShopInfo();
        showToast('🗑️ Đã xóa thông tin quán', 'info');
    }).catch(function(err) {
        showToast('❌ Lỗi xóa thông tin quán', 'error');
    });
}

// ============================================================
// 5. TELEGRAM CONFIG
// ============================================================

function toggleTelegramTokenVisibility() {
    var input = document.getElementById('telegramBotToken');
    var btn = document.getElementById('settingsToggleTelegramToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

function toggleShiftCloseTokenVisibility() {
    var input = document.getElementById('telegramShiftCloseToken');
    var btn = document.getElementById('settingsToggleShiftCloseToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

function toggleWarningTokenVisibility() {
    var input = document.getElementById('telegramWarningToken');
    var btn = document.getElementById('settingsToggleWarningToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

function toggleExpenseTokenVisibility() {
    var input = document.getElementById('telegramExpenseToken');
    var btn = document.getElementById('settingsToggleExpenseToken');
    if (!input || !btn) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
    } else {
        input.type = 'password';
        btn.textContent = '👁️';
    }
}

function testShiftCloseTelegram() {
    var token = localStorage.getItem('telegram_shift_close_token');
    var chatId = localStorage.getItem('telegram_chat_id');
    if (!token) {
        showToast('⚠️ Chưa có token chốt ca, dùng token chính để thử', 'warning');
        token = localStorage.getItem('telegram_bot_token');
        chatId = localStorage.getItem('telegram_chat_id');
        if (!token || !chatId) {
            showToast('⚠️ Chưa có cấu hình Telegram nào', 'warning');
            return;
        }
    }

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '📨 Đang gửi tin nhắn thử chốt ca...';

    var message = encodeURIComponent('🔒 *Tin nhắn thử từ POS - Chốt ca* \n\nNếu bạn thấy tin nhắn này, cấu hình Telegram chốt ca đã hoạt động!');
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage?chat_id=' + chatId + '&text=' + message + '&parse_mode=Markdown';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 10000;

    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            if (statusEl) statusEl.textContent = '✅ Gửi thử chốt ca thành công!';
            showToast('✅ Gửi tin nhắn thử chốt ca thành công', 'success');
        } else {
            if (statusEl) statusEl.textContent = '❌ Lỗi: ' + xhr.status;
            showToast('❌ Gửi thử chốt ca thất bại (HTTP ' + xhr.status + ')', 'error');
        }
    };

    xhr.onerror = function() {
        if (statusEl) statusEl.textContent = '❌ Không thể kết nối Telegram';
        showToast('❌ Không thể kết nối Telegram API', 'error');
    };

    xhr.ontimeout = function() {
        if (statusEl) statusEl.textContent = '❌ Hết thời gian chờ';
        showToast('❌ Hết thời gian chờ kết nối Telegram', 'error');
    };

    xhr.send();
}

function saveTelegramConfig() {
    var token = document.getElementById('telegramBotToken').value.trim();
    var chatId = document.getElementById('telegramChatId').value.trim();
    var botName = document.getElementById('telegramBotName').value.trim();

    // Shift-close token (không bắt buộc)
    var shiftCloseToken = document.getElementById('telegramShiftCloseToken').value.trim();

    // Warning token (không bắt buộc) - dùng chung Chat ID
    var warningToken = document.getElementById('telegramWarningToken').value.trim();

    // Expense token (không bắt buộc) - dùng chung Chat ID
    var expenseToken = document.getElementById('telegramExpenseToken').value.trim();

    if (!token || !chatId) {
        showToast('⚠️ Vui lòng nhập Bot Token và Chat ID cho thông báo chung', 'warning');
        return;
    }

    localStorage.setItem('telegram_bot_token', token);
    localStorage.setItem('telegram_chat_id', chatId);
    if (botName) {
        localStorage.setItem('telegram_bot_name', botName);
    }

    // Lưu shift-close token
    if (shiftCloseToken) {
        localStorage.setItem('telegram_shift_close_token', shiftCloseToken);
    } else {
        localStorage.removeItem('telegram_shift_close_token');
    }

    // Lưu warning token (dùng chung Chat ID)
    if (warningToken) {
        localStorage.setItem('telegram_warning_token', warningToken);
    } else {
        localStorage.removeItem('telegram_warning_token');
    }

    // Lưu expense token (dùng chung Chat ID)
    if (expenseToken) {
        localStorage.setItem('telegram_expense_token', expenseToken);
    } else {
        localStorage.removeItem('telegram_expense_token');
    }

    // Cập nhật biến global trong telegram.js nếu có
    if (typeof window.TELEGRAM_BOT_TOKEN !== 'undefined') {
        window.TELEGRAM_BOT_TOKEN = token;
    }
    if (typeof window.TELEGRAM_CHAT_ID !== 'undefined') {
        window.TELEGRAM_CHAT_ID = chatId;
    }

    // Cập nhật shopConfig để _sendShiftCloseTelegram() đọc được
    if (!window.shopConfig) {
        window.shopConfig = {};
    }
    window.shopConfig.telegramBotToken = token;
    window.shopConfig.telegramChatId = chatId;
    window.shopConfig.telegramShiftCloseToken = shiftCloseToken || '';
    window.shopConfig.telegramWarningToken = warningToken || '';
    window.shopConfig.telegramExpenseToken = expenseToken || '';

    // Ghi lên Firebase để đồng bộ
    var shopId = localStorage.getItem('current_shop_id') || 'shop_default';
    var fbRef = firebase.database().ref(shopId + '/info');
    fbRef.update({
        telegramBotToken: token,
        telegramChatId: chatId,
        telegramShiftCloseToken: shiftCloseToken || '',
        telegramWarningToken: warningToken || '',
        telegramExpenseToken: expenseToken || ''
    }).catch(function(err) {
    });

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '✅ Đã lưu cấu hình Telegram';
    showToast('✅ Đã lưu cấu hình Telegram', 'success');
}

function testTelegramConfig() {
    var token = localStorage.getItem('telegram_bot_token');
    var chatId = localStorage.getItem('telegram_chat_id');
    if (!token || !chatId) {
        showToast('⚠️ Chưa có cấu hình Telegram', 'warning');
        return;
    }

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '📨 Đang gửi tin nhắn thử...';

    var message = encodeURIComponent('🟢 *Tin nhắn thử từ POS* \n\nNếu bạn thấy tin nhắn này, cấu hình Telegram đã hoạt động!');
    var url = 'https://api.telegram.org/bot' + token + '/sendMessage?chat_id=' + chatId + '&text=' + message + '&parse_mode=Markdown';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 10000;

    xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
            if (statusEl) statusEl.textContent = '✅ Gửi thử thành công!';
            showToast('✅ Gửi tin nhắn thử thành công', 'success');
        } else {
            if (statusEl) statusEl.textContent = '❌ Lỗi: ' + xhr.status;
            showToast('❌ Gửi thử thất bại (HTTP ' + xhr.status + ')', 'error');
        }
    };

    xhr.onerror = function() {
        if (statusEl) statusEl.textContent = '❌ Không thể kết nối Telegram';
        showToast('❌ Không thể kết nối Telegram API', 'error');
    };

    xhr.ontimeout = function() {
        if (statusEl) statusEl.textContent = '❌ Hết thời gian chờ';
        showToast('❌ Hết thời gian chờ kết nối Telegram', 'error');
    };

    xhr.send();
}

function clearTelegramConfig() {
    if (!confirm('Xóa cấu hình Telegram?')) return;
    localStorage.removeItem('telegram_bot_token');
    localStorage.removeItem('telegram_chat_id');
    localStorage.removeItem('telegram_bot_name');
    localStorage.removeItem('telegram_shift_close_token');
    localStorage.removeItem('telegram_warning_token');
    localStorage.removeItem('telegram_expense_token');

    document.getElementById('telegramBotToken').value = '';
    document.getElementById('telegramChatId').value = '';
    document.getElementById('telegramBotName').value = '';
    document.getElementById('telegramShiftCloseToken').value = '';
    document.getElementById('telegramWarningToken').value = '';
    document.getElementById('telegramExpenseToken').value = '';

    var statusEl = document.getElementById('telegramConfigStatus');
    if (statusEl) statusEl.textContent = '🗑️ Đã xóa cấu hình Telegram';
    showToast('🗑️ Đã xóa cấu hình Telegram', 'info');
}

// ============================================================
// 5b. CẤU HÌNH KHÓA BÀN & THỜI GIAN
// ============================================================

function loadLockConfig() {
    try {
        var info = window.shopInfo || {};
        var startHourInput = document.getElementById('settingsLockStartHour');
        if (startHourInput) startHourInput.value = info.lockStartHour !== undefined ? info.lockStartHour : '';

        var endHourInput = document.getElementById('settingsLockEndHour');
        if (endHourInput) endHourInput.value = info.lockEndHour !== undefined ? info.lockEndHour : '';

        var endMinuteInput = document.getElementById('settingsLockEndMinute');
        if (endMinuteInput) endMinuteInput.value = info.lockEndMinute !== undefined ? info.lockEndMinute : '';

        var tableLockInput = document.getElementById('settingsTableLockHours');
        if (tableLockInput) tableLockInput.value = info.tableLockHours !== undefined ? info.tableLockHours : '';

        var lockPassInput = document.getElementById('settingsLockPassword');
        if (lockPassInput) lockPassInput.value = info.lockPassword || '';
    } catch(e) {
    }
}

function saveLockConfig() {
    var startHour = document.getElementById('settingsLockStartHour').value.trim();
    var endHour = document.getElementById('settingsLockEndHour').value.trim();
    var endMinute = document.getElementById('settingsLockEndMinute').value.trim();
    var tableLockHours = document.getElementById('settingsTableLockHours').value.trim();
    var lockPassword = document.getElementById('settingsLockPassword').value.trim();

    // Validate
    if (startHour) {
        var sh = parseInt(startHour, 10);
        if (isNaN(sh) || sh < 0 || sh > 23) {
            showToast('⚠️ Giờ mở quán không hợp lệ (0-23)', 'warning');
            return;
        }
    }
    if (endHour) {
        var eh = parseInt(endHour, 10);
        if (isNaN(eh) || eh < 0 || eh > 23) {
            showToast('⚠️ Giờ đóng quán không hợp lệ (0-23)', 'warning');
            return;
        }
    }
    if (endMinute) {
        var em = parseInt(endMinute, 10);
        if (isNaN(em) || em < 0 || em > 59) {
            showToast('⚠️ Phút đóng quán không hợp lệ (0-59)', 'warning');
            return;
        }
    }
    if (tableLockHours) {
        var tlh = parseInt(tableLockHours, 10);
        if (isNaN(tlh) || tlh < 1 || tlh > 24) {
            showToast('⚠️ Thời gian ngồi tối đa không hợp lệ (1-24)', 'warning');
            return;
        }
    }

    // Các key này nằm trực tiếp trong info/{shopId} trên Firebase (cùng cấp với name, code)
    // Ghi trực tiếp lên Firebase để đảm bảo đúng path
    var shopId = localStorage.getItem('current_shop_id') || 'shop_default';
    var fbRef = firebase.database().ref(shopId + '/info');
    var updates = {};
    if (startHour) updates.lockStartHour = parseInt(startHour, 10);
    if (endHour) updates.lockEndHour = parseInt(endHour, 10);
    if (endMinute) updates.lockEndMinute = parseInt(endMinute, 10);
    if (tableLockHours) updates.tableLockHours = parseInt(tableLockHours, 10);
    if (lockPassword) updates.lockPassword = lockPassword;

    fbRef.update(updates).then(function() {
        // Cập nhật shopInfo và shopConfig ngay lập tức
        if (window.shopInfo) {
            for (var k in updates) window.shopInfo[k] = updates[k];
        }
        if (window.shopConfig) {
            for (var k in updates) window.shopConfig[k] = updates[k];
        }
        var statusEl = document.getElementById('lockConfigStatus');
        if (statusEl) statusEl.textContent = '✅ Đã lưu cấu hình khóa bàn & thời gian';
        showToast('✅ Đã lưu cấu hình khóa bàn & thời gian', 'success');
    }).catch(function(err) {
        showToast('❌ Lỗi lưu cấu hình', 'error');
    });
}

// ============================================================
// 6. PHÂN QUYỀN NHÂN VIÊN (Staff Permission)
//    Đã chuyển sang employees.js
//    Các hàm này là wrapper để tránh xung đột tên
// ============================================================

// employees.js đã định nghĩa và export các hàm:
//   loadStaffPermissionList, toggleStaffRole, createNewStaff, deleteStaff
// Settings.js chỉ gọi lại qua window để tránh đệ quy

function loadStaffPermissionList() {
    // Gọi implementation từ employees.js qua tên khác để tránh đệ quy
    if (typeof window._empLoadStaffPermList === 'function') {
        window._empLoadStaffPermList();
    }
}

function toggleStaffRole(staffId, currentRole) {
    if (typeof window._empToggleRole === 'function') {
        window._empToggleRole(staffId, currentRole);
    }
}

function createNewStaff() {
    if (typeof window._empCreateStaff === 'function') {
        window._empCreateStaff();
    }
}

function deleteStaff(staffId, staffName) {
    if (typeof window._empDeleteStaff === 'function') {
        window._empDeleteStaff(staffId, staffName);
    }
}

// ============================================================
// 7. ESCAPE HELPER
// ============================================================

function escapeJsString(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'")
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&')
              .replace(/</g, '<')
              .replace(/>/g, '>')
              .replace(/"/g, '"')
              .replace(/'/g, '&#039;');
}

// ============================================================
// 4. SO SÁNH PHIÊN BẢN (Version Compare)
// ============================================================

function compareVersions(v1, v2) {
    var parts1 = v1.split('.').map(Number);
    var parts2 = v2.split('.').map(Number);
    for (var i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        var n1 = parts1[i] || 0;
        var n2 = parts2[i] || 0;
        if (n1 > n2) return 1;
        if (n1 < n2) return -1;
    }
    return 0;
}

// ============================================================
// 6b. TỰ ĐỘNG FIX DỮ LIỆU CŨ: cashKept CHO CÁC NGÀY ĐÃ CHỐT
// ============================================================
// Trước đây khi chốt ngày không lưu cashKept, khiến số dư đầu kỳ ngày hôm sau = 0.
// Hàm này dò tìm các ngày đã chốt nhưng thiếu cashKept và tự động điền.
// Chạy 1 lần khi khởi tạo, không ảnh hưởng hiệu năng.

function fixMissingCashKept() {
    try {
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var dbRef = firebase.database().ref(shopId + '/daily_balances');

        // Đọc tất cả daily_balances để tìm ngày thiếu cashKept
        dbRef.once('value').then(function(snapshot) {
            var allBalances = snapshot.val() || {};
            var fixedCount = 0;

            // Chuyển object thành mảng và sắp xếp theo ngày tăng dần
            var dates = Object.keys(allBalances).sort();

            for (var di = 0; di < dates.length; di++) {
                var dateKey = dates[di];
                var balance = allBalances[dateKey];

                // Chỉ fix những ngày đã chốt (isClosed === true) nhưng thiếu cashKept
                if (balance && balance.isClosed === true) {
                    if (balance.cashKept === undefined || balance.cashKept === null) {
                        // Tính cashKept = expectedClosing (đã lưu) hoặc actualClosing hoặc difference
                        // expectedClosing = openingBalance + cashRevenue - posCashExpense - managerPickupTotal
                        // Nhưng nếu không có expectedClosing, thử dùng actualClosing
                        var cashKeptValue = null;

                        if (balance.expectedClosing !== undefined && balance.expectedClosing !== null) {
                            // expectedClosing đã là số tiền dự kiến còn trong két
                            // Nếu difference = 0 (cân bằng) thì cashKept = expectedClosing
                            // Nếu difference != 0 thì cashKept = expectedClosing + difference
                            var diff = (balance.difference !== undefined && balance.difference !== null) ? balance.difference : 0;
                            cashKeptValue = balance.expectedClosing + diff;
                        } else if (balance.actualClosing !== undefined && balance.actualClosing !== null) {
                            cashKeptValue = balance.actualClosing;
                        } else if (balance.difference !== undefined && balance.difference !== null) {
                            // Nếu chỉ có difference, không đủ để tính, bỏ qua
                            continue;
                        }

                        if (cashKeptValue !== null && cashKeptValue >= 0) {
                            // Ghi cashKept lên Firebase
                            var dateRef = dbRef.child(dateKey);
                            dateRef.update({ cashKept: cashKeptValue });
                            fixedCount++;
                        }
                    }
                }
            }

            if (fixedCount > 0) {
                // Reload lại dữ liệu để UI cập nhật
                loadPosCashData();
            } else {
            }
        }).catch(function(err) {
        });
    } catch(e) {
    }
}

// ============================================================
// 7. CẤU HÌNH ESP32 (KÉT TIỀN)
// ============================================================

/**
 * Lấy shopId cho ESP32 config
 */
function _getEsp32ShopId() {
    return localStorage.getItem('current_shop_id') || 'shop_default';
}

/**
 * Toggle hiển thị Telegram token trong phần ESP32
 */
function toggleEsp32TelegramToken() {
    var input = document.getElementById('esp32TelegramToken');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
}

/**
 * Lưu cấu hình ESP32 lên Firebase
 * ESP32 sẽ đọc cấu hình này khi khởi động thay vì hardcode
 */
function saveEsp32Config() {
    var ssid = document.getElementById('esp32WifiSsid').value.trim();
    var password = document.getElementById('esp32WifiPassword').value.trim();
    var fbHost = document.getElementById('esp32FirebaseHost').value.trim();
    var shopId = document.getElementById('esp32ShopId').value.trim();
    var tgToken = document.getElementById('esp32TelegramToken').value.trim();
    var tgChatId = document.getElementById('esp32TelegramChatId').value.trim();

    if (!ssid) {
        showToast('⚠️ Vui lòng nhập WiFi SSID', 'warning');
        return;
    }
    if (!password) {
        showToast('⚠️ Vui lòng nhập WiFi Password', 'warning');
        return;
    }
    if (!fbHost) {
        showToast('⚠️ Vui lòng nhập Firebase Host', 'warning');
        return;
    }

    var config = {
        wifi: {
            ssid: ssid,
            password: password
        },
        firebase: {
            host: fbHost,
            shopId: shopId || 'shop_default'
        },
        telegram: {
            token: tgToken || '',
            chatId: tgChatId || ''
        },
        updatedAt: new Date().toISOString(),
        updatedBy: (function() {
            try {
                var s = localStorage.getItem('pos_session');
                if (s) {
                    var u = JSON.parse(s);
                    return u.displayName || u.username || 'admin';
                }
            } catch(e) {}
            return 'admin';
        })()
    };

    var statusEl = document.getElementById('esp32ConfigStatus');
    if (statusEl) statusEl.textContent = '⏳ Đang lưu...';

    var currentShopId = _getEsp32ShopId();
    var dbRef = firebase.database().ref(currentShopId + '/esp32_config');

    dbRef.set(config).then(function() {
        if (statusEl) statusEl.textContent = '✅ Đã lưu cấu hình ESP32';
        showToast('✅ Đã lưu cấu hình ESP32', 'success');
    }).catch(function(err) {
        if (statusEl) statusEl.textContent = '❌ Lỗi: ' + err.message;
        showToast('❌ Lỗi lưu cấu hình ESP32', 'error');
    });
}

/**
 * Tải cấu hình ESP32 từ Firebase và điền vào form
 */
function loadEsp32Config() {
    var statusEl = document.getElementById('esp32ConfigStatus');
    if (statusEl) statusEl.textContent = '⏳ Đang tải...';

    var currentShopId = _getEsp32ShopId();
    var dbRef = firebase.database().ref(currentShopId + '/esp32_config');

    dbRef.once('value').then(function(snapshot) {
        var config = snapshot.val();
        if (!config) {
            if (statusEl) statusEl.textContent = 'ℹ️ Chưa có cấu hình ESP32';
            return;
        }

        // Điền WiFi
        var ssidEl = document.getElementById('esp32WifiSsid');
        if (ssidEl && config.wifi) ssidEl.value = config.wifi.ssid || '';

        var passEl = document.getElementById('esp32WifiPassword');
        if (passEl && config.wifi) passEl.value = config.wifi.password || '';

        // Điền Firebase
        var fbHostEl = document.getElementById('esp32FirebaseHost');
        if (fbHostEl && config.firebase) fbHostEl.value = config.firebase.host || '';

        var shopIdEl = document.getElementById('esp32ShopId');
        if (shopIdEl && config.firebase) shopIdEl.value = config.firebase.shopId || '';

        // Điền Telegram
        var tgTokenEl = document.getElementById('esp32TelegramToken');
        if (tgTokenEl && config.telegram) tgTokenEl.value = config.telegram.token || '';

        var tgChatIdEl = document.getElementById('esp32TelegramChatId');
        if (tgChatIdEl && config.telegram) tgChatIdEl.value = config.telegram.chatId || '';

        if (statusEl) {
            var updated = config.updatedAt ? ' (cập nhật: ' + new Date(config.updatedAt).toLocaleString('vi-VN') + ')' : '';
            statusEl.textContent = '✅ Đã tải cấu hình' + updated;
        }
        showToast('✅ Đã tải cấu hình ESP32', 'success');
    }).catch(function(err) {
        if (statusEl) statusEl.textContent = '❌ Lỗi: ' + err.message;
        showToast('❌ Lỗi tải cấu hình ESP32', 'error');
    });
}

/**
 * Xóa cấu hình ESP32 khỏi Firebase
 */
function clearEsp32Config() {
    if (!confirm('Xóa cấu hình ESP32? ESP32 sẽ không thể kết nối nếu chưa có cấu hình mới.')) return;

    var statusEl = document.getElementById('esp32ConfigStatus');
    if (statusEl) statusEl.textContent = '⏳ Đang xóa...';

    var currentShopId = _getEsp32ShopId();
    var dbRef = firebase.database().ref(currentShopId + '/esp32_config');

    dbRef.remove().then(function() {
        // Xóa các field trên form
        var ids = ['esp32WifiSsid', 'esp32WifiPassword', 'esp32FirebaseHost',
                   'esp32ShopId', 'esp32TelegramToken', 'esp32TelegramChatId'];
        ids.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });

        if (statusEl) statusEl.textContent = '🗑️ Đã xóa cấu hình ESP32';
        showToast('🗑️ Đã xóa cấu hình ESP32', 'info');
    }).catch(function(err) {
        if (statusEl) statusEl.textContent = '❌ Lỗi: ' + err.message;
        showToast('❌ Lỗi xóa cấu hình ESP32', 'error');
    });
}

/**
 * Xóa toàn bộ IndexedDB và tải lại trang từ Firebase
 * Dùng khi dữ liệu cache hiển thị không chính xác
 */
function clearIndexedDB() {
    if (!confirm('⚠️ Xóa toàn bộ dữ liệu cache trên trình duyệt?\n\n' +
                 '• Dữ liệu trên Firebase KHÔNG bị ảnh hưởng\n' +
                 '• Trang sẽ tự động tải lại để đồng bộ từ Firebase\n\n' +
                 'Tiếp tục?')) return;

    showToast('⏳ Đang xóa cache...', 'info', 0);

    // Xóa IndexedDB
    if (window.indexedDB && indexedDB.databases) {
        indexedDB.databases().then(function(list) {
            list.forEach(function(db) {
                if (db.name) {
                    indexedDB.deleteDatabase(db.name);
                }
            });
            // Force reload sau khi xóa
            setTimeout(function() {
                location.reload(true);
            }, 500);
        }).catch(function() {
            // Fallback: xóa các database phổ biến của POS
            var names = ['posDB', 'PosDB', 'pos_db', 'firebase', 'firebase-db'];
            names.forEach(function(n) {
                indexedDB.deleteDatabase(n);
            });
            setTimeout(function() {
                location.reload(true);
            }, 500);
        });
    } else {
        // Fallback cho trình duyệt cũ không hỗ trợ indexedDB.databases()
        var names = ['posDB', 'PosDB', 'pos_db', 'firebase', 'firebase-db'];
        names.forEach(function(n) {
            indexedDB.deleteDatabase(n);
        });
        setTimeout(function() {
            location.reload(true);
        }, 500);
    }
}

// ========== MODAL BÀN ĐANG HOẠT ĐỘNG (copy từ report.js) ==========
function showActiveTablesModal() {
    DB.getAll('tables').then(function(allTables) {
        var activeTables = allTables.filter(function(t) { return (t.items && t.items.length) || t.total > 0; });
        
        var modalId = 'activeTablesModal_' + Date.now();
        var html = '<div class="modal" id="' + modalId + '">' +
            '<div class="modal-content" style="max-width:600px;">' +
                '<div class="modal-header">' +
                    '<span class="modal-title">🪑 Bàn đang hoạt động</span>' +
                    '<span class="modal-close" onclick="closeModal(\'' + modalId + '\')">&times;</span>' +
                '</div>' +
                '<div class="modal-body" style="max-height:70vh;overflow-y:auto;padding:6px 0;">';
        
        if (activeTables.length === 0) {
            html += '<div class="empty-state" style="text-align:center;padding:40px 16px;color:#94a3b8;font-size:15px;">✅ Không có bàn nào đang hoạt động</div>';
        } else {
            var grandTotal = 0;
            
            // Bọc trong grid
            html += '<div class="atm-grid">';
            
            for (var i = 0; i < activeTables.length; i++) {
                var t = activeTables[i];
                grandTotal += t.total || 0;
                
                var tableName = (t.name && t.name.trim()) ? t.name : 'Bàn ' + t.id;
                
                // Thời gian
                var startTimeStr = '';
                var durationStr = '';
                if (t.startTime) {
                    var st = new Date(t.startTime);
                    startTimeStr = ('0' + st.getHours()).slice(-2) + ':' + ('0' + st.getMinutes()).slice(-2);
                    var elapsed = Math.floor((Date.now() - st.getTime()) / 60000);
                    if (elapsed < 60) {
                        durationStr = elapsed + 'p';
                    } else {
                        durationStr = Math.floor(elapsed / 60) + 'h' + (elapsed % 60) + 'p';
                    }
                }
                
                var creatorStr = t.createdByName || '';
                
                // Card bàn
                html += '<div class="atm-card">';
                html += '  <div class="atm-card-header">';
                html += '    <span class="atm-card-name">🪑 ' + escapeHtml(tableName) + '</span>';
                html += '    <span class="atm-card-total">' + formatMoney(t.total || 0) + '</span>';
                html += '  </div>';
                html += '  <div class="atm-card-meta">🕐 ' + startTimeStr + ' - ' + durationStr + '</div>';
                if (creatorStr) {
                    html += '  <div class="atm-card-meta">👤 ' + escapeHtml(creatorStr) + '</div>';
                }
                
                // Danh sách món
                var items = t.items || [];
                if (items.length > 0) {
                    html += '  <div class="atm-items">';
                    for (var j = 0; j < items.length; j++) {
                        var item = items[j];
                        var itemName = item.name || '';
                        var itemQty = item.qty || 0;
                        var itemPrice = item.price || 0;
                        var itemTotal = itemQty * itemPrice;
                        html += '    <div class="atm-item">';
                        html += '      <span class="atm-item-name">' + escapeHtml(itemName) + '</span>';
                        html += '      <span class="atm-item-qty">x' + itemQty + '</span>';
                        html += '      <span class="atm-item-total">' + formatMoney(itemTotal) + '</span>';
                        html += '    </div>';
                    }
                    html += '  </div>';
                }
                
                html += '</div>';
            }
            
            html += '</div>'; // end atm-grid
            
            // Tổng kết
            html += '<div class="atm-grand-total">' +
                        '<span>📊 Tổng tiền bàn</span>' +
                        '<span>' + formatMoney(grandTotal) + '</span>' +
                    '</div>';
        }
        
        html += '    </div>' +
            '</div>' +
        '</div>';
        
        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
        openBottomSheet(modalId);
    });
}

// ========== IN PHIẾU QUẢN LÝ NHẬN TIỀN ==========
function printManagerPickup() {
    var data = _posCashData;
    if (!data || !data.pickupHistory || data.pickupHistory.length === 0) {
        showToast('⚠️ Không có dữ liệu QL nhận tiền', 'warning');
        return;
    }

    // Dùng ngày đã chọn (nếu có) để in theo ngày tương ứng
    var targetDate = _selectedCloseDate || data.dateKey || getTodayDateKey();
    var dateLabel = formatDateDisplay(targetDate);

    // Lấy số tiền POS còn lại sau lần nhận cuối cùng (từ Firebase)
    var lastPickup = data.pickupHistory[data.pickupHistory.length - 1];
    var currentPosCash = (lastPickup && lastPickup.remainingPosCash !== undefined) ? lastPickup.remainingPosCash : data.expectedClosing;

    // Tạo nội dung in
    var lines = [];
    lines.push('================================');
    lines.push('   QUẢN LÝ NHẬN TIỀN');
    lines.push('   Ngày: ' + dateLabel);
    lines.push('================================');
    lines.push('');
    lines.push('  Số dư đầu kỳ: ' + formatMoney(data.openingBalance || 0));
    lines.push('');

    for (var i = 0; i < data.pickupHistory.length; i++) {
        var ph = data.pickupHistory[i];
        var timeStr = '';
        if (ph.createdAt) {
            var d = new Date(ph.createdAt);
            timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        }
        lines.push('  Lần ' + (i + 1) + ' - ' + timeStr);
        lines.push('  QL nhận: ' + formatMoney(ph.amount));
        lines.push('  ------------------------------');
    }

    lines.push('');
    lines.push('  Số tiền QL nhận: ' + formatMoney(data.managerPickupTotal));
    lines.push('  Số tiền tại POS: ' + formatMoney(currentPosCash));
    lines.push('');
    lines.push('================================');
    lines.push('  ' + new Date().toLocaleString('vi-VN'));
    lines.push('================================');

    var text = lines.join('\n');

    // Hiển thị popup modal để in / xem
    var modalId = 'printPickupModal';
    var html = '<div id="' + modalId + '" class="modal" onclick="if(event.target===this)window.closeModal(\'' + modalId + '\')">' +
        '<div class="modal-content" style="max-width:400px;">' +
        '<div class="modal-header">' +
            '<span class="modal-title">🖨️ Phiếu QL nhận tiền</span>' +
            '<span class="modal-close" onclick="window.closeModal(\'' + modalId + '\')">&times;</span>' +
        '</div>' +
        '<div class="modal-body">' +
            '<pre style="font-family:monospace;font-size:13px;line-height:1.6;background:#f8f9fa;padding:16px;border-radius:8px;white-space:pre-wrap;word-break:break-word;margin:0;">' + text + '</pre>' +
            '<div style="display:flex;gap:8px;margin-top:12px;">' +
                '<button class="cash-action-btn" style="flex:1;padding:10px;background:#2c3e50;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;" onclick="printPickupContent(\'' + modalId + '\')">🖨️ In</button>' +
                '<button class="cash-action-btn" style="flex:1;padding:10px;background:#3498db;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;" onclick="copyPickupContent()">📋 Sao chép</button>' +
            '</div>' +
        '</div>' +
        '</div>' +
    '</div>';

    // Xóa modal cũ nếu còn (tránh cache khi chọn ngày khác)
    var oldModal = document.getElementById(modalId);
    if (oldModal) oldModal.parentNode.removeChild(oldModal);

    var div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
    openBottomSheet(modalId);
}

// Sao chép nội dung phiếu QL nhận tiền
function copyPickupContent() {
    var data = _posCashData;
    if (!data || !data.pickupHistory) return;

    var today = data.dateKey || getTodayDateKey();
    var dateLabel = formatDateDisplay(today);

    // Lấy số tiền POS còn lại sau lần nhận cuối cùng (từ Firebase)
    var lastPickup = data.pickupHistory[data.pickupHistory.length - 1];
    var currentPosCash = (lastPickup && lastPickup.remainingPosCash !== undefined) ? lastPickup.remainingPosCash : data.expectedClosing;

    var lines = [];
    lines.push('QUẢN LÝ NHẬN TIỀN');
    lines.push('Ngày: ' + dateLabel);
    lines.push('');
    lines.push('Số dư đầu kỳ: ' + formatMoney(data.openingBalance || 0));
    lines.push('');

    for (var i = 0; i < data.pickupHistory.length; i++) {
        var ph = data.pickupHistory[i];
        var timeStr = '';
        if (ph.createdAt) {
            var d = new Date(ph.createdAt);
            timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        }
        lines.push('  Lần ' + (i + 1) + ' - ' + timeStr + ': ' + formatMoney(ph.amount));
    }

    lines.push('');
    lines.push('Số tiền QL nhận: ' + formatMoney(data.managerPickupTotal));
    lines.push('Số tiền tại POS: ' + formatMoney(currentPosCash));

    var text = lines.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            showToast('✅ Đã sao chép', 'success');
        }).catch(function() {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

// In nội dung phiếu QL nhận tiền qua máy in nhiệt (dùng print.js)
function printPickupContent(modalId) {
    var data = _posCashData;
    if (!data || !data.pickupHistory) return;

    var today = data.dateKey || getTodayDateKey();
    var dateLabel = formatDateDisplay(today);

    // Lấy số tiền POS còn lại sau lần nhận cuối cùng (từ Firebase)
    var lastPickup = data.pickupHistory[data.pickupHistory.length - 1];
    var currentPosCash = (lastPickup && lastPickup.remainingPosCash !== undefined) ? lastPickup.remainingPosCash : data.expectedClosing;

    var textLines = [];
    textLines.push('================================');
    textLines.push('   QUAN LY NHAN TIEN');
    textLines.push('   Ngay: ' + dateLabel);
    textLines.push('================================');
    textLines.push('');
    textLines.push('  So du dau ky: ' + formatMoney(data.openingBalance || 0));
    textLines.push('');

    for (var i = 0; i < data.pickupHistory.length; i++) {
        var ph = data.pickupHistory[i];
        var timeStr = '';
        if (ph.createdAt) {
            var d = new Date(ph.createdAt);
            timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
        }
        textLines.push('  Lan ' + (i + 1) + ' - ' + timeStr);
        textLines.push('  QL nhan: ' + formatMoney(ph.amount));
        textLines.push('  ------------------------------');
    }

    textLines.push('');
    textLines.push('  So tien QL nhan: ' + formatMoney(data.managerPickupTotal));
    textLines.push('  So tien tai POS: ' + formatMoney(currentPosCash));
    textLines.push('');
    textLines.push('================================');
    textLines.push('  ' + new Date().toLocaleString('vi-VN'));
    textLines.push('================================');

    var text = textLines.join('\n');

    // Đóng modal
    closeModal(modalId);

    // Dùng printViaSunmi từ print.js với data.text
    if (typeof printViaSunmi === 'function') {
        printViaSunmi({ text: text }).then(function() {
            showToast('✅ Da in phieu QL nhan tien', 'success');
        }).catch(function(err) {
            console.warn('Print pickup failed:', err);
            showToast('⚠️ In that bai: ' + (err ? err.message : 'Loi'), 'error');
        });
    } else {
        // Fallback: mở cửa sổ in mới
        var printWindow = window.open('', '_blank', 'width=300,height=600');
        if (printWindow) {
            printWindow.document.write('<html><head><title>In phieu QL nhan tien</title>');
            printWindow.document.write('<style>body{font-family:monospace;font-size:13px;padding:16px;white-space:pre-wrap;}@media print{@page{margin:0;}}</style>');
            printWindow.document.write('</head><body>');
            printWindow.document.write('<pre>' + text + '</pre>');
            printWindow.document.write('<script>window.onload=function(){window.print();window.close();}<\/script>');
            printWindow.document.write('</body></html>');
            printWindow.document.close();
        } else {
            showToast('⚠️ Khong the mo cua so in. Hay sao chep noi dung.', 'warning');
        }
    }
}

// ========== IN PHIẾU CHỐT CA CHO NHÂN VIÊN ==========
function printStaffCloseReceipt() {
    var data = _posCashData;
    if (!data || !data.isClosed) {
        showToast('⚠️ Chưa chốt ngày, không thể in', 'warning');
        return;
    }

    // Dùng ngày đã chọn (nếu có) để in theo ngày tương ứng
    var targetDate = _selectedCloseDate || data.dateKey || getTodayDateKey();
    var dateLabel = formatDateDisplay(targetDate);

    var expectedClosing = (data.openingBalance || 0) + (data.cashRevenue || 0) - (data.posCashExpense || 0) - (data.managerPickupTotal || 0);
    var countedTotal = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        countedTotal += CASH_DENOMS[i].value * (cashCounts[CASH_DENOMS[i].value] || 0);
    }
    // Nếu đã chốt, dùng cashKept thay vì countedTotal (số đã chốt)
    var actualCash = (data.cashKept !== null && data.cashKept !== undefined) ? data.cashKept : (countedTotal > 0 ? countedTotal : expectedClosing);
    var diff = data.difference !== null && data.difference !== undefined ? data.difference : (actualCash - expectedClosing);

    var textLines = [];
    textLines.push('================================');
    textLines.push('   PHIEU CHOT CA');
    textLines.push('   Ngay: ' + dateLabel);
    textLines.push('================================');
    textLines.push('');

    // Thời gian chốt
    if (data.closedAtTime) {
        textLines.push('  Thoi gian chot: ' + data.closedAtTime);
        textLines.push('');
    }

    textLines.push('  --- DOANH THU ---');
    textLines.push('  Tong doanh thu: ' + formatMoney(data.totalRevenue));
    textLines.push('  Tien mat: ' + formatMoney(data.cashRevenue));
    textLines.push('  Chuyen khoan: ' + formatMoney(data.transferAmount));
    textLines.push('  Grab: ' + formatMoney(data.grabAmount));
    if (data.debtAmount > 0) {
        textLines.push('  No trong ngay: ' + formatMoney(data.debtAmount));
    }
    textLines.push('');

    textLines.push('  --- THONG TIN ---');
    textLines.push('  So du dau ky: ' + formatMoney(data.openingBalance));
    textLines.push('  Chi phi Ket POS: ' + formatMoney(data.posCashExpense));
    textLines.push('  QL nhan: ' + formatMoney(data.managerPickupTotal));
    textLines.push('');

    textLines.push('  --- KET QUA CHOT ---');
    textLines.push('  So tien dem duoc tai POS: ' + formatMoney(actualCash));
    textLines.push('  So tien du kien con lai: ' + formatMoney(expectedClosing));
    var diffSign = diff >= 0 ? '+' : '';
    textLines.push('  Chenh lech: ' + diffSign + formatMoney(diff));
    textLines.push('');

    textLines.push('================================');
    // Dùng targetDate để hiển thị ngày in đúng với ngày đã chọn
    var printTime = targetDate === getTodayDateKey() ? new Date().toLocaleString('vi-VN') : formatDateDisplay(targetDate) + ' 23:59';
    textLines.push('  ' + printTime);
    textLines.push('================================');

    var text = textLines.join('\n');

    // Hiển thị popup modal để in / xem trước
    var modalId = 'printStaffCloseModal';
    var html = '<div id="' + modalId + '" class="modal" onclick="if(event.target===this)window.closeModal(\'' + modalId + '\')">' +
        '<div class="modal-content" style="max-width:400px;">' +
        '<div class="modal-header">' +
            '<span class="modal-title">🖨️ Phiếu chốt ca</span>' +
            '<span class="modal-close" onclick="window.closeModal(\'' + modalId + '\')">&times;</span>' +
        '</div>' +
        '<div class="modal-body">' +
            '<pre style="font-family:monospace;font-size:13px;line-height:1.6;background:#f8f9fa;padding:16px;border-radius:8px;white-space:pre-wrap;word-break:break-word;margin:0;">' + text + '</pre>' +
            '<div style="display:flex;gap:8px;margin-top:12px;">' +
                '<button class="cash-action-btn" style="flex:1;padding:10px;background:#2c3e50;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;" onclick="printStaffCloseContent(\'' + modalId + '\')">🖨️ In</button>' +
                '<button class="cash-action-btn" style="flex:1;padding:10px;background:#3498db;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:14px;" onclick="copyStaffCloseContent()">📋 Sao chép</button>' +
            '</div>' +
        '</div>' +
        '</div>' +
    '</div>';

    // Xóa modal cũ nếu còn (tránh cache khi chọn ngày khác)
    var oldModal = document.getElementById(modalId);
    if (oldModal) oldModal.parentNode.removeChild(oldModal);

    var div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
    openBottomSheet(modalId);
}

// In nội dung phiếu chốt ca qua máy in nhiệt
function printStaffCloseContent(modalId) {
    var data = _posCashData;
    if (!data || !data.isClosed) return;

    var targetDate = _selectedCloseDate || data.dateKey || getTodayDateKey();
    var dateLabel = formatDateDisplay(targetDate);

    var expectedClosing = (data.openingBalance || 0) + (data.cashRevenue || 0) - (data.posCashExpense || 0) - (data.managerPickupTotal || 0);
    var countedTotal = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        countedTotal += CASH_DENOMS[i].value * (cashCounts[CASH_DENOMS[i].value] || 0);
    }
    var actualCash = (data.cashKept !== null && data.cashKept !== undefined) ? data.cashKept : (countedTotal > 0 ? countedTotal : expectedClosing);
    var diff = data.difference !== null && data.difference !== undefined ? data.difference : (actualCash - expectedClosing);

    var textLines = [];
    textLines.push('================================');
    textLines.push('   PHIEU CHOT CA');
    textLines.push('   Ngay: ' + dateLabel);
    textLines.push('================================');
    textLines.push('');

    if (data.closedAtTime) {
        textLines.push('  Thoi gian chot: ' + data.closedAtTime);
        textLines.push('');
    }

    textLines.push('  --- DOANH THU ---');
    textLines.push('  Tong doanh thu: ' + formatMoney(data.totalRevenue));
    textLines.push('  Tien mat: ' + formatMoney(data.cashRevenue));
    textLines.push('  Chuyen khoan: ' + formatMoney(data.transferAmount));
    textLines.push('  Grab: ' + formatMoney(data.grabAmount));
    if (data.debtAmount > 0) {
        textLines.push('  No trong ngay: ' + formatMoney(data.debtAmount));
    }
    textLines.push('');

    textLines.push('  --- THONG TIN ---');
    textLines.push('  So du dau ky: ' + formatMoney(data.openingBalance));
    textLines.push('  Chi phi Ket POS: ' + formatMoney(data.posCashExpense));
    textLines.push('  QL nhan: ' + formatMoney(data.managerPickupTotal));
    textLines.push('');

    textLines.push('  --- KET QUA CHOT ---');
    textLines.push('  So tien dem duoc tai POS: ' + formatMoney(actualCash));
    textLines.push('  So tien du kien con lai: ' + formatMoney(expectedClosing));
    var diffSign = diff >= 0 ? '+' : '';
    textLines.push('  Chenh lech: ' + diffSign + formatMoney(diff));
    textLines.push('');

    textLines.push('================================');
    var printTime = targetDate === getTodayDateKey() ? new Date().toLocaleString('vi-VN') : formatDateDisplay(targetDate) + ' 23:59';
    textLines.push('  ' + printTime);
    textLines.push('================================');

    var text = textLines.join('\n');

    // Đóng modal
    closeModal(modalId);

    // In qua printViaSunmi
    if (typeof printViaSunmi === 'function') {
        printViaSunmi({ text: text }).then(function() {
            showToast('✅ Da in phieu chot ca', 'success');
        }).catch(function(err) {
            console.warn('Print staff close failed:', err);
            showToast('⚠️ In that bai: ' + (err ? err.message : 'Loi'), 'error');
        });
    } else {
        // Fallback: mo cua so in moi
        var printWindow = window.open('', '_blank', 'width=300,height=600');
        if (printWindow) {
            printWindow.document.write('<html><head><title>In phieu chot ca</title>');
            printWindow.document.write('<style>body{font-family:monospace;font-size:13px;padding:16px;white-space:pre-wrap;}@media print{@page{margin:0;}}</style>');
            printWindow.document.write('</head><body>');
            printWindow.document.write('<pre>' + text + '</pre>');
            printWindow.document.write('<script>window.onload=function(){window.print();window.close();}<\/script>');
            printWindow.document.write('</body></html>');
            printWindow.document.close();
        } else {
            showToast('⚠️ Khong the mo cua so in. Hay sao chep noi dung.', 'warning');
        }
    }
}

// Sao chép nội dung phiếu chốt ca
function copyStaffCloseContent() {
    var data = _posCashData;
    if (!data || !data.isClosed) return;

    var targetDate = _selectedCloseDate || data.dateKey || getTodayDateKey();
    var dateLabel = formatDateDisplay(targetDate);

    var expectedClosing = (data.openingBalance || 0) + (data.cashRevenue || 0) - (data.posCashExpense || 0) - (data.managerPickupTotal || 0);
    var countedTotal = 0;
    for (var i = 0; i < CASH_DENOMS.length; i++) {
        countedTotal += CASH_DENOMS[i].value * (cashCounts[CASH_DENOMS[i].value] || 0);
    }
    var actualCash = (data.cashKept !== null && data.cashKept !== undefined) ? data.cashKept : (countedTotal > 0 ? countedTotal : expectedClosing);
    var diff = data.difference !== null && data.difference !== undefined ? data.difference : (actualCash - expectedClosing);

    var lines = [];
    lines.push('PHIEU CHOT CA');
    lines.push('Ngay: ' + dateLabel);
    lines.push('');
    if (data.closedAtTime) {
        lines.push('Thoi gian chot: ' + data.closedAtTime);
        lines.push('');
    }
    lines.push('--- DOANH THU ---');
    lines.push('Tong doanh thu: ' + formatMoney(data.totalRevenue));
    lines.push('Tien mat: ' + formatMoney(data.cashRevenue));
    lines.push('Chuyen khoan: ' + formatMoney(data.transferAmount));
    lines.push('Grab: ' + formatMoney(data.grabAmount));
    if (data.debtAmount > 0) {
        lines.push('No trong ngay: ' + formatMoney(data.debtAmount));
    }
    lines.push('');
    lines.push('--- THONG TIN ---');
    lines.push('So du dau ky: ' + formatMoney(data.openingBalance));
    lines.push('Chi phi Ket POS: ' + formatMoney(data.posCashExpense));
    lines.push('QL nhan: ' + formatMoney(data.managerPickupTotal));
    lines.push('');
    lines.push('--- KET QUA CHOT ---');
    lines.push('So tien dem duoc tai POS: ' + formatMoney(actualCash));
    lines.push('So tien du kien con lai: ' + formatMoney(expectedClosing));
    var diffSign = diff >= 0 ? '+' : '';
    lines.push('Chenh lech: ' + diffSign + formatMoney(diff));

    var text = lines.join('\n');

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            showToast('✅ Da sao chep', 'success');
        }).catch(function() {
            fallbackCopy(text);
        });
    } else {
        fallbackCopy(text);
    }
}

/**
 * Toggle collapse/expand for settings sections
 * Called by onclick on .settings-title elements
 */
function toggleSettingsSection(titleEl) {
    var section = titleEl.parentNode;
    if (!section) return;
    var body = section.querySelector('.settings-section-body');
    var icon = titleEl.querySelector('.settings-toggle-icon');
    var isExpanded = section.classList.contains('expanded');
    if (isExpanded) {
        // Thu gọn
        section.classList.remove('expanded');
        if (body) body.style.display = 'none';
        if (icon) icon.textContent = '▶';
    } else {
        // Mở rộng
        section.classList.add('expanded');
        if (body) body.style.display = '';
        if (icon) icon.textContent = '▼';
    }
}

// ============================================================
// HIỂN THỊ DANH SÁCH GIAO DỊCH THEO PHƯƠNG THỨC THANH TOÁN
// ============================================================
// Khi click vào 💵 Tiền mặt / 💳 Chuyển khoản / 🛵 Grab / 📝 Nợ trong ngày
// Hiển thị modal danh sách: STT - Số tiền - SL món - Tên món
// ============================================================

// Map payment method code -> tên hiển thị và icon
var _paymentMethodLabels = {
    'cash': '💵 Tiền mặt',
    'transfer': '💳 Chuyển khoản',
    'grab': '🛵 Grab',
    'debt': '📝 Nợ',
    'debt_payment': '💳 Khách trả nợ',
    'prepaid': '💰 Khách đưa trước'
};

function showPaymentMethodTransactions(paymentMethod) {
    // Inject CSS cho pmtx modal nếu chưa có
    if (!document.getElementById('pmtx-style')) {
        var style = document.createElement('style');
        style.id = 'pmtx-style';
        style.textContent =
            '.pmtx-header,.pmtx-row,.pmtx-footer{display:flex;align-items:center;padding:6px 8px;gap:4px;}' +
            '.pmtx-header{background:#f8fafc;border-bottom:1px solid #e2e8f0;font-weight:600;font-size:12px;color:#64748b;position:sticky;top:0;z-index:1;}' +
            '.pmtx-row{cursor:pointer;border-bottom:1px solid #f1f5f9;transition:background 0.15s;}' +
            '.pmtx-row:hover{background:#f1f5f9;}' +
            '.pmtx-footer{background:#f8fafc;border-top:2px solid #e2e8f0;font-weight:600;font-size:13px;color:#1e293b;}' +
            '.pmtx-col-stt{flex:0 0 36px;text-align:center;font-size:11px;color:#94a3b8;}' +
            '.pmtx-col-time{flex:0 0 44px;text-align:center;font-size:12px;color:#64748b;}' +
            '.pmtx-col-source{flex:0 0 80px;text-align:left;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.pmtx-col-qty{flex:0 0 30px;text-align:center;font-size:12px;color:#64748b;}' +
            '.pmtx-col-items{flex:1;text-align:left;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px;}' +
            '.pmtx-col-amount{flex:0 0 90px;text-align:right;font-size:13px;font-weight:600;color:#0f172a;}';
        document.head.appendChild(style);
    }

    // Lấy ngày đang xem
    var targetDate = _selectedCloseDate || (_posCashData && _posCashData.dateKey) || getTodayDateKey();
    var methodLabel = _paymentMethodLabels[paymentMethod] || paymentMethod;

    // Đọc transactions từ IndexedDB theo ngày
    DB.getTransactionsByDate(targetDate).then(function(transactions) {
        if (!Array.isArray(transactions)) transactions = [];

        // Lọc theo phương thức thanh toán
        var filtered = transactions.filter(function(tx) {
            if (tx.refunded) return false;
            if (paymentMethod === 'debt') {
                // Nợ: type='debt_payment' && paymentMethod='debt' (ghi nợ)
                return tx.type === 'debt_payment' && tx.paymentMethod === 'debt';
            }
            if (paymentMethod === 'debt_payment') {
                // Khách trả nợ: type='debt_payment' && paymentMethod !== 'debt' (cash/transfer)
                return tx.type === 'debt_payment' && tx.paymentMethod !== 'debt';
            }
            if (paymentMethod === 'prepaid') {
                // Khách đưa trước: type='prepaid'
                return tx.type === 'prepaid';
            }
            // cash, transfer, grab: paymentMethod khớp
            // Chỉ loại trừ ghi nợ (type='debt_payment' && paymentMethod='debt')
            // Giữ lại trả nợ bằng tiền mặt/chuyển khoản (type='debt_payment' && paymentMethod='cash'|'transfer')
            return tx.paymentMethod === paymentMethod && !(tx.type === 'debt_payment' && tx.paymentMethod === 'debt');
        });

        // Sắp xếp theo thời gian giảm dần (mới nhất lên đầu)
        filtered.sort(function(a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        var modalId = 'paymentMethodTxModal_' + Date.now();
        var html = '<div class="modal" id="' + modalId + '">' +
            '<div class="modal-content" style="max-width:520px;">' +
                '<div class="modal-header">' +
                    '<span class="modal-title">' + methodLabel + ' - ' + formatDateDisplay(targetDate) + '</span>' +
                    '<span class="modal-close" onclick="closeModal(\'' + modalId + '\')">&times;</span>' +
                '</div>' +
                '<div class="modal-body" style="max-height:65vh;overflow-y:auto;padding:6px 0;">';

        if (filtered.length === 0) {
            html += '<div class="empty-state" style="text-align:center;padding:40px 16px;color:#94a3b8;font-size:15px;">📭 Không có giao dịch nào</div>';
        } else {
            // Header
            html += '<div class="pmtx-header">' +
                        '<span class="pmtx-col-stt">STT</span>' +
                        '<span class="pmtx-col-time">Giờ</span>' +
                        '<span class="pmtx-col-source">Nguồn</span>' +
                        '<span class="pmtx-col-qty">SL</span>' +
                        '<span class="pmtx-col-items">Món</span>' +
                        '<span class="pmtx-col-amount">Tiền</span>' +
                    '</div>';

            var grandTotal = 0;
            var grandCount = 0;

            for (var i = 0; i < filtered.length; i++) {
                var tx = filtered[i];
                var stt = i + 1;
                var amount = tx.amount || 0;
                grandTotal += amount;

                // Format giờ từ createdAt
                var timeStr = '';
                if (tx.createdAt) {
                    var d = new Date(tx.createdAt);
                    timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                }

                // Xác định nguồn gốc đơn hàng
                var sourceLabel = '';
                // Lấy tên khách hàng nếu có (cho giao dịch nợ)
                var customerName = '';
                if (tx.customer && tx.customer.name) {
                    customerName = escapeHtml(tx.customer.name);
                }
                if (tx.type === 'dinein') {
                    sourceLabel = '🪑 ' + escapeHtml(tx.tableName || 'Bàn');
                } else if (tx.type === 'takeaway') {
                    sourceLabel = '🛵 Mang đi';
                } else if (tx.type === 'debt_payment') {
                    // Hiển thị tên khách hàng cho giao dịch nợ
                    sourceLabel = '📝 ' + (customerName || (tx.paymentMethod === 'debt' ? 'Ghi nợ' : 'Trả nợ'));
                } else {
                    sourceLabel = tx.type || '';
                }

                // Gom các món thành chuỗi
                var itemsStr = '';
                var totalQty = 0;
                if (tx.items && tx.items.length) {
                    for (var j = 0; j < tx.items.length; j++) {
                        var item = tx.items[j];
                        totalQty += item.qty || 0;
                        itemsStr += escapeHtml(item.name);
                        if (j < tx.items.length - 1) itemsStr += ', ';
                    }
                } else {
                    itemsStr = '<span style="color:#94a3b8;font-style:italic;">(không có món)</span>';
                }
                grandCount += totalQty;

                // Tạo hàng có thể click để xem chi tiết
                html += '<div class="pmtx-row" onclick="showTransactionDetail(\'' + tx.id + '\')">' +
                            '<span class="pmtx-col-stt">#' + stt + '</span>' +
                            '<span class="pmtx-col-time">' + timeStr + '</span>' +
                            '<span class="pmtx-col-source">' + sourceLabel + '</span>' +
                            '<span class="pmtx-col-qty">' + totalQty + '</span>' +
                            '<span class="pmtx-col-items">' + itemsStr + '</span>' +
                            '<span class="pmtx-col-amount">' + formatMoney(amount) + '</span>' +
                        '</div>';
            }

            // Tổng kết
            html += '<div class="pmtx-footer">' +
                        '<span class="pmtx-col-stt"></span>' +
                        '<span class="pmtx-col-time"></span>' +
                        '<span class="pmtx-col-source"></span>' +
                        '<span class="pmtx-col-qty">' + grandCount + '</span>' +
                        '<span class="pmtx-col-items">Tổng cộng</span>' +
                        '<span class="pmtx-col-amount">' + formatMoney(grandTotal) + '</span>' +
                    '</div>';
        }

        html += '    </div>' +
            '</div>' +
        '</div>';

        // Xóa modal cũ cùng loại nếu còn
        var oldModals = document.querySelectorAll('[id^="paymentMethodTxModal_"]');
        for (var mi = 0; mi < oldModals.length; mi++) {
            if (oldModals[mi].parentNode) oldModals[mi].parentNode.removeChild(oldModals[mi]);
        }

        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
        openBottomSheet(modalId);
    }).catch(function(err) {
        showToast('❌ Lỗi tải dữ liệu giao dịch', 'error');
    });
}

// ============================================================
// HIỂN THỊ DANH SÁCH CHI PHÍ KÉT POS
// ============================================================
// Khi click vào 🏦 Chi phí Két POS
// Hiển thị modal danh sách: STT - Giờ - Số tiền - Nội dung chi
// ============================================================

function showPosCostTransactions() {
    var targetDate = _selectedCloseDate || (_posCashData && _posCashData.dateKey) || getTodayDateKey();

    // TỐI ƯU: Dùng cache _costTxCache nếu đã có (được cập nhật realtime qua child_* events)
    // Nếu cache chưa có, chỉ tải cost_transactions cho targetDate bằng orderByChild
    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var dbRef = firebase.database().ref(shopId);

    var costPromise;
    if (_costTxCacheLoaded && _costTxCache) {
        // Dùng cache đã có, filter client-side
        costPromise = Promise.resolve(_costTxCache);
    } else {
        // Chỉ tải các transaction có dateKey === targetDate (tiết kiệm băng thông)
        // Yêu cầu index .indexOn: "dateKey" trên node cost_transactions trong Firebase Rules
        costPromise = dbRef.child('cost_transactions').orderByChild('dateKey').equalTo(targetDate).once('value').then(function(snapshot) {
            return snapshot.val() || {};
        });
    }

    costPromise.then(function(allCostsSnapshot) {
        var allCosts = [];
        for (var key in allCostsSnapshot) {
            if (allCostsSnapshot.hasOwnProperty(key)) {
                var item = allCostsSnapshot[key];
                item.id = key;
                allCosts.push(item);
            }
        }

        // Lọc: cùng ngày, chưa xóa, nguồn từ Két POS
        // Nếu dùng cache, cần filter dateKey; nếu query Firebase có equalTo thì dateKey đã đúng
        var filtered = allCosts.filter(function(c) {
            return c.dateKey === targetDate && !c.deleted && c.fundSource === 'pos_cash';
        });

        // Sắp xếp theo thời gian giảm dần (mới nhất lên đầu)
        filtered.sort(function(a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
        });

        var modalId = 'posCostTxModal_' + Date.now();
        var html = '<div class="modal" id="' + modalId + '">' +
            '<div class="modal-content" style="max-width:520px;">' +
                '<div class="modal-header">' +
                    '<span class="modal-title">🏦 Chi phí Két POS - ' + formatDateDisplay(targetDate) + '</span>' +
                    '<span class="modal-close" onclick="closeModal(\'' + modalId + '\')">&times;</span>' +
                '</div>' +
                '<div class="modal-body" style="max-height:65vh;overflow-y:auto;padding:6px 0;">';

        if (filtered.length === 0) {
            html += '<div class="empty-state" style="text-align:center;padding:40px 16px;color:#94a3b8;font-size:15px;">📭 Không có chi phí nào</div>';
        } else {
            // Header
            html += '<div class="pmtx-header">' +
                        '<span class="pmtx-col-stt">STT</span>' +
                        '<span class="pmtx-col-time">Giờ</span>' +
                        '<span class="pmtx-col-items" style="flex:2;">Nội dung</span>' +
                        '<span class="pmtx-col-amount">Tiền</span>' +
                    '</div>';

            var grandTotal = 0;

            for (var i = 0; i < filtered.length; i++) {
                var c = filtered[i];
                var stt = i + 1;
                var amount = c.amount || 0;
                grandTotal += amount;

                // Format giờ từ createdAt
                var timeStr = '';
                if (c.createdAt) {
                    var d = new Date(c.createdAt);
                    timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                }

                // Nội dung chi: categoryName + chi tiết (nếu là nguyên liệu)
                var contentStr = escapeHtml(c.categoryName || '');
                if (c.costType === 'ingredient' && c.ingredientQty && c.ingredientUnitPrice) {
                    contentStr += ' <span style="color:#94a3b8;font-size:12px;">x' + c.ingredientQty + ' × ' + formatMoney(c.ingredientUnitPrice) + '</span>';
                }

                html += '<div class="pmtx-row">' +
                            '<span class="pmtx-col-stt">#' + stt + '</span>' +
                            '<span class="pmtx-col-time">' + timeStr + '</span>' +
                            '<span class="pmtx-col-items" style="flex:2;">' + contentStr + '</span>' +
                            '<span class="pmtx-col-amount">' + formatMoney(amount) + '</span>' +
                        '</div>';
            }

            // Tổng kết
            html += '<div class="pmtx-footer">' +
                        '<span class="pmtx-col-stt"></span>' +
                        '<span class="pmtx-col-time"></span>' +
                        '<span class="pmtx-col-items" style="flex:2;">Tổng cộng</span>' +
                        '<span class="pmtx-col-amount">' + formatMoney(grandTotal) + '</span>' +
                    '</div>';
        }

        html += '    </div>' +
            '</div>' +
        '</div>';

        // Xóa modal cũ cùng loại nếu còn
        var oldModals = document.querySelectorAll('[id^="posCostTxModal_"]');
        for (var mi = 0; mi < oldModals.length; mi++) {
            if (oldModals[mi].parentNode) oldModals[mi].parentNode.removeChild(oldModals[mi]);
        }

        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
        openBottomSheet(modalId);
    }).catch(function(err) {
        showToast('❌ Lỗi tải dữ liệu chi phí', 'error');
    });
}