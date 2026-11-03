## Vérification manuelle sur les sites officiels (3 novembre 2026)

Rosters officiels lus pour les cas non confirmés. Ces infos ne remplissent aucun ID : elles servent à trancher.

- **Aissatou Keita** : le roster officiel de NM State affiche « Aissatou Keita », avec une photo nommée `Aissatou_Keita_Cissoko.png`. La note Excel cite aussi « Aissatou Keita Cissoko ». **Validé le 3 novembre 2026 : ID ESPN 5459388.**
- **Fanta Keita** : présente sur le roster officiel de NM State, absente du roster ESPN. Le candidat proposé plus haut (Aissatou Keita Cissoko) n'est **pas** elle. Ses matchs passeront par le site de la fac tant qu'ESPN ne l'ajoute pas.
- **Justine Mouyokolo**, **Julia Saillard** : présentes sur le roster officiel de NM State (12 joueuses chez ESPN, davantage sur le site). Même traitement : site de la fac.
- **Mariss Miekountima** : présente sur le roster officiel de FIU, absente d'ESPN. Même traitement.
- **Clara Djoko** : absente du roster officiel de Loyola Chicago, et l'URL source du fichier Excel renvoie une 404. Elle a peut-être quitté l'équipe ou ne joue pas cette saison. À vérifier ; je propose de la passer en `"active": false` en attendant.
- **Justine Loubens** : absente du roster ESPN de South Carolina. Le site officiel `gamecocksonline.com` bloque les requêtes automatiques (403), donc je n'ai pas pu vérifier. À contrôler à la main.

## Décisions du 3 novembre 2026

- **Clara Djoko** : passée en `"active": false` (absente du roster officiel, fiche en 404). Repasser à `true` si elle réapparaît.
- **Amandine Amorich** : la source pointe désormais vers le roster basket de Loyola Maryland (`/roster/amandine-amorich/14026`).
- **Justine Loubens** : laissée active. Elle est absente du roster ESPN, et le site de South Carolina est bloqué, donc à vérifier à la main.
- **Sarah Strong** : retirée définitivement (`excluded_players` dans `config/site.json`).
