interface IWaterMap {
    readonly waterLevel: number;

    getWaterColorForPatch(patchX: number, patchZ: number): [number, number, number];
}

export type { IWaterMap };
