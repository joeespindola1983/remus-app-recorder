import CoreLocation
import Foundation

struct WeatherService {
    private struct Response: Decodable {
        struct Current: Decodable {
            let time: String
            let temperature2m: Double?
            let apparentTemperature: Double?
            let relativeHumidity2m: Double?
            let precipitation: Double?
            let surfacePressure: Double?
            let windSpeed10m: Double?
            let windDirection10m: Double?
            let windGusts10m: Double?
            let weatherCode: Int?

            enum CodingKeys: String, CodingKey {
                case time
                case temperature2m = "temperature_2m"
                case apparentTemperature = "apparent_temperature"
                case relativeHumidity2m = "relative_humidity_2m"
                case precipitation
                case surfacePressure = "surface_pressure"
                case windSpeed10m = "wind_speed_10m"
                case windDirection10m = "wind_direction_10m"
                case windGusts10m = "wind_gusts_10m"
                case weatherCode = "weather_code"
            }
        }

        let current: Current
    }

    func current(at coordinate: CLLocationCoordinate2D) async throws -> WeatherSnapshot {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")!
        components.queryItems = [
            URLQueryItem(name: "latitude", value: String(coordinate.latitude)),
            URLQueryItem(name: "longitude", value: String(coordinate.longitude)),
            URLQueryItem(
                name: "current",
                value: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code"
            ),
            URLQueryItem(name: "timezone", value: "UTC")
        ]

        let (data, response) = try await URLSession.shared.data(from: components.url!)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        let decoded = try JSONDecoder().decode(Response.self, from: data)
        let current = decoded.current
        return WeatherSnapshot(
            recordedAt: Date(),
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            sourceTime: current.time,
            temperatureCelsius: current.temperature2m,
            apparentTemperatureCelsius: current.apparentTemperature,
            relativeHumidityPercent: current.relativeHumidity2m,
            precipitationMillimeters: current.precipitation,
            surfacePressureHectopascals: current.surfacePressure,
            windSpeedKilometersPerHour: current.windSpeed10m,
            windDirectionDegrees: current.windDirection10m,
            windGustKilometersPerHour: current.windGusts10m,
            weatherCode: current.weatherCode,
            provider: "Open-Meteo"
        )
    }
}

