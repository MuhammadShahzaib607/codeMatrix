import { Bot, TerminalSquare } from 'lucide-react'
import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { setRightPanelTab } from '../../features/uiSlice'
import AIPanel from '../AIPanel/AIPanel'
import AgentPlaceholder from './AgentPlaceholder'
import SidebarTerminal from './SidebarTerminal'
import './RightPanel.css'

const VIEWS = [
  { id: 'agent', label: 'Agent', Icon: Bot },
  { id: 'terminal', label: 'Terminal', Icon: TerminalSquare },
]

/**
 * The right sidebar. A two-button segmented switch picks between the AI agent
 * and a terminal. Both views stay mounted; only the active one is visible, so
 * switching never tears down the agent run or the terminal pty. The terminal
 * view is only kept in the DOM once it has been created (or while its tab is
 * selected), so a plain page load with the Agent tab does not spawn a shell.
 */
export default function RightPanel() {
  const dispatch = useDispatch()
  const storedTab = useSelector((state) => state.ui.rightPanelTab)
  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)
  const user = useSelector((state) => state.auth.user)
  const isAuthenticated = useSelector((state) => state.auth.isAuthenticated)
  const authLoading = useSelector((state) => state.auth.loading)
  const hasSidebarTerminal = useSelector(
    (state) => Boolean(state.sidebarTerminal.terminalId),
  )

  const isAdmin = user?.role === 'admin'
  const roleResolved = !authLoading && (!isAuthenticated || Boolean(user))
  const activeTab = storedTab ?? (isAdmin ? 'agent' : 'terminal')

  useEffect(() => {
    if (storedTab || !roleResolved) return
    dispatch(setRightPanelTab(isAdmin ? 'agent' : 'terminal'))
  }, [storedTab, roleResolved, isAdmin, dispatch])

  return (
    <div className="right-panel">
      <div className="right-panel-switch" role="tablist" aria-label="Right sidebar view">
        {VIEWS.map(({ id, label, Icon }) => (
          <button
            key={id}
            id={`right-panel-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`right-panel-view-${id}`}
            className={`right-panel-tab ${activeTab === id ? 'is-active' : ''}`}
            onClick={() => dispatch(setRightPanelTab(id))}
          >
            <Icon size={13} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="right-panel-body">
        <div
          id="right-panel-view-agent"
          role="tabpanel"
          aria-labelledby="right-panel-tab-agent"
          aria-hidden={activeTab !== 'agent'}
          className={`right-panel-view ${activeTab === 'agent' ? 'is-active' : ''}`}
        >
          {isAdmin ? <AIPanel /> : <AgentPlaceholder />}
        </div>

        {(hasSidebarTerminal || (activeTab === 'terminal' && isAIPanelOpen)) && (
          <div
            id="right-panel-view-terminal"
            role="tabpanel"
            aria-labelledby="right-panel-tab-terminal"
            aria-hidden={activeTab !== 'terminal'}
            className={`right-panel-view ${activeTab === 'terminal' ? 'is-active' : ''}`}
          >
            <SidebarTerminal />
          </div>
        )}
      </div>
    </div>
  )
}
