import Foundation
import SQLite3

final class SessionDatabaseWriter {
    enum WriterError: LocalizedError {
        case database(String)
        case queueFull
        case lowDiskSpace(Int64)
        case notStarted

        var errorDescription: String? {
            switch self {
            case let .database(message): return "Database error: \(message)"
            case .queueFull: return "The recorder cannot keep up with the sensor stream."
            case let .lowDiskSpace(bytes): return "Recording stopped: only \(ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)) remains."
            case .notStarted: return "The session database is not open."
            }
        }
    }

    static let minimumFreeSpaceBytes: Int64 = 512 * 1_024 * 1_024
    static let maximumPendingWrites = 1_000
    private static let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    var onError: ((Error) -> Void)?

    private let rootDirectory: URL?
    private let queue = DispatchQueue(label: "com.espindola.remus.session-database", qos: .userInitiated)
    private let stateLock = NSLock()
    private var database: OpaquePointer?
    private var folderURL: URL?
    private var manifest: RecordingManifest?
    private var failed = false
    private var failureDescription: String?
    private var pendingWrites = 0
    private var rowsSinceCommit = 0
    private var commitsSinceCheckpoint = 0
    private var lastCommit = Date()

    private var motionStatement: OpaquePointer?
    private var locationStatement: OpaquePointer?
    private var headingStatement: OpaquePointer?
    private var altimeterStatement: OpaquePointer?
    private var weatherStatement: OpaquePointer?
    private var deviceStatement: OpaquePointer?

    init(rootDirectory: URL? = nil) {
        self.rootDirectory = rootDirectory
    }

    func start(metadata: SessionMetadata) throws -> URL {
        try queue.sync {
            let root = try sessionsFolder()
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd_HH-mm-ss"
            let id = metadata.sessionID
            let folder = root.appendingPathComponent("session-\(formatter.string(from: metadata.startedAt))-\(id.uuidString.prefix(8))", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)

            let databaseURL = folder.appendingPathComponent("telemetry.sqlite")
            var openedDatabase: OpaquePointer?
            let flags = SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX
            guard sqlite3_open_v2(databaseURL.path, &openedDatabase, flags, nil) == SQLITE_OK, let openedDatabase else {
                throw WriterError.database("Could not open telemetry.sqlite")
            }

            database = openedDatabase
            folderURL = folder
            manifest = RecordingManifest(
                id: id,
                startedAt: metadata.startedAt,
                endedAt: nil,
                appVersion: metadata.appVersion,
                deviceModel: metadata.deviceModel,
                systemVersion: metadata.systemVersion,
                notes: metadata.notes,
                motionFrequencyHertz: metadata.motionFrequencyHertz,
                motionSampleCount: 0,
                locationSampleCount: 0,
                headingSampleCount: 0,
                altimeterSampleCount: 0,
                weatherSampleCount: 0,
                status: .recording,
                failureMessage: nil,
                databaseFilename: databaseURL.lastPathComponent
            )
            stateLock.withLock {
                failed = false
                failureDescription = nil
                pendingWrites = 0
            }

            do {
                try execute("PRAGMA journal_mode=WAL")
                try execute("PRAGMA synchronous=NORMAL")
                try execute("PRAGMA temp_store=MEMORY")
                try execute("PRAGMA wal_autocheckpoint=0")
                try createSchema()
                try prepareStatements()
                try execute("BEGIN IMMEDIATE")
                rowsSinceCommit = 0
                commitsSinceCheckpoint = 0
                lastCommit = Date()
                try writeManifest()
                return folder
            } catch {
                closeDatabase()
                throw error
            }
        }
    }

    @discardableResult
    func appendMotion(_ sample: MotionSample, recordedAt: Date, elapsedSeconds: Double) -> Bool {
        enqueue { [weak self] in try self?.insertMotion(sample, recordedAt: recordedAt, elapsedSeconds: elapsedSeconds) }
    }

