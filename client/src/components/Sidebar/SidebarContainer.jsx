import { useSelector } from 'react-redux'
import SearchInFiles from './SearchInFiles'
import Sidebar from './Sidebar'

export default function SidebarContainer() {
  const activeView = useSelector((state) => state.ui.activeSidebarView)
  return activeView === 'search' ? <SearchInFiles /> : <Sidebar />
}
