import { affixById, gemById } from '../../data';
import type { ItemInstance } from '../../game/types';
import { MATERIAL_ASSET } from '../../game/types';
import { CRAFT_COSTS, canPay } from '../../game/crafting';
import { affixValue, itemBase, RARITY_COLOR, RARITY_LABEL } from '../../game/items';
import type { GameStore } from '../store';
import { assetImg, escapeHtml, fmt } from '../dom';

type CraftAction = 'upgrade' | 'reforge' | 'socket' | 'corrupt' | 'promote';

const ACTION_COPY: Record<CraftAction, { label: string; blurb: string }> = {
  upgrade: { label: 'TEMPER', blurb: '+1 item level' },
  reforge: { label: 'REFORGE', blurb: 'Reroll affixes' },
  socket: { label: 'SOCKET', blurb: 'Open a link' },
  corrupt: { label: 'CORRUPT', blurb: 'One essence roll' },
  promote: { label: 'PROMOTE', blurb: 'Raise rarity' },
};

const ACTION_ORDER: CraftAction[] = ['upgrade', 'reforge', 'socket', 'corrupt', 'promote'];

const ACTION_CELL: Record<CraftAction, string> = {
  upgrade: 'grid-column:1;grid-row:1',
  reforge: 'grid-column:1;grid-row:2',
  socket: 'grid-column:3;grid-row:1',
  corrupt: 'grid-column:3;grid-row:2',
  promote: 'grid-column:3;grid-row:3',
};

function affordances(store: GameStore, item: ItemInstance): Record<CraftAction, { cost: { material: string; amount: number }; disabled: boolean; why: string }> {
  const base = itemBase(item);
  const costFor = (action: CraftAction) => CRAFT_COSTS[action](item);
  const result = {} as Record<CraftAction, { cost: { material: string; amount: number }; disabled: boolean; why: string }>;

  for (const action of ACTION_ORDER) {
    const cost = costFor(action);
    let why = '';
    if (!canPay(store.save, cost)) why = `Need ${cost.amount} ${cost.material.replace('mat_', '')}`;
    if (action === 'reforge' && item.rarity === 'common') why = 'Nothing to reforge';
    if (action === 'socket' && item.sockets.length >= base.sockets) why = 'No sockets left';
    if (action === 'corrupt' && item.corrupted) why = 'Already corrupted';
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

  let anvil = `<div class="frame anvil"><div class="mid" style="grid-column:1 / 4">
    <span class="tiny muted">Choose an item from the rack to lay it on the anvil.</span>
  </div></div>`;
  let affixPanel = '';

  if (selected) {
    const base = itemBase(selected);
    const equipped = Object.values(store.save.equipment).some((entry) => entry?.uid === selected.uid);
    const flags = affordances(store, selected);
    const fullForge = store.isSystemUnlocked('forge_full');
    const visibleActions: CraftAction[] = fullForge ? ACTION_ORDER : ['upgrade'];
    const cards = visibleActions
      .map((action) => {
        const entry = ACTION_COPY[action];
        const flag = flags[action];
        const cost = flag.cost;
        return `<button class="fc" style="${ACTION_CELL[action]}" data-action="craft" data-craft="${action}" ${flag.disabled ? 'disabled' : ''}>
        <b>${entry.label}</b>
        <span>${flag.why || `${entry.blurb}`}</span>
        <i>${cost.amount} ${cost.material.replace('mat_', '')}</i>
      </button>`;
      })
      .join('');

    anvil = `<div class="frame anvil">
      ${cards}
      <div class="mid">
        ${assetImg(base.assetId, base.name)}
        <div>${escapeHtml(base.name)}</div>
        <div class="tiny muted">${RARITY_LABEL[selected.rarity]} · GS ${store.itemGearscore(selected)} · iLvl ${selected.itemLevel}${equipped ? ' · equipped' : ''}</div>
        ${selected.corrupted ? '<span class="tag" style="color:var(--void);border-color:var(--void)">CORRUPTED</span>' : ''}
      </div>
    </div>`;

    const lines = selected.affixes
      .map((roll, index) => {
        const affix = affixById.get(roll.affixId);
        if (!affix) return '';
        const value = affixValue(selected, index);
        const suffix = affix.layer === 'flat' ? '' : affix.layer === 'more' ? '% more' : '%';
        return `<div class="affix-line"><span class="affix-name">${escapeHtml(affix.name)}</span><span class="affix-val">+${fmt(value, 1)}${suffix}</span></div>`;
      })
      .join('');

    const linkedCount = selected.linkedSockets ?? 0;
    const socketButtons = selected.sockets
      .map((gem, index) => {
        const def = gem ? gemById.get(gem.gemId) ?? null : null;
        const linkedToNext = index + 1 < linkedCount && index + 1 < selected.sockets.length;
        return `<button class="socket-btn ${gem ? 'filled' : ''}" data-action="socket" data-uid="${escapeHtml(selected.uid)}" data-index="${index}" title="Socket ${index + 1}">
          ${def ? assetImg(def.assetId, def.name) : ''}
        </button>${linkedToNext ? '<span class="socket-link" aria-hidden="true"></span>' : ''}`;
      })
      .join('');

    affixPanel = `<div class="frame pan">
      <h4>Affixes<span>${RARITY_LABEL[selected.rarity]}</span></h4>
      ${lines || '<div class="tiny muted">No affixes on this item.</div>'}
      <div class="socket-row">${socketButtons}</div>
    </div>`;
  }

  const materialBar = (['mat_scrap', 'mat_flux', 'mat_thread', 'mat_essence'] as const)
    .map(
      (id) => `<div class="material">
        ${assetImg(MATERIAL_ASSET[id], id)}
        <b>${fmt(store.save.materials[id] ?? 0)}</b>
        <span>${id.replace('mat_', '')}</span>
      </div>`,
    )
    .join('');

  const fullForge = store.isSystemUnlocked('forge_full');

  return `<section class="screen" data-screen="forge" aria-label="Forge">
    <div class="sub-h"><h2>THE FORGE</h2><span class="tiny muted">${fullForge ? 'temper · reforge · corrupt' : 'temper with scrap · more crafts at Tier 2'}</span></div>

    <div class="frame cur">${materialBar}</div>

    ${picker}
    ${anvil}
    ${affixPanel}

    ${store.ui.craftMessage ? `<div class="frame pan" style="text-align:center"><span class="tiny gold">${escapeHtml(store.ui.craftMessage)}</span></div>` : ''}

    <p class="hint">${fullForge ? 'Essence corrupts permanently. Every craft rerolls the anvil.' : 'Reinforce gear with War-Scrap. Reforge, Socket, and Essence unlock after your first Tier 2 kill.'}</p>
  </section>`;
}
