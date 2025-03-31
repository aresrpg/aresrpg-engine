import { disableMatrixAutoupdate } from '../helpers/misc';
import * as THREE from '../libs/three-usage';

import { type IHeightmapViewer } from './heightmap/i-heightmap-viewer';
import { type IVoxelmapViewer } from './voxelmap/i-voxelmap-viewer';
import { type VoxelmapStatistics } from './voxelmap/viewer/voxelmap-viewer-base';

type TerrainStatistics = {
    voxelmap: VoxelmapStatistics;
    heightmap: object;
};

class TerrainViewer {
    /**
     * The three.js object containing the renderable map.
     */
    public readonly container: THREE.Object3D;

    protected readonly voxelmapViewer: IVoxelmapViewer;
    protected readonly heightmapViewer: IHeightmapViewer;
    protected heightmapViewerNeedsUpdate: boolean = true;

    private lastHeightmapUpdateTimestamp: number | null = null;

    public constructor(heightmapViewer: IHeightmapViewer, voxelmapViewer: IVoxelmapViewer) {
        this.container = new THREE.Group();
        this.container.name = 'terrain-container';
        disableMatrixAutoupdate(this.container);

        if (voxelmapViewer.chunkSize.xz !== heightmapViewer.basePatchSize) {
            throw new Error(
                `Heightmap viewer and voxelmap viewer don't have the same patch size (${heightmapViewer.basePatchSize} and ${voxelmapViewer.chunkSize.xz}).`
            );
        }

        this.voxelmapViewer = voxelmapViewer;
        this.container.add(this.voxelmapViewer.container);

        this.heightmapViewer = heightmapViewer;
        this.container.add(this.heightmapViewer.container);

        this.voxelmapViewer.onChange.push(() => {
            this.heightmapViewerNeedsUpdate = true;
        });
    }

    /**
     * Call this method before rendering.
     * */
    public update(renderer: THREE.WebGLRenderer): void {
        this.voxelmapViewer.update();
        this.updateHeightmap(renderer);
    }

    /**
     * Requests for the LOD map to be precise around a certain position
     * @param focusPoint Coords in voxels of the point to focus
     * @param focusDistance Radius in voxels of the area that must use max LOD quality
     * @param maxVisibilityDistance Radius in voxel of the area that mus be visible
     */
    public setLod(focusPoint: THREE.Vector3Like, focusDistance: number, maxVisibilityDistance: number): void {
        this.heightmapViewer.focusPoint = new THREE.Vector2(focusPoint.x, focusPoint.z);
        this.heightmapViewer.focusDistance = focusDistance;
        this.heightmapViewer.visibilityDistance = maxVisibilityDistance;
        this.heightmapViewerNeedsUpdate = true;
    }

    /**
     * Computes and returns technical statistics about the terrain.
     */
    public getStatistics(): TerrainStatistics {
        return {
            voxelmap: this.voxelmapViewer.getStatistics(),
            heightmap: this.heightmapViewer.getStatistics(),
        };
    }

    private updateHeightmap(renderer: THREE.WebGLRenderer): void {
        if (!this.heightmapViewer.enabled) {
            this.lastHeightmapUpdateTimestamp = null;
            this.heightmapViewerNeedsUpdate = true;
            return;
        }

        const now = performance.now();
        if (this.lastHeightmapUpdateTimestamp && now - this.lastHeightmapUpdateTimestamp < 50) {
            return;
        }
        this.lastHeightmapUpdateTimestamp = now;

        if (this.heightmapViewerNeedsUpdate) {
            const completeChunksColumns = this.voxelmapViewer.getCompleteChunksColumns();
            this.heightmapViewer.setHiddenPatches(completeChunksColumns);
            this.heightmapViewerNeedsUpdate = false;
        }

        this.heightmapViewer.update(renderer);
    }
}

export { TerrainViewer };
