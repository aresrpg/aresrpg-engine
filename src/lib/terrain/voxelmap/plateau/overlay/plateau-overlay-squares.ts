import * as THREE from '../../../../three-usage';

import { type GridCoord, PlateauOverlay } from './plateau-overlay';

type Parameters = {
    readonly size: GridCoord;
    readonly margin?: number;
    readonly innerCornerRadius?: number;
    readonly background?: {
        readonly color: THREE.Color;
        readonly alpha: number;
    };
};

class PlateauOverlaySquares extends PlateauOverlay {
    private readonly texture: THREE.DataTexture;
    private readonly textureData: Uint8Array;

    private readonly backgroundColorUniform: THREE.IUniform<THREE.Vector4>;

    public constructor(params: Parameters) {
        const marginUniform = { value: params.margin ?? 0.05 };
        const innerCornerRadiusUniform = { value: params.innerCornerRadius ?? 0.2 };

        const backgroundColorUniform = { value: new THREE.Vector4() };

        const textureData = new Uint8Array(4 * params.size.x * params.size.z);
        const texture = new THREE.DataTexture(textureData, params.size.x, params.size.z);

        super({
            name: 'blob',
            size: params.size,
            uniforms: {
                uMargin: marginUniform,
                uInnerCornerRadius: innerCornerRadiusUniform,
                uBackgroundColor: backgroundColorUniform,
                uDataTexture: { value: texture },
            },
            fragmentShader: `uniform sampler2D uDataTexture;
uniform float uMargin;
uniform float uInnerCornerRadius;
uniform vec4 uBackgroundColor;

in vec2 vGridCell;
out vec4 fragColor;

void main(void) {
    ivec2 gridCellId = ivec2(floor(vGridCell));
    vec2 uv = fract(vGridCell);

    vec4 cellColor = texelFetch(uDataTexture, gridCellId, 0);
    if (cellColor.a == 0.0) {
        discard;
    }

    float border = 0.0;
    float r2 = 0.5 - uMargin;
    float r1 = r2 - border - uInnerCornerRadius;

    vec2 dCenter = max(vec2(0), abs(uv - 0.5) - r1);
    float dist = length(dCenter);

    float isInSquare = step(dist, r2 - r1);
    fragColor = mix(uBackgroundColor, cellColor, isInSquare);
}`,
        });

        this.textureData = textureData;
        this.texture = texture;

        this.backgroundColorUniform = backgroundColorUniform;

        const background = params.background ?? { color: new THREE.Color(0xaaaaaa), alpha: 0 };
        this.setBackground(background.color, background.alpha);
    }

    public clear(): void {
        this.textureData.fill(0);
        this.texture.needsUpdate = true;
    }

    public override dispose(): void {
        this.texture.dispose();
        super.dispose();
    }

    public setBackground(color: THREE.Color, alpha: number): void {
        this.backgroundColorUniform.value = new THREE.Vector4(color.r, color.g, color.b, alpha);
    }

    public enableCell(cellId: GridCoord, color: THREE.Color, alpha: number = 1): void {
        this.setTexel(cellId, [Math.floor(255 * color.r), Math.floor(255 * color.g), Math.floor(255 * color.b), Math.floor(255 * alpha)]);
    }

    public disableCell(cellId: GridCoord): void {
        this.setTexel(cellId, [0, 0, 0, 0]);
    }

    private setTexel(position: GridCoord, texelData: [number, number, number, number]): void {
        if (position.x < 0 || position.z < 0 || position.x >= this.gridSize.x || position.z >= this.gridSize.z) {
            throw new Error(`Out of bounds position "${position.x}x${position.z}" (size is "${this.gridSize.x}x${this.gridSize.z}")`);
        }

        const index = 4 * (position.x + position.z * this.gridSize.x);
        this.textureData.set(texelData, index);
        this.texture.needsUpdate = true;
    }
}

export { PlateauOverlaySquares };

