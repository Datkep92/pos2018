// order.js - Tạo đơn hàng, thêm món, giỏ hàng
// BỐ CỤC 3 CỘT: Danh mục | Menu | Giỏ hàng

// ========== MỞ MODAL ==========
function openAddMenuForTable(tableId) {
    currentAddToTableId = tableId;
    tempOrder = [];
    selectedCustomer = null;
    openOrderModal();
}

function openCreateOrderModal() {
    currentAddToTableId = null;
    tempOrder = [];
    selectedCustomer = null;
    openOrderModal();
}

function openOrderModal() {
    renderOrderCategoriesColumn();
    renderMenuByCategory('all');
    renderCartColumn();
    document.getElementById('orderModal').style.display = 'flex';
}

// ========== RENDER CỘT DANH MỤC (dọc) ==========
function renderOrderCategoriesColumn() {
    var container = document.getElementById('orderCategoriesColumn');
    if (!container) return;
    
    // CHỈ DÙNG DANH MỤC TỪ DATABASE, KHÔNG CÓ HARDCODE
    var categories = [];
    
    // Thêm danh mục "Tất cả" thủ công
    categories.push({ id: 'all', icon: '📋', name: 'Tất cả' });
    
    // Lấy danh mục từ database (window.menuCategories)
    if (window.menuCategories && window.menuCategories.length) {
        for (var i = 0; i < window.menuCategories.length; i++) {
            var cat = window.menuCategories[i];
            categories.push({ 
                id: cat.id, 
                icon: cat.icon || '📌', 
                name: cat.name 
            });
        }
    }
    
    var html = '';
    for (var i = 0; i < categories.length; i++) {
        var cat = categories[i];
        var activeClass = (currentMenuCategory === cat.id) ? 'active' : '';
        html += '<div class="category-item ' + activeClass + '" data-cat="' + cat.id + '" onclick="renderMenuByCategory(\'' + cat.id + '\')">' +
            '<span class="cat-icon">' + cat.icon + '</span>' +
            '<span>' + escapeHtml(cat.name) + '</span>' +
        '</div>';
    }
    container.innerHTML = html;
}

// ========== RENDER MENU THEO DANH MỤC ==========
function renderMenuByCategory(categoryId) {
    currentMenuCategory = categoryId;
    
    // Lọc món theo danh mục
    var items = [];
    if (categoryId === 'all') {
        items = menuItems.slice();
    } else {
        items = menuItems.filter(function(i) { return i.categoryId == categoryId; });
    }
    
    var container = document.getElementById('menuGrid');
    if (!container) return;
    
    if (items.length === 0) {
        container.innerHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8;">📭 Không có món</div>';
        return;
    }
    
    var html = '';
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.hasVariants && item.variants && item.variants.length) {
            // Có biến thể
            var variantsHtml = '';
            for (var v = 0; v < item.variants.length; v++) {
                var variant = item.variants[v];
                variantsHtml += '<button class="variant-btn" onclick="addToCartWithVariant(\'' + item.id + '\', \'' + escapeHtml(variant.name) + '\', ' + variant.price + ')">' + escapeHtml(variant.name) + '</button>';
            }
            html += '<div class="menu-item-variant">' +
                '<div class="menu-name">' + escapeHtml(item.name) + '</div>' +
                '<div class="variant-group">' + variantsHtml + '</div>' +
            '</div>';
        } else {
            // Món đơn
            var price = item.price || 0;
            html += '<div class="menu-card" onclick="addToCart(\'' + item.id + '\', \'' + escapeHtml(item.name) + '\', ' + price + ')">' +
                '<div class="menu-name">' + escapeHtml(item.name) + '</div>' +
                '<div class="menu-price">' + formatMoney(price) + '</div>' +
            '</div>';
        }
    }
    container.innerHTML = html;
    
    // Cập nhật active cho danh mục
    var cats = document.querySelectorAll('#orderCategoriesColumn .category-item');
    for (var i = 0; i < cats.length; i++) {
        var cat = cats[i].getAttribute('data-cat');
        if (cat == categoryId) cats[i].classList.add('active');
        else cats[i].classList.remove('active');
    }
}

