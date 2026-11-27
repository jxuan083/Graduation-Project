// views/meeting-news/meeting-news.js — 聚會回顧報紙（THE GATHERING POST）
//
// 固定版型：報頭、副標、數據、出席名單由聚會紀錄的數字填；大標題（Prompt A）與兩欄內文（Prompt B）
// 由後端 Qwen 產生，失敗時後端給規則版。主圖：有照片放照片，群組寵物疊在後端算好的「不擋到人」位置；
// 沒照片放聚會中同一張情境場景＋寵物（沿用 redesign.css 的 .pa-scene-card）。
// 改版前產生的舊報紙沒有 headline／article／hero／roster，下面各自有退回舊資料的寫法。
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { setProtectedImage } from '../../core/api.js';

const COLORS = ['#a8c8e8', '#f4a442', '#f9c8d0', '#f9d5e5', '#c8e6c9', '#d8b8e8'];
const EMOJIS = ['🐻', '🦊', '🐷', '⭐', '🦁', '🐰'];
const CONTEXT_LABELS = { general: '一般聚會', meeting: '開會', family: '家庭聚會', study: '讀書會', class: '專心上課', meal: '吃飯聚餐', date: '約會', social: '認識新朋友', outdoor: '旅行' };
// 跟聚會中的場景卡一樣：這幾個情境寵物坐在桌子後面（下半身被桌緣擋住）
const PET_BEHIND = ['family', 'study', 'class'];

let _savedChipDisplay = null;

function onShow() {
    const chip = document.getElementById('auth-logged-in');
    if (chip) {
        _savedChipDisplay = chip.style.display;
        chip.style.display = 'none';
    }
}

function onHide() {
    const chip = document.getElementById('auth-logged-in');
    if (chip && _savedChipDisplay !== null) {
        chip.style.display = _savedChipDisplay;
        _savedChipDisplay = null;
    }
}

export function init() {
    register('view-meeting-news', {
        element: document.getElementById('view-meeting-news'),
        onShow,
        onHide,
    });
    document.getElementById('btn-meeting-news-home')?.addEventListener('click', () => switchView('view-home', { replace: true }));
}

export function renderMeetingNews(meeting, newspaper) {
    const stats = newspaper?.stats || {};
    const roster = buildRoster(meeting, newspaper);
    const duration = Number(meeting?.duration_minutes ?? stats.duration_minutes ?? 0);
    const memberCount = Number(meeting?.member_count || stats.member_count || roster.length || 0);
    const totalDistractions = Number(meeting?.total_deviations ?? stats.total_deviations ?? 0);
    const longestFocus = stats.longest_focus_minutes ?? meeting?.longest_focus_minutes;
    const generatedAt = newspaper?.generated_at_server || newspaper?.generated_at || meeting?.ended_at || new Date().toISOString();
    const photos = collectPhotos(newspaper);
    const hero = newspaper?.hero || fallbackHero(meeting, photos);

    state.currentMeetingNewspaper = newspaper || null;

    setText('mn-date', formatNewsDate(generatedAt));
    setText('mn-volume', `VOL. 1 · NO. ${String(meeting?.id || newspaper?.meeting_id || 1).slice(-3).padStart(3, '0')}`);
    setText('mn-headline', headlineText(newspaper, memberCount));
    setText('mn-subhead', newspaper?.subhead || `本次聚會歷時 ${duration} 分鐘，共有 ${memberCount} 名成員參與`);
    setText('mn-duration', duration);
    setText('mn-member-count', memberCount);
    setText('mn-total-distractions', totalDistractions);
    setText('mn-longest-focus', longestFocus === null || longestFocus === undefined ? '—' : longestFocus);

    renderHero(hero, newspaper?.pet || null, newspaper?.context || meeting?.context || 'general');
    const extras = photos.filter(p => !hero?.photo_id || p.id !== hero.photo_id)
        .filter(p => hero?.kind !== 'photo' || p.content_path !== hero.content_path);
    renderArticle(articleParagraphs(newspaper, { duration, memberCount, totalDistractions, roster }), extras[0]);
    renderGallery(extras.slice(1));
    renderRoster(roster);
}

