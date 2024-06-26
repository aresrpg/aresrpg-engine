import { Vector3Like } from '../three-usage';

enum EVoxelsPatchLoadingStatus {
    NOT_LOADED = 'not_loaded',
    LOADING = 'loading',
    LOADED = 'loaded',
}

enum EVoxelsPatchType {
    EMPTY = 'empty',
    FULL = 'full',
    COMPLEX = 'complex',
}

type VoxelsPatchData =
    | {
          readonly type: EVoxelsPatchType.COMPLEX;
          readonly size: Vector3Like;
          readonly data: Uint16Array;
      }
    | {
          readonly type: EVoxelsPatchType.EMPTY | EVoxelsPatchType.FULL;
      };

type VoxelsPatch =
    | {
          loadingStatus: EVoxelsPatchLoadingStatus.NOT_LOADED;
      }
    | {
          loadingStatus: EVoxelsPatchLoadingStatus.LOADING;
          patchDataPromise: Promise<VoxelsPatchData>;
      }
    | {
          loadingStatus: EVoxelsPatchLoadingStatus.LOADED;
          patchData: VoxelsPatchData;
      };

export { type VoxelsPatch, type VoxelsPatchData, EVoxelsPatchType, EVoxelsPatchLoadingStatus };
