// notifications.js - Quản lý thông báo POS
// ES5, tương thích Android 6, iOS 12
// Bao gồm: thông báo admin header, lịch âm, lịch sử thông báo

// ========== BIẾN GLOBAL ==========
var NOTIFICATIONS_COLLECTION = 'notifications';
var LUNAR_DISMISS_KEY = 'lunar_dismissed';
var NOTIFICATION_TOGGLE_KEY = 'notification_toggle';

// Helper: escape chuỗi cho JavaScript string (dùng trong onclick)
function escapeJsString(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

// Màu sắc cho thông báo
var NOTIFICATION_COLORS = {
    '#f97316': 'Cam',
    '#ef4444': 'Đỏ',
    '#10b981': 'Xanh lá',
    '#3b82f6': 'Xanh dương',
    '#8b5cf6': 'Tím',
    '#ec4899': 'Hồng',
    '#1e293b': 'Tối',
    '#64748b': 'Xám'
};

// ========== KHỞI TẠO ==========
function initNotifications() {
    // Kiểm tra và hiển thị thông báo lịch âm
    checkLunarNotification();
    
    // Tải thông báo header từ DB
    loadHeaderNotification();
    
    // Đăng ký realtime subscription để tự động cập nhật khi admin gửi thông báo mới
    if (typeof DB.subscribe === 'function') {
        DB.subscribe('notifications', function() {
            loadHeaderNotification();
        });
    }
    
    // Kiểm tra toggle trạng thái
    var toggle = document.getElementById('notificationToggle');
    if (toggle) {
        var saved = localStorage.getItem(NOTIFICATION_TOGGLE_KEY);
        if (saved !== null) {
            toggle.checked = saved === 'true';
        }
    }
    
    // Ẩn toggle nếu không phải admin
    var currentUser = DB.getCurrentUser();
    var isAdmin = currentUser && currentUser.role === 'admin';
    var toggleRow = document.getElementById('notificationToggleRow');
    if (toggleRow) {
        toggleRow.style.display = isAdmin ? 'flex' : 'none';
    }
    
    // Gắn sự kiện đổi màu
    var colorInput = document.getElementById('notificationColor');
    var colorLabel = document.getElementById('notificationColorLabel');
    if (colorInput && colorLabel) {
        colorInput.onchange = function() {
            var label = NOTIFICATION_COLORS[this.value] || 'Tùy chỉnh';
            colorLabel.value = label;
            colorLabel.style.color = this.value;
        };
    }
}

// ========== LỊCH ÂM VIỆT NAM ==========
// Sử dụng thư viện lunar-javascript (https://www.npmjs.com/package/lunar-javascript)
// Hỗ trợ mọi năm, không giới hạn

function getLunarDate(dateStr) {
    // dateStr format: "YYYY-MM-DD"
    if (!dateStr) return null;
    var parts = dateStr.split("-");
    if (parts.length < 3) return null;
    var year = parseInt(parts[0], 10);
    var month = parseInt(parts[1], 10);
    var day = parseInt(parts[2], 10);
    
    try {
        // lunar-javascript: Solar -> Lunar
        var solar = Lunar.fromYmd(year, month, day);
        if (solar) {
            return { day: solar.getDay(), month: solar.getMonth() };
        }
    } catch(e) {
        // fallback nếu thư viện lỗi
    }
    return null;
}

function checkLunarNotification() {
    var now = new Date();
    var dateStr = now.toISOString().slice(0, 10);
    var lunar = getLunarDate(dateStr);
    if (!lunar) {
        hideLunarBanner();
        return;
    }
    
    // Kiểm tra ngày 01 và 15 âm lịch
    var isLunarDay1 = (lunar.day === 1);
    var isLunarDay15 = (lunar.day === 15);
    
    if (isLunarDay1 || isLunarDay15) {
        // Kiểm tra đã dismiss chưa
        var dismissed = localStorage.getItem(LUNAR_DISMISS_KEY);
        if (dismissed === dateStr) {
            hideLunarBanner();
            return;
        }
        showLunarBanner(lunar);
    } else {
        hideLunarBanner();
    }
}

function showLunarBanner(lunar) {
    var banner = document.getElementById('lunarNotificationBanner');
    var text = document.getElementById('lunarNotificationText');
    if (!banner || !text) return;
    
    var lunarMonthNames = ["", "Giêng", "Hai", "Ba", "Tư", "Năm", "Sáu", "Bảy", "Tám", "Chín", "Mười", "Một", "Chạp"];
    var monthName = lunarMonthNames[lunar.month] || ("Tháng " + lunar.month);
    var dayName = lunar.day;
    
    text.innerHTML = "🏮 Hôm nay mùng <b>" + dayName + " tháng " + monthName + "</b> âm lịch - Nhớ mua hoa và đồ cúng Ông Địa!";
    banner.style.display = 'flex';
}

function hideLunarBanner() {
    var banner = document.getElementById('lunarNotificationBanner');
    if (banner) banner.style.display = 'none';
}

function dismissLunarNotification() {
    var now = new Date();
    var dateStr = now.toISOString().slice(0, 10);
    localStorage.setItem(LUNAR_DISMISS_KEY, dateStr);
    hideLunarBanner();
    showToast('✅ Đã ghi nhận!', 'success');
}

// ========== THÔNG BÁO HEADER (ADMIN NHẬP) ==========
function loadHeaderNotification() {
    DB.getAll(NOTIFICATIONS_COLLECTION).then(function(notifications) {
        if (!notifications || notifications.length === 0) {
            // FIX: Hiển thị thông báo mặc định khi chưa có dữ liệu từ Firebase
            showHeaderNotification('☕ ' + (window.shopInfo && window.shopInfo.name ? window.shopInfo.name : 'MILANO COFFEE 259') + ' - Chào mừng bạn!', '#f97316');
            renderNotificationHistory([]);
            return;
        }
        
        // Sắp xếp theo thời gian, lấy cái mới nhất
        notifications.sort(function(a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
        });
        
        // Kiểm tra toggle tổng thể
        var toggle = document.getElementById('notificationToggle');
        var isEnabled = toggle ? toggle.checked : true;
        
        // Tìm thông báo mới nhất đang active (active !== false)
        var latestActive = null;
        for (var i = 0; i < notifications.length; i++) {
            if (notifications[i].active !== false) {
                latestActive = notifications[i];
                break;
            }
        }
        
        if (latestActive && isEnabled) {
            showHeaderNotification(latestActive.content || latestActive.message || "", latestActive.color || '#f97316');
        } else if (isEnabled) {
            // FIX: Nếu không có thông báo active nhưng toggle vẫn bật, hiển thị mặc định
            showHeaderNotification('☕ ' + (window.shopInfo && window.shopInfo.name ? window.shopInfo.name : 'MILANO COFFEE 259') + ' - Hệ thống sẵn sàng', '#64748b');
        } else {
            hideHeaderNotification();
        }
        
        // Render lịch sử
        renderNotificationHistory(notifications);
    }).catch(function() {
        // FIX: Khi có lỗi (offline), vẫn hiển thị thông báo mặc định
        showHeaderNotification('☕ ' + (window.shopInfo && window.shopInfo.name ? window.shopInfo.name : 'MILANO COFFEE 259') + ' - Đang hoạt động', '#f97316');
    });
}

function showHeaderNotification(text, color) {
    var bar = document.getElementById('headerNotificationBar');
    var textEl = document.getElementById('headerNotificationText');
    if (!bar || !textEl) return;
    
    color = color || '#f97316';
    bar.style.background = 'linear-gradient(90deg, ' + color + ', ' + color + 'dd)';
    textEl.innerHTML = "📢 " + escapeHtml(text);
    bar.style.display = 'flex';
}

function hideHeaderNotification() {
    var bar = document.getElementById('headerNotificationBar');
    if (bar) bar.style.display = 'none';
}

function dismissHeaderNotification() {
    hideHeaderNotification();
}

// ========== ADMIN: LƯU THÔNG BÁO ==========
function saveNotification() {
    var input = document.getElementById('notificationInput');
    if (!input) return;
    
    var content = input.value.trim();
    if (!content) {
        showToast('Vui lòng nhập nội dung thông báo!', 'warning');
        return;
    }
    
    var colorInput = document.getElementById('notificationColor');
    var color = colorInput ? colorInput.value : '#f97316';
    
    var notificationData = {
        content: content,
        active: true,
        color: color,
        createdAt: Date.now(),
        createdBy: DB.getCurrentUser() ? DB.getCurrentUser().id : 'unknown'
    };
    
    DB.create(NOTIFICATIONS_COLLECTION, notificationData).then(function() {
        showToast('✅ Đã cập nhật thông báo!', 'success');
        input.value = '';
        
        // Gửi lên Telegram
        if (typeof notifyTelegramCustom === 'function') {
            notifyTelegramCustom("📢 <b>Thông báo mới từ Admin:</b>\n" + content);
        }
        
        // Hiển thị ngay
        loadHeaderNotification();
    }).catch(function(err) {
        showToast('❌ Lỗi: ' + (err.message || 'Không thể lưu'), 'error');
    });
}

// ========== SỬA THÔNG BÁO ==========
function editNotification(id, currentContent, currentColor) {
    var newContent = prompt('Sửa nội dung thông báo:', currentContent);
    if (newContent === null) return; // Hủy
    newContent = newContent.trim();
    if (!newContent) {
        showToast('Nội dung không được để trống!', 'warning');
        return;
    }
    
    DB.get(NOTIFICATIONS_COLLECTION, id).then(function(notif) {
        if (!notif) {
            showToast('Không tìm thấy thông báo!', 'error');
            throw new Error('NOT_FOUND');
        }
        notif.content = newContent;
        notif.updatedAt = Date.now();
        return DB.update(NOTIFICATIONS_COLLECTION, id, notif);
    }).then(function() {
        showToast('✅ Đã sửa thông báo!', 'success');
        loadHeaderNotification();
    }).catch(function(err) {
        if (err.message === 'NOT_FOUND') return;
        showToast('❌ Lỗi: ' + (err.message || 'Không thể sửa'), 'error');
    });
}

// ========== BẬT/TẮT THÔNG BÁO CŨ ==========
function toggleNotificationActive(id, currentActive) {
    var newActive = !currentActive;
    
    DB.get(NOTIFICATIONS_COLLECTION, id).then(function(notif) {
        if (!notif) {
            showToast('Không tìm thấy thông báo!', 'error');
            throw new Error('NOT_FOUND');
        }
        notif.active = newActive;
        notif.updatedAt = Date.now();
        return DB.update(NOTIFICATIONS_COLLECTION, id, notif);
    }).then(function() {
        showToast(newActive ? '🟢 Đã bật thông báo' : '🔴 Đã tắt thông báo', 'success');
        loadHeaderNotification();
    }).catch(function(err) {
        if (err.message === 'NOT_FOUND') return;
        showToast('❌ Lỗi: ' + (err.message || 'Không thể cập nhật'), 'error');
    });
}

// ========== ADMIN: BẬT/TẮT THÔNG BÁO ==========
function toggleNotifications(enabled) {
    localStorage.setItem(NOTIFICATION_TOGGLE_KEY, enabled ? 'true' : 'false');
    
    if (enabled) {
        loadHeaderNotification();
        showToast('🔔 Đã bật thông báo', 'success');
    } else {
        hideHeaderNotification();
        showToast('🔕 Đã tắt thông báo', 'info');
    }
}

// ========== LỊCH SỬ THÔNG BÁO ==========
var _notificationHistoryExpanded = false;

function toggleNotificationHistory() {
    var list = document.getElementById('notificationHistoryList');
    var btn = document.getElementById('notificationHistoryToggleBtn');
    if (!list || !btn) return;
    
    _notificationHistoryExpanded = !_notificationHistoryExpanded;
    
    if (_notificationHistoryExpanded) {
        list.style.maxHeight = list.scrollHeight + 'px';
        // Đợi render xong rồi set height
        setTimeout(function() {
            list.style.maxHeight = '500px';
        }, 50);
        btn.textContent = '📂 Thu gọn';
    } else {
        list.style.maxHeight = '0';
        btn.textContent = '📂 Mở rộng';
    }
}

function renderNotificationHistory(notifications) {
    var container = document.getElementById('notificationHistoryList');
    if (!container) return;
    
    if (!notifications || notifications.length === 0) {
        container.innerHTML = '<div class="empty-text" style="padding:8px;text-align:center;color:#94a3b8;">Chưa có thông báo</div>';
        return;
    }
    
    // Kiểm tra quyền admin
    var currentUser = DB.getCurrentUser();
    var isAdmin = currentUser && currentUser.role === 'admin';
    
    // Sắp xếp mới nhất lên đầu
    var sorted = notifications.slice().sort(function(a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
    });
    
    var html = '';
    for (var i = 0; i < sorted.length; i++) {
        var notif = sorted[i];
        var timeStr = '';
        if (notif.createdAt) {
            var d = new Date(notif.createdAt);
            timeStr = d.toLocaleString('vi-VN', {
                hour: '2-digit',
                minute: '2-digit',
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            });
        }
        var statusIcon = notif.active !== false ? '🟢' : '🔴';
        var notifColor = notif.color || '#f97316';
        var notifContent = notif.content || notif.message || '';
        
        html += '<div class="notification-history-item">' +
            '<div class="notif-item-header">' +
                '<span class="notif-status">' + statusIcon + '</span>' +
                '<span class="notif-time">' + timeStr + '</span>';
        
        // Nút actions cho admin
        if (isAdmin) {
            html += '<span class="notif-actions">' +
                '<button class="notif-action-btn" onclick="editNotification(\'' + escapeJsString(notif.id) + '\', \'' + escapeJsString(notifContent) + '\', \'' + escapeJsString(notifColor) + '\')" title="Sửa">✏️</button>' +
                '<button class="notif-action-btn" onclick="toggleNotificationActive(\'' + escapeJsString(notif.id) + '\', ' + (notif.active !== false) + ')" title="' + (notif.active !== false ? 'Tắt' : 'Bật') + '">' + (notif.active !== false ? '🔕' : '🔔') + '</button>' +
            '</span>';
        }
        
        html += '</div>' +
            '<div class="notif-item-content" style="border-left:3px solid ' + notifColor + ';padding-left:8px;">' + escapeHtml(notifContent) + '</div>' +
        '</div>';
    }
    
    container.innerHTML = html;
    
    // Nếu đang mở rộng, cập nhật max-height
    if (_notificationHistoryExpanded) {
        container.style.maxHeight = '500px';
    }
}

// ========== TÍCH HỢP TELEGRAM VÀO GIAO DỊCH ==========
// Gọi sau khi thanh toán thành công
function notifyPaymentToTelegram(transaction) {
    if (typeof notifyTelegramTransaction === 'function') {
        notifyTelegramTransaction(transaction);
    }
}

// Gọi sau khi tạo chi phí
function notifyExpenseToTelegram(expenseData) {
    if (typeof notifyTelegramExpense === 'function') {
        notifyTelegramExpense(expenseData);
    }
}
