
# 🤖 CDSanimeBase Bot

**Bot Telegram avancé pour flashcards, quiz et blind tests d'anime avec système SRS et téléchargeur YouTube**

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/username/cdsanimebase-bot)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram%20Bot%20API-Latest-blue.svg)](https://core.telegram.org/bots/api)

## 📖 Description

CDSanimeBase est un bot Telegram sophistiqué conçu pour les passionnés d'anime qui souhaitent tester et améliorer leurs connaissances. Il combine un système de flashcards intelligent, des quiz interactifs, des blind tests audio, et un système de révision espacée (SRS) pour une mémorisation optimale.

### ✨ Fonctionnalités principales

- 🗂️ **Organisation par versets thématiques** - Classez vos contenus par anime, personnages, etc.
- 🖼️ **Flashcards interactives** - Reconnaissance d'images avec timer et scoring
- 🎧 **Blind tests audio** - Devinez les titres de musiques d'anime
- 📝 **Quiz questions** - Questions textuelles avec alternatives et explications
- 👥 **Mode multijoueur** - Sessions de groupe avec tableaux des scores
- 🧠 **Système SRS** - Révisions espacées intelligentes pour optimiser la mémorisation
- ⏰ **Rappels automatiques** - Notifications quotidiennes personnalisées
- 🎬 **Téléchargeur YouTube** - Extraction audio/vidéo avec limites quotidiennes
- 📊 **Statistiques détaillées** - Suivi des performances et progression

## 🚀 Installation

### Prérequis

- Node.js >= 18.0.0
- Un bot Telegram (token obtenu via [@BotFather](https://t.me/BotFather))
- FFmpeg pour le traitement audio/vidéo

### Installation rapide

1. **Cloner le projet**
   ```bash
   git clone https://github.com/username/cdsanimebase-bot.git
   cd cdsanimebase-bot
   ```

2. **Installer les dépendances**
   ```bash
   npm install
   ```

3. **Configuration**
   - Ouvrez `index.js`
   - Remplacez `CONFIG.TOKEN` par votre token de bot Telegram
   - Remplacez `CONFIG.ADMIN_ID` par votre ID utilisateur Telegram

4. **Lancer le bot**
   ```bash
   npm start
   ```

## ⚙️ Configuration

### Variables de configuration principales

```javascript
const CONFIG = {
    TOKEN: 'VOTRE_BOT_TOKEN',           // Token du bot Telegram
    ADMIN_ID: VOTRE_USER_ID,            // ID administrateur
    FLASHCARD_TIMEOUT: 10000,           // Timeout flashcards (ms)
    QUIZ_TIMEOUT: 20000,                // Timeout quiz (ms)
    DAILY_REMINDER: '0 18 * * *',       // Heure des rappels (18h)
    SRS_MAX_ITEMS: 20,                  // Items max par session SRS
    MAX_DAILY_DOWNLOADS: 5,             // Limite téléchargements/jour
    AUDIO_QUALITY: '320k',              // Qualité audio YouTube
    VIDEO_QUALITY: '720p'               // Qualité vidéo YouTube
};
```

### Structure des répertoires

```
cdsanimebase-bot/
├── cdn/
│   ├── images/          # Images des flashcards
│   └── thumbnails/      # Miniatures optimisées
├── database/
│   └── cdsanimebase.db  # Base de données SQLite
├── temp/                # Fichiers temporaires YouTube
├── index.js             # Fichier principal
└── package.json
```

## 🎮 Utilisation

### Commandes utilisateur

#### 📚 Gestion des versets
- `/setverse` - Créer un nouveau thème
- `/deleteverse` - Supprimer un thème
- `/listverses` - Lister tous les thèmes

#### 🖼️ Flashcards
- `/addflashcard` - Ajouter une flashcard avec image
- `/playflashcards` - Session privée de flashcards
- `/listflashcards [verset]` - Lister les flashcards
- `/deleteflashcard [id]` - Supprimer une flashcard

#### 🎧 Blind Tests
- `/addblindtest` - Ajouter un blind test audio
- `/playblindtest` - Session privée de blind test
- `/listblindtests [verset]` - Lister les blind tests
- `/deleteblindtest [id]` - Supprimer un blind test

#### 📝 Quiz Questions
- `/addquizquestion` - Ajouter une question de quiz
- `/editquizquestion` - Modifier alternatives/explications
- `/playquiz` - Session privée de quiz
- `/deletequizquestion` - Supprimer une question
- `/listquizquestions [verset]` - Lister les questions

#### 👥 Sessions de groupe
- `/groupquiz` - Quiz flashcards en groupe
- `/groupblindtest` - Blind test en groupe
- `/groupquizquestion` - Quiz questions en groupe
- `/endsession` - Terminer la session (admin)

#### 🧠 Système SRS
- `/review` - Démarrer une session de révision
- `/addtosrs` - Ajouter des éléments au SRS
- `/srsstats` - Statistiques de révision

#### 🎬 YouTube Downloader
- `/youtube` - Télécharger vidéo/audio YouTube
- `/mydownloads` - Voir les téléchargements restants

#### 📊 Statistiques
- `/stats` - Vos statistiques personnelles
- `/resume` - Reprendre la dernière session

### Commandes administrateur

- `/admin` - Panel d'administration
- `/broadcast [message]` - Diffuser un message à tous les utilisateurs

## 🏗️ Architecture technique

### Base de données

Le bot utilise SQLite avec les tables principales :

- **verses** - Thèmes/versets
- **flashcards** - Flashcards avec images
- **blind_tests** - Tests audio
- **quiz_questions** - Questions de quiz
- **users** - Utilisateurs et permissions
- **srs_reviews** - Système de révision espacée
- **user_downloads** - Suivi des téléchargements YouTube

### Système SRS (Spaced Repetition System)

Implémentation de l'algorithme SM-2 pour optimiser la mémorisation :

- **Intervalles adaptatifs** - Espacement intelligent des révisions
- **Facteur d'aisance** - Ajustement selon les performances
- **Rappels automatiques** - Notifications quotidiennes personnalisées

### Sécurité et limites

- ✅ Validation des permissions utilisateur
- ✅ Limitation des téléchargements quotidiens
- ✅ Timeout sur les téléchargements YouTube
- ✅ Nettoyage automatique des fichiers temporaires
- ✅ Échappement HTML/Markdown pour la sécurité

## 🤝 Contribution

Les contributions sont les bienvenues ! Voici comment contribuer :

1. **Fork** le projet
2. **Créer** une branche pour votre fonctionnalité (`git checkout -b feature/nouvelle-fonctionnalite`)
3. **Commiter** vos changements (`git commit -am 'Ajout nouvelle fonctionnalité'`)
4. **Pousser** vers la branche (`git push origin feature/nouvelle-fonctionnalite`)
5. **Créer** une Pull Request

### Guidelines de développement

- Suivre les conventions de nommage JavaScript
- Commenter le code pour les fonctionnalités complexes
- Tester les nouvelles fonctionnalités avant soumission
- Respecter la structure modulaire existante

## 📝 Changelog

### Version 2.0.0 (Actuelle)
- ✅ Ajout du système SRS (Spaced Repetition System)
- ✅ Intégration YouTube Downloader Pro
- ✅ Quiz questions avec alternatives et explications
- ✅ Amélioration du système de scoring groupe
- ✅ Rappels automatiques quotidiens
- ✅ Interface administrateur étendue

### Version 1.x.x
- ✅ Système de flashcards de base
- ✅ Blind tests audio
- ✅ Sessions de groupe
- ✅ Base de données SQLite

## 🐛 Résolution de problèmes

### Problèmes courants

**Q: Le bot ne répond pas aux commandes**
- Vérifiez que le token est correct
- Assurez-vous que le bot est démarré avec `/start`

**Q: Erreur de téléchargement YouTube**
- Vérifiez votre connexion internet
- La vidéo peut être géo-restreinte ou privée
- Vérifiez que vous n'avez pas atteint la limite quotidienne

**Q: Les images ne s'affichent pas**
- Vérifiez les permissions du dossier `cdn/`
- Assurez-vous que Sharp est correctement installé

**Q: Base de données corrompue**
- Supprimez le fichier `database/cdsanimebase.db`
- Redémarrez le bot pour recréer la base

### Logs et debugging

Activez les logs détaillés en ajoutant au début d'`index.js` :
```javascript
process.env.NODE_ENV = 'development';
console.log('Mode debug activé');
```

## 📄 Licence

Ce projet est sous licence MIT. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 👨‍💻 Auteur

**Izumi Hearthcliff / Kageo**
- Telegram: [@kageonightray](https://t.me/kageonightray)
- GitHub: [@votre-username](https://github.com/votre-username)

## 🙏 Remerciements

- [Telegraf.js](https://telegraf.js.org/) - Framework bot Telegram
- [ytdl-core](https://github.com/fent/node-ytdl-core) - YouTube downloader
- [Sharp](https://sharp.pixelplumbing.com/) - Traitement d'images
- [FFmpeg](https://ffmpeg.org/) - Traitement audio/vidéo
- [SQLite](https://www.sqlite.org/) - Base de données

## 📞 Support

Pour toute question ou suggestion :
- Ouvrir une [issue](https://github.com/username/cdsanimebase-bot/issues)
- Contacter [@kageonightray](https://t.me/kageonightray) sur Telegram
- Consulter la documentation dans le code source

---

⭐ **N'hésitez pas à mettre une étoile si ce projet vous aide !** ⭐
