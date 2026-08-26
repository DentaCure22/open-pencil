import { expect, test, type Page } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

async function mockAgentShell(page: Page, options: { threads?: object[]; workMap?: object } = {}) {
  const workMap = options.workMap ?? {
    placements: [],
    projects: [
      {
        createdAt: '2026-08-25T12:00:00.000Z',
        id: 'project:dental-chart',
        name: 'Dental Chart',
        updatedAt: '2026-08-25T12:00:00.000Z'
      },
      {
        createdAt: '2026-08-25T12:00:00.000Z',
        id: 'project:work-map',
        name: 'Work Map',
        parentId: 'project:dental-chart',
        updatedAt: '2026-08-25T12:00:00.000Z'
      }
    ],
    revision: 1,
    todos: [
      {
        createdAt: '2026-08-25T12:00:00.000Z',
        id: 'todo:refine-chart',
        projectId: 'project:dental-chart',
        status: 'todo',
        title: 'Refine chart editor interactions',
        updatedAt: '2026-08-25T12:00:00.000Z'
      }
    ]
  }
  await Promise.all([
    page.route(/\/agent-router\/v1\/pi\/conversations(\?preview=1)?$/, (route) =>
      route.fulfill({
        body: JSON.stringify({ threads: options.threads ?? [] }),
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/models$/, (route) =>
      route.fulfill({
        body: '{"models":[]}',
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/work-map$/, (route) =>
      route.fulfill({
        body: JSON.stringify(workMap),
        contentType: 'application/json'
      })
    ),
    page.route(/\/agent-router\/v1\/pi\/work-map\/apply$/, (route) =>
      route.fulfill({
        body: JSON.stringify(workMap),
        contentType: 'application/json'
      })
    )
  ])
}

function paginationThread(index: number) {
  const updatedAt = new Date(Date.UTC(2026, 7, 25, 12, 0, index)).toISOString()
  return {
    canFollowUp: true,
    createdAt: updatedAt,
    effort: 'medium',
    id: `pagination-${String(index)}`,
    messages: [],
    model: 'openai/gpt-5.5',
    pendingUiRequests: [],
    recentUpdate: '',
    state: 'completed',
    task: `Misc chat ${String(index + 1)}`,
    updatedAt,
    workerId: `worker-${String(index)}`
  }
}

test('reveals Work map rows in calm fixed-size pages', async ({ page }) => {
  const updatedAt = '2026-08-25T12:00:00.000Z'
  const statuses = ['todo', 'in_motion', 'finished'] as const
  const todos = statuses.flatMap((status) =>
    Array.from({ length: 11 }, (_, index) => ({
      createdAt: updatedAt,
      id: `todo:${status}-${String(index)}`,
      projectId: 'project:pagination',
      status,
      title: `${status} task ${String(index + 1)}`,
      updatedAt: new Date(Date.UTC(2026, 7, 25, 12, 0, index)).toISOString()
    }))
  )
  await mockAgentShell(page, {
    threads: Array.from({ length: 26 }, (_, index) => paginationThread(index)),
    workMap: {
      placements: [],
      projects: [
        {
          createdAt: updatedAt,
          id: 'project:pagination',
          name: 'Pagination',
          updatedAt
        }
      ],
      revision: 1,
      todos
    }
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const todoRows = page.getByTestId(/^work-map-todo-todo:todo-/)
  await expect(todoRows).toHaveCount(5)
  const showMoreTodo = page.getByTestId('work-map-show-more-project:pagination-todo')
  await expect(showMoreTodo).toHaveText('Show more')
  await showMoreTodo.click()
  await expect(todoRows).toHaveCount(10)
  await expect(showMoreTodo).toHaveAttribute('aria-label', 'Show 1 more todo tasks')
  await showMoreTodo.click()
  await expect(todoRows).toHaveCount(11)
  await expect(showMoreTodo).toHaveCount(0)

  const inMotionRows = page.getByTestId(/^work-map-todo-todo:in_motion-/)
  await expect(inMotionRows).toHaveCount(5)
  await page.getByTestId('work-map-show-more-project:pagination-in_motion').click()
  await expect(inMotionRows).toHaveCount(10)

  const finished = page.getByRole('button', { name: 'Finished' })
  await finished.click()
  const finishedRows = page.getByTestId(/^work-map-todo-todo:finished-/)
  await expect(finishedRows).toHaveCount(5)
  await page.getByTestId('work-map-show-more-project:pagination-finished').click()
  await expect(finishedRows).toHaveCount(10)

  await page.getByRole('button', { name: 'Expand Misc chats' }).click()
  const miscRows = page.getByTestId(/^agent-chat-thread-agent:pagination-/)
  await expect(miscRows).toHaveCount(15)
  const showMoreMisc = page.getByTestId('work-map-show-more-misc')
  await expect(showMoreMisc).toHaveAttribute('aria-label', 'Show 10 more chats')
  const restingShowMoreStyles = await showMoreMisc.evaluate((element) => ({
    backgroundColor: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color
  }))
  await showMoreMisc.hover()
  await page.waitForTimeout(200)
  const hoveredShowMoreStyles = await showMoreMisc.evaluate((element) => ({
    backgroundColor: getComputedStyle(element).backgroundColor,
    color: getComputedStyle(element).color
  }))
  expect(hoveredShowMoreStyles.backgroundColor).toBe(restingShowMoreStyles.backgroundColor)
  expect(hoveredShowMoreStyles.color).not.toBe(restingShowMoreStyles.color)
  await showMoreMisc.click()
  await expect(miscRows).toHaveCount(25)
  await expect(showMoreMisc).toHaveAttribute('aria-label', 'Show 1 more chats')
  await showMoreMisc.click()
  await expect(miscRows).toHaveCount(26)
  await expect(showMoreMisc).toHaveCount(0)
})

test('renders only Todo, In motion, and Finished task statuses', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  await expect(page.getByText('Todo', { exact: true })).toBeVisible()
  await expect(page.getByText('In motion', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finished' })).toBeVisible()
  await expect(page.getByTestId('work-map-empty-project:dental-chart-todo')).toHaveCount(0)
  await expect(page.getByTestId('work-map-empty-project:dental-chart-in_motion')).toHaveText(
    'No tasks'
  )
  await expect(page.getByTestId('work-map-empty-project:dental-chart-needs_you')).toHaveCount(0)
  await expect(page.getByTestId('work-map-empty-project:dental-chart-review')).toHaveCount(0)
})

test('reveals the sidebar close hinge only when invited', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const closeSidebar = page.getByRole('button', { name: 'Close sidebar' })
  const closeSidebarChevron = closeSidebar.locator('svg')
  await page.mouse.move(800, 400)
  await expect(closeSidebar).toHaveCSS('opacity', '0')
  await expect(closeSidebar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')

  const closeBounds = await closeSidebar.boundingBox()
  expect(closeBounds).not.toBeNull()
  if (!closeBounds) throw new Error('Sidebar close hinge bounds missing')
  expect(closeBounds.width).toBeGreaterThanOrEqual(32)
  expect(closeBounds.height).toBeGreaterThanOrEqual(44)

  await closeSidebar.hover()
  await expect(closeSidebar).toHaveCSS('opacity', '1')
  await expect(closeSidebarChevron).toBeVisible()

  await closeSidebar.focus()
  await expect(closeSidebar).toHaveCSS('opacity', '1')
  await closeSidebar.click()
  const openSidebar = page.getByRole('button', { name: 'Open sidebar' })
  await expect(openSidebar).toBeVisible()
  const reopenCenterOffsets = await page.evaluate(async () => {
    const offsets: number[] = []
    for (let frame = 0; frame < 6; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const reopen = document.querySelector<HTMLElement>('[data-test-id="open-layers-panel"]')
      if (!reopen) continue
      const bounds = reopen.getBoundingClientRect()
      offsets.push(Math.abs(bounds.top + bounds.height / 2 - window.innerHeight / 2))
    }
    return offsets
  })
  expect(reopenCenterOffsets.length).toBeGreaterThan(0)
  expect(Math.max(...reopenCenterOffsets)).toBeLessThanOrEqual(1)
  const openBounds = await openSidebar.boundingBox()
  expect(openBounds).not.toBeNull()
  if (!openBounds) throw new Error('Sidebar reopen tab bounds missing')
  expect(Math.round(openBounds.x)).toBe(0)
  expect(Math.round(openBounds.width)).toBe(28)
  expect(Math.round(openBounds.height)).toBe(44)
  await expect(page.getByRole('toolbar', { name: 'Sidebar' })).toBeVisible()
  await expect(page.getByTestId('sidebar-compact-tab-drag-handle')).toHaveCount(0)
  await openSidebar.focus()
  await expect
    .poll(() => openSidebar.evaluate((element) => getComputedStyle(element).boxShadow))
    .not.toBe('none')
  await openSidebar.click()
  await expect(page.getByRole('button', { name: 'Close sidebar' })).toBeVisible()
})

test('aligns subprojects and hides them with collapsed parents', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const parentProjectRow = page.getByTestId('work-map-project-row-project:dental-chart')
  const childProject = page.getByRole('button', { name: 'Expand Work Map' })
  const todoIcon = page
    .getByText('Todo', { exact: true })
    .locator('..')
    .locator('svg[data-iconly="time-circle"]')
  const childIcon = childProject.locator('img')
  await expect(childProject).toBeVisible()
  const [todoIconBounds, childIconBounds] = await Promise.all([
    todoIcon.boundingBox(),
    childIcon.boundingBox()
  ])
  expect(todoIconBounds).not.toBeNull()
  expect(childIconBounds).not.toBeNull()
  if (!todoIconBounds || !childIconBounds) throw new Error('Work Map icon bounds missing')
  expect(childIconBounds.x + childIconBounds.width / 2).toBeCloseTo(
    todoIconBounds.x + todoIconBounds.width / 2,
    1
  )

  const parentProjectBounds = await parentProjectRow.boundingBox()
  expect(parentProjectBounds).not.toBeNull()
  if (!parentProjectBounds) throw new Error('Dental Chart project row bounds missing')
  const blankRowPosition = {
    x: Math.round(parentProjectBounds.width * 0.55),
    y: Math.round(parentProjectBounds.height / 2)
  }

  await parentProjectRow.click({ position: blankRowPosition })
  await expect(childProject).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Expand Dental Chart' })).toBeVisible()
  await parentProjectRow.click({ position: blankRowPosition })
  await expect(page.getByRole('button', { name: 'Expand Work Map' })).toBeVisible()
})

test('reveals the collapsed Finished disclosure on hover', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const finishedRow = page.getByRole('button', { name: 'Finished' })
  const collapsedCaret = finishedRow.locator('svg[data-iconly="arrow-right"]')
  await expect(collapsedCaret).toHaveCSS('opacity', '0')
  await finishedRow.hover()
  await expect(collapsedCaret).toHaveCSS('opacity', '1')
})

test('reuses the Todo hover plus and keeps project actions even', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const parentProjectRow = page.getByTestId('work-map-project-row-project:dental-chart')
  const todoAddIcon = page.getByTestId('work-map-add-todo-project:dental-chart').locator('svg')
  const projectNewChatIcon = page
    .getByTestId('work-map-new-chat-project:dental-chart')
    .locator('svg')
  const addSubprojectIcon = page
    .getByTestId('work-map-add-subproject-project:dental-chart')
    .locator('svg')
  await parentProjectRow.hover()

  const [todoMarkup, projectMarkup, projectBounds, subprojectBounds] = await Promise.all([
    todoAddIcon.evaluate((icon) => icon.innerHTML),
    projectNewChatIcon.evaluate((icon) => icon.innerHTML),
    projectNewChatIcon.boundingBox(),
    addSubprojectIcon.boundingBox()
  ])
  expect(projectMarkup).toBe(todoMarkup)
  expect(projectBounds).not.toBeNull()
  expect(subprojectBounds).not.toBeNull()
  if (!projectBounds || !subprojectBounds) throw new Error('Project action icon bounds missing')
  expect(projectBounds.width).toBe(subprojectBounds.width)
  expect(projectBounds.height).toBe(subprojectBounds.height)
  expect(projectBounds.x).toBeLessThan(subprojectBounds.x)
})

test('adds breathing room above the sidebar utilities without shrinking them', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const utilityTabs = page.getByRole('tablist', { name: 'Sidebar utilities' })
  await expect(utilityTabs).toHaveCSS('margin-top', '12px')
  await expect(utilityTabs).toHaveCSS('height', '40px')
})

test('balances the Work map title optical top and side spacing', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const spacing = await page.getByTestId('work-map-title').evaluate((element) => {
    const header = element.parentElement?.parentElement?.parentElement
    const actions = header?.querySelectorAll('button')
    const lastAction = actions?.[actions.length - 1]
    if (!header || !lastAction) throw new Error('Work Map header structure unavailable')
    const headerBounds = header.getBoundingClientRect()
    const lastActionBounds = lastAction.getBoundingClientRect()
    const titleRange = document.createRange()
    titleRange.selectNodeContents(element)
    const titleBounds = titleRange.getBoundingClientRect()
    return {
      left: titleBounds.left - headerBounds.left,
      right: headerBounds.right - lastActionBounds.right,
      top: titleBounds.top - headerBounds.top
    }
  })

  expect(Math.abs(spacing.top - spacing.left)).toBeLessThan(1)
  expect(spacing.right).toBe(spacing.left)
})

test('closes Work map search when clicking outside it', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const searchToggle = page.getByTestId('work-map-search-toggle')
  const searchInput = page.getByTestId('work-map-search-field').locator('input')
  await searchToggle.click()
  await searchInput.fill('Dental')
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(searchInput).toHaveValue('Dental')

  await page.getByText('Pinned', { exact: true }).click()
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(searchInput).toHaveValue('')
  await expect(searchToggle).not.toBeFocused()
})

test('uses a pointer for chats until the row is pressed', async ({ page }) => {
  await mockAgentShell(page, {
    threads: [paginationThread(0)],
    workMap: { placements: [], projects: [], revision: 1, todos: [] }
  })
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  await page.getByRole('button', { name: 'Expand Misc chats' }).click()
  const chat = page.getByTestId('agent-chat-thread-agent:pagination-0')
  await expect(chat).toHaveCSS('cursor', 'pointer')
  await chat.dispatchEvent('pointerdown', { button: 0, pointerId: 1 })
  await expect(chat).toHaveCSS('cursor', 'grabbing')
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 })))
  await expect(chat).toHaveCSS('cursor', 'pointer')
})

