import * as THREE from 'three';
import { TileGeometry } from 'Core/TileGeometry';
import { GlobeTileBuilder } from 'Core/Prefab/Globe/GlobeTileBuilder';
import Coordinates from 'Core/Geographic/Coordinates';
import CRS from 'Core/Geographic/Crs';

// get oriented bounding box of tile
const builder = new GlobeTileBuilder({ crs: 'EPSG:4978', uvCount: 1 });
const size = new THREE.Vector3();
const dimension = new THREE.Vector2();
const center = new THREE.Vector3();
const coord = new Coordinates('EPSG:4326', 0, 0, 0);

export type Elevation = {
    min: number,
    max: number,
    scale: number,
    delta?: number,
};

// We could consider removing the extension of THREE.Object3D.
/**
 * Oriented bounding box.
 */
class OBB extends THREE.Object3D {
    private static obb = new OBB();

    public box3D: THREE.Box3;
    public natBox: THREE.Box3;
    public z: Elevation;

    /**
     * @param min - Represents the lower (x, y, z) boundary of the box.
     * Default is ( + Infinity, + Infinity, + Infinity ).
     * @param max - Represents the upper (x, y, z) boundary of the box.
     * Default is ( - Infinity, - Infinity, - Infinity ).
     */
    constructor(
        min = new THREE.Vector3(+Infinity, +Infinity, +Infinity),
        max = new THREE.Vector3(-Infinity, -Infinity, -Infinity),
    ) {
        super();

        this.box3D = new THREE.Box3(min.clone(), max.clone());
        this.natBox = this.box3D.clone();
        this.z = { min: 0, max: 0, scale: 1.0 };
    }

    /**
     * Creates a new instance of this OBB with same properties as the original.
     *
     * @returns A copy of this OBB.
     */
    public override clone(): this {
        return new OBB().copy(this) as this;
    }

    /**
     * Copy the properties of OBB
     *
     * @param cOBB - OBB to copy.
     * @returns This OBB with fields copied from cOBB.
     */
    public override copy(cOBB: OBB): this {
        super.copy(cOBB);
        this.box3D.copy(cOBB.box3D);
        this.natBox.copy(cOBB.natBox);
        this.z.min = cOBB.z.min;
        this.z.max = cOBB.z.max;
        this.z.scale = cOBB.z.scale;
        return this;
    }

    /**
     * Update z min, z max and z scale of oriented bounding box
     */
    updateZ(
        elevation: Partial<Omit<Elevation, 'delta'>>
            & { geoidHeight?: number } = {},
    ) {
        this.z.min = elevation.min ?? this.z.min;
        this.z.max = elevation.max ?? this.z.max;

        this.z.scale = elevation.scale && elevation.scale > 0
            ? elevation.scale
            : this.z.scale;
        this.z.delta = Math.abs(this.z.max - this.z.min) * this.z.scale;

        const geoidHeight = elevation.geoidHeight || 0;

        this.box3D.min.z =
            this.natBox.min.z + this.z.min * this.z.scale + geoidHeight;
        this.box3D.max.z =
            this.natBox.max.z + this.z.max * this.z.scale + geoidHeight;
    }

    /**
     * Determines if the sphere is above the XY space of the box.
     *
     * @param sphere - The sphere
     * @returns True if sphere is above the XY space of the box, False otherwise
     */
    isSphereAboveXYBox(sphere: THREE.Sphere) {
        const localSpherePosition = this.worldToLocal(sphere.center);
        // get obb closest point to sphere center by clamping
        const x = Math.max(
            this.box3D.min.x,
            Math.min(localSpherePosition.x, this.box3D.max.x),
        );
        const y = Math.max(
            this.box3D.min.y,
            Math.min(localSpherePosition.y, this.box3D.max.y),
        );

        // this is the same as isPointInsideSphere.position
        const distance = Math.sqrt(
            (x - localSpherePosition.x) * (x - localSpherePosition.x)
            + (y - localSpherePosition.y) * (y - localSpherePosition.y));

        return distance < sphere.radius;
    }

    /**
     * Compute OBB from extent.
     * The resulting OBB can only be in the 'EPSG:3946' CRS.
     *
     * @param extent -
     * The extent (with crs 'EPSG:4326') to compute oriented bounding box with
     * @param minHeight - The minimum height of OBB
     * @param maxHeight - The maximum height of OBB
     * @returns This OBB
     */
    setFromExtent(extent: Extent, minHeight: number = extent.min || 0, maxHeight: number = extent.max || 0) {
        if (extent.crs == 'EPSG:4326') {
            const {
                shareableExtent,
                quaternion,
                position,
            } = builder.computeShareableExtent(extent);

            // Compute the minimum count of segment to build tile
            const segments = Math.max(2,
                Math.floor(
                    shareableExtent.planarDimensions(dimension).x / 90 + 1,
                ),
            );
            const paramsGeometry = {
                extent: shareableExtent,
                level: 0,
                zoom: 0,
                segments,
                disableSkirt: true,
            };

            const geometry = new TileGeometry(builder, paramsGeometry);
            obb.box3D.copy(geometry.boundingBox);
            obb.natBox.copy(geometry.boundingBox);
            this.copy(obb);

            this.updateZ({ min: minHeight, max: maxHeight });
            this.position.copy(position);
            this.quaternion.copy(quaternion);
            this.updateMatrixWorld(true);
        } else if (!CRS.isTms(extent.crs) && CRS.isMetricUnit(extent.crs)) {
            extent.center(coord).toVector3(this.position);
            extent.planarDimensions(dimension);
            size.set(dimension.x, dimension.y, Math.abs(maxHeight - minHeight));
            this.box3D.setFromCenterAndSize(center, size);
            this.updateMatrixWorld(true);
        } else {
            throw new Error('Unsupported extent crs');
        }
        return this;
    }
}

export default OBB;
