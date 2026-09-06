const test = require('node:test');
const assert = require('node:assert');

const ptBR = require('../src/i18n/locales/pt-BR.json');
const enUS = require('../src/i18n/locales/en-US.json');

const translations = {
  'pt-BR': ptBR,
  'en-US': enUS,
};

let currentLocale = 'pt-BR';

function setLocale(locale) {
  currentLocale = locale;
}

function getLocale() {
  return currentLocale;
}

function t(key, params) {
  const dict = translations[currentLocale] || translations['pt-BR'];
  let text = dict[key] || translations['pt-BR'][key] || key;

  if (params) {
    Object.entries(params).forEach(([paramKey, val]) => {
      text = text.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(val));
    });
  }

  return text;
}

test('i18n translation system - default pt-BR', () => {
  setLocale('pt-BR');
  assert.strictEqual(t('app.title'), 'Gravador de Telemetria Remus');
  assert.strictEqual(t('recording.start'), 'Iniciar Gravação');
  assert.strictEqual(t('recording.stop'), 'Parar Gravação');
});

test('i18n translation system - switch to en-US', () => {
  setLocale('en-US');
  assert.strictEqual(getLocale(), 'en-US');
  assert.strictEqual(t('app.title'), 'Remus Telemetry Recorder');
  assert.strictEqual(t('recording.start'), 'Start Recording');
  assert.strictEqual(t('recording.stop'), 'Stop Recording');
});

test('i18n translation system - interpolation', () => {
  setLocale('pt-BR');
  assert.strictEqual(t('recording.sampleCount', { count: 120 }), '120 amostras');

  setLocale('en-US');
  assert.strictEqual(t('recording.sampleCount', { count: 120 }), '120 samples');
});

test('i18n translation system - key parity check', () => {
  const ptKeys = Object.keys(translations['pt-BR']).sort();
  const enKeys = Object.keys(translations['en-US']).sort();
  assert.deepStrictEqual(ptKeys, enKeys);
});
