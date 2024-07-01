import { nextPowerOfTwo } from '../../../helpers/math';
import * as THREE from '../../../three-usage';
import type { IVoxelMap, IVoxelMaterial } from '../../i-voxel-map';
import type { PatchMaterialUniforms, PatchMaterials } from '../material';
import { Patch } from '../patch';
import { PatchId } from '../patch-id';

import type { PackedUintFragment } from './uint-packing';

type GeometryAndMaterial = {
    readonly id: string;
    readonly geometry: THREE.BufferGeometry;
    readonly materials: PatchMaterials;
    readonly trianglesCount: number;
    readonly gpuMemoryBytes: number;
};

type VertexData = {
    readonly localPosition: THREE.Vector3;
    readonly ao: number;
    readonly roundnessX: boolean;
    readonly roundnessY: boolean;
};

type LocalMapData = {
    readonly size: THREE.Vector3;
    readonly data: Uint16Array;
    readonly isEmpty: boolean;
};

abstract class PatchFactoryBase {
    public static readonly maxSmoothEdgeRadius = 0.3;

    public abstract readonly maxPatchSize: THREE.Vector3;

    protected readonly map: IVoxelMap;

    protected readonly texture: THREE.DataTexture;
    private readonly noiseTexture: THREE.Texture;

    protected readonly noiseResolution = 5;
    protected readonly noiseTypes = 16;

    protected readonly uniformsTemplate: PatchMaterialUniforms;

    protected constructor(map: IVoxelMap, voxelTypeEncoder: PackedUintFragment) {
        this.map = map;

        this.texture = PatchFactoryBase.buildMaterialsTexture(map.voxelMaterialsList, voxelTypeEncoder);
        this.noiseTexture = PatchFactoryBase.buildNoiseTexture(this.noiseResolution, this.noiseTypes);

        this.uniformsTemplate = {
            uDisplayMode: { value: 0 },
            uTexture: { value: this.texture },
            uNoiseTexture: { value: this.noiseTexture },
            uNoiseStrength: { value: 0 },
            uAoStrength: { value: 0 },
            uAoSpread: { value: 0 },
            uSmoothEdgeRadius: { value: 0 },
            uSmoothEdgeMethod: { value: 0 },

            uLightColor: { value: new THREE.Color(0xffffff) },
            uAmbientIntensity: { value: 0.7 },
            uDiffuseDirection: { value: new THREE.Vector3(1, 1, 1).normalize() },
            uDiffuseIntensity: { value: 0.8 },
        };
        this.uniformsTemplate.uTexture.value = this.texture;
    }

