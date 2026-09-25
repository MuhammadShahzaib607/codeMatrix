import { Files, Search } from 'lucide-react'
import { useDispatch, useSelector } from 'react-redux'
import { setActiveSidebarView } from '../../features/uiSlice'
import './ActivityBar.css'

const VIEWS = [
  { id: 'explorer', label: 'Explorer', Icon: Files },
  { id: 'search', label: 'Search in Files', Icon: Search },
]

export default function ActivityBar() {
  const dispatch = useDispatch()
  const activeView = useSelector((state) => state.ui.activeSidebarView)

  return (
    <nav className="activity-bar" aria-label="Activity bar">
      {VIEWS.map(({ id, label, Icon }) => {
        const isActive = activeView === id
        return (
          <button
            key={id}
            type="button"
            className={`activity-item ${isActive ? 'is-active' : ''}`}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
            onClick={() => dispatch(setActiveSidebarView(id))}
          >
            <Icon size={24} />
          </button>
        )
      })}
      <div className="activity-spacer" />
    </nav>
  )
}
