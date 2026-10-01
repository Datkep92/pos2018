package com.milano.pos259;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

/**
 * MainActivity - vung WebView nap web app POS tu trong APK.
 *
 * KHONG dung file:// ma dung AssetServer, vi Firebase tu choi origin file://
 * va dang nhap se that bai. Xem giai thich trong AssetServer.java.
 *
 * Tinh nang:
 *   - Nap app tu assets/ trong APK (may POS khong can mang de mo app)
 *   - Tu kiem tra ban moi moi 6 gio, co hop thoai hoi truoc khi tai
 *   - Nut back: lui trong lich su app truoc, khong thoat lung lung
 *   - Lien ket ngoai (Telegram, Zalo...) mo bang trinh duyet he thong
 */
public class MainActivity extends Activity {

    private WebView web;
    private AssetServer assets;
    private UpdateChecker updater;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        assets = new AssetServer(getAssets());
        updater = new UpdateChecker(this);

        FrameLayout root = new FrameLayout(this);
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.setBackgroundColor(Color.WHITE);

        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(Color.parseColor("#f5f7fb"));
        root.addView(web);
        setContentView(root);

        WebSettings s = web.getSettings();
        // App POS can JS + IndexedDB (Firebase Realtime Database cache o local)
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setLoadsImagesAutomatically(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        // Khong cache HTML/CSS/JS: may POS hay bi doi phien ban, cache la nguy
        // nhan thay man hinh cu ma server da sua xong.
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        }

        // Chuyen man hinh duong khong nhat: may POS dat ngang
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            web.getSettings().setLoadWithOverviewMode(true);
            web.getSettings().setUseWideViewPort(true);
        }

        web.addJavascriptInterface(new AppBridge(), "AndroidCapNhat");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                if (assets.handles(req)) return assets.serve(req);
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (assets.handles(req)) return false;   // dung trong app
                // Lien ket ngoai: mo trinh duyet he thong, khong trong WebView
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "Khong mo duoc: " + u.getHost(),
                            Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                view.setVisibility(View.VISIBLE);
            }
        });

        // Cho phep mo tep (anh) tu trong WebView khi can
        web.setWebChromeClient(new android.webkit.WebChromeClient() {
            // Bo loi mixed content + hinh thuong + nhanh phim so
        });

        if (state != null) {
            web.restoreState(state);
        } else {
            web.loadUrl(AssetServer.START_URL);
        }
    }

    /**
     * Cau noi de giao dien POS goi duoc ham cua app.
     *
     * Dung:
     *   <a onclick="AndroidCapNhat.kiemTra()">Cap nhat</a>
     *   var v = AndroidCapNhat.phienBan();   // so phien ban dang chay
     *
     * CHI doc - khong co ham nao ghi du lieu hay goi Firebase.
     */
    public class AppBridge {
        @android.webkit.JavascriptInterface
        public int phienBan() {
            return updater.currentVersion();
        }

        @android.webkit.JavascriptInterface
        public void kiemTra() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    updater.checkNow();
                }
            });
        }

        @android.webkit.JavascriptInterface
        public boolean laBanGoc() {
            return true;   // luon chay tu trong APK
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.onResume();
            web.resumeTimers();
        }
        // Kiem tra ban moi moi khi mo app / quay lai tu man hinh khac
        if (updater != null) updater.checkAuto();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) {
            web.onPause();
            web.pauseTimers();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeAllViews();
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Nut back: lui trong app truoc, khong vong lap ve login
        if (keyCode == KeyEvent.KEYCODE_BACK && web != null && web.canGoBack()) {
            web.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }
}