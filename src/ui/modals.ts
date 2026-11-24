import { affixById, doctrines, gems, nodeById, statRegistry } from '../data';
import type { StatMod } from '../data/types';
import { xpNeeded } from '../game/state';
import type { GemInstance, ItemInstance } from '../game/types';
import { RARITY_COLOR, RARITY_LABEL, affixValue, itemBase } from '../game/items';
import type { GameStore, ModalState } from './store';
import { assetImg, escapeHtml, fmt, pct, seconds, statLabel } from './dom';

function modLine(mod: StatMod): string {
  const layer = mod.layer === 'flat' ? '' : mod.layer === 'more' ? '% more' : '%';
  const sign = mod.value >= 0 ? '+' : '';
  return `${sign}${fmt(mod.value, 1)}${layer} ${statLabel(mod.stat)}`;
}

function closeButton(): string {
  return `<button class="modal-close" data-action="close-modal" aria-label="Close">✕</button>`;
}

function statsModal(store: GameStore): string {
  const stats = store.stats;
  const save = store.save;
  const keys = ['might', 'agility', 'wisdom', 'fortitude', 'max_hp', 'max_mana', 'max_ward', 'armor', 'hp_regen', 'mana_regen', 'attack_speed', 'cast_speed', 'crit_chance', 'ailment_potency'];
  const rows = keys
    .filter((key) => stats.values[key] !== undefined)
    .map((key) => {
      const def = statRegistry.stats[key];
      return `<div><span class="muted">${escapeHtml(def?.label ?? statLabel(key))}</span><span class="gold">${fmt(stats.values[key] ?? 0, 1)}</span></div>`;
    })
    .join('');

  const keystoneList = [...stats.keystones]
    .map((id) => nodeById(id)?.name ?? id)
    .map((name) => `<span class="tag">${escapeHtml(name)}</span>`)
    .join(' ');

  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Character stats">
    ${closeButton()}
    <h3>${escapeHtml(store.save.doctrine)} run · Level ${save.level}</h3>
    <div class="modal-sub">Gearscore ${stats.gearscore} · ${fmt(save.xp)} / ${fmt(xpNeeded(save.level))} XP</div>
    <div class="stat-modal-grid">${rows}</div>
    <div class="panel" style="margin-top:10px">
      <div class="panel-title"><span>Offence</span><span class="muted tiny">${escapeHtml(stats.weaponName)}</span></div>
      <div class="stat-modal-grid">
        <div><span class="muted">Crit chance</span><span class="gold">${(stats.critChance * 100).toFixed(1)}%</span></div>
        <div><span class="muted">Crit multi</span><span class="gold">${(stats.critMultiplier * 100).toFixed(0)}%</span></div>
        <div><span class="muted">Double hit</span><span class="gold">${(stats.doubleHitChance * 100).toFixed(1)}%</span></div>
        <div><span class="muted">Dodge cap</span><span class="gold">${fmt(stats.dodgeCap)}</span></div>
      </div>
    </div>
    <div class="panel" style="margin-top:10px">
      <div class="panel-title"><span>Keystones</span><span class="muted tiny">${stats.keystones.size} bound</span></div>
      ${keystoneList || '<div class="tiny muted">No keystones allocated yet.</div>'}
    </div>
  </div>`;
}

function itemModal(store: GameStore, uid: string): string {
  const location = store.findItem(uid);
  if (!location) {
    return `<div class="modal" role="dialog" aria-modal="true">${closeButton()}<h3>Item gone</h3><p class="tiny muted">That item is no longer in the bag.</p></div>`;
  }
  const item: ItemInstance = location.item;
  const base = itemBase(item);
  const colour = RARITY_COLOR[item.rarity];
  const equipped = Boolean(location.slot);

  const affixes = item.affixes
    .map((roll, index) => {
      const affix = affixById.get(roll.affixId);
      if (!affix) return '';
      return `<div class="affix-line">
        <span class="affix-name">${escapeHtml(affix.name)} <span class="muted tiny">T${roll.tier}</span></span>
        <span class="affix-val">${modLine({ stat: affix.stat, layer: affix.layer, value: affixValue(item, index) })}</span>
      </div>`;
    })
    .join('');

  const implicit = base.implicit.map((mod) => `<div class="affix-line"><span class="affix-name">Implicit</span><span class="affix-val">${modLine(mod)}</span></div>`).join('');

  const sockets = item.sockets
    .map((gem, index) => {
      const def = gem ? gems.find((entry) => entry.id === gem.gemId) : null;
      return `<button class="socket-btn ${gem ? 'filled' : ''}" data-action="socket" data-uid="${escapeHtml(item.uid)}" data-index="${index}" title="Socket ${index + 1}${gem ? ` · ${escapeHtml(def?.name ?? '')}` : ''}">
        ${def ? assetImg(def.assetId, def.name) : ''}
      </button>`;
    })
    .join('');

  const weapon = base.weapon
    ? `<div class="tiny muted" style="margin:4px 0">${base.weapon.minDamage}-${base.weapon.maxDamage} damage · ${base.weapon.attacksPerSecond}/s · ${base.weapon.twoHanded ? 'two-handed' : 'one-handed'}</div>`
    : '';

  const equipButtons = equipped
    ? `<button class="btn" data-action="unequip" data-slot="${location.slot}">Unequip</button>`
    : store
        .availableSlots(item)
        .map((slot) => `<button class="btn" data-action="equip" data-uid="${escapeHtml(item.uid)}" data-slot="${slot}">Equip ${escapeHtml(store.itemSlotLabel(slot))}</button>`)
        .join('');

  const salvage = equipped ? '' : `<button class="btn danger" data-action="salvage" data-uid="${escapeHtml(item.uid)}">Salvage</button>`;

  return `<div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(base.name)}">
    ${closeButton()}
    <div class="item-hero" style="--g:${colour}">
      ${assetImg(base.assetId, base.name)}
      <div>
        <h3>${escapeHtml(base.name)}</h3>
        <div class="modal-sub" style="margin-bottom:2px">${RARITY_LABEL[item.rarity]} ${escapeHtml(base.baseType)} · GS ${store.itemGearscore(item)}</div>
        <div class="tiny muted">Item level ${item.itemLevel} · ${equipped ? `Equipped: ${escapeHtml(store.itemSlotLabel(location.slot!))}` : 'In bag'}${item.corrupted ? ' · corrupted' : ''}</div>
        ${weapon}
      </div>
    </div>
    <div class="affix-list">${implicit}${affixes || '<div class="tiny muted">No affixes. Reforge or promote it at the Forge.</div>'}</div>
    <div class="socket-row">${sockets || '<span class="tiny muted">No sockets.</span>'}</div>
    ${base.uniqueEffect ? `<div class="panel" style="padding:8px"><div class="tiny gold">${escapeHtml(base.uniqueEffect)}</div></div>` : ''}
    <div class="modal-actions">${equipButtons}${salvage}</div>
  </div>`;
}

function nodeModal(store: GameStore, nodeId: string): string {
  const node = nodeById(nodeId);
  if (!node) {
    return `<div class="modal" role="dialog" aria-modal="true">${closeButton()}<h3>Unknown node</h3></div>`;
  }
  const allocated = store.save.allocated.includes(node.id);
  const mods = node.mods.map((mod) => `<div class="affix-line"><span class="affix-name">Effect</span><span class="affix-val">${modLine(mod)}</span></div>`).join('');
  const exclusions = (node.excludes ?? [])
    .map((id) => nodeById(id)?.name ?? id)
    .map((name) => `<span class="tag">${escapeHtml(name)}</span>`)
    .join(' ');
  const isKeystone = node.kind === 'keystone';

  const body = isKeystone && node.assetId
    ? `<div class="keystone-card">
        ${assetImg(node.assetId, node.name)}
        <div>
          <p>${escapeHtml(node.description)}</p>
          <div style="margin-top:8px" class="tiny gold">${mods || ''}</div>
        </div>
      </div>`
    : `<p class="tiny" style="line-height:1.5;color:var(--text)">${escapeHtml(node.description)}</p>
       <div class="affix-list">${mods || '<div class="tiny muted">A path node with no effect of its own.</div>'}</div>`;

  const action = allocated
    ? `<button class="btn" data-action="refund" data-node="${escapeHtml(node.id)}">Refund Point</button>`
    : `<button class="btn primary" data-action="allocate" data-node="${escapeHtml(node.id)}">Allocate · 1 point</button>`;

  return `<div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(node.name)}">
    ${closeButton()}
    <h3>${escapeHtml(node.name)}</h3>
    <div class="modal-sub">${escapeHtml(node.kind)} · ${escapeHtml(node.sector)} sector · ${allocated ? 'allocated' : 'unallocated'}</div>
    ${body}
    ${exclusions ? `<div style="margin-top:10px"><div class="tiny muted">Mutually exclusive</div><div style="margin-top:3px">${exclusions}</div></div>` : ''}
    <div class="modal-actions">${action}<button class="btn" data-action="close-modal">Close</button></div>
  </div>`;
}

function gemPickerModal(store: GameStore, itemUid: string, socketIndex: number): string {
  const rows = store.save.gemStash.length
    ? store.save.gemStash
        .map((gem: GemInstance, index) => {
          const def = gems.find((entry) => entry.id === gem.gemId);
          if (!def) return '';
          return `<button class="gem-row" data-action="pick-gem" data-index="${index}" style="width:100%;text-align:left">
            ${assetImg(def.assetId, def.name)}
            <div>
              <div class="gem-name">${escapeHtml(def.name)}</div>
              <div class="gem-meta">${escapeHtml(def.kind)} · Lv ${gem.level} · ${gem.xp} XP</div>
            </div>
            <span class="tiny gold">Socket</span>
          </button>`;
        })
        .join('')
    : `<div class="empty-note">No gems in the pouch. Salvage duplicate gems for dust, or unsocket one.</div>`;

  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Choose a gem">
    ${closeButton()}
    <h3>Choose a gem</h3>
    <div class="modal-sub">Socket ${socketIndex + 1} · ${escapeHtml(store.baseNameOf(itemUid))}</div>
    <div class="gem-list">${rows}</div>
  </div>`;
}

