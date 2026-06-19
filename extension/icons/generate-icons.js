// generate-icons.js — 在浏览器中打开此文件即可下载图标
// 或者在 Node.js 中运行: node generate-icons.js

const sizes = [16, 48, 128]
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
  <rect width="128" height="128" rx="28" fill="#3B82F6"/>
  <path d="M88 92l-24-16-24 16V40a8 8 0 018-8h32a8 8 0 018 8v52z" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

if (typeof document !== 'undefined') {
  // Browser mode
  sizes.forEach(size => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, size, size)
      const link = document.createElement('a')
      link.download = `icon${size}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    }
    img.src = 'data:image/svg+xml;base64,' + btoa(svg)
  })
} else {
  // Node.js mode — 输出 base64
  const b64 = Buffer.from(svg).toString('base64')
  console.log('SVG base64:', b64)
  console.log('在浏览器中打开 generate-icons.html 自动生成 PNG 图标')
}
