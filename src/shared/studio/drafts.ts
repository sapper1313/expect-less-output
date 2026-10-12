import { z } from 'zod'
import type { EpisodePackage, Scene } from './types'

const YouTube = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  tags: z.array(z.string()).default([]),
})

export const Clip = z.object({
  n: z.number().int().min(1),
  seconds: z.number().min(1).max(15),
  prompt: z.string().min(1),
  dialogue: z.array(z.string()).default([]),
})

/** What a short form Writer returns. */
export const ShortDraft = z.object({
  title: z.string().min(1),
  idea: z.string().min(1),
  hook: z.string().min(1),
  script: z.string().min(1),
  clips: z.array(Clip).min(1),
  caption: z.string().min(1),
  hashtags: z.array(z.string()).default([]),
  youtube: YouTube,
  summary: z.string().min(1),
  tags: z.array(z.string()).default([]),
  key_lines: z.array(z.string()).default([]),
})
export type ShortDraftData = z.infer<typeof ShortDraft>

export const SceneSchema = z.object({
  n: z.number().int().min(1),
  content_seconds: z.number().default(10),
  generate_seconds: z.number().min(1).max(15).default(10),
  setting: z.string(),
  characters: z.array(z.string()).default([]),
  action: z.string(),
  dialogue: z.array(z.object({ speaker: z.string(), line: z.string() })).default([]),
  objects_in_frame: z.array(z.string()).default([]),
  camera: z.string().default(''),
  transition_in: z.string().default(''),
  transition_out: z.string().default(''),
  grok_prompt: z.string().min(1),
  extension_note: z.string().default(''),
})

/** What the Hollow Writer returns: the complete episode package. */
export const HollowDraft = z.object({
  title: z.string().min(1),
  idea: z.string().min(1),
  logline: z.string().min(1),
  life_lesson: z.string().min(1),
  math_lesson: z.string().min(1),
  runtime_target_seconds: z.number().default(180),
  counted_objects: z
    .array(
      z.object({
        name: z.string(),
        quantity: z.number().int().positive(),
        scenes: z.array(z.number().int()),
      }),
    )
    .default([]),
  scenes: z.array(SceneSchema).min(1),
  youtube: YouTube,
  thumbnail_brief: z.string().default(''),
  summary: z.string().min(1),
  tags: z.array(z.string()).default([]),
  key_lines: z.array(z.string()).default([]),
})
export type HollowDraftData = z.infer<typeof HollowDraft>

/** Long episodes are written in parts. First the plan: everything except the scenes, plus one beat for every scene. */
export const HollowOutline = HollowDraft.omit({ scenes: true }).extend({
  beats: z.array(z.object({ n: z.number().int().min(1), beat: z.string().min(1) })).min(1),
})
export type HollowOutlineData = z.infer<typeof HollowOutline>

/** Then the scenes, a few at a time. */
export const SceneBatch = z.object({ scenes: z.array(SceneSchema).min(1) })

export const Draft = z.union([HollowDraft, ShortDraft])

export function isHollow(d: ShortDraftData | HollowDraftData): d is HollowDraftData {
  return 'scenes' in d
}

type NewPackage = Omit<
  EpisodePackage,
  'id' | 'brand' | 'brand_id' | 'status_history' | 'schema_version'
>

/** Turns a Writer draft into the stored package. Shorts keep their clips as scenes so one viewer shows both. */
export function draftToPackage(
  series: string,
  number: number,
  d: ShortDraftData | HollowDraftData,
  madeForKids: boolean,
  ai: boolean,
): NewPackage {
  if (isHollow(d)) {
    return {
      series,
      episode_number: number,
      title: d.title,
      logline: d.logline,
      life_lesson: d.life_lesson,
      math_lesson: d.math_lesson,
      runtime_target_seconds: d.runtime_target_seconds,
      counted_objects: d.counted_objects,
      scenes: d.scenes as Scene[],
      youtube: { ...d.youtube, made_for_kids: madeForKids, ai_disclosure: ai },
      thumbnail_brief: d.thumbnail_brief,
      tags: d.tags,
      summary: d.summary,
      extra: { idea: d.idea, key_lines: d.key_lines },
    }
  }
  const scenes: Scene[] = d.clips.map((c) => ({
    n: c.n,
    content_seconds: c.seconds,
    generate_seconds: c.seconds,
    setting: '',
    characters: [],
    action: c.prompt,
    dialogue: c.dialogue.map((line) => ({ speaker: 'Host', line })),
    objects_in_frame: [],
    camera: '',
    transition_in: '',
    transition_out: '',
    grok_prompt: c.prompt,
    extension_note: '',
  }))
  return {
    series,
    episode_number: number,
    title: d.title,
    logline: d.hook,
    runtime_target_seconds: Math.round(d.clips.reduce((n, c) => n + c.seconds, 0)),
    counted_objects: [],
    script: d.script,
    scenes,
    youtube: { ...d.youtube, made_for_kids: madeForKids, ai_disclosure: ai },
    tags: d.tags,
    summary: d.summary,
    extra: {
      idea: d.idea,
      hook: d.hook,
      caption: d.caption,
      hashtags: d.hashtags,
      key_lines: d.key_lines,
    },
  }
}

/** All the text of a draft in one string, for the style and similarity checks. */
export function draftText(d: ShortDraftData | HollowDraftData): string {
  return JSON.stringify(d)
}
