import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import Playground from './playground/Playground'

const isPlayground = window.location.pathname.replace(/\/+$/, '') === '/playground'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isPlayground ? <Playground /> : <App />}
  </StrictMode>,
)
