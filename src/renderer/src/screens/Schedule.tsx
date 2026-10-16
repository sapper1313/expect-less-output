import { useState } from 'react'
import { NewPost } from './NewPost'
import { Bulk } from './Bulk'

export type ScheduleMode = 'one' | 'many'

/**
 * The one place to schedule videos. One video, or many at once. Everything else (the calendar, the queue, the Inbox
 * folder, the Studio) either shows what is scheduled or schedules by itself.
 */
export function Schedule({
  initialMode = 'one',
  initialWhen = null,
  onDone,
}: {
  initialMode?: ScheduleMode
  /** A time (UTC ISO) to start with, for example from clicking a day on the calendar. */
  initialWhen?: string | null
  onDone: () => void
}) {
  const [mode, setMode] = useState<ScheduleMode>(initialMode)
  const tabs: Array<[ScheduleMode, string, string]> = [
    ['one', 'One video', 'Pick a video, check each platform, choose a time'],
    ['many', 'Many videos', 'Drop several videos and give each one a time'],
  ]
  return (
    <div className="flex h-full flex-col">
      <div className="no-drag flex flex-wrap items-center gap-1 px-8 pt-7">
        {tabs.map(([id, label, hint]) => (
          <button
            key={id}
            title={hint}
            onClick={() => setMode(id)}
            aria-pressed={mode === id}
            className={`rounded-md px-3 py-1.5 text-[13px] font-semibold ${mode === id ? 'bg-accent text-[#111]' : 'text-ink hover:bg-surface2'}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-3 text-[12px] text-muted">
          Videos dropped into a brand's Inbox folder, and episodes from the Studio, are scheduled
          for you.
        </span>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'one' ? (
          <NewPost initialWhen={initialWhen} onDone={onDone} />
        ) : (
          <Bulk onDone={onDone} />
        )}
      </div>
    </div>
  )
}