test('expands Work map search left from the ordered header actions', async ({ page }) => {
  await mockAgentShell(page)
  await page.goto('/?test&no-rulers')
  await new CanvasHelper(page).waitForInit()

  const searchField = page.getByTestId('work-map-search-field')
  const searchToggle = page.getByTestId('work-map-search-toggle')
  const newChat = page.getByTestId('agent-thread-new')
  const newProject = page.getByTestId('work-map-new-project')
  const searchInput = page.getByRole('textbox', { name: 'Search work map' })
  const title = page.getByTestId('work-map-title')
  const [searchToggleBounds, newChatBounds, newProjectBounds] = await Promise.all([
    searchToggle.boundingBox(),
    newChat.boundingBox(),
    newProject.boundingBox()
  ])
  expect(searchToggleBounds).not.toBeNull()
  expect(newChatBounds).not.toBeNull()
  expect(newProjectBounds).not.toBeNull()
  if (!searchToggleBounds || !newChatBounds || !newProjectBounds) {
    throw new Error('Work Map header action bounds missing')
  }
  expect(searchToggleBounds.x).toBeLessThan(newChatBounds.x)
  expect(newChatBounds.x).toBeLessThan(newProjectBounds.x)
  await expect(searchField).toHaveCSS('width', '0px')

  await searchToggle.click()
  await expect(searchInput).toBeFocused()
  await expect(searchField).toHaveCSS('opacity', '1')
  const expandedBounds = await searchField.boundingBox()
  expect(expandedBounds).not.toBeNull()
  if (!expandedBounds) throw new Error('Expanded Work Map search bounds missing')
  expect(expandedBounds.width).toBeGreaterThan(100)
  await expect(title).toHaveCSS('opacity', '0')

  await searchInput.press('Escape')
  await expect(searchToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(searchField).toHaveCSS('width', '0px')
  await expect(title).toHaveCSS('opacity', '1')
})
