import { keystones, skillTree } from '../../data';
import type { TreeNode } from '../../data/types';
import { pathTo, buildTreeGraph } from '../../engine/treeGraph';
import type { GameStore, TreeFocus } from '../store';
import { escapeHtml, fmt, statLabel } from '../dom';

export const TREE_VIEW = { w: 390, h: 356 };

const treeGraph = buildTreeGraph(skillTree);
const nodeByIdMap = new Map<string, TreeNode>(skillTree.nodes.map((node) => [node.id, node]));

const SECTOR_COLOR: Record<string, string> = {
  might: '#D9383A',
  agility: '#38B864',
  wisdom: '#2E7BE6',
  fortitude: '#D4AF37',
  core: '#9B51E0',
};

const SECTORS: { id: TreeFocus; label: string; color?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'might', label: 'Might', color: SECTOR_COLOR.might },
  { id: 'agility', label: 'Agility', color: SECTOR_COLOR.agility },
  { id: 'wisdom', label: 'Wisdom', color: SECTOR_COLOR.wisdom },
  { id: 'fortitude', label: 'Fort', color: SECTOR_COLOR.fortitude },
];

export function formatNodeName(name: string): string {
  return name.replace(/(^|\s)([a-z])/g, (_, prefix: string, ch: string) => `${prefix}${ch.toUpperCase()}`);
}

function isGenericDescription(node: TreeNode): boolean {
  if (node.kind === 'hub' || node.kind === 'keystone' || node.kind === 'socket' || node.kind === 'notable') {
    return false;
  }
  return /^(A branching |Minor |A ring of )/i.test(node.description.trim());
}

function nodeRadius(node: TreeNode): number {
  switch (node.kind) {
    case 'hub':
      return 21;
    case 'keystone':
      return 16;
    case 'notable':
      return 12.5;
    case 'socket':
      return 10;
    default:
      return 7.5;
  }
}

function symbolFor(node: TreeNode): string {
  switch (node.kind) {
    case 'hub':
      return 'w-medal';
    case 'keystone':
      return 'w-n-key';
    case 'notable':
      return 'w-n-notable';
    case 'socket':
      return 'w-n-socket';
    default:
      return 'w-n-minor';
  }
}

function starterSector(store: GameStore): string | null {
  switch (store.save.starterArchetype) {
    case 'melee':
      return 'might';
    case 'dot':
      return 'agility';
    case 'spell':
      return 'wisdom';
    default:
      return null;
  }
}

function reachableFrontier(allocated: Set<string>): Set<string> {
  const frontier = new Set<string>();
  for (const [a, b] of skillTree.edges) {
    if (allocated.has(a) && !allocated.has(b)) frontier.add(b);
    if (allocated.has(b) && !allocated.has(a)) frontier.add(a);
  }
  return frontier;
}

function sectorCentroids(): Map<string, { x: number; y: number }> {
  const groups = new Map<string, { x: number; y: number; count: number }>();
  for (const node of skillTree.nodes) {
    if (!SECTOR_COLOR[node.sector] || node.sector === 'core') continue;
    const group = groups.get(node.sector) ?? { x: 0, y: 0, count: 0 };
    group.x += node.x;
    group.y += node.y;
    group.count += 1;
    groups.set(node.sector, group);
  }
  const out = new Map<string, { x: number; y: number }>();
  for (const [sector, g] of groups.entries()) {
    out.set(sector, { x: g.x / g.count, y: g.y / g.count });
  }
  return out;
}

const CENTROIDS = sectorCentroids();

function summarizeNodesMods(nodeIds: string[]): string[] {
  const sums = new Map<string, number>();
  for (const id of nodeIds) {
    const node = nodeByIdMap.get(id);
    if (!node) continue;
    for (const mod of node.mods) {
      const key = `${mod.layer}:${mod.stat}`;
      sums.set(key, (sums.get(key) ?? 0) + mod.value);
    }
  }
  return [...sums.entries()].map(([key, val]) => {
    const [layer, stat] = key.split(':');
    const unit = layer === 'more' ? '% more' : layer === 'increased' ? '%' : '';
    return `+${fmt(val, 1)}${unit} ${statLabel(stat ?? '')}`;
  });
}

