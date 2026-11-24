import { affixById, doctrines, gems, nodeById, statRegistry } from '../data';
import type { StatMod } from '../data/types';
import { xpNeeded } from '../game/state';
import type { GemInstance, ItemInstance } from '../game/types';
import { RARITY_COLOR, RARITY_LABEL, affixValue, gemDustCostToLevel, gemXpToNext, itemBase } from '../game/items';
import type { GameStore, ModalState } from './store';
import { assetImg, escapeHtml, fmt, pct, schoolColor, seconds, sprite, statLabel } from './dom';

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
  const keys = [
    'might',
    'agility',
    'wisdom',
    'fortitude',
    'max_hp',
    'max_mana',
    'max_ward',
    'armor',
    'armor_break',
    'dodge_rating',
    'thorns',
    'hp_regen',
    'mana_regen',
    'attack_speed',
    'cast_speed',
    'dot_speed',
    'crit_chance',
    'ailment_potency',
  ];
  const rows = keys
    .filter((key) => stats.values[key] !== undefined)
    .map((key) => {
      const def = statRegistry.stats[key];
      return `<div title="${escapeHtml(def?.description ?? '')}">
        <span class="muted">${escapeHtml(def?.label ?? statLabel(key))}</span>
        <span class="gold">${fmt(stats.values[key] ?? 0, 1)}</span>
      </div>`;
    })
    .join('');

  const attrNotes = (['might', 'agility', 'wisdom', 'fortitude'] as const)
    .map((id) => {
      const def = statRegistry.stats[id];
      return def
        ? `<div class="tiny" style="line-height:1.35;margin-bottom:3px"><b class="gold">${escapeHtml(def.label)}:</b> <span class="muted">${escapeHtml(def.description)}</span></div>`
        : '';
    })
    .join('');

  const convRows = stats.conversionsApplied.length
    ? stats.conversionsApplied
        .map(
          (c) => `<div class="affix-line">
            <span class="affix-name">Pass ${c.pass}: ${escapeHtml(statLabel(c.from))} → ${escapeHtml(statLabel(c.to))}</span>
            <span class="affix-val">${c.percent}% (${fmt(c.amount, 1)})</span>
          </div>`,
        )
        .join('')
    : '<div class="tiny muted">No active conversions yet (Void Tithe / School Shift / Tree conversions appear here).</div>';

  const keystoneList = [...stats.keystones]
    .map((id) => nodeById(id)?.name ?? id)
    .map((name) => `<span class="tag">${escapeHtml(name)}</span>`)
    .join(' ');

  return `<div class="modal" role="dialog" aria-modal="true" aria-label="Character stats">
    ${closeButton()}
    <h3>${escapeHtml(store.save.doctrine)} run · Level ${save.level}</h3>
    <div class="modal-sub">Gearscore ${stats.gearscore} · ${fmt(save.xp)} / ${fmt(xpNeeded(save.level))} XP</div>
    <div class="stat-modal-grid">${rows}</div>
    <div class="panel" style="margin-top:8px">
      <div class="panel-title"><span>Attribute Vectors</span><span class="muted tiny">4 per stat</span></div>
      ${attrNotes}
    </div>
    <div class="panel" style="margin-top:8px">
      <div class="panel-title"><span>Offence & Mana</span><span class="muted tiny">${escapeHtml(stats.weaponName)}</span></div>
      <div class="stat-modal-grid">
        <div><span class="muted">Crit chance</span><span class="gold">${(stats.critChance * 100).toFixed(1)}%</span></div>
        <div><span class="muted">Crit multi</span><span class="gold">${(stats.critMultiplier * 100).toFixed(0)}%</span></div>
        <div><span class="muted">Double hit</span><span class="gold">${(stats.doubleHitChance * 100).toFixed(1)}%</span></div>
        <div><span class="muted">Armor break</span><span class="gold">${(stats.armorBreak * 100).toFixed(1)}%</span></div>
        <div><span class="muted">Usable mana</span><span class="gold">${fmt(stats.maxMana)} / ${fmt(stats.totalMaxMana)}</span></div>
        <div><span class="muted">Reserved</span><span class="gold">${stats.reservedManaPct}% (${fmt(stats.reservedMana)})</span></div>
      </div>
    </div>
    <div class="panel" style="margin-top:8px">
      <div class="panel-title"><span>Two-Pass DAG Conversions</span><span class="muted tiny">cycle-free</span></div>
      ${convRows}
    </div>
    <div class="panel" style="margin-top:8px">
      <div class="panel-title"><span>Keystones</span><span class="muted tiny">${stats.keystones.size} bound</span></div>
      ${keystoneList || '<div class="tiny muted">No keystones allocated yet.</div>'}
    </div>
    <div class="panel" style="margin-top:8px">
      <div class="panel-title"><span>Settings</span><span class="muted tiny">Path of Warbound</span></div>
      <div class="modal-actions" style="margin-top:4px">
        <button class="btn ${save.settings.logCombat ? 'primary' : ''}" data-action="toggle-log">Log: ${save.settings.logCombat ? 'On' : 'Off'}</button>
        <button class="btn ${save.settings.reducedMotion ? 'primary' : ''}" data-action="toggle-motion">Motion: ${save.settings.reducedMotion ? 'Reduced' : 'Full'}</button>
      </div>
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

  const linkedCount = Math.max(1, item.linkedSockets ?? 1);
  const sockets = item.sockets
    .map((gem, index) => {
      const def = gem ? gems.find((entry) => entry.id === gem.gemId) : null;
      const linkedToNext = index + 1 < linkedCount && index + 1 < item.sockets.length;
      const ringColor = index < linkedCount ? '#D4AF37' : '#6d5f2e';
      return `<button class="socket-btn ${gem ? 'filled' : ''}" data-action="socket" data-uid="${escapeHtml(item.uid)}" data-index="${index}" title="${gem ? `Inspect ${escapeHtml(def?.name ?? '')}` : `Socket gem into slot ${index + 1}`}">
        ${sprite('w-socket', 'socket-ring', '0 0 40 40', `--g:${ringColor}`)}
        ${def ? assetImg(def.assetId, def.name) : ''}
      </button>${linkedToNext ? sprite('w-link', 'socket-link-svg', '0 0 28 10') : ''}`;
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
    ${base.description ? `<p class="tiny" style="line-height:1.4;color:var(--text);margin-bottom:6px">${escapeHtml(base.description)}</p>` : ''}
    <div class="affix-list">${implicit}${affixes || '<div class="tiny muted">No affixes. Reforge or promote it at the Forge.</div>'}</div>
    <div class="socket-row">${sockets || '<span class="tiny muted">No sockets.</span>'}</div>
    <div class="tiny muted" style="margin-top:4px">Tap a filled socket to inspect/level/unsocket its gem.</div>
    ${base.uniqueEffect ? `<div class="panel" style="padding:8px;margin-top:6px"><div class="tiny gold">${escapeHtml(base.uniqueEffect)}</div></div>` : ''}
    <div class="modal-actions">${equipButtons}${salvage}</div>
  </div>`;
}

