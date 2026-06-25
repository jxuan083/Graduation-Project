// frontend/core/i18n.js — DOM 翻譯引擎（方案A）
import { state } from './state.js';
import { dict } from './i18n-dict.js';
import { translate } from './i18n-core.js';

const STORAGE_KEY = 'phubbing_lang';
const ATTRS = ['placeholder', 'title', 'alt', 'aria-label'];
const SKIP_SELECTOR = '#lang-toggle';      // 不翻譯切換鈕自身（中 / EN）
const origText = new WeakMap();            // Text node -> 原始繁中
let observer = null;
let applying = false;                       // 引擎自身正在改 DOM 時，忽略 observer（避免自我觸發迴圈）

export function getLang() {
  return state.lang === 'en' ? 'en' : 'zh';
}

export function t(zhKey, params) {
  return translate(dict, getLang(), String(zhKey).trim(), params);
}

function roots() {
  const el = document.getElementById('app-container');
  return el ? [el] : [];
}

function datasetKey(attr) {
  // 'aria-label' -> 'i18nOrigAriaLabel'
  const camel = attr.replace(/(^|-)(\w)/g, (m, _, c) => c.toUpperCase());
  return 'i18nOrig' + camel;
}

function translateTextNode(node, lang) {
  const parent = node.parentElement;
  if (!parent) return;
  const tag = parent.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE') return;
  if (parent.closest && parent.closest(SKIP_SELECTOR)) return;

  const raw = node.nodeValue;
  if (!raw || !raw.trim()) return;

  if (!origText.has(node)) origText.set(node, raw);
  const original = origText.get(node);
  const key = original.trim();

  if (lang === 'en') {
    const translated = translate(dict, 'en', key);
    if (translated !== key) {
      const newVal = original.replace(key, translated);
      // 只在值真的改變時才賦值，避免重複賦同值再次觸發 MutationObserver → 無限迴圈
      if (node.nodeValue !== newVal) node.nodeValue = newVal;
    }
  } else if (node.nodeValue !== original) {
    node.nodeValue = original;
  }
}

function translateAttrs(el, lang) {
  if (el.closest && el.closest(SKIP_SELECTOR)) return;
  for (const attr of ATTRS) {
    if (!el.hasAttribute(attr)) continue;
    const dk = datasetKey(attr);
    if (el.dataset[dk] === undefined) el.dataset[dk] = el.getAttribute(attr);
    const original = el.dataset[dk] || '';
    const key = original.trim();
    if (!key) continue;
    if (lang === 'en') {
      const translated = translate(dict, 'en', key);
      if (translated !== key) {
        const newVal = original.replace(key, translated);
        if (el.getAttribute(attr) !== newVal) el.setAttribute(attr, newVal);
      }
    } else if (el.getAttribute(attr) !== original) {
      el.setAttribute(attr, original);
    }
  }
}

function walk(root, lang) {
  if (root.nodeType === 1 && root.closest && root.closest(SKIP_SELECTOR)) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  let n;
  while ((n = tw.nextNode())) texts.push(n);
  for (const tn of texts) translateTextNode(tn, lang);

  if (root.nodeType === 1) {
    const sel = ATTRS.map((a) => `[${a}]`).join(',');
    root.querySelectorAll(sel).forEach((el) => translateAttrs(el, lang));
    if (ATTRS.some((a) => root.hasAttribute(a))) translateAttrs(root, lang);
  }
}

export function applyTo(root) {
  if (root) walk(root, getLang());
}

function applyAll() {
  applying = true;
  try {
    for (const r of roots()) walk(r, getLang());
  } finally {
    if (observer) observer.takeRecords();  // 丟棄本次自產的 mutation 記錄
    applying = false;
  }
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver((mutations) => {
    if (applying) return;             // 引擎自身造成的變更，不回應（避免自我觸發迴圈）
    if (getLang() !== 'en') return;   // zh 模式：DOM 本就是繁中，無需處理
    for (const m of mutations) {
      if (m.type === 'characterData') {
        translateTextNode(m.target, 'en');
      } else if (m.type === 'childList') {
        m.addedNodes.forEach((node) => {
          if (node.nodeType === 3) translateTextNode(node, 'en');
          else if (node.nodeType === 1) walk(node, 'en');
        });
      }
    }
  });
  for (const r of roots()) {
    observer.observe(r, { childList: true, subtree: true, characterData: true });
  }
}

function updateToggleUI() {
  document.querySelectorAll('#lang-toggle .lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === getLang());
  });
}

function applyHtmlMeta() {
  document.documentElement.setAttribute('lang', getLang() === 'en' ? 'en' : 'zh-TW');
  document.title = getLang() === 'en' ? 'Phubbing Anchor' : '社交定錨 | Phubbing Anchor';
}

export function setLang(lang) {
  state.lang = lang === 'en' ? 'en' : 'zh';
  try { localStorage.setItem(STORAGE_KEY, state.lang); } catch (_) {}
  applyHtmlMeta();
  applyAll();
  updateToggleUI();
}

export function initI18n() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
  state.lang = saved === 'en' ? 'en' : 'zh';

  const toggle = document.getElementById('lang-toggle');
  if (toggle) {
    toggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.lang-btn');
      if (btn && btn.dataset.lang) setLang(btn.dataset.lang);
    });
  }

  startObserver();
  applyHtmlMeta();
  if (getLang() === 'en') applyAll();   // 還原時機由 setLang 處理；初始 zh 不動 DOM
  updateToggleUI();
}
