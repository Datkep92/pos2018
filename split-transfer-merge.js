// split-transfer-merge.js - Chia hóa đơn, chuyển món, gộp bàn, xóa bàn
// ES5, tương thích Android 6, iOS 12
//
// ⚠️ LƯU Ý LỊCH SỬ (rất quan trọng khi sửa file này):
// tables.js TRƯỚC ĐÂY cũng chứa 9 hàm trùng tên với file này
// (confirmSplitPaymentWithMethod, showSplitBillModal, attachSplitQtyEvents,
//  updateSplitTotal, showTransferItemsModal, attachTransferQtyEvents,
//  confirmTransferItems, showMergeTableModal, mergeTables).
// Vì file này load SAU tables.js nên bản ở đây thắng, còn bản trong tables.js
// là CODE CHẾT (~455 dòng) đã được gỡ bỏ. Sửa logic ở đây là sửa bản đang chạy.
//
// Ba lỗi trong bản cũ đã được sửa ở đây:
//  1. confirmSplitPaymentWithMethod: gán historyPromise BÊN TRONG .then() rồi
//     Promise.resolve(historyPromise) chạy khi nó còn undefined -> toast "thành công"
//     hiện TRƯỚC khi ghi nợ/lịch sử xong, và không có .catch nào bắt lỗi.
//  2. Thiếu tableTime/startTime/endTime -> giao dịch chia hóa đơn không bị
//     history.js khóa hoàn tác theo thời gian ngồi (xem isTransactionLocked).
//  3. Thiếu handleCashPayment (đếm két) và notifyPaymentToTelegram cho tiền mặt.

// ========== KHOA CHONG BAM HAI LAN ==========
// File này trước đây không có bất kỳ khoá nào. Các thao tác tách/chuyển/gộp/xoá
// bàn đều ghi tiền hoặc đổi kho, nên bấm hai lần là thiệt hại kép.
function _releaseSplitTransferLock(key) {
    if (typeof DB !== 'undefined' && DB.releaseBusyLock) DB.releaseBusyLock(key);
}

function _splitTransferLocked(key, label) {
    if (typeof DB === 'undefined' || !DB.acquireBusyLock) return false;
    if (!DB.acquireBusyLock(key)) {
        showToast('⏳ Đang ' + (label || 'xử lý') + ', vui lòng chờ...', 'warning');
        return true;
    }
    return false;
}

