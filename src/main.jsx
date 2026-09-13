import 'cesium/Build/Cesium/Widgets/widgets.css'
import 'maplibre-gl/dist/maplibre-gl.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DesignModeOverlay from './ui/DesignModeOverlay.jsx'
import DevBuildIdentity from './ui/DevBuildIdentity.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <DesignModeOverlay />
    <DevBuildIdentity />
  </StrictMode>,
)
