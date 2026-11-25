import { assetUrl } from '../../assets/loader';
import { gemById, zones } from '../../data';
import type { School } from '../../data/types';
import { recentDps } from '../../engine/combatEngine';
import type { GameStore } from '../store';
import { ailmentIcon, assetImg, clamp, escapeHtml, fmt, pct, schoolColor, sprite } from '../dom';

const SCHOOLS: School[] = ['physical', 'fire', 'frost', 'lightning', 'void'];

function zoneShort(name: string): string {
  return name.replace('Ashen ', '').replace('Frozen ', '').replace('Ember ', '');
}

export function swingPercent(store: GameStore, dt = 0): number {
  const player = store.combat.player;
  const interval = Math.max(0.1, player.attackInterval);
  const remaining = Math.max(0, player.attackTimer - dt);
  return clamp((1 - remaining / interval) * 100, 0, 100);
}

export function castPercent(store: GameStore, dt = 0): number {
  const player = store.combat.player;
  const cast = player.cast;
  if (!cast || cast.duration <= 0) return player.castLock > 0 ? 100 : 0;
  const elapsed = cast.duration - Math.max(0, cast.remaining - dt);
  return clamp((elapsed / cast.duration) * 100, 0, 100);
}

function rotationPill(store: GameStore): string {
  const mode = store.save.rotation.mode;
  const stacks = store.combat.player.disciplineStacks;
  const bonus = mode === 'manual' && stacks > 0 ? ` +${stacks * 6}%` : '';
  return `<button class="pill rot-pill" data-action="open-rotation" aria-label="Rotation priority">ROT · ${mode.toUpperCase()}${bonus}</button>`;
}

function skillBar(store: GameStore): string {
  const skills = store.stats.skills;
  const totalSlots = Math.max(6, skills.length);
  const bar = store.combat.activeBar;
  const pendulum = store.stats.keystones.has('ks_pendulum');
  const cast = store.combat.player.cast;
  const castSkill = cast ? skills.find((entry) => entry.id === cast.skillId) : undefined;
  const castGem = castSkill ? gemById.get(castSkill.gemId) : undefined;
  const castDuration = cast?.duration ?? 0;
  const castElapsed = cast ? Math.max(0, castDuration - cast.remaining) : 0;

  const slots = Array.from({ length: totalSlots }, (_, index) => {
    const skill = skills[index];
    if (skill) {
      const gem = gemById.get(skill.gemId);
      const isAura = skill.manaReservation > 0;
      const remaining = store.combat.player.skillTimers[skill.id] ?? 0;
      const cooldown = Math.max(0.001, skill.effectiveCooldown || skill.cooldown);
      const ready = remaining <= 0;
      const wrongBar = !isAura && skill.bar !== 'both' && skill.bar !== bar && !pendulum;
      const cdPct = ready ? 0 : clamp((remaining / cooldown) * 100, 0, 100);
      return `<button class="skill ${ready && !wrongBar ? 'hot' : ''} ${isAura ? 'aura' : ''}" data-action="${isAura ? 'open-slot-gem' : 'cast'}" data-skill="${escapeHtml(skill.id)}" data-gem-uid="${escapeHtml(skill.sourceSlot)}" data-gem-idx="${skill.sourceSocketIndex}" data-cd="${cooldown}" title="${escapeHtml(skill.name)}${skill.linkedSupportNames.length ? ` (${escapeHtml(skill.linkedSupportNames.join(', '))})` : ''}" aria-label="${escapeHtml(skill.name)}">
        ${gem ? assetImg(gem.assetId, skill.name) : ''}
        ${isAura
          ? `<span class="lock">AURA</span>`
          : wrongBar
            ? `<span class="lock">${skill.bar === 'bar_1' ? 'I' : 'II'}</span>`
            : `<span class="cd" style="height:${ready ? 0 : cdPct.toFixed(1)}%"></span><span class="cdtime">${!ready && remaining > 0.05 ? remaining.toFixed(1) : ''}</span>`}
      </button>`;
    }
    return `<button class="skill empty" data-action="empty-slot" title="Empty skill slot — socket an active gem in Altar" aria-label="Empty skill slot">
      <span class="empty-plus" aria-hidden="true">+</span>
    </button>`;
  }).join('');

  return `<div class="skills">
    <div class="bar-row">
      <button class="pill ${pendulum ? 'locked' : ''}" data-action="bar" data-bar="${bar === 'bar_1' ? 'bar_2' : 'bar_1'}" aria-label="Switch skill bar">${pendulum ? `AUTO · ${bar === 'bar_1' ? 'BAR I' : 'BAR II'}` : bar === 'bar_1' ? 'BAR I' : 'BAR II'}</button>
      ${rotationPill(store)}
    </div>
    <div class="slots">${slots}</div>
    <div class="cast ${cast ? 'casting' : ''}" data-cast-bar ${cast ? '' : 'hidden'} style="--c:${castGem?.school ? schoolColor(castGem.school) : 'var(--ward)'}" aria-hidden="true">
      <img class="cast-icon" data-cast-icon src="${assetUrl(castGem?.assetId ?? 'fx_soulspark')}" alt="${escapeHtml(castGem?.name ?? '')}" ${castGem ? '' : 'hidden'} draggable="false" />
      <span class="cast-stack">
        <b class="cast-name" data-cast-name>${escapeHtml(castGem?.name ?? 'Casting')}</b>
        <span class="cast-label" data-cast-label>${cast ? `${castElapsed.toFixed(1)}s → ${castDuration.toFixed(1)}s` : ''}</span>
      </span>
      <b data-cast-fill class="cast-fill" style="width:${castPercent(store).toFixed(1)}%"></b>
    </div>
    <div class="swing" aria-hidden="true"><b data-swing style="width:${swingPercent(store).toFixed(1)}%"></b></div>
  </div>`;
}

