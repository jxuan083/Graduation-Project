// views/meeting-news/meeting-news.js — 後端 newspaper 資料的報紙版面
import { register, switchView } from '../../core/router.js';
import { state } from '../../core/state.js';
import { setProtectedImage } from '../../core/api.js';

const COLORS = ['#a8c8e8', '#f4a442', '#f9c8d0', '#f9d5e5', '#c8e6c9', '#d8b8e8'];
const EMOJIS = ['🐻', '🦊', '🐷', '⭐', '🦁', '🐰'];

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
    document.getElementById('btn-meeting-news-home')?.addEventListener('click', () => switchView('view-home'));
}

export function renderMeetingNews(meeting, newspaper) {
    const members = buildMemberRows(meeting, newspaper);
    const stats = newspaper?.stats || {};
    const duration = Number(meeting?.duration_minutes || stats.duration_minutes || 0);
    const memberCount = Number(meeting?.member_count || stats.member_count || members.length || 0);
    const totalDistractions = Number(meeting?.total_deviations ?? stats.total_deviations ?? sumDistractions(members));
    const mvp = members.slice().sort((a, b) => a.distractions - b.distractions)[0] || { name: '本次聚會', distractions: 0 };
    const generatedAt = newspaper?.generated_at_server || newspaper?.generated_at || meeting?.ended_at || new Date().toISOString();
    const photos = collectPhotos(newspaper);

    state.currentMeetingNewspaper = newspaper || null;

    setText('mn-date', formatNewsDate(generatedAt));
    setText('mn-volume', `VOL. 1 · NO. ${String(meeting?.id || newspaper?.meeting_id || 1).slice(-3).padStart(3, '0')}`);
    setText('mn-headline', buildHeadline(newspaper, memberCount, mvp));
    setText('mn-subhead', `本次聚會歷時 ${duration} 分鐘，共有 ${memberCount} 名成員參與`);
    setText('mn-lead', newspaper?.lead || `【本報訊】一場聚會在眾人的期待中順利落幕。本次活動全程共計 ${duration} 分鐘，吸引了 ${memberCount} 位好友出席。`);
    setText('mn-body-total', `聚會期間，眾人談及近況、分享趣事，並就多項話題進行交流。記錄顯示，全場合計發生 ${totalDistractions} 次分心事件，提醒我們在社交場合仍需要練習把注意力留給彼此。`);
    setText('mn-body-mvp', `在最專注成員評選中，${mvp.name}以僅 ${mvp.distractions} 次分心的表現，榮獲本次聚會「最專注獎」。`);
    setText('mn-body-close', buildClosing(newspaper));
    setText('mn-duration', duration);
    setText('mn-member-count', memberCount);
    setText('mn-total-distractions', totalDistractions);

    renderHero(photos);
    renderGallery(photos);
    renderRoster(members);
}

