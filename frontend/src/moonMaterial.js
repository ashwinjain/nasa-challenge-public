// Lunar surface material for Three.js.
//
// Base: MeshStandardMaterial with the LROC WAC colour mosaic and a tangent-space
// normal map built from LOLA (true vertical scale).
//
// Photometry patch: real regolith does not darken toward the limb the way a plain
// Lambert sphere does. We blend Lambert with Lommel–Seeliger (a lunar-Lambert
// approximation, McEwen 1991) so the disc stays evenly lit — the single biggest
// factor in "looks like the Moon" vs "looks like a grey ball".
//
// South polar cap (optional): the equirectangular wrap converges every texture
// column onto the pole, so the one place this app cares about gets ~1.33 km per
// texel of colour, ~2.67 km of relief, and a radial pinch at 90° S. The cap
// swaps in polar stereographic albedo and normals (scripts/precompute_polar_cap.py)
// below ~73° S and marches the LOLA heights toward the Sun for real cast
// shadows, so permanently shadowed floors stay black and peaks catch the light
// as the clock runs. Draping the raw mosaic instead would look just as sharp and
// freeze every shadow where the Sun stood when it was taken.

import * as THREE from "three";

// The cap's own frame. The moon mesh carries no rotation, so object and world
// axes coincide and the south pole sits at -Y; latLonToScene puts selenographic
// lon 0 at +X and +90° E at -Z, which is what fixes the map axes below.
const CAP_AXIS = new THREE.Vector3(0, -1, 0);
// Latitudes (as axis dot products) between which the cap crossfades in. Kept
// well inside the baked edge at 72° S so the square never shows a corner.
const CAP_FULL_LAT = -76.0;
const CAP_NONE_LAT = -73.0;
const CAP_STEPS = 32;          // shadow march samples
const CAP_REACH_M = 120000.0;  // a 2 km rim at a 1.5° Sun throws ~76 km

export function createMoonMaterial({ map, normalMap, cap = false }) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 1,
    metalness: 0,
  });

  const u = {
    uCapAlbedo: { value: null },
    uCapNormal: { value: null },
    uCapHeight: { value: null },
    uCapReady: { value: 0 },
    uCapAxis: { value: CAP_AXIS.clone() },
    uCapSunDir: { value: new THREE.Vector3(1, 0, 0) },
    uCapHalfM: { value: 1.0 },
    uCapHeightLo: { value: 0 },
    uCapHeightSpan: { value: 1 },
    uCapMoonR: { value: 1737400 },
    uCapFull: { value: Math.sin(THREE.MathUtils.degToRad(CAP_FULL_LAT)) },
    uCapNone: { value: Math.sin(THREE.MathUtils.degToRad(CAP_NONE_LAT)) },
    uCapBase: { value: 0.52 },
    // Fraction of direct Sun that shadowed ground still receives: light
    // scattered off nearby sunlit slopes, plus faint Earthshine. Polar crater
    // floors are imaged precisely because they are not absolutely black, so
    // rendering them crushed to zero is the inaccurate choice. Same value the
    // surface view uses, so the two views agree about how dark a PSR is.
    uCapFill: { value: 0.07 },
    // Permanently shadowed regions (scripts/precompute_psr_mask.py): coverage
    // mask on the albedo grid, tinted icy blue. Display only — water ice is
    // info-only and never enters a calculation. 0 until the mask has loaded.
    uCapPsr: { value: null },
    uCapPsrOn: { value: 0 },
  };

  mat.onBeforeCompile = (shader) => {
    applyLunarPhotometry(shader, 0.55);
    decodeSrgbMap(shader);
    if (cap) applyPolarCap(shader, u);
  };
  mat.customProgramCacheKey = () => (cap ? "moon-photometry-v2-cap1" : "moon-photometry-v2");

  // Hand the cap its textures once they have downloaded; before that uCapReady
  // stays 0 and the shader keeps the equirectangular wrap.
  mat.setPolarCap = ({ albedo, normal, height, meta }) => {
    u.uCapAlbedo.value = albedo;
    u.uCapNormal.value = normal;
    u.uCapHeight.value = height;
    u.uCapHalfM.value = meta.half_m;
    u.uCapHeightLo.value = meta.height_min_m;
    u.uCapHeightSpan.value = Math.max(meta.height_max_m - meta.height_min_m, 1);
    u.uCapMoonR.value = meta.moon_radius_m;
    u.uCapReady.value = 1;
  };
  // PSR overlay: the mask arrives separately so a failed load leaves the cap as is.
  let psrVisible = true;
  mat.setPsrMask = (tex) => {
    u.uCapPsr.value = tex;
    u.uCapPsrOn.value = tex && psrVisible ? 1 : 0;
  };
  mat.setPsrVisible = (on) => {
    psrVisible = !!on;
    u.uCapPsrOn.value = u.uCapPsr.value && psrVisible ? 1 : 0;
  };
  // World-space direction to the Sun, for the cast-shadow march.
  mat.setCapSunDir = (dir) => u.uCapSunDir.value.copy(dir).normalize();
  return mat;
}