// ========== CHIA HÓA ĐƠN ==========
function confirmSplitPaymentWithMethod(method, customer) {
    var tableId = pendingSplitTableId;
    if (!tableId) return;

    if (method === 'debt' && !customer) {
        showToast('Cần chọn khách hàng để ghi nợ!', 'warning');
        return;
    }

    // Chống bấm hai lần.
    //
    // File này (tách / chuyển / gộp / xoá bàn) KHÔNG có khoá nào cả. Bấm hai
    // lần vào nút "Ghi nợ" hoặc "Thanh toán" thì:
    //   - ghi nợ 2 lần cho cùng 1 phần hoá đơn
    //   - trừ nguyên liệu 2 lần
    //   - mở két tiền 2 lần
    // Các nút trong HTML cũng không có thuộc tính disabled nên bấm tới được.
    if (typeof DB !== 'undefined' && DB.acquireBusyLock) {
        if (!DB.acquireBusyLock('splitPay_' + tableId)) {
            showToast('⏳ Đang xử lý, vui lòng chờ...', 'warning');
            return;
        }
    }

    _getTableFromCache(tableId).then(function(table) {
        if (!table || !table.items || !table.items.length) {
            _releaseSplitTransferLock('splitPay_' + tableId);
            showToast('Bàn không còn món nào!', 'warning');
            return;
        }
        
        // Tách phần thanh toán / phần còn lại
        // PHẢI giữ lại `id` và `variantName`.
        // Trước đây chỉ copy {name, price, qty} -> mất id -> ingredients.js tra
        // _menuLookup[undefined] rơi về tên gốc, _getIngredientsForItem không thấy
        // dấu '_' trong id nên KHÔNG dùng công thức riêng của size. Tệ hơn:
        // mảng này được ghi vào bàn (DB.update) nên phần còn lại của bàn mất id
        // vĩnh viễn, mọi lần trừ/hoàn sau đó cũng tính sai công thức.
        var splitItems = [];
        var remainingItems = [];
        for (var i = 0; i < table.items.length; i++) {
            var src = table.items[i];
            remainingItems.push({
                id: src.id,
                name: src.name,
                price: src.price,
                qty: src.qty,
                variantName: src.variantName
            });
        }
        
        var rows = document.querySelectorAll('.split-item-row');
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            var idx = parseInt(row.getAttribute('data-idx'), 10);
            var input = document.getElementById('split-qty-' + idx);
            var qty = input ? (parseInt(input.value, 10) || 0) : 0;
            if (qty > 0) {
                var item = remainingItems[idx];
                if (!item) continue;
                if (qty > item.qty) qty = item.qty;
                splitItems.push({
                    id: item.id,
                    name: item.name,
                    price: item.price,
                    qty: qty,
                    variantName: item.variantName
                });
                item.qty -= qty;
            }
        }
        
        if (splitItems.length === 0) {
            showToast('Chưa chọn món để thanh toán!', 'warning');
            return;
        }
        
        var splitTotal = splitItems.reduce(function(s, i2) { return s + i2.price * i2.qty; }, 0);
        var finalItems = remainingItems.filter(function(i2) { return i2.qty > 0; });
        var newTotal = finalItems.reduce(function(s, i2) { return s + i2.price * i2.qty; }, 0);
        var now = new Date();
        var tableTime = _calcTableTime(table.startTime) || '';
        var customerInfo = (method === 'debt' && customer) ? { id: customer.id, name: customer.name } : null;
        
        _withRealtimeSuppressed(function() {
            // Trừ nguyên liệu (cho phép âm kho - không chặn giao dịch).
            //
            // FIX: bàn được tạo từ đơn (order.js handleCreateNewTable /
            // handleAddToExistingTable) đã đánh dấu ingredientsDeducted và TRỪ KHO
            // cho toàn bộ món ngay khi thêm vào bàn. Nếu vẫn trừ ở đây thì phần
            // bị chia sẽ bị trừ 2 lần. Chỉ trừ khi bàn chưa từng bị trừ.
            var wasDeducted = table.ingredientsDeducted === true;
            var deductPromise = wasDeducted
                ? Promise.resolve(true)
                : deductIngredients(splitItems);
            
            return deductPromise.then(function() {
                // Ghi nợ nếu cần.
                // addCustomerDebt tự tạo transaction history -> nếu gọi thêm
                // addHistory() bên dưới sẽ thành 2 dòng lịch sử cho 1 lần ghi nợ.
                // Nay truyền extraFields xuống addCustomerDebt và chỉ gọi
                // addHistory khi thanh toán bằng TM/CK (trường hợp không ghi nợ).
                if (method === 'debt') {
                    return addCustomerDebt(customer.id, splitTotal, 'Chia hóa đơn tại bàn ' + table.name, splitItems, {
                        tableId: tableId,
                        tableName: table.name,
                        tableTime: tableTime,
                        startTime: table.startTime || null,
                        endTime: now.toISOString()
                    }).then(function(debtResult) {
                        if (debtResult && debtResult.creditUsed > 0) {
                            _splitCreditUsed = debtResult.creditUsed;
                        }
                        return true;
                    });
                }
                return true;
            }).then(function() {
                // Cập nhật bàn: giảm số lượng món đã thanh toán.
                //
                // GIỮ NGUYÊN trạng thái cờ, không đặt thành true:
                //  - Bàn đã trừ kho từ lúc thêm món (wasDeducted = true): phần chia
                //    không trừ thêm, cờ vẫn true để lúc thanh toán phần còn lại
                //    cũng không trừ nữa. Đúng.
                //  - Bàn chưa từng trừ (wasDeducted = false): vừa trừ phần chia, cờ
                //    phải vẫn false để lần thanh toán phần còn lại trừ nốt.
                //    Nếu đặt true ở đây thì phần còn lại sẽ KHÔNG BAO GIỜ bị trừ.
                var tableUpdate = { items: finalItems, total: newTotal, ingredientsDeducted: wasDeducted };
                return DB.update('tables', String(tableId), tableUpdate);
            }).then(function() {
                // FIX thứ tự: ghi lịch sử sau khi đã cập nhật bàn, và luôn trả về
                // promise để .then() bên ngoài chỉ chạy khi ghi xong.
                // BỎ QUA khi method === 'debt' vì addCustomerDebt đã ghi rồi.
                if (method === 'debt') return true;
                
                var note = _splitCreditUsed > 0 ? 'Chia hóa đơn - đã dùng ' + formatMoney(_splitCreditUsed) + ' tiền dư' : 'Chia hóa đơn';
                return addHistory({
                    type: 'dinein',
                    // FIX: amount phải TRỪ phần tiền dư đã dùng, nếu không doanh
                    // thu bị báo cáo thừa (đối chiếu tables.js:746 finalAmount).
                    amount: Math.max(0, splitTotal - _splitCreditUsed),
                    paymentMethod: method,
                    items: splitItems,
                    customer: customerInfo,
                    tableName: table.name,
                    tableId: tableId,
                    note: note,
                    tableTime: tableTime,
                    startTime: table.startTime || null,
                    endTime: now.toISOString(),
                    creditUsed: _splitCreditUsed
                });
            });
        }).then(function() {
            _splitCreditUsed = 0;
            
            if (method === 'cash') {
                handleCashPayment(splitTotal, null, {type: 'dinein', tableName: table.name, customer: customerInfo}).catch(function(err) {
                    console.error('[AUDIT] handleCashPayment lỗi (chia hóa đơn):', err);
                });
            }
            
            if (typeof notifyPaymentToTelegram === 'function') {
                notifyPaymentToTelegram({
                    type: method === 'debt' ? 'debt_payment' : 'dinein',
                    amount: splitTotal,
                    paymentMethod: method,
                    items: splitItems,
                    tableName: table.name,
                    customer: customerInfo,
                    createdAt: now.toISOString()
                });
            }
            
            closeModal('splitBillModal');
            // String() de id number/string van so sanh dung
            if (currentTableDetailId && String(currentTableDetailId) === String(tableId)) {
                showTableDetail(tableId);
            }
            if (typeof renderTables === 'function') renderTables();
            showToast('✅ Đã thanh toán phần chia ' + formatMoney(splitTotal) + (method === 'debt' ? ' (ghi nợ)' : ''), 'success');
            _releaseSplitTransferLock('splitPay_' + tableId);
        }).catch(function(err) {
            _splitCreditUsed = 0;
            _releaseSplitTransferLock('splitPay_' + tableId);
            showToast('❌ Lỗi chia hóa đơn: ' + (err.message || err), 'error', 4000);
        });
    }).catch(function(err) {
        _releaseSplitTransferLock('splitPay_' + tableId);
        console.error('[AUDIT] lỗi tách hoá đơn:', err);
    });
}

