import { ChevronDown, ChevronRight, File, FileCode2, Folder, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  readAgentWorkspaceFile,
  searchAgentWorkspaceFiles,
  type AgentWorkspaceFile
} from '@/app/agent-chat/workspace'

type FileTreeNode = {
  children: Map<string, FileTreeNode>
  file: boolean
  name: string
  path: string
}

function fileTree(files: AgentWorkspaceFile[]): FileTreeNode[] {
  const root = new Map<string, FileTreeNode>()
  for (const file of files) {
    let level = root
    const parts = file.path.split('/')
    parts.forEach((name, index) => {
      const currentPath = parts.slice(0, index + 1).join('/')
      let node = level.get(name)
      if (!node) {
        node = {
          children: new Map(),
          file: index === parts.length - 1,
          name,
          path: currentPath
        }
        level.set(name, node)
      }
      level = node.children
    })
  }
  return [...root.values()].sort(compareTreeNodes)
}

function compareTreeNodes(left: FileTreeNode, right: FileTreeNode): number {
  if (left.file !== right.file) return left.file ? 1 : -1
  return left.name.localeCompare(right.name)
}

function FileTree(props: {
  depth?: number
  nodes: FileTreeNode[]
  selectedPath: string
  onSelect: (path: string) => void
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const depth = props.depth ?? 0
  return props.nodes.map((node) => {
    const isCollapsed = collapsed.has(node.path)
    const children = [...node.children.values()].sort(compareTreeNodes)
    let disclosure = <span className="size-3 shrink-0" />
    if (!node.file) {
      disclosure = isCollapsed ? (
        <ChevronRight className="size-3 shrink-0" />
      ) : (
        <ChevronDown className="size-3 shrink-0" />
      )
    }
    return (
      <div key={node.path}>
        <button
          type="button"
          title={node.path}
          className={`flex h-7 w-full min-w-0 items-center gap-1.5 pr-2 text-left text-[11px] hover:bg-hover ${props.selectedPath === node.path ? 'bg-chrome-control-active text-surface' : 'text-muted'}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => {
            if (node.file) props.onSelect(node.path)
            else {
              setCollapsed((current) => {
                const next = new Set(current)
                if (next.has(node.path)) next.delete(node.path)
                else next.add(node.path)
                return next
              })
            }
          }}
        >
          {disclosure}
          {node.file ? (
            <File className="size-3.5 shrink-0" strokeWidth={1.5} />
          ) : (
            <Folder className="size-3.5 shrink-0" strokeWidth={1.5} />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {!node.file && !isCollapsed ? (
          <FileTree
            depth={depth + 1}
            nodes={children}
            selectedPath={props.selectedPath}
            onSelect={props.onSelect}
          />
        ) : null}
      </div>
    )
  })
}

export default function T3FilesSurface() {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<AgentWorkspaceFile[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [content, setContent] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const tree = useMemo(() => fileTree(files), [files])
  let fileList = <p className="px-3 py-2 text-[11px] text-muted">No matching files.</p>
  if (loading && files.length === 0) {
    fileList = <p className="px-3 py-2 text-[11px] text-muted">Loading files…</p>
  } else if (tree.length) {
    fileList = (
      <FileTree
        nodes={tree}
        selectedPath={selectedPath}
        onSelect={(path) => void selectFile(path)}
      />
    )
  }

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      setLoading(true)
      const loadFiles = async () => {
        try {
          const next = await searchAgentWorkspaceFiles(query, 250)
          if (cancelled) return
          setFiles(next)
          setError('')
        } catch (caught) {
          if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
          if (!cancelled) setLoading(false)
        }
      }
      void loadFiles()
    }, 120)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [query])

  async function selectFile(path: string) {
    setSelectedPath(path)
    setContent('')
    setError('')
    try {
      const file = await readAgentWorkspaceFile(path)
      setContent(file.content)
      setTruncated(file.truncated)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <div
      className="grid min-h-0 flex-1 grid-cols-[minmax(10rem,36%)_minmax(0,1fr)] bg-agent-surface"
      data-test-id="t3-files-surface"
    >
      <div className="border-border/50 flex min-h-0 flex-col border-r">
        <div className="border-border/50 flex h-10 shrink-0 items-center border-b px-2">
          <label className="border-chrome-control-border bg-chrome-control flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[7px] border px-2">
            <Search className="size-3.5 shrink-0 text-muted" />
            <input
              value={query}
              aria-label="Search workspace files"
              placeholder="Search files"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-surface outline-none placeholder:text-muted/70"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="scrollbar-panel min-h-0 flex-1 overflow-auto py-1">{fileList}</div>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col">
        {selectedPath ? (
          <>
            <div className="border-border/50 flex h-10 shrink-0 items-center gap-2 border-b px-3 text-[11px] text-surface">
              <FileCode2 className="size-3.5 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate font-mono">{selectedPath}</span>
              {truncated ? <span className="text-[10px] text-muted">truncated</span> : null}
            </div>
            <pre className="scrollbar-panel min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-5 whitespace-pre text-surface/90 select-text">
              {content}
            </pre>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
            <FileCode2 className="mb-3 size-8 text-muted/40" strokeWidth={1.3} />
            <p className="text-[13px] font-medium text-surface">Select a file</p>
            <p className="mt-1 text-[12px] text-muted">
              Browse and read files from this workspace.
            </p>
          </div>
        )}
        {error ? (
          <p className="border-border/50 border-t px-3 py-2 text-[11px] text-red-400">{error}</p>
        ) : null}
      </div>
    </div>
  )
}
