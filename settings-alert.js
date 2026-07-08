// settings-alert.js - Alert sound
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

// Dùng Web Audio API để tạo âm thanh cảnh báo, không cần file âm thanh
var _alertSoundCtx = null; // Biến global để có thể tắt âm thanh từ toast

function _playAlertSound() {
    try {
        if (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') {
            var AudioCtx = window.AudioContext || window.webkitAudioContext;
            // Hủy AudioContext cũ nếu đang phát
            if (_alertSoundCtx) {
                try { _alertSoundCtx.close(); } catch(e) {}
                _alertSoundCtx = null;
            }
            _alertSoundCtx = new AudioCtx();
            var ctx = _alertSoundCtx;
            var now = ctx.currentTime;
            // Tạo âm thanh cảnh báo: 200 hồi chuông liên tiếp, kéo dài ~60 giây
            for (var i = 0; i < 200; i++) {
                var osc = ctx.createOscillator();
                var gain = ctx.createGain();
                osc.type = 'square'; // Âm thanh rõ, dễ nghe
                osc.frequency.value = 880; // Tần số A5
                gain.gain.setValueAtTime(0.35, now + i * 0.3);
                gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.3 + 0.25);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + i * 0.3);
                osc.stop(now + i * 0.3 + 0.25);
            }
        }
    } catch(e) {
        // Bỏ qua nếu không hỗ trợ Web Audio API
    }
}

function _stopAlertSound() {
    if (_alertSoundCtx) {
        try { _alertSoundCtx.close(); } catch(e) {}
        _alertSoundCtx = null;
    }
}