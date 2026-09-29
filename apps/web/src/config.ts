function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const publicConfig = Object.freeze({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  mockVideoPollMs: positiveNumber(import.meta.env.VITE_VIDEO_POLL_MS, 1000),
})
