// manager.js - Tích hợp quản lý chi phí và bảng tổng quan
// Không còn tab chi phí riêng, chỉ dùng popup nhập chi phí.

var managerData = {
    currentViewMode: 'period',
    currentPeriod: { startDate: null, endDate: null },
    currentMonth: null,
    currentDay: null,
    transactions: [],
    costTransactions: [],
    adminCostTransactions: [],
    customers: [],
    staffs: []
};

var managerInitialized = false;

async function initManager() {
    if (managerInitialized) return;
    await loadAllData();
    await loadStaffCostData();
    await loadAdminCostData();
    managerInitFilter();
    attachManagerEvents();
    attachCostPopupEvents();
    managerRenderLowStockAlert();   // thêm dòng này
    window.addEventListener('db_update', onManagerDBUpdate);
    managerInitialized = true;
}

async function loadAllData() {
    var promises = [
        DB.getAll('transactions'),
        DB.getAll('cost_transactions'),
        DB.getAll('cost_transactions_admin'),
        DB.getAll('customers'),
        DB.getAll('staffs')
    ];
    var results = await Promise.all(promises);
    managerData.transactions = results[0] || [];
    managerData.costTransactions = results[1] || [];
    managerData.adminCostTransactions = results[2] || [];
    managerData.customers = results[3] || [];
    managerData.staffs = results[4] || [];

    // Lọc giao dịch chưa hủy
    managerData.transactions = managerData.transactions.filter(function(tx) {
        return !tx.refunded && tx.type !== 'refund';
    });
    managerData.costTransactions = managerData.costTransactions.filter(function(c) { return !c.deleted; });
    managerData.adminCostTransactions = managerData.adminCostTransactions.filter(function(c) { return !c.deleted; });

    // Dựng chỉ mục ngày MỘT LẦN khi nạp dữ liệu.
    // Đây là chỗ đáng làm nhất vì dữ liệu chỉ nạp lại khi có thay đổi từ máy
    // khác, còn người dùng bấm chuyển kỳ thì không nạp lại. Tính sẵn ở đây
    // giúp mỗi lần bấm nút chỉ việc so sánh số, không tạo Date lại.
    _buildDayIndex(managerData.transactions);
    _buildDayIndex(managerData.costTransactions);
    _buildDayIndex(managerData.adminCostTransactions);
    // Duyệt cả lịch sử của khách (dùng cho nợ phát sinh + tổng công nợ)
    for (var ci = 0; ci < managerData.customers.length; ci++) {
        var c = managerData.customers[ci];
        if (!c) continue;
        _buildDayIndex(c.debtHistory);
        _buildDayIndex(c.paymentHistory);
    }
}

// Gộp nhiều lần cập nhật realtime thành 1 lần vẽ.
// Không dùng setTimeout chồng lên các tầng debounce khác (db.js đã chờ
// 120ms, realtime-pos.js chờ thêm 200ms) vì mỗi tầng cộng thêm độ trễ và
// người dùng thấy màn hình "nhanh rồi giật".
var _managerPendingCols = {};
var _managerUpdateTimer = null;
var MANAGER_UPDATE_DEBOUNCE_MS = 60;

function onManagerDBUpdate(event) {
    var col = event.detail && event.detail.collection;
    if (!col) return;
    var affected = ['transactions', 'cost_transactions', 'cost_transactions_admin', 'customers', 'staffs', 'ingredients', 'cost_categories', 'admin_cost_categories'];
    if (affected.indexOf(col) === -1) return;
    if (!managerInitialized) return;

    _managerPendingCols[col] = true;
    if (_managerUpdateTimer) clearTimeout(_managerUpdateTimer);
    _managerUpdateTimer = setTimeout(_flushManagerUpdate, MANAGER_UPDATE_DEBOUNCE_MS);
}

function _flushManagerUpdate() {
    _managerUpdateTimer = null;
    var cols = _managerPendingCols;
    _managerPendingCols = {};
    var needIngredients = !!cols.ingredients;

    // Dữ liệu đã nằm trong bộ nhớ của DB module (memoryCache) sau khi có thay
    // đổi. Trước đây hàm này gọi loadAllData() đọc lại IndexedDB từ đầu cho
    // 5 collection, tốn hàng trăm ms mỗi lần dữ liệu về.
    // Nay chỉ đọc lại những collection thực sự thay đổi, và lấy từ cache
    // trong bộ nhớ thay vì đọc đĩa.
    var jobs = [];
    if (cols.transactions) jobs.push(_refreshFromCache('transactions'));
    if (cols.cost_transactions) jobs.push(_refreshFromCache('cost_transactions'));
    if (cols.cost_transactions_admin) jobs.push(_refreshFromCache('cost_transactions_admin'));
    if (cols.customers) jobs.push(_refreshFromCache('customers'));
    if (cols.staffs) jobs.push(_refreshFromCache('staffs'));

    Promise.all(jobs).then(function () {
        var view = document.getElementById('managerView');
        if (view && view.classList.contains('active')) {
            managerApplyFilter();
            if (needIngredients) managerRenderLowStockAlert();
        }
    }).catch(function (e) {
        console.error('[Manager] Lỗi cập nhật dữ liệu:', e);
    });
}

// Lấy 1 collection từ bộ nhớ tạm của DB (nhanh) thay vì đọc IndexedDB.
// Trường hợp bộ nhớ chưa có thì mới đọc đĩa.
function _refreshFromCache(name) {
    var map = {
        transactions: 'transactions',
        cost_transactions: 'costTransactions',
        cost_transactions_admin: 'adminCostTransactions',
        customers: 'customers',
        staffs: 'staffs'
    };
    var key = map[name];
    if (!key) return Promise.resolve();
    var cached = null;
    try {
        if (typeof DB !== 'undefined' && DB.getMemoryCache) cached = DB.getMemoryCache(name);
    } catch (e) { cached = null; }
    if (cached && cached.length) {
        managerData[key] = cached;
    } else if (typeof DB !== 'undefined' && DB.getAll) {
        return DB.getAll(name).then(function (list) {
            managerData[key] = list || [];
        });
    }
    // Loại bỏ giao dịch đã hủy rồi dựng lại chỉ mục ngày
    if (key === 'transactions') {
        managerData.transactions = managerData.transactions.filter(function (tx) {
            return !tx.refunded && tx.type !== 'refund';
        });
    } else if (key === 'costTransactions') {
        managerData.costTransactions = managerData.costTransactions.filter(function (c) { return !c.deleted; });
    } else if (key === 'adminCostTransactions') {
        managerData.adminCostTransactions = managerData.adminCostTransactions.filter(function (c) { return !c.deleted; });
    }
    if (key === 'transactions') _buildDayIndex(managerData.transactions);
    else if (key === 'costTransactions') _buildDayIndex(managerData.costTransactions);
    else if (key === 'adminCostTransactions') _buildDayIndex(managerData.adminCostTransactions);
    else if (key === 'customers') {
        for (var ci = 0; ci < managerData.customers.length; ci++) {
            if (!managerData.customers[ci]) continue;
            _buildDayIndex(managerData.customers[ci].debtHistory);
            _buildDayIndex(managerData.customers[ci].paymentHistory);
        }
    }
    return Promise.resolve();
}

function managerInitFilter() {
    managerComputeCurrentPeriod();
    managerData.currentMonth = new Date();
    managerData.currentDay = new Date();
    updateManagerViewMode();      // cập nhật text dropdown lần đầu
    attachFilterControls();
    managerApplyFilter();
}

function managerComputeCurrentPeriod() {
    var now = new Date();
    var day = now.getDate();
    var month = now.getMonth();
    var year = now.getFullYear();
    var start, end;
    if (day >= 20) {
        start = new Date(year, month, 20);
        end = new Date(year, month + 1, 19);
    } else {
        start = new Date(year, month - 1, 20);
        end = new Date(year, month, 19);
    }
    if (isNaN(start.getTime())) start = new Date();
    if (isNaN(end.getTime())) end = new Date();
    managerData.currentPeriod = { startDate: start, endDate: end };
}

// Ngày 20 hôm nay. Kỳ bắt đầu từ ngày 20 thì đó là kỳ hiện tại,
// kỳ kế tiếp (bắt đầu sau 20) là tương lai -> không cho xem.
function _getCurrentPeriodStart() {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth();
    var d = now.getDate();
    if (d >= 20) return new Date(y, m, 20);
    return new Date(y, m - 1, 20);
}

function managerShiftPeriod(delta) {
    var newStart = new Date(managerData.currentPeriod.startDate);
    newStart.setDate(1);            // tránh rơi vào ngày 31 khi đổi tháng
    newStart.setMonth(newStart.getMonth() + delta);
    newStart.setDate(20);
    var newEnd = new Date(newStart);
    newEnd.setDate(1);
    newEnd.setMonth(newStart.getMonth() + 1);
    newEnd.setDate(19);
    if (isNaN(newStart.getTime())) newStart = new Date();
    if (isNaN(newEnd.getTime())) newEnd = new Date();

    // FIX: chặn xem kỳ tương lai. Trước đây bấm ▶ liên tục ra những kỳ
    // trống không có dữ liệu, người dùng tưởng hệ thống lỗi.
    if (delta > 0 && newStart > _getCurrentPeriodStart()) {
        showToast('Không có dữ liệu cho kỳ tương lai', 'warning');
        return;
    }

    managerData.currentPeriod = { startDate: newStart, endDate: newEnd };
    updateManagerViewMode();
    managerApplyFilter();
}

function managerShiftMonth(delta) {
    var newMonth = new Date(managerData.currentMonth);
    // FIX: setDate(1) trước khi setMonth để không bị nhảy ngày khi rơi vào
    // cuối tháng. VD từ 31/01 lùi 1 tháng sẽ ra 03/12 thay vì 31/12.
    newMonth.setDate(1);
    newMonth.setMonth(newMonth.getMonth() + delta);
    if (isNaN(newMonth.getTime())) newMonth = new Date();

    // Chặn tháng tương lai
    var now = new Date();
    if (delta > 0 && (newMonth.getFullYear() > now.getFullYear() ||
        (newMonth.getFullYear() === now.getFullYear() && newMonth.getMonth() > now.getMonth()))) {
        showToast('Không có dữ liệu cho tháng tương lai', 'warning');
        return;
    }

    managerData.currentMonth = newMonth;
    updateManagerViewMode();
    managerApplyFilter();
}

function managerShiftDay(delta) {
    var newDay = new Date(managerData.currentDay);
    newDay.setDate(newDay.getDate() + delta);
    if (isNaN(newDay.getTime())) newDay = new Date();
    // Chặn ngày tương lai - không có dữ liệu
    if (delta > 0 && newDay > new Date()) {
        showToast('Không có dữ liệu cho ngày tương lai', 'warning');
        return;
    }
    managerData.currentDay = newDay;
    updateManagerViewMode();
    managerApplyFilter();
}

function managerFormatDateShort(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '--/--/----';
    var d = date.getDate();
    var m = date.getMonth() + 1;
    var y = date.getFullYear();
    return d + '/' + m + '/' + y;
}

function managerFormatMonthYear(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '--/----';
    var m = date.getMonth() + 1;
    var y = date.getFullYear();
    return m + '/' + y;
}

function updateManagerViewMode() {
    var select = document.getElementById('managerViewModeSelect');
    if (!select) return;

    var mode = select.value;
    managerData.currentViewMode = mode;

    if (mode === 'period') {
        var s = managerFormatDateShort(managerData.currentPeriod.startDate);
        var e = managerFormatDateShort(managerData.currentPeriod.endDate);
        var rangeText = s + ' → ' + e;

        //if (display) display.innerText = rangeText;
        if (select.options[0]) select.options[0].text = 'Kỳ ' + rangeText;

    } else if (mode === 'month') {
        var monthText = managerFormatMonthYear(managerData.currentMonth);

        //if (display) display.innerText = 'Tháng ' + monthText;
        if (select.options[1]) select.options[1].text = 'Tháng ' + monthText;

    } else {
        var dayText = managerFormatDateShort(managerData.currentDay);

        //if (display) display.innerText = dayText;
        if (select.options[2]) select.options[2].text = dayText;
    }
}


