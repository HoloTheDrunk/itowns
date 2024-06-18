import * as THREE from 'three';
import { Vector2 } from 'three';
import { BuiltinType, Dependency, DumpDotNodeStyle, GraphNode, Type, Mappings, ProcessorNode } from '../Prelude';
import { CameraLike } from '../Types';

type CallbackArgs = {
    target: THREE.WebGLRenderTarget;
    renderer: THREE.WebGLRenderer;
} & { [name: string]: any };

type FragmentShaderParts = {
    includes?: string[],
    defines?: { [name: string]: number | string },
    uniforms?: { [name: string]: Dependency | GraphNode | Type };
    auxCode?: string;
    main: string;
};

/**
 * A node that applies a shader to a render target.
 *
 */
export default class ScreenShaderNode extends ProcessorNode {
    protected static get vertexShader(): string {
        return /* glsl */`
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;
    }

    protected static get defaultFragmentShader(): FragmentShaderParts {
        return {
            main: /* glsl */'return tex;',
        };
    }

    // HACK: Essentially a scuffed singleton pack.
    // PERF: Evaluate the cost of having a scene per shader node instead.
    protected static _scene: THREE.Scene;
    protected static _quad: THREE.Mesh;
    protected static _camera: CameraLike;

    // Kept for debug purposes
    public material: THREE.ShaderMaterial;

    protected _fragmentShaderParts: FragmentShaderParts;

    private static _init(): void {
        if (ScreenShaderNode._scene == undefined) {
            ScreenShaderNode._scene = new THREE.Scene();

            // Setup the quad used to render the effects
            ScreenShaderNode._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
            ScreenShaderNode._quad.frustumCulled = false;

            ScreenShaderNode._scene.add(ScreenShaderNode._quad);

            ScreenShaderNode._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        }
    }

    public constructor(
        target: Dependency,
        renderer: Dependency,
        { fragmentShaderParts = ScreenShaderNode.defaultFragmentShader, toScreen = false }: {
            fragmentShaderParts?: FragmentShaderParts,
            toScreen?: boolean
        },
    ) {
        ScreenShaderNode._init();

        const uniforms = fragmentShaderParts.uniforms ?? {};

        const fullUniforms = Object.fromEntries(
            Object.entries(uniforms)
                .map(([name, uniform]): [string, [Dependency | null, Type]] => {
                    let val: [Dependency | null, Type];
                    if (typeof uniform == 'string') {
                        val = [null, uniform];
                    } else if (uniform instanceof GraphNode) {
                        val = [{ node: uniform, output: GraphNode.defaultIoName }, uniform.outputs.get(GraphNode.defaultIoName)![1]];
                    } else {
                        val = [uniform, uniform.node.outputs.get(uniform.output)![1]];
                    }

                    return [name, val];
                }),
        );

        super(
            {
                // Unpacking the uniforms object first allows us to ignore
                // potential 'target' and 'renderer' fields.
                ...fullUniforms,
                target: [target, BuiltinType.RenderTarget],
                renderer: [renderer, BuiltinType.Renderer],
            },
            BuiltinType.RenderTarget,
            (_frame, args) => {
                const { target: input, renderer, ...uniforms } = args as CallbackArgs;

                uniforms.tDiffuse = input.texture;
                uniforms.tDepth = input.depthTexture;

                uniforms.resolution ??= new Vector2(input.width, input.height);

                const camera = ScreenShaderNode._camera as CameraLike;
                uniforms.cameraNear ??= camera.near;
                uniforms.cameraFar ??= camera.far;

                // Set user-provided uniforms
                for (const [name, value] of Object.entries(uniforms ?? {})) {
                    this.material.uniforms[name] = { value };
                }

                ScreenShaderNode._quad.material = this.material;

                const target: THREE.WebGLRenderTarget | null = toScreen
                    ? null
                    : (this.outputs.get(GraphNode.defaultIoName)![0] ?? new THREE.WebGLRenderTarget(
                        input.width,
                        input.height,
                    ));

                renderer.setRenderTarget(target);
                renderer.clear();
                renderer.render(ScreenShaderNode._scene, ScreenShaderNode._camera);

                this._out.outputs.set(ScreenShaderNode.defaultIoName, [target, BuiltinType.RenderTarget]);
            });

        this._fragmentShaderParts = fragmentShaderParts;
        const frag = ScreenShaderNode.buildFragmentShader(this._fragmentShaderParts);
        this.material = ScreenShaderNode.buildMaterial(frag);
    }

    public get fragmentShaderParts(): FragmentShaderParts {
        return this._fragmentShaderParts;
    }

    // TODO: group this and similar operations in their own class
    public static buildFragmentShader({ includes, defines, uniforms, auxCode, main }: FragmentShaderParts): string {
        const uniformDeclarations = Object.entries(uniforms ?? {})
            .map(([name, uniform]): string => {
                let ty: Type;

                if (typeof uniform == 'string') {
                    ty = uniform;
                } else if (uniform instanceof GraphNode) {
                    ty = uniform.outputs.get(GraphNode.defaultIoName)![1];
                } else {
                    ty = uniform.node.outputs.get(uniform.output)![1];
                }

                return `uniform ${Mappings.toOpenGL(ty)} ${name};`;
            });

        return [
            // highp by default for simplicity, will change if complaints arise
            'precision highp float;\n',
            // Pre-processor statements
            ...includes?.map(inc => `#include <${inc}>`) ?? [],
            ...Object.entries(defines ?? {}).map(([name, value]) => `#define ${name} ${value}`),
            // UVs
            'varying vec2 vUv;',
            // Uniforms
            'uniform sampler2D tDiffuse;',
            'uniform sampler2D tDepth;',
            'uniform vec2 resolution;',
            'uniform float cameraNear;',
            'uniform float cameraFar;',
            ...(uniformDeclarations.length > 0 ? [uniformDeclarations.join('\n')] : []),
            ...(auxCode != undefined ? [auxCode] : []),
            'vec4 shader(in vec4 tex) {',
            `    ${main.split('\n').join('\n\t')}`,
            '}',
            'void main() {',
            '    gl_FragColor = shader(texture2D(tDiffuse, vUv));',
            '}',
        ].join('\n');
    }

    public static buildMaterial(fragmentShader: string): THREE.ShaderMaterial {
        return new THREE.ShaderMaterial({
            fragmentShader,
            vertexShader: ScreenShaderNode.vertexShader,
        });
    }

    public override get nodeType(): string {
        return ScreenShaderNode.name;
    }

    public override get dumpDotStyle(): DumpDotNodeStyle {
        const { label, attrs } = super.dumpDotStyle;
        return {
            label,
            attrs,
        };
    }
}