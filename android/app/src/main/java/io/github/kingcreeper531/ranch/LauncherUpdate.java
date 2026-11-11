package io.github.kingcreeper531.ranch;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.function.BooleanSupplier;
import java.util.regex.Pattern;

/**
 * Keeps the launcher itself up to date: checks its own latest GitHub release, downloads the
 * new APK in the background (with "Keep apps up to date" on) and opens Android's installer.
 */
final class LauncherUpdate {
    interface Listener { void changed(JSONObject view); }

    private static final String RELEASES = "https://api.github.com/repos/KingCreeper531/ranch-launcher/releases/latest";
    private static final Pattern ASSET = Pattern.compile("^Ranch-Launcher-Android-[0-9.]+\\.apk$");
    private static final String USER_AGENT = "RanchLauncher";

    private final Activity activity;
    private final Listener listener;
    private final BooleanSupplier autoUpdate;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Object checkLock = new Object();
    private final Object downloadLock = new Object();

    // State (guarded by this)
    private String status = "idle";
    private String version;         // newest release, without the leading v
    private Integer percent;
    private String error;
    private String assetName, assetUrl;
    private long size;
    private volatile boolean waitingForPermission;
    volatile long lastCheck;

    LauncherUpdate(Activity activity, BooleanSupplier autoUpdate, Listener listener) {
        this.activity = activity;
        this.autoUpdate = autoUpdate;
        this.listener = listener;
    }

    static String current() { return BuildConfig.VERSION_NAME; }

