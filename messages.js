// messages.js - Chat nội bộ POS
// ES5, tương thích Android 6, iOS 12
// Collection Firebase: /{shopId}/messages/
// Cho phép admin gửi thông báo, staff trả lời/xác nhận/từ chối

// ========== BIẾN GLOBAL ==========
var CHAT_SOUND_ENABLED = true;
var CHAT_SOUND_KEY = 'chat_sound_enabled';
var CHAT_AUTO_POPUP_KEY = 'chat_auto_popup_enabled';
var CHAT_LOCK_KEY = 'chat_staff_locked';
var _chatPopupVisible = false;
var _lastMessageCount = 0;
var _chatInitialized = false;
var _chatPollInterval = null;

// Biến lưu trạng thái khóa chat từ Firebase (đồng bộ realtime giữa các thiết bị)
var _chatLockedState = false;
var _chatLockListener = null;

// Hàng đợi âm thanh
var _audioQueue = [];
var _audioPlaying = false;

// ========== KHỞI TẠO ==========
function initChat() {
    if (_chatInitialized) return;
    _chatInitialized = true;
    
    // Khôi phục cài đặt âm thanh
    try {
        var saved = localStorage.getItem(CHAT_SOUND_KEY);
        if (saved !== null) {
            CHAT_SOUND_ENABLED = saved === 'true';
        }
    } catch(e) {}
    
    // Cập nhật badge
    updateChatBadge();
    
    // Polling kiểm tra tin nhắn mới mỗi 5 giây
    if (_chatPollInterval) {
        clearInterval(_chatPollInterval);
    }
    _chatPollInterval = setInterval(checkNewMessages, 5000);
    
    // Đăng ký Firebase realtime listener cho trạng thái khóa chat
    _initChatLockListener();
    
    // Đồng bộ trạng thái khóa chat vào UI (gọi nhiều lần để đảm bảo user đã load)
    _syncChatLockUI();
    // Nếu user chưa kịp load, thử lại sau
    setTimeout(_syncChatLockUI, 500);
    setTimeout(_syncChatLockUI, 1500);
    
    console.log('💬 Chat initialized');
}

// ========== KIỂM TRA / ĐỒNG BỘ KHÓA CHAT ==========
// Lấy shopId từ localStorage (giống db.js)
function _getChatShopId() {
    try {
        return localStorage.getItem('current_shop_id') || 'shop_default';
    } catch(e) {
        return 'shop_default';
    }
}

// Kiểm tra trạng thái khóa chat
// Ưu tiên đọc từ biến _chatLockedState (đồng bộ từ Firebase realtime)
// Fallback về localStorage nếu chưa có Firebase data
function isChatLocked() {
    // Nếu đã có Firebase listener, dùng biến global
    if (_chatLockListener) {
        return _chatLockedState;
    }
    // Fallback: đọc từ localStorage
    try {
        var locked = localStorage.getItem(CHAT_LOCK_KEY);
        return locked === 'true';
    } catch(e) {
        return false;
    }
}

// Đăng ký Firebase realtime listener cho trạng thái khóa chat
// Tất cả client (admin + staff) đều nhận cập nhật realtime
function _initChatLockListener() {
    // Hủy listener cũ nếu có
    if (_chatLockListener) {
        _chatLockListener.off();
        _chatLockListener = null;
    }
    
    try {
        var shopId = _getChatShopId();
        var lockRef = firebase.database().ref(shopId + '/config/chat_staff_locked');
        
        // Đọc giá trị hiện tại một lần (đảm bảo UI đúng ngay lập tức)
        lockRef.once('value').then(function(snapshot) {
            var val = snapshot.val();
            _chatLockedState = val === true;
            try {
                localStorage.setItem(CHAT_LOCK_KEY, _chatLockedState ? 'true' : 'false');
            } catch(e) {}
            _syncChatLockUI();
        }).catch(function() {
            // Fallback nếu không đọc được Firebase
            try {
                var saved = localStorage.getItem(CHAT_LOCK_KEY);
                _chatLockedState = saved === 'true';
            } catch(e) {}
            _syncChatLockUI();
        });
        
        // Đăng ký realtime listener - tất cả client đều nhận cập nhật ngay lập tức
        _chatLockListener = lockRef;
        lockRef.on('value', function(snapshot) {
            var val = snapshot.val();
            _chatLockedState = val === true;
            // Đồng bộ xuống localStorage để có fallback
            try {
                localStorage.setItem(CHAT_LOCK_KEY, _chatLockedState ? 'true' : 'false');
            } catch(e) {}
            _syncChatLockUI();
        });
    } catch(e) {
        console.warn('Chat lock Firebase listener failed:', e);
        // Fallback: đọc từ localStorage
        try {
            var saved = localStorage.getItem(CHAT_LOCK_KEY);
            _chatLockedState = saved === 'true';
        } catch(e) {}
        _syncChatLockUI();
    }
}

