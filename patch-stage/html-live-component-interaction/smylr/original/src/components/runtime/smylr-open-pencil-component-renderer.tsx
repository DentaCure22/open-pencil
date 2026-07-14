'use client'

import type { ComponentType } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SmylrOpenPencilBridgeRuntime } from '@/components/runtime/smylr-open-pencil-bridge-runtime'

export const SMYLR_OPENPENCIL_COMPONENT_FIXTURE_IDS = [
  'badge',
  'button',
  'card',
  'checkbox',
  'select',
  'separator',
  'switch',
  'table',
] as const

type FixtureId = (typeof SMYLR_OPENPENCIL_COMPONENT_FIXTURE_IDS)[number]

function BadgeFixture() {
  return <Badge variant='success'>Ready</Badge>
}

function ButtonFixture() {
  return (
    <Button data-openpencil-embedded-fixture='button' size='lg'>
      Save changes
    </Button>
  )
}

function CardFixture() {
  return (
    <Card variant='flat' surface='decorative' className='w-full max-w-md'>
      <CardHeader>
        <CardTitle>Medical readiness</CardTitle>
        <CardDescription>Chairside blockers and next action</CardDescription>
        <CardAction>
          <Badge variant='warning'>Review</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className='text-sm font-medium'>Pre-op clearance</div>
      </CardContent>
    </Card>
  )
}

function CheckboxFixture() {
  return <Checkbox aria-label='Reviewed latest PA' defaultChecked />
}

function SelectFixture() {
  return (
    <Select>
      <SelectTrigger className='w-64' aria-label='Route patient task'>
        <SelectValue placeholder='Route patient task' />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Clinical queue</SelectLabel>
          <SelectItem value='hygiene'>Hygiene recall</SelectItem>
          <SelectItem value='endo'>Endo consult</SelectItem>
          <SelectItem value='crown'>Crown seat</SelectItem>
        </SelectGroup>
        <SelectSeparator />
      </SelectContent>
    </Select>
  )
}

function SeparatorFixture() {
  return (
    <div className='w-80'>
      <Separator />
    </div>
  )
}

function SwitchFixture() {
  return <Switch aria-label='Appointment reminders' defaultChecked />
}

const appointments = [
  ['Maya N.', 'D2740 Crown', '60', '$640.00', 'Ready'],
  ['Jon B.', 'D0120 Recall', '45', '$0.00', 'Checked in'],
  ['Ari S.', 'D3310 Endo', '90', '$1,280.00', 'Needs review'],
] as const

function TableFixture() {
  return (
    <Table containerClassName='max-w-3xl' aria-label='Appointment queue'>
      <TableCaption>Today&apos;s chairside queue</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Patient</TableHead>
          <TableHead>Procedure</TableHead>
          <TableHead className='text-right'>Minutes</TableHead>
          <TableHead className='text-right'>Balance</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {appointments.map(([patient, procedure, duration, balance, status]) => (
          <TableRow key={patient}>
            <TableCell className='font-medium'>{patient}</TableCell>
            <TableCell>{procedure}</TableCell>
            <TableCell className='text-right tabular-nums'>{duration}</TableCell>
            <TableCell className='text-right tabular-nums'>{balance}</TableCell>
            <TableCell>{status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

const FIXTURES: Record<FixtureId, ComponentType> = {
  badge: BadgeFixture,
  button: ButtonFixture,
  card: CardFixture,
  checkbox: CheckboxFixture,
  select: SelectFixture,
  separator: SeparatorFixture,
  switch: SwitchFixture,
  table: TableFixture,
}

const EMBEDDED_COMPONENT_CSS = `
html, body { margin: 0; background: transparent; }
[data-smylr-component-renderer-embedded='true'] {
  display: inline-flex;
  min-width: 0;
  min-height: 0;
  align-items: center;
  justify-content: center;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}
[data-smylr-component-renderer-embedded='true'] > div {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
[data-openpencil-embedded-fixture='button'] {
  appearance: none;
  display: inline-flex;
  height: 40px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 8px;
  padding: 0 18px;
  background: oklch(0.55 0.24 262);
  color: oklch(0.99 0.002 262);
  font: inherit;
  font-size: 14px;
  font-weight: 650;
  line-height: 1;
  white-space: nowrap;
}
[data-openpencil-embedded-fixture='button']:hover {
  background: oklch(0.51 0.23 262);
}
[data-openpencil-embedded-fixture='button']:focus-visible {
  outline: 2px solid oklch(0.72 0.16 262);
  outline-offset: 2px;
}
`

export function SmylrOpenPencilComponentRenderer({
  componentId,
  embedded = false,
}: {
  componentId: string
  embedded?: boolean
}) {
  const Fixture = FIXTURES[componentId as FixtureId]
  const mainClassName = embedded
    ? 'bg-transparent text-foreground inline-flex min-h-0 min-w-0 items-center justify-center font-sans antialiased'
    : 'bg-background text-foreground min-h-screen p-6 font-sans antialiased'
  const contentClassName = embedded
    ? 'inline-flex items-center justify-center'
    : 'flex min-h-[calc(100vh-3rem)] items-center justify-center'

  return (
    <>
      {embedded ? (
        <style data-smylr-openpencil-embedded-critical='true'>
          {EMBEDDED_COMPONENT_CSS}
        </style>
      ) : null}
      <main
        data-smylr-component-renderer-root='true'
        data-smylr-component-renderer-embedded={embedded ? 'true' : 'false'}
        className={mainClassName}
      >
        <div className={contentClassName}>
          {Fixture ? (
            <Fixture />
          ) : (
            <p data-smylr-openpencil-ignore='true' className='text-muted-foreground text-sm'>
              Unknown component fixture: {componentId}
            </p>
          )}
        </div>
      </main>
      <SmylrOpenPencilBridgeRuntime />
    </>
  )
}