function closestGoals(store: GameStore, allocated: Set<string>): { node: TreeNode; cost: number }[] {
  const frontier = reachableFrontier(allocated);
  const focus = store.ui.treeFocus;
  const candidates = skillTree.nodes.filter(
    (node) =>
      !allocated.has(node.id) &&
      (node.kind === 'notable' || node.kind === 'keystone' || node.kind === 'socket' || frontier.has(node.id)) &&
      !(node.excludes ?? []).some((id) => allocated.has(id)),
  );
  const filtered =
    focus === 'all' ? candidates : candidates.filter((node) => node.sector === focus);
  const pool = filtered.length >= 2 ? filtered : candidates;

  return pool
    .map((node) => ({
      node,
      path: pathTo(store.save.allocated, node.id, treeGraph),
    }))
    .filter((entry): entry is { node: TreeNode; path: string[] } => Boolean(entry.path && entry.path.length > 0))
    .sort((a, b) => {
      const rank = (n: TreeNode) => (n.kind === 'notable' ? 0 : n.kind === 'socket' ? 1 : n.kind === 'keystone' ? 2 : 3);
      if (a.path.length !== b.path.length) return a.path.length - b.path.length;
      return rank(a.node) - rank(b.node);
    })
    .slice(0, 4)
    .map((entry) => ({ node: entry.node, cost: entry.path.length }));
}

export function treeTransformCss(store: GameStore): string {
  const { x, y, scale } = store.ui.treeView;
  return `translate(${(TREE_VIEW.w / 2 + x).toFixed(1)}px, ${(TREE_VIEW.h / 2 + y).toFixed(1)}px) scale(${scale.toFixed(4)})`;
}

export function treeBackdropMarkup(activeFocus: TreeFocus): string {
  const rings = `
    <circle r="196" fill="none" stroke="rgba(109,95,46,0.14)" stroke-width="1" />
    <circle r="144" fill="none" stroke="rgba(109,95,46,0.16)" stroke-width="1" />
    <circle r="92" fill="none" stroke="rgba(109,95,46,0.12)" stroke-width="1" stroke-dasharray="3 4" />
    <circle r="50" fill="none" stroke="rgba(212,175,55,0.18)" stroke-width="1" />`;

  const auras = [...CENTROIDS.entries()]
    .map(([sector, c]) => {
      const focused = activeFocus === sector;
      const dimmed = activeFocus !== 'all' && !focused;
      return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${focused ? 112 : 90}" fill="${SECTOR_COLOR[sector]}" fill-opacity="${focused ? '0.13' : dimmed ? '0.02' : '0.055'}" pointer-events="none" />`;
    })
    .join('');

  return rings + auras;
}