function offlineModal(store: GameStore): string {
  const offline = store.offline;
  if (!offline) return '';
  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Offline spoils">
    ${closeButton()}
    <h3>While you were gone</h3>
    <div class="modal-sub">${seconds(offline.seconds * 1000)} away · the Warbound kept fighting</div>
    <div class="stat-modal-grid">
      <div><span class="muted">Kills</span><span class="gold">${fmt(offline.kills)}</span></div>
      <div><span class="muted">Gold</span><span class="gold">${fmt(offline.gold)}</span></div>
      <div><span class="muted">XP</span><span class="gold">${fmt(offline.xp)}</span></div>
      <div><span class="muted">Rift keys</span><span class="gold">${fmt(offline.keys)}</span></div>
    </div>
    <div class="modal-actions"><button class="btn primary" data-action="claim-offline">Claim spoils</button></div>
  </div>`;
}

export function renderModal(store: GameStore, modal: ModalState): string {
  switch (modal.kind) {
    case 'stats':
      return statsModal(store);
    case 'item':
      return itemModal(store, modal.uid);
    case 'node':
      return nodeModal(store, modal.nodeId);
    case 'gem-picker':
      return gemPickerModal(store, modal.itemUid, modal.socketIndex);
    case 'offline':
      return offlineModal(store);
    default:
      return '';
  }
}

export function hpReadout(hp: number, max: number): string {
  return `${fmt(hp)} / ${fmt(max)} · ${pct(hp, max)}`;
}

export { doctrines };