// Số tiền dư đã dùng trong lần chia hóa đơn hiện tại (để ghi vào history)
var _splitCreditUsed = 0;

function showSplitBillModal(tableId) {
    pendingSplitTableId = tableId;
    _getTableFromCache(tableId).then(function(table) {
        // FIX: yêu cầu tối thiểu 2 món - chia 1 món thì vô nghĩa (bản cũ ở tables.js
        // có guard này nhưng bị bản ở file này ghi đè mất).
        if (!table || !table.items || table.items.length < 2) {
            showToast('Cần ít nhất 2 món để chia hóa đơn!', 'warning');
            return;
        }
        var container = document.getElementById('splitItemsList');
        if (!container) return;
        
        var html = '';
        for (var i = 0; i < table.items.length; i++) {
            var item = table.items[i];
            html += '<div class="split-item-row" data-idx="' + i + '" data-price="' + item.price + '" data-max="' + item.qty + '">' +
                '<span>' + escapeHtml(item.name) + '</span>' +
                '<div class="split-qty-control">' +
                    '<button class="split-qty-minus" data-idx="' + i + '">-</button>' +
                    '<input type="number" class="split-qty-input" id="split-qty-' + i + '" value="0" min="0" max="' + item.qty + '" step="1">' +
                    '<button class="split-qty-plus" data-idx="' + i + '">+</button>' +
                    '<span>/ ' + item.qty + '</span>' +
                '</div>' +
                '<span id="split-price-' + i + '" class="split-item-price">0đ</span>' +
            '</div>';
        }
        container.innerHTML = html;
        
        attachSplitQtyEvents();
        updateSplitTotal();
        
        var formActions = document.querySelector('#splitBillModal .form-actions');
        if (formActions) {
            // FIX: bản cũ dùng template literal (`...`) - Android 6/iOS 12 không parse
            // được -> SyntaxError làm hỏng cả file. Dùng nối chuỗi thuần ES5.
            formActions.innerHTML =
                '<button class="cart-action-btn cash" id="splitCashBtn">💰 Tiền mặt</button>' +
                '<button class="cart-action-btn transfer" id="splitTransferBtn">💳 Chuyển khoản</button>' +
                '<button class="cart-action-btn debt" id="splitDebtBtn">💢 Ghi nợ</button>' +
                '<button class="btn-cancel" onclick="closeModal(\'splitBillModal\')">Hủy</button>';
            
            var cashBtn = document.getElementById('splitCashBtn');
            if (cashBtn) cashBtn.onclick = function() { confirmSplitPaymentWithMethod('cash', null); };
            var transferBtn = document.getElementById('splitTransferBtn');
            if (transferBtn) transferBtn.onclick = function() { confirmSplitPaymentWithMethod('transfer', null); };
            var debtBtn = document.getElementById('splitDebtBtn');
            if (debtBtn) {
                debtBtn.onclick = function() {
                    showCustomerSelector(function(customer) {
                        confirmSplitPaymentWithMethod('debt', customer);
                    });
                };
            }
        }
        
        document.getElementById('splitBillModal').style.display = 'flex';
    });
}

