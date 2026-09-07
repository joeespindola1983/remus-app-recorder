import Foundation
@main struct ContextTests {
 static func main() throws {
  let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
  defer { try? FileManager.default.removeItem(at: folder) }
  let manifest: [String: Any] = ["id": UUID().uuidString, "startedAt":"2026-09-07T12:00:00Z", "endedAt":"2026-09-07T12:01:00.000Z", "status":"completed"]
  let original = try JSONSerialization.data(withJSONObject: manifest)
  try original.write(to: folder.appendingPathComponent("manifest.json"))
  try Data([1,2,3]).write(to: folder.appendingPathComponent("telemetry.sqlite"))
  var context = try RecordingContextStore.read(folder)
  let identity = context["activityId"] as! String
  func json(_ c: [String:Any]) throws -> String {String(decoding:try JSONSerialization.data(withJSONObject:c),as:UTF8.self)}
  do { try RecordingContextStore.requireComplete(folder); fatalError("draft exported") } catch {}
  context["sportDiscipline"] = "rowing"; context["rowingBoatClass"] = "single_sculls"; context["sensorPlacement"] = "hull"
  _ = try RecordingContextStore.save(folder, json: json(context), finalize: false)
  let reloaded = try RecordingContextStore.read(folder)
  assert(reloaded["activityId"] as! String == identity)
  var invalid = context; invalid["rowingBoatClass"] = "x1"
  do { _ = try RecordingContextStore.save(folder, json:json(invalid), finalize:true); fatalError("invalid class accepted") } catch {}
  let complete = try RecordingContextStore.save(folder, json:json(context), finalize:true)
  assert(complete["contextCompleteness"] as? String == "complete")
  try RecordingContextStore.requireComplete(folder)
  let preservedManifest = try Data(contentsOf:folder.appendingPathComponent("manifest.json"))
  assert(preservedManifest == original)
  do { _ = try RecordingContextStore.save(folder, json:json(context), finalize:false); fatalError("finalized package modified") } catch {}
  for item in RecordingContextStore.catalog["classes"] as! [[String:Any]] {
    var c = context; c["sportDiscipline"]="vaa"; c["rowingBoatClass"]=NSNull(); c["boatClassSystem"]=item["system"]; c["outriggerBoatClassCode"]=item["code"]; c["paddlerCapacity"]=item["paddlerCapacity"]
    try RecordingContextStore.validate(c)
  }
  print("Swift context persistence, draft/export gates, all Va'a classes, immutable originals/finalized context: passed")
 }
}