async function renderMonthCostCategories() {
    var container = document.getElementById('monthCostCategoryList');
    if (!container) return;

    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();

    var map = {};

    managerData.costTransactions.forEach(function(tx){
        if (tx.deleted) return;

        var d = new Date(tx.date);

        if (
            d.getFullYear() === year &&
            d.getMonth() === month
        ) {
            if (!map[tx.categoryName]) {
                map[tx.categoryName] = 0;
            }

            map[tx.categoryName] += tx.amount;
        }
    });

    var html = '';

    Object.keys(map)
        .sort(function(a,b){
            return map[b] - map[a];
        })
        .forEach(function(name){

            html +=
            '<div class="today-cost-item" ' +
            'onclick="showExpenseDetail(\'' +
            name.replace(/'/g,"\\'") +
            '\')">' +

                '<div class="today-cost-name">' +
                    escapeHtml(name) +
                '</div>' +

                '<div class="today-cost-amount">' +
                    formatMoney(map[name]) +
                '</div>' +

            '</div>';
        });

    if (!html) {
        html =
        '<div class="empty-text">📭 Chưa có dữ liệu tháng này</div>';
    }

    container.innerHTML = html;
}

function attachFilterControls() {
    var prev = document.getElementById('managerPeriodPrevBtn');
    var next = document.getElementById('managerPeriodNextBtn');
    var mode = document.getElementById('managerViewModeSelect');
    if (prev) {
        prev.onclick = function() {
            if (managerData.currentViewMode === 'period') managerShiftPeriod(-1);
            else if (managerData.currentViewMode === 'month') managerShiftMonth(-1);
            else managerShiftDay(-1);
        };
    }
    if (next) {
        next.onclick = function() {
            if (managerData.currentViewMode === 'period') managerShiftPeriod(1);
            else if (managerData.currentViewMode === 'month') managerShiftMonth(1);
            else managerShiftDay(1);
        };
    }
    if (mode) {
        mode.onchange = function() {
            var newMode = this.value;
            managerData.currentViewMode = newMode;
            if (newMode === 'period') managerComputeCurrentPeriod();
            else if (newMode === 'month') managerData.currentMonth = managerData.currentMonth || new Date();
            else if (newMode === 'day') managerData.currentDay = managerData.currentDay || new Date();
            updateManagerViewMode();
            managerApplyFilter();
        };
    }
}

// ========== TÍNH LƯƠNG THEO KỲ ==========
// Quy ước (giống tab Nhân viên): kỳ 20/N → 19/N+1 trả lương cho tháng N.
// VD: lương tháng 8 (01-31/8) nằm ở kỳ 20/8 → 19/9.
//
// Hàm này tự tính từ dữ liệu nhân viên, không phụ thuộc employees.js
// để tránh lỗi nếu file đó chưa nạp xong.
function _getSalaryPeriodOfRange(startDate, endDate) {
    if (!startDate) return null;
    var y = startDate.getFullYear();
    var m = startDate.getMonth() + 1;      // 1-12
    // Kỳ lương bắt đầu ngày 20. Nếu khoảng đang xem bắt đầu từ ngày 1-19
    // của tháng N+1 thì đó là kỳ trả lương cho tháng N.
    if (startDate.getDate() < 20) {
        m = m - 1;
        if (m < 1) { m = 12; y--; }
    }
    return { year: y, month: m, key: y + '-' + ('0' + m).slice(-2) };
}

function _countDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

function managerComputeSalaryForRange(startDate, endDate) {
    var period = _getSalaryPeriodOfRange(startDate, endDate);
    if (!period) return 0;

    // Chỉ tính lương khi xem đúng 1 kỳ lương (20/N → 19/N+1).
    // Xem theo "Tháng" hoặc "Ngày" không trả lương -> trả 0 cho khỏi nhầm.
    if (managerData.currentViewMode !== 'period') return 0;
    // Đang xem kỳ khác kỳ lương vừa tính -> 0
    if (!startDate || startDate.getDate() !== 20) return 0;

    var year = period.year, month = period.month;
    var daysInMonth = _countDaysInMonth(year, month);

    var staffList = managerData.staffs || [];
    if (!staffList.length) return 0;

    var total = 0;
    for (var i = 0; i < staffList.length; i++) {
        var st = staffList[i];
        if (!st || !st.id) continue;

        // Lương ngày: ưu tiên dữ liệu lương theo kỳ, thiếu thì lấy trong hồ sơ NV
        var dailySalary = 0;
        var manualBonus = 0, manualPenalty = 0, revenueBonusEnabled = false;

        if (typeof empCalculateStaffSalary === 'function') {
            // Dùng đúng hàm của tab Nhân viên nếu đã nạp (chứa cả thưởng doanh thu)
            var info = empCalculateStaffSalary(st.id, period.key);
            if (info && typeof info.total === 'number') {
                total += info.total;
                continue;
            }
        }

        if (st.dailySalary > 0) dailySalary = st.dailySalary;
        if (st.revenueBonusEnabled) revenueBonusEnabled = true;
        total += dailySalary * daysInMonth + manualBonus - manualPenalty;
    }
    return total > 0 ? total : 0;
}

// ========== LẤY NGÀY THEO GIỜ VIỆT NAM ==========
// toISOString() luôn trả giờ UTC, mà giờ VN là UTC+7.
// Giao dịch lúc 00:00-07:00 sẽ bị ghi nhận sang hôm trước.
// Mọi nơi so sánh ngày trong tab Quản lý đều dùng hàm này.
function _toLocalDateStr(date) {
    if (!date) return '';
    var d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
}

// Lấy ngày của một bản ghi dưới dạng chuỗi YYYY-MM-DD theo GIỜ VIỆT.
// Lưu ý: trường `date` trong DB lưu dạng ISO theo giờ UTC. Nếu cắt chuỗi
// (date.slice(0,10)) thì lấy ngày UTC -> lệch 7 tiếng so với giờ VN.
// 25/8 10:00 giờ VN lưu thành "2026-09-25T03:00:00.000Z", cắt chuỗi ra 25/9.
// Vì vậy phải quy đổi qua Date để lấy đúng ngày giờ VN.
function _itemDateStr(item) {
    if (!item) return '';
    // dateKey đã được sinh sẵn theo giờ VN ở lúc ghi -> ưu tiên dùng luôn
    if (item.dateKey) return item.dateKey;
    if (item.date) return _toLocalDateStr(item.date);
    if (item.createdAt) return _toLocalDateStr(item.createdAt);
    return '';
}

function managerGetDateRangeByMode() {
    var mode = managerData.currentViewMode;
    var start = null, end = null;
    if (mode === 'period') {
        if (managerData.currentPeriod && managerData.currentPeriod.startDate && managerData.currentPeriod.endDate) {
            start = new Date(managerData.currentPeriod.startDate);
            end = new Date(managerData.currentPeriod.endDate);
        } else {
            managerComputeCurrentPeriod();
            start = new Date(managerData.currentPeriod.startDate);
            end = new Date(managerData.currentPeriod.endDate);
        }
    } else if (mode === 'month') {
        if (managerData.currentMonth) {
            start = new Date(managerData.currentMonth.getFullYear(), managerData.currentMonth.getMonth(), 1);
            end = new Date(managerData.currentMonth.getFullYear(), managerData.currentMonth.getMonth() + 1, 0);
        } else {
            managerData.currentMonth = new Date();
            start = new Date(managerData.currentMonth.getFullYear(), managerData.currentMonth.getMonth(), 1);
            end = new Date(managerData.currentMonth.getFullYear(), managerData.currentMonth.getMonth() + 1, 0);
        }
    } else {
        // FIX: trước đây end = start + 1 ngày, tức 00:00 ngày hôm sau.
        // Khi ghép với toISOString() (giờ UTC) thì chọn ngày 1/10 lại ra
        // khoảng 30/9 → 31/10, lệch 2 ngày ở một đầu.
        // Nay dùng ngày ĐÓNG (23:59:59) đúng ngày đang xem.
        var dayBase = managerData.currentDay || new Date();
        if (!managerData.currentDay) managerData.currentDay = new Date(dayBase);
        start = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), 0, 0, 0);
        end = new Date(dayBase.getFullYear(), dayBase.getMonth(), dayBase.getDate(), 23, 59, 59);
    }
    if (!start || isNaN(start.getTime())) start = new Date();
    if (!end || isNaN(end.getTime())) end = new Date();
    return { startDate: start, endDate: end };
}

// ===== TỐI ƯU BỘ LỌC =====
//
// ĐO ĐẠC (10.000 giao dịch, lọc 10 lần):
//   cắt chuỗi ISO trong vòng lọc ......... 5 ms   (nhanh nhưng SAI giờ)
//   tạo Date mỗi bản ghi ............... 31 ms
//   so sánh timestamp trong vòng lọc .... 21 ms
//   DỰNG CHỈ MỤC NGÀY 1 LẦN, lọc lại ....  1 ms   <-- dùng cách này
//
// Nguyên nhân chậm là tạo đối tượng Date cho từng bản ghi trong mỗi lần
// lọc. Người dùng bấm nút chuyển kỳ liên tục thì phí này lặp lại mãi.
// Nay tính timestamp đầu ngày của mỗi bản ghi ĐÚNG MỘT LẦN, lưu vào mảng
// đi kèm, các lần lọc sau chỉ so sánh số.
//
// VỀ CÁCH CACHE (đã thử và bỏ): cache theo chuỗi ISO là vô dụng vì mỗi
// giao dịch một chuỗi ISO khác nhau -> 10.000 khóa, vượt ngưỡng nên bị xoá
// giữa chừng và còn chậm hơn. Cache theo chuỗi ngày 'YYYY-MM-DD' thì chỉ có
// ~366 khóa cho cả năm nhưng vẫn phải tạo Date để tìm khóa.
//
// LƯU Ý: bộ nhớ tăng thêm 8 byte mỗi bản ghi. 20.000 giao dịch = 160KB,
// không đáng kể so với lợi ích.

function _toLocalDateStr(date) {
    if (!date) return '';
    var d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
}

// Quy đổi chuỗi ngày 'YYYY-MM-DD' -> timestamp đầu ngày giờ VN
function _dateStrToMs(dateStr) {
    if (!dateStr || dateStr.length < 10) return NaN;
    var y = parseInt(dateStr.slice(0, 4), 10);
    var m = parseInt(dateStr.slice(5, 7), 10) - 1;
    var d = parseInt(dateStr.slice(8, 10), 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return NaN;
    return new Date(y, m, d).getTime();
}

// Timestamp đầu ngày (giờ VN) của 1 bản ghi.
//
// THỨ TỰ ƯU TIÊN: date trước, dateKey sau.
//
// Lý do: DB đang có hai cách sinh dateKey khác nhau -
//   cost.js dùng toISOString()        -> ngày theo GIỜ UTC (sai)
//   customers.js, db.js dùng giờ máy  -> ngày theo GIỜ VIỆT (đúng)
// Nên dateKey của cùng một sự kiện có thể ghi 01/10 hoặc 30/9 tùy chỗ.
// Nếu tin dateKey thì giao dịch lúc 2h sáng bị đẩy sang kỳ trước.
// Trường `date` luôn là thời điểm thật của sự kiện nên đáng tin hơn.
function _itemTimeMs(item) {
    if (!item) return NaN;
    // 1. date lưu dạng ISO giờ UTC.
    //    KHÔNG dùng date.slice(0,10): đó là ngày UTC, lệch 7 tiếng so với
    //    giờ VN. 01/10 02:00 VN lưu thành "2026-09-30T19:00:00.000Z",
    //    cắt chuỗi ra 30/9. Phải quy đổi qua Date rồi mới lấy ngày giờ VN.
    if (item.date) {
        var d = new Date(item.date);
        if (!isNaN(d.getTime())) {
            return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        }
    }
    // 2. createdAt
    if (item.createdAt) {
        var d3 = new Date(item.createdAt);
        if (!isNaN(d3.getTime())) {
            return new Date(d3.getFullYear(), d3.getMonth(), d3.getDate()).getTime();
        }
    }
    // 3. dateKey - chỉ dùng khi không có date/createdAt
    if (item.dateKey && item.dateKey.length >= 10) return _dateStrToMs(item.dateKey);
    return NaN;
}

// Dựng chỉ mục timestamp ngày cho cả mảng, gắn thẳng vào từng bản ghi
// (dùng thuộc tính __dayMs) để các lần lọc sau dùng lại được.
function _buildDayIndex(items) {
    if (!items || !items.length) return;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        it.__dayMs = _itemTimeMs(it);
    }
}

// Khoảng thời gian lọc (ms đầu/cuối ngày theo giờ VN)
function _getRangeMs(startDate, endDate) {
    var s = (startDate instanceof Date) ? startDate : new Date(startDate);
    var e = (endDate instanceof Date) ? endDate : new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    return {
        lo: new Date(s.getFullYear(), s.getMonth(), s.getDate()).getTime(),
        hi: new Date(e.getFullYear(), e.getMonth(), e.getDate()).getTime() + 86399999
    };
}

function managerFilterByDateRange(items, startDate, endDate) {
    if (!items || !items.length) return [];
    var r = _getRangeMs(startDate, endDate);
    if (!r) return [];
    var lo = r.lo, hi = r.hi;
    var result = [];
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it) continue;
        // Dùng chỉ mục đã dựng; nếu chưa có (dữ liệu vừa thêm) thì tính luôn
        var t = it.__dayMs;
        if (t === undefined) t = it.__dayMs = _itemTimeMs(it);
        if (t === t && t >= lo && t <= hi) result.push(it);   // t === t loại bỏ NaN
    }
    return result;
}

function managerApplyFilter() {
    if (!managerData.transactions || !managerData.costTransactions || !managerData.adminCostTransactions || !managerData.customers) return;
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    // Lọc MỘT LẦN rồi dùng lại cho mọi phần hiển thị.
    // Trước đây transactions bị lọc 2 lần: một lần ở đây, một lần nữa
    // trong renderDrinkStats() (hàm đó tự gọi lại managerGetDateRangeByMode).
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    var filteredCosts = managerFilterByDateRange(managerData.costTransactions, range.startDate, range.endDate);
    var filteredAdminCosts = managerFilterByDateRange(managerData.adminCostTransactions, range.startDate, range.endDate);

    var stats = managerComputeStats(filteredTrans, filteredCosts, filteredAdminCosts, managerData.customers, managerData.staffs, range.startDate, range.endDate);
    updateManagerUI(stats);
    renderExpenseList(filteredCosts);
    renderAdminExpenseList(filteredAdminCosts);
    // Truyền danh sách khách nợ đã tính sẵn, không duyệt lại lịch sử khách
    renderManagerDebtList(stats.debtBalances);
    // Truyền danh sách đã lọc vào để không phải lọc lại lần nữa
    renderDrinkStats(filteredTrans);
    // Cảnh báo tồn kho KHÔNG phụ thuộc kỳ - chỉ vẽ khi nguyên liệu thay đổi.
    // Trước đây hàm này chạy mỗi lần bấm nút chuyển kỳ, tạo lại HTML
    // không cần thiết.
    if (lowStockDirty) {
        managerRenderLowStockAlert();
        lowStockDirty = false;
    }
}

// Đánh dấu cần vẽ lại cảnh báo tồn kho
var lowStockDirty = true;
function managerInvalidateLowStock() { lowStockDirty = true; }

