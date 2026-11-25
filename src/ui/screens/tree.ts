import { keystones, skillTree } from '../../data';
import type { TreeNode } from '../../data/types';
import type { GameStore } from '../store';
import { escapeHtml, fmt, statLabel } from '../dom';

const VIEW = { w: 390, h: 430 };
const SECTOR_COLOR: Record<string, string> = {
  might: '#D9383A',
  agility: '#38B864',
  wisdom: '#2E7BE6',
  fortitude: '#D4AF37',
  core: '#9B51E0',
};

function nodeRadius(node: TreeNode): number {
  switch (node.kind) {
    case 'hub':
      return 22;
    case 'keystone':
      return 17;
    case 'notable':
      return 13;
    case 'socket':
      return 10;
    default:
      return 8;
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

function nodesNearHub(sector: string, maxHops = 2): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const [a, b] of skillTree.edges) {
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  }
  const distance = new Map<string, number>([['hub_0', 0]]);
  const queue = ['hub_0'];
  while (queue.length) {
    const id = queue.shift()!;
    const d = distance.get(id)!;
    if (d >= maxHops) continue;
    for (const next of adjacency.get(id) ?? []) {
      if (!distance.has(next)) {
        distance.set(next, d + 1);
        queue.push(next);
      }
    }
  }
  return new Set(
    skillTree.nodes
      .filter((node) => node.sector === sector && (distance.get(node.id) ?? Infinity) <= maxHops)
      .map((node) => node.id),
  );
}

function sectorLabels(active: string | null): string {
  const groups = new Map<string, { x: number; y: number; count: number }>();
  for (const node of skillTree.nodes) {
    if (!SECTOR_COLOR[node.sector] || node.sector === 'core') continue;
    const group = groups.get(node.sector) ?? { x: 0, y: 0, count: 0 };
    group.x += node.x;
    group.y += node.y;
    group.count += 1;
    groups.set(node.sector, group);
  }
  return [...groups.entries()]
    .map(([sector, group]) => {
      const angle = Math.atan2(group.y / group.count, group.x / group.count);
      const lx = Math.max(-150, Math.min(150, Math.cos(angle) * 178));
      const ly = Math.max(-188, Math.min(188, Math.sin(angle) * 178));
      return `<text class="tree-sector-label${sector === active ? ' starter' : ''}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${SECTOR_COLOR[sector]}">${sector.toUpperCase()}</text>`;
    })
    .join('');
}

function cumulativePreviewSummary(pathIds: string[]): string {
  const sums = new Map<string, number>();
  for (const id of pathIds) {
    const node = skillTree.nodes.find((n) => n.id === id);
    if (!node) continue;
    for (const mod of node.mods) {
      const key = `${mod.layer}:${mod.stat}`;
      sums.set(key, (sums.get(key) ?? 0) + mod.value);
    }
  }
  if (!sums.size) return '';
  return [...sums.entries()]
    .map(([key, val]) => {
      const [layer, stat] = key.split(':');
      const unit = layer === 'more' ? '% more' : layer === 'increased' ? '%' : '';
      return `+${fmt(val, 1)}${unit} ${statLabel(stat ?? '')}`;
    })
    .join(' · ');
}

