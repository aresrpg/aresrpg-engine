import { ELogLevel, setVerbosity } from '../lib/index';

import { TestTerrain } from './test-terrain';
import { TestTerrainSimple } from './test-terrain-simple';
import { VoxelMap } from './voxel-map';

setVerbosity(ELogLevel.WARN);

const voxelMap = new VoxelMap(2048, 2048, 200, 64, 'fixed_seed');

const testGreedyTerrain = false;
const testScene = testGreedyTerrain ? new TestTerrain(voxelMap) : new TestTerrainSimple(voxelMap);
testScene.start();