// ========== RENDER GIỎ HÀNG (cột 3) ==========
function renderCartColumn() {
    var container = document.getElementById('cartItemsList');
    var totalSpan = document.getElementById('cartTotalAmount');
    var actionsDiv = document.getElementById('cartFooterActions');
    
    if (!container) return;
    
    if (tempOrder.length === 0) {
        container.innerHTML = '<div class="empty-cart">🛒 Chưa có món nào</div>';
        if (totalSpan) totalSpan.innerText = '0đ';
        return;
    }
    
    var total = 0;
    var itemCount = 0;
    var html = '';
    
    for (var i = 0; i < tempOrder.length; i++) {
        var item = tempOrder[i];
        var itemTotal = item.price * item.qty;
        total += itemTotal;
        itemCount += item.qty;
        
        var timeStr = '';
        if (item.addedTime) {
            var date = new Date(item.addedTime);
            timeStr = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
        }
        
        // UI MỚI: 2 DÒNG
        html += '<div class="cart-item-compact" data-idx="' + i + '" style="margin-bottom: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 8px;">' +
            /* DÒNG 1: Tên món + Giá */
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">' +
                '<span style="font-weight: 500; font-size: 14px;">' + escapeHtml(item.name) + '</span>' +
                '<span style="font-weight: 600; color: #f97316; font-size: 14px;">' + formatMoney(itemTotal) + '</span>' +
            '</div>' +
            /* DÒNG 2: Giờ + Điều khiển số lượng */
            '<div style="display: flex; justify-content: space-between; align-items: center;">' +
                '<span style="font-size: 10px; color: #94a3b8;">' + (timeStr ? '🕒 ' + timeStr : '') + '</span>' +
                '<div style="display: flex; align-items: center; gap: 8px;">' +
                    '<button class="cart-qty-btn" onclick="updateCartQty(' + i + ', -1)" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid #e2e8f0; background: white; cursor: pointer;">−</button>' +
                    '<span style="min-width: 28px; text-align: center; font-weight: 500;">' + item.qty + '</span>' +
                    '<button class="cart-qty-btn" onclick="updateCartQty(' + i + ', 1)" style="width: 28px; height: 28px; border-radius: 6px; border: 1px solid #e2e8f0; background: white; cursor: pointer;">+</button>' +
                    '<button class="cart-remove-btn" onclick="removeFromCart(' + i + ')" style="background: none; border: none; color: #ef4444; font-size: 16px; cursor: pointer; width: 28px;">✖</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }
    container.innerHTML = html;
    if (totalSpan) totalSpan.innerText = formatMoney(total);
    
    // Render nút action (giữ nguyên phần này)
    if (actionsDiv) {
        if (currentAddToTableId) {
            actionsDiv.innerHTML = '<button class="action-btn btn-table" onclick="handleAddToExistingTable()">🍽️ Thêm vào bàn</button>';
        } else {
            actionsDiv.innerHTML = 
                '<div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e2e8f0; margin-bottom: 8px;">' +
                    '<button class="action-btn btn-table" onclick="handleCreateNewTable()" style="flex: 2;">🍽️ Tạo bàn mới</button>' +
                    '<span style="font-size: 12px; color: #475569; text-align: center; flex: 1;">' + itemCount + ' món</span>' +
                    '<span style="font-weight: 600; color: #f97316; flex: 1; text-align: right;">' + formatMoney(total) + '</span>' +
                '</div>' +
                '<div style="display: flex; gap: 6px; flex-wrap: wrap;">' +
                    '<button class="action-btn btn-cash" onclick="handleTakeawayPayment(\'cash\')" style="flex: 1; padding: 8px 4px; font-size: 12px;">💰 TM</button>' +
                    '<button class="action-btn btn-transfer" onclick="handleTakeawayPayment(\'transfer\')" style="flex: 1; padding: 8px 4px; font-size: 12px;">💳 CK</button>' +
                    '<button class="action-btn btn-grab" onclick="handleGrabOrder()" style="flex: 1; padding: 8px 4px; font-size: 12px;">🚕 GR</button>' +
                    '<button class="action-btn btn-debt" onclick="handleDebtOrder()" style="flex: 1; padding: 8px 4px; font-size: 12px;">💢 Nợ</button>' +
                '</div>';
        }
    }
}

// Cập nhật lại hàm renderCart để gọi renderCartColumn
function renderCart() {
    renderCartColumn();
}

// ========== THÊM MÓN VÀO GIỎ (MỚI HIỂN THỊ TRÊN CÙNG) ==========
function addToCart(id, name, price) {
    var now = new Date();
    var timeStr = now.toISOString();
    
    // Tìm món trùng trong giỏ
    var existingIndex = -1;
    for (var i = 0; i < tempOrder.length; i++) {
        if (tempOrder[i].id === id && !tempOrder[i].variantName) {
            existingIndex = i;
            break;
        }
    }
    
    if (existingIndex !== -1) {
        // Nếu đã tồn tại: tăng số lượng
        tempOrder[existingIndex].qty += 1;
        // CẬP NHẬT thời gian mới nhất
        tempOrder[existingIndex].addedTime = timeStr;
        // LẤY PHẦN TỬ ĐÓ RA
        var updatedItem = tempOrder.splice(existingIndex, 1)[0];
        // ĐƯA LÊN ĐẦU MẢNG (hiển thị trên cùng)
        tempOrder.unshift(updatedItem);
    } else {
        // Món mới: thêm vào ĐẦU mảng
        tempOrder.unshift({
            id: id,
            name: name,
            price: price,
            qty: 1,
            addedTime: timeStr,
            variantName: null
        });
    }
    
    renderCartColumn();
}

// ========== THÊM MÓN CÓ BIẾN THỂ (MỚI HIỂN THỊ TRÊN CÙNG) ==========
function addToCartWithVariant(itemId, variantName, price) {
    // Tìm item gốc để lấy tên
    var baseItem = null;
    for (var i = 0; i < menuItems.length; i++) {
        if (menuItems[i].id === itemId) {
            baseItem = menuItems[i];
            break;
        }
    }
    var displayName = baseItem ? baseItem.name + ' (' + variantName + ')' : variantName;
    var uniqueId = itemId + '_' + variantName;
    var now = new Date();
    var timeStr = now.toISOString();
    
    // Tìm món trùng trong giỏ
    var existingIndex = -1;
    for (var i = 0; i < tempOrder.length; i++) {
        if (tempOrder[i].id === uniqueId) {
            existingIndex = i;
            break;
        }
    }
    
    if (existingIndex !== -1) {
        // Nếu đã tồn tại: tăng số lượng
        tempOrder[existingIndex].qty += 1;
        // CẬP NHẬT thời gian mới nhất
        tempOrder[existingIndex].addedTime = timeStr;
        // LẤY PHẦN TỬ ĐÓ RA
        var updatedItem = tempOrder.splice(existingIndex, 1)[0];
        // ĐƯA LÊN ĐẦU MẢNG (hiển thị trên cùng)
        tempOrder.unshift(updatedItem);
    } else {
        // Món mới: thêm vào ĐẦU mảng
        tempOrder.unshift({
            id: uniqueId,
            name: displayName,
            price: price,
            qty: 1,
            addedTime: timeStr,
            variantName: variantName
        });
    }
    
    renderCartColumn();
}



function removeFromCart(idx) {
    tempOrder.splice(idx, 1);
    renderCartColumn();
}

function updateCartQty(idx, delta) {
    if (tempOrder[idx]) {
        var newQty = tempOrder[idx].qty + delta;
        if (newQty <= 0) {
            tempOrder.splice(idx, 1);
        } else {
            tempOrder[idx].qty = newQty;
        }
        renderCartColumn();
    }
}
// ========== XỬ LÝ TẠO BÀN MỚI ==========
function handleCreateNewTable() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    
    // Lấy tên bàn mới
    var tableName = prompt('Nhập tên bàn mới (VD: Bàn 6):', 'Bàn ' + (Math.floor(Math.random() * 20) + 1));
    if (!tableName) return;
    
    var now = new Date();
    var tableId = Date.now().toString();
    var newTable = {
        id: tableId,
        name: tableName,
        status: 'occupied',
        time: now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        startTime: now.toISOString(),
        items: JSON.parse(JSON.stringify(tempOrder)), // copy giỏ hàng
        total: tempOrder.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0),
        customerId: selectedCustomer ? selectedCustomer.id : null,
        customerName: selectedCustomer ? selectedCustomer.name : null
    };
    
    DB.create('tables', newTable, tableId).then(function() {
        // Kiểm tra stock và trừ nguyên liệu
        return checkStock(tempOrder);
    }).then(function(ok) {
        if (!ok) throw new Error('Hết nguyên liệu');
        return deductIngredients(tempOrder);
    }).then(function() {
        // Xóa giỏ hàng và đóng modal
        tempOrder = [];
        selectedCustomer = null;
        closeModal('orderModal');
        renderTables();
        showToast('✅ Đã tạo bàn ' + tableName + ' với ' + newTable.items.length + ' món', 'success');
    }).catch(function(err) {
        // Nếu lỗi, xóa bàn vừa tạo
        DB.remove('tables', tableId);
        showToast(err.message || 'Lỗi khi tạo bàn!', 'error');
    });
}