function buildMemberRows(meeting, newspaper) {
    const memberMap = new Map();
    (meeting?.members_snapshot || state.currentMeetingMembers || []).forEach((member, index) => {
        memberMap.set(member.uid || member.nickname || `member-${index}`, {
            uid: member.uid || '',
            name: member.nickname || member.uid || '成員',
            distractions: 0,
        });
    });

    (newspaper?.participation || []).forEach((person, index) => {
        const uid = person.uid || `participation-${index}`;
        if (!memberMap.has(uid)) {
            memberMap.set(uid, {
                uid,
                name: person.nickname || person.uid || '成員',
                distractions: 0,
            });
        }
    });

    (meeting?.deviation_ranking || []).forEach((item, index) => {
        const uid = item.uid || item.nickname || `rank-${index}`;
        const existing = memberMap.get(uid) || { uid, name: item.nickname || uid || '成員', distractions: 0 };
        existing.name = item.nickname || existing.name;
        existing.distractions = Number(item.deviations || 0);
        memberMap.set(uid, existing);
    });

    const myUid = state.currentUser?.uid || state.userId;
    return Array.from(memberMap.values())
        .map((member, index) => ({
            ...member,
            emoji: EMOJIS[index % EMOJIS.length],
            bg: COLORS[index % COLORS.length],
            isMe: member.uid && member.uid === myUid,
        }))
        .sort((a, b) => a.distractions - b.distractions);
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

function renderHero(photos) {
    const hero = document.getElementById('mn-hero-photo');
    const mascot = document.getElementById('mn-mascot-scene');
    const caption = document.getElementById('mn-hero-caption');
    const inlineWrap = document.getElementById('mn-inline-photo-wrap');
    const inline = document.getElementById('mn-inline-photo');

    if (hero && mascot) {
        hero.style.backgroundImage = '';
        if (photos[0]?.content_path) {
            hero.style.display = '';
            mascot.style.display = 'none';
            setText('mn-hero-caption', '▲ 現場記者拍攝 · 本次聚會留影');
            setProtectedImage(hero, photos[0].content_path, { background: true }).catch(err => console.warn('load newspaper hero failed:', err));
        } else {
            hero.style.display = 'none';
            mascot.style.display = '';
            if (caption) caption.innerText = '▲ 聚會吉祥物「獅子」見證了整場活動的全程';
        }
    }

    if (inlineWrap && inline) {
        inline.style.backgroundImage = '';
        if (photos[1]?.content_path) {
            inlineWrap.style.display = '';
            setProtectedImage(inline, photos[1].content_path, { background: true }).catch(err => console.warn('load newspaper inline photo failed:', err));
        } else {
            inlineWrap.style.display = 'none';
        }
    }
}

function renderGallery(photos) {
    const section = document.getElementById('mn-gallery-section');
    const gallery = document.getElementById('mn-gallery');
    if (!section || !gallery) return;
    const extras = photos.slice(2);
    gallery.innerHTML = '';
    if (!extras.length) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';
    gallery.style.gridTemplateColumns = extras.length >= 3 ? '1fr 1fr 1fr' : '1fr 1fr';
    extras.forEach(photo => {
        const tile = document.createElement('div');
        tile.className = 'mn-photo-frame mn-gallery-photo';
        gallery.appendChild(tile);
        setProtectedImage(tile, photo.content_path, { background: true }).catch(err => console.warn('load newspaper gallery photo failed:', err));
    });
}

function renderRoster(members) {
    const roster = document.getElementById('mn-roster');
    if (!roster) return;
    roster.innerHTML = '';
    members.forEach((member, index) => {
        const row = document.createElement('div');
        row.className = 'mn-roster-row' + (member.isMe ? ' me' : '');
        row.innerHTML = `
            <span class="mn-roster-rank">${index + 1}</span>
            <span class="mn-roster-avatar" style="background:${member.bg};">${member.emoji}</span>
            <span class="mn-roster-name">${escHtml(member.name)}${member.isMe ? ' <small>（記者本人）</small>' : ''}</span>
            <span class="mn-roster-count">${member.distractions} 次</span>
        `;
        roster.appendChild(row);
    });
}

function buildHeadline(newspaper, memberCount, mvp) {
    if (newspaper?.title && newspaper.title !== 'Party Newspaper') return newspaper.title;
    return `${memberCount || '多'}人聚會圓滿落幕，\n${mvp.name}奪下最專注獎`;
}

function buildClosing(newspaper) {
    const highlights = newspaper?.highlights || [];
    if (highlights.length) return `聚會尾聲，系統整理出本場亮點：「${highlights[0]}」。本報期待下一次聚會能帶來更多精彩故事。`;
    return '聚會尾聲，眾人一致表示意猶未盡，並約定擇日再聚。本報期待下一次聚會能帶來更多精彩故事。';
}

function sumDistractions(members) {
    return members.reduce((sum, member) => sum + Number(member.distractions || 0), 0);
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
