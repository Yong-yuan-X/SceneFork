import assert from 'node:assert/strict'
import test from 'node:test'
import type { StoryResponse } from '@scenefork/shared'
import {
  buildContinuationUserPrompt,
  buildRegenerationUserPrompt,
} from '../prompts/user-prompt.js'
import {
  buildQwenRequestBody,
  ensureVideoPromptDuration,
  parseStoryModelResponse,
} from './story-provider.js'

const validOutput = {
  title: '测试片段',
  story_text: '主角走进安静的大厅，发现墙上的旧钟正在逆向转动，并听见楼上传来脚步声。',
  summary: '主角进入大厅并发现逆向转动的时钟。',
  characters: [{ name: '主角', description: '穿深色外套，谨慎而坚定。' }],
  scene: { location: '古堡大厅', visual_style: '写实电影感，冷暖光对比' },
  video_prompt: 'Cinematic wide shot of a traveler entering an ancient hall while a clock runs backward, realistic light, slow camera movement.',
  next_choices: [
    { label: '查看时钟', direction: '主角靠近时钟检查机关。' },
    { label: '走上楼梯', direction: '主角循着脚步声前往二楼。' },
    { label: '躲入暗处', direction: '主角藏起来观察来者。' },
    { label: '呼唤来者', direction: '主角主动向楼上的人喊话。' },
  ],
}

test('story output parser accepts valid JSON with exactly four choices', () => {
  const parsed = parseStoryModelResponse(JSON.stringify(validOutput))
  assert.equal(parsed.next_choices.length, 4)
})

test('story output parser tolerates a JSON markdown fence', () => {
  const parsed = parseStoryModelResponse(`\`\`\`json\n${JSON.stringify(validOutput)}\n\`\`\``)
  assert.equal(parsed.title, validOutput.title)
})

test('Qwen request disables thinking and reserves an answer budget', () => {
  const body = buildQwenRequestBody('qwen3.7-flash', 'Create JSON')
  assert.equal(body.enable_thinking, false)
  assert.equal(body.max_completion_tokens, 8192)
})

test('video prompts end with the configured approximate duration', () => {
  const normalized = ensureVideoPromptDuration(
    { ...validOutput, video_prompt: `${validOutput.video_prompt} 8 seconds.` },
    5,
  )
  assert.match(normalized.video_prompt, / 5 seconds\.$/)
  assert.doesNotMatch(normalized.video_prompt, /8 seconds/)
})

test('story output parser rejects invalid JSON, missing fields, and wrong choice counts', () => {
  assert.throws(() => parseStoryModelResponse('{broken'))
  assert.throws(() => parseStoryModelResponse(JSON.stringify({ ...validOutput, summary: undefined })))
  assert.throws(() =>
    parseStoryModelResponse(
      JSON.stringify({ ...validOutput, next_choices: validOutput.next_choices.slice(0, 3) }),
    ),
  )
  assert.throws(() =>
    parseStoryModelResponse(
      JSON.stringify({
        ...validOutput,
        next_choices: validOutput.next_choices.map(() => validOutput.next_choices[0]),
      }),
    ),
  )
})

