import * as THREE from '../../../../libs/three-usage';

function buildHeightmapTileMaterial(uvScale: number, uvShift: THREE.Vector2Like): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        glslVersion: '300 es',
        uniforms: {
            uUvScale: { value: uvScale },
            uUvShift: { value: new THREE.Vector2().copy(uvShift) },
        },
        vertexShader: `
        uniform vec2 uUvShift;
        uniform float uUvScale;

        out vec2 vUv;

        void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1);
            vUv = uUvShift + position.xz * uUvScale;
        }
        `,
        fragmentShader: `
        in vec2 vUv;

        out vec4 fragColor;

        void main() {
            fragColor = vec4(vUv, 0, 1);
        }
        `,
    });
}

export { buildHeightmapTileMaterial };
