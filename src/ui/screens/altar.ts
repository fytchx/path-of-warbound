import { doctrines, gemById, itemBaseById, uniqueById } from '../../data';
import type { ItemSlot } from '../../data/types';
import { itemDisplayName, RARITY_COLOR } from '../../game/items';
import type { GameStore } from '../store';
import { assetImg, escapeHtml, fmt, sprite, titleCase } from '../dom';

/**
 * Soul-Forged Altar Grid Layout:
 * Row 1: Main-Hand (2 rows) | Amulet | Helmet | Trinket
 * Row 2: Main-Hand (cont.)  | Gloves | Chest  | Ring 1
 * Row 3: Offhand (locked 2H)| Boots  | Legs   | Ring 2
 */
const SLOT_ORDER: ItemSlot[] = [
  'main_hand',
  'amulet',
  'helmet',
  'trinket',
  'gloves',
  'chest',
  'ring_1',
  'off_hand',
  'boots',
  'legs',
  'ring_2',
];

const ATTRIBUTES = [
  { id: 'might', icon: 'attr_might', label: 'Might' },
  { id: 'agility', icon: 'attr_agility', label: 'Agility' },
  { id: 'wisdom', icon: 'attr_wisdom', label: 'Wisdom' },
  { id: 'fortitude', icon: 'attr_fortitude', label: 'Fortitude' },
] as const;

function slotMarkup(store: GameStore, slot: ItemSlot): string {
  const item = store.save.equipment[slot];
  const label = store.itemSlotLabel(slot);
  const wide = slot === 'main_hand' ? ' w' : '';
  const twoHandedMain = store.save.equipment.main_hand
    ? Boolean(itemBaseById.get(store.save.equipment.main_hand.baseId)?.weapon?.twoHanded)
    : false;
  const offhandLocked = slot === 'off_hand' && twoHandedMain;

  if (!item) {
    return `<button class="eq${wide} ${offhandLocked ? 'locked-off' : ''}" data-slot="${slot}" data-action="${offhandLocked ? 'locked-offhand' : 'open-slot'}" aria-label="${label}: ${offhandLocked ? 'locked by two-handed weapon' : 'empty'}">
      <span class="empty-mark"></span>
      <small>${offhandLocked ? '2H Span' : label}</small>
    </button>`;
  }

  const base = itemBaseById.get(item.baseId);
  const name = itemDisplayName(item);
  const color = RARITY_COLOR[item.rarity];
  const linked = item.linkedSockets ?? 1;
  const sockets = item.sockets
    .map((gem, idx) => {
      const linkNext = idx + 1 < linked && idx + 1 < item.sockets.length;
      return `<i class="${gem ? 'filled' : ''}"></i>${linkNext ? '<u class="pip-link"></u>' : ''}`;
    })
    .join('');

  return `<button class="eq rarity${wide}" data-slot="${slot}" data-action="open-item" data-uid="${item.uid}" data-rarity="${item.rarity}" style="--c:${color}" title="${escapeHtml(name)}" aria-label="${escapeHtml(name)}">
    ${base ? assetImg(base.assetId, name) : ''}
    ${item.uniqueId ? '<span class="mythic-star" title="Mythic Unique">✦</span>' : ''}
    <small>${label}</small>
    ${sockets ? `<span class="pips">${sockets}</span>` : ''}
  </button>`;
}

function linkedSkillsSummary(store: GameStore): string {
  const skills = store.stats.skills;
  if (!skills.length) {
    return `<div class="frame pan">
      <h4>Socketed Skills<span>0 active</span></h4>
      <p class="tiny muted">Tap any equipped item above to socket a Skill Gem or Support Gem.</p>
    </div>`;
  }
  const rows = skills
    .map((skill) => {
      const gem = gemById.get(skill.gemId);
      const slotLabel = store.itemSlotLabel(skill.sourceSlot as ItemSlot);
      const supportText = skill.linkedSupportNames.length
        ? `Linked: ${skill.linkedSupportNames.join(', ')}`
        : skill.manaReservation > 0
          ? `Reserves ${skill.manaReservation}% mana`
          : 'No linked supports yet';
      return `<button class="skill-link-row" data-action="open-slot-gem" data-gem-uid="${escapeHtml(skill.sourceSlot)}" data-gem-idx="${skill.sourceSocketIndex}">
        ${gem ? assetImg(gem.assetId, skill.name) : ''}
        <span class="skill-link-info">
          <b>${escapeHtml(skill.name)} <small class="muted">(${escapeHtml(slotLabel)})</small></b>
          <span class="tiny muted">${escapeHtml(supportText)}</span>
        </span>
        <span class="tiny gold">Inspect ›</span>
      </button>`;
    })
    .join('');

  return `<div class="frame pan">
    <h4>Socketed Skills<span>${skills.length} active · tap to edit</span></h4>
    <div class="skill-link-list">${rows}</div>
  </div>`;
}

