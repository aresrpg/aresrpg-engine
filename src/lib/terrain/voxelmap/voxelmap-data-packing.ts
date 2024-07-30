class VoxelmapDataPacking {
    public encode(isEmpty: boolean, materialId: number): number {
        if (isEmpty) {
            return 0;
        }
        return materialId + 1;
    }

    public isEmpty(data: number): boolean {
        return data === 0;
    }

    public wgslIsEmpty(voxelPosVarname: string): string {
        return `(${voxelPosVarname} == 0u)`;
    }

    public getMaterialid(data: number): number {
        if (this.isEmpty(data)) {
            throw new Error(`Cannot extract material ID from empty data.`);
        }
        return data - 1;
    }

    public wgslGetMaterialId(voxelPosVarname: string): string {
        return `(${voxelPosVarname} - 1u)`;
    }

    public serialize(): string {
        return `{
            ${this.encode.toString()},
            ${this.isEmpty.toString()},
            ${this.getMaterialid.toString()},
        }`;
    }
}

export { VoxelmapDataPacking };
