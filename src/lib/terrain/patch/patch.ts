import * as THREE from '../../three-usage';

import { EDisplayMode, type PatchMaterials } from './material';
import { PatchId } from './patch-id';

type PatchMesh = {
    readonly mesh: THREE.Mesh;
    readonly materials: PatchMaterials;
};

class Patch {
    public readonly container: THREE.Object3D;

    public readonly parameters = {
        shadows: {
            cast: true,
            receive: true,
        },
        voxels: {
            displayMode: EDisplayMode.TEXTURES,
            noiseStrength: 0.05,
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

    private gpuResources: {
        readonly patchMeshes: ReadonlyArray<PatchMesh>;
    } | null = null;

    public constructor(patchId: PatchId, patchMeshes: PatchMesh[]) {
        this.gpuResources = { patchMeshes };

        this.container = new THREE.Group();
        this.container.name = `Terrain patch ${patchId.asString}`;
        for (const patchMesh of patchMeshes) {
            this.container.add(patchMesh.mesh);
        }
    }

    public updateUniforms(): void {
        if (this.gpuResources) {
            for (const patchMesh of this.gpuResources.patchMeshes) {
                const material = patchMesh.materials.material;
                const uniforms = material.userData.uniforms;

                uniforms.uAoStrength.value = +this.parameters.ao.enabled * this.parameters.ao.strength;
                uniforms.uAoSpread.value = this.parameters.ao.spread;
                uniforms.uSmoothEdgeRadius.value = +this.parameters.smoothEdges.enabled * this.parameters.smoothEdges.radius;
                uniforms.uSmoothEdgeMethod.value = this.parameters.smoothEdges.quality;
                uniforms.uDisplayMode.value = this.parameters.voxels.displayMode;

                uniforms.uNoiseStrength.value = this.parameters.voxels.noiseStrength;
                material.needsUpdate = true;

                patchMesh.mesh.receiveShadow = this.parameters.shadows.receive;
                patchMesh.mesh.castShadow = this.parameters.shadows.cast;
            }
        }
    }

    public dispose(): void {
        if (this.gpuResources) {
            for (const patchMesh of this.gpuResources.patchMeshes) {
                this.container.remove(patchMesh.mesh);
                patchMesh.mesh.geometry.dispose();
                patchMesh.materials.material.dispose();
                patchMesh.materials.shadowMaterial.dispose();
            }

            this.gpuResources = null;
        }
    }
}

export { EDisplayMode, Patch };
