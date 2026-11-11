package io.github.kingcreeper531.ranch;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.ContextCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Shows the launcher UI (the same React app as on Windows) in a WebView and gives it
 * `window.ranch`, backed by {@link Apps}.
 */
public class MainActivity extends Activity {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String HOME = ORIGIN + "/assets/ui/index.html";
    private static final long CHECK_EVERY_MS = 30L * 60 * 1000;        // every 30 minutes while open
    private static final long RESUME_CHECK_GAP_MS = 10L * 60 * 1000;   // and when you come back after a while
    private static final long FIRST_SELF_CHECK_MS = 3000;               // the launcher's own update, soon after start

    private WebView web;
    private Apps apps;
    private LauncherUpdate self;
    private String bridgeJs = "";
    private boolean documentStartScript;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newCachedThreadPool();

    private final Runnable periodic = new Runnable() {
        @Override public void run() {
            io.execute(() -> apps.refresh());
            main.postDelayed(this, CHECK_EVERY_MS);
        }
    };

    private final Runnable selfPeriodic = new Runnable() {
        @Override public void run() {
            io.execute(() -> self.check());
            main.postDelayed(this, CHECK_EVERY_MS);
        }
    };

    // Installs and uninstalls done anywhere (not just through us) show up right away
    private final BroadcastReceiver packages = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            io.execute(() -> apps.detect(false));
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        apps = new Apps(this, view -> emit("changed", view.toString()));
        self = new LauncherUpdate(this, () -> apps.autoUpdate(), view -> emit("launcher-update", view.toString()));

        web = new WebView(this);
        web.setBackgroundColor(0xFF0B100C);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        // ES module scripts don't load from file://, so serve the UI from a fake https origin
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web.addJavascriptInterface(new Native(), "RanchNative");
        bridgeJs = readAsset("bridge.js");
        documentStartScript = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (documentStartScript) {
            WebViewCompat.addDocumentStartJavaScript(web, bridgeJs, Collections.singleton(ORIGIN));
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return loader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (ORIGIN.equals(url.getScheme() + "://" + url.getHost())) return false;
                // Anything else (e.g. a link in release notes) opens in the browser
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                } catch (Exception ignored) { }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (!documentStartScript) view.evaluateJavascript(bridgeJs, null);
            }
        });
        web.setWebChromeClient(new WebChromeClient());

        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_PACKAGE_ADDED);
        f.addAction(Intent.ACTION_PACKAGE_REPLACED);
        f.addAction(Intent.ACTION_PACKAGE_REMOVED);
        f.addDataScheme("package");
        ContextCompat.registerReceiver(this, packages, f, ContextCompat.RECEIVER_NOT_EXPORTED);

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(HOME);

        // Check for updates now and every 30 minutes while the launcher is open
        main.post(periodic);
        // ...and for a new version of the launcher itself a few seconds after start, then every 30 minutes
        main.postDelayed(selfPeriodic, FIRST_SELF_CHECK_MS);
    }

    /** Pushes an event to the page (any thread). */
    private void emit(String type, String json) {
        main.post(() -> {
            if (web != null) web.evaluateJavascript("window.__ranchEmit && window.__ranchEmit('" + type + "'," + json + ")", null);
        });
    }

    private void resolve(int id, String json) {
        main.post(() -> {
            if (web != null) web.evaluateJavascript("window.__ranchResolve && window.__ranchResolve(" + id + "," + json + ")", null);
        });
    }

    private void reject(int id, String message) {
        String msg = JSONObject.quote(message == null ? "Something went wrong" : message);
        main.post(() -> {
            if (web != null) web.evaluateJavascript("window.__ranchReject && window.__ranchReject(" + id + "," + msg + ")", null);
        });
    }

    /** `window.RanchNative`: every call answers through window.__ranchResolve / __ranchReject. */
    private final class Native {
        @JavascriptInterface
        public void call(String method, String argsJson, int callbackId) {
            io.execute(() -> {
                try {
                    JSONArray args = argsJson == null ? new JSONArray() : new JSONArray(argsJson);
                    resolve(callbackId, handle(method, args));
                } catch (Exception e) {
                    reject(callbackId, e.getMessage());
                }
            });
        }
    }

    /** Runs on a background thread; returns the result as JSON text. */
    private String handle(String method, JSONArray args) throws Exception {
        switch (method) {
            case "list":
                return apps.list().toString();
            case "refresh":
                apps.refresh();
                return apps.list().toString();
            case "install":
                apps.install(args.getString(0));
                return "null";
            case "uninstall":
                apps.uninstall(args.getString(0));
                return "null";
            case "open":
                apps.open(args.getString(0));
                return "null";
            case "github":
                apps.github(args.getString(0));
                return "null";
            case "getSettings":
                return apps.settings().toString();
            case "setSettings": {
                JSONObject result = apps.setSettings(args.optJSONObject(0));
                if (apps.autoUpdate()) io.execute(() -> self.autoDownload());   // in the background
                return result.toString();
            }
            case "launcherUpdate":
                return self.view().toString();
            case "installLauncherUpdate":
                self.install();
                return "null";
            default:
                throw new Exception("Unknown method: " + method);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Back from Android's installer, uninstaller or settings: see what changed
        apps.detect(true);
        apps.onResume();
        if (apps.lastCheck > 0 && System.currentTimeMillis() - apps.lastCheck > RESUME_CHECK_GAP_MS) {
            io.execute(() -> apps.refresh());
        }
        self.onResume();
        if (self.lastCheck > 0 && System.currentTimeMillis() - self.lastCheck > RESUME_CHECK_GAP_MS) {
            io.execute(() -> self.check());
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacks(periodic);
        main.removeCallbacks(selfPeriodic);
        try { unregisterReceiver(packages); } catch (Exception ignored) { }
        io.shutdownNow();
        web.destroy();
        web = null;
        super.onDestroy();
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            return Apps.read(in);
        } catch (Exception e) {
            return "";
        }
    }
}
