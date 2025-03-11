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

import type { ProjectionLike } from 'Core/Geographic/Crs';
import type { FeatureBuildingOptions } from 'Core/Feature';

type Fetcher<T> = (url: string, header: RequestInit) => Promise<T>;

interface ParsingOptions<K, V> {
    /** Data information contained in the file. */
    in: Source<K, V>,
    /** How the features should be built. */
    out: FeatureBuildingOptions,
    extent: K,
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

let uid = 0;

/**
 * Sources are object containing informations on how to fetch resources, from a
 * set source.
 *
 * To extend a Source, it is necessary to implement two functions:
 * `urlFromExtent` and `extentInsideLimit`.
 */
abstract class Source<K, V> {
    /**
     * Indicates whether this source is a Source. Default is true. You should
     * not change this, as it is used internally for optimisation.
     */
    readonly isSource: true;

    /** The crs projection of the resources. */
    crs: ProjectionLike;

    /** Unique uid used to store data linked to this source into Cache. */
    protected uid: number;
    /** The url of the resources that are fetched. */
    public url: string;
    /** The format of the resources that are fetched. */
    public format: string;

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
    public networkOptions: RequestInit;
    /** The intellectual property rights for the resources. */
    public attribution: AttributionLike;
    public whenReady: Promise<this>;
    /** The extent of the resources. */
    public extent?: Extent;

    /**
     * @param source - An object that can contain all properties of a
     * Source. Only the `url` property is mandatory.
     */
    public constructor(source: SourceOptions<V>) {
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
        this.networkOptions = source.networkOptions || { crossOrigin: 'anonymous' };
        this.attribution = source.attribution;
        this.whenReady = Promise.resolve(this);
        if (source.extent && !(source.extent.isExtent)) {
            this.extent = new Extent(this.crs).setFromExtent(source.extent);
        } else {
            this.extent = source.extent;
        }
    }

    protected handlingError(err: Error): never {
        throw err;
    }

    /**
     * Generates a url from an extent. This url is a link to fetch the
     * resources inside the extent.
     */
    public abstract urlFromExtent(extent: K): string;

    /** Converts the desired Source key object to a cache key string. */
    public abstract getDataKey(extent: K): string;

    /**
     * Load data from cache or fetch and parse data.
     * The loaded data is a Feature or Texture.
     *
     * @param      extent - extent requested parsed data.
     * @param      out - The feature returned options
     */
    public async loadData(extent: K, out: FeatureBuildingOptions): Promise<V> {
        // Fetch and parse the data
        try {
            const file = await this.fetcher(this.urlFromExtent(extent), this.networkOptions);
            return await this.parser(file, { out, in: this, extent });
        } catch (err) {
            return this.handlingError(err as Error);
        }
    }

    /** Called when a layer is added. */
    public abstract onLayerAdded(options: {
        out: {
            crs: string,
            parent: { extent: Extent },
        }
    }): void;

    /** Called when a layer is removed. */
    public abstract onLayerRemoved(options: { unusedCrs: string }): void;

    /**
     * Tests if an extent is inside the source limits.
     *
     * @param extent - Extent to test.
     * @param zoom - Zoom or level to use for the limit.
     *
     * @returns `true` if the extent is inside the limit, `false` otherwise.
     */
    public abstract extentInsideLimit(extent: Extent, zoom: number): boolean;
}

export default Source;
