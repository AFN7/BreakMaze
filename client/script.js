const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Socket.IO connection
const socket = io(); // Connects to the server that serves the page

// Log one audio element on load to check if it's found
console.log("Initial check for sound-brick-break element:", document.getElementById('sound-brick-break'));

// UI Elements
const scoreDisplay = document.getElementById('score');
const livesDisplay = document.getElementById('lives');
// const pauseButton = document.getElementById('pause-button'); // Pause button removed
const muteButton = document.getElementById('mute-button');
const muteBgButton = document.getElementById('mute-bg-button'); // New BG Mute Button
const volumeSlider = document.getElementById('volume-slider'); // New Volume Slider

// Lobby Elements
const lobbyContainer = document.getElementById('lobby-container');
const gameContainer = document.getElementById('game-container');
const playerNameInput = document.getElementById('player-name');
const roomCodeInput = document.getElementById('room-code-input');
const joinRoomButton = document.getElementById('join-room-button');
const createRoomButton = document.getElementById('create-room-button');
const readyButton = document.getElementById('ready-button'); // Ready button
const playersInRoomDiv = document.getElementById('players-in-room');
const errorMessageDiv = document.getElementById('error-message');
const mainWrapper = document.getElementById('main-wrapper'); // Added mainWrapper reference
const opponentGamesContainer = document.getElementById('opponent-games-container');

// Opponent display containers
let opponentCanvases = {}; // Stores { playerId: { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, nameDiv: HTMLDivElement } }

// Game constants - declarions moved here BEFORE setCanvasDimensions is called
let PADDLE_WIDTH;
let PADDLE_HEIGHT;
let INITIAL_PADDLE_WIDTH;
let PADDLE_Y_OFFSET;

let BALL_RADIUS;
let INITIAL_BALL_RADIUS;
let INITIAL_BALL_SPEED;

let POWER_UP_RADIUS;
let POWER_UP_SPEED;
const POWER_UP_DROP_CHANCE = 0.2; // 20% chance to drop a power-up

// These were originally defined later, but can be grouped with other game constants
let BRICK_ROW_COUNT = 7;
let BRICK_COLUMN_COUNT = 11;
let BRICK_WIDTH;
let BRICK_HEIGHT;
let BRICK_PADDING;
let BRICK_OFFSET_TOP;
let BRICK_OFFSET_LEFT;
const BRICK_COLOR = '#0f0'; // Neon Green
const PADDLE_COLOR = '#0cf'; // Neon Cyan, for example
const BALL_COLOR = '#ff0'; // Neon Yellow, for the local player's ball

let localPlayerName = "";
let localPlayerId = ""; // Will be set by server on joining room/game start
let playersInGame = {}; // Stores other players' data { id: { x: paddleX, name: 'name' } }
let currentRoomId = null; // Store the current room ID client-side
let localPlayerIsReady = false;

// Audio Context
let audioCtxResumed = false;
function resumeAudioContext() {
    if (!audioCtxResumed && window.AudioContext) {
        const tempAudioCtx = new window.AudioContext();
        if (tempAudioCtx.state === 'suspended') {
            tempAudioCtx.resume().then(() => {
                console.log("AudioContext resumed successfully after user interaction.");
                audioCtxResumed = true;
            }).catch(e => console.warn("AudioContext resume failed:", e));
        }
    }
}

// Audio Elements References
const soundBrickBreak = document.getElementById('sound-brick-break');
const soundPaddleHit = document.getElementById('sound-paddle-hit');
const soundPowerupCollect = document.getElementById('sound-powerup-collect');
const soundLevelClear = document.getElementById('sound-level-clear');
const soundGameOver = document.getElementById('sound-game-over');
// const backgroundMusic = document.getElementById('background-music'); // Removed backgroundMusic reference

let isMuted = false;
// let isBgMuted = false; // Removed
let currentVolume = 1.0; // Global volume for SFX

// Store all sound effect elements for easy volume control
const sfxElements = [soundBrickBreak, soundPaddleHit, soundPowerupCollect, soundLevelClear, soundGameOver];

// Function to apply current volume to SFX audio elements
function applySfxVolume() {
    sfxElements.forEach(sfx => {
        if (sfx) {
            sfx.volume = currentVolume;
        }
    });
}

// Initialize volume on load
applySfxVolume(); 

const SERVER_GAME_WIDTH = 800; // Conceptual game width on the server
const SERVER_GAME_HEIGHT = 600; // Conceptual game height on the server

const KEYBOARD_PADDLE_SPEED_SERVER = 30; // Speed/step for keyboard paddle movement in server space

// Function to play sound if not muted
function playSound(soundElement) {
    if (!isMuted && soundElement) {
        soundElement.volume = currentVolume; // Ensure volume is set before playing SFX
        soundElement.currentTime = 0;
        soundElement.play().catch(error => console.warn("Audio play failed for", soundElement.id, error));
    }
}

// Global Mute button event listener (now only for SFX)
muteButton.addEventListener('click', () => {
    isMuted = !isMuted;
    muteButton.textContent = isMuted ? '🔇' : '🔊';
    // No specific background music handling needed here anymore
});

// Background Music Mute button event listener - REMOVED
/*
muteBgButton.addEventListener('click', () => {
    isBgMuted = !isBgMuted;
    muteBgButton.textContent = isBgMuted ? 'BG 🔇' : 'BG 🔊';
    if (backgroundMusic) {
        if (isBgMuted) {
            backgroundMusic.pause(); // Pause if BG is muted
        } else if (!isMuted && backgroundMusic.paused) {
            // Play if BG unmuted, global not muted, and it was paused
            playSound(backgroundMusic);
        }
    }
});
*/

// Volume Slider event listener (now only for SFX)
volumeSlider.addEventListener('input', (e) => {
    currentVolume = parseFloat(e.target.value);
    applySfxVolume();
});

// Canvas Dimensions - Dynamic Setup
function setCanvasDimensions() {
    const gameContainerStyles = getComputedStyle(gameContainer);
    
    // Get the actual available space within the game container
    const gameContainerPaddingLeft = parseFloat(gameContainerStyles.paddingLeft) || 0;
    const gameContainerPaddingRight = parseFloat(gameContainerStyles.paddingRight) || 0;
    const gameContainerPaddingTop = parseFloat(gameContainerStyles.paddingTop) || 0;
    const gameContainerPaddingBottom = parseFloat(gameContainerStyles.paddingBottom) || 0;
    
    // Calculate available width and height for the canvas
    const uiContainer = document.getElementById('ui-container');
    const uiHeight = uiContainer ? uiContainer.offsetHeight : 0;
    
    const availableWidth = gameContainer.clientWidth - gameContainerPaddingLeft - gameContainerPaddingRight;
    const availableHeight = gameContainer.clientHeight - gameContainerPaddingTop - gameContainerPaddingBottom - uiHeight - 5; // 5px margin
    
    // Set canvas dimensions to fill the available space
    canvas.width = Math.floor(availableWidth);
    canvas.height = Math.floor(availableHeight);
    
    // Recalculate game parameters whenever canvas size changes
    calculateGameParameters(canvas.width, canvas.height);
    
    console.log(`Canvas dimensions set to: ${canvas.width}x${canvas.height}`);
}

let paddleX;
let localPaddleY_server; // Server-authoritative Y position for the local paddle
let localPaddleHeight_server; // Server-authoritative height for the local paddle
// PADDLE_WIDTH is already a global 'let', will be updated from server paddle data.

// Ball state - now an array to support multiple balls
let balls = [];

// Client bricks array - will be populated from server data
let clientBricks = [];

// Client-side representation of falling power-ups from server
let clientActivePowerUps = []; 

let score = 0;
let lives = 3;

// Power-up Types Enum
const PowerUpType = {
    PADDLE_GROW: 'paddle_grow',
    PADDLE_SHRINK: 'paddle_shrink',
    DOUBLE_BALL: 'double_ball',
    TRIPLE_BALL: 'triple_ball',
    SLOW_BALL: 'slow_ball',
    FAST_BALL: 'fast_ball',
    SHIELD: 'shield',
    // INVERTED_CONTROLS: 'inverted_controls', // For later
    // BRICK_SWAP: 'brick_swap' // For later
};

let shieldActive = false;

// --- MAP SYSTEM ---
const Maps = {
    // 0: empty, 1: standard brick, 2: strong brick (2 hits), 9: unbreakable
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
    // Add more maps here
};

let currentMap;
let currentLevelIndex = 0;
const mapKeys = Object.keys(Maps);

