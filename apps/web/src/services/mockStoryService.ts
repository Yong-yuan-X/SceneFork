const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds))

export async function mockGenerateStory(): Promise<void> {
  await wait(1250)
}

export async function mockContinueStory(): Promise<void> {
  await wait(1100)
}

export function mockTaskStatus(
  startedAt: number,
  outcome: 'success' | 'failure' | 'unknown',
): {
  status: 'submitting' | 'queued' | 'running' | 'saving' | 'succeeded' | 'failed' | 'submission_unknown'
  taskId: string | null
  error: string | null
} {
  const elapsed = Date.now() - startedAt
  if (elapsed < 900) return { status: 'submitting', taskId: null, error: null }
  if (outcome === 'unknown' && elapsed >= 1800) {
    return {
      status: 'submission_unknown',
      taskId: null,
      error: '供应商未确认是否已创建任务。为避免重复计费，Mock 不会自动重试。',
    }
  }

  const taskId = `mock-wan-${startedAt}`
  if (elapsed < 2600) return { status: 'queued', taskId, error: null }
  if (elapsed < 6200) return { status: 'running', taskId, error: null }
  if (outcome === 'failure') {
    return {
      status: 'failed',
      taskId,
      error: 'Mock 渲染节点暂时不可用。你可以手动重试当前片段。',
    }
  }
  if (elapsed < 7600) return { status: 'saving', taskId, error: null }
  return { status: 'succeeded', taskId, error: null }
}
