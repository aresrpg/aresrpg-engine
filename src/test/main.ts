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

setVerbosity(ELogLevel.WARN);

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
    if (test === ETest.TERRAIN) {
        return new TestTerrain(createVoxelMap(false));
    } else if (test === ETest.WEATHER) {
        return new TestWeather();
    } else if (test === ETest.TEXTURE_CUSTOMIZATION) {
        return new TestTextureCustomization();
    } else if (test === ETest.PHYSICS) {
        return new TestPhysics(createVoxelMap(true));
    } else if (test === ETest.PARTICLES) {
        return new TestParticles(createVoxelMap(true));
    } else if (test === ETest.BOARD) {
        return new TestBoard(createVoxelMap(true));
    } else if (test === ETest.GRASS) {
        logger.verbosity = ELogLevel.DEBUG;
        return await TestGrass.instanciate();
    } else {
        throw new Error(`Unknown test "${test}".`);
    }
}

async function start(test: ETest): Promise<void> {
    const testScene = await buildTestScene(test);
    testScene.start();
}

void start(ETest.TERRAIN);
