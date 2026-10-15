# Discord sign-in from an embedded companion

This integration lets a companion's account button start Atlas's existing Discord sign-in, then establish its own session using the same verified Discord identity. Atlas remains the identity broker for this flow. It does not accept a companion's existing access token or create an Atlas session from a claimed Discord ID.

It is disabled by default. Deploying the function alone does not trust any companion, and adding a public origin alone does not enable code redemption. No production configuration or schema is changed by the PR.

## Flow

1. The companion backend creates a cryptographically random nonce (32 random bytes, base64url) and binds it to the initiating browser's session and login attempt. The account button sends the request below to its Atlas iframe.
2. Atlas verifies the immediate parent window and an exact, configured HTTPS origin, then asks the visitor to share their Discord identity with that companion. If needed, the visitor signs into Discord through the existing Atlas popup. They press Continue again after returning. This deliberate Atlas-side gesture avoids popup blocking and makes the identity-sharing consent explicit.
3. The iframe calls the new Edge Function with its own Supabase session. The function verifies the session with Supabase Auth, finds its linked Discord identity, and stores a hashed, 60-second, single-use code bound to the companion and nonce. Only the code returns to the parent.
4. The companion posts that code to its own backend. Its backend validates the saved nonce and initiating browser session, then redeems the code directly with Atlas using its partner secret. Redemption atomically deletes the grant. The reply contains the Atlas user ID and verified Discord ID, with no Atlas roles, notes or tokens.
5. The companion uses the Discord ID as its account key and creates its own session. It must never link accounts by display name or email alone. Existing Atlas permissions and note ownership stay unchanged.

The Atlas session and companion session have independent logout. This version does not implement linked logout or accept an already-existing companion Discord login in the reverse direction. It does not silently replace an Atlas account. Existing private Atlas notes are never exposed through the handoff.

## Atlas operator setup

- Apply `supabase/embed-auth.sql` to the Atlas Supabase project. It creates a separate RLS-enabled table and two service-role-only functions. It does not alter existing account or note tables.
- Generate a separate random secret of at least 32 characters for each partner and exchange it with that partner's backend operator through a private channel. Store it only in backend secret stores.
- Set the Edge Function secret `EMBED_AUTH_PARTNERS` to a JSON array such as `[{"id":"grimoire","origin":"https://monstersandmemories.info","secret":"<random backend-only secret>"}]`. Configure the project's standard Supabase URL, anon key and service role key in the function environment. Never commit the partner secret or service key.
- Deploy `embed-handoff` with JWT verification disabled at the gateway, since the function verifies Atlas sessions on issue and a partner credential on redemption. The handler rejects unsigned issuance and browser redemption itself.
- Add `embedAuthPartners: [{id:'grimoire',name:'Grimoire',origin:'https://monstersandmemories.info'}]` to `atlasConfig` only after the backend is ready. These public entries deliberately contain no secret. Origins must be exact HTTPS origins, with no paths or wildcard. Configure any additional host separately.
- Keep HTTPS, existing Discord provider configuration and the existing `signin.html` redirect. No new OAuth redirect is required.
- Rotation: update the partner's backend secret and the function secret together. Removing a partner from the backend rejects outstanding codes immediately. Removing the public entry disables new host-triggered prompts after reload. Codes expire in 60 seconds and are cleaned on subsequent issuance; an account can have at most 10 outstanding grants.

## Parent page example

Get `requestId` from your own backend, bound to this browser's login attempt, rather than trusting a nonce supplied by someone else. Register the result listener before sending the request. Rebind the iframe handle after it is recreated.

```js
const atlasOrigin = 'https://www.mnmatlas.com';
const frame = document.querySelector('#atlas');
const requestId = loginAttempt.nonce; // From your authenticated, same-origin backend.
async function result(event) {
  if (event.origin !== atlasOrigin || event.source !== frame.contentWindow) return;
  const data = event.data;
  if (!data || data.type !== 'mnmatlas:signin-result' || data.version !== 1 || data.requestId !== requestId) return;
  window.removeEventListener('message', result);
  if (data.error) { showLoginError(data.error); return; }
  // Your endpoint checks the saved nonce, browser binding, expiry and CSRF protection.
  const response = await fetch('/auth/atlas/complete', {
    method: 'POST', credentials: 'same-origin',
    headers: {'Content-Type':'application/json', 'X-CSRF-Token': loginAttempt.csrf},
    body: JSON.stringify({code:data.code, nonce:requestId})
  });
  if (!response.ok) showLoginError('Sign-in could not finish.');
}
window.addEventListener('message', result);
frame.contentWindow.postMessage({type:'mnmatlas:signin',version:1,requestId}, atlasOrigin);
```

The parent should time out the attempt after five minutes, remove its listener, and offer normal login on failure. A reload/navigation may cancel an in-progress attempt. A second request is ignored while consent is pending. A completed request ID cannot prompt again in that iframe for five minutes.

## Companion backend redemption

After checking the browser's saved login attempt and CSRF protection, make a server-to-server POST to the configured Atlas project's `/functions/v1/embed-handoff`:

```json
{"action":"redeem","partner":"grimoire","nonce":"<saved nonce>","code":"<code from iframe>"}
```

Use `Authorization: Bearer <partner secret>` and `Content-Type: application/json`. Do not send an Origin header. Never make this request from browser JavaScript. Keep the endpoint fixed in server configuration and do not accept an endpoint URL from the client.

A successful response is `{issuer:'mnmatlas',audience:'grimoire',nonce,subject,discordId}`. Check the issuer, audience and saved nonce, consume the local login attempt, rotate the companion session ID, and bind the companion account to the returned Discord ID. Do not use the Atlas user UUID as a Discord ID. Never log the grant code, credentials or tokens. Failed redemption must not establish a companion session.

## Validation

Run `node scripts/test-embed-auth.mjs` for backend and browser protocol checks. Run `node scripts/test-embed-auth-sql.mjs` with PostgreSQL binaries on PATH (or `ATLAS_PG_BIN` pointing to their directory) for a disposable local PostgreSQL cluster and synthetic users. It uses a free loopback port, applies the migration, tests service-only access, nonce/audience/expiry/replay and deletion cascade, then stops only its own cluster. Fixture files are retained in the system temporary directory for diagnosis.

Before enabling a production partner, test two synthetic accounts in a disposable Supabase project: Discord success/cancellation, the signed-in identity consent, popup blocking fallback, notes before/after login, an interrupted attempt, blocked iframe storage, and the actual Tauri webview/system browser combination. Existing Atlas sign-in remains the fallback. The automated tests do not certify those deployment-specific browser behaviors.