// Admin bật/tắt khóa chat - ghi lên Firebase để đồng bộ realtime
function toggleChatLock(locked) {
    // Cập nhật biến local ngay lập tức
    _chatLockedState = locked;
    
    // Ghi xuống localStorage làm fallback
    try {
        localStorage.setItem(CHAT_LOCK_KEY, locked ? 'true' : 'false');
    } catch(e) {}
    
    // Ghi lên Firebase để đồng bộ realtime với tất cả client
    try {
        var shopId = _getChatShopId();
        firebase.database().ref(shopId + '/config/chat_staff_locked').set(locked);
    } catch(e) {
        console.warn('Chat lock Firebase write failed:', e);
    }
    
    // Đồng bộ UI toggle trong settings nếu có
    var lockToggle = document.getElementById('chatLockToggle');
    if (lockToggle) {
        lockToggle.checked = locked;
    }
    var lockLabel = document.getElementById('chatLockStatusLabel');
    if (lockLabel) {
        lockLabel.textContent = locked ? '🔒 Đã khóa' : '🔓 Đã mở';
    }
    
    _syncChatLockUI();
    
    showToast(locked ? '🔒 Đã khóa chat nhân viên' : '🔓 Đã mở khóa chat nhân viên', 'success');
}

function _syncChatLockUI() {
    var locked = isChatLocked();
    var inputRow = document.querySelector('.chat-input-row');
    var lockMsg = document.getElementById('chatLockedMessage');
    
    if (!inputRow) return;
    
    var isAdmin = DB.isAdmin();
    
    if (locked && !isAdmin) {
        // Staff bị khóa: ẩn hoàn toàn ô nhập + nút gửi, hiện thông báo
        inputRow.style.display = 'none';
        if (lockMsg) lockMsg.style.display = 'block';
    } else {
        // Admin hoặc chưa khóa: hiện ô nhập, ẩn thông báo
        inputRow.style.display = 'flex';
        if (lockMsg) lockMsg.style.display = 'none';
    }
}

// ========== ÂM THANH THÔNG BÁO ==========
function _playNextAudio() {
    if (_audioPlaying || _audioQueue.length === 0) return;
    _audioPlaying = true;
    var note = _audioQueue.shift();
    try {
        var ctx = new (window.AudioContext || window.webkitAudioContext)();
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = note.freq;
        osc.type = note.type || 'sine';
        gain.gain.setValueAtTime(note.volume || 0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + note.duration);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + note.duration);
        osc.onended = function() {
            _audioPlaying = false;
            _playNextAudio();
        };
    } catch(e) {
        _audioPlaying = false;
        _playNextAudio();
    }
}

function _playNotificationSound(priority) {
    if (!CHAT_SOUND_ENABLED) return;
    
    if (priority === 'urgent') {
        // 3 beep nhanh, tần số cao, âm square
        _audioQueue.push({ freq: 880, duration: 0.15, volume: 0.4, type: 'square' });
        _audioQueue.push({ freq: 880, duration: 0.15, volume: 0.4, type: 'square' });
        _audioQueue.push({ freq: 880, duration: 0.15, volume: 0.4, type: 'square' });
    } else if (priority === 'important') {
        // 2 beep
        _audioQueue.push({ freq: 660, duration: 0.2, volume: 0.3 });
        _audioQueue.push({ freq: 660, duration: 0.2, volume: 0.3 });
    } else {
        // 1 beep ngắn
        _audioQueue.push({ freq: 523, duration: 0.15, volume: 0.2 });
    }
    _playNextAudio();
}

