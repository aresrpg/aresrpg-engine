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
    /**
     * Samples a point on the map, assuming it is a heightmap.
     */
    sampleHeightmap(x: number, z: number): IHeightmapSample;
}

export type { IHeightmap, IHeightmapSample };
