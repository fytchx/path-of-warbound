import { gemById, zones } from '../../data';
import type { School } from '../../data/types';
import { recentDps } from '../../engine/combatEngine';
import type { GameStore } from '../store';
import { ailmentIcon, assetImg, escapeHtml, fmt, pct, schoolColor, schoolIcon } from '../dom';

const SCHOOLS: School[] = ['physical', 'fire', 'frost', 'lightning', 'void'];

function zoneShort(name: string): string {
  return name.replace('Ashen ', '').replace('Frozen ', '').replace('Ember ', '');
}

function swingPercent(store: GameStore): number {
  const player = store.combat.player;
  const haste = 1 + (store.stats.values.attack_speed ?? 0) / 100;
  const aps = Math.max(0.2, store.stats.weapon.attacksPerSecond * haste);
  const interval = 1 / aps;
  return Math.min(100, Math.max(0, (1 - player.attackTimer / interval) * 100));
}

const PADLOCK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

function skillBar(store: GameStore): string {
  const skills = store.stats.skills;
  const unlockedSlots = Math.max(1, store.save.skillSlots);
  const totalSlots = Math.max(6, unlockedSlots);
  const bar = store.combat.activeBar;
  const barTwoUnlocked = store.isSystemUnlocked('bar_2');

  const slots = Array.from({ length: totalSlots }, (_, index) => {
    const skill = skills[index];
    if (skill) {
      const gem = gemById.get(skill.gemId);
      const remaining = store.combat.player.skillTimers[skill.id] ?? 0;
      const cooldown = Math.max(0.001, skill.cooldown);
      const ready = remaining <= 0;
      const wrongBar = skill.bar !== 'both' && skill.bar !== bar;
      const cdPct = ready ? 0 : Math.min(100, Math.max(0, (remaining / cooldown) * 100));
      return `<button class="skill ${ready && !wrongBar ? 'hot' : ''}" data-action="cast" data-skill="${escapeHtml(skill.id)}" data-cd="${cooldown}" title="${escapeHtml(skill.name)}" aria-label="${escapeHtml(skill.name)}">
        ${gem ? assetImg(gem.assetId, skill.name) : ''}
        ${wrongBar ? `<span class="lock">${skill.bar === 'bar_1' ? 'I' : 'II'}</span>` : !ready ? `<span class="cd" style="height:${cdPct}%"></span><span class="cdtime">${remaining.toFixed(1)}</span>` : ''}
      </button>`;
    }
    if (index < unlockedSlots) {
      return `<button class="skill empty" data-action="empty-slot" title="Empty skill slot — socket an active gem in Altar" aria-label="Empty skill slot">
        <span class="empty-plus" aria-hidden="true">+</span>
      </button>`;
    }
    return `<button class="skill locked" data-action="locked-slot" title="Locked skill slot" aria-label="Locked skill slot">
      ${PADLOCK_SVG}
    </button>`;
  }).join('');

  const barPill = barTwoUnlocked
    ? `<button class="pill" data-action="bar" data-bar="${bar === 'bar_1' ? 'bar_2' : 'bar_1'}" aria-label="Switch skill bar">${bar === 'bar_1' ? 'BAR I' : 'BAR II'}</button>`
    : '';

  return `<div class="skills">
    ${barPill}
    <div class="slots">${slots}</div>
    <div class="swing" aria-hidden="true"><b data-swing style="width:${swingPercent(store)}%"></b></div>
  </div>`;
}

