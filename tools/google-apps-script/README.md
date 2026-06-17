# Tracker intake — Google Apps Script

1. Open your Google Sheet → Extensions → Apps Script.
2. Paste `Code.gs` into the script, add an HTML file named `form` with `form.html`'s contents.
3. (Optional) Set a shared token: Project Settings → Script properties → add `ACCESS_TOKEN`.
4. Deploy → New deployment → type **Web app**. Execute as **Me**; Who has access **Anyone**.
5. Copy the **Web app URL** (ends in `/exec`). That URL is BOTH the form link to share AND the URL you paste into Nimbalyst (Tracker → Connect Google Sheet).
6. Smoke test: open the URL (form), submit a row, confirm it appears in the sheet; open `URL?api=rows` and confirm JSON (if you set `ACCESS_TOKEN` in step 3, append `&token=YOUR_TOKEN`, e.g. `URL?api=rows&token=YOUR_TOKEN`).
