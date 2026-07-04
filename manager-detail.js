// manager-detail.js - Chi tiết Manager Grid khi click vào item
// ES5, tương thích Android 6, iOS 12

// ========== HÀM TIỆN ÍCH ==========
// Hàm chuyển Date -> YYYY-MM-DD dùng local time, tránh lỗi timezone UTC
function _toDateKey(d) {
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
}

function _getManagerDateRange() {
    var modeSelect = document.getElementById('managerViewModeSelect');
    var mode = modeSelect ? modeSelect.value : 'period';
    var offset = window.managerPeriodOffset || 0;
    var now = new Date();
    var startDate, endDate;

    if (mode === 'day') {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        endDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
    } else if (mode === 'month') {
        var m = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        startDate = new Date(m.getFullYear(), m.getMonth(), 1);
        endDate = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59);
    } else {
        // period: 20/tháng trước -> 19/tháng này, với offset
        var periodDate = new Date(now.getFullYear(), now.getMonth() + offset, now.getDate());
        var day = periodDate.getDate();
        if (day >= 20) {
            startDate = new Date(periodDate.getFullYear(), periodDate.getMonth(), 20);
            endDate = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 19, 23, 59, 59);
        } else {
            startDate = new Date(periodDate.getFullYear(), periodDate.getMonth() - 1, 20);
            endDate = new Date(periodDate.getFullYear(), periodDate.getMonth(), 19, 23, 59, 59);
        }
    }

    return {
        startStr: _toDateKey(startDate),
        endStr: _toDateKey(endDate),
        mode: mode,
        label: _getManagerPeriodLabel(mode, startDate, endDate)
    };
}

function _getManagerPeriodLabel(mode, startDate, endDate) {
    if (mode === 'period') {
        return 'Kỳ ' + formatDateDisplay(_toDateKey(startDate)) + ' \u2192 ' + formatDateDisplay(_toDateKey(endDate));
    } else if (mode === 'month') {
        return 'Tháng ' + (startDate.getMonth() + 1) + '/' + startDate.getFullYear();
    } else {
        return 'Ngày ' + formatDateDisplay(_toDateKey(startDate));
    }
}

function _formatTime(ts) {
    if (!ts) return '';
    try {
        var d = new Date(ts);
        var hh = d.getHours();
        var mm = d.getMinutes();
        return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    } catch(e) { return ''; }
}

function _getPaymentMethodIcon(method) {
    if (method === 'cash') return '\uD83D\uDCB0';
    if (method === 'transfer') return '\uD83D\uDCB3';
    if (method === 'grab') return '\uD83D\uDE95';
    if (method === 'debt') return '\uD83D\uDCA2';
    if (method === 'debt_payment') return '\uD83D\uDCB8';
    return '\uD83D\uDCB5';
}

// ========== HÀM HELPER: NHÓM GIAO DỊCH THEO NGÀY ==========
function _groupTransactionsByDay(transactions, filter, getMethodFromTx) {
    var dayMap = {};
    for (var i = 0; i < transactions.length; i++) {
        var tx = transactions[i];
        if (tx.refunded) continue;
        var method = getMethodFromTx ? getMethodFromTx(tx) : (tx.paymentMethod || 'cash');
        if (filter !== 'all' && method !== filter) continue;
        var dk = tx.dateKey || '';
        if (!dk && tx.date) {
            dk = tx.date.slice(0, 10);
        }
        if (!dk) continue;
        if (!dayMap[dk]) {
            dayMap[dk] = { dateKey: dk, methods: {}, items: [], total: 0 };
        }
        dayMap[dk].total += tx.amount || 0;
        if (!dayMap[dk].methods[method]) {
            dayMap[dk].methods[method] = { amount: 0, count: 0 };
        }
        dayMap[dk].methods[method].amount += tx.amount || 0;
        dayMap[dk].methods[method].count++;
        dayMap[dk].items.push(tx);
    }

    var dayKeys = Object.keys(dayMap).sort().reverse();
    var days = [];
    for (var j = 0; j < dayKeys.length; j++) {
        var dk = dayKeys[j];
        var dm = dayMap[dk];
        var methodList = [];
        var methodMap = dm.methods;
        var methodKeys = Object.keys(methodMap);
        var methodOrder = { cash: 0, transfer: 1, grab: 2, credit: 3, debt_payment: 4 };
        methodKeys.sort(function(a, b) {
            return (methodOrder[a] || 99) - (methodOrder[b] || 99);
        });
        for (var mk = 0; mk < methodKeys.length; mk++) {
            var mn = methodKeys[mk];
            // Chỉ hiển thị các method đã biết, bỏ qua method lạ
            var label = mn === 'cash' ? 'Ti\u1EC1n m\u1EB7t' : mn === 'transfer' ? 'Chuy\u1EC3n kho\u1EA3n' : mn === 'grab' ? 'Grab' : mn === 'credit' ? 'Ti\u1EC1n d\u01B0' : mn === 'debt_payment' ? 'Thanh to\u00E1n n\u1EE3' : null;
            if (!label) continue;
            var icon = _getPaymentMethodIcon(mn);
            methodList.push({ icon: icon, label: label, amount: methodMap[mn].amount, count: methodMap[mn].count });
        }
        days.push({
            label: formatDateDisplay(dk),
            dateKey: dk,
            total: dm.total,
            methods: methodList,
            items: dm.items
        });
    }
    return days;
}

// ========== MODAL CHI TIẾT ==========
function _openManagerDetail(title, filterFn, summaryFn, showFilters, updateBigValueFn) {
    var oldModal = document.getElementById('managerDetailModal');
    if (oldModal) oldModal.parentNode.removeChild(oldModal);

    var range = _getManagerDateRange();

    var modal = document.createElement('div');
    modal.className = 'manager-detail-modal active';
    modal.id = 'managerDetailModal';
    modal.onclick = function(e) {
        if (e.target === modal) _closeManagerDetail();
    };

    // Không hiển thị filter buttons
    var html = '<div class="manager-detail-content">' +
        '<div class="manager-detail-header">' +
            '<h3>' + title + '</h3>' +
            '<span class="manager-detail-close" onclick="_closeManagerDetail()">&times;</span>' +
        '</div>' +
        '<div class="manager-detail-summary" id="mdSummary"></div>' +
        '<div class="manager-detail-body" id="mdBody">' +
            '<div class="manager-detail-empty">\u23F3 \u0110ang t\u1EA3i...</div>' +
        '</div>' +
    '</div>';

    modal.innerHTML = html;
    document.body.appendChild(modal);

    modal._filterFn = filterFn;
    modal._summaryFn = summaryFn;
    modal._updateBigValueFn = updateBigValueFn || null;
    modal._currentFilter = 'all';

    _renderMDContent(modal, filterFn, summaryFn, 'all');
}

function _closeManagerDetail() {
    var modal = document.getElementById('managerDetailModal');
    if (modal) {
        modal.classList.remove('active');
        setTimeout(function() {
            if (modal.parentNode) modal.parentNode.removeChild(modal);
        }, 200);
    }
}

function _switchMDFilter(btn) {
    var container = btn.parentNode;
    var btns = container.querySelectorAll('.filter-btn');
    for (var i = 0; i < btns.length; i++) {
        btns[i].classList.remove('active');
    }
    btn.classList.add('active');

    var modal = document.getElementById('managerDetailModal');
    if (!modal) return;
    modal._currentFilter = btn.getAttribute('data-md-filter');

    _renderMDContent(modal, modal._filterFn, modal._summaryFn, modal._currentFilter);

    // Cập nhật big-value trên trang chính tương ứng với bộ lọc
    if (modal._updateBigValueFn) {
        modal._updateBigValueFn(modal._currentFilter);
    }
}

function _renderMDContent(modal, filterFn, summaryFn, filter) {
    var body = document.getElementById('mdBody');
    var summary = document.getElementById('mdSummary');
    if (!body) return;

    body.innerHTML = '<div class="manager-detail-empty">\u23F3 \u0110ang t\u1EA3i...</div>';

    var result = filterFn(filter);

    if (result && typeof result.then === 'function') {
        result.then(function(data) {
            _renderMDData(body, summary, data, summaryFn);
        }).catch(function() {
            body.innerHTML = '<div class="manager-detail-empty">\u274C L\u1ED7i t\u1EA3i d\u1EEF li\u1EC7u</div>';
        });
    } else {
        _renderMDData(body, summary, result, summaryFn);
    }
}

function _renderMDData(body, summary, data, summaryFn) {
    if (!data || !data.days || data.days.length === 0) {
        body.innerHTML = '<div class="manager-detail-empty">\uD83D\uDCED Kh\u00F4ng c\u00F3 d\u1EEF li\u1EC7u</div>';
        if (summary) summary.innerHTML = '';
        return;
    }

    // Render summary (tổng toàn kỳ)
    if (summary && summaryFn) {
        var summaryData = summaryFn(data);
        if (summaryData) {
            var sumHtml = '';
            for (var key in summaryData) {
                if (summaryData.hasOwnProperty(key)) {
                    sumHtml += '<span class="summary-chip">' + key + ': <strong>' + formatMoney(summaryData[key]) + '</strong></span>';
                }
            }
            summary.innerHTML = sumHtml;
        }
    }

    // Render accordion theo ngày - click mở rộng thấy methods + chi tiết giao dịch
    var html = '';
    for (var d = 0; d < data.days.length; d++) {
        var day = data.days[d];
        var isFirst = (d === 0);
        var dayTotal = day.total || 0;

        html += '<div class="md-accordion' + (isFirst ? ' expanded' : '') + '">' +
            '<div class="md-accordion-header" onclick="_toggleMDAccordion(this)">' +
                '<div class="md-accordion-title">' +
                    '<span class="md-accordion-icon">' + (isFirst ? '\u25BC' : '\u25B6') + '</span>' +
                    '<span class="md-accordion-date">' + escapeHtml(day.label) + '</span>' +
                '</div>' +
                '<div class="md-accordion-total">' + formatMoney(dayTotal) + '</div>' +
            '</div>' +
            '<div class="md-accordion-body" style="display:' + (isFirst ? 'block' : 'none') + ';">';

        // Các dòng phương thức thanh toán trong ngày - kèm số lượng giao dịch
        if (day.methods && day.methods.length > 0) {
            for (var m = 0; m < day.methods.length; m++) {
                var method = day.methods[m];
                // Dùng count từ _groupTransactionsByDay (đã đếm chính xác theo method)
                var txCount = method.count || 0;
                html += '<div class="md-method-row">' +
                    '<div class="md-method-label">' + (method.icon || '') + ' ' + escapeHtml(method.label) + '</div>' +
                    '<div class="md-method-right">' +
                        '<span class="md-method-count">' + txCount + ' giao d\u1ECBch</span>' +
                        '<span class="md-method-amount">' + formatMoney(method.amount) + '</span>' +
                    '</div>' +
                '</div>';
            }
        }

        // Chi tiết từng giao dịch trong ngày
        if (day.items && day.items.length > 0) {
            html += '<div class="md-tx-list">';
            for (var i = 0; i < day.items.length; i++) {
                var tx = day.items[i];
                var icon, label, sub;
                // Ưu tiên dùng icon/label/sub có sẵn trong item (công nợ, nhân viên, ...)
                if (tx.icon && tx.label) {
                    icon = tx.icon;
                    label = tx.label;
                    sub = tx.sub || '';
                } else if (tx.fundSource === 'pos_cash' || tx.fundSource === 'management') {
                    // Chi phí: hiển thị đúng loại chi phí + nguồn tiền
                    var typeIcon = tx.costType === 'ingredient' ? '\uD83E\uDDCA' : '\uD83D\uDCE6';
                    var fundIcon = tx.fundSource === 'pos_cash' ? '\uD83C\uDFE6' : '\uD83D\uDC54';
                    icon = fundIcon;
                    label = typeIcon + ' ' + (tx.categoryName || 'Chi ph\u00ED');
                    var typeLabel = tx.costType === 'ingredient' ? 'Nguy\u00EAn li\u1EC7u' : 'Hao ph\u00ED';
                    var fundLabel = tx.fundSource === 'pos_cash' ? 'K\u00E9t POS' : 'QLTT';
                    sub = _formatTime(tx.createdAt || tx.date) + ' - ' + typeLabel + ' - ' + fundLabel;
                } else {
                    // Giao dịch bán hàng thông thường
                    icon = _getPaymentMethodIcon(tx.paymentMethod || 'cash');
                    label = tx.note || tx.tableName || (tx.type === 'takeaway' ? 'Mang \u0111i' : (tx.type === 'grab' ? 'Grab' : 'T\u1EA1i ch\u1ED7'));
                    if (tx.customer && tx.customer.name) label = tx.customer.name;
                    sub = _formatTime(tx.createdAt || tx.date) + ' - ' + (tx.paymentMethod === 'cash' ? 'Ti\u1EC1n m\u1EB7t' : tx.paymentMethod === 'transfer' ? 'CK' : tx.paymentMethod === 'grab' ? 'Grab' : 'N\u1EE3');
                }
                html += '<div class="manager-detail-item">' +
                    '<div class="item-left">' +
                        '<div class="item-title">' + icon + ' ' + escapeHtml(label) + '</div>' +
                        '<div class="item-sub">' + escapeHtml(sub) + '</div>' +
                    '</div>' +
                    '<div class="item-amount">' + formatMoney(tx.amount) + '</div>' +
                '</div>';
            }
            html += '</div>';
        }

        html += '</div></div>'; // close accordion-body, accordion
    }
    body.innerHTML = html;
}

