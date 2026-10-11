import { writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { makeStudioEnv } from './helpers'

type Env = ReturnType<typeof makeStudioEnv>
const brandId = (e: Env, like: string) =>
  (e.db.prepare('SELECT id FROM brands WHERE name LIKE ?').get(like) as { id: number }).id

const png = (e: Env, name: string) => {
  const p = join(e.dir, name)
  writeFileSync(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]))
  return p
}

async function twoCharacters() {
  const e = makeStudioEnv()
  const b = brandId(e, 'Clock Out Early%')
  await e.studio.setBible(b, {
    characters: [
      { id: '', name: 'Sarah', look: 'tidy', personality: '', voice: '', catchphrases: [] },
      { id: '', name: 'Bot', look: 'boxy', personality: '', voice: '', catchphrases: [] },
    ],
  })
  const { bible } = await e.studio.bible(b)
  return { e, b, sarah: bible.characters[0].id, bot: bible.characters[1].id }
}

describe('character reference images', () => {
  it('gives every character a permanent id that survives a rename', async () => {
    const { e, b, sarah } = await twoCharacters()
    expect(sarah).toMatch(/\S{8,}/)
    const { bible } = await e.studio.bible(b)
    await e.studio.setBible(b, {
      characters: bible.characters.map((c) => (c.id === sarah ? { ...c, name: 'Sarah 2.0' } : c)),
    })
    const again = (await e.studio.bible(b)).bible.characters
    expect(again[0].name).toBe('Sarah 2.0')
    expect(again[0].id).toBe(sarah)
  })

  it('stores images per character, with a label, and refuses an unknown character', async () => {
    const { e, b, sarah } = await twoCharacters()
    const list = await e.studio.addAsset(b, 'reference_image', png(e, 'front.png'), {
      characterId: sarah,
      label: 'front',
    })
    expect(list[0]).toMatchObject({ characterId: sarah, label: 'front', active: true })
    expect(list[0].url).toBe(`elo-media://asset/${list[0].id}`)
    await expect(
      e.studio.addAsset(b, 'reference_image', png(e, 'x.png'), { characterId: 'nope' }),
    ).rejects.toThrow(/Save the bible/)
    const out = await e.studio.updateAsset(b, list[0].id, { label: 'front, smiling' })
    expect(out[0].label).toBe('front, smiling')
  })

  it('sends only pictures that are on, for characters that still exist, and shares the 14 fairly', async () => {
    const { e, b, sarah, bot } = await twoCharacters()
    for (let i = 0; i < 13; i++)
      await e.studio.addAsset(b, 'reference_image', png(e, `s${i}.png`), { characterId: sarah })
    await e.studio.addAsset(b, 'reference_image', png(e, 'b0.png'), { characterId: bot })
    await e.studio.addAsset(b, 'reference_image', png(e, 'b1.png'), { characterId: bot })
    await e.studio.addAsset(b, 'reference_image', png(e, 'wide.png')) // brand wide
    const refs = e.studio.assets.references(b)
    expect(refs).toHaveLength(14)
    expect(refs.filter((r) => r.characterId === bot)).toHaveLength(2) // not crowded out by Sarah
    expect(refs.filter((r) => r.characterId === sarah)).toHaveLength(12) // characters take turns, Sarah gets the rest
    expect(refs.some((r) => r.characterId === null)).toBe(false) // character pictures come first

    // retire every Sarah picture: they are kept but not sent
    for (const a of e.studio.assets.list(b).filter((x) => x.characterId === sarah))
      await e.studio.updateAsset(b, a.id, { active: false })
    expect(e.studio.assets.references(b).every((r) => r.characterId !== sarah)).toBe(true)
    expect(e.studio.assets.list(b).filter((x) => x.characterId === sarah)).toHaveLength(13)

    // remove the Bot character from the bible: its pictures stop being sent
    const { bible } = await e.studio.bible(b)
    await e.studio.setBible(b, { characters: bible.characters.filter((c) => c.id !== bot) })
    expect(e.studio.assets.references(b).every((r) => r.characterId === null)).toBe(true)
  })

  it('limits the character check to three pictures', async () => {
    const { e, b, sarah } = await twoCharacters()
    for (let i = 0; i < 5; i++)
      await e.studio.addAsset(b, 'reference_image', png(e, `q${i}.png`), { characterId: sarah })
    expect(e.studio.assets.references(b, 3)).toHaveLength(3)
  })
})
