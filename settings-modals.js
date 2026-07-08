// settings-modals.js - Detail modals (active tables, debt, grab, cost, transfer, cash)
// ES5, tương thích Android 6, iOS 12
// ============================================================
// Phụ thuộc: settings-core.js

function showActiveTablesModal() {
    DB.getAll('tables').then(function(allTables) {
        var activeTables = allTables.filter(function(t) { return (t.items && t.items.length) || t.total > 0; });
        
        var modalId = 'activeTablesModal_' + Date.now();
        var html = '<div class="modal" id="' + modalId + '" onclick="if(event.target===this)window.closeModal(\'' + modalId + '\')">' +
            '<div class="modal-content">' +
                '<div class="modal-header">' +
                    '<span class="modal-title">🪑 Bàn đang hoạt động</span>' +
                    '<span class="modal-close" onclick="window.closeModal(\'' + modalId + '\')">&times;</span>' +
                '</div>' +
                '<div class="modal-body" style="max-height:60vh;overflow-y:auto;">';
        
        if (activeTables.length === 0) {
            html += '<div class="empty-state">✅ Không có bàn nào đang hoạt động</div>';
        } else {
            var total = 0;
            var totalTables = activeTables.length;
            for (var i = 0; i < activeTables.length; i++) {
                var t = activeTables[i];
                total += t.total || 0;
                var displayName = t.customerName ? t.customerName : ((t.name && t.name.trim()) ? t.name : 'Bàn ' + t.id);
                
                // Lấy danh sách món
                var items = t.items || [];
                var totalQty = 0;
                var itemNames = [];
                for (var k = 0; k < items.length; k++) {
                    var item = items[k];
                    var qty = item.qty || 1;
                    totalQty += qty;
                    itemNames.push(item.name + ' x' + qty);
                }
                
                html += '<div style="padding:10px 0;border-bottom:1px solid var(--border);">' +
                            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                                '<span style="font-weight:600;">🪑 ' + escapeHtml(displayName) + '</span>' +
                                '<span style="font-weight:600;color:#ca8a04;">' + formatMoney(t.total || 0) + '</span>' +
                            '</div>' +
                            '<div style="font-size:12px;color:#64748b;margin-top:2px;">' +
                                '<span>📦 ' + totalQty + ' món: ' + escapeHtml(itemNames.join(', ')) + '</span>' +
                            '</div>' +
                        '</div>';
            }
            html += '<div style="display:flex;justify-content:space-between;padding:12px 0 0;margin-top:4px;font-weight:700;font-size:16px;border-top:2px solid var(--border);">' +
                        '<span>📊 Tổng bàn: ' + totalTables + ' bàn</span>' +
                        '<span style="color:#ca8a04;">' + formatMoney(total) + '</span>' +
                    '</div>';
        }
        
        html += '    </div>' +
            '</div>' +
        '</div>';
        
        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
        openBottomSheet(modalId);
    });
}

