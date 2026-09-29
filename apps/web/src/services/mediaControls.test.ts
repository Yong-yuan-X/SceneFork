import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isElementFullscreen,
  normalizeVolumePercent,
  setMediaVolume,
  toggleElementFullscreen,
  toggleMediaMute,
} from './mediaControls.js'

test('volume control clamps values and controls the media element', () => {
  const media = { volume: 1, muted: false }

  assert.equal(normalizeVolumePercent(42.4), 42)
  assert.equal(normalizeVolumePercent(-5), 0)
  assert.equal(normalizeVolumePercent(130), 100)

  assert.deepEqual(setMediaVolume(media, 35), { volumePercent: 35, muted: false })
  assert.equal(media.volume, 0.35)
  assert.equal(media.muted, false)

  assert.deepEqual(setMediaVolume(media, 0), { volumePercent: 0, muted: true })
  assert.equal(media.volume, 0)
  assert.equal(media.muted, true)
})

test('mute toggles actual media state and restores the last audible volume', () => {
  const media = { volume: 0.6, muted: false }

  assert.deepEqual(toggleMediaMute(media, 60), { volumePercent: 60, muted: true })
  assert.equal(media.muted, true)

  assert.deepEqual(toggleMediaMute(media, 60), { volumePercent: 60, muted: false })
  assert.equal(media.muted, false)

  media.volume = 0
  assert.deepEqual(toggleMediaMute(media, 40), { volumePercent: 40, muted: false })
  assert.equal(media.volume, 0.4)
})

test('fullscreen control enters, exits, and reflects an external Esc exit', async () => {
  const fullscreenDocument = {
    fullscreenElement: null as unknown,
    async exitFullscreen() {
      this.fullscreenElement = null
    },
  }
  const target = {
    async requestFullscreen() {
      fullscreenDocument.fullscreenElement = target
    },
  }

  assert.equal(isElementFullscreen(target, fullscreenDocument), false)
  await toggleElementFullscreen(target, fullscreenDocument)
  assert.equal(isElementFullscreen(target, fullscreenDocument), true)

  await toggleElementFullscreen(target, fullscreenDocument)
  assert.equal(isElementFullscreen(target, fullscreenDocument), false)

  fullscreenDocument.fullscreenElement = target
  fullscreenDocument.fullscreenElement = null
  assert.equal(isElementFullscreen(target, fullscreenDocument), false)
})

test('fullscreen control reports unsupported browser APIs', async () => {
  await assert.rejects(
    toggleElementFullscreen({}, { fullscreenElement: null }),
    /Fullscreen is not supported/,
  )
})
