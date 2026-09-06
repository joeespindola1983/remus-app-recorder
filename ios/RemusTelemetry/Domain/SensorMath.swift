import Foundation

enum SensorMath {
    static func magnitude(x: Double, y: Double, z: Double) -> Double {
        sqrt((x * x) + (y * y) + (z * z))
    }

    static func kilometersPerHour(metersPerSecond: Double) -> Double {
        metersPerSecond * 3.6
    }
}

