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

enum ETest {
    TERRAIN,
    TERRAIN_OLD,
    WEATHER,
    TEXTURE_CUSTOMIZATION,
    PHYSICS,
    PARTICLES,
    BOARD,
}

function createVoxelMap(): VoxelMap {
    const mapScaleXZ = 800;
    const mapScaleY = 200;
    const mapSeed = 'fixed_seed';
    const includeTreesInLod = true;
    return new VoxelMap(mapScaleXZ, mapScaleY, mapSeed, includeTreesInLod);
}

function buildTestScene(test: ETest): TestBase {
    if (test === ETest.TERRAIN) {
        return new TestTerrain(createVoxelMap());
    } else if (test === ETest.TERRAIN_OLD) {
        return new TestTerrainAutonomous(createVoxelMap());
    } else if (test === ETest.WEATHER) {
        return new TestWeather();
    } else if (test === ETest.TEXTURE_CUSTOMIZATION) {
        return new TestTextureCustomization();
    } else if (test === ETest.PHYSICS) {
        return new TestPhysics(createVoxelMap());
    } else if (test === ETest.PARTICLES) {
        return new TestParticles(createVoxelMap());
    } else if (test === ETest.BOARD) {
        return new TestBoard(createVoxelMap());
    } else {
        throw new Error(`Unknown test "${test}".`);
    }
}

const testScene = buildTestScene(ETest.BOARD);
testScene.start();
