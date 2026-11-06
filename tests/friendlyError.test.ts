import { describe, expect, it } from 'vitest'
import { friendlyError } from '../src/shared/friendlyError'

describe('friendlyError', () => {
  it('cleans the Instagram closed container error', () => {
    const t = friendlyError(
      "Step: uploading the video to Instagram. Meta rejected the request (code 400). {\"success\":false,\"error\":{\"message\":\"The ig container is not in the status to upload a video\"}} (ProcessingFailedError)",
    )
    expect(t).toContain('While uploading the video to Instagram')
    expect(t).toContain('closed the earlier upload')
    expect(t).not.toContain('{')
    expect(t).not.toContain('ProcessingFailedError')
  })
  it('explains the plain processing failure', () => {
    expect(friendlyError('Meta rejected the request (code 400). Request processing failed (ProcessingFailedError)')).toContain(
      'could not process this video',
    )
  })
  it('strips the IPC prefix and error names', () => {
    expect(friendlyError("Error invoking remote method 'x': Error: No brand with id 5")).toBe('No brand with id 5.')
  })
  it('points old screen names at the new place', () => {
    expect(friendlyError('Reconnect Meta on the Connections screen.')).toContain('Setup Channels')
  })
  it('handles network failures and empty input', () => {
    expect(friendlyError('fetch failed')).toContain('internet')
    expect(friendlyError('')).toBe('Something went wrong. Try again.')
  })
  it('never uses an em dash', () => {
    expect(friendlyError('a — b')).not.toContain('—')
  })
})
