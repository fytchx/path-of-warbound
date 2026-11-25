import { gemById } from '../../data';
import { itemBase, RARITY_COLOR, RARITY_LABEL } from '../../game/items';
import { socketColorCode, socketColorHex } from '../../game/sockets';
import { MATERIAL_ASSET, MATERIAL_IDS, type MaterialId } from '../../game/types';
import type { GameStore } from '../store';
import { assetImg, escapeHtml, fmt, sprite } from '../dom';

const MATERIAL_LABEL: Record<MaterialId, string> = {
  mat_scrap: 'War-Scrap',
  mat_flux: 'Aether-Flux',
  mat_thread: 'Soul-Thread',
  mat_essence: 'Void-Essence',
  mat_chroma: 'Chromatic Flux',
  gem_dust: 'Gem Dust',
};

const CURRENCY: MaterialId[] = ['gem_dust', 'mat_chroma', 'mat_scrap', 'mat_flux', 'mat_thread', 'mat_essence'];

function gemBarLabel(bar: 'bar_1' | 'bar_2' | 'both'): string {
  return bar === 'both' ? 'BOTH' : bar === 'bar_1' ? 'BAR I' : 'BAR II';
}

function socketPips(item: { socketColors: string[]; sockets: (unknown | null)[] }): string {
  if (!item.socketColors.length) return '<span class="muted tiny">no sockets</span>';
  return `<span class="pip-row">${item.socketColors
    .map((color, index) => {
      const socketColor = color as 'red' | 'green' | 'blue' | 'white';
      return `<i class="pip ${item.sockets[index] ? 'filled' : ''}" style="--pip:${socketColorHex(socketColor)}" title="${socketColor} socket">${socketColorCode(socketColor)}</i>`;
    })
    .join('')}</span>`;
}

export function bagScreen(store: GameStore): string {
  const items = store.save.inventory;
  const gems = store.save.gemStash;

  const gearList = items.length
    ? items
        .map((item) => {
          const base = itemBase(item);
          const color = RARITY_COLOR[item.rarity];
          return `<button class="cell bag-cell" data-action="open-item" data-uid="${escapeHtml(item.uid)}" data-rarity="${item.rarity}" style="--c:${color}" title="${escapeHtml(base.name)} · ${RARITY_LABEL[item.rarity]}">
            ${sprite('w-slot', 'slot-frame', '0 0 48 48', `--g:${color}`)}
            ${assetImg(base.assetId, base.name)}
            <span class="gs">${store.itemGearscore(item)}</span>
            ${socketPips(item)}
          </button>`;
        })
        .join('')
    : `<div class="empty-note">No loose gear. Drops appear from normal kills; open the Forge to craft what you find.</div>`;

  const gemList = gems.length
    ? gems
        .map((gem, index) => {
          const def = gemById.get(gem.gemId);
          if (!def) return '';
          return `<div class="gem-row split-row">
            <button class="gem-inspect-btn" data-action="inspect-gem" data-index="${index}">
              ${assetImg(def.assetId, def.name)}
              <div>
                <div class="gem-name">${escapeHtml(def.name)}</div>
                <div class="gem-meta"><span class="color-badge ${def.color}">${def.color}</span> Lv ${gem.level} · ${gemBarLabel(gem.bar)}</div>
              </div>
            </button>
            <button class="gbtn sm" data-action="gem-bar" data-index="${index}" title="Move to the other skill bar">${gemBarLabel(gem.bar)}</button>
          </div>`;
        })
        .join('')
    : `<div class="empty-note">The gem pouch is empty. Find gems from kills or unsocket one from gear.</div>`;

  const materials = MATERIAL_IDS.map(
    (id) => `<div class="material" title="${escapeHtml(MATERIAL_LABEL[id])}">
      ${assetImg(MATERIAL_ASSET[id], MATERIAL_LABEL[id])}
      <b>${fmt(store.save.materials[id] ?? 0)}</b>
      <span>${escapeHtml(MATERIAL_LABEL[id])}</span>
    </div>`,
  ).join('');

  return `<section class="screen" data-screen="bag" aria-label="Bag">
    <div class="frame cur cur-strip">
      <span class="cur-gold">${assetImg('currency_gold', 'Gold')}<b>${fmt(store.save.gold)}</b><em>Gold</em></span>
      ${CURRENCY.map(
        (id) => `<span>${assetImg(MATERIAL_ASSET[id], MATERIAL_LABEL[id])}<b>${fmt(store.save.materials[id] ?? 0)}</b><em>${escapeHtml(MATERIAL_LABEL[id])}</em></span>`,
      ).join('')}
    </div>

    <div class="split-panes">
      <div class="frame pan split-pane">
        <h4>GEAR<span>${items.length} loose</span></h4>
        <div class="bag pane-scroll">${gearList}</div>
      </div>
      <div class="frame pan split-pane">
        <h4>GEMS<span>${gems.length} held</span></h4>
        <div class="gem-list pane-scroll">${gemList}</div>
      </div>
    </div>

    <div class="frame pan">
      <h4>Rift Keys &amp; Materials<span>${store.save.keys}/3 active keys</span></h4>
      <div class="row" style="align-items:center;margin-bottom:6px">
        <span style="display:inline-flex;align-items:center;gap:6px">${assetImg('key_rift', 'Rift Key', 'key-icon')} Rift Keys</span>
        <span class="gold">${store.save.keys} held (3 summons the zone boss)</span>
      </div>
      <div class="material-row">${materials}</div>
      <div class="row" style="margin-top:8px">
        <button class="gbtn sm ${store.save.autoSalvage ? 'on' : ''}" data-action="toggle-auto-salvage" title="Automatically salvage Common item drops into scrap">AUTO-SALVAGE</button>
      </div>
    </div>
  </section>`;
}
