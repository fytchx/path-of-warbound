import './styles/app.css';
import { assetUrl } from './assets/loader';
import { computeOffline, loadSave, createInitialSave } from './game/state';
import { GameStore } from './ui/store';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');

document.documentElement.style.setProperty('--tex-obsidian', `url("${assetUrl('tex_obsidian')}")`);
document.documentElement.style.setProperty('--tex-gold', `url("${assetUrl('tex_gold')}")`);

const save = loadSave() ?? createInitialSave();
const offline = computeOffline(save);
const store = new GameStore(save, offline);

mountApp(root, store);
