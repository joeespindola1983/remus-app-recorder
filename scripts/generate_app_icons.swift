import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let logoUrl = URL(fileURLWithPath: "dist/extracted_logo.png")
guard let imageSource = CGImageSourceCreateWithURL(logoUrl as CFURL, nil),
      let logoImage = CGImageSourceCreateImageAtIndex(imageSource, 0, nil) else {
    print("Error: could not load extracted_logo.png")
    exit(1)
}

let logoAspect = CGFloat(logoImage.width) / CGFloat(logoImage.height)

func savePNG(image: CGImage, to url: URL) {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        print("Failed to create destination for \(url)")
        return
    }
    CGImageDestinationAddImage(destination, image, nil)
    CGImageDestinationFinalize(destination)
}

// 1. Generate iOS App Icons (Opaque White Background)
func generateIOSIcon(size: Int) -> CGImage? {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGImageAlphaInfo.noneSkipLast.rawValue // Opaque RGB
    guard let ctx = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: size * 4,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    ) else { return nil }

    ctx.interpolationQuality = .high

    // Fill pure white
    ctx.setFillColor(CGColor(red: 1.0, green: 1.0, blue: 1.0, alpha: 1.0))
    ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))

    // Draw logo centered with ~18% padding
    let targetWidth = CGFloat(size) * 0.68
    let targetHeight = targetWidth / logoAspect
    let x = (CGFloat(size) - targetWidth) / 2.0
    let y = (CGFloat(size) - targetHeight) / 2.0

    ctx.draw(logoImage, in: CGRect(x: x, y: y, width: targetWidth, height: targetHeight))
    return ctx.makeImage()
}

// 2. Generate Android Squircle Icon (ic_launcher.png)
func generateAndroidSquareIcon(size: Int) -> CGImage? {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue // RGBA
    guard let ctx = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: size * 4,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    ) else { return nil }

    ctx.interpolationQuality = .high

    // Clear transparent
    ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))

    // Draw rounded rect with subtle inset and shadow/edge
    let inset: CGFloat = CGFloat(size) * 0.04
    let rect = CGRect(x: inset, y: inset, width: CGFloat(size) - 2 * inset, height: CGFloat(size) - 2 * inset)
    let radius = rect.width * 0.22

    let path = CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)
    ctx.addPath(path)
    ctx.setFillColor(CGColor(red: 1.0, green: 1.0, blue: 1.0, alpha: 1.0))
    ctx.fillPath()

    // Draw subtle border
    ctx.addPath(path)
    ctx.setStrokeColor(CGColor(red: 0.90, green: 0.92, blue: 0.94, alpha: 1.0))
    ctx.setLineWidth(max(1.0, CGFloat(size) * 0.015))
    ctx.strokePath()

    // Draw logo centered inside
    let targetWidth = rect.width * 0.72
    let targetHeight = targetWidth / logoAspect
    let x = (CGFloat(size) - targetWidth) / 2.0
    let y = (CGFloat(size) - targetHeight) / 2.0

    ctx.draw(logoImage, in: CGRect(x: x, y: y, width: targetWidth, height: targetHeight))
    return ctx.makeImage()
}

