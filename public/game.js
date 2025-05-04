
// Game Client Code
document.addEventListener('DOMContentLoaded', function () {
    // DOM Elements
    const menuScreen = document.getElementById('menu-screen');
    const lobbyScreen = document.getElementById('lobby-screen');
    const gameScreen = document.getElementById('game-screen');
    const endScreen = document.getElementById('end-screen');

    const playerNameInput = document.getElementById('player-name');
    const createGameBtn = document.getElementById('create-game-btn');
    const gameCodeInput = document.getElementById('game-code-input');
    const joinGameBtn = document.getElementById('join-game-btn');

    const gameCodeDisplay = document.getElementById('game-code-display');
    const player1El = document.getElementById('player1');
    const player2El = document.getElementById('player2');
    const lobbyStatusEl = document.getElementById('lobby-status');
    const startGameBtn = document.getElementById('start-game-btn');
    const leaveLobbyBtn = document.getElementById('leave-lobby-btn');

    const player1NameEl = document.getElementById('player1-name');
    const player2NameEl = document.getElementById('player2-name');
    const player1ScoreEl = document.getElementById('player1-score');
    const player2ScoreEl = document.getElementById('player2-score');
    const gameStateEl = document.getElementById('game-state');

    const gameCanvas = document.getElementById('game-canvas');
    const ctx = gameCanvas.getContext('2d');

    const leftBtn = document.getElementById('left-btn');
    const rightBtn = document.getElementById('right-btn');
    const actionBtn = document.getElementById('action-btn');

    const winnerDisplayEl = document.getElementById('winner-display');
    const finalScoreEl = document.getElementById('final-score');
    const playAgainBtn = document.getElementById('play-again-btn');
    const returnMenuBtn = document.getElementById('return-menu-btn');

    // Game variables
    let socket;
    let gameId = null;
    let playerId = null;
    let playerName = '';
    let isHost = false;
    let gameActive = false;
    let lastFrameTime = 0;
    let gameState = null;
    let keysPressed = {
        left: false,
        right: false,
        action: false
    };

    // Game constants
    const CANVAS_WIDTH = 800;
    const CANVAS_HEIGHT = 500;

    // Connect to server
    function connectToServer() {
        try {
            // Check if Socket.IO is available
            if (typeof io === 'undefined') {
                showError('Socket.IO is not loaded. Please run the game via a server.');
                return;
            }

            socket = io();

            // Set up socket event listeners
            socket.on('connect', () => {
                console.log('Connected to server');
            });

            socket.on('gameCreated', handleGameCreated);
            socket.on('joinedGame', handleJoinedGame);
            socket.on('playerJoined', handlePlayerJoined);
            socket.on('playerLeft', handlePlayerLeft);
            socket.on('gameStarted', handleGameStarted);
            socket.on('gameState', handleGameState);
            socket.on('gameOver', handleGameOver);
            socket.on('error', handleError);
        } catch (err) {
            showError('Failed to connect to server. Please run the game via a server.');
        }
    }

    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'server-info';
        errorDiv.innerHTML = `<h2>Server Connection Error</h2>
        <p>${message}</p>
        <div class="server-instructions">
          <h3>How to run the game:</h3>
          <ol>
            <li>Make sure Node.js is installed</li>
            <li>Open terminal/command prompt</li>
            <li>Navigate to the game directory</li>
            <li>Run <code>node server.js</code></li>
            <li>Open <a href="http://localhost:3000">http://localhost:3000</a> in your browser</li>
          </ol>
        </div>`;

        document.body.appendChild(errorDiv);
    }

    // Event handlers for socket events
    function handleGameCreated(data) {
        gameId = data.gameId;
        playerId = data.playerId;
        isHost = true;

        gameCodeDisplay.textContent = gameId;
        player1El.textContent = playerName + ' (You)';

        showScreen(lobbyScreen);
    }

    function handleJoinedGame(data) {
        gameId = data.gameId;
        playerId = data.playerId;

        const players = data.players;
        updatePlayerList(players);

        gameCodeDisplay.textContent = gameId;
        showScreen(lobbyScreen);
    }

    function handlePlayerJoined(data) {
        updatePlayerList(data.players);

        if (data.players.length >= 2 && isHost) {
            startGameBtn.disabled = false;
            lobbyStatusEl.textContent = 'Ready to start game';
        }
    }

    function handlePlayerLeft(data) {
        updatePlayerList(data.players);

        if (data.players.length < 2 && isHost) {
            startGameBtn.disabled = true;
            lobbyStatusEl.textContent = 'Waiting for players...';
        }
    }

    function handleGameStarted() {
        // Set up canvas and game loop
        resizeCanvas();
        gameActive = true;
        showScreen(gameScreen);

        // Update button label to reflect jumping
        actionBtn.textContent = 'Jump';

        // Reset hit counters
        document.getElementById('player1-hits').textContent = '0';
        document.getElementById('player2-hits').textContent = '0';

        requestAnimationFrame(gameLoop);
    }

    function handleGameState(state) {
        gameState = state;

        // Update UI elements
        player1NameEl.textContent = state.players[0]?.name || 'Player 1';
        player2NameEl.textContent = state.players[1]?.name || 'Player 2';
        player1ScoreEl.textContent = `${state.score[0].points} (${state.score[0].games}-${state.score[0].sets})`;
        player2ScoreEl.textContent = `${state.score[1].points} (${state.score[1].games}-${state.score[1].sets})`;

        // Update hit counters
        document.getElementById('player1-hits').textContent = state.hitCounts ? state.hitCounts[0] : 0;
        document.getElementById('player2-hits').textContent = state.hitCounts ? state.hitCounts[1] : 0;

        gameStateEl.textContent = state.message || 'Playing';
    }

    function handleGameOver(data) {
        gameActive = false;

        winnerDisplayEl.textContent = `${data.winner.name} wins!`;
        finalScoreEl.textContent = `Final Score: ${data.score[0].games}-${data.score[1].games}`;

        // Display hit counts if available
        if (data.hitCounts) {
            const hitCountsEl = document.createElement('p');
            hitCountsEl.textContent = `Total Hits: ${data.hitCounts[0]} vs ${data.hitCounts[1]}`;
            hitCountsEl.className = 'hit-stats';

            // Remove any previous hit counts display
            const oldHitStats = endScreen.querySelector('.hit-stats');
            if (oldHitStats) {
                oldHitStats.remove();
            }

            // Insert hit counts before the buttons
            finalScoreEl.insertAdjacentElement('afterend', hitCountsEl);
        }

        showScreen(endScreen);
    }

    function handleError(data) {
        alert(data.message);
    }

    // Helper functions
    function showScreen(screen) {
        menuScreen.classList.add('hidden');
        lobbyScreen.classList.add('hidden');
        gameScreen.classList.add('hidden');
        endScreen.classList.add('hidden');

        screen.classList.remove('hidden');
    }

    function updatePlayerList(players) {
        if (players.length > 0) {
            const player1 = players[0];
            player1El.textContent = player1.id === playerId ?
                `${player1.name} (You)` : player1.name;
        } else {
            player1El.textContent = 'Waiting for player 1...';
        }

        if (players.length > 1) {
            const player2 = players[1];
            player2El.textContent = player2.id === playerId ?
                `${player2.name} (You)` : player2.name;
        } else {
            player2El.textContent = 'Waiting for player 2...';
        }
    }

    function resizeCanvas() {
        const container = gameCanvas.parentElement;
        const containerWidth = container.clientWidth;
        const containerHeight = container.clientHeight - 100; // Adjust for scoreboard and controls

        gameCanvas.width = CANVAS_WIDTH;
        gameCanvas.height = CANVAS_HEIGHT;

        // Set CSS dimensions to fit the container
        gameCanvas.style.width = '100%';
        gameCanvas.style.height = `${containerHeight}px`;
    }

    function gameLoop(timestamp) {
        if (!gameActive) return;

        const deltaTime = timestamp - lastFrameTime;
        lastFrameTime = timestamp;

        // Send player input to server
        if (keysPressed.left || keysPressed.right || keysPressed.action) {
            socket.emit('playerInput', {
                left: keysPressed.left,
                right: keysPressed.right,
                action: keysPressed.action
            });
        }

        // Render game state
        renderGame();

        requestAnimationFrame(gameLoop);
    }

    function renderGame() {
        if (!gameState) return;

        // Clear canvas
        ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

        // Draw court
        drawCourt();

        // Draw players
        drawPlayers();

        // Draw ball
        drawBall();
    }

    function drawCourt() {
        if (!gameState) return;

        // Draw court background
        ctx.fillStyle = '#3c7a3c';
        ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

        // Draw court lines
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;

        // Draw court boundary
        ctx.strokeRect(20, 20, gameCanvas.width - 40, gameCanvas.height - 40);

        // Draw net
        ctx.beginPath();
        ctx.moveTo(gameCanvas.width / 2, 20);
        ctx.lineTo(gameCanvas.width / 2, gameCanvas.height - 20);
        ctx.stroke();

        // Draw service lines
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.moveTo(20, gameCanvas.height / 3);
        ctx.lineTo(gameCanvas.width - 20, gameCanvas.height / 3);
        ctx.moveTo(20, (gameCanvas.height / 3) * 2);
        ctx.lineTo(gameCanvas.width - 20, (gameCanvas.height / 3) * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw walls (transparent)
        ctx.fillStyle = 'rgba(200, 200, 200, 0.2)';

        // Left wall
        ctx.fillRect(0, 0, 20, gameCanvas.height);

        // Right wall
        ctx.fillRect(gameCanvas.width - 20, 0, 20, gameCanvas.height);

        // Back walls
        ctx.fillRect(20, 0, gameCanvas.width - 40, 20);
        ctx.fillRect(20, gameCanvas.height - 20, gameCanvas.width - 40, 20);
    }

    function drawPlayers() {
        if (!gameState || !gameState.players) return;

        gameState.players.forEach((player, index) => {
            // Choose color based on player side
            ctx.fillStyle = index === 0 ? '#ff6347' : '#4169e1';

            // Draw player
            ctx.fillRect(player.x, player.y, player.width, player.height);

            // Draw player name above
            ctx.fillStyle = '#fff';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(player.name, player.x + player.width / 2, player.y - 15);

            // Draw jumping animation if player is jumping
            if (player.isJumping) {
                // Draw jump effect
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.beginPath();
                ctx.moveTo(player.x, player.y + player.height);
                ctx.lineTo(player.x + player.width / 2, player.y + player.height + 10);
                ctx.lineTo(player.x + player.width, player.y + player.height);
                ctx.fill();
            }

            // Update individual player hit count in UI
            if (player.hits !== undefined) {
                const hitCountEl = document.getElementById(index === 0 ? 'player1-hits' : 'player2-hits');
                if (hitCountEl) {
                    hitCountEl.textContent = player.hits;
                }
            }
        });
    }

    function drawBall() {
        if (!gameState || !gameState.ball) return;

        const ball = gameState.ball;

        // Draw ball shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(
            ball.x, ball.y + ball.radius * 0.9,
            ball.radius * 0.8, ball.radius * 0.3,
            0, 0, Math.PI * 2
        );
        ctx.fill();

        // Draw ball
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
        ctx.fill();

        // Draw ball details (makes it look more like a tennis ball)
        ctx.strokeStyle = '#ddd';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.radius * 0.7, 0, Math.PI * 2);
        ctx.stroke();
    }

    // Button event handlers
    createGameBtn.addEventListener('click', () => {
        playerName = playerNameInput.value.trim() || 'Player';
        if (socket) {
            socket.emit('createGame', { playerName });
        }
    });

    joinGameBtn.addEventListener('click', () => {
        playerName = playerNameInput.value.trim() || 'Player';
        const code = gameCodeInput.value.trim().toUpperCase();

        if (code && socket) {
            socket.emit('joinGame', {
                gameId: code,
                playerName
            });
        }
    });

    startGameBtn.addEventListener('click', () => {
        if (socket) {
            socket.emit('startGame', { gameId });
        }
    });

    leaveLobbyBtn.addEventListener('click', () => {
        if (socket) {
            socket.emit('leaveGame', { gameId });
            showScreen(menuScreen);
        }
    });

    playAgainBtn.addEventListener('click', () => {
        if (socket) {
            if (isHost) {
                socket.emit('restartGame', { gameId });
            } else {
                socket.emit('joinGame', { gameId, playerName });
            }
        }
    });

    returnMenuBtn.addEventListener('click', () => {
        if (socket) {
            socket.emit('leaveGame', { gameId });
            showScreen(menuScreen);
        }
    });

    // Touch controls
    leftBtn.addEventListener('touchstart', () => { keysPressed.left = true; });
    leftBtn.addEventListener('touchend', () => { keysPressed.left = false; });

    rightBtn.addEventListener('touchstart', () => { keysPressed.right = true; });
    rightBtn.addEventListener('touchend', () => { keysPressed.right = false; });

    actionBtn.addEventListener('touchstart', () => { keysPressed.action = true; });
    actionBtn.addEventListener('touchend', () => { keysPressed.action = false; });

    // Mouse controls for buttons
    leftBtn.addEventListener('mousedown', () => { keysPressed.left = true; });
    leftBtn.addEventListener('mouseup', () => { keysPressed.left = false; });
    leftBtn.addEventListener('mouseleave', () => { keysPressed.left = false; });

    rightBtn.addEventListener('mousedown', () => { keysPressed.right = true; });
    rightBtn.addEventListener('mouseup', () => { keysPressed.right = false; });
    rightBtn.addEventListener('mouseleave', () => { keysPressed.right = false; });

    actionBtn.addEventListener('mousedown', () => { keysPressed.action = true; });
    actionBtn.addEventListener('mouseup', () => { keysPressed.action = false; });
    actionBtn.addEventListener('mouseleave', () => { keysPressed.action = false; });

    // Keyboard controls
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'a') keysPressed.left = true;
        if (e.key === 'ArrowRight' || e.key === 'd') keysPressed.right = true;
        if (e.key === ' ' || e.key === 'w' || e.key === 'ArrowUp') keysPressed.action = true;
    });

    document.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'a') keysPressed.left = false;
        if (e.key === 'ArrowRight' || e.key === 'd') keysPressed.right = false;
        if (e.key === ' ' || e.key === 'w' || e.key === 'ArrowUp') keysPressed.action = false;
    });

    // Window resize handler
    window.addEventListener('resize', resizeCanvas);

    // Initialize
    connectToServer();
    showScreen(menuScreen);
});
