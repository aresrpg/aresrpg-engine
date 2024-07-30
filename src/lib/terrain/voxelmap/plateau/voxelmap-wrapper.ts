import { processAsap } from '../../../helpers/async/async-sync';
import * as THREE from '../../../three-usage';
import { voxelmapDataPacking, type ILocalMapData, type IVoxelMap, type IVoxelMaterial, type VoxelsChunkSize } from '../i-voxelmap';
import { PatchId } from '../patch/patch-id';

import { type Plateau } from './plateau';

type OnLocalMapDataChange = (modifiedPatchesIdsList: ReadonlyArray<PatchId>) => unknown;

type ColumnId = { readonly x: number; readonly z: number };
type HiddenColumn = {
    readonly id: ColumnId;
    readonly fromY: number;
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

    public onChange: OnLocalMapDataChange[] = [];

    private readonly originGetLocalMapData: IVoxelMap['getLocalMapData'];

    private readonly plateauxChunks: Record<number, PlateauAndPatchesIds> = {};
    private patchesModifiedByPlateaux: Record<string, PatchId> = {};
    private hiddenColumns: Record<string, HiddenColumn> = {};

    private readonly chunkSize: VoxelsChunkSize;
    private readonly minChunkIdY: number;
    private readonly maxChunkIdY: number;

    public constructor(map: IVoxelMap, voxelsChunkSize: VoxelsChunkSize, minChunkIdY: number, maxChunkIdY: number) {
        this.minAltitude = map.minAltitude;
        this.maxAltitude = map.maxAltitude;
        this.voxelMaterialsList = map.voxelMaterialsList;
        this.originGetLocalMapData = map.getLocalMapData.bind(map);

        this.chunkSize = voxelsChunkSize;
        this.minChunkIdY = minChunkIdY;
        this.maxChunkIdY = maxChunkIdY;
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

                        for (columnWorld.y = Math.max(hiddenColumn.fromY, blockStart.y); columnWorld.y < blockEnd.y; columnWorld.y++) {
                            const localY = columnWorld.y - blockStart.y;
                            const index = localX + localY * blockSize.x + localZ * blockSize.x * blockSize.y;
                            localMapData.data[index]! = voxelmapDataPacking.encode(true, 0);
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
        const hiddenColumns: Record<string, HiddenColumn> = {};
        for (const columnLocal of plateau.columns) {
            const columnWorld = {
                x: columnLocal.x + plateau.origin.x,
                z: columnLocal.z + plateau.origin.z,
            };
            const chunkColumnId = {
                x: Math.floor(columnWorld.x / this.chunkSize.xz),
                z: Math.floor(columnWorld.z / this.chunkSize.xz),
            };
            chunksColumns[`${chunkColumnId.x}_${chunkColumnId.z}`] = chunkColumnId;
            hiddenColumns[`${columnWorld.x}_${columnWorld.z}`] = {
                id: columnWorld,
                fromY: plateau.origin.y - 1,
            };
        }
        const hiddenColumnsList = Object.values(hiddenColumns);
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
