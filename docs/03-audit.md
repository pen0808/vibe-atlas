# Audit — Vibe Atlas

## 1. API Key Exposure

### Finding: None — the API is public

```jsx
const res = await fetch(`https://picsum.photos/v2/list?page=${page}&limit=5`, ...)   // line 29
```

**picsum.photos** is a free, public API that requires no key, no token, no authentication. The URL is safe to expose in a client-side bundle.

### Future risk

If this code is adapted to use a key-protected API:

```jsx
// Hypothetical — NOT in the codebase:
const res = await fetch(`https://some-api.com/photos?key=${API_KEY}&page=${page}`)
```

Keys hardcoded in client JavaScript are **publicly readable** by anyone who opens DevTools → Sources or inspects network requests. Vite does not strip environment variables from the client bundle unless they are prefixed with `VITE_` and accessed via `import.meta.env.VITE_*`.

### Fix (preventative)

If a key is ever needed, route requests through a proxy or use `import.meta.env.VITE_API_KEY` and configure the server to inject it server-side. For the current public API, no change is needed.

---

## 2. Race Conditions — Rapid Mood Clicks

### Finding: Well-guarded by AbortController, with one edge case

The code uses three layers of defense:

| Line | Guard | Purpose |
|---|---|---|
| 18 | `abortRef.current.abort()` | Cancel in-flight request before starting new one |
| 34 | `if (controller.signal.aborted) return` | Ignore response if abort happened during `res.json()` |
| 44 | `if (err.name === 'AbortError') return` | Ignore the `AbortError` thrown by the cancelled fetch |

### The scenario

```
User clicks "loud"  →  fetch starts for page 3
User clicks "warm"  →  "loud" fetch aborted, fetch starts for page 5
                       "loud" promise rejects → AbortError → silently ignored
                       "warm" promise resolves → images set to warm data ✅
```

This works correctly. The `disabled={loading}` prop on buttons (line 65) also prevents most rapid clicking.

### Edge case: event loop race

A user could click two buttons in the **same event loop tick** before React re-renders with `disabled={true}`:

```
Tick 1: click "loud"  →  fetchMood("loud")
                           abortRef.current = controllerA
                           setLoading(true)
                           setActiveMood("loud")
                           fetch start (page 3)

Tick 1 (same tick): click "warm"  →  fetchMood("warm")
                                      abortRef.current.abort()  // cancels controllerA
                                      abortRef.current = controllerB
                                      setActiveMood("warm")
                                      fetch start (page 5)

Tick 2: React processes batch → re-render with loading=true, activeMood="warm"
        controllerA promise rejects → AbortError → silently ignored ✅
        controllerB promise resolves → images set to warm data ✅
```

This still works! The AbortController handles it regardless of the disabled button state.

### Actual gap: `loading` is never set `false` on mount

If the component mounts and immediately... no, it doesn't fetch on mount. No gap here.

### Fix: No change needed

The AbortController pattern is correctly implemented. Three recommendation:

1. **(Optional)** Add `pointer-events: none` on the moods container during loading as a CSS fallback, in case the disabled attribute doesn't prevent click in some edge case.

---

## 3. API Rate Limiting

### Finding: No defense against 429 (Too Many Requests)

When picsum.photos rate-limits the client, the response has status 429. The code catches it:

```jsx
if (!res.ok) throw new Error(`HTTP ${res.status}`)   // line 32
```

This shows "HTTP 429" in the error card (line 80). But the retry button:

```jsx
<button className="retry-btn" onClick={retry}>retry</button>   // line 81-82
```

Calls `retry()` which immediately calls `fetchMood(activeMood)` (line 51), triggering another 429. The user can spam retry and get 429'd forever — a **retry storm**.

### Additional issue: no debounce on mood clicks

The `disabled={loading}` guard prevents most rapid clicking, but once loading completes, the user can immediately click another mood. If the API enforces a per-second rate limit, rapid mood switching could trigger 429s even with the abort guard.

### Fix

```jsx
// After line 47, before closing App
const [retryCount, setRetryCount] = useState(0)
const retryTimeoutRef = useRef(null)

