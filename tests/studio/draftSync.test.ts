import { describe, expect, it } from 'vitest'
import { nextDraft, type DraftMemory } from '../../src/shared/draftSync'

const A = { premise: 'a' }
const B = { premise: 'b' }

describe('draft sync', () => {
  it('keeps unsaved typing when the same record reloads', () => {
    const prev = { id: 1, json: JSON.stringify(A) }
    expect(nextDraft(prev, 1, { premise: 'a' }, { premise: 'typing' }).draft).toEqual({ premise: 'typing' })
  })
  it('takes new saved data when nothing was typed', () => {
    const prev = { id: 1, json: JSON.stringify(A) }
    expect(nextDraft(prev, 1, B, A).draft).toEqual(B)
  })
  it('shows the other record when you switch, even with unsaved typing', () => {
    const prev = { id: 1, json: JSON.stringify(A) }
    expect(nextDraft(prev, 2, B, { premise: 'typing' }).draft).toEqual(B)
  })
  it('recovers after the new record arrives behind the old one', () => {
    // Step 1: switched to 2 but data for 1 is still showing. Step 2: data for 2 arrives.
    let mem: DraftMemory = { id: 1, json: JSON.stringify(A) }
    const s1 = nextDraft(mem, 2, A, A)
    mem = s1.memory
    expect(nextDraft(mem, 2, B, s1.draft).draft).toEqual(B)
  })
})
