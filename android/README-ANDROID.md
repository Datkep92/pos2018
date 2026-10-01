# MILANO COFFEE 259 — Gói APK Android và tự cập nhật

Ghi chú kỹ thuật về cách đóng gói web app thành app Android, và cách máy POS
tự tìm bản mới.

---

## 1. Vì sao app nạp bằng domain giả, không dùng `file://`

APK có toàn bộ web app nằm trong `assets/`. Nhưng **không** nạp bằng `file://`:

> Firebase Authentication và Realtime Database **từ chối** origin `file://`.
> Nạp kiểu đó thì đăng nhập sẽ báo lỗi, app không dùng được.

Cách chuẩn của Android WebView: dùng một domain HTTPS giả rồi chặn request,
phục vụ file từ trong APK. Domain dùng ở đây:

```
https://appassets.androidplatform.net/assets/index.html
```

Code nằm ở `app/src/com/milano/pos259/AssetServer.java`.

Hệ quả: **toàn bộ đường dẫn bên trong `index.html` phải là đường dẫn tương đối**
(`css.min/...`, `js.min/...`) — không được dùng đường dẫn tuyệt đối bắt đầu
bằng `/`, vì request sẽ thoát khỏi domain giả.

---

## 2. Cấu trúc

```
android/
  app/
    AndroidManifest.xml
    res/values/strings.xml          các chuỗi hiển thị
    res/values/styles.xml
    res/xml/file_paths.xml
    res/mipmap-*/ic_launcher.png    icon cho launcher
    src/com/milano/pos259/
      MainActivity.java             WebView + nút back + mở link ngoài
      AssetServer.java              phục vụ file từ APK
      UpdateChecker.java            tìm & tải bản mới từ GitHub
      ApkProvider.java              tra file APK cho hệ thống cài đặt
  keystore/pos259.jks               KHÓA KÝ — KHÔNG ĐƯỢC MẤT
  build-config.json                 tên, mã phiên bản, minSdk/targetSdk
  build-apk.ps1                     build APK
  publish-release.ps1               build + đẩy lên GitHub Releases
```

---

## 3. Đồng bộ web app vào APK

`build-apk.ps1` lấy nội dung từ `js.min/` và `css.min/`. Đây là các bản build,
**không phải** file nguồn. Nên quy trình đầy đủ là:

```powershell
cd pos2018
node build.js                              # 1. nguồn -> js.min/ + css.min/
powershell -File android\build-apk.ps1     # 2. -> APK
```

Bỏ bước 1 thì APK sẽ chứa code cũ.

---

## 4. Build APK

```powershell
powershell -File android\build-apk.ps1
powershell -File android\build-apk.ps1 -VersionCode 2 -VersionName "1.1.0"
```

Kết quả: `pos2018/dist/milano-pos-<phiên bản>.apk`

Script **không cần Gradle**. Nó gọi thẳng `aapt2`, `javac`, `d8`, `zipalign`,
`apksigner` từ Android SDK + JDK. Nhanh hơn và không tải gì thêm.

Cần có: Android SDK (`ANDROID_HOME` hoặc `%LOCALAPPDATA%\Android\Sdk`) và
JDK. Script tự tìm JDK trong Android Studio nếu `JAVA_HOME` chưa đặt.

### Ba lỗi đã gặp khi làm script build — đừng làm lại

| Lỗi | Nguyên nhân |
|---|---|
| `resource ... does not override an existing resource` | Truyền tài nguyên đã biên dịch bằng `-R`. Phải truyền ở **vị trí đối số cuối**; `-R` nghĩa là overlay. |
| `unknown option '-f'` khi `aapt2 add` | build-tools 37 đã **xoá** lệnh `add`. APK vẫn là file zip — nêm bằng `ZipFile` của .NET. |
| Tài nguyên đóng gói sai đường dẫn | `aapt2 -A` trên Windows tạo `assets\js.min\db.min.js` (gạch ngược). Android chỉ đọc `assets/js.min/db.min.js`. Phải nêm thủ công bằng đường dẫn dấu gạch xuống. |

---

## 5. Cơ chế tự cập nhật

### Luồng

```
Máy POS mở app
   └─ đọc version_code.json trong APK      → biết đang chạy bản nào
   └─ (mỗi 6 giờ) hỏi GitHub Releases API  → https://api.github.com/repos/Datkep92/pos2018/releases/latest
        └─ so sánh versionCode
             └─ có bản mới → hộp thoại "Có bản cập nhật mới"
                  └─ người dùng bấm "Cập nhật"
                       └─ tải .apk về cache
                       └─ mở màn hình cài đặt của Android
                            └─ Android tự thay app
```

