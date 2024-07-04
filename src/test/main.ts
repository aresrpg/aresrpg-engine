import { ELogLevel, setVerbosity } from '../lib/index';

import { TestTerrain } from './test-terrain';
import { VoxelMap } from './voxel-map';

setVerbosity(ELogLevel.WARN);

const voxelMap = new VoxelMap(2048, 2048, 200, 64, 'fixed_seed');

const testScene = new TestTerrain(voxelMap);
testScene.start();
