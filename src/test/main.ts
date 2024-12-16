import { ELogLevel, setVerbosity } from '../lib/index';

import { VoxelMap } from './map/voxel-map';
import { type TestBase } from './test-base';
import { TestBoard } from './test-board';
import { TestParticles } from './test-particles';
import { TestPhysics } from './test-physics';
import { TestTerrain } from './test-terrain';
import { TestTerrainAutonomous } from './test-terrain-autonomous';
import { TestTextureCustomization } from './test-texture-customization';
import { TestWeather } from './test-weather';

setVerbosity(ELogLevel.WARN);

function createVoxelMap(): VoxelMap {
    const mapScaleXZ = 800;
    const mapScaleY = 200;
    const mapSeed = 'fixed_seed';
    const includeTreesInLod = true;

    return new VoxelMap(mapScaleXZ, mapScaleY, mapSeed, includeTreesInLod);
}

enum ETest {
    TERRAIN,
    TERRAIN_OLD,
    WEATHER,
    TEXTURE_CUSTOMIZATION,
    PHYSICS,
    PARTICLES,
    BOARD,
}

const test = ETest.BOARD as ETest;

let testScene: TestBase;
if (test === ETest.TERRAIN) {
    testScene = new TestTerrain(createVoxelMap());
} else if (test === ETest.TERRAIN_OLD) {
    testScene = new TestTerrainAutonomous(createVoxelMap());
} else if (test === ETest.WEATHER) {
    testScene = new TestWeather();
} else if (test === ETest.TEXTURE_CUSTOMIZATION) {
    testScene = new TestTextureCustomization();
} else if (test === ETest.PHYSICS) {
    testScene = new TestPhysics(createVoxelMap());
} else if (test === ETest.PARTICLES) {
    testScene = new TestParticles(createVoxelMap());
} else if (test === ETest.BOARD) {
    testScene = new TestBoard(createVoxelMap());
} else {
    throw new Error(`Unknown test "${test}".`);
}

testScene.start();
