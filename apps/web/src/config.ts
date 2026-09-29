function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const publicConfig = Object.freeze({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000',
  videoPollMs: positiveNumber(import.meta.env.VITE_VIDEO_POLL_MS, 4000),
  useLocalMock: import.meta.env.VITE_USE_LOCAL_MOCK === 'true',
})
