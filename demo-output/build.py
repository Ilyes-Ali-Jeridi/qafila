"""Builds demo-output/composition/index.html from the narration segments: four scenes in the HackMeridian format,
the re-timed screen recording in the middle, one subtitle per spoken sentence, Polly narration and a music bed."""
import json, html
C = 'demo-output/composition'
segs = json.load(open(f'{C}/assets/voice/segments.json'))
GAP = 0.35
VIDEO_AT, VIDEO_LEN = 30.0, 89.63
TOTAL = 180.0
# planned beats inside the demo (seconds after the video starts), matched to what the recording shows at 1.22x
DEMO_BEATS = [0, 4.5, 13.5, 17.5, 25.5, 33.5, 42, 50, 58, 63.5, 70.5, 78, 83]
starts = {}
t = 0.5
for s in segs:
  key = (s['section'], s['n'])
  if s['section'] == 'problem':
    starts[key] = t; t = t + s['duration'] + GAP
  elif s['section'] == 'demo':
    beat = VIDEO_AT + DEMO_BEATS[s['n'] - 1]
    prev = starts.get(('demo', s['n'] - 1))
    at = max(beat, (prev + segs[[x['file'] for x in segs].index(f"assets/voice/demo-{s['n']-1}.mp3")]['duration'] + GAP) if prev is not None else beat)
    starts[key] = at
  elif s['section'] == 'how':
    if s['n'] == 1: t = VIDEO_AT + VIDEO_LEN + 0.6
    starts[key] = t; t = t + s['duration'] + GAP
  elif s['section'] == 'next':
    if s['n'] == 1: t = 150.4
    starts[key] = t; t = t + s['duration'] + GAP
end_of = {k: starts[k] + next(x['duration'] for x in segs if (x['section'], x['n']) == k) for k in starts}
assert end_of[('demo', 13)] < VIDEO_AT + VIDEO_LEN - 0.3, end_of[('demo', 13)]
assert end_of[('next', 5)] < TOTAL - 1.0, end_of[('next', 5)]
A = {f"{k[0]}{k[1]}": round(v, 2) for k, v in starts.items()}
HOW_AT = round(VIDEO_AT + VIDEO_LEN, 2)

audio = '\n'.join(f'      <audio id="v-{s["section"]}-{s["n"]}" data-start="{starts[(s["section"], s["n"])]:.2f}" data-duration="{s["duration"]}" data-track-index="20" data-volume="1" src="{s["file"]}"></audio>' for s in segs)
caps = '\n'.join(f'      <div id="cap-{s["section"]}-{s["n"]}" class="clip cap" data-start="{starts[(s["section"], s["n"])]:.2f}" data-duration="{s["duration"] + 0.3:.2f}" data-track-index="30"><p class="t">{html.escape(s["text"])}</p></div>' for s in segs)
capfx = '\n'.join(f"      tl.fromTo('#cap-{s['section']}-{s['n']} .t', {{ opacity: 0, y: 10 }}, {{ opacity: 1, y: 0, duration: 0.25, ease: EASE }}, {starts[(s['section'], s['n'])]:.2f});" for s in segs)

