# Lie Detector — Vibe Atlas

## The 5 Statements

Read each one. Four are true. One is a lie.

---

**A.** The `abortRef` is initialized with `useRef(null)` and stores the current `AbortController`, allowing an in-flight request to be cancelled before starting a new one.

**B.** When `fetchMood` catches an `AbortError`, it calls `setError` with the abort message so the user knows the previous request was cancelled.

**C.** The `fetchMood` function checks `if (!res.ok) throw new Error(...)` to catch HTTP errors like 404 or 500, because `fetch` only rejects on network failures, not on non-2xx status codes.

**D.** The mood buttons are rendered using `MOODS.map(...)` with the mood name as the `key` prop, ensuring stable identity across re-renders.

**E.** The error card displays the error message and has a retry button that calls `retry()`, which re-calls `fetchMood` with the current `activeMood`.

---

## Investigation

### Statement A — Verdict: TRUE

```js
const abortRef = useRef(null)                        // line 15

const fetchMood = useCallback(async (mood) => {
  if (abortRef.current) abortRef.current.abort()     // line 18 — cancel previous
  const controller = new AbortController()            // line 19
  abortRef.current = controller                        // line 20 — store new
```

- `abortRef` starts as `null` (no request yet).
- Before each fetch, line 18 cancels whatever is in `abortRef.current`.
- Line 20 stores the new `AbortController`.
- A ref (not state) is correct here — changing `abortRef.current` does not need to trigger a re-render.

Statement A is **true**.

---

### Statement B — Verdict: LIE

```js
    } catch (err) {
      if (err.name === 'AbortError') return          // line 44 — EXITS EARLY
      setError(err.message || 'Failed to load images') // line 45 — never reached for AbortError
      setLoading(false)                                // line 46
    }
```

The `AbortError` check on line 44 uses **`return`** — it exits the function before `setError` is ever called.

The statement claims "it calls `setError` with the abort message" — the exact opposite is true. The AbortError is **intentionally silenced**. No error message is shown to the user, no state is updated. The user sees no indication that a previous request was cancelled.

**Proof by tracing:**

```
User clicks "calm" → fetch starts
User clicks "loud" → "calm" request aborted
                     "calm" fetch rejects with AbortError
                     │
                     ▼
             catch (err)
             │
             ├── err.name === "AbortError"?  →  YES
             │                                  │
             │                                  ▼
             │                              return  ← exits here, setError never called
             │
             ├── setError(...)    ← NOT REACHED
             └── setLoading(false) ← NOT REACHED
```

The intention (documented in `docs/01-explanation.md`) is deliberate: aborting a request is not an error, it's expected behavior when the user switches moods. Showing an error message would be confusing.

Statement B is a **lie**.

---

### Statement C — Verdict: TRUE

```js
const res = await fetch(url, { signal: controller.signal })  // line 29-31
if (!res.ok) throw new Error(`HTTP ${res.status}`)            // line 32
```

- **`fetch` only rejects on network failures** — no internet, DNS failure, CORS error, connection timeout.
- **`res.ok` is `false` for any HTTP error** — 404, 500, 429, etc. The promise still resolves, but `res.ok` is `false`.
- Without the `!res.ok` check, a 404 would be treated as success. The response body would be an HTML error page, `res.json()` would fail with a parse error, and the user would see a confusing "Unexpected token <" error instead of "HTTP 404".

Statement C is **true**.

---

### Statement D — Verdict: TRUE

```js
{MOODS.map((m) => (
  <button
    key={m}                                              // line 62
    ...
  >
```

- `MOODS` is `['calm', 'loud', 'warm', 'lonely', 'bright']` (line 4).
- Each mood name is unique and never changes (constant array outside the component).
- React uses `key` for reconciliation. A stable key means React reuses the DOM node instead of destroying and recreating it.
- If `key={Math.random()}` or `key={index}` were used instead, React would unnecessarily recreate all buttons on every re-render.

Statement D is **true**.

---

### Statement E — Verdict: TRUE

```js
const retry = useCallback(() => {
  if (activeMood) fetchMood(activeMood)                  // line 50-52
}, [activeMood, fetchMood])

// In JSX:
<div className="error-card">
  <p className="error-msg">{error}</p>                   // line 80
  <button className="retry-btn" onClick={retry}>          // line 81-82
    retry
  </button>
</div>
```

- `{error}` renders the message string (e.g., "HTTP 500", "Failed to fetch").
- The retry button `onClick={retry}` calls `retry()`.
- `retry` checks `if (activeMood)` — if a mood was previously selected (it was, or there'd be no error card), it calls `fetchMood(activeMood)` to retry the same mood.

Statement E is **true**.

---

## Conclusion

| Statement | Verdict |
|---|---|
| **A** — `abortRef` stores AbortController for cancellation | **True** |
| **B** — `AbortError` calls `setError` to notify the user | **Lie** |
| **C** — `!res.ok` catches HTTP errors that `fetch` doesn't reject on | **True** |
| **D** — Mood buttons use stable `key={m}` from `MOODS.map` | **True** |
| **E** — Error card shows message with retry calling `fetchMood(activeMood)` | **True** |

**The lie is Statement B.** Line 44 returns early when `err.name === 'AbortError'`, so `setError` is never reached. `AbortError`s are intentionally suppressed — showing an error for a user-initiated cancellation would be confusing.
