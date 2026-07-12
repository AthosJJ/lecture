import SwiftUI
import SwiftData

struct LibraryView: View {
    @Query(sort: \Book.updatedAt, order: .reverse) private var books: [Book]
    @State private var search = ""
    @State private var selectedTag: String?
    @State private var showForm = false

    private var allTags: [String] {
        Array(Set(books.flatMap(\.tags))).sorted()
    }

    private var filtered: [Book] {
        var result = books
        if let tag = selectedTag { result = result.filter { $0.tags.contains(tag) } }
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            result = result.filter { book in
                book.title.lowercased().contains(q)
                    || book.author.lowercased().contains(q)
                    || book.show.lowercased().contains(q)
                    || book.tags.contains { $0.contains(q) }
                    || book.notes.contains { $0.text.lowercased().contains(q) }
                    || book.quotes.contains { $0.text.lowercased().contains(q) }
            }
        }
        return result
    }

    var body: some View {
        NavigationStack {
            Group {
                if books.isEmpty {
                    ContentUnavailableView(
                        "Votre bibliothèque est vide",
                        systemImage: "books.vertical",
                        description: Text("Touchez + pour ajouter un livre, un article ou un podcast.")
                    )
                } else {
                    List {
                        ForEach(ReadStatus.allCases) { status in
                            let group = filtered.filter { $0.status == status }
                            if !group.isEmpty {
                                Section("\(status.label) · \(group.count)") {
                                    ForEach(group) { book in
                                        NavigationLink(value: book) {
                                            BookRowView(book: book)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if allTags.count > 0 {
                            TagChipsRow(tags: allTags, selected: $selectedTag, prefix: "")
                                .padding(.vertical, 6)
                                .background(.bar)
                        }
                    }
                }
            }
            .navigationTitle("Bibliothèque")
            .navigationDestination(for: Book.self) { book in
                BookDetailView(book: book)
            }
            .searchable(text: $search, prompt: "Titre, auteur, note, citation…")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showForm = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showForm) {
                BookFormView(book: nil)
            }
        }
    }
}
