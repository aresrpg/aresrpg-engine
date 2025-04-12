import { Transition } from '../../../../helpers/transition';
import type * as THREE from '../../../../libs/three-usage';
import type { AtlasTileId, HeightmapAtlas, HeightmapAtlasTileView } from '../../atlas/heightmap-atlas';

import { type EdgesResolution, EEdgeResolution, type TileGeometryStore } from './tile-geometry-store';

type Children = {
    readonly mm: HeightmapTile;
    readonly mp: HeightmapTile;
    readonly pm: HeightmapTile;
    readonly pp: HeightmapTile;
};

type InstancedAttributesHandle = {
    setAttributes(attributes: VisibleTileAttributes): void;
    dispose(): void;
};

type Parameters = {
    readonly common: {
        readonly heightmapAtlas: HeightmapAtlas;
        readonly geometryStore: TileGeometryStore;
        getInstancedAttributesHandle(): InstancedAttributesHandle;
    };
    readonly atlasTileId: AtlasTileId;
    readonly transitionTime: number;
};

type TileEdgesDrop = {
    readonly up: boolean;
    readonly down: boolean;
    readonly left: boolean;
    readonly right: boolean;
    readonly upLeft: boolean;
    readonly upRight: boolean;
    readonly downLeft: boolean;
    readonly downRight: boolean;
};

type VisibleTileAttributes = {
    readonly world: {
        readonly origin: THREE.Vector2Like;
        readonly size: THREE.Vector2Like;
    };
    readonly uv: {
        readonly origin: THREE.Vector2Like;
        readonly size: THREE.Vector2Like;
    };
    drop: TileEdgesDrop;
    dissolveRatio: number;
    edgesResolution: EdgesResolution;
};

class HeightmapTile {
    protected readonly common: Parameters['common'];

    private readonly atlasTileView: HeightmapAtlasTileView;
    private readonly attributes: VisibleTileAttributes;
    private instancedAttributesHandle: InstancedAttributesHandle | null = null;

    private readonly transitionTime: number;
    private shouldBeVisible: boolean = true;
    private dissolveTransition: Transition | null = null;

    private hasBasicData: boolean;

    private subdivided: boolean = false;
    public children: Children | null = null;

    public constructor(params: Parameters) {
        this.common = params.common;
        this.transitionTime = params.transitionTime;

        this.atlasTileView = params.common.heightmapAtlas.getTileView(params.atlasTileId);
        this.attributes = {
            world: this.atlasTileView.coords.world,
            uv: this.atlasTileView.coords.uv,
            dissolveRatio: 0,
            drop: {
                up: false,
                down: false,
                left: false,
                right: false,
                upLeft: false,
                upRight: false,
                downLeft: false,
                downRight: false,
            },
            edgesResolution: {
                up: EEdgeResolution.SIMPLE,
                down: EEdgeResolution.SIMPLE,
                left: EEdgeResolution.SIMPLE,
                right: EEdgeResolution.SIMPLE,
            },
        };

        this.hasBasicData = this.atlasTileView.hasBasicData();
        this.atlasTileView.useOptimalData();
    }

    public subdivide(): void {
        if (!this.children) {
            const createAndAttachChild = (x: 0 | 1, z: 0 | 1): HeightmapTile => {
                const childTile = new HeightmapTile({
                    common: this.common,
                    atlasTileId: {
                        nestingLevel: this.atlasTileView.tileId.nestingLevel + 1,
                        x: 2 * this.atlasTileView.tileId.x + x,
                        y: 2 * this.atlasTileView.tileId.y + z,
                    },
                    transitionTime: this.transitionTime,
                });
                return childTile;
            };

            this.children = {
                mm: createAndAttachChild(0, 0),
                mp: createAndAttachChild(0, 1),
                pm: createAndAttachChild(1, 0),
                pp: createAndAttachChild(1, 1),
            };
        }

        this.subdivided = true;
        this.atlasTileView.stopUsingOptimalData();
    }

    public merge(): void {
        this.subdivided = false;

        if (this.shouldBeVisible) {
            this.atlasTileView.useOptimalData();
        }
    }

    public dispose(): void {
        this.disposeChildren();

        this.atlasTileView.stopUsingOptimalData();
        this.atlasTileView.stopUsingView();

        if (this.instancedAttributesHandle) {
            this.instancedAttributesHandle.dispose();
            this.instancedAttributesHandle = null;
        }
    }

    public setEdgesResolution(edgesResolution: EdgesResolution): void {
        this.attributes.edgesResolution = { ...edgesResolution };
        this.instancedAttributesHandle?.setAttributes(this.attributes);
    }

    public setEdgesDrop(edgesDrop: TileEdgesDrop): void {
        this.attributes.drop = { ...edgesDrop };
        this.instancedAttributesHandle?.setAttributes(this.attributes);
    }

    public setVisibility(visible: boolean): void {
        if (this.shouldBeVisible !== visible) {
            if (visible) {
                this.dissolveTransition = null;
            } else {
                this.dissolveTransition = new Transition(this.transitionTime, this.dissolveRatio, 1);
            }
            this.shouldBeVisible = visible;

            if (this.shouldBeVisible && !this.subdivided) {
                this.atlasTileView.useOptimalData();
            } else {
                this.atlasTileView.stopUsingOptimalData();
            }
        }
    }

    public update(): void {
        if (this.children) {
            for (const child of Object.values(this.children)) {
                child.update();
            }
        }

        const dissolveRatio = this.dissolveRatio;

        let isMeshVisible = false;
        if (!this.subdivided && dissolveRatio < 1) {
            this.hasBasicData = this.hasBasicData || this.atlasTileView.hasBasicData();

            if (this.hasBasicData) {
                isMeshVisible = true;
            }
        }

        if (isMeshVisible) {
            let shouldUpdateHandle = this.attributes.dissolveRatio !== dissolveRatio;
            this.attributes.dissolveRatio = dissolveRatio;

            if (!this.instancedAttributesHandle) {
                this.instancedAttributesHandle = this.common.getInstancedAttributesHandle();
                shouldUpdateHandle = true;
            }

            if (shouldUpdateHandle) {
                this.instancedAttributesHandle.setAttributes(this.attributes);
            }
        } else {
            if (this.instancedAttributesHandle) {
                this.instancedAttributesHandle.dispose();
                this.instancedAttributesHandle = null;
            }
        }
    }

    public garbageCollect(): void {
        if (this.children) {
            if (this.subdivided) {
                for (const child of Object.values(this.children)) {
                    child.garbageCollect();
                }
            } else {
                this.disposeChildren();
            }
        }
    }

    private get dissolveRatio(): number {
        if (this.dissolveTransition) {
            return this.dissolveTransition.currentValue;
        }
        return this.shouldBeVisible ? 0 : 1;
    }

    private disposeChildren(): void {
        if (this.children) {
            for (const child of Object.values(this.children)) {
                child.dispose();
            }
            this.children = null;
        }
    }
}

export { HeightmapTile, type InstancedAttributesHandle, type Parameters, type TileEdgesDrop, type VisibleTileAttributes };
