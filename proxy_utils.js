
const crypto = require('crypto');

/**
 * Utilitaires pour masquer la provenance des requêtes YouTube sur Render
 */
class ProxyUtils {
    constructor() {
        // Liste de User-Agents rotatifs pour masquer l'origine
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
        ];

        // Headers additionnels pour masquer l'origine
        this.baseHeaders = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9,fr;q=0.8,es;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
        };

        // Cookies YouTube pour contourner la vérification
        this.youtubeCookies = this.loadYoutubeCookies();

        // Agent ytdl pour les cookies
        this.ytdlAgent = null;
        this.createYtdlAgent();

        // Détection si on est sur Render
        this.isRender = this.detectRenderEnvironment();
    }

    /**
     * Charge les cookies YouTube depuis le fichier au format ytdl agent
     */
    loadYoutubeCookies() {
        const fs = require('fs');
        const path = require('path');
        
        try {
            // Utiliser directement le fichier youtube_cookies.txt à la racine
            const cookieFile = path.join(__dirname, 'youtube_cookies.txt');
            
            if (!fs.existsSync(cookieFile)) {
                this.logMasking('cookies', 'Aucun fichier de cookies trouvé');
                return [];
            }
            
            const cookieContent = fs.readFileSync(cookieFile, 'utf8');
            const cookieArray = this.parseCookieFileToArray(cookieContent);
            this.logMasking('cookies chargés', `${cookieArray.length} cookies`);
            return cookieArray;
        } catch (error) {
            this.logMasking('erreur cookies', error.message);
            return [];
        }
    }

    /**
     * Parse le fichier de cookies Netscape vers un array d'objets pour ytdl agent
     */
    parseCookieFileToArray(content) {
        const lines = content.split('\n');
        const cookies = [];
        
        for (const line of lines) {
            // Ignorer les commentaires et lignes vides
            if (line.startsWith('#') || !line.trim()) continue;
            
            const parts = line.split('\t');
            if (parts.length >= 7) {
                const name = parts[5];
                const value = parts[6];
                
                // Filtrer les cookies essentiels pour l'authentification
                const essentialCookies = [
                    'SID', '__Secure-1PSID', '__Secure-3PSID',
                    'HSID', 'SSID', 'APISID', 'SAPISID',
                    '__Secure-1PAPISID', '__Secure-3PAPISID',
                    'LOGIN_INFO', 'VISITOR_INFO1_LIVE',
                    '__Secure-1PSIDTS', '__Secure-3PSIDTS',
                    'SIDCC', '__Secure-1PSIDCC', '__Secure-3PSIDCC',
                    'YSC', 'VISITOR_PRIVACY_METADATA', '__Secure-ROLLOUT_TOKEN',
                    'PREF'
                ];
                
                if (essentialCookies.includes(name)) {
                    cookies.push({ name, value });
                }
            }
        }
        
        return cookies;
    }

    /**
     * Détecte si l'application s'exécute sur Render
     */
    detectRenderEnvironment() {
        const renderIndicators = [
            process.env.RENDER,
            process.env.RENDER_SERVICE_ID,
            process.env.RENDER_SERVICE_NAME,
            process.env.RENDER_EXTERNAL_URL,
            process.platform === 'linux' && process.env.HOME === '/opt/render'
        ];

        return renderIndicators.some(indicator => !!indicator);
    }

    /**
     * Génère un User-Agent aléatoire
     */
    getRandomUserAgent() {
        const randomIndex = Math.floor(Math.random() * this.userAgents.length);
        return this.userAgents[randomIndex];
    }

    /**
     * Génère des headers masqués pour les requêtes YouTube
     */
    getMaskedHeaders() {
        if (!this.isRender) {
            // Si pas sur Render, utiliser headers basiques avec cookies
            const headers = {
                'User-Agent': this.userAgents[0]
            };
            
            if (this.youtubeCookies) {
                headers['Cookie'] = this.youtubeCookies;
            }
            
            return headers;
        }

        // Rotation intelligente pour éviter la détection de patterns
        this.requestCounter = (this.requestCounter || 0) + 1;

        // Headers ultra-avancés avec rotation basée sur le compteur de requêtes
        const fakeIP = this.generateFakeIP();
        const rotatedUserAgent = this.userAgents[this.requestCounter % this.userAgents.length];
        
        const maskedHeaders = {
            ...this.baseHeaders,
            'User-Agent': rotatedUserAgent,
            
            // Headers IP multiples pour confusion
            'X-Forwarded-For': `${this.generateFakeIP()}, ${fakeIP}, ${this.generateFakeIP()}`,
            'X-Real-IP': fakeIP,
            'CF-Connecting-IP': fakeIP,
            'X-Client-IP': fakeIP,
            'X-Originating-IP': this.generateFakeIP(),
            'X-Remote-IP': this.generateFakeIP(),
            'X-Remote-Addr': fakeIP,
            'True-Client-IP': fakeIP,
            
            // Headers de navigation réalistes
            'Referer': this.getRandomReferer(),
            'Origin': this.getRandomOrigin(),
            
            // Headers anti-détection avancés
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-Host': 'www.youtube.com',
            'X-Original-Host': 'www.youtube.com',
            'CF-Ray': this.generateCloudflareRay(),
            'CF-IPCountry': this.getRandomCountry(),
            'CF-Visitor': '{"scheme":"https"}',
            
            // Headers de session réalistes
            'Sec-CH-UA': this.getRandomSecCHUA(),
            'Sec-CH-UA-Mobile': '?0',
            'Sec-CH-UA-Platform': this.getRandomPlatform(),
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Dest': 'empty',
            
            // Headers temporels
            'If-None-Match': this.generateETag(),
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        };

        // Ajouter les cookies YouTube pour l'authentification
        if (this.youtubeCookies) {
            maskedHeaders['Cookie'] = this.youtubeCookies;
            this.logMasking('cookies ajoutés', 'Authentification YouTube activée');
        }

        // Rotation aléatoire de headers supplémentaires
        const optionalHeaders = {
            'X-Requested-With': 'XMLHttpRequest',
            'X-CSRF-Token': this.generateCSRFToken(),
            'X-Request-ID': this.generateRequestId(),
            'X-Session-ID': this.generateSessionId(),
            'X-Device-ID': this.generateDeviceId(),
            'X-Browser-Version': this.getBrowserVersion(),
            'X-OS-Version': this.getOSVersion(),
            'X-Screen-Resolution': this.getScreenResolution(),
            'X-Timezone': this.getRandomTimezone(),
            'X-Language': this.getRandomLanguage()
        };

        // Ajouter 3-5 headers optionnels aléatoirement
        const optionalKeys = Object.keys(optionalHeaders);
        const numOptional = Math.floor(Math.random() * 3) + 3;
        for (let i = 0; i < numOptional; i++) {
            const key = optionalKeys[Math.floor(Math.random() * optionalKeys.length)];
            if (!maskedHeaders[key]) {
                maskedHeaders[key] = optionalHeaders[key];
            }
        }

        return maskedHeaders;
    }

    /**
     * Génère une IP aléatoire plausible
     */
    generateFakeIP() {
        // Générer des IP dans des plages de FAI réels pour plus de crédibilité
        const ranges = [
            // Plages Orange France
            () => `90.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
            // Plages SFR/Free
            () => `82.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
            // Plages Verizon/AT&T (US)
            () => `73.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
            // Plages Comcast (US)
            () => `98.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
            // Plages Deutsche Telekom
            () => `91.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
            // Plages Bell Canada
            () => `142.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`
        ];

        const randomRange = ranges[Math.floor(Math.random() * ranges.length)];
        return randomRange();
    }

    /**
     * Génère un referer aléatoire
     */
    getRandomReferer() {
        const referers = [
            'https://www.google.com/',
            'https://www.youtube.com/',
            'https://music.youtube.com/',
            'https://www.bing.com/',
            'https://duckduckgo.com/',
            'https://www.reddit.com/',
            'https://twitter.com/',
            'https://www.facebook.com/'
        ];

        return referers[Math.floor(Math.random() * referers.length)];
    }

    /**
     * Génère une origine aléatoire
     */
    getRandomOrigin() {
        const origins = [
            'https://www.youtube.com',
            'https://music.youtube.com',
            'https://m.youtube.com',
            'https://youtube.com'
        ];

        return origins[Math.floor(Math.random() * origins.length)];
    }

    /**
     * Ajoute un délai aléatoire pour éviter la détection
     */
    async addRandomDelay(minMs = 500, maxMs = 2000) {
        if (!this.isRender) return; // Pas de délai si pas sur Render

        const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Génère un session ID unique pour simuler une session utilisateur
     */
    generateSessionId() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Log discret des actions de masquage (seulement en mode debug)
     */
    logMasking(action, details = '') {
        if (process.env.NODE_ENV === 'development') {
            console.log(`🎭 Masquage ${action}: ${details}`);
        }
    }

    /**
     * Génère un Cloudflare Ray ID factice
     */
    generateCloudflareRay() {
        const chars = '0123456789abcdef';
        let ray = '';
        for (let i = 0; i < 16; i++) {
            ray += chars[Math.floor(Math.random() * chars.length)];
        }
        return ray + '-' + ['DFW', 'LAX', 'JFK', 'LHR', 'CDG', 'NRT', 'SIN'][Math.floor(Math.random() * 7)];
    }

    /**
     * Génère un pays aléatoire
     */
    getRandomCountry() {
        const countries = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'BR', 'IN', 'NL'];
        return countries[Math.floor(Math.random() * countries.length)];
    }

    /**
     * Génère un Sec-CH-UA réaliste
     */
    getRandomSecCHUA() {
        const browsers = [
            '"Google Chrome";v="120", "Chromium";v="120", "Not-A.Brand";v="99"',
            '"Microsoft Edge";v="120", "Chromium";v="120", "Not-A.Brand";v="99"',
            '"Mozilla Firefox";v="121", "Not-A.Brand";v="99"',
            '"Safari";v="17", "WebKit";v="605", "Not-A.Brand";v="99"'
        ];
        return browsers[Math.floor(Math.random() * browsers.length)];
    }

    /**
     * Génère une plateforme aléatoire
     */
    getRandomPlatform() {
        const platforms = ['"Windows"', '"macOS"', '"Linux"', '"Chrome OS"'];
        return platforms[Math.floor(Math.random() * platforms.length)];
    }

    /**
     * Génère un ETag factice
     */
    generateETag() {
        return '"' + crypto.randomBytes(16).toString('hex') + '"';
    }

    /**
     * Génère un token CSRF factice
     */
    generateCSRFToken() {
        return crypto.randomBytes(32).toString('base64');
    }

    /**
     * Génère un ID de requête
     */
    generateRequestId() {
        return 'req_' + crypto.randomBytes(16).toString('hex');
    }

    /**
     * Génère un ID de device
     */
    generateDeviceId() {
        return 'dev_' + crypto.randomBytes(12).toString('hex');
    }

    /**
     * Génère une version de navigateur
     */
    getBrowserVersion() {
        const versions = ['120.0.0.0', '119.0.0.0', '121.0.0.0', '118.0.0.0'];
        return versions[Math.floor(Math.random() * versions.length)];
    }

    /**
     * Génère une version d'OS
     */
    getOSVersion() {
        const versions = ['Windows NT 10.0', 'macOS 14.0', 'X11; Linux x86_64', 'Chrome OS 120.0'];
        return versions[Math.floor(Math.random() * versions.length)];
    }

    /**
     * Génère une résolution d'écran
     */
    getScreenResolution() {
        const resolutions = ['1920x1080', '1366x768', '1440x900', '1536x864', '1280x720'];
        return resolutions[Math.floor(Math.random() * resolutions.length)];
    }

    /**
     * Génère un timezone aléatoire
     */
    getRandomTimezone() {
        const timezones = ['America/New_York', 'Europe/London', 'Asia/Tokyo', 'America/Los_Angeles', 'Europe/Paris'];
        return timezones[Math.floor(Math.random() * timezones.length)];
    }

    /**
     * Génère une langue aléatoire
     */
    getRandomLanguage() {
        const languages = ['en-US,en;q=0.9', 'en-GB,en;q=0.9', 'fr-FR,fr;q=0.9', 'de-DE,de;q=0.9'];
        return languages[Math.floor(Math.random() * languages.length)];
    }

    /**
     * Ajoute un délai intelligent basé sur le type de requête
     */
    async addIntelligentDelay(requestType = 'standard') {
        if (!this.isRender) return;

        let minDelay, maxDelay;
        
        switch (requestType) {
            case 'search':
                minDelay = 800;
                maxDelay = 2000;
                break;
            case 'info':
                minDelay = 1500;
                maxDelay = 3500;
                break;
            case 'download':
                minDelay = 2000;
                maxDelay = 5000;
                break;
            default:
                minDelay = 500;
                maxDelay = 1500;
        }

        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        this.logMasking(`délai intelligent (${requestType})`, `${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Vérifie si le masquage est actif
     */
    isMaskingActive() {
        return this.isRender;
    }

    /**
     * Rafraîchit les cookies YouTube (utile si les cookies expirent)
     */
    refreshYoutubeCookies() {
        this.youtubeCookies = this.loadYoutubeCookies();
        this.logMasking('cookies rafraîchis', 'Nouvelle session YouTube');
    }

    /**
     * Créer l'agent ytdl avec les cookies
     */
    createYtdlAgent() {
        if (this.youtubeCookies.length > 0) {
            try {
                const ytdl = require('@distube/ytdl-core');
                
                // Convertir les cookies au format string pour ytdl-core
                const cookieString = this.youtubeCookies
                    .map(cookie => `${cookie.name}=${cookie.value}`)
                    .join('; ');
                
                // Options d'agent pour le masquage
                const agentOptions = {
                    pipelining: 5,
                    maxRedirections: 10,
                    // Pas de localAddress pour éviter les problèmes sur Render
                };

                this.ytdlAgent = ytdl.createAgent(cookieString, agentOptions);
                this.logMasking('agent ytdl', `Agent créé avec ${this.youtubeCookies.length} cookies`);
            } catch (error) {
                this.logMasking('erreur agent ytdl', error.message);
                this.ytdlAgent = null;
            }
        } else {
            this.logMasking('agent ytdl', 'Aucun cookie, agent non créé');
        }
    }

    /**
     * Obtenir l'agent ytdl configuré
     */
    getYtdlAgent() {
        return this.ytdlAgent;
    }

    /**
     * Rafraîchit les cookies et recrée l'agent
     */
    refreshYoutubeCookies() {
        this.youtubeCookies = this.loadYoutubeCookies();
        this.createYtdlAgent();
        this.logMasking('cookies rafraîchis', 'Nouvel agent créé');
    }

    /**
     * Vérifie si les cookies sont chargés
     */
    hasCookies() {
        return this.youtubeCookies && this.youtubeCookies.length > 0;
    }

    /**
     * Vérifie si l'agent ytdl est disponible
     */
    hasYtdlAgent() {
        return this.ytdlAgent !== null;
    }
}

module.exports = ProxyUtils;
