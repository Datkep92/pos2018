// ========== QUẢN LÝ NGUYÊN LIỆU (ĐỒNG BỘ FIREBASE) ==========
let ingredients = [];
let menuByNameMap = new Map();
let ingredientByIdMap = new Map();

function rebuildIngredientLookupMaps() {
    const menuItems = Array.isArray(window.menuItems) ? window.menuItems : [];
    const ingredientItems = Array.isArray(window.ingredients) ? window.ingredients : ingredients;

    menuByNameMap = new Map();
    ingredientByIdMap = new Map();

    for (const item of menuItems) {
        if (item && item.name) menuByNameMap.set(String(item.name), item);
    }
    for (const ing of ingredientItems) {
        if (ing && ing.id !== undefined && ing.id !== null) {
            ingredientByIdMap.set(String(ing.id), ing);
        }
    }
}

async function initIngredients() {
    ingredients = await DB.getAll('ingredients') || [];
    window.ingredients = ingredients;
    rebuildIngredientLookupMaps();
    renderIngredients();
    console.log(`✅ Đã tải ${ingredients.length} nguyên liệu`);
}

function renderIngredients() {
    ingredients = window.ingredients || [];
    rebuildIngredientLookupMaps();
    const container = document.getElementById('ingredientsList');
    if (!container) return;
    if (ingredients.length === 0) {
        container.innerHTML = `<div class="empty-state">📦 Chưa có nguyên liệu</div><button class="btn-add-ingredient" onclick="openIngredientModal()">+ Thêm</button>`;
        return;
    }
    const minStock = parseInt(localStorage.getItem('settingMinStock') || '10');
    const fragment = document.createDocumentFragment();
    ingredients.forEach(ing => {
        const isLow = ing.stock <= (ing.minStock || minStock);
        const div = document.createElement('div');
        div.className = 'ingredient-card';
        div.setAttribute('onclick', `showIngredientDetail('${ing.id}')`);
        div.innerHTML = `
            <div class="ingredient-info">
                <div class="ingredient-name">${escapeHtml(ing.name)}</div>
            </div>
            <div class="ingredient-stock ${isLow ? 'low' : ''}">📦 ${ing.stock.toLocaleString()} ${ing.unit}</div>
            <div class="ingredient-price">💰 ${formatMoney(ing.price)} / ${ing.unit}</div>
        `;
        fragment.appendChild(div);
    });
    container.innerHTML = '';
    container.appendChild(fragment);
}

// Hiển thị chi tiết nguyên liệu (popup)
async function showIngredientDetail(id) {
    const ing = ingredients.find(i => i.id === id);
    if (!ing) return;
    document.getElementById('ingredientDetailId').value = ing.id;
    document.getElementById('ingredientDetailName').value = ing.name;
    document.getElementById('ingredientDetailUnit').value = ing.unit;
    document.getElementById('ingredientDetailStock').value = ing.stock;
    document.getElementById('ingredientDetailPrice').value = ing.price;
    document.getElementById('ingredientDetailMinStock').value = ing.minStock || 10;
    document.getElementById('ingredientDetailModal').style.display = 'flex';
}

