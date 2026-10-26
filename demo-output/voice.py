"""Narration for the 3 minute demo video: one Polly clip per sentence so the subtitles stay in sync.
Sections follow the HackMeridian format: problem (0:30), live demo (1:30, the screen recording), how (0:30), next (0:30)."""
import json, subprocess, sys, os
OUT = 'demo-output/composition/assets/voice'
SECTIONS = [
  ('problem', [
    "Meet Amina. She sells phone accessories in Lagos and buys them from a factory in Shenzhen.",
    "Her bank says no. Her orders are too small to be worth checking, and trade documents are easy to forge.",
    "She also refuses to pay interest, like many Muslim business owners.",
    "Across Africa, more than a third of small importers are turned down: a gap of up to 92 billion dollars a year.",
    "So the goods wait, and the shelves stay empty.",
  ]),
  ('demo', [
    "This is Qafila, live on Stellar testnet. Here is how an investor funds Amina's shipment.",
    "No seed phrase and no crypto to buy: the wallet is a passkey, created with a fingerprint or a password manager.",
    "Behind it is a smart account on Stellar, and Qafila pays the fees.",
    "The investor picks a role, invest or import, and fills in a few details.",
    "They confirm they can lose money if an importer does not pay.",
    "Done. The wallet is approved on-chain and receives fifty test dollars, in under thirty seconds.",
    "Every step is a real transaction. Here it is on stellar expert: the contract approved the investor.",
    "The same contract runs every deal: investing, confirming the shipment, repayment and claims.",
    "Back in the app, the marketplace lists real shipments with their routes and a fixed profit.",
    "Amina's deal: phone accessories, Shenzhen to Lagos, the map, the fixed price, and her own deposit locked first.",
    "The investor puts in twenty-five test dollars and confirms with the passkey.",
    "The money goes to the contract, not to a company account.",
    "Their shares are a locked token on Stellar, one per dollar, and the investment shows on the deal's timeline.",
  ]),
  ('how', [
    "How it works. A Soroban contract buys the goods from the factory, owns them, and sells them to Amina at a price fixed on day one.",
    "Investors share that fixed profit, with no interest.",
    "Before money moves, AI checks her documents against the company register, sanctions lists and live ship tracking, and a person approves.",
    "Why Stellar: passkey smart accounts, one locked share token per deal, and USDC payments for other lenders' agents.",
  ]),
  ('next', [
    "What is next. A Sharia board review of the contract and the terms.",
    "A first corridor, China to Nigeria, with a licensed partner and real USDC.",
    "A mainnet micro deal right after this hackathon, with our own money.",
    "Late fees never go to investors. They go to charity, on a public ledger.",
    "Qafila. Fund real shipments. Earn a fixed profit from trade, not interest. qafila dot dev.",
  ]),
]
# target slots in seconds; the demo slot equals the re-timed recording
SLOT = {'problem': 30.0, 'demo': 89.6, 'how': 30.0, 'next': 30.0}
GAP = 0.35
segments = []
for sec, sentences in SECTIONS:
  for i, text in enumerate(sentences, 1):
    name = f'{sec}-{i}'
    path = f'{OUT}/{name}.mp3'
    if not os.path.exists(path):
      ssml = f'<speak><prosody rate="93%">{text}</prosody></speak>'
      r = subprocess.run(['aws', 'polly', 'synthesize-speech', '--engine', 'generative', '--voice-id', 'Matthew', '--output-format', 'mp3', '--text-type', 'ssml', '--text', ssml, path], capture_output=True, text=True)
      if r.returncode: print(name, r.stderr[:200]); sys.exit(1)
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]).decode().strip())
    segments.append({'section': sec, 'n': i, 'file': f'assets/voice/{name}.mp3', 'duration': round(dur, 2), 'text': text})
# place: each section starts at its anchor; sentences back to back; the demo section's sentences are spread to the video beats instead
json.dump(segments, open(f'{OUT}/segments.json', 'w'), indent=1)
for sec in SLOT:
  total = sum(s['duration'] + GAP for s in segments if s['section'] == sec)
  print(f'{sec}: {total:.1f} s of speech for a {SLOT[sec]} s slot')
