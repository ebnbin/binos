// 呼噜声：低频脉冲调制的滤波噪声，呼气时响、吸气时轻
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
    const length = context.sampleRate * 2
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < length; index++) {
      data[index] = Math.random() * 2 - 1
    }
    const noise = context.createBufferSource()
    noise.buffer = buffer
    noise.loop = true
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 140
    band.Q.value = 0.8
    const pulse = context.createGain()
    pulse.gain.value = 0
    const pulseRate = context.createOscillator()
    pulseRate.frequency.value = 26
    const pulseDepth = context.createGain()
    pulseDepth.gain.value = 0.5
    pulseRate.connect(pulseDepth).connect(pulse.gain)
    const constant = context.createConstantSource()
    constant.offset.value = 0.5
    constant.connect(pulse.gain)
    const breath = context.createGain()
    breath.gain.value = 0.6
    const breathRate = context.createOscillator()
    breathRate.frequency.value = 0.42
    const breathDepth = context.createGain()
    breathDepth.gain.value = 0.4
    breathRate.connect(breathDepth).connect(breath.gain)
    const low = context.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 420
    this.output = context.createGain()
    this.output.gain.value = 0
    noise.connect(band).connect(pulse).connect(breath).connect(low).connect(this.output).connect(context.destination)
    for (const source of [noise, pulseRate, constant, breathRate]) {
      source.start()
    }
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
    this.output.gain.setTargetAtTime(level * 0.9, context.currentTime, 0.25)
  }

  dispose() {
    void this.context?.close()
  }
}
