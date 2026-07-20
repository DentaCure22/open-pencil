import type {
  SmylrLiveContainerDocument,
  SmylrLiveContainerNode,
  SmylrLiveContainerPage,
} from './types'

type Rect = SmylrLiveContainerNode['rect']
type Style = NonNullable<SmylrLiveContainerNode['computedStyle']>

const colors = {
  app: '#f8fafc',
  border: '#e2e8f0',
  card: '#ffffff',
  dark: '#0f172a',
  darkMuted: '#1e293b',
  foreground: '#102033',
  muted: '#f1f5f9',
  primary: '#2563eb',
  softBlue: '#dbeafe',
  success: '#16a34a',
  warning: '#f59e0b',
}

function frame({
  attrs,
  children = [],
  className,
  id,
  label,
  rect,
  role,
  source,
  style,
  tagName = 'div',
  text,
  tokenHints,
}: {
  attrs?: Record<string, string>
  children?: SmylrLiveContainerNode[]
  className?: string
  id: string
  label: string
  rect: Rect
  role?: string
  source?: SmylrLiveContainerNode['source']
  style?: Style
  tagName?: string
  text?: string
  tokenHints?: string[]
}): SmylrLiveContainerNode {
  return {
    attrs,
    children,
    className,
    computedStyle: style,
    id,
    label,
    rect,
    role,
    source,
    tagName,
    text,
    tokenHints,
  }
}

function textBlock(
  id: string,
  label: string,
  text: string,
  rect: Rect,
  style: Style = {}
) {
  return frame({
    id,
    label,
    rect,
    style: {
      color: colors.foreground,
      'font-size': '14px',
      'font-weight': '500',
      'line-height': '20px',
      ...style,
    },
    tagName: 'p',
    text,
  })
}

function pill(
  id: string,
  label: string,
  text: string,
  rect: Rect,
  color = colors.softBlue
) {
  return frame({
    id,
    label,
    rect,
    style: {
      'background-color': color,
      'border-radius': '999px',
      color: colors.foreground,
      'font-size': '12px',
      'font-weight': '600',
      'line-height': '16px',
      padding: '6px 10px',
    },
    tagName: 'span',
    text,
  })
}

function componentCard({
  id,
  label,
  rect,
  source,
  subtitle,
  tokens,
}: {
  id: string
  label: string
  rect: Rect
  source: NonNullable<SmylrLiveContainerNode['source']>
  subtitle: string
  tokens: string[]
}) {
  return frame({
    children: [
      textBlock(
        `${id}-title`,
        `${label} title`,
        label,
        { height: 24, width: rect.width - 32, x: 16, y: 16 },
        {
          'font-size': '16px',
          'font-weight': '700',
        }
      ),
      textBlock(
        `${id}-subtitle`,
        `${label} subtitle`,
        subtitle,
        { height: 40, width: rect.width - 32, x: 16, y: 46 },
        {
          color: '#475569',
          'font-size': '12px',
          'font-weight': '500',
          'line-height': '18px',
        }
      ),
      frame({
        id: `${id}-preview`,
        label: `${label} preview surface`,
        rect: { height: 72, width: rect.width - 32, x: 16, y: 98 },
        style: {
          'background-color': colors.muted,
          'border-color': colors.border,
          'border-radius': '8px',
          'border-width': '1px',
          display: 'flex',
          gap: '8px',
          padding: '12px',
        },
      }),
      ...tokens
        .slice(0, 3)
        .map((token, index) =>
          pill(
            `${id}-token-${index + 1}`,
            `${label} token ${index + 1}`,
            token,
            { height: 28, width: 92, x: 16 + index * 100, y: 186 },
            index === 0 ? '#dcfce7' : colors.softBlue
          )
        ),
    ],
    id,
    label,
    rect,
    role: 'group',
    source,
    style: {
      'background-color': colors.card,
      'border-color': colors.border,
      'border-radius': '10px',
      'border-width': '1px',
      'box-shadow': 'rgba(15, 23, 42, 0.08) 0px 1px 2px',
      padding: '16px',
    },
    tagName: 'section',
    tokenHints: tokens,
  })
}

