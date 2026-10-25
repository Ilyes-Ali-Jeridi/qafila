# Hyperframes Composition Brief: Qafila

## Objective
Create a short launch-style brag video for Qafila.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: 21 seconds

## Source Material
- Project root: /Users/ilyesalijeridi/qafila
- Primary files read: README.md, apps/web/app/globals.css (tokens), apps/web/app/layout.tsx (fonts), apps/web/components/landing/data.ts (copy), apps/web/components/deal/deal-card.tsx, apps/web/components/deal/checks-list.tsx, apps/web/app/(public)/charity/ledger.tsx, docs/PLAN.md section 1.3 (numbers)
- Product name: Qafila
- Tagline / strongest claim: "Fund a real shipment for an importer that banks turn down." and "Late fees go to charity. Never to investors."
- Key UI or visual moment to recreate: the spotlight deal card with route line and funding bar; the screening report checks list with the Approved badge; a charity ledger receipt row
- Copy that must appear verbatim:
  - Banks say no to 47% of Africa's small importers.
  - Fund a real shipment. Own the goods. Share a fixed profit.
  - Late fees go to charity. Never to investors.
  - qafila.dev

## Creative Direction
- Tone preset: polished
- Creative direction: a caravan on-chain; dark fintech ledger with aurora light, confident and quiet
- Interpretation: four scenes, slow crossfades (0.6 to 0.8 s), big display type with generous holds, motion from light, counters and sequential ticks rather than from cuts
- Angle: one hard fact about who banks refuse, then the product doing its job (a real deal card, the AI checks landing one by one, the charity rule), ending on the name and domain; every label and number is from the app's own screens
- Hook: "Banks say no to 47% of Africa's small importers." over a rising aurora
- Outro / punchline: "Qafila" wordmark, "qafila.dev", "Built on Stellar at HackMeridian 2026"
- Avoid:
  - Generic SaaS language
  - Abstract filler visuals
  - Unrelated visual redesign
  - Em dashes and hype words in on-screen copy

## Visual Identity
- Background: #070a12; surfaces #0e1322 / #131b30; hairlines rgba(255,255,255,0.08) and rgba(255,255,255,0.16)
- Text: #eef2ff; muted #9aa6c8
- Accent: saffron #f2b23e; teal #2de2c3; indigo glow #3b4cff; aurora gradient indigo → teal → saffron
- Display font: Bricolage Grotesque (local woff2 in assets/fonts)
- Body font: Figtree (local); mono JetBrains Mono (local) for numbers, hashes and amounts
- Visual references from the project: landing hero (aurora over obsidian), spotlight deal card, checks list with teal ticks, charity receipt rows, the "Testnet, test money" pill

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook — 4.0s — "Banks say no to 47% / of Africa's small importers." with the aurora rising
2. Reveal — 4.0s — "Qafila" wordmark, "Fund a real shipment. Own the goods. Share a fixed profit.", pill "on Stellar · testnet, test money"
3. The deal and the checks — 9.0s — deal card (phone cases, Shenzhen → Lagos, 20,000.00, 6% in 90 days, funding bar to 62%) and the report with four checks then "Approved · risk score 100"
4. The rule and outro — 4.0s — "Late fees go to charity. / Never to investors." with a charity receipt row, then the wordmark, qafila.dev, and the HackMeridian line

## Audio
- Audio role: cinematic support, restrained
- Audio arc: clean bed from frame 0 breathing the aurora; a soft landing for the name; two drops and a bell through the checks and approval; a bong on the final wordmark; the bed fades out from 19.5 s
- Music: assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3
- Music treatment: volume 0.32, fade in 0.5 s, fade out from 19.5 s to 21 s
- Music cue guidance: assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json (110 BPM); strong cues 8.74 (card lands), 13.11 (Approved), 17.47 (second rule line); beat grid for the checks 9.83, 10.37, 10.93, 11.46; 19.66 for the final wordmark
- Audio-reactive treatment: subtle; assets/audio-data.json (30 fps, 16 bands) drives the aurora glow opacity and the card spotlight with bass, and the wordmark glow with treble; no bars, no pulsing text
- Audio-coupled moments:
  - Scene 2 wordmark landing — impactSoft_medium_001 at the landing
  - Scene 3 first and last check — drop_001
  - Scene 3 Approved badge — impactBell_heavy_000 on the 13.11 s cue
  - Scene 4 final wordmark — bong_001 on the 19.66 s cue
- SFX selection guidance: warm, low high-frequency risk, aligned to the start of each motion, 0.55 to 0.7 volume
- SFX analysis guidance: ~/.claude/plugins/cache/brag/brag/0.2.2/skills/brag/assets/sfx/sfx-analysis.md
- Exact SFX choice: the files above are already copied to assets/sfx; timestamps follow the implemented animation
- Audio files: assets/music and assets/sfx inside the composition

## Hyperframes Instructions
Follow hyperframes-core (standalone root, one paused GSAP timeline registered as window.__timelines["main"], data-duration 21, local @font-face for every named family, no crossorigin on media, every audio element with an id), hyperframes-animation (fromTo tweens, transform aliases only, no CSS transform fighting GSAP), hyperframes-creative (video-medium scale, depth layers, audio-reactive per-frame sampling with tl.call), hyperframes-cli (`npx hyperframes check` as the single gate, then render to ../brag.mp4).

Requirements:
- Show the deal card, the checks list and the charity receipt as recreated UI from the project.
- Keep all text readable (reading floors from the plan), WCAG AA contrast on the obsidian background.
- 21 seconds total; music, SFX and audio-reactive glow present.
- Beat-lock the card landing, the Approved badge and the rule line; snap the four checks to the beat grid; mark them in the script.
