import { nextPowerOfTwo } from '../../../../helpers/math';
import { vec3ToString } from '../../../../helpers/string';
import * as THREE from '../../../../three-usage';
import { type IVoxelMaterial } from '../../i-voxelmap';
import { type VoxelsMaterialUniforms, type VoxelsMaterials } from '../voxels-material';
import { VoxelsRenderable } from '../voxels-renderable';

import { type PackedUintFragment } from './uint-packing';

type GeometryAndMaterial = {
    readonly id: string;
    readonly geometry: THREE.BufferGeometry;
    readonly materials: VoxelsMaterials;
    readonly trianglesCount: number;
    readonly gpuMemoryBytes: number;
};

type VertexData = {
    readonly localPosition: THREE.Vector3;
    readonly ao: number;
    readonly roundnessX: boolean;
    readonly roundnessY: boolean;
};

type VoxelsChunkData = {
    readonly size: THREE.Vector3;
    readonly data: Uint16Array;
    readonly isEmpty: boolean;
};

abstract class VoxelsRenderableFactoryBase {
    public static readonly maxSmoothEdgeRadius = 0.3;

    public abstract readonly maxVoxelsChunkSize: THREE.Vector3;

    protected readonly texture: THREE.DataTexture;
    private readonly noiseTexture: THREE.Texture;

    protected readonly noiseResolution = 5;
    protected readonly noiseTypes = 16;

    protected readonly uniformsTemplate: VoxelsMaterialUniforms;

    protected constructor(voxelMaterialsList: ReadonlyArray<IVoxelMaterial>, voxelTypeEncoder: PackedUintFragment) {
        this.texture = VoxelsRenderableFactoryBase.buildMaterialsTexture(voxelMaterialsList, voxelTypeEncoder);
        this.noiseTexture = VoxelsRenderableFactoryBase.buildNoiseTexture(this.noiseResolution, this.noiseTypes);

        this.uniformsTemplate = {
            uDisplayMode: { value: 0 },
            uTexture: { value: this.texture },
            uNoiseTexture: { value: this.noiseTexture },
            uNoiseStrength: { value: 0 },
            uAoStrength: { value: 0 },
            uAoSpread: { value: 0 },
            uSmoothEdgeRadius: { value: 0 },
            uSmoothEdgeMethod: { value: 0 },
        };
        this.uniformsTemplate.uTexture.value = this.texture;
    }

    public async buildVoxelsRenderable(voxelsChunkData: VoxelsChunkData): Promise<VoxelsRenderable | null> {
        const innerChunkSize = voxelsChunkData.size.clone().subScalar(2);
        if (
            innerChunkSize.x > this.maxVoxelsChunkSize.x ||
            innerChunkSize.y > this.maxVoxelsChunkSize.y ||
            innerChunkSize.z > this.maxVoxelsChunkSize.z
        ) {
            throw new Error(`Voxels chunk is too big ${vec3ToString(innerChunkSize)} (max is ${vec3ToString(this.maxVoxelsChunkSize)})`);
        }

        if (voxelsChunkData.isEmpty) {
            return null;
        }

        const geometryAndMaterialsList = await this.buildGeometryAndMaterials(voxelsChunkData);
        return this.assembleVoxelsRenderable(innerChunkSize, geometryAndMaterialsList);
    }

    public dispose(): void {
        this.disposeInternal();
        this.texture.dispose();
        this.noiseTexture.dispose();
    }

    public assembleVoxelsRenderable(size: THREE.Vector3, geometryAndMaterialsList: GeometryAndMaterial[]): VoxelsRenderable | null {
        if (geometryAndMaterialsList.length === 0) {
            return null;
        }

        const boundingBoxFrom = new THREE.Vector3(0, 0, 0);
        const boundingBoxTo = size.clone();
        const boundingBox = new THREE.Box3(boundingBoxFrom, boundingBoxTo);
        const boundingSphere = new THREE.Sphere();
        boundingBox.getBoundingSphere(boundingSphere);

        const voxelsRenderable = new VoxelsRenderable(
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

                const materials = {
                    material,
                    shadowMaterial,
                };
                return { mesh, materials, trianglesCount, gpuMemoryBytes };
            })
        );
        return voxelsRenderable;
    }

    public abstract buildGeometryAndMaterials(voxelsChunkData: VoxelsChunkData): Promise<GeometryAndMaterial[]>;

    protected abstract disposeInternal(): void;

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

export { VoxelsRenderableFactoryBase, type GeometryAndMaterial, type VertexData, type VoxelsChunkData };
