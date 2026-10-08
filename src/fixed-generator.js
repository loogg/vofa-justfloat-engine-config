'use strict';

const protocol = require('./protocol');

function fixedSource(config) {
  const p = config.protocol;
  const l = protocol.layout(config);
  const parameters = protocol.crcParameters(p.crc);
  const header = Array.from(protocol.bytes(p.header));
  const tail = Array.from(protocol.bytes(p.tail));
  const hex = (value) => `0x${value.toString(16)}u`;
  const little = (order) => order === 'little' ? 'true' : 'false';
  const decode = l.channels.map((field, index) => {
    const offset = l.dataOffset + field.offset;
    if (field.type === 'bit') return `    dd.append(float((bytes[${offset}] >> ${field.bitOffset}) & 1u));`;
    const raw = `ReadUnsigned(bytes + ${offset}, ${protocol.TYPES[field.type]}, ${little(p.byteOrder)})`;
    if (field.type === 'float') return `    const quint32 raw${index} = ${raw};\n    float value${index};\n    std::memcpy(&value${index}, &raw${index}, sizeof(value${index}));\n    dd.append(value${index});`;
    if (field.type.startsWith('int')) return `    const quint32 raw${index} = ${raw};\n    const qint64 value${index} = raw${index} >= (quint64(1) << ${field.width - 1})\n        ? qint64(raw${index}) - (qint64(1) << ${field.width}) : qint64(raw${index});\n    dd.append(float(value${index}));`;
    return `    dd.append(float(${raw}));`;
  }).join('\n');
  const crc = !l.crcBytes ? '' : `
quint32 Reflect(quint32 value, int width)
{
    quint32 result = 0;
    for (int i = 0; i < width; ++i) {
        result = (result << 1) | (value & 1u);
        value >>= 1;
    }
    return result;
}

quint32 Checksum(const unsigned char *bytes, int count)
{
    const quint32 mask = ${hex(parameters.width === 32 ? 0xffffffff : Math.pow(2, parameters.width) - 1)};
    quint32 crc = ${hex(parameters.init)};
    for (int i = 0; i < count; ++i) {
        quint32 value = bytes[i];
        ${parameters.reflectInput ? 'value = Reflect(value, 8);' : ''}
        crc ^= value << ${parameters.width - 8};
        for (int bit = 0; bit < 8; ++bit)
            crc = ((crc & ${hex(Math.pow(2, parameters.width - 1))}) ? (crc << 1) ^ ${hex(parameters.polynomial)} : crc << 1) & mask;
    }
    ${parameters.reflectOutput ? `crc = Reflect(crc, ${parameters.width});` : ''}
    return (crc ^ ${hex(parameters.xorOut)}) & mask;
}
`;
  const checksumStart = p.crc.scope === 'data' ? l.dataOffset : 0;
  return `#include "${config.targetName}.h"
#include <cstring>
#include <cstdint>

// Fixed structure: field values never change the ${l.frameBytes}-byte frame length.
// QVector<float> cannot preserve every integer above 24-bit precision.
namespace {
const int FrameSize = ${l.frameBytes};
const unsigned char Header[] = { ${header.join(', ')} };

quint32 ReadUnsigned(const unsigned char *bytes, int count, bool littleEndian)
{
    quint32 result = 0;
    for (int i = 0; i < count; ++i)
        result = (result << 8) | bytes[littleEndian ? count - 1 - i : i];
    return result;
}
${crc}
} // namespace

${config.className}::${config.className}() {}
${config.className}::~${config.className}() {}

bool ${config.className}::ProcessingFrame(char *data, int count, QVector<float> &dd)
{
    static_assert(sizeof(float) == 4, "float must be 32 bits");
    if (data == nullptr || count != FrameSize) return false;
    const unsigned char *bytes = reinterpret_cast<const unsigned char *>(data);
    if (std::memcmp(bytes, Header, sizeof(Header)) != 0) return false;
${tail.length ? `    const unsigned char tail[] = { ${tail.join(', ')} };\n    if (std::memcmp(bytes + ${l.tailOffset}, tail, sizeof(tail)) != 0) return false;` : ''}
${l.crcBytes ? `    if (ReadUnsigned(bytes + ${l.crcOffset}, ${l.crcBytes}, ${little(p.crc.byteOrder)})\n            != Checksum(bytes + ${checksumStart}, ${l.crcOffset - checksumStart})) return false;` : ''}
    dd.clear();
${decode}
    return true;
}

void ${config.className}::ProcessingDatas(char *data, int count)
{
    frame_list_.clear();
    if (data == nullptr || count <= 0) return;
    // VOFA+ retains bytes after the last reported end_index_. Do not keep
    // another private receive buffer: incomplete frames are supplied again.
    int position = 0;
    int consumed = 0;
    while (position <= count - int(sizeof(Header))) {
        if (std::memcmp(data + position, Header, sizeof(Header)) != 0) {
            ++position;
            continue;
        }
        if (count - position < FrameSize) break;
        Frame frame;
        if (!ProcessingFrame(data + position, FrameSize, frame.datas_)) {
            ++position; // Search again after a bad CRC/tail, including overlapping headers.
            continue;
        }
        frame.start_index_ = position;
        frame.end_index_ = position + FrameSize - 1;
        frame.is_valid_ = true;
        frame_list_.append(frame);
        position += FrameSize;
        consumed = position;
    }
    if (position > consumed) {
        Frame discarded;
        discarded.start_index_ = consumed;
        discarded.end_index_ = position - 1;
        discarded.is_valid_ = false;
        frame_list_.append(discarded);
    }
}
`;
}

module.exports = { fixedSource };
