// ============================================================
// employees.js - QUẢN LÝ NHÂN VIÊN (Modal duy nhất)
// ============================================================
// Chức năng:
//   - Modal quản lý nhân viên khi click "NHÂN VIÊN" trong quản lý
//   - Thêm nhân viên: username, password, lương ngày, checkbox thưởng doanh thu
//   - Danh sách nhân viên: tên + lương thực nhận trong tháng
//   - Click nhân viên → chi tiết: lịch chọn ngày off/tăng ca, thưởng/phạt, sửa/xóa
//   - Tự động tính lương: ngày công × lương ngày, thưởng doanh thu, điều chỉnh off/tăng ca
// ============================================================
// Yêu cầu: db.js (DB module), firebase
// ============================================================

// ============================================================
// 1. ESCAPE HELPERS
// ============================================================
function empEscapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&')
              .replace(/</g, '<')
              .replace(/>/g, '>')
              .replace(/"/g, '"')
              .replace(/'/g, '&#039;');
}

function empEscapeJsString(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'")
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r');
}

var _escapeHtml = (typeof escapeHtml === 'function') ? escapeHtml : empEscapeHtml;
var _escapeJs = (typeof escapeJsString === 'function') ? escapeJsString : empEscapeJsString;

// ============================================================
// 2. BIẾN TOÀN CỤC
// ============================================================
var EMP = {
    currentStaffId: null,
    currentPeriod: null,       // YYYY-MM (kỳ lương: tháng N)
    staffs: [],                // Cache danh sách nhân viên
    salaryCache: {},           // { staffId: { period: { ... } } }
    attendanceCache: {},       // { staffId: { period: { offDays: [...], otDays: [...] } } }
    selectedOffDays: [],       // Ngày off đang chọn (trong detail)
    selectedOtDays: [],        // Ngày tăng ca đang chọn
    currentMonthDays: [],      // Danh sách ngày trong kỳ hiện tại
    editStaffId: null,         // Đang sửa nhân viên nào (null = thêm mới)
    revenueBonusEnabled: false // Checkbox thưởng doanh thu
};

// ============================================================
// 3. HÀM TIỆN ÍCH
// ============================================================

/**
 * Lấy kỳ lương hiện tại.
 * Kỳ 20/N - 19/N+1 trả lương cho tháng N.
 * Nếu hôm nay >= 20 → kỳ = tháng sau (đang ở kỳ của tháng sau)
 * Nếu hôm nay < 20  → kỳ = tháng này
 * Trả về: { period: 'YYYY-MM', label: 'Kỳ MM/YYYY (20/MM - 19/MM+1)' }
 */
function empGetCurrentPeriod() {
    var now = new Date();
    var day = now.getDate();
    var y = now.getFullYear();
    var m = now.getMonth() + 1; // 1-12

    // Kỳ 20/N → 19/N+1 trả lương cho tháng N
    // Nếu hôm nay >= 20: đang ở kỳ 20/N→19/N+1, trả lương tháng N → period = tháng N (tháng hiện tại)
    // Nếu hôm nay < 20: đang ở kỳ 20/N-1→19/N, trả lương tháng N-1 → period = tháng N-1 (tháng trước)
    if (day < 20) {
        m = m - 1;
        if (m < 1) { m = 12; y--; }
    }

    return y + '-' + String(m).padStart(2, '0');
}

/** Lấy số ngày trong tháng */
function empGetDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

/**
 * Lấy số ngày trong kỳ lương (20/N → 19/N+1).
 * Kỳ này trả lương cho tháng N, nên số ngày công tối đa = số ngày của tháng N.
 * Trả về: { days: số_ngày_trong_kỳ, daysInMonth: số_ngày_tháng_N, startDate, endDate }
 */
function empGetDaysInPeriod(year, month) {
    // Số ngày của tháng N (làm căn cứ tính lương)
    var daysInMonth = empGetDaysInMonth(year, month);

    // Tháng N: từ ngày 20 → cuối tháng
    var daysAfter20 = daysInMonth - 19; // 20 → hết tháng

    // Tháng N+1: từ ngày 1 → 19
    var nextMonth = month + 1;
    var nextYear = year;
    if (nextMonth > 12) { nextMonth = 1; nextYear++; }
    var daysInNextMonth = empGetDaysInMonth(nextYear, nextMonth);
    var daysBefore20 = Math.min(19, daysInNextMonth); // 1 → 19

    var totalDays = daysAfter20 + daysBefore20;

    var startDate = year + '-' + String(month).padStart(2, '0') + '-20';
    var endDate = nextYear + '-' + String(nextMonth).padStart(2, '0') + '-19';

    return {
        days: totalDays,           // Tổng ngày trong kỳ (20/N → 19/N+1)
        daysInMonth: daysInMonth,  // Số ngày của tháng N (căn cứ tính lương)
        startDate: startDate,
        endDate: endDate,
        daysAfter20: daysAfter20,
        daysBefore20: daysBefore20,
        year: year,
        month: month,
        nextYear: nextYear,
        nextMonth: nextMonth
    };
}

/** Lấy nhãn hiển thị cho kỳ lương: "Kỳ 03/2026 (20/02 - 19/03)" */
function empGetPeriodLabel(period) {
    if (!period) return '';
    var parts = period.split('-');
    var y = parseInt(parts[0]);
    var m = parseInt(parts[1]);

    var periodInfo = empGetDaysInPeriod(y, m);
    var startMonth = String(periodInfo.month).padStart(2, '0');
    var endMonth = String(periodInfo.nextMonth).padStart(2, '0');

    return 'Kỳ ' + String(m).padStart(2, '0') + '/' + y + ' (20/' + startMonth + ' - 19/' + endMonth + ')';
}

/** Format số thành tiền VND */
function empFormatCurrency(num) {
    if (num === null || num === undefined || isNaN(num)) num = 0;
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}

/** Format ngày DD/MM */
function empFormatDateShort(dateStr) {
    if (!dateStr) return '';
    var parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    return parts[2] + '/' + parts[1];
}

/** Lấy shopId */
function empGetShopId() {
    return (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
}

/** Lấy tên nhân viên hiện tại */
function empGetCurrentUserName() {
    try {
        var u = DB.getCurrentUser();
        return u ? (u.displayName || u.username || 'unknown') : 'unknown';
    } catch(e) { return 'unknown'; }
}

/** Lấy ID nhân viên hiện tại */
function empGetCurrentUserId() {
    try {
        var u = DB.getCurrentUser();
        return u ? u.id : 'unknown';
    } catch(e) { return 'unknown'; }
}

// ============================================================
// 4. MỞ MODAL QUẢN LÝ NHÂN VIÊN (từ manager-detail.js)
// ============================================================
function openStaffManager() {
    if (!DB.isAdmin()) {
        showToast('Chỉ admin mới có thể quản lý nhân viên', 'warning');
        return;
    }

    // Giữ nguyên EMP.currentPeriod nếu đã được đồng bộ từ managerApplyFilter(),
    // nếu chưa thì lấy period mặc định
    if (!EMP.currentPeriod) {
        EMP.currentPeriod = empGetCurrentPeriod();
    }

    // Tính lại daily_revenue cho kỳ hiện tại để loại bỏ dữ liệu cũ chứa debt
    var periodParts = EMP.currentPeriod.split('-');
    var periodYear = parseInt(periodParts[0]);
    var periodMonth = parseInt(periodParts[1]);
    empRecalculateDailyRevenueForPeriod(periodYear, periodMonth);

    // Tạo modal nếu chưa có
    var modal = document.getElementById('employeeManagerModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'employeeManagerModal';
        modal.className = 'modal active';
        modal.style.display = 'flex';
        document.body.appendChild(modal);
    }

    renderEmployeeManagerModal();
    openBottomSheet('employeeManagerModal');
}

// ============================================================
// 5. RENDER MODAL CHÍNH
// ============================================================
function renderEmployeeManagerModal() {
    var modal = document.getElementById('employeeManagerModal');
    if (!modal) return;

    var periodLabel = empGetPeriodLabel(EMP.currentPeriod);

    modal.innerHTML =
        '<div class="modal-content emp-modal-content">' +
            '<div class="modal-header">' +
                '<h3>👥 QUẢN LÝ NHÂN VIÊN</h3>' +
                '<button class="modal-close-btn" onclick="closeEmployeeManager()">✕ Đóng</button>' +
            '</div>' +
            '<div class="modal-body emp-modal-body">' +
                // KỲ LƯƠNG
                '<div class="emp-period-banner">📆 ' + periodLabel + '</div>' +
                // TABS
                '<div class="emp-tabs">' +
                    '<div class="emp-tab active" id="empTabList" onclick="empSwitchTab(\'list\')">📋 Danh sách</div>' +
                    '<div class="emp-tab" id="empTabAdd" onclick="empSwitchTab(\'add\')">➕ Thêm NV</div>' +
                '</div>' +

                // TAB 1: DANH SÁCH NHÂN VIÊN
                '<div id="empTabListContent" class="emp-tab-content">' +
                    '<div class="emp-search-bar">' +
                        '<input type="text" id="empSearchInput" class="form-input" placeholder="🔍 Tìm nhân viên..." oninput="empRenderStaffList()" style="width:100%;">' +
                    '</div>' +
                    '<div id="empStaffListContainer" class="emp-staff-list">' +
                        '<div class="emp-loading">Đang tải...</div>' +
                    '</div>' +
                '</div>' +

                // TAB 2: THÊM NHÂN VIÊN
                '<div id="empTabAddContent" class="emp-tab-content" style="display:none;">' +
                    '<div class="emp-add-form">' +
                        '<div class="emp-form-group">' +
                            '<label>Tên đăng nhập</label>' +
                            '<input type="text" id="empNewUsername" class="form-input" placeholder="VD: nv01">' +
                        '</div>' +
                        '<div class="emp-form-group">' +
                            '<label>Mật khẩu</label>' +
                            '<input type="password" id="empNewPassword" class="form-input" placeholder="Ít nhất 4 ký tự">' +
                        '</div>' +
                        '<div class="emp-form-group">' +
                            '<label>Tên hiển thị</label>' +
                            '<input type="text" id="empNewDisplayName" class="form-input" placeholder="VD: Nguyễn Văn A">' +
                        '</div>' +
                        '<div class="emp-form-group">' +
                            '<label>💰 Mức lương theo ngày</label>' +
                            '<div class="emp-input-with-unit">' +
                                '<input type="number" id="empNewDailySalary" class="form-input" placeholder="0" value="0" min="0">' +
                                '<span class="emp-unit">đ/ngày</span>' +
                            '</div>' +
                        '</div>' +
                        '<div class="emp-form-group">' +
                            '<label class="emp-checkbox-label">' +
                                '<input type="checkbox" id="empNewRevenueBonus" onchange="empToggleRevenueBonus(this)">' +
                                '🏆 Thưởng theo doanh thu' +
                            '</label>' +
                            '<div class="emp-hint">Trích 1% doanh thu hàng ngày</div>' +
                        '</div>' +
                        '<div id="empAddStatus" class="emp-status"></div>' +
                        '<button class="btn-primary emp-submit-btn" onclick="empHandleAddStaff()">➕ Thêm nhân viên</button>' +
                    '</div>' +
                '</div>' +

                // TAB 3: CHI TIẾT NHÂN VIÊN (ẩn, hiện khi click vào nhân viên)
                '<div id="empTabDetailContent" class="emp-tab-content" style="display:none;">' +
                '</div>' +
            '</div>' +
        '</div>';

    // Load danh sách nhân viên
    empLoadStaffList();

    // Cập nhật nút tổng lương trên manager grid
    empUpdateManagerButton();
}

// ============================================================
// 6. CHUYỂN TAB
// ============================================================
function empSwitchTab(tab) {
    var tabs = ['list', 'add'];
    for (var i = 0; i < tabs.length; i++) {
        var tabEl = document.getElementById('empTab' + tabs[i].charAt(0).toUpperCase() + tabs[i].slice(1));
        var contentEl = document.getElementById('empTab' + tabs[i].charAt(0).toUpperCase() + tabs[i].slice(1) + 'Content');
        if (tabEl) tabEl.className = 'emp-tab' + (tabs[i] === tab ? ' active' : '');
        if (contentEl) contentEl.style.display = tabs[i] === tab ? '' : 'none';
    }
    // Ẩn detail nếu chuyển tab
    var detailContent = document.getElementById('empTabDetailContent');
    if (detailContent) detailContent.style.display = 'none';
}

// ============================================================
// 7. LOAD DANH SÁCH NHÂN VIÊN
// ============================================================
function empLoadStaffList() {
    var container = document.getElementById('empStaffListContainer');
    if (!container) return;

    container.innerHTML = '<div class="emp-loading">Đang tải...</div>';

    DB.getStaffs().then(function(staffs) {
        EMP.staffs = staffs || [];
        var period = EMP.currentPeriod || empGetCurrentPeriod();
        var shopId = empGetShopId();

        // Cache dailySalary từ staff vào salaryCache
        for (var si = 0; si < EMP.staffs.length; si++) {
            var st = EMP.staffs[si];
            if (!st || !st.id) continue;
            if (!EMP.salaryCache[st.id]) EMP.salaryCache[st.id] = {};
            if (!EMP.salaryCache[st.id][period]) EMP.salaryCache[st.id][period] = {};
            if (EMP.salaryCache[st.id][period].dailySalary === undefined || EMP.salaryCache[st.id][period].dailySalary === null) {
                EMP.salaryCache[st.id][period].dailySalary = st.dailySalary || 0;
                EMP.salaryCache[st.id][period].revenueBonusEnabled = st.revenueBonusEnabled || false;
            }
        }

        // Load salary data từ Firebase cho tất cả nhân viên
        if (typeof firebase !== 'undefined' && firebase.database && shopId) {
            var salariesRef = firebase.database().ref(shopId + '/employee_salaries');
            salariesRef.once('value').then(function(snapshot) {
                var allSalaries = snapshot.val() || {};
                for (var staffId in allSalaries) {
                    if (!allSalaries.hasOwnProperty(staffId)) continue;
                    var staffPeriods = allSalaries[staffId];
                    if (!staffPeriods) continue;
                    var salaryData = staffPeriods[period];
                    if (salaryData) {
                        if (!EMP.salaryCache[staffId]) EMP.salaryCache[staffId] = {};
                        EMP.salaryCache[staffId][period] = salaryData;
                    }
                }
                // Load attendance từ Firebase
                var attRef = firebase.database().ref(shopId + '/employee_attendance');
                return attRef.once('value');
            }).then(function(attSnapshot) {
                if (attSnapshot) {
                    var allAtt = attSnapshot.val() || {};
                    for (var attStaffId in allAtt) {
                        if (!allAtt.hasOwnProperty(attStaffId)) continue;
                        var staffPeriods = allAtt[attStaffId];
                        if (!staffPeriods) continue;
                        // Attendance lưu theo monthKey (YYYY-MM)
                        var monthKey = period.split('-').slice(0, 2).join('-');
                        var attData = staffPeriods[monthKey] || staffPeriods[period] || null;
                        if (attData) {
                            if (!EMP.attendanceCache[attStaffId]) EMP.attendanceCache[attStaffId] = {};
                            EMP.attendanceCache[attStaffId][period] = {
                                offDays: (attData.offDays && Array.isArray(attData.offDays)) ? attData.offDays : [],
                                otDays: (attData.otDays && Array.isArray(attData.otDays)) ? attData.otDays : []
                            };
                        }
                    }
                }
                empRenderStaffList();
            }).catch(function() {
                // Fallback: render với cache hiện tại
                empRenderStaffList();
            });
        } else {
            empRenderStaffList();
        }
    }).catch(function(err) {
        container.innerHTML = '<div class="emp-empty">❌ Lỗi tải danh sách</div>';
    });
}

// ============================================================
// 8. RENDER DANH SÁCH NHÂN VIÊN
// ============================================================
function empRenderStaffList() {
    var container = document.getElementById('empStaffListContainer');
    if (!container) return;

    var searchTerm = (document.getElementById('empSearchInput')?.value || '').toLowerCase().trim();
    var staffs = EMP.staffs;

    if (!staffs || staffs.length === 0) {
        container.innerHTML = '<div class="emp-empty">Chưa có nhân viên nào</div>';
        return;
    }

    // Lọc theo search
    var filtered = [];
    for (var i = 0; i < staffs.length; i++) {
        var s = staffs[i];
        if (!s) continue;
        if (s.role === 'admin') continue; // Ẩn admin khỏi danh sách lương
        var name = (s.displayName || s.username || '').toLowerCase();
        if (searchTerm && name.indexOf(searchTerm) === -1) continue;
        filtered.push(s);
    }

    if (filtered.length === 0) {
        container.innerHTML = '<div class="emp-empty">Không tìm thấy nhân viên</div>';
        return;
    }

    var html = '';
    for (var j = 0; j < filtered.length; j++) {
        var staff = filtered[j];
        var name = staff.displayName || staff.username || 'NV';
        var username = staff.username || '';

        // Tính lương thực nhận trong tháng
        var salaryInfo = empCalculateStaffSalary(staff.id, EMP.currentPeriod);
        var salaryText = salaryInfo ? empFormatCurrency(salaryInfo.total) : '0đ';

        html += '<div class="emp-staff-card" onclick="empOpenStaffDetail(\'' + _escapeJs(staff.id) + '\')">' +
                    '<div class="emp-staff-card-info">' +
                        '<div class="emp-staff-card-name">' + _escapeHtml(name) + '</div>' +
                        '<div class="emp-staff-card-user">@' + _escapeHtml(username) + '</div>' +
                    '</div>' +
                    '<div class="emp-staff-card-salary">' +
                        '<div class="emp-staff-card-amount">' + salaryText + '</div>' +
                        '<div class="emp-staff-card-label">Lương kỳ này</div>' +
                    '</div>' +
                '</div>';
    }

    container.innerHTML = html;
}

// ============================================================
// 9. TÍNH LƯƠNG NHÂN VIÊN
// ============================================================
function empCalculateStaffSalary(staffId, period) {
    if (!staffId || !period) return null;

    var parts = period.split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]);

    // Kỳ lương: 20/N → 19/N+1 trả lương cho tháng N
    var periodInfo = empGetDaysInPeriod(year, month);
    var daysInMonth = periodInfo.daysInMonth; // Số ngày của tháng N (căn cứ tính lương)
    var daysInPeriod = periodInfo.days;       // Tổng ngày trong kỳ (20/N → 19/N+1)

    // Lấy dữ liệu attendance
    var attendance = EMP.attendanceCache[staffId]?.[period] || {};
    var offDays = (attendance.offDays && Array.isArray(attendance.offDays)) ? attendance.offDays : [];
    var otDays = (attendance.otDays && Array.isArray(attendance.otDays)) ? attendance.otDays : [];

    // Lấy dữ liệu lương từ cache
    var salaryData = EMP.salaryCache[staffId]?.[period] || {};

    // Nếu chưa có trong cache, lấy dailySalary từ staff object
    var dailySalary = salaryData.dailySalary;
    var revenueBonusEnabled = salaryData.revenueBonusEnabled;
    var manualBonus = salaryData.manualBonus || 0;
    var manualPenalty = salaryData.manualPenalty || 0;

    // Nếu chưa có dữ liệu lương trong cache, thử lấy từ staff info
    if (dailySalary === undefined || dailySalary === null) {
        // Tìm staff trong EMP.staffs
        var staffFound = null;
        for (var si = 0; si < EMP.staffs.length; si++) {
            if (EMP.staffs[si] && EMP.staffs[si].id === staffId) {
                staffFound = EMP.staffs[si];
                break;
            }
        }
        if (staffFound) {
            dailySalary = staffFound.dailySalary || 0;
            revenueBonusEnabled = staffFound.revenueBonusEnabled || false;
        } else {
            dailySalary = 0;
            revenueBonusEnabled = false;
        }
    }

    // Tính ngày công trong kỳ
    // Lương full = lương_ngày × số_ngày_tháng_N
    // Nghỉ 1 ngày trong kỳ → trừ 1 ngày công
    // Tăng ca 1 ngày trong kỳ → cộng 1 ngày công
    var workingDays = daysInMonth - offDays.length + otDays.length;
    if (workingDays < 0) workingDays = 0;
    if (workingDays > daysInMonth * 2) workingDays = daysInMonth * 2; // tối đa gấp đôi

    // Lương cơ bản = lương_ngày × ngày_công
    var baseSalary = dailySalary * workingDays;

    // Thưởng doanh thu
    var revenueBonus = 0;
    if (revenueBonusEnabled) {
        revenueBonus = empCalculateRevenueBonus(staffId, period, year, month);
    }

    var total = baseSalary + revenueBonus + manualBonus - manualPenalty;
    if (total < 0) total = 0;

    return {
        baseSalary: baseSalary,
        dailySalary: dailySalary,
        workingDays: workingDays,
        daysInPeriod: daysInPeriod,
        daysInMonth: daysInMonth,
        offDays: offDays.length,
        otDays: otDays.length,
        revenueBonus: revenueBonus,
        revenueBonusEnabled: revenueBonusEnabled,
        manualBonus: manualBonus,
        manualPenalty: manualPenalty,
        total: total,
        periodStart: periodInfo.startDate,
        periodEnd: periodInfo.endDate
    };
}

