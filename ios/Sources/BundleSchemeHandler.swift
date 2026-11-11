import Foundation
import WebKit

/// Serves the launcher window (the bundled `ui` folder) at ranch://app/...
/// The window's scripts are ES modules, which WebKit won't load from file:// URLs.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root: URL

    init(root: URL) {
        self.root = root.standardizedFileURL
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }

        // url.path is already percent-decoded: "/index.html", "/assets/index-abc.js", ...
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let relative = String(path.drop(while: { $0 == "/" }))
        let file = root.appendingPathComponent(relative).standardizedFileURL

        // Only files inside the ui folder
        guard file.path.hasPrefix(root.path + "/"), var data = try? Data(contentsOf: file) else {
            let missing: URLResponse = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1",
                                          headerFields: ["Content-Type": "text/plain", "Content-Length": "0"])
                ?? URLResponse(url: url, mimeType: "text/plain", expectedContentLength: 0, textEncodingName: nil)
            urlSchemeTask.didReceive(missing)
            urlSchemeTask.didReceive(Data())
            urlSchemeTask.didFinish()
            return
        }

        // The page's Content-Security-Policy allows 'self'; also name the ranch: scheme outright,
        // in case WebKit doesn't count a custom scheme as 'self'.
        if file.pathExtension.lowercased() == "html", let html = String(data: data, encoding: .utf8) {
            data = Data(html.replacingOccurrences(of: "'self'", with: "'self' ranch:").utf8)
        }

        let headers = [
            "Content-Type": Self.mimeType(for: file.pathExtension),
            "Content-Length": String(data.count),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ]
        let response: URLResponse = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)
            ?? URLResponse(url: url, mimeType: Self.mimeType(for: file.pathExtension),
                           expectedContentLength: data.count, textEncodingName: nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Every request is answered right away in start, so there is nothing to cancel.
    }

    private static func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
