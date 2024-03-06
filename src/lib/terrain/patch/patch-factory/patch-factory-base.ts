import * as THREE from '../../../three-usage';
import type { IVoxelMap, IVoxelMaterial } from '../../i-voxel-map';
import type { PatchMaterial, PatchMaterialUniforms } from '../material';
import { Patch } from '../patch';

import * as Cube from './cube';
import type { PackedUintFragment } from './uint-packing';

type GeometryAndMaterial = {
  readonly geometry: THREE.BufferGeometry;
  readonly material: PatchMaterial;
};

type VertexData = {
  readonly localPosition: THREE.Vector3;
  readonly ao: number;
  readonly roundnessX: boolean;
  readonly roundnessY: boolean;
};

type FaceData = {
  readonly voxelWorldPosition: THREE.Vector3;
  readonly voxelLocalPosition: THREE.Vector3;
  readonly voxelMaterialId: number;
  readonly faceType: Cube.FaceType;
  readonly faceId: number;
  readonly verticesData: [VertexData, VertexData, VertexData, VertexData];
};

abstract class PatchFactoryBase {
  public static readonly maxSmoothEdgeRadius = 0.3;

  public abstract readonly maxPatchSize: THREE.Vector3;

  protected readonly map: IVoxelMap;

  private readonly texture: THREE.Texture;
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
      uAmbient: { value: 0 },
      uDiffuse: { value: 0 },
    };
    this.uniformsTemplate.uTexture.value = this.texture;
  }

  public buildPatch(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Patch | null {
    const patchSize = new THREE.Vector3().subVectors(patchEnd, patchStart);
    if (patchSize.x > this.maxPatchSize.x || patchSize.y > this.maxPatchSize.y || patchSize.z > this.maxPatchSize.z) {
      const patchSizeAsString = `${patchSize.x}x${patchSize.y}x${patchSize.z}`;
      const maxPatchSizeAsString = `${this.maxPatchSize.x}x${this.maxPatchSize.y}x${this.maxPatchSize.z}`;
      throw new Error(`Patch is too big ${patchSizeAsString} (max is ${maxPatchSizeAsString})`);
    }

    const patchData = this.computePatchData(patchStart, patchEnd);
    if (patchData.length === 0) {
      return null;
    }

    const boundingBox = new THREE.Box3(patchStart, patchEnd);
    const boundingSphere = new THREE.Sphere();
    boundingBox.getBoundingSphere(boundingSphere);

    return new Patch(
      patchStart,
      patchSize,
      patchData.map(geometryAndMaterial => {
        const { geometry } = geometryAndMaterial;
        geometry.boundingBox = boundingBox.clone();
        geometry.boundingSphere = boundingSphere.clone();

        const material = geometryAndMaterial.material.clone();
        const mesh = new THREE.Mesh(geometryAndMaterial.geometry, material);
        mesh.frustumCulled = false;
        mesh.translateX(patchStart.x);
        mesh.translateY(patchStart.y);
        mesh.translateZ(patchStart.z);
        return { mesh, material };
      }),
    );
  }

  public dispose(): void {
    this.disposeInternal();
    this.texture.dispose();
    this.noiseTexture.dispose();
  }

  protected *iterateOnVisibleFaces(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): Generator<FaceData> {
    for (const voxel of this.map.iterateOnVoxels(patchStart, patchEnd)) {
      const voxelWorldPosition = new THREE.Vector3(voxel.position.x, voxel.position.y, voxel.position.z);
      const voxelLocalPosition = new THREE.Vector3().subVectors(voxelWorldPosition, patchStart);

      for (const face of Object.values(Cube.faces)) {
        if (
          this.map.voxelExists(
            voxelWorldPosition.x + face.normal.x,
            voxelWorldPosition.y + face.normal.y,
            voxelWorldPosition.z + face.normal.z,
          )
        ) {
          // this face will be hidden -> skip it
          continue;
        }

        yield {
          voxelWorldPosition,
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
                voxelWorldPosition.z + neighbourVoxel.z,
              ),
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
                  voxelWorldPosition.z + neighbourVoxel.z,
                );
              }
              for (const neighbourVoxel of faceVertex.edgeNeighbourVoxels.y) {
                roundnessY &&= !this.map.voxelExists(
                  voxelWorldPosition.x + neighbourVoxel.x,
                  voxelWorldPosition.y + neighbourVoxel.y,
                  voxelWorldPosition.z + neighbourVoxel.z,
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

  protected abstract computePatchData(patchStart: THREE.Vector3, patchEnd: THREE.Vector3): GeometryAndMaterial[];

  protected abstract disposeInternal(): void;

  private static buildMaterialsTexture(voxelMaterials: ReadonlyArray<IVoxelMaterial>, voxelTypeEncoder: PackedUintFragment): THREE.Texture {
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

export { PatchFactoryBase, type GeometryAndMaterial, type VertexData };
