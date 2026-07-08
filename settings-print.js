// settings-print.js - Print manager pickup + staff close receipt
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

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