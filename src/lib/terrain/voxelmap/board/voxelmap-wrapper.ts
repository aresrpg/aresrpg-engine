import { processAsap } from '../../../helpers/async/async-sync';
import * as THREE from '../../../libs/three-usage';
import { ChunkId } from '../chunk/chunk-id';
import { voxelEncoder, type IVoxelMap, type LocalMapData, type VoxelsChunkSize } from '../i-voxelmap';

import { EBoardSquareType, type Board } from './board';

type OnLocalMapDataChange = (modifiedChunksIdsList: ReadonlyArray<ChunkId>) => unknown;

type ColumnId = { readonly x: number; readonly z: number };
type HiddenColumn = {
    readonly id: ColumnId;
    readonly boardY: number;
    readonly boardSquareType: EBoardSquareType.FLAT | EBoardSquareType.OBSTACLE | EBoardSquareType.HOLE;
    readonly materialId: number;
};
type BoardAndChunksIds = {
    readonly board: Board;
    readonly modifiedChunksIdsList: ReadonlyArray<ChunkId>;
    readonly hiddenColumnsList: ReadonlyArray<HiddenColumn>;
};

class VoxelmapWrapper implements IVoxelMap {
    public readonly altitude: {
        readonly min: number;
        readonly max: number;
    };

    public readonly voxelTypesDefininitions: IVoxelMap['voxelTypesDefininitions'];

    public readonly includeBoard: boolean;

    public onChange: OnLocalMapDataChange[] = [];

    private readonly originGetLocalMapData: IVoxelMap['getLocalMapData'];

    private readonly boardxChunks = new Map<number, BoardAndChunksIds>();
    private hiddenColumns = new Map<string, HiddenColumn>();

    private readonly chunkSize: VoxelsChunkSize;
    private readonly minChunkIdY: number;
    private readonly maxChunkIdY: number;

    public constructor(map: IVoxelMap, voxelsChunkSize: VoxelsChunkSize, minChunkIdY: number, maxChunkIdY: number, includeBoard: boolean) {
        this.altitude = { ...map.altitude };
        this.voxelTypesDefininitions = map.voxelTypesDefininitions;
        this.originGetLocalMapData = map.getLocalMapData.bind(map);

        this.chunkSize = voxelsChunkSize;
        this.minChunkIdY = minChunkIdY;
        this.maxChunkIdY = maxChunkIdY;

        this.includeBoard = includeBoard;
    }

    public getLocalMapData(blockStart: THREE.Vector3Like, blockEnd: THREE.Vector3Like): LocalMapData | Promise<LocalMapData> {
        const blockSize = new THREE.Vector3().subVectors(blockEnd, blockStart);

        const originalLocalMapData = this.originGetLocalMapData(blockStart, blockEnd);
        return processAsap(originalLocalMapData, localMapData => {
            if (localMapData.isEmpty) {
                return localMapData;
            }

            const columnWorld = { x: 0, y: 0, z: 0 };
            for (columnWorld.z = blockStart.z; columnWorld.z < blockEnd.z; columnWorld.z++) {
                for (columnWorld.x = blockStart.x; columnWorld.x < blockEnd.x; columnWorld.x++) {
                    const hiddenColumn = this.hiddenColumns.get(`${columnWorld.x}_${columnWorld.z}`);

                    if (hiddenColumn) {
                        const localX = columnWorld.x - blockStart.x;
                        const localZ = columnWorld.z - blockStart.z;

                        for (columnWorld.y = Math.max(hiddenColumn.boardY - 1, blockStart.y); columnWorld.y < blockEnd.y; columnWorld.y++) {
                            const localY = columnWorld.y - blockStart.y;
                            const index = localX + localY * blockSize.x + localZ * blockSize.x * blockSize.y;

                            const deltaYBoard = columnWorld.y - hiddenColumn.boardY;
                            let boardY: number;
                            if (hiddenColumn.boardSquareType === EBoardSquareType.HOLE) {
                                boardY = 0;
                            } else if (hiddenColumn.boardSquareType === EBoardSquareType.FLAT) {
                                boardY = 0;
                            } else {
                                boardY = 1;
                            }
                            if (deltaYBoard >= boardY) {
                                localMapData.data[index]! = voxelEncoder.encodeEmpty();
                            }

                            if (this.includeBoard) {
                                if (hiddenColumn.boardSquareType !== EBoardSquareType.HOLE) {
                                    if (deltaYBoard === boardY) {
                                        localMapData.data[index]! = voxelEncoder.encode(true, hiddenColumn.materialId);
                                    }
                                }
                            }
                        }
                    }
                }
            }

            return localMapData;
        });
    }

