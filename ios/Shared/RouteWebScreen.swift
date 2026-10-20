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
        VStack(spacing: 0) {
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
            } else {
                R12WebView(url: configuration.url(for: destination.path), state: state) { url in
                    safariURL = url
                }
                .accessibilityLabel("\(configuration.name) \(destination.title)")
                .overlay(alignment: .top) {
                    if state.isLoading {
                        ProgressView().tint(configuration.tint).padding(.top, 8)
                    }
                }
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
                .accessibilityLabel("Reload page")

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
    let openExternal: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(state: state, openExternal: openExternal) }

    func makeUIView(context: Context) -> WKWebView {
        let webConfiguration = WKWebViewConfiguration()
        webConfiguration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: webConfiguration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.035, green: 0.04, blue: 0.055, alpha: 1)
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic
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
        private var lastURL: URL?

        init(state: RouteWebState, openExternal: @escaping (URL) -> Void) {
            self.state = state
            self.openExternal = openExternal
        }

        func load(_ url: URL, into webView: WKWebView) {
            guard lastURL != url else { return }
            lastURL = url
            state.errorMessage = nil
            state.isLoading = true
            webView.load(URLRequest(url: url, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { decisionHandler(.cancel); return }
            if url.scheme == "https", url.host == "app.r12.live" {
                decisionHandler(.allow)
                return
            }
            if action.targetFrame == nil, url.scheme == "https" || url.scheme == "http" {
                decisionHandler(.cancel)
                openExternal(url)
                return
            }
            if url.scheme == "https" || url.scheme == "http" {
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
            state.isLoading = true
            state.errorMessage = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            state.isLoading = false
            state.canGoBack = webView.canGoBack
            if let url = webView.url, url.host == "app.r12.live" { state.shareURL = url }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            fail(error)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            fail(error)
        }

        private func fail(_ error: Error) {
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else { return }
            state.isLoading = false
            state.errorMessage = "Check your connection and try again."
        }
    }
}
