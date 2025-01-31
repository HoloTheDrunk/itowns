import { LRUCache } from 'lru-cache';

import Source from 'Source/Source';
import URLBuilder from 'Provider/URLBuilder';
import Extent from 'Core/Geographic/Extent';

import type { SourceOptions } from 'Source/Source';
import type { FeatureCollection } from 'Core/Feature';
import type Tile from 'Core/Tile/Tile';

type WFSVersion = '1.0.0' | '1.1.0' | '2.0.0' | '2.0.2';

export interface WFSSourceOptions extends SourceOptions<FeatureCollection> {
    crs: string;
    typeName: string;
    version?: WFSVersion;
    // format?: string; (defined in Layer.js)
    vendorSpecific?: Record<string, string>;
    zoom?: { min: number; max: number };
    bboxDigits?: number;
}

const _extent = new Extent('EPSG:4326');

/**
 * An object defining the source of resources to get from a
 * [WFS](http://www.opengeospatial.org/standards/wfs) server. It inherits
 * from {@link Source}.
 *
 * @extends Source
 *
 * @property {boolean} isWFSSource - Used to checkout whether this source is a
 * WFSSource. Default is true. You should not change this, as it is used
 * internally for optimisation.
 * @property {string} typeName - The name of the feature to get, used in the
 * generation of the url.
 * @property {string} version - The version of the WFS server to request on.
 * Default value is '2.0.2'.
 * @property {Object} zoom - Object containing the minimum and maximum values of
 * the level, to zoom in the source.
 * @property {number} zoom.min - The minimum level of the source. Default value
 * is 0.
 * @property {number} zoom.max - The maximum level of the source. Default value
 * is 21.
 * @property {string} bboxDigits - The bbox digits precision used in URL
 * @property {Object} vendorSpecific - An object containing vendor specific
 * parameters. See for example a [list of these parameters for GeoServer]{@link
 * https://docs.geoserver.org/latest/en/user/services/wfs/vendor.html}. This
 * object is read simply with the `key` being the name of the parameter and
 * `value` being the value of the parameter. If used, this property should be
 * set in the constructor parameters.
 *
 * @example
 * // Add color layer with WFS source
 * // Create the source
 * const wfsSource = new itowns.WFSSource({
 *     url: 'https://data.geopf.fr/wfs/ows?',
 *     version: '2.0.0',
 *     typeName: 'BDTOPO_BDD_WLD_WGS84G:bati_remarquable',
 *     crs: 'EPSG:4326',
 *     extent: {
 *         west: 4.568,
 *         east: 5.18,
 *         south: 45.437,
 *         north: 46.03,
 *     },
 *     zoom: { min: 14, max: 14 },
 *     format: 'application/json',
 * });
 *
 * // Create the layer
 * const colorlayer = new itowns.ColorLayer('color_build', {
 *     style: {
 *         fill: 'red',
 *         fillOpacity: 0.5,
 *         stroke: 'white',
 *     },
 *     source: wfsSource,
 * });
 *
 * // Add the layer
 * view.addLayer(colorlayer);
 *
 * @example
 * // Add geometry layer with WFS source
 * // Create the source
 * const wfsSource = new itowns.WFSSource({
 *     url: 'https://data.geopf.fr/wfs/ows?',
 *     version: '2.0.0',
 *     typeName: 'BDTOPO_BDD_WLD_WGS84G:bati_remarquable',
 *     crs: 'EPSG:4326',
 *     extent: {
 *         west: 4.568,
 *         east: 5.18,
 *         south: 45.437,
 *         north: 46.03,
 *     },
 *     zoom: { min: 14, max: 14 },
 *     format: 'application/json',
 * });
 *
 * // Create the layer
 * const geometryLayer = new itowns.FeatureGeometryLayer('mesh_build', {
 *     style: {
 *         fill: {
 *             color: new itowns.THREE.Color(0xffcc00),
 *             base_altitude: (p) => p.altitude,
 *             extrusion_height: (p) => p.height,
 *         }
 *     },
 *     source: wfsSource,
 *     zoom: { min: 14 },
 * };
 *
 * // Add the layer
 * view.addLayer(geometryLayer);
 */
class WFSSource extends Source<Extent | Tile, FeatureCollection> {
    readonly isWFSSource: true;

    typeName: string;
    version: WFSVersion;
    bboxDigits: number | undefined;
    zoom: {
        min: number;
        max: number;
    };
    vendorSpecific?: Record<string, string>;

    _featuresCaches: Record<string, LRUCache<string, FeatureCollection>>;

    /**
     * @param {Object} source - An object that can contain all properties of a
     * WFSSource and {@link Source}. `url`, `typeName` and `crs` are
     * mandatory.
     */
    constructor(source: WFSSourceOptions) {
        if (!source.typeName) {
            throw new Error('source.typeName is required in wfs source.');
        }

        if (!source.crs) {
            throw new Error('source.crs is required in wfs source');
        }

        source.format = source.format || 'application/json';

        super(source);

        this.isWFSSource = true;
        this.typeName = source.typeName;
        this.version = source.version || '2.0.2';
        this.bboxDigits = source.bboxDigits;
        this.zoom = { min: 0, max: Infinity };

        const urlObj = new URL(source.url);
        urlObj.searchParams.set('SERVICE', 'WFS');
        urlObj.searchParams.set('REQUEST', 'GetFeature');
        urlObj.searchParams.set('typeName', this.typeName);
        urlObj.searchParams.set('VERSION', this.version);
        urlObj.searchParams.set('SRSNAME', this.crs);
        urlObj.searchParams.set('outputFormat', this.format);
        urlObj.searchParams.set('BBOX', `%bbox,${this.crs}`);

        this.vendorSpecific = source.vendorSpecific;
        for (const name in this.vendorSpecific) {
            if (Object.prototype.hasOwnProperty.call(this.vendorSpecific, name)) {
                urlObj.searchParams.set(name, this.vendorSpecific[name]);
            }
        }

        this.url = decodeURIComponent(urlObj.toString());

        this._featuresCaches = {};
    }

    loadData(extent: Extent | Tile, out: { crs: string }) {
        // TODO[QB]: cache on top when Source#loadData will not have caching
        // anymore
        return super.loadData(extent, out);
    }

    getDataKey(extent: Extent | Tile) {
        if ('isTile' in extent) {
            return super.getDataKey(extent);
        } else {
            // TODO[QB]: Why extent.zoom?
            return `z${extent.zoom}s${extent.south}w${extent.west}`;
        }
    }

    urlFromExtent(extentOrTile: Extent | Tile) {
        const extent = 'isExtent' in extentOrTile ?
            extentOrTile.as(this.crs, _extent) :
            extentOrTile.toExtent(this.crs, _extent);
        return URLBuilder.bbox(extent, this);
    }

    onLayerAdded(options: { out: { crs: string }}) {
        // Added new cache by crs
        if (!this._featuresCaches[options.out.crs]) {
            // Cache feature only if it's vector data, the feature are cached in
            // source.
            this._featuresCaches[options.out.crs] = new LRUCache({ max: 500 });
        }
    }

    onLayerRemoved(options: { unusedCrs?: string } = {}) {
        if (!options.unusedCrs) {
            return;
        }
        // delete unused cache
        const unusedCache = this._featuresCaches[options.unusedCrs];
        if (unusedCache) {
            unusedCache.clear();
            delete this._featuresCaches[options.unusedCrs];
        }
    }

    extentInsideLimit(extent) {
        return this.extent.intersectsExtent(extent);
    }
}

export default WFSSource;
