/**
 * AudioWorklet processor that downsamples shared-tab audio, calculates levels
 * from sample counts, and emits bounded overlapping chunks. Movie audio is
 * transferred out and never retained after a chunk is emitted.
 */

class CaptionRelayAudioProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options.processorOptions ?? {};
    this.targetSampleRate = Number(config.targetSampleRate || 16_000);
    this.chunkSamples = Math.round(this.targetSampleRate * Number(config.chunkSeconds || 20));
    this.overlapSamples = Math.round(this.targetSampleRate * Number(config.overlapSeconds || 2));
    this.maxSamples = Number.isFinite(config.maxSamples) ? config.maxSamples : Infinity;
    this.startOnAudio = config.startOnAudio !== false;
    this.audioStartThreshold = Math.max(0.0005, Number(config.audioStartThreshold || 0.003));
    this.armed = !this.startOnAudio;
    this.buffer = new Float32Array(this.chunkSamples);
    this.bufferLength = 0;
    this.processedSamples = 0;
    this.chunkStartSample = 0;
    this.inputPosition = 0;
    this.nextOutputPosition = 0;
    this.lastInputSample = 0;
    this.levelEnergy = 0;
    this.levelCount = 0;
    this.speechBlocks = 0;
    this.totalBlocks = 0;
    this.lastProgressSample = 0;
    this.receivedInputSamples = 0;
    this.lastWaitingProgressInputSample = 0;
    this.finished = false;
    this.port.onmessage = ({ data }) => {
      if (data?.type === "flush") {
        this.flush(true);
        this.port.postMessage({ type: "flush-complete" });
      }
    };
  }

  process(inputs, outputs) {
    if (this.finished) return true;
    const inputChannels = inputs[0];
    const output = outputs[0]?.[0];
    if (output) output.fill(0);
    if (!inputChannels?.[0]?.length) return true;
    const input = this.downmix(inputChannels);

    let blockEnergy = 0;
    for (let index = 0; index < input.length; index += 1) blockEnergy += input[index] * input[index];
    const blockRms = Math.sqrt(blockEnergy / input.length);
    const blockStart = this.inputPosition;
    const blockEnd = blockStart + input.length;
    this.receivedInputSamples += input.length;

    if (!this.armed) {
      if (blockRms < this.audioStartThreshold) {
        this.inputPosition = blockEnd;
        this.nextOutputPosition = blockEnd;
        this.lastInputSample = input.at(-1) ?? this.lastInputSample;
        this.postWaitingProgress(blockRms);
        return true;
      }
      this.armed = true;
      this.nextOutputPosition = blockStart;
      this.port.postMessage({
        type: "capture-armed",
        waitingMs: Math.round(
          Math.max(0, this.receivedInputSamples - input.length) * 1000 / sampleRate
        ),
      });
    }

    this.levelEnergy += blockEnergy;
    this.levelCount += input.length;
    this.totalBlocks += 1;
    if (blockRms >= 0.008) this.speechBlocks += 1;

    const ratio = sampleRate / this.targetSampleRate;
    while (this.nextOutputPosition < blockEnd && this.processedSamples < this.maxSamples) {
      const relative = this.nextOutputPosition - blockStart;
      const lowerIndex = Math.max(0, Math.floor(relative));
      const upperIndex = Math.min(input.length - 1, lowerIndex + 1);
      const fraction = Math.max(0, relative - lowerIndex);
      const lower = relative < 0 ? this.lastInputSample : input[lowerIndex];
      const upper = input[upperIndex];
      this.buffer[this.bufferLength] = lower + ((upper - lower) * fraction);
      this.bufferLength += 1;
      this.processedSamples += 1;
      this.nextOutputPosition += ratio;
      if (this.bufferLength >= this.chunkSamples) this.flush(false);
    }
    this.inputPosition = blockEnd;
    this.lastInputSample = input.at(-1) ?? this.lastInputSample;

    if (this.processedSamples - this.lastProgressSample >= this.targetSampleRate / 4) {
      this.postProgress();
    }
    if (this.processedSamples >= this.maxSamples) {
      this.flush(true);
      this.finished = true;
      this.port.postMessage({ type: "capture-limit", processedSamples: this.processedSamples });
    }
    return true;
  }

  downmix(channels) {
    if (channels.length === 1) return channels[0];
    const length = channels[0].length;
    if (!this.monoBuffer || this.monoBuffer.length < length) {
      this.monoBuffer = new Float32Array(length);
    }
    const mono = this.monoBuffer.subarray(0, length);
    mono.fill(0);
    for (const channel of channels) {
      for (let index = 0; index < length; index += 1) mono[index] += channel[index] / channels.length;
    }
    return mono;
  }

  flush(isFinal) {
    if (!this.bufferLength) return;
    const minimumFinalSamples = Math.round(this.targetSampleRate * 0.75);
    if (isFinal && this.bufferLength < minimumFinalSamples) {
      this.buffer.fill(0);
      this.bufferLength = 0;
      return;
    }
    const samples = this.buffer.slice(0, this.bufferLength);
    const meanRms = Math.sqrt(this.levelEnergy / Math.max(1, this.levelCount));
    const speechRatio = this.speechBlocks / Math.max(1, this.totalBlocks);
    this.port.postMessage({
      type: "audio-chunk",
      samples,
      sampleRate: this.targetSampleRate,
      startSample: this.chunkStartSample,
      endSample: this.chunkStartSample + this.bufferLength,
      meanRms,
      speechRatio,
      isFinal,
    }, [samples.buffer]);

    const overlap = isFinal ? 0 : Math.min(this.overlapSamples, this.bufferLength);
    if (overlap) this.buffer.copyWithin(0, this.bufferLength - overlap, this.bufferLength);
    this.buffer.fill(0, overlap);
    this.chunkStartSample += this.bufferLength - overlap;
    this.bufferLength = overlap;
    this.levelEnergy = 0;
    this.levelCount = 0;
    this.speechBlocks = 0;
    this.totalBlocks = 0;
  }

  postProgress() {
    const rms = Math.sqrt(this.levelEnergy / Math.max(1, this.levelCount));
    this.lastProgressSample = this.processedSamples;
    this.port.postMessage({
      type: "audio-progress",
      processedSamples: this.processedSamples,
      level: Math.min(1, rms * 12),
    });
  }

  postWaitingProgress(blockRms) {
    if (this.receivedInputSamples - this.lastWaitingProgressInputSample < sampleRate / 4) return;
    this.lastWaitingProgressInputSample = this.receivedInputSamples;
    this.port.postMessage({
      type: "audio-progress",
      processedSamples: 0,
      waitingForAudio: true,
      waitingMs: Math.round(this.receivedInputSamples * 1000 / sampleRate),
      level: Math.min(1, blockRms * 12),
    });
  }
}

registerProcessor("caption-relay-audio", CaptionRelayAudioProcessor);
