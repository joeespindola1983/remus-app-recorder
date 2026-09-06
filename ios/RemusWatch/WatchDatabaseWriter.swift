import Foundation
import SQLite3

final class WatchDatabaseWriter {
    enum WriterError: LocalizedError {
        case database(String)
        case queueFull
        case notStarted

        var errorDescription: String? {
            switch self {
            case let .database(message): return "Watch database error: \(message)"
            case .queueFull: return "The Watch recorder cannot keep up with the sensor stream."
            case .notStarted: return "The Watch database is not open."
            }
        }
    }

    static let maximumPendingWrites = 500
    private static let sqliteTransient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    var onError: ((Error) -> Void)?

    private let rootDirectory: URL?
    private let queue = DispatchQueue(label: "com.espindola.remus.watch-database", qos: .userInitiated)
    private let lock = NSLock()
    private var database: OpaquePointer?
    private var folderURL: URL?
    private var manifest: WatchManifest?
    private var pendingWrites = 0
    private var failed = false
    private var rowsSinceCommit = 0
    private var lastCommit = Date()

    private var motionStatement: OpaquePointer?
    private var locationStatement: OpaquePointer?
    private var altimeterStatement: OpaquePointer?
    private var healthStatement: OpaquePointer?
    private var deviceStatement: OpaquePointer?

    init(rootDirectory: URL? = nil) {
        self.rootDirectory = rootDirectory
    }

    var queuedWriteCount: Int { lock.withLock { pendingWrites } }

