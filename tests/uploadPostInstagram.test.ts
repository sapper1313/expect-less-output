import { describe, expect, it } from 'vitest'
import { UploadPostInstagramAdapter } from '../src/main/adapters/uploadPostInstagram'
import type { AdapterContext } from '../src/main/adapters/types'

function setup(statuses: any[] = []) {
  const uploads: any[] = []
  const queue = [...statuses]
  const adapter = new UploadPostInstagramAdapter({
    client: {
      async uploadInstagram(_k: string, i: any) {
        uploads.push(i)
      },
      async status() {
        return queue.shift() ?? { status: 'in_progress', results: [] }
      },
    } as any,
    apiKey: () => 'key',
    profileFor: () => 'My_Profile',
    host: { log: () => {} },
  })
  let state: Record<string, unknown> = {}
  const ctx = {
    targetId: 7,
    postId: 3,
    brandId: 1,
    brandName: 'Channel',
    title: 'A title',
    caption: 'A caption #tag',
    aiFlag: false,
    settings: {},
    videoAbsPath: '/tmp/x.mp4',
    nowMs: () => 1_000_000,
    getState: () => state,
    setState: (p: Record<string, unknown>) => {
      state = { ...state, ...p }
    },
  } as unknown as AdapterContext
  return { adapter, ctx, uploads }
}

describe('Instagram through Upload-Post', () => {
  it('sends the caption as a Reel, waits, then reports the post with its link', async () => {
    const { adapter, ctx, uploads } = setup([
      { status: 'in_progress', results: [] },
      {
        status: 'completed',
        results: [{ platform: 'instagram', success: true, postId: '178', postUrl: 'https://instagram.com/reel/abc' }],
      },
    ])
    const first = await adapter.publish(ctx)
    expect(first.status).toBe('processing')
    expect(uploads[0]).toMatchObject({ user: 'My_Profile', caption: 'A caption #tag' })
    expect((await adapter.checkStatus(ctx)).status).toBe('processing')
    const done = await adapter.checkStatus(ctx)
    expect(done).toMatchObject({ status: 'posted', externalId: '178', externalUrl: 'https://instagram.com/reel/abc' })
  })

  it('does not send the same upload twice', async () => {
    const { adapter, ctx, uploads } = setup()
    await adapter.publish(ctx)
    await adapter.publish(ctx)
    expect(uploads).toHaveLength(1)
  })

  it('says plainly when Instagram needs signing in again on Upload-Post, and stops', async () => {
    const { adapter, ctx } = setup([
      { status: 'completed', results: [{ platform: 'instagram', success: false, message: 'reauth required' }] },
    ])
    await adapter.publish(ctx)
    await expect(adapter.checkStatus(ctx)).rejects.toMatchObject({
      kind: 'permanent',
      message: expect.stringContaining('Instagram'),
    })
  })
})
