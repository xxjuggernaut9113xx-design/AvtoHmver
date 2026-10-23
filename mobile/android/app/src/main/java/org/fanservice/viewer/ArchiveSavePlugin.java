package org.fanservice.viewer;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

@CapacitorPlugin(name = "ArchiveSave")
public class ArchiveSavePlugin extends Plugin {
    private static final long LIMIT = 512L * 1024 * 1024;
    private File staged;
    private String token;
    private String name;
    private long expected;
    private long written;
    private boolean choosing;

    @Override
    public void load() {
        File[] abandoned = getContext().getCacheDir().listFiles((dir, filename) ->
                filename.startsWith("fanservice-export-") && filename.endsWith(".part"));
        if (abandoned != null) for (File file : abandoned) if (!file.delete()) file.deleteOnExit();
    }

    @PluginMethod
    public synchronized void begin(PluginCall call) {
        if (token != null) { call.reject("An archive save is already active."); return; }
        String requested = call.getString("name", "");
        Integer size = call.getInt("size");
        if (size == null || size <= 0 || size > LIMIT || requested.length() > 160 ||
                !requested.endsWith(".chpack") || requested.contains("/") || requested.contains("\\") ||
                requested.chars().anyMatch(c -> Character.isISOControl(c))) {
            call.reject("Invalid archive name or size. Maximum size is 512 MiB."); return;
        }
        try {
            staged = File.createTempFile("fanservice-export-", ".part", getContext().getCacheDir());
            token = UUID.randomUUID().toString();
            name = requested;
            expected = size;
            written = 0;
            JSObject result = new JSObject(); result.put("token", token); call.resolve(result);
        } catch (IOException e) { clear(); call.reject("Cannot stage archive. Check device storage.", e); }
    }

    private boolean matches(PluginCall call) { return token != null && token.equals(call.getString("token")); }

    @PluginMethod
    public synchronized void append(PluginCall call) {
        if (!matches(call) || choosing) { call.reject("Archive save is no longer writable."); return; }
        try {
            Integer offset = call.getInt("offset");
            String data = call.getString("data", "");
            if (offset == null || offset != written || data.isEmpty() || data.length() > 262144)
                throw new IOException("Invalid archive chunk order or size.");
            byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
            if (bytes.length == 0 || bytes.length > 196608 || written + bytes.length > expected)
                throw new IOException("Archive exceeds its declared size.");
            try (FileOutputStream out = new FileOutputStream(staged, true)) { out.write(bytes); }
            written += bytes.length;
            call.resolve();
        } catch (IOException | IllegalArgumentException e) {
            clear(); call.reject("Archive staging failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public synchronized void finish(PluginCall call) {
        if (!matches(call) || choosing || written != expected) { call.reject("Archive staging is incomplete."); return; }
        choosing = true;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/octet-stream");
        intent.putExtra(Intent.EXTRA_TITLE, name);
        try { startActivityForResult(call, intent, "archiveChosen"); }
        catch (RuntimeException e) { clear(); call.reject("No document destination is available.", e); }
    }

    @ActivityCallback
    private synchronized void archiveChosen(PluginCall call, ActivityResult activityResult) {
        if (call == null) { clear(); return; }
        Uri destination = activityResult.getData() == null ? null : activityResult.getData().getData();
        if (!matches(call)) {
            if (destination != null) remove(destination);
            call.reject("Archive save expired."); return;
        }
        if (activityResult.getResultCode() != Activity.RESULT_OK || destination == null) {
            if (destination != null) remove(destination);
            clear(); JSObject result = new JSObject(); result.put("cancelled", true); call.resolve(result); return;
        }
        // File I/O runs outside the activity thread. Synchronization serializes abort and completion.
        getBridge().execute(() -> copyToDocument(call, destination));
    }

    private synchronized void copyToDocument(PluginCall call, Uri destination) {
        if (!matches(call)) { remove(destination); call.reject("Archive save expired."); return; }
        try {
            MessageDigest sourceDigest = MessageDigest.getInstance("SHA-256");
            long copied = 0;
            byte[] buffer = new byte[65536];
            try (InputStream in = new FileInputStream(staged);
                 OutputStream out = getContext().getContentResolver().openOutputStream(destination, "wt")) {
                if (out == null) throw new IOException("Destination could not be opened.");
                int count;
                while ((count = in.read(buffer)) != -1) {
                    out.write(buffer, 0, count); sourceDigest.update(buffer, 0, count); copied += count;
                }
                out.flush();
            }
            if (copied != expected) throw new IOException("Saved archive length does not match.");
            MessageDigest savedDigest = MessageDigest.getInstance("SHA-256");
            long checked = 0;
            try (InputStream in = getContext().getContentResolver().openInputStream(destination)) {
                if (in == null) throw new IOException("Saved archive could not be verified.");
                int count;
                while ((count = in.read(buffer)) != -1) {
                    checked += count;
                    if (checked > expected) throw new IOException("Saved archive exceeds expected length.");
                    savedDigest.update(buffer, 0, count);
                }
            }
            if (checked != expected || !MessageDigest.isEqual(sourceDigest.digest(), savedDigest.digest()))
                throw new IOException("Saved archive checksum does not match.");
            JSObject result = new JSObject(); result.put("bytes", checked); result.put("verified", true);
            clear(); call.resolve(result);
        } catch (IOException | NoSuchAlgorithmException | RuntimeException e) {
            boolean removed = remove(destination);
            clear(); call.reject("Archive save failed. " + (removed ? "Incomplete output removed." :
                    "Remove the incomplete document from the selected destination.") + " " + e.getMessage(), e);
        }
    }

    private boolean remove(Uri uri) {
        try { return DocumentsContract.deleteDocument(getContext().getContentResolver(), uri); }
        catch (Exception e) { return false; }
    }

    @PluginMethod
    public synchronized void abort(PluginCall call) {
        if (matches(call)) clear();
        call.resolve();
    }

    private void clear() {
        if (staged != null && staged.exists() && !staged.delete()) staged.deleteOnExit();
        staged = null; token = null; choosing = false; written = 0; expected = 0;
    }

    @Override
    protected synchronized void handleOnDestroy() { clear(); }
}
