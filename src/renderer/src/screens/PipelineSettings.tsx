import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import { Button, Card, Check, Field, Input } from '../ui'

type Save = (patch: Partial<Settings>) => Promise<void>

function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
}) {
  return (
    <div>
      <Check checked={checked} onChange={onChange}>
        {label}
      </Check>
      <div className="ml-6 text-[12px] text-muted">{hint}</div>
    </div>
  )
}

/** A number box that saves when you click away, so typing is never interrupted. */
function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  onSave,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  onSave: (v: number) => void
}) {
  const [v, setV] = useState(String(value))
  useEffect(() => setV(String(value)), [value])
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        min={min}
        max={max}
        className="w-28"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Math.round(Number(v))
          if (Number.isFinite(n) && n >= min && n <= max && n !== value) onSave(n)
          else setV(String(value))
        }}
      />
    </Field>
  )
}

/** A list of dates (YYYY-MM-DD, Eastern). */
export function DateList({
  dates,
  onChange,
  label,
}: {
  dates: string[]
  onChange: (d: string[]) => void
  label: string
}) {
  const [add, setAdd] = useState('')
  return (
    <Field label={label}>
      <div className="flex flex-wrap items-center gap-2">
        {dates.map((d) => (
          <span
            key={d}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[12px]"
          >
            {d}
            <button
              aria-label={`Remove ${d}`}
              className="text-muted hover:text-ink"
              onClick={() => onChange(dates.filter((x) => x !== d))}
            >
              ×
            </button>
          </span>
        ))}
        {!dates.length && <span className="text-[12px] text-muted">None</span>}
        <Input
          type="date"
          aria-label="Add a date"
          className="w-44"
          value={add}
          onChange={(e) => setAdd(e.target.value)}
        />
        <Button
          disabled={!add || dates.includes(add)}
          onClick={() => {
            onChange([...dates, add].sort())
            setAdd('')
          }}
        >
          Add date
        </Button>
      </div>
    </Field>
  )
}

const NOTIFY: Array<[string, string]> = [
  ['accepted', 'A drop is accepted'],
  ['rejected', 'A drop is rejected or held'],
  ['scheduled', 'A video is scheduled'],
  ['posted', 'A video is posted'],
  ['failed', 'A post fails'],
  ['reconcile', 'The check finds something that does not add up'],
  ['low_queue', 'A channel is running low on scheduled posts'],
  ['summary', 'The morning summary'],
]

