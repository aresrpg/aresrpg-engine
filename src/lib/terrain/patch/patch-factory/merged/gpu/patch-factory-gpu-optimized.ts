import { AsyncTask } from '../../../../../helpers/async-task';
import * as THREE from '../../../../../three-usage';
import { type GeometryAndMaterial, type LocalMapData } from '../../patch-factory-base';

import { PatchFactoryGpu } from './patch-factory-gpu';

type PatchGenerationJob = {
    readonly patchId: number;
    cpuTask: AsyncTask<LocalMapData>;
    gpuTask?: Promise<GeometryAndMaterial[]>;
    readonly resolve: (value: GeometryAndMaterial[] | PromiseLike<GeometryAndMaterial[]>) => void;
};

class PatchFactoryGpuOptimized extends PatchFactoryGpu {
    private nextPatchId = 0;

    private readonly pendingJobs: PatchGenerationJob[] = [];

    protected computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
        const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
        const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;
        if (voxelsCountPerPatch <= 0) {
            return Promise.resolve([]);
        }

        return new Promise<GeometryAndMaterial[]>(resolve => {
            const patchId = this.nextPatchId++;
            // logger.diagnostic(`Asking for patch ${patchId}`);

            this.pendingJobs.push({
                patchId,
                cpuTask: new AsyncTask<LocalMapData>(async () => {
                    // logger.diagnostic(`CPU ${patchId} start`);
                    const result = await this.buildLocalMapData(patchStart, patchEnd);
                    // logger.diagnostic(`CPU ${patchId} end`);
                    return result;
                }),
                resolve,
            });

            this.runNextTask();
        });
    }

    private runNextTask(): void {
        const currentJob = this.pendingJobs[0];
        const runNextTask = () => {
            this.runNextTask();
        };

        if (currentJob) {
            if (!currentJob.cpuTask.isStarted) {
                currentJob.cpuTask.start();
                currentJob.cpuTask.awaitResult().then(runNextTask);
            } else if (currentJob.cpuTask.isFinished) {
                if (!currentJob.gpuTask) {
                    const localMapData = currentJob.cpuTask.getResultSync();

                    if (localMapData.isEmpty) {
                        currentJob.gpuTask = Promise.resolve([]);
                    } else {
                        currentJob.gpuTask = (async () => {
                            // logger.diagnostic(`GPU ${currentJob.patchId} start`);
                            const patchComputerGpu = await this.getPatchComputerGpu();
                            const gpuTaskOutput = await patchComputerGpu.computeBuffer(localMapData);
                            // logger.diagnostic(`GPU ${currentJob.patchId} end`);

                            return this.assembleGeometryAndMaterials(gpuTaskOutput);
                        })();
                    }

                    currentJob.gpuTask.then(result => {
                        this.pendingJobs.shift();
                        currentJob.resolve(result);
                        this.runNextTask();
                    });
                }

                const nextJob = this.pendingJobs[1];
                if (nextJob) {
                    if (!nextJob.cpuTask.isStarted) {
                        nextJob.cpuTask.start();
                        nextJob.cpuTask.awaitResult().then(runNextTask);
                    }
                }
            }
        }
    }
}

export { PatchFactoryGpuOptimized };