function attachSplitQtyEvents() {
    var minusBtns = document.querySelectorAll('.split-qty-minus');
    var plusBtns = document.querySelectorAll('.split-qty-plus');
    for (var i = 0; i < minusBtns.length; i++) {
        minusBtns[i].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('split-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value, 10) || 0;
                    if (val > 0) input.value = val - 1;
                    updateSplitTotal();
                }
            };
        })(minusBtns[i]);
    }
    for (var j = 0; j < plusBtns.length; j++) {
        plusBtns[j].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('split-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value, 10) || 0;
                    var max = parseInt(input.getAttribute('max'), 10) || 0;
                    if (val < max) input.value = val + 1;
                    updateSplitTotal();
                }
            };
        })(plusBtns[j]);
    }
}

function updateSplitTotal() {
    var total = 0;
    var rows = document.querySelectorAll('.split-item-row');
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var idx = row.getAttribute('data-idx');
        var price = parseInt(row.getAttribute('data-price'), 10) || 0;
        var input = document.getElementById('split-qty-' + idx);
        var qty = input ? (parseInt(input.value, 10) || 0) : 0;
        var itemTotal = price * qty;
        total += itemTotal;
        var priceSpan = document.getElementById('split-price-' + idx);
        if (priceSpan) priceSpan.innerText = formatMoney(itemTotal);
    }
    var totalSpan = document.getElementById('splitTotalAmount');
    if (totalSpan) totalSpan.innerText = formatMoney(total);
}

// Hàm cũ (chỉ thanh toán tiền mặt, không có nút này trong UI hiện tại) - giữ lại
// để tương thích nếu HTML cũ còn gọi tới.
function confirmSplitPayment() {
    confirmSplitPaymentWithMethod('cash', null);
}

// ========== CHUYỂN MÓN ==========
function showTransferItemsModal(sourceId) {
    _getTableFromCache(sourceId).then(function(table) {
        if (!table || !table.items || !table.items.length) { showToast('Không có món để chuyển!', 'warning'); return; }
        pendingTransferSourceTable = table;
        var container = document.getElementById('transferItemsList');
        if (!container) return;
        var html = '';
        for (var i = 0; i < table.items.length; i++) {
            var item = table.items[i];
            html += '<div class="transfer-item-row" data-idx="' + i + '" data-price="' + item.price + '" data-max="' + item.qty + '">' +
                '<span>' + escapeHtml(item.name) + '</span>' +
                '<div class="transfer-qty-control">' +
                    '<button class="transfer-qty-minus" data-idx="' + i + '">-</button>' +
                    '<input type="number" class="transfer-qty-input" id="transfer-qty-' + i + '" value="0" min="0" max="' + item.qty + '" step="1" style="width:60px;text-align:center;">' +
                    '<button class="transfer-qty-plus" data-idx="' + i + '">+</button>' +
                    '<span>/ ' + item.qty + '</span>' +
                '</div>' +
            '</div>';
        }
        container.innerHTML = html;
        attachTransferQtyEvents();
        var targetInput = document.getElementById('transferTargetTable');
        if (targetInput) targetInput.value = '';
        document.getElementById('transferItemsModal').style.display = 'flex';
    });
}

function attachTransferQtyEvents() {
    var minusBtns = document.querySelectorAll('.transfer-qty-minus');
    var plusBtns = document.querySelectorAll('.transfer-qty-plus');
    for (var i = 0; i < minusBtns.length; i++) {
        minusBtns[i].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('transfer-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value, 10) || 0;
                    if (val > 0) input.value = val - 1;
                }
            };
        })(minusBtns[i]);
    }
    for (var j = 0; j < plusBtns.length; j++) {
        plusBtns[j].onclick = (function(btn) {
            return function() {
                var idx = btn.getAttribute('data-idx');
                var input = document.getElementById('transfer-qty-' + idx);
                if (input) {
                    var val = parseInt(input.value, 10) || 0;
                    var max = parseInt(input.getAttribute('max'), 10) || 0;
                    if (val < max) input.value = val + 1;
                }
            };
        })(plusBtns[j]);
    }
}

