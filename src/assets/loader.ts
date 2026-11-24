import {
  ALL_ASSET_IDS,
  ASSET_IDS_BY_CATEGORY,
  ASSETS,
  isAssetId,
  type AssetCategory,
  type AssetId,
  type AssetMeta,
} from './assetIds';

const BASE = import.meta.env.BASE_URL;

export { ALL_ASSET_IDS, ASSET_IDS_BY_CATEGORY, ASSETS, isAssetId };
export type { AssetCategory, AssetId, AssetMeta };

/** Resolves a manifest entry to a URL. Art is never referenced by raw path. */
export function assetUrl(id: AssetId): string {
  const meta = ASSETS[id];
  if (!meta) throw new Error(`Unknown asset id: ${String(id)}`);
  return `${BASE}${meta.file}`;
}

export function assetMeta(id: AssetId): AssetMeta {
  return ASSETS[id];
}

export function assetsOf(category: AssetCategory): AssetId[] {
  return ASSET_IDS_BY_CATEGORY[category];
}

const preloaded = new Set<AssetId>();

/** Preloads every file in the given categories; resolves when all settle. */
export async function preloadCategories(categories: AssetCategory[]): Promise<void> {
  const ids = categories.flatMap((c) => ASSET_IDS_BY_CATEGORY[c]).filter((id) => !preloaded.has(id));
  await Promise.all(
    ids.map(
      (id) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            preloaded.add(id);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = assetUrl(id);
        }),
    ),
  );
}

export function preloadAll(): Promise<void> {
  return preloadCategories(Object.keys(ASSET_IDS_BY_CATEGORY) as AssetCategory[]);
}

export function spriteSymbol(id: string): string {
  return `#${id}`;
}
