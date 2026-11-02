import {t} from '../../core/i18n.js';
import {impact} from '../../core/haptics.js';

function packageArt(kind) {
    const paw = '<g fill="#7b865d"><ellipse cx="80" cy="93" rx="14" ry="11"/><circle cx="63" cy="78" r="6"/><circle cx="76" cy="71" r="6"/><circle cx="89" cy="73" r="6"/><circle cx="100" cy="82" r="6"/></g>';
    if(kind==='food') return `<svg viewBox="0 0 160 160" aria-hidden="true"><ellipse cx="80" cy="145" rx="44" ry="5" fill="#6d633b" opacity=".12"/><path d="M39 45H121L131 135Q80 149 29 135Z" fill="#e3c798" stroke="#a78a5f" stroke-width="2"/><path d="M44 57L37 129M116 57L123 129" stroke="#c3a575" stroke-width="2" fill="none"/><g data-package-lid><path d="M39 45L45 28H115L121 45L112 56H48Z" fill="#f0dbb5" stroke="#a78a5f" stroke-width="2"/><path d="M46 38H114" stroke="#bc9e72" stroke-width="2" stroke-dasharray="3 4"/></g><circle cx="80" cy="90" r="29" fill="#f6edda"/>${paw}</svg>`;
    return `<svg viewBox="0 0 160 160" aria-hidden="true"><ellipse cx="80" cy="145" rx="48" ry="5" fill="#6d633b" opacity=".12"/><path d="M28 64H132V133Q80 146 28 133Z" fill="#b7c19a" stroke="#7a8860" stroke-width="2"/><path d="M70 64H90V140H70Z" fill="#f1e3bc"/><g data-package-lid><path d="M22 45Q80 35 138 45V68Q80 60 22 68Z" fill="#d9dfc3" stroke="#7a8860" stroke-width="2"/><path d="M69 40C28 37 57 4 80 35C103 4 132 37 91 40" fill="none" stroke="#c5ad79" stroke-width="8" stroke-linecap="round"/><path d="M71 42H89V64H71Z" fill="#f1e3bc"/></g></svg>`;
}

export class DrawReveal {
    constructor(container) {
        this.container=container;this.animations=new Set();this.generation=0;
        this.motion=matchMedia('(prefers-reduced-motion: reduce)');
        this.onMotion=()=>{if(this.motion.matches)this.skip();};
        this.motion.addEventListener('change',this.onMotion);
    }
    begin(kind) {
        this.cancel();this.active=true;this.skipped=this.motion.matches;
        this.container.hidden=false;this.container.dataset.phase='waiting';
        this.container.removeAttribute('data-rarity');
        this.container.innerHTML=`<div class="draw-reveal-glow" aria-hidden="true"></div><div class="draw-package">${packageArt(kind)}</div><p class="draw-reveal-phase" role="status"></p><button class="draw-reveal-skip" type="button"></button>`;
        this.label(t('正在準備小包，確認抽取結果…'));
        const skip=this.container.querySelector('button');skip.textContent=t('直接看結果');skip.onclick=()=>this.skip();
        if(!this.skipped)this.animate(this.container.querySelector('.draw-package'),[{opacity:0,transform:'translateY(12px) scale(.95)'},{opacity:1,transform:'translateY(0) scale(1)'}],180);
    }
    label(message){const label=this.container.querySelector('[role=status]');if(label)label.textContent=message;}
    async animate(element,frames,duration){
        if(!this.active||this.skipped||!element)return;
        const easing=getComputedStyle(this.container).getPropertyValue('--ease-out').trim()||'ease-out';
        const animation=element.animate(frames,{duration,easing,fill:'forwards'});
        this.animations.add(animation);
        try{await animation.finished;}catch{/* Skip/close cancels presentation, never the confirmed reward. */}
        this.animations.delete(animation);
    }
    async finish(item) {
        if(!this.active)return false;
        const generation=this.generation;
        this.container.dataset.rarity=item.rarity;
        this.container.dataset.phase='opening';
        this.label(t('小包準備好了，打開看看。'));
        await this.animate(this.container.querySelector('.draw-package'),[{transform:'rotate(0)'},{transform:'rotate(-3deg)',offset:.35},{transform:'rotate(3deg)',offset:.7},{transform:'rotate(0)'}],240);
        if(!this.active||generation!==this.generation)return false;
        await this.animate(this.container.querySelector('[data-package-lid]'),[{opacity:1,transform:'translateY(0) rotate(0)'},{opacity:0,transform:'translateY(-28px) rotate(-8deg)'}],240);
        if(!this.active||generation!==this.generation)return false;
        if(!this.skipped)impact(item.rarity==='treasure'?'medium':'light');
        await this.animate(this.container.querySelector('.draw-package'),[{opacity:1,transform:'scale(1)'},{opacity:0,transform:'translateY(6px) scale(.97)'}],180);
        if(!this.active||generation!==this.generation)return false;
        this.active=false;this.container.hidden=true;return true;
    }
    present(result) {
        if(!this.container.closest('dialog')?.open||this.skipped)return;
        const easing=getComputedStyle(result).getPropertyValue('--ease-out').trim()||'ease-out';
        const animation=result.animate([{opacity:0,transform:'translateY(10px) scale(.97)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:240,easing});
        this.animations.add(animation);animation.finished.catch(()=>{}).finally(()=>this.animations.delete(animation));
    }
    skip(){this.skipped=true;for(const animation of this.animations)animation.cancel();this.animations.clear();this.label(t('確認結果後立即顯示。'));}
    cancel(){this.generation++;this.active=false;for(const animation of this.animations)animation.cancel();this.animations.clear();this.container.hidden=true;}
}
