import { z } from 'zod'

export const ProviderModeSchema = z.enum(['mock', 'real'])
export type ProviderMode = z.infer<typeof ProviderModeSchema>

export const VideoStatusSchema = z.enum([
  'idle',
  'submitting',
  'queued',
  'running',
  'saving',
  'succeeded',
  'failed',
  'submission_unknown',
])
export type VideoStatus = z.infer<typeof VideoStatusSchema>

export const CharacterSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(500),
})

export const SceneSchema = z.object({
  location: z.string().trim().min(1).max(200),
  visual_style: z.string().trim().min(1).max(500),
})

export const StoryChoiceOutputSchema = z.object({
  label: z.string().trim().min(1).max(80),
  direction: z.string().trim().min(1).max(500),
})

export const StoryModelOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    story_text: z.string().trim().min(20).max(4000),
    summary: z.string().trim().min(5).max(800),
    characters: z.array(CharacterSchema).min(1).max(12),
    scene: SceneSchema,
    video_prompt: z.string().trim().min(20).max(5000),
    next_choices: z.array(StoryChoiceOutputSchema).length(4),
  })
  .superRefine((output, context) => {
    const directions = output.next_choices.map((choice) => choice.direction.toLocaleLowerCase())
    const labels = output.next_choices.map((choice) => choice.label.toLocaleLowerCase())
    if (new Set(directions).size !== directions.length || new Set(labels).size !== labels.length) {
      context.addIssue({
        code: 'custom',
        path: ['next_choices'],
        message: 'The four next choices must be mutually distinct',
      })
    }
  })
export type StoryModelOutput = z.infer<typeof StoryModelOutputSchema>

export const CreateStoryRequestSchema = z.object({
  idea: z.string().trim().min(3).max(2000),
  style: z.string().trim().min(1).max(300).optional(),
})
export type CreateStoryRequest = z.infer<typeof CreateStoryRequestSchema>

export const UpdateTurnRequestSchema = z
  .object({
    story_text: z.string().trim().min(20).max(4000).optional(),
    video_prompt: z.string().trim().min(20).max(5000).optional(),
  })
  .refine((value) => value.story_text !== undefined || value.video_prompt !== undefined, {
    message: 'At least one editable field is required',
  })
export type UpdateTurnRequest = z.infer<typeof UpdateTurnRequestSchema>

export const ChooseRequestSchema = z
  .object({
    choice_id: z.string().uuid().optional(),
    custom_direction: z.string().trim().min(3).max(1000).optional(),
  })
  .refine((value) => Boolean(value.choice_id) !== Boolean(value.custom_direction), {
    message: 'Provide exactly one of choice_id or custom_direction',
  })
export type ChooseRequest = z.infer<typeof ChooseRequestSchema>

export const CreateVideoRequestSchema = z.object({
  confirm_submission_unknown: z.boolean().optional().default(false),
  mock_outcome: z.enum(['success', 'failure', 'unknown']).optional(),
})
export type CreateVideoRequest = z.infer<typeof CreateVideoRequestSchema>

export const ChoiceResponseSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().min(1).max(4),
  label: z.string(),
  direction: z.string(),
})
export type ChoiceResponse = z.infer<typeof ChoiceResponseSchema>

export const VideoTaskResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  turn_id: z.string().uuid(),
  version: z.number().int().positive(),
  status: VideoStatusSchema,
  task_id: z.string().nullable(),
  provider_status: z.string().nullable(),
  resolution: z.string(),
  duration: z.number().int().positive(),
  video_url: z.string().nullable(),
  media_type: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
})
export type VideoTaskResponse = z.infer<typeof VideoTaskResponseSchema>

export const StoryTurnResponseSchema = z.object({
  id: z.string().uuid(),
  story_id: z.string().uuid(),
  parent_turn_id: z.string().uuid().nullable(),
  title: z.string(),
  story_text: z.string(),
  summary: z.string(),
  video_prompt: z.string(),
  created_at: z.string(),
  choices: z.array(ChoiceResponseSchema).length(4),
  video: VideoTaskResponseSchema,
})
export type StoryTurnResponse = z.infer<typeof StoryTurnResponseSchema>

export const SelectionResponseSchema = z.object({
  id: z.string().uuid(),
  turn_id: z.string().uuid(),
  user_direction: z.string(),
  source: z.enum(['preset', 'custom']),
  choice_id: z.string().uuid().nullable(),
  next_turn_id: z.string().uuid().nullable(),
  status: z.enum(['generating', 'complete', 'failed']),
  created_at: z.string(),
})
export type SelectionResponse = z.infer<typeof SelectionResponseSchema>

export const StoryResponseSchema = z.object({
  id: z.string().uuid(),
  original_idea: z.string(),
  title: z.string(),
  current_turn_id: z.string().uuid(),
  characters: z.array(CharacterSchema),
  scene: SceneSchema,
  created_at: z.string(),
  updated_at: z.string(),
  provider_mode: ProviderModeSchema,
  turns: z.array(StoryTurnResponseSchema).min(1),
  selections: z.array(SelectionResponseSchema),
})
export type StoryResponse = z.infer<typeof StoryResponseSchema>

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  provider_mode: ProviderModeSchema,
  api_version: z.string(),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>