// ── 大標題與內文 ──
function headlineText(newspaper, memberCount) {
    if (Array.isArray(newspaper?.headline) && newspaper.headline.length) return newspaper.headline.join('\n');
    if (newspaper?.title && newspaper.title !== 'Party Newspaper') return newspaper.title;
    return `${memberCount || '多'}人聚會\n圓滿落幕`;
}

function articleParagraphs(newspaper, { duration, memberCount, totalDistractions, roster }) {
    if (Array.isArray(newspaper?.article) && newspaper.article.length) return newspaper.article;
    // 舊報紙：沿用改版前的固定句型
    const scored = roster.filter(r => r.deviations !== null && r.deviations !== undefined);
    const mvp = scored.slice().sort((a, b) => a.deviations - b.deviations)[0];
    const paragraphs = [
        newspaper?.lead || `【本報訊】一場聚會在眾人的期待中順利落幕。本次活動全程共計 ${duration} 分鐘，吸引了 ${memberCount} 位好友出席。`,
        `記錄顯示，全場合計發生 ${totalDistractions} 次分心事件，提醒我們在社交場合仍需要練習把注意力留給彼此。`,
    ];
    if (mvp) paragraphs.push(`在最專注成員評選中，${mvp.name}以僅 ${mvp.deviations} 次分心的表現，榮獲本次聚會「最專注獎」。`);
    const highlights = newspaper?.highlights || [];
    paragraphs.push(highlights.length
        ? `聚會尾聲，系統整理出本場亮點：「${highlights[0]}」。本報期待下一次聚會能帶來更多精彩故事。`
        : '聚會尾聲，眾人一致表示意猶未盡，並約定擇日再聚。本報期待下一次聚會能帶來更多精彩故事。');
    return paragraphs;
}

function renderArticle(paragraphs, inlinePhoto) {
    const article = document.getElementById('mn-article');
    if (!article) return;
    article.replaceChildren();
    paragraphs.forEach((text, index) => {
        const p = document.createElement('p');
        p.textContent = text;
        article.appendChild(p);
        // 第二張照片放在第一段後面（跟原本的版面一樣）
        if (index === 0 && inlinePhoto?.content_path) {
            const wrap = document.createElement('div');
            wrap.className = 'mn-inline-photo-wrap';
            const frame = document.createElement('div');
            frame.className = 'mn-photo-frame mn-inline-photo';
            const caption = document.createElement('p');
            caption.textContent = '▲ 聚會現場一景';
            wrap.append(frame, caption);
            article.appendChild(wrap);
            setProtectedImage(frame, inlinePhoto.content_path, { background: true }).catch(err => console.warn('load newspaper inline photo failed:', err));
        }
    });
}

// ── 主圖 ──
function fallbackHero(meeting, photos) {
    if (photos[0]?.content_path) return { kind: 'photo', photo_id: photos[0].id, content_path: photos[0].content_path, pet: null };
    return { kind: 'scene', context: meeting?.context || 'general' };
}

function renderHero(hero, pet, context) {
    const photoWrap = document.getElementById('mn-hero-photo-wrap');
    const heroImg = document.getElementById('mn-hero-img');
    const heroPet = document.getElementById('mn-hero-pet');
    const scene = document.getElementById('mn-scene');
    const scenePet = document.getElementById('mn-scene-pet');
    const captionPet = document.getElementById('mn-caption-pet');
    if (!photoWrap || !scene) return;
    const petName = pet?.name || '群組寵物';
    const showPet = (img, on) => {
        img.hidden = !on;
        if (on) { img.src = pet.face_url; img.alt = petName; } else img.removeAttribute('src');
    };

    photoWrap.hidden = hero.kind !== 'photo';
    scene.hidden = hero.kind === 'photo';
    showPet(heroPet, false);
    showPet(scenePet, false);
    showPet(captionPet, false);

    if (hero.kind === 'photo') {
        heroImg.removeAttribute('src');
        setProtectedImage(heroImg, hero.content_path).catch(err => console.warn('load newspaper hero failed:', err));
        const spot = hero.pet;
        if (pet?.face_url && spot?.mode === 'overlay') {
            heroPet.style.left = `${spot.x * 100}%`;
            heroPet.style.top = `${spot.y * 100}%`;
            heroPet.style.width = `${spot.w * 100}%`;
            showPet(heroPet, true);
        } else if (pet?.face_url && spot?.mode === 'caption') {
            showPet(captionPet, true);   // 找不到不擋到人的位置：寵物放在圖說旁
        }
        setText('mn-hero-caption-text', pet?.face_url && spot
            ? `▲ 本次聚會留影 · 群組寵物「${petName}」也在現場`
            : '▲ 現場記者拍攝 · 本次聚會留影');
        return;
    }

    // 沒有照片：跟聚會中一模一樣的情境場景
    const ctx = CONTEXT_LABELS[hero.context || context] ? (hero.context || context) : 'general';
    scene.className = `pa-scene-card has-scene scene-${ctx}`;
    scene.classList.toggle('pet-behind', PET_BEHIND.includes(ctx));
    scene.classList.toggle('has-pet', Boolean(pet?.face_url));
    if (pet?.face_url) showPet(scenePet, true);
    setText('mn-hero-caption-text', pet?.face_url
        ? `▲ 群組寵物「${petName}」見證了整場聚會的全程`
        : `▲ 本次聚會情境：${CONTEXT_LABELS[ctx]}`);
}

