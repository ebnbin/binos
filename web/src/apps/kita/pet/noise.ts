// 生成毛色花纹用的确定性噪声，同一个位置每次算出的值都一样

function hash(x: number, y: number, z: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

const smooth = (t: number) => t * t * (3 - 2 * t)

// 0~1 的值噪声
export function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const fz = smooth(z - iz)
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const plane = (dz: number) =>
    lerp(
      lerp(hash(ix, iy, iz + dz), hash(ix + 1, iy, iz + dz), fx),
      lerp(hash(ix, iy + 1, iz + dz), hash(ix + 1, iy + 1, iz + dz), fx),
      fy,
    )
  return lerp(plane(0), plane(1), fz)
}

export function fbm(x: number, y: number, z: number, octaves = 4) {
  let sum = 0
  let amplitude = 0.5
  let total = 0
  for (let index = 0; index < octaves; index++) {
    sum += noise(x, y, z) * amplitude
    total += amplitude
    x *= 2.03
    y *= 2.03
    z *= 2.03
    amplitude *= 0.5
  }
  return sum / total
}

export const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