// ============================================================
// 10. TÍNH THƯỞNG DOANH THU (1% doanh thu hàng ngày)
// ============================================================
/**
 * Tính thưởng doanh thu cho nhân viên trong tháng N.
 * - Lịch (LLV) hiển thị tháng N (1 → hết tháng N)
 * - Ngày công tính theo tháng N
 * - Thưởng doanh thu tính theo tháng N (1 → hết tháng N) để đồng bộ
 * Đọc từ cache realtime EMP._revenueCache (đã sync từ Firebase daily_revenue).
 */
function empCalculateRevenueBonus(staffId, period, year, month) {
    var totalBonus = 0;

    // Kiểm tra cache doanh thu
    var revenueCache = EMP._revenueCache;
    if (!revenueCache) return 0;

    // Lấy danh sách ngày off của nhân viên trong kỳ này
    var attendance = EMP.attendanceCache[staffId]?.[period] || {};
    var offDays = (attendance.offDays && Array.isArray(attendance.offDays)) ? attendance.offDays : [];

    // Tính theo tháng N (1 → hết tháng N) để đồng bộ với lịch LLV
    var daysInMonth = empGetDaysInMonth(year, month);

    // Duyệt từng ngày trong tháng N (1 → hết tháng)
    for (var d = 1; d <= daysInMonth; d++) {
        var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        // Bỏ qua ngày off - không tính thưởng doanh thu
        if (offDays.indexOf(dateStr) !== -1) continue;
        var dayRevenue = revenueCache[dateStr] || 0;
        // Trích 1% doanh thu hàng ngày
        totalBonus += Math.round(dayRevenue * 0.01);
    }

    return totalBonus;
}

