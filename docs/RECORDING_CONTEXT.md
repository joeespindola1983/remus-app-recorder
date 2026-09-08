# Recorder post-capture context — implementation contract

Version: 1.0.0 · Dictionary: 1.7.0 · Date: 2026-09-07

This is the local React Native recorder contract, not the deployed Remus platform database or intake API. Canonical authority is the sibling remus-app workspace: docs/DATA_DICTIONARY.md, docs/DATA_INGESTION_AND_ENRICHMENT.md, docs/DATA_MODEL_AND_FLOW.md and contracts/terminology/. Read the applicable domain extension before changing a concept.

## Flow and storage

Native capture writes manifest.json and the existing sensor SQLite database first. It also creates recording-context.json with stable recordingId (the native manifest id), a separate local activityId, and needs_required_context. Stopping commits the sensor writer before opening the context form. Navigation does not own the native recorder.

The form requires sportDiscipline, a sport-compatible boat class and an explicit sensorPlacement choice. Rowing stores single_sculls, double_sculls, etc.; Va'a stores boatClassSystem plus outriggerBoatClassCode and catalog paddlerCapacity. Display codes are not identifiers. V, IVF V, OC and W remain separate systems. Only registered classes are selectable in this version; unsupported classes can remain drafts.

sensorPlacement describes this phone's source, not every recording in the ZIP. It never overwrites Watch mounting or turns oar/paddle motion into hull motion. An explicit unknown is allowed; completeness does not authorize placement-dependent analysis. No athlete is inferred from the person operating the phone.

Draft edits are debounced, serialized and atomically persisted. Closing saves the current draft. The recordings list offers completion later, including for legacy recordings without a sidecar. Legacy originals are not rewritten or backfilled with invented facts. Dates come from the native manifest; the capture device supplies timeZoneId at capture start. Legacy timezone is null/unavailable, never inferred from the current timezone.

## Sidecar fields

| Fields | Meaning |
|---|---|
| schemaVersion, dictionaryVersion | Versioned local context format and terminology snapshot |
| recordingId, activityId, ingestionChannel | Native recording reference, local activity correlation and native_capture origin |
| contextCompleteness | needs_required_context or complete; independent of native captureStatus |
| sportDiscipline, rowingBoatClass | rowing/vaa; rowing taxonomy or null |
| boatClassSystem, outriggerBoatClassCode, paddlerCapacity | Catalog-qualified canoe class and capacity, otherwise null |
| originalBoatClassCode | Selected display code; not an additional class identity |
| sensorPlacement, placementProvenance | Explicit operator declaration or unknown; phone source only |
| startedAt, endedAt, timeZoneId, timeZoneProvenance | Native bounds and attributed timezone; completed packages require valid ordered bounds |
| participants | Optional activityParticipantId, null personId, displayName, nullable crewSeatNumber |
| seatNumberingConvention | source_declared; no automatic bow/stern interpretation |
| notes, contextSource, finalizedAt | Optional operator text, recorder_operator provenance and finalization time |
| sourceManifestFilename, databaseFilename | References to original local evidence |
| producerPlatform, deviceModel, systemVersion, targetSamplingRateHertz | Attributed native producer metadata, not observed performance |
| analysisEligibility | not_evaluated; no engine admission or research permission implied |

Guests do not require accounts. A participant row requires a name or a seat; unnamed occupied seats are valid. Numbered seats must be integral, within rower/paddler capacity and unique. Coxswains may be named with no numbered rower seat; role classification, registered-person linking, temporal substitutions and crew/team management are not implemented. Up to 16 optional participant rows are supported. Empty lineups remain source-level/unattributed, not individual performance evidence.

## Export and synchronization

Normal ZIP export/share and cloud synchronization require complete context. Both native platforms validate independently of the UI; Android always rebuilds the shared ZIP to avoid a stale pre-context archive. The sidecar joins the original manifest, SQLite and existing Watch artifacts. Finalized context is read-only in this version; corrections require a future revisioned contract, not silent replacement.

The native exportRawSessionZip bridge preserves an escape hatch for stopped, incomplete evidence; it is not currently exposed as a share action. Originals remain local and completing context never deletes them.

**Known backend limitation:** the existing sync-check uses recording IDs, not content hashes or context revisions. This client therefore defers draft upload; it does not implement the blueprint's integrity-protecting draft cloud backup. Legacy IDs already on the server may be skipped even after local enrichment: use a manual finalized ZIP export until backend revision support exists. HTTP upload success is not verified server custody and never triggers local deletion.

Names and routes in exported packages are personal data. Users must share only within their authority. This update does not grant access rights, consent or research eligibility.

## Compatibility and remaining work

The raw manifest/SQLite producer schemas stay unchanged. telemetryContract.ts translates legacy live-event names to canonical product identifiers, converts speed/wind km/h to m/s, preserves null vs zero and exposes one nullable XYZ rotationRateRadiansPerSecond vector. Display conversions do not change stored units. iOS now forwards all three native gyro axes independently of GPS updates. Legacy UI-only acceleration magnitude is not the canonical linearAccelerationG vector.

This is not full platform conformance: authenticated actor/access scope, artifact hashes and verified custody, multi-recording activity association, Watch correlation propagation, measured-target identity/clock qualification, revisioned enrichment, imports, hardware adapters and C++ admission remain separate work. No hull analysis, individual attribution or research admission follows merely from completing this form.

## Verification

Run npm test. The context tests transpile and exercise actual TypeScript modules, including class validation, nullable telemetry, native-stop failure retention and sync gates. Native catalogs are checked against the JS snapshot. Swift persistence checks: swiftc ios/RemusTelemetry/Models/RecordingContextStore.swift tests/RecordingContextStoreTests.swift -o /tmp/remus-context-tests then execute that binary.

Device acceptance still requires recording, stopping, leaving/reopening a draft (including process restart), finalizing rowing and OC/V samples, sharing the ZIP and checking sidecar plus intact SQLite/Watch evidence. Test low storage and permission failures separately.
