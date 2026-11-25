import { keystones, skillTree } from '../../data';
import type { TreeNode } from '../../data/types';
import type { GameStore, TreeFocus } from '../store';
import { escapeHtml, fmt, statLabel } from '../dom';

const VIEW = { w: 390, h: 430 };
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

function sectorAuras(centroids: Map<string, { x: number; y: number }>, activeFocus: TreeFocus): string {
  return [...centroids.entries()]
    .map(([sector, c]) => {
      const focused = activeFocus === sector;
      return `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="${focused ? 105 : 88}" fill="${SECTOR_COLOR[sector]}" fill-opacity="${focused ? '0.11' : '0.05'}" pointer-events="none" />`;
    })
    .join('');
}

function sectorLabels(centroids: Map<string, { x: number; y: number }>, active: string | null): string {
  return [...centroids.entries()]
    .map(([sector, group]) => {
      const angle = Math.atan2(group.y, group.x);
      const lx = Math.max(-150, Math.min(150, Math.cos(angle) * 178));
      const ly = Math.max(-188, Math.min(188, Math.sin(angle) * 178));
      return `<text class="tree-sector-label${sector === active ? ' starter' : ''}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="${SECTOR_COLOR[sector]}">${sector.toUpperCase()}</text>`;
    })
    .join('');
}

