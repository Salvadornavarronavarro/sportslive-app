"""
Gestor de base de datos SQLite para TalentoLive (Deporte Base en Directo).
"""

import sqlite3
import os
import uuid
import datetime
import hashlib
import secrets
import json
import re
from data.geo import get_province_info, CCAA_PROVINCIAS
from data.sports import get_sport_info
from backend.metadata import extract_metadata_from_url

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "talentolive.db")
LEGACY_DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "grada_directo.db")

_initializing = False

def get_db():
    global _initializing
    if not os.path.exists(DB_PATH) and os.path.exists(LEGACY_DB_PATH):
        import shutil
        try:
            shutil.copy2(LEGACY_DB_PATH, DB_PATH)
        except Exception:
            pass
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA busy_timeout=5000;")
        conn.execute("PRAGMA synchronous=NORMAL;")
    except Exception:
        pass

    if not _initializing:
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='events'")
            if not cursor.fetchone():
                _initializing = True
                init_db()
                _initializing = False
        except Exception:
            _initializing = False

    return conn

def init_db():
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            url_original TEXT NOT NULL,
            platform TEXT NOT NULL,
            embed_id TEXT,
            embed_url TEXT NOT NULL,
            thumbnail TEXT,
            status TEXT NOT NULL CHECK(status IN ('LIVE', 'UPCOMING', 'REPLAY')),
            date_time TEXT NOT NULL,
            sport_id TEXT NOT NULL,
            sport_name TEXT,
            sport_icon TEXT,
            category_id TEXT NOT NULL,
            category_name TEXT,
            ccaa_id TEXT NOT NULL,
            ccaa_name TEXT,
            region TEXT DEFAULT '',
            province_id TEXT NOT NULL,
            province_name TEXT,
            home_team TEXT NOT NULL,
            away_team TEXT NOT NULL,
            home_score INTEGER,
            away_score INTEGER,
            location_venue TEXT,
            is_verified_club INTEGER DEFAULT 0,
            club_name TEXT,
            sponsor_name TEXT,
            sponsor_logo TEXT,
            sponsor_url TEXT,
            report_count INTEGER DEFAULT 0,
            views_count INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );
        """)

        # Migración segura: añadir created_by_user_id si no existe
        cursor.execute("PRAGMA table_info(events);")
        cols = [row[1] for row in cursor.fetchall()]
        if "created_by_user_id" not in cols:
            cursor.execute("ALTER TABLE events ADD COLUMN created_by_user_id TEXT;")
        if "modality" not in cols:
            cursor.execute("ALTER TABLE events ADD COLUMN modality TEXT DEFAULT '';")
        if "discipline" not in cols:
            cursor.execute("ALTER TABLE events ADD COLUMN discipline TEXT DEFAULT '';")

        # Tabla de usuarios con 3 roles (aficionado/viewer, club, admin) y verificación
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('aficionado', 'viewer', 'club', 'admin')),
            club_name TEXT,
            full_name TEXT,
            cif TEXT DEFAULT '',
            location TEXT DEFAULT '',
            is_verified INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );
        """)

        # Migración segura si la tabla users existía con esquema anterior (sin 'aficionado' en CHECK o sin is_verified)
        cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")
        table_def = cursor.fetchone()
        if table_def and ("'aficionado'" not in table_def[0] or "is_verified" not in table_def[0]):
            cursor.execute("ALTER TABLE users RENAME TO users_old;")
            cursor.execute("""
            CREATE TABLE users (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('aficionado', 'viewer', 'club', 'admin')),
                club_name TEXT,
                full_name TEXT,
                cif TEXT DEFAULT '',
                location TEXT DEFAULT '',
                is_verified INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );
            """)
            cursor.execute("PRAGMA table_info(users_old);")
            old_cols = [c[1] for c in cursor.fetchall()]
            cif_expr = "cif" if "cif" in old_cols else "''"
            loc_expr = "location" if "location" in old_cols else "''"
            ver_expr = "is_verified" if "is_verified" in old_cols else "CASE WHEN role IN ('admin', 'club') THEN 1 ELSE 0 END"
            cursor.execute(f"""
            INSERT INTO users (id, username, email, password_hash, salt, role, club_name, full_name, cif, location, is_verified, created_at)
            SELECT id, username, email, password_hash, salt, role, club_name, full_name, {cif_expr}, {loc_expr}, {ver_expr}, created_at
            FROM users_old;
            """)
            cursor.execute("DROP TABLE users_old;")
            conn.commit()

        # Añadir columna favorite_clubs si no existe
        cursor.execute("PRAGMA table_info(users);")
        user_cols = [c[1] for c in cursor.fetchall()]
        if "favorite_clubs" not in user_cols:
            cursor.execute("ALTER TABLE users ADD COLUMN favorite_clubs TEXT DEFAULT '[]';")
            conn.commit()

        # Tabla de sesiones persistentes
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """)
        conn.commit()

        # Eventos exclusivos de clubes autorizados (no sembrar eventos mock)
        # seed_sample_events(cursor)

        # Asegurar usuarios por defecto
        seed_default_users(cursor)
        conn.commit()

        # Migración automática de emails existentes si fuera necesario
        try:
            cursor.execute("UPDATE users SET email = replace(email, '@gradadirecto.es', '@talentolive.es') WHERE email LIKE '%@gradadirecto.es';")
            conn.commit()
        except Exception:
            pass

        # Asegurar que todas las emisiones en la BD carguen en pausa (autoplay=0 y autoplay=false)
        try:
            cursor.execute("UPDATE events SET embed_url = replace(embed_url, 'autoplay=1', 'autoplay=0') WHERE embed_url LIKE '%autoplay=1%';")
            cursor.execute("UPDATE events SET embed_url = replace(embed_url, 'autoplay=true', 'autoplay=false') WHERE embed_url LIKE '%autoplay=true%';")
            conn.commit()
        except Exception:
            pass

        # Tabla de mensajes del chat en vivo por evento
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL,
            user_id TEXT,
            user_name TEXT NOT NULL,
            user_role TEXT DEFAULT 'viewer',
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_chat_event_time ON chat_messages(event_id, created_at);")

        # Tabla de solicitudes de patrocinio comercial (leads publicitarios)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sponsor_leads (
            id TEXT PRIMARY KEY,
            company_name TEXT NOT NULL,
            contact_info TEXT NOT NULL,
            interest TEXT,
            plan_name TEXT,
            message TEXT,
            created_at TEXT NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sponsor_leads_time ON sponsor_leads(created_at);")
        
        # Dejar libre el patrocinador de evt-1 para mostrar la franja de espacio publicitario disponible
        try:
            cursor.execute("UPDATE events SET sponsor_name = '', sponsor_logo = '', sponsor_url = '' WHERE id = 'evt-1';")
        except Exception:
            pass
        conn.commit()

        # Sembrar mensajes iniciales de prueba si está vacía
        cursor.execute("SELECT COUNT(*) FROM chat_messages;")
        if cursor.fetchone()[0] == 0:
            seed_sample_chat_messages(cursor)
            conn.commit()

        # Migración segura: campos de canal, duración y tipo de contenido en events
        cursor.execute("PRAGMA table_info(events);")
        ev_cols = [row[1] for row in cursor.fetchall()]
        if "content_type" not in ev_cols:
            cursor.execute("ALTER TABLE events ADD COLUMN content_type TEXT DEFAULT 'live';")
        if "club_id" not in ev_cols:
            cursor.execute("ALTER TABLE events ADD COLUMN club_id TEXT;")
        if "channel_url" not in ev_cols:
            cursor.execute("ALTER TABLE events ADD COLUMN channel_url TEXT DEFAULT '';")
        if "duration" not in ev_cols:
            cursor.execute("ALTER TABLE events ADD COLUMN duration TEXT DEFAULT '';")
        if "region" not in ev_cols:
            cursor.execute("ALTER TABLE events ADD COLUMN region TEXT DEFAULT '';")

        # Asegurar consistencia de datos de región y datos específicos de la Comunidad Valenciana
        cursor.execute("UPDATE events SET region = ccaa_name WHERE (region IS NULL OR region = '') AND ccaa_name IS NOT NULL;")
        cursor.execute("""
        UPDATE events 
        SET region = 'Comunidad Valenciana', ccaa_id = 'comunidad-valenciana', ccaa_name = 'Comunidad Valenciana', province_id = 'valencia', province_name = 'Valencia' 
        WHERE id = 'evt-5';
        """)

        cursor.execute("SELECT COUNT(*) FROM events WHERE id = 'evt-elche-villarreal-juv';")
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
            INSERT INTO events (
                id, title, url_original, platform, embed_id, embed_url, thumbnail,
                status, date_time, sport_id, sport_name, sport_icon,
                category_id, category_name, ccaa_id, ccaa_name, region,
                province_id, province_name, home_team, away_team,
                home_score, away_score, location_venue, is_verified_club,
                club_name, sponsor_name, sponsor_logo, sponsor_url,
                report_count, views_count, created_at, created_by_user_id,
                content_type, club_id, channel_url, duration
            ) VALUES (
                'evt-elche-villarreal-juv',
                'Liga Nacional Juvenil: Elche C.F. Juvenil A vs Villarreal C.F.',
                'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
                'youtube',
                'aqz-KE-bpKQ',
                'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=0&modestbranding=1&rel=0',
                'https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60',
                'LIVE',
                '2026-09-14T18:00:00',
                'futbol',
                'Fútbol',
                '⚽',
                'juvenil',
                'Juvenil',
                'comunidad-valenciana',
                'Comunidad Valenciana',
                'Comunidad Valenciana',
                'alicante',
                'Alicante',
                'Elche C.F. Juvenil A',
                'Villarreal C.F.',
                1,
                0,
                'Campo Diego Quiles - Ciudad Deportiva Juan Ángel Romero (Elche)',
                1,
                'Cantera Franjiverde',
                'Calzados Elche Artesanos',
                '👞',
                'https://calzadoselche.es',
                0,
                280,
                '2026-09-14T12:00:00',
                'usr-admin-1',
                'live',
                'club-elche-base',
                'https://www.youtube.com/@elchecf',
                ''
            );
            """)
            conn.commit()
      

  
        # Tabla oficial de clubes y canales
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS clubs (
            id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            shield_url TEXT DEFAULT '',
            shield_icon TEXT DEFAULT '🛡️',
            location TEXT DEFAULT '',
            province_id TEXT DEFAULT '',
            province_name TEXT DEFAULT '',
            ccaa_id TEXT DEFAULT '',
            ccaa_name TEXT DEFAULT '',
            category TEXT DEFAULT '',
            sport_id TEXT DEFAULT 'futbol',
            sport_name TEXT DEFAULT 'Fútbol',
            sport_icon TEXT DEFAULT '⚽',
            channel_url TEXT DEFAULT '',
            is_verified INTEGER DEFAULT 1,
            description TEXT DEFAULT '',
            user_id TEXT,
            created_at TEXT NOT NULL
        );
        """)
        cursor.execute("PRAGMA table_info(clubs);")
        club_cols = [row[1] for row in cursor.fetchall()]
        if "channel_url" not in club_cols:
            cursor.execute("ALTER TABLE clubs ADD COLUMN channel_url TEXT DEFAULT '';")
        if "modality" not in club_cols:
            cursor.execute("ALTER TABLE clubs ADD COLUMN modality TEXT DEFAULT '';")
        if "discipline" not in club_cols:
            cursor.execute("ALTER TABLE clubs ADD COLUMN discipline TEXT DEFAULT '';")
        if "is_active" not in club_cols:
            cursor.execute("ALTER TABLE clubs ADD COLUMN is_active INTEGER DEFAULT 1;")
        if "approved_by_admin" not in club_cols:
            cursor.execute("ALTER TABLE clubs ADD COLUMN approved_by_admin INTEGER DEFAULT 1;")

        # Tabla de mensajes del chat de comunidad del club (independiente del chat de partido)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS club_chat_messages (
            id TEXT PRIMARY KEY,
            club_id TEXT NOT NULL,
            user_id TEXT,
            user_name TEXT NOT NULL,
            user_role TEXT DEFAULT 'viewer',
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_club_chat_time ON club_chat_messages(club_id, created_at);")

        # Eliminación estricta de clubes mock y contenidos residuales de prueba
        cursor.execute("""
        DELETE FROM clubs 
        WHERE id IN (
            'cd-las-rozas', 'cantera-joventut', 'sevilla-fc-cantera', 'academia-inter-fs',
            'cantera-granota', 'cb-granollers', 'barakaldo-cf', 'real-zaragoza-cantera',
            'cantera-unicaja', 'cf-fuenlabrada-cantera', 'fight-club-madrid'
        ) OR created_at = '2026-09-01T10:00:00';
        """)
        cursor.execute("UPDATE clubs SET is_active = 1, approved_by_admin = 1 WHERE is_active IS NULL OR approved_by_admin IS NULL;")

        # Eliminación de eventos que no pertenecen a clubes activos dados de alta y autorizados por el Admin
        cursor.execute("""
        DELETE FROM events 
        WHERE (club_id NOT IN (SELECT id FROM clubs WHERE is_active = 1 AND approved_by_admin = 1) OR club_id IS NULL)
          AND (club_name NOT IN (SELECT name FROM clubs WHERE is_active = 1 AND approved_by_admin = 1) OR club_name IS NULL);
        """)

        # Normalizar club_id en eventos restantes si estuviera vacío
        cursor.execute("""
        UPDATE events 
        SET club_id = (SELECT id FROM clubs WHERE clubs.name = events.club_name)
        WHERE (club_id IS NULL OR club_id = '') AND club_name IN (SELECT name FROM clubs);
        """)

        # Limpiar mensajes de chat huérfanos
        cursor.execute("""
        DELETE FROM club_chat_messages 
        WHERE club_id NOT IN (SELECT id FROM clubs WHERE is_active = 1 AND approved_by_admin = 1)
          AND club_id NOT IN (SELECT name FROM clubs WHERE is_active = 1 AND approved_by_admin = 1);
        """)

        # Limpiar usuarios de prueba residuales
        cursor.execute("DELETE FROM users WHERE username IN ('cd_lasrozas', 'joventut');")

        # Limpiar cualquier evento residual de pruebas en caso de que persista
        cursor.execute("DELETE FROM events WHERE title LIKE '%Caso Borde%' OR home_team LIKE '%Test Local%' OR title LIKE '%Test Local%';")
        conn.commit()
    finally:
        conn.close()

def hash_password(password: str, salt: str = None) -> tuple:
    if not salt:
        salt = secrets.token_hex(16)
    salted = f"{salt}:{password}".encode("utf-8")
    hashed = hashlib.sha256(salted).hexdigest()
    return hashed, salt

def verify_password(password: str, hashed: str, salt: str) -> bool:
    calc_hash, _ = hash_password(password, salt)
    return secrets.compare_digest(calc_hash, hashed)

def seed_default_users(cursor):
    now_iso = datetime.datetime.now().isoformat()
    default_users = [
        {
            "id": "usr-admin-1",
            "username": "admin",
            "email": "salvador@talentolive.es",
            "password": "admin123",
            "role": "admin",
            "club_name": None,
            "full_name": "Administrador General",
            "cif": "",
            "location": "Madrid",
            "is_verified": 1
        },
        {
            "id": "usr-viewer-1",
            "username": "aficionado",
            "email": "aficionado@talentolive.es",
            "password": "user123",
            "role": "viewer",
            "club_name": None,
            "full_name": "Aficionado al Deporte Base",
            "cif": "",
            "location": "España",
            "is_verified": 0
        }
    ]

    for u in default_users:
        uname = u["username"].strip().lower()
        uemail = u["email"].strip().lower()
        cursor.execute("SELECT id FROM users WHERE id = ? OR username = ? OR email = ?", (u["id"], uname, uemail))
        if cursor.fetchone():
            continue
        p_hash, salt = hash_password(u["password"])
        cursor.execute("""
        INSERT INTO users (id, username, email, password_hash, salt, role, club_name, full_name, cif, location, is_verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            u["id"],
            uname,
            uemail,
            p_hash,
            salt,
            u["role"],
            u["club_name"],
            u["full_name"],
            u.get("cif", ""),
            u.get("location", ""),
            u.get("is_verified", 0),
            now_iso
        ))