// ========== HIỂN THỊ DANH SÁCH KHÁCH NỢ TRONG NGÀY ==========
function showDebtDetailModal() {
    var data = _posCashData;
    if (!data || !data.debtCount || data.debtCount <= 0) {
        showToast('⚠️ Không có đơn nợ trong ngày', 'warning');
        return;
    }
    var dateKey = data.dateKey || (typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10));

    // Lấy danh sách giao dịch trong ngày để lọc đơn nợ
    var txPromise = (typeof DB !== 'undefined' && typeof DB.getTransactionsByDate === 'function')
        ? DB.getTransactionsByDate(dateKey)
        : Promise.resolve([]);

    txPromise.then(function(transactions) {
        // Lọc các giao dịch nợ
        var debtTxs = [];
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            if (tx.paymentMethod === 'debt' && !tx.refunded) {
                debtTxs.push(tx);
            }
        }

        var modalId = 'debtDetailModal_' + Date.now();
        var html = '<div class="modal" id="' + modalId + '" onclick="if(event.target===this)window.closeModal(\'' + modalId + '\')">' +
            '<div class="modal-content">' +
                '<div class="modal-header">' +
                    '<span class="modal-title">📝 Danh sách nợ trong ngày</span>' +
                    '<span class="modal-close" onclick="window.closeModal(\'' + modalId + '\')">&times;</span>' +
                '</div>' +
                '<div class="modal-body" style="max-height:60vh;overflow-y:auto;">';

        if (debtTxs.length === 0) {
            html += '<div class="empty-state">✅ Không có đơn nợ nào</div>';
        } else {
            var totalDebt = 0;
            for (var j = 0; j < debtTxs.length; j++) {
                var tx = debtTxs[j];
                var amt = tx.amount || 0;
                totalDebt += amt;

                // Lấy tên khách hàng
                var customerName = '';
                if (tx.customerName) {
                    customerName = tx.customerName;
                } else if (tx.customer && tx.customer.name) {
                    customerName = tx.customer.name;
                } else {
                    customerName = 'Khách lẻ';
                }

                // Lấy thời gian tạo đơn
                var timeStr = '';
                if (tx.createdAt) {
                    var d = new Date(tx.createdAt);
                    timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                } else if (tx.created) {
                    var d2 = new Date(tx.created);
                    timeStr = ('0' + d2.getHours()).slice(-2) + ':' + ('0' + d2.getMinutes()).slice(-2);
                }

                html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border);">' +
                            '<div style="display:flex;flex-direction:column;gap:2px;">' +
                                '<span style="font-weight:600;">👤 ' + escapeHtml(customerName) + '</span>' +
                                (timeStr ? '<span style="font-size:11px;color:#94a3b8;">🕐 ' + timeStr + '</span>' : '') +
                            '</div>' +
                            '<span style="font-weight:600;color:#dc2626;">' + formatMoney(amt) + '</span>' +
                        '</div>';
            }

            // Tổng kết
            html += '<div style="display:flex;justify-content:space-between;padding:12px 0 0;margin-top:4px;font-weight:700;font-size:16px;border-top:2px solid var(--border);">' +
                        '<span>📊 Tổng nợ</span>' +
                        '<span style="color:#dc2626;">' + debtTxs.length + ' đơn - ' + formatMoney(totalDebt) + '</span>' +
                    '</div>';
        }

        html += '    </div>' +
            '</div>' +
        '</div>';

        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
        openBottomSheet(modalId);
    }).catch(function(err) {
        console.error('[DebtDetail] Lỗi khi lấy dữ liệu:', err);
        showToast('⚠️ Lỗi khi tải dữ liệu nợ', 'error');
    });
}

// ========== HIỂN THỊ DANH SÁCH ĐƠN GRAB TRONG NGÀY ==========
function showGrabDetailModal() {
    var data = _posCashData;
    if (!data || !data.grabCount || data.grabCount <= 0) {
        showToast('⚠️ Không có đơn Grab trong ngày', 'warning');
        return;
    }
    var dateKey = data.dateKey || (typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10));

    // Lấy danh sách giao dịch trong ngày để lọc đơn Grab
    var txPromise = (typeof DB !== 'undefined' && typeof DB.getTransactionsByDate === 'function')
        ? DB.getTransactionsByDate(dateKey)
        : Promise.resolve([]);

    txPromise.then(function(transactions) {
        // Lọc các giao dịch Grab
        var grabTxs = [];
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            if (tx.paymentMethod === 'grab' && !tx.refunded) {
                grabTxs.push(tx);
            }
        }

        var modalId = 'grabDetailModal_' + Date.now();
        var html = '<div class="modal" id="' + modalId + '" onclick="if(event.target===this)window.closeModal(\'' + modalId + '\')">' +
            '<div class="modal-content">' +
                '<div class="modal-header">' +
                    '<span class="modal-title">🛵 Danh sách đơn Grab</span>' +
                    '<span class="modal-close" onclick="window.closeModal(\'' + modalId + '\')">&times;</span>' +
                '</div>' +
                '<div class="modal-body" style="max-height:60vh;overflow-y:auto;">';

        if (grabTxs.length === 0) {
            html += '<div class="empty-state">✅ Không có đơn Grab nào</div>';
        } else {
            var totalAmount = 0;
            for (var j = 0; j < grabTxs.length; j++) {
                var tx = grabTxs[j];
                var amt = tx.amount || 0;
                totalAmount += amt;

                // Lấy thời gian tạo đơn
                var timeStr = '';
                if (tx.createdAt) {
                    var d = new Date(tx.createdAt);
                    timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                } else if (tx.created) {
                    var d2 = new Date(tx.created);
                    timeStr = ('0' + d2.getHours()).slice(-2) + ':' + ('0' + d2.getMinutes()).slice(-2);
                }

                // Đếm tổng số lượng món
                var items = tx.items || [];
                var totalQty = 0;
                var itemNames = [];
                for (var k = 0; k < items.length; k++) {
                    var item = items[k];
                    var qty = item.qty || 1;
                    totalQty += qty;
                    itemNames.push(item.name + ' x' + qty);
                }

                html += '<div style="padding:10px 0;border-bottom:1px solid var(--border);">' +
                            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                                '<div style="display:flex;align-items:center;gap:6px;">' +
                                    '<span style="font-weight:600;">🛵 Đơn #' + (j + 1) + '</span>' +
                                    (timeStr ? '<span style="font-size:11px;color:#94a3b8;">🕐 ' + timeStr + '</span>' : '') +
                                '</div>' +
                                '<span style="font-weight:600;color:#ca8a04;">' + formatMoney(amt) + '</span>' +
                            '</div>' +
                            '<div style="font-size:12px;color:#64748b;margin-top:2px;">' +
                                '<span>📦 ' + totalQty + ' món: ' + escapeHtml(itemNames.join(', ')) + '</span>' +
                            '</div>' +
                        '</div>';
            }

            // Tổng kết
            html += '<div style="display:flex;justify-content:space-between;padding:12px 0 0;margin-top:4px;font-weight:700;font-size:16px;border-top:2px solid var(--border);">' +
                        '<span>📊 Tổng Grab</span>' +
                        '<span style="color:#ca8a04;">' + grabTxs.length + ' đơn - ' + formatMoney(totalAmount) + '</span>' +
                    '</div>';
        }

        html += '    </div>' +
            '</div>' +
        '</div>';

        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
        openBottomSheet(modalId);
    }).catch(function(err) {
        console.error('[GrabDetail] Lỗi khi lấy dữ liệu:', err);
        showToast('⚠️ Lỗi khi tải dữ liệu Grab', 'error');
    });
}

