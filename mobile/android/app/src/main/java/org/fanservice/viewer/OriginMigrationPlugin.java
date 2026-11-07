package org.fanservice.viewer;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.Base64;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "OriginMigration")
public class OriginMigrationPlugin extends Plugin {
    private static final int CHUNK_BYTES = 192 * 1024;
    private static final String PATH = "/api/_origin_migration/";
    private int nextId;
    private long remaining;
    private FileOutputStream output;

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("viewer-origin-migration-v1", Context.MODE_PRIVATE);
    }

    private static File staging(Context context) {
        return new File(context.getFilesDir(), "origin-migration-v1");
    }

    static String startup(Context context) {
        SharedPreferences preferences = prefs(context);
        String phase = preferences.getString("phase", "");
        if ("complete".equals(phase) || "compatibility".equals(phase)) return phase;
        if ("exporting".equals(phase) || "importing".equals(phase)) {
            preferences.edit().putString("phase", "compatibility")
                    .putString("reason", "The previous migration was interrupted.").commit();
            return "compatibility";
        }
        String next = "staged".equals(phase) ? "importing" : "exporting";
        if (preferences.edit().putString("phase", next).commit()) return next;
        preferences.edit().putString("phase", "compatibility")
                .putString("reason", "Free up device storage and retry.").commit();
        return "compatibility";
    }

    private boolean phase(String expected) {
        return expected.equals(prefs(getContext()).getString("phase", ""));
    }

    private void restart(PluginCall call) {
        call.resolve();
        getActivity().runOnUiThread(() -> getActivity().recreate());
    }

    private void closeOutput() throws IOException {
        if (output != null) {
            try { output.close(); }
            finally { output = null; }
        }
    }

    private static void clearStaging(Context context) throws IOException {
        File[] files = staging(context).listFiles();
        if (files != null) for (File file : files) {
            if (!file.delete()) throw new IOException("Cannot clear previous migration staging.");
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        SharedPreferences preferences = prefs(getContext());
        JSObject result = new JSObject();
        result.put("phase", preferences.getString("phase", ""));
        result.put("reason", preferences.getString("reason", ""));
        result.put("manifest", preferences.getString("manifest", ""));
        result.put("ownsDestination", preferences.getBoolean("ownsDestination", false));
        call.resolve(result);
    }

    @PluginMethod
    public synchronized void resetExport(PluginCall call) {
        if (!phase("exporting")) { call.reject("Migration export is not active."); return; }
        try {
            closeOutput();
            clearStaging(getContext());
            File directory = staging(getContext());
            if (!directory.isDirectory() && !directory.mkdir())
                throw new IOException("Cannot create migration staging. Check device storage.");
            nextId = 0;
            call.resolve();
        } catch (IOException error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public synchronized void beginArtifact(PluginCall call) {
        Integer size = call.getInt("size");
        if (!phase("exporting") || output != null || size == null || size < 0 || size > 256 * 1024 * 1024) {
            call.reject("Invalid migration artifact size or phase.");
            return;
        }
        try {
            // Keep some room for WebView and settings metadata.
            if (staging(getContext()).getUsableSpace() < size + 16L * 1024 * 1024)
                throw new IOException("Device storage is too low to stage saved data.");
            output = new FileOutputStream(new File(staging(getContext()), Integer.toString(nextId)));
            remaining = size;
            JSObject result = new JSObject();
            result.put("id", nextId++);
            call.resolve(result);
        } catch (IOException error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public synchronized void append(PluginCall call) {
        if (!phase("exporting") || output == null) { call.reject("No active migration artifact."); return; }
        try {
            String data = call.getString("data", "");
            if (data.isEmpty() || data.length() > CHUNK_BYTES / 3 * 4)
                throw new IOException("Invalid migration chunk.");
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            byte[] expected = Base64.decode(call.getString("hash", ""), Base64.NO_WRAP);
            byte[] actual = MessageDigest.getInstance("SHA-256").digest(bytes);
            if (bytes.length == 0 || bytes.length > remaining || !MessageDigest.isEqual(expected, actual))
                throw new IOException("Migration chunk failed its integrity check.");
            output.write(bytes);
            remaining -= bytes.length;
            call.resolve();
        } catch (Exception error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public synchronized void sealArtifact(PluginCall call) {
        if (!phase("exporting") || output == null || remaining != 0) {
            call.reject("Migration artifact is incomplete.");
            return;
        }
        try {
            output.getFD().sync();
            closeOutput();
            call.resolve();
        } catch (IOException error) { call.reject(error.getMessage(), error); }
    }

    @PluginMethod
    public synchronized void finishExport(PluginCall call) {
        Integer id = call.getInt("id");
        String manifest = call.getString("manifest", "");
        if (!phase("exporting") || output != null || id == null || id < 0
                || id != nextId - 1 || manifest.isEmpty() || manifest.length() > 512 * 1024) {
            call.reject("Migration export is incomplete.");
            return;
        }
        if (!prefs(getContext()).edit().putString("phase", "staged").putString("manifest", manifest).commit()) {
            call.reject("Cannot save staged migration. Check device storage.");
            return;
        }
        restart(call);
    }

    @PluginMethod
    public void claimDestination(PluginCall call) {
        if (!phase("importing") || !prefs(getContext()).edit().putBoolean("ownsDestination", true).commit()) {
            call.reject("Cannot prepare new storage. Check device storage.");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void finishImport(PluginCall call) {
        if (!phase("importing") || !prefs(getContext()).edit().putString("phase", "complete")
                .remove("manifest").remove("reason").remove("ownsDestination").commit()) {
            call.reject("Cannot finalize migration. Check device storage.");
            return;
        }
        try { clearStaging(getContext()); } catch (IOException ignored) {}
        restart(call);
    }

    @PluginMethod
    public synchronized void fallback(PluginCall call) {
        if (!phase("exporting") && !phase("importing")) { call.reject("No migration is active."); return; }
        boolean importing = phase("importing");
        try { closeOutput(); if (!importing) clearStaging(getContext()); } catch (IOException ignored) {}
        SharedPreferences.Editor editor = prefs(getContext()).edit().putString("phase", "compatibility")
                .putString("reason", call.getString("reason", "Migration failed."));
        if (!importing) editor.remove("manifest").remove("ownsDestination");
        editor.commit();
        restart(call);
    }

    @PluginMethod
    public void retry(PluginCall call) {
        SharedPreferences preferences = prefs(getContext());
        String next = preferences.getString("manifest", "").isEmpty() ? "retry" : "staged";
        if (!phase("compatibility") || !preferences.edit().putString("phase", next).commit()) {
            call.reject("Cannot start Retry. Check device storage.");
            return;
        }
        restart(call);
    }

    static WebResourceResponse serve(Context context, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getPath();
        if (!"http".equals(uri.getScheme()) || !"localhost".equals(uri.getAuthority())
                || path == null || !path.startsWith(PATH)) return null;
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        headers.put("Content-Security-Policy", "sandbox");
        String id = path.substring(PATH.length());
        if ("importing".equals(prefs(context).getString("phase", "")) && !request.isForMainFrame()
                && "GET".equals(request.getMethod()) && id.matches("[0-9]{1,10}")) {
            try {
                File file = new File(staging(context), id);
                return new WebResourceResponse("application/octet-stream", null, 200, "OK", headers,
                        new FileInputStream(file));
            } catch (IOException ignored) {}
        }
        return new WebResourceResponse("text/plain", null, 404, "Not Found", headers, null);
    }
}
