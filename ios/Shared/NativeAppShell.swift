import SwiftUI

struct NativeAppShell: View {
    let configuration: NativeAppConfiguration
    @State private var selection: String
    @State private var openedDeepLink: String?

    init(configuration: NativeAppConfiguration) {
        self.configuration = configuration
        _selection = State(initialValue: configuration.destinations.first?.id ?? "/")
    }

    var body: some View {
        TabView(selection: $selection) {
            ForEach(configuration.destinations) { destination in
                NavigationStack {
                    RouteWebScreen(configuration: configuration, destination: destination)
                        .navigationTitle(destination.title)
                        .navigationBarTitleDisplayMode(.inline)
                        .toolbar(
                            configuration.scheme == "r12-glowzone" ? .hidden : .visible,
                            for: .navigationBar
                        )
                        .toolbar {
                            ToolbarItem(placement: .principal) {
                                HStack(spacing: 7) {
                                    Circle().fill(configuration.tint).frame(width: 8, height: 8)
                                    Text(configuration.name).font(.subheadline.weight(.semibold))
                                }
                                .accessibilityElement(children: .combine)
                                .accessibilityLabel(configuration.name)
                            }
                        }
                }
                .tabItem { Label(destination.title, systemImage: destination.symbol) }
                .tag(destination.id)
            }
        }
        .tint(configuration.tint)
        .preferredColorScheme(.dark)
        .onOpenURL(perform: handleDeepLink)
        .alert("Link not available", isPresented: Binding(
            get: { openedDeepLink == "invalid" },
            set: { if !$0 { openedDeepLink = nil } }
        )) {
            Button("OK", role: .cancel) { openedDeepLink = nil }
        } message: {
            Text("This link is outside the \(configuration.name) app.")
        }
    }

    private func handleDeepLink(_ url: URL) {
        guard url.scheme == configuration.scheme else { return }
        let path = url.path.isEmpty ? configuration.destinations[0].path : url.path
        guard configuration.scope(path),
              let destination = configuration.destinations.first(where: { $0.route == path }) else {
            openedDeepLink = "invalid"
            return
        }
        selection = destination.id
    }
}
