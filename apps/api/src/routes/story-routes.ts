import {
  BranchRequestSchema,
  ChooseRequestSchema,
  CreateStoryRequestSchema,
  CreateVideoRequestSchema,
  RenameBranchRequestSchema,
  SelectVersionRequestSchema,
  UpdateTurnRequestSchema,
} from '@scenefork/shared'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { StoryService } from '../services/story-service.js'
import type { VideoService } from '../services/video-service.js'

const StoryParamsSchema = z.object({ storyId: z.string().uuid() })
const TurnParamsSchema = StoryParamsSchema.extend({ turnId: z.string().uuid() })
const BranchParamsSchema = StoryParamsSchema.extend({ branchId: z.string().uuid() })
const BranchTurnParamsSchema = BranchParamsSchema.extend({ turnId: z.string().uuid() })
const StoryQuerySchema = z.object({ branch_id: z.string().uuid().optional() })
const ListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(9),
})

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

  app.get('/api/stories', async (request) => {
    const query = ListQuerySchema.parse(request.query)
    return services.storyService.list(query.page, query.page_size)
  })

  app.get('/api/stories/:storyId', async (request) => {
    const { storyId } = StoryParamsSchema.parse(request.params)
    const query = StoryQuerySchema.parse(request.query)
    return services.storyService.get(storyId, query.branch_id)
  })

  app.delete('/api/stories/:storyId', async (request, reply) => {
    const { storyId } = StoryParamsSchema.parse(request.params)
    services.storyService.delete(storyId)
    console.info(`[story_route] Story deleted story=${storyId}`)
    return reply.code(204).send()
  })

  app.post('/api/stories/:storyId/cover/retry', async (request) => {
    const { storyId } = StoryParamsSchema.parse(request.params)
    return services.videoService.retryCover(storyId)
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
    const query = StoryQuerySchema.parse(request.query)
    return services.videoService.get(storyId, turnId, query.branch_id)
  })

  app.get('/api/stories/:storyId/turns/:turnId/videos', async (request) => {
    const { storyId, turnId } = TurnParamsSchema.parse(request.params)
    const query = StoryQuerySchema.parse(request.query)
    return services.videoService.history(storyId, turnId, query.branch_id)
  })

  app.post('/api/stories/:storyId/turns/:turnId/choose', async (request, reply) => {
    const { storyId, turnId } = TurnParamsSchema.parse(request.params)
    const input = ChooseRequestSchema.parse(request.body)
    const story = await services.storyService.choose(storyId, turnId, input)
    return reply.code(201).send(story)
  })

  app.post('/api/stories/:storyId/branches', async (request, reply) => {
    const { storyId } = StoryParamsSchema.parse(request.params)
    const input = BranchRequestSchema.parse(request.body)
    return reply.code(201).send(
      services.storyService.createBranch(
        storyId,
        input.source_branch_id,
        input.from_turn_id,
        input.name,
      ),
    )
  })

  app.get('/api/stories/:storyId/branches', async (request) => {
    const { storyId } = StoryParamsSchema.parse(request.params)
    return services.storyService.get(storyId).branches ?? []
  })

  app.put('/api/stories/:storyId/branches/:branchId/active', async (request) => {
    const { storyId, branchId } = BranchParamsSchema.parse(request.params)
    return services.storyService.activateBranch(storyId, branchId)
  })

  app.patch('/api/stories/:storyId/branches/:branchId', async (request) => {
    const { storyId, branchId } = BranchParamsSchema.parse(request.params)
    const input = RenameBranchRequestSchema.parse(request.body)
    return services.storyService.renameBranch(storyId, branchId, input.name)
  })

  app.delete('/api/stories/:storyId/branches/:branchId', async (request) => {
    const { storyId, branchId } = BranchParamsSchema.parse(request.params)
    console.info(`[story_route] Branch deletion requested story=${storyId} branch=${branchId}`)
    return services.storyService.deleteBranch(storyId, branchId)
  })

  app.get('/api/stories/:storyId/turns/:turnId/versions', async (request) => {
    const { storyId, turnId } = TurnParamsSchema.parse(request.params)
    return services.storyService.listVersions(storyId, turnId)
  })

  app.post('/api/stories/:storyId/turns/:turnId/versions', async (request, reply) => {
    const { storyId, turnId } = TurnParamsSchema.parse(request.params)
    const input = UpdateTurnRequestSchema.parse(request.body)
    return reply.code(201).send(services.storyService.updateTurn(storyId, turnId, input))
  })

  app.post('/api/stories/:storyId/branches/:branchId/turns/:turnId/regenerate-story', async (request, reply) => {
    const { storyId, branchId, turnId } = BranchTurnParamsSchema.parse(request.params)
    return reply.code(201).send(
      await services.storyService.regenerateTurn(storyId, branchId, turnId),
    )
  })

  app.put('/api/stories/:storyId/branches/:branchId/turns/:turnId/selected-version', async (request) => {
    const { storyId, branchId, turnId } = BranchTurnParamsSchema.parse(request.params)
    const input = SelectVersionRequestSchema.parse(request.body)
    return services.storyService.selectVersion(storyId, branchId, turnId, input)
  })

  app.put('/api/stories/:storyId/branches/:branchId/turns/:turnId/confirm', async (request) => {
    const { storyId, branchId, turnId } = BranchTurnParamsSchema.parse(request.params)
    return services.storyService.confirmTurn(storyId, branchId, turnId)
  })
}
