// 呼噜声：喉部每秒二十多次的短促振动，呼气时响、频率稍高，吸气时轻、频率稍低，中间有短暂停顿。
// 先按这个节律合成一段能无缝循环的振动，再经过共鸣滤波得到胸腔里闷闷的声音
const exhale = 1.35
const inhale = 1.05
const pause = 0.12
const cycles = 3

function vibration(context: BaseAudioContext) {
  const rate = context.sampleRate
  const cycle = exhale + inhale + pause * 2
  const length = Math.round(cycle * cycles * rate)
  const buffer = context.createBuffer(1, length, rate)
  const data = buffer.getChannelData(0)
  const pulse = (start: number, amplitude: number) => {
    const begin = Math.round(start * rate)
    const thump = 70 + Math.random() * 30
    for (let index = 0; index < 0.014 * rate; index++) {
      const t = index / rate
      const envelope = (1 - Math.exp(-t / 0.0007)) * Math.exp(-t / 0.0045)
      const value = (Math.sin(2 * Math.PI * thump * t) * 0.7 + (Math.random() * 2 - 1) * 0.55) * envelope * amplitude
      data[(begin + index) % length] += value
    }
  }
  for (let round = 0; round < cycles; round++) {
    const start = round * cycle
    const phases = [
      { from: start, duration: exhale, frequency: 26, loudness: 1 },
      { from: start + exhale + pause, duration: inhale, frequency: 22.5, loudness: 0.5 },
    ]
    for (const { from, duration, frequency, loudness } of phases) {
      for (let time = from; time < from + duration; time += (1 / frequency) * (0.93 + Math.random() * 0.14)) {
        const swell = Math.sin((Math.PI * (time - from)) / duration) ** 0.5
        pulse(time, loudness * swell * (0.75 + Math.random() * 0.5))
      }
      // 气流声
      for (let index = Math.round(from * rate); index < (from + duration) * rate; index++) {
        const swell = Math.sin((Math.PI * (index / rate - from)) / duration)
        data[index % length] += (Math.random() * 2 - 1) * 0.025 * loudness * swell
      }
    }
  }
  return buffer
}

// 振动经过胸腔、喉咙的共鸣，接到 destination 上，返回控制音量的节点
export function purrGraph(context: BaseAudioContext) {
  const source = context.createBufferSource()
  source.buffer = vibration(context)
  source.loop = true
  const highpass = context.createBiquadFilter()
  highpass.type = 'highpass'
  highpass.frequency.value = 35
  const chest = context.createBiquadFilter()
  chest.type = 'peaking'
  chest.frequency.value = 150
  chest.Q.value = 1.2
  chest.gain.value = 9
  const throat = context.createBiquadFilter()
  throat.type = 'peaking'
  throat.frequency.value = 420
  throat.Q.value = 2
  throat.gain.value = 4
  const lowpass = context.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.value = 900
  lowpass.Q.value = 0.5
  const output = context.createGain()
  source.connect(highpass).connect(chest).connect(throat).connect(lowpass).connect(output).connect(context.destination)
  source.start()
  return output
}

export class Purr {
  private context?: AudioContext
  private output?: GainNode
  private level = 0

  // 浏览器要在用户操作之后才允许出声
  private start() {
    if (this.context) {
      return this.context
    }
    const context = new AudioContext()
    this.output = purrGraph(context)
    this.output.gain.value = 0
    this.context = context
    return context
  }

  // level 0~1
  set(level: number) {
    if (Math.abs(level - this.level) < 0.02) {
      return
    }
    this.level = level
    if (level > 0 && !this.context && navigator.userActivation?.hasBeenActive === false) {
      return
    }
    const context = level > 0 ? this.start() : this.context
    if (!context || !this.output) {
      return
    }
    if (context.state === 'suspended' && level > 0) {
      void context.resume()
    }
    this.output.gain.setTargetAtTime(level * 0.6, context.currentTime, 0.3)
  }

  dispose() {
    void this.context?.close()
  }
}
