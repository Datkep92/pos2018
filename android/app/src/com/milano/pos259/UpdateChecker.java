package com.milano.pos259;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * UpdateChecker - tu tim va tai ban moi tu GitHub Releases.
 *
 * LUUU LUONG:
 *   1. Khi mo app, doc so phien ban trong app -> version_code.json
 *   2. Hoi Git Releases API ban moi nhat
 *   3. So sanh. Co ban moi -> hoi nguoi dung co tai khong
 *   4. Tai APK ve cache, mo man hinh cai dat cua Android
 *   5. Android tu thay the app cu. Du lieu Firebase khong bi anh huong
 *      (du lieu nam tren may chu, khong nam trong APK)
 *
 * AN TOAN: app CHI doc. Khong ghi gi vao Firebase. Khong tu cai dat ma khong
 * hoi - nguoi dung phai bam "Cap nhat".
 */
public class UpdateChecker {

    private static final String REPO = "Datkep92/pos2018";
    private static final String API =
            "https://api.github.com/repos/" + REPO + "/releases/latest";

    private static final String PREF = "pos_update";
    private static final String K_LAST_CHECK = "last_check";
    // 6 gio mot lan - tranh goi API nhieu lan lam can rate limit GitHub
    private static final long CHECK_INTERVAL = 6 * 60 * 60 * 1000L;

    private final Activity act;
    private final Handler main = new Handler(Looper.getMainLooper());

    public UpdateChecker(Activity act) {
        this.act = act;
    }

    // ------------------------------------------------------------------
    /** Doc versionCode hien tai cua app tu file trong APK. */
    public int currentVersion() {
        try {
            InputStream in = act.getAssets().open("version_code.json");
            byte[] b = new byte[512];
            int n = in.read(b);
            in.close();
            JSONObject o = new JSONObject(new String(b, 0, Math.max(n, 0), "UTF-8"));
            return o.getInt("versionCode");
        } catch (Exception e) {
            return 1;
        }
    }

    private long lastCheck() {
        return act.getSharedPreferences(PREF, Context.MODE_PRIVATE).getLong(K_LAST_CHECK, 0);
    }

    private void markChecked() {
        act.getSharedPreferences(PREF, Context.MODE_PRIVATE)
                .edit().putLong(K_LAST_CHECK, System.currentTimeMillis()).apply();
    }

    /** Kiem tra ngay, khong quan tam lan trước. Dung khi bam nut "Cap nhat". */
    public void checkNow() {
        Toast.makeText(act, R.string.upd_checking, Toast.LENGTH_SHORT).show();
        doCheck(true);
    }

    /** Kiem tra tu dong. Chi chay neu lau roi chua check. */
    public void checkAuto() {
        long now = System.currentTimeMillis();
        if (now - lastCheck() < CHECK_INTERVAL) return;
        doCheck(false);
    }