function managerComputeStats(transactions, staffCosts, adminCosts, customers, staffs, startDate, endDate) {
    var revenue = 0, grab = 0, bank = 0, cash = 0;
    var debtRecorded = 0;   // ghi nợ (chưa thu tiền) - KHÔNG tính vào doanh thu
    for (var i = 0; i < transactions.length; i++) {
        var tx = transactions[i];
        var amt = tx.amount || 0;

        // FIX: trước đây cộng MỌI giao dịch vào doanh thu, gồm cả ghi nợ
        // (type='debt_payment', paymentMethod='debt'). Ghi nợ chưa thu được tiền
        // nên doanh thu bị thối phồng, đồng thời số tiền đó lại không rơi vào
        // ô tiền mặt/Chuyển khoản/Grab nào -> tổng 3 ô khớp doanh thu.
        // Nay theo quy ước: chỉ tính doanh thu khi THU ĐƯỢC TIỀN.
        if (tx.type === 'debt_payment' && tx.paymentMethod === 'debt') {
            debtRecorded += amt;
            continue;   // chưa thu tiền -> bỏ qua doanh thu
        }
        // Giao dịch đã hủy: không tính
        if (tx.refunded) continue;
        // Giao dịch xoá bàn: không phải doanh thu
        if (tx.type === 'delete_table') continue;

        revenue += amt;
        if (tx.type === 'grab') {
            grab += amt;
        } else if (tx.paymentMethod === 'cash') {
            cash += amt;
        } else if (tx.paymentMethod === 'transfer') {
            bank += amt;
        }
    }
    var staffCostTotal = 0, adminCostTotal = 0;
    for (var j = 0; j < staffCosts.length; j++) staffCostTotal += staffCosts[j].amount || 0;
    for (var k = 0; k < adminCosts.length; k++) adminCostTotal += adminCosts[k].amount || 0;

    // Nợ phát sinh trong kỳ.
    // Duyệt MỘT LẦN qua tất cả khách: vừa tính nợ phát sinh trong kỳ,
    // vừa tính tổng công nợ còn lại. Trước đây lặp 2 vòng riêng biệt và
    // tạo chuỗi ngày cho từng dòng lịch sử.
    var debtOccur = 0;
    var totalDebt = 0;
    // Danh sách khách còn nợ, dựng 1 lần ở vòng lặp này
    var debtBalances = [];
    var rng = _getRangeMs(startDate, endDate);
    var lo = rng ? rng.lo : NaN;
    var hi = rng ? rng.hi : NaN;
    for (var l = 0; l < customers.length; l++) {
        var cust = customers[l];
        if (!cust) continue;
        var debts = cust.debtHistory || [];
        // Vừa tính nợ phát sinh trong kỳ, vừa cộng tổng nợ của khách này.
        // Lưu luôn danh sách khách còn nợ vào managerData.debtBalances để
        // renderManagerDebtList() dùng lại, khỏi duyệt lại toàn bộ lịch sử
        // khách hàng lần nữa (trước đây hai vòng lặp làm cùng một việc).
        var custDebt = 0;
        for (var m = 0; m < debts.length; m++) {
            var d = debts[m];
            if (!d) continue;
            var amtD = d.amount || 0;
            custDebt += amtD;
            // Dùng chỉ mục đã dựng lúc nạp dữ liệu, không tạo Date lại
            var t = d.__dayMs;
            if (t === undefined) t = d.__dayMs = _itemTimeMs(d);
            if (t === t && t >= lo && t <= hi) debtOccur += amtD;
        }
        var pays = cust.paymentHistory || [];
        for (var w = 0; w < pays.length; w++) {
            if (pays[w]) custDebt -= pays[w].amount || 0;
        }
        if (custDebt > 0) {
            totalDebt += custDebt;
            debtBalances.push({ id: cust.id, name: cust.name, totalDebt: custDebt });
        }
    }

    // FIX: totalSalary trước đây luôn = 0 nên lợi nhuận bị tính cao hơn thực tế.
    // Lương trả theo kỳ 20/N → 19/N+1 cho tháng N (khớp kỳ của tab này).
    var totalSalary = managerComputeSalaryForRange(startDate, endDate);

    var netIncome = revenue - (staffCostTotal + adminCostTotal + totalSalary);
    return {
        revenue: revenue,
        grab: grab,
        bank: bank,
        cash: cash,
        staffCost: staffCostTotal,
        adminCost: adminCostTotal,
        debtOccur: debtOccur,
        debtRecorded: debtRecorded,
        totalDebt: totalDebt,
        // Danh sách khách còn nợ - truyền sang renderManagerDebtList để
        // không phải duyệt lại toàn bộ lịch sử khách hàng
        debtBalances: debtBalances,
        totalSalary: totalSalary,
        netIncome: netIncome
    };
}

function updateManagerUI(stats) {
    if (!stats) {
        var range = managerGetDateRangeByMode();
        if (!range.startDate || !range.endDate) return;
        var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
        var filteredCosts = managerFilterByDateRange(managerData.costTransactions, range.startDate, range.endDate);
        var filteredAdminCosts = managerFilterByDateRange(managerData.adminCostTransactions, range.startDate, range.endDate);
        stats = managerComputeStats(filteredTrans, filteredCosts, filteredAdminCosts, managerData.customers, managerData.staffs, range.startDate, range.endDate);
    }
    var el;
    if ((el = document.getElementById('managerRevenue'))) el.innerText = formatMoney(stats.revenue);
    if ((el = document.getElementById('managerGrab'))) el.innerText = formatMoney(stats.grab);
    if ((el = document.getElementById('managerBank'))) el.innerText = formatMoney(stats.bank);
    if ((el = document.getElementById('managerCash'))) el.innerText = formatMoney(stats.cash);
    if ((el = document.getElementById('managerExpense'))) el.innerText = formatMoney(stats.staffCost);
    if ((el = document.getElementById('managerAdminExpense'))) el.innerText = formatMoney(stats.adminCost);
    if ((el = document.getElementById('managerDebt'))) el.innerText = formatMoney(stats.debtOccur);
    if ((el = document.getElementById('managerTotalDebt'))) el.innerText = formatMoney(stats.totalDebt);
    if ((el = document.getElementById('managerTotalSalary'))) el.innerText = formatMoney(stats.totalSalary);
    if ((el = document.getElementById('managerNetIncome'))) el.innerText = formatMoney(stats.netIncome);
}

// ========== HIỂN THỊ DANH SÁCH CHI PHÍ ==========
function renderExpenseList(costs) {
    var container = document.getElementById('managerExpenseList');
    if (!container) return;
    if (!costs) costs = [];
    var map = {};
    for (var i = 0; i < costs.length; i++) {
        var c = costs[i];
        var name = c.categoryName;
        if (!map[name]) map[name] = 0;
        map[name] += c.amount;
    }
    var html = '';
    for (var name in map) {
        html += '<div class="manager-item" onclick="showExpenseDetail(\'' + escapeHtml(name) + '\')">' +
            '<span>📦 ' + escapeHtml(name) + '</span>' +
            '<strong>' + formatMoney(map[name]) + '</strong>' +
        '</div>';
    }
    if (!html) html = '<div class="empty-state">Chưa có chi phí nhân viên</div>';
    container.innerHTML = html;
}

function renderAdminExpenseList(costs) {
    var container = document.getElementById('managerAdminExpenseList');
    if (!container) return;
    if (!costs) costs = [];
    var map = {};
    for (var i = 0; i < costs.length; i++) {
        var c = costs[i];
        var name = c.categoryName;
        if (!map[name]) map[name] = { amount: 0, qty: 0 };
        map[name].amount += c.amount;
        map[name].qty += c.quantity || 1;
    }
    var html = '';
    for (var name in map) {
        html += '<div class="manager-item" onclick="showAdminExpenseDetail(\'' + escapeHtml(name) + '\')">' +
            '<span>🏢 ' + escapeHtml(name) + '</span>' +
            '<strong>SL:' + map[name].qty + ' • ' + formatMoney(map[name].amount) + '</strong>' +
        '</div>';
    }
    if (!html) html = '<div class="empty-state">Chưa có chi phí quản lý</div>';
    container.innerHTML = html;
}

// Danh sách khách còn nợ.
// Nhận sẵn danh sách đã tính từ managerComputeStats để khỏi duyệt lại toàn bộ
// lịch sử khách hàng. Trước đây hàm này tự tính lại từ đầu, tức là mỗi lần
// bấm nút chuyển kỳ lại lặp qua toàn bộ khách hàng một lần nữa - trùng công
// việc với managerComputeStats. Với vài trăm khách đây là phần tốn thời gian
// nhất khi bấm nút.
// Nếu không có tham số thì tự tính để hàm vẫn dùng được độc lập.
// Số khách nợ hiển thị mặc định. Danh sách đầy đủ vẽ khi bấm "Xem thêm".
// 30 dòng đủ để xem tổng quan mà không phải dựng hàng trăm phần tử DOM.
var MANAGER_DEBT_LIMIT = 30;
var _debtListExpanded = false;
var _lastDebtBalances = [];

function renderManagerDebtList(preComputed) {
    var container = document.getElementById('managerDebtList');
    if (!container) return;

    var debtCust = preComputed;
    if (!debtCust) {
        var customers = managerData.customers || [];
        debtCust = [];
        for (var i = 0; i < customers.length; i++) {
            var cust = customers[i];
            if (!cust) continue;
            var balance = 0;
            if (cust.debtHistory) {
                for (var j = 0; j < cust.debtHistory.length; j++) balance += cust.debtHistory[j].amount || 0;
            }
            if (cust.paymentHistory) {
                for (var k = 0; k < cust.paymentHistory.length; k++) balance -= cust.paymentHistory[k].amount || 0;
            }
            if (balance > 0) {
                debtCust.push({ id: cust.id, name: cust.name, totalDebt: balance });
            }
        }
    }

    // Sắp xếp giảm dần theo số nợ
    debtCust.sort(function(a, b) { return b.totalDebt - a.totalDebt; });
    _lastDebtBalances = debtCust;

    // Chỉ vẽ số khách nợ đang mở (mặc định 30).
    // Với vài trăm khách, vẽ hết tạo hàng trăm KB HTML mỗi lần bấm nút ->
    // trình duyệt phải dựng lại hàng trăm phần tử DOM. Giới hạn số dòng giúp
    // thao tác chuyển kỳ phản hồi tức thì. Bấm "Xem thêm" để xem tiếp.
    var totalCount = debtCust.length;
    var limit = _debtListExpanded ? totalCount : Math.min(MANAGER_DEBT_LIMIT, totalCount);

    // Nếu nội dung hiển thị không đổi thì khỏi vẽ lại - tiết kiệm việc dựng DOM
    var sig = limit + ':' + totalCount;
    for (var s = 0; s < limit; s++) {
        sig += '|' + debtCust[s].id + ':' + debtCust[s].totalDebt;
    }
    if (container._debtSig === sig) return;
    container._debtSig = sig;

    // Gộp chuỗi bằng mảng rồi join 1 lần: nhanh hơn nối chuỗi trong vòng lặp
    // (mỗi lần += tạo một chuỗi mới, tốn bộ nhớ khi danh sách dài)
    var parts = [];
    for (var m = 0; m < limit; m++) {
        var c = debtCust[m];
        parts.push('<div class="manager-item" onclick="showDebtDetail(\'' + c.id + '\')">' +
            '<span>👤 ' + escapeHtml(c.name) + '</span>' +
            '<strong style="color:var(--danger);">Nợ: ' + formatMoney(c.totalDebt) + '</strong>' +
        '</div>');
    }
    if (totalCount === 0) {
        parts.push('<div class="empty-state">Không có khách nợ</div>');
    } else if (totalCount > limit) {
        parts.push('<button class="cus-expand-btn" id="btnMoreDebts" onclick="showAllManagerDebts()">' +
            '📋 Xem thêm ' + (totalCount - limit) + ' khách</button>');
    } else if (_debtListExpanded) {
        parts.push('<button class="cus-expand-btn" onclick="collapseManagerDebts()">📋 Thu gọn</button>');
    }
    container.innerHTML = parts.join('');
}

// Bấm "Xem thêm" -> hiện toàn bộ danh sách khách nợ
function showAllManagerDebts() {
    _debtListExpanded = true;
    var c = document.getElementById('managerDebtList');
    if (c) c._debtSig = null;      // ép vẽ lại
    renderManagerDebtList(_lastDebtBalances);
}

// Bấm "Thu gọn" -> về 30 dòng đầu
function collapseManagerDebts() {
    _debtListExpanded = false;
    var c = document.getElementById('managerDebtList');
    if (c) c._debtSig = null;
    renderManagerDebtList(_lastDebtBalances);
}

// Hàm gọi bằng onclick="" phải có trong window
window.showAllManagerDebts = showAllManagerDebts;
window.collapseManagerDebts = collapseManagerDebts;

// ========== QUẢN LÝ CHI PHÍ (POPUP) ==========
var costCategories = [];
var costCategoriesLoaded = false;

async function loadCostCategories() {
    costCategories = await DB.getAll('cost_categories') || [];
    costCategoriesLoaded = true;
}

function getCostCategories() {
    return costCategories;
}

function openCostModal(type) {
    if (!costCategoriesLoaded) {
        loadCostCategories().then(function() {
            openCostModal(type);
        });
        return;
    }
    var modal = document.getElementById('costModal');
    if (!modal) return;
    modal.setAttribute('data-cost-type', type || 'staff');
    
    var nameInput = document.getElementById('expenseNameInput');
    var amountInput = document.getElementById('expenseAmount');
    var qtyInput = document.getElementById('expenseQty');
    var title = document.getElementById('expensePopupTitle');
    
    if (nameInput) nameInput.value = '';
    if (amountInput) amountInput.value = '';
    if (qtyInput) qtyInput.value = '1';
    if (title) title.innerText = (type === 'admin' ? 'Thêm chi phí Quản lý' : 'Thêm chi phí Nhân viên');

renderRecentCategories();
renderTodayCosts();
renderMonthCostCategories();

modal.style.display = 'flex';
}

