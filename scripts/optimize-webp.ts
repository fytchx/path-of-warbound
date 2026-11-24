import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface ManifestAsset {
  id: string;
  file: string;
  category: string;
}

interface Manifest {
  version: string;
  count: number;
  assets: ManifestAsset[];
}

const ROOT = process.cwd();
const MANIFEST_PATH = path.join(ROOT, 'assets/manifest.json');
const OUT_DIR = path.join(ROOT, 'dist-assets-webp');

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function findConverter(): 'cwebp' | 'ffmpeg' | 'convert' | null {
  for (const bin of ['cwebp', 'ffmpeg', 'convert'] as const) {
    try {
      execFileSync('which', [bin], { stdio: 'ignore' });
      return bin;
    } catch {
      /* binary not installed */
    }
  }
  return null;
}

function convertToWebp(src: string, dst: string, tool: 'cwebp' | 'ffmpeg' | 'convert'): void {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (tool === 'cwebp') {
    execFileSync('cwebp', ['-q', '85', src, '-o', dst], { stdio: 'ignore' });
  } else if (tool === 'ffmpeg') {
    execFileSync('ffmpeg', ['-y', '-i', src, '-c:v', 'libwebp', '-quality', '85', dst], { stdio: 'ignore' });
  } else {
    execFileSync('convert', [src, '-quality', '85', dst], { stdio: 'ignore' });
  }
}

export function reportAssets(convert = false): {
  totalFiles: number;
  totalBytes: number;
  byCategory: Record<string, { count: number; bytes: number }>;
  converted: number;
} {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  const byCategory: Record<string, { count: number; bytes: number }> = {};
  let totalBytes = 0;
  let converted = 0;
  const converter = convert ? findConverter() : null;

  for (const asset of manifest.assets) {
    const abs = path.join(ROOT, asset.file);
    const size = fs.existsSync(abs) ? fs.statSync(abs).size : 0;
    totalBytes += size;
    const bucket = (byCategory[asset.category] ??= { count: 0, bytes: 0 });
    bucket.count += 1;
    bucket.bytes += size;

    if (convert && converter && fs.existsSync(abs)) {
      const relOut = asset.file.replace(/^assets\//, '').replace(/\.(png|jpg|jpeg|webp)$/i, '.webp');
      const dst = path.join(OUT_DIR, relOut);
      if (asset.file.endsWith('.webp')) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(abs, dst);
      } else {
        convertToWebp(abs, dst, converter);
      }
      converted += 1;
    }
  }

  return {
    totalFiles: manifest.assets.length,
    totalBytes,
    byCategory,
    converted,
  };
}

const wantsConvert = process.argv.includes('--convert');
const report = reportAssets(wantsConvert);

console.log('\n=== Path of Warbound — Asset Size Report (assets/ unmodified) ===\n');
for (const [category, info] of Object.entries(report.byCategory).sort((a, b) => b[1].bytes - a[1].bytes)) {
  console.log(`${category.padEnd(14)} | ${String(info.count).padStart(3)} files | ${formatSize(info.bytes).padStart(10)}`);
}
console.log('-'.repeat(42));
console.log(`${'TOTAL'.padEnd(14)} | ${String(report.totalFiles).padStart(3)} files | ${formatSize(report.totalBytes).padStart(10)}`);
if (wantsConvert) {
  console.log(`\nConverted ${report.converted} WebP copies into ${path.relative(ROOT, OUT_DIR)}/ (originals in assets/ untouched).`);
}
console.log('');