// 3. Generate Android Circular Icon (ic_launcher_round.png)
func generateAndroidRoundIcon(size: Int) -> CGImage? {
    let colorSpace = CGColorSpaceCreateDeviceRGB()
    let bitmapInfo = CGImageAlphaInfo.premultipliedLast.rawValue // RGBA
    guard let ctx = CGContext(
        data: nil,
        width: size,
        height: size,
        bitsPerComponent: 8,
        bytesPerRow: size * 4,
        space: colorSpace,
        bitmapInfo: bitmapInfo
    ) else { return nil }

    ctx.interpolationQuality = .high

    // Clear transparent
    ctx.clear(CGRect(x: 0, y: 0, width: size, height: size))

    // Draw circle
    let inset: CGFloat = CGFloat(size) * 0.03
    let rect = CGRect(x: inset, y: inset, width: CGFloat(size) - 2 * inset, height: CGFloat(size) - 2 * inset)
    let path = CGPath(ellipseIn: rect, transform: nil)

    ctx.addPath(path)
    ctx.setFillColor(CGColor(red: 1.0, green: 1.0, blue: 1.0, alpha: 1.0))
    ctx.fillPath()

    // Draw subtle border
    ctx.addPath(path)
    ctx.setStrokeColor(CGColor(red: 0.90, green: 0.92, blue: 0.94, alpha: 1.0))
    ctx.setLineWidth(max(1.0, CGFloat(size) * 0.015))
    ctx.strokePath()

    // Draw logo centered inside
    let targetWidth = rect.width * 0.65
    let targetHeight = targetWidth / logoAspect
    let x = (CGFloat(size) - targetWidth) / 2.0
    let y = (CGFloat(size) - targetHeight) / 2.0

    ctx.draw(logoImage, in: CGRect(x: x, y: y, width: targetWidth, height: targetHeight))
    return ctx.makeImage()
}

// --- Generate iOS Icons ---
let iosDir = URL(fileURLWithPath: "ios/remusapprecorder/Images.xcassets/AppIcon.appiconset")
let iosSizes: [(name: String, size: Int, pointSize: String, scale: String, idiom: String)] = [
    ("icon-20@2x.png", 40, "20x20", "2x", "iphone"),
    ("icon-20@3x.png", 60, "20x20", "3x", "iphone"),
    ("icon-29@2x.png", 58, "29x29", "2x", "iphone"),
    ("icon-29@3x.png", 87, "29x29", "3x", "iphone"),
    ("icon-40@2x.png", 80, "40x40", "2x", "iphone"),
    ("icon-40@3x.png", 120, "40x40", "3x", "iphone"),
    ("icon-60@2x.png", 120, "60x60", "2x", "iphone"),
    ("icon-60@3x.png", 180, "60x60", "3x", "iphone"),
    ("icon-1024.png", 1024, "1024x1024", "1x", "ios-marketing"),
]

for entry in iosSizes {
    if let img = generateIOSIcon(size: entry.size) {
        savePNG(image: img, to: iosDir.appendingPathComponent(entry.name))
        print("Generated iOS: \(entry.name) (\(entry.size)x\(entry.size))")
    }
}

// Update Contents.json for iOS
var imageEntries: [[String: String]] = []
for entry in iosSizes {
    imageEntries.append([
        "filename": entry.name,
        "idiom": entry.idiom,
        "scale": entry.scale,
        "size": entry.pointSize
    ])
}
let contentsDict: [String: Any] = [
    "images": imageEntries,
    "info": [
        "author": "xcode",
        "version": 1
    ]
]
if let data = try? JSONSerialization.data(withJSONObject: contentsDict, options: [.prettyPrinted, .sortedKeys]) {
    try? data.write(to: iosDir.appendingPathComponent("Contents.json"))
    print("Updated iOS Contents.json")
}

// --- Generate Android Icons ---
let androidDensities: [(folder: String, size: Int)] = [
    ("mipmap-mdpi", 48),
    ("mipmap-hdpi", 72),
    ("mipmap-xhdpi", 96),
    ("mipmap-xxhdpi", 144),
    ("mipmap-xxxhdpi", 192),
]

for density in androidDensities {
    let folderUrl = URL(fileURLWithPath: "android/app/src/main/res/\(density.folder)")
    if let square = generateAndroidSquareIcon(size: density.size) {
        savePNG(image: square, to: folderUrl.appendingPathComponent("ic_launcher.png"))
        print("Generated Android \(density.folder)/ic_launcher.png (\(density.size)x\(density.size))")
    }
    if let round = generateAndroidRoundIcon(size: density.size) {
        savePNG(image: round, to: folderUrl.appendingPathComponent("ic_launcher_round.png"))
        print("Generated Android \(density.folder)/ic_launcher_round.png (\(density.size)x\(density.size))")
    }
}

print("All app icons successfully generated!")
