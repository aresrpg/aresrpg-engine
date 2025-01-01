import { applyReplacements } from '../../helpers/string';
import * as THREE from '../../libs/three-usage';

const params = {
    minDissolve: 0,
};

type ClutterMaterial = {
    readonly material: THREE.MeshPhongMaterial;
    readonly uniforms: {
        uPlayerModelPosition: THREE.IUniform<THREE.Vector3>;
        uDissolveThreshold: THREE.IUniform<number>;
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

function customizeMaterial(phongMaterial: THREE.MeshPhongMaterial): ClutterMaterial {
    phongMaterial.customProgramCacheKey = () => `prop_phong_material`;

    const noiseTextureSize = 64;
    const noiseTexture = buildNoiseTexture(noiseTextureSize);
    noiseTexture.wrapS = THREE.RepeatWrapping;
    noiseTexture.wrapT = THREE.RepeatWrapping;
    noiseTexture.magFilter = THREE.LinearFilter;
    const dissolveUniform: THREE.IUniform<number> = { value: params.minDissolve };

    const customUniforms = {
        uNoiseTexture: { value: noiseTexture },
        uDissolveThreshold: dissolveUniform,
        uPlayerModelPosition: { value: new THREE.Vector3(Infinity, Infinity, Infinity) },
    };

    phongMaterial.onBeforeCompile = parameters => {
        parameters.uniforms = {
            ...parameters.uniforms,
            ...customUniforms,
        };

        parameters.vertexShader = applyReplacements(parameters.vertexShader, {
            'void main() {': `

                uniform vec3 uPlayerModelPosition;

                in float aDissolveRatio;
                out float vDissolveRatio;
                   
                void main() {
                    vDissolveRatio = aDissolveRatio;
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

                    vec3 fromPlayer = mvPosition.xyz - uPlayerModelPosition;
                    float fromPlayerLength = length(fromPlayer) + 0.00001;
                    const float playerRadius = 0.6;
                    vec3 displacement = fromPlayer / fromPlayerLength * (playerRadius - fromPlayerLength)
                        * step(fromPlayerLength, playerRadius) * step(0.2, mvPosition.y);
                    mvPosition.xz += displacement.xz;

                    mvPosition = modelViewMatrix * mvPosition;

                    gl_Position = projectionMatrix * mvPosition;
            `,
        });

        parameters.fragmentShader = applyReplacements(parameters.fragmentShader, {
            'void main() {': `
                    uniform sampler2D uNoiseTexture;
                    uniform float uDissolveThreshold;
    
                    in float vDissolveRatio;

                    void main() {
                        float noise = texture(uNoiseTexture, gl_FragCoord.xy / ${noiseTextureSize.toFixed(1)}).r;
                        if (noise < max(vDissolveRatio,uDissolveThreshold)) {
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
    count: number;
    bufferGeometry: THREE.BufferGeometry;
    material: THREE.MeshPhongMaterial;
};

class GrassPatchesBatch {
    public get object3D() {
        return this.instancedMesh;
    }

    public minDissolve: number = 0;
    public readonly playerPosition: THREE.Vector3;

    private readonly instancedMesh: THREE.InstancedMesh;
    private readonly material: ClutterMaterial;
    private readonly dissolveAttribute: THREE.InstancedBufferAttribute;

    public constructor(params: Paramerers) {
        this.dissolveAttribute = new THREE.InstancedBufferAttribute(new Float32Array(params.count), 1);
        params.bufferGeometry.setAttribute('aDissolveRatio', this.dissolveAttribute);

        this.material = customizeMaterial(params.material);
        this.instancedMesh = new THREE.InstancedMesh(params.bufferGeometry, this.material.material, params.count);
        this.instancedMesh.count = params.count;
        
        this.playerPosition = this.material.uniforms.uPlayerModelPosition.value;
    }

    public update(): void {
        this.material.uniforms.uDissolveThreshold.value = this.minDissolve;
    }

    public setDissolve(index: number, dissolveRatio: number): void {
        this.dissolveAttribute.array[index] = dissolveRatio;
        this.dissolveAttribute.needsUpdate = true;
    }

    public setMatrix(index: number, matrix: THREE.Matrix4): void {
        this.instancedMesh.setMatrixAt(index, matrix);
    }
}

export { GrassPatchesBatch, params };
