import * as THREE from 'three'
import { light } from './fur.ts'
import { bodyMotion, cadence, gaitWeights, legNames, legTargets, tailRate } from './gait.ts'
import { CatModel, poses, stillBody } from './model.ts'
import type { BodyMotion, LegName, LegTarget, Look, Pose, Posture } from './model.ts'
import { smoothstep } from './noise.ts'
import type { CatProfile } from './profile.ts'
import { Purr } from './purr.ts'

// 俯视地面的角度：既能看清侧面，往屏幕上方走也有纵深
const elevation = 0.38
const gravity = 980
// 厘米每秒
const speeds = { walk: 30, trot: 85, run: 270 }

// 离开桌面再回来时接着上次的位置和姿势
let memory: { x: number; z: number; heading: number; posture: Posture } | undefined

// 想做的事：休息（摆某个姿势）、走到某处、追鼠标或玩具、在桌面上疯跑
type Activity =
  | { kind: 'rest' }
  | { kind: 'go'; x: number; z: number; speed: number; then: Posture; face?: number; leap?: boolean }
  | { kind: 'hunt'; toy?: { x: number; z: number } }
  | { kind: 'zoomies'; left: number; x: number; z: number; leap: boolean }

interface Jump {
  fromX: number
  fromZ: number
  toX: number
  toZ: number
  height: number
  duration: number
  // 蹲下和腾空时慢慢转向这个朝向
  heading: number
  // 落地后接着跑
  carry: boolean
}

// 身体在做什么：在地上、蹲下蓄力、腾空、落地缓冲、被拎着、掉下来
type Motion =
  | { kind: 'ground' }
  | { kind: 'crouch'; from: number; until: number; jump: Jump; wiggle: boolean }
  | { kind: 'air'; jump: Jump; t: number }
  | { kind: 'land'; until: number }
  | { kind: 'held' }
  | { kind: 'fall'; vy: number }