function confirmTransferItems() {
    if (!pendingTransferSourceTable) return;
    var sourceTable = pendingTransferSourceTable;
    // Chống bấm hai lần: hàm này ghi 2 lần (bàn đích nhận món + bàn nguồn còn
    // lại). Bấm 2 lần là món bị nhân đôi ở bàn đích.
    if (_splitTransferLocked('transfer_' + sourceTable.id, 'chuyển bàn')) return;

    var selectedItems = [];
    var remainingItems = [];
    for (var i = 0; i < sourceTable.items.length; i++) {
        var tsrc = sourceTable.items[i];
        remainingItems.push({
            id: tsrc.id,
            name: tsrc.name,
            price: tsrc.price,
            qty: tsrc.qty,
            variantName: tsrc.variantName
        });
    }
    var rows = document.querySelectorAll('.transfer-item-row');
    for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var idx = parseInt(row.getAttribute('data-idx'), 10);
        var input = document.getElementById('transfer-qty-' + idx);
        var qty = input ? (parseInt(input.value, 10) || 0) : 0;
        if (qty > 0) {
            var item = remainingItems[idx];
            if (!item) continue;
            if (qty > item.qty) qty = item.qty;
            selectedItems.push({ id: item.id, name: item.name, price: item.price, qty: qty, variantName: item.variantName });
            item.qty -= qty;
        }
    }
    if (selectedItems.length === 0) { showToast('Chưa chọn món để chuyển!', 'warning'); return; }
    
    var targetNameEl = document.getElementById('transferTargetTable');
    var targetName = targetNameEl ? targetNameEl.value.trim() : '';
    if (!targetName) { showToast('Nhập tên bàn đích!', 'warning'); return; }
    
    var allTablesPromise = (window.cachedTables && Array.isArray(window.cachedTables) && window.cachedTables.length > 0)
        ? Promise.resolve(window.cachedTables)
        : DB.getAll('tables');
        
    allTablesPromise.then(function(allTables) {
        var targetTable = null;
        for (var t = 0; t < allTables.length; t++) {
            if (allTables[t].name === targetName) { targetTable = allTables[t]; break; }
        }
        
        var createNew = false;
        if (!targetTable) {
            createNew = true;
            // FIX: dùng chung _nextTableNumber (khớp order.js/draft-orders.js).
            // Bản cũ dùng /Ban (\d+)/ -> không match "Bàn 05" có dấu, sinh trùng tên bàn.
            var newNumber = _nextTableNumber(allTables);
            if (newNumber > 99) { showToast('Đã đạt giới hạn 99 bàn!', 'warning'); return; }
            var now = new Date();
            var currentUser = DB.getCurrentUser();
            targetTable = {
                id: Date.now().toString(),
                name: _buildTableName(newNumber),
                status: 'occupied',
                time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
                startTime: now.toISOString(),
                items: [], total: 0, customerId: null, customerName: null,
                createdByName: (currentUser && currentUser.displayName) || '',
                createdByRole: (currentUser && currentUser.role) || ''
            };
        }
        
        var targetItems = targetTable.items ? _cloneArr(targetTable.items) : [];
        for (var s = 0; s < selectedItems.length; s++) {
            var sel = selectedItems[s];
            var found = false;
            for (var j = 0; j < targetItems.length; j++) {
                if (targetItems[j].name === sel.name) {
                    targetItems[j].qty += sel.qty;
                    found = true;
                    break;
                }
            }
            if (!found) targetItems.push({ id: sel.id, name: sel.name, price: sel.price, qty: sel.qty, variantName: sel.variantName, addedTime: new Date().toISOString() });
        }
        var newTargetTotal = targetItems.reduce(function(s2, i2) { return s2 + i2.price * i2.qty; }, 0);
        var finalSourceItems = remainingItems.filter(function(i2) { return i2.qty > 0; });
        var newSourceTotal = finalSourceItems.reduce(function(s2, i2) { return s2 + i2.price * i2.qty; }, 0);
        
        _withRealtimeSuppressed(function() {
            var createPromise = createNew ? DB.create('tables', targetTable, targetTable.id) : Promise.resolve();
            // Món chuyển sang có thể đã bị trừ kho ở bàn nguồn. Bàn đích phải
            // nhận cờ đó, nếu không lúc thanh toán sẽ trừ lần nữa.
            var flag = (sourceTable.ingredientsDeducted === true) || (targetTable.ingredientsDeducted === true);
            return createPromise.then(function() {
                return DB.update('tables', String(targetTable.id), { items: targetItems, total: newTargetTotal, ingredientsDeducted: flag });
            }).then(function() {
                // Bàn nguồn còn lại giữ nguyên trạng thái cờ của nó
                return DB.update('tables', String(sourceTable.id), { items: finalSourceItems, total: newSourceTotal, ingredientsDeducted: sourceTable.ingredientsDeducted === true });
            });
        }).then(function() {
            closeModal('transferItemsModal');
            // String() de id number/string van so sanh dung
            if (currentTableDetailId && String(currentTableDetailId) === String(sourceTable.id)) {
                showTableDetail(sourceTable.id);
            }
            if (typeof renderTables === 'function') renderTables();
            var totalQty = 0;
            for (var q = 0; q < selectedItems.length; q++) totalQty += selectedItems[q].qty;
            showToast('Đã chuyển ' + totalQty + ' món sang ' + targetName, 'success');
            _releaseSplitTransferLock('transfer_' + sourceTable.id);
        }).catch(function(err) {
            _releaseSplitTransferLock('transfer_' + sourceTable.id);
            showToast('❌ Lỗi chuyển món: ' + (err.message || err), 'error');
        });
    }).catch(function (err) {
        _releaseSplitTransferLock('transfer_' + sourceTable.id);
        console.error('[AUDIT] lỗi chuyển bàn:', err);
    });
}

