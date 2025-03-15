import { PropsViewer } from '../../effects/props/props-viewer';
import * as THREE from '../../libs/three-usage';
import { type IClutterDefinition, type IVoxelMap, type VoxelsChunkSize } from '../voxelmap/i-voxelmap';

type Parameters = {
    readonly map: IVoxelMap;
    readonly chunkSize: VoxelsChunkSize;
};

class ClutterViewer {
    public readonly container: THREE.Object3D;

    public readonly chunkSize: VoxelsChunkSize;

    private readonly propsViewers: ReadonlyArray<PropsViewer>;

    public constructor(params: Parameters) {
        this.container = new THREE.Group();
        this.container.name = 'clutter-viewer';

        this.chunkSize = params.chunkSize;

        this.propsViewers = params.map.voxelTypesDefininitions.clutterVoxels.map((clutterDefinition: IClutterDefinition, id: number) => {
            const propsViewer = new PropsViewer({
                bufferGeometry: clutterDefinition.geometry,
                material: clutterDefinition.material,
                chunkSize: { x: params.chunkSize.xz, y: params.chunkSize.y, z: params.chunkSize.xz },
                garbageCollect: {
                    interval: -1, // no garbage collecting
                },
            });
            propsViewer.container.name = `clutter-viewer-${id}`;
            this.container.add(propsViewer.container);
            return propsViewer;
        });
    }

    public dispose(): void {
        this.container.clear();
        for (const propsViewer of this.propsViewers) {
            propsViewer.dispose();
        }
    }

    public setChunkPropsFromWorldMatrices(
        chunkId: THREE.Vector3Like,
        clutterId: number,
        worldMatricesList: ReadonlyArray<THREE.Matrix4>
    ): void {
        this.getPropsViewer(clutterId).setChunkPropsFromWorldMatrices(chunkId, worldMatricesList);
    }

    public deleteChunkClutter(chunkId: THREE.Vector3Like): void {
        for (const propsViewer of this.propsViewers) {
            propsViewer.deleteChunkProps(chunkId);
        }
    }

    private getPropsViewer(clutterId: number): PropsViewer {
        const propsViewer = this.propsViewers[clutterId];
        if (!propsViewer) {
            throw new Error(`Unknown clutter id "${clutterId}".`);
        }
        return propsViewer;
    }
}

export { ClutterViewer };