/** The switches for the bot pipeline: who writes, and what ELO does with finished videos. */
export function PipelineSettings({ s, save }: { s: Settings; save: Save }) {
  const [bots, setBots] = useState(s.pipelineSourceBots.join(', '))
  useEffect(() => setBots(s.pipelineSourceBots.join(', ')), [s.pipelineSourceBots])
  const minutes = [0, 1, 2].map((i) => s.retryMinutes[i] ?? [5, 15, 60][i])
  return (
    <>
      <Card title="Who writes">
        <p className="mb-3 text-[13px] text-muted">
          In the bot pipeline, bots write and render every episode and drop finished videos in the
          Inbox. ELO takes the drops, schedules them with the slots you set, and posts them. The
          schedule is only ever what you set in the app. A bot never picks or promises a time.
        </p>
        <div className="space-y-3">
          <Switch
            checked={s.claudeApiEnabled}
            onChange={(v) => save({ claudeApiEnabled: v })}
            label="Allow ELO to use the Claude API"
            hint="Off means ELO makes no call to Anthropic at all. Models running on your own computer through Ollama still work."
          />
          <Switch
            checked={s.studioProductionEnabled}
            onChange={(v) => save({ studioProductionEnabled: v })}
            label="Let ELO write and produce episodes itself (Studio production)"
            hint="Off stops the Director from planning new episodes, and stops the Show Writer, the Producer and the idea refill. Library, Comments, Spend and the Director's Log keep working."
          />
        </div>
      </Card>

      <Card title="Drop intake">
        <div className="space-y-3">
          <Switch
            checked={s.pipelineIntakeEnabled}
            onChange={(v) => save({ pipelineIntakeEnabled: v })}
            label="Take drops from the Inbox folders"
            hint="Off means ELO leaves every Inbox folder alone. Files stay where they are."
          />
          <Switch
            checked={s.pipelineStrict}
            onChange={(v) => save({ pipelineStrict: v })}
            label="Check sidecars strictly"
            hint="On rejects a sidecar with any problem and writes the reasons. Off lets small problems (a long title, an unknown extra field) through with a note in the drop log."
          />
          <Switch
            checked={s.pipelineRequireApproval}
            onChange={(v) => save({ pipelineRequireApproval: v })}
            label="Require the approval block"
            hint="You approve a video before it is dropped. A sidecar without the approval block is rejected."
          />
          <Switch
            checked={s.pipelineDuplicateDetection}
            onChange={(v) => save({ pipelineDuplicateDetection: v })}
            label="Refuse duplicates"
            hint="The same video, or the same episode id for a channel, is marked duplicate and not scheduled."
          />
          <Field
            label="Bots that may drop"
            hint="The names a sidecar's source_bot may have, separated by commas."
          >
            <Input
              value={bots}
              onChange={(e) => setBots(e.target.value)}
              onBlur={() => {
                const list = bots
                  .split(',')
                  .map((b) => b.trim())
                  .filter(Boolean)
                if (list.length && JSON.stringify(list) !== JSON.stringify(s.pipelineSourceBots))
                  void save({ pipelineSourceBots: list })
              }}
            />
          </Field>
        </div>
      </Card>

      <Card title="Schedule rules">
        <p className="mb-3 text-[13px] text-muted">
          These apply to every next open slot. Each channel also has its own daily limit and
          blackout dates on Channel setup. A daily limit of 1 means only the first slot of each day
          is used.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <NumberSetting
            label="Minimum gap between any two posts (minutes)"
            hint="0 turns it off."
            value={s.minGapMinutes}
            min={0}
            max={1440}
            onSave={(v) => save({ minGapMinutes: v })}
          />
          <NumberSetting
            label="Low queue alert (days of posts scheduled ahead)"
            hint="One alert when a channel has fewer days than this. 0 turns it off."
            value={s.lowQueueDays}
            min={0}
            max={60}
            onSave={(v) => save({ lowQueueDays: v })}
          />
        </div>
        <div className="mt-3">
          <DateList
            label="Blackout dates for every channel"
            dates={s.blackoutDates}
            onChange={(d) => save({ blackoutDates: d })}
          />
        </div>
      </Card>

      <Card title="Posting">
        <div className="space-y-3">
          <div className="grid gap-4 md:grid-cols-3">
            {minutes.map((m, i) => (
              <NumberSetting
                key={i}
                label={`Wait before try ${i + 2} (minutes)`}
                hint={
                  i === 0
                    ? 'After a post fails, ELO tries again after these waits, then marks it failed.'
                    : undefined
                }
                value={m}
                min={1}
                max={720}
                onSave={(v) => {
                  const next = [...minutes]
                  next[i] = v
                  void save({ retryMinutes: next })
                }}
              />
            ))}
          </div>
          <Switch
            checked={s.globalDryRun}
            onChange={(v) => save({ globalDryRun: v })}
            label="Dry run everything"
            hint="Nothing goes to any platform. Posts are marked done inside the app only. Use it to test the pipeline end to end."
          />
          <Switch
            checked={s.reconcileAutoFix}
            onChange={(v) => save({ reconcileAutoFix: v })}
            label="Let the check fix the clear cases"
            hint="Off by default. When on, a second bot video that sits in a taken slot moves to the next open slot. Nothing is ever deleted."
          />
        </div>
      </Card>

      <Card title="Tell me when">
        <p className="mb-3 text-[13px] text-muted">
          These go to the same places as your other alerts (screen, iMessage, email, Telegram).
          Failures always come through.
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          {NOTIFY.map(([k, label]) => (
            <Check
              key={k}
              checked={s.pipelineNotifyKinds.includes(k)}
              onChange={(v) =>
                save({
                  pipelineNotifyKinds: v
                    ? [...new Set([...s.pipelineNotifyKinds, k])]
                    : s.pipelineNotifyKinds.filter((x) => x !== k),
                })
              }
            >
              {label}
            </Check>
          ))}
        </div>
      </Card>
    </>
  )
}
