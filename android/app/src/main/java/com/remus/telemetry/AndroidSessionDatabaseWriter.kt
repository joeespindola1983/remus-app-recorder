package com.remus.telemetry

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteStatement
import android.location.Location
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class AndroidSessionDatabaseWriter(private val context: Context) {
    private val executor = Executors.newSingleThreadExecutor()
    private var db: SQLiteDatabase? = null
    private var sessionFolder: File? = null
    private var manifest: JSONObject? = null
    private var motionStmt: SQLiteStatement? = null
    private var locationStmt: SQLiteStatement? = null

    var motionSampleCount = 0
        private set
    var locationSampleCount = 0
        private set

    private var startTimeMillis: Long = 0

    fun start(sessionId: String, placement: String, notes: String, frequencyHz: Double): File {
        val root = File(context.filesDir, "RemusSessions")
        if (!root.exists()) root.mkdirs()

        startTimeMillis = System.currentTimeMillis()
        val sdf = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US)
        val startedAtStr = sdf.format(Date(startTimeMillis))
        val folder = File(root, "session-${startedAtStr}-${sessionId.take(8)}")
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
              roll REAL NOT NULL, pitch REAL NOT NULL, yaw REAL NOT NULL, qx REAL NOT NULL, qy REAL NOT NULL, qz REAL NOT NULL, qw REAL NOT NULL
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

        motionStmt = database.compileStatement("INSERT INTO motion VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        locationStmt = database.compileStatement("INSERT INTO location VALUES (NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")

        val json = JSONObject()
        json.put("id", sessionId)
        json.put("startedAt", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date(startTimeMillis)))
        json.put("appVersion", "1.0.0")
        json.put("deviceModel", android.os.Build.MODEL)
        json.put("systemVersion", "Android ${android.os.Build.VERSION.RELEASE}")
        json.put("motionFrequencyHertz", frequencyHz)
        json.put("placement", placement)
        json.put("notes", notes)
        json.put("motionSampleCount", 0)
        json.put("locationSampleCount", 0)
        json.put("status", "recording")
        json.put("databaseFilename", "telemetry.sqlite")
        manifest = json

        writeManifest()
        return folder
    }

    fun recordMotion(
        wallTime: Double,
        elapsed: Double,
        sensorUptime: Double,
        userAx: Double, userAy: Double, userAz: Double,
        gx: Double, gy: Double, gz: Double,
        rotX: Double, rotY: Double, rotZ: Double,
        roll: Double, pitch: Double, yaw: Double,
        qx: Double, qy: Double, qz: Double, qw: Double
    ) {
        executor.execute {
            val stmt = motionStmt ?: return@execute
            synchronized(stmt) {
                try {
                    stmt.clearBindings()
                    stmt.bindDouble(1, wallTime)
                    stmt.bindDouble(2, elapsed)
                    stmt.bindDouble(3, sensorUptime)
                    stmt.bindDouble(4, userAx)
                    stmt.bindDouble(5, userAy)
                    stmt.bindDouble(6, userAz)
                    stmt.bindDouble(7, rotX)
                    stmt.bindDouble(8, rotY)
                    stmt.bindDouble(9, rotZ)
                    stmt.bindDouble(10, 0.0)
                    stmt.bindDouble(11, 0.0)
                    stmt.bindDouble(12, 0.0)
                    stmt.bindDouble(13, userAx)
                    stmt.bindDouble(14, userAy)
                    stmt.bindDouble(15, userAz)
                    stmt.bindDouble(16, gx)
                    stmt.bindDouble(17, gy)
                    stmt.bindDouble(18, gz)
                    stmt.bindDouble(19, rotX)
                    stmt.bindDouble(20, rotY)
                    stmt.bindDouble(21, rotZ)
                    stmt.bindDouble(22, 0.0)
                    stmt.bindDouble(23, 0.0)
                    stmt.bindDouble(24, 0.0)
                    stmt.bindLong(25, 3)
                    stmt.bindDouble(26, roll)
                    stmt.bindDouble(27, pitch)
                    stmt.bindDouble(28, yaw)
                    stmt.bindDouble(29, qx)
                    stmt.bindDouble(30, qy)
                    stmt.bindDouble(31, qz)
                    stmt.bindDouble(32, qw)
                    stmt.executeInsert()
                    motionSampleCount++
                } catch (e: Exception) {
                    Log.e("RemusTelemetry", "Failed to insert motion sample: ${e.message}")
                }
            }
        }
    }

    fun recordLocation(location: Location, elapsed: Double) {
        executor.execute {
            val stmt = locationStmt ?: return@execute
            synchronized(stmt) {
                try {
                    stmt.clearBindings()
                    stmt.bindDouble(1, System.currentTimeMillis() / 1000.0)
                    stmt.bindDouble(2, elapsed)
                    stmt.bindDouble(3, location.time / 1000.0)
                    stmt.bindDouble(4, location.latitude)
                    stmt.bindDouble(5, location.longitude)
                    if (location.hasAltitude()) stmt.bindDouble(6, location.altitude) else stmt.bindNull(6)
                    stmt.bindNull(7)
                    stmt.bindDouble(8, location.accuracy.toDouble())
                    if (location.hasVerticalAccuracy()) stmt.bindDouble(9, location.verticalAccuracyMeters.toDouble()) else stmt.bindNull(9)
                    if (location.hasSpeed()) stmt.bindDouble(10, location.speed.toDouble()) else stmt.bindNull(10)
                    if (location.hasSpeedAccuracy()) stmt.bindDouble(11, location.speedAccuracyMetersPerSecond.toDouble()) else stmt.bindNull(11)
                    if (location.hasBearing()) stmt.bindDouble(12, location.bearing.toDouble()) else stmt.bindNull(12)
                    if (location.hasBearingAccuracy()) stmt.bindDouble(13, location.bearingAccuracyDegrees.toDouble()) else stmt.bindNull(13)
                    stmt.bindLong(14, if (location.isFromMockProvider) 1 else 0)
                    stmt.bindLong(15, 0)
                    stmt.executeInsert()
                    locationSampleCount++
                } catch (e: Exception) {
                    Log.e("RemusTelemetry", "Failed to insert location sample: ${e.message}")
                }
            }
        }
    }

    fun stop(): JSONObject {
        try {
            executor.shutdown()
            executor.awaitTermination(2, TimeUnit.SECONDS)
        } catch (_: Exception) {}

        db?.let {
            try {
                it.rawQuery("PRAGMA wal_checkpoint(FULL)", null)?.close()
            } catch (_: Exception) {}
            it.close()
        }
        db = null

        manifest?.put("endedAt", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date()))
        manifest?.put("status", "completed")
        manifest?.put("motionSampleCount", motionSampleCount)
        manifest?.put("locationSampleCount", locationSampleCount)
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
