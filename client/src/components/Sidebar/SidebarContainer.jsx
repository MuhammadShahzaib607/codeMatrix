import { useSelector } from 'react-redux'
import SearchInFiles from './SearchInFiles'
import Sidebar from './Sidebar'

/**
 * The sidebar slot's content. Both panels render the same `.sidebar` frame, so
 * switching views keeps the width and layout identical — only the body swaps.
 */
export default function SidebarContainer() {
  const activeView = useSelector((state) => state.ui.activeSidebarView)
  return activeView === 'search' ? <SearchInFiles /> : <Sidebar />
}
