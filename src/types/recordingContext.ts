import catalog from '../contracts/intake-catalog.json';

export type ContextCompleteness = 'needs_required_context' | 'complete' | 'needs_review';
export interface Participant {
  activityParticipantId: string;
  personId: null;
  displayName: string;
  crewSeatNumber: number | null;
}
export interface RecordingContext {
  schemaVersion: '1.0.0';
  dictionaryVersion: string;
  recordingId: string;
  activityId: string;
  ingestionChannel: 'native_capture';
  contextCompleteness: ContextCompleteness;
  sportDiscipline: 'rowing' | 'vaa' | null;
  rowingBoatClass: string | null;
  boatClassSystem: string | null;
  outriggerBoatClassCode: string | null;
  originalBoatClassCode: string | null;
  paddlerCapacity: number | null;
  sensorPlacement: string | null;
  placementProvenance: 'user_declared' | 'unknown';
  startedAt: string;
  endedAt: string | null;
  timeZoneId: string | null;
  timeZoneProvenance: 'capture_device' | 'unavailable';
  participants: Participant[];
  seatNumberingConvention: 'source_declared';
  notes: string;
  finalizedAt?: string;
  sessionTitle?: string | null;
}

export { catalog };
export function boatCapacity(context: RecordingContext): number | null {
  if (context.sportDiscipline === 'rowing') {
    const code = (catalog.rowingBoatClasses as Record<string, string>)[context.rowingBoatClass || ''];
    return code ? Number(code[0]) : null;
  }
  return catalog.classes.find(c => c.system === context.boatClassSystem && c.code === context.outriggerBoatClassCode)?.paddlerCapacity ?? null;
}

// Validate the actual domain object used by the UI and bridge, not a second test-only model.
export function contextErrors(context: RecordingContext): string[] {
  const errors: string[] = [];
  if (!['rowing', 'vaa'].includes(context.sportDiscipline || '')) errors.push('sportDiscipline');
  if (context.sportDiscipline === 'rowing' && (!Object.prototype.hasOwnProperty.call(catalog.rowingBoatClasses, context.rowingBoatClass || '') || context.boatClassSystem !== null || context.outriggerBoatClassCode !== null)) errors.push('boatClass');
  if (context.sportDiscipline === 'vaa' && (context.rowingBoatClass !== null || !catalog.classes.some(c => c.system === context.boatClassSystem && c.code === context.outriggerBoatClassCode && c.paddlerCapacity === context.paddlerCapacity))) errors.push('boatClass');
  if (!context.sensorPlacement || !catalog.placements.includes(context.sensorPlacement)) errors.push('sensorPlacement');
  if (context.notes.length > 2000) errors.push('notes');
  const capacity = boatCapacity(context);
  const occupied = new Set<number>();
  const identities = new Set<string>();
  if (context.participants.length > 16) errors.push('participants');
  for (const person of context.participants) {
    if (!person.activityParticipantId || identities.has(person.activityParticipantId) || person.personId !== null || person.displayName.length > 100 || (!person.displayName.trim() && person.crewSeatNumber === null)) errors.push('participants');
    identities.add(person.activityParticipantId);
    if (person.crewSeatNumber !== null) {
      if (!Number.isInteger(person.crewSeatNumber) || !capacity || person.crewSeatNumber < 1 || person.crewSeatNumber > capacity || occupied.has(person.crewSeatNumber)) errors.push('participants');
      occupied.add(person.crewSeatNumber);
    }
  }
  return [...new Set(errors)];
}

export function prepareContext(context: RecordingContext, finalize: boolean): RecordingContext {
  const result = { ...context, notes: context.notes.trim(), participants: context.participants.map(p => ({...p, displayName: p.displayName.trim()})) };
  if (finalize && contextErrors(result).length) throw new Error('Required recording context is incomplete or invalid');
  result.contextCompleteness = finalize ? 'complete' : 'needs_required_context';
  result.placementProvenance = result.sensorPlacement && result.sensorPlacement !== 'unknown' ? 'user_declared' : 'unknown';
  return result;
}
