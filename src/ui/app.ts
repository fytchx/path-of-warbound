import { gemById } from '../data';
import type { DoctrineId, ItemSlot } from '../data/types';
import type { GemInstance } from '../game/types';
import { xpNeeded } from '../game/state';
import { assetImg, clamp, escapeHtml, fmt, pct, schoolColor, sprite, titleCase } from './dom';
import { renderModal } from './modals';
import { altarScreen } from './screens/altar';
import { bagScreen } from './screens/bag';
import {
  castPercent,
  combatDashboardMarkup,
  combatScreen,
  enemyCardMarkup,
  renderEnemyAilments,
  swingPercent,
} from './screens/combat';
import { forgeScreen } from './screens/forge';
import { treeScreen } from './screens/tree';
import type { BagFilter, GameStore, ScreenId } from './store';

const TICK_MS = 200;

const SCREENS: Record<ScreenId, (store: GameStore) => string> = {
  combat: combatScreen,
  altar: altarScreen,
  tree: treeScreen,
  bag: bagScreen,
  forge: forgeScreen,
};

const TABS: { id: ScreenId; label: string; icon: string }[] = [
  {
    id: 'combat',
    label: 'Combat',
    icon: '<path d="M4 4l7 7M20 4l-7 7M4 20l7-7M20 20l-7-7M8 16l-4 4M16 8l4-4"/>',
  },
  {
    id: 'altar',
    label: 'Altar',
    icon: '<path d="M12 3c3 2 5 4 5 8a5 5 0 0 1-10 0c0-4 2-6 5-8z"/><path d="M4 21h16M6 17h12"/>',
  },
  {
    id: 'tree',
    label: 'Tree',
    icon: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v5M12 12.5L5 16.5M12 12.5l7 4"/>',
  },
  {
    id: 'bag',
    label: 'Bag',
    icon: '<path d="M5 8h14l-1 12H6z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
  },
  {
    id: 'forge',
    label: 'Forge',
    icon: '<path d="M3 21l7-7M14 4l6 6-3 3-6-6z"/><path d="M9 5l10 10"/>',
  },
];

const TAB_ICONS = Object.fromEntries(TABS.map((tab) => [tab.id, tab.icon])) as Record<ScreenId, string>;

function tabbar(store: GameStore): string {
  return TABS.map(
    (tab) => `<button class="${store.ui.screen === tab.id ? 'active' : ''}" data-nav="${tab.id}" aria-label="${tab.label}" aria-current="${store.ui.screen === tab.id ? 'page' : 'false'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[tab.id]}</svg>
      <span>${tab.label}</span>
    </button>`,
  ).join('');
}

function topbar(store: GameStore): string {
  const save = store.save;
  const need = xpNeeded(save.level);
  const xpPercent = clamp((save.xp / Math.max(1, need)) * 100, 0, 100);
  const xpRounded = Math.round(xpPercent);
  return `<div class="medal">
      ${sprite('w-medal', 'medal-svg', '0 0 100 100')}
      ${assetImg('fx_soulspark', 'Soul-Spark', 'medal-spark')}
    </div>
    <div>
      <div class="title">PATH OF WARBOUND</div>
      <div class="sub" data-topbar-sub>${titleCase(save.doctrine)} Doctrine</div>
      <div class="xp"><span data-topbar-lv>Lv. ${save.level}</span><i><b data-xp-fill style="width:${xpPercent.toFixed(1)}%"></b></i><span data-xp-pct>${xpRounded}%</span></div>
    </div>
    <div class="top-actions">
      <button class="gear" data-action="modal-stats" aria-label="Character stats & settings" title="Character stats & settings">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>
      </button>
      <button class="gear" data-action="modal-options" aria-label="Options" title="Options">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>
      </button>
    </div>`;
}

interface TreeGestureState {
  svg: SVGSVGElement;
  group: SVGGElement;
  pointers: Map<number, { x: number; y: number }>;
  mode: 'pan' | 'pinch';
  startX: number;
  startY: number;
  viewX: number;
  viewY: number;
  startDist: number;
  startScale: number;
  curX: number;
  curY: number;
  curScale: number;
  moved: boolean;
}

const prevFillValues = new WeakMap<HTMLElement, number>();

function setFillNoFlicker(
  el: HTMLElement | null,
  prop: 'width' | 'height',
  nextPct: number,
  wrapOnDrop = true,
): void {
  if (!el) return;
  const clamped = clamp(nextPct, 0, 100);
  const prev = prevFillValues.get(el);
  const wrapped = wrapOnDrop && prev !== undefined && clamped < prev - 1;
  if (wrapped) {
    el.classList.add('no-trans');
  }
  el.style[prop] = `${clamped.toFixed(1)}%`;
  prevFillValues.set(el, clamped);
  if (wrapped) {
    void el.offsetWidth;
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => el.classList.remove('no-trans'));
    } else {
      el.classList.remove('no-trans');
    }
  }
}

