type HeightmapSamples = {
    readonly altitudes: Float32Array;
    readonly materialIds: Uint32Array;
};

/**
 * Interface for a class storing a 2D heightmap (Y-up).
 */
interface IHeightmap {
    readonly minAltitude: number;
    readonly maxAltitude: number;

    /**
     * Samples points on the heightmap, synchronously or asynchronously.
     * @param coords An array containing X and Z coordinates of sample points
     * @returns A list (or promise of list) of one sample per input coords, in the same order as the input coords.
     */
    sampleHeightmap(coords: Float32Array): HeightmapSamples | Promise<HeightmapSamples>;
}

export type { HeightmapSamples, IHeightmap };
