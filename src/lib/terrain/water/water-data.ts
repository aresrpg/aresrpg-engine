import * as THREE from '../../libs/three-usage';

import { type IWaterMap } from './i-watermap';

type Parameters = {
    readonly map: IWaterMap;
    readonly patchesCount: number;
    readonly patchSize: number;
};

class WaterData {
    private readonly textureBuffer: Uint8Array;
    public readonly texture: THREE.DataTexture;

    public readonly map: IWaterMap;
    public readonly patchesCount: number;
    public readonly patchSize: number;
    private readonly originPatch = new THREE.Vector2(0, 0);

    public constructor(params: Parameters) {
        this.map = params.map;
        this.patchesCount = params.patchesCount;
        this.patchSize = params.patchSize;

        this.textureBuffer = new Uint8Array(4 * params.patchesCount * params.patchesCount);
        this.texture = new THREE.DataTexture(this.textureBuffer, params.patchesCount, params.patchesCount, THREE.RGBAFormat);
        this.texture.magFilter = THREE.LinearFilter;
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.wrapS = THREE.ClampToEdgeWrapping;
        this.texture.wrapT = THREE.ClampToEdgeWrapping;

        this.queryData();
    }

    public getWaterOriginPatch(): THREE.Vector2Like {
        return this.originPatch.clone();
    }

    public setWaterOriginPatch(patch: THREE.Vector2Like): void {
        if (!this.originPatch.equals(patch)) {
            this.originPatch.copy(patch);
            this.queryData();
        }
    }

    private queryData(): void {
        for (let dPatchY = 0; dPatchY < this.patchesCount; dPatchY++) {
            for (let dPatchX = 0; dPatchX < this.patchesCount; dPatchX++) {
                const color = this.map.getWaterColorForPatch(this.originPatch.x + dPatchX, this.originPatch.y + dPatchY);

                const index = dPatchX + dPatchY * this.patchesCount;
                this.textureBuffer.set(color, 4 * index);
            }
        }
        this.texture.needsUpdate = true;
    }
}

export { WaterData };
