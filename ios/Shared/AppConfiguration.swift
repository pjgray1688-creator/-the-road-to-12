import SwiftUI

struct AppDestination: Identifiable, Hashable {
    let title: String
    let path: String
    let symbol: String

    var id: String { path }
    var route: String {
        path.split(separator: "?", maxSplits: 1).first.map { "/" + $0 } ?? "/"
    }
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
        scope: { $0 == "/glow-zone" || $0.hasPrefix("/glow-zone/") || $0 == "/account" },
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
        components.path = path.split(separator: "?", maxSplits: 1).first.map { "/" + $0 } ?? "/"
        if let query = path.split(separator: "?", maxSplits: 1).dropFirst().first {
            components.percentEncodedQuery = String(query)
        }
        return components.url ?? URL(string: "https://app.r12.live/")!
    }
}