function summarizeNodesMods(nodeIds: string[]): string[] {
  const sums = new Map<string, number>();
  for (const id of nodeIds) {
    const node = skillTree.nodes.find((n) => n.id === id);
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

function closestGoals(allocated: Set<string>): TreeNode[] {
  const frontier = reachableFrontier(allocated);
  const candidates = skillTree.nodes.filter(
    (node) =>
      !allocated.has(node.id) &&
      (node.kind === 'notable' || node.kind === 'keystone' || frontier.has(node.id)) &&
      !(node.excludes ?? []).some((id) => allocated.has(id)),
  );
  // Rank notables/keystones nearest to any allocated node
  const allocatedNodes = skillTree.nodes.filter((n) => allocated.has(n.id));
  const distToAllocated = (n: TreeNode) =>
    Math.min(...allocatedNodes.map((a) => Math.hypot(a.x - n.x, a.y - n.y)));
  return candidates
    .sort((a, b) => {
      const rankA = a.kind === 'notable' ? 0 : a.kind === 'keystone' ? 1 : 2;
      const rankB = b.kind === 'notable' ? 0 : b.kind === 'keystone' ? 1 : 2;
      if (rankA !== rankB) return rankA - rankB;
      return distToAllocated(a) - distToAllocated(b);
    })
    .slice(0, 4);
}

export function treeScreen(store: GameStore): string {
  const ui = store.ui;
  const allocated = new Set(store.save.allocated);
  const preview = new Set(ui.previewPath);
  const frontier = reachableFrontier(allocated);
  const articulation = ui.refundMode ? store.articulationPoints() : new Set<string>();
  const highlighted = new Set([...allocated, ...preview]);
  const activeSector = starterSector(store);
  const starterBranch = activeSector ? nodesNearHub(activeSector) : new Set<string>();
  const previewNode = ui.previewNode ? skillTree.nodes.find((n) => n.id === ui.previewNode) ?? null : null;
  const previewCost = ui.previewPath.length;
  const previewLines = previewCost > 0 ? summarizeNodesMods(ui.previewPath) : [];
  const centroids = sectorCentroids();

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

  const nodeMarkup = skillTree.nodes
    .map((node) => {
      const radius = nodeRadius(node);
      const isAllocated = allocated.has(node.id);
      const isPreview = preview.has(node.id);
      const isReachable = frontier.has(node.id) && !isAllocated;
      const isExcluded = (node.excludes ?? []).some((id) => allocated.has(id));
      const isStranded = articulation.has(node.id);
      const color = node.kind === 'keystone' ? '#9B51E0' : node.kind === 'socket' ? '#38D6E8' : SECTOR_COLOR[node.sector] ?? '#D4AF37';
      const classes = [
        'tree-node',
        node.kind,
        isAllocated ? 'allocated' : '',
        isPreview ? 'preview' : '',
        isReachable ? 'reachable' : '',
        isExcluded ? 'excluded' : '',
        isStranded ? 'stranded' : '',
        starterBranch.has(node.id) ? 'starter-branch' : '',
      ].filter(Boolean).join(' ');
      const showLabel =
        node.kind === 'keystone' ||
        (node.kind === 'notable' && (isAllocated || isPreview || ui.treeFocus === node.sector));
      const label = showLabel ? `<text class="tree-node-label" y="${radius + 13}">${escapeHtml(node.name)}</text>` : '';
      const glyphStyle = `--g:${color};--fill:${isAllocated ? '#3b2e10' : isReachable ? '#182135' : '#0B0E16'}`;
      const hitRadius = Math.max(22, radius + 10);
      return `<g class="${classes}" transform="translate(${node.x} ${node.y})" data-action="node" data-node="${node.id}" role="button" tabindex="0" aria-label="${escapeHtml(node.name)}">
        <circle r="${hitRadius}" fill="transparent" />
        ${isReachable && !isExcluded ? `<circle r="${radius + 3.5}" fill="none" stroke="${color}" stroke-opacity="0.55" stroke-width="1.2" stroke-dasharray="2 2" />` : ''}
        <use href="#${symbolFor(node)}" x="${-radius}" y="${-radius}" width="${radius * 2}" height="${radius * 2}" class="node-glyph" style="${glyphStyle}" />
        ${label}
      </g>`;
    })
    .join('');

  const spentCount = store.save.allocated.filter((id) => id !== 'hub_0').length;
  const activeTab = ui.treeTab;

  let dockContent = '';
  if (activeTab === 'inspect') {
    if (previewNode) {
      dockContent = `<div class="frame pan tree-dock-card">
        <h4>
          <span>${escapeHtml(previewNode.name)} <small class="muted">(${escapeHtml(previewNode.sector)} · ${escapeHtml(previewNode.kind)})</small></span>
          <span class="gold">${previewCost} pt${previewCost === 1 ? '' : 's'}</span>
        </h4>
        <p class="tiny muted" style="line-height:1.4">${escapeHtml(previewNode.description)}</p>
        ${previewLines.length ? `<div class="tree-gain-list">${previewLines.map((l) => `<span class="gain-chip">${escapeHtml(l)}</span>`).join('')}</div>` : ''}
        <div class="tree-dock-actions">
          <button class="gbtn" data-action="allocate" ${store.unspent() < previewCost ? 'disabled' : ''}>
            ${store.unspent() < previewCost ? `Need ${previewCost} pts (${store.unspent()} free)` : `Allocate (${previewCost} pt${previewCost === 1 ? '' : 's'})`}
          </button>
        </div>
      </div>`;
    } else {
      const suggestions = closestGoals(allocated);
      dockContent = `<div class="frame pan tree-dock-card">
        <h4>Next Nodes<span>${store.unspent()} point${store.unspent() === 1 ? '' : 's'} ready</span></h4>
        <p class="tiny muted" style="margin-bottom:6px">Tap a node on the map or pick a nearby notable below to preview its path.</p>
        <div class="tree-suggest-grid">
          ${suggestions
            .map((node) => {
              const color = SECTOR_COLOR[node.sector] ?? '#D4AF37';
              return `<button class="tree-suggest-btn" data-action="node" data-node="${node.id}" style="--c:${color}">
                <b>${escapeHtml(node.name)}</b>
                <span>${escapeHtml(node.sector)} · ${escapeHtml(node.kind)}</span>
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
          const partnerName = partnerId ? skillTree.nodes.find((n) => n.id === partnerId)?.name ?? partnerId : '';
          const blocked = (keystone.excludes ?? []).some((id) => allocated.has(id));
          return `<button class="ksrow" data-action="node" data-node="${keystone.id}">
            <span>
              <span class="gold" style="display:block;font-size:11px;font-weight:700">${escapeHtml(keystone.name)}</span>
              <span class="tiny muted">${owned ? 'Allocated' : blocked ? `Locked by ${escapeHtml(partnerName)}` : escapeHtml(keystone.description)}</span>
            </span>
            <span class="tiny" style="color:${owned ? 'var(--gold-hi)' : 'var(--mute)'}">${owned ? 'ACTIVE' : blocked ? 'LOCKED' : 'Preview'}</span>
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
        : '<div class="tiny muted">No passive nodes allocated yet. Tap any dashed ring around the center Soul Core to begin.</div>'}
    </div>`;
  }

  return `<section class="screen" data-screen="tree" aria-label="Skill Tree">
    <div class="sub-h">
      <h2>WARBOUND TREE</h2>
      <span class="tiny"><b class="gold">${store.unspent()} free</b> · ${spentCount} spent</span>
    </div>

    <div class="tree-focus-row" role="tablist" aria-label="Sector focus">
      ${SECTORS.map(
        (s) => `<button role="tab" aria-selected="${ui.treeFocus === s.id}" class="focus-chip ${ui.treeFocus === s.id ? 'on' : ''}" data-action="tree-focus" data-sector="${s.id}" ${s.color ? `style="--fc:${s.color}"` : ''}>${s.label}</button>`,
      ).join('')}
    </div>

    <div class="frame tree" data-tree>
      <svg class="tree-svg" viewBox="0 0 ${VIEW.w} ${VIEW.h}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Skill tree">
        <g transform="translate(${VIEW.w / 2 + ui.treeView.x} ${VIEW.h / 2 + ui.treeView.y}) scale(${ui.treeView.scale})">
          <circle r="210" fill="none" stroke="rgba(109,95,46,0.18)" stroke-width="1" />
          <circle r="150" fill="none" stroke="rgba(109,95,46,0.12)" stroke-width="1" />
          ${sectorAuras(centroids, ui.treeFocus)}
          ${edgeMarkup}
          ${nodeMarkup}
          ${sectorLabels(centroids, activeSector)}
        </g>
      </svg>
      <div class="tree-zoom-hud">
        <button class="icon-btn small" data-action="tree-zoom-out" aria-label="Zoom out">−</button>
        <button class="tree-zoom-pct" data-action="tree-reset" aria-label="Reset view">${(ui.treeView.scale * 100).toFixed(0)}%</button>
        <button class="icon-btn small" data-action="tree-zoom-in" aria-label="Zoom in">+</button>
      </div>
      ${ui.refundMode ? '<div class="banner" style="top:auto;bottom:6px">Refund mode · tap a node to refund</div>' : ''}
    </div>

    <div class="tree-controls">
      <button class="gbtn ${ui.refundMode ? 'on' : ''}" data-action="tree-refund">${ui.refundMode ? 'REFUND: ON' : 'REFUND NODE'}</button>
      <button class="gbtn" data-action="open-respec" ${spentCount === 0 ? 'disabled' : ''}>RESPEC ALL · ${store.respecFee() === 0 ? 'FREE' : `${fmt(store.respecFee())}g`}</button>
    </div>

    <div class="subtabs" role="tablist" aria-label="Tree details">
      <button role="tab" aria-selected="${activeTab === 'inspect'}" class="subtab ${activeTab === 'inspect' ? 'on' : ''}" data-action="tree-tab" data-tab="inspect">Inspector</button>
      <button role="tab" aria-selected="${activeTab === 'keystones'}" class="subtab ${activeTab === 'keystones' ? 'on' : ''}" data-action="tree-tab" data-tab="keystones">Keystones (8)</button>
      <button role="tab" aria-selected="${activeTab === 'summary'}" class="subtab ${activeTab === 'summary' ? 'on' : ''}" data-action="tree-tab" data-tab="summary">Bonuses (${spentCount})</button>
    </div>

    ${dockContent}
  </section>`;
}
