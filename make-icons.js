// Sinh icon PNG cho launcher.
// VY SAO PHAI LAM: manifest dang tro toi res/drawable/ic_launcher.xml (vector).
// Nhung launcher tren may POS cu (Android 6) KHONG render duoc vector cho icon
// - se hien mot o vuong hoac trong. PNG thi moi may nao cung hien duoc.
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var OUT = path.join(__dirname, 'android', 'app', 'res');
var DENSITIES = [
    ['mipmap-mdpi', 48],
    ['mipmap-hdpi', 72],
    ['mipmap-xhdpi', 96],
    ['mipmap-xxhdpi', 144],
    ['mipmap-xxxhdpi', 192]
];

var ORANGE = [0xf9, 0x73, 0x16];
var WHITE = [0xff, 0xff, 0xff];

// ---------------------------------------------------------------- PNG
function crc32(buf) {
    var c, crc = 0xffffffff;
    for (var n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    var len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    var t = Buffer.from(type, 'ascii');
    var body = Buffer.concat([t, data]);
    var crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
}
function png(width, height, rgba) {
    var raw = Buffer.alloc(height * (1 + width * 4));
    var p = 0;
    for (var y = 0; y < height; y++) {
        raw[p++] = 0;                       // filter: none
        for (var x = 0; x < width; x++) {
            var i = (y * width + x) * 4;
            raw[p++] = rgba[i]; raw[p++] = rgba[i + 1];
            raw[p++] = rgba[i + 2]; raw[p++] = rgba[i + 3];
        }
    }
    var ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

// ---------------------------------------------------------------- ve
function render(S) {
    var px = Buffer.alloc(S * S * 4);
    var r = S * 0.22;                    // bo goc tron
    function put(x, y, c, a) {
        if (x < 0 || y < 0 || x >= S || y >= S) return;
        var i = (y * S + x) * 4;
        if (a >= 1) { px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
        else { px[i + 3] = Math.max(px[i + 3], Math.round(255 * a)); }
    }
    // nen bo goc tron
    for (var y = 0; y < S; y++) {
        for (var x = 0; x < S; x++) {
            var dx = 0, dy = 0;
            if (x < r) dx = r - x; else if (x > S - 1 - r) dx = x - (S - 1 - r);
            if (y < r) dy = r - y; else if (y > S - 1 - r) dy = y - (S - 1 - r);
            var d = Math.sqrt(dx * dx + dy * dy);
            var a = d <= r ? 1 : (d <= r + 1 ? r + 1 - d : 0);
            put(x, y, ORANGE, a);
        }
    }

    // Chu "M" - ve bang 4 net to
    var t = Math.max(2, Math.round(S * 0.13));    // do day net
    var l = Math.round(S * 0.28), rr = Math.round(S * 0.72);
    var top = Math.round(S * 0.30), bot = Math.round(S * 0.72);
    var midX = Math.round((l + rr) / 2), midY = Math.round(S * 0.60);

    function vline(x0, y0, y1, c) {
        for (var y = y0; y <= y1; y++) for (var x = x0; x < x0 + t; x++) put(x, y, c, 1);
    }
    function dline(x0, y0, x1, y1, c) {
        var steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
        for (var s = 0; s <= steps; s++) {
            var x = Math.round(x0 + (x1 - x0) * s / steps);
            var y = Math.round(y0 + (y1 - y0) * s / steps);
            for (var oy = 0; oy < t; oy++) for (var ox = 0; ox < t; ox++) put(x + ox, y + oy, c, 1);
        }
    }
    vline(l, top, bot, WHITE);
    vline(rr - t, top, bot, WHITE);
    dline(l, top, midX, midY, WHITE);
    dline(rr - t, top, midX, midY, WHITE);

    return png(S, S, px);
}

// ---------------------------------------------------------------- chay
var made = 0;
for (var i = 0; i < DENSITIES.length; i++) {
    var dir = path.join(OUT, DENSITIES[i][0]);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    var S = DENSITIES[i][1];
    var buf = render(S);
    fs.writeFileSync(path.join(dir, 'ic_launcher.png'), buf);
    made++;
    console.log('  ' + DENSITIES[i][0] + '/ic_launcher.png  ' + S + 'x' + S + '  ' + Math.round(buf.length / 1024 * 10) / 10 + ' KB');
}
console.log('');
console.log('Da tao ' + made + ' icon PNG.');