import * as CRS from 'Core/Geographic/Crs';
import Extent from 'Core/Geographic/Extent';
import GeoJsonParser from 'Parser/GeoJsonParser';
import KMLParser from 'Parser/KMLParser';
import GDFParser from 'Parser/GDFParser';
import GpxParser from 'Parser/GpxParser';
import GTXParser from 'Parser/GTXParser';
import ISGParser from 'Parser/ISGParser';
import VectorTileParser from 'Parser/VectorTileParser';
import Fetcher from 'Provider/Fetcher';
import { LRUCache } from 'lru-cache';

import type { ProjectionLike } from 'Core/Geographic/Crs';
import type { FeatureBuildingOptions, FeatureCollection } from 'Core/Feature';

type Fetcher<T> = (url: string, header: RequestInit) => Promise<T>;

interface ParsingOptions<K, V> {
    /** Data information contained in the file. */
    in: Source<K, V>,
    /** How the features should be built. */
    out: FeatureBuildingOptions,
}
type Parser<D, K, V> = (data: D, options: ParsingOptions<K, V>) => Promise<V>;

export type AttributionLike = string | string[];

export interface SourceOptions<V> {
    crs: ProjectionLike;
    url: string;
    format: string;
    fetcher: Fetcher<unknown>;
    parser: Parser<unknown, unknown, V>;
    networkOptions: RequestInit;
    attribution: AttributionLike;
    extent?: Extent;
}

interface Cache<K, V> {
    get(key: K): V | undefined;
    set(key: K, value: V): this;
    clear(): void;
}

export const supportedParsers = new Map<string, unknown>([
    ['application/geo+json', GeoJsonParser.parse],
    ['application/json', GeoJsonParser.parse],
    ['application/kml', KMLParser.parse],
    ['application/gpx', GpxParser.parse],
    ['application/x-protobuf;type=mapbox-vector', VectorTileParser.parse],
    ['application/gtx', GTXParser.parse],
    ['application/isg', ISGParser.parse],
    ['application/gdf', GDFParser.parse],
]);

const noCache = { get: () => { }, set: (a: unknown) => a, clear: () => { } };

let uid = 0;

/**
 * Sources are object containing informations on how to fetch resources, from a
 * set source.
 *
 * To extend a Source, it is necessary to implement two functions:
 * `urlFromExtent` and `extentInsideLimit`.
 */
class Source<K extends { [prop in 'zoom' | 'row' | 'col']: number }, V> {
    /**
     * Indicates whether this source is a Source. Default is true. You should
     * not change this, as it is used internally for optimisation.
     */
    readonly isSource: true;
    /** Indicates whether this source produces vector data. Default is false */
    isVectorSource: boolean;

    /** The crs projection of the resources. */
    crs: ProjectionLike;

    /** Unique uid used to store data linked to this source into Cache. */
    uid: number;
    /** The url of the resources that are fetched. */
    url: string;
    /** The format of the resources that are fetched. */
    format: string;

    /**
     * The method used to fetch the resources from the source. iTowns provides
     * some methods in {@link Fetcher}, but it can be specified a custom one.
     * This method should return a `Promise` containing the fetched resource.
     * If this property is set, it overrides the chosen fetcher method with
     * `format`.
     */
    protected fetcher: Fetcher<unknown>;
    /**
     * The method used to parse the resources attached to the layer. iTowns
     * provides some parsers, visible in the `Parser/` folder. If the method is
     * custom, it should return a `Promise` containing the parsed resource. If
     * this property is set, it overrides the default selected parser method
     * with `source.format`. If `source.format` is also empty, no parsing action
     * is done.
     *
     * When calling this method, two parameters are passed:
     *  - the fetched data, i.e. the data to parse
     *  - a {@link ParsingOptions} containing severals properties, set when this
     *    method is called: it is specific to each call, so the value of each
     *    property can vary depending on the current fetched tile for example
     */
    protected parser: Parser<unknown, K, V>;

