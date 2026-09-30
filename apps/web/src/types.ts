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
  storyId: string | null
  parentTurnId: string | null
  title: string
  storyText: string
  savedStoryText?: string
  summary: string
  videoPrompt: string
  savedVideoPrompt?: string
  choices: StoryChoice[]
  duration: number
  imageVariant: number
  createdAt: string
  videoTask: VideoTask
  contentVersionId?: string
  contentVersion?: number
  branchStatus?: 'normal' | 'stale'
  staleReasonVersionId?: string | null
  videoHistory?: VideoTask[]
}

export interface StoryBranch {
  id: string
  name: string
  forkedFromBranchId: string | null
  forkedAtTurnId: string | null
  headTurnId: string
  pathTurnIds: string[]
}

export interface ChatMessage {
  id: string
  sender: 'assistant' | 'user' | 'system'
  body: string
  time: string
}

export interface VideoTask {
  id: string | null
  version: number
  taskId: string | null
  providerStatus: string | null
  status: VideoStatus
  startedAt: number | null
  updatedAt: number | null
  outcome: 'success' | 'failure' | 'unknown'
  videoUrl: string | null
  coverUrl: string | null
  coverKind: 'real' | 'placeholder'
  mediaType: string | null
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
  storyId: string | null
  currentTurnId: string | null
  currentBranchId?: string | null
  providerMode: 'local' | 'mock' | 'real'
  videoProviderMode?: 'local' | 'mock' | 'real'
  phase: WorkspacePhase
  idea: string
  activeTurnId: string | null
  turns: StoryTurn[]
  treeTurns?: StoryTurn[]
  messages: ChatMessage[]
  activity: ActivityItem[]
  selectedChoiceId: string | null
  branches?: StoryBranch[]
}
