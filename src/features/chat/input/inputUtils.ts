import { extToMime } from '../../../utils/tauri'
import type { FileCapabilities } from '../../../api'

// ============================================
// 文本样式常量
// ============================================

export const TEXT_STYLE: React.CSSProperties = {
  fontFamily: 'var(--font-ui-sans)',
  fontSize: 'var(--fs-base)',
  fontWeight: 400,
  lineHeight: '1.43',
  letterSpacing: 'normal',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowWrap: 'break-word',
}

// ============================================
// detectSlashTrigger - 检测斜杠命令触发
// 只在文本最开头触发
// ============================================

export function detectSlashTrigger(text: string, cursorPos: number): { query: string; startIndex: number } | null {
  // 斜杠命令只能在文本最开头
  if (!text.startsWith('/')) return null

  // 提取 / 之后到光标的文本作为 query
  const query = text.slice(1, cursorPos)

  // 如果 query 中包含空格或换行，说明命令已经输入完毕
  if (query.includes(' ') || query.includes('\n')) {
    return null
  }

  return { query, startIndex: 0 }
}

// ============================================
// File helpers
// ============================================

/** 检查文件 MIME 类型是否被当前模型能力支持 */
export function isFileSupported(mime: string, caps: FileCapabilities): boolean {
  if (mime.startsWith('image/')) return caps.image
  if (mime === 'application/pdf') return caps.pdf
  if (mime.startsWith('audio/')) return caps.audio
  if (mime.startsWith('video/')) return caps.video
  return false
}

export function ensureFileMime(file: File): File {
  if (file.type) return file

  const ext = file.name.split('.').pop()?.toLowerCase() || ''
  const mime = extToMime(ext)
  if (!mime || mime === 'application/octet-stream') return file

  return new File([file], file.name, {
    type: mime,
    lastModified: file.lastModified,
  })
}

export function getMimeFromPath(path: string): string {
  const fileName = path.split(/[/\\]/).pop() || path
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return extToMime(ext)
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const chunkSize = 0x8000
  let binary = ''

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }

  return `data:${mime};base64,${btoa(binary)}`
}

/** 读取文件为 data URL */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => resolve(e.target?.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ============================================
// 图片压缩
//
// 直接把原图读成 data URL 会让附件体积膨胀约 1.33 倍，大图还会在每次
// 输入框 state 更新时参与 diff。这里在入图前统一做一次缩放 + 转码：
// - 最长边限制到 MAX_IMAGE_EDGE
// - 统一输出 WebP（体积显著小于 PNG/JPEG）
// - 使用 createImageBitmap + OffscreenCanvas，解码/编码都在主线程之外
//
// 只处理静态位图；GIF（动图）、SVG（矢量）以及非图片一律原样返回。
// 任何一步失败都回退原图，不阻塞入图。
// ============================================

/** 触发压缩的最小字节数：小图不值得付出重编码开销 */
const IMAGE_COMPRESS_THRESHOLD_BYTES = 512 * 1024
/** 压缩后最长边上限 */
const MAX_IMAGE_EDGE = 2048
/** WebP 编码质量 */
const IMAGE_WEBP_QUALITY = 0.85

/** 不适合重编码的图片类型（动图 / 矢量） */
function isCompressibleImageType(mime: string): boolean {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp' || mime === 'image/bmp'
}

async function canvasToBlob(canvas: OffscreenCanvas, type: string, quality: number): Promise<Blob | null> {
  return canvas.convertToBlob({ type, quality })
}

/**
 * 压缩图片文件。返回 data URL 与最终 MIME。
 * 条件不满足或处理失败时返回原始 data URL。
 */
export async function compressImageFile(file: File): Promise<{ dataUrl: string; mime: string }> {
  const original = { dataUrl: await readFileAsDataUrl(file), mime: file.type }

  if (!isCompressibleImageType(file.type)) return original
  if (typeof createImageBitmap !== 'function') return original
  if (file.size < IMAGE_COMPRESS_THRESHOLD_BYTES) return original

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)

    const longestEdge = Math.max(bitmap.width, bitmap.height)
    const scale = longestEdge > MAX_IMAGE_EDGE ? MAX_IMAGE_EDGE / longestEdge : 1
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale))
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale))

    // 无需缩放且已经足够小：不值得重编码（避免 WebP 反而变大）
    if (scale === 1 && file.size < IMAGE_COMPRESS_THRESHOLD_BYTES * 2) return original

    const canvas = new OffscreenCanvas(targetWidth, targetHeight)
    const ctx = canvas.getContext('2d')
    if (!ctx) return original
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)

    const blob = await canvasToBlob(canvas, 'image/webp', IMAGE_WEBP_QUALITY)
    if (!blob) return original
    // 压缩结果没有变小就保留原图
    if (blob.size >= file.size) return original

    const compressedUrl = bytesToDataUrl(new Uint8Array(await blob.arrayBuffer()), 'image/webp')
    return { dataUrl: compressedUrl, mime: 'image/webp' }
  } catch {
    return original
  } finally {
    bitmap?.close()
  }
}
