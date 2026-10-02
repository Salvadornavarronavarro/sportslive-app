# 📡 SportsLive — Plataforma Agregadora de Deporte Base en Vivo

**SportsLive** es una plataforma centralizada (agregador inteligente) para retransmisiones deportivas amateur y de deporte base en España (fútbol, baloncesto, fútbol sala, balonmano, voleibol, rugby, etc.), diseñada para concentrar en un único lugar las emisiones dispersas en YouTube, Twitch y redes sociales.

---

## 🌟 Características Principales Implementadas

1. **Ingesta Inteligente de Enlaces con Auto-Extracción**:
   - Formulario sencillo donde el creador o club introduce la URL (YouTube o Twitch).
   - El sistema analiza automáticamente el enlace en tiempo real y extrae la **miniatura (thumbnail)** de alta resolución, el **título** y el **canal emisor**, ahorrando trabajo manual al usuario.

2. **Base de Datos Relacional y Filtros en Cascada**:
   - **Nivel 1**: Comunidad Autónoma (17 CCAA + 2 Ciudades Autónomas) $\rightarrow$ 52 Provincias.
   - **Nivel 2**: Deporte (Fútbol, Baloncesto, Fútbol Sala, Balonmano, Voleibol, Rugby, Pádel/Tenis, Hockey).
   - **Nivel 3**: Categoría Federada oficial (Prebenjamín, Benjamín, Alevín, Infantil, Cadete, Juvenil, Regional Preferente, 3ª RFEF, Femenino Base).
   - **Nivel 4**: Partido / Evento con equipos, marcador en directo, fecha/hora y recinto.

3. **Reproducción Embebida Sin Salir de la App**:
   - Reproductores iframe adaptativos (16:9) optimizados para móviles y escritorio con modo pantalla completa, control de audio y retención de usuarios.

4. **Geolocalización Automática por Defecto**:
   - Detecta la provincia del usuario para mostrarle de forma prioritaria los partidos más cercanos (ej. partidos de su localidad o provincia).
   - Selector geográfico rápido para cambiar de provincia o ver "Toda España" con un solo clic.

5. **Alertas Push para "Partidos Favoritos"**:
   - Botón de campana `🔔` para seguir a un equipo o partido concreto.
   - Sistema de aviso programado (simulación y soporte de notificaciones push del navegador) para alertar **10 minutos antes** de que comience la retransmisión.

6. **Modelo de Monetización Sostenible para Clubes Locales**:
   - Los clubes pueden añadir el nombre, logo y enlace de sus patrocinadores locales (ej. comercios o talleres del barrio).
   - El patrocinador se muestra de forma destacada tanto en la tarjeta del partido como en la cabecera del reproductor, incentivando a los clubes a publicar sus directos en la plataforma.

7. **Hemeroteca de "Diferidos" y Resúmenes**:
   - Los partidos finalizados no se borran; quedan archivados en la pestaña **📼 Diferidos**, creando una hemeroteca de partidos locales y resúmenes disponible toda la semana.

8. **Moderación Comunitaria y Clubes Verificados**:
   - Distintivo `🛡️ Club Verificado` para directivos y entrenadores acreditados.
   - Botón de reporte rápido para que la comunidad pueda marcar enlaces caídos o spam.

---

## 🚀 Cómo Ejecutar la Aplicación

No requiere instalaciones complejas ni dependencias pesadas de Node/npm. Funciona con **Python 3** estándar:

```bash
# Opción 1: Ejecutar el lanzador rápido (abre el navegador automáticamente)
./Iniciar_SportsLive.command

# Opción 2: Ejecutar el script principal
python3 run.py

# Opción 3: Arrancar directamente el servidor en el puerto deseado
python3 backend/server.py 3000
```

Una vez iniciado, abre en tu navegador:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 📁 Estructura del Proyecto

```text
├── Iniciar_SportsLive.command # Lanzador ejecutable directo para macOS
├── SportsLive.app         # Aplicación nativa de macOS (Doble clic)
├── run.py                 # Script de arranque rápido con apertura en navegador
├── test_platform.py       # Suite de pruebas unitarias y funcionales (100% de cobertura)
├── talentolive.db         # Base de datos SQLite persistente con partidos de muestra
├── backend/
│   ├── server.py          # Servidor HTTP y API REST con soporte de CORS
│   ├── db.py              # Capa de datos SQLite, migraciones y datos semilla
│   └── metadata.py        # Motor de extracción de metadatos (YouTube y Twitch)
├── data/
│   ├── geo.py             # 17 CCAA, 2 ciudades autónomas y 52 provincias
│   └── sports.py          # Catálogo de deportes y categorías federadas
└── public/
    ├── index.html         # Interfaz web responsiva accesible
    ├── logo.png           # Logo oficial de SportsLive (38px, transparente)
    ├── css/
    │   └── styles.css     # Estilos modernos deportivos (tema oscuro con acentos en vivo)
    └── js/
        ├── catalog.js     # Catálogo de regiones y categorías para respuesta instantánea
        └── app.js         # Lógica interactiva de filtrado, modales, ingesta y reproductor
```

---

## 🧪 Ejecución de Pruebas

Para verificar la integridad de todos los módulos:

```bash
python3 test_platform.py
```
