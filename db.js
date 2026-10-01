// =====================================================================
// TUONG THICH WEBVIEW CU - phai chay TRUOC moi file khac
//
// File nay duoc nap dau tien trong index.html nen polyfill dat o day duoc
// ap dung cho ca app.
//
// MAY POS THUONG DUNG ANDROID 6/7, WEBVIEW CHI BANG CHROME 44-51. Nhung ham
// sau chi co tu Chrome 57 tro len:
//   String.prototype.padStart  (Chrome 57)
//   Array.prototype.includes  (Chrome 47)
//   Object.entries / values   (Chrome 54)
// Thiếu chúng thi app KHONG CHAY DUOC tren may POS cu - khong phai loi nho,
// ma la man hinh trang.
//
// Ghi chu: Firebase SDK 9.x cung dung cu phap moi hon ca, nen WebView cu van
// chua tai duoc Firebase. Xem README-ANDROID.md.
(function() {
    var StringProto = String.prototype;

    // --- String.prototype.padStart (Chrome 57) ---
    if (typeof StringProto.padStart !== 'function') {
        StringProto.padStart = function (len, pad) {
            var s = String(this);
            pad = pad === undefined || pad === null ? ' ' : String(pad);
            if (pad === '') pad = ' ';
            if (s.length >= len) return s;
            var fill = '';
            while (fill.length < len - s.length) fill += pad.charAt(0);
            return fill.slice(0, len - s.length) + s;
        };
    }
    if (typeof StringProto.padEnd !== 'function') {
        StringProto.padEnd = function (len, pad) {
            var s = String(this);
            pad = pad === undefined || pad === null ? ' ' : String(pad);
            if (pad === '') pad = ' ';
            if (s.length >= len) return s;
            var fill = '';
            while (fill.length < len - s.length) fill += pad.charAt(0);
            return s + fill.slice(0, len - s.length);
        };
    }

    // --- Array.prototype.includes (Chrome 47) ---
    if (typeof Array.prototype.includes !== 'function') {
        Array.prototype.includes = function (v) {
            if (this == null) throw new TypeError('Array.prototype.includes called on null or undefined');
            var o = Object(this);
            var len = o.length >>> 0;
            for (var i = 0; i < len; i++) {
                var x = o[i];
                if (x === v || (x !== x && v !== v)) return true;   // x !== x la NaN
            }
            return false;
        };
    }
    if (typeof Array.prototype.find !== 'function') {
        Array.prototype.find = function (fn, thisArg) {
            if (this == null) throw new TypeError('Array.prototype.find called on null or undefined');
            var o = Object(this);
            var len = o.length >>> 0;
            for (var i = 0; i < len; i++) if (fn.call(thisArg, o[i], i, o)) return o[i];
            return undefined;
        };
    }

    // --- Object.entries / values (Chrome 54) ---
    if (typeof Object.entries !== 'function') {
        Object.entries = function (obj) {
            var out = [];
            if (obj == null) return out;
            for (var k in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, k)) out.push([k, obj[k]]);
            }
            return out;
        };
    }
    if (typeof Object.values !== 'function') {
        Object.values = function (obj) {
            var out = [];
            if (obj == null) return out;
            for (var k in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, k)) out.push(obj[k]);
            }
            return out;
        };
    }
})();

