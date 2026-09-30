import assert from 'node:assert/strict'
import test from 'node:test'
import { currentBranchPath } from './branchPath'

const turns = [
  { id: 'root', title: 'Root' },
  { id: 'main', title: 'Main only' },
  { id: 'branch-a', title: 'Branch A only' },
  { id: 'branch-b', title: 'Branch B only' },
]
const branches = [
  { id: 'main-branch', pathTurnIds: ['root', 'main'] },
  { id: 'branch-a-path', pathTurnIds: ['root', 'branch-a'] },
  { id: 'branch-b-path', pathTurnIds: ['root', 'branch-b'] },
]

test('current branch path includes ancestry and excludes sibling-only turns', () => {
  assert.deepEqual(
    currentBranchPath(turns, branches, 'main-branch').map((turn) => turn.id),
    ['root', 'main'],
  )
  assert.deepEqual(
    currentBranchPath(turns, branches, 'branch-a-path').map((turn) => turn.id),
    ['root', 'branch-a'],
  )
  assert.deepEqual(
    currentBranchPath(turns, branches, 'branch-b-path').map((turn) => turn.id),
    ['root', 'branch-b'],
  )
})
