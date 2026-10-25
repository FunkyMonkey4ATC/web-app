# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS, with a small custom Node server alongside Next for the WebSocket. No component library. The airfield map is SVG drawn from bundled OpenStreetMap GeoJSON (no map library, no tiles). Fonts bundled in the repo (Atkinson Hyperlegible Next). Runs on one Dell Pro Max GB10 (ARM64, DGX OS) in Chromium.

## Users

Primary: the tower controller at San Francisco (KSFO), local and ground positions in one cab. The console sits beside the controller's existing scope as a second screen. It hears every tower and ground call with no button press and speaks up only when an instruction conflicts with the live airfield. The controller never types, and the console never tells them what to say.

Secondary: airport operations and safety teams, who receive the same alerts in Slack (or the offline outbox).

Demo audience: hackathon judges watching on a projector in a bright hall. They see the controller view plus a demo-only pipeline rail that shows the agents at work.

## Product Purpose

Ground Truth is a runway safety agent that runs inside the airport, 24 hours a day, on one Dell GB10. It fuses three streams (tower radio, aircraft and vehicle positions, weather) and checks every tower instruction against the live state of the airfield. It augments the controller; it does not replace them.

Success: a conflicting clearance produces one specific, correct alert about a second after the radio call ends, with the evidence (audio clip, positions, weather) attached, and normal traffic produces no false alerts.

## Positioning

Position data alone missed the LaGuardia runway 4 crash (the truck had no transponder) and radio alone cannot see a vehicle that moves without permission. Ground Truth uses both, judges each call in about a second, and does it on hardware inside the airport with no cloud dependency.

## Operating Context

- SFO runways 10L/28R, 10R/28L, 1L/19R, 1R/19L. Typical west plan: arrivals 28L/28R, departures 1L/1R, which cross the arrival runways. Runway configuration is set by the recording or scenario; the controller can override it with one click.
- Controllers work in UTC (Zulu). Strips and calls use ATC shorthand; alert banners use plain sentences.
- Demo is fully offline: a 30-minute SFO recording (OpenSky and adsb.lol positions, KSFO METAR, tower audio when obtained), replayed on one clock, plus scenario-injected simulated traffic.
- Scenarios: the LaGuardia runway 4 sequence of March 22, 2026 restaged at SFO (a landing clearance, then a vehicle cleared to cross the same runway about 20 s later), labeled simulated, with fictional callsigns; a vehicle entering a runway with no clearance while a departure lines up; visibility dropping below minimums; normal traffic.
- A demo operator drives scenarios and the clock from a separate /operator page on a second device.

## Capabilities and Constraints

- Agents (Chris, agentic-workflow repo): ATC speech-to-text (ATC-tuned Whisper), call parser (radio text to clearance JSON), reasoning model that rates severity and writes the alert, Slack posting and offline outbox, OpenShell egress policy. Chris defines his API; web-app adapts to it. Ports and base URL are Chris's to set and come from env.
- web-app owns: replay clock, traffic simulator, scenario injector, conflict checker, WebSocket event stream, all UI. It sends audio clips to Chris's speech endpoint, POSTs conflict events to his agent, and receives alerts back by POST.
- Until Chris's endpoints are live, a scripted mock adapter (typed transcript, hand-written clearance JSON, canned alerts with realistic delays) drives the pipeline behind one env flag. Speech fallback to the typed transcript is silent on screen.
- Data contract: clearance, track, weather and conflict events as defined in the Linear hub doc. Track `source` is `recorded` or `simulated`.
- Checker rules, every second: (1) crossing or takeoff clearance on a runway where an aircraft is cleared to land and not yet clear; (2) aircraft or vehicle inside a runway zone with no matching clearance; (3) weather below landing minimums for the runway in use; (4) readback that doesn't match the instruction (amber caution).
- Runway clear = track outside the runway zone for 3 s, or a "clear of runway" report heard; departures clear once airborne or past the runway end.
- Calls with parser confidence below 0.75 show amber with no rule firing. The threshold is adjustable on /operator.
- Landing minimums: ILS CAT I values (200 ft ceiling, 1/2 SM), configurable, labeled demo values. Weather below minimums shows on the weather panel only (no controller banner) but still goes to the agent and Slack for ops.
- Radio-only vehicles (no GPS) appear at an estimated position derived from their last clearance, marked EST.
- Live microphone: the console listens continuously (browser mic to Chris's speech model on the GB10), alongside the recorded replay.
- Controller feedback per alert: Acknowledge or False alarm, optional, logged for eval numbers. Alerts clear on their own when the conflict resolves and move to history.
- Hard deadline: feature freeze and offline test by 17:00 PT on 2026-10-25. First to cut if late: the two-ending incident replay, the gate bay.
- Not FAA approved; advisory only. One GB10 is a single point of failure (a real install uses two).

## Brand Commitments

- Product name: Ground Truth. The landing page shows only this name plus the plain-text line "Runs on one Dell Pro Max GB10". No Dell or NVIDIA logos.
- Headline: "A second set of ears for the tower."
- Subline: "Ground Truth listens to tower radio, matches each call to live aircraft, vehicle and weather data, and flags conflicts in about a second. It runs on one Dell Pro Max GB10, fully offline."
- Look: graphite working surface with hairline seams, plus the airfield sign system as identity (runway, taxiway and position names in location-sign panels; warnings led by a red mandatory sign). Typeface: Atkinson Hyperlegible, chosen for legibility by non-technical readers; no code-looking or game-looking type.
- Must not feel like: a sci-fi HUD, a generic SaaS dashboard, a dated government tool, or anything playful.
- First impression the console must give a judge: cutting-edge AI at work. The controller view stays simple; the pipeline rail carries the visible intelligence.

## Evidence on Hand

- Linear hub doc (Ground Truth team hub): data contract, rules, pitch, sourced numbers.
- NTSB DCA26MA161: LaGuardia, March 22, 2026, 23:37 EDT (03:37Z), Jazz 646 (CRJ-900) and Rescue 35 on runway 4; crossing clearance about 20 s before collision; two pilots died; no ground-surveillance alert because the truck had no transponder.
- Severe runway incursions up 44% in 2025; total incursions passed 1,600 (AVweb on an FAA Safety Team notice).
- ATC Whisper medium: 15% word error rate after fine-tuning vs 95% stock, on one test set.
- On hand: data/sfo-airfield.geojson (OpenStreetMap, ODbL, attribution required), data/recording/sfo/ (positions and METAR, 14:13 to 14:43 PT). Not yet on hand: SFO tower audio, recorded scenario calls, Chris's endpoints. Do not fabricate measured accuracy, latency or false-alert numbers; show only what the running system measures.
- Numbers never used: $400K savings, 300 lives or $250M per crash, American Eagle 5342.

## Product Principles

1. Augment, never control. The agent flags conflicts; it never suggests clearances.
2. Silent until it matters, then unmistakable and specific: what, where, who, how long until it's too late.
3. Show the evidence. Every alert carries the calls, positions and weather behind it, and the demo shows why rules passed, not only when they fire.
4. Honest about what is simulated. Simulated traffic is always visibly marked.
5. Nothing moves that the controller didn't expect. Panels hold their place; only strips reorder, animated.

## Accessibility & Inclusion

- Projector in a bright hall: high contrast, heavy strokes, large type, readable from a few meters at 1920x1080.
- Strict aviation color semantics: red only for warnings needing action now, amber only for cautions. Every state also carries a shape or word so it survives color blindness.
- Keyboard: A acknowledge, F false alarm, Z zoom, Esc clear selection, ` toggles the demo rail.
