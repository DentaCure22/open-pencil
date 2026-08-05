import { useMemo } from 'react'

import type { SmylrFlowScreenDocument, SmylrFlowScreenState } from '../model'

type SmylrFlowScreenProps = {
  onStateChange: (state: SmylrFlowScreenState) => void
  surface: SmylrFlowScreenDocument
}

const TEETH = [11, 12, 13, 14, 15, 16, 17, 18]
const CONDITIONS = ['Caries', 'Fracture', 'Watch'] as const

function routeTitle(route: string) {
  if (route === '/calendar') return 'Schedule'
  if (route === '/patient-admin') return 'Patient overview'
  if (route === '/health-chart') return 'Health history'
  if (route === '/treatment-plan') return 'Treatment plan'
  return 'Dental chart'
}

function SideNavigation({ route }: { route: string }) {
  const items = [
    { glyph: 'C', route: '/calendar' },
    { glyph: 'P', route: '/patient-admin' },
    { glyph: 'H', route: '/health-chart' },
    { glyph: 'D', route: '/dental-chart' },
    { glyph: 'T', route: '/treatment-plan' }
  ]
  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-2 bg-[#17232c] px-2 py-3 text-white">
      <div className="mb-2 grid size-8 place-items-center rounded-[10px] bg-[#55d6be] text-sm font-black text-[#10241f]">
        S
      </div>
      {items.map((item) => (
        <div
          key={item.route}
          className={`grid size-8 place-items-center rounded-[9px] text-[11px] font-bold ${
            route === item.route ? 'bg-white/14 text-white' : 'text-white/38'
          }`}
        >
          {item.glyph}
        </div>
      ))}
      <div className="mt-auto grid size-8 place-items-center rounded-full bg-[#efb863] text-[10px] font-black text-[#342407]">
        AK
      </div>
    </nav>
  )
}