// ============================================================
// 10a. HIỂN THỊ CHI TIẾT THƯỞNG DOANH THU THEO NGÀY
// ============================================================
/**
 * Hiển thị popup chi tiết doanh thu từng ngày và tiền thưởng tương ứng.
 * Đọc từ EMP._revenueCache (đã sync từ Firebase daily_revenue).
 * Ngày OFF được hiển thị với nền đỏ nhạt + gạch ngang để biết không được thưởng.
 */
function empShowRevenueBonusDetail() {
    var revenueCache = EMP._revenueCache;
    if (!revenueCache) {
        showToast('Chưa có dữ liệu doanh thu', 'warning');
        return;
    }

    var period = EMP.currentPeriod || empGetCurrentPeriod();
    var parts = period.split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]);

    // Lấy danh sách ngày off của nhân viên đang xem
    var staffId = EMP.currentStaffId;
    var offDays = [];
    if (staffId) {
        var attendance = EMP.attendanceCache[staffId]?.[period] || {};
        offDays = (attendance.offDays && Array.isArray(attendance.offDays)) ? attendance.offDays : [];
    }

    // Hiển thị theo tháng N (1 → hết tháng N) để đồng bộ với lịch LLV
    var daysInMonth = empGetDaysInMonth(year, month);
    var rows = [];
    var totalRevenue = 0;
    var totalBonus = 0;

    for (var d = 1; d <= daysInMonth; d++) {
        var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var isOff = offDays.indexOf(dateStr) !== -1;
        var dayRevenue = revenueCache[dateStr] || 0;
        // Ngày off: bonus = 0 (không được thưởng)
        var dayBonus = isOff ? 0 : Math.round(dayRevenue * 0.01);
        totalRevenue += dayRevenue;
        totalBonus += dayBonus;

        var dayLabel = String(d).padStart(2, '0') + '/' + String(month).padStart(2, '0');

        rows.push({
            date: dayLabel,
            revenue: dayRevenue,
            bonus: dayBonus,
            isOff: isOff
        });
    }

    // Tạo HTML popup
    var html = '<div class="emp-revenue-detail-overlay" onclick="this.remove()" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;">' +
        '<div onclick="event.stopPropagation()" style="background:#fff;border-radius:12px;padding:20px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 4px 20px rgba(0,0,0,0.3);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
                '<h3 style="margin:0;font-size:16px;">📊 Chi tiết thưởng doanh thu</h3>' +
                '<button onclick="this.closest(\'.emp-revenue-detail-overlay\').remove()" style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px 8px;">✕</button>' +
            '</div>' +
            '<div style="font-size:13px;color:#666;margin-bottom:12px;">Kỳ: ' + empGetPeriodLabel(period) + '</div>' +
            '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
                '<thead>' +
                    '<tr style="border-bottom:2px solid #e2e8f0;">' +
                        '<th style="text-align:left;padding:6px 8px;color:#64748b;">Ngày</th>' +
                        '<th style="text-align:right;padding:6px 8px;color:#64748b;">Doanh thu</th>' +
                        '<th style="text-align:right;padding:6px 8px;color:#64748b;">Thưởng (1%)</th>' +
                    '</tr>' +
                '</thead>' +
                '<tbody>';

    for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var isEven = i % 2 === 0;
        var rowStyle = 'border-bottom:1px solid #f1f5f9;' + (isEven ? 'background:#f8fafc;' : '');
        if (r.isOff) {
            rowStyle += 'background:#fef2f2!important;'; // nền đỏ nhạt cho ngày off
        }
        html += '<tr style="' + rowStyle + '">' +
                    '<td style="padding:6px 8px;">' +
                        (r.isOff ? '<span style="color:#dc2626;font-weight:600;">😴 ' + r.date + '</span>' : r.date) +
                    '</td>' +
                    '<td style="padding:6px 8px;text-align:right;">' +
                        (r.revenue > 0 ? empFormatCurrency(r.revenue) : '<span style="color:#94a3b8;">-</span>') +
                    '</td>' +
                    '<td style="padding:6px 8px;text-align:right;font-weight:600;">' +
                        (r.isOff
                            ? '<span style="color:#dc2626;text-decoration:line-through;">OFF</span>'
                            : (r.bonus > 0
                                ? '<span style="color:#16a34a;">' + empFormatCurrency(r.bonus) + '</span>'
                                : '<span style="color:#94a3b8;">-</span>')
                        ) +
                    '</td>' +
                '</tr>';
    }

    html += '</tbody>' +
            '<tfoot>' +
                '<tr style="border-top:2px solid #e2e8f0;font-weight:700;">' +
                    '<td style="padding:8px;text-align:left;">Tổng</td>' +
                    '<td style="padding:8px;text-align:right;">' + empFormatCurrency(totalRevenue) + '</td>' +
                    '<td style="padding:8px;text-align:right;color:#16a34a;">' + empFormatCurrency(totalBonus) + '</td>' +
                '</tr>' +
            '</tfoot>' +
        '</table>' +
        '<div style="margin-top:12px;padding:10px;background:#f0fdf4;border-radius:8px;font-size:12px;color:#166534;text-align:center;">🏆 Tổng thưởng doanh thu: <strong>' + empFormatCurrency(totalBonus) + '</strong></div>' +
        '<div style="margin-top:8px;padding:6px 10px;background:#fef2f2;border-radius:6px;font-size:11px;color:#dc2626;text-align:center;">😴 Ngày <strong>OFF</strong> (nền đỏ) không được tính thưởng doanh thu</div>' +
    '</div></div>';

    // Thêm vào body
    var div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
}

// ============================================================
// 10b. CẬP NHẬT DOANH THU HÀNG NGÀY LÊN FIREBASE
// ============================================================
/**
 * Tính doanh thu từ transactions và ghi vào Firebase daily_revenue/{dateStr}
 * Được gọi sau mỗi lần thanh toán thành công (qua event pos_cash_update)
 * và khi load dữ liệu lương (để đảm bảo daily_revenue luôn có data).
 * Chỉ ghi 1 node nhẹ - tối ưu realtime.
 */
function empUpdateDailyRevenue(dateStr) {
    var shopId = empGetShopId();
    if (!shopId || typeof firebase === 'undefined') return;

    // Đọc transactions của ngày đó từ DB
    if (typeof DB !== 'undefined' && typeof DB.getTransactionsByDate === 'function') {
        DB.getTransactionsByDate(dateStr).then(function(transactions) {
            if (!transactions || transactions.length === 0) return;

            var total = 0;
            var cash = 0, transfer = 0, grab = 0;
            var orderCount = 0;

            for (var i = 0; i < transactions.length; i++) {
                var tx = transactions[i];
                if (!tx || tx.refunded) continue;
                // Bỏ qua ghi nợ - chỉ tính doanh thu thực tế
                if (tx.paymentMethod === 'debt') continue;
                var amt = tx.amount || 0;
                total += amt;
                orderCount++;
                if (tx.paymentMethod === 'cash') cash += amt;
                else if (tx.paymentMethod === 'transfer') transfer += amt;
                else if (tx.paymentMethod === 'grab') grab += amt;
            }

            // Ghi lên Firebase - chỉ 1 node nhẹ
            var ref = firebase.database().ref(shopId + '/daily_revenue/' + dateStr);
            ref.update({
                total: total,
                cash: cash,
                transfer: transfer,
                grab: grab,
                orderCount: orderCount,
                updatedAt: Date.now()
            }).catch(function(err) {
                console.error('empUpdateDailyRevenue error:', err);
            });
        }).catch(function(err) {
            console.error('empUpdateDailyRevenue getTransactions error:', err);
        });
    }
}

// ============================================================
// 10c. TÍNH LẠI DOANH THU HÀNG NGÀY CHO THÁNG N
// ============================================================
/**
 * Tính lại daily_revenue cho tháng N (1 → hết tháng N) từ transactions,
 * ghi đè lên Firebase để loại bỏ dữ liệu cũ có chứa debt.
 * Gọi khi mở modal quản lý nhân viên để đảm bảo dữ liệu sạch.
 */
function empRecalculateDailyRevenueForPeriod(year, month) {
    var shopId = empGetShopId();
    if (!shopId || typeof firebase === 'undefined') return;
    if (typeof DB === 'undefined' || typeof DB.getTransactionsByDateRange !== 'function') return;

    // Tính theo tháng N (1 → hết tháng N)
    var startDate = year + '-' + String(month).padStart(2, '0') + '-01';
    var daysInMonth = empGetDaysInMonth(year, month);
    var endDate = year + '-' + String(month).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0');

    DB.getTransactionsByDateRange(startDate, endDate).then(function(transactions) {
        if (!transactions) return;
        var dailyMap = {};
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            if (!tx || tx.refunded) continue;
            // Loại bỏ debt - chỉ tính doanh thu thực tế
            if (tx.paymentMethod === 'debt') continue;
            var dateKey = tx.dateKey || tx.createdAt;
            if (!dateKey) continue;
            if (dateKey.length > 10) dateKey = dateKey.slice(0, 10);
            if (!dailyMap[dateKey]) {
                dailyMap[dateKey] = { total: 0, cash: 0, transfer: 0, grab: 0, orderCount: 0 };
            }
            var amt = tx.amount || 0;
            dailyMap[dateKey].total += amt;
            dailyMap[dateKey].orderCount++;
            if (tx.paymentMethod === 'cash') dailyMap[dateKey].cash += amt;
            else if (tx.paymentMethod === 'transfer') dailyMap[dateKey].transfer += amt;
            else if (tx.paymentMethod === 'grab') dailyMap[dateKey].grab += amt;
        }
        // Ghi đè lên Firebase - xóa dữ liệu cũ (kể cả debt)
        var updates = {};
        for (var ds in dailyMap) {
            if (dailyMap.hasOwnProperty(ds)) {
                updates[shopId + '/daily_revenue/' + ds] = {
                    total: dailyMap[ds].total,
                    cash: dailyMap[ds].cash,
                    transfer: dailyMap[ds].transfer,
                    grab: dailyMap[ds].grab,
                    orderCount: dailyMap[ds].orderCount,
                    updatedAt: Date.now()
                };
            }
        }
        if (Object.keys(updates).length > 0) {
            firebase.database().ref().update(updates).catch(function(err) {
                console.error('empRecalculateDailyRevenueForPeriod error:', err);
            });
        }
    }).catch(function(err) {
        console.error('empRecalculateDailyRevenueForPeriod fetch error:', err);
    });
}

