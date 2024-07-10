import { ELogLevel, setVerbosity } from '../lib/index';

import { TestTerrain } from './test-terrain';
import { TestTerrainAutonomous } from './test-terrain-autonomous';
import { VoxelMap } from './map/voxel-map';
import { VoxelMapCacheless } from './map/voxel-map-cacheless';

setVerbosity(ELogLevel.WARN);

const mapScaleXZ = 800;
const mapScaleY = 200;
const mapSeed = 'fixed_seed';

const voxelMap = new VoxelMapCacheless(mapScaleXZ, mapScaleY, mapSeed) || new VoxelMap(2048, 2048, mapScaleXZ, mapScaleY, mapSeed);

const testNewTerrain = true;
const testScene = testNewTerrain ? new TestTerrain(voxelMap) : new TestTerrainAutonomous(voxelMap);
testScene.start();
