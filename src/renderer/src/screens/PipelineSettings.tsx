import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import type { FreshStartDone, FreshStartInfo } from '@shared/pipeline'
import { api } from '../api'
import { useApp } from '../hooks'
import { Button, Card, Check, Confirm, Field, Input, TimeSelect, useBusy } from '../ui'

type Save = (patch: Partial<Settings>) => Promise<void>

export function Switch({
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
export function NumberSetting({
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

/** Backs everything up, checks the backup, then clears every script, idea, task and Upcoming entry. */
function FreshStartCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [pre, setPre] = useState<FreshStartInfo | null>(null)
  const [ask, setAsk] = useState(false)
  const [done, setDone] = useState<FreshStartDone | null>(null)
  return (
    <Card title="Fresh start">
      <p className="mb-3 text-[13px] text-muted">
        Clears every script, idea, task and Upcoming entry so the bots start with an empty slate.
        Posted videos, their numbers, spending history, the audit log and the drop log stay. A
        backup is made and checked first.
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          const p = await run(() => api.pipeline.freshStartPreview())
          if (p) setPre(p)
        }}
      >
        See what would be removed
      </Button>
      {pre && (
        <div className="mt-3 space-y-1 text-[13px]">
          <div>
            Scripts removed: <b>{pre.episodes}</b> (kept because they went out: {pre.episodesKept})
          </div>
          <div>
            Ideas removed: <b>{pre.ideas}</b>
          </div>
          <div>
            Task records removed: <b>{pre.tasks}</b>
          </div>
          <div>
            Upcoming entries removed: <b>{pre.upcoming}</b>
          </div>
          <div>
            Scheduled or draft posts canceled: <b>{pre.unpostedPosts}</b>
          </div>
          <div>
            Posted videos kept: <b>{pre.postedKept}</b>
          </div>
          <div className="text-muted">Backup goes to {pre.bundleDir}</div>
          {pre.runningTasks > 0 && (
            <div className="text-warn">Something is being written right now. Wait a minute.</div>
          )}
          <Button
            variant="danger"
            disabled={busy || pre.runningTasks > 0}
            onClick={() => setAsk(true)}
          >
            Start fresh
          </Button>
        </div>
      )}
      {done && (
        <div className="mt-3 rounded-md border border-line p-3 text-[13px]">
          <b>Done.</b> Backup: {done.bundleDir} ({done.checks.join(', ')}). Upcoming starts again at
          revision {done.revision}.
          {done.switchedOff.length > 0 &&
            ' The Claude API and Studio production were switched off so nothing refills the slate.'}
        </div>
      )}
      {ask && (
        <Confirm
          title="Start fresh?"
          message="A backup is made and checked first. Then all scripts, ideas, tasks and Upcoming entries are removed, and the Claude API and Studio production are switched off. The backup folder has the steps to put everything back."
          confirmLabel="Start fresh"
          danger
          onCancel={() => setAsk(false)}
          onConfirm={async () => {
            setAsk(false)
            const r = await run(() => api.pipeline.freshStartRun())
            if (r) {
              setDone(r)
              setPre(null)
              toast({ kind: 'success', headline: 'Fresh start done.', detail: r.bundleDir })
            }
          }}
        />
      )}
    </Card>
  )
}

/** The switches for the bot pipeline: who writes, and what ELO does with finished videos. */
/** AI: who writes. Lives on the AI Settings screen. */
export function WhoWritesCard({ s, save }: { s: Settings; save: Save }) {
  return (
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
  )
}

/** Per channel home for these two: Setup Channels, Other settings by channel. */
export function ScheduleRulesCard({ s, save }: { s: Settings; save: Save }) {
  return (
    <Card title="Schedule rules">
      <p className="mb-3 text-[13px] text-muted">
        These apply to every next open slot. Each channel also has its own daily limit and blackout
        dates on Channel setup. A daily limit of 1 means only the first slot of each day is used, for
        each platform. Channels no longer keep a gap between each other, because every platform has its
        own times.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
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
  )
}

export function EmptySlotWarningsCard({ s, save }: { s: Settings; save: Save }) {
  return (
    <Card title="Empty slot warnings">
      <div className="space-y-3">
        <Switch
          checked={s.gapWarnEnabled}
          onChange={(v) => save({ gapWarnEnabled: v })}
          label="Warn me about empty slots once a day"
          hint="A message (iMessage, email and Telegram, the same as your other alerts) listing the slots from now to the end of tomorrow that have nothing in them, for channels that are running. Nothing is sent when every slot is filled."
        />
        <Field label="Send it at (Eastern)">
          <TimeSelect
            value={s.gapWarnTime}
            label="Warning time"
            onChange={(v) => save({ gapWarnTime: v })}
          />
        </Field>
      </div>
    </Card>
  )
}

/** App wide pipeline settings: intake, posting, the Upcoming file, fresh start, and the alerts list. */
export function PipelineSettings({ s, save }: { s: Settings; save: Save }) {
  const [bots, setBots] = useState(s.pipelineSourceBots.join(', '))
  useEffect(() => setBots(s.pipelineSourceBots.join(', ')), [s.pipelineSourceBots])
  const minutes = [0, 1, 2].map((i) => s.retryMinutes[i] ?? [5, 15, 60][i])
  return (
    <>
      <ScheduleRulesCard s={s} save={save} />
      <EmptySlotWarningsCard s={s} save={save} />
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
            checked={s.pipelineRequireQc}
            onChange={(v) => save({ pipelineRequireQc: v })}
            label="Require a passing QC result and B.E.T.H. sign-off"
            hint="On rejects a drop whose sidecar lacks qc (status pass) and beth_signoff."
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

      <Card title="Upcoming episodes">
        <div className="space-y-3">
          <Switch
            checked={s.upcomingEnabled}
            onChange={(v) => save({ upcomingEnabled: v })}
            label="Read the shared Upcoming file"
            hint="Off means ELO ignores the shared file. Bots that write ideas to it keep working through the agent API."
          />
          <Switch
            checked={s.upcomingLiveWatch}
            onChange={(v) => save({ upcomingLiveWatch: v })}
            label="Watch the file for changes as they happen"
            hint="Off means the file is only checked on a timer."
          />
          <div className="grid gap-4 md:grid-cols-2">
            <NumberSetting
              label="Check the file every (seconds)"
              value={s.upcomingPollSeconds}
              min={2}
              max={600}
              onSave={(v) => save({ upcomingPollSeconds: v })}
            />
            <Field
              label="File location"
              hint="Blank uses Shared/upcoming.json inside the Media Root."
            >
              <Input
                defaultValue={s.upcomingFilePath}
                placeholder="Media Root / Shared / upcoming.json"
                onBlur={(e) =>
                  e.target.value !== s.upcomingFilePath &&
                  void save({ upcomingFilePath: e.target.value.trim() })
                }
              />
            </Field>
          </div>
        </div>
      </Card>

      <FreshStartCard />

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
