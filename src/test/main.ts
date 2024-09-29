import { ELogLevel, setVerbosity } from '../lib/index';

import { VoxelMap } from './map/voxel-map';
import { type TestBase } from './test-base';
import { TestTerrain } from './test-terrain';
import { TestTerrainAutonomous } from './test-terrain-autonomous';
import { TestWeather } from './test-weather';

setVerbosity(ELogLevel.WARN);

const mapScaleXZ = 800;
const mapScaleY = 200;
const mapSeed = 'fixed_seed';
const includeTreesInLod = false;

const voxelMap = new VoxelMap(mapScaleXZ, mapScaleY, mapSeed, includeTreesInLod);

let testScene: TestBase;
const testTerrain = false;
if (testTerrain) {
    const testNewTerrain = true;
    if (testNewTerrain) {
        testScene = new TestTerrain(voxelMap);
    } else {
        testScene = new TestTerrainAutonomous(voxelMap);
    }
} else {
    testScene = new TestWeather();
}
testScene.start();
