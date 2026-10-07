import { useEffect, useState } from 'react'
import type { TikTokCreatorInfo, TikTokPostSettings } from '@shared/types'
import {
  BRANDED_CONTENT_URL,
  MUSIC_USAGE_URL,
  TIKTOK_PRIVACY_LABELS,
  commercialNotice,
  consentKind,
  tiktokSettingsProblem,
} from '@shared/tiktok'
import { api } from '../api'
import { Check, Select } from '../ui'

/** The creator for one brand, straight from TikTok (creator_info). */
export function useCreator(
  brandId: number | null,
  enabled: boolean,
): { info: TikTokCreatorInfo | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{
    info: TikTokCreatorInfo | null
    error: string | null
    loading: boolean
  }>({ info: null, error: null, loading: false })
  useEffect(() => {
    if (!enabled || !brandId) {
      setState({ info: null, error: null, loading: false })
      return
    }
    let alive = true
    setState((s) => ({ ...s, loading: true, error: null }))
    api.tiktok
      .creatorInfo(brandId)
      .then((info) => alive && setState({ info, error: null, loading: false }))
      .catch(
        (e) =>
          alive &&
          setState({
            info: null,
            error: String(e?.message ?? e).replace(
              /^Error invoking remote method '[^']+': (Error: )?/,
              '',
            ),
            loading: false,
          }),
      )
    return () => {
      alive = false
    }
  }, [brandId, enabled])
  return state
}

/** Who will post. TikTok's guidelines require the nickname to be visible on the posting screen. */
export function PostingAs({
  info,
  prominent,
}: {
  info: TikTokCreatorInfo | null
  prominent?: boolean
}) {
  if (!info) return null
  return (
    <div
      className={`flex items-center gap-2 ${prominent ? 'text-[15px] font-semibold' : 'text-[12px] text-muted'}`}
    >
      {info.avatarUrl && (
        <img
          src={info.avatarUrl}
          alt=""
          className={prominent ? 'h-8 w-8 rounded-full' : 'h-5 w-5 rounded-full'}
        />
      )}
      <span>Post to TikTok as {info.nickname || info.username}</span>
    </div>
  )
}

/**
 * The TikTok Direct Post section. Follows TikTok's Content Sharing Guidelines: the nickname is shown,
 * privacy comes only from creator_info with no default, interactions start unchecked, and the
 * commercial content and consent lines are shown exactly as required.
 */
export function TikTokSection({
  info,
  loading,
  error,
  value,
  onChange,
  durationSeconds,
  aiFlag,
  prominent,
}: {
  info: TikTokCreatorInfo | null
  loading?: boolean
  error?: string | null
  value: TikTokPostSettings
  onChange: (v: TikTokPostSettings) => void
  durationSeconds: number
  aiFlag: boolean
  prominent?: boolean
}) {
  const set = (patch: Partial<TikTokPostSettings>) => onChange({ ...value, ...patch })
  const problem = tiktokSettingsProblem(value, info, durationSeconds)
  const notice = commercialNotice(value)
  const kind = consentKind(value)
  const brandedPrivate = value.commercialOn && value.brandedContent

  if (loading && !info)
    return <div className="text-[13px] text-muted">Asking TikTok about this account...</div>
  if (error && !info)
    return (
      <div className="rounded-md border border-bad p-3 text-[13px] text-bad">
        Could not reach TikTok: {error}
      </div>
    )
  if (!info) return null

  return (
    <div className="space-y-4" data-testid="tiktok-section">
      <PostingAs info={info} prominent={prominent} />

      <label className="block">
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">
          Who can view this video
        </span>
        <Select
          value={value.privacy ?? ''}
          onChange={(e) => set({ privacy: e.target.value || null })}
          aria-label="Who can view this video"
        >
          <option value="" disabled>
            Choose who can see this
          </option>
          {info.privacyOptions.map((o) => (
            <option
              key={o}
              value={o}
              disabled={brandedPrivate && o === 'SELF_ONLY'}
              title={
                brandedPrivate && o === 'SELF_ONLY'
                  ? 'Branded content visibility cannot be set to private.'
                  : undefined
              }
            >
              {TIKTOK_PRIVACY_LABELS[o] ?? o}
            </option>
          ))}
        </Select>
      </label>

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
          Allow other people to
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Check
            checked={value.allowComment}
            disabled={info.commentDisabled}
            onChange={(v) => set({ allowComment: v })}
          >
            Comment{info.commentDisabled && ' (off in TikTok)'}
          </Check>
          <Check
            checked={value.allowDuet}
            disabled={info.duetDisabled}
            onChange={(v) => set({ allowDuet: v })}
          >
            Duet{info.duetDisabled && ' (off in TikTok)'}
          </Check>
          <Check
            checked={value.allowStitch}
            disabled={info.stitchDisabled}
            onChange={(v) => set({ allowStitch: v })}
          >
            Stitch{info.stitchDisabled && ' (off in TikTok)'}
          </Check>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-line p-3">
        <Check
          checked={value.commercialOn}
          onChange={(v) =>
            set({
              commercialOn: v,
              yourBrand: v ? value.yourBrand : false,
              brandedContent: v ? value.brandedContent : false,
            })
          }
        >
          <b>Disclose commercial content</b>
        </Check>
        {value.commercialOn && (
          <div className="ml-6 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Check checked={value.yourBrand} onChange={(v) => set({ yourBrand: v })}>
              Your brand
            </Check>
            <Check
              checked={value.brandedContent}
              onChange={(v) =>
                set({
                  brandedContent: v,
                  privacy: v && value.privacy === 'SELF_ONLY' ? null : value.privacy,
                })
              }
            >
              Branded content
            </Check>
            {!value.yourBrand && !value.brandedContent && (
              <div className="basis-full text-[12px] text-warn">
                You need to indicate if your content promotes yourself, a third party, or both.
              </div>
            )}
            {notice && <div className="basis-full text-[12px] text-muted">{notice}</div>}
          </div>
        )}
      </div>

      {aiFlag && (
        <div className="text-[12px] text-muted">
          This post is marked as AI-generated, so TikTok will add its AI label.
        </div>
      )}

      <div className="space-y-2">
        <Check checked={value.consent} onChange={(v) => set({ consent: v })}>
          <span className="text-[12px]">
            By posting, you agree to TikTok's{' '}
            {kind === 'branded' && (
              <>
                <a
                  href={BRANDED_CONTENT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-accent underline"
                >
                  Branded Content Policy
                </a>{' '}
                and{' '}
              </>
            )}
            <a
              href={MUSIC_USAGE_URL}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-accent underline"
            >
              Music Usage Confirmation
            </a>
          </span>
        </Check>
        <div className="text-[11px] text-muted">
          TikTok can take a few minutes to process the video before it shows on the profile.
        </div>
      </div>

      {problem && <div className="text-[12px] font-semibold text-warn">{problem}</div>}
    </div>
  )
}