// Lưu nguyên liệu từ popup chi tiết
async function saveIngredientDetail() {
    const id = document.getElementById('ingredientDetailId').value;
    const name = document.getElementById('ingredientDetailName').value.trim();
    const unit = document.getElementById('ingredientDetailUnit').value;
    const stock = parseFloat(document.getElementById('ingredientDetailStock').value) || 0;
    const price = parseFloat(document.getElementById('ingredientDetailPrice').value) || 0;
    const minStock = parseFloat(document.getElementById('ingredientDetailMinStock').value) || 10;
    if (!name) {
        showToast('Vui lòng nhập tên nguyên liệu!', 'warning');
        return;
    }
    const index = ingredients.findIndex(i => i.id === id);
    if (index !== -1) {
        var updatedIng = Object.assign({}, ingredients[index], { name: name, unit: unit, stock: stock, price: price, minStock: minStock });
        await DB.update('ingredients', id, updatedIng);
        ingredients[index] = updatedIng;
        window.ingredients = ingredients;
        renderIngredients();
        closeModal('ingredientDetailModal');
        showToast('Đã cập nhật "' + name + '"', 'success');
    }
}
// Hoàn trả nguyên liệu khi hủy giao dịch
async function restoreIngredients(orderItems) {
    if (!orderItems || orderItems.length === 0) return;
    rebuildIngredientLookupMaps();
    const updates = [];
    for (const orderItem of orderItems) {
        const menuItem = menuByNameMap.get(String(orderItem.name));
        if (menuItem && menuItem.ingredients && menuItem.ingredients.length) {
            for (const req of menuItem.ingredients) {
                const ing = ingredientByIdMap.get(String(req.ingredientId));
                if (ing) {
                    const newStock = ing.stock + (req.quantity * orderItem.qty);
                    ing.stock = newStock;
                    updates.push(DB.update('ingredients', ing.id, { stock: ing.stock }));
                }
            }
        }
    }
    const batchSize = 5;
    for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        await Promise.all(batch);
        if (i + batchSize < updates.length) await new Promise(resolve => setTimeout(resolve, 0));
    }
    window.ingredients = ingredients;
    renderIngredients();
}
// Xóa nguyên liệu từ popup chi tiết
async function deleteIngredientDetail() {
    const id = document.getElementById('ingredientDetailId').value;
    if (!confirm('Xóa nguyên liệu này?')) return;
    await DB.remove('ingredients', id);
    ingredients = ingredients.filter(i => i.id !== id);
    window.ingredients = ingredients;
    renderIngredients();
    closeModal('ingredientDetailModal');
    showToast('Đã xóa nguyên liệu', 'success');
}

// Mở modal thêm nguyên liệu (dùng chung modal chi tiết)
function openIngredientModal() {
    document.getElementById('ingredientDetailId').value = '';
    document.getElementById('ingredientDetailName').value = '';
    document.getElementById('ingredientDetailUnit').value = 'kg';
    document.getElementById('ingredientDetailStock').value = 0;
    document.getElementById('ingredientDetailPrice').value = 0;
    document.getElementById('ingredientDetailMinStock').value = 10;
    document.getElementById('ingredientDetailModal').style.display = 'flex';
}

// Lưu nguyên liệu (thêm mới hoặc cập nhật)
async function saveIngredientDetail() {
    const id = document.getElementById('ingredientDetailId').value;
    const name = document.getElementById('ingredientDetailName').value.trim();
    const unit = document.getElementById('ingredientDetailUnit').value;
    const stock = parseFloat(document.getElementById('ingredientDetailStock').value) || 0;
    const price = parseFloat(document.getElementById('ingredientDetailPrice').value) || 0;
    const minStock = parseFloat(document.getElementById('ingredientDetailMinStock').value) || 10;
    
    if (!name) {
        showToast('Vui lòng nhập tên nguyên liệu!', 'warning');
        return;
    }

    if (id) {
        // Cập nhật nguyên liệu hiện có
        const index = ingredients.findIndex(i => i.id === id);
        if (index !== -1) {
            const updatedIng = { ...ingredients[index], name, unit, stock, price, minStock };
            await DB.update('ingredients', id, updatedIng);
            ingredients[index] = updatedIng;
        }
    } else {
        // Thêm mới nguyên liệu
        const newId = Date.now().toString();
        const newIng = { id: newId, name, unit, stock, price, minStock, createdAt: Date.now() };
        await DB.create('ingredients', newIng);
        ingredients.push(newIng);
    }
    
    window.ingredients = ingredients;
    renderIngredients();
    closeModal('ingredientDetailModal');
    showToast(`✅ Đã lưu nguyên liệu "${name}"`, 'success');
}
async function saveIngredient() {
    const id = document.getElementById('ingredientId').value;
    const name = document.getElementById('ingredientName').value.trim();
    const unit = document.getElementById('ingredientUnit').value;
    const stock = parseFloat(document.getElementById('ingredientStock').value) || 0;
    const price = parseFloat(document.getElementById('ingredientPrice').value) || 0;
    const minStock = parseFloat(document.getElementById('ingredientMinStock').value) || 10;
    if (!name) {
        showToast('Vui lòng nhập tên nguyên liệu!', 'warning');
        return;
    }
    if (id) {
        var index = ingredients.findIndex(function(i) { return i.id === id; });
        if (index !== -1) {
            var updatedIng = Object.assign({}, ingredients[index], { name: name, unit: unit, stock: stock, price: price, minStock: minStock });
            await DB.update('ingredients', id, updatedIng);
            ingredients[index] = updatedIng;
        }
    } else {
        const newId = Date.now().toString();
        const newIng = {
            id: newId, name, unit, stock, price, minStock,
            createdAt: Date.now()
        };
        await DB.create('ingredients', newIng);
        ingredients.push(newIng);
    }
    window.ingredients = ingredients;
    renderIngredients();
    closeModal('ingredientModal');
    showToast(`Đã lưu nguyên liệu "${name}"`, 'success');
}

