import type { StoryResponse } from '@scenefork/shared'

export function buildOpeningUserPrompt(
  idea: string,
  style?: string,
  durationSeconds = 5,
): string {
  return [
    'Create the first current story turn from this original idea.',
    `Original idea: ${idea}`,
    style ? `Requested style: ${style}` : 'Requested style: infer a coherent cinematic style.',
    `End video_prompt with the approximate duration exactly as: ${durationSeconds} seconds.`,
    'Output JSON only.',
  ].join('\n')
}

export function buildContinuationUserPrompt(
  story: StoryResponse,
  userDirection: string,
  durationSeconds = 5,
): string {
  const establishedTurns = story.turns
    .map(
      (turn, index) =>
        `Turn ${index + 1} — ${turn.title}\nSummary: ${turn.summary}\nWhat happened: ${turn.story_text}`,
    )
    .join('\n\n')

  return [
    'Continue the story by writing exactly one new current turn.',
    `Original idea: ${story.original_idea}`,
    `Established characters: ${JSON.stringify(story.characters)}`,
    `Established scene: ${JSON.stringify(story.scene)}`,
    'Confirmed story history:',
    establishedTurns,
    `User Direction: ${userDirection}`,
    'Treat only User Direction as the chosen continuation. Do not treat unselected candidate choices as events.',
    `End video_prompt with the approximate duration exactly as: ${durationSeconds} seconds.`,
    'Output JSON only.',
  ].join('\n')
}

export function buildRegenerationUserPrompt(
  story: StoryResponse,
  turnId: string,
  durationSeconds = 5,
): string {
  const turnIndex = story.turns.findIndex((turn) => turn.id === turnId)
  if (turnIndex < 0) throw new Error('The turn is not part of the selected branch path')
  const current = story.turns[turnIndex]!
  const establishedTurns = story.turns
    .slice(0, turnIndex)
    .map(
      (turn, index) =>
        `Turn ${index + 1} — ${turn.title}\nSummary: ${turn.summary}\nWhat happened: ${turn.story_text}`,
    )
    .join('\n\n')
  const selectedDirection = story.selections.find(
    (selection) => selection.next_turn_id === current.id,
  )?.user_direction

  return [
    'Regenerate exactly one alternative content version for the specified existing story turn.',
    'Do not continue to a new turn and do not create or suggest a branch operation.',
    `Original idea: ${story.original_idea}`,
    `Established characters: ${JSON.stringify(story.characters)}`,
    `Established scene: ${JSON.stringify(story.scene)}`,
    establishedTurns ? `Confirmed history before this turn:\n${establishedTurns}` : 'This is the opening turn.',
    selectedDirection ? `Chosen direction that led to this turn: ${selectedDirection}` : '',
    `Current turn title: ${current.title}`,
    `Current turn summary: ${current.summary}`,
    `Current turn text to reinterpret: ${current.story_text}`,
    'Keep the same narrative role and established intent, but write a genuinely new rendering of this turn.',
    `End video_prompt with the approximate duration exactly as: ${durationSeconds} seconds.`,
    'Output JSON only.',
  ].filter(Boolean).join('\n')
}
