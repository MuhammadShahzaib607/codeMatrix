import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { touchProject } from '../models/project.repository.js'
import ApiError from '../utils/ApiError.js'
import asyncHandler from '../utils/asyncHandler.js'
import {
  WORKSPACES_ROOT,
  ensureOwnerContainer,
  findContainerProjectId,
  resolveContainerOwnerPath,
  uniqueNameInFolder,
} from '../utils/workspaceManager.js'

const fsp = fs.promises

export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024
export const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024
export const MAX_UPLOAD_FILES = 40

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.mp4', '.webm', '.pdf',
])

const UPLOAD_TMP_ROOT = path.join(WORKSPACES_ROOT, '.uploads')
const UNSAFE_NAME_CHARS = /[<>:"|?*\u0000-\u001F]/g

export function sanitizeUploadFileName(raw) {
  const name = String(raw ?? '').trim()
  const traversal =
    !name ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\u0000') ||
    name === '.' ||
    name === '..' ||
    name.includes('..')
  if (traversal) {
    throw new ApiError(400, 'That file name is not allowed.', 'INVALID_NAME')
  }

  let cleaned = name.replace(UNSAFE_NAME_CHARS, '-').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (!cleaned) {
    throw new ApiError(400, 'That file name is not allowed.', 'INVALID_NAME')
  }
  if (cleaned.length > 140) {
    const parsed = path.parse(cleaned)
    cleaned = parsed.name.slice(0, 140 - parsed.ext.length) + parsed.ext
  }
  return cleaned
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, req.uploadDir)
  },
  filename(req, file, cb) {
    cb(null, `part-${crypto.randomBytes(8).toString('hex')}`)
  },
})

const uploader = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_FILE_BYTES, files: MAX_UPLOAD_FILES },
  preservePath: true,
})

const receiver = uploader.array('files', MAX_UPLOAD_FILES)

export function removeUploadDir(dir) {
  if (!dir) return
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {}
}

/**
 * Streams a multipart upload into a per-request temp folder that lives OUTSIDE
 * every user container (server/workspaces/.uploads), so nothing transient can
 * ever show up in an Explorer tree. The files are moved into their final folder
 * by uploadContainerFiles, which stays on the same volume — a rename, so the
 * write is atomic.
 */
export function receiveUpload(req, res, next) {
  const dir = path.join(UPLOAD_TMP_ROOT, crypto.randomUUID())
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (error) {
    return next(error)
  }
  req.uploadDir = dir

  receiver(req, res, (error) => {
    if (!error) return next()
    removeUploadDir(dir)
    if (error.code === 'LIMIT_FILE_SIZE') {
      return next(
        new ApiError(413, 'Each file must be 10 MB or smaller.', 'FILE_TOO_LARGE'),
      )
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return next(
        new ApiError(413, `You can upload up to ${MAX_UPLOAD_FILES} files at a time.`, 'TOO_MANY_FILES'),
      )
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new ApiError(400, 'Send every file in a "files" field.', 'INVALID_FIELD'))
    }
    return next(error)
  })
}

async function moveIntoPlace(source, destination) {
  try {
    await fsp.rename(source, destination)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    await fsp.copyFile(source, destination)
    await fsp.unlink(source).catch(() => {})
  }
}

export const uploadContainerFiles = asyncHandler(async (req, res) => {
  const files = Array.isArray(req.files) ? req.files : []
  if (files.length === 0) {
    removeUploadDir(req.uploadDir)
    throw new ApiError(400, 'Choose at least one file to upload.', 'NO_FILES')
  }

  const totalBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0)
  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    removeUploadDir(req.uploadDir)
    throw new ApiError(413, 'That upload is too large (100 MB in total).', 'UPLOAD_TOO_LARGE')
  }

  const targetPath = typeof req.body?.path === 'string' ? req.body.path : ''
  let target
  try {
    target = targetPath
      ? resolveContainerOwnerPath(req.user.id, targetPath)
      : { absolute: ensureOwnerContainer(req.user.id), relative: '', top: '' }
  } catch (error) {
    removeUploadDir(req.uploadDir)
    throw error
  }

  try {
    await assertUploadTarget(target.absolute)
    const prepared = files.map((file) => prepareUpload(file))
    const saved = []
    for (const entry of prepared) {
      const finalName = await uniqueNameInFolder(target.absolute, entry.name)
      await moveIntoPlace(entry.tempPath, path.join(target.absolute, finalName))
      saved.push({
        path: target.relative ? `${target.relative}/${finalName}` : finalName,
        name: finalName,
        bytes: entry.bytes,
      })
    }
    await touchUploadedProject(req.user.id, target)
    res.status(201).json({ count: saved.length, files: saved })
  } finally {
    removeUploadDir(req.uploadDir)
  }
})

async function assertUploadTarget(absolute) {
  const stats = await fsp.stat(absolute).catch(() => null)
  if (!stats?.isDirectory()) {
    throw new ApiError(400, 'The upload target is not a folder.', 'NOT_A_FOLDER')
  }
}

function prepareUpload(file) {
  const name = sanitizeUploadFileName(file.originalname)
  const extension = path.extname(name).toLowerCase()
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    throw new ApiError(
      400,
      `"${name}" is not an allowed file type. Allowed: images, fonts, video and PDF.`,
      'FILE_TYPE_NOT_ALLOWED',
    )
  }
  return { name, tempPath: file.path, bytes: file.size ?? 0 }
}

async function touchUploadedProject(ownerId, target) {
  if (!target.top || !target.relative) return
  try {
    const projectId = findContainerProjectId(ownerId, target.top)
    if (projectId) await touchProject(projectId)
  } catch {}
}
