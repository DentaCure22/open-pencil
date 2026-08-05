import { expect, test } from 'bun:test'

import { dialogMessages } from '@open-pencil/vue/i18n'
import { scheduleEditorPresentationFrame } from '@open-pencil/vue/presentation'

test('loads component-free Vue SDK service subpaths in Bun', () => {
  expect(dialogMessages.get().webFontProvidersRequireDesktopApp).toBeString()
  expect(scheduleEditorPresentationFrame).toBeFunction()
})
