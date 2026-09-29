export type WorkspacePhase = 'empty' | 'story-generating' | 'story-ready'

export type VideoStatus =
  | 'idle'
  | 'submitting'
  | 'queued'
  | 'running'
  | 'saving'
  | 'succeeded'
  | 'failed'
  | 'submission_unknown'

export interface StoryChoice {
  id: string
  label: string
  direction: string
}

export interface StoryTurn {
  id: string
  title: string
  storyText: string
  summary: string
  videoPrompt: string
  choices: StoryChoice[]
  duration: number
  imageVariant: number
}

export interface ChatMessage {
  id: string
  sender: 'assistant' | 'user' | 'system'
  body: string
  time: string
}

export interface VideoTask {
  taskId: string | null
  status: VideoStatus
  startedAt: number | null
  updatedAt: number | null
  outcome: 'success' | 'failure' | 'unknown'
  error: string | null
}

export interface ActivityItem {
  id: string
  label: string
  detail: string
  time: string
  tone: 'neutral' | 'active' | 'success' | 'danger'
}

export interface PersistedWorkspace {
  phase: WorkspacePhase
  idea: string
  activeTurnId: string | null
  turns: StoryTurn[]
  messages: ChatMessage[]
  videoTask: VideoTask
  activity: ActivityItem[]
  selectedChoiceId: string | null
}
