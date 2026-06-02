// ========== BIẾN TOÀN CỤC ==========
let currentContext = null;
let tempOrder = [];
let currentSelectedCustomer = null;
let currentTableView = 'dining';
let dbUpdateTimer = null;
let lastTablesFetch = 0;
const TABLES_CACHE_TTL = 2000;
let cachedTables = null;  // <-- THÊM DÒNG NÀY

// ========== UTILS ==========
function formatMoney(amount) {
    return (amount || 0).toLocaleString('vi-VN') + 'đ';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}
async function getTablesWithCache(force = false) {
    const now = Date.now();
    if (!force && cachedTables && (now - lastTablesFetch) < TABLES_CACHE_TTL) {
        return cachedTables;
    }
    cachedTables = await DB.getAll('tables');
    lastTablesFetch = now;
    return cachedTables;
}
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) { console.log(message); return; }
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'} ${message}`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

function refreshCustomerList() {} // Giữ để tránh lỗi

async function checkDataFreshness() {
    const now = Date.now();
    const ONE_HOUR = 3600000;
    const ONE_DAY = 86400000;
    
    let hasStaleData = false;
    let staledItems = [];
    
    const collections = ['tables', 'customers', 'menu', 'ingredients', 'transactions'];
    for (const col of collections) {
        try {
            const items = await DB.getAll(col);
            for (const item of items) {
                const itemAge = now - (item.updatedAt || item.createdAt || now);
                if (itemAge > ONE_DAY) {
                    hasStaleData = true;
                    staledItems.push({ col, id: item.id, ageHours: Math.floor(itemAge / ONE_HOUR) });
                }
            }
        } catch (err) {
            console.log(`Lỗi check freshness ${col}:`, err);
        }
    }
    
    if (hasStaleData) {
        const msg = `⚠️ Dữ liệu cũ (${staledItems.length} item > 24h). ${DB.isOnline() ? 'Đang đồng bộ...' : 'Offline - dùng data cũ.'}`;
        console.warn(msg);
        showToast(msg, 'warning');
    }
}

