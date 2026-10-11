import { useState } from 'react'

/** Plays a finished video from the Media Root. `path` is relative to the Media Root. */
export function VideoPlayer({ path, poster }: { path: string; poster?: string | null }) {
  const [failed, setFailed] = useState(false)
  const src = 'elo-media://video/' + path.split('/').map(encodeURIComponent).join('/')
  if (failed)
    return (
      <div className="rounded-2xl bg-black/20 p-4 text-[12px] glass-dim">
        This video could not be played here. It may have been moved or removed.
      </div>
    )
  return (
    <video
      controls
      preload="metadata"
      poster={poster ?? undefined}
      src={src}
      onError={() => setFailed(true)}
      className="max-h-[52vh] w-full rounded-2xl bg-black shadow-xl"
    />
  )
}
