// Script tách settings.js thành các module
// Chạy: node _split-settings.js
var fs = require('fs');

var content = fs.readFileSync('settings.js', 'utf8');
var lines = content.split('\n');

// Định nghĩa các module: [tên_file, dòng_bắt_đầu, dòng_kết_thúc, mô_tả]
var modules = [
    // Module 1: settings-core.js - đã tạo thủ công
    // Module 2: settings-cash-counter.js
    { file: 'settings-cash-counter.js', start: 194, end: 1087, desc: 'Cash counter + đối soát' },
    // Module 3: settings-manager-pickup.js
    { file: 'settings-manager-pickup.js', start: 1088, end: 1172, desc: 'Manager pickup (save/delete)' },
    // Module 4: settings-date.js
    { file: 'settings-date.js', start: 1174, end: 1197, desc: 'Date selection' },
    // Module 5: settings-alert.js
    { file: 'settings-alert.js', start: 1198, end: 1239, desc: 'Alert sound' },
    // Module 6: settings-close-day.js
    { file: 'settings-close-day.js', start: 1240, end: 1609, desc: 'Staff close day + Telegram shift close + unlock' },
    // Module 7: settings-toast.js
    { file: 'settings-toast.js', start: 1610, end: 1685, desc: 'Closeable toast + toggle sections' },
    // Module 8: settings-init.js
    { file: 'settings-init.js', start: 1686, end: 1907, desc: 'initSettingsTab + fund hide for staff' },
    // Module 9: settings-staff.js
    { file: 'settings-staff.js', start: 1908, end: 1953, desc: 'Staff note, printer IP, token visibility' },
    // Module 10: settings-shop-info.js
    { file: 'settings-shop-info.js', start: 1954, end: 2011, desc: 'Shop info (load/save/clear)' },
    // Module 11: settings-telegram.js
    { file: 'settings-telegram.js', start: 2012, end: 2256, desc: 'Telegram config (save/test/clear)' },
    // Module 12: settings-lock-config.js
    { file: 'settings-lock-config.js', start: 2257, end: 2345, desc: 'Lock config (load/save)' },
    // Module 13: settings-permissions.js
    { file: 'settings-permissions.js', start: 2346, end: 2380, desc: 'Staff permission wrappers' },
    // Module 14: settings-escape.js
    { file: 'settings-escape.js', start: 2381, end: 2418, desc: 'Escape helpers + version compare' },
    // Module 15: settings-data-fix.js
    { file: 'settings-data-fix.js', start: 2419, end: 2655, desc: 'Fix old cashKept data' },
    // Module 16: settings-esp32.js
    { file: 'settings-esp32.js', start: 2656, end: 2865, desc: 'ESP32 config + clear IndexedDB' },
    // Module 17: settings-modals.js
    { file: 'settings-modals.js', start: 2866, end: 3466, desc: 'Detail modals (active tables, debt, grab, cost, transfer, cash)' },
    // Module 18: settings-print.js
    { file: 'settings-print.js', start: 3467, end: 3895, desc: 'Print manager pickup + staff close receipt' },
    // Module 19: settings-fund.js
    { file: 'settings-fund.js', start: 3896, end: 5185, desc: 'Responsibility fund' },
    // Module 20: settings-firebase-config.js
    { file: 'settings-firebase-config.js', start: 5186, end: 5437, desc: 'Multi-Firebase config' },
    // Module 21: settings-visibility.js
    { file: 'settings-visibility.js', start: 5438, end: 5475, desc: 'Online/offline + visibility detection' }
];

// Header cho mỗi module
function getHeader(fileName, desc) {
    return '// ' + fileName + ' - ' + desc + '\n' +
           '// ES5, tương thích Android 6, iOS 12\n' +
           '// ============================================================\n' +
           '// Phụ thuộc: settings-core.js\n\n';
}

// Tách từng module
modules.forEach(function(mod) {
    // Lấy nội dung từ dòng start đến end (0-indexed)
    var startIdx = mod.start; // 0-indexed
    var endIdx = Math.min(mod.end, lines.length);
    var moduleLines = lines.slice(startIdx, endIdx);
    
    // Bỏ qua dòng comment section nếu có (dòng === // ===...)
    while (moduleLines.length > 0 && moduleLines[0].trim().startsWith('// ===')) {
        moduleLines.shift();
    }
    while (moduleLines.length > 0 && moduleLines[moduleLines.length - 1].trim() === '') {
        moduleLines.pop();
    }
    
    var moduleContent = getHeader(mod.file, mod.desc) + moduleLines.join('\n');
    fs.writeFileSync(mod.file, moduleContent, 'utf8');
    console.log('✅ Created ' + mod.file + ' (' + moduleLines.length + ' lines)');
});

console.log('\n🎉 Done! Created ' + modules.length + ' module files.');
