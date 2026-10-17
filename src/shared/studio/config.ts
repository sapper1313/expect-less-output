import type {
  BrandFormat,
  Cap,
  ModelTier,
  Resolution,
  StudioBrandConfig,
  StudioConfig,
  StudioPlatform,
} from './types'

export const CAP_MAX = 9999

const noCap = (): Cap => ({ value: 0, none: true })

/** Prices and model names come from the xAI docs read on 2026-10-09 and the owner's notes. Edit in Settings. */
export const DEFAULT_STUDIO_CONFIG: StudioConfig = {
  mockMode: true,
  paused: false,
  globalCap: noCap(),
  aiTextCap: noCap(),
  perEpisodeCapDefault: noCap(),
  formatModel: { short: 'lite', long: 'standard' },
  formatResolution: { short: '480p', long: '720p' },
  modelIds: {
    lite: 'grok-imagine-video-1.5-lite',
    standard: 'grok-imagine-video-1.5',
    image: 'grok-imagine-image-2.0',
  },
  prices: {
    video: {
      lite: { '480p': 0.02, '720p': 0.03, '1080p': 0.14 },
      standard: { '480p': 0.08, '720p': 0.14, '1080p': 0.25 },
    },
    image: 0.04,
    referenceImage: 0.01,
    anthropicInPerM: 3,
    anthropicOutPerM: 15,
    anthropicModels: {
      'claude-haiku-5-5': { inPerM: 1, outPerM: 5 },
      'claude-sonnet-5-5': { inPerM: 3, outPerM: 15 },
      'claude-opus-5-5': { inPerM: 5, outPerM: 25 },
    },
  },
  retakeMultiplier: 2.5,
  retentionDays: 30,
  directorTickMinutes: 5,
  paidConcurrency: 2,
  retryCap: 3,
  backoffBaseSeconds: 60,
  roboticPhrases: [
    'delve',
    "in today's fast-paced world",
    'unlock',
    'game-changer',
    'dive into',
    'in the ever-evolving',
    'tapestry',
    'elevate your',
    "it's important to note",
    'harness the power',
  ],
  agentModels: {},
  captionLanguages: [],
  autoChapters: false,
  repostAfterDays: 30,
  defaultAgentModel: 'claude-sonnet-5-5',
  libraryDir: '~/ELO/Library',
  repetitionThreshold: 0.86,
  characterSimilarityThreshold: 0.6,
  qcMode: 'auto',
  disabledAgents: [],
  digestEnabled: true,
  watchdog: { enabled: true, runStart: '07:00', runEnd: '22:00', thresholdMinutes: 30 },
  platformCaps: {},
  publicHost: { endpoint: '', bucket: '', publicBase: '', region: 'auto' },
  thumbnailEngine: {
    generateImages: true,
    candidates: 3,
    abDelayHours: 48,
    abMinImpressions: 500,
    font: '',
  },
  qcClipRetryCap: 2,
  digestTime: '07:30',
  backupDir: '~/ELO/Backups',
  backupKeep: 14,
  local: {
    ollamaHost: 'http://localhost:11434',
    visionModel: 'moondream',
    embedModel: 'nomic-embed-text',
    textModel: '',
    whisperMode: 'mac',
    whisperHost: '',
    whisperCommand: 'whisper-cli -f {audio}',
    concurrency: 1,
    useClaudeVision: false,
    measured: {},
    ramGb: null,
    hasGpu: null,
  },
}

const allPlatforms = (on: StudioPlatform[]): Record<StudioPlatform, boolean> => ({
  youtube: on.includes('youtube'),
  facebook: on.includes('facebook'),
  instagram: on.includes('instagram'),
  tiktok: on.includes('tiktok'),
  bluesky: on.includes('bluesky'),
})

