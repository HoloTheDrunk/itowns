import * as THREE from 'three';
// @ts-expect-error: importing non-ts file
import TileVS from 'Renderer/Shader/TileVS.glsl';
// @ts-expect-error: importing non-ts file
import TileFS from 'Renderer/Shader/TileFS.glsl';
import ShaderUtils from 'Renderer/Shader/ShaderUtils';
import Capabilities from 'Core/System/Capabilities';
import RenderMode from 'Renderer/RenderMode';
import CommonMaterial from 'Renderer/CommonMaterial';
import { RasterTile, RasterElevationTile, RasterColorTile } from './RasterTile';

const identityOffsetScale = new THREE.Vector4(0.0, 0.0, 1.0, 1.0);
const defaultTex = new THREE.Texture();

// from three.js packDepthToRGBA
const UnpackDownscale = 255 / 256; // 0..1 -> fraction (excluding 1)
const bitSh = new THREE.Vector4(
    UnpackDownscale,
    UnpackDownscale / 256.0,
    UnpackDownscale / (256.0 * 256.0),
    UnpackDownscale / (256.0 * 256.0 * 256.0),
);

export function unpack1K(color: THREE.Vector4Like, factor: number): number {
    return factor ? bitSh.dot(color) * factor : bitSh.dot(color);
}

// Max sampler color count to LayeredMaterial
// Because there's a statement limitation to unroll, in getColorAtIdUv method
const maxSamplersColorCount = 15;
const samplersElevationCount = 1;

export function getMaxColorSamplerUnitsCount(): number {
    const maxSamplerUnitsCount = Capabilities.getMaxTextureUnitsCount();
    return Math.min(
        maxSamplerUnitsCount - samplersElevationCount,
        maxSamplersColorCount,
    );
}

export const colorLayerEffects: Record<string, number> = {
    noEffect: 0,
    removeLightColor: 1,
    removeWhiteColor: 2,
    customEffect: 3,
};

type StructColorLayer = {
    textureOffset: number;
    crs: number;
    opacity: number;
    effect_parameter: number;
    effect_type: number;
    transparent: boolean;
};

type StructElevationLayer = {
    scale: number;
    bias: number;
    mode: number;
    zmin: number;
    zmax: number;
};

const defaultStructLayers: Readonly<{
    color: StructColorLayer,
    elevation: StructElevationLayer
}> = {
    color: {
        textureOffset: 0,
        crs: 0,
        opacity: 0,
        effect_parameter: 0,
        effect_type: colorLayerEffects.noEffect,
        transparent: false,
    },
    elevation: {
        scale: 0,
        bias: 0,
        mode: 0,
        zmin: 0,
        zmax: 0,
    },
};

function updateLayersUniforms(
    uniforms: { [name: string]: THREE.IUniform },
    olayers: RasterTile[],
    max: number,
) {
    // prepare convenient access to elevation or color uniforms
    const layers = uniforms.layers.value;
    const textures = uniforms.textures.value;
    const offsetScales = uniforms.offsetScales.value;
    const textureCount = uniforms.textureCount;

    // flatten the 2d array [i,j] -> layers[_layerIds[i]].textures[j]
    let count = 0;
    for (const layer of olayers) {
        layer.textureOffset = count;

        for (
            let i = 0;
            i < layer.textures.length && count < max;
            ++i, ++count
        ) {
            offsetScales[count] = layer.offsetScales[i];
            textures[count] = layer.textures[i];
            layers[count] = layer;
        }
    }
    if (count > max) {
        console.warn(
            `LayeredMaterial: Not enough texture units (${max} < ${count}),`
            + 'excess textures have been discarded.',
        );
    }
    textureCount.value = count;
}

export const ELEVATION_MODES = {
    RGBA: 0,
    COLOR: 1,
    DATA: 2,
};

type MappedUniforms<Uniforms> = {
    [name in keyof Uniforms]: THREE.IUniform<Uniforms[name]>;
};

type LayeredMaterialRawUniforms = {
    // Color
    diffuse: THREE.Color;
    opacity: number;

    // Lighting
    lightingEnabled: boolean;
    lightPosition: THREE.Vector3;

    // Misc
    fogDistance: number;
    fogColor: THREE.Color;
    overlayAlpha: number;
    overlayColor: THREE.Color;
    objectId: number;
    geoidHeight: number;

    // > 0 produces gaps,
    // < 0 causes oversampling of textures
    // = 0 causes sampling artefacts due to bad estimation of texture-uv
    // gradients
    // best is a small negative number
    minBorderDistance: number;

    // Debug
    showOutline: boolean,
    outlineWidth: number,
    outlineColors: THREE.Color[]

    // Elevation layers
    elevationLayers: Array<StructElevationLayer>,
    elevationTextures: Array<THREE.Texture>,
    elevationOffsetScales: Array<THREE.Vector4>,
    elevationTextureCount: number,

    // Color layers
    colorLayers: Array<StructColorLayer>,
    colorTextures: Array<THREE.Texture>,
    colorOffsetScales: Array<THREE.Vector4>,
    colorTextureCount: number,
};

