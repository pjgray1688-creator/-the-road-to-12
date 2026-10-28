import SafariServices
import SwiftUI
import WebKit

private struct CoachDestination: Identifiable {
    let title: String
    let path: String
    let symbol: String
    var id: String { path }
}

private enum CoachNavigation {
    static let origin = "https://app.r12.live"
    static let tabs = [
        CoachDestination(title: "Clients", path: "/coach", symbol: "person.2"),
        CoachDestination(title: "Diary", path: "/coach/diary", symbol: "calendar"),
        CoachDestination(title: "Programmes", path: "/coach/programmes", symbol: "list.clipboard"),
        CoachDestination(title: "Nutrition", path: "/coach/nutrition", symbol: "leaf"),
        CoachDestination(title: "Account", path: "/coach/account", symbol: "person.crop.circle"),
    ]

    static func url(path: String) -> URL {
        var components = URLComponents(string: origin)!
        let parts = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        components.path = String(parts[0])
        if parts.count == 2 { components.percentEncodedQuery = String(parts[1]) }
        return components.url!
    }

    static func request(path: String) -> URLRequest {
        URLRequest(url: url(path: path), cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30)
    }

    static func accepts(_ url: URL) -> Bool {
        guard url.scheme == "https", url.host == "app.r12.live", url.user == nil,
              url.password == nil, url.port == nil || url.port == 443 else { return false }
        return url.path == "/coach" || url.path.hasPrefix("/coach/") ||
            url.path == "/account" || url.path.hasPrefix("/account/") ||
            url.path == "/terms" || url.path == "/support"
    }

    static func selectedIndex(path: String, fallback: Int) -> Int {
        if path == "/coach/diary" || path.hasPrefix("/coach/diary/") { return 1 }
        if path == "/coach/programmes" || path.hasPrefix("/coach/programmes/") { return 2 }
        if path == "/coach/nutrition" || path.hasPrefix("/coach/nutrition/") { return 3 }
        if path == "/coach/account" || path.hasPrefix("/coach/account/") || path == "/coach/privacy" ||
            path == "/account" || path.hasPrefix("/account/") || path == "/terms" || path == "/support" { return 4 }
        if path == "/coach" || path.hasPrefix("/coach/") { return 0 }
        return fallback
    }
}

private final class CoachWebState: ObservableObject {
    @Published var selectedIndex = 0
    @Published var loading = true
    @Published var failed = false
    @Published var firstPageLoaded = false
    weak var webView: WKWebView?

    func select(_ index: Int) {
        guard CoachNavigation.tabs.indices.contains(index) else { return }
        selectedIndex = index
        let target = CoachNavigation.url(path: CoachNavigation.tabs[index].path)
        if webView?.url != target { failed = false; webView?.load(CoachNavigation.request(path: CoachNavigation.tabs[index].path)) }
    }

    func update(path: String) {
        selectedIndex = CoachNavigation.selectedIndex(path: path, fallback: selectedIndex)
    }

    func reload() { failed = false; webView?.reload() }
}

struct CoachNativeShell: View {
    @StateObject private var state = CoachWebState()
    @State private var externalURL: URL?

