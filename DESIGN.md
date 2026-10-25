---
name: Ground Truth
description: A graphite tower console that stays silent until the airfield disagrees with the radio, and names the airfield in FAA sign language.
colors:
  ground: "#1a1d21"
  panel: "#22262b"
  raised: "#2a2f35"
  seam: "#3a4048"
  ink: "#f2f4f6"
  ink-2: "#b9bfc7"
  ink-3: "#8a929c"
  runway: "#4a5059"
  taxiway: "#343a41"
  apron: "#262a30"
  paint: "#f2f4f6"
  clear: "#5ac8fa"
  warn: "#ff453a"
  warn-sign: "#d92d20"
  caution: "#ff9f0a"
  sign-black: "#0b0c0e"
  sign-yellow: "#ffd100"
  sign-white: "#ffffff"
typography:
  display:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 7vw, 5rem)"
    fontWeight: 700
    lineHeight: 1.05
  clock:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "tnum"
  alert:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.25
  callsign:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 700
    lineHeight: 1
  title:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.35
  body:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.35
    fontFeature: "tnum"
  secondary:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.35
  tag:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    letterSpacing: "0.05em"
  sign:
    fontFamily: "Atkinson Hyperlegible Next Variable, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.02em"
  mono:
    fontFamily: "Atkinson Hyperlegible Mono Variable, ui-monospace, monospace"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.375
rounded:
  none: "0px"
  sign: "2px"
  control: "4px"
spacing:
  seam: "1px"
  xs: "6px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  sign-location:
    backgroundColor: "{colors.sign-black}"
    textColor: "{colors.sign-yellow}"
    typography: "{typography.sign}"
    rounded: "{rounded.sign}"
    padding: "0.2em 0.4em"
  sign-mandatory:
    backgroundColor: "{colors.warn-sign}"
    textColor: "{colors.sign-white}"
    typography: "{typography.sign}"
    padding: "0.25em 0.5em"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ground}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "40px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "40px"
  strip:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.callsign}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
    height: "78px"
  strip-quiet:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "8px 14px"
  alert-warning:
    backgroundColor: "color-mix(in srgb, #ff453a 12%, #22262b)"
    textColor: "{colors.ink}"
    typography: "{typography.alert}"
    padding: "12px 24px"
  alert-caution:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    padding: "12px 24px"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px"
---

# Design System: Ground Truth

## Overview

**Creative North Star: "The Quiet Cab"**

A graphite working surface where nothing speaks until the airfield disagrees with the radio, and the airfield names itself in its own sign language. The console is a second screen beside a controller's scope and a projector image in a bright hall, so everything is tuned for distance: lifted dark ground rather than black, 7:1 text, heavy strokes, large type, tabular figures. Normal traffic reads as calm grey geometry and quiet one-line confirmations; a conflict turns one runway red, puts a plain sentence across the top of the map, and leads with a red mandatory sign.

The identity is borrowed, not invented: runway, taxiway and position names sit in FAA location-sign panels (black field, yellow border, yellow legend), and every warning leads with a red mandatory runway sign. Color is reserved semantics, never decoration. The same world carries the console (/console), the operator remote (/operator) and the splash (/), with the splash allowed one large display headline.

It refuses the ASDE-X slate-and-cyan scope, the SaaS card dashboard, sci-fi HUD styling, code-looking or game-looking type, and anything playful.

**Key Characteristics:**
- Graphite tonal layers split by 1px seams; no shadows anywhere.
- One typeface, Atkinson Hyperlegible Next, for every word and figure; mono only for raw JSON in the rail.
- FAA airfield signs as the identity layer: location signs for names, mandatory signs for warnings and hold-position.
- Strict aviation color semantics, each state doubled by a shape or word.
- State changes are instant; only strips move, and only when they reorder (plus a single cyan pulse on a called target).

## Colors

A near-neutral graphite field with four reserved signal colors, each owning exactly one meaning.

### Primary
- **Clearance Cyan** (clear): the ink of permission. Clearance shorthand on strips and map labels (CLRD LAND 28L, XING 28L @P), the caption's "from → to" speaker line, the selection ring and outline, the focus ring, text selection, caret, and the operator's playing state. Cyan means "cleared, informational, or selected", never alarm.

