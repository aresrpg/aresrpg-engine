import * as THREE from '../../../three-usage';
import { voxelmapDataPacking, type IVoxelMaterial } from '../i-voxelmap';
import { type VoxelsRenderable } from '../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryCpuWorker } from '../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu-worker';
import { type VoxelsChunkData } from '../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';

import { EPlateauSquareType, type Plateau } from './plateau';

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
};

type PlateauRenderable = {
    readonly container: THREE.Group;
    dispose(): void;
};

class PlateauRenderableFactory extends VoxelsRenderableFactoryCpuWorker {
    public constructor(params: Parameters) {
        super({
            voxelMaterialsList: params.voxelMaterialsList,
            maxVoxelsChunkSize: { xz: 128, y: 16 },
            workersPoolSize: 1,
            isCheckerboardMode: true,
        });
    }

    public async buildPlateauRenderable(plateau: Plateau): Promise<PlateauRenderable> {
        const plateauThickness = 1;
        const voxelsChunkData = this.buildPlateauVoxelsChunkData(plateau, plateauThickness);

        const container = new THREE.Group();
        const voxelsRenderableList: VoxelsRenderable[] = [];

        const result = await super.buildVoxelsRenderable(voxelsChunkData);
        if (result) {
            result.parameters.voxels.noiseStrength = 0.1;
            result.parameters.smoothEdges = {
                enabled: true,
                radius: 0.1,
                quality: 2,
            };
            result.parameters.ao = {
                enabled: true,
                strength: 0.4,
                spread: 0.85,
            };
            result.parameters.shadows = {
                cast: true,
                receive: true,
            };
            result.updateUniforms();
            container.add(result.container);
            voxelsRenderableList.push(result);

            result.container.position.set(plateau.origin.x, plateau.origin.y - plateauThickness, plateau.origin.z);
        }

        return {
            container,
            dispose() {
                for (const voxelsRenderable of voxelsRenderableList) {
                    voxelsRenderable.dispose();
                }
            },
        };
    }

    private buildPlateauVoxelsChunkData(plateau: Plateau, plateauThickness: number): VoxelsChunkData {
        if (!Number.isInteger(plateauThickness) || plateauThickness < 1) {
            throw new Error();
        }

        const chunkSize = new THREE.Vector3(plateau.size.x + 2, 1 + plateauThickness + 1 + 1, plateau.size.z + 2);
        let chunkIsEmpty = true;
        const chunkData = new Uint16Array(chunkSize.x * chunkSize.y * chunkSize.z);
        for (let iChunkZ = 0; iChunkZ < chunkSize.z; iChunkZ++) {
            for (let iChunkX = 0; iChunkX < chunkSize.x; iChunkX++) {
                const plateauX = iChunkX - 1;
                const plateauZ = iChunkZ - 1;
                if (plateauX < 0 || plateauZ < 0 || plateauX >= plateau.size.x || plateauZ >= plateau.size.z) {
                    continue;
                }

                const plateauSquare = plateau.squares[plateauX + plateauZ * plateau.size.x];
                if (!plateauSquare) {
                    throw new Error();
                }

                const fromPlateauY = 0;
                let toPlateauY = -1;
                if (plateauSquare.type === EPlateauSquareType.FLAT) {
                    toPlateauY = plateauThickness;
                } else if (plateauSquare.type === EPlateauSquareType.OBSTACLE) {
                    toPlateauY = plateauThickness + 1;
                }
                const fromChunkY = fromPlateauY + 1;
                const toChunkY = toPlateauY + 1;

                for (let iChunkY = fromChunkY; iChunkY < toChunkY; iChunkY++) {
                    const index = iChunkX + iChunkY * chunkSize.x + iChunkZ * (chunkSize.x * chunkSize.y);
                    chunkData[index] = voxelmapDataPacking.encode(false, false, plateauSquare.materialId);
                    chunkIsEmpty = false;
                }
            }
        }

        return {
            size: chunkSize,
            isEmpty: chunkIsEmpty,
            data: chunkData,
        };
    }

    protected override get workersPoolName(): string {
        return 'plateau-renderable-cpu-worker';
    }
}

export { PlateauRenderableFactory, type PlateauRenderable };
