# FamTime

## Sådan kommer du i gang (trin for trin)

1. **Klon projektet**
   ```bash
   git clone https://github.com/<dit-brugernavn>/famtime-plus.git
   cd famtime-plus
   ```

2. **Installer Node-afhængigheder**
   ```bash
   npm install
   ```

3. **Opret miljøfil**
   ```bash
   cp .env.example .env
   ```
   Redigér `.env` og erstat placeholders med dine egne Firebase-nøgler (se næste afsnit for hvor de findes). Lad `.env` blive på din maskine – den er allerede ignoreret i Git.

4. **(Valgfrit) Sæt OpenAI proxy op**
   - Hvis du bruger din egen OpenAI-nøgle direkte fra klienten, så udfyld `OPENAI_API_KEY` og eventuelt `OPENAI_PROXY_URL` i `.env`.
   - Hvis du bruger Firebase Cloud Function proxyen, så spring dette over og følg instruktionerne under *OpenAI proxy (Cloud Functions)*.

5. **Start Expo udviklingsserver**
   ```bash
   npx expo start
   ```
   Scan QR-koden i Expo Go-appen, eller brug `npm run android` / `npm run ios` for at køre i emulator/simulator.

## Projektoversigt

FamTime er en Expo-baseret React Native-app, der leverer et simpelt login-flow med Firebase Email/Password Authentication og Firestore-lagring af brugere. Koden er skrevet i JavaScript og struktureret modulært, så studerende let kan bygge videre.

```
famtime/
  app.json
  package.json
  babel.config.js
  .eslintrc.js
  .prettierrc.js
  .env.example
  src/
    App.js
    navigation/
      RootNavigator.js
    screens/
      LoginScreen.js
      SignupScreen.js
      ForgotPasswordScreen.js
      LandingScreen.js
    components/
      FormInput.js
      Button.js
      ErrorMessage.js
    lib/
      firebase.js
      errorMessages.js
    config/
      firebaseConfig.js
    styles/
      theme.js
```

## Systemkrav

- Node.js >= 18
- npm >= 9
- Expo CLI (`npx expo`) – installeres automatisk via scripts
- Expo Go-app på iOS/Android for hurtig test (eller Android emulator / iOS simulator)
- Java 17 + Android Studio (kun hvis du bygger native Android standalone senere)
- Xcode 15 (kun hvis du bygger native iOS standalone senere)

## Installation

