import type { DoctrineId, ItemSlot, ProgressionEntry, UnlockableSystem } from '../data/types';
import { gemById, itemBaseById, monsterById, skillTree } from '../data';
import {
  buildTreeGraph,
  canAllocate,
  getArticulationPoints,
} from '../engine/treeGraph';
import {
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
  assignGemBar,
  claimOffline,
  createInitialSave,
  equipItem,
  evaluateProgression,
  loadSave,
  persistSave,
  processKillDrops,
  refundNode,
  salvageItem,
  socketGem,
  unlockAllSystems,
  unspentPoints,
  unequipItem,
  unsocketGem,
} from '../game/state';
import { addSocket, corruptItem, promoteRarity, reforgeItem, upgradeItem } from '../game/crafting';
import { fitsSlot, itemBase, itemGearscore } from '../game/items';

export type ScreenId = 'combat' | 'altar' | 'tree' | 'bag' | 'forge';
export type BagFilter = 'all' | 'weapon' | 'armour' | 'jewellery';

export type ModalState =
  | { kind: 'stats' }
  | { kind: 'item'; uid: string }
  | { kind: 'node'; nodeId: string }
  | { kind: 'gem-picker'; itemUid: string; socketIndex: number }
  | { kind: 'offline' };

export interface TreeView {
  x: number;
  y: number;
  scale: number;
}

export interface UnlockNotice {
  id: number;
  title: string;
  detail: string;
}

export interface UIState {
  screen: ScreenId;
  modal: ModalState | null;
  paused: boolean;
  toast: { id: number; text: string } | null;
  unlockNotice: UnlockNotice | null;
  previewNode: string | null;
  previewPath: string[];
  refundMode: boolean;
  bagFilter: BagFilter;
  forgeUid: string | null;
  treeView: TreeView;
  craftMessage: string | null;
  unvisitedTabs: ScreenId[];
  whisperOverride: string | null;
  keyPulseAt: number;
  lastTickAt: number;
}

export interface ItemLocation {
  item: ItemInstance;
  slot?: ItemSlot;
}

const treeGraph = buildTreeGraph(skillTree);
let toastId = 0;
let unlockNoticeId = 0;

const SYSTEM_LABEL: Record<UnlockableSystem, string> = {
  altar: 'Altar',
  bag: 'Bag',
  tree: 'Tree',
  forge: 'Forge',
  bar_2: 'Bar II',
  doctrines: 'Doctrines',
  auto_boss: 'Auto-Advance Boss',
  pack_2: 'Pack Size 1–2',
  pack_full: 'Pack Size 1–5',
  forge_full: 'Full Forge',
  auto_salvage: 'Auto-Salvage',
  keystones: 'Keystones',
};

