import { logger } from '../../helpers/logger';
import { applyReplacements } from '../../helpers/string';
import * as THREE from '../../libs/three-usage';

function copyMap<T, U>(source: ReadonlyMap<T, U>, destination: Map<T, U>): void {
    destination.clear();
    for (const [key, value] of source.entries()) {
        destination.set(key, value);
    }
}

type PropsMaterial = {
    readonly material: THREE.MeshPhongMaterial;
    readonly uniforms: {
        uPlayerModelPosition: THREE.IUniform<THREE.Vector3>;
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
        uPlayerModelPosition: { value: new THREE.Vector3(Infinity, Infinity, Infinity) },
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
                uniform vec3 uPlayerModelPosition;
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

                #ifdef ${playerReactiveKey}
                vec3 fromPlayer = mvPosition.xyz - uPlayerModelPosition;
                float fromPlayerLength = length(fromPlayer) + 0.00001;
                const float playerRadius = 0.6;
                vec3 displacement = fromPlayer / fromPlayerLength * (playerRadius - fromPlayerLength)
                    * step(fromPlayerLength, playerRadius) * step(0.2, mvPosition.y);
                mvPosition.xz += displacement.xz;
                #endif

                mvPosition = modelViewMatrix * mvPosition;

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
    public get container(): THREE.Object3D {
        return this.instancedMesh;
    }

    public readonly playerWorldPosition = new THREE.Vector3();

    private readonly maxInstancesCount: number;
    private readonly instancedMesh: THREE.InstancedMesh;

    private readonly material: PropsMaterial;
    private readonly groupsDefinitions: Map<string, GroupDefinition>;

    public constructor(params: Paramerers) {
        this.maxInstancesCount = params.maxInstancesCount;

        this.material = customizeMaterial(params.material, params.reactToPlayer);
        this.groupsDefinitions = new Map();

        this.instancedMesh = new THREE.InstancedMesh(params.bufferGeometry, this.material.material, this.maxInstancesCount);
        this.instancedMesh.count = 0;
    }

    public update(): void {
        this.material.uniforms.uPlayerModelPosition.value
            .copy(this.playerWorldPosition)
            .applyMatrix4(this.instancedMesh.matrixWorld.clone().invert());
    }

    public setInstancesGroup(groupName: string, matricesList: ReadonlyArray<THREE.Matrix4>): void {
        if (this.groupsDefinitions.has(groupName)) {
            this.groupsDefinitions.delete(groupName);
            this.reorderMatricesBuffer();
        }

        if (matricesList.length === 0) {
            return;
        }

        const spareInstancesLeft = this.spareInstancesLeft;
        if (matricesList.length > spareInstancesLeft) {
            throw new Error(
                `Props batch don't have enough space to store "${matricesList.length}" more instances ("${spareInstancesLeft}" left)`
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
        this.instancedMesh.count += matricesList.length;
    }

    public removeInstancesGroup(groupName: string): void {
        if (this.groupsDefinitions.has(groupName)) {
            this.groupsDefinitions.delete(groupName);
            this.reorderMatricesBuffer();
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

            for (let iM = 0; iM < groupDefinition.count; iM++) {
                const oldMatrixStart = 16 * (groupDefinition.startIndex + iM);
                const matrix = this.instancedMesh.instanceMatrix.array.subarray(oldMatrixStart, oldMatrixStart + 16);
                reorderedMatrices.set(matrix, 16 * (newGroupDefinition.startIndex + iM));
            }
        }
        copyMap(newGroupDefinitions, this.groupsDefinitions);

        this.instancedMesh.instanceMatrix.array.set(reorderedMatrices.subarray(0, 16 * instancesCount), 0);
        this.instancedMesh.count = instancesCount;
    }
}

export { PropsBatch };
