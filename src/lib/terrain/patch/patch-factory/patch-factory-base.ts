import * as THREE from '../../../three-usage';
import type { IVoxelMap, IVoxelMaterial } from '../../i-voxel-map';
import type { PatchMaterials, PatchMaterialUniforms } from '../material';
import { Patch } from '../patch';

import * as Cube from './cube';
import type { PackedUintFragment } from './uint-packing';

type GeometryAndMaterial = {
    readonly geometry: THREE.BufferGeometry;
    readonly materials: PatchMaterials;
};

type VertexData = {
    readonly localPosition: THREE.Vector3;
    readonly ao: number;
    readonly roundnessX: boolean;
    readonly roundnessY: boolean;
};

type FaceData = {
    readonly voxelLocalPosition: THREE.Vector3;
    readonly voxelMaterialId: number;
    readonly faceType: Cube.FaceType;
    readonly faceId: number;
    readonly verticesData: [VertexData, VertexData, VertexData, VertexData];
};

type LocalMapCache = {
    readonly data: Uint16Array;
    readonly size: THREE.Vector3;
    readonly isEmpty: boolean;
    neighbourExists(voxelIndex: number, neighbourRelativePosition: THREE.Vector3): boolean;
};

enum EPatchComputingMode {
    CPU_SIMPLE,
    CPU_CACHED,
    GPU_SEQUENTIAL,
    GPU_OPTIMIZED,
}

abstract class PatchFactoryBase {
    public static readonly maxSmoothEdgeRadius = 0.3;

    public abstract readonly maxPatchSize: THREE.Vector3;

    private readonly computingMode: EPatchComputingMode;

    protected readonly map: IVoxelMap;

    private readonly texture: THREE.Texture;
    private readonly noiseTexture: THREE.Texture;

    protected readonly noiseResolution = 5;
    protected readonly noiseTypes = 16;

    protected readonly uniformsTemplate: PatchMaterialUniforms;