function enemyMarkup(store: GameStore): string {
  const enemies = store.combat.enemies;
  if (!enemies.length) {
    return `<div class="banner" style="top:120px;${store.combat.status === 'victory' ? '' : 'display:none'}">The pack gathers</div>`;
  }
  return `<div class="mobs">${enemies
    .map((enemy) => {
      const def = store.enemyDef(enemy);
      const ailments = Object.keys(enemy.ailments);
      const slamming = enemy.defId === 'mob_boss' && (enemy.slamTelegraph ?? 0) > 0;
      return `<div class="mob ${enemy.hp <= 0 ? 'dead' : ''}" data-enemy-uid="${escapeHtml(enemy.uid)}" title="${escapeHtml(enemy.name)}">
        <div class="oval ${slamming ? 'slam-telegraph' : ''}" style="--c:${schoolColor(enemy.school)}">
          ${def ? assetImg(def.assetId, enemy.name) : escapeHtml(enemy.name.slice(0, 1))}
          ${slamming ? '<span class="slam-badge">SLAM!</span>' : ''}
        </div>
        <div class="ail">${ailments
          .map((ailment) => assetImg(ailmentIcon(ailment), ailment, '', ` title="${escapeHtml(ailment)}"`))
          .join('')}</div>
        <div class="hpbar"><b style="width:${pct(enemy.hp, enemy.maxHp)}"></b></div>
        <div class="name">${escapeHtml(enemy.name)}</div>
      </div>`;
    })
    .join('')}</div>`;
}

function arena(store: GameStore): string {
  const combat = store.combat;
  const player = combat.player;
  const stats = store.stats;
  const zone = combat.zone;
  const status = combat.status === 'victory' ? 'CLEARED' : combat.status === 'dead' ? 'SPARK OUT' : combat.bossActive ? 'BOSS' : `WAVE ${combat.wave}`;
  const whisper = store.whisperText();
  const keyPulse = Date.now() - store.ui.keyPulseAt < 1800;
  const canSummonBoss = combat.keys >= 3 && !combat.bossActive && combat.status === 'running';

  return `<div class="frame arena">
    ${assetImg(zone.assetId, zone.name, 'arena-bg')}
    <div class="arena-shade" aria-hidden="true"></div>
    <div class="banner">${escapeHtml(zone.name)} · TIER ${combat.tier}</div>
    <div class="badges">
      <span>${status}</span>
      <span>PACK <b>${combat.enemies.filter((enemy) => enemy.hp > 0).length}/${combat.packSize}</b></span>
      <span class="${keyPulse ? 'key-pulse' : ''}">KEYS <b>${combat.keys}/3</b></span>
    </div>
    ${whisper
      ? `<div class="whisper" role="status">
          <span>${escapeHtml(whisper)}</span>
          ${store.ui.whisperOverride ? '<button class="whisper-x" data-action="dismiss-whisper" aria-label="Dismiss whisper">✕</button>' : ''}
        </div>`
      : ''}
    <span class="vnum l">${fmt(player.hp)}</span>
    <div class="vial l" title="Health ${fmt(player.hp)} / ${fmt(stats.maxHp)}${player.ward > 0 ? ` · ward ${fmt(player.ward)}` : ''}">
      <b style="height:${pct(player.hp, stats.maxHp)}"></b>${player.ward > 0 ? '<s></s>' : ''}
    </div>
    <span class="vnum r">${fmt(player.mana)}</span>
    <div class="vial r" title="Mana ${fmt(player.mana)} / ${fmt(stats.maxMana)}">
      <b style="height:${pct(player.mana, stats.maxMana)}"></b>
    </div>
    ${enemyMarkup(store)}
    <div class="combat-fx" id="combat-fx" aria-hidden="true"></div>
    ${canSummonBoss ? `<button class="boss-summon" data-action="summon-boss">SUMMON ZONE BOSS</button>` : ''}
    ${skillBar(store)}
  </div>`;
}