export function defaultBrandConfig(format: BrandFormat, startDate: string): StudioBrandConfig {
  const base: StudioBrandConfig = {
    format,
    resolution: format === 'short' ? '480p' : '720p',
    cadenceMode: 'every_n',
    everyN: 3,
    startDate,
    paused: false,
    postDays: [],
    windows: [],
    runTime: '09:00',
    // Bluesky defaults OFF. The owner turns them on.
    platforms: allPlatforms(['youtube', 'facebook', 'instagram', 'tiktok']),
    aiDisclosure: true,
    madeForKids: false,
    runwayDays: 7,
    monthlyCap: noCap(),
    perEpisodeCap: noCap(),
    addOpeningOutroOnIngest: true,
    useOpeningOutro: false,
    commentsMode: 'auto',
    holidayTieIns: true,
    hollowViaApi: false,
    path: 'auto',
    mathCheck: false,
    stepsCheck: false,
    captionMode: 'sidecar',
    openingFrame: format === 'short',
    commentLimit: 20,
  }
  if (format === 'long') {
    return {
      ...base,
      resolution: '720p',
      cadenceMode: 'weekly',
      // Wednesday and Friday posts. Sunday and Monday produce for Wednesday. Wednesday and Thursday for Friday.
      postDays: [3, 5],
      windows: [
        { days: [7, 1], forPostDay: 3 },
        { days: [3, 4], forPostDay: 5 },
      ],
      platforms: allPlatforms(['youtube']),
      madeForKids: true,
      addOpeningOutroOnIngest: false,
      useOpeningOutro: true,
      commentsMode: 'off',
      path: 'package',
      mathCheck: true,
    }
  }
  return base
}

/** Fills holes in a stored brand config with defaults, so older rows keep working when fields are added. */
export function normalizeBrandConfig(
  stored: Partial<StudioBrandConfig> | null,
  format: BrandFormat,
  startDate: string,
): StudioBrandConfig {
  const d = defaultBrandConfig(stored?.format ?? format, startDate)
  const s = stored ?? {}
  const platforms = { ...d.platforms, ...(s.platforms ?? {}) }
  // Long form is YouTube only, whatever an older row says.
  if (d.format === 'long')
    for (const k of Object.keys(platforms) as StudioPlatform[])
      if (k !== 'youtube') platforms[k] = false
  return {
    ...d,
    ...s,
    platforms,
    monthlyCap: { ...d.monthlyCap, ...(s.monthlyCap ?? {}) },
    perEpisodeCap: { ...d.perEpisodeCap, ...(s.perEpisodeCap ?? {}) },
  }
}

/** A cap field accepts 0 to 9999, whole or decimal. Returns an error message or null. */
export function capError(value: unknown): string | null {
  if (typeof value === 'string') {
    if (!/^\d+(\.\d+)?$/.test(value.trim())) return 'Type a number from 0 to 9999.'
    value = Number(value)
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Type a number from 0 to 9999.'
  if (value < 0) return 'A cap cannot be below 0.'
  if (value > CAP_MAX) return `A cap cannot be above ${CAP_MAX}.`
  return null
}

export function checkedCap(c: Cap): Cap {
  const err = capError(c.value)
  if (err) throw new Error(err)
  return { value: Math.round(Number(c.value) * 100) / 100, none: !!c.none }
}

/** Exactly one model is checked per format. Checking one unchecks the other; the last one cannot be unchecked. */
export function chooseModel(
  current: Record<BrandFormat, ModelTier>,
  format: BrandFormat,
  tier: ModelTier,
  checked: boolean,
): Record<BrandFormat, ModelTier> {
  if (!checked && current[format] === tier) return current // the last one stays checked
  return { ...current, [format]: tier }
}

export const RESOLUTIONS: Resolution[] = ['480p', '720p', '1080p']

export function deepMerge<T>(base: T, over: unknown): T {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return (over ?? base) as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)?.[k]
    out[k] =
      b &&
      typeof b === 'object' &&
      !Array.isArray(b) &&
      v &&
      typeof v === 'object' &&
      !Array.isArray(v)
        ? deepMerge(b, v)
        : (v ?? b)
  }
  return out as T
}
