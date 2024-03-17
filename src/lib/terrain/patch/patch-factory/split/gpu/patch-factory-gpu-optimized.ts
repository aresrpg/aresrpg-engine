import { type IVoxelMap } from '../../../../i-voxel-map';
import { EPatchComputingMode, type GeometryAndMaterial } from '../../patch-factory-base';
import * as THREE from '../../../../../three-usage';

import { PatchFactoryGpu } from './patch-factory-gpu';

type PatchGenerationState = {
    cpuFinished?: Promise<unknown>;
    gpuFinished?: Promise<unknown>;
};

class PatchFactoryGpuOptimized extends PatchFactoryGpu {
    private nextPatchGenerationId = 0;
    private readonly patchGenerationPromises: Record<number, PatchGenerationState> = {};

    public constructor(map: IVoxelMap) {
        super(map, EPatchComputingMode.GPU_OPTIMIZED);
    }

    protected async computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
        const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;
        if (voxelsCountPerPatch <= 0) {
            return [];
        }

        const patchGenerationId = this.nextPatchGenerationId++;
        // console.log(`Asking for patch ${patchGenerationId}`);
        this.patchGenerationPromises[patchGenerationId] = {};
        const patchPromises = this.patchGenerationPromises[patchGenerationId]!;

        const cpuStartPrerequisites = new Promise<void>(resolve => {
            if (patchGenerationId === 0) {
                resolve();
            } else if (patchGenerationId === 1) {
                const attemptToResolve = () => {
                    const previousPatchPromises = this.patchGenerationPromises[patchGenerationId - 1];
                    if (previousPatchPromises?.cpuFinished) {
                        previousPatchPromises.cpuFinished.then(() => resolve());
                    } else {
                        setTimeout(attemptToResolve, 1); // retry later
                    }
                };
                attemptToResolve();
            } else {
                const attemptToResolve = () => {
                    const previousPatchPromises = this.patchGenerationPromises[patchGenerationId - 1];
                    const previousPreviousPatchPromises = this.patchGenerationPromises[patchGenerationId - 2];
                    if (previousPatchPromises?.cpuFinished && previousPreviousPatchPromises?.gpuFinished) {
                        Promise.all([previousPatchPromises.cpuFinished, previousPreviousPatchPromises.gpuFinished]).then(() => resolve());
                    } else {
                        setTimeout(attemptToResolve, 1); // retry later
                    }
                };
                attemptToResolve();
            }
        });
        await cpuStartPrerequisites;

        // console.log(`CPU ${patchGenerationId} start`);
        const localMapCache = this.buildLocalMapCache(patchStart, patchEnd);
        // console.log(`CPU ${patchGenerationId} end`);

        const gpuStartPrerequisites = new Promise<void>(resolve => {
            if (patchGenerationId === 0) {
                resolve();
            } else {
                const attemptToResolve = () => {
                    const previousPatchPromises = this.patchGenerationPromises[patchGenerationId - 1];
                    if (previousPatchPromises?.gpuFinished) {
                        previousPatchPromises.gpuFinished.then(() => resolve());
                    } else {
                        setTimeout(attemptToResolve, 0); // retry later
                    }
                };
                attemptToResolve();
            }
        });
        await gpuStartPrerequisites;

        const patchComputerGpu = await this.getPatchComputerGpu();
        const computeBuffersPromise = patchComputerGpu.computeBuffers(localMapCache);
        if (!patchComputerGpu) {
            throw new Error('Could not get WebGPU patch computer');
        }
        patchPromises.cpuFinished = Promise.resolve();
        patchPromises.gpuFinished = computeBuffersPromise;
        // console.log(`GPU ${patchGenerationId} start`);
        const buffers = await computeBuffersPromise;
        // console.log(`GPU ${patchGenerationId} end`);

        return this.assembleGeometryAndMaterials(buffers);
    }
}

export { PatchFactoryGpuOptimized };