// ============================================================
// 10d. INIT REALTIME LISTENER CHO DAILY REVENUE
// ============================================================
/**
 * Khởi tạo realtime listener cho daily_revenue từ Firebase.
 * Tự động cập nhật EMP._revenueCache khi có thay đổi.
 * Gọi 1 lần khi mở modal quản lý nhân viên.
 */
function empInitDailyRevenueListener() {
    var shopId = empGetShopId();
    if (!shopId || typeof firebase === 'undefined') return;

    // Hủy listener cũ nếu có
    if (EMP._dailyRevenueListener) {
        EMP._dailyRevenueListener.off();
    }

    if (!EMP._revenueCache) EMP._revenueCache = {};

    var ref = firebase.database().ref(shopId + '/daily_revenue');
    var listener = ref.on('value', function(snapshot) {
        var data = snapshot.val() || {};
        // Cập nhật cache: mỗi key là dateStr YYYY-MM-DD, value là total
        for (var dateStr in data) {
            if (data.hasOwnProperty(dateStr) && data[dateStr] && data[dateStr].total) {
                EMP._revenueCache[dateStr] = data[dateStr].total;
            }
        }
        // Refresh UI nếu đang mở detail
        empRecalculateSalary();
    }, function(err) {
        console.error('empInitDailyRevenueListener error:', err);
    });

    EMP._dailyRevenueListener = {
        ref: ref,
        off: function() { ref.off('value', listener); }
    };
}

/**
 * Load doanh thu theo tháng N (1 → hết tháng N) vào cache.
 * Chiến lược 2 lớp:
 *   1. Đọc từ Firebase daily_revenue (nếu có) - nhanh, realtime
 *   2. Fallback: tính từ transactions (nếu daily_revenue chưa có) và ghi lên Firebase
 */
function empLoadRevenueData(year, month) {
    // Init listener nếu chưa có
    if (!EMP._dailyRevenueListener) {
        empInitDailyRevenueListener();
    }

    var cacheKey = year + '-' + String(month).padStart(2, '0');
    if (!EMP._revenueLoading) EMP._revenueLoading = {};
    if (EMP._revenueLoading[cacheKey]) return;
    EMP._revenueLoading[cacheKey] = true;

    var shopId = empGetShopId();
    if (!shopId || typeof firebase === 'undefined') return;

    // Tính theo tháng N (1 → hết tháng N)
    var startDate = year + '-' + String(month).padStart(2, '0') + '-01';
    var daysInMonth = empGetDaysInMonth(year, month);
    var endDate = year + '-' + String(month).padStart(2, '0') + '-' + String(daysInMonth).padStart(2, '0');

    // Bước 1: Đọc từ Firebase daily_revenue
    var ref = firebase.database().ref(shopId + '/daily_revenue');
    ref.orderByKey().startAt(startDate).endAt(endDate).once('value').then(function(snapshot) {
        var data = snapshot.val() || {};
        var hasData = false;
        for (var dateStr in data) {
            if (data.hasOwnProperty(dateStr) && data[dateStr] && data[dateStr].total) {
                EMP._revenueCache[dateStr] = data[dateStr].total;
                hasData = true;
            }
        }

        if (hasData) {
            // Đã có daily_revenue, refresh UI
            empRecalculateSalary();
        } else {
            // Bước 2: Fallback - chưa có daily_revenue, tính từ transactions
            console.log('[employees] daily_revenue chưa có, fallback tính từ transactions cho tháng', startDate, '→', endDate);
            if (typeof DB !== 'undefined' && typeof DB.getTransactionsByDateRange === 'function') {
                DB.getTransactionsByDateRange(startDate, endDate).then(function(transactions) {
                    if (!transactions) return;
                    var dailyMap = {};
                    for (var i = 0; i < transactions.length; i++) {
                        var tx = transactions[i];
                        if (!tx || tx.refunded) continue;
                        if (tx.paymentMethod === 'debt') continue;
                        var dateKey = tx.dateKey || tx.createdAt;
                        if (!dateKey) continue;
                        if (dateKey.length > 10) dateKey = dateKey.slice(0, 10);
                        if (!dailyMap[dateKey]) dailyMap[dateKey] = 0;
                        dailyMap[dateKey] += tx.amount || 0;
                    }
                    // Cập nhật cache local cho tất cả ngày trong tháng
                    for (var d = 1; d <= daysInMonth; d++) {
                        var ds = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                        EMP._revenueCache[ds] = dailyMap[ds] || 0;
                    }
                    // Ghi lên Firebase để lần sau nhanh hơn
                    for (var ds in dailyMap) {
                        if (dailyMap.hasOwnProperty(ds)) {
                            var fbRef = firebase.database().ref(shopId + '/daily_revenue/' + ds);
                            fbRef.update({
                                total: dailyMap[ds],
                                updatedAt: Date.now()
                            }).catch(function() {});
                        }
                    }
                    empRecalculateSalary();
                }).catch(function(err) {
                    console.error('empLoadRevenueData fallback error:', err);
                });
            }
        }
    }).catch(function(err) {
        console.error('empLoadRevenueData fetch error:', err);
    });
}

// ============================================================
// 11. MỞ CHI TIẾT NHÂN VIÊN
// ============================================================
function empOpenStaffDetail(staffId) {
    if (!staffId) return;

    EMP.currentStaffId = staffId;
    EMP.selectedOffDays = [];
    EMP.selectedOtDays = [];

    // Lấy thông tin nhân viên
    DB.get('staffs', staffId).then(function(staff) {
        if (!staff) {
            var shopId = empGetShopId();
            return firebase.database().ref(shopId + '/staffs/' + staffId).once('value').then(function(snapshot) {
                var data = snapshot.val();
                if (data) data.id = staffId;
                return data;
            });
        }
        return staff;
    }).then(function(staff) {
        if (!staff) {
            showToast('Không tìm thấy nhân viên', 'error');
            return;
        }
        // Cache dailySalary từ staff vào salaryCache
        var period = EMP.currentPeriod || empGetCurrentPeriod();
        if (!EMP.salaryCache[staffId]) EMP.salaryCache[staffId] = {};
        if (!EMP.salaryCache[staffId][period]) EMP.salaryCache[staffId][period] = {};
        if (EMP.salaryCache[staffId][period].dailySalary === undefined || EMP.salaryCache[staffId][period].dailySalary === null) {
            EMP.salaryCache[staffId][period].dailySalary = staff.dailySalary || 0;
            EMP.salaryCache[staffId][period].revenueBonusEnabled = staff.revenueBonusEnabled || false;
        }
        empRenderStaffDetail(staff);
    }).catch(function(err) {
        showToast('Lỗi tải thông tin nhân viên', 'error');
    });
}

