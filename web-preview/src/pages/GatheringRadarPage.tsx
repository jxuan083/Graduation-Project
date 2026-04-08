const NEARBY_USERS = [
  { id: 1, name: 'Andy',   dist: '3m',  angle: 40,  r: 28, color: '#4CAF82' },
  { id: 2, name: 'Sara',   dist: '8m',  angle: 140, r: 52, color: '#60a5fa' },
  { id: 3, name: 'Kevin',  dist: '15m', angle: 230, r: 72, color: '#f59e0b' },
  { id: 4, name: 'Mei',    dist: '12m', angle: 310, r: 62, color: '#e879f9' },
]

function toXY(angleDeg: number, radiusPct: number, size: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180)
  const r = (radiusPct / 100) * (size / 2)
  return {
    x: size / 2 + r * Math.cos(rad),
    y: size / 2 + r * Math.sin(rad),
  }
}

export default function GatheringRadarPage() {
  const SIZE = 280

  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col px-6 py-6 gap-6">
      <div>
        <h1 className="text-2xl font-bold">附近的朋友</h1>
        <p className="text-white/40 text-sm mt-1">找到 4 位朋友 · 台北信義區</p>
      </div>

      {/* Radar */}
      <div className="flex justify-center">
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          {/* rings */}
          {[0.33, 0.66, 1].map((s, i) => (
            <div
              key={i}
              className="absolute rounded-full border border-brand-400/20"
              style={{
                width: SIZE * s, height: SIZE * s,
                top: (SIZE - SIZE * s) / 2, left: (SIZE - SIZE * s) / 2,
              }}
            />
          ))}
          {/* animated sweep rings */}
          {[0, 1, 2].map((i) => (
            <div
              key={`r${i}`}
              className="radar-ring absolute rounded-full border border-brand-400/40"
              style={{
                width: 60, height: 60,
                top: SIZE / 2 - 30, left: SIZE / 2 - 30,
                animationDelay: `${i * 0.8}s`,
              }}
            />
          ))}
          {/* crosshair */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-px h-full bg-brand-400/10 absolute" />
            <div className="h-px w-full bg-brand-400/10 absolute" />
          </div>
          {/* self dot */}
          <div
            className="absolute w-5 h-5 rounded-full bg-brand-400 border-2 border-white shadow-lg shadow-brand-400/50 flex items-center justify-center"
            style={{ top: SIZE / 2 - 10, left: SIZE / 2 - 10 }}
          />
          {/* user dots */}
          {NEARBY_USERS.map((u) => {
            const { x, y } = toXY(u.angle, u.r, SIZE)
            return (
              <div
                key={u.id}
                className="absolute flex flex-col items-center gap-1"
                style={{ top: y - 14, left: x - 14 }}
              >
                <div
                  className="w-7 h-7 rounded-full border-2 border-white/80 flex items-center justify-center text-xs font-bold shadow-lg"
                  style={{ background: u.color }}
                >
                  {u.name[0]}
                </div>
                <span className="text-[10px] text-white/60 bg-surface-800/80 px-1 rounded">
                  {u.dist}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* User list */}
      <div className="flex flex-col gap-2">
        {NEARBY_USERS.map((u) => (
          <div key={u.id} className="flex items-center gap-3 bg-surface-700 rounded-xl p-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm"
              style={{ background: u.color }}
            >
              {u.name[0]}
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">{u.name}</p>
              <p className="text-white/40 text-xs">距離 {u.dist}</p>
            </div>
            <button className="text-xs bg-brand-400/20 text-brand-400 px-3 py-1.5 rounded-lg hover:bg-brand-400/30 transition">
              邀請
            </button>
          </div>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <button className="w-full bg-brand-400 hover:bg-brand-500 font-semibold py-3.5 rounded-2xl transition shadow-lg shadow-brand-400/25">
          建立聚會房間
        </button>
        <button className="w-full bg-surface-700 border border-white/10 font-semibold py-3.5 rounded-2xl hover:bg-surface-600 transition">
          輸入房間代碼加入
        </button>
      </div>
    </div>
  )
}