// The color map is sRGB but uploaded as plain RGBA (pass it with
// colorSpace NoColorSpace) and decoded here instead, the way three handles
// video textures. Browsers upload an image into an sRGB texture format on a
// slow path: ~300 ms for the 8k map on an M1 against ~50 ms as plain RGBA,
// a stall that would land the moment you zoom in.
function decodeSrgbMap(shader) {
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    `#ifdef USE_MAP
       diffuseColor *= sRGBTransferEOTF( texture2D( map, vMapUv ) );
     #endif`
  );
}

// ── South polar cap ──
//
// Projection, matching lunarsky.terrain._project exactly so the cap lands on
// the same ground as every other product: for a unit direction n with the
// pole at -Y, k = 2R / (1 - n.y), then map x = -k·n.z and map y = k·n.x. The
// baked square spans ±half_m, so uv = map / (2·half_m) + 0.5.
//
// Normals arrive in the map's own frame (x along +mapX, y along +mapY, z up).
// Rotating them into world space needs the local frame: "north" here means
// away from the pole, which is also the map's radial direction, and east is
// the map's tangential one — so the map normal's radial and tangential parts
// go onto those two axes and its z onto the surface normal.
function applyPolarCap(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);

  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vCapWorld;")
    .replace(
      "#include <worldpos_vertex>",
      "#include <worldpos_vertex>\nvCapWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;"
    );

  const head = /* glsl */ `
varying vec3 vCapWorld;
uniform sampler2D uCapAlbedo;
uniform sampler2D uCapNormal;
uniform sampler2D uCapHeight;
uniform float uCapReady;
uniform vec3  uCapAxis;
uniform vec3  uCapSunDir;
uniform float uCapHalfM;
uniform float uCapHeightLo;
uniform float uCapHeightSpan;
uniform float uCapMoonR;
uniform float uCapFull;
uniform float uCapNone;
uniform float uCapBase;
uniform float uCapFill;
uniform sampler2D uCapPsr;
uniform float uCapPsrOn;

vec2 capMap( vec3 n ) {
  float k = 2.0 * uCapMoonR / max( 1.0 - n.y, 1e-6 );
  return vec2( -k * n.z, k * n.x );
}
vec2 capUv( vec2 m ) { return m / ( 2.0 * uCapHalfM ) + 0.5; }

float capHeight( vec2 m ) {
  vec2 uv = capUv( m );
  if ( any( lessThan( uv, vec2( 0.0 ) ) ) || any( greaterThan( uv, vec2( 1.0 ) ) ) ) return -1e5;
  vec3 t = texture2D( uCapHeight, uv ).rgb;
  float q = ( t.r * 255.0 * 256.0 + t.g * 255.0 ) / 65535.0;
  return uCapHeightLo + q * uCapHeightSpan;
}

// Fraction of the Sun's disc clearing the skyline, marching across the baked
// heights. The ray leaves the tangent plane as the Moon curves away under it,
// hence the d²/2R term; 0.25° is the Sun's half-angle for the penumbra.
float capSunFraction( vec2 m0, vec2 dir2, float h0, float sinEl ) {
  float el = asin( clamp( sinEl, -1.0, 1.0 ) );
  float worst = 1.0;
  for ( int i = 1; i <= CAP_MARCH_STEPS; i ++ ) {
    float f = float( i ) / float( CAP_MARCH_STEPS );
    float d = CAP_MARCH_REACH * f * f;             // dense near the point
    float got = capHeight( m0 + dir2 * d );
    if ( got < -9e4 ) break;
    float blockEl = atan( ( got - h0 - d * d / ( 2.0 * uCapMoonR ) ) / max( d, 1.0 ) );
    worst = min( worst, smoothstep( -0.0044, 0.0044, el - blockEl ) );
    if ( worst <= 0.0 ) break;
  }
  return worst;
}
`;

  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>\n#define CAP_MARCH_STEPS ${CAP_STEPS}\n#define CAP_MARCH_REACH ${CAP_REACH_M.toFixed(1)}\n${head}`)
    // Albedo: swap the smeared equirectangular colour for the cap's reflectance.
    .replace(
      "#include <color_fragment>",
      /* glsl */ `#include <color_fragment>
      vec3  capN = normalize( vCapWorld );
      float capMix = uCapReady * ( 1.0 - smoothstep( uCapFull, uCapNone, capN.y ) );
      vec2  capM = capMap( capN );
      float capPsr = 0.0;
      if ( capMix > 0.001 ) {
        float a = texture2D( uCapAlbedo, capUv( capM ) ).r;
        vec3 capCol = vec3( uCapBase ) * clamp( a / 0.502, 0.35, 1.9 );
        diffuseColor.rgb = mix( diffuseColor.rgb, capCol, capMix );
        if ( uCapPsrOn > 0.5 ) {
          capPsr = capMix * smoothstep( 0.05, 0.6, texture2D( uCapPsr, capUv( capM ) ).r );
          // Lit side: shift the albedo toward blue, keeping its texture.
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.7, 0.92, 1.35 ), capPsr );
        }
      }`
    )
    // Normals: rotate the map-frame normal onto the sphere's local frame.
    .replace(
      "#include <normal_fragment_maps>",
      /* glsl */ `#include <normal_fragment_maps>
      if ( capMix > 0.001 ) {
        vec3 trN = normalize( dot( uCapAxis, capN ) * capN - uCapAxis );  // toward equator
        vec3 ttN = cross( trN, capN );                                    // east
        float rl = length( capM );
        vec2 rad2 = rl > 1.0 ? capM / rl : vec2( 0.0, 1.0 );
        vec2 tan2 = vec2( rad2.y, -rad2.x );
        vec3 nm = texture2D( uCapNormal, capUv( capM ) ).xyz * 2.0 - 1.0;
        vec3 capNrm = normalize(
          ( nm.x * rad2.x + nm.y * rad2.y ) * trN +
          ( nm.x * tan2.x + nm.y * tan2.y ) * ttN +
          nm.z * capN );
        normal = normalize( mix( normal, normalize( mat3( viewMatrix ) * capNrm ), capMix ) );
      }`
    )
    // PSRs sit in shadow, where an albedo tint alone is invisible, so add a
    // faint unlit glow too. Small enough that sunlit terrain still reads.
    .replace(
      "#include <emissivemap_fragment>",
      /* glsl */ `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3( 0.028, 0.07, 0.135 ) * capPsr;`
    )
    // Cast shadows: terrain between here and the Sun, on the real heights.
    // Injected inside the light loop — scaling directLight.color after the
    // chunk has run would change nothing, the irradiance is already summed.
    .replace(
      "#include <lights_fragment_begin>",
      /* glsl */ `
      float capShade = 1.0;
      if ( capMix > 0.001 ) {
        float sinEl = dot( uCapSunDir, capN );
        vec3 trS = normalize( dot( uCapAxis, capN ) * capN - uCapAxis );
        vec3 ttS = cross( trS, capN );
        vec3 sh = uCapSunDir - sinEl * capN;
        float shl = length( sh );
        float rl2 = length( capM );
        vec2 rad2s = rl2 > 1.0 ? capM / rl2 : vec2( 0.0, 1.0 );
        vec2 tan2s = vec2( rad2s.y, -rad2s.x );
        vec2 dir2 = shl > 1e-5
          ? normalize( dot( sh / shl, trS ) * rad2s + dot( sh / shl, ttS ) * tan2s )
          : vec2( 0.0, 1.0 );
        // The fill is scattered light off sunlit ground, so it has to vanish
        // once the Sun is below the local horizon and there is nothing lit to
        // scatter from. Ungated it behaves like a second Sun that shines
        // through mountains and from under the horizon. Per-pixel here, where
        // the surface view can only gate on its one site.
        float fillScale = clamp( ( sinEl + 0.005 ) / 0.03, 0.0, 1.0 );
        float capLit = max( capSunFraction( capM, dir2, capHeight( capM ), sinEl ),
                            uCapFill * fillScale );
        capShade = mix( 1.0, capLit, capMix );
      }
      ` + THREE.ShaderChunk.lights_fragment_begin.replace(
        "getDirectionalLightInfo( directionalLight, directLight );",
        "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= capShade;",
      )
    );
}

