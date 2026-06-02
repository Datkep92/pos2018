// ========== QUẢN LÝ MENU (ĐỒNG BỘ FIREBASE REALTIME) ==========
let menuCategories = [];
let menuItems = [];
let tempFormula = [];
let tempVariants = [];
let itemHasVariants = false;

async function initMenu() {
    try {
        console.log("📦 Loading menu...");
        const cats = await DB.getAll('menu_categories');
        const items = await DB.getAll('menu');
        menuCategories = cats || [];
        menuItems = items || [];
        window.menuCategories = menuCategories;
        window.menuItems = menuItems;
        renderMenuManager();
        renderOrderCategories();
    } catch (err) {
        console.error("❌ initMenu lỗi:", err);
    }
}

function openManageCategoryModal() {
    const container = document.getElementById('manageCategoryList');
    if (!container) return;
    const cats = window.menuCategories;
    if (!cats.length) {
        container.innerHTML = '<div class="empty-state">Chưa có danh mục nào</div>';
    } else {
        container.innerHTML = cats.map(c => `
            <div class="manage-category-item">
                <span>${c.icon || '📌'} ${escapeHtml(c.name)}</span>
                <div class="manage-category-actions">
                    <button class="btn-small" onclick="editCategory('${c.id}'); closeModal('manageCategoryModal')">✏️</button>
                    <button class="btn-small" style="background:#dc2626;" onclick="deleteCategory('${c.id}'); closeModal('manageCategoryModal')">🗑️</button>
                </div>
            </div>
        `).join('');
    }
    document.getElementById('manageCategoryModal').style.display = 'flex';
}

function renderMenuManager() {
    const cats = window.menuCategories;
    const items = window.menuItems;
    menuCategories = Array.isArray(cats) ? cats : [];
    menuItems = Array.isArray(items) ? items : [];

    const catContainer = document.getElementById('menuCategories');
    if (!catContainer) return;
    if (menuCategories.length === 0) {
        catContainer.innerHTML = '<div class="empty-state">Chưa có danh mục. Hãy thêm danh mục đầu tiên.</div>';
    } else {
        catContainer.innerHTML = `
            <div class="category-chip active" data-cat="all" onclick="filterMenuByCategory('all')">📋 Tất cả</div>
            ${menuCategories.map(c => `
                <div class="category-chip" data-cat="${c.id}" style="border-left: 3px solid ${c.color || '#f97316'};" onclick="filterMenuByCategory('${c.id}')">
                    ${c.icon || '📌'} ${escapeHtml(c.name)}
                </div>
            `).join('')}
        `;
    }
    filterMenuByCategory('all');
}

async function filterMenuByCategory(categoryId) {
    const container = document.getElementById('menuItemsGrid');
    if (!container) return;
    let items = menuItems;
    if (categoryId !== 'all') items = items.filter(i => i.categoryId == categoryId);
    if (items.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px;">📭 Không có món</div>';
        return;
    }
    container.innerHTML = items.map(item => {
        let sizeInfo = '';
        if (item.hasVariants && item.variants && item.variants.length) {
            sizeInfo = `<div class="menu-item-sizes">📏 ${item.variants.length} size</div>`;
        }
        return `
           <div class="menu-item-card" onclick="showItemDetail('${item.id}')">
    <div class="menu-item-name">${escapeHtml(item.name)}</div>
    <div class="menu-item-price">
        ${formatMoney(item.hasVariants && item.variants && item.variants[0] ? (item.variants[0].price || 0) : item.price)}

    <div class="menu-item-meta">
        <div class="menu-item-ingredients">
            🧂 ${(item.ingredients || []).length} NL
        </div>

        ${item.hasVariants ? `
            <div class="menu-item-sizes">
                📏 ${item.variants.length} size
            </div>
        ` : ''}
    </div>
</div>
        `;
    }).join('');
}

