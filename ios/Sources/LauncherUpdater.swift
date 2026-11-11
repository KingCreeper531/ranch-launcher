import UIKit

/// Checks GitHub for a newer Ranch Launcher. iOS can't update an app from inside itself, so an
/// update is only ever "available": installing it opens the release page in Safari.
/// Everything here runs on the main thread.
final class LauncherUpdater {
    enum Status: String {
        case idle, checking, latest, available
    }

    private static let latestAPI = URL(string: "https://api.github.com/repos/KingCreeper531/ranch-launcher/releases/latest")!
    private static let latestPage = URL(string: "https://github.com/KingCreeper531/ranch-launcher/releases/latest")!

    /// What the latest release says: its version, whether its .ipa is attached yet, and its page
    private typealias Release = (version: String, hasIPA: Bool, page: URL?)

    private(set) var status: Status = .idle
    private(set) var lastCheck = Date.distantPast
    /// The newer version on GitHub, when status is .available
    private var version: String?
    private var page: URL?
    private var timer: Timer?

    let current: String = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"

    /// Called whenever what view() returns changes.
    var onChange: (() -> Void)?

    deinit {
        timer?.invalidate()
    }

    /// Checks shortly after launch, then every 30 minutes.
    func start() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.check()
        }
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 30 * 60, repeats: true) { [weak self] _ in
            self?.check()
        }
    }

    /// Back in the foreground: checks again if the last check was over 10 minutes ago.
    func checkIfStale() {
        if Date().timeIntervalSince(lastCheck) > 10 * 60 {
            check()
        }
    }

    func view() -> [String: Any] {
        let shownVersion: Any = version.map { $0 as Any } ?? NSNull()
        let result: [String: Any] = [
            "status": status.rawValue,
            "current": current,
            "version": shownVersion,
            "percent": NSNull(),
            "error": NSNull(),
        ]
        return result
    }

    /// The release page to install from (Safari).
    func installURL() -> URL {
        page ?? Self.latestPage
    }

    func check() {
        guard status != .checking else { return }
        lastCheck = Date()
        let previous = status
        status = .checking
        onChange?()

        var request = URLRequest(url: Self.latestAPI)
        request.timeoutInterval = 20
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("RanchLauncher", forHTTPHeaderField: "User-Agent")
        URLSession.shared.dataTask(with: request) { data, response, error in
            var parsed: Release?
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if let data, error == nil, code == 200 {
                parsed = Self.parseRelease(data)
            }
            if parsed == nil {
                NSLog("Launcher update check failed: %@", error?.localizedDescription ?? "GitHub returned \(code)")
            }
            let release = parsed
            DispatchQueue.main.async { [weak self] in
                self?.finish(release, previous: previous)
            }
        }.resume()
    }

    private func finish(_ release: Release?, previous: Status) {
        guard let release else {
            status = previous // a failed check keeps what was known before
            onChange?()
            return
        }
        if release.hasIPA && Self.isNewer(release.version, than: current) {
            status = .available
            version = release.version
            page = release.page
        } else {
            status = .latest
            version = nil
            page = nil
        }
        onChange?()
    }

    private static func parseRelease(_ data: Data) -> Release? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tag = json["tag_name"] as? String, !tag.isEmpty else { return nil }
        let version = tag.hasPrefix("v") || tag.hasPrefix("V") ? String(tag.dropFirst()) : tag
        // The .ipa is attached a few minutes after the release is published
        let assets = json["assets"] as? [[String: Any]] ?? []
        let hasIPA = assets.contains { asset in
            let name = asset["name"] as? String ?? ""
            return name.lowercased().hasSuffix(".ipa")
        }
        let page = (json["html_url"] as? String).flatMap { URL(string: $0) }
        return (version: version, hasIPA: hasIPA, page: page)
    }

    /// Numeric dotted compare: "0.10.0" is newer than "0.9.2"; "1.2" equals "1.2.0".
    static func isNewer(_ candidate: String, than installed: String) -> Bool {
        let a = numbers(candidate)
        let b = numbers(installed)
        let count = max(a.count, b.count)
        for i in 0..<count {
            let x = i < a.count ? a[i] : 0
            let y = i < b.count ? b[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    /// "1.2.3-beta" -> [1, 2, 3]
    private static func numbers(_ version: String) -> [Int] {
        version.split(separator: ".").map { part in
            Int(String(part.prefix { $0.isNumber })) ?? 0
        }
    }
}
