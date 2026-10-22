import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { buildSidecarSchema } from '../src/shared/pipeline'
import { buildUpcomingSchema } from '../src/shared/upcoming'

const doc = (n: string) => JSON.parse(readFileSync(join(__dirname, '..', 'docs', n), 'utf8'))

describe('generated JSON Schemas', () => {
  it('docs/sidecar.schema.json matches the schema in the code (run npm run schemas when it does not)', () => {
    expect(doc('sidecar.schema.json')).toEqual(JSON.parse(JSON.stringify(buildSidecarSchema())))
  })
  it('docs/upcoming.schema.json matches the schema in the code (run npm run schemas when it does not)', () => {
    expect(doc('upcoming.schema.json')).toEqual(JSON.parse(JSON.stringify(buildUpcomingSchema())))
  })
  it('the sidecar schema lists the required fields from the spec', () => {
    const s = doc('sidecar.schema.json')
    expect(s.required).toEqual(
      expect.arrayContaining([
        'schema_version',
        'channel',
        'episode_id',
        'title',
        'description',
        'approval',
        'checksum',
        'source_bot',
        'video_file',
      ]),
    )
    expect(s.required).not.toContain('preferred_slot')
    // platforms is needed for an episode and optional for a clip, so the code checks it
    expect(s.required).not.toContain('platforms')
  })
})