// ========== CHI TIẾT MÓN (POPUP) ==========
async function showItemDetail(itemId) {
    const item = menuItems.find(i => i.id === itemId);
    if (!item) return;
    
    let html = `
        <div class="item-detail-row">
            <div class="item-detail-label">🔖 Tên món</div>
            <div class="item-detail-value">${escapeHtml(item.name)}</div>
        </div>
        <div class="item-detail-row">
            <div class="item-detail-label">📂 Danh mục</div>
            <div class="item-detail-value">${(() => { const menuCategory = menuCategories.find(c => c.id == item.categoryId); return escapeHtml(menuCategory ? menuCategory.name : 'Không'); })()}</div>
        </div>
    `;
    
    if (item.hasVariants && item.variants) {
        html += `<div class="item-detail-row">
            <div class="item-detail-label">📏 Các size</div>
            <div class="item-detail-value">${item.variants.map(v => `${v.name}: ${formatMoney(v.price)}`).join(', ')}</div>
        </div>`;
    } else {
        html += `<div class="item-detail-row">
            <div class="item-detail-label">💰 Giá bán</div>
            <div class="item-detail-value">${formatMoney(item.price)}</div>
        </div>`;
        if (item.ingredients && item.ingredients.length) {
            const ings = window.ingredients || [];
            const ingList = item.ingredients.map(ing => {
                const ingObj = ings.find(i => i.id == ing.ingredientId);
                return `${ingObj ? ingObj.name : '???'} (${ing.quantity} ${ingObj ? ingObj.unit : ''})`;
            }).join(', ');
            html += `<div class="item-detail-row">
                <div class="item-detail-label">🥄 Nguyên liệu</div>
                <div class="item-detail-value">${escapeHtml(ingList)}</div>
            </div>`;
        }
    }
    
    if (item.recipe) {
        html += `<div class="item-detail-row">
            <div class="item-detail-label">📝 Công thức pha chế</div>
            <div class="item-detail-value recipe-text">${escapeHtml(item.recipe).replace(/\n/g, '<br>')}</div>
        </div>`;
    } else {
        html += `<div class="item-detail-row">
            <div class="item-detail-label">📝 Công thức pha chế</div>
            <div class="item-detail-value">Chưa có hướng dẫn</div>
        </div>`;
    }
    
    document.getElementById('itemDetailContent').innerHTML = html;
    document.getElementById('itemDetailModal').style.display = 'flex';
    
    // Gắn sự kiện cho nút Sửa và Xóa
    const editBtn = document.getElementById('detailEditItemBtn');
    const deleteBtn = document.getElementById('detailDeleteItemBtn');
    if (editBtn) {
        editBtn.onclick = () => {
            closeModal('itemDetailModal');
            editItem(item.id);
        };
    }
    if (deleteBtn) {
        deleteBtn.onclick = () => {
            closeModal('itemDetailModal');
            deleteItem(item.id);
        };
    }
}

// === DANH MỤC ===
async function openCategoryModal() {
    const titleEl = document.getElementById('categoryModalTitle');
    const idEl = document.getElementById('categoryId');
    const nameEl = document.getElementById('categoryName');
    const colorEl = document.getElementById('categoryColor');
    const modalEl = document.getElementById('categoryModal');
    if (!titleEl || !idEl || !nameEl || !colorEl || !modalEl) return;
    titleEl.innerText = '➕ Thêm danh mục';
    idEl.value = '';
    nameEl.value = '';
    colorEl.value = '#f97316';
    modalEl.style.display = 'flex';
}

async function editCategory(id) {
    const cat = menuCategories.find(c => c.id == id);
    if (!cat) return;
    const titleEl = document.getElementById('categoryModalTitle');
    const idEl = document.getElementById('categoryId');
    const nameEl = document.getElementById('categoryName');
    const colorEl = document.getElementById('categoryColor');
    const modalEl = document.getElementById('categoryModal');
    if (!titleEl || !idEl || !nameEl || !colorEl || !modalEl) return;
    titleEl.innerText = '✏️ Sửa danh mục';
    idEl.value = cat.id;
    nameEl.value = cat.name;
    colorEl.value = cat.color || '#f97316';
    modalEl.style.display = 'flex';
}

async function saveCategory() {
    const idEl = document.getElementById('categoryId');
    const nameEl = document.getElementById('categoryName');
    const colorEl = document.getElementById('categoryColor');
    if (!idEl || !nameEl || !colorEl) return;
    const id = idEl.value;
    const name = nameEl.value.trim();
    const color = colorEl.value;
    if (!name) { showToast('Nhập tên danh mục!', 'warning'); return; }
    try {
        if (id) {
            await DB.update('menu_categories', id, { name, color });
        } else {
            const newId = Date.now().toString();
            const newCat = { id: newId, name, color, icon: '📌' };
            await DB.create('menu_categories', newCat);
        }
        closeModal('categoryModal');
        showToast('Đã lưu danh mục', 'success');
    } catch (err) {
        console.error(err);
        showToast('Lỗi lưu danh mục', 'error');
    }
}