// ========== UI: TOGGLE POPUP ==========
function toggleChatPopup() {
    var popup = document.getElementById('chatPopup');
    if (!popup) return;
    
    if (popup.style.display === 'none' || popup.style.display === '') {
        popup.style.display = 'flex';
        _chatPopupVisible = true;
        renderChatMessages();
        // Đánh dấu tất cả đã đọc
        markAllAsRead();
        // Đồng bộ trạng thái khóa chat
        _syncChatLockUI();
    } else {
        popup.style.display = 'none';
        _chatPopupVisible = false;
    }
}

// ========== UI: RENDER DANH SÁCH TIN NHẮN ==========
function renderChatMessages() {
    var body = document.getElementById('chatPopupBody');
    if (!body) return;
    
    DB.getAll('messages').then(function(messages) {
        if (!messages || messages.length === 0) {
            body.innerHTML = '<div class="chat-empty">Chưa có tin nhắn nào</div>';
            return;
        }
        
        // Sắp xếp cũ nhất lên trên (mới nhất xuống cuối)
        messages.sort(function(a, b) {
            return (a.createdAt || 0) - (b.createdAt || 0);
        });
        
        var html = '';
        var currentUser = DB.getCurrentUser();
        var isAdmin = DB.isAdmin();
        
        for (var i = 0; i < messages.length; i++) {
            var msg = messages[i];
            html += _renderMessageHtml(msg, isAdmin, currentUser);
        }
        
        body.innerHTML = html;
        
        // Scroll xuống cuối (tin nhắn mới nhất)
        body.scrollTop = body.scrollHeight;
    }).catch(function() {
        body.innerHTML = '<div class="chat-empty">Không thể tải tin nhắn</div>';
    });
}

function _renderMessageHtml(msg, isAdmin, currentUser) {
    if (!msg) return '';
    
    var fromName = msg.from ? (msg.from.name || msg.from.id || 'Unknown') : 'Unknown';
    var fromRole = msg.from ? (msg.from.role || 'staff') : 'staff';
    var timeStr = formatChatTime(msg.createdAt);
    var priority = msg.priority || 'normal';
    var status = msg.status || 'active';
    
    // Icon theo priority
    var priorityIcon = '';
    var priorityClass = '';
    if (priority === 'urgent') {
        priorityIcon = '🔴 ';
        priorityClass = 'chat-message-urgent';
    } else if (priority === 'important') {
        priorityIcon = '⭐ ';
        priorityClass = 'chat-message-important';
    }
    
    // Icon theo role
    var roleIcon = (fromRole === 'admin' || fromRole === 'master_admin' || fromRole === 'pos_admin') ? '👑 ' : '👤 ';
    
    // Header
    var html = '<div class="chat-message ' + priorityClass + '" data-msg-id="' + escapeHtml(msg.id) + '">';
    html += '<div class="chat-msg-header">';
    html += '<span class="chat-msg-from">' + roleIcon + escapeHtml(fromName) + '</span>';
    html += '<span class="chat-msg-time">' + priorityIcon + timeStr + '</span>';
    
    // Nút xóa tin nhắn (chỉ admin)
    if (isAdmin) {
        html += '<button class="chat-msg-delete-btn" onclick="deleteChatMessage(\'' + escapeJsString(msg.id) + '\', event)" title="Xóa tin nhắn">🗑️</button>';
    }
    
    html += '</div>';
    
    // Nội dung
    html += '<div class="chat-msg-content">' + escapeHtml(msg.content) + '</div>';
    
    // Replies (thread)
    if (msg.replies && msg.replies.length > 0) {
        html += '<div class="chat-replies">';
        for (var r = 0; r < msg.replies.length; r++) {
            var reply = msg.replies[r];
            html += _renderReplyHtml(reply);
        }
        html += '</div>';
    }
    
    // Nút actions cho staff (nếu chưa reply)
    var hasReplied = false;
    if (currentUser && msg.replies) {
        for (var rr = 0; rr < msg.replies.length; rr++) {
            if (msg.replies[rr].from && msg.replies[rr].from.id === currentUser.id) {
                hasReplied = true;
                break;
            }
        }
    }
    
    // Chỉ hiển thị nút nếu:
    // - Staff chưa reply
    // - Message còn active
    // - Người gửi không phải là chính mình
    // Khi khóa chat: staff vẫn được xác nhận/từ chối/trả lời, chỉ không gửi được tin nhắn mới
    var canReply = !hasReplied && status === 'active';
    if (currentUser && msg.from) {
        if (msg.from.id === currentUser.id) canReply = false;
    }
    
    if (canReply) {
        html += '<div class="chat-msg-actions">';
        html += '<button class="chat-action-btn chat-action-confirm" onclick="replyToMessage(\'' + escapeJsString(msg.id) + '\', \'confirm\', \'✅ Đã xác nhận\')">✅ Xác nhận</button>';
        html += '<button class="chat-action-btn chat-action-reject" onclick="replyToMessage(\'' + escapeJsString(msg.id) + '\', \'reject\', \'❌ Từ chối\')">❌ Từ chối</button>';
        html += '<button class="chat-action-btn chat-action-reply" onclick="showReplyInput(\'' + escapeJsString(msg.id) + '\')">💬 Trả lời</button>';
        html += '</div>';
    }
    
    // Trả lời inline (input ẩn)
    html += '<div class="chat-reply-input-container" id="replyInput_' + escapeJsString(msg.id) + '" style="display:none;">';
    html += '<input type="text" class="chat-reply-input" id="replyText_' + escapeJsString(msg.id) + '" placeholder="Nhập trả lời..." onkeydown="if(event.key===\'Enter\') sendReply(\'' + escapeJsString(msg.id) + '\')">';
    html += '<button class="chat-send-btn chat-reply-send" onclick="sendReply(\'' + escapeJsString(msg.id) + '\')">➤</button>';
    html += '</div>';
    
    html += '</div>';
    
    return html;
}

