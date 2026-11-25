import { affixById, gemById, uniqueById } from '../../data';
import type { ItemInstance, MaterialId } from '../../game/types';
import { MATERIAL_ASSET } from '../../game/types';
import { socketCap } from '../../game/crafting';
import { affixValue, itemBase, itemDisplayName, RARITY_COLOR, RARITY_LABEL } from '../../game/items';
import { socketColorCode, socketColorHex } from '../../game/sockets';
import type { CurrencyOrb, ForgeTab, GameStore } from '../store';
import { assetImg, escapeHtml, fmt, sprite, statLabel } from '../dom';

interface OrbSpec {
  id: CurrencyOrb;
  label: string;
  blurb: string;
  costs: Partial<Record<MaterialId, number>>;
  costLabel: string;
}

const AFFIX_ORBS: OrbSpec[] = [
  { id: 'transmute', label: 'Transmute Orb', blurb: 'Common → Magic', costs: { mat_flux: 2 }, costLabel: '2 Flux' },
  { id: 'augment', label: 'Augment Orb', blurb: 'Magic +1 affix', costs: { mat_flux: 2 }, costLabel: '2 Flux' },
  { id: 'regal', label: 'Regal Orb', blurb: 'Magic → Rare', costs: { mat_flux: 3, mat_essence: 1 }, costLabel: '3 Flux · 1 Ess' },
  { id: 'chaos', label: 'Chaos Orb', blurb: 'Reroll Rare', costs: { mat_essence: 2 }, costLabel: '2 Essence' },
];

const SOCKET_ORBS: OrbSpec[] = [
  { id: 'jeweller', label: "Jeweller's Orb", blurb: '+1 Socket', costs: { mat_scrap: 3 }, costLabel: '3 Scrap' },
  { id: 'fusing', label: 'Fusing Orb', blurb: '+Links (safe)', costs: { mat_thread: 2 }, costLabel: '2 Thread' },
  { id: 'full-link', label: 'Full Link Forge', blurb: 'Max all links', costs: { mat_thread: 6, mat_flux: 2 }, costLabel: '6 Thread · 2 Flux' },
];

const MAT_SHORT: Record<MaterialId, string> = {
  mat_scrap: 'Scrap',
  mat_flux: 'Flux',
  mat_thread: 'Thread',
  mat_essence: 'Essence',
  mat_chroma: 'Chroma',
  gem_dust: 'Dust',
};

function canPayMap(store: GameStore, costs: Partial<Record<MaterialId, number>>): boolean {
  return Object.entries(costs).every(([id, amt]) => (store.save.materials[id as MaterialId] ?? 0) >= (amt ?? 0));
}

function orbEligibility(store: GameStore, item: ItemInstance, spec: OrbSpec): { disabled: boolean; reason: string } {
  if (item.corrupted) return { disabled: true, reason: 'Corrupted' };
  const cap = socketCap(item);
  const sockets = item.sockets.length;
  const links = Math.max(1, Math.min(sockets, item.linkedSockets ?? 1));

  switch (spec.id) {
    case 'transmute':
      if (item.rarity !== 'common') return { disabled: true, reason: 'Needs Common' };
      break;
    case 'augment':
      if (item.rarity !== 'magic') return { disabled: true, reason: 'Needs Magic' };
      if (item.affixes.length >= 2) return { disabled: true, reason: 'At 2 affixes' };
      break;
    case 'regal':
      if (item.rarity !== 'magic') return { disabled: true, reason: 'Needs Magic' };
      break;
    case 'chaos':
      if (item.rarity !== 'rare') return { disabled: true, reason: 'Needs Rare' };
      break;
    case 'jeweller':
      if (sockets >= cap) return { disabled: true, reason: `Max (${cap})` };
      break;
    case 'fusing':
      if (sockets < 2) return { disabled: true, reason: 'Need 2+ soc' };
      if (links >= sockets) return { disabled: true, reason: 'Fully linked' };
      break;
    case 'full-link':
      if (sockets < 2) return { disabled: true, reason: 'Need 2+ soc' };
      if (links >= sockets) return { disabled: true, reason: 'Fully linked' };
      break;
  }

  if (!canPayMap(store, spec.costs)) return { disabled: true, reason: spec.costLabel };
  return { disabled: false, reason: spec.blurb };
}