// Brick Colors based on type/health
const BRICK_COLORS = {
    STANDARD: '#0f0', // Neon Green
    STRONG_1: '#ff0',   // Neon Yellow (1 hit left on a 2-hit brick)
    STRONG_2: '#f80',   // Neon Orange (2 hits left)
    UNBREAKABLE: '#888' // Grey
};
// --- END MAP SYSTEM ---

// --- PARTICLE SYSTEM ---
let particles = [];
const PARTICLE_LIFESPAN = 30; // In frames
const PARTICLE_COUNT_ON_BRICK_BREAK = 10;
const PARTICLE_BASE_SPEED = 2;

function spawnParticles(x, y, color) {
    // Assume x and y are in server coordinate space
    // We'll store them as server coordinates and transform when drawing
    for (let i = 0; i < PARTICLE_COUNT_ON_BRICK_BREAK; i++) {
        particles.push({
            // Store in server coordinate space
            x: x,
            y: y,
            size: Math.random() * 3 + 1, // Size in pixels, will be scaled when drawing
            color: color,
            lifespan: PARTICLE_LIFESPAN,
            speedX: (Math.random() - 0.5) * PARTICLE_BASE_SPEED * 2, // Server space speed
            speedY: (Math.random() - 0.5) * PARTICLE_BASE_SPEED * 2  // Server space speed
        });
    }
}

function updateAndDrawParticles() {
    // Use full canvas scaling without aspect ratio constraints
    const scaleX = canvas.width / SERVER_GAME_WIDTH;
    const scaleY = canvas.height / SERVER_GAME_HEIGHT;
    
    // Check if particles is defined
    if (!particles) {
        particles = [];
        return;
    }
    
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.speedX;
        p.y += p.speedY;
        p.lifespan--;

        if (p.lifespan <= 0) {
            particles.splice(i, 1);
        } else {
            // Draw particles scaled to full canvas
            ctx.beginPath();
            ctx.arc(p.x * scaleX, p.y * scaleY, p.size * Math.min(scaleX, scaleY), 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.globalAlpha = p.lifespan / PARTICLE_LIFESPAN; // Fade out effect
            ctx.fill();
            ctx.closePath();
        }
    }
    ctx.globalAlpha = 1.0; // Reset global alpha
}
// --- END PARTICLE SYSTEM ---

// Function to calculate dynamic game parameters
function calculateGameParameters(targetCanvasWidth, targetCanvasHeight, sourceGameWidth = 800, sourceGameHeight = 600) {
    // Scale directly to the canvas size without preserving aspect ratio
    const scaleX = targetCanvasWidth / sourceGameWidth;
    const scaleY = targetCanvasHeight / sourceGameHeight;

    // Main canvas paddle parameters (will be used if not drawing a specific opponent's paddle)
    PADDLE_WIDTH = sourceGameWidth * 0.15 * scaleX;
    INITIAL_PADDLE_WIDTH = PADDLE_WIDTH;
    PADDLE_HEIGHT = sourceGameHeight * 0.03 * scaleY;
    PADDLE_HEIGHT = Math.max(15 * scaleY, PADDLE_HEIGHT); // Min height scaled
    PADDLE_Y_OFFSET = sourceGameHeight * 0.05 * scaleY;

    // Main canvas ball parameters
    BALL_RADIUS = sourceGameWidth * 0.008 * scaleX; // Scale radius based on width scale for consistency
    BALL_RADIUS = Math.max(5 * Math.min(scaleX, scaleY), BALL_RADIUS); // Min radius scaled
    INITIAL_BALL_RADIUS = BALL_RADIUS;
    // INITIAL_BALL_SPEED is mostly a server concept now.

    // Brick dimensions are sent by server, client just scales them.
    // The BRICK_COLOR constants remain useful.

    POWER_UP_RADIUS = sourceGameWidth * 0.012 * scaleX;
    POWER_UP_RADIUS = Math.max(8 * Math.min(scaleX, scaleY), POWER_UP_RADIUS);
    
    POWER_UP_SPEED = sourceGameHeight * 0.003 * scaleY; // Ensure this is uncommented
    POWER_UP_SPEED = Math.max(1 * scaleY, POWER_UP_SPEED); // Ensure this is uncommented
    
    console.log(`Game parameters calculated with direct scale factors: X=${scaleX}, Y=${scaleY}`);
}

// Call this after setting canvas dimensions and before initGame or inside initGame
// For the main canvas:
calculateGameParameters(canvas.width, canvas.height); 

// Function to create a new ball
function createBall(x, y, speedX, speedY, radius = BALL_RADIUS, color = BALL_COLOR) {
    return { x, y, speedX, speedY, radius, color, id: Date.now() + Math.random() };
}

function initializeBricks() {
    // This function is now largely obsolete for initializing game state bricks,
    // as the server sends the authoritative brick list.
    // It might still be used for calculating visual parameters if client needs to derive them.
    // For now, we rely on server sending all necessary brick info (x,y,w,h,status,type,health)
    clientBricks = []; // Clear client bricks, will be populated by server state
    console.log("Client initializeBricks called - now primarily awaits server state.");
}

function resetBallAndPaddle(resetPaddleSize = true) {
    const initialSpeedX = (Math.random() > 0.5 ? 1 : -1) * INITIAL_BALL_SPEED;
    const initialSpeedY = -INITIAL_BALL_SPEED;
    balls = [createBall(canvas.width / 2, canvas.height - PADDLE_HEIGHT - PADDLE_Y_OFFSET - INITIAL_BALL_RADIUS - 5, initialSpeedX, initialSpeedY)];
    paddleX = (canvas.width - PADDLE_WIDTH) / 2;
    if (resetPaddleSize) {
        PADDLE_WIDTH = INITIAL_PADDLE_WIDTH;
    }
    particles = [];
    ballTrail = [];
}

function initGame() {
    // Ensure all game variables are initialized
    ensureGameVariablesInitialized();
    
    calculateGameParameters(canvas.width, canvas.height);
    particles = [];
    ballTrail = [];
    paddleX = canvas.width / 2 - PADDLE_WIDTH / 2; 
    // clientBricks = []; // Cleared on startGame or gameStateUpdate
    // Score & lives are set by server on startGame
    updateUIDisplay();
}

function drawPaddle(ctx, pData, pColor, targetCanvasWidth, targetCanvasHeight, sourceGameWidth, sourceGameHeight, xOffset = 0, yOffset = 0) {
    if (!pData) return;

    const scaleX = targetCanvasWidth / sourceGameWidth;
    const scaleY = targetCanvasHeight / sourceGameHeight;

    const x = (pData.x * scaleX) + xOffset;
    const y = (pData.y * scaleY) + yOffset; // y is now from pData
    const width = pData.width * scaleX;
    const height = pData.height * scaleY; // height is now from pData

    ctx.shadowColor = pColor;
    ctx.shadowBlur = 10; // Slightly less blur for potentially smaller paddles
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.fillStyle = pColor;
    ctx.fill();
    // Simple highlight for paddles
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x + width * 0.1, y + height * 0.1, width * 0.8, height * 0.8);
    ctx.globalAlpha = 1.0;

    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1, 1 * Math.min(scaleX, scaleY)); // Scale line width slightly
    ctx.strokeRect(x, y, width, height);
    ctx.closePath();
    ctx.shadowBlur = 0;

    // Shield drawing (if applicable for this paddle, needs shieldActive state for pData)
    // if (pData.shieldActive) {
    //     ctx.beginPath();
    //     const shieldY = (sourceGameHeight - (sourceGameHeight * 0.05 / 2)) * scaleY; // Approx shield Y scaled
    //     ctx.rect(0, shieldY, targetCanvasWidth, 5 * scaleY); 
    //     ctx.fillStyle = "rgba(0, 255, 255, 0.5)"; 
    //     ctx.fill();
    //     ctx.closePath();
    // }
}

let ballTrail = [];
const BALL_TRAIL_LENGTH = 10;

function drawBalls(ctx, ballsToDraw, defaultColor, targetCanvasWidth, targetCanvasHeight, sourceGameWidth, sourceGameHeight, xOffset = 0, yOffset = 0) {
    if (!ballsToDraw) return;
    
    const scaleX = targetCanvasWidth / sourceGameWidth; 
    const scaleY = targetCanvasHeight / sourceGameHeight;

    ballsToDraw.forEach(ball => {
        const x = (ball.x * scaleX) + xOffset;
        const y = (ball.y * scaleY) + yOffset;
        const radius = ball.radius * Math.min(scaleX, scaleY); // Scale radius

        ctx.shadowColor = ball.color || defaultColor;
        ctx.shadowBlur = Math.max(5, 15 * Math.min(scaleX, scaleY)); // Scale shadow blur
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = ball.color || defaultColor;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(0.5, 1 * Math.min(scaleX, scaleY)); // Scale line width
        ctx.stroke();
        ctx.closePath();
        ctx.shadowBlur = 0;
    });
}

