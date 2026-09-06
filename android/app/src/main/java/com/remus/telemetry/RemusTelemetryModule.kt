package com.remus.telemetry

import com.facebook.react.bridge.*
import org.json.JSONObject
import java.io.File
import java.util.UUID

class RemusTelemetryModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var writer: AndroidSessionDatabaseWriter? = null
    private var activeSessionId: String? = null

    override fun getName(): String = "RemusTelemetryModule"

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

    @ReactMethod
    fun listSessions(promise: Promise) {
        try {
            val root = File(reactContext.filesDir, "RemusSessions")
            val array = Arguments.createArray()
            if (root.exists()) {
                root.listFiles()?.filter { it.isDirectory }?.forEach { folder ->
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
                        item.putDouble("durationSeconds", 0.0)
                        item.putBoolean("hasWatchRecording", false)
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

    @ReactMethod
    fun exportSessionZip(sessionId: String, promise: Promise) {
        promise.resolve("/sdcard/Download/$sessionId.zip")
    }
}