const NAV_SYSTEMS: ScreenId[] = ['altar', 'bag', 'tree', 'forge'];

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
      modal: offline ? { kind: 'offline' } : null,
      paused: false,
      toast: null,
      unlockNotice: null,
      previewNode: null,
      previewPath: [],
      refundMode: false,
      bagFilter: 'all',
      forgeUid: this.save.equipment.main_hand?.uid ?? this.save.inventory[0]?.uid ?? null,
      treeView: { x: 0, y: 0, scale: 1 },
      craftMessage: null,
      unvisitedTabs: [],
      whisperOverride: null,
      keyPulseAt: 0,
      lastTickAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
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

  private allowedMonstersForStep(): string[] | undefined {
    if (this.save.settings.guideSkipped || this.save.onboardingStep >= 4) return undefined;
    if (this.save.onboardingStep === 0) return ['mob_slime'];
    return ['mob_slime', 'mob_wolf'];
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
      autoSummonBoss: this.save.autoAdvanceBoss,
      suppressRandomKeys: this.save.starterKillsClaimed < 10,
      allowedMonsterIds: this.allowedMonstersForStep(),
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
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      persistSave(this.save);
      this.persistTimer = null;
    }, 600);
  }

  isSystemUnlocked(system: ScreenId | UnlockableSystem): boolean {
    if (system === 'combat') return true;
    return this.save.unlockedSystems.includes(system);
  }

  maxPackSize(): number {
    if (this.isSystemUnlocked('pack_full')) return 5;
    if (this.isSystemUnlocked('pack_2')) return 2;
    return 1;
  }

  whisperText(): string | null {
    if (this.ui.whisperOverride) return this.ui.whisperOverride;
    if (this.save.settings.guideSkipped || this.save.onboardingStep >= 6) return null;
    switch (this.save.onboardingStep) {
      case 0:
        return 'Soul-Spark Whisper: Your spark flickers. Slay the slimes to draw your first armor.';
      case 1:
        return 'Soul-Spark Whisper: New armor awaits in [ALTAR] or [BAG]. Equip it to raise Health & Armor.';
      case 2:
        return 'Soul-Spark Whisper: Support gem found! Tap your 2-linked Chest in [ALTAR] to link Cleave + Multistrike.';
      case 3:
        return this.save.level >= 2
          ? 'Soul-Spark Whisper: Level 2! Open [TREE] to preview a constellation path and spend your point.'
          : 'Soul-Spark Whisper: Rift Key #1 & Scrap found! Reach Level 2 to awaken the Skill Tree.';
      case 4:
        return 'Soul-Spark Whisper: Forge & Pack 1–2 unlocked! Temper gear with War-Scrap or collect 3 Rift Keys.';
      case 5:
        return 'Soul-Spark Whisper: 3 Rift Keys burn bright! Tap SUMMON ZONE BOSS to challenge the tier boss.';
      default:
        return null;
    }
  }

  dismissWhisper(): void {
    if (!this.ui.whisperOverride) return;
    this.ui.whisperOverride = null;
    this.notify();
  }

  private markNewlyUnlockedTabs(before: Set<string>): void {
    for (const tab of NAV_SYSTEMS) {
      if (!before.has(tab) && this.save.unlockedSystems.includes(tab) && this.ui.screen !== tab) {
        if (!this.ui.unvisitedTabs.includes(tab)) {
          this.ui.unvisitedTabs = [...this.ui.unvisitedTabs, tab];
        }
      }
    }
  }

  private announceUnlocks(entries: ProgressionEntry[]): void {
    if (!entries.length) return;
    const parts: string[] = [];
    for (const entry of entries) {
      const bits: string[] = [];
      if (entry.grants.gem) {
        const gemName = gemById.get(entry.grants.gem)?.name ?? entry.grants.gem;
        bits.push(`${gemName} added to Gem Pouch`);
      }
      if (entry.grants.skillSlot) {
        bits.push(`+${entry.grants.skillSlot} Skill Slot`);
      }
      for (const sys of entry.grants.unlockedSystems ?? []) {
        bits.push(`${SYSTEM_LABEL[sys]} unlocked`);
      }
      if (bits.length) parts.push(bits.join(' · '));
    }
    unlockNoticeId += 1;
    this.ui.unlockNotice = {
      id: unlockNoticeId,
      title: 'New skill unlocked',
      detail: parts.join(' | '),
    };
  }

  dismissUnlockNotice(): void {
    if (!this.ui.unlockNotice) return;
    this.ui.unlockNotice = null;
    this.notify();
  }

  private syncCombat(): void {
    const prevUnlocked = new Set(this.save.unlockedSystems);
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
    const unlocked: ProgressionEntry[] = [];
    if (Object.values(delta).some((value) => value !== 0)) {
      unlocked.push(...applyCombatRewards(this.save, delta));
      this.appliedRewards = { ...rewards };
    }

    if (delta.kills > 0) {
      const drops = processKillDrops(this.save, delta.kills, this.combat.tier);
      if (drops.keysAdded > 0) {
        this.combat.keys += drops.keysAdded;
      }
      if (drops.itemsAdded.length > 0) {
        const names = drops.itemsAdded.map((item) => this.itemBaseName(item)).join(', ');
        this.toast(`Found: ${names}`);
      }
      if (drops.gemsAdded.length > 0) {
        const names = drops.gemsAdded.map((id) => gemById.get(id)?.name ?? id).join(', ');
        this.toast(`${names} added to Gem Pouch`);
      }
      if (drops.awakened) {
        this.ui.whisperOverride = 'Soul-Spark Awakened! Doctrines, Bar II, Keystones, Full Forge & Pack 1–5 unlocked.';
        this.toast('Soul-Spark Awakened!');
      }
    }

    if (delta.deaths > 0 && this.combat.tier <= 1 && this.save.onboardingStep < 6) {
      this.ui.whisperOverride = 'Your vessel shattered. Reinforce gear with War-Scrap at the Forge or lower Pack Size.';
    }

    this.save.keys = this.combat.keys;
    this.save.tier = this.combat.tier;
    if (this.save.keys >= 3 && this.combat.tier <= 1 && this.save.onboardingStep < 5) {
      this.save.onboardingStep = 5;
    }

    if (this.save.level !== this.lastLevel) {
      this.lastLevel = this.save.level;
      unlocked.push(...evaluateProgression(this.save));
      this.resyncStats();
    }

    this.combat.suppressRandomKeys = this.save.starterKillsClaimed < 10;
    this.combat.allowedMonsterIds = this.allowedMonstersForStep();
    this.combat.autoSummonBoss = this.save.autoAdvanceBoss;

    if (this.combat.keys > prevKeys) {
      this.ui.keyPulseAt = Date.now();
    }

    this.markNewlyUnlockedTabs(prevUnlocked);

    if (unlocked.length) {
      this.resyncStats();
      this.announceUnlocks(unlocked);
    }
    this.schedulePersist();
  }

  toast(text: string): void {
    toastId += 1;
    this.ui.toast = { id: toastId, text };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.ui.toast = null;
      this.notify();
    }, 2600);
    this.notify();
  }

  navigate(screen: ScreenId): void {
    if (!this.isSystemUnlocked(screen)) return;
    this.ui.screen = screen;
    this.ui.modal = null;
    if (this.ui.unvisitedTabs.includes(screen)) {
      this.ui.unvisitedTabs = this.ui.unvisitedTabs.filter((tab) => tab !== screen);
    }
    this.notify();
  }

  openModal(modal: ModalState): void {
    this.ui.modal = modal;
    this.notify();
  }

  closeModal(): void {
    this.ui.modal = null;
    this.ui.previewNode = null;
    this.ui.previewPath = [];
    this.notify();
  }

  setZone(zoneId: string): void {
    if (this.save.zoneId === zoneId) return;
    this.syncCombat();
    this.save.zoneId = zoneId;
    this.restartCombat();
    this.notify();
  }

  setTier(delta: number): void {
    const tier = Math.max(1, Math.min(10, this.save.tier + delta));
    if (tier === this.save.tier) return;
    this.syncCombat();
    this.save.tier = tier;
    this.restartCombat();
    this.notify();
  }

  setPackSize(delta: number): void {
    const maxPack = this.maxPackSize();
    const size = Math.max(1, Math.min(maxPack, this.save.packSize + delta)) as CharacterSave['packSize'];
    if (size === this.save.packSize) return;
    this.save.packSize = size;
    this.restartCombat();
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

  toggleAutoAdvanceBoss(): void {
    if (!this.isSystemUnlocked('auto_boss')) return;
    this.save.autoAdvanceBoss = !this.save.autoAdvanceBoss;
    this.combat.autoSummonBoss = this.save.autoAdvanceBoss;
    this.schedulePersist();
    this.notify();
  }

  toggleAutoSalvage(): void {
    if (!this.isSystemUnlocked('auto_salvage')) return;
    this.save.autoSalvage = !this.save.autoSalvage;
    this.schedulePersist();
    this.toast(`Auto-Salvage Common drops ${this.save.autoSalvage ? 'enabled' : 'disabled'}.`);
    this.notify();
  }

  skipGuide(): void {
    this.save.settings.guideSkipped = true;
    unlockAllSystems(this.save);
    this.ui.whisperOverride = null;
    this.ui.unvisitedTabs = [];
    this.combat.suppressRandomKeys = false;
    this.combat.allowedMonsterIds = undefined;
    this.schedulePersist();
    this.toast('Onboarding guide skipped — all systems unlocked.');
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

  setBar(bar: 'bar_1' | 'bar_2'): void {
    if (bar === 'bar_2' && !this.isSystemUnlocked('bar_2')) return;
    this.save.activeBar = bar;
    this.combat.activeBar = bar;
    this.notify();
  }

  cast(skillId: string): void {
    if (manualCast(this.combat, skillId)) this.notify(true);
    else this.toast('Skill not ready');
  }

  setDoctrine(doctrine: DoctrineId): void {
    if (!this.isSystemUnlocked('doctrines')) return;
    if (this.save.doctrine === doctrine) return;
    if (this.stats.keystones.has('ks_zealots_mandate')) {
      this.toast("Zealot's Mandate locks this doctrine in place.");
      return;
    }
    this.syncCombat();
    this.save.doctrine = doctrine;
    this.restartCombat();
    this.notify();
  }

  unspent(): number {
    return unspentPoints(this.save);
  }

  previewNode(nodeId: string): void {
    if (this.ui.refundMode) {
      this.refundNode(nodeId);
      return;
    }
    if (this.save.allocated.includes(nodeId)) {
      this.ui.previewNode = null;
      this.ui.previewPath = [];
      this.openModal({ kind: 'node', nodeId });
      return;
    }
    const targetNode = skillTree.nodes.find((n) => n.id === nodeId);
    if (targetNode?.kind === 'keystone' && !this.isSystemUnlocked('keystones')) {
      this.toast('Keystones unlock after your first Tier 2 kill.');
      return;
    }
    const check = canAllocate(this.save.allocated, nodeId, treeGraph, this.unspent());
    if (!check.ok) {
      this.ui.previewNode = null;
      this.ui.previewPath = [];
      const reasons: Record<string, string> = {
        excluded: `Locked out by ${check.blockedBy ?? 'a rival keystone'}.`,
        unreachable: 'No path from your allocated tree.',
        'not-enough-points': `Needs ${check.cost} points; you have ${this.unspent()}.`,
        'already-allocated': 'Already allocated.',
      };
      this.toast(reasons[check.reason ?? ''] ?? 'Cannot allocate that node.');
      this.notify();
      return;
    }
    if (
      !this.isSystemUnlocked('keystones') &&
      check.path.some((id) => skillTree.nodes.find((n) => n.id === id)?.kind === 'keystone')
    ) {
      this.toast('Keystones unlock after your first Tier 2 kill.');
      return;
    }
    this.ui.previewNode = nodeId;
    this.ui.previewPath = check.path;
    this.notify();
  }

  confirmAllocation(): void {
    const nodeId = this.ui.previewNode;
    if (!nodeId) return;
    if (
      !this.isSystemUnlocked('keystones') &&
      this.ui.previewPath.some((id) => skillTree.nodes.find((n) => n.id === id)?.kind === 'keystone')
    ) {
      this.toast('Keystones unlock after your first Tier 2 kill.');
      return;
    }
    const result = allocateNode(this.save, nodeId);
    if (!result.ok) {
      this.toast(result.reason === 'not-enough-points' ? 'Not enough points.' : 'Allocation failed.');
      return;
    }
    this.ui.previewNode = null;
    this.ui.previewPath = [];
    this.resyncStats();
    this.restartCombat();
    this.schedulePersist();
    this.toast(`Allocated ${result.path?.length ?? 1} node(s).`);
    this.notify();
  }

  toggleRefundMode(): void {
    this.ui.refundMode = !this.ui.refundMode;
    this.ui.previewNode = null;
    this.ui.previewPath = [];
    this.notify();
  }

  refundNode(nodeId: string): void {
    const result = refundNode(this.save, nodeId);
    if (!result.ok) {
      this.toast(result.reason === 'articulation' ? 'Refunding this node would strand others.' : 'Cannot refund that node.');
      return;
    }
    this.resyncStats();
    this.restartCombat();
    this.schedulePersist();
    this.toast('Point refunded.');
    this.notify();
  }

  articulationPoints(): Set<string> {
    return new Set(getArticulationPoints(this.save.allocated, treeGraph));
  }

  setTreeView(view: TreeView): void {
    this.ui.treeView = view;
    this.notify();
  }

  zoomTree(factor: number): void {
    const view = this.ui.treeView;
    this.ui.treeView = { ...view, scale: Math.max(0.55, Math.min(2.4, view.scale * factor)) };
    this.notify();
  }

  resetTree(): void {
    this.ui.treeView = { x: 0, y: 0, scale: 1 };
    this.notify();
  }

  setBagFilter(filter: BagFilter): void {
    this.ui.bagFilter = filter;
    this.notify();
  }

  selectForge(uid: string): void {
    this.ui.forgeUid = uid;
    this.ui.craftMessage = null;
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
    this.ui.forgeUid = location.item.uid;
    this.resyncStats();
    this.restartCombat();
    this.schedulePersist();
    this.ui.modal = null;
    this.toast('Equipped.');
    this.notify();
  }

  unequip(slot: ItemSlot): void {
    unequipItem(this.save, slot);
    this.resyncStats();
    this.restartCombat();
    this.schedulePersist();
    this.ui.modal = null;
    this.toast('Unequipped.');
    this.notify();
  }

  beginSocket(itemUid: string, socketIndex: number): void {
    const location = this.findItem(itemUid);
    if (!location) return;
    if (location.item.sockets[socketIndex]) {
      this.unsocket(itemUid, socketIndex);
      return;
    }
    if (!this.save.gemStash.length) {
      this.toast('No gems in the pouch.');
      return;
    }
    this.openModal({ kind: 'gem-picker', itemUid, socketIndex });
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
    this.resyncStats();
    this.restartCombat();
    this.schedulePersist();
    this.ui.modal = { kind: 'item', uid: modal.itemUid };
    this.toast('Gem socketed.');
    this.notify();
  }

  unsocket(itemUid: string, socketIndex: number): void {
    const location = this.findItem(itemUid);
    if (!location) return;
    unsocketGem(this.save, location.item, socketIndex);
    this.resyncStats();
    this.restartCombat();
    this.schedulePersist();
    this.toast('Gem returned to the pouch.');
    this.notify();
  }

  cycleGemBar(gem: GemInstance): void {
    if (!this.isSystemUnlocked('bar_2')) return;
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
    if (this.ui.forgeUid === uid) this.ui.forgeUid = this.save.inventory[0]?.uid ?? null;
    this.ui.modal = null;
    this.schedulePersist();
    this.toast(`Salvaged for ${gain.scrap} scrap and ${gain.flux} flux.`);
    this.notify();
  }

  craft(action: 'upgrade' | 'reforge' | 'socket' | 'corrupt' | 'promote'): void {
    if (action !== 'upgrade' && !this.isSystemUnlocked('forge_full')) {
      this.toast('Unlocks after your first Tier 2 kill.');
      return;
    }
    const item = this.forgeItem();
    if (!item) {
      this.toast('Select an item on the anvil first.');
      return;
    }
    const result =
      action === 'upgrade'
        ? upgradeItem(this.save, item)
        : action === 'reforge'
          ? reforgeItem(this.save, item)
          : action === 'socket'
            ? addSocket(this.save, item)
            : action === 'corrupt'
              ? corruptItem(this.save, item)
              : promoteRarity(this.save, item);
    this.ui.craftMessage = result.message;
    if (result.ok) {
      this.resyncStats();
      this.restartCombat();
      this.schedulePersist();
    }
    this.toast(result.message);
    this.notify();
  }

  claimOffline(): void {
    if (!this.offline) return;
    const prevUnlocked = new Set(this.save.unlockedSystems);
    const unlocked = claimOffline(this.save, this.offline);
    this.offline = null;
    this.ui.modal = null;
    this.lastLevel = this.save.level;
    this.markNewlyUnlockedTabs(prevUnlocked);
    this.resyncStats();
    this.restartCombat();
    if (unlocked.length) this.announceUnlocks(unlocked);
    this.schedulePersist();
    this.toast('Offline spoils claimed.');
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
    tickCombat(this.combat);
    tickCombat(this.combat);
    this.ui.lastTickAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      this.combat.tickCount % 5 === 0 ||
      this.combat.rewards.kills !== this.appliedRewards.kills ||
      this.combat.rewards.deaths !== this.appliedRewards.deaths
    ) {
      this.syncCombat();
    }
    if (this.combat.status === 'victory' && !this.victorySynced) {
      this.victorySynced = true;
      this.syncCombat();
      this.toast(`Tier cleared. Tier ${this.combat.tier} stands open.`);
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
    return itemBase(item).name;
  }

  baseNameOf(uid: string): string {
    const item = this.findItem(uid)?.item;
    return item ? itemBase(item).name : '';
  }

  baseAssetOf(uid: string): string {
    const item = this.findItem(uid)?.item;
    return item ? itemBaseById.get(item.baseId)?.assetId ?? '' : '';
  }
}
