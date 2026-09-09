const fs = require('fs');

let content = fs.readFileSync('src/screens/RecordingContextForm.tsx', 'utf8');

const titleGenerator = `
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
        const timeStr = \`\${dateObj.getHours().toString().padStart(2,'0')}:\${dateObj.getMinutes().toString().padStart(2,'0')}:\${dateObj.getSeconds().toString().padStart(2,'0')}\`;
        const dateStr = \`\${dateObj.getDate().toString().padStart(2,'0')}/\${(dateObj.getMonth()+1).toString().padStart(2,'0')}/\${dateObj.getFullYear()}\`;
        candidate.sessionTitle = \`Tiro de \${dist}m - \${m}m \${s} segundos (total do tiro) - \${timeStr} \${dateStr}\`;
      } else {
        candidate.sessionTitle = \`Treino \${boat} - \${weekdays[dateObj.getDay()]}, \${dateObj.getDate()} de \${months[dateObj.getMonth()]} de \${dateObj.getFullYear()}\`;
      }

      const prepared = prepareContext(candidate, true);
`;

content = content.replace('const prepared = prepareContext(candidate, true);', titleGenerator);

fs.writeFileSync('src/screens/RecordingContextForm.tsx', content);