### Signal
- **Warning Red** (warn): a conflict needing action now, and nothing else. The alert banner's 12% tint and WARNING word, the conflict zone fill (20% tint) and stroke, conflict paths and ring, the countdown panel on the map, the CONFLICT tag and band on a strip.
- **Mandatory Sign Red** (warn-sign): the field of a mandatory runway sign only (alert banner runway, holding-position sign on the map), with a white legend and border inside a sign-black keyline.
- **Caution Orange** (caution): low parser confidence, readback mismatch, and weather near or below minimums. Caution banners, CAUTION and "? 0.62" confidence tags, caution strip border and band, weather below-minimums line, rail verdicts for caution rules.

### Sign
- **Sign Black** (sign-black): location-sign field, mandatory-sign keyline, text on red countdown and selection fills.
- **Sign Yellow** (sign-yellow): location-sign legend and border. Exists only inside sign panels.
- **Sign White** (sign-white): mandatory-sign legend and border only.

### Neutral
- **Graphite Ground** (ground): app background and map ground; also the halo stroke behind every map label.
- **Panel** (panel): header cells, bays, caption bar, rail, operator cards.
- **Raised** (raised): strips, apron polygons, hover fill on panel rows, open rail rows.
- **Seam** (seam): the 1px hairline between panels (drawn as gap over a seam-colored parent), terminal footprints, quiet borders, scrollbar thumb.
- **Ink** (ink): primary text, solid aircraft chevrons, primary button fill.
- **Ink 2** (ink-2): secondary text, outline-button borders, tier-2 map labels, SIM tags. Holds 7:1 on panel.
- **Ink 3** (ink-3): dimmed and disabled; parked traffic, hold lines, overrun chevrons, final-approach ticks, the idle "Listening" caption, attribution.
- **Runway / Taxiway / Apron / Paint**: map pavement in three graphite steps plus white markings (dashed centerlines at 80%, threshold bars).

### Named Rules
**The Reserved Signal Rule.** Red means a warning that needs action now; orange means a caution; nothing else may borrow either, not even for emphasis, hover or branding. If an element is red, the controller must act.

**The Sign Yellow Rule.** Sign yellow appears only inside a location-sign panel (black field, yellow border, yellow legend). Never as an accent, text color, highlight or chart color.

**The Two Channels Rule.** Every state carries a shape or word as well as a color: filled triangle plus WARNING, outlined triangle plus CAUTION, "?" plus a confidence figure, SIM/EST/VEH tags, dashed borders.

## Typography

**Display Font:** Atkinson Hyperlegible Next Variable (with system-ui, sans-serif)
**Body Font:** Atkinson Hyperlegible Next Variable (same family)
**Label/Mono Font:** Atkinson Hyperlegible Mono Variable, raw JSON in the rail only

**Character:** One humanist, legibility-engineered face for every word and figure, chosen so non-technical readers and a projector audience can read it at distance. Weight, not family, carries hierarchy; figures are tabular everywhere.

### Hierarchy
- **Display** (700, clamp(2.5rem, 7vw, 5rem), 1.05): the splash headline only.
- **Clock** (700, 40px, 1): the Zulu clock in the header and on the operator page.
- **Alert** (600, 32px, tight): the plain-sentence warning in the alert banner; cautions drop to 26px.
- **Callsign** (700, 26px, 1): callsigns on full strips; quiet one-row strips drop to 22px.
- **Title** (600, 22px): bay headers, header values, location signs in the header and banner.
- **Body** (400, 18px, 1.35): base text, strip clearance lines, buttons.
- **Secondary** (400, 16px): metadata, types, distances, timestamps, weather sub-line.
- **Tag** (700, 16px, 0.05em tracking, uppercase): WARNING/CAUTION words, CONFLICT, SIM, VEH, ONLINE/OFFLINE. Status vocabulary only.
- **Sign** (800, 0.02em, line-height 1): legends inside sign panels, sized to their context.
- Map text: callsign labels 17px (tier 1) / 15px (tier 2) bold with a 4px ground halo; designators 15px bold; edge markers 15px bold; SIM/EST map tags 11px extra-bold.

### Named Rules
**The One Face Rule.** Atkinson Hyperlegible for every word and figure; the mono cut appears only for raw JSON in the pipeline rail.

