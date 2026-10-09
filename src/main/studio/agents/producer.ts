import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { Db } from '../../db'
import { buildSrt, parseSegments, segmentsFromScript } from '@shared/studio/qc'
import type { StudioConfigService } from '../configService'
import type { EpisodeLibrary } from '../library'
import type { SpendService } from '../spend'
import type { VideoQc } from '../qc'
import type { BrandAssets } from '../assets'
import type { VideoJobs } from '../jobs'
import type { VideoClient } from '../xai'
import type { LocalAi } from '../localAi'
import { assemble } from '../assemble'
import { extractFrame, extractWav, probe } from '../ffmpeg'
import { AgentDef, FlagNow, Waiting } from './framework'
import type { LlmGateway } from './llm'
import { ctxLine } from './prompts'

export interface ProducerDeps {
  db: Db
  cfg: StudioConfigService
  spend: SpendService
  episodes: EpisodeLibrary
  jobs: VideoJobs
  qc: VideoQc
  assets: BrandAssets
  gateway: LlmGateway
  localAi: LocalAi
  video: () => VideoClient
  workDir: (episodeId: string) => string
}

const Input = z.object({ episodeId: z.string() })
const Output = z.object({ episodeId: z.string(), finalPath: z.string(), clips: z.number(), takes: z.number() })
const FixedPrompt = z.object({ prompt: z.string().min(5) })

const dataUri = (path: string) => `data:image/${path.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(path).toString('base64')}`

/**
 * The Producer makes the video for an episode through the Grok API. Every clip is a persisted job, so the task can be
 * stopped and resumed at any time without paying twice. It polls, downloads at once (results expire), asks Video QC,
 * retries a bad clip with a prompt the text agent fixed, then assembles with ffmpeg and hands the finished video to the Publisher.
 */
