// settings-escape.js - Escape helpers + version compare (dự phòng)
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js
// Các hàm này đã được định nghĩa trong settings-core.js dưới dạng fallback.
// File này giữ lại để tương thích ngược, nhưng ưu tiên dùng từ core.

// ESCAPE HELPERS (dự phòng, chỉ định nghĩa nếu chưa có)
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

// SO SÁNH PHIÊN BẢN (dự phòng, chỉ định nghĩa nếu chưa có)
if (typeof window.compareVersions !== 'function') {
    window.compareVersions = function(v1, v2) {
        if (!v1 || !v2) return 0;
        var a = v1.split('.').map(function(x) { return parseInt(x, 10) || 0; });
        var b = v2.split('.').map(function(x) { return parseInt(x, 10) || 0; });
        for (var i = 0; i < Math.max(a.length, b.length); i++) {
            var na = a[i] || 0;
            var nb = b[i] || 0;
            if (na !== nb) return na > nb ? 1 : -1;
        }
        return 0;
    };
}