// ========== XỬ LÝ THÊM VÀO BÀN HIỆN TẠI ==========
function handleAddToExistingTable() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    if (!currentAddToTableId) {
        showToast('Không xác định bàn đích!', 'error');
        return;
    }
    
    DB.get('tables', String(currentAddToTableId)).then(function(table) {
        if (!table) {
            showToast('Bàn không tồn tại!', 'error');
            return;
        }
        
        // Kiểm tra stock trước
        return checkStock(tempOrder).then(function(ok) {
            if (!ok) throw new Error('Hết nguyên liệu');
            return deductIngredients(tempOrder);
        }).then(function() {
            // Thêm món vào bàn
            var existingItems = table.items || [];
            for (var i = 0; i < tempOrder.length; i++) {
                var newItem = tempOrder[i];
                var found = false;
                for (var j = 0; j < existingItems.length; j++) {
                    if (existingItems[j].name === newItem.name && 
                        existingItems[j].variantName === newItem.variantName) {
                        existingItems[j].qty += newItem.qty;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    existingItems.push(JSON.parse(JSON.stringify(newItem)));
                }
            }
            
            var newTotal = existingItems.reduce(function(sum, item) { 
                return sum + (item.price * item.qty); 
            }, 0);
            
            return DB.update('tables', String(currentAddToTableId), {
                items: existingItems,
                total: newTotal
            });
        }).then(function() {
            tempOrder = [];
            selectedCustomer = null;
            closeModal('orderModal');
            renderTables();
            showToast('✅ Đã thêm món vào bàn', 'success');
        }).catch(function(err) {
            showToast(err.message || 'Lỗi khi thêm món!', 'error');
        });
    });
}

