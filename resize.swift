import Foundation
import AppKit
import CoreGraphics

func processImage(inputPath: String, bgWhite: Bool) {
    guard let img = NSImage(contentsOfFile: inputPath),
          let cgImage = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("Failed to load \(inputPath)")
        exit(1)
    }

    let sizes = [20, 29, 40, 60]
    let scales = [2, 3]

    let outDir = "ios/remusapprecorder/Images.xcassets/AppIcon.appiconset"

    for size in sizes {
        for scale in scales {
            let w = size * scale
            saveImage(cgImage: cgImage, width: w, height: w, name: "icon-\(size)@\(scale)x.png", outDir: outDir, bgWhite: bgWhite)
        }
    }
    
    // 1024x1024
    saveImage(cgImage: cgImage, width: 1024, height: 1024, name: "icon-1024.png", outDir: outDir, bgWhite: bgWhite)
}

func saveImage(cgImage: CGImage, width: Int, height: Int, name: String, outDir: String, bgWhite: Bool) {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = bgWhite ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
    
    guard let context = CGContext(data: nil,
                                  width: width,
                                  height: height,
                                  bitsPerComponent: 8,
                                  bytesPerRow: 0,
                                  space: colorSpace,
                                  bitmapInfo: bitmapInfo) else {
        print("Failed to create context for \(width)x\(height)")
        return
    }
    
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    
    if bgWhite {
        context.setFillColor(NSColor.white.cgColor)
        context.fill(rect)
    }
    
    context.draw(cgImage, in: rect)
    
    guard let newCgImage = context.makeImage() else { return }
    let rep = NSBitmapImageRep(cgImage: newCgImage)
    
    guard let data = rep.representation(using: .png, properties: [:]) else { return }

    let path = outDir + "/" + name
    do {
        try data.write(to: URL(fileURLWithPath: path))
        print("Wrote \(path) (\(width)x\(height) pixels)")
    } catch {
        print("Error writing \(path): \(error)")
    }
}

processImage(inputPath: "icon.png", bgWhite: true)
