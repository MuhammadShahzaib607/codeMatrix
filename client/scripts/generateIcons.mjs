import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const PUBLIC_DIR = path.resolve(import.meta.dirname, '..', 'public')
const ICONS_DIR = path.join(PUBLIC_DIR, 'icons')
const SOURCE = path.join(PUBLIC_DIR, 'logo.png')
const MASK_BACKGROUND = [0x1e, 0x1e, 0x1e, 0xff]

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

function decodePng(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') throw new Error('not a png')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
      if (data[8] !== 8) throw new Error('unsupported bit depth')
      if (colorType !== 6 && colorType !== 2) throw new Error('unsupported color type')
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * channels
  const pixels = Buffer.alloc(width * height * 4)
  const previous = Buffer.alloc(stride)
  let source = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source]
    source += 1
    const row = Buffer.from(raw.subarray(source, source + stride))
    source += stride
    for (let index = 0; index < stride; index += 1) {
      const left = index >= channels ? row[index - channels] : 0
      const up = previous[index]
      const upLeft = index >= channels ? previous[index - channels] : 0
      let value = row[index]
      if (filter === 1) value = (value + left) & 0xff
      else if (filter === 2) value = (value + up) & 0xff
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 0xff
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
        value = (value + predictor) & 0xff
      }
      row[index] = value
    }
    for (let x = 0; x < width; x += 1) {
      const target = (y * width + x) * 4
      pixels[target] = row[x * channels]
      pixels[target + 1] = row[x * channels + 1]
      pixels[target + 2] = row[x * channels + 2]
      pixels[target + 3] = channels === 4 ? row[x * channels + 3] : 0xff
    }
    row.copy(previous)
  }
  return { width, height, pixels }
}

function encodePng(width, height, pixels) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const body = zlib.deflateSync(raw, { level: 9 })
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', body),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function sampleBox(source, boxX, boxY, boxW, boxH) {
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  let count = 0
  const startX = Math.floor(boxX)
  const startY = Math.floor(boxY)
  const endX = Math.min(source.width, Math.ceil(boxX + boxW))
  const endY = Math.min(source.height, Math.ceil(boxY + boxH))
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const index = (y * source.width + x) * 4
      const alpha = source.pixels[index + 3] / 255
      r += source.pixels[index] * alpha
      g += source.pixels[index + 1] * alpha
      b += source.pixels[index + 2] * alpha
      a += source.pixels[index + 3]
      count += 1
    }
  }
  if (count === 0) return [0, 0, 0, 0]
  const alphaOut = a / count
  const weight = alphaOut / 255
  if (weight === 0) return [0, 0, 0, 0]
  return [
    Math.round(r / count / weight),
    Math.round(g / count / weight),
    Math.round(b / count / weight),
    Math.round(alphaOut),
  ]
}

function resize(source, size) {
  const pixels = Buffer.alloc(size * size * 4)
  const scale = source.width / size
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = sampleBox(source, x * scale, y * scale, scale, scale)
      const index = (y * size + x) * 4
      pixels[index] = r
      pixels[index + 1] = g
      pixels[index + 2] = b
      pixels[index + 3] = a
    }
  }
  return pixels
}

function composeMaskable(source, size, innerRatio) {
  const pixels = Buffer.alloc(size * size * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = MASK_BACKGROUND[0]
    pixels[index + 1] = MASK_BACKGROUND[1]
    pixels[index + 2] = MASK_BACKGROUND[2]
    pixels[index + 3] = MASK_BACKGROUND[3]
  }
  const inner = Math.round(size * innerRatio)
  const logo = resize(source, inner)
  const offset = Math.floor((size - inner) / 2)
  for (let y = 0; y < inner; y += 1) {
    for (let x = 0; x < inner; x += 1) {
      const sourceIndex = (y * inner + x) * 4
      const alpha = logo[sourceIndex + 3] / 255
      const target = ((y + offset) * size + (x + offset)) * 4
      pixels[target] = Math.round(logo[sourceIndex] * alpha + pixels[target] * (1 - alpha))
      pixels[target + 1] = Math.round(logo[sourceIndex + 1] * alpha + pixels[target + 1] * (1 - alpha))
      pixels[target + 2] = Math.round(logo[sourceIndex + 2] * alpha + pixels[target + 2] * (1 - alpha))
      pixels[target + 3] = 0xff
    }
  }
  return pixels
}

function write(fileName, size, pixels) {
  const target = path.join(ICONS_DIR, fileName)
  fs.writeFileSync(target, encodePng(size, size, pixels))
  console.log(`${fileName} ${size}x${size}`)
}

function main() {
  fs.mkdirSync(ICONS_DIR, { recursive: true })
  const source = decodePng(fs.readFileSync(SOURCE))
  write('icon-192.png', 192, resize(source, 192))
  write('icon-512.png', 512, resize(source, 512))
  write('icon-maskable-512.png', 512, composeMaskable(source, 512, 0.72))
  write('apple-touch-icon.png', 180, resize(source, 180))
  write('favicon-32x32.png', 32, resize(source, 32))
  write('favicon-16x16.png', 16, resize(source, 16))
}

main()