test('regeneration prompt targets the existing turn without requesting a branch', () => {
  const story: StoryResponse = {
    id: '00000000-0000-4000-8000-000000000011',
    original_idea: 'A city hidden in the clouds',
    title: 'The second turn',
    current_turn_id: '00000000-0000-4000-8000-000000000013',
    characters: [{ name: 'Traveler', description: 'A careful explorer.' }],
    scene: { location: 'Cloud city', visual_style: 'Cinematic realism' },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    provider_mode: 'mock',
    turns: [
      {
        id: '00000000-0000-4000-8000-000000000012',
        story_id: '00000000-0000-4000-8000-000000000011',
        parent_turn_id: null,
        title: 'Arrival',
        story_text: 'The traveler arrives at the city gate.',
        summary: 'The traveler reaches the city.',
        video_prompt: 'A traveler arrives at a gate. 5 seconds.',
        created_at: new Date().toISOString(),
        choices: [],
        video: idleVideo('00000000-0000-4000-8000-000000000012'),
      },
      {
        id: '00000000-0000-4000-8000-000000000013',
        story_id: '00000000-0000-4000-8000-000000000011',
        parent_turn_id: '00000000-0000-4000-8000-000000000012',
        title: 'The clock tower',
        story_text: 'The traveler enters a clock tower.',
        summary: 'The traveler investigates the tower.',
        video_prompt: 'The traveler enters a tower. 5 seconds.',
        created_at: new Date().toISOString(),
        choices: [],
        video: idleVideo('00000000-0000-4000-8000-000000000013'),
      },
    ],
    selections: [{
      id: '00000000-0000-4000-8000-000000000014',
      turn_id: '00000000-0000-4000-8000-000000000012',
      branch_id: '00000000-0000-4000-8000-000000000015',
      user_direction: 'Enter the clock tower.',
      source: 'custom',
      choice_id: null,
      next_turn_id: '00000000-0000-4000-8000-000000000013',
      status: 'complete',
      created_at: new Date().toISOString(),
    }],
  }

  const prompt = buildRegenerationUserPrompt(
    story,
    '00000000-0000-4000-8000-000000000013',
  )
  assert.match(prompt, /The traveler arrives at the city gate/)
  assert.match(prompt, /Enter the clock tower/)
  assert.match(prompt, /The traveler enters a clock tower/)
  assert.match(prompt, /do not create or suggest a branch operation/i)
  assert.match(prompt, /5 seconds\./)
})

function idleVideo(turnId: string): StoryResponse['turns'][number]['video'] {
  return {
    id: null,
    turn_id: turnId,
    version: 1,
    status: 'idle',
    task_id: null,
    provider_status: null,
    resolution: '1280*720',
    duration: 5,
    video_url: null,
    cover_url: null,
    cover_kind: 'placeholder',
    media_type: null,
    error: null,
    created_at: null,
    updated_at: null,
  }
}

test('continuation prompt contains confirmed context and excludes candidate choices', () => {
  const story: StoryResponse = {
    id: '00000000-0000-4000-8000-000000000001',
    original_idea: '一座会移动的城堡',
    title: '第一幕',
    current_turn_id: '00000000-0000-4000-8000-000000000002',
    characters: validOutput.characters,
    scene: validOutput.scene,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    provider_mode: 'mock',
    turns: [
      {
        id: '00000000-0000-4000-8000-000000000002',
        story_id: '00000000-0000-4000-8000-000000000001',
        parent_turn_id: null,
        title: '第一幕',
        story_text: validOutput.story_text,
        summary: validOutput.summary,
        video_prompt: validOutput.video_prompt,
        created_at: new Date().toISOString(),
        choices: validOutput.next_choices.map((choice, index) => ({
          id: `00000000-0000-4000-8000-00000000000${index + 3}`,
          position: index + 1,
          ...choice,
        })),
        video: {
          id: null,
          turn_id: '00000000-0000-4000-8000-000000000002',
          version: 1,
          status: 'idle',
          task_id: null,
          provider_status: null,
          resolution: '1280*720',
          duration: 5,
          video_url: null,
          cover_url: null,
          cover_kind: 'placeholder',
          media_type: null,
          error: null,
          created_at: null,
          updated_at: null,
        },
      },
    ],
    selections: [],
  }

  const prompt = buildContinuationUserPrompt(story, '主角决定检查时钟背后的机关。')
  assert.match(prompt, /主角决定检查时钟背后的机关/)
  assert.match(prompt, /逆向转动/)
  assert.match(prompt, /5 seconds\./)
  assert.doesNotMatch(prompt, /走上楼梯/)
  assert.doesNotMatch(prompt, /躲入暗处/)
})
