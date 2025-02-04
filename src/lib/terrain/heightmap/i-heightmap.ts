/**
 * A color stored in RGB format. Each component should be normalized.
 */
type Color = {
    readonly r: number;
    readonly g: number;
    readonly b: number;
};

interface IHeightmapSample {
    readonly altitude: number;
    readonly color: Color;
}

/**
 * Interface for a class storing a 2D heightmap (Y-up).
 */
interface IHeightmap {
    readonly minAltitude: number;
    readonly maxAltitude: number;

    /**
     * Samples points on the heightmap, synchronously or asynchronously.
     * @returns A list (or promise of list) of one sample per input coords, in the same order as the input coords.
     */
    sampleHeightmap(coords: Float32Array): IHeightmapSample[] | Promise<IHeightmapSample[]>;
}

export type { IHeightmap, IHeightmapSample };
