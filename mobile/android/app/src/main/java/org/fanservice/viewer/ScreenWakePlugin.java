package org.fanservice.viewer;

import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ScreenWake")
public class ScreenWakePlugin extends Plugin {
    private boolean resumed;

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled"));
        getActivity().runOnUiThread(() -> {
            if (enabled && !resumed) {
                call.reject("The activity is in the background.");
                return;
            }
            setWindowFlag(enabled);
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
        setWindowFlag(false);
    }

    @Override
    protected void handleOnDestroy() {
        resumed = false;
        setWindowFlag(false);
    }

    private void setWindowFlag(boolean enabled) {
        int flag = WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
        if (enabled) {
            getActivity().getWindow().addFlags(flag);
        } else {
            getActivity().getWindow().clearFlags(flag);
        }
    }
}
