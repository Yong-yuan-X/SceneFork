import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppConfig } from '../../../../config.js'
import { ProviderError } from '../errors.js'

export class MediaService {
  constructor(private readonly config: AppConfig) {}

  async save(taskId: string, sourceUrl: string): Promise<{
    filename: string
    mediaType: string
    thumbnailFilename: string | null
  }> {
    await fs.mkdir(this.config.mediaDir, { recursive: true })
    if (sourceUrl === 'mock://preview') {
      const filename = `${taskId}.svg`
      await fs.writeFile(path.join(this.config.mediaDir, filename), MOCK_PREVIEW_SVG, 'utf8')
      return { filename, mediaType: 'image/svg+xml', thumbnailFilename: null }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.providerRequestTimeoutMs)
    try {
      const response = await fetch(sourceUrl, { signal: controller.signal })
      if (!response.ok) throw new ProviderError(`Video download returned HTTP ${response.status}`)
      const contentType = response.headers.get('content-type')?.split(';')[0] || 'video/mp4'
      if (!contentType.startsWith('video/')) {
        throw new ProviderError(`Unexpected media type from video download: ${contentType}`)
      }
      const extension = contentType === 'video/webm' ? 'webm' : 'mp4'
      const filename = `${taskId}.${extension}`
      const bytes = Buffer.from(await response.arrayBuffer())
      const finalPath = path.join(this.config.mediaDir, filename)
      const temporaryPath = path.join(this.config.mediaDir, `${taskId}.${randomUUID()}.download`)
      await fs.writeFile(temporaryPath, bytes)
      await fs.rename(temporaryPath, finalPath)
      const thumbnailFilename = await this.extractThumbnail(taskId, finalPath)
      return { filename, mediaType: contentType, thumbnailFilename }
    } finally {
      clearTimeout(timeout)
    }
  }

  async extractThumbnail(taskId: string, videoPath: string): Promise<string | null> {
    const filename = `${taskId}.cover.jpg`
    const finalPath = path.join(this.config.mediaDir, filename)
    try {
      await fs.access(finalPath)
      return filename
    } catch {
      // Extract it once below.
    }

    const temporaryPath = path.join(
      this.config.mediaDir,
      `${taskId}.${randomUUID()}.cover.jpg`,
    )
    try {
      await execFileAsync(
        this.config.ffmpegPath ?? 'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-y', '-ss', '0', '-i', videoPath, '-frames:v', '1', '-q:v', '3', temporaryPath],
        { timeout: this.config.ffmpegTimeoutMs ?? 15_000, windowsHide: true },
      )
      await fs.rename(temporaryPath, finalPath)
      console.info(`[media_service] Video thumbnail extracted task=${taskId}`)
      return filename
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') {
        console.warn('[media_service] FFmpeg not found, falling back to default thumbnail')
      } else {
        console.warn(
          `[media_service] Thumbnail extraction failed; using default thumbnail task=${taskId} error=${safeError(error)}`,
        )
      }
      return null
    }
  }

  retryThumbnail(taskId: string, mediaFilename: string) {
    return this.extractThumbnail(taskId, path.join(this.config.mediaDir, mediaFilename))
  }
}

const execFileAsync = promisify(execFile)

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/[\r\n]+/g, ' ') : String(error)
}

const MOCK_PREVIEW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#13283c"/><stop offset=".5" stop-color="#492b68"/><stop offset="1" stop-color="#e66c66"/></linearGradient></defs>
<rect width="1280" height="720" fill="url(#g)"/><path d="M0 525 190 385l125 90 175-215 180 220 155-140 205 175 250-130v335H0Z" fill="#081521" opacity=".82"/><path d="m875 410 80-175 70 175v170H875Z" fill="#061019"/><path d="M825 580h255v45H825Z" fill="#061019"/><g fill="#ffc36f"><rect x="930" y="355" width="12" height="28"/><rect x="978" y="355" width="12" height="28"/><rect x="950" y="455" width="14" height="34"/></g><text x="48" y="660" fill="#b8fff7" font-family="system-ui" font-size="24">SceneFork · Mock provider preview</text></svg>`
