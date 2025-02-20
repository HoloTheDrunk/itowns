import type { FeatureBuildingOptions, FeatureCollection } from 'Core/Feature';
import type { ProjectionLike } from 'Core/Geographic/Crs';
import { LRUCache } from 'lru-cache';
import Source, { SourceOptions } from './Source';

interface Cache<K, V> {
    get(key: K): V | undefined;
    set(key: K, value: V): this;
    clear(): void;
}

export abstract class VectorSource<K> extends Source<K, FeatureCollection> {
    readonly isVectorSource = true as const;

    _featuresCaches: Record<string, Cache<string, Promise<FeatureCollection>>>;

    public constructor(options: SourceOptions<FeatureCollection>) {
        super(options);
        this._featuresCaches = {};
    }

    /**
     * Load  data from cache or fetch and parse data.
     * The loaded data is a Feature or Texture.
     *
     * @param      extent - extent requested parsed data.
     * @param      out - The feature returned options
     */
    public override loadData(extent: K, out: FeatureBuildingOptions): Promise<FeatureCollection> {
        const cache = this._featuresCaches[out.crs];
        const key = this.getDataKey(extent);
        // try to get parsed data from cache
        let features = cache.get(key);
        if (features === undefined) {
            // otherwise fetch/parse the data
            features = this.fetcher(this.urlFromExtent(extent), this.networkOptions)
                .then(file => this.parser(file, { out, in: this, extent }))
                .catch(err => this.handlingError(err));

            cache.set(key, features);
        }
        return features;
    }

    /** Called when layer added. */
    public override onLayerAdded(options: { out: { crs: ProjectionLike } }) {
        // Added new cache by crs
        if (!this._featuresCaches[options.out.crs]) {
            // Cache feature only if it's vector data, the feature are cached in
            // source. It's not necessary to cache raster in Source, because
            // it's already cached on layer.
            this._featuresCaches[options.out.crs] =
                new LRUCache<string, Promise<FeatureCollection>>({ max: 500 });
        }
    }

    /** Called when layer removed. */
    public override onLayerRemoved(options: { unusedCrs: string }) {
        // delete unused cache
        const unusedCache = this._featuresCaches[options.unusedCrs];
        if (unusedCache) {
            unusedCache.clear();
            delete this._featuresCaches[options.unusedCrs];
        }
    }
}
