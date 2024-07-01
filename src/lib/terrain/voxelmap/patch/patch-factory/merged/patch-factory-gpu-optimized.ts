import { AsyncTask } from '../../../../../helpers/async-task';
import * as THREE from '../../../../../three-usage';
import { type IVoxelMap, type VoxelsChunkSize } from '../../../../terrain';
import { VoxelsRenderableFactoryGpu } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/gpu/voxels-renderable-factory-gpu';
import { PatchFactoryBase, type GeometryAndMaterial, type LocalMapData } from '../patch-factory-base';

type PatchGenerationJob = {
    readonly patchId: number;
    cpuTask: AsyncTask<LocalMapData>;
    gpuTask?: Promise<GeometryAndMaterial[]>;
    readonly resolve: (value: GeometryAndMaterial[] | PromiseLike<GeometryAndMaterial[]>) => void;
};

class PatchFactoryGpuOptimized extends PatchFactoryBase {
    private nextPatchId = 0;

    private readonly pendingJobs: PatchGenerationJob[] = [];

    public constructor(map: IVoxelMap, patchSize: VoxelsChunkSize) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryGpu(map.voxelMaterialsList, patchSize);
        super(map, voxelsRenderableFactory);
    }

    protected buildGeometryAndMaterials(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]> {
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

                    currentJob.gpuTask = this.voxelsRenderableFactory.buildGeometryAndMaterials(localMapData);

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
