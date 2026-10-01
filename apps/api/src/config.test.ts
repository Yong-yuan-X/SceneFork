import assert from 'node:assert/strict'
import test from 'node:test'
import { readConfig } from '../../../config.js'

test('config keeps the localhost development origin and loopback API binding', () => {
  const config = readConfig({
    NODE_ENV: 'development',
    API_HOST: '127.0.0.1',
    WEB_ORIGIN: 'http://127.0.0.1:5173',
  })

  assert.equal(config.host, '127.0.0.1')
  assert.equal(config.webOrigin, 'http://127.0.0.1:5173')
})

test('config accepts an explicitly configured HTTPS production origin', () => {
  const config = readConfig({
    NODE_ENV: 'production',
    API_HOST: '127.0.0.1',
    WEB_ORIGIN: 'https://recruit-demo.trycloudflare.com/',
  })

  assert.equal(config.webOrigin, 'https://recruit-demo.trycloudflare.com')
})

test('config rejects insecure remote origins, URL paths, and public API binding', () => {
  assert.throws(
    () => readConfig({ WEB_ORIGIN: 'http://recruit-demo.trycloudflare.com' }),
    /Non-loopback WEB_ORIGIN must use HTTPS/,
  )
  assert.throws(
    () => readConfig({ WEB_ORIGIN: 'https://recruit-demo.trycloudflare.com/app' }),
    /WEB_ORIGIN must contain only scheme, hostname, and optional port/,
  )
  assert.throws(
    () => readConfig({ API_HOST: '0.0.0.0' }),
    /API_HOST must remain bound to the local machine/,
  )
})
