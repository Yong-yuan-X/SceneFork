export function currentBranchPath<Turn extends { id: string }>(
  turns: Turn[],
  branches: Array<{ id: string; pathTurnIds: string[] }>,
  currentBranchId: string | null,
): Turn[] {
  const branch = branches.find((item) => item.id === currentBranchId)
  if (!branch) return []
  const byId = new Map(turns.map((turn) => [turn.id, turn]))
  return branch.pathTurnIds
    .map((turnId) => byId.get(turnId))
    .filter((turn): turn is Turn => Boolean(turn))
}
