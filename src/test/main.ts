import { ELogLevel, setVerbosity } from '../lib/index';

import { TestTerrain } from './test-terrain';
import { TestTerrainAutonomous } from './test-terrain-autonomous';
import { VoxelMap } from './voxel-map';

setVerbosity(ELogLevel.WARN);

const voxelMap = new VoxelMap(2048, 2048, 200, 64, 'fixed_seed');

const testNewTerrain = true;
const testScene = testNewTerrain ? new TestTerrain(voxelMap) : new TestTerrainAutonomous(voxelMap);
testScene.start();
