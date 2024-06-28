/**
 * A color stored in RGB format. Each component should be normalized.
 */
type Color = {
    readonly r: number;
    readonly g: number;
    readonly b: number;
};

interface IHeightmapCoords {
    readonly x: number;
    readonly z: number;
}

interface IHeightmapSample {
    readonly altitude: number;
    readonly color: Color;
}

/**
 * Interface for a class storing a 2D heightmap (Y-up).
 */
interface IHeightmap {
    /**
     * Samples points on the heightmap.
     * @returns A promise returning a list of one sample per input coords, in the same order.
     */
    sampleHeightmapAsync(coords: IHeightmapCoords[]): Promise<IHeightmapSample[]>;
}

export type { IHeightmap, IHeightmapCoords, IHeightmapSample };