function _renderReplyHtml(reply) {
    if (!reply) return '';
    var replyName = reply.from ? (reply.from.name || reply.from.id || 'Unknown') : 'Unknown';
    var replyTime = formatChatTime(reply.createdAt);
    var replyType = reply.type || 'reply';
    
    var icon = '';
    if (replyType === 'confirm') icon = '✅ ';
    else if (replyType === 'reject') icon = '❌ ';
    else icon = '💬 ';
    
    return '<div class="chat-reply-item chat-reply-' + replyType + '">' +
        '<span class="chat-reply-author">' + icon + escapeHtml(replyName) + '</span>' +
        '<span class="chat-reply-text">' + escapeHtml(reply.content || '') + '</span>' +
        '<span class="chat-reply-time">' + replyTime + '</span>' +
    '</div>';
}

// ========== GỬI TIN NHẮN ==========
function sendChatMessage() {
    var input = document.getElementById('chatInput');
    var prioritySelect = document.getElementById('chatPrioritySelect');
    if (!input) return;
    
    // Kiểm tra khóa chat
    var currentUser = DB.getCurrentUser();
    if (currentUser && currentUser.role !== 'admin' && isChatLocked()) {
        showToast('🔒 Chat đã bị khóa bởi quản lý! Bạn chỉ có thể xem tin nhắn.', 'warning');
        return;
    }
    
    var content = input.value.trim();
    if (!content) {
        showToast('Vui lòng nhập nội dung tin nhắn!', 'warning');
        return;
    }
    
    if (!currentUser) {
        showToast('Bạn cần đăng nhập để gửi tin nhắn!', 'warning');
        return;
    }
    
    var priority = prioritySelect ? prioritySelect.value : 'normal';
    
    var msgData = {
        from: {
            id: currentUser.id,
            name: currentUser.displayName || currentUser.username || currentUser.id,
            role: currentUser.role || 'staff'
        },
        content: content,
        type: 'notification',
        priority: priority,
        target: {
            type: 'all'
        },
        createdAt: Date.now(),
        replies: [],
        readBy: {},
        status: 'active'
    };
    
    input.value = '';
    
    DB.create('messages', msgData).then(function() {
        showToast('✅ Đã gửi tin nhắn!', 'success');
        // Render lại nếu popup đang mở
        if (_chatPopupVisible) {
            renderChatMessages();
        }
        // Gửi thông báo Telegram khi có chat mới
        _notifyChatToTelegram(msgData);
    }).catch(function(err) {
        showToast('❌ Lỗi gửi tin nhắn: ' + (err.message || 'unknown'), 'error');
    });
}

