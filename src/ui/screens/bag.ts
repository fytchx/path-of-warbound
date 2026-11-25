import { affixById, gemById, uniqueById } from '../../data';
import {
  affixValue,
  itemBase,
  itemDisplayName,
  RARITY_COLOR,
  RARITY_LABEL,
} from '../../game/items';
import { socketColorCode, socketColorHex } from '../../game/sockets';
import { MATERIAL_ASSET, type ItemInstance, type MaterialId } from '../../game/types';
import type { GameStore } from '../store';
import { assetImg, escapeHtml, fmt, statLabel } from '../dom';

const MATERIAL_INFO: Record<MaterialId, { label: string; use: string }> = {
  gem_dust: { label: 'Gem Dust', use: 'Levels up Active & Support gems' },
  mat_chroma: { label: 'Chromatic Flux', use: 'Reforges or forces socket colors' },
  mat_scrap: { label: 'War-Scrap', use: "Jeweller's Orb (+1 socket)" },
  mat_flux: { label: 'Aether-Flux', use: 'Transmute, Augment & Regal orbs' },
  mat_thread: { label: 'Soul-Thread', use: 'Fusing & Full Link socket links' },
  mat_essence: { label: 'Void-Essence', use: 'Chaos rerolls & Prismatic white' },
};

const MATERIAL_ORDER: MaterialId[] = [
  'gem_dust',
  'mat_chroma',
  'mat_scrap',
  'mat_flux',
  'mat_thread',
  'mat_essence',
];

function gemBarLabel(bar: 'bar_1' | 'bar_2' | 'both'): string {
  return bar === 'both' ? 'BOTH' : bar === 'bar_1' ? 'BAR I' : 'BAR II';
}

function matchesGearFilter(item: ItemInstance, filter: GameStore['ui']['gearFilter']): boolean {
  if (filter === 'all') return true;
  const base = itemBase(item);
  if (filter === 'weapons') return Boolean(base.weapon) || base.slot === 'main_hand' || base.slot === 'off_hand';
  if (filter === 'jewelry') return base.slotTags.includes('ring') || base.slot === 'amulet' || base.slot === 'trinket';
  return base.slot === 'helmet' || base.slot === 'chest' || base.slot === 'gloves' || base.slot === 'legs' || base.slot === 'boots';
}

function formatModShort(stat: string, layer: string, value: number): string {
  const unit = layer === 'more' ? '% more' : layer === 'increased' ? '%' : '';
  return `+${fmt(value, 1)}${unit} ${statLabel(stat)}`;
}

function itemSummaryLines(item: ItemInstance): string[] {
  const base = itemBase(item);
  const lines: string[] = [];
  if (base.weapon) {
    lines.push(`${base.weapon.minDamage}–${base.weapon.maxDamage} dmg · ${base.weapon.attacksPerSecond}/s`);
  } else if (base.implicit.length > 0) {
    const imp = base.implicit[0]!;
    lines.push(formatModShort(imp.stat, imp.layer, imp.value));
  }
  const unique = item.uniqueId ? uniqueById.get(item.uniqueId) : undefined;
  if (unique) {
    lines.push(unique.description);
  }
  for (let i = 0; i < Math.min(2, item.affixes.length); i += 1) {
    const roll = item.affixes[i]!;
    const def = affixById.get(roll.affixId);
    if (!def) continue;
    lines.push(formatModShort(def.stat, def.layer, affixValue(item, i)));
  }
  if (!lines.length && base.description) {
    lines.push(base.description);
  }
  return lines.slice(0, 3);
}

function itemSocketsInline(item: ItemInstance): string {
  if (!item.socketColors.length) return '<span class="tiny muted">No sockets</span>';
  const linked = Math.max(1, item.linkedSockets ?? 1);
  return `<span class="card-sockets" aria-label="${item.sockets.length} sockets, ${Math.min(linked, item.sockets.length)} linked">
    ${item.socketColors
      .map((color, idx) => {
        const filled = Boolean(item.sockets[idx]);
        const linkNext = idx + 1 < linked && idx + 1 < item.sockets.length;
        return `<i class="csoc ${filled ? 'filled' : ''}" style="--pip:${socketColorHex(color)}" title="${color} socket">${socketColorCode(color)}</i>${linkNext ? '<u class="csoc-link"></u>' : ''}`;
      })
      .join('')}
  </span>`;
}

