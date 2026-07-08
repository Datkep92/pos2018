// settings-visibility.js - Online/offline + visibility detection
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

(function _initOnlineVisibility() {
    // Hàm clear cache và reload
    function _forceReloadPosCash() {
        // Clear cache để buộc load lại từ Firebase
        _posCashCache.costTransactions = null;
        _posCashCache.managerPickups = null;
        _posCashCache.lastFullReload = 0;
        if (typeof loadPosCashData === 'function') {
            loadPosCashData();
        }
    }

    // Khi tab được focus lại (sau sleep, chuyển tab, v.v.)
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            // Tab vừa được focus lại
            var now = Date.now();
            // Chỉ reload nếu đã qua ít nhất 10 giây kể từ lần reload cuối
            if ((now - _posCashCache.lastFullReload) > 10000) {
                _forceReloadPosCash();
            }
        }
    });

    // Khi trình duyệt online trở lại (sau offline)
    window.addEventListener('online', function() {
        _forceReloadPosCash();
    });

    // Khi app được khôi phục từ background (iOS Safari, Android Chrome)
    window.addEventListener('focus', function() {
        var now = Date.now();
        if ((now - _posCashCache.lastFullReload) > 15000) {
            _forceReloadPosCash();
        }
    });
})();