const retry = useCallback(() => {
  if (activeMood) {
    setRetryCount(c => c + 1)
    fetchMood(activeMood)
  }
}, [activeMood, fetchMood])

// In fetchMood, after line 43 (catch):
} catch (err) {
  if (err.name === 'AbortError') return
  setError(err.message || 'Failed to load images')
  setLoading(false)
  // Exponential backoff: 1s, 2s, 4s, 8s... for 429
  if (err.message?.includes('429') && retryCount < 4) {
    const delay = Math.min(1000 * Math.pow(2, retryCount), 15000)
    retryTimeoutRef.current = setTimeout(() => retry(), delay)
  }
}
```

Or simpler — disable retry for 429s and show a "try again later" message:

```diff
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
+     // 429 Too Many Requests — back off
+     if (res.status === 429) throw new Error('Too many requests. Please wait a moment.')
```

---

## 4. Accessibility

### Finding 4a: Alt text describes the author, not the image

```jsx
alt={`by ${img.author}`}                  // line 91
```

Screen reader output: *"by Alejandro Escamilla"*. This tells the user who took the photo but nothing about what it shows.

Worse: the author name is already rendered as visible text on the next line:

```jsx
<span className="img-author">{img.author}</span>   // line 94
```

So the alt text is **redundant** with visible text — screen readers read "by John Doe" (alt) and "John Doe" (visible) back to back.

**WCAG 1.1.1 (Non-text Content) violation**: Decorative images should have `alt=""`. Informative images should describe the content.

### Fix 4a

Since picsum.photos provides no description of the image content, the best option is to mark images as decorative:

```diff
- alt={`by ${img.author}`}
+ alt=""
```

If you want to keep author info accessible without redundancy, use `aria-label` on the card instead:

```jsx
<div key={img.id} className="img-card" aria-label={`Photo by ${img.author}`}>
  <img className="img-src" src={...} alt="" role="presentation" />
  <span className="img-author">{img.author}</span>
</div>
```

---

### Finding 4b: Mood buttons lack accessible state

```jsx
<button
  key={m}
  className={'mood-btn' + (activeMood === m ? ' active' : '')}
  onClick={() => fetchMood(m)}
  disabled={loading}
>
  <span className="mood-emoji">{MOOD_EMOJI[m]}</span>
  <span className="mood-label">{m}</span>
</button>
```

- The button text is "🫂 calm" — the emoji may not be interpreted consistently across screen readers.
- The `.active` class is visual only. No `aria-pressed` or `aria-selected` attribute.
- Screen reader users get no indication that "calm" is the currently selected mood.

### Fix 4b

```diff
  <button
    key={m}
    className={'mood-btn' + (activeMood === m ? ' active' : '')}
    onClick={() => fetchMood(m)}
    disabled={loading}
+   aria-pressed={activeMood === m}
  >
