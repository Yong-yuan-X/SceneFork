import {
  HealthResponseSchema,
  KeysStatusResponseSchema,
  StoryListResponseSchema,
  StoryResponseSchema,
  TurnContentVersionResponseSchema,
  VideoTaskResponseSchema,
  type ChooseRequest,
  type CreateVideoRequest,
  type StoryResponse,
  type UpdateKeysRequest,
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
  const text = await response.text()
  const body = (text ? JSON.parse(text) : null) as {
    error?: string
    code?: string
  } | null
  if (!response.ok) {
    throw new ApiError(
      body?.error || `API request failed with HTTP ${response.status}`,
      response.status,
      body?.code || 'API_ERROR',
    )
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

  async listStories(page = 1, pageSize = 9) {
    return StoryListResponseSchema.parse(
      await request(`/api/stories?page=${page}&page_size=${pageSize}`),
    )
  },

  async getStory(storyId: string, branchId?: string): Promise<StoryResponse> {
    const query = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ''
    return StoryResponseSchema.parse(await request(`/api/stories/${storyId}${query}`))
  },

  async deleteStory(storyId: string) {
    await request(`/api/stories/${storyId}`, { method: 'DELETE' })
  },

  async updateTurn(
    storyId: string,
    turnId: string,
    patch: { branch_id?: string; story_text?: string; video_prompt?: string },
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

  async getVideo(storyId: string, turnId: string, branchId?: string): Promise<VideoTaskResponse> {
    const query = branchId ? `?branch_id=${encodeURIComponent(branchId)}` : ''
    return VideoTaskResponseSchema.parse(
      await request(`/api/stories/${storyId}/turns/${turnId}/video${query}`),
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

  async createBranch(storyId: string, sourceBranchId: string, fromTurnId: string, name?: string) {
    return StoryResponseSchema.parse(await request(`/api/stories/${storyId}/branches`, {
      method: 'POST',
      body: JSON.stringify({ source_branch_id: sourceBranchId, from_turn_id: fromTurnId, name }),
    }))
  },

  async activateBranch(storyId: string, branchId: string) {
    return StoryResponseSchema.parse(await request(
      `/api/stories/${storyId}/branches/${branchId}/active`,
      { method: 'PUT', body: '{}' },
    ))
  },

  async renameBranch(storyId: string, branchId: string, name: string) {
    return StoryResponseSchema.parse(await request(
      `/api/stories/${storyId}/branches/${branchId}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
    ))
  },

  async deleteBranch(storyId: string, branchId: string) {
    return StoryResponseSchema.parse(await request(
      `/api/stories/${storyId}/branches/${branchId}`,
      { method: 'DELETE' },
    ))
  },

  async listVersions(storyId: string, turnId: string) {
    const body = await request(`/api/stories/${storyId}/turns/${turnId}/versions`)
    return TurnContentVersionResponseSchema.array().parse(body)
  },

  async regenerateStory(storyId: string, branchId: string, turnId: string) {
    return StoryResponseSchema.parse(await request(
      `/api/stories/${storyId}/branches/${branchId}/turns/${turnId}/regenerate-story`,
      { method: 'POST', body: '{}' },
    ))
  },

  async selectVersion(
    storyId: string,
    branchId: string,
    turnId: string,
    input: { content_version_id?: string; video_task_id?: string | null },
  ) {
    return StoryResponseSchema.parse(await request(
      `/api/stories/${storyId}/branches/${branchId}/turns/${turnId}/selected-version`,
      { method: 'PUT', body: JSON.stringify(input) },
    ))
  },

  async confirmTurn(storyId: string, branchId: string, turnId: string) {
    return StoryResponseSchema.parse(await request(
      `/api/stories/${storyId}/branches/${branchId}/turns/${turnId}/confirm`,
      { method: 'PUT', body: '{}' },
    ))
  },

  async getKeyStatus() {
    return KeysStatusResponseSchema.parse(await request('/api/settings/keys', {
      headers: { 'X-SceneFork-Settings': '1' },
    }))
  },

  async updateKeys(input: UpdateKeysRequest) {
    return KeysStatusResponseSchema.parse(await request('/api/settings/keys', {
      method: 'PUT',
      headers: { 'X-SceneFork-Settings': '1' },
      body: JSON.stringify(input),
    }))
  },
}
