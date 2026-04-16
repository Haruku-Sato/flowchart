// SVG 文字列 → SVG / PNG ダウンロード
//
// mermaid.render() が返す自己完結した SVG 文字列を受け取る。
// DOM から outerHTML を取る方式と異なり、スタイルが確実に含まれる。

/**
 * SVG 文字列をファイルとしてダウンロード
 * @param {string} svgString
 * @param {string} filename
 */
export function downloadSVG(svgString, filename = 'flowchart.svg') {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
  triggerDownload(URL.createObjectURL(blob), filename)
}

/**
 * SVG 文字列を PNG に変換してダウンロード
 * @param {string} svgString
 * @param {string} filename
 * @param {number} scale  解像度倍率（デフォルト 2 = 2x）
 */
export async function downloadPNG(svgString, filename = 'flowchart.png', scale = 2) {
  // SVG からサイズを取得
  const { width, height } = getSvgDimensions(svgString)

  const canvasW = Math.ceil(width  * scale)
  const canvasH = Math.ceil(height * scale)

  // SVG に明示的な width/height を付けて Blob 化
  const sized = svgString
    .replace(/<svg([^>]*)>/, (_, attrs) => {
      const a = attrs
        .replace(/\bwidth="[^"]*"/, '')
        .replace(/\bheight="[^"]*"/, '')
      return `<svg${a} width="${canvasW}" height="${canvasH}">`
    })

  const svgBlob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl  = URL.createObjectURL(svgBlob)

  await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = canvasW
      canvas.height = canvasH

      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvasW, canvasH)
      ctx.drawImage(img, 0, 0, canvasW, canvasH)

      URL.revokeObjectURL(svgUrl)

      canvas.toBlob((blob) => {
        if (!blob) { reject(new Error('Canvas → Blob 変換失敗')); return }
        triggerDownload(URL.createObjectURL(blob), filename)
        resolve()
      }, 'image/png')
    }
    img.onerror = (e) => {
      URL.revokeObjectURL(svgUrl)
      reject(new Error('SVG → Image 変換失敗'))
    }
    img.src = svgUrl
  })
}

// -------------------------------------------------------
// ユーティリティ
// -------------------------------------------------------

function getSvgDimensions(svgString) {
  // viewBox から取得（例: "0 0 800 600"）
  const vbMatch = svgString.match(/viewBox="([^"]+)"/)
  if (vbMatch) {
    const parts = vbMatch[1].trim().split(/[\s,]+/).map(Number)
    if (parts.length >= 4) return { width: parts[2], height: parts[3] }
  }
  // width / height 属性から取得
  const wMatch = svgString.match(/\bwidth="([^"]+)"/)
  const hMatch = svgString.match(/\bheight="([^"]+)"/)
  return {
    width:  wMatch ? parseFloat(wMatch[1])  : 800,
    height: hMatch ? parseFloat(hMatch[1])  : 600,
  }
}

function triggerDownload(url, filename) {
  const a = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
