// ingredients.js - Kiểm tra tồn kho, trừ/hoàn nguyên liệu
// Tách từ pos.js - ES5, tương thích Android 6, iOS 12

// ========== NGUYÊN LIỆU ==========
function checkStock(items) {
    return new Promise(function(resolve) {
        for (var i = 0; i < items.length; i++) {
            var orderItem = items[i];
            var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
            var menuItem = null;
            for (var j = 0; j < menuItems.length; j++) {
                if (menuItems[j].name === baseName || menuItems[j].id === orderItem.id) { menuItem = menuItems[j]; break; }
            }
            if (menuItem && menuItem.ingredients) {
                for (var k = 0; k < menuItem.ingredients.length; k++) {
                    var req = menuItem.ingredients[k];
                    for (var l = 0; l < ingredients.length; l++) {
                        if (ingredients[l].id === req.ingredientId) {
                            if (ingredients[l].stock < (req.quantity * orderItem.qty)) {
                                showToast('⚠️ Nguyên liệu "' + ingredients[l].name + '" không đủ cho món ' + baseName, 'error');
                                resolve(false);
                                return;
                            }
                            break;
                        }
                    }
                }
            }
        }
        resolve(true);
    });
}

function deductIngredients(items) {
    var updates = [];
    for (var i = 0; i < items.length; i++) {
        var orderItem = items[i];
        var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
        var menuItem = null;
        for (var j = 0; j < menuItems.length; j++) {
            if (menuItems[j].name === baseName || menuItems[j].id === orderItem.id) { menuItem = menuItems[j]; break; }
        }
        if (menuItem && menuItem.ingredients) {
            for (var k = 0; k < menuItem.ingredients.length; k++) {
                var req = menuItem.ingredients[k];
                for (var l = 0; l < ingredients.length; l++) {
                    if (ingredients[l].id === req.ingredientId) {
                        ingredients[l].stock -= req.quantity * orderItem.qty;
                        if (ingredients[l].stock < 0) ingredients[l].stock = 0;
                        updates.push(DB.update('ingredients', ingredients[l].id, { stock: ingredients[l].stock }));
                        break;
                    }
                }
            }
        }
    }
    return Promise.all(updates);
}

function restoreIngredients(items) {
    var updates = [];
    for (var i = 0; i < items.length; i++) {
        var orderItem = items[i];
        var baseName = orderItem.name.replace(/\s*\([^)]*\)/g, '').trim();
        var menuItem = null;
        for (var j = 0; j < menuItems.length; j++) {
            if (menuItems[j].name === baseName || menuItems[j].id === orderItem.id) { menuItem = menuItems[j]; break; }
        }
        if (menuItem && menuItem.ingredients) {
            for (var k = 0; k < menuItem.ingredients.length; k++) {
                var req = menuItem.ingredients[k];
                for (var l = 0; l < ingredients.length; l++) {
                    if (ingredients[l].id === req.ingredientId) {
                        ingredients[l].stock += req.quantity * orderItem.qty;
                        updates.push(DB.update('ingredients', ingredients[l].id, { stock: ingredients[l].stock }));
                        break;
                    }
                }
            }
        }
    }
    return Promise.all(updates);
}
