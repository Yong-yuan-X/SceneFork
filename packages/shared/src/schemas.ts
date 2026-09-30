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
    branch_id: z.string().uuid().optional(),
    story_text: z.string().trim().min(20).max(4000).optional(),
    video_prompt: z.string().trim().min(20).max(5000).optional(),
  })
  .refine((value) => value.story_text !== undefined || value.video_prompt !== undefined, {
    message: 'At least one editable field is required',
  })
export type UpdateTurnRequest = z.infer<typeof UpdateTurnRequestSchema>

export const TurnContentVersionResponseSchema = z.object({
  id: z.string().uuid(),
  turn_id: z.string().uuid(),
  version: z.number().int().positive(),
  title: z.string(),
  story_text: z.string(),
  summary: z.string(),
  video_prompt: z.string(),
  created_at: z.string(),
})
export type TurnContentVersionResponse = z.infer<typeof TurnContentVersionResponseSchema>

export const ChooseRequestSchema = z
  .object({
    branch_id: z.string().uuid().optional(),
    choice_id: z.string().uuid().optional(),
    custom_direction: z.string().trim().min(3).max(1000).optional(),
  })
  .refine((value) => Boolean(value.choice_id) !== Boolean(value.custom_direction), {
    message: 'Provide exactly one of choice_id or custom_direction',
  })
export type ChooseRequest = z.infer<typeof ChooseRequestSchema>

export const CreateVideoRequestSchema = z.object({
  branch_id: z.string().uuid().optional(),
  regenerate: z.boolean().optional().default(false),
  idempotency_key: z.string().uuid().optional(),
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
  cover_url: z.string().nullable(),
  cover_kind: z.enum(['real', 'placeholder']),
  media_type: z.string().nullable(),
  error: z.string().nullable(),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  content_version_id: z.string().uuid().nullable().optional(),
  is_selected: z.boolean().optional(),
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
  video_history: z.array(VideoTaskResponseSchema).optional(),
  content_version_id: z.string().uuid().optional(),
  content_version: z.number().int().positive().optional(),
  branch_status: z.enum(['normal', 'stale']).optional(),
  stale_reason_version_id: z.string().uuid().nullable().optional(),
})
export type StoryTurnResponse = z.infer<typeof StoryTurnResponseSchema>

export const SelectionResponseSchema = z.object({
  id: z.string().uuid(),
  turn_id: z.string().uuid(),
  branch_id: z.string().uuid().optional(),
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
  provider_modes: z
    .object({ story: ProviderModeSchema, video: ProviderModeSchema })
    .optional(),
  current_branch_id: z.string().uuid().optional(),
  branches: z
    .array(
      z.object({
        id: z.string().uuid(),
        story_id: z.string().uuid(),
        name: z.string(),
        forked_from_branch_id: z.string().uuid().nullable(),
        forked_at_turn_id: z.string().uuid().nullable(),
        head_turn_id: z.string().uuid(),
        path_turn_ids: z.array(z.string().uuid()),
        created_at: z.string(),
        updated_at: z.string(),
      }),
    )
    .optional(),
  tree_turns: z.array(StoryTurnResponseSchema).optional(),
  turns: z.array(StoryTurnResponseSchema).min(1),
  selections: z.array(SelectionResponseSchema),
})
export type StoryResponse = z.infer<typeof StoryResponseSchema>

export const StoryListItemSchema = z.object({
  id: z.string().uuid(),
  draft_number: z.number().int().positive(),
  name: z.string(),
  title: z.string(),
  original_idea: z.string(),
  current_branch_id: z.string().uuid(),
  current_turn_id: z.string().uuid(),
  cover_url: z.string().nullable(),
  cover_kind: z.enum(['real', 'mock', 'placeholder']),
  created_at: z.string(),
  updated_at: z.string(),
})
export type StoryListItem = z.infer<typeof StoryListItemSchema>

export const StoryListResponseSchema = z.object({
  items: z.array(StoryListItemSchema),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  total_pages: z.number().int().nonnegative(),
})
export type StoryListResponse = z.infer<typeof StoryListResponseSchema>

export const BranchRequestSchema = z.object({
  source_branch_id: z.string().uuid(),
  from_turn_id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
})
export type BranchRequest = z.infer<typeof BranchRequestSchema>

export const RenameBranchRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
})

export const SelectVersionRequestSchema = z
  .object({
    content_version_id: z.string().uuid().optional(),
    video_task_id: z.string().uuid().nullable().optional(),
  })
  .refine(
    (value) => value.content_version_id !== undefined || value.video_task_id !== undefined,
    { message: 'Select a content version or video task' },
  )

export const KeyValueSchema = z.string().trim().min(12).max(512).regex(/^[\x21-\x7e]+$/, {
  message: 'API keys must contain only visible ASCII characters',
})
export const UpdateKeysRequestSchema = z.object({
  qwen_api_key: z.union([KeyValueSchema, z.literal(''), z.null()]).optional(),
  wan_api_key: z.union([KeyValueSchema, z.literal(''), z.null()]).optional(),
})
export type UpdateKeysRequest = z.infer<typeof UpdateKeysRequestSchema>

const KeyStatusSchema = z.object({
  configured: z.boolean(),
  source: z.enum(['temporary', 'environment', 'legacy', 'missing']),
  temporary: z.boolean(),
  mode: ProviderModeSchema,
})
export const KeysStatusResponseSchema = z.object({
  qwen: KeyStatusSchema,
  wan: KeyStatusSchema,
})
export type KeysStatusResponse = z.infer<typeof KeysStatusResponseSchema>

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  provider_mode: ProviderModeSchema,
  provider_modes: z.object({ story: ProviderModeSchema, video: ProviderModeSchema }).optional(),
  api_version: z.string(),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>
