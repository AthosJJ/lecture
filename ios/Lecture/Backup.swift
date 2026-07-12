import Foundation
import SwiftData

/// Sauvegarde/restauration JSON, au format EXACT de la version web (PWA) :
/// une sauvegarde exportée depuis la PWA s'importe telle quelle ici,
/// et réciproquement.
enum Backup {
    struct File: Codable {
        var app: String?
        var version: Int?
        var exportedAt: String?
        var books: [BookDTO]
        var notes: [NoteDTO]?
        var quotes: [QuoteDTO]?
    }

    struct BookDTO: Codable {
        var id: String
        var type: String?
        var title: String
        var author: String?
        var show: String?
        var status: String?
        var currentPage: Int?
        var totalPages: Int?
        var startDate: String?
        var endDate: String?
        var tags: [String]?
        var rating: Int?
        var createdAt: String?
        var updatedAt: String?
    }

    struct NoteDTO: Codable {
        var id: String
        var bookId: String
        var text: String
        var createdAt: String?
        var updatedAt: String?
    }

    struct QuoteDTO: Codable {
        var id: String
        var bookId: String
        var text: String
        var page: Int?
        var tags: [String]?
        var createdAt: String?
        var updatedAt: String?
    }

    // — Dates : ISO complet (createdAt JS) ou « yyyy-MM-dd » (dates de lecture)

    private static let isoFractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let isoPlain = ISO8601DateFormatter()
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: "UTC")
        return f
    }()

    static func parseDate(_ value: String?) -> Date? {
        guard let value, !value.isEmpty else { return nil }
        return isoFractional.date(from: value)
            ?? isoPlain.date(from: value)
            ?? dayFormatter.date(from: value)
    }

    private static func isoString(_ date: Date) -> String { isoFractional.string(from: date) }
    private static func dayString(_ date: Date?) -> String? { date.map { dayFormatter.string(from: $0) } }

    // — Export

    static func exportFile(books: [Book]) -> URL? {
        let file = File(
            app: "lecture",
            version: 1,
            exportedAt: isoString(.now),
            books: books.map { book in
                BookDTO(id: book.id, type: book.typeRaw, title: book.title,
                        author: book.author, show: book.show, status: book.statusRaw,
                        currentPage: book.currentPage, totalPages: book.totalPages,
                        startDate: dayString(book.startDate), endDate: dayString(book.endDate),
                        tags: book.tags, rating: book.rating,
                        createdAt: isoString(book.createdAt), updatedAt: isoString(book.updatedAt))
            },
            notes: books.flatMap { book in
                book.notes.map { NoteDTO(id: $0.id, bookId: book.id, text: $0.text,
                                         createdAt: isoString($0.createdAt), updatedAt: isoString($0.updatedAt)) }
            },
            quotes: books.flatMap { book in
                book.quotes.map { QuoteDTO(id: $0.id, bookId: book.id, text: $0.text, page: $0.page,
                                           tags: $0.tags, createdAt: isoString($0.createdAt),
                                           updatedAt: isoString($0.updatedAt)) }
            }
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(file) else { return nil }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("lecture-sauvegarde-\(ISO8601DateFormatter.dayStamp()).json")
        do {
            try data.write(to: url)
            return url
        } catch {
            return nil
        }
    }

    // — Import (remplace tout)

    struct Summary {
        var books = 0
        var notes = 0
        var quotes = 0
    }

    static func decode(_ data: Data) throws -> File {
        try JSONDecoder().decode(File.self, from: data)
    }

    @discardableResult
    static func restore(_ file: File, into context: ModelContext, replacing existing: [Book]) -> Summary {
        for book in existing { context.delete(book) }

        var byId: [String: Book] = [:]
        var summary = Summary()
        for dto in file.books {
            let book = Book(
                id: dto.id,
                type: ItemType(rawValue: dto.type ?? "book") ?? .book,
                title: dto.title,
                author: dto.author ?? "",
                show: dto.show ?? "",
                status: ReadStatus(rawValue: dto.status ?? "toread") ?? .toread,
                currentPage: dto.currentPage ?? 0,
                totalPages: dto.totalPages,
                startDate: parseDate(dto.startDate),
                endDate: parseDate(dto.endDate),
                rating: dto.rating ?? 0,
                tags: dto.tags ?? [],
                createdAt: parseDate(dto.createdAt) ?? .now,
                updatedAt: parseDate(dto.updatedAt) ?? .now
            )
            context.insert(book)
            byId[book.id] = book
            summary.books += 1
        }
        for dto in file.notes ?? [] {
            guard let book = byId[dto.bookId] else { continue }
            context.insert(Note(id: dto.id, text: dto.text,
                                createdAt: parseDate(dto.createdAt) ?? .now,
                                updatedAt: parseDate(dto.updatedAt) ?? .now,
                                book: book))
            summary.notes += 1
        }
        for dto in file.quotes ?? [] {
            guard let book = byId[dto.bookId] else { continue }
            context.insert(Quote(id: dto.id, text: dto.text, page: dto.page,
                                 tags: dto.tags ?? [],
                                 createdAt: parseDate(dto.createdAt) ?? .now,
                                 updatedAt: parseDate(dto.updatedAt) ?? .now,
                                 book: book))
            summary.quotes += 1
        }
        return summary
    }
}
