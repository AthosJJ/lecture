import SwiftUI
import SwiftData

struct BookFormView: View {
    let book: Book?
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var type: ItemType = .book
    @State private var title = ""
    @State private var author = ""
    @State private var show = ""
    @State private var status: ReadStatus = .toread
    @State private var currentPage = ""
    @State private var totalPages = ""
    @State private var hasStart = false
    @State private var startDate = Date.now
    @State private var hasEnd = false
    @State private var endDate = Date.now
    @State private var tags = ""
    @State private var rating = 0
    @State private var confirmDelete = false

    private var isPodcast: Bool { type == .podcast }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $type) {
                        ForEach(ItemType.allCases) { t in
                            Text(t.label).tag(t)
                        }
                    }
                    .pickerStyle(.segmented)
                    if isPodcast {
                        TextField("Émission (nom du podcast)", text: $show)
                    }
                    TextField(isPodcast ? "Titre de l'épisode" : "Titre", text: $title)
                    TextField("Auteur", text: $author)
                }

                Section {
                    Picker("Statut", selection: $status) {
                        Text("À lire").tag(ReadStatus.toread)
                        Text("En cours").tag(ReadStatus.reading)
                        Text("Terminé").tag(ReadStatus.done)
                    }
                    .pickerStyle(.segmented)
                    HStack {
                        TextField(isPodcast ? "Minute actuelle" : "Page actuelle", text: $currentPage)
                            .keyboardType(.numberPad)
                        Divider()
                        TextField(isPodcast ? "Durée (min)" : "Pages total", text: $totalPages)
                            .keyboardType(.numberPad)
                    }
                    if status == .done {
                        HStack {
                            Text("Note")
                            Spacer()
                            StarPicker(rating: $rating)
                        }
                    }
                }

                Section {
                    Toggle(isPodcast ? "Début d'écoute" : "Début de lecture", isOn: $hasStart.animation())
                    if hasStart {
                        DatePicker("Le", selection: $startDate, displayedComponents: .date)
                    }
                    Toggle(isPodcast ? "Fin d'écoute" : "Fin de lecture", isOn: $hasEnd.animation())
                    if hasEnd {
                        DatePicker("Le", selection: $endDate, displayedComponents: .date)
                    }
                }

                Section("Tags (séparés par des virgules)") {
                    TextField("roman, philosophie…", text: $tags)
                        .textInputAutocapitalization(.never)
                }

                if book != nil {
                    Section {
                        Button("Supprimer", role: .destructive) { confirmDelete = true }
                            .frame(maxWidth: .infinity)
                    }
                }
            }
            .navigationTitle(book == nil ? "Nouveau" : "Modifier")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .confirmationDialog("Supprimer « \(title) » avec ses notes et citations ?",
                                isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Supprimer", role: .destructive) {
                    if let book { context.delete(book) }
                    dismiss()
                }
            }
            .onAppear(perform: load)
        }
    }

    private func load() {
        guard let book else { return }
        type = book.type
        title = book.title
        author = book.author
        show = book.show
        status = book.status
        currentPage = book.currentPage > 0 ? String(book.currentPage) : ""
        totalPages = book.totalPages.map(String.init) ?? ""
        if let d = book.startDate { hasStart = true; startDate = d }
        if let d = book.endDate { hasEnd = true; endDate = d }
        tags = book.tags.joined(separator: ", ")
        rating = book.rating
    }

    private func save() {
        let target = book ?? Book()
        target.type = type
        target.title = title.trimmingCharacters(in: .whitespaces)
        target.author = author.trimmingCharacters(in: .whitespaces)
        target.show = isPodcast ? show.trimmingCharacters(in: .whitespaces) : ""
        target.status = status
        let total = Int(totalPages).flatMap { $0 > 0 ? $0 : nil }
        target.totalPages = total
        var current = Int(currentPage) ?? 0
        if let total { current = min(current, total) }
        target.currentPage = max(0, current)
        target.startDate = hasStart ? startDate : nil
        target.endDate = hasEnd ? endDate : nil
        target.tags = parseTags(tags)
        target.rating = status == .done ? rating : 0
        target.updatedAt = .now

        // Automatismes de statut, comme la version web
        if target.status == .reading && target.startDate == nil { target.startDate = .now }
        if target.status == .done {
            if target.endDate == nil { target.endDate = .now }
            if let total { target.currentPage = total }
        }

        if book == nil { context.insert(target) }
        dismiss()
    }
}