export function treeEdgesMarkup(store: GameStore): string {
  const ui = store.ui;
  const allocated = new Set(store.save.allocated);
  const preview = new Set(ui.previewPath);
  const highlighted = new Set([...allocated, ...preview]);
  const focus = ui.treeFocus;

  return skillTree.edges
    .map(([a, b]) => {
      const from = nodeByIdMap.get(a);
      const to = nodeByIdMap.get(b);
      if (!from || !to) return '';
      const both = highlighted.has(a) && highlighted.has(b);
      const previewEdge =
        (preview.has(a) && (allocated.has(b) || preview.has(b))) ||
        (preview.has(b) && allocated.has(a));
      const inFocus =
        focus === 'all' ||
        from.sector === focus ||
        to.sector === focus ||
        both ||
        previewEdge;
      const cls = [
        'tree-edge',
        previewEdge ? 'preview' : both ? 'allocated' : '',
        !inFocus ? 'dimmed' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<line class="${cls}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
    })
    .join('');
}

export function treeNodesMarkup(store: GameStore): string {
  const ui = store.ui;
  const allocated = new Set(store.save.allocated);
  const preview = new Set(ui.previewPath);
  const frontier = reachableFrontier(allocated);
  const articulation = ui.refundMode ? store.articulationPoints() : new Set<string>();
  const activeSector = starterSector(store);
  const focus = ui.treeFocus;

  return skillTree.nodes
    .map((node) => {
      const radius = nodeRadius(node);
      const isAllocated = allocated.has(node.id);
      const isPreview = preview.has(node.id);
      const isSelected = ui.previewNode === node.id;
      const isReachable = frontier.has(node.id) && !isAllocated;
      const isExcluded = (node.excludes ?? []).some((id) => allocated.has(id));
      const isStranded = articulation.has(node.id);
      const isStarterHint = Boolean(activeSector && node.sector === activeSector && isReachable && !isExcluded);
      const inFocus =
        focus === 'all' ||
        node.sector === focus ||
        node.sector === 'core' ||
        isAllocated ||
        isPreview ||
        isSelected;

      const color =
        node.kind === 'keystone'
          ? '#9B51E0'
          : node.kind === 'socket'
            ? '#38D6E8'
            : SECTOR_COLOR[node.sector] ?? '#D4AF37';

      const classes = [
        'tree-node',
        node.kind,
        isAllocated ? 'allocated' : '',
        isPreview ? 'preview' : '',
        isSelected ? 'selected' : '',
        isReachable ? 'reachable' : '',
        isExcluded ? 'excluded' : '',
        isStranded ? 'stranded' : '',
        isStarterHint ? 'starter-branch' : '',
        !inFocus ? 'dimmed' : '',
      ]
        .filter(Boolean)
        .join(' ');

      const glyphStyle = `--g:${color};--fill:${isAllocated ? '#3b2e10' : isReachable ? '#182135' : '#0B0E16'}`;
      const hitRadius = Math.max(20, radius + 9);
      const cleanName = formatNodeName(node.name);

      return `<g class="${classes}" transform="translate(${node.x} ${node.y})" data-action="node" data-node="${node.id}" role="button" tabindex="0" aria-label="${escapeHtml(cleanName)}">
        <circle r="${hitRadius}" fill="transparent" />
        ${isSelected ? `<circle class="node-select-ring" r="${radius + 5.5}" fill="none" stroke="#f0d078" stroke-width="1.6" />` : ''}
        ${isReachable && !isExcluded ? `<circle r="${radius + 3.2}" fill="none" stroke="${color}" stroke-opacity="0.65" stroke-width="1.2" stroke-dasharray="2.5 2.5" />` : ''}
        <use href="#${symbolFor(node)}" x="${-radius}" y="${-radius}" width="${radius * 2}" height="${radius * 2}" class="node-glyph" style="${glyphStyle}" />
      </g>`;
    })
    .join('');
}

export function treeLabelsMarkup(store: GameStore): string {
  const ui = store.ui;
  const allocated = new Set(store.save.allocated);
  const preview = new Set(ui.previewPath);
  const activeSector = starterSector(store);
  const focus = ui.treeFocus;
  const scale = ui.treeView.scale;

  const sectorMarkup = [...CENTROIDS.entries()]
    .map(([sector, group]) => {
      const angle = Math.atan2(group.y, group.x);
      const lx = Math.max(-154, Math.min(154, Math.cos(angle) * 168));
      const ly = Math.max(-158, Math.min(158, Math.sin(angle) * 168));
      const dimmed = focus !== 'all' && focus !== sector;
      return `<text class="tree-sector-label${sector === activeSector ? ' starter' : ''}${dimmed ? ' dimmed' : ''}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${SECTOR_COLOR[sector]}">${sector.toUpperCase()}</text>`;
    })
    .join('');

  const nodeLabelMarkup = skillTree.nodes
    .filter((node) => {
      if (ui.previewNode === node.id) return true;
      if (node.kind === 'keystone') {
        return focus === 'all' || focus === node.sector || allocated.has(node.id) || preview.has(node.id) || scale >= 1.15;
      }
      if (node.kind === 'notable') {
        return allocated.has(node.id) || preview.has(node.id) || focus === node.sector || scale >= 1.35;
      }
      return false;
    })
    .map((node) => {
      const isAllocated = allocated.has(node.id);
      const isSelected = ui.previewNode === node.id;
      const offsetY = node.y + nodeRadius(node) + 12;
      const cls = [
        'tree-node-label',
        isAllocated ? 'allocated' : '',
        isSelected ? 'selected' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `<text class="${cls}" x="${node.x}" y="${offsetY.toFixed(1)}">${escapeHtml(formatNodeName(node.name))}</text>`;
    })
    .join('');

  return sectorMarkup + nodeLabelMarkup;
}

export function treeHeaderMetaMarkup(store: GameStore): string {
  const spentCount = store.save.allocated.filter((id) => id !== 'hub_0').length;
  return `<b class="gold">${store.unspent()} free</b> · ${spentCount} spent`;
}

export function treeFocusRowMarkup(store: GameStore): string {
  return SECTORS.map(
    (s) =>
      `<button role="tab" aria-selected="${store.ui.treeFocus === s.id}" class="focus-chip ${store.ui.treeFocus === s.id ? 'on' : ''}" data-action="tree-focus" data-sector="${s.id}" ${s.color ? `style="--fc:${s.color}"` : ''}>${s.label}</button>`,
  ).join('');
}

export function treeControlsMarkup(store: GameStore): string {
  const spentCount = store.save.allocated.filter((id) => id !== 'hub_0').length;
  const fee = store.respecFee();
  return `<button class="gbtn ${store.ui.refundMode ? 'on' : ''}" data-action="tree-refund">${store.ui.refundMode ? 'REFUND: ON' : 'REFUND NODE'}</button>
    <button class="gbtn" data-action="open-respec" ${spentCount === 0 ? 'disabled' : ''}>RESPEC ALL · ${fee === 0 ? 'FREE' : `${fmt(fee)}g`}</button>`;
}

export function treeDockMarkup(store: GameStore): string {
  const ui = store.ui;
  const allocated = new Set(store.save.allocated);
  const articulation = store.articulationPoints();
  const previewNode = ui.previewNode ? nodeByIdMap.get(ui.previewNode) ?? null : null;
  const previewCost = ui.previewPath.length;
  const spentCount = store.save.allocated.filter((id) => id !== 'hub_0').length;
  const activeTab = ui.treeTab;

  let dockContent = '';
  if (activeTab === 'inspect') {
    if (previewNode) {
      const cleanName = formatNodeName(previewNode.name);
      const isHub = previewNode.id === 'hub_0';
      const isAllocated = allocated.has(previewNode.id) || isHub;
      const isRequired = !isHub && isAllocated && articulation.has(previewNode.id);
      const excludedById = (previewNode.excludes ?? []).find((id) => allocated.has(id));
      const excludedByName = excludedById ? formatNodeName(nodeByIdMap.get(excludedById)?.name ?? excludedById) : '';
      const nodeMods = summarizeNodesMods([previewNode.id]);
      const pathMods = !isAllocated && previewCost > 1 ? summarizeNodesMods(ui.previewPath) : [];

      const statusBadge = isHub
        ? '<span class="gold">CORE</span>'
        : isAllocated
          ? '<span class="gold">ALLOCATED</span>'
          : excludedById
            ? '<span class="muted">LOCKED</span>'
            : `<span class="gold">${previewCost} pt${previewCost === 1 ? '' : 's'}</span>`;

      let actionBtn = '';
      if (isHub) {
        actionBtn = '<button class="gbtn" disabled>Soul-Spark Core (Always Active)</button>';
      } else if (isAllocated) {
        actionBtn = `<button class="gbtn" data-action="refund" data-node="${previewNode.id}" ${isRequired ? 'disabled' : ''}>${isRequired ? 'Required by Connected Nodes' : 'Refund Point'}</button>`;
      } else if (excludedById) {
        actionBtn = `<button class="gbtn" disabled>Locked by ${escapeHtml(excludedByName)}</button>`;
      } else if (previewCost === 0) {
        actionBtn = '<button class="gbtn" disabled>Unreachable</button>';
      } else if (store.unspent() < previewCost) {
        actionBtn = `<button class="gbtn" disabled>Need ${previewCost} pts (${store.unspent()} free)</button>`;
      } else {
        actionBtn = `<button class="gbtn on" data-action="allocate">Allocate (${previewCost} pt${previewCost === 1 ? '' : 's'})</button>`;
      }

      dockContent = `<div class="frame pan tree-dock-card">
        <h4>
          <span>${escapeHtml(cleanName)} <small class="muted">(${escapeHtml(previewNode.sector)} · ${escapeHtml(previewNode.kind)})</small></span>
          ${statusBadge}
        </h4>
        ${!isGenericDescription(previewNode) ? `<p class="tiny muted" style="line-height:1.4;margin-bottom:4px">${escapeHtml(previewNode.description)}</p>` : ''}
        ${nodeMods.length ? `<div class="tree-gain-list">${nodeMods.map((l) => `<span class="gain-chip">${escapeHtml(l)}</span>`).join('')}</div>` : ''}
        ${pathMods.length ? `<div class="tree-path-head">Path Total (${previewCost} nodes)</div><div class="tree-gain-list">${pathMods.map((l) => `<span class="gain-chip path">${escapeHtml(l)}</span>`).join('')}</div>` : ''}
        <div class="tree-dock-actions">${actionBtn}</div>
      </div>`;
    } else {
      const suggestions = closestGoals(store, allocated);
      dockContent = `<div class="frame pan tree-dock-card">
        <h4>Suggested Paths<span>${store.unspent()} point${store.unspent() === 1 ? '' : 's'} ready</span></h4>
        <p class="tiny muted" style="margin-bottom:6px">Drag to pan, pinch or scroll to zoom. Tap any node to inspect or focus below.</p>
        <div class="tree-suggest-grid">
          ${suggestions
            .map(({ node, cost }) => {
              const color = SECTOR_COLOR[node.sector] ?? '#D4AF37';
              const firstMod = summarizeNodesMods([node.id])[0] ?? `${node.sector} · ${node.kind}`;
              return `<button class="tree-suggest-btn" data-action="node" data-node="${node.id}" data-pan="1" style="--c:${color}">
                <div class="suggest-top">
                  <b>${escapeHtml(formatNodeName(node.name))}</b>
                  <span class="suggest-cost">${cost} pt</span>
                </div>
                <span>${escapeHtml(firstMod)}</span>
              </button>`;
            })
            .join('')}
        </div>
      </div>`;
    }
  } else if (activeTab === 'keystones') {
    dockContent = `<div class="frame pan tree-dock-card">
      <h4>Keystones<span>8 · choose 1 per pair</span></h4>
      ${keystones
        .map((keystone) => {
          const owned = allocated.has(keystone.id);
          const partnerId = (keystone.excludes ?? [])[0];
          const partnerName = partnerId ? formatNodeName(nodeByIdMap.get(partnerId)?.name ?? partnerId) : '';
          const blocked = (keystone.excludes ?? []).some((id) => allocated.has(id));
          return `<button class="ksrow" data-action="node" data-node="${keystone.id}" data-pan="1">
            <span>
              <span class="gold" style="display:block;font-size:11px;font-weight:700">${escapeHtml(formatNodeName(keystone.name))}</span>
              <span class="tiny muted">${owned ? 'Allocated — tap to locate' : blocked ? `Locked by ${escapeHtml(partnerName)}` : escapeHtml(keystone.description)}</span>
            </span>
            <span class="tiny" style="color:${owned ? 'var(--gold-hi)' : 'var(--mute)'}">${owned ? 'ACTIVE' : blocked ? 'LOCKED' : 'Locate'}</span>
          </button>`;
        })
        .join('')}
    </div>`;
  } else {
    const allocatedIds = store.save.allocated.filter((id) => id !== 'hub_0');
    const summaryLines = summarizeNodesMods(allocatedIds);
    dockContent = `<div class="frame pan tree-dock-card">
      <h4>Active Tree Totals<span>${spentCount} node${spentCount === 1 ? '' : 's'} bound</span></h4>
      ${summaryLines.length
        ? `<div class="tree-summary-list">${summaryLines.map((line) => `<div class="affix-line"><span class="affix-name">${escapeHtml(line)}</span></div>`).join('')}</div>`
        : '<div class="tiny muted">No passive nodes allocated yet. Tap any dashed ring around the center Soul-Spark to begin.</div>'}
    </div>`;
  }

  return `<div class="subtabs" role="tablist" aria-label="Tree details">
      <button role="tab" aria-selected="${activeTab === 'inspect'}" class="subtab ${activeTab === 'inspect' ? 'on' : ''}" data-action="tree-tab" data-tab="inspect">Inspector</button>
      <button role="tab" aria-selected="${activeTab === 'keystones'}" class="subtab ${activeTab === 'keystones' ? 'on' : ''}" data-action="tree-tab" data-tab="keystones">Keystones (8)</button>
      <button role="tab" aria-selected="${activeTab === 'summary'}" class="subtab ${activeTab === 'summary' ? 'on' : ''}" data-action="tree-tab" data-tab="summary">Bonuses (${spentCount})</button>
    </div>
    ${dockContent}`;
}

export function treeScreen(store: GameStore): string {
  const ui = store.ui;

  return `<section class="screen" data-screen="tree" aria-label="Skill Tree">
    <div class="sub-h">
      <h2>WARBOUND TREE</h2>
      <span class="tiny" data-tree-points>${treeHeaderMetaMarkup(store)}</span>
    </div>

    <div class="tree-focus-row" role="tablist" aria-label="Sector focus">
      ${treeFocusRowMarkup(store)}
    </div>

    <div class="frame tree" data-tree>
      <svg class="tree-svg" viewBox="0 0 ${TREE_VIEW.w} ${TREE_VIEW.h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Skill tree">
        <g class="tree-viewport" style="transform:${treeTransformCss(store)}">
          <g class="tree-backdrop-layer">${treeBackdropMarkup(ui.treeFocus)}</g>
          <g class="tree-edges-layer">${treeEdgesMarkup(store)}</g>
          <g class="tree-nodes-layer">${treeNodesMarkup(store)}</g>
          <g class="tree-labels-layer" pointer-events="none">${treeLabelsMarkup(store)}</g>
        </g>
      </svg>
      <div class="tree-zoom-hud">
        <button class="icon-btn small" data-action="tree-zoom-out" aria-label="Zoom out">−</button>
        <button class="tree-zoom-pct" data-action="tree-reset" aria-label="Reset view">${Math.round(ui.treeView.scale * 100)}%</button>
        <button class="icon-btn small" data-action="tree-zoom-in" aria-label="Zoom in">+</button>
      </div>
      <div class="banner tree-refund-banner" ${ui.refundMode ? '' : 'hidden'}>Refund mode · tap a gold node</div>
    </div>

    <div class="tree-controls">
      ${treeControlsMarkup(store)}
    </div>

    <div id="tree-dock" class="tree-dock">${treeDockMarkup(store)}</div>
  </section>`;
}
