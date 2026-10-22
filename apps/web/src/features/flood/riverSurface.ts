import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

/** One owned reflection target for the entire river batch. Procedural ripples need no texture.
 * Geometry is in local XY; the reflector is turned into the township's horizontal XZ plane.
 * This height is art direction, NEVER a modelled depth or a value for route evaluation. */
export function createRiverSurface(geometry: THREE.BufferGeometry) {
  const water = new Reflector(geometry, {
    textureWidth: 256,
    textureHeight: 256,
    multisample: 0,
    clipBias: 0.003,
    color: "#136d91",
    shader: {
      name: "IndicativeRiver",
      uniforms: {
        color: { value: new THREE.Color("#136d91") },
        tDiffuse: { value: null },
        textureMatrix: { value: new THREE.Matrix4() },
        time: { value: 0 },
        fade: { value: 1 },
      },
      vertexShader: `
        uniform mat4 textureMatrix;
        varying vec4 reflectionUv;
        varying vec3 world;
        #include <common>
        #include <logdepthbuf_pars_vertex>
        void main() {
          reflectionUv = textureMatrix * vec4(position, 1.0);
          world = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        uniform vec3 color;
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform float fade;
        varying vec4 reflectionUv;
        varying vec3 world;
        #include <logdepthbuf_pars_fragment>
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = world.xz;
          // Crossed travelling wave trains: analytic normal, deterministic on seek.
          float a = dot(p, vec2(.76, .28)) + time * 1.4;
          float b = dot(p, vec2(-.33, .91)) * 1.7 - time * 1.1;
          vec2 ripple = vec2(cos(a) * .12 - cos(b) * .07, cos(a) * .045 + cos(b) * .17);
          vec3 normal = normalize(vec3(ripple.x, 1., ripple.y));
          vec3 eye = normalize(cameraPosition - world);
          float fresnel = .18 + .68 * pow(1. - max(dot(eye, normal), 0.), 3.);
          vec2 uv = reflectionUv.xy / reflectionUv.w + ripple * .006;
          vec3 reflected = texture2D(tDiffuse, uv).rgb;
          float glint = pow(max(dot(reflect(-normalize(vec3(-.4, .8, .35)), normal), eye), 0.), 70.);
          float crests = pow(.5 + .5 * sin(a + sin(b) * .5), 9.);
          vec3 rgb = mix(color * (.82 + crests * .13), reflected, fresnel);
          rgb += vec3(.65, .84, .91) * glint * .65;
          gl_FragColor = vec4(rgb, .86 * fade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    },
  });
  const material = water.material as THREE.ShaderMaterial;
  water.rotation.x = -Math.PI / 2;
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.polygonOffset = true;
  material.polygonOffsetFactor = -8;
  material.polygonOffsetUnits = -8;
  water.name = "flood-fill";
  water.frustumCulled = false;
  return {
    mesh: water,
    update(seconds: number, rise = 0, fade = 1) {
      material.uniforms.time!.value = seconds;
      material.uniforms.fade!.value = fade;
      water.position.y = 0.3 + THREE.MathUtils.clamp(rise, 0, 1) * 1.8;
    },
    dispose() {
      geometry.dispose();
      water.dispose(); // includes reflection framebuffer and material
      water.removeFromParent();
    },
  };
}
