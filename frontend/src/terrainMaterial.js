// Terrain material for the surface view: sunlight decided by the skyline.
//
// Instead of a shadow map, every pixel of ground does what compute_skyline
// (lunarsky/terrain.py) does for a site: it walks across the terrain toward
// the Sun's azimuth, finds the highest elevation angle the terrain reaches in
// that direction, and compares it with the Sun's elevation. The result is the
// fraction of the Sun's disk above that pixel's own skyline, from 0 to 1, so
// shadow edges get the Sun's real ~0.5° penumbra.
//
// Same heights (the baked polar grid), same elevation formula, same disk
// rule as the sunlight numbers, so a spot the app calls sunlit is drawn lit,
// out to 300 km, with no shadow-map resolution or range limits.
//
// The heights live in a float texture laid out like the .bin file: one row
// per ring, one column per azimuth (0 = north, going east). Ring radii are
// 20 m steps, then each ring a fixed factor farther out, so a distance maps
// back to a row index in closed form.
//
// Brightness uses the same lunar photometry as the globe (Lambert blended
// with Lommel–Seeliger): regolith under a 5° Sun is several times brighter
// than plain Lambert says. With ?sundebug in the URL the ground is tinted
// instead: green where the Sun's disk is fully up, red where it's hidden.

import * as THREE from "three";
import { applyLunarPhotometry } from "./moonMaterial.js";

const R_M = 1737400;
const SUN_RADIUS = THREE.MathUtils.degToRad(0.2666);   // apparent solar radius
// Lommel–Seeliger share of the lunar-Lambert blend varies with phase angle
// (see applyLunarPhotometry): bright with the Sun behind you, dark toward it.
const LUNAR_L = 0.8;   // fixed Lommel-Seeliger weight: regolith stays bright at
// grazing light even looking up-Sun. The phase-dependent fit crushed the whole
// up-Sun hemisphere to black at a low polar Sun, hiding all relief.
// Exposure for the ground only. Photos taken on the Moon expose for sunlit
// regolith; a raw render of grey rock under a 5° Sun comes out near-black.
// An ACES curve rolls off sun-facing slopes so they don't clip. Applied in
// this shader alone, so the Sun, Earth, stars and markers look as before.
// Real lunar regolith is dark (albedo ~7-12%, like worn asphalt) and neutral
// grey, so this is kept moderate — enough to read on screen without the bright
// sandy-desert look that an over-boosted warm render gives.
const EXPOSURE = 2.5;

// Tiled regolith detail layer (luminance + normal only; hue discarded so the
// colour stays our neutral Moon-grey). PLAN B: real NASA Apollo 11 regolith
// (AS11-40-5878, public domain) — cropped from the undisturbed soil, reseau
// crosses and shadows inpainted, lighting flattened. MirroredRepeat tiles it
// seamlessly; mipmaps + anisotropy kill shimmer. (Plan A was ambientCG
// Ground079S, CC0 — swap the filenames back to regolith_color/normal.jpg.)
let _regolith = null;
function loadRegolith(renderer) {
  if (_regolith) return _regolith;
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const setup = (url) => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;   // seamless without a processed seam
    t.colorSpace = THREE.NoColorSpace;          // raw samples; we take luminance / decode the normal ourselves
    t.anisotropy = maxAniso;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };
  _regolith = { color: setup("/textures/regolith_moon_color.jpg"), normal: setup("/textures/regolith_moon_normal.jpg") };
  return _regolith;
}