page = f'''<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Qafila demo</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face {{ font-family: 'Bricolage Grotesque'; src: url('assets/fonts/bricolage-grotesque.woff2') format('woff2'); font-weight: 200 800; font-display: block; }}
      @font-face {{ font-family: 'Figtree'; src: url('assets/fonts/figtree.woff2') format('woff2'); font-weight: 500; font-display: block; }}
      @font-face {{ font-family: 'JetBrains Mono'; src: url('assets/fonts/jetbrains-mono.woff2') format('woff2'); font-weight: 500; font-display: block; }}
      :root {{
        --page: #070a12; --surface: #0e1322; --surface-2: #131b30;
        --line: rgba(255, 255, 255, 0.08); --line-strong: rgba(255, 255, 255, 0.16);
        --ink: #eef2ff; --muted: #9aa6c8; --faint: #7a86a6;
        --saffron: #f2b23e; --teal: #2de2c3; --indigo: #3b4cff; --indigo-ink: #aeb8ff; --success: #3ddc97;
        --display: 'Bricolage Grotesque', sans-serif; --body: 'Figtree', sans-serif; --mono: 'JetBrains Mono', monospace;
      }}
      * {{ margin: 0; padding: 0; box-sizing: border-box; }}
      html, body {{ width: 1920px; height: 1080px; overflow: hidden; background: var(--page); color: var(--ink); font-family: var(--body); }}
      #root {{ position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--page); }}
      .clip {{ position: absolute; inset: 0; }}
      #bg {{ position: absolute; inset: 0; }}
      #grid {{ position: absolute; inset: 0; opacity: 0.3;
        background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px); background-size: 96px 96px;
        mask-image: radial-gradient(ellipse 70% 60% at 50% 55%, #000 30%, transparent 100%); -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 55%, #000 30%, transparent 100%); }}
      #aurora {{ position: absolute; left: -200px; right: -200px; bottom: -420px; height: 1100px; filter: blur(70px); opacity: 0.5; }}
      .blob {{ position: absolute; border-radius: 50%; }}
      #blob-indigo {{ left: 120px; bottom: 60px; width: 1100px; height: 640px; background: radial-gradient(closest-side, rgba(59, 76, 255, 0.85), rgba(59, 76, 255, 0)); }}
      #blob-teal {{ left: 760px; bottom: 140px; width: 1000px; height: 620px; background: radial-gradient(closest-side, rgba(45, 226, 195, 0.7), rgba(45, 226, 195, 0)); }}
      #blob-saffron {{ left: 1300px; bottom: 40px; width: 900px; height: 560px; background: radial-gradient(closest-side, rgba(242, 178, 62, 0.65), rgba(242, 178, 62, 0)); }}
      #vignette {{ position: absolute; inset: 0; background: radial-gradient(ellipse 80% 70% at 50% 45%, transparent 55%, rgba(7, 10, 18, 0.75) 100%); }}
      #testnet {{ position: absolute; right: 140px; top: 44px; display: flex; align-items: center; gap: 12px; font-family: var(--mono); font-size: 24px; color: #b4bedb; letter-spacing: 0.04em; }}
      #testnet .dot {{ width: 10px; height: 10px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 14px var(--teal); }}
      #part {{ position: absolute; left: 140px; top: 44px; display: flex; gap: 10px; font-family: var(--mono); font-size: 22px; letter-spacing: 0.1em; text-transform: uppercase; color: #aeb8d8; }}
      #part span {{ padding: 8px 16px; border-radius: 999px; border: 1px solid var(--line); }}
      #part span.on {{ color: #1a1200; background: var(--saffron); border-color: var(--saffron); font-weight: 600; }}

      .eyebrow {{ font-family: var(--mono); font-size: 26px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--teal); }}
      .display {{ font-family: var(--display); font-weight: 800; letter-spacing: -0.035em; line-height: 0.98; color: var(--ink); }}
      .saffron {{ color: var(--saffron); }}
      .card-bg {{ border-radius: 28px; border: 1px solid var(--line-strong); background: linear-gradient(180deg, rgba(19, 27, 48, 0.94), rgba(14, 19, 34, 0.94)); box-shadow: 0 30px 80px -30px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.06); }}
      .wrap {{ position: absolute; left: 160px; top: 150px; width: 1600px; }}
      .wrap h2 {{ margin-top: 22px; font-size: 96px; max-width: 1400px; }}
      .cards {{ position: absolute; left: 160px; right: 160px; top: 470px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }}
      .cards.four {{ grid-template-columns: repeat(4, 1fr); top: 430px; }}
      .card {{ padding: 34px 36px; min-height: 250px; }}
      .card .idx {{ font-family: var(--mono); font-size: 22px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--saffron); }}
      .card h3 {{ margin-top: 16px; font-family: var(--display); font-weight: 700; font-size: 40px; letter-spacing: -0.02em; line-height: 1.08; }}
      .card p {{ margin-top: 14px; font-size: 27px; line-height: 1.3; color: var(--muted); }}
      .chip {{ position: absolute; display: flex; align-items: center; gap: 14px; padding: 18px 26px; border-radius: 16px; border: 1px solid rgba(45, 226, 195, 0.4); background: rgba(14, 19, 34, 0.96); color: var(--ink); font-size: 28px; }}
      .chip .dot {{ flex: none; width: 12px; height: 12px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 14px var(--teal); }}
      .chip.gold {{ border-color: rgba(242, 178, 62, 0.55); }} .chip.gold .dot {{ background: var(--saffron); box-shadow: 0 0 14px var(--saffron); }}
      .stat {{ position: absolute; left: 160px; top: 470px; display: flex; gap: 28px; }}
      .stat .box {{ padding: 34px 40px; min-width: 520px; }}
      .stat .n {{ font-family: var(--display); font-weight: 800; font-size: 112px; letter-spacing: -0.04em; line-height: 1; }}
      .stat .l {{ margin-top: 10px; font-size: 28px; color: var(--muted); max-width: 520px; line-height: 1.3; }}
      .stat .src {{ margin-top: 14px; font-family: var(--mono); font-size: 20px; color: #9aa6c8; }}
      #s1-close {{ position: absolute; left: 160px; top: 470px; font-size: 112px; max-width: 1500px; }}

      /* the recording */
      #frame {{ position: absolute; left: 258px; top: 94px; width: 1404px; height: 806px; border-radius: 24px; border: 1px solid var(--line-strong); background: var(--page);
        box-shadow: 0 50px 120px -30px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(45, 226, 195, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.08); }}
      #rec {{ position: absolute; left: 260px; top: 96px; width: 1400px; height: 802px; border-radius: 22px; object-fit: cover; object-position: 50% 100%; background: #000; }}
      #live {{ position: absolute; right: 140px; top: 44px; display: flex; align-items: center; gap: 12px; padding: 9px 20px; border-radius: 999px; border: 1px solid rgba(255, 77, 109, 0.35); background: rgba(7, 10, 18, 0.82); font-family: var(--mono); font-size: 22px; color: #ffd0d8; letter-spacing: 0.08em; }}
      #live .dot {{ width: 10px; height: 10px; border-radius: 50%; background: #ff4d6d; box-shadow: 0 0 12px #ff4d6d; }}

      /* subtitles */
      .cap {{ inset: auto 0 44px 0; display: flex; justify-content: center; pointer-events: none; }}
      .cap .t {{ max-width: 1560px; padding: 14px 30px; border-radius: 16px; background: rgba(7, 10, 18, 0.82); border: 1px solid rgba(255, 255, 255, 0.1); font-size: 36px; line-height: 1.3; text-align: center; color: #fff; text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8); }}

      /* next */
      #s4-final {{ position: absolute; left: 160px; top: 440px; }}
      #s4-mark {{ font-family: var(--display); font-weight: 800; font-size: 150px; letter-spacing: -0.05em; line-height: 1; }}
      #s4-tag {{ margin-top: 18px; font-size: 44px; color: var(--ink); max-width: 1400px; line-height: 1.2; }}
      #s4-url {{ margin-top: 30px; display: inline-flex; align-items: center; gap: 16px; padding: 16px 30px; border-radius: 999px; border: 1px solid rgba(45, 226, 195, 0.35); background: rgba(45, 226, 195, 0.1); color: var(--teal); font-family: var(--mono); font-size: 34px; }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1920" data-height="1080" data-fps="30">
      <div id="bg">
        <div id="grid"></div>
        <div id="aurora" data-layout-allow-overflow><div id="blob-indigo" class="blob"></div><div id="blob-teal" class="blob"></div><div id="blob-saffron" class="blob"></div></div>
        <div id="vignette"></div>
        <div id="testnet"><span class="dot"></span><span>Stellar testnet · test money</span></div>
        <div id="part"><span id="p1" class="on">Problem</span><span id="p2">Live demo</span><span id="p3">How</span><span id="p4">Next</span></div>
      </div>

      <!-- 1. problem -->
      <section id="s1" class="clip" data-start="0" data-duration="{VIDEO_AT}" data-track-index="1">
        <div class="wrap">
          <div id="s1-eyebrow" class="eyebrow">One importer. One pain.</div>
          <h2 id="s1-h" class="display">Amina's bank <span class="saffron">says no.</span></h2>
        </div>
        <div id="s1-chip" class="chip" style="left: 160px; top: 400px;"><span class="dot"></span>Phone accessories · Shenzhen to Lagos · $18,100</div>
        <div id="s1-cards" class="cards" style="top: 490px;">
          <div class="card card-bg" id="c1"><div class="idx">01 · Too small</div><h3>Checking a small order costs as much as a big one</h3><p>So the bank does not bother.</p></div>
          <div class="card card-bg" id="c2"><div class="idx">02 · Easy to forge</div><h3>Invoices and shipping papers are hard to trust</h3><p>Forged documents cost about $5 billion a year.</p></div>
          <div class="card card-bg" id="c3"><div class="idx">03 · No interest</div><h3>She will not take a loan with interest</h3><p>Like many Muslim business owners.</p></div>
        </div>
        <div id="s1-stat" class="stat">
          <div class="box card-bg"><div class="n saffron"><span id="n-rej">0</span>%</div><div class="l">of small importers in Africa are turned down</div><div class="src">AfDB, Trade Finance in Africa, 2025</div></div>
          <div class="box card-bg"><div class="n">$<span id="n-gap">0</span>bn</div><div class="l">a year of trade finance they need and do not get</div><div class="src">AfDB, 2025 report</div></div>
        </div>
        <h2 id="s1-close" class="display">The goods wait.<br /><span class="saffron">The shelves stay empty.</span></h2>
      </section>

      <!-- 2. live demo: the screen recording -->
      <section id="s2" class="clip" data-start="{VIDEO_AT}" data-duration="{VIDEO_LEN}" data-track-index="1"><div id="frame"></div></section>
      <video id="rec" class="clip" src="assets/video/demo.mp4" data-start="{VIDEO_AT}" data-duration="{VIDEO_LEN}" data-track-index="2" muted playsinline></video>
      <section id="s2b" class="clip" data-start="{VIDEO_AT}" data-duration="{VIDEO_LEN}" data-track-index="3"><div id="live"><span class="dot"></span>LIVE ON TESTNET · SCREEN RECORDING · 1.2×</div></section>

      <!-- 3. how -->
      <section id="s3" class="clip" data-start="{HOW_AT}" data-duration="{150.0 - HOW_AT:.2f}" data-track-index="1">
        <div class="wrap">
          <div class="eyebrow" id="s3-eyebrow">How it works · why Stellar</div>
          <h2 id="s3-h" class="display">Buy the goods. Own them.<br />Sell at a <span class="saffron">fixed price.</span></h2>
        </div>
        <div class="cards four" id="s3-cards" style="top: 440px;">
          <div class="card card-bg" id="h1"><div class="idx">The contract</div><h3>A Soroban contract buys, owns, then sells</h3><p>Murabaha: the price is fixed on day one.</p></div>
          <div class="card card-bg" id="h2"><div class="idx">The profit</div><h3>Investors share the markup</h3><p>Nothing grows with time. No interest.</p></div>
          <div class="card card-bg" id="h3"><div class="idx">The checks</div><h3>AI reads the documents, a person approves</h3><p>Company register, sanctions lists, live ship tracking.</p></div>
          <div class="card card-bg" id="h4"><div class="idx">On Stellar</div><h3>Passkey smart accounts, locked share tokens, USDC</h3><p>Other lenders' agents buy our checks over x402.</p></div>
        </div>
      </section>

      <!-- 4. next -->
      <section id="s4" class="clip" data-start="150" data-duration="30" data-track-index="1">
        <div class="wrap">
          <div class="eyebrow" id="s4-eyebrow">What is next · the path to mainnet</div>
          <h2 id="s4-h" class="display">From testnet to <span class="saffron">real shipments.</span></h2>
        </div>
        <div class="cards" id="s4-cards" style="top: 420px;">
          <div class="card card-bg" id="n1"><div class="idx">Step 1</div><h3>Sharia board review</h3><p>Of the contract and the terms.</p></div>
          <div class="card card-bg" id="n2"><div class="idx">Step 2</div><h3>First corridor: China to Nigeria</h3><p>A licensed partner and real USDC.</p></div>
          <div class="card card-bg" id="n3"><div class="idx">Step 3</div><h3>Mainnet micro deal</h3><p>Right after this hackathon, with our own money.</p></div>
        </div>
        <div id="s4-charity" class="chip gold" style="left: 160px; top: 790px;"><span class="dot"></span>Late fees go to charity, never to investors. Public ledger at qafila.dev/charity</div>
        <div id="s4-final" data-hold>
          <div id="s4-mark">Qafila</div>
          <div id="s4-tag">Fund real shipments. Earn a fixed profit from trade, not interest.</div>
          <div id="s4-url"><span>qafila.dev</span></div>
        </div>
      </section>

      <!-- subtitles -->
{caps}

      <!-- narration and music -->
{audio}
      <audio id="music" data-start="0" data-duration="{TOTAL}" data-track-index="21" data-volume="0.11" src="assets/music/bed.mp3"></audio>
    </div>

    <script>
      const tl = gsap.timeline({{ paused: true }});
      const EASE = 'power3.out';
      const A = {json.dumps(A)};
      const TOTAL = {TOTAL}, VIDEO_AT = {VIDEO_AT}, HOW_AT = {HOW_AT};
      const enter = (sel, at, o = {{}}) => tl.fromTo(sel, {{ opacity: 0, y: o.y ?? 40, scale: o.scale ?? 1 }}, {{ opacity: 1, y: 0, scale: 1, duration: o.d ?? 0.6, ease: EASE }}, at);
      const leave = (sel, at, d = 0.45) => tl.to(sel, {{ opacity: 0, duration: d, ease: 'power2.in' }}, at);
      const counter = (id, to, at, d) => {{ const el = document.getElementById(id); const o = {{ v: 0 }}; tl.to(o, {{ v: to, duration: d, ease: 'power2.out', onUpdate() {{ el.textContent = String(Math.round(o.v)); }} }}, at); }};
      const partOn = (n, at) => {{ ['p1', 'p2', 'p3', 'p4'].forEach((id, i) => tl.set('#' + id, {{ className: i + 1 === n ? 'on' : '' }}, at)); }};

      tl.fromTo('#aurora', {{ y: 140, opacity: 0.3 }}, {{ y: 0, opacity: 0.5, duration: 4, ease: 'power2.out' }}, 0);
      tl.fromTo('#blob-indigo', {{ x: -80 }}, {{ x: 120, duration: TOTAL, ease: 'sine.inOut' }}, 0);
      tl.fromTo('#blob-saffron', {{ x: 80 }}, {{ x: -140, duration: TOTAL, ease: 'sine.inOut' }}, 0);
      tl.fromTo('#blob-teal', {{ y: 60 }}, {{ y: -90, duration: TOTAL, ease: 'sine.inOut' }}, 0);

      // 1. problem
      enter('#s1-eyebrow', 0.2, {{ y: 16 }});
      enter('#s1-chip', A.problem1 + 0.2, {{ y: 24 }});
      enter('#s1-h', A.problem2 - 0.1, {{ y: 50 }});
      enter('#c1', A.problem2 + 1.4, {{ y: 50 }});
      enter('#c2', A.problem2 + 4.2, {{ y: 50 }});
      enter('#c3', A.problem3 + 0.1, {{ y: 50 }});
      leave('#s1-cards', A.problem4 - 0.3); leave('#s1-chip', A.problem4 - 0.3);
      enter('#s1-stat', A.problem4 + 0.1, {{ y: 40 }}); counter('n-rej', 37, A.problem4 + 0.3, 1.4); counter('n-gap', 92, A.problem4 + 2.6, 1.6);
      leave('#s1-stat', A.problem5 - 0.3); leave('#s1-h', A.problem5 - 0.3);
      tl.set('#s1-h', {{ opacity: 0 }}, A.problem5 - 0.3);
      enter('#s1-close', A.problem5 + 0.1, {{ y: 60 }});
      leave('#s1', VIDEO_AT - 0.5);

      // 2. the recording
      partOn(2, VIDEO_AT);
      tl.fromTo('#frame', {{ opacity: 0, y: 30, scale: 0.985 }}, {{ opacity: 1, y: 0, scale: 1, duration: 0.7, ease: EASE }}, VIDEO_AT);
      tl.fromTo('#live', {{ opacity: 0 }}, {{ opacity: 1, duration: 0.5 }}, VIDEO_AT + 0.6);
      tl.to('#live', {{ opacity: 0, duration: 0.4 }}, HOW_AT - 0.5);
      tl.to('#testnet', {{ opacity: 0, duration: 0.4 }}, VIDEO_AT);
      tl.to('#testnet', {{ opacity: 1, duration: 0.4 }}, HOW_AT);

      // 3. how
      partOn(3, HOW_AT);
      enter('#s3-eyebrow', HOW_AT + 0.2, {{ y: 16 }});
      enter('#s3-h', A.how1 + 0.2, {{ y: 50 }});
      enter('#h1', A.how1 + 3.2, {{ y: 50 }});
      enter('#h2', A.how2 + 0.1, {{ y: 50 }});
      enter('#h3', A.how3 + 0.1, {{ y: 50 }});
      enter('#h4', A.how4 + 0.1, {{ y: 50 }});
      leave('#s3', 150 - 0.5);

      // 4. next
      partOn(4, 150);
      enter('#s4-eyebrow', 150.2, {{ y: 16 }});
      enter('#s4-h', A.next1 + 0.1, {{ y: 50 }});
      enter('#n1', A.next1 + 1.6, {{ y: 50 }});
      enter('#n2', A.next2 + 0.1, {{ y: 50 }});
      enter('#n3', A.next3 + 0.1, {{ y: 50 }});
      enter('#s4-charity', A.next4 + 0.1, {{ y: 24 }});
      leave('#s4-cards', A.next5 - 0.4); leave('#s4-charity', A.next5 - 0.4); leave('#s4-h', A.next5 - 0.4); leave('#s4-eyebrow', A.next5 - 0.4);
      tl.fromTo('#s4-mark', {{ opacity: 0, scale: 1.06, y: 20 }}, {{ opacity: 1, scale: 1, y: 0, duration: 0.7, ease: EASE }}, A.next5 + 0.1);
      enter('#s4-tag', A.next5 + 1.0, {{ y: 24 }});
      enter('#s4-url', A.next5 + 2.4, {{ y: 20 }});

      // subtitles
{capfx}

      tl.set({{}}, {{}}, TOTAL);
      window.__timelines['main'] = tl;
    </script>
  </body>
</html>
'''
open(f'{C}/index.html', 'w').write(page)
print('anchors', A)
print('how at', HOW_AT, 'demo last ends', round(end_of[('demo', 13)], 2), 'next ends', round(end_of[('next', 5)], 2))
