const PERMISSIONS = [
  {
    icon: '📍',
    title: '定位服務',
    subtitle: '前景與背景位置存取',
    desc: '用於偵測附近朋友、建立聚會房間，以及在聚會中監控是否有人離開範圍。',
    required: true,
  },
  {
    icon: '📡',
    title: '藍牙',
    subtitle: 'Bluetooth LE 掃描',
    desc: '在 GPS 精度不足的室內環境，用藍牙訊號輔助判斷附近使用者距離。',
    required: true,
  },
  {
    icon: '🔔',
    title: '通知',
    subtitle: '推播通知',
    desc: '當朋友邀請你加入聚會、或聚會即將開始時通知你。',
    required: false,
  },
  {
    icon: '⚡',
    title: '背景執行',
    subtitle: '允許背景活動',
    desc: '讓 NearU 在螢幕關閉時持續偵測手機是否「螢幕朝下」。',
    required: true,
  },
]

export default function PermissionsPage() {
  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col px-6 py-8 gap-6">
      <div>
        <h1 className="text-2xl font-bold">需要幾個權限</h1>
        <p className="text-white/50 text-sm mt-1">
          NearU 需要以下權限才能正常運作。我們不會在聚會以外使用你的位置資訊。
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {PERMISSIONS.map((p) => (
          <div
            key={p.title}
            className="bg-surface-700 border border-white/8 rounded-2xl p-4 flex gap-4"
          >
            <div className="w-12 h-12 rounded-xl bg-surface-600 flex items-center justify-center text-2xl shrink-0">
              {p.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{p.title}</span>
                {p.required && (
                  <span className="text-[10px] bg-brand-400/20 text-brand-400 px-1.5 py-0.5 rounded-full">
                    必要
                  </span>
                )}
              </div>
              <p className="text-white/40 text-xs mt-0.5">{p.subtitle}</p>
              <p className="text-white/60 text-xs mt-1.5 leading-relaxed">{p.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <button className="w-full bg-brand-400 hover:bg-brand-500 font-semibold py-3.5 rounded-2xl transition shadow-lg shadow-brand-400/25">
          授予所有權限
        </button>
        <button className="w-full text-white/40 text-sm py-2 hover:text-white/60 transition">
          稍後再說
        </button>
      </div>
    </div>
  )
}
