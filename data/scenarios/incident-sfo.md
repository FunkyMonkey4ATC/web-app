# Ground Truth radio script (SFO scenarios)

All callsigns are fictional: Bayline (BYL), Fog Express (FGX), Tamal (TML), vehicles Rescue 9 and Ops 7. Every scenario is labeled simulated on screen.

## How to record

- One WAV per call, named by the call id: `public/audio/inc07.wav`. Mono, 16 kHz or higher, no music, a little radio hiss is fine.
- Two voices: a controller (TWR and GND lines) and a pilot or driver (every other line). A third voice for Rescue 9 helps.
- Say it like ATC: brisk and flat. Read runways digit by digit ("two eight left"); say callsign numbers naturally ("Bayline six forty-six").
- Keep each clip near the length shown. The sim schedules calls by these times; a clip that runs long simply overlaps the next one's start.
- After adding WAVs, run `npx tsx scripts/build-recording.ts` so the sim picks them up (it lists `public/audio/*.wav` at build time).

`s+` is seconds from the start of the scenario (the start of the 30-minute SFO recording, 21:12:20Z).

## 1. Incident: "LaGuardia sequence, restaged at SFO"

Based on NTSB DCA26MA161 (LaGuardia, March 22, 2026): a landing clearance, then a vehicle cleared to cross the same runway about 20 s before the aircraft gets there.

Traffic: BYL646 (A320) on a 6 NM final for 28L at 145 kt, reaching taxiway P (0.53 NM past the threshold) at s+163.5. RESCUE9 (fire truck, radio only, no transponder) holding short of 28L on P, south side. FGX211 waiting at 1L, TML88 on the west ramp.

| id | s+ | length | freq | speaker | words |
|---|---|---|---|---|---|
| inc01 | 8.0 | 4.2 s | TWR | Controller to Bayline 646 | Bayline 646, runway two eight left, cleared to land, wind zero five zero at three. |
| inc02 | 12.7 | 2.2 s | TWR | Bayline 646 pilot | Cleared to land two eight left, Bayline 646. |
| inc03 | 30.0 | 2.8 s | TWR | Controller to Fog Express 211 | Fog Express 211, runway one left, line up and wait. |
| inc04 | 33.3 | 2.5 s | TWR | Fog Express 211 pilot | Line up and wait one left, Fog Express 211. |
| inc05 | 60.0 | 2.2 s | GND | Ground controller to Tamal 88 | Tamal 88, runway one right, taxi via Lima. |
| inc06 | 62.7 | 2.5 s | GND | Tamal 88 pilot | Runway one right, taxi via Lima, Tamal 88. |
| inc07 | 143.1 | 2.5 s | TWR | Controller to Rescue 9 | Rescue 9, cross runway two eight left at Papa. |
| inc08 | 146.1 | 2.2 s | TWR | Rescue 9 driver | Cross two eight left at Papa, Rescue 9. |
| inc09 | 150.6 | 1.5 s | TWR | Controller to Rescue 9 | Rescue 9, hold position. |

- inc06 is the low-confidence call (parser confidence 0.62). Record it clipped and stepped on: cut off the end of "right" and "via", as if another transmission blocked it. The typed fallback transcript is "Runway one ri-- taxi v-- Lima, Tamal ate eight."
- inc07 is the conflicting clearance. Ground Truth alerts about a second after it ends.
- inc09 is said only in the "with" ending, about 4 s after the alert. Rescue 9 stops at the hold line. In the "without" ending there is no inc09: the truck drives onto 28L and is on the runway when BYL646 reaches P. The console fades to black about 3 s before that point (s+160.5).
- The operator's "jump to before the crossing" lands at s+133.1, 10 s before inc07. Wind matches the recorded KSFO METAR (05003KT).

## 2. Vehicle enters a runway with no clearance

