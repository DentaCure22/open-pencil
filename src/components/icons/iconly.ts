import { defineComponent, h, type Component } from 'vue'

import type { IconlyIconName } from '@/components/icons/iconly-types'
import IconlyIcon from '@/components/icons/IconlyIcon.vue'

function iconlyComponent(name: IconlyIconName): Component {
  return defineComponent({
    name: `Iconly${name.replace(/(^|-)([a-z])/g, (_match: string, _dash: string, letter: string) =>
      letter.toUpperCase()
    )}`,
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () => h(IconlyIcon, { ...attrs, name })
    }
  })
}

export const IconlyArrowDown = iconlyComponent('arrow-down')
export const IconlyArrowLeft = iconlyComponent('arrow-left')
export const IconlyArrowRight = iconlyComponent('arrow-right')
export const IconlyCategory = iconlyComponent('category')
export const IconlyChat = iconlyComponent('chat')
export const IconlyDelete = iconlyComponent('delete')
export const IconlyDocument = iconlyComponent('document')
export const IconlyImage = iconlyComponent('image')
export const IconlyLock = iconlyComponent('lock')
export const IconlyPlay = iconlyComponent('play')
export const IconlySetting = iconlyComponent('setting')
