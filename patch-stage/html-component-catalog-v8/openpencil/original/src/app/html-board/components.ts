import { SMYLR_COMPUTED_ASSETS } from '../smylr-component-library/computed-catalog'

export type HtmlBoardRegisteredComponentSource = {
  filePath: string
  fixtureId: string
  repository: string
  route: string
  selector: string
  symbol: string
  verification: 'repository-verified'
}

export type HtmlBoardRegisteredComponent = {
  componentName: string
  css: string
  id: string
  label: string
  render: (instanceId: string) => string
  source?: HtmlBoardRegisteredComponentSource
}

const smylrButton = SMYLR_COMPUTED_ASSETS.find((asset) => asset.fixtureId === 'button')
if (!smylrButton) throw new Error('Smylr Button fixture is missing from the computed catalog')

const REGISTERED_COMPONENTS: HtmlBoardRegisteredComponent[] = [
  {
    componentName: 'ActionButton',
    css: `.op-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  border: 0;
  border-radius: var(--op-control-radius, 10px);
  padding: 0 18px;
  background: var(--op-text, #171717);
  color: #ffffff;
  font: inherit;
  font-weight: 650;
  text-decoration: none;
}
.op-action[data-tone="soft"] { background: var(--op-accent, #3159d9); }`,
    id: 'action-button',
    label: 'Action',
    render: (instanceId) =>
      `<button class="op-action" type="button" data-openpencil-component="ActionButton" data-openpencil-component-id="${instanceId}" data-openpencil-prop-label="Continue" data-openpencil-control-label="text" data-openpencil-bind-label="text" data-openpencil-prop-tone="solid" data-openpencil-control-tone="select" data-openpencil-options-tone="solid,soft" data-openpencil-bind-tone="attribute:data-tone" data-openpencil-variant="primary" data-tone="solid">Continue</button>`
  },
  {
    componentName: 'TextLink',
    css: `.op-text-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--op-text, #171717);
  font-weight: 650;
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
}
.op-text-link[data-emphasis="quiet"] { color: var(--op-muted, #666666); }`,
    id: 'text-link',
    label: 'Text link',
    render: (instanceId) =>
      `<a class="op-text-link" href="#" data-openpencil-component="TextLink" data-openpencil-component-id="${instanceId}" data-openpencil-prop-label="Learn more" data-openpencil-control-label="text" data-openpencil-bind-label="text" data-openpencil-prop-emphasis="strong" data-openpencil-control-emphasis="select" data-openpencil-options-emphasis="strong,quiet" data-openpencil-bind-emphasis="attribute:data-emphasis" data-openpencil-variant="inline" data-emphasis="strong">Learn more</a>`
  },
  {
    componentName: 'SmylrButton',
    css: `.op-live-component {
  display: inline-flex;
  min-height: 44px;
  min-width: 132px;
  align-items: center;
  justify-content: center;
}
.op-live-component iframe {
  display: block;
  width: 132px;
  height: 44px;
  border: 0;
  overflow: hidden;
  background: transparent;
}`,
    id: 'smylr-button-live',
    label: 'Smylr Button',
    render: (instanceId) =>
      `<span class="op-live-component" data-openpencil-component="SmylrButton" data-openpencil-component-id="${instanceId}" data-openpencil-registry-id="smylr-button-live" data-openpencil-source-repository="${smylrButton.repository}" data-openpencil-source-file="${smylrButton.sourcePath}" data-openpencil-source-symbol="${smylrButton.symbol}" data-openpencil-source-route="/open-pencil-renderer?component=${smylrButton.fixtureId}&amp;embed=1" data-openpencil-source-selector="button" data-openpencil-source-verification="repository-verified" data-openpencil-variant="live"><iframe data-openpencil-live-component="true" data-openpencil-renderer-route="/open-pencil-renderer?component=${smylrButton.fixtureId}&amp;embed=1" title="Live Smylr Button"></iframe></span>`,
    source: {
      filePath: smylrButton.sourcePath,
      fixtureId: smylrButton.fixtureId,
      repository: smylrButton.repository,
      route: `/open-pencil-renderer?component=${smylrButton.fixtureId}&embed=1`,
      selector: 'button',
      symbol: smylrButton.symbol,
      verification: 'repository-verified'
    }
  }
]

export function htmlBoardRegisteredComponentById(
  id: string
): HtmlBoardRegisteredComponent | null {
  return REGISTERED_COMPONENTS.find((component) => component.id === id) ?? null
}

export function htmlBoardRegisteredComponentsForSlot(
  acceptedComponentNames: string[]
): HtmlBoardRegisteredComponent[] {
  const accepted = new Set(acceptedComponentNames.map((name) => name.trim()).filter(Boolean))
  if (accepted.size === 0) return []
  return REGISTERED_COMPONENTS.filter((component) => accepted.has(component.componentName))
}
