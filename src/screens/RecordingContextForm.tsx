import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
  Alert,
  ActivityIndicator
} from 'react-native';
import {
  RecordingContext,
  prepareContext,
  contextErrors,
  boatCapacity,
  Participant
} from '../types/recordingContext';
import { telemetryBridge } from '../services/telemetryBridge';
import { t } from '../i18n';

type WizardStep = 'sport' | 'boat' | 'placement' | 'crew' | 'review' | 'success';

interface RowingBoatOption {
  code: string;
  classKey: string;
  capacity: number;
  label: string;
  detail: string;
}

interface VaaBoatOption {
  code: string;
  system: string;
  boatClassCode: string;
  capacity: number;
  label: string;
  detail: string;
}

const ROWING_BOATS: RowingBoatOption[] = [
  { code: '1x', classKey: 'single_sculls', capacity: 1, label: '1x (Single)', detail: '1 atleta' },
  { code: '2x', classKey: 'double_sculls', capacity: 2, label: '2x (Double / Pair)', detail: '2 atletas' },
  { code: '4x', classKey: 'quadruple_sculls', capacity: 4, label: '4x (Quad / Four)', detail: '4 atletas · sem timoneiro' },
  { code: '8+', classKey: 'eight', capacity: 8, label: '8+ (Eight)', detail: '8 atletas · com timoneiro' },
];

const VAA_BOATS: VaaBoatOption[] = [
  { code: 'OC1', system: 'outrigger_oc', boatClassCode: 'oc1', capacity: 1, label: 'OC1 / V1', detail: 'Individual · 1 atleta' },
  { code: 'OC2', system: 'outrigger_oc', boatClassCode: 'oc2', capacity: 2, label: 'OC2 / V2', detail: 'Dupla · 2 atletas' },
  { code: 'OC3', system: 'outrigger_oc', boatClassCode: 'oc3', capacity: 3, label: 'OC3 / V3', detail: 'Trio · 3 atletas' },
  { code: 'OC6', system: 'outrigger_oc', boatClassCode: 'oc6', capacity: 6, label: 'OC6 / V6', detail: 'Equipe · 6 atletas' },
  { code: 'V12', system: 'vaa_v', boatClassCode: 'v12', capacity: 12, label: 'V12', detail: 'Catamarã · 12 atletas' },
];

const PLACEMENT_OPTIONS = [
  { key: 'hull', icon: '⛵', labelKey: 'placement.hull' },
  { key: 'left_wrist', icon: '⌚', labelKey: 'placement.left_wrist' },
  { key: 'right_wrist', icon: '⌚', labelKey: 'placement.right_wrist' },
  { key: 'body', icon: '👤', labelKey: 'placement.body' },
  { key: 'oar', icon: '🛶', labelKey: 'placement.oar' },
  { key: 'unknown', icon: '❓', labelKey: 'placement.unknown' },
];

