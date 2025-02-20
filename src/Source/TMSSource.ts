import { LRUCache } from 'lru-cache';

import Source from 'Source/Source';
import URLBuilder from 'Provider/URLBuilder';
import Extent from 'Core/Geographic/Extent';
import Tile, { TileLike } from 'Core/Tile/Tile';
import { globalExtentTMS } from 'Core/Tile/TileGrid';

import type { Texture } from 'three';
import type { ProjectionLike } from 'Core/Geographic/Crs';
import type { SourceOptions } from 'Source/Source';
import type { FeatureCollection } from 'Core/Feature';

const _tile = new Tile('EPSG:4326', 0, 0, 0);

type TMSLimit = {
    minTileRow: number;
    maxTileRow: number;
    minTileCol: number;
    maxTileCol: number;
}

export interface TMSSourceOptions<T extends Texture | FeatureCollection> extends SourceOptions<T> {
    crs: ProjectionLike;
    tileMatrixSetLimits?: Record<number, TMSLimit>;
    tileMatrixCallback?: (level: number) => string;
    isInverted?: boolean;
    zoom?: { min: number; max: number };
}

/**
 * An object defining the source of resources to get from a
 * [TMS](https://wiki.osgeo.org/wiki/Tile_Map_Service_Specification) server.
 * It inherits from {@link Source}.
 *
 * @extends Source
 *
 * @property {boolean} isTMSSource - Used to checkout whether this source is a
 * TMSSource. Default is true. You should not change this, as it is used
 * internally for optimisation.
 * @property {boolean} isInverted - The isInverted property is to be set to the
 * correct value, true or false (default being false) if the computation of the
 * coordinates needs to be inverted to match the same scheme as OSM, Google Maps
 * or other system. See [this link](
 * https://alastaira.wordpress.com/2011/07/06/converting-tms-tile-coordinates-to-googlebingosm-tile-coordinates/)
 * for more information.
 * @property {Object} tileMatrixSetLimits - it describes the available tile for this layer
 * @property {Object} extentSetlimits - these are the extents of the set of identical zoom tiles.
 * @property {Object} zoom - Object containing the minimum and maximum values of
 * the level, to zoom in the source.
 * @property {number} zoom.min - The minimum level of the source. Default value
 * is 0.
 * @property {number} zoom.max - The maximum level of the source. Default value
 * is 20.
 * @property {function} tileMatrixCallback - a method that create a TileMatrix
 * identifier from the zoom level. For example, if set to `(zoomLevel) => 'EPSG:4326:' + zoomLevel`,
 * the TileMatrix that will be fetched at zoom level 5 will be the one with identifier `EPSG:4326:5`.
 * By default, the method returns the input zoom level.
 *
 * @example <caption><b>Source from OpenStreetMap server :</b></caption>
 * // Create the source
 * const tmsSource = new itowns.TMSSource({
 *     format: 'image/png',
 *     url: 'http://osm.io/styles/${z}/${x}/${y}.png',
 *     attribution: {
 *         name: 'OpenStreetMap',
 *         url: 'http://www.openstreetmap.org/',
 *     },
 *     crs: 'EPSG:3857',
 * });
 *
 * // Create the layer
 * const colorLayer = new itowns.ColorLayer('OPENSM', {
 *     source: tmsSource,
 * });
 *
 * // Add the layer
 * view.addLayer(colorLayer);
 *
 * @example <caption><b>Source from Mapbox server :</b></caption>
 * // Create the source
 * const orthoSource = new itowns.TMSSource({
 *     url: 'https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}.jpg?access_token=' + accessToken,
 *     crs: 'EPSG:3857',
 * };
 *
 * // Create the layer
 * const imageryLayer = new itowns.ColorLayer("Ortho", {
 *     source: orthoSource,
 * };
 *
 * // Add the layer to the view
 * view.addLayer(imageryLayer);
 */