// ============================================================
// 12. RENDER CHI TIẾT NHÂN VIÊN
// ============================================================
function empRenderStaffDetail(staff) {
    var detailContent = document.getElementById('empTabDetailContent');
    if (!detailContent) return;

    // Ẩn các tab khác, hiện detail
    var listContent = document.getElementById('empTabListContent');
    var addContent = document.getElementById('empTabAddContent');
    if (listContent) listContent.style.display = 'none';
    if (addContent) addContent.style.display = 'none';
    detailContent.style.display = '';

    // Highlight tab detail (dùng tab list làm active)
    var tabs = ['list', 'add'];
    for (var i = 0; i < tabs.length; i++) {
        var tabEl = document.getElementById('empTab' + tabs[i].charAt(0).toUpperCase() + tabs[i].slice(1));
        if (tabEl) tabEl.className = 'emp-tab';
    }

    var name = staff.displayName || staff.username || 'NV';
    var username = staff.username || '';
    var roleLabel = staff.role === 'admin' ? '🔑 Admin' : '👤 Nhân viên';
    var period = EMP.currentPeriod || empGetCurrentPeriod();
    var periodLabel = empGetPeriodLabel(period);

    // Tạo lịch trong kỳ (20/N → 19/N+1)
    var calendarHtml = empBuildCalendar(period, staff.id);

    // Load dữ liệu lương
    var salaryInfo = empCalculateStaffSalary(staff.id, period);
    var dailySalary = 0;
    var manualBonus = 0;
    var manualPenalty = 0;
    var revenueBonusEnabled = false;
    var totalSalary = 0;
    var workingDays = 0;
    var daysInMonth = 0;

    if (salaryInfo) {
        dailySalary = salaryInfo.dailySalary;
        manualBonus = salaryInfo.manualBonus;
        manualPenalty = salaryInfo.manualPenalty;
        revenueBonusEnabled = salaryInfo.revenueBonusEnabled;
        totalSalary = salaryInfo.total;
        workingDays = salaryInfo.workingDays;
        daysInMonth = salaryInfo.daysInMonth;
    } else {
        // Load từ cache hoặc Firebase
        var sd = EMP.salaryCache[staff.id]?.[period] || {};
        dailySalary = sd.dailySalary;
        manualBonus = sd.manualBonus || 0;
        manualPenalty = sd.manualPenalty || 0;
        revenueBonusEnabled = sd.revenueBonusEnabled;

        // Nếu chưa có trong cache, lấy từ staff info
        if (dailySalary === undefined || dailySalary === null) {
            dailySalary = staff.dailySalary || 0;
            revenueBonusEnabled = staff.revenueBonusEnabled || false;
        }

        var pi = empGetDaysInPeriod(
            parseInt(period.split('-')[0]),
            parseInt(period.split('-')[1])
        );
        daysInMonth = pi.daysInMonth;
        workingDays = daysInMonth;
        totalSalary = dailySalary * workingDays + manualBonus - manualPenalty;
    }

    detailContent.innerHTML =
        '<div class="emp-detail-container">' +
            // HEADER
            '<div class="emp-detail-header">' +
                '<button class="emp-back-btn" onclick="empBackToList()">◀ Quay lại</button>' +
                '<div class="emp-detail-title">' +
                    '<span class="emp-detail-name">' + _escapeHtml(name) + '</span>' +
                    '<span class="emp-detail-role ' + (staff.role === 'admin' ? 'admin' : 'staff') + '">' + roleLabel + '</span>' +
                '</div>' +
                '<div class="emp-detail-actions">' +
                    '<button class="btn-small btn-outline" onclick="empEditStaff(\'' + _escapeJs(staff.id) + '\')" title="Sửa thông tin">✏️ Sửa</button>' +
                    '<button class="btn-small btn-danger" onclick="empDeleteStaff(\'' + _escapeJs(staff.id) + '\', \'' + _escapeJs(name) + '\')" title="Xóa nhân viên">🗑️ Xóa</button>' +
                '</div>' +
            '</div>' +

            // THÔNG TIN NHÂN VIÊN
            '<div class="emp-detail-info">' +
                '<div class="emp-info-row"><span class="emp-info-label">👤 Tên:</span><span class="emp-info-value">' + _escapeHtml(name) + '</span></div>' +
                '<div class="emp-info-row"><span class="emp-info-label">🔑 Username:</span><span class="emp-info-value">@' + _escapeHtml(username) + '</span></div>' +
                '<div class="emp-info-row"><span class="emp-info-label">💰 Lương ngày:</span>' +
                    '<span class="emp-info-value">' +
                        '<input type="number" id="empDetailDailySalary" class="form-input emp-inline-input" value="' + dailySalary + '" min="0" onchange="empRecalculateSalary()" oninput="empRecalculateSalary()">' +
                        ' <span style="font-size:12px;color:#64748b;">đ/ngày</span>' +
                    '</span>' +
                '</div>' +
                '<div class="emp-info-row">' +
                    '<span class="emp-info-label">🏆 Thưởng DT:</span>' +
                    '<span class="emp-info-value">' +
                        '<label class="emp-checkbox-label" style="margin:0;">' +
                            '<input type="checkbox" id="empDetailRevenueBonus" ' + (revenueBonusEnabled ? 'checked' : '') + ' onchange="empRecalculateSalary()">' +
                            'Áp dụng thưởng doanh thu' +
                        '</label>' +
                    '</span>' +
                '</div>' +
            '</div>' +

            // KỲ LƯƠNG
            '<div class="emp-period-nav">' +
                '<button class="btn-small btn-outline" onclick="empChangePeriod(-1)" style="font-size:11px;">◀</button>' +
                '<span id="empPeriodLabel" style="font-size:13px;font-weight:600;padding:0 12px;text-align:center;">' + periodLabel + '</span>' +
                '<button class="btn-small btn-outline" onclick="empChangePeriod(1)" style="font-size:11px;">▶</button>' +
            '</div>' +

            // LỊCH
            '<div class="emp-calendar-section">' +
                '<div class="emp-section-title">📅 Lịch làm việc</div>' +
                '<div class="emp-calendar-hint">Click vào ngày để chọn: <span class="emp-badge-off">Nghỉ</span> <span class="emp-badge-ot">Tăng ca</span></div>' +
                '<div id="empCalendarContainer" class="emp-calendar-grid">' +
                    calendarHtml +
                '</div>' +
            '</div>' +

            // THƯỞNG / PHẠT
            '<div class="emp-bonus-penalty-section">' +
                '<div class="emp-section-title">💰 Thưởng / Phạt thủ công</div>' +
                '<div class="emp-bp-row">' +
                    '<div class="emp-bp-field">' +
                        '<label>🏆 Thưởng thêm</label>' +
                        '<input type="number" id="empDetailBonus" class="form-input" value="' + manualBonus + '" min="0" onchange="empRecalculateSalary()" oninput="empRecalculateSalary()">' +
                    '</div>' +
                    '<div class="emp-bp-field">' +
                        '<label>⚠️ Phạt</label>' +
                        '<input type="number" id="empDetailPenalty" class="form-input" value="' + manualPenalty + '" min="0" onchange="empRecalculateSalary()" oninput="empRecalculateSalary()">' +
                    '</div>' +
                '</div>' +
            '</div>' +

            // TỔNG LƯƠNG
            '<div class="emp-total-section">' +
                '<div class="emp-total-row">' +
                    '<span>📆 Ngày công:</span>' +
                    '<span id="empTotalWorkingDays">' + workingDays + '/' + daysInMonth + '</span>' +
                '</div>' +
                '<div class="emp-total-row">' +
                    '<span>💰 Lương cơ bản:</span>' +
                    '<span id="empTotalBaseSalary">' + empFormatCurrency(dailySalary * workingDays) + '</span>' +
                '</div>' +
                '<div class="emp-total-row" id="empTotalRevenueBonusRow" style="' + (revenueBonusEnabled ? '' : 'display:none;') + '">' +
                    '<span>🏆 Thưởng doanh thu:</span>' +
                    '<span id="empTotalRevenueBonus">' + empFormatCurrency(salaryInfo?.revenueBonus || 0) + '</span>' +
                '</div>' +
                '<div class="emp-total-row" style="color:#16a34a;">' +
                    '<span>➕ Thưởng thêm:</span>' +
                    '<span id="empTotalManualBonus">' + empFormatCurrency(manualBonus) + '</span>' +
                '</div>' +
                '<div class="emp-total-row" style="color:#dc2626;">' +
                    '<span>➖ Phạt:</span>' +
                    '<span id="empTotalManualPenalty">' + empFormatCurrency(manualPenalty) + '</span>' +
                '</div>' +
                '<div class="emp-total-final">' +
                    '<span>📋 TỔNG LƯƠNG:</span>' +
                    '<span id="empTotalFinal">' + empFormatCurrency(totalSalary) + '</span>' +
                '</div>' +
            '</div>' +

            // NÚT LƯU
            '<div class="emp-save-section">' +
                '<button class="btn-primary emp-save-btn" onclick="empSaveStaffSalary(\'' + _escapeJs(staff.id) + '\')">💾 Lưu bảng lương</button>' +
                '<div id="empSaveStatus" class="emp-status"></div>' +
            '</div>' +
        '</div>';

    // Load attendance từ cache/Firebase
    empLoadAttendance(staff.id, period);

    // Load doanh thu để tính thưởng (realtime qua Firebase daily_revenue)
    var parts = period.split('-');
    empLoadRevenueData(parseInt(parts[0]), parseInt(parts[1]));

    // Gắn sự kiện click cho "Thưởng doanh thu" - hiển thị chi tiết doanh thu từng ngày
    var bonusRow = document.getElementById('empTotalRevenueBonusRow');
    if (bonusRow) {
        bonusRow.style.cursor = 'pointer';
        bonusRow.onclick = function() {
            empShowRevenueBonusDetail();
        };
    }
}

// ============================================================
// 13. XÂY DỰNG LỊCH (hiển thị theo tháng)
// ============================================================
function empBuildCalendar(period, staffId) {
    if (!period) return '<div>Không có kỳ lương</div>';

    var parts = period.split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]);

    // Lịch hiển thị theo tháng N (ngày 1 → hết tháng)
    var daysInMonth = empGetDaysInMonth(year, month);

    // Lấy attendance: ưu tiên attendance của kỳ hiện tại (period = tháng N)
    // Nếu không có, thử lấy attendance theo tháng (YYYY-MM)
    var attendance = EMP.attendanceCache[staffId]?.[period] || {};
    // Fallback: lấy attendance theo đúng tháng (nếu lưu theo tháng)
    var monthKey = year + '-' + String(month).padStart(2, '0');
    if (!attendance.offDays && !attendance.otDays) {
        attendance = EMP.attendanceCache[staffId]?.[monthKey] || attendance;
    }
    var offDays = (attendance.offDays && Array.isArray(attendance.offDays)) ? attendance.offDays : [];
    var otDays = (attendance.otDays && Array.isArray(attendance.otDays)) ? attendance.otDays : [];

    var html = '';

    // Header thứ
    var dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    for (var dn = 0; dn < dayNames.length; dn++) {
        html += '<div class="emp-cal-header">' + dayNames[dn] + '</div>';
    }

    // Ngày 1 là thứ mấy
    var firstDay = new Date(year, month - 1, 1).getDay();

    // Ô trống trước ngày 1
    for (var e = 0; e < firstDay; e++) {
        html += '<div class="emp-cal-day emp-cal-empty"></div>';
    }

    // Các ngày 1 → hết tháng
    for (var d = 1; d <= daysInMonth; d++) {
        var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        var isOff = offDays.indexOf(dateStr) !== -1;
        var isOt = otDays.indexOf(dateStr) !== -1;

        var cls = 'emp-cal-day';
        if (isOff) cls += ' emp-cal-off';
        if (isOt) cls += ' emp-cal-ot';

        html += '<div class="' + cls + '" onclick="empToggleDay(\'' + dateStr + '\')">' +
                    '<span class="emp-cal-day-num">' + d + '</span>' +
                    (isOff ? '<span class="emp-cal-badge emp-cal-badge-off">N</span>' : '') +
                    (isOt ? '<span class="emp-cal-badge emp-cal-badge-ot">TC</span>' : '') +
                '</div>';
    }

    return html;
}

// ============================================================
// 14. CHỌN NGÀY OFF / TĂNG CA
// ============================================================
function empToggleDay(dateStr) {
    if (!EMP.currentStaffId || !EMP.currentPeriod) return;

    if (!EMP.attendanceCache[EMP.currentStaffId]) {
        EMP.attendanceCache[EMP.currentStaffId] = {};
    }
    if (!EMP.attendanceCache[EMP.currentStaffId][EMP.currentPeriod]) {
        EMP.attendanceCache[EMP.currentStaffId][EMP.currentPeriod] = { offDays: [], otDays: [] };
    }

    var attendance = EMP.attendanceCache[EMP.currentStaffId][EMP.currentPeriod];
    var offDays = attendance.offDays || [];
    var otDays = attendance.otDays || [];

    // Nếu đang là off -> bỏ off
    var offIdx = offDays.indexOf(dateStr);
    if (offIdx !== -1) {
        offDays.splice(offIdx, 1);
        attendance.offDays = offDays;
        empRecalculateSalary();
        empRefreshCalendar();
        return;
    }

    // Nếu đang là ot -> bỏ ot
    var otIdx = otDays.indexOf(dateStr);
    if (otIdx !== -1) {
        otDays.splice(otIdx, 1);
        attendance.otDays = otDays;
        empRecalculateSalary();
        empRefreshCalendar();
        return;
    }

    // Chưa chọn gì -> mở popup chọn
    empShowDayPicker(dateStr);
}

// ============================================================
// 15. POPUP CHỌN OFF / TĂNG CA
// ============================================================
function empShowDayPicker(dateStr) {
    // Tạo popup nhỏ
    var oldPopup = document.getElementById('empDayPicker');
    if (oldPopup) oldPopup.remove();

    var popup = document.createElement('div');
    popup.id = 'empDayPicker';
    popup.className = 'emp-day-picker';
    popup.innerHTML =
        '<div class="emp-day-picker-content">' +
            '<div class="emp-day-picker-title">📅 ' + empFormatDateShort(dateStr) + '</div>' +
            '<button class="emp-day-picker-btn emp-day-picker-off" onclick="empSetOffDay(\'' + dateStr + '\')">😴 Nghỉ</button>' +
            '<button class="emp-day-picker-btn emp-day-picker-ot" onclick="empSetOtDay(\'' + dateStr + '\')">⚡ Tăng ca</button>' +
            '<button class="emp-day-picker-btn emp-day-picker-cancel" onclick="empCloseDayPicker()">Hủy</button>' +
        '</div>';

    // Đặt popup gần vị trí click
    document.body.appendChild(popup);

    // Đóng khi click ra ngoài
    setTimeout(function() {
        document.addEventListener('click', empCloseDayPickerHandler);
    }, 10);
}

function empCloseDayPickerHandler(e) {
    var popup = document.getElementById('empDayPicker');
    if (popup && !popup.contains(e.target)) {
        empCloseDayPicker();
    }
}

function empCloseDayPicker() {
    var popup = document.getElementById('empDayPicker');
    if (popup) popup.remove();
    document.removeEventListener('click', empCloseDayPickerHandler);
}

