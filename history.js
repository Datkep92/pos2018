// history.js - Lịch sử giao dịch
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== LỊCH SỬ ==========
function renderHistoryByDate(dateObj) {
    var dateStr = dateObj.toISOString().slice(0, 10);
    document.getElementById('historyDate').innerText = formatDateDisplay(dateStr);
    
    var filter = document.getElementById('historyFilter').value;
    
    DB.getTransactionsByDate(dateStr).then(function(transactions) {
        if (filter !== 'all') {
            transactions = transactions.filter(function(t) {
                if (filter === 'dinein') return t.type === 'dinein';
                if (filter === 'takeaway') return t.type === 'takeaway';
                if (filter === 'grab') return t.type === 'grab';
                if (filter === 'cash') return t.paymentMethod === 'cash';
                if (filter === 'transfer') return t.paymentMethod === 'transfer';
                if (filter === 'debt_payment') return t.type === 'debt_payment';
                if (filter === 'cancelled') return t.refunded === true;
                return true;
            });
        }

        transactions.sort(function(a, b) {
            return new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date);
        });

        var container = document.getElementById('historyList');
        if (!container) return;

        if (transactions.length === 0) {
            container.innerHTML = '<div class="empty-state">📭 Không có giao dịch nào trong ngày</div>';
            return;
        }

        var html = '';
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            var isRefunded = tx.refunded === true;
            
            // Dòng 1: Thời gian + Thông tin bàn/khách + Phương thức
            var time = new Date(tx.createdAt || tx.date).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            
            var location = '';
            if (tx.tableName) location = '🪑 ' + escapeHtml(tx.tableName);
            else if (tx.type === 'takeaway') location = '🛵 Mang đi';
            else if (tx.type === 'grab') location = '🚕 Grab';
            else location = '🍽️ Tại chỗ';

            var method = '';
            if (isRefunded) method = '❌ Đã hủy';
            else if (tx.type === 'debt_payment') method = '💢 Ghi nợ';
            else if (tx.paymentMethod === 'cash') method = '💰 Tiền mặt';
            else if (tx.paymentMethod === 'transfer') method = '💳 CK';
            else method = '✅ Thành công';

            // Dòng 2: Nút + Số tiền
            var refundBtn = isRefunded ? '' : 
                `<button class="btn-refund" onclick="event.stopPropagation(); refundTransaction('${tx.id}')">Hoàn tác</button>`;

            html += `
                <div class="history-item ${isRefunded ? 'refunded' : ''}" onclick="showTransactionDetail('${tx.id}')">
                    <!-- DÒNG 1 -->
                    <div class="history-line1">
                        <span class="history-time">${time}</span>
                        <span class="history-location">${location}</span>
                        <span class="history-method">${method}</span>
                    </div>
                    
                    <!-- DÒNG 2 -->
                    <div class="history-line2">
                        <div class="history-actions">
                            ${refundBtn}
                            <span class="history-expand">Xem chi tiết →</span>
                        </div>
                        <div class="history-amount ${isRefunded ? 'refunded-amount' : ''}">
                            ${isRefunded ? '-' : '+'} ${formatMoney(tx.amount)}
                        </div>
                    </div>
                </div>
            `;
        }
        container.innerHTML = html;
    });
}

