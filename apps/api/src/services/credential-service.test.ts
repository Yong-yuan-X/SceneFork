import assert from 'node:assert/strict'
import test from 'node:test'
import type { AppConfig } from '../../../../config.js'
import { CredentialService } from './credential-service.js'

test('model keys override the legacy key and temporary keys clear back to environment', () => {
  const credentials = new CredentialService({
    nodeEnv: 'test',
    providerMode: 'real',
    host: '127.0.0.1',
    port: 3000,
    dashscopeApiKey: 'legacy-shared-key-value',
    qwenApiKey: 'qwen-environment-key-value',
    wanApiKey: '',
    qwenProviderMode: 'real',
    wanProviderMode: 'real',
    qwenModel: 'qwen3.7-flash',
    wanModel: 'wan2.6-t2v',
    qwenBaseUrl: 'https://example.test/compatible-mode/v1',
    wanBaseUrl: 'https://example.test/api/v1',
    databasePath: ':memory:',
    mediaDir: '.',
    wanVideoSize: '1280*720',
    wanVideoDuration: 5,
    wanProviderPollMs: 1000,
    providerRequestTimeoutMs: 1000,
    qwenRequestTimeoutMs: 1000,
    qwenMaxRetries: 0,
  } satisfies AppConfig)

  assert.equal(credentials.get('qwen').source, 'environment')
  assert.equal(credentials.get('qwen').key, 'qwen-environment-key-value')
  assert.equal(credentials.get('wan').source, 'legacy')
  assert.equal(credentials.get('wan').key, 'legacy-shared-key-value')

  credentials.update({ qwen_api_key: 'qwen-temporary-key-value', wan_api_key: 'wan-temporary-key-value' })
  assert.equal(credentials.get('qwen').source, 'temporary')
  assert.equal(credentials.get('wan').source, 'temporary')
  assert.notEqual(credentials.get('qwen').fingerprint, credentials.get('wan').fingerprint)

  credentials.update({ qwen_api_key: null, wan_api_key: null })
  assert.equal(credentials.get('qwen').source, 'environment')
  assert.equal(credentials.get('wan').source, 'legacy')
})

test('real mode safely falls back to mock without a key or endpoint', () => {
  const base = {
    nodeEnv: 'test' as const,
    providerMode: 'real' as const,
    host: '127.0.0.1',
    port: 3000,
    dashscopeApiKey: '',
    qwenProviderMode: 'real' as const,
    wanProviderMode: 'real' as const,
    qwenModel: 'qwen3.7-flash',
    wanModel: 'wan2.6-t2v',
    qwenBaseUrl: '',
    wanBaseUrl: '',
    databasePath: ':memory:',
    mediaDir: '.',
    wanVideoSize: '1280*720',
    wanVideoDuration: 5,
    wanProviderPollMs: 1000,
    providerRequestTimeoutMs: 1000,
    qwenRequestTimeoutMs: 1000,
    qwenMaxRetries: 0,
  } satisfies AppConfig
  const credentials = new CredentialService(base)
  assert.equal(credentials.get('qwen').mode, 'mock')
  credentials.update({ qwen_api_key: 'temporary-key-with-no-url' })
  assert.equal(credentials.get('qwen').mode, 'mock')
})