function controlStrip(store: GameStore): string {
  const combat = store.combat;
  const maxPack = store.maxPackSize();
  const packUnlocked = maxPack > 1;
  const autoBossUnlocked = store.isSystemUnlocked('auto_boss');

  return `<div class="frame pan ctl">
    <div class="zonechips">
      ${zones
        .map(
          (entry) => `<button class="${entry.id === store.save.zoneId ? 'on' : ''}" data-action="zone" data-zone="${entry.id}" title="${escapeHtml(entry.name)}">${escapeHtml(zoneShort(entry.name))}</button>`,
        )
        .join('')}
    </div>
    <div class="stepper" title="Tier: higher tiers hit harder and pay more">
      <button data-action="tier-prev" aria-label="Lower tier">−</button>
      <span><small>TIER</small>${combat.tier}</span>
      <button data-action="tier-next" aria-label="Raise tier">+</button>
    </div>
    ${packUnlocked
      ? `<div class="stepper" title="Pack size: enemies per wave (max ${maxPack})">
          <button data-action="pack-prev" aria-label="Fewer enemies">−</button>
          <span><small>PACK</small>${combat.packSize}</span>
          <button data-action="pack-next" aria-label="More enemies">+</button>
        </div>`
      : ''}
    ${autoBossUnlocked
      ? `<button class="gbtn sm ${store.save.autoAdvanceBoss ? 'on' : ''}" data-action="toggle-auto-boss" title="Auto-summon boss when 3 Rift Keys are gathered">AUTO-BOSS</button>`
      : ''}
    <button class="icon-btn" data-action="pause" aria-label="${store.ui.paused ? 'Resume' : 'Pause'}" title="${store.ui.paused ? 'Resume' : 'Pause'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${store.ui.paused ? '<path d="M8 5l11 7-11 7z"/>' : '<path d="M9 5v14M15 5v14"/>'}</svg>
    </button>
  </div>`;
}

function damagePanel(store: GameStore): string {
  const bySchool = new Map<School, number>();
  for (const sample of store.combat.damageLog) {
    if (sample.amount <= 0) continue;
    bySchool.set(sample.school, (bySchool.get(sample.school) ?? 0) + sample.amount);
  }
  const total = [...bySchool.values()].reduce((sum, value) => sum + value, 0);
  const rows = SCHOOLS.map((school) => {
    const value = bySchool.get(school) ?? 0;
    return `<tr>
      <td><span class="d" style="background:${schoolColor(school)}"></span>${school}</td>
      <td>${value > 0 ? fmt(value) : '—'}</td>
      <td>${total > 0 ? ((value / total) * 100).toFixed(0) : 0}%</td>
    </tr>`;
  }).join('');
  return `<div class="frame pan">
    <h4>Damage Meter<span>${fmt(recentDps(store.combat, 5), 1)} dps</span></h4>
    <table><thead><tr><th>Source</th><th>Damage</th><th>Share</th></tr></thead>
      <tbody>${rows}<tr class="total"><td>Total</td><td>${fmt(total)}</td><td>100%</td></tr></tbody>
    </table>
  </div>`;
}

function timersPanel(store: GameStore): string {
  const buffs = store.combat.player.buffs;
  const rows = buffs.length
    ? buffs
        .map((buff) => {
          const label = buff.damageMore ? `${fmt(buff.damageMore * 100)}% damage` : buff.attackSpeed ? 'attack speed' : 'buff';
          return `<div class="row"><span>${escapeHtml(buff.name)}</span><span class="tiny muted">${buff.remaining.toFixed(1)}s</span></div>
            <div class="bar"><b style="width:${Math.min(100, buff.remaining * 20)}%;background:var(--ward)"></b></div>
            <div class="tiny muted" style="margin-top:-3px">${label}</div>`;
        })
        .join('')
    : '<div class="tiny muted">No effects active.</div>';
  return `<div class="frame pan">
    <h4>Timers<span>${buffs.length}</span></h4>
    ${rows}
  </div>`;
}

function statsPanel(store: GameStore): string {
  const stats = store.stats;
  const combat = store.combat;
  const aps = stats.weapon.attacksPerSecond * (1 + (stats.values.attack_speed ?? 0) / 100);
  const rows: [string, string][] = [
    ['Attack speed', `${aps.toFixed(2)}/s`],
    ['Crit chance', `${(stats.critChance * 100).toFixed(1)}%`],
    ['Crit multi', `${(stats.critMultiplier * 100).toFixed(0)}%`],
    ['Double hit', `${(stats.doubleHitChance * 100).toFixed(1)}%`],
    ['Dodge', `${fmt(stats.dodgeCap)} per hit`],
    ['Deaths', fmt(combat.player.deaths)],
  ];
  return `<div class="frame pan">
    <h4>Stats<span>GS ${stats.gearscore}</span></h4>
    ${rows.map(([label, value]) => `<div class="row"><span>${label}</span><span class="gold">${value}</span></div>`).join('')}
    <div class="tiny muted" style="margin-top:4px">${escapeHtml(stats.weaponName)}</div>
  </div>`;
}

