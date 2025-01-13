import { logger } from '../../helpers/logger';
import { copyMap } from '../../helpers/misc';
import { applyReplacements } from '../../helpers/string';
import * as THREE from '../../libs/three-usage';

type PropsMaterial = {
    readonly material: THREE.MeshPhongMaterial;
    readonly uniforms: {
        uPlayerViewPosition: THREE.IUniform<THREE.Vector3>;
        uViewRadius: THREE.IUniform<number>;
        uViewRadiusMargin: THREE.IUniform<number>;
    };
};

function buildNoiseTexture(resolution: number): THREE.DataTexture {
    const textureWidth = resolution;
    const textureHeight = resolution;
    const textureData = new Uint8Array(textureWidth * textureHeight);

    for (let i = 0; i < textureData.length; i++) {
        textureData[i] = 250 * Math.random();
    }

    const texture = new THREE.DataTexture(textureData, textureWidth, textureHeight, THREE.RedFormat);
    texture.needsUpdate = true;
    return texture;
}

function customizeMaterial(phongMaterial: THREE.MeshPhongMaterial, playerReactive: boolean): PropsMaterial {
    phongMaterial.customProgramCacheKey = () => `prop_phong_material`;

    const noiseTextureSize = 64;
    const noiseTexture = buildNoiseTexture(noiseTextureSize);
    noiseTexture.wrapS = THREE.RepeatWrapping;
    noiseTexture.wrapT = THREE.RepeatWrapping;
    noiseTexture.magFilter = THREE.LinearFilter;

    const customUniforms = {
        uNoiseTexture: { value: noiseTexture },
        uPlayerViewPosition: { value: new THREE.Vector3(Infinity, Infinity, Infinity) },
        uViewRadius: { value: 10 },
        uViewRadiusMargin: { value: 2 },
    };

    phongMaterial.onBeforeCompile = parameters => {
        parameters.uniforms = {
            ...parameters.uniforms,
            ...customUniforms,
        };

        parameters.defines = parameters.defines || {};
        const playerReactiveKey = 'PLAYER_REACTIVE';
        if (playerReactive) {
            parameters.defines[playerReactiveKey] = true;
        }

        parameters.vertexShader = applyReplacements(parameters.vertexShader, {
            'void main() {': `
                #ifdef ${playerReactiveKey}
                uniform vec3 uPlayerViewPosition;
                #endif

                uniform float uViewRadius;
                uniform float uViewRadiusMargin;

                out float vDissolveRatio;
                   
                void main() {
            `,
            // https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/project_vertex.glsl.js
            '#include <project_vertex>': `
                vec4 mvPosition = vec4( transformed, 1.0 );

                #ifdef USE_BATCHING
                    mvPosition = batchingMatrix * mvPosition;
                #endif

                #ifdef USE_INSTANCING
                    mvPosition = instanceMatrix * mvPosition;
                #endif

                float canBeDisplaced = step(0.2, mvPosition.y);
                
                mvPosition = modelViewMatrix * mvPosition;

                vec4 viewX = viewMatrix * vec4(1, 0, 0, 0);
                vec4 viewZ = viewMatrix * vec4(0, 0, 1, 0);

                #ifdef ${playerReactiveKey}
                vec3 fromPlayer = mvPosition.xyz - uPlayerViewPosition;
                float fromPlayerLength = length(fromPlayer) + 0.00001;
                const float playerRadius = 0.6;
                vec3 displacementViewspace = fromPlayer / fromPlayerLength * (playerRadius - fromPlayerLength)
                    * step(fromPlayerLength, playerRadius) * canBeDisplaced;
                mvPosition.xyz += 
                    viewX.xyz * dot(displacementViewspace, viewX.xyz) +
                    viewZ.xyz * dot(displacementViewspace, viewZ.xyz);
                #endif

                vDissolveRatio = smoothstep(uViewRadius - uViewRadiusMargin, uViewRadius, length(mvPosition.xyz));

                gl_Position = projectionMatrix * mvPosition;
                `,
        });

        parameters.fragmentShader = applyReplacements(parameters.fragmentShader, {
            'void main() {': `
                uniform sampler2D uNoiseTexture;

                in float vDissolveRatio;

                void main() {
                    float noise = texture(uNoiseTexture, gl_FragCoord.xy / ${noiseTextureSize.toFixed(1)}).r;
                    if (noise < vDissolveRatio) {
                        discard;
                    }
                `,
        });
    };
    return {
        material: phongMaterial,
        uniforms: customUniforms,
    };
}

type PropsBatchStatistics = {
    instancesCapacity: number;
    instancesUsed: number;
    groupsCount: number;
    boundingSphereRadius: number;
    buffersSizeInBytes: number;
};

type Paramerers = {
    readonly maxInstancesCount: number;
    readonly reactToPlayer: boolean;
    readonly bufferGeometry: THREE.BufferGeometry;
    readonly material: THREE.MeshPhongMaterial;
};

