import Foundation
import SwiftData

enum ItemType: String, CaseIterable, Identifiable {
    case book, article, podcast

    var id: String { rawValue }

    var label: String {
        switch self {
        case .book: return "Livre"
        case .article: return "Article"
        case .podcast: return "Podcast"
        }
    }
}

enum ReadStatus: String, CaseIterable, Identifiable {
    case reading, toread, done

    var id: String { rawValue }

    var label: String {
        switch self {
        case .reading: return "En cours"
        case .toread: return "À lire"
        case .done: return "Terminé"
        }
    }
}

@Model
final class Book {
    @Attribute(.unique) var id: String
    var typeRaw: String
    var title: String
    var author: String
    var show: String            // nom de l'émission (podcasts)
    var statusRaw: String
    var currentPage: Int        // minutes pour un podcast
    var totalPages: Int?        // durée en minutes pour un podcast
    var startDate: Date?
    var endDate: Date?
    var rating: Int
    var tags: [String]
    var createdAt: Date
    var updatedAt: Date

    @Relationship(deleteRule: .cascade, inverse: \Note.book) var notes: [Note] = []
    @Relationship(deleteRule: .cascade, inverse: \Quote.book) var quotes: [Quote] = []

    init(id: String = UUID().uuidString,
         type: ItemType = .book,
         title: String = "",
         author: String = "",
         show: String = "",
         status: ReadStatus = .toread,
         currentPage: Int = 0,
         totalPages: Int? = nil,
         startDate: Date? = nil,
         endDate: Date? = nil,
         rating: Int = 0,
         tags: [String] = [],
         createdAt: Date = .now,
         updatedAt: Date = .now) {
        self.id = id
        self.typeRaw = type.rawValue
        self.title = title
        self.author = author
        self.show = show
        self.statusRaw = status.rawValue
        self.currentPage = currentPage
        self.totalPages = totalPages
        self.startDate = startDate
        self.endDate = endDate
        self.rating = rating
        self.tags = tags
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    var type: ItemType {
        get { ItemType(rawValue: typeRaw) ?? .book }
        set { typeRaw = newValue.rawValue }
    }

    var status: ReadStatus {
        get { ReadStatus(rawValue: statusRaw) ?? .toread }
        set { statusRaw = newValue.rawValue }
    }

    /// « Auteur » ou « Émission — Auteur » pour un podcast.
    var subtitle: String {
        if type == .podcast {
            return [show, author].filter { !$0.isEmpty }.joined(separator: " — ")
        }
        return author
    }

    var progress: Double? {
        guard let total = totalPages, total > 0 else { return nil }
        return min(1, max(0, Double(currentPage) / Double(total)))
    }

    var isPodcast: Bool { type == .podcast }
}

@Model
final class Note {
    @Attribute(.unique) var id: String
    var text: String
    var createdAt: Date
    var updatedAt: Date
    var book: Book?

    init(id: String = UUID().uuidString, text: String = "", createdAt: Date = .now, updatedAt: Date = .now, book: Book? = nil) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.book = book
    }
}

@Model
final class Quote {
    @Attribute(.unique) var id: String
    var text: String
    var page: Int?              // minute pour un podcast
    var tags: [String]
    var createdAt: Date
    var updatedAt: Date
    var book: Book?

    init(id: String = UUID().uuidString, text: String = "", page: Int? = nil, tags: [String] = [], createdAt: Date = .now, updatedAt: Date = .now, book: Book? = nil) {
        self.id = id
        self.text = text
        self.page = page
        self.tags = tags
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.book = book
    }

    /// « p. 42 » ou « à 42 min » pour un podcast.
    var placeLabel: String? {
        guard let page else { return nil }
        return book?.isPodcast == true ? "à \(page) min" : "p. \(page)"
    }
}

func parseTags(_ input: String) -> [String] {
    var seen = Set<String>()
    return input.split(separator: ",")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        .filter { !$0.isEmpty && seen.insert($0).inserted }
}
