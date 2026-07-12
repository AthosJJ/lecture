# Lecture — Ma bibliothèque

PWA installable de suivi de lecture : livres et articles, notes, citations avec numéro de page, progression, statistiques. 100 % vanilla (HTML/CSS/JS), sans backend ni dépendance — toutes les données restent sur l'appareil (IndexedDB).

## Fonctionnalités

- **Bibliothèque** classée par statut (en cours / à lire / terminé) avec barre de progression, recherche globale (titres, auteurs, notes **et** citations) et filtre par tag.
- **Fiche livre** : onglets Notes / Citations, mise à jour rapide de la page courante (−, +, +10), note sur 5 étoiles, dates de début/fin, tags, type livre ou article.
- **Citations** : chacune avec son numéro de page et ses tags ; vue « toutes mes citations » filtrable par livre ou par tag, affichée en serif élégant.
- **Dictée vocale** : sur iOS, le bouton « Dicter » ouvre le clavier et guide vers son micro — c'est la dictée d'Apple, sur l'appareil, qui marche hors ligne (l'API web de dictée est bloquée par Apple dans les web apps installées, [bug WebKit #225298](https://bugs.webkit.org/show_bug.cgi?id=225298), et instable dans Safari iOS). Sur Android/desktop, reconnaissance Web Speech directe.
- **Scan de texte (OCR)** : sur iOS, deux voies au choix — **« Scanner le texte » d'Apple** via l'appareil photo (recommandé : c'est l'OCR natif d'iOS, il écrit directement dans le champ), ou reconnaissance intégrée depuis une photo de la galerie (Tesseract.js embarqué, binarisation adaptative, lignes sélectionnables une à une, 100 % sur l'appareil et hors ligne).
- **Statistiques** : compteurs par statut, pages lues, livres terminés par année, note moyenne.
- **Exports** : notes & citations en Markdown (bibliothèque entière ou fiche seule), sauvegarde/restauration complète en JSON. Sur iPhone, l'export passe par la feuille de partage native.
- **Hors ligne complet** : service worker avec mise en cache de l'app shell ; mode sombre automatique ; interface mobile-first au format iPhone (zones sûres, barre d'onglets translucide).

## Déploiement sur GitHub Pages

Tous les chemins sont relatifs : l'app fonctionne servie depuis un sous-chemin.

1. Dans le dépôt : **Settings → Pages → Source : Deploy from a branch**, choisir la branche et le dossier `/ (root)`.
2. Ouvrir `https://<utilisateur>.github.io/<repo>/`.

Après chaque mise à jour, incrémenter `VERSION` dans `sw.js` pour invalider le cache. Sur l'appareil, le bouton **Rechercher une mise à jour** (écran Stats → Données) force la récupération de la nouvelle version.

## Installation sur iPhone (iOS 16.4+)

1. Ouvrir l'URL dans **Safari**.
2. Partager → **Sur l'écran d'accueil**.
3. L'app se lance en plein écran et fonctionne hors ligne.

> Les données vivent dans IndexedDB sur l'appareil. iOS peut purger le stockage d'une web app longtemps inutilisée : pensez à faire une sauvegarde JSON de temps en temps (écran Stats → Données).

## Application iOS native (dossier `ios/`)

Le dépôt contient aussi **Lecture pour iOS**, une app native SwiftUI complète (iOS 17+) avec les mêmes écrans et données, plus les moteurs natifs d'Apple :

- **Dictée** : `SFSpeechRecognizer` en français, sur l'appareil quand c'est possible ;
- **Scanner caméra** : `DataScannerViewController` de VisionKit (le scanner de texte de l'app Notes) — visez la page, touchez le texte surligné ;
- **OCR photo** : Vision (`VNRecognizeTextRequest`) sur les photos de la galerie, lignes sélectionnables ;
- **Migration** : la sauvegarde JSON est au même format que la PWA — exportez depuis la PWA (Stats → Sauvegarder tout), envoyez le fichier sur l'iPhone, importez dans l'app (Stats → Restaurer).

### Compiler et installer (Mac requis)

1. Installer **Xcode 16 ou plus récent** (Mac App Store).
2. Ouvrir `ios/Lecture.xcodeproj`.
3. Cible « Lecture » → onglet **Signing & Capabilities** → choisir votre **Team** (votre identifiant Apple suffit ; Xcode crée un profil personnel).
4. Si besoin, changer le **Bundle Identifier** (`com.athosjj.lecture`) pour un identifiant unique à vous.
5. Brancher l'iPhone (ou le connecter en Wi-Fi), le sélectionner comme destination, puis **Run** (⌘R).
6. Sur l'iPhone, la première fois : Réglages → Général → VPN et gestion de l'appareil → faire confiance à votre certificat de développeur.

> Sans compte Apple Developer payant (99 €/an), l'app installée expire au bout de 7 jours — il suffit de relancer Run depuis Xcode pour la réinstaller. Avec un compte payant, l'app peut être signée pour un an ou distribuée via TestFlight.

## Structure

```
index.html        Coque de l'app (écrans, feuilles modales, barre d'onglets)
styles.css        Design système : variables, mode sombre, animations
app.js            Logique : routage par hash, rendu, formulaires, exports
db.js             Couche IndexedDB (books / notes / quotes)
sw.js             Service worker (cache de l'app shell)
manifest.json     Manifeste PWA
icons/            Icônes PNG (180, 192, 512, maskable)
vendor/tesseract/ Moteur OCR local (Tesseract.js 5 + modèle français « fast »)
tools/make-icons.mjs   Régénère les icônes : node tools/make-icons.mjs
```