// Xóa nguyên liệu (cũ, có thể giữ nhưng không dùng)
async function deleteIngredient(id) {
    if (confirm('Xóa nguyên liệu này?')) {
        await DB.remove('ingredients', id);
        ingredients = ingredients.filter(i => i.id !== id);
        window.ingredients = ingredients;
        renderIngredients();
        showToast('Đã xóa nguyên liệu', 'success');
    }
}

function checkLowStock() {
    const minStock = parseInt(localStorage.getItem('settingMinStock') || '10');
    const lowItems = ingredients.filter(i => i.stock <= (i.minStock || minStock));
    if (lowItems.length === 0) {
        showToast('✅ Tất cả nguyên liệu đều đủ tồn kho!', 'success');
    } else {
        const names = lowItems.slice(0, 5).map(i => i.name).join(', ');
        const more = lowItems.length > 5 ? ` (+${lowItems.length - 5} loại khác)` : '';
        showToast(`⚠️ Tồn kho thấp: ${names}${more}`, 'warning');
    }
}

async function deductIngredients(orderItems) {
    if (!orderItems || orderItems.length === 0) return;
    rebuildIngredientLookupMaps();
    const updates = [];
    for (let i = 0; i < orderItems.length; i++) {
        const orderItem = orderItems[i];
        // Lấy tên gốc (bỏ phần size)
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
                    ing.stock -= req.quantity * orderItem.qty;
                    if (ing.stock < 0) ing.stock = 0;
                    updates.push(DB.update('ingredients', ing.id, { stock: ing.stock }));
                }
            }
        }
        if (i % 20 === 19) await new Promise(resolve => setTimeout(resolve, 0));
    }
    for (let i = 0; i < updates.length; i += 5) {
        await Promise.all(updates.slice(i, i + 5));
    }
    window.ingredients = ingredients;
    if (typeof renderIngredients === 'function') renderIngredients();
}

async function checkStockForItems(orderItems) {
    rebuildIngredientLookupMaps();
    for (const orderItem of orderItems) {
        const menuItem = menuByNameMap.get(String(orderItem.name));
        if (!menuItem) continue;
        const formula = menuItem.ingredients || [];
        for (const req of formula) {
            const ing = ingredientByIdMap.get(String(req.ingredientId));
            if (!ing) {
                showToast(`Nguyên liệu không tồn tại cho món ${orderItem.name}`, 'error');
                return false;
            }
            const needed = (req.quantity || 0) * (orderItem.qty || 0);
            if (ing.stock < needed) {
                showToast(`⚠️ Nguyên liệu "${ing.name}" không đủ cho món ${orderItem.name} (cần ${needed} ${ing.unit}, còn ${ing.stock})`, 'error');
                return false;
            }
        }
    }
    return true;
}

window.restoreIngredients = restoreIngredients;
// Xuất global
window.ingredients = ingredients;
window.initIngredients = initIngredients;
window.renderIngredients = renderIngredients;
window.openIngredientModal = openIngredientModal;
window.saveIngredient = saveIngredient;
window.deleteIngredient = deleteIngredient;
window.checkLowStock = checkLowStock;
window.deductIngredients = deductIngredients;
window.checkStockForItems = checkStockForItems;
window.showIngredientDetail = showIngredientDetail;
window.saveIngredientDetail = saveIngredientDetail;
window.deleteIngredientDetail = deleteIngredientDetail;
window.restoreIngredients = restoreIngredients;