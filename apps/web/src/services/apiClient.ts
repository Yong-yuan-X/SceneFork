import {
  HealthResponseSchema,
  StoryResponseSchema,
  VideoTaskResponseSchema,
  type ChooseRequest,
  type CreateVideoRequest,
  type StoryResponse,
  type VideoTaskResponse,
} from '@scenefork/shared'
import { publicConfig } from '../config'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${publicConfig.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = (await response.json()) as { error?: string; code?: string }
  if (!response.ok) {
    throw new ApiError(body.error || `API request failed with HTTP ${response.status}`, response.status, body.code || 'API_ERROR')
  }
  return body
}

export const apiClient = {
  async health() {
    return HealthResponseSchema.parse(await request('/api/health'))
  },

  async createStory(idea: string): Promise<StoryResponse> {
    return StoryResponseSchema.parse(
      await request('/api/stories', { method: 'POST', body: JSON.stringify({ idea }) }),
    )
  },

  async getStory(storyId: string): Promise<StoryResponse> {
    return StoryResponseSchema.parse(await request(`/api/stories/${storyId}`))
  },

  async updateTurn(
    storyId: string,
    turnId: string,
    patch: { story_text?: string; video_prompt?: string },
  ): Promise<StoryResponse> {
    return StoryResponseSchema.parse(
      await request(`/api/stories/${storyId}/turns/${turnId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    )
  },

  async createVideo(
    storyId: string,
    turnId: string,
    input: CreateVideoRequest,
  ): Promise<VideoTaskResponse> {
    return VideoTaskResponseSchema.parse(
      await request(`/api/stories/${storyId}/turns/${turnId}/video`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    )
  },

  async getVideo(storyId: string, turnId: string): Promise<VideoTaskResponse> {
    return VideoTaskResponseSchema.parse(
      await request(`/api/stories/${storyId}/turns/${turnId}/video`),
    )
  },

  async choose(storyId: string, turnId: string, input: ChooseRequest): Promise<StoryResponse> {
    return StoryResponseSchema.parse(
      await request(`/api/stories/${storyId}/turns/${turnId}/choose`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    )
  },
}
