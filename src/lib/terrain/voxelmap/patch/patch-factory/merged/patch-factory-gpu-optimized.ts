import { type AsyncTask } from '../../../../../helpers/async/async-task';
import { type MaterialsStore } from '../../../../materials-store';
import { type VoxelsChunkOrdering, type VoxelsChunkSize } from '../../../i-voxelmap';
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
