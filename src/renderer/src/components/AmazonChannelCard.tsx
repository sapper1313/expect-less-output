import { useEffect, useState } from 'react'
import type { Brand } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Field, Input, Textarea, useBusy } from '../ui'

/** Amazon lists for one channel: its Associates tracking id and the lines that go in its descriptions. */
export function AmazonChannelCard({ brand }: { brand: Brand }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data: ch, reload } = useLoad(() => api.amazon.channel(brand.id), [brand.id])
  const { data: live, reload: reloadLive } = useLoad(() => api.amazon.live(), [])
  const [tag, setTag] = useState('')
  const [pointer, setPointer] = useState('')
  const [disclosure, setDisclosure] = useState('')
  useEffect(() => {
    if (!ch) return
    setTag(ch.tag)
    setPointer(ch.pointer)
    setDisclosure(ch.disclosure)
  }, [ch?.tag, ch?.pointer, ch?.disclosure, brand.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!ch || live === undefined) return null
  const changed = tag !== ch.tag || pointer !== ch.pointer || disclosure !== ch.disclosure
  return (
    <Card title="Amazon lists">
      <p className="mb-3 text-[13px] text-muted">
        Product lists for this channel's videos. Create the tracking id for this channel in Amazon Associates, paste it
        here, and leave it blank for any channel that should never carry Amazon links (24/7 streams, ambient channels).
      </p>
      <Check
        checked={!!live}
        onChange={async (v) => {
          const n = await run(() => api.amazon.setLive(v))
          reloadLive()
          reload()
          if (n !== undefined && v)
            toast({ kind: 'success', headline: 'Amazon lists are on.', detail: `${n} waiting post(s) were looked at.` })
        }}
      >
        Amazon lists are live (every channel)
      </Check>
      <p className="mt-1 text-[12px] text-muted">
        Off means no list pages and no description lines are made. Turn on only after expectlessmedia.com is added as a
        Site in Associates.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Tracking id" hint="Like yourname-20. Letters, numbers and dashes.">
          <Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="yourname-20" />
        </Field>
        <div />
        <Field label="Line before the link" hint="Blank uses: Products from this video:">
          <Input value={pointer} onChange={(e) => setPointer(e.target.value)} />
        </Field>
        <Field label="Disclosure sentence" hint="Blank uses: As an Amazon Associate I earn from qualifying purchases.">
          <Textarea rows={2} value={disclosure} onChange={(e) => setDisclosure(e.target.value)} />
        </Field>
      </div>
      {ch.blocked && <p className="mt-3 text-[12px] text-muted">Right now: {ch.blocked}</p>}
      <div className="mt-3">
        <Button
          variant="primary"
          disabled={!changed || busy}
          onClick={async () => {
            if (await run(() => api.amazon.saveChannel(brand.id, { tag, pointer, disclosure }))) reload()
          }}
        >
          Save
        </Button>
      </div>
    </Card>
  )
}