    @discardableResult
    func appendLocation(_ sample: LocationSample, recordedAt: Date, elapsedSeconds: Double) -> Bool {
        enqueue { [weak self] in try self?.insertLocation(sample, recordedAt: recordedAt, elapsedSeconds: elapsedSeconds) }
    }

    @discardableResult
    func appendHeading(_ sample: HeadingSample, recordedAt: Date, elapsedSeconds: Double) -> Bool {
        enqueue { [weak self] in try self?.insertHeading(sample, recordedAt: recordedAt, elapsedSeconds: elapsedSeconds) }
    }

    @discardableResult
    func appendAltimeter(_ sample: AltimeterSample, recordedAt: Date, elapsedSeconds: Double) -> Bool {
        enqueue { [weak self] in try self?.insertAltimeter(sample, recordedAt: recordedAt, elapsedSeconds: elapsedSeconds) }
    }

    @discardableResult
    func appendWeather(_ sample: WeatherSnapshot, elapsedSeconds: Double) -> Bool {
        enqueue { [weak self] in try self?.insertWeather(sample, elapsedSeconds: elapsedSeconds) }
    }

    @discardableResult
    func appendDevice(_ sample: DeviceSample, recordedAt: Date, elapsedSeconds: Double) -> Bool {
        enqueue { [weak self] in try self?.insertDevice(sample, recordedAt: recordedAt, elapsedSeconds: elapsedSeconds) }
    }

    func stop(at date: Date, failureMessage: String? = nil) -> URL? {
        queue.sync {
            guard database != nil else { return folderURL }
            do {
                try commit(reopen: false)
                sqlite3_wal_checkpoint_v2(database, nil, SQLITE_CHECKPOINT_TRUNCATE, nil, nil)
                manifest?.endedAt = date
                manifest?.status = failureMessage == nil ? .completed : .failed
                manifest?.failureMessage = failureMessage
                try writeManifest()
            } catch {
                report(error)
            }
            closeDatabase()
            removeDatabaseSidecars()
            return folderURL
        }
    }

    var queuedWriteCount: Int {
        stateLock.withLock { pendingWrites }
    }

    var lastErrorDescription: String? {
        stateLock.withLock { failureDescription }
    }

    private func enqueue(_ work: @escaping () throws -> Void) -> Bool {
        let accepted = stateLock.withLock { () -> Bool in
            guard !failed, pendingWrites < Self.maximumPendingWrites else { return false }
            pendingWrites += 1
            return true
        }
        guard accepted else {
            if !stateLock.withLock({ failed }) { report(WriterError.queueFull) }
            return false
        }

        queue.async { [weak self] in
            guard let self else { return }
            defer { self.stateLock.withLock { self.pendingWrites -= 1 } }
            guard !self.stateLock.withLock({ self.failed }) else { return }
            do {
                try work()
                self.rowsSinceCommit += 1
                if self.rowsSinceCommit >= 500 || Date().timeIntervalSince(self.lastCommit) >= 5 {
                    try self.commit(reopen: true)
                }
                if self.rowsSinceCommit.isMultiple(of: 1_000) { try self.checkFreeSpace() }
            } catch {
                self.report(error)
            }
        }
        return true
    }

    private func commit(reopen: Bool) throws {
        try execute("COMMIT")
        try writeManifest()
        rowsSinceCommit = 0
        lastCommit = Date()
        commitsSinceCheckpoint += 1
        if commitsSinceCheckpoint >= 12 {
            sqlite3_wal_checkpoint_v2(database, nil, SQLITE_CHECKPOINT_PASSIVE, nil, nil)
            commitsSinceCheckpoint = 0
        }
        if reopen { try execute("BEGIN IMMEDIATE") }
    }

