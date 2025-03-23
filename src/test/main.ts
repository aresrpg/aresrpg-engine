import { logger } from '../lib/helpers/logger';
import { ELogLevel, setVerbosity } from '../lib/index';

import { VoxelMap } from './map/voxel-map';
import { type TestBase } from './test-base';
import { TestBoard } from './test-board';
import { TestGrass } from './test-grass';
import { TestParticles } from './test-particles';
import { TestPhysics } from './test-physics';
import { TestTerrain } from './test-terrain';
import { TestTextureCustomization } from './test-texture-customization';
import { TestWeather } from './test-weather';

setVerbosity(ELogLevel.DEBUG);

enum ETest {
    TERRAIN,
    WEATHER,
    TEXTURE_CUSTOMIZATION,
    PHYSICS,
    PARTICLES,
    BOARD,
    GRASS,
}

function createVoxelMap(includeTreesInLod: boolean): VoxelMap {
    const mapScaleXZ = 800;
    const mapScaleY = 200;
    const mapSeed = 'fixed_seed';
    return new VoxelMap(mapScaleXZ, mapScaleY, mapSeed, includeTreesInLod);
}

async function buildTestScene(test: ETest): Promise<TestBase> {
    switch (test) {
        case ETest.TERRAIN:
            return new TestTerrain(createVoxelMap(true));
        case ETest.WEATHER:
            return new TestWeather();
        case ETest.TEXTURE_CUSTOMIZATION:
            return new TestTextureCustomization();
        case ETest.PHYSICS:
            return new TestPhysics(createVoxelMap(true));
        case ETest.PARTICLES:
            return new TestParticles();
        case ETest.BOARD:
            return new TestBoard(createVoxelMap(true));
        case ETest.GRASS:
            logger.verbosity = ELogLevel.DEBUG;
            return await TestGrass.instanciate();
        default:
            throw new Error(`Unknown test "${test}".`);
    }
}

async function start(test: ETest): Promise<void> {
    const testScene = await buildTestScene(test);
    testScene.start();
}

void start(ETest.TERRAIN);