const productionAppTree: SmylrLiveContainerNode = frame({
  children: [
    frame({
      children: [
        textBlock(
          'app-brand',
          'Smylr brand',
          'Smylr',
          { height: 32, width: 160, x: 24, y: 24 },
          {
            color: '#ffffff',
            'font-size': '22px',
            'font-weight': '800',
          }
        ),
        ...[
          'Home',
          'Calendar',
          'Patients',
          'Dental chart',
          'Imaging',
          'RCM',
        ].map((item, index) =>
          frame({
            id: `app-nav-${item.toLowerCase().replaceAll(' ', '-')}`,
            label: `${item} nav item`,
            rect: { height: 42, width: 200, x: 24, y: 92 + index * 52 },
            style: {
              'background-color':
                item === 'Dental chart' ? colors.darkMuted : colors.dark,
              'border-radius': '8px',
              color: '#ffffff',
              padding: '11px 14px',
            },
            tagName: 'button',
            text: item,
          })
        ),
      ],
      id: 'authenticated-sidebar',
      label: 'Authenticated sidebar',
      rect: { height: 900, width: 248, x: 0, y: 0 },
      source: {
        componentName: 'AuthenticatedShell',
        filePath: 'src/components/layout/authenticated-shell.tsx',
      },
      style: {
        'background-color': colors.dark,
        display: 'flex',
        'flex-direction': 'column',
        gap: '10px',
        padding: '24px',
      },
      tokenHints: ['bg-sidebar', 'authenticated-shell'],
    }),
    frame({
      children: [
        textBlock(
          'page-title',
          'Page title',
          'Dental Chart',
          { height: 28, width: 260, x: 32, y: 22 },
          {
            'font-size': '20px',
            'font-weight': '800',
          }
        ),
        pill(
          'selected-patient-chip',
          'Selected patient chip',
          'Yasmin Ali',
          { height: 34, width: 132, x: 960, y: 18 },
          '#e0f2fe'
        ),
      ],
      id: 'authenticated-topbar',
      label: 'Authenticated topbar',
      rect: { height: 72, width: 1192, x: 248, y: 0 },
      style: {
        'background-color': colors.card,
        'border-bottom-color': colors.border,
        'border-bottom-width': '1px',
      },
    }),
    frame({
      children: [
        textBlock(
          'patient-record-title',
          'Patient record title',
          'DentalPatientRecord',
          { height: 28, width: 320, x: 24, y: 18 },
          {
            'font-size': '18px',
            'font-weight': '800',
          }
        ),
        textBlock(
          'patient-record-subtitle',
          'Patient summary',
          'DOB 04/14/1988 - Recall due - Insurance verified',
          { height: 22, width: 420, x: 24, y: 50 },
          {
            color: '#64748b',
            'font-size': '13px',
          }
        ),
        pill(
          'clinical-status-chip',
          'Clinical status chip',
          'Ready for charting',
          { height: 34, width: 168, x: 890, y: 26 },
          '#dcfce7'
        ),
      ],
      id: 'dental-patient-record-header',
      label: 'DentalPatientRecord header',
      rect: { height: 96, width: 1128, x: 284, y: 96 },
      role: 'region',
      source: {
        componentName: 'DentalPatientRecord',
        filePath:
          'src/features/dental-chart/components/dental-patient-record.tsx',
      },
      style: {
        'background-color': colors.card,
        'border-color': colors.border,
        'border-radius': '12px',
        'border-width': '1px',
        'box-shadow': 'rgba(15, 23, 42, 0.06) 0px 1px 2px',
      },
      tagName: 'header',
      tokenHints: ['bg-card', 'rounded-xl', 'shadow-sm'],
    }),
    frame({
      children: [
        ...['Odontogram', 'Perio', 'Imaging', 'Notes', 'Treatment'].map(
          (item, index) =>
            frame({
              id: `patient-tab-${item.toLowerCase()}`,
              label: `${item} tab`,
              rect: { height: 38, width: 126, x: 18 + index * 136, y: 13 },
              style: {
                'background-color': index === 0 ? colors.primary : colors.card,
                'border-color': index === 0 ? colors.primary : colors.border,
                'border-radius': '8px',
                'border-width': '1px',
                color: index === 0 ? '#ffffff' : colors.foreground,
                padding: '9px 16px',
              },
              tagName: 'button',
              text: item,
            })
        ),
      ],
      id: 'patient-tab-bar',
      label: 'Patient tab bar',
      rect: { height: 64, width: 1128, x: 284, y: 208 },
      source: {
        componentName: 'PatientTabBar',
        filePath: 'src/components/layout/patient-tab-bar.tsx',
      },
      style: {
        'background-color': colors.card,
        'border-color': colors.border,
        'border-radius': '12px',
        'border-width': '1px',
        padding: '12px',
      },
      tokenHints: ['PatientTabBar', 'rounded-xl'],
    }),
    frame({
      children: [
        frame({
          children: [
            textBlock(
              'odontogram-title',
              'Odontogram title',
              'Odontogram workspace',
              { height: 24, width: 300, x: 24, y: 20 },
              {
                'font-size': '16px',
                'font-weight': '800',
              }
            ),
            frame({
              id: 'odontogram-arch-preview',
              label: 'Odontogram arch preview',
              rect: { height: 300, width: 660, x: 24, y: 66 },
              source: {
                componentName: 'DentalChartCanvas',
                filePath:
                  'src/features/dental-chart/components/dental-chart-canvas.tsx',
              },
              style: {
                'background-color': '#eef6ff',
                'border-color': '#bfdbfe',
                'border-radius': '14px',
                'border-width': '1px',
              },
              tokenHints: ['DentalChartCanvas', 'bg-info-subtle'],
            }),
            frame({
              id: 'tooth-action-toolbar',
              label: 'Tooth action toolbar',
              rect: { height: 64, width: 660, x: 24, y: 390 },
              style: {
                'background-color': colors.muted,
                'border-radius': '10px',
                display: 'flex',
                gap: '8px',
                padding: '12px',
              },
            }),
          ],
          id: 'dental-chart-workspace',
          label: 'Dental chart workspace',
          rect: { height: 496, width: 708, x: 24, y: 24 },
          role: 'region',
          source: {
            componentName: 'DentalRecordCanvasModeTransition',
            filePath:
              'src/features/dental-chart/components/dental-record-canvas-mode-transition.tsx',
          },
          style: {
            'background-color': colors.card,
            'border-color': colors.border,
            'border-radius': '12px',
            'border-width': '1px',
            'box-shadow': 'rgba(15, 23, 42, 0.06) 0px 1px 2px',
            padding: '24px',
          },
          tagName: 'section',
          tokenHints: ['bg-card', 'rounded-xl', 'shadow-sm'],
        }),
        frame({
          children: [
            textBlock(
              'summary-rail-title',
              'Summary rail title',
              'Clinical summary',
              { height: 24, width: 260, x: 20, y: 18 },
              {
                'font-size': '16px',
                'font-weight': '800',
              }
            ),
            componentCard({
              id: 'health-lists-preview',
              label: 'HealthListsGrid',
              rect: { height: 226, width: 320, x: 20, y: 58 },
              source: {
                componentName: 'HealthListsGrid',
                filePath:
                  'src/features/dental-chart/components/health-lists-grid.tsx',
              },
              subtitle: 'Conditions, allergies, meds',
              tokens: ['bg-card', 'gap-2', 'rounded-lg'],
            }),
            componentCard({
              id: 'imaging-preview',
              label: 'ImagingStrip',
              rect: { height: 226, width: 320, x: 20, y: 306 },
              source: {
                componentName: 'DentalImagingStrip',
                filePath:
                  'src/features/dental-imaging/components/dental-imaging-strip.tsx',
              },
              subtitle: 'Pano, intraoral, CBCT queue',
              tokens: ['bg-muted', 'rounded-lg', 'shadow-sm'],
            }),
          ],
          id: 'clinical-summary-rail',
          label: 'Clinical summary rail',
          rect: { height: 560, width: 360, x: 748, y: 24 },
          style: {
            'background-color': colors.card,
            'border-color': colors.border,
            'border-radius': '12px',
            'border-width': '1px',
            padding: '20px',
          },
          tagName: 'aside',
          tokenHints: ['clinical-summary', 'right-rail'],
        }),
      ],
      id: 'dental-chart-production-canvas',
      label: 'Dental chart production canvas',
      rect: { height: 616, width: 1128, x: 284, y: 292 },
      source: {
        componentName: 'DentalPatientRecord',
        filePath:
          'src/features/dental-chart/components/dental-patient-record.tsx',
      },
      style: {
        'background-color': colors.app,
        'border-color': colors.border,
        'border-radius': '16px',
        'border-width': '1px',
        display: 'flex',
        gap: '16px',
        padding: '24px',
      },
      tagName: 'main',
      tokenHints: ['ShellSection', 'DentalPatientRecord', 'app-production'],
    }),
  ],
  id: 'smylr-production-app',
  label: 'Smylr production app',
  rect: { height: 932, width: 1440, x: 0, y: 0 },
  role: 'application',
  style: {
    'background-color': colors.app,
    display: 'flex',
    'font-family': 'Quicksand',
    position: 'relative',
  },
  tagName: 'div',
  tokenHints: ['production-app', 'authenticated-shell', 'dental-chart'],
})