function pickerItems(store: GameStore): ItemInstance[] {
  const seen = new Set<string>();
  const items: ItemInstance[] = [];
  for (const item of Object.values(store.save.equipment)) {
    if (item && !seen.has(item.uid)) {
      seen.add(item.uid);
      items.push(item);
    }
  }
  for (const item of store.save.inventory) {
    if (!seen.has(item.uid)) {
      seen.add(item.uid);
      items.push(item);
    }
  }
  return items;
}

export function forgeScreen(store: GameStore): string {
  const items = pickerItems(store);
  const selected = store.forgeItem();
  const activeTab: ForgeTab = store.ui.forgeTab;

  const picker = items.length
    ? `<div class="frame forge-picker">${items
        .map((item) => {
          const base = itemBase(item);
          const name = itemDisplayName(item);
          const equipped = Object.values(store.save.equipment).some((entry) => entry?.uid === item.uid);
          return `<button class="forge-pick ${selected?.uid === item.uid ? 'active' : ''}" data-action="forge-select" data-uid="${escapeHtml(item.uid)}" data-rarity="${item.rarity}" style="--c:${RARITY_COLOR[item.rarity]}" title="${escapeHtml(name)}${equipped ? ' (equipped)' : ''}">
            ${assetImg(base.assetId, name)}
            ${equipped ? '<span class="pick-eq">EQ</span>' : `<span class="pick-gs">${store.itemGearscore(item)}</span>`}
          </button>`;
        })
        .join('')}</div>`
    : `<div class="empty-note">Nothing to work yet. Clear a wave or defeat a boss first.</div>`;

  let heroCard = `<div class="frame currency-bench"><div class="empty-note">Choose an item from the rack above to place it on the bench.</div></div>`;
  let tabSection = '';

  if (selected) {
    const base = itemBase(selected);
    const title = itemDisplayName(selected);
    const unique = selected.uniqueId ? uniqueById.get(selected.uniqueId) : undefined;
    const equipped = Object.values(store.save.equipment).some((entry) => entry?.uid === selected.uid);
    const cap = socketCap(selected);
    const links = selected.sockets.length > 0 ? Math.min(Math.max(1, selected.linkedSockets ?? 1), selected.sockets.length) : 0;
    const prismatic = Object.values(store.save.equipment).some((w) => w?.uniqueId === 'uq_prismatic_aegis') || selected.uniqueId === 'uq_prismatic_aegis';
    const linkedCount = Math.max(1, selected.linkedSockets ?? 1);

    const socketButtons = selected.sockets
      .map((gem, index) => {
        const def = gem ? gemById.get(gem.gemId) ?? null : null;
        const linkedToNext = index + 1 < linkedCount && index + 1 < selected.sockets.length;
        const color = prismatic ? 'white' : selected.socketColors[index] ?? 'red';
        return `<button class="socket-btn color-${color} ${gem ? 'filled' : ''}" data-action="socket" data-uid="${escapeHtml(selected.uid)}" data-index="${index}" title="${color} socket ${index + 1}">
          ${sprite('w-socket', 'socket-ring', '0 0 40 40', `--g:${socketColorHex(color)}`)}
          ${def ? assetImg(def.assetId, def.name) : `<span class="socket-letter">${socketColorCode(color)}</span>`}
        </button>${linkedToNext ? sprite('w-link', 'socket-link-svg', '0 0 28 10') : ''}`;
      })
      .join('');

    heroCard = `<div class="frame currency-bench" style="--c:${RARITY_COLOR[selected.rarity]}">
      <div class="forge-hero">
        <div class="forge-hero-art">${assetImg(base.assetId, title)}</div>
        <div class="forge-hero-meta">
          <div class="forge-hero-name" style="color:${unique ? '#d8b4fe' : RARITY_COLOR[selected.rarity]}">${escapeHtml(title)}</div>
          <div class="tiny muted">${RARITY_LABEL[selected.rarity]} ${escapeHtml(store.itemSlotLabel(base.slot))} · GS ${store.itemGearscore(selected)} · iLvl ${selected.itemLevel}${equipped ? ' · Equipped' : ''}</div>
          <div class="forge-tags">
            <span class="tag">Sockets ${selected.sockets.length}/${cap}</span>
            <span class="tag">Links ${links}/${selected.sockets.length}</span>
            ${selected.corrupted ? '<span class="tag" style="color:#d8b4fe;border-color:var(--void)">CORRUPTED</span>' : ''}
          </div>
        </div>
      </div>
      ${unique ? `<div class="mythic-panel" style="margin:6px 0 0"><div class="mythic-title">MYTHIC UNIQUE EFFECT</div><div class="mythic-desc">${escapeHtml(unique.description)}</div></div>` : ''}
      <div class="socket-row" style="margin-top:8px">${socketButtons || '<span class="tiny muted">No sockets on this item yet.</span>'}</div>
    </div>`;

    const modeTabs = `<div class="subtabs" role="tablist" aria-label="Forge workbench mode">
      <button role="tab" aria-selected="${activeTab === 'orbs'}" class="subtab ${activeTab === 'orbs' ? 'on' : ''}" data-action="forge-tab" data-tab="orbs">Orbs &amp; Affixes</button>
      <button role="tab" aria-selected="${activeTab === 'sockets'}" class="subtab ${activeTab === 'sockets' ? 'on' : ''}" data-action="forge-tab" data-tab="sockets">Sockets &amp; Links</button>
      <button role="tab" aria-selected="${activeTab === 'colors'}" class="subtab ${activeTab === 'colors' ? 'on' : ''}" data-action="forge-tab" data-tab="colors">Colors</button>
    </div>`;

    if (activeTab === 'orbs') {
      const orbs = AFFIX_ORBS.map((spec) => {
        const state = orbEligibility(store, selected, spec);
        return `<button class="orb-btn" data-action="currency-craft" data-orb="${spec.id}" ${state.disabled ? 'disabled' : ''}>
          <b>${escapeHtml(spec.label)}</b>
          <span>${escapeHtml(state.reason)}</span>
          <i>${escapeHtml(spec.costLabel)}</i>
        </button>`;
      }).join('');

      const implicitRows = base.implicit
        .map((mod) => {
          const suffix = mod.layer === 'flat' ? '' : mod.layer === 'more' ? '% more' : '%';
          return `<div class="affix-line"><span class="affix-name muted">Implicit · ${escapeHtml(statLabel(mod.stat))}</span><span class="affix-val">+${fmt(mod.value, 1)}${suffix}</span></div>`;
        })
        .join('');

      const affixes = selected.affixes
        .map((roll, index) => {
          const affix = affixById.get(roll.affixId);
          if (!affix) return '';
          const value = affixValue(selected, index);
          const suffix = affix.layer === 'flat' ? '' : affix.layer === 'more' ? '% more' : '%';
          return `<div class="affix-line">
            <span class="affix-name">${escapeHtml(affix.name)} · ${escapeHtml(statLabel(affix.stat))} <span class="muted tiny">T${roll.tier}</span></span>
            <span class="affix-val">+${fmt(value, 1)}${suffix}</span>
          </div>`;
        })
        .join('');

      tabSection = `${modeTabs}
        <div class="frame pan">
          <h4>Currency Orbs<span>${RARITY_LABEL[selected.rarity]}</span></h4>
          <div class="orb-grid">${orbs}</div>
        </div>
        <div class="frame pan">
          <h4>Rolled Affixes<span>${selected.affixes.length} mods</span></h4>
          ${implicitRows}
          ${affixes || '<div class="tiny muted">No rolled affixes. Apply a Transmute Orb above.</div>'}
        </div>`;
    } else if (activeTab === 'sockets') {
      const orbs = SOCKET_ORBS.map((spec) => {
        const state = orbEligibility(store, selected, spec);
        return `<button class="orb-btn" data-action="currency-craft" data-orb="${spec.id}" ${state.disabled ? 'disabled' : ''}>
          <b>${escapeHtml(spec.label)}</b>
          <span>${escapeHtml(state.reason)}</span>
          <i>${escapeHtml(spec.costLabel)}</i>
        </button>`;
      }).join('');

      tabSection = `${modeTabs}
        <div class="frame pan">
          <h4>Socket &amp; Link Crafting<span>${selected.sockets.length}/${cap} sockets · ${links} linked</span></h4>
          <div class="orb-grid">${orbs}</div>
          <p class="tiny muted" style="margin-top:8px">Tap any socket ring on the item above to socket, inspect, level, or unsocket a gem.</p>
        </div>`;
    } else {
      const canChroma = !selected.corrupted && (store.save.materials.mat_chroma ?? 0) >= 1 && selected.sockets.length > 0;
      const canForce = !selected.corrupted && (store.save.materials.mat_chroma ?? 0) >= 2 && (store.save.materials.mat_flux ?? 0) >= 3;
      const canPrismatic = !selected.corrupted && (store.save.materials.mat_chroma ?? 0) >= 5 && (store.save.materials.mat_essence ?? 0) >= 2;
      const activeIdx = Math.max(0, Math.min(Math.max(0, selected.sockets.length - 1), store.ui.forgeSocket ?? 0));

      const targetChips = selected.sockets.length
        ? `<div class="chroma-targets" role="tablist" aria-label="Target socket">
            ${selected.sockets
              .map((gem, index) => {
                const col = prismatic ? 'white' : selected.socketColors[index] ?? 'red';
                const sel = index === activeIdx;
                return `<button role="tab" aria-selected="${sel}" class="chroma-target ${sel ? 'on' : ''}" data-action="forge-socket-select" data-index="${index}" style="--pip:${socketColorHex(col)}">
                  <i class="cdot"></i>
                  <span>Soc ${index + 1}${gem ? ' ●' : ''}</span>
                </button>`;
              })
              .join('')}
          </div>`
        : '<div class="tiny muted">Add a socket first using Jeweller\'s Orb.</div>';

      tabSection = `${modeTabs}
        <div class="frame pan">
          <h4>Chromatic Bench<span>${selected.corrupted ? 'Locked (Corrupted)' : 'Recolor sockets'}</span></h4>
          <button class="gbtn" style="width:100%" data-action="chroma-reforge" data-uid="${escapeHtml(selected.uid)}" ${canChroma ? '' : 'disabled'}>
            Chromatic Reforge All · 1 Chroma
          </button>
          ${selected.sockets.length > 0
            ? `<div class="bench-section-label"><span>TARGETED FORCE COLOR</span><span class="tiny muted">Select socket, then pick color</span></div>
               ${targetChips}
               <div class="chroma-actions">
                 <button class="chroma-btn red" data-action="force-socket" data-uid="${escapeHtml(selected.uid)}" data-index="${activeIdx}" data-color="red" ${canForce ? '' : 'disabled'}><b>Red</b><span>2C + 3F</span></button>
                 <button class="chroma-btn green" data-action="force-socket" data-uid="${escapeHtml(selected.uid)}" data-index="${activeIdx}" data-color="green" ${canForce ? '' : 'disabled'}><b>Green</b><span>2C + 3F</span></button>
                 <button class="chroma-btn blue" data-action="force-socket" data-uid="${escapeHtml(selected.uid)}" data-index="${activeIdx}" data-color="blue" ${canForce ? '' : 'disabled'}><b>Blue</b><span>2C + 3F</span></button>
                 <button class="chroma-btn white" data-action="prismatic-socket" data-uid="${escapeHtml(selected.uid)}" data-index="${activeIdx}" ${canPrismatic ? '' : 'disabled'}><b>White</b><span>5C + 2E</span></button>
               </div>`
            : ''}
        </div>`;
    }
  }

  const materialBar = (['mat_scrap', 'mat_flux', 'mat_thread', 'mat_essence', 'mat_chroma'] as const)
    .map(
      (id) => `<div class="material">
        ${assetImg(MATERIAL_ASSET[id], MAT_SHORT[id])}
        <b>${fmt(store.save.materials[id] ?? 0)}</b>
        <span>${MAT_SHORT[id]}</span>
      </div>`,
    )
    .join('');

  return `<section class="screen" data-screen="forge" aria-label="Forge">
    <div class="sub-h"><h2>CURRENCY BENCH</h2><span class="tiny muted">orbs · sockets · chroma</span></div>

    <div class="frame cur">${materialBar}</div>

    ${picker}
    ${heroCard}
    ${tabSection}

    ${store.ui.craftMessage ? `<div class="frame pan" style="text-align:center"><span class="tiny gold">${escapeHtml(store.ui.craftMessage)}</span></div>` : ''}

    <p class="hint">Linked sockets connected by gold bars share Support Gems. Chromatic Reforge automatically stashes mismatched gems safely.</p>
  </section>`;
}
