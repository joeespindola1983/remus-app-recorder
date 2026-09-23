package com.remus.telemetry

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.ParcelUuid
import android.os.SystemClock
import android.media.ToneGenerator
import android.media.AudioManager
import android.media.MediaPlayer
import android.util.Base64
import androidx.core.content.FileProvider
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.*
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class RemusTelemetryModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), SensorEventListener, LocationListener {

    private var writer: AndroidSessionDatabaseWriter? = null
    private var activeSessionId: String? = null
    private val remusServiceUuid = UUID.fromString("4fafc201-1fb5-459e-8fcc-c5c9c331914b")
    private val remusCharacteristicUuid = UUID.fromString("beb5483e-36e1-4688-b7f5-ea07361b26a8")
    private val clientConfigUuid = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    private val bluetoothManager by lazy {
        reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    }
    private val bluetoothAdapter: BluetoothAdapter?
        get() = bluetoothManager?.adapter
    private var remusGatt: BluetoothGatt? = null
    private var remusCharacteristic: BluetoothGattCharacteristic? = null
    private var remusScanning = false

    private fun hasBluetoothPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(reactContext, permission) == PackageManager.PERMISSION_GRANTED

    private fun canScanRemus(): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        hasBluetoothPermission(Manifest.permission.BLUETOOTH_SCAN) &&
            hasBluetoothPermission(Manifest.permission.BLUETOOTH_CONNECT)
    } else {
        hasBluetoothPermission(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    private val remusScanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            if (!canScanRemus()) return
            try {
                bluetoothAdapter?.bluetoothLeScanner?.stopScan(this)
                remusScanning = false
                sendRemusConnectionState("connecting", result.device.name ?: "REMUS")
                remusGatt?.close()
                remusGatt = result.device.connectGatt(reactContext, false, remusGattCallback)
            } catch (error: SecurityException) {
                sendRemusConnectionState("disconnected")
            }
        }

        override fun onScanFailed(errorCode: Int) {
            remusScanning = false
            sendRemusConnectionState("disconnected")
        }
    }

    private val remusGattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED) {
                if (!canScanRemus()) return
                try {
                    gatt.discoverServices()
                } catch (_: SecurityException) {
                    sendRemusConnectionState("disconnected")
                }
            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                remusCharacteristic = null
                if (remusGatt === gatt) remusGatt = null
                gatt.close()
                sendRemusConnectionState("disconnected")
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            val characteristic = gatt.getService(remusServiceUuid)
                ?.getCharacteristic(remusCharacteristicUuid) ?: run {
                sendRemusConnectionState("disconnected")
                return
            }
            remusCharacteristic = characteristic
            if (!canScanRemus()) return
            try {
                gatt.setCharacteristicNotification(characteristic, true)
                characteristic.getDescriptor(clientConfigUuid)?.let { descriptor ->
                    @Suppress("DEPRECATION")
                    descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                    @Suppress("DEPRECATION")
                    gatt.writeDescriptor(descriptor)
                }
                sendRemusConnectionState("connected", gatt.device.name ?: "REMUS")
            } catch (_: SecurityException) {
                sendRemusConnectionState("disconnected")
            }
        }

        @Deprecated("Deprecated in Java")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            characteristic.value?.let(::emitRemusPacket)
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray
        ) {
            emitRemusPacket(value)
        }
    }

    private fun sendRemusConnectionState(state: String, name: String? = null) {
        val body = Arguments.createMap().apply {
            putString("state", state)
            if (name != null) putString("name", name)
        }
        sendEvent("onRemusDeviceConnectionState", body)
    }

    private fun emitRemusPacket(bytes: ByteArray) {
        if (bytes.isEmpty()) return
        val body = Arguments.createMap()
        if (bytes[0].toInt() and 0xff == 0x20) {
            body.putString("rawBase64", Base64.encodeToString(bytes, Base64.NO_WRAP))
        } else {
            body.putString("csv", String(bytes, Charsets.UTF_8))
        }
        sendEvent("onRemusDeviceTelemetry", body)
    }

    @ReactMethod
    fun connectRemusBle(promise: Promise) {
        val adapter = bluetoothAdapter
        if (adapter == null || !reactContext.packageManager.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)) {
            promise.reject("BLE_UNSUPPORTED", "Bluetooth LE is not supported")
            return
        }
        if (!canScanRemus()) {
            promise.reject("BLE_PERMISSION", "Bluetooth scan/connect permission is required")
            return
        }
        if (!adapter.isEnabled) {
            promise.reject("BLE_DISABLED", "Bluetooth is disabled")
            return
        }
        try {
            if (!remusScanning) {
                val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(remusServiceUuid)).build()
                val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
                adapter.bluetoothLeScanner.startScan(listOf(filter), settings, remusScanCallback)
                remusScanning = true
            }
            sendRemusConnectionState("scanning")
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("BLE_SCAN_FAILED", error.message, error)
        }
    }

    @ReactMethod
    fun disconnectRemusBle(promise: Promise) {
        try {
            if (canScanRemus() && remusScanning) {
                bluetoothAdapter?.bluetoothLeScanner?.stopScan(remusScanCallback)
            }
            remusScanning = false
            remusGatt?.disconnect()
            remusGatt?.close()
            remusGatt = null
            remusCharacteristic = null
            sendRemusConnectionState("disconnected")
            promise.resolve(true)
        } catch (error: Exception) {
            promise.reject("BLE_DISCONNECT_FAILED", error.message, error)
        }
    }

    @ReactMethod
    fun sendRemusBleCommand(command: String, promise: Promise) {
        val gatt = remusGatt
        val characteristic = remusCharacteristic
        if (gatt == null || characteristic == null) {
            promise.reject("BLE_NOT_CONNECTED", "REMUS device is not connected")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            !hasBluetoothPermission(Manifest.permission.BLUETOOTH_CONNECT)) {
            promise.reject("BLE_PERMISSION", "Bluetooth connect permission is required")
            return
        }
        try {
            val payload = command.toByteArray(Charsets.UTF_8)
            val accepted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(characteristic, payload, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) == 0
            } else {
                @Suppress("DEPRECATION")
                characteristic.value = payload
                @Suppress("DEPRECATION")
                gatt.writeCharacteristic(characteristic)
            }
            if (accepted) promise.resolve(true)
            else promise.reject("BLE_WRITE_FAILED", "Bluetooth write was not accepted")
        } catch (error: Exception) {
            promise.reject("BLE_WRITE_FAILED", error.message, error)
        }
    }

    @ReactMethod
    fun saveRemusSessionFile(recordingId: String, filename: String, base64: String, promise: Promise) {
        try {
            val data = Base64.decode(base64, Base64.DEFAULT)
            val root = File(reactContext.filesDir, "RemusSessions")
            val folder = RecordingContextStore.resolve(root, recordingId)
            RecordingContextStore.read(folder)
            val extension = if (filename.substringAfterLast('.', "").lowercase() == "bin") "bin" else "rbp2"
            val destination = File(folder, "remus_sensor.$extension")
            destination.writeBytes(data)
            promise.resolve(destination.absolutePath)
        } catch (error: Exception) {
            promise.reject("REMUS_FILE_WRITE_FAILED", error.message, error)
        }
    }

    @ReactMethod
    fun playBeep(isLoud: Boolean, promise: Promise) {
        try {
            if (isLoud) {
                val resId = reactContext.resources.getIdentifier("motor_horn", "raw", reactContext.packageName)
                if (resId != 0) {
                    val mediaPlayer = MediaPlayer.create(reactContext, resId)
                    mediaPlayer?.setOnCompletionListener { it.release() }
                    mediaPlayer?.start()
                    promise.resolve(null)
                    return
                }
            }
            val toneType = if (isLoud) ToneGenerator.TONE_SUP_ERROR else ToneGenerator.TONE_PROP_BEEP
            val volume = if (isLoud) 100 else 70
            val toneGen = ToneGenerator(AudioManager.STREAM_ALARM, volume)
            toneGen.startTone(toneType, if (isLoud) 1000 else 150)
            Handler(reactContext.mainLooper).postDelayed({ toneGen.release() }, 500)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.resolve(null) // ignore errors if audio fails
        }
    }

    @ReactMethod
    fun getRecordingContext(recordingId: String, promise: Promise) {
        try { promise.resolve(RecordingContextStore.read(RecordingContextStore.resolve(File(reactContext.filesDir, "RemusSessions"), recordingId)).toString()) }
        catch (e: Exception) { promise.reject("CONTEXT_ERROR", e.message, e) }
    }

    @ReactMethod
    fun saveRecordingContext(recordingId: String, json: String, finalize: Boolean, promise: Promise) {
        try { promise.resolve(RecordingContextStore.save(RecordingContextStore.resolve(File(reactContext.filesDir, "RemusSessions"), recordingId), json, finalize).toString()) }
        catch (e: Exception) { promise.reject("CONTEXT_ERROR", e.message, e) }
    }
    private var wakeLock: PowerManager.WakeLock? = null

    private var sensorManager: SensorManager? = null
    private var locationManager: LocationManager? = null
    private var sensorThread: HandlerThread? = null
    private var sensorHandler: Handler? = null

    private var accelerometer: Sensor? = null
    private var linearAcceleration: Sensor? = null
    private var gravitySensor: Sensor? = null
    private var gyroscope: Sensor? = null
    private var rotationVector: Sensor? = null
    private var magnetometer: Sensor? = null
    private var orientationSensor: Sensor? = null

    private var hasHardwareLinearAcc = false
    private var hasHardwareGravity = false
    private var requestedMotionPeriodNanos = 10_000_000L
    private var lastPersistedMotionTimestampNanos = Long.MIN_VALUE
    private var lastLinearAccelerationTimestampNanos: Long? = null
    private var lastGravityTimestampNanos: Long? = null
    private var lastGyroscopeTimestampNanos: Long? = null
    private var lastMagnetometerTimestampNanos: Long? = null
    private var lastAttitudeTimestampNanos: Long? = null

    // Raw acceleration (g)
    private var lastRawAx = 0.0
    private var lastRawAy = 0.0
    private var lastRawAz = 0.0

    // Linear acceleration excluding gravity (g)
    private var lastUserAx = 0.0
    private var lastUserAy = 0.0
    private var lastUserAz = 0.0

    // Gravity vector (g)
    private var lastGravityX = 0.0
    private var lastGravityY = 0.0
    private var lastGravityZ = 0.0

    // Raw and calibrated gyroscope (rad/s)
    private var lastRawGx = 0.0
    private var lastRawGy = 0.0
    private var lastRawGz = 0.0
    private var lastRotX = 0.0
    private var lastRotY = 0.0
    private var lastRotZ = 0.0

    // Magnetometer (microtesla)
    private var lastRawMx = 0.0
    private var lastRawMy = 0.0
    private var lastRawMz = 0.0
    private var lastMagAccuracy = 3

    // Attitude in RADIANS (standardized with iOS and Remus C++ engine)
    private var lastRollRad = 0.0
    private var lastPitchRad = 0.0
    private var lastYawRad = 0.0
    private var lastQx = 0.0
    private var lastQy = 0.0
    private var lastQz = 0.0
    private var lastQw = 1.0

    private var lastAccValues: FloatArray? = null
    private var lastMagValues: FloatArray? = null
    private var hasHardwareHeading = false
    // Null means that the device has not produced a trustworthy reading yet.
    // It is deliberately not represented as 0°, since north is a valid value.
    private var lastCourseDegrees: Double? = null
    private var lastHeadingDegrees: Double? = null
    private val recentGpsTimestampsNanos = ArrayDeque<Long>()
    private var measuredGpsHertz = 0.0
    @Volatile private var weatherRequestInFlight = false
    private var lastWeatherFetchMillis = 0L

    private var startTimeNanos: Long = 0
    private var startTimestampMillis: Long = 0

    // Running GPS / Metrics
    private var lastLocation: Location? = null
    private var totalDistanceMeters = 0.0
    private var currentSpeedKmh: Double? = null
    private var speedOrigin: String = "unavailable"
    private var courseOrigin: String = "unavailable"
    private val recentQualifiedFixes = mutableListOf<Location>()
    private var lastEmitTimeMillis: Long = 0
    private val liveSpmHandle = LiveSpmNative.create()
    private var liveSpmResult: DoubleArray? = null
    private var currentSpmOrigin: String? = null

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
        if (writer != null) {
            promise.reject("ALREADY_RECORDING", "A recording is already in progress")
            return
        }
        try {
            val sessionId = if (params.hasKey("sessionId")) params.getString("sessionId") ?: UUID.randomUUID().toString() else UUID.randomUUID().toString()
            val placement = if (params.hasKey("placement")) params.getString("placement") ?: "unknown" else "unknown"
            val notes = if (params.hasKey("notes")) params.getString("notes") ?: "" else ""
            val freq = if (params.hasKey("motionFrequencyHertz")) params.getDouble("motionFrequencyHertz") else 100.0

            val activeWriter = AndroidSessionDatabaseWriter(reactContext)
            val folder = activeWriter.start(sessionId, placement, notes, freq)
            try { RecordingContextStore.read(folder, capture = true) }
            catch (e: Exception) { activeWriter.stop(); throw e }

            writer = activeWriter
            activeSessionId = sessionId
            startTimeNanos = SystemClock.elapsedRealtimeNanos()
            startTimestampMillis = System.currentTimeMillis()
            totalDistanceMeters = 0.0
            currentSpeedKmh = null
            speedOrigin = "unavailable"
            courseOrigin = "unavailable"
            recentQualifiedFixes.clear()
            lastLocation = null
            hasHardwareHeading = false
            hasHardwareLinearAcc = false
            hasHardwareGravity = false
            requestedMotionPeriodNanos = (1_000_000_000.0 / freq).toLong().coerceAtLeast(1L)
            lastPersistedMotionTimestampNanos = Long.MIN_VALUE
            lastLinearAccelerationTimestampNanos = null
            lastGravityTimestampNanos = null
            lastGyroscopeTimestampNanos = null
            lastMagnetometerTimestampNanos = null
            lastAttitudeTimestampNanos = null
            lastRawAx = 0.0; lastRawAy = 0.0; lastRawAz = 0.0
            lastUserAx = 0.0; lastUserAy = 0.0; lastUserAz = 0.0
            lastGravityX = 0.0; lastGravityY = 0.0; lastGravityZ = 0.0
            lastRawGx = 0.0; lastRawGy = 0.0; lastRawGz = 0.0
            lastRotX = 0.0; lastRotY = 0.0; lastRotZ = 0.0
            lastRawMx = 0.0; lastRawMy = 0.0; lastRawMz = 0.0
            lastMagAccuracy = 0
            lastRollRad = 0.0; lastPitchRad = 0.0; lastYawRad = 0.0
            lastQx = 0.0; lastQy = 0.0; lastQz = 0.0; lastQw = 1.0
            lastEmitTimeMillis = 0
            LiveSpmNative.reset(liveSpmHandle)
            liveSpmResult = null
            currentSpmOrigin = null
            lastCourseDegrees = null
            lastHeadingDegrees = null
            recentGpsTimestampsNanos.clear()
            measuredGpsHertz = 0.0
            weatherRequestInFlight = false
            lastWeatherFetchMillis = 0L
            lastAccValues = null
            lastMagValues = null

            // Sensor callbacks must not compete with React Native's UI thread.
            // We request the accelerometer at its fastest supported cadence and
            // decimate persisted frames with requestedMotionPeriodNanos below.
            sensorThread?.quitSafely()
            sensorThread = HandlerThread("RemusSensorCapture").also { it.start() }
            sensorHandler = Handler(requireNotNull(sensorThread).looper)

            val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
            try {
                wakeLock = powerManager?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RemusApp:RecordingWakeLock")?.apply {
                    acquire(12 * 60 * 60 * 1000L)
                }
            } catch (e: Exception) {
                android.util.Log.e("RemusTelemetry", "Failed to acquire WakeLock: ${e.message}")
            }

            try {
                TelemetryRecordingService.startService(reactContext)
            } catch (e: Exception) {
                android.util.Log.e("RemusTelemetry", "Failed to start foreground service: ${e.message}")
            }

            // Initialize sensors on UI thread
            reactContext.runOnUiQueueThread {
                val sm = reactContext.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
                sensorManager = sm
                if (sm != null) {
                    val delayUs = (1_000_000.0 / freq).toInt()
                    val callbackHandler = sensorHandler
                    accelerometer = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
                    linearAcceleration = sm.getDefaultSensor(Sensor.TYPE_LINEAR_ACCELERATION)
                    gravitySensor = sm.getDefaultSensor(Sensor.TYPE_GRAVITY)
                    gyroscope = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
                    // GAME_ROTATION_VECTOR has no magnetic-north reference: its
                    // yaw is relative to an arbitrary initial position and must
                    // never be exposed as a compass heading.
                    rotationVector = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
                        ?: sm.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR)
                    magnetometer = sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
                    @Suppress("DEPRECATION")

                    accelerometer?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_FASTEST, callbackHandler) }
                    linearAcceleration?.let { sm.registerListener(this, it, delayUs, callbackHandler) }
                    gravitySensor?.let { sm.registerListener(this, it, delayUs, callbackHandler) }
                    gyroscope?.let { sm.registerListener(this, it, delayUs, callbackHandler) }
                    rotationVector?.let { sm.registerListener(this, it, delayUs, callbackHandler) }
                    magnetometer?.let { sm.registerListener(this, it, delayUs, callbackHandler) }
                }

                val lm = reactContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
                locationManager = lm
                if (lm != null) {
                    try {
                        // Do not subscribe to GPS, network, and fused together:
                        // they produce interleaved duplicates with incompatible
                        // bearing quality. Prefer the GNSS provider and use
                        // network only when GNSS is unavailable.
                        if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, this)
                        } else if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                            lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 0L, 0f, this)
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
    fun getRecordingState(promise: Promise) {
        val activeWriter = writer
        val state = Arguments.createMap()
        state.putBoolean("isRecording", activeWriter != null)
        if (activeWriter != null) {
            state.putString("sessionId", activeSessionId)
            state.putDouble("elapsedSeconds", (SystemClock.elapsedRealtimeNanos() - startTimeNanos) / 1_000_000_000.0)
            state.putInt("motionSampleCount", activeWriter.motionSampleCount)
        }
        promise.resolve(state)
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
                sensorHandler?.removeCallbacksAndMessages(null)
                sensorThread?.quitSafely()
                sensorHandler = null
                sensorThread = null
                locationManager?.removeUpdates(this)
                locationManager = null
            }

            val manifestJson = activeWriter.stop()
            writer = null
            activeSessionId = null

            try {
                if (wakeLock?.isHeld == true) {
                    wakeLock?.release()
                }
            } catch (e: Exception) {
                android.util.Log.e("RemusTelemetry", "Failed to release WakeLock: ${e.message}")
            }
            wakeLock = null

            try {
                TelemetryRecordingService.stopService(reactContext)
            } catch (e: Exception) {
                android.util.Log.e("RemusTelemetry", "Failed to stop foreground service: ${e.message}")
            }

            val map = Arguments.createMap()
            map.putString("id", manifestJson.optString("id"))
            map.putString("schemaVersion", manifestJson.optString("schemaVersion", "1.0.0"))
            map.putString("producer", manifestJson.optString("producer", "remus-app-recorder"))
            map.putString("producerPlatform", "android")
            map.putString("orientationUnits", "radians")
            map.putString("startedAt", manifestJson.optString("startedAt"))
            map.putString("endedAt", manifestJson.optString("endedAt"))
            map.putInt("motionSampleCount", manifestJson.optInt("motionSampleCount"))
            map.putInt("locationSampleCount", manifestJson.optInt("locationSampleCount"))
            map.putInt("droppedSampleCount", manifestJson.optInt("droppedSampleCount"))
            map.putInt("errorCount", manifestJson.optInt("errorCount"))
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
                // Raw total acceleration (includes gravity) in g
                lastRawAx = event.values[0] / 9.80665
                lastRawAy = event.values[1] / 9.80665
                lastRawAz = event.values[2] / 9.80665
                lastAccValues = event.values.clone()
                computeOrientationFromAccMag(event.timestamp)

                // Fallback complementary filter if hardware gravity / linear acceleration are absent
                if (!hasHardwareGravity) {
                    lastGravityX = 0.9 * lastGravityX + 0.1 * lastRawAx
                    lastGravityY = 0.9 * lastGravityY + 0.1 * lastRawAy
                    lastGravityZ = 0.9 * lastGravityZ + 0.1 * lastRawAz
                }
                if (!hasHardwareLinearAcc) {
                    lastUserAx = lastRawAx - lastGravityX
                    lastUserAy = lastRawAy - lastGravityY
                    lastUserAz = lastRawAz - lastGravityZ
                }

                // Sensor callbacks are independent. Persist a snapshot only on the
                // accelerometer clock and never exceed the requested cadence.
                // The ages below make every cached channel's freshness auditable.
                if (lastPersistedMotionTimestampNanos != Long.MIN_VALUE &&
                    sensorUptimeNanos(event) - lastPersistedMotionTimestampNanos < requestedMotionPeriodNanos) {
                    return
                }
                lastPersistedMotionTimestampNanos = sensorUptimeNanos(event)

                // Determine signal for SPM
                val linearAccFresh = hasHardwareLinearAcc && lastLinearAccelerationTimestampNanos != null &&
                    (event.timestamp - lastLinearAccelerationTimestampNanos!! < 5 * requestedMotionPeriodNanos)

                val selectedOrigin = if (linearAccFresh) "phone_linear_acceleration" else "phone_raw_acceleration_fallback"

                if (currentSpmOrigin != null && currentSpmOrigin != selectedOrigin) {
                    LiveSpmNative.reset(liveSpmHandle)
                    liveSpmResult = null // back to collecting
                }
                currentSpmOrigin = selectedOrigin

                val spmAx = if (linearAccFresh) lastUserAx else lastRawAx
                val spmAy = if (linearAccFresh) lastUserAy else lastRawAy
                val spmAz = if (linearAccFresh) lastUserAz else lastRawAz

                LiveSpmNative.push(
                    liveSpmHandle,
                    sensorUptime,
                    spmAx * 9.80665,
                    spmAy * 9.80665,
                    spmAz * 9.80665
                )?.let { liveSpmResult = it }

                w.recordMotion(
                    wallTime, elapsed, sensorUptime,
                    lastRawAx, lastRawAy, lastRawAz,
                    lastRawGx, lastRawGy, lastRawGz,
                    lastRawMx, lastRawMy, lastRawMz,
                    lastUserAx, lastUserAy, lastUserAz,
                    lastGravityX, lastGravityY, lastGravityZ,
                    lastRotX, lastRotY, lastRotZ,
                    lastRawMx, lastRawMy, lastRawMz,
                    lastMagAccuracy,
                    lastRollRad, lastPitchRad, lastYawRad,
                    lastQx, lastQy, lastQz, lastQw,
                    ageMicros(event.timestamp, lastLinearAccelerationTimestampNanos),
                    ageMicros(event.timestamp, lastGravityTimestampNanos),
                    ageMicros(event.timestamp, lastGyroscopeTimestampNanos),
                    ageMicros(event.timestamp, lastMagnetometerTimestampNanos),
                    ageMicros(event.timestamp, lastAttitudeTimestampNanos)
                )

                // Emit throttled 10 Hz UI telemetry
                val now = System.currentTimeMillis()
                if (now - lastEmitTimeMillis >= 100) {
                    lastEmitTimeMillis = now

                    if (recentGpsTimestampsNanos.isNotEmpty() && (nowNanos - recentGpsTimestampsNanos.last) > 3_500_000_000L) {
                        measuredGpsHertz = 0.0
                    }

                    val body = Arguments.createMap()
                    currentSpeedKmh?.let { body.putDouble("speedKmh", it) } ?: body.putNull("speedKmh")
                    body.putString("speedOrigin", speedOrigin)
                    body.putString("courseOrigin", courseOrigin)
                    body.putDouble("distanceMeters", totalDistanceMeters)
                    lastCourseDegrees?.let { body.putDouble("courseDegrees", it) } ?: body.putNull("courseDegrees")

                    val headingDeg = Math.toDegrees(lastYawRad)
                    val normalizedHeading = if (hasHardwareHeading) {
                        normalizeDegrees(headingDeg)
                    } else {
                        lastHeadingDegrees
                    }
                    normalizedHeading?.let { body.putDouble("headingDegrees", it) } ?: body.putNull("headingDegrees")
                    body.putDouble("gpsRateHz", measuredGpsHertz)

                    // Linear user acceleration magnitude (g)
                    val userAccelG = Math.sqrt(lastUserAx * lastUserAx + lastUserAy * lastUserAy + lastUserAz * lastUserAz)
                    body.putDouble("accelerationG", userAccelG)
                    liveSpmResult?.let { estimate ->
                        if (estimate[0] > 0) body.putDouble("strokeRateSpm", estimate[1]) else body.putNull("strokeRateSpm")
                        body.putString("strokeRateStatus", if (estimate[0] > 0) "available" else if (estimate[0] == 0.0) "collecting" else "unavailable")
                        body.putString("strokeRateReason", if (estimate[0] == 0.0) "collecting_window" else if (estimate[0] < 0) "weak_periodicity" else "")
                        body.putDouble("strokeRatePeriodicity", estimate[2])
                        body.putDouble("strokeRateProgress", estimate[3])
                        body.putDouble("strokeRateObservedHertz", estimate[4])
                        body.putDouble("strokeRateWindowSeconds", 15.0)
                        body.putString("strokeRateAlgorithmVersion", "live-vector-acf-0.1-experimental")
                        body.putString("strokeRateOrigin", currentSpmOrigin ?: "unknown")
                    }

                    if (lastGyroscopeTimestampNanos != null) {
                        body.putDouble("rotationXRad", lastRotX)
                        body.putDouble("rotationYRad", lastRotY)
                        body.putDouble("rotationZRad", lastRotZ)
                    } else {
                        body.putNull("rotationXRad")
                        body.putNull("rotationYRad")
                        body.putNull("rotationZRad")
                    }
                    body.putInt("imuSamples", w.motionSampleCount)
                    lastLocation?.let {
                        body.putDouble("gpsAccuracyMeters", it.accuracy.toDouble())
                        if (it.hasAltitude()) body.putDouble("altitudeMeters", it.altitude)
                    }
                    sendEvent("onTelemetryUpdate", body)
                }
            }
            Sensor.TYPE_LINEAR_ACCELERATION -> {
                hasHardwareLinearAcc = true
                lastLinearAccelerationTimestampNanos = event.timestamp
                lastUserAx = event.values[0] / 9.80665
                lastUserAy = event.values[1] / 9.80665
                lastUserAz = event.values[2] / 9.80665
            }
            Sensor.TYPE_GRAVITY -> {
                hasHardwareGravity = true
                lastGravityTimestampNanos = event.timestamp
                lastGravityX = event.values[0] / 9.80665
                lastGravityY = event.values[1] / 9.80665
                lastGravityZ = event.values[2] / 9.80665
            }
            Sensor.TYPE_GYROSCOPE -> {
                lastGyroscopeTimestampNanos = event.timestamp
                lastRawGx = event.values[0].toDouble()
                lastRawGy = event.values[1].toDouble()
                lastRawGz = event.values[2].toDouble()
                lastRotX = lastRawGx
                lastRotY = lastRawGy
                lastRotZ = lastRawGz
            }
            Sensor.TYPE_ROTATION_VECTOR,
            Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR,
            Sensor.TYPE_GAME_ROTATION_VECTOR -> {
                val rotationMatrix = FloatArray(9)
                val orientationValues = FloatArray(3)
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
                SensorManager.getOrientation(rotationMatrix, orientationValues)

                // REC-03: Store orientation in RADIANS
                lastYawRad = orientationValues[0].toDouble()
                lastPitchRad = orientationValues[1].toDouble()
                lastRollRad = orientationValues[2].toDouble()
                hasHardwareHeading = true
                lastAttitudeTimestampNanos = event.timestamp

                val quat = FloatArray(4)
                SensorManager.getQuaternionFromVector(quat, event.values)
                lastQw = quat[0].toDouble()
                lastQx = quat[1].toDouble()
                lastQy = quat[2].toDouble()
                lastQz = quat[3].toDouble()
            }
            Sensor.TYPE_MAGNETIC_FIELD -> {
                lastMagnetometerTimestampNanos = event.timestamp
                lastRawMx = event.values[0].toDouble()
                lastRawMy = event.values[1].toDouble()
                lastRawMz = event.values[2].toDouble()
                lastMagAccuracy = event.accuracy
                lastMagValues = event.values.clone()
                computeOrientationFromAccMag(event.timestamp)
            }
            3 -> { // Sensor.TYPE_ORIENTATION (deprecated fallback)
                // Values are in degrees; convert to radians
                lastYawRad = Math.toRadians(event.values[0].toDouble())
                lastPitchRad = Math.toRadians(event.values[1].toDouble())
                lastRollRad = Math.toRadians(event.values[2].toDouble())
                hasHardwareHeading = true
                lastAttitudeTimestampNanos = event.timestamp
            }
        }
    }

    private fun computeOrientationFromAccMag(timestampNanos: Long) {
        val acc = lastAccValues ?: return
        val mag = lastMagValues ?: return
        val rMatrix = FloatArray(9)
        val iMatrix = FloatArray(9)
        if (SensorManager.getRotationMatrix(rMatrix, iMatrix, acc, mag)) {
            val orientationValues = FloatArray(3)
            SensorManager.getOrientation(rMatrix, orientationValues)
            lastYawRad = orientationValues[0].toDouble()
            lastPitchRad = orientationValues[1].toDouble()
            lastRollRad = orientationValues[2].toDouble()
            hasHardwareHeading = true
            lastAttitudeTimestampNanos = timestampNanos
        }
    }

    private fun sensorUptimeNanos(event: SensorEvent): Long = event.timestamp

    private fun normalizeDegrees(degrees: Double): Double = ((degrees % 360.0) + 360.0) % 360.0

    /** Returns -1 when a channel has not been observed or is newer than the frame. */
    private fun ageMicros(frameTimestampNanos: Long, channelTimestampNanos: Long?): Long {
        val timestamp = channelTimestampNanos ?: return -1L
        val ageNanos = frameTimestampNanos - timestamp
        return if (ageNanos < 0L) -1L else ageNanos / 1_000L
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        if (sensor?.type == Sensor.TYPE_MAGNETIC_FIELD) {
            lastMagAccuracy = accuracy
        }
    }

    // LocationListener
    override fun onLocationChanged(location: Location) {
        val w = writer ?: return
        val nowNanos = SystemClock.elapsedRealtimeNanos()
        val elapsed = (nowNanos - startTimeNanos) / 1_000_000_000.0

        recentGpsTimestampsNanos.addLast(nowNanos)
        while (recentGpsTimestampsNanos.isNotEmpty() && (nowNanos - recentGpsTimestampsNanos.first) > 4_000_000_000L) {
            recentGpsTimestampsNanos.removeFirst()
        }
        if (recentGpsTimestampsNanos.size >= 2) {
            val windowSec = (recentGpsTimestampsNanos.last - recentGpsTimestampsNanos.first) / 1_000_000_000.0
            if (windowSec > 0.05) {
                measuredGpsHertz = (recentGpsTimestampsNanos.size - 1) / windowSec
            }
        } else if (recentGpsTimestampsNanos.size == 1) {
            measuredGpsHertz = 1.0
        }

        lastLocation?.let { prev ->
            val dist = location.distanceTo(prev)
            if (dist > 0.5) {
                totalDistanceMeters += dist
            }
        }

        val positionOk = location.hasAccuracy() && location.accuracy <= 20.0f

        // Speed accuracy evaluation
        val hasValidSpeedAccuracy = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            !location.hasSpeedAccuracy() || (location.speedAccuracyMetersPerSecond in 0.0f..3.0f)
        } else {
            true
        }
        val reportedSpeedOk = location.hasSpeed() && location.speed >= 0.0f && hasValidSpeedAccuracy && location.speed <= 15.0f

        var derivedSpeedMps: Double? = null
        if (positionOk) {
            val nowTimeMillis = location.time
            val lastFix = recentQualifiedFixes.lastOrNull()
            if (lastFix != null) {
                val dtSec = (nowTimeMillis - lastFix.time) / 1000.0
                if (dtSec > 0) {
                    if (dtSec > 5.0) {
                        recentQualifiedFixes.clear()
                        recentQualifiedFixes.add(location)
                    } else {
                        val dist = location.distanceTo(lastFix).toDouble()
                        val segSpeed = dist / dtSec
                        if (segSpeed <= 15.0) {
                            recentQualifiedFixes.add(location)
                        }
                    }
                }
            } else {
                recentQualifiedFixes.add(location)
            }

            // Prune fixes older than 3.0 seconds
            val cutoff = nowTimeMillis - 3000L
            recentQualifiedFixes.removeAll { it.time < cutoff }

            if (recentQualifiedFixes.size >= 2) {
                val first = recentQualifiedFixes.first()
                val last = recentQualifiedFixes.last()
                val totalDt = (last.time - first.time) / 1000.0
                if (totalDt >= 0.5) {
                    var totalDist = 0.0
                    for (i in 1 until recentQualifiedFixes.size) {
                        totalDist += recentQualifiedFixes[i - 1].distanceTo(recentQualifiedFixes[i]).toDouble()
                    }
                    val avgSpeed = totalDist / totalDt
                    if (avgSpeed <= 15.0) {
                        derivedSpeedMps = avgSpeed
                    }
                }
            }
        }

        if (reportedSpeedOk) {
            currentSpeedKmh = location.speed.toDouble() * 3.6
            speedOrigin = "reported"
        } else if (derivedSpeedMps != null) {
            currentSpeedKmh = derivedSpeedMps * 3.6
            speedOrigin = "coordinate_derived"
        } else {
            currentSpeedKmh = null
            speedOrigin = "unavailable"
        }

        // Bearing / course evaluation
        val movingSpeedMps = if (reportedSpeedOk) location.speed.toDouble() else (derivedSpeedMps ?: 0.0)
        val hasBearingAccuracy = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            !location.hasBearingAccuracy() || (location.bearingAccuracyDegrees in 0.0f..90.0f)
        } else {
            true
        }
        val hasUsableBearing = location.hasBearing() && movingSpeedMps >= 0.5 && hasBearingAccuracy

        if (hasUsableBearing) {
            lastCourseDegrees = normalizeDegrees(location.bearing.toDouble())
            courseOrigin = "reported"
            if (!hasHardwareHeading) {
                lastHeadingDegrees = lastCourseDegrees
            }
        } else {
            var derivedBearing: Double? = null
            if (recentQualifiedFixes.size >= 2) {
                val first = recentQualifiedFixes.first()
                val last = recentQualifiedFixes.last()
                val disp = first.distanceTo(last)
                if (disp >= 3.0f) {
                    derivedBearing = normalizeDegrees(first.bearingTo(last).toDouble())
                }
            }
            if (derivedBearing != null) {
                lastCourseDegrees = derivedBearing
                courseOrigin = "coordinate_derived"
                if (!hasHardwareHeading) {
                    lastHeadingDegrees = derivedBearing
                }
            } else {
                lastCourseDegrees = null
                courseOrigin = "unavailable"
            }
        }

        lastLocation = location

        w.recordLocation(location, elapsed, lastCourseDegrees)
        fetchWeatherIfNeeded(location, elapsed)

        val body = Arguments.createMap()
        currentSpeedKmh?.let { body.putDouble("speedKmh", it) } ?: body.putNull("speedKmh")
        body.putString("speedOrigin", speedOrigin)
        body.putString("courseOrigin", courseOrigin)
        body.putDouble("distanceMeters", totalDistanceMeters)
        lastCourseDegrees?.let { body.putDouble("courseDegrees", it) } ?: body.putNull("courseDegrees")
        val headingDeg = Math.toDegrees(lastYawRad)
        val heading = if (hasHardwareHeading) {
            normalizeDegrees(headingDeg)
        } else {
            lastHeadingDegrees
        }
        heading?.let { body.putDouble("headingDegrees", it) } ?: body.putNull("headingDegrees")
        body.putDouble("gpsRateHz", measuredGpsHertz)
        body.putDouble("gpsAccuracyMeters", location.accuracy.toDouble())
        if (location.hasAltitude()) {
            body.putDouble("altitudeMeters", location.altitude)
        }
        val userAccelG = Math.sqrt(lastUserAx * lastUserAx + lastUserAy * lastUserAy + lastUserAz * lastUserAz)
        body.putDouble("accelerationG", userAccelG)
        if (lastGyroscopeTimestampNanos != null) {
            body.putDouble("rotationXRad", lastRotX)
            body.putDouble("rotationYRad", lastRotY)
            body.putDouble("rotationZRad", lastRotZ)
        } else {
            body.putNull("rotationXRad")
            body.putNull("rotationYRad")
            body.putNull("rotationZRad")
        }
        body.putInt("imuSamples", w.motionSampleCount)
        sendEvent("onTelemetryUpdate", body)
    }

    private fun fetchWeatherIfNeeded(location: Location, elapsed: Double) {
        val now = System.currentTimeMillis()
        if (weatherRequestInFlight || now - lastWeatherFetchMillis < 15 * 60 * 1000L) return
        weatherRequestInFlight = true
        emitWeatherStatus("Updating weather…")
        val latitude = location.latitude
        val longitude = location.longitude
        Thread {
            try {
                val fields = "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code"
                val connection = (URL("https://api.open-meteo.com/v1/forecast?latitude=$latitude&longitude=$longitude&current=$fields&timezone=UTC").openConnection() as HttpURLConnection).apply {
                    connectTimeout = 10_000; readTimeout = 10_000; requestMethod = "GET"
                }
                val payload = connection.inputStream.bufferedReader().use { it.readText() }
                if (connection.responseCode !in 200..299) throw IllegalStateException("Weather HTTP ${connection.responseCode}")
                val current = JSONObject(payload).getJSONObject("current")
                fun number(name: String): Double? = if (current.has(name) && !current.isNull(name)) current.getDouble(name) else null
                val code = if (current.has("weather_code") && !current.isNull("weather_code")) current.getInt("weather_code") else null
                writer?.recordWeather(latitude, longitude, elapsed, current.getString("time"), number("temperature_2m"), number("apparent_temperature"), number("relative_humidity_2m"), number("precipitation"), number("surface_pressure"), number("wind_speed_10m"), number("wind_direction_10m"), number("wind_gusts_10m"), code)
                lastWeatherFetchMillis = System.currentTimeMillis()
                val body = Arguments.createMap()
                body.putString("weatherStatus", "Updated")
                number("temperature_2m")?.let { body.putDouble("weatherTemperatureC", it) }
                number("relative_humidity_2m")?.let { body.putDouble("weatherHumidityPercent", it) }
                number("wind_speed_10m")?.let { body.putDouble("weatherWindKmh", it) }
                sendEvent("onTelemetryUpdate", body)
            } catch (_: Exception) {
                emitWeatherStatus("Weather unavailable")
            } finally {
                weatherRequestInFlight = false
            }
        }.start()
    }

    private fun emitWeatherStatus(status: String) {
        val body = Arguments.createMap(); body.putString("weatherStatus", status)
        sendEvent("onTelemetryUpdate", body)
    }

    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    @ReactMethod
    fun listSessions(promise: Promise) {
        try {
            val root = File(reactContext.filesDir, "RemusSessions")
            if (!root.exists()) {
                promise.resolve(Arguments.createArray())
                return
            }

            val folders = root.listFiles { file -> file.isDirectory } ?: emptyArray()
            val items = mutableListOf<Pair<String, WritableMap>>()

            for (folder in folders) {
                val manifestFile = File(folder, "manifest.json")
                if (!manifestFile.exists()) continue

                val jsonStr = manifestFile.readText()
                val manifest = JSONObject(jsonStr)
                val context = runCatching { JSONObject(File(folder, RecordingContextStore.filename).readText()) }.getOrNull()

                val item = Arguments.createMap()
                val id = manifest.optString("id")
                val startedAt = manifest.optString("startedAt")
                item.putString("id", id)
                item.putString("folderUri", folder.absolutePath)
                item.putString("startedAt", startedAt)
                item.putString("endedAt", manifest.optString("endedAt"))
                item.putInt("sampleCount", manifest.optInt("motionSampleCount"))
                item.putString("placement", (context?.opt("sensorPlacement") as? String) ?: manifest.optString("placement", "unknown"))
                item.putString("notes", manifest.optString("notes", ""))
                item.putString("status", manifest.optString("status", "completed"))
                item.putString("contextCompleteness", context?.optString("contextCompleteness", "needs_required_context") ?: "needs_required_context")
                item.putString("sessionTitle", context?.optString("sessionTitle", null))

                // Calculate duration in seconds
                val startedAtStr = startedAt
                val endedAtStr = manifest.optString("endedAt")
                var durationSec = 0.0
                if (startedAtStr.isNotEmpty() && endedAtStr.isNotEmpty()) {
                    try {
                        val start = Instant.parse(startedAtStr).toEpochMilli()
                        val end = Instant.parse(endedAtStr).toEpochMilli()
                        durationSec = Math.max(0.0, (end - start) / 1000.0)
                    } catch (_: Exception) {}
                }
                item.putDouble("durationSeconds", durationSec)

                var folderSize = 0L
                folder.walkTopDown().forEach { f ->
                    if (f.isFile) folderSize += f.length()
                }
                item.putDouble("sizeBytes", folderSize.toDouble())

                val watchFolder = File(folder, "watch")
                val hasWatch = watchFolder.exists() && (watchFolder.listFiles { _, name -> name.endsWith(".zip") }?.isNotEmpty() == true)
                item.putBoolean("hasWatchRecording", hasWatch)

                items.add(Pair(startedAt, item))
            }

            items.sortByDescending { it.first }
            val list = Arguments.createArray()
            items.forEach { list.pushMap(it.second) }

            promise.resolve(list)
        } catch (e: Exception) {
            promise.reject("LIST_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun exportSessionZip(sessionId: String, promise: Promise) {
        exportArchive(sessionId, false, promise)
    }

    @ReactMethod
    fun exportRawSessionZip(sessionId: String, promise: Promise) {
        exportArchive(sessionId, true, promise)
    }

    private fun exportArchive(sessionId: String, raw: Boolean, promise: Promise) {
        try {
            val root = File(reactContext.filesDir, "RemusSessions")
            val sessionFolder = RecordingContextStore.resolve(root, sessionId)
            require(RecordingContextStore.read(sessionFolder).optString("captureStatus") != "recording") { "Stop recording before exporting" }
            if (!raw) RecordingContextStore.requireComplete(sessionFolder)

            val zipName = "remus-session-${sessionId.take(8)}.zip"
            val zipFile = File(reactContext.cacheDir, zipName)
            if (zipFile.exists()) zipFile.delete()

            ZipOutputStream(FileOutputStream(zipFile)).use { zos ->
                addSessionFilesToZip(sessionFolder, zos)
            }

            promise.resolve(zipFile.absolutePath)
        } catch (e: Exception) {
            promise.reject("EXPORT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun deleteSession(sessionId: String, promise: Promise) {
        try {
            val root = File(reactContext.filesDir, "RemusSessions")
            val folders = root.listFiles { file -> file.isDirectory && file.name.contains(sessionId.take(8)) }
            val sessionFolder = folders?.firstOrNull() ?: run {
                promise.reject("NOT_FOUND", "Session folder not found for $sessionId")
                return
            }

            sessionFolder.deleteRecursively()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("DELETE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun shareSession(sessionId: String, promise: Promise) {
        try {
            val root = File(reactContext.filesDir, "RemusSessions")
            val sessionFolder = RecordingContextStore.resolve(root, sessionId)
            RecordingContextStore.requireComplete(sessionFolder)

            val zipName = "remus-session-${sessionId.take(8)}.zip"
            val zipFile = File(reactContext.cacheDir, zipName)
            // Rebuild: cached archives may predate context or a Watch transfer.
            ZipOutputStream(FileOutputStream(zipFile)).use { zos ->
                addSessionFilesToZip(sessionFolder, zos)
            }

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

    private fun addSessionFilesToZip(sessionFolder: File, destination: ZipOutputStream) {
        sessionFolder.walkTopDown().forEach { file ->
            if (!file.isFile || file.name.endsWith(".tmp") || file.name.endsWith("-wal") || file.name.endsWith("-shm") || file.name.endsWith("-journal")) {
                return@forEach
            }
            destination.putNextEntry(ZipEntry(file.relativeTo(sessionFolder).path))
            FileInputStream(file).use { input -> input.copyTo(destination) }
            destination.closeEntry()
        }
    }

    override fun invalidate() {
        super.invalidate()
        try {
            if (canScanRemus() && remusScanning) {
                bluetoothAdapter?.bluetoothLeScanner?.stopScan(remusScanCallback)
            }
            remusGatt?.disconnect()
            remusGatt?.close()
        } catch (_: Exception) {}
        remusScanning = false
        remusGatt = null
        remusCharacteristic = null
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (_: Exception) {}
        wakeLock = null
        try {
            TelemetryRecordingService.stopService(reactContext)
        } catch (_: Exception) {}
    }
}
