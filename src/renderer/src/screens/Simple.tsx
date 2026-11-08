import { useRef, useState } from 'react'
import { PLATFORMS, PLATFORM_LABELS } from '@shared/platformLimits'
import { COPY } from '@shared/copy'
import { formatEastern } from '@shared/time'
import { COLOR_THEMES, type LogFilter, type Settings } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Empty, Field, Input, PageHeader, Select } from '../ui'
import logoStacked from '../assets/logo-stacked.jpg'
import { AlertsCard, BackupCard } from './AlertsBackup'
import { GrowthSettings } from './GrowthSettings'
import { PipelineSettings } from './PipelineSettings'
import { StudioAppSettings, StudioOperationsSettings } from './StudioSettings'
import { TelegramCard } from './TelegramCard'
import { useSettings } from './settingsKit'

const LEVEL_STYLE = { info: 'text-muted', warn: 'text-warn', error: 'text-bad' }

/** The Activity Log and the Audit log. They sit at the bottom of About. */
export function Activity() {
  const [tab, setTab] = useState<'log' | 'audit'>('log')
  const [filter, setFilter] = useState<LogFilter>({ level: 'all', platform: null })
  const { data } = useLoad(() => api.log.list({ ...filter, limit: 500 }), [JSON.stringify(filter)])
  return (
    <div>
      <h2 className="display mb-3 text-2xl">{COPY.nav.activity}</h2>
      <div className="space-y-4">
        <div className="flex gap-1">
          {(
            [
              ['log', 'Activity log'],
              ['audit', 'Audit log'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${tab === id ? 'bg-accent text-[#111]' : 'text-ink hover:bg-surface2'}`}
            >
              {label}
            </button>
          ))}
        </div>
        {tab === 'audit' && <AuditLog />}
        {tab === 'log' && (
          <div className="flex gap-3">
            <Select
              className="w-40"
              aria-label="Level"
              value={filter.level ?? 'all'}
              onChange={(e) =>
                setFilter({ ...filter, level: e.target.value as LogFilter['level'] })
              }
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
                setFilter({
                  ...filter,
                  platform: (e.target.value || null) as LogFilter['platform'],
                })
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
        )}
        {tab === 'log' && data && data.length === 0 ? (
          <Empty>{COPY.emptyLog}</Empty>
        ) : tab === 'log' ? (
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
        ) : null}
      </div>
    </div>
  )
}

function AuditLog() {
  const { toast } = useApp()
  const [actor, setActor] = useState('')
  const { data } = useLoad(() => api.pipeline.audit({ actor: actor || undefined }), [actor])
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <Select
          className="w-52"
          aria-label="Who"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        >
          <option value="">Everyone</option>
          <option value="josh">josh</option>
          <option value="system">system</option>
          {['grok-bot', 'kids-comedy', 'beth', 'gemini'].map((b) => (
            <option key={b} value={`agent:${b}`}>
              agent:{b}
            </option>
          ))}
        </Select>
        <Button
          onClick={async () => {
            const text = await api.pipeline.auditCsv({ actor: actor || undefined })
            const path = await api.media.saveCsv(
              `ELO audit log ${new Date().toISOString().slice(0, 10)}.csv`,
              text,
            )
            if (path) toast({ kind: 'success', headline: 'Saved.', detail: path })
          }}
        >
          Export CSV
        </Button>
      </div>
      <p className="text-[12px] text-muted">
        Every setting change, schedule edit, rejection, post, file removal and Upcoming write, with
        who did it and what it was before.
      </p>
      {data && data.length === 0 ? (
        <Empty>Nothing has been recorded yet.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line text-[12px]">
          <table className="w-full text-left">
            <thead className="bg-surface2 text-[11px] uppercase text-muted">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Who</th>
                <th className="px-3 py-2">What</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Before</th>
                <th className="px-3 py-2">After</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((e) => (
                <tr key={e.id} className="border-t border-line align-top">
                  <td className="px-3 py-2">{formatEastern(e.at, false)}</td>
                  <td className="px-3 py-2">{e.actor}</td>
                  <td className="px-3 py-2 font-semibold">{e.action}</td>
                  <td className="px-3 py-2">{e.target}</td>
                  <td className="max-w-xs break-words px-3 py-2 text-muted">
                    {e.before === null ? '' : JSON.stringify(e.before)}
                  </td>
                  <td className="max-w-xs break-words px-3 py-2">
                    {e.after === null ? '' : JSON.stringify(e.after)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
      <div className="mx-8 mt-10 border-t border-line pt-6">
        <Activity />
      </div>
    </div>
  )
}

/** Where each old tab name scrolls to on the one long Settings page. */
export type SettingsTab =
  'general' | 'pipeline' | 'growth' | 'studio' | 'alerts' | 'ai' | 'api' | 'testing'

const SECTIONS = [
  ['general', 'General'],
  ['pipeline', 'Pipeline'],
  ['growth', 'Growth'],
  ['studio', 'Studio rules'],
  ['alerts', 'Alerts and backups'],
] as const
type SectionId = (typeof SECTIONS)[number][0]

const SECTION_OF: Record<SettingsTab, SectionId> = {
  general: 'general',
  pipeline: 'pipeline',
  growth: 'growth',
  studio: 'studio',
  alerts: 'alerts',
  ai: 'general',
  api: 'general',
  testing: 'general',
}

/** Everything that has to be app wide, on one long page. The row of buttons at the top jumps to a part. */
export function SettingsScreen({ initialTab = 'general' }: { initialTab?: SettingsTab }) {
  const { s, save } = useSettings()
  const { data: info } = useLoad(() => api.app.info())
  const { data: status } = useLoad(() => api.scheduler.status())
  const refs = useRef<Record<string, HTMLElement | null>>({})
  const jump = (id: string) => refs.current[id]?.scrollIntoView({ behavior: 'smooth' })
  const startAt = SECTION_OF[initialTab]
  const first = useRef(true)
  if (!s) return null
  const section = (id: SectionId, title: string, children: React.ReactNode) => (
    <section
      key={id}
      ref={(el) => {
        refs.current[id] = el
        if (el && first.current && id === startAt && startAt !== 'general') {
          first.current = false
          setTimeout(() => el.scrollIntoView(), 0)
        }
      }}
      className="space-y-4"
    >
      <h2 className="display border-b border-line pb-1 pt-4 text-xl">{title}</h2>
      {children}
    </section>
  )
  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.settings} />
      <div className="max-w-4xl space-y-4 px-8">
        <p className="text-[13px] text-muted">
          Only things that are the same for the whole app live here. Anything that belongs to one
          channel is on Setup Channels. AI is under AI Settings. Money is under Financial.
        </p>
        <div className="sticky top-0 z-10 flex flex-wrap gap-1 bg-bg py-2">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => jump(id)}
              className="rounded-md px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface2"
            >
              {label}
            </button>
          ))}
        </div>

        {section(
          'general',
          'General',
          <>
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

            <Card title="If the Mac was asleep or off">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="If a post was missed">
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
              <div className="mt-4 text-[12px] text-muted">
                {status?.pendingCount ?? 0} post(s) waiting. To pause everything, use the pause
                button at the bottom of the left menu or the menu bar icon.
              </div>
            </Card>

            <Card title="App">
              <div className="space-y-3">
                <Check checked={s.launchAtLogin} onChange={(v) => save({ launchAtLogin: v })}>
                  Open Expect Less Output when I log in
                </Check>
                <div className="text-[12px] text-muted">
                  Closing the window keeps the scheduler running from the menu bar. Use Quit in the
                  menu bar menu to stop it.
                </div>
                <Field label="Color theme" hint="The same glass look in different colors. It changes everything except the left menu.">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Color theme">
                    {COLOR_THEMES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="radio"
                        aria-checked={s.colorTheme === t.id}
                        title={t.note}
                        onClick={() => save({ colorTheme: t.id })}
                        className={`rounded-lg border p-2 text-left ${s.colorTheme === t.id ? 'border-accent' : 'border-line hover:bg-surface2'}`}
                      >
                        <span className="swatch block h-10 rounded-md" data-look={t.id} />
                        <span className="mt-1 block text-[12px] font-semibold">{t.name}</span>
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </Card>

            <Card title="Where things live">
              <div className="space-y-1 text-[12px] text-muted">
                <div>Database: {info?.dbPath}</div>
                <div>App data: {info?.dataDir}</div>
                <div>
                  Logins are stored encrypted in the macOS Keychain and never shown in full.
                  Keychain encryption is {info?.encryptionAvailable ? 'available' : 'NOT available'}{' '}
                  on this Mac. The logins themselves are on Setup Channels, Connections.
                </div>
              </div>
            </Card>
          </>,
        )}

        {section('pipeline', 'Pipeline', <PipelineSettings s={s} save={save} />)}
        {section('growth', 'Growth', <GrowthSettings s={s} save={save} />)}
        {section(
          'studio',
          'Studio rules (production, thumbnails, limits, retention, writing)',
          <StudioAppSettings />,
        )}
        {section(
          'alerts',
          'Alerts and backups',
          <>
            <AlertsCard s={s} save={save} />
            <TelegramCard />
            <StudioOperationsSettings only={['digest', 'watchdog']} />
            <BackupCard />
            <StudioOperationsSettings only={['backups']} />
          </>,
        )}
      </div>
    </div>
  )
}
