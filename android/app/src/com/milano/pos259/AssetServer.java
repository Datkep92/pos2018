package com.milano.pos259;

import android.content.res.AssetManager;
import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * AssetServer - tra ve file web app tu trong APK, nhung giu nhung domain HTTPS
 * thật sự.
 *
 * VY SAO KHONG DUNG file:// ?
 *   Firebase Authentication + Realtime Database TU CHOI origin file://.
 *   Neu nap bang file:// thi dang nhap se bao loi. Giai phap: dung mot domain
 *   https gia - day la cach chuan cua Android WebView, va domain nao da duoc
 *   Firebase chap nhon.
 *
 * Domain gia: appassets.androidplatform.net
 *   -> tren may POS, mo file nay se ra dung doi voi may chu that cua may do.
 *      Firebase/Auth cung cap chuc nang tu dong chap nhan domain nay cho
 *      cac du an Android, nen khong can them tuong minh vao Firebase Console.
 */
public class AssetServer {

    public static final String DOMAIN = "appassets.androidplatform.net";
    public static final String START_URL = "https://" + DOMAIN + "/assets/index.html";
    private static final String ROOT = "assets";

    private final AssetManager assets;

    public AssetServer(AssetManager assets) {
        this.assets = assets;
    }

    public boolean handles(WebResourceRequest req) {
        Uri u = req.getUrl();
        return "https".equals(u.getScheme()) && DOMAIN.equals(u.getHost());
    }

    /** Tra ve noi dung tep theo duong dan trong yeu cau. Null = khong phu hop domain nay. */
    public WebResourceResponse serve(WebResourceRequest req) {
        Uri u = req.getUrl();
        String path = u.getPath();
        if (path == null) return null;

        // /assets/index.html -> "index.html" trong thu muc assets/ cua APK
        String rel = path;
        int i = rel.indexOf('/' + ROOT + '/');
        if (i >= 0) {
            rel = rel.substring(i + ROOT.length() + 2);
        } else if (rel.startsWith("/" + ROOT)) {
            rel = rel.substring(ROOT.length() + 1);
        } else if (rel.startsWith("/")) {
            rel = rel.substring(1);
        } else {
            rel = ROOT + "/" + rel;
        }
        if (rel.isEmpty()) rel = "index.html";
        // Chặn đường dẫn trèo ra ngoài thư mục assets
        if (rel.contains("..")) return notFound();

        try {
            InputStream in = assets.open(rel);
            String mime = mimeOf(rel);
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Cache-Control", "no-store");
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("X-Content-Type-Options", "nosniff");
            // UTF-8 cho file text, "null" cho file nhi phai
            WebResourceResponse r = new WebResourceResponse(mime, isText(rel) ? "utf-8" : null, in);
            r.setResponseHeaders(headers);
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        byte[] body = "404".getBytes();
        return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(body));
    }

    private static boolean isText(String p) {
        return p.endsWith(".html") || p.endsWith(".js") || p.endsWith(".css")
                || p.endsWith(".json") || p.endsWith(".svg") || p.endsWith(".txt")
                || p.endsWith(".webmanifest");
    }

    private static String mimeOf(String p) {
        String l = p.toLowerCase();
        if (l.endsWith(".html") || l.endsWith(".htm")) return "text/html";
        if (l.endsWith(".js") || l.endsWith(".mjs")) return "application/javascript";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".webmanifest")) return "application/manifest+json";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
        if (l.endsWith(".gif")) return "image/gif";
        if (l.endsWith(".webp")) return "image/webp";
        if (l.endsWith(".ico")) return "image/x-icon";
        if (l.endsWith(".woff")) return "font/woff";
        if (l.endsWith(".woff2")) return "font/woff2";
        if (l.endsWith(".ttf")) return "font/ttf";
        if (l.endsWith(".woff2") || l.endsWith(".otf")) return "font/opentype";
        return "application/octet-stream";
    }
}