let nbSamplers: [number, number];
const fragmentShader: string[] = [];

type LayeredMaterialParameters =
    Omit<THREE.ShaderMaterialParameters, 'uniforms'>
    & { uniforms?: MappedUniforms<LayeredMaterialRawUniforms> };

export class LayeredMaterial extends THREE.ShaderMaterial {
    private _visible = true;
    // public rasterLayers: RasterTile[] = [];

    public colorLayers: RasterColorTile[];
    public elevationLayer: RasterElevationTile | undefined;

    public colorLayerIds: string[];
    public elevationLayerId: string | undefined;

    public layersNeedUpdate: boolean;

    constructor(options: LayeredMaterialParameters = {}, crsCount: number) {
        super(options);

        nbSamplers ||= [samplersElevationCount, getMaxColorSamplerUnitsCount()];

        this.defines.NUM_VS_TEXTURES = nbSamplers[0];
        this.defines.NUM_FS_TEXTURES = nbSamplers[1];
        // TODO: We do not use the fog from the scene, is this a desired
        // behavior?
        this.defines.USE_FOG = 1;
        this.defines.NUM_CRS = crsCount;

        CommonMaterial.setDefineMapping(this, 'ELEVATION', ELEVATION_MODES);
        CommonMaterial.setDefineMapping(this, 'MODE', RenderMode.MODES);
        CommonMaterial.setDefineProperty(
            this,
            'mode', 'MODE',
            RenderMode.MODES.FINAL,
        );

        // @ts-expect-error: global constexpr
        if (__DEBUG__) {
            this.defines.DEBUG = 1;

            const outlineColors = [new THREE.Color(1.0, 0.0, 0.0)];
            if (crsCount > 1) {
                outlineColors.push(new THREE.Color(1.0, 0.5, 0.0));
            }

            this.initUniforms({
                showOutline: true,
                outlineWidth: 0.008,
                outlineColors,
            });
        }

        this.vertexShader = TileVS;
        // three loop unrolling of ShaderMaterial only supports integer bounds,
        // see https://github.com/mrdoob/three.js/issues/28020
        fragmentShader[crsCount] ||=
            ShaderUtils.unrollLoops(TileFS, this.defines);
        this.fragmentShader = fragmentShader[crsCount];

        this.initUniforms({
            // Color uniforms
            diffuse: new THREE.Color(0.04, 0.23, 0.35),
            opacity: this.opacity,

            // Lighting uniforms
            lightingEnabled: false,
            lightPosition: new THREE.Vector3(-0.5, 0.0, 1.0),

            // Misc properties
            fogDistance: 1000000000.0,
            fogColor: new THREE.Color(0.76, 0.85, 1.0),
            overlayAlpha: 0,
            overlayColor: new THREE.Color(1.0, 0.3, 0.0),
            objectId: 0,

            geoidHeight: 0.0,

            // > 0 produces gaps,
            // < 0 causes oversampling of textures
            // = 0 causes sampling artefacts due to bad estimation of texture-uv
            // gradients
            // best is a small negative number
            minBorderDistance: -0.01,
        });

        // LayeredMaterialLayers
        this.colorLayers = [];
        this.colorLayerIds = [];
        this.layersNeedUpdate = false;

        // elevation/color layer uniforms, to be updated using updateUniforms()
        this.initUniforms({
            elevationLayers: new Array(nbSamplers[0])
                .fill(defaultStructLayers.elevation),
            elevationTextures: new Array(nbSamplers[0]).fill(defaultTex),
            elevationOffsetScales: new Array(nbSamplers[0])
                .fill(identityOffsetScale),
            elevationTextureCount: 0,

            colorLayers: new Array(nbSamplers[1])
                .fill(defaultStructLayers.color),
            colorTextures: new Array(nbSamplers[1]).fill(defaultTex),
            colorOffsetScales: new Array(nbSamplers[1])
                .fill(identityOffsetScale),
            colorTextureCount: 0,
        });

        // Can't do an ES6 getter/setter here because it would override the
        // Material::visible property with accessors, which is not allowed.
        Object.defineProperty(this, 'visible', {
            // Knowing the visibility of a `LayeredMaterial` is useful. For
            // example in a `GlobeView`, if you zoom in, "parent" tiles seems
            // hidden; in fact, there are not, it is only their material (so
            // `LayeredMaterial`) that is set to not visible.

            // Adding an event when changing this property can be useful to
            // hide others things, like in `TileDebug`, or in later PR to come
            // (#1303 for example).

            // TODO : verify if there is a better mechanism to avoid this event
            get() { return this._visible; },
            set(v) {
                if (this._visible != v) {
                    this._visible = v;
                    this.dispatchEvent({ type: v ? 'shown' : 'hidden' });
                }
            },
        });
    }

