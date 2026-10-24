import SwiftUI
import WebKit
import SafariServices

private final class ClubWebState: ObservableObject {
    @Published var selectedIndex = 0
    @Published var canGoBack = false
    @Published var loading = true
    @Published var failed = false
    weak var webView: WKWebView?
    func select(_ index: Int) {
        guard ClubNavigation.tabs.indices.contains(index) else { return }
        selectedIndex = index
        let target = ClubNavigation.url(path: ClubNavigation.tabs[index].path, context: webView?.url)
        if webView?.url != target { failed = false; webView?.load(URLRequest(url: target)) }
    }
    func updateRoute(_ path: String) { selectedIndex = ClubNavigation.selectedIndex(path: path, fallback: selectedIndex) }
    func reload() { failed = false; webView?.reload() }
}

struct ClubNativeShell: View {
    @StateObject private var state = ClubWebState()
    @State private var externalURL: URL?
    var body: some View {
        NavigationStack {
            ZStack {
                ClubWebView(state: state) { externalURL = $0 }
                if state.loading { ProgressView().tint(.purple).accessibilityLabel("Loading Club") }
                if state.failed {
                    ContentUnavailableView {
                        Label("Can’t load Club", systemImage: "wifi.exclamationmark")
                    } description: { Text("Check your connection and try again.") } actions: {
                        Button("Try again", action: state.reload).buttonStyle(.borderedProminent)
                    }.background(Color(red: 0.035, green: 0.04, blue: 0.055))
                }
            }
            .navigationTitle("R12 Club").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if state.canGoBack {
                        Button { state.webView?.goBack() } label: { Image(systemName: "chevron.left") }
                            .accessibilityLabel("Go back").frame(minWidth: 44, minHeight: 44)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Reload page", systemImage: "arrow.clockwise", action: state.reload)
                        Button("Privacy policy", systemImage: "hand.raised") { externalURL = ClubNavigation.url(path: "/club/privacy") }
                    } label: { Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44) }
                    .accessibilityLabel("Page options")
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                ClubTabBar(selection: state.selectedIndex, select: state.select).frame(height: 49)
            }
        }
        .tint(Color(red: 0.62, green: 0.38, blue: 0.96)).preferredColorScheme(.dark)
        .sheet(isPresented: Binding(get: { externalURL != nil }, set: { if !$0 { externalURL = nil } })) {
            if let externalURL { ClubExternalPage(url: externalURL).ignoresSafeArea() }
        }
        .onOpenURL { url in
            guard url.scheme == "r12-club", url.host == nil || url.host == "app.r12.live",
                  url.path == "/club" || url.path.hasPrefix("/club/") || url.path == "/account" || url.path.hasPrefix("/account/") else { return }
            var target = URLComponents(url: ClubNavigation.url(path: url.path), resolvingAgainstBaseURL: false)!
            let original = URLComponents(url: url, resolvingAgainstBaseURL: false)
            target.percentEncodedQuery = original?.percentEncodedQuery
            target.percentEncodedFragment = original?.percentEncodedFragment
            if let destination = target.url { state.webView?.load(URLRequest(url: destination)) }
        }
    }
}

