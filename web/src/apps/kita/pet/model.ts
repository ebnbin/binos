import * as THREE from 'three'
import { eyeMaterial, furGeometry, furMaterial } from './fur.ts'
import { fbm, smoothstep } from './noise.ts'

// 喜多：长毛棕色虎斑猫。单位是厘米，猫的局部空间里 +x 朝前、+y 朝上，原点在两前爪和两后爪中间的地面上

type Region = 'torso' | 'chest' | 'neck' | 'head' | 'cheek' | 'muzzle' | 'ear' | 'frontUpper' | 'frontLower' | 'hindUpper' | 'hindLower' | 'hindFoot' | 'paw' | 'tail'

const srgb = (r: number, g: number, b: number) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace)
const palette = {
  base: srgb(0.42, 0.37, 0.31),
  warm: srgb(0.52, 0.43, 0.33),
  dark: srgb(0.1, 0.085, 0.07),
  cream: srgb(0.8, 0.76, 0.68),
  ear: srgb(0.66, 0.53, 0.48),
}

const ellipsoid = (a: number, b: number, c: number, detail = 1) => new THREE.SphereGeometry(1, Math.round(56 * detail), Math.round(40 * detail)).scale(a, b, c)
// 骨头沿局部 -y，从关节往下长
const bone = (length: number, radius: number) => new THREE.CapsuleGeometry(radius, length, 6, 18).translate(0, -length / 2, 0)

export type LegName = 'leftFront' | 'leftHind' | 'rightFront' | 'rightHind'

// 一条腿的目标：脚掌在猫局部空间里的位置，fold 抬腿时脚腕往后折，push 蹬地时脚跟抬起，reach 肩胛骨前后滑动
export interface LegTarget {
  x: number
  y: number
  fold: number
  push: number
  reach: number
}

// 叠加在姿势上的身体起伏：步态和跳跃带来的
export interface BodyMotion {
  bob: number
  pitch: number
  roll: number
  yaw: number
  // 脊柱屈伸：正数前半身抬起
  flex: number
  tailSway: number
  // 尾巴摆动的相位，弧度
  tailPhase: number
}

export const stillBody: BodyMotion = { bob: 0, pitch: 0, roll: 0, yaw: 0, flex: 0, tailSway: 0.06, tailPhase: 0 }

interface Leg {
  name: LegName
  pivot: THREE.Vector3
  upper: THREE.Group
  lower: THREE.Group
  foot?: THREE.Group
  paw: THREE.Group
  lengths: [number, number, number]
  hind: boolean
  side: 1 | -1
}

export interface Pose {
  hipsX: number
  hipsY: number
  // 身体前高后低的角度，坐下时抬起前半身
  pitch: number
  front: number
  frontWidth: number
  hind: number
  hindWidth: number
  // 0 站立时后脚跟抬起，1 坐下趴下时后脚掌贴地
  hindFlat: number
  neckPitch: number
  tailLift: number
  tailCurl: number
  tailWrap: number
  eyes: number
}