1. Følg den officielle guide til Expo-opsætning: [Expo Environment Setup](https://docs.expo.dev/get-started/installation/).
2. `npm install`
3. Kopiér `.env.example` til `.env` og udfyld Firebase- og OpenAI-nøgler.
4. Start udviklingsserveren:
   - `npm run start` for at åbne Expo Dev Tools.
   - `npm run android` for at starte serveren og åbne Expo Go på en Android-enhed/emulator.
   - `npm run ios` for at starte serveren og åbne Expo Go på en iOS-enhed/simulator.

## Firebase opsætning (kræves)

1. **Opret projekt**
   - Gå til [console.firebase.google.com](https://console.firebase.google.com/) og klik *Add project*.
   - Vælg et projektnavn og afslut guiden.

2. **Registrér en Web-app**
   - Inde i dit Firebase-projekt: tryk på tandhjulet → *Project settings* → fanen *General*.
   - Under *Your apps* klik på `</>` (Web) og følg guiden. Du behøver ikke hosting.
   - Når appen er oprettet, får du et JavaScript-objekt med nøgler som `apiKey`, `authDomain`, osv. Kopiér værdierne.

3. **Udfyld `.env`**
   - Åbn `.env` i din editor og indsæt værdierne i følgende felter:
     ```
     FIREBASE_API_KEY=kopieret apiKey
     FIREBASE_AUTH_DOMAIN=kopieret authDomain
     FIREBASE_PROJECT_ID=kopieret projectId
     FIREBASE_STORAGE_BUCKET=kopieret storageBucket
     FIREBASE_MESSAGING_SENDER_ID=kopieret messagingSenderId
     FIREBASE_APP_ID=kopieret appId
     FIREBASE_MEASUREMENT_ID=kopieret measurementId (kan udelades hvis ikke vist)
     ```

4. **Aktivér Authentication & Firestore**
   - Gå til *Build → Authentication → Sign-in method* og aktiver *Email/Password*.
   - Gå til *Build → Firestore Database* og opret en database i *Production mode* (standard placering er fin til udvikling).

5. **Tillad udviklingsdomæner**
   - Under *Authentication → Settings → Authorized domains* tilføj `localhost`, `127.0.0.1`, `exp.host` samt din LAN-IP hvis du tester på fysisk enhed.

6. **Start projektet igen**
   - Hvis Expo allerede kører, så stop processen og start `npx expo start --clear` for at indlæse den opdaterede `.env`.

## Vigtige Scripts

- `npm run start` – Expo Dev Server
- `npm run android` – start Expo Dev Server og åbn Android Expo Go
- `npm run ios` – start Expo Dev Server og åbn iOS Expo Go
- `npm run web` – kør appen i browseren via Expo Web
- `npm run lint` – kør ESLint

## OpenAI proxy (Cloud Functions)

Appen kalder en Firebase Cloud Function, der proxier OpenAI. For at aktivere den:

1. **Installer Firebase CLI** hvis du ikke allerede har den (følg [Firebase CLI guide](https://firebase.google.com/docs/cli)).
2. Log ind og vælg projekt:
   ```bash
   firebase login
   firebase use <dit-firebase-projekt-id>
   ```
3. Sæt de nødvendige konfigurationsnøgler (brug samme modelnavn som i `.env` eller vælg en anden):
   ```bash
   firebase functions:config:set openai.key="sk-..." openai.model="gpt-4o-mini"
   ```
4. Deploy funktionen:
   ```bash
   cd firebase/functions
   npm install
   cd ..
   firebase deploy --only functions:openaiSuggestion
   ```
5. Når deploy er færdig, peger mobilappen automatisk på funktionen. Hvis du ændrer nøgler senere, gentag trin 3.

## Typiske Fejl & Løsninger

- **"Firebase config not found"**: Sørg for at din `.env` fil indeholder alle `FIREBASE_*` variabler og genstart Expo-serveren efter ændringer.
- **Expo Go viser blank skærm**: Tjek Metro-logs i terminalen og sørg for at du har scannet den seneste QR-kode.
- **Auth-fejl "auth/unauthorized-domain"**: Tilføj `localhost`, `127.0.0.1`, `exp.host` og evt. LAN-IP under Authentication → Settings → Authorized domains.
- **Netværksfejl på fysisk device**: Sørg for at telefonen og computeren er på samme netværk eller brug `expo start --tunnel`.
- **Firestore permissions**: Brug udviklingsregler, eller sikr at dine sikkerhedsregler tillader skriveadgang for nye brugere under udvikling.

## Arkitektur & Videreudvikling

- `src/navigation/RootNavigator.js` lytter til `onAuthStateChanged` og skifter mellem auth- og app-stack.
- Skærmene i `src/screens/` kombinerer validering, Firebase-kald og UI med tydelige kommentarer.
- `src/components/` indeholder genanvendelige byggesten med dokumenterede props.
- `src/lib/firebase.js` centraliserer Firebase-initialisering for hele appen.
- `src/styles/theme.js` definerer farver, spacing og fontstørrelser til konsistent UI.

### Udvidelser du kan overveje

1. Tilføj profiler og familie data til Firestore.
2. Implementér onboarding med familiemedlemmer og roller.
3. Synkronisér lokale data med AsyncStorage for offline-oplevelse.

## Sikkerhed før offentliggørelse

- Sørg for at `.env` aldrig bliver committed (`git status` skal ikke vise `.env`). `.env.example` må gerne ligge i repoet.
- Rotér alle Firebase- og OpenAI-nøgler, der tidligere har været checket ind eller delt, før du gør repoet offentligt.
- Gennemgå `firebase functions:config:get` og bekræft at der ikke ligger følsomme nøgler i kildekoden.
- Hvis du arbejder i et team, så del nøgler via sikre kanaler (fx password manager) og ikke i issues eller pull requests.