export function startPet(canvas: HTMLCanvasElement, surface: HTMLElement, profile: CatProfile) {
  const { traits } = profile
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  scene.add(new THREE.HemisphereLight(light.sky, light.ground, 1.2))
  const sun = new THREE.DirectionalLight(light.keyColor, 2)
  sun.position.copy(light.key).multiplyScalar(100)
  scene.add(sun)

  const camera = new THREE.OrthographicCamera()
  const view = new THREE.Vector3(0, Math.sin(elevation), Math.cos(elevation))
  camera.position.copy(view).multiplyScalar(1000)
  camera.lookAt(0, 0, 0)

  const cat = new CatModel(profile)
  cat.setView(view)
  scene.add(cat.root)
  const shadow = groundShadow()
  cat.root.add(shadow)

  const purr = new Purr()
  const raycaster = new THREE.Raycaster()
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  let placed = false
  let width = 1
  let height = 1
  let scale = 2.6
  const bounds = { left: -100, right: 100, far: -100, near: 100 }

  const random = (min: number, max: number) => min + Math.random() * (max - min)
  const saved = memory
  const state = {
    x: saved?.x ?? 0,
    y: 0,
    z: saved?.z ?? 0,
    heading: saved?.heading ?? -Math.PI / 2 + 0.7,
    speed: 0,
    turnRate: 0,
    turnSign: 0,
    poseVelocity: {} as Partial<Record<keyof Pose, number>>,
    tailSway: stillBody.tailSway,
    posture: saved?.posture ?? ('sit' as Posture),
    postureUntil: 0,
    activity: { kind: 'rest' } as Activity,
    motion: { kind: 'ground' } as Motion,
    decideAt: 2,
    sleepUntil: 0,
    pose: { ...poses[saved?.posture ?? 'sit'] } as Pose,
    phase: 0,
    amount: 0,
    tailClock: 0,
    body: { ...stillBody } as BodyMotion,
    look: { yaw: 0, pitch: 0 } as Look,
    gaze: null as THREE.Vector3 | null,
    gazeUntil: 0,
    pet: 0,
    stroke: 0,
    lastTouch: 0,
    lastZoomies: -30,
    excitedUntil: 0,
    huntRestAt: 0,
    clicks: [] as number[],
    pupil: 0.3,
    blinkAt: 2,
    earTwitch: 0,
    earSide: 1,
    hover: false,
    swing: 0,
  }
  const pointer = { inside: false, x: 0, y: 0, movedAt: -10, eventAt: 0, restAt: -10, restX: 0, restY: 0, speed: 0, vx: 0 }
  const lerp = THREE.MathUtils.lerp
  const fade: { kind: Motion['kind']; from: number; legs?: Record<LegName, LegTarget>; body?: BodyMotion; lastLegs?: Record<LegName, LegTarget>; lastBody?: BodyMotion } = { kind: 'ground', from: -1 }
  // 按在猫身上：还没分清是点一下还是拎起来
  let press: { x: number; y: number; at: number } | undefined

  function resize() {
    const rect = surface.getBoundingClientRect()
    width = Math.max(1, rect.width)
    height = Math.max(1, rect.height)
    scale = Math.min(2.8, Math.max(1.5, Math.min(width, height) / 320))
    renderer.setSize(width, height, false)
    cat.setStrandScale(scale * renderer.getPixelRatio())
    camera.left = -width / 2 / scale
    camera.right = width / 2 / scale
    camera.top = height / 2 / scale
    camera.bottom = -height / 2 / scale
    camera.near = 1
    camera.far = 3000
    camera.updateProjectionMatrix()
    const far = floorAt(width / 2, height * 0.08 + 36 * scale)
    const near = floorAt(width / 2, height - 70)
    bounds.left = camera.left + 45
    bounds.right = camera.right - 45
    bounds.far = far?.z ?? -100
    bounds.near = Math.max(bounds.far, near?.z ?? 100)
    if (!saved && !placed) {
      placed = true
      state.x = bounds.right * 0.45
      state.z = bounds.far + (bounds.near - bounds.far) * 0.7
    }
    state.x = clampX(state.x)
    state.z = clampZ(state.z)
  }

  const clampX = (x: number) => Math.min(bounds.right, Math.max(bounds.left, x))
  const clampZ = (z: number) => Math.min(bounds.near, Math.max(bounds.far, z))
  const randomSpot = () => ({ x: random(bounds.left, bounds.right), z: random(bounds.far, bounds.near) })

  function ndc(clientX: number, clientY: number) {
    const rect = surface.getBoundingClientRect()
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
  }

  function floorAt(x: number, y: number) {
    raycaster.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), camera)
    return raycaster.ray.intersectPlane(floor, new THREE.Vector3())
  }

  function hits(clientX: number, clientY: number) {
    const rect = surface.getBoundingClientRect()
    const center = toScreen(new THREE.Vector3(state.x, state.y + 15, state.z))
    if (Math.hypot(clientX - rect.left - center.x, clientY - rect.top - center.y) > 60 * scale) {
      return false
    }
    raycaster.setFromCamera(ndc(clientX, clientY), camera)
    return raycaster.intersectObjects(cat.hitTargets, false).length > 0
  }

  function toScreen(point: THREE.Vector3) {
    const projected = point.clone().project(camera)
    return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height }
  }

  // 鼠标在屏幕上，相当于贴在玻璃上：取视线上离猫头最近的点
  function pointerTarget(head: THREE.Vector3) {
    const rect = surface.getBoundingClientRect()
    raycaster.setFromCamera(ndc(pointer.x + rect.left, pointer.y + rect.top), camera)
    return raycaster.ray.closestPointToPoint(head, new THREE.Vector3())
  }

  const pointerFloor = () => {
    const point = floorAt(pointer.x, pointer.y)
    return point ? { x: clampX(point.x), z: clampZ(point.z) } : undefined
  }

  // 朝向镜头偏一点的角度最好看
  const facingViewer = () => -Math.PI / 2 + (Math.random() < 0.5 ? -1 : 1) * random(0.4, 1.1)
  const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
  const approach = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt))
  const toward = (current: number, target: number, step: number) => (current < target ? Math.min(target, current + step) : Math.max(target, current - step))

  function rest(posture: Posture, hold = 0) {
    state.activity = { kind: 'rest' }
    state.posture = posture
    state.postureUntil = time + hold
    state.decideAt = time + (posture === 'sit' || posture === 'loaf' ? random(3, 8) : random(1.5, 4))
  }

  function go(x: number, z: number, speed: number, then: Posture, face?: number, leap = false) {
    state.activity = { kind: 'go', x: clampX(x), z: clampZ(z), speed, then, face, leap }
  }

  function jump(toX: number, toZ: number, height: number, options: { crouch?: number; wiggle?: boolean; carry?: boolean; face?: number } = {}) {
    const x = clampX(toX)
    const z = clampZ(toZ)
    const heading = options.face ?? (Math.hypot(x - state.x, z - state.z) > 2 ? Math.atan2(-(z - state.z), x - state.x) : state.heading)
    const target = { fromX: state.x, fromZ: state.z, toX: x, toZ: z, height, duration: 2 * Math.sqrt((2 * height) / gravity), heading, carry: options.carry ?? false }
    if (options.crouch) {
      state.motion = { kind: 'crouch', from: time, until: time + options.crouch, jump: target, wiggle: options.wiggle ?? false }
    } else {
      state.motion = { kind: 'air', jump: target, t: 0 }
    }
  }

  // 转身有角加速度：从静止慢慢转起来，快到时慢下来，转速不会突变
  function rotate(diff: number, maxRate: number, dt: number) {
    const wanted = Math.max(-maxRate, Math.min(maxRate, diff * 7))
    state.turnRate = toward(state.turnRate, wanted, 28 * dt)
    state.heading += state.turnRate * dt
  }

  function turnToward(heading: number, dt: number) {
    rotate(wrapAngle(heading - state.heading), 7, dt)
  }

  function startZoomies() {
    state.lastZoomies = time
    const spot = randomSpot()
    state.activity = { kind: 'zoomies', left: Math.round(random(3, 6)), ...spot, leap: Math.random() < 0.45 }
  }

  function decide() {
    const idle = time - state.lastTouch
    // 越好动换事越勤
    state.decideAt = time + random(2, 5) * (1.6 - traits.activity)
    if (state.posture === 'sleep') {
      if (time < state.sleepUntil) {
        return
      }
      rest('stretch', 1.6)
      return
    }
    if (time < state.postureUntil) {
      return
    }
    if (state.posture === 'stretch') {
      rest('sit')
      return
    }
    const resting = time - pointer.restAt < 10 && pointer.inside
    if (resting && Math.random() < traits.affection * 0.45) {
      const point = floorAt(pointer.restX, pointer.restY)
      if (point && Math.hypot(point.x - state.x, point.z - state.z) > 45) {
        const away = Math.atan2(state.z - point.z, state.x - point.x)
        go(point.x + Math.cos(away) * 24, point.z + Math.sin(away) * 24, speeds.walk, 'sit')
        return
      }
    }
    if (state.posture === 'loaf' && idle > THREE.MathUtils.lerp(90, 30, traits.sleepiness) && Math.random() < traits.sleepiness) {
      state.posture = 'sleep'
      state.sleepUntil = time + random(40, 120)
      return
    }
    // 各种事按脾气加权抽一件
    const spot = randomSpot()
    const choices: [number, () => void][] = [
      [0.22 * traits.activity * 1.6, () => go(spot.x, spot.z, speeds.walk, Math.random() < 0.6 ? 'sit' : 'loaf', facingViewer())],
      [0.11 * traits.activity * 1.6, () => go(spot.x, spot.z, speeds.trot, 'sit', facingViewer())],
      [time - state.lastZoomies > 20 ? 0.08 * traits.playfulness * 1.6 : 0, startZoomies],
      [
        0.08 * traits.playfulness * 1.6,
        () => {
          // 扑一个看不见的小虫子
          const distance = random(50, 100)
          const angle = state.heading + random(-0.6, 0.6)
          state.activity = { kind: 'hunt', toy: { x: clampX(state.x + Math.cos(angle) * distance), z: clampZ(state.z - Math.sin(angle) * distance) } }
        },
      ],
      [0.05 * traits.playfulness * 1.6, hop],
      [0.04, () => rest('stretch', 1.6)],
      [0.18, () => rest('sit')],
      [0.14 * (0.6 + traits.sleepiness * 0.8), () => rest('loaf')],
      [0.1, () => rest('stand')],
    ]
    let roll = Math.random() * choices.reduce((sum, [weight]) => sum + weight, 0)
    for (const [weight, action] of choices) {
      roll -= weight
      if (roll <= 0) {
        action()
        return
      }
    }
  }

  // 原地蹦一下，顺便转个身
  function hop() {
    const angle = state.heading + random(-1, 1)
    jump(state.x + Math.cos(angle) * 12, state.z - Math.sin(angle) * 12, random(12, 20), { crouch: 0.18 })
  }

  // 每帧：地面上想去哪里、多快
  function steer(dt: number) {
    let targetX = state.x
    let targetZ = state.z
    let speed = 0
    let face: number | undefined
    const activity = state.activity
    if (activity.kind === 'go' || activity.kind === 'zoomies') {
      targetX = activity.x
      targetZ = activity.z
      speed = activity.kind === 'go' ? activity.speed : speeds.run
      face = activity.kind === 'go' ? activity.face : undefined
    } else if (activity.kind === 'hunt') {
      const prey = activity.toy ?? (pointer.inside ? pointerFloor() : undefined)
      if (!prey || (!activity.toy && time > state.excitedUntil)) {
        rest('sit')
      } else {
        targetX = prey.x
        targetZ = prey.z
        const distance = Math.hypot(prey.x - state.x, prey.z - state.z)
        speed = distance > 170 ? speeds.run : distance > 75 ? speeds.trot : 0
        if (distance <= 75 && state.speed < 70 && time > state.huntRestAt) {
          // 够近了：压低身子扭扭屁股，扑过去
          const reach = Math.min(100, Math.max(30, distance - 12))
          const angle = Math.atan2(-(prey.z - state.z), prey.x - state.x)
          jump(state.x + Math.cos(angle) * reach, state.z - Math.sin(angle) * reach, 12 + reach * 0.09, { crouch: random(0.45, 0.9), wiggle: true })
          state.huntRestAt = time + 0.9
          if (activity.toy) {
            state.activity = { kind: 'rest' }
            state.posture = 'stand'
            state.postureUntil = time + 1.6
            state.decideAt = time + 1.6
          }
          return
        }
      }
    }

    const dx = targetX - state.x
    const dz = targetZ - state.z
    const distance = Math.hypot(dx, dz)
    // 坐着趴着要先站起来再走
    const standing = state.pose.hipsY > 17.5 && Math.abs(state.pose.pitch) < 0.2
    let desired = distance > 3 ? Math.atan2(-dz, dx) : (face ?? state.heading)
    if (activity.kind === 'hunt' && distance <= 75) {
      desired = Math.atan2(-dz, dx)
    }
    let diff = wrapAngle(desired - state.heading)
    // 目标几乎在正后方时，往左往右差不多远：沿着已经在转的方向转下去，不左右来回抽
    if (Math.abs(diff) > 2.6 && state.turnSign !== 0 && Math.sign(diff) !== state.turnSign) {
      diff += state.turnSign * Math.PI * 2
    }
    rotate(standing || speed === 0 ? diff : 0, state.speed > 150 ? 3 : 3.8, dt)
    state.turnSign = Math.abs(state.turnRate) > 0.05 ? Math.sign(state.turnRate) : Math.abs(diff) < 0.05 ? 0 : state.turnSign
    let wanted = 0
    if (standing && distance > 3) {
      // 方向不对先减速转弯；快到时按能刹住的速度减速
      wanted = Math.min(speed * Math.max(0.15, Math.cos(diff)) ** 2, Math.sqrt(2 * 520 * Math.max(0, distance - 3)))
    }
    state.speed = toward(state.speed, wanted, (wanted > state.speed ? 420 : 650) * dt)

    // 跑着跑着腾空一跃
    if ((activity.kind === 'zoomies' || (activity.kind === 'go' && activity.leap)) && activity.leap && state.speed > 180 && distance > 110 && distance < 170) {
      const flight = 0.42
      const reach = state.speed * flight
      jump(state.x + Math.cos(state.heading) * reach, state.z - Math.sin(state.heading) * reach, (gravity * flight * flight) / 8, { carry: true })
      activity.leap = false
      return
    }

    if (distance <= 3 && state.speed < 12 && Math.abs(diff) < 0.12) {
      if (activity.kind === 'go') {
        rest(activity.then)
      } else if (activity.kind === 'zoomies') {
        if (activity.left <= 1) {
          rest(Math.random() < 0.5 ? 'sit' : 'loaf')
        } else {
          state.activity = { ...activity, left: activity.left - 1, ...randomSpot(), leap: Math.random() < 0.45 }
        }
      }
    }
    // 疯跑时不用每次都停下来，快到目标就换下一个
    if (activity.kind === 'zoomies' && distance < 40 && activity.left > 1) {
      state.activity = { ...activity, left: activity.left - 1, ...randomSpot(), leap: Math.random() < 0.45 }
    }
  }

  function groundLegs(pose: Pose, dt: number) {
    const effort = Math.max(state.speed, Math.abs(state.turnRate) * 12)
    const weights = gaitWeights(state.speed)
    state.amount = approach(state.amount, effort > 2 ? 1 : 0, 9, dt)
    // 原地转身时步子小
    const sweepScale = Math.min(1, Math.max(0.35, effort / 22))
    const frequency = Math.max(effort > 2 ? 0.9 : 0, cadence(Math.max(state.speed, effort), weights) / sweepScale)
    if (state.amount > 0.02) {
      state.phase = (state.phase + dt * frequency) % 1
    }
    state.tailClock += dt * tailRate(weights, state.amount)
    return { legs: legTargets(pose, state.phase, weights, state.amount, sweepScale), body: bodyMotion(state.phase, weights, state.amount), weights }
  }

  // 腾空时：起跳时后腿往后蹬直，前腿收起；空中前腿伸向前下方准备落地，后腿收回来
  function airLegs(pose: Pose, a: number): Record<LegName, LegTarget> {
    const result = {} as Record<LegName, LegTarget>
    const tuck = smoothstep(0.15, 0.7, a)
    for (const name of legNames) {
      const side = name.startsWith('left') ? 0.6 : -0.6
      if (name.endsWith('Front')) {
        result[name] = { x: pose.front + 5 + a * 8 + side, y: 9 - smoothstep(0.45, 1, a) * 7.5, fold: Math.max(0, 0.8 - a * 2), push: 0, reach: 1 + a * 3 }
      } else {
        result[name] = { x: pose.hind - 15 * (1 - tuck) + tuck * 5 + side, y: 4 + tuck * 5, fold: tuck * 0.6, push: 1 - smoothstep(0, 0.3, a), reach: 0 }
      }
    }
    return result
  }

  function dangleLegs(pose: Pose): Record<LegName, LegTarget> {
    const result = {} as Record<LegName, LegTarget>
    for (const name of legNames) {
      const front = name.endsWith('Front')
      // 被拎着时腿垂直往下，偶尔蹬两下
      const kick = Math.sin(time * 6 + (front ? 0 : 1.7) + (name.startsWith('left') ? 0 : 3.1)) * 2.5 * smoothstep(0.3, 1, Math.sin(time * 0.9))
      result[name] = { x: (front ? pose.front : pose.hind) + kick, y: -16, fold: 0, push: 0, reach: 0 }
    }
    return result
  }

  function step(dt: number) {
    // 抚摸
    if (state.stroke > 0) {
      state.pet = Math.min(1, state.pet + state.stroke * 0.005 * (0.5 + traits.affection))
      state.stroke = 0
      state.lastTouch = time
    }
    state.pet = Math.max(0, state.pet - dt * 0.16)
    const grounded = state.motion.kind === 'ground'
    const petting = grounded ? smoothstep(0.15, 0.55, state.pet) : 0
    purr.set(petting)
    if (petting > 0.3 && state.activity.kind !== 'rest') {
      rest('sit')
    }
    if (state.pet > 0.9 && state.posture === 'sit') {
      state.posture = 'loaf'
    }

    // 鼠标飞快地晃来晃去：开始追
    const excited = time < state.excitedUntil
    if (excited && grounded && state.posture !== 'sleep' && state.activity.kind !== 'hunt' && state.activity.kind !== 'zoomies') {
      state.activity = { kind: 'hunt' }
    }
    if (grounded && state.activity.kind === 'rest' && time > state.decideAt && petting < 0.1) {
      decide()
    }

    let targetPose: Pose = poses[state.posture]
    let legs: Record<LegName, LegTarget>
    let body: BodyMotion
    let poseRate = 2.8
    const motion = state.motion
    switch (motion.kind) {
      case 'ground': {
        steer(dt)
        if (state.motion.kind !== 'ground') {
          return step(0)
        }
        const moving = state.activity.kind !== 'rest' || state.speed > 1
        if (moving) {
          targetPose = poses.walk
          poseRate = 6
        }
        state.x = clampX(state.x + Math.cos(state.heading) * state.speed * dt)
        state.z = clampZ(state.z - Math.sin(state.heading) * state.speed * dt)
        const ground = groundLegs(state.pose, dt)
        legs = ground.legs
        body = ground.body
        // 跑起来压低身子
        targetPose = { ...targetPose, hipsY: targetPose.hipsY - ground.weights.gallop * 0.8, neckPitch: targetPose.neckPitch + ground.weights.gallop * 0.25, tailLift: targetPose.tailLift + ground.weights.gallop * 0.15 }
        break
      }
      case 'crouch': {
        state.speed = toward(state.speed, 0, 900 * dt)
        state.x = clampX(state.x + Math.cos(state.heading) * state.speed * dt)
        state.z = clampZ(state.z - Math.sin(state.heading) * state.speed * dt)
        targetPose = motion.wiggle ? poses.stalk : poses.crouch
        poseRate = 9
        const ground = groundLegs(state.pose, dt)
        legs = ground.legs
        body = { ...stillBody, tailPhase: state.tailClock }
        if (motion.wiggle) {
          // 扑之前屁股左右扭，尾巴尖抖
          const envelope = Math.sin(Math.PI * Math.min(1, (time - motion.from) / (motion.until - motion.from)))
          body.yaw = Math.sin(time * 18) * 0.06 * envelope
          body.roll = Math.sin(time * 18) * 0.04 * envelope
          body.tailSway = 0.12
          state.tailClock += dt * 9
        }
        turnToward(motion.jump.heading, dt)
        if (time >= motion.until) {
          state.motion = { kind: 'air', jump: motion.jump, t: 0 }
        }
        break
      }
      case 'air': {
        motion.t += dt
        const { jump: arc } = motion
        const a = Math.min(1, motion.t / arc.duration)
        turnToward(arc.heading, dt)
        state.x = clampX(THREE.MathUtils.lerp(arc.fromX, arc.toX, a))
        state.z = clampZ(THREE.MathUtils.lerp(arc.fromZ, arc.toZ, a))
        state.y = 4 * arc.height * a * (1 - a)
        targetPose = poses.stand
        poseRate = 10
        legs = airLegs(state.pose, a)
        state.tailClock += dt * 3
        body = { ...stillBody, pitch: 0.3 * Math.sin(Math.PI * 2 * a), flex: 0.2 * Math.sin(Math.PI * a), tailSway: 0.1, tailPhase: state.tailClock }
        if (a >= 1) {
          state.y = 0
          state.speed = arc.carry ? Math.hypot(arc.toX - arc.fromX, arc.toZ - arc.fromZ) / arc.duration : 0
          state.motion = arc.carry ? { kind: 'ground' } : { kind: 'land', until: time + 0.22 }
        }
        break
      }
      case 'land': {
        targetPose = poses.crouch
        poseRate = 12
        const ground = groundLegs(state.pose, dt)
        legs = ground.legs
        body = ground.body
        if (time >= motion.until) {
          state.motion = { kind: 'ground' }
        }
        break
      }
      case 'held': {
        targetPose = poses.dangle
        poseRate = 8
        const rect = surface.getBoundingClientRect()
        raycaster.setFromCamera(ndc(pointer.x + rect.left, pointer.y + rect.top), camera)
        const grab = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -state.z), new THREE.Vector3())
        if (grab) {
          state.x = clampX(grab.x - Math.cos(state.heading) * 8)
          state.y = Math.max(0, grab.y - 31)
        }
        state.swing = approach(state.swing, Math.max(-0.4, Math.min(0.4, -pointer.vx * 0.0006)), 5, dt)
        legs = dangleLegs(state.pose)
        state.tailClock += dt * 2
        body = { ...stillBody, roll: state.swing * Math.sin(state.heading), pitch: state.swing * Math.cos(state.heading), tailSway: 0.15, tailPhase: state.tailClock }
        break
      }
      case 'fall': {
        motion.vy -= gravity * dt
        state.y = Math.max(0, state.y + motion.vy * dt)
        targetPose = poses.stand
        poseRate = 10
        legs = airLegs(state.pose, 0.85)
        body = { ...stillBody, tailPhase: state.tailClock }
        if (state.y <= 0) {
          state.motion = { kind: 'land', until: time + 0.25 }
          state.x = clampX(state.x)
          state.speed = 0
          // 被放下来以后，有时候一溜烟跑掉
          if (Math.random() < 0.45) {
            const spot = randomSpot()
            go(spot.x, spot.z, speeds.run, 'sit', facingViewer())
          } else {
            rest('sit')
          }
        }
        break
      }
    }

    for (const key of Object.keys(targetPose) as (keyof Pose)[]) {
      if (key === 'eyes') {
        state.pose[key] = approach(state.pose[key], targetPose[key], 6, dt)
        continue
      }
      // 临界阻尼的弹簧：姿势变化从静止起步、平稳停下，速度连续，不会一开始就猛地一甩
      const omega = poseRate * 1.6
      const velocity = (state.poseVelocity[key] ?? 0) + (omega * omega * (targetPose[key] - state.pose[key]) - 2 * omega * (state.poseVelocity[key] ?? 0)) * dt
      state.poseVelocity[key] = velocity
      state.pose[key] += velocity * dt
    }
    // 尾巴摆动的幅度在状态之间渐变，不突然变大变小
    state.tailSway = approach(state.tailSway, body.tailSway, 4, dt)
    body.tailSway = state.tailSway
    // 换动作的一瞬间（蹲下、腾空、落地、被拎起），身体和四条腿从上一刻的样子过渡过去，不跳
    if (state.motion.kind !== fade.kind) {
      fade.kind = state.motion.kind
      fade.from = time
      fade.legs = fade.lastLegs
      fade.body = fade.lastBody
    }
    const blend = smoothstep(0, 0.18, time - fade.from)
    if (blend < 1 && fade.legs && fade.body) {
      const from = fade.body
      body = { ...body, bob: lerp(from.bob, body.bob, blend), pitch: lerp(from.pitch, body.pitch, blend), roll: lerp(from.roll, body.roll, blend), yaw: lerp(from.yaw, body.yaw, blend), flex: lerp(from.flex, body.flex, blend) }
      const mixed = {} as Record<LegName, LegTarget>
      for (const name of legNames) {
        const a = fade.legs[name]
        const b = legs[name]
        mixed[name] = { x: lerp(a.x, b.x, blend), y: lerp(a.y, b.y, blend), fold: lerp(a.fold, b.fold, blend), push: lerp(a.push, b.push, blend), reach: lerp(a.reach, b.reach, blend) }
      }
      legs = mixed
    }
    fade.lastLegs = legs
    fade.lastBody = body
    state.body = body
    if (state.motion.kind === 'ground' || state.motion.kind === 'land') {
      body.tailPhase = state.tailClock
    }

    // 看哪里
    const head = new THREE.Vector3(state.x, state.y + 26, state.z)
    const headScreen = toScreen(head)
    const near = pointer.inside && Math.hypot(pointer.x - headScreen.x, pointer.y - headScreen.y) < 420
    const awake = state.posture !== 'sleep' || state.activity.kind !== 'rest'
    let gaze: THREE.Vector3 | null = null
    if (awake && ((near && time - pointer.movedAt < 3) || state.activity.kind === 'hunt')) {
      gaze = pointerTarget(head)
    } else if (awake) {
      if (time > state.gazeUntil) {
        const roll = Math.random()
        state.gaze = roll < 0.4 ? null : roll < 0.75 ? head.clone().add(view.clone().multiplyScalar(200)) : head.clone().add(new THREE.Vector3(random(-200, 200), random(-20, 40), random(-200, 200)))
        state.gazeUntil = time + random(1.5, 4.5)
      }
      gaze = state.gaze
    }
    let yaw = 0
    let pitch = 0
    if (gaze) {
      const limit = state.speed > 40 || state.motion.kind !== 'ground' ? 0.45 : 1.25
      const local = gaze.clone().sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), -state.heading)
      yaw = Math.max(-limit, Math.min(limit, Math.atan2(-local.z, local.x)))
      pitch = Math.max(-0.5, Math.min(0.6, Math.atan2(local.y, Math.hypot(local.x, local.z)))) * (limit > 1 ? 1 : 0.3)
    }
    state.look.yaw = approach(state.look.yaw, yaw, 6, dt)
    state.look.pitch = approach(state.look.pitch, pitch, 6, dt)

    // 眼睛：眨眼、被摸时眯起来、兴奋时瞳孔放大
    let eyes = state.pose.eyes * (1 - petting * 0.62)
    if (time > state.blinkAt) {
      const t = (time - state.blinkAt) / 0.17
      if (t >= 1) {
        state.blinkAt = time + random(2.5, 7)
      } else {
        eyes *= 1 - Math.sin(t * Math.PI)
      }
    }
    const thrilled = state.activity.kind === 'hunt' || state.activity.kind === 'zoomies' || state.motion.kind === 'crouch' || state.motion.kind === 'held'
    state.pupil = approach(state.pupil, petting > 0.2 ? 0.18 : thrilled ? 0.85 : 0.3, 4, dt)
    cat.setPupil(state.pupil)
    state.earTwitch = approach(state.earTwitch, 0, 7, dt)
    if (Math.random() < dt * 0.1) {
      state.earTwitch = 1
      state.earSide = Math.random() < 0.5 ? 1 : -1
    }
    cat.twitchEar(state.earSide, state.earTwitch)

    const breathRate = state.posture === 'sleep' ? 0.22 : state.activity.kind === 'zoomies' ? 0.9 : 0.38
    const breath = Math.sin(time * Math.PI * 2 * breathRate)
    cat.root.position.set(state.x, state.y, state.z)
    cat.root.rotation.y = state.heading
    cat.apply({ ...state.pose, eyes }, legs, body, state.look, time, breath, dt)
    const lying = smoothstep(16, 9, state.pose.hipsY)
    const lift = Math.max(0, 1 - state.y / 90)
    shadow.position.y = 0.05 - state.y
    shadow.scale.set((46 + lying * 6) * (0.6 + lift * 0.4), 1, (26 + lying * 8) * (0.6 + lift * 0.4))
    shadow.material.opacity = 0.35 + lift * 0.65
    shadow.position.x = state.pose.hipsX + 11 + state.pose.pitch * 4

    const activity = state.activity
    memory = { x: state.x, z: state.z, heading: state.heading, posture: activity.kind === 'go' ? activity.then : state.posture }
  }

  // 点一下猫：叫醒、蹦一下、吓一跳往后跳；连点三下就跑开
  function poke() {
    state.lastTouch = time
    state.earTwitch = 1
    state.earSide = Math.random() < 0.5 ? 1 : -1
    state.gazeUntil = 0
    if (state.posture === 'sleep') {
      rest('stretch', 1.6)
      return
    }
    state.clicks = [...state.clicks.filter((at) => time - at < 3), time]
    if (state.clicks.length >= 3) {
      state.clicks = []
      const spot = randomSpot()
      go(spot.x, spot.z, speeds.run, 'loaf', facingViewer(), true)
      return
    }
    const roll = Math.random()
    if (roll < 0.45) {
      hop()
    } else if (roll < 0.7) {
      const angle = state.heading + Math.PI + random(-0.5, 0.5)
      // 吓得往后跳，脸还朝着原来的方向
      jump(state.x + Math.cos(angle) * 45, state.z - Math.sin(angle) * 45, 22, { crouch: 0.08, face: state.heading })
    }
  }

  // 输入：鼠标划过猫身上算抚摸，按住拖动能把猫拎起来，在桌面空白处点一下它会跑过去扑
  function onPointerMove(event: PointerEvent) {
    const rect = surface.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const moved = Math.hypot(x - pointer.x, y - pointer.y)
    const now = performance.now() / 1000
    const elapsed = Math.max(1 / 120, now - pointer.eventAt)
    pointer.speed = approach(pointer.speed, moved / elapsed, 0.5, 1)
    pointer.vx = approach(pointer.vx, (x - pointer.x) / elapsed, 0.5, 1)
    pointer.eventAt = now
    pointer.inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height
    if (Math.hypot(x - pointer.restX, y - pointer.restY) > 30) {
      pointer.restX = x
      pointer.restY = y
      pointer.restAt = Infinity
    }
    pointer.x = x
    pointer.y = y
    pointer.movedAt = time
    if (pointer.inside && pointer.speed > 1100 && state.motion.kind !== 'held') {
      state.excitedUntil = time + 2.5
    }
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6 && state.motion.kind !== 'held') {
      state.motion = { kind: 'held' }
      state.activity = { kind: 'rest' }
      state.posture = 'stand'
      state.speed = 0
      state.lastTouch = time
    }
    if (state.motion.kind === 'held') {
      return
    }
    const hit = pointer.inside && hits(event.clientX, event.clientY)
    if (hit && event.buttons === 0) {
      state.stroke += Math.min(moved, 60)
    }
    if (event.pointerType === 'mouse' && hit !== state.hover) {
      state.hover = hit
      canvas.style.pointerEvents = hit ? 'auto' : ''
    }
  }

  let swallowClick = false
  function onPointerDown(event: PointerEvent) {
    if (!hits(event.clientX, event.clientY)) {
      const target = event.target as Element | null
      // 点在桌面空白处：像扔了个玩具，猫跑过去扑
      if (event.button === 0 && target && !target.closest('button, a, input, textarea, select, [role="button"], [contenteditable]')) {
        const rect = surface.getBoundingClientRect()
        const point = floorAt(event.clientX - rect.left, event.clientY - rect.top)
        if (point && state.posture !== 'sleep' && state.motion.kind === 'ground') {
          state.activity = { kind: 'hunt', toy: { x: clampX(point.x), z: clampZ(point.z) } }
          state.lastTouch = time
        }
      }
      return
    }
    event.stopPropagation()
    event.preventDefault()
    swallowClick = true
    press = { x: event.clientX, y: event.clientY, at: time }
  }

  function onPointerUp() {
    if (!press) {
      return
    }
    press = undefined
    if (state.motion.kind === 'held') {
      state.motion = { kind: 'fall', vy: 0 }
      return
    }
    if (state.motion.kind === 'ground') {
      poke()
    }
  }

  function onClick(event: MouseEvent) {
    if (swallowClick) {
      swallowClick = false
      event.stopPropagation()
      event.preventDefault()
    }
  }

  function onPointerLeave() {
    pointer.inside = false
  }

  // 鼠标停在一处不动，过一会儿猫可能会过去看看
  const restTimer = window.setInterval(() => {
    if (pointer.inside && pointer.restAt === Infinity && time - pointer.movedAt > 1.5) {
      pointer.restAt = time
    }
  }, 500)

  const observer = new ResizeObserver(resize)
  observer.observe(surface)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  surface.addEventListener('pointerdown', onPointerDown, true)
  surface.addEventListener('click', onClick, true)
  document.documentElement.addEventListener('pointerleave', onPointerLeave)

  let time = 0
  let last = performance.now()
  resize()
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    time += dt
    step(dt)
    renderer.render(scene, camera)
  })

  return () => {
    renderer.setAnimationLoop(null)
    observer.disconnect()
    window.clearInterval(restTimer)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    surface.removeEventListener('pointerdown', onPointerDown, true)
    surface.removeEventListener('click', onClick, true)
    document.documentElement.removeEventListener('pointerleave', onPointerLeave)
    purr.dispose()
    cat.dispose()
    shadow.material.map?.dispose()
    renderer.dispose()
  }
}

// 身体下面一团柔和的影子，让猫贴在桌面上
function groundShadow() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(0,0,0,0.42)')
  gradient.addColorStop(0.55, 'rgba(0,0,0,0.2)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }))
  mesh.position.y = 0.05
  mesh.renderOrder = -1
  return mesh
}
