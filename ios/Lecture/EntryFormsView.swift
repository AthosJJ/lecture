import SwiftUI
import SwiftData
import PhotosUI

/* ——— Formulaire de note (avec dictée native) ——— */

struct NoteFormView: View {
    let book: Book
    let note: Note?
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @StateObject private var dictation = DictationManager()
    @State private var text = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Note") {
                    TextEditor(text: $text)
                        .frame(minHeight: 140)
                }
                Section {
                    DictationButton(dictation: dictation, text: $text)
                }
            }
            .navigationTitle(note == nil ? "Nouvelle note" : "Modifier la note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dictation.stop(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .onAppear { if let note { text = note.text } }
            .onDisappear { dictation.stop() }
        }
    }

    private func save() {
        dictation.stop()
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let note {
            note.text = value
            note.updatedAt = .now
        } else {
            context.insert(Note(text: value, book: book))
        }
        book.updatedAt = .now
        dismiss()
    }
}

/* ——— Formulaire de citation (dictée + scanner caméra + OCR photo) ——— */

struct QuoteFormView: View {
    let book: Book
    let quote: Quote?
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @StateObject private var dictation = DictationManager()

    @State private var text = ""
    @State private var page = ""
    @State private var tags = ""
    @State private var showScanner = false
    @State private var photoItem: PhotosPickerItem?
    @State private var ocrLines: OCRLine?
    @State private var ocrBusy = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Citation") {
                    TextEditor(text: $text)
                        .font(.system(.body, design: .serif))
                        .frame(minHeight: 120)
                }
                Section {
                    DictationButton(dictation: dictation, text: $text)
                    Button {
                        dictation.stop()
                        showScanner = true
                    } label: {
                        Label("Scanner avec la caméra", systemImage: "text.viewfinder")
                    }
                    PhotosPicker(selection: $photoItem, matching: .images) {
                        Label(ocrBusy ? "Reconnaissance…" : "Reconnaître une photo",
                              systemImage: "photo.on.rectangle")
                    }
                    .disabled(ocrBusy)
                }
                Section {
                    TextField(book.isPodcast ? "Minute" : "Page", text: $page)
                        .keyboardType(.numberPad)
                    TextField("Tags (séparés par des virgules)", text: $tags)
                        .textInputAutocapitalization(.never)
                }
            }
            .navigationTitle(quote == nil ? "Nouvelle citation" : "Modifier")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dictation.stop(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save() }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .sheet(isPresented: $showScanner) {
                TextScannerSheet { scanned in
                    appendText(scanned)
                }
            }
            .sheet(item: $ocrLines) { lines in
                OCRLinesPicker(lines: lines.items) { selectedText in
                    appendText(selectedText)
                }
            }
            .onChange(of: photoItem) {
                guard let item = photoItem else { return }
                photoItem = nil
                ocrBusy = true
                Task {
                    defer { ocrBusy = false }
                    guard let data = try? await item.loadTransferable(type: Data.self),
                          let image = UIImage(data: data) else { return }
                    let lines = await PhotoOCR.recognizeLines(in: image)
                    ocrLines = OCRLine(items: lines)
                }
            }
            .onAppear {
                if let quote {
                    text = quote.text
                    page = quote.page.map(String.init) ?? ""
                    tags = quote.tags.joined(separator: ", ")
                }
            }
            .onDisappear { dictation.stop() }
        }
    }

    private func appendText(_ addition: String) {
        let clean = addition.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        let base = text.trimmingCharacters(in: .whitespacesAndNewlines)
        text = base.isEmpty ? clean : base + "\n" + clean
    }

    private func save() {
        dictation.stop()
        let target = quote ?? Quote(book: book)
        target.text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        target.page = Int(page)
        target.tags = parseTags(tags)
        target.updatedAt = .now
        if quote == nil { context.insert(target) }
        book.updatedAt = .now
        dismiss()
    }
}

/* ——— Bouton de dictée partagé ——— */

struct DictationButton: View {
    @ObservedObject var dictation: DictationManager
    @Binding var text: String

    var body: some View {
        Button {
            dictation.toggle(baseText: text) { text = $0 }
        } label: {
            Label(dictation.isRecording ? "Arrêter la dictée" : "Dicter",
                  systemImage: dictation.isRecording ? "stop.circle.fill" : "mic")
                .foregroundStyle(dictation.isRecording ? Color.red : Color.accentColor)
                .symbolEffect(.pulse, isActive: dictation.isRecording)
        }
        .alert("Dictée indisponible",
               isPresented: Binding(get: { dictation.errorMessage != nil },
                                    set: { if !$0 { dictation.errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(dictation.errorMessage ?? "")
        }
    }
}

/* ——— Sélection des lignes reconnues sur une photo ——— */

struct OCRLine: Identifiable {
    let id = UUID()
    let items: [String]
}

struct OCRLinesPicker: View {
    let lines: [String]
    let onInsert: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<Int> = []

    var body: some View {
        NavigationStack {
            Group {
                if lines.isEmpty {
                    ContentUnavailableView(
                        "Aucun texte reconnu",
                        systemImage: "text.magnifyingglass",
                        description: Text("Essayez une photo plus nette, cadrée sur le passage.")
                    )
                } else {
                    List(Array(lines.enumerated()), id: \.offset) { index, line in
                        Button {
                            if selected.contains(index) { selected.remove(index) }
                            else { selected.insert(index) }
                        } label: {
                            HStack {
                                Image(systemName: selected.contains(index) ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selected.contains(index) ? Color.accentColor : Color.secondary)
                                Text(line).foregroundStyle(.primary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Texte reconnu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Insérer (\(selected.count))") {
                        let chosen = selected.sorted().map { lines[$0] }.joined(separator: " ")
                        onInsert(chosen)
                        dismiss()
                    }
                    .disabled(selected.isEmpty)
                }
            }
            .onAppear {
                // Tout sélectionné par défaut, sauf les débris improbables
                selected = Set(lines.indices.filter { index in
                    let line = lines[index]
                    let letters = line.filter(\.isLetter).count
                    return line.count >= 4 && Double(letters) / Double(line.count) >= 0.5
                })
            }
        }
    }
}
