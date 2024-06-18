import { Graph, GraphNode, ScreenShaderNode, SubGraph } from '../Prelude';

export default {
    pattern: Array(2).fill(ScreenShaderNode.name),
    operation: (nodes: GraphNode[], graph: Graph) => {
        const [child, parent] = nodes as ScreenShaderNode[];

        const [cName, pName] = [graph.findNode(child), graph.findNode(parent)]
            .map(n => n?.name ?? 'null');

        const [cRenderer, pRenderer] = [child.inputs, parent.inputs]
            .map(inputs => inputs.get('renderer')![0]!);

        if (cRenderer.node != pRenderer.node || cRenderer.output != pRenderer.output) {
            throw new Error(`Different renderer for ${cName} and ${pName}`);
        }

        if (graph.findDependants(parent).length != 1) {
            throw new Error(`Parent ${pName} has multiple dependants`);
        }

        const [cParts, pParts] = [child.fragmentShaderParts, parent.fragmentShaderParts];

        const detectedOffsetSampling = /texture2D\((?!uTexture,vUv)[^)]*\)/.exec(
            ((cParts.auxCode ?? '') + cParts.main).replaceAll(/\s/gm, ''),
        );

        if (detectedOffsetSampling != null) {
            throw new Error(
                `Child ${cName} samples input with an offset`
                + `(only allowed for parent shaders when merging): ${detectedOffsetSampling[0]}`,
            );
        }

        // Fail if parent is linked to a subgraph output
        if (graph instanceof SubGraph) {
            console.log(`Checking ${pName} for subgraph outputs`);
            for (const [outputName, output] of graph.outputs.entries()) {
                if (output.input[0]?.node == parent as GraphNode ?? false) {
                    throw new Error(`Parent ${pName} is linked to subgraph output ${outputName}`);
                }
            }
        }

        const includes = new Set<string>();
        for (const include of [...cParts.includes ?? [], ...pParts.includes ?? []]) {
            includes.add(include);
        }
        cParts.includes = [...includes.values()];

        const defines = new Map<string, string | number>();
        for (const [key, value] of Object.entries(cParts.defines ?? {})) {
            const pValue = pParts.defines?.[key];
            if (pValue != undefined && pValue != value) {
                throw new Error(`Child ${cName} and parent ${pName} both define ${key}`);
            }
            defines.set(key, value);
        }
        for (const [key, value] of Object.entries(pParts.defines ?? {})) {
            if (!defines.has(key)) {
                defines.set(key, value);
            }
        }

        // Find and mangle duplicate uniform names
        const replacements: [string, string][] = [];

        pParts.uniforms ??= {};

        for (const [name, _value] of Object.entries(pParts.uniforms)) {
            if (cParts.uniforms?.[name] != undefined) {
                const val = pParts.uniforms[name];
                delete pParts.uniforms[name];
                pParts.uniforms[`parent_${name}`] = val;

                replacements.push([name, `parent_${name}`]);
            }
        }

        cParts.uniforms = { ...cParts.uniforms, ...pParts.uniforms };

        cParts.auxCode ??= '';
        pParts.auxCode ??= '';

        // Replace duplicate uniform names in parent code
        for (const [name, replacement] of replacements) {
            const match = new RegExp(`\\b${name}\\b`);
            pParts.auxCode = pParts.auxCode.replaceAll(match, replacement);
        }

        cParts.auxCode = [
            `// ${pName}`, pParts.auxCode,
            `vec4 _${parent.id}_shader(vec4 tex) {`,
            `\t${pParts.main.replace('\n', '\n\t')}`,
            '}',
            `// ${cName}`, cParts.auxCode,
            `vec4 _${child.id}_shader(vec4 tex) {`,
            `\t${cParts.main.replace('\n', '\n\t')}`,
            '}',
        ].join('\n');
        cParts.main = [
            `return _${child.id}_shader(_${parent.id}_shader(tex));`,
        ].join('\n');

        const fragmentShader = ScreenShaderNode.buildFragmentShader(cParts);
        console.log(fragmentShader);

        child.material = ScreenShaderNode.buildMaterial(fragmentShader);

        child.inputs.delete('renderer');
        child.inputs.delete('target');
        for (const [inputName, [dep, ty]] of parent.inputs.entries()) {
            child.inputs.set(inputName, [dep, ty]);
        }

        graph.nodes.delete(pName);
        graph.nodes.delete(cName);

        graph.nodes.set(`_${parent.id}_${pName}_${child.id}_${cName}`, child);

        return child;
    },
};

