/**
 * Salto Verde — cargador de sprites PNG (pack Kenney «Pixel Platformer», CC0).
 *
 * Módulo IIFE sin dependencias. Debe cargarse antes de `game-runner.js`.
 *
 * Uso:
 *   SaltoVerdeSprites.load().then(function (sprites) {
 *     // sprites.playerRunA, sprites.obstacle, …
 *   });
 *
 * El motor (`game-runner.js`) llama a `load()` internamente en `SaltoVerde.mount()`
 * y cachea el resultado; no hace falta invocarlo a mano salvo en pruebas.
 *
 * Rutas relativas desde la raíz del demo (`index.html`):
 *   assets/player-run-a.png, assets/obstacle.png, …
 *
 * Créditos y tabla de origen Kenney: ver README.md del repositorio.
 */
(function () {
  'use strict';

  /* --- Rutas y mapa de archivos --- */

  /** Prefijo de carpeta respecto a la URL del HTML del demo */
  var SPRITE_BASE = 'assets/';

  /**
   * Nombre lógico (clave en el objeto devuelto) → archivo PNG en `assets/`.
   * Solo se incluyen los 9 gráficos usados en runtime; montañas, nubes y cielo
   * se dibujan por código en game-runner.js.
   */
  var SPRITE_FILES = {
    playerRunA: 'player-run-a.png',   /* Personaje: frame de carrera A */
    playerRunB: 'player-run-b.png',   /* Personaje: frame de carrera B */
    playerJump: 'player-jump.png',    /* Personaje: pose de salto */
    obstacle: 'obstacle.png',         /* Bloque enemigo (recorte 18×18 en el motor) */
    groundTop: 'ground-top.png',      /* Borde superior del suelo */
    groundFill: 'ground-fill.png',    /* Relleno del suelo (se repite en vertical) */
    decoTree: 'deco-tree.png',        /* Decoración: árbol */
    decoCactus: 'deco-cactus.png',    /* Decoración: cactus */
    decoSign: 'deco-sign.png',        /* Decoración: cartel de dirección (flecha) */
  };

  /* --- Carga asíncrona de imágenes --- */

  /**
   * Carga un PNG y devuelve un HTMLImageElement listo para drawImage.
   * @param {string} src — URL o ruta relativa del archivo
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        reject(new Error('No se pudo cargar: ' + src));
      };
      img.src = src;
    });
  }

  /**
   * Precarga en paralelo todos los sprites del juego.
   * @returns {Promise<Record<string, HTMLImageElement>>}
   *   Claves: playerRunA, playerRunB, playerJump, obstacle, groundTop,
   *   groundFill, decoTree, decoCactus, decoSign
   */
  function loadGameSprites() {
    var keys = Object.keys(SPRITE_FILES);
    var promises = keys.map(function (key) {
      return loadImage(SPRITE_BASE + SPRITE_FILES[key]).then(function (img) {
        return { key: key, img: img };
      });
    });

    return Promise.all(promises).then(function (entries) {
      var sprites = {};
      entries.forEach(function (entry) {
        sprites[entry.key] = entry.img;
      });
      return sprites;
    });
  }

  /* --- API pública (window.SaltoVerdeSprites) --- */

  window.SaltoVerdeSprites = {
    /** Precarga todos los PNG; rechaza la Promise si falta algún archivo */
    load: loadGameSprites,
    /** Ruta base expuesta por si el host necesita reubicar assets */
    basePath: SPRITE_BASE,
  };
})();
