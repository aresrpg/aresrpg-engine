import * as THREE from '../../../libs/three-usage';

import { EVoxelMaterialQuality, EVoxelsDisplayMode, type VoxelsMaterials } from './voxels-material';

type VoxelsRenderablePart = {
    readonly mesh: THREE.Mesh;
    readonly materials: VoxelsMaterials;
    readonly trianglesCount: number;
    readonly gpuMemoryBytes: number;
};

class VoxelsRenderable {
    public readonly container: THREE.Object3D;

    public readonly parameters = {
        dissolveRatio: 0,

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
        specular: {
            strength: 1,
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
        readonly parts: ReadonlyArray<VoxelsRenderablePart>;
    } | null = null;

    public readonly trianglesCount: number;
    public readonly gpuMemoryBytes: number;

    public readonly boundingBox: THREE.Box3;

    private currentQuality: EVoxelMaterialQuality = EVoxelMaterialQuality.LOW;
    public get quality(): EVoxelMaterialQuality {
        return this.currentQuality;
    }

    public set quality(value: EVoxelMaterialQuality) {
        if (this.currentQuality !== value) {
            this.currentQuality = value;
            this.enforceMaterials();
            this.updateUniforms();
        }
    }

    public constructor(parts: ReadonlyArray<VoxelsRenderablePart>) {
        this.gpuResources = { parts };

        if (parts.length === 1) {
            const part = parts[0]!;
            this.container = part.mesh;
            this.trianglesCount = part.trianglesCount;
            this.gpuMemoryBytes = part.gpuMemoryBytes;
        } else {
            let trianglesCount = 0;
            let gpuMemoryBytes = 0;

            this.container = new THREE.Group();
            for (const part of parts) {
                this.container.add(part.mesh);
                trianglesCount += part.trianglesCount;
                gpuMemoryBytes += part.gpuMemoryBytes;
            }
            this.trianglesCount = trianglesCount;
            this.gpuMemoryBytes = gpuMemoryBytes;
        }
        this.container.name = 'voxels-renderable';

        this.boundingBox = new THREE.Box3();
        for (const part of parts) {
            this.boundingBox.union(part.mesh.geometry.boundingBox!);
        }

        this.enforceMaterials();
        this.updateUniforms();
    }

    public updateUniforms(): void {
        if (this.gpuResources) {
            for (const part of this.gpuResources.parts) {
                const material = part.materials.materials[this.currentQuality];
                const uniforms = material.userData.uniforms;

                uniforms.uAoStrength.value = +this.parameters.ao.enabled * this.parameters.ao.strength;
                uniforms.uAoSpread.value = this.parameters.ao.spread;
                uniforms.uSmoothEdgeRadius.value = +this.parameters.smoothEdges.enabled * this.parameters.smoothEdges.radius;
                uniforms.uDisplayMode.value = this.parameters.voxels.displayMode;

                uniforms.uDissolveRatio.value = this.parameters.dissolveRatio;

                uniforms.uNoiseStrength.value = this.parameters.voxels.noiseStrength;
                uniforms.uCheckerboardStrength.value = this.parameters.voxels.checkerboardStrength;

                uniforms.uGridThickness.value = +this.parameters.grid.enabled * this.parameters.grid.thickness;
                uniforms.uGridColor.value = this.parameters.grid.color;

                uniforms.uShininessStrength.value = this.parameters.specular.strength;

                material.needsUpdate = true;

                part.mesh.receiveShadow = this.parameters.shadows.receive;
                part.mesh.castShadow = this.parameters.shadows.cast;
            }
        }
    }

    public dispose(): void {
        if (this.gpuResources) {
            for (const part of this.gpuResources.parts) {
                part.mesh.removeFromParent();
                part.mesh.geometry.dispose();

                for (const material of Object.values(part.materials.materials)) {
                    material.dispose();
                }
                part.materials.shadowMaterial.dispose();
            }

            this.gpuResources = null;
        }
    }

    private enforceMaterials(): void {
        if (this.gpuResources) {
            for (const part of this.gpuResources.parts) {
                part.mesh.material = part.materials.materials[this.currentQuality];
            }
        }
    }
}

export { EVoxelsDisplayMode, VoxelsRenderable };
