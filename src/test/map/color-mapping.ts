import * as THREE from 'three';

import { type IVoxelMaterial } from '../../lib';

class ColorMapping {
    public readonly materialsList: IVoxelMaterial[];

    private readonly bitsPerChannel = 4;
    private readonly valuesCountPerChannel = 1 << this.bitsPerChannel;

    public constructor() {
        const leveled = { r: 0, g: 0, b: 0 };

        this.materialsList = [];
        for (leveled.b = 0; leveled.b < this.valuesCountPerChannel; leveled.b++) {
            for (leveled.g = 0; leveled.g < this.valuesCountPerChannel; leveled.g++) {
                for (leveled.r = 0; leveled.r < this.valuesCountPerChannel; leveled.r++) {
                    const color = this.buildColorFromLeveled(leveled);
                    this.materialsList.push({ color });
                }
            }
        }
    }

    public getMaterialId(color: THREE.Color): number {
        const maxLeveledValue = this.valuesCountPerChannel - 1;

        return this.buildMaterialId({
            r: Math.floor(Math.max(0, Math.min(1, color.r)) * maxLeveledValue),
            g: Math.floor(Math.max(0, Math.min(1, color.g)) * maxLeveledValue),
            b: Math.floor(Math.max(0, Math.min(1, color.b)) * maxLeveledValue),
        });
    }

    public getColor(materialId: number): THREE.Color {
        const leveled = {
            r: (materialId >> (0 * this.bitsPerChannel)) & (this.valuesCountPerChannel - 1),
            g: (materialId >> (1 * this.bitsPerChannel)) & (this.valuesCountPerChannel - 1),
            b: (materialId >> (2 * this.bitsPerChannel)) & (this.valuesCountPerChannel - 1),
        };
        return this.buildColorFromLeveled(leveled);
    }

    private buildColorFromLeveled(leveled: { r: number; g: number; b: number }): THREE.Color {
        const step = 256 / this.valuesCountPerChannel;
        return new THREE.Color((leveled.r * step) / 255, (leveled.g * step) / 255, (leveled.b * step) / 255);
    }

    private buildMaterialId(leveled: { r: number; g: number; b: number }): number {
        return leveled.r + this.valuesCountPerChannel * (leveled.g + this.valuesCountPerChannel * leveled.b);
    }
}

const colorMapping = new ColorMapping();

export { colorMapping };
