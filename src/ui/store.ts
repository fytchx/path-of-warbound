import type { DoctrineId, ItemSlot, UnlockableSystem } from '../data/types';
import { gemById, itemBaseById, monsterById, nodeById, sfxFileFor, skillTree, zoneById } from '../data';
import {
  buildTreeGraph,
  canAllocate,
  getArticulationPoints,
} from '../engine/treeGraph';
import {
  appendCombatLog,
  continueAfterBoss,
  createCombat,
  manualCast,
  summonBoss as triggerSummonBoss,
  tickCombat,
  type CombatEnemy,
  type CombatRewards,
  type CombatState,
} from '../engine/combatEngine';
import { computePlayerStats, type PlayerStats } from '../engine/stats';
import type { CharacterSave, GemInstance, ItemInstance, OfflineSummary } from '../game/types';
import {
  allocateNode,
  applyCombatRewards,
  applyStarterChoice,
  assignGemBar,
  chromaticReforge,
  claimOffline,
  craftSocketColor,
  createInitialSave,
  equipItem,
  grantBossCache,
  infusePrismatic,
  levelUpGemWithDust,
  loadSave,
  maxTierForZone,
  persistSave,
  processKillDrops,
  recordBossKill,
  refundNode,
  respecCost,
  respecTree,
  riftKeysUnlocked,
  salvageItem,
  setTier as setSaveTier,
  setZone as setSaveZone,
  socketGem,
  STORAGE_KEY,
  unspentPoints,
  unequipItem,
  unsocketGem,
  type BossCache,
  type StarterChoice,
} from '../game/state';
import {
  augmentCraft,
  chaosCraft,
  fusingCraft,
  guaranteedLinkCraft,
  jewellerCraft,
  regalCraft,
  transmuteCraft,
} from '../game/crafting';
import { fitsSlot, itemBase, itemDisplayName, itemGearscore } from '../game/items';

export type ScreenId = 'combat' | 'altar' | 'tree' | 'bag' | 'forge';
export type BagFilter = 'all' | 'gear' | 'gems' | 'keys';
export type CurrencyOrb = 'transmute' | 'augment' | 'regal' | 'chaos' | 'jeweller' | 'fusing' | 'full-link';

export interface UiSfxEvent {
  id: number;
  key: string;
  file: string;
  at: number;
}

export type ModalState =
  | { kind: 'stats' }
  | { kind: 'options' }
  | { kind: 'reset' }
  | { kind: 'respec' }
  | { kind: 'awakening' }
  | { kind: 'rotation' }
  | { kind: 'item'; uid: string }
  | { kind: 'slot-picker'; slot: ItemSlot }
  | { kind: 'node'; nodeId: string }
  | { kind: 'gem-picker'; itemUid: string; socketIndex: number }
  | { kind: 'gem'; source: 'stash'; stashIndex: number }
  | { kind: 'gem'; source: 'socket'; itemUid: string; socketIndex: number }
  | {
      kind: 'boss-cache';
      cache: BossCache;
      zoneId: string;
      zoneName: string;
      tierCleared: number;
      unlock: { tierUnlocked: number; zoneUnlocked?: string };
    }
  | { kind: 'offline' };

export interface TreeView {
  x: number;
  y: number;
  scale: number;
}

export type CombatTab = 'overview' | 'breakdown' | 'log';
export type BagTab = 'gear' | 'gems' | 'materials';
export type ForgeTab = 'orbs' | 'sockets' | 'colors';
export type TreeTab = 'inspect' | 'keystones' | 'summary';
export type TreeFocus = 'all' | 'might' | 'agility' | 'wisdom' | 'fortitude';

export interface UIState {
  screen: ScreenId;
  modal: ModalState | null;
  paused: boolean;
  toast: { id: number; text: string } | null;
  toasts: { id: number; text: string }[];
  previewNode: string | null;
  previewPath: string[];
  refundMode: boolean;
  combatTab: CombatTab;
  bagTab: BagTab;
  forgeTab: ForgeTab;
  treeTab: TreeTab;
  treeFocus: TreeFocus;
  bagFilter: BagFilter;
  logFilter: 'all' | 'loot' | 'combat';
  gearFilter: 'all' | 'weapons' | 'armor' | 'jewelry';
  gemFilter: 'all' | 'red' | 'green' | 'blue' | 'white';
  forgeSocket: number | null;
  forgeUid: string | null;
  lockedAffixIndex: number | null;
  treeView: TreeView;
  craftMessage: string | null;
  keyPulseAt: number;
  lastTickAt: number;
  sfxQueue: UiSfxEvent[];
}

export interface ItemLocation {
  item: ItemInstance;
  slot?: ItemSlot;
}

const treeGraph = buildTreeGraph(skillTree);
let toastId = 0;
let uiSfxSeq = 0;

export class GameStore {
  save: CharacterSave;
  offline: OfflineSummary | null;
  combat: CombatState;
  stats: PlayerStats;
  ui: UIState;
  private listeners = new Set<(dynamic: boolean) => void>();
  private appliedRewards: CombatRewards;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private lastLevel: number;
  private victorySynced = false;

