import type { Settings } from '@shared/types'
import { Card, Check } from '../ui'

/** The switches for the bot pipeline: who writes, and what ELO does with finished videos. */
export function PipelineSettings({
  s,
  save,
}: {
  s: Settings
  save: (patch: Partial<Settings>) => Promise<void>
}) {
  return (
    <>
      <Card title="Who writes">
        <p className="mb-3 text-[13px] text-muted">
          In the bot pipeline, bots write and render every episode and drop finished videos in the
          Inbox. ELO takes the drops, schedules them with the slots you set, and posts them.
        </p>
        <div className="space-y-3">
          <div>
            <Check checked={s.claudeApiEnabled} onChange={(v) => save({ claudeApiEnabled: v })}>
              Allow ELO to use the Claude API
            </Check>
            <div className="ml-6 text-[12px] text-muted">
              Off means ELO makes no call to Anthropic at all. Models running on your own computer
              through Ollama still work.
            </div>
          </div>
          <div>
            <Check
              checked={s.studioProductionEnabled}
              onChange={(v) => save({ studioProductionEnabled: v })}
            >
              Let ELO write and produce episodes itself (Studio production)
            </Check>
            <div className="ml-6 text-[12px] text-muted">
              Off stops the Director from planning new episodes, and stops the Show Writer, the
              Producer and the idea refill. Library, Comments, Spend and the Director's Log keep
              working.
            </div>
          </div>
        </div>
      </Card>
    </>
  )
}
