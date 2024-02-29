import * as THREE from "three";
import { EDisplayMode, PatchMaterial } from "./material";

type PatchMesh = {
    readonly mesh: THREE.Mesh;
    readonly material: PatchMaterial;
};

class Patch {
    public readonly container = new THREE.Object3D();

    public readonly parameters = {
        voxels: {
            displayMode: EDisplayMode.TEXTURES,
            noiseStrength: 0.05,
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

    public readonly patchStart: THREE.Vector3;
    public readonly patchSize: THREE.Vector3;

    private gpuResources: {
        readonly patchMeshes: ReadonlyArray<PatchMesh>;
    } | null = null;

    public constructor(patchStart: THREE.Vector3, patchSize: THREE.Vector3, patchMeshes: PatchMesh[]) {
        this.patchStart = patchStart;
        this.patchSize = patchSize;
        this.gpuResources = { patchMeshes };

        this.container = new THREE.Object3D();
        for (const patchMesh of patchMeshes) {
            this.container.add(patchMesh.mesh);
        }
    }

    public updateUniforms(): void {
        if (this.gpuResources) {
            for (const patchMesh of this.gpuResources.patchMeshes) {
                patchMesh.material.uniforms.uAoStrength.value = +this.parameters.ao.enabled * this.parameters.ao.strength;
                patchMesh.material.uniforms.uAoSpread.value = this.parameters.ao.spread;
                patchMesh.material.uniforms.uSmoothEdgeRadius.value = +this.parameters.smoothEdges.enabled * this.parameters.smoothEdges.radius;
                patchMesh.material.uniforms.uSmoothEdgeMethod.value = this.parameters.smoothEdges.quality;
                patchMesh.material.uniforms.uDisplayMode.value = this.parameters.voxels.displayMode;
                patchMesh.material.uniforms.uAmbient.value = this.parameters.lighting.ambient;
                patchMesh.material.uniforms.uDiffuse.value = this.parameters.lighting.diffuse;
                patchMesh.material.uniforms.uNoiseStrength.value = this.parameters.voxels.noiseStrength;
            }
        }
    }

    public dispose(): void {
        if (this.gpuResources) {
            for (const patchMesh of this.gpuResources.patchMeshes) {
                this.container.remove(patchMesh.mesh);
                patchMesh.mesh.geometry.dispose();
                patchMesh.material.dispose();
            }

            this.gpuResources = null;
        }
    }
}

export {
    EDisplayMode,
    Patch
};

