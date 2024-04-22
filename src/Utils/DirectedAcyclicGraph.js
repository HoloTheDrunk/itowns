import * as THREE from 'three';

const vertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

class DirectedAcyclicGraph {
    constructor() {
        this.out_node = null;
        this.nodes = new Map();
        this._valid = true;
    }

    get(name) {
        return this.nodes.get(name);
    }

    set(name, node, children = []) {
        // Prevent adding orphaned nodes.
        if (this.nodes.size > 0 && node.dependencies.length === 0 && children.length === 0) {
            return null;
        }

        this._valid = false;

        for (const child of children) {
            this.nodes.get(child).dependencies.push(name);
        }

        return this.nodes.set(name || Object.keys(this.nodes).length, node);
    }

    validate() {
        this._valid = false;

        const path = new Set();

        if (!this._dfs_cycle_detection(this.out_node, path)) {
            return false;
        }

        this._valid = true;
    }

    _dfs_cycle_detection(name, path) {
        path.add(name);

        if (this.nodes.get(name).dependencies.some(dependency => path.has(dependency.name))) { return false; }

        for (const dependency of this.nodes.get(name).dependencies) {
            if (!this._dfs_cycle_detection(dependency, path)) {
                return false;
            }
        }

        path.remove(name);

        return true;
    }
}

class Node {
    constructor(uniforms, fragment, dependencies = []) {
        this.uniforms = uniforms;
        this._material = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                ...uniforms,
            },
            vertexShader,
            fragmentShader: document.getElementById('fragmentshader').textContent,
        });
        this._dependencies = dependencies;
    }
}

export { DirectedAcyclicGraph, Node };
