// ingredients.js - Kiểm tra tồn kho, trừ/hoàn nguyên liệu
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// OPTIMIZE: Build lookup maps để tránh nested loops (4 cấp -> 2 cấp)
var _menuLookup = null;
var _ingredientLookup = null;
// Cache version tracking - tránh rebuild không cần thiết
var _lookupCacheVersion = 0;
var _lastBuiltVersion = -1;

function _buildLookups() {
    // Chỉ rebuild khi có thay đổi (invalidate được gọi)
    if (_lastBuiltVersion === _lookupCacheVersion && _menuLookup !== null) {
        return;
    }
    _menuLookup = {};
    _ingredientLookup = {};
    // Ưu tiên window.* vì realtime chỉ gán window.ingredients / window.menuItems
    var menuSource = window.menuItems || (typeof menuItems !== 'undefined' ? menuItems : null) || [];
    var ingSource = window.ingredients || (typeof ingredients !== 'undefined' ? ingredients : null) || [];
    for (var i = 0; i < menuSource.length; i++) {
        _menuLookup[menuSource[i].id] = menuSource[i];
        _menuLookup[menuSource[i].name] = menuSource[i];
    }
    for (var j = 0; j < ingSource.length; j++) {
        _ingredientLookup[ingSource[j].id] = ingSource[j];
    }
    _lastBuiltVersion = _lookupCacheVersion;
}

function _invalidateLookups() {
    _menuLookup = null;
    _ingredientLookup = null;
    _lookupCacheVersion++;
}

// Helper: tính số lượng thực tế cần trừ/hoàn dựa trên quy đổi
// NGUYÊN TẮC:
// - Mặc định: recipeQuantity là số lượng ở đơn vị tồn kho (ingredient.unit)
// - Nếu recipeUnit được nhập:
//   + recipeUnit === ingredient.unit (đơn vị tồn kho): giữ nguyên, KHÔNG quy đổi
//   + recipeUnit === conversionFrom (đơn vị lớn, VD: "hộp"): nhân với rate để ra đơn vị nhỏ
//   + recipeUnit === conversionTo (đơn vị nhỏ, VD: "điếu"): chia cho rate để ra đơn vị tồn kho
// - QUAN TRỌNG: Luôn trả về số lượng ở đơn vị tồn kho (ingredient.unit)
function _getConvertedQuantity(ingredient, recipeQuantity, recipeUnit) {
    if (!ingredient) return recipeQuantity;
    
    var normUnit = recipeUnit ? recipeUnit.trim() : '';
    if (!normUnit) return recipeQuantity;
    
    // QUAN TRỌNG: Nếu recipeUnit trùng với ingredient.unit (đơn vị tồn kho),
    // thì KHÔNG quy đổi, giữ nguyên số lượng (đã đúng đơn vị tồn kho)
    var ingUnit = ingredient.unit ? ingredient.unit.trim() : '';
    if (normUnit === ingUnit) return recipeQuantity;
    
    var rate = parseFloat(ingredient.conversionRate) || 0;
    var convFrom = ingredient.conversionFrom ? ingredient.conversionFrom.trim() : '';
    var convTo = ingredient.conversionTo ? ingredient.conversionTo.trim() : '';
    
    if (rate > 0 && convFrom && convTo) {
        // convFrom là đơn vị lớn, tương đương với ingUnit -> giữ nguyên
        // VD: convFrom="1" (1 hộp), ingUnit="hộp" -> giữ nguyên
        if (normUnit === convFrom) return recipeQuantity;
        // convTo là đơn vị nhỏ -> chia cho rate để ra đơn vị tồn kho
        // VD: gán 20 "điếu" -> 20 / 200 = 0.1 (hộp)
        if (normUnit === convTo) return recipeQuantity / rate;
    }
    
    return recipeQuantity;
}

// ========== NGUYÊN LIỆU ==========
// Cho phép âm kho: hết nguyên liệu vẫn bán được, không chặn giao dịch.
// Giữ lại hàm + chữ ký Promise để không phá vỡ call site đang gọi .then().
function checkStock(items) {
    return Promise.resolve(true);
}

