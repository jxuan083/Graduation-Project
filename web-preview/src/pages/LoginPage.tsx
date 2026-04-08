export default function LoginPage() {
  return (
    <div className="min-h-[calc(100vh-3rem)] flex flex-col items-center justify-center px-6 gap-8">
      {/* Logo */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center shadow-2xl shadow-brand-400/30">
          <span className="text-5xl">🌿</span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight">NearU</h1>
        <p className="text-white/50 text-sm text-center leading-relaxed max-w-[240px]">
          放下手機，專注當下。<br />一起讓聚會更有意義。
        </p>
      </div>

      {/* Auth buttons */}
      <div className="w-full flex flex-col gap-3">
        <button className="w-full flex items-center justify-center gap-3 bg-white text-gray-800 font-semibold py-3.5 rounded-2xl hover:bg-gray-100 transition">
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="" />
          使用 Google 帳號登入
        </button>
        <button className="w-full flex items-center justify-center gap-3 bg-surface-700 border border-white/10 font-semibold py-3.5 rounded-2xl hover:bg-surface-600 transition">
          <span className="text-xl">🍎</span>
          使用 Apple 帳號登入
        </button>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 w-full">
        <div className="flex-1 h-px bg-white/10" />
        <span className="text-white/30 text-xs">或</span>
        <div className="flex-1 h-px bg-white/10" />
      </div>

      {/* Email */}
      <div className="w-full flex flex-col gap-3">
        <input
          type="email"
          placeholder="電子郵件"
          className="w-full bg-surface-700 border border-white/10 rounded-xl px-4 py-3 text-sm placeholder-white/30 focus:outline-none focus:border-brand-400 transition"
        />
        <input
          type="password"
          placeholder="密碼"
          className="w-full bg-surface-700 border border-white/10 rounded-xl px-4 py-3 text-sm placeholder-white/30 focus:outline-none focus:border-brand-400 transition"
        />
        <button className="w-full bg-brand-400 hover:bg-brand-500 font-semibold py-3.5 rounded-2xl transition shadow-lg shadow-brand-400/25">
          登入
        </button>
      </div>

      <p className="text-white/30 text-xs">
        還沒有帳號？<span className="text-brand-400 cursor-pointer">立即註冊</span>
      </p>
    </div>
  )
}
