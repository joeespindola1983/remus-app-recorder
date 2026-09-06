import { t, setLocale, getLocale, translations } from '../i18n';

describe('i18n Translation System', () => {
  beforeEach(() => {
    setLocale('pt-BR');
  });

  test('should return translation for key in default pt-BR locale', () => {
    expect(t('app.title')).toBe('Gravador de Telemetria Remus');
    expect(t('recording.start')).toBe('Iniciar Gravação');
    expect(t('recording.stop')).toBe('Parar Gravação');
  });

  test('should switch locale to en-US and translate correctly', () => {
    setLocale('en-US');
    expect(getLocale()).toBe('en-US');
    expect(t('app.title')).toBe('Remus Telemetry Recorder');
    expect(t('recording.start')).toBe('Start Recording');
    expect(t('recording.stop')).toBe('Stop Recording');
  });

  test('should interpolate variables correctly', () => {
    setLocale('pt-BR');
    expect(t('recording.sampleCount', { count: 120 })).toBe('120 amostras');

    setLocale('en-US');
    expect(t('recording.sampleCount', { count: 120 })).toBe('120 samples');
  });

  test('should ensure pt-BR and en-US have matching keys', () => {
    const ptKeys = Object.keys(translations['pt-BR']).sort();
    const enKeys = Object.keys(translations['en-US']).sort();
    expect(ptKeys).toEqual(enKeys);
  });
});
