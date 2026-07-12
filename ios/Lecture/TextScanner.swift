import SwiftUI
import VisionKit

/// Scanner de texte en direct (le même moteur que l'app Notes) :
/// visez la page, touchez le texte surligné pour l'ajouter.
struct TextScannerSheet: View {
    let onText: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var captured: [String] = []

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                    VStack(spacing: 0) {
                        DataScannerRepresentable { text in
                            captured.append(text)
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text(captured.isEmpty
                                 ? "Visez le passage, puis touchez le texte surligné pour le capturer."
                                 : captured.joined(separator: " "))
                                .font(.footnote)
                                .foregroundStyle(captured.isEmpty ? .secondary : .primary)
                                .lineLimit(4)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding()
                        .background(.bar)
                    }
                } else {
                    ContentUnavailableView(
                        "Scanner indisponible",
                        systemImage: "text.viewfinder",
                        description: Text("Le scanner de texte nécessite un iPhone XS ou plus récent, et l'accès à la caméra.")
                    )
                }
            }
            .navigationTitle("Scanner du texte")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Insérer") {
                        onText(captured.joined(separator: " "))
                        dismiss()
                    }
                    .disabled(captured.isEmpty)
                }
            }
        }
    }
}

private struct DataScannerRepresentable: UIViewControllerRepresentable {
    let onTap: (String) -> Void

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [.text(languages: ["fr-FR", "en-US"])],
            qualityLevel: .accurate,
            recognizesMultipleItems: true,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        try? controller.startScanning()
        return controller
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

    static func dismantleUIViewController(_ controller: DataScannerViewController, coordinator: Coordinator) {
        controller.stopScanning()
    }

    func makeCoordinator() -> Coordinator { Coordinator(onTap: onTap) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onTap: (String) -> Void
        init(onTap: @escaping (String) -> Void) { self.onTap = onTap }

        func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            if case let .text(text) = item {
                onTap(text.transcript)
            }
        }
    }
}
