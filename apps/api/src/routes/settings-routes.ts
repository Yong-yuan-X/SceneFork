import { UpdateKeysRequestSchema } from '@scenefork/shared'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AppConfig } from '../../../../config.js'
import type { CredentialService } from '../services/credential-service.js'
import { AppError } from '../errors.js'
import type { Repository } from '../db/repository.js'

export function registerSettingsRoutes(
  app: FastifyInstance,
  config: AppConfig,
  credentials: CredentialService,
  repository: Repository,
) {
  const protect = async (request: FastifyRequest) => {
    const origin = firstHeader(request.headers.origin)
    const expectedOrigin = config.webOrigin ?? 'http://127.0.0.1:5173'
    const hasSettingsHeader = firstHeader(request.headers['x-scenefork-settings']) === '1'
    const originAllowed = origin === expectedOrigin
    const sameOriginProxyAllowed = !origin && isSameOriginProxyRequest(request, expectedOrigin)
    if (!hasSettingsHeader || (!originAllowed && !sameOriginProxyAllowed)) {
      throw new AppError(
        'Settings access is restricted to the configured SceneFork UI',
        403,
        'SETTINGS_ACCESS_DENIED',
      )
    }
  }

  app.get('/api/settings/keys', { preHandler: protect }, async () => credentials.status())
  app.put('/api/settings/keys', { preHandler: protect }, async (request) => {
    const input = UpdateKeysRequestSchema.parse(request.body ?? {})
    const status = credentials.update(input)
    const resumed = repository.resumeTasksWithCredential(credentials.get('wan').fingerprint)
    console.info(`[settings_route] Temporary API key overrides updated resumed_tasks=${resumed}`)
    return status
  })
}

function isSameOriginProxyRequest(request: FastifyRequest, expectedOrigin: string): boolean {
  const proxyMarker = firstHeader(request.headers['x-scenefork-proxy'])
  const forwardedHost = firstHeader(request.headers['x-forwarded-host'])
  if (proxyMarker !== 'nginx' || !forwardedHost) return false
  return forwardedHost.trim().toLowerCase() === new URL(expectedOrigin).host.toLowerCase()
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