    private void doCheck(boolean manual) {
        final int mine = currentVersion();
        new Thread(new Runnable() {
            @Override
            public void run() {
                final String[] info = fetchLatest();
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        markChecked();
                        if (info == null) {
                            if (manual) {
                                Toast.makeText(act, R.string.upd_failed, Toast.LENGTH_LONG).show();
                            }
                            return;
                        }
                        int latest = parseVersion(info[0]);
                        if (latest > mine) {
                            askUpdate(info[0], latest, info[1]);
                        } else if (manual) {
                            Toast.makeText(act, R.string.upd_none, Toast.LENGTH_SHORT).show();
                        }
                    }
                });
            }
        }).start();
    }

    /**
     * Tra ve [tagName, duong dan APK] cua release moi nhat, hoac null.
     */
    private String[] fetchLatest() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(API).openConnection();
            c.setRequestMethod("GET");
            c.setConnectTimeout(15000);
            c.setReadTimeout(15000);
            c.setRequestProperty("Accept", "application/vnd.github+json");
            c.setRequestProperty("User-Agent", "milano-pos-apk");
            if (c.getResponseCode() != 200) return null;

            InputStream in = new BufferedInputStream(c.getInputStream());
            String json = readAll(in);
            in.close();

            JSONObject root = new JSONObject(json);
            String tag = root.optString("tag_name", "");
            if (tag.isEmpty()) return null;

            // Chon file .apk trong danh sach tai len
            String apkUrl = "";
            org.json.JSONArray assets = root.optJSONArray("assets");
            if (assets != null) {
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject a = assets.optJSONObject(i);
                    if (a == null) continue;
                    String n = a.optString("name", "");
                    if (n.toLowerCase().endsWith(".apk")) {
                        apkUrl = a.optString("browser_download_url", "");
                        break;
                    }
                }
            }
            if (apkUrl.isEmpty()) return null;
            return new String[]{tag, apkUrl};
        } catch (Exception e) {
            return null;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** "v1.2.3" -> 3, "v1.10.0" -> 10, ... */
    static int parseVersion(String tag) {
        try {
            String t = tag.trim();
            if (t.startsWith("v") || t.startsWith("V")) t = t.substring(1);
            String[] parts = t.split("[.\\-]");
            // chi lay phan so dau tien: v1.2.3 -> 1
            return Integer.parseInt(parts[0].trim());
        } catch (Exception e) {
            return 0;
        }
    }

    private void askUpdate(String tag, int version, String url) {
        new AlertDialog.Builder(act)
                .setTitle(R.string.upd_title)
                .setMessage(act.getString(R.string.upd_msg, tag))
                .setCancelable(true)
                .setPositiveButton(R.string.upd_yes, (d, w) -> download(version, url))
                .setNegativeButton(R.string.upd_no, null)
                .show();
    }

    private void download(final int version, final String url) {
        Toast.makeText(act, R.string.upd_downloading, Toast.LENGTH_SHORT).show();
        new Thread(new Runnable() {
            @Override
            public void run() {
                final File f = new File(act.getCacheDir(), "downloads/pos-update.apk");
                boolean ok = fetchFile(url, f);
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        if (!ok) {
                            Toast.makeText(act, R.string.upd_failed, Toast.LENGTH_LONG).show();
                            return;
                        }
                        install(f, version);
                    }
                });
            }
        }).start();
    }

    private boolean fetchFile(String url, File dest) {
        File dir = dest.getParentFile();
        if (dir != null && !dir.exists()) dir.mkdirs();
        // Xoa file cu neu tai lai - tranh file hong
        if (dest.exists()) dest.delete();

        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setInstanceFollowRedirects(true);
            if (c.getResponseCode() != 200) return false;

            InputStream in = new BufferedInputStream(c.getInputStream());
            FileOutputStream out = new FileOutputStream(dest);
            byte[] buf = new byte[8192];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                total += n;
            }
            out.flush();
            out.close();
            in.close();
            return total > 1000;   // APK that > 1KB, nho hon vay la loi
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private void install(File apk, int version) {
        try {
            // Android 8+ yeu cau nguoi dung cho phep app cai dat giup minh
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !act.getPackageManager().canRequestPackageInstalls()) {
                new AlertDialog.Builder(act)
                        .setTitle(R.string.upd_title)
                        .setMessage(R.string.upd_need_permission)
                        .setCancelable(false)
                        .setPositiveButton(R.string.upd_yes, (d, w) -> {
                            Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + act.getPackageName()));
                            act.startActivity(i);
                        })
                        .show();
                return;
            }

            Uri uri = Uri.parse("content://" + ApkProvider.AUTHORITY + "/pos-update.apk");

            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            act.startActivity(i);
        } catch (Exception e) {
            Toast.makeText(act, R.string.upd_no_browser, Toast.LENGTH_LONG).show();
        }
    }

    private static String readAll(InputStream in) throws Exception {
        StringBuilder sb = new StringBuilder();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) sb.append(new String(buf, 0, n, "UTF-8"));
        return sb.toString();
    }
}