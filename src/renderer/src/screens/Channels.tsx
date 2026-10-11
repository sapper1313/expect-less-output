import { useState } from 'react'
import { Brands } from './Brands'
import { Connections } from './Connections'
import { StudioChannelSettings } from './StudioSettings'

export type ChannelsTab = 'setup' | 'connections' | 'studio'
const TABS: Array<[ChannelsTab, string, string]> = [
  ['setup', 'Channel setup', 'Names, colors, posting times, hashtags and defaults'],
  [
    'connections',
    'Connections',
    'Sign in to YouTube, Meta and TikTok and see if each login is healthy',
  ],
  [
    'studio',
    'Studio settings per channel',
    'How often the studio writes, which platforms, flags and the Bluesky account',
  ],
]

/** Everything about setting up a channel lives here: the channel itself, its logins, and its studio settings. */
export function Channels({ initialTab = 'setup' }: { initialTab?: ChannelsTab }) {
  const [tab, setTab] = useState<ChannelsTab>(initialTab)
  return (
    <div className="flex h-full flex-col">
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
      <div className="min-h-0 flex-1">
        {tab === 'setup' && <Brands />}
        {tab === 'connections' && <Connections />}
        {tab === 'studio' && (
          <div className="h-full overflow-auto px-8 pb-10 pt-4">
            <StudioChannelSettings />
          </div>
        )}
      </div>
    </div>
  )
}
