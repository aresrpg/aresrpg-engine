import * as THREE from "../../three-usage";

class HeightmapNodeId {
    public static readonly smallestLevelSizeInVoxels = 64;

    public readonly level: number;
    public readonly coordsInLevel: THREE.Vector2Like;
    public readonly levelSizeInVoxels: number;
    public readonly box: THREE.Box2;

    public constructor(level: number, coordsInLevel: THREE.Vector2Like) {
        this.level = level;
        this.coordsInLevel = coordsInLevel;

        this.levelSizeInVoxels = HeightmapNodeId.getLevelSizeInVoxels(level);
        const fromVoxel = new THREE.Vector2().copy(coordsInLevel).multiplyScalar(this.levelSizeInVoxels);
        const toVoxel = fromVoxel.clone().addScalar(this.levelSizeInVoxels);
        this.box = new THREE.Box2(fromVoxel, toVoxel);
    }

    public contains(patchId: HeightmapNodeId): boolean {
        const levelPatchSizeInVoxels = (1 << patchId.level) * HeightmapNodeId.smallestLevelSizeInVoxels
        const patchMiddleVoxel = new THREE.Vector2().copy(patchId.coordsInLevel).addScalar(0.5).multiplyScalar(levelPatchSizeInVoxels);
        return this.box.containsPoint(patchMiddleVoxel);
    }

    public equals(patchId: HeightmapNodeId): boolean {
        return this.level === patchId.level && this.coordsInLevel.x === patchId.coordsInLevel.x && this.coordsInLevel.y === patchId.coordsInLevel.y;
    }

    public asString(): string {
        return `${this.level}__${this.coordsInLevel.x}x${this.coordsInLevel.y}`
    }

    public getNeighbour(dX: number, dY: number): HeightmapNodeId {
        return new HeightmapNodeId(this.level, { x: this.coordsInLevel.x + dX, y: this.coordsInLevel.y + dY });
    }

    public static getLevelSizeInVoxels(level: number): number {
        return (1 << level) * HeightmapNodeId.smallestLevelSizeInVoxels;
    }
}

export {
    HeightmapNodeId,
};

