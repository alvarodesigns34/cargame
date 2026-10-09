# Costa Drive · Bahía Azul

Juego de conducción 3D para iPad, con un deportivo de tracción trasera, mundo abierto costero y controles multitáctiles. Three.js y WebGL 2. Interfaz en español.

## Jugar

**[Abrir Costa Drive](https://costa-drive.alvarolago2000.chatgpt.site)** · Versión alojada privada para el propietario.

`index.html` contiene el juego completo, Three.js, CSS y JavaScript. No descarga modelos, texturas, fuentes ni dependencias externas. Puede servirse en cualquier alojamiento estático. Para un iPad, la opción recomendada es abrir la dirección alojada en Safari y colocar la pantalla en horizontal. La vista previa de archivos de iPadOS puede no ejecutar JavaScript; usar Safari mediante una dirección web.

```sh
git clone https://github.com/alvarodesigns34/cargame.git
cd cargame
node scripts/serve.mjs
# http://localhost:4173
```

El HTML autónomo también se ha probado directamente con `file://` en Chromium de escritorio. Servir el HTML compilado no requiere instalar paquetes.

## Controles

| Acción | Pantalla táctil | Teclado |
| --- | --- | --- |
| Dirección | Flechas inferiores izquierdas | A / D o ← / → |
| Acelerar | GAS | W o ↑ |
| Frenar / marcha atrás | FRENO; mantener al detenerse para R | S o ↓ |
| Freno de mano | MANO | Espacio |
| Cambiar cámara | Icono de cámara | C |
| Recuperar coche | Flecha circular | R |
| Pausa / desafíos | Pausa o tarjeta de objetivo | Esc |

Puedes mantener dirección, acelerador y freno de mano simultáneamente. Al interrumpirse una pulsación, cambiar de pestaña o perder el foco, se liberan los controles. La partida se pausa al salir de la página. El sonido se activa con el botón ♪.

## Mundo y desafíos

- Ciudad con avenidas, cruces, pasos peatonales, edificios, señales y farolas.
- Carretera costera con curvas, playa, muelles, vegetación, aparcamiento y explanada de derrapes.
- Conducción libre sin límite de tiempo.
- **Vuelta a la costa:** 12 checkpoints en orden, en 150 segundos.
- **A fondo:** alcanzar 120 km/h en 25 segundos.
- **El arte del derrape:** 1.000 puntos dentro de la explanada en 60 segundos.
- Récords locales, combos de derrape, minimapa y guía al siguiente checkpoint. Recuperar el coche añade 5 segundos a una prueba activa.

## Conducción y rendimiento

La física usa unidades SI y un cuerpo rígido plano, con fuerzas laterales independientes en los ejes delantero y trasero. Incluye deslizamiento de neumáticos, límites de adherencia, transferencia de peso, dirección que se suaviza con la velocidad, resistencia aerodinámica, frenado y marcha atrás. El freno de mano reduce la adherencia del eje trasero. Hierba y arena tienen menos agarre y más resistencia que el asfalto. A baja velocidad se combina con un modelo cinemático para que aparcar y maniobrar resulte estable.

La suspensión y el balanceo son visuales. Las colisiones usan una cápsula aproximada por tres círculos, obstáculos sólidos y una cuadrícula espacial. No hay simulación vertical de saltos ni vuelcos, tráfico con IA, destrucción o neumáticos de nivel profesional.

La física avanza a **120 Hz** mediante un acumulador, independientemente del renderizado. Los fotogramas se interpolan. Se limita el tiempo recuperado tras pausas largas para evitar una espiral de trabajo. El mundo usa geometrías procedimentales, materiales compartidos e instancias; la carrocería agrupa piezas por material. Marcas de neumáticos y humo usan buffers limitados y reutilizables.

Calidad automática: resolución limitada a 1,35× y sombras de 1.024 px inicialmente; reduce calidad si detecta una frecuencia baja sostenida. También puedes elegir baja, media o alta. La calidad baja desactiva las sombras y el humo, manteniendo la sombra de contacto del coche. **60 FPS es un objetivo, no una medición en un iPad físico.** El resultado depende del dispositivo y de la temperatura.

## Desarrollo y verificación

```sh
npm ci
npm test
npm run build
# Opcional, comprobación de navegador:
npx playwright install --with-deps chromium
npm run test:browser
```

`npm test` comprueba aceleración, frenado, marcha atrás con dirección, simetría de giros, derrapes, superficies, colisiones, estabilidad y equivalencia de la simulación a 30 / 60 / 120 FPS. También comprueba countdown, orden de checkpoints, récords, límites de tiempo y penalizaciones.

El comprobador de navegador abre el HTML autónomo con pantalla táctil emulada y contactos reales de Chromium mediante CDP. Revisa contactos simultáneos, liberación independiente, cancelación, marcha atrás, cámaras, pausa, desafíos, sonido, tamaños de pantalla y ausencia de solicitudes de red. Guarda capturas e informe en `test-results/`.

También se ha comprobado el arranque, el renderizado y la aceleración en WebKit 18.4 sobre Linux. La emulación de un iPad en Chromium y WebKit **no equivale a una prueba en Safari sobre un iPad físico**. El código se compila para Safari 16 o posterior y requiere WebGL 2. Los mensajes de error contemplan WebGL no disponible y pérdida del contexto gráfico. Añade `?debug=1` para acceder a diagnósticos locales en `window.__costa`.

### Archivos

- `src/physics.js`: vehículo y colisiones.
- `src/world.js`: mapa y modelo del coche.
- `src/input.js`: multitáctil y teclado.
- `src/challenges.js`: desafíos y puntuación.
- `src/audio.js`: audio sintetizado.
- `src/main.js`: bucle, cámaras, efectos y HUD.
- `src/template.html`, `src/style.css`: interfaz.
- `scripts/build.mjs`: genera el único HTML de distribución.

Three.js está fijado a 0.180.0. Su licencia MIT se incluye en el HTML distribuido y en `THIRD_PARTY_NOTICES.md`.