    public getUniform<Name extends keyof LayeredMaterialRawUniforms>(
        name: Name,
    ): LayeredMaterialRawUniforms[Name] | undefined {
        return this.uniforms[name]?.value;
    }

    public setUniform<
        Name extends keyof LayeredMaterialRawUniforms,
        Value extends LayeredMaterialRawUniforms[Name],
    >(name: Name, value: Value): void {
        const uniform = this.uniforms[name];
        if (uniform === undefined) {
            return;
        }
        if (uniform.value !== value) {
            uniform.value = value;
        }
    }

    public initUniforms(uniforms: {
        [Name in keyof LayeredMaterialRawUniforms
        ]?: LayeredMaterialRawUniforms[Name]
    }): void {
        for (const [name, value] of Object.entries(uniforms)) {
            if (this.uniforms[name] === undefined) {
                this.uniforms[name] = { value };
            }
        }
    }

    public setUniforms(uniforms: {
        [Name in keyof LayeredMaterialRawUniforms
        ]?: LayeredMaterialRawUniforms[Name]
    }): void {
        for (const [name, value] of Object.entries(uniforms)) {
            const uniform = this.uniforms[name];
            if (uniform === undefined) {
                continue;
            }
            if (uniform.value !== value) {
                uniform.value = value;
            }
        }
    }

    public getLayerUniforms<Type extends 'color' | 'elevation'>(type: Type):
        MappedUniforms<{
            layers: Array<Type extends 'color'
                ? StructColorLayer
                : StructElevationLayer>,
            textures: Array<THREE.Texture>,
            offsetScales: Array<THREE.Vector4>,
            textureCount: number,
        }> {
        return {
            layers: this.uniforms[`${type}Layers`],
            textures: this.uniforms[`${type}Textures`],
            offsetScales: this.uniforms[`${type}OffsetScales`],
            textureCount: this.uniforms[`${type}TextureCount`],
        };
    }

    public updateLayersUniforms(): void {
        const colorlayers = this.colorLayers
            .filter(rt => rt.visible && rt.opacity > 0);
        colorlayers.sort((a, b) =>
            this.colorLayerIds.indexOf(a.id) - this.colorLayerIds.indexOf(b.id),
        );

        updateLayersUniforms(
            this.getLayerUniforms('color'),
            colorlayers,
            this.defines.NUM_FS_TEXTURES,
        );

        if ((this.elevationLayerId !== undefined
            && this.getColorLayer(this.elevationLayerId))
            || (this.uniforms.elevationTextureCount.value
                && this.elevationLayerId !== undefined)
        ) {
            if (this.elevationLayer !== undefined) {
                updateLayersUniforms(
                    this.getLayerUniforms('elevation'),
                    [this.elevationLayer],
                    this.defines.NUM_VS_TEXTURES,
                );
            }
        }

        this.layersNeedUpdate = false;
    }

    public dispose(): void {
        this.dispatchEvent({ type: 'dispose' });

        this.colorLayers.forEach(l => l.dispose(true));
        this.colorLayers.length = 0;

        this.elevationLayer?.dispose(true);

        this.layersNeedUpdate = true;
    }

    public setColorLayerIds(ids: string[]): void {
        this.colorLayerIds = ids;
        this.layersNeedUpdate = true;
    }

    public setElevationLayerId(id: string): void {
        this.elevationLayerId = id;
        this.layersNeedUpdate = true;
    }

    public removeLayer(layerId: string): void {
        const index = this.colorLayers.findIndex(l => l.id === layerId);
        if (index > -1) {
            this.colorLayers[index].dispose();
            this.colorLayers.splice(index, 1);
            const idSeq = this.colorLayerIds.indexOf(layerId);
            if (idSeq > -1) {
                this.colorLayerIds.splice(idSeq, 1);
            } else {
                this.elevationLayerId = undefined;
            }
        }
    }

    public addColorLayer(rasterNode: RasterColorTile) {
        if (rasterNode.layer.id in this.colorLayers) {
            console.warn(
                'Layer "{layer.id}" already present in material, overwriting.',
            );
        }
        this.colorLayers.push(rasterNode);
    }

    getColorLayer(id: string) {
        return this.colorLayers.find(l => l.id === id);
    }

    getColorLayers(ids: string[]) {
        return this.colorLayers.filter(l => ids.includes(l.id));
    }

    getElevationLayer(): RasterElevationTile | undefined {
        return this.elevationLayer as RasterElevationTile;
    }
}
