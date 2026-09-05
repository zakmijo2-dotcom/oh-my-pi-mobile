package com.oh_my_pi.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.util.Base64;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * oh-my-pi Mobile: Real Native Android Bridge
 *
 * Exposes authentic Android platform capabilities to the webview:
 * - Real sandboxed filesystem operations
 * - Encrypted credential vault backed by Android Keystore
 * - Sandboxed process execution via ProcessBuilder
 * - Real Git CLI commands via host git
 * - Detailed capability reporting
 */
public class OmpCoreBridge {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "OmpCredentialVaultKey";
    private static final String PREF_VAULT_FILE = "omp_secure_vault";
    private static final int GCM_TAG_LENGTH = 128;
    private static final int GCM_IV_LENGTH = 12;

    private final Context mContext;
    private final File mWorkspaceDir;
    private final SharedPreferences mSecurePrefs;
    private SecretKey mCachedSecretKey;

    public OmpCoreBridge(Context context) {
        this(new File(context.getFilesDir(), "workspace"),
             context.getCacheDir(),
             context.getSharedPreferences(PREF_VAULT_FILE, Context.MODE_PRIVATE),
             context);
    }

    public OmpCoreBridge(File workspaceDir, File cacheDir, SharedPreferences prefs, Context context) {
        this.mContext = context;
        this.mWorkspaceDir = workspaceDir != null ? workspaceDir : new File("/tmp/workspace");
        if (!this.mWorkspaceDir.exists()) {
            this.mWorkspaceDir.mkdirs();
        }
        this.mSecurePrefs = prefs;
        initKeystore();
    }

    // =========================================================================
    // 1. Filesystem Operations (Scoped to Sandboxed Workspace)
    // =========================================================================

    private File resolvePath(String path) {
        if (path == null || path.trim().isEmpty() || path.equals(".")) {
            return mWorkspaceDir;
        }
        String clean = path.replace("\\", "/");
        if (clean.startsWith("/")) {
            clean = clean.substring(1);
        }
        // Normalize and guard against directory traversal
        File target = new File(mWorkspaceDir, clean);
        try {
            String canonicalTarget = target.getCanonicalPath();
            String canonicalWorkspace = mWorkspaceDir.getCanonicalPath();
            if (!canonicalTarget.startsWith(canonicalWorkspace)) {
                // Traversal attempt caught; clamp to workspace root
                return mWorkspaceDir;
            }
            return target;
        } catch (IOException e) {
            return target;
        }
    }

    @JavascriptInterface
    public String getWorkspacePath() {
        return mWorkspaceDir.getAbsolutePath();
    }

    @JavascriptInterface
    public boolean exists(String path) {
        File file = resolvePath(path);
        return file.exists();
    }

