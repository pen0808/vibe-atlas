# Principles at Work

## 1. Separation of Concerns — UI vs Data Fetching

The component splits into two distinct zones: **data logic** (fetch, abort, parse, transform, error-handle) and **rendering** (read state, produce DOM).

### The dividing line

| Zone | Lines | Responsibility |
|---|---|---|
| Data fetching | 17-48 | Create/cancel requests, call `fetch`, check HTTP status, parse JSON, transform shape, set state |
| UI rendering | 54-101 | Read `loading`, `error`, `images` from state, branch into 4 visual states, paint DOM |

`fetchMood` (lines 17-48) produces nothing but state updates. It never touches the DOM. The JSX (lines 54-101) reads state and never calls `fetch`. They communicate only through `setState`.

### Why this matters

If the API changes (e.g., different URL, different response shape), you change lines 29 and 35-41 — nothing in the JSX needs to move. If the design changes (e.g., a carousel instead of a grid), you change the JSX without touching the fetch logic.

### 🚩 Violation

The API URL is **hardcoded** inside `fetchMood` (line 29):
```
fetch(`https://picsum.photos/v2/list?page=${page}&limit=5`, ...)
```

If this component was reused with a different image API, you'd have to edit the source or add a prop. A purer separation would inject the fetch function or base URL from above.

---

## 2. Loading State Management

Loading is an **explicit boolean state variable**, not an implicit check like `images === null`.

```jsx
const [loading, setLoading] = useState(false)           // line 12
```

### Lifecycle

| Event | Line | `loading` becomes |
|---|---|---|
| User clicks mood | 23 | `true` — skeletons appear |
| `await fetch` resolves | 42 | `false` — images appear |
| `await fetch` throws | 46 | `false` — error card appears |

### Three ways loading state is consumed

**Skeleton UI** (lines 74-77):
```jsx
{loading ? (
  Array.from({ length: 5 }).map((_, i) => (
    <div key={i} className="skeleton" />
  ))
) : ... }
```
Five animated gray placeholders matching the card layout. The user sees immediate feedback even on slow networks.

**Disabled buttons** (line 65):
```jsx
disabled={loading}
```
Prevents double-submission. A second mood click while loading is ignored.

**Competing state priority** (lines 74-97):
```
loading ? <skeletons>           // #1 priority
: error ? <error-card>          // #2
: images.length > 0 ? <grid>    // #3
: <empty-prompt>                // #4
```
The `loading` check comes first, so a stale `error` from a previous request isn't shown when a new request starts (because line 24 clears error before loading starts).

### 🚩 Beginner trap: Forgetting to set `loading = false` on error

Line 46 handles this. Without it, the skeletons would stay forever on a failed request, and the error card would never appear.

---

## 3. Error Boundaries

### What exists: Inline error handling

The component handles **expected errors** (network failures, HTTP errors, user-cancelled requests) inside `fetchMood`:

| Error scenario | Line | How it's handled |
|---|---|---|
| Network down, DNS fail, CORS | 43 | `catch (err)` fires → `setError(err.message)` |
| HTTP 404, 500 | 32 | `if (!res.ok) throw new Error(...)` → caught on line 43 |
| User cancels (switches mood) | 18, 44 | `controller.abort()` → `AbortError` → caught but **silently ignored** |
| JSON parse fails on malformed response | 33 | `res.json()` rejects → caught on line 43 |

The error is surfaced as a **first-class UI state** (lines 78-84):
```jsx
error ? (
  <div className="error-card">
    <p className="error-msg">{error}</p>
    <button className="retry-btn" onClick={retry}>retry</button>
  </div>
) : ...
```

### What's missing: React Error Boundary

A React `<ErrorBoundary>` catches **unexpected render crashes** (e.g., `images` somehow becoming `null`, causing `.map()` to throw). This component has no Error Boundary. If the state is ever corrupted, the entire app unmounts to a white screen.

### The gap

| Type | Handled? | Mechanism |
|---|---|---|
| Network/HTTP errors | ✅ | `try/catch` + `res.ok` check |
| User abort | ✅ | `AbortError` filter |
| Corrupt state / render crash | ❌ | No `<ErrorBoundary>` |

---

## 4. Dependency Injection

### What's injected: nothing

The component receives **no props**. The API base URL, the fetch implementation, and the image host are all hardcoded inside `fetchMood`:

```jsx
const res = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=5`, ...)
```

