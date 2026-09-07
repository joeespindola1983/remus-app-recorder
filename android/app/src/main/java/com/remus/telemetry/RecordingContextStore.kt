package com.remus.telemetry

import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.util.TimeZone
import java.util.UUID

internal object RecordingContextStore {
    const val filename = "recording-context.json"
    private val catalog = JSONObject("""{"dictionaryVersion":"1.7.0","rowingBoatClasses":{"single_sculls":"1x","double_sculls":"2x","pair":"2-","coxed_pair":"2+","quadruple_sculls":"4x","coxed_quadruple_sculls":"4x+","four":"4-","coxed_four":"4+","eight":"8+"},"boatClassSystems":{"ivf_v":{"documentedClasses":["v1","v6","v12"],"scope":"current_ivf_world_sprints"},"vaa_v":{"documentedClasses":["v1","v2","v3","v4","v6","v12","v16"],"scope":"source_attributed_v_notation"},"outrigger_oc":{"documentedClasses":["oc1","oc2","oc3","oc4","oc6"],"scope":"source_attributed_outrigger_canoe_notation"},"waka_ama_w":{"documentedClasses":["w1","w2","w3","w6","w12"],"scope":"waka_ama_new_zealand_notation"},"custom":{"documentedClasses":[],"scope":"preserved_source_defined_class"}},"classes":[{"system":"ivf_v","code":"v1","paddlerCapacity":1},{"system":"ivf_v","code":"v6","paddlerCapacity":6},{"system":"ivf_v","code":"v12","paddlerCapacity":12,"hullConfiguration":"double_hull"},{"system":"vaa_v","code":"v1","paddlerCapacity":1},{"system":"vaa_v","code":"v2","paddlerCapacity":2},{"system":"vaa_v","code":"v3","paddlerCapacity":3},{"system":"vaa_v","code":"v4","paddlerCapacity":4},{"system":"vaa_v","code":"v6","paddlerCapacity":6},{"system":"vaa_v","code":"v12","paddlerCapacity":12,"hullConfiguration":"double_hull"},{"system":"vaa_v","code":"v16","paddlerCapacity":16},{"system":"outrigger_oc","code":"oc1","paddlerCapacity":1},{"system":"outrigger_oc","code":"oc2","paddlerCapacity":2},{"system":"outrigger_oc","code":"oc3","paddlerCapacity":3},{"system":"outrigger_oc","code":"oc4","paddlerCapacity":4},{"system":"outrigger_oc","code":"oc6","paddlerCapacity":6},{"system":"waka_ama_w","code":"w1","paddlerCapacity":1},{"system":"waka_ama_w","code":"w2","paddlerCapacity":2},{"system":"waka_ama_w","code":"w3","paddlerCapacity":3},{"system":"waka_ama_w","code":"w6","paddlerCapacity":6},{"system":"waka_ama_w","code":"w12","paddlerCapacity":12,"hullConfiguration":"double_hull"}],"placements":["hull","left_wrist","right_wrist","body","oar","paddle","unknown"]}""")
    fun manifest(folder: File) = JSONObject(File(folder, "manifest.json").readText())
    fun resolve(root: File, id: String): File =
        root.listFiles()?.firstOrNull { it.isDirectory && runCatching { manifest(it).optString("id").equals(id, true) }.getOrDefault(false) }
            ?: error("Recording not found")
    fun read(folder: File, capture: Boolean = false): JSONObject {
        val m = manifest(folder)
        val file = File(folder, filename)
        val c = if (file.exists()) JSONObject(file.readText()) else JSONObject().apply {
            put("schemaVersion", "1.0.0"); put("dictionaryVersion", "1.7.0")
            put("recordingId", m.getString("id")); put("activityId", UUID.randomUUID().toString())
            put("ingestionChannel", "native_capture"); put("contextCompleteness", "needs_required_context")
            for (key in listOf("sportDiscipline", "rowingBoatClass", "boatClassSystem", "outriggerBoatClassCode", "originalBoatClassCode", "paddlerCapacity", "sensorPlacement")) put(key, JSONObject.NULL)
            put("placementProvenance", "unknown"); put("participants", JSONArray())
            put("notes", ""); put("seatNumberingConvention", "source_declared")
            put("timeZoneId", if (capture) TimeZone.getDefault().id else JSONObject.NULL)
            put("timeZoneProvenance", if (capture) "capture_device" else "unavailable")
        }
        c.put("startedAt", m.opt("startedAt") ?: JSONObject.NULL)
        c.put("endedAt", m.opt("endedAt") ?: JSONObject.NULL)
        c.put("captureStatus", m.opt("status") ?: JSONObject.NULL)
        c.put("sourceManifestFilename", "manifest.json")
        c.put("databaseFilename", m.optString("databaseFilename", "telemetry.sqlite"))
        c.put("deviceModel", m.opt("deviceModel") ?: JSONObject.NULL)
        c.put("systemVersion", m.opt("systemVersion") ?: JSONObject.NULL)
        c.put("producerPlatform", "android")
        c.put("targetSamplingRateHertz", m.opt("motionFrequencyHertz") ?: JSONObject.NULL)
        if (!file.exists()) write(c, folder)
        return c
    }
    fun write(c: JSONObject, folder: File) {
        val temporary = File(folder, "$filename.tmp")
        FileOutputStream(temporary).use { out ->
            out.write(c.toString(2).toByteArray(Charsets.UTF_8)); out.fd.sync()
        }
        check(temporary.renameTo(File(folder, filename))) { "Could not atomically save recording context" }
    }
    fun validate(c: JSONObject) {
        var capacity: Int? = null
        val rowing = catalog.getJSONObject("rowingBoatClasses")
        if (c.optString("sportDiscipline") == "rowing" && rowing.has(c.optString("rowingBoatClass")) &&
            c.isNull("boatClassSystem") && c.isNull("outriggerBoatClassCode")) {
            capacity = rowing.getString(c.getString("rowingBoatClass")).take(1).toInt()
        } else if (c.optString("sportDiscipline") == "vaa" && c.isNull("rowingBoatClass")) {
            val classes = catalog.getJSONArray("classes")
            for (i in 0 until classes.length()) {
                val item = classes.getJSONObject(i)
                if (item.getString("system") == c.optString("boatClassSystem") && item.getString("code") == c.optString("outriggerBoatClassCode") &&
                    item.getInt("paddlerCapacity").toDouble() == c.optDouble("paddlerCapacity")) capacity = item.getInt("paddlerCapacity")
            }
        }
        val placements = catalog.getJSONArray("placements")
        require(capacity != null && (0 until placements.length()).any { placements.getString(it) == c.optString("sensorPlacement") }) { "Required recording context is incomplete or invalid" }
        require(c.opt("notes") is String && c.getString("notes").length <= 2000) { "Invalid notes" }
        val people = c.getJSONArray("participants")
        require(people.length() <= 16) { "Too many participants" }
        val seats = mutableSetOf<Int>(); val ids = mutableSetOf<String>()
        for (i in 0 until people.length()) {
            val person = people.getJSONObject(i)
            val id = person.getString("activityParticipantId")
            val name = person.getString("displayName")
            require(id.isNotEmpty() && ids.add(id) && person.has("personId") && person.isNull("personId") && name.length <= 100) { "Invalid participant" }
            if (!person.isNull("crewSeatNumber")) {
                val raw = person.get("crewSeatNumber")
                require(raw is Number && raw.toDouble() == raw.toInt().toDouble()) { "Invalid seat" }
                val seat = raw.toInt()
                require(seat in 1..capacity && seats.add(seat)) { "Invalid or duplicate seat" }
            } else require(name.trim().isNotEmpty() && person.has("crewSeatNumber")) { "Invalid participant" }
        }
    }
    fun save(folder: File, json: String, finalize: Boolean): JSONObject {
        require(json.toByteArray().size <= 65536) { "Context too large" }
        val input = JSONObject(json); val c = read(folder)
        require(c.optString("contextCompleteness") != "complete") { "Package already finalized" }
        require(input.optString("recordingId") == c.optString("recordingId")) { "Recording identity mismatch" }
        require(c.optString("captureStatus") != "recording") { "Stop recording before completing context" }
        for (key in listOf("sportDiscipline", "rowingBoatClass", "boatClassSystem", "outriggerBoatClassCode", "originalBoatClassCode", "paddlerCapacity", "sensorPlacement", "participants", "notes")) c.put(key, input.opt(key) ?: JSONObject.NULL)
        if (finalize) {
            validate(c)
            val start = Instant.parse(c.getString("startedAt")); val end = Instant.parse(c.getString("endedAt"))
            require(!end.isBefore(start)) { "Invalid recording time bounds" }
            c.put("finalizedAt", Instant.now().toString())
        }
        c.put("placementProvenance", if (c.isNull("sensorPlacement") || c.optString("sensorPlacement") == "unknown") "unknown" else "user_declared")
        c.put("contextCompleteness", if (finalize) "complete" else "needs_required_context")
        c.put("contextSource", "recorder_operator"); c.put("analysisEligibility", "not_evaluated")
        write(c, folder)
        return c
    }
    fun requireComplete(folder: File) {
        val c = read(folder)
        require(c.optString("captureStatus") != "recording" && c.optString("contextCompleteness") == "complete") { "Complete recording details before exporting the finalized package" }
        validate(c)
    }
}

