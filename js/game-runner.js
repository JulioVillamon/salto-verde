/**
 * Salto Verde — motor del runner en Canvas 2D con sprites pixel art (Kenney CC0).
 *
 * Módulo IIFE sin dependencias. Requiere `sprites.js` cargado antes.
 *
 * Uso:
 *   SaltoVerde.mount(document.querySelector('.game-view'));
 *   SaltoVerde.destroy();
 *   SaltoVerde.getHighScore();
 *
 * Estructura interna:
 *   - GameAudio      → efectos y música con Web Audio API (osciladores)
 *   - Game           → bucle, física, obstáculos, render e interfaz
 *   - window.SaltoVerde → API pública (montaje, destrucción, récord)
 *
 * El contenedor `.game-view` debe incluir el DOM descrito en docs/ARQUITECTURA.md.
 * Los estilos visuales (CRT, HUD pixel) viven en css/game.css.
 *
 * Entrada de usuario:
 *   - Teclado: Espacio/↑ saltar, P pausa, R reiniciar
 *   - Móvil (pointer: coarse): toque en `.game-screen` (canvas + marco del monitor)
 *   - Escritorio: Espacio o ↑; clic en pantalla solo enfoca el canvas
 *   - Panel inferior: botones Pausar, Reiniciar y Silenciar (siempre activos)
 */
