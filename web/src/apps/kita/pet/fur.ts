import * as THREE from 'three'
import type { Rgb } from './profile.ts'

// 毛发用分层外壳：同一块身体按法线往外画很多层，每层按噪声挖掉一部分，越外层留下的越少，看起来就是一根根毛
export const shellCount = 30

// 光照在世界空间里：主光从左上前方来
export const light = {
  key: new THREE.Vector3(-0.45, 0.85, 0.55).normalize(),
  keyColor: new THREE.Color(1.0, 0.95, 0.88).multiplyScalar(1.15),
  sky: new THREE.Color(0.62, 0.66, 0.74),
  ground: new THREE.Color(0.3, 0.26, 0.22),
}

const furVertex = /* glsl */ `
  attribute float layer;
  attribute vec3 furColor;
  attribute float furScale;
  uniform float uLength;
  uniform vec3 uComb;
  uniform vec3 uGravity;
  varying vec3 vBase;
  varying vec3 vNormal;
  varying vec3 vComb;
  varying vec3 vColor;
  varying float vLayer;
  varying float vLength;
  varying float vWorldY;

  void main() {
    float len = uLength * furScale;
    vec3 p = position + normal * len * layer + uComb * len * layer * layer * 0.6;
    vec4 world = modelMatrix * vec4(p, 1.0);
    world.xyz += uGravity * len * layer * layer * 0.3;
    vBase = position;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vComb = normalize(mat3(modelMatrix) * (uComb + normal * 0.35));
    vColor = furColor;
    vLayer = layer;
    vLength = len;
    vWorldY = world.y;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const furFragment = /* glsl */ `
  uniform float uDensity;
  uniform float uUndercoat;
  uniform vec3 uKey;
  uniform vec3 uKeyColor;
  uniform vec3 uSky;
  uniform vec3 uGround;
  uniform vec3 uView;
  varying vec3 vBase;
  varying vec3 vNormal;
  varying vec3 vComb;
  varying vec3 vColor;
  varying float vLayer;
  varying float vLength;
  varying float vWorldY;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    // 地面以下不画：趴下时压在地上的毛被截平
    if (vWorldY < 0.0) discard;
    // 靠近皮肤的一段是实心的底绒，外面才是一根根的毛：长毛下面不会透出后面的东西
    // 每个格子里两根毛，位置随机；越往外层越细，边缘按像素宽度做抗锯齿，不会闪
    vec3 q = vBase * uDensity;
    vec3 cell = floor(q);
    float strand = hash13(cell);
    float alpha = 1.0;
    if (vLayer > 0.0) {
      if (vLength < 0.06) discard;
      float outer = (vLayer - uUndercoat) / (1.0 - uUndercoat);
      if (outer > 0.0) {
        alpha = 0.0;
        for (int index = 0; index < 2; index++) {
          vec3 shifted = q + float(index) * vec3(0.5, 0.37, 0.61);
          vec3 lattice = floor(shifted) + float(index) * 17.0;
          vec3 jitter = vec3(hash13(lattice + 3.1), hash13(lattice + 7.7), hash13(lattice + 11.3)) - 0.5;
          float d = length(fract(shifted) - 0.5 - jitter * 0.45);
          float t = outer / (0.5 + 0.5 * hash13(lattice));
          if (t <= 1.0) {
            float radius = mix(0.58, 0.14, t);
            float width = fwidth(d) + 0.03;
            alpha = max(alpha, 1.0 - smoothstep(radius - width, radius + width, d));
          }
        }
        if (alpha < 0.02) discard;
      }
    }
    vec3 n = normalize(vNormal);
    float wrap = clamp(dot(n, uKey) * 0.55 + 0.45, 0.0, 1.0);
    vec3 ambient = mix(uGround, uSky, n.y * 0.5 + 0.5) * 0.55;
    // 越靠近毛根越暗，模拟毛与毛之间的遮挡
    float occlusion = mix(0.34, 1.0, pow(vLayer, 0.6));
    vec3 albedo = vColor * (0.9 + 0.2 * hash13(cell + 5.0)) * mix(0.94, 1.08, vLayer);
    vec3 color = albedo * (uKeyColor * wrap + ambient) * occlusion;
    // 毛的高光沿着毛的方向拉长（Kajiya-Kay）
    vec3 h = normalize(uKey + uView);
    float th = dot(normalize(vComb), h);
    float sheen = pow(sqrt(max(0.0, 1.0 - th * th)), 48.0) * 0.12 * vLayer;
    float rim = pow(1.0 - abs(dot(n, uView)), 3.0) * 0.22 * vLayer;
    color += (sheen + rim * albedo.g * 1.6) * uKeyColor;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    gl_FragColor = vec4(gl_FragColor.rgb * alpha, alpha);
  }
