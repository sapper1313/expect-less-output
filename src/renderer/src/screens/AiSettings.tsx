import { useRef } from 'react'
import { COPY } from '@shared/copy'
import { PageHeader } from '../ui'
import { AgentsCard, BotsCard, TextAssistCard } from './Agents'
import { WhoWritesCard } from './PipelineSettings'
import { StudioAiKeys } from './StudioSettings'
import { StudioLocalAi } from './StudioLocalAi'
import { AgentModelsCard, ModelGuideCard } from './StudioModels'
import { UploadPostCard } from './UploadPostCard'
import { useSettings } from './settingsKit'

/** Everything AI: models, local AI, who writes, AI keys, mock mode and the Agent API. */
export function AiSettings() {
  const { s, save } = useSettings()
  const refs = {
    models: useRef<HTMLElement>(null),
    keys: useRef<HTMLElement>(null),
    upload: useRef<HTMLElement>(null),
    api: useRef<HTMLElement>(null),
  }
  if (!s) return null
  const jump = (k: keyof typeof refs) => refs[k].current?.scrollIntoView({ behavior: 'smooth' })
  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title={COPY.nav.aiSettings} />
      <div className="max-w-4xl space-y-4 px-8">
        <div className="flex flex-wrap gap-1">
          {(
            [
              ['models', 'Models and local AI'],
              ['keys', 'Keys and mock mode'],
              ['upload', 'Upload-Post'],
              ['api', 'Agent API'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => jump(id)}
              className="rounded-md px-3 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface2"
            >
              {label}
            </button>
          ))}
        </div>
        <section ref={refs.models} className="space-y-4">
          <WhoWritesCard s={s} save={save} />
          <AgentModelsCard />
          <ModelGuideCard />
          <TextAssistCard s={s} save={save} />
          <StudioLocalAi />
        </section>
        <section ref={refs.keys} className="space-y-4">
          <StudioAiKeys />
        </section>
        <section ref={refs.upload} className="space-y-4">
          <UploadPostCard />
        </section>
        <section ref={refs.api} className="space-y-4">
          <AgentsCard s={s} save={save} />
          <BotsCard />
        </section>
      </div>
    </div>
  )
}
