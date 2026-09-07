package com.remus.telemetry

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteStatement
import android.location.Location
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.*
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class AndroidSessionDatabaseWriter(private val context: Context) {

    private sealed class TelemetryRecord {
        data class Motion(
            val wallTime: Double,
            val elapsed: Double,
            val sensorUptime: Double,
            val rawAx: Double,
            val rawAy: Double,
            val rawAz: Double,
            val rawGx: Double,
            val rawGy: Double,
            val rawGz: Double,
            val rawMx: Double,
            val rawMy: Double,
            val rawMz: Double,
            val userAx: Double,
            val userAy: Double,
            val userAz: Double,
            val gravityX: Double,
            val gravityY: Double,
            val gravityZ: Double,
            val rotX: Double,
            val rotY: Double,
            val rotZ: Double,
            val magX: Double,
            val magY: Double,
            val magZ: Double,
            val magAccuracy: Int,
            val rollRad: Double,
            val pitchRad: Double,
            val yawRad: Double,
            val qx: Double,
            val qy: Double,
            val qz: Double,
            val qw: Double,
            // Age is relative to sensor_uptime. -1 means that channel was unavailable.
            val linearAccelerationAgeUs: Long,
            val gravityAgeUs: Long,
            val gyroscopeAgeUs: Long,
            val magnetometerAgeUs: Long,
            val attitudeAgeUs: Long
        ) : TelemetryRecord()

        data class LocationRecord(
            val wallTime: Double,
            val elapsed: Double,
            val sourceTime: Double,
            val latitude: Double,
            val longitude: Double,
            val altitude: Double?,
            val horizontalAccuracy: Double,
            val verticalAccuracy: Double?,
            val speed: Double?,
            val speedAccuracy: Double?,
            val course: Double?,
            val courseAccuracy: Double?,
            val simulated: Boolean
        ) : TelemetryRecord()

        data class WeatherRecord(
            val wallTime: Double, val elapsed: Double, val latitude: Double, val longitude: Double,
            val sourceTime: String, val temperature: Double?, val apparentTemperature: Double?,
            val humidity: Double?, val precipitation: Double?, val surfacePressure: Double?,
            val windSpeed: Double?, val windDirection: Double?, val windGust: Double?,
            val weatherCode: Int?
        ) : TelemetryRecord()
    }

    private val queue = LinkedBlockingQueue<TelemetryRecord>(10000)
    @Volatile private var isRunning = false
    private var writerThread: Thread? = null

    private var db: SQLiteDatabase? = null
    private var sessionFolder: File? = null
    private var manifest: JSONObject? = null
    private var motionStmt: SQLiteStatement? = null
    private var locationStmt: SQLiteStatement? = null
    private var weatherStmt: SQLiteStatement? = null

    private val _committedMotionCount = AtomicInteger(0)
    private val _committedLocationCount = AtomicInteger(0)
    private val _committedWeatherCount = AtomicInteger(0)
    private val _droppedSampleCount = AtomicInteger(0)
    private val _errorCount = AtomicInteger(0)

    val motionSampleCount: Int
        get() = _committedMotionCount.get()

    val locationSampleCount: Int
        get() = _committedLocationCount.get()
    val weatherSampleCount: Int
        get() = _committedWeatherCount.get()

    val droppedSampleCount: Int
        get() = _droppedSampleCount.get()

    val errorCount: Int
        get() = _errorCount.get()

    private var startTimeMillis: Long = 0
    private var startInstant: Instant? = null

    fun start(sessionId: String, placement: String, notes: String, frequencyHz: Double): File {
        val root = File(context.filesDir, "RemusSessions")
        if (!root.exists()) root.mkdirs()

        startTimeMillis = System.currentTimeMillis()
        startInstant = Instant.now()
        val startedAtStr = DateTimeFormatter.ISO_INSTANT.format(startInstant)
        val fileSafeDate = startedAtStr.replace(":", "-").replace(".", "_")
        val folder = File(root, "session-${fileSafeDate}-${sessionId.take(8)}")
        folder.mkdirs()
        sessionFolder = folder

        val dbFile = File(folder, "telemetry.sqlite")
        val database = SQLiteDatabase.openOrCreateDatabase(dbFile, null)
        db = database

        database.enableWriteAheadLogging()
        database.rawQuery("PRAGMA synchronous=NORMAL", null)?.close()
        database.rawQuery("PRAGMA temp_store=MEMORY", null)?.close()

        database.execSQL("""
            CREATE TABLE IF NOT EXISTS motion (
              id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, sensor_uptime REAL NOT NULL,
              raw_ax REAL, raw_ay REAL, raw_az REAL, raw_gx REAL, raw_gy REAL, raw_gz REAL,
              raw_mx REAL, raw_my REAL, raw_mz REAL, user_ax REAL NOT NULL, user_ay REAL NOT NULL, user_az REAL NOT NULL,
              gravity_x REAL NOT NULL, gravity_y REAL NOT NULL, gravity_z REAL NOT NULL,
              rotation_x REAL NOT NULL, rotation_y REAL NOT NULL, rotation_z REAL NOT NULL,
              magnetic_x REAL NOT NULL, magnetic_y REAL NOT NULL, magnetic_z REAL NOT NULL, magnetic_accuracy INTEGER NOT NULL,
              roll REAL NOT NULL, pitch REAL NOT NULL, yaw REAL NOT NULL, qx REAL NOT NULL, qy REAL NOT NULL, qz REAL NOT NULL, qw REAL NOT NULL,
              linear_acceleration_age_us INTEGER NOT NULL, gravity_age_us INTEGER NOT NULL, gyroscope_age_us INTEGER NOT NULL,
              magnetometer_age_us INTEGER NOT NULL, attitude_age_us INTEGER NOT NULL
            )
        """.trimIndent())

        database.execSQL("""
            CREATE TABLE IF NOT EXISTS location (
              id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, source_time REAL NOT NULL,
              latitude REAL NOT NULL, longitude REAL NOT NULL, altitude REAL, ellipsoidal_altitude REAL,
              horizontal_accuracy REAL NOT NULL, vertical_accuracy REAL, speed REAL, speed_accuracy REAL,
              course REAL, course_accuracy REAL, simulated INTEGER, produced_by_accessory INTEGER
            )
        """.trimIndent())

        database.execSQL("CREATE INDEX IF NOT EXISTS motion_elapsed_idx ON motion(elapsed)")
        database.execSQL("CREATE INDEX IF NOT EXISTS location_elapsed_idx ON location(elapsed)")
        database.execSQL("""
            CREATE TABLE IF NOT EXISTS weather (
              id INTEGER PRIMARY KEY, wall_time REAL NOT NULL, elapsed REAL NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL,
              source_time TEXT NOT NULL, temperature REAL, apparent_temperature REAL, humidity REAL, precipitation REAL,
              surface_pressure REAL, wind_speed REAL, wind_direction REAL, wind_gust REAL, weather_code INTEGER, provider TEXT NOT NULL
            )
        """.trimIndent())

        motionStmt = database.compileStatement("INSERT INTO motion VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        locationStmt = database.compileStatement("INSERT INTO location VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        weatherStmt = database.compileStatement("INSERT INTO weather VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")

        _committedMotionCount.set(0)
        _committedLocationCount.set(0)
        _committedWeatherCount.set(0)
        _droppedSampleCount.set(0)
        _errorCount.set(0)
        queue.clear()
        isRunning = true

        writerThread = Thread({ processQueue() }, "RemusDbWriter").apply {
            priority = Thread.NORM_PRIORITY + 1
            start()
        }

        val json = JSONObject()
        json.put("schemaVersion", "1.0.0")
        json.put("producer", "remus-app-recorder")
        json.put("producerPlatform", "android")
        json.put("orientationUnits", "radians")
        json.put("id", sessionId)
        json.put("startedAt", startedAtStr)
        val appVersionName = try {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
        json.put("appVersion", appVersionName)
        json.put("deviceModel", android.os.Build.MODEL)
        json.put("systemVersion", "Android ${android.os.Build.VERSION.RELEASE}")
        json.put("motionFrequencyHertz", frequencyHz)
        json.put("captureProfile", "android-accelerometer-clocked-v1")
        json.put("motionSamplingPolicy", "accelerometer_clocked_snapshot")
        json.put("motionChannelAgeUnits", "microseconds; -1 means unavailable")
        json.put("placement", placement)
        json.put("notes", notes)
        json.put("motionSampleCount", 0)
        json.put("locationSampleCount", 0)
        json.put("weatherSampleCount", 0)
        json.put("droppedSampleCount", 0)
        json.put("errorCount", 0)
        json.put("status", "recording")
        json.put("databaseFilename", "telemetry.sqlite")
        manifest = json

        writeManifest()
        return folder
    }

    private fun processQueue() {
        val batch = ArrayList<TelemetryRecord>(128)
        while (isRunning || queue.isNotEmpty()) {
            try {
                val first = queue.poll(50, TimeUnit.MILLISECONDS) ?: continue
                batch.add(first)
                queue.drainTo(batch, 127)

                val database = db
                if (database == null || !database.isOpen) {
                    batch.clear()
                    continue
                }

                var batchMotionCount = 0
                var batchLocationCount = 0
                var batchWeatherCount = 0

                database.beginTransactionNonExclusive()
                try {
                    for (record in batch) {
                        when (record) {
                            is TelemetryRecord.Motion -> {
                                val stmt = motionStmt ?: continue
                                stmt.clearBindings()
                                stmt.bindDouble(1, record.wallTime)
                                stmt.bindDouble(2, record.elapsed)
                                stmt.bindDouble(3, record.sensorUptime)
                                stmt.bindDouble(4, record.rawAx)
                                stmt.bindDouble(5, record.rawAy)
                                stmt.bindDouble(6, record.rawAz)
                                stmt.bindDouble(7, record.rawGx)
                                stmt.bindDouble(8, record.rawGy)
                                stmt.bindDouble(9, record.rawGz)
                                stmt.bindDouble(10, record.rawMx)
                                stmt.bindDouble(11, record.rawMy)
                                stmt.bindDouble(12, record.rawMz)
                                stmt.bindDouble(13, record.userAx)
                                stmt.bindDouble(14, record.userAy)
                                stmt.bindDouble(15, record.userAz)
                                stmt.bindDouble(16, record.gravityX)
                                stmt.bindDouble(17, record.gravityY)
                                stmt.bindDouble(18, record.gravityZ)
                                stmt.bindDouble(19, record.rotX)
                                stmt.bindDouble(20, record.rotY)
                                stmt.bindDouble(21, record.rotZ)
                                stmt.bindDouble(22, record.magX)
                                stmt.bindDouble(23, record.magY)
                                stmt.bindDouble(24, record.magZ)
                                stmt.bindLong(25, record.magAccuracy.toLong())
                                stmt.bindDouble(26, record.rollRad)
                                stmt.bindDouble(27, record.pitchRad)
                                stmt.bindDouble(28, record.yawRad)
                                stmt.bindDouble(29, record.qx)
                                stmt.bindDouble(30, record.qy)
                                stmt.bindDouble(31, record.qz)
                                stmt.bindDouble(32, record.qw)
                                stmt.bindLong(33, record.linearAccelerationAgeUs)
                                stmt.bindLong(34, record.gravityAgeUs)
                                stmt.bindLong(35, record.gyroscopeAgeUs)
                                stmt.bindLong(36, record.magnetometerAgeUs)
                                stmt.bindLong(37, record.attitudeAgeUs)
                                stmt.executeInsert()
                                batchMotionCount++
                            }
                            is TelemetryRecord.LocationRecord -> {
                                val stmt = locationStmt ?: continue
                                stmt.clearBindings()
                                stmt.bindDouble(1, record.wallTime)
                                stmt.bindDouble(2, record.elapsed)
                                stmt.bindDouble(3, record.sourceTime)
                                stmt.bindDouble(4, record.latitude)
                                stmt.bindDouble(5, record.longitude)
                                if (record.altitude != null) stmt.bindDouble(6, record.altitude) else stmt.bindNull(6)
                                stmt.bindNull(7)
                                stmt.bindDouble(8, record.horizontalAccuracy)
                                if (record.verticalAccuracy != null) stmt.bindDouble(9, record.verticalAccuracy) else stmt.bindNull(9)
                                if (record.speed != null) stmt.bindDouble(10, record.speed) else stmt.bindNull(10)
                                if (record.speedAccuracy != null) stmt.bindDouble(11, record.speedAccuracy) else stmt.bindNull(11)
                                if (record.course != null) stmt.bindDouble(12, record.course) else stmt.bindNull(12)
                                if (record.courseAccuracy != null) stmt.bindDouble(13, record.courseAccuracy) else stmt.bindNull(13)
                                stmt.bindLong(14, if (record.simulated) 1 else 0)
                                stmt.bindLong(15, 0)
                                stmt.executeInsert()
                                batchLocationCount++
                            }
                            is TelemetryRecord.WeatherRecord -> {
                                val stmt = weatherStmt ?: continue
                                stmt.clearBindings()
                                stmt.bindDouble(1, record.wallTime); stmt.bindDouble(2, record.elapsed)
                                stmt.bindDouble(3, record.latitude); stmt.bindDouble(4, record.longitude)
                                stmt.bindString(5, record.sourceTime)
                                val values = listOf(record.temperature, record.apparentTemperature, record.humidity, record.precipitation, record.surfacePressure, record.windSpeed, record.windDirection, record.windGust)
                                values.forEachIndexed { index, value -> if (value != null) stmt.bindDouble(index + 6, value) else stmt.bindNull(index + 6) }
                                if (record.weatherCode != null) stmt.bindLong(14, record.weatherCode.toLong()) else stmt.bindNull(14)
                                stmt.bindString(15, "Open-Meteo")
                                stmt.executeInsert(); batchWeatherCount++
                            }
                        }
                    }
                    database.setTransactionSuccessful()
                    _committedMotionCount.addAndGet(batchMotionCount)
                    _committedLocationCount.addAndGet(batchLocationCount)
                    _committedWeatherCount.addAndGet(batchWeatherCount)
                } catch (e: Exception) {
                    _errorCount.incrementAndGet()
                    Log.e("RemusTelemetry", "Error executing batch insert: ${e.message}")
                } finally {
                    try {
                        database.endTransaction()
                    } catch (_: Exception) {}
                }
                batch.clear()
            } catch (e: Exception) {
                _errorCount.incrementAndGet()
                Log.e("RemusTelemetry", "Error in db writer loop: ${e.message}")
            }
        }
    }

    fun recordMotion(
        wallTime: Double,
        elapsed: Double,
        sensorUptime: Double,
        rawAx: Double, rawAy: Double, rawAz: Double,
        rawGx: Double, rawGy: Double, rawGz: Double,
        rawMx: Double, rawMy: Double, rawMz: Double,
        userAx: Double, userAy: Double, userAz: Double,
        gravityX: Double, gravityY: Double, gravityZ: Double,
        rotX: Double, rotY: Double, rotZ: Double,
        magX: Double, magY: Double, magZ: Double,
        magAccuracy: Int,
        rollRad: Double, pitchRad: Double, yawRad: Double,
        qx: Double, qy: Double, qz: Double, qw: Double,
        linearAccelerationAgeUs: Long, gravityAgeUs: Long, gyroscopeAgeUs: Long,
        magnetometerAgeUs: Long, attitudeAgeUs: Long
    ) {
        if (!isRunning) return
        val record = TelemetryRecord.Motion(
            wallTime, elapsed, sensorUptime,
            rawAx, rawAy, rawAz,
            rawGx, rawGy, rawGz,
            rawMx, rawMy, rawMz,
            userAx, userAy, userAz,
            gravityX, gravityY, gravityZ,
            rotX, rotY, rotZ,
            magX, magY, magZ,
            magAccuracy,
            rollRad, pitchRad, yawRad,
            qx, qy, qz, qw,
            linearAccelerationAgeUs, gravityAgeUs, gyroscopeAgeUs,
            magnetometerAgeUs, attitudeAgeUs
        )
        if (!queue.offer(record)) {
            _droppedSampleCount.incrementAndGet()
            Log.w("RemusTelemetry", "Queue full, dropping motion sample")
        }
    }

    /**
     * `course` is calculated by the capture module after applying its quality
     * rules.  Android's Location.bearing may be present as 0 while stationary,
     * which is not a meaningful course measurement.
     */
    fun recordLocation(location: Location, elapsed: Double, course: Double?) {
        if (!isRunning) return
        val record = TelemetryRecord.LocationRecord(
            wallTime = System.currentTimeMillis() / 1000.0,
            elapsed = elapsed,
            sourceTime = location.time / 1000.0,
            latitude = location.latitude,
            longitude = location.longitude,
            altitude = if (location.hasAltitude()) location.altitude else null,
            horizontalAccuracy = location.accuracy.toDouble(),
            verticalAccuracy = if (location.hasVerticalAccuracy()) location.verticalAccuracyMeters.toDouble() else null,
            speed = if (location.hasSpeed()) location.speed.toDouble() else null,
            speedAccuracy = if (location.hasSpeedAccuracy()) location.speedAccuracyMetersPerSecond.toDouble() else null,
            course = course,
            courseAccuracy = if (course != null && location.hasBearingAccuracy()) location.bearingAccuracyDegrees.toDouble() else null,
            simulated = location.isFromMockProvider
        )
        if (!queue.offer(record)) {
            _droppedSampleCount.incrementAndGet()
            Log.w("RemusTelemetry", "Queue full, dropping location sample")
        }
    }

    fun recordWeather(latitude: Double, longitude: Double, elapsed: Double, sourceTime: String,
                      temperature: Double?, apparentTemperature: Double?, humidity: Double?, precipitation: Double?,
                      surfacePressure: Double?, windSpeed: Double?, windDirection: Double?, windGust: Double?, weatherCode: Int?) {
        if (!isRunning) return
        queue.offer(TelemetryRecord.WeatherRecord(System.currentTimeMillis() / 1000.0, elapsed, latitude, longitude, sourceTime, temperature, apparentTemperature, humidity, precipitation, surfacePressure, windSpeed, windDirection, windGust, weatherCode))
    }

    fun stop(): JSONObject {
        isRunning = false
        var cleanShutdown = false
        try {
            writerThread?.join(5000)
            cleanShutdown = true
        } catch (_: Exception) {}
        writerThread = null

        try {
            motionStmt?.close()
            locationStmt?.close()
            weatherStmt?.close()
        } catch (_: Exception) {}
        motionStmt = null
        locationStmt = null
        weatherStmt = null

        db?.let {
            try {
                it.rawQuery("PRAGMA wal_checkpoint(FULL)", null)?.close()
            } catch (_: Exception) {}
            it.close()
        }
        db = null

        val endedAtStr = DateTimeFormatter.ISO_INSTANT.format(Instant.now())
        manifest?.put("endedAt", endedAtStr)
        manifest?.put("motionSampleCount", motionSampleCount)
        manifest?.put("locationSampleCount", locationSampleCount)
        manifest?.put("weatherSampleCount", weatherSampleCount)
        manifest?.put("droppedSampleCount", droppedSampleCount)
        manifest?.put("errorCount", errorCount)

        val finalStatus = if (!cleanShutdown || errorCount > 0) "interrupted" else "completed"
        manifest?.put("status", finalStatus)
        writeManifest()

        return manifest ?: JSONObject()
    }

    private fun writeManifest() {
        sessionFolder?.let { folder ->
            val manifestFile = File(folder, "manifest.json")
            manifestFile.writeText(manifest?.toString(2) ?: "{}")
        }
    }
}
