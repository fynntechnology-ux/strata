# Art direction

## The idea in one line

**Cold industrial substrate, lit by molten amber.** Deep blue-black rock everywhere,
warmth only where something is working — a furnace mouth, a warning lamp, a button you can
press.

That constraint does the heavy lifting: because amber means *active*, the eye goes
straight to whatever is interactive, in the world and in the interface, without any
explicit hierarchy work.

## Palette

Defined once in [`globals.css`](../src/app/globals.css) as Tailwind v4 theme tokens, so
the landing page, the HUD and the marketplace physically cannot drift apart.

### Surfaces

Six steps, darkest at the page level, lifting toward interactive.

| Token | Hex | Use |
| --- | --- | --- |
| `void` | `#06080d` | Page background, the world beyond the fog |
| `deep` | `#0a0e16` | Section backgrounds, HUD bars |
| `crust` | `#10151f` | Cards, list rows |
| `panel` | `#151b28` | Raised panels, hover states |
| `raised` | `#1c2433` | Buttons, meter tracks |
| `hover` | `#232d3f` | Button hover |

### Text

`hi` `#eaf0fb` → `body` `#9daac0` → `mute` `#64708a` → `faint` `#3d4759`. Four steps is
enough; a fifth is a sign the layout is doing hierarchy work that spacing should be doing.

### Brand

| Token | Hex | Meaning |
| --- | --- | --- |
| `amber` | `#ff9a2e` | **Primary action.** Anything that commits |
| `ember` | `#ff6b35` | Heat, smelting, mining progress |
| `cyan` | `#36d6ec` | Energy, on-chain, informational |
| `good` / `warn` / `bad` | `#4ade80` / `#fbbf24` / `#fb6e4e` | Status |

### Rarity

The one ladder everything else follows — items, crates, marketplace, drop tables.

Common `#7c8798` · Uncommon `#4ade80` · Rare `#38bdf8` · Epic `#a78bfa` ·
Legendary `#fbbf24` · Mythic `#ff6b6b`

Each carries a `glow` value from 0 to 1. Above 0.3 it drives a box-shadow; above 0.6 an
inset glow on cards; above 0.85 (Legendary, Mythic) a one-shot flare on reveal. Rarity
should be felt before it is read.

### Resources

Every resource has a colour that is used **identically in the voxel palette and in the
UI** — the chip next to "Iron Ore" in the inventory is the same value as the ore block in
the ground. That correspondence is worth more than any icon.

## Typography

| Role | Face | Why |
| --- | --- | --- |
| Display | **Space Grotesk** 500/600/700 | Geometric with slightly odd details — technical without being cold |
| Body | **Inter** | Reads at 11px, which a game HUD needs |
| Numbers | **JetBrains Mono** | Tabular figures |

Numbers get their own face and the `.tnum` class, which forces tabular figures. In a game
where counters tick constantly, proportional digits make the whole HUD jitter — this is
not a subtle improvement.

Display type sets at `-0.02em` tracking. Uppercase labels take `0.1em`–`0.22em`, which is
what makes a 9px label legible instead of a smudge.

## The voxel surface language

Every panel is an extruded cube face lit from above — the same lighting model the renderer
uses for actual geometry.

```css
@utility vx-bevel {
  box-shadow:
    inset 0  1px 0 0 rgb(255 255 255 / 0.07),   /* lit top edge */
    inset 0 -1px 0 0 rgb(0 0 0 / 0.40),         /* shadowed bottom */
    inset  1px 0 0 0 rgb(255 255 255 / 0.025),
    inset -1px 0 0 0 rgb(0 0 0 / 0.22);
}
```

**No border radius anywhere.** Not a stylistic preference — a rounded corner reads as
"web app", and the entire premise is that the interface is made of the same blocks as the
world.

Three more motifs carry the theme:

- **`vx-ticks`** — small amber corner marks. A targeting-reticle detail that appears on
  the most important panel in any view.
- **`vx-grid`** — a 34px survey grid behind hero sections and loading screens. Reads as
  claim-plotting paper.
- **Segmented meters** — progress bars made of discrete blocks rather than a smooth fill.
  A continuous bar reads as generic web UI; a blocky one belongs here, and has the useful
  side effect of making small changes legible at a glance.

