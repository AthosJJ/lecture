import SwiftUI
import SwiftData

@main
struct LectureApp: App {
    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(for: [Book.self, Note.self, Quote.self])
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            LibraryView()
                .tabItem { Label("Bibliothèque", systemImage: "books.vertical") }
            QuotesView()
                .tabItem { Label("Citations", systemImage: "quote.opening") }
            StatsView()
                .tabItem { Label("Stats", systemImage: "chart.bar") }
        }
    }
}
