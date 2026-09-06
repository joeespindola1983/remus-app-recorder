package com.remus.telemetry

import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.SystemClock
import androidx.core.content.FileProvider
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.*
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class RemusTelemetryModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), SensorEventListener, LocationListener {

    private var writer: AndroidSessionDatabaseWriter? = null
    private var activeSessionId: String? = null

    private var sensorManager: SensorManager? = null
    private var locationManager: LocationManager? = null

    private var accelerometer: Sensor? = null
    private var gyroscope: Sensor? = null
    private var rotationVector: Sensor? = null

    private var startTimeNanos: Long = 0
    private var startTimestampMillis: Long = 0

    // Latest sensor readings
    private var lastAx = 0.0
    private var lastAy = 0.0
    private var lastAz = 0.0
    private var lastGx = 0.0
    private var lastGy = 0.0
    private var lastGz = 0.0
    private var lastRotX = 0.0
    private var lastRotY = 0.0
    private var lastRotZ = 0.0
    private var lastRoll = 0.0
    private var lastPitch = 0.0
    private var lastYaw = 0.0
    private var lastQx = 0.0
    private var lastQy = 0.0
    private var lastQz = 0.0
    private var lastQw = 1.0

    // Running GPS / Metrics
    private var lastLocation: Location? = null
    private var totalDistanceMeters = 0.0
    private var currentSpeedKmh = 0.0
    private var lastEmitTimeMillis: Long = 0

    override fun getName(): String = "RemusTelemetryModule"

    private fun sendEvent(eventName: String, params: WritableMap) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        }
    }

    @ReactMethod
    fun startRecording(params: ReadableMap, promise: Promise) {
        try {
            val sessionId = UUID.randomUUID().toString()
            val placement = if (params.hasKey("placement")) params.getString("placement") ?: "hull" else "hull"
            val notes = if (params.hasKey("notes")) params.getString("notes") ?: "" else ""
            val freq = if (params.hasKey("motionFrequencyHertz")) params.getDouble("motionFrequencyHertz") else 100.0

            val activeWriter = AndroidSessionDatabaseWriter(reactContext)
            val folder = activeWriter.start(sessionId, placement, notes, freq)

            writer = activeWriter
            activeSessionId = sessionId
            startTimeNanos = SystemClock.elapsedRealtimeNanos()
            startTimestampMillis = System.currentTimeMillis()
            totalDistanceMeters = 0.0
            currentSpeedKmh = 0.0
            lastLocation = null

            // Initialize sensors on UI thread
            reactContext.runOnUiQueueThread {
                val sm = reactContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
                sensorManager = sm
                if (sm != null) {
                    accelerometer = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
                    gyroscope = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
                    rotationVector = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

                    val delayUs = (1_000_000.0 / freq).toInt()
                    accelerometer?.let { sm.registerListener(this, it, delayUs) }
                    gyroscope?.let { sm.registerListener(this, it, delayUs) }
                    rotationVector?.let { sm.registerListener(this, it, delayUs) }
                }

                val lm = reactContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
                locationManager = lm
                if (lm != null) {
                    try {
                        if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this)
                        }
                        if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                            lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 1000L, 0f, this)
                        }
                    } catch (_: SecurityException) {
                    }
                }
            }

            val result = Arguments.createMap()
            result.putString("sessionId", sessionId)
            result.putString("folderUri", folder.absolutePath)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("START_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopRecording(promise: Promise) {
        val activeWriter = writer
        if (activeWriter == null) {
            promise.reject("NOT_RECORDING", "No recording in progress")
            return
        }

        try {
            reactContext.runOnUiQueueThread {
                sensorManager?.unregisterListener(this)
                sensorManager = null
                locationManager?.removeUpdates(this)
                locationManager = null
            }

            val manifestJson = activeWriter.stop()
            writer = null
            activeSessionId = null

            val map = Arguments.createMap()
            map.putString("id", manifestJson.optString("id"))
            map.putString("startedAt", manifestJson.optString("startedAt"))
            map.putString("endedAt", manifestJson.optString("endedAt"))
            map.putInt("motionSampleCount", manifestJson.optInt("motionSampleCount"))
            map.putString("status", manifestJson.optString("status"))
            map.putString("placement", manifestJson.optString("placement"))
            promise.resolve(map)
        } catch (e: Exception) {
            promise.reject("STOP_ERROR", e.message, e)
        }
    }

    // SensorEventListener
    override fun onSensorChanged(event: SensorEvent) {
        val w = writer ?: return
        val nowNanos = SystemClock.elapsedRealtimeNanos()
        val elapsed = (nowNanos - startTimeNanos) / 1_000_000_000.0
        val wallTime = System.currentTimeMillis() / 1000.0
        val sensorUptime = event.timestamp / 1_000_000_000.0

        when (event.sensor.type) {
            Sensor.TYPE_ACCELEROMETER -> {
                lastAx = event.values[0] / 9.80665
                lastAy = event.values[1] / 9.80665
                lastAz = event.values[2] / 9.80665
            }
            Sensor.TYPE_GYROSCOPE -> {
                lastRotX = event.values[0].toDouble()
                lastRotY = event.values[1].toDouble()
                lastRotZ = event.values[2].toDouble()
            }
            Sensor.TYPE_ROTATION_VECTOR -> {
                val rotationMatrix = FloatArray(9)
                val orientationValues = FloatArray(3)
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                SensorManager.getOrientation(rotationMatrix, orientationValues)

                lastYaw = Math.toDegrees(orientationValues[0].toDouble())
                lastPitch = Math.toDegrees(orientationValues[1].toDouble())
                lastRoll = Math.toDegrees(orientationValues[2].toDouble())

                val quat = FloatArray(4)
                SensorManager.getQuaternionFromVector(quat, event.values)
                lastQw = quat[0].toDouble()
                lastQx = quat[1].toDouble()
                lastQy = quat[2].toDouble()
                lastQz = quat[3].toDouble()
            }
        }

        w.recordMotion(
            wallTime, elapsed, sensorUptime,
            lastAx, lastAy, lastAz,
            lastGx, lastGy, lastGz,
            lastRotX, lastRotY, lastRotZ,
            lastRoll, lastPitch, lastYaw,
            lastQx, lastQy, lastQz, lastQw
        )

        val now = System.currentTimeMillis()
        if (now - lastEmitTimeMillis >= 100) {
            lastEmitTimeMillis = now
            val body = Arguments.createMap()
            body.putDouble("speedKmh", currentSpeedKmh)
            body.putDouble("distanceMeters", totalDistanceMeters)
            body.putDouble("courseDegrees", lastLocation?.bearing?.toDouble() ?: 0.0)
            val heading = if (lastYaw < 0) lastYaw + 360.0 else lastYaw
            body.putDouble("headingDegrees", heading)
            val accelG = Math.sqrt(lastAx * lastAx + lastAy * lastAy + lastAz * lastAz)
            body.putDouble("accelerationG", accelG)
            val rotRate = Math.sqrt(lastRotX * lastRotX + lastRotY * lastRotY + lastRotZ * lastRotZ)
            body.putDouble("rotationRateRad", rotRate)
            body.putInt("imuSamples", w.motionSampleCount)
            lastLocation?.let {
                body.putDouble("gpsAccuracyMeters", it.accuracy.toDouble())
                if (it.hasAltitude()) body.putDouble("altitudeMeters", it.altitude)
            }
            sendEvent("onTelemetryUpdate", body)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    // LocationListener
    override fun onLocationChanged(location: Location) {
        val w = writer ?: return
        val elapsed = (SystemClock.elapsedRealtimeNanos() - startTimeNanos) / 1_000_000_000.0

        lastLocation?.let { prev ->
            val dist = location.distanceTo(prev)
            if (dist > 0.5) {
                totalDistanceMeters += dist
            }
        }
        lastLocation = location

        if (location.hasSpeed()) {
            currentSpeedKmh = location.speed * 3.6
        }

        w.recordLocation(location, elapsed)

        val body = Arguments.createMap()
        body.putDouble("speedKmh", currentSpeedKmh)
        body.putDouble("distanceMeters", totalDistanceMeters)
        body.putDouble("courseDegrees", location.bearing.toDouble())
        body.putDouble("gpsAccuracyMeters", location.accuracy.toDouble())
        if (location.hasAltitude()) {
            body.putDouble("altitudeMeters", location.altitude)
        }
        body.putInt("imuSamples", w.motionSampleCount)
        sendEvent("onTelemetryUpdate", body)
    }

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    @ReactMethod
    fun listSessions(promise: Promise) {
        try {
            val root = File(reactContext.filesDir, "RemusSessions")
            val array = Arguments.createArray()
            if (root.exists()) {
                val folders = root.listFiles()?.filter { it.isDirectory }?.sortedByDescending { it.name }
                folders?.forEach { folder ->
                    val manifestFile = File(folder, "manifest.json")
                    if (manifestFile.exists()) {
                        val json = JSONObject(manifestFile.readText())
                        val item = Arguments.createMap()
                        item.putString("id", json.optString("id"))
                        item.putString("folderUri", folder.absolutePath)
                        item.putString("startedAt", json.optString("startedAt"))
                        item.putString("endedAt", json.optString("endedAt"))
                        item.putInt("sampleCount", json.optInt("motionSampleCount"))
                        item.putString("placement", json.optString("placement", "hull"))
                        item.putBoolean("hasWatchRecording", false)

                        var folderSize = 0L
                        folder.listFiles()?.forEach { folderSize += it.length() }
                        item.putDouble("sizeBytes", folderSize.toDouble())

                        val startedAtStr = json.optString("startedAt")
                        val endedAtStr = json.optString("endedAt")
                        var duration = 0.0
                        if (startedAtStr.isNotEmpty()) {
                            try {
                                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
                                val start = sdf.parse(startedAtStr)?.time ?: 0L
                                val end = if (endedAtStr.isNotEmpty()) sdf.parse(endedAtStr)?.time ?: start else start
                                duration = Math.max(0.0, (end - start) / 1000.0)
                            } catch (_: Exception) {}
                        }
                        item.putDouble("durationSeconds", duration)

                        array.pushMap(item)
                    }
                }
            }
            promise.resolve(array)
        } catch (e: Exception) {
            promise.reject("LIST_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun deleteSession(sessionId: String, promise: Promise) {
        try {
            val root = File(reactContext.filesDir, "RemusSessions")
            var deleted = false
            if (root.exists()) {
                root.listFiles()?.filter { it.name.contains(sessionId.take(8)) }?.forEach {
                    it.deleteRecursively()
                    deleted = true
                }
            }
            promise.resolve(deleted)
        } catch (e: Exception) {
            promise.reject("DELETE_ERROR", e.message, e)
        }
    }

    private fun createSessionZipFile(sessionId: String): File {
        val root = File(reactContext.filesDir, "RemusSessions")
        val sessionFolder = root.listFiles()?.firstOrNull { it.name.contains(sessionId.take(8)) }
            ?: throw IllegalStateException("Session folder not found for id $sessionId")

        val exportDir = File(reactContext.cacheDir, "exports")
        if (!exportDir.exists()) exportDir.mkdirs()

        val zipFile = File(exportDir, "remus-session-${sessionId.take(8)}.zip")
        if (zipFile.exists()) zipFile.delete()

        ZipOutputStream(FileOutputStream(zipFile)).use { zos ->
            sessionFolder.listFiles()?.forEach { file ->
                if (file.isFile && !file.name.endsWith("-journal")) {
                    val entry = ZipEntry(file.name)
                    zos.putNextEntry(entry)
                    FileInputStream(file).use { it.copyTo(zos) }
                    zos.closeEntry()
                }
            }
        }
        return zipFile
    }

    @ReactMethod
    fun exportSessionZip(sessionId: String, promise: Promise) {
        try {
            val zipFile = createSessionZipFile(sessionId)
            promise.resolve(zipFile.absolutePath)
        } catch (e: Exception) {
            promise.reject("EXPORT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun shareSession(sessionId: String, promise: Promise) {
        try {
            val zipFile = createSessionZipFile(sessionId)
            val contentUri = FileProvider.getUriForFile(
                reactContext,
                "${reactContext.packageName}.fileprovider",
                zipFile
            )

            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "application/zip"
                putExtra(Intent.EXTRA_STREAM, contentUri)
                putExtra(Intent.EXTRA_SUBJECT, "remus-session-${sessionId.take(8)}")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            val chooser = Intent.createChooser(intent, "Compartilhar Sessão Remus").apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }

            reactContext.startActivity(chooser)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SHARE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}