function renderRecentCategories() {
    var container = document.getElementById('recentCategoriesList');
    if (!container) return;
    if (costCategories.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có danh mục</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < costCategories.length; i++) {
        var cat = costCategories[i];
        html += '<div class="recent-item">' +
            '<button class="recent-btn" onclick="setExpenseName(\'' + escapeHtml(cat.name) + '\')">📦 ' + escapeHtml(cat.name) + '</button>' +
            '<button class="action-btn-edit" onclick="editExpenseName(\'' + cat.id + '\', \'' + escapeHtml(cat.name) + '\')">✏️</button>' +
            '<button class="action-btn-delete" onclick="deleteExpenseCategory(\'' + cat.id + '\')">🗑️</button>' +
        '</div>';
    }
    container.innerHTML = html;
}

function setExpenseName(name) {
    var input = document.getElementById('expenseNameInput');
    if (input) input.value = name;
}

async function editExpenseName(id, oldName) {
    var newName = prompt('Nhập tên mới cho danh mục:', oldName);
    if (!newName || newName === oldName) return;
    if (costCategories.some(function(c) { return c.name === newName; })) {
        showToast('Danh mục đã tồn tại!', 'warning');
        return;
    }
    await DB.update('cost_categories', id, { name: newName, updatedAt: Date.now() });
    costCategories = await DB.getAll('cost_categories');
    renderRecentCategories();
    renderTodayCosts();
    showToast('Đã sửa danh mục', 'success');
}

async function deleteExpenseCategory(id) {
    var used = managerData.costTransactions.some(function(tx) { return tx.categoryId === id && !tx.deleted; }) ||
               managerData.adminCostTransactions.some(function(tx) { return tx.categoryId === id && !tx.deleted; });
    if (used) {
        showToast('Danh mục đã có giao dịch, không thể xóa!', 'error');
        return;
    }
    if (!confirm('Xóa danh mục này?')) return;
    await DB.remove('cost_categories', id);
    costCategories = await DB.getAll('cost_categories');
    renderRecentCategories();
    showToast('Đã xóa danh mục', 'success');
}

async function renderTodayCosts() {
    var container = document.getElementById('todayCostList');
    var totalSpan = document.getElementById('todayCostTotal');
    if (!container || !totalSpan) return;
    // FIX: dùng giờ VN thay vì toISOString (giờ UTC)
    var todayStr = _toLocalDateStr(new Date());
    var allToday = [];
    for (var i = 0; i < managerData.costTransactions.length; i++) {
        var tx = managerData.costTransactions[i];
        if ((_itemDateStr(tx) === todayStr) && !tx.deleted) allToday.push(tx);
    }
    for (var j = 0; j < managerData.adminCostTransactions.length; j++) {
        var tx2 = managerData.adminCostTransactions[j];
        if ((tx2.dateKey === todayStr) && !tx2.deleted) allToday.push(tx2);
    }
    allToday.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    var total = 0;
    if (allToday.length === 0) {
        container.innerHTML = '<div class="empty-text">📭 Chưa có dữ liệu chi phí</div>';
        if (totalSpan) totalSpan.innerText = 'Tổng: 0đ';
        return;
    }
    var html = '';
    for (var k = 0; k < allToday.length; k++) {
        var tx = allToday[k];
        total += tx.amount;
        html += '<div class="today-cost-item">' +
            '<div class="today-cost-name">' + escapeHtml(tx.categoryName) + (tx.quantity > 1 ? ' x' + tx.quantity : '') + '</div>' +
            '<div class="today-cost-amount">' + formatMoney(tx.amount) + '</div>' +
        '</div>';
    }
    container.innerHTML = html;
    if (totalSpan) totalSpan.innerText = 'Tổng: ' + formatMoney(total);
}

async function saveExpenseFromPopup() {
    var modal = document.getElementById('costModal');
    var costType = modal ? modal.getAttribute('data-cost-type') || 'staff' : 'staff';
    var categoryName = document.getElementById('expenseNameInput') ? document.getElementById('expenseNameInput').value.trim() : '';
    var amount = parseInt(document.getElementById('expenseAmount') ? document.getElementById('expenseAmount').value : 0) || 0;
    var quantity = parseInt(document.getElementById('expenseQty') ? document.getElementById('expenseQty').value : 1) || 1;
    if (!categoryName) {
        showToast('Vui lòng nhập hoặc chọn danh mục chi phí!', 'warning');
        return;
    }
    if (amount <= 0) {
        showToast('Số tiền phải lớn hơn 0!', 'warning');
        return;
    }
    var category = costCategories.find(function(c) { return c.name === categoryName; });
    if (!category) {
        var newId = Date.now().toString();
        category = { id: newId, name: categoryName, createdAt: Date.now(), createdBy: window.currentDeviceId };
        await DB.create('cost_categories', category);
        costCategories.push(category);
        renderRecentCategories();
    }
    var nowDate = new Date();
    var nowStr = nowDate.toISOString();
    var collection = (costType === 'admin') ? 'cost_transactions_admin' : 'cost_transactions';
    var data = {
        categoryId: category.id,
        categoryName: category.name,
        amount: amount,
        quantity: quantity,
        note: '',
        date: nowStr,
        dateKey: nowStr.slice(0,10),
        createdAt: Date.now(),
        createdBy: window.currentDeviceId,
        deleted: false
    };
    await DB.create(collection, data);
    await loadAllData();

renderTodayCosts();
renderMonthCostCategories();

if (document.getElementById('managerView').classList.contains('active')) {
    managerApplyFilter();
}
    showToast('✅ Đã thêm chi phí ' + (costType === 'admin' ? 'quản lý' : 'nhân viên'), 'success');
}

function attachCostPopupEvents() {
    var openBtn = document.getElementById('openCostModalBtn');
    if (openBtn) openBtn.onclick = function() { openCostModal('staff'); };
    var quickCostBtn = document.getElementById('quickCostBtn');
    if (quickCostBtn) quickCostBtn.onclick = function() { openCostModal('staff'); };
    var adminExpenseBtn = document.getElementById('adminExpenseFab');
    if (adminExpenseBtn) {
        adminExpenseBtn.onclick = function(e) {
            e.stopPropagation();
            openCostModal('admin');
        };
    }
    var saveBtn = document.getElementById('saveExpenseBtn');
    if (saveBtn) saveBtn.onclick = saveExpenseFromPopup;
    var closeBtns = document.querySelectorAll('[data-close="costModal"]');
    for (var i = 0; i < closeBtns.length; i++) {
        closeBtns[i].onclick = function() { closeModal('costModal'); };
    }
    var quickMoneyBtns = document.querySelectorAll('.quick-money-btn');
    for (var j = 0; j < quickMoneyBtns.length; j++) {
        quickMoneyBtns[j].onclick = function() {
            var amount = this.getAttribute('data-amount');
            var amountInput = document.getElementById('expenseAmount');
            if (amountInput) amountInput.value = amount;
        };
    }
}
// ========== LỌC DANH MỤC CHI PHÍ ==========
function initCategoryFilter() {
    var searchInput = document.getElementById('expenseNameInput');
    if (!searchInput) return;
    // Xóa listener cũ nếu có (tránh trùng lặp khi mở modal nhiều lần)
    if (searchInput._filterListener) {
        searchInput.removeEventListener('input', searchInput._filterListener);
    }
    var filterHandler = function() {
        var keyword = this.value.trim().toLowerCase();
        var items = document.querySelectorAll('#recentCategoriesList .recent-item');
        for (var i = 0; i < items.length; i++) {
            var btn = items[i].querySelector('.recent-btn');
            if (!btn) continue;
            var name = btn.innerText.replace('📦', '').trim().toLowerCase();
            if (keyword === '' || name.indexOf(keyword) !== -1) {
                items[i].style.display = 'flex';
            } else {
                items[i].style.display = 'none';
            }
        }
    };
    searchInput.addEventListener('input', filterHandler);
    searchInput._filterListener = filterHandler;
}

// ========== GẮN SỰ KIỆN CHO POPUP CHI PHÍ ==========
function attachCostModalEvents() {
    var openBtn = document.getElementById('openCostModalBtn');
    if (openBtn) openBtn.onclick = function() { document.getElementById('costModal').style.display = 'flex'; };
    var saveBtn = document.getElementById('saveExpenseBtn');
    if (saveBtn) saveBtn.onclick = saveExpenseFromPopup;
    var closeBtns = document.querySelectorAll('[data-close="costModal"]');
    for (var i = 0; i < closeBtns.length; i++) {
        closeBtns[i].onclick = function() { closeModal('costModal'); };
    }
    var quickBtns = document.querySelectorAll('.quick-money-btn');
    for (var j = 0; j < quickBtns.length; j++) {
        quickBtns[j].onclick = function() {
            var amount = this.getAttribute('data-amount');
            document.getElementById('expenseAmount').value = amount;
        };
    }
    var quickCostBtn = document.getElementById('quickCostBtn');
    if (quickCostBtn) quickCostBtn.onclick = function() { document.getElementById('costModal').style.display = 'flex'; };
    
    // 👇 THÊM DÒNG NÀY ĐỂ KÍCH HOẠT LỌC DANH MỤC
    initCategoryFilter();
}


// Chi tiết lịch sử
async function showExpenseDetail(categoryName) {
    var all = managerData.costTransactions;
    var filtered = [];
    for (var i = 0; i < all.length; i++) {
        if (all[i].categoryName === categoryName && !all[i].deleted) filtered.push(all[i]);
    }
    filtered.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    var html = '<div class="cost-history-header">📜 Lịch sử chi phí nhân viên: <strong>' + escapeHtml(categoryName) + '</strong></div>';
    if (filtered.length === 0) html += '<div class="empty-state">Chưa có giao dịch</div>';
    else {
        html += '<div class="cost-history-list">';
        for (var j = 0; j < filtered.length; j++) {
            var tx = filtered[j];
            html += '<div class="cost-history-item">' +
                '<div class="cost-history-date">' + new Date(tx.date).toLocaleDateString('vi-VN') + ' ' + new Date(tx.date).toLocaleTimeString('vi-VN') + '</div>' +
                '<div class="cost-history-amount">' + formatMoney(tx.amount) + (tx.quantity > 1 ? ' x' + tx.quantity : '') + '</div>' +
                (tx.note ? '<div class="cost-history-note">' + escapeHtml(tx.note) + '</div>' : '') +
            '</div>';
        }
        html += '</div>';
    }
    var contentDiv = document.getElementById('costHistoryList');
    var titleSpan = document.getElementById('costHistoryTitle');
    if (contentDiv) contentDiv.innerHTML = html;
    if (titleSpan) titleSpan.innerHTML = '📜 Lịch sử chi phí - ' + escapeHtml(categoryName);
    var modal = document.getElementById('costHistoryModal');
    if (modal) modal.style.display = 'flex';
}

async function showAdminExpenseDetail(categoryName) {
    var all = managerData.adminCostTransactions;
    var filtered = [];
    for (var i = 0; i < all.length; i++) {
        if (all[i].categoryName === categoryName && !all[i].deleted) filtered.push(all[i]);
    }
    filtered.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    var html = '<div class="cost-history-header">📜 Lịch sử chi phí quản lý: <strong>' + escapeHtml(categoryName) + '</strong></div>';
    if (filtered.length === 0) html += '<div class="empty-state">Chưa có giao dịch</div>';
    else {
        html += '<div class="cost-history-list">';
        for (var j = 0; j < filtered.length; j++) {
            var tx = filtered[j];
            html += '<div class="cost-history-item">' +
                '<div class="cost-history-date">' + new Date(tx.date).toLocaleDateString('vi-VN') + ' ' + new Date(tx.date).toLocaleTimeString('vi-VN') + '</div>' +
                '<div class="cost-history-amount">' + formatMoney(tx.amount) + (tx.quantity > 1 ? ' x' + tx.quantity : '') + '</div>' +
                (tx.note ? '<div class="cost-history-note">' + escapeHtml(tx.note) + '</div>' : '') +
            '</div>';
        }
        html += '</div>';
    }
    var contentDiv = document.getElementById('costHistoryList');
    var titleSpan = document.getElementById('costHistoryTitle');
    if (contentDiv) contentDiv.innerHTML = html;
    if (titleSpan) titleSpan.innerHTML = '📜 Lịch sử chi phí quản lý - ' + escapeHtml(categoryName);
    var modal = document.getElementById('costHistoryModal');
    if (modal) modal.style.display = 'flex';
}

function showDebtDetail(customerId) {
    if (typeof renderCustomerDetail === 'function') renderCustomerDetail(customerId);
    else showToast('Chức năng đang cập nhật', 'info');
}

