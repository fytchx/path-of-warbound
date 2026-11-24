import type { DoctrineId, ItemSlot } from '../data/types';
import { itemBaseById, monsterById, skillTree } from '../data';
import {
  buildTreeGraph,
  canAllocate,
  getArticulationPoints,
} from '../engine/treeGraph';
import {
  createCombat,
  manualCast,
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
  loadSave,
  persistSave,
  refundNode,
  salvageItem,
  socketGem,
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

export interface UIState {
  screen: ScreenId;
  modal: ModalState | null;
  paused: boolean;
  toast: { id: number; text: string } | null;
  previewNode: string | null;
  previewPath: string[];
  refundMode: boolean;
  bagFilter: BagFilter;
  forgeUid: string | null;
  treeView: TreeView;
  craftMessage: string | null;
}

export interface ItemLocation {
  item: ItemInstance;
  slot?: ItemSlot;
}

const treeGraph = buildTreeGraph(skillTree);
let toastId = 0;

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
      previewNode: null,
      previewPath: [],
      refundMode: false,
      bagFilter: 'all',
      forgeUid: this.save.equipment.main_hand?.uid ?? this.save.inventory[0]?.uid ?? null,
      treeView: { x: 0, y: 0, scale: 1 },
      craftMessage: null,
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

  private buildCombat(): CombatState {
    return createCombat({
      seed: Math.floor(Math.random() * 1_000_000),
      zoneId: this.save.zoneId,
      tier: this.save.tier,
      packSize: this.save.packSize,
      doctrine: this.save.doctrine,
      activeBar: this.save.activeBar,
      startingKeys: this.save.keys,
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

  private syncCombat(): void {
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
    if (Object.values(delta).some((value) => value !== 0)) {
      applyCombatRewards(this.save, delta);
      this.appliedRewards = { ...rewards };
    }
    this.save.keys = this.combat.keys;
    this.save.tier = this.combat.tier;
    if (this.save.level !== this.lastLevel) {
      this.lastLevel = this.save.level;
      this.resyncStats();
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
    this.ui.screen = screen;
    this.ui.modal = null;
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
    const size = Math.max(1, Math.min(5, this.save.packSize + delta)) as CharacterSave['packSize'];
    if (size === this.save.packSize) return;
    this.save.packSize = size;
    this.restartCombat();
    this.notify();
  }

  togglePause(): void {
    this.ui.paused = !this.ui.paused;
    this.notify();
  }

  setBar(bar: 'bar_1' | 'bar_2'): void {
    this.save.activeBar = bar;
    this.combat.activeBar = bar;
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
    this.ui.previewNode = nodeId;
    this.ui.previewPath = check.path;
    this.notify();
  }

  confirmAllocation(): void {
    const nodeId = this.ui.previewNode;
    if (!nodeId) return;
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
    claimOffline(this.save, this.offline);
    this.offline = null;
    this.ui.modal = null;
    this.resyncStats();
    this.restartCombat();
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
    if (this.combat.tickCount % 5 === 0) this.syncCombat();
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
