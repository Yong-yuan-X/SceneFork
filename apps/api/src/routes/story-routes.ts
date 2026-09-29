import {
  ChooseRequestSchema,
  CreateStoryRequestSchema,
  CreateVideoRequestSchema,
  UpdateTurnRequestSchema,
} from '@scenefork/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { StoryService } from '../services/story-service.js'
import type { VideoService } from '../services/video-service.js'

const StoryParamsSchema = z.object({ storyId: z.string().uuid() })
const TurnParamsSchema = StoryParamsSchema.extend({ turnId: z.string().uuid() })

export function registerStoryRoutes(
  app: FastifyInstance,
  services: { storyService: StoryService; videoService: VideoService },
) {
  app.post('/api/stories', async (request, reply) => {
    const input = CreateStoryRequestSchema.parse(request.body)
    console.info(
      `[story_route] Story creation requested request=${request.id} idea_chars=${input.idea.length} style=${input.style ? 'provided' : 'default'}`,
    )
    const story = await services.storyService.create(input)
    console.info(`[story_route] Story created story=${story.id}`)
    return reply.code(201).send(story)
  })

  app.get('/api/stories/:storyId', async (request) => {
    const { storyId } = StoryParamsSchema.parse(request.params)
    return services.storyService.get(storyId)
  })

  app.patch('/api/stories/:storyId/turns/:turnId', async (request) => {
    const { storyId, turnId } = TurnParamsSchema.parse(request.params)
    const input = UpdateTurnRequestSchema.parse(request.body)
    return services.storyService.updateTurn(storyId, turnId, input)
  })

  app.post('/api/stories/:storyId/turns/:turnId/video', async (request, reply) => {
    const { storyId, turnId } = TurnParamsSchema.parse(request.params)
    const input = CreateVideoRequestSchema.parse(request.body ?? {})
    console.info(`[video_route] Video submission requested story=${storyId} turn=${turnId}`)
    const result = await services.videoService.submit(storyId, turnId, input)
    const statusCode = result.task.status === 'succeeded' ? 200 : 202
    return reply.code(statusCode).send(result.task)
  })

  app.get('/api/stories/:storyId/turns/:turnId/video', async (request) => {
    const { storyId, turnId } = TurnParamsSchema.parse(request.params)
    return services.videoService.get(storyId, turnId)
  })

  app.post('/api/stories/:storyId/turns/:turnId/choose', async (request, reply) => {
    const { storyId, turnId } = TurnParamsSchema.parse(request.params)
    const input = ChooseRequestSchema.parse(request.body)
    const story = await services.storyService.choose(storyId, turnId, input)
    return reply.code(201).send(story)
  })
}
