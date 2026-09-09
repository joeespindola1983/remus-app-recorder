const fs = require('fs');

let content = fs.readFileSync('src/screens/RecorderScreen.tsx', 'utf8');

const additionalStyles = `
  disabledButton: {
    backgroundColor: '#475569',
    opacity: 0.7
  },
  countdownOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  countdownText: {
    fontSize: 120,
    fontWeight: 'bold',
    color: '#38BDF8',
  },
  sprintStatus: {
    backgroundColor: '#1E293B',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  warningText: {
    color: '#F59E0B',
    fontSize: 16,
    fontWeight: '600',
  },
  readyText: {
    color: '#10B981',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    padding: 8,
  },
  cancelButtonText: {
    color: '#94A3B8',
    fontSize: 16,
  },
`;

content = content.replace('const styles = StyleSheet.create({', 'const styles = StyleSheet.create({' + additionalStyles);

fs.writeFileSync('src/screens/RecorderScreen.tsx', content);