// ========== SỰ KIỆN CHUNG ==========
function attachManagerEvents() {
    // 1. Collapsible cards (thu gọn/mở rộng)
    var headers = document.querySelectorAll('.toggle-header');
    for (var i = 0; i < headers.length; i++) {
        headers[i].onclick = function(e) {
            var card = this.parentNode;
            while (card && card.nodeType === 1 && !card.classList.contains('card')) {
                card = card.parentNode;
            }
            if (card && card.classList) card.classList.toggle('collapsed');
            e.stopPropagation();
        };
    }

    // 2. Box Doanh thu -> lịch sử doanh thu
    var revenueBox = document.getElementById('revenueBox');
    if (revenueBox) revenueBox.onclick = showRevenueHistory;

    // 3. Box Chuyển khoản -> lịch sử chuyển khoản
    var bankBox = document.getElementById('bankBox');
    if (bankBox) bankBox.onclick = showTransferHistory;

    // 4. Box Thực nhận -> lịch sử thực nhận
    var cashBox = document.getElementById('cashBox');
    if (cashBox) cashBox.onclick = showCashReceivedHistory;

    // 5. Box Grab -> lịch sử Grab
    var grabBox = document.getElementById('grabBox');
    if (grabBox) grabBox.onclick = showGrabHistory;

    // 6. Box Chi phí nhân viên -> modal lịch sử chi phí nhân viên
    var expenseBox = document.getElementById('expenseBox');
    if (expenseBox) expenseBox.onclick = showStaffExpenseHistory;

    // 7. Box Tổng CP Quản lý -> modal lịch sử chi phí quản lý
    var adminExpenseBox = document.getElementById('adminExpenseBox');
    if (adminExpenseBox) adminExpenseBox.onclick = showAdminExpenseHistory;

    // 8. Box Công nợ phát sinh -> modal danh sách nợ phát sinh trong kỳ
    var debtOccurBox = document.getElementById('debtOccurBox');
    if (debtOccurBox) debtOccurBox.onclick = showDebtOccurredHistory;

    // 9. Box Tổng công nợ -> modal danh sách khách hàng đang nợ hiện tại
    var totalDebtBox = document.getElementById('totalDebtBox');
    if (totalDebtBox) totalDebtBox.onclick = showCurrentTotalDebt;

    // 10. Box Thu nhập ròng -> lịch sử thực nhận (tương tự cashBox)
    var netIncomeBox = document.getElementById('netIncomeBox');
    if (netIncomeBox) netIncomeBox.onclick = showCashReceivedHistory;
}