export function renderEnemyAilments(enemy: GameStore['combat']['enemies'][number]): string {
  const entries = Object.entries(enemy.ailments) as [string, { remaining: number; stacks: number } | undefined][];
  const badges = entries
    .filter(([, inst]) => inst && inst.remaining > 0)
    .map(
      ([ailment, inst]) =>
        `<span class="ail-badge" title="${escapeHtml(ailment)} (${inst!.stacks}x, ${inst!.remaining.toFixed(1)}s)">
          ${assetImg(ailmentIcon(ailment), ailment)}
          <b>${inst!.stacks > 1 ? `${inst!.stacks}x` : `${inst!.remaining.toFixed(0)}s`}</b>
        </span>`,
    );
  if ((enemy.exposureRemaining ?? 0) > 0) {
    badges.push(
      `<span class="ail-badge exp" title="Exposure (+20% ailment damage, ${enemy.exposureRemaining!.toFixed(1)}s)"><b>EXP</b></span>`,
    );
  }
  return badges.join('');
}

export function enemyCardMarkup(store: GameStore): string {
  const enemies = store.combat.enemies;
  if (!enemies.length) {
    return `<div class="banner" style="top:120px;${store.combat.status === 'victory' ? '' : 'display:none'}">The pack gathers</div>`;
  }
  return enemies
    .map((enemy) => {
      const def = store.enemyDef(enemy);
      const telegraph = enemy.slamTelegraph ?? 0;
      const slamming = telegraph > 0;
      const frozen = (enemy.ailments.chill?.stacks ?? 0) >= 3;
      const atkPct = clamp((1 - enemy.attackTimer / Math.max(0.2, enemy.attackInterval)) * 100, 0, 100);
      const wardPct = (enemy.maxWard ?? 0) > 0 ? clamp(((enemy.ward ?? 0) / (enemy.maxWard ?? 1)) * 100, 0, 100) : 0;
      const phaseLabel = enemy.boss ? `PHASE ${(enemy.phaseIndex ?? 0) + 1}` : '';
      return `<div class="mob ${enemy.hp <= 0 ? 'dead' : ''} ${frozen ? 'frozen' : ''} ${enemy.boss ? 'boss' : ''}" data-enemy-uid="${escapeHtml(enemy.uid)}" title="${escapeHtml(enemy.name)}">
        <div class="oval ${slamming ? 'slam-telegraph' : ''}" style="--c:${schoolColor(enemy.school)}">
          ${def ? assetImg(def.assetId, enemy.name) : escapeHtml(enemy.name.slice(0, 1))}
          ${sprite('w-oval', 'oval-frame', '0 0 80 104')}
          <span class="diamond-badge tier-badge" title="Tier">T${store.combat.tier}</span>
          <span class="diamond-badge hp-badge" title="Enemy HP">
            ${sprite('w-diamond', 'diamond-svg', '0 0 24 24', '--f:#4a1012')}
            <b data-mob-hp-text>${fmt(Math.ceil(enemy.hp))}</b>
          </span>
          <span class="diamond-badge atk-badge" title="Next enemy attack">
            ${sprite('w-diamond', 'diamond-svg', '0 0 24 24', '--f:#2a2312')}
            <b data-mob-atk-text>${frozen ? '❄' : `${Math.max(0, enemy.attackTimer).toFixed(1)}`}</b>
          </span>
          ${slamming ? '<span class="slam-badge">SLAM!</span>' : ''}
          ${enemy.boss ? `<span class="phase-chip">${phaseLabel}</span>` : ''}
        </div>
        ${slamming
          ? `<div class="mob-warn" role="status">⚠ ${escapeHtml((enemy.slamName ?? 'HEAVY STRIKE').toUpperCase())} — ${telegraph.toFixed(1)}s</div>`
          : ''}
        <div class="ail" data-mob-ail>${renderEnemyAilments(enemy)}</div>
        <div class="hpbar"><b data-mob-hp style="width:${pct(enemy.hp, enemy.maxHp)}"></b></div>
        ${(enemy.maxWard ?? 0) > 0 ? `<div class="wardbar" title="Ward ${fmt(enemy.ward ?? 0)} / ${fmt(enemy.maxWard ?? 0)}"><b data-mob-ward style="width:${wardPct.toFixed(1)}%"></b></div>` : ''}
        <div class="atkbar ${enemy.attackTimer < 0.35 ? 'warn' : ''}"><b data-mob-atk style="width:${atkPct.toFixed(1)}%"></b></div>
        <div class="name">${escapeHtml(enemy.name)}${enemy.boss ? `<span class="boss-tag">BOSS</span>` : ''}</div>
      </div>`;
    })
    .join('');
}

