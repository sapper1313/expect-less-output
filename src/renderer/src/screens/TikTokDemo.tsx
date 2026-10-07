import { useState } from 'react'
import { COPY } from '@shared/copy'
import {
  TIKTOK_PRIVACY_LABELS,
  commercialNotice,
  emptyTikTokSettings,
  tiktokSettingsProblem,
} from '@shared/tiktok'
import type { TikTokCreatorInfo, TikTokPostSettings } from '@shared/types'
import { api } from '../api'
import { useLoad } from '../hooks'
import { PostingAs, TikTokSection, useCreator } from '../components/TikTokSection'
import { Button, Card, Field, Input, PageHeader, Select, Textarea } from '../ui'

/** Used when no TikTok account is connected, clearly labeled as sample data on screen. */
const SAMPLE_CREATOR: TikTokCreatorInfo = {
  nickname: 'Sample Creator',
  username: 'sample_creator',
  avatarUrl: null,
  privacyOptions: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'],
  commentDisabled: false,
  duetDisabled: false,
  stitchDisabled: true,
  maxDurationSec: 300,
}

const STEPS = ['Connect', 'Write the post', 'Choose settings', 'Review and send']

/**
 * A guided walk through the TikTok flow for recording the screen video TikTok asks for.
 * It shows the real posting screen but NEVER sends anything to TikTok.
 */
export function TikTokDemo({ onExit }: { onExit: () => void }) {
  const { data: brands } = useLoad(() => api.brands.list())
  const { data: accounts } = useLoad(() => api.accounts.list())
  const [brandId, setBrandId] = useState<number | null>(null)
  const [step, setStep] = useState(0)
  const [title, setTitle] = useState('My TikTok video')
  const [caption, setCaption] = useState('A short caption for the demo #expectlessoutput')
  const [ai, setAi] = useState(false)
  const [tt, setTt] = useState<TikTokPostSettings>(emptyTikTokSettings())
  const [sent, setSent] = useState<'idle' | 'sending' | 'done'>('idle')

  const accountsFor = (id: number) =>
    accounts?.find((a) => a.brandId === id && a.platform === 'tiktok')
  const liveBrands = (brands ?? []).filter((b) => {
    const a = accountsFor(b.id)
    return a && a.mode !== 'dry_run' && a.status === 'connected'
  })
  const chosen = brandId ?? liveBrands[0]?.id ?? null
  const acct = chosen ? accountsFor(chosen) : undefined
  const live = !!acct && acct.mode !== 'dry_run' && acct.status === 'connected'
  const creator = useCreator(chosen, live)
  const info = live ? creator.info : SAMPLE_CREATOR
  const problem = tiktokSettingsProblem(tt, info, 20)
  const mode = live ? acct!.mode : 'direct'

  function send() {
    setSent('sending')
    setTimeout(() => setSent('done'), 2200)
  }

  return (
    <div className="h-full overflow-auto pb-10">
      <PageHeader title="TikTok demo">
        <Button onClick={onExit}>Leave demo</Button>
      </PageHeader>
      <div className="mx-auto max-w-3xl space-y-4 px-8">
        <div className="rounded-md border border-warn p-3 text-[13px] font-semibold text-warn">
          Demo mode. This shows the real TikTok screens for the review video. It never sends
          anything to TikTok.
          {!live && ' No TikTok account is connected, so a sample creator is shown.'}
        </div>

        <ol className="flex flex-wrap gap-2 text-[12px] font-semibold">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button
                onClick={() => setStep(i)}
                className={`rounded-full border px-3 py-1 ${i === step ? 'border-accent bg-accent text-[#111]' : 'border-line text-muted'}`}
              >
                {i + 1}. {s}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <Card title="1. Connect a TikTok account">
            <div className="space-y-3 text-[13px]">
              <p>
                Each brand connects its own TikTok account from the Connections screen. The login
                happens on TikTok's own page, and the app only receives the permissions you approve
                there.
              </p>
              {liveBrands.length > 0 ? (
                <Field label="Brand to show">
                  <Select value={chosen ?? ''} onChange={(e) => setBrandId(Number(e.target.value))}>
                    {liveBrands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <p className="text-muted">
                  No account is connected yet. Open Connections and press Connect TikTok to show the
                  real login, then come back.
                </p>
              )}
              <PostingAs info={info} prominent />
              <div className="text-muted">
                Account mode: {mode === 'direct' ? 'Direct post' : 'Drafts'}
              </div>
            </div>
          </Card>
        )}

        {step === 1 && (
          <Card title="2. Write the post">
            <div className="space-y-3">
              <div className="flex h-40 items-center justify-center rounded-md bg-surface2 text-muted">
                Video preview
              </div>
              <Field label="Title">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Caption">
                <Textarea rows={3} value={caption} onChange={(e) => setCaption(e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={ai}
                  onChange={(e) => setAi(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                This video is AI-generated
              </label>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card title="3. Choose privacy, interactions and disclosure">
            <TikTokSection
              info={info}
              loading={live && creator.loading}
              error={live ? creator.error : null}
              value={tt}
              onChange={setTt}
              durationSeconds={20}
              aiFlag={ai}
              prominent
            />
          </Card>
        )}

        {step === 3 && (
          <Card title="4. Review and send">
            <div className="space-y-3 text-[13px]">
              <PostingAs info={info} prominent />
              <div className="rounded-md border border-line p-3">
                <div className="font-semibold">{title}</div>
                <div className="text-muted">{caption}</div>
                <div className="mt-2">
                  Who can view:{' '}
                  {tt.privacy
                    ? (TIKTOK_PRIVACY_LABELS[tt.privacy] ?? tt.privacy)
                    : 'not chosen yet'}
                </div>
                <div>
                  Comments {tt.allowComment ? 'on' : 'off'}, Duet {tt.allowDuet ? 'on' : 'off'},
                  Stitch {tt.allowStitch ? 'on' : 'off'}
                </div>
                <div>{commercialNotice(tt) ?? 'No commercial content label'}</div>
                <div>{ai ? 'Marked as AI-generated' : 'Not marked as AI-generated'}</div>
              </div>
              {problem && <div className="font-semibold text-warn">{problem}</div>}
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="fine"
                  disabled={!!problem || sent === 'sending'}
                  onClick={send}
                  aria-label={`Post to TikTok as ${info?.nickname}`}
                  title={`Post to TikTok as ${info?.nickname}`}
                >
                  {COPY.publishButton}
                </Button>
              </div>
              <div className="text-right text-[12px] text-muted">
                Post to TikTok as {info?.nickname}
              </div>
              {sent === 'sending' && (
                <div className="text-muted">Uploading to TikTok (demo)...</div>
              )}
              {sent === 'done' && (
                <div className="rounded-md border border-ok p-3">
                  <div className="display text-2xl text-ok">{COPY.success}</div>
                  <div>
                    {mode === 'drafts'
                      ? 'In a real post the video would now be in the TikTok inbox, ready to finish in the app.'
                      : 'In a real post TikTok would now process the video. It can take a few minutes to show on the profile.'}
                  </div>
                  <div className="text-muted">Demo only: nothing was sent.</div>
                </div>
              )}
            </div>
          </Card>
        )}

        <div className="flex justify-between">
          <Button disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          <Button
            variant="primary"
            disabled={step === STEPS.length - 1}
            onClick={() => setStep(step + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
