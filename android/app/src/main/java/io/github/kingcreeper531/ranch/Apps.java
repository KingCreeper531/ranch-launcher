package io.github.kingcreeper531.ranch;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * The apps in catalog.json and where each one stands on this phone: installed version,
 * latest GitHub release, downloads and installs. Mirrors launcher/src/apps.js on Windows.
 */
final class Apps {
    interface Listener { void changed(JSONObject view); }

    private static final String USER_AGENT = "RanchLauncher";

    static final class App {
        // From the catalog
        String id, name, tagline, icon, accent, repo;
        boolean comingSoon;
        Pattern assetPattern;   // null: no Android version
        String packageName;

        // Current state
        boolean installed;
        String version;         // installed versionName
        String latest;          // newest release tag, without the leading v
        String notes = "";
        String publishedAt;
        long size;
        String assetName, assetUrl;
        String busy;            // downloading, finishing, uninstalling or null
        Integer progress;
        String error;

        boolean unavailable() { return !comingSoon && (assetPattern == null || packageName == null); }
    }

    private final Activity activity;
    private final Listener listener;
    private final SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<App> apps = new ArrayList<>();
    private final Object refreshLock = new Object();
    private volatile String waitingForPermission;   // app id to install once "install unknown apps" is allowed
    volatile long lastCheck;

    Apps(Activity activity, Listener listener) {
        this.activity = activity;
        this.listener = listener;
        this.prefs = activity.getSharedPreferences("ranch", Activity.MODE_PRIVATE);
        try {
            JSONArray catalog = new JSONArray(readAsset("catalog.json"));
            for (int i = 0; i < catalog.length(); i++) {
                JSONObject c = catalog.getJSONObject(i);
                App a = new App();
                a.id = c.getString("id");
                a.name = c.optString("name", a.id);
                a.tagline = c.optString("tagline", "");
                a.icon = c.optString("icon", null);
                a.accent = c.optString("accent", null);
                a.repo = c.optString("repo", null);
                a.comingSoon = c.optBoolean("comingSoon", false);
                JSONObject android = c.optJSONObject("android");
                if (android != null) {
                    String pattern = android.optString("assetPattern", null);
                    if (pattern != null) a.assetPattern = Pattern.compile(pattern);
                    a.packageName = android.optString("packageName", null);
                }
                apps.add(a);
            }
        } catch (Exception e) {
            android.util.Log.e("Ranch", "Couldn't read catalog.json", e);
        }
        detect(false);
    }

    // ------------------------------------------------------------------ settings
    boolean autoUpdate() { return prefs.getBoolean("autoUpdate", true); }

    JSONObject settings() throws Exception {
        JSONObject row = new JSONObject()
                .put("key", "autoUpdate")
                .put("title", "Keep apps up to date")
                .put("help", "Downloads new versions in the background as soon as they are released. Android asks you to confirm each install.");
        return new JSONObject()
                .put("autoUpdate", autoUpdate())
                .put("version", BuildConfig.VERSION_NAME)
                .put("rows", new JSONArray().put(row));
    }

    JSONObject setSettings(JSONObject patch) throws Exception {
        if (patch != null && patch.has("autoUpdate")) {
            boolean on = patch.optBoolean("autoUpdate");
            prefs.edit().putBoolean("autoUpdate", on).apply();
            if (on) autoDownload();
        }
        return new JSONObject().put("autoUpdate", autoUpdate());
    }

    // ------------------------------------------------------------------ views
    synchronized JSONArray list() throws Exception {
        JSONArray out = new JSONArray();
        for (App a : apps) out.put(view(a));
        return out;
    }

