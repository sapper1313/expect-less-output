import { useState } from 'react'
import { COPY } from '@shared/copy'
import type { Brand } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { DateList } from './PipelineSettings'
import { PlatformSchedule } from './PlatformSchedule'
import { Button, Card, Check, Confirm, Field, Input, Select, useBusy } from '../ui'

/** The Channel Setup tab: the channel itself, its rules, and its posting times for Shorts and Long form. */
export function ChannelSetup({ brand, onArchived }: { brand: Brand; onArchived: () => void }) {
  return (
    <div className="space-y-4">
      <BrandCard brand={brand} onArchived={onArchived} />
      <PipelineRules brand={brand} />
      <PlatformSchedule brandId={brand.id} />
    </div>
  )
}

function BrandCard({ brand, onArchived }: { brand: Brand; onArchived: () => void }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [name, setName] = useState(brand.name)
  const [color, setColor] = useState(brand.color)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const { data: settings } = useLoad(() => api.settings.get())
  const paused = !!settings?.pausedBrandIds.includes(brand.id)
  return (
    <Card title="Channel">
      <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_auto]">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-9 w-16 rounded border border-line bg-bg"
          />
        </Field>
        <Button
          variant="primary"
          disabled={busy || !name.trim() || (name === brand.name && color === brand.color)}
          onClick={async () => {
            if (await run(() => api.brands.update(brand.id, { name, color })))
              toast({ kind: 'success', headline: COPY.success, detail: 'Channel saved.' })
          }}
        >
          Save
        </Button>
      </div>
      <div className="mt-3 space-y-3">
        <div>
          <Check
            checked={paused}
            onChange={(v) => run(() => api.studio.setBrand(brand.id, { paused: v }))}
          >
            Pause this channel
          </Check>
          <div className="ml-6 text-[12px] text-muted">
            Posts stay scheduled but nothing goes out. When you resume, a post that is less than
            your grace time late goes out and older ones are held as missed.
          </div>
        </div>
        {brand.archived ? (
          <Button onClick={() => run(() => api.brands.archive(brand.id, false))}>
            Restore channel
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setConfirmArchive(true)}>
            Archive channel
          </Button>
        )}
      </div>
      {confirmArchive && (
        <Confirm
          title="Are you sure?"
          message={`Archive ${brand.name}? ${COPY.confirm.archiveBrand}`}
          confirmLabel="Yes, archive it"
          danger
          onCancel={() => setConfirmArchive(false)}
          onConfirm={async () => {
            await run(() => api.brands.archive(brand.id, true))
            setConfirmArchive(false)
            onArchived()
          }}
        />
      )}
    </Card>
  )
}

/** The limits that belong to one channel: how many posts a day, how low the queue may run, and days it never posts. */
function PipelineRules({ brand }: { brand: Brand }) {
  const [busy, run] = useBusy()
  const { data: rules, reload } = useLoad(() => api.pipeline.channelRules(brand.id), [brand.id])
  if (!rules) return null
  const save = async (patch: Parameters<typeof api.pipeline.setChannelRules>[1]) => {
    if (await run(() => api.pipeline.setChannelRules(brand.id, patch))) reload()
  }
  return (
    <Card title="Pipeline rules">
      <p className="mb-3 text-[13px] text-muted">
        These control where the next open slot lands. A daily limit of 1 means only the first slot
        of each day is used, even if you have more times set below.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Most posts a day" hint="0 means no limit.">
          <Select
            aria-label="Most posts a day"
            disabled={busy}
            value={rules.maxPerDay}
            onChange={(e) => void save({ maxPerDay: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'No limit' : n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Low queue alert (days)" hint="Blank uses the setting for every channel.">
          <Select
            aria-label="Low queue alert"
            disabled={busy}
            value={rules.lowQueueDays ?? ''}
            onChange={(e) =>
              void save({ lowQueueDays: e.target.value === '' ? null : Number(e.target.value) })
            }
          >
            <option value="">Same as every channel</option>
            {[1, 2, 3, 5, 7, 14].map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <DateList
          label="Dates this channel does not post"
          dates={rules.blackoutDates}
          onChange={(d) => void save({ blackoutDates: d })}
        />
      </div>
    </Card>
  )
}