export function makeProducerAgent(d: ProducerDeps): AgentDef<z.infer<typeof Input>, z.infer<typeof Output>> {
  return {
    name: 'Producer',
    taskType: 'produce_episode',
    role: 'Makes the video for an episode through the xAI Grok Imagine API, checks every clip, retries bad ones, and assembles the final video.',
    input: Input,
    output: Output,
    tools: ['xai', 'ffmpeg', 'video_qc', 'spend'],
    paid: true,
    async run(ctx, input) {
      const { episodeId } = input
      const ep = d.episodes.get(episodeId)
      const pkg = d.episodes.getPackage(episodeId)
      if (!pkg || !pkg.scenes.length) throw new FlagNow('The episode has no clips to make.')
      const cfg = d.cfg.get()
      const brand = d.cfg.getBrand(ep.brandId)
      const tier = cfg.formatModel[brand.format]
      const model = cfg.modelIds[tier]
      const aspect = brand.format === 'short' ? '9:16' : '16:9'
      const mock = cfg.mockMode
      const price = cfg.prices.video[tier][brand.resolution]
      const chain = brand.format === 'long' && brand.hollowViaApi
      const work = d.workDir(episodeId)
      mkdirSync(work, { recursive: true })
      if (['Ready for production', 'Flagged'].includes(ep.status)) d.episodes.setStatus(episodeId, 'In production', 'The Producer started.')

      for (const s of pkg.scenes)
        d.jobs.plan({ episodeId, brandId: ep.brandId, clipN: s.n, take: 1, prompt: s.grok_prompt, model, resolution: brand.resolution, aspect, generateSeconds: s.generate_seconds, keepSeconds: s.content_seconds, purpose: 'first take' })

      const client = d.video()
      const refs = chain ? [] : d.assets.list(ep.brandId, 'reference_image').slice(0, 14)
      const refCost = refs.length * cfg.prices.referenceImage
      const sceneOf = (n: number) => pkg.scenes.find((s) => s.n === n)
      const maxTakes = cfg.qcClipRetryCap + 1

      for (let pass = 0; pass < 60; pass++) {
        let progressed = false
        let waiting = false
        for (const job of d.jobs.latest(episodeId)) {
          if (['passed', 'approved', 'discarded'].includes(job.status)) continue
          if (job.status === 'flagged') throw new FlagNow(job.error ?? `Clip ${job.clipN} needs a look.`)
          const prev = d.jobs.latest(episodeId).find((j) => j.clipN === job.clipN - 1)
          if (chain && prev && !['passed', 'approved'].includes(prev.status)) {
            waiting = true
            break // a chained scene needs the last frame of the one before it
          }

          if (job.status === 'planned') {
            if (d.jobs.activeCount() >= cfg.paidConcurrency) {
              waiting = true
              continue
            }
            const dollars = job.generateSeconds * price + (chain ? 0 : refCost)
            d.spend.check({ brandId: ep.brandId, episodeId, vendor: 'xai', dollars, mock })
            let imageUrl: string | undefined
            if (chain && prev?.filePath) {
              const frame = join(work, `frame-${prev.clipN}-take-${prev.take}.jpg`)
              if (!existsSync(frame)) await extractFrame(prev.filePath, Math.max(0, prev.keepSeconds - 0.1), frame)
              imageUrl = dataUri(frame)
            }
            const { requestId } = await client.start({
              model: job.model,
              prompt: job.prompt,
              durationSeconds: job.generateSeconds,
              resolution: job.resolution as '480p',
              aspectRatio: job.aspect as '9:16',
              referenceImageUrls: !imageUrl && refs.length ? refs.map((r) => dataUri(r.path)) : undefined,
              imageUrl,
            })
            d.jobs.update(job.id, { status: 'started', requestId })
            d.spend.record({
              brandId: ep.brandId,
              episodeId,
              taskId: ctx.task.id,
              vendor: 'xai',
              model: job.model,
              resolution: job.resolution,
              units: job.generateSeconds,
              unitKind: 'seconds',
              unitPrice: price,
              dollars,
              requestId,
              purpose: job.purpose,
              mock,
            })
            ctx.audit('clip_started', { clip: job.clipN, take: job.take, requestId, purpose: job.purpose })
            progressed = true
            continue
          }

          if (job.status === 'started') {
            const st = await client.poll(job.requestId as string)
            if (st.status === 'pending') {
              waiting = true
              continue
            }
            if (st.status === 'done') {
              const file = join(work, `clip-${job.clipN}-take-${job.take}.mp4`)
              await client.download(st.url, file) // at once: result links expire
              d.jobs.update(job.id, { status: 'downloaded', filePath: file })
              ctx.audit('clip_downloaded', { clip: job.clipN, take: job.take })
            } else {
              const why = st.status === 'failed' ? `The video model reported a failure: ${st.error}` : 'The video request expired before it could be downloaded.'
              d.jobs.update(job.id, { status: st.status === 'failed' ? 'failed' : 'expired', error: why })
              ctx.audit('clip_failed', { clip: job.clipN, take: job.take, why })
            }
            progressed = true
            continue
          }

          if (job.status === 'downloaded') {
            const scene = sceneOf(job.clipN)
            const r = await d.qc.check({
              path: job.filePath as string,
              episodeId,
              brandId: ep.brandId,
              clipN: job.clipN,
              expectSeconds: job.keepSeconds,
              aspect,
              scriptedLines: scene?.dialogue.map((l) => l.line) ?? [],
              scene: scene?.action ?? job.prompt,
              mode: 'full',
            })
            if (r.pass) {
              d.jobs.update(job.id, { status: 'passed', qc: r })
              progressed = true
              continue
            }
            d.jobs.update(job.id, { status: 'failed', qc: r, error: r.reasons.join(' ') })
            progressed = true
            continue
          }

          if (job.status === 'failed' || job.status === 'expired') {
            if (job.take >= maxTakes) {
              d.jobs.update(job.id, { status: 'flagged' })
              throw new FlagNow(`Clip ${job.clipN} failed after ${job.take} takes. Last problem: ${job.error ?? 'unknown'}`)
            }
            let prompt = job.prompt
            if (job.qc) {
              try {
                const fixed = await d.gateway.json(
                  {
                    agent: 'Producer',
                    brandId: ep.brandId,
                    episodeId,
                    taskId: ctx.task.id,
                    system: 'You fix prompts for an AI video model. Given a prompt and why the clip failed checks, write an improved prompt that fixes the problem. Keep the same scene. Answer only with JSON: {"prompt": "..."}.',
                    user: `${ctxLine({ task: 'fix_prompt', prompt: job.prompt })}\nPrompt: ${job.prompt}\nProblem: ${job.error}`,
                    maxTokens: 600,
                  },
                  FixedPrompt,
                )
                prompt = fixed.prompt
              } catch {
                prompt = `${job.prompt} Steady, well lit and clearly visible, with clear sound.`
              }
            }
            d.jobs.plan({ episodeId, brandId: ep.brandId, clipN: job.clipN, take: job.take + 1, prompt, model: job.model, resolution: job.resolution, aspect: job.aspect, generateSeconds: job.generateSeconds, keepSeconds: job.keepSeconds, purpose: 'retry' })
            ctx.audit('clip_retry', { clip: job.clipN, take: job.take + 1, because: job.error })
            progressed = true
          }
        }
        if (!progressed) {
          if (waiting) break
          if (d.jobs.latest(episodeId).every((j) => ['passed', 'approved'].includes(j.status))) break
          break
        }
      }

      const latest = d.jobs.latest(episodeId)
      if (!latest.every((j) => ['passed', 'approved'].includes(j.status))) throw new Waiting(ctx.now() + (mock ? 1000 : 15_000))

      // ---- assemble ----
      const useSlots = brand.useOpeningOutro || chain
      const opening = useSlots ? d.assets.slot(ep.brandId, 'opening') : null
      const outro = useSlots ? d.assets.slot(ep.brandId, 'outro') : null
      const first = await probe(latest[0].filePath as string)
      const finalPath = join(work, 'final.mp4')
      const srtPath = join(work, 'final.srt')
      const clips = latest.map((j) => ({ path: j.filePath as string, keepSeconds: j.keepSeconds }))
      const plain = () => assemble({ segments: [...(opening ? [{ path: opening.path }] : []), ...clips, ...(outro ? [{ path: outro.path }] : [])], out: finalPath, width: first.width, height: first.height, crossfade: chain ? 0.4 : 0, lufs: brand.format === 'short' ? -14 : -16 })
      const result = await plain()
      ctx.audit('assembled', { seconds: result.durationSeconds, opening: !!opening, outro: !!outro })

      // ---- captions ----
      let burned = false
      if (brand.captionMode !== 'off') {
        let segs = segmentsFromScript(pkg.scenes.map((s) => ({ seconds: s.content_seconds, lines: s.dialogue.map((l) => l.line) })).filter((c) => c.lines.length))
        if (!d.qc.simulate && !cfg.mockMode) {
          try {
            const wav = join(work, 'final.wav')
            await extractWav(finalPath, wav)
            const heard = parseSegments((await d.localAi.whisper.transcribe(wav)).text)
            if (heard.length) segs = heard
          } catch {
            // No Whisper: the scripted lines are used for the caption timing.
          }
        }
        writeFileSync(srtPath, buildSrt(segs))
        if (brand.captionMode === 'burn') {
          const b = await assemble({ segments: [{ path: finalPath }], out: join(work, 'final-burned.mp4'), width: first.width, height: first.height, crossfade: 0, lufs: brand.format === 'short' ? -14 : -16, burnSrt: srtPath })
          burned = b.burned
        }
      }
      const outFile = burned ? join(work, 'final-burned.mp4') : finalPath
      // Hand the finished video to the Publisher. It is its own task so a text or thumbnail problem never remakes the video.
      d.episodes.setStatus(episodeId, 'Video received', 'The Producer finished the video.', { videoPath: outFile })
      ctx.tasks.create({ type: 'publish_episode', brandId: ep.brandId, episodeId, payload: { episodeId, videoPath: outFile, srt: brand.captionMode === 'off' ? undefined : srtPath }, dedupeKey: `publish:${episodeId}` })
      ctx.audit('handed_to_publisher', { takes: d.jobs.all(episodeId).length })
      return { episodeId, finalPath: outFile, clips: latest.length, takes: d.jobs.all(episodeId).length }
    },
  }
}