async function deleteCategory(id) {
    if (menuItems.some(i => i.categoryId == id)) {
        showToast('Danh mục có món, không thể xóa!', 'error');
        return;
    }
    if (!confirm('Xóa danh mục?')) return;
    try {
        await DB.remove('menu_categories', id);
        showToast('Đã xóa danh mục', 'success');
    } catch (err) {
        console.error("❌ deleteCategory lỗi:", err);
        showToast('Lỗi xóa danh mục!', 'error');
    }
}

// === MÓN CÓ VARIANT ===
function populateCategorySelect(selectedId = null) {
    const select = document.getElementById('itemCategory');
    if (!select) return;
    select.innerHTML = '<option value="">-- Chọn danh mục --</option>' +
        menuCategories.map(c => `<option value="${c.id}" ${selectedId == c.id ? 'selected' : ''}>${c.icon || '📌'} ${escapeHtml(c.name)}</option>`).join('');
}

function renderIngredientsFormulaForVariant(variantIdx, ingredientsArray) {
    const container = document.getElementById(`variant-ingredients-${variantIdx}`);
    if (!container) return;
    const ings = window.ingredients || [];
    if (ings.length === 0) {
        container.innerHTML = `<div>Chưa có nguyên liệu. <button class="btn-small" onclick="openIngredientModal()">Thêm</button></div>`;
        return;
    }
    if (!ingredientsArray || ingredientsArray.length === 0) {
        container.innerHTML = `<div>Chưa có nguyên liệu</div><button class="btn-small" onclick="addIngredientToVariant(${variantIdx})">➕ Thêm</button>`;
        return;
    }
    let html = '';
    ingredientsArray.forEach((ing, idx) => {
        const ingObj = ings.find(i => i.id == ing.ingredientId);
        html += `
            <div class="formula-row">
                <select class="form-input" onchange="updateVariantIngredient(${variantIdx}, ${idx}, this.value)">
                    <option value="">-- Chọn --</option>
                    ${ings.map(i => `<option value="${i.id}" ${i.id == ing.ingredientId ? 'selected' : ''}>${i.name} (${i.unit})</option>`).join('')}
                </select>
                <input type="number" class="form-input" placeholder="SL" value="${ing.quantity || 0}" step="0.1" onchange="updateVariantQuantity(${variantIdx}, ${idx}, this.value)">
                <button class="btn-small" style="background:#dc2626;" onclick="removeVariantIngredient(${variantIdx}, ${idx})">X</button>
            </div>
        `;
    });
    html += `<button class="btn-small" onclick="addIngredientToVariant(${variantIdx})">➕ Thêm nguyên liệu</button>`;
    container.innerHTML = html;
}

function addIngredientToVariant(variantIdx) {
    if (!tempVariants[variantIdx]) return;
    if (!tempVariants[variantIdx].ingredients) tempVariants[variantIdx].ingredients = [];
    tempVariants[variantIdx].ingredients.push({ ingredientId: null, quantity: 0 });
    renderVariantsList();
}

function updateVariantIngredient(variantIdx, ingIdx, ingredientId) {
    if (tempVariants[variantIdx] && tempVariants[variantIdx].ingredients[ingIdx]) {
        tempVariants[variantIdx].ingredients[ingIdx].ingredientId = String(ingredientId);
    }
}

function updateVariantQuantity(variantIdx, ingIdx, quantity) {
    if (tempVariants[variantIdx] && tempVariants[variantIdx].ingredients[ingIdx]) {
        tempVariants[variantIdx].ingredients[ingIdx].quantity = parseFloat(quantity) || 0;
    }
}

function removeVariantIngredient(variantIdx, ingIdx) {
    if (tempVariants[variantIdx] && tempVariants[variantIdx].ingredients) {
        tempVariants[variantIdx].ingredients.splice(ingIdx, 1);
        renderVariantsList();
    }
}

