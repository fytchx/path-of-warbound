import { gemById } from '../../data';
import { itemBase, RARITY_COLOR, RARITY_LABEL } from '../../game/items';
import { MATERIAL_ASSET, MATERIAL_IDS, type MaterialId } from '../../game/types';
import type { BagFilter, GameStore } from '../store';
import { assetImg, escapeHtml, fmt, sprite } from '../dom';

const FILTERS: { id: BagFilter; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'gear', label: 'GEAR' },
  { id: 'gems', label: 'GEMS' },
  { id: 'keys', label: 'KEYS' },
];

const MATERIAL_LABEL: Record<MaterialId, string> = {
  mat_scrap: 'Scrap',
  mat_flux: 'Flux',
  mat_thread: 'Thread',
  mat_essence: 'Essence',
  gem_dust: 'Gem Dust',
};

const CURRENCY: MaterialId[] = ['mat_scrap', 'mat_flux', 'mat_thread', 'mat_essence'];

function gemBarLabel(bar: 'bar_1' | 'bar_2' | 'both'): string {
  return bar === 'both' ? 'BOTH' : bar === 'bar_1' ? 'BAR I' : 'BAR II';
}

export function bagScreen(store: GameStore): string {
  const filter = store.ui.bagFilter;
  const items = filter === 'gems' || filter === 'keys' ? [] : store.save.inventory;
  const showGearGrid = filter === 'all' || filter === 'gear';
  const showGems = filter === 'all' || filter === 'gems';
  const showKeys = filter === 'all' || filter === 'keys';

  const slotCells = Array.from({ length: Math.max(30, items.length) }, (_, idx) => {
    const item = items[idx];
    if (!item) {
      return `<div class="cell empty-cell" aria-hidden="true">
        ${sprite('w-slot', 'slot-frame', '0 0 48 48', '--g:rgba(109,95,46,0.35)')}
      </div>`;
    }
    const base = itemBase(item);
    const color = RARITY_COLOR[item.rarity];
    return `<button class="cell" data-action="open-item" data-uid="${escapeHtml(item.uid)}" data-rarity="${item.rarity}" style="--c:${color}" title="${escapeHtml(base.name)} · ${RARITY_LABEL[item.rarity]}">
      ${sprite('w-slot', 'slot-frame', '0 0 48 48', `--g:${color}`)}
      ${assetImg(base.assetId, base.name)}
      <span class="gs">${store.itemGearscore(item)}</span>
    </button>`;
  }).join('');

  const grid = showGearGrid ? `<div class="bag">${slotCells}</div>` : '';

  const materials = MATERIAL_IDS.map(
    (id) => `<div class="material" title="${escapeHtml(MATERIAL_LABEL[id])}">
      ${assetImg(MATERIAL_ASSET[id], MATERIAL_LABEL[id])}
      <b>${fmt(store.save.materials[id] ?? 0)}</b>
      <span>${escapeHtml(MATERIAL_LABEL[id])}</span>
    </div>`,
  ).join('');

  const gemsMarkup = showGems
    ? `<div class="frame pan">
        <h4>Gem Pouch<span>${store.save.gemStash.length} held · tap to inspect</span></h4>
        ${store.save.gemStash.length
          ? `<div class="gem-list">${store.save.gemStash
              .map((gem, index) => {
                const def = gemById.get(gem.gemId);
                if (!def) return '';
                return `<div class="gem-row">
                  <button class="gem-inspect-btn" data-action="inspect-gem" data-index="${index}">
                    ${assetImg(def.assetId, def.name)}
                    <div>
                      <div class="gem-name">${escapeHtml(def.name)} <span class="muted tiny">Lv ${gem.level}</span></div>
                      <div class="gem-meta">${escapeHtml(def.kind)} · ${gem.xp} XP · ${gemBarLabel(gem.bar)}</div>
                    </div>
                  </button>
                  <button class="gbtn sm" data-action="gem-bar" data-index="${index}">${gemBarLabel(gem.bar)}</button>
                </div>`;
              })
              .join('')}</div>`
          : `<div class="empty-note">The gem pouch is empty. Find gems from monsters or unsocket one from gear.</div>`}
      </div>`
    : '';

  const keysMarkup = showKeys
    ? `<div class="frame pan">
        <h4>Rift Keys & Materials<span>${store.save.keys}/3 active keys</span></h4>
        <div class="row" style="align-items:center;margin-bottom:6px">
          <span style="display:inline-flex;align-items:center;gap:6px">${assetImg('key_rift', 'Rift Key', 'key-icon')} Rift Keys</span>
          <span class="gold">${store.save.keys} held (3 summons Zone Boss)</span>
        </div>
        <div class="material-row">${materials}</div>
      </div>`
    : '';

  return `<section class="screen" data-screen="bag" aria-label="Bag">
    <div class="frame cur">
      <span>${assetImg('currency_gold', 'Gold')}<b>${fmt(store.save.gold)}</b></span>
      ${CURRENCY.map(
        (id) => `<span>${assetImg(MATERIAL_ASSET[id], MATERIAL_LABEL[id])}<b>${fmt(store.save.materials[id] ?? 0)}</b></span>`,
      ).join('')}
    </div>

    <div class="filt">
      ${FILTERS.map(
        (entry) => `<button class="gbtn sm ${filter === entry.id ? 'on' : ''}" data-action="bag-filter" data-filter="${entry.id}">${entry.label}</button>`,
      ).join('')}
      <button class="gbtn sm ${store.save.autoSalvage ? 'on' : ''}" data-action="toggle-auto-salvage" title="Automatically salvage Common item drops into scrap">AUTO-SALVAGE</button>
      <span class="tiny muted" style="margin-left:auto">${store.save.inventory.length} gear · ${store.save.keys} keys</span>
    </div>

    ${grid}
    ${gemsMarkup}
    ${keysMarkup}
  </section>`;
}