async function renderTables() {
    console.log('🔄 renderTables called');
    const grid = document.getElementById('tablesGrid');
    if (!grid) return;
    let tables = await getTablesWithCache();
    console.log('📊 Số bàn trong DB:', tables.length);
    
    let activeTables = tables.filter(t => 
        (t.items && t.items.length > 0) || 
        (t.total > 0) || 
        t.status === 'debt'
    );
    
    if (activeTables.length === 0) {
        grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🍽️</div><div>Không có bàn nào đang phục vụ</div><button class="btn-add-table" onclick="document.getElementById('floatNewtableBtn').click()">+ Tạo bàn mới</button></div>`;
        return;
    }
    
    grid.innerHTML = activeTables.map(table => {
        const itemCount = (table.items || []).reduce((s, i) => s + (i.qty || 0), 0);
        const total = table.total || 0;
        const displayName = table.customerName || table.name;
        const hasCustomer = !!table.customerName;
        let timeDisplay = table.time || '--:--';
        if (table.startTime) {
            const start = new Date(table.startTime);
            const startStr = start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const diffMins = Math.floor((Date.now() - start) / 60000);
            const diffHours = Math.floor(diffMins / 60);
            const diffMinutes = diffMins % 60;
            timeDisplay = `${startStr} - ${diffHours > 0 ? `${diffHours}h${diffMinutes}p` : `${diffMins}p`}`;
        }
        const assignHandler = `showCustomerSelectorForTable('${table.id}')`;
        return `
            <div class="table-card occupied" onclick="showTableDetail('${table.id}')">
                <div class="table-top-row">
                    <div class="table-name-section">
                        <span class="table-name" style="cursor:pointer;" onclick="event.stopPropagation(); ${assignHandler}">
                            ${hasCustomer ? '' : ''} ${escapeHtml(displayName)}
                        </span>
                    </div>
                    <span class="table-time">⏱️ ${timeDisplay}</span>
                </div>
                <div class="table-stats">
                    <div class="table-item-count">📦 <span>${itemCount}</span> món</div>
                    <div class="table-total">${formatMoney(total)}</div>
                </div>
                <div class="table-icons">
                    <div class="table-icon-btn" onclick="event.stopPropagation(); openAddMenuForTable('${table.id}')">➕</div>
                    <div class="table-icon-btn" onclick="event.stopPropagation(); showPaymentMethod('dinein', '${table.id}', ${total})">💸</div>
                    <div class="table-icon-btn" onclick="event.stopPropagation(); debtTable('${table.id}')">💢</div>
                </div>
            </div>
        `;
    }).join('');
    
    const diningCount = document.getElementById('diningCount');
    if (diningCount) diningCount.innerText = activeTables.length;
}
async function showTableDetail(tableId) {
    const tid = String(tableId);
    let table = await DB.get('tables', tid);
    if (!table) {
        const all = await DB.getAll('tables');
        table = all.find(t => String(t.id) === tid);
    }
    if (!table) { showToast('Không tìm thấy bàn!', 'error'); return; }
    
    document.getElementById('detailTableName').innerHTML = `🪑 ${table.name}${table.customerName ? ` (${escapeHtml(table.customerName)})` : ''}`;
    document.getElementById('detailTime').innerHTML = `⏱️ ${table.time || '--:--'}`;
    
    const itemsContainer = document.getElementById('detailItemsList');
    let totalItems = 0;
    let totalAmount = 0;
    if (!table.items || table.items.length === 0) {
        itemsContainer.innerHTML = '<div class="empty-state" style="padding:20px; text-align:center;">✨ Chưa có món</div>';
    } else {
        itemsContainer.innerHTML = table.items.map((item, idx) => {
    totalItems += item.qty;
    totalAmount += item.price * item.qty;
    const timeStr = item.addedTime ? new Date(item.addedTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
    return `
        <div class="detail-item-row" data-item-idx="${idx}">
            <div class="detail-item-info">
                <div class="detail-item-name">${escapeHtml(item.name)}</div>
                <div class="detail-item-price">${formatMoney(item.price)}đ</div>
                ${timeStr ? `<div class="detail-item-time" style="font-size:10px; color:#888;">🕒 ${timeStr}</div>` : ''}
            </div>
            <div class="detail-item-controls">
                <button class="btn-qty" onclick="updateItemQuantity('${table.id}', ${idx}, -1)">-</button>
                <span id="qty-${idx}" style="min-width: 30px; text-align:center;">${item.qty}</span>
                <button class="btn-qty" onclick="updateItemQuantity('${table.id}', ${idx}, 1)">+</button>
            </div>
            <div class="detail-item-total">${formatMoney(item.price * item.qty)}</div>
        </div>
    `;
}).join('');
    }
    document.getElementById('detailTotalCount').innerText = totalItems;
    document.getElementById('detailTotalAmount').innerHTML = formatMoney(totalAmount);
    
    currentContext = { type: 'detailView', tableId: table.id };
    document.getElementById('tableDetailModal').style.display = 'flex';
    
    // Nút thêm món
    document.getElementById('detailAddItemBtn').onclick = () => { closeModal('tableDetailModal'); openAddMenuForTable(table.id); };
    
    // Nút thanh toán trực tiếp (bỏ qua popup trung gian)
    document.getElementById('detailPayCashBtn').onclick = async () => {
        const tbl = await DB.get('tables', table.id);
        if (tbl && (tbl.total || 0) > 0) {
            closeModal('tableDetailModal');
            await processPaymentDirect('dinein', table.id, tbl.total, 'cash');
        } else showToast('Không có món để thanh toán!', 'warning');
    };
    document.getElementById('detailPayTransferBtn').onclick = async () => {
        const tbl = await DB.get('tables', table.id);
        if (tbl && (tbl.total || 0) > 0) {
            closeModal('tableDetailModal');
            await processPaymentDirect('dinein', table.id, tbl.total, 'transfer');
        } else showToast('Không có món để thanh toán!', 'warning');
    };
    
    // Các nút chức năng khác
    document.getElementById('detailDebtBtn').onclick = () => { closeModal('tableDetailModal'); debtTable(table.id); };
    document.getElementById('detailSplitBillBtn').onclick = () => showSplitBillModal(table.id);
    document.getElementById('detailTransferBtn').onclick = () => showTransferTableModal(table.id);
    document.getElementById('detailMergeBtn').onclick = () => showMergeTableModal(table.id);
}

async function updateItemQuantity(tableId, itemIndex, delta) {
    const tid = String(tableId);
    let table = await DB.get('tables', tid);
    if (!table) return;
    var items = table.items ? table.items.slice() : [];
    if (itemIndex < 0 || itemIndex >= items.length) return;
    const newQty = items[itemIndex].qty + delta;
    if (newQty <= 0) {
        items.splice(itemIndex, 1);
    } else {
        items[itemIndex].qty = newQty;
    }
    const newTotal = items.reduce((sum, i) => sum + (i.price * i.qty), 0);
    await DB.update('tables', tid, { items: items, total: newTotal });
    
    cachedTables = null;
    
    const detailModal = document.getElementById('tableDetailModal');
    if (detailModal && detailModal.style.display === 'flex' && currentContext && currentContext.tableId === tid) {
        await refreshTableDetailContent(tid);
    }
    await renderTables();
    showToast('Đã cập nhật món', 'success');
}


async function refreshTableDetailContent(tableId) {
    const table = await DB.get('tables', String(tableId));
    if (!table) return;
    const itemsContainer = document.getElementById('detailItemsList');
    let totalItems = 0;
    let totalAmount = 0;
    if (!table.items || table.items.length === 0) {
        itemsContainer.innerHTML = '<div class="empty-state" style="padding:20px; text-align:center;">✨ Chưa có món</div>';
    } else {
        itemsContainer.innerHTML = table.items.map((item, idx) => {
            totalItems += item.qty;
            totalAmount += item.price * item.qty;
            const timeStr = item.addedTime ? new Date(item.addedTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
            return `
                <div class="detail-item-row" data-item-idx="${idx}">
                    <div class="detail-item-info">
                        <div class="detail-item-name">${escapeHtml(item.name)}</div>
                        <div class="detail-item-price">${formatMoney(item.price)}đ</div>
                        ${timeStr ? `<div class="detail-item-time" style="font-size:10px; color:#888;">🕒 ${timeStr}</div>` : ''}
                    </div>
                    <div class="detail-item-controls">
                        <button class="btn-qty" onclick="updateItemQuantity('${table.id}', ${idx}, -1)">-</button>
                        <span id="qty-${idx}" style="min-width:30px; text-align:center;">${item.qty}</span>
                        <button class="btn-qty" onclick="updateItemQuantity('${table.id}', ${idx}, 1)">+</button>
                    </div>
                    <div class="detail-item-total">${formatMoney(item.price * item.qty)}</div>
                </div>
            `;
        }).join('');
    }
    document.getElementById('detailTotalCount').innerText = totalItems;
    document.getElementById('detailTotalAmount').innerHTML = formatMoney(totalAmount);
}
async function deleteItemFromTable(tableId, itemIndex) {
    if (confirm('Xóa món này?')) {
        await updateItemQuantity(tableId, itemIndex, -999);
    }
}

async function showTransferTableModal(tableId) {
    const tid = String(tableId);
    let sourceTable = await DB.get('tables', tid);
    if (!sourceTable) {
        showToast('Bàn nguồn không tồn tại!', 'error');
        return;
    }
    if (!sourceTable.items || sourceTable.items.length === 0) {
        showToast('Bàn không có món để chuyển', 'warning');
        return;
    }

    // Tạo bàn mới với số thứ tự tự động tăng
    const allTables = await DB.getAll('tables');
    let maxNumber = 0;
    allTables.forEach(t => {
        const match = t.name.match(/Bàn (\d+)/);
        if (match) {
            const num = parseInt(match[1]);
            if (num > maxNumber) maxNumber = num;
        }
    });
    const newNumber = maxNumber + 1;
    if (newNumber > 99) {
        showToast('Đã đạt giới hạn 99 bàn, không thể tách thêm', 'warning');
        return;
    }
    const newTableId = Date.now().toString();
    const newTableName = `Bàn ${newNumber}`;   // đặt tên theo số thứ tự
    const now = new Date();
    const newTable = {
        id: newTableId,
        name: newTableName,
        status: 'occupied',
        time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        startTime: now.toISOString(),
        items: [],
        total: 0,
        customerId: null,
        customerName: null
    };

    try {
        await DB.create('tables', newTable, newTableId);
        await new Promise(resolve => setTimeout(resolve, 100));
        const checkTable = await DB.get('tables', newTableId);
        if (!checkTable) throw new Error('Tạo bàn mới thất bại');
        showToast(`Đã tạo bàn mới: ${newTableName}`, 'info');
    } catch (err) {
        console.error(err);
        showToast('Lỗi tạo bàn mới!', 'error');
        return;
    }

    // Hiển thị danh sách món để chọn chuyển
    const transferItemsDiv = document.getElementById('transferItemsList');
    transferItemsDiv.innerHTML = sourceTable.items.map((item, idx) => {
        const maxQty = item.qty;
        return `
            <div class="transfer-item-row" data-idx="${idx}" data-name="${item.name}" data-price="${item.price}" data-max="${maxQty}">
                <div class="transfer-item-info">
                    <strong>${escapeHtml(item.name)}</strong><br>
                    <small>${formatMoney(item.price)}đ</small>
                </div>
                <div class="transfer-qty-control">
                    <button class="transfer-qty-minus" data-idx="${idx}">-</button>
                    <input type="number" class="transfer-qty-input" data-idx="${idx}" value="0" min="0" max="${maxQty}" step="1">
                    <button class="transfer-qty-plus" data-idx="${idx}">+</button>
                    <span style="font-size:11px;">/ ${maxQty}</span>
                </div>
            </div>
        `;
    }).join('');
    
    attachTransferQtyEvents();
    document.getElementById('transferTableModal').style.display = 'flex';

    // Xử lý xác nhận chuyển
    const confirmBtn = document.getElementById('confirmTransferBtn');
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    const newConfirmBtn = document.getElementById('confirmTransferBtn');
    newConfirmBtn.onclick = async () => {
        const selectedItems = [];
        const inputs = document.querySelectorAll('#transferItemsList .transfer-qty-input');
        for (let input of inputs) {
            let qty = parseInt(input.value);
            if (qty > 0) {
                const idx = parseInt(input.dataset.idx);
                const item = sourceTable.items[idx];
                if (qty > item.qty) qty = item.qty;
                selectedItems.push({ name: item.name, price: item.price, qty: qty });
            }
        }
        if (selectedItems.length === 0) {
            showToast('Vui lòng chọn ít nhất một món với số lượng > 0', 'warning');
            return;
        }

        // Cập nhật bàn nguồn (trừ món)
        var remainingItems = sourceTable.items.map(function(i) { return Object.assign({}, i); });
        for (let sel of selectedItems) {
            const existing = remainingItems.find(i => i.name === sel.name);
            if (existing) existing.qty -= sel.qty;
        }
        remainingItems = remainingItems.filter(i => i.qty > 0);
        const newSourceTotal = remainingItems.reduce((s, i) => s + i.price * i.qty, 0);
        await DB.update('tables', tid, { items: remainingItems, total: newSourceTotal });

        // Thêm vào bàn mới
        const newTargetTotal = selectedItems.reduce((s, i) => s + i.price * i.qty, 0);
        const targetTableExists = await DB.get('tables', newTableId);
        if (!targetTableExists) {
            showToast('Bàn đích không còn tồn tại!', 'error');
            return;
        }
        await DB.update('tables', newTableId, { items: selectedItems, total: newTargetTotal });

        // KHÔNG xử lý công nợ (theo yêu cầu)
        closeModal('transferTableModal');
        await renderTables();
        if (document.getElementById('tableDetailModal').style.display === 'flex') {
            await showTableDetail(tid);
        }
        showToast(`Đã chuyển ${selectedItems.reduce((s,i)=>s+i.qty,0)} món sang bàn "${newTableName}"`, 'success');
    };
}

function attachTransferQtyEvents() {
    document.querySelectorAll('.transfer-qty-minus').forEach(btn => {
        btn.onclick = () => {
            const idx = btn.dataset.idx;
            const input = document.querySelector(`.transfer-qty-input[data-idx="${idx}"]`);
            if (input) {
                let val = parseInt(input.value) || 0;
                if (val > 0) input.value = val - 1;
            }
        };
    });
    document.querySelectorAll('.transfer-qty-plus').forEach(btn => {
        btn.onclick = () => {
            const idx = btn.dataset.idx;
            const input = document.querySelector(`.transfer-qty-input[data-idx="${idx}"]`);
            if (input) {
                let val = parseInt(input.value) || 0;
                let max = parseInt(input.max) || 0;
                if (val < max) input.value = val + 1;
            }
        };
    });
}

function changeTransferQty(idx, delta) {
    const input = document.querySelector(`.transfer-qty-input[data-idx="${idx}"]`);
    if (!input) return;
    let val = parseInt(input.value) || 0;
    const max = parseInt(input.max) || 0;
    val = Math.max(0, Math.min(max, val + delta));
    input.value = val;
}

async function showMergeTableModal(sourceTableId) {
    const sourceId = String(sourceTableId);
    const sourceTable = await DB.get('tables', sourceId);
    if (!sourceTable) {
        showToast('Không tìm thấy bàn nguồn!', 'error');
        return;
    }
    if (!sourceTable.items || sourceTable.items.length === 0) {
        showToast('Bàn này không có món để gộp!', 'warning');
        return;
    }

    let allTables = await DB.getAll('tables');
    const otherTables = allTables.filter(t => String(t.id) !== sourceId && (t.status === 'occupied' || (t.items && t.items.length > 0) || t.status === 'debt'));

    if (otherTables.length === 0) {
        showToast('Không có bàn nào khác để gộp!', 'warning');
        return;
    }

    const container = document.getElementById('mergeTablesList');
    if (!container) return;

    container.innerHTML = otherTables.map(table => {
        const itemCount = (table.items || []).reduce((s, i) => s + i.qty, 0);
        const total = table.total || 0;
        const customerName = table.customerName || (table.customerId && window.customers ? window.customers.find(c => c.id == table.customerId) : null ? window.customers.find(c => c.id == table.customerId).name : '') || '';
        return `
            <div class="merge-table-item" data-id="${table.id}" data-name="${table.name}" data-customer="${customerName}" data-total="${total}">
                <div class="merge-table-header">
                    <span>🪑 ${table.name}</span>
                    <span class="merge-total">${formatMoney(total)}</span>
                </div>
                <div>📦 ${itemCount} món</div>
                ${customerName ? `<div class="merge-table-customer">👤 ${escapeHtml(customerName)}</div>` : '<div class="merge-table-customer">👤 Chưa có khách</div>'}
            </div>
        `;
    }).join('');

    // Event delegation
    container.onclick = async (e) => {
        const itemDiv = e.target.closest('.merge-table-item');
        if (!itemDiv) return;
        const targetId = itemDiv.dataset.id;
        const targetName = itemDiv.dataset.name;
        if (confirm(`Gộp bàn "${sourceTable.name}" vào bàn "${targetName}"?\n\nMón sẽ được cộng dồn.`)) {
            await mergeTables(sourceTable, targetId);
        }
        closeModal('mergeTableModal');
        container.onclick = null;
    };

    document.getElementById('mergeTableModal').style.display = 'flex';
}
async function mergeTables(sourceTable, targetId) {
    const sourceId = String(sourceTable.id);
    const targetTable = await DB.get('tables', targetId);
    if (!targetTable) {
        showToast('Bàn đích không tồn tại!', 'error');
        return;
    }

    // Cộng dồn món từ bàn nguồn vào bàn đích
    var targetItems = targetTable.items ? targetTable.items.slice() : [];
    var sourceItems = sourceTable.items ? sourceTable.items.slice() : [];
    for (let srcItem of sourceItems) {
        const existing = targetItems.find(function(i) { return i.name === srcItem.name; });
        if (existing) existing.qty += srcItem.qty;
        else targetItems.push(Object.assign({}, srcItem));
    }
    const newTotal = targetItems.reduce((sum, i) => sum + (i.price * i.qty), 0);
    await DB.update('tables', targetId, { items: targetItems, total: newTotal, status: 'occupied' });

    // Xóa bàn nguồn
    await DB.remove('tables', sourceId);

    await renderTables();
    closeModal('tableDetailModal');
    closeModal('mergeTableModal');
    showToast(`✅ Đã gộp bàn "${sourceTable.name}" vào bàn "${targetTable.name}"`, 'success');
}
async function showSplitBillModal(tableId) {
    const tid = String(tableId);
    const table = await DB.get('tables', tid);
    if (!table || !table.items || table.items.length === 0) {
        showToast('Bàn này chưa có món nào để chia!', 'warning');
        return;
    }

    const splitContainer = document.getElementById('splitItemsList');
    let html = '';
    table.items.forEach((item, idx) => {
        html += `
            <div class="split-item-row" data-idx="${idx}" data-price="${item.price}">
                <div class="split-item-info">
                    <strong>${escapeHtml(item.name)}</strong><br>
                    <small>${formatMoney(item.price)}đ / món</small>
                </div>
                <div class="split-qty-control">
                    <button class="split-qty-minus" data-idx="${idx}">-</button>
                    <input type="number" class="split-qty-input" id="split-qty-${idx}" 
                           value="0" min="0" max="${item.qty}" step="1" style="width:70px; text-align:center;">
                    <button class="split-qty-plus" data-idx="${idx}">+</button>
                    <span style="font-size:12px;">/ ${item.qty}</span>
                </div>
                <div class="split-item-price" id="split-price-${idx}">
                    0đ
                </div>
            </div>
        `;
    });
    splitContainer.innerHTML = html;

    // Gắn sự kiện +/- 
    attachSplitQtyEvents();

    updateSplitTotal();
    document.getElementById('splitBillModal').style.display = 'flex';

    // Lưu bàn hiện tại để xử lý sau
    window._currentSplitTable = table;
    window._currentSplitTableId = tid;

    // Xóa listener cũ cho nút xác nhận
    const confirmBtn = document.getElementById('confirmSplitBtn');
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    const newConfirmBtn = document.getElementById('confirmSplitBtn');
    newConfirmBtn.onclick = () => confirmSplitPayment();
}
function attachSplitQtyEvents() {
    document.querySelectorAll('.split-qty-minus').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const idx = btn.dataset.idx;
            const input = document.getElementById(`split-qty-${idx}`);
            if (input) {
                let val = parseInt(input.value) || 0;
                if (val > 0) input.value = val - 1;
                updateSplitTotal();
            }
        };
    });
    document.querySelectorAll('.split-qty-plus').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const idx = btn.dataset.idx;
            const input = document.getElementById(`split-qty-${idx}`);
            if (input) {
                let val = parseInt(input.value) || 0;
                let max = parseInt(input.max) || 0;
                if (val < max) input.value = val + 1;
                updateSplitTotal();
            }
        };
    });
}
function changeSplitQty(idx, delta) {
    const qtyInput = document.getElementById(`split-qty-${idx}`);
    if (!qtyInput) return;
    let qty = parseInt(qtyInput.value) || 0;
    const maxQty = parseInt(qtyInput.max) || 0;
    qty = Math.max(0, Math.min(maxQty, qty + delta));
    qtyInput.value = qty;
    updateSplitItemTotal(idx);
    updateSplitTotal();
}
function updateSplitItemTotal(idx) {
    const qtyInput = document.getElementById(`split-qty-${idx}`);
    const row = qtyInput.closest('.split-item-row');
    const price = parseInt(row.dataset.price);
    const qty = parseInt(qtyInput.value) || 0;
    const itemTotal = price * qty;
    const priceSpan = document.getElementById(`split-price-${idx}`);
    if (priceSpan) priceSpan.innerText = formatMoney(itemTotal);
}
function updateSplitTotal() {
    let total = 0;
    const rows = document.querySelectorAll('.split-item-row');
    rows.forEach(row => {
        const idx = row.dataset.idx;
        const price = parseInt(row.dataset.price);
        const qtyInput = document.getElementById(`split-qty-${idx}`);
        const qty = qtyInput ? parseInt(qtyInput.value) : 0;
        const itemTotal = price * qty;
        total += itemTotal;
        const priceSpan = document.getElementById(`split-price-${idx}`);
        if (priceSpan) priceSpan.innerText = formatMoney(itemTotal);
    });
    document.getElementById('splitTotalAmount').innerText = formatMoney(total);
    // Lưu tổng tiền tạm thời
    window._splitTotal = total;
}

async function confirmSplitPayment() {
    const tableId = window._currentSplitTableId;
    const originalTable = window._currentSplitTable;
    if (!tableId || !originalTable) {
        showToast('Lỗi: không tìm thấy thông tin bàn', 'error');
        return;
    }

    const splitItems = [];
    const remainingItems = JSON.parse(JSON.stringify(originalTable.items));

    const rows = document.querySelectorAll('.split-item-row');
    for (let row of rows) {
        const idx = parseInt(row.dataset.idx);
        const qtyInput = document.getElementById(`split-qty-${idx}`);
        let splitQty = parseInt(qtyInput.value);
        if (splitQty > 0) {
            const item = remainingItems[idx];
            if (splitQty > item.qty) splitQty = item.qty;
            splitItems.push({
                name: item.name,
                price: item.price,
                qty: splitQty
            });
            item.qty -= splitQty;
        }
    }

    if (splitItems.length === 0) {
        showToast('Vui lòng chọn ít nhất một món với số lượng > 0', 'warning');
        return;
    }

    const splitTotal = splitItems.reduce((sum, i) => sum + (i.price * i.qty), 0);

    // Cập nhật bàn sau khi chia (giảm món)
    const finalItems = remainingItems.filter(i => i.qty > 0);
    const newTotal = finalItems.reduce((sum, i) => sum + (i.price * i.qty), 0);
    await DB.update('tables', tableId, {
        items: finalItems,
        total: newTotal
    });

    // KHÔNG xử lý công nợ

    // Ghi nhận thanh toán phần đã chọn
    await processPaymentDirect('dinein', tableId, splitTotal, 'cash', splitItems);

    closeModal('splitBillModal');
    await renderTables();
    if (document.getElementById('tableDetailModal').style.display === 'flex') {
        await showTableDetail(tableId);
    }

    showToast(`✅ Đã chia và thanh toán ${formatMoney(splitTotal)}`, 'success');

    window._currentSplitTable = null;
    window._currentSplitTableId = null;
}
// Helper chọn tất cả / bỏ chọn
function selectAllSplitItems(checked) {
    document.querySelectorAll('.split-checkbox').forEach(cb => {
        cb.checked = checked;
    });
    updateSplitTotal();
}

async function showPaymentMethod(type, tableId, amount) {
    if (!amount || amount <= 0) { showToast('Không có món để thanh toán!', 'warning'); return; }
    let items = [], tableName = '', startTime = null;
    if (type === 'dinein') {
        const tid = String(tableId);
        const table = await DB.get('tables', tid);
        if (table) {
            items = table.items ? table.items.slice() : [];
            tableName = table.name;
            startTime = table.startTime;
        }
    } else {
        items = tempOrder.slice();
        tableName = 'Mang đi';
    }
    let sittingTime = ''; 
    if (startTime) {
        const diffMins = Math.floor((Date.now() - new Date(startTime)) / 60000);
        const diffHours = Math.floor(diffMins / 60);
        sittingTime = diffHours > 0 ? `${diffHours} giờ ${diffMins % 60} phút` : `${diffMins} phút`;
    }
    
    const totalItems = items.reduce((sum, i) => sum + i.qty, 0);
    
    const modalBody = document.getElementById('paymentModalBody');
    modalBody.innerHTML = `
        <div class="payment-info-section">
            <div class="payment-info-row"><span>📌 Bàn</span><span>${tableName}</span></div>
            <div class="payment-info-row"><span>⏱️ Thời gian</span><span>${new Date().toLocaleString('vi-VN')}</span></div>
            ${sittingTime ? `<div class="payment-info-row"><span>🕑 Thời gian ngồi</span><span>${sittingTime}</span></div>` : ''}
        </div>
        <div class="payment-items-title">📋 Danh sách món</div>
        <div class="payment-items-list">
            ${items.map(item => `<div><span>${item.name} x${item.qty}</span><span>${formatMoney((item.price || 0) * (item.qty || 0))}</span></div>`).join('')}
        </div>
        <div class="payment-summary-row">
    <div class="payment-items-count">📦 <strong>${totalItems} món</strong></div>

    <div class="payment-total">
        <span class="label">💰 Tổng tiền</span>
        <span class="amount">${formatMoney(amount)}</span>
    </div>
</div>
        <div class="payment-methods">
            <button class="payment-method-btn cash" onclick="processPaymentDirect('${type}', '${tableId}', ${amount}, 'cash')">💰 Tiền mặt</button>
            <button class="payment-method-btn transfer" onclick="processPaymentDirect('${type}', '${tableId}', ${amount}, 'transfer')">💳 Chuyển khoản</button>
        </div>
    `;
    document.getElementById('paymentModal').style.display = 'flex';
}
async function showDebtTableDetail(tableId) {
    const tid = String(tableId);
    let table = await DB.get('tables', tid);
    if (!table) { showToast('Không tìm thấy bàn!', 'error'); return; }
    document.getElementById('detailTableName').innerHTML = `🪑 ${table.name} (Nợ)`;
    document.getElementById('detailTime').innerText = table.time || '--:--';
    document.getElementById('detailTotal').innerHTML = formatMoney(table.total || 0);
    const itemsContainer = document.getElementById('detailItemsList');
    if (!table.items || table.items.length === 0) itemsContainer.innerHTML = '<div style="padding:20px;">✨ Chưa có món</div>';
    else {
        itemsContainer.innerHTML = table.items.map(item => `
            <div class="detail-item-row">
                <span>${item.name} x${item.qty}</span>
                <span>${formatMoney((item.price || 0) * (item.qty || 0))}</span>
            </div>
        `).join('');
    }
    currentContext = { type: 'debtTableDetail', tableId: table.id };
    document.getElementById('tableDetailModal').style.display = 'flex';
    
    // Gắn lại sự kiện cho modal chi tiết bàn (nợ)
    const detailPayBtn = document.getElementById('detailPayBtn');
    const detailDebtBtn = document.getElementById('detailDebtBtn');
    const detailSplitBtn = document.getElementById('detailSplitBillBtn');
    const detailTransferBtn = document.getElementById('detailTransferBtn');
    const detailMergeBtn = document.getElementById('detailMergeBtn');
    
    if (detailPayBtn) detailPayBtn.onclick = () => payDebtTable(table.id);
    if (detailDebtBtn) detailDebtBtn.style.display = 'none';
    if (detailSplitBtn) detailSplitBtn.style.display = 'none';
    if (detailTransferBtn) detailTransferBtn.style.display = 'none';
    if (detailMergeBtn) detailMergeBtn.style.display = 'none';
}
function openAddMenuForDebtTable(tableId) {
    currentContext = { type: 'addToDebtTable', tableId: tableId };
    tempOrder = [];
    if (typeof renderOrderCategories === 'function') renderOrderCategories();
    const searchInput = document.getElementById('menuSearchInput2');
    if (searchInput) {
        searchInput.oninput = (e) => {
            if (typeof renderOrderMenuByCategory === 'function') {
                renderOrderMenuByCategory(window.currentOrderCategory || 'all', e.target.value);
            }
        };
        searchInput.value = '';
    }
    if (typeof renderOrderMenuByCategory === 'function') {
        renderOrderMenuByCategory('all', '');
    }
    renderTempCartOrder();
    document.getElementById('orderModalTitle').innerHTML = `➕ Thêm món cho bàn nợ`;
    document.getElementById('customerSelectRow').style.display = 'none';
    document.getElementById('orderModal').style.display = 'flex';
}
async function processPaymentDirect(type, tableId, amount, paymentMethod, customItems = null) {
    console.log('💰 Thanh toán:', { type, tableId, amount, paymentMethod, customItems });

    if (typeof addTransaction === 'function') {
        addTransaction(type === 'takeaway' ? 'takeaway' : (type === 'dinein' ? 'dinein' : 'debt_payment'), amount, paymentMethod);
    }

    let items = [];
    let customerName = '';
    let tableName = '';

    if (type === 'dinein') {
        const tid = String(tableId);
        let table = await DB.get('tables', tid);
        if (table) {
            if (customItems && customItems.length > 0) {
                // Thanh toán một phần (chia hóa đơn) -> không xóa bàn
                items = customItems;
                customerName = table.customerName || '';
                tableName = table.name;
                var remainingItems = table.items.map(function(i) { return Object.assign({}, i); });
                for (let paid of customItems) {
                    const idx = remainingItems.findIndex(function(i) { return i.name === paid.name; });
                    if (idx !== -1) {
                        remainingItems[idx].qty -= paid.qty;
                        if (remainingItems[idx].qty <= 0) remainingItems.splice(idx, 1);
                    }
                }
                const newTotal = remainingItems.reduce((s, i) => s + i.price * i.qty, 0);
                if (remainingItems.length === 0) {
                    await DB.remove('tables', tid);
                    console.log('🗑️ Đã xóa bàn (sau khi thanh toán phần còn lại):', tid);
                } else {
                    await DB.update('tables', tid, { items: remainingItems, total: newTotal });
                }
            } else {
                // Thanh toán toàn bộ bàn -> xóa bàn
                items = table.items ? table.items.slice() : [];
                customerName = table.customerName || '';
                tableName = table.name;
                await DB.remove('tables', tid);
                console.log('🗑️ Đã xóa bàn (thanh toán toàn bộ):', tid);
            }
        } else {
            console.warn('Không tìm thấy bàn để thanh toán:', tid);
        }
    } else if (type === 'debt_table') {
        const tid = String(tableId);
        const table = await DB.get('tables', tid);
        if (table) {
            items = customItems ? customItems : (table.items ? table.items.slice() : []);
            customerName = table.customerName || '';
            tableName = table.name;
            await DB.remove('tables', tid);
            console.log('🗑️ Đã xóa bàn nợ:', tid);
        }
    } else {
        items = tempOrder.slice();
        customerName = currentSelectedCustomer && currentSelectedCustomer.name ? currentSelectedCustomer.name : '';
        tableName = 'Mang đi';
        tempOrder = []; 
    }

    if (typeof addHistory === 'function') {
        await addHistory({
            type: type === 'takeaway' ? 'takeaway' : (type === 'dinein' ? 'dinein' : 'debt_payment'),
            amount, paymentMethod, items,
            customer: customerName ? { name: customerName } : null,
            tableName: type === 'dinein' ? (customerName || tableName) : tableName,
            note: customerName ? `Khách: ${customerName}` : ''
        });
    }

    if (typeof deductIngredients === 'function') {
        let orderItems = (type === 'dinein' || type === 'debt_table') ? items : (type === 'takeaway' ? items : []);
        await deductIngredients(orderItems);
    }

    showToast(`✅ Thanh toán thành công ${formatMoney(amount)}`, 'success');
    await renderTables();
    document.getElementById('paymentModal').style.display = 'none';
    document.getElementById('tableDetailModal').style.display = 'none';
    const reportView = document.getElementById('reportView');
    if (typeof renderReport === 'function' && reportView && reportView.classList.contains('active')) renderReport();
    const customersView = document.getElementById('customersView');
    if (typeof renderCustomerList === 'function' && customersView && customersView.classList.contains('active')) renderCustomerList();
    if (typeof renderDebtList === 'function') renderDebtList();
    if (typeof renderIngredients === 'function') renderIngredients();
}
// ========== GHI NỢ BÀN (THÔNG MINH: DÙNG KHÁCH ĐÃ GÁN HOẶC CHỌN/TẠO MỚI) ==========
async function debtTable(tableId) {
    const tid = String(tableId);
    const table = await DB.get('tables', tid);
    if (!table || !table.items || table.items.length === 0) {
        showToast('Không có món để ghi nợ!', 'warning');
        return;
    }
    const total = table.total || 0;
    const orderDetail = (table.items || []).map(i => `${i.name} x${i.qty}`).join(', ');
    const note = `Mua tại ${table.name} - ${orderDetail}`;

    // Hàm xử lý ghi nợ sau khi có customer
    const processDebt = async (customer) => {
        if (!customer) return;
        if (typeof addCustomerDebt === 'function') {
            await addCustomerDebt(customer.id, total, note);
            await DB.remove('tables', tid);
            await renderTables();
            showToast(`💰 Đã ghi nợ ${formatMoney(total)} cho ${customer.name}`, 'success');
            document.getElementById('tableDetailModal').style.display = 'none';
            if (typeof renderDebtList === 'function') renderDebtList();
            if (typeof renderCustomerList === 'function') renderCustomerList();
            // Nếu đang ở subtab nợ (bàn nợ trong ngày), cập nhật danh sách
            const activeSubTab = document.querySelector('.sub-tab.active');
            if (activeSubTab && activeSubTab.getAttribute('data-subtab') === 'debt') {
                if (typeof renderDebtListForTab === 'function') await renderDebtListForTab();
            }
        }
    };

    // Trường hợp 1: Bàn đã có khách (customerId hoặc customerName)
    let existingCustomer = null;
    if (table.customerId && window.customers) {
        existingCustomer = window.customers.find(c => c.id == table.customerId);
    }
    if (existingCustomer) {
        if (confirm(`Bàn đã được gán cho khách "${existingCustomer.name}". Ghi nợ ${formatMoney(total)} cho khách này?`)) {
            await processDebt(existingCustomer);
        } else {
            // Nếu không đồng ý, hiển thị selector để chọn khách khác
            if (typeof showCustomerSelector === 'function') {
                showCustomerSelector(async (selectedCustomer) => {
                    await processDebt(selectedCustomer);
                });
            }
        }
        return;
    }

    // Trường hợp 2: Bàn chưa có khách -> hiển thị modal chọn/tạo khách
    if (typeof showCustomerSelector === 'function') {
        showCustomerSelector(async (selectedCustomer) => {
            await processDebt(selectedCustomer);
        });
    } else {
        // Fallback nếu thiếu hàm (dùng prompt cũ)
        const customerName = prompt('Nhập tên khách hàng để ghi nợ:');
        if (!customerName) return;
        let customer = window.customers ? window.customers.find(c => c.name === customerName) : null;
        if (!customer && typeof addCustomer === 'function') {
            customer = await addCustomer(customerName, '', '');
        }
        if (customer) await processDebt(customer);
    }
}

// ========== MENU TRONG POPUP ==========
function renderOrderMenuForModal(searchTerm = '') {
    const container = document.getElementById('menuGridOrder');
    if (!container) {
        console.error('Không tìm thấy container menuGridOrder');
        return;
    }
    if (!window.menuItems || window.menuItems.length === 0) {
        container.innerHTML = '<div style="padding:20px; text-align:center;">📭 Chưa có món nào. Hãy thêm món trong tab Menu.</div>';
        return;
    }
    let items = window.menuItems;
    if (searchTerm) items = items.filter(m => m.name.toLowerCase().includes(searchTerm.toLowerCase()));
    container.innerHTML = items.map(item => `
        <div class="menu-item-simple" onclick="addToTempOrder('${item.name}', ${item.price || 0})">
            ${item.name}<br>
            <span style="font-size:10px;">${formatMoney(item.price || 0)}</span>
        </div>
    `).join('');
}

function openAddMenuForTable(tableId) {
    currentContext = { type: 'addToTable', tableId: tableId };
    tempOrder = [];
    // Hiển thị danh mục
    if (typeof renderOrderCategories === 'function') {
        renderOrderCategories();
    }
    // Đặt danh mục mặc định
    window.currentOrderCategory = 'all';
    // Hiển thị tất cả món
    if (typeof renderOrderMenuByCategory === 'function') {
        renderOrderMenuByCategory('all', '');
    }
    renderTempCartOrder();
    document.getElementById('orderModalTitle').innerHTML = '➕ Thêm món';
    document.getElementById('orderModal').style.display = 'flex';
}

function renderTempCartOrder() {
    const container = document.getElementById('tempCartOrderItems');
    const totalSpan = document.getElementById('tempCartOrderTotal');
    const actionDiv = document.getElementById('tempCartActions');
    if (tempOrder.length === 0) {
        container.innerHTML = 'Chưa có món';
        totalSpan.innerText = '0';
        if (actionDiv) actionDiv.innerHTML = '';
        return;
    }
    let total = 0;
    let totalQty = 0;
    container.innerHTML = tempOrder.map(item => {
        const itemTotal = (item.price || 0) * (item.qty || 0);
        total += itemTotal;
        totalQty += item.qty;
        const timeStr = item.addedTime ? new Date(item.addedTime).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
        return `
            <div class="temp-cart-item" data-id="${item.id}">
                <span>${item.name} x${item.qty} ${timeStr ? `<span style="font-size:10px; color:#888;">${timeStr}</span>` : ''}</span>
                <span>${formatMoney(itemTotal)} <button onclick="removeFromTempOrder('${item.id}')">X</button></span>
            </div>
        `;
    }).join('');
    totalSpan.innerText = `${totalQty} món - ${formatMoney(total)}`;

    // Tạo nút hành động dựa trên context
    if (actionDiv) {
        if (currentContext && currentContext.type === 'takeaway') {
            actionDiv.innerHTML = `
                <div class="temp-cart-actions">
                    <button class="cart-action-btn cash" onclick="processTakeawayPayment('cash')">💰 Tiền mặt</button>
                    <button class="cart-action-btn transfer" onclick="processTakeawayPayment('transfer')">💳 Chuyển khoản</button>
                    <button class="cart-action-btn debt" onclick="processTakeawayDebt()">💢 Ghi nợ</button>
                </div>
            `;
        } else {
            actionDiv.innerHTML = `<button class="btn-confirm-add" id="confirmOrderBtn">✅ Xác nhận</button>`;
            // Gắn lại sự kiện cho nút xác nhận (tránh gắn nhiều lần)
            const confirmBtn = document.getElementById('confirmOrderBtn');
            if (confirmBtn && !confirmBtn.hasClickListener) {
                confirmBtn.hasClickListener = true;
                confirmBtn.addEventListener('click', async () => {
                    if (tempOrder.length === 0) { showToast('Vui lòng chọn món!', 'warning'); return; }
                    if (typeof checkStockForItems === 'function') {
                        const enough = await checkStockForItems(tempOrder);
                        if (!enough) return;
                    }
                    if (currentContext && currentContext.type === 'addToTable' && currentContext.tableId) {
                        // Thêm vào bàn hiện có
                        const table = await DB.get('tables', String(currentContext.tableId));
                        if (table) {
                            var existingItems = table.items || [];
                            var itemsToAdd = tempOrder.map(function(item) {
                                return {
                                    id: item.id,
                                    name: item.name,
                                    price: item.price,
                                    qty: item.qty,
                                    addedTime: item.addedTime
                                };
                            });
                            existingItems.push.apply(existingItems, itemsToAdd);
                            const newTotal = existingItems.reduce((s, i) => s + ((i.price || 0) * (i.qty || 0)), 0);
                            await DB.update('tables', String(currentContext.tableId), { items: existingItems, total: newTotal });
                            if (table.status === 'empty') {
                                const now = new Date();
                                await DB.update('tables', String(currentContext.tableId), { status: 'occupied', startTime: now.toISOString(), time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) });
                            }
                            await renderTables();
                            showToast(`✅ Đã thêm món vào bàn`, 'success');
                        }
                    } else if (currentContext && currentContext.type === 'newtable') {
                        // Tạo bàn mới với số thứ tự tự động
                        const allTables = await DB.getAll('tables');
                        let maxNumber = 0;
                        allTables.forEach(t => {
                            const match = t.name.match(/Bàn (\d+)/);
                            if (match) {
                                const num = parseInt(match[1]);
                                if (num > maxNumber) maxNumber = num;
                            }
                        });
                        const newNumber = maxNumber + 1;
                        if (newNumber > 99) {
                            showToast('Đã đạt giới hạn 99 bàn, không thể tạo mới', 'warning');
                            return;
                        }
                        const newId = Date.now().toString();
                        const newTable = {
                            id: newId,
                            name: `Bàn ${newNumber}`,
                            status: 'empty',
                            time: '--:--',
                            startTime: null,
                            items: [],
                            total: 0,
                            debt: 0,
                            customerId: null,
                            customerName: null
                        };
                        await DB.create('tables', newTable, newId);
                        // Thêm món vào bàn mới
                        var existingItems = newTable.items || [];
                        var itemsToAdd = tempOrder.map(function(item) {
                            return {
                                id: item.id,
                                name: item.name,
                                price: item.price,
                                qty: item.qty,
                                addedTime: item.addedTime
                            };
                        });
                        existingItems.push.apply(existingItems, itemsToAdd);
                        const newTotal = existingItems.reduce((s, i) => s + ((i.price || 0) * (i.qty || 0)), 0);
                        const now = new Date();
                        await DB.update('tables', newId, {
                            items: existingItems,
                            total: newTotal,
                            status: 'occupied',
                            startTime: now.toISOString(),
                            time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                        });
                        if (currentSelectedCustomer) {
                            await DB.update('tables', newId, { customerId: currentSelectedCustomer.id, customerName: currentSelectedCustomer.name });
                        }
                        await renderTables();
                        showToast(`✅ Đã tạo đơn tại bàn ${newTable.name}`, 'success');
                    }
                    document.getElementById('orderModal').style.display = 'none';
                    tempOrder = [];
                    currentSelectedCustomer = null;
                    currentContext = null;
                });
            }
        }
    }
}
async function processTakeawayPayment(method) {
    if (tempOrder.length === 0) {
        showToast('Chưa có món nào để thanh toán', 'warning');
        return;
    }
    const total = tempOrder.reduce((sum, i) => sum + (i.price * i.qty), 0);
    // Kiểm tra tồn kho
    if (typeof checkStockForItems === 'function') {
        const enough = await checkStockForItems(tempOrder);
        if (!enough) return;
    }
    // Trừ nguyên liệu
    if (typeof deductIngredients === 'function') {
        await deductIngredients(tempOrder);
    }
    // Ghi nhận giao dịch
    if (typeof addHistory === 'function') {
        await addHistory({
            type: 'takeaway',
            amount: total,
            paymentMethod: method,
            items: tempOrder.slice(),
            customer: currentSelectedCustomer ? { id: currentSelectedCustomer.id, name: currentSelectedCustomer.name } : null,
            note: 'Bán mang đi - ' + (method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản')
        });
    }
    showToast(`✅ Thanh toán thành công ${formatMoney(total)}`, 'success');
    // Đóng modal và reset
    document.getElementById('orderModal').style.display = 'none';
    tempOrder = [];
    currentSelectedCustomer = null;
    currentContext = null;
    // Cập nhật báo cáo, kho, v.v.
    if (typeof renderReport === 'function') renderReport();
    if (typeof renderIngredients === 'function') renderIngredients();
}

async function processTakeawayDebt() {
    if (tempOrder.length === 0) {
        showToast('Chưa có món để ghi nợ', 'warning');
        return;
    }
    const total = tempOrder.reduce((sum, i) => sum + (i.price * i.qty), 0);
    // Chọn hoặc tạo khách hàng
    if (typeof showCustomerSelector === 'function') {
        showCustomerSelector(async (customer) => {
            // Ghi nợ cho khách
            if (typeof addCustomerDebt === 'function') {
                await addCustomerDebt(customer.id, total, `Mang đi - ${tempOrder.map(i => `${i.name}x${i.qty}`).join(', ')}`);
                showToast(`💰 Đã ghi nợ ${formatMoney(total)} cho khách ${customer.name}`, 'success');
            }
            // Đóng modal và reset
            document.getElementById('orderModal').style.display = 'none';
            tempOrder = [];
            currentSelectedCustomer = null;
            currentContext = null;
            if (typeof renderCustomerList === 'function') renderCustomerList();
        });
    } else {
        showToast('Chức năng chọn khách chưa sẵn sàng', 'error');
    }
}


function removeFromTempOrder(id) {
    tempOrder = tempOrder.filter(i => i.id !== id);
    renderTempCartOrder();
}


const confirmOrderButton = document.getElementById('confirmOrderBtn');
if (confirmOrderButton) {
    confirmOrderButton.addEventListener('click', async () => {
        if (tempOrder.length === 0) { showToast('Vui lòng chọn món!', 'warning'); return; }
    
    // Kiểm tra tồn kho trước khi xác nhận
    if (typeof checkStockForItems === 'function') {
        const enough = await checkStockForItems(tempOrder);
        if (!enough) return;
    }
    
    const total = tempOrder.reduce((s, i) => s + ((i.price || 0) * (i.qty || 0)), 0);
    if (currentContext && currentContext.type === 'takeaway') {
        document.getElementById('orderModal').style.display = 'none';
        showPaymentMethod('takeaway', null, total);
    } else if (currentContext && currentContext.type === 'newtable' && currentContext.tableId) {
        const table = await DB.get('tables', String(currentContext.tableId));
        if (table) {
            const existingItems = table.items || [];
            tempOrder.forEach(function(newItem) {
                const ex = existingItems.find(function(i) { return i.name === newItem.name; });
                if (ex) ex.qty += newItem.qty;
                else existingItems.push(Object.assign({}, newItem));
            });
            const newTotal = existingItems.reduce(function(s, i) { return s + ((i.price || 0) * (i.qty || 0)); }, 0);
            const now = new Date();
            await DB.update('tables', String(currentContext.tableId), {
                items: existingItems, total: newTotal, status: 'occupied',
                startTime: now.toISOString(), time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
            });
            if (currentSelectedCustomer) {
                await DB.update('tables', String(currentContext.tableId), { customerId: currentSelectedCustomer.id, customerName: currentSelectedCustomer.name });
            }
            await renderTables();
            showToast(`✅ Đã tạo đơn tại bàn ${table.name}`, 'success');
        }
        document.getElementById('orderModal').style.display = 'none';
        tempOrder = [];
        currentSelectedCustomer = null;
    } else if (currentContext && currentContext.type === 'addToTable' && currentContext.tableId) {
        const table = await DB.get('tables', String(currentContext.tableId));
        if (table) {
            const existingItems = table.items || [];
            tempOrder.forEach(function(newItem) {
                const ex = existingItems.find(function(i) { return i.name === newItem.name; });
                if (ex) ex.qty += newItem.qty;
                else existingItems.push(Object.assign({}, newItem));
            });
            const newTotal = existingItems.reduce(function(s, i) { return s + ((i.price || 0) * (i.qty || 0)); }, 0);
            await DB.update('tables', String(currentContext.tableId), { items: existingItems, total: newTotal });
            if (table.status === 'empty') {
                const now = new Date();
                await DB.update('tables', String(currentContext.tableId), { status: 'occupied', startTime: now.toISOString(), time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) });
            }
            await renderTables();
            showToast(`✅ Đã thêm món vào bàn`, 'success');
        }
        document.getElementById('orderModal').style.display = 'none';
        tempOrder = [];
    }
    });
}

const floatTakeawayBtn = document.getElementById('floatTakeawayBtn');
if (floatTakeawayBtn) {
    floatTakeawayBtn.addEventListener('click', () => {
        currentContext = { type: 'takeaway' };
    currentSelectedCustomer = null;
    tempOrder = [];
    // Hiển thị danh mục và món
    if (typeof renderOrderCategories === 'function') renderOrderCategories();
    window.currentOrderCategory = 'all';
    if (typeof renderOrderMenuByCategory === 'function') renderOrderMenuByCategory('all', '');
    renderTempCartOrder(); // hàm này sẽ hiển thị nút phù hợp
    document.getElementById('orderModalTitle').innerHTML = '🛵 Bán mang đi';
    document.getElementById('orderModal').style.display = 'flex';
    });
}



// ========== CHỌN/GÁN KHÁCH ==========
function showCustomerSelectorForOrder() {
    if (typeof showCustomerSelector === 'function') {
        showCustomerSelector((customer) => {
            currentSelectedCustomer = customer;
            document.getElementById('selectedCustomerDisplay').innerHTML = `👤 ${customer.name} ${customer.totalDebt > 0 ? `(nợ ${formatMoney(customer.totalDebt)})` : ''}`;
            document.getElementById('clearCustomerBtn').style.display = 'inline-block';
        });
    }
}

async function showCustomerSelectorForTable(tableId) {
    const tid = String(tableId);
    const table = await DB.get('tables', tid);
    if (!table) return;

    if (typeof showCustomerSelector === 'function') {
        showCustomerSelector(async (newCustomer) => {
            // Chỉ cập nhật thông tin khách, không ghi nợ
            const updateData = { 
                customerId: newCustomer.id, 
                customerName: newCustomer.name
            };
            if (table.status === 'empty') {
                updateData.status = 'occupied';
                updateData.startTime = new Date().toISOString();
                updateData.time = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            }
            await DB.update('tables', tid, updateData);
            await renderTables();
            showToast(`✅ Đã gán khách hàng "${newCustomer.name}" cho bàn`, 'success');

            const activeSubTab = document.querySelector('.sub-tab.active');
            if (activeSubTab && activeSubTab.getAttribute('data-subtab') === 'debt') {
                if (typeof renderDebtListForTab === 'function') await renderDebtListForTab();
            }
        });
    }
}

function clearSelectedCustomer() {
    currentSelectedCustomer = null;
    document.getElementById('selectedCustomerDisplay').innerHTML = '👤 Chọn khách hàng (không bắt buộc)';
    document.getElementById('clearCustomerBtn').style.display = 'none';
}

async function reindexTables() {
    let tables = await DB.getAll('tables');
    tables.sort((a, b) => parseInt(a.name.replace('Bàn ', '')) - parseInt(b.name.replace('Bàn ', '')));
    for (let i = 0; i < tables.length; i++) {
        const newName = `Bàn ${(i + 1).toString().padStart(2, '0')}`;
        if (tables[i].name !== newName) {
            // Kiểm tra bàn còn tồn tại trước khi cập nhật
            const stillExists = await DB.get('tables', String(tables[i].id));
            if (stillExists) {
                await DB.update('tables', String(tables[i].id), { name: newName });
            } else {
                console.warn(`Bàn ${tables[i].id} không tồn tại, bỏ qua cập nhật`);
            }
        }
    }
}
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}
window.escapeHtml = escapeHtml;
async function renderDebtListForTab() {
    const container = document.getElementById('debtListContainer');
    if (!container) return;
    
    let tables = await DB.getAll('tables');
    const today = new Date().toISOString().slice(0, 10);
    const debtTables = tables.filter(table => {
        if (table.status !== 'debt') return false;
        const debtDate = table.debtDate || table.startTime;
        if (!debtDate) return false;
        const datePart = new Date(debtDate).toISOString().slice(0, 10);
        return datePart === today;
    });
    
    if (debtTables.length === 0) {
        container.innerHTML = '<div class="empty-state">✅ Không có bàn nợ trong ngày hôm nay</div>';
        return;
    }
    
    debtTables.sort((a, b) => new Date(b.debtDate || b.startTime) - new Date(a.debtDate || a.startTime));
    container.innerHTML = debtTables.map(table => {
        const debtAmount = table.total || 0;
        const debtTime = table.debtDate ? new Date(table.debtDate).toLocaleTimeString('vi-VN') : (table.time || '--:--');
        const matchedCustomer = table.customerId && window.customers ? window.customers.find(c => c.id == table.customerId) : null;
        const customerName = table.customerName || (matchedCustomer ? matchedCustomer.name : '') || 'Khách lẻ';
        const itemCount = (table.items || []).reduce((s, i) => s + (i.qty || 0), 0);
        return `
            <div class="debt-card" onclick="showDebtTableDetail('${table.id}')">
                <div class="debt-card-header">
                    <div>🪑 ${table.name}</div>
                    <div class="debt-amount">${formatMoney(debtAmount)}</div>
                </div>
                <div class="debt-card-detail">
                    <div>👤 ${escapeHtml(customerName)}</div>
                    <div>⏱️ ${debtTime}</div>
                    <div>📦 ${itemCount} món</div>
                </div>
                <div class="debt-card-actions">
                    <button class="btn-pay-debt-small" onclick="event.stopPropagation(); payDebtTable('${table.id}')">💸 Thanh toán nợ</button>
                    <button class="btn-add-item-small" onclick="event.stopPropagation(); openAddMenuForDebtTable('${table.id}')">➕ Thêm món</button>
                </div>
            </div>
        `;
    }).join('');
}

// Export
window.renderDebtListForTab = renderDebtListForTab;

// ========== SUB TAB (Bán tại chỗ / Khách nợ) ==========
document.querySelectorAll('.sub-tab').forEach(subtab => {
    subtab.addEventListener('click', async () => {
        document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
        subtab.classList.add('active');
        const type = subtab.getAttribute('data-subtab');
        if (type === 'debt') {
            await renderDebtListForTab();
        } else {
            await renderTables();
        }
    });
});

// ========== CÁC NÚT TRONG MODAL CHI TIẾT BÀN ==========
const detailAddBtn = document.getElementById('detailAddBtn');
if (detailAddBtn) {
    detailAddBtn.addEventListener('click', () => {
        if (currentContext && currentContext.tableId) {
            const tableDetailModal = document.getElementById('tableDetailModal');
            if (tableDetailModal) tableDetailModal.style.display = 'none';
            openAddMenuForTable(currentContext.tableId);
        }
    });
}

const detailPayBtn = document.getElementById('detailPayBtn');
if (detailPayBtn) {
    detailPayBtn.addEventListener('click', async () => {
        if (currentContext && currentContext.tableId) {
            const table = await DB.get('tables', String(currentContext.tableId));
            if (table && (table.total || 0) > 0) {
                const tableDetailModal = document.getElementById('tableDetailModal');
                if (tableDetailModal) tableDetailModal.style.display = 'none';
                showPaymentMethod('dinein', currentContext.tableId, table.total);
            } else showToast('Không có món để thanh toán!', 'warning');
        }
    });
}

const detailDebtBtn = document.getElementById('detailDebtBtn');
if (detailDebtBtn) {
    detailDebtBtn.addEventListener('click', () => {
        if (currentContext && currentContext.tableId) {
            debtTable(currentContext.tableId);
            const tableDetailModal = document.getElementById('tableDetailModal');
            if (tableDetailModal) tableDetailModal.style.display = 'none';
        }
    });
}

// ========== ĐÓNG MODAL KHI CLICK RA NGOÀI ==========
document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        tempOrder = [];
        currentSelectedCustomer = null;
    });
});
window.onclick = (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
        tempOrder = [];
        currentSelectedCustomer = null;
    }
};

// ========== THỜI GIAN ==========
function updateTime() {
    const now = new Date();
    const timeEl = document.getElementById('currentTime');
    if (timeEl) timeEl.innerText = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}
setInterval(updateTime, 1000);
updateTime();

// ========== CHUYỂN TAB CHÍNH ==========
document.querySelectorAll('.main-tab, .bottom-nav-item').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabId = tab.getAttribute('data-tab');
        document.querySelectorAll('.main-tab, .bottom-nav-item').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tabId}View`).classList.add('active');
        if (tabId === 'menu' && typeof renderMenuManager === 'function') renderMenuManager();
        if (tabId === 'ingredients' && typeof renderIngredients === 'function') renderIngredients();
        if (tabId === 'customers' && typeof renderCustomerList === 'function') renderCustomerList();
        if (tabId === 'report' && typeof renderReport === 'function') renderReport();
        if (tabId === 'history' && typeof renderHistory === 'function') renderHistory();
        if (tabId === 'settings' && typeof loadSettings === 'function') loadSettings();
    });
});

