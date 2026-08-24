import type { ReactNode } from 'react'
import { twMerge } from 'tailwind-merge'

import type { ObjectGraphPortDefinition } from '@open-pencil/scene-graph'

import {
  BaseNode,
  BaseNodeContent,
  BaseNodeHeader
} from '@/app/code-object/components/react-flow-ui/base-node'
import { TableBody, TableCell, TableRow } from '@/app/code-object/components/react-flow-ui/table'

export type DatabaseSchemaNodeHeaderProps = {
  children?: ReactNode
}

export function DatabaseSchemaNodeHeader({ children }: DatabaseSchemaNodeHeaderProps) {
  return (
    <BaseNodeHeader className="bg-secondary text-muted-foreground rounded-tl-md rounded-tr-md p-2 text-center text-sm">
      <h2>{children}</h2>
    </BaseNodeHeader>
  )
}

export type DatabaseSchemaNodeBodyProps = {
  children?: ReactNode
}

export function DatabaseSchemaNodeBody({ children }: DatabaseSchemaNodeBodyProps) {
  return (
    <BaseNodeContent className="p-0">
      <table className="border-spacing-10 overflow-visible">
        <TableBody>{children}</TableBody>
      </table>
    </BaseNodeContent>
  )
}

export type DatabaseSchemaTableRowProps = {
  children: ReactNode
  className?: string
  fieldName: string
}

export function DatabaseSchemaTableRow({
  children,
  className,
  fieldName
}: DatabaseSchemaTableRowProps) {
  return (
    <TableRow className={twMerge('relative text-xs', className)} data-openpencil-field={fieldName}>
      {children}
    </TableRow>
  )
}

export type DatabaseSchemaTableCellProps = {
  className?: string
  children?: ReactNode
}

export function DatabaseSchemaTableCell({ className, children }: DatabaseSchemaTableCellProps) {
  return <TableCell className={className}>{children}</TableCell>
}

export type DatabaseSchemaNodeProps = DatabaseSchemaTableCellProps

export function DatabaseSchemaNode({ className, children }: DatabaseSchemaNodeProps) {
  return <BaseNode className={className}>{children}</BaseNode>
}

type DatabaseSchemaField = {
  key: 'FK' | 'PK' | null
  name: string
  required: boolean
  type: string
}

type DatabaseSchemaProps = {
  fields: DatabaseSchemaField[]
  table: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseField(value: unknown): DatabaseSchemaField | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.type !== 'string') {
    return null
  }
  return {
    key: value.key === 'FK' || value.key === 'PK' ? value.key : null,
    name: value.name,
    required: value.required === true,
    type: value.type
  }
}

function parseProps(value: Record<string, unknown>): DatabaseSchemaProps {
  return {
    fields: Array.isArray(value.fields)
      ? value.fields.flatMap((field) => parseField(field) ?? [])
      : [],
    table: typeof value.table === 'string' && value.table.trim() ? value.table : 'Table'
  }
}

function DatabaseSchemaHandleLabel({
  portId,
  position,
  title
}: {
  portId?: string
  position: 'left' | 'right'
  title: string
}) {
  const right = position === 'right'
  return (
    <div
      className={twMerge(
        'relative flex items-center',
        right ? 'flex-row-reverse justify-end p-0' : 'flex-row'
      )}
      data-openpencil-port-id={portId}
    >
      <span
        className={twMerge(
          'text-foreground px-3',
          right ? 'w-full p-0 pr-3 text-right' : undefined
        )}
      >
        {title}
      </span>
    </div>
  )
}

function fieldPortId(
  ports: readonly ObjectGraphPortDefinition[],
  fieldName: string,
  direction: 'input' | 'output'
): string | undefined {
  const label = `${fieldName} ${direction}`
  return ports.find((port) => port.direction === direction && port.label === label)?.id
}

export function ReactFlowDatabaseSchemaNode({
  ports,
  props
}: {
  ports: readonly ObjectGraphPortDefinition[]
  props: Record<string, unknown>
}) {
  const { fields, table } = parseProps(props)
  return (
    <DatabaseSchemaNode className="h-full p-0">
      <DatabaseSchemaNodeHeader>{table}</DatabaseSchemaNodeHeader>
      <DatabaseSchemaNodeBody>
        {fields.map((field) => (
          <DatabaseSchemaTableRow fieldName={field.name} key={field.name}>
            <DatabaseSchemaTableCell className="pr-6 pl-0 font-light">
              <DatabaseSchemaHandleLabel
                portId={fieldPortId(ports, field.name, 'input')}
                position="left"
                title={field.name}
              />
            </DatabaseSchemaTableCell>
            <DatabaseSchemaTableCell className="pr-0 font-thin">
              <DatabaseSchemaHandleLabel
                portId={fieldPortId(ports, field.name, 'output')}
                position="right"
                title={field.type}
              />
            </DatabaseSchemaTableCell>
          </DatabaseSchemaTableRow>
        ))}
      </DatabaseSchemaNodeBody>
    </DatabaseSchemaNode>
  )
}