    private func checkFreeSpace() throws {
        guard let folderURL else { return }
        let values = try folderURL.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        let reported = values.volumeAvailableCapacityForImportantUsage ?? 0
        let filesystem = try FileManager.default.attributesOfFileSystem(forPath: folderURL.path)
        let fallback = (filesystem[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
        let bytes = reported > 0 ? reported : fallback
        if bytes > 0, bytes < Self.minimumFreeSpaceBytes {
            throw WriterError.lowDiskSpace(bytes)
        }
    }

    private func createSchema() throws {
        try execute("""
        CREATE TABLE IF NOT EXISTS motion (
          id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, sensor_uptime REAL NOT NULL,
          raw_ax REAL, raw_ay REAL, raw_az REAL, raw_gx REAL, raw_gy REAL, raw_gz REAL,
          raw_mx REAL, raw_my REAL, raw_mz REAL, user_ax REAL NOT NULL, user_ay REAL NOT NULL, user_az REAL NOT NULL,
          gravity_x REAL NOT NULL, gravity_y REAL NOT NULL, gravity_z REAL NOT NULL,
          rotation_x REAL NOT NULL, rotation_y REAL NOT NULL, rotation_z REAL NOT NULL,
          magnetic_x REAL NOT NULL, magnetic_y REAL NOT NULL, magnetic_z REAL NOT NULL, magnetic_accuracy INTEGER NOT NULL,
          roll REAL NOT NULL, pitch REAL NOT NULL, yaw REAL NOT NULL, qx REAL NOT NULL, qy REAL NOT NULL, qz REAL NOT NULL, qw REAL NOT NULL
        )
        """)
        try execute("""
        CREATE TABLE IF NOT EXISTS location (
          id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, source_time REAL NOT NULL,
          latitude REAL NOT NULL, longitude REAL NOT NULL, altitude REAL, ellipsoidal_altitude REAL,
          horizontal_accuracy REAL NOT NULL, vertical_accuracy REAL, speed REAL, speed_accuracy REAL,
          course REAL, course_accuracy REAL, simulated INTEGER, produced_by_accessory INTEGER
        )
        """)
        try execute("""
        CREATE TABLE IF NOT EXISTS heading (
          id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, true_degrees REAL,
          magnetic_degrees REAL NOT NULL, accuracy REAL NOT NULL, field_x REAL NOT NULL, field_y REAL NOT NULL, field_z REAL NOT NULL
        )
        """)
        try execute("CREATE TABLE IF NOT EXISTS altimeter (id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, relative_altitude REAL NOT NULL, pressure_kpa REAL NOT NULL)")
        try execute("""
        CREATE TABLE IF NOT EXISTS weather (
          id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
          source_time TEXT NOT NULL, temperature REAL, apparent_temperature REAL, humidity REAL, precipitation REAL,
          surface_pressure REAL, wind_speed REAL, wind_direction REAL, wind_gust REAL, weather_code INTEGER, provider TEXT NOT NULL
        )
        """)
        try execute("CREATE TABLE IF NOT EXISTS device (id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, battery_level REAL, battery_state TEXT NOT NULL)")
        try execute("CREATE INDEX IF NOT EXISTS motion_elapsed_idx ON motion(elapsed)")
        try execute("CREATE INDEX IF NOT EXISTS location_elapsed_idx ON location(elapsed)")
    }

    private func prepareStatements() throws {
        motionStatement = try prepare(insertSQL(table: "motion", valueCount: 32))
        locationStatement = try prepare(insertSQL(table: "location", valueCount: 15))
        headingStatement = try prepare("INSERT INTO heading VALUES (NULL,?,?,?,?,?,?,?,?)")
        altimeterStatement = try prepare("INSERT INTO altimeter VALUES (NULL,?,?,?,?)")
        weatherStatement = try prepare(insertSQL(table: "weather", valueCount: 15))
        deviceStatement = try prepare("INSERT INTO device VALUES (NULL,?,?,?,?)")
    }

    private func insertSQL(table: String, valueCount: Int) -> String {
        "INSERT INTO \(table) VALUES (NULL,\(Array(repeating: "?", count: valueCount).joined(separator: ",")))"
    }

    private func insertMotion(_ value: MotionSample, recordedAt: Date, elapsedSeconds: Double) throws {
        guard let statement = motionStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        bind(recordedAt.timeIntervalSince1970, to: statement, at: &index)
        bind(elapsedSeconds, to: statement, at: &index)
        bind(value.sensorTimestampSeconds, to: statement, at: &index)
        bind(value.rawAccelerationG, to: statement, at: &index)
        bind(value.rawRotationRateRadiansPerSecond, to: statement, at: &index)
        bind(value.rawMagneticFieldMicrotesla, to: statement, at: &index)
        bind(value.userAccelerationG, to: statement, at: &index)
        bind(value.gravityG, to: statement, at: &index)
        bind(value.rotationRateRadiansPerSecond, to: statement, at: &index)
        bind(value.calibratedMagneticFieldMicrotesla, to: statement, at: &index)
        sqlite3_bind_int(statement, index, Int32(value.magneticFieldCalibrationAccuracy)); index += 1
        let attitude = value.attitude
        for number in [attitude.rollRadians, attitude.pitchRadians, attitude.yawRadians, attitude.quaternionX, attitude.quaternionY, attitude.quaternionZ, attitude.quaternionW] {
            bind(number, to: statement, at: &index)
        }
        try finish(statement)
        manifest?.motionSampleCount += 1
    }

    private func insertLocation(_ value: LocationSample, recordedAt: Date, elapsedSeconds: Double) throws {
        guard let statement = locationStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        for number in [recordedAt.timeIntervalSince1970, elapsedSeconds, value.sourceTimestamp.timeIntervalSince1970, value.latitude, value.longitude] { bind(number, to: statement, at: &index) }
        for number in [value.altitudeMeters, value.ellipsoidalAltitudeMeters, Optional(value.horizontalAccuracyMeters), value.verticalAccuracyMeters, value.speedMetersPerSecond, value.speedAccuracyMetersPerSecond, value.courseDegrees, value.courseAccuracyDegrees] { bind(number, to: statement, at: &index) }
        bind(value.isSimulatedBySoftware, to: statement, at: &index)
        bind(value.isProducedByAccessory, to: statement, at: &index)
        try finish(statement)
        manifest?.locationSampleCount += 1
    }

    private func insertHeading(_ value: HeadingSample, recordedAt: Date, elapsedSeconds: Double) throws {
        guard let statement = headingStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        bind(recordedAt.timeIntervalSince1970, to: statement, at: &index); bind(elapsedSeconds, to: statement, at: &index)
        bind(value.trueDegrees, to: statement, at: &index); bind(value.magneticDegrees, to: statement, at: &index); bind(value.accuracyDegrees, to: statement, at: &index)
        bind(value.magneticFieldMicrotesla, to: statement, at: &index)
        try finish(statement)
        manifest?.headingSampleCount += 1
    }

    private func insertAltimeter(_ value: AltimeterSample, recordedAt: Date, elapsedSeconds: Double) throws {
        guard let statement = altimeterStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        for number in [recordedAt.timeIntervalSince1970, elapsedSeconds, value.relativeAltitudeMeters, value.pressureKilopascals] { bind(number, to: statement, at: &index) }
        try finish(statement)
        manifest?.altimeterSampleCount += 1
    }

    private func insertWeather(_ value: WeatherSnapshot, elapsedSeconds: Double) throws {
        guard let statement = weatherStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        for number in [value.recordedAt.timeIntervalSince1970, elapsedSeconds, value.latitude, value.longitude] { bind(number, to: statement, at: &index) }
        bind(value.sourceTime, to: statement, at: &index)
        for number in [value.temperatureCelsius, value.apparentTemperatureCelsius, value.relativeHumidityPercent, value.precipitationMillimeters, value.surfacePressureHectopascals, value.windSpeedKilometersPerHour, value.windDirectionDegrees, value.windGustKilometersPerHour] { bind(number, to: statement, at: &index) }
        if let code = value.weatherCode { sqlite3_bind_int(statement, index, Int32(code)) } else { sqlite3_bind_null(statement, index) }; index += 1
        bind(value.provider, to: statement, at: &index)
        try finish(statement)
        manifest?.weatherSampleCount += 1
    }

    private func insertDevice(_ value: DeviceSample, recordedAt: Date, elapsedSeconds: Double) throws {
        guard let statement = deviceStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        bind(recordedAt.timeIntervalSince1970, to: statement, at: &index); bind(elapsedSeconds, to: statement, at: &index)
        bind(value.batteryLevel, to: statement, at: &index); bind(value.batteryState, to: statement, at: &index)
        try finish(statement)
    }

    private func bind(_ vector: Vector3?, to statement: OpaquePointer, at index: inout Int32) {
        bind(vector?.x, to: statement, at: &index); bind(vector?.y, to: statement, at: &index); bind(vector?.z, to: statement, at: &index)
    }

    private func bind(_ value: Double, to statement: OpaquePointer, at index: inout Int32) {
        sqlite3_bind_double(statement, index, value); index += 1
    }

    private func bind(_ value: Double?, to statement: OpaquePointer, at index: inout Int32) {
        if let value { sqlite3_bind_double(statement, index, value) } else { sqlite3_bind_null(statement, index) }
        index += 1
    }

    private func bind(_ value: String, to statement: OpaquePointer, at index: inout Int32) {
        _ = value.withCString { sqlite3_bind_text(statement, index, $0, -1, Self.sqliteTransient) }
        index += 1
    }

    private func bind(_ value: Bool?, to statement: OpaquePointer, at index: inout Int32) {
        if let value { sqlite3_bind_int(statement, index, value ? 1 : 0) } else { sqlite3_bind_null(statement, index) }
        index += 1
    }

    private func finish(_ statement: OpaquePointer) throws {
        defer { sqlite3_reset(statement); sqlite3_clear_bindings(statement) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw lastDatabaseError() }
    }

    private func prepare(_ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw lastDatabaseError() }
        return statement
    }

    private func execute(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw lastDatabaseError() }
    }

