/**
 * Bump when foundation or durable flow builders change so the editor
 * re-seeds the canvas without requiring a full hard-refresh dance.
 *
 * After `open-pencil:watch` rebuilds, a normal reload loads new JS with a
 * new revision → workspace re-opens automatically.
 */
export const SMYLR_FOUNDATIONS_REVISION = '2026-08-08-native-workspace-surfaces-v69'

export const SMYLR_FOUNDATIONS_PLUGIN_ID = 'smylr-production'
export const SMYLR_FOUNDATIONS_REV_KEY = 'foundationsRevision'