// ========== XỬ LÝ THANH TOÁN MANG ĐI ==========
function handleTakeawayPayment(method) {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    
    checkStock(tempOrder).then(function(ok) {
        if (!ok) return;
        return deductIngredients(tempOrder);
    }).then(function() {
        var total = tempOrder.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
        var now = new Date();
        
        return addHistory({
            type: 'takeaway',
            amount: total,
            paymentMethod: method,
            items: JSON.parse(JSON.stringify(tempOrder)),
            customer: selectedCustomer ? { id: selectedCustomer.id, name: selectedCustomer.name } : null,
            tableName: null,
            note: 'Mang đi - ' + (method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'),
            createdAt: now.toISOString(),
            dateKey: now.toISOString().slice(0, 10)
        });
    }).then(function() {
        tempOrder = [];
        selectedCustomer = null;
        closeModal('orderModal');
        showToast('✅ Đã thanh toán đơn mang đi thành công', 'success');
        if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
    }).catch(function(err) {
        showToast(err.message || 'Lỗi khi thanh toán!', 'error');
    });
}

// ========== XỬ LÝ ĐƠN GRAB ==========
function handleGrabOrder() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    
    checkStock(tempOrder).then(function(ok) {
        if (!ok) return;
        return deductIngredients(tempOrder);
    }).then(function() {
        var total = tempOrder.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
        var now = new Date();
        
        return addHistory({
            type: 'grab',
            amount: total,
            paymentMethod: 'grab',
            items: JSON.parse(JSON.stringify(tempOrder)),
            customer: null,
            tableName: null,
            note: 'Đơn Grab',
            createdAt: now.toISOString(),
            dateKey: now.toISOString().slice(0, 10)
        });
    }).then(function() {
        tempOrder = [];
        selectedCustomer = null;
        closeModal('orderModal');
        showToast('✅ Đã tạo đơn Grab thành công', 'success');
        if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
    }).catch(function(err) {
        showToast(err.message || 'Lỗi khi tạo đơn Grab!', 'error');
    });
}