    private func lastDatabaseError() -> Error {
        WriterError.database(database.map { String(cString: sqlite3_errmsg($0)) } ?? "Unknown SQLite error")
    }

    private func report(_ error: Error) {
        let shouldReport = stateLock.withLock { () -> Bool in
            guard !failed else { return false }
            failed = true
            failureDescription = error.localizedDescription
            return true
        }
        if shouldReport { DispatchQueue.main.async { [weak self] in self?.onError?(error) } }
    }

    private func closeDatabase() {
        for statement in [motionStatement, locationStatement, headingStatement, altimeterStatement, weatherStatement, deviceStatement] {
            if let statement { sqlite3_finalize(statement) }
        }
        motionStatement = nil; locationStatement = nil; headingStatement = nil; altimeterStatement = nil; weatherStatement = nil; deviceStatement = nil
        if let database { sqlite3_close_v2(database) }
        database = nil
    }

    private func removeDatabaseSidecars() {
        guard let folderURL else { return }
        let databaseURL = folderURL.appendingPathComponent("telemetry.sqlite")
        for suffix in ["-wal", "-shm"] {
            let sidecar = URL(fileURLWithPath: databaseURL.path + suffix)
            if FileManager.default.fileExists(atPath: sidecar.path) {
                try? FileManager.default.removeItem(at: sidecar)
            }
        }
    }

    private func writeManifest() throws {
        guard let manifest, let folderURL else { throw WriterError.notStarted }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(manifest).write(to: folderURL.appendingPathComponent("manifest.json"), options: .atomic)
    }

    private func sessionsFolder() throws -> URL {
        if let rootDirectory {
            try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
            return rootDirectory
        }
        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let folder = documents.appendingPathComponent("RemusSessions", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }
}

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T {
        lock(); defer { unlock() }
        return body()
    }
}
