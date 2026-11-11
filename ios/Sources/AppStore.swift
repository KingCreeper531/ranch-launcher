import UIKit

/// One entry of catalog.json, as far as the iPhone launcher cares.
struct CatalogApp {
    let id: String
    let name: String
    let tagline: String
    let icon: String
    let accent: String
    let repo: String?
    let comingSoon: Bool
    /// True when the entry has an "ios" section (the app has an iPhone version)
    let hasIOS: Bool
    /// Which release file is the iPhone app, e.g. ^YouTube-Music-iOS-[0-9.]+\.ipa$
    let assetPattern: String?
    /// The app opens with "<urlScheme>://"; also how the launcher sees it's installed
    let urlScheme: String?

    init?(json: [String: Any]) {
        guard let id = json["id"] as? String else { return nil }
        self.id = id
        name = json["name"] as? String ?? id
        tagline = json["tagline"] as? String ?? ""
        icon = json["icon"] as? String ?? ""
        accent = json["accent"] as? String ?? "#5cb84a"
        repo = json["repo"] as? String
        comingSoon = json["comingSoon"] as? Bool ?? false
        let ios = json["ios"] as? [String: Any]
        hasIOS = ios != nil
        assetPattern = ios?["assetPattern"] as? String
        urlScheme = ios?["urlScheme"] as? String
    }
}

/// What the latest GitHub release says about an app.
struct LatestRelease {
    let version: String
    let notes: String
    let publishedAt: String?
    let size: Int
    let page: URL?
}

/// The apps in catalog.json, whether each is installed, and their latest releases.
/// Everything here runs on the main thread.
final class AppStore {
    private(set) var apps: [CatalogApp] = []
    private var installed: [String: Bool] = [:]
    private var releases: [String: LatestRelease] = [:]
    private var waiting: [() -> Void] = []
    private(set) var lastRefresh = Date.distantPast

    /// Called with an app's id whenever what the window shows for it changes.
    var onChange: ((String) -> Void)?

    init() {
        if let url = Bundle.main.url(forResource: "catalog", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            apps = list.compactMap { CatalogApp(json: $0) }
        }
        for app in apps { installed[app.id] = Self.isInstalled(app) }
    }

    func entry(_ id: String?) -> CatalogApp? {
        guard let id else { return nil }
        return apps.first { $0.id == id }
    }

    // MARK: - What the window shows

    func list() -> [[String: Any]] {
        apps.map { view($0) }
    }

    func view(_ app: CatalogApp) -> [String: Any] {
        let release = releases[app.id]
        // Worked out first to keep the dictionary literal simple for the type checker
        let unavailable: Bool = !app.hasIOS && !app.comingSoon
        let installedNow: Bool = installed[app.id] ?? false
        let notes: String = release?.notes ?? ""
        let size: Int = release?.size ?? 0
        let result: [String: Any] = [
            "id": app.id,
            "name": app.name,
            "tagline": app.tagline,
            "icon": app.icon,
            "accent": app.accent,
            "repo": orNull(app.repo),
            "comingSoon": app.comingSoon,
            "unavailable": unavailable,
            "installed": installedNow,
            // iOS doesn't let one app read another app's version
            "version": NSNull(),
            "latest": orNull(release?.version),
            "updateAvailable": false,
            "updateReady": false,
            "waiting": false,
            "running": false,
            "busy": NSNull(),
            "progress": NSNull(),
            "error": NSNull(),
            "notes": notes,
            "publishedAt": orNull(release?.publishedAt),
            "size": size,
            "hasSettings": false,
            "canUninstall": false,
        ]
        return result
    }

    private func orNull(_ value: Any?) -> Any {
        value ?? NSNull()
    }

    // MARK: - Installed apps

    private static func isInstalled(_ app: CatalogApp) -> Bool {
        guard let url = openURL(for: app) else { return false }
        return UIApplication.shared.canOpenURL(url)
    }

    /// Looks again at which apps are installed and reports the ones that changed.
    func checkInstalls() {
        for app in apps {
            let now = Self.isInstalled(app)
            if installed[app.id] != now {
                installed[app.id] = now
                onChange?(app.id)
            }
        }
    }

    // MARK: - Latest releases

    /// Re-checks installs and fetches every app's latest release, then calls `completion`.
    func refresh(completion: @escaping () -> Void) {
        waiting.append(completion)
        guard waiting.count == 1 else { return } // a check is already running; it calls this one too
        lastRefresh = Date()
        checkInstalls()

        let group = DispatchGroup()
        for app in apps where !app.comingSoon && app.repo != nil {
            group.enter()
            fetchLatest(app) { [weak self] release in
                if let self, let release {
                    self.releases[app.id] = release
                    self.onChange?(app.id)
                }
                group.leave()
            }
        }
        group.notify(queue: .main) { [weak self] in
            guard let self else { return }
            let done = self.waiting
            self.waiting = []
            done.forEach { $0() }
        }
    }

    private func fetchLatest(_ app: CatalogApp, completion: @escaping (LatestRelease?) -> Void) {
        guard let repo = app.repo, let url = URL(string: "https://api.github.com/repos/\(repo)/releases/latest") else {
            completion(nil)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("RanchLauncher", forHTTPHeaderField: "User-Agent")
        let pattern = app.assetPattern
        URLSession.shared.dataTask(with: request) { data, response, error in
            var parsed: LatestRelease?
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if let data, error == nil, status == 200 {
                parsed = Self.parseRelease(data, assetPattern: pattern)
            } else {
                NSLog("Latest version check failed for %@: %@", app.name, error?.localizedDescription ?? "GitHub returned \(status)")
            }
            let release = parsed
            DispatchQueue.main.async { completion(release) }
        }.resume()
    }

    private static func parseRelease(_ data: Data, assetPattern: String?) -> LatestRelease? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tag = json["tag_name"] as? String, !tag.isEmpty else { return nil }
        let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag

        // Size of the iPhone app (.ipa) in this release, if it's there yet
        var size = 0
        if let assetPattern, let regex = try? NSRegularExpression(pattern: assetPattern, options: [.caseInsensitive]) {
            let assets = json["assets"] as? [[String: Any]] ?? []
            let match = assets.first { asset in
                let name = asset["name"] as? String ?? ""
                return regex.firstMatch(in: name, options: [], range: NSRange(name.startIndex..., in: name)) != nil
            }
            size = (match?["size"] as? NSNumber)?.intValue ?? 0
        }

        let notes = json["body"] as? String ?? ""
        let page = (json["html_url"] as? String).flatMap { URL(string: $0) }
        return LatestRelease(version: version,
                             notes: String(notes.prefix(20000)),
                             publishedAt: json["published_at"] as? String,
                             size: size,
                             page: page)
    }

    // MARK: - Links

    /// "<urlScheme>://", which opens the app.
    static func openURL(for app: CatalogApp) -> URL? {
        guard let scheme = app.urlScheme, !scheme.isEmpty else { return nil }
        return URL(string: scheme + "://")
    }

    /// The latest release's page, where the README explains how to install the .ipa.
    func installURL(_ id: String?) -> URL? {
        guard let app = entry(id) else { return nil }
        if let page = releases[app.id]?.page { return page }
        guard let repo = app.repo else { return nil }
        return URL(string: "https://github.com/\(repo)/releases/latest")
    }

    func releasesURL(_ id: String?) -> URL? {
        guard let app = entry(id), let repo = app.repo else { return nil }
        return URL(string: "https://github.com/\(repo)/releases")
    }
}
