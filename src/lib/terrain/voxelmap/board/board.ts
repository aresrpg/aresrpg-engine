import * as THREE from '../../../three-usage';
import { voxelmapDataPacking, type IVoxelMap } from '../i-voxelmap';

enum EBoardSquareType {
    OUT_OF_BOUNDS = 0,
    FLAT = 1,
    HOLE = 2,
    OBSTACLE = 3,
}

type BoardSquare = {
    readonly type: EBoardSquareType;
    readonly materialId: number;
};

type ColumnId = { readonly x: number; readonly z: number };

type Board = {
    readonly id: number;
    readonly size: { readonly x: number; readonly z: number };
    readonly squares: ReadonlyArray<BoardSquare>;
    readonly origin: THREE.Vector3Like;
};

type BoardSquareExtended = BoardSquare & {
    readonly floorY: number;
    readonly generation: number;
};

let boardxCount = 0;

async function computeBoard(map: IVoxelMap, originWorld: THREE.Vector3Like, radius: number): Promise<Board> {
    originWorld = {
        x: Math.floor(originWorld.x),
        y: Math.floor(originWorld.y),
        z: Math.floor(originWorld.z),
    };

    let currentGeneration = 0;
    const maxDeltaY = 4;
    const boardHalfSize = radius;
    const boardSize = { x: 2 * boardHalfSize + 1, z: 2 * boardHalfSize + 1 };
    const boardSquares: BoardSquareExtended[] = [];
    for (let iZ = 0; iZ < boardSize.z; iZ++) {
        for (let iX = 0; iX < boardSize.x; iX++) {
            boardSquares.push({
                type: EBoardSquareType.OUT_OF_BOUNDS,
                materialId: 0,
                floorY: NaN,
                generation: currentGeneration,
            });
        }
    }
    const tryGetIndex = (relativePos: ColumnId) => {
        const boardCoords = { x: relativePos.x + boardHalfSize, z: relativePos.z + boardHalfSize };
        if (boardCoords.x < 0 || boardCoords.z < 0 || boardCoords.x >= boardSize.x || boardCoords.z >= boardSize.z) {
            return null;
        }
        return boardCoords.x + boardCoords.z * boardSize.x;
    };
    const getIndex = (relativePos: ColumnId) => {
        const index = tryGetIndex(relativePos);
        if (index === null) {
            throw new Error();
        }
        return index;
    };
    const setBoardSquare = (relativePos: ColumnId, square: BoardSquareExtended) => {
        const index = getIndex(relativePos);
        boardSquares[index] = { ...square };
    };
    const getBoardSquare = (relativePos: ColumnId) => {
        const index = getIndex(relativePos);
        return boardSquares[index]!;
    };
    const tryGetBoardSquare = (relativePos: ColumnId) => {
        const index = tryGetIndex(relativePos);
        if (index === null) {
            return null;
        }
        return boardSquares[index];
    };

    const dataMargin = boardHalfSize + 5;
    const dataFromWorld = new THREE.Vector3().copy(originWorld).subScalar(dataMargin);
    const dataToWorld = new THREE.Vector3().copy(originWorld).addScalar(dataMargin);
    const data = await map.getLocalMapData(dataFromWorld, dataToWorld);
    const dataSize = dataToWorld.clone().sub(dataFromWorld);

    const sampleData = (worldPos: THREE.Vector3Like) => {
        const dataPos = new THREE.Vector3().copy(worldPos).sub(dataFromWorld);
        if (
            dataPos.x < 0 ||
            dataPos.y < 0 ||
            dataPos.z < 0 ||
            dataPos.x >= dataSize.x ||
            dataPos.y >= dataSize.y ||
            dataPos.z >= dataSize.z
        ) {
            throw new Error();
        }
        const index = dataPos.x + dataPos.y * dataSize.x + dataPos.z * dataSize.x * dataSize.y;
        return data.data[index]!;
    };

    {
        const originWorldCoords = {
            x: originWorld.x,
            y: originWorld.y,
            z: originWorld.z,
        };
        let originSample = sampleData(originWorldCoords);
        let deltaY = 0;
        while (voxelmapDataPacking.isEmpty(originSample) && deltaY < maxDeltaY) {
            originWorldCoords.y--;
            deltaY++;
            originSample = sampleData(originWorldCoords);
        }
        if (voxelmapDataPacking.isEmpty(originSample)) {
            throw new Error();
        }
        setBoardSquare(
            { x: 0, z: 0 },
            {
                type: EBoardSquareType.FLAT,
                materialId: voxelmapDataPacking.getMaterialId(originSample),
                generation: currentGeneration,
                floorY: originWorldCoords.y - 1,
            }
        );
    }
    const originY = getBoardSquare({ x: 0, z: 0 })!.floorY;

    const computeBoardSquare = (relativePos: ColumnId): BoardSquareExtended | null => {
        const square = getBoardSquare(relativePos);
        if (square.type !== EBoardSquareType.OUT_OF_BOUNDS) {
            // this square has been computed already
            return null;
        }

        // if this square has not been computed yet
        const xm = tryGetBoardSquare({ x: relativePos.x - 1, z: relativePos.z });
        const xp = tryGetBoardSquare({ x: relativePos.x + 1, z: relativePos.z });
        const zm = tryGetBoardSquare({ x: relativePos.x, z: relativePos.z - 1 });
        const zp = tryGetBoardSquare({ x: relativePos.x, z: relativePos.z + 1 });

        const worldPos = { x: 0, y: 0, z: 0 };
        worldPos.x = relativePos.x + originWorld.x;
        worldPos.z = relativePos.z + originWorld.z;

        for (const neighbour of [xm, xp, zm, zp]) {
            if (neighbour?.type === EBoardSquareType.FLAT && neighbour.generation === currentGeneration - 1) {
                worldPos.y = neighbour.floorY;
                const generation = currentGeneration;
                const sampleY = sampleData(worldPos);

                if (!voxelmapDataPacking.isEmpty(sampleY)) {
                    let firstSample: number | null = null;
                    let lastSample = sampleY;
                    for (let deltaY = 1; deltaY < maxDeltaY; deltaY++) {
                        const sample = sampleData({ x: worldPos.x, y: worldPos.y + deltaY, z: worldPos.z });
                        if (voxelmapDataPacking.isEmpty(sample)) {
                            return {
                                type: EBoardSquareType.FLAT,
                                materialId: voxelmapDataPacking.getMaterialId(lastSample),
                                floorY: worldPos.y + deltaY - 1,
                                generation,
                            };
                        } else {
                            firstSample = firstSample ?? sample;
                            lastSample = sample;
                        }
                    }

                    if (!firstSample) {
                        throw new Error();
                    }

                    return {
                        type: EBoardSquareType.OBSTACLE,
                        materialId: voxelmapDataPacking.getMaterialId(firstSample),
                        floorY: worldPos.y,
                        generation,
                    };
                } else {
                    for (let deltaY = -1; deltaY > -maxDeltaY; deltaY--) {
                        const sample = sampleData({ x: worldPos.x, y: worldPos.y + deltaY, z: worldPos.z });
                        if (!voxelmapDataPacking.isEmpty(sample)) {
                            return {
                                type: EBoardSquareType.FLAT,
                                materialId: voxelmapDataPacking.getMaterialId(sample),
                                floorY: worldPos.y + deltaY,
                                generation,
                            };
                        }
                    }

                    return {
                        type: EBoardSquareType.HOLE,
                        materialId: 0,
                        floorY: NaN,
                        generation,
                    };
                }
            }
        }

        return null;
    };

    let somethingChanged = false;
    do {
        somethingChanged = false;
        currentGeneration++;

        const relativePos = { x: 0, z: 0 };
        for (relativePos.z = -boardHalfSize; relativePos.z <= boardHalfSize; relativePos.z++) {
            for (relativePos.x = -boardHalfSize; relativePos.x <= boardHalfSize; relativePos.x++) {
                if (Math.sqrt(relativePos.x * relativePos.x + relativePos.z * relativePos.z) >= boardHalfSize - 1) {
                    continue;
                }

                const square = computeBoardSquare(relativePos);
                if (square && !isNaN(square.floorY) && Math.abs(square.floorY - originY) < maxDeltaY) {
                    somethingChanged = true;
                    setBoardSquare(relativePos, square);
                }
            }
        }
    } while (somethingChanged);

    const minY = boardSquares.reduce((y: number, square: BoardSquareExtended) => {
        if (!isNaN(square.floorY)) {
            return Math.min(y, square.floorY);
        }
        return y;
    }, originY);
    const boardYShift = minY - originY - 1;

    const boardOrigin = new THREE.Vector3(originWorld.x - boardHalfSize, originWorld.y + boardYShift, originWorld.z - boardHalfSize);

    return {
        id: boardxCount++,
        size: boardSize,
        squares: boardSquares,
        origin: boardOrigin,
    };
}

export { computeBoard, EBoardSquareType, type Board, type BoardSquare };
