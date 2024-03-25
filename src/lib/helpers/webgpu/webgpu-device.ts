/// <reference types="@webgpu/types" />

import { logger } from '../logger';

let devicePromise: Promise<GPUDevice> | null = null;

async function getGpuDevice(): Promise<GPUDevice> {
    if (!devicePromise) {
        const gpu: GPU = navigator.gpu;
        if (!gpu) {
            throw new Error('Your browser does not seem to support WebGPU.');
        }

        const adapter = await gpu.requestAdapter({
            powerPreference: 'high-performance',
        });

        if (!adapter) {
            throw new Error('Request for GPU adapter failed.');
        }

        if (adapter.isFallbackAdapter) {
            logger.warn('The retrieved GPU adapter is fallback. The performance might be degraded.');
        }

        devicePromise = adapter.requestDevice();
    }
    const device = await devicePromise;
    return device;
}

export { getGpuDevice };