function _toggleMDAccordion(header) {
    var accordion = header.parentNode;
    var body = accordion.querySelector('.md-accordion-body');
    var icon = header.querySelector('.md-accordion-icon');
    if (!body) return;
    if (accordion.classList.contains('expanded')) {
        accordion.classList.remove('expanded');
        body.style.display = 'none';
        if (icon) icon.textContent = '\u25B6';
    } else {
        accordion.classList.add('expanded');
        body.style.display = 'block';
        if (icon) icon.textContent = '\u25BC';
    }
}

// ========== CÁC HÀM CLICK CHO TỪNG BOX ==========

// 1. DOANH THU
function showManagerRevenueDetail() {
    var range = _getManagerDateRange();
    _openManagerDetail(
        '\uD83D\uDCB0 Doanh thu - ' + range.label,
        function(filter) {
            return DB.getTransactionsByDateRange(range.startStr, range.endStr).then(function(transactions) {
                // Chỉ tính doanh thu cho cash, transfer, grab (giống settings.js)
                // - Ghi nợ (mua chịu): paymentMethod='debt' -> loại bỏ
                // - Thanh toán nợ (trả nợ): type='debt_payment', paymentMethod='cash'|'transfer'|'grab' -> giữ lại
                // - Các phương thức khác (credit, v.v.) -> bỏ qua
                var filteredTx = transactions.filter(function(tx) {
                    if (tx.refunded) return false;
                    if (tx.paymentMethod === 'debt') return false;
                    if (tx.paymentMethod !== 'cash' && tx.paymentMethod !== 'transfer' && tx.paymentMethod !== 'grab') return false;
                    return true;
                });
                var days = _groupTransactionsByDay(filteredTx, filter, function(tx) {
                    // Nhóm thanh toán nợ riêng (chỉ khi là debt_payment NHƯNG không phải ghi nợ)
                    if (tx.type === 'debt_payment' && tx.paymentMethod !== 'debt') return 'debt_payment';
                    return tx.paymentMethod || 'cash';
                });
                var grandTotal = 0;
                for (var d = 0; d < days.length; d++) {
                    grandTotal += days[d].total;
                }
                return { days: days, total: grandTotal };
            });
        },
        function(data) {
            return { 'T\u1ED5ng doanh thu': data.total, 'S\u1ED1 ng\u00E0y': data.days.length };
        },
        true,
        function(filter) {
            var el = document.getElementById('managerRevenue');
            if (!el) return;
            var fn = function(f) {
                return DB.getTransactionsByDateRange(range.startStr, range.endStr).then(function(transactions) {
                    // Chỉ tính doanh thu cho cash, transfer, grab (giống settings.js)
                    var filteredTx = transactions.filter(function(tx) {
                        if (tx.refunded) return false;
                        if (tx.paymentMethod === 'debt') return false;
                        if (tx.paymentMethod !== 'cash' && tx.paymentMethod !== 'transfer' && tx.paymentMethod !== 'grab') return false;
                        return true;
                    });
                    var days = _groupTransactionsByDay(filteredTx, f, function(tx) {
                        // Nhóm thanh toán nợ riêng (chỉ khi là debt_payment NHƯNG không phải ghi nợ)
                        if (tx.type === 'debt_payment' && tx.paymentMethod !== 'debt') return 'debt_payment';
                        return tx.paymentMethod || 'cash';
                    });
                    var total = 0;
                    for (var d = 0; d < days.length; d++) { total += days[d].total; }
                    el.textContent = formatMoney(total);
                });
            };
            fn(filter);
        }
    );
}

// 2. GRAB
function showManagerGrabDetail() {
    var range = _getManagerDateRange();
    _openManagerDetail(
        '\uD83D\uDE95 Grab - ' + range.label,
        function(filter) {
            return DB.getTransactionsByDateRange(range.startStr, range.endStr).then(function(transactions) {
                // Lọc bỏ ghi nợ (mua chịu) - paymentMethod === 'debt'
                var filteredTx = transactions.filter(function(tx) {
                    if (tx.refunded) return false;
                    if (tx.paymentMethod === 'debt') return false;
                    return true;
                });
                var days = _groupTransactionsByDay(filteredTx, 'all', function(tx) {
                    return tx.paymentMethod || 'cash';
                });
                var grabDays = [];
                var grandTotal = 0;
                for (var d = 0; d < days.length; d++) {
                    var day = days[d];
                    var grabMethods = [];
                    var grabTotal = 0;
                    for (var m = 0; m < day.methods.length; m++) {
                        if (day.methods[m].label === 'Grab') {
                            grabMethods.push(day.methods[m]);
                            grabTotal += day.methods[m].amount;
                        }
                    }
                    if (grabTotal > 0) {
                        grabDays.push({
                            label: day.label,
                            dateKey: day.dateKey,
                            total: grabTotal,
                            methods: grabMethods,
                            items: day.items.filter(function(tx) { return tx.paymentMethod === 'grab'; })
                        });
                        grandTotal += grabTotal;
                    }
                }
                return { days: grabDays, total: grandTotal };
            });
        },
        function(data) {
            return { 'T\u1ED5ng Grab': data.total, 'S\u1ED1 ng\u00E0y': data.days.length };
        },
        false,
        function(filter) {
            var el = document.getElementById('managerGrab');
            if (!el) return;
            DB.getTransactionsByDateRange(range.startStr, range.endStr).then(function(transactions) {
                var filteredTx = transactions.filter(function(tx) {
                    if (tx.refunded) return false;
                    if (tx.paymentMethod === 'debt') return false;
                    return true;
                });
                var days = _groupTransactionsByDay(filteredTx, 'all', function(tx) {
                    return tx.paymentMethod || 'cash';
                });
                var total = 0;
                for (var d = 0; d < days.length; d++) {
                    for (var m = 0; m < days[d].methods.length; m++) {
                        if (days[d].methods[m].label === 'Grab') {
                            total += days[d].methods[m].amount;
                        }
                    }
                }
                el.textContent = formatMoney(total);
            });
        }
    );
}

// 3. CHUYỂN KHOẢN
function showManagerBankDetail() {
    var range = _getManagerDateRange();
    _openManagerDetail(
        '\uD83C\uDFE6 Chuy\u1EC3n kho\u1EA3n - ' + range.label,
        function(filter) {
            return DB.getTransactionsByDateRange(range.startStr, range.endStr).then(function(transactions) {
                // Lọc bỏ ghi nợ (mua chịu) - paymentMethod === 'debt'
                var filteredTx = transactions.filter(function(tx) {
                    if (tx.refunded) return false;
                    if (tx.paymentMethod === 'debt') return false;
                    return true;
                });
                var days = _groupTransactionsByDay(filteredTx, 'all', function(tx) {
                    return tx.paymentMethod || 'cash';
                });
                var bankDays = [];
                var grandTotal = 0;
                for (var d = 0; d < days.length; d++) {
                    var day = days[d];
                    var bankMethods = [];
                    var bankTotal = 0;
                    for (var m = 0; m < day.methods.length; m++) {
                        if (day.methods[m].label === 'Chuy\u1EC3n kho\u1EA3n') {
                            bankMethods.push(day.methods[m]);
                            bankTotal += day.methods[m].amount;
                        }
                    }
                    if (bankTotal > 0) {
                        bankDays.push({
                            label: day.label,
                            dateKey: day.dateKey,
                            total: bankTotal,
                            methods: bankMethods,
                            items: day.items.filter(function(tx) { return tx.paymentMethod === 'transfer'; })
                        });
                        grandTotal += bankTotal;
                    }
                }
                return { days: bankDays, total: grandTotal };
            });
        },
        function(data) {
            return { 'T\u1ED5ng CK': data.total, 'S\u1ED1 ng\u00E0y': data.days.length };
        },
        false,
        function(filter) {
            var el = document.getElementById('managerBank');
            if (!el) return;
            DB.getTransactionsByDateRange(range.startStr, range.endStr).then(function(transactions) {
                var filteredTx = transactions.filter(function(tx) {
                    if (tx.refunded) return false;
                    if (tx.paymentMethod === 'debt') return false;
                    return true;
                });
                var days = _groupTransactionsByDay(filteredTx, 'all', function(tx) {
                    return tx.paymentMethod || 'cash';
                });
                var total = 0;
                for (var d = 0; d < days.length; d++) {
                    for (var m = 0; m < days[d].methods.length; m++) {
                        if (days[d].methods[m].label === 'Chuy\u1EC3n kho\u1EA3n') {
                            total += days[d].methods[m].amount;
                        }
                    }
                }
                el.textContent = formatMoney(total);
            });
        }
    );
}

// 4. THỰC NHẬN (CASH) - lấy từ manager_cash_pickups (tiền QL nhận tại POS)
function showManagerCashDetail() {
    var range = _getManagerDateRange();
    _openManagerDetail(
        '\uD83D\uDCB5 Th\u1EF1c nh\u1EADn (Ti\u1EC1n m\u1EB7t) - ' + range.label,
        function(filter) {
            return DB.getAll('manager_cash_pickups').then(function(pickups) {
                // Lọc pickups trong date range
                var filtered = [];
                for (var p = 0; p < pickups.length; p++) {
                    var pk = pickups[p];
                    if (pk.dateKey && pk.dateKey >= range.startStr && pk.dateKey <= range.endStr) {
                        filtered.push(pk);
                    }
                }
                // Nhóm theo dateKey
                var dayMap = {};
                for (var i = 0; i < filtered.length; i++) {
                    var pk = filtered[i];
                    var dk = pk.dateKey;
                    if (!dayMap[dk]) {
                        dayMap[dk] = { dateKey: dk, items: [], total: 0 };
                    }
                    dayMap[dk].total += pk.amount || 0;
                    // Thêm paymentMethod để _renderMDData hiển thị đúng icon
                    pk.paymentMethod = 'cash';
                    dayMap[dk].items.push(pk);
                }
                var dayKeys = Object.keys(dayMap).sort().reverse();
                var days = [];
                var grandTotal = 0;
                for (var j = 0; j < dayKeys.length; j++) {
                    var dk = dayKeys[j];
                    var dm = dayMap[dk];
                    days.push({
                        label: formatDateDisplay(dk),
                        dateKey: dk,
                        total: dm.total,
                        methods: [{
                            icon: '\uD83D\uDCB0',
                            label: 'Ti\u1EC1n m\u1EB7t',
                            amount: dm.total
                        }],
                        items: dm.items
                    });
                    grandTotal += dm.total;
                }
                return { days: days, total: grandTotal };
            });
        },
        function(data) {
            return { 'T\u1ED5ng ti\u1EC1n m\u1EB7t': data.total, 'S\u1ED1 ng\u00E0y': data.days.length };
        },
        false,
        function(filter) {
            var el = document.getElementById('managerCash');
            if (!el) return;
            DB.getAll('manager_cash_pickups').then(function(pickups) {
                var total = 0;
                for (var p = 0; p < pickups.length; p++) {
                    var pk = pickups[p];
                    if (pk.dateKey && pk.dateKey >= range.startStr && pk.dateKey <= range.endStr) {
                        total += pk.amount || 0;
                    }
                }
                el.textContent = formatMoney(total);
            });
        }
    );
}

