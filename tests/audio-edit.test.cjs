const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

// Exercise the actual helpers from the single-file app without browser dependencies.
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
const helpers = html.slice(html.indexOf('function replaceLineAudio('), html.indexOf('// Load OCR'));
const { replaceLineAudio, audioBufferToWav } = vm.runInNewContext(
  helpers + '\n({ replaceLineAudio, audioBufferToWav })', { Blob });
const ac = {
  createBuffer(numberOfChannels, length, sampleRate) {
    const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
    return { numberOfChannels, length, sampleRate, duration: length / sampleRate,
      getChannelData: ch => channels[ch] };
  },
};
const values = buffer => Array.from(buffer.getChannelData(0));
const plain = value => JSON.parse(JSON.stringify(value));

for (const index of [0, 1, 2]) {
  for (const replacementLength of [1, 3, 5]) {
    test(`replace line ${index + 1} with ${replacementLength} frames, preserving trimmed edges`, () => {
      const original = ac.createBuffer(1, 13, 10);
      original.getChannelData(0).set(Array.from({ length: 13 }, (_, i) => i));
      const recording = ac.createBuffer(1, replacementLength, 10);
      recording.getChannelData(0).fill(99);
      const segments = [{ start:0.2, end:0.5 }, { start:0.5, end:0.8 }, { start:0.8, end:1.1 }];
      const snapshot = plain(segments);
      const result = replaceLineAudio(ac, original, recording, segments, index);
      const start = 2 + index * 3;
      assert.deepEqual(values(result.buffer), [
        ...values(original).slice(0, start), ...Array(replacementLength).fill(99),
        ...values(original).slice(start + 3),
      ]);
      assert.deepEqual(segments, snapshot);
      result.segments.forEach((seg, i) => {
        const samples = result.buffer.getChannelData(0).slice(Math.round(seg.start * 10), Math.round(seg.end * 10));
        assert.deepEqual(Array.from(samples), i === index ? Array(replacementLength).fill(99)
          : values(original).slice(2 + i * 3, 5 + i * 3));
        if (i > 0) assert.equal(seg.start, result.segments[i - 1].end);
      });
      assert.equal(result.trimStart * result.buffer.duration, 0.2);
      assert.ok(Math.abs((1 - result.trimEnd) * result.buffer.duration - 0.2) < 1e-12);
      result.dividers.forEach((divider, i) => {
        assert.equal(divider * result.buffer.duration, result.segments[i].end);
      });
    });
  }
}

test('mono replacement preserves both original stereo channels', () => {
  const original = ac.createBuffer(2, 6, 10);
  original.getChannelData(0).set([1, 2, 3, 4, 5, 6]);
  original.getChannelData(1).set([6, 5, 4, 3, 2, 1]);
  const recording = ac.createBuffer(1, 2, 10);
  recording.getChannelData(0).set([7, 8]);
  const result = replaceLineAudio(ac, original, recording, [{ start:0, end:0.3 }, { start:0.3, end:0.6 }], 0);
  assert.deepEqual(values(result.buffer), [7, 8, 4, 5, 6]);
  assert.deepEqual(Array.from(result.buffer.getChannelData(1)), [7, 8, 3, 2, 1]);
});

test('repeated replacements use updated boundaries', () => {
  const original = ac.createBuffer(1, 6, 10);
  original.getChannelData(0).set([1, 2, 3, 4, 5, 6]);
  const recording = ac.createBuffer(1, 3, 10);
  recording.getChannelData(0).fill(7);
  const first = replaceLineAudio(ac, original, recording, [{ start:0, end:0.2 }, { start:0.2, end:0.6 }], 0);
  const next = replaceLineAudio(ac, first.buffer, recording, first.segments, 1);
  assert.deepEqual(values(next.buffer), [7, 7, 7, 7, 7, 7]);
  assert.deepEqual(plain(next.segments), [{ start:0, end:0.3 }, { start:0.3, end:0.6 }]);
});

test('WAV persistence writes PCM16 header, interleaved channels and clipped samples', async () => {
  const buffer = ac.createBuffer(2, 3, 48000);
  buffer.getChannelData(0).set([-2, 0, 2]);
  buffer.getChannelData(1).set([0.5, -0.5, 0]);
  const blob = audioBufferToWav(buffer);
  const bytes = await blob.arrayBuffer();
  const view = new DataView(bytes);
  assert.equal(blob.type, 'audio/wav');
  assert.equal(bytes.byteLength, 56);
  assert.equal(Buffer.from(bytes).toString('ascii', 0, 4), 'RIFF');
  assert.equal(Buffer.from(bytes).toString('ascii', 8, 12), 'WAVE');
  assert.equal(view.getUint32(4, true), 48);
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(28, true), 192000);
  assert.equal(view.getUint16(32, true), 4);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 12);
  assert.deepEqual(Array.from({ length:6 }, (_, i) => view.getInt16(44 + i * 2, true)),
    [-32768, 16384, 0, -16384, 32767, 0]);
});
