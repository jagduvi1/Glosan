// Language code → flag code mapping. Single source of truth for the
// 5 flags we draw in CSS (see kit.css `.flag-fr`, `.flag-de`, etc.).

export const LANG_TO_FLAG = {
  fr: 'fr',
  de: 'de',
  es: 'es',
  en: 'uk',
  sv: 'se'
};

export function flagFor(lang) {
  return LANG_TO_FLAG[lang];
}
