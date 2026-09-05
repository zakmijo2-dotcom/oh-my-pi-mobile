package com.oh_my_pi.mobile.test;

import com.oh_my_pi.mobile.OmpCoreBridge;
import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;

/**
 * On-Device Java Test Runner for OmpCoreBridge
 * Verifies all native bridge methods on real Android filesystem and process environment.
 */
public class BridgeNativeTest {
    public static void main(String[] args) throws Exception {
        System.out.println("=== Running OmpCoreBridge Native On-Device Tests ===");

        // Create mock Context backed by real on-disk temp directories
        File testDir = new File(System.getProperty("java.io.tmpdir", "/tmp"), "omp_bridge_test_" + System.currentTimeMillis());
        testDir.mkdirs();
        File cacheDir = new File(testDir, "cache");
        cacheDir.mkdirs();

        final Map<String, String> prefsMap = new HashMap<>();

        SharedPreferences prefsProxy = (SharedPreferences) Proxy.newProxyInstance(
            SharedPreferences.class.getClassLoader(),
            new Class<?>[]{SharedPreferences.class},
            new InvocationHandler() {
                @Override
                public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
                    String name = method.getName();
                    if ("getString".equals(name)) {
                        String val = prefsMap.get(args[0]);
                        return val != null ? val : args[1];
                    }
                    if ("edit".equals(name)) {
                        return Proxy.newProxyInstance(
                            SharedPreferences.Editor.class.getClassLoader(),
                            new Class<?>[]{SharedPreferences.Editor.class},
                            new InvocationHandler() {
                                @Override
                                public Object invoke(Object ep, Method em, Object[] ea) throws Throwable {
                                    String emName = em.getName();
                                    if ("putString".equals(emName)) {
                                        prefsMap.put((String) ea[0], (String) ea[1]);
                                        return ep;
                                    }
                                    if ("remove".equals(emName)) {
                                        prefsMap.remove((String) ea[0]);
                                        return ep;
                                    }
                                    if ("apply".equals(emName) || "commit".equals(emName)) {
                                        return Boolean.TRUE;
                                    }
                                    return ep;
                                }
                            }
                        );
                    }
                    return null;
                }
            }
        );

        OmpCoreBridge bridge = new OmpCoreBridge(testDir, cacheDir, prefsProxy, null);

        // 1. Verify capability descriptor
        String readyJson = bridge.isNativeBridgeReady();
        System.out.println("Capabilities: " + readyJson);
        JSONObject caps = new JSONObject(readyJson);
        assert caps.getBoolean("ready") : "Bridge must be ready";
        assert caps.getBoolean("fs") : "FS must be enabled";
        assert caps.getBoolean("process") : "Process execution must be enabled";
        assert caps.has("workspacePath") : "Workspace path must be reported";

        // 2. Test Real Filesystem Operations
        System.out.println("Testing real on-disk filesystem operations...");
        boolean writeOk = bridge.writeFile("test_dir/hello.txt", "Hello Native Bridge!");
        assert writeOk : "writeFile must succeed";

        assert bridge.exists("test_dir/hello.txt") : "exists must return true";

        String readBack = bridge.readFile("test_dir/hello.txt");
        assert "Hello Native Bridge!".equals(readBack) : "readFile content mismatch";

        String statJson = bridge.stat("test_dir/hello.txt");
        JSONObject statObj = new JSONObject(statJson);
        assert statObj.getBoolean("isFile") : "stat isFile must be true";
        assert statObj.getLong("size") == 20 : "stat size must match";

        String listJson = bridge.listDir("test_dir");
        JSONArray listArr = new JSONArray(listJson);
        assert listArr.length() == 1 : "listDir must list 1 file";
        assert "hello.txt".equals(listArr.getJSONObject(0).getString("name")) : "listDir file name mismatch";

        boolean copyOk = bridge.copy("test_dir/hello.txt", "test_dir/hello_copy.txt");
        assert copyOk : "copy must succeed";
        assert bridge.exists("test_dir/hello_copy.txt") : "copied file must exist";

        boolean moveOk = bridge.move("test_dir/hello_copy.txt", "test_dir/hello_moved.txt");
        assert moveOk : "move must succeed";
        assert !bridge.exists("test_dir/hello_copy.txt") : "old file must not exist after move";
        assert bridge.exists("test_dir/hello_moved.txt") : "moved file must exist";

        boolean delOk = bridge.delete("test_dir/hello_moved.txt");
        assert delOk : "delete must succeed";
        assert !bridge.exists("test_dir/hello_moved.txt") : "deleted file must not exist";

        // 3. Test Secure Credential Vault
        System.out.println("Testing secure value storage...");
        boolean setSecOk = bridge.setSecureValue("api_key_anthropic", "sk-ant-test-12345");
        assert setSecOk : "setSecureValue must succeed";

        String secVal = bridge.getSecureValue("api_key_anthropic");
        assert "sk-ant-test-12345".equals(secVal) : "getSecureValue must return original secret";

        boolean delSecOk = bridge.deleteSecureValue("api_key_anthropic");
        assert delSecOk : "deleteSecureValue must succeed";
        assert bridge.getSecureValue("api_key_anthropic") == null : "deleted key must be null";

        // 4. Test Sandboxed Process Execution
        System.out.println("Testing process execution...");
        String execRes = bridge.execCommand("sh", "[\"-c\", \"echo 'Process Execution Works'\"]", ".", 5000);
        JSONObject execObj = new JSONObject(execRes);
        System.out.println("Process Output: " + execObj.optString("stdout").trim());
        assert execObj.getInt("exitCode") == 0 : "execCommand exitCode must be 0";
        assert execObj.getString("stdout").contains("Process Execution Works") : "execCommand stdout mismatch";

        // 5. Test Real Git Execution
        System.out.println("Testing real git CLI runner...");
        String gitRes = bridge.gitCommand("[\"version\"]", ".");
        JSONObject gitObj = new JSONObject(gitRes);
        System.out.println("Git Version Output: " + gitObj.optString("stdout").trim());
        assert gitObj.getInt("exitCode") == 0 : "gitCommand exitCode must be 0";
        assert gitObj.getString("stdout").contains("git version") : "gitCommand stdout must contain 'git version'";

        System.out.println("=== ALL OMPCOREBRIDGE ON-DEVICE TESTS PASSED! ===");

        // Cleanup
        deleteRecursive(testDir);
    }

    private static void deleteRecursive(File f) {
        if (f.isDirectory()) {
            File[] ch = f.listFiles();
            if (ch != null) for (File c : ch) deleteRecursive(c);
        }
        f.delete();
    }
}
