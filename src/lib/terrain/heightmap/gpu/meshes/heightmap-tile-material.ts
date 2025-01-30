import * as THREE from '../../../../libs/three-usage';

function buildHeightmapTileMaterial(
    texture: THREE.Texture,
    elevationScale: number,
    uvScale: number,
    uvShift: THREE.Vector2Like
): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
        glslVersion: '300 es',
        uniforms: {
            uElevationTexture: { value: texture },
            uElevationScale: { value: elevationScale },
            uUvScale: { value: uvScale },
            uUvShift: { value: new THREE.Vector2().copy(uvShift) },
        },
        vertexShader: `
        uniform sampler2D uElevationTexture;
        uniform vec2 uUvShift;
        uniform float uUvScale;
        uniform float uElevationScale;

        out vec2 vUv;
        out vec3 vColor;

        void main() {
            vec2 uv = uUvShift + position.xz * uUvScale;

            vec3 adjustedPosition = position;
            adjustedPosition.y = texture(uElevationTexture, uv).r * uElevationScale;

            gl_Position = projectionMatrix * modelViewMatrix * vec4(adjustedPosition, 1);
            vUv = uv;
            vColor = texture(uElevationTexture, uv).rgb;
        }
        `,
        fragmentShader: `
        in vec3 vColor;

        out vec4 fragColor;

        void main() {
            fragColor = vec4(vColor, 1);
        }
        `,
    });
}

export { buildHeightmapTileMaterial };