function getBrickColor(brick) { // Helper to determine brick color based on its state
    if (brick.type === 9) return BRICK_COLORS.UNBREAKABLE;
    if (brick.type === 2) { // Strong brick
        if (brick.health === 2) return BRICK_COLORS.STRONG_2;
        if (brick.health === 1) return BRICK_COLORS.STRONG_1;
    }
    return BRICK_COLORS.STANDARD; // Default for type 1 or broken (though broken won't be drawn)
}

function drawBricks(ctx, bricksToDraw, targetCanvasWidth, targetCanvasHeight, sourceGameWidth, sourceGameHeight, xOffset = 0, yOffset = 0) {
    if (!bricksToDraw) return;
    
    const scaleX = targetCanvasWidth / sourceGameWidth;
    const scaleY = targetCanvasHeight / sourceGameHeight;

    bricksToDraw.forEach(brick => {
        if (brick.status === 1) {
            const x = (brick.x * scaleX) + xOffset;
            const y = (brick.y * scaleY) + yOffset;
            const width = brick.width * scaleX;
            const height = brick.height * scaleY;
            const color = getBrickColor(brick);

            ctx.shadowColor = color;
            ctx.shadowBlur = Math.max(3, 8 * Math.min(scaleX, scaleY)); // Scale shadow
            ctx.beginPath();
            ctx.rect(x, y, width, height);
            ctx.fillStyle = color;
            ctx.fill();
            
            // Simplified highlight for bricks
            ctx.globalAlpha = 0.7;
            ctx.fillStyle = '#fff';
            ctx.fillRect(x + width * 0.1, y + height * 0.1, width * 0.8, height * 0.8);
            ctx.globalAlpha = 1.0;

            ctx.strokeStyle = '#fff';
            ctx.lineWidth = Math.max(0.2, 0.5 * Math.min(scaleX, scaleY)); // Scale line width
            ctx.strokeRect(x, y, width, height);
            ctx.closePath();
            ctx.shadowBlur = 0;
        }
    });
}

// Renamed from drawPowerUps to drawClientPowerUps and adapted for server data
// Takes context and powerUpsToDraw to be reusable for opponent views
function drawClientPowerUps(targetCtx, powerUpsToDraw, targetCanvasWidth, targetCanvasHeight, sourceGameWidth, sourceGameHeight, xOffset = 0, yOffset = 0) {
    if (!powerUpsToDraw) return;

    const scaleX = targetCanvasWidth / sourceGameWidth;
    const scaleY = targetCanvasHeight / sourceGameHeight;

    powerUpsToDraw.forEach(powerUp => {
        const x = (powerUp.x * scaleX) + xOffset;
        const y = (powerUp.y * scaleY) + yOffset;
        const radius = POWER_UP_RADIUS * Math.min(scaleX, scaleY); // Use scaled POWER_UP_RADIUS

        let color = '#FFA500'; // Default orange
        let text = '?';

        // Determine color and text based on type (mirroring client-side spawnPowerUp for visuals)
        switch (powerUp.type) {
            case PowerUpType.PADDLE_GROW: color = '#00FF00'; text = 'P+'; break;
            case PowerUpType.PADDLE_SHRINK: color = '#FF0000'; text = 'P-'; break;
            case PowerUpType.DOUBLE_BALL: color = '#ADD8E6'; text = '2X'; break;
            case PowerUpType.TRIPLE_BALL: color = '#0000FF'; text = '3X'; break;
            case PowerUpType.SLOW_BALL: color = '#FFFF00'; text = 'S'; break;
            case PowerUpType.FAST_BALL: color = '#FF00FF'; text = 'F'; break;
            case PowerUpType.SHIELD: color = '#00FFFF'; text = 'SH'; break;
        }

        targetCtx.beginPath();
        targetCtx.arc(x, y, radius, 0, Math.PI * 2);
        targetCtx.fillStyle = color;
        targetCtx.fill();
        targetCtx.strokeStyle = '#fff';
        targetCtx.lineWidth = Math.max(0.5, 1 * Math.min(scaleX, scaleY));
        targetCtx.stroke();
        targetCtx.closePath();

        targetCtx.fillStyle = '#000';
        targetCtx.font = `bold ${Math.max(8, 10 * Math.min(scaleX, scaleY))}px sans-serif`;
        targetCtx.textAlign = 'center';
        targetCtx.textBaseline = 'middle';
        targetCtx.fillText(text, x, y);
    });
}

function spawnPowerUp(brickX, brickY) {
    // THIS FUNCTION IS NOW CLIENT-SIDE VISUAL HINTING OR OBSOLETE
    // SERVER IS AUTHORITATIVE FOR POWER-UP SPAWNING
    /*
    if (Math.random() < POWER_UP_DROP_CHANCE) {
        const powerUpTypes = Object.values(PowerUpType);
        const type = powerUpTypes[Math.floor(Math.random() * powerUpTypes.length)];
        let color = '#FFA500'; // Default orange
        switch (type) {
            case PowerUpType.PADDLE_GROW: color = '#00FF00'; break; // Green
            case PowerUpType.PADDLE_SHRINK: color = '#FF0000'; break; // Red
            case PowerUpType.DOUBLE_BALL: color = '#ADD8E6'; break; // Light Blue for Double Ball - Corrected order
            case PowerUpType.TRIPLE_BALL: color = '#0000FF'; break; // Blue
            case PowerUpType.SLOW_BALL: color = '#FFFF00'; break; // Yellow
            case PowerUpType.FAST_BALL: color = '#FF00FF'; break; // Magenta
            case PowerUpType.SHIELD: color = '#00FFFF'; break; // Cyan
        }
        activePowerUps.push({ x: brickX + BRICK_WIDTH / 2, y: brickY + BRICK_HEIGHT / 2, type, color });
    }
    */
}

function applyPowerUp(type) {
    // THIS FUNCTION IS NOW LARGELY OBSOLETE ON CLIENT
    // SERVER APPLIES EFFECTS, CLIENT UPDATES STATE FROM SERVER
    // Client might play a sound or show a visual confirmation, but state changes are server-driven.
    console.log("Client notified of power-up effect (server is authoritative):", type);
    // playSound(soundPowerupCollect); // Moved sound playing to when server confirms collection/effect

    /*
    console.log("Applying power-up:", type);
    switch (type) {
        case PowerUpType.PADDLE_GROW:
            PADDLE_WIDTH = Math.min(PADDLE_WIDTH + (INITIAL_PADDLE_WIDTH * 0.5), canvas.width * 0.4); 
            break;
        case PowerUpType.PADDLE_SHRINK:
            PADDLE_WIDTH = Math.max(PADDLE_WIDTH - (INITIAL_PADDLE_WIDTH * 0.3), INITIAL_PADDLE_WIDTH * 0.5); 
            break;
        case PowerUpType.DOUBLE_BALL:
            if (balls.length > 0 && balls.length < 3) { // Limit to max 3 balls for now with double/triple
                const originalBall = balls[0];
                const speedMagnitude = Math.sqrt(originalBall.speedX**2 + originalBall.speedY**2);
                // Add one new ball, try to angle it differently than triple
                balls.push(createBall(originalBall.x, originalBall.y, speedMagnitude * Math.cos(Math.PI / 6), -speedMagnitude * Math.sin(Math.PI / 6), originalBall.radius, originalBall.color));
            }
            break;
        case PowerUpType.TRIPLE_BALL:
            if (balls.length > 0) {
                const originalBall = balls[0]; // Base new balls on the first one
                const speedMagnitude = Math.sqrt(originalBall.speedX**2 + originalBall.speedY**2);
                balls.push(createBall(originalBall.x, originalBall.y, speedMagnitude * Math.cos(Math.PI / 4), -speedMagnitude * Math.sin(Math.PI / 4), originalBall.radius, originalBall.color));
                balls.push(createBall(originalBall.x, originalBall.y, speedMagnitude * Math.cos(3 * Math.PI / 4), -speedMagnitude * Math.sin(3 * Math.PI / 4), originalBall.radius, originalBall.color));
            }
            break;
        case PowerUpType.SLOW_BALL:
            balls.forEach(ball => {
                ball.speedX *= 0.7;
                ball.speedY *= 0.7;
                // Prevent ball from becoming too slow or stopping
                const minSpeed = INITIAL_BALL_SPEED * 0.3;
                if (Math.abs(ball.speedX) < minSpeed) ball.speedX = Math.sign(ball.speedX) * minSpeed || minSpeed;
                if (Math.abs(ball.speedY) < minSpeed) ball.speedY = Math.sign(ball.speedY) * minSpeed || minSpeed;
            });
            break;
        case PowerUpType.FAST_BALL:
            balls.forEach(ball => {
                ball.speedX *= 1.3;
                ball.speedY *= 1.3;
                // Cap max speed
                const maxSpeed = INITIAL_BALL_SPEED * 2.5;
                if (Math.abs(ball.speedX) > maxSpeed) ball.speedX = Math.sign(ball.speedX) * maxSpeed;
                if (Math.abs(ball.speedY) > maxSpeed) ball.speedY = Math.sign(ball.speedY) * maxSpeed;
            });
            break;
        case PowerUpType.SHIELD:
            shieldActive = true;
            setTimeout(() => shieldActive = false, 10000); // Shield lasts 10 seconds
            break;
    }
    */
}

