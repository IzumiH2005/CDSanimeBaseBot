
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

        // Détection si on est sur Render
        this.isRender = this.detectRenderEnvironment();
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
            // Si pas sur Render, utiliser headers basiques
            return {
                'User-Agent': this.userAgents[0]
            };
        }

        // Headers avancés pour masquer Render
        const maskedHeaders = {
            ...this.baseHeaders,
            'User-Agent': this.getRandomUserAgent(),
            'X-Forwarded-For': this.generateFakeIP(),
            'X-Real-IP': this.generateFakeIP(),
            'CF-Connecting-IP': this.generateFakeIP(),
            'X-Client-IP': this.generateFakeIP(),
            'Referer': this.getRandomReferer(),
            'Origin': this.getRandomOrigin()
        };

        // Ajouter quelques headers aléatoires supplémentaires
        if (Math.random() > 0.5) {
            maskedHeaders['X-Requested-With'] = 'XMLHttpRequest';
        }

        if (Math.random() > 0.7) {
            maskedHeaders['Pragma'] = 'no-cache';
        }

        return maskedHeaders;
    }

    /**
     * Génère une IP aléatoire plausible
     */
    generateFakeIP() {
        // Générer des IP dans des plages publiques courantes
        const ranges = [
            () => `${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
            () => `203.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
            () => `185.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`,
            () => `94.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}.${Math.floor(Math.random() * 254) + 1}`
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
     * Vérifie si le masquage est actif
     */
    isMaskingActive() {
        return this.isRender;
    }
}

module.exports = ProxyUtils;
