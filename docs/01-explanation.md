# Vibe Atlas — Line-by-Line (ELI7)

## `main.jsx`

```jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- **`StrictMode`** — A React wrapper that doesn't show anything on screen. It double-runs effects and renders in development to help catch bugs. No effect on production.
- **`createRoot(...).render(...)`** — Finds the `<div id="root">` in `index.html` and tells React "render the Vibe Atlas app here."
- **`<App />`** — The main component. Everything lives inside it.

---

## `App.jsx` — Imports & Constants

```jsx
import { useState, useCallback, useRef } from 'react'
import './App.css'
```

- **`useState`** — Creates a variable React watches. When you change it with the setter function, React re-renders the parts of the screen that use that variable.
- **`useCallback`** — "Remembers" a function between renders so it doesn't get re-created every time. The function is only re-created when its dependency array changes.
- **`useRef`** — Creates a mutable box that survives re-renders. Unlike state, changing a ref does NOT trigger a re-render. Used here to hold the AbortController across renders.

```jsx
const MOODS = ['calm', 'loud', 'warm', 'lonely', 'bright']

const MOOD_PAGES = { calm: 1, loud: 3, warm: 5, lonely: 7, bright: 9 }

const MOOD_EMOJI = { calm: '🫂', loud: '🤘', warm: '☀️', lonely: '🌙', bright: '✨' }
```

- Three constant lookup tables defined **outside** the component (no re-creation on render).
- `MOODS` — The five mood names used to generate buttons.
- `MOOD_PAGES` — Each mood maps to a page number on picsum.photos. `calm` = page 1, `loud` = page 3, etc. Different pages give different images.
- `MOOD_EMOJI` — Each mood gets an emoji for its button.

---

## State Declarations

```jsx
function App() {
  const [activeMood, setActiveMood] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [images, setImages] = useState([])
  const abortRef = useRef(null)
```

Five pieces of state/ref:

| Variable | Type | Initial | Purpose |
|---|---|---|---|
| `activeMood` | string or null | `null` | Which mood button is currently selected |
| `loading` | boolean | `false` | Are we waiting for a fetch right now? |
| `error` | string or null | `null` | Error message if the last fetch failed |
| `images` | array | `[]` | The list of fetched image objects |
| `abortRef` | ref (object with `.current`) | `null` | Holds the current AbortController so we can cancel in-flight requests |

### 🚩 Beginner trap: ref vs state

`abortRef` is a `useRef`, not `useState`. Changing `abortRef.current` does NOT cause a re-render. That's intentional — the AbortController is a tool, not UI data. We don't need the screen to update when we replace it. We just need to remember it.

---

## `fetchMood()` — The fetch function

```jsx
  const fetchMood = useCallback(async (mood) => {
```

`useCallback` with `[]` (empty dependency array) means this function is created **once** when the component mounts and never again. It's stable forever.

### 🚩 Beginner trap: `useCallback` with empty deps `[]`

Because the dependencies are empty, `fetchMood` captures the initial values of `loading`, `error`, `images` — but this doesn't matter here because `fetchMood` uses the **setter functions** (`setLoading`, `setError`, `setImages`) which are themselves stable (React guarantees setter identity never changes). And `abortRef` is a ref — `abortRef.current` is always the latest value even inside a stale closure.

---

### Abort previous request

```jsx
    if (abortRef.current) abortRef.current.abort()
```

- If there is already a fetch in flight (an AbortController stored in `abortRef`), cancel it immediately.
- `controller.abort()` causes the in-flight `fetch` to throw an `AbortError`.
- This prevents stale responses: if the user clicks "loud" then quickly "warm," the "loud" request is cancelled and its response never sets state.

---

### Create new AbortController

```jsx
    const controller = new AbortController()
    abortRef.current = controller
```

- Create a fresh `AbortController` and store it in the ref so it can be aborted later if needed.

---

### Set loading state

```jsx
    setActiveMood(mood)
    setLoading(true)
    setError(null)
    setImages([])
```

- **`setActiveMood(mood)`** — Highlights the clicked button.
- **`setLoading(true)`** — Shows skeleton placeholders.
- **`setError(null)`** — Clears any previous error message.
- **`setImages([])`** — Empties old images so we don't show stale data while loading.

These four state updates are batched by React — they trigger a single re-render.

---

### The fetch call

```jsx
    try {
      const page = MOOD_PAGES[mood]
      const res = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=5`, {
        signal: controller.signal,
      })
```

- Look up which page number to fetch for this mood.
- `fetch(...)` starts an HTTP GET request to the picsum.photos API.
- `signal: controller.signal` — Connects this fetch to the `AbortController`. If `controller.abort()` is called, this fetch is cancelled.

### 🚩 Beginner trap: `await` pauses here

Execution of this function pauses at `await fetch(...)` until the HTTP response arrives. Meanwhile, React continues doing other things (rendering, handling other clicks). When the response arrives, execution resumes on the next line.

### 🚩 Beginner trap: `fetch` can succeed with error HTTP codes

`fetch` only throws for network errors (no internet, DNS failure, CORS, etc.). A 404 or 500 response does NOT throw — it's still a successful HTTP transaction. That's why the next line checks `res.ok`.

---

### Response validation

```jsx
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
```

- `res.ok` is `true` for status codes 200-299. For anything else (404, 500, etc.), throw an error.
- The error message includes the status code so the user sees "HTTP 500" instead of a generic failure.

---

### Parse the JSON body

```jsx
      const data = await res.json()
```

- `res.json()` reads the response body stream and parses it as JSON.
- This is also async because reading a network stream takes time.

---

### Race condition guard

```jsx
      if (controller.signal.aborted) return
```

### 🚩 Beginner trap: Why check again after `await res.json()`?

Between starting the fetch and receiving the JSON, the request could have been aborted (user clicked a different mood). Without this check, `setImages(data.map(...))` would run with stale data **after** a newer request already set its own images. The UI would flash: show new images → then show old images from the cancelled request.

This check says: "if someone aborted the controller I created at the start, ignore the result and bail out."

---

### Map and store the data

```jsx
      setImages(
        data.map((img) => ({
          id: img.id,
          url: img.download_url,
          author: img.author,
        }))
      )
      setLoading(false)
```

- `data.map(...)` transforms the raw API response into a simpler object with only `id`, `url`, `author`.
- `setImages(...)` stores the clean array in state → triggers re-render.
- `setLoading(false)` hides the skeleton placeholders.

---

### Error handling

```jsx
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(err.message || 'Failed to load images')
      setLoading(false)
    }
```

- **`if (err.name === 'AbortError') return`** — If the error is from `controller.abort()`, ignore it. The user intentionally cancelled by clicking another mood. No error message needed.
- **`setError(err.message || 'Failed to load images')`** — For any other error (network failure, HTTP error), show the message.
- **`setLoading(false)`** — Stop showing skeletons so the error card appears.

### 🚩 Beginner trap: `AbortError` check

When you call `controller.abort()`, the in-flight `fetch` rejects with an `AbortError`. Without the `if (err.name === 'AbortError') return` check, every mood switch would briefly flash an error message before the new request's response arrives.

---

## `retry()` — Retry the last fetch

```jsx
  const retry = useCallback(() => {
    if (activeMood) fetchMood(activeMood)
  }, [activeMood, fetchMood])
```

- If there's an active mood, call `fetchMood` again with it.
- Dependencies `[activeMood, fetchMood]`: the function is re-created when `activeMood` changes (so it always calls the right mood) or when `fetchMood` changes (it never does — `[]` deps).

---

## The `useEffect` question — where is it?

This component has **no `useEffect`**. The fetch is triggered **directly by user action** (button `onClick`), not by component mount or state change.

This is intentional: you only fetch images when the user clicks a mood button, not when the component first loads. `useEffect` would be needed if you wanted to fetch automatically (e.g., load the first mood's images on page load), but that's not the behavior here.

### When would you use `useEffect` here?

If you wanted to auto-fetch "calm" images when the page loads:
```jsx
useEffect(() => {
  fetchMood('calm')
}, [])  // runs once on mount
```

Or if you wanted to refetch when the mood changes:
```jsx
useEffect(() => {
  if (activeMood) fetchMood(activeMood)
}, [activeMood])  // runs when activeMood changes
```

But the current design uses explicit button clicks. No `useEffect` needed.

---

## The render — `return` statement

### Mood buttons

```jsx
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
```

- **`MOODS.map(...)`** — Creates one button per mood.
- **`key={m}`** — React uses the key to track which buttons exist. Since mood names are unique and stable, this is efficient.
- **`className`** — Adds `' active'` class if this mood is the currently selected one (for styling).
- **`onClick={() => fetchMood(m)}`** — Calls `fetchMood` with this mood's name.
- **`disabled={loading}`** — While fetching, all mood buttons are grayed out so the user can't spam clicks.

---

### The grid — four possible states

```jsx
      <div className="grid">
```

Everything inside the grid switches based on three conditions: `loading`, `error`, `images.length > 0`.

---

### State 1: Loading — skeleton placeholders

```jsx
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" />
          ))
```

- **`Array.from({ length: 5 })`** — Creates an array `[undefined, undefined, undefined, undefined, undefined]`.
- **`.map((_, i) => ...)`** — Renders 5 gray animated placeholder divs that look like image cards loading.

### 🚩 Beginner trap: Using index as key

`key={i}` uses the array index as React's key. This is **fine here** because:
- The skeletons are only shown during loading (temporary)
- They are never reordered
- They are completely replaced when real images arrive

But as a general rule, index-as-key causes bugs with dynamic lists (add/remove/reorder). Here it's safe because the skeleton list is always freshly created.

---

### State 2: Error — message + retry

```jsx
        ) : error ? (
          <div className="error-card">
            <p className="error-msg">{error}</p>
            <button className="retry-btn" onClick={retry}>
              retry
            </button>
          </div>
```

- Shows the error message (e.g., "HTTP 500" or "Failed to fetch").
- **Retry button** — Calls `retry()` which re-calls `fetchMood(activeMood)`.
- Only one error card fills the grid area.

---

### State 3: Images — the data

```jsx
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
```

- **`key={img.id}`** — Uses the image's unique ID from the API. Stable and unique.
- **`src={\`${img.url}?w=400&h=300\`}`** — Appends width/height query params to resize the image on the server.
- **`loading="lazy"`** — Native browser lazy loading. Images off-screen are not downloaded until the user scrolls near them. Saves bandwidth.
- **`alt={`by ${img.author}`}`** — Accessible description. Screen readers read this.

---

### State 4: Empty — no mood selected yet

```jsx
        ) : (
          <p className="empty">select a mood to explore</p>
        )}
```

Shown when `loading` is `false`, `error` is `null`, and `images` is empty. This is the initial state before the user clicks any mood button.

---

## Cleanup logic summary

The app has one cleanup mechanism: the **AbortController**.

| Where | What happens | Why |
|---|---|---|
| Line 18 `abortRef.current.abort()` | Cancels the previous in-flight fetch | Prevents stale data from overwriting new data |
| Line 34 `if (controller.signal.aborted) return` | Guards after `await res.json()` | Catches race where abort happened during JSON parsing |
| Line 44 `if (err.name === 'AbortError') return` | Silently ignores abort errors | Prevents false error messages when user switches moods |

These three lines together ensure that rapid mood switching never shows wrong images or spurious errors.

---

## Data flow diagram

```
User clicks "loud"
  │
  ├─► Abort previous request (if any)
  ├─► Create new AbortController
  ├─► setActiveMood("loud")
  ├─► setLoading(true)
  ├─► setError(null)
  ├─► setImages([])
  │     └─► Re-render: show skeletons
  │
  ├─► fetch("https://picsum.photos/v2/list?page=3&limit=5")
  │     │
  │     ├─► Network error? ──► catch ──► setError("msg") ──► show error card
  │     │                           └─► setLoading(false)
  │     │
  │     ├─► HTTP error (404, 500)? ──► throw ──► catch ──► setError("HTTP 500")
  │     │                                           └─► setLoading(false)
  │     │
  │     ├─► Aborted during fetch? ──► catch ──► return (ignore silently)
  │     │
  │     └─► Success: parse JSON
  │           │
  │           ├─► Was aborted during parse? ──► return (ignore)
  │           │
  │           └─► setImages([...]) ──► re-render: show image cards
  │               setLoading(false)
  │
  └─► Done
```

---

## Common beginner mistakes recap

| Mistake | Why it's wrong |
|---|---|
| `useEffect(() => fetch(mood), [])` to load on mount | Not needed here — fetch is user-triggered, not automatic |
| No `AbortController` when fetching on button click | Rapid clicks cause race conditions — old response overwrites new |
| No `if (controller.signal.aborted) return` after `await` | JSON parses but is stale by the time it's used |
| Forgetting `err.name === 'AbortError'` check | Aborting a request shows "The user aborted a request" error |
| Using `key={Math.random()}` on mapped items | Every re-render destroys and recreates all DOM nodes |
| Not checking `res.ok` before `res.json()` | 404/500 treated as success, app tries to parse error HTML as JSON |
| No error state in UI | Fetch fails silently, user sees nothing and doesn't know why |
| No loading state | User clicks and nothing visible happens for seconds |