function empSetOffDay(dateStr) {
    empCloseDayPicker();
    if (!EMP.currentStaffId || !EMP.currentPeriod) return;

    if (!EMP.attendanceCache[EMP.currentStaffId]) {
        EMP.attendanceCache[EMP.currentStaffId] = {};
    }
    if (!EMP.attendanceCache[EMP.currentStaffId][EMP.currentPeriod]) {
        EMP.attendanceCache[EMP.currentStaffId][EMP.currentPeriod] = { offDays: [], otDays: [] };
    }

    var attendance = EMP.attendanceCache[EMP.currentStaffId][EMP.currentPeriod];
    // Đảm bảo offDays và otDays là array
    if (!attendance.offDays) attendance.offDays = [];
    if (!attendance.otDays) attendance.otDays = [];

    if (attendance.offDays.indexOf(dateStr) === -1) {
        attendance.offDays.push(dateStr);
    }
    // Nếu đang là OT thì bỏ OT
    var otIdx = attendance.otDays.indexOf(dateStr);
    if (otIdx !== -1) {
        attendance.otDays.splice(otIdx, 1);
    }

    empRecalculateSalary();
    empRefreshCalendar();
}

function empSetOtDay(dateStr) {
    empCloseDayPicker();
    if (!EMP.currentStaffId || !EMP.currentPeriod) return;

    if (!EMP.attendanceCache[EMP.currentStaffId]) {
        EMP.attendanceCache[EMP.currentStaffId] = {};
    }
    if (!EMP.attendanceCache[EMP.currentStaffId][EMP.currentPeriod]) {
        EMP.attendanceCache[EMP.currentStaffId][EMP.currentPeriod] = { offDays: [], otDays: [] };
    }

    var attendance = EMP.attendanceCache[EMP.currentStaffId][EMP.currentPeriod];
    // Đảm bảo offDays và otDays là array
    if (!attendance.offDays) attendance.offDays = [];
    if (!attendance.otDays) attendance.otDays = [];

    if (attendance.otDays.indexOf(dateStr) === -1) {
        attendance.otDays.push(dateStr);
    }
    // Nếu đang là off thì bỏ off
    var offIdx = attendance.offDays.indexOf(dateStr);
    if (offIdx !== -1) {
        attendance.offDays.splice(offIdx, 1);
    }

    empRecalculateSalary();
    empRefreshCalendar();
}

// ============================================================
// 16. REFRESH LỊCH
// ============================================================
function empRefreshCalendar() {
    var container = document.getElementById('empCalendarContainer');
    if (!container) return;
    container.innerHTML = empBuildCalendar(EMP.currentPeriod, EMP.currentStaffId);
}

// ============================================================
// 17. TÍNH LẠI LƯƠNG (tự động lưu dailySalary vào Firebase)
// ============================================================
function empRecalculateSalary() {
    if (!EMP.currentStaffId || !EMP.currentPeriod) return;

    var staffId = EMP.currentStaffId;
    var period = EMP.currentPeriod;

    // Lấy giá trị từ form
    var dailySalaryInput = document.getElementById('empDetailDailySalary');
    var bonusInput = document.getElementById('empDetailBonus');
    var penaltyInput = document.getElementById('empDetailPenalty');
    var revenueCheckbox = document.getElementById('empDetailRevenueBonus');

    var dailySalary = parseFloat(dailySalaryInput?.value) || 0;
    var manualBonus = parseFloat(bonusInput?.value) || 0;
    var manualPenalty = parseFloat(penaltyInput?.value) || 0;
    var revenueBonusEnabled = revenueCheckbox ? revenueCheckbox.checked : false;

    // Cập nhật cache
    if (!EMP.salaryCache[staffId]) EMP.salaryCache[staffId] = {};
    if (!EMP.salaryCache[staffId][period]) EMP.salaryCache[staffId][period] = {};
    EMP.salaryCache[staffId][period].dailySalary = dailySalary;
    EMP.salaryCache[staffId][period].manualBonus = manualBonus;
    EMP.salaryCache[staffId][period].manualPenalty = manualPenalty;
    EMP.salaryCache[staffId][period].revenueBonusEnabled = revenueBonusEnabled;

    // Tự động lưu dailySalary và revenueBonusEnabled vào staff object trong Firebase
    // để không bị mất khi F5
    var shopId = empGetShopId();
    var staffRef = firebase.database().ref(shopId + '/staffs/' + staffId);
    staffRef.child('dailySalary').set(dailySalary).catch(function(err) {
        console.error('Lỗi lưu dailySalary:', err);
    });
    staffRef.child('revenueBonusEnabled').set(revenueBonusEnabled).catch(function(err) {
        console.error('Lỗi lưu revenueBonusEnabled:', err);
    });

    // Cập nhật local DB cache
    if (typeof DB !== 'undefined' && typeof DB.get === 'function') {
        DB.get('staffs', staffId).then(function(old) {
            if (old) {
                old.dailySalary = dailySalary;
                old.revenueBonusEnabled = revenueBonusEnabled;
                if (typeof DB.create === 'function') {
                    DB.create('staffs', old, staffId).catch(function() {});
                }
            }
        }).catch(function() {});
    }

    // Tính toán
    var salaryInfo = empCalculateStaffSalary(staffId, period);
    if (!salaryInfo) return;

    // Cập nhật UI
    var workingDaysEl = document.getElementById('empTotalWorkingDays');
    var baseSalaryEl = document.getElementById('empTotalBaseSalary');
    var revenueBonusEl = document.getElementById('empTotalRevenueBonus');
    var revenueBonusRow = document.getElementById('empTotalRevenueBonusRow');
    var manualBonusEl = document.getElementById('empTotalManualBonus');
    var manualPenaltyEl = document.getElementById('empTotalManualPenalty');
    var totalEl = document.getElementById('empTotalFinal');

    if (workingDaysEl) workingDaysEl.textContent = salaryInfo.workingDays + '/' + salaryInfo.daysInMonth;
    if (baseSalaryEl) baseSalaryEl.textContent = empFormatCurrency(salaryInfo.baseSalary);
    if (revenueBonusEl) revenueBonusEl.textContent = empFormatCurrency(salaryInfo.revenueBonus);
    if (revenueBonusRow) revenueBonusRow.style.display = revenueBonusEnabled ? '' : 'none';
    if (manualBonusEl) manualBonusEl.textContent = empFormatCurrency(salaryInfo.manualBonus);
    if (manualPenaltyEl) manualPenaltyEl.textContent = empFormatCurrency(salaryInfo.manualPenalty);
    if (totalEl) totalEl.textContent = empFormatCurrency(salaryInfo.total);
}

// ============================================================
// 18. ĐỔI KỲ LƯƠNG
// ============================================================
function empChangePeriod(delta) {
    var labelEl = document.getElementById('empPeriodLabel');
    if (!labelEl) return;

    // Lấy period từ EMP.currentPeriod (vì label đã là text hiển thị)
    var parts = EMP.currentPeriod.split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]);

    month += delta;
    if (month > 12) { month = 1; year++; }
    if (month < 1) { month = 12; year--; }

    var newPeriod = year + '-' + String(month).padStart(2, '0');
    EMP.currentPeriod = newPeriod;
    labelEl.textContent = empGetPeriodLabel(newPeriod);

    // Tính lại daily_revenue cho kỳ mới để loại bỏ dữ liệu cũ chứa debt
    empRecalculateDailyRevenueForPeriod(year, month);

    // Load doanh thu cho kỳ mới
    empLoadRevenueData(year, month);

    // Refresh calendar và salary
    if (EMP.currentStaffId) {
        empLoadAttendance(EMP.currentStaffId, newPeriod);
        empRefreshCalendar();

        // Cập nhật giá trị input Thưởng/Phạt theo kỳ mới TRƯỚC khi tính lại lương
        var bonusInput = document.getElementById('empDetailBonus');
        var penaltyInput = document.getElementById('empDetailPenalty');
        var sd = EMP.salaryCache[EMP.currentStaffId]?.[newPeriod] || {};
        if (bonusInput) bonusInput.value = sd.manualBonus || 0;
        if (penaltyInput) penaltyInput.value = sd.manualPenalty || 0;

        empRecalculateSalary();
    }

    // Cập nhật nút tổng lương trên manager grid
    empUpdateManagerButton();
}

// ============================================================
// 19. LOAD ATTENDANCE TỪ FIREBASE (theo tháng)
// ============================================================
function empLoadAttendance(staffId, period) {
    var shopId = empGetShopId();

    // Lấy tháng từ period (period = YYYY-MM là kỳ, cần lấy tháng N)
    var parts = period.split('-');
    var year = parseInt(parts[0]);
    var month = parseInt(parts[1]);
    var monthKey = year + '-' + String(month).padStart(2, '0');

    // Load attendance theo tháng (YYYY-MM)
    var ref = firebase.database().ref(shopId + '/employee_attendance/' + staffId + '/' + monthKey);

    ref.once('value').then(function(snapshot) {
        var data = snapshot.val() || {};
        // Đảm bảo offDays và otDays luôn là array
        if (!data.offDays || !Array.isArray(data.offDays)) data.offDays = [];
        if (!data.otDays || !Array.isArray(data.otDays)) data.otDays = [];
        if (!EMP.attendanceCache[staffId]) EMP.attendanceCache[staffId] = {};
        // Lưu theo monthKey để lịch tháng có thể đọc được
        EMP.attendanceCache[staffId][monthKey] = data;
        // Cũng lưu theo period để tương thích
        EMP.attendanceCache[staffId][period] = data;

        // Refresh calendar
        empRefreshCalendar();
        empRecalculateSalary();
    }).catch(function(err) {
        console.error('empLoadAttendance error:', err);
    });
}

// ============================================================
// 20. LƯU BẢNG LƯƠNG + ATTENDANCE
// ============================================================
function empSaveStaffSalary(staffId) {
    if (!staffId) return;

    var period = EMP.currentPeriod || empGetCurrentPeriod();
    var dailySalary = parseFloat(document.getElementById('empDetailDailySalary')?.value) || 0;
    var manualBonus = parseFloat(document.getElementById('empDetailBonus')?.value) || 0;
    var manualPenalty = parseFloat(document.getElementById('empDetailPenalty')?.value) || 0;
    var revenueCheckbox = document.getElementById('empDetailRevenueBonus');
    var revenueBonusEnabled = revenueCheckbox ? revenueCheckbox.checked : false;

    var statusEl = document.getElementById('empSaveStatus');
    if (statusEl) statusEl.textContent = '⏳ Đang lưu...';

    var salaryInfo = empCalculateStaffSalary(staffId, period);

    var salaryData = {
        dailySalary: dailySalary,
        manualBonus: manualBonus,
        manualPenalty: manualPenalty,
        revenueBonusEnabled: revenueBonusEnabled,
        revenueBonus: salaryInfo ? salaryInfo.revenueBonus : 0,
        workingDays: salaryInfo ? salaryInfo.workingDays : 0,
        daysInPeriod: salaryInfo ? salaryInfo.daysInPeriod : 0,
        daysInMonth: salaryInfo ? salaryInfo.daysInMonth : 0,
        baseSalary: salaryInfo ? salaryInfo.baseSalary : 0,
        total: salaryInfo ? salaryInfo.total : 0,
        updatedAt: Date.now(),
        updatedBy: empGetCurrentUserId()
    };

    var shopId = empGetShopId();
    var salaryRef = firebase.database().ref(shopId + '/employee_salaries/' + staffId + '/' + period);

    salaryRef.set(salaryData).then(function() {
        // Lưu attendance theo tháng (monthKey = YYYY-MM)
        var parts = period.split('-');
        var monthKey = parts[0] + '-' + parts[1];
        var attendance = EMP.attendanceCache[staffId]?.[monthKey] ||
                         EMP.attendanceCache[staffId]?.[period] ||
                         { offDays: [], otDays: [] };
        var attRef = firebase.database().ref(shopId + '/employee_attendance/' + staffId + '/' + monthKey);
        return attRef.set(attendance);
    }).then(function() {
        // Cập nhật cache
        if (!EMP.salaryCache[staffId]) EMP.salaryCache[staffId] = {};
        EMP.salaryCache[staffId][period] = salaryData;

        if (statusEl) statusEl.textContent = '✅ Đã lưu bảng lương kỳ ' + period;
        showToast('✅ Đã lưu bảng lương', 'success');

        // Refresh danh sách và cập nhật nút tổng lương
        empLoadStaffList();
        empUpdateManagerButton();

        // Đóng modal sau khi lưu thành công
        closeEmployeeManager();
    }).catch(function(err) {
        console.error('empSaveStaffSalary error:', err);
        if (statusEl) statusEl.textContent = '❌ Lỗi: ' + (err.message || 'Không thể lưu');
        showToast('❌ Lỗi lưu bảng lương', 'error');
    });
}

