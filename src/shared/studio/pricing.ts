import type { ModelTier, Resolution, StudioBrandConfig, StudioConfig } from './types'

export function videoPricePerSecond(cfg: StudioConfig, tier: ModelTier, res: Resolution): number {
  return cfg.prices.video[tier][res]
}

export interface ClipPlan {
  /** Seconds the model is asked to generate (billed in full, even if trimmed later). */
  generateSeconds: number
  referenceImages?: number
}

export interface Estimate {
  firstPass: number
  worstCase: number
  generatedSeconds: number
}

/** Pre run estimate: first pass, and worst case using the retake multiplier on generated seconds. */
export function estimateClips(
  cfg: StudioConfig,
  tier: ModelTier,
  res: Resolution,
  clips: ClipPlan[],
): Estimate {
  const price = videoPricePerSecond(cfg, tier, res)
  const seconds = clips.reduce((n, c) => n + c.generateSeconds, 0)
  const refs = clips.reduce((n, c) => n + (c.referenceImages ?? 0), 0)
  const firstPass = seconds * price + refs * cfg.prices.referenceImage
  const worstCase = seconds * price * cfg.retakeMultiplier + refs * cfg.prices.referenceImage
  return {
    firstPass: round(firstPass),
    worstCase: round(worstCase),
    generatedSeconds: seconds,
  }
}

/** A typical episode for a brand, used by the cadence what-if. Shorts: one 15 second clip. Long: 18 scenes of 15 seconds. */
export function typicalEpisodeEstimate(cfg: StudioConfig, brand: StudioBrandConfig): Estimate {
  const tier = cfg.formatModel[brand.format]
  const clips: ClipPlan[] =
    brand.format === 'short'
      ? [{ generateSeconds: 15 }]
      : Array.from({ length: 18 }, () => ({ generateSeconds: 15 }))
  return estimateClips(cfg, tier, brand.resolution, clips)
}

export function anthropicDollars(cfg: StudioConfig, inputTokens: number, outputTokens: number): number {
  return round(
    (inputTokens * cfg.prices.anthropicInPerM + outputTokens * cfg.prices.anthropicOutPerM) / 1_000_000,
  )
}

export function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000
}
