import Tile, { TileLike } from 'Core/Tile/Tile';
import URLBuilder from 'Provider/URLBuilder';
import { Extent } from 'Main';
import { FeatureCollection } from 'Core/Feature';
import { globalExtentTMS } from 'Core/Tile/TileGrid';
import { VectorSource } from './VectorSource';
import TMSSource, { TMSSourceOptions } from './TMSSource';


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
    }

    override urlFromExtent(tile: TileLike) {
        return URLBuilder.xyz(tile, this);
    }

    override onLayerAdded(options: {
        out: {
            crs: string,
            parent: { extent: Extent },
        }
    }) {
        super.onLayerAdded(options);
        // Build extents of the set of identical zoom tiles.
        const parent = options.out.parent;
        // The extents crs is chosen to facilitate in raster tile process.
        const crs = parent ? parent.extent.crs : options.out.crs;
        if (this.tileMatrixSetLimits && !this.extentSetlimits[crs]) {
            this.extentSetlimits[crs] = {};
            _tile.crs = this.crs;
            for (let i = this.zoom.max; i >= this.zoom.min; i--) {
                const tmsl = this.tileMatrixSetLimits[i];
                const { west, north } =
                    _tile.set(i, tmsl.minTileRow, tmsl.minTileCol).toExtent(crs);
                const { east, south } =
                    _tile.set(i, tmsl.maxTileRow, tmsl.maxTileCol).toExtent(crs);
                this.extentSetlimits[crs][i] = new Extent(crs, west, east, south, north);
            }
        }
    }
}
