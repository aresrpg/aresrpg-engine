import { vec2ToString } from '../../../helpers/string';
import * as THREE from '../../../libs/three-usage';

interface IRoot {
    readonly basePatchSize: number;
}

class HeightmapNodeId {
    public readonly level: number;
    public readonly coordsInLevel: THREE.Vector2Like;
    public readonly levelSizeInVoxels: number;
    public readonly box: THREE.Box2;

    private readonly root: IRoot;

    public constructor(level: number, coordsInLevel: THREE.Vector2Like, root: IRoot) {
        this.level = level;
        this.coordsInLevel = coordsInLevel;
        this.root = root;

        this.levelSizeInVoxels = this.getLevelSizeInVoxels(level);
        const fromVoxel = new THREE.Vector2().copy(coordsInLevel).multiplyScalar(this.levelSizeInVoxels);
        const toVoxel = fromVoxel.clone().addScalar(this.levelSizeInVoxels);
        this.box = new THREE.Box2(fromVoxel, toVoxel);
    }

    public contains(nodeId: HeightmapNodeId): boolean {
        const levelTileSizeInVoxels = this.getLevelSizeInVoxels(nodeId.level);
        const tileMiddleVoxel = new THREE.Vector2().copy(nodeId.coordsInLevel).addScalar(0.5).multiplyScalar(levelTileSizeInVoxels);
        return this.box.containsPoint(tileMiddleVoxel);
    }

    public equals(nodeId: HeightmapNodeId): boolean {
        return (
            this.level === nodeId.level &&
            this.coordsInLevel.x === nodeId.coordsInLevel.x &&
            this.coordsInLevel.y === nodeId.coordsInLevel.y
        );
    }

    public asString(): string {
        return `${this.level}__${vec2ToString(this.coordsInLevel)}`;
    }

    public getNeighbour(dX: number, dY: number): HeightmapNodeId {
        return new HeightmapNodeId(this.level, { x: this.coordsInLevel.x + dX, y: this.coordsInLevel.y + dY }, this.root);
    }

    public getLevelSizeInVoxels(level: number): number {
        return HeightmapNodeId.getLevelSizeInVoxels(this.root.basePatchSize, level);
    }

    public static getLevelSizeInVoxels(basePatchSize: number, level: number): number {
        return (1 << level) * basePatchSize;
    }
}

export { HeightmapNodeId };
