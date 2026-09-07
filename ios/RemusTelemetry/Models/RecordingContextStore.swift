import Foundation
import CoreFoundation

// Canonical, versioned sidecar. Legacy manifest and sensor database remain original evidence.
enum RecordingContextStore {
    static let filename = "recording-context.json"
    static let catalog = try! JSONSerialization.jsonObject(with: Data(#"{"dictionaryVersion":"1.7.0","rowingBoatClasses":{"single_sculls":"1x","double_sculls":"2x","pair":"2-","coxed_pair":"2+","quadruple_sculls":"4x","coxed_quadruple_sculls":"4x+","four":"4-","coxed_four":"4+","eight":"8+"},"boatClassSystems":{"ivf_v":{"documentedClasses":["v1","v6","v12"],"scope":"current_ivf_world_sprints"},"vaa_v":{"documentedClasses":["v1","v2","v3","v4","v6","v12","v16"],"scope":"source_attributed_v_notation"},"outrigger_oc":{"documentedClasses":["oc1","oc2","oc3","oc4","oc6"],"scope":"source_attributed_outrigger_canoe_notation"},"waka_ama_w":{"documentedClasses":["w1","w2","w3","w6","w12"],"scope":"waka_ama_new_zealand_notation"},"custom":{"documentedClasses":[],"scope":"preserved_source_defined_class"}},"classes":[{"system":"ivf_v","code":"v1","paddlerCapacity":1},{"system":"ivf_v","code":"v6","paddlerCapacity":6},{"system":"ivf_v","code":"v12","paddlerCapacity":12,"hullConfiguration":"double_hull"},{"system":"vaa_v","code":"v1","paddlerCapacity":1},{"system":"vaa_v","code":"v2","paddlerCapacity":2},{"system":"vaa_v","code":"v3","paddlerCapacity":3},{"system":"vaa_v","code":"v4","paddlerCapacity":4},{"system":"vaa_v","code":"v6","paddlerCapacity":6},{"system":"vaa_v","code":"v12","paddlerCapacity":12,"hullConfiguration":"double_hull"},{"system":"vaa_v","code":"v16","paddlerCapacity":16},{"system":"outrigger_oc","code":"oc1","paddlerCapacity":1},{"system":"outrigger_oc","code":"oc2","paddlerCapacity":2},{"system":"outrigger_oc","code":"oc3","paddlerCapacity":3},{"system":"outrigger_oc","code":"oc4","paddlerCapacity":4},{"system":"outrigger_oc","code":"oc6","paddlerCapacity":6},{"system":"waka_ama_w","code":"w1","paddlerCapacity":1},{"system":"waka_ama_w","code":"w2","paddlerCapacity":2},{"system":"waka_ama_w","code":"w3","paddlerCapacity":3},{"system":"waka_ama_w","code":"w6","paddlerCapacity":6},{"system":"waka_ama_w","code":"w12","paddlerCapacity":12,"hullConfiguration":"double_hull"}],"placements":["hull","left_wrist","right_wrist","body","oar","paddle","unknown"]}"#.utf8)) as! [String: Any]
    static func error(_ message: String) -> NSError {
        NSError(domain: "RemusRecordingContext", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
    static func manifest(_ folder: URL) throws -> [String: Any] {
        guard let value = try JSONSerialization.jsonObject(with: Data(contentsOf: folder.appendingPathComponent("manifest.json"))) as? [String: Any] else { throw error("Invalid manifest") }
        return value
    }
    static func resolve(root: URL, id: String) throws -> URL {
        for folder in try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
            if let value = try? manifest(folder), let actual = value["id"] as? String, actual.lowercased() == id.lowercased() { return folder }
        }
        throw error("Recording not found")
    }
    static func read(_ folder: URL, capture: Bool = false) throws -> [String: Any] {
        let m = try manifest(folder)
        let url = folder.appendingPathComponent(filename)
        var result: [String: Any]
        if FileManager.default.fileExists(atPath: url.path) {
            guard let value = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any] else { throw error("Invalid recording context") }
            result = value
        } else {
            result = ["schemaVersion": "1.0.0", "dictionaryVersion": "1.7.0", "recordingId": m["id"] ?? NSNull(),
                "activityId": UUID().uuidString, "ingestionChannel": "native_capture", "contextCompleteness": "needs_required_context",
                "sportDiscipline": NSNull(), "rowingBoatClass": NSNull(), "boatClassSystem": NSNull(),
                "outriggerBoatClassCode": NSNull(), "originalBoatClassCode": NSNull(), "paddlerCapacity": NSNull(),
                "sensorPlacement": NSNull(), "placementProvenance": "unknown", "participants": [],
                "seatNumberingConvention": "source_declared", "notes": "",
                "timeZoneId": capture ? TimeZone.current.identifier as Any : NSNull(),
                "timeZoneProvenance": capture ? "capture_device" : "unavailable"]
        }
        result["startedAt"] = m["startedAt"]
        result["endedAt"] = m["endedAt"] ?? NSNull()
        result["captureStatus"] = m["status"]
        result["sourceManifestFilename"] = "manifest.json"
        result["databaseFilename"] = m["databaseFilename"] ?? "telemetry.sqlite"
        result["deviceModel"] = m["deviceModel"] ?? NSNull()
        result["systemVersion"] = m["systemVersion"] ?? NSNull()
        result["producerPlatform"] = "ios"
        result["targetSamplingRateHertz"] = m["motionFrequencyHertz"] ?? NSNull()
        if !FileManager.default.fileExists(atPath: url.path) { try write(result, folder: folder) }
        return result
    }
    static func write(_ value: [String: Any], folder: URL) throws {
        try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]).write(to: folder.appendingPathComponent(filename), options: .atomic)
    }
    static func validate(_ c: [String: Any]) throws {
        let sport = c["sportDiscipline"] as? String ?? ""
        let rowing = catalog["rowingBoatClasses"] as! [String: String]
        let classes = catalog["classes"] as! [[String: Any]]
        var capacity: Int?
        if sport == "rowing", let key = c["rowingBoatClass"] as? String, let code = rowing[key],
           c["boatClassSystem"] is NSNull, c["outriggerBoatClassCode"] is NSNull {
            capacity = Int(String(code.prefix(1)))
        } else if sport == "vaa", c["rowingBoatClass"] is NSNull,
                  let item = classes.first(where: { ($0["system"] as? String) == (c["boatClassSystem"] as? String) && ($0["code"] as? String) == (c["outriggerBoatClassCode"] as? String) }),
                  let count = item["paddlerCapacity"] as? Int, let entered = c["paddlerCapacity"] as? NSNumber,
                  CFGetTypeID(entered) != CFBooleanGetTypeID(), entered.doubleValue == Double(count) {
            capacity = count
        }
        guard let capacity, let placement = c["sensorPlacement"] as? String,
              (catalog["placements"] as! [String]).contains(placement),
              let people = c["participants"] as? [[String: Any]], people.count <= 16,
              let notes = c["notes"] as? String, notes.utf16.count <= 2000 else { throw error("Required recording context is incomplete or invalid") }
        var seats = Set<Int>(), ids = Set<String>()
        for person in people {
            guard let id = person["activityParticipantId"] as? String, !id.isEmpty, ids.insert(id).inserted,
                  person["personId"] is NSNull, let name = person["displayName"] as? String, name.utf16.count <= 100 else { throw error("Invalid participant") }
            if let seat = person["crewSeatNumber"] as? NSNumber {
                let number = seat.intValue
                guard CFGetTypeID(seat) != CFBooleanGetTypeID(), seat.doubleValue == Double(number), (1...capacity).contains(number), seats.insert(number).inserted else { throw error("Invalid or duplicate seat") }
            } else if !(person["crewSeatNumber"] is NSNull) || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { throw error("Invalid participant") }
        }
    }
    static func save(_ folder: URL, json: String, finalize: Bool) throws -> [String: Any] {
        guard json.utf8.count <= 65536, let input = try JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else { throw error("Invalid context payload") }
        var result = try read(folder)
        guard result["contextCompleteness"] as? String != "complete" else { throw error("Package already finalized") }
        guard input["recordingId"] as? String == result["recordingId"] as? String else { throw error("Recording identity mismatch") }
        guard result["captureStatus"] as? String != "recording" else { throw error("Stop recording before completing context") }
        for key in ["sportDiscipline", "rowingBoatClass", "boatClassSystem", "outriggerBoatClassCode", "originalBoatClassCode", "paddlerCapacity", "sensorPlacement", "participants", "notes"] {
            result[key] = input[key] ?? NSNull()
        }
        if finalize {
            try validate(result)
            guard let start = result["startedAt"] as? String, let end = result["endedAt"] as? String,
                  let startDate = parseDate(start), let endDate = parseDate(end), endDate >= startDate else { throw error("Recording time bounds are unavailable") }
            result["finalizedAt"] = ISO8601DateFormatter().string(from: Date())
        }
        result["placementProvenance"] = (result["sensorPlacement"] as? String).map { $0 == "unknown" ? "unknown" : "user_declared" } ?? "unknown"
        result["contextCompleteness"] = finalize ? "complete" : "needs_required_context"
        result["contextSource"] = "recorder_operator"
        result["analysisEligibility"] = "not_evaluated"
        try write(result, folder: folder)
        return result
    }
    static func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    static func requireComplete(_ folder: URL) throws {
        let c = try read(folder)
        guard c["captureStatus"] as? String != "recording", c["contextCompleteness"] as? String == "complete" else { throw error("Complete recording details before exporting the finalized package") }
        try validate(c)
    }
}
