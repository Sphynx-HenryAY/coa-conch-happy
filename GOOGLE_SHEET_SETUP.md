# Google Sheet setup (paste-link mode)

The app can read and write a Google Sheet using only a pasted Sheet link. A
single Apps Script Web App must be deployed **once** by the site owner; users
do not deploy anything.

## For the site owner (once)

1. Go to <https://script.google.com> and create a **standalone** Apps Script
   project.
2. Delete the sample code, paste the whole contents of `apps-script.gs`, save.
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the `https://script.google.com/macros/s/…/exec` URL.
5. Open the app's **名稱設定 / Settings → Google Sheet sync → 首次設定**, expand it,
   and paste the URL into **服務網址（管理員）**, then press **儲存設定**.
   (Alternatively put the URL in `SHEET_WEB_APP_URL` at the top of `app.js`.)

If `apps-script.gs` is edited later, redeploy: **Manage deployments → edit →
Version: New version**. The URL stays the same.

## For each user

1. Open the Google Sheet to use as the data source.
2. Click **Share / 共用**, choose **Anyone with the link / 知道連結的任何人**,
   and set permission to **Editor / 編輯者**.
   - This is required because the Web App runs as the site owner; link-based
     Editor access lets it write to the Sheet without being added as a person.
   - Anyone with the link can edit the records, so do not use this mode for
     sensitive data.
3. In the app open **Settings → Google Sheet sync**, paste the Sheet link
   (`https://docs.google.com/spreadsheets/d/…/edit`) and press **儲存設定**.
   The page extracts the ID, tests the connection, and loads the records.
4. Use **從 Sheet 讀取 / 寫回 Sheet** in 全部紀錄 to reload or save.

## Optional

- Set `TOKEN` in `apps-script.gs` and enter the same value in the advanced
  settings if you want a password on the Web App endpoint.
- Set `SHEET_NAME` in `apps-script.gs` to sync a specific tab; leave empty for
  the first tab.
- Excel import/export still works and remains available as a backup.