type GroupDefinition = {
    readonly startIndex: number;
    readonly count: number;
};

class PropsBatch {
    public get container(): THREE.InstancedMesh {
        return this.instancedMesh;
    }

    public readonly playerViewPosition = new THREE.Vector3();

    private readonly maxInstancesCount: number;
    private readonly instancedMesh: THREE.InstancedMesh;

    private readonly material: PropsMaterial;
    private readonly groupsDefinitions: Map<string, GroupDefinition>;

    public constructor(params: Paramerers) {
        this.maxInstancesCount = params.maxInstancesCount;

        this.material = customizeMaterial(params.material, params.reactToPlayer);
        this.playerViewPosition = this.material.uniforms.uPlayerViewPosition.value;
        this.groupsDefinitions = new Map();

        this.instancedMesh = new THREE.InstancedMesh(params.bufferGeometry, this.material.material, this.maxInstancesCount);
        this.instancedMesh.count = 0;
    }

    public setInstancesGroup(groupName: string, matricesList: ReadonlyArray<THREE.Matrix4>): void {
        if (this.groupsDefinitions.has(groupName)) {
            this.groupsDefinitions.delete(groupName);
            this.reorderMatricesBuffer();
        }

        if (matricesList.length > this.spareInstancesLeft) {
            throw new Error(
                `Props batch don't have enough space to store "${matricesList.length}" more instances ("${this.spareInstancesLeft}" left)`
            );
        }

        const newGroup: GroupDefinition = {
            startIndex: this.instancedMesh.count,
            count: matricesList.length,
        };
        this.groupsDefinitions.set(groupName, newGroup);
        matricesList.forEach((matrix: THREE.Matrix4, index: number) => {
            this.instancedMesh.setMatrixAt(newGroup.startIndex + index, matrix);
        });
        this.instancedMesh.instanceMatrix.needsUpdate = true;
        this.instancedMesh.count += matricesList.length;
        this.updateFrustumCulling();
    }

    public deleteInstancesGroup(groupName: string): void {
        if (this.groupsDefinitions.has(groupName)) {
            this.groupsDefinitions.delete(groupName);
            this.reorderMatricesBuffer();
            this.updateFrustumCulling();
        } else {
            logger.warn(`Unknown props batch group "${groupName}".`);
        }
    }

    public setViewDistance(distance: number): void {
        this.material.uniforms.uViewRadius.value = distance;
    }

    public setViewDistanceMargin(margin: number): void {
        this.material.uniforms.uViewRadiusMargin.value = margin;
    }

    public get spareInstancesLeft(): number {
        return this.maxInstancesCount - this.instancedMesh.count;
    }

    public dispose(): void {
        this.instancedMesh.geometry.dispose();
    }

    public getStatistics(): PropsBatchStatistics {
        let buffersSizeInBytes = 0;
        for (const attributeBuffer of Object.values(this.instancedMesh.geometry.attributes)) {
            buffersSizeInBytes += attributeBuffer.array.byteLength;
        }
        buffersSizeInBytes += this.instancedMesh.instanceColor?.array.byteLength ?? 0;
        buffersSizeInBytes += this.instancedMesh.instanceMatrix?.array.byteLength ?? 0;

        return {
            instancesCapacity: this.maxInstancesCount,
            instancesUsed: this.instancedMesh.count,
            groupsCount: this.groupsDefinitions.size,
            boundingSphereRadius: this.instancedMesh.boundingSphere?.radius ?? Infinity,
            buffersSizeInBytes,
        };
    }

    private reorderMatricesBuffer(): void {
        const reorderedMatrices = new Float32Array(this.instancedMesh.instanceMatrix.array.length);

        let instancesCount = 0;
        const newGroupDefinitions = new Map<string, GroupDefinition>();
        for (const [groupName, groupDefinition] of this.groupsDefinitions.entries()) {
            const newGroupDefinition: GroupDefinition = {
                startIndex: instancesCount,
                count: groupDefinition.count,
            };
            newGroupDefinitions.set(groupName, newGroupDefinition);
            instancesCount += groupDefinition.count;

            const groupMatrices = this.instancedMesh.instanceMatrix.array.subarray(
                16 * groupDefinition.startIndex,
                16 * (groupDefinition.startIndex + groupDefinition.count),
            );
            reorderedMatrices.set(groupMatrices, 16 * newGroupDefinition.startIndex);
        }
        copyMap(newGroupDefinitions, this.groupsDefinitions);

        this.instancedMesh.instanceMatrix.array.set(reorderedMatrices.subarray(0, 16 * instancesCount), 0);
        this.instancedMesh.count = instancesCount;
    }

    private updateFrustumCulling(): void {
        this.instancedMesh.computeBoundingBox();
        this.instancedMesh.computeBoundingSphere();
    }
}

export { PropsBatch };