// 5. CHI PHÍ TỪ KÉT POS
function showManagerExpenseDetail() {
    var range = _getManagerDateRange();
    _openManagerDetail(
        '\uD83C\uDFE6 Chi ph\u00ED t\u1EEB K\u00E9t POS - ' + range.label,
        function(filter) {
            var allCosts = (typeof expenseData !== 'undefined' && expenseData.transactions) ? expenseData.transactions : [];
            var filtered = allCosts.filter(function(c) {
                return c.dateKey >= range.startStr && c.dateKey <= range.endStr && !c.deleted && c.fundSource === 'pos_cash';
            });
            var dayMap = {};
            for (var i = 0; i < filtered.length; i++) {
                var c = filtered[i];
                var dk = c.dateKey || '';
                if (!dk) continue;
                if (!dayMap[dk]) {
                    dayMap[dk] = { dateKey: dk, methods: {}, items: [], total: 0 };
                }
                dayMap[dk].total += c.amount || 0;
                var cat = c.categoryName || 'Chi ph\u00ED';
                if (!dayMap[dk].methods[cat]) dayMap[dk].methods[cat] = 0;
                dayMap[dk].methods[cat] += c.amount || 0;
                dayMap[dk].items.push(c);
            }
            var dayKeys = Object.keys(dayMap).sort().reverse();
            var days = [];
            var grandTotal = 0;
            for (var j = 0; j < dayKeys.length; j++) {
                var dk = dayKeys[j];
                var dm = dayMap[dk];
                var methodList = [];
                for (var mk in dm.methods) {
                    if (dm.methods.hasOwnProperty(mk)) {
                        methodList.push({ icon: '\uD83D\uDCE6', label: mk, amount: dm.methods[mk] });
                    }
                }
                days.push({
                    label: formatDateDisplay(dk),
                    dateKey: dk,
                    total: dm.total,
                    methods: methodList,
                    items: dm.items
                });
                grandTotal += dm.total;
            }
            return { days: days, total: grandTotal };
        },
        function(data) {
            return { 'T\u1ED5ng chi ph\u00ED POS': data.total, 'S\u1ED1 ng\u00E0y': data.days.length };
        },
        false,
        function(filter) {
            var el = document.getElementById('managerExpense');
            if (!el) return;
            var allCosts = (typeof expenseData !== 'undefined' && expenseData.transactions) ? expenseData.transactions : [];
            var filtered = allCosts.filter(function(c) {
                return c.dateKey >= range.startStr && c.dateKey <= range.endStr && !c.deleted && c.fundSource === 'pos_cash';
            });
            var total = 0;
            for (var i = 0; i < filtered.length; i++) {
                total += filtered[i].amount || 0;
            }
            el.textContent = formatMoney(total);
        }
    );
}

// 6. CÔNG NỢ PHÁT SINH
function showManagerDebtOccurDetail() {
    var range = _getManagerDateRange();
    _openManagerDetail(
        '\uD83D\uDCCA C\u00F4ng n\u1EE3 ph\u00E1t sinh - ' + range.label,
        function(filter) {
            return DB.getAll('customers').then(function(allCustomers) {
                var dayMap = {};
                var grandTotal = 0;
                for (var ci = 0; ci < allCustomers.length; ci++) {
                    var cust = allCustomers[ci];
                    if (cust.debtHistory && cust.debtHistory.length > 0) {
                        for (var hi = 0; hi < cust.debtHistory.length; hi++) {
                            var dh = cust.debtHistory[hi];
                            var dhDate = dh.date ? dh.date.slice(0, 10) : '';
                            if (dhDate >= range.startStr && dhDate <= range.endStr) {
                                if (!dayMap[dhDate]) {
                                    dayMap[dhDate] = { dateKey: dhDate, methods: {}, items: [], total: 0 };
                                }
                                dayMap[dhDate].total += dh.amount || 0;
                                var methodKey = 'debt';
                                if (!dayMap[dhDate].methods[methodKey]) dayMap[dhDate].methods[methodKey] = 0;
                                dayMap[dhDate].methods[methodKey] += dh.amount || 0;
                                dayMap[dhDate].items.push({
                                    icon: '\uD83D\uDC64',
                                    label: cust.name || 'Kh\u00E1ch ' + cust.id,
                                    sub: cust.phone || '',
                                    amount: dh.amount || 0
                                });
                                grandTotal += dh.amount || 0;
                            }
                        }
                    }
                }
                var dayKeys = Object.keys(dayMap).sort().reverse();
                var days = [];
                for (var j = 0; j < dayKeys.length; j++) {
                    var dk = dayKeys[j];
                    var dm = dayMap[dk];
                    var methodList = [];
                    for (var mk in dm.methods) {
                        if (dm.methods.hasOwnProperty(mk)) {
                            methodList.push({ icon: '\uD83D\uDCA2', label: 'N\u1EE3 ph\u00E1t sinh', amount: dm.methods[mk] });
                        }
                    }
                    days.push({
                        label: formatDateDisplay(dk),
                        dateKey: dk,
                        total: dm.total,
                        methods: methodList,
                        items: dm.items
                    });
                }
                return { days: days, total: grandTotal };
            });
        },
        function(data) {
            return { 'T\u1ED5ng n\u1EE3 ph\u00E1t sinh': data.total, 'S\u1ED1 ng\u00E0y': data.days.length };
        },
        false,
        function(filter) {
            var el = document.getElementById('managerDebt');
            if (!el) return;
            DB.getAll('customers').then(function(allCustomers) {
                var total = 0;
                for (var ci = 0; ci < allCustomers.length; ci++) {
                    var cust = allCustomers[ci];
                    if (cust.debtHistory && cust.debtHistory.length > 0) {
                        for (var hi = 0; hi < cust.debtHistory.length; hi++) {
                            var dh = cust.debtHistory[hi];
                            var dhDate = dh.date ? dh.date.slice(0, 10) : '';
                            if (dhDate >= range.startStr && dhDate <= range.endStr) {
                                total += dh.amount || 0;
                            }
                        }
                    }
                }
                el.textContent = formatMoney(total);
            });
        }
    );
}

// 7. TỔNG CP QUẢN LÝ
function showManagerAdminExpenseDetail() {
    var range = _getManagerDateRange();
    _openManagerDetail(
        '\uD83D\uDCCB T\u1ED5ng CP Qu\u1EA3n l\u00FD - ' + range.label,
        function(filter) {
            var allCosts = (typeof expenseData !== 'undefined' && expenseData.transactions) ? expenseData.transactions : [];
            var filtered = allCosts.filter(function(c) {
                return c.dateKey >= range.startStr && c.dateKey <= range.endStr && !c.deleted && c.fundSource === 'management';
            });
            var dayMap = {};
            for (var i = 0; i < filtered.length; i++) {
                var c = filtered[i];
                var dk = c.dateKey || '';
                if (!dk) continue;
                if (!dayMap[dk]) {
                    dayMap[dk] = { dateKey: dk, methods: {}, items: [], total: 0 };
                }
                dayMap[dk].total += c.amount || 0;
                var cat = c.categoryName || 'CP Qu\u1EA3n l\u00FD';
                if (!dayMap[dk].methods[cat]) dayMap[dk].methods[cat] = 0;
                dayMap[dk].methods[cat] += c.amount || 0;
                dayMap[dk].items.push(c);
            }
            var dayKeys = Object.keys(dayMap).sort().reverse();
            var days = [];
            var grandTotal = 0;
            for (var j = 0; j < dayKeys.length; j++) {
                var dk = dayKeys[j];
                var dm = dayMap[dk];
                var methodList = [];
                for (var mk in dm.methods) {
                    if (dm.methods.hasOwnProperty(mk)) {
                        methodList.push({ icon: '\uD83D\uDC54', label: mk, amount: dm.methods[mk] });
                    }
                }
                days.push({
                    label: formatDateDisplay(dk),
                    dateKey: dk,
                    total: dm.total,
                    methods: methodList,
                    items: dm.items
                });
                grandTotal += dm.total;
            }
            return { days: days, total: grandTotal };
        },
        function(data) {
            return { 'T\u1ED5ng CP QL': data.total, 'S\u1ED1 ng\u00E0y': data.days.length };
        },
        false,
        function(filter) {
            var el = document.getElementById('managerAdminExpense');
            if (!el) return;
            var allCosts = (typeof expenseData !== 'undefined' && expenseData.transactions) ? expenseData.transactions : [];
            var filtered = allCosts.filter(function(c) {
                return c.dateKey >= range.startStr && c.dateKey <= range.endStr && !c.deleted && c.fundSource === 'management';
            });
            var total = 0;
            for (var i = 0; i < filtered.length; i++) {
                total += filtered[i].amount || 0;
            }
            el.textContent = formatMoney(total);
        }
    );
}

// 8. TỔNG CÔNG NỢ
function showManagerTotalDebtDetail() {
    _openManagerDetail(
        '\uD83C\uDFE6 T\u1ED4NG C\u00D4NG N\u1EE2',
        function(filter) {
            return DB.getAll('customers').then(function(allCustomers) {
                var debtCustomers = allCustomers.filter(function(c) { return (c.totalDebt || 0) > 0; });
                var items = [];
                var total = 0;
                for (var i = 0; i < debtCustomers.length; i++) {
                    var c = debtCustomers[i];
                    items.push({
                        icon: '\uD83D\uDC64',
                        label: c.name || 'Kh\u00E1ch ' + c.id,
                        sub: c.phone || '',
                        amount: c.totalDebt || 0
                    });
                    total += c.totalDebt || 0;
                }
                var days = [{
                    label: 'Danh s\u00E1ch kh\u00E1ch n\u1EE3',
                    dateKey: '',
                    total: total,
                    methods: [{ icon: '\uD83D\uDCA2', label: 'T\u1ED5ng n\u1EE3', amount: total }],
                    items: items
                }];
                return { days: days, total: total };
            });
        },
        function(data) {
            return { 'T\u1ED5ng n\u1EE3': data.total, 'S\u1ED1 kh\u00E1ch n\u1EE3': data.days[0] ? data.days[0].items.length : 0 };
        },
        false,
        function(filter) {
            var el = document.getElementById('managerTotalDebt');
            if (!el) return;
            DB.getAll('customers').then(function(allCustomers) {
                var total = 0;
                for (var i = 0; i < allCustomers.length; i++) {
                    total += allCustomers[i].totalDebt || 0;
                }
                el.textContent = formatMoney(total);
            });
        }
    );
}

// 9. NHÂN VIÊN - Đã chuyển hoàn toàn sang employees.js (Modal quản lý)
function showManagerEmployeeDetail() {
    // Mở modal quản lý nhân viên từ employees.js
    if (typeof window.openStaffManager === 'function') {
        window.openStaffManager();
    } else {
        showToast('⚠️ Chưa sẵn sàng', 'warning');
    }
}

