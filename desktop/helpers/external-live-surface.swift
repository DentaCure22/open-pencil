import AppKit
import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

// OpenPencil's bounded window-region transport follows the capture architecture
// demonstrated by Attune: desktop-independent ScreenCaptureKit windows, point-to-
// pixel scaling, and independent latest-frame queues for encoding and stdout.

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("\(message)\n".utf8))
  exit(1)
}

func encodeFrame(_ image: CGImage) -> Data {
  let data = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(
    data,
    UTType.jpeg.identifier as CFString,
    1,
    nil
  ) else {
    fail("could not create JPEG destination")
  }
  let options = [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary
  CGImageDestinationAddImage(destination, image, options)
  guard CGImageDestinationFinalize(destination) else { fail("could not encode JPEG") }
  return data as Data
}

func writePacket(_ data: Data) {
  var length = UInt32(data.count).bigEndian
  var packet = Data(bytes: &length, count: MemoryLayout<UInt32>.size)
  packet.append(data)
  FileHandle.standardOutput.write(packet)
}

func normalized(_ value: String) -> String {
  value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
    .trimmingCharacters(in: .whitespacesAndNewlines)
}

func candidateScore(_ window: SCWindow, expectedFrame: CGRect, expectedTitle: String) -> CGFloat {
  let geometry = abs(window.frame.minX - expectedFrame.minX)
    + abs(window.frame.minY - expectedFrame.minY)
    + abs(window.frame.width - expectedFrame.width)
    + abs(window.frame.height - expectedFrame.height)
  let title = normalized(window.title ?? "")
  let expected = normalized(expectedTitle)
  if expected.isEmpty || title.contains(expected) || expected.contains(title) { return geometry }
  return geometry + 10_000
}

@available(macOS 14.0, *)
final class RegionStreamOutput: NSObject, SCStreamOutput {
  private let context = CIContext(options: [.cacheIntermediates: false])
  private let encodeQueue = DispatchQueue(
    label: "openpencil.external-live-surface.encode",
    qos: .userInteractive
  )
  private let writeQueue = DispatchQueue(
    label: "openpencil.external-live-surface.write",
    qos: .userInteractive
  )
  private let lock = NSLock()
  private let frameLimit: Int
  private var encoding = false
  private var pendingPixelBuffer: CVPixelBuffer?
  private var writing = false
  private var pendingWrite: Data?
  private var emitted = 0
  private var finished = false

  init(frameLimit: Int) {
    self.frameLimit = frameLimit
  }

  var isFinished: Bool {
    lock.lock()
    defer { lock.unlock() }
    return finished
  }

  func stream(
    _ stream: SCStream,
    didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of outputType: SCStreamOutputType
  ) {
    guard outputType == .screen,
          sampleBuffer.isValid,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer)
    else { return }

    lock.lock()
    if encoding || finished {
      if encoding && !finished { pendingPixelBuffer = pixelBuffer }
      lock.unlock()
      return
    }
    encoding = true
    lock.unlock()

    encodeQueue.async { [self, pixelBuffer] in
      drainEncodes(startingWith: pixelBuffer)
    }
  }

  private func drainEncodes(startingWith firstPixelBuffer: CVPixelBuffer) {
    var current: CVPixelBuffer? = firstPixelBuffer
    while let pixelBuffer = current {
      var encodedData: Data?
      autoreleasepool {
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        if let rendered = context.createCGImage(image, from: image.extent) {
          encodedData = encodeFrame(rendered)
        }
      }
      if let encodedData { enqueueWrite(encodedData) }

      lock.lock()
      if finished {
        pendingPixelBuffer = nil
        encoding = false
        current = nil
      } else if let nextPixelBuffer = pendingPixelBuffer {
        pendingPixelBuffer = nil
        current = nextPixelBuffer
      } else {
        encoding = false
        current = nil
      }
      lock.unlock()
    }
  }

  private func enqueueWrite(_ data: Data) {
    lock.lock()
    if finished {
      lock.unlock()
      return
    }
    if writing {
      pendingWrite = data
      lock.unlock()
      return
    }
    writing = true
    lock.unlock()

    writeQueue.async { [self] in
      drainWrites(startingWith: data)
    }
  }

  private func drainWrites(startingWith firstData: Data) {
    var current: Data? = firstData
    while let data = current {
      writePacket(data)

      lock.lock()
      emitted += 1
      if frameLimit > 0 && emitted >= frameLimit {
        finished = true
        pendingPixelBuffer = nil
        pendingWrite = nil
        writing = false
        current = nil
      } else if let nextData = pendingWrite {
        pendingWrite = nil
        current = nextData
      } else {
        writing = false
        current = nil
      }
      lock.unlock()
    }
  }
}