(function() {
    // Polyfill CustomEvent
    if (typeof window.CustomEvent !== "function") {
        function CustomEvent(event, params) {
            params = params || { bubbles: false, cancelable: false, detail: null };
            var evt = document.createEvent('CustomEvent');
            evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
            return evt;
        }
        window.CustomEvent = CustomEvent;
    }

    // Firebase Config
    var firebaseConfig = {
        apiKey: "AIzaSyCs4EWdrYMZy1fTKGBFvVjrIiW0VTWIP5Y",
  authDomain: "pos259.firebaseapp.com",
  projectId: "pos259",
        databaseURL: "https://pos259-default-rtdb.firebaseio.com",
        storageBucket: "pos259.firebasestorage.app",
  messagingSenderId: "4958283987",
  appId: "1:4958283987:web:ae456726fd89c4b0d70c26",
  measurementId: "G-2J911QJ5HQ"
    };
    firebase.initializeApp(firebaseConfig);
    var db = firebase.database();
    var auth = firebase.auth();

    // ========== MULTI-TENANT SUPPORT ==========
    var _secondaryApp = null;
    var _secondaryDb = null;
    
    // Lấy database reference hiện tại (secondary nếu có, fallback về default)
    function _getDb() {
        return _secondaryDb || db;
    }
    
    // Override firebase.database() để tất cả các module khác (employees.js, settings.js, v.v.)
    // tự động dùng đúng database (custom nếu có, default nếu không)
    // Lưu hàm gốc và tất cả static properties TRƯỚC khi override
    var _origFirebaseDatabase = firebase.database.bind(firebase);
    // Lưu ServerValue và các static properties khác từ hàm gốc
    var _origServerValue = firebase.database.ServerValue;
    // Override
    firebase.database = function() {
        return _getDb();
    };
    // Gán lại ServerValue và các static properties
    firebase.database.ServerValue = _origServerValue;
    
    // Khởi tạo với Firebase config riêng cho POS
    function initWithCustomConfig(customConfig) {
        // Dọn dẹp secondary app cũ nếu có
        if (_secondaryApp) {
            try {
                _secondaryApp.delete();
            } catch(e) {
                console.warn('⚠️ Could not delete secondary Firebase app:', e.message);
            }
            _secondaryApp = null;
            _secondaryDb = null;
        }
        
        if (!customConfig || !customConfig.databaseURL) {
            console.log('ℹ️ No custom Firebase config, using default');
            // Reset về URL mặc định
            _databaseURL = firebaseConfig.databaseURL;
            return Promise.resolve(false);
        }
        
        try {
            // Cập nhật databaseURL cho REST API shallow requests
            _databaseURL = customConfig.databaseURL;
            
            // Tạo tên app duy nhất để tránh xung đột
            var appName = 'secondary_' + Date.now();
            _secondaryApp = firebase.initializeApp(customConfig, appName);
            _secondaryDb = _secondaryApp.database();
            console.log('✅ Initialized custom Firebase config:', customConfig.projectId || 'unknown');
            return Promise.resolve(true);
        } catch(e) {
            console.error('❌ Failed to initialize custom Firebase config:', e.message);
            _secondaryApp = null;
            _secondaryDb = null;
            return Promise.reject(e);
        }
    }
    
    // Lấy custom Firebase config từ localStorage (được lưu sau khi login)
    function _loadCustomFirebaseConfig() {
        try {
            var stored = localStorage.getItem('pos_firebase_config');
            if (stored) {
                return JSON.parse(stored);
            }
        } catch(e) {}
        return null;
    }
    
    // Khởi tạo custom config từ localStorage khi load trang
    var _savedCustomConfig = _loadCustomFirebaseConfig();
    if (_savedCustomConfig) {
        initWithCustomConfig(_savedCustomConfig).catch(function(err) {
            console.warn('⚠️ Could not restore custom Firebase config:', err.message);
        });
    }
    
    // Constants
    var STORE_NAME = 'pos_data';
    
    var currentUser = null;
    var savedSession = localStorage.getItem('pos_session');
    if (savedSession) {
        try { currentUser = JSON.parse(savedSession); } catch(e) { localStorage.removeItem('pos_session'); }
    }
    
    // Đồng bộ MASTER_CONFIG nếu session là master admin
    if (currentUser && currentUser.role === 'master_admin' && typeof MASTER_CONFIG !== 'undefined' && MASTER_CONFIG) {
        MASTER_CONFIG.syncSession(currentUser);
    }
    
    var CURRENT_SHOP_ID = localStorage.getItem('current_shop_id');
    if (!CURRENT_SHOP_ID) {
        if (currentUser && currentUser.shopId) {
            CURRENT_SHOP_ID = currentUser.shopId;
            localStorage.setItem('current_shop_id', CURRENT_SHOP_ID);
        } else {
            CURRENT_SHOP_ID = 'shop_default';
        }
    }
    var CURRENT_DEVICE_ID = localStorage.getItem('device_id') || ('device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
    localStorage.setItem('device_id', CURRENT_DEVICE_ID);

    var localDB = null;
    var dbReady = null;
    var syncQueue = [];
    var isOnline = navigator.onLine;
    var listeners = {};
    var _unsubscribeFns = {}; // { collection: [function] } - lưu các hàm unsubscribe để cleanup
    
    // ========== PHASE 5: DEDUP & RECONCILE ==========
    // _processedKeys: chống trùng lặp khi xử lý realtime events
    // Khi tab resume, Firebase SDK reconnect -> child_added fire lại cho tất cả items
    // _processedKeys ngăn không cho xử lý items đã được xử lý trong vòng _PROCESSED_KEYS_TTL ms
    var _processedKeys = {}; // { collection: { itemId: timestamp } }
    var _PROCESSED_KEYS_TTL = 10000; // 10 giây - đủ để chờ deltaSync hoàn tất
    
    function _isRecentlyProcessed(collection, key) {
        if (_processedKeys[collection] && _processedKeys[collection][key]) {
            var age = Date.now() - _processedKeys[collection][key];
            if (age < _PROCESSED_KEYS_TTL) {
                return true;
            }
            // Hết hạn, xóa để tránh memory leak
            delete _processedKeys[collection][key];
        }
        return false;
    }
    
    function _markProcessed(collection, key) {
        if (!_processedKeys[collection]) _processedKeys[collection] = {};
        _processedKeys[collection][key] = Date.now();
    }
    
    // Cleanup _processedKeys định kỳ - tránh memory leak
    function _cleanupProcessedKeys() {
        var now = Date.now();
        for (var col in _processedKeys) {
            if (_processedKeys.hasOwnProperty(col)) {
                for (var key in _processedKeys[col]) {
                    if (_processedKeys[col].hasOwnProperty(key)) {
                        if (now - _processedKeys[col][key] > _PROCESSED_KEYS_TTL) {
                            delete _processedKeys[col][key];
                        }
                    }
                }
                // Xóa collection object nếu rỗng
                if (Object.keys(_processedKeys[col]).length === 0) {
                    delete _processedKeys[col];
                }
            }
        }
    }
    
    // ========== GHI BAN THEO CACH GIAO DICH NGUYEN TỐ (CHUẨN POS ĐA THIẾT BỊ) ==========
    /**
     * Sửa một bàn một cách AN TOÀN khi có nhiều máy.
     *
     * VÌ SAO CẦN: hiện tại mọi thao tác trên bàn đều làm
     *     đọc bàn từ RAM -> sửa mảng items -> ghi đè toàn bộ bản ghi
     * Mỗi máy có một bản riêng trong RAM. Máy A thêm 2 ly vào bàn 5, máy B
     * thêm 1 ly vào bàn 5 cùng lúc: cả hai đọc cùng một mảng cũ, cả hai ghi
     * đè, và một trong hai phần bị mất. Với gộp bàn còn tệ hơn: bàn đích bị
     * ghi đè bằng bản cũ rồi bàn nguồn bị xoá -> mất món không phục hồi được.
     *
     * CÁCH SỬA (KHÔNG đổi cấu trúc dữ liệu): runTransaction trên chính node
     * `tables/{id}`. Firebase thực thi các transaction tuần tự trên server,
     * nên `mutator` LUÔN nhận dữ liệu mới nhất - máy B sẽ thấy món máy A vừa
     * thêm, và cộng vào đó. Không cần tách items ra node con, không thêm trường.
     *
     * @param {string} tableId
     * @param {function} mutator  nhận bản ghi bàn mới nhất, trả về:
     *        - object ghi đè (vd {items, total}) -> commit
     *        - null / undefined -> hủy, không đổi gì
     * @returns {Promise<{ok:boolean, table:object|null, reason:string}>}
     */
    function patchTable(tableId, mutator) {
        var shopId = CURRENT_SHOP_ID;
        var ref = _getDb().ref(shopId + '/tables/' + tableId);
        var seen = null;
        return ref.transaction(function (cur) {
            if (cur === null || cur === undefined) return undefined;  // bàn không còn -> hủy
            seen = cur;
            var patch = mutator(cur);
            if (!patch) return undefined;                              // mutator nói "không sửa"
            // Ghi đè lên bản vừa đọc (giữ nguyên các trường khác của bàn)
            var merged = {};
            for (var k in cur) if (cur.hasOwnProperty(k)) merged[k] = cur[k];
            for (var k2 in patch) if (patch.hasOwnProperty(k2)) merged[k2] = patch[k2];
            merged.id = String(merged.id !== undefined ? merged.id : tableId);
            merged.updatedAt = Date.now();
            merged.updatedBy = CURRENT_DEVICE_ID;
            return merged;
        }).then(function (res) {
            if (!res.committed) {
                return { ok: false, table: null, reason: 'Ban khong con ton tai tren may chu' };
            }
            var table = seen || null;
            // Đồng bộ máy này với kết quả vừa commit để UI hiển thị đúng
            if (table) {
                var copy = {};
                for (var c in table) if (table.hasOwnProperty(c)) copy[c] = table[c];
                copy.id = String(copy.id !== undefined ? copy.id : tableId);
                copy.updatedAt = Date.now();
                copy.updatedBy = CURRENT_DEVICE_ID;
                saveToLocal('tables', copy).then(function () {
                    _notifyLocal('tables', { type: 'changed', item: copy, collection: 'tables' });
                }).catch(function () { /* IndexedDB lỗi thì realtime vẫn đồng bộ */ });
            }
            return { ok: true, table: table, reason: '' };
        }).catch(function (err) {
            console.warn('[DB] patchTable lỗi:', err && err.message);
            return { ok: false, table: null, reason: 'Khong luu duoc ban tren may chu' };
        });
    }

    /**
     * Cộng số lượng món vào bàn, an toàn khi 2 máy cùng thêm món.
     * @param itemsToAdd mảng món cần thêm (mỗi món {name,price,qty,variantName,id})
     */
    function addItemsToTable(tableId, itemsToAdd) {
        return patchTable(tableId, function (cur) {
            var items = [];
            if (Array.isArray(cur.items)) {
                for (var i = 0; i < cur.items.length; i++) {
                    var it = cur.items[i];
                    if (!it) continue;
                    var cp = {};
                    for (var k in it) if (it.hasOwnProperty(k)) cp[k] = it[k];
                    items.push(cp);
                }
            }
            var added = 0;
            for (var a = 0; a < itemsToAdd.length; a++) {
                var src = itemsToAdd[a];
                if (!src || !src.qty) continue;
                // Gộp theo tên + biến thể để tránh trùng dòng
                var merged = false;
                for (var j = 0; j < items.length; j++) {
                    if (items[j].name === src.name && (items[j].variantName || '') === (src.variantName || '')) {
                        items[j].qty = (items[j].qty || 0) + src.qty;
                        merged = true;
                        break;
                    }
                }
                if (!merged) {
                    var ni = {
                        id: src.id || ('it_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 4)),
                        name: src.name,
                        price: src.price,
                        qty: src.qty,
                        variantName: src.variantName,
                        addedTime: src.addedTime || new Date().toISOString()
                    };
                    items.push(ni);
                }
                added += src.qty;
            }
            if (added <= 0) return null;   // không có gì để thêm
            var total = 0;
            for (var t = 0; t < items.length; t++) total += (items[t].price || 0) * (items[t].qty || 0);
            // KHÔNG thêm trường mới: chỉ ghi recentAdds nếu bản ghi đã có nó.
            var patch = { items: items, total: total };
            if (cur.recentAdds !== undefined) patch.recentAdds = cur.recentAdds;
            return patch;
        });
    }

    /**
     * Xoá món theo MÃ (không theo chỉ số) để không xoá nhầm khi mảng đã bị máy
     * khác thay đổi giữa lúc người dùng nhìn và lúc bấm.
     * @param match  function(mon) -> boolean
     */
    function removeItemsFromTable(tableId, match) {
        return patchTable(tableId, function (cur) {
            if (!Array.isArray(cur.items)) return null;
            var items = [];
            var removed = [];
            for (var i = 0; i < cur.items.length; i++) {
                var it = cur.items[i];
                if (it && match(it)) { removed.push(it); continue; }
                if (it) items.push(it);
            }
            if (removed.length === 0) return null;   // món đã bị máy khác xoá rồi
            var total = 0;
            for (var t = 0; t < items.length; t++) total += (items[t].price || 0) * (items[t].qty || 0);
            var patch = { items: items, total: total };
            // recentAdds đã có sẵn ở bản ghi thì mới xoá (danh sách "vừa thêm")
            if (cur.recentAdds !== undefined) patch.recentAdds = [];
            return patch;
        });
    }

// ========== GIAO DICH NGUYEN TỐ CHO BAN ==========
    /**
     * "Giành" một bàn để thanh toán, an toàn khi 2 máy cùng bấm.
     *
     * VÌ SAO CẦN: bảng `tables` trong RAM mỗi máy một bản. Hai máy cùng mở
     * cùng một bàn và cùng bấm Thanh toán thì cả hai đều đọc được bàn (đều có
     * món), cả hai ghi một giao dịch lịch sử với id khác nhau và cả hai mở két
     * tiền -> thu tiền 2 lần cho 1 hoá đơn, còn bàn thì chỉ bị xoá 1 lần.
     *
     * CÁCH LÀM (không thêm trường nào vào dữ liệu):
     *   runTransaction trên chính node `tables/{id}`. Trong callback:
     *     - node không còn  -> máy khác đã giành trước -> trả undefined để hủy
     *     - node còn và có món -> ghi về null (xoá) để GIÀNH, trả về dữ liệu cũ
     *   Firebase chạy các transaction tuần tự trên server, nên chỉ đúng một máy
     *   thấy node còn tồn tại và giành được.
     *
     * Nếu sau khi giành mà ghi lịch sử lỗi, gọi releaseTableClaim() để trả
     * bản ghi cũ về đúng chỗ - dữ liệu vẽ về đúng như trước, không phát sinh
     * trường mới.
     *
     * @returns {Promise<{claimed:boolean, table:object|null, reason:string}>}
     */
    function claimTable(tableId) {
        var shopId = CURRENT_SHOP_ID;
        var ref = _getDb().ref(shopId + '/tables/' + tableId);
        // Giữ lại bản ghi gốc BÊN TRONG transaction.
        // Không đọc được từ result.snapshot sau khi commit vì lúc đó node đã bị
        // ghi null (đó chính là cách giành quyền) nên snapshot.val() = null.
        var original = null;
        return ref.transaction(function (cur) {
            if (cur === null || cur === undefined) return undefined;  // hủy
            if (!cur.items || !cur.items.length) return undefined;    // bàn rỗng -> hủy
            original = cur;
            return null;                                                // xoá = giành được
        }).then(function (result) {
            if (!result.committed) {
                return { claimed: false, table: null, reason: 'Ban da duoc thanh toan tren may khac' };
            }
            // Firebase có thể chạy lại transaction; chỉ giữ bản ghi thật.
            return { claimed: true, table: original, reason: '' };
        }).catch(function (err) {
            // Không phân biệt được lỗi mạng với việc bàn không tồn tại:
            // cả hai đều KHÔNG được coi là giành được, để an toàn cho tiền.
            console.warn('[DB] claimTable lỗi:', err && err.message);
            return { claimed: false, table: null, reason: 'Khong kiem tra duoc ban tren may chu' };
        });
    }

    /**
     * Trả bàn về sau khi đã giành nhưng thao tác thanh toán thất bại.
     * Ghi lại ĐÚNG bản ghi cũ - không thêm trường, không đổi cấu trúc.
     */
    function releaseTableClaim(tableId, tableSnapshot) {
        if (!tableSnapshot) return Promise.resolve(false);
        var shopId = CURRENT_SHOP_ID;
        var ref = _getDb().ref(shopId + '/tables/' + tableId);
        return ref.transaction(function (cur) {
            // Chỉ khôi phục nếu bàn vẫn đang vắng (tức là do mình giành).
            // Nếu đã có bàn mới thì không đụng.
            if (cur !== null && cur !== undefined) return undefined;
            return tableSnapshot;
        }).then(function (result) {
            if (result.committed) {
                // Đồng bộ lại máy này để UI thấy bàn đã quay lại
                var copy = {};
                for (var k in tableSnapshot) if (tableSnapshot.hasOwnProperty(k)) copy[k] = tableSnapshot[k];
                copy.id = String(copy.id || tableId);
                copy.updatedAt = Date.now();
                copy.updatedBy = CURRENT_DEVICE_ID;
                return saveToLocal('tables', copy).then(function () {
                    _notifyLocal('tables', { type: 'added', item: copy, collection: 'tables' });
                    return true;
                });
            }
            return false;
        }).catch(function (err) {
            console.error('[DB] releaseTableClaim lỗi:', err);
            return false;
        });
    }

// ========== KHOA CHONG THAO TAC TRUNG LAP ==========
    // Dùng chung cho mọi thao tác tạo tiền / sửa dữ liệu: thanh toán, ghi nợ,
    // tách-chuyển-gộp bàn, xoá bàn, thêm sửa lịch sử khách.
    //
    // Vì sao cần: nhiều hàm ghi tiền ĐỒNG BỘ (đọc rồi ghi ngay, không có await
    // ở giữa) nên một cú bấm hai lần sẽ chạy trọn vẹn cả hai lần: trừ nợ hai
    // lần, ghai hai giao dịch, mở két tiền hai lần. Ứng dụng chạy trên máy
    // POS thường bấm nhanh và bấm lại khi chưa thấy phản hồi.
    //
    // ttl là lưới an toàn: nếu một nhánh lỗi quên nhả khoá, khoá tự mở sau ttl
    // thay vì chặt vĩnh viễn. Mọi đường thoát bình thường vẫn phải gọi
    // releaseBusyLock() để mở ngay lập tức.
    var _busyLocks = {};

    function acquireBusyLock(key, ttlMs) {
        key = key || '_default';
        var now = Date.now();
        var cur = _busyLocks[key];
        if (cur && cur.until > now) return false;
        var ttl = ttlMs || 20000;
        var rec = { until: now + ttl, timer: null };
        rec.timer = setTimeout(function () {
            if (_busyLocks[key] === rec) delete _busyLocks[key];
        }, ttl);
        _busyLocks[key] = rec;
        return true;
    }

    function releaseBusyLock(key) {
        key = key || '_default';
        var rec = _busyLocks[key];
        if (!rec) return;
        if (rec.timer) clearTimeout(rec.timer);
        delete _busyLocks[key];
    }

    function isBusyLocked(key) {
        key = key || '_default';
        var rec = _busyLocks[key];
        return !!(rec && rec.until > Date.now());
    }

    /**
     * Bọc một hàm bất đồng bộ bằng khoá chống chạy trùng.
     * Nếu đang chạy thì trả về Promise đã resolve với { skipped: true }
     * thay vì ném lỗi - để code gọi không phải bắt try/catch.
     */
    function withBusyLock(key, ttlMs, fn) {
        if (!acquireBusyLock(key, ttlMs)) {
            return Promise.resolve({ skipped: true, locked: true });
        }
        return Promise.resolve()
            .then(function () { return fn(); })
            .then(
                function (v) { releaseBusyLock(key); return v; },
                function (e) { releaseBusyLock(key); throw e; }
            );
    }
    // Lấy danh sách keys từ Firebase (chỉ keys, không lấy data)
    // Dùng REST API shallow=true để tối ưu băng thông
    // Fallback về SDK once('value') nếu REST API lỗi
    
    // Lưu databaseURL để dùng cho REST API (Firebase Database Reference.toString() không hoạt động)
    var _databaseURL = firebaseConfig.databaseURL;
    
    function _getFirebaseKeys(collection) {
        // Xây dựng URL cho REST API shallow=true
        // Firebase REST API: https://<databaseURL>/<path>.json?shallow=true
        var baseUrl = _databaseURL.replace(/\/$/, '');
        var url = baseUrl + '/' + encodeURIComponent(CURRENT_SHOP_ID) + '/' + encodeURIComponent(collection) + '.json?shallow=true';
        
        // Thử dùng fetch với shallow=true trước
        if (typeof fetch === 'function') {
            return fetch(url, { cache: 'no-store' }).then(function(res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            }).then(function(data) {
                // ===== PHẦN QUAN TRỌNG - ĐỪNG BỎ QUA =====
                // REST API trả về HTTP 200 với body `null` khi security rules
                // từ chối đọc. Trước đây code coi `null` là "collection rỗng" và
                // trả về {} -> reconcileCollection hiểu là "server không có bản
                // ghi nào" -> XOÁ TOÀ BỘ collection khỏi máy.
                // Đã xảy ra thật: shop dùng custom Firebase config, REST không
                // kèm token nên bị rules từ chối, kết quả là xoá sạch menu,
                // khách hàng, thông tin quán và bàn.
                // Nay: coi `null` là LỖI ĐỌC, fallback sang SDK (có đăng nhập)
                // để lấy key thật.
                if (data === null || data === undefined) {
                    throw new Error('null response (bị rules từ chối hoặc sai URL)');
                }
                var keys = {};
                if (typeof data === 'object') {
                    for (var key in data) {
                        if (data.hasOwnProperty(key)) keys[key] = true;
                    }
                }
                return keys;
            }).catch(function(err) {
                console.warn('[Reconcile] REST shallow đọc', collection, 'không dùng được:',
                    (err && err.message) || err, '- chuyển sang SDK');
                // Fallback: dùng SDK once('value') và chỉ lấy keys
                return _getFirebaseKeysViaSDK(collection);
            });
        }
        
        // Fallback: dùng SDK
        return _getFirebaseKeysViaSDK(collection);
    }
    
    function _getFirebaseKeysViaSDK(collection) {
        return new Promise(function(resolve, reject) {
            _getDb().ref(CURRENT_SHOP_ID + '/' + collection).once('value', function(snapshot) {
                var keys = {};
                if (snapshot.exists()) {
                    var val = snapshot.val();
                    for (var key in val) {
                        if (val.hasOwnProperty(key)) keys[key] = true;
                    }
                }
                resolve(keys);
            }, function(err) {
                // FIX: trước đây lỗi mạng trả về {} -> reconcile hiểu là
                // "Firebase không có bản ghi nào" -> xoá TOÀN BỘ collection
                // khỏi local. Một lần rớt mạng là mất sạch khách hàng.
                // Nay báo lỗi để reconcile dừng lại, giữ nguyên dữ liệu local.
                console.warn('[Reconcile] Không đọc được danh sách key của', collection,
                    '- giữ nguyên dữ liệu local:', (err && err.message) || err);
                reject(new Error('Không đọc được danh sách key của ' + collection));
            });
        });
    }
    
    // ========== CHÍNH SÁCH GIẢI QUYẾT XUNG ĐỘT ==========
    // Đây là CHỮ DUY NHẤT quyết định khi hai thay đổi cùng một bản ghi chạm
    // vào nhau. Trước đây không có quy tắc: thứ tự batch (chia theo
    // collection|action) quyết định thắng thua, nên một thay đổi có thể bị
    // thay đổi cũ ghi đên im lặng.
    //
    // onConflict - cách gộp hai thay đổi cùng một bản ghi:
    //   'last-write-wins' : máy nào sửa sau thì thắng.
    //   'append-only'     : KHÔNG ghi đè bản ghi đã có, bỏ thay đổi và ghi
    //                       nhận xung đột. Chỉ dùng cho dữ liệu thật sự
    //                       không được sửa. CẢNH BÁO: nếu áp nhầm cho một bảng
    //                       mà ứng dụng có sửa, mọi thay đổi đó sẽ bị bỏ âm
    //                       thầm. Xem các bảng bên dưới.
    //   'merge-history'   : CHƯA HIỆN THỰC - dành cho giai đoạn sau khi tách
    //                       lịch sử nợ thành node con. Hiện tại giá trị này
    //                       hành xử y hệt 'last-write-wins'.
    //
    // onDeleteConflict - khi một bản ghi vừa được xoá lại vừa bị sửa:
    //   'remove-wins'     : xoá thắng. Phần sửa bị bỏ nhưng được lưu vào
    //                       sync_conflicts để không mất im lặng.
    //   'newest-wins'     : thay đổi mới hơn thắng, lệnh xoá bị bỏ.
    var _DEFAULT_POLICY = { onConflict: 'last-write-wins', onDeleteConflict: 'remove-wins' };
    var SYNC_POLICY = {
        // Khách hàng: xoá thắng. Đồng bộ lịch sử nợ/tra nợ theo từng khoản
        // thuộc giai đoạn 3, chưa làm ở đây.
        customers: { onConflict: 'last-write-wins', onDeleteConflict: 'remove-wins' },
        // Giao dịch: ứng dụng CÓ sửa giao dịch - hoàn tiền gắn cờ
        // refunded (history.js và pos.js gọi DB.update('transactions', ...)).
        // Nếu đặt 'append-only' ở đây thì thao tác hoàn tiền bị bỏ và máy
        // khác không bao giờ thấy giao dịch đã huỷ. Vì vậy là
        // 'last-write-wins', và việc chống ghi đè sẽ lo ở giai đoạn 3.
        transactions: { onConflict: 'last-write-wins', onDeleteConflict: 'remove-wins' },
        cost_transactions: { onConflict: 'last-write-wins', onDeleteConflict: 'remove-wins' },
        cost_transactions_admin: { onConflict: 'last-write-wins', onDeleteConflict: 'remove-wins' },
        inventory_transactions: { onConflict: 'last-write-wins', onDeleteConflict: 'remove-wins' },
        ingredient_transactions: { onConflict: 'last-write-wins', onDeleteConflict: 'remove-wins' },
        manager_cash_pickups: { onConflict: 'last-write-wins', onDeleteConflict: 'remove-wins' },
        daily_balances: { onConflict: 'last-write-wins', onDeleteConflict: 'remove-wins' },
        // Bảng và danh mục: không quan trọng về tiền, sửa sau thì thắng,
        // hồi sinh bản ghi đã xoá cũng được.
        tables: { onConflict: 'last-write-wins', onDeleteConflict: 'newest-wins' },
        menu: { onConflict: 'last-write-wins', onDeleteConflict: 'newest-wins' },
        menu_categories: { onConflict: 'last-write-wins', onDeleteConflict: 'newest-wins' },
        ingredients: { onConflict: 'last-write-wins', onDeleteConflict: 'newest-wins' },
        staffs: { onConflict: 'last-write-wins', onDeleteConflict: 'newest-wins' },
        cost_categories: { onConflict: 'last-write-wins', onDeleteConflict: 'newest-wins' }
    };

    function _policyFor(collection) {
        return SYNC_POLICY[collection] || _DEFAULT_POLICY;
    }

    var _syncConflictStore = 'sync_conflicts';
    var _syncConflicts = [];   // bản ghi xung đột chưa xử lý

    /**
     * Ghi nhận một xung đột bị giải quyết bằng quy tắc: phần nào thắng,
     * phần nào bị bỏ, và giữ lại dữ liệu bị bỏ để không mất im lặng.
     * Ghi vào IndexedDB để còn đọc được sau khi đóng app.
     */
    function _recordSyncConflict(collection, targetId, keptAction, droppedAction, droppedData, reason) {
        var rec = {
            id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
            collection: collection,
            targetId: targetId,
            keptAction: keptAction,
            droppedAction: droppedAction,
            droppedData: droppedData || null,
            reason: reason,
            resolved: false,
            createdAt: Date.now(),
            deviceId: CURRENT_DEVICE_ID
        };
        _syncConflicts.push(rec);
        try { saveToLocal(_syncConflictStore, rec); } catch (e) { /* store chưa sẵn sàng: vẫn giữ trong RAM */ }
        console.warn('[SyncConflict] ' + collection + '/' + targetId + ': giữ ' + keptAction +
            ', bỏ ' + droppedAction + ' - ' + reason);
        return rec.id;
    }

    function getSyncConflicts(includeResolved) {
        return _syncConflicts.filter(function (c) {
            return includeResolved ? true : !c.resolved;
        });
    }

    // Tập các bản ghi đang chờ gửi lên Firebase. Bản ghi nằm trong tập này thì
    // CHƯA được xoá khỏi local dù Firebase chưa có - nếu xoá, thay đổi của máy
    // này mất sạch trước khi kịp gửi đi.
    function _getUnsyncedKeys(collection) {
        var set = {};
        for (var i = 0; i < syncQueue.length; i++) {
            var q = syncQueue[i];
            if (!q || q.collection !== collection) continue;
            if (q.status === 'synced') continue;
            if (!_queueBelongsToCurrentShop(q)) continue;
            set[q.targetId] = true;
        }
        return set;
    }

    /**
     * Mục hàng đợi này có thuộc shop đang mở không.
     *
     * Mục cũ (tạo trước khi có trường shopId) được coi là thuộc shop hiện tại
     * để không vứt mất dữ liệu chưa gửi. Một POS thường chỉ dùng một shop nên
     * giả định này đúng; nếu sau này hỗ trợ đổi shop trên cùng máy thì các
     * mục tạo sau bản này đều đã có shopId rõ ràng.
     */
    function _queueBelongsToCurrentShop(q) {
        if (!q) return false;
        if (!q.shopId) return true;              // mục cũ chưa có nhãn
        return q.shopId === CURRENT_SHOP_ID;
    }
    
    // ========== NHỚ KEY ĐÃ THẤY TỪ LISTENER (không tốn request) ==========
    // Khi gắn ref.on('child_added'), Firebase gửi về MỌI bản ghi hiện có trên
    // server. Tập key thu được đó chính là danh sách key thật của server.
    // Nhờ vậy ta dọn được bản ghi local đã bị xoá ở máy khác mà KHÔNG cần tải
    // toàn bộ collection về chỉ để so sánh key.
    //
    // VÌ SAO CẦN: REST `?shallow=true` bị rules chặn (trả null) nên fallback sang
    // SDK `once('value')` - cái này TẢI TOÀN BỘ collection. Chạy reconcile mỗi
    // lần mở app thì rất tốn băng thông. Cách này dùng đúng dữ liệu listener đã
    // tải sẵn, chi phí bằng 0.
    var _remoteKeysSeen = {};   // { collection: { key: true } }
    var _remoteKeysSeenReady = {};   // { collection: true } -> đã nhận đủ lần đầu
    
    function _markRemoteKeySeen(collection, key) {
        if (!_remoteKeysSeen[collection]) _remoteKeysSeen[collection] = {};
        _remoteKeysSeen[collection][key] = true;
    }
    
    function _resetRemoteKeysSeen(collection) {
        if (collection) {
            delete _remoteKeysSeen[collection];
            delete _remoteKeysSeenReady[collection];
        } else {
            _remoteKeysSeen = {};
            _remoteKeysSeenReady = {};
        }
    }
    
    // Dọn bản ghi local đã không còn trên server, dựa vào key đã thấy từ listener.
    // Dùng cùng bộ lưới an toàn với reconcileCollection.
    function reconcileFromSeenKeys(collection) {
        if (!isOnline) return Promise.resolve({ added: 0, removed: 0 });
        if (!MASTER_COLLECTIONS[collection]) return Promise.resolve({ added: 0, removed: 0 });
        // `info` là object đơn, không phải collection có key (xem reconcileCollection)
        if (collection === 'info') return Promise.resolve({ added: 0, removed: 0 });
        
        var seen = _remoteKeysSeen[collection];
        if (!seen) return Promise.resolve({ added: 0, removed: 0 });
        
        var seenCount = 0;
        for (var sk in seen) { if (seen.hasOwnProperty(sk)) seenCount++; }
        if (seenCount === 0) {
            // Chưa nhận được bản ghi nào -> chưa đủ cơ sở để kết luận, KHÔNG xoá gì.
            return Promise.resolve({ added: 0, removed: 0 });
        }
        
        var localKeys = {};
        if (memoryCache[collection]) {
            for (var lk in memoryCache[collection]) {
                if (memoryCache[collection].hasOwnProperty(lk)) localKeys[lk] = true;
            }
        }
        var localCount = 0;
        for (var lc in localKeys) { if (localKeys.hasOwnProperty(lc)) localCount++; }
        
        var unsynced = _getUnsyncedKeys(collection);
        var extraKeys = [];
        for (var key in localKeys) {
            if (localKeys.hasOwnProperty(key) && !seen[key] && !unsynced[key]) {
                extraKeys.push(key);
            }
        }
        
        // Lưới an toàn: không xoá toàn bộ collection
        if (extraKeys.length > 0 && extraKeys.length >= localCount && localCount > 0) {
            console.warn('[Reconcile] BỎ QUA xoá ' + collection + ': ' + extraKeys.length + '/' +
                         localCount + ' bản ghi không còn trên server (suspicious). Giữ local.');
            return Promise.resolve({ added: 0, removed: 0, skipped: true });
        }
        
        if (extraKeys.length === 0) return Promise.resolve({ added: 0, removed: 0 });
        
        console.log('[Reconcile] ' + collection + ': xoá ' + extraKeys.length +
                    ' bản ghi không còn trên server');
        var chain = Promise.resolve();
        var removed = 0;
        for (var i = 0; i < extraKeys.length; i++) {
            (function(k) {
                chain = chain.then(function() {
                    return deleteFromLocal(collection, k).then(function() { removed++; });
                });
            })(extraKeys[i]);
        }
        return chain.then(function() {
            if (removed > 0) {
                _emit(collection + ':reconciled', {
                    collection: collection, added: 0, removed: removed, timestamp: Date.now()
                });
            }
            return { added: 0, removed: removed };
        })['catch'](function(err) {
            console.warn('[Reconcile] Lỗi dọn ' + collection + ':', (err && err.message) || err);
            return { added: 0, removed: 0 };
        });
    }

    // Reconciliation: So sánh keys giữa Firebase và local
    // - Keys thiếu (có trên Firebase, không trong local) → tải bổ sung
    // - Keys dư (có trong local, không trên Firebase) → xóa khỏi local
    // Chỉ áp dụng cho MASTER_COLLECTIONS (tables, customers, menu, ...)
    // Date-based collections dùng deltaSync riêng
    function reconcileCollection(collection) {
        if (!isOnline) return Promise.resolve({ added: 0, removed: 0 });

        // ===== `info` KHÔNG PHẢI COLLECTION, MÀ LÀ MỘT OBJECT ĐƠN =====
        // Trên server, /info là object phẳng: { name, telegramBotToken,
        // lockPassword, ... } - KHÔNG có child tên 'shop_config'.
        // Còn local, saveToLocal('info', {id:'shop_config', ...}) lưu thành MỘT
        // bản ghi có key 'shop_config'.
        // Nếu chạy reconcile, so sánh key sẽ ra:
        //   thiếu 0 (không key nào của server lạ), dư 1 ('shop_config')
        // -> xoá thông tin quán mỗi lần mở app (tên quán, token Telegram,
        // mật khẩu khoá, giờ khoá bàn...).
        // `info` đã được đồng bộ bằng listener onValue riêng -> không cần
        // reconcile theo key.
        if (collection === 'info') {
            return Promise.resolve({ added: 0, removed: 0, skipped: true });
        }

        var isMaster = MASTER_COLLECTIONS[collection];
        if (!isMaster) {
            // Date-based collections không reconcile (dùng deltaSync)
            return deltaSync(collection).then(function() {
                return { added: 0, removed: 0 };
            });
        }

        return _getFirebaseKeys(collection).then(function(fbKeys) {
            // Lấy local keys từ memory cache
            var localKeys = {};
            if (memoryCache[collection]) {
                for (var key in memoryCache[collection]) {
                    if (memoryCache[collection].hasOwnProperty(key)) {
                        localKeys[key] = true;
                    }
                }
            }

            // ===== LƯỚI AN TOÀN: KHÔNG XOÁ HÀNG LOẠT KHI SERVER RỖNG =====
            // Tình huống "server trả về 0 key nhưng máy có N bản ghi" gần như
            // luôn là lỗi đọc (rules chặn, mạng lỗi, sai shopId), KHÔNG phải
            // người dùng thật sự xoá sạch dữ liệu từ máy khác.
            // Nếu tin nhầm và xoá, mất sạch menu/khách/bàn - không khôi phục được.
            // Thà giữ dữ liệu cũ hơn còn hơn mất.
            var fbCount = 0;
            for (var k in fbKeys) { if (fbKeys.hasOwnProperty(k)) fbCount++; }
            var localCount = 0;
            for (var k2 in localKeys) { if (localKeys.hasOwnProperty(k2)) localCount++; }
            if (fbCount === 0 && localCount > 0) {
                console.warn('[Reconcile] BỎ QUA xoá ' + collection + ': server trả về 0 key nhưng máy có ' +
                             localCount + ' bản ghi. Có thể bị rules chặn đọc hoặc sai shopId. ' +
                             'Giữ nguyên dữ liệu local.');
                return { added: 0, removed: 0, skipped: true };
            }

            // Tìm keys thiếu (có trên Firebase, không trong local)
            var missingKeys = [];
            for (var key in fbKeys) {
                if (fbKeys.hasOwnProperty(key) && !localKeys[key]) {
                    missingKeys.push(key);
                }
            }

            // Tìm keys dư (có trong local, không trên Firebase)
            // BỎ QUA bản ghi đang chờ đồng bộ. Xoá chúng là lỗi mất dữ liệu:
            // ghi nợ lúc mạng yếu, app đồng bộ lại, bản ghi bị xoá khỏi local
            // và biến mất khỏi màn hình trước khi kịp gửi lên Firebase.
            var unsynced = _getUnsyncedKeys(collection);
            var extraKeys = [];
            for (var key in localKeys) {
                if (localKeys.hasOwnProperty(key) && !fbKeys[key] && !unsynced[key]) {
                    extraKeys.push(key);
                }
            }
            
            if (missingKeys.length === 0 && extraKeys.length === 0) {
                return { added: 0, removed: 0 };
            }
            
            // ===== LƯỚI AN TOÀN 2: KHÔNG XOÁ QUÁ NHIỀU MỘT LẦN =====
            // Xoá gần hết collection gần như luôn là dấu hiệu đọc sai dữ liệu
            // từ server, không phải người dùng xoá thật. Ngưỡng: không xoá quá
            // 50% số bản ghi local trong một lần reconcile. Muốn dọn thì xoá tay.
            if (extraKeys.length > 0 && extraKeys.length >= localCount && localCount > 0) {
                console.warn('[Reconcile] BỎ QUA xoá ' + collection + ': sắp xoá ' + extraKeys.length +
                             '/' + localCount + ' bản ghi (toàn bộ). Quá nhiều trong 1 lần, ' +
                             'có thể đọc sai server. Giữ nguyên dữ liệu local.');
                return { added: 0, removed: 0, skipped: true };
            }
            
            console.log('[Reconcile] ' + collection + ': thiếu ' + missingKeys.length + ', dư ' + extraKeys.length);
            
            var addedCount = 0;
            var removedCount = 0;
            var chain = Promise.resolve();
            
            // Tải items thiếu từ Firebase
            if (missingKeys.length > 0) {
                var fbRef = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
                for (var i = 0; i < missingKeys.length; i++) {
                    (function(missingKey) {
                        chain = chain.then(function() {
                            return fbRef.child(missingKey).once('value').then(function(itemSnapshot) {
                                if (itemSnapshot.exists()) {
                                    var src = itemSnapshot.val() || {};
                                    var item = { id: missingKey };
                                    for (var p in src) {
                                        if (src.hasOwnProperty(p)) item[p] = src[p];
                                    }
                                    if (item._version === undefined) item._version = 1;
                                    return saveToLocal(collection, item).then(function() {
                                        addedCount++;
                                    });
                                }
                            });
                        });
                    })(missingKeys[i]);
                }
            }
            
            // Xóa items dư khỏi local
            if (extraKeys.length > 0) {
                for (var i = 0; i < extraKeys.length; i++) {
                    (function(extraKey) {
                        chain = chain.then(function() {
                            return deleteFromLocal(collection, extraKey).then(function() {
                                removedCount++;
                            });
                        });
                    })(extraKeys[i]);
                }
            }
            
            return chain.then(function() {
                if (addedCount > 0 || removedCount > 0) {
                    console.log('[Reconcile] ✅ ' + collection + ': thêm ' + addedCount + ', xóa ' + removedCount);
                    // Phát sự kiện reconcile hoàn tất
                    _emit(collection + ':reconciled', { collection: collection, added: addedCount, removed: removedCount, timestamp: Date.now() });
                }
                return { added: addedCount, removed: removedCount };
            });
        }).catch(function(err) {
            // Không đọc được danh sách key từ Firebase thì KHÔNG được xoá gì cả.
            // Xoá khi chưa biết chắc Firebase có bản ghi hay không là mất dữ
            // liệu. Giữ nguyên local và thử lại ở lần đồng bộ sau.
            console.warn('[Reconcile] ⚠️ Bỏ qua', collection, '- không xác minh được Firebase:', err && err.message);
            return { added: 0, removed: 0, skipped: true };
        });
    }

    // ========== SYNC META ==========
    var SYNC_META_STORE = 'sync_meta';
    var syncMetaCache = {}; // memory cache cho sync_meta
    
    var THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    
    // ========== DATA RETENTION: Số ngày lưu trữ dữ liệu ==========
    // Admin: 50 ngày, Employee: 2 ngày
    function _getRetentionDays() {
        return _isEmployeeMode() ? 2 : 50;
    }
    function _getRetentionMs() {
        return _getRetentionDays() * 24 * 60 * 60 * 1000;
    }
    
    var _isEmployeeMode = function() {
        return !currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'master_admin');
    };
    
    var DATE_BASED_COLLECTIONS = {
        transactions: true,
        daily_balances: true,
        cost_transactions: true,
        inventory_transactions: true,
        ingredient_transactions: true,
        manager_cash_pickups: true,
        employee_attendance: true,
        employee_salaries: true,
        delete_logs: true,
        drawer_sessions: true,
        notifications: true
    };
    
    var MASTER_COLLECTIONS = {
        tables: true,
        customers: true,
        menu: true,
        menu_categories: true,
        ingredients: true,
        staffs: true,
        cost_categories: true,
        info: true,
        bonus_fund: true
    };
    
    var _syncTimer = null;
    var _syncPending = false;
    function _debouncedProcessSyncQueue() {
        if (_syncPending) return;
        _syncPending = true;
        if (_syncTimer) clearTimeout(_syncTimer);
        _syncTimer = setTimeout(function() {
            _syncTimer = null;
            _syncPending = false;
            processSyncQueue();
        }, 100);
    }
    
    var memoryCache = {};
    var cacheVersion = {};
    
    // FIX: Đánh dấu collection đang được fullSync để tránh race condition
    // Khi fullSync() clear IndexedDB + memoryCache, nếu loadFromLocal() đọc giữa lúc đó
    // sẽ trả về [] -> gây mất dữ liệu (vd: customers chỉ hiện 2/10)
    var _syncingCollections = {}; // { collection: true }
    
    // ========== PHASE 2: Memory Cache theo ngày ==========
    var _currentDateKey = toDateKey(Date.now()); // Ngày hiện tại
    var MEMORY_CACHE_LIMITS = {
        transactions: 2000,  // Giữ 2000 giao dịch gần nhất trong RAM (đủ cho 31 ngày)
        default: 1000
    };
    
    // Kiểm tra xem collection có nên giới hạn theo ngày không
    function _isDateBasedCollection(collection) {
        return collection === 'transactions';
    }
    
    // Lấy ngày hiện tại từ memory cache
    function _getCurrentDateKey() {
        return _currentDateKey;
    }
    
    // Cập nhật ngày hiện tại (khi user chọn ngày khác)
    function _setCurrentDateKey(dateKey) {
        if (dateKey && dateKey !== _currentDateKey) {
            var oldKey = _currentDateKey;
            _currentDateKey = dateKey;
            // Xóa transactions không thuộc ngày mới khỏi memory cache
            _cleanMemoryCacheForDateChange('transactions', oldKey, dateKey);
        }
    }
    
    // Dọn dẹp memory cache khi đổi ngày
    function _cleanMemoryCacheForDateChange(collection, oldDateKey, newDateKey) {
        if (!memoryCache[collection]) return;
        var keys = Object.keys(memoryCache[collection]);
        for (var i = 0; i < keys.length; i++) {
            var item = memoryCache[collection][keys[i]];
            if (item && item.dateKey && item.dateKey !== newDateKey) {
                delete memoryCache[collection][keys[i]];
            }
        }
        console.log('[Cache] Đã dọn ' + collection + ' khi đổi ngày: ' + oldDateKey + ' -> ' + newDateKey + ', còn ' + Object.keys(memoryCache[collection]).length + ' items');
    }
    
    // Giới hạn kích thước memory cache cho 1 collection
    // Chỉ log 1 lần cho mỗi collection khi có xóa, tránh tràn log
    var _enforceLogged = {};
    function _enforceMemoryCacheLimit(collection) {
        if (!memoryCache[collection]) return;
        var limit = MEMORY_CACHE_LIMITS[collection] || MEMORY_CACHE_LIMITS.default;
        var keys = Object.keys(memoryCache[collection]);
        if (keys.length <= limit) return;
        
        // Sắp xếp theo createdAt (cũ nhất trước)
        var sorted = keys.slice().sort(function(a, b) {
            var aTime = memoryCache[collection][a].createdAt || memoryCache[collection][a].updatedAt || 0;
            var bTime = memoryCache[collection][b].createdAt || memoryCache[collection][b].updatedAt || 0;
            return aTime - bTime;
        });
        
        var toRemove = sorted.slice(0, keys.length - limit);
        for (var i = 0; i < toRemove.length; i++) {
            delete memoryCache[collection][toRemove[i]];
            // PHASE 4: Dọn cache timestamp tương ứng
            if (_cacheTimestamps[collection]) {
                delete _cacheTimestamps[collection][toRemove[i]];
            }
        }
        // Chỉ log 1 lần cho mỗi collection để tránh tràn log
        if (!_enforceLogged[collection]) {
            _enforceLogged[collection] = true;
            console.log('[Cache] Đã giới hạn ' + collection + ': xóa ' + toRemove.length + ' items cũ, còn ' + limit + ' items');
        }
    }
    
    // ========== PHASE 4: TTL Cache & Periodic Cleanup ==========
    var _cacheTimestamps = {}; // { collection: { key: timestamp } } - lưu thời điểm cache
    var _CACHE_TTL = 30 * 60 * 1000; // 30 phút
    var _cleanupIntervalId = null;
    
    // Ghi lại thời điểm cache 1 item
    function _markCacheTime(collection, key) {
        if (!_cacheTimestamps[collection]) _cacheTimestamps[collection] = {};
        _cacheTimestamps[collection][key] = Date.now();
    }
    
    // Kiểm tra cache còn hạn không
    function _isCacheValid(collection, key) {
        if (!_cacheTimestamps[collection] || !_cacheTimestamps[collection][key]) return false;
        return (Date.now() - _cacheTimestamps[collection][key]) < _CACHE_TTL;
    }
    
    // Dọn dẹp cache cũ định kỳ
    function _periodicCacheCleanup() {
        var now = Date.now();
        var totalRemoved = 0;
        
        // Các master collections KHÔNG bị xóa khỏi memory cache vì:
        // 1. Dữ liệu ít thay đổi, cần luôn sẵn sàng cho UI
        // 2. Nếu bị xóa, loadData() sẽ fallback về IndexedDB có thể trả về [] (race condition với fullSync)
        // 3. Gây lỗi hiển thị thiếu dữ liệu (vd: customers chỉ hiện 2/10)
        var _masterCollections = {
            customers: true,
            menu: true,
            menu_categories: true,
            ingredients: true,
            tables: true,
            info: true
        };
        
        // Dọn memoryCache items quá hạn
        for (var col in memoryCache) {
            if (!memoryCache.hasOwnProperty(col)) continue;
            if (col === 'transactions') continue; // transactions đã có cơ chế riêng
            if (_masterCollections[col]) continue; // master collections giữ nguyên
            var keys = Object.keys(memoryCache[col]);
            for (var i = 0; i < keys.length; i++) {
                var key = keys[i];
                if (!_isCacheValid(col, key)) {
                    delete memoryCache[col][key];
                    totalRemoved++;
                }
            }
        }
        
        // Dọn _cacheTimestamps cũ
        for (var col in _cacheTimestamps) {
            if (!_cacheTimestamps.hasOwnProperty(col)) continue;
            var tsKeys = Object.keys(_cacheTimestamps[col]);
            for (var i = 0; i < tsKeys.length; i++) {
                if ((now - _cacheTimestamps[col][tsKeys[i]]) > _CACHE_TTL * 2) {
                    delete _cacheTimestamps[col][tsKeys[i]];
                }
            }
        }
        
        // PHASE 4: Dọn _txDateCacheTimestamps cũ
        var txKeys = Object.keys(_txDateCacheTimestamps);
        for (var i = 0; i < txKeys.length; i++) {
            if ((now - _txDateCacheTimestamps[txKeys[i]]) > _TX_DATE_CACHE_TTL * 3) {
                delete _txDateCache[txKeys[i]];
                delete _txDateCacheTimestamps[txKeys[i]];
                totalRemoved++;
            }
        }
        
        if (totalRemoved > 0) {
            console.log('[Cache] 🧹 Periodic cleanup: đã xóa ' + totalRemoved + ' items quá hạn');
        }
    }
    
    // Khởi động periodic cleanup (gọi sau khi DB.init hoàn tất)
    function _startPeriodicCleanup() {
        if (_cleanupIntervalId) return;
        _cleanupIntervalId = setInterval(_periodicCacheCleanup, 5 * 60 * 1000); // 5 phút
    }
    
    var _localCallbacks = {};
    
    // Event types: 'collection:added', 'collection:changed', 'collection:removed'
    var _eventBus = {};
    
    function _on(eventType, callback) {
        if (!_eventBus[eventType]) _eventBus[eventType] = [];
        _eventBus[eventType].push(callback);
        return function() {
            _off(eventType, callback);
        };
    }
    
    function _off(eventType, callback) {
        var cbs = _eventBus[eventType];
        if (!cbs) return;
        for (var i = cbs.length - 1; i >= 0; i--) {
            if (cbs[i] === callback) {
                cbs.splice(i, 1);
            }
        }
    }
    
    function _emit(eventType, data) {
        var cbs = _eventBus[eventType];
        if (cbs) {
            for (var i = 0; i < cbs.length; i++) {
                try { cbs[i](data); } catch(e) { console.error('[EventBus] Lỗi handler ' + eventType + ':', e); }
            }
        }
        var parts = eventType.split(':');
        if (parts.length === 2) {
            var wildcard = parts[0] + ':*';
            var wildcardCbs = _eventBus[wildcard];
            if (wildcardCbs) {
                for (var i = 0; i < wildcardCbs.length; i++) {
                    try { wildcardCbs[i]({ type: parts[1], collection: parts[0], data: data }); } catch(e) { console.error('[EventBus] Lỗi wildcard handler ' + wildcard + ':', e); }
                }
            }
        }
    }
    
    var _componentRegistry = {};  // { collection: [ { id, selector, renderFn, lastData } ] }
    var _componentIdCounter = 0;

    function _renderOn(collection, selector, renderFn) {
        if (!_componentRegistry[collection]) {
            _componentRegistry[collection] = [];
        }
        var id = ++_componentIdCounter;
        var entry = {
            id: id,
            selector: typeof selector === 'function' ? selector : null,
            renderFn: renderFn,
            lastData: null
        };
        _componentRegistry[collection].push(entry);
        if (memoryCache[collection]) {
            var data = [];
            for (var key in memoryCache[collection]) {
                if (memoryCache[collection].hasOwnProperty(key)) {
                    data.push(memoryCache[collection][key]);
                }
            }
            entry.lastData = data;
            try { renderFn(data); } catch(e) { console.error('[ComponentRegistry] Lỗi render lần đầu:', e); }
        }
        return function() {
            var entries = _componentRegistry[collection];
            if (!entries) return;
            for (var i = entries.length - 1; i >= 0; i--) {
                if (entries[i].id === id) {
                    entries.splice(i, 1);
                    break;
                }
            }
        };
    }

    // PHASE 2: Tối ưu _notifyComponents - chỉ gửi delta thay vì toàn bộ collection
    function _notifyComponents(collection, changeInfo) {
        var entries = _componentRegistry[collection];
        if (!entries || entries.length === 0) return;
        
        // Nếu có changeInfo với item cụ thể, tạo delta data
        var deltaData = null;
        if (changeInfo && changeInfo.item) {
            deltaData = changeInfo.item;
        }
        
        // Chỉ rebuild toàn bộ array khi cần (selector cần so sánh)
        var fullData = null;
        var needsFullData = false;
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].selector) {
                needsFullData = true;
                break;
            }
        }
        
        if (needsFullData && memoryCache[collection]) {
            fullData = [];
            for (var key in memoryCache[collection]) {
                if (memoryCache[collection].hasOwnProperty(key)) {
                    fullData.push(memoryCache[collection][key]);
                }
            }
        }
        
        for (var i = 0; i < entries.length; i++) {
            var entry = entries[i];
            var shouldRender = true;
            if (entry.selector) {
                try {
                    shouldRender = entry.selector(entry.lastData, fullData, changeInfo);
                } catch(e) {
                    console.error('[ComponentRegistry] Lỗi selector:', e);
                    shouldRender = true;
                }
            }
            if (shouldRender) {
                // PHASE 2: Gửi delta data (item thay đổi) kèm changeInfo
                // Render function có thể dùng changeInfo.type để biết là 'added'/'changed'/'removed'
                entry.lastData = fullData;
                try {
                    entry.renderFn(fullData, {
                        type: changeInfo ? changeInfo.type : null,
                        item: deltaData,
                        collection: collection,
                        timestamp: Date.now()
                    });
                } catch(e) {
                    console.error('[ComponentRegistry] Lỗi render:', e);
                }
            }
        }
    }

    var _suppressRealtime = 0;
    var _pendingNotifyCollections = {};

    function toDateKey(value) {
        if (!value) return '';
        if (typeof value === 'string') {
            if (value.indexOf('T') >= 0 || value.indexOf('Z') >= 0 || value.indexOf('+') >= 0) {
                var parsed = Date.parse(value);
                if (!isNaN(parsed)) {
                    var d = new Date(parsed);
                    var y = d.getFullYear();
                    var m = ('0' + (d.getMonth() + 1)).slice(-2);
                    var day = ('0' + d.getDate()).slice(-2);
                    return y + '-' + m + '-' + day;
                }
            }
            if (value.length >= 10 && value[4] === '-' && value[7] === '-') return value.slice(0, 10);
            var parsed = Date.parse(value);
            if (!isNaN(parsed)) {
                var d = new Date(parsed);
                var y = d.getFullYear();
                var m = ('0' + (d.getMonth() + 1)).slice(-2);
                var day = ('0' + d.getDate()).slice(-2);
                return y + '-' + m + '-' + day;
            }
            return '';
        }
        if (typeof value === 'number') {
            var d = new Date(value);
            var y = d.getFullYear();
            var m = ('0' + (d.getMonth() + 1)).slice(-2);
            var day = ('0' + d.getDate()).slice(-2);
            return y + '-' + m + '-' + day;
        }
        return '';
    }

    function normalizeIndexedFields(collection, data) {
        if (!data || typeof data !== 'object') return data;
        if (collection !== 'transactions') return data;
        var norm = {};
        for (var k in data) if (data.hasOwnProperty(k)) norm[k] = data[k];
        var dateKey = toDateKey(norm.date || norm.createdAt || norm.updatedAt);
        norm.dateKey = dateKey;
        norm.type = norm.type || 'unknown';
        norm.dateTypeKey = dateKey + '|' + norm.type;
        return norm;
    }

    var _lastChangeInfo = {};
    
    // FIX HIỆU NĂNG: gom nhiều thay đổi liên tiếp thành 1 lần thông báo.
    //
    // Trước đây _notifyLocal bắn ngay lập tức. Mỗi child_changed từ thiết bị
    // khác đều đi qua saveToLocal -> _notifyLocal, nên khi thiết bị khác ghi 5
    // khoản nợ liên tiếp, UI render 5 lần trong cùng một khoảnh thời gian.
    // Với collection lớn (transactions, customers) việc dựng lại mảng data và
    // gọi callback mỗi lần còn tốn CPU, gây lag trên máy POS.
    //
    // Nay: gom theo từng collection trong NOTIFY_DEBOUNCE_MS.
    // Thay đổi cục bộ cũng được gom luôn nên hành vi nhất quán.
    //
    // Gom KHÔNG được phép làm mất bản ghi: mỗi changeInfo được xếp vào hàng
    // đợi (_notifyQueues) và khi xả ra thì bắn TỪNG sự kiện một. Trước đây
    // chỉ giữ changeInfo CUỐI CÙNG, nên khi máy khác thêm Bàn 12 rồi xoá
    // Bàn 07 trong cùng 60ms thì máy này chỉ nhận 1 sự kiện mang Bàn 07; Bàn 12
    // không bao giờ nhận 'added' nên thẻ bàn không hề hiện.
    //
    // 60ms thay vì 120ms: giá trị này CỘNG DỒN với debounce của từng module
    // (realtime-pos.js dùng 30-300ms) thành tổng độ trễ khi bấm nút.
    var NOTIFY_DEBOUNCE_MS = 60;
    var _notifyQueues = {};   // collection -> [changeInfo, ...]
    var _notifyTimers = {};
    
    function _doNotifyLocal(collection, changeInfo, allChanges) {
        if (_suppressRealtime > 0) {
            _pendingNotifyCollections[collection] = true;
            return;
        }
        // allChanges: hàng đợi đầy đủ trong cửa sổ gom. Bắn TỪNG sự kiện một để
        // không mất bản ghi nào; phần tốn kém bên dưới chạy 1 lần cho cả loạt.
        var changes = allChanges && allChanges.length ? allChanges : (changeInfo ? [changeInfo] : []);
        // TÊN BIẾN PHẢI KHÁC: khai báo lại chính biến đếm bên trong vòng lặp
        // sẽ làm ci++ cộng vào phần tử (NaN) nên vòng lặp chạy đúng 1 lần rồi dừng.
        for (var k = 0; k < changes.length; k++) {
            var oneChange = changes[k];
            if (oneChange && oneChange.type) {
                _emit(collection + ':' + oneChange.type, {
                    collection: collection,
                    type: oneChange.type,
                    item: oneChange.item || null,
                    timestamp: Date.now()
                });
            }
        }

        _notifyComponents(collection, changeInfo);

        var cbs = _localCallbacks[collection];
        if (!cbs || cbs.length === 0) return;
        var data = [];
        if (memoryCache[collection]) {
            for (var key in memoryCache[collection]) {
                if (memoryCache[collection].hasOwnProperty(key)) {
                    data.push(memoryCache[collection][key]);
                }
            }
        }
        if (changeInfo) {
            _lastChangeInfo[collection] = changeInfo;
        }
        for (var i = 0; i < cbs.length; i++) {
            try { cbs[i](data); } catch(e) { console.error('Local callback error:', e); }
        }
    }
    
    function _notifyLocal(collection, changeInfo) {
        // Gom thay đổi trong NOTIFY_DEBOUNCE_MS rồi bắn MỘT LẦN.
        //
        // QUAN TRỌNG: phải gom THÀNH HÀNG ĐỜI theo từng bản ghi, không giữ
        // đúng một changeInfo. Trước đây dùng `_notifyPending[collection] =
        // changeInfo` nên thay đổi sau ghi đè thay đổi trước. Hậu quả: máy khác
        // thêm Bàn 12 rồi xoá Bàn 07 trong cùng 60ms thì chỉ một sự kiện
        // `tables:*` được bắn, mang theo Bàn 07. Bàn 12 không bao giờ nhận được
        // sự kiện 'added' -> thẻ bàn không hề hiện trên máy kia, và vì thay
        // đổi còn lại là 'removed' nên loại 'added' không thể biểu diễn.
        //
        // Các đường đọc lại toàn bộ collection (DB.subscribe, db_update) vẫn
        // đúng vì đọc cache mới nhất; nhưng realtime-pos.js xử lý bản ghi ĐÍNH
        // DANH từ event.payload, nên mất event = mất cập nhật.
        if (!_notifyQueues[collection]) _notifyQueues[collection] = [];
        _notifyQueues[collection].push(changeInfo);

        // Nếu đang suppress, không cần hẹn giờ: _setSuppressRealtime(false) sẽ
        // bắn lại vào lúc mở khoá (nhanh hơn là chờ 60ms rồi mới bị nuốt).
        if (_suppressRealtime > 0) {
            _pendingNotifyCollections[collection] = true;
            return;
        }
        if (_notifyTimers[collection]) return;
        _notifyTimers[collection] = setTimeout(function() {
            delete _notifyTimers[collection];
            _drainNotifyQueue(collection);
        }, NOTIFY_DEBOUNCE_MS);
    }

    // Bắn tất cả thay đổi đang chờ của một collection.
    // Mỗi thay đổi vẫn là một sự kiện riêng nên bản ghi nào cũng không bị mất;
    // phần tốn kém (đọc lại cache cho DB.subscribe / ComponentRegistry) vẫn
    // chỉ chạy MỘT lần cho cả loạt.
    function _drainNotifyQueue(collection) {
        var queue = _notifyQueues[collection] || [];
        delete _notifyQueues[collection];
        if (queue.length === 0) return;
        // Gom tất cả changeInfo trước để các đường "đọc lại toàn bộ collection"
        // chạy đúng 1 lần, rồi mới bắn từng sự kiện định danh.
        _doNotifyLocal(collection, queue[queue.length - 1], queue);
    }
    
    // Bắn ngay lập tức, bỏ qua timer đang chờ - dùng khi cần dữ liệu
    // chắc chắn đã đầy đủ (ví dụ sau fullSync).
    function _notifyLocalNow(collection, changeInfo) {
        if (_notifyTimers[collection]) {
            clearTimeout(_notifyTimers[collection]);
            delete _notifyTimers[collection];
        }
        // Xả nốt hàng đợi đang chờ của collection này, không bỏ rơi bản ghi
        var queued = _notifyQueues[collection] || [];
        delete _notifyQueues[collection];
        if (changeInfo) queued.push(changeInfo);
        _doNotifyLocal(collection, changeInfo, queued);
    }
    
    var _suppressWatchdogId = null;
    var _SUPPRESS_WATCHDOG_MS = 20000; // 20s

    function _setSuppressRealtime(suppress) {
        if (suppress) {
            _suppressRealtime++;
            // FIX AN TOÀN: nếu code gọi suppressRealtime nhưng quên flushRealtime
            // (thường gặp khi người dùng đóng modal giữa chừng, ví dụ modal chọn khách
            // của chức năng ghi nợ), _suppressRealtime kẹt > 0 vĩnh viễn và mọi event
            // realtime của MỌI collection bị nuốt -> UI đứng hình tới khi F5.
            // Watchdog tự mở khoá sau 20s.
            if (!_suppressWatchdogId) {
                _suppressWatchdogId = setTimeout(function() {
                    _suppressWatchdogId = null;
                    if (_suppressRealtime > 0) {
                        console.warn('[DB] suppressRealtime bị kẹt > ' + _SUPPRESS_WATCHDOG_MS + 'ms - tự mở khoá để realtime không chết');
                        while (_suppressRealtime > 0) {
                            _setSuppressRealtime(false);
                        }
                    }
                }, _SUPPRESS_WATCHDOG_MS);
            }
        } else {
            if (_suppressRealtime <= 1 && _suppressWatchdogId) {
                clearTimeout(_suppressWatchdogId);
                _suppressWatchdogId = null;
            }
            _suppressRealtime--;
            if (_suppressRealtime <= 0) {
                _suppressRealtime = 0;
                var collections = Object.keys(_pendingNotifyCollections);
                _pendingNotifyCollections = {};
                for (var i = 0; i < collections.length; i++) {
                    // Xả hàng đợi đã gom. Trước đây gọi _notifyLocalNow với
                    // _notifyPending[...] nhưng giá trị đó đã bị xoá ở timer
                    // trước đó, nên khi suppress xảy ra đúng trong cửa sổ 60ms
                    // thì changeInfo = undefined và KHÔNG có sự kiện nào được
                    // bắn -> bản ghi vừa thêm/xoá không hiện trên máy này.
                    _drainNotifyQueue(collections[i]);
                }
            }
        }
    }

    // IndexedDB operations
    function saveToLocal(collection, data, changeType) {
        return dbReady.then(function() {
            if (!localDB) throw new Error('DB not ready');
            if (!localDB.objectStoreNames.contains(collection)) throw new Error('Store ' + collection + ' not found');
            if (!memoryCache[collection]) memoryCache[collection] = {};
            var isNew = !memoryCache[collection][data.id];
            var normalized = normalizeIndexedFields(collection, data);
            
            // PHASE 2: Xóa cache query transactions khi có thay đổi
            if (collection === 'transactions' && normalized.dateKey) {
                _invalidateTxDateCache(normalized.dateKey);
                // Xóa luôn manager cache để realtime cập nhật big-value
                if (typeof window._invalidateManagerCache === 'function') {
                    window._invalidateManagerCache();
                }
                // Xóa luôn employee manager cache để realtime cập nhật tổng lương
                if (typeof window._invalidateEmpManagerCache === 'function') {
                    window._invalidateEmpManagerCache();
                }
            }
            
            // PHASE 2: Cập nhật session cache realtime (nếu pos-app.js đã load)
            try {
                if (typeof window._debouncedSaveSessionCache === 'function') {
                    window._debouncedSaveSessionCache();
                }
            } catch(e) {}
            
            // PHASE 2: Chỉ giữ transactions của ngày hiện tại trong memory cache
            if (_isDateBasedCollection(collection) && normalized.dateKey && normalized.dateKey !== _currentDateKey) {
                // Không thêm vào memory cache, chỉ lưu IndexedDB
                cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
                var type = changeType || (isNew ? 'added' : 'changed');
                _notifyLocal(collection, { type: type, item: data, collection: collection });
                return new Promise(function(resolve, reject) {
                    var tx = localDB.transaction([collection], 'readwrite');
                    var store = tx.objectStore(collection);
                    var req = store.put(normalized);
                    req.onsuccess = function() { resolve(data); };
                    req.onerror = function() { reject(req.error); };
                });
            }
            
            memoryCache[collection][data.id] = normalized;
            cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
            
            // PHASE 4: Ghi lại thời điểm cache
            _markCacheTime(collection, data.id);
            
            // PHASE 2: Giới hạn kích thước memory cache
            _enforceMemoryCacheLimit(collection);
            
            var type = changeType || (isNew ? 'added' : 'changed');
            _notifyLocal(collection, { type: type, item: data, collection: collection });
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([collection], 'readwrite');
                var store = tx.objectStore(collection);
                var req = store.put(normalized);
                req.onsuccess = function() { resolve(data); };
                req.onerror = function() { reject(req.error); };
            });
        });
    }

    function loadFromLocal(collection, id) {
        return dbReady.then(function() {
            if (!localDB) return id !== undefined ? null : [];
            if (!localDB.objectStoreNames.contains(collection)) return id !== undefined ? null : [];
            
            if (id !== undefined && id !== null) {
                if (memoryCache[collection] && memoryCache[collection][id] !== undefined) {
                    return memoryCache[collection][id];
                }
            } else {
                if (memoryCache[collection]) {
                    var cachedArr = [];
                    for (var key in memoryCache[collection]) {
                        if (memoryCache[collection].hasOwnProperty(key)) {
                            cachedArr.push(memoryCache[collection][key]);
                        }
                    }
                    if (cachedArr.length > 0) return cachedArr;
                }
            }
            
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([collection], 'readonly');
                var store = tx.objectStore(collection);
                if (id !== undefined && id !== null) {
                    var req = store.get(String(id));
                    req.onsuccess = function() {
                        var result = req.result || null;
                        if (result) {
                            if (!memoryCache[collection]) memoryCache[collection] = {};
                            // PHASE 2: Chỉ cache vào memory nếu là ngày hiện tại
                            if (!_isDateBasedCollection(collection) || !result.dateKey || result.dateKey === _currentDateKey) {
                                memoryCache[collection][result.id] = result;
                                // PHASE 4: Ghi lại thời điểm cache
                                _markCacheTime(collection, result.id);
                            }
                        }
                        resolve(result);
                    };
                    req.onerror = function() { reject(req.error); };
                } else {
                    var req = store.getAll();
                    req.onsuccess = function() {
                        var results = req.result || [];
                        if (!memoryCache[collection]) memoryCache[collection] = {};
                        for (var i = 0; i < results.length; i++) {
                            // PHASE 2: Chỉ cache vào memory nếu là ngày hiện tại
                            if (!_isDateBasedCollection(collection) || !results[i].dateKey || results[i].dateKey === _currentDateKey) {
                                memoryCache[collection][results[i].id] = results[i];
                                // PHASE 4: Ghi lại thời điểm cache
                                _markCacheTime(collection, results[i].id);
                            }
                        }
                        resolve(results);
                    };
                    req.onerror = function() { reject(req.error); };
                }
            });
        });
    }

    function deleteFromLocal(collection, id) {
        return dbReady.then(function() {
            if (!localDB) return;
            if (!localDB.objectStoreNames.contains(collection)) return;
            
            // Lưu dateKey của item trước khi xóa khỏi memory cache (để invalidate cache sau)
            var deletedDateKey = null;
            if (memoryCache[collection] && memoryCache[collection][id]) {
                deletedDateKey = memoryCache[collection][id].dateKey || null;
            }
            
            if (memoryCache[collection]) {
                delete memoryCache[collection][id];
                cacheVersion[collection] = (cacheVersion[collection] || 0) + 1;
            }
            // PHASE 2: Cập nhật session cache khi xóa dữ liệu
            try {
                if (typeof window._debouncedSaveSessionCache === 'function') {
                    window._debouncedSaveSessionCache();
                }
            } catch(e) {}
            
            // FIX: Chuyển _invalidateTxDateCache và _notifyLocal xuống SAU KHI IndexedDB delete hoàn tất
            // để tránh race condition: nếu getTransactionsByDate() được gọi trước khi delete xong,
            // nó sẽ đọc dữ liệu cũ từ IndexedDB và cache lại kết quả cũ
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([collection], 'readwrite');
                var store = tx.objectStore(collection);
                var req = store.delete(String(id));
                req.onsuccess = function() {
                    // Xóa cache query transactions SAU KHI IndexedDB đã xóa xong
                    if (collection === 'transactions' && deletedDateKey) {
                        _invalidateTxDateCache(deletedDateKey);
                        // Xóa luôn manager cache để realtime cập nhật big-value
                        if (typeof window._invalidateManagerCache === 'function') {
                            window._invalidateManagerCache();
                        }
                        // Xóa luôn employee manager cache để realtime cập nhật tổng lương
                        if (typeof window._invalidateEmpManagerCache === 'function') {
                            window._invalidateEmpManagerCache();
                        }
                    }
                    // Gọi _notifyLocal SAU KHI IndexedDB đã xóa xong
                    _notifyLocal(collection, { type: 'removed', item: { id: id }, collection: collection });
                    resolve();
                };
                req.onerror = function() { reject(req.error); };
            });
        });
    }

    // ========== PHASE 4: Priority Queue ==========
    // Priority levels: 0=critical (transactions), 1=high (tables, customers), 2=normal (menu, ingredients), 3=low (settings, logs)
    var COLLECTION_PRIORITY = {
        transactions: 0,
        daily_balances: 0,
        tables: 1,
        customers: 1,
        debt: 1,
        menu: 2,
        menu_categories: 2,
        ingredients: 2,
        inventory_transactions: 2,
        ingredient_transactions: 2,
        info: 3,
        cost_transactions: 3,
        cost_categories: 3,
        employee_attendance: 3,
        employee_salaries: 3,
        notifications: 3,
        sync_queue: 3
    };
    
    function _getPriority(collection) {
        return COLLECTION_PRIORITY[collection] !== undefined ? COLLECTION_PRIORITY[collection] : 3;
    }
    
    // Sync Queue (simplified)
    function addToSyncQueue(action, collection, data, targetId) {
        // Gộp thay đổi cùng một bản ghi, nhưng PHẢI giữ dữ liệu mới nhất.
        //
        // Trước đây: thấy mục cũ đang chờ là return luôn, nên lần sửa thứ hai
        // bị vứt khỏi hàng đợi. Ví dụ khách nợ 100k rồi sửa thành 200k trước
        // lúc đồng bộ -> Firebase chỉ nhận 100k, 100k thứ hai mất vĩnh viễn
        // và không có lỗi nào báo.
        //
        // Nay: thay nội dung của mục cũ bằng dữ liệu mới. Giữ nguyên id, số
        // lần thử và thông tin lỗi để không mất tiến độ retry.
        //
        // CHỈ gộp với mục cùng SHOP. Mục của shop khác giữ nguyên, không đụng.
        var existing = syncQueue.filter(function(q) {
            return q.targetId === targetId && q.action === action &&
                   q.status === 'pending' && _queueBelongsToCurrentShop(q);
        })[0];
        if (existing) {
            existing.data = data;
            existing.timestamp = Date.now();
            existing.dirtyAt = Date.now();
            existing.lastError = null;      // dữ liệu đã đổi, lỗi cũ không còn ý nghĩa
            saveToLocal('sync_queue', existing);
            if (isOnline) processSyncQueue();
            return existing.id;
        }

        var policy = _policyFor(collection);

        // ---- Trường hợp 1: mới tạo mà đã có sửa tiếp -> gộp vào mục 'create'
        //
        // processSyncQueue() chia batch theo collection|action, nên 'create' và
        // 'update' của cùng một bản ghi nằm ở hai batch khác nhau và thứ tự
        // chạy không được bảo đảm. Nếu batch 'update' chạy trước rồi batch
        // 'create' chạy sau, batch create mang dữ liệu CŨ sẽ ghi đè mất thay
        // đổi mới. Gộp vào một mục là xong.
        if (action === 'update') {
            var pendingCreate = syncQueue.filter(function(q) {
                return q.targetId === targetId && q.action === 'create' &&
                       q.status === 'pending' && _queueBelongsToCurrentShop(q);
            })[0];
            if (pendingCreate) {
                pendingCreate.data = data;
                pendingCreate.timestamp = Date.now();
                pendingCreate.dirtyAt = Date.now();
                pendingCreate.lastError = null;
                saveToLocal('sync_queue', pendingCreate);
                if (isOnline) processSyncQueue();
                return pendingCreate.id;
            }
        }

        // ---- Trường hợp 2: bản ghi đang chờ XOÁ mà lại có sửa/thêm mới ----
        //
        // Trước đây tạo ra hai mục cạnh tranh và để thứ tự batch quyết định.
        // Nay quy tắc nằm trong SYNC_POLICY:
        //   'remove-wins'  -> bỏ thay đổi mới, giữ lệnh xoá, ghi nhận xung đột
        //   'newest-wins'  -> bỏ lệnh xoá, giữ thay đổi mới
        var pendingRemove = syncQueue.filter(function(q) {
            return q.targetId === targetId && q.action === 'remove' &&
                   q.status === 'pending' && _queueBelongsToCurrentShop(q);
        })[0];
        if (pendingRemove && action !== 'remove') {
            if (policy.onDeleteConflict === 'remove-wins') {
                _recordSyncConflict(collection, targetId, 'remove', action, data,
                    'Bản ghi đang chờ xoá, thay đổi mới bị bỏ theo quy tắc remove-wins');
                return pendingRemove.id;   // không tạo mục mới
            }
            // newest-wins: bỏ lệnh xoá, cho thay đổi mới đi tiếp
            var idxRm = syncQueue.indexOf(pendingRemove);
            if (idxRm !== -1) syncQueue.splice(idxRm, 1);
            deleteFromLocal('sync_queue', pendingRemove.id);
            _recordSyncConflict(collection, targetId, action, 'remove', null,
                'Có sửa sau khi đã yêu cầu xoá, lệnh xoá bị bỏ theo quy tắc newest-wins');
        }

        // ---- Trường hợp 3: yêu cầu XOÁ mà bản ghi đang chờ tạo/sửa ----
        // Xoá là chặn cuối cùng: bỏ phần tạo/sửa đang chờ rồi mới xoá.
        if (action === 'remove') {
            var pendingOther = syncQueue.filter(function(q) {
                return q.targetId === targetId && q.action !== 'remove' &&
                       q.status === 'pending' && _queueBelongsToCurrentShop(q);
            });
            for (var pi = 0; pi < pendingOther.length; pi++) {
                var po = pendingOther[pi];
                var ix = syncQueue.indexOf(po);
                if (ix !== -1) syncQueue.splice(ix, 1);
                deleteFromLocal('sync_queue', po.id);
                _recordSyncConflict(collection, targetId, 'remove', po.action, po.data,
                    'Bản ghi bị xoá trước khi thay đổi đó kịp gửi lên');
            }
        }

        // ---- Trường hợp 4: dữ liệu chỉ được thêm, không được ghi đè ----
        // Giao dịch đã ghi là đã có. Không ghi đè bản ghi cũ ở máy khác.
        if (policy.onConflict === 'append-only' && action === 'update') {
            _recordSyncConflict(collection, targetId, 'append-only', 'update', data,
                'Dữ liệu loại này chỉ ghi thêm, không sửa bản ghi đã có');
            return null;   // bỏ thay đổi, không đẩy gì lên
        }

        var priority = _getPriority(collection);
        var item = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            action: action,
            collection: collection,
            data: data,
            targetId: targetId,
            deviceId: CURRENT_DEVICE_ID,
            // BẮT BUỘC: mục này thuộc shop nào.
            //
            // clearLocalData() cố ý GIU LẠI sync_queue khi đổi shop, còn
            // syncToFirebase() ghi vào CURRENT_SHOP_ID + '/' + collection. Nếu
            // không gắn shop: đăng nhập shop B trên máy đang có giao dịch chưa
            // gửi của shop A -> các giao dịch đó bị đẩy thẳng vào database
            // của shop B. Đó là lẫn dữ liệu giữa hai cửa hàng.
            shopId: CURRENT_SHOP_ID,
            timestamp: Date.now(),
            retryCount: 0,
            status: 'pending',
            lastError: null,   // Lưu lỗi gần nhất để debug
            dirtyAt: Date.now(), // Thời điểm đánh dấu dirty
            priority: priority  // PHASE 4: Priority level
        };
        syncQueue.push(item);
        saveToLocal('sync_queue', item);
        _markDirty(collection);
        // PHASE 4: Queue size warning
        var pendingCount = syncQueue.filter(function(q) {
            return q.status === 'pending' && _queueBelongsToCurrentShop(q);
        }).length;
        if (pendingCount > 50) {
            console.warn('[SyncQueue] ⚠️ Queue có ' + pendingCount + ' items pending, đang đồng bộ...');
        }
        if (isOnline) processSyncQueue();
        return item.id;
    }
    
    var _dirtyCollections = {};
    function _markDirty(collection) {
        _dirtyCollections[collection] = true;
        try {
            localStorage.setItem('dirty_collections_' + CURRENT_SHOP_ID, JSON.stringify(Object.keys(_dirtyCollections)));
        } catch (e) {}
    }
    function _clearDirty(collection) {
        delete _dirtyCollections[collection];
        try {
            var remaining = Object.keys(_dirtyCollections);
            if (remaining.length > 0) {
                localStorage.setItem('dirty_collections_' + CURRENT_SHOP_ID, JSON.stringify(remaining));
            } else {
                localStorage.removeItem('dirty_collections_' + CURRENT_SHOP_ID);
            }
        } catch (e) {}
    }
    function _restoreDirtyFlags() {
        try {
            var stored = localStorage.getItem('dirty_collections_' + CURRENT_SHOP_ID);
            if (stored) {
                var arr = JSON.parse(stored);
                for (var i = 0; i < arr.length; i++) {
                    _dirtyCollections[arr[i]] = true;
                }
            }
        } catch (e) {}
    }

    // PHASE 4: Sắp xếp pending items theo priority (critical trước)
    function _sortByPriority(items) {
        return items.slice().sort(function(a, b) {
            var pa = a.priority !== undefined ? a.priority : 3;
            var pb = b.priority !== undefined ? b.priority : 3;
            if (pa !== pb) return pa - pb;
            return a.timestamp - b.timestamp;
        });
    }

    function processSyncQueue() {
        if (!isOnline) return Promise.resolve();
        // CHỈ gửi mục thuộc shop đang mở. Mục của shop khác giữ nguyên trong hàng
        // đợi, để quay lại shop đó rồi gửi tiếp. Không có bước lọc này thì
        // đăng nhập shop B sẽ đẩy giao dịch chưa gửi của shop A vào database
        // của shop B.
        var pending = syncQueue.filter(function(q) {
            return q.status === 'pending' && _queueBelongsToCurrentShop(q);
        });
        if (pending.length === 0) return Promise.resolve();
        
        // PHASE 4: Sắp xếp theo priority trước khi batch
        var sorted = _sortByPriority(pending);
        
        var batches = {};
        for (var i = 0; i < sorted.length; i++) {
            var item = sorted[i];
            var key = item.collection + '|' + item.action;
            if (!batches[key]) batches[key] = [];
            batches[key].push(item);
        }
        
        // PHASE 4: Sắp xếp batch keys theo priority thấp nhất trong batch
        var batchKeys = Object.keys(batches).sort(function(a, b) {
            var itemsA = batches[a];
            var itemsB = batches[b];
            var minPA = 3, minPB = 3;
            for (var i = 0; i < itemsA.length; i++) {
                var p = itemsA[i].priority !== undefined ? itemsA[i].priority : 3;
                if (p < minPA) minPA = p;
            }
            for (var i = 0; i < itemsB.length; i++) {
                var p = itemsB[i].priority !== undefined ? itemsB[i].priority : 3;
                if (p < minPB) minPB = p;
            }
            if (minPA !== minPB) return minPA - minPB;
            return itemsA[0].timestamp - itemsB[0].timestamp;
        });
        
        var chain = Promise.resolve();
        
        for (var b = 0; b < batchKeys.length; b++) {
            chain = chain.then((function(batchItems) {
                return function() {
                    if (batchItems.length === 1) {
                        var item = batchItems[0];
                        return syncToFirebase(item).then(function() {
                            return _markItemSynced(item);
                        }).catch(function(err) {
                            return _handleSyncError(item, err);
                        });
                    } else {
                        return _batchSyncToFirebase(batchItems).then(function() {
                            var chain2 = Promise.resolve();
                            for (var j = 0; j < batchItems.length; j++) {
                                chain2 = chain2.then((function(item) {
                                    return function() { return _markItemSynced(item); };
                                })(batchItems[j]));
                            }
                            return chain2;
                        }).catch(function(err) {
                            var chain3 = Promise.resolve();
                            for (var j = 0; j < batchItems.length; j++) {
                                chain3 = chain3.then((function(item) {
                                    return function() {
                                        return syncToFirebase(item).then(function() {
                                            return _markItemSynced(item);
                                        }).catch(function(err2) {
                                            return _handleSyncError(item, err2);
                                        });
                                    };
                                })(batchItems[j]));
                            }
                            return chain3;
                        });
                    }
                };
            })(batches[batchKeys[b]]));
        }
        
        return chain;
    }
    
    function _batchSyncToFirebase(items) {
        if (items.length === 0) return Promise.resolve();
        var collection = items[0].collection;
        var action = items[0].action;
        var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
        var metaRef = _getDb().ref(CURRENT_SHOP_ID + '/_meta/' + collection + '/maxVersion');
        
        if (action === 'delete') {
            var batchData = {};
            for (var i = 0; i < items.length; i++) {
                batchData[items[i].targetId] = null;
            }
            return ref.update(batchData);
        }
        
        return metaRef.transaction(function(currentMax) {
            return (currentMax || 0) + items.length;
        }).then(function(result) {
            var baseVersion = result.snapshot.val() - items.length;
            var batchData = {};
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var syncData = {};
                for (var k in item.data) if (item.data.hasOwnProperty(k)) syncData[k] = item.data[k];
                syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
                syncData._syncedBy = item.deviceId;
                syncData._version = baseVersion + i + 1; // ✅ Mỗi item có _version riêng, tăng dần
                batchData[item.targetId] = syncData;
            }
            return ref.update(batchData);
        }).catch(function(err) {
            console.warn('⚠️ Batch transaction failed, using client versions:', err.message);
            var batchData = {};
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                var syncData = {};
                for (var k in item.data) if (item.data.hasOwnProperty(k)) syncData[k] = item.data[k];
                syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
                syncData._syncedBy = item.deviceId;
                syncData._version = (item.data._version || 1);
                batchData[item.targetId] = syncData;
            }
            return ref.update(batchData);
        });
    }
    
    function _markItemSynced(item) {
        item.status = 'synced';
        return saveToLocal('sync_queue', item).then(function() {
            return deleteFromLocal('sync_queue', item.id);
        }).then(function() {
            var idx = syncQueue.findIndex(function(q) { return q.id === item.id; });
            if (idx !== -1) syncQueue.splice(idx, 1);
            console.log('✅ Synced:', item.action, item.collection, item.targetId);
            var hasPending = syncQueue.some(function(q) {
                return q.collection === item.collection && q.status === 'pending' &&
                       _queueBelongsToCurrentShop(q);
            });
            if (!hasPending) {
                _clearDirty(item.collection);
            }
        });
    }
    
    function _handleSyncError(item, err) {
        item.retryCount = (item.retryCount || 0) + 1;
        item.lastError = err.message || String(err);
        var MAX_RETRY = 5;
        if (item.retryCount < MAX_RETRY) {
            item.status = 'pending';
            return saveToLocal('sync_queue', item).then(function() {
                var delay = Math.min(2000 * Math.pow(2, item.retryCount - 1), 30000); // exponential backoff, max 30s
                console.warn('  ⚠️ Retry', item.retryCount, 'for', item.collection, item.targetId, 'in', delay + 'ms');
                return new Promise(function(r) { setTimeout(r, delay); });
            }).then(function() {
                return processSyncQueue();
            });
        } else {
            item.status = 'failed';
            console.error('❌ Sync failed after ' + MAX_RETRY + ' retries:', item.action, item.collection, item.targetId, 'Error:', item.lastError);
            return saveToLocal('sync_queue', item);
        }
    }

    function syncToFirebase(item) {
        var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + item.collection + '/' + item.targetId);
        var metaRef = _getDb().ref(CURRENT_SHOP_ID + '/_meta/' + item.collection + '/maxVersion');
        
        if (item.action === 'delete') return ref.remove();
        
        return metaRef.transaction(function(currentMax) {
            return (currentMax || 0) + 1;
        }).then(function(result) {
            var serverVersion = result.snapshot.val();
            var syncData = {};
            for (var k in item.data) if (item.data.hasOwnProperty(k)) syncData[k] = item.data[k];
            syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
            syncData._syncedBy = item.deviceId;
            syncData._version = serverVersion; // ✅ Version từ server, không trùng
            return ref.update(syncData);
        }).catch(function(err) {
            console.warn('⚠️ Transaction failed, using client version:', err.message);
            var syncData = {};
            for (var k in item.data) if (item.data.hasOwnProperty(k)) syncData[k] = item.data[k];
            syncData._syncedAt = firebase.database.ServerValue.TIMESTAMP;
            syncData._syncedBy = item.deviceId;
            syncData._version = (item.data._version || 1);
            return ref.update(syncData);
        });
    }

    // CRUD Public
    function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }

    function create(collection, data, customId) {
        // FIX Phase 1: Đã loại bỏ _isDuplicateTransaction - mỗi giao dịch là duy nhất
        var id = customId || data.id || generateId();
        var newData = { id: id };
        for (var k in data) if (data.hasOwnProperty(k) && k !== 'id') newData[k] = data[k];
        newData.createdAt = Date.now();
        newData.createdBy = CURRENT_DEVICE_ID;
        newData.updatedAt = Date.now();
        newData._version = 1;
        return saveToLocal(collection, newData).then(function() {
            addToSyncQueue('create', collection, newData, id);
            if (isOnline) _debouncedProcessSyncQueue();
            return Promise.resolve();
        }).then(function() { return newData; });
    }

    function update(collection, id, data) {
        return loadFromLocal(collection, String(id)).then(function(old) {
            if (!old) throw new Error('Not found');
            var updated = {};
            for (var k in old) if (old.hasOwnProperty(k)) updated[k] = old[k];
            for (var k in data) if (data.hasOwnProperty(k)) updated[k] = data[k];
            updated.updatedAt = Date.now();
            updated.updatedBy = CURRENT_DEVICE_ID;
            updated._version = (old._version || 0) + 1;
            return saveToLocal(collection, updated).then(function() {
                addToSyncQueue('update', collection, updated, String(id));
                if (isOnline) _debouncedProcessSyncQueue();
                return Promise.resolve();
            }).then(function() { return updated; });
        });
    }

    function batchUpdateSortOrder(items, collection) {
        collection = collection || 'menu';
        return dbReady.then(function() {
            if (!localDB) throw new Error('DB not ready');
            var tx = localDB.transaction([collection], 'readwrite');
            var store = tx.objectStore(collection);
            var now = Date.now();
            
            for (var i = 0; i < items.length; i++) {
                var item = items[i];
                if (!memoryCache[collection]) memoryCache[collection] = {};
                if (memoryCache[collection][item.id]) {
                    memoryCache[collection][item.id].sortOrder = item.sortOrder;
                }
                var fullData = memoryCache[collection][item.id];
                if (fullData) {
                    fullData.sortOrder = item.sortOrder;
                    fullData.updatedAt = now;
                    store.put(normalizeIndexedFields(collection, fullData));
                }
            }
            
            return new Promise(function(resolve, reject) {
                tx.oncomplete = function() {
                    if (isOnline && CURRENT_SHOP_ID) {
                        var updates = {};
                        var firebasePath = (collection === 'menu_categories') ? 'menu_categories' : 'menu';
                        for (var i = 0; i < items.length; i++) {
                            var key = CURRENT_SHOP_ID + '/' + firebasePath + '/' + items[i].id + '/sortOrder';
                            updates[key] = items[i].sortOrder;
                        }
                        _getDb().ref().update(updates).catch(function(err) {
                            console.error('Lỗi batch sync sortOrder cho ' + collection + ':', err);
                        });
                    }
                    // fullSync: dữ liệu đã nạp đầy đủ vào IndexedDB + memoryCache,
                    // bắn ngay để UI có dữ liệu ngay thay vì chờ debounce.
                    _notifyLocalNow(collection);
                    resolve();
                };
                tx.onerror = function() { reject(tx.error); };
            });
        });
    }

    function remove(collection, id) {
        return deleteFromLocal(collection, String(id)).then(function() {
            addToSyncQueue('delete', collection, { id: id }, String(id));
            if (isOnline) _debouncedProcessSyncQueue();
            return Promise.resolve();
        }).then(function() { return true; });
    }

    function get(collection, id) {
        if (id !== undefined) return loadFromLocal(collection, String(id));
        return loadFromLocal(collection);
    }

    function getAll(collection) {
        return loadFromLocal(collection).then(function(data) { return data || []; });
    }

    function _fixDateKeyIfNeeded(tx) {
        if (!tx || !tx.id) return tx;
        var correctKey = toDateKey(tx.createdAt || tx.date || tx.updatedAt);
        if (correctKey && tx.dateKey !== correctKey) {
            
            tx.dateKey = correctKey;
            tx.dateTypeKey = correctKey + '|' + (tx.type || 'unknown');
            if (memoryCache.transactions) {
                memoryCache.transactions[tx.id] = tx;
            }
            if (localDB) {
                try {
                    var writeTx = localDB.transaction(['transactions'], 'readwrite');
                    var store = writeTx.objectStore('transactions');
                    store.put(tx);
                } catch(e) {
                    console.warn('Không thể ghi fix dateKey vào IndexedDB:', e.message);
                }
            }
        }
        return tx;
    }

    var _fetchingTxDateKeys = {};
    
    // PHASE 2: Cache kết quả query transactions
    // PHASE 4: Thêm TTL cho _txDateCache - tự động invalidate sau 10 phút
    // P4: Tăng từ 2 phút lên 10 phút để giảm số lần query IndexedDB + auto-fetch Firebase
    var _txDateCache = {}; // { '2024-01-15|all': [transactions] }
    var _txDateCacheTimestamps = {}; // { '2024-01-15|all': timestamp }
    var _TX_DATE_CACHE_TTL = 10 * 60 * 1000; // 10 phút
    
    // Khi có transaction mới, xóa cache liên quan
    function _invalidateTxDateCache(dateKey) {
        if (!dateKey) {
            _txDateCache = {};
            _txDateCacheTimestamps = {};
            return;
        }
        for (var key in _txDateCache) {
            if (_txDateCache.hasOwnProperty(key) && key.indexOf(dateKey) === 0) {
                delete _txDateCache[key];
                delete _txDateCacheTimestamps[key];
            }
        }
    }

    function getTransactionsByDate(dateKey, options) {
        options = options || {};
        var type = options.type || 'all';
        
        // PHASE 2: Kiểm tra cache trước
        // PHASE 4: Kiểm tra TTL cache
        var cacheKey = dateKey + '|' + type;
        if (_txDateCache[cacheKey] && !options.forceRefresh) {
            var cacheTime = _txDateCacheTimestamps[cacheKey] || 0;
            if ((Date.now() - cacheTime) < _TX_DATE_CACHE_TTL) {
                return Promise.resolve(_txDateCache[cacheKey]);
            }
            // Cache quá hạn, xóa để fetch lại
            delete _txDateCache[cacheKey];
            delete _txDateCacheTimestamps[cacheKey];
        }
        
        var txFetchKey = dateKey + '|' + type;
        if (_fetchingTxDateKeys[txFetchKey]) {
            return _fetchingTxDateKeys[txFetchKey];
        }
        
        var promise = dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains('transactions')) return [];
            
            // PHASE 3: Tối ưu - dùng IndexedDB index trực tiếp thay vì iterate memory cache
            // IndexedDB index 'dateKey' hoặc 'dateTypeKey' chỉ query đúng ngày cần
            var localPromise = new Promise(function(resolve, reject) {
                var tx = localDB.transaction(['transactions'], 'readonly');
                var store = tx.objectStore('transactions');
                var req;
                if (type !== 'all' && store.indexNames.contains('dateTypeKey')) {
                    req = store.index('dateTypeKey').getAll(dateKey + '|' + type);
                } else if (store.indexNames.contains('dateKey')) {
                    req = store.index('dateKey').getAll(dateKey);
                } else {
                    req = store.getAll();
                }
                req.onsuccess = function() {
                    var rows = req.result || [];
                    if (!store.indexNames.contains('dateKey')) {
                        rows = rows.filter(function(r) { return toDateKey(r.date) === dateKey; });
                        if (type !== 'all') rows = rows.filter(function(r) { return r.type === type; });
                    }
                    for (var i = 0; i < rows.length; i++) {
                        _fixDateKeyIfNeeded(rows[i]);
                    }
                    if (!memoryCache.transactions) memoryCache.transactions = {};
                    for (var i = 0; i < rows.length; i++) {
                        // PHASE 2: Chỉ cache vào memory nếu là ngày hiện tại
                        if (rows[i].dateKey === _currentDateKey) {
                            memoryCache.transactions[rows[i].id] = rows[i];
                        }
                    }
                    resolve(rows);
                };
                req.onerror = function() { reject(req.error); };
            });
            
            return localPromise.then(function(localData) {
                // PHASE 2: Lưu vào cache
                // PHASE 4: Ghi timestamp cho TTL
                if (localData && localData.length > 0) {
                    _txDateCache[cacheKey] = localData;
                    _txDateCacheTimestamps[cacheKey] = Date.now();
                    return localData;
                }
                
                if (!isOnline) return [];
                
                if (_isEmployeeMode()) {
                    var todayKey = toDateKey(Date.now());
                    var yesterdayMs = Date.now() - 86400000;
                    var yesterdayKey = toDateKey(yesterdayMs);
                    if (dateKey !== todayKey && dateKey !== yesterdayKey) {
                        console.log('📡 Employee mode - skip auto-fetch for date:', dateKey);
                        return [];
                    }
                }
                
                // console.log('📡 Auto-fetching transactions for date:', dateKey);
                return syncCollectionByDate('transactions', dateKey).then(function(fetched) {
                    if (type !== 'all' && fetched) {
                        fetched = fetched.filter(function(t) { return t.type === type; });
                    }
                    // PHASE 2: Lưu vào cache
                    // PHASE 4: Ghi timestamp cho TTL
                    if (fetched && fetched.length > 0) {
                        _txDateCache[cacheKey] = fetched;
                        _txDateCacheTimestamps[cacheKey] = Date.now();
                    }
                    return fetched || [];
                });
            });
        });
        
        _fetchingTxDateKeys[txFetchKey] = promise;
        return promise.then(function(result) {
            delete _fetchingTxDateKeys[txFetchKey];
            return result;
        }).catch(function(err) {
            delete _fetchingTxDateKeys[txFetchKey];
            throw err;
        });
    }

    var _fetchingRange = null;
    
    function getTransactionsByDateRange(startDateKey, endDateKey, options) {
        options = options || {};
        var type = options.type || 'all';
        var noAutoFetch = options.noAutoFetch === true;
        
        if (_fetchingRange) {
            return _fetchingRange.then(function() {
                return _doGetTransactionsByDateRange(startDateKey, endDateKey, type, noAutoFetch);
            });
        }
        
        var promise = _doGetTransactionsByDateRange(startDateKey, endDateKey, type, noAutoFetch);
        _fetchingRange = promise;
        return promise.then(function(result) {
            _fetchingRange = null;
            return result;
        }).catch(function(err) {
            _fetchingRange = null;
            throw err;
        });
    }
    
    function _doGetTransactionsByDateRange(startDateKey, endDateKey, type, noAutoFetch) {
        return dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains('transactions')) return [];
            
            // OPTIMIZE: Kiểm tra _txDateCache trước - nếu tất cả các ngày trong range đã có cache thì dùng luôn
            var allDateKeys = getDateKeysBetween(startDateKey, endDateKey);
            var cachedResults = [];
            var allCached = true;
            var typeSuffix = '|' + type;
            
            for (var d = 0; d < allDateKeys.length; d++) {
                var cacheKey = allDateKeys[d] + typeSuffix;
                if (_txDateCache[cacheKey]) {
                    var cacheTime = _txDateCacheTimestamps[cacheKey] || 0;
                    if ((Date.now() - cacheTime) < _TX_DATE_CACHE_TTL) {
                        // Cache còn hạn, gộp vào kết quả
                        for (var t = 0; t < _txDateCache[cacheKey].length; t++) {
                            cachedResults.push(_txDateCache[cacheKey][t]);
                        }
                        continue;
                    }
                }
                // Thử cache với type='all' nếu type cụ thể không có
                var cacheKeyAll = allDateKeys[d] + '|all';
                if (_txDateCache[cacheKeyAll]) {
                    var cacheTimeAll = _txDateCacheTimestamps[cacheKeyAll] || 0;
                    if ((Date.now() - cacheTimeAll) < _TX_DATE_CACHE_TTL) {
                        // Cache 'all' còn hạn, filter theo type
                        for (var t = 0; t < _txDateCache[cacheKeyAll].length; t++) {
                            var item = _txDateCache[cacheKeyAll][t];
                            if (type === 'all' || item.type === type) {
                                cachedResults.push(item);
                            }
                        }
                        continue;
                    }
                }
                allCached = false;
                break;
            }
            
            if (allCached && cachedResults.length > 0) {
                // Cập nhật memory cache
                if (!memoryCache.transactions) memoryCache.transactions = {};
                for (var i = 0; i < cachedResults.length; i++) {
                    memoryCache.transactions[cachedResults[i].id] = cachedResults[i];
                }
                return cachedResults;
            }
            
            // OPTIMIZE: Dùng IDBKeyRange.bound() để chỉ query transactions trong range cần
            // thay vì getAll() rồi filter trong JS - giảm lượng dữ liệu truyền từ IndexedDB
            localPromise = new Promise(function(resolve, reject) {
                var tx = localDB.transaction(['transactions'], 'readonly');
                var store = tx.objectStore('transactions');
                var req;
                if (store.indexNames.contains('dateKey')) {
                    // Chỉ lấy transactions trong date range, không lấy tất cả
                    var range = IDBKeyRange.bound(startDateKey, endDateKey, false, false);
                    req = store.index('dateKey').getAll(range);
                } else {
                    req = store.getAll();
                }
                req.onsuccess = function() {
                    var rows = req.result || [];
                    for (var i = 0; i < rows.length; i++) {
                        _fixDateKeyIfNeeded(rows[i]);
                    }
                    // rows đã được IndexedDB filter theo dateKey range, chỉ cần filter type nếu cần
                    if (type !== 'all') {
                        rows = rows.filter(function(r) { return r.type === type; });
                    }
                    // Cập nhật memory cache với dữ liệu từ IndexedDB
                    if (!memoryCache.transactions) memoryCache.transactions = {};
                    for (var i = 0; i < rows.length; i++) {
                        memoryCache.transactions[rows[i].id] = rows[i];
                    }
                    resolve(rows);
                };
                req.onerror = function() { reject(req.error); };
            });
            
            return localPromise.then(function(localData) {
                // Bước 1: Xác định những ngày đã có dữ liệu từ local (memory cache + IndexedDB)
                var localDateKeys = {};
                for (var i = 0; i < localData.length; i++) {
                    if (localData[i].dateKey) {
                        localDateKeys[localData[i].dateKey] = true;
                    }
                }
                
                // Bước 2: Xác định tất cả các ngày trong range (đã tính ở trên)
                
                // Bước 3: Tìm những ngày còn thiếu (chưa có trong local)
                var missingDateKeys = [];
                for (var i = 0; i < allDateKeys.length; i++) {
                    if (!localDateKeys[allDateKeys[i]]) {
                        missingDateKeys.push(allDateKeys[i]);
                    }
                }
                
                // Bước 4: Nếu đã có đủ dữ liệu hoặc offline thì trả về localData
                if (missingDateKeys.length === 0 || !isOnline) {
                    return localData;
                }
                
                if (noAutoFetch) {
                    console.log('📡 Auto-fetch skipped (noAutoFetch=true), missing:', missingDateKeys.length, 'days');
                    return localData;
                }
                
                // Bước 5: Giới hạn số ngày auto-fetch theo retention days
                var MAX_AUTO_FETCH_DAYS = _getRetentionDays();
                var dateKeysToFetch = missingDateKeys;
                if (missingDateKeys.length > MAX_AUTO_FETCH_DAYS) {
                    // Chỉ fetch MAX_AUTO_FETCH_DAYS ngày gần nhất
                    dateKeysToFetch = missingDateKeys.slice(missingDateKeys.length - MAX_AUTO_FETCH_DAYS);
                    console.log('📡 Auto-fetch limited to', MAX_AUTO_FETCH_DAYS, 'days (range has', missingDateKeys.length, 'missing days)');
                }
                
                if (dateKeysToFetch.length > 0) {
                    console.log('📡 Auto-fetching missing dates:', dateKeysToFetch.length, 'days');
                }
                
                // Bước 6: Fetch từng ngày còn thiếu từ Firebase
                var chain = Promise.resolve();
                for (var i = 0; i < dateKeysToFetch.length; i++) {
                    chain = chain.then((function(dateKey) {
                        return function() {
                            return syncCollectionByDate('transactions', dateKey);
                        };
                    })(dateKeysToFetch[i]));
                }
                
                // Bước 7: Load lại toàn bộ dữ liệu từ local sau khi fetch
                return chain.then(function() {
                    return loadFromLocal('transactions').then(function(allData) {
                        var result = [];
                        for (var i = 0; i < allData.length; i++) {
                            var dk = allData[i].dateKey;
                            if (dk >= startDateKey && dk <= endDateKey) {
                                if (type === 'all' || allData[i].type === type) {
                                    result.push(allData[i]);
                                }
                            }
                        }
                        return result;
                    });
                });
            });
        });
    }

    // ========== PHASE 4: Lazy Firebase Listeners ==========
    var _activeListeners = {}; // { collection: { ref, handlers, refCount } }
    var _listenerQueue = []; // Queue các collection chờ active
    
    // Active listener cho 1 collection (chỉ khi có component cần)
    function _ensureListener(collection, callback, options) {
        if (_activeListeners[collection]) {
            _activeListeners[collection].refCount++;
            if (callback) {
                if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
                _localCallbacks[collection].push(callback);
            }
            return _activeListeners[collection].unsubFn;
        }
        
        // Thêm callback trước
        if (callback) {
            if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
            _localCallbacks[collection].push(callback);
        }
        
        var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
        if (options && options.orderByChild) {
            var queryRef = ref.orderByChild(options.orderByChild);
            if (options.limitToLast) {
                queryRef = queryRef.limitToLast(options.limitToLast);
            }
            ref = queryRef;
        } else if (options && options.limitToLast) {
            ref = ref.limitToLast(options.limitToLast);
        }
        
        var handlers = {};
        var unsubFn = function() {};
        
        if (collection === 'info') {
            var updateScheduledInfo = false;
            var emitUpdateInfo = function() {
                if (updateScheduledInfo) return;
                updateScheduledInfo = true;
                setTimeout(function() {
                    updateScheduledInfo = false;
                    loadFromLocal(collection).then(function(localData) {
                        var cbs = _localCallbacks[collection];
                        if (cbs) { for (var ci = 0; ci < cbs.length; ci++) { try { cbs[ci](localData); } catch(e) {} } }
                        var evt = document.createEvent('CustomEvent');
                        evt.initCustomEvent('db_update', true, true, { detail: { collection: collection, data: localData } });
                        window.dispatchEvent(evt);
                    });
                }, 200);
            };
            handlers.onValue = function(snapshot) {
                if (!snapshot.exists()) return;
                var src = snapshot.val() || {};
                var item = { id: 'shop_config' };
                for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                saveToLocal(collection, item).then(emitUpdateInfo);
            };
            ref.on('value', handlers.onValue);
            unsubFn = function() {
                ref.off('value', handlers.onValue);
            };
        } else {
            // GHI CHÚ QUAN TRỌNG về Event Bus:
            // saveToLocal() ĐÃ tự gọi _notifyLocal ngay khi cập nhật memoryCache,
            // và handlers.onChanged gọi saveToLocal(). Vì vậy thay đổi từ THIẾT BỊ
            // KHÁC vẫn đi qua Event Bus một cách bình thường. emitUpdate() KHÔNG
            // được gọi _notifyLocal - làm vậy sẽ bắn event 2 lần cho 1 thay đổi
            // (1 lần từ saveToLocal, 1 lần từ đây) và render đúp.
            //
            // emitUpdate chỉ lo việc: đọc IndexedDB rồi bắn db_update cho các
            // module đang nghe sự kiện này (expense.js, manager.js, settings.js,
            // settings-fund.js...).
            //
            // FIX chống chồng: updateScheduled trước đây được set false TRƯỚC khi
            // loadFromLocal resolve, nên thay đổi đến giữa chừng sẽ khởi động
            // thêm một vòng loadFromLocal nữa -> 2 promise chạy song song,
            // db_update bắn 2 lần. Nay giữ cờ updateRunning trong suốt thời gian
            // đọc, thay đổi đến giữa chừng được gom lại chạy đúng 1 vòng nữa.
            var updateScheduled = false;   // đã có setTimeout đang chờ
            var updateRunning = false;     // đang loadFromLocal
            var updateQueued = false;      // có thay đổi mới đến khi đang chạy
            var EMIT_DEBOUNCE_MS = 150;
            
            function _flushUpdate() {
                if (updateRunning) { updateQueued = true; return; }
                updateRunning = true;
                updateScheduled = false;
                loadFromLocal(collection).then(function(localData) {
                    var evt = document.createEvent('CustomEvent');
                    evt.initCustomEvent('db_update', true, true, { detail: { collection: collection, data: localData } });
                    window.dispatchEvent(evt);
                }).catch(function (e) {
                    console.error('[DB] Lỗi đọc local ' + collection + ':', e);
                }).then(function () {
                    updateRunning = false;
                    if (updateQueued) {
                        updateQueued = false;
                        emitUpdate();
                    }
                });
            }
            
            var emitUpdate = function() {
                if (updateRunning) { updateQueued = true; return; }
                if (updateScheduled) return;
                updateScheduled = true;
                setTimeout(_flushUpdate, EMIT_DEBOUNCE_MS);
            };
            // FIX ĐỒNG BỘ BÀN: bàn là collection DUY NHẤT cố tình bỏ qua so sánh
            // _version, vì _version là bộ đếm độc lập theo từng thiết bị nên không
            // so sánh được giữa 2 máy (máy A đang _version=5, máy B mới ghi _version=3
            // -> dữ liệu hợp lệ của B sẽ bị loài). Nhưng bỏ hẳn kiểm tra thì dữ liệu
            // CŨ từ máy khác có thể ghi đè bản local MỚI HƠN (mạng lag, IndexedDB
            // đọc thiếu) -> mất món vừa thêm. So sánh updatedAt giải quyết cả hai.
            var _acceptRemote = function(key, item) {
                if (collection !== 'tables') return true;
                var localItem = memoryCache[collection] ? memoryCache[collection][key] : null;
                if (!localItem) return true;
                return (item.updatedAt || 0) >= (localItem.updatedAt || 0);
            };
            handlers.onAdded = function(snapshot) {
                if (!snapshot.exists()) return;
                var key = snapshot.key;
                
                // Ghi nhớ key này đã CÓ trên server.
                // Khi listener mới gắn, Firebase bắn child_added cho MỌI bản ghi
                // hiện có -> ta biết chính xác danh sách key trên server mà KHÔNG
                // tốn thêm request nào. reconcileFromSeenKeys() dùng tập key này
                // để dọn bản ghi local đã bị xoá ở máy khác, thay vì phải tải
                // toàn bộ collection về chỉ để so sánh key.
                _markRemoteKeySeen(collection, key);
                
                // PHASE 5: Dedup check - tránh xử lý items đã được xử lý gần đây
                if (_isRecentlyProcessed(collection, key)) return;
                
                var src = snapshot.val() || {};
                var item = { id: key };
                for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                
                // Xem giải thích ở handlers.onChanged: _version là bộ đếm riêng theo từng
                // máy, so sánh nó giữa 2 thiết bị sẽ loại vĩnh viễn thay đổi hợp
                // lệ của máy khác. Chỉ so _syncedAt (mốc thời gian server) và bỏ
                // qua bản do chính máy này gửi.
                var localItemAdd = memoryCache[collection] ? memoryCache[collection][key] : null;
                if (localItemAdd) {
                    if (item._syncedBy && item._syncedBy === CURRENT_DEVICE_ID) return;
                    if (localItemAdd._syncedAt && item._syncedAt &&
                        localItemAdd._syncedAt === item._syncedAt) return;
                }
                
                if (collection === 'transactions' && memoryCache.transactions && memoryCache.transactions[key]) {
                    var localTx = memoryCache.transactions[key];
                    if (localTx._version >= 1 && !localTx._syncedAt) return;
                }
                
                _markProcessed(collection, key);
                saveToLocal(collection, item).then(emitUpdate);
            };
            handlers.onChanged = function(snapshot) {
                if (!snapshot.exists()) return;
                var key = snapshot.key;
                
                // PHASE 5: Dedup check
                if (_isRecentlyProcessed(collection, key)) return;
                
                var src = snapshot.val() || {};
                var item = { id: key };
                for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                
                // _version KHÔNG dùng để so sánh giữa 2 máy.
                //
                // _version là bộ đếm riêng theo từng bản ghi và tăng trên máy
                // đang sửa (update() ghi (old._version||0)+1). Hai máy sửa
                // cùng một khách: máy A lên _version=5, máy B mới ghi
                // _version=3. So sánh _version sẽ loại vĩnh viễn mọi thay đổi
                // hợp lệ của máy B trên máy A, và ngược lại - dữ liệu biến mất
                // khỏi một máy cho tới lần fullSync/đổi shop sau này.
                //
                // Cách đúng với kiến trúc last-write-wins: so sánh MỐC THỜI GIAN
                // ghi trên server (_syncedAt là ServerValue.TIMESTAMP của
                // Firebase, nên giống nhau trên mọi máy), chỉ bỏ qua khi bản
                // đến từ chính máy này (nó đã được ghi vào local rồi).
                var localItem2 = memoryCache[collection] ? memoryCache[collection][key] : null;
                if (localItem2) {
                    // Bản do chính máy này gửi lên -> không cần áp lại.
                    if (item._syncedBy && item._syncedBy === CURRENT_DEVICE_ID) return;
                    // Cùng nội dung -> bỏ qua cho khỏi vẽ lại.
                    if (localItem2._syncedAt && item._syncedAt &&
                        localItem2._syncedAt === item._syncedAt) return;
                }
                
                _markProcessed(collection, key);
                saveToLocal(collection, item).then(emitUpdate);
            };
            handlers.onRemoved = function(snapshot) {
                var key = snapshot.key;
                deleteFromLocal(collection, key).then(emitUpdate);
            };
            ref.on('child_added', handlers.onAdded);
            ref.on('child_changed', handlers.onChanged);
            ref.on('child_removed', handlers.onRemoved);
            unsubFn = function() {
                ref.off('child_added', handlers.onAdded);
                ref.off('child_changed', handlers.onChanged);
                ref.off('child_removed', handlers.onRemoved);
            };
        }
        
        if (!listeners[collection]) listeners[collection] = [];
        listeners[collection].push(handlers);
        
        _activeListeners[collection] = {
            ref: ref,
            handlers: handlers,
            refCount: 1,
            unsubFn: unsubFn
        };
        
        if (!_unsubscribeFns[collection]) _unsubscribeFns[collection] = [];
        _unsubscribeFns[collection].push(unsubFn);
        
        console.log('[Listener] ✅ Active listener cho ' + collection);
        return unsubFn;
    }
    
    // Giảm refCount, tự động unsubscribe khi không còn ai dùng
    function _releaseListener(collection) {
        if (!_activeListeners[collection]) return;
        _activeListeners[collection].refCount--;
        if (_activeListeners[collection].refCount <= 0) {
            _activeListeners[collection].unsubFn();
            delete _activeListeners[collection];
            console.log('[Listener] 🗑️ Đã hủy listener cho ' + collection);
        }
    }

   function subscribeToCollection(collection, callback, options) {
    // PHASE 4: Dùng lazy listener thay vì active ngay
    return _ensureListener(collection, callback, options);
}

    var _pollingTimers = {};
    function subscribeWithPolling(collection, callback, intervalSeconds) {
        intervalSeconds = intervalSeconds || 60; // Mặc định 60 giây
        if (callback) {
            if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
            _localCallbacks[collection].push(callback);
        }
        
        if (_pollingTimers[collection]) {
            if (callback) {
                if (memoryCache[collection]) {
                    var data = [];
                    for (var key in memoryCache[collection]) {
                        if (memoryCache[collection].hasOwnProperty(key)) {
                            data.push(memoryCache[collection][key]);
                        }
                    }
                    if (data.length > 0) {
                        try { callback(data); } catch(e) { console.error('Polling callback error:', e); }
                    } else {
                        console.log('⏳ Polling ' + collection + ': memoryCache empty, registering callback for later');
                        if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
                        _localCallbacks[collection].push(callback);
                    }
                } else {
                    console.log('⏳ Polling ' + collection + ': memoryCache not ready, registering callback for later');
                    if (!_localCallbacks[collection]) _localCallbacks[collection] = [];
                    _localCallbacks[collection].push(callback);
                }
            }
            return function() {
                clearInterval(_pollingTimers[collection]);
                delete _pollingTimers[collection];
            };
        }
        
        var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
        
        getSyncMeta(collection).then(function(meta) {
            if (meta && meta.maxVersion > 0) {
                deltaSync(collection);
            } else {
                ref.once('value', function(snapshot) {
                    if (!snapshot.exists()) return;
                    var remote = snapshot.val() || {};
                    var count = 0;
                    var maxVersion = 0;
                    for (var key in remote) {
                        if (remote.hasOwnProperty(key)) {
                            var src = remote[key];
                            var item = { id: key };
                            for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                            if (item._version === undefined) item._version = 1;
                            if (item._version > maxVersion) maxVersion = item._version;
                            saveToLocal(collection, item, 'added');
                            count++;
                        }
                    }
                    saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: maxVersion, dateKeys: [] });
                    console.log('📥 Polling loaded ' + collection + ': ' + count + ' items');
                });
            }
        });
        
        _pollingTimers[collection] = setInterval(function() {
            if (!isOnline) return;
            
            getSyncMeta(collection).then(function(meta) {
                var localMaxVersion = (meta && meta.maxVersion) || 0;
                var queryRef = ref.orderByChild('_version').startAt(localMaxVersion + 1);
                
                queryRef.once('value', function(snapshot) {
                    if (!snapshot.exists()) return;
                    var remote = snapshot.val() || {};
                    var count = 0;
                    var newMaxVersion = localMaxVersion;
                    
                    for (var key in remote) {
                        if (remote.hasOwnProperty(key)) {
                            var src = remote[key];
                            var item = { id: key };
                            for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                            if (item._version === undefined) item._version = 1;
                            if (item._version > newMaxVersion) newMaxVersion = item._version;
                            
                            var localItem = memoryCache[collection] ? memoryCache[collection][key] : null;
                            saveToLocal(collection, item, localItem ? 'changed' : 'added');
                            count++;
                        }
                    }
                    
                    if (count > 0) {
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: newMaxVersion, dateKeys: (meta && meta.dateKeys) || [] });
                        console.log('📥 Polling delta ' + collection + ': ' + count + ' new items');
                    }
                });
            });
            
            // P5: _cleanupDeletedIds đã được xóa - child_removed listener xử lý việc xóa realtime
            // vì nó đã được gọi trong fullSync/deltaSync và có cache riêng
        }, intervalSeconds * 1000);
        
        return function() {
            clearInterval(_pollingTimers[collection]);
            delete _pollingTimers[collection];
        };
    }
    
    function _cleanupOldData() {
        if (!localDB) return;
        var retentionDays = _getRetentionDays();
        var cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        var cutoffDateKey = toDateKey(cutoffTime);
        var todayKey = toDateKey(Date.now());
        
        console.log('[Retention] Giữ ' + retentionDays + ' ngày (từ ' + cutoffDateKey + ' đến ' + todayKey + ')');
        
        // 1. Xóa memory cache items quá hạn
        var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
        for (var c = 0; c < dateKeys.length; c++) {
            var col = dateKeys[c];
            if (!memoryCache[col]) continue;
            var memKeys = Object.keys(memoryCache[col]);
            var memDeleted = 0;
            for (var i = 0; i < memKeys.length; i++) {
                var item = memoryCache[col][memKeys[i]];
                if (item) {
                    var dk = item.dateKey || (item.date ? toDateKey(item.date) : null);
                    if (dk && dk < cutoffDateKey) {
                        delete memoryCache[col][memKeys[i]];
                        // Dọn cache timestamp tương ứng
                        if (_cacheTimestamps[col]) {
                            delete _cacheTimestamps[col][memKeys[i]];
                        }
                        memDeleted++;
                    }
                }
            }
            if (memDeleted > 0) {
                console.log('[Retention] Đã xóa ' + memDeleted + ' items cũ khỏi memory cache ' + col);
            }
        }
        
        // 2. Xóa IndexedDB items quá hạn và cập nhật syncMeta.dateKeys
        for (var c = 0; c < dateKeys.length; c++) {
            var collection = dateKeys[c];
            if (!localDB.objectStoreNames.contains(collection)) continue;
            
            (function(col) {
                var tx = localDB.transaction([col], 'readwrite');
                var store = tx.objectStore(col);
                var req = store.getAll();
                req.onsuccess = function() {
                    var items = req.result || [];
                    var deleted = 0;
                    var remainingDateKeys = {};
                    for (var i = 0; i < items.length; i++) {
                        var dk = items[i].dateKey || (items[i].date ? toDateKey(items[i].date) : null);
                        if (dk && dk < cutoffDateKey) {
                            store.delete(items[i].id);
                            deleted++;
                        } else if (dk) {
                            // Ghi nhận các dateKeys còn lại (không bị xóa)
                            remainingDateKeys[dk] = true;
                        }
                    }
                    if (deleted > 0) {
                        console.log('[Retention] 🧹 Đã xóa ' + deleted + ' items cũ khỏi IndexedDB ' + col);
                        // Cập nhật syncMeta.dateKeys: chỉ giữ các dateKeys còn items
                        getSyncMeta(col).then(function(meta) {
                            var oldDateKeys = (meta && meta.dateKeys) || [];
                            var newDateKeys = [];
                            for (var i = 0; i < oldDateKeys.length; i++) {
                                if (remainingDateKeys[oldDateKeys[i]] || oldDateKeys[i] >= cutoffDateKey) {
                                    newDateKeys.push(oldDateKeys[i]);
                                }
                            }
                            if (newDateKeys.length !== oldDateKeys.length) {
                                saveSyncMeta(col, {
                                    lastSyncAt: (meta && meta.lastSyncAt) || Date.now(),
                                    maxVersion: (meta && meta.maxVersion) || 0,
                                    dateKeys: newDateKeys
                                });
                                console.log('[Retention] 📋 Đã cập nhật syncMeta.dateKeys cho ' + col + ': ' + oldDateKeys.length + ' → ' + newDateKeys.length + ' dateKeys');
                            }
                        });
                    }
                };
            })(collection);
        }
    }
    
    // DATA RETENTION: Cleanup dữ liệu cũ định kỳ (mỗi 6 tiếng)
    var _dataCleanupIntervalId = null;
    function _startPeriodicDataCleanup() {
        if (_dataCleanupIntervalId) return;
        // Chạy lần đầu sau 5 phút (tránh xung đột với lúc init)
        setTimeout(function() {
            _cleanupOldData();
        }, 5 * 60 * 1000);
        // Sau đó chạy mỗi 6 tiếng
        _dataCleanupIntervalId = setInterval(_cleanupOldData, 6 * 60 * 60 * 1000);
        console.log('[Retention] Đã khởi động periodic data cleanup (6 tiếng/lần, giữ ' + _getRetentionDays() + ' ngày)');
    }
    
    var _quickSyncTimer = null;
    function _quickSync() {
        if (_quickSyncTimer) clearTimeout(_quickSyncTimer);
        _quickSyncTimer = setTimeout(function() {
            _quickSyncTimer = null;
            if (!isOnline) return;
            console.log('📡 Quick sync on resume...');
            
            // Đẩy hết thay đổi cục bộ lên server TRƯỚC khi đọc dữ liệu mới về,
            // tránh hai chiều ghi đè lẫn nhau khi mở app trên nhiều máy.
            processSyncQueue().then(function() {
                // Dọn bản ghi local đã bị xoá ở máy khác.
                // Dùng key ĐÃ THẤY từ listener -> không tải lại collection,
                // không cần index updatedAt.
                return reconcileFromSeenKeys('tables');
            }).then(function() {
                _cleanupOldData();
            })['catch'](function(err) {
                console.warn('⚠️ Quick sync lỗi:', err && err.message);
            });
        }, 500);
    }
    
    // Network listener
    function initNetwork() {
        window.addEventListener('online', function() {
            isOnline = true;
            showToast('📡 Đã kết nối mạng', 'success');
            processSyncQueue();
            
            // Khi mạng vừa kết nối lại, listener Firebase tự kết nối lại và
            // child_added bắn lại cho mọi bản ghi -> _remoteKeysSeen được lấp đầy.
            // Dùng key đó để dọn bản ghi đã bị xoá ở máy khác, KHÔNG cần tải
            // lại collection (reconcileCollection sẽ tải toàn bộ vì REST bị chặn).
            setTimeout(function() {
                reconcileAllFromSeenKeys();
                syncDateBasedOnly();
            }, 3000);
        });
        window.addEventListener('offline', function() {
            isOnline = false;
            showToast('⚠️ Mất kết nối', 'warning');
        });
        
        // QUICK SYNC: Khi tab resume (visibilitychange + focus)
        // Máy POS thường để một tab mở suốt ca làm, nên khi quay lại app sau
        // một khoảng nghỉ (thậm chí không tắt trình duyệt) dữ liệu có thể đã cũ.
        // Hai sự kiện này là điểm móc để tự làm mới mà không cần xoá cache.
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') {
                _quickSync();
            }
        });
        window.addEventListener('focus', function() {
            _quickSync();
        });
        window.addEventListener('pageshow', function(e) {
            // BFCache (iOS Safari, Android WebView): quay lại trang đã bị đóng
            if (e && e.persisted) _quickSync();
        });
        
        // ========== LÀI VÒNG ĐỊNH KỲ ==========
        // Đồng hồ thiết bị có thể lệch vài phút so với server; nếu quyết định
        // "đồng bộ gì" dựa trên so sánh Date.now() cục bộ thì hoặc đồng bộ quá
        // dư, hoặc (tệ hơn) bỏ sót bản ghi mới. _deltaSyncByTime chỉ dùng
        // mốc thời gian để LẤY DỮ LIỆU, quyết định khi nào cần chạy lại thì
        // đặt ở đây theo thời gian thực tế đã trôi qua.
        var _lastPeriodicSync = 0;
        var PERIODIC_SYNC_MS = 2 * 60 * 1000; // 2 phút
        setInterval(function() {
            if (document.visibilityState !== 'visible') return;
            if (_suppressRealtime > 0) return;         // đang trong giao dịch -> để sau
            var now = Date.now();
            if (now - _lastPeriodicSync < PERIODIC_SYNC_MS) return;
            _lastPeriodicSync = now;
            _quickSync();
        }, 30000);
        
        isOnline = navigator.onLine;
    }

    // ========== SYNC META OPERATIONS ==========
    
    // Key prefix cho localStorage
    var LS_SYNC_META_PREFIX = 'sync_meta_';
    
    function getSyncMeta(collection) {
        if (syncMetaCache[collection]) {
            return Promise.resolve(syncMetaCache[collection]);
        }
        try {
            var lsKey = LS_SYNC_META_PREFIX + CURRENT_SHOP_ID + '_' + collection;
            var stored = localStorage.getItem(lsKey);
            if (stored) {
                var meta = JSON.parse(stored);
                if (meta && meta.lastSyncAt) {
                    syncMetaCache[collection] = meta;
                    return Promise.resolve(meta);
                }
            }
        } catch (e) {
        }
        if (!dbReady) {
            return Promise.resolve(null);
        }
        return dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains(SYNC_META_STORE)) {
                return null;
            }
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([SYNC_META_STORE], 'readonly');
                var store = tx.objectStore(SYNC_META_STORE);
                var req = store.get(collection);
                req.onsuccess = function() {
                    var meta = req.result || null;
                    if (meta) {
                        syncMetaCache[collection] = meta;
                        try {
                            var lsKey = LS_SYNC_META_PREFIX + CURRENT_SHOP_ID + '_' + collection;
                            localStorage.setItem(lsKey, JSON.stringify(meta));
                        } catch (e) {}
                    }
                    resolve(meta);
                };
                req.onerror = function() { reject(req.error); };
            });
        });
    }
    
    function saveSyncMeta(collection, meta) {
        syncMetaCache[collection] = meta;
        try {
            var lsKey = LS_SYNC_META_PREFIX + CURRENT_SHOP_ID + '_' + collection;
            localStorage.setItem(lsKey, JSON.stringify({
                id: collection,
                lastSyncAt: meta.lastSyncAt,
                maxVersion: meta.maxVersion,
                dateKeys: meta.dateKeys || []
            }));
        } catch (e) {
        }
        if (!dbReady) return Promise.resolve();
        return dbReady.then(function() {
            if (!localDB || !localDB.objectStoreNames.contains(SYNC_META_STORE)) return;
            return new Promise(function(resolve, reject) {
                var tx = localDB.transaction([SYNC_META_STORE], 'readwrite');
                var store = tx.objectStore(SYNC_META_STORE);
                store.put({ id: collection, lastSyncAt: meta.lastSyncAt, maxVersion: meta.maxVersion, dateKeys: meta.dateKeys || [] });
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function() { resolve(); }; // Không reject để tránh lỗi lan truyền
            });
        });
    }
    
    function getMaxVersionFromFirebase(collection) {
        if (!isOnline) return Promise.resolve(0);
        return _getDb().ref(CURRENT_SHOP_ID + '/_meta/' + collection + '/maxVersion').once('value').then(function(snapshot) {
            return snapshot.val() || 0;
        }).catch(function() { return 0; });
    }
    
    function updateMetaOnFirebase(collection, maxVersion) {
        if (!isOnline) return Promise.resolve();
        return _getDb().ref(CURRENT_SHOP_ID + '/_meta/' + collection).update({
            maxVersion: maxVersion,
            lastUpdatedAt: firebase.database.ServerValue.TIMESTAMP
        }).catch(function(err) {
            console.warn('⚠️ Could not update _meta for', collection, err);
        });
    }
    
    // ========== SMART SYNC ==========
    
    var _syncPromise = null;
    var _syncState = 'idle'; // idle | syncing | done | error
    
    // whenSyncComplete LUÔN resolve trong tối đa SYNC_WAIT_TIMEOUT_MS.
    //
    // VÌ SAO CẦN: chuỗi đồng bộ gọi ra Firebase. Trên máy POS nối Wi-Fi yếu
    // hoặc 4G chập chờn, một request có thể treo rất lâu mà không reject.
    // Khi đó _syncPromise không bao giờ resolve -> pos-app.js chờ mãi không
    // render lại -> màn hình BÀN đứng ở danh sách CŨ tới khi F5 lại.
    // Đây đúng là triệu chứng "mỗi lần F5 lại hiện danh sách bàn cũ".
    var SYNC_WAIT_TIMEOUT_MS = 12000;
    function whenSyncComplete() {
        if (!_syncPromise) return Promise.resolve();
        return new Promise(function(resolve) {
            var done = false;
            var t = setTimeout(function() {
                if (done) return;
                done = true;
                console.warn('⚠️ whenSyncComplete: quá ' + (SYNC_WAIT_TIMEOUT_MS / 1000) +
                             's chưa xong, tiếp tục hiển thị');
                resolve(false);
            }, SYNC_WAIT_TIMEOUT_MS);
            _syncPromise.then(function(r) {
                if (done) return;
                done = true;
                clearTimeout(t);
                resolve(r);
            })['catch'](function() {
                if (done) return;
                done = true;
                clearTimeout(t);
                resolve(false);
            });
        });
    }
    
    function smartSync() {
        if (!isOnline) {
            _syncPromise = Promise.resolve();
            return _syncPromise;
        }
        
        // FIX: xử lý hàng đợi ghi cục bộ TRƯỚC khi đọc dữ liệu từ server.
        // Nếu không, các thay đổi chưa kịp đẩy lên Firebase có thể bị
        // deltaSync ghi đè bằng bản cũ trên server -> mất thay đổi của máy này.
        return processSyncQueue().then(function() {
            console.log('🔄 Smart sync started...');
            return _smartSyncBody();
        });
    }
    
    function _smartSyncBody() {
        
        var masterKeys = Object.keys(MASTER_COLLECTIONS);
        var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
        
        var syncResults = { full: [], delta: [], skipped: [] };
        
        function syncCollection(collection) {
            // Master collections: dùng reconcileCollection (so sánh keys, thêm thiếu, xóa dư)
            // Thay vì fullSync (xóa hết rồi tải lại toàn bộ)
            if (MASTER_COLLECTIONS[collection]) {
                return getSyncMeta(collection).then(function(meta) {
                    var isLocalEmpty = !memoryCache[collection] || Object.keys(memoryCache[collection]).length === 0;
                    
                    if (!meta || isLocalEmpty) {
                        if (isLocalEmpty) {
                            return loadFromLocal(collection).then(function(localData) {
                                var hasLocalData = localData && (Array.isArray(localData) ? localData.length > 0 : Object.keys(localData).length > 0);
                                if (hasLocalData) {
                                    if (!memoryCache[collection]) memoryCache[collection] = {};
                                    for (var i = 0; i < localData.length; i++) {
                                        memoryCache[collection][localData[i].id] = localData[i];
                                    }
                                    if (meta) {
                                        syncResults.delta.push(collection);
                                        // FIX: deltaSync (theo _version) KHÔNG bắt được
                                        // bản ghi mới từ máy khác. Dùng đồng bộ theo
                                        // thời gian + reconcile so key cho chắc.
                                        return deltaSyncByTime(collection).then(function() {
                                            return reconcileCollection(collection);
                                        });
                                    }
                                }
                                // Không có dữ liệu local → reconcile để tải đúng những gì Firebase có
                                syncResults.delta.push(collection);
                                return reconcileCollection(collection);
                            });
                        }
                        // Không có meta → reconcile thay vì fullSync
                        syncResults.delta.push(collection);
                        return reconcileCollection(collection);
                    }
                    
                    var now = Date.now();
                    var timeSinceLastSync = now - (meta.lastSyncAt || 0);
                    
                    if (timeSinceLastSync > THIRTY_DAYS_MS) {
                        // Quá 30 ngày: reconcile để đảm bảo đồng bộ hoàn toàn
                        syncResults.delta.push(collection);
                        return reconcileCollection(collection);
                    }
                    
                    // FIX: thay deltaSync (con trỏ _version hỏng) bằng cặp:
                    //   deltaSyncByTime  - lấy bản ghi vừa thay đổi (rất nhẹ)
                    //   reconcileCollection - bắt bản ghi mới/xoá bản ghi cũ (so key)
                    // Cả hai cùng chạy thì không còn tình huống phải xoá cache mới thấy
                    // dữ liệu, mà vẫn chỉ tải phần thay đổi chứ không tải toàn bộ.
                    syncResults.delta.push(collection);
                    return deltaSyncByTime(collection).then(function() {
                        return reconcileCollection(collection);
                    });
                });
            }
            
            // Date-based collections: dùng đồng bộ theo thời gian thay cho
            // deltaSync (con trỏ _version hỏng, xem giải thích ở deltaSyncByTime)
            return getSyncMeta(collection).then(function(meta) {
                var isLocalEmpty = !memoryCache[collection] || Object.keys(memoryCache[collection]).length === 0;
                
                if (!meta || isLocalEmpty) {
                    if (isLocalEmpty) {
                        return loadFromLocal(collection).then(function(localData) {
                            var hasLocalData = localData && (Array.isArray(localData) ? localData.length > 0 : Object.keys(localData).length > 0);
                            if (hasLocalData) {
                                if (!memoryCache[collection]) memoryCache[collection] = {};
                                for (var i = 0; i < localData.length; i++) {
                                    memoryCache[collection][localData[i].id] = localData[i];
                                }
                                if (meta) {
                                    syncResults.delta.push(collection);
                                    return deltaSyncByTime(collection);
                                }
                            }
                            syncResults.full.push(collection);
                            return fullSync(collection);
                        });
                    }
                    syncResults.full.push(collection);
                    return fullSync(collection);
                }
                
                var now = Date.now();
                var timeSinceLastSync = now - (meta.lastSyncAt || 0);
                
                if (timeSinceLastSync > THIRTY_DAYS_MS) {
                    syncResults.full.push(collection);
                    return fullSync(collection);
                }
                
                syncResults.delta.push(collection);
                return deltaSyncByTime(collection);
            });
        }
        
        var masterPromises = [];
        for (var m = 0; m < masterKeys.length; m++) {
            (function(collection) {
                masterPromises.push(syncCollection(collection));
            })(masterKeys[m]);
        }
        
        var todayKey = toDateKey(Date.now());
        var datePromises = [];

        // Tối ưu: đọc syncMeta 1 lần cho mỗi collection, kiểm tra dateKeys trong memory
        function _syncMissingDates(collection, requiredDateKeys) {
            return getSyncMeta(collection).then(function(meta) {
                var existingDateKeys = (meta && meta.dateKeys) || [];
                var existingSet = {};
                for (var i = 0; i < existingDateKeys.length; i++) {
                    existingSet[existingDateKeys[i]] = true;
                }
                var missingDateKeys = [];
                for (var i = 0; i < requiredDateKeys.length; i++) {
                    if (!existingSet[requiredDateKeys[i]]) {
                        missingDateKeys.push(requiredDateKeys[i]);
                    }
                }
                if (missingDateKeys.length === 0) {
                    // Đã có đủ dateKeys, chỉ chạy deltaSync
                    return deltaSync(collection);
                }
                // Fetch từng ngày còn thiếu
                var chain = Promise.resolve();
                for (var i = 0; i < missingDateKeys.length; i++) {
                    (function(dk) {
                        chain = chain.then(function() {
                            return syncCollectionByDate(collection, dk);
                        });
                    })(missingDateKeys[i]);
                }
                return chain;
            });
        }

        if (_isEmployeeMode()) {
            for (var d = 0; d < dateKeys.length; d++) {
                (function(collection) {
                    datePromises.push(_syncMissingDates(collection, [todayKey]));
                })(dateKeys[d]);
            }
        } else {
            var dateKeysList = getDateKeysBetween(
                toDateKey(Date.now() - THIRTY_DAYS_MS),
                todayKey
            );
            for (var d = 0; d < dateKeys.length; d++) {
                (function(collection) {
                    datePromises.push(_syncMissingDates(collection, dateKeysList));
                })(dateKeys[d]);
            }
        }
        
        // Gán vào biến riêng, KHÔNG đụng _syncPromise.
        // _syncPromise do _startBackgroundSync() quản lý và bao trọn cả chuỗi
        // (smartSync -> ensureShopConfig -> gắn listener). Nếu smartSync tự gán
        // _syncPromise thì nó ghi đè, khiến whenSyncComplete() resolve sớm
        // trước khi listener được gắn.
        var syncBody = Promise.all(masterPromises).then(function() {
            return Promise.all(datePromises);
        }).then(function() {
            console.log('✅ Smart sync completed' + (_isEmployeeMode() ? ' (today only)' : ' (31 days)') + '. Full:', syncResults.full.length, 'Delta:', syncResults.delta.length, 'Skipped:', syncResults.skipped.length);
            return syncResults;
        });
        return syncBody;
    }
    
    function fullSync(collection) {
        if (!isOnline) return Promise.resolve();
        
        var isDateBased = DATE_BASED_COLLECTIONS[collection];
        var isMaster = MASTER_COLLECTIONS[collection];
        if (!isMaster && !isDateBased) {
            console.warn('  ⚠️ Unknown collection, skipping fullSync:', collection);
            return Promise.resolve();
        }
        
        return new Promise(function(resolve, reject) {
            var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
            
            if (isDateBased) {
                var thirtyDaysAgo = Date.now() - THIRTY_DAYS_MS;
                ref = ref.orderByChild('createdAt').startAt(thirtyDaysAgo);
            }
            
            ref.once('value', function(snapshot) {
                if (!snapshot.exists()) {
                    saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: 0, dateKeys: [] });
                    resolve();
                    return;
                }
                
                var remote = snapshot.val() || {};
                var count = 0;
                var maxVersion = 0;
                var dateKeys = [];
                
                _setSuppressRealtime(true);
                
                // FIX: Đánh dấu collection đang được fullSync
                // Để loadFromLocal() biết không đọc từ IndexedDB đã bị clear
                if (isMaster) {
                    _syncingCollections[collection] = true;
                }
                
                if (isMaster && memoryCache[collection]) {
                    memoryCache[collection] = {};
                }
                
                var preClear = Promise.resolve();
                if (isMaster) {
                    preClear = new Promise(function(clearResolve) {
                        var tx = localDB.transaction([collection], 'readwrite');
                        var store = tx.objectStore(collection);
                        var req = store.clear();
                        req.onsuccess = function() { clearResolve(); };
                        req.onerror = function() { clearResolve(); };
                    });
                }
                
                if (collection === 'info') {
                    var infoItem = { id: 'shop_config' };
                    for (var pk in remote) {
                        if (remote.hasOwnProperty(pk)) {
                            infoItem[pk] = remote[pk];
                        }
                    }
                    if (infoItem._version === undefined) infoItem._version = 1;
                    saveToLocal(collection, infoItem).then(function() {
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: infoItem._version || 1, dateKeys: [] });
                        _setSuppressRealtime(false);
                        _emit(collection + ':synced', { collection: collection, count: 1, timestamp: Date.now() });
                        console.log('  📥 Full synced info: 1 item');
                        resolve();
                    }).catch(function(err) {
                        // BẮT BUỘC: nhánh này trước đây không có .catch.
                        //
                        // Khi saveToLocal('info') thất bại (IndexedDB chưa mở,
                        // store chưa có, req lỗi):
                        //  1. _setSuppressRealtime(false) không chạy -> realtime
                        //     của TOÀN BỘ collection bị nuốt (chờ watchdog 20s).
                        //  2. resolve() không chạy -> new Promise bên ngoài treo vĩnh
                        //     viễn -> smartSync() không bao giờ hoàn tất, các
                        //     collection đứng sau info cũng không được đồng bộ.
                        // Nhánh generic ở dưới có xử lý cả hai, nhánh info thì không.
                        console.error('  ❌ Error full syncing info: ', err);
                        _setSuppressRealtime(false);
                        if (isMaster) delete _syncingCollections[collection];
                        resolve();
                    });
                    return;
                }
                
                var saveChain = preClear;
                for (var key in remote) {
                    if (remote.hasOwnProperty(key)) {
                        (function(itemKey) {
                            saveChain = saveChain.then(function() {
                                var src = remote[itemKey];
                                var item = { id: itemKey };
                                for (var p in src) {
                                    if (src.hasOwnProperty(p)) {
                                        item[p] = src[p];
                                    }
                                }
                                if (item._version === undefined) item._version = 1;
                                if (item._version > maxVersion) maxVersion = item._version;
                                
                                if (isDateBased && item.dateKey && dateKeys.indexOf(item.dateKey) < 0) {
                                    dateKeys.push(item.dateKey);
                                }
                                
                                count++;
                                return saveToLocal(collection, item);
                            });
                        })(key);
                    }
                }
                
                return saveChain.then(function() {
                    // Ghi sync_meta
                    saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: maxVersion, dateKeys: dateKeys });
                    updateMetaOnFirebase(collection, maxVersion);
                    _setSuppressRealtime(false);
                    if (isMaster) delete _syncingCollections[collection];
                    _emit(collection + ':synced', { collection: collection, count: count, timestamp: Date.now() });
                    resolve();
                }).catch(function(err) {
                    console.error('  ❌ Error full syncing ' + collection + ': ', err);
                    _setSuppressRealtime(false);
                    if (isMaster) delete _syncingCollections[collection];
                    resolve();
                });
            }, function(err) {
                console.error('  ❌ Firebase read error for ' + collection + ': ', err);
                _setSuppressRealtime(false);
                if (isMaster) delete _syncingCollections[collection];
                resolve();
            });
        });
    }
    
    function deltaSync(collection) {
        if (!isOnline) return Promise.resolve();
        
        return getSyncMeta(collection).then(function(meta) {
            var localMaxVersion = (meta && meta.maxVersion) || 0;
            
            return new Promise(function(resolve, reject) {
                var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
                var queryRef = ref.orderByChild('_version').startAt(localMaxVersion + 1);
                
                queryRef.once('value', function(snapshot) {
                    var remote = snapshot.exists() ? (snapshot.val() || {}) : {};
                    var count = 0;
                    var newMaxVersion = localMaxVersion;
                    var dateKeys = (meta && meta.dateKeys) || [];
                    var isDateBased = DATE_BASED_COLLECTIONS[collection];
                    
                    if (collection === 'info') {
                        var infoItem = { id: 'shop_config' };
                        for (var pk in remote) {
                            if (remote.hasOwnProperty(pk)) {
                                infoItem[pk] = remote[pk];
                            }
                        }
                        if (infoItem._version === undefined) infoItem._version = 1;
                        saveToLocal(collection, infoItem).then(function() {
                            saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: infoItem._version || 1, dateKeys: [] });
                            resolve();
                        });
                        return;
                    }
                    
                    var saveChain = Promise.resolve();
                    for (var key in remote) {
                        if (remote.hasOwnProperty(key)) {
                            (function(itemKey) {
                                saveChain = saveChain.then(function() {
                                    var src = remote[itemKey];
                                    var item = { id: itemKey };
                                    for (var p in src) {
                                        if (src.hasOwnProperty(p)) {
                                            item[p] = src[p];
                                        }
                                    }
                                    if (item._version === undefined) item._version = 1;
                                    if (item._version > newMaxVersion) newMaxVersion = item._version;
                                    
                                    if (isDateBased && item.dateKey && dateKeys.indexOf(item.dateKey) < 0) {
                                        dateKeys.push(item.dateKey);
                                    }
                                    
                                    count++;
                                    return saveToLocal(collection, item);
                                });
                            })(key);
                        }
                    }
                    
                    return saveChain.then(function() {
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: newMaxVersion, dateKeys: dateKeys });
                        updateMetaOnFirebase(collection, newMaxVersion);
                        resolve();
                    }).catch(function(err) {
                        console.error('  ❌ Error delta syncing ' + collection + ': ', err);
                        resolve();
                    });
                }, function(err) {
                    console.error('  ❌ Firebase query error for ' + collection + ': ', err);
                    resolve();
                });
            });
        });
    }
    
    // ============================================================
    // ĐỒNG BỘ THEO MỐC THỜI GIAN (updatedAt) - con trỏ ĐÚNG
    // ============================================================
    // VÌ SAO CẦN:
    // deltaSync() dùng _version làm con trỏ, nhưng _version là BỘ ĐẾM RIÊNG
    // CHO TỪNG BẢN GHI chứ không phải bộ đếm chung:
    //   - DB.create() luôn đặt _version = 1
    //   - DB.update() tăng _version của đúng bản ghi đó
    // Giả sử máy này đã đồng bộ tới _version = 47. Một bàn MỚI TẠO ở máy khác
    // có _version = 1, nên truy vấn orderByChild('_version').startAt(48) sẽ
    // KHÔNG BAO GIỜ trả về bàn đó. Đúng triệu chứng "phải xoá cache mới thấy".
    //
    // updatedAt là timestamp thật do Date.now() gán, TĂNG ĐƠN ĐIỆU và dùng chung
    // cho mọi máy -> làm con trỏ đồng bộ đúng. Truy vấn:
    //   orderByChild('updatedAt').startAt(lastSyncAt - 1 giây)
    // Lùi 1s để không bỏ sót bản ghi ghi đúng tại mốc thời gian.
    // Kết quả trả về: chỉ tải các bản ghi THỰC SỰ thay đổi, không tải toàn bộ.
    function deltaSyncByTime(collection) {
        if (!isOnline) return Promise.resolve();
        
        return getSyncMeta(collection).then(function(meta) {
            var lastSyncAt = (meta && meta.lastSyncAt) || 0;
            // Lùi 1 giây: bản ghi ghi đúng tại mốc thời gian vẫn được lấy
            var since = Math.max(0, lastSyncAt - 1000);
            
            return new Promise(function(resolve) {
                var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
                // Chỉ lấy bản ghi có updatedAt >= since -> rất nhẹ
                var queryRef = ref.orderByChild('updatedAt').startAt(since);
                
                queryRef.once('value', function(snapshot) {
                    var remote = snapshot.exists() ? (snapshot.val() || {}) : {};
                    var count = 0;
                    var maxVersion = (meta && meta.maxVersion) || 0;
                    var dateKeys = (meta && meta.dateKeys) || [];
                    var isDateBased = !!DATE_BASED_COLLECTIONS[collection];
                    
                    var saveChain = Promise.resolve();
                    for (var key in remote) {
                        if (remote.hasOwnProperty(key)) {
                            (function(itemKey) {
                                saveChain = saveChain.then(function() {
                                    var src = remote[itemKey];
                                    var item = { id: itemKey };
                                    for (var p in src) if (src.hasOwnProperty(p)) item[p] = src[p];
                                    if (item._version === undefined) item._version = 1;
                                    if (item._version > maxVersion) maxVersion = item._version;
                                    if (isDateBased && item.dateKey && dateKeys.indexOf(item.dateKey) < 0) {
                                        dateKeys.push(item.dateKey);
                                    }
                                    count++;
                                    return saveToLocal(collection, item);
                                });
                            })(key);
                        }
                    }
                    
                    return saveChain.then(function() {
                        // Chỉ ghi meta nếu có gì mới, tránh reset lastSyncAt liên tục
                        if (count > 0) {
                            saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: maxVersion, dateKeys: dateKeys });
                            console.log('⏱ Đồng bộ ' + collection + ': ' + count + ' bản ghi thay đổi');
                        }
                        if (count > 0) {
                            _emit(collection + ':synced', { collection: collection, count: count, timestamp: Date.now() });
                        }
                        resolve(count);
                    });
                }, function(err) {
                    // Query thất bại, thường do thiếu index updatedAt trong
                    // firebase-rules.json. Fallback sang reconcileCollection (so key)
                    // để dữ liệu vẫn được lấy về đầy đủ, chỉ chậm hơn một chút.
                    console.warn('  ⚠️ deltaSyncByTime lỗi ' + collection + ':', err && err.message);
                    console.warn('     -> thử index updatedAt trong Firebase Rules, hoặc fallback reconcile');
                    if (MASTER_COLLECTIONS[collection]) {
                        reconcileCollection(collection).then(function() { resolve(0); });
                    } else {
                        resolve(0);
                    }
                });
            });
        });
    }
    
    // Làm mới nhẹ, KHÔNG cần index updatedAt.
    // Trước đây dùng deltaSyncByTime (orderByChild('updatedAt')) -> Firebase phải
    // tải TOÀN BỘ collection rồi lọc ở máy khách khi thiếu index, hoặc phải
    // deploy rules (mà shop dùng config riêng, không deploy được).
    // Nay dựa vào listener realtime: dữ liệu mới đã tự stream về từ lúc mở app.
    // refreshData chỉ đẩy hàng đợi cục bộ lên server + dọn bản ghi đã bị xoá.
    function quickSyncByTime() {
        if (!isOnline) return Promise.resolve(0);
        return processSyncQueue()
            .then(function() { return reconcileFromSeenKeys('tables'); })
            .then(function(r) { return r && r.removed ? r.removed : 0; })
            ['catch'](function(err) {
                console.warn('⚠️ refreshData lỗi:', (err && err.message) || err);
                return 0;
            });
    }
    
    function reconcileSnapshot(collection) {
        if (!isOnline) return Promise.resolve();
        var isMaster = MASTER_COLLECTIONS[collection];
        console.log('🔄 Reconcile snapshot for:', collection);
        if (isMaster) {
            // Master collections: reset sync_meta + fullSync
            return saveSyncMeta(collection, { lastSyncAt: 0, maxVersion: 0, dateKeys: [] }).then(function() {
                return fullSync(collection);
            });
        } else {
            return deltaSync(collection);
        }
    }
    
    var _fetchingDateKeys = {};
    
    function syncCollectionByDate(collection, dateKey) {
        if (!isOnline) return Promise.resolve([]);
        
        var fetchKey = collection + '|' + dateKey;
        if (_fetchingDateKeys[fetchKey]) {
            return _fetchingDateKeys[fetchKey];
        }
        
        var promise = _doSyncCollectionByDate(collection, dateKey);
        _fetchingDateKeys[fetchKey] = promise;
        
        return promise.then(function(result) {
            delete _fetchingDateKeys[fetchKey];
            return result;
        }).catch(function(err) {
            delete _fetchingDateKeys[fetchKey];
            throw err;
        });
    }
    
    function _doSyncCollectionByDate(collection, dateKey) {
        return getSyncMeta(collection).then(function(meta) {
            var dateKeys = (meta && meta.dateKeys) || [];
            
            // Luôn fetch từ Firebase để đảm bảo dữ liệu đầy đủ
            // Không skip dựa vào dateKeys trong meta vì deltaSync có thể đã thêm
            // dateKey vào meta nhưng chỉ với 1 item (không đầy đủ)
            
            // console.log('  📥 Fetching', collection, 'for date:', dateKey);
            
            return new Promise(function(resolve, reject) {
                var ref = _getDb().ref(CURRENT_SHOP_ID + '/' + collection);
                ref.orderByChild('dateKey').equalTo(dateKey).once('value', function(snapshot) {
                    if (!snapshot.exists()) {
                        if (dateKeys.indexOf(dateKey) < 0) {
                            dateKeys.push(dateKey);
                        }
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: (meta && meta.maxVersion) || 0, dateKeys: dateKeys });
                        // console.log('  📥 Fetched', collection, 'for', dateKey, ': 0 items (no data)');
                        resolve([]);
                        return;
                    }
                    
                    var remote = snapshot.val() || {};
                    var items = [];
                    var maxVersion = (meta && meta.maxVersion) || 0;
                    
                    var saveChain = Promise.resolve();
                    for (var key in remote) {
                        if (remote.hasOwnProperty(key)) {
                            (function(itemKey) {
                                saveChain = saveChain.then(function() {
                                    var src = remote[itemKey];
                                    var item = { id: itemKey };
                                    for (var p in src) {
                                        if (src.hasOwnProperty(p)) {
                                            item[p] = src[p];
                                        }
                                    }
                                    if (item._version === undefined) item._version = 1;
                                    if (item._version > maxVersion) maxVersion = item._version;
                                    items.push(item);
                                    return saveToLocal(collection, item);
                                });
                            })(key);
                        }
                    }
                    
                    return saveChain.then(function() {
                        if (dateKeys.indexOf(dateKey) < 0) {
                            dateKeys.push(dateKey);
                        }
                        saveSyncMeta(collection, { lastSyncAt: Date.now(), maxVersion: maxVersion, dateKeys: dateKeys });
                        updateMetaOnFirebase(collection, maxVersion);
                        // console.log('  📥 Fetched', collection, 'for', dateKey, ':', items.length, 'items');
                        resolve(items);
                    }).catch(function(err) {
                        console.error('  ❌ Error fetching', collection, 'by date:', err);
                        resolve([]);
                    });
                }, function(err) {
                    console.error('  ❌ Firebase query error:', err);
                    resolve([]);
                });
            });
        });
    }
    
    function ensureRecentDaysData(daysCount, callback) {
        daysCount = daysCount || 31; // Hôm nay + 30 ngày trước
        callback = callback || function() {};
        
        if (!isOnline) {
            callback({ error: 'OFFLINE' });
            return Promise.reject(new Error('Offline'));
        }
        
        var now = Date.now();
        var endDateKey = toDateKey(now);
        
        var startDate = new Date(now);
        startDate.setDate(startDate.getDate() - (daysCount - 1));
        var startDateKey = toDateKey(startDate.getTime());
        
        var requiredDateKeys = getDateKeysBetween(startDateKey, endDateKey);
        var dateKeysList = Object.keys(DATE_BASED_COLLECTIONS);
        
        var totalTasks = dateKeysList.length;
        var completedTasks = 0;
        var allResults = {};
        
        console.log('📦 ensureRecentDaysData: Need', requiredDateKeys.length, 'dateKeys for', dateKeysList.length, 'collections');
        
        function processCollection(collection) {
            return getSyncMeta(collection).then(function(meta) {
                var existingDateKeys = (meta && meta.dateKeys) || [];
                var existingSet = {};
                for (var i = 0; i < existingDateKeys.length; i++) {
                    existingSet[existingDateKeys[i]] = true;
                }
                
                var missingDateKeys = [];
                for (var i = 0; i < requiredDateKeys.length; i++) {
                    if (!existingSet[requiredDateKeys[i]]) {
                        missingDateKeys.push(requiredDateKeys[i]);
                    }
                }
                
                if (missingDateKeys.length === 0) {
                    completedTasks++;
                    callback({ current: completedTasks, total: totalTasks, collection: collection, dateKey: null, status: 'skipped', missingCount: 0 });
                    return { collection: collection, fetched: 0, skipped: true };
                }
                
                console.log('  📥 Collection', collection, 'missing', missingDateKeys.length, 'days');
                
                var chain = Promise.resolve();
                var fetchedCount = 0;
                
                for (var i = 0; i < missingDateKeys.length; i++) {
                    (function(dateKey) {
                        chain = chain.then(function() {
                            callback({ current: completedTasks, total: totalTasks, collection: collection, dateKey: dateKey, status: 'fetching', missingCount: missingDateKeys.length });
                            return syncCollectionByDate(collection, dateKey).then(function(items) {
                                fetchedCount += (items ? items.length : 0);
                            });
                        });
                    })(missingDateKeys[i]);
                }
                
                return chain.then(function() {
                    completedTasks++;
                    callback({ current: completedTasks, total: totalTasks, collection: collection, dateKey: null, status: 'done', missingCount: missingDateKeys.length, fetchedCount: fetchedCount });
                    return { collection: collection, fetched: fetchedCount, missingCount: missingDateKeys.length };
                });
            });
        }
        
        var chain = Promise.resolve();
        for (var c = 0; c < dateKeysList.length; c++) {
            (function(collection) {
                chain = chain.then(function() {
                    return processCollection(collection);
                }).then(function(result) {
                    allResults[collection] = result;
                });
            })(dateKeysList[c]);
        }
        
        return chain.then(function() {
            console.log('✅ ensureRecentDaysData completed:', allResults);
            return allResults;
        });
    }
    
    function getDateKeysBetween(startDateKey, endDateKey) {
        var keys = [];
        var start = new Date(startDateKey + 'T00:00:00');
        var end = new Date(endDateKey + 'T00:00:00');
        var current = new Date(start);
        while (current <= end) {
            var y = current.getFullYear();
            var m = ('0' + (current.getMonth() + 1)).slice(-2);
            var d = ('0' + current.getDate()).slice(-2);
            keys.push(y + '-' + m + '-' + d);
            current.setDate(current.getDate() + 1);
        }
        return keys;
    }

    // Init IndexedDB
    function initLocalDB() {
        if (dbReady) return dbReady;
        dbReady = new Promise(function(resolve, reject) {
            var request = indexedDB.open(STORE_NAME, 21);
            request.onerror = function(e) { reject(e.target.error); };
            request.onsuccess = function(e) {
                localDB = e.target.result;
                loadSyncQueue();
                loadSyncConflicts();
                resolve(localDB);
            };
            request.onupgradeneeded = function(e) {
                var db = e.target.result;
                var stores = [
    'tables', 'customers', 'menu', 'menu_categories',
    'ingredients', 'transactions', 'reports', 'sync_queue', 'staffs',
    'cost_categories', 'cost_transactions', 'cost_transactions_admin',
    'admin_cost_categories', 'daily_balances',
    'inventory_transactions', 'manager_cash_pickups',
    'ingredient_transactions', 'notifications',
    'info',
    'messages',
    'delete_logs',
    'sync_meta',
    'bonus_fund',
    // Nhật ký xung đột đồng bộ: ghi lại phần thay đổi bị quy tắc bỏ đi, để
    // không có thay đổi nào bị mất mà không ai biết.
    _syncConflictStore
];
                for (var i = 0; i < stores.length; i++) {
                    if (!db.objectStoreNames.contains(stores[i])) {
                        db.createObjectStore(stores[i], { keyPath: 'id' });
                        console.log('Created store:', stores[i]);
                    }
                }
                try {
                    var tx = e.target.transaction;
                    
                    if (e.oldVersion < 17 && tx && tx.objectStoreNames.contains('info')) {
                        var infoStore = tx.objectStore('info');
                        infoStore.clear();
                        console.log('Cleared old info store data for version 17 migration');
                    }
                    
                    if (tx && tx.objectStoreNames.contains('transactions')) {
                        var txStore = tx.objectStore('transactions');
                        if (!txStore.indexNames.contains('dateKey')) txStore.createIndex('dateKey', 'dateKey', { unique: false });
                        if (!txStore.indexNames.contains('type')) txStore.createIndex('type', 'type', { unique: false });
                        if (!txStore.indexNames.contains('dateTypeKey')) txStore.createIndex('dateTypeKey', 'dateTypeKey', { unique: false });
                    }
                } catch(ex) {
                    console.warn('Could not create indexes:', ex);
                }
            };
        });
        return dbReady;
    }

    function loadSyncQueue() {
        if (!localDB) return;
        var tx = localDB.transaction(['sync_queue'], 'readonly');
        var store = tx.objectStore('sync_queue');
        var req = store.getAll();
        req.onsuccess = function() {
            syncQueue = req.result || [];
            // Mục tạo trước khi có trường shopId: đóng dấu là của shop hiện
            // tại để không mất dữ liệu chưa gửi. Sau lần nạp này mọi mục mới
            // đều có shopId nên việc đổi shop không còn lẫn dữ liệu.
            var stamped = false;
            for (var i = 0; i < syncQueue.length; i++) {
                if (syncQueue[i] && !syncQueue[i].shopId) {
                    syncQueue[i].shopId = CURRENT_SHOP_ID;
                    stamped = true;
                }
            }
            if (stamped) {
                for (var j = 0; j < syncQueue.length; j++) {
                    saveToLocal('sync_queue', syncQueue[j]);
                }
            }
        };
    }
    function loadSyncConflicts() {
        if (!localDB) return;
        try {
            if (!localDB.objectStoreNames.contains(_syncConflictStore)) return;
            var tx = localDB.transaction([_syncConflictStore], 'readonly');
            var store = tx.objectStore(_syncConflictStore);
            var req = store.getAll();
            req.onsuccess = function() { _syncConflicts = req.result || []; };
        } catch (e) { /* store chưa có: không có gì để nạp */ }
    }
    function markSyncConflictResolved(id, resolutionNote) {
        for (var i = 0; i < _syncConflicts.length; i++) {
            if (_syncConflicts[i].id === id) {
                _syncConflicts[i].resolved = true;
                _syncConflicts[i].resolvedAt = Date.now();
                _syncConflicts[i].resolutionNote = resolutionNote || '';
                saveToLocal(_syncConflictStore, _syncConflicts[i]);
                return true;
            }
        }
        return false;
    }

    function seedDefaultShop() {
        return db.ref('shop_registry/123123').once('value').then(function(snapshot) {
            if (snapshot.exists()) return; // Đã có rồi, không cần seed
            
            console.log('🌱 Seeding default shop data...');
            var staffId = 'staff_admin_' + Date.now().toString(36);
            var updates = {};
            
            updates['shop_registry/123123'] = {
                shopId: 'shop_default',
                shopName: 'MILANO COFFEE 259',
                shopCode: '123123',
                createdAt: Date.now()
            };
            
            updates['shop_default/staffs/' + staffId] = {
                id: staffId,
                username: 'admin123123',
                password: '123123',
                displayName: 'Admin',
                role: 'admin',
                createdAt: Date.now(),
                createdBy: 'system'
            };
            
            updates['shop_default/info'] = {
                id: 'shop_config',
                name: 'MILANO COFFEE 259',
                code: '123123',
                createdAt: Date.now(),
                // Telegram config
                telegramBotToken: '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                telegramChatId: '6372876364',
                telegramShiftCloseToken: '',
                telegramWarningToken: '',
                telegramExpenseToken: '',
                lockPassword: '28122020',
                lockStartHour: 22,
                lockEndHour: 5,
                lockEndMinute: 30,
                tableLockHours: 5
            };
            
            return db.ref().update(updates).then(function() {
                console.log('✅ Default shop seeded: mã 123123, user admin123123, pass 123123');
            });
        }).catch(function(err) {
            console.error('Seed error:', err);
        });
    }

    function ensureShopConfig() {
        return _getDb().ref(CURRENT_SHOP_ID + '/info').once('value').then(function(snapshot) {
            var info = snapshot.val() || {};
            var needsUpdate = false;
            var defaults = {
                id: 'shop_config',
                telegramBotToken: '8813111415:AAHjX0-vXMM0dVgVqDSSZNbHtiQ2wiVsFrc',
                telegramChatId: '6372876364',
                telegramShiftCloseToken: '',
                telegramWarningToken: '',
                telegramExpenseToken: '',
                lockPassword: '28122020',
                lockStartHour: 22,
                lockEndHour: 5,
                lockEndMinute: 30,
                tableLockHours: 5
            };
            var updates = {};
            for (var key in defaults) {
                if (defaults.hasOwnProperty(key)) {
                    if (info[key] === undefined || info[key] === null) {
                        updates[key] = defaults[key];
                        needsUpdate = true;
                    }
                }
            }
            if (needsUpdate) {
                console.log('⚙️ Adding missing config fields to shop info...');
                return _getDb().ref(CURRENT_SHOP_ID + '/info').update(updates).then(function() {
                    console.log('✅ Shop config fields created');
                });
            }
        }).catch(function(err) {
            console.error('⚠️ ensureShopConfig error:', err);
        });
    }

    
    // ========== ENSURE COLLECTION ==========
    function ensureCollection(collection) {
        if (!isOnline) return Promise.resolve([]);
        return loadFromLocal(collection).then(function(localData) {
            if (localData && Object.keys(localData).length > 0) {
                var arr = [];
                for (var k in localData) {
                    if (localData.hasOwnProperty(k)) arr.push(localData[k]);
                }
                return arr;
            }
            console.log('  📦 Local empty for', collection, '- syncing from Firebase...');
            return getSyncMeta(collection).then(function(meta) {
                if (!meta) {
                    return fullSync(collection).then(function() {
                        return loadFromLocal(collection).then(function(data) {
                            var arr = [];
                            for (var k in data) {
                                if (data.hasOwnProperty(k)) arr.push(data[k]);
                            }
                            return arr;
                        });
                    });
                }
                return deltaSync(collection).then(function() {
                    return loadFromLocal(collection).then(function(data) {
                        var arr = [];
                        for (var k in data) {
                            if (data.hasOwnProperty(k)) arr.push(data[k]);
                        }
                        return arr;
                    });
                });
            });
        });
    }
    function forceSyncFromFirebase() {
        if (!isOnline) {
            console.warn('⚠️ Offline, cannot force sync from Firebase');
            return Promise.reject(new Error('Offline'));
        }
        
        // Đẩy thay đổi cục bộ lên server trước. Nếu không, fullSync sẽ tải bản
        // trên server về và ghi đè mất thay đổi chưa kịp đẩy của máy này.
        return processSyncQueue().then(function() {
            return _forceSyncFromFirebaseBody();
        });
    }
    
    function _forceSyncFromFirebaseBody() {
        // Master collections: fullSync (tables, menu, customers, ingredients, staffs...)
        // Date-based collections: syncCollectionByDate
        var isEmployee = _isEmployeeMode();
        var retentionDays = _getRetentionDays();
        console.log('🔔 Force syncing collections from Firebase (master: fullSync, date-based: ' + (isEmployee ? 'today only' : retentionDays + ' days') + ')...');
        
        syncMetaCache = {};
        
        var todayKey = toDateKey(Date.now());
        
        // Master collections: fullSync song song
        var masterKeys = Object.keys(MASTER_COLLECTIONS);
        var masterPromises = [];
        for (var m = 0; m < masterKeys.length; m++) {
            (function(collection) {
                if (memoryCache[collection]) {
                    memoryCache[collection] = {};
                }
                masterPromises.push(fullSync(collection));
            })(masterKeys[m]);
        }
        
        if (memoryCache['messages']) {
            memoryCache['messages'] = {};
        }
        masterPromises.push(fullSync('messages'));
        
        // Date-based collections: syncCollectionByDate song song
        var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
        var dateKeysToFetch = [];
        if (isEmployee) {
            dateKeysToFetch.push(todayKey);
        } else {
            dateKeysToFetch = getDateKeysBetween(
                toDateKey(Date.now() - _getRetentionMs()),
                todayKey
            );
        }
        
        var datePromises = [];
        for (var d = 0; d < dateKeys.length; d++) {
            (function(collection) {
                if (memoryCache[collection]) {
                    memoryCache[collection] = {};
                }
                for (var k = 0; k < dateKeysToFetch.length; k++) {
                    (function(dk) {
                        datePromises.push(syncCollectionByDate(collection, dk));
                    })(dateKeysToFetch[k]);
                }
            })(dateKeys[d]);
        }
        
        _syncPromise = Promise.all(masterPromises).then(function() {
            return Promise.all(datePromises);
        }).then(function() {
            console.log('✅ Force sync completed' + (isEmployee ? ' (today only)' : ' (31 days)'));
        });
        return _syncPromise;
    }

    // Hủy các subscription cũ và đăng ký lại (dùng khi chuyển Firebase config)
    function _reinitializeSubscriptions() {
        // Hủy tất cả listeners realtime cũ bằng cách gọi unsubscribe functions
        for (var col in _unsubscribeFns) {
            if (_unsubscribeFns.hasOwnProperty(col)) {
                var fns = _unsubscribeFns[col];
                for (var i = 0; i < fns.length; i++) {
                    try {
                        fns[i]();
                    } catch(e) {
                        console.warn('⚠️ Error unsubscribing', col, ':', e.message);
                    }
                }
            }
        }
        _unsubscribeFns = {};
        listeners = {};
        
        // Hủy tất cả polling timers cũ
        for (var timerCol in _pollingTimers) {
            if (_pollingTimers.hasOwnProperty(timerCol)) {
                clearInterval(_pollingTimers[timerCol]);
            }
        }
        _pollingTimers = {};
        
        // Đăng ký lại subscriptions với _getDb() (sẽ dùng _secondaryDb nếu có)
        subscribeToCollection('tables');
        subscribeToCollection('customers');
        subscribeToCollection('transactions', null, { orderByChild: 'createdAt', limitToLast: 200 });
        subscribeToCollection('notifications');
        subscribeToCollection('info');
        subscribeToCollection('daily_balances');
        subscribeToCollection('cost_categories');
        subscribeToCollection('cost_transactions');

        // P1+P2: Thay polling bằng Firebase realtime listeners
        // tables đã có child_added/changed/removed listener ở trên, không cần polling 30s nữa
        // menu, menu_categories, ingredients, messages: subscribe realtime listeners thay vì polling 60s
        subscribeToCollection('menu');
        subscribeToCollection('menu_categories');
        subscribeToCollection('ingredients');
        subscribeToCollection('messages');
        console.log('✅ Re-initialized subscriptions for Firebase config:', _secondaryDb ? 'custom' : 'default');
    }

    // Init Database
    // ============================================================
    // GIAI ĐOẠN 2: MỌI VIỆC MẠNG CHẠY NỀN
    // ============================================================
