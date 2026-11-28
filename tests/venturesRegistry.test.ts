import { describe, expect, it } from 'vitest'
import { VentureRegistry } from '../src/main/ventures/registry'
import type { VentureProvider } from '../src/shared/ventures'

const fake = (id: string, label: string) => ({ id, label }) as unknown as VentureProvider

describe('VentureRegistry', () => {
  it('lists providers in registration order and finds them by id', () => {
    const r = new VentureRegistry()
    r.register(fake('etsy', 'Etsy'))
    r.register(fake('kdp', 'Amazon KDP'))
    expect(r.list()).toEqual([
      { id: 'etsy', label: 'Etsy' },
      { id: 'kdp', label: 'Amazon KDP' },
    ])
    expect(r.get('kdp')?.label).toBe('Amazon KDP')
    expect(r.get('nope')).toBeUndefined()
  })
  it('refuses a duplicate id', () => {
    const r = new VentureRegistry()
    r.register(fake('etsy', 'Etsy'))
    expect(() => r.register(fake('etsy', 'Etsy 2'))).toThrow(/already registered/)
  })
})
