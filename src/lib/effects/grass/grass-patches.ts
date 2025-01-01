import { applyReplacements } from '../../helpers/string';
import * as THREE from '../../libs/three-usage';

type ClutterMaterial = {
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

function customizeMaterial(phongMaterial: THREE.MeshPhongMaterial, playerReactive: boolean): ClutterMaterial {
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
        const playerReactiveKey = "PLAYER_REACTIVE";
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
            "#include <project_vertex>": `
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
    readonly count: number;
    readonly reactToPlayer: boolean;
    readonly bufferGeometry: THREE.BufferGeometry;
    readonly material: THREE.MeshPhongMaterial;
};

class GrassPatchesBatch {
    public get object3D() {
        return this.instancedMesh;
    }

    public readonly playerWorldPosition = new THREE.Vector3();

    private readonly instancedMesh: THREE.InstancedMesh;
    private readonly material: ClutterMaterial;

    public constructor(params: Paramerers) {
        this.material = customizeMaterial(params.material, params.reactToPlayer);
        this.instancedMesh = new THREE.InstancedMesh(params.bufferGeometry, this.material.material, params.count);
        this.instancedMesh.count = params.count;
    }

    public update(): void {
        this.material.uniforms.uPlayerModelPosition.value.copy(this.playerWorldPosition).applyMatrix4(
            this.object3D.matrixWorld.clone().invert()
        );
    }

    public setMatrix(index: number, matrix: THREE.Matrix4): void {
        this.instancedMesh.setMatrixAt(index, matrix);
    }

    public setViewDistance(distance: number): void {
        this.material.uniforms.uViewRadius.value = distance;
    }
    public setViewDistanceMargin(margin: number): void {
        this.material.uniforms.uViewRadiusMargin.value = margin;
    }
}

export { GrassPatchesBatch };