// 10. THU NHẬP RÒNG
// ========== QUỸ POS - CHI TIẾT ==========
// Hiển thị lịch sử giao dịch quỹ (dailyFund + history) theo ngày
function showManagerPosFundDetail() {
    var range = _getManagerDateRange();
    var title = '\uD83C\uDFE6 QU\u1EF8 POS - ' + range.label;

    // Xóa modal cũ nếu có
    var oldModal = document.getElementById('managerDetailModal');
    if (oldModal) oldModal.parentNode.removeChild(oldModal);

    var modal = document.createElement('div');
    modal.className = 'manager-detail-modal active';
    modal.id = 'managerDetailModal';
    modal.onclick = function(e) {
        if (e.target === modal) _closeManagerDetail();
    };

    var html = '<div class="manager-detail-content">' +
        '<div class="manager-detail-header">' +
            '<h3>' + title + '</h3>' +
            '<span class="manager-detail-close" onclick="_closeManagerDetail()">&times;</span>' +
        '</div>' +
        '<div class="manager-detail-summary" id="mdSummary"></div>' +
        '<div class="manager-detail-body" id="mdBody">' +
            '<div class="manager-detail-empty">\u23F3 \u0110ang t\u1EA3i...</div>' +
        '</div>' +
    '</div>';

    modal.innerHTML = html;
    document.body.appendChild(modal);

    // Load dữ liệu quỹ
    _loadPosFundData(modal, range);
}

function _loadPosFundData(modal, range) {
    var body = document.getElementById('mdBody');
    var summary = document.getElementById('mdSummary');
    if (!body) {
        body = modal.querySelector('#mdBody');
        summary = modal.querySelector('#mdSummary');
        if (!body) return;
    }

    body.innerHTML = '<div class="manager-detail-empty">\u23F3 \u0110ang t\u1EA3i...</div>';

    var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
    var fundRef = firebase.database().ref(shopId + '/responsibility_fund');

    fundRef.once('value', function(snapshot) {
        var fundData = snapshot.val() || {};
        var balance = fundData.balance || 0;

        // Sử dụng hàm dùng chung _buildFundEntries() để xây dựng entries
        var allEntries = _buildFundEntries(fundData);

        // Lọc theo date range
        var filtered = [];
        for (var fi = 0; fi < allEntries.length; fi++) {
            var item = allEntries[fi];
            if (item.dateKey && item.dateKey >= range.startStr && item.dateKey <= range.endStr) {
                filtered.push(item);
            }
        }

        if (filtered.length === 0) {
            body.innerHTML = '<div class="manager-detail-empty">\uD83D\uDCED Kh\u00F4ng c\u00F3 giao d\u1ECBch qu\u1EF9 trong k\u1EF3</div>';
            if (summary) summary.innerHTML = '';
            return;
        }

        // Render summary: số dư hiện tại
        if (summary) {
            var sumHtml = '<span class="summary-chip" style="color:#fbbf24;">\uD83C\uDFE6 S\u1ED1 d\u01B0 qu\u1EF9: <strong>' + formatMoney(balance) + '</strong></span>' +
                '<span class="summary-chip">\uD83D\uDCCA S\u1ED1 giao d\u1ECBch: <strong>' + filtered.length + '</strong></span>';
            summary.innerHTML = sumHtml;
        }

        // Sử dụng hàm dùng chung _renderFundEntriesHTML() để render HTML
        _renderFundEntriesHTML(filtered, {
            showDeleteBtn: false,
            showDetail: true,
            maxDisplay: 0,
            containerId: 'mdBody',
            showMoreBtnId: ''
        });
    }).catch(function(err) {
        console.error('_loadPosFundData error:', err);
        body.innerHTML = '<div class="manager-detail-empty">\u274C L\u1ED7i t\u1EA3i d\u1EEF li\u1EC7u qu\u1EF9</div>';
    });
}

// Export global
window.showManagerRevenueDetail = showManagerRevenueDetail;
window.showManagerGrabDetail = showManagerGrabDetail;
window.showManagerBankDetail = showManagerBankDetail;
window.showManagerCashDetail = showManagerCashDetail;
window.showManagerExpenseDetail = showManagerExpenseDetail;
window.showManagerDebtOccurDetail = showManagerDebtOccurDetail;
window.showManagerAdminExpenseDetail = showManagerAdminExpenseDetail;
window.showManagerTotalDebtDetail = showManagerTotalDebtDetail;
window.showManagerEmployeeDetail = showManagerEmployeeDetail;
window.showManagerPosFundDetail = showManagerPosFundDetail;
window._closeManagerDetail = _closeManagerDetail;

// ========== CẬP NHẬT BIG-VALUE TRÊN TRANG CHÍNH ==========
// Hàm này query transactions, customers, staffs và cập nhật tất cả 10 big-value
function updateManagerBigValues(startStr, endStr) {
    // Query transactions trong date range
    var txPromise = DB.getTransactionsByDateRange(startStr, endStr);
    // Query customers để tính công nợ
    var custPromise = DB.getAll('customers');
    // Query staffs để đếm nhân viên
    var staffPromise = DB.getAll('staffs');
    // Query manager_cash_pickups (tiền QL nhận)
    var pickupPromise = DB.getAll('manager_cash_pickups');

    Promise.all([txPromise, custPromise, staffPromise, pickupPromise]).then(function(results) {
        var transactions = results[0] || [];
        var allCustomers = results[1] || [];
        var allStaffs = results[2] || [];
        var allPickups = results[3] || [];

        // Lọc transactions không bị refund
        var validTx = transactions.filter(function(t) { return !t.refunded; });

        // Tính tổng doanh thu = cash + transfer + grab + thanh toán nợ (giống settings.js)
        // - paymentMethod === 'debt': ghi nợ (mua chịu) -> loại bỏ
        // - paymentMethod !== 'cash'|'transfer'|'grab': các phương thức khác (credit, v.v.) -> bỏ qua
        // - Thanh toán nợ (type='debt_payment', paymentMethod='cash'|'transfer'|'grab'): giữ lại
        var totalRevenue = 0;
        var totalGrab = 0;
        var totalBank = 0;

        for (var i = 0; i < validTx.length; i++) {
            var tx = validTx[i];
            if (tx.paymentMethod === 'debt') continue;
            if (tx.paymentMethod !== 'cash' && tx.paymentMethod !== 'transfer' && tx.paymentMethod !== 'grab') continue;
            totalRevenue += tx.amount || 0;
            if (tx.paymentMethod === 'grab') totalGrab += tx.amount || 0;
            else if (tx.paymentMethod === 'transfer') totalBank += tx.amount || 0;
        }

        // Tính tổng tiền QL nhận (manager_cash_pickups) trong date range
        var totalCash = 0;
        for (var p = 0; p < allPickups.length; p++) {
            var pk = allPickups[p];
            if (pk.dateKey && pk.dateKey >= startStr && pk.dateKey <= endStr) {
                totalCash += pk.amount || 0;
            }
        }

        // Tính công nợ phát sinh trong kỳ (debtHistory trong date range)
        var totalDebtOccur = 0;
        for (var c = 0; c < allCustomers.length; c++) {
            var cust = allCustomers[c];
            if (cust.debtHistory && cust.debtHistory.length) {
                for (var d = 0; d < cust.debtHistory.length; d++) {
                    var dh = cust.debtHistory[d];
                    // debtHistory lưu date (ISO string), không có dateKey
                    var dhDate = dh.dateKey || (dh.date ? dh.date.slice(0, 10) : '');
                    if (dhDate >= startStr && dhDate <= endStr) {
                        totalDebtOccur += Math.abs(dh.amount || 0);
                    }
                }
            }
        }

        // Tính tổng công nợ còn lại (tất cả customers)
        var totalDebt = 0;
        for (var c2 = 0; c2 < allCustomers.length; c2++) {
            totalDebt += allCustomers[c2].totalDebt || 0;
        }

        // Đếm nhân viên
        var staffCount = allStaffs.length;

        // Lấy chi phí từ expenseData (đã được tính trong managerApplyFilter)
        // expenseData.transactions được filter sẵn trong managerApplyFilter
        var allCosts = (window.expenseData && window.expenseData.transactions) || [];
        var totalStaffCost = 0;
        var totalMgmtCost = 0;
        for (var k = 0; k < allCosts.length; k++) {
            var c3 = allCosts[k];
            if (c3.dateKey >= startStr && c3.dateKey <= endStr && !c3.deleted) {
                if (c3.fundSource === 'pos_cash') totalStaffCost += c3.amount;
                else totalMgmtCost += c3.amount;
            }
        }
        var totalCost = totalStaffCost + totalMgmtCost;

        // Helper cập nhật big-value
        function _setBigValue(id, value) {
            var el = document.getElementById(id);
            if (el) el.textContent = formatMoney(value);
        }

        // Cập nhật tất cả big-value
        _setBigValue('managerRevenue', totalRevenue);
        _setBigValue('managerGrab', totalGrab);
        _setBigValue('managerBank', totalBank);
        _setBigValue('managerCash', totalCash);
        _setBigValue('managerExpense', totalStaffCost);
        _setBigValue('managerDebt', totalDebtOccur);
        _setBigValue('managerAdminExpense', totalMgmtCost);
        _setBigValue('managerTotalDebt', totalDebt);
        // managerTotalSalary do employees.js quản lý - cập nhật sau khi các big-value khác xong
        // Tính period từ endStr: nếu endStr kết thúc ngày 19 → period = tháng trước đó
        // VD: endStr=2026-07-19 → period=2026-06; endStr=2026-07-31 → period=2026-07
        if (typeof empUpdateManagerButton === 'function') {
            var _endDay = parseInt(endStr.slice(8, 10));
            var _endYear = parseInt(endStr.slice(0, 4));
            var _endMonth = parseInt(endStr.slice(5, 7));
            var _period;
            if (_endDay === 19) {
                // Period mode: period = tháng trước endStr
                if (_endMonth === 1) {
                    _period = (_endYear - 1) + '-12';
                } else {
                    _period = _endYear + '-' + String(_endMonth - 1).padStart(2, '0');
                }
            } else {
                // Month/Day mode: period = tháng của endStr
                _period = _endYear + '-' + String(_endMonth).padStart(2, '0');
            }
            empUpdateManagerButton(_period);
        }

        // Cập nhật Quỹ POS: đọc số dư từ responsibility_fund
        var shopId = (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : 'shop_default';
        var fundRef = firebase.database().ref(shopId + '/responsibility_fund/balance');
        fundRef.once('value', function(snapshot) {
            var balance = snapshot.val() || 0;
            _setBigValue('managerPosFund', balance);
        }).catch(function() {
            // Silent fail
        });
    }).catch(function(err) {
        console.error('updateManagerBigValues error:', err);
    });
}

window.updateManagerBigValues = updateManagerBigValues;

// ========== GẮN SỰ KIỆN CHO BỘ LỌC TAB QUẢN LÝ ==========
// Biến offset để điều hướng prev/next
window.managerPeriodOffset = 0;

function _initManagerFilters() {
    var prevBtn = document.getElementById('managerPeriodPrevBtn');
    var nextBtn = document.getElementById('managerPeriodNextBtn');
    var modeSelect = document.getElementById('managerViewModeSelect');

    if (prevBtn) {
        prevBtn.onclick = function() {
            window.managerPeriodOffset = (window.managerPeriodOffset || 0) - 1;
            if (typeof managerApplyFilter === 'function') managerApplyFilter();
        };
    }
    if (nextBtn) {
        nextBtn.onclick = function() {
            window.managerPeriodOffset = (window.managerPeriodOffset || 0) + 1;
            if (typeof managerApplyFilter === 'function') managerApplyFilter();
        };
    }
    if (modeSelect) {
        modeSelect.onchange = function() {
            window.managerPeriodOffset = 0; // Reset offset khi đổi mode
            if (typeof managerApplyFilter === 'function') managerApplyFilter();
        };
    }

    // Gắn sự kiện toggle cho tất cả .toggle-header trong tab quản lý
    var toggleHeaders = document.querySelectorAll('#managerView .toggle-header');
    for (var i = 0; i < toggleHeaders.length; i++) {
        toggleHeaders[i].onclick = function() {
            var card = this.parentNode;
            if (!card) return;
            card.classList.toggle('collapsed');
            var icon = this.querySelector('.toggle-icon');
            if (icon) {
                icon.textContent = card.classList.contains('collapsed') ? '▶' : '▼';
            }
        };
    }
}

// Tự động gắn khi DOM sẵn sàng
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initManagerFilters);
} else {
    _initManagerFilters();
}

