// ingredients.js - Kiểm tra tồn kho, trừ/hoàn nguyên liệu
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// OPTIMIZE: Build lookup maps để tránh nested loops (4 cấp -> 2 cấp)
var _menuLookup = null;
var _ingredientLookup = null;

function _buildLookups() {
    if (_menuLookup && _ingredientLookup) return;
    _menuLookup = {};
    _ingredientLookup = {};
    for (var i = 0; i < menuItems.length; i++) {
        _menuLookup[menuItems[i].id] = menuItems[i];
        _menuLookup[menuItems[i].name] = menuItems[i];
    }
    for (var j = 0; j < ingredients.length; j++) {
        _ingredientLookup[ingredients[j].id] = ingredients[j];
    }
}

function _invalidateLookups() {
    _menuLookup = null;
    _ingredientLookup = null;
}

// Helper: tính số lượng thực tế cần trừ/hoàn dựa trên quy đổi
// Nếu nguyên liệu có conversionRate (VD: 1 kg = 1600 ml),
// và recipe yêu cầu 10 ml, thì lượng cần trừ = 10 / 1600 = 0.00625 kg
function _getConvertedQuantity(ingredient, recipeQuantity) {
    if (!ingredient) return recipeQuantity;
    var rate = parseFloat(ingredient.conversionRate) || 0;
    if (rate > 0 && ingredient.conversionTo && ingredient.conversionFrom) {
        // Recipe quantity is in conversionTo unit (e.g., ml)
        // Stock is in conversionFrom unit (e.g., kg)
        // Convert: stock to deduct = recipe quantity / conversion rate
        return recipeQuantity / rate;
    }
    // No conversion: recipe quantity is in same unit as stock
    return recipeQuantity;
}

// ========== NGUYÊN LIỆU ==========
function checkStock(items) {
    _buildLookups();
    return new Promise(function(resolve) {
        for (var i = 0; i < items.length; i++) {
            var orderItem = items[i];
            var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
            var menuItem = _menuLookup[orderItem.id] || _menuLookup[baseName];
            if (menuItem && menuItem.ingredients) {
                for (var k = 0; k < menuItem.ingredients.length; k++) {
                    var req = menuItem.ingredients[k];
                    var ing = _ingredientLookup[req.ingredientId];
                    if (ing) {
                        var needed = _getConvertedQuantity(ing, req.quantity * orderItem.qty);
                        if (ing.stock < needed) {
                            showToast('⚠️ Nguyên liệu "' + ing.name + '" không đủ cho món ' + baseName, 'error');
                            resolve(false);
                            return;
                        }
                    }
                }
            }
        }
        resolve(true);
    });
}

// Helper: lấy danh sách nguyên liệu cho một menu item, hỗ trợ variant
function _getIngredientsForItem(menuItem, orderItem) {
    if (!menuItem) return [];
    
    // Get variant data from either variants or sizes field
    var variantData = (menuItem.variants && menuItem.variants.length > 0) ? menuItem.variants : (menuItem.sizes || []);
    
    // Nếu orderItem có variant (id chứa '_'), tìm variant-specific ingredients
    if (orderItem.id && orderItem.id.indexOf('_') !== -1 && variantData.length) {
        var variantName = orderItem.id.split('_').slice(1).join('_');
        for (var v = 0; v < variantData.length; v++) {
            if (variantData[v].name === variantName && variantData[v].ingredients && variantData[v].ingredients.length) {
                return variantData[v].ingredients;
            }
        }
    }
    
    // Fallback: dùng ingredients chung của menu item
    return menuItem.ingredients || [];
}

function deductIngredients(items) {
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
                    var deductQty = _getConvertedQuantity(ing, req.quantity * orderItem.qty);
                    var oldStock = ing.stock || 0;
                    ing.stock -= deductQty;
                    if (ing.stock < 0) ing.stock = 0;
                    updates.push(DB.update('ingredients', ing.id, { stock: ing.stock }));
                    
                    // Log export transaction
                    var unit = ing.unit || '';
                    var note = 'Bán: ' + orderItem.name + ' x' + orderItem.qty + ' (-' + Math.round(deductQty * 1000) / 1000 + ' ' + unit + ')';
                    _logIngredientTransaction(ing.id, 'export', Math.round(deductQty * 1000) / 1000, unit, note).catch(function(err) {
                        console.error('Log export error:', err);
                    });
                }
            }
        }
    }
    return Promise.all(updates);
}

function restoreIngredients(items) {
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
                    var restoreQty = _getConvertedQuantity(ing, req.quantity * orderItem.qty);
                    var oldStock = ing.stock || 0;
                    ing.stock += restoreQty;
                    updates.push(DB.update('ingredients', ing.id, { stock: ing.stock }));
                    
                    // Log import transaction (hoàn lại)
                    var unit = ing.unit || '';
                    var note = 'Hoàn: ' + orderItem.name + ' x' + orderItem.qty + ' (+' + Math.round(restoreQty * 1000) / 1000 + ' ' + unit + ')';
                    _logIngredientTransaction(ing.id, 'import', Math.round(restoreQty * 1000) / 1000, unit, note).catch(function(err) {
                        console.error('Log restore error:', err);
                    });
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
    if (ing.stock < 0) ing.stock = 0;

    // Invalidate lookups để lần sau rebuild
    _invalidateLookups();

    // Log transaction
    var unit = ing.unit || '';
    var note = '';
    if (quantity > 0) {
        note = 'Nhập kho: +' + quantity + ' ' + unit + ' (tồn: ' + Math.round(oldStock * 10) / 10 + ' -> ' + Math.round(ing.stock * 10) / 10 + ')';
        _logIngredientTransaction(ingredientId, 'import', quantity, unit, note);
    } else if (quantity < 0) {
        note = 'Xuất kho: ' + quantity + ' ' + unit + ' (tồn: ' + Math.round(oldStock * 10) / 10 + ' -> ' + Math.round(ing.stock * 10) / 10 + ')';
        _logIngredientTransaction(ingredientId, 'export', Math.abs(quantity), unit, note);
    }

    return DB.update('ingredients', ing.id, { stock: ing.stock });
}

// Export global
window.addIngredientStock = addIngredientStock;
window.logIngredientImport = logIngredientImport;
window.logIngredientExport = logIngredientExport;
window.getIngredientTransactions = getIngredientTransactions;
