import { logger } from '../../../../helpers/logger';
import { nextPowerOfTwo } from '../../../../helpers/math';
import { vec3ToString } from '../../../../helpers/string';
import { type PackedUintFragment } from '../../../../helpers/uint-packing';
import * as THREE from '../../../../libs/three-usage';
import { type IVoxelMaterial, type VoxelsChunkOrdering } from '../../i-voxelmap';
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
    readonly voxelMaterialsList: ReadonlyArray<IVoxelMaterial>;
    readonly voxelTypeEncoder: PackedUintFragment;
    readonly noiseResolution?: number | undefined;
    readonly checkerboardType?: undefined | CheckerboardType;
};

async function compressBuffer(buffer: ArrayBuffer): Promise<ArrayBuffer> {
    const stream = new ReadableStream({
        type: "bytes",
        start(controller) {
            controller.enqueue(new Uint8Array(buffer));
            controller.close();
        }
    });
    const readableCompressionStream = stream.pipeThrough(new CompressionStream("gzip"));
    const response = new Response(readableCompressionStream);
    return await response.arrayBuffer();
}

async function decompressBuffer(buffer: ArrayBuffer): Promise<ArrayBuffer> {
    const stream = new ReadableStream({
        type: "bytes",
        start(controller) {
            controller.enqueue(new Uint8Array(buffer));
            controller.close();
        }
    });
    const readableDecompressionStream = stream.pipeThrough(new DecompressionStream("gzip"));
    const response = new Response(readableDecompressionStream);
    return await response.arrayBuffer();
}

function bytesToString(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes.toLocaleString()}B`;
    }
    bytes /= 1024;
    if (bytes < 1024) {
        return `${bytes.toLocaleString()}KB`;
    }
    bytes /= 1024;
    if (bytes < 1024) {
        return `${bytes.toLocaleString()}MB`;
    }
    return `${bytes.toLocaleString()}GB`;
}

const compressionStats = {
    totalUncompressedSize: 0,
    totalCompressedSize: 0,
    totalTestedArraybuffersCount: 0,
    minUncompressedSize: Infinity,
    maxUncompressedSize: -Infinity,
    minCompressedSize: Infinity,
    maxCompressedSize: -Infinity,
    maxCompressionRatio: Infinity,
    minCompressionRatio: -Infinity,
};

window.setInterval(() => {
    const uncompressed = {
        average: compressionStats.totalUncompressedSize / compressionStats.totalTestedArraybuffersCount,
        min: compressionStats.minUncompressedSize,
        max: compressionStats.maxUncompressedSize,
    };
    const compressed = {
        average: compressionStats.totalCompressedSize / compressionStats.totalTestedArraybuffersCount,
        min: compressionStats.minCompressedSize,
        max: compressionStats.maxCompressedSize,
    };

    logger.warn(`Compression stats:
- tested ${compressionStats.totalTestedArraybuffersCount} arraybuffers
- uncompressed:
    - average size: ${bytesToString(uncompressed.average)}
    - min size:     ${bytesToString(uncompressed.min)}
    - max size:     ${bytesToString(uncompressed.max)}
- compressed:
    - average size: ${bytesToString(compressed.average)}\t${(100 * compressed.average / uncompressed.average).toFixed(1)} %
    - min size:     ${bytesToString(compressed.min)}\t${(100 * compressed.min / uncompressed.min).toFixed(1)} %
    - max size:     ${bytesToString(compressed.max)}\t${(100 * compressed.max / uncompressed.max).toFixed(1)} %
`);
}, 1000);

async function testBuffer(sourceBuffer: ArrayBuffer): Promise<void> {
    const uncompressedByteLength = sourceBuffer.byteLength;
    compressionStats.minUncompressedSize = Math.min(uncompressedByteLength, compressionStats.minUncompressedSize);
    compressionStats.maxUncompressedSize = Math.max(uncompressedByteLength, compressionStats.maxUncompressedSize);
    compressionStats.totalUncompressedSize += uncompressedByteLength

    const compressedArrayBuffer = await compressBuffer(sourceBuffer.slice(0, sourceBuffer.byteLength));
    const compressedByteLength = compressedArrayBuffer.byteLength;
    compressionStats.minCompressedSize = Math.min(compressedByteLength, compressionStats.minCompressedSize);
    compressionStats.maxCompressedSize = Math.max(compressedByteLength, compressionStats.maxCompressedSize);
    compressionStats.totalCompressedSize += compressedByteLength;

    const compressionRatio = compressionStats.totalCompressedSize / compressionStats.totalUncompressedSize;
    compressionStats.maxCompressionRatio = Math.min(compressionRatio, compressionStats.maxCompressionRatio);
    compressionStats.minCompressionRatio = Math.max(compressionRatio, compressionStats.minCompressionRatio);

    const decompressedBuffer = await decompressBuffer(compressedArrayBuffer);
    const decompressedByteLength = decompressedBuffer.byteLength;

    if (decompressedByteLength !== uncompressedByteLength) {
        throw new Error(`Compression/decompression went wrong: Decompressed length = ${decompressedByteLength} (expected ${uncompressedByteLength})`);
    }
    const sourceUint8 = new Uint8Array(sourceBuffer);
    const decompressedUint8 = new Uint8Array(decompressedBuffer);
    if (sourceUint8.length !== decompressedUint8.length) {
        throw new Error();
    }
    for (let i = 0; i < sourceUint8.length; i++) {
        if (sourceUint8[i] !== decompressedUint8[i]) {
            throw new Error(`Compression/decompression went wrong: data changed`);
        }
    }

    compressionStats.totalTestedArraybuffersCount++;
}

abstract class VoxelsRenderableFactoryBase {
    public static readonly maxSmoothEdgeRadius = 0.3;
    public static readonly maxShininess = 400;

    public abstract readonly maxVoxelsChunkSize: THREE.Vector3;

    protected readonly texture: THREE.DataTexture;
    private readonly noiseTexture: THREE.DataTexture;

    protected readonly noiseResolution: number = 5;
    protected readonly noiseTextureSize: number = 64;
    protected readonly checkerboardType: CheckerboardType = 'xyz';

    protected readonly uniformsTemplate: VoxelsMaterialUniforms;

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

        this.texture = VoxelsRenderableFactoryBase.buildMaterialsTexture(params.voxelMaterialsList, params.voxelTypeEncoder);

        this.uniformsTemplate = {
            uDisplayMode: { value: 0 },
            uTexture: { value: this.texture },
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
        this.uniformsTemplate.uTexture.value = this.texture;
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

        return this.buildGeometryAndMaterials(voxelsChunkData).then(async geometryAndMaterialsList => {
            for (const geometryAndMaterial of geometryAndMaterialsList) {
                for (const attribute of Object.values(geometryAndMaterial.geometry.attributes)) {
                    if (attribute instanceof THREE.InterleavedBufferAttribute) {
                        const array = attribute.data.array.buffer;
                        if (array instanceof ArrayBuffer) {
                            void testBuffer(array.slice(0, array.byteLength)); // tsignore
                            continue;
                        }
                    }
                    throw new Error();
                }
            }

            return this.assembleVoxelsRenderable(innerChunkSize, geometryAndMaterialsList);
        });
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
            const shininess = material.shininess ?? 0;
            // shininess cannot be 0 or it creates visual artifacts. Clamp it.
            textureData[4 * materialId + 3] = Math.max(1, (255 * shininess) / VoxelsRenderableFactoryBase.maxShininess);
        });
        const texture = new THREE.DataTexture(textureData, textureWidth, textureHeight);
        texture.needsUpdate = true;
        return texture;
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
