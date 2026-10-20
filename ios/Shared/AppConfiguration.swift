import SwiftUI

struct AppDestination: Identifiable, Hashable {
    let title: String
    let path: String
    let symbol: String

    var id: String { path }
}

struct NativeAppConfiguration {
    let name: String
    let descriptor: String
    let tint: Color
    let scheme: String
    let scope: (String) -> Bool
    let destinations: [AppDestination]

    static let r12 = NativeAppConfiguration(
        name: "R12",
        descriptor: "Training that moves with you.",
        tint: Color(red: 0.62, green: 0.38, blue: 0.96),
        scheme: "r12-training",
        scope: { _ in true },
        destinations: [
            AppDestination(title: "Training", path: "/training", symbol: "figure.strengthtraining.traditional"),
            AppDestination(title: "Progress", path: "/progress", symbol: "chart.xyaxis.line"),
            AppDestination(title: "Account", path: "/account", symbol: "person.crop.circle")
        ]
    )

    static let club = NativeAppConfiguration(
        name: "R12 Club",
        descriptor: "Daily checks and member inductions on the gym floor.",
        tint: Color(red: 0.62, green: 0.38, blue: 0.96),
        scheme: "r12-club",
        scope: { $0 == "/club" || $0.hasPrefix("/club/") || $0 == "/account" },
        destinations: [
            AppDestination(title: "Daily checks", path: "/club/checks", symbol: "checklist"),
            AppDestination(title: "Members", path: "/club", symbol: "person.3"),
            AppDestination(title: "Inductions", path: "/club/induction", symbol: "figure.walk"),
            AppDestination(title: "Reception", path: "/club/reception", symbol: "person.2.badge.key"),
            AppDestination(title: "More", path: "/club/more", symbol: "ellipsis.circle")
        ]
    )

    static let coach = NativeAppConfiguration(
        name: "R12 Coach",
        descriptor: "Your clients, sessions and programmes.",
        tint: Color(red: 0.72, green: 0.49, blue: 0.98),
        scheme: "r12-coach",
        scope: { $0 == "/coach" || $0.hasPrefix("/coach/") || $0 == "/account" },
        destinations: [
            AppDestination(title: "Workspace", path: "/coach", symbol: "rectangle.grid.2x2"),
            AppDestination(title: "Diary", path: "/coach/diary", symbol: "calendar"),
            AppDestination(title: "Programmes", path: "/coach/programmes", symbol: "list.clipboard"),
            AppDestination(title: "Coach account", path: "/coach/account", symbol: "person.crop.circle"),
            AppDestination(title: "R12 account", path: "/account", symbol: "person.text.rectangle")
        ]
    )

    static let glowZone = NativeAppConfiguration(
        name: "Glow Zone",
        descriptor: "Your Glow Zone balance and activity.",
        tint: Color(red: 0.23, green: 0.82, blue: 0.54),
        scheme: "r12-glowzone",
        scope: { $0 == "/glow-zone" || $0.hasPrefix("/glow-zone/") || $0 == "/account" },
        destinations: [
            AppDestination(title: "Glow Zone", path: "/glow-zone", symbol: "sparkles"),
            AppDestination(title: "R12 Account", path: "/account", symbol: "person.crop.circle")
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
