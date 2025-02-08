import { vec3ToString } from '../../../../helpers/string';
import { type PackedUintFragment } from '../../../../helpers/uint-packing';
import * as THREE from '../../../../libs/three-usage';
import { type MaterialsStore } from '../../../materials-store';
import { type VoxelsChunkOrdering } from '../../i-voxelmap';
import { type VoxelsMaterialUniforms, type VoxelsMaterials } from '../voxels-material';
import { VoxelsRenderable } from '../voxels-renderable';

type GeometryAndMaterial = {
    readonly id: string;
    readonly geometry: THREE.BufferGeometry;
    readonly materials: VoxelsMaterials;
    readonly trianglesCount: number;
    readonly gpuMemoryBytes: number;
};

type VertexData = {
    readonly localPosition: THREE.Vector3Like;
    readonly ao: number;
    readonly roundnessX: boolean;
    readonly roundnessY: boolean;
};

type VoxelsChunkDataEmpty = {
    readonly size: THREE.Vector3;
    readonly isEmpty: true;
};
type VoxelsChunkDataNotEmpty = {
    readonly size: THREE.Vector3;
    readonly data: Uint16Array;
    readonly dataOrdering: VoxelsChunkOrdering;
    readonly isEmpty: false;
};
type VoxelsChunkData = VoxelsChunkDataEmpty | VoxelsChunkDataNotEmpty;

type CheckerboardType = 'x' | 'y' | 'z' | 'xy' | 'xz' | 'yz' | 'xyz';

type Parameters = {
    readonly voxelMaterialsStore: MaterialsStore;
    readonly voxelTypeEncoder: PackedUintFragment;
    readonly noiseResolution?: number | undefined;
    readonly checkerboardType?: undefined | CheckerboardType;
};

abstract class VoxelsRenderableFactoryBase {
    public static readonly maxSmoothEdgeRadius = 0.3;

    public abstract readonly maxVoxelsChunkSize: THREE.Vector3;

    protected readonly voxelsMaterialsStore: MaterialsStore;

    private readonly noiseTexture: THREE.DataTexture;
    protected readonly noiseResolution: number = 5;
    protected readonly noiseTextureSize: number = 64;
    protected readonly checkerboardType: CheckerboardType = 'xyz';

    protected constructor(params: Parameters) {
        if (typeof params.noiseResolution !== 'undefined') {
            this.noiseResolution = params.noiseResolution;
        }
        if (this.noiseResolution <= 0 || !Number.isInteger(this.noiseResolution)) {
            throw new Error(`Noise resolution must be positive (is "${this.noiseResolution}").`);
        }

        if (typeof params.checkerboardType !== 'undefined') {
            this.checkerboardType = params.checkerboardType;
        }

        this.noiseTexture = VoxelsRenderableFactoryBase.buildNoiseTexture(this.noiseTextureSize);
        this.noiseTexture.needsUpdate = true;

        const maxVoxelTypesSupported = params.voxelTypeEncoder.maxValue + 1;
        if (params.voxelMaterialsStore.materialsCount > maxVoxelTypesSupported) {
            throw new Error(
                `A map cannot have more than ${maxVoxelTypesSupported} voxel types (received ${params.voxelMaterialsStore.materialsCount}).`
            );
        }

        this.voxelsMaterialsStore = params.voxelMaterialsStore;
    }

    public buildVoxelsRenderable(voxelsChunkData: VoxelsChunkData): null | Promise<VoxelsRenderable | null> {
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

        return this.buildGeometryAndMaterials(voxelsChunkData).then(geometryAndMaterialsList => {
            return this.assembleVoxelsRenderable(innerChunkSize, geometryAndMaterialsList);
        });
    }

    public dispose(): void {
        this.noiseTexture.dispose();
    }

    public assembleVoxelsRenderable(
        size: THREE.Vector3,
        geometryAndMaterialsList: ReadonlyArray<GeometryAndMaterial>
    ): VoxelsRenderable | null {
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

                const mesh = new THREE.Mesh(geometryAndMaterial.geometry);
                mesh.name = geometryAndMaterial.id;
                mesh.customDepthMaterial = geometryAndMaterial.materials.shadowMaterial;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.frustumCulled = true;

                return { mesh, materials: geometryAndMaterial.materials, trianglesCount, gpuMemoryBytes };
            })
        );
        return voxelsRenderable;
    }

    public abstract buildGeometryAndMaterials(voxelsChunkData: VoxelsChunkDataNotEmpty): Promise<GeometryAndMaterial[]>;

    protected buildDefaultUniforms(): VoxelsMaterialUniforms {
        return {
            uDisplayMode: { value: 0 },
            uTexture: { value: this.voxelsMaterialsStore.texture },
            uDissolveRatio: { value: 0 },
            uNoiseTexture: { value: this.noiseTexture },
            uNoiseStrength: { value: 0 },
            uCheckerboardStrength: { value: 0 },
            uAoStrength: { value: 0 },
            uAoSpread: { value: 0 },
            uSmoothEdgeRadius: { value: 0 },
            uGridThickness: { value: 0.02 },
            uGridColor: { value: new THREE.Vector3(-0.2, -0.2, -0.2) },
            uShininessStrength: { value: 1 },
        };
    }

    private static buildNoiseTexture(resolution: number): THREE.DataTexture {
        const textureWidth = resolution;
        const textureHeight = resolution;
        const textureData = new Uint8Array(textureWidth * textureHeight);

        for (let i = 0; i < textureData.length; i++) {
            textureData[i] = 256 * Math.random();
        }

        return new THREE.DataTexture(textureData, textureWidth, textureHeight, THREE.RedFormat);
    }
}

export {
    VoxelsRenderableFactoryBase,
    type CheckerboardType,
    type GeometryAndMaterial,
    type Parameters,
    type VertexData,
    type VoxelsChunkData,
    type VoxelsChunkDataEmpty,
    type VoxelsChunkDataNotEmpty,
};
