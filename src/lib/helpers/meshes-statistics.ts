type MeshesStatistics = {
    meshes: {
        loadedCount: number;
        visibleCount: number;
    };
    triangles: {
        loadedCount: number;
        visibleCount: number;
    };
    gpuMemoryBytes: number;
};

function createMeshesStatistics(): MeshesStatistics {
    return {
        meshes: {
            loadedCount: 0,
            visibleCount: 0,
        },
        triangles: {
            loadedCount: 0,
            visibleCount: 0,
        },
        gpuMemoryBytes: 0,
    };
}

export { createMeshesStatistics, type MeshesStatistics };
