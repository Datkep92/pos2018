// messages.js - Chat nội bộ POS
// ES5, tương thích Android 6, iOS 12
// Collection Firebase: /{shopId}/messages/
// Cho phép admin gửi thông báo, staff trả lời/xác nhận/từ chối

// ========== BIẾN GLOBAL ==========
var CHAT_SOUND_ENABLED = true;
var CHAT_SOUND_KEY = 'chat_sound_enabled';
var _chatPopupVisible = false;
var _lastMessageCount = 0;
var _chatInitialized = false;

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
    
    console.log('💬 Chat initialized');
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
        var isAdmin = currentUser && currentUser.role === 'admin';
        
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
    var roleIcon = (fromRole === 'admin') ? '👑 ' : '👤 ';
    
    // Header
    var html = '<div class="chat-message ' + priorityClass + '" data-msg-id="' + escapeHtml(msg.id) + '">';
    html += '<div class="chat-msg-header">';
    html += '<span class="chat-msg-from">' + roleIcon + escapeHtml(fromName) + '</span>';
    html += '<span class="chat-msg-time">' + priorityIcon + timeStr + '</span>';
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
    
    var content = input.value.trim();
    if (!content) {
        showToast('Vui lòng nhập nội dung tin nhắn!', 'warning');
        return;
    }
    
    var currentUser = DB.getCurrentUser();
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
    }).catch(function(err) {
        showToast('❌ Lỗi gửi tin nhắn: ' + (err.message || 'unknown'), 'error');
    });
}

// ========== TRẢ LỜI / XÁC NHẬN / TỪ CHỐI ==========
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
    return DB.getAll('messages').then(function(messages) {
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
    });
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
        
        // Nếu là urgent và popup chưa mở, hiển thị popup tự động
        if (latestMsg.priority === 'urgent' && !_chatPopupVisible) {
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
    var priorityText = msg.priority === 'urgent' ? '🔴 URGENT' : '💬 Tin nhắn mới';
    
    popup.innerHTML = '<div class="auto-chat-header">' +
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

function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, '&#039;');
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