function renderVariantsList() {
    const container = document.getElementById('variantsList');
    if (!container) return;
    if (tempVariants.length === 0) {
        container.innerHTML = '<div class="empty-state">Chưa có size nào. Nhấn "+ Thêm size"</div>';
        return;
    }
    const fragment = document.createDocumentFragment();
    tempVariants.forEach((v, idx) => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
            <div class="variant-card" data-variant-idx="${idx}">
                <div class="variant-header">
                    <input type="text" class="form-input variant-name" value="${escapeHtml(v.name)}" placeholder="Tên size (M, L, XL)" style="width:100px;">
                    <input type="number" class="form-input variant-price" value="${v.price}" placeholder="Giá" step="1000" style="width:100px;">
                    <button class="btn-small" onclick="removeVariant(${idx})">🗑️</button>
                </div>
                <div class="variant-ingredients">
                    <label>Công thức</label>
                    <div id="variant-ingredients-${idx}" class="ingredients-formula"></div>
                </div>
            </div>
            <hr>
        `;
        const card = wrapper.firstChild;
        const nameInput = card.querySelector('.variant-name');
        const priceInput = card.querySelector('.variant-price');
        nameInput.onchange = (e) => { tempVariants[idx].name = e.target.value; };
        priceInput.onchange = (e) => { tempVariants[idx].price = parseInt(e.target.value) || 0; };
        fragment.appendChild(card);
        fragment.appendChild(document.createElement('hr'));
    });
    container.innerHTML = '';
    container.appendChild(fragment);
    tempVariants.forEach((v, idx) => {
        renderIngredientsFormulaForVariant(idx, v.ingredients || []);
    });
}

function addVariant() {
    tempVariants.push({
        id: 'var_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        name: '',
        price: 0,
        ingredients: []
    });
    renderVariantsList();
}

function removeVariant(idx) {
    tempVariants.splice(idx, 1);
    renderVariantsList();
}

function toggleVariantsSection() {
    const hasVariants = document.getElementById('itemHasVariants').checked;
    document.getElementById('variantsSection').style.display = hasVariants ? 'block' : 'none';
    document.getElementById('normalSection').style.display = hasVariants ? 'none' : 'block';
    itemHasVariants = hasVariants;
    if (!hasVariants) tempVariants = [];
}

function renderIngredientsFormula() {
    const container = document.getElementById('ingredientsFormula');
    if (!container) return;
    const ings = window.ingredients || [];
    if (!Array.isArray(ings) || ings.length === 0) {
        container.innerHTML = `<div style="padding:10px; text-align:center;">Chưa có nguyên liệu. <button class="btn-small" onclick="openIngredientModal()">Thêm</button></div>`;
        return;
    }
    if (tempFormula.length === 0) {
        container.innerHTML = `<div style="padding:10px;">Chưa có nguyên liệu</div><button class="btn-add-ingredient-formula" onclick="addIngredientToFormula()">➕ Thêm</button>`;
        return;
    }
    const fragment = document.createDocumentFragment();
    tempFormula.forEach((ing, idx) => {
        const row = document.createElement('div');
        row.className = 'formula-row';
        row.innerHTML = `
            <select class="form-input" data-idx="${idx}">
                <option value="">-- Chọn --</option>
                ${ings.map(i => `<option value="${i.id}" ${i.id == ing.ingredientId ? 'selected' : ''}>${i.name} (${i.unit})</option>`).join('')}
            </select>
            <input type="number" class="form-input" data-idx="${idx}" placeholder="SL" value="${ing.quantity || 0}" step="0.1">
            <button class="btn-small" style="background:#dc2626;" data-idx="${idx}">X</button>
        `;
        fragment.appendChild(row);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-add-ingredient-formula';
    addBtn.innerText = '➕ Thêm';
    addBtn.onclick = () => addIngredientToFormula();
    fragment.appendChild(addBtn);
    container.innerHTML = '';
    container.appendChild(fragment);

    container.querySelectorAll('select').forEach(select => {
        const idx = parseInt(select.dataset.idx);
        select.onchange = () => updateFormulaIngredient(idx, select.value);
    });
    container.querySelectorAll('input[type="number"]').forEach(input => {
        const idx = parseInt(input.dataset.idx);
        input.onchange = () => updateFormulaQuantity(idx, input.value);
    });
    container.querySelectorAll('button.btn-small[data-idx]').forEach(btn => {
        const idx = parseInt(btn.dataset.idx);
        btn.onclick = () => removeFormulaIngredient(idx);
    });
}

function addIngredientToFormula() {
    tempFormula.push({ ingredientId: null, quantity: 0 });
    renderIngredientsFormula();
}

function updateFormulaIngredient(idx, ingredientId) {
    if (tempFormula[idx]) tempFormula[idx].ingredientId = String(ingredientId);
}

function updateFormulaQuantity(idx, quantity) {
    if (tempFormula[idx]) tempFormula[idx].quantity = parseFloat(quantity) || 0;
}

function removeFormulaIngredient(idx) {
    tempFormula.splice(idx, 1);
    renderIngredientsFormula();
}

// === MỞ / SỬA MÓN ===
async function openItemModal() {
    if (menuCategories.length === 0) {
        showToast('Cần tạo danh mục trước!', 'warning');
        return;
    }
    document.getElementById('itemModalTitle').innerText = '➕ Thêm món';
    document.getElementById('itemId').value = '';
    document.getElementById('itemName').value = '';
    document.getElementById('itemPrice').value = '';
    document.getElementById('itemRecipe').value = '';
    document.getElementById('itemHasVariants').checked = false;
    toggleVariantsSection();
    tempVariants = [];
    tempFormula = [];
    populateCategorySelect();
    renderIngredientsFormula();
    renderVariantsList();
    document.getElementById('itemModal').style.display = 'flex';
}

async function editItem(id) {
    const item = menuItems.find(i => i.id == id);
    if (!item) return;
    document.getElementById('itemModalTitle').innerText = '✏️ Sửa món';
    document.getElementById('itemId').value = item.id;
    document.getElementById('itemName').value = item.name;
    document.getElementById('itemRecipe').value = item.recipe || '';
    document.getElementById('itemHasVariants').checked = item.hasVariants || false;
    toggleVariantsSection();
    if (item.hasVariants && item.variants) {
        tempVariants = JSON.parse(JSON.stringify(item.variants));
        renderVariantsList();
        tempFormula = [];
    } else {
        tempFormula = item.ingredients ? item.ingredients.slice() : [];
        renderIngredientsFormula();
        document.getElementById('itemPrice').value = item.price;
    }
    populateCategorySelect(item.categoryId);
    document.getElementById('itemModal').style.display = 'flex';
}

async function saveItem() {
    const idEl = document.getElementById('itemId');
    const nameEl = document.getElementById('itemName');
    const categorySelect = document.getElementById('itemCategory');
    const hasVariants = document.getElementById('itemHasVariants').checked;
    const recipe = document.getElementById('itemRecipe').value.trim();
    const name = nameEl.value.trim();
    let categoryId = categorySelect.value;
    if (!name || !categoryId) { showToast('Nhập đủ thông tin!', 'warning'); return; }
    categoryId = String(categoryId);
    try {
        if (idEl.value) {
            if (hasVariants) {
                await DB.update('menu', idEl.value, { name, categoryId, hasVariants: true, variants: tempVariants, recipe });
            } else {
                const price = parseInt(document.getElementById('itemPrice').value);
                const ingredients = tempFormula.filter(ing => ing.ingredientId && ing.quantity > 0);
                if (!price) { showToast('Nhập giá!', 'warning'); return; }
                await DB.update('menu', idEl.value, { name, categoryId, hasVariants: false, price, ingredients, recipe });
            }
        } else {
            const newId = Date.now().toString();
            if (hasVariants) {
                await DB.create('menu', { id: newId, name, categoryId, hasVariants: true, variants: tempVariants, recipe }, newId);
            } else {
                const price = parseInt(document.getElementById('itemPrice').value);
                const ingredients = tempFormula.filter(ing => ing.ingredientId && ing.quantity > 0);
                if (!price) { showToast('Nhập giá!', 'warning'); return; }
                await DB.create('menu', { id: newId, name, categoryId, hasVariants: false, price, ingredients, recipe }, newId);
            }
        }
        closeModal('itemModal');
        showToast(`Đã lưu món "${name}"`, 'success');
    } catch (err) {
        console.error(err);
        showToast('Lỗi lưu món', 'error');
    }
}

async function deleteItem(id) {
    if (!confirm('Xóa món này?')) return;
    try {
        await DB.remove('menu', id);
        showToast('Đã xóa món', 'success');
    } catch (err) {
        console.error("❌ deleteItem lỗi:", err);
        showToast('Lỗi xóa món!', 'error');
    }
}

// === RENDER ORDER ===
function renderOrderCategories() {
    const container = document.getElementById('orderCategories');
    if (!container) return;
    var cats = Array.isArray(window.menuCategories) ? window.menuCategories : [];
    if (cats.length === 0) { container.innerHTML = '<div>Chưa có danh mục</div>'; return; }
    container.innerHTML = '<div class="category-chip active" data-cat="all" onclick="filterOrderMenuByCategory(\'all\')">📋 Tất cả</div>' +
        cats.map(function(c) { return '<div class="category-chip" data-cat="' + c.id + '" onclick="filterOrderMenuByCategory(\'' + c.id + '\')">' + (c.icon || '📌') + ' ' + escapeHtml(c.name) + '</div>'; }).join('');
}

function renderOrderMenuByCategory(categoryId, searchTerm) {
    categoryId = categoryId === undefined ? 'all' : categoryId;
    searchTerm = searchTerm === undefined ? '' : searchTerm;
    const container = document.getElementById('menuGridOrder');
    if (!container) return;
    var items = Array.isArray(window.menuItems) ? window.menuItems.slice() : [];
    if (categoryId !== 'all') items = items.filter(i => i.categoryId == categoryId);
    if (searchTerm) items = items.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));
    if (items.length === 0) { container.innerHTML = '<div style="padding:40px;">📭 Không có món</div>'; return; }
    container.innerHTML = items.map(item => {
        if (item.hasVariants && item.variants && item.variants.length) {
            const variantBtns = item.variants.map(v => 
                `<button class="variant-order-btn" onclick="addToTempOrderWithVariant('${item.id}', '${v.name}', ${v.price})">${v.name} ${formatMoney(v.price)}</button>`
            ).join('');
            return `
                <div class="menu-item-card-variant">
                    <div class="menu-item-name">${escapeHtml(item.name)}</div>
                    <div class="variant-buttons">${variantBtns}</div>
                </div>
            `;
        } else {
            const price = item.price || 0;
            return `
                <div class="menu-item-simple" onclick="addToTempOrder('${item.name}', ${price})">
                    ${escapeHtml(item.name)}<br>
                    <span>${formatMoney(price)}</span>
                </div>
            `;
        }
    }).join('');
}

function filterOrderMenuByCategory(categoryId) {
    window.currentOrderCategory = categoryId;
    const menuSearchInput = document.getElementById('menuSearchInput2');
    const searchTerm = menuSearchInput && menuSearchInput.value ? menuSearchInput.value : '';
    renderOrderMenuByCategory(categoryId, searchTerm);
    document.querySelectorAll('#orderCategories .category-chip').forEach(chip => {
        chip.classList.remove('active');
        if ((categoryId === 'all' && chip.getAttribute('data-cat') === 'all') || chip.getAttribute('data-cat') == categoryId)
            chip.classList.add('active');
    });
}

let searchDebounceTimer;
function openOrderModalWithMenu() {
    renderOrderCategories();
    renderOrderMenuByCategory('all', '');
    const searchInput = document.getElementById('menuSearchInput2');
    if (searchInput) {
        searchInput.oninput = (e) => {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                renderOrderMenuByCategory(window.currentOrderCategory || 'all', e.target.value);
            }, 150);
        };
    }
}

// Xuất global
window.initMenu = initMenu;
window.renderMenuManager = renderMenuManager;
window.openCategoryModal = openCategoryModal;
window.editCategory = editCategory;
window.saveCategory = saveCategory;
window.deleteCategory = deleteCategory;
window.openItemModal = openItemModal;
window.editItem = editItem;
window.saveItem = saveItem;
window.deleteItem = deleteItem;
window.renderOrderCategories = renderOrderCategories;
window.renderOrderMenuByCategory = renderOrderMenuByCategory;
window.filterOrderMenuByCategory = filterOrderMenuByCategory;
window.openOrderModalWithMenu = openOrderModalWithMenu;
window.openManageCategoryModal = openManageCategoryModal;
window.addVariant = addVariant;
window.removeVariant = removeVariant;
window.addIngredientToVariant = addIngredientToVariant;
window.updateVariantIngredient = updateVariantIngredient;
window.updateVariantQuantity = updateVariantQuantity;
window.removeVariantIngredient = removeVariantIngredient;
window.toggleVariantsSection = toggleVariantsSection;
window.showItemDetail = showItemDetail;