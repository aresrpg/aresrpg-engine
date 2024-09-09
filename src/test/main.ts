import { ELogLevel, setVerbosity } from '../lib/index';

import { TestTerrain } from './test-terrain';
import { TestTerrainAutonomous } from './test-terrain-autonomous';
import { VoxelMap } from './map/voxel-map';

setVerbosity(ELogLevel.WARN);

const mapScaleXZ = 800;
const mapScaleY = 200;
const mapSeed = 'fixed_seed';
const includeTreesInLod = false;

const voxelMap = new VoxelMap(mapScaleXZ, mapScaleY, mapSeed, includeTreesInLod);

const testNewTerrain = true;
const testScene = testNewTerrain ? new TestTerrain(voxelMap) : new TestTerrainAutonomous(voxelMap);
testScene.start();
