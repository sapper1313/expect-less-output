import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { Db } from '../db'
import type { LlmGateway } from './agents/llm'
import type { EpisodeLibrary } from './library'
import { slug } from './library'
import {
  buildCues,
  chapterGroups,
  chaptersText,
  LANGUAGES,
  toSrt,
  type Chapter,
} from '@shared/studio/captions'

export interface CaptionDeps {
  db: Db
  gateway: LlmGateway
  episodes: EpisodeLibrary
  brandName: (id: number) => string
  /** Where caption files are written, one folder per brand. */
  root: () => string
  now?: () => number
}

const Names = z.object({ titles: z.array(z.string()).default([]) })
const Cues = z.object({ cues: z.array(z.string()).default([]) })

/** Chapters for the YouTube description, and captions in other languages, made from the episode script. */
export class CaptionService {
  constructor(private d: CaptionDeps) {}
  private iso() {
    return new Date(this.d.now ? this.d.now() : Date.now()).toISOString()
  }

  chapters(episodeId: string): Chapter[] {
    const r = this.d.db
      .prepare('SELECT chapters_json FROM episode_chapters WHERE episode_id = ?')
      .get(episodeId) as { chapters_json: string } | undefined
    return r ? (JSON.parse(r.chapters_json) as Chapter[]) : []
  }

  async makeChapters(episodeId: string): Promise<{ chapters: Chapter[]; text: string }> {
    const ep = this.d.episodes.find(episodeId)
    const pkg = this.d.episodes.getPackage(episodeId)
    if (!ep || !pkg) throw new Error('That episode was not found.')
    const groups = chapterGroups(pkg)
    if (!groups.length)
      throw new Error(
        'This video is too short for chapters. YouTube needs at least 3 chapters and a video of about a minute or more.',
      )
    const info = groups.map(
      (g, i) =>
        `${i + 1}. ${g.scenes
          .map((s) => pkg.scenes[s].action)
          .join(' ')
          .slice(0, 220)}`,
    )
    let titles: string[] = []
    try {
      const out = await this.d.gateway.json(
        {
          agent: 'Chapters',
          brandId: ep.brandId,
          episodeId,
          system:
            'You name the chapters of a video. Give each part a title of 2 to 5 words that tells a viewer what happens, in plain words, no quotation marks, and never use em dashes. Answer only with JSON: {"titles":["",""]} with exactly one title per part, in order.',
          user: `Video: ${pkg.title}\nParts:\n${info.join('\n')}`,
          maxTokens: 1000,
        },
        Names,
      )
      titles = out.titles
    } catch {
      titles = []
    }
    const chapters: Chapter[] = groups.map((g, i) => ({
      start: g.start,
      title: (titles[i] || pkg.scenes[g.scenes[0]].action).replace(/\s+/g, ' ').slice(0, 48).trim(),
    }))
    chapters[0].start = 0
    this.d.db
      .prepare(
        'INSERT INTO episode_chapters (episode_id, chapters_json, created_utc) VALUES (?, ?, ?) ON CONFLICT(episode_id) DO UPDATE SET chapters_json = excluded.chapters_json, created_utc = excluded.created_utc',
      )
      .run(episodeId, JSON.stringify(chapters), this.iso())
    return { chapters, text: chaptersText(chapters) }
  }

  captions(episodeId: string): Array<{ lang: string; name: string; cues: number }> {
    const rows = this.d.db
      .prepare('SELECT lang, srt FROM episode_captions WHERE episode_id = ? ORDER BY lang')
      .all(episodeId) as Array<{ lang: string; srt: string }>
    return rows.map((r) => ({
      lang: r.lang,
      name: r.lang === 'en' ? 'English' : (LANGUAGES.find(([c]) => c === r.lang)?.[1] ?? r.lang),
      cues: (r.srt.match(/-->/g) ?? []).length,
    }))
  }

  srt(episodeId: string, lang: string): string | null {
    return (
      (
        this.d.db
          .prepare('SELECT srt FROM episode_captions WHERE episode_id = ? AND lang = ?')
          .get(episodeId, lang) as { srt: string } | undefined
      )?.srt ?? null
    )
  }

  /** English from the script, then each chosen language translated line by line. */
  async makeCaptions(
    episodeId: string,
    languages: string[],
  ): Promise<Array<{ lang: string; name: string; cues: number }>> {
    const ep = this.d.episodes.find(episodeId)
    const pkg = this.d.episodes.getPackage(episodeId)
    if (!ep || !pkg) throw new Error('That episode was not found.')
    const cues = buildCues(pkg)
    if (!cues.length) throw new Error('This episode has no spoken lines to caption.')
    const save = (lang: string, srt: string) =>
      this.d.db
        .prepare(
          'INSERT INTO episode_captions (episode_id, lang, srt, created_utc) VALUES (?, ?, ?, ?) ON CONFLICT(episode_id, lang) DO UPDATE SET srt = excluded.srt, created_utc = excluded.created_utc',
        )
        .run(episodeId, lang, srt, this.iso())
    save('en', toSrt(cues))
    for (const lang of languages.filter((l) => LANGUAGES.some(([c]) => c === l))) {
      const name = LANGUAGES.find(([c]) => c === lang)![1]
      const out = await this.d.gateway.json(
        {
          agent: 'Translator',
          brandId: ep.brandId,
          episodeId,
          system: `You translate video captions into ${name}. Keep each line short, natural and in the same tone, for a general audience. Return exactly one translated line for every line given, in the same order. Never use em dashes. Answer only with JSON: {"cues":["",""]}.`,
          user: JSON.stringify(cues.map((c) => c.text)),
          maxTokens: 8000,
        },
        Cues,
        { lint: false },
      )
      if (out.cues.length !== cues.length)
        throw new Error(
          `The ${name} translation came back with ${out.cues.length} lines instead of ${cues.length}. Try again.`,
        )
      save(lang, toSrt(cues.map((c, i) => ({ ...c, text: out.cues[i].trim() }))))
    }
    return this.captions(episodeId)
  }

  /** Writes every caption file into the brand's captions folder and returns it. */
  exportFiles(episodeId: string): string {
    const ep = this.d.episodes.find(episodeId)
    if (!ep) throw new Error('That episode was not found.')
    const dir = join(this.d.root(), slug(this.d.brandName(ep.brandId)), 'captions')
    mkdirSync(dir, { recursive: true })
    const rows = this.d.db
      .prepare('SELECT lang, srt FROM episode_captions WHERE episode_id = ?')
      .all(episodeId) as Array<{ lang: string; srt: string }>
    if (!rows.length) throw new Error('Make the captions first.')
    for (const r of rows) writeFileSync(join(dir, `${episodeId}.${r.lang}.srt`), r.srt)
    return dir
  }
}