// ========== XÓA TIN NHẮN (ADMIN) ==========
function deleteChatMessage(msgId, event) {
    if (!msgId) return;
    
    var currentUser = DB.getCurrentUser();
    if (!currentUser || currentUser.role !== 'admin') {
        showToast('❌ Chỉ admin mới có quyền xóa tin nhắn!', 'error');
        return;
    }
    
    if (!confirm('🗑️ Xóa tin nhắn này?\n\nHành động này không thể hoàn tác.')) return;
    
    // Ngăn sự kiện click lan ra
    if (event) {
        event.stopPropagation();
    }
    
    DB.remove('messages', msgId).then(function() {
        showToast('✅ Đã xóa tin nhắn', 'success');
        if (_chatPopupVisible) {
            renderChatMessages();
        }
        updateChatBadge();
    }).catch(function(err) {
        showToast('❌ Lỗi xóa tin nhắn: ' + (err.message || 'unknown'), 'error');
    });
}

// ========== XÓA TIN NHẮN CŨ (ADMIN) ==========
function clearOldChatMessages() {
    var currentUser = DB.getCurrentUser();
    if (!currentUser || currentUser.role !== 'admin') {
        showToast('❌ Chỉ admin mới có quyền xóa tin nhắn cũ!', 'error');
        return;
    }
    
    if (!confirm('🗑️ Xóa tất cả tin nhắn > 30 ngày?\n\nHành động này không thể hoàn tác.')) return;
    
    var cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 ngày
    
    DB.getAll('messages').then(function(messages) {
        if (!messages || messages.length === 0) {
            showToast('ℹ️ Không có tin nhắn nào để xóa', 'info');
            return;
        }
        
        var deleted = 0;
        var promises = [];
        
        for (var i = 0; i < messages.length; i++) {
            var msg = messages[i];
            if (msg.createdAt && msg.createdAt < cutoff) {
                promises.push(DB.remove('messages', msg.id));
                deleted++;
            }
        }
        
        if (deleted === 0) {
            showToast('ℹ️ Không có tin nhắn nào cũ hơn 30 ngày', 'info');
            return;
        }
        
        Promise.all(promises).then(function() {
            showToast('✅ Đã xóa ' + deleted + ' tin nhắn cũ', 'success');
            if (_chatPopupVisible) {
                renderChatMessages();
            }
            updateChatBadge();
        }).catch(function(err) {
            showToast('❌ Lỗi khi xóa tin nhắn cũ: ' + (err.message || 'unknown'), 'error');
        });
    }).catch(function(err) {
        showToast('❌ Lỗi khi tải tin nhắn: ' + (err.message || 'unknown'), 'error');
    });
}

// ========== TRẢ LỜI / XÁC NHẬN / TỪ CHỐI ==========
// Khi khóa chat: staff vẫn được xác nhận/từ chối/trả lời tin nhắn
function replyToMessage(msgId, type, defaultContent) {
    if (!msgId) return;
    
    var currentUser = DB.getCurrentUser();
    if (!currentUser) {
        showToast('Bạn cần đăng nhập!', 'warning');
        return;
    }
    
    var content = defaultContent || '';
    
    DB.get('messages', msgId).then(function(msg) {
        if (!msg) {
            showToast('Không tìm thấy tin nhắn!', 'error');
            throw new Error('NOT_FOUND');
        }
        
        if (!msg.replies) msg.replies = [];
        
        msg.replies.push({
            id: 'reply_' + Date.now().toString(36),
            from: {
                id: currentUser.id,
                name: currentUser.displayName || currentUser.username || currentUser.id,
                role: currentUser.role || 'staff'
            },
            type: type,
            content: content,
            createdAt: Date.now()
        });
        
        return DB.update('messages', msgId, msg);
    }).then(function() {
        showToast(type === 'confirm' ? '✅ Đã xác nhận!' : type === 'reject' ? '❌ Đã từ chối' : '💬 Đã trả lời', 'success');
        if (_chatPopupVisible) {
            renderChatMessages();
        }
    }).catch(function(err) {
        if (err.message === 'NOT_FOUND') return;
        showToast('❌ Lỗi: ' + (err.message || 'unknown'), 'error');
    });
}