// db.js được nạp sớm, init() phải trả về NHANH để UI có thể dựng từ IndexedDB.
// Trước đây init() chờ smartSync() + ensureShopConfig() xong mới resolve, cộng
// thêm các listener ở dưới. Riêng chỗ đăng ký listener đã là cú tải nặng: khi
// gắn ref.on('child_added'), Firebase gửi về TOÀN BỘ collection đó. Menu là
// tải hết menu, transactions là limitToLast 200 giao dịch. Tất cả những thứ đó
// là việc MẠNG, không được chặn lần vẽ đầu tiên.
//
// Nay: init() chỉ mở IndexedDB (nhanh, local) rồi trả về. Đồng bộ + listener
// chạy nền, kết quả bắn event tables:synced / tables:reconciled mà UI đã đăng
// ký sẽ tự render lại.
// Đồng bộ nhẹ các collection theo NGÀY (transactions, daily_balances...)
// Dùng orderByChild('dateKey').equalTo(...) nên KHÔNG cần index updatedAt.
// Master collections (tables, menu, customers...) KHÔNG gồm ở đây vì chúng
// được xử lý bằng listener realtime + reconcileFromSeenKeys, rẻ hơn nhiều.
function syncDateBasedOnly() {
    if (!isOnline) return Promise.resolve();
    var dateKeys = Object.keys(DATE_BASED_COLLECTIONS);
    if (dateKeys.length === 0) return Promise.resolve();

    var todayKey = toDateKey(Date.now());
    var requiredKeys;
    if (_isEmployeeMode()) {
        requiredKeys = [todayKey];
    } else {
        requiredKeys = getDateKeysBetween(
            toDateKey(Date.now() - _getRetentionMs()), todayKey);
    }

    var chain = Promise.resolve();
    for (var i = 0; i < dateKeys.length; i++) {
        (function(collection) {
            chain = chain.then(function() {
                return getSyncMeta(collection).then(function(meta) {
                    var existing = (meta && meta.dateKeys) || [];
                    var set = {};
                    for (var j = 0; j < existing.length; j++) set[existing[j]] = true;
                    var missing = [];
                    for (var k = 0; k < requiredKeys.length; k++) {
                        if (!set[requiredKeys[k]]) missing.push(requiredKeys[k]);
                    }
                    if (missing.length === 0) return deltaSync(collection);
                    var c2 = Promise.resolve();
                    for (var m = 0; m < missing.length; m++) {
                        (function(dk) {
                            c2 = c2.then(function() { return syncCollectionByDate(collection, dk); });
                        })(missing[m]);
                    }
                    return c2;
                });
            })['catch'](function(err) {
                console.warn('[Sync] Lỗi đồng bộ ' + collection + ':', (err && err.message) || err);
            });
        })(dateKeys[i]);
    }
    return chain;
}