function collisionDetection() {
    // CLIENT-SIDE COLLISION DETECTION IS NOW LARGELY OBSOLETE FOR GAME LOGIC
    // Server handles all authoritative collisions (ball-brick, ball-paddle, ball-wall)
    // and power-up collection.
    // Client receives game state updates from the server.
    // This function could be kept for purely cosmetic client-side predictions or effects
    // but for now, we will rely on server state.
    // Sounds will be played based on server state changes or specific events from server.

    /* balls.forEach((ball, ballIndex) => {
        // Ball and Bricks
// ... existing code ...
        // Power-up collection
    activePowerUps.forEach((powerUp, index) => {
        powerUp.y += POWER_UP_SPEED;
        if (powerUp.x + POWER_UP_RADIUS > paddleX && 
            powerUp.x - POWER_UP_RADIUS < paddleX + PADDLE_WIDTH &&
            powerUp.y + POWER_UP_RADIUS > canvas.height - PADDLE_HEIGHT - PADDLE_Y_OFFSET &&
            powerUp.y - POWER_UP_RADIUS < canvas.height - PADDLE_Y_OFFSET) {
            // applyPowerUp(powerUp.type); // Server handles application
            // playSound(soundPowerupCollect); // Server will inform when to play sound or client plays on state change
            // activePowerUps.splice(index, 1); // Server manages this list
        }
        // Remove power-up if it goes off screen
        if (powerUp.y - POWER_UP_RADIUS > canvas.height) {
            // activePowerUps.splice(index, 1); // Server manages this list
        }
    });
    */
}

function updateGame() {
    // If not in game or no player ID, do nothing
    if (!localPlayerId || gameContainer.style.display === 'none') return;
    
    // If in spectator mode, we don't need to update anything locally
    // as we'll get opponent state updates from the server
    if (currentlySpectatingPlayerId) return;
    
    // Local paddle input is handled by movePaddle and emitted
    // All other game state is driven by server
}

function drawGame() { // This is for the MAIN canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Use the full canvas area without letterboxing
    const gameDrawWidth = canvas.width;
    const gameDrawHeight = canvas.height;
    
    // No offsets, use the full canvas
    const xOffset = 0;
    const yOffset = 0;
    
    // Draw a dark background for the game area (slightly darker than pure black)
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // If in spectator mode, draw the spectated player's game
    if (currentlySpectatingPlayerId && playersInGame[currentlySpectatingPlayerId]) {
        const spectatedPlayer = playersInGame[currentlySpectatingPlayerId];
        
        // Draw the spectated player's paddle
        if (spectatedPlayer.paddle) {
            drawPaddle(ctx, spectatedPlayer.paddle, '#FF69B4', gameDrawWidth, gameDrawHeight, 
                       spectatedPlayer.sourceGameWidth, spectatedPlayer.sourceGameHeight, xOffset, yOffset);
        }
        
        // Draw the spectated player's balls
        if (spectatedPlayer.balls) {
            drawBalls(ctx, spectatedPlayer.balls, '#f0f', gameDrawWidth, gameDrawHeight, 
                      spectatedPlayer.sourceGameWidth, spectatedPlayer.sourceGameHeight, xOffset, yOffset);
        }
        
        // Draw the spectated player's bricks
        if (spectatedPlayer.bricks) {
            drawBricks(ctx, spectatedPlayer.bricks, gameDrawWidth, gameDrawHeight, 
                       spectatedPlayer.sourceGameWidth, spectatedPlayer.sourceGameHeight, xOffset, yOffset);
        }
        
        // Draw the spectated player's power-ups
        if (spectatedPlayer.activePowerUps) {
            drawClientPowerUps(ctx, spectatedPlayer.activePowerUps, gameDrawWidth, gameDrawHeight, 
                               spectatedPlayer.sourceGameWidth, spectatedPlayer.sourceGameHeight, xOffset, yOffset);
        }
        
        // Update spectator UI
        updateSpectatorUI(currentlySpectatingPlayerId);
        
        return; // Skip drawing local player's game
    }
    
    // Otherwise, draw the local player's game as normal
    // paddleX, PADDLE_WIDTH, localPaddleY_server, localPaddleHeight_server
    // are assumed to be initialized by 'startGame' or 'gameStateUpdate' with server values.
    const localPaddleDrawData = {
        x: paddleX,
        y: localPaddleY_server,
        width: PADDLE_WIDTH,
        height: localPaddleHeight_server
    };

    // Check if paddle data is valid before drawing
    if (paddleX !== undefined && localPaddleY_server !== undefined && PADDLE_WIDTH !== undefined && localPaddleHeight_server !== undefined) {
        drawPaddle(ctx, localPaddleDrawData, PADDLE_COLOR, gameDrawWidth, gameDrawHeight, SERVER_GAME_WIDTH, SERVER_GAME_HEIGHT, xOffset, yOffset);
    } else {
        // console.warn("Local paddle data not ready for drawing.");
    }

    // Draw local player's balls
    drawBalls(ctx, balls, BALL_COLOR, gameDrawWidth, gameDrawHeight, SERVER_GAME_WIDTH, SERVER_GAME_HEIGHT, xOffset, yOffset);
    
    // Draw local player's bricks
    if (typeof clientBricks !== 'undefined' && clientBricks) {
        drawBricks(ctx, clientBricks, gameDrawWidth, gameDrawHeight, SERVER_GAME_WIDTH, SERVER_GAME_HEIGHT, xOffset, yOffset);
    }
    
    // Draw local player's power-ups
    drawClientPowerUps(ctx, clientActivePowerUps, gameDrawWidth, gameDrawHeight, SERVER_GAME_WIDTH, SERVER_GAME_HEIGHT, xOffset, yOffset);
    
    // Draw particles
    updateAndDrawParticles();
}

// Modify the main gameLoop to store the animationFrameId
let animationFrameId; // animationFrameId is still needed for the main game loop
function gameLoop() {
    // Update game state
    updateGame();
    
    // Draw the game
    drawGame();
    
    // Keep the animation loop running
    animationFrameId = requestAnimationFrame(gameLoop);
}

// Event Listeners for paddle control
document.addEventListener('mousemove', mouseMoveHandler);
document.addEventListener('touchmove', touchMoveHandler, { passive: false });
// document.addEventListener('touchstart', touchMoveHandler, { passive: false }); // Can sometimes conflict with clicks

function movePaddle(desired_X_server_space) {
    // desired_X_server_space is the target left edge of the paddle in server coordinates

    let tentative_X_server_space = desired_X_server_space;

    // Clamp tentative_X_server_space to be within server game bounds
    // PADDLE_WIDTH is server-space width, updated from server gameState
    if (tentative_X_server_space < 0) {
        tentative_X_server_space = 0;
    }
    // Use SERVER_GAME_WIDTH for clamping upper bound
    if (PADDLE_WIDTH !== undefined && tentative_X_server_space + PADDLE_WIDTH > SERVER_GAME_WIDTH) {
        tentative_X_server_space = SERVER_GAME_WIDTH - PADDLE_WIDTH;
    }

    // Only emit if game is active
    if (gameContainer.style.display === 'flex') { 
        socket.emit('paddleMove', { x: tentative_X_server_space }); 
    }
    // No local update of paddleX here; rely on server's gameStateUpdate for local paddle position.
}

function mouseMoveHandler(event) {
    if (gameContainer.style.display !== 'flex') return; // Ensure game is active before processing

    const rect = canvas.getBoundingClientRect();
    
    // Simply convert mouse position to game coordinates without aspect ratio considerations
    let relativeX_client_pixels = event.clientX - rect.left;
    
    // Scale to server coordinates directly
    let mouse_X_server_space = relativeX_client_pixels * (SERVER_GAME_WIDTH / canvas.width);

    // Calculate paddle position
    if (PADDLE_WIDTH !== undefined) {
        let target_paddle_left_X_server_space = mouse_X_server_space - (PADDLE_WIDTH / 2);
        movePaddle(target_paddle_left_X_server_space);
    }
}

