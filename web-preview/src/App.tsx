import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import PermissionsPage from './pages/PermissionsPage'
import GatheringRadarPage from './pages/GatheringRadarPage'
import SynchronizedStartPage from './pages/SynchronizedStartPage'
import DashboardPage from './pages/DashboardPage'
import PostGatheringStatsPage from './pages/PostGatheringStatsPage'
import FocusCoinStorePage from './pages/FocusCoinStorePage'

const NAV_ITEMS = [
  { path: '/login',      label: 'Login' },
  { path: '/permissions',label: 'Permissions' },
  { path: '/radar',      label: 'Radar' },
  { path: '/ritual',     label: 'Ritual' },
  { path: '/dashboard',  label: '🌿 Dashboard' },
  { path: '/summary',    label: 'Summary' },
  { path: '/shop',       label: 'Shop' },
]

function DevNav() {
  const location = useLocation()
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-surface-800/90 backdrop-blur border-b border-white/10">
      <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto scrollbar-none">
        <span className="text-brand-400 font-bold text-sm mr-2 shrink-0">NearU</span>
        {NAV_ITEMS.map(({ path, label }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                isActive
                  ? 'bg-brand-400 text-white'
                  : 'text-white/50 hover:text-white hover:bg-white/10'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <DevNav />
      {/* phone frame container */}
      <div className="min-h-screen pt-12 flex items-start justify-center py-4 px-4">
        <div className="w-full max-w-sm">
          <Routes>
            <Route path="/"            element={<LoginPage />} />
            <Route path="/login"       element={<LoginPage />} />
            <Route path="/permissions" element={<PermissionsPage />} />
            <Route path="/radar"       element={<GatheringRadarPage />} />
            <Route path="/ritual"      element={<SynchronizedStartPage />} />
            <Route path="/dashboard"   element={<DashboardPage />} />
            <Route path="/summary"     element={<PostGatheringStatsPage />} />
            <Route path="/shop"        element={<FocusCoinStorePage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  )
}