function ratePills(store: GameStore): string {
  const combat = store.combat;
  const seconds = Math.max(1, combat.time);
  const perHour = (value: number): string => fmt((value / seconds) * 3600);
  const cells: [string, string][] = [
    ['XP / HR', perHour(combat.rewards.xp)],
    ['GOLD / HR', perHour(combat.rewards.gold)],
    ['KILLS / HR', perHour(combat.rewards.kills)],
    ['ELITES / HR', perHour(combat.rewards.eliteKills)],
  ];
  return `<div class="pills">${cells.map(([label, value]) => `<div>${label}<b>${value}</b></div>`).join('')}</div>`;
}

function logPanel(store: GameStore): string {
  const entries = store.combat.log.slice(0, 8);
  if (!entries.length) return '';
  return `<div class="frame pan">
    <h4>War Log<span>${store.combat.log.length}</span></h4>
    <div class="log">${entries
      .map((entry) => `<div><span class="muted">[${entry.t.toFixed(0)}]</span> ${escapeHtml(entry.text)}</div>`)
      .join('')}</div>
  </div>`;
}

function spoilsPanel(store: GameStore): string {
  const rewards = store.combat.rewards;
  const rows: [string, string][] = [
    ['Kills', fmt(rewards.kills)],
    ['Elites', fmt(rewards.eliteKills)],
    ['Bosses', fmt(rewards.bossKills)],
    ['Gold', fmt(rewards.gold)],
    ['XP', fmt(rewards.xp)],
    ['Damage', fmt(rewards.damage)],
  ];
  return `<div class="frame pan">
    <h4>Spoils<span>tier ${store.combat.tier}</span></h4>
    ${rows.map(([label, value]) => `<div class="row"><span>${label}</span><span class="gold">${value}</span></div>`).join('')}
  </div>`;
}

export function combatScreen(store: GameStore): string {
  const combat = store.combat;
  const doctrinesUnlocked = store.isSystemUnlocked('doctrines');
  return `<section class="screen" data-screen="combat" aria-label="Combat">
    ${arena(store)}
    ${controlStrip(store)}
    ${combat.status === 'victory'
      ? `<div class="frame pan" style="text-align:center">
          <h4 style="justify-content:center">Tier Cleared</h4>
          <p class="tiny muted" style="margin-bottom:6px">The Bound One is unmade.</p>
          <button class="gbtn" data-action="next-tier">Descend to Tier ${Math.min(10, combat.tier)}</button>
        </div>`
      : combat.status === 'dead'
        ? `<div class="frame pan" style="text-align:center">
            <h4 style="justify-content:center">${combat.tier <= 1 ? 'Your Vessel Shattered' : 'The Spark Guttered'}</h4>
            <p class="tiny muted">${combat.tier <= 1 ? `Reforming at Tier 1 in ${combat.deathTimer.toFixed(1)}s · Keys preserved` : `Reforming in ${combat.deathTimer.toFixed(1)}s · tier ${combat.tier}`}</p>
          </div>`
        : ''}
    ${damagePanel(store)}
    <div class="two">${timersPanel(store)}${statsPanel(store)}</div>
    ${ratePills(store)}
    ${store.save.settings.logCombat ? `<div class="two">${logPanel(store)}${spoilsPanel(store)}</div>` : spoilsPanel(store)}
    <p class="hint">${doctrinesUnlocked ? `${escapeHtml(combat.doctrine)} doctrine · ` : ''}${store.ui.paused ? 'paused' : 'auto-casting'}${store.stats.keystones.has('ks_pendulum') ? ' · pendulum swaps bars' : ''}</p>
  </section>`;
}
