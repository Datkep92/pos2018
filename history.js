// ========== LỊCH SỬ GIAO DỊCH ==========
let historyData = [];
let currentDisplayDate = new Date(); // KHỞI TẠO NGAY
let historyRenderTimer;
let historyRenderedCount = 0;
const HISTORY_BATCH_SIZE = 60;
// Khởi tạo: load dữ liệu từ DB
async function initHistory() {
    // Đảm bảo currentDisplayDate là ngày hợp lệ
    if (!currentDisplayDate || isNaN(currentDisplayDate.getTime())) {
        currentDisplayDate = new Date();
    }
    await renderHistoryByDate(currentDisplayDate);
}
async function migrateOldTransactions() {
    var transactions = await DB.getAll('transactions');
    var needUpdate = false;
    for (var i = 0; i < transactions.length; i++) {
        var tx = transactions[i];
        if (tx.refunded === undefined) {
            tx.refunded = false;
            tx.refundReason = null;
            tx.refundedAt = null;
            tx.refundTransactionId = null;
            await DB.update('transactions', tx.id, tx);
            needUpdate = true;
        }
    }
    if (needUpdate) console.log('✅ Đã cập nhật cấu trúc cho giao dịch cũ');
}
window.migrateOldTransactions = migrateOldTransactions;
function debouncedRenderHistory() {
    if (historyRenderTimer) clearTimeout(historyRenderTimer);
    historyRenderTimer = setTimeout(async () => {
        await renderHistoryByDate(currentDisplayDate);
    }, 80);
}

async function refundTransaction(transactionId, reason) {
    const trans = await DB.get('transactions', transactionId);
    if (!trans) {
        showToast('Không tìm thấy giao dịch!', 'error');
        return false;
    }
    if (trans.type === 'refund') {
        showToast('Không thể hủy giao dịch hoàn tiền!', 'warning');
        return false;
    }
    if (trans.refunded) {
        showToast('Giao dịch này đã bị hủy trước đó!', 'warning');
        return false;
    }
    if (!reason || reason.trim() === '') {
        reason = 'Khách yêu cầu hoàn tiền';
    }

    // 1. Khôi phục nguyên liệu
    if ((trans.type === 'dinein' || trans.type === 'takeaway' || trans.type === 'grab') && trans.items && trans.items.length) {
        if (typeof window.restoreIngredients === 'function') {
            await window.restoreIngredients(trans.items);
        } else {
            console.warn('restoreIngredients not found');
        }
    }

    // 2. Xử lý công nợ (nếu là debt_payment)
    if (trans.type === 'debt_payment' && trans.customer && trans.customer.id) {
        const customer = window.customers.find(c => c.id === trans.customer.id);
        if (customer && typeof window.updateCustomerDebt === 'function') {
            await window.updateCustomerDebt(customer.id, trans.amount, 'add_debt', `Hoàn tiền hủy giao dịch ${transactionId} - ${reason}`);
        } else if (customer && typeof window.addCustomerDebt === 'function') {
            await window.addCustomerDebt(customer.id, trans.amount, `Hoàn tiền hủy giao dịch ${transactionId} - ${reason}`);
        }
    }

    // 3. Đánh dấu giao dịch cũ đã hủy (KHÔNG tạo refund)
    trans.refunded = true;
    trans.refundReason = reason;
    trans.refundedAt = Date.now();
    // trans.refundTransactionId = null; // không còn
    await DB.update('transactions', transactionId, trans);

    // 4. Cập nhật các view
    if (typeof window.renderReport === 'function') window.renderReport();
    if (typeof window.renderCustomerList === 'function') window.renderCustomerList();
    if (typeof window.renderDebtList === 'function') window.renderDebtList();
    if (typeof window.renderIngredients === 'function') window.renderIngredients();

    const historyView = document.getElementById('historyView');
    if (historyView && historyView.classList.contains('active')) {
        await renderHistoryByDate(currentDisplayDate);
    }

    showToast(`✅ Đã hủy giao dịch ${formatMoney(trans.amount)} và hoàn trả`, 'success');
    return true;
}

