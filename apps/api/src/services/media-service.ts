import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppConfig } from '../../../../config.js'
import { ProviderError } from '../errors.js'

export class MediaService {
  constructor(private readonly config: AppConfig) {}

  async save(taskId: string, sourceUrl: string): Promise<{ filename: string; mediaType: string }> {
    await fs.mkdir(this.config.mediaDir, { recursive: true })
    if (sourceUrl === 'mock://preview') {
      const filename = `${taskId}.svg`
      await fs.writeFile(path.join(this.config.mediaDir, filename), MOCK_PREVIEW_SVG, 'utf8')
      return { filename, mediaType: 'image/svg+xml' }
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
      await fs.writeFile(path.join(this.config.mediaDir, filename), bytes)
      return { filename, mediaType: contentType }
    } finally {
      clearTimeout(timeout)
    }
  }
}

const MOCK_PREVIEW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#13283c"/><stop offset=".5" stop-color="#492b68"/><stop offset="1" stop-color="#e66c66"/></linearGradient></defs>
<rect width="1280" height="720" fill="url(#g)"/><path d="M0 525 190 385l125 90 175-215 180 220 155-140 205 175 250-130v335H0Z" fill="#081521" opacity=".82"/><path d="m875 410 80-175 70 175v170H875Z" fill="#061019"/><path d="M825 580h255v45H825Z" fill="#061019"/><g fill="#ffc36f"><rect x="930" y="355" width="12" height="28"/><rect x="978" y="355" width="12" height="28"/><rect x="950" y="455" width="14" height="34"/></g><text x="48" y="660" fill="#b8fff7" font-family="system-ui" font-size="24">SceneFork · Mock provider preview</text></svg>`
