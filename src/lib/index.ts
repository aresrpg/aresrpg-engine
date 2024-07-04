export { ELogLevel, setVerbosity } from './helpers/logger';
export type { IHeightmap, IHeightmapCoords, IHeightmapSample } from './terrain/heightmap/i-heightmap';
export { TerrainViewer } from './terrain/terrain-viewer';
export type { ILocalMapData, IVoxelMap, IVoxelMaterial, VoxelsChunkSize } from './terrain/voxelmap/i-voxelmap';

export {
    VoxelmapViewer,
    type ComputationStatus,
    type VoxelmapViewerOptions,
    type VoxelsChunkData,
} from './terrain/voxelmap/viewer/simple/voxelmap-viewer';
export {
    VoxelmapViewerAutonomous,
    type VoxelmapViewerAutonomousOptions,
} from './terrain/voxelmap/viewer/autonomous/voxelmap-viewer-autonomous';