// ========== XỬ LÝ ĐƠN GHI NỢ ==========
function handleDebtOrder() {
    if (!tempOrder.length) {
        showToast('Chưa có món nào trong giỏ!', 'warning');
        return;
    }
    
    // Hiển thị modal chọn khách hàng
    showCustomerSelector(function(customer) {
        if (!customer) {
            showToast('Cần chọn khách hàng để ghi nợ!', 'warning');
            return;
        }
        
        checkStock(tempOrder).then(function(ok) {
            if (!ok) return;
            return deductIngredients(tempOrder);
        }).then(function() {
            var total = tempOrder.reduce(function(sum, item) { return sum + (item.price * item.qty); }, 0);
            var now = new Date();
            
            // Cộng nợ cho khách
            return addCustomerDebt(customer.id, total, 'Mua hàng tại quầy').then(function() {
                return addHistory({
                    type: 'debt_payment',
                    amount: total,
                    paymentMethod: 'debt',
                    items: JSON.parse(JSON.stringify(tempOrder)),
                    customer: { id: customer.id, name: customer.name },
                    tableName: null,
                    note: 'Ghi nợ - ' + customer.name,
                    createdAt: now.toISOString(),
                    dateKey: now.toISOString().slice(0, 10)
                });
            });
        }).then(function() {
            tempOrder = [];
            selectedCustomer = null;
            closeModal('orderModal');
            showToast('✅ Đã ghi nợ đơn hàng', 'success');
            if (typeof renderRecentTransactions === 'function') renderRecentTransactions();
            if (typeof renderCustomerList === 'function') renderCustomerList();
        }).catch(function(err) {
            showToast(err.message || 'Lỗi khi ghi nợ!', 'error');
        });
    });
}

// Xuất global (nếu cần)
window.handleCreateNewTable = handleCreateNewTable;
window.handleAddToExistingTable = handleAddToExistingTable;
window.handleTakeawayPayment = handleTakeawayPayment;
window.handleGrabOrder = handleGrabOrder;
window.handleDebtOrder = handleDebtOrder;
// ========== EXPORT GLOBAL ==========
window.addToCart = addToCart;
window.addToCartWithVariant = addToCartWithVariant;
window.removeFromCart = removeFromCart;
window.updateCartQty = updateCartQty;
window.renderMenuByCategory = renderMenuByCategory;
window.handleAddToExistingTable = handleAddToExistingTable;
window.handleCreateNewTable = handleCreateNewTable;
window.handleTakeawayPayment = handleTakeawayPayment;
window.handleGrabOrder = handleGrabOrder;
window.handleDebtOrder = handleDebtOrder;