import * as THREE from '../three-usage';

import { IVoxelMap } from './i-voxel-map';
import { EDisplayMode, Patch } from './patch/patch';
import { EPatchComputingMode, PatchFactoryBase } from './patch/patch-factory/patch-factory-base';
import { PatchFactorySplit } from './patch/patch-factory/split/patch-factory-split';

type TerrainOptions = {
    computingMode?: EPatchComputingMode,
};

/**
 * Class that takes an IVoxelMap and makes a renderable three.js object of it.
 */
class Terrain {
    /**
     * The three.js object containing the renderable map.
     */
    public readonly container: THREE.Object3D;

    public readonly parameters = {
        voxels: {
            displayMode: EDisplayMode.TEXTURES,
            noiseStrength: 0.025,
        },
        lighting: {
            ambient: 0.7,
            diffuse: 0.8,
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
    };

    private readonly map: IVoxelMap;
    private readonly patchFactory: PatchFactoryBase;
    private readonly patchSize: THREE.Vector3;

    private readonly patches: Record<string, Patch | null> = {};

    /**
     *
     * @param map The map that will be rendered.
     */
    public constructor(map: IVoxelMap, options?: TerrainOptions) {
        this.map = map;

        let computingMode = EPatchComputingMode.CPU_CACHED;
        if (options) {
            if (typeof options.computingMode !== "undefined") {
                computingMode = options.computingMode;
            }
        }
        this.patchFactory = new PatchFactorySplit(map, computingMode);

        this.patchSize = this.patchFactory.maxPatchSize.clone();
        console.log(`Using max patch size ${this.patchSize.x}x${this.patchSize.y}x${this.patchSize.z}.`);

        this.container = new THREE.Group();
    }

    /**
     * Makes the whole make visible.
     */
    public showEntireMap(): void {
        const patchStart = new THREE.Vector3();
        for (patchStart.x = 0; patchStart.x < this.map.size.x; patchStart.x += this.patchSize.x) {
            for (patchStart.y = 0; patchStart.y < this.map.size.y; patchStart.y += this.patchSize.y) {
                for (patchStart.z = 0; patchStart.z < this.map.size.z; patchStart.z += this.patchSize.z) {
                    const patch = this.getPatch(patchStart);
                    if (patch) {
                        patch.container.visible = true;
                    }
                }
            }
        }
    }

    /**
     * Only makes visible the portion of the map that is around a given position.
     * @param position The position around which the map will be made visible.
     * @param radius The visibility radius, in voxels.
     */
    public showMapAroundPosition(position: THREE.Vector3, radius: number): void {
        const voxelFrom = new THREE.Vector3().copy(position).subScalar(radius);
        const voxelTo = new THREE.Vector3().copy(position).addScalar(radius);
        const patchIdFrom = voxelFrom.divide(this.patchSize).floor();
        const patchIdTo = voxelTo.divide(this.patchSize).ceil();

        for (const patch of Object.values(this.patches)) {
            if (patch) {
                patch.container.visible = false;
            }
        }

        const patchId = new THREE.Vector3();
        for (patchId.x = patchIdFrom.x; patchId.x < patchIdTo.x; patchId.x++) {
            for (patchId.y = patchIdFrom.y; patchId.y < patchIdTo.y; patchId.y++) {
                for (patchId.z = patchIdFrom.z; patchId.z < patchIdTo.z; patchId.z++) {
                    const patchStart = new THREE.Vector3().multiplyVectors(patchId, this.patchSize);
                    const patch = this.getPatch(patchStart);
                    if (patch) {
                        patch.container.visible = true;
                    }
                }
            }
        }
    }

    /** Call this method before rendering. */
    public updateUniforms(): void {
        for (const patch of Object.values(this.patches)) {
            if (patch) {
                patch.parameters.voxels.displayMode = this.parameters.voxels.displayMode;
                patch.parameters.voxels.noiseStrength = this.parameters.voxels.noiseStrength;

                patch.parameters.lighting.ambient = this.parameters.lighting.ambient;
                patch.parameters.lighting.diffuse = this.parameters.lighting.diffuse;

                patch.parameters.smoothEdges.enabled = this.parameters.smoothEdges.enabled;
                patch.parameters.smoothEdges.radius = this.parameters.smoothEdges.radius;
                patch.parameters.smoothEdges.quality = this.parameters.smoothEdges.quality;

                patch.parameters.ao.enabled = this.parameters.ao.enabled;
                patch.parameters.ao.strength = this.parameters.ao.strength;
                patch.parameters.ao.spread = this.parameters.ao.spread;
                patch.updateUniforms();
            }
        }
    }

    /**
     * Deletes all the geometry data stored on the GPU.
     * It will be recomputed if needed again.
     */
    public clear(): void {
        for (const [patchId, patch] of Object.entries(this.patches)) {
            patch?.dispose();
            this.container.clear();
            delete this.patches[patchId];
        }
    }

    /**
     * Frees the GPU-related resources allocated by this instance. Call this method whenever this instance is no longer used in your app.
     */
    public dispose(): void {
        this.clear();
        this.patchFactory.dispose();
    }

    private getPatch(patchStart: THREE.Vector3): Patch | null {
        const patchId = this.computePatchId(patchStart);

        let patch = this.patches[patchId];
        if (typeof patch === 'undefined') {
            const patchEnd = new THREE.Vector3().addVectors(patchStart, this.patchSize);

            patch = this.patchFactory.buildPatch(patchStart, patchEnd);
            if (patch) {
                patch.container.visible = false;
                this.container.add(patch.container);
            }
            this.patches[patchId] = patch;
        }
        return patch;
    }

    private computePatchId(patchStart: THREE.Vector3): string {
        return `${patchStart.x / this.patchSize.x}_${patchStart.y / this.patchSize.y}_${patchStart.z / this.patchSize.z}`;
    }
}

export { EPatchComputingMode, Terrain, type IVoxelMap };