export function treeScreen(store: GameStore): string {
  const ui = store.ui;
  const allocated = new Set(store.save.allocated);
  const preview = new Set(ui.previewPath);
  const articulation = ui.refundMode ? store.articulationPoints() : new Set<string>();
  const highlighted = new Set([...allocated, ...preview]);
  const activeSector = starterSector(store);
  const starterBranch = activeSector ? nodesNearHub(activeSector) : new Set<string>();
  const previewNode = ui.previewNode ? skillTree.nodes.find((n) => n.id === ui.previewNode) ?? null : null;
  const previewCost = ui.previewPath.length;
  const previewTotals = previewCost > 0 ? cumulativePreviewSummary(ui.previewPath) : '';

  const edgeMarkup = skillTree.edges
    .map(([a, b]) => {
      const from = skillTree.nodes.find((n) => n.id === a);
      const to = skillTree.nodes.find((n) => n.id === b);
      if (!from || !to) return '';
      const both = highlighted.has(a) && highlighted.has(b);
      const previewEdge = (preview.has(a) && (allocated.has(b) || preview.has(b))) || (preview.has(b) && allocated.has(a));
      const cls = previewEdge ? 'preview' : both ? 'allocated' : '';
      return `<line class="tree-edge ${cls}" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" />`;
    })
    .join('');

  const nodeObstacles = skillTree.nodes.map((node) => ({
    id: node.id,
    x: node.x,
    y: node.y,
    half: nodeRadius(node) + 2,
    halfH: nodeRadius(node) + 2,
  }));
  const sectorGroups = new Map<string, { x: number; y: number; count: number }>();
  for (const node of skillTree.nodes) {
    if (!SECTOR_COLOR[node.sector] || node.sector === 'core') continue;
    const group = sectorGroups.get(node.sector) ?? { x: 0, y: 0, count: 0 };
    group.x += node.x;
    group.y += node.y;
    group.count += 1;
    sectorGroups.set(node.sector, group);
  }
  const sectorObstacles = [...sectorGroups.entries()].map(([sector, group]) => {
    const angle = Math.atan2(group.y / group.count, group.x / group.count);
    return {
      x: Math.max(-150, Math.min(150, Math.cos(angle) * 178)),
      y: Math.max(-188, Math.min(188, Math.sin(angle) * 178)),
      half: sector.length * 4.6,
      halfH: 8,
    };
  });

  const labelSlots: { x: number; y: number; half: number }[] = [];
  const labelYFor = (node: TreeNode, radius: number): number => {
    const half = (node.name.length * 4.9) / 2 + 3;
    let best = radius + 16;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const offset of [radius + 16, radius + 28, radius + 40, radius + 52]) {
      const y = node.y + offset;
      const glyphs = nodeObstacles.filter(
        (box) => box.id !== node.id && Math.abs(box.x - node.x) < box.half + half && Math.abs(box.y - y) < box.halfH + 9,
      ).length;
      const sectors = sectorObstacles.filter(
        (box) => Math.abs(box.x - node.x) < box.half + half && Math.abs(box.y - y) < box.halfH + 9,
      ).length;
      const slots = labelSlots.filter(
        (slot) => Math.abs(slot.x - node.x) < slot.half + half && Math.abs(slot.y - y) < 14,
      ).length;
      const score = glyphs * 2 + sectors * 2 + slots * 3;
      if (score < bestScore) {
        best = offset;
        bestScore = score;
      }
    }
    labelSlots.push({ x: node.x, y: node.y + best, half });
    return best;
  };

  const nodeMarkup = skillTree.nodes
    .map((node) => {
      const radius = nodeRadius(node);
      const isAllocated = allocated.has(node.id);
      const isPreview = preview.has(node.id);
      const isExcluded = (node.excludes ?? []).some((id) => allocated.has(id));
      const isStranded = articulation.has(node.id);
      const color = node.kind === 'keystone' ? '#9B51E0' : node.kind === 'socket' ? '#38D6E8' : SECTOR_COLOR[node.sector] ?? '#D4AF37';
      const classes = ['tree-node', node.kind, isAllocated ? 'allocated' : '', isPreview ? 'preview' : '', isExcluded ? 'excluded' : '', isStranded ? 'stranded' : '', starterBranch.has(node.id) ? 'starter-branch' : ''].join(' ');
      const showLabel = node.kind === 'keystone' || (node.kind === 'notable' && (isAllocated || preview.has(node.id)));
      const label = showLabel ? `<text class="tree-node-label" y="${labelYFor(node, radius)}">${escapeHtml(node.name)}</text>` : '';
      const glyphStyle = `--g:${color};--fill:${isAllocated ? '#2a2312' : '#0B0E16'}`;
      const hitRadius = Math.max(22, radius + 10);
      return `<g class="${classes}" transform="translate(${node.x} ${node.y})" data-action="node" data-node="${node.id}" role="button" tabindex="0" aria-label="${escapeHtml(node.name)}">
        <circle r="${hitRadius}" fill="transparent" />
        <use href="#${symbolFor(node)}" x="${-radius}" y="${-radius}" width="${radius * 2}" height="${radius * 2}" class="node-glyph" style="${glyphStyle}" />
        ${label}
      </g>`;
    })
    .join('');

  return `<section class="screen" data-screen="tree" aria-label="Skill Tree">
    <div class="sub-h">
      <h2>WARBOUND TREE</h2>
      <span class="tiny muted">${store.save.allocated.filter((id) => id !== 'hub_0').length} allocated · ${store.unspent()} free</span>
    </div>

    <div class="tree-controls">
      <button class="gbtn ${ui.refundMode ? 'on' : ''}" data-action="tree-refund">${ui.refundMode ? 'REFUND ON' : 'REFUND'}</button>
      <button class="gbtn" data-action="tree-zoom-out" aria-label="Zoom out">−</button>
      <button class="gbtn" data-action="tree-reset" aria-label="Reset view">${(ui.treeView.scale * 100).toFixed(0)}%</button>
      <button class="gbtn" data-action="tree-zoom-in" aria-label="Zoom in">+</button>
    </div>

    <div class="frame tree" data-tree>
      <svg class="tree-svg" viewBox="0 0 ${VIEW.w} ${VIEW.h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Skill tree">
        <g transform="translate(${VIEW.w / 2 + ui.treeView.x} ${VIEW.h / 2 + ui.treeView.y}) scale(${ui.treeView.scale})">
          <circle r="210" fill="none" stroke="rgba(109,95,46,0.18)" stroke-width="1" />
          <circle r="150" fill="none" stroke="rgba(109,95,46,0.12)" stroke-width="1" />
          ${edgeMarkup}
          ${nodeMarkup}
          ${sectorLabels(activeSector)}
        </g>
      </svg>
      ${ui.refundMode ? '<div class="banner" style="top:auto;bottom:6px">Refund mode · red nodes would strand others</div>' : ''}
    </div>

    <p class="hint">Drag to pan · pinch or +/− to zoom · tap once to preview, tap again to allocate</p>

    ${previewNode
      ? `<div class="frame pan">
          <h4>${escapeHtml(previewNode.name)}<span class="gold">${previewCost} pt${previewCost === 1 ? '' : 's'}</span></h4>
          <p class="tiny muted" style="line-height:1.4">${escapeHtml(previewNode.description)}</p>
          ${previewTotals ? `<p class="tiny gold" style="margin-top:4px">${escapeHtml(previewTotals)}</p>` : ''}
          <div style="margin-top:6px"><button class="gbtn" data-action="allocate" ${store.unspent() < previewCost ? 'disabled' : ''}>Confirm (${previewCost} pt${previewCost === 1 ? '' : 's'})</button></div>
        </div>`
      : '<div class="frame pan"><p class="tiny muted">Tap any unallocated node to preview the shortest path and cumulative gains. Tap again to confirm.</p></div>'}

    <div class="frame pan">
      <h4>Keystones<span>8 · mutually exclusive pairs</span></h4>
      ${keystones
        .map((keystone) => {
          const owned = allocated.has(keystone.id);
          const partner = (keystone.excludes ?? [])[0];
          const blocked = (keystone.excludes ?? []).some((id) => allocated.has(id));
          return `<button class="ksrow" data-action="node" data-node="${keystone.id}">
            <span>
              <span class="gold" style="display:block;font-size:10px">${escapeHtml(keystone.name)}</span>
              <span class="tiny muted">${owned ? 'Allocated' : blocked ? `Locked by ${escapeHtml(partner ?? '')}` : escapeHtml(keystone.description)}</span>
            </span>
            <span class="tiny" style="color:${owned ? 'var(--gold-hi)' : 'var(--mute)'}">${owned ? '◆' : `${fmt(store.unspent())} free`}</span>
          </button>`;
        })
        .join('')}
    </div>
  </section>`;
}
