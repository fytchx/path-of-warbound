import { cpSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serves the untouched art bundle at /assets/... in dev and copies it
 * verbatim into dist/assets on build. The bundle is never rewritten.
 */
function warboundAssets(): Plugin {
  return {
    name: 'warbound-assets',
    closeBundle() {
      const from = resolve('assets');
      if (existsSync(from)) cpSync(from, resolve('dist/assets'), { recursive: true });
    },
  };
}

/** Inlines the sprite sheet once so every <use href="#w-..."> resolves. */
function warboundSprite(): Plugin {
  return {
    name: 'warbound-sprite',
    transformIndexHtml(html) {
      const sprite = readFileSync(resolve('warbound-sprite.svg'), 'utf8');
      return html.replace('<!--WARBOUND_SPRITE-->', sprite);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [warboundSprite(), warboundAssets()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
});
