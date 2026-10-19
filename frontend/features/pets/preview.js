import { PetViewer } from './viewer.js';

const speech = document.getElementById('speech');
const status = document.getElementById('status');
const buttons = [...document.querySelectorAll('[data-action]')];
let viewer, portraitUrl, landmarkerPromise;
let generation = 0;

try {
    viewer = new PetViewer(document.getElementById('viewer'), { onError: error => {
        speech.textContent = '3D 預覽暫時無法顯示';
        status.textContent = error.message;
        buttons.forEach(button => button.disabled = true);
    } });
    await viewer.load();
    speech.textContent = '嗨，陪我一下嗎？';
    buttons.forEach(button => button.disabled = false);
} catch (error) {
    viewer?.dispose();
    speech.textContent = '這台裝置無法顯示 3D';
    status.textContent = error.message;
}

for (const button of buttons) button.onclick = () => {
    viewer.play(button.dataset.action);
    speech.textContent = { feed: '開飯了！', wipe: '乾乾淨淨，好舒服。', play: '一起玩！' }[button.dataset.action];
};
for (const button of document.querySelectorAll('[data-scene]')) button.onclick = () => {
    document.getElementById('stage').style.backgroundImage = `url('./assets/pet-scenes/${button.dataset.scene}.jpg')`;
    document.querySelectorAll('[data-scene]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
};
document.getElementById('viewer').onclick = () => viewer?.play('tap');

const OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
document.getElementById('portrait').onchange = async event => {
    const file = event.target.files[0];
    if (!file || !viewer || viewer.disposed) return;
    const version = ++generation;
    const localUrl = URL.createObjectURL(file);
    let nextUrl;
    try {
        status.textContent = '正在裝置上辨識臉部…';
        landmarkerPromise ||= (async () => {
            const { FaceLandmarker, FilesetResolver } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs');
            return FaceLandmarker.createFromOptions(await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'), {
                baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task' },
                runningMode: 'IMAGE', numFaces: 1,
            });
        })().catch(error => { landmarkerPromise = null; throw error; });
        const image = new Image(); image.src = localUrl;
        await image.decode();
        const task = await landmarkerPromise;
        if (version !== generation) return;
        const points = task.detect(image).faceLandmarks?.[0];
        if (!points) throw new Error('找不到清楚的正面臉，請換張照片。');
        const w = image.naturalWidth, h = image.naturalHeight;
        const oval = OVAL.map(index => ({ x: points[index].x * w, y: points[index].y * h }));
        const minX = Math.min(...oval.map(p => p.x)), minY = Math.min(...oval.map(p => p.y));
        const maxX = Math.max(...oval.map(p => p.x)), maxY = Math.max(...oval.map(p => p.y));
        const pad = Math.max(maxX-minX,maxY-minY) * .09;
        const x = Math.max(0,minX-pad), y = Math.max(0,minY-pad);
        const cw = Math.min(w-x,maxX-minX+2*pad), ch = Math.min(h-y,maxY-minY+2*pad);
        const canvas = document.createElement('canvas');
        const scale = Math.min(1,1024/Math.max(cw,ch));
        canvas.width = Math.round(cw*scale); canvas.height = Math.round(ch*scale);
        const ctx = canvas.getContext('2d');
        const mask = document.createElement('canvas'); mask.width=canvas.width; mask.height=canvas.height;
        const m = mask.getContext('2d');
        m.filter = `blur(${Math.max(2, pad*scale*.4)}px)`;
        m.fillStyle = '#fff'; m.beginPath();
        oval.forEach((p,i) => m[i ? 'lineTo' : 'moveTo']((p.x-x)*scale,(p.y-y)*scale));
        m.closePath(); m.fill();
        ctx.drawImage(image,x,y,cw,ch,0,0,canvas.width,canvas.height);
        ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask,0,0);
        const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
        if (!blob) throw new Error('照片處理失敗，請再試一次。');
        if (version !== generation) return;
        nextUrl = URL.createObjectURL(blob);
        await viewer.setPortrait(nextUrl);
        if (version !== generation) return;
        if (portraitUrl) URL.revokeObjectURL(portraitUrl);
        portraitUrl = nextUrl; nextUrl = null;
        status.textContent = '已貼上原照片臉部；沒有 AI 重畫或改變五官。';
        speech.textContent = '是你耶！';
    } catch (error) {
        if (version === generation) status.textContent = error.message;
    } finally {
        URL.revokeObjectURL(localUrl);
        if (nextUrl) URL.revokeObjectURL(nextUrl);
        event.target.value = '';
    }
};
window.addEventListener('pagehide', () => {
    generation++;
    viewer?.dispose();
    if (portraitUrl) URL.revokeObjectURL(portraitUrl);
    landmarkerPromise?.then(task => task.close()).catch(() => {});
});
