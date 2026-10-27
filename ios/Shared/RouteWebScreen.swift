import SafariServices
import SwiftUI
import UIKit
import WebKit

private final class RouteWebState: ObservableObject {
    @Published var isLoading = true
    @Published var errorMessage: String?
    @Published var canGoBack = false
    @Published var shareURL: URL?
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
    let activation: Int
    let selectDestination: (AppDestination) -> Void
    @StateObject private var state = RouteWebState()
    @State private var safariURL: URL?

    var body: some View {
        ZStack {
            R12WebView(
                url: configuration.url(for: destination.path),
                state: state,
                configuration: configuration,
                activation: activation,
                selectDestination: selectDestination,
                openExternal: { url in safariURL = url }
            )
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
    let configuration: NativeAppConfiguration
    let activation: Int
    let selectDestination: (AppDestination) -> Void
    let openExternal: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(state: state, configuration: configuration, destinationURL: url, selectDestination: selectDestination, openExternal: openExternal) }

    func makeUIView(context: Context) -> WKWebView {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.websiteDataStore = .default()
        if configuration.scheme == "r12-glowzone" {
            let nativeStyle = WKUserScript(
                source: "document.documentElement.classList.add('r12-glow-native')",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false
            )
            webConfiguration.userContentController.addUserScript(nativeStyle)
        }
        let webView = WKWebView(frame: .zero, configuration: webConfiguration)
        if configuration.scheme == "r12-glowzone" {
            webView.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 R12GlowZoneIOS"
        }
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
        context.coordinator.load(url, activation: activation, into: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.load(url, activation: activation, into: webView)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private let state: RouteWebState
        private let configuration: NativeAppConfiguration
        private let destinationURL: URL
        private let selectDestination: (AppDestination) -> Void
        private let openExternal: (URL) -> Void
        // This tracks only requests issued by SwiftUI. It must not be replaced
        // with webView.url after a redirect: published navigation state causes
        // updateUIView to run again, and comparing the redirected URL with the
        // tab destination would otherwise restart the request indefinitely.
        private var lastRequestedURL: URL?
        private var lastActivation: Int?

        init(state: RouteWebState, configuration: NativeAppConfiguration, destinationURL: URL, selectDestination: @escaping (AppDestination) -> Void, openExternal: @escaping (URL) -> Void) {
            self.state = state
            self.configuration = configuration
            self.destinationURL = destinationURL
            self.selectDestination = selectDestination
            self.openExternal = openExternal
        }

        func load(_ url: URL, activation: Int, into webView: WKWebView) {
            let activatedAgain = lastActivation != nil && lastActivation != activation
            guard activatedAgain || lastRequestedURL != url else { return }
            lastActivation = activation
            lastRequestedURL = url
            DispatchQueue.main.async { [weak self] in
                guard let self, self.lastRequestedURL == url else { return }
                self.state.errorMessage = nil
                self.state.isLoading = true
                self.state.shareURL = nil
            }
            webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
        }

        @objc func refresh() {
            state.reload()
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            let rejectionReason = configuration.embeddedNavigationRejectionReason(for: url)
            if rejectionReason == nil {
                if action.targetFrame?.isMainFrame != false,
                   action.navigationType == .linkActivated,
                   let selected = configuration.destination(for: url),
                   configuration.url(for: selected.path) != destinationURL {
                    decisionHandler(.cancel)
                    DispatchQueue.main.async { [selectDestination] in selectDestination(selected) }
                    return
                }
                decisionHandler(.allow)
                return
            }
            if url.scheme == "https", url.host?.lowercased() == "app.r12.live", configuration.scheme == "r12-glowzone" {
#if DEBUG
                Self.logRejectedGlowNavigation(url: url, action: action, reason: rejectionReason ?? "unknown")
#endif
                decisionHandler(.cancel)
                // Never replace the main page because a disallowed iframe was
                // rejected, and never force-reload a rejected redirect into a
                // cancellation loop. A tab reactivation remains the explicit
                // way to restore its configured destination.
                if action.targetFrame?.isMainFrame != false {
                    state.isLoading = false
                    webView.scrollView.refreshControl?.endRefreshing()
                    if webView.url == nil {
                        state.errorMessage = "This page isn’t available in Glow Zone. Select the tab again to retry."
                    }
                }
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

#if DEBUG
        private static func logRejectedGlowNavigation(url: URL, action: WKNavigationAction, reason: String) {
            let path = diagnosticPath(url.path)
            let mainFrame = action.targetFrame?.isMainFrame != false
            print("[GlowZoneNavigation] rejected path=\(path) navigationType=\(action.navigationType.rawValue) mainFrame=\(mainFrame) reason=\(reason)")
        }

        private static func diagnosticPath(_ path: String) -> String {
            let safePaths: Set<String> = [
                "/", "/account", "/account/verify", "/account/reset", "/account/delete",
                "/auth/callback", "/auth/confirm", "/auth/verify", "/terms",
                "/glow-zone", "/glow-zone/use", "/glow-zone/buy", "/glow-zone/privacy",
                "/training", "/club", "/coach"
            ]
            if safePaths.contains(path) { return path }
            if path.hasPrefix("/training/") { return "/training/<redacted>" }
            if path.hasPrefix("/club/") { return "/club/<redacted>" }
            if path.hasPrefix("/coach/") { return "/coach/<redacted>" }
            return "/<redacted>"
        }
#endif

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            state.isLoading = true
            state.errorMessage = nil
            state.shareURL = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
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
            if nsError.code == NSURLErrorCancelled {
                // A superseding request keeps WebKit loading. A cancellation
                // with no replacement must still clear the native spinner.
                if !webView.isLoading {
                    state.isLoading = false
                    webView.scrollView.refreshControl?.endRefreshing()
                }
                return
            }
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
