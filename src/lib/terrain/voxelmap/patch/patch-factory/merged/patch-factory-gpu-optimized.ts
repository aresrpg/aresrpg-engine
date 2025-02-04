import { AsyncTask } from '../../../../../helpers/async/async-task';
import * as THREE from '../../../../../libs/three-usage';
import { type MaterialsStore } from '../../../../materials-store';
import { type IVoxelMap, type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../../i-voxelmap';
import { type VoxelsRenderable } from '../../../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryGpu } from '../../../voxelsRenderable/voxelsRenderableFactory/merged/gpu/voxels-renderable-factory-gpu';
import {
    type CheckerboardType,
    type GeometryAndMaterial,
    type VoxelsChunkData,
} from '../../../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';
import { PatchFactoryBase } from '../patch-factory-base';

type PatchGenerationJob = {
    readonly patchId: number;
    cpuTask: AsyncTask<VoxelsChunkData>;
    gpuTask?: Promise<GeometryAndMaterial[]>;
    readonly resolve: (value: GeometryAndMaterial[]) => void;
};

type Parameters = {
    readonly voxelMaterialsStore: MaterialsStore;
    readonly patchSize: VoxelsChunkSize;
    readonly checkerboardType?: CheckerboardType;
    readonly voxelsChunkOrdering: VoxelsChunkOrdering;
};

class PatchFactoryGpuOptimized extends PatchFactoryBase {
    private nextPatchId = 0;

    private readonly pendingJobs: PatchGenerationJob[] = [];

    public constructor(params: Parameters) {
        const voxelsRenderableFactory = new VoxelsRenderableFactoryGpu({
            voxelMaterialsStore: params.voxelMaterialsStore,
            voxelsChunkSize: params.patchSize,
            checkerboardType: params.checkerboardType,
            voxelsChunkOrdering: params.voxelsChunkOrdering,
        });
        super(voxelsRenderableFactory);
    }

    protected override queryMapAndBuildVoxelsRenderable(
        patchStart: THREE.Vector3,
        patchEnd: THREE.Vector3,
        map: IVoxelMap
    ): Promise<VoxelsRenderable | null> {
        const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
        const voxelsCountPerPatch = patchSize.x * patchSize.y * patchSize.z;
        if (voxelsCountPerPatch <= 0) {
            return Promise.resolve(null);
        }

        return new Promise<VoxelsRenderable | null>(resolve => {
            const patchId = this.nextPatchId++;
            // logger.diagnostic(`Asking for patch ${patchId}`);

            const onGeometryAndMaterialsListComputed = (geometryAndMaterialsList: GeometryAndMaterial[]) => {
                const voxelsRenderable = this.voxelsRenderableFactory.assembleVoxelsRenderable(patchSize, geometryAndMaterialsList);
                resolve(voxelsRenderable);
            };

            this.pendingJobs.push({
                patchId,
                cpuTask: new AsyncTask<VoxelsChunkData>(() => {
                    // logger.diagnostic(`CPU ${patchId} start`);
                    // const result = await PatchFactoryBase.buildLocalMapData(patchStart, patchEnd, map);
                    // logger.diagnostic(`CPU ${patchId} end`);
                    return PatchFactoryBase.buildLocalMapData(patchStart, patchEnd, map);
                }),
                resolve: onGeometryAndMaterialsListComputed,
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
                currentJob.cpuTask.start().then(runNextTask);
            } else if (currentJob.cpuTask.isFinished) {
                if (!currentJob.gpuTask) {
                    const localMapData = currentJob.cpuTask.getResultSync();

                    if (localMapData.isEmpty) {
                        currentJob.gpuTask = Promise.resolve([]);
                    } else {
                        currentJob.gpuTask = this.voxelsRenderableFactory.buildGeometryAndMaterials(localMapData);
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
                        nextJob.cpuTask.start().then(runNextTask);
                    }
                }
            }
        }
    }
}

export { PatchFactoryGpuOptimized };
