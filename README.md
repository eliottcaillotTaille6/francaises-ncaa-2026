# Les Françaises en NCAA — Taille 6

Site statique qui suit, match par match, les joueuses françaises de NCAA Division I féminine (saison 2026-27). Il se met à jour tout seul chaque matin grâce à une GitHub Action, puis se redéploie sur GitHub Pages.

## Comment ça marche

```
data/players.json  ──┐
data/sources.json  ──┼─► scripts/update.mjs ──► data/games.json ──► site (public/)
ESPN + sites des facs┘          │
                                ├─► data/missing-games.md   (matchs joués sans stats)
                                └─► data/discrepancies.md   (écarts ESPN / site fac)
```

- **Calendrier de référence** : le calendrier officiel de chaque fac (`data/sources.json`). Si le site d'une fac est illisible, c'est le calendrier ESPN de l'équipe qui sert de référence.
- **Stats** : ESPN en priorité, sinon le box score du site de la fac. Chaque ligne garde sa `source` (pastille « ESPN » ou « Site fac » sur le site). Si les deux sources divergent, ESPN est retenu et l'écart est listé dans `data/discrepancies.md` (points : tout écart, minutes : 2 min ou plus).
- **Un match = une fac + une date US Eastern + un adversaire.** Relancer le script ne crée jamais de doublon, et une stat corrigée par ESPN remplace l'ancienne.
- Les matchs d'exhibition sont ignorés.
- Chaque matin, le script reprend aussi automatiquement les matchs terminés des 10 derniers jours qui n'ont toujours pas de stats.

## Installation locale

Node 20 ou plus récent.

```bash
npm ci
```

```bash
npm run dev
```

Le site est alors visible sur http://localhost:4321.

## Commandes

| Commande | Effet |
|---|---|
| `npm run update` | Matchs de la veille et du jour (US Eastern) |
| `node scripts/update.mjs --date 2026-11-14` | Une journée précise |
| `node scripts/update.mjs --from 2026-11-02 --to 2026-12-01` | Rattrapage sur une période |
| `npm run backfill` | Rattrapage depuis le début de la saison (2 novembre 2026) |
| `node scripts/update.mjs --date 2026-11-14 --no-espn --out /tmp/test.json` | Test avec les seuls sites des facs, sans toucher `games.json` |
| `npm run match` | Remplit les IDs ESPN manquants et régénère `data/matching-report.md` |
| `npm run sources` | Ajoute à `data/sources.json` les facs qui n'y sont pas encore |
| `npm run build` | Assemble le site dans `_site/` |

## Ajouter ou retirer une joueuse

Toutes les modifications se font dans **`data/players.json`**.

**Ajouter** : copier un bloc existant et le modifier. L'`id` doit être unique (minuscules, sans accents, mots séparés par des tirets).

```json
{
  "id": "prenom-nom",
  "name": "Prénom Nom",
  "team": "Nom de la fac",
  "position": "G",
  "height": "5-10",
  "class": "Fr.",
  "hometown": "Ville",
  "background": "Club → fac",
  "status": "Confirmée",
  "note": "",
  "source": "https://site-de-la-fac.com/sports/womens-basketball/roster",
  "active": true,
  "espn_athlete_id": "",
  "espn_team_id": ""
}
```

Ensuite :

1. Lancer `npm run match`. Il remplit les IDs ESPN quand la correspondance est certaine. Sinon, le cas apparaît dans `data/matching-report.md`.
2. Si la fac est nouvelle, lancer `npm run sources`, puis vérifier sa ligne dans `data/sources.json`.

Si la joueuse figure dans les box scores sous un autre nom (deuxième nom de famille, surnom), ajoutez un champ `"aliases": ["Autre Nom"]`.

**Transfert** : changer `team`, vider `espn_athlete_id` et `espn_team_id`, puis lancer `npm run match`.

**Retirer définitivement** : supprimer son bloc dans `players.json` et ajouter son `id` à `excluded_players` dans `config/site.json`. `npm run import` ne la réintroduira plus depuis le fichier Excel. Sarah Strong est dans ce cas.

**Blessure longue, départ** : passer `"active": false`. La joueuse disparaît du site, mais ses matchs restent dans `games.json`. Repasser à `true` pour la faire revenir.

> `npm run import` reconvertit le fichier Excel `data/source-joueuses.xlsx` (gardé en local, non publié sur GitHub) en `players.json`. Les IDs ESPN et le champ `active` déjà renseignés sont conservés, mais les autres modifications faites à la main sont écrasées. Pendant la saison, modifiez plutôt `players.json` directement.

## Corriger un ID ESPN

