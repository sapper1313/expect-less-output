import { describe, expect, it } from 'vitest'
import { describeNetworkError, networkCode, withNetworkRetry } from '../src/main/network'
import { isNetworkError } from '../src/main/google/errors'

const timeout = () =>
  Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })

describe('network errors', () => {
  it('keeps the real reason behind "fetch failed"', () => {
    expect(networkCode(timeout())).toBe('UND_ERR_CONNECT_TIMEOUT')
    const text = describeNetworkError(timeout())
    expect(text).toContain('fetch failed')
    expect(text).toContain('UND_ERR_CONNECT_TIMEOUT')
    expect(text).toContain('timed out')
    expect(describeNetworkError(new Error('boom'))).toBe('boom')
  })

  it('tries a safe call again after a network failure and then succeeds', async () => {
    let n = 0
    const r = await withNetworkRetry(
      async () => {
        n++
        if (n < 3) throw timeout()
        return 'ok'
      },
      isNetworkError,
      3,
      1,
    )
    expect(r).toBe('ok')
    expect(n).toBe(3)
  })

  it('gives up after the last try and never retries a real error', async () => {
    let n = 0
    await expect(
      withNetworkRetry(
        async () => {
          n++
          throw timeout()
        },
        isNetworkError,
        2,
        1,
      ),
    ).rejects.toThrow('fetch failed')
    expect(n).toBe(2)
    let m = 0
    await expect(
      withNetworkRetry(
        async () => {
          m++
          throw new Error('invalid_grant')
        },
        isNetworkError,
        3,
        1,
      ),
    ).rejects.toThrow('invalid_grant')
    expect(m).toBe(1)
  })
})

import { onlyIpv4IfAny } from '../src/main/network'

describe('IPv4 preference', () => {
  const v4 = { address: '1.2.3.4', family: 4 }
  const v6 = { address: '2001:db8::1', family: 6 }
  it('drops IPv6 addresses only when an IPv4 address exists', () => {
    expect(onlyIpv4IfAny([v6, v4])).toEqual([v4])
    expect(onlyIpv4IfAny([v4])).toEqual([v4])
    expect(onlyIpv4IfAny([v6])).toEqual([v6]) // an IPv6 only name still works
    expect(onlyIpv4IfAny([])).toEqual([])
  })
})