  constructor(save?: CharacterSave, offline: OfflineSummary | null = null) {
    this.save = save ?? loadSave() ?? createInitialSave();
    this.offline = offline;
    this.stats = computePlayerStats(this.save);
    this.lastLevel = this.save.level;
    this.ui = {
      screen: 'combat',
      modal: offline ? { kind: 'offline' } : !this.save.awakened ? { kind: 'awakening' } : null,
      paused: !this.save.awakened,
      toast: null,
      toasts: [],
      previewNode: null,
      previewPath: [],
      refundMode: false,
      combatTab: 'log',
      bagTab: 'gear',
      forgeTab: 'orbs',
      treeTab: 'inspect',
      treeFocus: 'all',
      bagFilter: 'all',
      logFilter: 'all',
      gearFilter: 'all',
      gemFilter: 'all',
      forgeSocket: 0,
      forgeUid: this.save.equipment.main_hand?.uid ?? this.save.inventory[0]?.uid ?? null,
      lockedAffixIndex: null,
      treeView: { x: 0, y: 0, scale: 1 },
      craftMessage: null,
      keyPulseAt: 0,
      lastTickAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      sfxQueue: [],
    };
    this.combat = this.buildCombat();
    this.appliedRewards = { ...this.combat.rewards };
  }

  subscribe(listener: (dynamic: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(dynamic = false): void {
    for (const listener of this.listeners) listener(dynamic);
  }

  pushUiSfx(key: string): void {
    uiSfxSeq += 1;
    this.ui.sfxQueue.push({
      id: uiSfxSeq,
      key,
      file: sfxFileFor(key),
      at: Date.now(),
    });
    if (this.ui.sfxQueue.length > 24) this.ui.sfxQueue.shift();
  }

  private buildCombat(): CombatState {
    return createCombat({
      seed: Math.floor(Math.random() * 1_000_000),
      zoneId: this.save.zoneId,
      tier: this.save.tier,
      packSize: Math.min(this.maxPackSize(), this.save.packSize),
      doctrine: this.save.doctrine,
      activeBar: this.save.activeBar,
      startingKeys: this.save.keys,
      keysUnlocked: riftKeysUnlocked(this.save),
      startingNormalKills: this.save.lifetime.kills,
      rotation: this.save.rotation,
      playerStats: this.stats,
    });
  }

  restartCombat(): void {
    this.combat = this.buildCombat();
    this.appliedRewards = { ...this.combat.rewards };
    this.victorySynced = false;
  }

  private resyncStats(): void {
    this.stats = computePlayerStats(this.save);
    this.combat.playerStats = this.stats;
    this.combat.player.hp = Math.min(this.combat.player.hp, this.stats.maxHp);
    this.combat.player.mana = Math.min(this.combat.player.mana, this.stats.maxMana);
    this.combat.player.ward = Math.min(this.combat.player.ward, this.stats.maxWard);
    const interval = 1 / Math.max(0.1, this.stats.weapon.attacksPerSecond * this.stats.attackSpeedMultiplier);
    this.combat.player.attackInterval = interval;
    this.combat.player.attackTimer = Math.min(this.combat.player.attackTimer, interval);
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      persistSave(this.save);
      this.persistTimer = null;
    }, 600);
  }

  isSystemUnlocked(_system: ScreenId | UnlockableSystem): boolean {
    return true;
  }

  maxPackSize(): number {
    return 5;
  }

