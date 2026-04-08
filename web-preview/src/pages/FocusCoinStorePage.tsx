import { useState } from 'react'

const ITEMS = [
  { id: 1, name: '竹子種子',     icon: '🎋', price: 50,  category: '種子', owned: false },
  { id: 2, name: '楓樹種子',     icon: '🍁', price: 80,  category: '種子', owned: true  },
  { id: 3, name: '櫻花樹種子',   icon: '🌸', price: 120, category: '種子', owned: false },
  { id: 4, name: '仙人掌種子',   icon: '🌵', price: 60,  category: '種子', owned: false },
  { id: 5, name: '水晶花盆',     icon: '💎', price: 200, category: '配件', owned: false },
  { id: 6, name: '金色澆水壺',   icon: '🏺', price: 150, category: '配件', owned: false },
  { id: 7, name: '彩虹肥料',     icon: '🌈', price: 90,  category: '配件', owned: false },
  { id: 8, name: '夜光土壤',     icon: '✨', price: 110, category: '配件', owned: false },
]

const CATEGORIES = ['全部', '種子', '配件']

export default function FocusCoinStorePage() {
  const [activeCategory, setActiveCategory] = useState('全部')
  const [balance] = useState(284)

  const filtered = activeCategory === '全部'
    ? ITEMS
    : ITEMS.filter(i => i.category === activeCategory)

  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col px-5 py-6 gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">商城</h1>
          <p className="text-white/40 text-sm mt-0.5">用專注幣解鎖更多</p>
        </div>
        <div className="flex items-center gap-2 bg-yellow-400/10 border border-yellow-400/30 rounded-2xl px-4 py-2">
          <span className="text-xl">🪙</span>
          <span className="font-bold text-yellow-300 text-lg">{balance}</span>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${
              activeCategory === cat
                ? 'bg-brand-400 text-white'
                : 'bg-surface-700 text-white/50 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 gap-3">
        {filtered.map(item => (
          <div
            key={item.id}
            className={`rounded-2xl p-4 flex flex-col items-center gap-2 border transition-all ${
              item.owned
                ? 'bg-brand-400/10 border-brand-400/30'
                : 'bg-surface-700 border-white/8'
            }`}
          >
            <div className="w-16 h-16 rounded-2xl bg-surface-600 flex items-center justify-center text-4xl">
              {item.icon}
            </div>
            <p className="font-medium text-sm text-center">{item.name}</p>
            <span className="text-[10px] text-white/30 bg-surface-600 px-2 py-0.5 rounded-full">
              {item.category}
            </span>
            {item.owned ? (
              <span className="text-xs text-brand-400 font-medium">✓ 已擁有</span>
            ) : (
              <button
                className={`w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition ${
                  balance >= item.price
                    ? 'bg-yellow-400/20 text-yellow-300 hover:bg-yellow-400/30'
                    : 'bg-surface-600 text-white/20 cursor-not-allowed'
                }`}
                disabled={balance < item.price}
              >
                <span>🪙</span>
                <span>{item.price}</span>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Earn more hint */}
      <div className="bg-surface-700 border border-white/8 rounded-2xl p-4 flex items-center gap-3">
        <span className="text-2xl">💡</span>
        <p className="text-white/50 text-xs leading-relaxed">
          每次聚會最多可獲得 <span className="text-brand-400 font-semibold">150 枚</span> 專注幣。
          全員螢幕朝下時，獲幣速度會提升 2x。
        </p>
      </div>
    </div>
  )
}
