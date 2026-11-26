import * as THREE from 'three'
import { light } from './fur.ts'
import { CatModel, poses } from './model.ts'
import type { Gait, Look, Pose, Posture } from './model.ts'
import { smoothstep } from './noise.ts'
import { Purr } from './purr.ts'

// 俯视地面的角度：既能看清侧面，往屏幕上方走也有纵深
const elevation = 0.38
const walkSpeed = 26
const stride = 15

// 离开桌面再回来时接着上次的位置和姿势
let memory: { x: number; z: number; heading: number; posture: Posture } | undefined

type Plan = { kind: 'rest' } | { kind: 'walk'; x: number; z: number; then: Posture; face?: number }

export function startPet(canvas: HTMLCanvasElement, surface: HTMLElement) {
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

  const cat = new CatModel()
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
    z: saved?.z ?? 0,
    heading: saved?.heading ?? -Math.PI / 2 + 0.7,
    speed: 0,
    posture: saved?.posture ?? ('sit' as Posture),
    plan: { kind: 'rest' } as Plan,
    decideAt: 3,
    sleepUntil: 0,
    pose: { ...poses[saved?.posture ?? 'sit'] } as Pose,
    gait: { phase: 0, amount: 0, stride } as Gait,
    look: { yaw: 0, pitch: 0 } as Look,
    gaze: null as THREE.Vector3 | null,
    gazeUntil: 0,
    pet: 0,
    stroke: 0,
    lastTouch: 0,
    clicks: [] as number[],
    pupil: 0.3,
    blinkAt: 2,
    earTwitch: 0,
    earSide: 1,
    hover: false,
  }
  const pointer = { inside: false, x: 0, y: 0, movedAt: -10, eventAt: 0, restAt: -10, restX: 0, restY: 0, speed: 0 }

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
    state.x = Math.min(bounds.right, Math.max(bounds.left, state.x))
    state.z = Math.min(bounds.near, Math.max(bounds.far, state.z))
  }

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
    const center = toScreen(new THREE.Vector3(state.x, 15, state.z))
    if (Math.hypot(clientX - rect.left - center.x, clientY - rect.top - center.y) > 60 * scale) {
      return false
    }
    raycaster.setFromCamera(ndc(clientX, clientY), camera)
    return raycaster.intersectObjects(cat.hitTargets, false).length > 0
  }

  function toScreen(point: THREE.Vector3) {
    const projected = point.clone().project(camera)
    return { x: (projected.x + 1) / 2 * width, y: (1 - projected.y) / 2 * height }
  }

  // 鼠标在屏幕上，相当于贴在玻璃上：取视线上离猫头最近的点
  function pointerTarget(head: THREE.Vector3) {
    const rect = surface.getBoundingClientRect()
    raycaster.setFromCamera(ndc(pointer.x + rect.left, pointer.y + rect.top), camera)
    return raycaster.ray.closestPointToPoint(head, new THREE.Vector3())
  }

  function walkTo(x: number, z: number, then: Posture, face?: number) {
    state.plan = {
      kind: 'walk',
      x: Math.min(bounds.right, Math.max(bounds.left, x)),
      z: Math.min(bounds.near, Math.max(bounds.far, z)),
      then,
      face,
    }
  }

  // 朝向镜头偏一点的角度最好看
  const facingViewer = () => -Math.PI / 2 + (Math.random() < 0.5 ? -1 : 1) * random(0.5, 1.1)

  function decide() {
    const idle = time - state.lastTouch
    state.decideAt = time + random(5, 12)
    if (state.posture === 'sleep') {
      if (time < state.sleepUntil) {
        return
      }
      state.posture = 'loaf'
      return
    }
    const resting = time - pointer.restAt < 10 && pointer.inside
    if (resting && Math.random() < 0.55) {
      const point = floorAt(pointer.restX, pointer.restY)
      if (point && Math.hypot(point.x - state.x, point.z - state.z) > 45) {
        const away = Math.atan2(state.z - point.z, state.x - point.x)
        walkTo(point.x + Math.cos(away) * 22, point.z + Math.sin(away) * 22, 'sit')
        return
      }
    }
    const roll = Math.random()
    if (state.posture === 'loaf' && idle > 40 && roll < 0.6) {
      state.posture = 'sleep'
      state.sleepUntil = time + random(40, 120)
      return
    }
    if (roll < 0.38) {
      walkTo(random(bounds.left, bounds.right), random(bounds.far, bounds.near), Math.random() < 0.6 ? 'sit' : 'loaf', facingViewer())
    } else if (roll < 0.65) {
      state.posture = 'sit'
    } else if (roll < 0.88) {
      state.posture = 'loaf'
    } else {
      state.posture = 'stand'
    }
  }

  const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))
  const approach = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt))

  function step(dt: number) {
    // 抚摸
    if (state.stroke > 0) {
      state.pet = Math.min(1, state.pet + state.stroke * 0.005)
      state.stroke = 0
      state.lastTouch = time
    }
    state.pet = Math.max(0, state.pet - dt * 0.16)
    const petting = smoothstep(0.15, 0.55, state.pet)
    purr.set(petting)
    if (petting > 0.3 && state.plan.kind === 'walk') {
      state.plan = { kind: 'rest' }
      state.posture = 'sit'
    }
    if (state.pet > 0.9 && state.posture === 'sit') {
      state.posture = 'loaf'
    }

    if (state.plan.kind === 'rest' && time > state.decideAt && petting < 0.1) {
      decide()
    }

    // 走路：先站起来，转向目标，走到后转向想要的朝向
    let targetPose: Pose = poses[state.posture]
    let speed = 0
    let turning = 0
    const plan = state.plan
    if (plan.kind === 'walk') {
      targetPose = poses.walk
      const standing = state.pose.hipsY > 19 && state.pose.pitch < 0.15
      const dx = plan.x - state.x
      const dz = plan.z - state.z
      const distance = Math.hypot(dx, dz)
      if (standing) {
        let desired = Math.atan2(-dz, dx)
        if (distance < 4) {
          desired = plan.face ?? state.heading
        }
        const diff = wrapAngle(desired - state.heading)
        turning = Math.max(-2.2 * dt, Math.min(2.2 * dt, diff))
        state.heading += turning
        if (distance >= 4) {
          speed = walkSpeed * Math.max(0, Math.cos(diff)) ** 2 * Math.min(1, distance / 18)
        } else if (Math.abs(diff) < 0.12) {
          state.plan = { kind: 'rest' }
          state.posture = plan.then
          state.decideAt = time + random(6, 14)
        }
      }
    }
    state.speed = approach(state.speed, speed, 6, dt)
    state.x += Math.cos(state.heading) * state.speed * dt
    state.z -= Math.sin(state.heading) * state.speed * dt
    const effort = Math.max(state.speed, (Math.abs(turning) / Math.max(dt, 1e-4)) * 9)
    state.gait.amount = approach(state.gait.amount, effort > 1.5 ? 1 : 0, 5, dt)
    state.gait.stride = Math.min(stride, Math.max(7, effort * 0.55))
    state.gait.phase = (state.gait.phase + dt * (0.66 * Math.max(effort, 4)) / state.gait.stride * (state.gait.amount > 0.05 ? 1 : 0)) % 1

    for (const key of Object.keys(targetPose) as (keyof Pose)[]) {
      state.pose[key] = approach(state.pose[key], targetPose[key], key === 'eyes' ? 6 : 2.6, dt)
    }

    // 看哪里
    const head = new THREE.Vector3(state.x, 26, state.z)
    const headScreen = toScreen(head)
    const near = pointer.inside && Math.hypot(pointer.x - headScreen.x, pointer.y - headScreen.y) < 420
    let gaze: THREE.Vector3 | null = null
    if (state.posture !== 'sleep' && near && time - pointer.movedAt < 3) {
      gaze = pointerTarget(head)
    } else if (state.posture !== 'sleep') {
      if (time > state.gazeUntil) {
        const roll = Math.random()
        state.gaze = roll < 0.4 ? null : roll < 0.75 ? head.clone().add(view.clone().multiplyScalar(200)) : head.clone().add(new THREE.Vector3(random(-200, 200), random(-20, 40), random(-200, 200)))
        state.gazeUntil = time + random(2, 6)
      }
      gaze = state.gaze
    }
    let yaw = 0
    let pitch = 0
    if (gaze && state.plan.kind === 'rest') {
      const local = gaze.clone().sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), -state.heading)
      yaw = Math.max(-1.25, Math.min(1.25, Math.atan2(-local.z, local.x)))
      pitch = Math.max(-0.5, Math.min(0.6, Math.atan2(local.y, Math.hypot(local.x, local.z))))
    } else if (gaze) {
      const local = gaze.clone().sub(head).applyAxisAngle(new THREE.Vector3(0, 1, 0), -state.heading)
      yaw = Math.max(-0.5, Math.min(0.5, Math.atan2(-local.z, local.x)))
    }
    state.look.yaw = approach(state.look.yaw, yaw, 4, dt)
    state.look.pitch = approach(state.look.pitch, pitch, 4, dt)

    // 眼睛：眨眼、被摸时眯起来、看到鼠标乱晃时瞳孔放大
    let eyes = state.pose.eyes * (1 - petting * 0.62)
    if (time > state.blinkAt) {
      const t = (time - state.blinkAt) / 0.17
      if (t >= 1) {
        state.blinkAt = time + random(2.5, 7)
      } else {
        eyes *= 1 - Math.sin(t * Math.PI)
      }
    }
    const excited = near && pointer.speed > 900 ? 0.8 : 0.3
    state.pupil = approach(state.pupil, petting > 0.2 ? 0.18 : excited, 3, dt)
    cat.setPupil(state.pupil)
    state.earTwitch = approach(state.earTwitch, 0, 7, dt)
    if (Math.random() < dt * 0.08) {
      state.earTwitch = 1
      state.earSide = Math.random() < 0.5 ? 1 : -1
    }
    cat.twitchEar(state.earSide, state.earTwitch)

    const breathRate = state.posture === 'sleep' ? 0.22 : 0.38
    const breath = Math.sin(time * Math.PI * 2 * breathRate)
    cat.root.position.set(state.x, 0, state.z)
    cat.root.rotation.y = state.heading
    cat.apply({ ...state.pose, eyes }, state.gait, state.look, time, breath)
    const lying = smoothstep(16, 9, state.pose.hipsY)
    shadow.scale.set(46 + lying * 6, 1, 26 + lying * 8)
    shadow.position.x = state.pose.hipsX + 11 + state.pose.pitch * 4

    memory = { x: state.x, z: state.z, heading: state.heading, posture: state.plan.kind === 'walk' ? state.plan.then : state.posture }
  }

  // 输入：鼠标划过猫身上算抚摸，点一下能叫醒或者惹它
  function onPointerMove(event: PointerEvent) {
    const rect = surface.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const moved = Math.hypot(x - pointer.x, y - pointer.y)
    const now = performance.now() / 1000
    pointer.speed = approach(pointer.speed, moved / Math.max(1 / 120, now - pointer.eventAt), 0.5, 1)
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
    const hit = pointer.inside && hits(event.clientX, event.clientY)
    if (hit && (event.pointerType !== 'mouse' || event.buttons === 0 || event.buttons === 1)) {
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
      return
    }
    event.stopPropagation()
    event.preventDefault()
    swallowClick = true
    state.lastTouch = time
    state.earTwitch = 1
    state.earSide = Math.random() < 0.5 ? 1 : -1
    if (state.posture === 'sleep') {
      state.posture = 'loaf'
      state.decideAt = time + random(3, 6)
      return
    }
    state.clicks = [...state.clicks.filter(at => time - at < 3), time]
    state.gazeUntil = 0
    if (state.clicks.length >= 3) {
      state.clicks = []
      const angle = random(0, Math.PI * 2)
      walkTo(state.x + Math.cos(angle) * 120, state.z + Math.sin(angle) * 120, 'loaf', facingViewer())
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