// Dọn bản ghi local đã bị xoá ở máy khác, dựa trên key đã thấy từ listener.
// Không tốn thêm request nào.
function reconcileAllFromSeenKeys() {
    if (!isOnline) return Promise.resolve();
    var chain = Promise.resolve();
    for (var key in MASTER_COLLECTIONS) {
        if (!MASTER_COLLECTIONS.hasOwnProperty(key)) continue;
        (function(collection) {
            chain = chain.then(function() {
                return reconcileFromSeenKeys(collection);
            });
        })(key);
    }
    return chain;
}

function _startBackgroundSync() {
    var chain = Promise.resolve();
    
    _syncState = 'syncing';
    _emit('sync:state', { state: 'syncing' });
    
    if (isOnline && currentUser) {
        // 1. GẮN LISTENER NGAY.
        //    Đây là cách RẺ NHẤT để có dữ liệu mới: Firebase stream qua
        //    websocket, không tốn request thừa, không cần index.
        //    child_added bắn cho MỌI bản ghi hiện có -> ta cũng biết luôn
        //    danh sách key trên server (dùng cho bước 4).
        chain = chain.then(function() {
            _attachAllListeners();
        });
        
        // 2. Đẩy thay đổi cục bộ chưa gửi lên server
        chain = chain.then(function() {
            return processSyncQueue();
        });
        
        // 3. Collection theo ngày (transactions...) - dùng dateKey, không cần index
        chain = chain.then(function() {
            return syncDateBasedOnly();
        });
        
        // 4. Đợi listener ổn định rồi dọn bản ghi đã bị xoá ở máy khác.
        //    Dùng key đã thấy từ listener nên KHÔNG tải lại collection.
        chain = chain.then(function() {
            return new Promise(function(resolve) { setTimeout(resolve, 2500); });
        }).then(function() {
            return reconcileAllFromSeenKeys();
        });
    } else if (!_secondaryDb && !currentUser) {
        // Lần đầu tiên, chưa có session: tạo dữ liệu mặc định
        chain = chain.then(function() {
            return seedDefaultShop();
        }).then(function() {
            _attachAllListeners();
        });
    }
    
    chain = chain.then(function() {
        if (!currentUser) return Promise.resolve();
        return ensureShopConfig();
    }).then(function() {
        _startPeriodicCleanup();
        _startPeriodicDataCleanup();
        console.log('✅ Database ready, device:', CURRENT_DEVICE_ID);
    });
    
    // Giữ _syncPromise để whenSyncComplete() vẫn chờ được
    // (inventory-manager.js dùng hàm này).
    _syncPromise = chain.then(function() {
        _syncState = 'done';
        _emit('sync:state', { state: 'done' });
    }).catch(function(err) {
        console.error('⚠️ Đồng bộ nền lỗi:', err);
        _syncState = 'error';
        _emit('sync:state', { state: 'error', error: err });
    });
    return _syncPromise;
}

