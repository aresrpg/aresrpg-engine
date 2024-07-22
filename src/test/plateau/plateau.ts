import * as THREE from 'three';

import { type IVoxelMap } from '../../lib';

enum EPlateauSquareType {
    FLAT,
    HOLE,
    OBSTACLE,
}

type PlateauSquare = {
    readonly type: EPlateauSquareType;
    readonly materialId: number;
};

type PlateauSquareExtended = PlateauSquare & {
    readonly realY: number;
    readonly generation: number;
};

type Plateau = {
    readonly size: THREE.Vector2Like;
    readonly squares: PlateauSquareExtended[];
    readonly origin: THREE.Vector3Like;
};

async function computePlateau(map: IVoxelMap, originWorld: THREE.Vector3Like): Promise<Plateau> {
    originWorld = {
        x: Math.floor(originWorld.x),
        y: Math.floor(originWorld.y),
        z: Math.floor(originWorld.z),
    };

    let currentGeneration = 0;
    const maxDeltaY = 4;
    const plateauHalfSize = 31;
    const plateauSize = { x: 2 * plateauHalfSize + 1, y: 2 * plateauHalfSize + 1 };
    const plateauSquares: PlateauSquareExtended[] = [];
    for (let iY = 0; iY < plateauSize.y; iY++) {
        for (let iX = 0; iX < plateauSize.x; iX++) {
            plateauSquares.push({
                type: EPlateauSquareType.HOLE,
                materialId: 0,
                realY: -1,
                generation: currentGeneration,
            });
        }
    }
    const tryGetIndex = (relativePos: { x: number; z: number }) => {
        const plateauCoords = { x: relativePos.x + plateauHalfSize, z: relativePos.z + plateauHalfSize };
        if (plateauCoords.x < 0 || plateauCoords.z < 0 || plateauCoords.x >= plateauSize.x || plateauCoords.z >= plateauSize.y) {
            return null;
        }
        return plateauCoords.x + plateauCoords.z * plateauSize.x;
    };
    const getIndex = (relativePos: { x: number; z: number }) => {
        const index = tryGetIndex(relativePos);
        if (index === null) {
            throw new Error();
        }
        return index;
    };
    const setPlateauSquare = (relativePos: { x: number; z: number }, square: PlateauSquareExtended) => {
        const index = getIndex(relativePos);
        plateauSquares[index] = {
            type: square.type,
            materialId: square.materialId,
            realY: square.realY,
            generation: square.generation,
        };
    };
    const getPlateauSquare = (relativePos: { x: number; z: number }) => {
        const index = getIndex(relativePos);
        return plateauSquares[index]!;
    };
    const tryGetPlateauSquare = (relativePos: { x: number; z: number }) => {
        const index = tryGetIndex(relativePos);
        if (index === null) {
            return null;
        }
        return plateauSquares[index];
    };

    const dataMargin = plateauHalfSize + 5;
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
        while (originSample === 0 && deltaY < maxDeltaY) {
            originWorldCoords.y--;
            deltaY++;
            originSample = sampleData(originWorldCoords);
        }
        if (originSample === 0) {
            throw new Error();
        }
        setPlateauSquare(
            { x: 0, z: 0 },
            { type: EPlateauSquareType.FLAT, materialId: originSample - 1, realY: originWorldCoords.y - 1, generation: currentGeneration }
        );
    }
    const originY = getPlateauSquare({ x: 0, z: 0 })!.realY;

    let somethingChanged = false;
    do {
        somethingChanged = false;
        currentGeneration++;

        const relativePos = { x: 0, z: 0 };
        const worldPos = { x: 0, y: 0, z: 0 };
        for (relativePos.z = -plateauHalfSize; relativePos.z <= plateauHalfSize; relativePos.z++) {
            for (relativePos.x = -plateauHalfSize; relativePos.x <= plateauHalfSize; relativePos.x++) {
                if (Math.sqrt(relativePos.x * relativePos.x + relativePos.z * relativePos.z) >= plateauHalfSize - 1) {
                    continue;
                }

                const square = getPlateauSquare(relativePos);
                if (square.type === EPlateauSquareType.HOLE) {
                    // if this square has not been computed yet
                    const xm = tryGetPlateauSquare({ x: relativePos.x - 1, z: relativePos.z });
                    const xp = tryGetPlateauSquare({ x: relativePos.x + 1, z: relativePos.z });
                    const zm = tryGetPlateauSquare({ x: relativePos.x, z: relativePos.z - 1 });
                    const zp = tryGetPlateauSquare({ x: relativePos.x, z: relativePos.z + 1 });

                    worldPos.x = relativePos.x + originWorld.x;
                    worldPos.z = relativePos.z + originWorld.z;

                    for (const neighbour of [xm, xp, zm, zp]) {
                        if (neighbour?.type === EPlateauSquareType.FLAT && neighbour.generation === currentGeneration - 1) {
                            worldPos.y = originY;
                            const generation = currentGeneration;
                            const sampleY = sampleData(worldPos);

                            let deltaY = 0;
                            if (sampleY > 0) {
                                let foundAir = false;
                                let lastSample = sampleY;
                                for (deltaY = 1; deltaY < maxDeltaY; deltaY++) {
                                    const sample = sampleData({ x: worldPos.x, y: worldPos.y + deltaY, z: worldPos.z });
                                    if (sample === 0) {
                                        setPlateauSquare(relativePos, {
                                            type: EPlateauSquareType.FLAT,
                                            materialId: lastSample - 1,
                                            realY: worldPos.y,
                                            generation,
                                        });
                                        somethingChanged = true;
                                        foundAir = true;
                                        break;
                                    } else {
                                        lastSample = sample;
                                    }
                                }

                                if (!foundAir) {
                                    setPlateauSquare(relativePos, {
                                        type: EPlateauSquareType.OBSTACLE,
                                        materialId: lastSample - 1,
                                        realY: worldPos.y,
                                        generation,
                                    });
                                    somethingChanged = true;
                                }
                            } else {
                                let foundSoil = false;
                                for (deltaY = -1; deltaY > -maxDeltaY; deltaY--) {
                                    const sample = sampleData({ x: worldPos.x, y: worldPos.y + deltaY, z: worldPos.z });
                                    if (sample > 0) {
                                        setPlateauSquare(relativePos, {
                                            type: EPlateauSquareType.FLAT,
                                            materialId: sample - 1,
                                            realY: worldPos.y,
                                            generation,
                                        });
                                        somethingChanged = true;
                                        foundSoil = true;
                                        break;
                                    }
                                }

                                if (!foundSoil) {
                                    setPlateauSquare(relativePos, {
                                        type: EPlateauSquareType.HOLE,
                                        materialId: 0,
                                        realY: worldPos.y,
                                        generation,
                                    });
                                    somethingChanged = true;
                                }
                            }

                            // worldPos.y = neighbour.realY;
                            // const generation = currentGeneration;
                            // const sampleY = sampleData(worldPos);

                            // if (sampleY > 0) {
                            //     const sampleYp = sampleData({ x: worldPos.x, y: worldPos.y + 1, z: worldPos.z });
                            //     if (sampleYp === 0) {
                            //         setPlateauSquare(relativePos, { type: EPlateauSquareType.FLAT, materialId: sampleYp - 1, realY: worldPos.y, generation});
                            //         somethingChanged = true;
                            //     } else {
                            //         const sampleYpp = sampleData({ x: worldPos.x, y: worldPos.y + 2, z: worldPos.z });
                            //         if (sampleYpp === 0) {
                            //             setPlateauSquare(relativePos, { type: EPlateauSquareType.FLAT, materialId: sampleYp - 1, realY: worldPos.y, generation});
                            //             somethingChanged = true;
                            //         } else {
                            //             setPlateauSquare(relativePos, { type: EPlateauSquareType.OBSTACLE, materialId: sampleYp - 1, realY: worldPos.y + 1, generation});
                            //             somethingChanged = true;
                            //         }
                            //     }
                            // }
                        }
                    }
                }
            }
        }
    } while (somethingChanged);

    return {
        size: plateauSize,
        squares: plateauSquares,
        origin: new THREE.Vector3().copy(originWorld).add({ x: -plateauHalfSize, y: 16, z: -plateauHalfSize }),
    };
}

export { computePlateau, EPlateauSquareType, type Plateau, type PlateauSquare };