// ========== MANAGER TAB: LỌC & HIỂN THỊ CHI PHÍ ==========
// Hàm này được gọi từ app.js switchTab và realtime.js khi có data thay đổi
function managerApplyFilter() {
    var container = document.getElementById('managerExpenseList');
    if (!container) return;

    // Lấy period từ select
    var modeSelect = document.getElementById('managerViewModeSelect');
    var mode = modeSelect ? modeSelect.value : 'period';

    // Tính date range với offset (prev/next)
    var offset = window.managerPeriodOffset || 0;
    var now = new Date();
    var startDate, endDate;

    if (mode === 'day') {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        endDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
    } else if (mode === 'month') {
        var m = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        startDate = new Date(m.getFullYear(), m.getMonth(), 1);
        endDate = new Date(m.getFullYear(), m.getMonth() + 1, 0, 23, 59, 59);
    } else {
        // period: 20/tháng trước -> 19/tháng này, với offset
        var periodDate = new Date(now.getFullYear(), now.getMonth() + offset, now.getDate());
        var day = periodDate.getDate();
        if (day >= 20) {
            startDate = new Date(periodDate.getFullYear(), periodDate.getMonth(), 20);
            endDate = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 19, 23, 59, 59);
        } else {
            startDate = new Date(periodDate.getFullYear(), periodDate.getMonth() - 1, 20);
            endDate = new Date(periodDate.getFullYear(), periodDate.getMonth(), 19, 23, 59, 59);
        }
    }

    // Đồng bộ EMP.currentPeriod với offset để nút nhân viên hiển thị đúng kỳ
    if (typeof EMP !== 'undefined' && EMP) {
        // Tính period từ offset: period = tháng N (tháng được trả lương)
        // Với period mode: nếu day >= 20, period = tháng hiện tại; nếu day < 20, period = tháng trước
        var periodMonth, periodYear;
        if (mode === 'period') {
            if (day >= 20) {
                periodMonth = periodDate.getMonth() + 1;
                periodYear = periodDate.getFullYear();
            } else {
                periodMonth = periodDate.getMonth(); // getMonth() là 0-based, tháng trước
                periodYear = periodDate.getFullYear();
                if (periodMonth < 1) { periodMonth = 12; periodYear--; }
            }
        } else if (mode === 'month') {
            var mDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
            periodMonth = mDate.getMonth() + 1;
            periodYear = mDate.getFullYear();
        } else {
            // day mode: period = tháng của ngày đó (theo logic 20)
            var dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
            if (dayDate.getDate() >= 20) {
                periodMonth = dayDate.getMonth() + 1;
                periodYear = dayDate.getFullYear();
            } else {
                periodMonth = dayDate.getMonth();
                periodYear = dayDate.getFullYear();
                if (periodMonth < 1) { periodMonth = 12; periodYear--; }
            }
        }
        EMP.currentPeriod = periodYear + '-' + String(periodMonth).padStart(2, '0');
    }

    // Tạo dateKey YYYY-MM-DD từ local date, không dùng toISOString (bị lệch múi giờ)
    function _toDateKey(d) {
        var y = d.getFullYear();
        var m = ('0' + (d.getMonth() + 1)).slice(-2);
        var day = ('0' + d.getDate()).slice(-2);
        return y + '-' + m + '-' + day;
    }
    var startStr = _toDateKey(startDate);
    var endStr = _toDateKey(endDate);

    // Cập nhật label cho tất cả option
    if (modeSelect) {
        var labelPeriod = 'Kỳ ' + formatDateDisplay(startStr) + ' → ' + formatDateDisplay(endStr);
        var labelMonth = 'Tháng ' + (now.getMonth() + 1) + '/' + now.getFullYear();
        var labelDay = 'Ngày ' + formatDateDisplay(startStr);
        modeSelect.options[0].innerText = labelPeriod;
        modeSelect.options[1].innerText = labelMonth;
        modeSelect.options[2].innerText = labelDay;
    }

    // Luôn load dữ liệu mới nhất từ DB trước khi render
    if (typeof loadExpenseData === 'function') {
        loadExpenseData().then(function() {
            _doRenderManagerFilter(startStr, endStr, container);
        });
    } else {
        _doRenderManagerFilter(startStr, endStr, container);
    }
}

function _doRenderManagerFilter(startStr, endStr, container) {
    // Dùng expenseData.transactions thay vì DB.getAll
    var allCosts = expenseData.transactions || [];
    var filtered = allCosts.filter(function(c) {
        return c.dateKey >= startStr && c.dateKey <= endStr && !c.deleted;
    });

    // Sắp xếp mới nhất lên đầu
    filtered.sort(function(a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
    });

    // Tính tổng theo loại
    var totalStaff = 0; // fundSource === 'pos_cash' (staff dùng Két POS)
    var totalManagement = 0; // fundSource === 'management'
    var totalIngredient = 0;
    var totalWaste = 0;

    for (var i = 0; i < filtered.length; i++) {
        var c = filtered[i];
        if (c.fundSource === 'pos_cash') totalStaff += c.amount;
        else totalManagement += c.amount;
        if (c.costType === 'ingredient') totalIngredient += c.amount;
        else totalWaste += c.amount;
    }

    // Render danh sách
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">📭 Không có chi phí trong kỳ</div>';
    } else {
        // Gom nhóm theo categoryName + fundSource
        var posGroups = {};   // fundSource === 'pos_cash'
        var qlGroups = {};    // fundSource === 'management'

        for (var j = 0; j < filtered.length; j++) {
            var tx = filtered[j];
            var key = tx.categoryName || 'Khác';
            // Phân loại rõ ràng: pos_cash vào POS, còn lại (kể cả undefined) vào QLTT
            var isPos = tx.fundSource === 'pos_cash';
            var group = isPos ? posGroups : qlGroups;
            if (!group[key]) {
                group[key] = { name: key, costType: tx.costType, total: 0, count: 0, items: [] };
            }
            group[key].total += tx.amount;
            group[key].count++;
            group[key].items.push(tx);
        }

        // Chuyển groups thành mảng và sắp xếp theo tổng giảm dần
        function _sortGroups(g) {
            var arr = [];
            for (var k in g) { if (g.hasOwnProperty(k)) arr.push(g[k]); }
            arr.sort(function(a, b) { return b.total - a.total; });
            return arr;
        }
        var posArr = _sortGroups(posGroups);
        var qlArr = _sortGroups(qlGroups);

        var html = '<div class="cost-summary" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
            '<span style="font-size:13px;background:#fff7ed;padding:6px 12px;border-radius:40px;">🧂 NL: ' + formatMoney(totalIngredient) + '</span>' +
            '<span style="font-size:13px;background:#f0fdf4;padding:6px 12px;border-radius:40px;">📦 HP: ' + formatMoney(totalWaste) + '</span>' +
            '<span style="font-size:13px;background:#fffbeb;padding:6px 12px;border-radius:40px;">🏦 POS: ' + formatMoney(totalStaff) + '</span>' +
            '<span style="font-size:13px;background:#f0f9ff;padding:6px 12px;border-radius:40px;">👔 QL: ' + formatMoney(totalManagement) + '</span>' +
        '</div>';

        // === CHI PHÍ POS ===
        if (posArr.length > 0) {
            var posTotal = 0;
            for (var pi = 0; pi < posArr.length; pi++) { posTotal += posArr[pi].total; }
            html += '<div style="margin-bottom:12px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700;color:#92400e;padding:8px 0;border-bottom:2px solid #fde68a;">' +
                '<span>🏦 Chi phí Két POS</span>' +
                '<span>' + formatMoney(posTotal) + '</span>' +
            '</div>';
            for (var pj = 0; pj < posArr.length; pj++) {
                var g = posArr[pj];
                var typeIcon = g.costType === 'ingredient' ? '🧂' : '📦';
                html += '<div class="cost-item" style="cursor:pointer;" onclick="_showCostHistory(\'' + encodeURIComponent(g.name) + '\',\'' + startStr + '\',\'' + endStr + '\')">' +
                    '<div style="flex:1;">' +
                        '<div>' + typeIcon + ' <strong>' + escapeHtml(g.name) + '</strong> <span style="font-size:11px;color:#94a3b8;">(' + g.count + ' giao dịch)</span></div>' +
                    '</div>' +
                    '<div style="font-weight:600;text-align:right;color:#92400e;">' + formatMoney(g.total) + '</div>' +
                '</div>';
            }
            html += '</div>';
        }

        // === CHI PHÍ QLTT ===
        if (qlArr.length > 0) {
            var qlTotal = 0;
            for (var qi = 0; qi < qlArr.length; qi++) { qlTotal += qlArr[qi].total; }
            html += '<div style="margin-bottom:12px;">';
            html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:14px;font-weight:700;color:#1e40af;padding:8px 0;border-bottom:2px solid #bfdbfe;">' +
                '<span>👔 Chi phí Quản lý thanh toán</span>' +
                '<span>' + formatMoney(qlTotal) + '</span>' +
            '</div>';
            for (var qj = 0; qj < qlArr.length; qj++) {
                var g2 = qlArr[qj];
                var typeIcon2 = g2.costType === 'ingredient' ? '🧂' : '📦';
                html += '<div class="cost-item" style="cursor:pointer;" onclick="_showCostHistory(\'' + encodeURIComponent(g2.name) + '\',\'' + startStr + '\',\'' + endStr + '\')">' +
                    '<div style="flex:1;">' +
                        '<div>' + typeIcon2 + ' <strong>' + escapeHtml(g2.name) + '</strong> <span style="font-size:11px;color:#94a3b8;">(' + g2.count + ' giao dịch)</span></div>' +
                    '</div>' +
                    '<div style="font-weight:600;text-align:right;color:#1e40af;">' + formatMoney(g2.total) + '</div>' +
                '</div>';
            }
            html += '</div>';
        }

        var grandTotal = totalStaff + totalManagement;
        html += '<div class="cost-total" style="margin-top:8px;">Tổng: ' + formatMoney(grandTotal) + '</div>';
        container.innerHTML = html;
    }

    // Cập nhật tất cả big-value
    if (typeof updateManagerBigValues === 'function') {
        updateManagerBigValues(startStr, endStr);
    }

    // Thống kê đồ uống
    if (typeof renderDrinkStats === 'function') {
        renderDrinkStats(startStr, endStr);
    }

    // Thống kê nguyên liệu
    if (typeof renderIngredientStats === 'function') {
        renderIngredientStats(startStr, endStr);
    }

    // Cảnh báo tồn kho thấp
    if (typeof renderLowStockAlert === 'function') {
        renderLowStockAlert();
    }

    // Công nợ khách hàng
    if (typeof renderDebtList === 'function') {
        renderDebtList(startStr, endStr);
    }
}