Traffic: FGX502 (A320) holding short of 1R, lines up after nc02. OPS7 (ops truck with GPS) drives west across 1R at taxiway F (0.71 NM up the runway) at s+40, entering the runway zone at s+54.5. Nothing is said to OPS7: the alert comes from position data alone.

| id | s+ | length | freq | speaker | words |
|---|---|---|---|---|---|
| nc01 | 4.0 | 2.8 s | TWR | Controller to Fog Express 502 | Fog Express 502, runway one right, line up and wait. |
| nc02 | 7.3 | 2.5 s | TWR | Fog Express 502 pilot | Line up and wait one right, Fog Express 502. |

## 3. Visibility drops below minimums

KSFO weather goes from 10 SM, ceiling 2,000 ft, wind 280 at 12 to 1/4 SM in fog, vertical visibility 100 ft, between s+20 and s+80 (simulated SPECIs). Below the demo minimums (200 ft, 1/2 SM) from s+80. TML412 (A320) on a 5 NM final for 28R is cleared to land after that, which escalates the weather caution to a warning.

| id | s+ | length | freq | speaker | words |
|---|---|---|---|---|---|
| vis01 | 95.0 | 4.2 s | TWR | Controller to Tamal 412 | Tamal 412, runway two eight right, cleared to land, wind two eight zero at eight. |
| vis02 | 99.7 | 2.2 s | TWR | Tamal 412 pilot | Cleared to land two eight right, Tamal 412. |

## 4. Normal traffic

A 300 s loop that repeats over the recording (call ids get a `-<loop>` suffix at runtime; the WAV is the same file every loop). Every clearance is correct except one readback: nrm04 reads back the wrong runway, which raises a caution. Nothing here should produce a warning.

| id | s+ | length | freq | speaker | words |
|---|---|---|---|---|---|
| nrm01 | 2.0 | 2.2 s | GND | Ground controller to Tamal 88 | Tamal 88, runway one left, taxi via Alpha. |
| nrm02 | 4.7 | 2.2 s | GND | Tamal 88 pilot | Runway one left, taxi via Alpha, Tamal 88. |
| nrm03 | 20.0 | 2.8 s | TWR | Controller to Fog Express 77 | Fog Express 77, cross runway two eight right at Lima. |
| nrm04 | 23.3 | 2.5 s | TWR | Fog Express 77 pilot | Crossing two eight left at Lima, Fog Express 77. |
| nrm05 | 60.0 | 2.5 s | TWR | Controller to Tamal 88 | Tamal 88, runway one left, line up and wait. |
| nrm06 | 63.0 | 2.2 s | TWR | Tamal 88 pilot | Line up and wait one left, Tamal 88. |
| nrm07 | 70.0 | 2.5 s | GND | Ground controller to Fog Express 77 | Fog Express 77, taxi to the ramp via Alpha. |
| nrm08 | 73.0 | 2.5 s | GND | Fog Express 77 pilot | Taxi to the ramp via Alpha, Fog Express 77. |
| nrm09 | 100.0 | 3.9 s | TWR | Controller to Tamal 88 | Tamal 88, runway one left, wind zero five zero at three, cleared for takeoff. |
| nrm10 | 104.4 | 2.0 s | TWR | Tamal 88 pilot | Cleared for takeoff one left, Tamal 88. |
| nrm11 | 160.0 | 4.2 s | TWR | Controller to Bayline 214 | Bayline 214, runway two eight right, cleared to land, wind zero five zero at three. |
| nrm12 | 164.7 | 2.2 s | TWR | Bayline 214 pilot | Cleared to land two eight right, Bayline 214. |
| nrm13 | 265.0 | 2.5 s | TWR | Controller to Bayline 214 | Bayline 214, cross runway two eight left at Echo. |
| nrm14 | 268.0 | 2.2 s | TWR | Bayline 214 pilot | Cross two eight left at Echo, Bayline 214. |

nrm04 must say "two eight **left**" (the controller said right). That mismatch is the point of the call.
