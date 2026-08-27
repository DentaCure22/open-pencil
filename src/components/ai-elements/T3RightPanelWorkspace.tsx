import {
  Activity,
  ChevronRight,
  FileDiff,
  Files,
  Globe2,
  Layers3,
  ListTodo,
  PanelRightOpen,
  PackageOpen,
  Plus,
  TerminalSquare,
  X
} from 'lucide-react'
import { type CSSProperties, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { AgentRightPanelSurface } from '@/app/agent-chat/right-panel'
import { IS_BROWSER } from '@/constants'

import { useT3PanelWidth } from './t3-right-panel-resize'
import { type T3DiffReviewComment } from './t3-right-panel.logic'
import T3BrowserSurface from './T3BrowserSurface'
import T3DiffSurface from './T3DiffSurface'
import T3FilesSurface from './T3FilesSurface'
import T3TerminalSurface from './T3TerminalSurface'
import type { AiTurnChanges } from './types'

// Source-aligned with T3 Code's RightPanelTabs, PreviewPanelShell, DiffPanel,
// AnnotatableCodeView, and DiffCommentAnnotation at revision
// e67074f80933a27bd3cdc4e24f486358407690fb (MIT).

type RightPanelSurface = AgentRightPanelSurface

export interface T3RightPanelWorkspaceProps {
  changes: AiTurnChanges | null
  comments: T3DiffReviewComment[]
  activationNonce: number
  open: boolean
  showReopen: boolean
  requestedSurface: RightPanelSurface
  selectedPath?: string
  threadId: string
  onAddComment: (comment: Omit<T3DiffReviewComment, 'id'>) => void
  onClose: () => void
  onOpen: () => void
  onDeleteComment: (commentId: string) => void
  onSelectFile: (path: string) => void
  onSurfaceHostChange: (
    surface: 'activity' | 'assets' | 'layers' | 'object',
    host: HTMLDivElement | null
  ) => void
  onSurfaceChange: (surface: RightPanelSurface) => void
}

type SurfaceAction = {
  icon: typeof Globe2
  kind: RightPanelSurface
  label: string
  shortcut: string
}

const DIFF_SURFACE_ACTION: SurfaceAction = {
  icon: FileDiff,
  kind: 'diff',
  label: 'Diff',
  shortcut: 'D'
}

const SURFACE_ACTIONS: SurfaceAction[] = [
  { icon: ListTodo, kind: 'object', label: 'Object', shortcut: 'O' },
  { icon: Layers3, kind: 'layers', label: 'Layers', shortcut: 'L' },
  { icon: PackageOpen, kind: 'assets', label: 'Assets', shortcut: 'A' },
  { icon: Activity, kind: 'activity', label: 'Activity', shortcut: 'V' },
  { icon: Globe2, kind: 'browser', label: 'Browser', shortcut: 'B' },
  { icon: TerminalSquare, kind: 'terminal', label: 'Terminal', shortcut: 'T' },
  { icon: Files, kind: 'files', label: 'Files', shortcut: 'F' },
  DIFF_SURFACE_ACTION
]

const ADD_SURFACE_MENU_WIDTH = 176
const ADD_SURFACE_MENU_HEIGHT = SURFACE_ACTIONS.length * 32 + 14
const ADD_SURFACE_MENU_VIEWPORT_INSET = 8

interface AddSurfaceMenuPosition {
  left: number
  top: number
  width: number
}

function surfaceAction(kind: RightPanelSurface) {
  return SURFACE_ACTIONS.find((action) => action.kind === kind) ?? DIFF_SURFACE_ACTION
}

function AddSurfaceMenu(props: {
  open: boolean
  menuRef: RefObject<HTMLDivElement | null>
  position: AddSurfaceMenuPosition | null
  onClose: () => void
  onSelect: (kind: RightPanelSurface) => void
}) {
  if (!props.open || !props.position || !IS_BROWSER) return null
  return createPortal(
    <div
      ref={props.menuRef}
      id="t3-right-panel-add-menu"
      role="menu"
      style={props.position}
      className="border-chrome-border bg-chrome-raised shadow-chrome-menu pointer-events-auto fixed z-[90] rounded-[10px] border p-1.5 backdrop-blur-xl"
      data-test-id="t3-right-panel-add-menu"
    >
      {SURFACE_ACTIONS.map((action) => {
        const Icon = action.icon
        return (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            className="flex h-8 w-full items-center gap-2 rounded-[7px] px-2 text-left text-[12px] text-surface hover:bg-hover"
            onClick={() => {
              props.onSelect(action.kind)
              props.onClose()
            }}
          >
            <Icon className="size-3.5" strokeWidth={1.6} />
            <span className="flex-1">{action.label}</span>
            <kbd className="text-[10px] text-muted">{action.shortcut}</kbd>
          </button>
        )
      })}
    </div>,
    document.body
  )
}

// oxlint-disable-next-line eslint/complexity -- This island coordinates T3's panel shell and mounted surface states.
export default function T3RightPanelWorkspace(props: T3RightPanelWorkspaceProps) {
  const { narrow, resizeHandlers, resizing, width } = useT3PanelWidth()
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [surfaces, setSurfaces] = useState<RightPanelSurface[]>(['diff'])
  const [activeSurface, setActiveSurface] = useState<RightPanelSurface>('diff')
  const panel = useRef<HTMLElement>(null)
  const addMenuButton = useRef<HTMLButtonElement>(null)
  const addMenu = useRef<HTMLDivElement>(null)
  const [addMenuPosition, setAddMenuPosition] = useState<AddSurfaceMenuPosition | null>(null)

  function openSurface(kind: RightPanelSurface, notify = false) {
    setSurfaces((current) => {
      if (kind === 'object') {
        return [
          'object',
          'layers',
          'assets',
          ...current.filter((surface) => !['assets', 'diff', 'layers', 'object'].includes(surface))
        ]
      }
      const requested: RightPanelSurface[] =
        kind === 'layers' || kind === 'assets' ? ['layers', 'assets'] : [kind]
      return requested.reduce<RightPanelSurface[]>(
        (next, surface) => (next.includes(surface) ? next : [...next, surface]),
        current
      )
    })
    setActiveSurface(kind)
    if (notify) props.onSurfaceChange(kind)
  }

  function closeSurface(kind: RightPanelSurface) {
    setSurfaces((current) => {
      const index = current.indexOf(kind)
      const next = current.filter((surface) => surface !== kind)
      if (activeSurface === kind && next.length) {
        const fallback = next[Math.min(index, next.length - 1)] ?? 'diff'
        setActiveSurface(fallback)
        props.onSurfaceChange(fallback)
      }
      if (!next.length) props.onClose()
      return next
    })
  }

  useEffect(() => {
    let nextSurfaces: RightPanelSurface[] = ['diff']
    if (props.requestedSurface === 'object') {
      nextSurfaces = ['object', 'layers', 'assets']
    } else if (props.requestedSurface === 'layers' || props.requestedSurface === 'assets') {
      nextSurfaces = ['diff', 'layers', 'assets']
    } else if (props.requestedSurface !== 'diff') {
      nextSurfaces = ['diff', props.requestedSurface]
    }
    setSurfaces(nextSurfaces)
    setActiveSurface(props.requestedSurface)
  }, [props.threadId])

  useEffect(() => {
    if (props.activationNonce > 0) openSurface(props.requestedSurface)
  }, [props.activationNonce])

  useEffect(() => {
    if (props.open && surfaces.length === 0) openSurface('diff')
  }, [props.open, surfaces.length])

  useEffect(() => {
    if (!props.open) setAddMenuOpen(false)
  }, [props.open])

  const positionAddMenu = useCallback(() => {
    if (!IS_BROWSER) return
    const anchor = addMenuButton.current?.getBoundingClientRect()
    if (!anchor) return

    const menuWidth = Math.min(
      ADD_SURFACE_MENU_WIDTH,
      window.innerWidth - ADD_SURFACE_MENU_VIEWPORT_INSET * 2
    )
    const maxLeft = Math.max(
      ADD_SURFACE_MENU_VIEWPORT_INSET,
      window.innerWidth - menuWidth - ADD_SURFACE_MENU_VIEWPORT_INSET
    )
    const maxTop = Math.max(
      ADD_SURFACE_MENU_VIEWPORT_INSET,
      window.innerHeight - ADD_SURFACE_MENU_HEIGHT - ADD_SURFACE_MENU_VIEWPORT_INSET
    )

    setAddMenuPosition({
      left: Math.min(Math.max(ADD_SURFACE_MENU_VIEWPORT_INSET, anchor.right - menuWidth), maxLeft),
      top: Math.min(Math.max(ADD_SURFACE_MENU_VIEWPORT_INSET, anchor.bottom + 4), maxTop),
      width: menuWidth
    })
  }, [])

  useEffect(() => {
    if (!addMenuOpen || !IS_BROWSER) return undefined
    positionAddMenu()
    const resizeObserver = new ResizeObserver(positionAddMenu)
    if (panel.current) resizeObserver.observe(panel.current)
    window.addEventListener('resize', positionAddMenu)
    window.addEventListener('scroll', positionAddMenu, true)
    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', positionAddMenu)
      window.removeEventListener('scroll', positionAddMenu, true)
    }
  }, [addMenuOpen, positionAddMenu])

  useEffect(() => {
    if (!props.open) return undefined
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (addMenuOpen) setAddMenuOpen(false)
        else props.onClose()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('keydown', keydown)
    }
  }, [addMenuOpen, props.onClose])

  useEffect(() => {
    if (!addMenuOpen) return undefined
    const pointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !addMenu.current?.contains(target)) {
        setAddMenuOpen(false)
      }
    }
    window.addEventListener('pointerdown', pointerDown)
    return () => {
      window.removeEventListener('pointerdown', pointerDown)
    }
  }, [addMenuOpen])

  const panelStyle: CSSProperties = {
    bottom: 12,
    right: 12,
    top: 12,
    width: narrow ? 'min(88vw, 24rem)' : width
  }

  return (
    <div
      className={`fixed inset-0 z-[70] transition-colors duration-200 ${props.open && narrow ? 'pointer-events-auto bg-black/15' : 'pointer-events-none bg-transparent'}`}
      data-test-id="t3-right-panel-layer"
      data-t3-source-revision="e67074f80933a27bd3cdc4e24f486358407690fb"
      onMouseDown={(event) => {
        if (narrow && event.target === event.currentTarget) props.onClose()
      }}
    >
      {props.open && !narrow ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize right workspace"
          data-test-id="t3-right-panel-resize-handle"
          style={{
            backgroundColor: 'rgb(0 0 0 / 0.005)',
            bottom: 12,
            cursor: 'col-resize',
            right: width - 8,
            top: 12
          }}
          className="pointer-events-auto fixed z-[71] w-5 touch-none select-none"
          {...resizeHandlers}
        />
      ) : null}
      {!narrow && (props.showReopen || props.open) ? (
        <div
          aria-hidden={props.open}
          data-test-id="right-sidebar-toggle-motion"
          inert={props.open}
          className={`bg-chrome/90 shadow-sm fixed top-1/2 right-3 z-[71] h-11 w-7 -translate-y-1/2 overflow-clip rounded-[11px] backdrop-blur-xl transition-opacity motion-reduce:transition-none ${props.open ? 'pointer-events-none opacity-0 duration-200 ease-in-out' : 'pointer-events-auto opacity-100 delay-75 duration-200 ease-in-out'}`}
        >
          <button
            type="button"
            aria-label="Open right sidebar"
            data-test-id="open-right-panel"
            title="Open right sidebar"
            className="border-chrome-border absolute inset-0 flex cursor-pointer items-center justify-center rounded-[10px] border text-muted transition-colors hover:bg-hover/70 hover:text-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-component/35"
            onClick={props.onOpen}
          >
            <PanelRightOpen className="size-4" strokeWidth={1.7} />
          </button>
        </div>
      ) : null}
      {props.open && !narrow ? (
        <button
          type="button"
          aria-label="Close right panel"
          data-right-sidebar-hinge="true"
          data-sidebar-collapse-rail="true"
          data-test-id="close-right-panel-hinge"
          title="Close right panel"
          style={{ right: width + 12 }}
          className="group/right-sidebar-rail pointer-events-auto fixed inset-y-0 z-[72] w-5 cursor-pointer bg-transparent text-muted/75 transition-colors duration-150 hover:text-surface focus-visible:text-surface focus-visible:outline-none motion-reduce:transition-none"
          onClick={props.onClose}
        >
          <span
            data-sidebar-collapse-arrow="true"
            className="peer/right-sidebar-arrow pointer-events-auto absolute top-1/2 right-0 flex size-5 -translate-y-1/2 items-center justify-center rounded-[5px] opacity-0 transition-[opacity,box-shadow] duration-150 group-hover/right-sidebar-rail:opacity-100 group-focus-visible/right-sidebar-rail:opacity-100 group-focus-visible/right-sidebar-rail:ring-2 group-focus-visible/right-sidebar-rail:ring-component/35 motion-reduce:transition-none [@media(hover:none)]:opacity-100"
          >
            <ChevronRight className="size-4" strokeWidth={1.7} />
          </span>
          <span
            data-sidebar-collapse-divider="true"
            aria-hidden="true"
            className="bg-chrome-border pointer-events-none absolute inset-y-0 right-0 w-px opacity-0 transition-opacity duration-150 group-hover/right-sidebar-rail:opacity-35 group-focus-visible/right-sidebar-rail:opacity-35 peer-hover/right-sidebar-arrow:opacity-0! motion-reduce:transition-none"
          />
        </button>
      ) : null}
      <aside
        ref={panel}
        aria-hidden={!props.open}
        data-test-id="t3-right-panel"
        data-state={props.open ? 'open' : 'closed'}
        data-resizing={resizing ? 'true' : 'false'}
        style={panelStyle}
        className={`border-chrome-border bg-sidebar shadow-chrome-panel pointer-events-auto fixed flex min-h-0 min-w-0 max-w-full flex-col overflow-hidden rounded-[14px] border [--color-agent-surface:transparent] motion-reduce:transition-none ${resizing ? 'transition-none' : 'transition-[translate,opacity,width,left] duration-300 ease-in-out'} ${props.open ? 'translate-x-0 opacity-100' : 'translate-x-[calc(100%+1rem)] opacity-0'}`}
      >
        <div
          className="relative flex h-11 min-h-11 min-w-0 shrink-0 items-center overflow-hidden px-3"
          data-right-panel-tabbar
        >
          <div
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-test-id="t3-right-panel-tabs-scroll"
          >
            {surfaces.map((surface) => {
              const action = surfaceAction(surface)
              const Icon = action.icon
              return (
                <div
                  key={surface}
                  className={`group/tab flex h-7 max-w-40 shrink-0 items-center rounded-[8px] border px-1 text-[12px] transition-[background-color,border-color,color] ${activeSurface === surface ? 'border-transparent bg-chrome-control text-surface' : 'border-transparent text-muted hover:bg-hover hover:text-surface'}`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-[5px] px-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/25"
                    onClick={() => {
                      setActiveSurface(surface)
                      props.onSurfaceChange(surface)
                    }}
                  >
                    <Icon className="size-3.5 shrink-0" strokeWidth={1.65} />
                    <span className="truncate">{action.label}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Close ${action.label}`}
                    className="flex size-4 shrink-0 items-center justify-center rounded-[4px] opacity-0 outline-none transition-opacity group-hover/tab:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-accent/25"
                    onClick={() => closeSurface(surface)}
                  >
                    <X className="size-3" strokeWidth={1.7} />
                  </button>
                </div>
              )
            })}
          </div>
          <div
            className="bg-sidebar sticky right-0 z-[1] ml-1 shrink-0 pl-1"
            data-test-id="t3-right-panel-add-slot"
          >
            <button
              ref={addMenuButton}
              type="button"
              aria-label="Add panel surface"
              aria-expanded={addMenuOpen}
              aria-controls="t3-right-panel-add-menu"
              className="flex size-7 items-center justify-center rounded-[8px] text-muted transition-colors hover:bg-hover hover:text-surface"
              onClick={() => setAddMenuOpen((current) => !current)}
            >
              <Plus className="size-3.5" />
            </button>
            <AddSurfaceMenu
              open={addMenuOpen}
              menuRef={addMenu}
              position={addMenuPosition}
              onClose={() => setAddMenuOpen(false)}
              onSelect={(surface) => openSurface(surface, true)}
            />
          </div>
        </div>

        <div className={activeSurface === 'diff' ? 'contents' : 'hidden'}>
          <T3DiffSurface
            changes={props.changes}
            comments={props.comments}
            selectedPath={props.selectedPath}
            onAddComment={props.onAddComment}
            onDeleteComment={props.onDeleteComment}
            onSelectFile={props.onSelectFile}
          />
        </div>
        {surfaces.includes('browser') ? (
          <div className={activeSurface === 'browser' ? 'contents' : 'hidden'}>
            <T3BrowserSurface />
          </div>
        ) : null}
        {surfaces.includes('files') ? (
          <div className={activeSurface === 'files' ? 'contents' : 'hidden'}>
            <T3FilesSurface />
          </div>
        ) : null}
        {surfaces.includes('terminal') ? (
          <div className={activeSurface === 'terminal' ? 'contents' : 'hidden'}>
            <T3TerminalSurface active={props.open && activeSurface === 'terminal'} />
          </div>
        ) : null}
        {surfaces.includes('object') ? (
          <div className={activeSurface === 'object' ? 'contents' : 'hidden'}>
            <div
              ref={(host) => props.onSurfaceHostChange('object', host)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-test-id="t3-right-panel-object-host"
            />
          </div>
        ) : null}
        {surfaces.includes('layers') ? (
          <div className={activeSurface === 'layers' ? 'contents' : 'hidden'}>
            <div
              ref={(host) => props.onSurfaceHostChange('layers', host)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-test-id="t3-right-panel-layers-host"
            />
          </div>
        ) : null}
        {surfaces.includes('assets') ? (
          <div className={activeSurface === 'assets' ? 'contents' : 'hidden'}>
            <div
              ref={(host) => props.onSurfaceHostChange('assets', host)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-test-id="t3-right-panel-assets-host"
            />
          </div>
        ) : null}
        {surfaces.includes('activity') ? (
          <div className={activeSurface === 'activity' ? 'contents' : 'hidden'}>
            <div
              ref={(host) => props.onSurfaceHostChange('activity', host)}
              className="flex min-h-0 flex-1 flex-col overflow-hidden"
              data-test-id="t3-right-panel-activity-host"
            />
          </div>
        ) : null}
      </aside>
    </div>
  )
}