// ========== MANAGER TAB: LỊCH SỬ MUA SẮM CHI PHÍ ==========
// Hiển thị modal lịch sử mua sắm của một nguyên liệu/hao phí
function _showCostHistory(encodedName, startStr, endStr) {
    var categoryName = decodeURIComponent(encodedName);
    // Load dữ liệu mới nhất từ DB để đảm bảo đầy đủ
    loadExpenseData().then(function() {
        var allCosts = expenseData.transactions || [];
        // Lọc giao dịch của categoryName này trong khoảng thời gian
        var items = allCosts.filter(function(c) {
            return c.categoryName === categoryName && c.dateKey >= startStr && c.dateKey <= endStr && !c.deleted;
        });
        if (items.length === 0) return;

        // Tính tổng
        var total = 0;
        for (var i = 0; i < items.length; i++) { total += items[i].amount; }

        // Gom theo ngày
        var dayMap = {};
        for (var j = 0; j < items.length; j++) {
            var tx = items[j];
            var dk = tx.dateKey || '';
            if (!dayMap[dk]) dayMap[dk] = { dateKey: dk, items: [] };
            dayMap[dk].items.push(tx);
        }

        // Sắp xếp ngày mới nhất lên đầu
        var dayKeys = Object.keys(dayMap).sort().reverse();

        var typeIcon = items[0].costType === 'ingredient' ? '🧂' : '📦';

        var html = '<div style="padding:4px 0;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<span style="font-size:16px;font-weight:700;">' + typeIcon + ' ' + escapeHtml(categoryName) + '</span>' +
            '<span style="font-size:13px;color:#64748b;">Tổng: <strong>' + formatMoney(total) + '</strong> (' + items.length + ' giao dịch)</span>' +
        '</div>';

        for (var di = 0; di < dayKeys.length; di++) {
            var dk = dayKeys[di];
            var dayData = dayMap[dk];

            // Chi tiết từng giao dịch trong ngày - date + transaction trên cùng 1 dòng
            for (var ti = 0; ti < dayData.items.length; ti++) {
                var t = dayData.items[ti];
                var fundIcon = t.fundSource === 'pos_cash' ? '🏦' : '👔';
                var timeStr = '';
                if (t.date) {
                    try {
                        var dd = new Date(t.date);
                        timeStr = dd.getHours().toString().padStart(2, '0') + ':' + dd.getMinutes().toString().padStart(2, '0');
                    } catch(e) {}
                }
                html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:4px 0;border-bottom:1px solid #e2e8f0;">' +
                    '<span style="white-space:nowrap;">' + formatDateDisplay(dk) + '  ' + fundIcon + ' ' + timeStr + '</span>' +
                    '<span style="font-weight:500;white-space:nowrap;">' + formatMoney(t.amount) + '</span>' +
                '</div>';
            }
        }
        html += '</div>';

        // Hiển thị trong modal bottom sheet
        var modal = document.getElementById('managerDetailModal');
        if (!modal) {
            // Tạo modal nếu chưa có
            modal = document.createElement('div');
            modal.id = 'managerDetailModal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content" style="max-width:500px;">' +
                '<div class="modal-header"><h3>📋 Lịch sử mua sắm</h3><span class="modal-close" onclick="closeModal(\'managerDetailModal\')">&times;</span></div>' +
                '<div class="modal-body" id="managerDetailModalBody"></div></div>';
            document.body.appendChild(modal);
        }
        document.getElementById('managerDetailModalBody').innerHTML = html;
        openBottomSheet('managerDetailModal');
    });
}

// ========== MANAGER TAB: THỐNG KÊ ĐỒ UỐNG ==========
function renderDrinkStats(startStr, endStr) {
    var container = document.getElementById('managerDrinkStats');
    if (!container) return;

    DB.getTransactionsByDateRange(startStr, endStr).then(function(transactions) {
        var validTx = transactions.filter(function(t) { return !t.refunded; });

        // Đếm đồ uống theo tên
        var drinkMap = {};
        for (var i = 0; i < validTx.length; i++) {
            var tx = validTx[i];
            if (tx.items && tx.items.length) {
                for (var j = 0; j < tx.items.length; j++) {
                    var item = tx.items[j];
                    var name = item.name || 'Không tên';
                    if (!drinkMap[name]) {
                        drinkMap[name] = { qty: 0, revenue: 0 };
                    }
                    drinkMap[name].qty += item.qty || 0;
                    drinkMap[name].revenue += (item.price || 0) * (item.qty || 0);
                }
            }
        }

        // Chuyển sang mảng và sắp xếp theo số lượng giảm dần
        var sorted = [];
        for (var key in drinkMap) {
            if (drinkMap.hasOwnProperty(key)) {
                sorted.push({ name: key, qty: drinkMap[key].qty, revenue: drinkMap[key].revenue });
            }
        }
        sorted.sort(function(a, b) { return b.qty - a.qty; });

        // Render
        if (sorted.length === 0) {
            container.innerHTML = '<div class="empty-state">📭 Không có dữ liệu đồ uống trong kỳ</div>';
            return;
        }

        var showAll = container.getAttribute('data-show-all') === 'true';
        var maxShow = 10;
        var totalQty = 0;
        var totalRevenue = 0;
        for (var k = 0; k < sorted.length; k++) {
            totalQty += sorted[k].qty;
            totalRevenue += sorted[k].revenue;
        }

        var html = '<div class="drink-stats-wrap" style="font-size:13px;">';

        // Tổng quan
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
            '<span style="background:#f0fdf4;padding:4px 10px;border-radius:40px;font-size:12px;">☕ Tổng món: ' + sorted.length + '</span>' +
            '<span style="background:#f0f9ff;padding:4px 10px;border-radius:40px;font-size:12px;">📦 Tổng SL: ' + totalQty + '</span>' +
            '<span style="background:#fffbeb;padding:4px 10px;border-radius:40px;font-size:12px;">💰 Tổng DT: ' + formatMoney(totalRevenue) + '</span>' +
        '</div>';

        // Header bảng
        html += '<div style="display:flex;padding:8px 0;border-bottom:2px solid var(--border,#e2e8f0);font-weight:700;color:#475569;">' +
            '<span style="flex:1;">Đồ uống</span>' +
            '<span style="width:50px;text-align:center;">SL</span>' +
            '<span style="width:90px;text-align:right;">Doanh thu</span>' +
        '</div>';

        // Danh sách
        for (var n = 0; n < sorted.length; n++) {
            if (!showAll && n >= maxShow) break;
            var d = sorted[n];
            html += '<div style="display:flex;padding:6px 0;border-bottom:1px solid #f1f5f9;align-items:center;">' +
                '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escapeHtml(d.name) + '</span>' +
                '<span style="width:50px;text-align:center;font-weight:600;">' + d.qty + '</span>' +
                '<span style="width:90px;text-align:right;">' + formatMoney(d.revenue) + '</span>' +
            '</div>';
        }

        // Nút mở rộng
        if (sorted.length > maxShow) {
            var remaining = sorted.length - maxShow;
            html += '<div style="text-align:center;padding:8px 0;">' +
                '<button class="filter-btn" onclick="toggleDrinkStatsExpand()" style="font-size:12px;padding:6px 16px;">' +
                (showAll ? '▲ Thu gọn' : '▼ Xem thêm ' + remaining + ' món') +
                '</button></div>';
        }

        html += '</div>';
        container.innerHTML = html;
    }).catch(function(err) {
        container.innerHTML = '<div class="empty-state">❌ Lỗi tải dữ liệu</div>';
    });
}

