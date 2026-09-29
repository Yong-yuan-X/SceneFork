import fs from 'node:fs'
import path from 'node:path'
import { config as loadDotEnv } from 'dotenv'
import { z } from 'zod'

const projectRoot = findProjectRoot(process.cwd())
loadDotEnv({ path: path.join(projectRoot, '.env'), quiet: true })

const positiveInteger = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback)

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SCENEFORK_PROVIDER_MODE: z.enum(['mock', 'real']).default('mock'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DASHSCOPE_API_KEY: z.string().trim().default(''),
    QWEN_MODEL: z.string().trim().min(1).default('qwen3.7-flash'),
    WAN_MODEL: z.string().trim().min(1).default('wan2.6-t2v'),
    QWEN_BASE_URL: z.string().trim().default(''),
    WAN_BASE_URL: z.string().trim().default(''),
    DATABASE_URL: z.string().trim().min(1).default('./data/scenefork.db'),
    MEDIA_DIR: z.string().trim().min(1).default('./media'),
    WAN_VIDEO_SIZE: z.string().regex(/^\d+\*\d+$/).default('1280*720'),
    WAN_VIDEO_DURATION: z.coerce.number().int().min(2).max(15).default(5),
    WAN_PROVIDER_POLL_MS: positiveInteger(15_000),
    PROVIDER_REQUEST_TIMEOUT_MS: positiveInteger(120_000),
    QWEN_REQUEST_TIMEOUT_MS: positiveInteger(120_000),
    QWEN_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
  })
  .superRefine((environment, context) => {
    if (environment.SCENEFORK_PROVIDER_MODE !== 'real') return

    const required = [
      ['DASHSCOPE_API_KEY', environment.DASHSCOPE_API_KEY],
      ['QWEN_BASE_URL', environment.QWEN_BASE_URL],
      ['WAN_BASE_URL', environment.WAN_BASE_URL],
    ] as const

    for (const [name, value] of required) {
      if (!value) {
        context.addIssue({
          code: 'custom',
          path: [name],
          message: `${name} is required when SCENEFORK_PROVIDER_MODE=real`,
        })
      }
    }

    for (const [name, value] of [
      ['QWEN_BASE_URL', environment.QWEN_BASE_URL],
      ['WAN_BASE_URL', environment.WAN_BASE_URL],
    ] as const) {
      if (value && !URL.canParse(value)) {
        context.addIssue({ code: 'custom', path: [name], message: `${name} must be a valid URL` })
      }
    }

    if (
      environment.WAN_BASE_URL &&
      URL.canParse(environment.WAN_BASE_URL) &&
      !/\/api\/v1\/?$/.test(environment.WAN_BASE_URL)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['WAN_BASE_URL'],
        message: 'WAN_BASE_URL must be the native DashScope endpoint ending with /api/v1',
      })
    }

    if (environment.WAN_MODEL === 'wan2.2-t2v-plus') {
      const supportedSizes = new Set([
        '832*480',
        '480*832',
        '624*624',
        '1920*1080',
        '1080*1920',
        '1440*1440',
        '1632*1248',
        '1248*1632',
      ])
      if (!supportedSizes.has(environment.WAN_VIDEO_SIZE)) {
        context.addIssue({
          code: 'custom',
          path: ['WAN_VIDEO_SIZE'],
          message: 'wan2.2-t2v-plus supports only 480P or 1080P resolutions',
        })
      }
      if (environment.WAN_VIDEO_DURATION !== 5) {
        context.addIssue({
          code: 'custom',
          path: ['WAN_VIDEO_DURATION'],
          message: 'wan2.2-t2v-plus has a fixed duration of 5 seconds',
        })
      }
    }
  })

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production'
  providerMode: 'mock' | 'real'
  host: string
  port: number
  dashscopeApiKey: string
  qwenModel: string
  wanModel: string
  qwenBaseUrl: string
  wanBaseUrl: string
  databasePath: string
  mediaDir: string
  wanVideoSize: string
  wanVideoDuration: number
  wanProviderPollMs: number
  providerRequestTimeoutMs: number
  qwenRequestTimeoutMs: number
  qwenMaxRetries: number
}

export function readConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment)

  return Object.freeze({
    nodeEnv: parsed.NODE_ENV,
    providerMode: parsed.SCENEFORK_PROVIDER_MODE,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    dashscopeApiKey: parsed.DASHSCOPE_API_KEY,
    qwenModel: parsed.QWEN_MODEL,
    wanModel: parsed.WAN_MODEL,
    qwenBaseUrl: parsed.QWEN_BASE_URL.replace(/\/$/, ''),
    wanBaseUrl: parsed.WAN_BASE_URL.replace(/\/$/, ''),
    databasePath: path.resolve(projectRoot, parsed.DATABASE_URL),
    mediaDir: path.resolve(projectRoot, parsed.MEDIA_DIR),
    wanVideoSize: parsed.WAN_VIDEO_SIZE,
    wanVideoDuration: parsed.WAN_VIDEO_DURATION,
    wanProviderPollMs: parsed.WAN_PROVIDER_POLL_MS,
    providerRequestTimeoutMs: parsed.PROVIDER_REQUEST_TIMEOUT_MS,
    qwenRequestTimeoutMs: parsed.QWEN_REQUEST_TIMEOUT_MS,
    qwenMaxRetries: parsed.QWEN_MAX_RETRIES,
  })
}

export const appConfig = readConfig()

function findProjectRoot(startDirectory: string): string {
  let directory = path.resolve(startDirectory)
  while (true) {
    const packagePath = path.join(directory, 'package.json')
    if (fs.existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as {
          name?: string
          workspaces?: unknown
        }
        if (packageJson.name === 'scenefork' && packageJson.workspaces) return directory
      } catch {
        // Continue walking; malformed child manifests must not select a false root.
      }
    }
    const parent = path.dirname(directory)
    if (parent === directory) return path.resolve(startDirectory)
    directory = parent
  }
}
