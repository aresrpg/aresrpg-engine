abstract class SpecializedVoxelEncoder {
    protected readonly voxelTypeMask: number;
    protected readonly voxelTypeMaskValue: number;

    protected constructor(voxelTypeMask: number, voxelTypeMaskValue: number) {
        this.voxelTypeMask = voxelTypeMask;
        this.voxelTypeMaskValue = voxelTypeMaskValue;

        if (
            ((this.voxelTypeMask & this.voxelTypeMaskValue) !== this.voxelTypeMaskValue) ||
            ((this.voxelTypeMask | this.voxelTypeMaskValue) !== this.voxelTypeMask)
        ) {
            throw new Error();
        }
    }

    public isOfType(data: number): boolean {
        return (data & this.voxelTypeMask) === this.voxelTypeMaskValue;
    }

    public wgslIsOfType(varname: string): string {
        return `((${varname} & ${this.voxelTypeMask}u) == ${this.voxelTypeMaskValue}u)`;
    }
}

export { SpecializedVoxelEncoder };
