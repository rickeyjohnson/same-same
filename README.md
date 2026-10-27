# 🧠 SAME SAME

A real-time (Server-Sent Events) multiplayer word-association party game written in **HTML, CSS, and JavaScript**. No starter words and no third-party packages!

## Play locally

1. Install Node.js 20+.
2. In this folder, run `npm start`.
3. Open **http://localhost:3000**.
4. Click **Create a room** and send the invite link to other players. Everyone on the same local network can access your machine using `http://YOUR-LAN-IP:3000`, provided your firewall allows incoming port 3000.

## Publish to the public internet

A simple option is [Render](https://render.com/). Upload this folder to a **GitHub repository**, then in Render select **New > Web Service**, connect that repository, and use:

- Runtime: **Node**
- Build command: `npm install`
- Start command: `npm start`
- Instance: Free (if available)

Or use **New > Blueprint**, selecting the repository that contains `render.yaml`. Render will give you a public `.onrender.com` URL. **No environment variables, databases, or API keys required.** On free instances, server idle spin-down/restarts will erase in-memory rooms; players can create new rooms after a restart. For always-on rooms, choose a paid instance or replace the in-memory room store with durable storage.

> ⚠️ This app needs a long-running Node server for synced multiplayer sessions. **Uploading only the HTML/CSS/JS files to Netlify Drop will not work** because it won't host the server. Use Render, Railway, Fly.io, or another Node hosting provider.

## Rules

- **2–8 players** join the same room with a 6-character code.
- No starting words or prompts. All players secretly choose an arbitrary first word.
- When everyone has submitted (or the 20-second timer ends), the words are revealed together.
- Every subsequent attempt uses the previously revealed words to help everyone independently choose the **exact same word**.
- **Classic:** 5 cooperative rounds, unlimited attempts each. Earlier convergence gives more points.
- **Brain Battle:** 4–8 players, with at least 2 on each of two teams. Each team privately sees its own word history. Both race to sync internally; first to 3 round wins is champion. Simultaneous team matches tie-break by the last submission time.
- **Chaos:** Like Classic but each attempt after the first has a random **objectively enforceable** word restriction (for instance, "No E," "At least five letters," "Start with S"). Unlimited attempts.
- Words must consist of 1–20 letters, with optional internal hyphens. Repeat guesses are allowed. Upper/lowercase doesn't matter. Hidden guesses reveal simultaneously. A missed answer is not a match.
- Anyone who disconnects can reconnect using the session saved in their browser; the host may remove a disconnected player.

## Files

- `public/index.html` — the browser game
- `public/style.css` — responsive visual design
- `public/app.js` — client state, UI, room controls and live events
- `server.js` — Node HTTP and live game engine; no third-party dependencies
- `render.yaml` — ready-to-use Render deployment config
- `tests/game.test.js` — two-client automated gameplay tests

## Test

`npm test`

Room state is in server memory, not persistent. This makes quick hosting easy but rooms do not survive server restarts. The server supports up to 8 players per room and expires inactive rooms after 3 hours.
