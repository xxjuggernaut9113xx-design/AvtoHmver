package org.fanservice.viewer;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.CapConfig;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ArchiveSavePlugin.class);
        registerPlugin(ScreenWakePlugin.class);
        registerPlugin(GameplayVibrationPlugin.class);
        registerPlugin(OriginMigrationPlugin.class);
        String phase = OriginMigrationPlugin.startup(this);
        if (!"complete".equals(phase)) {
            config = new CapConfig.Builder(this)
                    .setAndroidScheme("importing".equals(phase) ? "http" : "https")
                    .setStartPath("compatibility".equals(phase) ? "/" : "/origin-migration.html")
                    .setAllowMixedContent(true)
                    .create();
        }
        super.onCreate(savedInstanceState);
        if ("importing".equals(phase) && bridge != null) {
            bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    WebResourceResponse staged = OriginMigrationPlugin.serve(MainActivity.this, request);
                    return staged != null ? staged : super.shouldInterceptRequest(view, request);
                }
            });
        }
    }
}
