import { createHash } from 'node:crypto'
import type { AppConfig } from '../../../../config.js'

export type CredentialModel = 'qwen' | 'wan'
export type CredentialSource = 'temporary' | 'environment' | 'legacy' | 'missing'

export interface EffectiveCredential {
  key: string
  source: CredentialSource
  fingerprint: string | null
  mode: 'mock' | 'real'
}

export class CredentialService {
  private readonly overrides: Partial<Record<CredentialModel, string>> = {}

  constructor(private readonly config: AppConfig) {}

  get(model: CredentialModel): EffectiveCredential {
    const override = this.overrides[model]
    const modelKey = model === 'qwen' ? this.config.qwenApiKey : this.config.wanApiKey
    const requestedMode =
      model === 'qwen'
        ? (this.config.qwenProviderMode ?? this.config.providerMode)
        : (this.config.wanProviderMode ?? this.config.providerMode)
    const key = override || modelKey || this.config.dashscopeApiKey || ''
    const endpointConfigured = model === 'qwen'
      ? Boolean(this.config.qwenBaseUrl)
      : Boolean(this.config.wanBaseUrl)
    const source: CredentialSource = override
      ? 'temporary'
      : modelKey
        ? 'environment'
        : this.config.dashscopeApiKey
          ? 'legacy'
          : 'missing'

    return {
      key,
      source,
      fingerprint: key ? fingerprint(key) : null,
      mode: requestedMode === 'real' && Boolean(key) && endpointConfigured ? 'real' : 'mock',
    }
  }

  status() {
    return {
      qwen: publicStatus(this.get('qwen')),
      wan: publicStatus(this.get('wan')),
    }
  }

  update(input: { qwen_api_key?: string | null; wan_api_key?: string | null }) {
    this.updateOne('qwen', input.qwen_api_key)
    this.updateOne('wan', input.wan_api_key)
    return this.status()
  }

  private updateOne(model: CredentialModel, value: string | null | undefined) {
    if (value === undefined) return
    if (value === null || value === '') {
      delete this.overrides[model]
      return
    }
    this.overrides[model] = value
  }
}

function publicStatus(credential: EffectiveCredential) {
  return {
    configured: Boolean(credential.key),
    source: credential.source,
    temporary: credential.source === 'temporary',
    mode: credential.mode,
  }
}

function fingerprint(key: string) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}