    private synchronized JSONObject view(App a) {
        try {
            Object nul = JSONObject.NULL;
            boolean updateAvailable = a.installed && a.latest != null && a.version != null && isNewer(a.latest, a.version);
            return new JSONObject()
                    .put("id", a.id)
                    .put("name", a.name)
                    .put("tagline", a.tagline)
                    .put("icon", a.icon != null ? a.icon : nul)
                    .put("accent", a.accent != null ? a.accent : nul)
                    .put("repo", a.repo != null ? a.repo : nul)
                    .put("comingSoon", a.comingSoon)
                    .put("unavailable", a.unavailable())
                    .put("installed", a.installed)
                    .put("version", a.version != null ? a.version : nul)
                    .put("latest", a.latest != null ? a.latest : nul)
                    .put("updateAvailable", updateAvailable)
                    .put("updateReady", readyFile(a) != null)
                    .put("waiting", false)
                    .put("running", false)
                    .put("busy", a.busy != null ? a.busy : nul)
                    .put("progress", a.progress != null ? a.progress : nul)
                    .put("error", a.error != null ? a.error : nul)
                    .put("notes", a.notes != null ? a.notes : "")
                    .put("publishedAt", a.publishedAt != null ? a.publishedAt : nul)
                    .put("size", a.size)
                    .put("hasSettings", false)
                    .put("canUninstall", true);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void emit(App a) {
        listener.changed(view(a));
    }

    private void set(App a, String busy, Integer progress, String error) {
        synchronized (this) {
            a.busy = busy;
            a.progress = progress;
            a.error = error;
        }
        emit(a);
    }

    App find(String id) {
        for (App a : apps) if (a.id.equals(id)) return a;
        throw new IllegalArgumentException("Unknown app: " + id);
    }

    // ------------------------------------------------------------------ detection
    /**
     * Reads which apps are installed (and which version). Emits the ones that changed.
     * backInFront: the installer / uninstall dialog we opened has closed, so stop showing it as busy.
     */
    void detect(boolean backInFront) {
        PackageManager pm = activity.getPackageManager();
        for (App a : apps) {
            if (a.packageName == null) continue;
            boolean installed;
            String version;
            try {
                PackageInfo info = pm.getPackageInfo(a.packageName, 0);
                installed = true;
                version = info.versionName;
            } catch (PackageManager.NameNotFoundException e) {
                installed = false;
                version = null;
            }
            boolean changed;
            synchronized (this) {
                changed = installed != a.installed || !eq(version, a.version);
                a.installed = installed;
                a.version = version;
                // The system dialog has closed: whatever it did, we're done waiting on it.
                if (backInFront && ("finishing".equals(a.busy) || "uninstalling".equals(a.busy))) {
                    a.busy = null;
                    a.progress = null;
                    changed = true;
                }
            }
            // A downloaded APK that's now installed (or older) isn't needed any more
            if (installed && a.assetName != null) {
                File f = apkFile(a);
                if (f.exists() && a.latest != null && !isNewer(a.latest, version)) f.delete();
            }
            if (changed) emit(a);
        }
    }

    // ------------------------------------------------------------------ releases
    /** Re-detects installs and fetches every app's latest release. Blocking. */
    void refresh() {
        synchronized (refreshLock) {
            lastCheck = System.currentTimeMillis();
            detect(false);
            for (App a : apps) {
                if (a.comingSoon || a.repo == null || a.unavailable()) continue;
                try {
                    fetchLatest(a);
                } catch (Exception e) {
                    android.util.Log.w("Ranch", "Release check failed for " + a.id + ": " + e.getMessage());
                }
                emit(a);
            }
        }
        autoDownload();
    }

    private void fetchLatest(App a) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(
                "https://api.github.com/repos/" + a.repo + "/releases/latest").openConnection();
        c.setRequestProperty("Accept", "application/vnd.github+json");
        c.setRequestProperty("User-Agent", USER_AGENT);
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("GitHub returned " + c.getResponseCode());
            JSONObject release = new JSONObject(read(c.getInputStream()));
            String tag = release.optString("tag_name", "").replaceFirst("^[vV]", "");
            String name = null, url = null;
            long size = 0;
            JSONArray assets = release.optJSONArray("assets");
            for (int i = 0; assets != null && i < assets.length(); i++) {
                JSONObject asset = assets.getJSONObject(i);
                if (a.assetPattern.matcher(asset.optString("name")).matches()) {
                    name = asset.optString("name");
                    url = asset.optString("browser_download_url");
                    size = asset.optLong("size");
                    break;
                }
            }
            synchronized (this) {
                a.latest = tag.isEmpty() ? null : tag;
                a.notes = release.optString("body", "");
                a.publishedAt = release.isNull("published_at") ? null : release.optString("published_at", null);
                a.assetName = name;
                a.assetUrl = url;
                a.size = size;
            }
        } finally {
            c.disconnect();
        }
    }

    /** With "Keep apps up to date" on, downloads new versions of installed apps (installing still needs a tap). */
    void autoDownload() {
        if (!autoUpdate()) return;
        for (App a : apps) {
            boolean go;
            synchronized (this) {
                go = a.installed && a.busy == null && a.assetUrl != null && a.latest != null
                        && isNewer(a.latest, a.version) && readyFile(a) == null;
            }
            if (go) {
                try {
                    download(a);
                } catch (Exception e) {
                    set(a, null, null, "Couldn't download the update: " + e.getMessage());
                }
            }
        }
    }

    // ------------------------------------------------------------------ install
    private File apkFile(App a) {
        return new File(new File(activity.getCacheDir(), "updates"), a.assetName);
    }

    /** The newest APK, if it's already downloaded in full. */
    private synchronized File readyFile(App a) {
        if (a.assetName == null) return null;
        File f = apkFile(a);
        return f.exists() && (a.size <= 0 || f.length() == a.size) ? f : null;
    }