(function () {
  'use strict';

  /* --- Constantes visuales, de almacenamiento y singleton de instancia --- */
  var STORAGE_KEY = 'saltoVerdeHighScore';
  var MUTE_STORAGE_KEY = 'saltoVerdeMuted';
  var activeInstance = null;
  var cachedSprites = null;

  var PLAYER_W = 24;
  var PLAYER_H = 24;
  var GROUND_TOP_H = 18;
  var GROUND_FILL_H = 24;
  var DECO_SCALE_FAR = 2;
  var DECO_SCALE_NEAR = 2.5;
  var DECO_CACTUS_MUL = 0.68;
  var OBSTACLE_DRAW_W = 18;
  var OBSTACLE_DRAW_H = 18;
  var OBSTACLE_SRC_X = 4;
  var OBSTACLE_SRC_Y = 5;
  var OBSTACLE_DEST_X = 3;
  var OBSTACLE_GROUND_SNAP = 5;
  var OBSTACLE_STACK_OVERLAP = 4;
  var SIGN_INTERVAL = 50;          /* Carteles de puntuación cada N puntos */
  var STACK3_MIN_SCORE = 100;      /* Torres de 3 bloques desde este score */
  var BLOCK_SIZE = 18;
  /* Densidad del decorado (árboles/cactus); los carteles no cuentan en sceneryPlantRightmost */
  var SCENERY_SPAWN_CHANCE = 0.86;
  var SCENERY_STEP_MIN = 72;
  var SCENERY_STEP_RANGE = 88;
  var SCENERY_AHEAD_GAP_MIN = 88;
  var SCENERY_AHEAD_GAP_RANGE = 72;
  var SCENERY_BUFFER_AHEAD = 260;
  var SCENERY_FAR_CHANCE = 0.24;
  var SCENERY_X_JITTER = 28;
  var SKY_TOP = '#87CEEB';
  var SKY_BOTTOM = '#5BA3D9';

  /* --- Física y ritmo de juego (arranque lento, huecos variables, aceleración gradual) --- */
  var BASE_SPEED = 2.4;
  var MAX_SPEED = 9.5;
  var SPEED_STEP = 0.18;
  var SPEED_STEP_EVERY = 450;
  var GRAVITY = 0.55;
  var JUMP_VELOCITY = -9.5;
  var INITIAL_SPAWN_DELAY = 120;
  var GAP_SHORT = [210, 320];
  var GAP_MID = [330, 470];
  var GAP_LONG = [480, 620];
  var GAP_EXTRA = [640, 820];
  var OBSTACLE_WIDTH = BLOCK_SIZE;
  var BLOCK_UNIT = BLOCK_SIZE;
  var COYOTE_FRAMES = 6;
  var GAME_OVER_OVERLAY_DELAY = 500;
  var GAME_OVER_RESTART_DELAY = 450;
  var BGM_STEP = 0.18;
  /* Patrones de notas de la música de fondo (0 = silencio en ese paso) */
  var BGM_BASS = [110, 0, 110, 98, 87, 0, 98, 110, 110, 0, 131, 110, 98, 87, 82, 98];
  var BGM_PAD = [220, 0, 196, 0, 220, 262, 0, 220, 220, 0, 196, 174, 196, 0, 220, 0];
  var BGM_LEAD = [0, 440, 0, 494, 523, 0, 494, 440, 0, 587, 523, 494, 440, 392, 0, 494];
  /* Altura del área de juego = panel de control × este ratio (véase syncGameLayout) */
  var SCREEN_PANEL_HEIGHT_RATIO = 2;

  /* --- Puntuación y preferencias del jugador --- */

  function getHighScore() {
    return parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10) || 0;
  }

  function setHighScore(v) {
    localStorage.setItem(STORAGE_KEY, String(v));
  }

  function readMutedPreference() {
    var saved = localStorage.getItem(MUTE_STORAGE_KEY);
    if (saved !== null) {
      return saved === '1';
    }
    return true;
  }

  function setMutedPreference(muted) {
    localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  }

  /* --- Audio: efectos y música generados por osciladores --- */

  function GameAudio() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.muted = readMutedPreference();
    this.musicPlaying = false;
    this.musicPaused = false;
    this.musicStep = 0;
    this.musicNextTime = 0;
    this.musicTimer = null;
  }

  GameAudio.prototype.ensure = function () {
    if (this.ctx) {
      return this.ctx;
    }

    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      return null;
    }

    try {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.72;
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 1;
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.75;
      this.sfxGain.connect(this.master);
      this.musicGain.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.applyMuteGain();
    } catch (err) {
      this.ctx = null;
      this.master = null;
      this.sfxGain = null;
      this.musicGain = null;
    }

    return this.ctx;
  };

  GameAudio.prototype.resume = function () {
    var ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') {
      return ctx.resume();
    }
    return Promise.resolve();
  };

  GameAudio.prototype.playTone = function (options) {
    var self = this;

    function emit() {
      if (self.muted) {
        return;
      }

      var ctx = self.ensure();
      if (!ctx || !self.sfxGain) {
        return;
      }

      self.resume();

      var when = ctx.currentTime;
      var duration = options.duration || 0.08;
      var startFreq = options.startFreq || options.freq || 440;
      var endFreq = options.endFreq != null ? options.endFreq : startFreq;
      var volume = options.volume || 0.35;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();

      osc.type = options.type || 'square';
      osc.frequency.setValueAtTime(startFreq, when);
      if (endFreq !== startFreq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(24, endFreq), when + duration);
      }

      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(volume, when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

      osc.connect(gain);
      gain.connect(self.sfxGain);
      osc.start(when);
      osc.stop(when + duration + 0.03);
    }

    if (options.delay) {
      window.setTimeout(emit, options.delay * 1000);
      return;
    }

    emit();
  };

  GameAudio.prototype.playStart = function () {
    this.playTone({ freq: 392, duration: 0.06, volume: 0.28 });
    this.playTone({ freq: 587, duration: 0.08, volume: 0.32, delay: 0.07 });
  };

  GameAudio.prototype.playJump = function () {
    this.playTone({
      type: 'square',
      startFreq: 520,
      endFreq: 880,
      duration: 0.09,
      volume: 0.22,
    });
  };

  GameAudio.prototype.playGameOver = function () {
    this.playTone({
      type: 'sawtooth',
      startFreq: 220,
      endFreq: 90,
      duration: 0.22,
      volume: 0.3,
    });
    this.playTone({
      type: 'square',
      startFreq: 160,
      endFreq: 55,
      duration: 0.28,
      volume: 0.24,
      delay: 0.12,
    });
  };

  GameAudio.prototype.playPause = function () {
    this.playTone({ freq: 740, duration: 0.04, volume: 0.16 });
  };

  GameAudio.prototype.scheduleMusicNote = function (freq, when, duration, type, volume) {
    if (!this.ctx || !this.musicGain || this.muted || !freq) {
      return;
    }

    var osc = this.ctx.createOscillator();
    var gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.linearRampToValueAtTime(volume, when + 0.01);
    gain.gain.linearRampToValueAtTime(0.0001, when + duration);

    osc.connect(gain);
    gain.connect(this.musicGain);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  };

  GameAudio.prototype.scheduleMusicAhead = function () {
    if (!this.musicPlaying || this.muted || this.musicPaused || !this.ctx) {
      return;
    }

    var now = this.ctx.currentTime;
    var patternLen = BGM_BASS.length;

    while (this.musicNextTime < now + 1.6) {
      var index = this.musicStep % patternLen;
      var when = this.musicNextTime;
      var bass = BGM_BASS[index];
      var pad = BGM_PAD[index];
      var lead = BGM_LEAD[index];

      this.scheduleMusicNote(bass, when, BGM_STEP * 0.92, 'triangle', 0.38);
      this.scheduleMusicNote(pad, when, BGM_STEP * 0.88, 'sine', 0.16);
      this.scheduleMusicNote(lead, when, BGM_STEP * 0.8, 'square', 0.12);

      this.musicNextTime += BGM_STEP;
      this.musicStep += 1;
    }
  };

  GameAudio.prototype.queueMusicLoop = function () {
    var self = this;

    if (this.musicTimer) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }

    if (!this.musicPlaying || this.muted || this.musicPaused) {
      return;
    }

    this.scheduleMusicAhead();
    this.musicTimer = window.setTimeout(function () {
      self.queueMusicLoop();
    }, 450);
  };

  GameAudio.prototype.startMusic = function () {
    if (this.muted) {
      return;
    }

    this.resume();
    if (!this.ensure()) {
      return;
    }

    if (this.musicPlaying && !this.musicPaused) {
      return;
    }

    this.musicPlaying = true;
    this.musicPaused = false;
    this.musicStep = 0;
    this.musicNextTime = this.ctx.currentTime + 0.05;
    this.queueMusicLoop();
  };

  GameAudio.prototype.pauseMusic = function () {
    this.musicPaused = true;
    if (this.musicTimer) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  };

  GameAudio.prototype.resumeMusic = function () {
    if (!this.musicPlaying || this.muted) {
      return;
    }

    this.musicPaused = false;
    if (this.ctx) {
      this.musicNextTime = Math.max(this.musicNextTime, this.ctx.currentTime + 0.03);
    }
    this.queueMusicLoop();
  };

  GameAudio.prototype.stopMusic = function () {
    this.musicPlaying = false;
    this.musicPaused = false;
    this.musicStep = 0;
    this.musicNextTime = 0;
    if (this.musicTimer) {
      clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
  };

  GameAudio.prototype.applyMuteGain = function () {
    if (!this.master || !this.ctx) {
      return;
    }
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.72, this.ctx.currentTime, 0.015);
  };

  GameAudio.prototype.setMuted = function (muted) {
    this.muted = muted;
    setMutedPreference(muted);
    this.ensure();
    this.applyMuteGain();
    if (muted) {
      this.pauseMusic();
      return;
    }
    this.resume();
    if (this.musicPlaying && this.musicPaused) {
      this.resumeMusic();
    }
  };

  GameAudio.prototype.toggleMuted = function () {
    this.setMuted(!this.muted);
    return this.muted;
  };

  GameAudio.prototype.destroy = function () {
    this.stopMusic();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.master = null;
      this.sfxGain = null;
      this.musicGain = null;
    }
  };

  /**
   * Motor principal del juego.
   * Resuelve referencias DOM dentro de `shell` (.game-view), arranca el bucle
   * y enlaza entrada de usuario, layout responsive y audio.
   */
  function Game(shell, sprites) {
    this.shell = shell;
    this.sprites = sprites;
    this.screen = shell.querySelector('.game-screen');
    this.canvas = shell.querySelector('.game-canvas');
    this.overlay = shell.querySelector('.game-screen__overlay');
    this.statusEl = shell.querySelector('.game-screen__status');
    this.hintEl = shell.querySelector('.game-screen__hint');
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.pauseBtn = shell.querySelector('.game-pause');
    this.restartBtn = shell.querySelector('.game-restart');
    this.muteBtn = shell.querySelector('.game-mute');
    this.recordEl = shell.querySelector('.game-record');
    this.scoreOverlayEl = shell.querySelector('.game-screen__score');
    this.soundHudEl = shell.querySelector('.game-screen__sound');
    this.ptsHudEl = shell.querySelector('.game-screen__pts');
    this.audio = new GameAudio();
    this.highScore = getHighScore();
    this.reset();
    this.updateMuteButton();
    this.bindEvents();
    this.bindGameLayout();
    this.running = true;
    this.raf = requestAnimationFrame(this.loop.bind(this));
  }

  Game.prototype.reset = function () {
    this.score = 0;
    this.speed = BASE_SPEED;
    this.frame = 0;
    this.idleFrame = 0;
    this.waiting = true;
    this.paused = false;
    this.gameOver = false;
    this.groundY = this.canvas.height - GROUND_FILL_H;
    this.surfaceY = this.groundY - GROUND_TOP_H;
    this.player = {
      x: 48,
      y: this.surfaceY,
      vy: 0,
      w: PLAYER_W,
      h: PLAYER_H,
      frame: 0,
      jumping: false,
    };
    this.obstacles = [];
    this.mountainOffset = 0;
    this.nextSignAt = SIGN_INTERVAL;
    this.scenery = this.createScenery();
    this.spawnStartSign();
    this.clouds = this.createClouds();
    this.distanceSinceLastSpawn = 0;
    this.nextSpawnGap = this.randomSpawnGap(null);
    this.lastSpawnGap = null;
    this.spawnDelay = INITIAL_SPAWN_DELAY;
    this.gameOverTime = 0;
    this.gameOverOverlayReady = false;
    this.gameOverFreezeScore = 0;
    this.jumpKeyHeld = false;
    this.coyoteTimer = 0;
    this.pauseBtn.textContent = 'Pausar';
    this.updateOverlay();
    this.updatePanelStats();
    this.updateScreenHud();
    this.syncMusic();
  };

  Game.prototype.updatePanelStats = function () {
    if (this.recordEl) {
      this.recordEl.textContent = 'Récord: ' + this.highScore;
    }
  };

  Game.prototype.setHighScore = function (score) {
    this.highScore = score;
    setHighScore(score);
    this.updatePanelStats();
  };

  Game.prototype.syncMusic = function () {
    if (!this.audio || this.audio.muted) {
      return;
    }

    if (this.waiting || this.gameOver) {
      this.audio.stopMusic();
      return;
    }

    if (this.paused) {
      this.audio.pauseMusic();
      return;
    }

    if (this.audio.musicPlaying) {
      this.audio.resumeMusic();
      return;
    }

    this.audio.startMusic();
  };

  Game.prototype.speedProgress = function () {
    return Math.max(0, Math.min(1, (this.speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED)));
  };

  Game.prototype.lerpRange = function (range, scale) {
    return [
      range[0] * scale,
      range[1] * scale,
    ];
  };

  /* --- Generación de obstáculos y espaciado entre ellos --- */

  Game.prototype.pickGapBucket = function (previousGap) {
    var roll = Math.random();

    if (previousGap !== null) {
      if (previousGap < GAP_SHORT[1] && roll < 0.72) {
        roll = 0.45 + Math.random() * 0.55;
      } else if (previousGap > GAP_LONG[0] && roll > 0.78) {
        roll = Math.random() * 0.55;
      }
    }

    if (roll < 0.18) return 'short';
    if (roll < 0.52) return 'mid';
    if (roll < 0.82) return 'long';
    return 'extra';
  };

  Game.prototype.randomSpawnGap = function (previousGap) {
    var scale = 1 - this.speedProgress() * 0.24;
    var bucket = this.pickGapBucket(previousGap);
    var range;

    if (bucket === 'short') range = GAP_SHORT;
    else if (bucket === 'mid') range = GAP_MID;
    else if (bucket === 'long') range = GAP_LONG;
    else range = GAP_EXTRA;

    range = this.lerpRange(range, scale);
    return range[0] + Math.random() * (range[1] - range[0]);
  };

  Game.prototype.buildObstacleGroup = function (gap) {
    var items = [];
    var roll = Math.random();
    var warmedUp = this.frame > 120;
    var lateGame = this.speed >= BASE_SPEED + 2.4;
    var canPair = warmedUp && gap >= 340;
    var canStack2 = warmedUp && gap >= 230;
    var canStack3 = Math.floor(this.score) >= STACK3_MIN_SCORE && gap >= 280;

    if (canStack3 && roll < 0.1) {
      items.push({ stack: 3, xOffset: 0 });
      return items;
    }

    if (canPair && roll < 0.28) {
      var innerGap = 88 + Math.random() * 72;
      items.push({ stack: 1, xOffset: 0 });
      items.push({
        stack: canStack2 && Math.random() < 0.45 ? 2 : 1,
        xOffset: innerGap,
      });
      return items;
    }

    if (canStack2 && roll < 0.52) {
      items.push({ stack: 2, xOffset: 0 });
      return items;
    }

    if (lateGame && roll > 0.84) {
      items.push({ stack: 1, xOffset: 0 });
      items.push({ stack: 1, xOffset: 62 + Math.random() * 36 });
      return items;
    }

    items.push({ stack: 1, xOffset: 0 });
    return items;
  };

  Game.prototype.skyCloudBand = function () {
    return Math.min(48, Math.max(18, this.groundY * 0.1));
  };

  Game.prototype.createClouds = function () {
    var clouds = [];
    var band = this.skyCloudBand();
    for (var i = 0; i < 5; i++) {
      clouds.push({
        x: i * 180 + Math.random() * 90,
        y: 6 + Math.random() * band,
        w: 32 + Math.random() * 20,
        h: 12 + Math.random() * 6,
        speed: 0.08 + Math.random() * 0.06,
      });
    }
    return clouds;
  };

  Game.prototype.pickSceneryType = function () {
    return Math.random() < 0.55 ? 'tree' : 'cactus';
  };

  Game.prototype.buildSceneryItem = function (x) {
    return {
      type: this.pickSceneryType(),
      x: x + Math.random() * SCENERY_X_JITTER,
      depth: Math.random() < SCENERY_FAR_CHANCE ? 'far' : 'near',
    };
  };

  Game.prototype.sceneryPlantRightmost = function () {
    /* Borde derecho de plantas (árbol/cactus); ignora carteles para no bloquear spawn */
    var rightmost = 0;
    var hasPlants = false;

    this.scenery.forEach(function (item) {
      if (item.type !== 'tree' && item.type !== 'cactus') {
        return;
      }
      hasPlants = true;
      if (item.x > rightmost) {
        rightmost = item.x;
      }
    });

    return hasPlants ? rightmost : 0;
  };

  Game.prototype.spawnStartSign = function () {
    this.scenery.push({
      type: 'sign',
      x: (this.canvas.width - PLAYER_W) / 2,
      depth: 'near',
    });
  };

  Game.prototype.spawnSignAhead = function () {
    var rightmost = this.canvas.width + 40;
    this.scenery.forEach(function (item) {
      if (item.x > rightmost) {
        rightmost = item.x;
      }
    });
    this.scenery.push({
      type: 'sign',
      x: rightmost + 140 + Math.random() * 200,
      depth: 'near',
    });
  };

  Game.prototype.checkSignSpawns = function (scoreFloor) {
    while (scoreFloor >= this.nextSignAt) {
      this.spawnSignAhead();
      this.nextSignAt += SIGN_INTERVAL;
    }
  };

  Game.prototype.createScenery = function () {
    var items = [];
    var x = 48;
    var horizon = this.canvas.width + 360;

    while (x < horizon) {
      if (Math.random() < SCENERY_SPAWN_CHANCE) {
        items.push(this.buildSceneryItem(x));
      }
      x += SCENERY_STEP_MIN + Math.random() * SCENERY_STEP_RANGE;
    }
    return items;
  };

  Game.prototype.spawnSceneryAhead = function () {
    var rightmost = this.sceneryPlantRightmost();
    var bufferEdge = this.canvas.width + SCENERY_BUFFER_AHEAD;

    if (rightmost < bufferEdge) {
      var anchor = rightmost > 0 ? rightmost : this.canvas.width * 0.45;
      var gap = SCENERY_AHEAD_GAP_MIN + Math.random() * SCENERY_AHEAD_GAP_RANGE;
      this.scenery.push(this.buildSceneryItem(anchor + gap));
    }

    this.scenery = this.scenery.filter(function (item) {
      return item.x > -160;
    });
  };

  /* --- Teclado, tacto y botones del panel --- */

  Game.prototype.bindEvents = function () {
    var self = this;
    /* Teclado global: salto también reinicia tras game over (con retardo) */
    this._onKey = function (e) {
      if (!self.running || !self.shell.isConnected) {
        return;
      }

      var isJump = e.key === ' ' || e.code === 'Space' || e.key === 'ArrowUp' || e.code === 'ArrowUp';
      var isPause = e.key === 'p' || e.key === 'P' || e.code === 'KeyP';
      var isRestart = e.key === 'r' || e.key === 'R' || e.code === 'KeyR';

      if (isJump || isPause || isRestart) {
        e.preventDefault();
      }
      if (isJump) {
        if (self.gameOver) {
          if (!self.jumpKeyHeld && self.canRestartAfterGameOver()) {
            self.restart();
          }
        } else {
          self.jumpKeyHeld = true;
          self.jump();
        }
      }
      if (isPause) {
        self.togglePause();
      }
      if (isRestart) {
        if (self.gameOver) {
          if (self.canRestartAfterGameOver()) {
            self.restart();
          }
        } else if (!self.waiting) {
          self.restart();
        }
      }
    };
    this._onKeyUp = function (e) {
      if (e.key === ' ' || e.code === 'Space' || e.key === 'ArrowUp' || e.code === 'ArrowUp') {
        self.jumpKeyHeld = false;
      }
    };
    /* Móvil: salto/reinicio solo si el evento ocurre dentro de .game-screen */
    this._onMobileTap = function (e) {
      if (!self.screen || !self.screen.contains(e.target)) {
        return;
      }
      if (e.target.closest('button')) {
        return;
      }
      if (e.pointerType === 'mouse') {
        return;
      }
      e.preventDefault();
      if (self.gameOver) {
        if (self.canRestartAfterGameOver()) {
          self.restart();
        }
        return;
      }
      self.jump();
    };
    /* Escritorio: clic en la ventana del juego solo enfoca el canvas (salto = Espacio o ↑) */
    this._onScreenClick = function () {
      self.canvas.focus({ preventScroll: true });
    };

    this.useWideTouch = window.matchMedia('(pointer: coarse)').matches;
    this.touchTarget = this.screen;

    document.addEventListener('keydown', this._onKey);
    document.addEventListener('keyup', this._onKeyUp);
    if (this.useWideTouch && this.touchTarget) {
      if (window.PointerEvent) {
        this.touchTarget.addEventListener('pointerdown', this._onMobileTap);
      } else {
        this.touchTarget.addEventListener('touchstart', this._onMobileTap, { passive: false });
      }
    } else if (this.touchTarget) {
      this.touchTarget.addEventListener('click', this._onScreenClick);
    }
    this.pauseBtn.addEventListener('click', function () { self.togglePause(); });
    this.restartBtn.addEventListener('click', function () {
      if (self.waiting) return;
      if (self.gameOver && !self.canRestartAfterGameOver()) return;
      self.restart();
    });
    if (this.muteBtn) {
      this.muteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        self.audio.resume();
        self.audio.toggleMuted();
        self.updateMuteButton();
        self.syncMusic();
      });
    }
  };

  Game.prototype.updateScreenHud = function () {
    if (this.soundHudEl && this.audio) {
      this.soundHudEl.textContent = this.audio.muted ? 'SONIDO OFF' : 'SONIDO ON';
    }
    if (this.ptsHudEl) {
      this.ptsHudEl.textContent = 'PTS ' + Math.floor(this.score);
    }
  };

  Game.prototype.updateMuteButton = function () {
    if (!this.muteBtn || !this.audio) {
      return;
    }
    var muted = this.audio.muted;
    this.muteBtn.textContent = muted ? 'Activar sonido' : 'Silenciar';
    this.muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    this.updateScreenHud();
  };

  /* --- Layout responsive: altura del canvas según el panel de control --- */

  Game.prototype.clearGameLayout = function () {
    if (this.screen) {
      this.screen.style.height = '';
      this.screen.style.minHeight = '';
    }
    if (this.canvas) {
      this.canvas.style.height = '';
      this.canvas.style.width = '';
    }
  };

  Game.prototype.syncGameLayout = function () {
    /* Fija la altura de .game-screen al doble del panel y reparte el espacio al canvas */
    if (!this.screen || !this.controlPanel || !this.canvas) {
      return;
    }

    var panelHeight = this.controlPanel.offsetHeight;
    var screenHeight = Math.round(panelHeight * SCREEN_PANEL_HEIGHT_RATIO);
    var screenStyle = window.getComputedStyle(this.screen);
    var insetY =
      parseFloat(screenStyle.paddingTop) +
      parseFloat(screenStyle.paddingBottom) +
      parseFloat(screenStyle.borderTopWidth) +
      parseFloat(screenStyle.borderBottomWidth);
    var canvasHeight = Math.max(0, screenHeight - insetY);

    this.screen.style.height = screenHeight + 'px';
    this.screen.style.minHeight = screenHeight + 'px';
    this.canvas.style.width = '100%';
    this.canvas.style.height = canvasHeight + 'px';
    this.syncCanvasResolution();
  };

  Game.prototype.syncCanvasResolution = function () {
    /* Iguala el buffer interno del canvas con su tamaño CSS.
       Al redimensionar, el cielo crece arriba; suelo y jugador se desplazan en bloque. */
    if (!this.canvas || !this.ctx) {
      return;
    }

    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));

    if (w === this.canvas.width && h === this.canvas.height) {
      return;
    }

    var oldSurfaceY = this.surfaceY;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false;

    this.groundY = h - GROUND_FILL_H;
    this.surfaceY = this.groundY - GROUND_TOP_H;

    if (this.player && typeof oldSurfaceY === 'number') {
      this.player.y += this.surfaceY - oldSurfaceY;
    }
  };

  Game.prototype.bindGameLayout = function () {
    var self = this;
    this.controlPanel = this.shell.querySelector('.game-control-panel');
    this._syncGameLayout = function () {
      self.syncGameLayout();
    };

    this._syncGameLayout();
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(self._syncGameLayout);
    });
    window.addEventListener('resize', this._syncGameLayout);
  };

  Game.prototype.unbindGameLayout = function () {
    if (!this._syncGameLayout) {
      return;
    }
    window.removeEventListener('resize', this._syncGameLayout);
    this.clearGameLayout();
    this._syncGameLayout = null;
  };

  Game.prototype.unbindEvents = function () {
    this.unbindGameLayout();
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('keyup', this._onKeyUp);
    if (this.useWideTouch && this.touchTarget) {
      if (window.PointerEvent) {
        this.touchTarget.removeEventListener('pointerdown', this._onMobileTap);
      } else {
        this.touchTarget.removeEventListener('touchstart', this._onMobileTap);
      }
    } else if (this.touchTarget) {
      this.touchTarget.removeEventListener('click', this._onScreenClick);
    }
  };

  Game.prototype.canRestartAfterGameOver = function () {
    /* Evita reinicio accidental: espera overlay + GAME_OVER_RESTART_DELAY ms */
    if (!this.gameOver || !this.gameOverOverlayReady) {
      return false;
    }
    return (Date.now() - this.gameOverTime) > GAME_OVER_RESTART_DELAY;
  };

  Game.prototype.triggerGameOver = function () {
    if (this.gameOver) {
      return;
    }
    this.gameOver = true;
    this.gameOverTime = Date.now();
    this.gameOverOverlayReady = false;
    this.gameOverFreezeScore = Math.floor(this.score);
    this.audio.stopMusic();
    this.audio.playGameOver();
    if (this.overlay) {
      this.overlay.classList.remove('game-screen__overlay--game-over');
    }
  };

  Game.prototype.tickGameOverOverlay = function () {
    /* Retardo breve antes de mostrar «GAME OVER» (animación de impacto) */
    if (!this.gameOver || this.gameOverOverlayReady) {
      return;
    }
    if (Date.now() - this.gameOverTime >= GAME_OVER_OVERLAY_DELAY) {
      this.gameOverOverlayReady = true;
      this.updateOverlay();
    }
  };

  Game.prototype.start = function () {
    if (!this.waiting || this.gameOver) {
      return;
    }
    this.waiting = false;
    this.spawnDelay = INITIAL_SPAWN_DELAY;
    var self = this;
    this.audio.ensure();
    this.audio.resume().then(function () {
      self.audio.playStart();
      self.audio.startMusic();
    });
    this.updateOverlay();
  };

  Game.prototype.jump = function () {
    if (this.waiting) {
      this.start();
      return;
    }
    if (this.paused || this.gameOver) {
      return;
    }
    if (this.player.jumping && this.coyoteTimer <= 0) {
      return;
    }
    this.player.vy = JUMP_VELOCITY;
    this.player.jumping = true;
    this.coyoteTimer = 0;
    this.audio.playJump();
  };

  Game.prototype.togglePause = function () {
    if (this.waiting || this.gameOver) return;
    this.paused = !this.paused;
    this.pauseBtn.textContent = this.paused ? 'Continuar' : 'Pausar';
    this.audio.playPause();
    this.syncMusic();
    this.updateOverlay();
  };

  Game.prototype.restart = function () {
    this.reset();
    this.gameOver = false;
    this.gameOverTime = 0;
    this.gameOverOverlayReady = false;
    this.start();
  };

  Game.prototype.spawnObstacle = function () {
    var baseX = this.canvas.width + 10;
    var group = this.buildObstacleGroup(this.nextSpawnGap);

    for (var i = 0; i < group.length; i++) {
      var item = group[i];
      this.obstacles.push({
        x: baseX + item.xOffset,
        w: OBSTACLE_WIDTH,
        h: BLOCK_UNIT * item.stack,
        stack: item.stack,
      });
    }
  };

  /* --- Bucle principal: actualización lógica y dibujado --- */

  Game.prototype.loop = function () {
    if (!this.shell.isConnected) return;
    this.tickGameOverOverlay();
    if (this.waiting && !this.gameOver) {
      this.idleFrame += 1;
      this.player.frame = Math.floor(this.idleFrame / 12) % 2;
    } else if (!this.paused && !this.gameOver) {
      this.update();
    }
    this.draw();
    this.raf = requestAnimationFrame(this.loop.bind(this));
  };

  Game.prototype.update = function () {
    this.frame += 1;

    if (this.frame > 0 && this.frame % SPEED_STEP_EVERY === 0 && this.speed < MAX_SPEED) {
      this.speed = Math.min(MAX_SPEED, this.speed + SPEED_STEP);
    }

    this.player.frame = Math.floor(this.frame / 8) % 2;
    this.player.vy += GRAVITY;
    this.player.y += this.player.vy;
    if (this.player.y >= this.surfaceY) {
      this.player.y = this.surfaceY;
      this.player.vy = 0;
      this.player.jumping = false;
      this.coyoteTimer = COYOTE_FRAMES;
    } else if (this.coyoteTimer > 0) {
      this.coyoteTimer -= 1;
    }

    if (this.spawnDelay > 0) {
      this.spawnDelay -= 1;
    } else {
      this.distanceSinceLastSpawn += this.speed;
      if (this.distanceSinceLastSpawn >= this.nextSpawnGap) {
        var gapUsed = this.nextSpawnGap;
        this.spawnObstacle();
        this.distanceSinceLastSpawn -= gapUsed;
        this.lastSpawnGap = gapUsed;
        this.nextSpawnGap = this.randomSpawnGap(gapUsed);
      }
    }

    var self = this;
    this.obstacles.forEach(function (o) { o.x -= self.speed; });
    this.obstacles = this.obstacles.filter(function (o) { return o.x + o.w > 0; });

    this.clouds.forEach(function (c) {
      c.x -= self.speed * c.speed;
      if (c.x + c.w < 0) {
        c.x = self.canvas.width + Math.random() * 60;
        c.y = 6 + Math.random() * self.skyCloudBand();
        c.w = 52 + Math.random() * 36;
        c.h = 18 + Math.random() * 10;
      }
    });

    this.scenery.forEach(function (item) {
      var rate = item.depth === 'far' ? 0.1 : 0.32;
      item.x -= self.speed * rate;
    });
    this.mountainOffset -= this.speed * 0.05;
    this.spawnSceneryAhead();

    this.score += 0.1;
    var scoreFloor = Math.floor(this.score);
    this.checkSignSpawns(scoreFloor);
    if (scoreFloor > this.highScore) {
      this.setHighScore(scoreFloor);
    }

    this.checkCollisions();
  };

  Game.prototype.getPlayerHitbox = function () {
    var p = this.player;
    return {
      x: p.x + 4,
      y: p.y - p.h + 2,
      w: p.w - 8,
      h: p.h - 4,
    };
  };

  Game.prototype.getObstacleCrop = function () {
    return {
      sx: OBSTACLE_SRC_X,
      sy: OBSTACLE_SRC_Y,
      w: OBSTACLE_DRAW_W,
      h: OBSTACLE_DRAW_H,
      dx: OBSTACLE_DEST_X,
      snap: OBSTACLE_GROUND_SNAP,
    };
  };

  Game.prototype.getObstacleStackStep = function () {
    var crop = this.getObstacleCrop();
    return crop.h - OBSTACLE_STACK_OVERLAP;
  };

  Game.prototype.getObstacleStackHeight = function (stack) {
    var crop = this.getObstacleCrop();
    if (stack <= 1) {
      return crop.h;
    }
    return crop.h + this.getObstacleStackStep() * (stack - 1);
  };

  Game.prototype.getObstacleHitbox = function (o) {
    var crop = this.getObstacleCrop();
    var totalH = this.getObstacleStackHeight(o.stack);
    return {
      x: o.x + crop.dx + 2,
      y: this.surfaceY + crop.snap - totalH + 2,
      w: crop.w - 4,
      h: totalH - 4,
    };
  };

  /* --- Detección de colisiones (cajas ajustadas al sprite) --- */

  Game.prototype.checkCollisions = function () {
    var hitbox = this.getPlayerHitbox();
    for (var i = 0; i < this.obstacles.length; i++) {
      var box = this.getObstacleHitbox(this.obstacles[i]);
      if (this.intersect(hitbox, box)) {
        this.triggerGameOver();
        break;
      }
    }
  };

  Game.prototype.updateOverlay = function () {
    /* Mensajes centrales para teclado y táctil; el CSS anima --ready y --game-over */
    if (!this.overlay || !this.statusEl || !this.hintEl) {
      return;
    }

    this.overlay.classList.remove('game-screen__overlay--game-over', 'game-screen__overlay--ready');
    if (this.scoreOverlayEl) {
      this.scoreOverlayEl.classList.add('is-hidden');
    }

    if (this.waiting && !this.gameOver) {
      this.overlay.classList.remove('is-hidden');
      this.overlay.classList.add('game-screen__overlay--ready');
      this.statusEl.textContent = 'Espacio / toque';
      this.hintEl.textContent = 'para empezar';
      this.hintEl.classList.remove('is-hidden');
      return;
    }

    if (this.paused) {
      this.overlay.classList.remove('is-hidden');
      this.statusEl.textContent = 'PAUSA';
      this.hintEl.textContent = 'P o Continuar';
      this.hintEl.classList.remove('is-hidden');
      return;
    }

    if (this.gameOver && this.gameOverOverlayReady) {
      this.overlay.classList.remove('is-hidden');
      this.overlay.classList.add('game-screen__overlay--game-over');
      this.statusEl.textContent = 'GAME OVER';
      if (this.scoreOverlayEl) {
        this.scoreOverlayEl.textContent =
          'PTS ' + this.gameOverFreezeScore + ' · RÉCORD ' + this.highScore;
        this.scoreOverlayEl.classList.remove('is-hidden');
      }
      this.hintEl.textContent = 'R, toque o Reiniciar';
      this.hintEl.classList.remove('is-hidden');
      return;
    }

    if (this.gameOver) {
      this.overlay.classList.add('is-hidden');
      return;
    }

    this.overlay.classList.add('is-hidden');
  };

  Game.prototype.intersect = function (a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  };

  /* --- Renderizado en canvas (fondo, suelo, obstáculos y jugador) --- */

  Game.prototype.drawSky = function () {
    var grad = this.ctx.createLinearGradient(0, 0, 0, this.groundY);
    grad.addColorStop(0, SKY_TOP);
    grad.addColorStop(1, SKY_BOTTOM);
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, 0, this.canvas.width, this.groundY);
  };

  Game.prototype.mountainRidgeHeight = function (x, offset, config) {
    var t = (x + offset) * 0.008;
    var h = config.lift;
    h += Math.sin(t * config.f1 + config.seed) * config.a1;
    h += Math.sin(t * config.f2 + config.seed * 1.63) * config.a2;
    h += Math.cos(t * config.f3 + config.seed * 0.41) * config.a3;
    h += Math.sin(t * config.f4 + config.seed * 2.17) * config.a4;
    h += Math.sin(t * 0.53 + config.seed * 0.9) * config.a1 * 0.22;
    return h;
  };

  Game.prototype.drawMountainRidge = function (points, base) {
    var ctx = this.ctx;
    var last = points.length - 1;

    ctx.beginPath();
    ctx.moveTo(points[0].x, base);
    ctx.lineTo(points[0].x, points[0].y);

    for (var i = 1; i < last - 1; i++) {
      var midX = (points[i].x + points[i + 1].x) * 0.5;
      var midY = (points[i].y + points[i + 1].y) * 0.5;
      ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
    }

    ctx.quadraticCurveTo(points[last - 1].x, points[last - 1].y, points[last].x, points[last].y);
    ctx.lineTo(points[last].x, base);
    ctx.closePath();
  };

  Game.prototype.drawDistantMountains = function () {
    var base = this.surfaceY;
    var offset = this.mountainOffset;
    var ctx = this.ctx;
    var width = this.canvas.width;
    var self = this;

    function drawLayer(config) {
      var points = [];
      var sampleStep = config.sampleStep;
      var x;

      for (x = -80; x <= width + 80; x += sampleStep) {
        var ridgeX = x + offset * config.parallax;
        points.push({
          x: x,
          y: base - self.mountainRidgeHeight(ridgeX, 0, config),
        });
      }

      self.drawMountainRidge(points, base);

      var peakY = base - config.lift - config.a1 - config.a2;
      var grad = ctx.createLinearGradient(0, peakY, 0, base);
      grad.addColorStop(0, config.highlight);
      grad.addColorStop(0.45, config.color);
      grad.addColorStop(1, config.shadow);
      ctx.fillStyle = grad;
      ctx.globalAlpha = config.alpha;
      ctx.fill();
    }

    ctx.save();
    drawLayer({
      sampleStep: 6,
      parallax: 0.05,
      seed: 30,
      f1: 2.4,
      a1: 9,
      f2: 5.1,
      a2: 5,
      f3: 8.3,
      a3: 3,
      f4: 13.7,
      a4: 2,
      lift: 14,
      highlight: '#9BCF8E',
      color: '#7CB86E',
      shadow: '#6AA862',
      alpha: 0.24,
    });
    drawLayer({
      sampleStep: 7,
      parallax: 0.09,
      seed: 110,
      f1: 1.9,
      a1: 15,
      f2: 4.2,
      a2: 9,
      f3: 7.1,
      a3: 6,
      f4: 11.4,
      a4: 4,
      lift: 28,
      highlight: '#72B866',
      color: '#5A9F52',
      shadow: '#4A8644',
      alpha: 0.36,
    });
    drawLayer({
      sampleStep: 8,
      parallax: 0.13,
      seed: 210,
      f1: 1.5,
      a1: 22,
      f2: 3.6,
      a2: 14,
      f3: 6.2,
      a3: 9,
      f4: 9.8,
      a4: 6,
      lift: 46,
      highlight: '#4F8E48',
      color: '#3F7A3A',
      shadow: '#2F5E2C',
      alpha: 0.5,
    });
    ctx.restore();
  };

  Game.prototype.drawCloudBlob = function (cx, cy, rx, ry) {
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fill();
  };

  Game.prototype.drawSoftCloud = function (x, y, w, h) {
    this.ctx.save();
    this.ctx.fillStyle = '#F8F8F8';
    this.drawCloudBlob(x + w * 0.22, y + h * 0.55, w * 0.2, h * 0.42);
    this.drawCloudBlob(x + w * 0.42, y + h * 0.45, w * 0.26, h * 0.5);
    this.drawCloudBlob(x + w * 0.62, y + h * 0.52, w * 0.22, h * 0.44);
    this.drawCloudBlob(x + w * 0.8, y + h * 0.58, w * 0.16, h * 0.36);
    this.ctx.restore();
  };

  Game.prototype.drawClouds = function () {
    this.clouds.forEach(function (c) {
      this.drawSoftCloud(c.x, c.y, c.w, c.h);
    }, this);
  };

  Game.prototype.getDecoSize = function (depth, kind) {
    var scale = depth === 'far' ? DECO_SCALE_FAR : DECO_SCALE_NEAR;
    if (kind === 'cactus') {
      scale *= DECO_CACTUS_MUL;
    }
    return 18 * scale;
  };

  Game.prototype.drawDecoPlant = function (sprite, x, groundY, depth, kind) {
    var size = this.getDecoSize(depth, kind);
    this.ctx.drawImage(sprite, x, groundY - size, size, size);
  };

  Game.prototype.drawTree = function (x, groundY, depth) {
    var sp = this.sprites;
    if (!sp.decoTree) {
      return;
    }
    this.drawDecoPlant(sp.decoTree, x, groundY, depth, 'tree');
  };

  Game.prototype.drawSceneryItem = function (item) {
    var sp = this.sprites;

    this.ctx.save();
    if (item.depth === 'far') {
      this.ctx.globalAlpha = 0.72;
    }

    if (item.type === 'tree') {
      this.drawTree(item.x, this.surfaceY, item.depth);
    } else if (item.type === 'cactus' && sp.decoCactus) {
      this.drawDecoPlant(sp.decoCactus, item.x, this.surfaceY, item.depth, 'cactus');
    } else if (item.type === 'sign' && sp.decoSign) {
      this.ctx.drawImage(sp.decoSign, item.x, this.surfaceY - PLAYER_H, PLAYER_W, PLAYER_H);
    }

    this.ctx.restore();
  };

  Game.prototype.drawSceneryLayer = function (depth) {
    var self = this;
    this.scenery.forEach(function (item) {
      if (item.depth === depth) {
        self.drawSceneryItem(item);
      }
    });
  };

  Game.prototype.drawGround = function () {
    var sp = this.sprites;
    if (!sp.groundTop || !sp.groundFill) {
      return;
    }
    var topW = sp.groundTop.width;
    var topH = sp.groundTop.height;
    var fillW = sp.groundFill.width;
    var fillH = sp.groundFill.height;

    for (var y = this.groundY; y < this.canvas.height; y += fillH) {
      for (var fx = 0; fx < this.canvas.width + fillW; fx += fillW) {
        this.ctx.drawImage(sp.groundFill, fx, y);
      }
    }

    for (var x = 0; x < this.canvas.width + topW; x += topW) {
      this.ctx.drawImage(sp.groundTop, x, this.surfaceY);
    }
  };

  Game.prototype.drawPlayer = function () {
    var sp = this.sprites;
    var p = this.player;
    var sprite;

    if (p.jumping) {
      sprite = sp.playerJump;
    } else if (p.frame === 0) {
      sprite = sp.playerRunA;
    } else {
      sprite = sp.playerRunB;
    }

    if (!sprite) {
      return;
    }

    this.ctx.drawImage(sprite, p.x, p.y - p.h);
  };

  Game.prototype.drawObstacle = function (o) {
    var sp = this.sprites;
    if (!sp.obstacle) {
      return;
    }
    var crop = this.getObstacleCrop();
    var stackStep = this.getObstacleStackStep();
    for (var i = 0; i < o.stack; i++) {
      var y = this.surfaceY + crop.snap - crop.h - stackStep * i;
      this.ctx.drawImage(
        sp.obstacle,
        crop.sx,
        crop.sy,
        crop.w,
        crop.h,
        o.x + crop.dx,
        y,
        crop.w,
        crop.h
      );
    }
  };

  Game.prototype.draw = function () {
    /* Orden de capas: cielo → montañas → nubes → decorado lejano → suelo →
       decorado cercano → obstáculos → jugador. HUD se actualiza al final. */
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawSky();
    this.drawDistantMountains();
    this.drawClouds();
    this.drawSceneryLayer('far');
    this.drawGround();
    this.drawSceneryLayer('near');
    this.obstacles.forEach(this.drawObstacle, this);
    this.drawPlayer();
    this.updateScreenHud();
  };

  Game.prototype.destroy = function () {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.unbindEvents();
    if (this.audio) {
      this.audio.destroy();
      this.audio = null;
    }
  };

  /* --- API pública del demo (window.SaltoVerde) --- */

  function mountGame(shell, sprites) {
    /* Solo puede existir una instancia activa; destruye la anterior si la hay */
    if (activeInstance) {
      activeInstance.destroy();
    }
    activeInstance = new Game(shell, sprites);
    var canvas = shell.querySelector('.game-canvas');
    if (canvas) {
      canvas.setAttribute('tabindex', '0');
      canvas.focus({ preventScroll: true });
    }
  }

  window.SaltoVerde = {
    /** Precarga sprites (una sola vez) y monta el juego en el contenedor .game-view */
    mount: function (shell) {
      if (!shell) {
        return Promise.reject(new Error('Contenedor del juego no encontrado'));
      }

      if (cachedSprites) {
        mountGame(shell, cachedSprites);
        return Promise.resolve(cachedSprites);
      }

      if (!window.SaltoVerdeSprites) {
        return Promise.reject(new Error('SaltoVerdeSprites no cargado'));
      }

      return SaltoVerdeSprites.load().then(function (sprites) {
        cachedSprites = sprites;
        mountGame(shell, sprites);
        return sprites;
      });
    },
    /** Detiene el bucle, desvincula eventos y cierra el AudioContext */
    destroy: function () {
      if (activeInstance) {
        activeInstance.destroy();
        activeInstance = null;
      }
    },
    /** Lee el récord persistido en localStorage (clave saltoVerdeHighScore) */
    getHighScore: getHighScore,
  };
})();