    protected constructor(map: IVoxelMap, voxelTypeEncoder: PackedUintFragment, computingMode: EPatchComputingMode) {
        this.map = map;
        this.computingMode = computingMode;

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

            uLightColor: { value: new THREE.Color() },
            uAmbientIntensity: { value: 0 },
            uDiffuseDirection: { value: new THREE.Vector3() },
            uDiffuseIntensity: { value: 0 },
        };
        this.uniformsTemplate.uTexture.value = this.texture;
    }

    public async buildPatch(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<Patch | null> {
        patchStart = patchStart.clone();
        patchEnd = patchEnd.clone();

        const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
        if (patchSize.x > this.maxPatchSize.x || patchSize.y > this.maxPatchSize.y || patchSize.z > this.maxPatchSize.z) {
            const patchSizeAsString = `${patchSize.x}x${patchSize.y}x${patchSize.z}`;
            const maxPatchSizeAsString = `${this.maxPatchSize.x}x${this.maxPatchSize.y}x${this.maxPatchSize.z}`;
            throw new Error(`Patch is too big ${patchSizeAsString} (max is ${maxPatchSizeAsString})`);
        }

        const geometryAndMaterialsList = await this.computePatchData(patchStart, patchEnd);
        if (geometryAndMaterialsList.length === 0) {
            return null;
        }

        const boundingBox = new THREE.Box3(patchStart, patchEnd);
        const boundingSphere = new THREE.Sphere();
        boundingBox.getBoundingSphere(boundingSphere);

        return new Patch(
            geometryAndMaterialsList.map(geometryAndMaterial => {
                const { geometry } = geometryAndMaterial;
                geometry.boundingBox = boundingBox.clone();
                geometry.boundingSphere = boundingSphere.clone();

                const material = geometryAndMaterial.materials.material;
                const shadowMaterial = geometryAndMaterial.materials.shadowMaterial;
                const mesh = new THREE.Mesh(geometryAndMaterial.geometry, material);
                mesh.customDepthMaterial = shadowMaterial;
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                mesh.frustumCulled = false;
                mesh.translateX(patchStart.x);
                mesh.translateY(patchStart.y);
                mesh.translateZ(patchStart.z);

                const materials = {
                    material,
                    shadowMaterial,
                };
                return { mesh, materials };
            })
        );
    }

    public dispose(): void {
        this.disposeInternal();
        this.texture.dispose();
        this.noiseTexture.dispose();
    }

    protected *iterateOnVisibleFaces(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Generator<FaceData> {
        if (this.computingMode === EPatchComputingMode.CPU_SIMPLE) {
            for (const a of this.iterateOnVisibleFacesSimple(patchStart, patchEnd)) {
                yield a;
            }
        } else if (this.computingMode === EPatchComputingMode.CPU_CACHED) {
            const localMapCache = this.buildLocalMapCache(patchStart, patchEnd);
            for (const a of this.iterateOnVisibleFacesWithCache(localMapCache)) {
                yield a;
            }
        } else {
            throw new Error(`Unsupported patch computing mode ${this.computingMode}`);
        }
    }

    private *iterateOnVisibleFacesSimple(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Generator<FaceData> {
        for (const voxel of this.map.iterateOnVoxels(patchStart, patchEnd)) {
            const voxelWorldPosition = voxel.position;
            const voxelLocalPosition = new THREE.Vector3().subVectors(voxelWorldPosition, patchStart);

            for (const face of Object.values(Cube.faces)) {
                if (
                    this.map.voxelExists(
                        voxelWorldPosition.x + face.normal.x,
                        voxelWorldPosition.y + face.normal.y,
                        voxelWorldPosition.z + face.normal.z
                    )
                ) {
                    // this face will be hidden -> skip it
                    continue;
                }

                yield {
                    voxelLocalPosition,
                    voxelMaterialId: voxel.materialId,
                    faceType: face.type,
                    faceId: face.id,
                    verticesData: face.vertices.map((faceVertex: Cube.FaceVertex): VertexData => {
                        let ao = 0;
                        const [a, b, c] = faceVertex.shadowingNeighbourVoxels.map(neighbourVoxel =>
                            this.map.voxelExists(
                                voxelWorldPosition.x + neighbourVoxel.x,
                                voxelWorldPosition.y + neighbourVoxel.y,
                                voxelWorldPosition.z + neighbourVoxel.z
                            )
                        ) as [boolean, boolean, boolean];
                        if (a && b) {
                            ao = 3;
                        } else {
                            ao = +a + +b + +c;
                        }

                        let roundnessX = true;
                        let roundnessY = true;
                        if (faceVertex.edgeNeighbourVoxels) {
                            for (const neighbourVoxel of faceVertex.edgeNeighbourVoxels.x) {
                                roundnessX &&= !this.map.voxelExists(
                                    voxelWorldPosition.x + neighbourVoxel.x,
                                    voxelWorldPosition.y + neighbourVoxel.y,
                                    voxelWorldPosition.z + neighbourVoxel.z
                                );
                            }
                            for (const neighbourVoxel of faceVertex.edgeNeighbourVoxels.y) {
                                roundnessY &&= !this.map.voxelExists(
                                    voxelWorldPosition.x + neighbourVoxel.x,
                                    voxelWorldPosition.y + neighbourVoxel.y,
                                    voxelWorldPosition.z + neighbourVoxel.z
                                );
                            }
                        }
                        return {
                            localPosition: faceVertex.vertex,
                            ao,
                            roundnessX,
                            roundnessY,
                        };
                    }) as [VertexData, VertexData, VertexData, VertexData],
                };
            }
        }
    }

    private *iterateOnVisibleFacesWithCache(localMapCache: LocalMapCache): Generator<FaceData> {
        if (localMapCache.isEmpty) {
            return;
        }

        let cacheIndex = 0;
        const localPosition = new THREE.Vector3();
        for (localPosition.z = 0; localPosition.z < localMapCache.size.z; localPosition.z++) {
            for (localPosition.y = 0; localPosition.y < localMapCache.size.y; localPosition.y++) {
                for (localPosition.x = 0; localPosition.x < localMapCache.size.x; localPosition.x++) {
                    const cacheData = localMapCache.data[cacheIndex];
                    if (typeof cacheData === 'undefined') {
                        throw new Error();
                    }

                    if (cacheData > 0) {
                        // if there is a voxel there
                        if (
                            localPosition.x > 0 &&
                            localPosition.y > 0 &&
                            localPosition.z > 0 &&
                            localPosition.x < localMapCache.size.x - 1 &&
                            localPosition.y < localMapCache.size.y - 1 &&
                            localPosition.z < localMapCache.size.z - 1
                        ) {
                            const voxelLocalPosition = localPosition.clone().subScalar(1);
                            const voxelMaterialId = cacheData - 1;

                            for (const face of Object.values(Cube.faces)) {
                                if (localMapCache.neighbourExists(cacheIndex, face.normal)) {
                                    // this face will be hidden -> skip it
                                    continue;
                                }

                                yield {
                                    voxelLocalPosition,
                                    voxelMaterialId,
                                    faceType: face.type,
                                    faceId: face.id,
                                    verticesData: face.vertices.map((faceVertex: Cube.FaceVertex): VertexData => {
                                        let ao = 0;
                                        const [a, b, c] = faceVertex.shadowingNeighbourVoxels.map(neighbourVoxel =>
                                            localMapCache.neighbourExists(cacheIndex, neighbourVoxel)
                                        ) as [boolean, boolean, boolean];
                                        if (a && b) {
                                            ao = 3;
                                        } else {
                                            ao = +a + +b + +c;
                                        }

                                        let roundnessX = true;
                                        let roundnessY = true;
                                        for (const neighbourVoxel of faceVertex.edgeNeighbourVoxels.x) {
                                            roundnessX &&= !localMapCache.neighbourExists(cacheIndex, neighbourVoxel);
                                        }
                                        for (const neighbourVoxel of faceVertex.edgeNeighbourVoxels.y) {
                                            roundnessY &&= !localMapCache.neighbourExists(cacheIndex, neighbourVoxel);
                                        }

                                        return {
                                            localPosition: faceVertex.vertex,
                                            ao,
                                            roundnessX,
                                            roundnessY,
                                        };
                                    }) as [VertexData, VertexData, VertexData, VertexData],
                                };
                            }
                        }
                    }
                    cacheIndex++;
                }
            }
        }
    }

    protected abstract computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Promise<GeometryAndMaterial[]>;

    protected abstract disposeInternal(): void;

    protected buildLocalMapCache(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): LocalMapCache {
        const cacheStart = patchStart.clone().subScalar(1);
        const cacheEnd = patchEnd.clone().addScalar(1);
        const cacheSize = new THREE.Vector3().subVectors(cacheEnd, cacheStart);
        const cache = new Uint16Array(cacheSize.x * cacheSize.y * cacheSize.z);

        const indexFactor = { x: 1, y: cacheSize.x, z: cacheSize.x * cacheSize.y };

        const buildIndexUnsafe = (position: THREE.Vector3) => {
            return position.x * indexFactor.x + position.y * indexFactor.y + position.z * indexFactor.z;
        };
        const buildIndex = (position: THREE.Vector3) => {
            if (position.x < 0 || position.y < 0 || position.z < 0) {
                throw new Error();
            }
            return buildIndexUnsafe(position);
        };

        const neighbourExists = (index: number, neighbour: THREE.Vector3) => {
            const deltaIndex = buildIndexUnsafe(neighbour);
            const neighbourIndex = index + deltaIndex;
            const neighbourData = cache[neighbourIndex];
            if (typeof neighbourData === 'undefined') {
                throw new Error();
            }
            return neighbourData !== 0;
        };

        let isEmpty = true;
        for (const voxel of this.map.iterateOnVoxels(cacheStart, cacheEnd)) {
            const localPosition = new THREE.Vector3().subVectors(voxel.position, cacheStart);
            const cacheIndex = buildIndex(localPosition);
            cache[cacheIndex] = 1 + voxel.materialId;
            isEmpty = false;
        }

        return {
            data: cache,
            size: cacheSize,
            isEmpty,
            neighbourExists,
        };
    }

    private static buildMaterialsTexture(
        voxelMaterials: ReadonlyArray<IVoxelMaterial>,
        voxelTypeEncoder: PackedUintFragment
    ): THREE.Texture {
        const voxelTypesCount = voxelMaterials.length;
        const maxVoxelTypesSupported = voxelTypeEncoder.maxValue + 1;
        if (voxelTypesCount > maxVoxelTypesSupported) {
            throw new Error(`A map cannot have more than ${maxVoxelTypesSupported} voxel types (received ${voxelTypesCount}).`);
        }

        const textureWidth = voxelTypesCount;
        const textureHeight = 1;
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

export { EPatchComputingMode, PatchFactoryBase, type GeometryAndMaterial, type LocalMapCache, type VertexData };
