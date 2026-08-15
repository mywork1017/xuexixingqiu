#!/usr/bin/env swift

import AppKit
import Foundation
import Vision

struct Classification: Codable {
    let label: String
    let confidence: Float
}

struct TextObservation: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct RegionObservation: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let area: Double
}

struct Analysis: Codable {
    let path: String
    let classifications: [Classification]
    let texts: [TextObservation]
    let faceCount: Int
    let humanCount: Int
    let faces: [RegionObservation]
    let humans: [RegionObservation]
    let error: String?
}

func region(_ box: CGRect) -> RegionObservation {
    RegionObservation(
        x: box.origin.x,
        y: box.origin.y,
        width: box.width,
        height: box.height,
        area: box.width * box.height
    )
}

func analyze(path: String) -> Analysis {
    let url = URL(fileURLWithPath: path)
    guard let image = NSImage(contentsOf: url),
          let data = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: data),
          let cgImage = bitmap.cgImage else {
        return Analysis(path: path, classifications: [], texts: [], faceCount: 0, humanCount: 0, faces: [], humans: [], error: "cannot decode image")
    }

    let classify = VNClassifyImageRequest()
    let recognizeText = VNRecognizeTextRequest()
    recognizeText.recognitionLevel = .accurate
    recognizeText.usesLanguageCorrection = true
    recognizeText.recognitionLanguages = ["zh-Hans", "en-US"]
    recognizeText.minimumTextHeight = 0.012
    let faces = VNDetectFaceRectanglesRequest()
    let humans = VNDetectHumanRectanglesRequest()
    humans.upperBodyOnly = false

    do {
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([classify, recognizeText, faces, humans])
        let classifications = (classify.results ?? []).prefix(20).map {
            Classification(label: $0.identifier, confidence: $0.confidence)
        }
        let texts = (recognizeText.results ?? []).compactMap { observation -> TextObservation? in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            return TextObservation(
                text: candidate.string,
                confidence: candidate.confidence,
                x: box.origin.x,
                y: box.origin.y,
                width: box.width,
                height: box.height
            )
        }
        let faceRegions = (faces.results ?? []).map { region($0.boundingBox) }
        let humanRegions = (humans.results ?? []).map { region($0.boundingBox) }
        return Analysis(
            path: path,
            classifications: classifications,
            texts: texts,
            faceCount: faceRegions.count,
            humanCount: humanRegions.count,
            faces: faceRegions,
            humans: humanRegions,
            error: nil
        )
    } catch {
        return Analysis(path: path, classifications: [], texts: [], faceCount: 0, humanCount: 0, faces: [], humans: [], error: String(describing: error))
    }
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
for path in CommandLine.arguments.dropFirst() {
    let result = analyze(path: path)
    if let data = try? encoder.encode(result), let line = String(data: data, encoding: .utf8) {
        print(line)
    }
}
