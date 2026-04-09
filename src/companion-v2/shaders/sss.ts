/**
 * Cheap real-time subsurface scattering (SSS) for the cat body mesh.
 *
 * Technique: wrap lighting + thin-surface back-scatter.
 *
 * Wrap lighting extends the Lambertian diffuse term past the terminator so
 * that light "bleeds" slightly into shadow areas (simulating inter-scattering
 * inside the skin).  Back-scatter adds a translucent glow on the silhouette
 * when the light is behind the surface, most visible on ears and paws.
 *
 * Reference: Eugene d'Eon, "A Better Diffuse Model for Translucent Materials",
 * GDC 2007.  Simplified for real-time use.
 */

export const sssVertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec2 vUv;

  void main() {
    vec4 worldPos   = modelMatrix * vec4(position, 1.0);
    vWorldPos       = worldPos.xyz;
    vWorldNormal    = normalize(mat3(modelMatrix) * normal);
    vUv             = uv;

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const sssFragmentShader = /* glsl */ `
  precision highp float;

  // ── Uniforms ────────────────────────────────────────────────────────────────
  uniform sampler2D uAlbedo;
  uniform vec3  uLightDir;         // world space, normalised
  uniform vec3  uLightColor;
  uniform vec3  uSubsurfaceColor;  // pinkish for skin, warm amber for paws
  uniform vec3  uCamPos;
  uniform float uWrapFactor;       // wrap lighting k (0.5 is a good default)
  uniform float uDistortion;       // back-scatter distortion amount (~0.3)
  uniform float uPower;            // scatter sharpness (~8)
  uniform float uScale;            // scatter scale (~1.5)
  uniform float uAmbientStr;
  uniform vec3  uAmbientColor;

  // ── Varyings ────────────────────────────────────────────────────────────────
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec2 vUv;

  // ── Wrap lighting ────────────────────────────────────────────────────────────
  // Extends diffuse past terminator:  (dot(N, L) + k) / (1 + k)
  float wrapDiffuse(vec3 N, vec3 L, float k) {
    return max(0.0, (dot(N, L) + k) / (1.0 + k));
  }

  // ── Back-scatter (thin-surface translucency) ─────────────────────────────────
  // Simulates light that punches through a thin surface (ears, paws, tail tip).
  float backScatter(vec3 N, vec3 L, vec3 V, float distortion, float power, float scale) {
    vec3  H       = normalize(L + N * distortion);
    float VdotH   = max(0.0, dot(V, -H));
    float scatter  = scale * pow(VdotH, power);
    return scatter;
  }

  void main() {
    vec4 albedoSample = texture2D(uAlbedo, vUv);
    vec3 albedo       = albedoSample.rgb;

    vec3 N = normalize(vWorldNormal);
    vec3 L = normalize(uLightDir);
    vec3 V = normalize(uCamPos - vWorldPos);

    // ── Wrap diffuse ─────────────────────────────────────────────────────────
    float diffuse = wrapDiffuse(N, L, uWrapFactor);
    vec3  diffuseColor = albedo * uLightColor * diffuse;

    // ── Subsurface back-scatter ──────────────────────────────────────────────
    float scatter = backScatter(N, L, V, uDistortion, uPower, uScale);
    vec3  scatterColor = uSubsurfaceColor * uLightColor * scatter;

    // ── Ambient ──────────────────────────────────────────────────────────────
    vec3 ambient = albedo * uAmbientColor * uAmbientStr;

    // ── Composite ────────────────────────────────────────────────────────────
    vec3 color = ambient + diffuseColor + scatterColor;
    gl_FragColor = vec4(color, albedoSample.a);
  }
`;

// ─── Default uniforms ─────────────────────────────────────────────────────────

export function defaultSSSUniforms() {
  return {
    uAlbedo:          { value: null },
    uLightDir:        { value: [0.4, 0.8, 0.5] },
    uLightColor:      { value: [1.0, 0.95, 0.85] },
    uSubsurfaceColor: { value: [0.9, 0.4, 0.3] },    // warm skin pink
    uCamPos:          { value: [0, 0, 5] },
    uWrapFactor:      { value: 0.5 },
    uDistortion:      { value: 0.3 },
    uPower:           { value: 8.0 },
    uScale:           { value: 1.5 },
    uAmbientStr:      { value: 0.2 },
    uAmbientColor:    { value: [0.4, 0.45, 0.6] },   // cool sky ambient
  };
}
