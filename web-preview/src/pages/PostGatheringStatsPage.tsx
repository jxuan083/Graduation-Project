const STATS = [
  { label: '專注時間',   value: '47:23', icon: '⏱️', color: 'text-brand-400' },
  { label: '中斷次數',   value: '2 次',  icon: '📱', color: 'text-yellow-400' },
  { label: '獲得代幣',   value: '+94',   icon: '🪙', color: 'text-yellow-300' },
  { label: '植物成長',   value: '+38%',  icon: '🌿', color: 'text-green-400' },
]

const ACHIEVEMENTS = [
  { icon: '🏆', title: '鐵石心腸',    desc: '聚會中未使用手機超過 45 分鐘' },
  { icon: '🤝', title: '全員專注',    desc: '所有成員同時保持螢幕朝下 10 分鐘' },
  { icon: '🌱', title: '初次發芽',    desc: '第一次成功完成聚會儀式' },
]

const PARTICIPANT_STATS = [
  { name: 'Andy (你)', faceDownPct: 96, interrupts: 0,  color: '#4CAF82' },
  { name: 'Sara',      faceDownPct: 91, interrupts: 1,  color: '#60a5fa' },
  { name: 'Kevin',     faceDownPct: 74, interrupts: 3,  color: '#f59e0b' },
  { name: 'Mei',       faceDownPct: 88, interrupts: 2,  color: '#e879f9' },
]

export default function PostGatheringStatsPage() {
  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col px-5 py-6 gap-6">
      {/* Header */}
      <div className="text-center">
        <div className="text-6xl mb-2">🌳</div>
        <h1 className="text-2xl font-bold">聚會結束！</h1>
        <p className="text-white/50 text-sm mt-1">你們的植物長大了 38%</p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {STATS.map((s) => (
          <div key={s.label} className="bg-surface-700 rounded-2xl p-4 flex flex-col gap-1">
            <span className="text-2xl">{s.icon}</span>
            <span className={`text-xl font-bold ${s.color}`}>{s.value}</span>
            <span className="text-white/40 text-xs">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Per-person breakdown */}
      <div>
        <p className="text-white/40 text-xs mb-3 font-medium uppercase tracking-wider">成員表現</p>
        <div className="flex flex-col gap-2.5">
          {PARTICIPANT_STATS.map((p) => (
            <div key={p.name} className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                style={{ background: p.color + '33', border: `2px solid ${p.color}` }}
              >
                {p.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium truncate">{p.name}</span>
                  <span className="text-white/40">{p.faceDownPct}% 螢幕朝下</span>
                </div>
                <div className="w-full h-2 bg-surface-600 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${p.faceDownPct}%`, background: p.color }}
                  />
                </div>
              </div>
              <span className="text-xs text-white/30 shrink-0">{p.interrupts}次中斷</span>
            </div>
          ))}
        </div>
      </div>

      {/* Achievements */}
      <div>
        <p className="text-white/40 text-xs mb-3 font-medium uppercase tracking-wider">解鎖成就</p>
        <div className="flex flex-col gap-2">
          {ACHIEVEMENTS.map((a) => (
            <div key={a.title} className="flex items-center gap-3 bg-surface-700 rounded-xl p-3">
              <span className="text-2xl">{a.icon}</span>
              <div>
                <p className="font-semibold text-sm">{a.title}</p>
                <p className="text-white/40 text-xs">{a.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="flex flex-col gap-3 mt-auto">
        <button className="w-full bg-brand-400 hover:bg-brand-500 font-semibold py-3.5 rounded-2xl transition shadow-lg shadow-brand-400/25">
          前往商城兌換
        </button>
        <button className="w-full text-white/40 text-sm py-2 hover:text-white/60 transition">
          分享給朋友
        </button>
      </div>
    </div>
  )
}