export const poses = {
  stand: { hipsX: -11, hipsY: 22, pitch: 0, front: 10.5, frontWidth: 3.6, hind: -12.5, hindWidth: 4.2, hindFlat: 0, neckPitch: -0.12, tailLift: -0.85, tailCurl: 0.11, tailWrap: 0.02, eyes: 1 },
  walk: { hipsX: -11, hipsY: 21.5, pitch: -0.03, front: 10.5, frontWidth: 3.2, hind: -11.5, hindWidth: 3.8, hindFlat: 0, neckPitch: -0.45, tailLift: -0.3, tailCurl: 0.05, tailWrap: 0, eyes: 1 },
  sit: { hipsX: -8, hipsY: 7.5, pitch: 0.62, front: 12, frontWidth: 2.8, hind: -1.5, hindWidth: 5.4, hindFlat: 1, neckPitch: -0.05, tailLift: -0.35, tailCurl: 0, tailWrap: 0.2, eyes: 1 },
  loaf: { hipsX: -11, hipsY: 8.5, pitch: 0, front: 11, frontWidth: 3, hind: -5, hindWidth: 5.6, hindFlat: 1, neckPitch: -0.02, tailLift: -0.1, tailCurl: 0, tailWrap: 0.26, eyes: 0.85 },
  sleep: { hipsX: -11, hipsY: 7.5, pitch: 0, front: 11, frontWidth: 3, hind: -5, hindWidth: 5.8, hindFlat: 1, neckPitch: -0.38, tailLift: -0.1, tailCurl: 0, tailWrap: 0.3, eyes: 0 },
  // 起跳前蹲下蓄力，后腿收到身体下面
  crouch: { hipsX: -10, hipsY: 13, pitch: -0.04, front: 12, frontWidth: 3, hind: -7, hindWidth: 4.4, hindFlat: 0.55, neckPitch: -0.2, tailLift: -0.55, tailCurl: 0.05, tailWrap: 0, eyes: 1 },
  // 盯住猎物压低身子
  stalk: { hipsX: -10.5, hipsY: 11.5, pitch: 0.03, front: 13.5, frontWidth: 3.2, hind: -9, hindWidth: 4.6, hindFlat: 0.45, neckPitch: -0.12, tailLift: -0.35, tailCurl: -0.04, tailWrap: 0, eyes: 1 },
  // 伸懒腰：前腿往前伸，胸口贴低，屁股翘起
  stretch: { hipsX: -11, hipsY: 21, pitch: -0.42, front: 20, frontWidth: 3, hind: -12, hindWidth: 4.2, hindFlat: 0, neckPitch: 0.35, tailLift: 0.4, tailCurl: 0.08, tailWrap: 0, eyes: 0.6 },
  // 被拎起来：四条腿垂下来
  dangle: { hipsX: -11, hipsY: 22, pitch: 0.08, front: 12, frontWidth: 3, hind: -11, hindWidth: 4, hindFlat: 0, neckPitch: 0.1, tailLift: -1.3, tailCurl: 0.04, tailWrap: 0, eyes: 1 },
} satisfies Record<string, Pose>

export type Posture = keyof typeof poses

export interface Look {
  yaw: number
  pitch: number
}

const tailSegments = 13
const tailLength = 2.5

export class CatModel {
  readonly root = new THREE.Group()
  readonly hitTargets: THREE.Object3D[] = []
  readonly eyes: THREE.Mesh[] = []
  private readonly hips = new THREE.Group()
  private readonly torso: THREE.Object3D
  private readonly chest = new THREE.Group()
  private readonly neck = new THREE.Group()
  private readonly head = new THREE.Group()
  private readonly ears: THREE.Object3D[] = []
  private readonly legs: Leg[] = []
  private readonly tail: THREE.Group[] = []
  private readonly materials: THREE.ShaderMaterial[] = []
  private readonly eyeMaterials: THREE.ShaderMaterial[] = []
  private readonly furParts: { mesh: THREE.Mesh; region: Region; ring: number; base: THREE.BufferGeometry; length: number }[] = []
  private readonly temp = new THREE.Vector3()
  private readonly tailRaise = new Array<number>(tailSegments).fill(0)

  constructor() {
    this.root.add(this.hips)
    this.hips.position.set(poses.stand.hipsX, poses.stand.hipsY, 0)
    this.torso = this.part(this.hips, 'torso', ellipsoid(15, 8.2, 7.2, 1.3), [9.5, 0.5, 0], 2.6, [-1, -0.5, 0], 2.6)
    this.hips.add(this.chest)
    this.chest.position.set(19, 0, 0)
    this.part(this.chest, 'chest', ellipsoid(8.5, 9, 7.3), [1.5, 0, 0], 3, [-0.4, -1, 0], 2.6)
    this.chest.add(this.neck)
    this.neck.position.set(7.5, 3.5, 0)
    this.part(this.neck, 'neck', ellipsoid(5.5, 5.8, 5.4), [0.5, 0.5, 0], 3.6, [-0.6, -1, 0], 2.6)
    this.neck.add(this.head)
    this.head.position.set(5.5, 3, 0)
    this.head.scale.setScalar(1.15)
    this.buildHead()
    for (const side of [1, -1] as const) {
      this.legs.push(this.buildLeg(this.chest, [3, -3, side * 4], false, side))
      this.legs.push(this.buildLeg(this.hips, [1, -0.5, side * 4.2], true, side))
      // 臀部的大块肌肉，把后大腿包在身体轮廓里
      this.part(this.hips, 'torso', ellipsoid(6.8, 7.6, 3.8), [1.8, -2.2, side * 3.1], 2.4, [-1, -0.7, 0], 2.6)
    }
    this.buildTail()
    this.root.updateMatrixWorld(true)
    this.paint()
  }

