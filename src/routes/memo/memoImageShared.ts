import type { Types } from 'mongoose';

import { ModelMemoFile } from '../../schema/schemaMemo/SchemaMemoFile.schema';
import { deleteFileByPath } from '../upload/uploadFileS3ForFeatures';

export const MAX_IMAGES_PER_NOTE = 25;
export const MAX_IMAGE_DATA_URL_LENGTH = 450_000;
export const MAX_IMAGE_STORAGE_PATH_LENGTH = 2048;

/**
 * Uploaded file paths look like `ai-notes-xyz/{username}/features/{parentEntityId}/{id}.ext`.
 */
export function isValidMemoImageStoragePath(storagePath: string): boolean {
  if (!storagePath.startsWith('ai-notes-xyz/')) return false;
  if (storagePath.length > MAX_IMAGE_STORAGE_PATH_LENGTH) return false;
  if (storagePath.includes('..') || storagePath.includes('\\')) return false;
  if (/[\s\n\r]/.test(storagePath)) return false;
  if (/[\u0000-\u001f\u007f-\u009f]/.test(storagePath)) return false;
  return true;
}

/** Accepts inline data URLs or uploaded storage paths (`ai-notes-xyz/...`). */
export function parseMemoImageField(imageInput: unknown): { ok: true; value: string } | { ok: false; message: string } {
  if (imageInput === undefined || imageInput === null) return { ok: true, value: '' };
  if (typeof imageInput !== 'string') return { ok: false, message: 'Each image must be a string' };
  const trimmedImageValue = imageInput.trim();
  if (trimmedImageValue === '') return { ok: true, value: '' };
  if (trimmedImageValue.startsWith('data:image/')) {
    if (trimmedImageValue.length > MAX_IMAGE_DATA_URL_LENGTH) {
      return { ok: false, message: 'Image is too large; try a smaller photo' };
    }
    return { ok: true, value: trimmedImageValue };
  }
  if (trimmedImageValue.startsWith('ai-notes-xyz/')) {
    if (!isValidMemoImageStoragePath(trimmedImageValue)) {
      return { ok: false, message: 'Invalid image path' };
    }
    return { ok: true, value: trimmedImageValue };
  }
  return { ok: false, message: 'image must be a data URL or an uploaded file path' };
}

/** Legacy `imageDataUrls` array on memo document (before memoFiles collection). */
export function normalizeMemoImageUrlsFromDoc(doc: Record<string, unknown>): string[] {
  const imageDataUrlsRaw = doc.imageDataUrls;
  if (!Array.isArray(imageDataUrlsRaw) || imageDataUrlsRaw.length === 0) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const imageItem of imageDataUrlsRaw) {
    if (typeof imageItem !== 'string' || !imageItem.trim()) continue;
    const trimmedImageValue = imageItem.trim();
    if (seen.has(trimmedImageValue)) continue;
    seen.add(trimmedImageValue);
    out.push(trimmedImageValue);
  }
  return out;
}

export function parseMemoImageUrls(imageDataUrlsInput: unknown): { ok: true; values: string[] } | { ok: false; message: string } {
  if (imageDataUrlsInput === undefined || imageDataUrlsInput === null) {
    return { ok: true, values: [] };
  }
  if (!Array.isArray(imageDataUrlsInput)) {
    return { ok: false, message: 'imageDataUrls must be an array' };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const imageItem of imageDataUrlsInput) {
    const parsed = parseMemoImageField(imageItem);
    if (!parsed.ok) {
      return { ok: false, message: parsed.message };
    }
    if (parsed.value === '') continue;
    if (seen.has(parsed.value)) continue;
    seen.add(parsed.value);
    out.push(parsed.value);
    if (out.length > MAX_IMAGES_PER_NOTE) {
      return { ok: false, message: `At most ${MAX_IMAGES_PER_NOTE} images per memo` };
    }
  }
  return { ok: true, values: out };
}

/** Parses `ai-notes-xyz/{username}/features/{parentEntityId}/{fileName}` for `deleteFileByPath`. */
export function parseFeatureUploadPathForDelete(
  username: string,
  fileUploadPath: string,
): { parentEntityId: string; fileName: string } | null {
  const prefix = `ai-notes-xyz/${username}/features/`;
  const trimmedUploadPath = fileUploadPath.trim();
  if (!trimmedUploadPath.startsWith(prefix)) return null;
  const rest = trimmedUploadPath.slice(prefix.length);
  const i = rest.indexOf('/');
  if (i <= 0 || i === rest.length - 1) return null;
  const parentEntityId = rest.slice(0, i);
  const fileName = rest.slice(i + 1);
  if (!fileName || fileName.includes('..')) return null;
  return { parentEntityId, fileName };
}

/** Delete `memoFiles` rows + storage for those paths; also extra legacy `ai-notes-xyz/` paths on the memo document. */
export async function deleteAllMemoFilesAndLegacyStorage(
  username: string,
  doc: Record<string, unknown>,
  memoId: Types.ObjectId,
): Promise<void> {
  const rows = await ModelMemoFile.find({ username, memoNoteId: memoId }).lean();
  const pathsFromFiles = rows.map((r) => r.filePath);
  await ModelMemoFile.deleteMany({ username, memoNoteId: memoId });
  await deleteMemoStoredImagePathsByFullPaths(username, pathsFromFiles);

  const legacy = normalizeMemoImageUrlsFromDoc(doc);
  const fromFilesSet = new Set(pathsFromFiles);
  const extraLegacyStorage = legacy.filter((p) => p.startsWith('ai-notes-xyz/') && !fromFilesSet.has(p));
  await deleteMemoStoredImagePathsByFullPaths(username, extraLegacyStorage);
}

export async function deleteMemoStoredImagePathsByFullPaths(username: string, pathsToDelete: string[]): Promise<void> {
  const seen = new Set<string>();
  for (const p of pathsToDelete) {
    const pt = typeof p === 'string' ? p.trim() : '';
    if (!pt || seen.has(pt)) continue;
    seen.add(pt);
    if (!pt.startsWith(`ai-notes-xyz/${username}/`)) {
      console.error(`deleteMemoStoredImagePathsByFullPaths: rejected path (not owned by user): ${pt}`);
      continue;
    }
    const parsed = parseFeatureUploadPathForDelete(username, pt);
    if (!parsed) {
      console.error(`deleteMemoStoredImagePathsByFullPaths: skip path (not features layout): ${pt}`);
      continue;
    }
    const r = await deleteFileByPath({ username, ...parsed });
    if (!r.success) {
      console.error(`deleteMemoStoredImagePathsByFullPaths: could not delete ${pt}: ${r.error}`);
    }
  }
}

/** Merge ordered paths from `memoFiles` with legacy inline / embedded URLs still on the memo document. */
export function mergeMemoFilePathsAndLegacyDoc(pathsFromFiles: string[], rawDoc: Record<string, unknown>): string[] {
  const legacy = normalizeMemoImageUrlsFromDoc(rawDoc);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of pathsFromFiles) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  for (const p of legacy) {
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}