`

export function furMaterial(length: number, comb: THREE.Vector3, density: number) {
  return new THREE.ShaderMaterial({
    // 画布是透明的，毛边要按预乘透明度混合，才不会把背景透出来、颜色发白
    transparent: true,
    premultipliedAlpha: true,
    vertexShader: furVertex,
    fragmentShader: furFragment,
    uniforms: {
      uLength: { value: length },
      uComb: { value: comb.clone().normalize() },
      uGravity: { value: new THREE.Vector3(0, -1, 0) },
      uDensity: { value: density },
      uUndercoat: { value: 0.22 },
      uKey: { value: light.key },
      uKeyColor: { value: light.keyColor },
      uSky: { value: light.sky },
      uGround: { value: light.ground },
      uView: { value: new THREE.Vector3(0, 0, 1) },
    },
  })
}

// 把普通几何体变成带层号的实例几何体：第 0 层是皮，之后每层往外一点
export function furGeometry(base: THREE.BufferGeometry, colors: Float32Array, scales: Float32Array) {
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.index = base.index
  geometry.setAttribute('position', base.getAttribute('position'))
  geometry.setAttribute('normal', base.getAttribute('normal'))
  geometry.setAttribute('furColor', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('furScale', new THREE.BufferAttribute(scales, 1))
  const layers = new Float32Array(shellCount + 1)
  for (let index = 0; index <= shellCount; index++) {
    layers[index] = index / shellCount
  }
  geometry.setAttribute('layer', new THREE.InstancedBufferAttribute(layers, 1))
  geometry.instanceCount = shellCount + 1
  base.computeBoundingSphere()
  geometry.boundingSphere = base.boundingSphere
  return geometry
}

const eyeVertex = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormal;
  void main() {
    vLocal = position;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  }
`

// 眼睛朝局部 +x：黄绿色虹膜、竖瞳孔、角膜高光
const eyeFragment = /* glsl */ `
  uniform float uPupil;
  uniform vec3 uInner;
  uniform vec3 uOuter;
  uniform vec3 uKey;
  uniform vec3 uView;
  varying vec3 vLocal;
  varying vec3 vNormal;

  void main() {
    vec3 p = normalize(vLocal);
    float r = length(p.yz);
    float angle = atan(p.y, p.z);
    vec3 iris = mix(uInner, uOuter, smoothstep(0.15, 0.75, r));
    iris *= 0.85 + 0.15 * sin(angle * 37.0) * sin(angle * 11.0 + r * 20.0);
    iris *= 1.0 - smoothstep(0.62, 0.84, r) * 0.65;
    vec3 color = p.x > 0.0 ? iris : vec3(0.02);
    float pupil = length(vec2(p.z / (0.08 + uPupil * 0.5), p.y / 0.66));
    color = mix(vec3(0.008), color, smoothstep(0.92, 1.08, pupil));
    vec3 n = normalize(vNormal);
    float diffuse = clamp(dot(n, uKey) * 0.5 + 0.5, 0.0, 1.0);
    color *= 0.4 + 0.6 * diffuse;
    vec3 h = normalize(uKey + uView);
    float spec = pow(max(dot(n, h), 0.0), 260.0) * 1.4 + pow(max(dot(n, h), 0.0), 24.0) * 0.05;
    gl_FragColor = vec4(color + spec, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export function eyeMaterial(colors: { inner: Rgb; outer: Rgb }) {
  return new THREE.ShaderMaterial({
    vertexShader: eyeVertex,
    fragmentShader: eyeFragment,
    uniforms: {
      uPupil: { value: 0.3 },
      uInner: { value: new THREE.Color().setRGB(...colors.inner, THREE.SRGBColorSpace) },
      uOuter: { value: new THREE.Color().setRGB(...colors.outer, THREE.SRGBColorSpace) },
      uKey: { value: light.key },
      uView: { value: new THREE.Vector3(0, 0, 1) },
    },
  })
}
