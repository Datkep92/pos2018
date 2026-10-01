package com.milano.pos259;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * ApkProvider - tra tep APK vua tai cho man hinh cai dat cua Android.
 *
 * VY SAO TU VIET, KHONG DUNG androidx FileProvider:
 *   Android 7 (API 24) tro len CHAN duong dan file:// cho muc dich chia se
 *   (Uri.fromFile nem FileUriExposedException). Bat buoc phai qua mot
 *   ContentProvider. FileProvider cua androidx lam viec nay nhung keo theo ca
 *   thu vien -> APK nang them vai trăm KB va phai tai ve khi build.
 *   Provider nay lam dung viec do, mot file, khong can thu vien ngoai.
 *
 * AN TOAN: chi doc file nam trong cache/download cua app, ten co dinh.
 * Khong phuc vu gi khac. Grant quyen doc duoc cap trong intent cai dat.
 */
public class ApkProvider extends ContentProvider {

    public static final String AUTHORITY = "com.milano.pos259.apk";

    private File dir;

    @Override
    public boolean onCreate() {
        if (getContext() == null) return false;
        dir = new File(getContext().getCacheDir(), "downloads");
        if (!dir.exists()) dir.mkdirs();
        return true;
    }

    private File resolve(Uri uri) throws FileNotFoundException {
        if (dir == null) throw new FileNotFoundException("chua khoi tao");
        File f = new File(dir, "pos-update.apk");
        if (!f.exists()) throw new FileNotFoundException("khong co file cap nhat");
        return f;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (mode != null && !mode.equals("r")) {
            throw new FileNotFoundException("chi cho phep doc");
        }
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection,
                        String[] selectionArgs, String sortOrder) {
        File f;
        try {
            f = resolve(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor cur = new MatrixCursor(cols, 1);
        cur.addRow(new Object[]{"milano-pos.apk", f.length()});
        return cur;
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override
    public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override
    public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}