function touchMoveHandler(event) {
    if (gameContainer.style.display !== 'flex') return; // Ensure game is active

    if (event.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        
        // Simply convert touch position to game coordinates without aspect ratio considerations
        let relativeX_client_pixels = event.touches[0].clientX - rect.left;
        
        // Scale to server coordinates directly
        let mouse_X_server_space = relativeX_client_pixels * (SERVER_GAME_WIDTH / canvas.width);

        if (PADDLE_WIDTH !== undefined) {
            let target_paddle_left_X_server_space = mouse_X_server_space - (PADDLE_WIDTH / 2);
            movePaddle(target_paddle_left_X_server_space);
        }
        event.preventDefault(); // Call after calculations, ensure it's consistently called if event is handled.
    }
}

function keyDownHandler(event) {
    if (gameContainer.style.display !== 'flex' || !localPlayerId) return; // Game not active or player not identified

    let desiredX = paddleX; // paddleX is server-synced left edge

    switch (event.key) {
        case 'ArrowLeft':
            desiredX = paddleX - KEYBOARD_PADDLE_SPEED_SERVER;
            event.preventDefault(); // Prevent default browser action (e.g., scrolling)
            break;
        case 'ArrowRight':
            desiredX = paddleX + KEYBOARD_PADDLE_SPEED_SERVER;
            event.preventDefault(); // Prevent default browser action
            break;
        default:
            return; // Exit if it's not an arrow key we care about
    }
    movePaddle(desiredX); // movePaddle expects desired left edge in server space
}

// Add keydown listener for keyboard controls
document.addEventListener('keydown', keyDownHandler);

// Listen for window focus and blur events
window.addEventListener('focus', () => {
    console.log("Window gained focus. Game controls should be active.");
    // Potentially re-check mouse position or keyboard states if issues persist
});

window.addEventListener('blur', () => {
    console.log("Window lost focus. Game controls might become unresponsive until focus returns.");
    // Reset any held key states here if implementing stuck key prevention
});

// Add resize listener to readjust canvas and game parameters
window.addEventListener('resize', () => {
    if (mainWrapper.style.display !== 'none') {
        // Use requestAnimationFrame to ensure we resize after the browser has updated layout
        requestAnimationFrame(() => {
            setCanvasDimensions();
            // Re-initialize game parameters but maintain game state
            calculateGameParameters(canvas.width, canvas.height);
        });
    }
});

// Start the game
// initGame(); // MOVED: initGame is called within showGame after canvas is sized

// Function to update score and lives on screen
function updateUIDisplay() {
    scoreDisplay.textContent = `Score: ${score}`;
    livesDisplay.textContent = `Lives: ${lives}`;
    // Could also update a power-up status element here in the future
}

// Basic pause functionality - REMOVED
/*
let isPaused = false;
let animationFrameId; 

pauseButton.addEventListener('click', togglePause);

function togglePause() {
    isPaused = !isPaused;
    pauseButton.textContent = isPaused ? '▶' : '||';
    if (isPaused) {
        cancelAnimationFrame(animationFrameId); // Stop the game loop
        console.log('Game Paused');
    } else {
        console.log('Game Resumed');
        animationFrameId = requestAnimationFrame(gameLoop); // Resume the game loop
    }
}
*/

// Initial call to start the game loop
animationFrameId = requestAnimationFrame(gameLoop); 

function loadMap(levelIndex) {
    if (levelIndex >= mapKeys.length) {
        // All levels completed
        alert("CONGRATULATIONS! You have completed all levels!");
        currentLevelIndex = 0; // Loop back to first level or end game
        // document.location.reload(); // Or go to a victory screen
    }
    currentMap = Maps[mapKeys[levelIndex]];
    // Recalculate parameters as map dimensions might change brick layout
    calculateGameParameters(canvas.width, canvas.height); 
    initializeBricks();
    resetBallAndPaddle(true); // Reset paddle size too
}

// --- LOBBY/GAME STATE MANAGEMENT ---
function showLobby() {
    lobbyContainer.style.display = 'flex'; 
    // gameContainer.style.display = 'none'; // mainWrapper handles game visibility now
    mainWrapper.style.display = 'none'; // Hide the main game area wrapper
    readyButton.style.display = 'none';
    currentRoomId = null;
    localPlayerIsReady = false;
    readyButton.textContent = 'Ready Up';
    readyButton.style.backgroundColor = '#28a745'; 
    playersInRoomDiv.innerHTML = ''; 
    errorMessageDiv.textContent = ''; 
}

function showGame() {
    try {
        console.log("Showing game...");
        
        // Make sure required DOM elements exist
        if (!lobbyContainer || !mainWrapper || !gameContainer) {
            console.error("Required DOM elements not found:", {
                lobbyContainer: !!lobbyContainer,
                mainWrapper: !!mainWrapper,
                gameContainer: !!gameContainer
            });
            return;
        }
        
        // Make sure all game variables are initialized
        ensureGameVariablesInitialized();
        
        // Hide lobby and show game
        lobbyContainer.style.display = 'none';
        mainWrapper.style.display = 'flex'; 
        gameContainer.style.display = 'flex'; 

        // Defer canvas sizing and game initialization until the browser is ready to paint,
        // ensuring container dimensions are correctly calculated by the layout engine.
        requestAnimationFrame(() => {
            try {
                // Force a reflow to ensure container dimensions are updated
                void mainWrapper.offsetWidth;
                void gameContainer.offsetWidth;
                
                setCanvasDimensions(); // Call this now that containers are visible and sized
                initGame(); 
                
                // Add this check to log canvas dimensions for debugging
                console.log(`Game started with canvas dimensions: ${canvas.width}x${canvas.height}`);
                console.log(`Game container dimensions: ${gameContainer.clientWidth}x${gameContainer.clientHeight}`);
            } catch (error) {
                console.error("Error initializing game:", error);
            }
        });
    } catch (error) {
        console.error("Error in showGame:", error);
    }
}

// Call showLobby on initial load if not handled by HTML structure already
// window.onload = showLobby; // HTML already handles initial visibility

createRoomButton.addEventListener('click', () => {
    localPlayerName = playerNameInput.value.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    if (!localPlayerName) {
        errorMessageDiv.textContent = 'Please enter a player name.';
        return;
    }
    resumeAudioContext(); // Attempt to resume AudioContext
    socket.emit('createRoom', { playerName: localPlayerName });
    errorMessageDiv.textContent = '';
});

joinRoomButton.addEventListener('click', () => {
    localPlayerName = playerNameInput.value.trim() || `Player${Math.floor(Math.random() * 1000)}`;
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    if (!localPlayerName) {
        errorMessageDiv.textContent = 'Please enter a player name.';
        return;
    }
    if (!roomCode) {
        errorMessageDiv.textContent = 'Please enter a room code.';
        return;
    }
    resumeAudioContext(); // Attempt to resume AudioContext
    socket.emit('joinRoom', { playerName: localPlayerName, roomCode });
    errorMessageDiv.textContent = '';
});

readyButton.addEventListener('click', () => {
    localPlayerIsReady = !localPlayerIsReady;
    socket.emit('playerReady', { roomId: currentRoomId, isReady: localPlayerIsReady });
    readyButton.textContent = localPlayerIsReady ? 'Ready ✔' : 'Not Ready';
    readyButton.style.backgroundColor = localPlayerIsReady ? '#dc3545' : '#28a745'; // Red when ready, green when not
});

// Function to update the display of players in the lobby
function updateLobbyPlayerList(roomId, players) {
    currentRoomId = roomId; // Keep track of the room we are in
    readyButton.style.display = 'block'; // Show ready button when in a room
    let playerListHTML = `Room Code: <b>${roomId}</b> <br> Players:<br>`;
    players.forEach(player => {
        playerListHTML += `${player.name} ${player.isReady ? '✔' : '❌'}<br>`;
        if (player.id === localPlayerId) {
            localPlayerIsReady = player.isReady; // Sync local ready state with server
            readyButton.textContent = localPlayerIsReady ? 'Ready ✔' : 'Not Ready';
            readyButton.style.backgroundColor = localPlayerIsReady ? '#dc3545' : '#28a745';
        }
    });
    playersInRoomDiv.innerHTML = playerListHTML;
}

