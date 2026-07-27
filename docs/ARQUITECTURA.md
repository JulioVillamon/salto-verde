# Arquitectura de Salto Verde

> La captura de pantalla del proyecto está en la portada del repositorio: [README.md](../README.md).

## Resumen

El juego se reparte en dos módulos IIFE:

| Archivo | Rol |
|---------|-----|
| `js/sprites.js` | Carga PNG desde `assets/` (`SaltoVerdeSprites.load()`) |
| `js/game-runner.js` | Motor, render, entrada de usuario y API `window.SaltoVerde` |

API pública:

| Método | Descripción |
|--------|-------------|
| `mount(shell)` | Precarga sprites y arranca el juego en `.game-view` (devuelve `Promise`) |
| `destroy()` | Detiene el bucle, libera eventos y cierra el audio |
| `getHighScore()` | Devuelve el récord guardado en localStorage |

## Bucle de juego

1. `requestAnimationFrame` llama a `loop()` en cada fotograma.
2. Si el juego está en espera, anima al jugador en idle (alterna frames de carrera).
3. Si está activo y no pausado, `update()` avanza física, obstáculos, parallax y puntuación.
4. `draw()` pinta cielo, montañas, nubes, decoración, suelo, bloques y el personaje.

## Render

Sprites Kenney «Pixel Platformer» (CC0) en `assets/`:

- Personaje 24×24: `player-run-a`, `player-run-b`, `player-jump`
- Obstáculo: `obstacle` (recorte 18×18, apilable hasta 3)
- Suelo: `ground-top` (18×18) + `ground-fill` (18×18 repetido)
- Decoración: `deco-tree`, `deco-cactus`, `deco-sign` (carteles de dirección; spawn cada 50 pts)
- Fondo: cielo degradado, montañas procedimentales en 3 capas, nubes vectoriales

Canvas interno **640×200 px**; la resolución en pantalla la ajusta `syncCanvasResolution()` para que el buffer coincida con el tamaño CSS (el cielo crece hacia arriba; suelo y personaje permanecen anclados abajo).

## Física

- Gravedad constante (`GRAVITY`) y salto con velocidad inicial negativa (`JUMP_VELOCITY`).
- **Coyote time**: unos fotogramas extra para saltar justo después de soltar el suelo.
- Velocidad horizontal (`speed`) crece cada cierto número de frames hasta un máximo.

## Obstáculos

- Bloques apilados (1 a 3 unidades de 18 px).
- El espacio entre grupos depende de buckets aleatorios (`GAP_SHORT`, `GAP_MID`, etc.) y de la velocidad actual.
- En partidas avanzadas pueden aparecer pares de obstáculos en la misma oleada.

## Audio

La clase `GameAudio` crea un `AudioContext` bajo demanda (requiere gesto del usuario en muchos navegadores).

- **Efectos**: tonos cuadrados/diente de sierra con envolvente de volumen.
- **Música**: tres patrones de notas (`BGM_BASS`, `BGM_PAD`, `BGM_LEAD`) programados con `setTimeout` y osciladores.
- **Por defecto**: sonido desactivado en la primera visita; la música arranca al empezar a jugar (no en la pantalla de espera).

La preferencia se guarda en `localStorage` (`saltoVerdeMuted`).

## Presentación (demo)

### Layout

- Canvas interno **640×200 px**; en pantalla la altura del área de juego es **el doble** que la del panel de control (`SCREEN_PANEL_HEIGHT_RATIO = 2`).
- **Carteles de dirección** (flecha hacia la derecha): uno centrado al arrancar y otro cada **50 puntos** de puntuación (umbrales 50, 100, 150…). Indican el camino a seguir; la puntuación se muestra en el HUD.
- Torres de **3 bloques** posibles desde **100 puntos** (`STACK3_MIN_SCORE`).

### Interfaz pixel (`css/game.css`)

- Fuente **Press Start 2P** en etiquetas `.game-pixel-label` (HUD y overlay).
- HUD: sonido (arriba izquierda) y puntuación (arriba derecha), márgenes `1.25rem`.
- Overlay centrado en el canvas con mensajes para teclado y táctil.

### Efecto CRT

Implementado en CSS sobre `.game-screen__stage` (véase comentarios en `css/game.css`):

| Capa | Elemento | z-index |
|------|----------|---------|
| Canvas | `.game-canvas` | 0 |
| Scanlines + viñeta | `::before` / `::after` del stage | 1 |
| Barra de barrido | `.game-screen__crt-bar` (HTML) | 2 |
| HUD | `.game-screen__hud` | 3 |
| Overlay | `.game-screen__overlay` | 4 |

Todas las capas decorativas usan `pointer-events: none` para no interferir con el tacto.

### Entrada de usuario

| Plataforma | Saltar / empezar | Pausa | Reiniciar |
|------------|------------------|-------|-----------|
| Teclado | Espacio / ↑ | P | R |
| Móvil | Toque en `.game-screen` (canvas + marco) | Botón | Botón / toque en game over |
| Escritorio | Espacio / ↑ (clic solo enfoca el canvas) | Botón | Botón / R |

En móvil el listener táctil se limita a `.game-screen`; el panel de control y el resto de la página quedan fuera.

## Persistencia

| Clave | Contenido |
|-------|-----------|
| `saltoVerdeHighScore` | Mejor puntuación entera |
| `saltoVerdeMuted` | `1` silenciado (por defecto), `0` con sonido |

## Requisitos del DOM

El contenedor `.game-view` debe incluir como mínimo:

```text
.game-view
├── .game-screen                    ← zona táctil en móvil
│   └── .game-screen__stage
│       ├── .game-canvas
│       ├── .game-screen__crt-bar   (span, efecto CRT)
│       ├── .game-screen__hud
│       │   ├── .game-screen__sound
│       │   └── .game-screen__pts
│       └── .game-screen__overlay
│           ├── .game-screen__status
│           ├── .game-screen__score
│           └── .game-screen__hint
└── .game-control-panel
    ├── .game-pause
    ├── .game-restart
    ├── .game-mute
    └── .game-record
```

Ver `index.html` de esta carpeta como referencia completa.

## Integración en juliovillamon.com

También publico Salto Verde en mi sitio personal, [juliovillamon.com/juego](https://www.juliovillamon.com/juego), como easter egg. Es la misma mecánica y la misma presentación visual (efecto CRT, HUD pixel y controles para teclado y táctil).
