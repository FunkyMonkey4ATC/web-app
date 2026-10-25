# Ground Truth demo script

## 1. Setup checklist

Demo screen (GB10 + projector):

- [ ] Connect the projector. Set 1920x1080.
- [ ] Run `scripts/gb10-start.sh`. Wait for "Ground Truth is up".
- [ ] Turn Wi-Fi off on the GB10. Unplug any Ethernet cable that goes to the internet.
- [ ] Run `scripts/offline-check.sh`. All 4 steps must say PASS. If one fails, fix it before the demo.
- [ ] Open `/console` in Chromium. Make it full screen.
- [ ] If WAV files are in `public/audio`, test the hall sound. If not, the caption shows each call.

Operator device:

- [ ] Connect it to the GB10 on a local network with no internet.
- [ ] Open `/operator` with the LAN address that the start script printed.
- [ ] The status line must say "Offline". Note "Mock agent" or "Live agent".
- [ ] The offline check leaves the incident at 4x. Tap "Normal traffic", "1x", "Play".
- [ ] The confidence threshold must show 0.75.
- [ ] Pipeline rail: Closed.

## 2. Run of show

| Time | Operator does | Presenter says |
|---|---|---|
| 0:00 | Nothing. Normal traffic plays. | "This is a second screen in the SFO tower cab: strips and the airfield. It hears every tower and ground call. Correct calls stay quiet." |
| 0:15 | Opens the rail (backtick on the GB10, or "Pipeline rail" on `/operator`). Points at one normal call. | "This rail is for you, not the controller. Audio, transcript, clearance JSON, four rules, verdict. Each rule says why it passed." |
| 0:40 | Closes the rail. Taps "Incident · without Ground Truth", then "Jump to 10 s before the crossing". | "The LaGuardia runway 4 sequence, March 22, 2026, restaged at SFO with fictional callsigns. A fire truck was cleared across about 20 seconds before a landing. It had no transponder, so no ground alert came." |
| ~1:00 | Nothing. The screen fades to black. | Say nothing. Let the caption show: "LaGuardia, March 22, 2026, 23:37 EDT. Two pilots died." |
| 1:05 | Taps "Incident · with Ground Truth", then "Jump to 10 s before the crossing". | "Same calls. Now Ground Truth listens." |
| ~1:15 | Nothing. The 28L alert appears. | "Red sign: runway 28L. Who and where. A countdown. The screen shows the measured latency from the end of the call." |
| ~1:20 | Nothing. The controller says "Rescue 9, hold position." | "The controller decides. The truck stops at the hold line." Read the closing line when it shows. |
| 1:35 | Opens the rail. Clicks "Outbox" on the GB10 screen. | "Operations and safety get the same alert in Slack. Offline, it waits here." |
| 1:50 | Nothing. | "All of this runs on one Dell Pro Max GB10 in this room. Wi-Fi is off." |

## 3. Judge Q&A

**Why alert the controller and not operations?**
The controller gave the clearance. Only the controller can stop it in time. Operations gets the same alert in Slack.

**Why does it never suggest a clearance?**
The controller keeps authority. Ground Truth flags the conflict and shows the evidence. A wrong suggestion is a new risk.

**How do you prevent false alerts?**
- Four rules run every second. The rail shows each pass and why.
- A call with parser confidence below 0.75 shows amber. No rule fires on it. The threshold is on `/operator`.
- A runway is clear only after a track is outside the runway zone for 3 s, or when "clear of runway" is heard. A departure is clear when airborne or past the runway end.
- Rule 2 (on a runway with no clearance) arms for a recorded aircraft only when we heard radio for it. We have no SFO tower audio, so its clearance may be unheard.

**What is recorded and what is simulated?**
- Recorded: SFO aircraft positions (OpenSky and adsb.lol) and KSFO METAR, 2026-10-25, about 14:12 to 14:42 PDT.
- Simulated: every scenario aircraft and vehicle, marked SIM, with fictional callsigns. Visibility-scenario weather.
- The LaGuardia sequence is restaged from NTSB DCA26MA161. It is not a recording.

**Why SFO?**
In the west plan, departures on 1L and 1R cross the arrival runways 28L and 28R. Crossings happen all day. We also had real SFO traffic and weather.

**What runs where?**
All on one GB10. The web app: replay clock, simulator, conflict checker, screens. The agents: ATC-tuned Whisper, call parser, reasoning model that writes the alert, Slack or outbox. `/operator` shows "Mock agent" (scripted results) or "Live agent".

**What are the limits?**
- Advisory only. Not FAA approved.
- The airfield map is OpenStreetMap geometry (ODbL), not FAA AMDB.
- Speech makes errors: ATC Whisper medium, 15% word error rate fine-tuned vs 95% stock, on one test set. That is why the amber path exists.
- Landing minimums (200 ft, 1/2 SM) are demo values.
- One GB10 is a single point of failure. A real install uses two.

**Why now?** Severe runway incursions rose 44% in 2025; total incursions passed 1,600 (AVweb, FAA Safety Team notice).

Quote no other numbers. Never state latency, accuracy or false-alert rates. Point at what the screen measures.