// Swap the Lambert term in three's physical lighting for McEwen's (1991)
// lunar-Lambert blend: I ∝ (1 − L)·μ0 + L·2μ0/(μ0 + μ), with μ0 = cos(incidence)
// and μ = cos(emission). Regolith is rough and porous, so it stays brighter
// at low Sun than Lambert predicts; L sets how much Lommel–Seeliger.
//
// `L` is a number, or "phase" to vary it with the phase angle α (Sun–surface–
// viewer) using McEwen's polynomial fit: L ≈ 1 at α = 0 (Sun behind you,
// brightest) falling to ~0.2 at 90° and 0 by ~115° (looking toward the Sun,
// where backscattering regolith goes dark).
export function applyLunarPhotometry(shader, L) {
  const chunk = THREE.ShaderChunk.lights_physical_pars_fragment;
  const target = "vec3 irradiance = dotNL * directLight.color;";
  if (!chunk.includes(target)) return;
  const weight = L === "phase"
    ? `float phaseDeg = degrees( acos( clamp( dot( directLight.direction, geometryViewDir ), -1.0, 1.0 ) ) );
       float lunarL = clamp( 1.0 + phaseDeg * ( -0.019 + phaseDeg * ( 2.42e-4 + phaseDeg * -1.46e-6 ) ), 0.0, 1.0 );`
    : `float lunarL = ${Number(L).toFixed(3)};`;
  const patched = chunk.replace(
    target,
    `float dotNVl = saturate( dot( geometryNormal, geometryViewDir ) );
     float lommel = 2.0 * dotNL / ( dotNL + dotNVl + 1e-4 );
     ${weight}
     vec3 irradiance = mix( dotNL, lommel, lunarL ) * directLight.color;`
  );
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <lights_physical_pars_fragment>",
    patched
  );
}
