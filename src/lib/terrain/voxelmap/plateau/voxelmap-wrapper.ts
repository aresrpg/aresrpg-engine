import { processAsap } from '../../../helpers/async/async-sync';
import * as THREE from '../../../three-usage';
import { voxelmapDataPacking, type ILocalMapData, type IVoxelMap, type IVoxelMaterial, type VoxelsChunkSize } from '../i-voxelmap';
import { PatchId } from '../patch/patch-id';

import { EPlateauSquareType, type Plateau } from './plateau';

type OnLocalMapDataChange = (modifiedPatchesIdsList: ReadonlyArray<PatchId>) => unknown;

type ColumnId = { readonly x: number; readonly z: number };
type HiddenColumn = {
    readonly id: ColumnId;
    readonly plateauY: number;
    readonly plateauSquareType: EPlateauSquareType.FLAT | EPlateauSquareType.OBSTACLE;
    readonly materialId: number;
};
type PlateauAndPatchesIds = {
    readonly plateau: Plateau;
    readonly modifiedPatchesIdsList: ReadonlyArray<PatchId>;
    readonly hiddenColumnsList: ReadonlyArray<HiddenColumn>;
};

class VoxelmapWrapper implements IVoxelMap {
    public readonly minAltitude: number;
    public readonly maxAltitude: number;
    public readonly voxelMaterialsList: readonly IVoxelMaterial[];

    public readonly includePlateau: boolean;

    public onChange: OnLocalMapDataChange[] = [];

    private readonly originGetLocalMapData: IVoxelMap['getLocalMapData'];

    private readonly plateauxChunks: Record<number, PlateauAndPatchesIds> = {};
    private patchesModifiedByPlateaux: Record<string, PatchId> = {};
    private hiddenColumns: Record<string, HiddenColumn> = {};

    private readonly chunkSize: VoxelsChunkSize;
    private readonly minChunkIdY: number;
    private readonly maxChunkIdY: number;

    public constructor(
        map: IVoxelMap,
        voxelsChunkSize: VoxelsChunkSize,
        minChunkIdY: number,
        maxChunkIdY: number,
        includePlateau: boolean
    ) {
        this.minAltitude = map.minAltitude;
        this.maxAltitude = map.maxAltitude;
        this.voxelMaterialsList = map.voxelMaterialsList;
        this.originGetLocalMapData = map.getLocalMapData.bind(map);

        this.chunkSize = voxelsChunkSize;
        this.minChunkIdY = minChunkIdY;
        this.maxChunkIdY = maxChunkIdY;

        this.includePlateau = includePlateau;
    }

    public getLocalMapData(blockStart: THREE.Vector3Like, blockEnd: THREE.Vector3Like): ILocalMapData | Promise<ILocalMapData> {
        const blockSize = new THREE.Vector3().subVectors(blockEnd, blockStart);

        const originalLocalMapData = this.originGetLocalMapData(blockStart, blockEnd);
        return processAsap(originalLocalMapData, localMapData => {
            const columnWorld = { x: 0, y: 0, z: 0 };
            for (columnWorld.z = blockStart.z; columnWorld.z < blockEnd.z; columnWorld.z++) {
                for (columnWorld.x = blockStart.x; columnWorld.x < blockEnd.x; columnWorld.x++) {
                    const hiddenColumn = this.hiddenColumns[`${columnWorld.x}_${columnWorld.z}`];

                    if (hiddenColumn) {
                        const localX = columnWorld.x - blockStart.x;
                        const localZ = columnWorld.z - blockStart.z;

                        for (
                            columnWorld.y = Math.max(hiddenColumn.plateauY - 1, blockStart.y);
                            columnWorld.y < blockEnd.y;
                            columnWorld.y++
                        ) {
                            const localY = columnWorld.y - blockStart.y;
                            const index = localX + localY * blockSize.x + localZ * blockSize.x * blockSize.y;

                            if (this.includePlateau) {
                                const deltaYPlateau = columnWorld.y - hiddenColumn.plateauY;
                                const maxDeltaYPlateau = hiddenColumn.plateauSquareType === EPlateauSquareType.OBSTACLE ? 1 : 0;
                                if (deltaYPlateau <= maxDeltaYPlateau) {
                                    localMapData.data[index]! = voxelmapDataPacking.encode(true, hiddenColumn.materialId);
                                } else {
                                    localMapData.data[index]! = voxelmapDataPacking.encodeEmpty();
                                }
                            } else {
                                localMapData.data[index]! = voxelmapDataPacking.encodeEmpty();
                            }
                        }
                    }
                }
            }

            return localMapData;
        });
    }

