FamTime
========

Nedenfor finder du en guide til at få projektet op at køre.

## Det skal du have klar
- Node.js 18 eller nyere (inkl. npm 9 eller nyere)
- Expo Go-appen på din telefon, hvis du vil teste på en fysisk enhed

## Sådan kommer du i gang
1. Klon projektet fra GitHub eller hent ZIP-filen og pak den ud.
2. Åbn en terminal i projektmappen ved at højreklippe på ”app.js”
3. Opret en ny fil med navnet `.env`. De værdier, du skal sætte ind, STÅR I RAPPORTEN. Del dem ikke offentligt! 
4. Installer afhængigheder: `npm install`   ->   (Billede 1 i PDF version af Readme)

OBS! Da vi har skulle teste projektet på Expo dev build, er følgende process lidt anderledes end normalt!

5. Start udviklingsserveren: `npx expo start --go`    ->    (Billede 2 i PDF version af Readme)
6. Scan QR-koden fra din telefon og kør programmet på Expo Go-appen.     ->    (Billede 3 i PDF version)
7. Expo åbnes, og du skal trykke på ”Expo Go”!     ->    (Billede 4 i PDF version)
8. Når man har trykket Expo GO på telefonen, skal man tilbage i Visual Studio Code, hvor man skal trykke ”Tab”, for at komme ned på ” Proceed anonymously”, og trykke ”Enter” for at forsætte.    ->    (Billede 5 i PDF version)
9. Appen starter nu op på din telefon!     ->    (Billede 6 i PDF version)

 **OBS:** Vores program virker mest optimal med iPhone-telefoner!

## Hvis noget driller
- Stop Expo (`Ctrl + C`) og kør `npx expo start --clear` for at rydde cache.
- Tjek at `.env` faktisk ligger i projektmappen og indeholder alle værdierne fra rapporten.
- Sørg for at telefon og computer er på samme Wi-Fi, hvis du tester på fysisk enhed.

Så er du i gang! Resten af detaljerne (fx hvilke nøgler der skal bruges) finder du i rapporten eller i PDF versionen af README
