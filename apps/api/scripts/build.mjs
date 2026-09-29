import { build } from 'esbuild'

try {
  await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    outdir: 'dist',
    sourcemap: true,
    target: 'node20',
  })
  console.info('[build_api] API bundle created')
} catch (error) {
  console.error(`[build_api] Build failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
