import SwiftUI
import SwiftData

struct QuotesView: View {
    @Query(sort: \Quote.createdAt, order: .reverse) private var quotes: [Quote]
    @Query(sort: \Book.title) private var books: [Book]
    @State private var search = ""
    @State private var selectedBookID: String?
    @State private var selectedTag: String?
    @State private var editingQuote: Quote?

    private var booksWithQuotes: [Book] {
        books.filter { !$0.quotes.isEmpty }
    }

    private var filtered: [Quote] {
        var result = quotes
        if let id = selectedBookID { result = result.filter { $0.book?.id == id } }
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        if !q.isEmpty {
            result = result.filter { quote in
                quote.text.lowercased().contains(q)
                    || quote.tags.contains { $0.contains(q) }
                    || (quote.book?.title.lowercased().contains(q) ?? false)
                    || (quote.book?.show.lowercased().contains(q) ?? false)
            }
        }
        if let tag = selectedTag { result = result.filter { $0.tags.contains(tag) } }
        return result
    }

    private var visibleTags: [String] {
        var base = quotes
        if let id = selectedBookID { base = base.filter { $0.book?.id == id } }
        return Array(Set(base.flatMap(\.tags))).sorted()
    }

    var body: some View {
        NavigationStack {
            Group {
                if quotes.isEmpty {
                    ContentUnavailableView(
                        "Aucune citation",
                        systemImage: "quote.opening",
                        description: Text("Ajoutez des citations depuis la fiche d'un livre : elles se retrouveront toutes ici.")
                    )
                } else {
                    List {
                        ForEach(filtered) { quote in
                            QuoteCardView(quote: quote)
                                .contentShape(Rectangle())
                                .onTapGesture { editingQuote = quote }
                        }
                    }
                    .safeAreaInset(edge: .top, spacing: 0) {
                        if !visibleTags.isEmpty {
                            TagChipsRow(tags: visibleTags, selected: $selectedTag)
                                .padding(.vertical, 6)
                                .background(.bar)
                        }
                    }
                }
            }
            .navigationTitle("Citations")
            .searchable(text: $search, prompt: "Un mot pour retrouver une citation…")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Picker("Livre", selection: $selectedBookID) {
                            Text("Tous les livres").tag(String?.none)
                            ForEach(booksWithQuotes) { book in
                                Text(book.title).tag(String?.some(book.id))
                            }
                        }
                    } label: {
                        Image(systemName: selectedBookID == nil
                              ? "line.3.horizontal.decrease.circle"
                              : "line.3.horizontal.decrease.circle.fill")
                    }
                }
            }
            .sheet(item: $editingQuote) { quote in
                if let book = quote.book {
                    QuoteFormView(book: book, quote: quote)
                }
            }
            .onChange(of: selectedBookID) { selectedTag = nil }
        }
    }
}
