import { Files, PanelLeft, Search } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { setActiveSidebarView, toggleSidebar } from '../../features/uiSlice'
import Tooltip from '../Common/Tooltip'
import './ActivityBar.css'

const VIEWS = [
  { id: 'explorer', label: 'Explorer', Icon: Files },
  { id: 'search', label: 'Search in Files', Icon: Search },
]

export default function ActivityBar() {
  const dispatch = useDispatch()
  const activeView = useSelector((state) => state.ui.activeSidebarView)
  const isSidebarOpen = useSelector((state) => state.ui.isSidebarOpen)

  return (
    <nav className="activity-bar" aria-label="Activity bar">
      {/* Sidebar toggle lives at the very top of the rail, above the views. */}
      <Tooltip label={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'} side="right">
        <button
          type="button"
          className={`activity-item ${isSidebarOpen ? 'is-active' : ''}`}
          aria-label="Toggle sidebar"
          aria-pressed={isSidebarOpen}
          onClick={() => dispatch(toggleSidebar())}
        >
          <PanelLeft size={22} />
        </button>
      </Tooltip>

      <div className="activity-divider" />

      {VIEWS.map(({ id, label, Icon }) => {
        const isActive = activeView === id
        return (
          <Tooltip key={id} label={label} side="right">
            <button
              type="button"
              className={`activity-item ${isActive ? 'is-active' : ''}`}
              aria-label={label}
              aria-pressed={isActive}
              onClick={() => dispatch(setActiveSidebarView(id))}
            >
              <Icon size={24} />
            </button>
          </Tooltip>
        )
      })}
      <div className="activity-spacer" />
    </nav>
  )
}
