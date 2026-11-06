import { useState } from 'react'
import { COPY } from '@shared/copy'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Input, useBusy } from '../ui'
import { ChannelSetup } from './Brands'
import { ChannelOther } from './ChannelOther'
import { Connections } from './Connections'
import { WebsiteProfileCard } from './WebsiteProfile'

export type ChannelsTab = 'setup' | 'connections' | 'other' | 'website'
const TABS: Array<[ChannelsTab, string, string]> = [
  ['setup', 'Channel Setup', 'Name, color, rules and posting times for Shorts and Long form'],
  ['connections', 'Connections', 'Sign in to YouTube, Facebook, Instagram, TikTok and Bluesky'],
  [
    'other',
    'Other settings by channel',
    'Scheduling mode, early handoff, missed posts, Inbox watching and studio settings',
  ],
  ['website', 'Website', 'Fill ELO from the channel website'],
]

/**
 * Setup Channels. Pick a channel on the left, then use its four tabs. Everything needed to start a channel is here:
 * the channel itself, its logins, its other settings and its website.
 */
export function Channels({ initialTab = 'setup' }: { initialTab?: ChannelsTab }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [tab, setTab] = useState<ChannelsTab>(initialTab)
  const [showArchived, setShowArchived] = useState(false)
  const { data: brands, reload } = useLoad(() => api.brands.list(showArchived), [showArchived])
  const [selId, setSelId] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#D9734E')
  const sel = brands?.find((b) => b.id === selId) ?? brands?.[0] ?? null

  return (
    <div className="flex h-full">
      <div className="w-[240px] shrink-0 space-y-3 overflow-auto border-r border-line p-4 pt-7">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Channels</div>
        <div className="space-y-1">
          {brands?.map((b) => (
            <button
              key={b.id}
              onClick={() => {
                setSelId(b.id)
                setAdding(false)
              }}
              className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left ${!adding && sel?.id === b.id ? 'border-accent bg-surface' : 'border-line hover:bg-surface'} ${b.archived ? 'opacity-50' : ''}`}
            >
              <span
                className="h-4 w-4 shrink-0 rounded-full border border-black/30"
                style={{ background: b.color }}
              />
              <span className="font-semibold">{b.name}</span>
              {b.archived && (
                <span className="ml-auto text-[10px] uppercase text-muted">archived</span>
              )}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add new channel
        </Button>
        <Check checked={showArchived} onChange={setShowArchived}>
          Show archived
        </Check>
      </div>
      <div className="min-w-0 flex-1 overflow-auto pb-10">
        {adding ? (
          <div className="max-w-xl px-8 pt-7">
            <Card title="Add new channel">
              <p className="mb-3 text-[13px] text-muted">
                Give it a name and a color. After that, set its posting times, sign in to its
                platforms and fill in the rest using the tabs.
              </p>
              <div className="space-y-3">
                <Input
                  placeholder="Channel name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    aria-label="Channel color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="h-9 w-14 rounded border border-line bg-bg"
                  />
                  <Button
                    variant="primary"
                    disabled={!newName.trim() || busy}
                    onClick={async () => {
                      const b = await run(() => api.brands.create(newName, newColor))
                      if (b) {
                        setSelId(b.id)
                        setNewName('')
                        setAdding(false)
                        setTab('setup')
                        reload()
                        toast({
                          kind: 'success',
                          headline: COPY.success,
                          detail: `Added ${b.name}.`,
                        })
                      }
                    }}
                  >
                    Add
                  </Button>
                  <Button onClick={() => setAdding(false)}>Cancel</Button>
                </div>
              </div>
            </Card>
          </div>
        ) : (
          sel && (
            <>
              <div className="no-drag flex flex-wrap gap-1 px-8 pt-7">
                {TABS.map(([id, label, hint]) => (
                  <button
                    key={id}
                    title={hint}
                    onClick={() => setTab(id)}
                    className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${tab === id ? 'bg-accent text-[#111]' : 'text-ink hover:bg-surface2'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="px-8 pt-4">
                {tab === 'setup' && <ChannelSetup key={sel.id} brand={sel} onArchived={reload} />}
                {tab === 'connections' && <Connections key={sel.id} brandId={sel.id} />}
                {tab === 'other' && <ChannelOther key={sel.id} brand={sel} />}
                {tab === 'website' && <WebsiteProfileCard key={sel.id} brand={sel} />}
              </div>
            </>
          )
        )}
      </div>
    </div>
  )
}
