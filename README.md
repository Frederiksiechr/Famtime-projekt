FamTime
========

Nedenfor finder du en guide til at få projektet op at køre.

Det skal du have klar
----------------------
- Node.js 18 eller nyere (inkl. npm 9 eller nyere)
- Expo Go-appen på din telefon, hvis du vil teste på en fysisk enhed

Sådan kommer du i gang
----------------------
1. Klon projektet fra GitHub eller hent ZIP-filen og pak den ud.
2. Åbn en terminal i projektmappen.
3. Installer afhængigheder: `npm install`
4. Opret en ny fil med navnet `.env`. De værdier, du skal sætte ind, STÅR I RAPPORTEN. Del dem ikke offentligt.
5. Start udviklingsserveren: `npx expo start`
6. Scan QR-koden fra din telefon og kør programmet på Expo Go-appen.

> **OBS:** Vores program virker kun med iPhone-telefoner i denne version, da den kun kan synkronisere med Apple Calendar.

Hvis noget driller
------------------
- Stop Expo (`Ctrl + C`) og kør `npx expo start --clear` for at rydde cache.
- Tjek at `.env` faktisk ligger i projektmappen og indeholder alle værdierne fra rapporten.
- Sørg for at telefon og computer er på samme Wi-Fi, hvis du tester på fysisk enhed.
