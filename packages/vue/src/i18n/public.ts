/** Public, component-free i18n entry point for app services and headless consumers. */
export {
  AVAILABLE_LOCALES,
  LOCALE_DIR_NAMES,
  LOCALE_LABELS,
  TRANSLATED_LOCALES,
  locale,
  localeSetting,
  setLocale
} from './locale'
export type { Locale, TranslatedLocale } from './locale'
export { i18n } from './create'
export {
  commandMessages,
  dialogMessages,
  menuMessages,
  messageDefaults,
  pageMessages,
  panelMessages,
  toolMessages,
  variableTypeMessages
} from './messages'
