const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Create the Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Game rooms and state
const games = new Map();

// Game constants
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 60;
const BALL_RADIUS = 10;
const PLAYER_SPEED = 5;
const PLAYER_JUMP_FORCE = 12;
const BALL_SPEED = 7;
const GRAVITY = 0.3;
const BOUNCE_FACTOR = 0.8;

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  // Create a new game room
  socket.on('createGame', (data) => {
    const gameId = generateGameId();
    const player = {
      id: socket.id,
      name: data.playerName || 'Player 1',
      x: CANVAS_WIDTH / 4,
      y: CANVAS_HEIGHT - PLAYER_HEIGHT - 20,
      width: PLAYER_WIDTH,
      height: PLAYER_HEIGHT,
      speed: PLAYER_SPEED,
      velocityY: 0,
      isJumping: false,
      side: 0, // Left side
      hits: 0 // Add hit counter for player
    };
    
    // Create game room
    games.set(gameId, {
      id: gameId,
      players: [player],
      spectators: [],
      ball: createBall(),
      score: [
        { points: 0, games: 0, sets: 0 },
        { points: 0, games: 0, sets: 0 }
      ],
      hitCounts: [0, 0], // Add hit counters for each side
      isActive: false,
      servingSide: 0,
      message: 'Waiting for players',
      lastUpdateTime: Date.now(),
      lastHitBy: null, // Track the ID of the player who last hit the ball
      doubleHitDetected: false // Flag to track if a double hit occurred
    });
    
    // Join socket to the game room
    socket.join(gameId);
    
    // Send game created confirmation
    socket.emit('gameCreated', {
      gameId,
      playerId: socket.id
    });
    
    console.log(`Game created: ${gameId} by player ${socket.id}`);
  });
  
  // Join an existing game
  socket.on('joinGame', (data) => {
    const { gameId, playerName } = data;
    
    if (!games.has(gameId)) {
      socket.emit('error', { message: 'Game not found.' });
      return;
    }
    
    const game = games.get(gameId);
    
    if (game.players.length >= 2 && !game.players.some(p => p.id === socket.id)) {
      // Join as spectator
      const spectator = {
        id: socket.id,
        name: playerName || 'Spectator'
      };
      
      game.spectators.push(spectator);
      socket.join(gameId);
      
      socket.emit('joinedGame', {
        gameId,
        playerId: socket.id,
        players: game.players,
        asSpectator: true
      });
      
      return;
    }
    
    // Check if player is rejoining
    const existingPlayerIndex = game.players.findIndex(p => p.id === socket.id);
    
    if (existingPlayerIndex !== -1) {
      // Player is rejoining, update their name if provided
      if (playerName) {
        game.players[existingPlayerIndex].name = playerName;
      }
    } else {
      // New player joining
      const player = {
        id: socket.id,
        name: playerName || 'Player 2',
        x: (CANVAS_WIDTH / 4) * 3,
        y: CANVAS_HEIGHT - PLAYER_HEIGHT - 20,
        width: PLAYER_WIDTH,
        height: PLAYER_HEIGHT,
        speed: PLAYER_SPEED,
        velocityY: 0,
        isJumping: false,
        side: 1, // Right side
        hits: 0 // Add hit counter for player
      };
      
      game.players.push(player);
    }
    
    // Join socket to the game room
    socket.join(gameId);
    
    // Notify everyone in the room
    io.to(gameId).emit('playerJoined', {
      players: game.players
    });
    
    // Send game joined confirmation
    socket.emit('joinedGame', {
      gameId,
      playerId: socket.id,
      players: game.players
    });
    
    console.log(`Player ${socket.id} joined game: ${gameId}`);
  });
  
  // Start the game
  socket.on('startGame', (data) => {
    const { gameId } = data;
    
    if (!games.has(gameId)) {
      socket.emit('error', { message: 'Game not found.' });
      return;
    }
    
    const game = games.get(gameId);
    
    if (game.players.length < 2) {
      socket.emit('error', { message: 'Need at least 2 players to start.' });
      return;
    }
    
    if (game.isActive) {
      socket.emit('error', { message: 'Game is already active.' });
      return;
    }
    
    // Start the game
    game.isActive = true;
    game.message = 'Get ready';
    game.ball = createBall();
    game.servingSide = 0; // First player serves
    game.lastUpdateTime = Date.now();
    game.lastHitBy = null; // Reset who last hit the ball
    game.doubleHitDetected = false; // Reset double hit flag
    game.hitCounts = [0, 0]; // Reset hit counters
    
    // Reset player hits
    game.players.forEach(player => {
      player.hits = 0;
    });
    
    // Notify all players
    io.to(gameId).emit('gameStarted');
    
    // Start game loop for this room
    startGameLoop(gameId);
    
    console.log(`Game ${gameId} started`);
  });
  
  // Handle player input
  socket.on('playerInput', (data) => {
    // Find the game this player is in
    for (const [gameId, game] of games.entries()) {
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1 && game.isActive) {
        const player = game.players[playerIndex];
        
        // Update player position based on input
        if (data.left) {
          player.x -= player.speed;
        }
        
        if (data.right) {
          player.x += player.speed;
        }
        
        // Handle jump
        if (data.action && !player.isJumping) {
          player.velocityY = -PLAYER_JUMP_FORCE;
          player.isJumping = true;
        }
        
        // Constrain player position to their side of the court
        const minX = playerIndex === 0 ? 20 : CANVAS_WIDTH / 2 + 5;
        const maxX = playerIndex === 0 ? CANVAS_WIDTH / 2 - PLAYER_WIDTH - 5 : CANVAS_WIDTH - 20 - PLAYER_WIDTH;
        
        player.x = Math.max(minX, Math.min(maxX, player.x));
        
        break;
      }
    }
  });
  
  // Leave game
  socket.on('leaveGame', (data) => {
    const { gameId } = data;
    
    if (gameId && games.has(gameId)) {
      leaveGame(socket, gameId);
    }
  });
  
  // Restart game
  socket.on('restartGame', (data) => {
    const { gameId } = data;
    
    if (!games.has(gameId)) {
      socket.emit('error', { message: 'Game not found.' });
      return;
    }
    
    const game = games.get(gameId);
    
    if (game.players.length < 2) {
      socket.emit('error', { message: 'Need at least 2 players to restart.' });
      return;
    }
    
    // Reset game state
    game.ball = createBall();
    game.score = [
      { points: 0, games: 0, sets: 0 },
      { points: 0, games: 0, sets: 0 }
    ];
    game.hitCounts = [0, 0]; // Reset hit counters
    game.isActive = true;
    game.servingSide = 0;
    game.message = 'Get ready';
    game.lastUpdateTime = Date.now();
    game.lastHitBy = null; // Reset who last hit the ball
    game.doubleHitDetected = false; // Reset double hit flag
    
    // Reset player hits
    game.players.forEach(player => {
      player.hits = 0;
    });
    
    // Notify all players
    io.to(gameId).emit('gameStarted');
    
    // Start game loop for this room
    startGameLoop(gameId);
    
    console.log(`Game ${gameId} restarted`);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    
    // Remove player from any games they're in
    for (const [gameId, game] of games.entries()) {
      if (game.players.some(p => p.id === socket.id)) {
        leaveGame(socket, gameId);
        break;
      }
    }
  });
});

