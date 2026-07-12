import SwiftUI
import SwiftData
import UniformTypeIdentifiers

struct StatsView: View {
    @Query private var books: [Book]
    @Environment(\.modelContext) private var context

    @State private var shareURL: URL?
    @State private var showImporter = false
    @State private var pendingImport: Backup.File?
    @State private var message: String?

    private var reading: Int { books.filter { $0.status == .reading }.count }
    private var toread: Int { books.filter { $0.status == .toread }.count }
    private var done: Int { books.filter { $0.status == .done }.count }

    private var pagesRead: Int {
        books.reduce(0) { sum, book in
            guard !book.isPodcast else { return sum }
            if book.status == .done { return sum + (book.totalPages ?? 0) }
            if book.status == .reading { return sum + book.currentPage }
            return sum
        }
    }

    private var minutesHeard: Int {
        books.reduce(0) { sum, book in
            guard book.isPodcast else { return sum }
            if book.status == .done { return sum + (book.totalPages ?? 0) }
            if book.status == .reading { return sum + book.currentPage }
            return sum
        }
    }

    private var quotesCount: Int { books.reduce(0) { $0 + $1.quotes.count } }
    private var notesCount: Int { books.reduce(0) { $0 + $1.notes.count } }

    private var averageRating: String? {
        let rated = books.filter { $0.status == .done && $0.rating > 0 }
        guard !rated.isEmpty else { return nil }
        let avg = Double(rated.reduce(0) { $0 + $1.rating }) / Double(rated.count)
        return String(format: "%.1f ★", avg)
    }

    private var byYear: [(year: String, count: Int)] {
        var dict: [String: Int] = [:]
        for book in books where book.status == .done {
            if let end = book.endDate {
                let year = String(Calendar.current.component(.year, from: end))
                dict[year, default: 0] += 1
            }
        }
        return dict.sorted { $0.key > $1.key }.map { (year: $0.key, count: $0.value) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack {
                        statCell("\(reading)", "En cours")
                        statCell("\(toread)", "À lire")
                        statCell("\(done)", "Terminés")
                    }
                    .listRowSeparator(.hidden)
                    HStack {
                        statCell("\(pagesRead)", "pages lues")
                        if minutesHeard > 0 { statCell("\(minutesHeard)", "min écoutées") }
                        statCell("\(quotesCount)", "citations")
                        statCell("\(notesCount)", "notes")
                        if let avg = averageRating { statCell(avg, "note moy.") }
                    }
                }

                if !byYear.isEmpty {
                    Section("Terminés par année") {
                        let maxCount = byYear.map(\.count).max() ?? 1
                        ForEach(byYear, id: \.year) { entry in
                            HStack(spacing: 10) {
                                Text(entry.year)
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(.secondary)
                                    .frame(width: 42, alignment: .leading)
                                GeometryReader { geo in
                                    Capsule()
                                        .fill(Color.accentColor)
                                        .frame(width: max(8, geo.size.width * CGFloat(entry.count) / CGFloat(maxCount)),
                                               height: 14)
                                        .frame(maxHeight: .infinity, alignment: .center)
                                }
                                Text("\(entry.count)")
                                    .font(.caption.weight(.bold).monospacedDigit())
                            }
                            .frame(height: 22)
                        }
                    }
                }

                Section("Données") {
                    Button("Exporter notes & citations (Markdown)", systemImage: "doc.text") {
                        shareURL = MarkdownExporter.exportFile(books: books, single: false)
                    }
                    Button("Sauvegarder tout (JSON)", systemImage: "arrow.down.doc") {
                        shareURL = Backup.exportFile(books: books)
                    }
                    Button("Restaurer une sauvegarde (JSON)", systemImage: "arrow.up.doc") {
                        showImporter = true
                    }
                } footer: {
                    Text("La sauvegarde JSON est au même format que la version web : vous pouvez importer ici la sauvegarde exportée depuis la PWA, et inversement.\n\nLecture (iOS) — version 1.0")
                }
            }
            .navigationTitle("Statistiques")
            .sheet(item: $shareURL) { url in ShareSheet(items: [url]) }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
                handleImport(result)
            }
            .alert("Restaurer cette sauvegarde ?", isPresented: Binding(
                get: { pendingImport != nil },
                set: { if !$0 { pendingImport = nil } }
            )) {
                Button("Remplacer mes données", role: .destructive) {
                    if let file = pendingImport {
                        let summary = Backup.restore(file, into: context, replacing: books)
                        message = "Restauré : \(summary.books) titres, \(summary.quotes) citations, \(summary.notes) notes."
                    }
                    pendingImport = nil
                }
                Button("Annuler", role: .cancel) { pendingImport = nil }
            } message: {
                if let file = pendingImport {
                    Text("\(file.books.count) titres, \((file.quotes ?? []).count) citations, \((file.notes ?? []).count) notes. Les données actuelles seront remplacées.")
                }
            }
            .alert(message ?? "", isPresented: Binding(
                get: { message != nil },
                set: { if !$0 { message = nil } }
            )) {
                Button("OK", role: .cancel) {}
            }
        }
    }

    private func statCell(_ value: String, _ label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title3.weight(.bold).monospacedDigit())
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func handleImport(_ result: Result<URL, Error>) {
        guard case let .success(url) = result else {
            message = "Import annulé ou fichier inaccessible."
            return
        }
        let secured = url.startAccessingSecurityScopedResource()
        defer { if secured { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            pendingImport = try Backup.decode(data)
        } catch {
            message = "Fichier invalide : choisissez une sauvegarde JSON créée par Lecture (web ou iOS)."
        }
    }
}

/// Feuille de partage UIKit (fichiers .md / .json).
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