    public async buildPatch(patchId: PatchId, patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<Patch | null> {
        patchStart = patchStart.clone();
        patchEnd = patchEnd.clone();

        const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
        if (patchSize.x > this.maxPatchSize.x || patchSize.y > this.maxPatchSize.y || patchSize.z > this.maxPatchSize.z) {
            const patchSizeAsString = `${patchSize.x}x${patchSize.y}x${patchSize.z}`;
            const maxPatchSizeAsString = `${this.maxPatchSize.x}x${this.maxPatchSize.y}x${this.maxPatchSize.z}`;
            throw new Error(`Patch is too big ${patchSizeAsString} (max is ${maxPatchSizeAsString})`);
        }

        const geometryAndMaterialsList = await this.buildGeometryAndMaterials(patchStart, patchEnd);
        return this.assemblePatch(patchId, patchStart, patchEnd, geometryAndMaterialsList);
    }

    public dispose(): void {
        this.disposeInternal();
        this.texture.dispose();
        this.noiseTexture.dispose();
    }

    private assemblePatch(
        patchId: PatchId,
        patchStart: THREE.Vector3,
        patchEnd: THREE.Vector3,
        geometryAndMaterialsList: GeometryAndMaterial[]
    ): Patch | null {
        if (geometryAndMaterialsList.length === 0) {
            return null;
        }

        const boundingBoxFrom = new THREE.Vector3(0, 0, 0);
        const boundingBoxTo = patchEnd.clone().sub(patchStart);
        const boundingBox = new THREE.Box3(boundingBoxFrom, boundingBoxTo);
        const boundingSphere = new THREE.Sphere();
        boundingBox.getBoundingSphere(boundingSphere);

        return new Patch(
            patchId,
            geometryAndMaterialsList.map(geometryAndMaterial => {
                const { geometry, trianglesCount, gpuMemoryBytes } = geometryAndMaterial;
                geometry.boundingBox = boundingBox.clone();
                geometry.boundingSphere = boundingSphere.clone();

                const material = geometryAndMaterial.materials.material;
                const shadowMaterial = geometryAndMaterial.materials.shadowMaterial;
                const mesh = new THREE.Mesh(geometryAndMaterial.geometry, material);
                mesh.name = geometryAndMaterial.id;
                mesh.customDepthMaterial = shadowMaterial;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.frustumCulled = true;
                mesh.translateX(patchStart.x);
                mesh.translateY(patchStart.y);
                mesh.translateZ(patchStart.z);

                const materials = {
                    material,
                    shadowMaterial,
                };
                return { mesh, materials, trianglesCount, gpuMemoryBytes };
            })
        );
    }

    protected abstract buildGeometryAndMaterials(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]>;

    protected abstract disposeInternal(): void;

    protected async buildLocalMapData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<LocalMapData> {
        const cacheStart = patchStart.clone().subScalar(1);
        const cacheEnd = patchEnd.clone().addScalar(1);
        const cacheSize = new THREE.Vector3().subVectors(cacheEnd, cacheStart);

        const localMapData = await this.map.getLocalMapData(cacheStart, cacheEnd);

        const expectedCacheItemsCount = cacheSize.x * cacheSize.y * cacheSize.z;
        if (localMapData.data.length !== expectedCacheItemsCount) {
            throw new Error(`Invalid cache length. Should be ${expectedCacheItemsCount} items but is ${localMapData.data.length} items`);
        }

        return Object.assign(localMapData, {
            size: cacheSize,
        });
    }

    private static buildMaterialsTexture(
        voxelMaterials: ReadonlyArray<IVoxelMaterial>,
        voxelTypeEncoder: PackedUintFragment
    ): THREE.DataTexture {
        const voxelTypesCount = voxelMaterials.length;
        const maxVoxelTypesSupported = voxelTypeEncoder.maxValue + 1;
        if (voxelTypesCount > maxVoxelTypesSupported) {
            throw new Error(`A map cannot have more than ${maxVoxelTypesSupported} voxel types (received ${voxelTypesCount}).`);
        }

        const maxTextureWidth = 256;
        const idealTextureWidth = nextPowerOfTwo(voxelTypesCount);
        const textureWidth = Math.min(idealTextureWidth, maxTextureWidth);
        const textureHeight = Math.ceil(voxelTypesCount / textureWidth);
        const textureData = new Uint8Array(4 * textureWidth * textureHeight);

        voxelMaterials.forEach((material: IVoxelMaterial, materialId: number) => {
            textureData[4 * materialId + 0] = 255 * material.color.r;
            textureData[4 * materialId + 1] = 255 * material.color.g;
            textureData[4 * materialId + 2] = 255 * material.color.b;
            textureData[4 * materialId + 3] = 255;
        });
        const texture = new THREE.DataTexture(textureData, textureWidth, textureHeight);
        texture.needsUpdate = true;
        return texture;
    }

    private static buildNoiseTexture(resolution: number, typesCount: number): THREE.Texture {
        const textureWidth = resolution * typesCount;
        const textureHeight = resolution;
        const textureData = new Uint8Array(4 * textureWidth * textureHeight);

        for (let i = 0; i < textureData.length; i++) {
            textureData[i] = 256 * Math.random();
        }
        const texture = new THREE.DataTexture(textureData, textureWidth, textureHeight);
        texture.needsUpdate = true;
        return texture;
    }
}

export { PatchFactoryBase, type GeometryAndMaterial, type LocalMapData, type VertexData };