// Socket.IO Event Handlers for Lobby
socket.on('roomCreated', (data) => {
    console.log('Room Created:', data.roomId, 'My PlayerID:', data.playerId, 'Map:', data.mapName);
    localPlayerId = data.playerId; // Use the ID sent by the server for this client
    currentRoomId = data.roomId;   // Store the room ID

    // Update the UI to show that the room is created.
    // The 'updatePlayerListInLobby' event will populate the list fully soon.
    if (playersInRoomDiv) { 
        playersInRoomDiv.innerHTML = `Room Code: <b>${data.roomId}</b> <br> Players: Fetching...`;
    }
    if (readyButton) { 
        readyButton.style.display = 'block'; // Show ready button as we are in a room context
    }
    // playersInGame object is for when game starts, not for lobby display.
    // The actual player list will be updated by the 'updatePlayerListInLobby' event handler.
});

socket.on('joinedRoom', (data) => {
    console.log('Joined Room:', data.roomId, 'Players:', data.players);
    localPlayerId = socket.id; 
    updateLobbyPlayerList(data.roomId, data.players);
});

// New event to specifically update lobby player list (e.g. ready status changed)
socket.on('updatePlayerListInLobby', (data) => {
    console.log('Player list updated:', data.players);
    if (lobbyContainer.style.display !== 'none') { // Only update if lobby is visible
        updateLobbyPlayerList(data.roomId, data.players);
    }
});

socket.on('playerJoined', (data) => { // This can now just call updateLobbyPlayerList
    console.log('Player Joined:', data.playerName, 'ID:', data.playerId);
    // Update lobby UI if we're in the lobby
    if (lobbyContainer.style.display === 'flex') {
        updateLobbyPlayerList(data.roomId, data.players);
    }
    // Otherwise we're in game, and the player's game state updates will come through opponentStatesUpdate
});

socket.on('playerLeft', (data) => { // Similar to playerJoined
    console.log('Player Left:', data.playerName, 'ID:', data.playerId);
    // Update lobby UI if we're in the lobby
    if (lobbyContainer.style.display === 'flex') {
        updateLobbyPlayerList(data.roomId, data.players);
    }
    // If a player leaves during the game and we're spectating them, stop spectating
    if (currentlySpectatingPlayerId === data.playerId) {
        exitSpectatorMode();
    }
    // Remove this player from our players in game tracking
    if (data.playerId !== localPlayerId) {
        delete playersInGame[data.playerId];
        // Remove their mini-canvas if we have one
        if (opponentCanvases[data.playerId]) {
            opponentCanvases[data.playerId].containerDiv.remove();
            delete opponentCanvases[data.playerId];
        }
    }
});

socket.on('roomError', (errorData) => {
    console.error('Room Error:', errorData.message);
    errorMessageDiv.textContent = errorData.message;
});

socket.on('startGame', (data) => {
    try {
        console.log('Server initiated game start. Room:', data.roomId, 'LocalPlayerID:', data.localPlayerId, 'Initial GameState:', data.gameState);
        
        // Make sure all important DOM elements are available
        if (!gameContainer) {
            console.error("gameContainer element not found in DOM");
            return;
        }
        
        if (!mainWrapper) {
            console.error("mainWrapper element not found in DOM");
            return;
        }
        
        if (!opponentGamesContainer) {
            console.error("opponentGamesContainer element not found in DOM");
            return;
        }
        
        // Ensure all game variables are properly initialized
        ensureGameVariablesInitialized();
        
        if (!data.gameState) {
            console.error("startGame event received without gameState!", data);
            errorMessageDiv.textContent = "Error starting game: Missing game state from server.";
            showLobby(); // Go back to lobby if critical data is missing
            return;
        }

        localPlayerId = data.localPlayerId; // Correctly set localPlayerId from server data
        currentRoomId = data.roomId; // Store current room ID

        // playersInGame will be populated by 'opponentStatesUpdate' later for mini-views.
        // For now, clear it or initialize as empty if it's used elsewhere immediately.
        playersInGame = {}; 

        // Apply initial game state for the local player from data.gameState
        balls = data.gameState.balls || [];
        try {
            clientBricks = data.gameState.bricks ? mapServerBricksToClient(data.gameState.bricks) : [];
        } catch (error) {
            console.error("Error mapping server bricks to client:", error);
            clientBricks = [];
        }
        
        score = data.gameState.score || 0; // Score is now a direct number
        lives = data.gameState.lives !== undefined ? data.gameState.lives : 3; // Lives is a direct number
        currentMapName = data.gameState.mapName || 'LEVEL_1';

        // Initialize local player's paddle state from gameState.paddle
        if (data.gameState.paddle) {
            paddleX = data.gameState.paddle.x;
            PADDLE_WIDTH = data.gameState.paddle.width;
            localPaddleY_server = data.gameState.paddle.y;
            localPaddleHeight_server = data.gameState.paddle.height;
        } else {
            console.error("CRITICAL: paddle data missing in startGame event from server.");
            // Fallback to some default server-space values if absolutely necessary,
            // though server should always provide this.
            const defaultServerWidth = 800;
            const defaultServerHeight = 600;
            PADDLE_WIDTH = defaultServerWidth * 0.15;
            paddleX = defaultServerWidth / 2 - PADDLE_WIDTH / 2;
            localPaddleHeight_server = defaultServerHeight * 0.03;
            localPaddleY_server = defaultServerHeight - localPaddleHeight_server - (defaultServerHeight * 0.05);
        }
        
        updateUIDisplay();
        showGame(); // This should call initGame() which recalculates some parameters
        // gameLoop() is already started by requestAnimationFrame in the global scope after init
    } catch (error) {
        console.error("Error in startGame handler:", error);
        errorMessageDiv.textContent = "Error starting game: " + error.message;
    }
});

// Handler for opponent paddle movements
socket.on('opponentPaddleMove', (data) => {
    if (playersInGame[data.playerId] && data.playerId !== localPlayerId) {
        playersInGame[data.playerId].x = data.x;
    }
});

// NEW: Handler for game state updates from server
socket.on('gameStateUpdate', (gameState) => {
    if (!localPlayerId || gameContainer.style.display === 'none') return; // Only update if in game

    // Ensure all required variables exist
    ensureGameVariablesInitialized();

    // Update balls for local player
    balls = gameState.balls || [];

    // Update local player's paddle
    if (gameState.paddle) {
        paddleX = gameState.paddle.x;
        PADDLE_WIDTH = gameState.paddle.width;
        localPaddleY_server = gameState.paddle.y;
        localPaddleHeight_server = gameState.paddle.height;
    }

    // Update scores for local player
    if (gameState.score !== undefined) {
        score = gameState.score;
    }

    // Update lives for local player
    if (gameState.lives !== undefined) {
        lives = gameState.lives;
    }
    updateUIDisplay();

    // Update clientBricks for local player based on server's brick data
    if (gameState.bricks) {
        try {
            clientBricks = mapServerBricksToClient(gameState.bricks);
        } catch (error) {
            console.error("Error mapping bricks from server:", error);
            clientBricks = []; // Reset to empty array in case of error
        }
    }

    // Update active power-ups for local player
    if (gameState.activePowerUps) {
        clientActivePowerUps = gameState.activePowerUps;
    }

    // Update shield status for local player
    if (gameState.shieldActive !== undefined) {
        shieldActive = gameState.shieldActive; // shieldActive is already a global let
    }

    // Play sounds based on state changes from server
    if (gameState.soundToPlay) {
        console.log("Client received soundToPlay:", gameState.soundToPlay);
        switch(gameState.soundToPlay.type) {
            case 'brick_break': playSound(soundBrickBreak); break;
            case 'paddle_hit': playSound(soundPaddleHit); break;
            case 'powerup_collect': playSound(soundPowerupCollect); break;
            // Add other cases as needed
        }
    }
    // Example: if lives decreased, play a sound (or server sends specific event for life lost)
    // This needs careful management to avoid playing sounds too often or at wrong times.
    // It's often better if server explicitly signals when to play important sounds.

    if (gameState.gameOver) {
        // Handle game over for local player - server might also send a separate 'gameOver' event
        // alert("Game Over! Your final score: " + score);
        playSound(soundGameOver); // Play game over sound
        // showLobby(); // Or a specific game over screen
    }
});

