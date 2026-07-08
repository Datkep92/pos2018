// settings-date.js - Date selection
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

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