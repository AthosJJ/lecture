import SwiftUI

/// Teinte stable dérivée du titre (même algorithme que la version web).
func hue(from string: String) -> Double {
    var h = 0
    for scalar in string.unicodeScalars {
        h = (h * 31 + Int(scalar.value)) % 360
    }
    return Double(h) / 360
}

func initials(of title: String) -> String {
    title.split(separator: " ")
        .filter { $0.first?.isLetter == true || $0.first?.isNumber == true }
        .prefix(2)
        .compactMap { $0.first.map(String.init) }
        .joined()
        .uppercased()
}

/// Vignette de couverture colorée (ronde pour un podcast).
struct CoverView: View {
    let book: Book

    var body: some View {
        let seed = book.isPodcast && !book.show.isEmpty ? book.show : book.title
        let base = Color(hue: hue(from: seed), saturation: 0.5, brightness: 0.5)
        Group {
            if book.isPodcast {
                Circle().fill(base.gradient)
                    .frame(width: 44, height: 44)
            } else {
                RoundedRectangle(cornerRadius: book.type == .article ? 8 : 6)
                    .fill(base.gradient)
                    .frame(width: 44, height: 58)
            }
        }
        .overlay {
            Text(initials(of: seed))
                .font(.system(size: 15, weight: .heavy))
                .foregroundStyle(.white)
        }
    }
}

struct StarsView: View {
    let rating: Int

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { i in
                Image(systemName: i <= rating ? "star.fill" : "star")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
        }
    }
}

/// Sélecteur d'étoiles pour le formulaire.
struct StarPicker: View {
    @Binding var rating: Int

    var body: some View {
        HStack(spacing: 8) {
            ForEach(1...5, id: \.self) { i in
                Button {
                    rating = (rating == i) ? 0 : i
                } label: {
                    Image(systemName: i <= rating ? "star.fill" : "star")
                        .font(.title3)
                        .foregroundStyle(.orange)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Rangée de puces de tags filtrantes.
struct TagChipsRow: View {
    let tags: [String]
    @Binding var selected: String?
    var prefix: String = "#"

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(tags, id: \.self) { tag in
                    let isOn = selected == tag
                    Button {
                        selected = isOn ? nil : tag
                    } label: {
                        Text(prefix + tag)
                            .font(.footnote.weight(.semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(isOn ? Color.primary : Color(.secondarySystemBackground), in: Capsule())
                            .foregroundStyle(isOn ? Color(.systemBackground) : .secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
        }
    }
}

/// Carte de citation : serif élégant, source et position.
struct QuoteCardView: View {
    let quote: Quote
    var showSource = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("“")
                .font(.system(size: 32, design: .serif))
                .foregroundStyle(.tint)
                .frame(height: 14, alignment: .top)
            Text(quote.text)
                .font(.system(.body, design: .serif))
                .lineSpacing(3)
            HStack(spacing: 6) {
                if showSource, let book = quote.book {
                    Text(book.title).fontWeight(.semibold)
                    Text("·")
                }
                Text(quote.placeLabel ?? (quote.book?.isPodcast == true ? "minutage non précisé" : "page non précisée"))
                if !quote.tags.isEmpty {
                    Text(quote.tags.map { "#\($0)" }.joined(separator: " "))
                        .foregroundStyle(.tint)
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

/// Ligne de livre dans la bibliothèque.
struct BookRowView: View {
    let book: Book

    var body: some View {
        HStack(spacing: 12) {
            CoverView(book: book)
            VStack(alignment: .leading, spacing: 3) {
                Text(book.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                if !book.subtitle.isEmpty {
                    Text(book.subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                if let progress = book.progress, book.status != .toread {
                    HStack(spacing: 8) {
                        ProgressView(value: progress)
                            .tint(.accentColor)
                        Text("\(book.currentPage)/\(book.totalPages ?? 0)")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 6) {
                    if book.type != .book {
                        Text(book.type.label)
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(Color.accentColor.opacity(0.12), in: Capsule())
                            .foregroundStyle(.tint)
                    }
                    if book.status == .done && book.rating > 0 {
                        StarsView(rating: book.rating)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }
}
