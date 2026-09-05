package com.oh_my_pi.mobile;

import android.content.Context;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

public class OmpCoreBridge {
    private final Context mContext;

    public OmpCoreBridge(Context context) {
        this.mContext = context;
    }

    @JavascriptInterface
    public void log(String message) {
        System.out.println("[OMP-Core] " + message);
    }

    @JavascriptInterface
    public void showToast(String message) {
        Toast.makeText(mContext, message, Toast.LENGTH_SHORT).show();
    }

    @JavascriptInterface
    public String getDeviceModel() {
        return Build.MANUFACTURER + " " + Build.MODEL + " (Android " + Build.VERSION.RELEASE + ")";
    }

    @JavascriptInterface
    public boolean isNativeBridgeReady() {
        return true;
    }
}
