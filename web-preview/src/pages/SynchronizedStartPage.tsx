import { useState } from 'react'

const PARTICIPANTS = [
  { id: 1, name: 'Andy (你)',  ready: true,  color: '#4CAF82' },
  { id: 2, name: 'Sara',       ready: true,  color: '#60a5fa' },
  { id: 3, name: 'Kevin',      ready: false, color: '#f59e0b' },
  { id: 4, name: 'Mei',        ready: false, color: '#e879f9' },
]

export default function SynchronizedStartPage() {
  const [swiped, setSwiped] = useState(false)
  const readyCount = PARTICIPANTS.filter((p) => p.ready).length + (swiped ? 0 : 0)

  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col items-center px-6 py-8 gap-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold">準備好了嗎？</h1>
        <p className="text-white/50 text-sm mt-1">所有人同時滑動才能開始聚會</p>
      </div>

      {/* Room code */}
      <div className="bg-surface-700 border border-white/10 rounded-2xl px-6 py-3 flex items-center gap-3">
        <span className="text-white/40 text-sm">房間代碼</span>
        <span className="font-mono font-bold text-lg text-brand-400 tracking-widest">NR·4829</span>
      </div>

      {/* Participants */}
      <div className="w-full grid grid-cols-2 gap-3">
        {PARTICIPANTS.map((p) => (
          <div
            key={p.id}
            className={`flex flex-col items-center gap-2 rounded-2xl p-4 border transition-all ${
              p.ready
                ? 'bg-brand-400/10 border-brand-400/40'
                : 'bg-surface-700 border-white/8'
            }`}
          >
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold relative"
              style={{ background: p.color + '33', border: `2px solid ${p.color}` }}
            >
              {p.name[0]}
              {p.ready && (
                <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-brand-400 rounded-full flex items-center justify-center text-[10px]">
                  ✓
                </div>
              )}
            </div>
            <span className="text-sm font-medium truncate w-full text-center">{p.name}</span>
            <span className={`text-xs ${p.ready ? 'text-brand-400' : 'text-white/30'}`}>
              {p.ready ? '已準備' : '等待中…'}
            </span>
          </div>
        ))}
      </div>

      {/* Progress */}
      <div className="w-full">
        <div className="flex justify-between text-xs text-white/40 mb-2">
          <span>已準備</span>
          <span>{readyCount} / {PARTICIPANTS.length}</span>
        </div>
        <div className="w-full h-2 bg-surface-600 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-400 rounded-full transition-all duration-500"
            style={{ width: `${(readyCount / PARTICIPANTS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Swipe to start */}
      <div className="mt-auto w-full">
        <p className="text-center text-white/40 text-xs mb-3">等待所有人準備完畢後，同時向右滑動</p>
        <div
          className={`relative w-full h-16 rounded-2xl border-2 overflow-hidden cursor-pointer select-none transition-all ${
            swiped
              ? 'bg-brand-400 border-brand-400'
              : 'bg-surface-700 border-white/20'
          }`}
          onClick={() => setSwiped(!swiped)}
        >
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-semibold text-sm">
              {swiped ? '✓ 已準備！等待其他人…' : '← 滑動解鎖，開始聚會 →'}
            </span>
          </div>
          {!swiped && (
            <div className="absolute left-2 top-2 bottom-2 w-12 bg-white/10 rounded-xl flex items-center justify-center text-xl animate-pulse">
              👋
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