**The 14px Floor Rule.** 14px (text-xs) is never used for anything the controller must read; it is limited to the judge-facing rail.

## Layout

A fixed, full-viewport console at 1920x1080 with no page scroll. The grid is a set of panels separated by 1px seams (a seam-colored parent with a 1px gap), never by margins or cards.

- **Header** (84px): cells for name + "SFO Tower" sign, Zulu clock over local time, ARR/DEP runway signs with the override popover, decoded weather, then SIM scenario chip, ONLINE/OFFLINE and audio controls pushed right. Secondary detail hides below 1600px.
- **Body**: 65fr / 35fr. Left: the alert dock overlays the top of the tower-view map (bearing 61) without resizing it, and a 64px caption bar sits under the map. Right: strip bays, with the pipeline rail sliding over them.
- **Operator**: a single column (max 576px) that becomes two columns at lg (max 1024px), panels seamed the same way, with a sticky clock header; touch targets at least 56px.
- **Splash**: copy column (max 768px) left, the LaGuardia reconstruction filling the right side behind nothing at md+, stacked below the copy on phones.

Rhythm: 16px panel padding, 24px banner and caption padding, 12px bay padding, 6px between strips, 40px control height (36px secondary, 28px small).

**The Panels Hold Rule.** Panels never resize or move in response to data; alerts overlay, the rail slides over, and only strips reorder.

## Elevation & Depth

Flat by construction. Depth is tonal: ground, panel, raised, each a few steps lighter, split by 1px seams. There are no box shadows; the only stacked layers are the alert dock over the map, the rail over the strips, and the override popover, each separated by a seam line rather than a shadow. Map labels lift off pavement with a 4px ground-colored text halo, not a shadow.