export function mountApp(root: HTMLElement, store: GameStore): void {
  let gesture: TreeGestureState | null = null;
  let renderedScreen: ScreenId | null = null;
  let renderedModal: unknown = undefined;
  let renderedToast: number | null = null;
  let renderedTabKey = '';
  let lastEnemyKey = '';
  let lastSkillBarKey = '';
  let seenHitSeq = store.combat.hitSeq;
  const hitFlashUntil = new Map<string, number>();

  const applyHitFeedback = (now: number): void => {
    if (store.ui.screen !== 'combat') return;
    const fxHost = root.querySelector<HTMLElement>('#combat-fx');
    const arenaEl = root.querySelector<HTMLElement>('.arena');
    const reduced = store.save.settings.reducedMotion;

    for (const hit of store.combat.recentHits) {
      if (hit.id <= seenHitSeq) continue;
      seenHitSeq = hit.id;
      if (reduced) continue;
      hitFlashUntil.set(hit.enemyUid, now + 120);

      if (fxHost && arenaEl) {
        const mobOval = arenaEl.querySelector<HTMLElement>(`[data-enemy-uid="${hit.enemyUid}"] .oval`);
        const arenaRect = arenaEl.getBoundingClientRect();
        const ovalRect = mobOval?.getBoundingClientRect();
        const jitterX = ((hit.id % 5) - 2) * 5;
        const leftPx = ovalRect
          ? ovalRect.left - arenaRect.left + ovalRect.width / 2 + jitterX
          : arenaRect.width / 2 + jitterX;
        const topPx = ovalRect ? ovalRect.top - arenaRect.top + 8 : 112;

        const span = document.createElement('span');
        span.className = `dmg-float ${hit.crit ? 'crit' : ''}`;
        span.style.setProperty('--sc', hit.crit ? '#f0d078' : schoolColor(hit.school));
        span.style.left = `${Math.round(leftPx)}px`;
        span.style.top = `${Math.round(topPx)}px`;
        span.dataset.expires = String(now + 720);
        span.textContent = `${Math.round(hit.amount)}${hit.crit ? '!' : ''}`;
        fxHost.appendChild(span);
      }
    }

    if (arenaEl && !reduced) {
      arenaEl.querySelectorAll<HTMLElement>('[data-enemy-uid]').forEach((mobEl) => {
        const uid = mobEl.dataset.enemyUid ?? '';
        const oval = mobEl.querySelector<HTMLElement>('.oval');
        if (!oval) return;
        const active = (hitFlashUntil.get(uid) ?? 0) > now;
        oval.classList.toggle('hit-flash', active);
      });
    }
    for (const [uid, until] of hitFlashUntil) {
      if (until <= now) hitFlashUntil.delete(uid);
    }
  };

  const patchTopbar = (): void => {
    const save = store.save;
    const need = xpNeeded(save.level);
    const xpPercent = clamp((save.xp / Math.max(1, need)) * 100, 0, 100);
    const subEl = root.querySelector<HTMLElement>('[data-topbar-sub]');
    if (subEl) {
      const nextSub = `${titleCase(save.doctrine)} Doctrine`;
      if (subEl.textContent !== nextSub) subEl.textContent = nextSub;
    }
    const lvEl = root.querySelector<HTMLElement>('[data-topbar-lv]');
    if (lvEl) {
      const nextLv = `Lv. ${save.level}`;
      if (lvEl.textContent !== nextLv) lvEl.textContent = nextLv;
    }
    const xpPctEl = root.querySelector<HTMLElement>('[data-xp-pct]');
    if (xpPctEl) {
      const nextPctText = `${Math.round(xpPercent)}%`;
      if (xpPctEl.textContent !== nextPctText) xpPctEl.textContent = nextPctText;
    }
    setFillNoFlicker(root.querySelector<HTMLElement>('[data-xp-fill]'), 'width', xpPercent, true);
  };

  const patchCombatDom = (now: number): void => {
    const combat = store.combat;
    const player = combat.player;
    const stats = store.stats;
    const zone = combat.zone;

    const bannerEl = root.querySelector<HTMLElement>('[data-arena-banner]');
    if (bannerEl) {
      const nextBanner = `${zone.name} · TIER ${combat.tier}`;
      if (bannerEl.textContent !== nextBanner) bannerEl.textContent = nextBanner;
    }

    const statusEl = root.querySelector<HTMLElement>('[data-badge-status]');
    if (statusEl) {
      const nextStatus =
        combat.status === 'victory'
          ? 'CLEARED'
          : combat.status === 'dead'
            ? 'SPARK OUT'
            : combat.bossActive
              ? 'BOSS'
              : `WAVE ${combat.wave}`;
      if (statusEl.textContent !== nextStatus) statusEl.textContent = nextStatus;
    }

    const packBadgeEl = root.querySelector<HTMLElement>('[data-badge-pack]');
    if (packBadgeEl) {
      const living = combat.enemies.filter((e) => e.hp > 0).length;
      const nextPack = `${living}/${combat.packSize}`;
      if (packBadgeEl.textContent !== nextPack) packBadgeEl.textContent = nextPack;
    }

    const keysWrapEl = root.querySelector<HTMLElement>('[data-badge-keys-wrap]');
    if (keysWrapEl) {
      keysWrapEl.classList.toggle('key-pulse', Date.now() - store.ui.keyPulseAt < 1800);
    }
    const keysEl = root.querySelector<HTMLElement>('[data-badge-keys]');
    if (keysEl) {
      const nextKeys = `${combat.keys}/3`;
      if (keysEl.textContent !== nextKeys) keysEl.textContent = nextKeys;
    }

    const summonBtn = root.querySelector<HTMLElement>('[data-action="summon-boss"]');
    if (summonBtn) {
      const canSummon = combat.keys >= 3 && !combat.bossActive && combat.status === 'running';
      summonBtn.style.display = canSummon ? '' : 'none';
    }

    const hpNum = root.querySelector<HTMLElement>('[data-vnum-hp]');
    if (hpNum) hpNum.textContent = fmt(player.hp);
    const hpVial = root.querySelector<HTMLElement>('[data-vial-hp]');
    if (hpVial) {
      hpVial.title = `Health ${fmt(player.hp)} / ${fmt(stats.maxHp)} · Ward ${fmt(player.ward)} / ${fmt(stats.maxWard)}`;
    }
    setFillNoFlicker(
      root.querySelector<HTMLElement>('[data-hp-fill]'),
      'height',
      stats.maxHp > 0 ? (player.hp / stats.maxHp) * 100 : 0,
      false,
    );
    const wardEl = root.querySelector<HTMLElement>('[data-ward-fill]');
    if (wardEl) {
      const wardPct = stats.maxWard > 0 ? clamp((player.ward / stats.maxWard) * 100, 0, 100) : 0;
      setFillNoFlicker(wardEl, 'height', wardPct, false);
      wardEl.style.opacity = player.ward > 0 ? '0.85' : '0';
    }

    const manaNum = root.querySelector<HTMLElement>('[data-vnum-mana]');
    if (manaNum) manaNum.textContent = fmt(player.mana);
    const manaVial = root.querySelector<HTMLElement>('[data-vial-mana]');
    if (manaVial) {
      manaVial.title = `Mana ${fmt(player.mana)} / ${fmt(stats.maxMana)}${stats.reservedMana > 0 ? ` (${fmt(stats.reservedMana)} reserved)` : ''}`;
    }
    setFillNoFlicker(
      root.querySelector<HTMLElement>('[data-mana-fill]'),
      'height',
      stats.maxMana > 0 ? (player.mana / stats.maxMana) * 100 : 0,
      false,
    );

    // Enemies in-place patch
    const mobsEl = root.querySelector<HTMLElement>('[data-mobs]');
    const nextEnemyKey = `${combat.enemies.map((e) => e.uid).join(',')}|${combat.status === 'victory' ? 1 : 0}`;
    if (mobsEl) {
      if (nextEnemyKey !== lastEnemyKey) {
        mobsEl.innerHTML = enemyCardMarkup(store);
        lastEnemyKey = nextEnemyKey;
      } else {
        for (const enemy of combat.enemies) {
          const card = mobsEl.querySelector<HTMLElement>(`[data-enemy-uid="${enemy.uid}"]`);
          if (!card) continue;
          const frozen = (enemy.ailments.chill?.stacks ?? 0) >= 3;
          const slamming = enemy.defId === 'mob_boss' && (enemy.slamTelegraph ?? 0) > 0;
          card.classList.toggle('dead', enemy.hp <= 0);
          card.classList.toggle('frozen', frozen);

          const oval = card.querySelector<HTMLElement>('.oval');
          if (oval) {
            oval.classList.toggle('slam-telegraph', slamming);
            let slamBadge = oval.querySelector<HTMLElement>('.slam-badge');
            if (slamming && !slamBadge) {
              slamBadge = document.createElement('span');
              slamBadge.className = 'slam-badge';
              slamBadge.textContent = 'SLAM!';
              oval.appendChild(slamBadge);
            } else if (!slamming && slamBadge) {
              slamBadge.remove();
            }
          }

          const hpText = card.querySelector<HTMLElement>('[data-mob-hp-text]');
          if (hpText) hpText.textContent = fmt(Math.ceil(enemy.hp));

          const atkText = card.querySelector<HTMLElement>('[data-mob-atk-text]');
          if (atkText) atkText.textContent = frozen ? '❄' : `${Math.max(0, enemy.attackTimer).toFixed(1)}`;

          const ailEl = card.querySelector<HTMLElement>('[data-mob-ail]');
          if (ailEl) {
            const nextAil = renderEnemyAilments(enemy);
            if (ailEl.dataset.ailSig !== nextAil) {
              ailEl.innerHTML = nextAil;
              ailEl.dataset.ailSig = nextAil;
            }
          }

          setFillNoFlicker(
            card.querySelector<HTMLElement>('[data-mob-hp]'),
            'width',
            enemy.maxHp > 0 ? (enemy.hp / enemy.maxHp) * 100 : 0,
            false,
          );
          const atkPct = clamp((1 - enemy.attackTimer / Math.max(0.2, enemy.attackInterval)) * 100, 0, 100);
          setFillNoFlicker(card.querySelector<HTMLElement>('[data-mob-atk]'), 'width', atkPct, true);
        }
      }
    }

    // Skill bar in-place patch
    const nextSkillKey = `${stats.skills.map((s) => `${s.id}:${s.bar}`).join(',')}|${stats.keystones.has('ks_pendulum') ? 1 : 0}`;
    const barPill = root.querySelector<HTMLElement>('.skills .pill');
    const pendulum = stats.keystones.has('ks_pendulum');
    if (barPill) {
      barPill.classList.toggle('locked', pendulum);
      barPill.dataset.bar = combat.activeBar === 'bar_1' ? 'bar_2' : 'bar_1';
      barPill.textContent = pendulum
        ? `AUTO · ${combat.activeBar === 'bar_1' ? 'BAR I' : 'BAR II'}`
        : combat.activeBar === 'bar_1'
          ? 'BAR I'
          : 'BAR II';
    }
    if (nextSkillKey !== lastSkillBarKey) {
      lastSkillBarKey = nextSkillKey;
      const slotsHost = root.querySelector<HTMLElement>('.skills .slots');
      if (slotsHost) {
        const totalSlots = Math.max(6, stats.skills.length);
        slotsHost.innerHTML = Array.from({ length: totalSlots }, (_, index) => {
          const skill = stats.skills[index];
          if (skill) {
            const isAura = skill.manaReservation > 0;
            const remaining = player.skillTimers[skill.id] ?? 0;
            const cooldown = Math.max(0.001, skill.effectiveCooldown || skill.cooldown);
            const ready = remaining <= 0;
            const wrongBar = !isAura && skill.bar !== 'both' && skill.bar !== combat.activeBar && !pendulum;
            const cdPct = ready ? 0 : clamp((remaining / cooldown) * 100, 0, 100);
            const gemDef = gemById.get(skill.gemId);
            const gemImg = gemDef ? assetImg(gemDef.assetId, skill.name) : '';
            return `<button class="skill ${ready && !wrongBar ? 'hot' : ''} ${isAura ? 'aura' : ''}" data-action="${isAura ? 'open-slot-gem' : 'cast'}" data-skill="${escapeHtml(skill.id)}" data-gem-uid="${escapeHtml(skill.sourceSlot)}" data-gem-idx="${skill.sourceSocketIndex}" data-cd="${cooldown}" title="${escapeHtml(skill.name)}" aria-label="${escapeHtml(skill.name)}">
              ${gemImg}
              ${isAura
                ? `<span class="lock">AURA</span>`
                : wrongBar
                  ? `<span class="lock">${skill.bar === 'bar_1' ? 'I' : 'II'}</span>`
                  : `<span class="cd" style="height:${ready ? 0 : cdPct.toFixed(1)}%"></span><span class="cdtime">${!ready && remaining > 0.05 ? remaining.toFixed(1) : ''}</span>`}
            </button>`;
          }
          return `<button class="skill empty" data-action="empty-slot" title="Empty skill slot — socket an active gem in Altar" aria-label="Empty skill slot"><span class="empty-plus" aria-hidden="true">+</span></button>`;
        }).join('');
      }
    } else {
      root.querySelectorAll<HTMLElement>('.skills .skill[data-skill]').forEach((btn) => {
        const skillId = btn.dataset.skill ?? '';
        const skill = stats.skills.find((s) => s.id === skillId);
        if (!skill) return;
        const isAura = skill.manaReservation > 0;
        const remaining = player.skillTimers[skill.id] ?? 0;
        const cooldown = Math.max(0.001, skill.effectiveCooldown || skill.cooldown);
        const ready = remaining <= 0;
        const wrongBar = !isAura && skill.bar !== 'both' && skill.bar !== combat.activeBar && !pendulum;
        btn.classList.toggle('hot', ready && !wrongBar);
        const cdPct = ready ? 0 : clamp((remaining / cooldown) * 100, 0, 100);
        const cdBar = btn.querySelector<HTMLElement>('.cd');
        const cdText = btn.querySelector<HTMLElement>('.cdtime');
        if (cdBar) setFillNoFlicker(cdBar, 'height', wrongBar ? 0 : cdPct, false);
        if (cdText) cdText.textContent = !wrongBar && !ready && remaining > 0.05 ? remaining.toFixed(1) : '';
      });
    }

    setFillNoFlicker(root.querySelector<HTMLElement>('[data-swing]'), 'width', swingPercent(store), true);

    const rotPill = root.querySelector<HTMLElement>('.rot-pill');
    if (rotPill) {
      const mode = store.save.rotation.mode;
      const stacks = combat.player.disciplineStacks;
      const nextLabel = `ROT · ${mode.toUpperCase()}${mode === 'manual' && stacks > 0 ? ` +${stacks * 6}%` : ''}`;
      if (rotPill.textContent !== nextLabel) rotPill.textContent = nextLabel;
      rotPill.classList.toggle('manual', mode === 'manual');
    }

    const castBar = root.querySelector<HTMLElement>('[data-cast-bar]');
    const activeCast = combat.player.cast;
    if (castBar) {
      castBar.hidden = !activeCast;
      const label = castBar.querySelector<HTMLElement>('[data-cast-label]');
      if (label) {
        const name = activeCast ? stats.skills.find((skill) => skill.id === activeCast.skillId)?.name ?? 'Casting' : '';
        if (label.textContent !== name) label.textContent = name;
      }
    }
    setFillNoFlicker(root.querySelector<HTMLElement>('[data-cast-fill]'), 'width', castPercent(store), true);
    const tierEl = root.querySelector<HTMLElement>('[data-ctl-tier]');
    if (tierEl) tierEl.innerHTML = `<small>TIER</small>${combat.tier}`;
    const packEl = root.querySelector<HTMLElement>('[data-ctl-pack]');
    if (packEl) packEl.innerHTML = `<small>PACK</small>${combat.packSize}`;
    // Dashboard panels below arena
    const dashEl = root.querySelector<HTMLElement>('#combat-dash');
    if (dashEl) dashEl.innerHTML = combatDashboardMarkup(store);

    applyHitFeedback(now);
  };

  const paint = (dynamic: boolean): void => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

    if (dynamic) {
      patchTopbar();
    } else {
      const topbarEl = root.querySelector<HTMLElement>('#topbar');
      if (topbarEl) topbarEl.innerHTML = topbar(store);
    }

    const screenHost = root.querySelector<HTMLElement>('#screen-host');
    if (screenHost) {
      if (dynamic && renderedScreen === 'combat' && store.ui.screen === 'combat') {
        patchCombatDom(now);
      } else if (!dynamic || renderedScreen !== store.ui.screen) {
        const scrollTop = renderedScreen === store.ui.screen ? screenHost.scrollTop : 0;
        screenHost.innerHTML = SCREENS[store.ui.screen](store);
        screenHost.scrollTop = scrollTop;
        renderedScreen = store.ui.screen;
        lastEnemyKey = `${store.combat.enemies.map((e) => e.uid).join(',')}|${store.combat.status === 'victory' ? 1 : 0}`;
        lastSkillBarKey = `${store.stats.skills.map((s) => `${s.id}:${s.bar}`).join(',')}|${store.stats.keystones.has('ks_pendulum') ? 1 : 0}`;
        applyHitFeedback(now);
      }
    }

    const tabbarEl = root.querySelector<HTMLElement>('#tabbar');
    const nextTabKey = store.ui.screen;
    if (tabbarEl && (!dynamic || nextTabKey !== renderedTabKey)) {
      tabbarEl.innerHTML = tabbar(store);
      renderedTabKey = nextTabKey;
    }

    const modalRoot = root.querySelector<HTMLElement>('#modal-root');
    if (modalRoot && (!dynamic || renderedModal !== store.ui.modal)) {
      modalRoot.innerHTML = store.ui.modal ? renderModal(store, store.ui.modal) : '';
      modalRoot.style.display = store.ui.modal ? 'grid' : 'none';
      renderedModal = store.ui.modal;
    }

    const toastRoot = root.querySelector<HTMLElement>('#toast-root');
    const toast = store.ui.toast;
    if (toastRoot && (toast?.id ?? null) !== renderedToast) {
      renderedToast = toast?.id ?? null;
      toastRoot.innerHTML = toast ? `<div class="toast" role="status">${escapeHtml(toast.text)}</div>` : '';
    }
  };

  root.innerHTML = `
    <header class="top" id="topbar">${topbar(store)}</header>
    <main id="screen-host">${SCREENS[store.ui.screen](store)}</main>
    <nav class="tabbar" id="tabbar" aria-label="Screens">${tabbar(store)}</nav>
    <div class="modal-root" id="modal-root" aria-live="polite" style="display:none"></div>
    <div class="toast-root" id="toast-root"></div>`;
  renderedScreen = store.ui.screen;
  renderedModal = store.ui.modal;
  renderedTabKey = store.ui.screen;
  lastEnemyKey = `${store.combat.enemies.map((e) => e.uid).join(',')}|${store.combat.status === 'victory' ? 1 : 0}`;
  lastSkillBarKey = `${store.stats.skills.map((s) => `${s.id}:${s.bar}`).join(',')}|${store.stats.keystones.has('ks_pendulum') ? 1 : 0}`;

  const act = (el: HTMLElement): void => {
    const nav = el.dataset.nav as ScreenId | undefined;
    if (nav) {
      store.navigate(nav);
      return;
    }
    const data = el.dataset;
    switch (el.dataset.action) {
      case 'pause':
        store.togglePause();
        break;
      case 'summon-boss':
        store.summonBoss();
        break;
      case 'toggle-auto-salvage':
        store.toggleAutoSalvage();
        break;
      case 'toggle-log':
        store.toggleLogCombat();
        break;
      case 'toggle-motion':
        store.toggleReducedMotion();
        break;
      case 'tier-prev':
        store.setTier(-1);
        break;
      case 'tier-next':
        store.setTier(1);
        break;
      case 'pack-prev':
        store.setPackSize(-1);
        break;
      case 'pack-next':
        store.setPackSize(1);
        break;
      case 'next-tier':
        store.nextTier();
        break;
      case 'bar':
        store.setBar(data.bar === 'bar_2' ? 'bar_2' : 'bar_1');
        break;
      case 'cast':
        if (data.skill) store.cast(data.skill);
        break;
      case 'open-slot-gem': {
        const slot = data.gemUid as ItemSlot | undefined;
        const idx = Number(data.gemIdx ?? 0);
        const item = slot ? store.save.equipment[slot] : undefined;
        if (item) {
          store.openModal({ kind: 'gem', source: 'socket', itemUid: item.uid, socketIndex: idx });
        } else {
          store.navigate('altar');
        }
        break;
      }
      case 'zone':
        if (data.zone) store.setZone(data.zone);
        break;
      case 'modal-stats':
        store.openModal({ kind: 'stats' });
        break;
      case 'close-modal':
        store.closeModal();
        break;
      case 'modal-options':
        store.openModal({ kind: 'options' });
        break;
      case 'open-reset':
        store.openModal({ kind: 'reset' });
        break;
      case 'back-options':
        store.openModal({ kind: 'options' });
        break;
      case 'reset-progress':
        store.resetProgress();
        break;
      case 'open-item':
        if (data.uid) store.openModal({ kind: 'item', uid: data.uid });
        break;
      case 'open-slot':
        if (store.save.equipment[data.slot as ItemSlot]) {
          store.openModal({ kind: 'item', uid: store.save.equipment[data.slot as ItemSlot]!.uid });
        } else {
          store.openSlotPicker(data.slot as ItemSlot);
        }
        break;
      case 'chroma-reforge':
        if (data.uid) store.reforgeSockets(data.uid);
        break;
      case 'force-socket':
        if (data.uid) store.forceSocket(data.uid, Number(data.index ?? 0), (data.color === 'green' ? 'green' : data.color === 'blue' ? 'blue' : 'red'));
        break;
      case 'prismatic-socket':
        if (data.uid) store.prismaticSocket(data.uid, Number(data.index ?? 0));
        break;
      case 'item-to-forge':
        if (data.uid) store.openForgeFor(data.uid);
        break;
      case 'locked-offhand':
        store.toast('Offhand is spanned by a two-handed weapon.');
        break;
      case 'equip':
        if (data.uid && data.slot) store.equip(data.uid, data.slot as ItemSlot);
        break;
      case 'unequip':
        if (data.slot) store.unequip(data.slot as ItemSlot);
        break;
      case 'salvage':
        if (data.uid) store.salvage(data.uid);
        break;
      case 'socket':
        if (data.uid) store.beginSocket(data.uid, Number(data.index ?? 0));
        break;
      case 'pick-gem':
        store.socketFromStash(Number(data.index ?? 0));
        break;
      case 'inspect-gem':
        store.inspectStashGem(Number(data.index ?? 0));
        break;
      case 'level-gem':
        store.levelUpModalGem();
        break;
      case 'set-gem-bar':
        if (data.bar === 'bar_1' || data.bar === 'bar_2' || data.bar === 'both') {
          store.setModalGemBar(data.bar);
        }
        break;
      case 'unsocket-gem':
        if (data.uid) store.unsocket(data.uid, Number(data.index ?? 0));
        break;
      case 'node':
        if (data.node) store.previewNode(data.node);
        break;
      case 'refund':
        if (data.node) store.refundNode(data.node);
        break;
      case 'allocate':
        store.confirmAllocation();
        break;
      case 'allocate-node':
        if (data.node) store.confirmAllocation(data.node);
        break;
      case 'doctrine':
        if (data.doctrine) store.setDoctrine(data.doctrine as DoctrineId);
        break;
      case 'bag-filter':
        if (data.filter) store.setBagFilter(data.filter as BagFilter);
        break;
      case 'forge-select':
        if (data.uid) store.selectForge(data.uid);
        break;
      case 'lock-affix':
        store.toggleAffixLock(Number(data.index ?? 0));
        break;
      case 'craft':
        if (data.craft) {
          store.craft(
            data.craft as 'upgrade' | 'reforge' | 'socket' | 'link' | 'lock-reforge' | 'corrupt' | 'promote',
          );
        }
        break;
      case 'gem-bar': {
        const gem = store.save.gemStash[Number(data.index ?? 0)] as GemInstance | undefined;
        if (gem) store.cycleGemBar(gem);
        break;
      }
      case 'tree-refund':
        store.toggleRefundMode();
        break;
      case 'tree-zoom-in':
        store.zoomTree(1.15);
        break;
      case 'tree-zoom-out':
        store.zoomTree(1 / 1.15);
        break;
      case 'tree-reset':
        store.resetTree();
        break;
      case 'choose-starter':
        if (data.starter === 'melee' || data.starter === 'spell' || data.starter === 'dot') {
          store.chooseStarter(data.starter);
        }
        break;
      case 'open-rotation':
        store.openModal({ kind: 'rotation' });
        break;
      case 'rotation-mode':
        if (data.mode === 'auto' || data.mode === 'manual') store.setRotationMode(data.mode);
        break;
      case 'rot-move':
        if (data.skill) store.moveRotation(data.skill, Number(data.delta ?? 0));
        break;
      case 'claim-offline':
        store.claimOffline();
        break;
      case 'empty-slot':
        store.navigate('altar');
        store.toast('Tap an equipped item in Altar to socket an active gem.');
        break;
      default:
        break;
    }
  };

  root.addEventListener('click', (event) => {
    const modalRoot = root.querySelector<HTMLElement>('#modal-root');
    if (modalRoot && event.target === modalRoot) {
      store.closeModal();
      return;
    }
    const el = (event.target as Element | null)?.closest<HTMLElement>('[data-action], [data-nav]');
    if (!el || el.hasAttribute('disabled')) return;
    act(el);
  });

  let toastDrag: { el: HTMLElement; startX: number; startY: number; dx: number; dy: number } | null = null;

  root.addEventListener('pointerdown', (event) => {
    const toastEl = (event.target as Element | null)?.closest<HTMLElement>('.toast');
    if (!toastEl) return;
    toastDrag = { el: toastEl, startX: event.clientX, startY: event.clientY, dx: 0, dy: 0 };
    toastEl.classList.add('swiping');
    toastEl.setPointerCapture?.(event.pointerId);
  });

  root.addEventListener('pointermove', (event) => {
    if (!toastDrag) return;
    toastDrag.dx = event.clientX - toastDrag.startX;
    toastDrag.dy = event.clientY - toastDrag.startY;
    toastDrag.el.style.transform = `translate(${toastDrag.dx}px, ${toastDrag.dy}px)`;
    toastDrag.el.style.opacity = String(Math.max(0.2, 1 - Math.hypot(toastDrag.dx, toastDrag.dy) / 120));
  });

  const endToastSwipe = (): void => {
    const drag = toastDrag;
    toastDrag = null;
    if (!drag) return;
    drag.el.classList.remove('swiping');
    const { dx, dy } = drag;
    drag.el.style.transform = '';
    drag.el.style.opacity = '';
    if (Math.abs(dx) > 40 || Math.abs(dy) > 32) {
      drag.el.classList.add('swipe-out');
      setTimeout(() => store.dismissToast(), 120);
    }
  };
  root.addEventListener('pointerup', endToastSwipe);
  root.addEventListener('pointercancel', endToastSwipe);

  const pointerDistance = (pts: Map<number, { x: number; y: number }>): number => {
    const [a, b] = [...pts.values()];
    if (!a || !b) return 1;
    return Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
  };

  root.addEventListener('pointerdown', (event) => {
    const target = event.target as Element | null;
    if (!target || target.closest('[data-action="node"]')) return;
    const svg = target.closest<SVGSVGElement>('.tree-svg');
    const group = svg?.querySelector<SVGGElement>('g');
    if (!svg || !group) return;

    if (!gesture || gesture.svg !== svg) {
      gesture = {
        svg,
        group,
        pointers: new Map([[event.pointerId, { x: event.clientX, y: event.clientY }]]),
        mode: 'pan',
        startX: event.clientX,
        startY: event.clientY,
        viewX: store.ui.treeView.x,
        viewY: store.ui.treeView.y,
        startDist: 1,
        startScale: store.ui.treeView.scale,
        curX: store.ui.treeView.x,
        curY: store.ui.treeView.y,
        curScale: store.ui.treeView.scale,
        moved: false,
      };
    } else {
      gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture.pointers.size >= 2) {
        gesture.mode = 'pinch';
        gesture.startDist = pointerDistance(gesture.pointers);
        gesture.startScale = gesture.curScale;
      }
    }
    svg.setPointerCapture?.(event.pointerId);
  });

  root.addEventListener('pointermove', (event) => {
    if (!gesture || !gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (gesture.mode === 'pinch' && gesture.pointers.size >= 2) {
      const dist = pointerDistance(gesture.pointers);
      gesture.curScale = clamp(gesture.startScale * (dist / gesture.startDist), 0.55, 2.4);
      gesture.moved = true;
      gesture.group.setAttribute(
        'transform',
        `translate(${195 + gesture.curX} ${215 + gesture.curY}) scale(${gesture.curScale})`,
      );
      return;
    }

    if (gesture.mode === 'pan') {
      const rect = gesture.svg.getBoundingClientRect();
      const scale = rect.width > 0 ? 390 / rect.width : 1;
      const dx = (event.clientX - gesture.startX) * scale;
      const dy = (event.clientY - gesture.startY) * scale;
      if (Math.abs(dx) + Math.abs(dy) > 2) gesture.moved = true;
      gesture.curX = gesture.viewX + dx;
      gesture.curY = gesture.viewY + dy;
      gesture.group.setAttribute(
        'transform',
        `translate(${195 + gesture.curX} ${215 + gesture.curY}) scale(${gesture.curScale})`,
      );
    }
  });

  const endPan = (event: PointerEvent): void => {
    if (!gesture || !gesture.pointers.has(event.pointerId)) return;
    gesture.pointers.delete(event.pointerId);
    gesture.svg.releasePointerCapture?.(event.pointerId);

    if (gesture.pointers.size === 1) {
      const [remaining] = [...gesture.pointers.values()];
      if (remaining) {
        gesture.mode = 'pan';
        gesture.startX = remaining.x;
        gesture.startY = remaining.y;
        gesture.viewX = gesture.curX;
        gesture.viewY = gesture.curY;
      }
      return;
    }

    if (gesture.pointers.size === 0) {
      const { moved, curX, curY, curScale } = gesture;
      gesture = null;
      if (moved) {
        store.setTreeView({ x: curX, y: curY, scale: curScale });
      }
    }
  };
  root.addEventListener('pointerup', endPan);
  root.addEventListener('pointercancel', endPan);

  store.subscribe(paint);
  paint(false);

  window.setInterval(() => store.tick(), TICK_MS);

  const animate = (now: number): void => {
    if (store.ui.screen === 'combat') {
      const reduced = store.save.settings.reducedMotion;
      if (!store.ui.paused && store.combat.status === 'running' && !reduced) {
        const dt = Math.max(0, Math.min(0.22, (now - store.ui.lastTickAt) / 1000));
        setFillNoFlicker(root.querySelector<HTMLElement>('[data-swing]'), 'width', swingPercent(store, dt), true);
        setFillNoFlicker(root.querySelector<HTMLElement>('[data-cast-fill]'), 'width', castPercent(store, dt), true);

        root.querySelectorAll<HTMLElement>('.skill[data-skill][data-cd]').forEach((btn) => {
          const skillId = btn.dataset.skill ?? '';
          const cd = Math.max(0.001, Number(btn.dataset.cd ?? 0));
          const timer = store.combat.player.skillTimers[skillId] ?? 0;
          const rem = Math.max(0, timer - dt);
          const cdBar = btn.querySelector<HTMLElement>('.cd');
          const cdText = btn.querySelector<HTMLElement>('.cdtime');
          if (cdBar) setFillNoFlicker(cdBar, 'height', clamp((rem / cd) * 100, 0, 100), false);
          if (cdText) cdText.textContent = rem > 0.05 ? rem.toFixed(1) : '';
        });

        for (const enemy of store.combat.enemies) {
          if (enemy.hp <= 0) continue;
          const frozen = (enemy.ailments.chill?.stacks ?? 0) >= 3;
          if (frozen) continue;
          const atkEl = root.querySelector<HTMLElement>(`[data-enemy-uid="${enemy.uid}"] [data-mob-atk]`);
          if (atkEl) {
            const rem = Math.max(0, enemy.attackTimer - dt);
            const atkPct = clamp((1 - rem / Math.max(0.2, enemy.attackInterval)) * 100, 0, 100);
            setFillNoFlicker(atkEl, 'width', atkPct, true);
          }
        }
      }

      root.querySelectorAll<HTMLElement>('[data-enemy-uid] .oval.hit-flash').forEach((oval) => {
        const uid = oval.closest<HTMLElement>('[data-enemy-uid]')?.dataset.enemyUid ?? '';
        if ((hitFlashUntil.get(uid) ?? 0) <= now) {
          oval.classList.remove('hit-flash');
          hitFlashUntil.delete(uid);
        }
      });

      root.querySelectorAll<HTMLElement>('#combat-fx .dmg-float').forEach((node) => {
        if (Number(node.dataset.expires ?? 0) <= now) node.remove();
      });
    }
    window.requestAnimationFrame(animate);
  };
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(animate);
  }
}
