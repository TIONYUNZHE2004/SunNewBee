import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";

/** One owned reflection target for the entire river batch. Procedural ripples need no texture.
 * Geometry is in local XY; the reflector is turned into the township's horizontal XZ plane.
 * This height is art direction, NEVER a modelled depth or a value for route evaluation. */
export function createRiverSurface(geometry: THREE.BufferGeometry) {
  const water = new Reflector(geometry, {
    textureWidth: 512,
    textureHeight: 512,
    multisample: 0,
    clipBias: 0.003,
    color: "#0b5663",
    shader: {
      name: "IndicativeRiver",
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.lights,
        {
          color: { value: new THREE.Color("#0b5663") },
          tDiffuse: { value: null },
          textureMatrix: { value: new THREE.Matrix4() },
          time: { value: 0 },
          fade: { value: 1 },
        },
      ]),
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
        #include <common>
        #include <lights_pars_begin>
        #include <logdepthbuf_pars_fragment>

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(41.37, 289.13))) * 13427.91);
        }
        vec3 noiseGradient(vec2 p) {
          vec2 cell = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3. - 2. * f);
          vec2 du = 6. * f * (1. - f);
          float a = hash(cell), b = hash(cell + vec2(1., 0.));
          float c = hash(cell + vec2(0., 1.)), d = hash(cell + vec2(1.));
          return vec3(mix(mix(a, b, u.x), mix(c, d, u.x), u.y),
                      du.x * mix(b - a, d - c, u.y), du.y * mix(c - a, d - b, u.x));
        }
        vec2 wave(vec2 p, vec2 dir, float frequency, float slope, float speed,
                  float phase, float pixelSpan) {
          dir = normalize(dir);
          // Fade sub-pixel waves instead of producing moire at the township overview.
          float visible = 1. - smoothstep(.8, 2.8, frequency * pixelSpan);
          return dir * cos(dot(p, dir) * frequency - time * speed + phase) * slope * visible;
        }
        float visibility(float n, float k) {
          return n / (n * (1. - k) + k);
        }
        void main() {
          #include <logdepthbuf_fragment>
          vec2 p = world.xz;
          float pixelSpan = max(length(dFdx(p)), length(dFdy(p)));
          // Slow domain variation breaks the parallel bands. All motion uses the story clock.
          vec2 drift = vec2(time * .045, -time * .028);
          vec2 q = p + 1.7 * vec2(noiseGradient(p * .13 + drift).x,
                                 noiseGradient(p * .11 - drift + 57.).x);
          vec2 slope = wave(q, vec2(.94, .34), 1.1, .075, .63, .4, pixelSpan);
          slope += wave(q, vec2(.57, -.82), 1.9, .085, .87, 2.1, pixelSpan);
          slope += wave(q, vec2(.79, .61), 2.75, .10, 1.13, 4.8, pixelSpan);
          slope += wave(q, vec2(-.38, .93), 4.8, .095, 1.41, 1.7, pixelSpan);
          slope += wave(q, vec2(.98, -.21), 6.8, .075, 1.77, 5.2, pixelSpan);
          slope += wave(q, vec2(.24, .97), 9.5, .065, 2.09, 3.4, pixelSpan);
          slope += wave(q, vec2(-.69, .72), 14.2, .045, 2.43, .8, pixelSpan);
          slope += wave(q, vec2(.87, .49), 22.4, .03, 2.91, 4.3, pixelSpan);
          // Non-periodic capillary slopes keep the surface from reading as a wave grid.
          mat2 turn = mat2(.8, -.6, .6, .8);
          slope *= .7;
          slope += noiseGradient(q * .83 + time * vec2(.12, -.08)).yz * .34
                   * (1. - smoothstep(.8, 2.8, .83 * pixelSpan));
          slope += turn * noiseGradient(turn * q * 1.93 + time * vec2(-.15, .09)).yz * .20
                   * (1. - smoothstep(.8, 2.8, 1.93 * pixelSpan));
          slope += noiseGradient(q * 4.17 + time * vec2(.07, .18)).yz * .12
                   * (1. - smoothstep(.8, 2.8, 4.17 * pixelSpan));
          vec3 normal = normalize(vec3(-slope.x, 1., -slope.y));
          vec3 eye = normalize(cameraPosition - world);
          float nV = max(dot(normal, eye), .001);
          float fresnel = .035 + .965 * pow(1. - nV, 5.);
          float distanceToEye = length(cameraPosition - world);
          vec2 distortion = normal.xz * (.002 + .7 / max(distanceToEye, 1.));
          vec2 uv = clamp(reflectionUv.xy / reflectionUv.w + distortion, .002, .998);
          vec3 reflected = texture2D(tDiffuse, uv).rgb;
          vec3 illumination = vec3(.16);
          #if NUM_HEMI_LIGHTS > 0
            illumination += hemisphereLights[0].skyColor * .32;
          #endif
          vec3 sparkle = vec3(0.);
          #if NUM_DIR_LIGHTS > 0
            // Three supplies the existing sun/moon colour, intensity and view-space direction.
            vec3 light = inverseTransformDirection(directionalLights[0].direction, viewMatrix);
            vec3 halfway = normalize(light + eye);
            float nL = max(dot(normal, light), 0.);
            float nH = max(dot(normal, halfway), 0.);
            float vH = max(dot(eye, halfway), 0.);
            float roughness = mix(.13, .27, smoothstep(.1, 1.5, pixelSpan));
            float alpha2 = pow(roughness, 4.);
            float denominator = nH * nH * (alpha2 - 1.) + 1.;
            float distribution = alpha2 / (PI * denominator * denominator);
            float k = pow(roughness + 1., 2.) / 8.;
            float masking = visibility(nV, k) * visibility(nL, k);
            float specularFresnel = .02 + .98 * pow(1. - vH, 5.);
            float specular = distribution * masking * specularFresnel / max(4. * nV * nL, .001);
            sparkle = directionalLights[0].color * min(specular * nL, 3.);
            illumination += directionalLights[0].color * nL * .2;
          #endif
          vec3 body = color * illumination;
          vec3 rgb = mix(body, reflected, .16 + .84 * fresnel) + sparkle;
          gl_FragColor = vec4(rgb, .96 * fade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    },
  });
  const material = water.material as THREE.ShaderMaterial;
  material.lights = true;
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
