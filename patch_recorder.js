const fs = require('fs');

let content = fs.readFileSync('src/screens/RecorderScreen.tsx', 'utf8');

// Replace handleStart
const handleStartOld = `const handleStart = async () => {`;
const handleStartNew = `
  const startRecordingNative = async () => {
    try {
      await sessionManager.restore();
      await telemetryBridge.requestPermissions();
      const res = await sessionManager.start({
        deviceModel: Platform.OS === 'ios' ? 'iOS Device' : 'Android Device',
        systemVersion: String(Platform.Version),
        motionFrequencyHertz: 100,
        placement,
        notes: mode !== 'free' ? JSON.stringify({ mode, targetDistance }) : ''
      });
      setIsRecording(true);
      setDuration(0);
      setMetrics(prev => ({...prev, strokeRateSpm: null, strokeRateStatus: 'collecting', strokeRateProgress: 0}));
      await analyticsService.logRecordingStarted({
        sessionId: res.sessionId,
        sensorProfile: placement,
      });
    } catch (err: any) {
      console.error(err);
      analyticsService.recordError(err, 'RecorderScreen:handleStart');
    } finally {
      setTransitioning(false);
    }
  };

  const handleStart = async () => {
    if (transitioning) return;
    setTransitioning(true);

    if (mode !== 'free') {
      let timeLeft = 10;
      setCountdown(timeLeft);
      
      const interval = setInterval(async () => {
        timeLeft -= 1;
        if (timeLeft > 0 && timeLeft <= 3) {
          // Buzzer
          await telemetryBridge.playBeep(false);
        }
        
        if (timeLeft <= 0) {
          clearInterval(interval);
          setCountdown(null);
          await telemetryBridge.playBeep(true);
          await startRecordingNative();
        } else {
          setCountdown(timeLeft);
        }
      }, 1000);
    } else {
      await startRecordingNative();
    }
  };
`;

content = content.replace(/const handleStart = async \(\) => {[\s\S]*?setTransitioning\(false\);\s*\n\s*\};\n/, handleStartNew);

// Insert auto-stop logic
const autoStopCode = `
  useEffect(() => {
    if (isRecording && mode !== 'free' && targetDistance != null) {
      if (metrics.distanceMeters != null && metrics.distanceMeters >= targetDistance) {
        telemetryBridge.playBeep(true);
        handleStop();
      }
    }
  }, [isRecording, metrics.distanceMeters, mode, targetDistance]);
`;

content = content.replace('const formatDuration', autoStopCode + '\n  const formatDuration');

// Render Start button logic
const renderStartBtn = `
          {isRecording || countdown !== null ? (
            <TouchableOpacity
              style={[styles.bigButton, styles.stopButton]}
              onPress={() => countdown !== null ? setCountdown(null) : handleStop()}
              disabled={transitioning}
            >
              <Text style={styles.bigButtonText}>{countdown !== null ? 'CANCELAR' : 'PARAR'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.bigButton, (mode !== 'free' && !isReadyToSprint) && styles.disabledButton]}
              onPress={handleStart}
              disabled={transitioning || (mode !== 'free' && !isReadyToSprint)}
            >
              <Text style={styles.bigButtonText}>{mode !== 'free' ? 'INICIAR TIRO' : 'GRAVAR'}</Text>
            </TouchableOpacity>
          )}
`;

content = content.replace(/\{isRecording \? \([\s\S]*?GRAVAR'\}\<\/Text\>[\s\S]*?\<\/TouchableOpacity\>\n\s*\)\}/, renderStartBtn.trim());

// Render countdown overlay and GPS status
const renderHeader = `
        <View style={styles.header}>
          <Text style={styles.title}>
            {mode === 'free' ? 'Remo Livre' : \`Tiro de \${targetDistance}m\`}
          </Text>
          {onCancel && !isRecording && countdown === null && (
            <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
              <Text style={styles.cancelButtonText}>Voltar</Text>
            </TouchableOpacity>
          )}
        </View>

        {mode !== 'free' && !isRecording && countdown === null && (
          <View style={styles.sprintStatus}>
            {!isGpsReady ? (
              <Text style={styles.warningText}>Aguardando GPS de alta precisão...</Text>
            ) : !isBoatStopped ? (
              <Text style={styles.warningText}>Aguardando barco estabilizar...</Text>
            ) : (
              <Text style={styles.readyText}>Pronto para largada!</Text>
            )}
          </View>
        )}

        {countdown !== null && (
          <View style={styles.countdownOverlay}>
            <Text style={styles.countdownText}>{countdown}</Text>
          </View>
        )}
`;

content = content.replace(/\<View style=\{styles\.header\}\>[\s\S]*?\<\/View\>/, renderHeader.trim());

const readyStatusCode = `
  const isGpsReady = metrics.horizontalAccuracyMeters != null && metrics.horizontalAccuracyMeters <= 10;
  const isBoatStopped = metrics.groundSpeedMetersPerSecond != null && metrics.groundSpeedMetersPerSecond < 0.5;
  const isReadyToSprint = isGpsReady && isBoatStopped;
`;

content = content.replace('const handleStart', readyStatusCode + '\n  const handleStart');

fs.writeFileSync('src/screens/RecorderScreen.tsx', content);
