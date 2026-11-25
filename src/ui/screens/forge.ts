import { affixById, gemById } from '../../data';
import type { ItemInstance } from '../../game/types';
import { MATERIAL_ASSET } from '../../game/types';
import { CRAFT_COSTS, canPay } from '../../game/crafting';
import { affixValue, itemBase, RARITY_COLOR, RARITY_LABEL } from '../../game/items';
import { socketColorHex } from '../../game/sockets';
import type { GameStore } from '../store';
import { assetImg, escapeHtml, fmt, sprite } from '../dom';

type CraftAction = 'upgrade' | 'reforge' | 'socket' | 'link' | 'lock-reforge' | 'corrupt' | 'promote';

const ACTION_COPY: Record<CraftAction, { label: string; blurb: string }> = {
  upgrade: { label: 'TEMPER', blurb: '+1 item level' },
  reforge: { label: 'REFORGE', blurb: 'Reroll affixes' },
  promote: { label: 'PROMOTE', blurb: 'Raise rarity' },
  socket: { label: 'SOCKET', blurb: 'Open socket' },
  link: { label: 'LINK', blurb: 'Fuse +1 link' },
  'lock-reforge': { label: 'LOCK ROLL', blurb: 'Keep 1 affix' },
  corrupt: { label: 'CORRUPT', blurb: 'Vaal mutation' },
};

const ACTION_ORDER: CraftAction[] = ['upgrade', 'reforge', 'promote', 'socket', 'link', 'lock-reforge', 'corrupt'];

const ACTION_CELL: Record<CraftAction, string> = {
  upgrade: 'grid-column:1;grid-row:1',
  reforge: 'grid-column:1;grid-row:2',
  promote: 'grid-column:1;grid-row:3',
  socket: 'grid-column:3;grid-row:1',
  link: 'grid-column:3;grid-row:2',
  'lock-reforge': 'grid-column:3;grid-row:3',
  corrupt: 'grid-column:2;grid-row:3',
};

