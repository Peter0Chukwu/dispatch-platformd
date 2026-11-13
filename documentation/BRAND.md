# Brand identity

Where the logo lives, what it may be put on, and the measurements behind both.

## The mark

Supplied as a JPEG (`image_4d21e6b3.jpg`) on a light grey textured background. The
background was removed by flood-filling from the edges (not by a global colour key,
which would also have eaten the white highlights inside the truck), then the edges
were softened by 0.8 px so the cut does not look like scissors work. The wordmark
that came with it was kept as a separate asset.

| File | Size | Used for |
| --- | --- | --- |
| `frontend/public/brand/logo-mark.webp` | 394 × 266 (30 KB) | The mark in the product — sidebar, drawer, sign-in panel, landing page |
| `frontend/public/brand/logo-mark@2x.webp` | 768 × 531 (76 KB) | Retina / print |
| `frontend/public/brand/logo-mark.png` | 394 × 266 (132 KB) | Fallback for anything that cannot read WebP, and for placing in documents |
| `frontend/public/brand/logo-lockup.png` / `.webp` | 598 × 382 | Mark **and** wordmark together — social cards, invoices, print. **Not used in the UI.** |
| `frontend/public/favicon-32/48/192/512.png`, `apple-touch-icon.png` | — | Browser tab, shortcuts, phone home screen. Baked on a white rounded tile. |
| `frontend/public/site.webmanifest` | — | Installable PWA metadata, using the same icons |

The artwork is a full-colour illustration: dark outlines, mid-greens, white
highlights. That fact drives the one rule below.

## The one rule: the mark always sits on a white tile

`frontend/src/components/BrandMark.tsx` is the only place the mark is drawn. It
wraps the image in a white, hairline-ringed tile.

* On the **white sidebar** the tile is a subtle card and the mark keeps its contrast.
* On the **near-black sign-in panel and landing page** the tile is what makes it
  work at all. A flat one-colour knockout — the usual treatment for a logo on a dark
  background — would delete the truck's white body and leave a green smear.

Do not recolour the mark to a single colour, and do not place it directly on
`brand-950` without the tile.

## Colour: the logo is the palette

The greens were sampled from the supplied artwork, and they already agree with the
rebrand — nothing was retuned to match, which is the best possible outcome:

| Sample | Value | Nearest palette token |
| --- | --- | --- |
| Median of all green pixels | `#22875F` | `brand-500` = `#2C8A62` |
| Median of the brightest greens | `#409C6B` | `brand-400` = `#49A57D` |

Full scale (`frontend/tailwind.config.ts`):
`50 #EFF8F3 · 100 #D7EFE3 · 200 #AFDEC7 · 300 #7DC4A4 · 400 #49A57D · 500 #2C8A62 ·
600 #1E7050 · 700 #175A41 · 800 #114633 · 900 #0C3627 · 950 #072419`

`accent` is the brighter scale used for primary actions; `brand-950` is the page
background for the landing page and the sign-in panel, and also the browser
`theme-color`.

## Where it appears

* `PortalShell` — sidebar rail (40 px tile) and mobile drawer header (36 px tile)
* `AuthLayout` — sign-in / sign-up / invitation panels
* `LandingPage` — header (48 px tile)
* `StyleGuidePage` — a Logo section showing all three sizes on light and dark, plus
  the full lockup, so a future change cannot quietly drift
* `frontend/index.html` — favicon links, `theme-color`, manifest

## If the logo changes

Replace the six files in `frontend/public/brand/` (keeping the names) and the five
icons at `frontend/public/`. Nothing else refers to a logo path, so nothing else
needs to change. Keep `logo-mark` transparent and tightly cropped — the padding and
the tile belong to CSS, not to the file.
