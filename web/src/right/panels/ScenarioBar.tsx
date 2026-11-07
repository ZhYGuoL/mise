import type { Scenario } from '@mise/shared'
import { motion } from 'motion/react'
import { runScenario, useRunView } from '../lib/data'
import { spring } from '../lib/motion'

type Option<V extends string> = { value: V; label: string }

const DAYS: Option<Scenario['day']>[] = [
  { value: 'Monday', label: 'Mon' },
  { value: 'Tuesday', label: 'Tue' },
  { value: 'Wednesday', label: 'Wed' },
  { value: 'Thursday', label: 'Thu' },
  { value: 'Friday', label: 'Fri' },
  { value: 'Saturday', label: 'Sat' },
  { value: 'Sunday', label: 'Sun' },
]

const WEATHER: Option<Scenario['weather']>[] = [
  { value: 'clear', label: 'Clear' },
  { value: 'rain', label: 'Rain' },
  { value: 'snow', label: 'Snow' },
]

const EVENTS: Option<Scenario['event']>[] = [
  { value: 'none', label: 'No event' },
  { value: 'exam_week', label: 'Exams' },
  { value: 'home_game', label: 'Home game' },
  { value: 'move_in', label: 'Move-in' },
]

/** Segmented control. One indicator glides to the picked option. */
function Segmented<V extends string>({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string
  label: string
  options: Option<V>[]
  value: V
  onChange: (v: V) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-full bg-field p-0.5 shadow-hairline">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => !on && onChange(o.value)}
            className={`relative rounded-full px-2 py-1 text-[12px] leading-4 font-medium whitespace-nowrap transition-colors duration-100 ${
              on ? 'text-ink' : 'text-ink-3 hover:text-ink-2'
            }`}
          >
            {on && (
              <motion.span
                layoutId={`scenario-${id}`}
                transition={spring.moderate}
                className="absolute inset-0 rounded-full bg-surface shadow-[0_0_0_1px_var(--line-strong)]"
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** Day, weather and event. Changing one re-runs the simulation. */
export function ScenarioBar({ scenario }: { scenario: Scenario }) {
  const fixture = useRunView((s) => s.fixture)
  return (
    <div className="@container">
    <div className="flex flex-wrap items-center gap-2">
      <Segmented id="day" label="Day" options={DAYS} value={scenario.day} onChange={(day) => runScenario({ day })} />
      <Segmented
        id="weather"
        label="Weather"
        options={WEATHER}
        value={scenario.weather}
        onChange={(weather) => runScenario({ weather })}
      />
      <Segmented
        id="event"
        label="Event"
        options={EVENTS}
        value={scenario.event}
        onChange={(event) => runScenario({ event })}
      />
      {/* Least important item on the row: hidden when the pane is too narrow to fit it. */}
      <span className="ml-auto hidden h-7 shrink-0 items-center text-[12px] text-ink-3 tabular-nums @min-[740px]:flex">
        {fixture ? 'Fixture' : `${scenario.runs} runs`}
      </span>
    </div>
    </div>
  )
}
