import { describe, expect, it } from 'vitest'
import { DEFAULT_STUDIO_CONFIG, capError, chooseModel, defaultBrandConfig } from '../../src/shared/studio/config'
import {
  changeEveryN,
  dueDates,
  nextDue,
  nextDueEveryN,
  productionDays,
  projectMonthlyCost,
  windowOpensOn,
} from '../../src/shared/studio/cadence'
import { estimateClips } from '../../src/shared/studio/pricing'
import { lintText, lintValue, stripDashes } from '../../src/shared/studio/lint'

const DASH = String.fromCharCode(0x2014)

describe('caps input', () => {
  it('accepts 0 to 9999 and rejects the rest', () => {
    expect(capError(0)).toBeNull()
    expect(capError('12.5')).toBeNull()
    expect(capError(9999)).toBeNull()
    expect(capError(9999.01)).toMatch(/above 9999/)
    expect(capError(-1)).toMatch(/below 0/)
    expect(capError('abc')).toMatch(/number/)
    expect(capError(NaN)).toMatch(/number/)
  })
})

describe('format model checkboxes', () => {
  it('defaults shorts to Lite and long to 1.5, and one is always checked', () => {
    expect(DEFAULT_STUDIO_CONFIG.formatModel).toEqual({ short: 'lite', long: 'standard' })
    let m = chooseModel(DEFAULT_STUDIO_CONFIG.formatModel, 'short', 'standard', true)
    expect(m.short).toBe('standard')
    m = chooseModel(m, 'short', 'standard', false) // the last one cannot be unchecked
    expect(m.short).toBe('standard')
    m = chooseModel(m, 'short', 'lite', true)
    expect(m.short).toBe('lite')
    expect(m.long).toBe('standard')
  })
})

describe('cadence', () => {
  it('every 3 days computes next due from the anchor', () => {
    expect(nextDueEveryN('2026-06-01', 3, '2026-06-01')).toBe('2026-06-01')
    expect(nextDueEveryN('2026-06-01', 3, '2026-06-02')).toBe('2026-06-04')
    expect(nextDueEveryN('2026-06-01', 3, '2026-06-04')).toBe('2026-06-04')
    expect(nextDueEveryN('2026-06-01', 3, '2026-06-10')).toBe('2026-06-10')
    expect(nextDueEveryN('2026-06-10', 3, '2026-06-01')).toBe('2026-06-10')
  })

  it('changing N never moves past dates, and applies from the next due date', () => {
    const cfg = { ...defaultBrandConfig('short', '2026-06-01'), everyN: 3 }
    const before = dueDates(cfg, '2026-06-01', '2026-06-10') // 1, 4, 7, 10
    expect(before).toEqual(['2026-06-01', '2026-06-04', '2026-06-07', '2026-06-10'])
    const changed = changeEveryN(cfg, 4, '2026-06-05') // next due is 06-07
    expect(changed.startDate).toBe('2026-06-07')
    expect(dueDates(changed, '2026-06-07', '2026-06-20')).toEqual(['2026-06-07', '2026-06-11', '2026-06-15', '2026-06-19'])
    expect(() => changeEveryN(cfg, 0, '2026-06-05')).toThrow()
  })

  it('Wonder Hollow weekly mode posts Wednesday and Friday with two production windows', () => {
    const cfg = defaultBrandConfig('long', '2026-06-01')
    expect(cfg.cadenceMode).toBe('weekly')
    expect(cfg.postDays).toEqual([3, 5])
    expect(dueDates(cfg, '2026-06-01', '2026-06-14')).toEqual(['2026-06-03', '2026-06-05', '2026-06-10', '2026-06-12'])
    // Wednesday 06-03: Sunday 05-31 and Monday 06-01
    expect(productionDays(cfg, '2026-06-03')).toEqual(['2026-05-31', '2026-06-01'])
    // Friday 06-05: Wednesday 06-03 and Thursday 06-04
    expect(productionDays(cfg, '2026-06-05')).toEqual(['2026-06-03', '2026-06-04'])
    expect(windowOpensOn(cfg, '2026-06-05')).toBe('2026-06-03')
    expect(nextDue(cfg, '2026-06-04')).toBe('2026-06-05')
  })

  it('projects monthly cost', () => {
    const cfg = { ...defaultBrandConfig('short', '2026-06-01'), everyN: 3 }
    expect(projectMonthlyCost(cfg, 1)).toBeCloseTo(10.15, 1)
    expect(projectMonthlyCost({ ...cfg, everyN: 5 }, 1)).toBeCloseTo(6.09, 1)
  })
})

describe('pricing', () => {
  it('estimates first pass and worst case with the retake multiplier', () => {
    const e = estimateClips(DEFAULT_STUDIO_CONFIG, 'lite', '480p', [{ generateSeconds: 15 }])
    expect(e.firstPass).toBeCloseTo(0.3, 5)
    expect(e.worstCase).toBeCloseTo(0.75, 5)
    const long = estimateClips(DEFAULT_STUDIO_CONFIG, 'standard', '720p', Array.from({ length: 18 }, () => ({ generateSeconds: 15 })))
    expect(long.firstPass).toBeCloseTo(37.8, 3)
  })
})

describe('writing lint', () => {
  it('rejects em dashes and robotic phrases anywhere in a value', () => {
    const phrases = DEFAULT_STUDIO_CONFIG.roboticPhrases
    expect(lintText('Fine and clean.', phrases)).toEqual([])
    expect(lintText(`This ${DASH} is bad`, phrases)[0].kind).toBe('em_dash')
    expect(lintText("Let's DELVE in", phrases)[0].kind).toBe('robotic_phrase')
    const issues = lintValue({ title: 'ok', scenes: [{ line: `no ${DASH} way` }] }, phrases)
    expect(issues[0].path).toBe('$.scenes[0].line')
    expect(stripDashes(`a ${DASH} b`)).toBe('a, b')
  })
})