1. Trouver la joueuse sur ESPN. L'ID est le nombre dans l'URL `espn.com/womens-college-basketball/player/_/id/5459388/...`.
2. Le copier dans `espn_athlete_id` (entre guillemets). `espn_team_id` est le nombre dans l'URL de l'équipe (`.../team/_/id/166/...`).
3. Relancer `npm run match` pour vérifier : la joueuse doit apparaître dans la section « Confirmées » du rapport. Sans `--force`, un ID renseigné à la main n'est jamais écrasé.
4. Pour recalculer ses matchs déjà joués : `node scripts/update.mjs --from 2026-11-02`.

Un ID vide n'empêche pas de suivre la joueuse : ses stats sont alors cherchées par son nom dans les box scores ESPN et sur le site de la fac.

## Corriger la source d'une fac

Dans `data/sources.json`, chaque fac a :

- `platform` : `sidearm`, `sidearm-nuxt`, `sidearm-vue`, `wmt` ou `blocked` ;
- `schedule_url` : la page du calendrier ;
- `enabled` : `false` pour ne plus lire le site, et se contenter d'ESPN ;
- `youtube_name` : le nom utilisé dans les recherches YouTube ;
- `note` : un commentaire libre.

Pour refaire la détection automatique d'une fac :

```bash
node scripts/build-sources.mjs --force "Nom de la fac"
```

## Liens YouTube et noms d'équipe

Le format de la recherche se règle dans `config/site.json` :

- `youtube.query` : le modèle de la recherche YouTube générale (un seul bouton « YouTube ») ;
- `youtube.channels` : la chaîne où le pipeline cherche d'abord le match (Walter Gaming). Si une vidéo a pour titre les deux équipes, « women/féminin » et la date du match, le bouton YouTube mène directement à cette vidéo. Sinon il mène à la recherche générale, et le pipeline réessaie chaque jour pendant 10 jours ;
- `team_names` : remplace un nom d'adversaire par son nom courant, par exemple `"Florida Atlantic": "FAU"`.

## Couleurs

- Couleurs : variables `--t6-green` et `--t6-black` en haut de `public/styles.css`.
- Polices : `--font-display` (Industry, Apotek Cond) s'affiche si les polices sont ajoutées en webfont, sinon le site utilise une police système.

## Déploiement (GitHub Pages)

1. Créer un dépôt GitHub et y pousser ce dossier :

   ```bash
   git init
   git add .
   git commit -m "Site Taille 6 NCAA"
   git branch -M main
   git remote add origin git@github.com:<compte>/<depot>.git
   git push -u origin main
   ```

2. Dans le dépôt, ouvrir **Settings → Pages → Build and deployment → Source** et choisir **GitHub Actions**.
3. Dans **Settings → Actions → General → Workflow permissions**, cocher **Read and write permissions**, pour que l'Action puisse commiter les données.
4. L'Action `.github/workflows/update.yml` tourne alors tous les jours à 9 h UTC (10 h à Paris en hiver). Elle récupère les matchs, commite `data/`, puis redéploie le site. Elle redéploie aussi le site à chaque push sur `public/`, `config/`, `players.json` ou `sources.json`.
5. **Rattrapage depuis GitHub** : onglet **Actions → Mise à jour quotidienne → Run workflow**, puis remplir les champs `from` et `to`.

## Actualiser le site à la demande

Un bouton **Actualiser** apparaît en haut du site, uniquement pour vous :

1. Ouvrir une fois le site avec `?admin` à la fin de l'adresse (`https://<compte>.github.io/<depot>/?admin`). Le bouton reste ensuite affiché sur cet appareil et ce navigateur. Pour le masquer, ouvrir le site avec `?admin=0`.
2. Dans `config/site.json`, renseigner `update_workflow_url` avec l'adresse de l'Action : `https://github.com/<compte>/<depot>/actions/workflows/update.yml`.
3. Un clic sur **Actualiser** ouvre cette page GitHub : y cliquer sur **Run workflow**. Le site attend la publication des nouvelles données, puis se recharge tout seul (5 à 10 minutes).

Tant que `update_workflow_url` est vide, le bouton recharge seulement les dernières données publiées. Les visiteurs ne voient pas le bouton, et ne pourraient de toute façon pas lancer l'Action sans droits sur le dépôt.

## Points d'attention

- Les endpoints ESPN sont publics mais non officiels : ils peuvent changer sans préavis. Le site fonctionne aussi avec les seuls sites des facs (option `--no-espn` pour tester).
- `gamecocksonline.com` (South Carolina) bloque les requêtes automatiques. Ce blocage n'est pas contourné : les stats de South Carolina viennent uniquement d'ESPN.
- `gomason.com` (George Mason) est protégé par Incapsula. S'il bloque les serveurs de GitHub, l'erreur apparaît en bas de `data/missing-games.md`.
- `stats.ncaa.org` bloque les requêtes automatiques (403) et n'est pas utilisé.
- Les requêtes sont espacées (700 ms par défaut, variable `HTTP_DELAY_MS`), mises en cache dans `.cache/http` et relancées en cas d'erreur.
