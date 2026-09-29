import type { StoryResponse } from '@scenefork/shared'

export function buildOpeningUserPrompt(idea: string, style?: string): string {
  return [
    'Create the first current story turn from this original idea.',
    `Original idea: ${idea}`,
    style ? `Requested style: ${style}` : 'Requested style: infer a coherent cinematic style.',
    'Output JSON only.',
  ].join('\n')
}

export function buildContinuationUserPrompt(story: StoryResponse, userDirection: string): string {
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
    'Output JSON only.',
  ].join('\n')
}
