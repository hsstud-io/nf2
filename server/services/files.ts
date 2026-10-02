import fs from 'fs';
import path from 'path';

const FILES_DIR = process.env.FILES_DIR || '/app/dados/nfe';

export function ensureDirForFile(filePath: string): string {
  const fullPath = path.join(FILES_DIR, filePath);
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  return fullPath;
}

export function saveFile(relativePath: string, data: Buffer): string {
  const fullPath = ensureDirForFile(relativePath);
  fs.writeFileSync(fullPath, data);
  return fullPath;
}

export function readFile(relativePath: string): Buffer {
  const fullPath = path.join(FILES_DIR, relativePath);
  return fs.readFileSync(fullPath);
}

export function fileExists(relativePath: string): boolean {
  const fullPath = path.join(FILES_DIR, relativePath);
  return fs.existsSync(fullPath);
}

export function getFilesDir(): string {
  return FILES_DIR;
}
