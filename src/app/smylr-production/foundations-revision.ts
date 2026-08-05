/**
 * Bump when foundation or durable flow builders change so the editor
 * re-seeds the canvas without requiring a full hard-refresh dance.
 *
 * After `open-pencil:watch` rebuilds, a normal reload loads new JS with a
 * new revision → workspace re-opens automatically.
 */
export const SMYLR_FOUNDATIONS_REVISION = '2026-07-22-live-react-flow-surfaces-v68'

export const SMYLR_FOUNDATIONS_PLUGIN_ID = 'smylr-production'
export const SMYLR_FOUNDATIONS_REV_KEY = 'foundationsRevision'