export function RecordingContextForm({
  recordingId,
  isSprint,
  onClose
}: {
  recordingId: string;
  isSprint?: boolean;
  onClose: () => void;
}) {
  const [context, setContext] = useState<RecordingContext | null>(null);
  const [step, setStep] = useState<WizardStep>('sport');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [crewNames, setCrewNames] = useState<Record<number, string>>({});

  const draft = useRef<RecordingContext | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    telemetryBridge
      .getRecordingContext(recordingId)
      .then(value => {
        if (!mounted.current) return;
        draft.current = value;
        setContext(value);

        // Prepopulate existing participants into seat mapping
        const names: Record<number, string> = {};
        if (value.participants) {
          for (const p of value.participants) {
            if (p.crewSeatNumber) {
              names[p.crewSeatNumber] = p.displayName || '';
            }
          }
        }
        setCrewNames(names);

        // If it's already complete, show review/readonly
        if (value.contextCompleteness === 'complete') {
          setStep('review');
        } else if (!value.sportDiscipline) {
          setStep('sport');
        } else if (!value.rowingBoatClass && !value.outriggerBoatClassCode) {
          setStep('boat');
        } else if (!value.sensorPlacement || value.sensorPlacement === 'unknown') {
          setStep('placement');
        } else {
          setStep('crew');
        }
      })
      .catch(() => {
        if (mounted.current) setLoadError(true);
      });

    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (draft.current && draft.current.contextCompleteness !== 'complete') {
        enqueue(draft.current, false).catch(() => {});
      }
    };
  }, [recordingId]);

  function enqueue(value: RecordingContext, finalize: boolean) {
    const next = writes.current
      .catch(() => {})
      .then(() => telemetryBridge.saveRecordingContext(value, finalize));
    writes.current = next;
    return next;
  }

  function change(patch: Partial<RecordingContext>) {
    if (!draft.current) return;
    const next = { ...draft.current, ...patch };
    draft.current = next;
    setContext(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      enqueue(next, false).catch(() => {});
    }, 400);
  }

  function handleSelectSport(sport: 'rowing' | 'vaa') {
    change({
      sportDiscipline: sport,
      rowingBoatClass: null,
      boatClassSystem: null,
      outriggerBoatClassCode: null,
      originalBoatClassCode: null,
      paddlerCapacity: null
    });
    setStep('boat');
  }

  function handleSelectRowingBoat(boat: RowingBoatOption) {
    change({
      rowingBoatClass: boat.classKey,
      boatClassSystem: null,
      outriggerBoatClassCode: null,
      originalBoatClassCode: boat.code,
      paddlerCapacity: null
    });
    setStep('placement');
  }

  function handleSelectVaaBoat(boat: VaaBoatOption) {
    change({
      rowingBoatClass: null,
      boatClassSystem: boat.system,
      outriggerBoatClassCode: boat.boatClassCode,
      originalBoatClassCode: boat.code,
      paddlerCapacity: boat.capacity
    });
    setStep('placement');
  }

  function handleSelectPlacement(placement: string) {
    if (isSprint) {
      change({ sensorPlacement: placement, participants: [] });
      setStep('review');
    } else {
      change({ sensorPlacement: placement });
      setStep('crew');
    }
  }

  function buildParticipantsFromSeats(names: Record<number, string>): Participant[] {
    if (!context) return [];
    const capacity = boatCapacity(context) || 1;
    const list: Participant[] = [];
    for (let seat = 1; seat <= capacity; seat++) {
      const name = (names[seat] || '').trim();
      if (name) {
        list.push({
          activityParticipantId: `${context.activityId}:participant:seat-${seat}`,
          personId: null,
          displayName: name,
          crewSeatNumber: seat
        });
      }
    }
    return list;
  }

  function handleSaveCrewAndContinue() {
    const participants = buildParticipantsFromSeats(crewNames);
    change({ participants });
    setStep('review');
  }

  function handleSkipCrew() {
    change({ participants: [] });
    setStep('review');
  }

  async function finish(finalize: boolean) {
    if (busy) return;
    if (!draft.current) {
      onClose();
      return;
    }
    if (!finalize) {
      draft.current = null;
      onClose();
      return;
    }

    // Prepare participants from crewNames before final validation
    const participants = buildParticipantsFromSeats(crewNames);
    const candidate = {
      ...draft.current,
      participants
    };

    const errors = contextErrors(candidate);
    if (errors.length > 0) {
      Alert.alert(t('context.title'), t('context.invalid'));
      return;
    }

    setBusy(true);
    if (timer.current) clearTimeout(timer.current);
    try {
      
      // Generate sessionTitle
      let sprintInfo = null;
      try {
        if (candidate.notes && candidate.notes.startsWith('{')) {
          sprintInfo = JSON.parse(candidate.notes);
        }
      } catch(e) {}

      const boat = candidate.rowingBoatClass || candidate.outriggerBoatClassCode || 'Barco';
      const dateObj = new Date(candidate.startedAt);
      
      const weekdays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
      const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
      
      if (sprintInfo && sprintInfo.mode !== 'free') {
        const dist = sprintInfo.targetDistance;
        const durationSecs = Math.round((Date.now() - dateObj.getTime()) / 1000);
        const m = Math.floor(durationSecs / 60);
        const s = durationSecs % 60;
        const timeStr = `${dateObj.getHours().toString().padStart(2,'0')}:${dateObj.getMinutes().toString().padStart(2,'0')}:${dateObj.getSeconds().toString().padStart(2,'0')}`;
        const dateStr = `${dateObj.getDate().toString().padStart(2,'0')}/${(dateObj.getMonth()+1).toString().padStart(2,'0')}/${dateObj.getFullYear()}`;
        candidate.sessionTitle = `Tiro de ${dist}m - ${m}m ${s} segundos (total do tiro) - ${timeStr} ${dateStr}`;
      } else {
        candidate.sessionTitle = `Treino ${boat} - ${weekdays[dateObj.getDay()]}, ${dateObj.getDate()} de ${months[dateObj.getMonth()]} de ${dateObj.getFullYear()}`;
      }

      const prepared = prepareContext(candidate, true);

      await enqueue(prepared, true);
      draft.current = null;
      setStep('success');
    } catch {
      Alert.alert(t('common.error'), t('context.saveError'));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const capacity = context ? boatCapacity(context) || 1 : 1;
  const isReadOnly = context?.contextCompleteness === 'complete';

  // Wizard step indices
  const stepOrder: WizardStep[] = ['sport', 'boat', 'placement', 'crew', 'review'];
  const currentStepIdx = stepOrder.indexOf(step) + 1;
  const totalSteps = stepOrder.length;

  return (
    <Modal visible animationType="slide" onRequestClose={() => finish(false)}>
      <SafeAreaView style={styles.root}>
        {/* Top Header */}
        <View style={styles.header}>
          {step !== 'sport' && step !== 'success' && !isReadOnly && (
            <TouchableOpacity
              onPress={() => {
                const prevIdx = stepOrder.indexOf(step) - 1;
                if (prevIdx >= 0) setStep(stepOrder[prevIdx]);
              }}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel={t('context.actions.back')}
            >
              <Text style={styles.backButtonText}>← {t('context.actions.back')}</Text>
            </TouchableOpacity>
          )}

          {step !== 'success' && !isReadOnly && currentStepIdx > 0 && (
            <Text style={styles.stepIndicator}>
              {t('context.step.progress', { current: currentStepIdx, total: totalSteps })}
            </Text>
          )}

          {step !== 'success' && (
            <TouchableOpacity
              onPress={() => finish(false)}
              style={styles.closeButton}
              accessibilityRole="button"
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {!context && !loadError && (
            <View style={styles.centeredBlock}>
              <ActivityIndicator size="large" color="#38BDF8" />
            </View>
          )}

          {loadError && (
            <View style={styles.centeredBlock}>
              <Text style={styles.errorText}>{t('context.loadError')}</Text>
              <TouchableOpacity
                onPress={() => finish(false)}
                style={[styles.bigButton, styles.primaryButton, { marginTop: 16 }]}
              >
                <Text style={styles.primaryButtonText}>{t('context.later')}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* STEP 1: SPORT SELECTION */}
          {context && step === 'sport' && !isReadOnly && (
            <View style={styles.stepContainer}>
              <Text style={styles.stepTitle}>{t('context.step.sportTitle')}</Text>
              <Text style={styles.stepSubtitle}>{t('context.step.sportSubtitle')}</Text>

              <TouchableOpacity
                style={[
                  styles.cardOption,
                  context.sportDiscipline === 'rowing' && styles.cardOptionSelected
                ]}
                onPress={() => handleSelectSport('rowing')}
                accessibilityRole="button"
              >
                <Text style={styles.cardEmoji}>🚣‍♂️</Text>
                <View style={styles.cardTextContainer}>
                  <Text style={styles.cardTitle}>{t('context.rowing')}</Text>
                  <Text style={styles.cardDetail}>Single, Double, Quad, Eight</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.cardOption,
                  context.sportDiscipline === 'vaa' && styles.cardOptionSelected
                ]}
                onPress={() => handleSelectSport('vaa')}
                accessibilityRole="button"
              >
                <Text style={styles.cardEmoji}>🛶</Text>
                <View style={styles.cardTextContainer}>
                  <Text style={styles.cardTitle}>{t('context.vaa')}</Text>
                  <Text style={styles.cardDetail}>OC1, OC2, OC6, V1, V6, V12</Text>
                </View>
              </TouchableOpacity>
            </View>
          )}

          {/* STEP 2: BOAT SELECTION */}
          {context && step === 'boat' && !isReadOnly && (
            <View style={styles.stepContainer}>
              <Text style={styles.stepTitle}>{t('context.step.boatTitle')}</Text>
              <Text style={styles.stepSubtitle}>{t('context.step.boatSubtitle')}</Text>

              {context.sportDiscipline === 'rowing' && (
                <View style={styles.optionsList}>
                  {ROWING_BOATS.map(b => {
                    const isSelected = context.rowingBoatClass === b.classKey;
                    return (
                      <TouchableOpacity
                        key={b.code}
                        style={[styles.cardOption, isSelected && styles.cardOptionSelected]}
                        onPress={() => handleSelectRowingBoat(b)}
                        accessibilityRole="button"
                      >
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{b.code}</Text>
                        </View>
                        <View style={styles.cardTextContainer}>
                          <Text style={styles.cardTitle}>{b.label}</Text>
                          <Text style={styles.cardDetail}>{b.detail}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {context.sportDiscipline === 'vaa' && (
                <View style={styles.optionsList}>
                  {VAA_BOATS.map(b => {
                    const isSelected = context.outriggerBoatClassCode === b.boatClassCode;
                    return (
                      <TouchableOpacity
                        key={b.code}
                        style={[styles.cardOption, isSelected && styles.cardOptionSelected]}
                        onPress={() => handleSelectVaaBoat(b)}
                        accessibilityRole="button"
                      >
                        <View style={styles.badge}>
                          <Text style={styles.badgeText}>{b.code}</Text>
                        </View>
                        <View style={styles.cardTextContainer}>
                          <Text style={styles.cardTitle}>{b.label}</Text>
                          <Text style={styles.cardDetail}>{b.detail}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          )}

          {/* STEP 3: SENSOR PLACEMENT */}
          {context && step === 'placement' && !isReadOnly && (
            <View style={styles.stepContainer}>
              <Text style={styles.stepTitle}>{t('context.step.placementTitle')}</Text>
              <Text style={styles.stepSubtitle}>{t('context.step.placementSubtitle')}</Text>

              <View style={styles.optionsList}>
                {PLACEMENT_OPTIONS.map(opt => {
                  const isSelected = context.sensorPlacement === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.cardOption, isSelected && styles.cardOptionSelected]}
                      onPress={() => handleSelectPlacement(opt.key)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.cardEmoji}>{opt.icon}</Text>
                      <View style={styles.cardTextContainer}>
                        <Text style={styles.cardTitle}>{t(opt.labelKey as any)}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* STEP 4: CREW MEMBERS (DYNAMIC BY CAPACITY) */}
          {context && step === 'crew' && !isReadOnly && (
            <View style={styles.stepContainer}>
              <Text style={styles.stepTitle}>{t('context.step.crewTitle')}</Text>
              <Text style={styles.stepSubtitle}>{t('context.step.crewSubtitle')}</Text>

              <View style={styles.seatsList}>
                {Array.from({ length: capacity }, (_, i) => i + 1).map(seatNum => {
                  const seatTitle =
                    capacity > 1
                      ? seatNum === 1
                        ? `${t('context.seat.label', { seat: seatNum })} (Voga)`
                        : seatNum === capacity
                        ? `${t('context.seat.label', { seat: seatNum })} (Proa)`
                        : t('context.seat.label', { seat: seatNum })
                      : t('context.seat.label', { seat: seatNum });

                  return (
                    <View key={seatNum} style={styles.seatRow}>
                      <Text style={styles.seatNumberLabel}>{seatTitle}</Text>
                      <TextInput
                        accessibilityLabel={seatTitle}
                        placeholder={t('context.seat.placeholder')}
                        placeholderTextColor="#64748B"
                        editable={!busy}
                        maxLength={100}
                        value={crewNames[seatNum] || ''}
                        style={styles.seatInput}
                        onChangeText={name => {
                          setCrewNames(prev => ({ ...prev, [seatNum]: name }));
                        }}
                      />
                    </View>
                  );
                })}
              </View>

              <View style={styles.actionsFooter}>
                <TouchableOpacity
                  style={[styles.bigButton, styles.primaryButton]}
                  onPress={handleSaveCrewAndContinue}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryButtonText}>{t('context.actions.next')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.bigButton, styles.secondaryButton]}
                  onPress={handleSkipCrew}
                  accessibilityRole="button"
                >
                  <Text style={styles.secondaryButtonText}>{t('context.actions.skip')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* STEP 5: REVIEW & FINALIZE */}
          {context && (step === 'review' || isReadOnly) && (
            <View style={styles.stepContainer}>
              <Text style={styles.stepTitle}>
                {isReadOnly ? t('context.complete') : t('context.step.reviewTitle')}
              </Text>
              <Text style={styles.stepSubtitle}>
                {isReadOnly ? t('context.savedCapture') : t('context.step.reviewSubtitle')}
              </Text>

              {/* Summary Badges */}
              <View style={styles.reviewCard}>
                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Esporte</Text>
                  <Text style={styles.reviewValue}>
                    {context.sportDiscipline === 'rowing' ? '🚣‍♂️ Remo' : '🛶 Va’a'}
                  </Text>
                </View>

                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Barco</Text>
                  <Text style={styles.reviewValue}>
                    {context.originalBoatClassCode || context.rowingBoatClass || '—'}
                  </Text>
                </View>

                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Posição Celular</Text>
                  <Text style={styles.reviewValue}>
                    {t(('placement.' + (context.sensorPlacement || 'unknown')) as any)}
                  </Text>
                </View>

                <View style={styles.reviewRow}>
                  <Text style={styles.reviewLabel}>Remadores</Text>
                  <Text style={styles.reviewValue}>
                    {Object.values(crewNames).filter(n => n && n.trim()).length > 0
                      ? `${Object.values(crewNames).filter(n => n && n.trim()).length} informado(s)`
                      : 'Nenhum atleta atribuído'}
                  </Text>
                </View>
              </View>

              {!isReadOnly && (
                <>
                  <Text style={styles.inputSectionLabel}>{t('recording.notes')}</Text>
                  <TextInput
                    accessibilityLabel={t('recording.notes')}
                    multiline
                    maxLength={2000}
                    editable={!busy}
                    placeholder={t('recording.notesPlaceholder')}
                    placeholderTextColor="#64748B"
                    style={[styles.seatInput, { minHeight: 80 }]}
                    value={context.notes}
                    onChangeText={notes => change({ notes })}
                  />

                  <View style={[styles.actionsFooter, { marginTop: 24 }]}>
                    <TouchableOpacity
                      style={[styles.bigButton, styles.finishButton]}
                      disabled={busy}
                      onPress={() => finish(true)}
                      accessibilityRole="button"
                    >
                      {busy ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.finishButtonText}>
                          ✓ {t('context.actions.finish')}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.bigButton, styles.secondaryButton]}
                      onPress={() => finish(false)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.secondaryButtonText}>{t('context.later')}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {isReadOnly && (
                <View style={[styles.actionsFooter, { marginTop: 24 }]}>
                  <TouchableOpacity
                    style={[styles.bigButton, styles.primaryButton]}
                    onPress={() => finish(false)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.primaryButtonText}>{t('common.confirm')}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* STEP 6: SUCCESS CONFIRMATION */}
          {step === 'success' && (
            <View style={[styles.stepContainer, styles.centeredBlock]}>
              <View style={styles.successIconCircle}>
                <Text style={styles.successIcon}>✓</Text>
              </View>
              <Text style={styles.successTitle}>{t('context.step.successTitle')}</Text>
              <Text style={styles.successSubtitle}>{t('context.step.successSubtitle')}</Text>

              <TouchableOpacity
                style={[styles.bigButton, styles.finishButton, { width: '100%', marginTop: 32 }]}
                onPress={onClose}
                accessibilityRole="button"
              >
                <Text style={styles.finishButtonText}>{t('context.actions.home')}</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  backButtonText: {
    color: '#38BDF8',
    fontSize: 15,
    fontWeight: '600',
  },
  stepIndicator: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    color: '#94A3B8',
    fontSize: 20,
    fontWeight: '700',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  stepContainer: {
    gap: 16,
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginTop: 8,
  },
  stepSubtitle: {
    fontSize: 15,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 8,
  },
  optionsList: {
    gap: 12,
  },
  cardOption: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#334155',
    padding: 18,
    minHeight: 80,
    gap: 16,
  },
  cardOptionSelected: {
    backgroundColor: '#0369A1',
    borderColor: '#38BDF8',
  },
  cardEmoji: {
    fontSize: 32,
  },
  cardTextContainer: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  cardDetail: {
    fontSize: 14,
    color: '#CBD5E1',
  },
  badge: {
    backgroundColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  badgeText: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  seatsList: {
    gap: 12,
  },
  seatRow: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  seatNumberLabel: {
    color: '#38BDF8',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  seatInput: {
    color: '#F8FAFC',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#475569',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 52,
  },
  actionsFooter: {
    gap: 12,
    marginTop: 12,
  },
  bigButton: {
    borderRadius: 16,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primaryButton: {
    backgroundColor: '#0284C7',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#475569',
  },
  secondaryButtonText: {
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '600',
  },
  finishButton: {
    backgroundColor: '#16A34A',
  },
  finishButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  reviewCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 18,
    gap: 12,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  reviewLabel: {
    color: '#94A3B8',
    fontSize: 15,
  },
  reviewValue: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
  },
  inputSectionLabel: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  centeredBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  successIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  successIcon: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: '800',
  },
  successTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 8,
  },
  successSubtitle: {
    fontSize: 16,
    color: '#94A3B8',
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  errorText: {
    color: '#FDA4AF',
    fontSize: 16,
    textAlign: 'center',
  },
});
