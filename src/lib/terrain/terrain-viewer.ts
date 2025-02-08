import * as THREE from '../libs/three-usage';

import { type IHeightmapViewer } from './heightmap/i-heightmap-viewer';
import { type IVoxelmapViewer } from './voxelmap/viewer/i-voxelmap-viewer';
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

    public readonly parameters = {
        lod: {
            enabled: true,
            wireframe: false,
        },
    };

    protected readonly voxelmapViewer: IVoxelmapViewer;
    protected readonly heightmapViewer: IHeightmapViewer;
    protected heightmapViewerNeedsUpdate: boolean = true;

    private lastHeightmapUpdateTimestamp: number | null = null;

    public constructor(heightmapViewer: IHeightmapViewer, voxelmapViewer: IVoxelmapViewer) {
        this.container = new THREE.Group();
        this.container.name = 'terrain-container';
        this.container.matrixAutoUpdate = false; // do not always update world matrix in updateMatrixWorld()
        this.container.matrixWorldAutoUpdate = false; // tell the parent to not always call updateMatrixWorld()

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
        const now = performance.now();
        if (this.lastHeightmapUpdateTimestamp && now - this.lastHeightmapUpdateTimestamp < 50) {
            return;
        }
        this.lastHeightmapUpdateTimestamp = now;

        const heightmapContainer = this.heightmapViewer.container;
        if (this.parameters.lod.enabled) {
            if (!heightmapContainer.parent) {
                this.container.add(heightmapContainer);
            }

            if (this.heightmapViewerNeedsUpdate) {
                const completeChunksColumns = this.voxelmapViewer.getCompleteChunksColumns();
                this.heightmapViewer.setHiddenPatches(completeChunksColumns);
                this.heightmapViewerNeedsUpdate = false;
            }

            this.heightmapViewer.wireframe = this.parameters.lod.wireframe;
            this.heightmapViewer.update(renderer);
        } else {
            heightmapContainer.removeFromParent();
        }
    }
}

export { TerrainViewer };
