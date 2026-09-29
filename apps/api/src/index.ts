import { appConfig } from '../../../config.js'
import { buildServer } from './server.js'

async function start() {
  const { app } = await buildServer()
  await app.listen({ host: appConfig.host, port: appConfig.port })
  console.info(
    `[api] SceneFork API listening on http://${appConfig.host}:${appConfig.port} provider=${appConfig.providerMode} story_model=${appConfig.qwenModel} video_model=${appConfig.wanModel} qwen_timeout_ms=${appConfig.qwenRequestTimeoutMs} provider_timeout_ms=${appConfig.providerRequestTimeoutMs}`,
  )
}

start().catch((error: unknown) => {
  console.error(`[api] Startup failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
