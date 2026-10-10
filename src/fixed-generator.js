'use strict';

const protocol = require('./protocol');

function fixedSource(config) {
  const p = config.protocol;
  const l = protocol.layout(config);
  const parameters = protocol.crcParameters(p.crc);
  const header = Array.from(protocol.bytes(p.header));
  const headers = protocol.headerValues(p).map((value) => Array.from(protocol.bytes(value)));
  const tail = Array.from(protocol.bytes(p.tail));
  const delimited = p.kind === 'delimited';
  const hex = (value) => `0x${value.toString(16)}u`;
  const little = (order) => order === 'little' ? 'true' : 'false';
  const decode = l.channels.map((field, index) => {
    const offset = l.dataOffset + field.offset;
    const guard = delimited && p.repeatWords && protocol.wordData(p) ? `    if (dataEnd >= ${offset + protocol.TYPES[field.type]}) {\n` : '';
    const finish = guard ? '\n    }' : '';
    if (field.type === 'bit') return guard + `    dd.append(float((bytes[${offset}] >> ${field.bitOffset}) & 1u));` + finish;
    const raw = `ReadUnsigned(bytes + ${offset}, ${protocol.TYPES[field.type]}, ${little(p.byteOrder)})`;
    if (field.type === 'float') return guard + `    const quint32 raw${index} = ${raw};\n    float value${index};\n    std::memcpy(&value${index}, &raw${index}, sizeof(value${index}));\n    dd.append(value${index});` + finish;
    if (field.type.startsWith('int')) return guard + `    const quint32 raw${index} = ${raw};\n    const qint64 value${index} = raw${index} >= (quint64(1) << ${field.width - 1})\n        ? qint64(raw${index}) - (qint64(1) << ${field.width}) : qint64(raw${index});\n    dd.append(float(value${index}));` + finish;
    return guard + `    dd.append(float(${raw}));` + finish;
  }).join('\n');
  const checks = (p.checks || []).map((check, index) => {
    const field = l.fields[check.field], offset = l.dataOffset + field.offset, size = protocol.TYPES[field.type];
    const raw = field.type === 'bit' ? `((bytes[${offset}] >> ${field.bitOffset}) & 1u)` : `ReadUnsigned(bytes + ${offset}, ${size}, ${little(p.byteOrder)})`;
    const read = field.type === 'float' ? `ReadFloat(bytes + ${offset}, ${little(p.byteOrder)})` : field.type.startsWith('int') ? `ReadSigned(${raw}, ${field.width})` : raw;
    const number = (value) => field.type === 'float' ? `double(float(${value}))` : `double(${value})`;
    const value = `value${index}`;
    const predicate = ['eq', 'in'].includes(check.operator) ? check.values.map((allowed) => `${value} == ${number(allowed)}`).join(' || ')
      : check.operator === 'range' ? `${value} >= ${number(check.min)} && ${value} <= ${number(check.max)}`
      : `(quint32(${value}) & ${hex(check.mask)}) == ${hex(check.value)}`;
    return `    if (available < ${offset + size}) pending = true;
    else {
        const double ${value} = ${read};
        if (!(${predicate})) return -1;
    }`;
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

// ${delimited ? 'Tail-delimited stream with bounded candidates.' : `Fixed structure: field values never change the ${l.frameBytes}-byte frame length.`}
// QVector<float> cannot preserve every integer above 24-bit precision.
namespace {
const int FrameSize = ${l.frameBytes};
const int HeaderSize = ${header.length};
const int HeaderCount = ${headers.length};
const unsigned char Headers[${Math.max(1, headers.length)}][${Math.max(1, header.length)}] = {
    ${headers.length ? headers.map((value) => '{ ' + value.join(', ') + ' }').join(',\n    ') : '{ 0 }'}
};
const int TailSize = ${tail.length};
const unsigned char Tail[] = { ${tail.length ? tail.join(', ') : '0'} };

bool MatchHeader(const char *bytes)
{
    if (HeaderSize == 0) return true;
    for (int i = 0; i < HeaderCount; ++i)
        if (std::memcmp(bytes, Headers[i], HeaderSize) == 0) return true;
    return false;
}

quint32 ReadUnsigned(const unsigned char *bytes, int count, bool littleEndian)
{
    quint32 result = 0;
    for (int i = 0; i < count; ++i)
        result = (result << 8) | bytes[littleEndian ? count - 1 - i : i];
    return result;
}
float ReadFloat(const unsigned char *bytes, bool littleEndian)
{
    const quint32 raw = ReadUnsigned(bytes, 4, littleEndian);
    float value;
    std::memcpy(&value, &raw, sizeof(value));
    return value;
}

qint64 ReadSigned(quint32 raw, int width)
{
    return raw >= (quint64(1) << (width - 1))
        ? qint64(raw) - (qint64(1) << width) : qint64(raw);
}

// -1 rejects this start; 0 waits for bytes; 1 passes every value check.
int CheckValues(const unsigned char *bytes, int available)
{
    bool pending = false;
${checks}
    return pending ? 0 : 1;
}
${crc}
} // namespace

${config.className}::${config.className}() {}
${config.className}::~${config.className}() {}

bool ${config.className}::ProcessingFrame(char *data, int count, QVector<float> &dd)
{
    static_assert(sizeof(float) == 4, "float must be 32 bits");
    if (data == nullptr || count ${delimited && p.repeatWords ? '< HeaderSize + TailSize + ' + l.crcBytes : '!= FrameSize'}) return false;
    const unsigned char *bytes = reinterpret_cast<const unsigned char *>(data);
    if (!MatchHeader(data)) return false;
    const int dataEnd = count - TailSize - ${l.crcBytes};
${delimited && p.repeatWords ? protocol.wordData(p) ? '    if ((dataEnd - HeaderSize) % 4 != 0) return false;' : `    if (dataEnd < ${l.crcOffset} || (dataEnd - ${l.crcOffset}) % 4 != 0) return false;` : ''}
    if (TailSize && std::memcmp(bytes + count - TailSize, Tail, TailSize) != 0) return false;
    if (CheckValues(bytes, dataEnd) != 1) return false;
${l.crcBytes ? `    if (ReadUnsigned(bytes + dataEnd, ${l.crcBytes}, ${little(p.crc.byteOrder)})\n            != Checksum(bytes + ${checksumStart}, dataEnd - ${checksumStart})) return false;` : ''}
    dd.clear();
${decode}
${delimited && p.repeatWords ? `    for (int offset = ${l.dataOffset + l.dataBytes}; offset + 4 <= dataEnd; offset += 4)
        dd.append(ReadFloat(bytes + offset, ${little(p.byteOrder)}));` : ''}
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
    while (position <= count - ${Math.max(1, header.length)}) {
        if (!MatchHeader(data + position)) {
            ++position;
            continue;
        }
        if (CheckValues(reinterpret_cast<const unsigned char *>(data + position), count - position) < 0) {
            ++position;
            continue;
        }
        int frameSize = FrameSize;
${delimited ? `        int end = position + HeaderSize;
        while (end <= count - TailSize && end - position <= 65536 - TailSize
                && std::memcmp(data + end, Tail, TailSize) != 0) ++end;
        if (end - position > 65536 - TailSize) { ++position; continue; }
        if (end > count - TailSize) break;
        frameSize = end + TailSize - position;` : ''}
        if (count - position < frameSize) break;
        Frame frame;
        if (!ProcessingFrame(data + position, frameSize, frame.datas_)) {
            ++position; // Search again after a bad CRC/tail, including overlapping headers.
            continue;
        }
        frame.start_index_ = position;
        frame.end_index_ = position + frameSize - 1;
        frame.is_valid_ = true;
        frame_list_.append(frame);
        position += frameSize;
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