// class TMSSource<T extends Texture | FeatureCollection> extends Source<TileLike, T> {
//     readonly isTMSSource: true;
//
//     zoom: { min: number; max: number };
//     isInverted: boolean;
//     tileMatrixSetLimits?: Record<number, TMSLimit>;
//     extentSetlimits: Record<string, Record<number, Extent>>;
//     tileMatrixCallback: (level: number) => string;
//
//     /**
//      * @param source - An object that can contain all properties of a TMSSource
//      * and {@link Source}. Only `url` is mandatory.
//      */
//     constructor(source: TMSSourceOptions<T>) {
//         source.format = source.format || 'image/png';
//
//         // TODO: Pass custom parser
//         super(source);
//
//         if (!source.crs) {
//             throw new Error('New TMSSource/WMTSSource: crs is required');
//         }
//
//         this.isTMSSource = true;
//
//         if (!source.extent) {
//             // default to the global extent
//             this.extent = globalExtentTMS.get(source.crs);
//         }
//
//         // TODO[QB]: constify
//         this.zoom = source.zoom ?? { min: 0, max: Infinity };
//
//         this.isInverted = source.isInverted ?? false;
//         this.crs = source.crs;
//         this.tileMatrixSetLimits = source.tileMatrixSetLimits;
//         this.extentSetlimits = {};
//         this.tileMatrixCallback =
//             source.tileMatrixCallback ?? ((zoomLevel: number) => zoomLevel.toString());
//
//         if (this.tileMatrixSetLimits) {
//             const arrayLimits = Object.keys(this.tileMatrixSetLimits);
//             const size = arrayLimits.length;
//             const maxZoom = Number(arrayLimits[size - 1]);
//             const minZoom = maxZoom - size + 1;
//
//             this.zoom = {
//                 min: minZoom,
//                 max: maxZoom,
//             };
//         }
//     }
//
//     override urlFromExtent(tile: TileLike) {
//         return URLBuilder.xyz(tile, this);
//     }
//
//     override onLayerAdded(options: {
//         out: {
//             crs: string,
//             parent: { extent: Extent },
//         }
//     }) {
//         if (!this._featuresCaches[options.out.crs]) {
//             // Cache feature only if it's vector data, the feature are cached in
//             // source. It's not necessary to cache raster in Source, because
//             // it's already cached on layer.
//             this._featuresCaches[options.out.crs] =
//                 this.isVectorSource ? new LRUCache({ max: 500 }) : {
//                     get() { return undefined; },
//                     set() { return this; },
//                     clear() {},
//                 };
//         }
//
//         super.onLayerAdded(options);
//         // Build extents of the set of identical zoom tiles.
//         const parent = options.out.parent;
//         // The extents crs is chosen to facilitate in raster tile process.
//         const crs = parent ? parent.extent.crs : options.out.crs;
//         if (this.tileMatrixSetLimits && !this.extentSetlimits[crs]) {
//             this.extentSetlimits[crs] = {};
//             _tile.crs = this.crs;
//             for (let i = this.zoom.max; i >= this.zoom.min; i--) {
//                 const tmsl = this.tileMatrixSetLimits[i];
//                 const { west, north } =
//                     _tile.set(i, tmsl.minTileRow, tmsl.minTileCol).toExtent(crs);
//                 const { east, south } =
//                     _tile.set(i, tmsl.maxTileRow, tmsl.maxTileCol).toExtent(crs);
//                 this.extentSetlimits[crs][i] = new Extent(crs, west, east, south, north);
//             }
//         }
//     }
//
//     onLayerRemoved(options: { unusedCrs?: string } = {}) {
//         if (!options.unusedCrs) {
//             return;
//         }
//
//         // delete unused cache
//         const unusedCache = this._featuresCaches[options.unusedCrs];
//         if (unusedCache) {
//             unusedCache.clear();
//             delete this._featuresCaches[options.unusedCrs];
//         }
//     }
//
//     // TODO[QB]: is zoom redundant with extent.zoom ???
//     override extentInsideLimit(extent: TileLike, zoom: number) {
//         // This layer provides data starting at level = layer.source.zoom.min
//         // (the zoom.max property is used when building the url to make
//         //  sure we don't use invalid levels)
//         return zoom >= this.zoom.min && zoom <= this.zoom.max &&
//             (this.extentSetlimits[extent.crs] == undefined || this.extentSetlimits[extent.crs][zoom].intersectsExtent(extent));
//     }
// }

interface TMSSource {
    readonly isTMSSource: true;

    zoom: { min: number; max: number };
    isInverted: boolean;
    tileMatrixSetLimits?: Record<number, TMSLimit>;
    extentSetlimits: Record<string, Record<number, Extent>>;
    tileMatrixCallback: (level: number) => string;
}

export default TMSSource;