    @JavascriptInterface
    public String readFile(String path) {
        File file = resolvePath(path);
        if (!file.exists() || !file.isFile()) {
            return null;
        }
        try (FileInputStream fis = new FileInputStream(file);
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = fis.read(buf)) != -1) {
                baos.write(buf, 0, n);
            }
            return baos.toString("UTF-8");
        } catch (Exception e) {
            log("readFile error: " + e.getMessage());
            return null;
        }
    }

    @JavascriptInterface
    public boolean writeFile(String path, String content) {
        File file = resolvePath(path);
        File parent = file.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
        try (FileOutputStream fos = new FileOutputStream(file)) {
            byte[] bytes = (content != null ? content : "").getBytes(StandardCharsets.UTF_8);
            fos.write(bytes);
            fos.flush();
            return true;
        } catch (Exception e) {
            log("writeFile error: " + e.getMessage());
            return false;
        }
    }

    @JavascriptInterface
    public boolean mkdir(String path) {
        File dir = resolvePath(path);
        return dir.mkdirs() || dir.isDirectory();
    }

    @JavascriptInterface
    public boolean delete(String path) {
        File target = resolvePath(path);
        if (!target.exists()) {
            return false;
        }
        return deleteRecursively(target);
    }

    private boolean deleteRecursively(File fileOrDir) {
        if (fileOrDir.isDirectory()) {
            File[] children = fileOrDir.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        return fileOrDir.delete();
    }

    @JavascriptInterface
    public boolean move(String srcPath, String dstPath) {
        File src = resolvePath(srcPath);
        File dst = resolvePath(dstPath);
        if (!src.exists()) return false;
        File parent = dst.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
        return src.renameTo(dst);
    }

    @JavascriptInterface
    public boolean copy(String srcPath, String dstPath) {
        File src = resolvePath(srcPath);
        File dst = resolvePath(dstPath);
        if (!src.exists() || !src.isFile()) return false;
        File parent = dst.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
        try (FileInputStream in = new FileInputStream(src);
             FileOutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[8192];
            int len;
            while ((len = in.read(buf)) > 0) {
                out.write(buf, 0, len);
            }
            return true;
        } catch (Exception e) {
            log("copy error: " + e.getMessage());
            return false;
        }
    }

    @JavascriptInterface
    public String listDir(String path) {
        File dir = resolvePath(path);
        if (!dir.exists() || !dir.isDirectory()) {
            return "[]";
        }
        File[] files = dir.listFiles();
        if (files == null) {
            return "[]";
        }

        JSONArray array = new JSONArray();
        for (File f : files) {
            try {
                JSONObject obj = new JSONObject();
                obj.put("name", f.getName());
                obj.put("isDirectory", f.isDirectory());
                obj.put("size", f.isDirectory() ? 0 : f.length());
                obj.put("mtime", f.lastModified());
                array.put(obj);
            } catch (JSONException ignored) {}
        }
        return array.toString();
    }

    @JavascriptInterface
    public String stat(String path) {
        File target = resolvePath(path);
        if (!target.exists()) {
            return null;
        }
        try {
            JSONObject obj = new JSONObject();
            obj.put("path", path);
            obj.put("exists", true);
            obj.put("isDirectory", target.isDirectory());
            obj.put("isFile", target.isFile());
            obj.put("size", target.length());
            obj.put("mtime", target.lastModified());
            obj.put("canRead", target.canRead());
            obj.put("canWrite", target.canWrite());
            return obj.toString();
        } catch (JSONException e) {
            return null;
        }
    }

    // =========================================================================
    // 2. Encrypted Keystore Credential Storage
    // =========================================================================

    private void initKeystore() {
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);
            if (!keyStore.containsAlias(KEY_ALIAS)) {
                KeyGenerator keyGenerator = KeyGenerator.getInstance(
                        KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
                KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                        KEY_ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256)
                        .build();
                keyGenerator.init(spec);
                mCachedSecretKey = keyGenerator.generateKey();
            } else {
                KeyStore.SecretKeyEntry entry = (KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null);
                if (entry != null) {
                    mCachedSecretKey = entry.getSecretKey();
                }
            }
        } catch (Exception e) {
            log("Keystore init notice (falling back to obfuscated store): " + e.getMessage());
        }
    }

    @JavascriptInterface
    public boolean setSecureValue(String key, String value) {
        if (key == null) return false;
        if (value == null) {
            return deleteSecureValue(key);
        }
        try {
            if (mCachedSecretKey != null) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, mCachedSecretKey);
                byte[] iv = cipher.getIV();
                byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));

                JSONObject encryptedObj = new JSONObject();
                encryptedObj.put("iv", Base64.getEncoder().encodeToString(iv));
                encryptedObj.put("ct", Base64.getEncoder().encodeToString(ciphertext));
                encryptedObj.put("alg", "AES_GCM_256");

                mSecurePrefs.edit().putString(key, encryptedObj.toString()).apply();
                return true;
            } else {
                // Fallback store
                String encoded = Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
                mSecurePrefs.edit().putString(key, "b64:" + encoded).apply();
                return true;
            }
        } catch (Exception e) {
            log("setSecureValue error: " + e.getMessage());
            return false;
        }
    }

    @JavascriptInterface
    public String getSecureValue(String key) {
        if (key == null) return null;
        String raw = mSecurePrefs.getString(key, null);
        if (raw == null) return null;

        try {
            if (raw.startsWith("b64:")) {
                byte[] decoded = Base64.getDecoder().decode(raw.substring(4));
                return new String(decoded, StandardCharsets.UTF_8);
            }

            JSONObject json = new JSONObject(raw);
            byte[] iv = Base64.getDecoder().decode(json.getString("iv"));
            byte[] ct = Base64.getDecoder().decode(json.getString("ct"));

            if (mCachedSecretKey != null) {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                GCMParameterSpec spec = new GCMParameterSpec(GCM_TAG_LENGTH, iv);
                cipher.init(Cipher.DECRYPT_MODE, mCachedSecretKey, spec);
                byte[] plaintext = cipher.doFinal(ct);
                return new String(plaintext, StandardCharsets.UTF_8);
            }
            return null;
        } catch (Exception e) {
            log("getSecureValue error: " + e.getMessage());
            return null;
        }
    }

    @JavascriptInterface
    public boolean deleteSecureValue(String key) {
        if (key == null) return false;
        mSecurePrefs.edit().remove(key).apply();
        return true;
    }

    // =========================================================================
    // 3. Sandboxed Process Execution (ProcessBuilder)
    // =========================================================================

    @JavascriptInterface
    public String execCommand(String cmd, String argsJson, String cwdRel, int timeoutMs) {
        JSONObject result = new JSONObject();
        int timeout = timeoutMs > 0 ? timeoutMs : 30000;

        List<String> commandList = new ArrayList<>();
        commandList.add(cmd);

        if (argsJson != null && !argsJson.trim().isEmpty()) {
            try {
                JSONArray arr = new JSONArray(argsJson);
                for (int i = 0; i < arr.length(); i++) {
                    commandList.add(arr.getString(i));
                }
            } catch (JSONException e) {
                log("argsJson parse error: " + e.getMessage());
            }
        }

        File workDir = resolvePath(cwdRel);
        ProcessBuilder pb = new ProcessBuilder(commandList);
        pb.directory(workDir);
        pb.redirectErrorStream(false);

        // Inherit path and set safe mobile environment variables
        String currentPath = System.getenv("PATH");
        if (currentPath == null) currentPath = "/system/bin:/system/xbin";
        // Check for Termux bin paths if running on device
        if (new File("/data/data/com.termux/files/usr/bin").exists()) {
            currentPath = "/data/data/com.termux/files/usr/bin:" + currentPath;
        }
        pb.environment().put("PATH", currentPath);
        pb.environment().put("HOME", mWorkspaceDir.getAbsolutePath());
        String tmpDir = (mContext != null && mContext.getCacheDir() != null) ? mContext.getCacheDir().getAbsolutePath() : System.getProperty("java.io.tmpdir", "/tmp");
        pb.environment().put("TMPDIR", tmpDir);

        Process process = null;
        try {
            process = pb.start();

            StreamCollector stdoutCollector = new StreamCollector(process.getInputStream());
            StreamCollector stderrCollector = new StreamCollector(process.getErrorStream());
            stdoutCollector.start();
            stderrCollector.start();

            boolean finished = process.waitFor(timeout, TimeUnit.MILLISECONDS);
            if (!finished) {
                process.destroy();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    process.destroyForcibly();
                }
                result.put("exitCode", -1);
                result.put("stdout", stdoutCollector.getOutput());
                result.put("stderr", stderrCollector.getOutput() + "\n[Process timed out after " + timeout + "ms]");
                result.put("timedOut", true);
                return result.toString();
            }

            stdoutCollector.join(1000);
            stderrCollector.join(1000);

            result.put("exitCode", process.exitValue());
            result.put("stdout", stdoutCollector.getOutput());
            result.put("stderr", stderrCollector.getOutput());
            result.put("timedOut", false);
            return result.toString();

        } catch (Exception e) {
            try {
                result.put("exitCode", 127);
                result.put("stdout", "");
                result.put("stderr", "Execution error: " + e.getMessage());
                result.put("timedOut", false);
            } catch (JSONException ignored) {}
            return result.toString();
        } finally {
            if (process != null) {
                process.destroy();
            }
        }
    }

    // =========================================================================
    // 4. Real Git Execution
    // =========================================================================

    @JavascriptInterface
    public String gitCommand(String argsJson, String cwdRel) {
        String gitBinary = findGitBinary();
        if (gitBinary == null) {
            JSONObject err = new JSONObject();
            try {
                err.put("exitCode", 127);
                err.put("stdout", "");
                err.put("stderr", "git binary not found in system or app environment");
                err.put("timedOut", false);
            } catch (JSONException ignored) {}
            return err.toString();
        }

        return execCommand(gitBinary, argsJson, cwdRel, 60000);
    }

    private String findGitBinary() {
        String[] candidates = {
            "/data/data/com.termux/files/usr/bin/git",
            "/system/bin/git",
            "/system/xbin/git"
        };
        for (String c : candidates) {
            File f = new File(c);
            if (f.exists() && f.canExecute()) {
                return c;
            }
        }
        return "git"; // Fallback to PATH search
    }

    // =========================================================================
    // 5. Diagnostics, Capabilities & Logging
    // =========================================================================

    @JavascriptInterface
    public String isNativeBridgeReady() {
        JSONObject caps = new JSONObject();
        try {
            caps.put("ready", true);
            caps.put("version", "2.0.0");
            caps.put("fs", true);
            caps.put("keystore", mCachedSecretKey != null);
            caps.put("process", true);
            caps.put("git", findGitBinary() != null);
            caps.put("workspacePath", mWorkspaceDir.getAbsolutePath());
            caps.put("deviceModel", getDeviceModel());
        } catch (JSONException ignored) {}
        return caps.toString();
    }

    @JavascriptInterface
    public String getDeviceModel() {
        return Build.MANUFACTURER + " " + Build.MODEL + " (Android " + Build.VERSION.RELEASE + ", API " + Build.VERSION.SDK_INT + ")";
    }

    @JavascriptInterface
    public void showToast(String message) {
        if (message != null && !message.isEmpty()) {
            Toast.makeText(mContext, message, Toast.LENGTH_SHORT).show();
        }
    }

    @JavascriptInterface
    public void log(String message) {
        System.out.println("[OMP-Native] " + message);
    }

    // --- Helper Thread to collect stream output without blocking ---
    private static class StreamCollector extends Thread {
        private final InputStream is;
        private final StringBuilder sb = new StringBuilder();

        StreamCollector(InputStream is) {
            this.is = is;
        }

        @Override
        public void run() {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (sb.length() > 0) sb.append("\n");
                    sb.append(line);
                }
            } catch (IOException ignored) {}
        }

        public String getOutput() {
            return sb.toString();
        }
    }
}
