import { useState, useCallback, useRef } from 'react'
import './App.css'

const MOODS = ['calm', 'loud', 'warm', 'lonely', 'bright']

const MOOD_PAGES = { calm: 1, loud: 3, warm: 5, lonely: 7, bright: 9 }

const MOOD_EMOJI = { calm: '🫂', loud: '🤘', warm: '☀️', lonely: '🌙', bright: '✨' }

function App() {
  const [activeMood, setActiveMood] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [images, setImages] = useState([])
  const abortRef = useRef(null)

  const fetchMood = useCallback(async (mood) => {
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setActiveMood(mood)
    setLoading(true)
    setError(null)
    setImages([])

    try {
      const page = MOOD_PAGES[mood]
      const res = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=5`, {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (controller.signal.aborted) return
      setImages(
        data.map((img) => ({
          id: img.id,
          url: img.download_url,
          author: img.author,
        }))
      )
      setLoading(false)
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message || 'Failed to load images')
      setLoading(false)
    }
  }, [])

  const retry = useCallback(() => {
    if (activeMood) fetchMood(activeMood)
  }, [activeMood, fetchMood])

  return (
    <div className="app">
      <h1 className="title">The Vibe Atlas</h1>
      <p className="subtitle">pick a mood, find the view</p>

      <div className="moods">
        {MOODS.map((m) => (
          <button
            key={m}
            className={'mood-btn' + (activeMood === m ? ' active' : '')}
            onClick={() => fetchMood(m)}
            disabled={loading}
          >
            <span className="mood-emoji">{MOOD_EMOJI[m]}</span>
            <span className="mood-label">{m}</span>
          </button>
        ))}
      </div>

      <div className="grid">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" />
          ))
        ) : error ? (
          <div className="error-card">
            <p className="error-msg">{error}</p>
            <button className="retry-btn" onClick={retry}>
              retry
            </button>
          </div>
        ) : images.length > 0 ? (
          images.map((img) => (
            <div key={img.id} className="img-card">
              <img
                className="img-src"
                src={`${img.url}?w=400&h=300`}
                alt={`by ${img.author}`}
                loading="lazy"
              />
              <span className="img-author">{img.author}</span>
            </div>
          ))
        ) : (
          <p className="empty">select a mood to explore</p>
        )}
      </div>
    </div>
  )
}

export default App