export function altarScreen(store: GameStore): string {
  const stats = store.stats;
  const values = stats.values;
  const trinket = store.save.equipment.trinket;
  const trinketBase = trinket ? itemBaseById.get(trinket.baseId) : null;
  const trinketUnique = trinket?.uniqueId ? uniqueById.get(trinket.uniqueId) : null;
  const doctrine = doctrines.find((entry) => entry.id === store.save.doctrine);
  const doctrineLocked = stats.keystones.has('ks_zealots_mandate');

  return `<section class="screen" data-screen="altar" aria-label="Altar">
    <div class="sub-h">
      <h2>GEARSCORE: ${fmt(store.gearscore())}</h2>
      <div class="row" style="gap:4px">
        <button class="gbtn" data-action="modal-stats">FULL STATS ›</button>
      </div>
    </div>

    <div class="frame attrs">
      ${ATTRIBUTES.map(
        (attribute) => `<div>
          ${assetImg(attribute.icon, attribute.label)}
          <b>${fmt(values[attribute.id] ?? 0, 0)}</b>${attribute.label}
        </div>`,
      ).join('')}
    </div>

    <div class="frame grid">
      ${SLOT_ORDER.map((slot) => slotMarkup(store, slot)).join('')}
    </div>

    ${linkedSkillsSummary(store)}

    <div class="frame pan">
      <h4>Combat Doctrine<span>${doctrine?.guardThreshold ?? 45}% guard${doctrineLocked ? ' · Locked' : ''}</span></h4>
      <div class="doctrines">
        ${doctrines
          .map(
            (entry) => `<button class="doctrine ${store.save.doctrine === entry.id ? 'active' : ''}" data-action="doctrine" data-doctrine="${entry.id}" title="${escapeHtml(entry.description)}">
              ${assetImg(entry.assetId, entry.name)}
              <span>${titleCase(entry.id)}</span>
            </button>`,
          )
          .join('')}
      </div>
      <p class="tiny muted" style="margin-top:6px;line-height:1.4">${escapeHtml(doctrine?.description ?? '')}</p>
      <p class="tiny muted" style="margin-top:4px">${escapeHtml(store.durabilityNote())}</p>
    </div>

    <div class="two">
      <div class="frame pan">
        <h4>Defence</h4>
        ${(
          [
            ['Health', fmt(stats.maxHp)],
            ['Ward', fmt(stats.maxWard)],
            ['Armor', fmt(stats.armor)],
            ['Dodge / hit', stats.dodgePerHit.toFixed(1)],
            ['Regen', `${stats.hpRegen.toFixed(1)}/s`],
          ] as [string, string][]
        )
          .map(([label, value]) => `<div class="row"><span>${label}</span><span class="gold">${value}</span></div>`)
          .join('')}
      </div>
      <div class="frame pan">
        <h4>Offence</h4>
        ${(
          [
            ['Crit chance', `${(stats.critChance * 100).toFixed(0)}%`],
            ['Crit multi', `${(stats.critMultiplier * 100).toFixed(0)}%`],
            ['Double hit', `${(stats.doubleHitChance * 100).toFixed(0)}%`],
            ['Atk / Cast', `${(stats.attackSpeedMultiplier * 100).toFixed(0)}% / ${(stats.castSpeedMultiplier * 100).toFixed(0)}%`],
            ['Mana', `${fmt(stats.maxMana)} (${stats.manaRegen.toFixed(1)}/s)`],
          ] as [string, string][]
        )
          .map(([label, value]) => `<div class="row"><span>${label}</span><span class="gold">${value}</span></div>`)
          .join('')}
      </div>
    </div>

    ${
      trinketBase
        ? `<div class="frame pan">
            <h4>Trinket<span>${escapeHtml(trinketUnique ? trinketUnique.name : trinketBase.name)}</span></h4>
            <p class="tiny" style="line-height:1.45">${escapeHtml(trinketUnique ? trinketUnique.description : trinketBase.description || trinketBase.flavour)}</p>
          </div>`
        : ''
    }
    ${sprite('w-divider', 'divider', '0 0 200 10')}
  </section>`;
}
