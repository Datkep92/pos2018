// settings-toast.js - Closeable toast + toggle sections
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

function showCloseableToast(message, type, actionButtons) {
    var toast = document.createElement('div');
    toast.className = 'toast ' + (type || 'success') + ' toast-closeable';
    toast.style.cursor = 'default';

    var msgSpan = document.createElement('span');
    msgSpan.style.whiteSpace = 'pre-line';
    msgSpan.style.flex = '1';
    msgSpan.style.fontSize = '13px';
    msgSpan.style.lineHeight = '1.6';
    msgSpan.textContent = message;

    var btnWrapper = document.createElement('div');
    btnWrapper.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0;margin-left:12px;';

    // Nếu có actionButtons (mảng các nút bấm kèm hành động)
    if (actionButtons && actionButtons.length) {
        for (var i = 0; i < actionButtons.length; i++) {
            var btn = actionButtons[i];
            var actionBtn = document.createElement('button');
            actionBtn.textContent = btn.label || '🔇';
            actionBtn.style.cssText = 'background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);border-radius:4px;color:#fff;font-size:12px;cursor:pointer;padding:4px 10px;white-space:nowrap;';
            actionBtn.onclick = function(cb) {
                return function() {
                    if (cb) cb();
                    if (toast.parentNode) toast.remove();
                };
            }(btn.onClick);
            btnWrapper.appendChild(actionBtn);
        }
    }

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;padding:0;opacity:0.8;flex-shrink:0;';
    closeBtn.onclick = function() {
        if (toast.parentNode) toast.remove();
    };

    btnWrapper.appendChild(closeBtn);
    toast.appendChild(msgSpan);
    toast.appendChild(btnWrapper);
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
// 1b. TOGGLE COLLAPSIBLE SETTINGS SECTIONS
// ============================================================

function toggleSettingsSection(sectionId) {
    var section = document.getElementById(sectionId);
    if (!section) return;
    var body = section.querySelector('.collapsible-body');
    var icon = section.querySelector('.collapse-icon');
    if (!body || !icon) return;
    if (body.style.display === 'none') {
        body.style.display = 'block';
        icon.textContent = '▼';
    } else {
        body.style.display = 'none';
        icon.textContent = '▶';
    }
}