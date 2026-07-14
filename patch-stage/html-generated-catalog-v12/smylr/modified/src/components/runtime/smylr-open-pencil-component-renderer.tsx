'use client'

import { useEffect, useState, type ComponentType } from 'react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
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
import { Slider } from '@/components/ui/slider'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { SmylrOpenPencilBridgeRuntime } from '@/components/runtime/smylr-open-pencil-bridge-runtime'
import rendererCatalogJson from '../../../archive/agent-tooling/open-pencil-base/src/app/smylr-component-library/renderer-catalog.generated.json'

type RendererCatalog = {
  fixtures: Array<{ fixtureId: string }>
}

const rendererCatalog = rendererCatalogJson as RendererCatalog

function AccordionFixture() {
  return (
    <Accordion
      type='single'
      collapsible
      defaultValue='sources'
      className='w-[420px]'
      data-openpencil-fixture='accordion'
    >
      <AccordionItem value='sources'>
        <AccordionTrigger>Source evidence</AccordionTrigger>
        <AccordionContent className='text-muted-foreground'>
          Repository and renderer identities match.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value='history'>
        <AccordionTrigger>Revision history</AccordionTrigger>
        <AccordionContent className='text-muted-foreground'>
          The previous HTML board revision remains available.
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function AlertFixture() {
  return (
    <Alert className='w-[420px]'>
      <AlertTitle>Ready for review</AlertTitle>
      <AlertDescription>
        All required clinical fields are complete.
      </AlertDescription>
    </Alert>
  )
}

function AvatarFixture() {
  return (
    <Avatar className='size-12'>
      <AvatarFallback className='text-sm font-semibold'>OM</AvatarFallback>
    </Avatar>
  )
}

function BadgeFixture() {
  return <Badge variant='success'>Ready</Badge>
}

function CalendarFixture() {
  const [selected, setSelected] = useState<Date | undefined>(
    new Date(2026, 6, 13)
  )

  return (
    <Calendar
      mode='single'
      defaultMonth={new Date(2026, 6, 1)}
      selected={selected}
      onSelect={setSelected}
    />
  )
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

function DropdownMenuFixture() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline'>Patient actions</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        <DropdownMenuLabel>Patient task</DropdownMenuLabel>
        <DropdownMenuItem>Assign provider</DropdownMenuItem>
        <DropdownMenuItem>Schedule follow-up</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Open record</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
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

function RadioGroupFixture() {
  return (
    <RadioGroup
      defaultValue='email'
      aria-label='Reminder channel'
      className='w-[280px]'
    >
      <label className='flex items-center gap-2 text-sm'>
        <RadioGroupItem value='email' /> Email reminder
      </label>
      <label className='flex items-center gap-2 text-sm'>
        <RadioGroupItem value='sms' /> SMS reminder
      </label>
    </RadioGroup>
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

function SliderFixture() {
  const [value, setValue] = useState([64])

  return (
    <Slider
      aria-label='Appointment duration'
      className='w-80'
      value={value}
      onValueChange={setValue}
    />
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
            <TableCell className='text-right tabular-nums'>
              {duration}
            </TableCell>
            <TableCell className='text-right tabular-nums'>{balance}</TableCell>
            <TableCell>{status}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function TextareaFixture() {
  const [value, setValue] = useState('')

  return (
    <Textarea
      aria-label='Clinical note'
      className='w-[360px]'
      placeholder='Add a clinical note'
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  )
}

function TooltipFixture() {
  return (
    <Tooltip defaultOpen>
      <TooltipTrigger asChild>
        <Button variant='outline'>Source details</Button>
      </TooltipTrigger>
      <TooltipContent side='bottom' align='start'>
        Verified against the current repository export.
      </TooltipContent>
    </Tooltip>
  )
}

const FIXTURES = {
  accordion: AccordionFixture,
  alert: AlertFixture,
  avatar: AvatarFixture,
  badge: BadgeFixture,
  button: ButtonFixture,
  calendar: CalendarFixture,
  card: CardFixture,
  checkbox: CheckboxFixture,
  'dropdown-menu': DropdownMenuFixture,
  input: InputFixture,
  progress: ProgressFixture,
  'radio-group': RadioGroupFixture,
  select: SelectFixture,
  separator: SeparatorFixture,
  slider: SliderFixture,
  switch: SwitchFixture,
  table: TableFixture,
  tabs: TabsFixture,
  textarea: TextareaFixture,
  tooltip: TooltipFixture,
} satisfies Record<string, ComponentType>

type FixtureId = keyof typeof FIXTURES

export const SMYLR_OPENPENCIL_COMPONENT_FIXTURE_IDS =
  rendererCatalog.fixtures.map((fixture) => fixture.fixtureId)

export function SmylrOpenPencilComponentRenderer({
  componentId,
  embedded = false,
}: {
  componentId: string
  embedded?: boolean
}) {
  useEffect(() => {
    if (!embedded) return

    const root = document.documentElement
    const hadDarkTheme = root.classList.contains('dark')
    const hadLightTheme = root.classList.contains('light')
    const previousColorScheme = root.style.colorScheme
    const forceLightTheme = () => {
      root.classList.remove('dark')
      root.classList.add('light')
      root.style.colorScheme = 'light'
    }

    forceLightTheme()
    const timer = window.setTimeout(forceLightTheme, 0)

    return () => {
      window.clearTimeout(timer)
      root.classList.toggle('dark', hadDarkTheme)
      root.classList.toggle('light', hadLightTheme)
      root.style.colorScheme = previousColorScheme
    }
  }, [embedded])

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
            <p
              data-smylr-openpencil-ignore='true'
              className='text-muted-foreground text-sm'
            >
              Unknown component fixture: {componentId}
            </p>
          )}
        </div>
      </main>
      <SmylrOpenPencilBridgeRuntime />
    </>
  )
}
