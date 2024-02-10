import cone_marching_shader from './cone_marching.wgsl?raw'

const TARGET_FPS = 120

/** @typedef {{ adapter: GPUAdapter, device: GPUDevice, context: GPUCanvasContext, pipeline: GPURenderPipeline }} State */

/** @type State */
const state = {
  adapter: null,
  device: null,
  context: null,
  pipeline: null,
}

async function canvas_handler(canvas) {
  if (!('gpu' in navigator)) throw new Error('WebGPU is not supported in your browser.')

  const { gpu } = navigator
  const format = gpu.getPreferredCanvasFormat()

  state.adapter = await gpu.requestAdapter()
  state.device = await state.adapter.requestDevice()
  state.context = canvas.getContext('webgpu')

  state.context.configure({
    device: state.device,
    format,
    alphaMode: 'opaque', // Consider 'premultiplied' based on your needs
  })

  const shader_module = state.device.createShaderModule({
    label: 'Cone marching shader',
    code: cone_marching_shader,
  })

  state.pipeline = state.device.createRenderPipeline({
    label: 'Cone marching pipeline',
    layout: 'auto',
    vertex: {
      module: shader_module,
      entryPoint: 'vertexMain',
      buffers: [],
    },
    fragment: {
      module: shader_module,
      entryPoint: 'fragmentMain',
      targets: [
        {
          format,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back',
    },
  })
}

async function render() {
  const command_encoder = state.device.createCommandEncoder()
  const pass_encoder = command_encoder.beginRenderPass({
    colorAttachments: [
      {
        view: state.context.getCurrentTexture().createView(),
        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  })
  pass_encoder.setPipeline(state.pipeline)
  pass_encoder.draw(3) // Only 3 vertices needed
  pass_encoder.end()

  state.device.queue.submit([command_encoder.finish()])
}

function start_frames() {
  const target_delay = 1000 / TARGET_FPS

  async function frame() {
    const start_time = performance.now()

    // Perform the rendering
    await render()

    const end_time = performance.now()
    const frame_time = end_time - start_time
    const delay = Math.max(target_delay - frame_time, 0) // Ensure delay is not negative

    setTimeout(frame, delay)
  }

  frame()
}

onmessage = async ({ data: { type, payload } }) => {
  switch (type) {
    case 'canvas':
      await canvas_handler(payload)
      start_frames()
      break
  }
}
