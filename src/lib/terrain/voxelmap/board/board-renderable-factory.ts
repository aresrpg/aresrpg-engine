import * as THREE from '../../../libs/three-usage';
import { voxelmapDataPacking, type IVoxelMaterial } from '../i-voxelmap';
import { type VoxelsRenderable } from '../voxelsRenderable/voxels-renderable';
import { VoxelsRenderableFactoryCpuWorker } from '../voxelsRenderable/voxelsRenderableFactory/merged/cpu/voxels-renderable-factory-cpu-worker';
import { type VoxelsChunkData } from '../voxelsRenderable/voxelsRenderableFactory/voxels-renderable-factory-base';

import { EBoardSquareType, type Board } from './board';

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
};

type BoardRenderable = {
    readonly container: THREE.Group;
    dispose(): void;
};

class BoardRenderableFactory extends VoxelsRenderableFactoryCpuWorker {
    public constructor(params: Parameters) {
        super({
            voxelMaterialsList: params.voxelMaterialsList,
            maxVoxelsChunkSize: { xz: 128, y: 16 },
            workersPoolSize: 1,
            voxelsChunkOrdering: 'zyx',
        });
    }

    public async buildBoardRenderable(board: Board): Promise<BoardRenderable> {
        const boardThickness = 1;
        const voxelsChunkData = this.buildBoardVoxelsChunkData(board, boardThickness);

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

            result.container.position.set(board.origin.x, board.origin.y - boardThickness, board.origin.z);
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

    private buildBoardVoxelsChunkData(board: Board, boardThickness: number): VoxelsChunkData {
        if (!Number.isInteger(boardThickness) || boardThickness < 1) {
            throw new Error();
        }

        const chunkSize = new THREE.Vector3(board.size.x + 2, 1 + boardThickness + 1 + 1, board.size.z + 2);
        let chunkIsEmpty = true;
        const chunkData = new Uint16Array(chunkSize.x * chunkSize.y * chunkSize.z);
        for (let iChunkZ = 0; iChunkZ < chunkSize.z; iChunkZ++) {
            for (let iChunkX = 0; iChunkX < chunkSize.x; iChunkX++) {
                const boardX = iChunkX - 1;
                const boardZ = iChunkZ - 1;
                if (boardX < 0 || boardZ < 0 || boardX >= board.size.x || boardZ >= board.size.z) {
                    continue;
                }

                const boardSquare = board.squares[boardX + boardZ * board.size.x];
                if (!boardSquare) {
                    throw new Error();
                }

                const fromBoardY = 0;
                let toBoardY = -1;
                if (boardSquare.type === EBoardSquareType.FLAT) {
                    toBoardY = boardThickness;
                } else if (boardSquare.type === EBoardSquareType.OBSTACLE) {
                    toBoardY = boardThickness + 1;
                }
                const fromChunkY = fromBoardY + 1;
                const toChunkY = toBoardY + 1;

                for (let iChunkY = fromChunkY; iChunkY < toChunkY; iChunkY++) {
                    const index = iChunkX + iChunkY * chunkSize.x + iChunkZ * (chunkSize.x * chunkSize.y);
                    chunkData[index] = voxelmapDataPacking.encode(true, boardSquare.materialId);
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
        return 'board-renderable-cpu-worker';
    }
}

export { BoardRenderableFactory, type BoardRenderable };
