export type HtmlBoardRegisteredComponent = {
  componentName: string
  css: string
  id: string
  label: string
  render: (instanceId: string) => string
}

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
