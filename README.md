# Modern Chess V2

This project is a real-time chess game with Socket.IO and Express. It can also work as the backend for a separate tournament website.

## What is included

- Live chess match play in the browser
- Admin can create match fixtures
- Tournament-ready API endpoints for external websites
- Render-ready Node.js server

## Main server file

- [server.js](server.js)

## Frontend file

- [public/index.html](public/index.html)

## Tournament API

The backend now exposes these endpoints:

### Health

GET /api/health

### List matches

GET /api/matches

### List tournaments

GET /api/tournaments

### Create a match

POST /api/matches

Example body:

```json
{
  "p1": "Alice",
  "p2": "Bob"
}
```

### Create a tournament

POST /api/tournaments

Example body:

```json
{
  "name": "Weekend Cup",
  "organizer": "Ritik",
  "description": "Open tournament",
  "format": "single-elimination",
  "players": ["Alice", "Bob", "Charlie", "David"]
}
```

### Create tournament matches from players

POST /api/tournaments/:id/matches

---

## How to connect a second website

Use your second site to manage tournaments, and let it call this backend API.

Example JavaScript:

```js
const API_URL = 'https://your-chess-backend.onrender.com';

async function createTournament() {
  const res = await fetch(`${API_URL}/api/tournaments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Weekend Cup',
      organizer: 'Tournament Admin',
      description: 'Monthly tournament',
      format: 'single-elimination',
      players: ['Alice', 'Bob', 'Charlie', 'David', 'Eve', 'Frank']
    })
  });

  const data = await res.json();
  console.log(data);
}
```

Then, when the user clicks a created tournament, open the chess app using the match link or the server match ID.

---

## Deploy on Render

1. Push this repo to GitHub.
2. Open Render.
3. Create a new Web Service.
4. Connect your GitHub repo.
5. Use these values:
   - Build Command: `npm install`
   - Start Command: `node server.js`
6. Add environment variables if needed:
   - `ADMIN_USER=admin`
   - `ADMIN_PASS=admin123`
   - `PORT=3000`
7. Deploy.

Your chess app will be available at a Render URL such as:

```text
https://your-project-name.onrender.com
```

---

## Deploy the tournament site separately

For the second website, use GitHub Pages, Netlify, or Vercel.

Recommended setup:

- GitHub repo for the tournament management frontend
- Use a config file or environment variable for the backend URL
- Example:

```js
const API_URL = 'https://your-chess-backend.onrender.com';
```

This second site will create tournaments and call the chess app backend.

---

## Recommended architecture

- Site A: Chess game + live match server
- Site B: Tournament admin portal
- Link between them: REST API + Socket.IO

This is the cleanest setup for GitHub + Render deployment.

---

## Important note

This project is already set up as a Node.js web server, so Render is the correct hosting choice for the main chess backend. The tournament site should be separate if you want a cleaner admin UI.