  private part(parent: THREE.Object3D, region: Region, geometry: THREE.BufferGeometry, position: [number, number, number], length: number, comb: [number, number, number], density: number, ring = 0) {
    const material = furMaterial(length, new THREE.Vector3(...comb), density)
    material.userData.density = density
    const count = geometry.getAttribute('position').count
    const mesh = new THREE.Mesh(furGeometry(geometry, new Float32Array(count * 3), new Float32Array(count).fill(1)), material)
    mesh.position.set(...position)
    mesh.frustumCulled = false
    // 毛是半透明的：固定绘制顺序，免得每帧按距离重排，重叠处的毛边忽闪
    mesh.renderOrder = this.furParts.length
    parent.add(mesh)
    this.materials.push(material)
    this.furParts.push({ mesh, region, ring, base: geometry, length })
    this.hitTargets.push(mesh)
    return mesh
  }

  private buildHead() {
    const head = this.head
    this.part(head, 'head', ellipsoid(5.2, 4.7, 5.5, 1.3), [0, 0, 0], 1.1, [-1, -0.2, 0], 4)
    this.part(head, 'muzzle', ellipsoid(2.5, 2.1, 2.9), [4, -1.5, 0], 0.6, [-0.3, -1, 0], 5)
    for (const side of [1, -1]) {
      this.part(head, 'cheek', ellipsoid(3.2, 3, 2.6), [0.8, -1.7, side * 3.3], 2.4, [-1, -0.6, side * 0.6], 3.5)
      const ear = this.part(head, 'ear', new THREE.ConeGeometry(2.3, 6.4, 24, 4).scale(0.42, 1, 1), [-0.4, 5.2, side * 2.6], 0.35, [0, 1, 0], 5)
      ear.rotation.set(side * -0.32, 0, -0.12)
      this.ears.push(ear)
      const eyeMaterialInstance = eyeMaterial()
      this.eyeMaterials.push(eyeMaterialInstance)
      const eye = new THREE.Mesh(new THREE.SphereGeometry(1.42, 32, 24), eyeMaterialInstance)
      eye.position.set(3.75, 0.95, side * 2.2)
      eye.rotation.y = side * -0.42
      head.add(eye)
      this.eyes.push(eye)
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14).scale(0.55, 0.42, 0.72), new THREE.MeshStandardMaterial({ color: srgb(0.5, 0.31, 0.29), roughness: 0.45 }))
    nose.position.set(6.25, -0.55, 0)
    head.add(nose)
    head.add(whiskers())
  }

  private buildLeg(parent: THREE.Object3D, pivot: [number, number, number], hind: boolean, side: 1 | -1): Leg {
    // 后腿：大腿短、藏在身体里，膝盖在肚子下沿；小腿最长，斜向后到高高的脚跟；跗骨几乎竖直
    const lengths: [number, number, number] = hind ? [9, 10, 7] : [9, 9.3, 0]
    const upper = new THREE.Group()
    upper.position.set(...pivot)
    parent.add(upper)
    // 后大腿是一块饱满的肌肉，和身体连成一片
    const thigh = hind ? ellipsoid(2.6, 4.8, 2.4).translate(0.4, -4.2, 0) : bone(lengths[0], 2.1)
    this.part(upper, hind ? 'hindUpper' : 'frontUpper', thigh, [0, 0, 0], hind ? 2 : 1.4, [0, -1, 0], 2.8)
    const lower = new THREE.Group()
    lower.position.y = -lengths[0]
    upper.add(lower)
    this.part(lower, hind ? 'hindLower' : 'frontLower', bone(lengths[1], hind ? 1.5 : 1.4), [0, 0, 0], hind ? 1.5 : 0.9, [0, -1, 0], 3.2, lengths[0])
    let foot: THREE.Group | undefined
    let end: THREE.Group = lower
    let endLength = lengths[1]
    if (hind) {
      foot = new THREE.Group()
      foot.position.y = -lengths[1]
      lower.add(foot)
      this.part(foot, 'hindFoot', bone(lengths[2], 1.1), [0, 0, 0], 0.7, [0, -1, 0], 3.5, lengths[0] + lengths[1])
      end = foot
      endLength = lengths[2]
    }
    const paw = new THREE.Group()
    paw.position.y = -endLength
    end.add(paw)
    this.part(paw, 'paw', ellipsoid(1.9, 1.05, 1.55), [0.8, 0, 0], 0.6, [1, 0.3, 0], 3.5)
    const name: LegName = `${side === 1 ? 'left' : 'right'}${hind ? 'Hind' : 'Front'}`
    return { name, pivot: new THREE.Vector3(...pivot), upper, lower, foot, paw, lengths, hind, side }
  }

  private buildTail() {
    let parent: THREE.Object3D = this.hips
    for (let index = 0; index < tailSegments; index++) {
      const segment = new THREE.Group()
      segment.position.set(index === 0 ? -6 : -tailLength, index === 0 ? 3 : 0, 0)
      parent.add(segment)
      const radius = 2 - (index / tailSegments) * 0.9
      this.part(segment, 'tail', new THREE.CapsuleGeometry(radius, tailLength, 4, 14).rotateZ(Math.PI / 2).translate(-tailLength / 2, 0, 0), [0, 0, 0], 3.8 - index * 0.06, [-1, -0.15, 0], 2.3, index * tailLength)
      this.tail.push(segment)
      parent = segment
    }
  }

  // 按站立时的位置给每个顶点上色、定毛长
  private paint() {
    const headCenter = this.head.getWorldPosition(new THREE.Vector3())
    const eyeCenters = this.eyes.map(eye => eye.getWorldPosition(new THREE.Vector3()))
    const noseTip = headCenter.clone().add(new THREE.Vector3(6.3, -0.6, 0))
    const world = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const normalMatrix = new THREE.Matrix3()
    for (const { mesh, region, ring, base } of this.furParts) {
      const positions = base.getAttribute('position')
      const normals = base.getAttribute('normal')
      const geometry = mesh.geometry
      const colors = geometry.getAttribute('furColor') as THREE.BufferAttribute
      const scales = geometry.getAttribute('furScale') as THREE.BufferAttribute
      normalMatrix.getNormalMatrix(mesh.matrixWorld)
      for (let index = 0; index < positions.count; index++) {
        world.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld)
        normal.fromBufferAttribute(normals, index).applyMatrix3(normalMatrix).normalize()
        const along = region === 'tail' ? -positions.getX(index) : -positions.getY(index)
        const head = world.clone().sub(headCenter)
        const { color, fur } = coat(region, world, normal, head, ring + along)
        let scale = fur
        for (const eye of eyeCenters) {
          scale *= smoothstep(1.6, 2.9, world.distanceTo(eye))
        }
        scale *= smoothstep(0.6, 1.6, world.distanceTo(noseTip))
        colors.setXYZ(index, color.r, color.g, color.b)
        scales.setX(index, scale)
      }
    }
  }

  // 每帧按姿势摆好全身
  apply(pose: Pose, legs: Record<LegName, LegTarget>, body: BodyMotion, look: Look, time: number, breath: number, dt: number) {
    const pitch = pose.pitch + body.pitch
    this.hips.position.set(pose.hipsX, pose.hipsY + body.bob, 0)
    this.hips.rotation.set(body.roll, body.yaw, pitch)
    this.chest.rotation.set(0, -body.yaw * 1.6, body.flex)
    this.torso.scale.set(1, 1 + breath * 0.018, 1 + breath * 0.022)

    // 头保持水平，再叠加看的方向
    const front = pitch + body.flex
    this.neck.rotation.set(0, look.yaw * 0.4, -front * 0.85 + pose.neckPitch * 0.5 + look.pitch * 0.35)
    this.head.rotation.set(look.yaw * 0.12, look.yaw * 0.6, pose.neckPitch * 0.6 + look.pitch * 0.65 - front * 0.15)

    this.root.updateMatrixWorld(true)
    for (const leg of this.legs) {
      this.placeLeg(leg, legs[leg.name], pose)
    }

    for (const ear of this.ears) {
      ear.rotation.z = -0.12 + Math.sin(time * 0.7 + ear.position.z) * 0.03
    }
    for (const eye of this.eyes) {
      eye.scale.y = Math.max(0.06, pose.eyes)
    }
    this.placeTail(pose, body, dt)
  }

  // 一根毛约占 3 个物理像素：太细会闪，太粗像毛线
  setStrandScale(devicePixelsPerCm: number) {
    for (const material of this.materials) {
      material.uniforms.uDensity.value = material.userData.density * devicePixelsPerCm / 8
    }
  }

  setPupil(size: number) {
    for (const material of this.eyeMaterials) {
      material.uniforms.uPupil.value = size
    }
  }

  setView(direction: THREE.Vector3) {
    for (const material of [...this.materials, ...this.eyeMaterials]) {
      material.uniforms.uView.value.copy(direction)
    }
  }

  twitchEar(side: number, amount: number) {
    const ear = this.ears[side < 0 ? 1 : 0]
    ear.rotation.x = (side < 0 ? 0.32 : -0.32) - amount * Math.sign(side) * 0.5
  }

  private placeLeg(leg: Leg, target: LegTarget, pose: Pose) {
    const front = !leg.hind
    const width = front ? pose.frontWidth : pose.hindWidth
    if (front) {
      leg.upper.position.set(leg.pivot.x + target.reach, leg.pivot.y, leg.pivot.z)
    }
    const parent = leg.upper.parent!
    const local = parent.worldToLocal(this.root.localToWorld(new THREE.Vector3(target.x, target.y, leg.side * width)))
    const groundToParent = -(leg.hind ? this.hips.rotation.z : this.hips.rotation.z + this.chest.rotation.z)
    const axis = new THREE.Vector3(0, 0, 1)
    const pivot = leg.upper.position
    let end: THREE.Vector3
    if (leg.hind) {
      // 跗骨：站着时脚跟高高抬起、略向后斜，蹬地时脚跟更高更斜，抬腿时往后折；坐下趴下时平放在地上
      const heel = THREE.MathUtils.lerp(0.22, 1.42, pose.hindFlat) + target.push * 0.3 - target.fold * 1.0
      const metatarsal = leg.lengths[2]
      end = local.clone().add(new THREE.Vector3(-Math.sin(heel) * metatarsal, Math.cos(heel) * metatarsal, 0).applyAxisAngle(axis, groundToParent))
    } else {
      end = local.clone().add(new THREE.Vector3(target.fold * 1.2, 0.6 + target.fold * 0.8, 0).applyAxisAngle(axis, groundToParent))
    }
    const [l1, l2] = leg.lengths
    const dx = end.x - pivot.x
    const dy = end.y - pivot.y
    const distance = Math.min(l1 + l2 - 0.05, Math.max(Math.abs(l1 - l2) + 0.5, Math.hypot(dx, dy)))
    const base = Math.atan2(dy, dx)
    const bend = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance))))
    // 后腿膝盖朝前，前腿肘朝后
    const upperAngle = base + (leg.hind ? bend : -bend)
    const jointX = pivot.x + Math.cos(upperAngle) * l1
    const jointY = pivot.y + Math.sin(upperAngle) * l1
    const lowerAngle = Math.atan2(end.y - jointY, end.x - jointX)
    leg.upper.rotation.set(0, 0, upperAngle + Math.PI / 2)
    leg.lower.rotation.set(0, 0, lowerAngle - upperAngle)
    let lastAngle = lowerAngle
    if (leg.foot) {
      const footAngle = Math.atan2(local.y - end.y, local.x - end.x)
      leg.foot.rotation.set(0, 0, footAngle - lowerAngle)
      lastAngle = footAngle
    }
    // 着地时脚掌平贴地面，抬起时脚尖朝下
    leg.paw.rotation.set(0, 0, -(lastAngle + Math.PI / 2) + groundToParent - target.fold * (front ? 1.25 : 0.9) - target.push * 0.5)
  }

  private placeTail(pose: Pose, body: BodyMotion, dt: number) {
    for (let index = 0; index < this.tail.length; index++) {
      const segment = this.tail[index]
      const wave = Math.sin(body.tailPhase - index * 0.45) * body.tailSway * (0.3 + index / this.tail.length)
      segment.rotation.set(0, (index === 0 ? 0 : pose.tailWrap) + wave, index === 0 ? -pose.tailLift : -pose.tailCurl)
    }
    // 尾巴不穿过地面：压到地下的那一节往上抬，抬的角度二分求出；每节抬多少随时间渐变，贴地的折点不会在相邻几节之间跳来跳去，短暂压进地面的部分本来就不画
    const tip = this.temp
    const floor = 2.2
    const height = (segment: THREE.Group, raise: number, base: number) => {
      segment.rotation.z = base - raise
      segment.updateMatrix()
      segment.matrixWorld.multiplyMatrices(segment.parent!.matrixWorld, segment.matrix)
      return this.root.worldToLocal(tip.set(-tailLength, 0, 0).applyMatrix4(segment.matrixWorld)).y
    }
    this.root.updateMatrixWorld(true)
    this.tail.forEach((segment, index) => {
      const base = segment.rotation.z
      let needed = 0
      if (height(segment, 0, base) < floor) {
        let low = 0
        let high = 1.6
        for (let step = 0; step < 10; step++) {
          const middle = (low + high) / 2
          if (height(segment, middle, base) >= floor) {
            high = middle
          } else {
            low = middle
          }
        }
        needed = high
      }
      this.tailRaise[index] += (needed - this.tailRaise[index]) * (1 - Math.exp(-12 * dt))
      height(segment, this.tailRaise[index], base)
    })
  }

  dispose() {
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose()
        const material = object.material as THREE.Material
        material.dispose()
      }
    })
    for (const part of this.furParts) {
      part.base.dispose()
    }
  }
}

