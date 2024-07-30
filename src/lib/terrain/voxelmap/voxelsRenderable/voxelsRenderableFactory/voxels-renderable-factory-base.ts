import { nextPowerOfTwo } from '../../../../helpers/math';
import { vec3ToString } from '../../../../helpers/string';
import * as THREE from '../../../../three-usage';
import { type IVoxelMaterial } from '../../i-voxelmap';
import { type VoxelsMaterialUniforms, type VoxelsMaterials } from '../voxels-material';
import { VoxelsRenderable } from '../voxels-renderable';
import { type PackedUintFragment } from '../../../../helpers/uint-packing';

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

type Parameters = {
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly voxelTypeEncoder: PackedUintFragment;
    readonly noiseIdEncoder: PackedUintFragment;
    readonly noise?:
        | undefined
        | {
              readonly resolution: number;
              readonly textureBuilder?: () => THREE.DataTexture;
          };
};

abstract class VoxelsRenderableFactoryBase {
    public static readonly maxSmoothEdgeRadius = 0.3;

    public abstract readonly maxVoxelsChunkSize: THREE.Vector3;

    protected readonly texture: THREE.DataTexture;
    private readonly noiseTexture: THREE.DataTexture;

    protected readonly noiseResolution: number = 5;
    private readonly noiseTypesCount: number = 16;

    protected readonly uniformsTemplate: VoxelsMaterialUniforms;

    protected constructor(params: Parameters) {
        if (typeof params.noise !== 'undefined') {
            this.noiseResolution = params.noise.resolution;
        }
        if (this.noiseResolution <= 0) {
            throw new Error(`Noise resolution must be positive (is "${this.noiseResolution}").`);
        }

        let textureBuilder = () => VoxelsRenderableFactoryBase.buildNoiseTexture(this.noiseResolution, this.noiseTypesCount);
        if (params?.noise?.textureBuilder) {
            textureBuilder = params.noise.textureBuilder;
        }
        this.noiseTexture = textureBuilder();
        this.noiseTexture.needsUpdate = true;
        const noiseTextureSize = this.noiseTexture.image;
        if (noiseTextureSize.height !== this.noiseResolution) {
            throw new Error(`Noise texture should have a height of "${this.noiseResolution}" (has "${noiseTextureSize.height}").`);
        }
        const noiseTypesCount = noiseTextureSize.width / noiseTextureSize.height;
        if (!Number.isInteger(noiseTypesCount) || noiseTypesCount <= 0) {
            throw new Error(`Noise texture should have  width multiple of "${this.noiseResolution}" (has "${noiseTextureSize.width}").`);
        }
        if (noiseTypesCount > params.noiseIdEncoder.maxValue + 1) {
            throw new Error(`Cannot have more than "${params.noiseIdEncoder.maxValue + 1}" noises (has "${noiseTypesCount}").`);
        }
        this.noiseTypesCount = noiseTypesCount;

        this.texture = VoxelsRenderableFactoryBase.buildMaterialsTexture(params.voxelMaterialsList, params.voxelTypeEncoder);

        this.uniformsTemplate = {
            uDisplayMode: { value: 0 },
            uTexture: { value: this.texture },
            uNoiseTexture: { value: this.noiseTexture },
            uNoiseStrength: { value: 0 },
            uAoStrength: { value: 0 },
            uAoSpread: { value: 0 },
            uSmoothEdgeRadius: { value: 0 },
            uGridThickness: { value: 0.02 },
            uGridColor: { value: new THREE.Vector3(-0.2, -0.2, -0.2) },
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

    private static buildNoiseTexture(resolution: number, typesCount: number): THREE.DataTexture {
        const textureWidth = resolution * typesCount;
        const textureHeight = resolution;
        const textureData = new Uint8Array(4 * textureWidth * textureHeight);

        for (let i = 0; i < textureData.length; i++) {
            textureData[i] = 256 * Math.random();
        }

        // first two IDs are for checkerboard
        if (typesCount < 3) {
            throw new Error(`There should be at least 3 noise types.`);
        }
        for (let iY = 0; iY < resolution; iY++) {
            for (let iNoiseId = 0; iNoiseId < 2; iNoiseId++) {
                const value = iNoiseId * 255;
                for (let deltaX = 0; deltaX < resolution; deltaX++) {
                    const iX = iNoiseId * resolution + deltaX;
                    for (let iChannel = 0; iChannel < 4; iChannel++) {
                        textureData[4 * (iX + iY * textureWidth) + iChannel] = value;
                    }
                }
            }
        }
        return new THREE.DataTexture(textureData, textureWidth, textureHeight);
    }
}

export { VoxelsRenderableFactoryBase, type GeometryAndMaterial, type Parameters, type VertexData, type VoxelsChunkData };
