'use strict';

// Wire bytes and expected frame boundaries are independent of either parser.
const hex = (data) => Buffer.from(data).toString('hex').toUpperCase().match(/../g)?.join(' ') || '';
function cleanStream(name, frame, values, cuts, repetitions = 1) {
  const bytes = Buffer.concat(Array.from({ length: repetitions }, () => Buffer.from(frame)));
  const chunks = [], steps = [];
  let previous = 0, emitted = 0;
  for (const end of [...cuts, bytes.length]) {
    const complete = Math.floor(end / frame.length);
    const channels = Array.from({ length: complete - emitted }, () => [...values]);
    chunks.push(hex(bytes.subarray(previous, end)));
    steps.push({
      consumed: (complete - emitted) * frame.length,
      channels,
      remaining: hex(bytes.subarray(complete * frame.length, end))
    });
    emitted = complete;
    previous = end;
  }
  return { name, chunks, steps, channels: Array.from({ length: repetitions }, () => [...values]), remaining: '' };
}
function standardStreams(frame, values) {
  const size = frame.length;
  const streams = Array.from({ length: size - 1 }, (_, index) => cleanStream(`split-${index + 1}`, frame, values, [index + 1]));
  streams.push(cleanStream('one-byte-at-a-time', frame, values, Array.from({ length: size * 2 - 1 }, (_, i) => i + 1), 2));
  streams.push(cleanStream('repeated-partials-and-complete-plus-partial', frame, values,
    [0, 1, Math.max(2, Math.floor(size / 2)), size + 1, size + Math.max(2, Math.floor(size / 2)), 2 * size + 1], 3));
  streams.push(cleanStream('three-concatenated-frames', frame, values, [], 3));
  return streams;
}

module.exports = { standardStreams, hex };