// 毛色：棕色虎斑，胸口、下巴、肚子浅奶油色，尾巴一圈圈深色环纹
function coat(region: Region, world: THREE.Vector3, normal: THREE.Vector3, head: THREE.Vector3, ring: number) {
  const color = new THREE.Color()
  const mottle = fbm(world.x * 0.2, world.y * 0.2, world.z * 0.2)
  color.copy(palette.base).lerp(palette.warm, mottle)
  let fur = 1
  const fine = 0.85 + 0.3 * fbm(world.x * 0.9 + 3, world.y * 0.9, world.z * 0.9)
  switch (region) {
    case 'torso':
    case 'chest':
    case 'neck': {
      const warp = (fbm(world.x * 0.08, world.y * 0.08, world.z * 0.08 + 5) - 0.5) * 16
      const stripe = smoothstep(0.2, 0.85, Math.sin((world.x + warp) * 0.9 + Math.abs(world.z) * 0.2)) * smoothstep(-0.3, 0.35, normal.y + 0.25)
      const dorsal = smoothstep(0.5, 0.95, normal.y) * 0.55
      color.lerp(palette.dark, Math.max(stripe * 0.78, dorsal))
      const underside = smoothstep(-0.05, -0.65, normal.y)
      const bib = region === 'torso' ? 0 : smoothstep(0.1, 0.7, normal.x) * smoothstep(30, 22, world.y)
      color.lerp(palette.cream, Math.min(1, underside * 0.8 + bib * 0.9))
      fur = 1 + underside * 0.35 + (region === 'neck' ? bib * 0.2 : 0)
      break
    }
    case 'head':
    case 'cheek':
    case 'muzzle': {
      const top = smoothstep(0.5, 2.2, head.y)
      const forehead = top * smoothstep(-2, 1.5, head.x) * smoothstep(3, 1.5, Math.abs(head.z)) * smoothstep(0.1, 0.8, Math.sin(head.z * 2.4 + 1.57))
      const cheekLine = smoothstep(2.6, 3.2, Math.abs(head.z)) * smoothstep(0.5, 0.15, Math.abs(head.y + 0.1 - (head.x - 3) * 0.18)) * smoothstep(4.5, 2.5, head.x)
      const crown = top * smoothstep(-0.5, -3, head.x) * 0.6
      color.lerp(palette.dark, Math.max(forehead * 0.85, cheekLine * 0.75, crown))
      const muzzle = region === 'muzzle' ? smoothstep(-1.4, -0.4, head.y - 0.6 * (head.x - 4)) * 0.2 + 0.75 : 0
      const chin = smoothstep(-1.8, -3, head.y) * smoothstep(1, 3, head.x)
      color.lerp(palette.cream, Math.min(1, muzzle + chin))
      fur = region === 'cheek' ? 1 + smoothstep(-0.5, -2.5, head.y) * 0.4 : 1
      break
    }
    case 'ear': {
      const inner = smoothstep(-0.1, 0.5, normal.x)
      color.lerp(palette.dark, 0.45).lerp(palette.ear, inner * 0.5).lerp(palette.cream, inner * 0.35)
      fur = 1 + inner * smoothstep(5, 8.5, head.y) * 2.5
      break
    }
    case 'frontUpper':
    case 'frontLower':
    case 'hindUpper':
    case 'hindLower':
    case 'hindFoot': {
      const bands = smoothstep(0.35, 0.9, Math.sin(ring * 1.05 + mottle * 3)) * 0.65
      color.lerp(palette.dark, bands * (region === 'hindUpper' ? 0.6 : 1))
      if (region === 'hindFoot') {
        color.lerp(palette.dark, smoothstep(0, -0.6, normal.x) * 0.8)
      }
      if (region === 'frontLower' || region === 'hindLower') {
        color.lerp(palette.cream, smoothstep(0, 0.8, normal.x) * 0.15)
      }
      fur = region === 'hindUpper' ? 1 + smoothstep(0, -0.7, normal.x) * 0.3 : 1
      break
    }
    case 'paw':
      color.lerp(palette.cream, 0.25)
      break
    case 'tail': {
      const bands = smoothstep(0.1, 0.75, Math.sin(ring * 0.5 + mottle * 2.5))
      color.lerp(palette.dark, Math.max(bands * 0.8, smoothstep(27, 32, ring)))
      break
    }
  }
  color.multiplyScalar(fine)
  return { color, fur }
}

function whiskers() {
  const points: number[] = []
  for (const side of [1, -1]) {
    for (let index = 0; index < 8; index++) {
      const row = index % 4
      const start = new THREE.Vector3(4.9 + row * 0.25, -1.1 - row * 0.32, side * (1.9 + (index > 3 ? 0.35 : 0)))
      const angle = -0.25 + row * 0.18 + (index > 3 ? 0.12 : 0)
      const length = 6.5 + (index % 3)
      let previous = start
      for (let step = 1; step <= 5; step++) {
        const t = step / 5
        const next = start.clone().add(new THREE.Vector3(Math.sin(angle) * length * t * 0.6 - t * t * 0.8, -Math.cos(1.2) * length * t * 0.25 - t * t * 1.4 - angle * t * 2, side * length * t))
        points.push(previous.x, previous.y, previous.z, next.x, next.y, next.z)
        previous = next
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: srgb(0.95, 0.93, 0.88), transparent: true, opacity: 0.5, depthWrite: false }))
}