    public registerBoard(board: Board): void {
        if (this.boardxChunks.has(board.id)) {
            throw new Error(`Cannot register the board "${board.id}" twice.`);
        }

        const chunksColumnsMap = new Map<string, ColumnId>();
        const hiddenColumnsList: HiddenColumn[] = [];
        const columnLocal = { x: 0, z: 0 };
        for (columnLocal.z = 0; columnLocal.z < board.size.z; columnLocal.z++) {
            for (columnLocal.x = 0; columnLocal.x < board.size.x; columnLocal.x++) {
                const columnWorld = {
                    x: columnLocal.x + board.origin.x,
                    z: columnLocal.z + board.origin.z,
                };

                const index = columnLocal.x + columnLocal.z * board.size.x;
                const square = board.squares[index]!;
                if (square.type !== EBoardSquareType.OUT_OF_BOUNDS) {
                    hiddenColumnsList.push({
                        id: columnWorld,
                        boardY: board.origin.y - 1,
                        boardSquareType: square.type,
                        materialId: square.materialId,
                    });
                }

                const chunkColumnId = {
                    x: Math.floor(columnWorld.x / this.chunkSize.xz),
                    z: Math.floor(columnWorld.z / this.chunkSize.xz),
                };
                chunksColumnsMap.set(`${chunkColumnId.x}_${chunkColumnId.z}`, chunkColumnId);
            }
        }

        const modifiedChunksIdsList: ChunkId[] = [];
        for (const chunkColumn of chunksColumnsMap.values()) {
            const chunkId = { x: chunkColumn.x, y: 0, z: chunkColumn.z };
            const fromChunkY = Math.floor((board.origin.y - 1) / this.chunkSize.y);
            for (chunkId.y = Math.max(this.minChunkIdY, fromChunkY); chunkId.y <= this.maxChunkIdY; chunkId.y++) {
                modifiedChunksIdsList.push(new ChunkId(chunkId));
            }
        }

        this.boardxChunks.set(board.id, { board, modifiedChunksIdsList, hiddenColumnsList });
        this.reevaluateBoardx();
        this.triggerOnChange(modifiedChunksIdsList);
    }

    public unregisterBoard(board: Board): void {
        const boardAndChunksIds = this.boardxChunks.get(board.id);
        if (typeof boardAndChunksIds === 'undefined') {
            throw new Error(`Cannot unregister unknown board "${board.id}".`);
        }
        this.boardxChunks.delete(board.id);
        this.reevaluateBoardx();
        this.triggerOnChange(boardAndChunksIds.modifiedChunksIdsList);
    }

    private triggerOnChange(modifiedChunksIdsList: ReadonlyArray<ChunkId>): void {
        for (const callback of this.onChange) {
            callback(modifiedChunksIdsList);
        }
    }

    private reevaluateBoardx(): void {
        this.hiddenColumns.clear();

        for (const boardChunks of this.boardxChunks.values()) {
            for (const column of boardChunks.hiddenColumnsList) {
                this.hiddenColumns.set(`${column.id.x}_${column.id.z}`, column);
            }
        }
    }
}

export { VoxelmapWrapper };
