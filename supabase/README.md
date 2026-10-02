# Optional community service

1. Create a Supabase project. Paste `schema.sql` into its SQL editor and run it. It can be run again safely.
2. Create a Discord application in the [Discord developer portal](https://discord.com/developers/applications). Add the callback URL shown in Supabase Authentication → Providers → Discord (usually `https://<project-ref>.supabase.co/auth/v1/callback`) to the application's OAuth2 redirects. Enable Discord in Supabase with that application's client ID and secret. Keep the secret in Supabase, never in this site.
3. In Authentication → URL Configuration, set Site URL to `https://www.mnmatlas.com/`. Allow `https://www.mnmatlas.com/**` as a redirect URL so map and level query strings return to the same view. Add your local preview origin separately if needed.
4. Fill `supabaseUrl` and `supabaseKey` in `config.js` with the project URL and **publishable** key. Never put a service key in a site file. Leaving either value empty disables accounts and all community requests.
5. Sign in once. In the SQL editor, run one of the commented admin inserts at the end of `schema.sql`, matching your Discord name or email. Sign out and back in to refresh access. Remove the row in the dashboard to revoke review access.
6. Complete the checks below, then use **Review suggestions** in the field guide. Approval queues a change for the local [publishing script](../scripts/README.md); it does not change the map immediately.

`vote_totals(p_map text)` is the public aggregate RPC. It returns only map, marker ID, up and down counts, bypassing private vote rows. All four tables have Row Level Security. Anonymous users have no table or sequence access. The public function has a fixed search path and no dynamic SQL. Suggestions have a daily limit of 50 per account; concurrent requests and batches are also checked. Browser inserts cannot supply the creation timestamp.

Notes use the map ID and tile revision as their scope, retaining each note's level. Sign-in and map loads merge by ID, with the browser's version winning conflicts. Saves push after about two seconds. A failed sync keeps local data, displays a quiet status line and retries on a later save or reconnection. Export notes for a separate backup. Deleting a note and immediately leaving before its sync completes can leave the remote copy to be merged on the next visit.

## Manual access checks

Use two signed-in, non-admin accounts A and B. Use their authenticated browser sessions or JWTs with the publishable key, **never** the service key. Create one pending suggestion, vote and note row for each. A must see only A's private rows. Anonymous sessions must fail to read any table, but must be able to call `vote_totals` and see only aggregates.

With A's session, confirm these operations fail or return no changed/read rows:

- Approve, reject, edit or delete A's own suggestion.
- Approve, edit or delete B's suggestion; select B's suggestions, votes or notes.
- Insert a suggestion with B's `user_id`, with `status='approved'`, with non-null `reviewed_at` or `review_note`, or with a supplied `created_at`.
- Insert/update/delete votes or notes belonging to B; change an owned row's `user_id` to B.
- Insert/update/delete an admin row, including one for A.
- Insert an oversized payload, name, note, comment or notes array; insert a 51st suggestion within 24 hours (also try a concurrent batch).

Then add A to `admins` in the dashboard. Confirm A can read pending suggestions from B and approve/reject them, while B cannot. Confirm the admin can still only select their own admin row and their own private notes/votes. Remove A's admin row after this check if it is a test account.

Provider and redirect setup follows the [Discord sign-in guide](https://supabase.com/docs/guides/auth/social-login/auth-discord) and [redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls). Access rules follow [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
