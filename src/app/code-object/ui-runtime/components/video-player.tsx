import { useEffect, useState } from 'react'

export type VideoPlayerModel = {
  autoplay: boolean
  controls: boolean
  fit: 'contain' | 'cover'
  loop: boolean
  muted: boolean
  poster?: string
  src: string
  title: string
}

export type VideoPlayerProps = Partial<Omit<VideoPlayerModel, 'src'>> &
  Pick<VideoPlayerModel, 'src'> & {
    className?: string
  }

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeVideoPlayerModel(value: Record<string, unknown>): VideoPlayerModel {
  return {
    autoplay: value.autoplay === true,
    controls: value.controls !== false,
    fit: value.fit === 'cover' ? 'cover' : 'contain',
    loop: value.loop === true,
    muted: value.muted === true,
    ...(stringValue(value.poster) ? { poster: stringValue(value.poster) } : {}),
    src: stringValue(value.src),
    title: stringValue(value.title) || 'Video player'
  }
}

export function VideoPlayer({
  autoplay = false,
  className = '',
  controls = true,
  fit = 'contain',
  loop = false,
  muted = false,
  poster,
  src,
  title = 'Video player'
}: VideoPlayerProps) {
  const [loading, setLoading] = useState(Boolean(src))
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setLoading(Boolean(src))
    setFailed(false)
  }, [src])

  return (
    <div
      className={`relative isolate size-full min-h-0 min-w-0 overflow-hidden bg-black text-white ${className}`}
      data-video-player=""
    >
      {src ? (
        <video
          aria-label={title}
          autoPlay={autoplay}
          className={`block size-full ${fit === 'cover' ? 'object-cover' : 'object-contain'}`}
          controls={controls}
          loop={loop}
          muted={muted}
          onError={() => {
            setLoading(false)
            setFailed(true)
          }}
          onLoadedData={() => {
            setLoading(false)
            setFailed(false)
          }}
          playsInline
          poster={poster}
          preload="metadata"
          src={src}
        />
      ) : null}
      {loading && !failed ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/35 text-xs text-white/70">
          Loading video…
        </div>
      ) : null}
      {failed || !src ? (
        <div className="absolute inset-0 grid place-items-center bg-black px-6 text-center text-xs text-white/65">
          {failed ? 'This video could not be loaded.' : 'No video source is available.'}
        </div>
      ) : null}
    </div>
  )
}
