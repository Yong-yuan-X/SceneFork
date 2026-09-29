import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWanParameters } from './video-provider.js'

test('Wan 2.2 request omits unsupported duration and shot_type parameters', () => {
  assert.deepEqual(
    buildWanParameters({
      wanModel: 'wan2.2-t2v-plus',
      wanVideoSize: '832*480',
      wanVideoDuration: 5,
    }),
    {
      size: '832*480',
      prompt_extend: true,
      watermark: false,
    },
  )
})

test('Wan 2.6 request includes configurable duration and single-shot mode', () => {
  assert.deepEqual(
    buildWanParameters({
      wanModel: 'wan2.6-t2v',
      wanVideoSize: '1280*720',
      wanVideoDuration: 5,
    }),
    {
      size: '1280*720',
      duration: 5,
      prompt_extend: true,
      shot_type: 'single',
      watermark: false,
    },
  )
})