const componentAssetsTree: SmylrLiveContainerNode = frame({
  children: [
    textBlock(
      'asset-page-title',
      'Asset page title',
      'Smylr Component Assets',
      { height: 40, width: 520, x: 48, y: 40 },
      {
        'font-size': '28px',
        'font-weight': '800',
      }
    ),
    textBlock(
      'asset-page-subtitle',
      'Asset page subtitle',
      'Production containers are grouped first; reusable blocks and atomic tokens stay below for isolated OpenPencil edits.',
      { height: 28, width: 820, x: 48, y: 82 },
      {
        color: '#475569',
        'font-size': '14px',
      }
    ),
    textBlock(
      'containers-heading',
      'Production containers heading',
      'Production containers',
      { height: 28, width: 320, x: 48, y: 142 },
      {
        'font-size': '18px',
        'font-weight': '800',
      }
    ),
    componentCard({
      id: 'asset-authenticated-shell',
      label: 'AuthenticatedShell',
      rect: { height: 236, width: 360, x: 48, y: 188 },
      source: {
        componentName: 'AuthenticatedShell',
        filePath: 'src/components/layout/authenticated-shell.tsx',
      },
      subtitle: 'Sidebar, page chrome, patient context entry point',
      tokens: ['sidebar', 'shell', 'layout'],
    }),
    componentCard({
      id: 'asset-dental-patient-record',
      label: 'DentalPatientRecord',
      rect: { height: 236, width: 360, x: 432, y: 188 },
      source: {
        componentName: 'DentalPatientRecord',
        filePath:
          'src/features/dental-chart/components/dental-patient-record.tsx',
      },
      subtitle: 'Clinical record surface with selected patient context',
      tokens: ['bg-card', 'rounded-xl', 'shadow-sm'],
    }),
    componentCard({
      id: 'asset-record-canvas',
      label: 'DentalRecordCanvasModeTransition',
      rect: { height: 236, width: 436, x: 816, y: 188 },
      source: {
        componentName: 'DentalRecordCanvasModeTransition',
        filePath:
          'src/features/dental-chart/components/dental-record-canvas-mode-transition.tsx',
      },
      subtitle: 'Main charting workspace, canvas mode, and surface owner',
      tokens: ['canvas', 'mode-transition', 'workspace'],
    }),
    textBlock(
      'blocks-heading',
      'Reusable blocks heading',
      'Reusable blocks',
      { height: 28, width: 320, x: 48, y: 474 },
      {
        'font-size': '18px',
        'font-weight': '800',
      }
    ),
    componentCard({
      id: 'asset-patient-tab-bar',
      label: 'PatientTabBar',
      rect: { height: 236, width: 282, x: 48, y: 520 },
      source: {
        componentName: 'PatientTabBar',
        filePath: 'src/components/layout/patient-tab-bar.tsx',
      },
      subtitle: 'Patient-scoped route tabs',
      tokens: ['tabs', 'patient-context', 'rounded-lg'],
    }),
    componentCard({
      id: 'asset-health-lists-grid',
      label: 'HealthListsGrid',
      rect: { height: 236, width: 282, x: 354, y: 520 },
      source: {
        componentName: 'HealthListsGrid',
        filePath: 'src/features/dental-chart/components/health-lists-grid.tsx',
      },
      subtitle: 'Medical summary cards',
      tokens: ['grid', 'bg-card', 'gap-2'],
    }),
    componentCard({
      id: 'asset-perio-panel',
      label: 'PerioPanel',
      rect: { height: 236, width: 282, x: 660, y: 520 },
      source: {
        componentName: 'PerioPanel',
        filePath: 'src/features/dental-chart/components/perio-panel.tsx',
      },
      subtitle: 'Perio measurements surface',
      tokens: ['perio', 'panel', 'shadow-sm'],
    }),
    componentCard({
      id: 'asset-imaging-tile',
      label: 'ImagingTile',
      rect: { height: 236, width: 282, x: 966, y: 520 },
      source: {
        componentName: 'DentalImagingTile',
        filePath:
          'src/features/dental-imaging/components/dental-imaging-tile.tsx',
      },
      subtitle: 'Image preview and metadata',
      tokens: ['image', 'rounded-lg', 'border'],
    }),
    textBlock(
      'tokens-heading',
      'Tokens heading',
      'Tokens and primitives',
      { height: 28, width: 320, x: 48, y: 806 },
      {
        'font-size': '18px',
        'font-weight': '800',
      }
    ),
    ...[
      ['token-card-bg', 'bg-card', colors.card],
      ['token-primary', 'primary', colors.primary],
      ['token-muted', 'muted', colors.muted],
      ['token-success', 'success', colors.success],
      ['token-warning', 'warning', colors.warning],
    ].map(([id, label, color], index) =>
      frame({
        children: [
          frame({
            id: `${id}-swatch`,
            label: `${label} swatch`,
            rect: { height: 72, width: 120, x: 16, y: 16 },
            style: {
              'background-color': color,
              'border-color': colors.border,
              'border-radius': '10px',
              'border-width': '1px',
            },
          }),
          textBlock(
            `${id}-label`,
            `${label} label`,
            label,
            { height: 24, width: 120, x: 16, y: 102 },
            {
              'font-size': '13px',
              'font-weight': '700',
            }
          ),
        ],
        id,
        label,
        rect: { height: 148, width: 152, x: 48 + index * 176, y: 850 },
        style: {
          'background-color': colors.card,
          'border-color': colors.border,
          'border-radius': '10px',
          'border-width': '1px',
        },
        tokenHints: [label],
      })
    ),
  ],
  id: 'smylr-component-assets',
  label: 'Smylr component assets',
  rect: { height: 1040, width: 1320, x: 0, y: 0 },
  role: 'document',
  style: {
    'background-color': colors.app,
    'font-family': 'Quicksand',
    position: 'relative',
  },
  tagName: 'section',
  tokenHints: ['component-assets', 'library-page'],
})

const pages: SmylrLiveContainerPage[] = [
  {
    id: 'smylr-production-app-page',
    kind: 'production-app',
    route: '/dental-chart',
    selectedId: 'dental-chart-production-canvas',
    title: 'Production App - Dental Chart',
    tree: productionAppTree,
  },
  {
    id: 'smylr-component-assets-page',
    kind: 'component-assets',
    route: '/dental-chart',
    selectedId: 'asset-dental-patient-record',
    title: 'Component Assets - Dental Chart',
    tree: componentAssetsTree,
  },
]

export const sampleSmylrLiveContainerDocument: SmylrLiveContainerDocument = {
  capturedAt: '2026-07-08T01:45:00.000Z',
  ownerMapText: [
    'Page 1: full production app surface',
    'Page 2: isolated component assets and token primitives',
    'Default selected container: Dental chart production canvas',
  ].join('\n'),
  pages,
  route: '/dental-chart',
  selectedId: 'dental-chart-production-canvas',
  title: 'Smylr App Canvas - Dental Chart',
  tree: productionAppTree,
}
