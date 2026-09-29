import fs from 'node:fs'
import type { AppConfig } from '../../../config.js'
import { appConfig } from '../../../config.js'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { createDatabase, type SceneForkDatabase } from './db/database.js'
import { Repository } from './db/repository.js'
import { AppError } from './errors.js'
import {
  MockStoryProvider,
  QwenStoryProvider,
  type StoryProvider,
} from './providers/story-provider.js'
import {
  MockVideoProvider,
  WanVideoProvider,
  type VideoProvider,
} from './providers/video-provider.js'
import { registerStoryRoutes } from './routes/story-routes.js'
import { MediaService } from './services/media-service.js'
import { StoryService } from './services/story-service.js'
import { VideoService } from './services/video-service.js'
import { VideoWorker } from './workers/video-worker.js'

export interface ServerOptions {
  config?: AppConfig
  database?: SceneForkDatabase
  storyProvider?: StoryProvider
  videoProvider?: VideoProvider
  startWorker?: boolean
}

export async function buildServer(options: ServerOptions = {}) {
  const config = options.config ?? appConfig
  const ownsDatabase = !options.database
  const database = options.database ?? createDatabase(config.databasePath)
  const repository = new Repository(database, config.providerMode)
  const storyProvider =
    options.storyProvider ??
    (config.providerMode === 'real'
      ? new QwenStoryProvider(config)
      : new MockStoryProvider())
  const videoProvider =
    options.videoProvider ??
    (config.providerMode === 'real'
      ? new WanVideoProvider(config)
      : new MockVideoProvider())
  const mediaService = new MediaService(config)
  const storyService = new StoryService(repository, storyProvider)
  const videoService = new VideoService(config, repository, videoProvider)
  const videoWorker = new VideoWorker(config, repository, videoProvider, mediaService)

  fs.mkdirSync(config.mediaDir, { recursive: true })
  const app = Fastify({ logger: false, requestIdHeader: 'x-request-id' })
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH'],
  })
  await app.register(fastifyStatic, {
    root: config.mediaDir,
    prefix: '/media/',
    decorateReply: false,
  })

  app.get('/api/health', async () => ({
    status: 'ok',
    provider_mode: config.providerMode,
    api_version: 'v1',
  }))
  registerStoryRoutes(app, { storyService, videoService })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        error: error.issues.map((issue) => issue.message).join('; '),
      })
    }
    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        console.error(
          `[api] Request failed request=${request.id} code=${error.code} error=${error.message}`,
        )
      }
      return reply.code(error.statusCode).send({ code: error.code, error: error.message })
    }
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      `[api] Unexpected request failure request=${request.id} error=${message}`,
    )
    return reply.code(500).send({ code: 'INTERNAL_ERROR', error: 'Internal server error' })
  })

  app.addHook('onClose', async () => {
    videoWorker.stop()
    if (ownsDatabase) database.close()
  })

  if (options.startWorker !== false) videoWorker.start()

  return { app, repository, storyService, videoService, videoWorker, database }
}
