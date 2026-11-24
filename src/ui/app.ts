import type { DoctrineId, ItemSlot } from '../data/types';
import type { GemInstance } from '../game/types';
import { xpNeeded } from '../game/state';
import { escapeHtml, schoolColor, titleCase } from './dom';
import { renderModal } from './modals';
import { altarScreen } from './screens/altar';
import { bagScreen } from './screens/bag';
import { combatScreen } from './screens/combat';
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
  const unvisited = new Set(store.ui.unvisitedTabs);
  return TABS.filter((tab) => store.isSystemUnlocked(tab.id))
    .map(
      (tab) => `<button class="${store.ui.screen === tab.id ? 'active' : ''} ${unvisited.has(tab.id) ? 'tab-pulse' : ''}" data-nav="${tab.id}" aria-label="${tab.label}" aria-current="${store.ui.screen === tab.id ? 'page' : 'false'}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[tab.id]}</svg>
      <span>${tab.label}</span>
    </button>`,
    )
    .join('');
}

function topbar(store: GameStore): string {
  const save = store.save;
  const need = xpNeeded(save.level);
  const xpPercent = Math.min(100, Math.round((save.xp / Math.max(1, need)) * 100));
  return `<div class="medal">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l10 10M20 4L10 14M3 21l4-4M21 21l-4-4M6 15l3 3M18 15l-3 3"/></svg>
    </div>
    <div>
      <div class="title">PATH OF WARBOUND</div>
      <div class="sub">${store.isSystemUnlocked('doctrines') ? `${titleCase(save.doctrine)} Doctrine` : `Tier ${store.combat.tier} · Ashen Path`}</div>
      <div class="xp">Lv. ${save.level}<i><b style="width:${xpPercent}%"></b></i>${xpPercent}%</div>
    </div>
    <button class="gear" data-action="modal-stats" aria-label="Character stats & settings" title="Character stats & settings">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>
    </button>`;
}

interface PanState {
  pointerId: number;
  startX: number;
  startY: number;
  viewX: number;
  viewY: number;
  svg: SVGSVGElement;
  group: SVGGElement;
  moved: boolean;
}