function affordances(store: GameStore, item: ItemInstance): Record<CraftAction, { cost: { material: string; amount: number }; disabled: boolean; why: string }> {
  const base = itemBase(item);
  const costFor = (action: CraftAction) => {
    if (action === 'lock-reforge') return CRAFT_COSTS.lockReforge();
    return CRAFT_COSTS[action](item);
  };
  const result = {} as Record<CraftAction, { cost: { material: string; amount: number }; disabled: boolean; why: string }>;

  for (const action of ACTION_ORDER) {
    const cost = costFor(action);
    let why = '';
    if (!canPay(store.save, cost)) why = `Need ${cost.amount} ${cost.material.replace('mat_', '')}`;
    if (action === 'reforge' && item.rarity === 'common') why = 'Nothing to reforge';
    if (action === 'socket' && item.sockets.length >= base.sockets) why = 'Max sockets';
    if (action === 'link' && item.sockets.length < 2) why = 'Need 2+ sockets';
    if (action === 'link' && (item.linkedSockets ?? 1) >= item.sockets.length) why = 'Fully linked';
    if (action === 'lock-reforge' && item.affixes.length < 2) why = 'Need 2+ affixes';
    if (action === 'corrupt' && item.corrupted) why = 'Corrupted';
    if (action === 'promote' && item.rarity === 'mythic') why = 'Already mythic';
    result[action] = { cost, disabled: why !== '', why };
  }
  return result;
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

  const picker = items.length
    ? `<div class="frame forge-picker">${items
        .map((item) => {
          const base = itemBase(item);
          const equipped = Object.values(store.save.equipment).some((entry) => entry?.uid === item.uid);
          return `<button class="forge-pick ${selected?.uid === item.uid ? 'active' : ''}" data-action="forge-select" data-uid="${escapeHtml(item.uid)}" data-rarity="${item.rarity}" style="--c:${RARITY_COLOR[item.rarity]}" title="${escapeHtml(base.name)}${equipped ? ' (equipped)' : ''}">
            ${assetImg(base.assetId, base.name)}
          </button>`;
        })
        .join('')}</div>`
    : `<div class="empty-note">Nothing to work. Find gear in a tier first.</div>`;

  let anvil = `<div class="frame anvil"><div class="mid" style="grid-column:1 / 4;grid-row:1 / 4">
    <span class="tiny muted">Choose an item from the rack to lay it on the anvil.</span>
  </div></div>`;
  let affixPanel = '';

  if (selected) {
    const base = itemBase(selected);
    const equipped = Object.values(store.save.equipment).some((entry) => entry?.uid === selected.uid);
    const flags = affordances(store, selected);
    const cards = ACTION_ORDER.map((action) => {
      const entry = ACTION_COPY[action];
      const flag = flags[action];
      const cost = flag.cost;
      return `<button class="fc" style="${ACTION_CELL[action]}" data-action="craft" data-craft="${action}" ${flag.disabled ? 'disabled' : ''}>
        <b>${entry.label}</b>
        <span>${flag.why || `${entry.blurb}`}</span>
        <i>${cost.amount} ${cost.material.replace('mat_', '')}</i>
      </button>`;
    }).join('');

    anvil = `<div class="frame anvil">
      ${cards}
      <div class="mid">
        ${assetImg(base.assetId, base.name)}
        <div>${escapeHtml(base.name)}</div>
        <div class="tiny muted">${RARITY_LABEL[selected.rarity]} · GS ${store.itemGearscore(selected)} · iLvl ${selected.itemLevel}${equipped ? ' · equipped' : ''}</div>
        ${selected.corrupted ? '<span class="tag" style="color:var(--void);border-color:var(--void)">CORRUPTED</span>' : ''}
      </div>
    </div>`;

    const lockedIdx = store.ui.lockedAffixIndex ?? 0;
    const lines = selected.affixes
      .map((roll, index) => {
        const affix = affixById.get(roll.affixId);
        if (!affix) return '';
        const value = affixValue(selected, index);
        const suffix = affix.layer === 'flat' ? '' : affix.layer === 'more' ? '% more' : '%';
        const isLocked = index === lockedIdx;
        return `<button class="affix-line affix-btn ${isLocked ? 'locked-affix' : ''}" data-action="lock-affix" data-index="${index}" title="Tap to select affix to lock with Rift Essence">
          <span class="affix-name">${isLocked ? '🔒 ' : ''}${escapeHtml(affix.name)} <span class="muted tiny">T${roll.tier}</span></span>
          <span class="affix-val">+${fmt(value, 1)}${suffix}</span>
        </button>`;
      })
      .join('');

    const linkedCount = Math.max(1, selected.linkedSockets ?? 1);
    const socketButtons = selected.sockets
      .map((gem, index) => {
        const def = gem ? gemById.get(gem.gemId) ?? null : null;
        const linkedToNext = index + 1 < linkedCount && index + 1 < selected.sockets.length;
        const color = selected.socketColors[index] ?? 'red';
        return `<button class="socket-btn color-${color} ${gem ? 'filled' : ''}" data-action="socket" data-uid="${escapeHtml(selected.uid)}" data-index="${index}" title="${color} socket ${index + 1}">
          ${sprite('w-socket', 'socket-ring', '0 0 40 40', `--g:${socketColorHex(color)}`)}
          ${def ? assetImg(def.assetId, def.name) : ''}
        </button>${linkedToNext ? sprite('w-link', 'socket-link-svg', '0 0 28 10') : ''}`;
      })
      .join('');

    const chroma = `<div class="chroma-panel">
      <button class="gbtn sm" data-action="chroma-reforge" data-uid="${escapeHtml(selected.uid)}" title="1 Chromatic Flux: reroll every socket colour">CHROMATIC REFORGE · 1</button>
      ${selected.sockets
        .map((_, index) => `<div class="chroma-row">
          <span class="tiny muted">Socket ${index + 1}</span>
          <button class="socket-mini red" data-action="force-socket" data-uid="${escapeHtml(selected.uid)}" data-index="${index}" data-color="red" title="2 Chroma + 3 Flux">R</button>
          <button class="socket-mini green" data-action="force-socket" data-uid="${escapeHtml(selected.uid)}" data-index="${index}" data-color="green" title="2 Chroma + 3 Flux">G</button>
          <button class="socket-mini blue" data-action="force-socket" data-uid="${escapeHtml(selected.uid)}" data-index="${index}" data-color="blue" title="2 Chroma + 3 Flux">B</button>
          <button class="socket-mini white" data-action="prismatic-socket" data-uid="${escapeHtml(selected.uid)}" data-index="${index}" title="5 Chroma + 2 Essence">W</button>
        </div>`)
        .join('')}
    </div>`;

    affixPanel = `<div class="frame pan">
      <h4>Affixes & Links<span>${RARITY_LABEL[selected.rarity]} · ${Math.min(linkedCount, selected.sockets.length)}/${selected.sockets.length} linked</span></h4>
      ${lines || '<div class="tiny muted">No affixes on this item. Promote rarity with Flux.</div>'}
      <div class="socket-row">${socketButtons}</div>
      ${chroma}
    </div>`;
  }

  const materialBar = (['mat_scrap', 'mat_flux', 'mat_thread', 'mat_essence', 'mat_chroma'] as const)
    .map(
      (id) => `<div class="material">
        ${assetImg(MATERIAL_ASSET[id], id)}
        <b>${fmt(store.save.materials[id] ?? 0)}</b>
        <span>${id.replace('mat_', '')}</span>
      </div>`,
    )
    .join('');

  return `<section class="screen" data-screen="forge" aria-label="Forge">
    <div class="sub-h"><h2>THE FORGE</h2><span class="tiny muted">temper · reforge · link · lock · corrupt</span></div>

    <div class="frame cur">${materialBar}</div>

    ${picker}
    ${anvil}
    ${affixPanel}

    ${store.ui.craftMessage ? `<div class="frame pan" style="text-align:center"><span class="tiny gold">${escapeHtml(store.ui.craftMessage)}</span></div>` : ''}

    <p class="hint">Tap an affix line to choose your Essence Lock target. Sockets linked by gold bars share Support Gems.</p>
  </section>`;
}
