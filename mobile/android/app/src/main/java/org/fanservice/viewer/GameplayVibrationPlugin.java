package org.fanservice.viewer;

import android.content.Context;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "GameplayVibration")
public class GameplayVibrationPlugin extends Plugin {
    private boolean resumed;

    @PluginMethod
    public void available(PluginCall call) {
        Vibrator vibrator = vibrator();
        JSObject result = new JSObject();
        result.put("available", vibrator != null && vibrator.hasVibrator());
        call.resolve(result);
    }

    @PluginMethod
    public void pulse(PluginCall call) {
        int duration = call.getInt("duration", -1);
        if (duration < 0 || duration > 100) {
            call.reject("Vibration duration is outside the gameplay range.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            Vibrator vibrator = vibrator();
            if (vibrator == null || !vibrator.hasVibrator() || (duration > 0 && !resumed)) {
                call.reject("Gameplay vibration is unavailable.");
                return;
            }
            if (duration == 0) vibrator.cancel();
            else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createOneShot(duration, VibrationEffect.DEFAULT_AMPLITUDE));
            } else {
                vibrator.vibrate(duration);
            }
            call.resolve();
        });
    }

    @Override
    protected void handleOnResume() {
        resumed = true;
    }

    @Override
    protected void handleOnPause() {
        resumed = false;
        Vibrator vibrator = vibrator();
        if (vibrator != null) vibrator.cancel();
    }

    @Override
    protected void handleOnDestroy() {
        handleOnPause();
    }

    private Vibrator vibrator() {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = context.getSystemService(VibratorManager.class);
            return manager == null ? null : manager.getDefaultVibrator();
        }
        return context.getSystemService(Vibrator.class);
    }
}