export function mountApp(root: HTMLElement, store: GameStore): void {
  let pan: PanState | null = null;
  let renderedScreen: ScreenId | null = null;
  let renderedModal: unknown = undefined;
  let renderedToast: number | null = null;
  let renderedUnlockNotice: number | null = null;
  let renderedTabKey = '';
  let seenHitSeq = store.combat.hitSeq;
  const hitFlashUntil = new Map<string, number>();

  const renderToastArea = (): string => {
    const notice = store.ui.unlockNotice;
    const toast = store.ui.toast;
    const noticeHtml = notice
      ? `<div class="unlock-notice" role="status">
          <div class="unlock-copy">
            <strong>${escapeHtml(notice.title)}</strong>
            <span>${escapeHtml(notice.detail)}</span>
          </div>
          <button class="unlock-dismiss" data-action="dismiss-unlock" aria-label="Dismiss notification">✕</button>
        </div>`
      : '';
    const toastHtml = toast ? `<div class="toast" role="status">${escapeHtml(toast.text)}</div>` : '';
    return `${noticeHtml}${toastHtml}`;
  };

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

  const paint = (dynamic: boolean): void => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const topbarEl = root.querySelector<HTMLElement>('#topbar');
    if (topbarEl) topbarEl.innerHTML = topbar(store);

    const screenHost = root.querySelector<HTMLElement>('#screen-host');
    const shouldPaintScreen = !dynamic || renderedScreen !== store.ui.screen || store.ui.screen === 'combat';
    if (screenHost && shouldPaintScreen) {
      const preservedFloats: HTMLElement[] = [];
      if (renderedScreen === 'combat' && store.ui.screen === 'combat') {
        screenHost.querySelectorAll<HTMLElement>('#combat-fx .dmg-float').forEach((node) => {
          if (Number(node.dataset.expires ?? 0) > now) preservedFloats.push(node);
        });
      }
      const scrollTop = screenHost.scrollTop;
      screenHost.innerHTML = SCREENS[store.ui.screen](store);
      screenHost.scrollTop = scrollTop;
      renderedScreen = store.ui.screen;
      if (preservedFloats.length > 0) {
        const nextFx = screenHost.querySelector<HTMLElement>('#combat-fx');
        if (nextFx) {
          for (const node of preservedFloats) nextFx.appendChild(node);
        }
      }
      applyHitFeedback(now);
    }

    const tabbarEl = root.querySelector<HTMLElement>('#tabbar');
    const nextTabKey = `${store.save.unlockedSystems.join(',')}|${store.ui.unvisitedTabs.join(',')}|${store.ui.screen}`;
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
    const unlockNotice = store.ui.unlockNotice;
    if (toastRoot && ((toast?.id ?? null) !== renderedToast || (unlockNotice?.id ?? null) !== renderedUnlockNotice)) {
      renderedToast = toast?.id ?? null;
      renderedUnlockNotice = unlockNotice?.id ?? null;
      toastRoot.innerHTML = renderToastArea();
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
  renderedTabKey = `${store.save.unlockedSystems.join(',')}|${store.ui.unvisitedTabs.join(',')}|${store.ui.screen}`;

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
      case 'toggle-auto-boss':
        store.toggleAutoAdvanceBoss();
        break;
      case 'toggle-auto-salvage':
        store.toggleAutoSalvage();
        break;
      case 'skip-guide':
        store.skipGuide();
        break;
      case 'toggle-log':
        store.toggleLogCombat();
        break;
      case 'toggle-motion':
        store.toggleReducedMotion();
        break;
      case 'dismiss-whisper':
        store.dismissWhisper();
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
      case 'zone':
        if (data.zone) store.setZone(data.zone);
        break;
      case 'modal-stats':
        store.openModal({ kind: 'stats' });
        break;
      case 'close-modal':
        store.closeModal();
        break;
      case 'open-item':
        if (data.uid) store.openModal({ kind: 'item', uid: data.uid });
        break;
      case 'open-slot':
        store.toast(`${store.itemSlotLabel(data.slot as ItemSlot)} is empty.`);
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
      case 'node':
        if (data.node) store.previewNode(data.node);
        break;
      case 'refund':
        if (data.node) store.refundNode(data.node);
        break;
      case 'allocate':
        store.confirmAllocation();
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
      case 'craft':
        if (data.craft) store.craft(data.craft as 'upgrade' | 'reforge' | 'socket' | 'corrupt' | 'promote');
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
      case 'claim-offline':
        store.claimOffline();
        break;
      case 'dismiss-unlock':
        store.dismissUnlockNotice();
        break;
      case 'locked-slot':
        store.toast('Unlock more skill slots as you progress.');
        break;
      case 'empty-slot':
        store.toast(store.isSystemUnlocked('altar') ? 'Socket an active gem in the Altar.' : 'Unlocked slot — Altar unlocks soon.');
        break;
      default:
        break;
    }
  };

  root.addEventListener('click', (event) => {
    const el = (event.target as Element | null)?.closest<HTMLElement>('[data-action], [data-nav]');
    if (!el || el.hasAttribute('disabled')) return;
    act(el);
  });

  root.addEventListener('pointerdown', (event) => {
    const target = event.target as Element | null;
    if (!target || target.closest('[data-action="node"]')) return;
    const svg = target.closest<SVGSVGElement>('.tree-svg');
    const group = svg?.querySelector<SVGGElement>('g');
    if (!svg || !group) return;
    pan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      viewX: store.ui.treeView.x,
      viewY: store.ui.treeView.y,
      svg,
      group,
      moved: false,
    };
    svg.setPointerCapture(event.pointerId);
  });

  root.addEventListener('pointermove', (event) => {
    if (!pan || event.pointerId !== pan.pointerId) return;
    const rect = pan.svg.getBoundingClientRect();
    const scale = rect.width > 0 ? 390 / rect.width : 1;
    const dx = (event.clientX - pan.startX) * scale;
    const dy = (event.clientY - pan.startY) * scale;
    if (Math.abs(dx) + Math.abs(dy) > 2) pan.moved = true;
    const view = store.ui.treeView;
    pan.group.setAttribute('transform', `translate(${195 + view.x + dx} ${215 + view.y + dy}) scale(${view.scale})`);
  });

  const endPan = (event: PointerEvent): void => {
    if (!pan || event.pointerId !== pan.pointerId) return;
    const rect = pan.svg.getBoundingClientRect();
    const scale = rect.width > 0 ? 390 / rect.width : 1;
    const dx = (event.clientX - pan.startX) * scale;
    const dy = (event.clientY - pan.startY) * scale;
    const moved = pan.moved;
    pan.svg.releasePointerCapture?.(pan.pointerId);
    pan = null;
    if (moved) store.setTreeView({ x: store.ui.treeView.x + dx, y: store.ui.treeView.y + dy, scale: store.ui.treeView.scale });
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
        const swingEl = root.querySelector<HTMLElement>('[data-swing]');
        if (swingEl) {
          const haste = 1 + (store.stats.values.attack_speed ?? 0) / 100;
          const interval = 1 / Math.max(0.2, store.stats.weapon.attacksPerSecond * haste);
          const remaining = Math.max(0, store.combat.player.attackTimer - dt);
          const pctVal = Math.min(100, Math.max(0, (1 - remaining / interval) * 100));
          swingEl.style.width = `${pctVal.toFixed(1)}%`;
        }
        root.querySelectorAll<HTMLElement>('.skill[data-skill][data-cd]').forEach((btn) => {
          const skillId = btn.dataset.skill ?? '';
          const cd = Math.max(0.001, Number(btn.dataset.cd ?? 0));
          const timer = store.combat.player.skillTimers[skillId] ?? 0;
          const rem = Math.max(0, timer - dt);
          const cdBar = btn.querySelector<HTMLElement>('.cd');
          const cdText = btn.querySelector<HTMLElement>('.cdtime');
          if (cdBar) cdBar.style.height = `${Math.min(100, (rem / cd) * 100).toFixed(1)}%`;
          if (cdText) cdText.textContent = rem > 0.05 ? rem.toFixed(1) : '';
        });
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
