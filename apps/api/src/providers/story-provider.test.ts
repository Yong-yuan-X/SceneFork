import assert from 'node:assert/strict'
import test from 'node:test'
import type { StoryResponse } from '@scenefork/shared'
import { buildContinuationUserPrompt } from '../prompts/user-prompt.js'
import { parseStoryModelResponse } from './story-provider.js'

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
  assert.doesNotMatch(prompt, /走上楼梯/)
  assert.doesNotMatch(prompt, /躲入暗处/)
})
