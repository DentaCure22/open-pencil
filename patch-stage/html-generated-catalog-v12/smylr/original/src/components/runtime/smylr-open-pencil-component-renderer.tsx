'use client'

import { useState, type ComponentType } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import rendererCatalogJson from '../../../archive/agent-tooling/open-pencil-base/src/app/smylr-component-library/renderer-catalog.generated.json'

type RendererCatalog = {
  fixtures: Array<{ fixtureId: string }>
}

const rendererCatalog = rendererCatalogJson as RendererCatalog

function AlertFixture() {
  return (
    <Alert className='w-[420px]'>
      <AlertTitle>Ready for review</AlertTitle>
      <AlertDescription>All required clinical fields are complete.</AlertDescription>
    </Alert>
  )
}

function BadgeFixture() {
  return <Badge variant='success'>Ready</Badge>
}

function ButtonFixture() {
  const [saved, setSaved] = useState(false)

  return (
    <Button
      aria-pressed={saved}
      data-openpencil-embedded-fixture='button'
      size='lg'
      onClick={() => setSaved(true)}
    >
      {saved ? 'Saved' : 'Save changes'}
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

function InputFixture() {
  const [value, setValue] = useState('')

  return (
    <Input
      aria-label='Patient search'
      className='w-80'
      placeholder='Search patients'
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  )
}

function ProgressFixture() {
  return (
    <Progress
      aria-label='Import progress'
      data-openpencil-fixture='progress'
      value={68}
      className='w-80'
    />
  )
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

function TabsFixture() {
  return (
    <Tabs defaultValue='overview' className='w-[360px]'>
      <TabsList>
        <TabsTrigger value='overview'>Overview</TabsTrigger>
        <TabsTrigger value='activity'>Activity</TabsTrigger>
      </TabsList>
      <TabsContent value='overview' className='text-muted-foreground text-sm'>
        3 items are ready for review.
      </TabsContent>
      <TabsContent value='activity' className='text-muted-foreground text-sm'>
        Updated a moment ago.
      </TabsContent>
    </Tabs>
  )
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

const FIXTURES = {
  alert: AlertFixture,
  badge: BadgeFixture,
  button: ButtonFixture,
  card: CardFixture,
  checkbox: CheckboxFixture,
  input: InputFixture,
  progress: ProgressFixture,
  select: SelectFixture,
  separator: SeparatorFixture,
  switch: SwitchFixture,
  table: TableFixture,
  tabs: TabsFixture,
} satisfies Record<string, ComponentType>

type FixtureId = keyof typeof FIXTURES

export const SMYLR_OPENPENCIL_COMPONENT_FIXTURE_IDS = rendererCatalog.fixtures.map(
  (fixture) => fixture.fixtureId
)

export function SmylrOpenPencilComponentRenderer({
  componentId,
  embedded = false,
}: {
  componentId: string
  embedded?: boolean
}) {
  const Fixture = FIXTURES[componentId as FixtureId]
  const mainClassName = embedded
    ? 'bg-transparent text-foreground h-screen w-screen overflow-visible font-sans antialiased'
    : 'bg-background text-foreground min-h-screen p-6 font-sans antialiased'
  const contentClassName = embedded
    ? 'flex size-full items-start justify-start'
    : 'flex min-h-[calc(100vh-3rem)] items-center justify-center'

  return (
    <>
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