function gemInspectModal(store: GameStore, modal: Extract<ModalState, { kind: 'gem' }>): string {
  const resolved = store.resolveModalGem(modal);
  if (!resolved) {
    return `<div class="modal" role="dialog" aria-modal="true">${closeButton()}<h3>Gem gone</h3></div>`;
  }
  const { gem, item, socketIndex } = resolved;
  const def = gems.find((g) => g.id === gem.gemId);
  if (!def) return '';

  const liveSkill =
    item && socketIndex !== undefined
      ? store.stats.skills.find((s) => s.gemId === gem.gemId && s.sourceSocketIndex === socketIndex) ??
        store.stats.skills.find((s) => s.gemId === gem.gemId)
      : store.stats.skills.find((s) => s.gemId === gem.gemId);

  const xpNext = gemXpToNext(gem.level);
  const dustCost = gemDustCostToLevel(gem.level);
  const canDust = gem.level < 20 && (store.save.materials.gem_dust ?? 0) >= dustCost;

  const school = def.school ? `<span class="tag" style="border-color:${schoolColor(def.school)};color:${schoolColor(def.school)}">${escapeHtml(def.school)}</span>` : '';
  const tags = def.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');

  let liveRows = '';
  if (def.kind === 'active') {
    const scale = 1 + 0.14 * (gem.level - 1);
    const minDmg = liveSkill ? liveSkill.effectiveMinDamage : (def.damage?.min ?? 0) * scale;
    const maxDmg = liveSkill ? liveSkill.effectiveMaxDamage : (def.damage?.max ?? 0) * scale;
    const castT = liveSkill ? liveSkill.effectiveCastTime : def.castTime ?? 0;
    const cd = liveSkill ? liveSkill.effectiveCooldown : def.cooldown ?? 0;
    const mana = liveSkill ? liveSkill.effectiveManaCost : def.manaCost ?? 0;
    const linkedNames = liveSkill?.linkedSupportNames ?? [];
    const moreMult = liveSkill ? liveSkill.damageMoreMultiplier : 1;

    liveRows = `<div class="panel" style="margin-top:8px">
      <div class="panel-title"><span>Live Calculated Stats</span><span class="muted tiny">${liveSkill ? 'equipped' : 'base preview'}</span></div>
      ${def.manaReservation
        ? `<div class="affix-line"><span class="affix-name">Mana Reserved</span><span class="affix-val">${def.manaReservation}% Max Mana</span></div>`
        : `<div class="affix-line"><span class="affix-name">Hit Damage</span><span class="affix-val">${maxDmg > 0 ? `${fmt(minDmg, 1)} – ${fmt(maxDmg, 1)}` : 'Utility / Guard'}</span></div>
           <div class="affix-line"><span class="affix-name">Cast / Attack Time</span><span class="affix-val">${castT > 0 ? `${castT.toFixed(2)}s` : 'Instant'}</span></div>
           <div class="affix-line"><span class="affix-name">Cooldown</span><span class="affix-val">${cd > 0 ? `${cd.toFixed(2)}s` : 'None'}</span></div>
           <div class="affix-line"><span class="affix-name">Mana Cost</span><span class="affix-val">${fmt(mana, 1)}</span></div>`}
      ${def.ailment
        ? `<div class="affix-line"><span class="affix-name">Ailment</span><span class="affix-val">${Math.round(def.ailment.chance * 100)}% ${escapeHtml(def.ailment.id)} (${fmt(def.ailment.dps * scale, 1)}/s base)</span></div>`
        : ''}
      ${linkedNames.length
        ? `<div class="affix-line"><span class="affix-name">Linked Supports</span><span class="affix-val">${escapeHtml(linkedNames.join(', '))}</span></div>`
        : `<div class="tiny muted" style="margin-top:4px">No linked Support Gems affecting this skill.</div>`}
      ${moreMult > 1
        ? `<div class="affix-line"><span class="affix-name">Support More Multiplier</span><span class="affix-val">${((moreMult - 1) * 100).toFixed(0)}% more</span></div>`
        : ''}
    </div>`;
  } else {
    const supScale = 1 + 0.06 * (gem.level - 1);
    const modLines = def.mods
      .map((m) => `<div class="affix-line"><span class="affix-name">Modifier</span><span class="affix-val">${modLine({ ...m, value: m.value * supScale })}</span></div>`)
      .join('');
    liveRows = `<div class="panel" style="margin-top:8px">
      <div class="panel-title"><span>Support Link Scaling</span><span class="muted tiny">Lv ${gem.level}</span></div>
      ${modLines}
      ${def.support?.allowedTags?.length ? `<div class="tiny muted" style="margin-top:4px">Applies to: ${escapeHtml(def.support.allowedTags.join(', '))}</div>` : ''}
    </div>`;
  }

  const barButtons =
    def.kind === 'active'
      ? `<div class="panel" style="margin-top:8px">
          <div class="panel-title"><span>Skill Bar Assignment</span><span class="muted tiny">${gem.bar === 'both' ? 'Both Bars' : gem.bar === 'bar_1' ? 'Bar I' : 'Bar II'}</span></div>
          <div class="modal-actions" style="margin-top:2px">
            <button class="btn ${gem.bar === 'bar_1' ? 'primary' : ''}" data-action="set-gem-bar" data-bar="bar_1">Bar I</button>
            <button class="btn ${gem.bar === 'bar_2' ? 'primary' : ''}" data-action="set-gem-bar" data-bar="bar_2">Bar II</button>
            <button class="btn ${gem.bar === 'both' ? 'primary' : ''}" data-action="set-gem-bar" data-bar="both">Both</button>
          </div>
        </div>`
      : '';

  return `<div class="modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(def.name)}">
    ${closeButton()}
    <div class="item-hero" style="--g:${def.school ? schoolColor(def.school) : '#D4AF37'}">
      ${assetImg(def.assetId, def.name)}
      <div style="flex:1">
        <h3>${escapeHtml(def.name)}</h3>
        <div class="modal-sub" style="text-align:left;margin-bottom:4px">${escapeHtml(def.kind.toUpperCase())} · Lv ${gem.level} / 20</div>
        <div class="bar"><b style="width:${gem.level >= 20 ? '100%' : pct(gem.xp, xpNext)};background:var(--xp)"></b></div>
        <div class="tiny muted">${gem.level >= 20 ? 'Max Level' : `${fmt(gem.xp)} / ${fmt(xpNext)} XP`}</div>
      </div>
    </div>
    <p class="tiny" style="line-height:1.45;color:var(--text);margin-bottom:6px">${escapeHtml(def.description)}</p>
    <div>${school}${tags}</div>
    ${liveRows}
    ${barButtons}
    <div class="modal-actions">
      <button class="btn primary" data-action="level-gem" ${canDust ? '' : 'disabled'}>${gem.level >= 20 ? 'Max Level' : `Level Up (${dustCost} Dust)`}</button>
      ${item && socketIndex !== undefined ? `<button class="btn danger" data-action="unsocket-gem" data-uid="${escapeHtml(item.uid)}" data-index="${socketIndex}">Unsocket</button>` : ''}
    </div>
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
    : `<button class="btn primary" data-action="allocate-node" data-node="${escapeHtml(node.id)}">Allocate</button>`;

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
              <div class="gem-name">${escapeHtml(def.name)} <span class="muted tiny">Lv ${gem.level}</span></div>
              <div class="gem-meta">${escapeHtml(def.description)}</div>
            </div>
            <span class="tiny gold">Socket</span>
          </button>`;
        })
        .join('')
    : `<div class="empty-note">No gems in the pouch. Find gems from enemies or unsocket one.</div>`;

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
    case 'gem':
      return gemInspectModal(store, modal);
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
