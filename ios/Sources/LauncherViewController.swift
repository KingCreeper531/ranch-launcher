import UIKit
import WebKit

/// The launcher window: the same React UI as the Windows launcher (bundled in `ui`),
/// talking to Swift through window.ranch.
final class LauncherViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandlerWithReply {
    static let background = UIColor(red: 11 / 255, green: 16 / 255, blue: 12 / 255, alpha: 1) // #0b100c
    private static let home = URL(string: "ranch://app/index.html")!

    private var web: WKWebView!
    private var schemeHandler: BundleSchemeHandler?
    private let store = AppStore()

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.background

        let config = WKWebViewConfiguration()
        let uiFolder = Bundle.main.url(forResource: "ui", withExtension: nil)
        if let uiFolder {
            let handler = BundleSchemeHandler(root: uiFolder)
            schemeHandler = handler
            config.setURLSchemeHandler(handler, forURLScheme: "ranch")
        }

        let content = config.userContentController
        content.addScriptMessageHandler(WeakReplyHandler(self), contentWorld: .page, name: "ranch")
        content.addUserScript(WKUserScript(source: Self.bridge,
                                           injectionTime: .atDocumentStart,
                                           forMainFrameOnly: true,
                                           in: .page))

        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = Self.background
        web.scrollView.backgroundColor = Self.background
        web.underPageBackgroundColor = Self.background
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        if #available(iOS 16.4, *) {
            web.isInspectable = true
        }
        web.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(web)
        // Inside the safe area, so the status bar and home indicator never cover the UI (on iPad too)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
        ])

        if uiFolder != nil {
            web.load(URLRequest(url: Self.home))
        } else {
            web.loadHTMLString("<body style=\"background:#0b100c;color:#efe8d4;font:16px system-ui;padding:24px\">"
                               + "This build is missing the launcher window (ui folder).</body>", baseURL: nil)
        }

        store.onChange = { [weak self] id in self?.emit(id) }
        store.refresh {}

        NotificationCenter.default.addObserver(self, selector: #selector(willEnterForeground),
                                               name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    /// Back from Safari, AltStore or the app itself: something may have been installed or removed.
    @objc private func willEnterForeground() {
        store.checkInstalls()
        if Date().timeIntervalSince(store.lastRefresh) > 10 * 60 {
            store.refresh {}
        }
    }

    // MARK: - window.ranch

    /// Defines window.ranch before the page's own scripts run. Calls go to Swift through the
    /// "ranch" message handler (its postMessage returns a Promise); replies are JSON strings.
    private static let bridge = """
    (function () {
      if (window.ranch) return;
      var listeners = [];
      function call(method, args) {
        return window.webkit.messageHandlers.ranch.postMessage({ method: method, args: args || [] })
          .then(function (reply) { return typeof reply === 'string' ? JSON.parse(reply) : (reply === undefined ? null : reply); });
      }
      function idArg(id) { return [id == null ? '' : String(id)]; }
      window.__ranchEmit = function (view) {
        listeners.slice().forEach(function (fn) { try { fn(view); } catch (e) { console.error(e); } });
      };
      window.ranch = {
        platform: 'ios',
        list: function () { return call('list'); },
        refresh: function () { return call('refresh'); },
        install: function (id) { return call('install', idArg(id)).then(function () {}); },
        uninstall: function (id) { return call('uninstall', idArg(id)).then(function () {}); },
        open: function (id) { return call('open', idArg(id)).then(function () {}); },
        github: function (id) { return call('github', idArg(id)).then(function () {}); },
        getSettings: function () { return call('getSettings'); },
        setSettings: function (patch) { return call('setSettings'); },
        appSettings: function (id) { return call('appSettings', idArg(id)); },
        setAppSettings: function (id, patch) { return call('setAppSettings', idArg(id)); },
        onAppSettingsChanged: function (fn) { return function () {}; },
        onChanged: function (fn) {
          listeners.push(fn);
          return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
        }
      };
    })();
    """

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let body = message.body as? [String: Any] ?? [:]
        let method = body["method"] as? String ?? ""
        let args = body["args"] as? [Any] ?? []
        let id = args.first as? String
        let reply: (Any) -> Void = { value in replyHandler(Self.json(value), nil) }

        switch method {
        case "list":
            reply(store.list())
        case "refresh":
            store.refresh { [weak self] in
                reply(self?.store.list() ?? [])
            }
        case "install":
            // iOS can't install apps from inside another app: open the release page instead
            openExternal(store.installURL(id))
            reply(NSNull())
        case "open":
            openExternal(store.entry(id).flatMap { AppStore.openURL(for: $0) })
            reply(NSNull())
        case "github":
            openExternal(store.releasesURL(id))
            reply(NSNull())
        case "getSettings":
            let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
            let settings: [String: Any] = ["version": version, "rows": [Any]()]
            reply(settings)
        case "setSettings":
            reply([String: Any]())
        case "uninstall", "appSettings", "setAppSettings":
            reply(NSNull())
        default:
            replyHandler(nil, "Unknown method: \(method)")
        }
    }

    /// Tells the window an app changed (window.ranch.onChanged listeners).
    private func emit(_ id: String) {
        guard let web, let app = store.entry(id) else { return }
        web.evaluateJavaScript("window.__ranchEmit && window.__ranchEmit(\(Self.json(store.view(app))));",
                               completionHandler: nil)
    }

    private func openExternal(_ url: URL?) {
        guard let url else { return }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    private static func json(_ value: Any) -> String {
        guard !(value is NSNull), JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: []),
              let text = String(data: data, encoding: .utf8) else { return "null" }
        return text
    }

    // MARK: - Navigation

    /// The launcher stays on its own pages; web links open in Safari.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme == "ranch" || scheme == "about" || scheme == "blob" || scheme == "data" {
            decisionHandler(.allow)
            return
        }
        if scheme == "http" || scheme == "https" {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        decisionHandler(.cancel)
    }

    /// target="_blank" links and window.open: Safari.
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, let scheme = url.scheme?.lowercased(),
           scheme == "http" || scheme == "https" {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload() // iOS killed the page in the background; bring it back
    }
}

/// Avoids a retain cycle between the WebView's content controller and the view controller.
private final class WeakReplyHandler: NSObject, WKScriptMessageHandlerWithReply {
    weak var target: WKScriptMessageHandlerWithReply?

    init(_ target: WKScriptMessageHandlerWithReply) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let target else {
            replyHandler(nil, "The launcher is gone")
            return
        }
        target.userContentController(userContentController, didReceive: message, replyHandler: replyHandler)
    }
}