// Hoàn trả nguyên liệu khi hủy giao dịch (hỗ trợ món có size)
async function restoreIngredients(orderItems) {
    if (!orderItems || orderItems.length === 0) return;
    rebuildIngredientLookupMaps();
    const updates = [];
    for (let i = 0; i < orderItems.length; i++) {
        const orderItem = orderItems[i];
        // Lấy tên gốc: bỏ phần (size) nếu có
        let originalName = orderItem.name;
        const lastParen = originalName.lastIndexOf('(');
        if (lastParen !== -1 && originalName.indexOf(')') === originalName.length - 1) {
            originalName = originalName.substring(0, lastParen).trim();
        }
        const menuItem = menuByNameMap.get(String(originalName));
        if (menuItem && menuItem.ingredients && menuItem.ingredients.length) {
            for (let j = 0; j < menuItem.ingredients.length; j++) {
                const req = menuItem.ingredients[j];
                const ing = ingredientByIdMap.get(String(req.ingredientId));
                if (ing) {
                    ing.stock += (req.quantity * orderItem.qty);
                    updates.push(DB.update('ingredients', ing.id, { stock: ing.stock }));
                }
            }
        } else {
            console.warn('Không tìm thấy món để hoàn nguyên liệu:', orderItem.name);
        }
        // Yield nhẹ sau mỗi 20 item để tránh block
        if (i % 20 === 19) await new Promise(resolve => setTimeout(resolve, 0));
    }
    // Thực thi batch
    for (let i = 0; i < updates.length; i += 5) {
        await Promise.all(updates.slice(i, i + 5));
    }
    window.ingredients = ingredients;
    if (typeof renderIngredients === 'function') renderIngredients();
}
// Thêm giao dịch mới
async function addHistory(transaction) {
    const newTrans = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        type: transaction.type,          // 'dinein', 'takeaway', 'debt_payment'
        amount: transaction.amount,
        paymentMethod: transaction.paymentMethod || 'cash',
        items: transaction.items || [],
        customer: transaction.customer || null,
        tableName: transaction.tableName || null,
        note: transaction.note || '',
        // === Các trường mới cho refund ===
        refunded: false,                 // đã bị hủy chưa
        refundReason: null,
        refundedAt: null,
        refundTransactionId: null        // ID của giao dịch hoàn tiền tương ứng
    };
    await DB.create('transactions', newTrans);
    // Nếu đang ở tab lịch sử và ngày hiển thị là hôm nay, cập nhật lại
    const todayStr = new Date().toISOString().slice(0,10);
    const currentDateStr = currentDisplayDate.toISOString().slice(0,10);
    const historyView = document.getElementById('historyView');
    if (currentDateStr === todayStr && historyView && historyView.classList.contains('active')) {
        debouncedRenderHistory();
    }
}

// Hiển thị lịch sử theo ngày (chuỗi YYYY-MM-DD)
async function renderHistoryByDate(dateObj) {
    // Kiểm tra dateObj hợp lệ
    if (!dateObj || isNaN(dateObj.getTime())) {
        dateObj = new Date();
    }
    const dateStr = dateObj.toISOString().slice(0,10);
    // Cập nhật hiển thị ngày trên giao diện
    const dateSpan = document.getElementById('historyDate');
    if (dateSpan) {
        const [year, month, day] = dateStr.split('-');
        dateSpan.innerText = `${day}/${month}/${year}`;
    }

    const historyFilter = document.getElementById('historyFilter');
    const filterValue = historyFilter && historyFilter.value ? historyFilter.value : 'all';

    // Query theo index ngày/type để tránh getAll + filter toàn bộ.
    let filtered = [];
    if (filterValue === 'all' || filterValue === 'cash' || filterValue === 'transfer' || filterValue === 'paid' || filterValue === 'debt') {
        filtered = await DB.getTransactionsByDate(dateStr);
    } else {
        filtered = await DB.getTransactionsByDate(dateStr, { type: filterValue });
    }
    
    if (filterValue !== 'all') {
    if (filterValue === 'cash') {
        filtered = filtered.filter(h => h.paymentMethod === 'cash');
    } else if (filterValue === 'transfer') {
        filtered = filtered.filter(h => h.paymentMethod === 'transfer');
    } else if (filterValue === 'paid') {
        filtered = filtered.filter(h => h.type === 'dinein' || h.type === 'takeaway' || h.type === 'grab');
    } else if (filterValue === 'debt') {
        filtered = filtered.filter(h => h.type === 'debt_payment');
    } else if (filterValue === 'grab') {
        filtered = filtered.filter(h => h.type === 'grab');
    } else {
        filtered = filtered.filter(h => h.type === filterValue);
    }
}
    
    // Sắp xếp theo thời gian giảm dần (mới nhất trước)
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    historyData = filtered;
    window.historyData = historyData;
    
    const container = document.getElementById('historyList');
    if (!container) return;
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">📭 Không có giao dịch trong ngày này</div>';
        return;
    }
    historyRenderedCount = Math.min(HISTORY_BATCH_SIZE, filtered.length);
    renderHistoryBatched(container, filtered, historyRenderedCount);
}