    var body: some View {
        NavigationStack {
            ZStack {
                CoachWebView(state: state) { externalURL = $0 }
                if state.loading && state.firstPageLoaded {
                    ProgressView().tint(.green).accessibilityLabel("Loading Coach")
                }
                if state.failed {
                    ContentUnavailableView {
                        Label("Can’t load Coach", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text("Check your connection and try again.")
                    } actions: {
                        Button("Try again", action: state.reload).buttonStyle(.borderedProminent)
                    }
                    .background(Color(red: 0.02, green: 0.025, blue: 0.022))
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                CoachTabBar(selection: state.selectedIndex, select: state.select).frame(height: 49)
            }
        }
        .overlay { if !state.firstPageLoaded && !state.failed { CoachLaunchPresentation() } }
        .tint(Color(red: 0.18, green: 0.9, blue: 0.36))
        .preferredColorScheme(.dark)
        .sheet(isPresented: Binding(get: { externalURL != nil }, set: { if !$0 { externalURL = nil } })) {
            if let externalURL { CoachExternalPage(url: externalURL).ignoresSafeArea() }
        }
        .onOpenURL { url in
            guard url.scheme == "r12-coach", url.host == nil || url.host == "app.r12.live" else { return }
            var target = URLComponents(url: CoachNavigation.url(path: url.path.isEmpty ? "/coach" : url.path), resolvingAgainstBaseURL: false)!
            let original = URLComponents(url: url, resolvingAgainstBaseURL: false)
            target.percentEncodedQuery = original?.percentEncodedQuery
            target.percentEncodedFragment = original?.percentEncodedFragment
            if let destination = target.url, CoachNavigation.accepts(destination) {
                state.webView?.load(URLRequest(url: destination, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 30))
            }
        }
    }
}

private struct CoachWebView: UIViewRepresentable {
    @ObservedObject var state: CoachWebState
    let openExternal: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(state: state, openExternal: openExternal) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(context.coordinator, name: "coachRoute")
        let source = """
        if (location.origin === '\(CoachNavigation.origin)') {
          const mark = () => {
            if (!document.documentElement) return;
            document.documentElement.dataset.r12Shell = 'coach-ios';
            if (!document.getElementById('r12-coach-native-presentation')) {
              const style = document.createElement('style');
              style.id = 'r12-coach-native-presentation';
              style.textContent = `
                html[data-r12-shell="coach-ios"] [data-r12-coach-header],
                html[data-r12-shell="coach-ios"] [data-r12-coach-navigation],
                html[data-r12-shell="coach-ios"] [data-r12-coach-open-r12] { display:none!important; }
                html[data-r12-shell="coach-ios"] [data-r12-coach-shell] { padding-top:12px!important; padding-bottom:24px!important; min-height:0!important; }
              `;
              (document.head || document.documentElement).appendChild(style);
            }
          };
          const notify = () => window.webkit.messageHandlers.coachRoute.postMessage(location.pathname);
          for (const name of ['pushState', 'replaceState']) {
            const original = history[name];
            history[name] = function(...args) { const result = original.apply(this, args); mark(); notify(); return result; };
          }
          mark(); notify();
          addEventListener('DOMContentLoaded', () => { mark(); notify(); }, {once:true});
          addEventListener('popstate', notify); addEventListener('hashchange', notify);
        }
        """
        configuration.userContentController.addUserScript(WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.02, green: 0.025, blue: 0.022, alpha: 1)
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        let refresh = UIRefreshControl()
        refresh.accessibilityLabel = "Refresh page"
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.refresh), for: .valueChanged)
        webView.scrollView.refreshControl = refresh
        state.webView = webView
        webView.load(CoachNavigation.request(path: CoachNavigation.tabs[0].path))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "coachRoute")
        webView.navigationDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let state: CoachWebState
        let openExternal: (URL) -> Void
        init(state: CoachWebState, openExternal: @escaping (URL) -> Void) { self.state = state; self.openExternal = openExternal }

        @objc func refresh() { state.reload() }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "https",
                  message.frameInfo.securityOrigin.host == "app.r12.live", let path = message.body as? String else { return }
            state.update(path: path)
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if CoachNavigation.accepts(url) {
                if action.targetFrame == nil { webView.load(action.request); decisionHandler(.cancel) }
                else { decisionHandler(.allow) }
            } else if url.scheme == "https" {
                decisionHandler(.cancel); openExternal(url)
            } else if url.scheme == "mailto" || url.scheme == "tel" {
                decisionHandler(.cancel); UIApplication.shared.open(url)
            } else {
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { state.loading = true; state.failed = false }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            state.loading = false; state.failed = false; state.firstPageLoaded = true
            state.update(path: webView.url?.path ?? "/coach")
            webView.scrollView.refreshControl?.endRefreshing()
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error, webView) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error, webView) }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { state.loading = false; state.failed = true; webView.scrollView.refreshControl?.endRefreshing() }
        private func fail(_ error: Error, _ webView: WKWebView) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            state.loading = false; state.failed = true; webView.scrollView.refreshControl?.endRefreshing()
        }
    }
}

private struct CoachTabBar: UIViewRepresentable {
    let selection: Int
    let select: (Int) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(select: select) }
    func makeUIView(context: Context) -> UITabBar {
        let bar = UITabBar(); bar.delegate = context.coordinator
        let appearance = UITabBarAppearance(); appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(red: 0.02, green: 0.025, blue: 0.022, alpha: 1)
        bar.standardAppearance = appearance; bar.scrollEdgeAppearance = appearance
        bar.tintColor = UIColor(red: 0.18, green: 0.9, blue: 0.36, alpha: 1)
        bar.items = CoachNavigation.tabs.enumerated().map { UITabBarItem(title: $0.element.title, image: UIImage(systemName: $0.element.symbol), tag: $0.offset) }
        return bar
    }
    func updateUIView(_ bar: UITabBar, context: Context) { bar.selectedItem = bar.items?[selection] }
    final class Coordinator: NSObject, UITabBarDelegate {
        let select: (Int) -> Void
        init(select: @escaping (Int) -> Void) { self.select = select }
        func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) { select(item.tag) }
    }
}

private struct CoachLaunchPresentation: View {
    var body: some View {
        ZStack { Color.black; Image("LaunchLogo").resizable().scaledToFit().frame(width: 176, height: 176) }
            .ignoresSafeArea().accessibilityLabel("R12 Coach")
    }
}

private struct CoachExternalPage: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
