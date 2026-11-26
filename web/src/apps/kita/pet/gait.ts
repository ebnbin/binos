import type { BodyMotion, LegName, LegTarget, Pose } from './model.ts'
import { smoothstep } from './noise.ts'

// 猫的三种步态。phase 是一条腿在周期里的位置，0 着地；duty 是着地占周期的比例；sweep 是着地期间脚相对身体往后扫过的距离
// 慢走：左后、左前、右后、右前依次落地，任何时候至少两只脚着地
// 小跑：对角的两条腿同时落地
// 奔跑（旋转式跑步）：两条后腿先后蹬地，身体腾空伸展，两条前腿先后落地，再收拢后腿，脊柱一伸一屈
interface Spec {
  duty: number
  offsets: Record<LegName, number>
  sweep: number
  lift: { front: number; hind: number }
}

const specs = {
  walk: { duty: 0.64, offsets: { leftHind: 0, leftFront: 0.25, rightHind: 0.5, rightFront: 0.75 }, sweep: 14, lift: { front: 3.2, hind: 3.6 } },
  trot: { duty: 0.46, offsets: { leftHind: 0, rightFront: 0.02, rightHind: 0.5, leftFront: 0.52 }, sweep: 22, lift: { front: 5, hind: 5 } },
  gallop: { duty: 0.3, offsets: { leftHind: 0, rightHind: 0.09, leftFront: 0.47, rightFront: 0.56 }, sweep: 30, lift: { front: 7, hind: 8 } },
} satisfies Record<string, Spec>

type GaitName = keyof typeof specs
export type GaitWeights = Record<GaitName, number>

export const legNames: LegName[] = ['leftFront', 'leftHind', 'rightFront', 'rightHind']

// 按速度在步态之间平滑过渡（厘米每秒）
export function gaitWeights(speed: number): GaitWeights {
  const trot = smoothstep(42, 62, speed)
  const gallop = smoothstep(115, 150, speed)
  return { walk: 1 - trot, trot: trot * (1 - gallop), gallop }
}

// 步频：着地期间脚扫过 sweep 的时间，正好等于身体走过 sweep 的时间，脚就不会在地上打滑
export function cadence(speed: number, weights: GaitWeights) {
  let frequency = 0
  for (const name of Object.keys(specs) as GaitName[]) {
    const spec = specs[name]
    frequency += weights[name] * ((speed * spec.duty) / spec.sweep)
  }
  return frequency
}

function foot(spec: Spec, phase: number, front: boolean) {
  const { duty, sweep } = spec
  if (phase < duty) {
    const progress = phase / duty
    return { forward: sweep * (0.5 - progress), lift: 0, fold: 0, push: smoothstep(0.5, 1, progress) }
  }
  const swing = (phase - duty) / (1 - duty)
  return {
    forward: sweep * (-0.5 + smoothstep(0.05, 0.92, swing)),
    lift: (front ? spec.lift.front : spec.lift.hind) * Math.sin(Math.PI * Math.pow(swing, front ? 1 : 0.75)),
    // 前腿离地后手腕先往后翻，后腿脚腕往后折，到中段再伸开准备落地
    fold: Math.sin(Math.PI * Math.min(1, swing * (front ? 1.45 : 1.25))),
    push: 0,
  }
}

// amount：0 站着不动，1 完全按步态走
export function legTargets(pose: Pose, phase: number, weights: GaitWeights, amount: number, sweepScale: number): Record<LegName, LegTarget> {
  const result = {} as Record<LegName, LegTarget>
  for (const name of legNames) {
    const front = name.endsWith('Front')
    let forward = 0
    let lift = 0
    let fold = 0
    let push = 0
    for (const gait of Object.keys(specs) as GaitName[]) {
      const weight = weights[gait]
      if (weight === 0) {
        continue
      }
      const spec = specs[gait]
      const step = foot(spec, (phase + spec.offsets[name]) % 1, front)
      forward += step.forward * weight * sweepScale
      lift += step.lift * weight
      fold += step.fold * weight
      push += step.push * weight
    }
    result[name] = {
      x: (front ? pose.front : pose.hind) + forward * amount,
      y: 1.15 + lift * amount,
      fold: fold * amount,
      push: push * amount,
      // 肩胛骨跟着前腿前后滑动
      reach: front ? forward * amount * 0.35 : 0,
    }
  }
  return result
}

export function bodyMotion(phase: number, weights: GaitWeights, amount: number): BodyMotion {
  const turn = Math.PI * 2 * phase
  const gallop = weights.gallop * amount
  const bob = (Math.cos(turn * 2) * (0.35 * weights.walk + 0.9 * weights.trot) * amount) + gallop * (2.4 * Math.cos(2 * (turn - Math.PI * 2 * 0.43)) + 0.5)
  return {
    bob,
    // 后腿蹬地后抬头，前腿落地时低头
    pitch: gallop * 0.13 * Math.sin(turn - Math.PI * 2 * 0.2),
    roll: Math.sin(turn) * 0.035 * weights.walk * amount,
    yaw: Math.sin(turn) * 0.05 * (weights.walk + weights.trot * 0.5) * amount,
    // 伸展时前半身抬起，收拢时脊柱拱起
    flex: gallop * 0.22 * Math.cos(turn - Math.PI * 2 * 0.4),
    tailSway: 0.06 + amount * (0.05 + gallop * 0.12),
    tailPhase: 0,
  }
}

// 尾巴摆动的快慢，弧度每秒
export const tailRate = (weights: GaitWeights, amount: number) => 1.1 + amount * (1 + weights.gallop * 4)