// ============================================================
// 21. QUAY LẠI DANH SÁCH
// ============================================================
function empBackToList() {
    var detailContent = document.getElementById('empTabDetailContent');
    var listContent = document.getElementById('empTabListContent');
    var addContent = document.getElementById('empTabAddContent');

    if (detailContent) detailContent.style.display = 'none';
    if (listContent) listContent.style.display = '';
    if (addContent) addContent.style.display = 'none';

    // Active tab list
    var tabList = document.getElementById('empTabList');
    var tabAdd = document.getElementById('empTabAdd');
    if (tabList) tabList.className = 'emp-tab active';
    if (tabAdd) tabAdd.className = 'emp-tab';

    EMP.currentStaffId = null;
    empLoadStaffList();
}

// ============================================================
// 22. ĐÓNG MODAL
// ============================================================
function closeEmployeeManager() {
    var modal = document.getElementById('employeeManagerModal');
    if (modal) {
        modal.classList.remove('active');
        modal.style.display = 'none';
        setTimeout(function() {
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        }, 300);
    }
    EMP.currentStaffId = null;
}

// ============================================================
// 23. THÊM NHÂN VIÊN (TỪ FORM)
// ============================================================
function empHandleAddStaff() {
    var username = document.getElementById('empNewUsername');
    var password = document.getElementById('empNewPassword');
    var displayName = document.getElementById('empNewDisplayName');
    var dailySalary = document.getElementById('empNewDailySalary');
    var revenueCheckbox = document.getElementById('empNewRevenueBonus');
    var statusEl = document.getElementById('empAddStatus');

    if (!username || !password) return;

    var user = username.value.trim();
    var pass = password.value;
    var name = displayName ? displayName.value.trim() : user;
    var salary = parseFloat(dailySalary?.value) || 0;
    var revenueBonus = revenueCheckbox ? revenueCheckbox.checked : false;

    if (!user || !pass) {
        if (statusEl) statusEl.textContent = '⚠️ Vui lòng nhập tên đăng nhập và mật khẩu';
        return;
    }
    if (pass.length < 4) {
        if (statusEl) statusEl.textContent = '⚠️ Mật khẩu phải có ít nhất 4 ký tự';
        return;
    }

    if (statusEl) statusEl.textContent = '⏳ Đang tạo...';

    DB.createStaff({
        username: user,
        password: pass,
        displayName: name,
        role: 'staff',
        dailySalary: salary,
        revenueBonusEnabled: revenueBonus
    }).then(function(newStaff) {
        // Lưu thông tin lương bổ sung vào Firebase
        var shopId = empGetShopId();
        var period = empGetCurrentPeriod();
        var salaryData = {
            dailySalary: salary,
            revenueBonusEnabled: revenueBonus,
            manualBonus: 0,
            manualPenalty: 0,
            baseSalary: 0,
            total: 0,
            updatedAt: Date.now(),
            updatedBy: empGetCurrentUserId()
        };
        var salaryRef = firebase.database().ref(shopId + '/employee_salaries/' + newStaff.id + '/' + period);
        return salaryRef.set(salaryData).then(function() {
            return newStaff;
        });
    }).then(function(newStaff) {
        if (statusEl) statusEl.textContent = '✅ Đã tạo nhân viên ' + (newStaff.displayName || newStaff.username);
        showToast('✅ Đã tạo nhân viên', 'success');

        // Clear form
        if (username) username.value = '';
        if (password) password.value = '';
        if (displayName) displayName.value = '';
        if (dailySalary) dailySalary.value = '0';
        if (revenueCheckbox) revenueCheckbox.checked = false;

        // Reload danh sách
        empLoadStaffList();
    }).catch(function(err) {
        console.error('empHandleAddStaff error:', err);
        if (statusEl) statusEl.textContent = '❌ Lỗi: ' + (err.message || 'Không thể tạo');
        showToast('❌ Lỗi tạo nhân viên', 'error');
    });
}

// ============================================================
// 24. TOGGLE REVENUE BONUS CHECKBOX
// ============================================================
function empToggleRevenueBonus(checkbox) {
    // Chỉ UI update, không cần làm gì thêm
}

// ============================================================
// 25. SỬA NHÂN VIÊN
// ============================================================
function empEditStaff(staffId) {
    if (!staffId) return;

    DB.get('staffs', staffId).then(function(staff) {
        if (!staff) {
            showToast('Không tìm thấy nhân viên', 'error');
            return;
        }

        var newName = prompt('Tên hiển thị:', staff.displayName || staff.username);
        if (newName === null) return; // Hủy
        newName = newName.trim();
        if (!newName) {
            showToast('Tên không được để trống', 'warning');
            return;
        }

        var shopId = empGetShopId();
        var ref = firebase.database().ref(shopId + '/staffs/' + staffId + '/displayName');
        ref.set(newName).then(function() {
            // Cập nhật local cache
            if (typeof DB !== 'undefined' && typeof DB.get === 'function') {
                DB.get('staffs', staffId).then(function(old) {
                    if (old) {
                        old.displayName = newName;
                        if (typeof DB.create === 'function') {
                            DB.create('staffs', old, staffId).catch(function() {});
                        }
                    }
                }).catch(function() {});
            }
            showToast('✅ Đã cập nhật tên nhân viên', 'success');
            // Refresh
            empOpenStaffDetail(staffId);
            empLoadStaffList();
        }).catch(function(err) {
            showToast('❌ Lỗi cập nhật', 'error');
        });
    }).catch(function(err) {
        showToast('❌ Lỗi tải thông tin', 'error');
    });
}

// ============================================================
// 26. XÓA NHÂN VIÊN
// ============================================================
function empDeleteStaff(staffId, staffName) {
    if (!staffId) return;

    var name = staffName || 'nhân viên này';
    if (!confirm('Bạn có chắc muốn xóa nhân viên "' + name + '"?\nHành động này không thể hoàn tác!')) return;

    var shopId = empGetShopId();
    var dbRef = firebase.database().ref(shopId + '/staffs/' + staffId);
    dbRef.remove().then(function() {
        // Xóa khỏi local cache
        if (typeof DB !== 'undefined' && typeof DB.remove === 'function') {
            DB.remove('staffs', staffId).catch(function() {});
        }
        // Xóa dữ liệu lương
        var salaryRef = firebase.database().ref(shopId + '/employee_salaries/' + staffId);
        salaryRef.remove().catch(function() {});
        // Xóa attendance
        var attRef = firebase.database().ref(shopId + '/employee_attendance/' + staffId);
        attRef.remove().catch(function() {});

        showToast('✅ Đã xóa nhân viên ' + name, 'success');

        // Quay lại danh sách
        empBackToList();
        empLoadStaffList();
    }).catch(function(err) {
        console.error('empDeleteStaff error:', err);
        showToast('❌ Lỗi xóa nhân viên', 'error');
    });
}

// ============================================================
// 27. PHÂN QUYỀN (từ settings.js - gọi qua alias)
// ============================================================
function empLoadStaffPermissionList() {
    var listEl = document.getElementById('staffPermissionList');
    if (!listEl) return;

    listEl.innerHTML = '<div class="permission-loading">Đang tải...</div>';

    if (typeof DB === 'undefined' || typeof DB.getStaffs !== 'function') {
        listEl.innerHTML = '<div class="permission-loading">⚠️ Chưa sẵn sàng</div>';
        return;
    }

    DB.getStaffs().then(function(staffs) {
        if (!staffs || staffs.length === 0) {
            listEl.innerHTML = '<div class="permission-loading">Chưa có nhân viên nào</div>';
            return;
        }

        var currentUser = DB.getCurrentUser();
        var currentUserId = currentUser ? currentUser.id : null;

        var html = '';
        for (var i = 0; i < staffs.length; i++) {
            var staff = staffs[i];
            if (!staff) continue;

            var name = staff.displayName || staff.username || staff.id || 'Unknown';
            var username = staff.username || '';
            var role = staff.role || 'staff';
            var isSelf = staff.id === currentUserId;

            var roleClass = isSelf ? 'self' : role;
            var roleLabel = isSelf ? '👤 Chính bạn' : (role === 'admin' ? '🔑 Admin' : '👤 Staff');

            html += '<div class="permission-staff-item">' +
                '<div class="permission-staff-info" onclick="' + (isSelf ? '' : 'empToggleStaffRole(\'' + _escapeJs(staff.id) + '\', \'' + _escapeJs(role) + '\')') + '">' +
                '<span class="permission-staff-name">' + _escapeHtml(name) + '</span>' +
                (username ? '<span class="permission-staff-username">@' + _escapeHtml(username) + '</span>' : '') +
                '</div>' +
                '<span class="permission-staff-role ' + roleClass + '">' + roleLabel + '</span>' +
                (isSelf ? '' : '<button class="permission-staff-delete" onclick="event.stopPropagation();empDeleteStaffFromPerm(\'' + _escapeJs(staff.id) + '\', \'' + _escapeJs(name) + '\')" title="Xóa nhân viên">✕</button>') +
                '</div>';
        }

        listEl.innerHTML = html;
    }).catch(function(err) {
        listEl.innerHTML = '<div class="permission-loading">❌ Lỗi tải danh sách</div>';
        console.error('empLoadStaffPermissionList error:', err);
    });
}

