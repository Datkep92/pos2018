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
    var menuSource = window.menuItems || menuItems || [];
    var ingSource = window.ingredients || ingredients || [];
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
    var ingUnit = ingredient.unit ? ingredient.unit.trim() : '';
    
    console.log('🔍 _getConvertedQuantity:', {
        ingName: ingredient.name,
        ingUnit: ingUnit,
        recipeUnit: normUnit,
        recipeQty: recipeQuantity,
        convFrom: ingredient.conversionFrom,
        convTo: ingredient.conversionTo,
        rate: ingredient.conversionRate
    });
    
    if (normUnit) {
        // QUAN TRỌNG: Nếu recipeUnit trùng với ingredient.unit (đơn vị tồn kho),
        // thì KHÔNG quy đổi, giữ nguyên số lượng (đã đúng đơn vị tồn kho)
        if (normUnit === ingUnit) {
            console.log('✅ _getConvertedQuantity: recipeUnit === ingUnit, giữ nguyên:', recipeQuantity);
            return recipeQuantity;
        }
        
        var rate = parseFloat(ingredient.conversionRate) || 0;
        var convFrom = ingredient.conversionFrom ? ingredient.conversionFrom.trim() : '';
        var convTo = ingredient.conversionTo ? ingredient.conversionTo.trim() : '';
        
        if (rate > 0 && convFrom && convTo) {
            // NGUYÊN TẮC:
            // - Nếu recipeUnit === conversionFrom (đơn vị lớn, VD: "hộp"): nhân với rate
            //   VD: gán 1 "hộp" → 1 * 200 = 200 (điếu) - cần chia để ra hộp? KHÔNG!
            //   Thực tế: convFrom là đơn vị lớn tương đương ingUnit, nên giữ nguyên
            //   VD: "1" = 1 hộp, gán 1 "1" → giữ nguyên 1 (hộp)
            if (normUnit === convFrom) {
                // convFrom là đơn vị lớn, tương đương với ingUnit
                // VD: convFrom="1" (1 hộp), ingUnit="hộp" → giữ nguyên
                console.log('✅ _getConvertedQuantity: recipeUnit === convFrom, giữ nguyên (đơn vị lớn tương đương tồn kho):', recipeQuantity);
                return recipeQuantity;
            }
            // - Nếu recipeUnit === conversionTo (đơn vị nhỏ, VD: "điếu"): chia cho rate
            //   để quy đổi về đơn vị tồn kho (ingUnit)
            //   VD: gán 20 "điếu" → 20 / 200 = 0.1 (hộp)
            if (normUnit === convTo) {
                var result = recipeQuantity / rate;
                console.log('✅ _getConvertedQuantity: recipeUnit === convTo, chia:', recipeQuantity, '/', rate, '=', result);
                return result;
            }
        }
    }
    console.log('✅ _getConvertedQuantity: mặc định, giữ nguyên:', recipeQuantity);
    return recipeQuantity;
}

// ========== NGUYÊN LIỆU ==========
// FIX: Dùng _getIngredientsForItem để check cả nguyên liệu chung + variant
function checkStock(items) {
    _buildLookups();
    return new Promise(function(resolve) {
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
                        var needed = _getConvertedQuantity(ing, req.quantity * orderItem.qty, req.unit);
                        // Cho phép âm kho - không chặn giao dịch khi hết nguyên liệu
                    }
                }
            }
        }
        resolve(true);
    });
}

// Helper: lấy danh sách nguyên liệu cho một menu item, hỗ trợ variant
// FIX: Gộp cả nguyên liệu chung + nguyên liệu riêng theo variant (nếu có)
function _getIngredientsForItem(menuItem, orderItem) {
    if (!menuItem) return [];
    
    // Luôn lấy ingredients chung trước
    var result = [];
    if (menuItem.ingredients && menuItem.ingredients.length > 0) {
        result = result.concat(menuItem.ingredients);
    }
    
    // Get variant data from either variants or sizes field
    var variantData = (menuItem.variants && menuItem.variants.length > 0) ? menuItem.variants : (menuItem.sizes || []);
    
    console.log('🔍 _getIngredientsForItem:', {
        menuItemName: menuItem.name,
        menuItemId: menuItem.id,
        orderItemId: orderItem.id,
        hasGlobalIngs: (menuItem.ingredients && menuItem.ingredients.length > 0),
        globalIngsCount: menuItem.ingredients ? menuItem.ingredients.length : 0,
        variantDataCount: variantData.length,
        variantNames: variantData.map(function(v) { return v.name; }),
        hasUnderscore: orderItem.id ? orderItem.id.indexOf('_') !== -1 : false
    });
    
    // Nếu orderItem có variant (id chứa '_'), thêm variant-specific ingredients
    if (orderItem.id && orderItem.id.indexOf('_') !== -1 && variantData.length) {
        var variantName = orderItem.id.split('_').slice(1).join('_');
        console.log('🔍 _getIngredientsForItem: looking for variant:', variantName);
        for (var v = 0; v < variantData.length; v++) {
            console.log('🔍 _getIngredientsForItem: checking variant:', variantData[v].name, '===', variantName, '?', variantData[v].name === variantName);
            if (variantData[v].name === variantName && variantData[v].ingredients && variantData[v].ingredients.length) {
                console.log('🔍 _getIngredientsForItem: FOUND variant ingredients:', JSON.stringify(variantData[v].ingredients));
                result = result.concat(variantData[v].ingredients);
                break;
            }
        }
    }
    
    console.log('🔍 _getIngredientsForItem: FINAL result:', JSON.stringify(result));
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
        console.log('🔍 deductIngredients item:', { id: orderItem.id, name: orderItem.name, qty: orderItem.qty, baseName: baseName, foundMenuItem: menuItem ? menuItem.name : 'NOT FOUND' });
        if (menuItem) {
            var ings = _getIngredientsForItem(menuItem, orderItem);
            for (var k = 0; k < ings.length; k++) {
                var req = ings[k];
                var ing = _ingredientLookup[req.ingredientId];
                console.log('🔍 deductIngredients req:', { ingId: req.ingredientId, qty: req.quantity, unit: req.unit, foundIng: ing ? ing.name : 'NOT FOUND' });
                if (ing) {
                    var rawQty = req.quantity * orderItem.qty;
                    var deductQty = _getConvertedQuantity(ing, rawQty, req.unit);
                    console.log('🔍 deductIngredients deduct:', { rawQty: rawQty, deductQty: deductQty, oldStock: ing.stock, newStock: ing.stock - deductQty });
                    var oldStock = ing.stock || 0;
                    ing.stock -= deductQty;
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
                    var oldStock = ing.stock || 0;
                    ing.stock += restoreQty;
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
        // Fallback: tìm trong mảng ingredients
        for (var i = 0; i < ingredients.length; i++) {
            if (ingredients[i].id === ingredientId) {
                ing = ingredients[i];
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
