#!/usr/bin/env node
/*
 * Node port of hyperframes-creative/scripts/extract-audio-data.py.
 *
 * Why a port: that script needs numpy, and this pod is rootless with no pip and no uv,
 * so the Python path cannot be installed. The algorithm here is a faithful
 * reimplementation — same 44.1kHz mono decode, same 4096-sample Hann window centred on
 * each frame, same log-spaced 30Hz-16kHz band edges, same peak-magnitude-per-band, same
 * two-pass global normalisation (RMS by track peak, each band by its own peak) and the
 * same output JSON shape. Swap it back for the Python script on a machine that has numpy.
 *
 *   node tools/extract-audio-data.mjs <input> -o out.json [--fps 30] [--bands 16]
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const SAMPLE_RATE = 44100;
const FFT_SIZE = 4096;
const MIN_FREQ = 30.0;
const MAX_FREQ = 16000.0;

const argv = process.argv.slice(2);
const input = argv.find((a) => !a.startsWith("-"));
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i === -1 ? dflt : argv[i + 1];
};
const output = flag("-o", flag("--output", "audio-data.json"));
const fps = Number(flag("--fps", 30));
const nBands = Number(flag("--bands", 16));
if (!input) {
  console.error("usage: extract-audio-data.mjs <input> -o out.json [--fps 30] [--bands 16]");
  process.exit(2);
}

// --- decode to mono float32 -------------------------------------------------
const pcm = execFileSync(
  "ffmpeg",
  ["-i", input, "-vn", "-ac", "1", "-ar", String(SAMPLE_RATE),
   "-f", "s16le", "-acodec", "pcm_s16le", "-loglevel", "error", "pipe:1"],
  { maxBuffer: 1 << 30 },
);
const n = Math.floor(pcm.length / 2);
const samples = new Float32Array(n);
for (let i = 0; i < n; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768;

// --- iterative radix-2 FFT (in-place, complex) ------------------------------
const bitrev = new Uint32Array(FFT_SIZE);
{
  const bits = Math.log2(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    bitrev[i] = r;
  }
}
const cosT = new Float64Array(FFT_SIZE / 2);
const sinT = new Float64Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
  cosT[i] = Math.cos((-2 * Math.PI * i) / FFT_SIZE);
  sinT[i] = Math.sin((-2 * Math.PI * i) / FFT_SIZE);
}
const re = new Float64Array(FFT_SIZE);
const im = new Float64Array(FFT_SIZE);
function fft(input) {
  for (let i = 0; i < FFT_SIZE; i++) { re[bitrev[i]] = input[i]; im[bitrev[i]] = 0; }
  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1, step = FFT_SIZE / size;
    for (let i = 0; i < FFT_SIZE; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half;
        const tr = re[b] * cosT[k] - im[b] * sinT[k];
        const ti = re[b] * sinT[k] + im[b] * cosT[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr;        im[a] += ti;
      }
    }
  }
}

// --- precompute -------------------------------------------------------------
const hann = new Float64Array(FFT_SIZE);
// numpy.hanning is the symmetric window: denominator M-1, endpoints exactly 0.
for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
const bandEdges = new Float64Array(nBands + 1);
for (let i = 0; i <= nBands; i++) bandEdges[i] = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, i / nBands);
const freqPerBin = SAMPLE_RATE / FFT_SIZE;
const nBins = FFT_SIZE / 2 + 1;
const halfFft = FFT_SIZE / 2;
const frameStep = Math.floor(SAMPLE_RATE / fps);
const duration = n / SAMPLE_RATE;
const totalFrames = Math.floor(duration * fps);

console.error(`Decoding ${input}: ${duration.toFixed(1)}s, ${totalFrames} frames at ${fps}fps`);
console.error(`FFT window ${FFT_SIZE} (${freqPerBin.toFixed(1)} Hz/bin), ${nBands} bands ${MIN_FREQ}-${MAX_FREQ} Hz`);

// --- pass 1: raw values -----------------------------------------------------
const rms = new Float64Array(totalFrames);
const bandVals = Array.from({ length: totalFrames }, () => new Float64Array(nBands));
const win = new Float64Array(FFT_SIZE);
for (let f = 0; f < totalFrames; f++) {
  const s0 = f * frameStep, s1 = Math.min(s0 + frameStep, n);
  let acc = 0;
  for (let i = s0; i < s1; i++) acc += samples[i] * samples[i];
  if (s1 > s0) rms[f] = Math.sqrt(acc / (s1 - s0));

  const center = s0 + Math.floor(frameStep / 2);
  const winStart = center - halfFft;
  for (let i = 0; i < FFT_SIZE; i++) {
    const src = winStart + i;
    win[i] = (src >= 0 && src < n ? samples[src] : 0) * hann[i];
  }
  fft(win);
  const out = bandVals[f];
  for (let b = 0; b < nBands; b++) {
    let low = Math.max(0, Math.floor(bandEdges[b] / freqPerBin));
    let high = Math.min(nBins, Math.floor(bandEdges[b + 1] / freqPerBin));
    if (high <= low) high = low + 1;
    low = Math.min(low, nBins - 1);
    high = Math.min(high, nBins);
    let peak = 0;
    for (let k = low; k < high; k++) {
      const m = Math.hypot(re[k], im[k]);
      if (m > peak) peak = m;
    }
    out[b] = peak;
  }
}

// --- pass 2: normalise ------------------------------------------------------
let peakRms = 0;
for (let f = 0; f < totalFrames; f++) if (rms[f] > peakRms) peakRms = rms[f];
if (peakRms > 0) for (let f = 0; f < totalFrames; f++) rms[f] /= peakRms;
const bandPeaks = new Float64Array(nBands);
for (let f = 0; f < totalFrames; f++)
  for (let b = 0; b < nBands; b++) if (bandVals[f][b] > bandPeaks[b]) bandPeaks[b] = bandVals[f][b];
for (let b = 0; b < nBands; b++) if (bandPeaks[b] === 0) bandPeaks[b] = 1;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

const frames = [];
for (let f = 0; f < totalFrames; f++) {
  frames.push({
    time: r4(f / fps),
    rms: r4(rms[f]),
    bands: Array.from(bandVals[f], (v, b) => r4(v / bandPeaks[b])),
  });
}
writeFileSync(output, JSON.stringify({
  duration: r4(duration), fps, bands: nBands, totalFrames, frames,
}));
console.error(`Wrote ${output}`);
