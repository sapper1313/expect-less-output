import { COPY } from '@shared/copy'
import type { Brand, ChannelOverridePatch, MissedBehavior, SchedulingMode } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Field, Select, useBusy } from '../ui'
import { StudioBrandSettings } from './StudioSettings'

const MODE_LABEL: Record<SchedulingMode, string> = {
  slots: 'Slots only (next open time)',
  manual: 'Manual only (pick every time)',
  both: 'Both',
}

/**
 * The Other settings by channel tab. Each value here belongs to this one channel. A channel starts on the app wide
 * value, so nothing changes until a value is changed here. "Use the app wide setting" puts it back.
 */
export function ChannelOther({ brand }: { brand: Brand }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: o, reload } = useLoad(() => api.brands.getOverrides(brand.id), [brand.id])
  const { data: settings, reload: reloadSettings } = useLoad(() => api.settings.get())
  const { data: rules, reload: reloadRules } = useLoad(
    () => api.pipeline.channelRules(brand.id),
    [brand.id],
  )
  if (!o || !settings) return null
  const save = async (patch: ChannelOverridePatch) => {
    if (await run(() => api.brands.setOverrides(brand.id, patch))) {
      reload()
      toast({ kind: 'success', headline: COPY.success, detail: 'Saved for this channel.' })
    }
  }
  const mine = (k: string) => o.own.includes(k)
  const note = (k: string) => (
    <span className="mt-1 flex items-center gap-2 text-[11px] text-muted">
      {mine(k) ? 'Set for this channel only.' : 'Using the app wide setting.'}
      {mine(k) && (
        <button
          className="font-semibold text-accent"
          onClick={() => void save({ [k]: null } as ChannelOverridePatch)}
        >
          Use the app wide setting
        </button>
      )}
    </span>
  )
  const hoursSelect = (key: 'handoffHoursYoutube' | 'handoffHoursFacebook', label: string) => (
    <Field label={label}>
      <Select
        disabled={busy}
        value={o.values[key]}
        onChange={(e) => void save({ [key]: Number(e.target.value) } as ChannelOverridePatch)}
      >
        {[0, 1, 2, 3, 6, 12, 24].map((n) => (
          <option key={n} value={n}>
            {n === 0 ? 'Off' : `${n} hour${n === 1 ? '' : 's'}`}
          </option>
        ))}
      </Select>
      {note(key)}
    </Field>
  )
  const inboxOn = settings.inboxBrandIds.includes(brand.id)
  const autoOn = settings.inboxAutoScheduleBrandIds.includes(brand.id)
  const toggleList = async (key: 'inboxBrandIds' | 'inboxAutoScheduleBrandIds', on: boolean) => {
    const cur = settings[key] ?? []
    if (
      await run(() =>
        api.settings.set({
          [key]: on ? [...cur, brand.id] : cur.filter((id) => id !== brand.id),
        }),
      )
    )
      reloadSettings()
  }
  return (
    <div className="space-y-4">
      <Card title="Scheduling">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Scheduling mode">
            <Select
              disabled={busy}
              value={o.values.schedulingMode}
              onChange={(e) => void save({ schedulingMode: e.target.value as SchedulingMode })}
            >
              {(Object.keys(MODE_LABEL) as SchedulingMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </Select>
            {note('schedulingMode')}
          </Field>
          <div />
          {hoursSelect('handoffHoursYoutube', 'Early handoff to YouTube (hours before)')}
          {hoursSelect('handoffHoursFacebook', 'Early handoff to Facebook (hours before)')}
          <Field label="If a post was missed (Mac asleep or off)">
            <Select
              disabled={busy}
              value={o.values.missedBehavior}
              onChange={(e) => void save({ missedBehavior: e.target.value as MissedBehavior })}
            >
              <option value="post_if_recent">Post it if it is not too late</option>
              <option value="hold">Hold it and ask me</option>
            </Select>
            {note('missedBehavior')}
          </Field>
          <Field label="Too late means more than (minutes)">
            <Select
              disabled={busy}
              value={o.values.missedGraceMinutes}
              onChange={(e) => void save({ missedGraceMinutes: Number(e.target.value) })}
            >
              {[15, 30, 60, 120, 240, 720, 1440].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            {note('missedGraceMinutes')}
          </Field>
        </div>
      </Card>
      <Card title="Pipeline">
        <div className="space-y-3">
          <Check
            checked={!!rules?.onHold}
            onChange={(v) =>
              api.pipeline.setChannelRules(brand.id, { onHold: v }).then(reloadRules)
            }
          >
            On hold
          </Check>
          <div className="ml-6 text-[12px] text-muted">
            Not scheduling while a decision is made. New videos wait in the Inbox. Different from
            paused (a short break) and archived (gone for good).
          </div>
          <Check checked={inboxOn} onChange={(v) => void toggleList('inboxBrandIds', v)}>
            Watch this channel's Inbox folder
          </Check>
          <div className="ml-6 text-[12px] text-muted">
            Drop a video (and an optional .json file with the same name) into the channel's Inbox
            folder inside the Media Root and a post is made for you.
          </div>
          <div className="ml-6">
            <Check
              checked={autoOn}
              onChange={(v) => void toggleList('inboxAutoScheduleBrandIds', v)}
            >
              Schedule Inbox videos automatically (next open slot)
            </Check>
            <div className="ml-6 text-[12px] text-muted">
              A video dropped in the Inbox goes live at the next open slot with no review. Leave
              this off to get drafts you check first.
              {autoOn && !settings.agentMaySchedule && (
                <span className="text-warn">
                  {' '}
                  This does nothing yet. Untick "Agents may create drafts only" in AI Settings.
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>
      <StudioBrandSettings brandId={brand.id} />
      <div className="text-[12px] text-muted">
        <Button
          disabled={busy || o.own.length === 0}
          onClick={() =>
            void save({
              schedulingMode: null,
              handoffHoursYoutube: null,
              handoffHoursFacebook: null,
              missedBehavior: null,
              missedGraceMinutes: null,
            })
          }
        >
          Put every value above back to the app wide setting
        </Button>
      </div>
    </div>
  )
}
