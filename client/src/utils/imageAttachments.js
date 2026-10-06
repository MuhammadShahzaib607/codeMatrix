export const MAX_IMAGES = 5
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const ACCEPT_ATTRIBUTE = 'image/png,image/jpeg,image/webp'
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024
export const MAX_DIMENSION = 1280
export const OUTPUT_QUALITY = 0.8

function newId() {
  try {
    return crypto.randomUUID()
  } catch {
    return `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  }
}

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as an image.'))
    }
    image.src = url
  })
}

export function isAcceptedImage(file) {
  return Boolean(file) && ACCEPTED_IMAGE_TYPES.includes(file.type)
}

export async function processImageFile(file) {
  if (!file) throw new Error('That attachment was empty.')
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error(`${file.name || 'That file'} is not a png, jpg or webp image.`)
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(
      `${file.name || 'That image'} is larger than ${Math.round(MAX_SOURCE_BYTES / (1024 * 1024))}MB. Use a smaller file.`,
    )
  }

  const bitmap = await loadBitmap(file)
  const width = bitmap.width || 1
  const height = bitmap.height || 1
  const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, 0, 0, targetWidth, targetHeight)
  if (typeof bitmap.close === 'function') bitmap.close()

  const dataUrl = canvas.toDataURL('image/jpeg', OUTPUT_QUALITY)
  const comma = dataUrl.indexOf(',')
  const bytes = Math.round(((dataUrl.length - comma - 1) * 3) / 4)

  return {
    id: newId(),
    name: file.name || 'pasted-image.jpg',
    dataUrl,
    mime: 'image/jpeg',
    width: targetWidth,
    height: targetHeight,
    bytes,
  }
}

export function pickImageFiles(list) {
  return Array.from(list ?? []).filter(isAcceptedImage)
}
