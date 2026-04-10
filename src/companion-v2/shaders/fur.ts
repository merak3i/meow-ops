/**
 * Kajiya-Kay fur/hair shading model.
 *
 * Specular highlight is computed along the tangent direction rather than the
 * surface normal, giving the characteristic elongated highlight that fur and
 * hair exhibit. Two specular lobes are used (primary + shifted secondary) for
 * a more physically-plausible result.
 *
 * Reference: Kajiya & Kay, "Rendering Fur with Three Dimensional Textures",
 * SIGGRAPH 1989.
 */

export const furVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uFurLength;
  uniform float uFurGravity;    // 0 = no gravity, 1 = full droop
  uniform float uFatigue;       // 0–1, drives droop intensity
  uniform int   uShellIndex;    // which shell layer (0 = base)
  uniform int   uShellCount;    // total shell count
  uniform vec3  uWindDir;
  uniform float uWindStrength;
  uniform float uStripeScale;    // 0 = no stripes; 3–5 = visible bands
  uniform float uPatternType;    // 0=solid, 1=stripes, 2=spots

  attribute vec3  aTangent;

  varying vec3  vWorldPos;
  varying vec3  vWorldNormal;
  varying vec3  vTangent;
  varying vec2  vUv;
  varying float vShellFraction;   // 0 at base, 1 at tip

  void main() {
    vUv           = uv;
    vShellFraction = float(uShellIndex) / float(uShellCount - 1);

    // Extrude along normal by shell layer
    float droopFactor = 1.0 - vShellFraction;       // base stays put, tip droops
    float gravityBias = uFurGravity * (1.0 + uFatigue) * droopFactor;

    vec3 extruded = position + normal * uFurLength * vShellFraction;

    // Gravity droop — pulls tip downward
    extruded.y -= gravityBias * uFurLength * vShellFraction * vShellFraction;

    // Wind — sinusoidal displacement on tips
    float wind = sin(uTime * 1.5 + extruded.x * 2.0 + extruded.z * 1.3)
               * uWindStrength * vShellFraction * vShellFraction;
    extruded += uWindDir * wind;

    vec4 worldPosition  = modelMatrix * vec4(extruded, 1.0);
    vWorldPos           = worldPosition.xyz;
    vWorldNormal        = normalize(mat3(modelMatrix) * normal);
    vTangent            = normalize(mat3(modelMatrix) * aTangent);

    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

export const furFragmentShader = /* glsl */ `
  precision highp float;

  // ── Uniforms ────────────────────────────────────────────────────────────────
  uniform sampler2D uFurMap;         // alpha mask: 1 = strand, 0 = gap
  uniform vec3  uBaseColor;
  uniform vec3  uTipColor;
  uniform vec3  uLightDir;           // world space, normalised
  uniform vec3  uLightColor;
  uniform vec3  uAmbient;
  uniform vec3  uCamPos;
  uniform float uSpecPower1;         // primary specular shininess (~80)
  uniform float uSpecPower2;         // secondary lobe shininess (~20)
  uniform float uSpecShift;          // tangent shift for secondary lobe (~0.1)
  uniform float uSpecStrength;
  uniform float uStripeScale;
  uniform float uPatternType;

  // ── Varyings ────────────────────────────────────────────────────────────────
  varying vec3  vWorldPos;
  varying vec3  vWorldNormal;
  varying vec3  vTangent;
  varying vec2  vUv;
  varying float vShellFraction;

  // ── Kajiya-Kay helper ────────────────────────────────────────────────────────
  // Specular term from hair tangent T, half-vector H.
  // sinTH = sqrt(1 - dot(T,H)^2) — the key KK identity.
  float kkSpec(vec3 T, vec3 H, float power) {
    float TdotH = dot(T, H);
    float sinTH = sqrt(max(0.0, 1.0 - TdotH * TdotH));
    return pow(max(0.0, sinTH), power);
  }

  // Shift tangent along normal (two-lobe separation trick)
  vec3 shiftTangent(vec3 T, vec3 N, float shift) {
    return normalize(T + shift * N);
  }

  void main() {
    // ── Fur mask ────────────────────────────────────────────────────────────
    float mask = texture2D(uFurMap, vUv).r;
    // Progressively thin strands toward the tip
    float density = 1.0 - vShellFraction;
    if (mask < density * 0.7) discard;

    // ── Base diffuse (Kajiya-Kay diffuse = sqrt(1 - dot(T, L)^2)) ──────────
    vec3  T      = normalize(vTangent);
    vec3  L      = normalize(uLightDir);
    float TdotL  = dot(T, L);
    float sinTL  = sqrt(max(0.0, 1.0 - TdotL * TdotL));
    vec3  diffuse = uLightColor * sinTL;

    // ── Two-lobe Kajiya-Kay specular ─────────────────────────────────────────
    vec3 V = normalize(uCamPos - vWorldPos);
    vec3 H = normalize(L + V);

    vec3 T1 = shiftTangent(T, vWorldNormal,  0.0);
    vec3 T2 = shiftTangent(T, vWorldNormal,  uSpecShift);

    float spec1 = kkSpec(T1, H, uSpecPower1);
    float spec2 = kkSpec(T2, H, uSpecPower2);
    // Attenuate second lobe
    float spec  = (spec1 + spec2 * 0.5) * uSpecStrength;
    spec = spec * step(0.0, dot(vWorldNormal, L)); // backface mask

    // ── Pattern — procedural stripes from world Y ────────────────────────────
    float stripeT = 0.0;
    if (uPatternType > 0.5) {
      float band = sin(vWorldPos.y * uStripeScale * 6.2832) * 0.5 + 0.5;
      stripeT = smoothstep(0.35, 0.65, band) * 0.38;
    }

    // ── Colour blend along shell ─────────────────────────────────────────────
    vec3 baseWithPattern = mix(uBaseColor, uBaseColor * 0.60, stripeT);
    vec3 furColor = mix(baseWithPattern, uTipColor, vShellFraction);

    // ── Final composite ──────────────────────────────────────────────────────
    vec3 color = furColor * (uAmbient + diffuse) + vec3(spec);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// ─── Default uniforms (merged into ShaderMaterial.uniforms) ──────────────────

export function defaultFurUniforms() {
  return {
    uTime:         { value: 0 },
    uFurLength:    { value: 0.12 },
    uFurGravity:   { value: 0.15 },
    uFatigue:      { value: 0.0 },
    uShellIndex:   { value: 0 },
    uShellCount:   { value: 32 },
    uWindDir:      { value: [0.3, 0, 0.7] },
    uWindStrength:  { value: 0.02 },
    uFurMap:       { value: null },
    uBaseColor:    { value: [0.18, 0.14, 0.12] },
    uTipColor:     { value: [0.55, 0.48, 0.40] },
    uLightDir:     { value: [0.4, 0.8, 0.5] },
    uLightColor:   { value: [1.0, 0.95, 0.85] },
    uAmbient:      { value: [0.12, 0.12, 0.14] },
    uCamPos:       { value: [0, 0, 5] },
    uSpecPower1:   { value: 80 },
    uSpecPower2:   { value: 20 },
    uSpecShift:    { value: 0.1 },
    uSpecStrength: { value: 0.6 },
    uStripeScale:  { value: 0 },
    uPatternType:  { value: 0 },
  };
}