// ========== HIỂN THỊ INPUT TRẢ LỜI ==========
function showReplyInput(msgId) {
    var container = document.getElementById('replyInput_' + msgId);
    if (!container) return;
    
    // Ẩn tất cả input khác
    var allInputs = document.querySelectorAll('.chat-reply-input-container');
    for (var i = 0; i < allInputs.length; i++) {
        if (allInputs[i].id !== 'replyInput_' + msgId) {
            allInputs[i].style.display = 'none';
        }
    }
    
    container.style.display = container.style.display === 'none' ? 'flex' : 'none';
    if (container.style.display === 'flex') {
        var input = document.getElementById('replyText_' + msgId);
        if (input) input.focus();
    }
}

function sendReply(msgId) {
    var input = document.getElementById('replyText_' + msgId);
    if (!input) return;
    
    // Khi khóa chat: staff vẫn được trả lời tin nhắn
    var content = input.value.trim();
    if (!content) {
        showToast('Vui lòng nhập nội dung trả lời!', 'warning');
        return;
    }
    
    input.value = '';
    var container = document.getElementById('replyInput_' + msgId);
    if (container) container.style.display = 'none';
    
    replyToMessage(msgId, 'reply', content);
}

// ========== BADGE ==========
function updateChatBadge() {
    var badge = document.getElementById('chatBadge');
    if (!badge) return;
    
    getUnreadCount().then(function(count) {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.style.display = 'inline';
        } else {
            badge.style.display = 'none';
        }
    });
}

function getUnreadCount() {
    // OPTIMIZE: Đọc từ memory cache trước (nhanh, không block UI)
    var cached = (typeof DB.getMemoryCache === 'function') ? DB.getMemoryCache('messages') : null;
    if (cached) {
        return Promise.resolve(_calcUnreadCount(cached));
    }
    return DB.getAll('messages').then(function(messages) {
        return _calcUnreadCount(messages);
    });
}

function _calcUnreadCount(messages) {
    if (!messages || messages.length === 0) return 0;
    
    var currentUser = DB.getCurrentUser();
    if (!currentUser) return 0;
    
    var count = 0;
    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        if (!msg || msg.status === 'archived') continue;
        
        // Bỏ qua tin nhắn do chính mình gửi
        if (msg.from && msg.from.id === currentUser.id) continue;
        
        // Kiểm tra đã đọc chưa
        var read = msg.readBy && msg.readBy[currentUser.id];
        if (!read) {
            count++;
        }
    }
    return count;
}

function markAllAsRead() {
    var currentUser = DB.getCurrentUser();
    if (!currentUser) return;
    
    DB.getAll('messages').then(function(messages) {
        if (!messages || messages.length === 0) return;
        
        var now = Date.now();
        for (var i = 0; i < messages.length; i++) {
            var msg = messages[i];
            if (!msg) continue;
            if (msg.from && msg.from.id === currentUser.id) continue;
            
            if (!msg.readBy) msg.readBy = {};
            if (!msg.readBy[currentUser.id]) {
                msg.readBy[currentUser.id] = now;
                DB.update('messages', msg.id, msg).catch(function() {});
            }
        }
        
        updateChatBadge();
    }).catch(function() {});
}

// ========== KIỂM TRA TIN NHẮN MỚI ==========
var _lastCheckedMsgId = null;

