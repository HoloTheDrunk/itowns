import URLBuilder, { TileSource } from 'Provider/URLBuilder';
import Extent from 'Core/Geographic/Extent';
import Tile, { TileLike } from 'Core/Tile/Tile';
import { globalExtentTMS } from 'Core/Tile/TileGrid';

import type { Texture } from 'three';
import type { ProjectionLike } from 'Core/Geographic/Crs';
import type { SourceOptions } from 'Source/Source';
import type { FeatureCollection } from 'Core/Feature';
import Source from 'Source/Source';
import { VectorSource } from './VectorSource';

const _tile = new Tile('EPSG:4326', 0, 0, 0);

type TMSLimit = {
    minTileRow: number;
    maxTileRow: number;
    minTileCol: number;
    maxTileCol: number;
};

export interface TMSSourceOptions<T extends Texture | FeatureCollection> extends SourceOptions<T> {
    crs: ProjectionLike;
    tileMatrixSetLimits?: Record<number, TMSLimit>;
    tileMatrixCallback?: (level: number) => string;
    isInverted?: boolean;
    zoom?: { min: number; max: number; };
}

// TMSVectorSource and TMSRasterSource could've benefited from multiple
// inheritance simulated by a mixin, but using a simple interface and repeating
// a few lines of code that are unlikely to change is significantly simpler.
export default interface TMSSource {
    readonly isTMSSource: true;

    zoom: { min: number; max: number; };
    isInverted: boolean;
    tileMatrixSetLimits?: Record<number, TMSLimit>;
    extentSetlimits: Record<string, Record<number, Extent>>;
    tileMatrixCallback: (level: number) => string;
}

const SHARED = Object.freeze({
    urlFromExtent: (source: TileSource, tile: TileLike): string => URLBuilder.xyz(tile, source),
    getDataKey: (extent: Tile): string => `z${extent.zoom}r${extent.row}c${extent.col}`,
    // The formatting sucks because eslint is not very good
    extentInsideLimit: (source: TMSSource, extent: Extent, zoom: number): boolean => (
        zoom >= source.zoom.min && zoom <= source.zoom.max
    ) && (
        source.extentSetlimits[extent.crs] == undefined
            || source.extentSetlimits[extent.crs][zoom].intersectsExtent(extent)
    ),
    onLayerAdded: <T extends Texture | FeatureCollection>(
        source: Source<Tile, T> & TMSSource,
        options: {
            out: {
                crs: string,
                parent: { extent: Extent },
            }
        },
    ): void => {
        // Build extents of the set of identical zoom tiles.
        const parent = options.out.parent;
        // The extents crs is chosen to facilitate in raster tile process.
        const crs = parent ? parent.extent.crs : options.out.crs;
        if (source.tileMatrixSetLimits && !source.extentSetlimits[crs]) {
            source.extentSetlimits[crs] = {};
            _tile.crs = source.crs;
            for (let i = source.zoom.max; i >= source.zoom.min; i--) {
                const tmsl = source.tileMatrixSetLimits[i];
                const { west, north } =
                    _tile.set(i, tmsl.minTileRow, tmsl.minTileCol).toExtent(crs);
                const { east, south } =
                    _tile.set(i, tmsl.maxTileRow, tmsl.maxTileCol).toExtent(crs);
                source.extentSetlimits[crs][i] = new Extent(crs, west, east, south, north);
            }
        }
    },
});

export class TMSVectorSource extends VectorSource<Tile> implements TMSSource {
    public readonly isTMSSource = true as const;

    public zoom: { min: number; max: number; };
    public isInverted: boolean;
    public tileMatrixSetLimits?: Record<number, {
        minTileRow: number;
        maxTileRow: number;
        minTileCol: number;
        maxTileCol: number;
    }>;

    public extentSetlimits: Record<string, Record<number, Extent>>;
    public tileMatrixCallback: (level: number) => string;

    public constructor(source: TMSSourceOptions<FeatureCollection>) {
        super(source);

        this.crs = source.crs;

        if (!source.extent) {
            // default to the global extent
            this.extent = globalExtentTMS.get(source.crs);
        }
        // TODO[QB]: constify
        this.zoom = source.zoom ?? { min: 0, max: Infinity };
        this.isInverted = source.isInverted ?? false;

        this.tileMatrixSetLimits = source.tileMatrixSetLimits;
        this.extentSetlimits = {};
        this.tileMatrixCallback =
            source.tileMatrixCallback ?? ((zoomLevel: number) => zoomLevel.toString());

        if (this.tileMatrixSetLimits) {
            const arrayLimits = Object.keys(this.tileMatrixSetLimits);
            const size = arrayLimits.length;
            const maxZoom = Number(arrayLimits[size - 1]);
            const minZoom = maxZoom - size + 1;

            this.zoom = {
                min: minZoom,
                max: maxZoom,
            };
        }
    }

    override getDataKey(extent: Tile): string {
        return SHARED.getDataKey(extent);
    }

    override urlFromExtent(tile: TileLike) {
        return SHARED.urlFromExtent(this, tile);
    }

    override onLayerAdded(options: {
        out: {
            crs: string,
            parent: { extent: Extent },
        }
    }) {
        super.onLayerAdded(options);
        SHARED.onLayerAdded(this, options);
    }

    override extentInsideLimit(extent: Extent, zoom: number): boolean {
        return SHARED.extentInsideLimit(this, extent, zoom);
    }
}

export class TMSRasterSource extends Source<Tile, Texture> implements TMSSource {
    public readonly isTMSSource = true as const;

    public zoom: { min: number; max: number; };
    public isInverted: boolean;
    public tileMatrixSetLimits?: Record<number, {
        minTileRow: number;
        maxTileRow: number;
        minTileCol: number;
        maxTileCol: number;
    }>;

    public extentSetlimits: Record<string, Record<number, Extent>>;
    public tileMatrixCallback: (level: number) => string;
    constructor(source: TMSSourceOptions<Texture>) {
        // TODO: Pass custom parser
        super(source);

        this.crs = source.crs;

        if (!source.extent) {
            // default to the global extent
            this.extent = globalExtentTMS.get(source.crs);
        }

        // TODO[QB]: constify
        this.zoom = source.zoom ?? { min: 0, max: Infinity };
        this.isInverted = source.isInverted ?? false;

        this.tileMatrixSetLimits = source.tileMatrixSetLimits;
        this.extentSetlimits = {};
        this.tileMatrixCallback =
            source.tileMatrixCallback ?? ((zoomLevel: number) => zoomLevel.toString());

        if (this.tileMatrixSetLimits) {
            const arrayLimits = Object.keys(this.tileMatrixSetLimits);
            const size = arrayLimits.length;
            const maxZoom = Number(arrayLimits[size - 1]);
            const minZoom = maxZoom - size + 1;

            this.zoom = {
                min: minZoom,
                max: maxZoom,
            };
        }
    }

    override urlFromExtent(tile: Tile): string {
        return SHARED.urlFromExtent(this, tile);
    }

    override getDataKey(extent: Tile): string {
        return SHARED.getDataKey(extent);
    }

    override onLayerAdded(options: {
        out: {
            crs: ProjectionLike,
            parent: { extent: Extent }
        }
    }): void {
        SHARED.onLayerAdded(this, options);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    override onLayerRemoved(options: { unusedCrs: string; }): void {}

    override extentInsideLimit(extent: Extent, zoom: number): boolean {
        return SHARED.extentInsideLimit(this, extent, zoom);
    }
}
