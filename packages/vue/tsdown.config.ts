import { createRequire } from 'node:module'

import { defineConfig } from 'tsdown'
import raw from 'unplugin-raw/rolldown'
import vue from 'unplugin-vue/rolldown'

const require = createRequire(import.meta.url)

function atlaskitSubpathResolver() {
  const aliases = new Map([
    [
      '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item',
      '@atlaskit/pragmatic-drag-and-drop-hitbox/dist/esm/tree-item.js'
    ],
    [
      '@atlaskit/pragmatic-drag-and-drop/combine',
      '@atlaskit/pragmatic-drag-and-drop/dist/esm/entry-point/combine.js'
    ],
    [
      '@atlaskit/pragmatic-drag-and-drop/element/adapter',
      '@atlaskit/pragmatic-drag-and-drop/dist/esm/adapter/element-adapter.js'
    ]
  ])

  return {
    name: 'atlaskit-subpath-resolver',
    resolveId(id) {
      const target = aliases.get(id)
      return target ? require.resolve(target) : null
    }
  }
}

export default defineConfig({
  entry: {
    i18n: './src/i18n/public.ts',
    index: './src/index.ts',
    presentation: './src/presentation.ts'
  },
  platform: 'browser',
  format: ['esm'],
  dts: {
    vue: true,
    sourcemap: true,
    resolver: 'tsc'
  },
  sourcemap: true,
  hash: false,
  clean: true,
  outDir: './dist',
  treeshake: {
    moduleSideEffects: false
  },
  deps: {
    alwaysBundle: [
      '@atlaskit/pragmatic-drag-and-drop',
      /^@atlaskit\/pragmatic-drag-and-drop\//,
      '@atlaskit/pragmatic-drag-and-drop-hitbox',
      /^@atlaskit\/pragmatic-drag-and-drop-hitbox\//
    ],
    neverBundle: [
      'vue',
      /^vue\//,
      '@open-pencil/core',
      /^@open-pencil\/core\//,
      '@open-pencil/scene-graph',
      /^@open-pencil\/scene-graph\//,
      'canvaskit-wasm',
      'opentype.js',
      '@vueuse/core',
      '@nanostores/vue',
      '@nanostores/i18n',
      'nanostores',
      '@tanstack/vue-table',
      'reka-ui'
    ],
    onlyBundle: false
  },
  plugins: [atlaskitSubpathResolver(), raw(), vue()],
  inputOptions: {
    preserveEntrySignatures: 'allow-extension',
    checks: {
      pluginTimings: false
    }
  },
  outputOptions: {
    minifyInternalExports: false,
    codeSplitting: {
      groups: [
        {
          name: 'presentation-runtime',
          test: /src[\\/]canvas[\\/]surface[\\/]frame-scheduler\.ts$/,
          priority: 100,
          includeDependenciesRecursively: false
        },
        {
          name: 'i18n-runtime',
          test: /src[\\/]i18n[\\/](?:create|locale|messages(?:[\\/].*)?)\.(?:ts|json)$/,
          priority: 100,
          entriesAware: true,
          entriesAwareMergeThreshold: 0,
          includeDependenciesRecursively: false
        },
        {
          test: /(?<!\.d\.c?ts)$/,
          name: (id) => {
            const cleanId = id.split('?')[0]
            const parts = cleanId.split(/[\\/]/g)
            const srcIndex = parts.lastIndexOf('src')
            const file =
              srcIndex >= 0 ? parts.slice(srcIndex + 1).join('/') : (parts.at(-1) ?? 'index')
            return file.replace(/\.(vue|ts)$/, '')
          }
        }
      ]
    }
  }
})