## Icons

Hand-drawn SVG paths with `strokeLinecap="square"` and `strokeLinejoin="miter"`. **No
curves, no rounded ends.** That single constraint is what lets a flat 2D icon sit next to
a voxel world without looking imported from a different product.

Icons inherit `currentColor`, so a rarity or resource colour drives them directly.

## In-world rendering

No textures at all. Three effects carry the look:

1. **Directional face shading** — top 1.0, bottom 0.5, ±X 0.86/0.72, ±Z 0.80/0.66. Free,
   and most of why a cube reads as a cube.
2. **Per-vertex ambient occlusion** — the standard 0–3 corner calculation mapped to brightness
   `[0.38, 0.6, 0.8, 1.0]`, with quads split along their brighter diagonal.
3. **Per-voxel colour jitter** — a hash-driven nudge, stronger on natural blocks (dirt
   0.09, gravel 0.13) than manufactured ones (steel 0.03, glass 0.02). Without it, a wall
   of 400 stone blocks is one flat grey rectangle.

Emissive blocks — lamps, ember ports, crystal — skip AO entirely and get a brightness
boost, so they read as light sources rather than shadowed geometry. A lamp lit from one
side looks broken.

Colours are converted **sRGB → linear** at module load, because the renderer treats vertex
colours as linear and outputs sRGB. Skipping that conversion is why untextured voxel
scenes so often look washed out and flat.

Atmosphere: a gradient sky dome with a warm sun bloom and a horizon haze band (one draw
call, more mood than any post-processing chain would buy at this budget), plus fog from 90
to 340 units that hides the claim's far edge and gives the underground real depth.

## Layout rules

**HUD.** An overlay grid with `pointer-events: none` on the container and `auto` on the
controls, so the world stays clickable everywhere the HUD is not occupying pixels. Top bar
for state (resources, balance, level, wallet), bottom bar for action (energy, panel dock,
city pulse), left column for pending decisions, right column for whatever is under the
cursor.

**Panels are a right-hand drawer, not a modal.** Half the reason to open the City panel is
to look at the city while deciding. The drawer leaves the canvas visible and the camera
orbiting.

**Numbers that change every frame never touch React.** Energy, mining progress and FPS are
written straight to the DOM from a `requestAnimationFrame` loop. Re-rendering a tree sixty
times a second to move one progress bar is the fastest way to make a smooth game feel
slow.

## Motion

| | |
| --- | --- |
| Panel entry | 240ms, `cubic-bezier(0.22, 1, 0.36, 1)` |
| Button press | 150ms, plus a 1px translate — physical feedback |
| Crate reveal | Cards land 520ms apart |
| Rarity flare | 1.1s one-shot, Epic and above only |

The reveal stagger is the most important number in this table. A crate that dumps five
items instantly has no moment in it; half a second between cards is enough for anticipation
and short enough not to be tedious on the twentieth opening. The backdrop warms toward the
best rarity as cards land, so a Legendary is felt before it is read.

`prefers-reduced-motion` collapses every duration to ~0 and freezes the hero diorama at a
fixed angle.

## Accessibility

- Focus rings are a 2px amber outline with 2px offset, never removed.
- Body text on `crust` is `#9daac0`, which is 7.2:1 — comfortably past AA.
- Small `mute` text is reserved for supporting detail, never for anything a player must
  read to act.
- Rarity is never signalled by colour alone: every rarity chip carries its name, and item
  cards show a numeric quality percentage.
- Modals trap focus, restore it on close, and handle Escape with a capturing listener —
  necessary because the canvas is also listening for keys.
- All interactive elements are real `<button>`s. The item card, which is a div for layout
  reasons, carries `role="button"`, `tabIndex` and Enter/Space handling.

## Extending this

Add colours as theme tokens in `globals.css`, never as inline hex. Add components to
[`primitives.tsx`](../src/ui/primitives.tsx) rather than to a feature file — if two panels
need the same thing, it belongs in the vocabulary. Keep the icon set's no-curves rule; one
rounded icon in a set of thirty is more noticeable than it sounds.
