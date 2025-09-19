# MVP – Detección de Pérdida de Atención (Web)
Arquitectura 100% cliente (HTML/JS). Sin backend. Cámara vía getUserMedia. TF.js (TM/MediaPipe).
Objetivo: indicador en vivo + logger de pestaña + exportar CSV.
Requisito: HTTPS.

Estructura:
- /src/app.js (flujo)
- /src/metrics.js (FPS/latencia)
- /src/tab-logger.js (visibility/blur/focus)
- /model/ (model.json + pesos)
