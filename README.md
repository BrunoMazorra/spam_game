# Spam Game

Real-time multiplayer web game where players place points on the segment [0,1] under a time limit. Each point costs c. After the timer, all points are revealed and each interval belongs to the owner of its left endpoint. Payoff = total owned area − c × (#points). Highest payoff wins.

## Quick start

```bash
# From project root
npm install
npm run start
# Open http://localhost:3000 in your browser
```

Open in two or more browser windows/tabs to simulate multiple players.

## Rules and scoring
- Players choose any number of points in [0, 1] during the round (default 60s).
- Each point costs c (default 0.05).
- After reveal, sort all submitted points across all players.
- For each consecutive pair of points (x_i, x_{i+1}), the interval [x_i, x_{i+1}) is owned by the player who owns x_i.
- The last point also owns [x_last, 1]. The initial interval [0, firstPoint) is unowned.
- Payoff per player: area_owned − c × number_of_points.

## Creating/Joining a room
- Enter a name and click Create Room (optionally adjust cost c and duration).
- Share the room code with others; they can Join by code and name.
- The host clicks Start Round to begin the 60s timer.
- During the round, click on the board to add points; click near a point to remove it.
- Click Submit to lock your points (auto-locked at time expiry).

## Tech
- Server: Node.js, Express, Socket.IO
- Client: HTML/CSS/Canvas + Socket.IO client

## Notes
- This prototype stores game state in memory and is intended for small rooms.
- If you need persistence, auth, or larger scale, add a database and session auth.


