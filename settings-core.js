// settings-core.js - Biến global + Hàm dùng chung cho Settings
// ES5, tương thích Android 6, iOS 12
// ============================================================

// ========== CASH DENOMINATIONS ==========
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

// ========== BIẾN GLOBAL ==========
var cashCounts = {};
var _posCashData = null;
var _posCashCache = {
    costTransactions: null,
    managerPickups: null,
    lastFullReload: 0
};
var _selectedCloseDate = null;
var _dayClosedCache = false;

// ========== FUND GLOBAL ==========
var _fundData = null;
var _fundListener = null;
var _fundRevenueCache = null;
var _fundRevenueListener = null;
var _fundHistoryDisplayCount = 10;

// ========== HÀM KIỂM TRA CHỐT NGÀY ==========
function isDayClosed() {
    return _dayClosedCache;
}

function _updateDayClosedCache() {
    if (_posCashData) {
        _dayClosedCache = _posCashData.isClosed === true;
    }
}

// ========== DATE HELPERS ==========
function getTodayDateKey() {
    var now = new Date();
    var utc7 = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    return utc7.toISOString().slice(0, 10);
}

function formatDateDisplay(dateStr) {
    if (!dateStr) return '';
    var parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function formatDateInput(dateStr) {
    if (!dateStr) return '';
    var parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
}

function _parseVNDate(vnStr) {
    if (!vnStr) return null;
    var parts = vnStr.split('/');
    if (parts.length < 3) return null;
    var d = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10) - 1;
    var y = parseInt(parts[2], 10);
    return new Date(y, m, d);
}

function _vnDateToISO(vnStr) {
    var d = _parseVNDate(vnStr);
    if (!d) return '';
    var y = d.getFullYear();
    var m = (d.getMonth() + 1);
    var day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

// ========== FORMAT HELPERS ==========
function formatMoney(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) amount = 0;
    return amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.') + 'đ';
}

// ========== ESCAPE HELPERS (dự phòng, ưu tiên dùng từ pos-app.js) ==========
if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function(str) {
        if (!str) return '';
        return str.replace(/&/g, '&')
                  .replace(/</g, '<')
                  .replace(/>/g, '>')
                  .replace(/"/g, '"')
                  .replace(/'/g, '&#039;');
    };
}

if (typeof window.escapeJsString !== 'function') {
    window.escapeJsString = function(str) {
        if (!str) return '';
        return str.replace(/\\/g, '\\\\')
                  .replace(/'/g, "\\'")
                  .replace(/"/g, '\\"')
                  .replace(/\n/g, '\\n')
                  .replace(/\r/g, '\\r');
    };
}

// ========== VERSION COMPARE ==========
function compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;
    var a = v1.split('.').map(function(x) { return parseInt(x, 10) || 0; });
    var b = v2.split('.').map(function(x) { return parseInt(x, 10) || 0; });
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
        var na = a[i] || 0;
        var nb = b[i] || 0;
        if (na !== nb) return na > nb ? 1 : -1;
    }
    return 0;
}

// ========== SHOP ID HELPER ==========
function _getShopId() {
    return (typeof DB !== 'undefined' && DB.getShopId) ? DB.getShopId() : (localStorage.getItem('current_shop_id') || 'shop_default');
}

// ========== TOAST ==========
function showToast(message, type, duration) {
    try {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type, duration);
            return;
        }
        // Fallback
        var toast = document.getElementById('toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast';
            toast.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:12px 24px;border-radius:8px;color:#fff;font-size:14px;z-index:9999;max-width:90%;text-align:center;transition:opacity 0.3s;';
            document.body.appendChild(toast);
        }
        toast.textContent = message || '';
        toast.style.background = type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#22c55e';
        toast.style.opacity = '1';
        setTimeout(function() { toast.style.opacity = '0'; }, duration || 3000);
    } catch(e) {}
}