// ========== CÀI ĐẶT ==========
function loadSettings() {
    document.getElementById('settingAutoPrint').checked = localStorage.getItem('settingAutoPrint') === 'true';
    document.getElementById('settingAfterPay').checked = localStorage.getItem('settingAfterPay') !== 'false';
    document.getElementById('settingShowCustomer').checked = localStorage.getItem('settingShowCustomer') === 'true';
    document.getElementById('settingMinStock').value = localStorage.getItem('settingMinStock') || '10';
}
function saveSettings() {
    const autoPrintCheckbox = document.getElementById('settingAutoPrint');
    const afterPayCheckbox = document.getElementById('settingAfterPay');
    const showCustomerCheckbox = document.getElementById('settingShowCustomer');
    const minStockInput = document.getElementById('settingMinStock');
    localStorage.setItem('settingAutoPrint', autoPrintCheckbox && autoPrintCheckbox.checked);
    localStorage.setItem('settingAfterPay', afterPayCheckbox && afterPayCheckbox.checked);
    localStorage.setItem('settingShowCustomer', showCustomerCheckbox && showCustomerCheckbox.checked);
    localStorage.setItem('settingMinStock', minStockInput ? minStockInput.value : '10');
    showToast('✅ Đã lưu cài đặt!', 'success');
}
async function resetAllData() {
    if (confirm('⚠️ Xóa toàn bộ dữ liệu?')) {
        localStorage.clear();
        indexedDB.deleteDatabase('pos_data');
        showToast('Đã reset, reload...', 'success');
        setTimeout(() => location.reload(), 1500);
    }
}
async function exportAllData() {
    const tables = await DB.getAll('tables');
    const data = {
        tables, customers: window.customers || [], menuItems: window.menuItems || [],
        menuCategories: window.menuCategories || [], ingredients: window.ingredients || [],
        reportData: window.reportData || {}, history: window.historyData || []
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pos_backup_${new Date().toISOString().slice(0, 19)}.json`;
    link.click();
    showToast('✅ Đã xuất dữ liệu!', 'success');
}
function importAllData(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.tables) for (const t of data.tables) await DB.create('tables', t);
            if (data.customers) localStorage.setItem('pos_customers', JSON.stringify(data.customers));
            if (data.menuItems && data.menuCategories) localStorage.setItem('pos_menu', JSON.stringify({ categories: data.menuCategories, items: data.menuItems }));
            if (data.ingredients) localStorage.setItem('pos_ingredients', JSON.stringify(data.ingredients));
            if (data.reportData) localStorage.setItem('pos_report', JSON.stringify(data.reportData));
            if (data.history) localStorage.setItem('pos_history', JSON.stringify(data.history));
            showToast('✅ Nhập thành công! Reload...', 'success');
            setTimeout(() => location.reload(), 1500);
        } catch (err) { showToast('Lỗi file!', 'error'); }
    };
    reader.readAsText(file);
}

// ========== KHỞI TẠO DATABASE & UI ==========
(async function () {
    await DB.init();
    console.log('Database ready');

    // Load menu
    window.menuItems = await DB.getAll('menu');
    window.menuCategories = await DB.getAll('menu_categories');
    // Nếu menu rỗng, tạo dữ liệu mẫu (tạm thời)
    

    window.customers = await DB.getAll('customers');
    window.ingredients = await DB.getAll('ingredients');

    // KHÔNG TẠO BÀN MẶC ĐỊNH
    let tables = await DB.getAll('tables');
    console.log(`📌 Số bàn hiện có: ${tables.length}`);
    if (tables.length === 0) {
        console.log('📌 Chưa có bàn nào. Hãy dùng nút "Tạo bàn mới".');
    }

    // Cảnh báo nếu dữ liệu quá cũ trên iOS 12
    await checkDataFreshness();

        console.log('📌 Chưa có bàn nào. Hãy dùng nút "Tạo bàn mới".');
    }

    await renderTables();
    if (typeof renderCustomerList === 'function') renderCustomerList();
    if (typeof renderMenuManager === 'function') renderMenuManager();
    if (typeof renderIngredients === 'function') renderIngredients();
    if (typeof initMenu === 'function') initMenu();
    if (typeof initIngredients === 'function') initIngredients();
    if (typeof initCustomers === 'function') initCustomers();
    if (typeof initReport === 'function') initReport();
    if (typeof initHistory === 'function') initHistory();
    loadSettings();

    window.addEventListener('db_update', async function (event) {
        var collection = event.detail && event.detail.collection;
        var data = event.detail && event.detail.data;
        if (!collection) return;

        if (collection === 'tables') {
            cachedTables = null;
            await renderTables();
            if (currentContext && currentContext.type === 'detailView' && currentContext.tableId) {
                refreshTableDetailContent(String(currentContext.tableId));
            }
        }

        if (collection === 'customers') {
            window.customers = Array.isArray(data) ? data : await DB.getAll('customers');
            if (typeof renderCustomerList === 'function') renderCustomerList();
        }

        if (collection === 'menu' || collection === 'menu_categories') {
            window.menuItems = await DB.getAll('menu');
            window.menuCategories = await DB.getAll('menu_categories');
            if (typeof renderMenuManager === 'function') renderMenuManager();
        }

        if (collection === 'ingredients') {
            window.ingredients = Array.isArray(data) ? data : await DB.getAll('ingredients');
            if (typeof renderIngredients === 'function') renderIngredients();
        }

        if (collection === 'transactions') {
            if (typeof initHistory === 'function') initHistory();
        }

        if (collection === 'reports') {
            if (typeof initReport === 'function') initReport();
        }

        if (typeof resetReportCache === 'function') resetReportCache();
    });

    setInterval(() => {
        const activeTabContent = document.querySelector('.tab-content.active');
        if (activeTabContent && activeTabContent.id === 'tablesView') renderTables();
    }, 60000);
})();



async function payDebtTable(tableId) {
    const tid = String(tableId);
    const table = await DB.get('tables', tid);
    if (!table || !table.total || table.total <= 0) {
        showToast('Không có tiền nợ để thanh toán!', 'warning');
        return;
    }
    // Hiển thị modal thanh toán với type = 'debt_table'
    showPaymentMethod('debt_table', tableId, table.total);
}
// ========== ĐÓNG POPUP KHI CLICK RA NGOÀI HOẶC KÉO XUỐNG (SỬA LỖI TOUCHMOVE) ==========
function initModalCloseFeatures() {
    const modals = document.querySelectorAll('.modal');
    
    modals.forEach(modal => {
        // 1. Đóng khi click vào backdrop
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
                tempOrder = [];
                currentSelectedCustomer = null;
            }
        });

        // 2. Đóng khi kéo xuống (swipe down) trên modal-content - chỉ mobile
        const modalContent = modal.querySelector('.modal-content');
        if (modalContent) {
            let touchStartY = 0;
            let isSwipingDown = false;
            
            const handleTouchStart = (e) => {
                touchStartY = e.touches[0].clientY;
                isSwipingDown = false;
            };
            
            const handleTouchMove = (e) => {
                const currentY = e.touches[0].clientY;
                const deltaY = currentY - touchStartY;
                // Nếu kéo xuống > 40px và nội dung chưa cuộn lên đầu
                if (deltaY > 40 && modalContent.scrollTop === 0) {
                    isSwipingDown = true;
                    // Chỉ preventDefault khi sự kiện có thể hủy (tránh lỗi)
                    if (e.cancelable) {
                        e.preventDefault();
                    }
                    modal.style.display = 'none';
                    tempOrder = [];
                    currentSelectedCustomer = null;
                }
            };
            
            const handleTouchEnd = () => {
                // Không cần xử lý thêm
                isSwipingDown = false;
            };
            
            modalContent.addEventListener('touchstart', handleTouchStart, { passive: false });
            modalContent.addEventListener('touchmove', handleTouchMove, { passive: false });
            modalContent.addEventListener('touchend', handleTouchEnd);
        }
    });
}

// Khởi tạo khi DOM sẵn sàng
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initModalCloseFeatures);
} else {
    initModalCloseFeatures();
}
document.addEventListener('DOMContentLoaded', () => {
    const newTableBtn = document.getElementById('floatNewtableBtn');
    if (newTableBtn) {
        newTableBtn.addEventListener('click', async () => {
            // Không tạo bàn ngay, chỉ đặt context và mở modal order
            currentContext = { type: 'newtable' };  // không có tableId
            currentSelectedCustomer = null;
            tempOrder = [];
            if (typeof renderOrderCategories === 'function') renderOrderCategories();
            window.currentOrderCategory = 'all';
            if (typeof renderOrderMenuByCategory === 'function') renderOrderMenuByCategory('all', '');
            renderTempCartOrder();
            document.getElementById('orderModalTitle').innerHTML = `🍽️ Tạo đơn - Bàn mới`;
            document.getElementById('orderModal').style.display = 'flex';
        });
    }
});
// ========== VUỐT NGANG CHUYỂN TAB (CHỈ MOBILE) ==========
(function initSwipeTabs() {
    let touchStartX = 0;
    let touchEndX = 0;
    const minSwipeDistance = 60; // độ dài tối thiểu để kích hoạt (px)

    // Chỉ hoạt động trên màn hình <= 768px (mobile)
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) return;

    const tabOrder = ['tables', 'menu', 'ingredients', 'customers', 'history', 'report', 'settings'];

    function getCurrentTabIndex() {
        for (let i = 0; i < tabOrder.length; i++) {
            const view = document.getElementById(`${tabOrder[i]}View`);
            if (view && view.classList.contains('active')) return i;
        }
        return -1;
    }

    function switchToTab(index) {
        if (index < 0 || index >= tabOrder.length) return;
        const tabId = tabOrder[index];
        // Tìm và click vào nút tab tương ứng (main-tab hoặc bottom-nav)
        const mainTab = document.querySelector(`.main-tab[data-tab="${tabId}"]`);
        if (mainTab) mainTab.click();
        const bottomNav = document.querySelector(`.bottom-nav-item[data-tab="${tabId}"]`);
        if (bottomNav) bottomNav.click();
    }

    document.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const deltaX = touchEndX - touchStartX;
        if (Math.abs(deltaX) < minSwipeDistance) return;

        const currentIndex = getCurrentTabIndex();
        if (currentIndex === -1) return;

        let newIndex = currentIndex;
        if (deltaX > 0) {
            newIndex = currentIndex - 1; // vuốt phải -> tab trái
        } else {
            newIndex = currentIndex + 1; // vuốt trái -> tab phải
        }
        switchToTab(newIndex);
    });
})();

function applyFlexGapFallback() {
    try {
        const testFlex = document.createElement('div');
        testFlex.style.display = 'flex';
        testFlex.style.flexDirection = 'column';
        testFlex.style.rowGap = '1px';
        testFlex.style.position = 'absolute';
        testFlex.style.visibility = 'hidden';
        testFlex.style.pointerEvents = 'none';
        testFlex.appendChild(document.createElement('div'));
        testFlex.appendChild(document.createElement('div'));
        document.body.appendChild(testFlex);
        const gapSupported = testFlex.scrollHeight === 1;
        document.body.removeChild(testFlex);
        if (gapSupported) return;
    } catch (err) {
        return;
    }

    const gapRules = [];

    function processRule(rule) {
        if (rule.type === CSSRule.STYLE_RULE && rule.style) {
            const gapValue = rule.style.gap || rule.style.rowGap || rule.style.columnGap;
            if (gapValue && gapValue !== '0px') {
                gapRules.push({ selector: rule.selectorText, gapValue: gapValue });
            }
        } else if (rule.cssRules) {
            Array.from(rule.cssRules).forEach(processRule);
        }
    }

    function applyGapFallback() {
        gapRules.forEach(rule => {
            try {
                const elements = document.querySelectorAll(rule.selector);
                Array.from(elements).forEach(el => {
                    el.style.margin = 'calc(-1 * ' + rule.gapValue + ') 0 0 calc(-1 * ' + rule.gapValue + ')';
                    Array.from(el.children).forEach(function(child) {
                        child.style.margin = rule.gapValue + ' 0 0 ' + rule.gapValue;
                    });
                });
            } catch (e) {
                // Ignore invalid selectors or unsupported rules
            }
        });
    }

    function scanStyleSheets() {
        gapRules.length = 0;
        Array.from(document.styleSheets).forEach(sheet => {
            try {
                Array.from(sheet.cssRules || []).forEach(processRule);
            } catch (e) {
                // Ignore cross-origin or invalid stylesheet access
            }
        });
    }

    scanStyleSheets();
    applyGapFallback();

    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                applyGapFallback();
            }
        });
    });

    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
}

document.addEventListener('DOMContentLoaded', applyFlexGapFallback);

function addToTempOrder(name, price, quantity = 1) {
    const existing = tempOrder.find(item => item.name === name);
    const now = new Date().toISOString();
    const timeStr = new Date(now).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    if (existing) {
        existing.qty += quantity;
        existing.times.push(timeStr);
    } else {
        tempOrder.push({
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            name: name,
            price: price,
            qty: quantity,
            times: [timeStr],
            addedTime: now // lưu lần đầu
        });
    }
    renderTempCartOrder();
}

function addToTempOrderWithVariant(itemId, variantName, price, quantity = 1) {
    const item = window.menuItems.find(i => i.id === itemId);
    if (!item) return;
    const displayName = `${item.name} (${variantName})`;
    const existing = tempOrder.find(i => i.name === displayName);
    const now = new Date().toISOString();
    const timeStr = new Date(now).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    if (existing) {
        existing.qty += quantity;
        existing.times.push(timeStr);
    } else {
        tempOrder.push({
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            name: displayName,
            price: price,
            qty: quantity,
            times: [timeStr],
            addedTime: now,
            originalItemId: itemId,
            variant: variantName
        });
    }
    renderTempCartOrder();
}
// Xuất các hàm toàn cục
window.renderTables = renderTables;
window.showPaymentMethod = showPaymentMethod;
window.debtTable = debtTable;
window.openAddMenuForTable = openAddMenuForTable;
window.showTableDetail = showTableDetail;
window.showCustomerSelectorForTable = showCustomerSelectorForTable;
window.showCustomerSelectorForOrder = showCustomerSelectorForOrder;
window.clearSelectedCustomer = clearSelectedCustomer;
window.addToTempOrder = addToTempOrder;
window.removeFromTempOrder = removeFromTempOrder;
window.formatMoney = formatMoney;
window.closeModal = closeModal;
window.saveSettings = saveSettings;
window.resetAllData = resetAllData;
window.exportAllData = exportAllData;
window.importAllData = importAllData;
window.loadSettings = loadSettings;
window.showToast = showToast;
window.reindexTables = reindexTables;
window.showDebtTableDetail = showDebtTableDetail;
window.payDebtTable = payDebtTable;
window.openAddMenuForDebtTable = openAddMenuForDebtTable;
window.updateSplitTotal = updateSplitTotal;
window.selectAllSplitItems = selectAllSplitItems;
window.changeSplitQty = changeSplitQty;
window.showMergeTableModal = showMergeTableModal;
window.mergeTables = mergeTables;
window.showMergeTableModal = showMergeTableModal;
window.mergeTables = mergeTables;
window.changeTransferQty = changeTransferQty;
// Cuối file customers.js
window.updateCustomerDebt = updateCustomerDebt;
window.addCustomerDebt = addCustomerDebt;
window.addCustomer = addCustomer;
window.showDebtTableDetail = showDebtTableDetail;
window.payDebtTable = payDebtTable;
window.openAddMenuForDebtTable = openAddMenuForDebtTable;
window.showSplitBillModal = showSplitBillModal;
window.attachSplitQtyEvents = attachSplitQtyEvents;
window.updateSplitTotal = updateSplitTotal;
window.confirmSplitPayment = confirmSplitPayment;