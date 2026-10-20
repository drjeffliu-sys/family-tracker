import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import MealApp from './meal/MealApp'

const LS_MODE = 'app_mode_v1'

function Root() {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem(LS_MODE) || 'money' } catch { return 'money' } })
  const pick = (m) => { setMode(m); try { localStorage.setItem(LS_MODE, m) } catch {} }
  const btn = (a) => ({ flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 16, cursor: 'pointer', background: a ? '#0F172A' : 'transparent', color: a ? '#fff' : '#64748B' })
  return (
    <>
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '10px 12px 0', background: '#F8FAFC', display: 'flex' }}>
        <div style={{ display: 'flex', flex: 1, background: '#E8EDF5', borderRadius: 18, padding: 3 }}>
          <button style={btn(mode === 'money')} onClick={() => pick('money')}>💰 記帳</button>
          <button style={btn(mode === 'meal')} onClick={() => pick('meal')}>🍳 備餐</button>
        </div>
      </div>
      {mode === 'meal' ? <MealApp /> : <App />}
    </>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
