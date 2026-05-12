// utils/dom.js — DOM 簡寫
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function on(target, event, handler, opts) {
    if (typeof target === 'string') target = $(target);
    if (target) target.addEventListener(event, handler, opts);
    return target;
}

export function show(el) { if (el) el.style.display = ''; }
export function hide(el) { if (el) el.style.display = 'none'; }
