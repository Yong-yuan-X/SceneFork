export interface MediaVolumeTarget {
  volume: number
  muted: boolean
}

export interface MediaVolumeState {
  volumePercent: number
  muted: boolean
}

export interface FullscreenTarget {
  requestFullscreen?: () => Promise<void>
}

export interface FullscreenDocumentTarget {
  fullscreenElement: unknown
  exitFullscreen?: () => Promise<void>
}

export function normalizeVolumePercent(value: number): number {
  if (!Number.isFinite(value)) return 100
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function readMediaVolume(media: MediaVolumeTarget): MediaVolumeState {
  return {
    volumePercent: normalizeVolumePercent(media.volume * 100),
    muted: media.muted || media.volume === 0,
  }
}

export function setMediaVolume(
  media: MediaVolumeTarget,
  volumePercent: number,
): MediaVolumeState {
  const normalized = normalizeVolumePercent(volumePercent)
  media.volume = normalized / 100
  media.muted = normalized === 0
  return readMediaVolume(media)
}

export function toggleMediaMute(
  media: MediaVolumeTarget,
  restoreVolumePercent = 100,
): MediaVolumeState {
  if (media.muted || media.volume === 0) {
    if (media.volume === 0) {
      const restored = normalizeVolumePercent(restoreVolumePercent)
      media.volume = (restored || 100) / 100
    }
    media.muted = false
  } else {
    media.muted = true
  }
  return readMediaVolume(media)
}

export function isElementFullscreen(
  target: FullscreenTarget | null,
  fullscreenDocument: FullscreenDocumentTarget,
): boolean {
  return Boolean(target && fullscreenDocument.fullscreenElement === target)
}

export async function toggleElementFullscreen(
  target: FullscreenTarget,
  fullscreenDocument: FullscreenDocumentTarget,
): Promise<void> {
  if (fullscreenDocument.fullscreenElement === target) {
    if (!fullscreenDocument.exitFullscreen) throw new Error('Fullscreen exit is not supported')
    await fullscreenDocument.exitFullscreen()
    return
  }
  if (!target.requestFullscreen) throw new Error('Fullscreen is not supported')
  await target.requestFullscreen()
}