    public registerPlateau(plateau: Plateau): void {
        if (typeof this.plateauxChunks[plateau.id] !== 'undefined') {
            throw new Error(`Cannot register the plateau "${plateau.id}" twice.`);
        }

        const chunksColumns: Record<string, ColumnId> = {};
        const hiddenColumnsList: HiddenColumn[] = [];
        const columnLocal = { x: 0, z: 0 };
        for (columnLocal.z = 0; columnLocal.z < plateau.size.z; columnLocal.z++) {
            for (columnLocal.x = 0; columnLocal.x < plateau.size.x; columnLocal.x++) {
                const columnWorld = {
                    x: columnLocal.x + plateau.origin.x,
                    z: columnLocal.z + plateau.origin.z,
                };

                const index = columnLocal.x + columnLocal.z * plateau.size.x;
                const square = plateau.squares[index]!;
                if (square.type !== EPlateauSquareType.HOLE) {
                    hiddenColumnsList.push({
                        id: columnWorld,
                        plateauY: plateau.origin.y - 1,
                        plateauSquareType: square.type,
                        materialId: square.materialId,
                    });
                }

                const chunkColumnId = {
                    x: Math.floor(columnWorld.x / this.chunkSize.xz),
                    z: Math.floor(columnWorld.z / this.chunkSize.xz),
                };
                chunksColumns[`${chunkColumnId.x}_${chunkColumnId.z}`] = chunkColumnId;
            }
        }
        const chunksColumnsList = Object.values(chunksColumns);

        const modifiedPatchesIdsList: PatchId[] = [];
        for (const chunkColumn of chunksColumnsList) {
            const patchId = { x: chunkColumn.x, y: 0, z: chunkColumn.z };
            const fromPatchY = Math.floor((plateau.origin.y - 1) / this.chunkSize.y);
            for (patchId.y = Math.max(this.minChunkIdY, fromPatchY); patchId.y <= this.maxChunkIdY; patchId.y++) {
                modifiedPatchesIdsList.push(new PatchId(patchId));
            }
        }

        this.plateauxChunks[plateau.id] = { plateau, modifiedPatchesIdsList, hiddenColumnsList };
        this.reevaluatePlateaux();
        this.triggerOnChange(modifiedPatchesIdsList);
    }

    public unregisterPlateau(plateau: Plateau): void {
        const plateauAndPatchesIds = this.plateauxChunks[plateau.id];
        if (typeof plateauAndPatchesIds === 'undefined') {
            throw new Error(`Cannot unregister unknown plateau "${plateau.id}".`);
        }
        delete this.plateauxChunks[plateau.id];
        this.reevaluatePlateaux();
        this.triggerOnChange(plateauAndPatchesIds.modifiedPatchesIdsList);
    }

    private triggerOnChange(modifiedPatchesIdsList: ReadonlyArray<PatchId>): void {
        for (const callback of this.onChange) {
            callback(modifiedPatchesIdsList);
        }
    }

    private reevaluatePlateaux(): void {
        this.hiddenColumns = {};
        this.patchesModifiedByPlateaux = {};

        for (const plateauChunks of Object.values(this.plateauxChunks)) {
            for (const patchId of plateauChunks.modifiedPatchesIdsList) {
                this.patchesModifiedByPlateaux[patchId.asString] = patchId;
            }

            for (const column of plateauChunks.hiddenColumnsList) {
                this.hiddenColumns[`${column.id.x}_${column.id.z}`] = column;
            }
        }
    }
}

export { VoxelmapWrapper };
