import SwiftUI

private func normalizedRoutePath(_ value: String) -> String {
    let rawPath = String(value.split(separator: "?", maxSplits: 1).first ?? "")
    var path = rawPath.hasPrefix("/") ? rawPath : "/" + rawPath
    while path.count > 1 && path.hasSuffix("/") { path.removeLast() }
    return path
}

struct AppDestination: Identifiable, Hashable {
    let title: String
    let path: String
    let symbol: String

    var id: String { path }
    var route: String { normalizedRoutePath(path) }
}

struct NativeAppConfiguration {
    let name: String
    let descriptor: String
    let tint: Color
    let scheme: String
    let privacyPath: String
    let scope: (String) -> Bool
    let destinations: [AppDestination]

    static let r12 = NativeAppConfiguration(
        name: "R12",
        descriptor: "Training that moves with you.",
        tint: Color(red: 0.62, green: 0.38, blue: 0.96),
        scheme: "r12-training",
        privacyPath: "/privacy",
        scope: { _ in true },
        destinations: [
            AppDestination(title: "Training", path: "/training", symbol: "figure.strengthtraining.traditional"),
            AppDestination(title: "Progress", path: "/progress", symbol: "chart.xyaxis.line"),
            AppDestination(title: "Account", path: "/account?app=training", symbol: "person.crop.circle")
        ]
    )

    static let club = NativeAppConfiguration(
        name: "R12 Club",
        descriptor: "Daily checks and member inductions on the gym floor.",
        tint: Color(red: 0.62, green: 0.38, blue: 0.96),
        scheme: "r12-club",
        privacyPath: "/club/privacy",
        scope: { $0 == "/club" || $0.hasPrefix("/club/") || $0 == "/account" },
        destinations: [
            AppDestination(title: "Reception", path: "/club/reception", symbol: "person.2.badge.key"),
            AppDestination(title: "Daily checks", path: "/club/checks", symbol: "checklist"),
            AppDestination(title: "Inductions", path: "/club/induction", symbol: "figure.walk"),
            AppDestination(title: "Overview", path: "/club", symbol: "chart.bar.xaxis"),
            AppDestination(title: "More", path: "/club/more", symbol: "ellipsis.circle")
        ]
    )

    static let coach = NativeAppConfiguration(
        name: "R12 Coach",
        descriptor: "Your clients, sessions and programmes.",
        tint: Color(red: 0.72, green: 0.49, blue: 0.98),
        scheme: "r12-coach",
        privacyPath: "/coach/privacy",
        scope: { $0 == "/coach" || $0.hasPrefix("/coach/") || $0 == "/account" },
        destinations: [
            AppDestination(title: "Workspace", path: "/coach", symbol: "rectangle.grid.2x2"),
            AppDestination(title: "Diary", path: "/coach/diary", symbol: "calendar"),
            AppDestination(title: "Programmes", path: "/coach/programmes", symbol: "list.clipboard"),
            AppDestination(title: "Coach account", path: "/coach/account", symbol: "person.crop.circle"),
            AppDestination(title: "R12 account", path: "/account?app=coach&next=%2Fcoach", symbol: "person.text.rectangle")
        ]
    )

    static let glowZone = NativeAppConfiguration(
        name: "Glow Zone",
        descriptor: "Carlton sunbeds, minutes and sessions.",
        tint: Color(red: 0.72, green: 1.00, blue: 0.24),
        scheme: "r12-glowzone",
        privacyPath: "/glow-zone/privacy",
        scope: { $0 == "/glow-zone" || $0.hasPrefix("/glow-zone/") },
        destinations: [
            AppDestination(title: "Home", path: "/glow-zone", symbol: "sparkles"),
            AppDestination(title: "Use Sunbed", path: "/glow-zone/use", symbol: "sun.max.fill"),
            AppDestination(title: "Buy Minutes", path: "/glow-zone/buy", symbol: "plus.circle.fill"),
            AppDestination(title: "Account", path: "/account?app=glow&next=%2Fglow-zone", symbol: "person.crop.circle")
        ]
    )

    func url(for path: String) -> URL {
        var components = URLComponents()
        components.scheme = "https"
        components.host = "app.r12.live"
        components.path = normalizedRoutePath(path)
        if let query = path.split(separator: "?", maxSplits: 1).dropFirst().first {
            components.percentEncodedQuery = String(query)
        }
        return components.url ?? URL(string: "https://app.r12.live/")!
    }

    func embeddedNavigationRejectionReason(for url: URL) -> String? {
        guard url.scheme == "https" else { return "non_https_scheme" }
        guard url.host?.lowercased() == "app.r12.live", url.user == nil, url.password == nil,
              url.port == nil || url.port == 443 else { return "non_canonical_origin" }
        guard scheme == "r12-glowzone" else { return nil }
        let path = normalizedRoutePath(url.path)
        if scope(path) || path == "/terms" || path == "/auth/verify" { return nil }
        let sharedAuthPaths: Set<String> = ["/account", "/account/verify", "/account/reset", "/account/delete", "/auth/callback", "/auth/confirm"]
        guard sharedAuthPaths.contains(path) else { return "outside_glow_route_scope" }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return "invalid_url" }
        var queryItems = components.queryItems ?? []
        let nestedRedirects = queryItems.filter { $0.name == "redirect_to" }.compactMap(\.value)
        if nestedRedirects.count > 1 { return "ambiguous_auth_context" }
        if let nestedValue = nestedRedirects.first,
           let nestedURL = URL(string: nestedValue),
           nestedURL.scheme == "https", nestedURL.host?.lowercased() == "app.r12.live",
           normalizedRoutePath(nestedURL.path) == "/account/reset",
           let nestedComponents = URLComponents(url: nestedURL, resolvingAgainstBaseURL: false) {
            queryItems.append(contentsOf: nestedComponents.queryItems ?? [])
        }
        let appValues = queryItems.filter { $0.name == "app" || $0.name == "privacyApp" }.compactMap(\.value)
        guard appValues.isEmpty || appValues.allSatisfy({ $0 == "glow" }) else { return "non_glow_auth_context" }
        let nextValues = queryItems.filter { $0.name == "next" }.compactMap(\.value)
        if let next = nextValues.first {
            guard nextValues.count == 1, next == "/glow-zone" || next.hasPrefix("/glow-zone/") else { return "non_glow_return_destination" }
        }
        return appValues.isEmpty && nextValues.isEmpty ? "missing_glow_auth_context" : nil
    }

    func allowsEmbeddedNavigation(to url: URL) -> Bool {
        embeddedNavigationRejectionReason(for: url) == nil
    }

    /// Returns a native tab only for an exact configured destination. Auth
    /// redirects may share a pathname but include different query intent and
    /// must remain inside the tab that initiated them.
    func destination(for url: URL) -> AppDestination? {
        guard scheme == "r12-glowzone", url.scheme == "https", url.host == "app.r12.live" else { return nil }
        return destinations.first { destination in
            guard let configured = URLComponents(url: self.url(for: destination.path), resolvingAgainstBaseURL: false),
                  let candidate = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  normalizedRoutePath(configured.path) == normalizedRoutePath(candidate.path) else { return false }
            let configuredQuery = (configured.queryItems ?? []).map { "\($0.name)=\($0.value ?? "")" }.sorted()
            let candidateQuery = (candidate.queryItems ?? []).map { "\($0.name)=\($0.value ?? "")" }.sorted()
            return configuredQuery == candidateQuery
        }
    }
}