// Helper: lấy danh sách nguyên liệu cho một menu item, hỗ trợ variant
// Gộp cả nguyên liệu chung + nguyên liệu riêng theo variant (nếu có)
function _getIngredientsForItem(menuItem, orderItem) {
    if (!menuItem) return [];
    
    // Luôn lấy ingredients chung trước
    var result = [];
    if (menuItem.ingredients && menuItem.ingredients.length > 0) {
        result = result.concat(menuItem.ingredients);
    }
    
    // Get variant data from either variants or sizes field
    var variantData = (menuItem.variants && menuItem.variants.length > 0) ? menuItem.variants : (menuItem.sizes || []);
    
    // Nếu orderItem có variant (id chứa '_'), thêm variant-specific ingredients
    if (orderItem.id && orderItem.id.indexOf('_') !== -1 && variantData.length) {
        var variantName = orderItem.id.split('_').slice(1).join('_');
        for (var v = 0; v < variantData.length; v++) {
            if (variantData[v].name === variantName && variantData[v].ingredients && variantData[v].ingredients.length) {
                result = result.concat(variantData[v].ingredients);
                break;
            }
        }
    }
    
    return result;
}

// FIX: Idempotency key cho ingredient deductions để chống double-deduction
var _deductionIdempotencyKeys = {};

function _generateDeductionKey(items) {
    var keyParts = [];
    for (var i = 0; i < items.length; i++) {
        keyParts.push(items[i].id + 'x' + items[i].qty);
    }
    keyParts.sort();
    return keyParts.join('|') + '|' + Date.now();
}

function deductIngredients(items, idempotencyKey) {
    // FIX: Kiểm tra idempotency key - nếu đã trừ rồi thì skip
    if (idempotencyKey) {
        if (_deductionIdempotencyKeys[idempotencyKey]) {
            console.log('⚠️ Duplicate ingredient deduction detected, skipping:', idempotencyKey);
            return Promise.resolve();
        }
        _deductionIdempotencyKeys[idempotencyKey] = true;
        // Cleanup keys cũ sau 5 phút
        setTimeout(function() {
            delete _deductionIdempotencyKeys[idempotencyKey];
        }, 300000);
    }
    
    _buildLookups();
    var updates = [];
    for (var i = 0; i < items.length; i++) {
        var orderItem = items[i];
        var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
        var menuItem = _menuLookup[orderItem.id] || _menuLookup[baseName];
        if (menuItem) {
            var ings = _getIngredientsForItem(menuItem, orderItem);
            for (var k = 0; k < ings.length; k++) {
                var req = ings[k];
                var ing = _ingredientLookup[req.ingredientId];
                if (ing) {
                    var rawQty = req.quantity * orderItem.qty;
                    var deductQty = _getConvertedQuantity(ing, rawQty, req.unit);
                    // Null-guard: NL cũ import từ hệ thống cũ có thể chưa có field stock
                    // (trước đây `ing.stock -= x` với undefined cho ra NaN và ghi NaN lên DB)
                    ing.stock = (parseFloat(ing.stock) || 0) - deductQty;
                    // Cho phép âm kho - không clamp về 0
                    updates.push(DB.update('ingredients', ing.id, { stock: ing.stock }));
                    
                    // Log export transaction (thêm vào updates array thay vì fire-and-forget)
                    var unit = ing.unit || '';
                    var note = 'Bán: ' + orderItem.name + ' x' + orderItem.qty + ' (-' + Math.round(deductQty * 1000) / 1000 + ' ' + unit + ')';
                    updates.push(
                        _logIngredientTransaction(ing.id, 'export', Math.round(deductQty * 1000) / 1000, unit, note)
                    );
                }
            }
        }
    }
    return Promise.all(updates);
}

function restoreIngredients(items) {
    _buildLookups();
    var updates = [];
    // FIX: items có thể undefined (giao dịch debt_payment không có items)
    if (!items || !items.length) return Promise.resolve(updates);
    for (var i = 0; i < items.length; i++) {
        var orderItem = items[i];
        var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
        var menuItem = _menuLookup[orderItem.id] || _menuLookup[baseName];
        if (menuItem) {
            var ings = _getIngredientsForItem(menuItem, orderItem);
            for (var k = 0; k < ings.length; k++) {
                var req = ings[k];
                var ing = _ingredientLookup[req.ingredientId];
                if (ing) {
                    var restoreQty = _getConvertedQuantity(ing, req.quantity * orderItem.qty, req.unit);
                    ing.stock = (parseFloat(ing.stock) || 0) + restoreQty;
                    updates.push(DB.update('ingredients', ing.id, { stock: ing.stock }));
                    
                    // Log import transaction (hoàn lại) - thêm vào updates array
                    var unit = ing.unit || '';
                    var note = 'Hoàn: ' + orderItem.name + ' x' + orderItem.qty + ' (+' + Math.round(restoreQty * 1000) / 1000 + ' ' + unit + ')';
                    updates.push(
                        _logIngredientTransaction(ing.id, 'import', Math.round(restoreQty * 1000) / 1000, unit, note)
                    );
                }
            }
        }
    }
    return Promise.all(updates);
}