export function createTerrainMaterial({ heights, nAz, radii, siteUp, siteNorth, siteEast, siteR, hMax, renderer, wacUrl = null, debug = false }) {
  const nR = radii.length;
  const rego = loadRegolith(renderer);
  // Per-site WAC imagery tile (log-polar: x = azimuth, y = log radius; see
  // scripts/precompute_wac_tiles.py). Sampled per pixel so the mosaic's full
  // 100 m crater detail survives at every distance — the per-vertex aAlbedo
  // stays as an instant fallback until this ~600 KB JPEG arrives.
  const wacTex = new THREE.Texture();
  let wacReadyFlag = { value: 0 };
  if (wacUrl) {
    new THREE.TextureLoader().load(wacUrl, (t) => {
      t.wrapS = THREE.RepeatWrapping;            // azimuth wraps
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.colorSpace = THREE.NoColorSpace;
      // 4x, not the GPU's max (often 16x): looks nearly the same on the
      // ground, and much cheaper per pixel on laptop GPUs.
      t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      uniforms.uWacTex.value = t;
      wacReadyFlag.value = 1;
    });
  }
  // Row 0 of the texture is ring 0; the site point itself isn't needed (no
  // pixel looks back at it from closer than one ring).
  const tex = new THREE.DataTexture(heights.subarray(1), nAz, nR, THREE.RedFormat, THREE.FloatType);
  tex.wrapS = THREE.RepeatWrapping;                     // azimuth wraps around
  tex.wrapT = THREE.ClampToEdgeWrapping;
  const linear = renderer.extensions.has("OES_texture_float_linear");
  tex.magFilter = tex.minFilter = linear ? THREE.LinearFilter : THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  // Where the fixed 20 m steps end and the geometric ones begin.
  const fine = radii[1] - radii[0];
  let i1 = 0;
  while (i1 < nR - 2 && radii[i1 + 1] - radii[i1] < fine + 0.01) i1++;
  const logG = Math.log(radii[i1 + 1] / radii[i1]);

  const uniforms = {
    uTerrainH: { value: tex },
    uSiteUp: { value: siteUp.clone() },
    uSiteNorth: { value: siteNorth.clone() },
    uSiteEast: { value: siteEast.clone() },
    uSiteR: { value: siteR },                           // m from the Moon's center to the site point
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uHMax: { value: hMax },
    uNAz: { value: nAz },
    uNR: { value: nR },
    uFine: { value: fine },
    uI1: { value: i1 },
    uR1: { value: radii[i1] },
    uLogG: { value: logG },
    uArc: { value: (Math.PI * 2) / nAz },
    uRMax: { value: radii[nR - 1] },
    uSunDebug: { value: debug ? 1 : 0 },
    // Fraction of direct sun that shadowed ground still receives: faint
    // Earthshine + light scattered off nearby sunlit slopes. Keeps deep polar
    // shadow a dim regolith grey instead of crushed black, without softening
    // the hard terminator the skyline draws. (The scene's AmbientLight adds a
    // little omnidirectional fill on top.)
    uEarthFill: { value: 0.07 },
    // Scales the fill with the Sun's elevation at the site (set by setSunDir):
    // scattered light from surrounding sunlit peaks only exists while the Sun
    // is actually up. Without this the fill acts like a mini-Sun that lights
    // slopes through mountains and even from below the horizon.
    uFillScale: { value: 1.0 },
    // Tiled regolith detail: photo albedo (luminance only) + normal map.
    uAlbedoTex: { value: rego.color },
    uNormalTex: { value: rego.normal },
    uTile: { value: 2.0 },              // metres covered by one texture tile
    uNormalStrength: { value: 0.8 },    // 0 = flat, 1 = full photo relief (micro)
    uReliefExag: { value: 3.0 },        // crater-relief exaggeration for grazing-Sun drama
    uWacTex: { value: wacTex },
    uWacReady: wacReadyFlag,
    uWacR0: { value: 20.0 },            // first radius row of the tile (m)
    uWacLogR: { value: Math.log((300.0 * 1000.0) / 20.0) },
  };

  // Near-neutral grey with only a whisper of warmth — real regolith is grey,
  // not the sandy tan 0x8a8278 read as. (Highlands carry a faint warm tint.)
  const mat = new THREE.MeshStandardMaterial({ color: 0x8c8b87, roughness: 1, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    applyLunarPhotometry(shader, LUNAR_L);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
        attribute float aHeight;
        attribute float aAlbedo;
        varying float vHeight;
        varying float vAlbedo;
        varying vec3 vLocal;
        varying vec3 vWorldNormal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vHeight = aHeight;
        vAlbedo = aAlbedo;
        vLocal = position;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);`);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        ${FRAGMENT_FUNCS}`)
      // Two layers of brightness: MACRO is the real, geographically-registered
      // LROC WAC summer-mosaic value at this vertex (vAlbedo, ~1.0 = site mean)
      // — real craters/ridges in the real places. MICRO is the tiled regolith
      // photo's fine grain (luminance only, two scales to break tiling). The
      // hue stays our neutral grey; only brightness is modulated.
      .replace("#include <color_fragment>", `#include <color_fragment>
        {
          vec2 g = vec2(dot(vLocal * 1.0e6, uSiteEast), dot(vLocal * 1.0e6, uSiteNorth));
          vec3 t1 = texture(uAlbedoTex, g / uTile).rgb;
          vec3 t2 = texture(uAlbedoTex, g / (uTile * 3.1) + 0.37).rgb;
          float lum = dot(mix(t1, t2, 0.5), vec3(0.299, 0.587, 0.114));
          float micro = clamp(0.82 + (lum - 0.45) * 0.9, 0.6, 1.2);
          // MACRO: per-pixel registered WAC imagery (log-polar tile), so the
          // mosaic's full crater detail drapes the ground at every distance;
          // until the tile loads, the per-vertex sample carries the low
          // frequencies. Tile mean is 128 -> factor ~1 at the site average.
          float macro = clamp(vAlbedo, 0.35, 1.9);
          if (uWacReady > 0.5) {
            vec3 lmc = vLocal * 1.0e6;
            float uc2 = dot(lmc, uSiteUp);
            float rho2 = length(g);
            float rf2 = MOON_R * atan(rho2, uSiteR + uc2);
            float azc = atan(g.x, g.y);                       // 0 = north, +E
            vec2 wuv = vec2(azc / 6.2831853 + 1.0,            // wraps in x
                            clamp(log(max(rf2, uWacR0) / uWacR0) / uWacLogR, 0.0, 1.0));
            float wac = texture(uWacTex, wuv).r;
            // Blend the imagery in from ~500 m in the SHADER, not only in the
            // baked tile: near the nadir the GPU reads deep mip levels where
            // far-field crater rows average into the neutral top rows, smearing
            // radial streaks underfoot through trilinear filtering.
            float wacFade = smoothstep(25.0, 60.0, rf2);
            macro = mix(1.0, clamp(wac / 0.502, 0.25, 2.1), wacFade);
          }
          diffuseColor.rgb *= macro * micro;
        }`)
      // Surface normal in two parts, both per-pixel:
      //   RELIEF — finite-difference the real DEM heights (already in uTerrainH)
      //     at the local cell size, so sub-mesh craters get lit/shadowed sides
      //     that the smooth Gouraud mesh normal throws away. This is what turns
      //     flat dunes into a cratered surface under a grazing Sun.
      //   MICRO — the tiled regolith photo normal on top, faded with distance.
      // Pure shading — geometry, horizon and skyline physics are untouched.
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>
        {
          vec3 lm = vLocal * 1.0e6;                         // metres from the site
          float ec = dot(lm, uSiteEast), nc = dot(lm, uSiteNorth), uc = dot(lm, uSiteUp);
          float rho = length(vec2(ec, nc));
          float rf = MOON_R * atan(rho, uSiteR + uc);       // ground distance from the site
          vec2 gc = rho > 1e-3 ? vec2(ec, nc) * (rf / rho) : vec2(0.0);
          float eps = max(uFine, rf * uArc);                // local height-field cell size
          // Crater relief = the HIGH-FREQUENCY part of the real slope (fine
          // gradient minus coarse gradient), exaggerated, on top of the mesh
          // normal. The regional hillside slope is left alone — exaggerating it
          // tilts whole slopes away from a grazing Sun and blacks them out —
          // only the sub-mesh crater detail gets amplified so rims catch light.
          float ce = 4.0 * eps;
          float fe = (terrainHeightAt(gc + vec2(eps, 0.0)) - terrainHeightAt(gc - vec2(eps, 0.0))) / (2.0 * eps);
          float fn = (terrainHeightAt(gc + vec2(0.0, eps)) - terrainHeightAt(gc - vec2(0.0, eps))) / (2.0 * eps);
          float ge = (terrainHeightAt(gc + vec2(ce, 0.0)) - terrainHeightAt(gc - vec2(ce, 0.0))) / (2.0 * ce);
          float gn = (terrainHeightAt(gc + vec2(0.0, ce)) - terrainHeightAt(gc - vec2(0.0, ce))) / (2.0 * ce);
          // Base the shading normal on the DEM at a data-respecting scale (the
          // coarse 4*eps gradient), NOT on the mesh's Gouraud normal: within
          // ~2 km the mesh spokes sit closer together than the 20 m data, so
          // interpolated vertex normals carry spoke-to-spoke noise that paints
          // radial bands around the nadir when looking down. The exaggerated
          // high-frequency relief also fades out underfoot (below data
          // resolution there - the grain normal owns that scale).
          vec3 upF2 = normalize(uSiteUp * uSiteR + lm);
          float reliefFade = smoothstep(40.0, 140.0, rf);
          vec3 N = normalize(upF2 - ge * uSiteEast - gn * uSiteNorth
                 - (uReliefExag * reliefFade) * ((fe - ge) * uSiteEast + (fn - gn) * uSiteNorth));

          float distM = length(vViewPosition) * 1.0e6;
          float fade = 1.0 - smoothstep(22.0, 150.0, distM);
          vec3 T = normalize(uSiteEast - N * dot(N, uSiteEast));
          vec3 B = cross(N, T);
          vec2 g = vec2(ec, nc);
          vec3 nt = (texture(uNormalTex, g / uTile).xyz * 2.0 - 1.0)
                  + (texture(uNormalTex, g / (uTile * 3.1) + 0.37).xyz * 2.0 - 1.0);
          nt.xy *= uNormalStrength;
          vec3 nW = normalize(nt.x * T + nt.y * B + nt.z * N);
          normal = normalize(mat3(viewMatrix) * normalize(mix(N, nW, fade)));
        }`)
      .replace("#include <lights_fragment_begin>",
        "float terrainSun = terrainSunFraction();\n" +
        THREE.ShaderChunk.lights_fragment_begin.replace(
          "getDirectionalLightInfo( directionalLight, directLight );",
          "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= max(terrainSun, uEarthFill * uFillScale);",
        ))
      // Regolith has no glossy sheen. three's Fresnel specular turns grazing
      // views toward the Sun mirror-bright, so drop it.
      .replace("#include <aomap_fragment>", `#include <aomap_fragment>
        reflectedLight.directSpecular = vec3(0.0);
        reflectedLight.indirectSpecular = vec3(0.0);`)
      .replace("#include <opaque_fragment>", `#include <opaque_fragment>
        gl_FragColor.rgb = terrainTone(gl_FragColor.rgb * ${EXPOSURE.toFixed(2)});`)
      .replace("#include <dithering_fragment>", `#include <dithering_fragment>
        if (uSunDebug > 0.5) {
          float shade = 0.45 + 0.55 * saturate(normal.z);   // view-space: faces toward you = brighter
          gl_FragColor.rgb = mix(vec3(0.85, 0.12, 0.1), vec3(0.15, 0.85, 0.25), terrainSun) * shade;
        }`);
  };
  mat.customProgramCacheKey = () => "terrain-skyline-sun-v23";

  return {
    material: mat,
    setSunDir(v) {
      uniforms.uSunDir.value.copy(v).normalize();
      // Sun elevation at the site: fade the shadow fill out as the Sun sets
      // (fill = light scattered off sunlit peaks; none when nothing is sunlit).
      const sinEl = uniforms.uSunDir.value.dot(siteUp);
      uniforms.uFillScale.value = Math.min(1, Math.max(0, (sinEl + 0.005) / 0.03));
    },
    dispose() { tex.dispose(); if (uniforms.uWacTex.value) uniforms.uWacTex.value.dispose(); mat.dispose(); },
  };
}

const FRAGMENT_FUNCS = /* glsl */ `
  uniform sampler2D uTerrainH, uAlbedoTex, uNormalTex, uWacTex;
  uniform vec3 uSiteUp, uSiteNorth, uSiteEast, uSunDir;
  uniform float uSiteR, uHMax, uNAz, uNR, uFine, uI1, uR1, uLogG, uArc, uRMax, uSunDebug, uEarthFill, uFillScale, uTile, uNormalStrength, uReliefExag, uWacReady, uWacR0, uWacLogR;
  varying float vHeight;
  varying float vAlbedo;
  varying vec3 vLocal;
  varying vec3 vWorldNormal;

  const float MOON_R = ${R_M.toFixed(1)};
  const float SUN_R = ${SUN_RADIUS.toFixed(7)};

  // ACES filmic fit (Narkowicz 2015), linear in → linear out.
  vec3 terrainTone(vec3 x) {
    return saturate((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14));
  }

  // Value noise for the large-scale albedo mottle (variety beyond the photo
  // tile; the fine grain now comes from the regolith texture itself).
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Height (m) at a point given in site-centered azimuthal-equidistant
  // coordinates (east, north), metres: distance from the site along the
  // ground, in that compass direction.
  float terrainHeightAt(vec2 q) {
    float r = length(q);
    float az = atan(q.x, q.y);                          // 0 = north, +90° = east
    float idx = r <= uR1 ? r / uFine - 1.0 : uI1 + log(r / uR1) / uLogG;
    vec2 uv = vec2(az / 6.28318531 + 0.5 / uNAz, (max(idx, 0.0) + 0.5) / uNR);
    return texture(uTerrainH, uv).r;
  }

  // Fraction of the Sun's disk above this pixel's skyline, 0..1.
  float terrainSunFraction() {
    vec3 lm = vLocal * 1.0e6;                           // scene units → m, relative to the site
    float e = dot(lm, uSiteEast), n = dot(lm, uSiteNorth), u = dot(lm, uSiteUp);
    float rho = length(vec2(e, n));
    float rf = MOON_R * atan(rho, uSiteR + u);          // ground distance from the site
    vec2 qf = rho > 1e-3 ? vec2(e, n) * (rf / rho) : vec2(0.0);

    // The Sun's elevation and compass direction at this pixel.
    vec3 upF = normalize(uSiteUp * uSiteR + lm);
    float sinEl = clamp(dot(uSunDir, upF), -1.0, 1.0);
    float elS = asin(sinEl);
    vec3 sh = uSunDir - upF * sinEl;
    vec2 m = vec2(dot(sh, uSiteEast), dot(sh, uSiteNorth));
    if (dot(m, m) < 1e-12) return 1.0;                  // Sun straight overhead
    vec2 dir = normalize(m);

    // Walk toward the Sun, keeping the steepest terrain slope seen (as a
    // tangent, curvature included: drop = d²/2R). Steps start at about one
    // grid cell and grow, like compute_skyline's samples.
    // March from 2 m above the ground - the same eye height every validated
    // metric uses. At 0.5 m, sub-resolution map bumps a few samples out flip
    // marginal pixels between lit and shadowed spoke-by-spoke, painting radial
    // bands around the nadir when the Sun sits just above the skyline.
    float hf = vHeight + 2.0;
    float tanLo = tan(elS - SUN_R), tanHi = tan(elS + SUN_R);
    float cell = max(uFine, rf * uArc);
    float d = 1.5 * cell, stepLen = cell;
    float best = -1.0e9;
    for (int i = 0; i < 320; i++) {
      vec2 q = qf + dir * d;
      float rq = length(q);
      if (rq > uRMax) break;
      float drop = d * d / (2.0 * MOON_R);
      best = max(best, (terrainHeightAt(q) - hf - drop) / d);
      if (best >= tanHi) return 0.0;                    // whole disk hidden
      // Nothing farther can rise above this: the highest point in the grid,
      // after curvature, would sit lower than what we have.
      if ((uHMax - hf - drop) / d < max(best, tanLo)) break;
      stepLen = max(stepLen * 1.03, 0.75 * max(uFine, rq * uArc));
      d += stepLen;
    }
    // Visible fraction of a disk whose center is x radii above the skyline.
    float x = clamp((elS - atan(best)) / SUN_R, -1.0, 1.0);
    return 1.0 - (acos(x) - x * sqrt(1.0 - x * x)) / 3.14159265;
  }
`;