// ========== HIỂN THỊ CHI TIẾT CHI PHÍ KÉT POS & QLTT ==========
function showPosCostDetailModal() {
    var data = _posCashData;
    if (!data || !data.posCostList || data.posCostList.length === 0) {
        showToast('⚠️ Không có chi phí trong ngày', 'warning');
        return;
    }
    var dateKey = data.dateKey || (typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10));

    // Lọc chi phí trong ngày, chưa bị xóa
    var allCosts = data.posCostList;
    var posCosts = [];  // fundSource === 'pos_cash'
    var qlttCosts = []; // fundSource !== 'pos_cash'

    for (var i = 0; i < allCosts.length; i++) {
        var c = allCosts[i];
        if (c.dateKey === dateKey && !c.deleted) {
            if (c.fundSource === 'pos_cash') {
                posCosts.push(c);
            } else {
                qlttCosts.push(c);
            }
        }
    }

    if (posCosts.length === 0 && qlttCosts.length === 0) {
        showToast('⚠️ Không có chi phí trong ngày', 'warning');
        return;
    }

    var modalId = 'posCostDetailModal_' + Date.now();
    var html = '<div class="modal" id="' + modalId + '" onclick="if(event.target===this)window.closeModal(\'' + modalId + '\')">' +
        '<div class="modal-content">' +
            '<div class="modal-header">' +
                '<span class="modal-title">🏦 Chi tiết chi phí</span>' +
                '<span class="modal-close" onclick="window.closeModal(\'' + modalId + '\')">&times;</span>' +
            '</div>' +
            '<div class="modal-body" style="max-height:60vh;overflow-y:auto;">';

    // --- Két POS ---
    if (posCosts.length > 0) {
        var posTotal = 0;
        html += '<div style="margin-bottom:12px;">' +
                    '<div style="font-weight:700;font-size:15px;color:#2563eb;padding:8px 0;border-bottom:2px solid #2563eb;margin-bottom:4px;">🏦 Két POS</div>';
        for (var j = 0; j < posCosts.length; j++) {
            var c = posCosts[j];
            posTotal += c.amount;

            // Lấy thời gian
            var timeStr = '';
            if (c.createdAt) {
                var d = new Date(c.createdAt);
                timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
            } else if (c.date) {
                var d2 = new Date(c.date);
                timeStr = ('0' + d2.getHours()).slice(-2) + ':' + ('0' + d2.getMinutes()).slice(-2);
            }

            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">' +
                        '<div style="display:flex;flex-direction:column;gap:2px;">' +
                            '<span style="font-weight:500;">' + escapeHtml(c.categoryName || 'Không tên') + '</span>' +
                            (timeStr ? '<span style="font-size:11px;color:#94a3b8;">🕐 ' + timeStr + '</span>' : '') +
                        '</div>' +
                        '<span style="font-weight:600;color:#dc2626;">' + formatMoney(c.amount) + '</span>' +
                    '</div>';
        }
        html += '<div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:4px;font-weight:700;font-size:15px;border-top:2px solid var(--border);">' +
                    '<span>📊 Tổng Két POS</span>' +
                    '<span style="color:#2563eb;">' + posCosts.length + ' khoản - ' + formatMoney(posTotal) + '</span>' +
                '</div>' +
            '</div>';
    }

    // --- QLTT ---
    if (qlttCosts.length > 0) {
        var qlttTotal = 0;
        html += '<div style="margin-bottom:8px;">' +
                    '<div style="font-weight:700;font-size:15px;color:#7c3aed;padding:8px 0;border-bottom:2px solid #7c3aed;margin-bottom:4px;">👔 QLTT</div>';
        for (var k = 0; k < qlttCosts.length; k++) {
            var c2 = qlttCosts[k];
            qlttTotal += c2.amount;

            var timeStr2 = '';
            if (c2.createdAt) {
                var d3 = new Date(c2.createdAt);
                timeStr2 = ('0' + d3.getHours()).slice(-2) + ':' + ('0' + d3.getMinutes()).slice(-2);
            } else if (c2.date) {
                var d4 = new Date(c2.date);
                timeStr2 = ('0' + d4.getHours()).slice(-2) + ':' + ('0' + d4.getMinutes()).slice(-2);
            }

            html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);">' +
                        '<div style="display:flex;flex-direction:column;gap:2px;">' +
                            '<span style="font-weight:500;">' + escapeHtml(c2.categoryName || 'Không tên') + '</span>' +
                            (timeStr2 ? '<span style="font-size:11px;color:#94a3b8;">🕐 ' + timeStr2 + '</span>' : '') +
                        '</div>' +
                        '<span style="font-weight:600;color:#dc2626;">' + formatMoney(c2.amount) + '</span>' +
                    '</div>';
        }
        html += '<div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:4px;font-weight:700;font-size:15px;border-top:2px solid var(--border);">' +
                    '<span>📊 Tổng QLTT</span>' +
                    '<span style="color:#7c3aed;">' + qlttCosts.length + ' khoản - ' + formatMoney(qlttTotal) + '</span>' +
                '</div>' +
            '</div>';
    }

    // Tổng kết tất cả
    var allTotal = 0;
    var allCount = 0;
    for (var m = 0; m < posCosts.length; m++) { allTotal += posCosts[m].amount; allCount++; }
    for (var n = 0; n < qlttCosts.length; n++) { allTotal += qlttCosts[n].amount; allCount++; }

    html += '<div style="display:flex;justify-content:space-between;padding:12px 0 0;margin-top:8px;font-weight:700;font-size:16px;border-top:2px solid var(--border);">' +
                '<span>💰 Tổng chi phí</span>' +
                '<span style="color:#dc2626;">' + allCount + ' khoản - ' + formatMoney(allTotal) + '</span>' +
            '</div>';

    html += '    </div>' +
        '</div>' +
    '</div>';

    var div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
    openBottomSheet(modalId);
}