private struct ClubWebView: UIViewRepresentable {
    @ObservedObject var state: ClubWebState
    let openExternal: (URL) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(state: state, openExternal: openExternal) }
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(context.coordinator, name: "clubRoute")
        let script = """
        if (location.origin === 'https://app.r12.live') {
          const notify = () => window.webkit.messageHandlers.clubRoute.postMessage(location.pathname);
          for (const name of ['pushState', 'replaceState']) {
            const original = history[name];
            history[name] = function(...args) { const result = original.apply(this, args); notify(); return result; };
          }
          addEventListener('popstate', notify); addEventListener('hashchange', notify);
          const ready = () => {
            document.documentElement.dataset.r12Shell = 'club-ios';
            const style = document.createElement('style');
            style.textContent = 'html[data-r12-shell="club-ios"] [data-r12-web-navigation="member"]{display:none!important} html[data-r12-shell="club-ios"] main.club-page{padding-bottom:24px!important;min-height:0!important}';
            (document.head || document.documentElement).appendChild(style); notify();
          };
          if (document.readyState === 'loading') addEventListener('DOMContentLoaded', ready, {once:true}); else ready();
        }
        """
        config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = context.coordinator
        web.allowsBackForwardNavigationGestures = true
        web.isOpaque = false; web.backgroundColor = UIColor(red: 0.035, green: 0.04, blue: 0.055, alpha: 1)
        web.scrollView.keyboardDismissMode = .interactive
        web.scrollView.contentInsetAdjustmentBehavior = .automatic
        let refresh = UIRefreshControl(); refresh.addTarget(context.coordinator, action: #selector(Coordinator.refresh), for: .valueChanged)
        web.scrollView.refreshControl = refresh
        state.webView = web
        context.coordinator.backObservation = web.observe(\.canGoBack, options: [.initial, .new]) { [weak state] web, _ in
            DispatchQueue.main.async { state?.canGoBack = web.canGoBack }
        }
        web.load(URLRequest(url: ClubNavigation.url(path: ClubNavigation.tabs[0].path)))
        return web
    }
    func updateUIView(_ web: WKWebView, context: Context) {}
    static func dismantleUIView(_ web: WKWebView, coordinator: Coordinator) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "clubRoute")
        coordinator.backObservation?.invalidate(); web.navigationDelegate = nil
    }
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let state: ClubWebState
        let openExternal: (URL) -> Void
        var backObservation: NSKeyValueObservation?
        init(state: ClubWebState, openExternal: @escaping (URL) -> Void) { self.state = state; self.openExternal = openExternal }
        @objc func refresh() { state.reload() }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "https",
                  message.frameInfo.securityOrigin.host == "app.r12.live", let path = message.body as? String, path.hasPrefix("/") else { return }
            state.updateRoute(path)
        }
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "https", url.host == "app.r12.live", url.user == nil, url.password == nil, url.port == nil || url.port == 443 {
                if action.targetFrame == nil { webView.load(action.request); decisionHandler(.cancel) } else { decisionHandler(.allow) }
            } else if url.scheme == "https" { decisionHandler(.cancel); openExternal(url) }
            else if url.scheme == "mailto" || url.scheme == "tel" { decisionHandler(.cancel); UIApplication.shared.open(url) }
            else { decisionHandler(.cancel) }
        }
        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { state.loading = true; state.failed = false }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            state.loading = false; state.failed = false; state.canGoBack = webView.canGoBack
            state.updateRoute(webView.url?.path ?? ""); webView.scrollView.refreshControl?.endRefreshing()
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error, webView) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error, webView) }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { state.loading = false; state.failed = true; webView.scrollView.refreshControl?.endRefreshing() }
        private func fail(_ error: Error, _ web: WKWebView) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            state.loading = false; state.failed = true; web.scrollView.refreshControl?.endRefreshing()
        }
    }
}

private struct ClubTabBar: UIViewRepresentable {
    let selection: Int
    let select: (Int) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(select: select) }
    func makeUIView(context: Context) -> UITabBar {
        let bar = UITabBar(); bar.delegate = context.coordinator
        let appearance = UITabBarAppearance(); appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(red: 0.035, green: 0.04, blue: 0.055, alpha: 1)
        bar.standardAppearance = appearance; bar.scrollEdgeAppearance = appearance
        bar.tintColor = UIColor(red: 0.62, green: 0.38, blue: 0.96, alpha: 1)
        bar.items = ClubNavigation.tabs.enumerated().map { UITabBarItem(title: $0.element.title, image: UIImage(systemName: $0.element.symbol), tag: $0.offset) }
        return bar
    }
    func updateUIView(_ bar: UITabBar, context: Context) { bar.selectedItem = bar.items?[selection] }
    final class Coordinator: NSObject, UITabBarDelegate {
        let select: (Int) -> Void
        init(select: @escaping (Int) -> Void) { self.select = select }
        func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) { select(item.tag) }
    }
}
private struct ClubExternalPage: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