socket.on('opponentStatesUpdate', (opponentStates) => {
    try {
        console.log("Received opponentStatesUpdate", { 
            opponentStatesCount: Object.keys(opponentStates).length,
            gameContainerDisplay: gameContainer.style.display,
            opponentCanvasesDefined: typeof opponentCanvases !== 'undefined'
        });
        
        if (gameContainer.style.display === 'none') return;

        // Ensure all variables are initialized
        ensureGameVariablesInitialized();

        const activeOpponentIds = Object.keys(opponentStates);

        // Remove stale opponent displays
        for (const playerId in playersInGame) {
            if (!activeOpponentIds.includes(playerId)) {
                if (opponentCanvases[playerId]) {
                    opponentCanvases[playerId].containerDiv.remove(); // Remove the whole container
                    delete opponentCanvases[playerId];
                }
                delete playersInGame[playerId];
            }
        }

        for (const opponentId in opponentStates) { // Renamed to opponentId for clarity
            if (opponentId === localPlayerId) continue; 

            const opponentData = opponentStates[opponentId];
            
            // Make sure we have valid brick data to prevent errors
            const bricksData = opponentData.bricks || [];
            
            playersInGame[opponentId] = { 
                name: opponentData.name || 'Opponent',
                score: opponentData.score || 0,
                lives: opponentData.lives !== undefined ? opponentData.lives : 0,
                paddle: opponentData.paddle, // Store the full paddle object
                balls: opponentData.balls || [],
                bricks: bricksData,
                gameOver: opponentData.gameOver || false,
                sourceGameWidth: opponentData.gameWidth || 800, // Store source dimensions
                sourceGameHeight: opponentData.gameHeight || 600,
                activePowerUps: opponentData.activePowerUps || [], // Opponent powerups
                shieldActive: opponentData.shieldActive || false // Opponent shield status
            };

            if (!opponentCanvases[opponentId]) {
                // Check if opponent games container exists
                if (!opponentGamesContainer) {
                    console.error("opponentGamesContainer not found in DOM");
                    continue; // Skip this opponent
                }
                
                const opponentContainerDiv = document.createElement('div');
                opponentContainerDiv.className = 'opponent-view';
                opponentContainerDiv.style.cursor = 'pointer'; // Add pointer cursor to show it's clickable
                
                const nameDiv = document.createElement('div');
                nameDiv.className = 'opponent-name';
                
                const canvasElement = document.createElement('canvas');
                canvasElement.id = `opponentCanvas_${opponentId}`;

                opponentContainerDiv.appendChild(nameDiv);
                opponentContainerDiv.appendChild(canvasElement);
                opponentGamesContainer.appendChild(opponentContainerDiv); // Add to DOM first

                // Set canvas dimensions after it's in the DOM and styled by CSS
                // .opponent-view canvas has width: 100% of .opponent-view
                // .opponent-view has padding, and its parent #opponent-games-container has a fixed/max width.
                const opViewPadding = parseFloat(getComputedStyle(opponentContainerDiv).paddingLeft) + parseFloat(getComputedStyle(opponentContainerDiv).paddingRight);
                const availableWidthForCanvas = opponentContainerDiv.clientWidth - opViewPadding;
                canvasElement.width = availableWidthForCanvas;
                canvasElement.height = Math.floor(availableWidthForCanvas * (9 / 16)); // Enforce 16:9 aspect ratio

                opponentCanvases[opponentId] = {
                    canvas: canvasElement,
                    ctx: canvasElement.getContext('2d'),
                    nameDiv: nameDiv,
                    containerDiv: opponentContainerDiv
                };
                
                // Add click event to switch to spectator mode
                opponentContainerDiv.addEventListener('click', () => {
                    spectatePlayer(opponentId);
                });
            }

            // Make sure the display object exists
            if (!opponentCanvases[opponentId]) {
                console.error(`opponentCanvases[${opponentId}] is null or undefined`);
                continue; // Skip this opponent
            }

            const display = opponentCanvases[opponentId];
            const miniCtx = display.ctx;
            const miniCanvas = display.canvas;
            const opState = playersInGame[opponentId];

            display.nameDiv.textContent = `${opState.name} - S: ${opState.score}, L: ${opState.lives}`;
            if (opState.gameOver) {
                display.nameDiv.textContent += " (GAME OVER)";
                miniCanvas.style.opacity = '0.5';
            } else {
                miniCanvas.style.opacity = '1';
            }
            
            miniCtx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
            miniCtx.fillStyle = '#2a2a2a'; // Background for mini canvas
            miniCtx.fillRect(0, 0, miniCanvas.width, miniCanvas.height);

            // Draw opponent's elements using generalized functions
            if (opState.paddle) {
                // Opponent paddle color - can be made unique later
                drawPaddle(miniCtx, opState.paddle, '#FF69B4', miniCanvas.width, miniCanvas.height, opState.sourceGameWidth, opState.sourceGameHeight);
            }
            if (opState.balls) {
                drawBalls(miniCtx, opState.balls, '#f0f', miniCanvas.width, miniCanvas.height, opState.sourceGameWidth, opState.sourceGameHeight);
            }
            if (opState.bricks) {
                // The bricks already have types and health, mapServerBricksToClient is not strictly needed here
                // if getBrickColor can handle the server's brick structure.
                // We can use a simplified color mapping or pass full brick object to drawBricks.
                // drawBricks function now uses getBrickColor which expects server brick structure.
                drawBricks(miniCtx, opState.bricks, miniCanvas.width, miniCanvas.height, opState.sourceGameWidth, opState.sourceGameHeight);
            }
            // Draw opponent's power-ups
            if (opState.activePowerUps) {
                drawClientPowerUps(miniCtx, opState.activePowerUps, miniCanvas.width, miniCanvas.height, opState.sourceGameWidth, opState.sourceGameHeight);
            }
        }
    } catch (error) {
        console.error("Error in opponentStatesUpdate handler:", error);
    }
});

socket.on('gameOver', (data) => {
    // Update local game state to reflect game over
    console.log(`Game over for local player. Score: ${data.score}`, data);
    
    // Mark the player's game as over but don't return to lobby immediately
    if (localPlayerId) {
        // Update UI to show game over status without hiding the game
        const gameOverDiv = document.createElement('div');
        gameOverDiv.id = 'game-over-message';
        gameOverDiv.innerHTML = `
            <h2>Game Over!</h2>
            <p>Your Score: ${data.score}</p>
            <p>${data.message || ''}</p>
            <p>You can now watch other players or wait for everyone to finish.</p>
        `;
        gameOverDiv.style.position = 'absolute';
        gameOverDiv.style.top = '50%';
        gameOverDiv.style.left = '50%';
        gameOverDiv.style.transform = 'translate(-50%, -50%)';
        gameOverDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        gameOverDiv.style.color = '#fff';
        gameOverDiv.style.padding = '20px';
        gameOverDiv.style.borderRadius = '10px';
        gameOverDiv.style.textAlign = 'center';
        gameOverDiv.style.zIndex = '10';
        gameOverDiv.style.boxShadow = '0 0 20px #f0f, 0 0 10px #0ff inset';
        gameOverDiv.style.border = '2px solid #0ff';
        gameOverDiv.style.textShadow = '0 0 5px #0ff';
        
        // Add a close button
        const closeButton = document.createElement('button');
        closeButton.textContent = 'Close';
        closeButton.style.marginTop = '10px';
        closeButton.style.padding = '5px 15px';
        closeButton.style.background = '#0af';
        closeButton.style.border = 'none';
        closeButton.style.borderRadius = '5px';
        closeButton.style.color = '#fff';
        closeButton.style.cursor = 'pointer';
        closeButton.onclick = () => {
            gameOverDiv.remove();
        };
        gameOverDiv.appendChild(closeButton);
        
        gameContainer.appendChild(gameOverDiv);
    }
});

// New event for when all players have finished their games
socket.on('allPlayersFinished', (data) => {
    console.log('All players have finished the game', data);
    
    // Display final scoreboard
    showFinalScoreboard(data.scores);
});

