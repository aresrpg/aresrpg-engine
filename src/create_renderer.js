// @ts-ignore
import webgpu_renderer from './webgpu_renderer.js?url'

export function create_renderer(canvas, renderer) {
  if (!canvas) throw new Error('Missing canvas element.')
  if (!('OffscreenCanvas' in window))
    throw new Error('OffscreenCanvas is not supported in your browser.')

  const offscreen = canvas.transferControlToOffscreen()
  const worker = new Worker(webgpu_renderer, { type: 'module' })

  worker.postMessage({ type: 'canvas', payload: offscreen }, [offscreen])
}