// ========== LỊCH SỬ GIAO DỊCH NGUYÊN LIỆU ==========
// Lưu lại mỗi lần nhập/xuất nguyên liệu để dễ dàng theo dõi
function _logIngredientTransaction(ingredientId, type, quantity, unit, note) {
    // type: 'import' (nhập kho) or 'export' (xuất kho - bán/hao hụt)
    var now = new Date();
    var dateKey = now.getFullYear() + '-' +
        ('0' + (now.getMonth() + 1)).slice(-2) + '-' +
        ('0' + now.getDate()).slice(-2);
    var timeStr = ('0' + now.getHours()).slice(-2) + ':' +
        ('0' + now.getMinutes()).slice(-2) + ':' +
        ('0' + now.getSeconds()).slice(-2);
    
    var tx = {
        ingredientId: String(ingredientId),
        type: type,
        quantity: quantity,
        unit: unit || '',
        note: note || '',
        dateKey: dateKey,
        time: timeStr,
        createdAt: now.getTime()
    };
    
    return DB.create('ingredient_transactions', tx);
}

// Ghi log nhập kho (mua thêm, bổ sung)
function logIngredientImport(ingredientId, quantity, unit, note) {
    return _logIngredientTransaction(ingredientId, 'import', quantity, unit, note);
}

// Ghi log xuất kho (bán, sử dụng, hao hụt)
function logIngredientExport(ingredientId, quantity, unit, note) {
    return _logIngredientTransaction(ingredientId, 'export', quantity, unit, note);
}

// Lấy lịch sử giao dịch của một nguyên liệu
function getIngredientTransactions(ingredientId) {
    return DB.getAll('ingredient_transactions').then(function(all) {
        if (!all || !all.length) return [];
        var result = [];
        var searchId = String(ingredientId);
        for (var i = 0; i < all.length; i++) {
            if (String(all[i].ingredientId) === searchId) {
                result.push(all[i]);
            }
        }
        // Sort newest first
        result.sort(function(a, b) {
            return (b.createdAt || 0) - (a.createdAt || 0);
        });
        return result;
    });
}

// ========== THÊM TỒN KHO NGUYÊN LIỆU ==========
function addIngredientStock(ingredientId, quantity) {
    _buildLookups();
    var ing = _ingredientLookup[ingredientId];
    if (!ing) {
        // Fallback: quét trực tiếp mảng ingredients
        var allIngs = window.ingredients || (typeof ingredients !== 'undefined' ? ingredients : null) || [];
        for (var i = 0; i < allIngs.length; i++) {
            if (String(allIngs[i].id) === String(ingredientId)) {
                ing = allIngs[i];
                break;
            }
        }
    }
    if (!ing) {
        return Promise.reject(new Error('Không tìm thấy nguyên liệu: ' + ingredientId));
    }

    var oldStock = ing.stock || 0;
    ing.stock = oldStock + quantity;
    // Cho phép âm kho - không clamp về 0

    // Invalidate lookups để lần sau rebuild
    _invalidateLookups();

    // Log transaction - chờ cả log và update stock hoàn tất
    var unit = ing.unit || '';
    var note = '';
    var logPromise = null;
    if (quantity > 0) {
        note = 'Nhập kho: +' + quantity + ' ' + unit + ' (tồn: ' + Math.round(oldStock * 10) / 10 + ' -> ' + Math.round(ing.stock * 10) / 10 + ')';
        logPromise = _logIngredientTransaction(ingredientId, 'import', quantity, unit, note);
    } else if (quantity < 0) {
        note = 'Xuất kho: ' + quantity + ' ' + unit + ' (tồn: ' + Math.round(oldStock * 10) / 10 + ' -> ' + Math.round(ing.stock * 10) / 10 + ')';
        logPromise = _logIngredientTransaction(ingredientId, 'export', Math.abs(quantity), unit, note);
    }

    var stockUpdate = DB.update('ingredients', ing.id, { stock: ing.stock });
    if (logPromise) {
        return Promise.all([stockUpdate, logPromise]);
    }
    return stockUpdate;
}

// Export global
window.addIngredientStock = addIngredientStock;
window.logIngredientImport = logIngredientImport;
window.logIngredientExport = logIngredientExport;
window.getIngredientTransactions = getIngredientTransactions;