**The Seams Not Shadows Rule.** Separation is a 1px seam (#3a4048) or a tonal step; a box-shadow anywhere is a defect.

## Shapes

Engineered and nearly square. Controls and aircraft strips use a gentle 4px corner; sign panels 2px; panels and vehicle strips are square (0). Status tags use 4px corners with 1-2px borders. Signal borders thicken to 2px for warning and caution. Simulated things are dashed (strip border, SIM tag, scenario chip); estimated positions are dashed symbols.

**The Dashed Means Simulated Rule.** A dashed border or dashed symbol means simulated or estimated, and nothing else. Recorded traffic is always solid.

**The Square Vehicle Rule.** Vehicles are square: square map symbol, square-cornered strip, hatched band, boxed VEH tag. Aircraft are chevrons and 4px strips.

## Components

### Airfield Signs (signature)
- **Location sign:** black field, 2px yellow border, yellow 800-weight legend, 2px corners. Names runways (ARR/DEP config, banner caution runway), taxiways on the map, and positions ("SFO Tower").
- **Mandatory sign:** red field, 2px white border and white legend inside a 2px sign-black outline. Leads every warning banner and marks the runway holding position on the map (e.g. "10R-28L"), placed behind the hold line on the holder's screen-left.
- **Countdown panel (map):** warn-red field with sign-black legend ("BYL646 at P in 13 s"), placed off the pavement away from the terminals, with a dotted red leader to the conflict point.

### Alert Banners
- **Warning:** a 12% red tint over panel and no side bar (the red mandatory sign leads), then: mandatory runway sign, filled triangle + WARNING in red tag type, the rule detail in ink-2; the 32px plain sentence; then Acknowledge (primary, with A key), the countdown in bold ink, latency and Zulu time, and False alarm (outline, F key) pushed right. role="alert".
- **Caution:** 2px orange border on panel, location sign, outlined triangle + CAUTION, 26px sentence. role="status".
- Up to three stack newest first, seamed; overflow collapses to "+N more". Acknowledged banners replace the buttons with a plain-word state.

### Strips
- **Full strip** (a clearance or a conflict earns it): 78px min, raised fill, 4px corners, 1px seam border, an 8px left band (runway grey for aircraft, ink-2 hatch for vehicles, red or orange in conflict), callsign 26px bold, type, SIM tag, cyan clearance with Zulu time, distance and speed right-aligned.
- **Quiet strip:** one row, ink-2 text, 22px callsign; no clearance line.
- **States:** warning = 2px red border + red band + filled CONFLICT tag; caution = 2px orange border + orange band + outlined CAUTION tag; low confidence = orange "? 0.62" tag; simulated = dashed border; selected = 3px cyan outline offset 2px.
- **Bays:** Arriving, On runway, Holding short, Taxi out, At gate (collapsed behind Show/Hide). 40px bay header in 22px ink-2 with the count right. Strips in conflict rank first, then runway clearances (CLRD LAND, CLRD TKOF, LUAW, XING, H/S, HOLD POSN), then other clearances, then none; reorders animate 200ms ease-out (FLIP), off under reduced motion.

### Airfield Map
- **Pavement:** runways and stopways in runway grey at full paved length, white dashed centerlines, threshold bars; taxiways in taxiway grey; aprons raised; terminals seam; hold lines and final-approach ticks (1 to 5 NM) in faint ink-3.
- **Overrun chevrons:** faint ink-3 chevrons on each stopway pointing at the threshold, one per 30m.
- **Designators:** FAA-diagram style, upright, just past each threshold beside the extended centerline, L to the pilot's left and R to the right; in ink when in use (ARR/DEP), ink-2 otherwise.
- **Targets:** aircraft are heading chevrons (solid ink; hollow for simulated or estimated, dashed when estimated); vehicles are squares. A normal call pulses its target once with a cyan ring; selection draws a 20px cyan ring.
- **Label tiers (clearance first):** tier 1 (runway clearance, on a runway or final, alert party, selected, caption target) gets callsign + cyan clearance and may take any of four sides; tier 2 (other clearance or moving) gets callsign only, right or left; tier 3 (parked, no clearance) is a small faint symbol at 35% opacity with no label. Labels never overlap each other, designators or signs. During a warning, uninvolved traffic drops to 30%.
- **Conflict overlay:** zone at 20% red with a 3px red stroke, crossing path dashed and landing path solid with arrowheads, a red ring at the conflict point.
- **Edge markers:** arrivals beyond the frame show as a chevron + "BYL646 4.8 NM" where the final leaves the map.

### Buttons
- **Primary:** ink fill, ground text, 4px corners, 40px tall, semibold 18px; keyboard hint in a bordered kbd chip.
- **Outline:** transparent, 1px ink-2 border, ink text; hover brightens the border to ink. On the operator remote, pressed or checked buttons invert to ink fill; disabled drop to seam border and ink-3 text.
- **Focus:** a 3px cyan outline offset 2px on every focusable element.

### Pipeline Rail (demo)
Slides over the strip bays on backtick (200ms ease-out, none under reduced motion). 56px header, a stat row of 3 to 6 seamed cells, underlined tabs (3px ink underline when active), expandable call rows, and raw JSON in the mono cut on ground. Verdicts use the signal colors under the same semantics.

### Header and Caption
The header is a row of seamed panel cells; the caption bar shows the speaker line in cyan with an arrow, the quoted transmission at 22px medium, and Zulu time at the right; idle it reads "Listening to tower and ground" in ink-3.

### Splash
One display headline, the ink-2 subline at 22px, one plain statistic, a primary and an outline button, the reconstruction drawn with the same map vocabulary, and a footer line "Runs on one Dell Pro Max GB10".

## Do's and Don'ts

### Do:
- **Do** put every runway, taxiway and position name in a location sign (black field, yellow border, yellow legend).
- **Do** lead every warning with a red mandatory sign and a filled triangle plus the word WARNING.
- **Do** write clearance text in cyan and nothing alarming in cyan.
- **Do** separate panels with 1px seams over the seam color and keep every panel in place.
- **Do** keep parked traffic quiet (small, 35% opacity, unlabeled) so cleared and moving traffic stands out.
- **Do** mark simulated and estimated things with dashes and a SIM or EST tag.
- **Do** switch every motion off under prefers-reduced-motion (strip FLIP, rail slide).

### Don't:
- **Don't** use red or orange for anything but warnings and cautions, or sign yellow outside a sign panel.
- **Don't** add box shadows, gradients, glows or glass; depth is tonal.
- **Don't** introduce a second typeface or code-looking type outside the rail's raw JSON.
- **Don't** set controller-facing text below 16px.
- **Don't** resize or reflow panels on an alert; overlay instead.
- **Don't** style the console as an ASDE-X slate-and-cyan scope, a SaaS card dashboard, a sci-fi HUD or anything playful.
