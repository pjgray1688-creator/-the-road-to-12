import SafariServices
import SwiftUI
import UIKit
import WebKit
import os

private final class RouteWebState: ObservableObject {
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var canGoBack = false
    @Published var shareURL: URL?
    @Published var currentPath = "/"
    weak var webView: WKWebView?

    func reload() {
        errorMessage = nil
        isLoading = true
        webView?.reload()
    }

    func goBack() { webView?.goBack() }
}

struct RouteWebScreen: View {
    let configuration: NativeAppConfiguration
    let destination: AppDestination
    @StateObject private var state = RouteWebState()
    @State private var safariURL: URL?

    var body: some View {
        ZStack {
            R12WebView(url: configuration.url(for: destination.path), state: state) { url in
                safariURL = url
            }
            .overlay(alignment: .top) {
                if state.isLoading && state.errorMessage == nil {
                    ProgressView()
                        .tint(configuration.tint)
                        .padding(.top, 8)
                        .accessibilityLabel("Loading \(destination.title)")
                }
            }

            if let error = state.errorMessage {
                ContentUnavailableView {
                    Label("Can’t load this page", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(error)
                } actions: {
                    Button("Try again", action: state.reload)
                        .buttonStyle(.borderedProminent)
                        .tint(configuration.tint)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(red: 0.035, green: 0.04, blue: 0.055))
                .transition(.opacity)
            }
        }
        .background(Color(red: 0.035, green: 0.04, blue: 0.055))
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button(action: state.goBack) {
                    Image(systemName: "chevron.left")
                }
                .disabled(!state.canGoBack)
                .accessibilityLabel("Go back")

                Button(action: state.reload) {
                    Image(systemName: "arrow.clockwise")
                }
                .disabled(state.isLoading || state.errorMessage != nil)
                .accessibilityLabel("Reload page")

                Button {
                    safariURL = configuration.url(for: configuration.privacyPath)
                } label: {
                    Image(systemName: "hand.raised")
                }
                .accessibilityLabel("Privacy policy")

                if let shareURL = state.shareURL {
                    ShareLink(item: shareURL) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share current page")
                }
            }
        }
        .sheet(isPresented: Binding(
            get: { safariURL != nil },
            set: { if !$0 { safariURL = nil } }
        )) {
            if let safariURL {
                SafariView(url: safariURL).ignoresSafeArea()
            }
        }
    }
}

private struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

