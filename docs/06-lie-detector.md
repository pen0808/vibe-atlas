# Lie Detector — Vibe Atlas (Take 2)

## The 5 Statements

Read each one. Four are true. One is a lie.

---

**A.** Before every fetch, `fetchMood` calls `setImages([])`, `setError(null)`, and `setLoading(true)` so the UI never shows stale data from a previous request while loading.

**B.** The image `src` on line 90 is constructed as `` `${img.url}?w=400&h=300` ``, and since picsum.photos uses query parameters for resizing, this correctly limits each image download to roughly 400×300 pixels.

**C.** The skeleton placeholders (lines 75-77) use the array index as their React `key`, which is acceptable here because skeletons are temporary and never reordered.

**D.** The mood buttons (line 65) use `disabled={loading}`, which prevents the user from clicking a second mood while a fetch is in flight.

**E.** The `retry` function (line 51) checks `if (activeMood)` before calling `fetchMood`, preventing a retry when no mood has been selected yet.

---

## Investigation

### Statement A — Verdict: TRUE

```js
setActiveMood(mood)           // line 22
setLoading(true)              // line 23
setError(null)                // line 24
setImages([])                 // line 25
```

All four state resets happen **synchronously** inside `fetchMood`, before the `await fetch(...)` on line 29 yields to the event loop. This guarantees:
- Old images are cleared before new ones arrive.
- Old error messages are cleared before a new request starts.
- `loading` is `true` before the network request begins (so buttons disable immediately).

Statement A is **true**.

---

### Statement B — Verdict: LIE

```js
src={`${img.url}?w=400&h=300`}       // line 90
```

The `img.url` from the picsum.photos API looks like this:

```
https://picsum.photos/id/0/5000/3333
```

The trailing `5000/3333` are the image's native resolution — picsum serves a **path-based resizing API**, not query-parameter-based. Appending `?w=400&h=300` is **ignored**. The browser downloads the image at its full original size (e.g., 5000×3333 pixels, multiple megabytes), then CSS-shrinks it to the card's display size.

**Proof from the API docs:** picsum.photos resizes via URL paths like `https://picsum.photos/id/{id}/{width}/{height}`. The correct URL for a 400×300 thumbnail would be:

```
https://picsum.photos/id/${img.id}/400/300
```

But the code uses `download_url` with query parameters that have no effect. This means every image download is **10-50× larger** than necessary — the most impactful bug found in the audit (see `docs/03-audit.md`, finding 5b).

Statement B is a **lie**.

---

### Statement C — Verdict: TRUE

```js
Array.from({ length: 5 }).map((_, i) => (
  <div key={i} className="skeleton" />     // line 76
))
```

Using the array index (`i`) as React `key` is widely considered an anti-pattern for dynamic lists that can be reordered, filtered, or have items inserted/removed. But here:
- The skeleton array always has **exactly 5 items** (fixed length).
- It is **never reordered**.
- It is **temporary** — completely replaced when real images arrive.
- Each skeleton is identical (no local state, no input values).

Under these constraints, index-as-key is safe and performs identically to a stable ID.

Statement C is **true**.

---

### Statement D — Verdict: TRUE

```js
<button
  ...
  onClick={() => fetchMood(m)}
  disabled={loading}                         // line 65
>
```

The `disabled` HTML attribute does two things:
1. **Visual** — the browser applies `opacity: 0.6` and `cursor: default` (App.css lines 62-65).
2. **Functional** — the browser **does not dispatch click events** on disabled buttons. The `onClick` handler never fires.

React keeps `loading` in sync with the DOM. When `setLoading(true)` runs (line 23), React re-renders, the button gets `disabled={true}`, and all subsequent clicks are blocked until `setLoading(false)` runs (line 42 or 46).

Statement D is **true**.

---

### Statement E — Verdict: TRUE

```js
const retry = useCallback(() => {
  if (activeMood) fetchMood(activeMood)     // line 51
}, [activeMood, fetchMood])
```

- `activeMood` starts as `null` (line 11).
- The error card (and thus the retry button) only appears when `error` is truthy (line 78) — which only happens after a failed `fetchMood` call.
- `fetchMood` always sets `activeMood` on line 22 before the fetch runs. So if there's an error, `activeMood` is guaranteed to be set.
- The `if (activeMood)` guard is therefore a **safety net** for the edge case where `retry()` is called programmatically before any mood is clicked. In normal flow, `activeMood` is always truthy when the retry button is visible.

Statement E is **true**.

---

## Conclusion

| Statement | Verdict |
|---|---|
| **A** — State is cleared before every fetch | **True** |
| **B** — `?w=400&h=300` correctly resizes images | **Lie** |
| **C** — Index-as-key is acceptable for skeletons | **True** |
| **D** — `disabled={loading}` blocks concurrent requests | **True** |
| **E** — `if (activeMood)` guards retry | **True** |

**The lie is Statement B.** picsum.photos uses path-based resizing (`/id/{id}/{width}/{height}`), not query parameters. The `?w=400&h=300` suffix on line 90 is silently ignored, forcing the browser to download images at their original multi-megabyte resolution.
