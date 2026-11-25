# Pos2018 — hướng dẫn dự án

- Đây là web POS tĩnh. `index.html` chỉ nạp `js.min/` và `css.min/`; sau khi sửa nguồn phải rebuild thì bản chạy mới đổi.
- Node dùng được: `/private/preboot/3AF6782635474BDFDAC1E400BB78A129DC1925AA852AE1AA4D715D48A47FF72420036E56CBC6BD1507653A2FA27357CA/dopamine-nsEG4w/procursus/usr/local/bin/node.real` với `--jitless --no-expose-wasm`. Không dùng `/usr/local/bin/node` (wrapper hỏng).
- Build: chạy lệnh trên với `build.js` trong thư mục dự án.
- Test bản build: `NODE_OPTIONS=--jitless <node.real> --no-expose-wasm test-built.js` (15 file, 478 assertion).
- Test nguồn hay dùng: `test-revenue-match.js`, `test-employee-salary.js`, `test-realtime-regression.js`.
- Kiểm tra khác: `check-strings.js`, `check-compat.js`, và `git -c core.whitespace=cr-at-eol diff --check`.
- File nguồn dùng CRLF; giữ nguyên khi sửa. Không stage `InvoiceXML/`, `Documents/`, `classification.json`.
- Không push khi chưa được yêu cầu.
