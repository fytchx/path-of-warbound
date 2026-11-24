import { assetUrl, type AssetId } from '../assets/loader';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmt(value: number, digits = 0): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function pct(value: number, max: number): string {
  if (max <= 0) return '0%';
  return `${clamp((value / max) * 100, 0, 100).toFixed(1)}%`;
}

export function assetImg(id: AssetId, alt: string, className = '', extra = ''): string {
  return `<img src="${assetUrl(id)}" alt="${escapeHtml(alt)}"${className ? ` class="${className}"` : ''}${extra} loading="lazy" draggable="false" />`;
}

export function sprite(id: string, className = '', viewBox = '0 0 48 48', vars = ''): string {
  return `<svg class="${className}" viewBox="${viewBox}" aria-hidden="true"${vars ? ` style="${vars}"` : ''}><use href="#${id}"></use></svg>`;
}

export function divider(): string {
  return sprite('w-divider', 'divider', '0 0 200 10');
}

export function corner(className: string): string {
  return sprite('w-corner', `corner-frame ${className}`, '0 0 48 48');
}

export function seconds(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function titleCase(value: string): string {
  return value.replace(/(^|[\s_-])([a-z])/g, (_, prefix: string, char: string) => `${prefix === '_' ? ' ' : prefix}${char.toUpperCase()}`);
}

export function statLabel(stat: string): string {
  return stat
    .replace(/^dmg_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function schoolColor(school: string): string {
  switch (school) {
    case 'fire':
      return '#E87A24';
    case 'frost':
      return '#38D6E8';
    case 'lightning':
      return '#E5C170';
    case 'void':
      return '#9B51E0';
    default:
      return '#D9383A';
  }
}

export function schoolIcon(school: string): AssetId {
  switch (school) {
    case 'fire':
      return 'school_fire';
    case 'frost':
      return 'school_frost';
    case 'lightning':
      return 'school_lightning';
    case 'void':
      return 'school_void';
    default:
      return 'school_physical';
  }
}

export function ailmentIcon(ailment: string): AssetId {
  switch (ailment) {
    case 'ignite':
      return 'ailment_ignite';
    case 'chill':
      return 'ailment_chill';
    case 'shock':
      return 'ailment_shock';
    case 'corruption':
      return 'ailment_corruption';
    default:
      return 'ailment_bleed';
  }
}
