const BUFFER_SIZE = 120
export const MAX_COUNTED_FRAME_GAP_MS = 250

const hasPerformance = typeof performance !== 'undefined'

export class FrameStats {
  frameTime = 0
  cpuTime = 0
  gpuTime = 0

  minFrameTime = Infinity
  maxFrameTime = 0
  avgFrameTime = 0

  minCpuTime = Infinity
  maxCpuTime = 0
  avgCpuTime = 0

  minGpuTime = Infinity
  maxGpuTime = 0
  avgGpuTime = 0

  smoothedFps = 0

  totalNodes = 0
  culledNodes = 0
  drawCalls = 0
  scenePictureCacheHit = false
  scenePictureMode: 'hit' | 'record' | 'preview' | 'volatile' | 'none' = 'none'
  scenePictureMissReason = ''
  scenePictureDrawTime = 0
  scenePictureRecordTime = 0
  flushTime = 0

  private frameTimeBuffer = new Float64Array(BUFFER_SIZE)
  private cpuTimeBuffer = new Float64Array(BUFFER_SIZE)
  private gpuTimeBuffer = new Float64Array(BUFFER_SIZE)
  private bufferIndex = 0
  private bufferCount = 0
  private lastTimestamp = 0

  reset(): void {
    this.frameTime = 0
    this.cpuTime = 0
    this.gpuTime = 0
    this.minFrameTime = Infinity
    this.maxFrameTime = 0
    this.avgFrameTime = 0
    this.minCpuTime = Infinity
    this.maxCpuTime = 0
    this.avgCpuTime = 0
    this.minGpuTime = Infinity
    this.maxGpuTime = 0
    this.avgGpuTime = 0
    this.smoothedFps = 0
    this.bufferIndex = 0
    this.bufferCount = 0
    this.lastTimestamp = 0
    this.frameTimeBuffer.fill(0)
    this.cpuTimeBuffer.fill(0)
    this.gpuTimeBuffer.fill(0)
  }

  recordFrame(cpuTimeMs: number): void {
    const now = hasPerformance ? performance.now() : 0
    const gap = this.lastTimestamp > 0 ? now - this.lastTimestamp : 0
    this.lastTimestamp = now
    this.cpuTime = cpuTimeMs
    if (gap <= 0 || gap > MAX_COUNTED_FRAME_GAP_MS) {
      this.frameTime = cpuTimeMs
      return
    }
    this.frameTime = gap

    const i = this.bufferIndex
    this.frameTimeBuffer[i] = this.frameTime
    this.cpuTimeBuffer[i] = this.cpuTime
    this.gpuTimeBuffer[i] = this.gpuTime

    this.bufferIndex = (i + 1) % BUFFER_SIZE
    if (this.bufferCount < BUFFER_SIZE) this.bufferCount++

    this.computeStats()
  }

  getFrameTimeHistory(): Float64Array {
    return this.frameTimeBuffer
  }

  getCpuTimeHistory(): Float64Array {
    return this.cpuTimeBuffer
  }

  getGpuTimeHistory(): Float64Array {
    return this.gpuTimeBuffer
  }

  getBufferIndex(): number {
    return this.bufferIndex
  }

  getBufferCount(): number {
    return this.bufferCount
  }

  private computeStats(): void {
    const n = this.bufferCount
    if (n === 0) return

    let ftSum = 0
    let ftMin = Infinity
    let ftMax = 0
    let cpuSum = 0
    let cpuMin = Infinity
    let cpuMax = 0
    let gpuSum = 0
    let gpuMin = Infinity
    let gpuMax = 0

    for (let j = 0; j < n; j++) {
      const ft = this.frameTimeBuffer[j]
      ftSum += ft
      if (ft < ftMin) ftMin = ft
      if (ft > ftMax) ftMax = ft

      const cpu = this.cpuTimeBuffer[j]
      cpuSum += cpu
      if (cpu < cpuMin) cpuMin = cpu
      if (cpu > cpuMax) cpuMax = cpu

      const gpu = this.gpuTimeBuffer[j]
      gpuSum += gpu
      if (gpu < gpuMin) gpuMin = gpu
      if (gpu > gpuMax) gpuMax = gpu
    }

    this.minFrameTime = ftMin
    this.maxFrameTime = ftMax
    this.avgFrameTime = ftSum / n

    this.minCpuTime = cpuMin
    this.maxCpuTime = cpuMax
    this.avgCpuTime = cpuSum / n

    this.minGpuTime = gpuMin
    this.maxGpuTime = gpuMax
    this.avgGpuTime = gpuSum / n

    this.smoothedFps = this.avgFrameTime > 0 ? 1000 / this.avgFrameTime : 0
  }
}
