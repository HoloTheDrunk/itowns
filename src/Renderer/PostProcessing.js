import * as THREE from 'three';
import { DirectedAcyclicGraph, Node } from '../Utils/DirectedAcyclicGraph';

const vertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

class PostProcessedScene extends THREE.Scene {
    constructor() {
        super();

        this.dag = new DirectedAcyclicGraph();

        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

        // Setup the quad used to render the effects
        const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), null);
        quad.frustumCulled = false;
        quad.material = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse: { value: null },
                tSize: { value: new THREE.Vector2(256, 256) },
            },
            vertexShader,
            fragmentShader: document.getElementById('fragmentshader').textContent,
        });

        this.add(quad);
    }
}
