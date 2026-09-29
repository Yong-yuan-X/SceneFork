import { z } from 'zod'
import type { AppConfig } from '../../../../config.js'
import { ProviderError } from '../errors.js'

export type ProviderVideoStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'UNKNOWN'

export interface VideoSubmission {
  taskId: string
  status: ProviderVideoStatus
  requestId: string | null
}

export interface VideoPollResult {
  status: ProviderVideoStatus
  videoUrl: string | null
  error: string | null
  requestId: string | null
}

export interface VideoProvider {
  submit(
    prompt: string,
    options: { requestId: string; mockOutcome?: 'success' | 'failure' | 'unknown' },
  ): Promise<VideoSubmission>
  poll(taskId: string): Promise<VideoPollResult>
}

export class MockVideoProvider implements VideoProvider {
  submit(
    _prompt: string,
    options: { requestId: string; mockOutcome?: 'success' | 'failure' | 'unknown' },
  ): Promise<VideoSubmission> {
    const outcome = options.mockOutcome ?? 'success'
    if (outcome === 'unknown') {
      throw new ProviderError(
        'Mock provider timed out before confirming task creation',
        true,
        options.requestId,
      )
    }
    return Promise.resolve({
      taskId: `mock-${Date.now()}-${outcome}`,
      status: 'PENDING',
      requestId: options.requestId,
    })
  }

  poll(taskId: string): Promise<VideoPollResult> {
    const parts = taskId.split('-')
    const startedAt = Number(parts[1])
    const outcome = parts.at(-1)
    const elapsed = Date.now() - startedAt
    if (elapsed < 1200) return Promise.resolve(result('PENDING'))
    if (elapsed < 2600) return Promise.resolve(result('RUNNING'))
    if (outcome === 'failure') {
      return Promise.resolve(result('FAILED', null, 'Mock render node reported a controlled failure'))
    }
    return Promise.resolve(result('SUCCEEDED', 'mock://preview'))
  }
}

export class WanVideoProvider implements VideoProvider {
  constructor(private readonly config: AppConfig) {}

  async submit(prompt: string, options: { requestId: string }): Promise<VideoSubmission> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.providerRequestTimeoutMs)
    const startedAt = Date.now()
    try {
      const response = await fetch(
        `${this.config.wanBaseUrl}/services/aigc/video-generation/video-synthesis`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.dashscopeApiKey}`,
            'Content-Type': 'application/json',
            'X-DashScope-Async': 'enable',
            'X-DashScope-Request-Id': options.requestId,
          },
          body: JSON.stringify({
            model: this.config.wanModel,
            input: { prompt },
            parameters: buildWanParameters(this.config),
          }),
          signal: controller.signal,
        },
      )
      const body = SubmitResponseSchema.parse(await response.json())
      if (!response.ok || !body.output?.task_id) {
        throw new ProviderError(
          body.message || `Wan returned HTTP ${response.status}`,
          false,
          body.request_id ?? null,
        )
      }
      console.info(
        `[video_service] Wan task submitted task=${body.output.task_id} request=${body.request_id ?? options.requestId} elapsed_ms=${Date.now() - startedAt}`,
      )
      return {
        taskId: body.output.task_id,
        status: normalizeStatus(body.output.task_status),
        requestId: body.request_id ?? null,
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      const isTimeout = error instanceof Error && error.name === 'AbortError'
      throw new ProviderError(
        isTimeout
          ? 'Wan submission timed out; task creation could not be confirmed'
          : `Wan submission failed without confirmation: ${safeError(error)}`,
        true,
        options.requestId,
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async poll(taskId: string): Promise<VideoPollResult> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.providerRequestTimeoutMs)
    const startedAt = Date.now()
    try {
      const response = await fetch(`${this.config.wanBaseUrl}/tasks/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${this.config.dashscopeApiKey}` },
        signal: controller.signal,
      })
      const body = PollResponseSchema.parse(await response.json())
      if (!response.ok) {
        throw new ProviderError(body.message || `Wan status returned HTTP ${response.status}`)
      }
      console.info(
        `[video_service] Wan task polled task=${taskId} status=${body.output?.task_status ?? 'UNKNOWN'} request=${body.request_id ?? 'unavailable'} elapsed_ms=${Date.now() - startedAt}`,
      )
      return {
        status: normalizeStatus(body.output?.task_status),
        videoUrl: body.output?.video_url ?? null,
        error: body.output?.message ?? body.message ?? null,
        requestId: body.request_id ?? null,
      }
    } catch (error) {
      if (error instanceof ProviderError) throw error
      throw new ProviderError(`Wan status request failed: ${safeError(error)}`)
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function buildWanParameters(
  config: Pick<AppConfig, 'wanModel' | 'wanVideoSize' | 'wanVideoDuration'>,
) {
  return {
    size: config.wanVideoSize,
    ...(config.wanModel === 'wan2.2-t2v-plus'
      ? {}
      : { duration: config.wanVideoDuration }),
    prompt_extend: true,
    ...(config.wanModel === 'wan2.6-t2v' ? { shot_type: 'single' as const } : {}),
    watermark: false,
  }
}

const SubmitResponseSchema = z.object({
  output: z
    .object({ task_id: z.string().optional(), task_status: z.string().optional() })
    .optional(),
  request_id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
})

const PollResponseSchema = z.object({
  output: z
    .object({
      task_id: z.string().optional(),
      task_status: z.string().optional(),
      video_url: z.string().optional(),
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
  request_id: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
})

function normalizeStatus(status?: string): ProviderVideoStatus {
  const normalized = status?.toUpperCase()
  if (
    normalized === 'PENDING' ||
    normalized === 'RUNNING' ||
    normalized === 'SUCCEEDED' ||
    normalized === 'FAILED' ||
    normalized === 'CANCELED' ||
    normalized === 'UNKNOWN'
  ) {
    return normalized
  }
  return 'UNKNOWN'
}

function result(
  status: ProviderVideoStatus,
  videoUrl: string | null = null,
  error: string | null = null,
): VideoPollResult {
  return { status, videoUrl, error, requestId: null }
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
