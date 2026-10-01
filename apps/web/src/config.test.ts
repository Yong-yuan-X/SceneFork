import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveApiBaseUrl } from './services/apiBaseUrl.js'

test('API base URL defaults to localhost during Vite development', () => {
  assert.equal(
    resolveApiBaseUrl(undefined, 'http://127.0.0.1:3000'),
    'http://127.0.0.1:3000',
  )
})

test('API base URL defaults to same-origin for a production build', () => {
  assert.equal(resolveApiBaseUrl(undefined, ''), '')
  assert.equal(resolveApiBaseUrl('  /  ', ''), '')
  assert.equal(
    resolveApiBaseUrl('https://api.example.test/', ''),
    'https://api.example.test',
  )
})