// ========== MANAGER TAB: THỐNG KÊ NGUYÊN LIỆU ==========
// Hiển thị số lượng nguyên liệu đã sử dụng trong kỳ, kèm quy đổi và ước tính tiền
// Tính từ transactions (đơn bán) kết hợp recipe ingredients trong menuItems
// Logic GIỐNG HỆT showIngredientUsage() trong inventory-manager.js để đảm bảo chính xác 100%
function renderIngredientStats(startStr, endStr) {
    var container = document.getElementById('managerIngredientStats');
    if (!container) return;

    // Lấy danh sách nguyên liệu từ cache để có thông tin unit, conversion
    var ingList = window.ingredients;
    var getIngredient = function(id) {
        if (!ingList || !ingList.length) return null;
        for (var idx = 0; idx < ingList.length; idx++) {
            if (ingList[idx].id === id && !ingList[idx].deleted) return ingList[idx];
        }
        return null;
    };

    // Build menuItems lookup
    var menuItems = window.menuItems || [];

    // Query transactions (đơn bán) + cost_transactions để tính đơn giá
    // Dùng DB.getAll('transactions') giống showIngredientUsage để đảm bảo đủ dữ liệu
    Promise.all([
        DB.getAll('transactions'),
        DB.getAll('cost_transactions')
    ]).then(function(results) {
        var allTx = results[0] || [];
        var allCosts = results[1] || [];

        // Lọc transactions trong kỳ, đã thanh toán, không refund
        var validTx = allTx.filter(function(t) {
            return !t.refunded && t.items && t.items.length && t.dateKey >= startStr && t.dateKey <= endStr;
        });

        if (!validTx.length) {
            container.innerHTML = '<div class="empty-state">📭 Không có đơn bán trong kỳ</div>';
            return;
        }

        // ---- Bước 1: Build relatedMenuIds/relatedMenuNames cho TỪNG ingredient ----
        // Giống hệt showIngredientUsage (lines 1807-1833): scan ALL menu items và variants
        // để tìm những menu items nào có chứa ingredient nào
        var ingRelatedMap = {}; // ingId -> { menuIds: {}, menuNames: {} }
        for (var miIdx = 0; miIdx < menuItems.length; miIdx++) {
            var mi = menuItems[miIdx];
            // Check global ingredients
            if (mi.ingredients && mi.ingredients.length > 0) {
                for (var j = 0; j < mi.ingredients.length; j++) {
                    var ingId = mi.ingredients[j].ingredientId || 'unknown';
                    if (!ingRelatedMap[ingId]) ingRelatedMap[ingId] = { menuIds: {}, menuNames: {} };
                    ingRelatedMap[ingId].menuIds[mi.id] = true;
                    ingRelatedMap[ingId].menuNames[mi.id] = mi.name;
                }
            }
            // Check per-variant ingredients
            var variantData = (mi.variants && mi.variants.length > 0) ? mi.variants : (mi.sizes || []);
            for (var vi = 0; vi < variantData.length; vi++) {
                var vIngs = variantData[vi].ingredients || [];
                for (var j = 0; j < vIngs.length; j++) {
                    var ingId = vIngs[j].ingredientId || 'unknown';
                    if (!ingRelatedMap[ingId]) ingRelatedMap[ingId] = { menuIds: {}, menuNames: {} };
                    ingRelatedMap[ingId].menuIds[mi.id] = true;
                    ingRelatedMap[ingId].menuNames[mi.id] = mi.name;
                }
            }
        }

        // ---- Bước 2: Duyệt transactions, match items với relatedMenuIds ----
        // Giống hệt showIngredientUsage (lines 2127-2204):
        // Với mỗi orderItem, check xem nó có liên quan đến ingredient nào không
        // bằng cách: orderItem.id === mid || relatedMenuNames[mid] === baseName
        var ingMap = {};
        for (var ti = 0; ti < validTx.length; ti++) {
            var tx = validTx[ti];
            var items = tx.items || [];
            for (var ii = 0; ii < items.length; ii++) {
                var orderItem = items[ii];
                var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();

                // Với mỗi ingredient, kiểm tra xem orderItem có liên quan không
                for (var ingId in ingRelatedMap) {
                    if (!ingRelatedMap.hasOwnProperty(ingId)) continue;
                    var rel = ingRelatedMap[ingId];
                    var isRelated = false;
                    for (var mid in rel.menuIds) {
                        if (rel.menuIds.hasOwnProperty(mid)) {
                            if (orderItem.id === mid || rel.menuNames[mid] === baseName) {
                                isRelated = true;
                                break;
                            }
                        }
                    }
                    if (!isRelated) continue;

                    // Tìm recipe quantity cho ingredient này trong menu item match
                    // (giống showIngredientUsage lines 2152-2178)
                    var recipeQty = 0;
                    for (var k = 0; k < menuItems.length; k++) {
                        if (menuItems[k].id === orderItem.id || menuItems[k].name === baseName) {
                            // Check global ingredients
                            if (menuItems[k].ingredients) {
                                for (var l = 0; l < menuItems[k].ingredients.length; l++) {
                                    if (String(menuItems[k].ingredients[l].ingredientId) === String(ingId)) {
                                        recipeQty = menuItems[k].ingredients[l].quantity || 0;
                                        break;
                                    }
                                }
                            }
                            // If not found in global, check per-variant ingredients
                            if (recipeQty === 0) {
                                var variantData = (menuItems[k].variants && menuItems[k].variants.length > 0) ? menuItems[k].variants : (menuItems[k].sizes || []);
                                for (var vi = 0; vi < variantData.length; vi++) {
                                    var vIngs = variantData[vi].ingredients || [];
                                    for (var l = 0; l < vIngs.length; l++) {
                                        if (String(vIngs[l].ingredientId) === String(ingId)) {
                                            recipeQty = vIngs[l].quantity || 0;
                                            break;
                                        }
                                    }
                                    if (recipeQty > 0) break;
                                }
                            }
                            break;
                        }
                    }
                    if (recipeQty <= 0) continue;

                    var qtyUsed = recipeQty * (orderItem.qty || 1);
                    var ingInfo = getIngredient(ingId);

                    if (!ingMap[ingId]) {
                        ingMap[ingId] = {
                            id: ingId,
                            name: (ingInfo && ingInfo.name) || 'Không tên',
                            totalQty: 0,
                            count: 0
                        };
                    }
                    ingMap[ingId].totalQty += qtyUsed;
                    ingMap[ingId].count += (orderItem.qty || 1);
                }
            }
        }

        // ---- Bước 3: Thêm tất cả nguyên liệu chưa được dùng (totalQty = 0) ----
        // Đảm bảo hiển thị ĐẦY ĐỦ tất cả nguyên liệu, kể cả nguyên liệu không được dùng trong kỳ
        if (ingList && ingList.length) {
            for (var ingIdx = 0; ingIdx < ingList.length; ingIdx++) {
                var ingItem = ingList[ingIdx];
                if (ingItem.deleted) continue;
                if (!ingMap[ingItem.id]) {
                    ingMap[ingItem.id] = {
                        id: ingItem.id,
                        name: ingItem.name || 'Không tên',
                        totalQty: 0,
                        count: 0
                    };
                }
            }
        }

        // Chuyển sang mảng và sắp xếp theo số lượng giảm dần
        var sorted = [];
        for (var key in ingMap) {
            if (ingMap.hasOwnProperty(key)) {
                sorted.push(ingMap[key]);
            }
        }
        sorted.sort(function(a, b) { return b.totalQty - a.totalQty; });

        if (sorted.length === 0) {
            container.innerHTML = '<div class="empty-state">📭 Không có nguyên liệu nào</div>';
            return;
        }

        // ---- Tính đơn giá ước tính từ cost_transactions ----
        var costIngMap = {};
        if (allCosts && allCosts.length) {
            for (var ci = 0; ci < allCosts.length; ci++) {
                var ct = allCosts[ci];
                if (ct.costType === 'ingredient' && ct.ingredientId && ct.ingredientUnitPrice && !ct.deleted) {
                    var cid = String(ct.ingredientId);
                    if (!costIngMap[cid] || ct.createdAt > costIngMap[cid].createdAt) {
                        costIngMap[cid] = {
                            unitPrice: ct.ingredientUnitPrice,
                            createdAt: ct.createdAt
                        };
                    }
                }
            }
        }

        // Gán đơn giá và tính thành tiền
        // LƯU Ý: ingredientUnitPrice trong cost_transactions là đơn giá theo đơn vị nhập kho
        // (VD: nhập 1 Thùng = 12.000ml giá 120.000đ → unitPrice = 120.000đ/Thùng)
        // totalQty là số lượng đã dùng theo baseUnit (VD: 5840 ml)
        // Cần quy đổi totalQty về đơn vị nhập kho trước khi nhân
        var grandCost = 0;
        var hasCost = false;
        for (var si = 0; si < sorted.length; si++) {
            var ing = sorted[si];
            var priceInfo = costIngMap[ing.id];
            if (priceInfo && priceInfo.unitPrice) {
                ing.unitPrice = priceInfo.unitPrice;
                // Lấy thông tin ingredient để biết conversion rate
                var ingInfo = getIngredient(ing.id);
                var convRate = parseFloat(ingInfo && ingInfo.conversionRate) || 0;
                var convTo = (ingInfo && ingInfo.conversionTo) || '';
                var hasConv = convRate > 0 && convTo;
                
                // Nếu có conversion, unitPrice là giá theo đơn vị convTo (VD: Thùng)
                // totalQty là theo baseUnit (VD: ml), cần chia cho convRate
                var qtyForCost = hasConv ? (ing.totalQty / convRate) : ing.totalQty;
                ing.estimatedCost = Math.round(qtyForCost * priceInfo.unitPrice);
                grandCost += ing.estimatedCost;
                hasCost = true;
            } else {
                ing.unitPrice = 0;
                ing.estimatedCost = 0;
            }
        }

        var showAll = container.getAttribute('data-show-all') === 'true';
        var maxShow = 10;

        // Tính tổng số lượng
        var grandQty = 0;
        for (var k = 0; k < sorted.length; k++) {
            grandQty += sorted[k].totalQty;
        }

        // Đếm số nguyên liệu có sử dụng (totalQty > 0) và không sử dụng
        var usedCount = 0;
        var unusedCount = 0;
        for (var si = 0; si < sorted.length; si++) {
            if (sorted[si].totalQty > 0) usedCount++;
            else unusedCount++;
        }

        var html = '<div class="ingredient-stats-wrap" style="font-size:13px;">';

        // Tổng quan
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
            '<span style="background:#f0fdf4;padding:4px 10px;border-radius:40px;font-size:12px;">🧂 Tổng nguyên liệu: ' + sorted.length + '</span>' +
            '<span style="background:#f0f9ff;padding:4px 10px;border-radius:40px;font-size:12px;">📦 Đã dùng: ' + Math.round(grandQty * 100) / 100 + '</span>';
        if (unusedCount > 0) {
            html += '<span style="background:#fefce8;padding:4px 10px;border-radius:40px;font-size:12px;">⏸️ Chưa dùng: ' + unusedCount + ' nguyên liệu</span>';
        }
        if (hasCost) {
            html += '<span style="background:#fef2f2;padding:4px 10px;border-radius:40px;font-size:12px;font-weight:600;">💰 Tổng tiền NL: ' + formatMoney(grandCost) + '</span>';
        }
        html += '</div>';

        // Header bảng
        html += '<div style="display:flex;padding:8px 0;border-bottom:2px solid var(--border,#e2e8f0);font-weight:700;color:#475569;">' +
            '<span style="flex:1;">Nguyên liệu</span>' +
            '<span style="width:100px;text-align:center;">Đã dùng</span>' +
            '<span style="width:60px;text-align:center;">SL</span>';
        if (hasCost) {
            html += '<span style="width:90px;text-align:right;">Thành tiền</span>';
        }
        html += '</div>';

        // Danh sách
        for (var n = 0; n < sorted.length; n++) {
            if (!showAll && n >= maxShow) break;
            var ing = sorted[n];

            // Lấy thông tin quy đổi từ ingredients cache
            var ingInfo = getIngredient(ing.id);
            var qtyVal = Math.round(ing.totalQty * 100) / 100;
            var qtyDisplay = '' + qtyVal;

            // Xác định displayUnit GIỐNG showIngredientUsage (line 1843):
            // Nếu có conversion, displayUnit = convTo (vd: "g"), nếu không thì = baseUnit (vd: "kg")
            if (ingInfo) {
                var baseUnit = ingInfo.unit || '';
                var convRate = parseFloat(ingInfo.conversionRate) || 0;
                var convTo = ingInfo.conversionTo || '';
                var hasConv = convRate > 0 && convTo;
                var displayUnit = hasConv ? convTo : baseUnit;

                // Hiển thị: số lượng + displayUnit (GIỐNG showIngredientUsage line 2214)
                qtyDisplay = qtyVal + ' ' + escapeHtml(displayUnit);

                // Nếu có conversion, hiển thị thêm baseUnit trong ngoặc (vd: "450 g (~0.45 kg)")
                if (hasConv) {
                    var baseQty = qtyVal / convRate;
                    var baseDisplay = Math.round(baseQty * 100) / 100;
                    qtyDisplay += ' <span style="font-size:11px;color:#64748b;">(~' + baseDisplay + ' ' + escapeHtml(baseUnit) + ')</span>';
                }
            }

            html += '<div style="display:flex;padding:6px 0;border-bottom:1px solid #f1f5f9;align-items:center;">' +
                '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">🧂 ' + escapeHtml(ing.name) + '</span>' +
                '<span style="width:100px;text-align:center;font-weight:600;">' + qtyDisplay + '</span>' +
                '<span style="width:60px;text-align:center;color:#94a3b8;">' + ing.count + ' lần</span>';
            if (hasCost) {
                var costStr = ing.estimatedCost > 0 ? formatMoney(ing.estimatedCost) : '<span style="color:#94a3b8;">—</span>';
                html += '<span style="width:90px;text-align:right;font-weight:600;color:' + (ing.estimatedCost > 0 ? '#dc2626' : '#94a3b8') + ';">' + costStr + '</span>';
            }
            html += '</div>';
        }

        // Nút mở rộng
        if (sorted.length > maxShow) {
            var remaining = sorted.length - maxShow;
            html += '<div style="text-align:center;padding:8px 0;">' +
                '<button class="filter-btn" onclick="toggleIngredientStatsExpand()" style="font-size:12px;padding:6px 16px;">' +
                (showAll ? '▲ Thu gọn' : '▼ Xem thêm ' + remaining + ' nguyên liệu') +
                '</button></div>';
        }

        html += '</div>';
        container.innerHTML = html;
    }).catch(function(err) {
        console.error('renderIngredientStats error:', err);
        container.innerHTML = '<div class="empty-state">❌ Lỗi tải dữ liệu</div>';
    });
}

function toggleIngredientStatsExpand() {
    var container = document.getElementById('managerIngredientStats');
    if (!container) return;
    var showAll = container.getAttribute('data-show-all') === 'true';
    container.setAttribute('data-show-all', showAll ? 'false' : 'true');
    if (typeof managerApplyFilter === 'function') managerApplyFilter();
}

function toggleDrinkStatsExpand() {
    var container = document.getElementById('managerDrinkStats');
    if (!container) return;
    var showAll = container.getAttribute('data-show-all') === 'true';
    container.setAttribute('data-show-all', showAll ? 'false' : 'true');
    // Gọi lại managerApplyFilter để re-render với cùng date range
    if (typeof managerApplyFilter === 'function') managerApplyFilter();
}

// ========== MANAGER TAB: CẢNH BÁO TỒN KHO THẤP ==========
function renderLowStockAlert() {
    var container = document.getElementById('managerLowStockAlert');
    if (!container) return;

    // Luôn load ingredients từ DB để đảm bảo tồn kho mới nhất
    if (typeof DB !== 'undefined' && DB.getAll) {
        DB.getAll('ingredients').then(function(dbList) {
            window.ingredients = dbList;
            _doRenderLowStock(dbList, container);
        }).catch(function() {
            container.innerHTML = '<div class="empty-state">📭 Không có nguyên liệu</div>';
        });
    } else {
        // Fallback: dùng cache nếu DB không available
        var list = window.ingredients;
        if (list && list.length > 0) {
            _doRenderLowStock(list, container);
        } else {
            container.innerHTML = '<div class="empty-state">📭 Không có nguyên liệu</div>';
        }
    }
}

// Biến tracking để tránh gửi Telegram trùng lặp
var _lastLowStockAlert = 0; // timestamp lần gửi gần nhất
var _lastLowStockItems = ''; // JSON string của danh sách để so sánh

