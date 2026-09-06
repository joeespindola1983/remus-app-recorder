package com.remus.telemetry

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteStatement
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors

class AndroidSessionDatabaseWriter(private val context: Context) {
    private val executor = Executors.newSingleThreadExecutor()
    private var db: SQLiteDatabase? = null
    private var sessionFolder: File? = null
    private var manifest: JSONObject? = null
    private var motionStmt: SQLiteStatement? = null
    private var locationStmt: SQLiteStatement? = null
    private var motionSampleCount = 0

    fun start(sessionId: String, placement: String, notes: String, frequencyHz: Double): File {
        val root = File(context.filesDir, "RemusSessions")
        if (!root.exists()) root.mkdirs()

        val sdf = SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US)
        val startedAtStr = sdf.format(Date())
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

        database.beginTransactionNonExclusive()

        val json = JSONObject()
        json.put("id", sessionId)
        json.put("startedAt", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date()))
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

    fun stop(): JSONObject {
        db?.let {
            if (it.inTransaction()) {
                it.setTransactionSuccessful()
                it.endTransaction()
            }
            it.close()
        }
        db = null

        manifest?.put("endedAt", SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).format(Date()))
        manifest?.put("status", "completed")
        manifest?.put("motionSampleCount", motionSampleCount)
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
