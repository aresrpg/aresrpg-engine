import * as THREE from "../../three-usage";

class HeightmapNodeId {
    public static readonly smallestLevelSizeInVoxels = 64;

    public readonly shift: THREE.Vector2Like = { x: 0, y: 0 };
    public readonly level: number;
    public readonly coordsInLevel: THREE.Vector2Like;
    public readonly levelSizeInVoxels: number;
    public readonly box: THREE.Box2;

    public constructor(shift: THREE.Vector2Like, level: number, coordsInLevel: THREE.Vector2Like) {
        this.shift = shift;
        this.level = level;
        this.coordsInLevel = coordsInLevel;

        this.levelSizeInVoxels = HeightmapNodeId.getLevelSizeInVoxels(level);
        const fromVoxel = new THREE.Vector2().copy(coordsInLevel).multiplyScalar(this.levelSizeInVoxels).add(shift);
        const toVoxel = fromVoxel.clone().addScalar(this.levelSizeInVoxels);
        this.box = new THREE.Box2(fromVoxel, toVoxel);
    }

    public contains(patchId: HeightmapNodeId): boolean {
        if (this.level === 0) {
            console.log(this.box);
        }
        const levelPatchSizeInVoxels = (1 << patchId.level) * HeightmapNodeId.smallestLevelSizeInVoxels
        const patchMiddleVoxel = new THREE.Vector2().copy(patchId.coordsInLevel).addScalar(0.5).multiplyScalar(levelPatchSizeInVoxels).add(this.shift);
        return this.box.containsPoint(patchMiddleVoxel);
    }

    public equals(patchId: HeightmapNodeId): boolean {
        return this.level === patchId.level && this.coordsInLevel.x === patchId.coordsInLevel.x && this.coordsInLevel.y === patchId.coordsInLevel.y;
    }

    public asString(): string {
        return `${this.level}__${this.coordsInLevel.x}x${this.coordsInLevel.y}`
    }

    public static getLevelSizeInVoxels(level: number): number {
        return (1 << level) * HeightmapNodeId.smallestLevelSizeInVoxels;
    }
}

export {
    HeightmapNodeId,
};

