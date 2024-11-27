import * as THREE from 'three';
import CRS from 'Core/Geographic/Crs';
import { geoidLayerIsVisible } from 'Layer/GeoidLayer';
import { tiledCovering } from 'Core/Tile/Tile';
import Layer from 'Layer/Layer';
import OBB from 'Renderer/OBB';
import { TiledGeometryLayer } from 'Main';
import LayeredMaterial from 'Renderer/LayeredMaterial';
import Extent from './Geographic/Extent';
import { TileGeometry } from './TileGeometry';
import { TileBuilderParams } from './Prefab/TileBuilder';

/**
 * A TileMesh is a THREE.Mesh with a geometricError and an OBB.
 * The objectId property of the material is the id of the TileMesh.
 */
class TileMesh extends THREE.Mesh {
    public layer: Layer;
    public extent: Extent;
    public level: number;
    public obb: OBB;
    public boundingSphere: THREE.Sphere;
    public rotationAutoUpdate: boolean;
    public layerUpdateState: unknown;
    public isTileMesh: boolean;
    public geoidHeight: number;
    public link: unknown;
    public horizonCullingPoint?: THREE.Vector3;
    public horizonCullingPointElevationScaled?: THREE.Vector3;

    private _tms = new Map();
    private _visible = true;

    /**
     * @param geometry - the tile geometry
     * @param material - a THREE.Material compatible with THREE.Mesh
     * @param layer - the layer the tile is added to
     * @param extent - the tile extent
     * @param level - the tile level (default = 0)
     */
    constructor(
        geometry: TileGeometry<TileBuilderParams>,
        public override material: LayeredMaterial,
        layer: TiledGeometryLayer,
        extent: Extent,
        level: number = 0,
    ) {
        super(geometry, material);

        if (!extent) {
            throw new Error('extent is mandatory to build a TileMesh');
        }
        this.layer = layer;
        this.extent = extent;
        // TODO: Update once extent gets the changes.
        // @ts-expect-error: This PR depends on #2444, which as of yet does not
        // take zoom into account for the definition of an Extent.
        this.extent.zoom = level;

        this.level = level;

        // FIXME: Jank.
        // @ts-expect-error: Assigning uniform value through magic property.
        this.material.objectId = this.id;

        // TODO: Figure out where this OBB comes from.
        // @ts-expect-error: Probably supposed to be added earlier in the run.
        this.obb = this.geometry.OBB.clone();
        this.boundingSphere = new THREE.Sphere();
        this.obb.box3D.getBoundingSphere(this.boundingSphere);

        // TODO: Statically type layers.
        for (const tms of layer.tileMatrixSets) {
            this._tms.set(tms, tiledCovering(this.extent, tms));
        }

        this.frustumCulled = false;
        this.matrixAutoUpdate = false;
        this.rotationAutoUpdate = false;

        this.layerUpdateState = {};
        this.isTileMesh = true;

        this.geoidHeight = 0;

        this.link = {};

        Object.defineProperty(this, 'visible', {
            get() { return this._visible; },
            set(v) {
                if (this._visible != v) {
                    this._visible = v;
                    this.dispatchEvent({ type: v ? 'shown' : 'hidden' });
                }
            },
        });
    }

    /**
     * If specified, update the min and max elevation of the OBB
     * and updates accordingly the bounding sphere and the geometric error
     *
     * @param elevation - New elevation
     */
    public setBBoxZ(
        elevation: {
            min: number;
            max: number;
            scale?: number;
            geoidHeight?: number;
        },
    ): void {
        this.obb.updateZ({
            geoidHeight: geoidLayerIsVisible(this.layer) ? this.geoidHeight : 0,
            ...elevation,
        });

        if (this.horizonCullingPointElevationScaled) {
            this.horizonCullingPointElevationScaled.setLength(
                // TODO: Statically type OBB.
                // @ts-expect-error: delta is defined in updateZ
                this.obb.z.delta
                // TODO: Find out where this field is defined.
                // @ts-expect-error: implicit invariant..?
                + this.horizonCullingPoint.length(),
            );
        }

        this.obb.box3D.getBoundingSphere(this.boundingSphere);
    }

    public getExtentsByProjection(crs: string) {
        return this._tms.get(CRS.formatToTms(crs));
    }

    /**
     * Search for a common ancestor between this tile and another one. It goes
     * through parents on each side until one is found.
     *
     * @param tile - Tile to find a common ancestor with
     *
     * @returns The resulting common ancestor if it exists
     */
    public findCommonAncestor(tile: TileMesh): TileMesh | undefined {
        if (!tile) {
            return undefined;
        }
        if (tile.level == this.level) {
            if (tile.id == this.id) {
                return tile;
            } else if (tile.level != 0) {
                // TODO: Check if this null can be statically checked / is an
                // invariant.
                return (this.parent! as TileMesh)
                    .findCommonAncestor(tile.parent! as TileMesh);
            } else {
                return undefined;
            }
        } else if (tile.level < this.level) {
            return (this.parent! as TileMesh).findCommonAncestor(tile);
        } else {
            return this.findCommonAncestor(tile.parent! as TileMesh);
        }
    }

    public onBeforeRender() {
        if (this.material.layersNeedUpdate) {
            this.material.updateLayersUniforms();
        }
    }
}

export default TileMesh;