// Helper functions
function generateGameId() {
  // Generate a shorter, friendlier game ID (4 characters)
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function createBall() {
  return {
    x: CANVAS_WIDTH / 2,
    y: CANVAS_HEIGHT / 2,
    radius: BALL_RADIUS,
    velocityX: (Math.random() > 0.5 ? 1 : -1) * (BALL_SPEED / 2),
    velocityY: -BALL_SPEED,
    lastHitBy: null,
    bounces: 0
  };
}

function leaveGame(socket, gameId) {
  if (!games.has(gameId)) return;
  
  const game = games.get(gameId);
  
  // Check if player is in the game
  const playerIndex = game.players.findIndex(p => p.id === socket.id);
  
  if (playerIndex !== -1) {
    // Remove player
    game.players.splice(playerIndex, 1);
    
    // Notify other players
    socket.to(gameId).emit('playerLeft', {
      playerId: socket.id,
      players: game.players
    });
    
    // If no players left, remove the game
    if (game.players.length === 0) {
      games.delete(gameId);
      console.log(`Game ${gameId} ended (no players)`);
    } else if (game.isActive) {
      // If game is active and a player leaves, end the game
      game.isActive = false;
      
      const winner = game.players[0];
      
      io.to(gameId).emit('gameOver', {
        winner,
        score: game.score,
        hitCounts: game.hitCounts // Include hit counts in game over data
      });
    }
  } else {
    // Check if they're a spectator
    const spectatorIndex = game.spectators.findIndex(s => s.id === socket.id);
    if (spectatorIndex !== -1) {
      game.spectators.splice(spectatorIndex, 1);
    }
  }
  
  // Leave the socket room
  socket.leave(gameId);
}

function startGameLoop(gameId) {
  if (!games.has(gameId)) return;
  
  const game = games.get(gameId);
  if (!game.isActive) return;
  
  const updateInterval = setInterval(() => {
    if (!games.has(gameId) || !games.get(gameId).isActive) {
      clearInterval(updateInterval);
      return;
    }
    
    updateGameState(gameId);
    
    // Send game state to all clients in the room
    io.to(gameId).emit('gameState', getGameStateForClient(games.get(gameId)));
  }, 1000 / 60); // 60 FPS
}

function updateGameState(gameId) {
  const game = games.get(gameId);
  if (!game || !game.isActive) return;
  
  const currentTime = Date.now();
  const deltaTime = (currentTime - game.lastUpdateTime) / 16.67; // Normalize to ~60fps
  game.lastUpdateTime = currentTime;
  
  const ball = game.ball;
  
  // Update ball position
  ball.x += ball.velocityX * deltaTime;
  ball.y += ball.velocityY * deltaTime;
  
  // Apply gravity to the ball
  ball.velocityY += GRAVITY * deltaTime;
  
  // Check if ball has crossed to the other side
  const currentSide = ball.x < CANVAS_WIDTH / 2 ? 0 : 1;
  
  // If the ball crossed the net, reset the double hit tracking
  const prevSide = ball.lastHitBy ? game.players.find(p => p.id === game.ball.lastHitBy)?.side : null;
  if (prevSide !== null && currentSide !== prevSide) {
    game.lastHitBy = null;
    game.doubleHitDetected = false;
  }
  
  // Update player positions (apply gravity)
  for (const player of game.players) {
    if (player.isJumping) {
      player.y += player.velocityY;
      player.velocityY += GRAVITY;
      
      // Check if player landed
      if (player.y >= CANVAS_HEIGHT - PLAYER_HEIGHT - 20) {
        player.y = CANVAS_HEIGHT - PLAYER_HEIGHT - 20;
        player.velocityY = 0;
        player.isJumping = false;
      }
    }
    
    // Check for ball collision with player
    if (checkPlayerBallCollision(player, ball)) {
      // Check if this player already hit the ball (double hit)
      if (game.lastHitBy === player.id) {
        // Double hit - award point to the other team
        const scoringSide = 1 - player.side;
        awardPoint(game, scoringSide);
        
        // Reset ball position for next serve
        resetBallAfterPoint(game);
        
        // Update message
        game.message = `Point for ${game.players[scoringSide].name} (double hit)`;
        
        // Check for game/set win
        checkGameSetWin(game);
      } else {
        // Valid hit
        hitBallByCollision(game, player, ball);
        
        // Record this player as the last one to hit the ball
        game.lastHitBy = player.id;
        ball.lastHitBy = player.id;
        
        // Increment hit counter for player and their side
        player.hits++;
        game.hitCounts[player.side]++;
      }
    }
  }
  
  // Handle wall collisions
  handleWallCollisions(game);
  
  // Handle floor collision (scoring)
  if (ball.y >= CANVAS_HEIGHT - ball.radius) {
    // Ball hit the ground, check which side to score
    const scoringSide = ball.x < CANVAS_WIDTH / 2 ? 1 : 0;
    
    // Award point to the opposing side
    awardPoint(game, scoringSide);
    
    // Reset ball position for next serve
    resetBallAfterPoint(game);
    
    // Update message
    game.message = `Point for ${game.players[scoringSide].name}`;
    
    // Check for game/set win
    checkGameSetWin(game);
  }
}

function resetBallAfterPoint(game) {
  const ball = game.ball;
  
  // Reset ball position and velocity
  ball.x = CANVAS_WIDTH / 2;
  ball.y = CANVAS_HEIGHT / 2;
  ball.velocityX = (Math.random() > 0.5 ? 1 : -1) * (BALL_SPEED / 2);
  ball.velocityY = -BALL_SPEED;
  ball.bounces = 0;
  
  // Reset hit tracking after point
  game.lastHitBy = null;
  ball.lastHitBy = null;
  game.doubleHitDetected = false;
}

function handleWallCollisions(game) {
  const ball = game.ball;
  
  // Left wall collision
  if (ball.x - ball.radius <= 0) {
    ball.x = ball.radius;
    ball.velocityX = Math.abs(ball.velocityX) * BOUNCE_FACTOR;
  }
  
  // Right wall collision
  if (ball.x + ball.radius >= CANVAS_WIDTH) {
    ball.x = CANVAS_WIDTH - ball.radius;
    ball.velocityX = -Math.abs(ball.velocityX) * BOUNCE_FACTOR;
  }
  
  // Top wall collision
  if (ball.y - ball.radius <= 0) {
    ball.y = ball.radius;
    ball.velocityY = Math.abs(ball.velocityY) * BOUNCE_FACTOR;
  }
  
  // Net collision - only if ball is low enough
  if (Math.abs(ball.x - CANVAS_WIDTH / 2) < ball.radius) {
    // Only bounce off the top of the net if the ball is below the top of the net
    const NET_HEIGHT = CANVAS_HEIGHT * (2/3);
    if (ball.y > NET_HEIGHT) {
      if (ball.x < CANVAS_WIDTH / 2) {
        ball.x = CANVAS_WIDTH / 2 - ball.radius;
      } else {
        ball.x = CANVAS_WIDTH / 2 + ball.radius;
      }
      ball.velocityX = -ball.velocityX * BOUNCE_FACTOR;
    }
  }
  
  // Count floor bounces for padel rules
  if (ball.y + ball.radius >= CANVAS_HEIGHT - 20 && ball.velocityY > 0) {
    ball.y = CANVAS_HEIGHT - 20 - ball.radius;
    ball.velocityY = -ball.velocityY * BOUNCE_FACTOR;
    ball.velocityX *= 0.9; // Slow down x velocity on bounce
    
    ball.bounces++;
    
    // If the ball has bounced twice on a side, award point to the other side
    if (ball.bounces > 1) {
      const scoringSide = ball.x < CANVAS_WIDTH / 2 ? 1 : 0;
      
      // Award point
      awardPoint(game, scoringSide);
      
      // Reset ball position for next serve
      resetBallAfterPoint(game);
      
      // Update message
      game.message = `Point for ${game.players[scoringSide].name} (double bounce)`;
      
      // Check for game/set win
      checkGameSetWin(game);
    }
  }
}

function checkPlayerBallCollision(player, ball) {
  // Simple rectangle-circle collision detection
  const distX = Math.abs(ball.x - (player.x + player.width/2));
  const distY = Math.abs(ball.y - (player.y + player.height/2));
  
  if (distX > (player.width/2 + ball.radius)) { return false; }
  if (distY > (player.height/2 + ball.radius)) { return false; }
  
  if (distX <= (player.width/2)) { return true; } 
  if (distY <= (player.height/2)) { return true; }
  
  // Check corner collision
  const dx = distX - player.width/2;
  const dy = distY - player.height/2;
  return (dx*dx + dy*dy <= (ball.radius*ball.radius));
}

function hitBallByCollision(game, player, ball) {
  // Calculate hit direction based on where the ball hit the player
  const hitX = (ball.x - (player.x + player.width/2)) / (player.width/2);
  const hitY = (ball.y - (player.y + player.height/2)) / (player.height/2);
  
  // Set new velocity based on hit position
  const hitPower = BALL_SPEED * 1.2;
  ball.velocityX = hitX * hitPower;
  ball.velocityY = -Math.abs(hitY * hitPower) - 2; // Always go up a bit
  
  // Reset bounce count if it's a valid hit
  if (ball.bounces <= 1) {
    ball.bounces = 0;
  }
}

function awardPoint(game, scoringSide) {
  // Increase points for scoring side
  const points = ['0', '15', '30', '40', 'game'];
  const currentPointIndex = points.indexOf(String(game.score[scoringSide].points));
  
  if (currentPointIndex === 3) {
    // Player reached 40, they win the game
    game.score[scoringSide].games++;
    
    // Reset points for both players
    game.score[0].points = 0;
    game.score[1].points = 0;
    
    // Switch serving side
    game.servingSide = 1 - game.servingSide;
  } else {
    // Award next point value
    game.score[scoringSide].points = points[currentPointIndex + 1];
  }
  
  // Reset hit tracking after point
  game.lastHitBy = null;
  game.doubleHitDetected = false;
}

function checkGameSetWin(game) {
  // Check for game win (6 games wins a set)
  for (let i = 0; i < 2; i++) {
    if (game.score[i].games >= 6 && game.score[i].games - game.score[1-i].games >= 2) {
      // Player won the set
      game.score[i].sets++;
      
      // Reset games for both players
      game.score[0].games = 0;
      game.score[1].games = 0;
      
      // Check for match win (best of 3 sets)
      if (game.score[i].sets >= 2) {
        // Player won the match
        game.isActive = false;
        
        // Send game over notification
        io.to(game.id).emit('gameOver', {
          winner: game.players[i],
          score: game.score,
          hitCounts: game.hitCounts // Include hit counts in game over event
        });
      }
    }
  }
}

function getGameStateForClient(game) {
  // Return a copy of game state with only the necessary information
  return {
    players: game.players,
    ball: game.ball,
    score: game.score,
    servingSide: game.servingSide,
    message: game.message,
    hitCounts: game.hitCounts // Include hit counts in game state for client
  };
}

// Start the server
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});