function showTransactionDetail(transactionId) {
    DB.get('transactions', transactionId).then(function(tx) {
        if (!tx) return;
        
        var dateStr = new Date(tx.date).toLocaleString('vi-VN');
        var typeName = { dinein: 'Tại chỗ', takeaway: 'Mang đi', grab: 'Grab', debt_payment: 'Thanh toán nợ' }[tx.type] || '';
        var paymentMethodText = '';
        if (tx.paymentMethod === 'cash') paymentMethodText = '💰 Tiền mặt';
        else if (tx.paymentMethod === 'transfer') paymentMethodText = '💳 Chuyển khoản';
        else if (tx.paymentMethod === 'debt') paymentMethodText = '💢 Ghi nợ';
        else if (tx.paymentMethod === 'grab') paymentMethodText = '🚕 Grab';
        
        var itemsHtml = '';
        if (tx.items && tx.items.length) {
            itemsHtml = '<div class="detail-items-title">📦 Danh sách món:</div>';
            for (var i = 0; i < tx.items.length; i++) {
                var item = tx.items[i];
                itemsHtml += '<div class="detail-item-row"><span>' + escapeHtml(item.name) + ' x' + item.qty + '</span><span>' + formatMoney(item.price * item.qty) + '</span></div>';
            }
        } else {
            itemsHtml = '<div class="empty-text">Không có món</div>';
        }
        
        var refundInfo = '';
        if (tx.refunded) {
            refundInfo = '<div class="refund-info">❌ Đã hủy lúc: ' + new Date(tx.refundedAt).toLocaleString('vi-VN') + '<br>📝 Lý do: ' + escapeHtml(tx.refundReason || '') + '</div>';
        }
        
        var html = 
            '<div class="detail-section">' +
                '<div class="detail-row"><span>🕒 Thời gian:</span><span>' + dateStr + '</span></div>' +
                '<div class="detail-row"><span>🍽️ Loại:</span><span>' + typeName + '</span></div>' +
                '<div class="detail-row"><span>💳 Thanh toán:</span><span>' + paymentMethodText + '</span></div>' +
                (tx.tableName ? '<div class="detail-row"><span>🪑 Bàn:</span><span>' + escapeHtml(tx.tableName) + '</span></div>' : '') +
                (tx.customer ? '<div class="detail-row"><span>👤 Khách:</span><span>' + escapeHtml(tx.customer.name) + '</span></div>' : '') +
                '<div class="detail-row"><span>💰 Tổng tiền:</span><span class="detail-amount">' + formatMoney(tx.amount) + '</span></div>' +
                (tx.note ? '<div class="detail-row"><span>📝 Ghi chú:</span><span>' + escapeHtml(tx.note) + '</span></div>' : '') +
                refundInfo +
            '</div>' +
            '<div class="detail-section">' + itemsHtml + '</div>';
        
        document.getElementById('transactionDetailBody').innerHTML = html;
        document.getElementById('transactionDetailModal').style.display = 'flex';
    });
}

function refundTransaction(transactionId) {
    var reason = prompt('📝 Lý do hủy?');
    if (!reason) return;
    DB.get('transactions', transactionId).then(function(trans) {
        if (!trans || trans.refunded) return;
        restoreIngredients(trans.items).then(function() {
            if (trans.type === 'debt_payment' && trans.customer) {
                addCustomerDebt(trans.customer.id, trans.amount, 'Hoàn tiền - ' + reason);
            }
            trans.refunded = true;
            trans.refundReason = reason;
            trans.refundedAt = Date.now();
            DB.update('transactions', transactionId, trans).then(function() {
                showToast('✅ Đã hủy giao dịch', 'success');
                // Cập nhật lại lịch sử và báo cáo
                if (currentTab === 'history') {
                    renderHistoryByDate(currentHistoryDate);
                }
                if (currentTab === 'report') {
                    renderReport(currentReportDate);
                }
            });
        });
    });
}

function changeHistoryDate(delta) { var nd = new Date(currentHistoryDate); nd.setDate(nd.getDate() + delta); currentHistoryDate = nd; renderHistoryByDate(currentHistoryDate); }

// ========== THÊM GIAO DỊCH ==========
function addHistory(transaction) {
    var newTrans = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        dateKey: new Date().toISOString().slice(0, 10),
        type: transaction.type,
        amount: transaction.amount,
        paymentMethod: transaction.paymentMethod,
        items: transaction.items || [],
        customer: transaction.customer || null,
        tableName: transaction.tableName || null,
        note: transaction.note || '',
        refunded: false
    };
    return DB.create('transactions', newTrans).then(function() {
        // KHÔNG gọi render trực tiếp nữa, để realtime subscription tự cập nhật
    });
}

// Export global
window.refundTransaction = refundTransaction;