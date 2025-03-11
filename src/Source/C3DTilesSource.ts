import Source, { type SourceOptions } from 'Source/Source';
import Fetcher from 'Provider/Fetcher';
import Tile from 'Core/Tile/Tile';
import { Texture } from 'three';
import { Extent } from 'Main';

/**
 * An object defining the source connection to a 3DTiles dataset from a web
 * server.
 */
class C3DTilesSource extends Source<Tile, Texture> {
    public readonly isC3DTilesSource = true as const;

    /** The base URL to access tiles. */
    public baseUrl: string;

    /**
     * Create a new Source for 3D Tiles data from a web server.
     *
     * @param {Object} source An object that can contain all properties of {@link Source}.
     * Only `url` is mandatory.
     */
    constructor(source: SourceOptions<Texture>) {
        super(source);
        this.baseUrl = this.url.slice(0, this.url.lastIndexOf('/') + 1);
        // TODO: [RD] expected to be Promise<this> but no guarantee due to
        // external data
        this.whenReady = Fetcher.json(this.url, this.networkOptions) as Promise<this>;
    }

    override urlFromExtent(extent: Tile): string {
        throw new Error('Method not implemented.');
    }

    override getDataKey(extent: Tile): string {
        throw new Error('Method not implemented.');
    }

    override onLayerAdded(options: { out: { crs: string; parent: { extent: Extent; }; }; }): void {
        throw new Error('Method not implemented.');
    }

    override onLayerRemoved(options: { unusedCrs: string; }): void {
        throw new Error('Method not implemented.');
    }

    override extentInsideLimit(extent: Extent, zoom: number): boolean {
        throw new Error('Method not implemented.');
    }
}

export default C3DTilesSource;