function comparisonFor(store: GameStore, item: ItemInstance): { label: string; cls: string } {
  const gs = store.itemGearscore(item);
  const slots = store.availableSlots(item);
  if (!slots.length) return { label: `GS ${gs}`, cls: 'muted' };
  const emptySlot = slots.find((slot) => !store.save.equipment[slot]);
  if (emptySlot) return { label: 'EMPTY SLOT', cls: 'cmp-up' };
  let bestDelta = -Infinity;
  for (const slot of slots) {
    const worn = store.save.equipment[slot];
    const delta = gs - (worn ? store.itemGearscore(worn) : 0);
    if (delta > bestDelta) bestDelta = delta;
  }
  if (bestDelta > 0) return { label: `+${bestDelta} GS`, cls: 'cmp-up' };
  if (bestDelta < 0) return { label: `${bestDelta} GS`, cls: 'cmp-down' };
  return { label: 'EVEN GS', cls: 'muted' };
}

function gearCardMarkup(store: GameStore, item: ItemInstance): string {
  const base = itemBase(item);
  const name = itemDisplayName(item);
  const unique = item.uniqueId ? uniqueById.get(item.uniqueId) : undefined;
  const color = RARITY_COLOR[item.rarity];
  const gs = store.itemGearscore(item);
  const cmp = comparisonFor(store, item);
  const slotLabel = store.itemSlotLabel(base.slot);
  const lines = itemSummaryLines(item);

  return `<article class="gear-card" data-rarity="${item.rarity}" style="--c:${color}">
    <button class="gear-card-main" data-action="open-item" data-uid="${escapeHtml(item.uid)}" aria-label="Inspect ${escapeHtml(name)}">
      <div class="gear-art">
        ${assetImg(base.assetId, name)}
        ${item.uniqueId ? '<span class="mythic-star" title="Mythic Unique">✦</span>' : ''}
      </div>
      <div class="gear-body">
        <div class="gear-name" style="color:${unique ? '#d8b4fe' : color}">${escapeHtml(name)}</div>
        <div class="gear-sub">${RARITY_LABEL[item.rarity]} ${escapeHtml(slotLabel)} · iLvl ${item.itemLevel}</div>
        <div class="gear-stats">${lines.map((line) => `<span>${escapeHtml(line)}</span>`).join('')}</div>
        ${itemSocketsInline(item)}
      </div>
    </button>
    <div class="gear-side">
      <div class="gear-gs"><b>${gs}</b><span class="${cmp.cls}">${cmp.label}</span></div>
      <button class="gbtn sm gear-equip-btn" data-action="quick-equip" data-uid="${escapeHtml(item.uid)}">Equip</button>
    </div>
  </article>`;
}

