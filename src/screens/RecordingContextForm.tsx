import React, { useEffect, useRef, useState } from 'react';
import { Modal, SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { RecordingContext, catalog, prepareContext, contextErrors } from '../types/recordingContext';
import { telemetryBridge } from '../services/telemetryBridge';
import { t } from '../i18n';

export function RecordingContextForm({ recordingId, onClose }: {recordingId: string; onClose: () => void}) {
  const [context, setContext] = useState<RecordingContext | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const draft = useRef<RecordingContext | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    mounted.current = true;
    telemetryBridge.getRecordingContext(recordingId).then(value => {
      if (mounted.current) { draft.current = value; setContext(value); }
    }).catch(() => { if (mounted.current) setLoadError(true); });
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (draft.current && draft.current.contextCompleteness !== 'complete') enqueue(draft.current, false).catch(() => {});
    };
  }, [recordingId]);

  function enqueue(value: RecordingContext, finalize: boolean) {
    const next = writes.current.catch(() => {}).then(() => telemetryBridge.saveRecordingContext(value, finalize));
    writes.current = next;
    return next;
  }
  function change(patch: Partial<RecordingContext>) {
    if (!draft.current) return;
    const next = {...draft.current, ...patch};
    draft.current = next; setContext(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      enqueue(next, false).then(() => { if (mounted.current) setSaveError(false); })
        .catch(() => { if (mounted.current) setSaveError(true); });
    }, 400);
  }
  async function finish(finalize: boolean) {
    if (busy) return;
    if (!draft.current || draft.current.contextCompleteness === 'complete') { draft.current = null; onClose(); return; }
    if (finalize && contextErrors(draft.current).length) {
      Alert.alert(t('context.title'), t('context.invalid')); return;
    }
    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      await enqueue(prepareContext(draft.current, finalize), finalize);
      draft.current = null;
      onClose();
    } catch {
      Alert.alert(t('common.error'), t('context.saveError'));
    } finally { if (mounted.current) setBusy(false); }
  }
  const choice = (label: string, selected: boolean, action: () => void) => (
    <TouchableOpacity key={label} accessibilityRole="button" accessibilityState={{selected, disabled: busy}}
      disabled={busy} onPress={action} style={[styles.choice, selected && styles.selected]}>
      <Text style={styles.text}>{label}</Text>
    </TouchableOpacity>
  );
  const readonly = context?.contextCompleteness === 'complete';
  return <Modal visible animationType="slide" onRequestClose={() => finish(false)}>
    <SafeAreaView style={styles.root}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('context.title')}</Text>
        <Text style={styles.hint}>{t('context.savedCapture')}</Text>
        {!context && !loadError && <ActivityIndicator />}
        {loadError && <Text style={styles.error}>{t('context.loadError')}</Text>}
        {context && !readonly && <>
          <Text style={styles.label}>{t('context.sport')}</Text>
          <View style={styles.row}>
            {choice(t('context.rowing'), context.sportDiscipline === 'rowing', () => change({sportDiscipline: 'rowing', rowingBoatClass: null, boatClassSystem: null, outriggerBoatClassCode: null, originalBoatClassCode: null, paddlerCapacity: null}))}
            {choice(t('context.vaa'), context.sportDiscipline === 'vaa', () => change({sportDiscipline: 'vaa', rowingBoatClass: null, boatClassSystem: null, outriggerBoatClassCode: null, originalBoatClassCode: null, paddlerCapacity: null}))}
          </View>
          {context.sportDiscipline === 'rowing' && <>
            <Text style={styles.label}>{t('context.boat')}</Text>
            <View style={styles.row}>{Object.entries(catalog.rowingBoatClasses).map(([key, code]) =>
              choice(code, context.rowingBoatClass === key, () => change({rowingBoatClass: key, originalBoatClassCode: code})))}</View>
          </>}
          {context.sportDiscipline === 'vaa' && <>
            <Text style={styles.label}>{t('context.system')}</Text>
            <View style={styles.row}>{['outrigger_oc', 'vaa_v', 'ivf_v', 'waka_ama_w'].map(system =>
              choice(({outrigger_oc: 'OC', vaa_v: 'V', ivf_v: 'V (IVF)', waka_ama_w: 'W (Waka Ama)'} as Record<string,string>)[system],
                context.boatClassSystem === system, () => change({boatClassSystem: system, outriggerBoatClassCode: null, originalBoatClassCode: null, paddlerCapacity: null})))}</View>
            <Text style={styles.label}>{t('context.boat')}</Text>
            <View style={styles.row}>{catalog.classes.filter(c => c.system === context.boatClassSystem).map(c =>
              choice(c.code.toUpperCase(), context.outriggerBoatClassCode === c.code, () => change({outriggerBoatClassCode: c.code, originalBoatClassCode: c.code.toUpperCase(), paddlerCapacity: c.paddlerCapacity})))}</View>
          </>}
          <Text style={styles.label}>{t('context.placement')}</Text>
          <Text style={styles.hint}>{t('context.placementHint')}</Text>
          <View style={styles.row}>{catalog.placements.map(placement =>
            choice(t(('placement.' + placement) as any), context.sensorPlacement === placement, () => change({sensorPlacement: placement})))}</View>
          {context.sensorPlacement === 'unknown' && <Text style={styles.hint}>{t('context.unknownHint')}</Text>}
          <Text style={styles.label}>{t('context.people')}</Text>
          <Text style={styles.hint}>{t('context.peopleHint')}</Text>
          {context.participants.map((person, index) => <View key={person.activityParticipantId} style={styles.person}>
            <TextInput accessibilityLabel={t('context.name')} placeholder={t('context.name')} placeholderTextColor="#94A3B8"
              editable={!busy} maxLength={100} value={person.displayName} style={styles.input}
              onChangeText={displayName => change({participants: context.participants.map((p, i) => i === index ? {...p, displayName} : p)})}/>
            <TextInput accessibilityLabel={t('context.seat')} placeholder={t('context.seat')} placeholderTextColor="#94A3B8"
              keyboardType="number-pad" editable={!busy} maxLength={2} value={person.crewSeatNumber === null ? '' : String(person.crewSeatNumber)} style={styles.input}
              onChangeText={value => { if (/^\d*$/.test(value)) change({participants: context.participants.map((p, i) => i === index ? {...p, crewSeatNumber: value ? Number(value) : null} : p)}); }}/>
            {choice(t('context.remove'), false, () => change({participants: context.participants.filter((_, i) => i !== index)}))}
          </View>)}
          {context.participants.length < 16 && choice(t('context.addPerson'), false, () => change({participants: [...context.participants, {
            activityParticipantId: context.activityId + ':participant:' + Date.now().toString(36) + ':' + Math.random().toString(36).slice(2),
            personId: null, displayName: '', crewSeatNumber: null
          }]}))}
          <Text style={styles.label}>{t('recording.notes')}</Text>
          <TextInput accessibilityLabel={t('recording.notes')} multiline maxLength={2000} editable={!busy} style={styles.input} value={context.notes}
            onChangeText={notes => change({notes})}/>
          {saveError && <Text style={styles.error}>{t('context.saveError')}</Text>}
          {choice(busy ? t('context.saving') : t('context.finalize'), true, () => finish(true))}
        </>}
        {readonly && <Text style={styles.label}>{t('context.complete')}</Text>}
        {choice(t('context.later'), false, () => finish(false))}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#0F172A'},
  content: {padding: 20, gap: 12},
  title: {fontSize: 24, fontWeight: '700', color: '#F8FAFC'},
  label: {fontSize: 17, fontWeight: '600', color: '#F8FAFC', marginTop: 12},
  hint: {fontSize: 14, color: '#CBD5E1'},
  text: {color: '#F8FAFC', fontSize: 15},
  error: {color: '#FDA4AF'},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  choice: {padding: 14, borderRadius: 8, borderWidth: 1, borderColor: '#475569', backgroundColor: '#1E293B'},
  selected: {backgroundColor: '#0369A1', borderColor: '#38BDF8'},
  input: {color: '#F8FAFC', backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#475569', borderRadius: 8, padding: 12, minHeight: 48},
  person: {gap: 6, borderBottomWidth: 1, borderBottomColor: '#475569', paddingBottom: 12}
});
