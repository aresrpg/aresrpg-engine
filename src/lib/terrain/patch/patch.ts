import * as THREE from '../../three-usage';

import { EDisplayMode, PatchMaterials } from './material';

type PatchMesh = {
    readonly mesh: THREE.Mesh;
    readonly materials: PatchMaterials;
};

class Patch {
    public readonly container: THREE.Object3D;

    public readonly parameters = {
        voxels: {
            displayMode: EDisplayMode.TEXTURES,
            noiseStrength: 0.05,
        },
        lighting: {
            color: new THREE.Color(0xffffff),
            ambient: {
                intensity: 0.7,
            },
            diffuse: {
                direction: new THREE.Vector3(1, 1, 1).normalize(),
                intensity: 0.8,
            },
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

    public constructor(patchMeshes: PatchMesh[]) {
        this.gpuResources = { patchMeshes };

        this.container = new THREE.Object3D();
        for (const patchMesh of patchMeshes) {
            this.container.add(patchMesh.mesh);
        }
    }

    public updateUniforms(): void {
        if (this.gpuResources) {
            for (const patchMesh of this.gpuResources.patchMeshes) {
                const material = patchMesh.materials.material;

                material.uniforms.uAoStrength.value = +this.parameters.ao.enabled * this.parameters.ao.strength;
                material.uniforms.uAoSpread.value = this.parameters.ao.spread;
                material.uniforms.uSmoothEdgeRadius.value = +this.parameters.smoothEdges.enabled * this.parameters.smoothEdges.radius;
                material.uniforms.uSmoothEdgeMethod.value = this.parameters.smoothEdges.quality;
                material.uniforms.uDisplayMode.value = this.parameters.voxels.displayMode;

                material.uniforms.uLightColor.value = this.parameters.lighting.color;
                material.uniforms.uAmbientIntensity.value = this.parameters.lighting.ambient.intensity;
                material.uniforms.uDiffuseDirection.value = this.parameters.lighting.diffuse.direction;
                material.uniforms.uDiffuseIntensity.value = this.parameters.lighting.diffuse.intensity;

                material.uniforms.uNoiseStrength.value = this.parameters.voxels.noiseStrength;
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