// ========== GỘP BÀN ==========
function showMergeTableModal(sourceId) {
    pendingMergeSourceId = sourceId;
    _getTableFromCache(sourceId).then(function(source) {
        if (!source || !source.items || !source.items.length) { showToast('Bàn nguồn không có món!', 'warning'); return; }
        var allTablesPromise = (window.cachedTables && Array.isArray(window.cachedTables) && window.cachedTables.length > 0)
            ? Promise.resolve(window.cachedTables)
            : DB.getAll('tables');
        allTablesPromise.then(function(allTables) {
            var targets = allTables.filter(function(t) {
                return String(t.id) !== String(sourceId) && t.items && t.items.length && t.total > 0;
            });
            if (targets.length === 0) { showToast('Không có bàn nào để gộp!', 'warning'); return; }
            var container = document.getElementById('mergeTablesList');
            if (!container) return;
            var html = '';
            for (var i = 0; i < targets.length; i++) {
                var t2 = targets[i];
                // FIX: escapeHtml tên bàn + tên khách (trước đây tên khách chưa escape)
                html += '<div class="merge-table-item" data-id="' + escapeHtml(t2.id) + '"><strong>' + escapeHtml(t2.name) + '</strong> - ' +
                    escapeHtml(t2.customerName || 'chưa có khách') + ' - ' + formatMoney(t2.total) + '</div>';
            }
            container.innerHTML = html;
            var items = document.querySelectorAll('.merge-table-item');
            for (var k = 0; k < items.length; k++) {
                items[k].onclick = (function(el) {
                    return function() {
                        var targetId = el.getAttribute('data-id');
                        mergeTables(sourceId, targetId);
                        closeModal('mergeTableModal');
                    };
                })(items[k]);
            }
            document.getElementById('mergeTableModal').style.display = 'flex';
        });
    });
}