private struct R12WebView: UIViewRepresentable {
    let url: URL
    @ObservedObject var state: RouteWebState
    var memberShell = false
    let openExternal: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(state: state, openExternal: openExternal) }

    func makeUIView(context: Context) -> WKWebView {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.websiteDataStore = .default()
        if memberShell {
            // App-injected presentation context, never a query parameter or persisted cookie.
            let source = """
            if (location.origin === 'https://app.r12.live') {
              Object.defineProperty(window, '__R12_MEMBER_IOS__', {value: true});
              const mark = () => {
                if (!document.documentElement) return;
                document.documentElement.dataset.r12Shell = 'member-ios';
                if (!document.getElementById('r12-native-presentation')) {
                  const style = document.createElement('style');
                  style.id = 'r12-native-presentation';
                  // Explicit member selectors also support the currently deployed web version.
                  style.textContent = `
                    html[data-r12-shell="member-ios"] [data-r12-web-navigation="member"],
                    html[data-r12-shell="member-ios"] nav.app-nav[aria-label="Primary navigation"],
                    html[data-r12-shell="member-ios"] nav.app-nav[aria-label="Member Area navigation"] { display: none !important; }
                    html[data-r12-shell="member-ios"] [data-r12-content="member"],
                    html[data-r12-shell="member-ios"] main.shell.home-screen,
                    html[data-r12-shell="member-ios"] main.shell.module-page,
                    html[data-r12-shell="member-ios"] main.app-shell { padding-bottom: 24px !important; min-height: 100dvh; }
                  `;
                  (document.head || document.documentElement).appendChild(style);
                }
              };
              mark();
              document.addEventListener('DOMContentLoaded', mark, {once: true});
            }
            """
            webConfiguration.userContentController.addUserScript(WKUserScript(source: source,
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.035, green: 0.04, blue: 0.055, alpha: 1)
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
        webView.scrollView.keyboardDismissMode = .interactive
        let refreshControl = UIRefreshControl()
        refreshControl.accessibilityLabel = "Refresh page"
        refreshControl.addTarget(context.coordinator, action: #selector(Coordinator.refresh), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl
        state.webView = webView
        context.coordinator.load(url, into: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.load(url, into: webView)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let state: RouteWebState
        private let openExternal: (URL) -> Void
        private let startupLogger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "live.r12", category: "WebNavigation")
        private var navigationStartedAt = ProcessInfo.processInfo.systemUptime
        private var lastURL: URL?
        private var urlObservation: NSKeyValueObservation?

        init(state: RouteWebState, openExternal: @escaping (URL) -> Void) {
            self.state = state
            self.openExternal = openExternal
        }

        func load(_ url: URL, into webView: WKWebView) {
            guard lastURL != url else { return }
            lastURL = url
            state.errorMessage = nil
            state.isLoading = true
            state.shareURL = nil
            if urlObservation == nil {
                urlObservation = webView.observe(\.url, options: [.new]) { [weak self] view, _ in
                    guard let url = view.url, url.host == "app.r12.live" else { return }
                    DispatchQueue.main.async {
                        self?.state.currentPath = url.path
                        self?.state.canGoBack = view.canGoBack
                    }
                }
            }
            webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
        }

        @objc func refresh() {
            state.reload()
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "https", url.host == "app.r12.live",
               url.user == nil, url.password == nil, url.port == nil || url.port == 443 {
                decisionHandler(.allow)
                return
            }
            if action.targetFrame == nil, url.scheme == "https" {
                decisionHandler(.cancel)
                openExternal(url)
                return
            }
            if url.scheme == "https" {
                decisionHandler(.cancel)
                openExternal(url)
                return
            }
            if url.scheme == "mailto" || url.scheme == "tel" {
                decisionHandler(.cancel)
                UIApplication.shared.open(url)
                return
            }
            decisionHandler(.cancel)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            navigationStartedAt = ProcessInfo.processInfo.systemUptime
            startupLogger.debug("Web navigation started")
            state.isLoading = true
            state.errorMessage = nil
            state.shareURL = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            startupLogger.debug("Web document loaded after \(ProcessInfo.processInfo.systemUptime - self.navigationStartedAt, privacy: .public) seconds")
            state.isLoading = false
            state.canGoBack = webView.canGoBack
            webView.scrollView.refreshControl?.endRefreshing()
            if let url = webView.url { state.shareURL = Self.safeShareURL(from: url) }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            fail(error, in: webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            fail(error, in: webView)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            state.isLoading = false
            state.errorMessage = "The page stopped responding. Try again to reload it."
            webView.scrollView.refreshControl?.endRefreshing()
        }

        private func fail(_ error: Error, in webView: WKWebView) {
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else { return }
            state.isLoading = false
            state.errorMessage = "Check your connection and try again."
            state.canGoBack = webView.canGoBack
            state.shareURL = nil
            webView.scrollView.refreshControl?.endRefreshing()
        }

        private static func safeShareURL(from url: URL) -> URL? {
            let shareablePaths: Set<String> = ["/training", "/progress", "/coach", "/glow-zone", "/privacy", "/terms"]
            guard url.scheme == "https", url.host == "app.r12.live", url.user == nil,
                  url.password == nil, url.query == nil, url.fragment == nil,
                  shareablePaths.contains(url.path) else { return nil }
            var components = URLComponents()
            components.scheme = "https"
            components.host = "app.r12.live"
            components.path = url.path
            return components.url
        }
    }
}


// One persistent browsing context avoids four concurrent authentication restorations.
struct R12MemberShell: View {
    let configuration: NativeAppConfiguration
    @StateObject private var state = RouteWebState()
    @State private var safariURL: URL?
    private var selectedIndex: Int {
        let path = state.currentPath
        if path == "/training" || path.hasPrefix("/training/") || path.hasPrefix("/workout") || path == "/onboarding" { return 1 }
        if path == "/progress" || path.hasPrefix("/progress/") || path == "/history" { return 2 }
        if path == "/account" || path.hasPrefix("/account/") || path == "/coach" || path.hasPrefix("/coach/") || path == "/privacy" || path == "/terms" { return 3 }
        return 0
    }
    var body: some View {
        NavigationStack {
            ZStack {
                R12WebView(url: configuration.url(for: "/"), state: state, memberShell: true) { safariURL = $0 }
                if state.isLoading {
                    ProgressView("Loading R12…").padding(12)
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
                if let error = state.errorMessage {
                    ContentUnavailableView {
                        Label("Can’t load R12", systemImage: "wifi.exclamationmark")
                    } description: { Text(error) } actions: {
                        Button("Try again", action: state.reload).buttonStyle(.borderedProminent)
                    }.background(Color(red: 0.035, green: 0.04, blue: 0.055))
                }
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if state.canGoBack {
                        Button(action: state.goBack) { Image(systemName: "chevron.left") }
                            .accessibilityLabel("Go back").frame(minWidth: 44, minHeight: 44)
                    }
                }
                ToolbarItem(placement: .principal) { Text("R12").font(.headline).foregroundStyle(configuration.tint) }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button("Reload page", systemImage: "arrow.clockwise", action: state.reload)
                        Button("Privacy policy", systemImage: "hand.raised") { safariURL = configuration.url(for: configuration.privacyPath) }
                    } label: { Image(systemName: "ellipsis.circle").frame(minWidth: 44, minHeight: 44) }
                    .accessibilityLabel("Page options")
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .safeAreaInset(edge: .bottom, spacing: 0) {
                R12MemberTabBar(destinations: configuration.destinations, selection: selectedIndex) { index in
                    state.webView?.load(URLRequest(url: configuration.url(for: configuration.destinations[index].path)))
                }.frame(height: 49)
            }
        }
        .tint(configuration.tint).preferredColorScheme(.dark)
        .sheet(isPresented: Binding(get: { safariURL != nil }, set: { if !$0 { safariURL = nil } })) {
            if let safariURL { SafariView(url: safariURL).ignoresSafeArea() }
        }
        .onOpenURL { url in
            guard url.scheme == configuration.scheme, url.host == nil || url.host == "app.r12.live" else { return }
            // Preserve app-scoped auth callbacks, including query and fragment tokens.
            var target = URLComponents(url: configuration.url(for: url.path.isEmpty ? "/" : url.path), resolvingAgainstBaseURL: false)!
            target.percentEncodedQuery = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery
            target.percentEncodedFragment = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedFragment
            if let targetURL = target.url { state.webView?.load(URLRequest(url: targetURL)) }
        }
    }
}

private struct R12MemberTabBar: UIViewRepresentable {
    let destinations: [AppDestination]
    let selection: Int
    let select: (Int) -> Void
    func makeCoordinator() -> Coordinator { Coordinator(select: select) }
    func makeUIView(context: Context) -> UITabBar {
        let bar = UITabBar()
        bar.delegate = context.coordinator
        bar.tintColor = UIColor(red: 0.62, green: 0.38, blue: 0.96, alpha: 1)
        let appearance = UITabBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(red: 0.035, green: 0.04, blue: 0.055, alpha: 1)
        bar.standardAppearance = appearance
        bar.scrollEdgeAppearance = appearance
        bar.items = destinations.enumerated().map { index, item in
            UITabBarItem(title: item.title, image: UIImage(systemName: item.symbol), tag: index)
        }
        return bar
    }
    func updateUIView(_ bar: UITabBar, context: Context) { bar.selectedItem = bar.items?[selection] }
    final class Coordinator: NSObject, UITabBarDelegate {
        let select: (Int) -> Void
        init(select: @escaping (Int) -> Void) { self.select = select }
        func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) { select(item.tag) }
    }
}
