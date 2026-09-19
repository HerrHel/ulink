#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
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

try {
  if (process.platform === 'win32') {
    const extGlob = path.join(extDir, '*')
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${extGlob}' -DestinationPath '${outFile}' -Force"`, {
      stdio: 'inherit',
    })
  } else {
    execSync(`cd "${extDir}" && zip -r "${outFile}" .`, {
      stdio: 'inherit',
    })
  }
  const stats = fs.statSync(outFile)
  console.log(`[pack-extension] Successfully created ${outFile} (${(stats.size / 1024).toFixed(1)} KB)`)
  console.log('[pack-extension] Ready for: Microsoft Edge Add-ons, Chrome Web Store, Firefox AMO, Brave, Arc')
} catch (err) {
  console.error('[pack-extension] Failed to package extension:', err)
  process.exit(1)
}
