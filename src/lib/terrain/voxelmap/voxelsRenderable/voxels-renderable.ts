import * as THREE from '../../../three-usage';

import { EVoxelsDisplayMode, type VoxelsMaterials } from './voxels-material';

type PatchMesh = {
    readonly mesh: THREE.Mesh;
    readonly materials: VoxelsMaterials;
    readonly trianglesCount: number;
    readonly gpuMemoryBytes: number;
};

class VoxelsRenderable {
    public readonly container: THREE.Object3D;

    public readonly parameters = {
        shadows: {
            cast: true,
            receive: true,
        },
        voxels: {
            displayMode: EVoxelsDisplayMode.TEXTURED,
            noiseStrength: 0.05,
            checkerboardStrength: 0.1,
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
        grid: {
            enabled: false,
            thickness: 0.02,
            color: new THREE.Vector3(-0.05, -0.05, -0.05),
        },
    };

    private gpuResources: {
        readonly patchMeshes: ReadonlyArray<PatchMesh>;
    } | null = null;

    public readonly trianglesCount: number;
    public readonly gpuMemoryBytes: number;

    public constructor(patchMeshes: PatchMesh[]) {
        this.gpuResources = { patchMeshes };

        if (patchMeshes.length === 1) {
            const patchMesh = patchMeshes[0]!;
            this.container = patchMesh.mesh;
            this.trianglesCount = patchMesh.trianglesCount;
            this.gpuMemoryBytes = patchMesh.gpuMemoryBytes;
        } else {
            let trianglesCount = 0;
            let gpuMemoryBytes = 0;

            this.container = new THREE.Group();
            for (const patchMesh of patchMeshes) {
                this.container.add(patchMesh.mesh);
                trianglesCount += patchMesh.trianglesCount;
                gpuMemoryBytes += patchMesh.gpuMemoryBytes;
            }
            this.trianglesCount = trianglesCount;
            this.gpuMemoryBytes = gpuMemoryBytes;
        }

        this.updateUniforms();
    }

    public updateUniforms(): void {
        if (this.gpuResources) {
            for (const patchMesh of this.gpuResources.patchMeshes) {
                const material = patchMesh.materials.material;
                const uniforms = material.userData.uniforms;

                uniforms.uAoStrength.value = +this.parameters.ao.enabled * this.parameters.ao.strength;
                uniforms.uAoSpread.value = this.parameters.ao.spread;
                uniforms.uSmoothEdgeRadius.value = +this.parameters.smoothEdges.enabled * this.parameters.smoothEdges.radius;
                uniforms.uDisplayMode.value = this.parameters.voxels.displayMode;

                uniforms.uNoiseStrength.value = this.parameters.voxels.noiseStrength;
                uniforms.uCheckerboardStrength.value = this.parameters.voxels.checkerboardStrength;

                uniforms.uGridThickness.value = +this.parameters.grid.enabled * this.parameters.grid.thickness;
                uniforms.uGridColor.value = this.parameters.grid.color;

                material.needsUpdate = true;

                patchMesh.mesh.receiveShadow = this.parameters.shadows.receive;
                patchMesh.mesh.castShadow = this.parameters.shadows.cast;
            }
        }
    }

    public dispose(): void {
        if (this.gpuResources) {
            for (const patchMesh of this.gpuResources.patchMeshes) {
                patchMesh.mesh.removeFromParent();
                patchMesh.mesh.geometry.dispose();
                patchMesh.materials.material.dispose();
                patchMesh.materials.shadowMaterial.dispose();
            }

            this.gpuResources = null;
        }
    }
}

export { EVoxelsDisplayMode, VoxelsRenderable };