def seed_sample_events(cursor):
    sample_events = [
        {
            "id": "evt-1",
            "title": "Jornada 4: C.D. Las Rozas Cadete A vs C.F. Pozuelo Cadete A",
            "url_original": "https://www.youtube.com/watch?v=s4OxKQGmn4g",
            "platform": "youtube",
            "embed_id": "s4OxKQGmn4g",
            "embed_url": "https://www.youtube-nocookie.com/embed/s4OxKQGmn4g?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60",
            "status": "LIVE",
            "date_time": "2026-09-14T12:00:00",
            "sport_id": "futbol",
            "category_id": "cadete",
            "province_id": "madrid",
            "home_team": "C.D. Las Rozas Cadete A",
            "away_team": "C.F. Pozuelo Cadete A",
            "home_score": 2,
            "away_score": 1,
            "location_venue": "Polideportivo Municipal Dehesa de Navalcarbón (Las Rozas)",
            "is_verified_club": 1,
            "club_name": "C.D. Las Rozas",
            "sponsor_name": "Restaurante El Asador de Las Rozas",
            "sponsor_logo": "🥩",
            "sponsor_url": "https://elasadorlasrozas.com",
            "report_count": 0,
            "views_count": 342,
            "created_at": "2026-09-14T10:00:00"
        },
        {
            "id": "evt-2",
            "title": "Final Autonómica Junior: Joventut Badalona B vs Basquet Manresa",
            "url_original": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            "platform": "youtube",
            "embed_id": "aqz-KE-bpKQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "",
            "status": "LIVE",
            "date_time": "2026-09-14T12:30:00",
            "sport_id": "baloncesto",
            "category_id": "junior",
            "province_id": "barcelona",
            "home_team": "Joventut Badalona B",
            "away_team": "Bàsquet Manresa",
            "home_score": 48,
            "away_score": 45,
            "location_venue": "Pavelló Olímpic de Badalona (Pista 2)",
            "is_verified_club": 1,
            "club_name": "Cantera Joventut",
            "sponsor_name": "Fisioterapia & Salut Badalona",
            "sponsor_logo": "🩺",
            "sponsor_url": "https://fisioterapiabadalona.cat",
            "report_count": 0,
            "views_count": 512,
            "created_at": "2026-09-14T11:00:00"
        },
        {
            "id": "evt-3",
            "title": "Liga Femenina Juvenil: Sevilla F.C. Femenino vs Real Betis Féminas B",
            "url_original": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "platform": "youtube",
            "embed_id": "dQw4w9WgXcQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=800&auto=format&fit=crop&q=60",
            "status": "LIVE",
            "date_time": "2026-09-14T12:15:00",
            "sport_id": "futbol",
            "category_id": "femenino_base",
            "province_id": "sevilla",
            "home_team": "Sevilla F.C. Juv. Fem.",
            "away_team": "Real Betis Juv. Fem.",
            "home_score": 1,
            "away_score": 1,
            "location_venue": "Ciudad Deportiva José Ramón Cisneros Palacios",
            "is_verified_club": 1,
            "club_name": "Sevilla FC Cantera",
            "sponsor_name": "Supermercados El Triunfo de Triana",
            "sponsor_logo": "🛒",
            "sponsor_url": "https://supermercadostriana.es",
            "report_count": 0,
            "views_count": 890,
            "created_at": "2026-09-14T09:30:00"
        },
        {
            "id": "evt-4",
            "title": "División de Honor Juvenil FS: Movistar Inter FS vs ElPozo Murcia Sub-19",
            "url_original": "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
            "platform": "youtube",
            "embed_id": "kJQP7kiw5Fk",
            "embed_url": "https://www.youtube-nocookie.com/embed/kJQP7kiw5Fk?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&auto=format&fit=crop&q=60",
            "status": "LIVE",
            "date_time": "2026-09-14T12:45:00",
            "sport_id": "futsal",
            "category_id": "juvenil_dh",
            "province_id": "madrid",
            "home_team": "Inter FS Juvenil DH",
            "away_team": "ElPozo Murcia Sub-19",
            "home_score": 3,
            "away_score": 2,
            "location_venue": "Pabellón Jorge Garbajosa (Torrejón de Ardoz)",
            "is_verified_club": 1,
            "club_name": "Academia Inter FS",
            "sponsor_name": "",
            "sponsor_logo": "",
            "sponsor_url": "",
            "report_count": 0,
            "views_count": 620,
            "created_at": "2026-09-14T11:15:00"
        },
        {
            "id": "evt-5",
            "title": "Derbi Alevín: Levante U.D. Alevín A vs Valencia C.F. Alevín A",
            "url_original": "https://www.youtube.com/watch?v=3JZ_D3ELwOQ",
            "platform": "youtube",
            "embed_id": "3JZ_D3ELwOQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/3JZ_D3ELwOQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800&auto=format&fit=crop&q=60",
            "status": "UPCOMING",
            "date_time": "2026-09-14T17:30:00",
            "sport_id": "futbol",
            "category_id": "alevin",
            "province_id": "valencia",
            "region": "Comunidad Valenciana",
            "home_team": "Levante U.D. Alevín A",
            "away_team": "Valencia C.F. Alevín A",
            "home_score": None,
            "away_score": None,
            "location_venue": "Ciudad Deportiva de Buñol",
            "is_verified_club": 1,
            "club_name": "Cantera Granota",
            "sponsor_name": "Horno Artesano San Vicente",
            "sponsor_logo": "🥖",
            "sponsor_url": "https://hornosanvicente.es",
            "report_count": 0,
            "views_count": 210,
            "created_at": "2026-09-13T20:00:00"
        },
        {
            "id": "evt-elche-villarreal-juv",
            "title": "Liga Nacional Juvenil: Elche C.F. Juvenil A vs Villarreal C.F.",
            "url_original": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            "platform": "youtube",
            "embed_id": "aqz-KE-bpKQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60",
            "status": "LIVE",
            "date_time": "2026-09-14T18:00:00",
            "sport_id": "futbol",
            "category_id": "juvenil",
            "province_id": "alicante",
            "region": "Comunidad Valenciana",
            "home_team": "Elche C.F. Juvenil A",
            "away_team": "Villarreal C.F.",
            "home_score": 1,
            "away_score": 0,
            "location_venue": "Campo Diego Quiles - Ciudad Deportiva Juan Ángel Romero (Elche)",
            "is_verified_club": 1,
            "club_name": "Cantera Franjiverde",
            "sponsor_name": "Calzados Elche Artesanos",
            "sponsor_logo": "👞",
            "sponsor_url": "https://calzadoselche.es",
            "report_count": 0,
            "views_count": 280,
            "created_at": "2026-09-14T12:00:00"
        },
        {
            "id": "evt-6",
            "title": "1ª División Nacional Balonmano: C.B. Granollers Juvenil vs BM La Roca",
            "url_original": "https://www.youtube.com/watch?v=9bZkp7q19f0",
            "platform": "youtube",
            "embed_id": "9bZkp7q19f0",
            "embed_url": "https://www.youtube-nocookie.com/embed/9bZkp7q19f0?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1519766304817-4f37bda74a29?w=800&auto=format&fit=crop&q=60",
            "status": "UPCOMING",
            "date_time": "2026-09-14T19:00:00",
            "sport_id": "balonmano",
            "category_id": "juvenil",
            "province_id": "barcelona",
            "home_team": "Fraikin BM Granollers Juv.",
            "away_team": "BM La Roca",
            "home_score": None,
            "away_score": None,
            "location_venue": "Palau d'Esports de Granollers",
            "is_verified_club": 1,
            "club_name": "BM Granollers Base",
            "sponsor_name": "Carpintería Metálica Vallès",
            "sponsor_logo": "🚪",
            "sponsor_url": "https://metalicavalles.com",
            "report_count": 0,
            "views_count": 140,
            "created_at": "2026-09-13T18:00:00"
        },
        {
            "id": "evt-7",
            "title": "Regional Preferente Grupo 1: Barakaldo C.F. B vs Santutxu F.C.",
            "url_original": "https://www.youtube.com/watch?v=fJ9rUzIMcZQ",
            "platform": "youtube",
            "embed_id": "fJ9rUzIMcZQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/fJ9rUzIMcZQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1560272564-c83b66b1ad12?w=800&auto=format&fit=crop&q=60",
            "status": "UPCOMING",
            "date_time": "2026-09-14T20:00:00",
            "sport_id": "futbol",
            "category_id": "regional",
            "province_id": "bizkaia",
            "home_team": "Barakaldo C.F. B",
            "away_team": "Santutxu F.C.",
            "home_score": None,
            "away_score": None,
            "location_venue": "Campo Municipal de Lasesarre",
            "is_verified_club": 1,
            "club_name": "Barakaldo CF",
            "sponsor_name": "Sidrería Iparralde Barakaldo",
            "sponsor_logo": "🍏",
            "sponsor_url": "https://sidreriaiparralde.eus",
            "report_count": 0,
            "views_count": 315,
            "created_at": "2026-09-13T15:00:00"
        },
        {
            "id": "evt-8",
            "title": "[DIFERIDO COMPLETO] Semifinal Copa Infantil: Real Zaragoza Infantil vs C.D. Ebro",
            "url_original": "https://www.youtube.com/watch?v=2Vv-BfVoq4g",
            "platform": "youtube",
            "embed_id": "2Vv-BfVoq4g",
            "embed_url": "https://www.youtube-nocookie.com/embed/2Vv-BfVoq4g?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=800&auto=format&fit=crop&q=60",
            "status": "REPLAY",
            "date_time": "2026-09-12T11:00:00",
            "sport_id": "futbol",
            "category_id": "infantil",
            "province_id": "zaragoza",
            "home_team": "Real Zaragoza Infantil A",
            "away_team": "C.D. Ebro Infantil",
            "home_score": 3,
            "away_score": 1,
            "location_venue": "Ciudad Deportiva Real Zaragoza",
            "is_verified_club": 1,
            "club_name": "Cantera Blanquilla",
            "sponsor_name": "Cafetería La Ribera del Ebro",
            "sponsor_logo": "☕",
            "sponsor_url": "https://caferibera.es",
            "report_count": 0,
            "views_count": 1420,
            "created_at": "2026-09-12T13:30:00"
        },
        {
            "id": "evt-9",
            "title": "[DIFERIDO] Liga Cadete Baloncesto: Unicaja Málaga vs Real Betis Baloncesto",
            "url_original": "https://www.youtube.com/watch?v=OPf0YbXqDm0",
            "platform": "youtube",
            "embed_id": "OPf0YbXqDm0",
            "embed_url": "https://www.youtube-nocookie.com/embed/OPf0YbXqDm0?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1519861531473-9200262188bf?w=800&auto=format&fit=crop&q=60",
            "status": "REPLAY",
            "date_time": "2026-09-11T18:00:00",
            "sport_id": "baloncesto",
            "category_id": "cadete",
            "province_id": "malaga",
            "home_team": "Unicaja Andalucía Cadete",
            "away_team": "Betis Baloncesto Cadete",
            "home_score": 74,
            "away_score": 68,
            "location_venue": "Pabellón Los Guindos (Málaga)",
            "is_verified_club": 1,
            "club_name": "Cantera Unicaja",
            "sponsor_name": "Heladerías Costa del Sol",
            "sponsor_logo": "🍦",
            "sponsor_url": "https://heladoscostadelsol.com",
            "report_count": 0,
            "views_count": 980,
            "created_at": "2026-09-11T20:30:00"
        },
        {
            "id": "evt-mma-madrid",
            "title": "Combate Estelar Peso Ligero: David Gómez vs Marc Soler - Liga Nacional MMA",
            "url_original": "https://www.youtube.com/watch?v=s4OxKQGmn4g",
            "platform": "youtube",
            "embed_id": "s4OxKQGmn4g",
            "embed_url": "https://www.youtube-nocookie.com/embed/s4OxKQGmn4g?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1549719386-74dfcbf7dbed?w=800&auto=format&fit=crop&q=60",
            "status": "LIVE",
            "date_time": "2026-09-29T20:00:00",
            "sport_id": "contacto",
            "category_id": "mma",
            "modality": "MMA",
            "discipline": "MMA",
            "province_id": "madrid",
            "region": "Comunidad de Madrid",
            "home_team": "David Gómez (Fight Club Madrid)",
            "away_team": "Marc Soler (Team BCN)",
            "home_score": 2,
            "away_score": 1,
            "location_venue": "Gimnasio Metropolitano (Madrid)",
            "is_verified_club": 1,
            "club_name": "Fight Club Madrid",
            "sponsor_name": "ProFight Gear España",
            "sponsor_logo": "🥊",
            "sponsor_url": "https://profightgear.es",
            "report_count": 0,
            "views_count": 850,
            "created_at": "2026-09-29T10:00:00"
        },
        {
            "id": "evt-boxeo-velada",
            "title": "Velada de Boxeo Élite Madrid: Campeonato de España Peso Welter",
            "url_original": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            "platform": "youtube",
            "embed_id": "aqz-KE-bpKQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1517438322307-e67111335449?w=800&auto=format&fit=crop&q=60",
            "status": "REPLAY",
            "date_time": "2026-09-28T21:30:00",
            "sport_id": "contacto",
            "category_id": "boxeo",
            "modality": "Boxeo",
            "discipline": "Boxeo",
            "province_id": "madrid",
            "region": "Comunidad de Madrid",
            "home_team": "Club Boxeo Madrid",
            "away_team": "Club Pugilístico Norte",
            "home_score": 3,
            "away_score": 0,
            "location_venue": "Pabellón de la Paloma (Madrid)",
            "is_verified_club": 1,
            "club_name": "Fight Club Madrid",
            "sponsor_name": "",
            "sponsor_logo": "",
            "sponsor_url": "",
            "report_count": 0,
            "views_count": 1200,
            "created_at": "2026-09-28T18:00:00"
        },
        {
            "id": "evt-kick-bcn",
            "title": "Gran Slam Kickboxing K1: Alex Silva vs Carlos Ruíz",
            "url_original": "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
            "platform": "youtube",
            "embed_id": "kJQP7kiw5Fk",
            "embed_url": "https://www.youtube-nocookie.com/embed/kJQP7kiw5Fk?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=800&auto=format&fit=crop&q=60",
            "status": "UPCOMING",
            "date_time": "2026-10-02T19:00:00",
            "sport_id": "contacto",
            "category_id": "kickboxing",
            "modality": "Kickboxing",
            "discipline": "Kickboxing",
            "province_id": "barcelona",
            "region": "Cataluña",
            "home_team": "Alex Silva (K1 Top Team)",
            "away_team": "Carlos Ruíz (Black Belt)",
            "home_score": None,
            "away_score": None,
            "location_venue": "Pavelló Vall d'Hebron (Barcelona)",
            "is_verified_club": 0,
            "club_name": "K1 Top Team BCN",
            "sponsor_name": "",
            "sponsor_logo": "",
            "sponsor_url": "",
            "report_count": 0,
            "views_count": 420,
            "created_at": "2026-09-29T11:00:00"
        }
    ]

    for item in sample_events:
        cursor.execute("SELECT id FROM events WHERE id = ?", (item["id"],))
        if cursor.fetchone():
            continue
        geo = get_province_info(item["province_id"])
        sport = get_sport_info(item["sport_id"], item["category_id"])
        region = item.get("region") or (geo["ccaa_name"] if geo else "España")
        modality_val = item.get("modality") or item.get("discipline") or ""

        cursor.execute("""
        INSERT INTO events (
            id, title, url_original, platform, embed_id, embed_url, thumbnail,
            status, date_time, sport_id, sport_name, sport_icon,
            category_id, category_name, ccaa_id, ccaa_name, region,
            province_id, province_name, home_team, away_team,
            home_score, away_score, location_venue, is_verified_club,
            club_name, sponsor_name, sponsor_logo, sponsor_url,
            report_count, views_count, created_at, modality, discipline
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            item["id"],
            item["title"],
            item["url_original"],
            item["platform"],
            item["embed_id"],
            item["embed_url"],
            item["thumbnail"],
            item["status"],
            item["date_time"],
            item["sport_id"],
            sport["sport_name"] if sport else item["sport_id"],
            sport["sport_icon"] if sport else "🏅",
            item["category_id"],
            item.get("category_name") or (sport["category_name"] if sport else item["category_id"]),
            geo["ccaa_id"] if geo else "espana",
            geo["ccaa_name"] if geo else "España",
            region,
            item["province_id"],
            geo["province_name"] if geo else item["province_id"].capitalize(),
            item["home_team"],
            item["away_team"],
            item.get("home_score"),
            item.get("away_score"),
            item.get("location_venue", ""),
            item.get("is_verified_club", 0),
            item.get("club_name", ""),
            item.get("sponsor_name", ""),
            item.get("sponsor_logo", ""),
            item.get("sponsor_url", ""),
            item.get("report_count", 0),
            item.get("views_count", 0),
            item["created_at"],
            modality_val,
            modality_val
        ))

def parse_score(val):
    if val is None or val == "":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None

def list_events(filters: dict = None):
    conn = get_db()
    try:
        cursor = conn.cursor()
        
        # Determinar si se aplica la restricción de portada (Directos prioritarios + últimos 5 vídeos históricos por club)
        is_portada = False
        limit_per_club = 5
        if filters:
            if filters.get("limit_per_club"):
                try:
                    limit_per_club = max(1, int(filters["limit_per_club"]))
                    is_portada = True
                except Exception:
                    limit_per_club = 5
                    is_portada = True
            elif filters.get("portada") in ("1", "true", True) or filters.get("view") == "portada":
                is_portada = True

        base_where = """
            e.report_count < 5 
              AND e.title NOT LIKE '%Caso Borde%' 
              AND (e.home_team IS NULL OR e.home_team NOT LIKE '%Test Local%')
              AND (e.club_id IS NOT NULL OR e.club_name IS NOT NULL)
        """
        params = []

        if filters:
            if filters.get("status"):
                base_where += " AND e.status = ?"
                params.append(filters["status"].strip().upper())
            if filters.get("sport_id"):
                sp = filters["sport_id"].strip().lower()
                if sp in ("contacto", "boxeo_contacto", "boxeo", "mma", "kickboxing", "muay_thai"):
                    base_where += " AND (e.sport_id IN ('contacto', 'boxeo_contacto') OR e.sport_name LIKE '%Boxeo%' OR e.sport_name LIKE '%contacto%')"
                    if sp in ("boxeo", "mma", "kickboxing", "muay_thai"):
                        base_where += " AND (e.category_id = ? OR LOWER(e.category_name) LIKE ? OR LOWER(e.title) LIKE ? OR LOWER(e.discipline) LIKE ? OR LOWER(e.modality) LIKE ?)"
                        params.extend([sp, f"%{sp}%", f"%{sp}%", f"%{sp}%", f"%{sp}%"])
                else:
                    base_where += " AND e.sport_id = ?"
                    params.append(sp)
            if filters.get("category_id") and filters.get("category_id") != "all":
                cat = filters["category_id"].strip().lower()
                base_where += " AND (e.category_id = ? OR LOWER(e.category_name) LIKE ? OR LOWER(e.discipline) LIKE ? OR LOWER(e.modality) LIKE ?)"
                params.extend([cat, f"%{cat}%", f"%{cat}%", f"%{cat}%"])
            discipline = (filters.get("discipline") or filters.get("modality") or "").strip().lower()
            if discipline and discipline != "all":
                base_where += " AND (e.category_id = ? OR LOWER(e.category_name) LIKE ? OR LOWER(e.discipline) LIKE ? OR LOWER(e.modality) LIKE ? OR LOWER(e.title) LIKE ?)"
                params.extend([discipline, f"%{discipline}%", f"%{discipline}%", f"%{discipline}%", f"%{discipline}%"])
            if filters.get("province_id") and filters["province_id"] != "all":
                base_where += " AND e.province_id = ?"
                params.append(filters["province_id"].strip().lower())
            ccaa_filter = filters.get("ccaa_id") or filters.get("region")
            if ccaa_filter and ccaa_filter != "all":
                clean_ccaa = ccaa_filter.strip().lower()
                if clean_ccaa in ("comunidad-valenciana", "comunidad valenciana", "comunitat valenciana", "c. valenciana", "c valenciana", "valencia", "alicante", "castellon"):
                    base_where += " AND (e.ccaa_id = 'comunidad-valenciana' OR e.region LIKE '%valencian%' OR e.province_id IN ('valencia', 'alicante', 'castellon'))"
                elif clean_ccaa in ("madrid", "comunidad de madrid", "c. madrid", "c madrid"):
                    base_where += " AND (e.ccaa_id = 'madrid' OR e.region LIKE '%madrid%' OR e.province_id = 'madrid')"
                elif clean_ccaa in ("cataluna", "cataluña", "catalunya", "barcelona", "girona", "lleida", "tarragona"):
                    base_where += " AND (e.ccaa_id = 'cataluna' OR e.region LIKE '%catalu%' OR e.province_id IN ('barcelona', 'girona', 'lleida', 'tarragona'))"
                else:
                    base_where += " AND (e.ccaa_id = ? OR LOWER(e.region) = ? OR LOWER(e.ccaa_name) = ? OR e.province_id = ?)"
                    params.extend([clean_ccaa, clean_ccaa, clean_ccaa, clean_ccaa])
    if filters.get("search"):
                term = f"%{filters['search'].strip()}%"
                base_where += " AND (e.title LIKE ? OR e.home_team LIKE ? OR e.away_team LIKE ? OR e.club_name LIKE ? OR e.location_venue LIKE ?)"
                params.extend([term, term, term, term, term])
    try:
                    query = f"""
            SELECT e.* FROM events e
            WHERE {base_where}
            ORDER BY 
                CASE e.status 
                    WHEN 'LIVE' THEN 1 
                    WHEN 'UPCOMING' THEN 2 
                    WHEN 'REPLAY' THEN 3 
                END ASC,
                e.date_time DESC
            """
            cursor.execute(query, params)

        rows = [dict(row) for row in cursor.fetchall()]
        return rows
    finally:
        conn.close()

def get_event_by_id(event_id: str):
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT * FROM events 
            WHERE id = ? 
              AND (club_id IN (SELECT id FROM clubs WHERE is_active = 1 AND approved_by_admin = 1) 
                   OR club_name IN (SELECT name FROM clubs WHERE is_active = 1 AND approved_by_admin = 1))
        """, (event_id,))
        row = cursor.fetchone()
        if row:
            try:
                # Incrementar contador de visualizaciones
                cursor.execute("UPDATE events SET views_count = views_count + 1 WHERE id = ?", (event_id,))
                conn.commit()
            except Exception:
                pass
            result = dict(row)
            result["views_count"] += 1
            return result
        return None
    finally:
        conn.close()

