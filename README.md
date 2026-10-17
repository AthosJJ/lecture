# Lecture — Ma bibliothèque

PWA installable de suivi de lecture : livres, articles et podcasts, notes, citations avec numéro de page, mots et expressions à retenir avec leur définition, progression, statistiques. Chacun se connecte avec son e-mail et retrouve ses données sur tous ses appareils, iPhone comme Android ; l'app fonctionne hors connexion et se synchronise au retour du réseau. HTML, CSS et JavaScript vanilla, sans étape de build, hébergé sur GitHub Pages ; comptes et données avec Firebase (forfait gratuit Spark), dans le même projet qu'À tester.

## Fonctionnalités

- **Compte** : création, connexion, mot de passe oublié (e-mail avec lien de retour vers l'app) et déconnexion, par e-mail et mot de passe uniquement — un compte À tester se connecte avec les mêmes identifiants. La session reste ouverte d'une ouverture à l'autre. À la déconnexion, l'appareil efface sa copie des données et les brouillons (après avoir prévenu si des changements n'ont pas encore été envoyés).
- **Synchronisation** : chaque modification s'affiche tout de suite et part en arrière-plan ; hors connexion, elle attend le réseau. Un changement fait sur un autre appareil apparaît tout seul. L'état (« À jour », « Hors connexion »…) se lit dans les réglages.
- **Passage depuis la version 13** : « Importer mes données locales » (en haut de la bibliothèque et dans les réglages, visible seulement s'il reste des données dans l'ancien stockage) envoie tout dans le compte sans créer de doublon, même relancé, vérifie sur le serveur que tout y est, puis propose de vider l'ancien stockage.
- **Bibliothèque** classée par statut (en cours / à lire / terminé) avec barre de progression, recherche globale (titres, auteurs, notes **et** citations) et filtre par tag.
- **Citation rapide** : le **+** en haut à droite de l'onglet Citations ouvre directement la citation du livre en cours ; s'il y en a plusieurs, on choisit le livre d'un toucher.
- **Fiche livre** : boutons « Citation », « Note » et « Mot » toujours visibles en bas, onglets Citations / Notes / Mots avec compteurs, mise à jour rapide de la page courante (−, +, +10), nombre de pages réglable directement sur la fiche, note sur 5 étoiles, dates, tags.
- **Citations** : page pré-remplie avec la page où l'on en est (une citation plus loin fait avancer la progression), tags suggérés d'un toucher, vue « toutes mes citations » filtrable par livre ou par tag, affichée en serif élégant.
- **Mots** : les mots ou expressions inconnus se notent comme une citation (livre, page, phrase de contexte). Pendant la frappe, des **suggestions** de mots s'affichent (et « Ajouter « … » » quand rien ne correspond) ; la **définition s'affiche toute seule** et reste disponible hors ligne ; un mot noté sans réseau la reçoit au retour de la connexion. Formes fléchies et verbes conjugués renvoient au mot de base (« obnubilait » → « obnubiler »), et une faute de frappe propose l'orthographe probable. Onglet **Mots** : recherche (mot, définition, contexte), tri par date (récents / anciens), **A → Z / Z → A** avec lettres, ou par livre, filtre par livre, export du lexique en Markdown.
  - **Depuis une citation** : « Choisir dans une citation » dans la fiche d'un mot, « Noter un mot de cette citation » dans une citation, ou « Noter un mot » juste après en avoir enregistré une : on touche le mot (deux mots pour une expression), la phrase devient le contexte, le livre et la page suivent.
  - **Source des définitions** : le Wiktionnaire, seul grand dictionnaire français qui autorise une app à l'interroger (le CNRTL, Larousse et Le Robert n'offrent pas d'accès pour les applications). Chaque mot a un bouton **CNRTL** qui l'ouvre directement sur le site du CNRTL. Pour garder la définition du CNRTL : la copier sur le site, puis toucher **Coller** dans la fiche du mot (elle est enregistrée comme « CNRTL » et n'est jamais remplacée automatiquement).
  - Le mot cherché est envoyé au Wiktionnaire (Wikimédia). Les définitions sont sous licence CC BY-SA 4.0 : « Wiktionnaire », à côté de la définition, ouvre la page d'origine (mentions complètes dans les réglages).
  - Un petit monde secret attend derrière le titre « Mots »…
- **Gestes** : toucher une note ou une citation pour la modifier, la glisser vers la gauche pour la supprimer ; les formulaires se ferment en les glissant vers le bas. Chaque suppression peut être annulée depuis le message qui s'affiche.
- **Formulaires** : « Annuler / Enregistrer » toujours visibles en haut, même clavier ouvert ; ajout de livre réduit à l'essentiel (le reste sous « Plus de détails ») ; brouillon gardé automatiquement si l'on ferme par erreur.
- **Dictée vocale** : sur iOS, le bouton « Dicter » ouvre le clavier et guide vers son micro — c'est la dictée d'Apple, sur l'appareil, qui marche hors ligne (l'API web de dictée est bloquée par Apple dans les web apps installées, [bug WebKit #225298](https://bugs.webkit.org/show_bug.cgi?id=225298), et instable dans Safari iOS). Sur Android/desktop, reconnaissance Web Speech directe.
- **Scan de texte (OCR)**, 100 % sur l'appareil et hors ligne, sur iPhone comme sur Android :
  1. « Scanner » ouvre l'appareil photo (« Galerie » pour une photo existante) ;
  2. on **encadre le passage** voulu (poignées, déplacement, « Tout ») — indispensable sur un livre ouvert, sinon les lignes des deux pages se mélangent ;
  3. le passage est lu à pleine résolution (débruitage + binarisation adaptative, modèle français Tesseract `best_int`) pendant que le moteur a démarré en arrière-plan ;
  4. on coche les lignes à garder, puis « Insérer » : lignes jointes, mots coupés en fin de ligne recollés (mots composés conservés), apostrophes typographiques.
  Sur iOS, un appui long sur l'aperçu du passage permet aussi d'en copier le texte (Live Text).
- **Statistiques** : compteurs par statut, pages lues, livres terminés par année, note moyenne.
- **Réglages** (⚙︎ en haut de Stats) : compte et état de la synchronisation, ancienne version, exports, mentions, version et « Rechercher une mise à jour ».
- **Exports** : notes, citations & mots en Markdown (bibliothèque entière, fiche seule, ou lexique alphabétique). Sauvegarde JSON facultative (les données sont déjà dans le compte) ; l'import d'un fichier JSON ajoute ou met à jour, sans doublon ni suppression. Sur iPhone, l'export passe par la feuille de partage native.
- **Hors ligne complet** : service worker avec mise en cache des fichiers de l'app, du moteur OCR et du SDK Firebase ; données servies par le cache local de Firestore ; les mises à jour s'appliquent sans jamais interrompre une saisie ; mode sombre automatique ; interface mobile-first (zones sûres, barre d'onglets translucide).

## Déploiement sur GitHub Pages

Tous les chemins sont relatifs : l'app fonctionne servie depuis un sous-chemin.

1. Dans le dépôt : **Settings → Pages → Source : Deploy from a branch**, choisir la branche `main` et le dossier `/ (root)`.
2. Ouvrir `https://<utilisateur>.github.io/<repo>/`.

Après chaque mise à jour, incrémenter `VERSION` dans `sw.js` (et `APP_VERSION` dans `app.js`) pour invalider le cache. Sur l'appareil, la mise à jour s'installe au lancement suivant ; le bouton **Rechercher une mise à jour** (Stats › Réglages) la force.

## Firebase (comptes et données)

Projet Firebase `athos-apps`, forfait gratuit Spark, partagé avec À tester : mêmes comptes, même base, mêmes règles. Rien n'exige le forfait payant (ni Cloud Functions ni Cloud Storage).

- **Configuration web** : dans `firebase.js`. Elle est publique par nature : ce sont les règles qui protègent les données.
- **SDK** : modulaire, chargé depuis le CDN officiel (`www.gstatic.com/firebasejs/13.0.0/`), même version qu'À tester. Pour en changer : `firebase.js`, `account.js`, `db.js` et la liste `SDK` de `sw.js`.
- **Authentication** : fournisseur « Adresse e-mail/Mot de passe » ; `athosjj.github.io` est déjà dans les domaines autorisés (lien de retour de l'e-mail « mot de passe oublié »).
- **Firestore** : données sous `users/{uid}/apps/lecture`, sous-collections `books`, `notes`, `quotes` et `words`, un document par élément (mêmes champs et mêmes identifiants que l'ancien stockage local). À tester range les siennes sous `users/{uid}/apps/atester` : rien ne se croise. Cache local persistant pour le hors-ligne.
- **Règles** : celles d'À tester, inchangées (`firestore.rules` de son dépôt) : chaque utilisateur connecté lit et écrit uniquement sous `users/{son uid}`, `config/` est lisible une fois connecté et jamais modifiable depuis l'app, tout le reste est refusé.
- **Clés d'API** : aucune. Les définitions viennent du Wiktionnaire (sans clé) et l'OCR tourne sur l'appareil : Lecture n'a besoin d'aucun document dans `config/`.
- **Cohabitation avec À tester** (même domaine) : Lecture utilise une instance Firebase nommée `lecture`, donc une session et un cache Firestore à elle ; son service worker a pour portée `/lecture/` et ne supprime que les caches `lecture-*` ; ses clés locales commencent par `lecture`.
- **Quota gratuit** : 50 000 lectures et 20 000 écritures par jour pour tout le projet. Chaque ouverture de l'app plus de 30 minutes après la précédente relit une fois les éléments du compte.

## Installation sur iPhone (iOS 16.4+) et Android

1. Ouvrir l'URL dans **Safari**.
2. Partager → **Sur l'écran d'accueil**.
3. L'app se lance en plein écran ; on se connecte une fois, puis elle fonctionne hors ligne.

Sur Android, ouvrir l'URL dans Chrome puis menu › **Ajouter à l'écran d'accueil** (ou **Installer l'application**).

> Les données vivent dans le compte ; l'appareil n'en garde qu'une copie pour le hors-ligne. Si iOS purge le stockage d'une web app longtemps inutilisée, il suffit de se reconnecter.

## Structure

```
index.html        Coque de l'app (connexion, écrans, feuilles modales, recadrage, barre d'onglets)
styles.css        Design système : variables, mode sombre, animations
app.js            Logique : démarrage et compte, synchronisation, routage, rendu, formulaires, gestes, OCR, import, exports
firebase.js       Initialisation Firebase (instance « lecture », session persistante, cache Firestore)
account.js        Connexion, création de compte, mot de passe oublié, déconnexion
db.js             Données du compte dans Firestore (écouteurs, écritures, effacement du cache)
legacy.js         Ancien stockage local (lecture-db), lu pour l'import puis supprimé à la demande
importer.js       Import sans doublon (ancien stockage, fichier JSON) et vérification sur le serveur
sw.js             Service worker (fichiers de l'app, moteur OCR, SDK Firebase)
manifest.json     Manifeste PWA
icons/            Icônes PNG (180, 192, 512, maskable)
vendor/tesseract/ Moteur OCR local (Tesseract.js 5 + modèle français « best_int »), licences Apache 2.0
tools/make-icons.mjs   Régénère les icônes : node tools/make-icons.mjs
```
