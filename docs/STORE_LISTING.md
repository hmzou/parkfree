# ParkFree — store listing kit

Everything the App Store and Google Play ask for, ready to paste.

## Names and short text

| Field | English | Français |
|---|---|---|
| App name (≤30) | ParkFree – Ottawa Parking | ParkFree – Stationnement Ottawa |
| Apple subtitle (≤30) | Free street parking, at a glance | Stationnement gratuit, d'un coup d'œil |
| Play short description (≤80) | See where you can park for free in Ottawa — and until when. | Voyez où stationner gratuitement à Ottawa, et jusqu'à quand. |
| Category | Navigation (Apple) / Maps & Navigation (Play) | |
| Keywords, Apple (≤100) | parking,free parking,ottawa,gatineau,street parking,meter,park,car,winter ban,reminder | stationnement,gratuit,ottawa,gatineau,parcomètre,rue,voiture,hiver,rappel |

## Full description — English

Stop circling the block. ParkFree colours every street in Ottawa so you know where you can park at a glance:

• Green — free parking. Unsigned Ottawa streets are free for 3 hours on weekdays (7 am–7 pm) and 6 hours on weekends.
• Blue — paid parking, drawn on the right side of the street, with the hourly rate and maximum stay.
• Red — no parking: highways, ramps and transit roads.

Open the app and it tells you the closest free street, how far it is and until when you can stay. Tap any street for a plain answer: "Free now · park until 10:00 a.m."

Parked? Tap "I parked here". ParkFree saves where your car is, starts a timer and reminds you before the time limit — so you move the car before you get a ticket. In winter it warns you when a snow ban is likely and shows the city's free lots during bans.

Search any address to see the closest free street to where you're going. Spotted a mistake? Tap "Wrong colour?" and tell us.

No account, no ads. Data from the City of Ottawa and OpenStreetMap. Always follow posted signs.

## Description complète — Français

Arrêtez de tourner en rond. ParkFree colore chaque rue d'Ottawa pour que vous sachiez d'un coup d'œil où stationner :

• Vert — gratuit. Les rues d'Ottawa sans panneau sont gratuites 3 heures en semaine (7 h–19 h) et 6 heures la fin de semaine.
• Bleu — payant, du bon côté de la rue, avec le tarif et la durée maximale.
• Rouge — interdit : autoroutes, bretelles et voies de transport en commun.

À l'ouverture, l'application vous indique la rue gratuite la plus proche, sa distance et jusqu'à quand vous pouvez rester. Touchez une rue pour une réponse claire : « Gratuit maintenant · jusqu'à 10 h ».

Stationné? Touchez « Je suis stationné ici ». ParkFree enregistre l'emplacement de votre voiture, lance une minuterie et vous prévient avant l'heure limite pour éviter la contravention. L'hiver, l'application vous avertit des interdictions probables et affiche les stationnements municipaux gratuits.

Cherchez une adresse pour trouver la rue gratuite la plus proche de votre destination. Une erreur? Touchez « Mauvaise couleur? ».

Sans compte, sans publicité. Données de la Ville d'Ottawa et d'OpenStreetMap. Respectez toujours la signalisation.

## URLs

- Privacy policy: host `docs/privacy.html` (for example with GitHub Pages: `https://hmzou.github.io/parkfree/privacy.html`). Replace `YOUR-CONTACT-EMAIL` first.
- Support URL: the GitHub repository, or the same page.

## Google Play — Data safety form

| Question | Answer |
|---|---|
| Collects or shares user data? | Collects: yes. Shares: no |
| Encrypted in transit? | Yes |
| Users can request deletion? | Yes, by email |
| Location → Precise location | Collected; required for app functionality; not shared |
| App activity → Other user-generated content | Collected (reports, corrections); app functionality; optional |
| Device or other IDs | Collected (Firebase anonymous ID); app functionality |
| Used for ads or tracking? | No |

Content rating questionnaire: Utility/Navigation, no violence, no user-to-user communication, no purchases. Target audience: 18+.

## Apple — App Privacy ("nutrition label")

- Precise Location: App Functionality. Linked to user: No. Tracking: No.
- User Content (other): App Functionality. Not linked, no tracking.
- Identifiers (User ID): App Functionality. Not linked, no tracking.
- Data used to track you: none.

## Screenshots needed

- iPhone 6.9" (1320 × 2868) and 6.5" (1284 × 2778): at least 3 each.
- Android phone: 2–8 screenshots, 16:9 or 9:16, plus a 1024 × 500 feature graphic.

Suggested shots: (1) the coloured street map, (2) a street card with "Free now · park until…", (3) the nearest-free-street card, (4) parked with the timer running, (5) the paid-parking card.

## Before release — things only the account owner can do

1. **Google Play:** finish developer account setup (identity verification) in Play Console. New personal accounts must run a **closed test with at least 12 testers for 14 days** before they can publish to production.
2. **Apple:** an active Apple Developer Program membership (US$99/year), then create the app in App Store Connect with bundle ID `com.parkfree.app`.
3. **Expo:** `npx eas-cli login` with the `hmzou` account (builds run on Expo's servers).
4. **Mapbox:** create a secret token with the `DOWNLOADS:READ` scope and save it as the EAS secret `MAPBOX_SECRET_TOKEN` (native builds can't download the Mapbox SDK without it).
5. **EAS environment:** add the values from `.env` as EAS environment variables. `.env` is not uploaded with builds because it is git-ignored.