function mergeTables(sourceId, targetId) {
    if (String(sourceId) === String(targetId)) {
        showToast('❌ Không thể gộp bàn với chính nó!', 'error');
        return;
    }
    // Chống bấm hai lần: gộp 2 lần sẽ ghi mảng món của bàn đích 2 lần và xoá
    // bàn nguồn 2 lần -> mất món không phục hồi được.
    if (_splitTransferLocked('merge_' + sourceId + '_' + targetId, 'gộp bàn')) return;

    Promise.all([_getTableFromCache(sourceId), _getTableFromCache(targetId)]).then(function(results) {
        var source = results[0];
        var target = results[1];
        if (!source || !target) {
            _releaseSplitTransferLock('merge_' + sourceId + '_' + targetId);
            showToast('Không tìm thấy bàn nguồn hoặc bàn đích!', 'error');
            return;
        }
        if (!source.items || !source.items.length) {
            _releaseSplitTransferLock('merge_' + sourceId + '_' + targetId);
            showToast('Bàn nguồn không có món!', 'warning');
            return;
        }
        
        var targetItems = target.items ? _cloneArr(target.items) : [];
        for (var i = 0; i < source.items.length; i++) {
            var srcItem = source.items[i];
            var found = false;
            for (var j = 0; j < targetItems.length; j++) {
                if (targetItems[j].name === srcItem.name) {
                    targetItems[j].qty += srcItem.qty;
                    found = true;
                    break;
                }
            }
            if (!found) targetItems.push({ id: srcItem.id, name: srcItem.name, price: srcItem.price, qty: srcItem.qty, variantName: srcItem.variantName, addedTime: srcItem.addedTime });
        }
        var newTotal = targetItems.reduce(function(s, i2) { return s + i2.price * i2.qty; }, 0);
        
        // ===== GỘP BÀN AN TOÀN ĐA THIẾT BỊ =====
        //
        // Trước đây: ghi đè toàn bộ mảng items của bàn đích bằng bản cache
        // CÓ THỂ CŨ, rồi xoá bàn nguồn. Nếu máy khác vừa thêm món vào bàn đích
        // 30 giây trước, món đó bị xoá sạch VÀ bàn nguồn cũng bị xoá -> mất món
        // không phục hồi được.
        //
        // Nay: runTransaction trên bàn đích, đọc dữ liệu MỚI NHẤT từ server
        // rồi mới cộng món của bàn nguồn vào. Mọi món máy khác vừa thêm đều
        // được giữ lại. Sau đó mới xoá bàn nguồn.
        var mergeFlag = (source.ingredientsDeducted === true) || (target.ingredientsDeducted === true);
        var writeMerge;
        if (typeof DB.patchTable === 'function') {
            writeMerge = DB.patchTable(String(targetId), function (cur) {
                // Dùng mảng của BẢN MỚI NHẤT, không dùng targetItems đã tính sẵn
                var fresh = [];
                if (Array.isArray(cur.items)) {
                    for (var z = 0; z < cur.items.length; z++) {
                        if (cur.items[z]) {
                            var ci2 = {};
                            for (var kk in cur.items[z]) if (cur.items[z].hasOwnProperty(kk)) ci2[kk] = cur.items[z][kk];
                            fresh.push(ci2);
                        }
                    }
                }
                for (var s2 = 0; s2 < source.items.length; s2++) {
                    var si = source.items[s2];
                    if (!si) continue;
                    var hit = false;
                    for (var f2 = 0; f2 < fresh.length; f2++) {
                        if (fresh[f2].name === si.name) { fresh[f2].qty = (fresh[f2].qty || 0) + (si.qty || 0); hit = true; break; }
                    }
                    if (!hit) {
                        fresh.push({ id: si.id, name: si.name, price: si.price, qty: si.qty, variantName: si.variantName, addedTime: si.addedTime });
                    }
                }
                if (fresh.length === 0) return null;
                var t2 = 0;
                for (var m2 = 0; m2 < fresh.length; m2++) t2 += (fresh[m2].price || 0) * (fresh[m2].qty || 0);
                return { items: fresh, total: t2, ingredientsDeducted: mergeFlag };
            }).then(function (res) {
                if (!res.ok) throw new Error(res.reason || 'Không gộp được');
                return DB.remove('tables', String(sourceId));
            });
        } else {
            writeMerge = DB.update('tables', String(targetId), { items: targetItems, total: newTotal, ingredientsDeducted: mergeFlag }).then(function() {
                return DB.remove('tables', String(sourceId));
            });
        }

        _withRealtimeSuppressed(function() {
            return writeMerge;
        }).then(function() {
            // String() de id number/string van so sanh dung
            if (currentTableDetailId &&
                (String(currentTableDetailId) === String(sourceId) ||
                 String(currentTableDetailId) === String(targetId))) {
                showTableDetail(targetId);
            }
            if (typeof renderTables === 'function') renderTables();
            showToast('✅ Đã gộp bàn ' + source.name + ' vào ' + target.name, 'success');
            _releaseSplitTransferLock('merge_' + sourceId + '_' + targetId);
        }).catch(function(err) {
            _releaseSplitTransferLock('merge_' + sourceId + '_' + targetId);
            showToast('❌ Lỗi gộp bàn: ' + (err.message || err), 'error');
        });
    }).catch(function(err) {
        _releaseSplitTransferLock('merge_' + sourceId + '_' + targetId);
        console.error('[AUDIT] lỗi gộp bàn:', err);
    });
}

// ========== XÓA BÀN ==========
function showDeleteTableConfirm(tableId) {
    pendingDeleteTableId = tableId;
    _getTableFromCache(tableId).then(function(table) {
        if (!table) {
            showToast('Bàn không còn tồn tại!', 'warning');
            return;
        }
        
        // Đã chốt ngày -> admin vào thẳng, staff bị chặn
        if (typeof isDayClosed === 'function' && isDayClosed()) {
            if (DB.isAdmin()) {
                document.getElementById('deleteTableModal').style.display = 'flex';
                return;
            }
            closeModal('deleteTableModal');
            requirePassword('xóa bàn (đã chốt ngày hôm nay)', function() {
                document.getElementById('deleteTableModal').style.display = 'flex';
            });
            return;
        }
        
        // Không kiểm tra isTableLocked ở đây: bàn khóa đã được xử lý trong
        // showTableDetail() (gọi requirePassword trước khi gọi hàm này).
        // Kiểm tra lại sẽ gây nhập mật khẩu 2 lần.
        document.getElementById('deleteTableModal').style.display = 'flex';
    });
}

