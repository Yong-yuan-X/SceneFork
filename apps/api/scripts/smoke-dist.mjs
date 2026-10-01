import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const apiDirectory = path.resolve(scriptDirectory, '..')
const projectRoot = path.resolve(apiDirectory, '..', '..')
const distEntryPoint = path.join(apiDirectory, 'dist', 'index.js')
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'scenefork-api-smoke-'))
const port = await findAvailablePort()
const output = []

const child = spawn(process.execPath, [distEntryPoint], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    SCENEFORK_PROVIDER_MODE: 'mock',
    QWEN_PROVIDER_MODE: 'mock',
    WAN_PROVIDER_MODE: 'mock',
    API_HOST: '127.0.0.1',
    API_PORT: String(port),
    WEB_ORIGIN: 'http://127.0.0.1:5173',
    DATABASE_URL: path.join(temporaryDirectory, 'scenefork.db'),
    MEDIA_DIR: path.join(temporaryDirectory, 'media'),
    DASHSCOPE_API_KEY: '',
    QWEN_API_KEY: '',
    WAN_API_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

child.stdout.on('data', (chunk) => output.push(chunk.toString()))
child.stderr.on('data', (chunk) => output.push(chunk.toString()))

try {
  const health = await waitForHealth(child, port)
  if (
    health.status !== 'ok' ||
    health.provider_modes?.story !== 'mock' ||
    health.provider_modes?.video !== 'mock'
  ) {
    throw new Error(`Unexpected health response: ${JSON.stringify(health)}`)
  }
  console.info(`[smoke_api_dist] Production API health check passed port=${port} provider=mock`)
} catch (error) {
  const processOutput = output.join('').trim()
  if (processOutput) {
    for (const line of processOutput.split(/\r?\n/)) {
      console.error(`[smoke_api_dist] api_output=${line}`)
    }
  }
  console.error(
    `[smoke_api_dist] Smoke test failed: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exitPromise = once(child, 'exit')
    child.kill()
    await exitPromise
  }
  await rm(temporaryDirectory, { recursive: true, force: true })
}

async function waitForHealth(processHandle, apiPort) {
  const deadline = Date.now() + 15_000
  const url = `http://127.0.0.1:${apiPort}/api/health`

  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) {
      throw new Error(`API exited before becoming healthy with code ${processHandle.exitCode}`)
    }

    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return await response.json()
    } catch {
      // The process may still be starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error('API did not become healthy within 15 seconds')
}

async function findAvailablePort() {
  const server = createServer()
  server.unref()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Could not allocate a local smoke-test port')
  }
  const availablePort = address.port
  server.close()
  await once(server, 'close')
  return availablePort
}
