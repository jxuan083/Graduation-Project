import {t} from '../../core/i18n.js';
const esc = value => String(value || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function miniCompanionMarkup(pet,{interactive=false}={}) {
    const person=pet.pet_mini_profile;
    let avatar='';
    if(person){
        const photo=person.photoURL;
        avatar=`<span class="mini-person-pet"><svg class="mini-pet-body" viewBox="0 0 100 110" aria-hidden="true"><ellipse cx="50" cy="103" rx="26" ry="4" fill="#667244" opacity=".13"/><path d="M31 58Q22 77 28 95Q50 103 72 95Q78 77 69 58Z" fill="#72805a"/><path d="M32 65Q23 68 24 83Q25 89 31 86L36 72M68 65Q77 68 76 83Q75 89 69 86L64 72" fill="#e4bc7f"/><ellipse cx="37" cy="97" rx="12" ry="6" fill="#e8d9b6"/><ellipse cx="63" cy="97" rx="12" ry="6" fill="#e8d9b6"/><path d="M39 61L50 70L61 61" fill="none" stroke="#d6dfbd" stroke-width="2"/><circle cx="50" cy="80" r="2" fill="#e2d8ac"/></svg><span class="mini-person-head">${photo?`<img src="${esc(photo)}" alt="${esc(person.nickname)}">`:`<span>${esc((person.nickname || '?').slice(0,1))}</span>`}</span></span>`;
    }else{
        avatar=`<img class="mini-original-pet" src="${esc(pet.pet_face_url)}" alt="">`;
    }
    const label=pet.pet_is_caged?'等你們來救我':Number(pet.pet_energy)<30?'有點餓，來小屋找我':'今天也一起加油';
    return `<span class="mini-companion${interactive?' is-interactive':''}" data-mini><span class="mini-pet-art" aria-hidden="true">${avatar}</span>${interactive?`<span class="mini-pet-words" role="status">${esc(t(label))}</span><span class="mini-pet-controls"><button type="button" data-mini-touch>${t('摸摸')}</button><button type="button" data-mini-enter>${t('進入小屋')}</button></span>`:''}</span>`;
}
export function bindMiniCompanion(container,{onEnter}={}){
    const root=container.querySelector('[data-mini]');
    if(!root)return;
    root.querySelector('[data-mini-enter]')?.addEventListener('click',onEnter);
    root.querySelector('[data-mini-touch]')?.addEventListener('click',()=>{
        root.querySelector('.mini-pet-words').textContent=t('有你陪著，真好。');
        const head=root.querySelector('.mini-person-head') || root.querySelector('.mini-original-pet');
        if(head && !matchMedia('(prefers-reduced-motion: reduce)').matches){
            head.getAnimations().forEach(a=>a.cancel());
            head.animate([{transform:'rotate(0)'},{transform:'rotate(-5deg)',offset:.45},{transform:'rotate(0)'}],{duration:420,easing:'ease-in-out'});
        }
    });
    root.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>{
        img.hidden=true;
        const initial=document.createElement('span');initial.textContent=img.alt?.slice(0,1) || '?';img.parentElement.append(initial);
    },{once:true}));
}