function renderHistoryBatched(container, filtered, visibleCount) {
    var html = '';
    for (var i = 0; i < visibleCount; i++) {
        var h = filtered[i];
        
        // Tính tổng số lượng món
        var totalItems = 0;
        if (h.items) {
            for (var j = 0; j < h.items.length; j++) {
                totalItems += h.items[j].qty;
            }
        }
        
        var isRefunded = h.refunded === true;
        var refundBadge = isRefunded ? '<span class="badge-refunded">🔄 Đã hủy</span>' : '';
        
        // Chỉ hiển thị nút Hủy nếu chưa bị hủy và không phải giao dịch hoàn tiền
        var refundButton = '';
        if (!isRefunded && h.type !== 'refund') {
            var safeId = h.id.replace(/'/g, "\\'");
            refundButton = '<button class="btn-refund-small" data-id="' + safeId + '" onclick="event.stopPropagation(); refundTransactionWithPrompt(\'' + safeId + '\')">✅ Hoàn thành</button>';
        }
        
        var dateStr = new Date(h.date).toLocaleTimeString('vi-VN');
        var amountClass = (h.type === 'debt_payment') ? 'text-success' : '';
        var amountSign = (h.type === 'debt_payment') ? '+' : '-';
        var formattedAmount = formatMoney(h.amount);
        
        var typeText = '';
        if (h.type === 'takeaway') typeText = '🛵 Mang đi';
        else if (h.type === 'dinein') typeText = '🍽️ Tại chỗ';
        else if (h.type === 'grab') typeText = '🚕 Grab';
        else if (h.type === 'debt_payment') typeText = '💰 Thanh toán nợ';
        else if (h.type === 'refund') typeText = '🔄 Hoàn tiền';
        else typeText = '📝 Khác';
        
        // Sửa paymentText: nếu là grab thì hiển thị Grab, không hiển thị tiền mặt/chuyển khoản
        var paymentText = '';
        if (h.type === 'grab') {
            paymentText = '🚕 Grab';
        } else if (h.paymentMethod === 'cash') {
            paymentText = '💰 Tiền mặt';
        } else {
            paymentText = '💳 Chuyển khoản';
        }
        
        // Tạo thông tin bàn/khách để hiển thị trên dòng đầu
        var tableInfo = '';
        if (h.tableName) {
            if (h.customer && h.customer.name) {
                tableInfo = '👤 ' + escapeHtml(h.customer.name);
            } else {
                tableInfo = '🪑 ' + h.tableName;
            }
        } else if (h.customer && !h.tableName) {
            tableInfo = '👤 ' + escapeHtml(h.customer.name);
        }
        
        // Dòng đầu: Giờ + bàn/khách + số tiền + badge
        var headerHtml = '<div class="history-header-row">' +
            '<span class="history-time">' + dateStr + '</span>' +
            (tableInfo ? '<span class="history-table">' + tableInfo + '</span>' : '') +
            '<span class="history-amount ' + amountClass + '">' + amountSign + formattedAmount + '</span>' +
            refundBadge +
        '</div>';
        
        // Dòng thông tin chính: loại hình + số lượng món + phương thức thanh toán + nút
        var infoHtml = '<div class="history-info-row">' +
            '<span class="history-type">' + typeText + '</span>' +
            '<span class="history-qty">📦 SL: ' + totalItems + '</span>' +
            '<span class="history-payment">' + paymentText + '</span>' +
            (refundButton ? '<span class="history-action">' + refundButton + '</span>' : '') +
        '</div>';
        
        // Chi tiết món và lý do hủy
        var detailHtml = '';
        if (h.items && h.items.length) {
            var itemsStr = '';
            for (var k = 0; k < h.items.length; k++) {
                if (k > 0) itemsStr += ', ';
                itemsStr += h.items[k].name + ' x' + h.items[k].qty;
            }
            detailHtml += '<div class="history-detail">📋 ' + itemsStr + '</div>';
        }
        if (isRefunded && h.refundReason) {
            detailHtml += '<div class="history-detail refund-reason">📝 Lý do: ' + escapeHtml(h.refundReason) + '</div>';
        }
        
        html += '<div class="history-item ' + h.type + (isRefunded ? ' refunded' : '') + '">' +
            headerHtml +
            infoHtml +
            detailHtml +
        '</div>';
    }
    
    var hasMore = visibleCount < filtered.length;
    var loadMoreBtnHtml = hasMore ? '<button id="historyLoadMoreBtn" class="btn-primary" style="width:100%; margin-top:8px;">Xem thêm</button>' : '';
    container.innerHTML = html + loadMoreBtnHtml;
    
    if (hasMore) {
        var loadMoreBtn = document.getElementById('historyLoadMoreBtn');
        if (loadMoreBtn) {
            loadMoreBtn.onclick = function() {
                historyRenderedCount = Math.min(historyRenderedCount + HISTORY_BATCH_SIZE, filtered.length);
                renderHistoryBatched(container, filtered, historyRenderedCount);
            };
        }
    }
}

function changeDisplayDate(delta) {
    const newDate = new Date(currentDisplayDate);
    newDate.setDate(newDate.getDate() + delta);
    currentDisplayDate = newDate;
    debouncedRenderHistory();
}

// Xuất dữ liệu lịch sử (toàn bộ, không lọc theo ngày)
function exportHistory() {
    const content = historyData.map(h => `${new Date(h.date).toLocaleString()}\t${h.type}\t${h.amount}\t${h.paymentMethod}`).join('\n');
    const blob = new Blob([content], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `lichsu_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    showToast('✅ Đã xuất lịch sử', 'success');
}

document.addEventListener('DOMContentLoaded', function() {
    var prevBtn = document.getElementById('prevDay');
    var nextBtn = document.getElementById('nextDay');
    var filterSelect = document.getElementById('historyFilter');
    if (prevBtn) prevBtn.addEventListener('click', function() { changeDisplayDate(-1); });
    if (nextBtn) nextBtn.addEventListener('click', function() { changeDisplayDate(1); });
    if (filterSelect) filterSelect.addEventListener('change', function() { debouncedRenderHistory(); });
});
async function refundTransactionWithPrompt(transactionId) {
    const reason = prompt('Nhập lý do hủy giao dịch (bắt buộc):', 'Khách yêu cầu hoàn tiền');
    if (reason === null) return;
    if (reason.trim() === '') {
        showToast('Vui lòng nhập lý do!', 'warning');
        return;
    }
    if (confirm(`Bạn có chắc chắn muốn HỦY giao dịch này không?\nSố tiền sẽ được hoàn trả, nguyên liệu sẽ khôi phục.`)) {
        await refundTransaction(transactionId, reason);
    }
}
window.refundTransactionWithPrompt = refundTransactionWithPrompt;
// Export các hàm ra window
window.initHistory = initHistory;
window.addHistory = addHistory;
window.renderHistory = renderHistoryByDate; // giữ tên cũ để tương thích
window.exportHistory = exportHistory;
window.refundTransaction = refundTransaction;
window.updateCustomerDebt = updateCustomerDebt;
