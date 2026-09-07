const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');

function loadActual(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const compiled = babel.transformFileSync(filename, {configFile: false, babelrc: false, presets: [require.resolve('@react-native/babel-preset')]}).code;
  const mod = new Module(filename, module);
  mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = mod.require.bind(mod);
  mod.require = name => Object.hasOwn(mocks, name) ? mocks[name] : originalRequire(name);
  mod._compile(compiled, filename);
  return mod.exports;
}
const {contextErrors, prepareContext, catalog} = loadActual('src/types/recordingContext.ts');
const valid = () => ({recordingId:'test', activityId:'activity', sportDiscipline:'rowing', rowingBoatClass:'single_sculls', boatClassSystem:null, outriggerBoatClassCode:null, paddlerCapacity:null, sensorPlacement:'unknown', notes:'', participants:[], contextCompleteness:'needs_required_context'});
test('native platforms use the exact same versioned intake catalog as the product', () => {
  const swift = fs.readFileSync(path.resolve(__dirname, '../ios/RemusTelemetry/Models/RecordingContextStore.swift'), 'utf8');
  const kotlin = fs.readFileSync(path.resolve(__dirname, '../android/app/src/main/java/com/remus/telemetry/RecordingContextStore.kt'), 'utf8');
  assert.deepEqual(JSON.parse(swift.match(/Data\(#"(\{.*\})"#\.utf8\)/)[1]), catalog);
  assert.deepEqual(JSON.parse(kotlin.match(/JSONObject\("""(\{.*\})"""\)/)[1]), catalog);
});
test('telemetry boundary converts units, preserves zero and rejects incomplete rotation vectors', () => {
  const {normalizeTelemetryEvent: convert} = loadActual('src/services/telemetryAdapter.ts');
  assert.deepEqual(convert({speedKmh:36,weatherWindKmh:18,headingDegrees:0}), {groundSpeedMetersPerSecond:10,windSpeedMetersPerSecond:5,headingDegrees:0});
  assert.equal(convert({headingDegrees:null}).headingDegrees,null);
  assert.deepEqual(convert({rotationXRad:0,rotationYRad:1,rotationZRad:2}).rotationRateRadiansPerSecond,{x:0,y:1,z:2});
  assert.equal(convert({rotationXRad:0,rotationYRad:null,rotationZRad:2}).rotationRateRadiansPerSecond,null);
  assert.deepEqual(convert({weatherStatus:'Updated'}),{weatherStatus:'Updated'});
});
test('finalization requires explicit sport, class and placement; unknown is an explicit choice', () => {
  for (const key of ['sportDiscipline','rowingBoatClass','sensorPlacement']) {
    assert.throws(() => prepareContext({...valid(), [key]:null}, true));
  }
  assert.equal(prepareContext(valid(), true).contextCompleteness, 'complete');
  assert.equal(prepareContext({...valid(), sportDiscipline:null}, false).contextCompleteness, 'needs_required_context');
});
test('all catalog classes are usable, systems stay distinct, aliases never leak to output', () => {
  for (const rowingBoatClass of Object.keys(catalog.rowingBoatClasses)) assert.deepEqual(contextErrors({...valid(), rowingBoatClass}), []);
  for (const c of catalog.classes) assert.deepEqual(contextErrors({...valid(), sportDiscipline:'vaa', rowingBoatClass:null, boatClassSystem:c.system, outriggerBoatClassCode:c.code, paddlerCapacity:c.paddlerCapacity}), []);
  assert.ok(contextErrors({...valid(), rowingBoatClass:'x1'}).length);
  assert.ok(contextErrors({...valid(), sportDiscipline:'vaa', rowingBoatClass:null, boatClassSystem:'ivf_v', outriggerBoatClassCode:'oc1', paddlerCapacity:1}).length);
});
test('optional guests need no account; duplicate, fractional and out-of-capacity seats are rejected', () => {
  const guest = {activityParticipantId:'guest',personId:null,displayName:'Ana',crewSeatNumber:1};
  assert.deepEqual(contextErrors({...valid(),participants:[guest]}), []);
  for (const seat of [0,2,1.5]) assert.ok(contextErrors({...valid(),participants:[{...guest,crewSeatNumber:seat}]}).length);
  assert.ok(contextErrors({...valid(),participants:[guest,{...guest,activityParticipantId:'other'}]}).length);
  assert.deepEqual(contextErrors({...valid(),participants:[{...guest,displayName:'',crewSeatNumber:1}]}), []);
});
test('cloud sync never uploads drafts to the ID-only backend', async () => {
  const {SyncService} = loadActual('src/services/syncService.ts', {'./telemetryBridge':{telemetryBridge:{}}});
  const requests = [], exported = [];
  const service = new SyncService({bridge:{exportSessionZip:async id => {exported.push(id); return '/tmp/'+id+'.zip';}}, fetchFn:async (url, init) => {requests.push(JSON.parse(init.body));return {ok:true,json:async()=>({requiredSessionIds:['ready']})};}});
  service.uploadSession = async () => true;
  const report = await service.syncSessions([{id:'draft'},{id:'ready',contextCompleteness:'complete'}]);
  assert.deepEqual(requests[0].sessionIds,['ready']); assert.deepEqual(exported,['ready']); assert.equal(report.skippedCount,1);
});
test('a native stop failure does not discard the JS active recording state', async () => {
  const {SessionManager} = loadActual('src/services/sessionManager.ts');
  const manager = new SessionManager({startRecording:async()=>({sessionId:'r'}),stopRecording:async()=>{throw Error('disk');}});
  await manager.start({}); await assert.rejects(manager.stop()); assert.equal(manager.isRecording(),true);
});
