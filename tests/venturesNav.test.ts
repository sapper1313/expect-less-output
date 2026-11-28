import { describe, expect, it } from 'vitest'
import { needsDrawer } from '../src/renderer/src/ventures/nav'

describe('needsDrawer', () => {
  it('switches to the drawer below 900px', () => {
    expect(needsDrawer(375)).toBe(true)
    expect(needsDrawer(899)).toBe(true)
    expect(needsDrawer(900)).toBe(false)
    expect(needsDrawer(1400)).toBe(false)
  })
})
