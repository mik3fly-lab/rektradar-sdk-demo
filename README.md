# RektRadar SDK demo

A tiny browser dashboard built entirely on the official
[`@mik3fly-lab/rektradar-sdk`](https://www.npmjs.com/package/@mik3fly-lab/rektradar-sdk),
running client-side on the **free tier** - no API key, no signup.

It exercises every surface of the SDK from a single page:

| Panel | SDK call | Tier behaviour |
|-------|----------|----------------|
| **Check a token** | `rr.token(address)` | real-time for everyone |
| **Recent rugs** | `rr.rugs({ since: "7d" })` | ~10 min delayed on free, real-time on a paid key |
| **Live feed** | `connectStream({ events: [...] })` | WebSocket push, ~10 min delayed on free |

No key is passed, so the client runs as **anonymous-free**. Drop an `apiKey` into
`new RektRadar({ apiKey })` / `connectStream({ apiKey })` to go real-time.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

```bash
npm run build    # type-check + bundle to dist/
npm run preview
```

## The whole integration

```ts
import { RektRadar, connectStream } from "@mik3fly-lab/rektradar-sdk";

const rr = new RektRadar(); // free / anonymous; uses the browser's fetch + WebSocket

// REST: a real-time risk verdict
const v = await rr.token("0x...");
if (v.score >= 70) console.warn("high risk", v.flags);

// WebSocket: a live feed of deploys and rugs
connectStream({
  events: ["new_token", "imminent_rug", "rug"],
  onMessage: (e) => console.log(e.type, e.data),
});
```

## Links

- SDK on npm: <https://www.npmjs.com/package/@mik3fly-lab/rektradar-sdk>
- API docs (OpenAPI + AsyncAPI): <https://rektradar.io/developers/>
- Get a key (free tier, no card): <https://app.rektradar.io/account#api-keys>

Built by [RektRadar](https://rektradar.io) - Ethereum scam and rug-pull detection.