  private syncCombat(): void {
    const prevKeys = this.combat.keys;
    const rewards = this.combat.rewards;
    const delta: CombatRewards = {
      gold: rewards.gold - this.appliedRewards.gold,
      xp: rewards.xp - this.appliedRewards.xp,
      kills: rewards.kills - this.appliedRewards.kills,
      eliteKills: rewards.eliteKills - this.appliedRewards.eliteKills,
      bossKills: rewards.bossKills - this.appliedRewards.bossKills,
      deaths: rewards.deaths - this.appliedRewards.deaths,
      keys: rewards.keys - this.appliedRewards.keys,
      damage: rewards.damage - this.appliedRewards.damage,
    };

    let unlockedProgression: ReturnType<typeof applyCombatRewards> = [];
    if (Object.values(delta).some((value) => value !== 0)) {
      unlockedProgression = applyCombatRewards(this.save, delta);
      this.appliedRewards = { ...rewards };
    }

    if (delta.kills > 0) {
      const drops = processKillDrops(this.save, delta.kills, this.combat.tier, this.stats.itemFind);
      if (drops.itemsAdded.length > 0) {
        const names = drops.itemsAdded.map((item) => this.itemBaseName(item)).join(', ');
        this.toast(`Found: ${names}`);
      } else if (drops.gemsAdded.length > 0) {
        const names = drops.gemsAdded.map((id) => gemById.get(id)?.name ?? id).join(', ');
        this.toast(`Gem found: ${names}`);
      } else if (drops.dustAdded > 0) {
        this.toast(`Duplicate gem salvaged (+${drops.dustAdded} Gem Dust)`);
      }
    }

    for (const entry of unlockedProgression) {
      const gemName = entry.grants.gem ? gemById.get(entry.grants.gem)?.name : undefined;
      if (gemName) {
        this.toast(`Unlocked Gem: ${gemName} (check Bag)`);
      }
    }

    this.save.keys = this.combat.keys;
    const killedTier = this.save.tier;
    if (delta.bossKills > 0) {
      const unlock = recordBossKill(this.save, this.combat.zone.id, killedTier);
      const cache = grantBossCache(this.save, this.combat.zone.id, killedTier);
      this.pushUiSfx('boss_cache_open');
      const cacheItemName = this.itemBaseName(cache.item);
      const cacheExtras = [
        cache.chroma > 0 ? `${cache.chroma} Chroma` : '',
        cache.essence > 0 ? `${cache.essence} Essence` : '',
        cache.skillPoint > 0 ? `+${cache.skillPoint} Skill Point` : '',
      ]
        .filter(Boolean)
        .join(', ');
      appendCombatLog(
        this.combat,
        'key',
        `Boss Cache claimed: ${cacheItemName} (${cache.item.rarity.toUpperCase()})${cacheExtras ? ` + ${cacheExtras}` : ''}`,
      );
      const unlockedZoneName = unlock.zoneUnlocked
        ? zoneById.get(unlock.zoneUnlocked)?.name ?? unlock.zoneUnlocked.replace('zone_', '').replace(/_/g, ' ')
        : '';
      if (unlockedZoneName) {
        appendCombatLog(this.combat, 'boss', `Realm unlocked: ${unlockedZoneName}`);
      }
      this.toast(
        unlockedZoneName
          ? `Boss Cache claimed! Tier ${unlock.tierUnlocked} & ${unlockedZoneName} unlocked.`
          : `Boss Cache claimed! Tier ${unlock.tierUnlocked} unlocked.`,
      );
    }
    this.save.tier = Math.min(this.combat.tier, maxTierForZone(this.save));

    if (this.save.level !== this.lastLevel) {
      this.lastLevel = this.save.level;
      this.resyncStats();
      this.pushUiSfx('level_up');
      this.toast(`Level ${this.save.level} reached (+1 Skill Point)`);
    }

    if (this.combat.keys > prevKeys) {
      this.ui.keyPulseAt = Date.now();
    }

    this.schedulePersist();
  }