function confirmDeleteTable() {
    if (!pendingDeleteTableId) return;
    var tableId = pendingDeleteTableId;
    // Chống bấm hai lần: bấm 2 lần sẽ HOÀN KHO 2 LẦN (tồn kho phình lên,
    // hàng hoá bán ra lại thành có thêm) và ghi 2 dòng log xoá bàn.
    if (_splitTransferLocked('delTable_' + tableId, 'xoá bàn')) return;

    _getTableFromCache(tableId).then(function(table) {
        if (!table) {
            _releaseSplitTransferLock('delTable_' + tableId);
            closeModal('deleteTableModal');
            pendingDeleteTableId = null;
            showToast('Bàn không còn tồn tại!', 'warning');
            return;
        }
        doDeleteTable(table);
    }).catch(function (err) {
        _releaseSplitTransferLock('delTable_' + tableId);
        console.error('[AUDIT] lỗi xoá bàn:', err);
    });
}

function doDeleteTable(table) {
    var itemsSnapshot = table.items ? JSON.parse(JSON.stringify(table.items)) : [];
    var tableId = table.id;
    
    // Ghi lịch sử + hoàn nguyên nguyên liệu TRƯỚC, xóa bàn SAU.
    // Bản cũ gọi addHistory() mà không await rồi xóa bàn ngay -> nếu ghi lịch sử
    // chậm/lỗi thì mất dấu vết xóa bàn.
    _withRealtimeSuppressed(function() {
        // Chỉ hoàn kho cho những món THỰC SỰ đã bị trừ.
        // Bàn tạo từ đơn (order.js) đã trừ kho lúc thêm món -> xoá bàn phải hoàn.
        // Nhưng nếu bàn đó chưa từng bị trừ (ingredientsDeducted !== true) mà
        // vẫn hoàn -> tồn kho bị TĂNG ảo. Đây là điểm then chốt của cờ này.
        var restorePromise = (itemsSnapshot.length > 0 && table.ingredientsDeducted === true)
            ? restoreIngredients(itemsSnapshot)
            : Promise.resolve();
        return restorePromise.then(function() {
            var user = DB.getCurrentUser();
            return addHistory({
                type: 'delete_table',
                amount: table.total || 0,
                paymentMethod: 'delete',
                tableName: table.name,
                tableId: table.id,
                items: itemsSnapshot,
                customer: (table.customerName ? { name: table.customerName } : null),
                createdByName: (user && user.displayName) ? user.displayName : (table.createdByName || ''),
                startTime: table.startTime || null,
                endTime: new Date().toISOString(),
                tableTime: _calcTableTime(table.startTime) || ''
            });
        }).then(function() {
            return DB.remove('tables', String(tableId));
        });
    }).then(function() {
        logDelete('delete_table', {
            tableId: table.id,
            tableName: table.name,
            items: itemsSnapshot,
            customerName: table.customerName || null,
            createdByName: table.createdByName || '',
            startTime: table.startTime || null,
            total: table.total || 0
        });
        
        // So sanh bang String(): id ban co the la number (tu merge/chuyen ban tao
        // moi) hoac string (tu Firebase). === se fail neu 1 ben la number ->
        // modal chi tiet khong dong lai, ban da xoa nhung van con man hinh mo.
        if (currentTableDetailId && String(currentTableDetailId) === String(tableId)) {
            closeModal('tableDetailModal');
        }
        closeModal('deleteTableModal');
        // Toast 1 dòng, thống nhất với panel "Giao dịch gần đây"
        var _actor = DB.getCurrentUser();
        showActivityToast('🗑️', {
            amount: table.total || 0,
            paymentMethod: 'delete',
            type: 'delete_table',
            tableName: table.name,
            items: itemsSnapshot,
            customer: (table.customerName ? { name: table.customerName } : null),
            createdByName: (_actor && _actor.displayName) || table.createdByName || '',
            createdByRole: (_actor && _actor.role) || table.createdByRole || ''
        }, 'success');
        if (typeof renderTables === 'function') renderTables();
        _releaseSplitTransferLock('delTable_' + table.id);
    }).catch(function(err) {
        _releaseSplitTransferLock('delTable_' + table.id);
        showToast('❌ Lỗi xóa bàn: ' + (err.message || err), 'error');
    });
}

// Export global
window.showSplitBillModal = showSplitBillModal;
window.showTransferItemsModal = showTransferItemsModal;
window.showMergeTableModal = showMergeTableModal;
window.confirmTransferItems = confirmTransferItems;
window.mergeTables = mergeTables;
window.showDeleteTableConfirm = showDeleteTableConfirm;
window.confirmDeleteTable = confirmDeleteTable;