// Gắn listener realtime. Gọi SAU khi đồng bộ xong để không tranh tải với
// smartSync và không chặn lần vẽ đầu tiên.
function _attachAllListeners() {
    // tables: gắn sớm nhất vì đây là màn hình chính của POS
    subscribeToCollection('tables');
    subscribeToCollection('customers');
    subscribeToCollection('transactions', null, { orderByChild: 'createdAt', limitToLast: 200 });
    subscribeToCollection('notifications');
    subscribeToCollection('info');
    subscribeToCollection('daily_balances');
    subscribeToCollection('cost_categories');
    subscribeToCollection('cost_transactions');

    // P1+P2: Thay polling bằng Firebase realtime listeners
    subscribeToCollection('menu');
    subscribeToCollection('menu_categories');
    subscribeToCollection('ingredients');
    subscribeToCollection('messages');
}

function initDatabase() {
    _restoreDirtyFlags();
    return initLocalDB().then(function() {
        initNetwork();
        // KHÔNG chờ mạng. UI sẽ dựng từ IndexedDB rồi tự cập nhật khi sync xong.
        _startBackgroundSync();
        return { isOnline: isOnline, deviceId: CURRENT_DEVICE_ID };
    });
}

    // Dùng chung showToast của pos-app.js để chỉ có 1 toast trên màn hình.
    // Fallback về console.log nếu hàm global chưa sẵn sàng (db.js load trước).
    function showToast(msg, type) {
        if (typeof window.showToast === 'function') {
            return window.showToast(msg, type);
        }
        console.log(msg);
    }

    // ========== AUTH METHODS ==========
    
    function clearLocalData() {
        memoryCache = {};
        cacheVersion = {};
        syncMetaCache = {};
        // PHASE 4: Dọn cache timestamps khi clear data
        _cacheTimestamps = {};
        _txDateCache = {};
        _txDateCacheTimestamps = {};
        
        try {
            var lsPrefix = LS_SYNC_META_PREFIX + CURRENT_SHOP_ID + '_';
            var keysToRemove = [];
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                if (key && key.indexOf(lsPrefix) === 0) {
                    keysToRemove.push(key);
                }
            }
            for (var i = 0; i < keysToRemove.length; i++) {
                localStorage.removeItem(keysToRemove[i]);
            }
        } catch (e) {}
        
        if (!localDB) return Promise.resolve();
        
        var storeNames = [];
        for (var i = 0; i < localDB.objectStoreNames.length; i++) {
            storeNames.push(localDB.objectStoreNames[i]);
        }
        var promises = [];
        for (var i = 0; i < storeNames.length; i++) {
            var name = storeNames[i];
            if (name === 'sync_queue') continue; // Giữ lại sync queue
            promises.push(new Promise(function(resolve, reject) {
                var tx = localDB.transaction([name], 'readwrite');
                var store = tx.objectStore(name);
                var req = store.clear();
                req.onsuccess = function() { resolve(); };
                req.onerror = function() { reject(req.error); };
            }));
        }
        return Promise.all(promises).then(function() {
            console.log('🗑️ Cleared all local data for shop switch');
        });
    }
    
    function setShopId(shopId) {
        if (!shopId) return;
        CURRENT_SHOP_ID = shopId;
        localStorage.setItem('current_shop_id', shopId);
        console.log('🔔 Switched to shop:', shopId);
    }
    
    function getShopId() {
        return CURRENT_SHOP_ID;
    }
    
    // Đóng connection IndexedDB local (dùng cho clearIndexedDB trong settings.js)
    function closeLocalDB() {
        try {
            if (localDB) {
                localDB.close();
                localDB = null;
                return true;
            }
        } catch (e) {}
        return false;
    }
    
    function login(shopCode, username, password) {
        if (!username || !password) {
            return Promise.reject(new Error('Vui lòng nhập tên đăng nhập và mật khẩu'));
        }
        
        // Kiểm tra MASTER_CONFIG trước (nếu đã load)
        if (typeof MASTER_CONFIG !== 'undefined' && MASTER_CONFIG) {
            return MASTER_CONFIG.login(shopCode, username, password).then(function(result) {
                if (result) {
                    // Master admin login
                    if (result.isMasterAdmin) {
                        // Master admin login vào POS cụ thể (có mã POS)
                        if (result.isMasterInPos) {
                            var posInfo = result.posInfo;
                            var shopId = posInfo.shopId || ('shop_' + posInfo.code);
                            
                            // Xóa dữ liệu local trước khi chuyển sang POS khác
                            return clearLocalData().then(function() {
                                // Khởi tạo custom Firebase config nếu có
                                if (result.firebaseConfig) {
                                    localStorage.setItem('pos_firebase_config', JSON.stringify(result.firebaseConfig));
                                    return initWithCustomConfig(result.firebaseConfig).then(function() {
                                        _reinitializeSubscriptions();
                                        currentUser = {
                                            id: 'master_admin',
                                            username: result.user.username,
                                            displayName: result.user.displayName,
                                            role: 'master_admin',
                                            shopId: shopId,
                                            shopCode: posInfo.code,
                                            shopName: posInfo.name || ''
                                        };
                                        localStorage.setItem('pos_session', JSON.stringify(currentUser));
                                        localStorage.setItem('current_shop_id', shopId);
                                        return currentUser;
                                    });
                                } else {
                                    localStorage.removeItem('pos_firebase_config');
                                    return initWithCustomConfig(null).then(function() {
                                        _reinitializeSubscriptions();
                                        currentUser = {
                                            id: 'master_admin',
                                            username: result.user.username,
                                            displayName: result.user.displayName,
                                            role: 'master_admin',
                                            shopId: shopId,
                                            shopCode: posInfo.code,
                                            shopName: posInfo.name || ''
                                        };
                                        localStorage.setItem('pos_session', JSON.stringify(currentUser));
                                        localStorage.setItem('current_shop_id', shopId);
                                        return currentUser;
                                    });
                                }
                            });
                        }
                        
                        // Master admin login không có mã POS → vào Master Control
                        currentUser = {
                            id: 'master_admin',
                            username: result.user.username,
                            displayName: 'Master Admin',
                            role: 'master_admin',
                            shopId: 'master',
                            shopCode: 'master',
                            shopName: 'Master Control'
                        };
                        localStorage.setItem('pos_session', JSON.stringify(currentUser));
                        localStorage.setItem('current_shop_id', 'master');
                        localStorage.removeItem('pos_firebase_config');
                        // Dùng default db
                        initWithCustomConfig(null);
                        return currentUser;
                    }
                    
                    // POS admin login - có thể có custom Firebase config
                    var posInfo = result.posInfo;
                    var shopId = posInfo.shopId || ('shop_' + posInfo.code);
                    
                    // QUAN TRỌNG: Xóa dữ liệu local TRƯỚC khi chuyển sang custom Firebase config
                    // để tránh dữ liệu cũ từ default Firebase bị mix với dữ liệu mới
                    return clearLocalData().then(function() {
                        // Khởi tạo custom Firebase config nếu có
                        if (result.firebaseConfig) {
                            localStorage.setItem('pos_firebase_config', JSON.stringify(result.firebaseConfig));
                            return initWithCustomConfig(result.firebaseConfig).then(function() {
                                _reinitializeSubscriptions();
                                return _completePosLogin(result.user, posInfo, shopId);
                            });
                        } else {
                            localStorage.removeItem('pos_firebase_config');
                            // Dùng default db
                            return initWithCustomConfig(null).then(function() {
                                _reinitializeSubscriptions();
                                return _completePosLogin(result.user, posInfo, shopId);
                            });
                        }
                    });
                }
                // result falsy (null) - không phải master admin, không có trong shop_registry
                // Fallback: login qua shop_registry (tương thích ngược)
                return _legacyLogin(shopCode, username, password);
            }).catch(function(err) {
                // Nếu MASTER_CONFIG bị lỗi HOẶC sai mật khẩu
                // Kiểm tra nếu POS có custom Firebase config thì KHÔNG fallback về legacy
                // vì legacy chỉ đọc từ default Firebase, chắc chắn không có staffs ở đó
                if (err && err.customFirebaseConfig) {
                    throw err;
                }
                // Nếu POS bị khóa, throw luôn không fallback về legacy
                if (err && err.locked) {
                    throw err;
                }
                // Fallback về legacy cho các POS dùng default Firebase
                return _legacyLogin(shopCode, username, password);
            });
        }
        
        // Không có MASTER_CONFIG, dùng legacy login
        return _legacyLogin(shopCode, username, password);
    }
    
    // Login cũ qua shop_registry (giữ để tương thích ngược)
    function _legacyLogin(shopCode, username, password) {
        return db.ref('shop_registry/' + shopCode).once('value').then(function(snapshot) {
            if (!snapshot.exists()) {
                throw new Error('Mã POS không tồn tại');
            }
            var shopInfo = snapshot.val();
            var shopId = shopInfo.shopId;
            
            return db.ref(shopId + '/staffs').once('value').then(function(staffSnapshot) {
                var staffs = staffSnapshot.val() || {};
                var foundStaff = null;
                for (var key in staffs) {
                    if (staffs.hasOwnProperty(key)) {
                        var s = staffs[key];
                        if (s.username === username && s.password === password) {
                            foundStaff = s;
                            foundStaff.id = key;
                            break;
                        }
                    }
                }
                if (!foundStaff) {
                    throw new Error('Sai tên đăng nhập hoặc mật khẩu');
                }
                
                return clearLocalData().then(function() {
                    currentUser = {
                        id: foundStaff.id,
                        username: foundStaff.username,
                        displayName: foundStaff.displayName || foundStaff.username,
                        role: foundStaff.role || 'staff',
                        shopId: shopId,
                        shopCode: shopCode,
                        shopName: shopInfo.shopName || ''
                    };
                    localStorage.setItem('pos_session', JSON.stringify(currentUser));
                    localStorage.removeItem('pos_firebase_config');
                    setShopId(shopId);
                    
                    return currentUser;
                });
            });
        });
    }
    
    // Hoàn tất login POS với thông tin từ master config
    // Lưu ý: clearLocalData() đã được gọi TRƯỚC đó trong login()
    function _completePosLogin(userData, posInfo, shopId) {
        currentUser = {
            id: userData.id || ('staff_' + Date.now().toString(36)),
            username: userData.username,
            displayName: userData.displayName || userData.username,
            role: 'admin',
            shopId: shopId,
            shopCode: posInfo.code,
            shopName: posInfo.name || ''
        };
        localStorage.setItem('pos_session', JSON.stringify(currentUser));
        setShopId(shopId);
        return Promise.resolve(currentUser);
    }
    
    function registerShop(shopName, shopCode, adminUser, adminPass) {
        if (!shopName || !shopCode || !adminUser || !adminPass) {
            return Promise.reject(new Error('Vui lòng nhập đầy đủ thông tin'));
        }
        if (shopCode.length < 3) {
            return Promise.reject(new Error('Mã POS phải có ít nhất 3 ký tự'));
        }
        if (adminPass.length < 4) {
            return Promise.reject(new Error('Mật khẩu phải có ít nhất 4 ký tự'));
        }
        
        return db.ref('shop_registry/' + shopCode).once('value').then(function(snapshot) {
            if (snapshot.exists()) {
                throw new Error('Mã POS này đã được đăng ký');
            }
            
            var shopId = 'shop_' + shopCode.toLowerCase();
            
            var staffId = 'staff_' + Date.now().toString(36);
            var staffData = {
                id: staffId,
                username: adminUser,
                password: adminPass,
                displayName: adminUser,
                role: 'admin',
                createdAt: Date.now(),
                createdBy: 'system'
            };
            
            var registryData = {
                shopId: shopId,
                shopName: shopName,
                shopCode: shopCode,
                adminUser: adminUser,
                adminPass: adminPass,
                role: 'pos_admin',
                createdAt: Date.now()
            };
            
            // Batch write: shop_registry + shop data + staff
            var updates = {};
            updates['shop_registry/' + shopCode] = registryData;
            updates[shopId + '/staffs/' + staffId] = staffData;
            updates[shopId + '/info'] = {
                id: 'shop_config',
                name: shopName,
                code: shopCode,
                createdAt: Date.now()
            };
            
            return db.ref().update(updates).then(function() {
                return clearLocalData();
            }).then(function() {
                currentUser = {
                    id: staffId,
                    username: adminUser,
                    displayName: adminUser,
                    role: 'admin',
                    shopId: shopId,
                    shopCode: shopCode,
                    shopName: shopName
                };
                localStorage.setItem('pos_session', JSON.stringify(currentUser));
                setShopId(shopId);
                return currentUser;
            });
        });
    }
    
    function createStaff(staffData) {
        if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'master_admin')) {
            return Promise.reject(new Error('Chỉ admin mới có thể tạo nhân viên'));
        }
        if (!staffData.username || !staffData.password) {
            return Promise.reject(new Error('Vui lòng nhập tên đăng nhập và mật khẩu'));
        }
        
        var staffId = 'staff_' + Date.now().toString(36);
        var data = {
            id: staffId,
            username: staffData.username,
            password: staffData.password,
            displayName: staffData.displayName || staffData.username,
            role: staffData.role || 'staff',
            createdAt: Date.now(),
            createdBy: currentUser.id
        };
        
        var ref = _getDb().ref(CURRENT_SHOP_ID + '/staffs/' + staffId);
        return ref.set(data).then(function() {
            return saveToLocal('staffs', data);
        }).then(function() {
            return data;
        });
    }
    
    function getStaffs() {
        return getAll('staffs').then(function(localStaffs) {
            if (localStaffs && localStaffs.length > 0) {
                _getDb().ref(CURRENT_SHOP_ID + '/staffs').once('value').then(function(snapshot) {
                    var data = snapshot.val() || {};
                    for (var key in data) {
                        if (data.hasOwnProperty(key)) {
                            var item = data[key];
                            item.id = key;
                            saveToLocal('staffs', item);
                        }
                    }
                }).catch(function() {
                });
                return localStaffs;
            }
            return _getDb().ref(CURRENT_SHOP_ID + '/staffs').once('value').then(function(snapshot) {
                var data = snapshot.val() || {};
                var list = [];
                for (var key in data) {
                    if (data.hasOwnProperty(key)) {
                        var item = data[key];
                        item.id = key;
                        list.push(item);
                    }
                }
                for (var i = 0; i < list.length; i++) {
                    saveToLocal('staffs', list[i]);
                }
                return list;
            }).catch(function() {
                return getAll('staffs');
            });
        });
    }
    
    function logout() {
        currentUser = null;
        localStorage.removeItem('pos_session');
        localStorage.removeItem('pos_firebase_config');
        CURRENT_SHOP_ID = 'shop_default';
        localStorage.setItem('current_shop_id', 'shop_default');
        
        // Dọn dẹp secondary Firebase app nếu có
        if (_secondaryApp) {
            try {
                _secondaryApp.delete();
            } catch(e) {
                console.warn('⚠️ Could not delete secondary Firebase app:', e.message);
            }
            _secondaryApp = null;
            _secondaryDb = null;
        }
        
        console.log('👋 Logged out');
    }
    
    function getCurrentUser() {
        return currentUser;
    }
    
    function isLoggedIn() {
        return currentUser !== null;
    }
    
    function isAdmin() {
        // Luôn trả về boolean thật.
        // Trước đây trả về currentUser && (...) => null khi chưa đăng nhập,
        // khiến các nơi dùng kết quả này để render UI bị "tắt" UI admin
        // trong lúc auth đang resolve lại (token refresh / đổi shop).
        return !!(currentUser && (currentUser.role === 'admin' || currentUser.role === 'master_admin' || currentUser.role === 'pos_admin'));
    }

    // Alias for isAdmin - dùng trong expense.js và các module khác
    function isAdminUser() {
        return isAdmin();
    }

    function getShopConfig() {
        // ƯU TIÊN LOCAL. Đọc IndexedDB trước (nhanh, không mạng) vì hàm này
        // được gọi trong loadData() - nằm trên đường dựng UI. Trước đây nó gọi
        // thẳng Firebase, tức mỗi lần mở app là một vòng mạng chặn màn hình.
        // Chỉ gọi mạng khi local chưa có gì (cài mới / vừa xoá cache).
        // Dữ liệu từ server vẫn tới sau qua listener info (onValue).
        return loadFromLocal('info').then(function(localInfo) {
            var localCfg = null;
            if (localInfo && localInfo.length > 0) {
                localCfg = localInfo[0];
            } else if (memoryCache['info']) {
                for (var k in memoryCache['info']) {
                    if (memoryCache['info'].hasOwnProperty(k)) { localCfg = memoryCache['info'][k]; break; }
                }
            }
            
            // Có dữ liệu local và không cần làm mới gấp -> trả về luôn
            if (localCfg) {
                return localCfg;
            }
            
            if (!isOnline) return {};
            return _getDb().ref(CURRENT_SHOP_ID + '/info').once('value').then(function(snapshot) {
                return snapshot.val() || {};
            }).catch(function() {
                return {};
            });
        }).catch(function() {
            return {};
        });
    }

    function getMemoryCache(collection) {
        if (memoryCache[collection]) {
            var arr = [];
            for (var key in memoryCache[collection]) {
                if (memoryCache[collection].hasOwnProperty(key)) {
                    arr.push(memoryCache[collection][key]);
                }
            }
            return arr.length > 0 ? arr : null;
        }
        return null;
    }

    // Export
    window.DB = {
        init: initDatabase,
        create: create,
        update: update,
        remove: remove,
        get: get,
        getAll: getAll,
        getTransactionsByDate: getTransactionsByDate,
        getTransactionsByDateRange: getTransactionsByDateRange,
        subscribe: subscribeToCollection,
        subscribeWithPolling: subscribeWithPolling,
        // NANG CAP: Event Bus API - Reactive Layer Giai doan 1
        on: function(eventType, callback) { return _on(eventType, callback); },
        off: function(eventType, callback) { _off(eventType, callback); },
        isOnline: function() { return isOnline; },
        getDeviceId: function() { return CURRENT_DEVICE_ID; },
        processSyncQueue: processSyncQueue,
        getSyncQueue: function() { return syncQueue; },
        // Sửa bàn theo kiểu giao dịch nguyên tố - chuẩn POS đa thiết bị.
        // KHÔNG đổi cấu trúc dữ liệu, chỉ thay đổi CÁCH ghi.
        patchTable: patchTable,
        addItemsToTable: addItemsToTable,
        removeItemsFromTable: removeItemsFromTable,
        // Giành bàn để thanh toán khi 2 máy cùng bấm. Không thêm trường nào.
        claimTable: claimTable,
        releaseTableClaim: releaseTableClaim,
        // Khoá chống thao tác trùng lặp (bấm hai lần) cho các hàm ghi tiền.
        // Dùng: if (!DB.acquireBusyLock('ten')) { showToast('...'); return; }
        // và DB.releaseBusyLock('ten') ở MỌI đường thoát.
        acquireBusyLock: acquireBusyLock,
        releaseBusyLock: releaseBusyLock,
        isBusyLocked: isBusyLocked,
        withBusyLock: withBusyLock,
        // Nhật ký xung đột đồng bộ: phần thay đổi đã bị quy tắc bỏ đi.
        // Để chủ quán xem lại và tự quyết định giữ hay bỏ.
        getSyncConflicts: getSyncConflicts,
        resolveSyncConflict: markSyncConflictResolved,
        getSyncPolicy: function(collection) { return _policyFor(collection); },
        // OPTIMIZE: Suppress realtime notifications cho batch operations
        suppressRealtime: function() { _setSuppressRealtime(true); },
        flushRealtime: function() { _setSuppressRealtime(false); },
        getMemoryCache: getMemoryCache,
        // Auth methods
        setShopId: setShopId,
        getShopId: getShopId,
        // Đóng connection IndexedDB local.
        // Bắt buộc cho clearIndexedDB(): nếu app còn giữ connection thì
        // indexedDB.deleteDatabase() bị block vĩnh viễn và cache không bao giờ
        // bị xoá dù UI đã báo "đã xóa".
        closeLocalDB: closeLocalDB,
        login: login,
        registerShop: registerShop,
        createStaff: createStaff,
        getStaffs: getStaffs,
        logout: logout,
        getCurrentUser: getCurrentUser,
        isLoggedIn: isLoggedIn,
        isAdmin: isAdmin,
        isAdminUser: isAdminUser,
        clearLocalData: clearLocalData,
        forceSyncFromFirebase: forceSyncFromFirebase,
        // Đồng bộ nhẹ theo updatedAt: chỉ tải bản ghi thực sự thay đổi.
        // Dùng khi cần "làm mới dữ liệu" mà không muốn tải toàn bộ.
        // Mở app hoặc quay lại tab sẽ tự chạy; gọi tay được khi cần ép làm mới.
        refreshData: quickSyncByTime,
        deltaSyncByTime: deltaSyncByTime,
        reconcileCollection: reconcileCollection,
        ensureCollection: ensureCollection,
        whenSyncComplete: whenSyncComplete,
        // Trạng thái đồng bộ nền: 'idle' | 'syncing' | 'done' | 'error'
        // UI dùng để biết dữ liệu đã được xác nhận từ server hay chưa.
        getSyncState: function() { return _syncState; },
        batchUpdateSortOrder: batchUpdateSortOrder,
        getShopConfig: getShopConfig,
        reconcileSnapshot: reconcileSnapshot,
        getDirtyCollections: function() { return Object.keys(_dirtyCollections); },
        renderOn: function(collection, selector, renderFn) {
            return _renderOn(collection, selector, renderFn);
        },
        ensureRecentDaysData: ensureRecentDaysData,
        // Multi-tenant support
        initWithCustomConfig: initWithCustomConfig,
        _getDb: _getDb,
        reinitializeSubscriptions: _reinitializeSubscriptions,
        // Hàm database gốc (cho master-config.js dùng để luôn truy cập default Firebase)
        _origFirebaseDatabase: _origFirebaseDatabase,
        // PHASE 4: Lazy listener management
        releaseListener: function(collection) { _releaseListener(collection); },
        getActiveListeners: function() {
            var result = {};
            for (var col in _activeListeners) {
                if (_activeListeners.hasOwnProperty(col)) {
                    result[col] = { refCount: _activeListeners[col].refCount };
                }
            }
            return result;
        }
    };

    // Global export cho các module cũ gọi isAdminUser() trực tiếp (expense.js, v.v.)
    window.isAdminUser = isAdminUser;
})();