// ========== HIỂN THỊ CHI TIẾT GIAO DỊCH CHUYỂN KHOẢN ==========
function showTransferDetailModal() {
    var data = _posCashData;
    if (!data || !data.transferCount || data.transferCount <= 0) {
        showToast('⚠️ Không có giao dịch chuyển khoản trong ngày', 'warning');
        return;
    }
    var dateKey = data.dateKey || (typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10));

    // Lấy danh sách giao dịch trong ngày để lọc đơn chuyển khoản
    var txPromise = (typeof DB !== 'undefined' && typeof DB.getTransactionsByDate === 'function')
        ? DB.getTransactionsByDate(dateKey)
        : Promise.resolve([]);

    txPromise.then(function(transactions) {
        // Lọc các giao dịch chuyển khoản
        var transferTxs = [];
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            if (tx.paymentMethod === 'transfer' && !tx.refunded) {
                transferTxs.push(tx);
            }
        }

        var modalId = 'transferDetailModal_' + Date.now();
        var html = '<div class="modal" id="' + modalId + '" onclick="if(event.target===this)window.closeModal(\'' + modalId + '\')">' +
            '<div class="modal-content">' +
                '<div class="modal-header">' +
                    '<span class="modal-title">💳 Chi tiết chuyển khoản</span>' +
                    '<span class="modal-close" onclick="window.closeModal(\'' + modalId + '\')">&times;</span>' +
                '</div>' +
                '<div class="modal-body" style="max-height:60vh;overflow-y:auto;">';

        if (transferTxs.length === 0) {
            html += '<div class="empty-state">✅ Không có giao dịch chuyển khoản nào</div>';
        } else {
            var totalAmount = 0;
            for (var j = 0; j < transferTxs.length; j++) {
                var tx = transferTxs[j];
                var amt = tx.amount || 0;
                totalAmount += amt;

                // Lấy thời gian tạo đơn
                var timeStr = '';
                if (tx.createdAt) {
                    var d = new Date(tx.createdAt);
                    timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                } else if (tx.created) {
                    var d2 = new Date(tx.created);
                    timeStr = ('0' + d2.getHours()).slice(-2) + ':' + ('0' + d2.getMinutes()).slice(-2);
                }

                // Xác định tên khách hàng / bàn
                var customerLabel = '';
                if (tx.tableName) {
                    customerLabel = '🪑 ' + tx.tableName;
                } else if (tx.customer) {
                    customerLabel = '👤 ' + tx.customer;
                } else if (tx.note) {
                    customerLabel = '📝 ' + tx.note;
                } else {
                    customerLabel = '🚶 Mang đi';
                }

                // Đếm tổng số lượng món
                var items = tx.items || [];
                var totalQty = 0;
                var itemNames = [];
                for (var k = 0; k < items.length; k++) {
                    var item = items[k];
                    var qty = item.qty || 1;
                    totalQty += qty;
                    itemNames.push(item.name + ' x' + qty);
                }

                html += '<div style="padding:10px 0;border-bottom:1px solid var(--border);">' +
                            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                                '<div style="display:flex;align-items:center;gap:6px;">' +
                                    '<span style="font-weight:600;">💳 Đơn #' + (j + 1) + '</span>' +
                                    (timeStr ? '<span style="font-size:11px;color:#94a3b8;">🕐 ' + timeStr + '</span>' : '') +
                                '</div>' +
                                '<span style="font-weight:600;color:#2563eb;">' + formatMoney(amt) + '</span>' +
                            '</div>' +
                            '<div style="font-size:12px;color:#64748b;margin-top:2px;">' +
                                '<div>' + customerLabel + '</div>' +
                                (itemNames.length > 0 ? '<div style="margin-top:2px;">📦 ' + totalQty + ' món: ' + escapeHtml(itemNames.join(', ')) + '</div>' : '') +
                            '</div>' +
                        '</div>';
            }

            // Tổng kết
            html += '<div style="display:flex;justify-content:space-between;padding:12px 0 0;margin-top:4px;font-weight:700;font-size:16px;border-top:2px solid var(--border);">' +
                        '<span>📊 Tổng chuyển khoản</span>' +
                        '<span style="color:#2563eb;">' + transferTxs.length + ' đơn - ' + formatMoney(totalAmount) + '</span>' +
                    '</div>';
        }

        html += '    </div>' +
            '</div>' +
        '</div>';

        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
        openBottomSheet(modalId);
    }).catch(function(err) {
        console.error('[TransferDetail] Lỗi khi lấy dữ liệu:', err);
        showToast('⚠️ Lỗi khi tải dữ liệu chuyển khoản', 'error');
    });
}