```

---

### Finding 4c: Skeletons are empty elements

```jsx
Array.from({ length: 5 }).map((_, i) => (
  <div key={i} className="skeleton" />     // line 76
))
```

Skeleton divs have no content, no `aria-label`, and no `role`. A screen reader navigating by elements may land on an empty div with no announcement.

### Fix 4c

```diff
- <div key={i} className="skeleton" />
+ <div key={i} className="skeleton" aria-hidden="true" />
```

`aria-hidden="true"` removes the skeletons from the accessibility tree entirely.

---

### Finding 4d: Error card retry button has no loading feedback

When the user clicks retry, `fetchMood` runs, which sets `loading=true`. The buttons become `disabled` during loading. But the retry button itself has no disabled state or loading indicator. The screen reader doesn't know the retry was acknowledged.

### Fix 4d

```diff
- <button className="retry-btn" onClick={retry}>retry</button>
+ <button className="retry-btn" onClick={retry} disabled={loading}>
+   {loading ? 'loading…' : 'retry'}
+ </button>
```

---

## 5. Performance — Re-renders

### Finding 5a: Full app re-renders on every state change

The entire `App` component is one monolithic function. Any state change (`loading`, `error`, `images`, `activeMood`) re-renders **everything** — the heading, the subtitle, all 5 mood buttons, the grid, and all image cards.

At 5 images and 5 moods, the DOM is tiny (~40 nodes). The re-render cost is negligible. **No action needed for scale.**

### Finding 5b: Image size is unconstrained — massive bandwidth waste

```jsx
src={`${img.url}?w=400&h=300`}            // line 90
```

The picsum.photos `download_url` is already a full-resolution URL:

```
https://picsum.photos/id/0/5000/3333
```

Appending `?w=400&h=300` is ignored — picsum uses path-based sizing, not query params. The browser downloads the **full-resolution image** (e.g., 5000×3333 pixels, multiple megabytes) and CSS-shrinks it to 400×300.

**This is the most impactful finding.** Each image card downloads 2-5 MB instead of 20-50 KB.

### Fix 5b

```diff
- src={`${img.url}?w=400&h=300`}
+ src={`https://picsum.photos/id/${img.id}/400/300`}
```

This constructs a properly sized URL using picsum's path-based API: `https://picsum.photos/id/{id}/{width}/{height}`. Images download at exactly the display size.

---

### Finding 5c: No width/height on `<img>` — layout shift

```jsx
<img className="img-src" src={...} alt="" loading="lazy" />
```

Even with the CSS `aspect-ratio: 4 / 3` (App.css line 115), the `<img>` tag has no explicit `width` and `height` attributes. If the CSS fails to load or is delayed, the image has zero intrinsic dimensions until downloaded, causing **Cumulative Layout Shift (CLS)**.

### Fix 5c

```diff
  <img
    className="img-src"
    src={...}
    alt=""
+   width="400"
+   height="300"
    loading="lazy"
  />
```

This gives the browser explicit dimensions before the image loads, eliminating layout shift even without CSS.

---

### Finding 5d: `retry` useCallback is mostly wasted

```jsx
const retry = useCallback(() => {
  if (activeMood) fetchMood(activeMood)
}, [activeMood, fetchMood])                                // line 52
```

The dependency `[activeMood, fetchMood]` causes `retry` to be re-created every time `activeMood` changes — which is every mood click. The `useCallback` provides zero benefit (same as a bare function). Only `fetchMood` has stable identity (`[]` deps).

### Fix 5d

Either remove `useCallback` (simplest) or refactor `retry` to read `activeMood` from a ref:

```jsx
const moodRef = useRef(null)
const retry = useCallback(() => {
  if (moodRef.current) fetchMood(moodRef.current)
}, [fetchMood])  // stable — only fetchMood changes (never)
```

And set `moodRef.current = mood` inside `fetchMood`.

---

## Severity Summary

| Issue | Category | Severity | Fix complexity |
|---|---|---|---|
| Image downloads at full resolution (5000×3333) | Performance / Bandwidth | **High** | 1 line |
| Alt text describes author, not image content | Accessibility | **High** | 1 line |
| No `aria-pressed` on mood buttons | Accessibility | Medium | 1 line |
| Skeletons lack `aria-hidden` | Accessibility | Medium | 1 line |
| Retry button has no loading state | Accessibility | Low | 2 lines |
| No 429 / rate-limit handling | Reliability | Low | ~5 lines |
| No width/height on img tags | Performance (CLS) | Low | 2 lines |
| `retry` useCallback is wasted | Performance | Cosmetic | 2 lines |
| API key exposure | Security | **None** | No change |
| Race conditions | Reliability | **None** | No change |
| Re-render scope | Performance | **None** | No change for 5 images |