export function bagScreen(store: GameStore): string {
  const allItems = store.save.inventory;
  const allGems = store.save.gemStash;
  const activeTab = store.ui.bagTab;
  const gearFilter = store.ui.gearFilter;
  const gemFilter = store.ui.gemFilter;

  const items = allItems
    .filter((item) => matchesGearFilter(item, gearFilter))
    .slice()
    .sort((a, b) => store.itemGearscore(b) - store.itemGearscore(a));

  const indexedGems = allGems
    .map((gem, index) => ({ gem, index, def: gemById.get(gem.gemId) }))
    .filter((entry) => Boolean(entry.def) && (gemFilter === 'all' || entry.def!.color === gemFilter));

  const mainTabs: { id: GameStore['ui']['bagTab']; label: string }[] = [
    { id: 'gear', label: `Gear (${allItems.length})` },
    { id: 'gems', label: `Gems (${allGems.length})` },
    { id: 'materials', label: 'Materials' },
  ];

  const gearFilters: { id: GameStore['ui']['gearFilter']; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'weapons', label: 'Weapons' },
    { id: 'armor', label: 'Armor' },
    { id: 'jewelry', label: 'Jewelry' },
  ];

  const gemFilters: { id: GameStore['ui']['gemFilter']; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'red', label: 'Red' },
    { id: 'green', label: 'Green' },
    { id: 'blue', label: 'Blue' },
    { id: 'white', label: 'White' },
  ];

  let tabBody = '';

  if (activeTab === 'gear') {
    const cards = items.length
      ? `<div class="gear-list">${items.map((item) => gearCardMarkup(store, item)).join('')}</div>`
      : `<div class="empty-note">${allItems.length ? 'No items match this filter.' : 'Your pack is empty. Defeat enemies or clear Boss Caches to find gear.'}</div>`;
    tabBody = `
      <div class="filt-bar" role="tablist">
        ${gearFilters
          .map((t) => `<button role="tab" aria-selected="${gearFilter === t.id}" class="filt-btn ${gearFilter === t.id ? 'on' : ''}" data-action="gear-filter" data-filter="${t.id}">${t.label}</button>`)
          .join('')}
      </div>
      ${cards}`;
  } else if (activeTab === 'gems') {
    const gemCards = indexedGems.length
      ? `<div class="gem-list">${indexedGems
          .map(({ gem, index, def }) => {
            if (!def) return '';
            const isSupport = def.kind === 'support';
            return `<div class="gem-row">
              <button class="gem-inspect-btn" data-action="inspect-gem" data-index="${index}">
                ${assetImg(def.assetId, def.name)}
                <div>
                  <div class="gem-name">${escapeHtml(def.name)} <span class="color-badge ${def.color}">${def.color}</span> <span class="muted tiny">Lv ${gem.level}</span></div>
                  <div class="gem-meta">${escapeHtml(def.description)}</div>
                </div>
              </button>
              ${isSupport
                ? `<span class="gem-kind-tag">SUPPORT</span>`
                : `<button class="gbtn sm" data-action="gem-bar" data-index="${index}" title="Cycle skill bar">${gemBarLabel(gem.bar)}</button>`}
            </div>`;
          })
          .join('')}</div>`
      : `<div class="empty-note">${allGems.length ? 'No gems match this colour filter.' : 'Your gem pouch is empty. Find gems from kills or unsocket one in Altar.'}</div>`;
    tabBody = `
      <div class="filt-bar" role="tablist">
        ${gemFilters
          .map((t) => `<button role="tab" aria-selected="${gemFilter === t.id}" class="filt-btn ${gemFilter === t.id ? 'on' : ''}" data-action="gem-filter" data-filter="${t.id}">${t.label}</button>`)
          .join('')}
      </div>
      ${gemCards}`;
  } else {
    tabBody = `
      <div class="frame pan">
        <h4>Rift Keys<span>${store.save.keys} / 3 held</span></h4>
        <div class="row" style="align-items:center">
          <span style="display:inline-flex;align-items:center;gap:8px">
            ${assetImg('key_rift', 'Rift Key', 'key-icon')}
            <span>3 Rift Keys summon the Zone Boss in Combat.</span>
          </span>
          <b class="gold">${store.save.keys}/3</b>
        </div>
      </div>
      <div class="mat-grid">
        ${MATERIAL_ORDER.map((id) => {
          const info = MATERIAL_INFO[id];
          return `<div class="frame mat-card">
            ${assetImg(MATERIAL_ASSET[id], info.label)}
            <div class="mat-meta">
              <div class="mat-top"><b>${escapeHtml(info.label)}</b><span class="gold">${fmt(store.save.materials[id] ?? 0)}</span></div>
              <div class="tiny muted">${escapeHtml(info.use)}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }

  return `<section class="screen" data-screen="bag" aria-label="Bag">
    <div class="frame bag-head">
      <div class="bag-wallet">
        <span class="wallet-chip">${assetImg('currency_gold', 'Gold')}<b>${fmt(store.save.gold)}</b><small>Gold</small></span>
        <span class="wallet-chip">${assetImg('key_rift', 'Rift Keys')}<b>${store.save.keys}/3</b><small>Keys</small></span>
        <span class="wallet-chip">${assetImg(MATERIAL_ASSET.gem_dust, 'Gem Dust')}<b>${fmt(store.save.materials.gem_dust ?? 0)}</b><small>Dust</small></span>
      </div>
      <button class="gbtn sm ${store.save.autoSalvage ? 'on' : ''}" data-action="toggle-auto-salvage" title="Automatically salvage Common drops into War-Scrap">${store.save.autoSalvage ? 'Auto-Salvage: ON' : 'Auto-Salvage'}</button>
    </div>

    <div class="subtabs" role="tablist" aria-label="Bag sections">
      ${mainTabs
        .map((t) => `<button role="tab" aria-selected="${activeTab === t.id}" class="subtab ${activeTab === t.id ? 'on' : ''}" data-action="bag-tab" data-tab="${t.id}">${t.label}</button>`)
        .join('')}
    </div>

    ${tabBody}
  </section>`;
}
