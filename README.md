# BreakMaze Game

A web-based multiplayer brick breaker game with dynamic maps and power-ups, inspired by classic arcade games.

## 🎮 Project Overview

- **Genre**: Arcade / Puzzle / Action
- **Platform**: Web browser (desktop and mobile)
- **Multiplayer**: 1-5 players per room
- **Core Mechanics**: Control a paddle to bounce a ball, break bricks, collect power-ups, and compete in various game modes.
- **Tech Stack**: HTML5 Canvas, JavaScript/TypeScript, Node.js, Socket.IO, MongoDB Atlas.

## ⚙️ Setup and Running

### Prerequisites

- Node.js (v14.0.0 or later)
- npm (usually comes with Node.js)

### Running the Server

1.  **Clone the repository (if applicable) or ensure you have the project files.**
2.  **Navigate to the project's root directory in your terminal.**
3.  **Install server dependencies:**
    ```bash
    npm install
    ```
4.  **Start the server:**
    ```bash
    npm start
    ```
    This will typically start the server on `http://localhost:4001` (or the port specified in `server/server.js`).

### Playing the Game

1.  Once the server is running, open your web browser.
2.  Navigate to `http://localhost:4001` (or the appropriate address if the server is hosted elsewhere or on a different port).

### Database Setup (MongoDB Atlas)

This project is configured to use MongoDB Atlas. The connection string is currently included in `server/server.js`.
**Important**: For production environments, it is strongly recommended to store the MongoDB connection string in an environment variable rather than hardcoding it.

## 🧱 Game Features (Planned)

- Real-time multiplayer with WebSocket communication.
- Room-based matchmaking.
- Dynamic map system with various brick layouts.
- Exciting power-ups (Double Ball, Paddle Grow, Fast Ball, etc.).
- Multiple game modes (Score Rush, Survival, Co-op).
- Neon-themed visual style with satisfying particle effects and sounds.
- Responsive design for playability on different devices.
- PWA support for mobile browsers.

## 🛠️ Development

- **Client-side code**: `index.html`, `style.css`, `client/script.js`
- **Server-side code**: `server/server.js`
- To run the server in development mode with automatic restarts on file changes (requires `nodemon`):
  ```bash
  npm run dev
  ```

This `README.md` provides a basic overview. More details on architecture, WebSocket flow, and specific features will be added as development progresses. 