# Accounts and sign-in setup

The app code for every sign-in method is done. Each method also needs a switch
turned on in a console that only the account owner can sign in to. A button
only appears in the app once its settings are in the build, so nothing
half-configured is ever shown to users.

| Method | What it needs | Status |
|---|---|---|
| Email + password | Firebase switch (step 1) | Code done |
| Google | Firebase switch + 1 EAS variable (step 2) | Code done |
| Microsoft | Azure app registration + Firebase switch + 1 EAS variable (step 3) | Code done |
| Apple | Apple Developer membership (step 4) | Code done, iOS only |

Anonymous use keeps working without an account. Creating an account *links*
the anonymous user, so parking history made before signing up is kept.

## 1. Email and password (2 minutes)

1. Open https://console.firebase.google.com/project/parkfree01/authentication/providers
2. **Add new provider → Email/Password → Enable → Save.**
3. Optional: **Templates** tab → set the sender name to "ParkFree" and edit the
   verification and password-reset emails (English and French).

## 2. Google (10 minutes)

1. Same page: **Add new provider → Google → Enable**, pick your support email, **Save**.
2. Open the Google provider again and copy the **Web client ID** (ends in
   `.apps.googleusercontent.com`).
3. Save it for builds:
   ```bash
   npx eas-cli env:create --name GOOGLE_WEB_CLIENT_ID --value YOUR_WEB_CLIENT_ID --visibility plaintext --environment production --environment preview --environment development
   ```
   and add `GOOGLE_WEB_CLIENT_ID=...` to `.env` for local web testing.
4. Android needs the app's signing fingerprints registered:
   - Get the upload key SHA-1: `npx eas-cli credentials -p android` → production → Keystore.
   - After the first Play upload, also copy the **App signing key SHA-1** from
     Play Console → Test and release → App integrity.
   - Firebase console → Project settings → **Add app → Android**, package
     `com.parkfree.app`, paste the SHA-1s. (This creates the Android OAuth client
     Google sign-in checks against.)
5. Rebuild the app.

## 3. Microsoft (15 minutes)

1. https://portal.azure.com → **Microsoft Entra ID → App registrations → New registration**.
   - Name: ParkFree. Supported accounts: **Accounts in any organizational directory and personal Microsoft accounts**.
   - Redirect URI (Web): `https://parkfree01.firebaseapp.com/__/auth/handler`
2. In the registration: **Authentication → Add a platform → Mobile and desktop
   applications**, custom redirect URI `parkfree://auth`.
3. **Certificates & secrets → New client secret**; copy the value.
4. Firebase → Sign-in method → **Add new provider → Microsoft**: paste the
   Application (client) ID and the secret → **Save**.
5. Save the client ID for builds:
   ```bash
   npx eas-cli env:create --name MICROSOFT_CLIENT_ID --value YOUR_CLIENT_ID --visibility plaintext --environment production --environment preview --environment development
   ```
6. Rebuild. Note: Firebase documents Microsoft sign-in for web; on phones the
   app uses Microsoft's own sign-in page and hands the result to Firebase. Test
   it on a phone before announcing it.

## 4. Apple (needs the Apple Developer membership)

1. Apple Developer → Certificates, IDs & Profiles → the `com.parkfree.app` App
   ID → enable **Sign in with Apple**.
2. Firebase → **Add new provider → Apple → Enable** (for iOS, no Services ID is
   needed).
3. `npx eas-cli env:create --name APPLE_SIGN_IN --value 1 --visibility plaintext --environment production --environment preview --environment development`
4. Rebuild for iOS. App Review requires Sign in with Apple whenever Google or
   Microsoft sign-in is offered on iOS.

## 5. Database rules

The rules for sign photos and sign reports (ambassadors) must be deployed, or
posting a sign fails:

```bash
npx firebase-tools deploy --only firestore:rules
```

## What an account includes

- Sign up with name, email, password (8+ characters, letters and numbers) and
  confirmation; a verification email is sent in the app's language.
- Sign in, forgotten password (reset email), resend verification, edit name.
- Account details: name, email, verified or not, sign-in method, member since.
- Sign out (the app keeps working anonymously).
- **Delete account** in the app: deletes the account, parking history, parking
  records, sign photos and sign reports (required by Google Play and Apple).
  Web page for the same: `docs/delete-account.html`.
- Ambassadors must have an account; the database rejects sign photos from
  anonymous users.