// Function to show the final scoreboard
function showFinalScoreboard(scores) {
    // Clear any existing game over message
    const existingMessage = document.getElementById('game-over-message');
    if (existingMessage) {
        existingMessage.remove();
    }
    
    // Create scoreboard overlay
    const scoreboardDiv = document.createElement('div');
    scoreboardDiv.id = 'final-scoreboard';
    scoreboardDiv.style.position = 'absolute';
    scoreboardDiv.style.top = '50%';
    scoreboardDiv.style.left = '50%';
    scoreboardDiv.style.transform = 'translate(-50%, -50%)';
    scoreboardDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
    scoreboardDiv.style.color = '#fff';
    scoreboardDiv.style.padding = '20px';
    scoreboardDiv.style.borderRadius = '10px';
    scoreboardDiv.style.textAlign = 'center';
    scoreboardDiv.style.zIndex = '20';
    scoreboardDiv.style.minWidth = '300px';
    scoreboardDiv.style.boxShadow = '0 0 30px #f0f, 0 0 15px #0ff inset';
    scoreboardDiv.style.border = '3px solid #0ff';
    
    // Create scoreboard content
    let scoreboardHTML = '<h2 style="color:#0ff;text-shadow:0 0 10px #0ff;">Final Scores</h2>';
    scoreboardHTML += '<table style="width:100%;margin-top:15px;">';
    scoreboardHTML += '<tr><th style="padding:5px;border-bottom:1px solid #0ff;">Player</th><th style="padding:5px;border-bottom:1px solid #0ff;">Score</th><th style="padding:5px;border-bottom:1px solid #0ff;">Lives Left</th></tr>';
    
    // Sort scores from highest to lowest
    const sortedScores = Object.entries(scores).sort((a, b) => b[1].score - a[1].score);
    
    sortedScores.forEach(([playerId, playerData]) => {
        const isLocalPlayer = playerId === localPlayerId;
        const highlightStyle = isLocalPlayer ? 'background-color:rgba(0,255,255,0.2);font-weight:bold;' : '';
        
        scoreboardHTML += `<tr style="${highlightStyle}">`;
        scoreboardHTML += `<td style="padding:5px;">${playerData.name || 'Unknown'}</td>`;
        scoreboardHTML += `<td style="padding:5px;">${playerData.score}</td>`;
        scoreboardHTML += `<td style="padding:5px;">${playerData.lives}</td>`;
        scoreboardHTML += '</tr>';
    });
    
    scoreboardHTML += '</table>';
    
    // Add return to lobby button
    scoreboardHTML += '<button id="return-to-lobby-btn" style="margin-top:20px;padding:8px 20px;background:#0af;border:none;border-radius:5px;color:#fff;cursor:pointer;">Return to Lobby</button>';
    
    scoreboardDiv.innerHTML = scoreboardHTML;
    
    // Append to game container
    gameContainer.appendChild(scoreboardDiv);
    
    // Add event listener to return to lobby button
    document.getElementById('return-to-lobby-btn').addEventListener('click', () => {
        scoreboardDiv.remove();
        showLobby();
    });
}

// Variable to track the currently spectated player
let currentlySpectatingPlayerId = null;

// Function to ensure all game variables are initialized
function ensureGameVariablesInitialized() {
    // Use window to check for global variables
    if (typeof balls === 'undefined') window.balls = [];
    if (typeof clientBricks === 'undefined') window.clientBricks = [];
    if (typeof particles === 'undefined') window.particles = [];
    if (typeof playersInGame === 'undefined') window.playersInGame = {};
    
    // Ensure the element exists in the DOM
    if (!opponentGamesContainer) {
        console.warn("Opponent games container not found in DOM");
    }
    
    // Make sure opponentCanvases is initialized
    if (typeof opponentCanvases === 'undefined') {
        window.opponentCanvases = {};
    }
    
    // Initialize other required variables
    if (typeof PADDLE_WIDTH === 'undefined') window.PADDLE_WIDTH = 120;
    if (typeof PADDLE_HEIGHT === 'undefined') window.PADDLE_HEIGHT = 15;
    if (typeof BALL_RADIUS === 'undefined') window.BALL_RADIUS = 8;
}

// Function to switch to spectator mode for a specific player
function spectatePlayer(playerId) {
    if (!playersInGame[playerId]) return;
    
    // Make sure all variables are initialized
    ensureGameVariablesInitialized();
    
    // Update the currently spectated player
    currentlySpectatingPlayerId = playerId;
    
    // Add visual indicator to show which player is being spectated
    for (const id in opponentCanvases) {
        const container = opponentCanvases[id].containerDiv;
        if (id === playerId) {
            container.style.border = '2px solid #f0f';
            container.style.boxShadow = '0 0 10px #f0f';
        } else {
            container.style.border = '1px solid #077';
            container.style.boxShadow = 'none';
        }
    }
    
    // Update UI to show spectator mode
    updateSpectatorUI(playerId);
}

// Function to update the UI to show spectator mode
function updateSpectatorUI(playerId) {
    const playerData = playersInGame[playerId];
    if (!playerData) {
        // If player data is gone for the spectated player, exit spectator mode
        if (currentlySpectatingPlayerId === playerId) {
            exitSpectatorMode();
        }
        return;
    }

    let overlay = document.getElementById('spectator-overlay');
    let infoSpan; // Will hold the span for dynamic text

    if (!overlay) {
        // If overlay doesn't exist, create it and all its static children (info span, buttons)
        overlay = document.createElement('div');
        overlay.id = 'spectator-overlay';
        overlay.style.position = 'absolute';
        overlay.style.top = '10px';
        overlay.style.left = '10px';
        overlay.style.padding = '5px 10px';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        overlay.style.color = '#fff';
        overlay.style.borderRadius = '5px';
        overlay.style.zIndex = '5';
        overlay.style.fontSize = '14px';
        overlay.style.boxShadow = '0 0 10px #f0f';
        overlay.style.border = '1px solid #f0f';

        // Create span for the dynamic text
        infoSpan = document.createElement('span');
        infoSpan.id = 'spectator-info-span'; // Give it an ID for easy access later
        overlay.appendChild(infoSpan);

        // Create container for controls
        const controlsDiv = document.createElement('div');
        controlsDiv.style.marginTop = '5px';
        controlsDiv.style.display = 'flex';
        controlsDiv.style.gap = '10px';

        // Exit spectator button
        const exitButton = document.createElement('button');
        exitButton.textContent = 'Stop Spectating';
        exitButton.style.padding = '2px 5px';
        exitButton.style.backgroundColor = '#f00';
        exitButton.style.border = 'none';
        exitButton.style.borderRadius = '3px';
        exitButton.style.color = '#fff';
        exitButton.style.cursor = 'pointer';
        exitButton.onclick = () => {
            exitSpectatorMode();
        };
        controlsDiv.appendChild(exitButton);

        // Return to lobby button
        const lobbyButton = document.createElement('button');
        lobbyButton.textContent = 'Return to Lobby';
        lobbyButton.style.padding = '2px 5px';
        lobbyButton.style.backgroundColor = '#0af';
        lobbyButton.style.border = 'none';
        lobbyButton.style.borderRadius = '3px';
        lobbyButton.style.color = '#fff';
        lobbyButton.style.cursor = 'pointer';
        lobbyButton.onclick = () => {
            exitSpectatorMode(); // Ensure spectator mode is exited
            showLobby();
        };
        controlsDiv.appendChild(lobbyButton);

        overlay.appendChild(controlsDiv);
        
        // Append the fully constructed overlay to the game container
        if (gameContainer) {
            gameContainer.appendChild(overlay);
        } else {
            console.error("gameContainer not found when trying to append spectator overlay.");
            return; // Cannot proceed if gameContainer is missing
        }
    } else {
        // Overlay exists, just find the infoSpan within it
        infoSpan = document.getElementById('spectator-info-span');
    }

    // Always update the text content in infoSpan
    if (infoSpan) { // Check if infoSpan was found/created
        infoSpan.textContent = `Spectating: ${playerData.name} - Score: ${playerData.score} - Lives: ${playerData.lives} `;
    }
    
    // Ensure overlay is visible (it should be if this function is called from drawGame or spectatePlayer)
    if (overlay) {
        overlay.style.display = 'block';
    }
}

// Function to exit spectator mode
function exitSpectatorMode() {
    currentlySpectatingPlayerId = null;
    
    // Remove spectator overlay
    const spectatorOverlay = document.getElementById('spectator-overlay');
    if (spectatorOverlay) {
        spectatorOverlay.remove(); // This removes it from the DOM.
    }
    
    // Reset opponent container styling
    for (const id in opponentCanvases) {
        if (opponentCanvases[id] && opponentCanvases[id].containerDiv) { // Added safety checks
            const container = opponentCanvases[id].containerDiv;
            container.style.border = '1px solid #077';
            container.style.boxShadow = 'none';
        }
    }
}

// Helper to map server brick data to what client might need for drawing (if different)
// This function is used for the main player's bricks in `gameStateUpdate`.
// For opponent bricks, we are directly using server brick structure with `getBrickColor`.
function mapServerBricksToClient(serverBricks) {
    if (!serverBricks || !Array.isArray(serverBricks)) {
        console.warn("Invalid serverBricks data:", serverBricks);
        return [];
    }
    
    return serverBricks.map(sb => {
        let color = BRICK_COLORS.STANDARD;
        if (sb.type === 9) color = BRICK_COLORS.UNBREAKABLE;
        else if (sb.type === 2) {
            if (sb.health === 2) color = BRICK_COLORS.STRONG_2;
            else if (sb.health === 1) color = BRICK_COLORS.STRONG_1;
        }
        return {
            ...sb, // Includes id, x, y, width, height, status, type, health from server
            color: color // Client determines color based on type and health
        };
    });
}

socket.on('levelClear', (data) => { // Assuming server will send this event
    console.log('Level Cleared:', data.message);
    playSound(soundLevelClear);
    // Display message, wait for server to send next level or game end state
});