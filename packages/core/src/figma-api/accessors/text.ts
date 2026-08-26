import type { SceneNode } from '@open-pencil/scene-graph'

import {
  graph,
  nodeId,
  raw,
  updateNode,
  type NodeProxyInternals,
  type ProxyThis
} from '#core/figma-api/accessor-utils'
import type { FigmaFontName } from '#core/figma-api/fonts'
import * as TextProxy from '#core/figma-api/text'

export function installTextNodeProxyAccessors(
  prototype: object,
  internals: NodeProxyInternals
): void {
  Object.defineProperties(prototype, {
    characters: textValueAccessor(internals, 'text'),
    fontSize: textValueAccessor(internals, 'fontSize'),
    fontName: {
      get(this: ProxyThis): FigmaFontName {
        return TextProxy.getFontName(raw(this, internals))
      },
      set(this: ProxyThis, value: FigmaFontName) {
        TextProxy.setFontName(graph(this, internals), nodeId(this, internals), value)
      }
    },
    fontWeight: textValueAccessor(internals, 'fontWeight'),
    textAlignHorizontal: textValueAccessor(internals, 'textAlignHorizontal'),
    textDirection: textValueAccessor(internals, 'textDirection'),
    textAlignVertical: textValueAccessor(internals, 'textAlignVertical'),
    textAutoResize: textValueAccessor(internals, 'textAutoResize'),
    letterSpacing: textValueAccessor(internals, 'letterSpacing'),
    lineHeight: textValueAccessor(internals, 'lineHeight'),
    textCase: textValueAccessor(internals, 'textCase'),
    textDecoration: textValueAccessor(internals, 'textDecoration'),
    maxLines: textValueAccessor(internals, 'maxLines'),
    textTruncation: textValueAccessor(internals, 'textTruncation'),
    autoRename: textValueAccessor(internals, 'autoRename')
  })

  Object.assign(prototype, {
    insertCharacters(this: ProxyThis, start: number, characters: string): void {
      TextProxy.insertCharacters(graph(this, internals), raw(this, internals), start, characters)
    },
    deleteCharacters(this: ProxyThis, start: number, end: number): void {
      TextProxy.deleteCharacters(graph(this, internals), raw(this, internals), start, end)
    }
  })
}

function textValueAccessor<K extends keyof SceneNode>(
  internals: NodeProxyInternals,
  field: K
): PropertyDescriptor {
  return {
    get(this: ProxyThis): SceneNode[K] {
      return raw(this, internals)[field]
    },
    set(this: ProxyThis, value: SceneNode[K]) {
      updateNode(this, internals, { [field]: value } as Pick<SceneNode, K>)
    }
  }
}