function empToggleStaffRole(staffId, currentRole) {
    if (!staffId) return;

    if (!DB.isAdmin()) {
        showToast('⚠️ Chỉ admin mới có thể thay đổi quyền', 'warning');
        return;
    }

    var newRole = (currentRole === 'admin') ? 'staff' : 'admin';
    var confirmMsg = (newRole === 'admin')
        ? 'Bạn có chắc muốn nâng cấp nhân viên này lên Admin?'
        : 'Bạn có chắc muốn hạ quyền nhân viên này xuống Staff?';

    if (!confirm(confirmMsg)) return;

    var shopId = empGetShopId();
    var dbRef = firebase.database().ref(shopId + '/staffs/' + staffId + '/role');
    dbRef.set(newRole).then(function() {
        if (typeof DB !== 'undefined' && typeof DB.get === 'function') {
            DB.get('staffs', staffId).then(function(old) {
                if (old) {
                    old.role = newRole;
                    if (typeof DB.create === 'function') {
                        DB.create('staffs', old, staffId).catch(function() {});
                    }
                }
            }).catch(function() {});
        }
        showToast('✅ Đã thay đổi quyền thành ' + (newRole === 'admin' ? 'Admin' : 'Staff'), 'success');
        empLoadStaffPermissionList();
        empLoadStaffList();
    }).catch(function(err) {
        console.error('empToggleStaffRole error:', err);
        showToast('❌ Lỗi thay đổi quyền', 'error');
    });
}

function empCreateNewStaff() {
    var username = document.getElementById('newStaffUsername')?.value.trim();
    var password = document.getElementById('newStaffPassword')?.value.trim();

    if (!username || !password) {
        showToast('⚠️ Vui lòng nhập tên đăng nhập và mật khẩu', 'warning');
        return;
    }

    if (password.length < 4) {
        showToast('⚠️ Mật khẩu phải có ít nhất 4 ký tự', 'warning');
        return;
    }

    if (typeof DB === 'undefined' || typeof DB.createStaff !== 'function') {
        showToast('⚠️ Chưa sẵn sàng', 'warning');
        return;
    }

    var statusEl = document.getElementById('staffPermissionStatus');
    if (statusEl) statusEl.textContent = 'Đang tạo...';

    DB.createStaff({
        username: username,
        password: password,
        role: 'staff',
        displayName: username
    }).then(function() {
        var usernameInput = document.getElementById('newStaffUsername');
        var passwordInput = document.getElementById('newStaffPassword');
        if (usernameInput) usernameInput.value = '';
        if (passwordInput) passwordInput.value = '';
        if (statusEl) statusEl.textContent = '✅ Đã tạo nhân viên ' + username;
        showToast('✅ Đã tạo nhân viên ' + username, 'success');
        empLoadStaffPermissionList();
        empLoadStaffList();
    }).catch(function(err) {
        console.error('empCreateNewStaff error:', err);
        if (statusEl) statusEl.textContent = '❌ Lỗi: ' + (err.message || 'Không thể tạo');
        showToast('❌ Lỗi tạo nhân viên', 'error');
    });
}

function empDeleteStaffFromPerm(staffId, staffName) {
    empDeleteStaff(staffId, staffName);
}

// ============================================================
// 28. SHOW MANAGER EMPLOYEE DETAIL (từ manager-detail.js)
// ============================================================
function showManagerEmployeeDetail() {
    // Mở modal quản lý nhân viên
    openStaffManager();
}

// ============================================================
// 29. REFRESH TẤT CẢ VIEW NHÂN VIÊN
// ============================================================
function refreshAllStaffViews() {
    empLoadStaffList();

    // Refresh permission list trong settings
    if (typeof empLoadStaffPermissionList === 'function') {
        empLoadStaffPermissionList();
    }

    // Refresh manager employee button: tổng lương toàn bộ nhân viên
    empUpdateManagerButton();
}

/**
 * Cập nhật nút NHÂN VIÊN trong manager-grid:
 * - Tính toán realtime từ dữ liệu nhân viên + attendance + doanh thu, không cần lưu
 * - Dùng firebase on('value') để tự động cập nhật khi attendance hoặc daily_revenue thay đổi
 * - Gọi khi chuyển kỳ, khi có data thay đổi
 */
function empUpdateManagerButton(optPeriod) {
    var el = document.getElementById('managerTotalSalary');
    if (!el) return;

    var period = optPeriod || EMP.currentPeriod || empGetCurrentPeriod();
    var shopId = empGetShopId();

    if (typeof firebase === 'undefined' || !firebase.database) {
        el.textContent = '0đ';
        return;
    }

    // Hủy listener cũ nếu có
    if (EMP._salaryListener) {
        EMP._salaryListener.off();
    }

    // Hàm tính tổng lương realtime cho tất cả nhân viên
    function _calcTotalSalary() {
        var totalSalary = 0;
        // Nếu chưa có staffs, thử load từ DB
        var staffs = EMP.staffs;
        if (!staffs || staffs.length === 0) {
            if (typeof DB !== 'undefined' && typeof DB.getStaffs === 'function') {
                DB.getStaffs().then(function(loaded) {
                    EMP.staffs = loaded || [];
                    _calcTotalSalary();
                }).catch(function() {});
            }
            el.textContent = '0đ';
            return;
        }
        var parts = period.split('-');
        var year = parseInt(parts[0]);
        var month = parseInt(parts[1]);
        var daysInMonth = empGetDaysInMonth(year, month);
        var revenueCache = EMP._revenueCache || {};

        for (var si = 0; si < staffs.length; si++) {
            var st = staffs[si];
            if (!st || !st.id) continue;

            // Lấy dailySalary và revenueBonusEnabled từ cache hoặc staff object
            var dailySalary = st.dailySalary || 0;
            var revenueBonusEnabled = st.revenueBonusEnabled || false;

            // Ghi đè từ salaryCache nếu có
            var cached = EMP.salaryCache[st.id]?.[period];
            if (cached) {
                if (cached.dailySalary !== undefined && cached.dailySalary !== null) dailySalary = cached.dailySalary;
                if (cached.revenueBonusEnabled !== undefined && cached.revenueBonusEnabled !== null) revenueBonusEnabled = cached.revenueBonusEnabled;
            }

            // Tính ngày công
            var attendance = EMP.attendanceCache[st.id]?.[period] || {};
            var offDays = (attendance.offDays && Array.isArray(attendance.offDays)) ? attendance.offDays : [];
            var otDays = (attendance.otDays && Array.isArray(attendance.otDays)) ? attendance.otDays : [];
            var workingDays = daysInMonth - offDays.length + otDays.length;
            if (workingDays < 0) workingDays = 0;
            if (workingDays > daysInMonth * 2) workingDays = daysInMonth * 2;

            var baseSalary = dailySalary * workingDays;

            // Thưởng doanh thu - chỉ tính cho ngày đi làm (không off)
            var revenueBonus = 0;
            if (revenueBonusEnabled) {
                for (var d = 1; d <= daysInMonth; d++) {
                    var dateStr = year + '-' + String(month).padStart(2, '0') + '-' + String(d).padStart(2, '0');
                    // Bỏ qua ngày off - không tính thưởng doanh thu
                    if (offDays.indexOf(dateStr) !== -1) continue;
                    var dayRevenue = revenueCache[dateStr] || 0;
                    revenueBonus += Math.round(dayRevenue * 0.01);
                }
            }

            // Manual bonus/penalty từ salaryCache
            var manualBonus = (cached && cached.manualBonus) || 0;
            var manualPenalty = (cached && cached.manualPenalty) || 0;

            var total = baseSalary + revenueBonus + manualBonus - manualPenalty;
            if (total < 0) total = 0;
            totalSalary += total;
        }

        el.textContent = empFormatCurrency(totalSalary);
    }

    // Gọi ngay lần đầu
    _calcTotalSalary();

    // Listener attendance + daily_revenue để cập nhật realtime
    var attRef = firebase.database().ref(shopId + '/employee_attendance');
    var revRef = firebase.database().ref(shopId + '/daily_revenue');

    var attListener = attRef.on('value', function() {
        _calcTotalSalary();
    }, function() {});

    var revListener = revRef.on('value', function() {
        _calcTotalSalary();
    }, function() {});

    // Lưu reference để hủy sau
    EMP._salaryListener = {
        ref: attRef,
        off: function() {
            attRef.off('value', attListener);
            revRef.off('value', revListener);
        }
    };
}

// ============================================================
// 30. EXPORT GLOBAL
// ============================================================
// Export chính
window.openStaffManager = openStaffManager;
window.closeEmployeeManager = closeEmployeeManager;
window.showManagerEmployeeDetail = showManagerEmployeeDetail;
window.refreshAllStaffViews = refreshAllStaffViews;

// Export cho settings.js (phân quyền)
window.empLoadStaffPermissionList = empLoadStaffPermissionList;
window.empToggleStaffRole = empToggleStaffRole;
window.empCreateNewStaff = empCreateNewStaff;
window.empDeleteStaff = empDeleteStaff;

// Export alias để settings.js gọi không bị đệ quy
window._empLoadStaffPermList = empLoadStaffPermissionList;
window._empToggleRole = empToggleStaffRole;
window._empCreateStaff = empCreateNewStaff;
window._empDeleteStaff = empDeleteStaff;

// Export các hàm cũ cho tương thích
window.renderStaffList = function(staffs) {
    // Fallback: nếu có container staffList cũ thì render
    var container = document.getElementById('staffList');
    if (!container) return;
    if (!staffs || staffs.length === 0) {
        container.innerHTML = '<div class="empty-text">Chưa có nhân viên nào</div>';
        return;
    }
    var html = '';
    for (var i = 0; i < staffs.length; i++) {
        var s = staffs[i];
        var roleLabel = s.role === 'admin' ? '🛡️ Admin' : '👤 Nhân viên';
        html += '<div class="staff-item">' +
            '<div class="staff-info">' +
                '<div class="staff-name-display"><strong>' + _escapeHtml(s.displayName || s.username) + '</strong></div>' +
                '<div class="staff-username">@' + _escapeHtml(s.username) + '</div>' +
                '<div class="staff-role">' + roleLabel + '</div>' +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;
};
window.loadStaffPermissionList = empLoadStaffPermissionList;
window.toggleStaffRole = empToggleStaffRole;
window.createNewStaff = empCreateNewStaff;
window.deleteStaff = empDeleteStaff;
window.showAddStaffForm = function() {};
window.hideAddStaffForm = function() {};
window.handleAddStaff = function() {};
window.openEmployeeDetail = function(staffId) {
    openStaffManager();
    setTimeout(function() {
        empOpenStaffDetail(staffId);
    }, 500);
};
window.closeEmployeeDetail = function() {};
window.changeSalaryPeriod = function() {};
window.saveEmployeeSalary = function() {};
window.loadEmployeeSalaryHistory = function() {};
window.closeSalaryHistoryModal = function() {};

// Tự động cập nhật nút NHÂN VIÊN khi load xong
setTimeout(function() {
    if (document.getElementById('managerTotalSalary')) {
        // Dùng EMP.currentPeriod nếu đã có, nếu không thì lấy period mặc định
        var initPeriod = EMP.currentPeriod || empGetCurrentPeriod();
        empUpdateManagerButton(initPeriod);
    }
}, 1000);

// Đăng ký event listener cho pos_cash_update (gọi sau khi thanh toán thành công)
// để cập nhật daily_revenue lên Firebase realtime
document.addEventListener('pos_cash_update', function() {
    var today = new Date();
    var dateStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    empUpdateDailyRevenue(dateStr);
});

console.log('[employees.js] Loaded - Modal quản lý nhân viên');
