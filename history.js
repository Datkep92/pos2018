// ========== LỊCH SỬ GIAO DỊCH ==========
let historyData = [];
let currentDisplayDate = new Date(); // KHỞI TẠO NGAY
let historyRenderTimer;
// Khởi tạo: load dữ liệu từ DB
async function initHistory() {
    historyData = await DB.getAll('transactions') || [];
    historyData.sort((a, b) => new Date(b.date) - new Date(a.date));
    window.historyData = historyData;
    // Đảm bảo currentDisplayDate là ngày hợp lệ
    if (!currentDisplayDate || isNaN(currentDisplayDate.getTime())) {
        currentDisplayDate = new Date();
    }
    renderHistoryByDate(currentDisplayDate);
    console.log(`✅ Đã tải ${historyData.length} giao dịch`);
}
function debouncedRenderHistory() {
    if (historyRenderTimer) clearTimeout(historyRenderTimer);
    historyRenderTimer = setTimeout(() => {
        renderHistoryByDate(currentDisplayDate);
    }, 80);
}
// Thêm giao dịch mới
async function addHistory(transaction) {
    const newTrans = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        type: transaction.type,
        amount: transaction.amount,
        paymentMethod: transaction.paymentMethod || 'cash',
        items: transaction.items || [],
        customer: transaction.customer || null,
        tableName: transaction.tableName || null,
        note: transaction.note || ''
    };
    await DB.create('transactions', newTrans);
    historyData.unshift(newTrans);
    if (historyData.length > 500) historyData.pop();
    window.historyData = historyData;
    // Nếu đang ở tab lịch sử và ngày hiển thị là hôm nay, cập nhật lại
    const todayStr = new Date().toISOString().slice(0,10);
    const currentDateStr = currentDisplayDate.toISOString().slice(0,10);
    const historyView = document.getElementById('historyView');
    if (currentDateStr === todayStr && historyView && historyView.classList.contains('active')) {
    debouncedRenderHistory();
}
}

// Hiển thị lịch sử theo ngày (chuỗi YYYY-MM-DD)
function renderHistoryByDate(dateObj) {
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

    // Lọc giao dịch theo ngày
    let filtered = historyData.filter(h => h.date && h.date.slice(0,10) === dateStr);
    
    // Lọc theo select
    const historyFilter = document.getElementById('historyFilter');
    const filterValue = historyFilter && historyFilter.value ? historyFilter.value : 'all';
    if (filterValue !== 'all') {
        if (filterValue === 'cash') {
            filtered = filtered.filter(h => h.paymentMethod === 'cash');
        } else if (filterValue === 'transfer') {
            filtered = filtered.filter(h => h.paymentMethod === 'transfer');
        } else if (filterValue === 'paid') {
            filtered = filtered.filter(h => h.type === 'dinein' || h.type === 'takeaway');
        } else if (filterValue === 'debt') {
            filtered = filtered.filter(h => h.type === 'debt_payment');
        } else {
            filtered = filtered.filter(h => h.type === filterValue);
        }
    }
    
    // Sắp xếp theo thời gian giảm dần (mới nhất trước)
    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    const container = document.getElementById('historyList');
    if (!container) return;
    if (filtered.length === 0) {
        container.innerHTML = '<div class="empty-state">📭 Không có giao dịch trong ngày này</div>';
        return;
    }
    // Hiển thị danh sách kèm STT và số lượng món
    container.innerHTML = filtered.map((h, index) => {
        const stt = index + 1;
        const totalItems = h.items ? h.items.reduce((sum, item) => sum + item.qty, 0) : 0;
        return `
            <div class="history-item ${h.type}">
                <div class="history-header-row">
                    <span>${stt}. ${new Date(h.date).toLocaleTimeString('vi-VN')}</span>
                    <span class="history-amount ${h.type === 'debt_payment' ? 'text-success' : ''}">${h.type === 'debt_payment' ? '+' : '-'}${formatMoney(h.amount)}</span>
                </div>
                <div class="history-header-row">
                    <span>${h.type === 'takeaway' ? '🛵 Mang đi' : (h.type === 'dinein' ? '🍽️ Tại chỗ' : '💰 Thanh toán nợ')}</span>
                    <span>${h.paymentMethod === 'cash' ? '💰 Tiền mặt' : '💳 Chuyển khoản'}</span>
                </div>
                ${totalItems > 0 ? `<div class="history-detail">📦 Số lượng: ${totalItems} món</div>` : ''}
                ${h.tableName ? `<div class="history-detail">📌 ${h.customer && h.customer.name ? `👤 ${h.customer.name}` : `🪑 ${h.tableName}`}</div>` : ''}
                ${h.customer && !h.tableName ? `<div class="history-detail">👤 ${h.customer.name}</div>` : ''}
                ${h.items && h.items.length ? `<div class="history-detail">📋 ${h.items.map(i => `${i.name} x${i.qty}`).join(', ')}</div>` : ''}
            </div>
        `;
    }).join('');
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

document.addEventListener('DOMContentLoaded', () => {
    const prevBtn = document.getElementById('prevDay');
    const nextBtn = document.getElementById('nextDay');
    const filterSelect = document.getElementById('historyFilter');
    if (prevBtn) prevBtn.addEventListener('click', () => changeDisplayDate(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => changeDisplayDate(1));
    if (filterSelect) filterSelect.addEventListener('change', () => debouncedRenderHistory());
});

// Export các hàm ra window
window.initHistory = initHistory;
window.addHistory = addHistory;
window.renderHistory = renderHistoryByDate; // giữ tên cũ để tương thích
window.exportHistory = exportHistory;