    /**
     * Fetch options (passed directly to `fetch()`), see [the syntax for more information](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Syntax).
     * By default, set to `{ crossOrigin: 'anonymous' }`.
     */
    networkOptions: RequestInit;
    /** The intellectual property rights for the resources. */
    attribution: AttributionLike;
    whenReady: Promise<this>;
    _featuresCaches: Record<string, Cache<string, FeatureCollection>>;
    /** The extent of the resources. */
    extent?: Extent;

    /**
     * @param source - An object that can contain all properties of a
     * Source. Only the `url` property is mandatory.
     */
    constructor(source: SourceOptions<V>) {
        if (source.crs) {
            CRS.isValid(source.crs);
        }
        this.crs = source.crs;
        this.isSource = true;

        if (!source.url) {
            throw new Error('New Source: url is required');
        }

        this.uid = uid++;

        this.url = source.url;
        this.format = source.format;
        this.fetcher = source.fetcher ?? Fetcher.get(source.format);
        this.parser = source.parser
            ?? supportedParsers.get(source.format)
            ?? (<D extends { extent: Extent }, O extends { extent: Extent }>(data: D, opt: O) => {
                data.extent = opt.extent;
                return data;
            });
        this.isVectorSource = (source.parser || supportedParsers.get(source.format)) != undefined;
        this.networkOptions = source.networkOptions || { crossOrigin: 'anonymous' };
        this.attribution = source.attribution;
        this.whenReady = Promise.resolve(this);
        this._featuresCaches = {};
        if (source.extent && !(source.extent.isExtent)) {
            this.extent = new Extent(this.crs).setFromExtent(source.extent);
        } else {
            this.extent = source.extent;
        }
    }

    handlingError(err: Error) {
        throw err;
    }

    /**
     * Generates a url from an extent. This url is a link to fetch the
     * resources inside the extent.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    urlFromExtent(extent: K): string {
        throw new Error('In extended Source, you have to implement the method urlFromExtent!');
    }

    getDataKey(extent: K): string {
        return `z${extent.zoom}r${extent.row}c${extent.col}`;
    }

    /**
     * Load  data from cache or fetch and parse data.
     * The loaded data is a Feature or Texture.
     *
     * @param      extent - extent requested parsed data.
     * @param      out - The feature returned options
     */
    loadData(extent: K, out: { crs: string } & unknown): Promise<V> {
        const cache = this._featuresCaches[out.crs];
        const key = this.getDataKey(extent);
        // console.log('Source.loadData', key);
        // try to get parsed data from cache
        let features = cache.get(key);
        if (!features) {
            // otherwise fetch/parse the data
            features = this.fetcher(this.urlFromExtent(extent), this.networkOptions)
                .then(file => this.parser(file, { out, in: this, extent }))
                .catch(err => this.handlingError(err));

            cache.set(key, features);
        }
        return features;
    }

    /**
     * Called when layer added.
     *
     * @param {object} options
     */
    onLayerAdded(options: { out: { crs: ProjectionLike } }) {
        // Added new cache by crs
        if (!this._featuresCaches[options.out.crs]) {
            // Cache feature only if it's vector data, the feature are cached in source.
            // It's not necessary to cache raster in Source,
            // because it's already cached on layer.
            this._featuresCaches[options.out.crs] = this.isVectorSource ? new LRUCache({ max: 500 }) : noCache;
        }
    }

    /**
     * Called when layer removed.
     *
     * @param {options}  [options={}] options
     */
    onLayerRemoved(options: any = {}) {
        // delete unused cache
        const unusedCache = this._featuresCaches[options.unusedCrs];
        if (unusedCache) {
            unusedCache.clear();
            delete this._featuresCaches[options.unusedCrs];
        }
    }

    /**
     * Tests if an extent is inside the source limits.
     *
     * @param extent - Extent to test.
     * @returns True if the extent is inside the limit, false otherwise.
     */
    // eslint-disable-next-line
    extentInsideLimit(extent: K) {
        throw new Error('In extented Source, you have to implement the method extentInsideLimit!');
    }
}

export default Source;