function arena(store: GameStore): string {
  const combat = store.combat;
  const player = combat.player;
  const stats = store.stats;
  const zone = combat.zone;
  const status = combat.status === 'victory' ? 'CLEARED' : combat.status === 'dead' ? 'SPARK OUT' : combat.bossActive ? 'BOSS' : `WAVE ${combat.wave}`;
  const keyPulse = Date.now() - store.ui.keyPulseAt < 1800;
  const canSummonBoss = combat.keys >= 3 && !combat.bossActive && combat.status === 'running';
  const wardPct = stats.maxWard > 0 ? clamp((player.ward / stats.maxWard) * 100, 0, 100) : 0;

  return `<div class="frame arena ${combat.bossActive ? 'boss-mode' : ''}">
    ${assetImg(zone.assetId, zone.name, 'arena-bg')}
    <div class="arena-shade" aria-hidden="true"></div>
    <div class="arena-motes" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="banner" data-arena-banner>${escapeHtml(zone.name)} · TIER ${combat.tier}</div>
    <div class="badges" data-arena-badges>
      <span data-badge-status>${status}</span>
      <span>PACK <b data-badge-pack>${combat.enemies.filter((enemy) => enemy.hp > 0).length}/${combat.packSize}</b></span>
      <span data-badge-keys-wrap class="${keyPulse ? 'key-pulse' : ''}">KEYS <b data-badge-keys>${combat.keys}/3</b></span>
    </div>
    <span class="vnum l" data-vnum-hp>${fmt(player.hp)}</span>
    <div class="vial l ${player.ward > 0 ? 'warded' : ''}" data-vial-hp title="Health ${fmt(player.hp)} / ${fmt(stats.maxHp)} · Ward ${fmt(player.ward)} / ${fmt(stats.maxWard)}">
      <b data-hp-fill style="height:${pct(player.hp, stats.maxHp)}"></b>
      <s data-ward-fill style="height:${wardPct.toFixed(1)}%;opacity:${player.ward > 0 ? 0.85 : 0}"></s>
      ${sprite('w-vial', 'vial-frame', '0 0 36 200')}
    </div>
    <span class="vnum r" data-vnum-mana>${fmt(player.mana)}</span>
    <div class="vial r" data-vial-mana title="Mana ${fmt(player.mana)} / ${fmt(stats.maxMana)}${stats.reservedMana > 0 ? ` (${fmt(stats.reservedMana)} reserved)` : ''}">
      <b data-mana-fill style="height:${pct(player.mana, stats.maxMana)}"></b>
      ${sprite('w-vial', 'vial-frame', '0 0 36 200')}
    </div>
    <div class="mobs" data-mobs>${enemyCardMarkup(store)}</div>
    <div class="combat-fx" id="combat-fx" aria-hidden="true"></div>
    <button class="boss-summon" data-action="summon-boss" style="${canSummonBoss ? '' : 'display:none'}">⚔ Summon Tier ${combat.tier} Boss</button>
    ${skillBar(store)}
  </div>`;
}

