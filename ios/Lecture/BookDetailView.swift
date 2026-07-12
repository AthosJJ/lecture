import SwiftUI
import SwiftData

struct BookDetailView: View {
    @Bindable var book: Book
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var tab = 0
    @State private var showEditForm = false
    @State private var editingNote: Note?
    @State private var editingQuote: Quote?
    @State private var showNewNote = false
    @State private var showNewQuote = false
    @State private var askFinished = false
    @State private var shareURL: URL?

    private var dateText: String {
        var parts: [String] = []
        let f = DateFormatter()
        f.locale = Locale(identifier: "fr_FR")
        f.dateStyle = .long
        if let start = book.startDate { parts.append("début : " + f.string(from: start)) }
        if let end = book.endDate { parts.append("fin : " + f.string(from: end)) }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text(book.type.label.uppercased())
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.tint)
                    Text(book.title)
                        .font(.title2.weight(.bold))
                    if !book.subtitle.isEmpty {
                        Text(book.subtitle)
                            .foregroundStyle(.secondary)
                    }
                    HStack(spacing: 6) {
                        Text(book.status.label)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(Color.accentColor.opacity(0.12), in: Capsule())
                            .foregroundStyle(.tint)
                        if book.status == .done && book.rating > 0 {
                            StarsView(rating: book.rating)
                        }
                    }
                    if !dateText.isEmpty {
                        Text(dateText).font(.caption).foregroundStyle(.secondary)
                    }
                    if !book.tags.isEmpty {
                        Text(book.tags.map { "#\($0)" }.joined(separator: "  "))
                            .font(.caption)
                            .foregroundStyle(.tint)
                    }
                }
                .listRowSeparator(.hidden)
            }

            if let total = book.totalPages, total > 0 {
                Section("Progression") {
                    VStack(spacing: 10) {
                        HStack {
                            ProgressView(value: book.progress ?? 0)
                                .tint(.accentColor)
                            Text(book.isPodcast
                                 ? "\(book.currentPage)/\(total) min"
                                 : "p. \(book.currentPage)/\(total)")
                                .font(.caption.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                        HStack(spacing: 10) {
                            stepButton("−1") { step(-1) }
                            stepButton("+1") { step(1) }
                            stepButton("+10") { step(10) }
                            Spacer()
                            Text("\(Int((book.progress ?? 0) * 100)) %")
                                .font(.footnote.weight(.bold).monospacedDigit())
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            Section {
                Picker("Onglet", selection: $tab) {
                    Text("Notes").tag(0)
                    Text("Citations").tag(1)
                }
                .pickerStyle(.segmented)
                .listRowSeparator(.hidden)

                if tab == 0 {
                    if book.notes.isEmpty {
                        Text("Aucune note pour l'instant.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(book.notes.sorted { $0.createdAt > $1.createdAt }) { note in
                            VStack(alignment: .leading, spacing: 6) {
                                Text(note.text)
                                Text(note.createdAt.formatted(date: .long, time: .omitted))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .contentShape(Rectangle())
                            .onTapGesture { editingNote = note }
                            .swipeActions {
                                Button("Supprimer", role: .destructive) {
                                    context.delete(note)
                                }
                            }
                        }
                    }
                } else {
                    if book.quotes.isEmpty {
                        Text("Sauvegardez les passages marquants avec leur position.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(book.quotes.sorted { ($0.page ?? .max) < ($1.page ?? .max) }) { quote in
                            QuoteCardView(quote: quote, showSource: false)
                                .contentShape(Rectangle())
                                .onTapGesture { editingQuote = quote }
                                .swipeActions {
                                    Button("Supprimer", role: .destructive) {
                                        context.delete(quote)
                                    }
                                }
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button("Modifier la fiche", systemImage: "pencil") { showEditForm = true }
                    Button("Exporter cette fiche (.md)", systemImage: "square.and.arrow.up") {
                        shareURL = MarkdownExporter.exportFile(books: [book], single: true)
                    }
                    Button("Supprimer", systemImage: "trash", role: .destructive) {
                        context.delete(book)
                        dismiss()
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
            ToolbarItem(placement: .bottomBar) {
                Button {
                    if tab == 0 { showNewNote = true } else { showNewQuote = true }
                } label: {
                    Label(tab == 0 ? "Nouvelle note" : "Nouvelle citation", systemImage: "plus")
                        .font(.body.weight(.semibold))
                }
            }
        }
        .sheet(isPresented: $showEditForm) { BookFormView(book: book) }
        .sheet(isPresented: $showNewNote) { NoteFormView(book: book, note: nil) }
        .sheet(isPresented: $showNewQuote) { QuoteFormView(book: book, quote: nil) }
        .sheet(item: $editingNote) { note in NoteFormView(book: book, note: note) }
        .sheet(item: $editingQuote) { quote in QuoteFormView(book: book, quote: quote) }
        .sheet(item: $shareURL) { url in ShareSheet(items: [url]) }
        .confirmationDialog(
            book.isPodcast ? "Épisode écouté en entier. Marquer comme terminé ?" : "Dernière page atteinte. Marquer comme terminé ?",
            isPresented: $askFinished,
            titleVisibility: .visible
        ) {
            Button("Marquer comme terminé") {
                book.status = .done
                if book.endDate == nil { book.endDate = .now }
                book.updatedAt = .now
            }
            Button("Pas encore", role: .cancel) {}
        }
    }

    private func stepButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.footnote.weight(.bold))
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func step(_ delta: Int) {
        guard let total = book.totalPages else { return }
        book.currentPage = min(total, max(0, book.currentPage + delta))
        book.updatedAt = .now
        if book.currentPage > 0 && book.status == .toread {
            book.status = .reading
            if book.startDate == nil { book.startDate = .now }
        }
        if book.currentPage >= total && book.status != .done {
            askFinished = true
        }
    }
}

extension URL: Identifiable {
    public var id: String { absoluteString }
}
