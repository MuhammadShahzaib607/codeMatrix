import { useSelector } from 'react-redux'
import AIPanel from './components/AIPanel/AIPanel'
import EditorArea from './components/Editor/EditorArea'
import Sidebar from './components/Sidebar/Sidebar'
import Toast from './components/Toast/Toast'
import Topbar from './components/Topbar/Topbar'
import useGlobalShortcuts from './hooks/useGlobalShortcuts'
import './App.css'

export default function App() {
  const isSidebarOpen = useSelector((state) => state.ui.isSidebarOpen)
  const isAIPanelOpen = useSelector((state) => state.ui.isAIPanelOpen)

  useGlobalShortcuts()

  return (
    <div className="app">
      <Topbar />

      <div className="app-body">
        <div className={`panel-slot panel-slot-sidebar ${isSidebarOpen ? 'is-open' : ''}`}>
          <Sidebar />
        </div>

        <EditorArea />

        <div className={`panel-slot panel-slot-ai ${isAIPanelOpen ? 'is-open' : ''}`}>
          <AIPanel />
        </div>
      </div>

      <Toast />
    </div>
  )
}