function checkNewMessages() {
    // Đồng bộ trạng thái khóa chat mỗi lần poll
    _syncChatLockUI();
    
    DB.getAll('messages').then(function(messages) {
        if (!messages || messages.length === 0) return;
        
        var currentUser = DB.getCurrentUser();
        if (!currentUser) return;
        
        // Sắp xếp mới nhất lên đầu để lấy tin nhắn mới nhất
        messages.sort(function(a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
        });
        
        var latestMsg = messages[0];
        if (!latestMsg) return;
        
        // Bỏ qua tin nhắn của chính mình
        if (latestMsg.from && latestMsg.from.id === currentUser.id) return;
        
        // Nếu đã check tin nhắn này rồi thì bỏ qua
        if (latestMsg.id === _lastCheckedMsgId) return;
        
        // Kiểm tra đã đọc chưa
        var isRead = latestMsg.readBy && latestMsg.readBy[currentUser.id];
        if (isRead) return;
        
        _lastCheckedMsgId = latestMsg.id;
        
        // Phát âm thanh
        _playNotificationSound(latestMsg.priority || 'normal');
        
        // Kiểm tra cài đặt auto popup
        var autoPopupEnabled = true;
        try {
            var saved = localStorage.getItem(CHAT_AUTO_POPUP_KEY);
            if (saved !== null) {
                autoPopupEnabled = saved === 'true';
            }
        } catch(e) {}
        
        // Hiển thị popup tự động nếu:
        // - Popup chưa mở
        // - Auto popup được bật trong settings
        // - Tin nhắn từ admin (hoặc là urgent)
        var isFromAdmin = latestMsg.from && (latestMsg.from.role === 'admin' || latestMsg.from.role === 'master_admin' || latestMsg.from.role === 'pos_admin');
        if (autoPopupEnabled && !_chatPopupVisible && (isFromAdmin || latestMsg.priority === 'urgent')) {
            showAutoChatPopup(latestMsg);
        }
        
        // Cập nhật badge
        updateChatBadge();
    }).catch(function() {});
}

// ========== POPUP TỰ ĐỘNG ==========
function showAutoChatPopup(msg) {
    if (!msg) return;
    
    var existing = document.getElementById('autoChatPopup');
    if (existing) {
        existing.parentNode.removeChild(existing);
    }
    
    var popup = document.createElement('div');
    popup.id = 'autoChatPopup';
    popup.className = 'auto-chat-popup';
    
    var fromName = msg.from ? (msg.from.name || msg.from.id || 'Unknown') : 'Unknown';
    var isFromAdmin = msg.from && (msg.from.role === 'admin' || msg.from.role === 'master_admin' || msg.from.role === 'pos_admin');
    var priorityText = msg.priority === 'urgent' ? '🔴 URGENT' : (isFromAdmin ? '👑 Admin' : '💬 Tin nhắn mới');
    
    // Màu viền theo priority
    if (msg.priority === 'urgent') {
        popup.style.borderColor = '#ef4444';
    } else if (msg.priority === 'important') {
        popup.style.borderColor = '#f59e0b';
    } else {
        popup.style.borderColor = '#f97316';
    }
    
    popup.innerHTML = '<div class="auto-chat-header" style="background:' + (msg.priority === 'urgent' ? '#ef4444' : (msg.priority === 'important' ? '#f59e0b' : '#f97316')) + ';">' +
        '<span>' + priorityText + ' - ' + escapeHtml(fromName) + '</span>' +
        '<button class="auto-chat-close" onclick="closeAutoChatPopup()">✕</button>' +
        '</div>' +
        '<div class="auto-chat-body">' +
        '<div class="auto-chat-content">' + escapeHtml(msg.content) + '</div>' +
        '<div class="auto-chat-actions">' +
        '<button class="chat-action-btn chat-action-confirm" onclick="replyAndCloseAutoPopup(\'' + escapeJsString(msg.id) + '\', \'confirm\')">✅ Xác nhận</button>' +
        '<button class="chat-action-btn chat-action-reject" onclick="replyAndCloseAutoPopup(\'' + escapeJsString(msg.id) + '\', \'reject\')">❌ Từ chối</button>' +
        '<button class="chat-action-btn chat-action-reply" onclick="openChatAndCloseAuto(\'' + escapeJsString(msg.id) + '\')">💬 Trả lời</button>' +
        '</div>' +
        '</div>';
    
    document.body.appendChild(popup);
    
    // Tự động ẩn sau 10 giây
    setTimeout(function() {
        closeAutoChatPopup();
    }, 10000);
}

function closeAutoChatPopup() {
    var popup = document.getElementById('autoChatPopup');
    if (popup) {
        popup.parentNode.removeChild(popup);
    }
}

function replyAndCloseAutoPopup(msgId, type) {
    // Khi khóa chat: staff vẫn được xác nhận/từ chối từ auto popup
    replyToMessage(msgId, type, type === 'confirm' ? '✅ Đã xác nhận' : '❌ Từ chối');
    closeAutoChatPopup();
}

function openChatAndCloseAuto(msgId) {
    closeAutoChatPopup();
    toggleChatPopup();
    // Focus vào input reply
    setTimeout(function() {
        showReplyInput(msgId);
    }, 300);
}