### Phát hành

```powershell
powershell -File android\publish-release.ps1 -VersionCode 2 -VersionName "1.1.0" -Note "Sửa lỗi tính tiền"
```

**Bắt buộc `versionCode` mới phải LỚN HƠN bản đang có.** Máy POS so sánh
`versionCode`, nên phát hành bản nhỏ hơn sẽ không máy nào nhận được — và người
dùng sẽ ở mãi trên bản cũ. Script tự chặn trường hợp này.

### Gọi kiểm tra cập nhật thủ công

Từ giao diện POS:

```js
AndroidCapNhat.kiemTra();          // kiểm tra ngay
AndroidCapNhat.phienBan();         // số versionCode đang chạy
```

### Quyền cần cấp lần đầu

Android 8+ yêu cầu người dùng cho phép app cài đặt giúp mình. Ở lần cập nhật
đầu tiên app sẽ tự mở màn hình cài đặt để bạn bật quyền này.

### Repo phải public

`UpdateChecker` gọi GitHub API **không kèm token**. Repo private thì API trả
404 và máy POS sẽ không tìm thấy bản mới.

---

## 6. Về khoá ký

`android/keystore/pos259.jks` — sinh tự động lần build đầu.

| | |
|---|---|
| alias | `pos259` |
| mật khẩu | `milanopos259` |
| hạn | 30 năm |

**Sao lưu file này ra ngoài repo ngay.** Mất file thì không ký được bản cập
nhật nữa, và mọi máy POS sẽ từ chối bản mới vì chữ ký không khớp. Google Play
cũng không cho phép đổi khoá sau lần phát hành đầu.

---

## 7. Tương thích WebView cũ — đã đo, chưa xử lý hết

Máy POS dùng Android 6/7 thường có WebView rất cũ (Chrome 44–53, có máy đóng
băng từ năm 2016 và không cập nhật được). Đã kiểm tra trên emulator Android 7
với WebView **Chrome 53**:

| Vấn đề | Trạng thái |
|---|---|
| `?.` toán tử optional chaining trong `employees.js` (23 chỗ) | **Đã sửa** → app trước đó **không chạy được** file này trên WebView cũ |
| `String.padStart` (37 chỗ trong file đang chạy) | **Đã sửa** bằng polyfill ở đầu `db.js` |
| `Array.includes`, `Object.entries/values` | **Đã sửa** bằng polyfill |
| **Firebase JS SDK 9.6.10** | **CHƯA XỬ LÝ** |

### Về Firebase

Firebase SDK 9.6.10 báo lỗi cú pháp trên WebView 53:
`Uncaught SyntaxError: Unexpected token delete`, kéo theo
`firebase is not defined` và app không kết nối được database.

Đã kiểm tra nội dung file `firebase-app-compat.js` 9.6.10: chỉ dùng `arrow
function`, `class`, `const`, `let`, spread — tất cả Chrome 53 đều hỗ trợ. Lỗi
nhiều khả năng do WebView quá cũ chứ không phải cú pháp.

Hai hướng xử lý:

1. **Cập nhật Android System WebView trên máy POS** (qua Play Store). Cách
   đúng nhất — WebView là do Google phát hành, cập nhật được là bình thường.
   Sau khi cập nhật, Firebase 9.6.10 chạy tốt.
2. **Ghim Firebase bản 8.x** và đóng gói vào APK (không gọi CDN). Bản 8.x nhắm
   tới trình duyệt cũ hơn. Rủi ro thấp vì app chỉ dùng API ổn định
   (`initializeApp`, `database()`, `ref`, `push`, `update`, `set`,
   `transaction`, `orderByChild`, `once`) — API này giống nhau ở v8 và v9.

Chưa chọn hướng nào vì cần biết máy POS thật đang chạy Android mấy. Cần phải
sửa `index.html` và kiểm tra lại trên emulator.

---

## 8. Cách kiểm tra trên máy thật

```powershell
# emulator
adb install -r pos2018\dist\milano-pos-1.0.0.apk
adb shell am start -n com.milano.pos259/.MainActivity
adb logcat | Select-String CONSOLE
```

Đã chạy thử trên emulator Android 7 (API 24), WebView Chrome 53:
app cài được, mở được, phục vụ đúng file từ `assets/`, `employees.js` nạp xong,
chữ ký APK hợp lệ (v1 + v2 + v3).

Chưa kiểm tra được phần cập nhật thật vì chưa có GitHub Release nào.