@main
struct ExternalLiveSurfaceStream {
  static func main() async {
    _ = NSApplication.shared
    let arguments = CommandLine.arguments
    guard arguments.count == 12 else {
      fail("usage: external-live-surface <title> <region-x> <region-y> <region-width> <region-height> <window-x> <window-y> <window-width> <window-height> <fps> <frame-limit>")
    }
    let sourceTitle = arguments[1]
    guard let regionX = Double(arguments[2]),
          let regionY = Double(arguments[3]),
          let regionWidth = Double(arguments[4]),
          let regionHeight = Double(arguments[5]),
          let windowX = Double(arguments[6]),
          let windowY = Double(arguments[7]),
          let windowWidth = Double(arguments[8]),
          let windowHeight = Double(arguments[9]),
          let requestedFPS = Double(arguments[10]),
          let frameLimit = Int(arguments[11]),
          regionWidth > 0,
          regionHeight > 0,
          windowWidth > 0,
          windowHeight > 0,
          requestedFPS > 0
    else { fail("invalid capture arguments") }

    guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
      fail("screen capture permission is unavailable")
    }
    guard #available(macOS 14.0, *) else {
      fail("window surface capture requires macOS 14 or newer")
    }

    do {
      let content = try await SCShareableContent.excludingDesktopWindows(
        false,
        onScreenWindowsOnly: false
      )
      let expectedWindowFrame = CGRect(
        x: windowX,
        y: windowY,
        width: windowWidth,
        height: windowHeight
      )
      let candidates = content.windows.filter {
        $0.frame.width > 100 && $0.frame.height > 100
      }
      guard let window = candidates.min(by: {
        candidateScore($0, expectedFrame: expectedWindowFrame, expectedTitle: sourceTitle)
          < candidateScore($1, expectedFrame: expectedWindowFrame, expectedTitle: sourceTitle)
      }) else {
        fail("no capturable source window")
      }

      let requestedBounds = CGRect(
        x: window.frame.minX + regionX,
        y: window.frame.minY + regionY,
        width: regionWidth,
        height: regionHeight
      )
      let intersection = requestedBounds.intersection(window.frame)
      guard !intersection.isNull && intersection.width > 0 && intersection.height > 0 else {
        fail("requested region is outside the source window")
      }

      let filter = SCContentFilter(desktopIndependentWindow: window)
      let scale = CGFloat(filter.pointPixelScale)
      let framesPerSecond = min(60, max(1, requestedFPS))
      let configuration = SCStreamConfiguration()
      configuration.sourceRect = CGRect(
        x: intersection.minX - window.frame.minX,
        y: intersection.minY - window.frame.minY,
        width: intersection.width,
        height: intersection.height
      )
      configuration.width = max(1, Int(intersection.width * scale))
      configuration.height = max(1, Int(intersection.height * scale))
      configuration.showsCursor = false
      configuration.ignoreShadowsSingleWindow = true
      configuration.captureResolution = .best
      configuration.pixelFormat = kCVPixelFormatType_32BGRA
      configuration.minimumFrameInterval = CMTime(
        value: 1,
        timescale: CMTimeScale(framesPerSecond.rounded())
      )
      configuration.queueDepth = 2

      do {
        let initialImage = try await SCScreenshotManager.captureImage(
          contentFilter: filter,
          configuration: configuration
        )
        writePacket(encodeFrame(initialImage))
        if frameLimit == 1 { return }
      } catch {
        FileHandle.standardError.write(Data(
          "initial screenshot unavailable: \(error.localizedDescription)\n".utf8
        ))
      }

      let output = RegionStreamOutput(frameLimit: frameLimit > 1 ? frameLimit - 1 : frameLimit)
      let sampleQueue = DispatchQueue(
        label: "openpencil.external-live-surface.samples",
        qos: .userInteractive
      )
      let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
      try stream.addStreamOutput(output, type: .screen, sampleHandlerQueue: sampleQueue)
      try await stream.startCapture()
      FileHandle.standardError.write(Data(
        "ready window=\(window.windowID) pixels=\(configuration.width)x\(configuration.height) fps=\(Int(framesPerSecond))\n".utf8
      ))

      while frameLimit <= 0 || !output.isFinished {
        try await Task.sleep(nanoseconds: 20_000_000)
      }
      try await stream.stopCapture()
    } catch {
      fail("ScreenCaptureKit failed: \(error.localizedDescription)")
    }
  }
}