def create_event(data: dict, current_user: dict = None):
    conn = get_db()
    try:
        cursor = conn.cursor()
        event_id = "evt-" + str(uuid.uuid4())[:8]
        now_iso = datetime.datetime.now().isoformat()

        # Validación de permisos si se proporciona contexto de usuario
        if current_user:
            role = current_user.get("role", "viewer")
            if role in ("viewer", "aficionado"):
                raise PermissionError("Los espectadores solo tienen acceso de visualización. No pueden emitir partidos.")

        # Validación y saneamiento de campos obligatorios
        home_team = str(data.get("home_team", "")).strip() or "Equipo Local"
        away_team = str(data.get("away_team", "")).strip() or "Equipo Visitante"
        title = str(data.get("title", "")).strip() or f"{home_team} vs {away_team}"
        url_original = str(data.get("url_original", "")).strip()

        # Normalización de estado conforme a restricción CHECK
        status_raw = str(data.get("status", "LIVE")).strip().upper()
        status = status_raw if status_raw in ("LIVE", "UPCOMING", "REPLAY") else "LIVE"

        # Puntuaciones enteras o None (evita fallos de inserción de "")
        home_score = parse_score(data.get("home_score"))
        away_score = parse_score(data.get("away_score"))

        # Localización geográfica y deporte con fallback garantizado
        province_id = str(data.get("province_id", "madrid")).strip().lower()
        geo = get_province_info(province_id)
        if not geo:
            province_id = "madrid"
            geo = get_province_info(province_id)

        sport_id = str(data.get("sport_id", "futbol")).strip().lower()
        modality = str(data.get("modality") or data.get("discipline") or "").strip()
        if sport_id in ("contacto", "boxeo_contacto"):
            sport_id = "contacto"
            sport_name = "Boxeo y deportes de contacto"
            sport_icon = "🥊"
            category_id = str(data.get("category_id") or modality.lower() or "boxeo").strip().lower()
            category_name = modality or (category_id.capitalize() if category_id else "Boxeo")
            if not modality:
                modality = category_name
        else:
            category_id = str(data.get("category_id", "base")).strip().lower()
            sport = get_sport_info(sport_id, category_id)
            if not sport:
                sport_id = "futbol"
                sport = get_sport_info(sport_id, category_id)
            sport_name = sport["sport_name"] if sport else "Deporte"
            sport_icon = sport["sport_icon"] if sport else "🏅"
            category_name = sport["category_name"] if (sport and sport.get("category_name")) else category_id.capitalize()

        sport_name = sport_name.replace(" Cantera", "").replace(" Base", "").strip()
        if status != "LIVE":
            home_score = None
            away_score = None

        # Normalizar fecha/hora ISO
        date_time = str(data.get("date_time", "")).strip()
        if not date_time:
            date_time = now_iso
        elif len(date_time) == 16:
            date_time += ":00"

        location_venue = str(data.get("location_venue", "")).strip()

        # Si el usuario es de tipo club, se fija el club a su club asignado
        created_by_user_id = None
        if current_user:
            created_by_user_id = current_user.get("id")
            if current_user.get("role") == "club":
                club_name = current_user.get("club_name") or home_team
                is_verified = 1
            else:
                club_name = str(data.get("club_name", "")).strip() or home_team
                is_verified = 1 if data.get("is_verified_club") else 0
        else:
            club_name = str(data.get("club_name", "")).strip() or home_team
            is_verified = 1 if data.get("is_verified_club") else 0

        sponsor_name = str(data.get("sponsor_name", "")).strip()
        sponsor_logo = str(data.get("sponsor_logo", "⭐")).strip() or "⭐"
        sponsor_url = str(data.get("sponsor_url", "")).strip()

        content_type_raw = str(data.get("content_type", "")).strip().lower()
        content_type = content_type_raw if content_type_raw in ("live", "match_replay", "press", "reel") else ("match_replay" if status == "REPLAY" else "live")
        club_id = str(data.get("club_id", "")).strip() or None
        channel_url = str(data.get("channel_url", "")).strip()
        duration = str(data.get("duration", "")).strip()
        region = str(data.get("region", "")).strip() or (geo["ccaa_name"] if geo else "Comunidad de Madrid")

        cursor.execute("""
        INSERT INTO events (
            id, title, url_original, platform, embed_id, embed_url, thumbnail,
            status, date_time, sport_id, sport_name, sport_icon,
            category_id, category_name, ccaa_id, ccaa_name, region,
            province_id, province_name, home_team, away_team,
            home_score, away_score, location_venue, is_verified_club,
            club_name, sponsor_name, sponsor_logo, sponsor_url,
            report_count, views_count, created_at, created_by_user_id,
            content_type, club_id, channel_url, duration, modality, discipline
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            event_id,
            title,
            url_original,
            str(data.get("platform", "youtube")).strip().lower(),
            str(data.get("embed_id", "")).strip(),
            str(data.get("embed_url", "")).strip(),
            str(data.get("thumbnail", "")).strip(),
            status,
            date_time,
            sport_id,
            sport_name,
            sport_icon,
            category_id,
            category_name,
            geo["ccaa_id"] if geo else "madrid",
            geo["ccaa_name"] if geo else "Comunidad de Madrid",
            region,
            province_id,
            geo["province_name"] if geo else province_id.capitalize(),
            home_team,
            away_team,
            home_score,
            away_score,
            location_venue,
            is_verified,
            club_name,
            sponsor_name,
            sponsor_logo,
            sponsor_url,
            now_iso,
            created_by_user_id,
            content_type,
            club_id,
            channel_url,
            duration,
            modality,
            modality
        ))
        conn.commit()
    finally:
        conn.close()

    return get_event_by_id(event_id)

def update_event(event_id: str, data: dict, current_user: dict = None):
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
        row = cursor.fetchone()
        if not row:
            return None
        existing = dict(row)

        # Control de permisos por rol
        if current_user:
            role = current_user.get("role", "viewer")
            if role in ("viewer", "aficionado"):
                raise PermissionError("Los aficionados solo tienen permisos de lectura.")
            elif role == "club":
                user_club = (current_user.get("club_name") or "").strip().lower()
                event_club = (existing.get("club_name") or "").strip().lower()
                event_home = (existing.get("home_team") or "").strip().lower()
                creator_id = existing.get("created_by_user_id")
                
                # Comprobar pertenencia al club
                if user_club != event_club and user_club != event_home and creator_id != current_user.get("id"):
                    raise PermissionError(f"Solo puedes modificar partidos pertenecientes a tu club ({current_user.get('club_name')}).")
        else:
            raise PermissionError("Se requiere iniciar sesión para modificar un partido.")

        # Preparar campos a actualizar
        title = str(data.get("title", existing["title"])).strip()
        url_original = str(data.get("url_original", existing["url_original"])).strip()
        platform = str(data.get("platform", existing["platform"])).strip().lower()
        embed_id = str(data.get("embed_id", existing["embed_id"] or "")).strip()
        embed_url = str(data.get("embed_url", existing["embed_url"])).strip()
        thumbnail = str(data.get("thumbnail", existing["thumbnail"] or "")).strip()
        
        status_raw = str(data.get("status", existing["status"])).strip().upper()
        status = status_raw if status_raw in ("LIVE", "UPCOMING", "REPLAY") else existing["status"]

        date_time = str(data.get("date_time", existing["date_time"])).strip()
        home_team = str(data.get("home_team", existing["home_team"])).strip()
        away_team = str(data.get("away_team", existing["away_team"])).strip()
        
        home_score = parse_score(data.get("home_score")) if "home_score" in data else existing["home_score"]
        away_score = parse_score(data.get("away_score")) if "away_score" in data else existing["away_score"]
        
        location_venue = str(data.get("location_venue", existing["location_venue"] or "")).strip()
        
        # El club no puede cambiar la titularidad del club a otro club
        if current_user and current_user.get("role") == "club":
            club_name = existing["club_name"] or current_user.get("club_name")
            is_verified = 1
        else:
            club_name = str(data.get("club_name", existing["club_name"] or "")).strip()
            is_verified = int(data.get("is_verified_club", existing["is_verified_club"]))

        sponsor_name = str(data.get("sponsor_name", existing["sponsor_name"] or "")).strip()
        sponsor_logo = str(data.get("sponsor_logo", existing["sponsor_logo"] or "⭐")).strip() or "⭐"
        sponsor_url = str(data.get("sponsor_url", existing["sponsor_url"] or "")).strip()

        # Provincias y deportes si cambian
        province_id = str(data.get("province_id", existing["province_id"])).strip().lower()
        geo = get_province_info(province_id)
        province_name = geo["province_name"] if geo else existing["province_name"]
        ccaa_id = geo["ccaa_id"] if geo else existing["ccaa_id"]
        ccaa_name = geo["ccaa_name"] if geo else existing["ccaa_name"]

        sport_id = str(data.get("sport_id", existing["sport_id"])).strip().lower()
        category_id = str(data.get("category_id", existing["category_id"])).strip().lower()
        modality = str(data.get("modality", existing.get("modality") or "")).strip()
        discipline = str(data.get("discipline", existing.get("discipline") or "")).strip()
        if not discipline and modality:
            discipline = modality
        if not modality and discipline:
            modality = discipline

        if sport_id in ("contacto", "boxeo_contacto"):
            sport_id = "contacto"
            sport_name = "Boxeo y deportes de contacto"
            sport_icon = "🥊"
            category_name = discipline or modality or existing.get("category_name") or "Combate"
        else:
            sport = get_sport_info(sport_id, category_id)
            sport_name = sport["sport_name"] if sport else existing["sport_name"]
            sport_icon = sport["sport_icon"] if sport else existing["sport_icon"]
            category_name = sport["category_name"] if (sport and sport.get("category_name")) else existing["category_name"]

        cursor.execute("""
        UPDATE events SET
            title = ?, url_original = ?, platform = ?, embed_id = ?, embed_url = ?, thumbnail = ?,
            status = ?, date_time = ?, sport_id = ?, sport_name = ?, sport_icon = ?,
            category_id = ?, category_name = ?, ccaa_id = ?, ccaa_name = ?,
            province_id = ?, province_name = ?, home_team = ?, away_team = ?,
            home_score = ?, away_score = ?, location_venue = ?, is_verified_club = ?,
            club_name = ?, sponsor_name = ?, sponsor_logo = ?, sponsor_url = ?,
            modality = ?, discipline = ?
        WHERE id = ?
        """, (
            title, url_original, platform, embed_id, embed_url, thumbnail,
            status, date_time, sport_id, sport_name, sport_icon,
            category_id, category_name, ccaa_id, ccaa_name,
            province_id, province_name, home_team, away_team,
            home_score, away_score, location_venue, is_verified,
            club_name, sponsor_name, sponsor_logo, sponsor_url,
            modality, discipline,
            event_id
        ))
        conn.commit()
    finally:
        conn.close()

    return get_event_by_id(event_id)

def delete_event(event_id: str, current_user: dict = None):
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM events WHERE id = ?", (event_id,))
        row = cursor.fetchone()
        if not row:
            return False
        existing = dict(row)

        # Verificación estricta de permisos
        if not current_user:
            raise PermissionError("Se requiere iniciar sesión para eliminar un partido.")
        
        role = current_user.get("role", "viewer")
        if role in ("viewer", "aficionado"):
            raise PermissionError("Los aficionados no pueden eliminar partidos.")
        elif role == "club":
            user_club = (current_user.get("club_name") or "").strip().lower()
            event_club = (existing.get("club_name") or "").strip().lower()
            event_home = (existing.get("home_team") or "").strip().lower()
            creator_id = existing.get("created_by_user_id")
            if user_club != event_club and user_club != event_home and creator_id != current_user.get("id"):
                raise PermissionError("Solo puedes eliminar partidos pertenecientes a tu propio club.")

        cursor.execute("DELETE FROM events WHERE id = ?", (event_id,))
        conn.commit()
        return True
    finally:
        conn.close()

def list_club_events(club_name: str):
    conn = get_db()
    try:
        cursor = conn.cursor()
        term = f"%{club_name.strip()}%"
        cursor.execute("""
        SELECT * FROM events 
        WHERE club_name LIKE ? OR home_team LIKE ? OR away_team LIKE ?
        ORDER BY 
          CASE status 
            WHEN 'LIVE' THEN 1 
            WHEN 'UPCOMING' THEN 2 
            WHEN 'REPLAY' THEN 3 
          END ASC,
          date_time DESC
        """, (term, term, term))
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()

def report_event(event_id: str, reason: str = "Inapropiado / Caído"):
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE events SET report_count = report_count + 1 WHERE id = ?", (event_id,))
        conn.commit()
        cursor.execute("SELECT report_count FROM events WHERE id = ?", (event_id,))
        res = cursor.fetchone()
        return {"id": event_id, "report_count": res[0] if res else 0}
    finally:
        conn.close()

def get_stats():
    conn = get_db()
    try:
        cursor = conn.cursor()
        approved_filter = "(club_id IN (SELECT id FROM clubs WHERE is_active = 1 AND approved_by_admin = 1) OR club_name IN (SELECT name FROM clubs WHERE is_active = 1 AND approved_by_admin = 1))"
        cursor.execute(f"SELECT COUNT(*) FROM events WHERE status = 'LIVE' AND {approved_filter}")
        live_count = cursor.fetchone()[0]
        cursor.execute(f"SELECT COUNT(*) FROM events WHERE status = 'UPCOMING' AND {approved_filter}")
        upcoming_count = cursor.fetchone()[0]
        cursor.execute(f"SELECT COUNT(*) FROM events WHERE status = 'REPLAY' AND {approved_filter}")
        replay_count = cursor.fetchone()[0]
        cursor.execute(f"SELECT COUNT(DISTINCT province_id) FROM events WHERE {approved_filter}")
        provinces_active = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM users")
        users_count = cursor.fetchone()[0]
        cursor.execute("SELECT COUNT(*) FROM clubs WHERE is_active = 1 AND approved_by_admin = 1")
        clubs_count = cursor.fetchone()[0]
        return {
            "live_count": live_count,
            "upcoming_count": upcoming_count,
            "replay_count": replay_count,
            "provinces_active": provinces_active,
            "users_count": users_count,
            "clubs_count": clubs_count
        }
    finally:
        conn.close()

# ==========================================================
# GESTIÓN DE USUARIOS Y AUTENTICACIÓN
# ==========================================================

def authenticate_user(identity: str, password: str):
    """Autentica a un usuario por correo o nombre de usuario."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        clean_ident = str(identity).strip().lower()
        idents = {clean_ident, clean_ident.replace("_", " "), clean_ident.replace(" ", "_")}
        if "@" in clean_ident:
            prefix = clean_ident.split("@")[0]
            for dom in ["@sportslive.es", "@talentolive.es", "@gradadirecto.es"]:
                idents.add(prefix + dom)
        placeholders = ", ".join(["?"] * len(idents))
        ident_list = list(idents)
        cursor.execute(f"""
        SELECT * FROM users 
        WHERE LOWER(username) IN ({placeholders}) OR LOWER(email) IN ({placeholders})
        """, ident_list + ident_list)
        row = cursor.fetchone()
        if not row:
            return None
        
        user = dict(row)
        if verify_password(password, user["password_hash"], user["salt"]):
            # Devolver usuario sin credenciales sensibles
            user.pop("password_hash", None)
            user.pop("salt", None)
            try:
                user["favorite_clubs"] = json.loads(user.get("favorite_clubs") or "[]")
            except Exception:
                user["favorite_clubs"] = []
            return user
        return None
    finally:
        conn.close()

def create_session(user_id: str, days: int = 30) -> str:
    conn = get_db()
    try:
        cursor = conn.cursor()
        token = secrets.token_hex(32)
        now = datetime.datetime.now()
        expires = now + datetime.timedelta(days=days)
        cursor.execute("""
        INSERT INTO sessions (token, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
        """, (token, user_id, now.isoformat(), expires.isoformat()))
        conn.commit()
        return token
    finally:
        conn.close()

def get_user_by_session(token: str):
    if not token:
        return None
    conn = get_db()
    try:
        cursor = conn.cursor()
        now_iso = datetime.datetime.now().isoformat()
        cursor.execute("""
        SELECT u.id, u.username, u.email, u.role, u.club_name, u.full_name, u.cif, u.location, u.is_verified, u.created_at, u.favorite_clubs, s.expires_at
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > ?
        """, (token, now_iso))
        row = cursor.fetchone()
        if row:
            u_dict = dict(row)
            try:
                u_dict["favorite_clubs"] = json.loads(u_dict.get("favorite_clubs") or "[]")
            except Exception:
                u_dict["favorite_clubs"] = []
            return u_dict
        return None
    finally:
        conn.close()

def delete_session(token: str):
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
    finally:
        conn.close()

def list_users():
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT id, username, email, role, club_name, full_name, cif, location, is_verified, created_at
        FROM users
        ORDER BY 
          CASE role
            WHEN 'admin' THEN 1
            WHEN 'club' THEN 2
            WHEN 'aficionado' THEN 3
            WHEN 'viewer' THEN 3
          END ASC,
          created_at DESC
        """)
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()

def get_user_by_id(user_id: str):
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT id, username, email, role, club_name, full_name, cif, location, is_verified, created_at
        FROM users WHERE id = ?
        """, (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def create_user(
    username: str, 
    email: str, 
    password: str, 
    role: str = "aficionado", 
    club_name: str = None, 
    full_name: str = None,
    cif: str = None,
    location: str = None,
    is_verified: int = None
):
    conn = get_db()
    try:
        cursor = conn.cursor()
        clean_user = str(username).strip().lower()
        clean_email = str(email).strip().lower()
        
        if role not in ("aficionado", "viewer", "club", "admin"):
            role = "aficionado"

        # Verificar unicidad
        cursor.execute("SELECT id FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?", (clean_user, clean_email))
        if cursor.fetchone():
            raise ValueError("El nombre de usuario o correo ya está registrado en la plataforma.")

        user_id = "usr-" + str(uuid.uuid4())[:8]
        p_hash, salt = hash_password(password)
        now_iso = datetime.datetime.now().isoformat()

        # Determinar verificación inicial: Admin y Club verificado por defecto a 1; aficionado a 0
        if is_verified is None:
            if role in ("admin", "club"):
                is_verified = 1
            else:
                is_verified = 0
        else:
            is_verified = 1 if is_verified else 0

        cursor.execute("""
        INSERT INTO users (id, username, email, password_hash, salt, role, club_name, full_name, cif, location, is_verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id,
            clean_user,
            clean_email,
            p_hash,
            salt,
            role,
            club_name.strip() if club_name else None,
            full_name.strip() if full_name else clean_user,
            (cif or "").strip(),
            (location or "").strip(),
            is_verified,
            now_iso
        ))
        conn.commit()
        return get_user_by_id(user_id)
    finally:
        conn.close()

def update_user(user_id: str, data: dict):
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            return None
        existing = dict(row)

        username = str(data.get("username", existing["username"])).strip().lower()
        email = str(data.get("email", existing["email"])).strip().lower()
        role = str(data.get("role", existing["role"])).strip().lower()
        if role not in ("aficionado", "viewer", "club", "admin"):
            role = existing["role"]

        club_name = data.get("club_name", existing["club_name"])
        if club_name:
            club_name = str(club_name).strip()
        full_name = str(data.get("full_name", existing["full_name"] or username)).strip()
        cif = str(data.get("cif", existing.get("cif", ""))).strip()
        location = str(data.get("location", existing.get("location", ""))).strip()
        is_verified = int(data.get("is_verified", existing.get("is_verified", 0)))

        # Si se envía nueva contraseña
        new_password = data.get("password")
        if new_password and str(new_password).strip():
            p_hash, salt = hash_password(str(new_password).strip())
            cursor.execute("""
            UPDATE users SET
                username = ?, email = ?, password_hash = ?, salt = ?, role = ?, club_name = ?, full_name = ?, cif = ?, location = ?, is_verified = ?
            WHERE id = ?
            """, (username, email, p_hash, salt, role, club_name, full_name, cif, location, is_verified, user_id))
        else:
            cursor.execute("""
            UPDATE users SET
                username = ?, email = ?, role = ?, club_name = ?, full_name = ?, cif = ?, location = ?, is_verified = ?
            WHERE id = ?
            """, (username, email, role, club_name, full_name, cif, location, is_verified, user_id))
        
        conn.commit()
        return get_user_by_id(user_id)
    finally:
        conn.close()

def toggle_user_verification(user_id: str, is_verified: int):
    """Permite al administrador global verificar o revocar la verificación de un club deportivo."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        val = 1 if is_verified else 0
        cursor.execute("UPDATE users SET is_verified = ? WHERE id = ?", (val, user_id))
        cursor.execute("SELECT club_name FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if row and row[0]:
            cursor.execute("UPDATE events SET is_verified_club = ? WHERE club_name = ?", (val, row[0]))
        conn.commit()
        return get_user_by_id(user_id)
    finally:
        conn.close()

def delete_user(user_id: str):
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
        cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return True
    finally:
        conn.close()

def list_all_clubs():
    """Obtiene la lista de clubes activos dados de alta y autorizados por el Administrador."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT c.id, c.name, c.shield_url, c.shield_icon, c.location, c.province_id, c.province_name, 
                   c.ccaa_id, c.ccaa_name, c.category, c.sport_id, c.sport_name, c.sport_icon, c.channel_url, 
                   c.is_verified, c.description, c.is_active, c.approved_by_admin,
                   (SELECT COUNT(*) FROM events e WHERE (e.club_id = c.id OR e.club_name = c.name)) as events_count
            FROM clubs c
            WHERE c.is_active = 1 AND c.approved_by_admin = 1
            ORDER BY c.name ASC
        """)
        rows = cursor.fetchall()
        result = []
        for r in rows:
            club_dict = dict(r)
            club_dict["is_registered"] = True
            club_dict["is_verified"] = 1 if club_dict.get("is_verified") else 0
            result.append(club_dict)
        return result
    finally:
        conn.close()

def get_user_favorite_clubs(user_id: str) -> list:
    """Obtiene la lista de clubes favoritos de un usuario."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT favorite_clubs FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if row and row[0]:
            try:
                return json.loads(row[0])
            except Exception:
                return []
        return []
    finally:
        conn.close()

def save_user_favorite_clubs(user_id: str, clubs: list) -> bool:
    """Guarda la lista de clubes favoritos de un usuario en SQLite."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        clubs_clean = [str(c).strip() for c in clubs if str(c).strip()]
        clubs_json = json.dumps(clubs_clean, ensure_ascii=False)
        cursor.execute("UPDATE users SET favorite_clubs = ? WHERE id = ?", (clubs_json, user_id))
        conn.commit()
        return True
    finally:
        conn.close()


def seed_sample_chat_messages(cursor):
    sample_msgs = [
        # evt-1: C.D. Las Rozas vs C.F. Pozuelo (LIVE)
        ("evt-1", "Carlos M. (Aficionado)", "¡Buen inicio de partido de los chavales!", "viewer", "2026-09-14T12:02:15"),
        ("evt-1", "Delegado C.D. Las Rozas", "Bienvenidos a la retransmisión oficial. ¡Aupa Las Rozas! 🔴⚪", "club", "2026-09-14T12:05:00"),
        ("evt-1", "Laura Pozuelo", "Gran parada del portero visitante, qué reflejos 👏", "viewer", "2026-09-14T12:10:30"),
        ("evt-1", "Administrador General", "Recordad mantener un ambiente de respeto y juego limpio en el chat. 🛡️", "admin", "2026-09-14T12:12:00"),
        ("evt-1", "Socio 482", "¡Vaya golazo acaba de meter el cadete!", "viewer", "2026-09-14T12:18:40"),
        # evt-2: Joventut Badalona vs Basquet Manresa (LIVE)
        ("evt-2", "Prensa Joventut Badalona", "¡Arrancamos la Final Autonómica Junior desde el Olímpic! 🏀💚", "club", "2026-09-14T12:31:00"),
        ("evt-2", "Jordi Basket", "¡Defensa impresionante en ambos aros!", "viewer", "2026-09-14T12:36:20"),
        ("evt-2", "Manresa Fan", "¡Gran triple para empatar el cuarto!", "viewer", "2026-09-14T12:44:10"),
        # evt-3: BM Alcobendas vs BM Granollers (LIVE)
        ("evt-3", "Alcobendas Balonmano", "¡Directo en marcha! Mucha fuerza a los juveniles.", "club", "2026-09-14T12:16:00"),
        ("evt-3", "Aficionado Balonmano", "Qué ritmo de contraataque llevan hoy.", "viewer", "2026-09-14T12:22:45"),
        # evt-4: Movistar Inter FS vs ElPozo Murcia (LIVE)
        ("evt-4", "Academia Inter FS", "Señal en directo desde el pabellón. ¡Vamos Inter!", "club", "2026-09-14T12:46:00"),
        ("evt-4", "Futsal Puro", "Vaya jugada ensayada a balón parado ⚽🔥", "viewer", "2026-09-14T12:50:30")
    ]
    for ev_id, u_name, msg, role, dt in sample_msgs:
        m_id = f"msg-{uuid.uuid4().hex[:10]}"
        cursor.execute("""
        INSERT INTO chat_messages (id, event_id, user_id, user_name, user_role, message, created_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?)
        """, (m_id, ev_id, u_name, role, msg, dt))


def get_event_chat_messages(event_id: str, limit: int = 60) -> list:
    """Devuelve los mensajes de chat vinculados exclusivamente a un evento en vivo."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT id, event_id, user_id, user_name, user_role, message, created_at
        FROM chat_messages
        WHERE event_id = ?
        ORDER BY created_at ASC
        LIMIT ?
        """, (event_id, limit))
        rows = cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_chat_message(event_id: str, user_name: str, message: str, user_id: str = None, user_role: str = 'viewer') -> dict:
    """Crea y persiste un nuevo mensaje de chat vinculado al evento."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        msg_id = f"msg-{uuid.uuid4().hex[:10]}"
        now_iso = datetime.datetime.now().isoformat()
        clean_user = (user_name or "Aficionado").strip()[:40]
        clean_msg = message.strip()[:300]
        clean_role = user_role if user_role in ("admin", "club", "viewer", "aficionado") else "viewer"

        cursor.execute("""
        INSERT INTO chat_messages (id, event_id, user_id, user_name, user_role, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (msg_id, event_id, user_id, clean_user, clean_role, clean_msg, now_iso))
        conn.commit()

        return {
            "id": msg_id,
            "event_id": event_id,
            "user_id": user_id,
            "user_name": clean_user,
            "user_role": clean_role,
            "message": clean_msg,
            "created_at": now_iso
        }
    finally:
        conn.close()

def create_sponsor_lead(company_name: str, contact_info: str, interest: str = "", plan_name: str = "", message: str = "") -> dict:
    """Registra y persiste una solicitud comercial de patrocinio en la base de datos."""
    lead_id = f"lead-{uuid.uuid4().hex[:8]}"
    now_iso = datetime.datetime.now().isoformat()
    clean_company = (company_name or "").strip()[:100]
    clean_contact = (contact_info or "").strip()[:100]
    clean_interest = (interest or "").strip()[:120]
    clean_plan = (plan_name or "Consulta General").strip()[:80]
    clean_msg = (message or "").strip()[:500]

    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO sponsor_leads (id, company_name, contact_info, interest, plan_name, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        """, (lead_id, clean_company, clean_contact, clean_interest, clean_plan, clean_msg, now_iso))
        conn.commit()

        return {
            "id": lead_id,
            "company_name": clean_company,
            "contact_info": clean_contact,
            "interest": clean_interest,
            "plan_name": clean_plan,
            "message": clean_msg,
            "created_at": now_iso
        }
    finally:
        conn.close()

def list_sponsor_leads(limit: int = 50) -> list:
    """Devuelve las solicitudes de patrocinio recibidas."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM sponsor_leads ORDER BY created_at DESC LIMIT ?;", (limit,))
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


# ==========================================================
# 12. SISTEMA DE CLUBES OFICIALES, CANALES Y VÍDEOS CLASIFICADOS
# ==========================================================

def seed_sample_clubs(cursor):
    """Siembra los datos de los clubes oficiales de la plataforma."""
    clubs_data = [
        {
            "id": "cd-las-rozas",
            "name": "C.D. Las Rozas",
            "shield_url": "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "🔵⚪",
            "location": "Las Rozas de Madrid",
            "province_id": "madrid",
            "province_name": "Madrid",
            "ccaa_id": "madrid",
            "ccaa_name": "Comunidad de Madrid",
            "category": "Cadete A - División de Honor Autonómica",
            "sport_id": "futbol",
            "sport_name": "Fútbol",
            "sport_icon": "⚽",
            "channel_url": "https://www.youtube.com/@cdlasrozasoficial",
            "is_verified": 1,
            "description": "Cantera oficial del Club Deportivo Las Rozas. Más de 50 años formando talentos y compitiendo en el fútbol formativo madrileño.",
            "created_at": "2026-09-01T10:00:00"
        },
        {
            "id": "cantera-joventut",
            "name": "Cantera Joventut",
            "shield_url": "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "🏀💚",
            "location": "Badalona",
            "province_id": "barcelona",
            "province_name": "Barcelona",
            "ccaa_id": "cataluna",
            "ccaa_name": "Cataluña",
            "category": "Junior Preferente Autonómico",
            "sport_id": "baloncesto",
            "sport_name": "Baloncesto",
            "sport_icon": "🏀",
            "channel_url": "https://www.youtube.com/@Penya1930",
            "is_verified": 1,
            "description": "El bressol del bàsquet. Cantera formativa del Club Joventut Badalona.",
            "created_at": "2026-09-01T10:00:00"
        },
        {
            "id": "sevilla-fc-cantera",
            "name": "Sevilla FC Cantera",
            "shield_url": "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "⚪🔴",
            "location": "Sevilla",
            "province_id": "sevilla",
            "province_name": "Sevilla",
            "ccaa_id": "andalucia",
            "ccaa_name": "Andalucía",
            "category": "Liga Juvenil Femenina",
            "sport_id": "futbol",
            "sport_name": "Fútbol",
            "sport_icon": "⚽",
            "channel_url": "https://www.youtube.com/@sevillafc",
            "is_verified": 1,
            "description": "Retransmisiones oficiales de los escalafones inferiores y cantera femenina del Sevilla FC.",
            "created_at": "2026-09-01T10:00:00"
        },
        {
            "id": "academia-inter-fs",
            "name": "Academia Inter FS",
            "shield_url": "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "⚽💙",
            "location": "Torrejón de Ardoz",
            "province_id": "madrid",
            "province_name": "Madrid",
            "ccaa_id": "madrid",
            "ccaa_name": "Comunidad de Madrid",
            "category": "División de Honor Juvenil FS",
            "sport_id": "futsal",
            "sport_name": "Fútbol Sala",
            "sport_icon": "⚽",
            "channel_url": "https://www.youtube.com/@MovistarInterFS",
            "is_verified": 1,
            "description": "Academia oficial de fútbol sala formativo del Movistar Inter FS.",
            "created_at": "2026-09-01T10:00:00"
        },
        {
            "id": "cantera-granota",
            "name": "Cantera Granota",
            "shield_url": "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "🐸🔵🔴",
            "location": "Buñol",
            "province_id": "valencia",
            "province_name": "Valencia",
            "ccaa_id": "comunidad-valenciana",
            "ccaa_name": "Comunidad Valenciana",
            "category": "Alevín Autonómico",
            "sport_id": "futbol",
            "sport_name": "Fútbol",
            "sport_icon": "⚽",
            "channel_url": "https://www.youtube.com/@levanteud",
            "is_verified": 1,
            "description": "Escuela y cantera oficial del Levante Unión Deportiva en Buñol.",
            "created_at": "2026-09-01T10:00:00"
        },
        {
            "id": "cb-granollers",
            "name": "C.B. Granollers",
            "shield_url": "https://images.unsplash.com/photo-1519766304817-4f37bda74a29?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "🤾‍♂️⚪",
            "location": "Granollers",
            "province_id": "barcelona",
            "province_name": "Barcelona",
            "ccaa_id": "cataluna",
            "ccaa_name": "Cataluña",
            "category": "1ª División Nacional Balonmano",
            "sport_id": "balonmano",
            "sport_name": "Balonmano",
            "sport_icon": "🤾",
            "channel_url": "https://www.youtube.com/@cbgranollers",
            "is_verified": 1,
            "description": "Balonmano de cantera y tradición en el Pavelló Olímpic de Granollers.",
            "created_at": "2026-09-01T10:00:00"
        },
        {
            "id": "barakaldo-cf",
            "name": "Barakaldo C.F.",
            "shield_url": "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "🟡⚫",
            "location": "Barakaldo",
            "province_id": "bizkaia",
            "province_name": "Bizkaia",
            "ccaa_id": "pais-vasco",
            "ccaa_name": "País Vasco",
            "category": "Regional Preferente Bizkaia",
            "sport_id": "futbol",
            "sport_name": "Fútbol",
            "sport_icon": "⚽",
            "channel_url": "https://www.youtube.com/@BarakaldoCF",
            "is_verified": 1,
            "description": "Cantera fabril del Barakaldo Club de Fútbol en Lasesarre.",
            "created_at": "2026-09-01T10:00:00"
        },
        {
            "id": "real-zaragoza-cantera",
            "name": "Real Zaragoza Cantera",
            "shield_url": "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "🦁⚪🔵",
            "location": "Zaragoza",
            "province_id": "zaragoza",
            "province_name": "Zaragoza",
            "ccaa_id": "aragon",
            "ccaa_name": "Aragón",
            "category": "Infantil División Honor",
            "sport_id": "futbol",
            "sport_name": "Fútbol",
            "sport_icon": "⚽",
            "channel_url": "https://www.youtube.com/@RealZaragozaOficial",
            "is_verified": 1,
            "description": "Ciudad Deportiva del Real Zaragoza, formando leones desde el fútbol base.",
            "created_at": "2026-09-01T10:00:00"
        },
        {
            "id": "cantera-unicaja",
            "name": "Cantera Unicaja",
            "shield_url": "https://images.unsplash.com/photo-1519861531473-9200262188bf?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "🟢⚪",
            "location": "Málaga",
            "province_id": "malaga",
            "province_name": "Málaga",
            "ccaa_id": "andalucia",
            "ccaa_name": "Andalucía",
            "category": "Cadete Autonómico",
            "sport_id": "baloncesto",
            "sport_name": "Baloncesto",
            "sport_icon": "🏀",
            "channel_url": "https://www.youtube.com/@UnicajaBaloncesto",
            "is_verified": 1,
            "description": "Cantera de baloncesto de Los Guindos. Formando campeones con Unicaja Málaga.",
            "created_at": "2026-09-01T10:00:00"
        },
        {
            "id": "cf-fuenlabrada-cantera",
            "name": "C.F. Fuenlabrada Cantera",
            "shield_url": "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "🔵⚪",
            "location": "Fuenlabrada",
            "province_id": "madrid",
            "province_name": "Madrid",
            "ccaa_id": "madrid",
            "ccaa_name": "Comunidad de Madrid",
            "category": "Juvenil División de Honor",
            "sport_id": "futbol",
            "sport_name": "Fútbol",
            "sport_icon": "⚽",
            "channel_url": "https://www.youtube.com/@cffuenlabrada",
            "is_verified": 1,
            "description": "Cantera oficial del Club de Fútbol Fuenlabrada en el Estadio Fernando Torres. Partidos, ruedas de prensa y resúmenes de la cantera azulona.",
            "created_at": "2026-09-01T10:00:00"
        },
        {
            "id": "fight-club-madrid",
            "name": "Fight Club Madrid",
            "shield_url": "https://images.unsplash.com/photo-1549719386-74dfcbf7dbed?w=160&auto=format&fit=crop&q=80",
            "shield_icon": "🥊💥",
            "location": "Madrid",
            "province_id": "madrid",
            "province_name": "Madrid",
            "ccaa_id": "madrid",
            "ccaa_name": "Comunidad de Madrid",
            "category": "MMA",
            "modality": "MMA",
            "discipline": "MMA",
            "sport_id": "contacto",
            "sport_name": "Boxeo y deportes de contacto",
            "sport_icon": "🥊",
            "channel_url": "https://www.youtube.com/@fightclubmadrid",
            "is_verified": 1,
            "description": "Club oficial de artes marciales mixtas, boxeo y deportes de contacto en Madrid. Retransmisiones oficiales y veladas en directo.",
            "created_at": "2026-09-29T10:00:00"
        }
    ]
    for c in clubs_data:
        modality_val = c.get("modality") or c.get("discipline") or ""
        cursor.execute("""
        INSERT OR REPLACE INTO clubs (
            id, name, shield_url, shield_icon, location, province_id, province_name,
            ccaa_id, ccaa_name, category, sport_id, sport_name, sport_icon,
            channel_url, is_verified, description, created_at, modality, discipline
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            c["id"], c["name"], c["shield_url"], c["shield_icon"], c["location"],
            c["province_id"], c["province_name"], c["ccaa_id"], c["ccaa_name"],
            c["category"], c["sport_id"], c["sport_name"], c["sport_icon"],
            c["channel_url"], c["is_verified"], c["description"], c["created_at"],
            modality_val, modality_val
        ))


def seed_sample_club_videos(cursor):
    """Siembra vídeos clasificados (partidos anteriores, ruedas de prensa y reels 9:16) para los clubes."""
    # Actualizar eventos semilla base con su club_id y canal oficial
    cursor.execute("""
        UPDATE events SET
            club_id = 'cd-las-rozas',
            content_type = 'live',
            channel_url = 'https://www.youtube.com/@cdlasrozasoficial'
        WHERE id = 'evt-1';
    """)
    cursor.execute("""
        UPDATE events SET
            club_id = 'cantera-joventut',
            content_type = 'live',
            channel_url = 'https://www.youtube.com/@Penya1930'
        WHERE id = 'evt-2';
    """)
    cursor.execute("""
        UPDATE events SET
            club_id = 'sevilla-fc-cantera',
            content_type = 'live',
            channel_url = 'https://www.youtube.com/@sevillafc'
        WHERE id = 'evt-3';
    """)
    cursor.execute("""
        UPDATE events SET
            club_id = 'academia-inter-fs',
            content_type = 'live',
            channel_url = 'https://www.youtube.com/@MovistarInterFS'
        WHERE id = 'evt-4';
    """)

    sample_classified = [
        # --- C.D. Las Rozas: Partidos Anteriores (match_replay) ---
        {
            "id": "evt-rozas-rep-1",
            "title": "Jornada 3: C.D. Las Rozas Cadete A vs Rayo Majadahonda B",
            "url_original": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            "platform": "youtube",
            "embed_id": "aqz-KE-bpKQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60",
            "status": "REPLAY",
            "content_type": "match_replay",
            "duration": "92:15",
            "date_time": "2026-09-07T12:00:00",
            "sport_id": "futbol",
            "category_id": "cadete",
            "province_id": "madrid",
            "home_team": "C.D. Las Rozas Cadete A",
            "away_team": "Rayo Majadahonda B",
            "home_score": None,
            "away_score": None,
            "location_venue": "Polideportivo Municipal Dehesa de Navalcarbón",
            "is_verified_club": 1,
            "club_name": "C.D. Las Rozas",
            "club_id": "cd-las-rozas",
            "channel_url": "https://www.youtube.com/@cdlasrozasoficial"
        },
        {
            "id": "evt-rozas-rep-2",
            "title": "Jornada 2: Getafe C.F. Infantil A vs C.D. Las Rozas Infantil A",
            "url_original": "https://www.youtube.com/watch?v=s4OxKQGmn4g",
            "platform": "youtube",
            "embed_id": "s4OxKQGmn4g",
            "embed_url": "https://www.youtube-nocookie.com/embed/s4OxKQGmn4g?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1431324155629-1a6deb1dec8d?w=800&auto=format&fit=crop&q=60",
            "status": "REPLAY",
            "content_type": "match_replay",
            "duration": "88:40",
            "date_time": "2026-08-31T11:30:00",
            "sport_id": "futbol",
            "category_id": "infantil",
            "province_id": "madrid",
            "home_team": "Getafe C.F. Infantil A",
            "away_team": "C.D. Las Rozas Infantil A",
            "home_score": None,
            "away_score": None,
            "location_venue": "Ciudad Deportiva de Getafe",
            "is_verified_club": 1,
            "club_name": "C.D. Las Rozas",
            "club_id": "cd-las-rozas",
            "channel_url": "https://www.youtube.com/@cdlasrozasoficial"
        },
        {
            "id": "evt-rozas-rep-3",
            "title": "Pretemporada: C.D. Las Rozas Cadete vs C.D. Leganés Cadete",
            "url_original": "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
            "platform": "youtube",
            "embed_id": "kJQP7kiw5Fk",
            "embed_url": "https://www.youtube-nocookie.com/embed/kJQP7kiw5Fk?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=800&auto=format&fit=crop&q=60",
            "status": "REPLAY",
            "content_type": "match_replay",
            "duration": "90:00",
            "date_time": "2026-08-24T18:00:00",
            "sport_id": "futbol",
            "category_id": "cadete",
            "province_id": "madrid",
            "home_team": "C.D. Las Rozas Cadete",
            "away_team": "C.D. Leganés Cadete",
            "home_score": None,
            "away_score": None,
            "location_venue": "Navalcarbón (Campo 2)",
            "is_verified_club": 1,
            "club_name": "C.D. Las Rozas",
            "club_id": "cd-las-rozas",
            "channel_url": "https://www.youtube.com/@cdlasrozasoficial"
        },

        # --- C.D. Las Rozas: Ruedas de Prensa y Previas (press) ---
        {
            "id": "evt-rozas-press-1",
            "title": "Rueda de Prensa Previa: El entrenador analiza el derbi frente a Pozuelo",
            "url_original": "https://www.youtube.com/watch?v=3JZ_D3ELwOQ",
            "platform": "youtube",
            "embed_id": "3JZ_D3ELwOQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/3JZ_D3ELwOQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=800&auto=format&fit=crop&q=60",
            "status": "REPLAY",
            "content_type": "press",
            "duration": "08:45",
            "date_time": "2026-09-13T17:00:00",
            "sport_id": "futbol",
            "category_id": "cadete",
            "province_id": "madrid",
            "home_team": "C.D. Las Rozas",
            "away_team": "Sala de Prensa",
            "home_score": None,
            "away_score": None,
            "location_venue": "Sala de Prensa Navalcarbón",
            "is_verified_club": 1,
            "club_name": "C.D. Las Rozas",
            "club_id": "cd-las-rozas",
            "channel_url": "https://www.youtube.com/@cdlasrozasoficial"
        },
        {
            "id": "evt-rozas-press-2",
            "title": "Declaraciones Post-Partido: El capitán valora la racha invicta del equipo",
            "url_original": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "platform": "youtube",
            "embed_id": "dQw4w9WgXcQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1522778119026-d647f0596c20?w=800&auto=format&fit=crop&q=60",
            "status": "REPLAY",
            "content_type": "press",
            "duration": "05:12",
            "date_time": "2026-09-08T14:15:00",
            "sport_id": "futbol",
            "category_id": "cadete",
            "province_id": "madrid",
            "home_team": "C.D. Las Rozas",
            "away_team": "Zona Mixta",
            "home_score": None,
            "away_score": None,
            "location_venue": "Zona Mixta Navalcarbón",
            "is_verified_club": 1,
            "club_name": "C.D. Las Rozas",
            "club_id": "cd-las-rozas",
            "channel_url": "https://www.youtube.com/@cdlasrozasoficial"
        },

        # --- C.D. Las Rozas: Reels / Shorts (9:16) ---
        {
            "id": "evt-rozas-reel-1",
            "title": "¡Golazo por la escuadra en el minuto 89 para ganar el derbi! 🚀🔥",
            "url_original": "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
            "platform": "youtube",
            "embed_id": "kJQP7kiw5Fk",
            "embed_url": "https://www.youtube-nocookie.com/embed/kJQP7kiw5Fk?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1574629810360-7efbbe195018?w=500&auto=format&fit=crop&q=80",
            "status": "REPLAY",
            "content_type": "reel",
            "duration": "00:32",
            "date_time": "2026-09-07T14:00:00",
            "sport_id": "futbol",
            "category_id": "cadete",
            "province_id": "madrid",
            "home_team": "C.D. Las Rozas",
            "away_team": "Mejores Jugadas",
            "home_score": None,
            "away_score": None,
            "location_venue": "Navalcarbón",
            "is_verified_club": 1,
            "club_name": "C.D. Las Rozas",
            "club_id": "cd-las-rozas",
            "channel_url": "https://www.youtube.com/@cdlasrozasoficial"
        },
        {
            "id": "evt-rozas-reel-2",
            "title": "Parada milagrosa a bocajarro en el descuento para salvar los 3 puntos 🧤🧱",
            "url_original": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            "platform": "youtube",
            "embed_id": "aqz-KE-bpKQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=500&auto=format&fit=crop&q=80",
            "status": "REPLAY",
            "content_type": "reel",
            "duration": "00:24",
            "date_time": "2026-09-01T10:00:00",
            "sport_id": "futbol",
            "category_id": "cadete",
            "province_id": "madrid",
            "home_team": "C.D. Las Rozas",
            "away_team": "Momentos Épicos",
            "home_score": None,
            "away_score": None,
            "location_venue": "Navalcarbón",
            "is_verified_club": 1,
            "club_name": "C.D. Las Rozas",
            "club_id": "cd-las-rozas",
            "channel_url": "https://www.youtube.com/@cdlasrozasoficial"
        },
        {
            "id": "evt-rozas-reel-3",
            "title": "Celebración y fiesta en el vestuario: ¡Equipo invicto una jornada más! 🔵⚪🕺",
            "url_original": "https://www.youtube.com/watch?v=s4OxKQGmn4g",
            "platform": "youtube",
            "embed_id": "s4OxKQGmn4g",
            "embed_url": "https://www.youtube-nocookie.com/embed/s4OxKQGmn4g?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1517466787929-bc90951d0974?w=500&auto=format&fit=crop&q=80",
            "status": "REPLAY",
            "content_type": "reel",
            "duration": "00:45",
            "date_time": "2026-08-25T20:00:00",
            "sport_id": "futbol",
            "category_id": "cadete",
            "province_id": "madrid",
            "home_team": "C.D. Las Rozas",
            "away_team": "Vestuario",
            "home_score": None,
            "away_score": None,
            "location_venue": "Vestuarios Navalcarbón",
            "is_verified_club": 1,
            "club_name": "C.D. Las Rozas",
            "club_id": "cd-las-rozas",
            "channel_url": "https://www.youtube.com/@cdlasrozasoficial"
        },

        # --- Cantera Joventut: Press y Reels ---
        {
            "id": "evt-joventut-press-1",
            "title": "Previa de la Final Junior: Claves tácticas del cuerpo técnico de la Penya",
            "url_original": "https://www.youtube.com/watch?v=OPf0YbXqDm0",
            "platform": "youtube",
            "embed_id": "OPf0YbXqDm0",
            "embed_url": "https://www.youtube-nocookie.com/embed/OPf0YbXqDm0?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1546519638-68e109498ffc?w=800&auto=format&fit=crop&q=60",
            "status": "REPLAY",
            "content_type": "press",
            "duration": "06:30",
            "date_time": "2026-09-13T19:00:00",
            "sport_id": "baloncesto",
            "category_id": "junior",
            "province_id": "barcelona",
            "home_team": "Cantera Joventut",
            "away_team": "Sala de Prensa",
            "home_score": None,
            "away_score": None,
            "location_venue": "Pavelló Olímpic de Badalona",
            "is_verified_club": 1,
            "club_name": "Cantera Joventut",
            "club_id": "cantera-joventut",
            "channel_url": "https://www.youtube.com/@Penya1930"
        },
        {
            "id": "evt-joventut-reel-1",
            "title": "¡Mate espectacular en contraataque durante el calentamiento! 🏀💥",
            "url_original": "https://www.youtube.com/watch?v=OPf0YbXqDm0",
            "platform": "youtube",
            "embed_id": "OPf0YbXqDm0",
            "embed_url": "https://www.youtube-nocookie.com/embed/OPf0YbXqDm0?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1519861531473-9200262188bf?w=500&auto=format&fit=crop&q=80",
            "status": "REPLAY",
            "content_type": "reel",
            "duration": "00:20",
            "date_time": "2026-09-14T11:00:00",
            "sport_id": "baloncesto",
            "category_id": "junior",
            "province_id": "barcelona",
            "home_team": "Cantera Joventut",
            "away_team": "Top Jugadas",
            "home_score": None,
            "away_score": None,
            "location_venue": "Olímpic de Badalona",
            "is_verified_club": 1,
            "club_name": "Cantera Joventut",
            "club_id": "cantera-joventut",
            "channel_url": "https://www.youtube.com/@Penya1930"
        },
        # --- C.F. Fuenlabrada Cantera: Historial de vídeos de YouTube (partidos en diferido, prensa, reels) ---
        {
            "id": "evt-fuenla-rep-1",
            "title": "Jornada 5: C.F. Fuenlabrada Juvenil A vs Rayo Vallecano Juvenil A",
            "url_original": "https://www.youtube.com/watch?v=s4OxKQGmn4g",
            "platform": "youtube",
            "embed_id": "s4OxKQGmn4g",
            "embed_url": "https://www.youtube-nocookie.com/embed/s4OxKQGmn4g?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://img.youtube.com/vi/s4OxKQGmn4g/hqdefault.jpg",
            "status": "REPLAY",
            "content_type": "match_replay",
            "duration": "93:20",
            "date_time": "2026-09-20T17:00:00",
            "sport_id": "futbol",
            "category_id": "juvenil",
            "province_id": "madrid",
            "home_team": "C.F. Fuenlabrada Juvenil A",
            "away_team": "Rayo Vallecano Juvenil A",
            "home_score": None,
            "away_score": None,
            "location_venue": "Estadio Fernando Torres (Campo Anexo), Fuenlabrada",
            "is_verified_club": 1,
            "club_name": "C.F. Fuenlabrada Cantera",
            "club_id": "cf-fuenlabrada-cantera",
            "channel_url": "https://www.youtube.com/@cffuenlabrada"
        },
        {
            "id": "evt-fuenla-rep-2",
            "title": "Jornada 4: C.F. Fuenlabrada Juvenil A vs C.D. Leganés Juvenil",
            "url_original": "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
            "platform": "youtube",
            "embed_id": "aqz-KE-bpKQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://img.youtube.com/vi/aqz-KE-bpKQ/hqdefault.jpg",
            "status": "REPLAY",
            "content_type": "match_replay",
            "duration": "90:45",
            "date_time": "2026-09-13T12:00:00",
            "sport_id": "futbol",
            "category_id": "juvenil",
            "province_id": "madrid",
            "home_team": "C.F. Fuenlabrada Juvenil A",
            "away_team": "C.D. Leganés Juvenil",
            "home_score": None,
            "away_score": None,
            "location_venue": "Estadio Fernando Torres, Fuenlabrada",
            "is_verified_club": 1,
            "club_name": "C.F. Fuenlabrada Cantera",
            "club_id": "cf-fuenlabrada-cantera",
            "channel_url": "https://www.youtube.com/@cffuenlabrada"
        },
        {
            "id": "evt-fuenla-press-1",
            "title": "Rueda de Prensa: Análisis del míster tras la victoria en el derbi juvenil",
            "url_original": "https://www.youtube.com/watch?v=kJQP7kiw5Fk",
            "platform": "youtube",
            "embed_id": "kJQP7kiw5Fk",
            "embed_url": "https://www.youtube-nocookie.com/embed/kJQP7kiw5Fk?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://img.youtube.com/vi/kJQP7kiw5Fk/hqdefault.jpg",
            "status": "REPLAY",
            "content_type": "press",
            "duration": "08:45",
            "date_time": "2026-09-21T11:00:00",
            "sport_id": "futbol",
            "category_id": "juvenil",
            "province_id": "madrid",
            "home_team": "C.F. Fuenlabrada Cantera",
            "away_team": "Rayo Vallecano Juvenil A",
            "home_score": None,
            "away_score": None,
            "location_venue": "Sala de Prensa Estadio Fernando Torres",
            "is_verified_club": 1,
            "club_name": "C.F. Fuenlabrada Cantera",
            "club_id": "cf-fuenlabrada-cantera",
            "channel_url": "https://www.youtube.com/@cffuenlabrada"
        },
        {
            "id": "evt-fuenla-reel-1",
            "title": "Golazo de falta directa de la cantera azulona en el Fernando Torres 🚀⚽",
            "url_original": "https://www.youtube.com/shorts/aqz-KE-bpKQ",
            "platform": "youtube",
            "embed_id": "aqz-KE-bpKQ",
            "embed_url": "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=0&modestbranding=1&rel=0",
            "thumbnail": "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=500&auto=format&fit=crop&q=80",
            "status": "REPLAY",
            "content_type": "reel",
            "duration": "00:45",
            "date_time": "2026-09-22T19:30:00",
            "sport_id": "futbol",
            "category_id": "juvenil",
            "province_id": "madrid",
            "home_team": "C.F. Fuenlabrada Cantera",
            "away_team": "Cantera Azulona",
            "home_score": None,
            "away_score": None,
            "location_venue": "Fuenlabrada",
            "is_verified_club": 1,
            "club_name": "C.F. Fuenlabrada Cantera",
            "club_id": "cf-fuenlabrada-cantera",
            "channel_url": "https://www.youtube.com/@cffuenlabrada"
        }
    ]

    for item in sample_classified:
        geo = get_province_info(item["province_id"])
        sport = get_sport_info(item["sport_id"], item["category_id"])

        cursor.execute("""
        INSERT OR REPLACE INTO events (
            id, title, url_original, platform, embed_id, embed_url, thumbnail,
            status, date_time, sport_id, sport_name, sport_icon,
            category_id, category_name, ccaa_id, ccaa_name,
            province_id, province_name, home_team, away_team,
            home_score, away_score, location_venue, is_verified_club,
            club_name, sponsor_name, sponsor_logo, sponsor_url,
            report_count, views_count, created_at, created_by_user_id,
            content_type, club_id, channel_url, duration
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?, ?)
        """, (
            item["id"],
            item["title"],
            item["url_original"],
            item["platform"],
            item["embed_id"],
            item["embed_url"],
            item["thumbnail"],
            item["status"],
            item["date_time"],
            item["sport_id"],
            sport["sport_name"] if sport else item["sport_id"],
            sport["sport_icon"] if sport else "🏅",
            item["category_id"],
            sport["category_name"] if (sport and sport.get("category_name")) else item["category_id"].capitalize(),
            geo["ccaa_id"] if geo else "madrid",
            geo["ccaa_name"] if geo else "Comunidad de Madrid",
            item["province_id"],
            geo["province_name"] if geo else item["province_id"].capitalize(),
            item["home_team"],
            item["away_team"],
            item["home_score"],
            item["away_score"],
            item["location_venue"],
            item.get("is_verified_club", 1),
            item["club_name"],
            "", "", "",
            120,
            item["date_time"],
            item.get("content_type", "live"),
            item.get("club_id", ""),
            item.get("channel_url", ""),
            item.get("duration", "")
        ))


def seed_sample_club_community_messages(cursor):
    """Siembra mensajes iniciales para el chat de comunidad del club."""
    sample_msgs = [
        ("cd-las-rozas", "Socio 312 (Aficionado)", "¡A por todas este fin de semana en Navalcarbón! Todo el apoyo al cadete 🔵⚪", "viewer", "2026-09-14T09:15:00"),
        ("cd-las-rozas", "Delegado C.D. Las Rozas", "Muchas gracias afición por el apoyo constante. ¡Este sábado esperamos llenar la grada!", "club", "2026-09-14T10:30:00"),
        ("cd-las-rozas", "Marta Gómez", "Gran inicio de temporada de la cantera, qué orgullo verlos jugar así.", "viewer", "2026-09-14T11:45:00"),
        ("cd-las-rozas", "Admin General", "¡Canal oficial de C.D. Las Rozas activo en SportsLive! Disfrutad de los contenidos y buen ambiente. 🛡️", "admin", "2026-09-14T12:00:00"),
        ("cantera-joventut", "Prensa Joventut", "Bienvenidos al canal oficial de la Penya en SportsLive. Força Penya! 🏀💚", "club", "2026-09-14T10:00:00"),
        ("cantera-joventut", "Jordi Basket", "¡Qué ganas de ver la final junior autonómica hoy!", "viewer", "2026-09-14T11:20:00"),
        ("cf-fuenlabrada-cantera", "Admin General", "¡Canal oficial de la cantera del C.F. Fuenlabrada disponible en SportsLive! 🔵⚪", "admin", "2026-09-20T10:00:00"),
        ("cf-fuenlabrada-cantera", "Afición Azulona", "¡Gran victoria del Juvenil A en el derbi! A seguir sumando en División de Honor 🔥", "viewer", "2026-09-20T19:30:00"),
        ("cf-intercity", "Afición Alicante", "¡A por los 3 puntos en el Antonio Solana este fin de semana! 💪🔵⚪", "viewer", "2026-09-28T18:00:00"),
        ("cf-intercity", "Prensa CF Intercity", "Bienvenidos al Muro de la Afición del CF Intercity. ¡Dejad vuestros mensajes de apoyo al equipo! 🛡️⚽", "club", "2026-09-28T18:30:00"),
        ("cf-intercity", "Socio BME", "Gran trabajo del cuerpo técnico y los chavales, orgullo de equipo.", "viewer", "2026-09-28T19:15:00"),
        ("cf-intercity", "Peña Hombres de Negro", "¡Siempre con el Intercity! A darlo todo en cada jornada 🔥", "viewer", "2026-09-28T20:00:00")
    ]
    for c_id, u_name, msg, role, dt in sample_msgs:
        cursor.execute("SELECT id FROM club_chat_messages WHERE (LOWER(club_id) = LOWER(?) OR LOWER(club_id) IN (SELECT LOWER(id) FROM clubs WHERE LOWER(name) = LOWER(?))) AND message = ? LIMIT 1;", (c_id, c_id, msg))
        if not cursor.fetchone():
            m_id = f"cmsg-{uuid.uuid4().hex[:10]}"
            cursor.execute("""
            INSERT INTO club_chat_messages (id, club_id, user_id, user_name, user_role, message, created_at)
            VALUES (?, ?, NULL, ?, ?, ?, ?)
            """, (m_id, c_id, u_name, role, msg, dt))


def get_club_by_id_or_name(club_identifier: str) -> dict:
    """Busca y devuelve el perfil completo de un club activo y autorizado junto con su clasificación de vídeos."""
    if not club_identifier:
        return None
    conn = get_db()
    try:
        cursor = conn.cursor()
        clean = club_identifier.strip()
        clean_lower = clean.lower()

        # 1. Buscar en la tabla clubs por id o name (solo activo y aprobado)
        cursor.execute("""
            SELECT * FROM clubs 
            WHERE (LOWER(id) = ? OR LOWER(name) = ?) AND is_active = 1 AND approved_by_admin = 1 
            LIMIT 1;
        """, (clean_lower, clean_lower))
        row = cursor.fetchone()
        if not row:
            cursor.execute("""
                SELECT * FROM clubs 
                WHERE (LOWER(name) LIKE ? OR LOWER(id) LIKE ?) AND is_active = 1 AND approved_by_admin = 1 
                LIMIT 1;
            """, (f"%{clean_lower}%", f"%{clean_lower}%"))
            row = cursor.fetchone()

        if not row:
            return None

        club = dict(row)

        # 2. Vídeos clasificados del club
        classified = list_club_classified_videos(club["name"], club.get("id"))
        club["live_event"] = classified.get("live_event")
        club["last_event"] = classified.get("last_event")
        club["match_replays"] = classified.get("match_replays", [])
        club["press_videos"] = classified.get("press_videos", [])
        club["reels"] = classified.get("reels", [])
        club["total_videos"] = len(classified.get("all_videos", []))

        # 3. Métricas de comunidad
        cursor.execute("SELECT COUNT(*) FROM club_chat_messages WHERE club_id = ? OR club_id = ?;", (club.get("id", ""), club["name"]))
        club["community_messages_count"] = cursor.fetchone()[0]

        return club
    finally:
        conn.close()


def list_club_classified_videos(club_name: str, club_id: str = None) -> dict:
    """Clasifica los vídeos de un club en Nivel 1 (Live/Última emisión), Nivel 2 (Partidos anteriores) y Nivel 3 (Prensa y Reels)."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        query = """
        SELECT * FROM events
        WHERE (LOWER(club_name) = LOWER(?) OR (club_id IS NOT NULL AND LOWER(club_id) = LOWER(?)) OR LOWER(home_team) = LOWER(?))
        ORDER BY date_time DESC;
        """
        cursor.execute(query, (club_name, club_id or club_name, club_name))
        rows = [dict(r) for r in cursor.fetchall()]

        live_event = None
        match_replays = []
        press_videos = []
        reels = []

        for ev in rows:
            ctype = ev.get("content_type") or ("match_replay" if ev.get("status") == "REPLAY" else "live")
            if ev.get("status") == "LIVE" and not live_event:
                live_event = ev
            elif ctype == "press":
                press_videos.append(ev)
            elif ctype == "reel":
                reels.append(ev)
            elif ctype in ("match_replay", "live") or ev.get("status") == "REPLAY":
                match_replays.append(ev)
            else:
                match_replays.append(ev)

        last_event = live_event or (match_replays[0] if match_replays else (rows[0] if rows else None))

        return {
            "live_event": live_event,
            "last_event": last_event,
            "match_replays": match_replays,
            "press_videos": press_videos,
            "reels": reels,
            "all_videos": rows
        }
    finally:
        conn.close()


def get_club_community_messages(club_id: str, limit: int = 80) -> list:
    """Devuelve los mensajes del chat de comunidad permanente de un club."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        clean_id = (club_id or "").strip()
        # Resolver tanto por ID como por nombre del club (case-insensitive)
        cursor.execute("""
        SELECT id, club_id, user_id, user_name, user_role, message, created_at
        FROM club_chat_messages
        WHERE LOWER(club_id) = LOWER(?)
           OR LOWER(club_id) IN (SELECT LOWER(id) FROM clubs WHERE LOWER(name) = LOWER(?) OR LOWER(id) = LOWER(?))
           OR LOWER(club_id) IN (SELECT LOWER(name) FROM clubs WHERE LOWER(id) = LOWER(?) OR LOWER(name) = LOWER(?))
        ORDER BY created_at ASC
        LIMIT ?;
        """, (clean_id, clean_id, clean_id, clean_id, clean_id, limit))
        rows = cursor.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_club_community_message(club_id: str, user_name: str, message: str, user_id: str = None, user_role: str = 'viewer') -> dict:
    """Registra y persiste un mensaje en el chat de comunidad del club."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        msg_id = f"cmsg-{uuid.uuid4().hex[:10]}"
        now_iso = datetime.datetime.now().isoformat()
        clean_user = (user_name or "Aficionado").strip()[:40]
        clean_msg = message.strip()[:300]
        clean_role = user_role if user_role in ("admin", "club", "viewer", "aficionado") else "viewer"

        # Resolver el ID canónico del club si existe en la tabla clubs
        clean_id = (club_id or "").strip()
        cursor.execute("SELECT id FROM clubs WHERE LOWER(id) = LOWER(?) OR LOWER(name) = LOWER(?) LIMIT 1;", (clean_id, clean_id))
        c_row = cursor.fetchone()
        canonical_club_id = c_row[0] if c_row else clean_id

        cursor.execute("""
        INSERT INTO club_chat_messages (id, club_id, user_id, user_name, user_role, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        """, (msg_id, canonical_club_id, user_id, clean_user, clean_role, clean_msg, now_iso))
        conn.commit()

        return {
            "id": msg_id,
            "club_id": canonical_club_id,
            "user_id": user_id,
            "user_name": clean_user,
            "user_role": clean_role,
            "message": clean_msg,
            "created_at": now_iso
        }
    finally:
        conn.close()


def create_club(data: dict) -> dict:
    """Registra o da de alta un club oficial indicando su canal de YouTube, incluso si su estado es OFFLINE."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        name = (data.get("name") or "").strip()
        if not name:
            raise ValueError("El nombre del club es obligatorio.")

        import unicodedata
        normalized = unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode('utf-8')
        raw_id = data.get("id") or normalized.lower().replace(" ", "-").replace(".", "").replace("/", "-")
        clean_id = re.sub(r'[^a-z0-9\-]', '', raw_id.lower().strip())
        clean_id = re.sub(r'-+', '-', clean_id).strip('-')
        if not clean_id:
            clean_id = f"club-{uuid.uuid4().hex[:8]}"

        channel_url = (data.get("channel_url") or "").strip()

        # Evitar duplicados por nombre o ID
        cursor.execute("SELECT id, name FROM clubs WHERE LOWER(name) = LOWER(?) OR LOWER(id) = LOWER(?);", (name, clean_id))
        existing = cursor.fetchone()
        if existing:
            if channel_url:
                cursor.execute("UPDATE clubs SET channel_url = ? WHERE id = ?;", (channel_url, existing["id"]))
                conn.commit()
            # Si se proporcionaron vídeos adicionales para importar
            videos = data.get("videos") or data.get("initial_videos") or []
            if isinstance(videos, list) and len(videos) > 0:
                import_club_youtube_videos(existing["id"], videos)
            return get_club_by_id_or_name(existing["id"])

        location = (data.get("location") or "España").strip()
        category = (data.get("category") or "Categoría Formativa").strip()
        sport_id = (data.get("sport_id") or "futbol").strip().lower()
        shield_url = (data.get("shield_url") or "").strip()
        shield_icon = (data.get("shield_icon") or "🛡️").strip()
        description = (data.get("description") or f"Canal oficial de {name} en SportsLive.").strip()
        user_id = data.get("user_id")

        # Deporte info
        modality = str(data.get("modality") or data.get("discipline") or "").strip()
        if sport_id in ("contacto", "boxeo_contacto"):
            sport_id = "contacto"
            sport_name = "Boxeo y deportes de contacto"
            sport_icon = "🥊"
            if modality and (not category or category == "Categoría Formativa"):
                category = modality
        else:
            sport_info = get_sport_info(sport_id, "")
            sport_name = data.get("sport_name") or (sport_info.get("sport_name") if sport_info else "Fútbol")
            sport_icon = data.get("sport_icon") or (sport_info.get("sport_icon") if sport_info else "⚽")

        # Geo info
        province_id = (data.get("province_id") or "").strip().lower()
        if not province_id:
            for c in CCAA_PROVINCIAS:
                for p in c["provinces"]:
                    if p["name"].lower() in location.lower() or location.lower() in p["name"].lower():
                        province_id = p["id"]
                        break
                if province_id:
                    break
        if not province_id:
            province_id = "madrid"

        prov_info = get_province_info(province_id)
        province_name = data.get("province_name") or (prov_info.get("province_name") if prov_info else "Madrid")
        ccaa_id = data.get("ccaa_id") or (prov_info.get("ccaa_id") if prov_info else "madrid")
        ccaa_name = data.get("ccaa_name") or (prov_info.get("ccaa_name") if prov_info else "Comunidad de Madrid")

        now_iso = datetime.datetime.now().isoformat()

        cursor.execute("""
        INSERT INTO clubs (
            id, name, shield_url, shield_icon, location,
            province_id, province_name, ccaa_id, ccaa_name,
            category, sport_id, sport_name, sport_icon,
            channel_url, is_verified, description, user_id, created_at,
            modality, discipline, is_active, approved_by_admin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1);
        """, (
            clean_id, name, shield_url, shield_icon, location,
            province_id, province_name, ccaa_id, ccaa_name,
            category, sport_id, sport_name, sport_icon,
            channel_url, 1, description, user_id, now_iso,
            modality, modality
        ))
        conn.commit()

        # Si se indicaron vídeos iniciales para importar
        videos = data.get("videos") or data.get("initial_videos") or []
        if isinstance(videos, list) and len(videos) > 0:
            import_club_youtube_videos(clean_id, videos)

        return get_club_by_id_or_name(clean_id)
    finally:
        conn.close()


def delete_club(club_id: str) -> bool:
    """Elimina un club y sus eventos asociados."""
    conn = get_db()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name FROM clubs WHERE LOWER(id) = LOWER(?) OR LOWER(name) = LOWER(?)", (club_id, club_id))
        row = cursor.fetchone()
        if not row:
            return False
        cid, cname = row[0], row[1]
        cursor.execute("DELETE FROM events WHERE club_id = ? OR club_name = ?", (cid, cname))
        cursor.execute("DELETE FROM club_chat_messages WHERE club_id = ? OR club_id = ?", (cid, cname))
        cursor.execute("DELETE FROM clubs WHERE id = ?", (cid,))
        conn.commit()
        return True
    finally:
        conn.close()


def import_club_youtube_videos(club_id: str, videos: list) -> list:
    """Importa o registra los vídeos anteriores de YouTube (partidos en diferido, ruedas de prensa, reels) asociados a un club."""
    club = get_club_by_id_or_name(club_id)
    if not club:
        raise ValueError(f"No se encontró el club '{club_id}'.")

    conn = get_db()
    created_events = []
    try:
        cursor = conn.cursor()
        for vid in videos:
            if not isinstance(vid, dict):
                continue
            url = (vid.get("url_original") or vid.get("stream_url") or vid.get("url") or "").strip()
            if not url:
                continue

            extracted = extract_metadata_from_url(url)
            title = (vid.get("title") or extracted.get("title") or f"Emisión de {club['name']}").strip()
            platform = extracted.get("platform", "youtube")
            embed_id = extracted.get("embed_id", "")
            embed_url = extracted.get("embed_url", "")
            thumbnail = vid.get("thumbnail") or extracted.get("thumbnail") or "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?w=800&auto=format&fit=crop&q=60"

            ev_id = vid.get("id") or f"evt-{club['id'][:10]}-{uuid.uuid4().hex[:8]}"

            # Evitar duplicados por id o por embed_id
            cursor.execute("SELECT id FROM events WHERE id = ? OR (club_id = ? AND embed_id = ? AND embed_id != '');", (ev_id, club["id"], embed_id))
            exist_ev = cursor.fetchone()
            if exist_ev:
                continue

            content_type = (vid.get("content_type") or "match_replay").strip().lower()
            if content_type not in ("match_replay", "press", "reel", "live"):
                content_type = "match_replay"

            status = "REPLAY"
            duration = (vid.get("duration") or ("90:00" if content_type == "match_replay" else ("08:00" if content_type == "press" else "00:45"))).strip()
            date_time = vid.get("date_time") or datetime.datetime.now().isoformat()

            home_team = (vid.get("home_team") or club["name"]).strip()
            away_team = (vid.get("away_team") or "").strip()
            if away_team.startswith("Rival de") or away_team in ("Equipo", "Cantera Oficial"):
                away_team = ""
            home_score = parse_score(vid.get("home_score")) if status == "LIVE" else None
            away_score = parse_score(vid.get("away_score")) if status == "LIVE" else None

            location_venue = vid.get("location_venue") or club.get("location") or "Instalaciones Deportivas Oficiales"
            now_iso = datetime.datetime.now().isoformat()

            cursor.execute("""
            INSERT INTO events (
                id, title, url_original, platform, embed_id, embed_url,
                thumbnail, status, date_time, sport_id, sport_name, sport_icon,
                category_id, category_name, ccaa_id, ccaa_name, province_id, province_name,
                location_venue, home_team, away_team, home_score, away_score,
                sponsor_name, sponsor_logo, sponsor_url, is_verified_club, club_name,
                views_count, report_count, created_at, club_id, channel_url, duration, content_type
            ) VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                0, 0, ?, ?, ?, ?, ?
            );
            """, (
                ev_id, title, url, platform, embed_id, embed_url,
                thumbnail, status, date_time, club["sport_id"], club["sport_name"], club["sport_icon"],
                "base", club["category"], club["ccaa_id"], club["ccaa_name"], club["province_id"], club["province_name"],
                location_venue, home_team, away_team, home_score, away_score,
                "", "", "", 1, club["name"],
                now_iso, club["id"], club["channel_url"], duration, content_type
            ))
            created_events.append({
                "id": ev_id,
                "title": title,
                "url_original": url,
                "embed_url": embed_url,
                "thumbnail": thumbnail,
                "status": status,
                "content_type": content_type,
                "duration": duration,
                "date_time": date_time,
                "club_id": club["id"],
                "club_name": club["name"]
            })

        conn.commit()
        return created_events
    finally:
        conn.close()