function controlStrip(store: GameStore): string {
  const combat = store.combat;
  return `<div class="frame pan ctl">
    <div class="zonechips">
      ${zones
        .map((entry) => {
          const unlocked = store.save.unlockedZones.includes(entry.id);
          return `<button class="${entry.id === store.save.zoneId ? 'on' : ''}" data-action="zone" data-zone="${entry.id}" ${unlocked ? '' : 'disabled'} title="${escapeHtml(unlocked ? entry.name : `Sealed. Clear the previous realm's boss to open ${entry.name}.`)}">${escapeHtml(zoneShort(entry.name))}${unlocked ? '' : ' 🔒'}</button>`;
        })
        .join('')}
    </div>
    <div class="stepper" title="Tier: higher tiers hit harder and pay more">
      <button data-action="tier-prev" aria-label="Lower tier">−</button>
      <span data-ctl-tier><small>TIER</small>${combat.tier}</span>
      <button data-action="tier-next" aria-label="Raise tier" ${combat.tier >= store.maxTier() ? 'disabled' : ''}>+</button>
    </div>
    <div class="stepper" title="Pack size: enemies per wave (1–5)">
      <button data-action="pack-prev" aria-label="Fewer enemies">−</button>
      <span data-ctl-pack><small>PACK</small>${combat.packSize}</span>
      <button data-action="pack-next" aria-label="More enemies">+</button>
    </div>
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
          const pctVal = clamp((buff.remaining / Math.max(0.1, buff.duration || 5)) * 100, 0, 100);
          return `<div class="row"><span>${escapeHtml(buff.name)}</span><span class="tiny muted">${buff.remaining.toFixed(1)}s</span></div>
            <div class="bar"><b style="width:${pctVal.toFixed(1)}%;background:var(--ward)"></b></div>
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
  const aps = stats.weapon.attacksPerSecond * stats.attackSpeedMultiplier;
  const rows: [string, string][] = [
    ['Attack speed', `${aps.toFixed(2)}/s`],
    ['Crit chance', `${(stats.critChance * 100).toFixed(1)}%`],
    ['Crit multi', `${(stats.critMultiplier * 100).toFixed(0)}%`],
    ['Double hit', `${(stats.doubleHitChance * 100).toFixed(1)}%`],
    ['Ward', `${fmt(combat.player.ward)}/${fmt(stats.maxWard)}`],
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

function telemetryStrip(store: GameStore): string {
  const combat = store.combat;
  const dps = recentDps(combat, 5);
  const incoming = combat.incomingDamage
    .filter((sample) => sample.t >= combat.time - 5)
    .reduce((sum, sample) => sum + sample.amount, 0) / 5;
  const buffs = combat.player.buffs.slice(0, 3);
  const chips = buffs.length
    ? buffs.map((buff) => `<span class="tele-chip">${escapeHtml(buff.name)} <b>${buff.remaining.toFixed(1)}s</b></span>`).join('')
    : `<span class="tele-chip muted">${escapeHtml(combat.doctrine)} doctrine</span>`;
  return `<div class="telemetry" aria-label="Live combat telemetry">
    <span class="tele-dps"><small>DPS</small><b data-tele-dps>${fmt(dps, 1)}</b></span>
    <span class="tele-in"><small>INCOMING</small><b data-tele-in>${fmt(incoming, 1)}</b></span>
    <span class="tele-buffs" data-tele-buffs>${chips}</span>
  </div>`;
}

function logPanel(store: GameStore): string {
  const filter = store.ui.logFilter;
  const lootKinds = new Set(['key', 'kill', 'boss']);
  const entries = store.combat.log
    .filter((entry) => filter === 'all' || (filter === 'loot' ? lootKinds.has(entry.kind) : !lootKinds.has(entry.kind)))
    .slice(0, 8);
  const tabs: { id: 'all' | 'loot' | 'combat'; label: string }[] = [
    { id: 'all', label: 'ALL' },
    { id: 'loot', label: 'LOOT & KEYS' },
    { id: 'combat', label: 'COMBAT' },
  ];
  return `<div class="frame pan">
    <h4>War Log<span>${store.combat.log.length}</span></h4>
    <div class="log-tabs" role="tablist">${tabs
      .map((tab) => `<button role="tab" aria-selected="${filter === tab.id}" class="${filter === tab.id ? 'active' : ''}" data-action="log-filter" data-filter="${tab.id}">${tab.label}</button>`)
      .join('')}</div>
    <div class="log">${entries.length
      ? entries
          .map((entry) => `<div><span class="muted">[${entry.t.toFixed(0)}]</span> ${escapeHtml(entry.text)}</div>`)
          .join('')
      : '<div class="muted">Nothing in this channel yet.</div>'}</div>
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

export function combatDashboardMarkup(store: GameStore): string {
  const combat = store.combat;
  const tab = store.ui.combatTab;

  const statusCard = combat.status === 'victory'
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
      : '';

  const tabBar = `<div class="subtabs" role="tablist" aria-label="Combat details">
    <button role="tab" aria-selected="${tab === 'overview'}" class="subtab ${tab === 'overview' ? 'on' : ''}" data-action="combat-tab" data-tab="overview">Overview</button>
    <button role="tab" aria-selected="${tab === 'breakdown'}" class="subtab ${tab === 'breakdown' ? 'on' : ''}" data-action="combat-tab" data-tab="breakdown">Breakdown</button>
    <button role="tab" aria-selected="${tab === 'log'}" class="subtab ${tab === 'log' ? 'on' : ''}" data-action="combat-tab" data-tab="log">War Log (${combat.log.length})</button>
  </div>`;

  let body = '';
  if (tab === 'overview') {
    body = `
      <div class="two">${spoilsPanel(store)}${timersPanel(store)}</div>
      ${ratePills(store)}`;
  } else if (tab === 'breakdown') {
    body = `
      ${damagePanel(store)}
      ${statsPanel(store)}
      ${ratePills(store)}`;
  } else {
    body = store.save.settings.logCombat
      ? logPanel(store)
      : `<div class="frame pan"><div class="tiny muted">Combat logging is turned off in Options.</div></div>`;
  }

  return `${statusCard}
  ${tabBar}
  ${body}
  <p class="hint">${escapeHtml(combat.doctrine)} doctrine · ${store.ui.paused ? 'paused' : 'auto-casting'}${store.stats.keystones.has('ks_pendulum') ? ' · pendulum swaps bars' : ''}</p>`;
}

export function combatScreen(store: GameStore): string {
  return `<section class="screen" data-screen="combat" aria-label="Combat">
    ${arena(store)}
    ${telemetryStrip(store)}
    ${controlStrip(store)}
    <div id="combat-dash" class="combat-dash">${combatDashboardMarkup(store)}</div>
  </section>`;
}