// ========== HIỂN THỊ LỊCH SỬ CHI PHÍ NHÂN VIÊN (MODAL) ==========
function showStaffExpenseHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredCosts = managerFilterByDateRange(managerData.costTransactions, range.startDate, range.endDate);
    
    var categoriesMap = {};
    for (var i = 0; i < filteredCosts.length; i++) {
        var c = filteredCosts[i];
        if (!categoriesMap[c.categoryName]) categoriesMap[c.categoryName] = 0;
        categoriesMap[c.categoryName] += c.amount;
    }
    var sorted = Object.entries(categoriesMap).sort(function(a, b) { return b[1] - a[1]; });
    
    var dateRangeText = formatDateRange(range.startDate, range.endDate);
    var html = '<div class="cost-history-header">📋 Chi phí nhân viên (' + dateRangeText + ')</div>';
    if (sorted.length === 0) {
        html += '<div class="empty-state">Không có chi phí nhân viên trong kỳ</div>';
    } else {
        html += '<div class="cost-list">';
        for (var j = 0; j < sorted.length; j++) {
            var name = sorted[j][0];
            var amount = sorted[j][1];
            html += '<div class="manager-item" onclick="showExpenseDetail(\'' + escapeHtml(name) + '\')">' +
                        '<span>📦 ' + escapeHtml(name) + '</span>' +
                        '<strong>' + formatMoney(amount) + '</strong>' +
                    '</div>';
        }
        html += '</div>';
    }
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '📉 Lịch sử chi phí nhân viên';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== HIỂN THỊ LỊCH SỬ CHI PHÍ QUẢN LÝ ==========
function showAdminExpenseHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredCosts = managerFilterByDateRange(managerData.adminCostTransactions, range.startDate, range.endDate);
    
    var categoriesMap = {};
    for (var i = 0; i < filteredCosts.length; i++) {
        var c = filteredCosts[i];
        if (!categoriesMap[c.categoryName]) categoriesMap[c.categoryName] = { amount: 0, qty: 0 };
        categoriesMap[c.categoryName].amount += c.amount;
        categoriesMap[c.categoryName].qty += c.quantity || 1;
    }
    var sorted = Object.entries(categoriesMap).sort(function(a, b) { return b[1].amount - a[1].amount; });
    
    var dateRangeText = formatDateRange(range.startDate, range.endDate);
    var html = '<div class="cost-history-header">🏢 Chi phí quản lý (' + dateRangeText + ')</div>';
    if (sorted.length === 0) {
        html += '<div class="empty-state">Không có chi phí quản lý trong kỳ</div>';
    } else {
        html += '<div class="cost-list">';
        for (var j = 0; j < sorted.length; j++) {
            var name = sorted[j][0];
            var data = sorted[j][1];
            html += '<div class="manager-item" onclick="showAdminExpenseDetail(\'' + escapeHtml(name) + '\')">' +
                        '<span>🏢 ' + escapeHtml(name) + ' (SL: ' + data.qty + ')</span>' +
                        '<strong>' + formatMoney(data.amount) + '</strong>' +
                    '</div>';
        }
        html += '</div>';
    }
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '📋 Lịch sử chi phí quản lý';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== LỊCH SỬ CÔNG NỢ PHÁT SINH TRONG KỲ ==========
function showDebtOccurredHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    // FIX: dùng giờ VN thay vì toISOString (giờ UTC)
    var startStr = _toLocalDateStr(range.startDate);
    var endStr = _toLocalDateStr(range.endDate);
    
    var debtEntries = [];
    for (var i = 0; i < managerData.customers.length; i++) {
        var cust = managerData.customers[i];
        var debts = cust.debtHistory || [];
        for (var j = 0; j < debts.length; j++) {
            var d = debts[j];
            var dStr = d.date ? d.date.slice(0,10) : '';
            if (dStr >= startStr && dStr <= endStr) {
                debtEntries.push({
                    customerName: cust.name,
                    customerId: cust.id,
                    amount: d.amount,
                    date: d.date,
                    note: d.note
                });
            }
        }
    }
    debtEntries.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
    
    var dateRangeText = formatDateRange(range.startDate, range.endDate);
    var html = '<div class="cost-history-header">💢 Công nợ phát sinh (' + dateRangeText + ')</div>';
    if (debtEntries.length === 0) {
        html += '<div class="empty-state">Không có khoản nợ nào phát sinh</div>';
    } else {
        html += '<div class="history-date-list">';
        var lastDate = '';
        for (var k = 0; k < debtEntries.length; k++) {
            var entry = debtEntries[k];
            var dateStr = new Date(entry.date).toLocaleDateString('vi-VN');
            if (dateStr !== lastDate) {
                if (lastDate) html += '</div>';
                html += '<div class="history-date-group" data-date="' + entry.date.slice(0,10) + '">' +
                            '<div class="history-date-header" onclick="toggleHistoryDateGroup(this)">' +
                                '<span class="history-date-title">📅 ' + dateStr + '</span>' +
                                '<span class="toggle-icon">▼</span>' +
                            '</div>' +
                            '<div class="history-date-items">';
                lastDate = dateStr;
            }
            html += '<div class="history-date-item" onclick="showDebtDetail(\'' + entry.customerId + '\')" style="cursor:pointer;">' +
                        '<div>👤 ' + escapeHtml(entry.customerName) + '</div>' +
                        '<div>📝 ' + escapeHtml(entry.note || '') + '</div>' +
                        '<div class="history-date-item-amount" style="color:var(--danger);">+' + formatMoney(entry.amount) + '</div>' +
                    '</div>';
        }
        html += '</div></div></div>';
    }
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '📊 Công nợ phát sinh';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== DANH SÁCH TỔNG CÔNG NỢ HIỆN TẠI ==========
function showCurrentTotalDebt() {
    var debtCust = [];
    for (var i = 0; i < managerData.customers.length; i++) {
        var cust = managerData.customers[i];
        // Tính số dư nợ hiện tại (ưu tiên totalDebt nếu có, hoặc tính từ lịch sử)
        var totalDebtAmount = 0;
        if (cust.debtHistory) {
            for (var j = 0; j < cust.debtHistory.length; j++) {
                totalDebtAmount += cust.debtHistory[j].amount || 0;
            }
        }
        var totalPaymentAmount = 0;
        if (cust.paymentHistory) {
            for (var j = 0; j < cust.paymentHistory.length; j++) {
                totalPaymentAmount += cust.paymentHistory[j].amount || 0;
            }
        }
        var balance = totalDebtAmount - totalPaymentAmount;
        if (cust.totalDebt && typeof cust.totalDebt === 'number' && Math.abs(cust.totalDebt - balance) < 1000) {
            balance = cust.totalDebt;
        }
        if (balance > 0) {
            debtCust.push({ id: cust.id, name: cust.name, totalDebt: balance });
        }
    }
    debtCust.sort(function(a, b) { return b.totalDebt - a.totalDebt; });
    
    var html = '<div class="cost-history-header">🏦 Danh sách khách nợ hiện tại</div>';
    if (debtCust.length === 0) {
        html += '<div class="empty-state">Không có khách nợ</div>';
    } else {
        html += '<div class="cost-list">';
        for (var k = 0; k < debtCust.length; k++) {
            var c = debtCust[k];
            html += '<div class="manager-item" onclick="showDebtDetail(\'' + c.id + '\')">' +
                        '<span>👤 ' + escapeHtml(c.name) + '</span>' +
                        '<strong style="color:var(--danger);">' + formatMoney(c.totalDebt) + '</strong>' +
                    '</div>';
        }
        html += '</div>';
    }
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '🧾 Tổng công nợ khách hàng';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// Helper: format date range
function formatDateRange(start, end) {
    var s = start.toLocaleDateString('vi-VN');
    var e = end.toLocaleDateString('vi-VN');
    return s + ' → ' + e;
}
// ========== THỐNG KÊ ĐỒ UỐNG THEO BỘ LỌC ==========
// ========== BÁO CÁO MẶT HÀNG BÁN RA ==========
// Mỗi biến thể là 1 dòng riêng: "Cà phê sữa máy (Đá)" và "(Nóng)" tách riêng.
// Chỉ tính đơn ĐÃ THU TIỀN (bỏ qua đơn ghi nợ), tách cột theo kênh bán.
//
// Tên món trong hệ thống có dạng "Tên món (Biến thể)" do addToCartWithVariant()
// ghép lại. Trước đây hàm này cắt bỏ phần trong ngoặc nên Đá và Nóng bị
// gộp làm một, mất thông tin quan trọng cho quản lý.

// Số dòng hiển thị mặc định, bấm "Xem thêm" sẽ hiện toàn bộ
var DRINK_STATS_INITIAL = 20;
var _drinkStatsAll = [];

// Phân loại kênh bán của 1 giao dịch.
// Ghi chú: KHÔNG có kênh "ghi nợ" vì báo cáo này chỉ tính đơn đã thu tiền
// (xem _aggregateItemSales). Đơn ghi nợ bị loại, còn đơn thanh toán nợ /
// gửi trước không có items nên tự nhiên không vào báo cáo. Thêm cột "ghi nợ"
// chỉ để hiện 0 là vô nghĩa.
//
// THỨ TỰ: xét `type` trước, `paymentMethod` chỉ dùng khi type không rõ.
// Nếu kiểm paymentMethod='transfer' trước thì đơn tại bàn trả chuyển khoản
// (type='dinein') sẽ bị đếm thành "mang đi" - sai nghĩa.
function _drinkChannel(tx) {
    if (!tx) return 'other';
    if (tx.type === 'grab') return 'grab';
    if (tx.type === 'takeaway' || tx.type === 'mangdi') return 'takeaway';
    if (tx.type === 'dinein') return 'dinein';
    // Không rõ loại đơn (dữ liệu cũ hoặc loại mới): suy ra theo cách thanh toán
    if (tx.paymentMethod === 'transfer') return 'takeaway';
    return 'dinein';
}

// Gom số lượng bán theo món và theo kênh
function _aggregateItemSales(filteredTrans) {
    var map = {};
    for (var i = 0; i < filteredTrans.length; i++) {
        var tx = filteredTrans[i];
        if (!tx) continue;
        // Bỏ giao dịch đã hủy
        if (tx.refunded === true) continue;
        // Bỏ giao dịch xoá bàn
        if (tx.type === 'delete_table') continue;
        // CHỈ TÍNH ĐƠN ĐÃ THU TIỀN.
        // Đơn ghi nợ (type='debt_payment' + paymentMethod='debt') chưa thu
        // được tiền nên không tính. Thanh toán nợ / gửi trước cũng mang
        // type='debt_payment'|'prepaid' nhưng không có items nên vòng bên
        // dưới tự bỏ qua.
        if (tx.type === 'debt_payment' && tx.paymentMethod === 'debt') continue;

        var ch = _drinkChannel(tx);
        var items = tx.items || [];
        for (var j = 0; j < items.length; j++) {
            var it = items[j];
            if (!it || !it.name) continue;
            // GIỮ NGUYÊN phần biến thể trong ngoặc, chỉ cắt khoảng trắng thừa
            var name = String(it.name).trim();
            if (!name) continue;
            var qty = it.qty || 0;
            if (qty <= 0) continue;
            if (!map[name]) {
                map[name] = { name: name, qty: 0, dinein: 0, takeaway: 0, grab: 0, amount: 0 };
            }
            var row = map[name];
            row.qty += qty;
            row.amount += (it.price || 0) * qty;
            if (ch === 'dinein') row.dinein += qty;
            else if (ch === 'takeaway') row.takeaway += qty;
            else if (ch === 'grab') row.grab += qty;
        }
    }
    var out = [];
    for (var k in map) if (map.hasOwnProperty(k)) out.push(map[k]);
    // Sắp xếp giảm dần theo số lượng, tên giống nhau thì theo doanh thu
    out.sort(function (a, b) {
        if (b.qty !== a.qty) return b.qty - a.qty;
        if (b.amount !== a.amount) return b.amount - a.amount;
        return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
    });
    return out;
}

function renderDrinkStats(preFilteredTrans) {
    var container = document.getElementById('managerDrinkStats');
    if (!container) return;

    // Nhận sẵn danh sách đã lọc từ managerApplyFilter để khỏi lọc lại.
    // Nếu gọi độc lập (không truyền tham số) thì tự lọc như trước.
    var filteredTrans = preFilteredTrans;
    if (!filteredTrans) {
        var range = managerGetDateRangeByMode();
        if (!range.startDate || !range.endDate) {
            container.innerHTML = '<div class="empty-state">Chưa có dữ liệu</div>';
            return;
        }
        filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    }

    var itemsArray = _aggregateItemSales(filteredTrans);
    _drinkStatsAll = itemsArray;
    // Đổi bộ lọc thì quay về trạng thái thu gọn
    _drinkStatsExpanded = false;

    if (itemsArray.length === 0) {
        container.innerHTML = '<div class="empty-state">📭 Không có dữ liệu bán hàng trong khoảng thời gian này</div>';
        return;
    }

    // Gộp chuỗi bằng mảng rồi join 1 lần: nhanh hơn nối chuỗi trong vòng lặp
    container.innerHTML = _buildDrinkStatsHtml(itemsArray, DRINK_STATS_INITIAL);
}

// Dựng HTML báo cáo. expanded = true thì hiện toàn bộ món.
function _buildDrinkStatsHtml(itemsArray, limit) {
    var totalQty = 0, totalAmount = 0;
    for (var t = 0; t < itemsArray.length; t++) {
        totalQty += itemsArray[t].qty;
        totalAmount += itemsArray[t].amount;
    }
    var parts = [];
    parts.push('<div class="stats-summary">📦 <b>' + totalQty + '</b> ly · 💰 ' + formatMoney(totalAmount) +
        ' · <span class="stats-sum-sub">' + itemsArray.length + ' món</span></div>');
    parts.push('<div class="stats-list" id="drinkStatsList">');
    var shown = Math.min(limit, itemsArray.length);
    for (var k = 0; k < shown; k++) {
        parts.push(_drinkStatsRowHtml(k + 1, itemsArray[k]));
    }
    parts.push('</div>');
    if (itemsArray.length > shown) {
        parts.push('<button class="cus-expand-btn" id="btnMoreDrinks" onclick="toggleMoreDrinks()">📋 Xem thêm ' +
            (itemsArray.length - shown) + ' món</button>');
    } else {
        parts.push('<div style="text-align:center;font-size:11px;color:#94a3b8;padding:6px 0;">Đã hiện đủ ' +
            itemsArray.length + ' món</div>');
    }
    return parts.join('');
}

function _drinkStatsRowHtml(stt, row) {
    // Tách tên gốc và biến thể để hiển thị 2 tầng cho dễ đọc
    var name = row.name;
    var variant = '';
    var baseName = name;
    var m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (m) {
        baseName = m[1];
        variant = m[2];
    }
    var html = '<div class="stats-item stats-item-item">';
    html += '<div class="drink-main">';
    html += '<span class="drink-stt">' + stt + '.</span>';
    html += '<span class="drink-name">' + escapeHtml(baseName);
    if (variant) html += ' <span class="drink-variant">(' + escapeHtml(variant) + ')</span>';
    html += '</span>';
    // Các cột theo kênh bán: chỉ hiện cột có số liệu
    html += '</div>';
    html += '<div class="drink-channels">';
    if (row.dinein) html += '<span class="drink-ch drink-ch-table" title="Tại bàn">🍽 ' + row.dinein + '</span>';
    if (row.takeaway) html += '<span class="drink-ch drink-ch-takeaway" title="Mang đi">🥡 ' + row.takeaway + '</span>';
    if (row.grab) html += '<span class="drink-ch drink-ch-grab" title="Grab">🛵 ' + row.grab + '</span>';
    html += '<span class="stats-qty drink-total">📦 ' + row.qty + '</span>';
    html += '</div></div>';
    return html;
}

// Bấm "Xem thêm" -> hiện toàn bộ món, kèm nút "Thu gọn"
// Dùng innerHTML cho cả khối thay vì insertAdjacentHTML vì một số WebView
// Android cũ không hỗ trợ hàm đó.
var _drinkStatsExpanded = false;

function toggleMoreDrinks() {
    var container = document.getElementById('managerDrinkStats');
    if (!container) return;
    _drinkStatsExpanded = !_drinkStatsExpanded;
    if (!_drinkStatsExpanded) {
        // Thu gọn: dựng lại từ đầu để có tổng kết và nút "Xem thêm"
        container.innerHTML = _buildDrinkStatsHtml(_drinkStatsAll, DRINK_STATS_INITIAL);
        return;
    }
    // Mở rộng: hiện toàn bộ
    var parts = ['<div class="stats-list" id="drinkStatsList">'];
    for (var k = 0; k < _drinkStatsAll.length; k++) {
        parts.push(_drinkStatsRowHtml(k + 1, _drinkStatsAll[k]));
    }
    parts.push('</div>');
    parts.push('<div style="text-align:center;padding:6px 0;">' +
        '<button class="cus-expand-btn" onclick="toggleMoreDrinks()">📋 Thu gọn về ' +
        DRINK_STATS_INITIAL + ' món</button></div>');
    container.innerHTML = parts.join('');
}

// Hàm gọi bằng onclick="" trong HTML phải có trong window
window.toggleMoreDrinks = toggleMoreDrinks;
window.renderDrinkStats = renderDrinkStats;

// ========== CẢNH BÁO TỒN KHO THẤP ==========
// NOTE: bản thứ 2 của renderLowStockAlert (bản dùng thật nằm ở manager-detail.js).
// File này hiện KHÔNG được index.html load, nhưng đổi tên để tránh đè lên bản của
// manager-detail.js nếu sau này được thêm vào danh sách script.
function managerRenderLowStockAlert() {
    var container = document.getElementById('managerLowStockAlert');
    if (!container) return;
    var ingredients = window.ingredients || [];
    if (ingredients.length === 0) {
        container.innerHTML = '<div class="empty-state">📦 Chưa có nguyên liệu</div>';
        return;
    }
    var minStockSetting = parseInt(localStorage.getItem('settingMinStock') || '10');
    var lowItems = [];
    for (var i = 0; i < ingredients.length; i++) {
        var ing = ingredients[i];
        var threshold = ing.minStock || minStockSetting;
        if (ing.stock <= threshold) {
            lowItems.push(ing);
        }
    }
    if (lowItems.length === 0) {
        container.innerHTML = '<div class="empty-state">✅ Tất cả nguyên liệu đủ tồn kho</div>';
        return;
    }
    var html = '<div class="alert-list">';
    for (var j = 0; j < lowItems.length; j++) {
        var ing = lowItems[j];
        html += '<div class="alert-item">' +
            '<span class="alert-name">⚠️ ' + escapeHtml(ing.name) + '</span>' +
            '<span class="alert-stock">Tồn: ' + ing.stock + ' ' + ing.unit + '</span>' +
        '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}
// ========== LỊCH SỬ DOANH THU ==========
// ========== LỊCH SỬ DOANH THU THEO NGÀY (CÓ THỂ MỞ RỘNG) ==========
function showRevenueHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    
    // Lọc chỉ lấy dinein và takeaway (không tính debt_payment) và chưa refund
    var revenueTrans = [];
    for (var i = 0; i < filteredTrans.length; i++) {
        var tx = filteredTrans[i];
        if ((tx.type === 'dinein' || tx.type === 'takeaway') && tx.refunded !== true) {
            revenueTrans.push(tx);
        }
    }
    
    // Nhóm theo ngày (YYYY-MM-DD)
    var groups = {};
    for (var i = 0; i < revenueTrans.length; i++) {
        var tx = revenueTrans[i];
        var dateKey = tx.dateKey || tx.date.slice(0,10);
        if (!groups[dateKey]) {
            groups[dateKey] = {
                transactions: [],
                totalAmount: 0,
                totalCount: 0
            };
        }
        groups[dateKey].transactions.push(tx);
        groups[dateKey].totalAmount += tx.amount;
        groups[dateKey].totalCount++;
    }
    
    // Chuyển thành mảng và sắp xếp ngày giảm dần (mới nhất trước)
    var groupList = [];
    for (var date in groups) {
        groupList.push({
            date: date,
            totalAmount: groups[date].totalAmount,
            totalCount: groups[date].totalCount,
            transactions: groups[date].transactions
        });
    }
    groupList.sort(function(a, b) { return b.date.localeCompare(a.date); });
    
    if (groupList.length === 0) {
        document.getElementById('historyDetailContent').innerHTML = '<div class="empty-state">📭 Không có giao dịch doanh thu trong khoảng thời gian này</div>';
        document.getElementById('historyDetailTitle').innerHTML = '📋 Lịch sử Doanh thu';
        document.getElementById('historyDetailModal').style.display = 'flex';
        return;
    }
    
    var html = '<div class="history-date-list">';
    for (var i = 0; i < groupList.length; i++) {
        var group = groupList[i];
        var dateObj = new Date(group.date);
        var dateStr = dateObj.toLocaleDateString('vi-VN');
        html += '<div class="history-date-group" data-date="' + group.date + '">' +
            '<div class="history-date-header" onclick="toggleHistoryDateGroup(this)">' +
                '<span class="history-date-title">📅 ' + dateStr + '</span>' +
                '<span class="history-date-summary">' +
                    '<span>📦 ' + group.totalCount + ' giao dịch</span>' +
                    '<span class="history-date-amount">' + formatMoney(group.totalAmount) + '</span>' +
                    '<span class="toggle-icon">▼</span>' +
                '</span>' +
            '</div>' +
            '<div class="history-date-items">';
        
        // Chi tiết từng giao dịch trong ngày
        var txList = group.transactions;
        txList.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
        for (var j = 0; j < txList.length; j++) {
            var tx = txList[j];
            var timeStr = new Date(tx.date).toLocaleTimeString('vi-VN');
            var totalItems = 0;
            if (tx.items) {
                for (var k = 0; k < tx.items.length; k++) {
                    totalItems += tx.items[k].qty;
                }
            }
            html += '<div class="history-date-item">' +
                '<div class="history-date-item-time">' + timeStr + ' - ' + (tx.type === 'dinein' ? '🍽️ Tại chỗ' : '🛵 Mang đi') + ' - ' + (tx.paymentMethod === 'cash' ? '💰 TM' : '💳 CK') + ' - 📦 ' + totalItems + ' món' +
                (tx.tableName ? ' - 🪑 ' + tx.tableName : '') +
                '</div>' +
                '<div class="history-date-item-amount">' + formatMoney(tx.amount) + '</div>' +
            '</div>';
        }
        html += '</div></div>';
    }
    html += '</div>';
    
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '📋 Lịch sử Doanh thu';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== LỊCH SỬ CHUYỂN KHOẢN THEO NGÀY ==========
function showTransferHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    
    // Lọc giao dịch chuyển khoản, chưa refund
    var transferTrans = [];
    for (var i = 0; i < filteredTrans.length; i++) {
        var tx = filteredTrans[i];
        if (tx.paymentMethod === 'transfer' && tx.refunded !== true) {
            transferTrans.push(tx);
        }
    }
    
    // Nhóm theo ngày
    var groups = {};
    for (var i = 0; i < transferTrans.length; i++) {
        var tx = transferTrans[i];
        var dateKey = tx.dateKey || tx.date.slice(0,10);
        if (!groups[dateKey]) {
            groups[dateKey] = {
                transactions: [],
                totalAmount: 0,
                totalCount: 0
            };
        }
        groups[dateKey].transactions.push(tx);
        groups[dateKey].totalAmount += tx.amount;
        groups[dateKey].totalCount++;
    }
    
    var groupList = [];
    for (var date in groups) {
        groupList.push({
            date: date,
            totalAmount: groups[date].totalAmount,
            totalCount: groups[date].totalCount,
            transactions: groups[date].transactions
        });
    }
    groupList.sort(function(a, b) { return b.date.localeCompare(a.date); });
    
    if (groupList.length === 0) {
        document.getElementById('historyDetailContent').innerHTML = '<div class="empty-state">📭 Không có giao dịch chuyển khoản trong khoảng thời gian này</div>';
        document.getElementById('historyDetailTitle').innerHTML = '💳 Lịch sử Chuyển khoản';
        document.getElementById('historyDetailModal').style.display = 'flex';
        return;
    }
    
    var html = '<div class="history-date-list">';
    for (var i = 0; i < groupList.length; i++) {
        var group = groupList[i];
        var dateObj = new Date(group.date);
        var dateStr = dateObj.toLocaleDateString('vi-VN');
        html += '<div class="history-date-group" data-date="' + group.date + '">' +
            '<div class="history-date-header" onclick="toggleHistoryDateGroup(this)">' +
                '<span class="history-date-title">📅 ' + dateStr + '</span>' +
                '<span class="history-date-summary">' +
                    '<span>📦 ' + group.totalCount + ' giao dịch</span>' +
                    '<span class="history-date-amount">' + formatMoney(group.totalAmount) + '</span>' +
                    '<span class="toggle-icon">▼</span>' +
                '</span>' +
            '</div>' +
            '<div class="history-date-items">';
        
        var txList = group.transactions;
        txList.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
        for (var j = 0; j < txList.length; j++) {
            var tx = txList[j];
            var timeStr = new Date(tx.date).toLocaleTimeString('vi-VN');
            var typeText = (tx.type === 'dinein') ? '🍽️ Tại chỗ' : ((tx.type === 'takeaway') ? '🛵 Mang đi' : '💰 Thanh toán nợ');
            html += '<div class="history-date-item">' +
                '<div class="history-date-item-time">' + timeStr + ' - ' + typeText + (tx.tableName ? ' - 🪑 ' + tx.tableName : '') + '</div>' +
                '<div class="history-date-item-amount">' + formatMoney(tx.amount) + '</div>' +
            '</div>';
        }
        html += '</div></div>';
    }
    html += '</div>';
    
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '💳 Lịch sử Chuyển khoản';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== LỊCH SỬ THỰC NHẬN THEO NGÀY (CÓ CHI TIẾT) ==========
function showCashReceivedHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    var filteredCosts = managerFilterByDateRange(managerData.costTransactions, range.startDate, range.endDate);
    var filteredAdminCosts = managerFilterByDateRange(managerData.adminCostTransactions, range.startDate, range.endDate);
    
    // Nhóm giao dịch theo ngày để tính thực nhận
    var groups = {};
    
    // Xử lý giao dịch thu tiền
    for (var i = 0; i < filteredTrans.length; i++) {
        var tx = filteredTrans[i];
        if (tx.refunded === true) continue;
        var dateKey = tx.dateKey || tx.date.slice(0,10);
        if (!groups[dateKey]) {
            groups[dateKey] = {
                cashIn: 0,      // tiền mặt thu vào
                transferIn: 0,  // chuyển khoản thu vào
                staffCost: 0,   // chi phí nhân viên
                adminCost: 0,   // chi phí quản lý
                txList: [],
                costList: [],
                adminCostList: []
            };
        }
        if (tx.paymentMethod === 'cash') {
            groups[dateKey].cashIn += tx.amount;
        } else if (tx.paymentMethod === 'transfer') {
            groups[dateKey].transferIn += tx.amount;
        }
        groups[dateKey].txList.push(tx);
    }
    
    // Xử lý chi phí nhân viên theo ngày
    for (var j = 0; j < filteredCosts.length; j++) {
        var cost = filteredCosts[j];
        if (cost.deleted) continue;
        var dateKey = cost.dateKey || cost.date.slice(0,10);
        if (groups[dateKey]) {
            groups[dateKey].staffCost += cost.amount;
            groups[dateKey].costList.push(cost);
        } else {
            groups[dateKey] = {
                cashIn: 0, transferIn: 0, staffCost: cost.amount, adminCost: 0,
                txList: [], costList: [cost], adminCostList: []
            };
        }
    }
    
    // Xử lý chi phí quản lý theo ngày
    for (var k = 0; k < filteredAdminCosts.length; k++) {
        var adminCost = filteredAdminCosts[k];
        if (adminCost.deleted) continue;
        var dateKey = adminCost.dateKey || adminCost.date.slice(0,10);
        if (groups[dateKey]) {
            groups[dateKey].adminCost += adminCost.amount;
            groups[dateKey].adminCostList.push(adminCost);
        } else {
            groups[dateKey] = {
                cashIn: 0, transferIn: 0, staffCost: 0, adminCost: adminCost.amount,
                txList: [], costList: [], adminCostList: [adminCost]
            };
        }
    }
    
    // Chuyển thành mảng và tính thực nhận
    var groupList = [];
    for (var date in groups) {
        var g = groups[date];
        var totalReceived = g.cashIn + g.transferIn - g.staffCost - g.adminCost;
        groupList.push({
            date: date,
            cashIn: g.cashIn,
            transferIn: g.transferIn,
            staffCost: g.staffCost,
            adminCost: g.adminCost,
            totalReceived: totalReceived,
            txList: g.txList,
            costList: g.costList,
            adminCostList: g.adminCostList
        });
    }
    groupList.sort(function(a, b) { return b.date.localeCompare(a.date); });
    
    if (groupList.length === 0) {
        document.getElementById('historyDetailContent').innerHTML = '<div class="empty-state">📭 Không có dữ liệu thực nhận trong khoảng thời gian này</div>';
        document.getElementById('historyDetailTitle').innerHTML = '💵 Lịch sử Thực nhận';
        document.getElementById('historyDetailModal').style.display = 'flex';
        return;
    }
    
    var html = '<div class="history-date-list">';
    for (var i = 0; i < groupList.length; i++) {
        var group = groupList[i];
        var dateObj = new Date(group.date);
        var dateStr = dateObj.toLocaleDateString('vi-VN');
        html += '<div class="history-date-group" data-date="' + group.date + '">' +
            '<div class="history-date-header" onclick="toggleHistoryDateGroup(this)">' +
                '<span class="history-date-title">📅 ' + dateStr + '</span>' +
                '<span class="history-date-summary">' +
                    '<span>💰 Thu: ' + formatMoney(group.cashIn + group.transferIn) + '</span>' +
                    '<span class="history-date-amount">📉 Nhận: ' + formatMoney(group.totalReceived) + '</span>' +
                    '<span class="toggle-icon">▼</span>' +
                '</span>' +
            '</div>' +
            '<div class="history-date-items">' +
                '<div class="history-date-subsection">' +
                    '<div class="history-date-subtitle">💰 Thu tiền</div>';
        
        // Chi tiết thu tiền
        if (group.txList.length > 0) {
            var txSorted = group.txList.slice().sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
            for (var j = 0; j < txSorted.length; j++) {
                var tx = txSorted[j];
                var timeStr = new Date(tx.date).toLocaleTimeString('vi-VN');
                var paymentIcon = (tx.paymentMethod === 'cash') ? '💰 TM' : '💳 CK';
                html += '<div class="history-date-item">' +
                    '<div class="history-date-item-time">' + timeStr + ' - ' + paymentIcon + ' - ' + (tx.type === 'dinein' ? '🍽️ Tại chỗ' : (tx.type === 'takeaway' ? '🛵 Mang đi' : '💰 Nợ')) + (tx.tableName ? ' - 🪑 ' + tx.tableName : '') + '</div>' +
                    '<div class="history-date-item-amount">+' + formatMoney(tx.amount) + '</div>' +
                '</div>';
            }
        } else {
            html += '<div class="history-date-item">Không có giao dịch thu tiền</div>';
        }
        
        html += '</div>' +
            '<div class="history-date-subsection">' +
                '<div class="history-date-subtitle">📉 Chi phí nhân viên</div>';
        
        // Chi tiết chi phí nhân viên
        if (group.costList.length > 0) {
            var costSorted = group.costList.slice().sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
            for (var k = 0; k < costSorted.length; k++) {
                var cost = costSorted[k];
                var timeStr = new Date(cost.date).toLocaleTimeString('vi-VN');
                html += '<div class="history-date-item">' +
                    '<div class="history-date-item-time">' + timeStr + ' - ' + escapeHtml(cost.categoryName) + (cost.quantity > 1 ? ' x' + cost.quantity : '') + '</div>' +
                    '<div class="history-date-item-amount" style="color:var(--danger);">-' + formatMoney(cost.amount) + '</div>' +
                '</div>';
            }
        } else {
            html += '<div class="history-date-item">Không có chi phí nhân viên</div>';
        }
        
        html += '</div>' +
            '<div class="history-date-subsection">' +
                '<div class="history-date-subtitle">📋 Chi phí quản lý</div>';
        
        // Chi tiết chi phí quản lý
        if (group.adminCostList.length > 0) {
            var adminSorted = group.adminCostList.slice().sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
            for (var l = 0; l < adminSorted.length; l++) {
                var adminCost = adminSorted[l];
                var timeStr = new Date(adminCost.date).toLocaleTimeString('vi-VN');
                html += '<div class="history-date-item">' +
                    '<div class="history-date-item-time">' + timeStr + ' - ' + escapeHtml(adminCost.categoryName) + (adminCost.quantity > 1 ? ' x' + adminCost.quantity : '') + '</div>' +
                    '<div class="history-date-item-amount" style="color:var(--danger);">-' + formatMoney(adminCost.amount) + '</div>' +
                '</div>';
            }
        } else {
            html += '<div class="history-date-item">Không có chi phí quản lý</div>';
        }
        
        html += '</div>' +
            '<div class="history-date-total">' +
                '<strong>💰 Thực nhận: ' + formatMoney(group.totalReceived) + '</strong>' +
            '</div>' +
        '</div></div>';
    }
    html += '</div>';
    
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '💵 Lịch sử Thực nhận';
    document.getElementById('historyDetailModal').style.display = 'flex';
}
// Hàm toggle mở rộng nhóm ngày (gọi từ onclick)
window.toggleHistoryDateGroup = function(headerElement) {
    var groupDiv = headerElement.closest('.history-date-group');
    if (!groupDiv) return;
    var itemsDiv = groupDiv.querySelector('.history-date-items');
    if (itemsDiv) {
        itemsDiv.classList.toggle('expanded');
        var toggleIcon = headerElement.querySelector('.toggle-icon');
        if (toggleIcon) {
            if (itemsDiv.classList.contains('expanded')) {
                toggleIcon.style.transform = 'rotate(180deg)';
            } else {
                toggleIcon.style.transform = 'rotate(0deg)';
            }
        }
    }
};
// ========== LỊCH SỬ GRAB THEO NGÀY ==========
function showGrabHistory() {
    var range = managerGetDateRangeByMode();
    if (!range.startDate || !range.endDate) return;
    var filteredTrans = managerFilterByDateRange(managerData.transactions, range.startDate, range.endDate);
    
    // Lọc giao dịch type === 'grab', chưa refund
    var grabTrans = [];
    for (var i = 0; i < filteredTrans.length; i++) {
        var tx = filteredTrans[i];
        if (tx.type === 'grab' && tx.refunded !== true) {
            grabTrans.push(tx);
        }
    }
    
    // Nhóm theo ngày
    var groups = {};
    for (var i = 0; i < grabTrans.length; i++) {
        var tx = grabTrans[i];
        var dateKey = tx.dateKey || tx.date.slice(0,10);
        if (!groups[dateKey]) {
            groups[dateKey] = {
                transactions: [],
                totalAmount: 0,
                totalCount: 0
            };
        }
        groups[dateKey].transactions.push(tx);
        groups[dateKey].totalAmount += tx.amount;
        groups[dateKey].totalCount++;
    }
    
    var groupList = [];
    for (var date in groups) {
        groupList.push({
            date: date,
            totalAmount: groups[date].totalAmount,
            totalCount: groups[date].totalCount,
            transactions: groups[date].transactions
        });
    }
    groupList.sort(function(a, b) { return b.date.localeCompare(a.date); });
    
    if (groupList.length === 0) {
        document.getElementById('historyDetailContent').innerHTML = '<div class="empty-state">📭 Không có đơn Grab trong khoảng thời gian này</div>';
        document.getElementById('historyDetailTitle').innerHTML = '🚕 Lịch sử Grab';
        document.getElementById('historyDetailModal').style.display = 'flex';
        return;
    }
    
    var html = '<div class="history-date-list">';
    for (var i = 0; i < groupList.length; i++) {
        var group = groupList[i];
        var dateObj = new Date(group.date);
        var dateStr = dateObj.toLocaleDateString('vi-VN');
        html += '<div class="history-date-group" data-date="' + group.date + '">' +
            '<div class="history-date-header" onclick="toggleHistoryDateGroup(this)">' +
                '<span class="history-date-title">📅 ' + dateStr + '</span>' +
                '<span class="history-date-summary">' +
                    '<span>📦 ' + group.totalCount + ' đơn</span>' +
                    '<span class="history-date-amount">' + formatMoney(group.totalAmount) + '</span>' +
                    '<span class="toggle-icon">▼</span>' +
                '</span>' +
            '</div>' +
            '<div class="history-date-items">';
        
        var txList = group.transactions;
        txList.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
        for (var j = 0; j < txList.length; j++) {
            var tx = txList[j];
            var timeStr = new Date(tx.date).toLocaleTimeString('vi-VN');
            var totalItems = 0;
            if (tx.items) {
                for (var k = 0; k < tx.items.length; k++) {
                    totalItems += tx.items[k].qty;
                }
            }
            var itemsStr = '';
            if (tx.items) {
                for (var k = 0; k < tx.items.length; k++) {
                    if (k > 0) itemsStr += ', ';
                    itemsStr += tx.items[k].name + ' x' + tx.items[k].qty;
                }
            }
            html += '<div class="history-date-item">' +
                '<div class="history-date-item-time">' + timeStr + ' - 📦 ' + totalItems + ' món</div>' +
                '<div class="history-date-item-amount">' + formatMoney(tx.amount) + '</div>' +
            '</div>';
            if (itemsStr) {
                html += '<div class="history-date-item-detail">' + escapeHtml(itemsStr) + '</div>';
            }
        }
        html += '</div></div>';
    }
    html += '</div>';
    
    document.getElementById('historyDetailContent').innerHTML = html;
    document.getElementById('historyDetailTitle').innerHTML = '🚕 Lịch sử Grab';
    document.getElementById('historyDetailModal').style.display = 'flex';
}

// ========== QUẢN LÝ CHI PHÍ NHÂN VIÊN ==========
var costCategories = [];
var costTransactions = [];

// ========== QUẢN LÝ CHI PHÍ QUẢN LÝ ==========
var adminCostCategories = [];
var adminCostTransactions = [];

// Load dữ liệu
async function loadStaffCostData() {
    costCategories = await DB.getAll('cost_categories') || [];
    costTransactions = await DB.getAll('cost_transactions') || [];
    window.costCategories = costCategories;
    window.costTransactions = costTransactions;
}

async function loadAdminCostData() {
    adminCostCategories = await DB.getAll('admin_cost_categories') || [];
    adminCostTransactions = await DB.getAll('cost_transactions_admin') || [];
    window.adminCostCategories = adminCostCategories;
    window.adminCostTransactions = adminCostTransactions;
}

// Render danh sách danh mục (dạng grid)
function renderRecentCategories(container, categories, type) {
    if (!container) return;
    if (categories.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có danh mục</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < categories.length; i++) {
        var cat = categories[i];
        html += '<div class="recent-item">' +
            '<button class="recent-btn" onclick="setExpenseName(\'' + escapeHtml(cat.name) + '\', \'' + type + '\')">📦 ' + escapeHtml(cat.name) + '</button>' +
            '<button class="action-btn-edit" onclick="editExpenseName(\'' + cat.id + '\', \'' + escapeHtml(cat.name) + '\', \'' + type + '\')">✏️</button>' +
            '<button class="action-btn-delete" onclick="deleteExpenseCategory(\'' + cat.id + '\', \'' + type + '\')">🗑️</button>' +
        '</div>';
    }
    container.innerHTML = html;
}

// Tạo danh mục mới
async function createNewCategory(name, type) {
    var newId = Date.now().toString();
    var category = { id: newId, name: name, createdAt: Date.now(), createdBy: window.currentDeviceId };
    if (type === 'staff') {
        await DB.create('cost_categories', category);
        costCategories.push(category);
        renderRecentCategories(document.getElementById('recentCategoriesList'), costCategories, 'staff');
    } else {
        await DB.create('admin_cost_categories', category);
        adminCostCategories.push(category);
        renderRecentCategories(document.getElementById('adminRecentCategoriesList'), adminCostCategories, 'admin');
    }
    return category;
}

// Render chi phí hôm nay
function renderTodayCosts(container, totalSpan, transactions) {
    if (!container || !totalSpan) return;
    // FIX: dùng giờ VN thay vì toISOString (giờ UTC)
    var todayStr = _toLocalDateStr(new Date());
    var todayTxs = transactions.filter(function(tx) {
        return (_itemDateStr(tx) === todayStr) && !tx.deleted;
    });
    todayTxs.sort(function(a,b) { return new Date(b.date) - new Date(a.date); });
    var total = 0;
    if (todayTxs.length === 0) {
        container.innerHTML = '<div class="empty-text">📭 Chưa có dữ liệu chi phí</div>';
        totalSpan.innerText = 'Tổng: 0đ';
        return;
    }
    var html = '';
    for (var i = 0; i < todayTxs.length; i++) {
        var tx = todayTxs[i];
        total += tx.amount;
        html += '<div class="today-cost-item">' +
            '<div class="today-cost-name">' + escapeHtml(tx.categoryName) + (tx.quantity > 1 ? ' x' + tx.quantity : '') + '</div>' +
            '<div class="today-cost-amount">' + formatMoney(tx.amount) + '</div>' +
        '</div>';
    }
    container.innerHTML = html;
    totalSpan.innerText = 'Tổng: ' + formatMoney(total);
}

// Render lịch sử tháng
function renderMonthCostSummary(container, transactions) {
    if (!container) return;
    var now = new Date();
    var startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    var endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    // FIX: dùng giờ VN thay vì toISOString (giờ UTC)
    var startStr = _toLocalDateStr(startDate);
    var endStr = _toLocalDateStr(endDate);
    var monthTxs = transactions.filter(function(tx) {
        // FIX: lấy ngày theo một cách duy nhất, tránh lỗi khi tx.date thiếu
        var d = _itemDateStr(tx);
        return d && d >= startStr && d <= endStr && !tx.deleted;
    });
    var categoryMap = {};
    for (var i = 0; i < monthTxs.length; i++) {
        var tx = monthTxs[i];
        if (!categoryMap[tx.categoryName]) {
            categoryMap[tx.categoryName] = 0;
        }
        categoryMap[tx.categoryName] += tx.amount;
    }
    var items = [];
    for (var name in categoryMap) {
        items.push({ name: name, amount: categoryMap[name] });
    }
    items.sort(function(a,b) { return b.amount - a.amount; });
    if (items.length === 0) {
        container.innerHTML = '<div class="empty-text">📭 Chưa có dữ liệu tháng này</div>';
        return;
    }
    var html = '<div class="month-cost-grid">';
    for (var j = 0; j < items.length; j++) {
        html += '<div class="month-cost-item">' +
            '<span>' + escapeHtml(items[j].name) + '</span>' +
            '<span>' + formatMoney(items[j].amount) + '</span>' +
        '</div>';
    }
    html += '</div>';
    container.innerHTML = html;
}

// Mở popup chi phí nhân viên
async function openStaffCostModal() {
    await loadStaffCostData();
    var modal = document.getElementById('costModal');
    var nameInput = document.getElementById('expenseNameInput');
    var amountInput = document.getElementById('expenseAmount');
    var qtyInput = document.getElementById('expenseQty');
    var title = document.getElementById('expensePopupTitle');
    if (title) title.innerText = 'Thêm chi phí Nhân viên';
    if (nameInput) nameInput.value = '';
    if (amountInput) amountInput.value = '';
    if (qtyInput) qtyInput.value = '1';
    renderRecentCategories(document.getElementById('recentCategoriesList'), costCategories, 'staff');
    renderTodayCosts(document.getElementById('todayCostList'), document.getElementById('todayCostTotal'), costTransactions);
    renderMonthCostSummary(document.getElementById('monthCostCategoryList'), costTransactions);
    modal.style.display = 'flex';
}

// Mở popup chi phí quản lý
async function openAdminCostModal() {
    await loadAdminCostData();
    var modal = document.getElementById('adminCostModal');
    var nameInput = document.getElementById('adminExpenseNameInput');
    var amountInput = document.getElementById('adminExpenseAmount');
    var qtyInput = document.getElementById('adminExpenseQty');
    var title = document.getElementById('adminExpensePopupTitle');
    if (title) title.innerText = 'Thêm chi phí Quản lý';
    if (nameInput) nameInput.value = '';
    if (amountInput) amountInput.value = '';
    if (qtyInput) qtyInput.value = '1';
    renderRecentCategories(document.getElementById('adminRecentCategoriesList'), adminCostCategories, 'admin');
    renderTodayCosts(document.getElementById('adminTodayCostList'), document.getElementById('adminTodayCostTotal'), adminCostTransactions);
    renderMonthCostSummary(document.getElementById('adminMonthCostCategoryList'), adminCostTransactions);
    modal.style.display = 'flex';
}

// Lưu chi phí (dùng chung)
async function saveExpenseInternal(type) {
    var categoryName, amount, quantity, collection, categories, containerId;
    if (type === 'staff') {
        categoryName = document.getElementById('expenseNameInput').value.trim();
        amount = parseInt(document.getElementById('expenseAmount').value) || 0;
        quantity = parseInt(document.getElementById('expenseQty').value) || 1;
        collection = 'cost_transactions';
        categories = costCategories;
        containerId = 'recentCategoriesList';
    } else {
        categoryName = document.getElementById('adminExpenseNameInput').value.trim();
        amount = parseInt(document.getElementById('adminExpenseAmount').value) || 0;
        quantity = parseInt(document.getElementById('adminExpenseQty').value) || 1;
        collection = 'cost_transactions_admin';
        categories = adminCostCategories;
        containerId = 'adminRecentCategoriesList';
    }
    
    if (!categoryName) {
        showToast('Vui lòng nhập hoặc chọn danh mục chi phí!', 'warning');
        return;
    }
    if (amount <= 0) {
        showToast('Số tiền phải lớn hơn 0!', 'warning');
        return;
    }
    
    var category = categories.find(function(c) { return c.name === categoryName; });
    if (!category) {
        category = await createNewCategory(categoryName, type);
    }
    
    var nowDate = new Date();
    var nowStr = nowDate.toISOString();
    var data = {
        categoryId: category.id,
        categoryName: category.name,
        amount: amount,
        quantity: quantity,
        note: '',
        date: nowStr,
        dateKey: nowStr.slice(0,10),
        createdAt: Date.now(),
        createdBy: window.currentDeviceId,
        deleted: false
    };
    await DB.create(collection, data);
    
    // Refresh
    if (type === 'staff') {
        costTransactions = await DB.getAll('cost_transactions');
        window.costTransactions = costTransactions;
        renderTodayCosts(document.getElementById('todayCostList'), document.getElementById('todayCostTotal'), costTransactions);
        renderMonthCostSummary(document.getElementById('monthCostCategoryList'), costTransactions);
        document.getElementById('expenseAmount').value = '';
    } else {
        adminCostTransactions = await DB.getAll('cost_transactions_admin');
        window.adminCostTransactions = adminCostTransactions;
        renderTodayCosts(document.getElementById('adminTodayCostList'), document.getElementById('adminTodayCostTotal'), adminCostTransactions);
        renderMonthCostSummary(document.getElementById('adminMonthCostCategoryList'), adminCostTransactions);
        document.getElementById('adminExpenseAmount').value = '';
    }
    
    showToast('✅ Đã thêm chi phí ' + (type === 'staff' ? 'nhân viên' : 'quản lý'), 'success');
    
    // Cập nhật manager nếu đang mở
    var managerView = document.getElementById('managerView');
    if (managerView && managerView.classList.contains('active') && typeof managerApplyFilter === 'function') {
        managerApplyFilter();
    }
}

// Các hàm xử lý danh mục (sửa, xóa)
window.setExpenseName = function(name, type) {
    if (type === 'staff') {
        document.getElementById('expenseNameInput').value = name;
    } else {
        document.getElementById('adminExpenseNameInput').value = name;
    }
};

window.editExpenseName = async function(id, oldName, type) {
    var newName = prompt('Nhập tên mới cho danh mục:', oldName);
    if (!newName || newName === oldName) return;
    var categories = (type === 'staff') ? costCategories : adminCostCategories;
    if (categories.some(function(c) { return c.name === newName; })) {
        showToast('Danh mục đã tồn tại!', 'warning');
        return;
    }
    var collectionName = (type === 'staff') ? 'cost_categories' : 'admin_cost_categories';
    await DB.update(collectionName, id, { name: newName, updatedAt: Date.now() });
    if (type === 'staff') {
        costCategories = await DB.getAll('cost_categories');
        window.costCategories = costCategories;
        renderRecentCategories(document.getElementById('recentCategoriesList'), costCategories, 'staff');
    } else {
        adminCostCategories = await DB.getAll('admin_cost_categories');
        window.adminCostCategories = adminCostCategories;
        renderRecentCategories(document.getElementById('adminRecentCategoriesList'), adminCostCategories, 'admin');
    }
    showToast('Đã sửa danh mục', 'success');
};

window.deleteExpenseCategory = async function(id, type) {
    var used = false;
    if (type === 'staff') {
        used = costTransactions.some(function(tx) { return tx.categoryId === id && !tx.deleted; });
    } else {
        used = adminCostTransactions.some(function(tx) { return tx.categoryId === id && !tx.deleted; });
    }
    if (used) {
        showToast('Danh mục đã có giao dịch, không thể xóa!', 'error');
        return;
    }
    if (!confirm('Xóa danh mục này?')) return;
    var collectionName = (type === 'staff') ? 'cost_categories' : 'admin_cost_categories';
    await DB.remove(collectionName, id);
    if (type === 'staff') {
        costCategories = await DB.getAll('cost_categories');
        window.costCategories = costCategories;
        renderRecentCategories(document.getElementById('recentCategoriesList'), costCategories, 'staff');
    } else {
        adminCostCategories = await DB.getAll('admin_cost_categories');
        window.adminCostCategories = adminCostCategories;
        renderRecentCategories(document.getElementById('adminRecentCategoriesList'), adminCostCategories, 'admin');
    }
    showToast('Đã xóa danh mục', 'success');
};

// Gắn sự kiện
function attachCostPopupEvents() {
    var quickCostBtn = document.getElementById('quickCostBtn');
    if (quickCostBtn) quickCostBtn.onclick = openStaffCostModal;
    
    var adminExpenseBtn = document.getElementById('adminExpenseFab');
    if (adminExpenseBtn) {
        adminExpenseBtn.onclick = function(e) {
            e.stopPropagation();
            openAdminCostModal();
        };
    }
    
    var saveStaffBtn = document.getElementById('saveExpenseBtn');
    if (saveStaffBtn) saveStaffBtn.onclick = function() { saveExpenseInternal('staff'); };
    
    var saveAdminBtn = document.getElementById('saveAdminExpenseBtn');
    if (saveAdminBtn) saveAdminBtn.onclick = function() { saveExpenseInternal('admin'); };
    
    // Close buttons
    var closeStaff = document.querySelectorAll('[data-close="costModal"]');
    for (var i = 0; i < closeStaff.length; i++) {
        closeStaff[i].onclick = function() { closeModal('costModal'); };
    }
    var closeAdmin = document.querySelectorAll('[data-close="adminCostModal"]');
    for (var j = 0; j < closeAdmin.length; j++) {
        closeAdmin[j].onclick = function() { closeModal('adminCostModal'); };
    }
    
    // Quick money buttons
    var quickStaff = document.querySelectorAll('#costModal .quick-money-btn');
    for (var k = 0; k < quickStaff.length; k++) {
        quickStaff[k].onclick = function() {
            var amount = this.getAttribute('data-amount');
            document.getElementById('expenseAmount').value = amount;
        };
    }
    var quickAdmin = document.querySelectorAll('#adminCostModal .quick-money-btn');
    for (var l = 0; l < quickAdmin.length; l++) {
        quickAdmin[l].onclick = function() {
            var amount = this.getAttribute('data-amount');
            document.getElementById('adminExpenseAmount').value = amount;
        };
    }
    
    // Filter
    function initFilter(inputId, listId) {
        var input = document.getElementById(inputId);
        if (!input) return;
        input.addEventListener('input', function() {
            var keyword = this.value.trim().toLowerCase();
            var items = document.querySelectorAll('#' + listId + ' .recent-item');
            for (var i = 0; i < items.length; i++) {
                var btn = items[i].querySelector('.recent-btn');
                if (!btn) continue;
                var name = btn.innerText.replace('📦', '').trim().toLowerCase();
                items[i].style.display = (keyword === '' || name.indexOf(keyword) !== -1) ? 'flex' : 'none';
            }
        });
    }
    initFilter('expenseNameInput', 'recentCategoriesList');
    initFilter('adminExpenseNameInput', 'adminRecentCategoriesList');
}

// Helper: format date range
function formatDateRange(start, end) {
    const s = start.toLocaleDateString('vi-VN');
    const e = end.toLocaleDateString('vi-VN');
    return `${s} → ${e}`;
}
// Xuất global
window.initManager = initManager;
window.openCostModal = openCostModal;
window.setExpenseName = setExpenseName;
window.editExpenseName = editExpenseName;
window.deleteExpenseCategory = deleteExpenseCategory;
window.showExpenseDetail = showExpenseDetail;
window.showAdminExpenseDetail = showAdminExpenseDetail;
window.showDebtDetail = showDebtDetail;