    /** Downloads the latest APK (unless it's already here), then opens Android's installer. Blocking. */
    void install(String id) throws Exception {
        App a = find(id);
        if (a.comingSoon || a.unavailable()) throw new Exception(a.name + " isn't available for Android yet");
        if (a.busy != null) return;
        try {
            if (a.assetUrl == null) {
                set(a, "downloading", null, null);
                fetchLatest(a);
                if (a.assetUrl == null) throw new Exception("The latest release has no Android download");
            }
            if (readyFile(a) == null) download(a);
            set(a, null, null, null);
            main.post(() -> launchInstaller(a));
        } catch (Exception e) {
            set(a, null, null, "Couldn't install: " + e.getMessage());
        }
    }

    private void download(App a) throws Exception {
        set(a, "downloading", 0, null);
        File out = apkFile(a);
        File part = new File(out.getPath() + ".part");
        out.getParentFile().mkdirs();
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(a.assetUrl).openConnection();
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", USER_AGENT);
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            try {
                if (c.getResponseCode() != 200) throw new Exception("download failed (" + c.getResponseCode() + ")");
                long total = c.getContentLengthLong();
                if (total <= 0) total = a.size;
                try (InputStream in = c.getInputStream(); FileOutputStream fos = new FileOutputStream(part)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0;
                    int n, last = 0;
                    while ((n = in.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        done += n;
                        if (total > 0) {
                            int pct = (int) Math.min(100, done * 100 / total);
                            if (pct != last) {
                                last = pct;
                                set(a, "downloading", pct, null);
                            }
                        }
                    }
                }
            } finally {
                c.disconnect();
            }
            if (out.exists()) out.delete();
            if (!part.renameTo(out)) throw new Exception("couldn't save the download");
            set(a, null, null, null);
        } catch (Exception e) {
            part.delete();
            set(a, null, null, null);
            throw e;
        }
    }

    /** Main thread. Asks for "install unknown apps" first if needed. */
    private void launchInstaller(App a) {
        File apk = readyFile(a);
        if (apk == null) {
            set(a, null, null, "The download is missing. Try again.");
            return;
        }
        PackageManager pm = activity.getPackageManager();
        if (!pm.canRequestPackageInstalls()) {
            waitingForPermission = a.id;
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + activity.getPackageName())));
            return;
        }
        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", apk);
        Intent i = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            activity.startActivity(i);
            set(a, "finishing", null, null);   // cleared when we're back in front (onResume)
        } catch (Exception e) {
            set(a, null, null, "Couldn't open the installer: " + e.getMessage());
        }
    }

    /** Main thread, from the activity's onResume. */
    void onResume() {
        String waiting = waitingForPermission;
        if (waiting != null) {
            waitingForPermission = null;
            if (activity.getPackageManager().canRequestPackageInstalls()) {
                launchInstaller(find(waiting));
            }
        }
    }

    // ------------------------------------------------------------------ open / uninstall / GitHub
    void uninstall(String id) {
        App a = find(id);
        if (a.packageName == null) return;
        main.post(() -> {
            try {
                activity.startActivity(new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + a.packageName)));
                set(a, "uninstalling", null, null);   // cleared when we're back in front
            } catch (Exception e) {
                set(a, null, null, "Couldn't uninstall: " + e.getMessage());
            }
        });
    }

    void open(String id) throws Exception {
        App a = find(id);
        Intent i = a.packageName != null ? activity.getPackageManager().getLaunchIntentForPackage(a.packageName) : null;
        if (i == null) throw new Exception(a.name + " isn't installed");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        main.post(() -> activity.startActivity(i));
    }

    void github(String id) {
        App a = find(id);
        if (a.repo == null) return;
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://github.com/" + a.repo + "/releases"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        main.post(() -> {
            try { activity.startActivity(i); } catch (Exception ignored) { }
        });
    }

    // ------------------------------------------------------------------ helpers
    private String readAsset(String name) throws Exception {
        try (InputStream in = activity.getAssets().open(name)) {
            return read(in);
        }
    }

    static String read(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private static boolean eq(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

    /** True when dotted version a is newer than b. */
    static boolean isNewer(String a, String b) {
        if (a == null) return false;
        if (b == null) return true;
        String[] x = a.split("\\.");
        String[] y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = i < x.length ? parse(x[i]) : 0;
            int q = i < y.length ? parse(y[i]) : 0;
            if (p != q) return p > q;
        }
        return false;
    }

    private static int parse(String s) {
        try { return Integer.parseInt(s.replaceAll("\\D.*", "")); } catch (Exception e) { return 0; }
    }
}
