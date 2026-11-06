import { useState } from 'react'
import type { ArchiveResult, GrowthRetract, Settings } from '@shared/types'
import { api } from '../api'
import { useApp, useLoad } from '../hooks'
import { Button, Card, Check, Confirm, Field, Input, TimeSelect, useBusy } from '../ui'
import { NumberSetting, Switch } from './PipelineSettings'

type Save = (patch: Partial<Settings>) => Promise<void>

const OUTCOME: Record<string, string> = {
  hidden: 'Hidden',
  manual: 'Do it by hand',
  skipped: 'Stopped before posting',
  failed: 'Failed',
}

/** Take an episode down. YouTube goes private. The other platforms cannot be hidden by apps, so they are listed. */
function RetractCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [id, setId] = useState('')
  const [ask, setAsk] = useState(false)
  const [out, setOut] = useState<GrowthRetract | null>(null)
  return (
    <Card title="Emergency take down">
      <p className="mb-3 text-[13px] text-muted">
        For a sponsor problem, a copyright flag or a mistake you only spot after posting. Type the
        episode id, for example clock-out-early-2026-0101. YouTube is set to private right away.
        Facebook, Instagram and TikTok do not let apps hide a video, so ELO lists them with their
        links and you remove them in each app. Anything not posted yet is stopped. Nothing is
        deleted.
      </p>
      <div className="flex items-end gap-2">
        <Field label="Episode id">
          <Input
            className="w-72"
            value={id}
            placeholder="clock-out-early-2026-0101"
            onChange={(e) => setId(e.target.value)}
          />
        </Field>
        <Button variant="danger" disabled={!id.trim() || busy} onClick={() => setAsk(true)}>
          Take it down
        </Button>
      </div>
      {out && (
        <ul className="mt-3 space-y-1 text-[13px]">
          {out.results.map((r, i) => (
            <li key={i}>
              <b>{r.platform}</b>: {OUTCOME[r.outcome] ?? r.outcome}. {r.detail}{' '}
              {r.url && (
                <a className="underline" href={r.url} target="_blank" rel="noreferrer">
                  {r.url}
                </a>
              )}
            </li>
          ))}
          {!out.results.length && <li>Nothing was live or waiting.</li>}
        </ul>
      )}
      {ask && (
        <Confirm
          title="Take this episode down?"
          message={`${id.trim()} will be set to private on YouTube and stopped everywhere it has not posted. You will get the links for the other platforms.`}
          confirmLabel="Take it down"
          danger
          onCancel={() => setAsk(false)}
          onConfirm={async () => {
            setAsk(false)
            const r = await run(() => api.growth.retract(id.trim()))
            if (r) {
              setOut(r)
              toast({
                kind: 'success',
                headline: 'Taken down as far as the apps allow.',
                detail: id.trim(),
              })
            }
          }}
        />
      )}
    </Card>
  )
}

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`)

/** Where the space goes, and an opt-in way to shrink old posted videos. */
function StorageCard() {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const { data, reload } = useLoad(() => api.growth.storageReport(), [])
  const [days, setDays] = useState('30')
  const [remove, setRemove] = useState(false)
  const [res, setRes] = useState<ArchiveResult | null>(null)
  return (
    <Card title="Disk space">
      {data && (
        <>
          <p className="mb-2 text-[13px] text-muted">
            Your videos use {mb(data.totalBytes)}.{' '}
            {data.freeBytes !== null && `${mb(data.freeBytes)} is free on this Mac.`}
          </p>
          <table className="mb-3 w-full text-[12px]">
            <thead>
              <tr className="text-left text-muted">
                <th>Channel</th>
                <th>Queue</th>
                <th>Posted</th>
                <th>Replaced</th>
                <th>Archive</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.channel}>
                  <td>{r.channel}</td>
                  <td>{mb(r.queue)}</td>
                  <td>{mb(r.posted)}</td>
                  <td>{mb(r.replaced)}</td>
                  <td>{mb(r.archive)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <p className="mb-2 text-[13px] text-muted">
        Shrink old posted videos: ELO makes a smaller H.265 copy in the channel's Archive folder and
        checks it has the same length. Up to 10 videos each time. Google Drive backup is not built
        in.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Older than (days)">
          <Input
            className="w-24"
            type="number"
            min={7}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        <Check checked={remove} onChange={setRemove}>
          Delete the big original after the small copy checks out
        </Check>
        <Button
          disabled={busy}
          onClick={async () => {
            const r = await run(() =>
              api.growth.archiveOld(Math.max(7, Number(days) || 30), remove),
            )
            if (r) {
              setRes(r)
              reload()
              toast({
                kind: 'success',
                headline: `${r.compressed} video(s) shrunk.`,
                detail: `Saved ${mb(r.savedBytes)} once originals are removed.`,
              })
            }
          }}
        >
          Shrink old videos
        </Button>
      </div>
      {!remove && (
        <div className="mt-1 text-[12px] text-muted">
          With the box unticked both copies stay, so nothing is saved yet.
        </div>
      )}
      {res?.skipped.length ? (
        <ul className="mt-2 list-disc pl-5 text-[12px] text-muted">
          {res.skipped.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
    </Card>
  )
}

function LessonsCard() {
  const { data, reload } = useLoad(() => api.growth.learnings(), [])
  return (
    <Card title="What viewers watched">
      <p className="mb-2 text-[13px] text-muted">
        48 hours after a YouTube video goes live, ELO finds where most viewers left and writes one
        lesson. The writer bot reads this before the next script (it is also saved as
        Shared/learnings.md in your Media Root).
      </p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-line p-3 text-[12px]">
        {data ?? 'Loading...'}
      </pre>
      <div className="mt-2">
        <Button onClick={reload}>Refresh</Button>
      </div>
    </Card>
  )
}

function BriefCard({ s, save }: { s: Settings; save: Save }) {
  const { toast } = useApp()
  const [busy, run] = useBusy()
  const [text, setText] = useState<string | null>(null)
  return (
    <Card title="Monday brief">
      <div className="space-y-3">
        <Switch
          checked={s.briefEnabled}
          onChange={(v) => save({ briefEnabled: v })}
          label="Send me the brief every Monday"
          hint="One message with the week's reach, the best video, how many episodes are at each step, and empty slots. It goes to iMessage, email and Telegram, and is saved in Shared/Briefs."
        />
        <Field label="Send it at (Eastern)">
          <TimeSelect
            value={s.briefTime}
            label="Brief time"
            onChange={(v) => save({ briefTime: v })}
          />
        </Field>
        <div className="flex gap-2">
          <Button
            disabled={busy}
            onClick={async () => setText((await run(() => api.growth.brief())) ?? null)}
          >
            Preview it
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              const f = await run(() => api.growth.sendBriefNow())
              if (f) toast({ kind: 'success', headline: 'Brief sent.', detail: f })
            }}
          >
            Send it now
          </Button>
        </div>
        {text && (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line p-3 text-[12px]">
            {text}
          </pre>
        )}
      </div>
    </Card>
  )
}

/** Per channel home: Setup Channels, Other settings by channel. */
export function StaggeredPostingCard({ s, save }: { s: Settings; save: Save }) {
  return (
    <Card title="Staggered posting">
      <div className="space-y-3">
        <Switch
          checked={s.staggerEnabled}
          onChange={(v) => save({ staggerEnabled: v })}
          label="Post to each platform a few minutes after the one before"
          hint="Instead of every platform going live in the same second, YouTube posts on the slot and Instagram, Facebook and TikTok follow a few minutes apart. It only applies to posts made from now on, and the slot time you set does not change."
        />
        <div className="flex gap-4">
          <NumberSetting
            label="Shortest wait (minutes)"
            value={s.staggerGapMin}
            min={0}
            max={60}
            onSave={(v) => save({ staggerGapMin: v })}
          />
          <NumberSetting
            label="Longest wait (minutes)"
            value={s.staggerGapMax}
            min={0}
            max={60}
            onSave={(v) => save({ staggerGapMax: v })}
          />
        </div>
      </div>
    </Card>
  )
}

export function GrowthSettings({ s, save }: { s: Settings; save: Save }) {
  return (
    <>
      <Card title="Captions and search">
        <div className="space-y-3">
          <Switch
            checked={s.captionMorphEnabled}
            onChange={(v) => save({ captionMorphEnabled: v })}
            label="Give each platform its own version of the description"
            hint="Facebook gets no hashtags. Instagram gets one sentence per line and up to 10 hashtags. TikTok gets two short sentences and 5 hashtags. YouTube keeps the full description. A bot's own version for a platform is never replaced."
          />
          <Switch
            checked={s.seoTagsEnabled}
            onChange={(v) => save({ seoTagsEnabled: v })}
            label="Add search phrases to the YouTube tags"
            hint="ELO asks YouTube's search suggestions what people type for the title, and adds those phrases to the tags. Only the first words of the title are sent. Off means no lookup is made."
          />
        </div>
      </Card>

      <Card title="Checks on new drops">
        <div className="space-y-3">
          <Switch
            checked={s.topicGuardEnabled}
            onChange={(v) => save({ topicGuardEnabled: v })}
            label="Warn when the same topic comes up back to back"
            hint="Drops can carry a topic tag. Two scheduled posts in a row on one channel with the same topic show up in Issues."
          />
          <Switch
            checked={s.loudnessCheckEnabled}
            onChange={(v) => save({ loudnessCheckEnabled: v })}
            label="Check how loud each video is"
            hint="Every dropped video is measured. If it is far from -14 LUFS or the peaks may clip, the drop log says so. ELO does not mix music under speech: that has to happen where the video is made."
          />
        </div>
      </Card>

      <Card title="After a video is live">
        <div className="space-y-3">
          <Switch
            checked={s.velocityRadarEnabled}
            onChange={(v) => save({ velocityRadarEnabled: v })}
            label="Check the numbers at hours 1, 2 and 4"
            hint="Warns you about a slow start (far under the channel's usual) and when YouTube shows the video as rejected or not public. ELO needs a few past videos to know what usual is. Instagram does not report muted audio to apps, so that cannot be caught."
          />
          <Switch
            checked={s.learningsEnabled}
            onChange={(v) => save({ learningsEnabled: v })}
            label="Learn from where viewers leave"
            hint="48 hours after a YouTube video goes live, ELO reads its audience curve and writes a lesson for the next script. Needs the YouTube analytics permission (reconnect YouTube once if it is refused)."
          />
          <Switch
            checked={s.fanQuestionsEnabled}
            onChange={(v) => save({ fanQuestionsEnabled: v })}
            label="Turn viewer questions into ideas"
            hint="Real questions in YouTube comments become idea cards in Upcoming (at most 3 per channel every few hours). Spam and chatter are left out."
          />
          <Switch
            checked={s.pinnedCommentEnabled}
            onChange={(v) => save({ pinnedCommentEnabled: v })}
            label="Post the first comment on YouTube"
            hint="If a drop has a pinned_comment, ELO posts it as the channel when the video goes live. YouTube does not let apps pin a comment, so you get a message to tap Pin yourself."
          />
          <Switch
            checked={s.pollReminderEnabled}
            onChange={(v) => save({ pollReminderEnabled: v })}
            label="Remind me to post the companion poll"
            hint="If a drop has a community_poll, you get the text 30 minutes after the video goes live. YouTube does not let apps post to the Community tab."
          />
          <Switch
            checked={s.thumbRescueEnabled}
            onChange={(v) => save({ thumbRescueEnabled: v })}
            label="Swap the thumbnail if almost nobody clicks"
            hint="If a drop came with spare thumbnails and the click rate is under the line below after 24 hours, ELO puts on the second one and reports the new rate 24 hours later. This changes a live video, so it is off until you turn it on."
          />
          <NumberSetting
            label="Click rate line (percent)"
            value={s.thumbRescueCtr}
            min={1}
            max={20}
            onSave={(v) => save({ thumbRescueCtr: v })}
          />
        </div>
      </Card>

      <BriefCard s={s} save={save} />
      <LessonsCard />
      <StorageCard />
      <RetractCard />
    </>
  )
}
