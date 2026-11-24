#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const extDir = path.join(rootDir, 'extension')
const distDir = path.join(rootDir, 'dist')
const outFile = path.join(distDir, 'ulink-browser-extension.zip')

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true })
}

if (fs.existsSync(outFile)) {
  try {
    fs.unlinkSync(outFile)
  } catch (_) {}
}

console.log('[pack-extension] Packaging browser extension from extension/ to dist/ulink-browser-extension.zip...')

// ZIP entry names MUST use forward slashes. PowerShell's Compress-Archive on
// Windows writes backslashes, which store validators may reject even when the
// same folder loads fine unpacked. Write the archive ourselves so the artifact
// is identical on every platform and needs no external zip/powershell binary.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function collectFiles(dir, base = dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, base))
    } else if (entry.isFile()) {
      files.push({
        name: path.relative(base, full).split(path.sep).join('/'),
        data: fs.readFileSync(full),
      })
    }
  }
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

function writeZip(target, files) {
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, 'utf8')
    const packed = zlib.deflateRawSync(data, { level: 9 })
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 filenames
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x0021, 12) // fixed 1980-01-01 for reproducible builds
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(packed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuf, packed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x0021, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(packed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuf)

    offset += local.length + nameBuf.length + packed.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)

  fs.writeFileSync(target, Buffer.concat([...localParts, ...centralParts, end]))
}

try {
  const files = collectFiles(extDir)
  writeZip(outFile, files)
  const stats = fs.statSync(outFile)
  console.log(`[pack-extension] Successfully created ${outFile} (${(stats.size / 1024).toFixed(1)} KB, ${files.length} files)`)
  console.log('[pack-extension] Ready for: Microsoft Edge Add-ons, Chrome Web Store, Firefox AMO, Brave, Arc')
} catch (err) {
  console.error('[pack-extension] Failed to package extension:', err)
  process.exit(1)
}
