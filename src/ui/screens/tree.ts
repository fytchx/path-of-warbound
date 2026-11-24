import { keystones, skillTree } from '../../data';
import type { TreeNode } from '../../data/types';
import type { GameStore } from '../store';
import { escapeHtml, fmt } from '../dom';

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

export function treeScreen(store: GameStore): string {
  const ui = store.ui;
  const allocated = new Set(store.save.allocated);
  const preview = new Set(ui.previewPath);
  const articulation = ui.refundMode ? store.articulationPoints() : new Set<string>();
  const highlighted = new Set([...allocated, ...preview]);
  const previewNode = ui.previewNode ? skillTree.nodes.find((n) => n.id === ui.previewNode) ?? null : null;
  const previewCost = ui.previewPath.length;

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
      const isExcluded = (node.excludes ?? []).some((id) => allocated.has(id));
      const isStranded = articulation.has(node.id);
      const color = node.kind === 'keystone' ? '#9B51E0' : node.kind === 'socket' ? '#38D6E8' : SECTOR_COLOR[node.sector] ?? '#D4AF37';
      const classes = ['tree-node', node.kind, isAllocated ? 'allocated' : '', isPreview ? 'preview' : '', isExcluded ? 'excluded' : '', isStranded ? 'stranded' : ''].join(' ');
      const label = node.kind === 'notable' || node.kind === 'keystone' ? `<text class="tree-node-label" y="${radius + 10}">${escapeHtml(node.name)}</text>` : '';
      const glyphStyle = `--g:${color};--fill:${isAllocated ? '#2a2312' : '#0B0E16'}`;
      return `<g class="${classes}" transform="translate(${node.x} ${node.y})" data-action="node" data-node="${node.id}" role="button" tabindex="0" aria-label="${escapeHtml(node.name)}">
        <circle r="${radius + 6}" fill="transparent" />
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
        </g>
      </svg>
      ${ui.refundMode ? '<div class="banner" style="top:auto;bottom:6px">Refund mode · red nodes would strand others</div>' : ''}
    </div>

    <p class="hint">Drag to pan · +/− to zoom · tap a node to preview or inspect</p>

    ${previewNode
      ? `<div class="frame pan">
          <h4>${escapeHtml(previewNode.name)}<span class="gold">${previewCost} pt${previewCost === 1 ? '' : 's'}</span></h4>
          <p class="tiny muted" style="line-height:1.4">${escapeHtml(previewNode.description)}</p>
          <div style="margin-top:6px"><button class="gbtn" data-action="allocate" ${store.unspent() < previewCost ? 'disabled' : ''}>Allocate</button></div>
        </div>`
      : '<div class="frame pan"><p class="tiny muted">Tap an unallocated node to preview and buy the shortest path. Tap an allocated node to inspect it.</p></div>'}

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
              <span class="tiny muted">${owned ? 'Allocated' : blocked ? `Locked by ${escapeHtml(partner ?? '')}` : escapeHtml(keystone.description.slice(0, 56))}…</span>
            </span>
            <span class="tiny" style="color:${owned ? 'var(--gold-hi)' : 'var(--mute)'}">${owned ? '◆' : `${fmt(store.unspent())} free`}</span>
          </button>`;
        })
        .join('')}
    </div>
  </section>`;
}
