import * as THREE from '../../../../../three-usage';
import { type IVoxelMap } from '../../../../i-voxel-map';
import { EPatchComputingMode, type GeometryAndMaterial, type LocalMapCache } from '../../patch-factory-base';

import { PatchFactoryGpu } from './patch-factory-gpu';

type PatchGenerationJob = {
    readonly patchId: number;
    cpuTask: () => LocalMapCache;
    cpuTaskOutput?: LocalMapCache;
    gpuTaskPromise?: Promise<void>;
    readonly resolve: (value: GeometryAndMaterial[] | PromiseLike<GeometryAndMaterial[]>) => void;
};

class PatchFactoryGpuOptimized extends PatchFactoryGpu {
    private nextPatchId = 0;

    private readonly pendingJobs: PatchGenerationJob[] = [];

    public constructor(map: IVoxelMap) {
        super(map, EPatchComputingMode.GPU_OPTIMIZED);
    }

    protected computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
        const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;
        if (voxelsCountPerPatch <= 0) {
            return Promise.resolve([]);
        }

        return new Promise<GeometryAndMaterial[]>(resolve => {
            const patchId = this.nextPatchId++;
            // console.log(`Asking for patch ${patchId}`);

            this.pendingJobs.push({
                patchId,
                cpuTask: () => {
                    // console.log(`CPU ${patchId} start`);
                    const result = this.buildLocalMapCache(patchStart, patchEnd);
                    // console.log(`CPU ${patchId} end`);
                    return result;
                },
                resolve,
            });

            this.runNextTask();
        });
    }

    private runNextTask(): void {
        const currentJob = this.pendingJobs[0];

        if (currentJob) {
            if (!currentJob.cpuTaskOutput) {
                currentJob.cpuTaskOutput = currentJob.cpuTask();
            }

            if (!currentJob.gpuTaskPromise) {
                const localMapCache = currentJob.cpuTaskOutput;

                currentJob.gpuTaskPromise = (async () => {
                    // console.log(`GPU ${currentJob.patchId} start`);
                    const patchComputerGpu = await this.getPatchComputerGpu();
                    const gpuTaskOutput = await patchComputerGpu.computeBuffers(localMapCache);
                    // console.log(`GPU ${currentJob.patchId} end`);

                    const result = this.assembleGeometryAndMaterials(gpuTaskOutput);
                    currentJob.resolve(result);
                    this.pendingJobs.shift();
                    this.runNextTask();
                })();
            }

            const nextJob = this.pendingJobs[1];
            if (nextJob) {
                if (!nextJob.cpuTaskOutput) {
                    nextJob.cpuTaskOutput = nextJob.cpuTask();
                }
            }
        }
    }
}

export { PatchFactoryGpuOptimized };
