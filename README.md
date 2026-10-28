# SAME SAME

play: [https://same-same-party-game.onrender.com](https://same-same-party-game.onrender.com)

A real-time multiplayer party game where everyone tries to say the same word. Plain **HTML, CSS and JavaScript** with a small Node server that pushes live updates with Server-Sent Events. No frameworks and no third-party packages.

## Play locally

1. Install Node.js 20 or newer.
2. In this folder, run `npm start`.
3. Open **http://localhost:3000**.
4. Pick an emoji and a color, enter your name and click **Create room**. Tap the room code in the lobby to copy the invite link and send it to friends. People on the same Wi-Fi can join at `http://YOUR-LAN-IP:3000`, as long as your firewall allows port 3000.

To try multiplayer on one computer, open the game in a normal window and a few private windows. Each one counts as a different player.

## Publish to the internet

A simple option is [Render](https://render.com/). Push this folder to a **GitHub repository**, then in Render choose **New > Web Service**, connect the repository and use:

- Runtime: **Node**
- Build command: `npm install`
- Start command: `npm start`
- Instance: Free (if available)

Or choose **New > Blueprint** and pick the repository; it uses `render.yaml`. Render gives you a public `.onrender.com` URL. **No environment variables, databases or API keys are needed.** Free instances sleep when idle and lose rooms on restart; players just create a new room.

> This game needs a long-running Node server for live multiplayer. Uploading only the HTML, CSS and JS files to a static host (like Netlify Drop) will not work. Use Render, Railway, Fly.io or another Node host.

## Loading page while the server wakes up

Free Render servers go to sleep after 15 minutes without players, and the first visit after that shows Render's own loading page for about a minute. `docs/index.html` is a SAME SAME loading page that replaces it. It's hosted on GitHub Pages, which never sleeps. It wakes the server, shows the players bouncing while it waits, then sends everyone into the game. Room invite links pass straight through.

To turn it on, go to the GitHub repo's **Settings > Pages**, set **Source** to **Deploy from a branch**, pick **main** and **/docs**, then save. A minute later it's live at `https://<your-github-username>.github.io/same-same/`. Share that link instead of the Render one. If the game moves to a different Render address, update `GAME` near the bottom of `docs/index.html`.

## How to play

- **2 to 8 players** join a room with a 6-character code. No talking.
- Everyone secretly types one word at the same time. The first try has no prompt at all.
- Words reveal one by one in the middle of the table. The most common word goes first, so it feels like a win until someone breaks the streak.
- If everyone said the same word, the room scores `max(11 - tries, 1)` points. If not, the revealed words become clues and everyone tries again to meet in the middle with a new word.
- The host taps **Next round** or **Try again** to keep going, or **End game** to finish. If the host goes offline, anyone can tap Next.

### Host settings (in the lobby)

- **Rounds:** Endless (default), 3, 5 or 10. Endless games run until the host taps End game.
- **Timer:** Off, 30 sec, 45 sec or 1 min (default). Everyone gets a "30 seconds left!" warning (10 seconds with the 30 sec timer). When time runs out the words reveal, and anyone who didn't lock in counts as "no word".
- **Mode:**
  - **Classic:** everyone tries to sync.
  - **Chaos:** after the first try, every try has a letter rule like "No E" or "Starts with S". Matches after try 1 earn 2 extra points.
  - **Battle:** two teams (red and blue, at least 2 each). Tap a side of the lobby to pick your team. Each team only sees its own words. The first team to win 3 rounds wins.

### Other rules

- Words are 1 to 20 letters, hyphens allowed. Capital letters don't matter.
- A word that was already revealed this round can't be said again. In Battle this only counts your own team's words. Every new round starts fresh.
- Players can tap the lobby board to move their bubble around, and everyone sees it.
- If you close the tab, reopening the invite link puts you back in the room. The host can remove players who are offline by tapping their dimmed seat.

## Files

- `server.js`: Node HTTP server and game engine, no dependencies
- `public/index.html`: page markup for every screen
- `public/style.css`: all styles (Ink night colors, Luckiest Guy and Rubik fonts)
- `public/app.js`: boot, saved sessions, live connection and screen switching
- `public/ui/home.js`: home screen, mini demo, emoji and color picker, create and join
- `public/ui/lobby.js`: floating lobby, tap to move, host settings, modes, teams
- `public/ui/play.js`: the table, timer, lock in, reveal order, results, Next and End game
- `public/ui/end.js`: end screen
- `public/ui/sheets.js`: How to play sheet
- `public/ui/net.js`: API calls, Server-Sent Events and server clock sync
- `public/ui/sfx.js`, `public/ui/fx.js`: sounds and confetti
- `public/ui/util.js`: shared helpers, emoji and color lists
- `docs/index.html`: loading page for GitHub Pages that wakes the server
- `render.yaml`: Render deployment config
- `tests/game.test.js`: multiplayer tests against a real server

## Test

`npm test`

The tests start a real server with `TIME_SCALE=0.01`, so a 1-minute timer lasts 0.6 seconds. Rooms live in server memory: they don't survive a restart, and rooms with no activity for 3 hours are removed.