There is no way to change the data source without editing the source file.

### What acts like injection: the configuration maps

```jsx
const MOOD_PAGES = { calm: 1, loud: 3, warm: 5, lonely: 7, bright: 9 }
```

This constant separates **which page maps to which mood** from the fetch logic. Adding a new mood means adding an entry to `MOOD_PAGES` (and `MOOD_EMOJI` and `MOODS`). The fetch code never changes.

### What proper DI would look like

```jsx
// Instead of hardcoding:
const res = await fetch(url, { signal })

// Inject the fetcher:
function App({ fetchImages = defaultFetchImages }) {
  ...
  const data = await fetchImages(mood)
```

Or inject the base URL:
```jsx
function App({ apiBaseUrl = 'https://picsum.photos' }) {
  ...
  const res = await fetch(`${apiBaseUrl}/v2/list?page=${page}&limit=5`, ...)
```

### Why it matters

Without DI, you cannot:
- Unit-test `fetchMood` without mocking the global `fetch`
- Reuse this component with a different image provider
- Switch to a mock data source in development

---

## 5. Immutability of Fetched Data

### The API response is never mutated

```jsx
const data = await res.json()                           // line 33 — raw API response
setImages(
  data.map((img) => ({                                  // line 35-41 — creates NEW objects
    id: img.id,
    url: img.download_url,
    author: img.author,
  }))
)
```

`data.map(...)` builds a **new array of brand-new objects**. The original API response is never touched.

### State updates are always replacement, not mutation

```jsx
setImages([])                         // line 25 — replaces with empty array
setImages(data.map(...))              // line 35 — replaces with new array
setImages(prev => prev.filter(...))   // (not in this file, but this is the pattern)
```

`setImages` replaces the entire array. React detects changes via reference equality (`===`), so a new array reference guarantees a re-render.

### The render is read-only

The JSX (lines 85-96) only reads from `images`:
```jsx
images.map((img) => (
  <div key={img.id} className="img-card">
    <img src={`${img.url}?w=400&h=300`} ... />
    ...
  </div>
))
```

No `.push()`, no `.pop()`, no `img.someProp = ...`. Pure read-only consumption.

### What would violate immutability

```jsx
// MUTATION — never do this:
const data = await res.json()
data.push({ id: 'extra' })             // mutates the original response
setImages(data)                        // same reference, no re-render

// MUTATION — also bad:
const imgs = [...images]
imgs[0].author = 'fake name'           // mutates an object still referenced by state
setImages(imgs)
```

The `data.map(...)` pattern (lines 35-41) prevents the first case. The absence of any direct object property assignment in the render prevents the second.

---

## Quick Reference Table

| Principle | Key Lines | What it looks like |
|---|---|---|
| Separation of Concerns | 17-48 / 54-101 | Data fetching lives in `fetchMood`, rendering reads state in JSX |
| Loading State Management | 12, 23, 42, 46, 65, 74-77 | Explicit boolean + skeleton UI + disabled buttons |
| Error Handling | 32, 43-46, 78-84 | `try/catch` + `res.ok` check + `AbortError` filter + error card with retry |
| Error Boundary | (absent) | No render-crash protection |
| Dependency Injection | (absent) | API URL and `fetch` are hardcoded on line 29 |
| Configuration Maps | 6, 8 | `MOOD_PAGES` and `MOOD_EMOJI` isolate mood↔page mapping |
| Immutability | 35-41, 85-96 | `data.map(...)` creates new objects, JSX reads without mutation |
| Single Source of Truth | 11-14 | `images`, `loading`, `error`, `activeMood` — each is the one authority for its domain |
| Fail-safe Defaults | 11-14 | `null` for mood/error, `false` for loading, `[]` for images |
| Defensive Programming | 18, 32, 34, 44 | Abort previous, check HTTP, check aborted after parse, suppress AbortError |
