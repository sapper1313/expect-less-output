import { useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { formatEastern } from '@shared/time'
import type { LogFilter, Settings } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Empty, Field, Input, PageHeader, Select } from '../ui'
import logoStacked from '../assets/logo-stacked.jpg'
import { AlertsCard, BackupCard } from './AlertsBackup'
import { AgentsCard, TextAssistCard } from './Agents'

const LEVEL_STYLE = { info: 'text-muted', warn: 'text-warn', error: 'text-bad' }

export function Activity() {
  const [filter, setFilter] = useState<LogFilter>({ level: 'all', platform: null })
  const { data } = useLoad(() => api.log.list({ ...filter, limit: 500 }), [JSON.stringify(filter)])
  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.activity} />
      <div className="space-y-4 px-8">
        <div className="flex gap-3">
          <Select
            className="w-40"
            aria-label="Level"
            value={filter.level ?? 'all'}
            onChange={(e) => setFilter({ ...filter, level: e.target.value as LogFilter['level'] })}
          >
            <option value="all">All levels</option>
            <option value="info">Info</option>
            <option value="warn">Warnings</option>
            <option value="error">Errors</option>
          </Select>
          <Select
            className="w-44"
            aria-label="Platform"
            value={filter.platform ?? ''}
            onChange={(e) =>
              setFilter({ ...filter, platform: (e.target.value || null) as LogFilter['platform'] })
            }
          >
            <option value="">All platforms</option>
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABELS[p]}
              </option>
            ))}
          </Select>
        </div>
        {data && data.length === 0 ? (
          <Empty>{COPY.emptyLog}</Empty>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line font-mono text-[12px]">
            {data?.map((e) => (
              <div
                key={e.id}
                className="flex gap-3 border-b border-line px-3 py-1.5 last:border-b-0"
              >
                <span className="w-44 shrink-0 text-muted">{formatEastern(e.tsUtc, false)}</span>
                <span className={`w-12 shrink-0 font-bold uppercase ${LEVEL_STYLE[e.level]}`}>
                  {e.level}
                </span>
                <span className="w-20 shrink-0 text-muted">
                  {e.platform ? PLATFORM_LABELS[e.platform] : ''}
                </span>
                <span className={e.level === 'error' ? 'text-bad' : ''}>{e.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function About() {
  const { data: info } = useLoad(() => api.app.info())
  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.about} />
      <div className="flex flex-col items-center gap-4 px-8 pt-4 text-center">
        <img src={logoStacked} alt="Expect Less Output" className="max-h-[420px] rounded-xl" />
        <div className="display text-3xl">{COPY.tagline}</div>
        <div className="text-muted">Version {info?.version}. Everything stays on this Mac.</div>
      </div>
    </div>
  )
}

export function SettingsScreen() {
  const { toast } = useApp()
  const { data: s } = useLoad(() => api.settings.get())
  const { data: info } = useLoad(() => api.app.info())
  const { data: status } = useLoad(() => api.scheduler.status())
  const save = async (patch: Partial<Settings>) => {
    try {
      await api.settings.set(patch)
    } catch (e) {
      toast({ kind: 'error', headline: 'That did not work.', detail: String((e as Error).message) })
    }
  }
  if (!s) return null
  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.settings} />
      <div className="max-w-4xl space-y-4 px-8">
        <Card title="Media library">
          <Field
            label="Media Root folder"
            hint="Each brand gets a Queue folder and a Posted folder inside it."
          >
            <div className="flex gap-2">
              <Input readOnly value={s.mediaRoot} />
              <Button
                onClick={async () => {
                  const p = await api.settings.pickMediaRoot()
                  if (p) await save({ mediaRoot: p })
                }}
              >
                Choose
              </Button>
              <Button onClick={() => api.app.openMediaRoot()}>Open</Button>
            </div>
          </Field>
        </Card>

        <Card title="Scheduling">
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Scheduling mode"
              hint="Slots: next open slot only. Manual: pick any time. Both: slot pre-filled, you can override."
            >
              <Select
                value={s.schedulingMode}
                onChange={(e) =>
                  save({ schedulingMode: e.target.value as Settings['schedulingMode'] })
                }
              >
                <option value="both">Both</option>
                <option value="slots">Slots</option>
                <option value="manual">Manual</option>
              </Select>
            </Field>
            <div />
            <Field
              label="Early handoff to YouTube (hours before)"
              hint="The platform publishes at the exact time by itself."
            >
              <Input
                type="number"
                min={0}
                max={72}
                value={s.handoffHoursYoutube}
                onChange={(e) => save({ handoffHoursYoutube: Number(e.target.value) })}
              />
            </Field>
            <Field label="Early handoff to Facebook (hours before)">
              <Input
                type="number"
                min={0}
                max={72}
                value={s.handoffHoursFacebook}
                onChange={(e) => save({ handoffHoursFacebook: Number(e.target.value) })}
              />
            </Field>
            <Field label="If a post was missed (Mac asleep or off)">
              <Select
                value={s.missedBehavior}
                onChange={(e) =>
                  save({ missedBehavior: e.target.value as Settings['missedBehavior'] })
                }
              >
                <option value="post_if_recent">Post on wake if not too late</option>
                <option value="hold">Hold and alert me</option>
              </Select>
            </Field>
            <Field label="Too late means more than (minutes)">
              <Input
                type="number"
                min={5}
                max={1440}
                value={s.missedGraceMinutes}
                onChange={(e) => save({ missedGraceMinutes: Number(e.target.value) })}
              />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <Check
              checked={s.schedulerPaused}
              onChange={(v) => (v ? api.scheduler.pause() : api.scheduler.resume())}
            >
              Pause the scheduler
            </Check>
            <span className="text-[12px] text-muted">
              {status?.pendingCount ?? 0} post(s) waiting.
            </span>
          </div>
        </Card>

        <Card title="App">
          <div className="space-y-3">
            <Check checked={s.launchAtLogin} onChange={(v) => save({ launchAtLogin: v })}>
              Open Expect Less Output when I log in
            </Check>
            <div className="text-[12px] text-muted">
              Closing the window keeps the scheduler running from the menu bar. Use Quit in the menu
              bar menu to stop it.
            </div>
            <Field label="Theme">
              <Select
                className="w-56"
                value={s.theme}
                onChange={(e) => save({ theme: e.target.value as Settings['theme'] })}
              >
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">Match macOS</option>
              </Select>
            </Field>
          </div>
        </Card>

        <Card title="Connections">
          <p className="text-muted">
            Google and YouTube logins are on the Connections screen. Secrets are stored encrypted in
            the macOS Keychain and are never shown in full. Keychain encryption is{' '}
            {info?.encryptionAvailable ? 'available' : 'NOT available'} on this Mac.
          </p>
        </Card>
        <AlertsCard s={s} save={save} />
        <AgentsCard s={s} save={save} />
        <TextAssistCard s={s} save={save} />
        <BackupCard />

        <Card title="Testing tools (dry run)">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Force a failure on">
              <Select
                value={s.dryRunFailPlatform ?? ''}
                onChange={(e) =>
                  save({
                    dryRunFailPlatform: (e.target.value || null) as Settings['dryRunFailPlatform'],
                  })
                }
              >
                <option value="">No platform</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABELS[p]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Kind of failure">
              <Select
                value={s.dryRunFailKind}
                onChange={(e) =>
                  save({ dryRunFailKind: e.target.value as Settings['dryRunFailKind'] })
                }
              >
                <option value="transient">Temporary (retries)</option>
                <option value="permanent">Permanent (no retries)</option>
              </Select>
            </Field>
            <div className="pt-6">
              <Check checked={s.fastBackoff} onChange={(v) => save({ fastBackoff: v })}>
                Short retry waits (5, 10, 15 seconds)
              </Check>
            </div>
          </div>
        </Card>

        <Card title="Where things live">
          <div className="space-y-1 text-[12px] text-muted">
            <div>Database: {info?.dbPath}</div>
            <div>App data: {info?.dataDir}</div>
          </div>
        </Card>
      </div>
    </div>
  )
}
