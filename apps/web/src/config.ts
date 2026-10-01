import { resolveApiBaseUrl } from './services/apiBaseUrl'

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const defaultApiBaseUrl = import.meta.env.DEV ? 'http://127.0.0.1:3000' : ''

export const publicConfig = Object.freeze({
  apiBaseUrl: resolveApiBaseUrl(
    import.meta.env.VITE_API_BASE_URL,
    defaultApiBaseUrl,
  ),
  videoPollMs: positiveNumber(import.meta.env.VITE_VIDEO_POLL_MS, 4000),
  useLocalMock: import.meta.env.VITE_USE_LOCAL_MOCK === 'true',
})

export function backendUrl(path: string): string {
  const origin = publicConfig.apiBaseUrl || window.location.origin
  return new URL(path, `${origin}/`).toString()
}
