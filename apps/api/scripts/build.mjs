import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const sharedEntryPoint = fileURLToPath(
  new URL('../../../packages/shared/src/index.ts', import.meta.url),
)

try {
  const result = await build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    plugins: [
      {
        name: 'bundle-shared-workspace',
        setup(buildContext) {
          buildContext.onResolve({ filter: /^@scenefork\/shared$/ }, () => ({
            path: sharedEntryPoint,
          }))
        },
      },
    ],
    outdir: 'dist',
    sourcemap: true,
    target: 'node20',
    metafile: true,
  })

  const sharedExternalImport = Object.values(result.metafile.outputs)
    .flatMap((output) => output.imports)
    .find((entry) => entry.external && entry.path === '@scenefork/shared')
  if (sharedExternalImport) {
    throw new Error('@scenefork/shared must be bundled into the production API output')
  }

  console.info('[build_api] API bundle created')
} catch (error) {
  console.error(`[build_api] Build failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