// ========== HIỂN THỊ CHI TIẾT GIAO DỊCH TIỀN MẶT ==========
function showCashDetailModal() {
    var data = _posCashData;
    if (!data || !data.cashCount || data.cashCount <= 0) {
        showToast('⚠️ Không có giao dịch tiền mặt trong ngày', 'warning');
        return;
    }
    var dateKey = data.dateKey || (typeof getTodayDateKey === 'function' ? getTodayDateKey() : new Date().toISOString().slice(0, 10));

    // Lấy danh sách giao dịch trong ngày để lọc đơn tiền mặt
    var txPromise = (typeof DB !== 'undefined' && typeof DB.getTransactionsByDate === 'function')
        ? DB.getTransactionsByDate(dateKey)
        : Promise.resolve([]);

    txPromise.then(function(transactions) {
        // Lọc các giao dịch tiền mặt
        var cashTxs = [];
        for (var i = 0; i < transactions.length; i++) {
            var tx = transactions[i];
            if (tx.paymentMethod === 'cash' && !tx.refunded) {
                cashTxs.push(tx);
            }
        }

        var modalId = 'cashDetailModal_' + Date.now();
        var html = '<div class="modal" id="' + modalId + '" onclick="if(event.target===this)window.closeModal(\'' + modalId + '\')">' +
            '<div class="modal-content">' +
                '<div class="modal-header">' +
                    '<span class="modal-title">💵 Chi tiết tiền mặt</span>' +
                    '<span class="modal-close" onclick="window.closeModal(\'' + modalId + '\')">&times;</span>' +
                '</div>' +
                '<div class="modal-body" style="max-height:60vh;overflow-y:auto;">';

        if (cashTxs.length === 0) {
            html += '<div class="empty-state">✅ Không có giao dịch tiền mặt nào</div>';
        } else {
            var totalAmount = 0;
            for (var j = 0; j < cashTxs.length; j++) {
                var tx = cashTxs[j];
                var amt = tx.amount || 0;
                totalAmount += amt;

                // Lấy thời gian tạo đơn
                var timeStr = '';
                if (tx.createdAt) {
                    var d = new Date(tx.createdAt);
                    timeStr = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
                } else if (tx.created) {
                    var d2 = new Date(tx.created);
                    timeStr = ('0' + d2.getHours()).slice(-2) + ':' + ('0' + d2.getMinutes()).slice(-2);
                }

                // Xác định tên khách hàng / bàn
                var customerLabel = '';
                if (tx.tableName) {
                    customerLabel = '🪑 ' + tx.tableName;
                } else if (tx.customer) {
                    customerLabel = '👤 ' + tx.customer;
                } else if (tx.note) {
                    customerLabel = '📝 ' + tx.note;
                } else {
                    customerLabel = '🚶 Mang đi';
                }

                // Đếm tổng số lượng món
                var items = tx.items || [];
                var totalQty = 0;
                var itemNames = [];
                for (var k = 0; k < items.length; k++) {
                    var item = items[k];
                    var qty = item.qty || 1;
                    totalQty += qty;
                    itemNames.push(item.name + ' x' + qty);
                }

                html += '<div style="padding:10px 0;border-bottom:1px solid var(--border);">' +
                            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                                '<div style="display:flex;align-items:center;gap:6px;">' +
                                    '<span style="font-weight:600;">💵 Đơn #' + (j + 1) + '</span>' +
                                    (timeStr ? '<span style="font-size:11px;color:#94a3b8;">🕐 ' + timeStr + '</span>' : '') +
                                '</div>' +
                                '<span style="font-weight:600;color:#16a34a;">' + formatMoney(amt) + '</span>' +
                            '</div>' +
                            '<div style="font-size:12px;color:#64748b;margin-top:2px;">' +
                                '<div>' + customerLabel + '</div>' +
                                (itemNames.length > 0 ? '<div style="margin-top:2px;">📦 ' + totalQty + ' món: ' + escapeHtml(itemNames.join(', ')) + '</div>' : '') +
                            '</div>' +
                        '</div>';
            }

            // Tổng kết
            html += '<div style="display:flex;justify-content:space-between;padding:12px 0 0;margin-top:4px;font-weight:700;font-size:16px;border-top:2px solid var(--border);">' +
                        '<span>📊 Tổng tiền mặt</span>' +
                        '<span style="color:#16a34a;">' + cashTxs.length + ' đơn - ' + formatMoney(totalAmount) + '</span>' +
                    '</div>';
        }

        html += '    </div>' +
            '</div>' +
        '</div>';

        var div = document.createElement('div');
        div.innerHTML = html;
        document.body.appendChild(div.firstElementChild);
        openBottomSheet(modalId);
    }).catch(function(err) {
        console.error('[CashDetail] Lỗi khi lấy dữ liệu:', err);
        showToast('⚠️ Lỗi khi tải dữ liệu tiền mặt', 'error');
    });
}