function _doRenderLowStock(ingredients, container) {
    // Lọc nguyên liệu tồn kho thấp (dùng minStock, giống inventory-manager.js)
    var lowItems = [];
    for (var i = 0; i < ingredients.length; i++) {
        var ing = ingredients[i];
        if (ing.deleted) continue;
        var stock = parseFloat(ing.stock) || 0;
        var minStock = parseFloat(ing.minStock) || 0;
        // Chỉ cảnh báo nếu có minStock > 0 và stock <= minStock
        if (minStock > 0 && stock <= minStock) {
            lowItems.push(ing);
        }
    }

    if (lowItems.length === 0) {
        container.innerHTML = '<div class="empty-state" style="color:#16a34a;">✅ Tất cả nguyên liệu đều đủ tồn kho</div>';
        return;
    }

    var html = '<div style="font-size:13px;">';
    html += '<div style="display:flex;padding:8px 0;border-bottom:2px solid #fecaca;font-weight:700;color:#991b1b;">' +
        '<span style="flex:1;">Nguyên liệu</span>' +
        '<span style="width:70px;text-align:center;">Tồn kho</span>' +
        '<span style="width:60px;text-align:center;">Tối thiểu</span>' +
    '</div>';

    for (var j = 0; j < lowItems.length; j++) {
        var item = lowItems[j];
        var stockVal = Math.round((parseFloat(item.stock) || 0) * 10) / 10;
        var minVal = parseFloat(item.minStock) || 0;
        var unit = item.unit || '';

        // Hiển thị số lượng đã quy đổi nếu có (giống inventory-manager.js)
        var displayUnit = unit;
        var displayStock = '' + stockVal;
        if (item.conversionFrom && item.conversionTo && item.conversionRate) {
            var rate = parseFloat(item.conversionRate) || 1;
            var convertedStock = stockVal * rate;
            // Làm tròn xuống nếu đơn vị quy đổi là loại đếm được (chai, cái, túi...)
            var convertedDisplay = Math.floor(convertedStock);
            if (convertedDisplay < 1) convertedDisplay = Math.round(convertedStock * 10) / 10; // <1 thì hiển thị thập phân
            displayStock = stockVal + ' ' + escapeHtml(unit) + ' <span style="font-size:11px;color:#64748b;">(~' + convertedDisplay + ' ' + escapeHtml(item.conversionTo) + ')</span>';
        } else {
            displayStock = stockVal + ' ' + escapeHtml(unit);
        }

        html += '<div style="display:flex;padding:6px 0;border-bottom:1px solid #fee2e2;align-items:center;">' +
            '<span style="flex:1;">⚠️ ' + escapeHtml(item.name) + '</span>' +
            '<span style="width:100px;text-align:center;font-weight:600;color:#dc2626;">' + displayStock + '</span>' +
            '<span style="width:60px;text-align:center;color:#94a3b8;">' + minVal + ' ' + escapeHtml(unit) + '</span>' +
        '</div>';
    }

    html += '<div style="text-align:right;padding:6px 0;font-size:11px;color:#94a3b8;">Tổng: ' + lowItems.length + ' nguyên liệu tồn thấp</div>';
    html += '</div>';
    container.innerHTML = html;

    // Gửi Telegram cảnh báo (tối đa 1 lần / 30 phút, hoặc khi danh sách thay đổi)
    _sendLowStockTelegram(lowItems);
}

function _sendLowStockTelegram(lowItems) {
    if (!lowItems || lowItems.length === 0) return;
    if (typeof window.notifyTelegramWarning !== 'function') return;

    var now = Date.now();
    var currentJson = JSON.stringify(lowItems.map(function(i) { return i.id + ':' + (parseFloat(i.stock) || 0); }));

    // Gửi nếu: chưa gửi lần nào, hoặc đã qua 30 phút, hoặc danh sách thay đổi
    var THIRTY_MIN = 30 * 60 * 1000;
    if (_lastLowStockAlert > 0 && (now - _lastLowStockAlert) < THIRTY_MIN && currentJson === _lastLowStockItems) {
        return; // Trùng lặp trong 30 phút, bỏ qua
    }

    _lastLowStockAlert = now;
    _lastLowStockItems = currentJson;

    var lines = ['⚠️ <b>CẢNH BÁO TỒN KHO THẤP</b>'];
    for (var i = 0; i < lowItems.length; i++) {
        var item = lowItems[i];
        var stockVal = Math.round((parseFloat(item.stock) || 0) * 10) / 10;
        var minVal = parseFloat(item.minStock) || 0;
        var unit = item.unit || '';
        lines.push('• ' + escapeHtml(item.name) + ': ' + stockVal + '/' + minVal + ' ' + escapeHtml(unit));
    }
    lines.push('📅 ' + new Date().toLocaleString('vi-VN'));

    window.notifyTelegramWarning(lines.join('\n'));
}

// ========== MANAGER TAB: CÔNG NỢ KHÁCH HÀNG ==========
// Hiển thị danh sách khách nợ + lịch sử thanh toán trong kỳ
function renderDebtList(startStr, endStr) {
    var container = document.getElementById('managerDebtList');
    if (!container) return;

    DB.getAll('customers').then(function(allCustomers) {
        // Lọc khách có nợ > 0
        var debtCustomers = allCustomers.filter(function(c) { return (c.totalDebt || 0) > 0; });

        if (debtCustomers.length === 0) {
            container.innerHTML = '<div class="empty-state">✅ Không có khách nợ</div>';
            return;
        }

        // Sắp xếp theo tổng nợ giảm dần
        debtCustomers.sort(function(a, b) { return (b.totalDebt || 0) - (a.totalDebt || 0); });

        var html = '';
        for (var i = 0; i < debtCustomers.length; i++) {
            var c = debtCustomers[i];
            var debt = c.totalDebt || 0;

            // Đếm số lần thanh toán nợ trong kỳ
            var paymentCount = 0;
            var paymentTotal = 0;
            if (c.paymentHistory && c.paymentHistory.length) {
                for (var p = 0; p < c.paymentHistory.length; p++) {
                    var ph = c.paymentHistory[p];
                    var phDate = ph.date ? ph.date.slice(0, 10) : '';
                    if (phDate >= startStr && phDate <= endStr) {
                        paymentCount++;
                        paymentTotal += ph.amount || 0;
                    }
                }
            }

            html += '<div class="debt-customer-item" style="cursor:pointer;" onclick="_showDebtPaymentHistory(\'' + encodeURIComponent(c.id) + '\',\'' + encodeURIComponent(c.name || '') + '\',\'' + startStr + '\',\'' + endStr + '\')">' +
                '<div style="flex:1;">' +
                    '<div><strong>' + escapeHtml(c.name || 'Khách ' + c.id) + '</strong>' +
                    (c.phone ? ' <span style="font-size:11px;color:#94a3b8;">📞 ' + escapeHtml(c.phone) + '</span>' : '') +
                    '</div>' +
                    (paymentCount > 0 ? '<div style="font-size:11px;color:#64748b;margin-top:2px;">💵 ' + paymentCount + ' lần thanh toán (' + formatMoney(paymentTotal) + ')</div>' : '') +
                '</div>' +
                '<div style="font-weight:600;text-align:right;color:#dc2626;">' + formatMoney(debt) + '</div>' +
            '</div>';
        }

        container.innerHTML = html;
    });
}

// Hiển thị modal lịch sử thanh toán nợ của một khách hàng
function _showDebtPaymentHistory(encodedId, encodedName, startStr, endStr) {
    var customerId = decodeURIComponent(encodedId);
    var customerName = decodeURIComponent(encodedName);

    DB.getAll('customers').then(function(allCustomers) {
        var customer = null;
        for (var i = 0; i < allCustomers.length; i++) {
            if (allCustomers[i].id === customerId) {
                customer = allCustomers[i];
                break;
            }
        }
        if (!customer) return;

        // Lấy lịch sử nợ (debtHistory) và thanh toán (paymentHistory) trong kỳ
        var debtItems = [];
        if (customer.debtHistory && customer.debtHistory.length) {
            for (var d = 0; d < customer.debtHistory.length; d++) {
                var dh = customer.debtHistory[d];
                var dhDate = dh.date ? dh.date.slice(0, 10) : '';
                if (dhDate >= startStr && dhDate <= endStr) {
                    debtItems.push({
                        type: 'debt',
                        date: dh.date,
                        amount: dh.amount || 0,
                        note: dh.note || ''
                    });
                }
            }
        }
        if (customer.paymentHistory && customer.paymentHistory.length) {
            for (var p = 0; p < customer.paymentHistory.length; p++) {
                var ph = customer.paymentHistory[p];
                var phDate = ph.date ? ph.date.slice(0, 10) : '';
                if (phDate >= startStr && phDate <= endStr) {
                    debtItems.push({
                        type: 'payment',
                        date: ph.date,
                        amount: ph.amount || 0,
                        method: ph.method || '',
                        note: ph.note || ''
                    });
                }
            }
        }

        // Sắp xếp theo ngày mới nhất
        debtItems.sort(function(a, b) { return (b.date || '') > (a.date || '') ? 1 : -1; });

        // Tính tổng
        var totalDebt = 0;
        var totalPaid = 0;
        for (var t = 0; t < debtItems.length; t++) {
            if (debtItems[t].type === 'debt') totalDebt += debtItems[t].amount;
            else totalPaid += debtItems[t].amount;
        }

        var html = '<div style="padding:4px 0;">';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<span style="font-size:16px;font-weight:700;">👤 ' + escapeHtml(customerName) + '</span>' +
            '<span style="font-size:13px;color:#64748b;">Nợ: <strong style="color:#dc2626;">' + formatMoney(totalDebt) + '</strong> | Đã trả: <strong style="color:#16a34a;">' + formatMoney(totalPaid) + '</strong></span>' +
        '</div>';

        if (debtItems.length === 0) {
            html += '<div class="empty-state">📭 Không có giao dịch trong kỳ</div>';
        } else {
            for (var j = 0; j < debtItems.length; j++) {
                var item = debtItems[j];
                var isDebt = item.type === 'debt';
                var icon = isDebt ? '📝' : '💵';
                var color = isDebt ? '#dc2626' : '#16a34a';
                var label = isDebt ? 'Nợ' : 'Trả nợ';
                var timeStr = '';
                if (item.date) {
                    try {
                        var dd = new Date(item.date);
                        timeStr = dd.getHours().toString().padStart(2, '0') + ':' + dd.getMinutes().toString().padStart(2, '0');
                    } catch(e) {}
                }
                var dateStr = item.date ? item.date.slice(0, 10) : '';
                html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;padding:4px 0;border-bottom:1px solid #e2e8f0;">' +
                    '<span style="white-space:nowrap;">' + formatDateDisplay(dateStr) + '  ' + icon + ' ' + timeStr + ' <span style="color:' + color + ';">' + label + '</span></span>' +
                    '<span style="font-weight:500;white-space:nowrap;color:' + color + ';">' + (isDebt ? '-' : '+') + formatMoney(item.amount) + '</span>' +
                '</div>';
            }
        }
        html += '</div>';

        // Hiển thị trong modal bottom sheet
        var modal = document.getElementById('managerDetailModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'managerDetailModal';
            modal.className = 'modal';
            modal.innerHTML = '<div class="modal-content" style="max-width:500px;">' +
                '<div class="modal-header"><h3>🧾 Lịch sử công nợ</h3><span class="modal-close" onclick="closeModal(\'managerDetailModal\')">&times;</span></div>' +
                '<div class="modal-body" id="managerDetailModalBody"></div></div>';
            document.body.appendChild(modal);
        }
        document.getElementById('managerDetailModalBody').innerHTML = html;
        openBottomSheet('managerDetailModal');
    });
}

// Export global
window.managerApplyFilter = managerApplyFilter;
window.renderDrinkStats = renderDrinkStats;
window.toggleDrinkStatsExpand = toggleDrinkStatsExpand;
window.renderIngredientStats = renderIngredientStats;
window.toggleIngredientStatsExpand = toggleIngredientStatsExpand;
window.renderLowStockAlert = renderLowStockAlert;
window.renderDebtList = renderDebtList;
