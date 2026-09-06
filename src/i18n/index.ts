import ptBR from './locales/pt-BR.json';
import enUS from './locales/en-US.json';

export type Locale = 'pt-BR' | 'en-US';

export const translations = {
  'pt-BR': ptBR,
  'en-US': enUS,
};

let currentLocale: Locale = 'pt-BR';

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: keyof typeof ptBR, params?: Record<string, string | number>): string {
  const dict = translations[currentLocale] || translations['pt-BR'];
  let text = dict[key] || translations['pt-BR'][key] || key;

  if (params) {
    Object.entries(params).forEach(([paramKey, val]) => {
      text = text.replace(new RegExp(`{{${paramKey}}}`, 'g'), String(val));
    });
  }

  return text;
}
