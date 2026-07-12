import Foundation
import Speech
import AVFoundation

/// Dictée native : SFSpeechRecognizer en français, sur l'appareil quand
/// c'est possible. Le texte reconnu est ajouté à la suite du texte existant.
final class DictationManager: ObservableObject {
    @Published var isRecording = false
    @Published var errorMessage: String?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "fr-FR"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var baseText = ""
    private var onText: ((String) -> Void)?

    func toggle(baseText: String, onText: @escaping (String) -> Void) {
        if isRecording {
            stop()
        } else {
            start(baseText: baseText, onText: onText)
        }
    }

    private func start(baseText: String, onText: @escaping (String) -> Void) {
        self.baseText = baseText.trimmingCharacters(in: .whitespacesAndNewlines)
        self.onText = onText

        SFSpeechRecognizer.requestAuthorization { auth in
            DispatchQueue.main.async {
                guard auth == .authorized else {
                    self.errorMessage = "Autorisez la reconnaissance vocale : Réglages → Lecture → Reconnaissance vocale."
                    return
                }
                AVAudioApplication.requestRecordPermission { granted in
                    DispatchQueue.main.async {
                        guard granted else {
                            self.errorMessage = "Autorisez le micro : Réglages → Lecture → Micro."
                            return
                        }
                        self.beginSession()
                    }
                }
            }
        }
    }

    private func beginSession() {
        guard let recognizer, recognizer.isAvailable else {
            errorMessage = "La reconnaissance vocale n'est pas disponible pour le moment."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition {
                request.requiresOnDeviceRecognition = true // hors ligne et privé
            }
            self.request = request

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                self?.request?.append(buffer)
            }
            engine.prepare()
            try engine.start()
            isRecording = true

            task = recognizer.recognitionTask(with: request) { [weak self] result, error in
                guard let self else { return }
                if let result {
                    let transcript = result.bestTranscription.formattedString
                    DispatchQueue.main.async {
                        let prefix = self.baseText.isEmpty ? "" : self.baseText + " "
                        self.onText?(prefix + transcript)
                    }
                }
                if error != nil || (result?.isFinal ?? false) {
                    DispatchQueue.main.async { self.stop() }
                }
            }
        } catch {
            errorMessage = "Impossible de démarrer le micro."
            stop()
        }
    }

    func stop() {
        guard isRecording || task != nil else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
