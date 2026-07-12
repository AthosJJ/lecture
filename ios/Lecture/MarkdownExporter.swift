import Foundation

/// Export Markdown, au même format que la version web.
enum MarkdownExporter {
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "fr_FR")
        f.dateStyle = .long
        return f
    }()

    static func markdown(for book: Book) -> String {
        let pod = book.isPodcast
        let act = pod ? "écoute" : "lecture"
        var lines = ["## \(book.title)\(book.subtitle.isEmpty ? "" : " — " + book.subtitle)", ""]
        lines.append("- Type : \(book.type.label)")
        lines.append("- Statut : \(book.status.label)")
        if pod && !book.show.isEmpty { lines.append("- Émission : \(book.show)") }
        if let total = book.totalPages, total > 0 {
            let percent = Int((book.progress ?? 0) * 100)
            lines.append("- Progression : \(book.currentPage)/\(total)\(pod ? " min" : "") (\(percent) %)")
        }
        if let d = book.startDate { lines.append("- Début d'\(act) : \(dayFormatter.string(from: d))") }
        if let d = book.endDate { lines.append("- Fin d'\(act) : \(dayFormatter.string(from: d))") }
        if !book.tags.isEmpty { lines.append("- Tags : \(book.tags.joined(separator: ", "))") }
        if book.status == .done && book.rating > 0 {
            lines.append("- Note : " + String(repeating: "★", count: book.rating) + String(repeating: "☆", count: 5 - book.rating))
        }
        lines.append("")

        let notes = book.notes.sorted { $0.createdAt > $1.createdAt }
        if !notes.isEmpty {
            lines.append("### Notes")
            lines.append("")
            for note in notes {
                lines.append("**\(dayFormatter.string(from: note.createdAt))**")
                lines.append("")
                lines.append(note.text)
                lines.append("")
            }
        }
        let quotes = book.quotes.sorted { ($0.page ?? .max) < ($1.page ?? .max) }
        if !quotes.isEmpty {
            lines.append("### Citations")
            lines.append("")
            for quote in quotes {
                lines.append(quote.text.split(separator: "\n", omittingEmptySubsequences: false)
                    .map { "> " + $0 }.joined(separator: "\n"))
                var meta: [String] = []
                if let place = quote.placeLabel { meta.append(place) }
                if !quote.tags.isEmpty { meta.append(quote.tags.map { "#\($0)" }.joined(separator: " ")) }
                if !meta.isEmpty {
                    lines.append(">")
                    lines.append("> — " + meta.joined(separator: " · "))
                }
                lines.append("")
            }
        }
        return lines.joined(separator: "\n")
    }

    /// Écrit le fichier .md dans un dossier temporaire et retourne son URL.
    static func exportFile(books: [Book], single: Bool) -> URL? {
        var content: String
        var name: String
        if single, let book = books.first {
            content = "# \(book.title)\n\n" + markdown(for: book)
            name = book.title.lowercased()
                .components(separatedBy: CharacterSet.alphanumerics.inverted)
                .filter { !$0.isEmpty }.joined(separator: "-")
            if name.isEmpty { name = "livre" }
        } else {
            let ordered = ReadStatus.allCases.flatMap { status in
                books.filter { $0.status == status }.sorted { $0.title < $1.title }
            }
            let totalQuotes = books.reduce(0) { $0 + $1.quotes.count }
            let totalNotes = books.reduce(0) { $0 + $1.notes.count }
            var parts = ["# Ma bibliothèque", "",
                         "_Export du \(dayFormatter.string(from: .now)) — \(books.count) titres, \(totalQuotes) citations, \(totalNotes) notes._", ""]
            for book in ordered {
                parts.append(markdown(for: book))
                parts.append("---")
                parts.append("")
            }
            content = parts.joined(separator: "\n")
            name = "bibliotheque"
        }
        let stamp = ISO8601DateFormatter.dayStamp()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name)-\(stamp).md")
        do {
            try content.write(to: url, atomically: true, encoding: .utf8)
            return url
        } catch {
            return nil
        }
    }
}

extension ISO8601DateFormatter {
    static func dayStamp(_ date: Date = .now) -> String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: date)
    }
}