function ScreenHeader({ route, saved }: { route: string; saved: boolean }) {
  return (
    <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-[#e2e7ea] bg-white px-5">
      <div>
        <div className="text-[9px] font-semibold tracking-[0.14em] text-[#84919a] uppercase">
          Avery Kim · #SM-2048
        </div>
        <h1 className="mt-1 text-[20px] leading-none font-[760] tracking-[-0.03em] text-[#1b2933]">
          {routeTitle(route)}
        </h1>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-[#e1e6e9] bg-[#fbfcfd] px-2.5 py-2">
        <div className="grid size-7 place-items-center rounded-[9px] bg-[#e3f7f2] text-[9px] font-black text-[#16705f]">
          AK
        </div>
        <div className="hidden flex-col @min-[560px]:flex">
          <strong className="text-[10px] text-[#26343e]">Avery Kim</strong>
          <span className="text-[8px] text-[#7b8891]">Adult recall · Today</span>
        </div>
        <span
          className={`ml-1 rounded-full px-2 py-1 text-[8px] font-bold ${
            saved ? 'bg-[#def6ed] text-[#14715e]' : 'bg-[#eef1f3] text-[#71808a]'
          }`}
        >
          {saved ? 'Saved' : 'Draft'}
        </span>
      </div>
    </header>
  )
}

function CalendarView() {
  const days = ['Mon 21', 'Tue 22', 'Wed 23', 'Thu 24', 'Fri 25']
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <strong className="text-[13px] text-[#263640]">July 2026</strong>
          <p className="m-0 mt-1 text-[9px] text-[#7b8992]">Clinic schedule · 18 appointments</p>
        </div>
        <button className="rounded-[9px] bg-[#265ee8] px-3 py-2 text-[9px] font-bold text-white">
          New appointment
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-5 gap-2 rounded-xl border border-[#dfe5e8] bg-white p-2">
        {days.map((day, index) => (
          <div
            key={day}
            className={`rounded-[9px] p-2 ${index === 2 ? 'bg-[#edf8f5]' : 'bg-[#f7f9fa]'}`}
          >
            <strong className="text-[9px] text-[#40505b]">{day}</strong>
            {index === 2 ? (
              <div className="mt-5 rounded-[8px] border-l-[3px] border-[#4ac8ad] bg-white p-2 shadow-sm">
                <span className="text-[7px] text-[#7a8891]">10:30</span>
                <strong className="mt-1 block text-[8px] text-[#263640]">Avery Kim</strong>
                <small className="text-[7px] text-[#7a8891]">Dental exam</small>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function PatientAdminView() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-3 rounded-xl border border-[#dfe5e8] bg-white p-3">
        <div className="grid size-11 place-items-center rounded-[13px] bg-[#e3f7f2] text-sm font-black text-[#16705f]">
          AK
        </div>
        <div className="flex-1">
          <strong className="text-[13px] text-[#273640]">Avery Kim</strong>
          <p className="m-0 mt-1 text-[8px] text-[#7a8892]">
            DOB 04/12/1991 · Delta Dental · Active
          </p>
        </div>
        <span className="rounded-full bg-[#e5f7f0] px-2 py-1 text-[8px] font-bold text-[#17715f]">
          Ready for exam
        </span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Last visit', 'Jan 12'],
          ['Balance', '$0'],
          ['Open plans', '1']
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-[#dfe5e8] bg-white p-3">
            <span className="text-[8px] text-[#7a8892]">{label}</span>
            <strong className="mt-1 block text-lg text-[#263640]">{value}</strong>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-[#dfe5e8] bg-white p-3">
        <div className="size-2 rounded-full bg-[#51c8ae]" />
        <div className="flex-1">
          <strong className="text-[10px] text-[#283741]">Dental exam</strong>
          <p className="m-0 mt-0.5 text-[8px] text-[#7a8892]">Today · Dr. Marin · Operatory 3</p>
        </div>
        <span className="text-[8px] font-bold text-[#295dd9]">Open chart</span>
      </div>
    </div>
  )
}

function HealthChartView() {
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between rounded-xl border border-[#efd39d] bg-[#fff8e9] p-3">
        <div>
          <strong className="text-[12px] text-[#563b12]">Medication review required</strong>
          <p className="m-0 mt-1 text-[8px] text-[#90601a]">
            Confirm dose before local anesthetic.
          </p>
        </div>
        <span className="rounded-full bg-[#f5d48d] px-2 py-1 text-[8px] font-bold text-[#6e4810]">
          Needs review
        </span>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-3">
        <div className="rounded-xl border border-[#dfe5e8] bg-white p-3">
          <span className="text-[8px] font-bold tracking-wider text-[#839099] uppercase">
            Allergies
          </span>
          <strong className="mt-2 block text-[13px] text-[#283741]">Penicillin</strong>
          <p className="text-[8px] leading-relaxed text-[#78868f]">Hives · recorded 2022</p>
        </div>
        <div className="rounded-xl border border-[#dfe5e8] bg-white p-3">
          <span className="text-[8px] font-bold tracking-wider text-[#839099] uppercase">
            Conditions
          </span>
          <strong className="mt-2 block text-[13px] text-[#283741]">Hypertension</strong>
          <p className="text-[8px] leading-relaxed text-[#78868f]">Controlled · PCP verified</p>
        </div>
      </div>
    </div>
  )
}

function TreatmentPlanView() {
  const items = [
    ['1', 'Composite restoration · #14', '$240', 'Ready'],
    ['2', 'Periodic exam', '$95', 'Complete'],
    ['3', 'Prophylaxis', '$120', 'Planned']
  ]
  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <strong className="text-[13px] text-[#263640]">Active plan</strong>
          <p className="m-0 mt-1 text-[8px] text-[#7b8992]">
            3 procedures · Estimated patient $455
          </p>
        </div>
        <button className="rounded-[9px] bg-[#265ee8] px-3 py-2 text-[9px] font-bold text-white">
          Present plan
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-[#dfe5e8] bg-white">
        {items.map(([index, title, price, status]) => (
          <div
            key={index}
            className="flex items-center gap-3 border-b border-[#edf0f2] p-3 last:border-0"
          >
            <span className="grid size-7 place-items-center rounded-[8px] bg-[#edf1ff] text-[9px] font-black text-[#425bd4]">
              {index}
            </span>
            <strong className="flex-1 text-[9px] text-[#2b3943]">{title}</strong>
            <span className="text-[9px] font-bold text-[#52616b]">{price}</span>
            <span className="w-14 rounded-full bg-[#eef2f3] px-2 py-1 text-center text-[7px] text-[#65747e]">
              {status}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DentalChartView({
  onStateChange,
  state
}: Pick<SmylrFlowScreenProps, 'onStateChange'> & { state: SmylrFlowScreenState }) {
  const update = (next: Partial<SmylrFlowScreenState>) => onStateChange({ ...state, ...next })
  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 p-3.5">
      <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#dfe5e8] bg-white p-2">
        <div className="mr-1 w-16 shrink-0">
          <strong className="block text-[9px] text-[#33434d]">Upper right</strong>
          <span className="text-[7px] text-[#7c8992]">Permanent</span>
        </div>
        {TEETH.map((tooth) => (
          <button
            key={tooth}
            className={`flex h-11 min-w-8 flex-1 flex-col items-center justify-center rounded-[9px] border text-[8px] font-bold ${
              tooth === state.selectedTooth
                ? 'border-[#4ac6aa] bg-[#e8f8f4] text-[#176f5f] shadow-[0_0_0_2px_rgba(74,198,170,0.14)]'
                : 'border-[#e0e5e8] bg-[#fafbfc] text-[#66757f]'
            }`}
            data-test-id={`smylr-flow-tooth-${tooth}`}
            onClick={() => update({ selectedTooth: tooth })}
          >
            {tooth}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[1.18fr_0.82fr] gap-2.5">
        <section className="flex min-h-0 flex-col gap-2.5 rounded-xl border border-[#dfe5e8] bg-white p-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[7px] font-semibold tracking-wider text-[#84919a] uppercase">
                Finding
              </span>
              <strong className="mt-0.5 block text-[11px] text-[#283741]">
                Tooth #{state.selectedTooth}
              </strong>
            </div>
            <span className="rounded-full bg-[#e4f7f1] px-2 py-1 text-[7px] font-bold text-[#17705f]">
              Selected
            </span>
          </div>
          <span className="text-[8px] font-bold text-[#65747e]">Condition</span>
          <div className="grid grid-cols-3 gap-1.5">
            {CONDITIONS.map((condition) => (
              <button
                key={condition}
                className={`rounded-[8px] border px-2 py-2 text-[8px] font-semibold ${
                  condition === state.condition
                    ? 'border-[#efa45c] bg-[#fff2e7] text-[#8a4a13]'
                    : 'border-[#e0e5e8] bg-[#f8fafb] text-[#5e6d77]'
                }`}
                onClick={() => update({ condition })}
              >
                {condition}
              </button>
            ))}
          </div>
          <button
            className="flex items-center justify-between rounded-[9px] bg-[#f4f7f8] px-3 py-2 text-left"
            data-test-id="smylr-flow-details-toggle"
            onClick={() => update({ detailsOpen: !state.detailsOpen })}
          >
            <span>
              <strong className="block text-[8px] text-[#34434d]">Clinical details</strong>
              <small className="text-[7px] text-[#7b8891]">Surface, severity, notes</small>
            </span>
            <span className="text-[11px] text-[#76858e]">{state.detailsOpen ? '−' : '+'}</span>
          </button>
          {state.detailsOpen ? (
            <div className="grid grid-cols-2 gap-1.5" data-test-id="smylr-flow-details-panel">
              <div className="rounded-[8px] bg-[#f4f7f8] p-2 text-[7px] text-[#677680]">
                Occlusal
              </div>
              <div className="rounded-[8px] bg-[#f4f7f8] p-2 text-[7px] text-[#677680]">
                Moderate
              </div>
            </div>
          ) : null}
          <button
            className={`mt-auto rounded-[9px] px-3 py-2.5 text-[9px] font-bold ${
              state.saveStatus === 'saved'
                ? 'bg-[#e4f7f1] text-[#16705f]'
                : 'bg-[#265ee8] text-white'
            }`}
            data-test-id="smylr-flow-save-finding"
            onClick={() => update({ saveStatus: state.saveStatus === 'saved' ? 'draft' : 'saved' })}
          >
            {state.saveStatus === 'saved' ? 'Undo saved finding' : 'Save finding'}
          </button>
        </section>
        <aside className="flex min-h-0 flex-col gap-2.5 rounded-xl border border-[#dfe5e8] bg-white p-3">
          <div>
            <span className="text-[7px] font-semibold tracking-wider text-[#84919a] uppercase">
              Activity
            </span>
            <strong className="mt-0.5 block text-[11px] text-[#283741]">Today’s exam</strong>
          </div>
          <div className="flex items-center gap-2 rounded-[9px] bg-[#f4f7f8] p-2.5">
            <div className="grid size-8 place-items-center rounded-[10px] bg-white text-[10px] font-black text-[#285ce1]">
              #{state.selectedTooth}
            </div>
            <div>
              <strong className="block text-[8px] text-[#34434d]">{state.condition}</strong>
              <span className="text-[7px] text-[#7a8891]">Clinical finding</span>
            </div>
          </div>
          {state.saveStatus === 'saved' ? (
            <div
              className="flex items-center gap-2 rounded-[9px] border border-[#bce7da] bg-[#edfaf6] p-2.5"
              data-test-id="smylr-flow-saved-feedback"
            >
              <span className="grid size-5 place-items-center rounded-full bg-[#41b99c] text-[7px] font-black text-white">
                OK
              </span>
              <div>
                <strong className="block text-[8px] text-[#176f5f]">Saved to patient chart</strong>
                <span className="text-[7px] text-[#588078]">Undo remains available</span>
              </div>
            </div>
          ) : (
            <p className="m-0 text-[8px] leading-relaxed text-[#7a8891]">
              Choose a tooth and condition. The draft stays local until you save.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}

export function SmylrFlowScreen({ onStateChange, surface }: SmylrFlowScreenProps) {
  const content = useMemo(() => {
    if (surface.route === '/calendar') return <CalendarView />
    if (surface.route === '/patient-admin') return <PatientAdminView />
    if (surface.route === '/health-chart') return <HealthChartView />
    if (surface.route === '/treatment-plan') return <TreatmentPlanView />
    return <DentalChartView onStateChange={onStateChange} state={surface.state} />
  }, [onStateChange, surface.route, surface.state])

  return (
    <main
      className="flex size-full overflow-hidden bg-[#f4f6f8] font-sans text-[#1c2a34] [container-type:inline-size]"
      data-code-object-source-id={`${surface.flowId}/${surface.screenId}`}
      data-test-id="code-object-smylr-flow-screen"
    >
      <SideNavigation route={surface.route} />
      <div className="flex min-w-0 flex-1 flex-col">
        <ScreenHeader route={surface.route} saved={surface.state.saveStatus === 'saved'} />
        <div className="min-h-0 flex-1">{content}</div>
      </div>
    </main>
  )
}
