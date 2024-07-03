import * as THREE from '../three-usage';

import { HeightmapViewer } from './heightmap/heightmap-viewer';
import { type IHeightmap } from './heightmap/i-heightmap';
import { type VoxelsChunkSize } from './terrain';
import { PatchId } from './voxelmap/patch/patch-id';
import { EVoxelsDisplayMode } from './voxelmap/voxelsRenderable/voxels-material';
import { type VoxelsRenderable } from './voxelmap/voxelsRenderable/voxels-renderable';

type PatchRenderable = {
    readonly id: PatchId;
    readonly voxelsRenderable: VoxelsRenderable;
};

abstract class TerrainBase {
    /**
     * The three.js object containing the renderable map.
     */
    public readonly container: THREE.Object3D;

    public readonly parameters = {
        shadows: {
            cast: true,
            receive: true,
        },
        voxels: {
            faces: {
                displayMode: EVoxelsDisplayMode.TEXTURED,
                noiseStrength: 0.025,
            },
            smoothEdges: {
                enabled: true,
                radius: 0.1,
                quality: 2,
            },
            ao: {
                enabled: true,
                strength: 0.4,
                spread: 0.85,
            },
        },
        lod: {
            enabled: true,
            wireframe: false,
        },
    };

    protected readonly patchesContainer: THREE.Group;
    protected readonly heightmapContainer: THREE.Group;

    protected readonly patchSize: THREE.Vector3;

    protected readonly heightmapViewer: HeightmapViewer;
    protected heightmapViewerNeedsUpdate: boolean = true;

    private readonly minPatchIdY: number;
    private readonly maxPatchIdY: number;

    protected constructor(map: IHeightmap, voxelsChunksSize: VoxelsChunkSize) {
        this.patchSize = new THREE.Vector3(voxelsChunksSize.xz, voxelsChunksSize.y, voxelsChunksSize.xz);

        this.minPatchIdY = Math.floor(map.minAltitude / this.patchSize.y);
        this.maxPatchIdY = Math.floor(map.maxAltitude / this.patchSize.y);

        this.container = new THREE.Group();
        this.container.name = 'Terrain container';
        this.container.matrixAutoUpdate = false; // do not always update world matrix in updateMatrixWorld()
        this.container.matrixWorldAutoUpdate = false; // tell the parent to not always call updateMatrixWorld()

        this.patchesContainer = new THREE.Group();
        this.patchesContainer.name = 'Voxel patches container';
        this.container.add(this.patchesContainer);

        this.heightmapContainer = new THREE.Group();
        this.heightmapContainer.name = `Heightmap patches container`;
        this.heightmapViewer = new HeightmapViewer(map, voxelsChunksSize.xz);
        this.heightmapContainer.add(this.heightmapViewer.container);
    }

    /**
     * Call this method before rendering.
     * */
    public update(): void {
        const allVisiblePatches = this.allVisiblePatches;

        const voxelsSettings = this.parameters.voxels;
        for (const patch of allVisiblePatches) {
            const voxelsRenderable = patch.voxelsRenderable;

            voxelsRenderable.parameters.voxels.displayMode = voxelsSettings.faces.displayMode;
            voxelsRenderable.parameters.voxels.noiseStrength = voxelsSettings.faces.noiseStrength;

            voxelsRenderable.parameters.smoothEdges.enabled = voxelsSettings.smoothEdges.enabled;
            voxelsRenderable.parameters.smoothEdges.radius = voxelsSettings.smoothEdges.radius;
            voxelsRenderable.parameters.smoothEdges.quality = voxelsSettings.smoothEdges.quality;

            voxelsRenderable.parameters.ao.enabled = voxelsSettings.ao.enabled;
            voxelsRenderable.parameters.ao.strength = voxelsSettings.ao.strength;
            voxelsRenderable.parameters.ao.spread = voxelsSettings.ao.spread;

            voxelsRenderable.parameters.shadows = this.parameters.shadows;

            voxelsRenderable.updateUniforms();
        }

        if (this.parameters.lod.enabled) {
            if (!this.heightmapContainer.parent) {
                this.container.add(this.heightmapContainer);
            }

            this.heightmapViewer.wireframe = this.parameters.lod.wireframe;

            if (this.heightmapViewerNeedsUpdate) {
                this.heightmapViewer.resetSubdivisions();
                for (const completeChunksColumn of this.getCompleteChunksColumns(allVisiblePatches)) {
                    this.heightmapViewer.hidePatch(completeChunksColumn.x, completeChunksColumn.z);
                }
                this.heightmapViewer.applyVisibility();
                this.heightmapViewer.updateMesh();

                this.heightmapViewerNeedsUpdate = false;
            }
        } else if (this.heightmapContainer.parent) {
            this.container.remove(this.heightmapContainer);
        }
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

    protected abstract get allVisiblePatches(): PatchRenderable[];
    protected abstract isPatchAttached(patchId: PatchId): boolean;

    protected getCompleteChunksColumns(visiblePatches: PatchRenderable[]): { x: number; z: number }[] {
        const result: Record<string, { x: number; z: number }> = {};

        const minPatchIdY = this.minPatchIdY;
        const maxPatchIdY = this.maxPatchIdY;

        for (const patch of visiblePatches) {
            let isWholeColumnDisplayed = true;

            for (let iY = minPatchIdY; iY < maxPatchIdY; iY++) {
                const id = new PatchId({ x: patch.id.x, y: iY, z: patch.id.z });
                if (!this.isPatchAttached(id)) {
                    isWholeColumnDisplayed = false;
                    break;
                }
            }

            if (isWholeColumnDisplayed) {
                const id = `${patch.id.x}_${patch.id.z}`;
                result[id] = patch.id;
            }
        }

        return Object.values(result);
    }
}

export { TerrainBase, type PatchRenderable };