  toast(text: string): void {
    toastId += 1;
    this.ui.toast = { id: toastId, text };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.dismissToast(), 3000);
    this.notify();
  }

  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    if (!this.ui.toast) return;
    this.ui.toast = null;
    this.notify();
  }

  navigate(screen: ScreenId): void {
    this.ui.screen = screen;
    this.ui.modal = null;
    this.notify();
  }

  openModal(modal: ModalState): void {
    this.ui.modal = modal;
    this.notify();
  }

  openSlotPicker(slot: ItemSlot): void {
    this.openModal({ kind: 'slot-picker', slot });
  }

  openForgeFor(uid: string): void {
    this.ui.forgeUid = uid;
    this.ui.modal = null;
    this.navigate('forge');
  }

  closeModal(): void {
    this.ui.modal = null;
    this.ui.previewNode = null;
    this.ui.previewPath = [];
    if (this.combat.status === 'victory') {
      this.syncCombat();
      this.combat.tier = Math.min(this.combat.tier, maxTierForZone(this.save));
      this.save.tier = this.combat.tier;
      continueAfterBoss(this.combat);
      this.victorySynced = false;
    }
    this.notify();
  }

  setZone(zoneId: string): void {
    if (this.save.zoneId === zoneId) return;
    const result = setSaveZone(this.save, zoneId);
    if (!result.ok) {
      this.toast(result.reason ?? 'That realm is still sealed.');
      return;
    }
    this.syncCombat();
    this.restartCombat();
    this.notify();
  }

  setTier(delta: number): void {
    this.syncCombat();
    const result = setSaveTier(this.save, this.save.tier + delta);
    if (!result.ok) {
      this.toast(result.reason ?? 'Tier locked.');
      return;
    }
    this.restartCombat();
    this.notify();
  }

  maxTier(): number {
    return maxTierForZone(this.save);
  }

  setPackSize(delta: number): void {
    const size = Math.max(1, Math.min(5, this.save.packSize + delta)) as CharacterSave['packSize'];
    if (size === this.save.packSize) return;
    this.save.packSize = size;
    this.restartCombat();
    this.notify();
  }

  chooseStarter(choice: StarterChoice): void {
    const weapon = applyStarterChoice(this.save, choice);
    this.lastLevel = this.save.level;
    this.resyncStats();
    this.restartCombat();
    this.ui.paused = false;
    this.ui.modal = null;
    this.ui.forgeUid = weapon.uid;
    persistSave(this.save);
    this.toast(`Awakened: ${itemBase(weapon)?.name ?? weapon.baseId} in hand.`);
    this.notify();
  }

  resetProgress(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    // Stop the tick loop first so no later tick writes the old run back.
    this.ui.paused = true;
    const settings = { ...this.save.settings };
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable: the in-memory run still resets */
    }
    this.save = { ...createInitialSave(), settings };
    this.offline = null;
    this.lastLevel = this.save.level;
    this.victorySynced = false;
    this.stats = computePlayerStats(this.save);
    this.combat = this.buildCombat();
    this.appliedRewards = { ...this.combat.rewards };
    this.ui = {
      ...this.ui,
      screen: 'combat',
      modal: { kind: 'awakening' },
      paused: true,
      toast: null,
      toasts: [],
      previewNode: null,
      previewPath: [],
      refundMode: false,
      combatTab: 'log',
      bagTab: 'gear',
      forgeTab: 'orbs',
      treeTab: 'inspect',
      treeFocus: 'all',
      bagFilter: 'all',
      logFilter: 'all',
      gearFilter: 'all',
      gemFilter: 'all',
      forgeSocket: 0,
      forgeUid: null,
      lockedAffixIndex: null,
      treeView: { x: 0, y: 0, scale: 1 },
      craftMessage: null,
      keyPulseAt: 0,
      sfxQueue: [],
    };
    this.notify();
  }

  activeSkills(): { id: string; name: string; manaCost: number; castTime: number; cooldown: number }[] {
    return this.stats.skills
      .filter((skill) => skill.manaReservation <= 0 && !skill.triggerType && skill.maxDamage > 0)
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        manaCost: Math.round(skill.effectiveManaCost),
        castTime: skill.effectiveCastTime,
        cooldown: skill.effectiveCooldown,
      }));
  }

  setRotationMode(mode: 'auto' | 'manual'): void {
    this.save.rotation.mode = mode;
    this.combat.rotationMode = mode;
    this.combat.player.disciplineStacks = 0;
    this.schedulePersist();
    this.notify();
  }

  moveRotation(skillId: string, delta: number): void {
    const usable = this.activeSkills().map((skill) => skill.id);
    const order = this.save.rotation.order.filter((id) => usable.includes(id));
    for (const id of usable) if (!order.includes(id)) order.push(id);
    const from = order.indexOf(skillId);
    if (from < 0) return;
    const to = Math.max(0, Math.min(order.length - 1, from + delta));
    if (to === from) return;
    order.splice(to, 0, order.splice(from, 1)[0]!);
    this.save.rotation.order = order;
    this.combat.rotationOrder = [...order];
    this.schedulePersist();
    this.notify();
  }

  togglePause(): void {
    this.ui.paused = !this.ui.paused;
    this.notify();
  }

  summonBoss(): void {
    if (!triggerSummonBoss(this.combat)) {
      this.toast('Collect 3 Rift Keys first.');
      return;
    }
    this.save.keys = this.combat.keys;
    this.schedulePersist();
    this.toast(`${this.combat.zone.name} Boss summoned!`);
    this.notify();
  }

  toggleAutoSalvage(): void {
    this.save.autoSalvage = !this.save.autoSalvage;
    this.schedulePersist();
    this.toast(`Auto-Salvage Common drops ${this.save.autoSalvage ? 'enabled' : 'disabled'}.`);
    this.notify();
  }

  toggleLogCombat(): void {
    this.save.settings.logCombat = !this.save.settings.logCombat;
    this.schedulePersist();
    this.notify();
  }

  toggleReducedMotion(): void {
    this.save.settings.reducedMotion = !this.save.settings.reducedMotion;
    this.schedulePersist();
    this.notify();
  }

  toggleSound(): void {
    this.save.settings.sound = !this.save.settings.sound;
    this.schedulePersist();
    this.notify();
  }

  setBar(bar: 'bar_1' | 'bar_2'): void {
    if (this.stats.keystones.has('ks_pendulum')) {
      this.toast('Pendulum swaps bars automatically every 5s.');
      return;
    }
    this.save.activeBar = bar;
    this.combat.activeBar = bar;
    this.schedulePersist();
    this.notify();
  }

  cast(skillId: string): void {
    if (manualCast(this.combat, skillId)) this.notify(true);
    else this.toast('Skill not ready');
  }

  setDoctrine(doctrine: DoctrineId): void {
    if (this.save.doctrine === doctrine) return;
    if (this.stats.keystones.has('ks_zealots_mandate')) {
      this.toast("Zealot's Mandate locks this doctrine in place.");
      return;
    }
    this.syncCombat();
    this.save.doctrine = doctrine;
    this.restartCombat();
    this.schedulePersist();
    this.notify();
  }

  unspent(): number {
    return unspentPoints(this.save);
  }

  respecFee(): number {
    return respecCost(this.save);
  }

  confirmRespec(): void {
    const result = respecTree(this.save);
    if (!result.ok) {
      this.toast(result.reason ?? 'Cannot respec yet.');
      return;
    }
    this.syncCombat();
    this.ui.modal = null;
    this.ui.previewNode = null;
    this.ui.previewPath = [];
    this.ui.refundMode = false;
    this.resyncStats();
    this.schedulePersist();
    this.toast(`Refunded ${result.refunded} passive point${result.refunded === 1 ? '' : 's'}.`);
    this.notify();
  }

  private clampTreeView(view: TreeView): TreeView {
    const scale = Math.max(0.7, Math.min(2.5, Number.isFinite(view.scale) ? view.scale : 1));
    const maxPan = 175 * scale;
    return {
      x: Math.max(-maxPan, Math.min(maxPan, Number.isFinite(view.x) ? view.x : 0)),
      y: Math.max(-maxPan, Math.min(maxPan, Number.isFinite(view.y) ? view.y : 0)),
      scale,
    };
  }

  centerOnNode(nodeId: string, minScale = 1.35): void {
    const node = nodeById(nodeId);
    if (!node) return;
    const scale = Math.max(this.ui.treeView.scale, minScale);
    this.ui.treeView = this.clampTreeView({
      x: -node.x * scale,
      y: -node.y * scale,
      scale,
    });
  }

  previewNode(nodeId: string, panToNode = false): void {
    if (this.ui.refundMode) {
      if (this.save.allocated.includes(nodeId) && nodeId !== 'hub_0') {
        this.refundNode(nodeId);
      } else if (nodeId === 'hub_0') {
        this.toast('Soul-Spark core cannot be refunded.');
      } else {
        this.toast('Tap a gold allocated node to refund it.');
      }
      return;
    }
    if (this.save.allocated.includes(nodeId)) {
      this.ui.previewNode = nodeId;
      this.ui.previewPath = [];
      this.ui.treeTab = 'inspect';
      if (panToNode) this.centerOnNode(nodeId);
      this.notify();
      return;
    }
    // Second tap on an already-previewed node on the map confirms allocation if affordable.
    if (!panToNode && this.ui.previewNode === nodeId) {
      const recheck = canAllocate(this.save.allocated, nodeId, treeGraph, this.unspent());
      if (recheck.ok) {
        this.confirmAllocation();
        return;
      }
      const name = nodeById(nodeId)?.name ?? 'That node';
      if (recheck.reason === 'not-enough-points') {
        this.toast(`${name} needs ${recheck.cost} pts (${this.unspent()} free).`);
      } else if (recheck.reason === 'excluded') {
        this.toast(`Locked out by ${nodeById(recheck.blockedBy ?? '')?.name ?? 'a rival keystone'}.`);
      } else {
        this.toast('Cannot allocate that node yet.');
      }
      return;
    }
    const check = canAllocate(this.save.allocated, nodeId, treeGraph, this.unspent());
    this.ui.previewNode = nodeId;
    this.ui.previewPath = check.ok || check.reason === 'not-enough-points' ? check.path : [];
    this.ui.treeTab = 'inspect';
    if (panToNode) this.centerOnNode(nodeId);
    if (!check.ok && check.reason === 'excluded') {
      const blocker = nodeById(check.blockedBy ?? '')?.name ?? 'a rival keystone';
      this.toast(`Locked out by ${blocker}.`);
    }
    this.notify();
  }

  confirmAllocation(nodeOverride?: string): void {
    const nodeId = nodeOverride ?? this.ui.previewNode;
    if (!nodeId) return;
    const result = allocateNode(this.save, nodeId);
    if (!result.ok) {
      this.toast(result.reason === 'not-enough-points' ? 'Not enough points.' : 'Allocation failed.');
      return;
    }
    this.syncCombat();
    this.ui.previewNode = nodeId;
    this.ui.previewPath = [];
    this.ui.modal = null;
    this.resyncStats();
    this.schedulePersist();
    this.toast(`Allocated ${result.path?.length ?? 1} node(s).`);
    this.notify();
  }

  toggleRefundMode(): void {
    this.ui.refundMode = !this.ui.refundMode;
    this.notify();
  }

  refundNode(nodeId: string): void {
    const result = refundNode(this.save, nodeId);
    if (!result.ok) {
      this.toast(result.reason === 'articulation' ? 'Refunding this node would strand others.' : 'Cannot refund that node.');
      return;
    }
    this.syncCombat();
    this.ui.modal = null;
    if (this.ui.previewNode === nodeId) {
      this.ui.previewNode = null;
      this.ui.previewPath = [];
    }
    this.resyncStats();
    this.schedulePersist();
    this.toast('Point refunded.');
    this.notify();
  }

  articulationPoints(): Set<string> {
    return new Set(getArticulationPoints(this.save.allocated, treeGraph));
  }

  setTreeView(view: TreeView, silent = false): void {
    this.ui.treeView = this.clampTreeView(view);
    if (!silent) this.notify();
  }

  zoomTree(factor: number): void {
    const view = this.ui.treeView;
    const nextScale = Math.max(0.7, Math.min(2.5, view.scale * factor));
    const ratio = nextScale / view.scale;
    this.ui.treeView = this.clampTreeView({
      x: view.x * ratio,
      y: view.y * ratio,
      scale: nextScale,
    });
    this.notify();
  }

  resetTree(): void {
    this.ui.treeFocus = 'all';
    this.ui.treeView = { x: 0, y: 0, scale: 1 };
    this.notify();
  }

  focusTreeSector(sector: TreeFocus): void {
    this.ui.treeFocus = sector;
    if (sector === 'all') {
      this.ui.treeView = { x: 0, y: 0, scale: 1 };
      this.notify();
      return;
    }
    const nodes = skillTree.nodes.filter((node) => node.sector === sector);
    if (!nodes.length) {
      this.resetTree();
      return;
    }
    const cx = nodes.reduce((sum, node) => sum + node.x, 0) / nodes.length;
    const cy = nodes.reduce((sum, node) => sum + node.y, 0) / nodes.length;
    const scale = 1.48;
    this.ui.treeView = this.clampTreeView({
      x: Math.round(-cx * scale),
      y: Math.round(-cy * scale),
      scale,
    });
    this.notify();
  }

  setCombatTab(tab: CombatTab): void {
    this.ui.combatTab = tab;
    this.notify();
  }

  setBagTab(tab: BagTab): void {
    this.ui.bagTab = tab;
    this.notify();
  }

  setForgeTab(tab: ForgeTab): void {
    this.ui.forgeTab = tab;
    this.notify();
  }

  setTreeTab(tab: TreeTab): void {
    this.ui.treeTab = tab;
    this.notify();
  }

  setBagFilter(filter: BagFilter): void {
    this.ui.bagFilter = filter;
    this.notify();
  }

  setLogFilter(filter: 'all' | 'loot' | 'combat'): void {
    this.ui.logFilter = filter;
    this.notify();
  }

  setGearFilter(filter: 'all' | 'weapons' | 'armor' | 'jewelry'): void {
    this.ui.gearFilter = filter;
    this.notify();
  }

  setGemFilter(filter: 'all' | 'red' | 'green' | 'blue' | 'white'): void {
    this.ui.gemFilter = filter;
    this.notify();
  }

  setForgeSocket(index: number | null): void {
    this.ui.forgeSocket = index;
    this.notify();
  }

  selectForge(uid: string): void {
    this.ui.forgeUid = uid;
    const item = this.findItem(uid)?.item;
    this.ui.forgeSocket = item && item.sockets.length > 0 ? 0 : null;
    this.ui.lockedAffixIndex = null;
    this.ui.craftMessage = null;
    this.notify();
  }

  toggleAffixLock(index: number): void {
    this.ui.lockedAffixIndex = this.ui.lockedAffixIndex === index ? null : index;
    this.notify();
  }

  findItem(uid: string): ItemLocation | null {
    for (const [slot, item] of Object.entries(this.save.equipment)) {
      if (item?.uid === uid) return { item, slot: slot as ItemSlot };
    }
    const item = this.save.inventory.find((entry) => entry.uid === uid);
    return item ? { item } : null;
  }

  forgeItem(): ItemInstance | null {
    const uid = this.ui.forgeUid;
    if (!uid) return null;
    return this.findItem(uid)?.item ?? null;
  }

  equip(uid: string, slot: ItemSlot): void {
    const location = this.findItem(uid);
    if (!location) return;
    const result = equipItem(this.save, location.item, slot);
    if (!result.ok) {
      this.toast(result.reason ?? 'Cannot equip that.');
      return;
    }
    this.syncCombat();
    this.ui.forgeUid = location.item.uid;
    this.resyncStats();
    this.schedulePersist();
    this.ui.modal = null;
    this.toast('Equipped.');
    this.notify();
  }

  quickEquip(uid: string): void {
    const location = this.findItem(uid);
    if (!location || location.slot) return;
    const slots = this.availableSlots(location.item);
    if (!slots.length) return;
    const emptyPreferred = slots.find((slot) => !this.save.equipment[slot]);
    const twoHanded = itemBase(location.item).weapon?.twoHanded ?? false;
    const targetSlot = twoHanded ? slots[0]! : emptyPreferred ?? slots[0]!;
    this.equip(uid, targetSlot);
  }

  unequip(slot: ItemSlot): void {
    this.syncCombat();
    unequipItem(this.save, slot);
    this.resyncStats();
    this.schedulePersist();
    this.ui.modal = null;
    this.toast('Unequipped.');
    this.notify();
  }

  beginSocket(itemUid: string, socketIndex: number): void {
    const location = this.findItem(itemUid);
    if (!location) return;
    if (location.item.sockets[socketIndex]) {
      this.openModal({ kind: 'gem', source: 'socket', itemUid, socketIndex });
      return;
    }
    if (!this.save.gemStash.length) {
      this.toast('No gems in the pouch.');
      return;
    }
    this.openModal({ kind: 'gem-picker', itemUid, socketIndex });
  }

  inspectStashGem(stashIndex: number): void {
    if (!this.save.gemStash[stashIndex]) return;
    this.openModal({ kind: 'gem', source: 'stash', stashIndex });
  }

  resolveModalGem(modal: Extract<ModalState, { kind: 'gem' }>): { gem: GemInstance; item?: ItemInstance; socketIndex?: number } | null {
    if (modal.source === 'stash') {
      const gem = this.save.gemStash[modal.stashIndex];
      return gem ? { gem } : null;
    }
    const loc = this.findItem(modal.itemUid);
    const gem = loc?.item.sockets[modal.socketIndex];
    return loc && gem ? { gem, item: loc.item, socketIndex: modal.socketIndex } : null;
  }

  levelUpModalGem(): void {
    if (this.ui.modal?.kind !== 'gem') return;
    const resolved = this.resolveModalGem(this.ui.modal);
    if (!resolved) return;
    const res = levelUpGemWithDust(this.save, resolved.gem);
    if (res.ok) {
      this.syncCombat();
      this.resyncStats();
      this.schedulePersist();
    }
    this.toast(res.message);
    this.notify();
  }

  setModalGemBar(bar: GemInstance['bar']): void {
    if (this.ui.modal?.kind !== 'gem') return;
    const resolved = this.resolveModalGem(this.ui.modal);
    if (!resolved) return;
    assignGemBar(resolved.gem, bar);
    this.resyncStats();
    this.schedulePersist();
    this.toast(`Assigned to ${bar === 'both' ? 'Both Bars' : bar === 'bar_1' ? 'Bar I' : 'Bar II'}.`);
    this.notify();
  }

  socketFromStash(stashIndex: number): void {
    const modal = this.ui.modal;
    if (!modal || modal.kind !== 'gem-picker') return;
    const gem = this.save.gemStash[stashIndex];
    const location = this.findItem(modal.itemUid);
    if (!gem || !location) return;
    const result = socketGem(this.save, location.item, modal.socketIndex, gem);
    if (!result.ok) {
      this.toast(result.reason ?? 'Socket failed.');
      return;
    }
    this.syncCombat();
    this.resyncStats();
    this.schedulePersist();
    this.ui.modal = { kind: 'item', uid: modal.itemUid };
    this.toast('Gem socketed.');
    this.notify();
  }

  unsocket(itemUid: string, socketIndex: number): void {
    const location = this.findItem(itemUid);
    if (!location) return;
    this.syncCombat();
    unsocketGem(this.save, location.item, socketIndex);
    this.resyncStats();
    this.schedulePersist();
    if (this.ui.modal?.kind === 'gem') {
      this.ui.modal = { kind: 'item', uid: itemUid };
    }
    this.toast('Gem returned to the pouch.');
    this.notify();
  }

  reforgeSockets(itemUid: string): void {
    const location = this.findItem(itemUid);
    if (!location) return;
    const result = chromaticReforge(this.save, location.item);
    if (!result.ok) {
      this.toast(result.reason ?? 'Chromatic Reforge failed.');
      return;
    }
    this.syncCombat();
    this.pushUiSfx('chroma_craft');
    this.resyncStats();
    this.schedulePersist();
    const message = `Sockets reforged: ${(result.colors ?? []).join(' / ') || 'unchanged'}.`;
    this.ui.craftMessage = message;
    this.toast(message);
    this.notify();
  }

  forceSocket(itemUid: string, socketIndex: number, color: 'red' | 'green' | 'blue'): void {
    const location = this.findItem(itemUid);
    if (!location) return;
    const result = craftSocketColor(this.save, location.item, socketIndex, color);
    if (!result.ok) {
      this.toast(result.reason ?? 'Colour craft failed.');
      return;
    }
    this.pushUiSfx('chroma_craft');
    this.resyncStats();
    this.schedulePersist();
    const message = `Socket ${socketIndex + 1} forced ${color}.`;
    this.ui.craftMessage = message;
    this.toast(message);
    this.notify();
  }

  prismaticSocket(itemUid: string, socketIndex: number): void {
    const location = this.findItem(itemUid);
    if (!location) return;
    const result = infusePrismatic(this.save, location.item, socketIndex);
    if (!result.ok) {
      this.toast(result.reason ?? 'Prismatic Infusion failed.');
      return;
    }
    this.pushUiSfx('chroma_craft');
    this.resyncStats();
    this.schedulePersist();
    const message = `Socket ${socketIndex + 1} is now Prismatic.`;
    this.ui.craftMessage = message;
    this.toast(message);
    this.notify();
  }

  cycleGemBar(gem: GemInstance): void {
    const order: GemInstance['bar'][] = ['bar_1', 'bar_2', 'both'];
    const next = order[(order.indexOf(gem.bar) + 1) % order.length]!;
    assignGemBar(gem, next);
    this.resyncStats();
    this.schedulePersist();
    this.toast(`Gem assigned to ${next === 'both' ? 'both bars' : next === 'bar_1' ? 'Bar I' : 'Bar II'}.`);
    this.notify();
  }

  salvage(uid: string): void {
    const location = this.findItem(uid);
    if (!location || location.slot) {
      this.toast('Unequip the item before salvaging.');
      return;
    }
    const gain = salvageItem(this.save, location.item);
    if (this.ui.forgeUid === uid) this.ui.forgeUid = this.save.equipment.main_hand?.uid ?? this.save.inventory[0]?.uid ?? null;
    this.ui.modal = null;
    this.schedulePersist();
    this.toast(`Salvaged for ${gain.scrap} scrap and ${gain.flux} flux.`);
    this.notify();
  }

  craftCurrency(orb: CurrencyOrb): void {
    const item = this.forgeItem();
    if (!item) {
      this.toast('Select an item on the anvil first.');
      return;
    }
    const seed = (Date.now() ^ Math.imul(this.save.milestones.forgeUpgrades + 1, 2654435761)) >>> 0;
    const result =
      orb === 'transmute'
        ? transmuteCraft(this.save, item, seed)
        : orb === 'augment'
          ? augmentCraft(this.save, item, seed)
          : orb === 'regal'
            ? regalCraft(this.save, item, seed)
            : orb === 'chaos'
              ? chaosCraft(this.save, item, seed)
              : orb === 'jeweller'
                ? jewellerCraft(this.save, item, seed)
                : orb === 'fusing'
                  ? fusingCraft(this.save, item, seed)
                  : guaranteedLinkCraft(this.save, item);

    this.ui.craftMessage = result.message;
    if (result.ok) {
      this.syncCombat();
      this.pushUiSfx('orb_craft');
      this.resyncStats();
      this.schedulePersist();
    }
    this.toast(result.message);
    this.notify();
  }

  claimOffline(): void {
    if (!this.offline) return;
    const unlocked = claimOffline(this.save, this.offline);
    this.offline = null;
    this.ui.modal = null;
    this.lastLevel = this.save.level;
    this.resyncStats();
    this.restartCombat();
    this.schedulePersist();
    const gemUnlock = unlocked.find((e) => e.grants.gem);
    const gemName = gemUnlock?.grants.gem ? gemById.get(gemUnlock.grants.gem)?.name : undefined;
    this.toast(gemName ? `Offline spoils claimed · Unlocked ${gemName}!` : 'Offline spoils claimed.');
    this.notify();
  }

  nextTier(): void {
    this.syncCombat();
    this.save.tier = Math.min(10, this.save.tier);
    this.restartCombat();
    this.notify();
  }

  tick(): void {
    if (this.ui.paused || this.ui.modal?.kind === 'offline') return;
    this.combat.keysUnlocked = riftKeysUnlocked(this.save);
    tickCombat(this.combat);
    if (this.combat.status === 'running') {
      tickCombat(this.combat);
    }
    this.ui.lastTickAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      this.combat.tickCount % 5 === 0 ||
      this.combat.rewards.kills !== this.appliedRewards.kills ||
      this.combat.rewards.deaths !== this.appliedRewards.deaths ||
      this.combat.status === 'victory'
    ) {
      this.syncCombat();
    }
    if (this.combat.status === 'victory') {
      this.combat.tier = Math.min(this.combat.tier, maxTierForZone(this.save));
      this.save.tier = this.combat.tier;
      continueAfterBoss(this.combat);
      this.victorySynced = false;
    }
    this.notify(true);
  }

  enemyDef(enemy: CombatEnemy) {
    return monsterById.get(enemy.defId);
  }

  gearscore(): number {
    return this.stats.gearscore;
  }

  durabilityNote(): string {
    return `${this.save.allocated.filter((id) => id !== 'hub_0').length} points spent · ${this.unspent()} unspent`;
  }

  itemSlotLabel(slot: ItemSlot): string {
    const labels: Record<ItemSlot, string> = {
      main_hand: 'Main Hand',
      off_hand: 'Off Hand',
      amulet: 'Amulet',
      helmet: 'Helmet',
      trinket: 'Trinket',
      gloves: 'Gloves',
      chest: 'Chest',
      ring_1: 'Ring I',
      ring_2: 'Ring II',
      boots: 'Boots',
      legs: 'Legs',
    };
    return labels[slot];
  }

  availableSlots(item: ItemInstance): ItemSlot[] {
    const slots: ItemSlot[] = ['main_hand', 'off_hand', 'amulet', 'helmet', 'trinket', 'gloves', 'chest', 'ring_1', 'ring_2', 'boots', 'legs'];
    return slots.filter((slot) => fitsSlot(item, slot));
  }

  itemGearscore(item: ItemInstance): number {
    return itemGearscore(item);
  }

  itemBaseName(item: ItemInstance): string {
    return itemDisplayName(item);
  }

  baseNameOf(uid: string): string {
    const item = this.findItem(uid)?.item;
    return item ? itemDisplayName(item) : '';
  }

  baseAssetOf(uid: string): string {
    const item = this.findItem(uid)?.item;
    return item ? itemBaseById.get(item.baseId)?.assetId ?? '' : '';
  }
}
