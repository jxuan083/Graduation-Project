import { useState, useEffect } from 'react'

const PARTICIPANTS = [
  { id: 1, name: 'Andy',  faceDown: true,  color: '#4CAF82' },
  { id: 2, name: 'Sara',  faceDown: true,  color: '#60a5fa' },
  { id: 3, name: 'Kevin', faceDown: false, color: '#f59e0b' },
  { id: 4, name: 'Mei',   faceDown: true,  color: '#e879f9' },
]

function CognitiveBufferModal({ onClose }: { onClose: () => void }) {
  const [secs, setSecs] = useState(30)

  useEffect(() => {
    if (secs <= 0) { onClose(); return }
    const t = setTimeout(() => setSecs(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [secs, onClose])

  const pct = secs / 30
  const r = 44
  const circ = 2 * Math.PI * r

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end justify-center p-4">
      <div className="w-full max-w-sm bg-surface-800 rounded-3xl p-6 flex flex-col items-center gap-5">
        <h2 className="text-xl font-bold">真的需要手機嗎？</h2>
        <p className="text-white/50 text-sm text-center">
          先深呼吸 30 秒。如果真的需要，倒數結束後就可以使用。
        </p>

        {/* SVG countdown ring */}
        <div className="relative w-32 h-32 flex items-center justify-center">
          <svg className="absolute inset-0 w-full h-full ring-progress" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r={r} fill="none" stroke="#243040" strokeWidth="8" />
            <circle
              cx="50" cy="50" r={r}
              fill="none"
              stroke="#4CAF82"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - pct)}
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
          <span className="text-4xl font-bold text-brand-400">{secs}</span>
        </div>

        <button
          onClick={onClose}
          className="w-full bg-brand-400 hover:bg-brand-500 font-semibold py-3.5 rounded-2xl transition"
        >
          沒事了，我回來了 👏
        </button>
        <button
          onClick={onClose}
          className="text-sm text-red-400 hover:text-red-300 transition"
        >
          我真的需要用手機
        </button>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [seconds, setSeconds] = useState(0)
  const [growth, setGrowth] = useState(0.38)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    const t = setInterval(() => {
      setSeconds(s => s + 1)
      setGrowth(g => Math.min(g + 0.001, 1))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  const allFocused = PARTICIPANTS.every(p => p.faceDown)

  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col">
      {showModal && <CognitiveBufferModal onClose={() => setShowModal(false)} />}

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex -space-x-2">
          {PARTICIPANTS.map(p => (
            <div
              key={p.id}
              className="w-8 h-8 rounded-full border-2 border-surface-900 flex items-center justify-center text-xs font-bold"
              style={{ background: p.color }}
            >
              {p.name[0]}
            </div>
          ))}
        </div>
        <div className="text-center">
          <p className="font-mono text-2xl font-bold text-brand-400">{mm}:{ss}</p>
          <p className="text-white/30 text-[10px]">聚會時長</p>
        </div>
        <div className="flex items-center gap-1.5 bg-surface-700 rounded-full px-3 py-1.5">
          <span className="text-yellow-400 text-sm">🪙</span>
          <span className="text-sm font-semibold">128</span>
        </div>
      </div>

      {/* Plant area */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        {/* Plant */}
        <div className="float text-center">
          <div
            className="text-[110px] leading-none select-none"
            style={{ filter: `hue-rotate(${(1 - growth) * -40}deg) saturate(${0.5 + growth * 0.5})` }}
          >
            {growth < 0.3 ? '🌱' : growth < 0.6 ? '🌿' : growth < 0.85 ? '🌳' : '🌲'}
          </div>
        </div>

        {/* Growth bar */}
        <div className="w-full max-w-[240px]">
          <div className="flex justify-between text-xs text-white/40 mb-1.5">
            <span>植物成長</span>
            <span>{Math.round(growth * 100)}%</span>
          </div>
          <div className="w-full h-3 bg-surface-600 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-brand-600 to-brand-400 rounded-full transition-all duration-1000"
              style={{ width: `${growth * 100}%` }}
            />
          </div>
          <p className="text-center text-white/30 text-xs mt-1.5">
            {allFocused ? '🟢 所有人專注中' : '🟡 有人分心了'}
          </p>
        </div>
      </div>

      {/* Participant row */}
      <div className="px-5 pb-4">
        <p className="text-white/30 text-xs mb-3">成員狀態</p>
        <div className="grid grid-cols-4 gap-2">
          {PARTICIPANTS.map(p => (
            <div key={p.id} className="flex flex-col items-center gap-1.5">
              <div
                className={`w-12 h-12 rounded-2xl flex items-center justify-center text-xl transition-all ${
                  p.faceDown
                    ? 'bg-brand-400/20 border border-brand-400/40'
                    : 'bg-red-500/20 border border-red-500/40'
                }`}
              >
                {p.faceDown ? '📵' : '📱'}
              </div>
              <span className="text-[10px] text-white/50">{p.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* SOS button */}
      <div className="px-5 pb-8">
        <button
          onClick={() => setShowModal(true)}
          className="w-full border border-red-500/40 text-red-400 hover:bg-red-500/10 font-medium py-3.5 rounded-2xl transition flex items-center justify-center gap-2"
        >
          <span>🆘</span> 我需要用手機
        </button>
      </div>
    </div>
  )
}
