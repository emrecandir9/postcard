# Setting up scheduled email

The app can email a postcard on a date you choose, even when your Mac is off. It does this
through a small script in your own Google account. The script saves each postcard to your
Google Drive and sends it from your Gmail on the chosen day, in the morning (from about
8:00). It's free and needs no extra sign-ups.

You only do this once. It takes about 10 minutes.

## 1. Make a secret word

The secret word stops anyone else from using your script. Make it long and random.

1. Open the **Terminal** app.
2. Paste this line and press Return:

   ```
   openssl rand -hex 24
   ```

3. It prints a long line of letters and numbers. Keep it somewhere handy for now. You'll paste
   it in two places.

(You can also just make up a long password of 30 or more letters and numbers.)

## 2. Create the script

1. Go to [script.google.com](https://script.google.com) and sign in with the Google account
   you want the emails to come from.
2. Click **New project** (top left).
3. Click **Untitled project** at the top and rename it to `Postcard email`.
4. You'll see a file called `Code.gs` with a few lines in it. Select all of that text and delete it.
5. Open `apps-script/Code.gs` from the postcard folder on your Mac, copy everything in it, and
   paste it into the empty editor.
6. Click the **Save project** icon (the floppy disk), or press Cmd+S.

## 3. Add the secret word and check the time zone

1. In the left sidebar, click **Project Settings** (the gear icon).
2. Under **General settings**, check that **Time zone** is your own time zone. The script uses
   it to decide what "today" is.
3. Scroll down to **Script Properties** and click **Add script property**.
4. Under **Property**, type `SECRET` (capital letters).
5. Under **Value**, paste your secret word from step 1.
6. Click **Save script properties**.

## 4. Turn on the hourly check and allow access

1. In the left sidebar, click **Editor** (the `< >` icon).
2. In the toolbar at the top, open the function menu (next to **Debug**) and choose `setup`.
3. Click **Run**.
4. A box says **Authorization required**. Click **Review permissions** and choose your account.
5. Google shows **Google hasn't verified this app**. That's expected: the "app" is the script
   you just pasted, in your own account, asking you for access. Click **Advanced**, then
   **Go to Postcard email (unsafe)**.
6. Google lists what the script wants to do. If there are checkboxes, tick **Select all**. The
   list will say something like:
   - See, edit, create, and delete all of your Google Drive files (to save the postcard images)
   - See, edit, create, and delete all your Google Sheets spreadsheets (to keep the list of
     scheduled postcards)
   - Send email as you (to send the postcards)
   - Allow this application to run when you are not present (for the hourly check)
7. Click **Allow** (or **Continue**).
8. At the bottom, the **Execution log** should say `Hourly trigger created.`
   If it also says `Warning: the SECRET script property is not set yet`, go back to step 3.

## 5. Publish the script so the app can reach it

1. Click the blue **Deploy** button (top right), then **New deployment**.
2. Next to **Select type**, click the gear icon and choose **Web app**.
3. Fill in:
   - **Description**: `Postcard email`
   - **Execute as**: **Me**
   - **Who has access**: **Anyone**
4. Click **Deploy**. If Google asks you to authorize again, do so as in step 4.
5. Copy the **Web app** URL (it ends in `/exec`) and click **Done**.

Why "Anyone": your Mac's app sends postcards to the script without signing in to Google, so the
script has to accept requests from anywhere. The secret word is what protects it. Without the
right secret, the script answers "unauthorized" and does nothing.

## 6. Tell the app where the script is

1. In Terminal, go to the postcard folder (the one where you run `npm start`) and run:

   ```
   touch .env
   open -e .env
   ```

2. TextEdit opens the file. Add these two lines, with your own URL and secret word in place of
   the examples. No spaces or quotes around them:

   ```
   APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
   APPS_SCRIPT_SECRET=your-secret-word
   ```

3. Save and close TextEdit.
4. If the app is running, stop it (Ctrl+C in its Terminal window) and start it again with
   `npm start`.

## 7. Try it

1. Open the app's create page, make a postcard, and choose **Send by email**.
2. Use your own email address and today's date, then click **Create**.
3. The app should say the postcard is scheduled. If it shows an error instead, see below.
4. To send it now instead of waiting for the next hourly check: in the script editor, choose
   `sendDue` in the function menu and click **Run**. (Before 8:00 in the morning this does
   nothing on purpose. The postcard goes out with the first check after 8:00.)
5. Check your inbox. The subject is "A postcard from" plus the location, and the postcard is
   shown in the email and attached.

You can see everything the script has stored in a Google Drive folder called **Postcard outbox**.
It holds the images and a spreadsheet with one row per postcard. The **status** column shows
`pending`, `sent`, or `error:` followed by the reason.

## If something goes wrong

- **The create page says "Email isn't set up yet."** The `.env` file is missing one of the two
  lines, or the app wasn't restarted after you added them.
- **The app says "unauthorized."** The secret word in `.env` and the `SECRET` script property
  aren't exactly the same. Copy it again into both places.
- **A row in the spreadsheet says `error: ...`.** That postcard won't be retried. The text after
  `error:` says why, for example a mistyped email address. Make the postcard again.
- **You changed `Code.gs` later.** Paste the new version, save, then click **Deploy** →
  **Manage deployments** → the pencil icon → **Version: New version** → **Deploy**. The URL
  stays the same.

Gmail allows about 100 emails a day from a script, far more than this needs.