    func start(manifest initialManifest: WatchManifest) throws -> URL {
        try queue.sync {
            let root = try sessionsDirectory()
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "yyyy-MM-dd_HH-mm-ss"
            let folder = root.appendingPathComponent(
                "watch-session-\(formatter.string(from: initialManifest.startedAt))-\(initialManifest.id.uuidString.prefix(8))",
                isDirectory: true
            )
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let databaseURL = folder.appendingPathComponent(initialManifest.databaseFilename)
            var opened: OpaquePointer?
            guard sqlite3_open_v2(databaseURL.path, &opened, SQLITE_OPEN_CREATE | SQLITE_OPEN_READWRITE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK,
                  let opened else { throw WriterError.database("Could not create watch-telemetry.sqlite") }
            database = opened
            folderURL = folder
            manifest = initialManifest
            lock.withLock { pendingWrites = 0; failed = false }

            do {
                try execute("PRAGMA journal_mode=WAL")
                try execute("PRAGMA synchronous=NORMAL")
                try execute("PRAGMA temp_store=MEMORY")
                try execute("PRAGMA wal_autocheckpoint=0")
                try createSchema()
                try prepareStatements()
                try execute("BEGIN IMMEDIATE")
                rowsSinceCommit = 0
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
    func appendMotion(_ sample: WatchMotionSample, wallTime: Date, elapsed: TimeInterval) -> Bool {
        enqueue { [weak self] in try self?.insertMotion(sample, wallTime: wallTime, elapsed: elapsed) }
    }

    @discardableResult
    func appendLocation(_ sample: WatchLocationSample, wallTime: Date, elapsed: TimeInterval) -> Bool {
        enqueue { [weak self] in try self?.insertLocation(sample, wallTime: wallTime, elapsed: elapsed) }
    }

    @discardableResult
    func appendAltimeter(relativeAltitude: Double, pressure: Double, wallTime: Date, elapsed: TimeInterval) -> Bool {
        enqueue { [weak self] in try self?.insertAltimeter(relativeAltitude: relativeAltitude, pressure: pressure, wallTime: wallTime, elapsed: elapsed) }
    }

    @discardableResult
    func appendHealth(kind: String, value: Double, unit: String, wallTime: Date, elapsed: TimeInterval) -> Bool {
        enqueue { [weak self] in try self?.insertHealth(kind: kind, value: value, unit: unit, wallTime: wallTime, elapsed: elapsed) }
    }

    @discardableResult
    func appendDevice(batteryLevel: Double?, batteryState: String, wallTime: Date, elapsed: TimeInterval) -> Bool {
        enqueue { [weak self] in try self?.insertDevice(batteryLevel: batteryLevel, batteryState: batteryState, wallTime: wallTime, elapsed: elapsed) }
    }

    func stop(at date: Date, failureMessage: String? = nil) -> WatchRecordingSession? {
        queue.sync {
            guard database != nil, let folderURL else { return nil }
            do {
                try execute("COMMIT")
                sqlite3_wal_checkpoint_v2(database, nil, SQLITE_CHECKPOINT_TRUNCATE, nil, nil)
                manifest?.endedAt = date
                manifest?.status = failureMessage == nil ? .completed : .failed
                manifest?.failureMessage = failureMessage
                try writeManifest()
            } catch {
                report(error)
            }
            closeDatabase()
            removeSidecars()
            guard let manifest else { return nil }
            return WatchRecordingSession(manifest: manifest, folderURL: folderURL)
        }
    }

    private func enqueue(_ work: @escaping () throws -> Void) -> Bool {
        let accepted = lock.withLock { () -> Bool in
            guard !failed, pendingWrites < Self.maximumPendingWrites else { return false }
            pendingWrites += 1
            return true
        }
        guard accepted else {
            if !lock.withLock({ failed }) { report(WriterError.queueFull) }
            return false
        }
        queue.async { [weak self] in
            guard let self else { return }
            defer { self.lock.withLock { self.pendingWrites -= 1 } }
            guard !self.lock.withLock({ self.failed }) else { return }
            do {
                try work()
                self.rowsSinceCommit += 1
                if self.rowsSinceCommit >= 250 || Date().timeIntervalSince(self.lastCommit) >= 5 {
                    try self.execute("COMMIT")
                    try self.writeManifest()
                    try self.execute("BEGIN IMMEDIATE")
                    self.rowsSinceCommit = 0
                    self.lastCommit = Date()
                }
            } catch { self.report(error) }
        }
        return true
    }

    private func createSchema() throws {
        try execute("""
        CREATE TABLE watch_motion (
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
        CREATE TABLE watch_location (
          id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, source_time REAL NOT NULL,
          latitude REAL NOT NULL, longitude REAL NOT NULL, altitude REAL, horizontal_accuracy REAL NOT NULL,
          vertical_accuracy REAL, speed REAL, speed_accuracy REAL, course REAL, course_accuracy REAL
        )
        """)
        try execute("CREATE TABLE watch_altimeter (id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, relative_altitude REAL NOT NULL, pressure_kpa REAL NOT NULL)")
        try execute("CREATE TABLE watch_health (id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, kind TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL)")
        try execute("CREATE TABLE watch_device (id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, battery_level REAL, battery_state TEXT NOT NULL)")
        try execute("CREATE INDEX watch_motion_elapsed_idx ON watch_motion(elapsed)")
        try execute("CREATE INDEX watch_location_elapsed_idx ON watch_location(elapsed)")
        try execute("CREATE INDEX watch_health_elapsed_idx ON watch_health(elapsed)")
    }

    private func prepareStatements() throws {
        motionStatement = try prepare("INSERT INTO watch_motion VALUES (NULL,\(Array(repeating: "?", count: 32).joined(separator: ",")))")
        locationStatement = try prepare("INSERT INTO watch_location VALUES (NULL,\(Array(repeating: "?", count: 12).joined(separator: ",")))")
        altimeterStatement = try prepare("INSERT INTO watch_altimeter VALUES (NULL,?,?,?,?)")
        healthStatement = try prepare("INSERT INTO watch_health VALUES (NULL,?,?,?,?,?)")
        deviceStatement = try prepare("INSERT INTO watch_device VALUES (NULL,?,?,?,?)")
    }

    private func insertMotion(_ value: WatchMotionSample, wallTime: Date, elapsed: TimeInterval) throws {
        guard let statement = motionStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        bind(wallTime.timeIntervalSince1970, statement, &index); bind(elapsed, statement, &index); bind(value.sensorUptime, statement, &index)
        bind(value.rawAcceleration, statement, &index); bind(value.rawRotation, statement, &index); bind(value.rawMagneticField, statement, &index)
        bind(value.userAcceleration, statement, &index); bind(value.gravity, statement, &index); bind(value.rotationRate, statement, &index)
        bind(value.calibratedMagneticField, statement, &index); sqlite3_bind_int(statement, index, Int32(value.magneticAccuracy)); index += 1
        for number in [value.roll, value.pitch, value.yaw, value.quaternion.x, value.quaternion.y, value.quaternion.z, value.quaternion.w] {
            bind(number, statement, &index)
        }
        try finish(statement)
        manifest?.motionSampleCount += 1
    }

    private func insertLocation(_ value: WatchLocationSample, wallTime: Date, elapsed: TimeInterval) throws {
        guard let statement = locationStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        for number in [wallTime.timeIntervalSince1970, elapsed, value.sourceTime.timeIntervalSince1970, value.latitude, value.longitude] { bind(number, statement, &index) }
        for number in [value.altitude, Optional(value.horizontalAccuracy), value.verticalAccuracy, value.speed, value.speedAccuracy, value.course, value.courseAccuracy] { bind(number, statement, &index) }
        try finish(statement)
        manifest?.locationSampleCount += 1
    }

    private func insertAltimeter(relativeAltitude: Double, pressure: Double, wallTime: Date, elapsed: TimeInterval) throws {
        guard let statement = altimeterStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        for value in [wallTime.timeIntervalSince1970, elapsed, relativeAltitude, pressure] { bind(value, statement, &index) }
        try finish(statement); manifest?.altimeterSampleCount += 1
    }

    private func insertHealth(kind: String, value: Double, unit: String, wallTime: Date, elapsed: TimeInterval) throws {
        guard let statement = healthStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        bind(wallTime.timeIntervalSince1970, statement, &index); bind(elapsed, statement, &index)
        bind(kind, statement, &index); bind(value, statement, &index); bind(unit, statement, &index)
        try finish(statement); manifest?.healthSampleCount += 1
    }

    private func insertDevice(batteryLevel: Double?, batteryState: String, wallTime: Date, elapsed: TimeInterval) throws {
        guard let statement = deviceStatement else { throw WriterError.notStarted }
        var index: Int32 = 1
        bind(wallTime.timeIntervalSince1970, statement, &index); bind(elapsed, statement, &index)
        bind(batteryLevel, statement, &index); bind(batteryState, statement, &index)
        try finish(statement); manifest?.deviceSampleCount += 1
    }

    private func prepare(_ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw lastError() }
        return statement
    }

    private func execute(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw lastError() }
    }

    private func finish(_ statement: OpaquePointer) throws {
        defer { sqlite3_reset(statement); sqlite3_clear_bindings(statement) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw lastError() }
    }

    private func bind(_ value: SIMD3<Double>?, _ statement: OpaquePointer, _ index: inout Int32) {
        bind(value?.x, statement, &index); bind(value?.y, statement, &index); bind(value?.z, statement, &index)
    }

    private func bind(_ value: Double, _ statement: OpaquePointer, _ index: inout Int32) {
        sqlite3_bind_double(statement, index, value); index += 1
    }

    private func bind(_ value: Double?, _ statement: OpaquePointer, _ index: inout Int32) {
        if let value { sqlite3_bind_double(statement, index, value) } else { sqlite3_bind_null(statement, index) }
        index += 1
    }

    private func bind(_ value: String, _ statement: OpaquePointer, _ index: inout Int32) {
        _ = value.withCString { sqlite3_bind_text(statement, index, $0, -1, Self.sqliteTransient) }
        index += 1
    }

    private func writeManifest() throws {
        guard let manifest, let folderURL else { throw WriterError.notStarted }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(manifest).write(to: folderURL.appendingPathComponent("watch-manifest.json"), options: .atomic)
    }

    private func report(_ error: Error) {
        let shouldReport = lock.withLock { () -> Bool in
            guard !failed else { return false }
            failed = true
            return true
        }
        if shouldReport { DispatchQueue.main.async { [weak self] in self?.onError?(error) } }
    }

    private func lastError() -> Error {
        WriterError.database(database.map { String(cString: sqlite3_errmsg($0)) } ?? "Unknown SQLite error")
    }

    private func closeDatabase() {
        for statement in [motionStatement, locationStatement, altimeterStatement, healthStatement, deviceStatement] {
            if let statement { sqlite3_finalize(statement) }
        }
        motionStatement = nil; locationStatement = nil; altimeterStatement = nil; healthStatement = nil; deviceStatement = nil
        if let database { sqlite3_close_v2(database) }
        database = nil
    }

    private func removeSidecars() {
        guard let folderURL else { return }
        let base = folderURL.appendingPathComponent("watch-telemetry.sqlite").path
        for suffix in ["-wal", "-shm"] {
            let url = URL(fileURLWithPath: base + suffix)
            if FileManager.default.fileExists(atPath: url.path) { try? FileManager.default.removeItem(at: url) }
        }
    }

    private func sessionsDirectory() throws -> URL {
        if let rootDirectory {
            try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
            return rootDirectory
        }
        let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let root = documents.appendingPathComponent("RemusWatchSessions", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }
}

private extension NSLock {
    func withLock<T>(_ body: () -> T) -> T {
        lock(); defer { unlock() }
        return body()
    }
}
