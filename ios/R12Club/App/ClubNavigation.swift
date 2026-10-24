import Foundation

struct ClubTab {
    let title: String
    let path: String
    let symbol: String
}

enum ClubNavigation {
    static let tabs = [
        ClubTab(title: "Reception", path: "/club/reception", symbol: "person.2.badge.key"),
        ClubTab(title: "Daily Checks", path: "/club/checks", symbol: "checklist"),
        ClubTab(title: "Members", path: "/club/members", symbol: "person.2"),
        ClubTab(title: "Shop", path: "/club/shop", symbol: "bag"),
        ClubTab(title: "More", path: "/club/more", symbol: "ellipsis.circle")
    ]
    static func selectedIndex(path: String, fallback: Int) -> Int {
        let route = path.hasPrefix("/club/reviewer") ? "/club" + path.dropFirst("/club/reviewer".count) : path
        func matches(_ root: String) -> Bool { route == root || route.hasPrefix(root + "/") }
        if matches("/club/reception") || matches("/club/check-in") { return 0 }
        if matches("/club/checks") { return 1 }
        if matches("/club/members") { return 2 }
        if matches("/club/shop") || matches("/club/products") || matches("/club/promotions") { return 3 }
        if route == "/club" || route.hasPrefix("/club/") { return 4 }
        return fallback
    }
    static func url(path: String, context: URL? = nil) -> URL {
        var result = URLComponents(string: "https://app.r12.live")!
        result.path = path
        result.queryItems = URLComponents(url: context ?? URL(string: "https://app.r12.live")!, resolvingAgainstBaseURL: false)?.queryItems?.filter { ["org", "location"].contains($0.name) }
        return result.url!
    }
}
