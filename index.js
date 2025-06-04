const { Telegraf, Scenes, session, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const cron = require('node-cron');
const { escape } = require('html-escaper');

// =============================================
// EXTENSION YOUTUBE DOWNLOADER PRO
// =============================================
const ytdl = require('@distube/ytdl-core');
const { promisify } = require('util');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

// Agent personnalisé pour contourner les restrictions
const ytdlAgent = ytdl.createAgent([
    {
        "jar": undefined,
        "localAddress": undefined,
        "headers": {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
    }
]);

// =============================================
// CONFIGURATION
// =============================================
const CONFIG = {
    TOKEN: '7890955434:AAHV4uIKCb-LWNYl-Vx1hjdSx8bYzCoU794',
    ADMIN_ID: 6419892672,
    IMAGE_DIR: 'cdn/images',
    THUMBNAIL_DIR: 'cdn/thumbnails',
    DB_FILE: 'database/cdsanimebase.db',
    FLASHCARD_TIMEOUT: 10000,
    QUIZ_TIMEOUT: 20000,
    DAILY_REMINDER: '0 18 * * *',
    GROUP_SESSION_TIMEOUT: 300000, // 5 minutes d'inactivité pour les sessions de groupe
    // Extension SRS
    SRS_INTERVALS: [1, 3, 7, 14, 30], // Jours entre les révisions
    SRS_REMINDER_HOUR: 18, // Heure des rappels (18h)
    SRS_MAX_ITEMS: 20, // Nombre max d'éléments par session
    // Extension YouTube Downloader
    TEMP_DIR: 'temp',
    MAX_FILE_SIZE: 50, // 50MB (limite Telegram)
    AUDIO_QUALITY: '320k', // Qualité audio améliorée
    VIDEO_QUALITY: '720p', // Qualité vidéo par défaut
    SEARCH_LIMIT: 8, // Nombre de résultats de recherche
    DOWNLOAD_TIMEOUT: 300000, // 5 minutes timeout
    MAX_HOURLY_DOWNLOADS_USER: 5, // Limite par heure pour utilisateur lambda
    MAX_HOURLY_DOWNLOADS_ADMIN: 10, // Limite par heure pour admin
    MAX_DAILY_DOWNLOADS_USER: 20, // Limite par jour pour utilisateur lambda
    MAX_DAILY_DOWNLOADS_ADMIN: -1 // Pas de limite journalière pour admin (-1 = illimité)
};

// =============================================
// INITIALISATION DES RÉPERTOIRES
// =============================================
[CONFIG.IMAGE_DIR, CONFIG.THUMBNAIL_DIR, path.dirname(CONFIG.DB_FILE), CONFIG.TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// =============================================
// BASE DE DONNÉES AVEC EXTENSION SRS
// =============================================
class SRSDatabaseExtension {
    constructor() {
        this.db = new sqlite3.Database(CONFIG.DB_FILE);
        this.init();
    }

    init() {
        this.db.serialize(() => {
            // Table des versets
            this.db.run(`CREATE TABLE IF NOT EXISTS verses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Table des flashcards
            this.db.run(`CREATE TABLE IF NOT EXISTS flashcards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                verse_id INTEGER NOT NULL,
                type TEXT CHECK(type IN ('image', 'text')) DEFAULT 'image',
                question TEXT,
                answer TEXT NOT NULL,
                image_path TEXT,
                thumbnail_path TEXT,
                alternatives TEXT,
                difficulty INTEGER CHECK(difficulty BETWEEN 1 AND 5) DEFAULT 3,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_reviewed DATETIME,
                review_count INTEGER DEFAULT 0,
                success_rate REAL DEFAULT 0,
                created_by INTEGER,
                FOREIGN KEY(verse_id) REFERENCES verses(id) ON DELETE CASCADE
            )`);

            // Table des quiz
            this.db.run(`CREATE TABLE IF NOT EXISTS quizzes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                verse_id INTEGER NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                image_path TEXT,
                options TEXT,
                explanation TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER,
                FOREIGN KEY(verse_id) REFERENCES verses(id) ON DELETE CASCADE
            )`);

            // Table des quiz questions (nouvelle extension)
            this.db.run(`CREATE TABLE IF NOT EXISTS quiz_questions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                verse_id INTEGER NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                alternatives TEXT,
                explanation TEXT,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(verse_id) REFERENCES verses(id) ON DELETE CASCADE
            )`);

            // Table des blind tests
            this.db.run(`CREATE TABLE IF NOT EXISTS blind_tests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                verse_id INTEGER NOT NULL,
                audio_path TEXT NOT NULL,
                title TEXT NOT NULL,
                alternatives TEXT,
                created_by INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(verse_id) REFERENCES verses(id) ON DELETE CASCADE
            )`);

            // Table des sessions utilisateur
            this.db.run(`CREATE TABLE IF NOT EXISTS user_sessions (
                user_id INTEGER PRIMARY KEY,
                current_verse_id INTEGER,
                flashcard_index INTEGER DEFAULT 0,
                quiz_index INTEGER DEFAULT 0,
                last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(current_verse_id) REFERENCES verses(id)
            )`);

            // Table des sessions de groupe
            this.db.run(`CREATE TABLE IF NOT EXISTS group_sessions (
                chat_id INTEGER PRIMARY KEY,
                verse_id INTEGER NOT NULL,
                current_index INTEGER DEFAULT 0,
                flashcards TEXT, -- JSON array of flashcard IDs
                scores TEXT, -- JSON object {user_id: score}
                start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(verse_id) REFERENCES verses(id)
            )`);

            // Table des utilisateurs
            this.db.run(`CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                first_name TEXT,
                last_name TEXT,
                last_active DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_admin BOOLEAN DEFAULT 0
            )`);

            // Table SRS pour les révisions espacées
            this.db.run(`CREATE TABLE IF NOT EXISTS srs_reviews (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,
                item_type TEXT CHECK(item_type IN ('flashcard', 'quiz', 'blindtest')) NOT NULL,
                verse_id INTEGER,
                interval INTEGER DEFAULT 0,
                repetitions INTEGER DEFAULT 0,
                ease_factor REAL DEFAULT 2.5,
                next_review DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_reviewed DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(user_id),
                FOREIGN KEY(verse_id) REFERENCES verses(id)
            )`);

            // Table pour suivre les téléchargements YouTube
            this.db.run(`CREATE TABLE IF NOT EXISTS user_downloads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                date DATE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`);

            // Ajouter la colonne hour si elle n'existe pas (migration)
            this.db.run(`ALTER TABLE user_downloads ADD COLUMN hour INTEGER DEFAULT 0`, (err) => {
                if (err && !err.message.includes('duplicate column name')) {
                    console.error('Erreur lors de l\'ajout de la colonne hour:', err.message);
                }
            });
        });
    }

    query(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.all(sql, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }

    // Méthodes spécifiques existantes
    async getVerseByName(name) {
        const rows = await this.query('SELECT * FROM verses WHERE name = ?', [name]);
        return rows[0];
    }

    async getFlashcardsByVerse(verseId) {
        return this.query('SELECT * FROM flashcards WHERE verse_id = ?', [verseId]);
    }

    async getFlashcardById(id) {
        const rows = await this.query('SELECT * FROM flashcards WHERE id = ?', [id]);
        return rows[0];
    }

    async getUser(userId) {
        const rows = await this.query('SELECT * FROM users WHERE user_id = ?', [userId]);
        return rows[0];
    }

    async getOrCreateUser(ctx) {
        const user = await this.getUser(ctx.from.id);
        if (user) return user;

        await this.run(
            `INSERT INTO users (user_id, username, first_name, last_name) 
             VALUES (?, ?, ?, ?)`,
            [
                ctx.from.id,
                ctx.from.username || '',
                ctx.from.first_name || '',
                ctx.from.last_name || ''
            ]
        );

        // Ajouter l'admin
        if (ctx.from.id === CONFIG.ADMIN_ID) {
            await this.run('UPDATE users SET is_admin = 1 WHERE user_id = ?', [CONFIG.ADMIN_ID]);
        }

        return this.getUser(ctx.from.id);
    }

    async deleteVerse(verseId) {
        // Supprimer les flashcards associées
        await this.run('DELETE FROM flashcards WHERE verse_id = ?', [verseId]);
        // Supprimer le verset
        await this.run('DELETE FROM verses WHERE id = ?', [verseId]);
    }

    async deleteFlashcard(flashcardId) {
        const flashcard = await this.getFlashcardById(flashcardId);
        if (flashcard) {
            // Supprimer les fichiers image
            if (flashcard.image_path) fs.unlinkSync(flashcard.image_path);
            if (flashcard.thumbnail_path) fs.unlinkSync(flashcard.thumbnail_path);
        }
        await this.run('DELETE FROM flashcards WHERE id = ?', [flashcardId]);
    }

    async insertBlindTest(verseId, audioPath, title, alternatives, userId) {
        return this.run(
            `INSERT INTO blind_tests 
            (verse_id, audio_path, title, alternatives, created_by) 
            VALUES (?, ?, ?, ?, ?)`,
            [verseId, audioPath, title, alternatives, userId]
        );
    }

    async getBlindTestsByVerse(verseId) {
        return this.query('SELECT * FROM blind_tests WHERE verse_id = ?', [verseId]);
    }

    async getRandomBlindTest(verseId) {
        const tests = await this.query(
            'SELECT * FROM blind_tests WHERE verse_id = ? ORDER BY RANDOM() LIMIT 1',
            [verseId]
        );
        return tests[0];
    }

    async getBlindTestById(id) {
        const rows = await this.query('SELECT * FROM blind_tests WHERE id = ?', [id]);
        return rows[0];
    }

    async deleteBlindTest(blindTestId) {
        const blindTest = await this.getBlindTestById(blindTestId);
        if (blindTest) {
            // Supprimer le fichier audio
            if (blindTest.audio_path && fs.existsSync(blindTest.audio_path)) {
                fs.unlinkSync(blindTest.audio_path);
            }
        }
        await this.run('DELETE FROM blind_tests WHERE id = ?', [blindTestId]);
    }

    // Nouvelles méthodes pour les quiz questions
    async insertQuizQuestion(verseId, question, answer, alternatives, explanation, userId) {
        return this.run(
            `INSERT INTO quiz_questions 
            (verse_id, question, answer, alternatives, explanation, created_by) 
            VALUES (?, ?, ?, ?, ?, ?)`,
            [verseId, question, answer, alternatives, explanation, userId]
        );
    }

    async updateQuizQuestion(questionId, newAlternatives, newExplanation) {
        return this.run(
            `UPDATE quiz_questions 
             SET alternatives = ?, explanation = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [newAlternatives, newExplanation, questionId]
        );
    }

    async deleteQuizQuestion(questionId) {
        return this.run('DELETE FROM quiz_questions WHERE id = ?', [questionId]);
    }

    async getQuizQuestionsByVerse(verseId) {
        return this.query('SELECT * FROM quiz_questions WHERE verse_id = ?', [verseId]);
    }

    async getQuizQuestionById(questionId) {
        const questions = await this.query('SELECT * FROM quiz_questions WHERE id = ?', [questionId]);
        return questions[0];
    }

    // Nouvelles méthodes SRS
    async getDueReviews(userId) {
        return this.query(
            `SELECT * FROM srs_reviews 
             WHERE user_id = ? AND next_review <= CURRENT_TIMESTAMP
             ORDER BY next_review ASC
             LIMIT ?`,
            [userId, CONFIG.SRS_MAX_ITEMS]
        );
    }

    async getSrsStats(userId) {
        return this.query(
            `SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN next_review <= CURRENT_TIMESTAMP THEN 1 ELSE 0 END) AS due
             FROM srs_reviews
             WHERE user_id = ?`,
            [userId]
        );
    }

    async addItemToSrs(userId, itemId, itemType, verseId) {
        return this.run(
            `INSERT INTO srs_reviews 
             (user_id, item_id, item_type, verse_id) 
             VALUES (?, ?, ?, ?)`,
            [userId, itemId, itemType, verseId]
        );
    }

    async updateReview(reviewId, quality) {
        const review = await this.query('SELECT * FROM srs_reviews WHERE id = ?', [reviewId]);
        if (!review[0]) return;

        const { interval, repetitions, ease_factor } = review[0];
        let newInterval = 0;
        let newRepetitions = repetitions;
        let newEase = ease_factor;

        // Algorithme SM-2 simplifié
        if (quality < 3) {
            newRepetitions = 0;
            newInterval = 1;
        } else {
            newRepetitions++;
            if (newRepetitions === 1) {
                newInterval = 1;
            } else if (newRepetitions === 2) {
                newInterval = 6;
            } else {
                newInterval = Math.round(interval * newEase);
            }
            newEase = Math.max(1.3, newEase + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
        }

        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + newInterval);

        await this.run(
            `UPDATE srs_reviews SET
                interval = ?,
                repetitions = ?,
                ease_factor = ?,
                next_review = ?,
                last_reviewed = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [newInterval, newRepetitions, newEase, nextReview.toISOString(), reviewId]
        );
    }

    async getRandomSrsItems(userId, limit = 5) {
        return this.query(
            `SELECT * FROM (
                SELECT * FROM srs_reviews
                WHERE user_id = ?
                ORDER BY RANDOM()
                LIMIT ?
            ) ORDER BY next_review ASC`,
            [userId, limit]
        );
    }
}

// =============================================
// FONCTIONS UTILITAIRES YOUTUBE
// =============================================
const unlinkAsync = promisify(fs.unlink);
const existsAsync = promisify(fs.exists);

async function searchYouTube(query) {
    try {
        // Méthode de recherche alternative plus robuste
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        
        // Utiliser ytdl pour obtenir des informations sur des URLs directes si possible
        const videoRegex = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = query.match(videoRegex);
        
        if (match) {
            // Si c'est déjà une URL YouTube valide, retourner directement
            const videoId = match[1];
            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            try {
                const info = await ytdl.getInfo(videoUrl, { agent: ytdlAgent });
                return [{
                    title: info.videoDetails.title,
                    url: videoUrl,
                    duration: formatDuration(info.videoDetails.lengthSeconds),
                    views: parseInt(info.videoDetails.viewCount || 0),
                    author: { name: info.videoDetails.ownerChannelName },
                    bestThumbnail: { url: info.videoDetails.thumbnails?.[0]?.url || '' }
                }];
            } catch (err) {
                console.error('Erreur getInfo direct:', err.message);
                throw new Error('Vidéo indisponible ou restreinte');
            }
        }
        
        // Pour les recherches textuelles, créer des URLs de test communes
        const commonVideoIds = await searchByKeywords(query);
        return commonVideoIds;
        
    } catch (error) {
        console.error('Erreur recherche YouTube:', error.message);
        throw new Error('Recherche YouTube temporairement indisponible. Utilisez une URL directe.');
    }
}

async function searchByKeywords(query) {
    // Fonction de fallback qui suggère d'utiliser une URL directe
    throw new Error(`Recherche par mots-clés temporairement indisponible. Veuillez utiliser une URL YouTube directe.`);
}

async function downloadYouTube(url, format, quality, title) {
    const safeTitle = title.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_').substring(0, 30);
    const tempPath = path.join(CONFIG.TEMP_DIR, `${Date.now()}_${safeTitle}`);
    let filePath = '';

    // Options ultra-robustes pour Render
    const ytdlOptions = {
        agent: ytdlAgent,
        requestOptions: {
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin'
            }
        },
        highWaterMark: 512 * 1024, // 512KB chunks pour Render
        retries: 3
    };

    if (format === 'audio') {
        filePath = `${tempPath}.mp3`;
        
        // Méthode ultra-robuste avec retry pour Render
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            try {
                attempts++;
                console.log(`Tentative de téléchargement audio ${attempts}/${maxAttempts}`);
                
                const info = await Promise.race([
                    ytdl.getInfo(url, ytdlOptions),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout getInfo')), 30000)
                    )
                ]);
                
                // Filtrer et sélectionner le format audio optimal
                let audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
                
                if (audioFormats.length === 0) {
                    // Fallback: chercher des formats avec audio
                    audioFormats = ytdl.filterFormats(info.formats, 'audioandvideo');
                    if (audioFormats.length === 0) {
                        throw new Error('Aucun format audio disponible');
                    }
                }

                // Sélectionner un format plus compatible pour Render
                const bestAudio = audioFormats.find(f => 
                    f.container === 'mp4' || f.container === 'webm'
                ) || audioFormats.sort((a, b) => {
                    const aBitrate = parseInt(a.audioBitrate) || 0;
                    const bBitrate = parseInt(b.audioBitrate) || 0;
                    return bBitrate - aBitrate;
                })[0];

                console.log(`Format sélectionné: ${bestAudio.container}, bitrate: ${bestAudio.audioBitrate}`);

                const audioStream = ytdl.downloadFromInfo(info, {
                    format: bestAudio,
                    ...ytdlOptions
                });

                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Timeout de conversion audio'));
                    }, 90000); // 1.5 minute timeout pour Render

                    let progressReported = false;

                    ffmpeg(audioStream)
                        .audioBitrate('96k') // Bitrate encore plus réduit pour Render
                        .audioCodec('libmp3lame')
                        .audioChannels(2)
                        .audioFrequency(22050) // Fréquence réduite pour plus de compatibilité
                        .on('start', () => {
                            console.log(`Début conversion audio (tentative ${attempts})`);
                        })
                        .on('progress', p => {
                            if (!progressReported || (p.percent && p.percent > 10)) {
                                console.log(`Audio progress: ${Math.round(p.percent || 0)}%`);
                                progressReported = true;
                            }
                        })
                        .on('end', () => {
                            clearTimeout(timeout);
                            console.log('Conversion audio terminée avec succès');
                            resolve();
                        })
                        .on('error', (err) => {
                            clearTimeout(timeout);
                            console.error(`Erreur FFmpeg (tentative ${attempts}):`, err.message);
                            reject(err);
                        })
                        .save(filePath);
                });
                
                // Si on arrive ici, c'est un succès
                break;
                
            } catch (error) {
                console.error(`Erreur tentative ${attempts}:`, error.message);
                
                if (attempts >= maxAttempts) {
                    throw new Error(`Échec après ${maxAttempts} tentatives: ${error.message}`);
                }
                
                // Attendre avant de réessayer
                await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
            }
        }
    } else {
        filePath = `${tempPath}.mp4`;
        
        let attempts = 0;
        const maxAttempts = 3;
        
        while (attempts < maxAttempts) {
            try {
                attempts++;
                console.log(`Tentative de téléchargement vidéo ${attempts}/${maxAttempts}`);
                
                const info = await Promise.race([
                    ytdl.getInfo(url, ytdlOptions),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Timeout getInfo')), 30000)
                    )
                ]);
                
                let videoFormats = ytdl.filterFormats(info.formats, 'videoandaudio');
                
                if (videoFormats.length === 0) {
                    // Fallback: formats vidéo uniquement
                    videoFormats = ytdl.filterFormats(info.formats, 'videoonly');
                    if (videoFormats.length === 0) {
                        throw new Error('Aucun format vidéo disponible');
                    }
                }

                // Filtrer par qualité et taille pour Render
                const targetHeight = quality === 'high' || quality === '720' ? 480 : 240; // Réduit pour Render
                const maxFileSize = 25 * 1024 * 1024; // 25MB max pour Render
                
                const suitableFormats = videoFormats.filter(f => {
                    const height = parseInt(f.height) || 0;
                    const filesize = parseInt(f.filesize) || 0;
                    return height <= targetHeight && (filesize === 0 || filesize < maxFileSize);
                }).sort((a, b) => {
                    const aHeight = parseInt(a.height) || 0;
                    const bHeight = parseInt(b.height) || 0;
                    return bHeight - aHeight; // Préférer la meilleure qualité disponible
                });

                const bestVideo = suitableFormats[0] || videoFormats.sort((a, b) => {
                    const aHeight = parseInt(a.height) || 0;
                    const bHeight = parseInt(b.height) || 0;
                    return aHeight - bHeight; // Plus petite qualité si nécessaire
                })[0];

                if (!bestVideo) {
                    throw new Error('Aucun format vidéo compatible trouvé');
                }

                console.log(`Format vidéo sélectionné: ${bestVideo.height}p, container: ${bestVideo.container}`);

                const videoStream = ytdl.downloadFromInfo(info, {
                    format: bestVideo,
                    ...ytdlOptions
                });

                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Timeout de téléchargement vidéo'));
                    }, 120000); // 2 minutes timeout pour Render

                    const fileStream = fs.createWriteStream(filePath);
                    let downloadedBytes = 0;
                    let lastProgressTime = Date.now();

                    videoStream.on('data', (chunk) => {
                        downloadedBytes += chunk.length;
                        const now = Date.now();
                        
                        // Afficher le progrès toutes les 3 secondes
                        if (now - lastProgressTime > 3000) {
                            const sizeMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
                            console.log(`Video progress: ${sizeMB}MB téléchargés`);
                            lastProgressTime = now;
                        }
                    });

                    videoStream.on('end', () => {
                        clearTimeout(timeout);
                        fileStream.end();
                        console.log('Téléchargement vidéo terminé');
                    });

                    videoStream.on('error', (err) => {
                        clearTimeout(timeout);
                        fileStream.destroy();
                        console.error(`Erreur stream vidéo (tentative ${attempts}):`, err.message);
                        reject(err);
                    });

                    fileStream.on('finish', () => {
                        resolve();
                    });
                    
                    fileStream.on('error', (err) => {
                        clearTimeout(timeout);
                        console.error(`Erreur écriture fichier (tentative ${attempts}):`, err.message);
                        reject(err);
                    });

                    videoStream.pipe(fileStream);
                });
                
                // Si on arrive ici, c'est un succès
                break;
                
            } catch (error) {
                console.error(`Erreur tentative vidéo ${attempts}:`, error.message);
                
                // Nettoyer le fichier partiel si il existe
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (e) {
                        console.error('Erreur nettoyage fichier:', e.message);
                    }
                }
                
                if (attempts >= maxAttempts) {
                    throw new Error(`Échec après ${maxAttempts} tentatives: ${error.message}`);
                }
                
                // Attendre avant de réessayer
                await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
            }
        }
    }

    // Vérifier que le fichier existe et n'est pas vide
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
        throw new Error('Fichier téléchargé vide ou inexistant');
    }

    return filePath;
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function formatFileSize(bytes) {
    const mb = bytes / (1024 * 1024);
    return mb.toFixed(2) + 'MB';
}

async function getUserDownloadCount(userId, isAdmin = false) {
    const today = new Date().toISOString().split('T')[0];
    const currentHour = new Date().getHours();
    
    // Vérifier les téléchargements de cette heure
    const hourlyResult = await db.query(
        `SELECT COUNT(*) AS count FROM user_downloads 
         WHERE user_id = ? AND date = ? AND hour = ?`,
        [userId, today, currentHour]
    );
    
    const hourlyCount = hourlyResult[0].count || 0;
    
    // Vérifier les téléchargements du jour (seulement pour les utilisateurs lambda)
    let dailyCount = 0;
    if (!isAdmin) {
        const dailyResult = await db.query(
            `SELECT COUNT(*) AS count FROM user_downloads 
             WHERE user_id = ? AND date = ?`,
            [userId, today]
        );
        dailyCount = dailyResult[0].count || 0;
    }
    
    return { hourlyCount, dailyCount };
}

async function recordUserDownload(userId) {
    const today = new Date().toISOString().split('T')[0];
    const currentHour = new Date().getHours();
    await db.run(
        `INSERT INTO user_downloads (user_id, date, hour) VALUES (?, ?, ?)`,
        [userId, today, currentHour]
    );
}

const db = new SRSDatabaseExtension();

// =============================================
// UTILITAIRES
// =============================================
class Utils {
    static async downloadFile(url, filePath) {
        const response = await fetch(url);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(filePath, Buffer.from(buffer));
        return filePath;
    }

    static async processImage(inputPath, outputPath, size = 800) {
        await sharp(inputPath)
            .resize(size, size, { fit: 'inside', withoutEnlargement: true })
            .toFile(outputPath);
        return outputPath;
    }

    static generateKeyboard(items, columns = 2) {
        const keyboard = [];
        for (let i = 0; i < items.length; i += columns) {
            keyboard.push(items.slice(i, i + columns).map(item => ({ text: item })));
        }
        return keyboard;
    }

    static escapeMarkdown(text) {
        if (!text) return '';
        return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
    }

    static escapeMarkdownV2(text) {
        if (!text) return '';
        // Échapper tous les caractères spéciaux MarkdownV2
        return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
    }

    static escapeHtml(text) {
        if (!text) return '';
        return escape(text);
    }

    static formatUsername(user) {
        if (user.username) return `@${user.username}`;
        return `${user.first_name}${user.last_name ? ` ${user.last_name}` : ''}`;
    }

    static formatScores(scores, userMap) {
        const sorted = Object.entries(scores)
            .sort((a, b) => b[1] - a[1])
            .map(([userId, score], index) => {
                const user = userMap[userId];
                const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
                return `${medal} ${Utils.formatUsername(user)}: ${score} points`;
            });

        return sorted.join('\n');
    }

    static shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
}

// =============================================
// SCÈNES ET WORKFLOWS
// =============================================
class SceneCreator {
    static createVerseScene() {
        const scene = new Scenes.BaseScene('createVerse');

        scene.enter(ctx => {
            ctx.reply('📝 Entrez le nom du nouveau verset :', 
                Markup.keyboard([['🚫 Annuler']]).resize()
            );
        });

        scene.hears('🚫 Annuler', ctx => {
            ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            const verseName = ctx.message.text;
            try {
                const user = await db.getOrCreateUser(ctx);
                await db.run(
                    'INSERT INTO verses (name, created_by) VALUES (?, ?)', 
                    [verseName, user.user_id]
                );
                await ctx.reply(`✅ Verset *${Utils.escapeMarkdownV2(verseName)}* créé avec succès \\!`, 
                    { parse_mode: 'MarkdownV2' }
                );
                return ctx.scene.leave();
            } catch (err) {
                await ctx.reply(`❌ Erreur : ${err.message}`);
            }
        });

        return scene;
    }

    static deleteVerseScene() {
        const scene = new Scenes.BaseScene('deleteVerse');

        scene.enter(async ctx => {
            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible.');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('❌ Choisissez un verset à supprimer :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', ctx => {
            ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            const verseName = ctx.message.text;
            const verse = await db.getVerseByName(verseName);

            if (!verse) {
                await ctx.reply('❌ Verset introuvable.');
                return;
            }

            const user = await db.getOrCreateUser(ctx);
            if (verse.created_by !== user.user_id && !user.is_admin) {
                await ctx.reply('⛔️ Vous n\'êtes pas autorisé à supprimer ce verset.');
                return ctx.scene.leave();
            }

            try {
                await db.deleteVerse(verse.id);
                await ctx.reply(`✅ Verset *${Utils.escapeMarkdownV2(verseName)}* supprimé avec succès \\!`, 
                    { parse_mode: 'MarkdownV2' }
                );
            } catch (err) {
                await ctx.reply(`❌ Erreur lors de la suppression : ${err.message}`);
            }

            return ctx.scene.leave();
        });

        return scene;
    }

    static addFlashcardScene() {
        const scene = new Scenes.BaseScene('addFlashcard');

        scene.enter(async ctx => {
            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible. Créez d\'abord un verset avec /setverse');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('📚 Choisissez un verset pour la flashcard :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', ctx => {
            ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            // Si on n'a pas encore choisi de verset
            if (!ctx.session.verseId) {
                const verseName = ctx.message.text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable\\. Veuillez réessayer :', 
                        { parse_mode: 'MarkdownV2' });
                    return;
                }

                ctx.session.verseId = verse.id;
                await ctx.reply('🖼 Envoyez l\'image du personnage :', {
                    reply_markup: Markup.removeKeyboard()
                });
                return;
            }

            // Si on a le verset et l'image, on traite le nom du personnage
            if (ctx.session.verseId && ctx.session.imagePath) {
                if (!ctx.session.characterName) {
                    ctx.session.characterName = ctx.message.text;
                    await ctx.reply('🔤 Entrez les noms alternatifs \\(séparés par des virgules\\) :', 
                        { parse_mode: 'MarkdownV2' });
                    return;
                }

                // Traitement des alternatives et sauvegarde
                const alternatives = ctx.message.text.split(',').map(a => a.trim());
                try {
                    const user = await db.getOrCreateUser(ctx);
                    await db.run(
                        `INSERT INTO flashcards (
                            verse_id, question, answer, image_path, thumbnail_path, alternatives, created_by
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [
                            ctx.session.verseId,
                            'Qui est ce personnage ?',
                            ctx.session.characterName,
                            ctx.session.imagePath,
                            ctx.session.thumbPath,
                            alternatives.join(','),
                            user.user_id
                        ]
                    );

                    await ctx.replyWithPhoto(
                        { source: ctx.session.thumbPath },
                        {
                            caption: `✅ Flashcard ajoutée \\!\n\nPersonnage : *${Utils.escapeMarkdown(ctx.session.characterName)}*`,
                            parse_mode: 'MarkdownV2'
                        }
                    );

                    // Réinitialisation session
                    ['verseId', 'imagePath', 'thumbPath', 'characterName'].forEach(k => delete ctx.session[k]);
                    return ctx.scene.leave();
                } catch (err) {
                    await ctx.reply(`❌ Erreur lors de l'enregistrement : ${err.message}`);
                }
            }
        });

        scene.on('photo', async ctx => {
            if (!ctx.session.verseId) return;

            const photo = ctx.message.photo.pop();
            const fileId = photo.file_id;
            const file = await ctx.telegram.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${CONFIG.TOKEN}/${file.file_path}`;

            const imageId = uuidv4();
            const imagePath = path.join(CONFIG.IMAGE_DIR, `${imageId}.jpg`);
            const thumbPath = path.join(CONFIG.THUMBNAIL_DIR, `${imageId}.jpg`);

            await Utils.downloadFile(fileUrl, imagePath);
            await Utils.processImage(imagePath, thumbPath, 400);

            ctx.session.imagePath = imagePath;
            ctx.session.thumbPath = thumbPath;
            await ctx.reply('👤 Entrez le nom complet du personnage :');
        });

        return scene;
    }

    static flashcardSessionScene() {
        const scene = new Scenes.BaseScene('flashcardSession');

        scene.enter(async ctx => {
            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible. Créez d\'abord un verset avec /setverse');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('🎮 Choisissez un verset pour la session :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', async ctx => {
            // Clear any timers
            if (ctx.session.timer) {
                clearTimeout(ctx.session.timer);
                delete ctx.session.timer;
            }

            // Reset session
            ctx.session = {};

            await ctx.reply('❌ Opération annulée', { 
                reply_markup: { remove_keyboard: true } 
            });

            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            if (!ctx.session.flashcards) {
                const verseName = ctx.message.text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                    return;
                }

                const flashcards = await db.getFlashcardsByVerse(verse.id);
                if (flashcards.length === 0) {
                    await ctx.reply('ℹ️ Aucune flashcard dans ce verset');
                    return ctx.scene.leave();
                }

                // Mélanger les flashcards et sauvegarder la session
                ctx.session.flashcards = Utils.shuffleArray(flashcards);
                ctx.session.currentIndex = 0;
                ctx.session.score = 0;
                ctx.session.verseId = verse.id;
                ctx.session.startTime = Date.now();

                await this.sendNextFlashcard(ctx);
            } else if (ctx.session.flashcards && ctx.session.flashcards[ctx.session.currentIndex]) {
                const flashcard = ctx.session.flashcards[ctx.session.currentIndex];
                const userAnswer = ctx.message.text.trim();
                const alternatives = flashcard.alternatives ? flashcard.alternatives.split(',') : [];

                const isCorrect = userAnswer === flashcard.answer || 
                                 alternatives.includes(userAnswer);

                // Mise à jour de la flashcard
                await db.run(
                    `UPDATE flashcards SET 
                        last_reviewed = CURRENT_TIMESTAMP,
                        success_rate = ?
                    WHERE id = ?`,
                    [isCorrect ? 1 : 0, flashcard.id]
                );

                if (isCorrect) {
                    ctx.session.score++;
                    await ctx.reply('✅ *Correct \\!*', { parse_mode: 'MarkdownV2' });
                } else {
                    await ctx.reply(
                        `❌ *Incorrect \\!*\nLa réponse était : ${Utils.escapeMarkdown(flashcard.answer)}`,
                        { parse_mode: 'MarkdownV2' }
                    );
                }

                ctx.session.currentIndex++;
                if (ctx.session.currentIndex >= ctx.session.flashcards.length) {
                    return this.endSession(ctx);
                }

                await this.sendNextFlashcard(ctx);
            }
        });

        scene.action('show_answer', async ctx => {
            try {
                if (!ctx.session.flashcards) return;

                const flashcard = ctx.session.flashcards[ctx.session.currentIndex];
                await ctx.editMessageCaption(
                    `⏱ *Temps écoulé \\!*\n\nRéponse : ${Utils.escapeMarkdown(flashcard.answer)}`,
                    { 
                        parse_mode: 'MarkdownV2',
                        reply_markup: { inline_keyboard: [[
                            { text: '➡️ Suivant', callback_data: 'next_card' }
                        ]]}
                    }
                );
                await ctx.answerCbQuery();
            } catch (error) {
                console.error('Erreur show_answer:', error.message);
                if (!error.message.includes('query is too old') && !error.message.includes('query ID is invalid')) {
                    throw error;
                }
            }
        });

        scene.action('next_card', async ctx => {
            try {
                ctx.session.currentIndex++;
                if (ctx.session.currentIndex >= ctx.session.flashcards.length) {
                    return this.endSession(ctx);
                }
                await this.sendNextFlashcard(ctx);
                await ctx.answerCbQuery();
            } catch (error) {
                console.error('Erreur next_card:', error.message);
                if (!error.message.includes('query is too old') && !error.message.includes('query ID is invalid')) {
                    throw error;
                }
            }
        });

        return scene;
    }

    static async sendNextFlashcard(ctx) {
        const flashcard = ctx.session.flashcards[ctx.session.currentIndex];

        await ctx.replyWithPhoto(
            { source: flashcard.thumbnail_path },
            {
                caption: `❓ *${Utils.escapeMarkdown(flashcard.question)}*\n\n⏱ Vous avez 10 secondes \\!`,
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '⏱ Afficher la réponse', callback_data: 'show_answer' }
                    ]]
                }
            }
        );

        // Timer de 10 secondes
        if (ctx.session.timer) {
            clearTimeout(ctx.session.timer);
        }

        ctx.session.timer = setTimeout(async () => {
            try {
                await ctx.editMessageCaption(
                    `⏱ *Temps écoulé \\!*\n\nRéponse : ${Utils.escapeMarkdown(flashcard.answer)}`,
                    { 
                        parse_mode: 'MarkdownV2',
                        reply_markup: { inline_keyboard: [[
                            { text: '➡️ Suivant', callback_data: 'next_card' }
                        ]]}
                    }
                );
            } catch (err) {
                // Ignore les erreurs d'édition de message (message déjà modifié ou supprimé)
                if (!err.message.includes("message can't be edited")) {
                    console.error('Erreur timer:', err.message);
                }
            }
        }, CONFIG.FLASHCARD_TIMEOUT);
    }

    static async endSession(ctx) {
        const duration = Math.round((Date.now() - ctx.session.startTime) / 1000);
        const total = ctx.session.flashcards.length;
        const score = ctx.session.score;
        const percentage = Math.round((score / total) * 100);

        await ctx.reply(
            `🏁 *Session terminée \\!*\n\n` +
            `📊 Score final : *${score}/${total}* \\(${percentage}%\\)\n` +
            `⏱ Temps total : *${duration} secondes*\n\n` +
            `🔁 Pour recommencer : /playflashcards`,
            { parse_mode: 'MarkdownV2' }
        );

        // Sauvegarde progression utilisateur
        await db.run(
            `INSERT OR REPLACE INTO user_sessions 
                (user_id, current_verse_id, flashcard_index) 
            VALUES (?, ?, ?)`,
            [ctx.from.id, ctx.session.verseId, ctx.session.currentIndex]
        );

        // Nettoyage session
        if (ctx.session.timer) clearTimeout(ctx.session.timer);
        ctx.session = {};
        ctx.scene.leave();
    }

    static groupFlashcardSessionScene() {
        const scene = new Scenes.BaseScene('groupFlashcardSession');

        scene.enter(async ctx => {
            if (ctx.chat.type === 'private') {
                await ctx.reply('ℹ️ Cette commande est réservée aux groupes !');
                return ctx.scene.leave();
            }

            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible. Créez d\'abord un verset avec /setverse');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('🎮 Choisissez un verset pour le quiz de groupe :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', async ctx => {
            // Reset session
            ['scores', 'flashcards', 'currentIndex', 'verseId', 'lastActive'].forEach(k => delete ctx.session[k]);

            await ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            // Première étape : sélection du verset
            if (!ctx.session.flashcards) {
                const verseName = ctx.message.text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                    return;
                }

                const flashcards = await db.getFlashcardsByVerse(verse.id);
                if (flashcards.length === 0) {
                    await ctx.reply('ℹ️ Aucune flashcard dans ce verset');
                    return ctx.scene.leave();
                }

                // Initialiser la session de groupe avec mélange des flashcards
                ctx.session.scores = {};
                ctx.session.flashcards = Utils.shuffleArray(flashcards);
                ctx.session.currentIndex = 0;
                ctx.session.verseId = verse.id;
                ctx.session.lastActive = Date.now();

                await ctx.reply(
                    `🎉 *Quiz de groupe lancé \\!*\n\n` +
                    `Thème : *${Utils.escapeMarkdown(verse.name)}*\n` +
                    `Nombre de questions : *${flashcards.length}*\n\n` +
                    `Le premier à répondre correctement marque des points \\!`,
                    { parse_mode: 'MarkdownV2' }
                );

                await this.sendNextGroupFlashcard(ctx);
                return;
            }

            // Deuxième étape : réponses aux questions
            if (ctx.session.flashcards && ctx.session.flashcards[ctx.session.currentIndex]) {
                // Vérifier l'inactivité
                if (Date.now() - ctx.session.lastActive > CONFIG.GROUP_SESSION_TIMEOUT) {
                    await this.endGroupSession(ctx, '⌛️ Session terminée pour cause d\'inactivité');
                    return;
                }

                ctx.session.lastActive = Date.now();
                const flashcard = ctx.session.flashcards[ctx.session.currentIndex];
                const userAnswer = ctx.message.text.trim();
                const alternatives = flashcard.alternatives ? flashcard.alternatives.split(',') : [];

                const isCorrect = userAnswer === flashcard.answer || 
                                 alternatives.includes(userAnswer);

                if (isCorrect) {
                    // Enregistrer le score
                    const userId = ctx.from.id;
                    ctx.session.scores[userId] = (ctx.session.scores[userId] || 0) + 1;

                    // Enregistrer l'utilisateur
                    await db.getOrCreateUser(ctx);

                    await ctx.replyWithPhoto(
                        { source: flashcard.thumbnail_path },
                        {
                            caption: `🎉 *${Utils.escapeMarkdown(Utils.formatUsername(ctx.from))} a la bonne réponse \\!*\n\n` +
                                     `Réponse : *${Utils.escapeMarkdown(flashcard.answer)}*`,
                            parse_mode: 'MarkdownV2'
                        }
                    );

                    ctx.session.currentIndex++;
                    if (ctx.session.currentIndex >= ctx.session.flashcards.length) {
                        return this.endGroupSession(ctx);
                    }

                    await this.sendNextGroupFlashcard(ctx);
                }
            }
        });

        scene.command('endsession', async ctx => {
            await this.endGroupSession(ctx, '🏁 Session terminée par l\'administrateur');
        });

        return scene;
    }

    static addBlindTestScene() {
        const scene = new Scenes.BaseScene('addBlindTest');

        scene.enter(async ctx => {
            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible. Créez d\'abord un verset avec /setverse');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('🎵 Choisissez un verset pour le blind test :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', ctx => {
            ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            if (!ctx.session.verseId) {
                const verseName = ctx.message.text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                    return;
                }

                ctx.session.verseId = verse.id;
                await ctx.reply('🎧 Envoyez maintenant l\'audio du blind test :', {
                    reply_markup: Markup.removeKeyboard()
                });
                return;
            }

            if (ctx.session.audioPath && !ctx.session.audioTitle) {
                ctx.session.audioTitle = ctx.message.text;
                await ctx.reply('🔤 Entrez les titres alternatifs \\(séparés par des virgules\\) :', 
                    { parse_mode: 'MarkdownV2' });
                return;
            }

            if (ctx.session.audioPath && ctx.session.audioTitle) {
                const alternatives = ctx.message.text.split(',').map(a => a.trim());
                try {
                    const user = await db.getOrCreateUser(ctx);
                    await db.insertBlindTest(
                        ctx.session.verseId,
                        ctx.session.audioPath,
                        ctx.session.audioTitle,
                        alternatives.join(','),
                        user.user_id
                    );

                    await ctx.reply(
                        `✅ Blind test ajouté \\!\n\nTitre : *${Utils.escapeMarkdown(ctx.session.audioTitle)}*`,
                        { parse_mode: 'MarkdownV2' }
                    );

                    // Réinitialisation session
                    ['verseId', 'audioPath', 'audioTitle'].forEach(k => delete ctx.session[k]);
                    return ctx.scene.leave();
                } catch (err) {
                    await ctx.reply(`❌ Erreur lors de l'enregistrement : ${err.message}`);
                }
            }
        });

        scene.on('audio', async ctx => {
            if (!ctx.session.verseId) return;

            const audio = ctx.message.audio;
            const fileId = audio.file_id;
            const file = await ctx.telegram.getFile(fileId);
            const fileUrl = `https://api.telegram.org/file/bot${CONFIG.TOKEN}/${file.file_path}`;

            const audioId = uuidv4();
            const ext = path.extname(file.file_path) || '.mp3';
            const audioPath = path.join(CONFIG.IMAGE_DIR, `${audioId}${ext}`);

            await Utils.downloadFile(fileUrl, audioPath);

            ctx.session.audioPath = audioPath;
            await ctx.reply('📝 Entrez le titre principal de cet audio :');
        });

        return scene;
    }

    static playBlindTestScene() {
        const scene = new Scenes.BaseScene('playBlindTest');

        scene.enter(async ctx => {
            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible. Créez d\'abord un verset avec /setverse');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('🎧 Choisissez un verset pour le blind test :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', async ctx => {
            if (ctx.session.timer) {
                clearTimeout(ctx.session.timer);
                delete ctx.session.timer;
            }
            ctx.session = {};
            await ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            if (!ctx.session.blindTests) {
                const verseName = ctx.message.text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                    return;
                }

                const blindTests = await db.getBlindTestsByVerse(verse.id);
                if (blindTests.length === 0) {
                    await ctx.reply('ℹ️ Aucun blind test dans ce verset');
                    return ctx.scene.leave();
                }

                ctx.session.blindTests = Utils.shuffleArray(blindTests);
                ctx.session.currentTest = 0;
                ctx.session.score = 0;
                ctx.session.verseId = verse.id;
                ctx.session.startTime = Date.now();

                await this.sendNextBlindTest(ctx);
                return;
            }

            if (ctx.session.blindTests && ctx.session.blindTests[ctx.session.currentTest]) {
                const blindTest = ctx.session.blindTests[ctx.session.currentTest];
                const userAnswer = ctx.message.text.trim();
                const alternatives = blindTest.alternatives ? blindTest.alternatives.split(',') : [];

                const isCorrect = userAnswer === blindTest.title || 
                                 alternatives.includes(userAnswer);

                if (isCorrect) {
                    ctx.session.score++;
                    await ctx.reply('✅ *Correct \\!*', { parse_mode: 'MarkdownV2' });
                } else {
                    await ctx.reply(
                        `❌ *Incorrect \\!*\nLa réponse était : ${Utils.escapeMarkdown(blindTest.title)}`,
                        { parse_mode: 'MarkdownV2' }
                    );
                }

                ctx.session.currentTest++;
                if (ctx.session.currentTest >= ctx.session.blindTests.length) {
                    return this.endBlindTestSession(ctx);
                }

                await this.sendNextBlindTest(ctx);
            }
        });

        return scene;
    }

    static groupBlindTestScene() {
        const scene = new Scenes.BaseScene('groupBlindTest');

        scene.enter(async ctx => {
            if (ctx.chat.type === 'private') {
                await ctx.reply('ℹ️ Cette commande est réservée aux groupes !');
                return ctx.scene.leave();
            }

            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible. Créez d\'abord un verset avec /setverse');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('🎧 Choisissez un verset pour le blind test de groupe :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', async ctx => {
            ['scores', 'blindTests', 'currentTest', 'verseId', 'lastActive'].forEach(k => delete ctx.session[k]);
            await ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            if (!ctx.session.blindTests) {
                const verseName = ctx.message.text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                    return;
                }

                const blindTests = await db.getBlindTestsByVerse(verse.id);
                if (blindTests.length === 0) {
                    await ctx.reply('ℹ️ Aucun blind test dans ce verset');
                    return ctx.scene.leave();
                }

                // Initialiser la session de groupe
                ctx.session.scores = {};
                ctx.session.blindTests = Utils.shuffleArray(blindTests);
                ctx.session.currentTest = 0;
                ctx.session.verseId = verse.id;
                ctx.session.lastActive = Date.now();

                await ctx.reply(
                    `🎉 *Blind test de groupe lancé \\!*\n\n` +
                    `Thème : *${Utils.escapeMarkdown(verse.name)}*\n` +
                    `Nombre de pistes : *${blindTests.length}*\n\n` +
                    `Le premier à trouver le titre marque des points \\!`,
                    { parse_mode: 'MarkdownV2' }
                );

                await this.sendNextGroupBlindTest(ctx);
                return;
            }

            if (ctx.session.blindTests && ctx.session.blindTests[ctx.session.currentTest]) {
                // Vérifier l'inactivité
                if (Date.now() - ctx.session.lastActive > CONFIG.GROUP_SESSION_TIMEOUT) {
                    await this.endGroupBlindTestSession(ctx, '⌛️ Session terminée pour cause d\'inactivité');
                    return;
                }

                ctx.session.lastActive = Date.now();
                const blindTest = ctx.session.blindTests[ctx.session.currentTest];
                const userAnswer = ctx.message.text.trim();
                const alternatives = blindTest.alternatives ? blindTest.alternatives.split(',') : [];

                const isCorrect = userAnswer === blindTest.title || 
                                 alternatives.includes(userAnswer);

                if (isCorrect) {
                    // Enregistrer le score
                    const userId = ctx.from.id;
                    ctx.session.scores[userId] = (ctx.session.scores[userId] || 0) + 1;

                    // Enregistrer l'utilisateur
                    await db.getOrCreateUser(ctx);

                    await ctx.reply(
                        `🎉 *${Utils.escapeMarkdown(Utils.formatUsername(ctx.from))} a trouvé \\!*\n\n` +
                        `Titre : *${Utils.escapeMarkdown(blindTest.title)}*`,
                        { parse_mode: 'MarkdownV2' }
                    );

                    ctx.session.currentTest++;
                    if (ctx.session.currentTest >= ctx.session.blindTests.length) {
                        return this.endGroupBlindTestSession(ctx);
                    }

                    await this.sendNextGroupBlindTest(ctx);
                }
            }
        });

        scene.command('endbt', async ctx => {
            await this.endGroupBlindTestSession(ctx, '🏁 Session blind test terminée par l\'administrateur');
        });

        return scene;
    }

    // Nouvelles scènes pour les quiz questions
    static addQuizQuestionScene() {
        const scene = new Scenes.BaseScene('addQuizQuestion');

        scene.enter(async ctx => {
            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible. Créez d\'abord un verset avec /setverse');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('📝 Choisissez un verset pour la question :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', ctx => {
            ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            if (!ctx.session.verseId) {
                const verseName = ctx.message.text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                    return;
                }

                ctx.session.verseId = verse.id;
                await ctx.reply('❓ Entrez la question :', {
                    reply_markup: Markup.removeKeyboard()
                });
                return;
            }

            if (!ctx.session.question) {
                ctx.session.question = ctx.message.text;
                await ctx.reply('✅ Entrez la réponse correcte :');
                return;
            }

            if (!ctx.session.answer) {
                ctx.session.answer = ctx.message.text;
                await ctx.reply('🔤 Entrez les réponses alternatives (séparées par des virgules) :');
                return;
            }

            if (!ctx.session.alternatives) {
                ctx.session.alternatives = ctx.message.text;
                await ctx.reply('📝 Entrez une explication (optionnel) :');
                return;
            }

            if (!ctx.session.explanation) {
                ctx.session.explanation = ctx.message.text;
            }

            try {
                const user = await db.getOrCreateUser(ctx);
                await db.insertQuizQuestion(
                    ctx.session.verseId,
                    ctx.session.question,
                    ctx.session.answer,
                    ctx.session.alternatives,
                    ctx.session.explanation,
                    user.user_id
                );

                await ctx.reply(
                        `✅ Question ajoutée \\!\n\n` +
                        `Question: *${Utils.escapeMarkdown(ctx.session.question)}*\n` +
                        `Réponse: ${Utils.escapeMarkdown(ctx.session.answer)}`,
                        { parse_mode: 'MarkdownV2' }
                    );

                // Réinitialisation session
                ['verseId', 'question', 'answer', 'alternatives', 'explanation'].forEach(k => delete ctx.session[k]);
                return ctx.scene.leave();
            } catch (err) {
                await ctx.reply(`❌ Erreur lors de l'enregistrement : ${err.message}`);
            }
        });

        return scene;
    }

    static editQuizQuestionScene() {
        const scene = new Scenes.BaseScene('editQuizQuestion');

        scene.enter(async ctx => {
            ctx.session.step = 'verse';
            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible.');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('📚 Choisissez le verset contenant la question :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', ctx => {
            ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            if (ctx.session.step === 'verse') {
                const verseName = ctx.message.text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                    return;
                }

                const questions = await db.getQuizQuestionsByVerse(verse.id);
                if (questions.length === 0) {
                    await ctx.reply('ℹ️ Aucune question dans ce verset');
                    return ctx.scene.leave();
                }

                ctx.session.verseId = verse.id;
                ctx.session.questions = questions;
                ctx.session.step = 'question';

                const questionList = questions.map((q, i) => 
                    `${i + 1}. ${q.question.substring(0, 50)}${q.question.length > 50 ? '...' : ''}`
                ).join('\n');

                await ctx.reply(
                    `❓ Choisissez une question à modifier :\n\n${questionList}\n\n` +
                    `Répondez avec le numéro de la question`,
                    { reply_markup: Markup.removeKeyboard() }
                );
            }

            if (ctx.session.step === 'question') {
                const questionNum = parseInt(ctx.message.text);
                if (isNaN(questionNum) || questionNum < 1 || questionNum > ctx.session.questions.length) {
                    await ctx.reply('❌ Numéro invalide. Veuillez réessayer :');
                    return;
                }

                const question = ctx.session.questions[questionNum - 1];
                ctx.session.questionId = question.id;
                ctx.session.step = 'edit';

                await ctx.reply(
                    `✏️ Question sélectionnée :\n\n` +
                    `*${Utils.escapeMarkdown(question.question)}*\n\n` +
                    `Réponse correcte: ${Utils.escapeMarkdown(question.answer)}\n` +
                    `Alternatives: ${Utils.escapeMarkdown(question.alternatives || 'Aucune')}\n` +
                    `Explication: ${Utils.escapeMarkdown(question.explanation || 'Aucune')}\n\n` +
                    `Que souhaitez-vous modifier ?\n` +
                    `1. Alternatives\n` +
                    `2. Explication`,
                    { parse_mode: 'MarkdownV2' }
                );
            }

            if (ctx.session.step === 'edit') {
                const choice = ctx.message.text.trim();

                if (choice === '1') {
                    ctx.session.editType = 'alternatives';
                    await ctx.reply('🔄 Entrez les nouvelles alternatives (séparées par des virgules) :');
                } else if (choice === '2') {
                    ctx.session.editType = 'explanation';
                    await ctx.reply('💡 Entrez la nouvelle explication :');
                } else {
                    await ctx.reply('❌ Choix invalide. Veuillez choisir 1 ou 2 :');
                    return;
                }
            }

            if (ctx.session.editType) {
                const newValue = ctx.message.text;
                try {
                    if (ctx.session.editType === 'alternatives') {
                        await db.updateQuizQuestion(ctx.session.questionId, newValue, null);
                        await ctx.reply('✅ Alternatives mises à jour avec succès \\!');
                    } else {
                        await db.updateQuizQuestion(ctx.session.questionId, null, newValue);
                        await ctx.reply('✅ Explication mise à jour avec succès \\!');
                    }
                    return ctx.scene.leave();
                } catch (err) {
                    await ctx.reply(`❌ Erreur lors de la mise à jour : ${err.message}`);
                }
            }
        });

        return scene;
    }

    static playQuizScene() {
        const scene = new Scenes.BaseScene('playQuiz');

        scene.enter(async ctx => {
            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible. Créez d\'abord un verset avec /setverse');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('🎮 Choisissez un verset pour le quiz :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', ctx => {
            ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            if (!ctx.session.questions) {
                const verseName = ctx.message.text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                    return;
                }

                const questions = await db.getQuizQuestionsByVerse(verse.id);
                if (questions.length === 0) {
                    await ctx.reply('ℹ️ Aucune question dans ce verset');
                    return ctx.scene.leave();
                }

                // Mélanger les questions
                const shuffledQuestions = [...questions].sort(() => Math.random() - 0.5);

                ctx.session.questions = shuffledQuestions;
                ctx.session.currentQuestion = 0;
                ctx.session.score = 0;
                ctx.session.startTime = Date.now();

                await this.sendNextQuestion(ctx);
                return;
            }

            const question = ctx.session.questions[ctx.session.currentQuestion];
            const userAnswer = ctx.message.text.trim();

            const alternatives = question.alternatives ? question.alternatives.split(',') : [];
            const possibleAnswers = [question.answer, ...alternatives].map(a => a.trim().toLowerCase());

            const isCorrect = possibleAnswers.includes(userAnswer.toLowerCase());

            if (isCorrect) {
                ctx.session.score++;
                await ctx.reply('✅ *Correct \\!*', { parse_mode: 'MarkdownV2' });
            } else {
                await ctx.reply(
                    `❌ *Incorrect \\!*\nLa réponse était : ${Utils.escapeMarkdown(question.answer)}`,
                    { parse_mode: 'MarkdownV2' }
                );
            }

            if (question.explanation) {
                await ctx.reply(`💡 Explication : ${Utils.escapeMarkdown(question.explanation)}`, { parse_mode: 'MarkdownV2' });
            }

            ctx.session.currentQuestion++;
            if (ctx.session.currentQuestion >= ctx.session.questions.length) {
                return this.endQuizSession(ctx);
            }

            await this.sendNextQuestion(ctx);
        });

        return scene;
    }

    static groupQuizScene() {
        const scene = new Scenes.BaseScene('groupQuiz');

        scene.enter(async ctx => {
            if (ctx.chat.type === 'private') {
                await ctx.reply('ℹ️ Cette commande est réservée aux groupes !');
                return ctx.scene.leave();
            }

            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible. Créez d\'abord un verset avec /setverse');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('🎮 Choisissez un verset pour le quiz de groupe :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', ctx => {
            ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            // Vérifier d'abord si c'est une commande
            const text = ctx.message.text.trim();
            if (text.startsWith('/')) {
                // Laisser passer les commandes sans les traiter comme des réponses
                return;
            }

            if (!ctx.session.questions) {
                const verseName = text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                    return;
                }

                const questions = await db.getQuizQuestionsByVerse(verse.id);
                if (questions.length === 0) {
                    await ctx.reply('ℹ️ Aucune question dans ce verset');
                    return ctx.scene.leave();
                }

                // Mélanger les questions
                const shuffledQuestions = [...questions].sort(() => Math.random() - 0.5);

                // Initialiser la session de groupe
                ctx.session.scores = {};
                ctx.session.questions = shuffledQuestions;
                ctx.session.currentQuestion = 0;
                ctx.session.verseId = verse.id;
                ctx.session.lastActive = Date.now();

                await ctx.reply(
                    `🎉 *Quiz de groupe lancé !*\n\n` +
                    `Thème : *${Utils.escapeMarkdown(verse.name)}*\n` +
                    `Nombre de questions : *${questions.length}*\n\n` +
                    `Le premier à répondre correctement marque un point !`,
                    { parse_mode: 'MarkdownV2' }
                );

                await this.sendNextGroupQuestion(ctx);
                return;
            }

            // Vérifier l'inactivité
            if (Date.now() - ctx.session.lastActive > CONFIG.GROUP_SESSION_TIMEOUT) {
                await this.endGroupQuizSession(ctx, '⌛️ Session terminée pour cause d\'inactivité');
                return;
            }

            ctx.session.lastActive = Date.now();
            const question = ctx.session.questions[ctx.session.currentQuestion];
            const userAnswer = text;

            const alternatives = question.alternatives ? question.alternatives.split(',') : [];
            const possibleAnswers = [question.answer, ...alternatives].map(a => a.trim().toLowerCase());

            const isCorrect = possibleAnswers.includes(userAnswer.toLowerCase());

            if (isCorrect) {
                // Enregistrer le score
                const userId = ctx.from.id;
                ctx.session.scores[userId] = (ctx.session.scores[userId] || 0) + 1;

                // Enregistrer l'utilisateur
                await db.getOrCreateUser(ctx);

                await ctx.reply(
                    `🎉 *${Utils.escapeMarkdown(Utils.formatUsername(ctx.from))} a la bonne réponse \\!*\n\n` +
                    `Réponse : *${Utils.escapeMarkdown(question.answer)}*`,
                    { parse_mode: 'MarkdownV2' }
                );

                if (question.explanation) {
                    await ctx.reply(`💡 Explication : ${Utils.escapeMarkdown(question.explanation)}`, { parse_mode: 'MarkdownV2' });
                }

                ctx.session.currentQuestion++;
                if (ctx.session.currentQuestion >= ctx.session.questions.length) {
                    return this.endGroupQuizSession(ctx);
                }

                await this.sendNextGroupQuestion(ctx);
            }
        });

        scene.command('endquiz', async ctx => {
            await this.endGroupQuizSession(ctx, '🏁 Session quiz terminée');
        });

        scene.command('endquizquestion', async ctx => {
            await this.endGroupQuizSession(ctx, '🏁 Session quiz questions terminée par l\'administrateur');
        });

        return scene;
    }

    static deleteQuizQuestionScene() {
        const scene = new Scenes.BaseScene('deleteQuizQuestion');

        scene.enter(async ctx => {
            ctx.session.step = 'verse';
            const verses = await db.query('SELECT name FROM verses');
            if (verses.length === 0) {
                await ctx.reply('ℹ️ Aucun verset disponible.');
                return ctx.scene.leave();
            }

            const verseNames = verses.map(v => v.name);
            await ctx.reply('📚 Choisissez le verset contenant la question :', {
                reply_markup: {
                    keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', ctx => {
            ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            if (ctx.session.step === 'verse') {
                const verseName = ctx.message.text;
                const verse = await db.getVerseByName(verseName);

                if (!verse) {
                    await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                    return;
                }

                const questions = await db.getQuizQuestionsByVerse(verse.id);
                if (questions.length === 0) {
                    await ctx.reply('ℹ️ Aucune question dans ce verset');
                    return ctx.scene.leave();
                }

                ctx.session.verseId = verse.id;
                ctx.session.questions = questions;
                ctx.session.step = 'question';

                const questionList = questions.map((q, i) => 
                    `${i + 1}. ${q.question.substring(0, 50)}${q.question.length > 50 ? '...' : ''}`
                ).join('\n');

                await ctx.reply(
                    `❓ Choisissez une question à supprimer :\n\n${questionList}\n\n` +
                    `Répondez avec le numéro de la question`,
                    { reply_markup: Markup.removeKeyboard() }
                );
            }

            if (ctx.session.step === 'question') {
                const questionNum = parseInt(ctx.message.text);
                if (isNaN(questionNum) || questionNum < 1 || questionNum > ctx.session.questions.length) {
                    await ctx.reply('❌ Numéro invalide. Veuillez réessayer :');
                    return;
                }

                const question = ctx.session.questions[questionNum - 1];
                ctx.session.questionId = question.id;

                try {
                    const user = await db.getOrCreateUser(ctx);
                    const verse = await db.query('SELECT * FROM verses WHERE id = ?', [question.verse_id]);

                    if (verse.length > 0 && verse[0].created_by !== user.user_id && !user.is_admin) {
                        await ctx.reply('⛔️ Vous n\'êtes pas autorisé à supprimer cette question');
                        return ctx.scene.leave();
                    }

                    await db.deleteQuizQuestion(question.id);
                    await ctx.reply('✅ Question supprimée avec succès !');
                    return ctx.scene.leave();
                } catch (err) {
                    await ctx.reply(`❌ Erreur lors de la suppression : ${err.message}`);
                }
            }
        });

        return scene;
    }

    // Nouvelles scènes SRS
    static srsReviewScene() {
        const scene = new Scenes.BaseScene('srsReview');

        scene.enter(async ctx => {
            // Vérifier si c'est en privé
            if (ctx.chat.type !== 'private') {
                await ctx.reply('ℹ️ Cette fonctionnalité est disponible uniquement en message privé.');
                return ctx.scene.leave();
            }

            const userId = ctx.from.id;
            const dueReviews = await db.getDueReviews(userId);

            if (dueReviews.length === 0) {
                const stats = await db.getSrsStats(userId);
                await ctx.reply(
                    `🎉 Bravo ! Vous n'avez aucun élément à réviser pour le moment.\n\n` +
                    `📊 Statistiques :\n` +
                    `- Éléments en attente : ${stats[0].due || 0}/${stats[0].total || 0}\n\n` +
                    `🔁 Pour ajouter des éléments à réviser : /addtosrs`,
                    { parse_mode: 'MarkdownV2' }
                );
                return ctx.scene.leave();
            }

            ctx.session.reviews = dueReviews;
            ctx.session.currentIndex = 0;
            ctx.session.startTime = Date.now();

            await this.sendNextReview(ctx);
        });

        scene.on('text', async ctx => {
            if (!ctx.session.reviews) return;

            const review = ctx.session.reviews[ctx.session.currentIndex];
            const userAnswer = ctx.message.text.trim();
            let isCorrect = false;

            // Récupérer l'élément original
            let item, correctAnswer;
            switch (review.item_type) {
                case 'flashcard':
                    item = await db.getFlashcardById(review.item_id);
                    correctAnswer = item.answer;
                    const alternatives = item.alternatives ? item.alternatives.split(',') : [];
                    isCorrect = userAnswer === correctAnswer || alternatives.includes(userAnswer);
                    break;

                case 'quiz':
                    item = await db.getQuizQuestionById(review.item_id);
                    correctAnswer = item.answer;
                    const quizAlternatives = item.alternatives ? item.alternatives.split(',') : [];
                    const possibleAnswers = [correctAnswer, ...quizAlternatives].map(a => a.trim().toLowerCase());
                    isCorrect = possibleAnswers.includes(userAnswer.toLowerCase());
                    break;

                case 'blindtest':
                    item = await db.query('SELECT * FROM blind_tests WHERE id = ?', [review.item_id]);
                    if (item.length > 0) {
                        correctAnswer = item[0].title;
                        const btAlternatives = item[0].alternatives ? item[0].alternatives.split(',') : [];
                        isCorrect = userAnswer === correctAnswer || btAlternatives.includes(userAnswer);
                    }
                    break;
            }

            // Mettre à jour la révision SRS
            const quality = isCorrect ? 4 : 0; // 0-5 scale
            await db.updateReview(review.id, quality);

            // Feedback
            if (isCorrect) {
                await ctx.reply('✅ *Correct !*', { parse_mode: 'MarkdownV2' });
            } else {
                await ctx.reply(`❌ *Incorrect !*\nRéponse : ${Utils.escapeMarkdown(correctAnswer)}`, 
                    { parse_mode: 'MarkdownV2' }
                );
            }

            // Envoyer le contexte du verset si disponible
            if (review.verse_id) {
                const verse = await db.query('SELECT name FROM verses WHERE id = ?', [review.verse_id]);
                if (verse.length > 0) {
                    await ctx.reply(`📚 Thème : *${Utils.escapeMarkdown(verse[0].name)}*`, 
                        { parse_mode: 'MarkdownV2' }
                    );
                }
            }

            ctx.session.currentIndex++;
            if (ctx.session.currentIndex >= ctx.session.reviews.length) {
                return this.endSrsSession(ctx);
            }

            await new Promise(resolve => setTimeout(resolve, 1500));
            await this.sendNextReview(ctx);
        });

        return scene;
    }

    static youtubeDownloadScene() {
        const scene = new Scenes.BaseScene('youtubeDownload');

        scene.enter(async ctx => {
            // Vérifier les limites de téléchargement
            const userId = ctx.from.id;
            const user = await db.getOrCreateUser(ctx);
            const isAdmin = user.is_admin;
            const { hourlyCount, dailyCount } = await getUserDownloadCount(userId, isAdmin);
            
            // Vérifier la limite horaire
            const maxHourly = isAdmin ? CONFIG.MAX_HOURLY_DOWNLOADS_ADMIN : CONFIG.MAX_HOURLY_DOWNLOADS_USER;
            if (hourlyCount >= maxHourly) {
                await ctx.reply(
                    `🚫 Vous avez atteint votre limite horaire de téléchargements (${hourlyCount}/${maxHourly}).\n` +
                    `Veuillez attendre la prochaine heure !`
                );
                return ctx.scene.leave();
            }
            
            // Vérifier la limite quotidienne (seulement pour les utilisateurs lambda)
            if (!isAdmin && dailyCount >= CONFIG.MAX_DAILY_DOWNLOADS_USER) {
                await ctx.reply(
                    `🚫 Vous avez atteint votre limite quotidienne de téléchargements (${dailyCount}/${CONFIG.MAX_DAILY_DOWNLOADS_USER}).\n` +
                    `Veuillez réessayer demain !`
                );
                return ctx.scene.leave();
            }

            ctx.session.downloadState = {};
            await ctx.reply('🎬 Envoyez un lien YouTube ou le titre d\'une vidéo :', 
                Markup.keyboard([['🚫 Annuler']]).resize()
            );
        });

        scene.hears('🚫 Annuler', ctx => {
            ctx.reply('❌ Opération annulée', { reply_markup: { remove_keyboard: true } });
            return ctx.scene.leave();
        });

        scene.on('text', async ctx => {
            const input = ctx.message.text.trim();

            // Si c'est un lien YouTube valide
            if (ytdl.validateURL(input)) {
                let attempts = 0;
                const maxAttempts = 2;
                
                while (attempts < maxAttempts) {
                    try {
                        attempts++;
                        await ctx.reply(`🔍 Analyse de la vidéo en cours... (tentative ${attempts}/${maxAttempts})`);
                        
                        const info = await Promise.race([
                            ytdl.getInfo(input, {
                                agent: ytdlAgent,
                                requestOptions: {
                                    headers: {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                                    }
                                }
                            }),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout analyse vidéo')), 25000)
                            )
                        ]);
                        
                        const video = info.videoDetails;

                        // Vérifications de disponibilité
                        if (video.isLiveContent) {
                            await ctx.reply('❌ Les streams en direct ne sont pas supportés');
                            return ctx.scene.leave();
                        }

                        if (video.isPrivate || !video.isUnlisted && !video.video_url) {
                            await ctx.reply('❌ Cette vidéo est privée ou indisponible');
                            return ctx.scene.leave();
                        }

                        // Vérifier la durée (max 20 minutes pour Render)
                        const maxDuration = 1200; // 20 minutes pour être plus sûr sur Render
                        if (parseInt(video.lengthSeconds) > maxDuration) {
                            await ctx.reply(`❌ La vidéo dépasse la durée maximale autorisée (${maxDuration/60} minutes)`);
                            return ctx.scene.leave();
                        }

                        ctx.session.downloadState = {
                            url: input,
                            title: video.title || 'Titre indisponible',
                            duration: formatDuration(video.lengthSeconds),
                            thumbnail: video.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url || '',
                            views: parseInt(video.viewCount || 0).toLocaleString(),
                            channel: video.ownerChannelName || video.author?.name || 'Inconnu'
                        };

                        await this.showFormatOptions(ctx);
                        return; // Succès, sortir de la boucle
                        
                    } catch (err) {
                        console.error(`Erreur getInfo tentative ${attempts}:`, err.message);
                        
                        if (attempts >= maxAttempts) {
                            await ctx.reply(
                                `❌ Impossible d'analyser cette vidéo après ${maxAttempts} tentatives.\n` +
                                `Causes possibles:\n` +
                                `• Vidéo restreinte géographiquement\n` +
                                `• Vidéo privée ou supprimée\n` +
                                `• Problème de réseau temporaire\n\n` +
                                `Veuillez réessayer avec une autre vidéo.`
                            );
                            return ctx.scene.leave();
                        }
                        
                        // Attendre avant la prochaine tentative
                        await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
            } 
            // Sinon, recherche par titre
            else if (!ctx.session.searchResults) {
                try {
                    await ctx.reply('🔍 Recherche en cours...', { reply_markup: { remove_keyboard: true } });

                    const results = await searchYouTube(input);
                    if (results.length === 0) {
                        await ctx.reply('🔍 Aucun résultat trouvé. Essayez une autre recherche.');
                        return;
                    }

                    ctx.session.searchResults = results;

                    const keyboard = results.map((video, i) => {
                        const duration = video.duration || 'N/A';
                        const title = video.title || 'Titre indisponible';
                        return [`${i + 1}. ${title.substring(0, 40)}${title.length > 40 ? '...' : ''} (${duration})`];
                    });

                    keyboard.push(['🚫 Annuler']);

                    await ctx.reply('🔎 Résultats de recherche :', {
                        reply_markup: {
                            keyboard,
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    });
                } catch (err) {
                    console.error('Erreur recherche:', err);
                    await ctx.reply('❌ Erreur lors de la recherche. Veuillez réessayer.');
                }
            }
            // Gestion de la sélection de résultats
            else if (ctx.session.searchResults) {
                const choice = parseInt(ctx.message.text[0]);
                if (isNaN(choice) || choice < 1 || choice > ctx.session.searchResults.length) {
                    await ctx.reply('❌ Choix invalide. Veuillez sélectionner un numéro valide.');
                    return;
                }

                const video = ctx.session.searchResults[choice - 1];

                // Vérifier la durée (max 1 heure)
                if (video.duration) {
                    const [mins, secs] = video.duration.split(':').map(Number);
                    const totalSeconds = mins * 60 + secs;
                    if (totalSeconds > 3600) {
                        await ctx.reply('❌ La vidéo dépasse la durée maximale autorisée (1 heure)');
                        return ctx.scene.leave();
                    }
                }

                ctx.session.downloadState = {
                    url: video.url,
                    title: video.title,
                    duration: video.duration || 'N/A',
                    thumbnail: video.bestThumbnail.url,
                    views: video.views.toLocaleString(),
                    channel: video.author?.name || 'Inconnu'
                };

                delete ctx.session.searchResults;
                await this.showFormatOptions(ctx);
            }
        });

        scene.action(/format_.+/, async (ctx) => {
            await this.handleFormatSelection(ctx);
        });

        return scene;
    }

    static async showFormatOptions(ctx) {
        const { title, duration, thumbnail, views, channel } = ctx.session.downloadState;

        const caption = `📽️ *${Utils.escapeMarkdown(title)}*\n` +
                        `👤 Chaîne: ${Utils.escapeMarkdown(channel)}\n` +
                        `👀 Vues: ${views}\n` +
                        `⏱ Durée: ${duration}\n\n` +
                        `Choisissez le format et la qualité :`;

        // Toujours proposer les deux formats (l'analyse des formats se fera au téléchargement)
        const keyboard = [
            [
                { text: '🎵 Audio (128k)', callback_data: 'format_audio_high' },
                { text: '🎵 Audio (96k)', callback_data: 'format_audio_std' }
            ],
            [
                { text: '🎬 Vidéo (360p)', callback_data: 'format_video_360' },
                { text: '🎬 Vidéo (240p)', callback_data: 'format_video_240' }
            ],
            [{ text: '🚫 Annuler', callback_data: 'format_cancel' }]
        ];

        // Utiliser une image par défaut si pas de thumbnail
        if (thumbnail) {
            await ctx.replyWithPhoto(thumbnail, {
                caption,
                parse_mode: 'MarkdownV2',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            await ctx.reply(caption, {
                parse_mode: 'MarkdownV2',
                reply_markup: { inline_keyboard: keyboard }
            });
        }
    }

    static async handleFormatSelection(ctx) {
        const callbackData = ctx.callbackQuery.data;

        if (callbackData === 'format_cancel') {
            await ctx.answerCbQuery('Opération annulée');
            await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
            return ctx.scene.leave();
        }

        await ctx.answerCbQuery('Téléchargement en cours...');
        await ctx.editMessageReplyMarkup({ inline_keyboard: [] }); // Retire les boutons

        const [_, type, quality] = callbackData.split('_');
        ctx.session.downloadState.format = type;
        ctx.session.downloadState.quality = quality;

        const { url, title, thumbnail } = ctx.session.downloadState;

        try {
            // Envoyer une notification de progression
            const progressMsg = await ctx.reply('⏳ Téléchargement en cours (0%)...');
            let lastProgress = 0;

            // Télécharger avec timeout
            const downloadPromise = downloadYouTube(
                url, 
                type, 
                quality === 'high' || quality === '720' ? 'high' : 'low',
                title
            );

            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Téléchargement timeout')), CONFIG.DOWNLOAD_TIMEOUT)
            );

            const filePath = await Promise.race([downloadPromise, timeoutPromise]);

            // Mise à jour finale
            await ctx.telegram.editMessageText(
                progressMsg.chat.id,
                progressMsg.message_id,
                null,
                '✅ Téléchargement terminé ! Envoi en cours...'
            );

            // Vérifier la taille du fichier
            const stats = fs.statSync(filePath);
            const fileSize = stats.size / (1024 * 1024); // Taille en MB

            if (fileSize > CONFIG.MAX_FILE_SIZE) {
                await unlinkAsync(filePath);
                await ctx.reply(`❌ Fichier trop volumineux (${formatFileSize(stats.size)} > ${CONFIG.MAX_FILE_SIZE}MB)`);
                return ctx.scene.leave();
            }

            // Envoyer le fichier
            if (type === 'audio') {
                await ctx.replyWithAudio({ source: filePath }, {
                    title: title.substring(0, 64),
                    performer: 'YouTube Download',
                    thumb: { url: thumbnail }
                });
            } else {
                await ctx.replyWithVideo({ source: filePath }, {
                    caption: title.substring(0, 1024),
                    supports_streaming: true
                });
            }

            // Supprimer le fichier temporaire
            await unlinkAsync(filePath);

            // Supprimer le message de progression
            await ctx.telegram.deleteMessage(progressMsg.chat.id, progressMsg.message_id);

            // Enregistrer le téléchargement
            await recordUserDownload(ctx.from.id);

        } catch (err) {
            console.error('Erreur de téléchargement:', err);
            await ctx.reply(`❌ Erreur lors du téléchargement: ${err.message}`);
        }

        ctx.scene.leave();
    }

    static addToSrsScene() {
        const scene = new Scenes.BaseScene('addToSrs');

        scene.enter(async ctx => {
            // Vérifier si c'est en privé
            if (ctx.chat.type !== 'private') {
                await ctx.reply('ℹ️ Cette fonctionnalité est disponible uniquement en message privé.');
                return ctx.scene.leave();
            }

            await ctx.reply('📚 Que souhaitez-vous ajouter à vos révisions ?', {
                reply_markup: {
                    keyboard: [['Flashcards', 'Questions Quiz', 'Blind Tests'], ['🚫 Annuler']],
                    resize_keyboard: true
                }
            });
        });

        scene.hears('🚫 Annuler', ctx => ctx.scene.leave());

        scene.on('text', async ctx => {
            if (!ctx.session.itemType) {
                const choice = ctx.message.text;
                ctx.session.itemType = choice.includes('Flash') ? 'flashcard' : 
                                      choice.includes('Quiz') ? 'quiz' : 
                                      choice.includes('Blind') ? 'blindtest' : null;

                if (!ctx.session.itemType) {
                    await ctx.reply('❌ Choix invalide. Veuillez choisir parmi les options.');
                    return;
                }

                const verses = await db.query('SELECT name FROM verses');
                if (verses.length === 0) {
                    await ctx.reply('ℹ️ Aucun verset disponible. Créez d\'abord un verset avec /setverse');
                    return ctx.scene.leave();
                }

                const verseNames = verses.map(v => v.name);
                await ctx.reply('📚 Choisissez un verset :', {
                    reply_markup: {
                        keyboard: Utils.generateKeyboard([...verseNames, '🚫 Annuler']),
                        resize_keyboard: true
                    }
                });
                return;
            }

            const verseName = ctx.message.text;
            const verse = await db.getVerseByName(verseName);

            if (!verse) {
                await ctx.reply('❌ Verset introuvable. Veuillez réessayer :');
                return;
            }

            ctx.session.verseId = verse.id;
            const userId = ctx.from.id;

            try {
                let items = [];
                switch (ctx.session.itemType) {
                    case 'flashcard':
                        items = await db.getFlashcardsByVerse(verse.id);
                        break;
                    case 'quiz':
                        items = await db.getQuizQuestionsByVerse(verse.id);
                        break;
                    case 'blindtest':
                        items = await db.getBlindTestsByVerse(verse.id);
                        break;
                }

                if (items.length === 0) {
                    await ctx.reply(`ℹ️ Aucun élément trouvé dans ce verset pour ce type`);
                    return ctx.scene.leave();
                }

                // Ajouter tous les éléments au SRS
                for (const item of items) {
                    await db.addItemToSrs(userId, item.id, ctx.session.itemType, verse.id);
                }

                await ctx.reply(
                    `✅ ${items.length} éléments ajoutés à vos révisions !\n\n` +
                    `Ils apparaîtront progressivement dans vos sessions de révision.`,
                    { parse_mode: 'MarkdownV2' }
                );

                return ctx.scene.leave();
            } catch (err) {
                await ctx.reply(`❌ Erreur : ${err.message}`);
            }
        });

        return scene;
    }

    static async sendNextReview(ctx) {
        const review = ctx.session.reviews[ctx.session.currentIndex];
        const userId = ctx.from.id;

        switch (review.item_type) {
            case 'flashcard':
                const flashcard = await db.getFlashcardById(review.item_id);
                if (flashcard) {
                    await ctx.replyWithPhoto(
                        { source: flashcard.thumbnail_path },
                        {
                            caption: `❓ *${Utils.escapeMarkdown(flashcard.question)}*\n\n` +
                                     `⏱ Vous avez 10 secondes !`,
                            parse_mode: 'MarkdownV2'
                        }
                    );
                }
                break;

            case 'quiz':
                const quiz = await db.getQuizQuestionById(review.item_id);
                if (quiz) {
                    let message = `❓ *${Utils.escapeMarkdown(quiz.question)}*`;
                    if (quiz.alternatives) {
                        const alternatives = quiz.alternatives.split(',').map((a, i) => 
                            `${String.fromCharCode(65 + i)}. ${a.trim()}`
                        ).join('\n');
                        message += `\n\n🔤 Alternatives :\n${alternatives}`;
                    }
                    await ctx.reply(message, { parse_mode: 'MarkdownV2' });
                }
                break;

            case 'blindtest':
                const blindtest = await db.query('SELECT * FROM blind_tests WHERE id = ?', [review.item_id]);
                if (blindtest.length > 0) {
                    await ctx.replyWithAudio(
                        { source: blindtest[0].audio_path },
                        {
                            caption: '🎧 Écoutez bien ! Quel est le titre ?',
                            parse_mode: 'MarkdownV2'
                        }
                    );
                }
                break;
        }

        // Ajouter un timer pour la réponse
        ctx.session.timer = setTimeout(async () => {
            await ctx.reply('⏱ Temps écoulé ! Passons à la suite...');
            ctx.session.currentIndex++;
            if (ctx.session.currentIndex >= ctx.session.reviews.length) {
                return this.endSrsSession(ctx);
            }
            await this.sendNextReview(ctx);
        }, 10000);
    }

    static async endSrsSession(ctx) {
        const duration = Math.round((Date.now() - ctx.session.startTime) / 1000);
        const total = ctx.session.reviews.length;

        await ctx.reply(
            `🏁 Session de révision terminée !\n\n` +
            `⏱ Durée : *${duration} secondes*\n` +
            `🔢 Éléments révisés : *${total}*\n\n` +
            `📅 Votre prochaine révision sera programmée automatiquement.`,
            { parse_mode: 'MarkdownV2' }
        );

        // Nettoyage session
        if (ctx.session.timer) clearTimeout(ctx.session.timer);
        ctx.session = {};
        ctx.scene.leave();
    }

    static async sendNextBlindTest(ctx) {
        const blindTest = ctx.session.blindTests[ctx.session.currentTest];

        await ctx.replyWithAudio(
            { source: blindTest.audio_path },
            {
                caption: '🎧 *Écoutez bien \\!*\n\n⏱ Vous avez 10 secondes pour deviner le titre \\!',
                parse_mode: 'MarkdownV2'
            }
        );

        // Timer de 10 secondes
        if (ctx.session.timer) {
            clearTimeout(ctx.session.timer);
        }

        ctx.session.timer = setTimeout(async () => {
            try {
                await ctx.reply(
                    `⏱ Temps écoulé \\!\n\nLa réponse était : *${Utils.escapeMarkdown(blindTest.title)}*`,
                    { parse_mode: 'MarkdownV2' }
                );

                ctx.session.currentTest++;
                if (ctx.session.currentTest >= ctx.session.blindTests.length) {
                    return this.endBlindTestSession(ctx);
                }

                await this.sendNextBlindTest(ctx);
            } catch (err) {
                if (!err.message.includes("message can't be edited")) {
                    console.error('Erreur timer blind test:', err.message);
                }
            }
        }, 10000);
    }

    static async sendNextGroupBlindTest(ctx) {
        const blindTest = ctx.session.blindTests[ctx.session.currentTest];

        await ctx.replyWithAudio(
            { source: blindTest.audio_path },
            {
                caption: `🎧 Piste ${ctx.session.currentTest + 1}/${ctx.session.blindTests.length}\n` +
                         '⏱ Premier qui trouve le titre gagne un point \\!',
                parse_mode: 'MarkdownV2'
            }
        );
    }

    static async endBlindTestSession(ctx) {
        const duration = Math.round((Date.now() - ctx.session.startTime) / 1000);
        const total = ctx.session.blindTests.length;
        const score = ctx.session.score;
        const percentage = Math.round((score / total) * 100);

        await ctx.reply(
            `🏁 *Session blind test terminée \\!*\n\n` +
            `📊 Score final : *${score}/${total}* \\(${percentage}%\\)\n` +
            `⏱ Temps total : *${duration} secondes*\n\n` +
            `🔁 Pour recommencer : /playblindtest`,
            { parse_mode: 'MarkdownV2' }
        );

        // Nettoyage session
        if (ctx.session.timer) clearTimeout(ctx.session.timer);
        ctx.session = {};
        ctx.scene.leave();
    }

    static async endGroupBlindTestSession(ctx, message = '🏁 Session blind test terminée \\!') {
        let scoreMessage = message + '\n\n';

        if (Object.keys(ctx.session.scores).length > 0) {
            // Récupérer les infos utilisateur
            const userIds = Object.keys(ctx.session.scores);
            const users = await Promise.all(userIds.map(id => db.getUser(parseInt(id))));
            const userMap = users.reduce((map, user) => {
                map[user.user_id] = user;
                return map;
            }, {});

            scoreMessage += '🏆 *Classement final :*\n\n' +
                           Utils.formatScores(ctx.session.scores, userMap);
        } else {
            scoreMessage += 'ℹ️ Aucun point marqué durant cette session';
        }

        await ctx.reply(scoreMessage, { parse_mode: 'MarkdownV2' });
        ctx.scene.leave();
    }

    static async sendNextGroupFlashcard(ctx) {
        const flashcard = ctx.session.flashcards[ctx.session.currentIndex];

        await ctx.replyWithPhoto(
            { source: flashcard.thumbnail_path },
            {
                caption: `❓ *${Utils.escapeMarkdown(flashcard.question)}*\n\n` +
                         `Question ${ctx.session.currentIndex + 1}/${ctx.session.flashcards.length}`,
                parse_mode: 'MarkdownV2'
            }
        );
    }

    static async endGroupSession(ctx, message = '🏁 Session terminée \\!') {
        let scoreMessage = message + '\n\n';

        if (Object.keys(ctx.session.scores).length > 0) {
            // Récupérer les infos utilisateur
            const userIds = Object.keys(ctx.session.scores);
            const users = await Promise.all(userIds.map(id => db.getUser(parseInt(id))));
            const userMap = users.reduce((map, user) => {
                map[user.user_id] = user;
                return map;
            }, {});

            scoreMessage += '🏆 *Classement final :*\n\n' +
                           Utils.formatScores(ctx.session.scores, userMap);
        } else {
            scoreMessage += 'ℹ️ Aucun point marqué durant cette session';
        }

        await ctx.reply(scoreMessage, { parse_mode: 'MarkdownV2' });
        ctx.scene.leave();
    }

    // Nouvelles méthodes pour les quiz questions
    static async sendNextQuestion(ctx) {
        const question = ctx.session.questions[ctx.session.currentQuestion];

        const message = `❓ *${ctx.session.currentQuestion + 1}\\. ${Utils.escapeMarkdown(question.question)}*`;

        await ctx.reply(message, { parse_mode: 'MarkdownV2' });
    }

    static async sendNextGroupQuestion(ctx) {
        const question = ctx.session.questions[ctx.session.currentQuestion];
        const questionNum = ctx.session.currentQuestion + 1;
        const totalQuestions = ctx.session.questions.length;

        const message = `❓ *Question ${questionNum}/${totalQuestions}*\n\n` +
                       `*${Utils.escapeMarkdown(question.question)}*`;

        await ctx.reply(message, { parse_mode: 'MarkdownV2' });
    }

    static async endQuizSession(ctx) {
        const duration = Math.round((Date.now() - ctx.session.startTime) / 1000);
        const total = ctx.session.questions.length;
        const score = ctx.session.score;
        const percentage = Math.round((score / total) * 100);

        await ctx.reply(
            `🏁 Quiz terminé \\!\n\n` +
            `📊 Score final : *${score}/${total}* \\(${percentage}%\\)\n` +
            `⏱ Temps total : *${duration} secondes*`,
            { parse_mode: 'MarkdownV2' }
        );

        // Nettoyage session
        ctx.session = {};
        ctx.scene.leave();
    }

    static async endGroupQuizSession(ctx, message = '🏁 Session quiz terminée \\!') {
        let scoreMessage = message + '\n\n';

        if (Object.keys(ctx.session.scores).length > 0) {
            // Récupérer les infos utilisateur
            const userIds = Object.keys(ctx.session.scores);
            const users = await Promise.all(userIds.map(id => db.getUser(parseInt(id))));
            const userMap = users.reduce((map, user) => {
                map[user.user_id] = user;
                return map;
            }, {});

            scoreMessage += '🏆 *Classement final :*\n\n' +
                           Utils.formatScores(ctx.session.scores, userMap);
        } else {
            scoreMessage += 'ℹ️ Aucun point marqué durant cette session';
        }

        await ctx.reply(scoreMessage, { parse_mode: 'MarkdownV2' });
        ctx.scene.leave();
    }
}

// =============================================
// SYSTÈME DE RAPPELS AUTOMATIQUES SRS
// =============================================

class SRSReminderSystem {
    constructor(bot) {
        this.bot = bot;
        this.setupCron();
    }

    setupCron() {
        // Rappel quotidien à l'heure configurée
        cron.schedule(`0 ${CONFIG.SRS_REMINDER_HOUR} * * *`, async () => {
            const users = await db.query('SELECT DISTINCT user_id FROM srs_reviews');

            for (const user of users) {
                const dueReviews = await db.getDueReviews(user.user_id);
                if (dueReviews.length > 0) {
                    try {
                        await this.bot.telegram.sendMessage(
                            user.user_id,
                            `⏰ *Rappel de révision !*\n\n` +
                            `Vous avez ${dueReviews.length} éléments en attente de révision.\n` +
                            `Pour démarrer votre session : /review\n\n` +
                            `Ne laissez pas s'accumuler vos révisions !`,
                            { parse_mode: 'MarkdownV2' }
                        );
                    } catch (e) {
                        console.error(`Erreur de rappel SRS pour ${user.user_id}:`, e.message);
                    }
                }
            }
        });
    }
}

// =============================================
// COMMANDES ET GESTION DU BOT AVEC EXTENSION SRS
// =============================================
class SRSBotManagerExtension {
    constructor() {
        this.bot = new Telegraf(CONFIG.TOKEN);
        this.setup();
    }

    setup() {
        // Middlewares
        this.bot.use(session());
        this.bot.use(this.registerScenes());

        // Middleware pour enregistrer les utilisateurs et groupes
        this.bot.use(async (ctx, next) => {
            if (ctx.from) await db.getOrCreateUser(ctx);
            
            // Enregistrer les groupes pour le broadcast
            if (ctx.chat && ctx.chat.type !== 'private') {
                try {
                    await db.run(
                        `INSERT OR REPLACE INTO group_sessions (chat_id, verse_id, last_active) 
                         VALUES (?, ?, ?)`,
                        [ctx.chat.id, 1, new Date().toISOString()]
                    );
                } catch (err) {
                    // Ignore les erreurs d'insertion de groupe
                }
            }
            next();
        });

        // Commandes générales
        this.bot.start(this.startCommand);
        this.bot.help(this.helpCommand);
        this.bot.command('setverse', ctx => ctx.scene.enter('createVerse'));
        this.bot.command('deleteverse', ctx => ctx.scene.enter('deleteVerse'));
        this.bot.command('addflashcard', ctx => ctx.scene.enter('addFlashcard'));
        this.bot.command('playflashcards', ctx => ctx.scene.enter('flashcardSession'));
        this.bot.command('groupquiz', ctx => ctx.scene.enter('groupFlashcardSession'));
        this.bot.command('addblindtest', ctx => ctx.scene.enter('addBlindTest'));
        this.bot.command('playblindtest', ctx => ctx.scene.enter('playBlindTest'));
        this.bot.command('groupblindtest', ctx => ctx.scene.enter('groupBlindTest'));
        this.bot.command('listverses', this.listVersesCommand);
        this.bot.command('listflashcards', this.listFlashcardsCommand);
        this.bot.command('stats', this.statsCommand);
        this.bot.command('resume', this.resumeSession);
        this.bot.command('deleteflashcard', this.deleteFlashcardCommand);
        this.bot.command('deleteblindtest', this.deleteBlindTestCommand);
        this.bot.command('listblindtests', this.listBlindTestsCommand);

        // Nouvelles commandes pour les quiz questions
        this.bot.command('addquizquestion', ctx => ctx.scene.enter('addQuizQuestion'));
        this.bot.command('editquizquestion', ctx => ctx.scene.enter('editQuizQuestion'));
        this.bot.command('deletequizquestion', ctx => ctx.scene.enter('deleteQuizQuestion'));
        this.bot.command('playquiz', ctx => ctx.scene.enter('playQuiz'));
        this.bot.command('groupquizquestion', ctx => ctx.scene.enter('groupQuiz'));
        this.bot.command('listquizquestions', this.listQuizQuestionsCommand);

        // Nouvelles commandes SRS
        this.bot.command('review', ctx => ctx.scene.enter('srsReview'));
        this.bot.command('addtosrs', ctx => ctx.scene.enter('addToSrs'));
        this.bot.command('srsstats', this.srsStatsCommand.bind(this));

        // Commandes YouTube Downloader
        this.bot.command('youtube', ctx => ctx.scene.enter('youtubeDownload'));
        this.bot.command('mydownloads', this.checkDownloadsCommand.bind(this));

        // Gestion des actions inline YouTube
        this.bot.action(/format_.+/, async (ctx) => {
            try {
                if (ctx.scene.current && ctx.scene.current.id === 'youtubeDownload') {
                    await SceneCreator.handleFormatSelection(ctx);
                } else {
                    await ctx.answerCbQuery('Session expirée, veuillez recommencer');
                }
            } catch (error) {
                console.error('Erreur callback query:', error.message);
                // Ignorer silencieusement les erreurs de callback query expirées
                if (!error.message.includes('query is too old') && !error.message.includes('query ID is invalid')) {
                    throw error;
                }
            }
        });

        // Commandes admin
        this.bot.command('admin', this.adminCommand);
        this.bot.command('broadcast', this.broadcastCommand);
        this.bot.command('viewuser', this.viewUserCommand);

        // Initialiser le système de rappels SRS
        this.srsReminder = new SRSReminderSystem(this.bot);

        // Rappels quotidiens
        cron.schedule(CONFIG.DAILY_REMINDER, async () => {
            const users = await db.query('SELECT user_id FROM users');
            for (const user of users) {
                try {
                    await this.bot.telegram.sendMessage(
                        user.user_id,
                        '⏰ *Rappel quotidien !*\n\n' +
                        'Pensez à réviser vos flashcards aujourd\'hui 🔁\n' +
                        'Pour commencer : /playflashcards',
                        { parse_mode: 'MarkdownV2' }
                    );
                } catch (e) {
                    console.error(`Erreur de rappel pour ${user.user_id}:`, e.message);
                }
            }
        });

        // Gestion des erreurs améliorée
        this.bot.catch((err, ctx) => {
            console.error('Erreur bot:', err.message);

            // Ignorer les erreurs courantes non critiques
            const ignorableErrors = [
                'query is too old',
                'query ID is invalid', 
                'message is not modified',
                'can\'t parse entities',
                'message to edit not found',
                'Bad Request: message can\'t be edited',
                'terminated by other getUpdates request',
                'Conflict: terminated by other getUpdates'
            ];

            const shouldIgnore = ignorableErrors.some(ignorable => 
                err.message.includes(ignorable)
            );

            if (shouldIgnore) {
                console.log('Erreur ignorée:', err.message);
                return;
            }

            // Log les autres erreurs
            console.error('Erreur non gérée:', err);

            // Optionnel : notifier l'utilisateur en cas d'erreur grave
            if (ctx && ctx.chat) {
                try {
                    ctx.reply('❌ Une erreur inattendue s\'est produite. Veuillez réessayer.').catch(() => {});
                } catch (e) {
                    // Ignorer les erreurs de notification
                }
            }
        });
    }

    registerScenes() {
        const stage = new Scenes.Stage([
            SceneCreator.createVerseScene(),
            SceneCreator.deleteVerseScene(),
            SceneCreator.addFlashcardScene(),
            SceneCreator.flashcardSessionScene(),
            SceneCreator.groupFlashcardSessionScene(),
            SceneCreator.addBlindTestScene(),
            SceneCreator.playBlindTestScene(),
            SceneCreator.groupBlindTestScene(),
            SceneCreator.addQuizQuestionScene(),
            SceneCreator.editQuizQuestionScene(),
            SceneCreator.deleteQuizQuestionScene(),
            SceneCreator.playQuizScene(),
            SceneCreator.groupQuizScene(),
            SceneCreator.srsReviewScene(),
            SceneCreator.addToSrsScene(),
            SceneCreator.youtubeDownloadScene()
        ]);

        return stage.middleware();
    }

    async startCommand(ctx) {
        const user = await db.getOrCreateUser(ctx);
        const isAdmin = user.is_admin ? '\n👑 Vous êtes administrateur de ce bot' : '';

        const welcomeMsg = `✨ *Bienvenue sur CDSanimeBase \\!* ✨

🧠 *Système avancé de flashcards et quiz pour fans d'anime*
📚 Créez, organisez et révisez vos connaissances sur vos personnages préférés${isAdmin}

🔹 *Fonctionnalités principales :*
• 🗂 Organisation par versets thématiques
• 🖼 Flashcards avec reconnaissance d'images
• 🎧 Blind tests audio interactifs
• 📝 Quiz questions avec alternatives et explications
• 👥 Mode multi\\-joueurs pour les groupes
• ⏱ Système de révision chronométré
• 📊 Tableaux des scores
• 🧠 Révisions espacées intelligentes \\(SRS\\)
• ⏰ Rappels quotidiens

🔹 *Commandes disponibles :*
\`/setverse\` \\- Créer un nouveau thème
\`/deleteverse\` \\- Supprimer un thème
\`/addflashcard\` \\- Ajouter une flashcard
\`/addblindtest\` \\- Ajouter un blind test
\`/addquizquestion\` \\- Ajouter une question de quiz
\`/playflashcards\` \\- Session privée
\`/playblindtest\` \\- Blind test privé
\`/playquiz\` \\- Quiz questions privé
\`/groupquiz\` \\- Session de groupe
\`/groupblindtest\` \\- Blind test de groupe
\`/groupquizquestion\` \\- Quiz questions de groupe
\`/review\` \\- Session de révision espacée \\(SRS\\)
\`/addtosrs\` \\- Ajouter des éléments au SRS
\`/srsstats\` \\- Statistiques de révision
\`/youtube\` \\- Télécharger vidéo/audio YouTube
\`/mydownloads\` \\- Voir vos téléchargements restants
\`/listverses\` \\- Lister les thèmes
\`/listflashcards\` \\- Lister les flashcards
\`/listblindtests\` \\- Lister les blind tests
\`/listquizquestions\` \\- Lister les questions de quiz
\`/deleteflashcard\` \\- Supprimer une flashcard
\`/deleteblindtest\` \\- Supprimer un blind test
\`/deletequizquestion\` \\- Supprimer une question
\`/editquizquestion\` \\- Modifier une question
\`/stats\` \\- Vos statistiques
\`/resume\` \\- Reprendre une session
\`/help\` \\- Aide complète

💡 *Conçu avec passion par Izumi Hearthcliff/Kageo*`;

        await ctx.reply(welcomeMsg, { parse_mode: 'MarkdownV2' });
    }

    async helpCommand(ctx) {
        const helpMsg = `
🆘 *Aide CDSanimeBase*

🔹 *Commandes principales :*
/setverse \\- Créer un nouveau thème
/deleteverse \\- Supprimer un thème \\(créateur ou admin\\)
/addflashcard \\- Ajouter une flashcard avec image
/playflashcards \\- Démarrer une session privée
/groupquiz \\- Démarrer un quiz de groupe \\(dans les groupes\\)
/listverses \\- Lister tous les thèmes disponibles
/listflashcards \\[verse\\] \\- Lister les flashcards d'un thème
/deleteflashcard \\[id\\] \\- Supprimer une flashcard
/stats \\- Afficher vos statistiques
/resume \\- Reprendre votre dernière session

🎧 *Commandes Blind Test :*
/addblindtest \\- Ajouter un nouveau blind test
/playblindtest \\- Session privée de blind test
/groupblindtest \\- Session de groupe de blind test
/listblindtests \\[verse\\] \\- Lister les blind tests d'un thème
/deleteblindtest \\[id\\] \\- Supprimer un blind test

🎲 *Commandes Quiz Questions :*
/addquizquestion \\- Ajouter une nouvelle question
/editquizquestion \\- Modifier les alternatives/explications
/deletequizquestion \\- Supprimer une question
/playquiz \\- Session privée de quiz
/groupquizquestion \\- Session de groupe \\(premier à répondre\\)
/listquizquestions \\[verse\\] \\- Lister les questions d'un verset

🧠 *Révisions Espacées \\(SRS\\) :*
/review \\- Démarrer une session de révision
/addtosrs \\- Ajouter des éléments à réviser
/srsstats \\- Voir vos statistiques de révision

🎬 *YouTube Downloader Pro :*
/youtube \\- Télécharger vidéo/audio YouTube
/mydownloads \\- Voir vos téléchargements restants

🔹 *Commandes de groupe :*
/groupquiz \\- Démarrer un quiz
/groupblindtest \\- Démarrer un blind test
/groupquizquestion \\- Démarrer un quiz questions
/endsession \\- Terminer la session \\(admin\\)
/endbt \\- Terminer le blind test \\(admin\\)
/endquiz \\- Terminer le quiz \\(admin\\)
/endquizquestion \\- Terminer le quiz questions \\(admin\\)

🔹 *Commandes admin :*
/admin \\- Panel d'administration
/broadcast \\[message\\] \\- Envoyer un message à tous les utilisateurs
/viewuser \\[id\\] \\- Voir les détails d'un utilisateur

💡 Pour plus d'aide : @kageonightray
`;

        await ctx.reply(helpMsg, { parse_mode: 'MarkdownV2' });
    }

    async srsStatsCommand(ctx) {
        if (ctx.chat.type !== 'private') {
            await ctx.reply('ℹ️ Cette commande est disponible uniquement en privé.');
            return;
        }

        const userId = ctx.from.id;
        const stats = await db.getSrsStats(userId);
        const dueReviews = await db.getDueReviews(userId);

        if (stats.length === 0 || stats[0].total === 0) {
            await ctx.reply('ℹ️ Vous n\'avez aucun élément dans votre système de révision.\nAjoutez-en avec /addtosrs');
            return;
        }

        const nextReviews = await db.query(
            `SELECT COUNT(*) AS count, 
                    MIN(julianday(next_review) - julianday('now')) AS days
             FROM srs_reviews 
             WHERE user_id = ? AND next_review > CURRENT_TIMESTAMP`,
            [userId]
        );

        const response = 
            `📊 *Statistiques de vos révisions*\n\n` +
            `• Éléments en attente : *${dueReviews.length}*\n` +
            `• Prochaine révision dans : *${Math.round(nextReviews[0].days || 0)} jours*\n` +
            `• Total d'éléments : *${stats[0].total}*\n\n` +
            `🔁 Pour démarrer une session : /review`;

        await ctx.reply(Utils.escapeMarkdown(response), { parse_mode: 'MarkdownV2' });
    }

    async listVersesCommand(ctx) {
        const verses = await db.query('SELECT * FROM verses ORDER BY created_at DESC');
        if (verses.length === 0) {
            await ctx.reply('ℹ️ Aucun verset disponible. Créez-en un avec /setverse');
            return;
        }

        let response = '📚 *Liste des versets disponibles :*\n\n';
        for (const verse of verses) {
            const flashcardCount = await db.query('SELECT COUNT(*) as count FROM flashcards WHERE verse_id = ?', [verse.id]);
            const creator = await db.getUser(verse.created_by);
            response += `🔹 *${Utils.escapeMarkdown(verse.name)}*\n`;
            response += `   📊 ${flashcardCount[0].count} flashcards\n`;
            response += `   👤 Par : ${Utils.escapeMarkdown(Utils.formatUsername(creator))}\n\n`;
        }

        await ctx.reply(response, { parse_mode: 'MarkdownV2' });
    }

    async statsCommand(ctx) {
        const user = await db.getOrCreateUser(ctx);
        const userVerses = await db.query('SELECT COUNT(*) as count FROM verses WHERE created_by = ?', [user.user_id]);
        const userFlashcards = await db.query('SELECT COUNT(*) as count FROM flashcards WHERE created_by = ?', [user.user_id]);

        const response = `
📊 *Vos statistiques*

📚 Versets créés : ${userVerses[0].count}
🖼 Flashcards créées : ${userFlashcards[0].count}
👤 Utilisateur : ${Utils.escapeMarkdown(Utils.formatUsername(user))}
📅 Membre depuis : ${new Date(user.last_active).toLocaleDateString('fr-FR')}
`;

        await ctx.reply(response, { parse_mode: 'MarkdownV2' });
    }

    async resumeSession(ctx) {
        await ctx.reply('ℹ️ Fonctionnalité de reprise de session en cours de développement...');
    }

    async listFlashcardsCommand(ctx) {
        const verseName = ctx.message.text.split(' ')[1] || '';
        if (!verseName) {
            await ctx.reply('ℹ️ Usage: /listflashcards [nom_du_verset]');
            return;
        }

        const verse = await db.getVerseByName(verseName);
        if (!verse) {
            await ctx.reply('❌ Verset introuvable');
            return;
        }

        const flashcards = await db.getFlashcardsByVerse(verse.id);
        if (flashcards.length === 0) {
            await ctx.reply('ℹ️ Aucune flashcard dans ce verset');
            return;
        }

        let response = `📋 *Flashcards pour ${Utils.escapeMarkdown(verse.name)}:*\n\n`;
        flashcards.forEach((fc, index) => {
            response += `${index + 1}\\. ID: ${fc.id}\n`;
            response += `   Question: ${Utils.escapeMarkdown(fc.question)}\n`;
            response += `   Réponse: ${Utils.escapeMarkdown(fc.answer)}\n`;
            if (fc.alternatives) {
                response += `   Alternatives: ${Utils.escapeMarkdown(fc.alternatives)}\n`;
            }
        });

        response += '\n❌ Pour supprimer: /deleteflashcard \\[id\\]';
        await ctx.reply(response, { parse_mode: 'MarkdownV2' });
    }

    async deleteFlashcardCommand(ctx) {
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            await ctx.reply('ℹ️ Usage: /deleteflashcard [id]');
            return;
        }

        const flashcardId = parseInt(args[1]);
        if (isNaN(flashcardId)) {
            await ctx.reply('❌ ID invalide');
            return;
        }

        try {
            const flashcard = await db.getFlashcardById(flashcardId);
            if (!flashcard) {
                await ctx.reply('❌ Flashcard introuvable');
                return;
            }

            const user = await db.getOrCreateUser(ctx);
            const verse = await db.query('SELECT * FROM verses WHERE id = ?', [flashcard.verse_id]);

            if (verse[0].created_by !== user.user_id && !user.is_admin) {
                await ctx.reply('⛔️ Vous n\'êtes pas autorisé à supprimer cette flashcard');
                return;
            }

            await db.deleteFlashcard(flashcardId);
            await ctx.reply(`✅ Flashcard #${flashcardId} supprimée avec succès !`);
        } catch (err) {
            await ctx.reply(`❌ Erreur: ${err.message}`);
        }
    }

    async deleteBlindTestCommand(ctx) {
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            await ctx.reply('ℹ️ Usage: /deleteblindtest [id]');
            return;
        }

        const blindTestId = parseInt(args[1]);
        if (isNaN(blindTestId)) {
            await ctx.reply('❌ ID invalide');
            return;
        }

        try {
            const blindTest = await db.getBlindTestById(blindTestId);
            if (!blindTest) {
                await ctx.reply('❌ Blind test introuvable');
                return;
            }

            const user = await db.getOrCreateUser(ctx);
            const verse = await db.query('SELECT * FROM verses WHERE id = ?', [blindTest.verse_id]);

            if (verse[0].created_by !== user.user_id && !user.is_admin) {
                await ctx.reply('⛔️ Vous n\'êtes pas autorisé à supprimer ce blind test');
                return;
            }

            await db.deleteBlindTest(blindTestId);
            await ctx.reply(`✅ Blind test #${blindTestId} supprimé avec succès !`);
        } catch (err) {
            await ctx.reply(`❌ Erreur: ${err.message}`);
        }
    }

    async listBlindTestsCommand(ctx) {
        const verseName = ctx.message.text.split(' ')[1] || '';
        if (!verseName) {
            await ctx.reply('ℹ️ Usage: /listblindtests [nom_du_verset]');
            return;
        }

        const verse = await db.getVerseByName(verseName);
        if (!verse) {
            await ctx.reply('❌ Verset introuvable');
            return;
        }

        const blindTests = await db.getBlindTestsByVerse(verse.id);
        if (blindTests.length === 0) {
            await ctx.reply('ℹ️ Aucun blind test dans ce verset');
            return;
        }

        let response = `🎧 *Blind tests pour ${Utils.escapeMarkdown(verse.name)}:*\n\n`;
        blindTests.forEach((bt, index) => {
            response += `${index + 1}\\. ID: ${bt.id}\n`;
            response += `   Titre: ${Utils.escapeMarkdown(bt.title)}\n`;
            if (bt.alternatives) {
                response += `   Alternatives: ${Utils.escapeMarkdown(bt.alternatives)}\n`;
            }
            response += `   Créé le: ${new Date(bt.created_at).toLocaleDateString('fr-FR')}\n\n`;
        });

        response += '❌ Pour supprimer: /deleteblindtest \\[id\\]';
        await ctx.reply(response, { parse_mode: 'MarkdownV2' });
    }

    async listQuizQuestionsCommand(ctx) {
        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            await ctx.reply('ℹ️ Usage: /listquizquestions [nom_du_verset]');
            return;
        }

        const verseName = args.slice(1).join(' ');
        const verse = await db.getVerseByName(verseName);

        if (!verse) {
            await ctx.reply('❌ Verset introuvable');
            return;
        }

        const questions = await db.getQuizQuestionsByVerse(verse.id);
        if (questions.length === 0) {
            await ctx.reply('ℹ️ Aucune question dans ce verset');
            return;
        }

        let response = `📋 *Questions pour ${Utils.escapeMarkdown(verse.name)}:*\n\n`;
        questions.forEach((q, index) => {
            response += `${index + 1}\\. ID: ${q.id}\n`;
            response += `   Question: ${Utils.escapeMarkdown(q.question)}\n`;
            response += `   Réponse: ${Utils.escapeMarkdown(q.answer)}\n`;
            if (q.alternatives) {
                response += `   Alternatives: ${Utils.escapeMarkdown(q.alternatives)}\n`;
            }
            if (q.explanation) {
                response += `   Explication: ${Utils.escapeMarkdown(q.explanation)}\n`;
            }
            response += `\n`;
        });

        response += '❌ Pour supprimer: /deletequizquestion';
        await ctx.reply(response, { parse_mode: 'MarkdownV2' });
    }

    async adminCommand(ctx) {
        const user = await db.getOrCreateUser(ctx);
        if (!user.is_admin) {
            await ctx.reply('⛔️ Accès refusé');
            return;
        }

        const stats = await db.query(`
            SELECT 
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM verses) as total_verses,
                (SELECT COUNT(*) FROM flashcards) as total_flashcards,
                (SELECT COUNT(*) FROM quiz_questions) as total_quiz_questions,
                (SELECT COUNT(*) FROM group_sessions) as total_group_sessions,
                (SELECT COUNT(*) FROM srs_reviews) as total_srs_reviews
        `);

        const response = 
            `👑 *Panel d'administration*\n\n` +
            `👤 Utilisateurs : ${stats[0].total_users}\n` +
            `📚 Versets : ${stats[0].total_verses}\n` +
            `🖼 Flashcards : ${stats[0].total_flashcards}\n` +
            `📝 Questions de quiz : ${stats[0].total_quiz_questions}\n` +
            `👥 Sessions de groupe : ${stats[0].total_group_sessions}\n` +
            `🧠 Révisions SRS : ${stats[0].total_srs_reviews}\n\n` +
            `🔹 *Commandes disponibles :*\n` +
            `/broadcast \\[message\\] \\- Diffuser un message\n` +
            `/viewuser \\[id\\] \\- Voir un utilisateur\n` +
            `/admin \\- Afficher ce panel`;

        await ctx.reply(response, { parse_mode: 'MarkdownV2' });
    }

    async checkDownloadsCommand(ctx) {
        const userId = ctx.from.id;
        const user = await db.getOrCreateUser(ctx);
        const isAdmin = user.is_admin;
        const { hourlyCount, dailyCount } = await getUserDownloadCount(userId, isAdmin);
        
        const maxHourly = isAdmin ? CONFIG.MAX_HOURLY_DOWNLOADS_ADMIN : CONFIG.MAX_HOURLY_DOWNLOADS_USER;
        const maxDaily = isAdmin ? "Illimité" : CONFIG.MAX_DAILY_DOWNLOADS_USER;
        
        const remainingHourly = maxHourly - hourlyCount;
        const remainingDaily = isAdmin ? "Illimité" : CONFIG.MAX_DAILY_DOWNLOADS_USER - dailyCount;

        // Temps restant jusqu'à la prochaine heure
        const nextHour = new Date();
        nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
        const hoursLeft = Math.ceil((nextHour - new Date()) / 60000); // en minutes

        // Temps restant jusqu'à demain
        const resetTime = new Date();
        resetTime.setDate(resetTime.getDate() + 1);
        resetTime.setHours(0, 0, 0, 0);
        const timeLeft = Math.round((resetTime - new Date()) / 3600000);

        let statusMsg = `📊 *Vos statistiques de téléchargement*\n\n`;
        statusMsg += `👤 Statut : ${isAdmin ? "*Administrateur*" : "Utilisateur"}\n\n`;
        statusMsg += `⏰ **Cette heure :**\n`;
        statusMsg += `• Téléchargements : *${hourlyCount}/${maxHourly}*\n`;
        statusMsg += `• Restants : *${remainingHourly}*\n`;
        statusMsg += `• Réinitialisation dans : *${hoursLeft} min*\n\n`;
        
        if (!isAdmin) {
            statusMsg += `📅 **Aujourd'hui :**\n`;
            statusMsg += `• Téléchargements : *${dailyCount}/${maxDaily}*\n`;
            statusMsg += `• Restants : *${remainingDaily}*\n`;
            statusMsg += `• Réinitialisation dans : *${timeLeft} heures*\n\n`;
        } else {
            statusMsg += `📅 **Limite quotidienne :** *Aucune* \\(Admin\\)\n\n`;
        }
        
        statusMsg += `🎬 Pour télécharger : /youtube`;

        await ctx.reply(statusMsg, { parse_mode: 'MarkdownV2' });
    }

    async broadcastCommand(ctx) {
        const user = await db.getOrCreateUser(ctx);
        if (!user.is_admin) {
            await ctx.reply('⛔️ Accès refusé');
            return;
        }

        const message = ctx.message.text.replace('/broadcast', '').trim();
        if (!message) {
            await ctx.reply('ℹ️ Usage: /broadcast [message]');
            return;
        }

        // Récupérer tous les utilisateurs
        const users = await db.query('SELECT DISTINCT user_id FROM users WHERE user_id > 0');
        
        // Récupérer tous les groupes de différentes tables
        const groupQueries = [
            'SELECT DISTINCT chat_id FROM group_sessions WHERE chat_id < 0',
            'SELECT DISTINCT user_id as chat_id FROM users WHERE user_id < 0' // Si des groupes sont stockés ici
        ];
        
        let allGroups = [];
        for (const query of groupQueries) {
            try {
                const groups = await db.query(query);
                allGroups = allGroups.concat(groups);
            } catch (err) {
                console.log(`Requête groupe échouée: ${query}`);
            }
        }

        // Déduplication des groupes
        const uniqueGroups = allGroups.filter((group, index, self) => 
            index === self.findIndex(g => g.chat_id === group.chat_id)
        );
        
        let successCount = 0;
        let errorCount = 0;
        const totalTargets = users.length + uniqueGroups.length;

        await ctx.reply(`📣 Diffusion en cours à ${users.length} utilisateurs et ${uniqueGroups.length} groupes\\.\\.\\.\n` +
                       `Total des destinataires : ${totalTargets}`, 
                       { parse_mode: 'MarkdownV2' });

        // Diffusion aux utilisateurs privés
        for (const targetUser of users) {
            try {
                await ctx.telegram.sendMessage(targetUser.user_id, message);
                successCount++;
                console.log(`✅ Message envoyé à l'utilisateur ${targetUser.user_id}`);
            } catch (e) {
                console.error(`Erreur de diffusion utilisateur ${targetUser.user_id}:`, e.message);
                errorCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 150)); // Délai plus long
        }

        // Diffusion aux groupes
        for (const group of uniqueGroups) {
            try {
                const escapedMessage = Utils.escapeMarkdownV2(message);
                await ctx.telegram.sendMessage(group.chat_id, `📢 *Message de l'administrateur :*\n\n${escapedMessage}`, 
                    { parse_mode: 'MarkdownV2' });
                successCount++;
                console.log(`✅ Message envoyé au groupe ${group.chat_id}`);
            } catch (e) {
                console.error(`Erreur de diffusion groupe ${group.chat_id}:`, e.message);
                // Essayer sans formatting en cas d'erreur de parsing
                try {
                    await ctx.telegram.sendMessage(group.chat_id, `📢 Message de l'administrateur :\n\n${message}`);
                    successCount++;
                } catch (e2) {
                    errorCount++;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 150)); // Délai plus long
        }

        await ctx.reply(
            `✅ *Diffusion terminée \\!*\n\n` +
            `👍 Succès : *${successCount}*\n` +
            `❌ Échecs : *${errorCount}*\n` +
            `📊 Total : *${totalTargets}*`,
            { parse_mode: 'MarkdownV2' }
        );
    }

    async viewUserCommand(ctx) {
        const user = await db.getOrCreateUser(ctx);
        if (!user.is_admin) {
            await ctx.reply('⛔️ Accès refusé');
            return;
        }

        const args = ctx.message.text.split(' ');
        if (args.length < 2) {
            await ctx.reply('ℹ️ Usage: /viewuser [user_id]');
            return;
        }

        const targetUserId = parseInt(args[1]);
        if (isNaN(targetUserId)) {
            await ctx.reply('❌ ID utilisateur invalide');
            return;
        }

        try {
            const targetUser = await db.getUser(targetUserId);
            if (!targetUser) {
                await ctx.reply('❌ Utilisateur introuvable dans la base de données');
                return;
            }

            // Récupérer les statistiques de l'utilisateur
            const userStats = await db.query(`
                SELECT 
                    (SELECT COUNT(*) FROM verses WHERE created_by = ?) as verses_created,
                    (SELECT COUNT(*) FROM flashcards WHERE created_by = ?) as flashcards_created,
                    (SELECT COUNT(*) FROM quiz_questions WHERE created_by = ?) as quiz_questions_created,
                    (SELECT COUNT(*) FROM blind_tests WHERE created_by = ?) as blind_tests_created,
                    (SELECT COUNT(*) FROM srs_reviews WHERE user_id = ?) as srs_items,
                    (SELECT COUNT(*) FROM user_downloads WHERE user_id = ? AND date = date('now')) as downloads_today
            `, [targetUserId, targetUserId, targetUserId, targetUserId, targetUserId, targetUserId]);

            const stats = userStats[0] || {};

            const userInfo = 
                `👤 *Informations utilisateur*\n\n` +
                `🆔 ID : \`${targetUser.user_id}\`\n` +
                `👤 Nom : ${Utils.escapeMarkdown(targetUser.first_name || 'N/A')} ${Utils.escapeMarkdown(targetUser.last_name || '')}\n` +
                `📝 Username : ${targetUser.username ? `@${Utils.escapeMarkdown(targetUser.username)}` : 'N/A'}\n` +
                `👑 Admin : ${targetUser.is_admin ? 'Oui' : 'Non'}\n` +
                `📅 Dernière activité : ${Utils.escapeMarkdown(new Date(targetUser.last_active).toLocaleString('fr-FR'))}\n\n` +
                `📊 *Statistiques :*\n` +
                `📚 Versets créés : ${stats.verses_created || 0}\n` +
                `🖼 Flashcards créées : ${stats.flashcards_created || 0}\n` +
                `📝 Questions quiz : ${stats.quiz_questions_created || 0}\n` +
                `🎧 Blind tests : ${stats.blind_tests_created || 0}\n` +
                `🧠 Éléments SRS : ${stats.srs_items || 0}\n` +
                `⬇️ Téléchargements aujourd'hui : ${stats.downloads_today || 0}`;

            await ctx.reply(userInfo, { parse_mode: 'MarkdownV2' });

        } catch (err) {
            console.error('Erreur viewuser:', err);
            await ctx.reply(`❌ Erreur lors de la récupération des informations : ${Utils.escapeMarkdown(err.message)}`);
        }
    }

    launch() {
        // Démarrer le bot directement
        this.bot.launch().then(() => {
            console.log('🤖 CDSanimeBase avec SRS opérationnel!');
            this.bot.telegram.sendMessage(
                CONFIG.ADMIN_ID, 
                '🚀 CDSanimeBase avec système SRS démarré avec succès\\!',
                { parse_mode: 'MarkdownV2' }
            ).catch(err => console.log('Erreur notification admin:', err.message));
        }).catch(err => {
            console.error('Erreur lors du lancement du bot:', err.message);
            // Retry après 5 secondes si échec
            setTimeout(() => {
                console.log('Tentative de redémarrage...');
                this.launch();
            }, 5000);
        });

        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
    }
}

// =============================================
// LANCEMENT DE L'APPLICATION AVEC EXTENSION SRS
// =============================================

// Keep-alive system
class KeepAlive {
    constructor(port) {
        this.port = port;
    }

    startServer() {
        const http = require('http');
        http.createServer((req, res) => {
            res.write("I'm alive");
            res.end();
        }).listen(this.port);
        console.log(`Keep-alive server started on port ${this.port}`);
    }

    startSelfPing() {
        const http = require('http'); // Import http ici aussi
        this.startServer();
        setInterval(() => {
            http.get(`http://localhost:${this.port}`, (res) => {
                if (res.statusCode === 200) {
                    console.log('Self ping successful');
                } else {
                    console.error(`Self ping failed with status code: ${res.statusCode}`);
                }
                res.resume(); // Consume response data to free up memory
            }).on('error', (err) => {
                console.error('Error during self ping:', err.message);
            });
        }, 5 * 60 * 1000); // Ping every 5 minutes
    }
}

// Démarrage du système keep-alive
const keepAlive = new KeepAlive(process.env.PORT || 3000);
keepAlive.startSelfPing(); // Auto-ping toutes les 5 minutes

// Démarrage immédiat du bot
const botManager = new SRSBotManagerExtension();

// Gestion gracieuse de l'arrêt
process.on('SIGTERM', () => {
    console.log('🛑 Arrêt gracieux du bot...');
    botManager.bot.stop('SIGTERM');
});

process.on('SIGINT', () => {
    console.log('🛑 Arrêt gracieux du bot...');
    botManager.bot.stop('SIGINT');
    process.exit(0);
});

// Démarrage du bot
botManager.launch();