// ========== SETTINGS ==========
function toggleChatSound(enabled) {
    CHAT_SOUND_ENABLED = enabled;
    try {
        localStorage.setItem(CHAT_SOUND_KEY, enabled ? 'true' : 'false');
    } catch(e) {}
    
    // Đồng bộ UI toggle trong settings nếu có
    var soundToggle = document.getElementById('chatSoundToggle');
    if (soundToggle) {
        soundToggle.checked = enabled;
    }
    var soundLabel = document.getElementById('chatSoundStatusLabel');
    if (soundLabel) {
        soundLabel.textContent = enabled ? '🔊 Đang bật' : '🔇 Đã tắt';
    }
    
    showToast(enabled ? '🔊 Đã bật âm thanh chat' : '🔇 Đã tắt âm thanh chat', 'success');
}

// Wrapper cho HTML onclick (settings gọi toggleChatSoundSetting)
function toggleChatSoundSetting(checked) {
    toggleChatSound(checked);
}

function toggleChatAutoPopup(enabled) {
    try {
        localStorage.setItem(CHAT_AUTO_POPUP_KEY, enabled ? 'true' : 'false');
    } catch(e) {}
    
    // Đồng bộ UI toggle trong settings nếu có
    var autoToggle = document.getElementById('chatAutoPopupToggle');
    if (autoToggle) {
        autoToggle.checked = enabled;
    }
    var autoLabel = document.getElementById('chatAutoPopupStatusLabel');
    if (autoLabel) {
        autoLabel.textContent = enabled ? '✅ Đang bật' : '⏸️ Đã tắt';
    }
    
    showToast(enabled ? '✅ Đã bật tự động hiện popup' : '⏸️ Đã tắt tự động hiện popup', 'success');
}

// ========== UTILITY ==========
function formatChatTime(timestamp) {
    if (!timestamp) return '';
    try {
        var d = new Date(timestamp);
        var now = new Date();
        var diff = now - d;
        
        // Trong vòng 1 phút
        if (diff < 60000) return 'Vừa xong';
        
        // Trong vòng 1 giờ
        if (diff < 3600000) {
            var mins = Math.floor(diff / 60000);
            return mins + ' phút trước';
        }
        
        // Hôm nay
        if (d.toDateString() === now.toDateString()) {
            return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        }
        
        // Hôm qua
        var yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) {
            return 'Hôm qua ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        }
        
        // Cũ hơn
        return d.toLocaleDateString('vi-VN', {
            day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    } catch(e) {
        return '';
    }
}

// Sử dụng escapeHtml từ settings.js (global) - tránh duplicate
// Đã định nghĩa trong settings.js, nếu chưa có thì fallback
if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '"')
            .replace(/'/g, '&#039;');
    };
}

function escapeJsString(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

// ========== GỬI THÔNG BÁO TELEGRAM KHI CÓ CHAT MỚI ==========
function _notifyChatToTelegram(msgData) {
    if (!msgData || !msgData.from) return;

    // Chỉ gửi Telegram nếu có cấu hình
    var token = localStorage.getItem('telegram_bot_token');
    var chatId = localStorage.getItem('telegram_chat_id');
    if (!token || !chatId) return;

    var senderName = msgData.from.name || 'Nhân viên';
    var content = msgData.content || '';
    var priority = msgData.priority || 'normal';
    var time = new Date().toLocaleString('vi-VN', {
        hour: '2-digit', minute: '2-digit',
        day: '2-digit', month: '2-digit'
    });

    var priorityIcon = priority === 'urgent' ? '🔴' : (priority === 'important' ? '🟡' : '🔵');
    var message = '<b>💬 Chat nội bộ</b>\n' +
        priorityIcon + ' <b>' + escapeHtml(senderName) + '</b>\n' +
        '📝 ' + escapeHtml(content) + '\n' +
        '🕐 ' + time;

    var url = 'https://api.telegram.org/bot' + token + '/sendMessage';
    var params = {
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
    };

    var xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onreadystatechange = function() {
        if (xhr.readyState === 4 && xhr.status !== 200) {
            console.warn('Telegram chat notify failed:', xhr.status);
        }
    };
    xhr.send(JSON.stringify(params));
}
