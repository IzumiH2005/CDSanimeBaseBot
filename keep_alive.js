const http = require("http");
const express = require("express");

class KeepAlive {
    constructor(port = 3000) {
        this.port = port;
        this.app = express();
        this.setupRoutes();
        this.startServer();
    }

    setupRoutes() {
        // Route de santé pour vérifier que le bot est actif
        this.app.get("/", (req, res) => {
            res.json({
                status: "alive",
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                bot: "CDSanimeBase Bot",
                version: "2.0.0",
            });
        });

        // Route de ping pour les services de monitoring
        this.app.get("/ping", (req, res) => {
            res.send("pong");
        });

        // Route de santé détaillée
        this.app.get("/health", (req, res) => {
            res.json({
                status: "healthy",
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: new Date().toISOString(),
                environment: process.env.NODE_ENV || "production",
            });
        });

        // Route pour les stats basiques
        this.app.get("/stats", (req, res) => {
            res.json({
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                timestamp: new Date().toISOString(),
            });
        });
    }

    startServer() {
        this.server = this.app.listen(this.port, "0.0.0.0", () => {
            console.log(`🌐 Keep-alive server running on port ${this.port}`);
            console.log(
                `🔗 Health check: http://localhost:${this.port}/health`,
            );
        });

        // Gestion gracieuse de l'arrêt
        process.on("SIGTERM", () => {
            console.log("🛑 Arrêt gracieux du serveur keep-alive...");
            this.server.close(() => {
                console.log("✅ Serveur keep-alive arrêté");
            });
        });

        process.on("SIGINT", () => {
            console.log("🛑 Arrêt gracieux du serveur keep-alive...");
            this.server.close(() => {
                console.log("✅ Serveur keep-alive arrêté");
                process.exit(0);
            });
        });
    }

    // Méthode pour effectuer un auto-ping (optionnel)
    startSelfPing(interval = 5 * 60 * 1000) {
        // 5 minutes par défaut
        setInterval(() => {
            http.get(`http://localhost:${this.port}/ping`, (res) => {
                console.log(`🏓 Self-ping: ${res.statusCode}`);
            }).on("error", (err) => {
                console.error("❌ Erreur self-ping:", err.message);
            });
        }, interval);
    }
}

module.exports = KeepAlive;
