import {
  StoryModelOutputSchema,
  type StoryModelOutput,
  type StoryResponse,
} from '@scenefork/shared'
import type { AppConfig } from '../../../../config.js'
import { ProviderError } from '../errors.js'
import { STORY_SYSTEM_PROMPT, STORY_SYSTEM_PROMPT_VERSION } from '../prompts/system-prompt.js'
import { buildContinuationUserPrompt, buildOpeningUserPrompt } from '../prompts/user-prompt.js'

export interface StoryProvider {
  generateOpening(idea: string, style?: string): Promise<StoryModelOutput>
  generateContinuation(story: StoryResponse, userDirection: string): Promise<StoryModelOutput>
}

export function parseStoryModelResponse(content: string): StoryModelOutput {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new ProviderError('The story provider returned invalid JSON')
  }
  const parsed = StoryModelOutputSchema.safeParse(value)
  if (!parsed.success) {
    throw new ProviderError(`The story response failed validation: ${parsed.error.issues[0]?.message}`)
  }
  return parsed.data
}

export class MockStoryProvider implements StoryProvider {
  async generateOpening(idea: string): Promise<StoryModelOutput> {
    await delay(120)
    return mockOutput(
      '雾海尽头的城堡',
      `暮色沉入群山，你带着“${idea}”留下的线索来到雾谷。云层裂开的瞬间，一座悬于峭壁之上的古堡亮起灯火，石桥上的火炬像是在回应某个迟到了许多年的约定。`,
      '主角抵达雾谷，并发现远处古堡正在发出神秘召唤。',
    )
  }

  async generateContinuation(_story: StoryResponse, userDirection: string): Promise<StoryModelOutput> {
    await delay(120)
    return mockOutput(
      '长桥上的回声',
      `你决定${userDirection}。夜风卷过石桥，月光下浮现出一串陌生脚印。它们一路延伸到紧闭的大门前，却没有任何折返的痕迹；门后随即传来与你心跳相同节奏的敲击声。`,
      '主角沿选定方向继续前进，并在古堡入口发现异常脚印与神秘回声。',
    )
  }
}

export class QwenStoryProvider implements StoryProvider {
  constructor(private readonly config: AppConfig) {}

  generateOpening(idea: string, style?: string) {
    return this.generate(buildOpeningUserPrompt(idea, style))
  }

  generateContinuation(story: StoryResponse, userDirection: string) {
    return this.generate(buildContinuationUserPrompt(story, userDirection))
  }

  private async generate(userPrompt: string): Promise<StoryModelOutput> {
    let lastError: unknown
    const totalAttempts = this.config.qwenMaxRetries + 1
    const generationStartedAt = Date.now()
    console.info(
      `[story_service] Qwen generation started model=${this.config.qwenModel} attempts=${totalAttempts} timeout_ms=${this.config.qwenRequestTimeoutMs} prompt=${STORY_SYSTEM_PROMPT_VERSION} input_chars=${userPrompt.length}`,
    )
    for (let attempt = 0; attempt <= this.config.qwenMaxRetries; attempt += 1) {
      const startedAt = Date.now()
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), this.config.qwenRequestTimeoutMs)
      console.info(
        `[story_service] Qwen attempt started attempt=${attempt + 1}/${totalAttempts} model=${this.config.qwenModel}`,
      )
      try {
        const response = await fetch(`${this.config.qwenBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.dashscopeApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.config.qwenModel,
            messages: [
              { role: 'system', content: STORY_SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            response_format: STORY_RESPONSE_FORMAT,
            max_completion_tokens: 2500,
          }),
          signal: controller.signal,
        })
        const requestId = response.headers.get('x-request-id') ?? 'unavailable'
        console.info(
          `[story_service] Qwen response received attempt=${attempt + 1}/${totalAttempts} request=${requestId} status=${response.status} elapsed_ms=${Date.now() - startedAt}`,
        )
        const body = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>
          message?: string
        }
        if (!response.ok) {
          throw new ProviderError(body.message || `Qwen returned HTTP ${response.status}`, false, requestId)
        }
        const content = body.choices?.[0]?.message?.content
        if (!content) throw new ProviderError('Qwen returned an empty response', false, requestId)
        const output = parseStoryModelResponse(content)
        console.info(
          `[story_service] Qwen response validated request=${requestId} prompt=${STORY_SYSTEM_PROMPT_VERSION} attempt=${attempt + 1}/${totalAttempts} attempt_elapsed_ms=${Date.now() - startedAt} total_elapsed_ms=${Date.now() - generationStartedAt}`,
        )
        return output
      } catch (error) {
        const timedOut = isAbortError(error)
        lastError = timedOut
          ? new ProviderError(`Qwen request timed out after ${this.config.qwenRequestTimeoutMs}ms`)
          : error
        console.warn(
          `[story_service] Qwen attempt failed attempt=${attempt + 1}/${totalAttempts} timeout=${timedOut} elapsed_ms=${Date.now() - startedAt} error=${safeError(lastError)}`,
        )
      } finally {
        clearTimeout(timeout)
      }
    }
    console.error(
      `[story_service] Qwen generation failed attempts=${totalAttempts} total_elapsed_ms=${Date.now() - generationStartedAt} error=${safeError(lastError)}`,
    )
    if (lastError instanceof ProviderError) throw lastError
    throw new ProviderError(`Qwen request failed: ${safeError(lastError)}`)
  }
}

const STORY_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'scenefork_story_turn',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        story_text: { type: 'string' },
        summary: { type: 'string' },
        characters: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { name: { type: 'string' }, description: { type: 'string' } },
            required: ['name', 'description'],
          },
        },
        scene: {
          type: 'object',
          additionalProperties: false,
          properties: { location: { type: 'string' }, visual_style: { type: 'string' } },
          required: ['location', 'visual_style'],
        },
        video_prompt: { type: 'string' },
        next_choices: {
          type: 'array',
          minItems: 4,
          maxItems: 4,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: { label: { type: 'string' }, direction: { type: 'string' } },
            required: ['label', 'direction'],
          },
        },
      },
      required: [
        'title',
        'story_text',
        'summary',
        'characters',
        'scene',
        'video_prompt',
        'next_choices',
      ],
    },
  },
} as const

function mockOutput(title: string, storyText: string, summary: string): StoryModelOutput {
  return StoryModelOutputSchema.parse({
    title,
    story_text: storyText,
    summary,
    characters: [{ name: '旅人', description: '深色旅行斗篷，谨慎、好奇，随身带着一枚旧银币。' }],
    scene: { location: '雾谷与山顶古堡', visual_style: '写实电影感，暮色冷调与温暖火光对比' },
    video_prompt:
      'Cinematic wide shot of the same cloaked traveler approaching a luminous gothic castle above a mist-filled valley at sunset, warm torchlight, violet clouds, realistic fantasy film, slow forward camera movement, consistent costume, 16:9.',
    next_choices: [
      { label: '穿过石桥', direction: '主角穿过雾中的石桥，直接前往古堡大门。' },
      { label: '寻找侧门', direction: '主角绕到峭壁背面，寻找守卫看不到的旧入口。' },
      { label: '调查火炬', direction: '主角先检查自行亮起的桥边火炬，寻找魔法痕迹。' },
      { label: '呼唤城堡', direction: '主角留在原地向城堡呼喊，等待里面的存在回应。' },
    ],
  })
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'This operation was aborted')
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))
