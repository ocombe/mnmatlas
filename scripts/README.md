# Publish approved suggestions

Requires Node 18 or newer, with no dependencies. Run from any directory; data paths are resolved from the script's atlas folder. First review suggestions in the atlas, then supply the project URL and service key **only in your local environment**. Never save the service key in `config.js`, a site file, or git.

PowerShell:

```powershell
$env:SUPABASE_URL='https://<project-ref>.supabase.co'
$env:SUPABASE_SERVICE_KEY='<service key>'
node scripts/apply-approved.mjs --dry-run
node scripts/apply-approved.mjs
Remove-Item Env:SUPABASE_SERVICE_KEY
```

POSIX shell:

```sh
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/apply-approved.mjs --dry-run
SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/apply-approved.mjs
```

The dry run validates every approved row and prints the proposed summary without changing files or backend rows. A normal run applies approved suggestions oldest first, selecting `markersFile` or `labelsFile` from `data/maps.json`, including level overrides. Coordinates round to integers. New IDs are `community-<suggestion id>`; area labels and exits go to the place-name file. Only supported marker fields are copied. Trade symbols and colours work on published markers too.

The script preserves each JSON file's indentation, line endings and trailing newline. It validates the complete batch before writing, then sets applied suggestions to `published`. Re-running after a failed status update recognizes existing IDs and positions. A move whose published starting point has changed stops the run: review that suggestion again before applying it. Two different approved moves for the same target may therefore require another review. Do not run two publishers concurrently.

Review the resulting data diff and preview the atlas before committing and publishing through the usual GitHub Pages workflow. The script does not commit or deploy, and never prints the service key. If files were written but a backend update failed, keep those files and rerun before accepting newer suggestions.

Run `node scripts/test-apply-approved.mjs` for local publisher checks against a mock service; it uses disposable fixture files inside this folder and leaves map data unchanged.

Run `node scripts/test-community.mjs` for client checks with a local service stub, including disabled configuration, counters, problem reports, suggestions and note sync. These do not replace the live access checks in the Supabase setup guide.