function collectPhotos(newspaper) {
    const seen = new Set();
    const photos = [];
    const add = (photo) => {
        const path = photo?.content_path || photo?.url || '';
        if (!path || seen.has(path)) return;
        seen.add(path);
        photos.push({ ...photo, content_path: path });
    };
    add(newspaper?.cover_photo);
    (newspaper?.photos || []).forEach(add);
    return photos;
}

function renderGallery(photos) {
    const section = document.getElementById('mn-gallery-section');
    const gallery = document.getElementById('mn-gallery');
    if (!section || !gallery) return;
    gallery.innerHTML = '';
    if (!photos.length) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';
    gallery.style.gridTemplateColumns = photos.length >= 3 ? '1fr 1fr 1fr' : '1fr 1fr';
    photos.forEach(photo => {
        const tile = document.createElement('div');
        tile.className = 'mn-photo-frame mn-gallery-photo';
        gallery.appendChild(tile);
        setProtectedImage(tile, photo.content_path, { background: true }).catch(err => console.warn('load newspaper gallery photo failed:', err));
    });
}

// ── 出席名單：每個參加過的人＋參加分鐘；人多時改成兩欄、三欄往下排，字不縮到看不清楚 ──
function buildRoster(meeting, newspaper) {
    if (Array.isArray(newspaper?.roster) && newspaper.roster.length) return newspaper.roster;
    const duration = Number(meeting?.duration_minutes || 0);
    const ranking = new Map((meeting?.score_ranking || meeting?.deviation_ranking || []).map(r => [r.uid, r]));
    return (meeting?.members_snapshot || []).map(member => {
        const rank = ranking.get(member.uid) || {};
        return {
            uid: member.uid || '',
            name: member.nickname || rank.nickname || '成員',
            attended_minutes: Number(member.attended_minutes ?? rank.attended_minutes ?? duration),
            deviations: rank.deviations ?? null,
        };
    });
}

function renderRoster(roster) {
    const box = document.getElementById('mn-roster');
    if (!box) return;
    box.replaceChildren();
    box.dataset.columns = roster.length > 12 ? '3' : roster.length > 4 ? '2' : '1';
    const myUid = state.currentUser?.uid || state.userId;
    roster.forEach((member, index) => {
        const isMe = Boolean(member.uid && member.uid === myUid);
        const row = document.createElement('div');
        row.className = 'mn-roster-row' + (isMe ? ' me' : '');
        row.innerHTML = `
            <span class="mn-roster-avatar" style="background:${COLORS[index % COLORS.length]};">${EMOJIS[index % EMOJIS.length]}</span>
            <span class="mn-roster-text">
                <span class="mn-roster-name">${escHtml(member.name)}${isMe ? ' <small>（記者本人）</small>' : ''}</span>
                <span class="mn-roster-count">參加 ${Number(member.attended_minutes || 0)} 分鐘</span>
            </span>
        `;
        box.appendChild(row);
    });
}

function formatNewsDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
    return date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value ?? '';
}

function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
