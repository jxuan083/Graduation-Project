import { IllustratedPetViewer } from './illustrated-viewer.js';
const stage = document.getElementById('stage'), host = document.getElementById('viewer');
const speech = document.getElementById('speech'), mood = document.getElementById('mood');
const loading = document.getElementById('loading'), retry = document.getElementById('retry');
const snack = document.getElementById('snack'), buttons = [...document.querySelectorAll('#feed,#pet,#pet-hit,#snack')];
let viewer, drag, suppressClick = false, fed = 0, version = 0;
function controls() { buttons.forEach(button => button.disabled = !viewer?.loaded || viewer.busy); }
function onEvent(event) {
    const text = {
        feedStart: ['給我吃的嗎？', '伸手接住餅乾'], foodTaken: ['接到了！', '把餅乾拿到嘴邊'],
        chewing: ['嚼嚼，好香。', '正在吃餅乾'], feedComplete: ['吃飽了，還想陪你一下。', '吃飽後，舒服地坐一下'],
        petStart: ['嗯，再摸一下。', '放鬆地靠過來'], petComplete: ['有你陪著真好。', '心情很好'],
        actionCancelled: ['陪我坐一下吧。', '休息一下'],
    }[event.name];
    if (text) { speech.textContent = text[0]; mood.textContent = text[1]; }
    if (event.name === 'feedComplete') { fed++; document.getElementById('fed-count').textContent = `這次餵了 ${fed} 口`; }
    stage.dataset.phase = event.name;
    controls();
}
function error(error) {
    loading.hidden = false; retry.hidden = false;
    document.getElementById('load-status').textContent = error.message;
    speech.textContent = '狗狗暫時沒有過來，請再試一次。';
    controls();
}
async function load() {
    const token = ++version;
    viewer?.dispose(); loading.hidden = false; retry.hidden = true; host.setAttribute('aria-busy','true');
    viewer = new IllustratedPetViewer(host,{onEvent,onError:error,onProgress:text=>document.getElementById('load-status').textContent=text});
    controls();
    try {
        await viewer.load();
        if (token !== version || viewer.disposed) return;
        loading.hidden = true; host.setAttribute('aria-busy','false');
        speech.textContent = '嗨，終於等到你。'; mood.textContent = '等你陪牠一下';
        stage.dataset.phase = 'idle'; controls();
    } catch { /* viewer reports load errors with retry */ }
}
function act(action) {
    if (!viewer?.play(action)) return;
    controls();
}
document.getElementById('feed').onclick=()=>act('feed');
document.getElementById('pet').onclick=()=>act('pet');
document.getElementById('pet-hit').onclick=()=>act('pet');
retry.onclick=load;
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
stage.onpointermove=e=>{if(!drag&&finePointer.matches){const r=stage.getBoundingClientRect();viewer?.setAttention((e.clientX-r.left)/r.width*2-1);}};
stage.onpointerleave=()=>{if(!drag)viewer?.setAttention();};
function cancelDrag() {
    drag?.ghost?.remove(); drag=null;
    stage.classList.remove('is-dragging','food-near'); viewer?.noticeFood(false); viewer?.setAttention();
}
snack.onpointerdown=e=>{
    if(snack.disabled||e.button!==0)return;
    suppressClick=false;drag={x:e.clientX,y:e.clientY,active:false,near:false};snack.setPointerCapture(e.pointerId);
};
snack.onpointermove=e=>{
    if(!drag)return;
    if(!drag.active&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>7){
        drag.active=true;drag.ghost=snack.cloneNode(true);drag.ghost.removeAttribute('id');drag.ghost.removeAttribute('aria-label');
        drag.ghost.setAttribute('aria-hidden','true');drag.ghost.classList.add('dragging');document.body.append(drag.ghost);
        stage.classList.add('is-dragging');
    }
    if(!drag.active)return;
    drag.ghost.style.left=`${e.clientX}px`;drag.ghost.style.top=`${e.clientY}px`;
    // Match the actual hand location in the square, bottom-aligned Rive canvas.
    const r=viewer.canvas.getBoundingClientRect();
    drag.near=Math.hypot((e.clientX-r.left)/r.width-.5,(e.clientY-r.top)/r.height-.74)<.17;
    stage.classList.toggle('food-near',drag.near);viewer.noticeFood(drag.near);
    speech.textContent=drag.near?'是給我的嗎？放開就接住。':'把餅乾拿到我的手邊。';
};
snack.onpointerup=()=>{
    if(!drag)return;
    const moved=drag.active,near=drag.near;suppressClick=moved;cancelDrag();
    if(moved){if(near)act('feed');else{speech.textContent='差一點點，拿近一點嘛。';mood.textContent='餅乾還在盤子裡';}}
};
snack.onpointercancel=()=>{suppressClick=true;cancelDrag();speech.textContent='我在這裡等你。';};
snack.onclick=e=>{if(e.detail===0||!suppressClick)act('feed');suppressClick=false;};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag){suppressClick=true;cancelDrag();speech.textContent='我在這裡等你。';}});
window.addEventListener('pagehide',()=>{version++;cancelDrag();viewer?.dispose();});
window.addEventListener('pageshow',e=>{if(e.persisted)load();});
await load();
