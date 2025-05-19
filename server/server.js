const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');

const port = process.env.PORT || 4001;

// MongoDB Connection
const MONGO_URI = "mongodb+srv://afanselcuk:J5J5FFLnfc73o3OY@breaker.cmhqe1s.mongodb.net/?retryWrites=true&w=majority&appName=Breaker"; 
// IMPORTANT: For production, use environment variables for sensitive data like this URI.

mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB connected successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));

const app = express();
const server = http.createServer(app);

// IMPORTANT: Replace "https://your-breakmaze-app.vercel.app" with your actual Vercel deployment URL.
// Also, ensure "http://localhost:3000" matches your local development server port if it's different.
const allowedOrigins = [
    "https://break-maze.vercel.app", // Your Vercel deployment URL
    "http://localhost:3000",               // For local development if you serve index.html on port 3000
    "http://127.0.0.1:3000",             // Also for local development
    // If your game is served from a different local port or you have other trusted origins, add them here.
];

const io = socketIo(server, {
    cors: {
        origin: function (origin, callback) {
            // Allow requests with no origin (like mobile apps or curl requests)
            if (!origin) return callback(null, true);
            if (allowedOrigins.indexOf(origin) === -1) {
                const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
                return callback(new Error(msg), false);
            }
            return callback(null, true);
        },
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'] // Prioritize WebSocket
});

// Serve static files from the parent directory's 'client' folder and root for index.html, style.css
app.use(express.static(__dirname + '/..')); // Serve files like index.html, style.css from root
app.use('/client', express.static(__dirname + '/../client')); // Serve script.js from client folder

// In-memory store for rooms and players. 
// For a more persistent solution, this could be backed by Redis or MongoDB.
const rooms = {}; // { roomId: { players: [{id: socket.id, name: playerName, isReady: boolean}], status: 'waiting'/'playing', mapName: 'LEVEL_X', playerGameStates: { playerId: { ...gameState... } } } }
const GAME_TICK_RATE = 1000 / 60; // Roughly 60 FPS

// Server-side Map Definitions (mirroring client, but server is authoritative)
const ServerMaps = {
    LEVEL_1: [
        [0,0,1,1,1,1,1,1,1,0,0],
        [0,1,1,1,1,1,1,1,1,1,0],
        [1,1,1,1,1,1,1,1,1,1,1],
        [0,1,1,1,2,1,2,1,1,1,0],
        [0,0,1,1,2,2,2,1,1,0,0],
        [0,0,0,1,1,1,1,1,0,0,0],
        [0,0,0,0,9,0,9,0,0,0,0]
    ],
    LEVEL_2: [
        [1,1,0,0,1,0,0,0,1,1,1],
        [1,2,1,0,1,2,1,0,1,2,1],
        [0,1,9,1,0,1,0,1,9,1,0],
        [1,2,1,0,1,2,1,0,1,2,1],
        [1,1,0,0,1,0,0,0,1,1,1],
        [0,0,1,1,1,1,1,1,1,0,0],
        [0,0,0,2,2,2,2,2,0,0,0]
    ],
    LEVEL_3: [
        [9,1,1,1,1,1,1,1,1,1,9],
        [1,2,1,2,1,2,1,2,1,2,1],
        [1,1,9,1,1,9,1,1,9,1,1],
        [0,1,2,1,2,1,2,1,2,1,0],
        [0,0,1,9,1,9,1,9,1,0,0],
        [0,0,0,1,2,1,2,1,0,0,0],
        [0,0,0,0,1,1,1,0,0,0,0]
    ]
    // Ensure these are identical to client-side for now, or client gets them from server
};

// Placeholder for brick colors, server might not need them directly unless sending visual info
const SERVER_BRICK_COLORS = {
    STANDARD: '#0f0', STRONG_1: '#ff0', STRONG_2: '#f80', UNBREAKABLE: '#888' 
};

// Power-Up Types Enum (Server-side)
const PowerUpType = {
    PADDLE_GROW: 'paddle_grow',
    PADDLE_SHRINK: 'paddle_shrink',
    DOUBLE_BALL: 'double_ball',
    TRIPLE_BALL: 'triple_ball',
    SLOW_BALL: 'slow_ball',
    FAST_BALL: 'fast_ball',
    SHIELD: 'shield'
    // INVERTED_CONTROLS, BRICK_SWAP can be added later
};

const POWER_UP_DROP_CHANCE = 0.2; // 20% chance from a breakable brick
const POWER_UP_SPEED = 2; // Server units per tick
const POWER_UP_RADIUS_SERVER = 10; // Server units for collision

function setupBricksForMap(mapName, gameWidth, gameHeight) {
    const mapLayout = ServerMaps[mapName];
    if (!mapLayout) {
        console.error(`Map ${mapName} not found on server.`);
        return [];
    }

    const bricks = [];
    const mapRows = mapLayout.length;
    const mapCols = mapLayout[0] ? mapLayout[0].length : 0;

    // These calculations should ideally match client's calculateGameParameters for brick grid
    const brickOffsetTop = gameHeight * 0.08;
    const brickOffsetLeft = gameWidth * 0.05;
    const brickAreaWidth = gameWidth - 2 * brickOffsetLeft;
    const estimatedTotalBrickHeight = mapRows * (gameHeight * 0.04);
    const brickAreaHeight = Math.min(gameHeight * 0.5, estimatedTotalBrickHeight);
    const brickPadding = Math.max(2, Math.floor(brickAreaWidth * 0.01 / mapCols));
    const brickWidth = Math.max(10, Math.floor((brickAreaWidth - (mapCols + 1) * brickPadding) / mapCols));
    const brickHeight = Math.max(10, Math.floor((brickAreaHeight - (mapRows + 1) * brickPadding) / mapRows));

    for (let r = 0; r < mapRows; r++) {
        for (let c = 0; c < mapCols; c++) {
            const brickType = mapLayout[r][c];
            if (brickType > 0) {
                let health = 1;
                let colorKey = 'STANDARD'; // For server-side reference if needed
                if (brickType === 2) { health = 2; colorKey = 'STRONG_2'; }
                else if (brickType === 9) { health = Infinity; colorKey = 'UNBREAKABLE'; }
                
                bricks.push({
                    x: brickOffsetLeft + c * (brickWidth + brickPadding) + brickPadding,
                    y: brickOffsetTop + r * (brickHeight + brickPadding) + brickPadding,
                    width: brickWidth,
                    height: brickHeight,
                    status: 1, // 1 for active, 0 for broken
                    type: brickType,
                    health: health,
                    initialHealth: health,
                    // colorKey: colorKey // Server might not need to store color string itself
                    id: `brick_${r}_${c}` // Unique ID for each brick
                });
            }
        }
    }
    return bricks;
}

// Helper function to initialize game state for a room when game starts
// NOW: Initializes game state for a SINGLE PLAYER within a room.
function initializeServerPlayerGameState(roomId, playerId, playerName, mapName) {
    const room = rooms[roomId];
    if (!room) {
        console.error(`Room ${roomId} not found when trying to initialize game state for player ${playerId}.`);
        return null;
    }

    const gameWidth = 800; 
    const gameHeight = 600;
    const initialPaddleWidth = gameWidth * 0.15;
    const paddleHeight = gameHeight * 0.03;
    const paddleYOffset = gameHeight * 0.05;

    // Each player gets their own instance of bricks, score, lives, etc.
    const playerGameState = {
        gameWidth: gameWidth,
        gameHeight: gameHeight,
        balls: [{
            x: gameWidth / 2,
            y: gameHeight - paddleHeight - paddleYOffset - (gameWidth * 0.008) - 25,
            radius: gameWidth * 0.008,
            speedX: (gameWidth * 0.003) * (Math.random() > 0.5 ? 1 : -1),
            speedY: -(gameWidth * 0.003),
            color: '#f0f', // Ball color can be player-specific if desired later
            lastHitByPlayerId: playerId // Ball is initially associated with this player
        }],
        paddle: { // Renamed from 'paddles' object to a single 'paddle' object
            x: gameWidth / 2 - initialPaddleWidth / 2,
            width: initialPaddleWidth,
            initialWidth: initialPaddleWidth, // Store initial width for power-ups
            height: paddleHeight,
            y: gameHeight - paddleHeight - paddleYOffset,
            name: playerName // Store player name directly with their paddle
        },
        bricks: setupBricksForMap(mapName || 'LEVEL_1', gameWidth, gameHeight), // Each player gets a fresh set of bricks
        score: 0, // Score is now a number, not an object
        lives: 3, // Lives is now a number, not an object
        activePowerUps: [], // Stores currently falling power-ups for this player {x, y, type, id}
        activePowerUpEffects: { // Stores active effects and their durations
            shieldEndTime: 0,
            // other effects like fastBallEndTime, slowBallEndTime could be added
        },
        mapName: mapName || 'LEVEL_1',
        gameOver: false,
        playerId: playerId, // Keep track of whose state this is
        soundToPlay: null, // Add soundToPlay field
        levelCompleted: false // Flag to track if level/map is cleared by the player
    };
    
    console.log(`Initialized server game state for player ${playerName} (${playerId}) in room ${roomId} with map ${playerGameState.mapName}. Bricks: ${playerGameState.bricks.length}`);
    return playerGameState;
}

// Server-side function to spawn a power-up
function spawnServerPowerUp(playerGameState, brick) {
    if (Math.random() < POWER_UP_DROP_CHANCE) {
        const powerUpTypes = Object.values(PowerUpType);
        const type = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
        playerGameState.activePowerUps.push({
            x: brick.x + brick.width / 2,
            y: brick.y + brick.height / 2,
            type: type,
            id: `powerup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
        });
        console.log(`Spawned power-up ${type} for player ${playerGameState.paddle.name}`);
    }
}

// Server-side function to apply power-up effects
function applyServerPowerUpEffect(playerGameState, powerUpType) {
    const paddle = playerGameState.paddle;
    const balls = playerGameState.balls;
    const gameWidth = playerGameState.gameWidth;

    switch (powerUpType) {
        case PowerUpType.PADDLE_GROW:
            paddle.width = Math.min(paddle.width + (paddle.initialWidth * 0.5), gameWidth * 0.4);
            break;
        case PowerUpType.PADDLE_SHRINK:
            paddle.width = Math.max(paddle.width - (paddle.initialWidth * 0.3), paddle.initialWidth * 0.25);
            break;
        case PowerUpType.DOUBLE_BALL:
            if (balls.length > 0 && balls.length < 5) { // Max 5 balls
                const originalBall = balls[0];
                const speedMagnitude = Math.sqrt(originalBall.speedX**2 + originalBall.speedY**2) || (gameWidth * 0.003);
                balls.push({
                    ...originalBall,
                    x: originalBall.x + (Math.random() * 10 - 5), // slight offset
                    y: originalBall.y,
                    speedX: speedMagnitude * Math.cos(Math.PI / 6 + (Math.random() * 0.2 - 0.1)), // slight angle variation
                    speedY: -speedMagnitude * Math.sin(Math.PI / 6 + (Math.random() * 0.2 - 0.1)),
                    id: `ball_${Date.now()}_${balls.length}`
                });
            }
            break;
        case PowerUpType.TRIPLE_BALL:
            if (balls.length > 0 && balls.length < 5) { // Max 5 balls
                const originalBall = balls[0];
                const speedMagnitude = Math.sqrt(originalBall.speedX**2 + originalBall.speedY**2) || (gameWidth * 0.003);
                const angles = [Math.PI / 4, 3 * Math.PI / 4]; // Angles for two new balls
                for (let i = 0; i < 2 && balls.length < 5; i++) {
                    balls.push({
                        ...originalBall,
                        x: originalBall.x + (Math.random() * 10 - 5),
                        y: originalBall.y,
                        speedX: speedMagnitude * Math.cos(angles[i] + (Math.random() * 0.2 - 0.1)),
                        speedY: -speedMagnitude * Math.sin(angles[i] + (Math.random() * 0.2 - 0.1)),
                        id: `ball_${Date.now()}_${balls.length}`
                    });
                }
            }
            break;
        case PowerUpType.SLOW_BALL:
            balls.forEach(ball => {
                ball.speedX *= 0.7;
                ball.speedY *= 0.7;
                const minSpeed = (gameWidth * 0.003) * 0.3;
                if (Math.abs(ball.speedX) < minSpeed && ball.speedX !== 0) ball.speedX = Math.sign(ball.speedX) * minSpeed;
                if (Math.abs(ball.speedY) < minSpeed && ball.speedY !== 0) ball.speedY = Math.sign(ball.speedY) * minSpeed;
            });
            break;
        case PowerUpType.FAST_BALL:
            balls.forEach(ball => {
                ball.speedX *= 1.3;
                ball.speedY *= 1.3;
                const maxSpeed = (gameWidth * 0.003) * 2.5;
                if (Math.abs(ball.speedX) > maxSpeed) ball.speedX = Math.sign(ball.speedX) * maxSpeed;
                if (Math.abs(ball.speedY) > maxSpeed) ball.speedY = Math.sign(ball.speedY) * maxSpeed;
            });
            break;
        case PowerUpType.SHIELD:
            playerGameState.activePowerUpEffects.shieldEndTime = Date.now() + 10000; // Shield for 10 seconds
            break;
    }
}

// Server-side game loop for a room
// NOW: This loop will iterate over each player's game state in the room.
function startGameLoop(roomId) {
    const room = rooms[roomId];
    if (!room || !room.playerGameStates) { // Check for playerGameStates
        console.error(`Player game states not found for room ${roomId} when trying to start loop.`);
        return;
    }
    if (room.status !== 'playing') {
        console.warn(`Attempted to start game loop for room ${roomId} but status is ${room.status}. Aborting loop start.`);
        return;
    }
    
    // The main game loop interval for the room
    const gameLoopInterval = setInterval(() => {
        if (room.players.length === 0) { // If all players leave, stop the room's loop
            clearInterval(gameLoopInterval);
            room.status = 'waiting'; 
            console.log(`Game loop stopped for room ${roomId} as all players left.`);
            // No gameOver emission here as it's per player now.
            // Room cleanup might happen if it's empty due to disconnects.
            return;
        }

        let activePlayersInLoop = 0;

        // Iterate over each player in the room and update their individual game state
        for (const player of room.players) {
            const playerId = player.id;
            const gs = room.playerGameStates[playerId]; // gs for player's GameState

            if (!gs || gs.gameOver || gs.levelCompleted) { // If player's game state doesn't exist, game is over, or level completed
                continue; // Skip this player
            }
            activePlayersInLoop++;

            // Reset soundToPlay for this tick
            gs.soundToPlay = null;

            // 1. Update ball positions for this player
            const ballsToRemove = []; // Store IDs of balls to remove

            gs.balls.forEach(ball => {
                ball.x += ball.speedX;
                ball.y += ball.speedY;

                const MIN_WALL_BOUNCE_AXIS_SPEED = 0.3; // Minimum speed for an axis after wall bounce
                const WALL_NUDGE_FACTOR = 0.2; // How much to nudge the other axis

                // Wall collisions
                if (ball.x + ball.radius > gs.gameWidth || ball.x - ball.radius < 0) {
                    ball.speedX = -ball.speedX;
                    // Nudge Y speed to prevent sticking to vertical movement
                    ball.speedY += (Math.random() - 0.5) * WALL_NUDGE_FACTOR;
                    if (Math.abs(ball.speedY) < MIN_WALL_BOUNCE_AXIS_SPEED) {
                        ball.speedY = Math.sign(ball.speedY || (Math.random() > 0.5 ? 1 : -1)) * MIN_WALL_BOUNCE_AXIS_SPEED;
                    }
                    // Ensure speedX itself is not too small
                    if (Math.abs(ball.speedX) < MIN_WALL_BOUNCE_AXIS_SPEED) {
                         ball.speedX = Math.sign(ball.speedX || (Math.random() > 0.5 ? 1 : -1)) * MIN_WALL_BOUNCE_AXIS_SPEED;
                    }
                }
                if (ball.y - ball.radius < 0) { // Top wall
                    ball.speedY = -ball.speedY;
                    // Nudge X speed to prevent sticking to horizontal movement
                    ball.speedX += (Math.random() - 0.5) * WALL_NUDGE_FACTOR;
                    if (Math.abs(ball.speedX) < MIN_WALL_BOUNCE_AXIS_SPEED) {
                        ball.speedX = Math.sign(ball.speedX || (Math.random() > 0.5 ? 1 : -1)) * MIN_WALL_BOUNCE_AXIS_SPEED;
                    }
                    // Ensure speedY itself is not too small
                    if (Math.abs(ball.speedY) < MIN_WALL_BOUNCE_AXIS_SPEED) {
                         ball.speedY = Math.sign(ball.speedY || (Math.random() > 0.5 ? 1 : -1)) * MIN_WALL_BOUNCE_AXIS_SPEED;
                    }
                }
                // Shield check before bottom wall collision for this player
                let shieldActiveForPlayer = gs.activePowerUpEffects.shieldEndTime > Date.now();
                if (ball.y + ball.radius > gs.gameHeight) { // Bottom wall for this player
                    if (shieldActiveForPlayer) {
                        ball.speedY = -ball.speedY;
                        ball.y = gs.gameHeight - ball.radius -1; // Place ball just above the shield line
                    } else {
                        // Mark the ball for removal instead of immediate splice
                        ballsToRemove.push(ball.id);
                    }
                }
            });

            // Remove marked balls after iterating through all of them
            if (ballsToRemove.length > 0) {
                gs.balls = gs.balls.filter(ball => !ballsToRemove.includes(ball.id));
            }

            // Check for life loss only after removing balls that went out
            if (ballsToRemove.length > 0 && gs.balls.length === 0) {
                 // This condition means balls went out AND now no balls are left.
                 // If ballsToRemove is empty, it means no ball went out in this tick, so no life loss check needed based on that.
                gs.lives--;
                if (gs.lives <= 0) {
                    gs.gameOver = true;
                    console.log(`Player ${gs.paddle.name} (${playerId}) in room ${roomId} is out of lives. Game Over for this player.`);
                    io.to(playerId).emit('gameOver', { score: gs.score, message: "You ran out of lives!" }); 
                } else {
                    // If not game over, reset with one new ball
                    gs.balls.push({
                        x: gs.gameWidth / 2,
                        y: gs.gameHeight / 2, 
                        radius: gs.gameWidth * 0.008,
                        speedX: (gs.gameWidth * 0.003) * (Math.random() > 0.5 ? 1 : -1),
                        speedY: -(gs.gameWidth * 0.003),
                        color: '#f0f', // Default ball color
                        lastHitByPlayerId: playerId, // Should be associated with the current player
                        id: `ball_${Date.now()}_0`
                    });
                }
            }

            // 2. Paddle-ball collisions for this player
            gs.balls.forEach(ball => {
                const paddle = gs.paddle; // Current player's paddle
                if (ball.x + ball.radius > paddle.x &&
                    ball.x - ball.radius < paddle.x + paddle.width &&
                    ball.y + ball.radius > paddle.y &&
                    ball.y - ball.radius < paddle.y + paddle.height) {
                    
                    let collidePoint = ball.x - (paddle.x + paddle.width / 2);
                    collidePoint = collidePoint / (paddle.width / 2); // Normalize to -1 to 1
                    let angle = collidePoint * (Math.PI / 3); // Max angle Math.PI / 3 (60 degrees)
                    const currentSpeed = Math.sqrt(ball.speedX**2 + ball.speedY**2) || (gs.gameWidth * 0.003);
                    
                    ball.speedX = currentSpeed * Math.sin(angle);
                    ball.speedY = -Math.abs(currentSpeed * Math.cos(angle)); 

                    // Anti-stuck: Ensure paddle hits don't result in zero or too small speedX
                    const MIN_PADDLE_ESCAPE_X_SPEED = 0.5;
                    if (Math.abs(ball.speedX) < MIN_PADDLE_ESCAPE_X_SPEED) {
                        if (collidePoint === 0) { // Center hit, force a slight random direction
                            ball.speedX = (Math.random() > 0.5 ? 1 : -1) * MIN_PADDLE_ESCAPE_X_SPEED;
                        } else {
                            ball.speedX = MIN_PADDLE_ESCAPE_X_SPEED * Math.sign(collidePoint);
                        }
                    }
                    // Ensure speedY is not zero (should be guaranteed by Math.cos for these angles but as a safeguard)
                    if (ball.speedY === 0) {
                        ball.speedY = -0.1 * currentSpeed; // Small upward component
                    }

                    gs.soundToPlay = { type: 'paddle_hit' }; // Signal paddle hit sound
                }
            });

            // 3. Brick-ball collisions for this player
            let allPlayerBricksBroken = true;
            gs.bricks.forEach((brick) => {
                if (brick.status === 1) { 
                    gs.balls.forEach(ball => {
                        if (ball.x + ball.radius > brick.x &&
                            ball.x - ball.radius < brick.x + brick.width &&
                            ball.y + ball.radius > brick.y &&
                            ball.y - ball.radius < brick.y + brick.height) {
                            
                            const MIN_BRICK_BOUNCE_AXIS_SPEED = 0.3;
                            const BRICK_NUDGE_FACTOR = 0.2;

                            if (brick.type === 9) { // Unbreakable
                                ball.speedY = -ball.speedY;
                                gs.soundToPlay = { type: 'paddle_hit' }; // Unbreakable bricks also make a sound
                                // Nudge X speed after bouncing off an unbreakable brick's top/bottom
                                ball.speedX += (Math.random() - 0.5) * BRICK_NUDGE_FACTOR;
                                if (Math.abs(ball.speedX) < MIN_BRICK_BOUNCE_AXIS_SPEED) {
                                    ball.speedX = Math.sign(ball.speedX || (Math.random() > 0.5 ? 1: -1)) * MIN_BRICK_BOUNCE_AXIS_SPEED;
                                }
                            } else {
                                brick.health--;
                                ball.speedY = -ball.speedY; 
                                // Nudge X speed after bouncing off a breakable brick's top/bottom
                                ball.speedX += (Math.random() - 0.5) * BRICK_NUDGE_FACTOR;
                                if (Math.abs(ball.speedX) < MIN_BRICK_BOUNCE_AXIS_SPEED) {
                                    ball.speedX = Math.sign(ball.speedX || (Math.random() > 0.5 ? 1: -1)) * MIN_BRICK_BOUNCE_AXIS_SPEED;
                                }

                                if (brick.health <= 0) {
                                    brick.status = 0; 
                                    gs.score += brick.initialHealth * 10; // Update this player's score
                                    spawnServerPowerUp(gs, brick); // Spawn power-up
                                    gs.soundToPlay = { type: 'brick_break' }; // Signal brick break sound
                                } else {
                                    gs.soundToPlay = { type: 'paddle_hit' }; // Brick hit but not broken (multi-hit brick)
                                }
                            }
                            // Ensure speedY itself is not too small after any brick collision that reverses it
                            if (Math.abs(ball.speedY) < MIN_BRICK_BOUNCE_AXIS_SPEED) {
                                ball.speedY = Math.sign(ball.speedY || (Math.random() > 0.5 ? 1: -1)) * MIN_BRICK_BOUNCE_AXIS_SPEED;
                            }
                        }
                    });
                    if (brick.type !== 9 && brick.status === 1) { 
                        allPlayerBricksBroken = false;
                    }
                }
            });

            if (allPlayerBricksBroken && gs.bricks.some(b => b.type !== 9)) { // Check if there were breakable bricks
                console.log(`Player ${gs.paddle.name} (${playerId}) in room ${roomId} cleared all their bricks!`);
                gs.levelCompleted = true; // Set level completed flag
                // Handle level completion for this player (e.g., load next map for them, or set a "completed" flag)
                // For now, we can consider this a win condition for this player for the current map.
                // gs.gameOver = true; // Or a different state like 'levelComplete'
                io.to(playerId).emit('levelClear', { score: gs.score, message: "Level Cleared!"});
                // Potentially load next map for this player if more maps exist
            }

            // 4. Update falling power-ups and check for collection
            for (let i = gs.activePowerUps.length - 1; i >= 0; i--) {
                const pUp = gs.activePowerUps[i];
                pUp.y += POWER_UP_SPEED;

                // Collision with paddle
                const paddle = gs.paddle;
                if (pUp.x + POWER_UP_RADIUS_SERVER > paddle.x &&
                    pUp.x - POWER_UP_RADIUS_SERVER < paddle.x + paddle.width &&
                    pUp.y + POWER_UP_RADIUS_SERVER > paddle.y &&
                    pUp.y - POWER_UP_RADIUS_SERVER < paddle.y + paddle.height) {
                    applyServerPowerUpEffect(gs, pUp.type);
                    gs.activePowerUps.splice(i, 1); // Remove collected power-up
                    gs.soundToPlay = { type: 'powerup_collect' }; // Signal powerup collection sound
                    console.log(`Player ${gs.paddle.name} collected ${pUp.type}`);
                } else if (pUp.y - POWER_UP_RADIUS_SERVER > gs.gameHeight) {
                    gs.activePowerUps.splice(i, 1); // Remove if off-screen
                }
            }

            // Broadcast THIS PLAYER'S game state to THIS PLAYER
            io.to(playerId).emit('gameStateUpdate', {
                balls: gs.balls,
                paddle: gs.paddle, // Send this player's paddle
                bricks: gs.bricks.map(b => ({id: b.id, status: b.status, health: b.health, type: b.type, x:b.x, y:b.y, width:b.width, height:b.height})),
                score: gs.score,
                lives: gs.lives,
                activePowerUps: gs.activePowerUps.map(p => ({x: p.x, y: p.y, type: p.type, id: p.id})), // Send active power-ups
                shieldActive: gs.activePowerUpEffects.shieldEndTime > Date.now(), // Send shield status
                soundToPlay: gs.soundToPlay, // Send sound event
                gameOver: gs.gameOver
            });
        } // End of loop for (const player of room.players)

        // After updating all individual game states, prepare and send opponent states
        room.players.forEach(playerToSendTo => {
            // Send opponent states to all players, including ones who are spectating (gameOver)
            // Remove the condition that was skipping players with gameOver
            
            const opponentStates = {};
            room.players.forEach(opponent => {
                if (opponent.id !== playerToSendTo.id && room.playerGameStates[opponent.id]) {
                    const opponentGs = room.playerGameStates[opponent.id];
                    opponentStates[opponent.id] = {
                        paddle: { x: opponentGs.paddle.x, width: opponentGs.paddle.width, y: opponentGs.paddle.y, height: opponentGs.paddle.height }, // Send full paddle data
                        balls: opponentGs.balls.map(b => ({ x: b.x, y: b.y, radius: b.radius, color: b.color })),
                        bricks: opponentGs.bricks.map(br => ({id: br.id, status: br.status, health: br.health, type: br.type, x:br.x, y:br.y, width:br.width, height:br.height})),
                        score: opponentGs.score,
                        lives: opponentGs.lives,
                        activePowerUps: opponentGs.activePowerUps.map(p => ({x: p.x, y: p.y, type: p.type, id: p.id})),
                        shieldActive: opponentGs.activePowerUpEffects.shieldEndTime > Date.now(),
                        name: opponentGs.paddle.name,
                        gameOver: opponentGs.gameOver,
                        gameWidth: opponentGs.gameWidth, // Send game dimensions for scaling
                        gameHeight: opponentGs.gameHeight
                    };
                }
            });
            io.to(playerToSendTo.id).emit('opponentStatesUpdate', opponentStates);
        });


        if (activePlayersInLoop === 0 && room.players.length > 0) {
            console.log(`All active players in room ${roomId} have finished their games. Stopping room loop.`);
            clearInterval(gameLoopInterval);
            room.status = 'gameFinished'; // Changed from 'waiting' to 'gameFinished'
            
            // Build the final scores object to send to all players
            const finalScores = {};
            room.players.forEach(player => {
                const playerState = room.playerGameStates[player.id];
                if (playerState) {
                    finalScores[player.id] = {
                        name: playerState.paddle.name,
                        score: playerState.score,
                        lives: playerState.lives
                    };
                }
            });
            
            // Send the final scoreboard to all players in the room
            io.to(roomId).emit('allPlayersFinished', { scores: finalScores });
            console.log(`Final scores sent to all players in room ${roomId}:`, finalScores);
        }

    }, GAME_TICK_RATE);

    room.gameLoopInterval = gameLoopInterval; // Store the interval ID on the room object
}

function generateRoomId() {
    return Math.random().toString(36).substring(2, 7).toUpperCase(); // Simple 5-char ID
}

io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('createRoom', ({ playerName, mapName }) => {
        const roomId = generateRoomId();
        rooms[roomId] = {
            players: [{ id: socket.id, name: playerName, isReady: false }],
            status: 'waiting',
            mapName: mapName || 'LEVEL_1', // Default to LEVEL_1 if not specified
            playerGameStates: {} // Initialize playerGameStates object
        };
        socket.join(roomId);
        socket.emit('roomCreated', { roomId, playerId: socket.id, mapName: rooms[roomId].mapName });
        // Also immediately update the lobby for the creator
        io.to(roomId).emit('updatePlayerListInLobby', { roomId, players: rooms[roomId].players });
        console.log(`Room ${roomId} created by ${playerName} (${socket.id}). Selected map: ${rooms[roomId].mapName}. Players:`, rooms[roomId].players);
    });

    socket.on('joinRoom', ({ playerName, roomCode }) => {
        const room = rooms[roomCode];
        if (room) {
            if (room.status === 'playing') {
                socket.emit('roomError', { message: 'Game has already started in this room.' });
                return;
            }
            if (room.players.length >= 5) { // Max 5 players, as per project spec
                socket.emit('roomError', { message: 'Room is full.' });
                return;
            }
            const newPlayer = { id: socket.id, name: playerName, isReady: false };
            room.players.push(newPlayer);
            socket.join(roomCode);
            socket.emit('joinedRoom', { roomId: roomCode, playerId: socket.id, mapName: room.mapName, players: room.players });
            // Emit updatePlayerListInLobby to all players in the room
            io.to(roomCode).emit('updatePlayerListInLobby', { roomId: roomCode, players: room.players });
            console.log(`${playerName} (${socket.id}) joined room ${roomCode}. Players:`, room.players);
        } else {
            socket.emit('roomError', { message: 'Room not found.' });
        }
    });

    socket.on('playerReady', ({ roomId }) => {
        const room = rooms[roomId];
        if (room && room.players) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                player.isReady = !player.isReady;
                console.log(`Player ${player.name} in room ${roomId} ready status: ${player.isReady}`);
                io.to(roomId).emit('updatePlayerListInLobby', { roomId, players: room.players });

                // Check if all players are ready and game is not already playing
                const allReady = room.players.length > 0 && room.players.every(p => p.isReady);
                // Minimum 2 players to start, can be adjusted
                const enoughPlayers = room.players.length >= 1; // For testing, 1 player can start. Change to 2 for actual game.

                if (allReady && enoughPlayers && room.status === 'waiting') {
                    console.log(`All ${room.players.length} players in room ${roomId} are ready. Starting game for individual players.`);
                    room.status = 'playing';
                    room.playerGameStates = {}; // Reset or initialize playerGameStates for the room

                    let allPlayersInitialized = true;
                    for (const player of room.players) {
                        const initialPlayerGameState = initializeServerPlayerGameState(roomId, player.id, player.name, room.mapName);
                        if (initialPlayerGameState) {
                            room.playerGameStates[player.id] = initialPlayerGameState;
                            // Emit 'startGame' to each player with their own initial state
                            io.to(player.id).emit('startGame', {
                                roomId: roomId,
                                // players: room.players, // Client might not need the full list here now, or could get it via lobby updates
                                localPlayerId: player.id, // Clearly identify this client's ID
                                gameState: initialPlayerGameState // This is THEIR game state
                            });
                        } else {
                            console.error(`Failed to initialize game state for player ${player.name} (${player.id}) in room ${roomId}.`);
                            allPlayersInitialized = false;
                            // Handle error for this specific player, maybe remove them or send an error.
                        }
                    }

                    if (allPlayersInitialized && room.players.length > 0) {
                        startGameLoop(roomId); // Start the single game loop for the room
                    } else if (!allPlayersInitialized) {
                        console.error(`Not all players could be initialized in room ${roomId}. Aborting game start.`);
                        io.to(roomId).emit('roomError', { message: 'Error initializing game for all players. Please try again.' });
                        room.status = 'waiting';
                        room.players.forEach(p => p.isReady = false);
                        io.to(roomId).emit('updatePlayerListInLobby', { roomId, players: room.players });
                    } else {
                        // No players, or some other issue. Loop won't start. Status remains 'waiting'.
                         console.log(`No players or failed initialization in room ${roomId}, game not started.`);
                    }
                } else {
                    if (room.status === 'waiting') {
                         console.log(`Room ${roomId} waiting for players. All ready: ${allReady}, Enough players: ${enoughPlayers}. Current players: ${room.players.length}`);
                    }
                }
            }
        }
    });

    socket.on('paddleMove', ({ x }) => { // roomId is not needed from client here if we get it from socket.rooms
        let roomIdForPlayer = null;
        // socket.rooms is a Set, first element is usually the socket's own ID, second (if present) is the room.
        const socketRooms = Array.from(socket.rooms);
        if (socketRooms.length > 1) {
            roomIdForPlayer = socketRooms[1];
        }

        if (roomIdForPlayer && rooms[roomIdForPlayer] && 
            (rooms[roomIdForPlayer].status === 'playing' || rooms[roomIdForPlayer].status === 'gameFinished')) {
            const playerGameState = rooms[roomIdForPlayer].playerGameStates[socket.id];
            if (playerGameState && !playerGameState.gameOver) {
                playerGameState.paddle.x = x;
                // Paddle position is updated directly. 
                // The main game loop will send this player's paddle info to others via 'opponentStatesUpdate'.
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client ${socket.id} disconnected`);
        // Find which room the player was in and remove them
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const playerIndex = room.players.findIndex(player => player.id === socket.id);
            if (playerIndex !== -1) {
                const removedPlayer = room.players.splice(playerIndex, 1)[0];
                console.log(`Player ${removedPlayer.name} removed from room ${roomId}`);

                if (room.players.length === 0) {
                    console.log(`Room ${roomId} is now empty. Deleting room.`);
                    // If game was running, its loop will stop due to no players.
                    delete rooms[roomId];
                } else {
                    // Notify remaining players
                    io.to(roomId).emit('updatePlayerListInLobby', { roomId, players: room.players });
                    
                    // If game was playing, the game loop will handle consequences for other players
                    // or stop if this was the last player.
                    // No need to delete playerGameStates[socket.id] explicitly here, 
                    // as the game loop won't process for non-existent players in room.players.
                    // If the room becomes empty, the whole 'rooms[roomId]' is deleted.
                    
                    if (room.status === 'waiting') {
                        // If anyone leaves while waiting, it's good to ensure no game accidentally starts
                        // if the 'allReady' condition was met just before they left.
                        // The 'allReady' check in 'playerReady' should handle this, but an explicit update is good.
                        console.log(`Player left room ${roomId} during waiting. Lobby updated.`);
                    } else if (room.status === 'playing') {
                        // The game loop itself checks for player count and handles game over / stopping.
                        // We might want to explicitly set room to 'waiting' if player count drops below minimum for ongoing game.
                        // For now, the game loop handles its own termination.
                        console.log(`Player left room ${roomId} during game. Game loop will handle consequences.`);
                    }
                }
                break; // Player can only be in one room
            }
        }
    });

    // More game-specific socket events will go here for syncing game state
    // e.g., socket.on('paddleMove', (data) => { /* ... */ });

});

server.listen(port, () => console.log(`Listening on port ${port}`)); 