    synchronized JSONObject view() {
        try {
            Object nul = JSONObject.NULL;
            return new JSONObject()
                    .put("status", status)
                    .put("current", current())
                    .put("version", version != null ? version : nul)
                    .put("percent", percent != null ? percent : nul)
                    .put("error", error != null ? error : nul);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private void set(String status, Integer percent, String error) {
        synchronized (this) {
            this.status = status;
            this.percent = percent;
            this.error = error;
        }
        listener.changed(view());
    }

    private synchronized String status() { return status; }

    // ------------------------------------------------------------------ check
    /** Fetches the launcher's latest release; downloads it right away with auto-update on. Blocking. */
    void check() {
        synchronized (checkLock) {
            lastCheck = System.currentTimeMillis();
            String before;
            boolean showChecking;
            synchronized (this) {
                before = status;
                showChecking = "idle".equals(status) || "latest".equals(status);
            }
            if (showChecking) set("checking", null, null);
            try {
                fetchLatest();
            } catch (Exception e) {
                android.util.Log.w("Ranch", "Launcher update check failed: " + e.getMessage());
                // A failed check isn't worth a red button: keep whatever we showed before
                if (showChecking) set(before, null, null);
                return;
            }
            cleanUp();
            String now = status();
            if ("downloading".equals(now)) return;   // install() is already downloading it
            boolean newer;
            synchronized (this) { newer = assetUrl != null && isNewer(version, current()); }
            if (!newer) set("latest", null, null);
            else if (readyFile() != null) set("ready", null, null);
            else if (autoUpdate.getAsBoolean()) {
                try { download(); } catch (Exception ignored) { /* download() already set 'error' */ }
            } else if (!"error".equals(now)) set("available", null, null);
        }
    }

    /** "Keep apps up to date" was just turned on: fetch an update we already know about. */
    void autoDownload() {
        synchronized (checkLock) {
            boolean go;
            synchronized (this) { go = "available".equals(status) && assetUrl != null; }
            if (go && autoUpdate.getAsBoolean()) {
                try { download(); } catch (Exception ignored) { /* download() already set 'error' */ }
            }
        }
    }

    private void fetchLatest() throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(RELEASES).openConnection();
        c.setRequestProperty("Accept", "application/vnd.github+json");
        c.setRequestProperty("User-Agent", USER_AGENT);
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        try {
            if (c.getResponseCode() != 200) throw new Exception("GitHub returned " + c.getResponseCode());
            JSONObject release = new JSONObject(Apps.read(c.getInputStream()));
            String tag = release.optString("tag_name", "").replaceFirst("^[vV]", "");
            String name = null, url = null;
            long sz = 0;
            JSONArray assets = release.optJSONArray("assets");
            for (int i = 0; assets != null && i < assets.length(); i++) {
                JSONObject asset = assets.getJSONObject(i);
                if (ASSET.matcher(asset.optString("name")).matches()) {
                    name = asset.optString("name");
                    url = asset.optString("browser_download_url");
                    sz = asset.optLong("size");
                    break;
                }
            }
            if (tag.isEmpty()) throw new Exception("The latest release has no version");
            synchronized (this) {
                version = tag;
                assetName = name;
                assetUrl = url;
                size = sz;
            }
        } finally {
            c.disconnect();
        }
    }

    // ------------------------------------------------------------------ download / install
    private static File dir(Activity activity) { return new File(activity.getCacheDir(), "updates"); }

    private synchronized File apkFile() {
        return assetName == null ? null : new File(dir(activity), assetName);
    }

    /** The new APK, if it's already downloaded in full. */
    private synchronized File readyFile() {
        File f = apkFile();
        return f != null && f.exists() && (size <= 0 || f.length() == size) ? f : null;
    }

    /** Deletes downloaded launcher APKs that aren't the newest release or aren't newer than this build. */
    private void cleanUp() {
        File[] files = dir(activity).listFiles();
        if (files == null) return;
        String keep;
        synchronized (this) { keep = assetName != null && isNewer(version, current()) ? assetName : null; }
        for (File f : files) {
            String n = f.getName();
            if (!n.startsWith("Ranch-Launcher-Android-")) continue;
            if (n.equals(keep) || n.equals(keep + ".part")) continue;
            if ("downloading".equals(status()) && n.endsWith(".part")) continue;
            f.delete();
        }
    }

    private void download() throws Exception {
        synchronized (downloadLock) {
            if (readyFile() != null) {
                set("ready", null, null);
                return;
            }
            String url;
            long expected;
            File out;
            synchronized (this) {
                url = assetUrl;
                expected = size;
                out = apkFile();
            }
            if (url == null || out == null) {
                set("error", null, "The latest release has no Android download");
                throw new Exception("The latest release has no Android download");
            }
            set("downloading", 0, null);
            File part = new File(out.getPath() + ".part");
            out.getParentFile().mkdirs();
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setRequestProperty("User-Agent", USER_AGENT);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                try {
                    if (c.getResponseCode() != 200) throw new Exception("download failed (" + c.getResponseCode() + ")");
                    long total = c.getContentLengthLong();
                    if (total <= 0) total = expected;
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
                                    set("downloading", pct, null);
                                }
                            }
                        }
                    }
                } finally {
                    c.disconnect();
                }
                if (expected > 0 && part.length() != expected) throw new Exception("the download was incomplete");
                if (out.exists()) out.delete();
                if (!part.renameTo(out)) throw new Exception("couldn't save the download");
                set("ready", null, null);
            } catch (Exception e) {
                part.delete();
                set("error", null, "Couldn't download the update: " + e.getMessage());
                throw e;
            }
        }
    }

    /** Opens Android's installer for the new version, downloading it first if needed. Blocking. */
    void install() throws Exception {
        // Waits for a check or background download that's already running, then goes on from there
        synchronized (checkLock) {
            boolean known;
            synchronized (this) { known = assetUrl != null && isNewer(version, current()); }
            if (!known) {
                fetchLatest();
                synchronized (this) { known = assetUrl != null && isNewer(version, current()); }
                if (!known) {
                    set("latest", null, null);
                    return;
                }
            }
            if (readyFile() == null) download();
            main.post(this::launchInstaller);
        }
    }

    /** Main thread. Asks for "install unknown apps" first if needed. */
    private void launchInstaller() {
        File apk = readyFile();
        if (apk == null) {
            set("error", null, "The download is missing. Try again.");
            return;
        }
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            waitingForPermission = true;
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
        } catch (Exception e) {
            set("error", null, "Couldn't open the installer: " + e.getMessage());
        }
    }

    /** Main thread, from the activity's onResume. */
    void onResume() {
        if (waitingForPermission) {
            waitingForPermission = false;
            if (activity.getPackageManager().canRequestPackageInstalls()) launchInstaller();
        }
    }

    private static boolean isNewer(String a, String b) { return Apps.isNewer(a, b); }
}
