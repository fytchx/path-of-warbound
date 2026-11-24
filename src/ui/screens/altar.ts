import { doctrines, itemBaseById } from '../../data';
import type { ItemSlot } from '../../data/types';
import { RARITY_COLOR } from '../../game/items';
import type { GameStore } from '../store';
import { assetImg, escapeHtml, fmt, titleCase } from '../dom';

const SLOT_ORDER: ItemSlot[] = [
  'main_hand',
  'helmet',
  'amulet',
  'chest',
  'off_hand',
  'gloves',
  'ring_1',
  'trinket',
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
  if (!item) {
    return `<button class="eq${wide}" data-slot="${slot}" data-action="open-slot" aria-label="${label}: empty">
      <span class="empty-mark"></span>
      <small>${label}</small>
    </button>`;
  }
  const base = itemBaseById.get(item.baseId);
  const color = RARITY_COLOR[item.rarity];
  const sockets = item.sockets.map((gem) => `<i class="${gem ? 'filled' : ''}"></i>`).join('');
  return `<button class="eq rarity${wide}" data-slot="${slot}" data-action="open-item" data-uid="${item.uid}" data-rarity="${item.rarity}" style="--c:${color}" aria-label="${escapeHtml(store.itemBaseName(item))}">
    ${base ? assetImg(base.assetId, base.name) : ''}
    <small>${label}</small>
    ${sockets ? `<span class="pips">${sockets}</span>` : ''}
  </button>`;
}

export function altarScreen(store: GameStore): string {
  const stats = store.stats;
  const values = stats.values;
  const trinket = store.save.equipment.trinket;
  const trinketBase = trinket ? itemBaseById.get(trinket.baseId) : null;
  const doctrine = doctrines.find((entry) => entry.id === store.save.doctrine);
  const doctrinesUnlocked = store.isSystemUnlocked('doctrines');

  return `<section class="screen" data-screen="altar" aria-label="Altar">
    <div class="sub-h">
      <h2>GEARSCORE: ${fmt(store.gearscore())}</h2>
      <div class="row" style="gap:4px">
        <button class="gbtn" data-action="modal-stats">STATS ›</button>
      </div>
    </div>

    ${store.save.onboardingStep === 2 && !store.save.settings.guideSkipped
      ? `<div class="frame pan whisper-card"><span class="tiny gold">Tap your Warbound Cuirass (or Bag) to open its 2 linked sockets and combine Cleave + Multistrike.</span></div>`
      : store.save.onboardingStep === 1 && !store.save.settings.guideSkipped && store.save.inventory.length > 0
        ? `<div class="frame pan whisper-card"><span class="tiny gold">Open [BAG] below and tap your new armor to equip it onto the Altar.</span></div>`
        : ''}

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

    ${doctrinesUnlocked
      ? `<div class="frame pan">
          <h4>Combat Doctrine<span>${doctrine?.guardThreshold ?? 45}% guard</span></h4>
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
        </div>`
      : ''}

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
            ['Speed', `${(stats.attackSpeedMultiplier * 100).toFixed(0)}%`],
            ['Mana regen', `${stats.manaRegen.toFixed(1)}/s`],
          ] as [string, string][]
        )
          .map(([label, value]) => `<div class="row"><span>${label}</span><span class="gold">${value}</span></div>`)
          .join('')}
      </div>
    </div>

    ${
      trinketBase
        ? `<div class="frame pan">
            <h4>Trinket<span>${escapeHtml(trinketBase.name)}</span></h4>
            <p class="tiny" style="line-height:1.45">${escapeHtml(trinketBase.uniqueEffect ?? trinketBase.flavour)}</p>
          </div>`
        : ''
    }
  </section>`;
}
